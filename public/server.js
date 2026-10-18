const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const QUIZ_MCQ = [
    { q: "Diketahui himpunan A={1,2,3} dan B={2,4,6}. Relasi dari A ke B adalah 'setengah dari'. Pasangan berurutan yang tepat adalah...", options: ["{(2,1), (4,2), (6,3)}", "{(1,2), (2,4), (3,6)}", "{(1,4), (2,6), (3,2)}", "{(1,1), (2,2), (3,3)}"], answer: 1 },
    { q: "Diketahui fungsi f(x) = 2x + 3 dengan domain {1, 2, 3, 4}. Range fungsi tersebut adalah...", options: ["{3, 5, 7, 9}", "{5, 7, 9, 11}", "{2, 4, 6, 8}", "{1, 3, 5, 7}"], answer: 1 },
    { q: "Suatu relasi disebut fungsi jika setiap anggota domain mempunyai...", options: ["Tepat satu pasangan di kodomain", "Bebas pasangan kodomain", "Dua pasangan kodomain", "Tidak ada pasangan"], answer: 0 },
    { q: "Diketahui fungsi f(x) = x² - 4 dengan domain {-2, -1, 0, 1, 2}. Nilai f(2) adalah...", options: ["0", "2", "-4", "4"], answer: 0 },
    { q: "Jika f(x) = 3x - 1 dan nilai f(x) = 8, maka nilai x adalah...", options: ["2", "3", "4", "5"], answer: 1 },
    { q: "Diketahui fungsi h(x) = -2x + 5. Nilai dari h(-3) adalah...", options: ["-1", "1", "11", "-11"], answer: 2 },
    { q: "Himpunan pasangan berurutan berikut yang merupakan fungsi adalah...", options: ["{(1,2), (1,3), (1,4)}", "{(2,3), (3,4), (4,5)}", "{(1,2), (2,3), (2,4)}", "{(3,1), (3,2), (4,1)}"], answer: 1 }
];

let rooms = {};

function createInitialState() {
    let pawns = [];
    for (let p = 0; p < 5; p++) {
        for (let i = 0; i < 4; i++) {
            pawns.push({ player: p, id: i, dist: -1 });
        }
    }
    return {
        pawns, currentTurn: 0, diceVal: 1, state: 'ROLL', rankings: [], activePawnId: null, isGameOver: false
    };
}

const startIndices = [8, 21, 34, 47, 60];

