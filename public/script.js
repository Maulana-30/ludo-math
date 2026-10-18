const socket = io();
const roomId = prompt("Masukkan Nama Room/Meja Game:", "Room1") || "Room1";
socket.emit('join_room', roomId);

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSfx(type) {
    try {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        if (type === 'roll') {
            osc.type = 'square'; osc.frequency.setValueAtTime(250, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(500, audioCtx.currentTime + 0.1);
            gain.gain.setValueAtTime(0.1, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
            osc.start(); osc.stop(audioCtx.currentTime + 0.1);
        } else if (type === 'correct') {
            osc.type = 'sine'; osc.frequency.setValueAtTime(400, audioCtx.currentTime); osc.frequency.setValueAtTime(600, audioCtx.currentTime + 0.1); osc.frequency.setValueAtTime(800, audioCtx.currentTime + 0.2);
            gain.gain.setValueAtTime(0.2, audioCtx.currentTime); gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
            osc.start(); osc.stop(audioCtx.currentTime + 0.4);
        } else if (type === 'wrong') {
            osc.type = 'sawtooth'; osc.frequency.setValueAtTime(250, audioCtx.currentTime); osc.frequency.linearRampToValueAtTime(100, audioCtx.currentTime + 0.3);
            gain.gain.setValueAtTime(0.2, audioCtx.currentTime); gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
            osc.start(); osc.stop(audioCtx.currentTime + 0.3);
        } else if (type === 'move') {
            osc.type = 'sine'; osc.frequency.setValueAtTime(600, audioCtx.currentTime);
            gain.gain.setValueAtTime(0.05, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.05);
            osc.start(); osc.stop(audioCtx.currentTime + 0.05);
        }
    } catch (e) { console.log("Audio terblokir:", e); }
}

const canvas = document.getElementById('ludoCanvas');
const ctx = canvas ? canvas.getContext('2d') : null;
const CX = 500; const CY = 500; const S = 35; 
const R = (1.5 * S) / Math.tan(36 * Math.PI / 180); 

const PLAYERS = [
    { name: "Biru", color: "#3b82f6", hex: "#1d4ed8" },    
    { name: "Kuning", color: "#eab308", hex: "#a16207" },  
    { name: "Merah", color: "#ef4444", hex: "#b91c1c" },   
    { name: "Hijau", color: "#22c55e", hex: "#15803d" },   
    { name: "Oranye", color: "#f97316", hex: "#c2410c" }   
];

function getRotatedPos(lx, ly, angleDeg) {
    let rad = angleDeg * Math.PI / 180;
    return { x: CX + lx * Math.cos(rad) - (-ly) * Math.sin(rad), y: CY + lx * Math.sin(rad) + (-ly) * Math.cos(rad) };
}

function getTileCenter(arm, col, row) {
    let lx = col * S; let ly = R + (row + 0.5) * S;
    return getRotatedPos(lx, ly, arm * 72);
}

const track = []; 
for (let arm = 0; arm < 5; arm++) {
    for (let r = 0; r <= 5; r++) { track.push({ arm, col: -1, row: r, special: (r === 3) ? 'star' : null }); }
    track.push({ arm, col: 0, row: 5, special: null });
    for (let r = 5; r >= 0; r--) { track.push({ arm, col: 1, row: r, special: null }); }
}

const bases = [];
for (let i = 0; i < 5; i++) {
    let v1 = getRotatedPos(1.5 * S, R, i * 72); let v2 = getRotatedPos(1.5 * S, R + 6 * S, i * 72); let v3 = getRotatedPos(-1.5 * S, R + 6 * S, (i + 1) * 72); let circleCenter = getRotatedPos(0, R + 4.2 * S, i * 72 + 36);
    bases.push({ v1, v2, v3, cx: circleCenter.x, cy: circleCenter.y });
}

let gameState = { pawns: [], currentTurn: 0, diceVal: 1, state: 'ROLL', rankings: [] };
let visualPawns = [];
let userSessionChoiceMade = false;
let animatingLoopStarted = false;

socket.on('init_state', (serverState) => {
    let savedState = localStorage.getItem('ludo_save_' + roomId);
    if (savedState && !userSessionChoiceMade && document.getElementById('session-modal')) {
        document.getElementById('session-modal').classList.add('active');
    } else { applyServerState(serverState); }
});

function handleSessionChoice(choice) {
    userSessionChoiceMade = true;
    document.getElementById('session-modal')?.classList.remove('active');
    if (choice === 'resume') {
        let savedState = localStorage.getItem('ludo_save_' + roomId);
        if (savedState) {
            try {
                gameState = JSON.parse(savedState);
                syncVisualPawns(); updateUI();
                if(!animatingLoopStarted && ctx) { animatingLoopStarted = true; requestAnimationFrame(drawLoop); }
                return;
            } catch (e) {}
        }
    }
    localStorage.removeItem('ludo_save_' + roomId); socket.emit('restart_game', { roomId });
}

function applyServerState(serverState) {
    gameState = serverState; syncVisualPawns();
    document.getElementById('victory-modal')?.classList.remove('active'); 
    document.getElementById('session-modal')?.classList.remove('active');
    updateUI();
    if(!animatingLoopStarted && ctx) { animatingLoopStarted = true; requestAnimationFrame(drawLoop); }
}

socket.on('update_game', (serverState) => {
    gameState = serverState;
    localStorage.setItem('ludo_save_' + roomId, JSON.stringify(gameState));
    updateUI();
    if(!animatingLoopStarted && ctx) {
        animatingLoopStarted = true;
        requestAnimationFrame(drawLoop);
    }
});

// MEMAKSA MODAL KUIS MUNCUL KETIKA DITRIGGER OLEH SERVER
socket.on('trigger_mcq', (data) => {
    let quiz = data.quiz || data; 
    if (!quiz || !quiz.q) return;

    let icon = document.getElementById('quiz-icon'); 
    if(icon) { 
        icon.className = `w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shadow-lg border-2 border-white/30 text-white bg-amber-500`; 
        icon.innerText = '?'; 
    }
    
    let qEl = document.getElementById('quiz-q'); 
    if(qEl) qEl.innerText = quiz.q;
    
    let optsContainer = document.getElementById('quiz-opts');
    if(optsContainer) {
        optsContainer.innerHTML = '';
        quiz.options.forEach((opt, idx) => {
            let btn = document.createElement('button'); 
            btn.className = 'quiz-opt w-full text-left p-3 my-1 bg-slate-800 hover:bg-slate-700 rounded-xl text-white transition border border-slate-700 font-medium cursor-pointer'; 
            btn.innerText = String.fromCharCode(65 + idx) + ". " + opt;
            btn.onclick = () => {
                let correct = (idx === quiz.answer);
                if(correct) playSfx('correct'); else playSfx('wrong');
                socket.emit('answer_mcq', { roomId, correct });
                
                let modal = document.getElementById('quiz-modal');
                if(modal) {
                    modal.classList.remove('active');
                    modal.style.display = 'none';
                }
            };
            optsContainer.appendChild(btn);
        });
    }
    
    let modal = document.getElementById('quiz-modal');
    if(modal) {
        modal.classList.add('active');
        modal.style.display = 'flex'; // Paksa tampil menutupi layar
    }
});

socket.on('game_over', ({ rankings }) => {
    let winContent = document.getElementById('win-content');
    if(winContent) {
        let html = "<h2 class='text-2xl font-bold mb-4 text-amber-400'>🏆 Papan Peringkat Akhir 🏆</h2><ul class='space-y-2 mb-6'>";
        rankings.forEach((pIdx, rank) => {
            let medals = ["🥇", "🥈", "🥉", "4️⃣"];
            html += `<li class='p-2 rounded bg-slate-800 flex justify-between items-center text-white'><span>${medals[rank] || '🏁'} Peringkat ${rank + 1}</span><strong style="color: ${PLAYERS[pIdx].color}">${PLAYERS[pIdx].name}</strong></li>`;
        });
        html += "</ul>";
        html += `
            <div class='flex gap-4 justify-center'>
                <button onclick='restartGame()' class='bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl font-bold transition'>Main Lagi</button>
                <button onclick='window.close()' class='bg-rose-600 hover:bg-rose-500 text-white px-4 py-2 rounded-xl font-bold transition'>Selesai / Keluar</button>
            </div>
        `;
        winContent.innerHTML = html;
    }
    document.getElementById('victory-modal')?.classList.add('active');
});

function syncVisualPawns() {
    if (visualPawns.length === 0) {
        visualPawns = gameState.pawns.map(p => {
            let t = getPawnTarget({ player: p.player, id: p.id, dist: p.dist });
            return { player: p.player, id: p.id, dist: p.dist, targetDist: p.dist, x: t.x, y: t.y, tx: t.x, ty: t.y, lastHop: 0 };
        });
    } else {
        gameState.pawns.forEach(p => {
            let vp = visualPawns.find(v => v.player === p.player && v.id === p.id);
            if (vp) vp.targetDist = p.dist; 
        });
    }
}

function rollDice() {
    let btn = document.getElementById('roll-btn'); if (btn && btn.disabled) return; if (btn) btn.disabled = true;
    playSfx('roll'); let diceEl = document.getElementById('dice');
    if(diceEl) { diceEl.classList.add('rolling'); setTimeout(() => diceEl.classList.remove('rolling'), 400); }
    socket.emit('roll_dice', { roomId });
}

function restartGame() { 
    localStorage.removeItem('ludo_save_' + roomId); 
    document.getElementById('victory-modal')?.classList.remove('active');
    socket.emit('restart_game', { roomId }); 
}

const startIndices = [8, 21, 34, 47, 60];
function getPawnTarget(p) {
    if (p.dist === -1) {
        let base = bases[p.player]; let off = [[-14, -14], [14, -14], [-14, 14], [14, 14]];
        return { x: base.cx + off[p.id][0], y: base.cy + off[p.id][1] };
    }
    if (p.dist >= 68) return { x: CX, y: CY }; 
    if (p.dist <= 62) {
        let gIdx = (startIndices[p.player] + p.dist) % 65; let tile = track[gIdx];
        return getTileCenter(tile.arm, tile.col, tile.row);
    }
    let stepInHome = p.dist - 63; 
    let targetRow = 5 - stepInHome; 
    if (targetRow < 0) targetRow = 0;
    return getTileCenter(p.player, 0, targetRow);
}

function canMove(pawn) {
    if (pawn.dist >= 68) return false;
    if (pawn.dist === -1) return gameState.diceVal === 6; 
    if (pawn.dist + gameState.diceVal > 68) return false;
    return true;
}

if(canvas) {
    canvas.addEventListener('click', (e) => {
        if (gameState.state !== 'WAIT_MOVE') return;
        let rect = canvas.getBoundingClientRect(); let scale = canvas.width / rect.width;
        let cx = (e.clientX - rect.left) * scale; let cy = (e.clientY - rect.top) * scale;
        let clickedPawn = null;
        for (let p of gameState.pawns) {
            if (p.player === gameState.currentTurn && canMove(p)) {
                let t = getPawnTarget(p); let dist = Math.hypot(t.x - cx, t.y - cy);
                if (dist < S * 0.8) { clickedPawn = p; break; }
            }
        }
        if (clickedPawn) socket.emit('move_pawn', { roomId, pawnIndex: clickedPawn.id });
    });
}

function drawTile(arm, col, row, color, icon, iconColor) {
    ctx.save(); ctx.translate(CX, CY); ctx.rotate((arm * 72) * Math.PI / 180);
    let lx = col * S; let ly = -(R + (row + 0.5) * S); 
    ctx.translate(lx, ly); ctx.fillStyle = color; ctx.fillRect(-S/2, -S/2, S, S); ctx.lineWidth = 1.5; ctx.strokeStyle = '#1e293b'; ctx.strokeRect(-S/2, -S/2, S, S);
    if (icon) {
        ctx.save(); ctx.fillStyle = iconColor; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        if (icon === '?') { ctx.font = `900 ${S*0.75}px Nunito`; ctx.rotate(Math.PI); ctx.fillText(icon, 0, 0); } 
        else { ctx.font = `900 ${S*0.6}px Nunito`; ctx.fillText(icon, 0, 2); }
        ctx.restore();
    }
    ctx.restore();
}

function drawInsideArrow(arm, col, row) {
    ctx.save(); ctx.translate(CX, CY); ctx.rotate((arm * 72) * Math.PI / 180); let lx = col * S; let ly = -(R + (row + 0.5) * S); 
    ctx.translate(lx, ly); ctx.fillStyle = '#ef4444'; ctx.beginPath();
    ctx.moveTo(0, 11); ctx.lineTo(-8, -2); ctx.lineTo(-3, -2); ctx.lineTo(-3, -11); ctx.lineTo(3, -11); ctx.lineTo(3, -2); ctx.lineTo(8, -2); ctx.closePath();
    ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = '#ffffff'; ctx.stroke(); ctx.restore();
}

function drawLoop() {
    if(!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < 5; i++) {
        let b = bases[i];
        ctx.beginPath(); ctx.moveTo(b.v1.x, b.v1.y); ctx.lineTo(b.v2.x, b.v2.y); ctx.lineTo(b.v3.x, b.v3.y); ctx.closePath(); ctx.fillStyle = PLAYERS[i].color; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = PLAYERS[i].hex; ctx.stroke();
        ctx.beginPath(); ctx.arc(b.cx, b.cy, S * 1.1, 0, Math.PI * 2); ctx.fillStyle = '#f8fafc'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = '#1e293b'; ctx.stroke();
    }
    track.forEach((t, idx) => {
        let color = '#f8fafc', icon = '', iColor = '';
        if (t.special === 'star') { color = '#ec4899'; icon = '★'; iColor = 'white'; }
        for(let pIdx = 0; pIdx < startIndices.length; pIdx++) { if (idx === startIndices[pIdx]) { color = PLAYERS[pIdx].color; break; } }
        drawTile(t.arm, t.col, t.row, color, icon, iColor);
    });
    for (let arm = 0; arm < 5; arm++) {
        for (let r = 0; r <= 4; r++) {
            let icon = null, iconColor = null;
            if (r === 0 || r === 2 || r === 4) { icon = '?'; iconColor = 'white'; }
            drawTile(arm, 0, r, PLAYERS[arm].color, icon, iconColor);
        }
    }
    for(let i = 0; i < 5; i++) {
        ctx.beginPath(); ctx.moveTo(CX, CY); let ptLeft = getRotatedPos(-1.5 * S, R, i * 72); let ptRight = getRotatedPos(1.5 * S, R, i * 72);
        ctx.lineTo(ptLeft.x, ptLeft.y); ctx.lineTo(ptRight.x, ptRight.y); ctx.closePath();
        ctx.fillStyle = PLAYERS[i].color; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#334155'; ctx.stroke();
    }
    drawInsideArrow(2, 0, 5); drawInsideArrow(1, 0, 5); drawInsideArrow(0, 0, 5); drawInsideArrow(4, 0, 5); drawInsideArrow(3, 0, 5);

    syncVisualPawns();
    let now = Date.now();

    visualPawns.forEach(vp => {
        let dx = vp.tx - vp.x; let dy = vp.ty - vp.y;
        let isMoving = Math.abs(dx) > 1.5 || Math.abs(dy) > 1.5;

        if (isMoving) { 
            vp.x += dx * 0.15; vp.y += dy * 0.15; 
        } else { 
            vp.x = vp.tx; vp.y = vp.ty;
            
            if (vp.dist !== vp.targetDist) {
                if (!vp.lastHop || now - vp.lastHop > 180) {
                    vp.lastHop = now;
                    if (vp.targetDist === -1) vp.dist = -1; 
                    else vp.dist += (vp.targetDist > vp.dist) ? 1 : -1; 
                    
                    let t = getPawnTarget({ player: vp.player, id: vp.id, dist: vp.dist });
                    vp.tx = t.x; vp.ty = t.y;
                    if(vp.dist !== -1) playSfx('move');
                }
            }
        }
        if (vp.dist >= 68 && vp.targetDist >= 68 && !isMoving) return;
        
        ctx.beginPath(); ctx.arc(vp.x, vp.y + 3, S*0.35, 0, Math.PI*2); ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fill();
        ctx.beginPath(); ctx.arc(vp.x, vp.y, S*0.35, 0, Math.PI*2); ctx.fillStyle = PLAYERS[vp.player].hex; ctx.fill();
        ctx.lineWidth = 2.5; ctx.strokeStyle = '#ffffff'; ctx.stroke();

        let pState = gameState.pawns.find(p => p.player === vp.player && p.id === vp.id);
        let pCanMove = pState ? canMove(pState) : false;
        if (gameState.state === 'WAIT_MOVE' && vp.player === gameState.currentTurn && vp.targetDist < 68 && pCanMove) {
            ctx.beginPath(); ctx.arc(vp.x, vp.y, S*0.55, 0, Math.PI*2);
            ctx.lineWidth = 3; ctx.strokeStyle = '#facc15'; ctx.setLineDash([4,4]); ctx.stroke(); ctx.setLineDash([]);
        }
    });
    requestAnimationFrame(drawLoop);
}

function updateUI() {
    let p = PLAYERS[gameState.currentTurn]; if(!p) return;
    let box = document.getElementById('turn-color-box'); if(box) { box.style.backgroundColor = p.color; box.innerText = p.name[0]; }
    let name = document.getElementById('turn-name'); if(name) { name.innerText = p.name; name.style.color = p.color; }
    const faces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅']; let diceEl = document.getElementById('dice');
    if(diceEl) { diceEl.innerText = faces[gameState.diceVal - 1] || '⚀'; diceEl.style.color = p.color; }
    let btn = document.getElementById('roll-btn'); let hint = document.getElementById('action-hint');
    
    if (gameState.state === 'ROLL') {
        if(btn) btn.disabled = false; 
        if(hint) { hint.innerText = "Kocok dadu sekarang!"; hint.style.color = "#94a3b8"; }
    } else if (gameState.state === 'WAIT_MOVE') {
        if(btn) btn.disabled = true; 
        if(hint) { hint.innerText = `Pilih pion untuk maju ${gameState.diceVal} langkah`; hint.style.color = "#34d399"; }
    } else if (gameState.state === 'ANIMATING') {
        if(btn) btn.disabled = true; 
        if(hint) { hint.innerText = "Pion sedang melompat..."; hint.style.color = "#facc15"; }
    } else if (gameState.state === 'QUIZ') {
        if(btn) btn.disabled = true; 
        if(hint) { hint.innerText = "Menjawab kuis (+3/-3)..."; hint.style.color = "#ec4899"; }
    }
}