io.on('connection', (socket) => {
    socket.on('join_room', (roomId) => {
        socket.join(roomId);
        if (!rooms[roomId]) rooms[roomId] = createInitialState();
        socket.emit('init_state', rooms[roomId]);
    });

    socket.on('restart_game', ({ roomId }) => {
        if (rooms[roomId]) {
            rooms[roomId] = createInitialState();
            io.to(roomId).emit('update_game', rooms[roomId]);
        }
    });

    socket.on('roll_dice', ({ roomId }) => {
        let room = rooms[roomId];
        if (!room || room.state !== 'ROLL' || room.isGameOver) return;

        room.diceVal = Math.floor(Math.random() * 6) + 1;
        
        let canAnyMove = room.pawns.some(p => {
            if (p.player !== room.currentTurn) return false;
            if (p.dist >= 68) return false;
            if (p.dist === -1) return room.diceVal === 6;
            if (p.dist + room.diceVal > 68) return false;
            return true;
        });

        if (!canAnyMove) {
            room.state = 'ANIMATING';
            io.to(roomId).emit('update_game', room);
            setTimeout(() => {
                room.state = 'ROLL';
                if (room.diceVal !== 6) {
                    do { room.currentTurn = (room.currentTurn + 1) % 5; } while (room.rankings.includes(room.currentTurn));
                }
                io.to(roomId).emit('update_game', room);
            }, 1000);
        } else {
            room.state = 'WAIT_MOVE';
            io.to(roomId).emit('update_game', room);
        }
    });

    socket.on('move_pawn', ({ roomId, pawnIndex }) => {
        let room = rooms[roomId];
        if (!room || room.state !== 'WAIT_MOVE' || room.isGameOver) return;

        let pawn = room.pawns.find(p => p.player === room.currentTurn && p.id === pawnIndex);
        if (!pawn) return;

        if (pawn.dist === -1) {
            if (room.diceVal === 6) pawn.dist = 0;
        } else {
            pawn.dist += room.diceVal;
            if (pawn.dist > 68) pawn.dist = 68;
        }

        room.state = 'ANIMATING';
        room.activePawnId = pawnIndex;
        io.to(roomId).emit('update_game', room);

        setTimeout(() => {
            let captured = false;
            if (pawn.dist >= 0 && pawn.dist <= 62) {
                let gIdx = (startIndices[pawn.player] + pawn.dist) % 65;
                let isSafe = startIndices.includes(gIdx);
                
                if (!isSafe) {
                    room.pawns.forEach(p2 => {
                        if (pawn.player !== p2.player && p2.dist >= 0 && p2.dist <= 62) {
                            let gIdx2 = (startIndices[p2.player] + p2.dist) % 65;
                            if (gIdx === gIdx2) { 
                                p2.dist = -1; 
                                captured = true; 
                            }
                        }
                    });
                }
            }

            let finishedCount = room.pawns.filter(p => p.player === room.currentTurn && p.dist >= 68).length;
            if (finishedCount === 4 && !room.rankings.includes(room.currentTurn)) {
                room.rankings.push(room.currentTurn);
                if (room.rankings.length >= 4) {
                    room.isGameOver = true;
                    io.to(roomId).emit('game_over', { rankings: room.rankings });
                    return;
                }
            }

            if (captured) {
                io.to(roomId).emit('update_game', room);
            }

            // --- DETEKSI PETAK BINTANG & TANDA TANYA ---
            let hitQuiz = false;
            if (pawn.dist >= 0 && pawn.dist <= 62) {
                let gIdx = (startIndices[pawn.player] + pawn.dist) % 65;
                let isStar = (gIdx % 13 === 3); 
                if (isStar && !startIndices.includes(gIdx)) {
                    hitQuiz = true;
                }
            } else if (pawn.dist >= 63 && pawn.dist < 68) {
                // Petak Tanda Tanya (?) di Home Stretch
                let stepInHome = pawn.dist - 63;
                if (stepInHome === 0 || stepInHome === 2 || stepInHome === 4) {
                    hitQuiz = true;
                }
            }

            setTimeout(() => {
                if (hitQuiz) {
                    room.state = 'QUIZ';
                    io.to(roomId).emit('update_game', room);
                    let randomQuiz = QUIZ_MCQ[Math.floor(Math.random() * QUIZ_MCQ.length)];
                    io.to(roomId).emit('trigger_mcq', { quiz: randomQuiz });
                    console.log("KUIS BERHASIL DIPICU OTOMATIS!");
                } else {
                    room.state = 'ROLL';
                    if (!captured && room.diceVal !== 6) {
                        do { room.currentTurn = (room.currentTurn + 1) % 5; } while (room.rankings.includes(room.currentTurn));
                    }
                    io.to(roomId).emit('update_game', room);
                }
            }, captured ? 1000 : 300);

        }, 1200);
    });

    socket.on('answer_mcq', ({ roomId, correct }) => {
        let room = rooms[roomId]; if (!room || room.isGameOver) return;
        let pawn = room.pawns.find(p => p.player === room.currentTurn && p.id === room.activePawnId);
        
        if (pawn) {
            if (correct) {
                pawn.dist += 3; // Maju 3 langkah jika BENAR
                if (pawn.dist > 68) pawn.dist = 68;
            } else {
                pawn.dist -= 3; // Mundur 3 langkah jika SALAH
                if (pawn.dist < 0) pawn.dist = 0;
            }
        }

        room.state = 'ANIMATING';
        io.to(roomId).emit('update_game', room);

        setTimeout(() => {
            room.state = 'ROLL';
            do { room.currentTurn = (room.currentTurn + 1) % 5; } while (room.rankings.includes(room.currentTurn) && room.rankings.length < 4);
            io.to(roomId).emit('update_game', room);
        }, 1500);
    });
});

server.listen(3000, () => {
    console.log('Server Ludo berjalan di http://localhost:3000');
});