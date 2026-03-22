/* ═══════════════════════════════════════════════════════════
   SYNCZONE — app.js
   Real-time rooms via Firebase Realtime Database
═══════════════════════════════════════════════════════════ */

/* ─── CONSTANTS ─── */
const PALETTE = ['#c4b5fd','#ff2d78','#fbbf24','#38bdf8','#00e5c3','#fb923c','#a3e635','#f97316'];
const BG_MAP  = {
  '#c4b5fd':'rgba(139,92,246,.2)', '#ff2d78':'rgba(255,45,120,.18)',
  '#fbbf24':'rgba(251,191,36,.18)','#38bdf8':'rgba(56,189,248,.18)',
  '#00e5c3':'rgba(0,229,195,.18)', '#fb923c':'rgba(251,146,60,.18)',
  '#a3e635':'rgba(163,230,53,.18)','#f97316':'rgba(249,115,22,.18)',
};

/* ─── STATE ─── */
let G = {
  userId: null, name: '', code: '', isHost: false,
  color: '', bg: '', init: '',
  members: {},
  tttScores: { X:0, O:0, D:0 },
  chatCollapsed: false,
};

/* Firebase refs (live listeners) */
let _db, _membersRef, _chatRef, _videoRef, _startedRef;

/* ─── UTILS ─── */
const $ = id => document.getElementById(id);
const isMob = () => window.innerWidth < 768;
function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function nowTime() {
  return new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
}
function shake(id) {
  const el = $(id);
  if (!el) return;
  el.classList.add('error');
  setTimeout(() => el.classList.remove('error'), 700);
}
function toast(msg, type='info') {
  let t = $('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:9999;font-family:var(--orb);font-size:10px;font-weight:700;letter-spacing:1.5px;padding:10px 20px;border:1px solid;pointer-events:none;transition:opacity .3s';
    document.body.appendChild(t);
  }
  const colors = {info:'var(--teal)', error:'var(--pink)', success:'var(--teal)'};
  t.textContent = msg;
  t.style.background = 'var(--bg2)';
  t.style.color = colors[type] || 'var(--teal)';
  t.style.borderColor = colors[type] || 'var(--teal)';
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2800);
}

/* ═══════════════════════════════════════════════════════════
   FIREBASE INIT & CHECK
═══════════════════════════════════════════════════════════ */
function checkFirebaseConfig() {
  const isPlaceholder = !FIREBASE_CONFIG.apiKey || FIREBASE_CONFIG.apiKey.startsWith('REPLACE');
  if (isPlaceholder) {
    $('config-overlay').style.display = 'flex';
    return false;
  }
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    _db = firebase.database();
    return true;
  } catch (e) {
    console.error(e);
    $('config-overlay').style.display = 'flex';
    return false;
  }
}

/* ═══════════════════════════════════════════════════════════
   ONBOARDING
═══════════════════════════════════════════════════════════ */
function setStep(n) {
  $('ob-bar').style.width = [25,50,75,100][n] + '%';
  ['os0','os1','os2','os3'].forEach((id,i) => {
    const el = $(id);
    el.className = 'ob-step' + (i < n ? ' done' : i === n ? ' on' : '');
  });
}
function showS(id) {
  document.querySelectorAll('.ob-scr').forEach(s => s.classList.remove('on'));
  $(id).classList.add('on');
}

function onName() {
  const v = $('n-inp').value;
  $('n-av').textContent = v ? v[0].toUpperCase() : '?';
  G.name = v || '';
}

function go2() {
  const v = $('n-inp').value.trim();
  if (!v) { shake('n-inp'); return; }
  G.name = v;
  G.userId = uid();
  G.init = v.slice(0,2).toUpperCase();
  showS('s2'); setStep(1);
}

function toggleJoinBox() {
  const b = $('join-box');
  b.style.display = b.style.display === 'none' ? 'block' : 'none';
  if (b.style.display !== 'none') $('code-inp').focus();
}

function fmtCode(el) {
  let v = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (v.length > 4) v = v.slice(0,4) + '-' + v.slice(4,8);
  el.value = v;
}

/* ─── CREATE ROOM ─── */
async function doCreate() {
  $('create-btn').textContent = 'CREATING…';
  $('create-btn').disabled = true;
  G.isHost = true;
  G.code = 'SYNC-' + Math.floor(1000 + Math.random() * 9000);
  G.color = PALETTE[0];
  G.bg    = BG_MAP[G.color];

  try {
    const roomRef = _db.ref(`rooms/${G.code}`);
    await roomRef.set({
      meta: { host: G.userId, created: Date.now() },
      started: false,
      members: {
        [G.userId]: {
          name: G.name, init: G.init,
          color: G.color, bg: G.bg,
          isHost: true, joinedAt: Date.now(),
        }
      }
    });
    /* auto-remove self on disconnect */
    _db.ref(`rooms/${G.code}/members/${G.userId}`).onDisconnect().remove();

    $('disp-rc').textContent = G.code;
    $('share-link').textContent = window.location.origin + '/?join=' + G.code;
    showS('s3'); setStep(2);
  } catch (e) {
    toast('Error creating room. Check Firebase config.', 'error');
    console.error(e);
  }
  $('create-btn').textContent = 'CREATE ROOM';
  $('create-btn').disabled = false;
}

function copyRoomCode() {
  navigator.clipboard?.writeText(G.code).catch(() => {});
  const b = $('copy-btn'); b.textContent = 'COPIED!';
  setTimeout(() => b.textContent = 'COPY CODE', 1500);
}
function copyInviteLink() {
  const link = window.location.origin + '/?join=' + G.code;
  navigator.clipboard?.writeText(link).catch(() => {});
  const b = $('copy-link-btn'); b.textContent = 'LINK COPIED!';
  setTimeout(() => b.textContent = 'COPY INVITE LINK', 1500);
}

function openWR() {
  startWaitingRoom();
  showS('s4'); setStep(3);
}

/* ─── JOIN ROOM ─── */
async function doJoin() {
  const code = $('code-inp').value.trim().toUpperCase();
  if (code.length < 8) { shake('code-inp'); return; }

  const btn = $('join-btn');
  btn.textContent = 'JOINING…'; btn.disabled = true;

  try {
    const snap = await _db.ref(`rooms/${code}`).once('value');
    if (!snap.exists()) {
      toast('Room not found. Check the code.', 'error');
      btn.textContent = 'JOIN ROOM →'; btn.disabled = false;
      return;
    }
    if (snap.val().started) {
      toast('This party already started. Ask host for a new room.', 'error');
      btn.textContent = 'JOIN ROOM →'; btn.disabled = false;
      return;
    }

    const existing = snap.val().members || {};
    const memberCount = Object.keys(existing).length;
    G.color = PALETTE[memberCount % PALETTE.length];
    G.bg    = BG_MAP[G.color] || 'rgba(255,255,255,.1)';
    G.code  = code;
    G.isHost = false;

    await _db.ref(`rooms/${code}/members/${G.userId}`).set({
      name: G.name, init: G.init,
      color: G.color, bg: G.bg,
      isHost: false, joinedAt: Date.now(),
    });
    _db.ref(`rooms/${code}/members/${G.userId}`).onDisconnect().remove();

    startWaitingRoom();
    showS('s4'); setStep(3);
  } catch (e) {
    toast('Error joining room.', 'error');
    console.error(e);
  }
  btn.textContent = 'JOIN ROOM →'; btn.disabled = false;
}

/* ═══════════════════════════════════════════════════════════
   WAITING ROOM
═══════════════════════════════════════════════════════════ */
function startWaitingRoom() {
  /* listen for members */
  _membersRef = _db.ref(`rooms/${G.code}/members`);
  _membersRef.on('value', snap => {
    if (!snap.exists()) return;
    G.members = snap.val() || {};
    renderWaitingTiles();
  });

  /* non-host listens for started flag */
  if (!G.isHost) {
    _startedRef = _db.ref(`rooms/${G.code}/started`);
    _startedRef.on('value', snap => {
      if (snap.val() === true) {
        if (_startedRef) _startedRef.off();
        launch();
      }
    });
  }

  /* host actions */
  $('wr-btns').innerHTML = G.isHost
    ? `<button class="btn btn-primary" id="start-btn" onclick="hostStart()" style="min-width:160px;font-size:10px">START PARTY →</button>
       <button class="btn btn-ghost" onclick="copyRoomCode()">COPY CODE</button>`
    : `<p style="font-size:11px;color:var(--muted);letter-spacing:.5px">Waiting for host to start the party…</p>`;
}

function renderWaitingTiles() {
  const members = Object.entries(G.members).sort((a,b) => a[1].joinedAt - b[1].joinedAt);
  $('wr-grid').innerHTML = members.map(([uid, m]) => `
    <div class="w-tile${m.isHost ? ' you' : ' joined'}" id="wt-${uid}">
      <div class="wt-av" style="background:${m.bg};color:${m.color}">${m.init}</div>
      <div style="font-size:11px;font-weight:500">${uid === G.userId ? m.name + ' (you)' : m.name}</div>
      <div style="font-family:var(--orb);font-size:8px;letter-spacing:1.5px;color:${m.isHost ? '#c4b5fd' : 'var(--teal)'}">
        ${m.isHost ? 'HOST' : 'JOINED ✓'}
      </div>
      ${m.isHost ? `<div class="wt-badge" style="color:#c4b5fd;border-color:rgba(139,92,246,.35)">YOU</div>` : ''}
    </div>`).join('');

  const cnt = members.length;
  $('wr-sub').textContent = cnt <= 1
    ? 'Waiting for friends to join…'
    : `${cnt} people in room — ${G.isHost ? 'start when ready' : 'waiting for host…'}`;
}

async function hostStart() {
  $('start-btn').disabled = true;
  $('start-btn').textContent = 'STARTING…';
  await _db.ref(`rooms/${G.code}/started`).set(true);
  launch();
}

/* ═══════════════════════════════════════════════════════════
   LAUNCH APP
═══════════════════════════════════════════════════════════ */
function launch() {
  if (_membersRef) _membersRef.off();
  $('onboarding').classList.add('gone');
  $('app').classList.add('on');
  populateApp();
  /* set up real-time listeners in the app */
  listenToMembers();
  listenToChat();
  listenToVideo();
}

function populateApp() {
  const members = Object.values(G.members).sort((a,b) => a.joinedAt - b.joinedAt);
  const cnt = members.length;

  ['hdr-code','mob-code','w-room'].forEach(id => { const el=$(id); if(el) el.textContent = G.code; });
  ['hdr-un','mob-un'].forEach(id => { const el=$(id); if(el) el.textContent = G.name; });
  ['hdr-av','mob-av'].forEach(id => { const el=$(id); if(el) el.textContent = G.init; });
  ['hdr-cnt','mob-vc-cnt'].forEach(id => { const el=$(id); if(el) el.textContent = cnt + ' in room'; });
  $('w-syn').textContent = cnt + ' members';

  const hr = new Date().getHours();
  $('l-greet').textContent = `GOOD ${hr<12?'MORNING':hr<17?'AFTERNOON':'EVENING'}, ${G.name.toUpperCase()}`;
  $('l-sub').textContent = cnt + ' friends connected · choose what to do';

  $('l-pips').innerHTML = members.map(m => `
    <div class="pip">
      <div class="pip-dot" style="background:${m.color}"></div>
      <span style="font-size:10px">${m.name === G.name ? m.name + ' (you)' : m.name}</span>
    </div>`).join('');

  buildVCTiles(members);
  buildMobVCTiles(members);
  seedChat(members);
}

/* ═══════════════════════════════════════════════════════════
   REAL-TIME: MEMBERS
═══════════════════════════════════════════════════════════ */
function listenToMembers() {
  _membersRef = _db.ref(`rooms/${G.code}/members`);
  _membersRef.on('value', snap => {
    if (!snap.exists()) return;
    G.members = snap.val() || {};
    const members = Object.values(G.members).sort((a,b) => a.joinedAt - b.joinedAt);
    const cnt = members.length;

    ['hdr-cnt','mob-vc-cnt'].forEach(id => { const el=$(id); if(el) el.textContent = cnt + ' in room'; });
    $('w-syn').textContent = cnt + ' members';
    $('l-sub').textContent = cnt + ' friends connected · choose what to do';
    $('l-pips').innerHTML = members.map(m => `
      <div class="pip">
        <div class="pip-dot" style="background:${m.color}"></div>
        <span style="font-size:10px">${m.name === G.name ? m.name + ' (you)' : m.name}</span>
      </div>`).join('');
    buildVCTiles(members);
    buildMobVCTiles(members);
  });
}

/* ═══════════════════════════════════════════════════════════
   VIDEO CALL TILES
═══════════════════════════════════════════════════════════ */
let _speakTimer;
function buildVCTiles(members) {
  clearInterval(_speakTimer);
  const tiles = $('vc-tiles');
  tiles.innerHTML = members.map((m, i) => `
    <div class="vt${m.name===G.name?' you':''}" id="vt${i}">
      <div style="width:100%;height:100%;background:${m.bg};display:flex;align-items:center;justify-content:center">
        <div class="vt-av" style="background:transparent;color:${m.color}">${m.init}</div>
      </div>
      <div class="vt-bar">
        <span class="vt-name">${m.name===G.name?'You':m.name}</span>
        <div class="vt-icons">
          <svg class="vi" viewBox="0 0 16 16"><rect x="5" y="1" width="6" height="9" rx="3" fill="${m.name===G.name?'#00e5c3':'#4a4a72'}"/><path d="M3 8a5 5 0 0010 0" stroke="${m.name===G.name?'#00e5c3':'#4a4a72'}" fill="none" stroke-width="1.5"/><line x1="8" y1="13" x2="8" y2="15" stroke="${m.name===G.name?'#00e5c3':'#4a4a72'}" stroke-width="1.5"/></svg>
          <svg class="vi" viewBox="0 0 16 16"><rect x="1" y="4" width="9" height="8" rx="1.5" stroke="${m.name===G.name?'#00e5c3':'#4a4a72'}" stroke-width="1.5" fill="none"/><path d="M10 6.5l4-2v7l-4-2" stroke="${m.name===G.name?'#00e5c3':'#4a4a72'}" stroke-width="1.5" fill="none"/></svg>
        </div>
      </div>
    </div>`).join('');
  let si = members.length > 1 ? 1 : 0;
  _speakTimer = setInterval(() => {
    document.querySelectorAll('#vc-tiles .vt').forEach(t => t.classList.remove('spk'));
    const t = $('vt' + si); if (t) t.classList.add('spk');
    si = (si + 1) % members.length;
  }, 2800);
}

function buildMobVCTiles(members) {
  const strip = $('vc-mob-tiles');
  strip.innerHTML = members.map((m, i) => `
    <div class="vt-mob${m.name===G.name?' you':''}" id="vtm${i}">
      <div style="font-size:11px;font-weight:700;color:${m.color};font-family:var(--orb)">${m.init}</div>
      <div class="vt-mob-name">${m.name===G.name?'You':m.name}</div>
    </div>`).join('');
  let si = members.length > 1 ? 1 : 0;
  setInterval(() => {
    document.querySelectorAll('.vt-mob').forEach(t => t.classList.remove('spk'));
    const t = $('vtm' + si); if (t) t.classList.add('spk');
    si = (si + 1) % members.length;
  }, 2800);
}

function toggleVC(btn) { btn.classList.toggle('on'); }

/* ═══════════════════════════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════════════════════════ */
function goTabByName(name) {
  const map = {lobby:0, watch:1, games:2};
  const tabs = document.querySelectorAll('.hdr-tab');
  goTab(name, tabs[map[name]]);
}
function goTab(name, tabEl) {
  document.querySelectorAll('.app-scr').forEach(s => s.classList.remove('on'));
  document.querySelectorAll('.hdr-tab').forEach(t => t.classList.remove('on'));
  $(   'scr-' + name).classList.add('on');
  if (tabEl) tabEl.classList.add('on');
  if (name === 'games') closeGame();
  closeMobChat();
  $('chat-fab').style.display = name === 'watch' && isMob() ? 'flex' : 'none';
}
function goTabMob(name, tabEl) {
  document.querySelectorAll('.app-scr').forEach(s => s.classList.remove('on'));
  document.querySelectorAll('.bn-tab').forEach(t => t.classList.remove('on'));
  $('scr-' + name).classList.add('on');
  if (tabEl) tabEl.classList.add('on');
  if (name === 'games') closeGame();
  closeMobChat();
  $('chat-fab').style.display = name === 'watch' ? 'flex' : 'none';
}

/* ═══════════════════════════════════════════════════════════
   WATCH PARTY — VIDEO SYNC
═══════════════════════════════════════════════════════════ */
function loadVid() {
  const url = $('yt-url').value.trim();
  const m = url.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
  if (!m) { shake('yt-url'); toast('Invalid YouTube URL', 'error'); return; }
  const ytId = m[1];
  /* push to Firebase so all members see it */
  _db.ref(`rooms/${G.code}/video`).set({
    ytId, updatedBy: G.userId, updatedAt: Date.now()
  });
}

function loadVideoById(ytId) {
  $('player-box').innerHTML = `
    <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--pink),var(--violet),var(--blue));z-index:2"></div>
    <iframe src="https://www.youtube.com/embed/${ytId}?autoplay=1&rel=0&modestbranding=1"
      allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowfullscreen></iframe>`;
  $('w-status').textContent = '● LIVE';
  $('w-status').style.color = 'var(--pink)';
}

function listenToVideo() {
  _videoRef = _db.ref(`rooms/${G.code}/video`);
  _videoRef.on('value', snap => {
    if (!snap.exists()) return;
    const data = snap.val();
    if (!data.ytId) return;
    loadVideoById(data.ytId);
    if (data.updatedBy !== G.userId) {
      const who = Object.values(G.members).find(m => /* can't easily map userId to name this way */true);
      addChatMsgLocal('System', 'Video synced for everyone!', 'var(--teal)');
    }
  });
}

/* ═══════════════════════════════════════════════════════════
   CHAT — REAL-TIME
═══════════════════════════════════════════════════════════ */
function collapseChat()  { G.chatCollapsed=true;  $('chat-panel').classList.add('collapsed');    $('chat-mini-bar').classList.add('show'); }
function expandChat()    { G.chatCollapsed=false; $('chat-panel').classList.remove('collapsed'); $('chat-mini-bar').classList.remove('show'); }
function openMobChat()   { $('chat-drawer').classList.add('open'); }
function closeMobChat()  { $('chat-drawer').classList.remove('open'); }

function seedChat(members) {
  /* only send welcome from host so everyone gets it once */
  if (G.isHost) {
    _db.ref(`rooms/${G.code}/chat`).push({
      user: 'System', text: 'Party started! Room: ' + G.code,
      color: 'var(--teal)', ts: Date.now()
    });
  }
}

function listenToChat() {
  _chatRef = _db.ref(`rooms/${G.code}/chat`).limitToLast(80);
  _chatRef.on('child_added', snap => {
    const msg = snap.val();
    addChatMsgLocal(msg.user, msg.text, msg.color);
  });
}

function addChatMsgLocal(user, text, color) {
  const t = nowTime();
  const html = `<div style="animation:fadeIn .2s ease">
    <div><span class="cm-who" style="color:${color}">${user}</span><span class="cm-time">${t}</span></div>
    <div class="cm-text">${text}</div></div>`;
  ['wc-msgs','wc-msgs-mob'].forEach(id => {
    const b = $(id);
    if (b) { b.insertAdjacentHTML('beforeend', html); b.scrollTop = b.scrollHeight; }
  });
  $('chat-mini-preview').textContent = user + ': ' + text;
}

function sendChat() {
  const inp = $('wc-inp');
  if (!inp || !inp.value.trim()) return;
  _db.ref(`rooms/${G.code}/chat`).push({
    user: G.name, text: inp.value.trim(),
    color: G.color, ts: Date.now()
  });
  inp.value = '';
}
function sendChatMob() {
  const inp = $('wc-inp-mob');
  if (!inp || !inp.value.trim()) return;
  _db.ref(`rooms/${G.code}/chat`).push({
    user: G.name, text: inp.value.trim(),
    color: G.color, ts: Date.now()
  });
  inp.value = '';
}

/* ═══════════════════════════════════════════════════════════
   GAMES
═══════════════════════════════════════════════════════════ */
function openGame(id) {
  $('gz-lobby').style.display = 'none';
  if (id === 'ttt')   { initTTT();   $('gp-ttt').classList.add('on'); }
  if (id === 'hm')    { initHM();    $('gp-hm').classList.add('on'); }
  if (id === 'chess') { initChess(); $('gp-chess').classList.add('on'); }
}
function closeGame() {
  document.querySelectorAll('.gp').forEach(p => p.classList.remove('on'));
  $('gz-lobby').style.display = 'block';
}

/* ─── TTT ─── */
const TTT_L = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
let tB, tX, tR;
function initTTT() { tB=Array(9).fill(null); tX=true; tR=null; rTTT(); }
function tttChk(b) {
  for (const [a,c,d] of TTT_L) if (b[a] && b[a]===b[c] && b[a]===b[d]) return {w:b[a],l:[a,c,d]};
  if (b.every(Boolean)) return {w:'draw',l:[]};
  return null;
}
function tttClick(i) {
  if (tB[i] || tR) return;
  tB[i] = tX ? 'X' : 'O';
  tR = tttChk(tB);
  if (tR) { if(tR.w==='draw') G.tttScores.D++; else G.tttScores[tR.w]++; }
  tX = !tX; rTTT();
}
function rTTT() {
  const st = tR ? (tR.w==='draw' ? "IT'S A DRAW!" : `PLAYER ${tR.w} WINS!`) : `PLAYER ${tX?'X':'O'}'S TURN`;
  const sc = tR ? (tR.w==='draw'?'var(--muted)':tR.w==='X'?'var(--pink)':'var(--teal)') : (tX?'var(--pink)':'var(--teal)');
  const wl = tR?.l || [];
  $('tsx').textContent = G.tttScores.X; $('tso').textContent = G.tttScores.O; $('tsd').textContent = G.tttScores.D;
  const se = $('ttt-st'); se.textContent = st; se.style.color = sc;
  $('ttt-bd').innerHTML = tB.map((c,i) => {
    const win=wl.includes(i), cc=c==='X'?'var(--pink)':'var(--teal)';
    return `<div class="ttt-cell${c?' taken':''}${win?' wc':''}" onclick="tttClick(${i})"
      style="color:${c?cc:'transparent'};background:${win?(c==='X'?'rgba(255,45,120,.1)':'rgba(0,229,195,.1)'):'var(--bg2)'};border-color:${win?cc:'var(--border)'};cursor:${c||tR?'default':'pointer'}">${c||''}</div>`;
  }).join('');
  $('ttt-ag').innerHTML = tR ? `<button class="btn btn-teal" style="font-size:10px" onclick="initTTT()">↺ PLAY AGAIN</button>` : '';
}

/* ─── HANGMAN ─── */
const HM_WDS=['JAVASCRIPT','ELEPHANT','MOUNTAIN','KEYBOARD','UNIVERSE','PENGUIN','CHOCOLATE','QUANTUM','SYMPHONY','BUTTERFLY','ASTRONAUT','LABYRINTH','TELESCOPE','ADVENTURE','ALGORITHM','WATERFALL','DINOSAUR','HURRICANE','COMPUTER','NEBULA','CRYSTAL','ZEPPELIN','PARADOX','ECLIPSE'];
const MXW=6; const ALP='ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
let hW, hG, hE;
function initHM() { hW=HM_WDS[Math.floor(Math.random()*HM_WDS.length)]; hG=new Set(); hE=0; rHM(); }
function hmK(l) {
  if (hG.has(l)) return;
  const won=hW.split('').every(c=>hG.has(c)), lost=hE>=MXW;
  if (won||lost) return;
  hG.add(l); if (!hW.includes(l)) hE++; rHM();
}
function drawHM(e) {
  const s = $('hm-svg');
  s.innerHTML = `<line x1="16" y1="160" x2="174" y2="160" stroke="#00e5c3" stroke-width="2"/>
    <line x1="52" y1="160" x2="52" y2="8" stroke="#00e5c3" stroke-width="2"/>
    <line x1="52" y1="8" x2="112" y2="8" stroke="#00e5c3" stroke-width="2"/>
    <line x1="112" y1="8" x2="112" y2="22" stroke="#00e5c3" stroke-width="2"/>
    ${[`<circle cx="112" cy="36" r="14" stroke="#ff2d78" stroke-width="2.5" fill="none"/>`,
       `<line x1="112" y1="50" x2="112" y2="96" stroke="#ff2d78" stroke-width="2.5"/>`,
       `<line x1="112" y1="64" x2="90" y2="84" stroke="#ff2d78" stroke-width="2.5"/>`,
       `<line x1="112" y1="64" x2="134" y2="84" stroke="#ff2d78" stroke-width="2.5"/>`,
       `<line x1="112" y1="96" x2="90" y2="124" stroke="#ff2d78" stroke-width="2.5"/>`,
       `<line x1="112" y1="96" x2="134" y2="124" stroke="#ff2d78" stroke-width="2.5"/>`].slice(0,e).join('')}`;
}
function rHM() {
  drawHM(hE);
  const won=hW.split('').every(l=>hG.has(l)), lost=hE>=MXW;
  $('hm-wd').innerHTML = hW.split('').map(l => `<div class="l-box" style="border-color:${hG.has(l)?'var(--pink)':'var(--border)'};color:${hG.has(l)?'var(--text)':'transparent'}">${l}</div>`).join('');
  const st=$('hm-st'); st.textContent=won?'🎉 YOU WIN!':lost?'GAME OVER — WORD: '+hW:(MXW-hE)+' GUESSES REMAIN'; st.style.color=won?'var(--teal)':lost?'var(--pink)':'var(--muted2)';
  const pct=Math.round(((MXW-hE)/MXW)*100); const pf=$('hm-pf'); pf.style.width=pct+'%'; pf.style.background=hE>3?'var(--pink)':'var(--teal)';
  $('hm-pl').textContent = `ATTEMPTS LEFT: ${MXW-hE} / ${MXW}`;
  $('hm-kb').innerHTML = ALP.map(l => { const u=hG.has(l),h=u&&hW.includes(l),m=u&&!hW.includes(l);
    return `<button class="k${h?' hit':m?' miss':''}" onclick="hmK('${l}')" ${u||won||lost?'disabled':''}>${l}</button>`; }).join('');
  $('hm-ag').innerHTML = (won||lost) ? `<button class="btn btn-primary" style="font-size:10px" onclick="initHM()">↺ NEW WORD</button>` : '';
}

/* ─── CHESS ─── */
const CH_I=['br','bn','bb','bq','bk','bb','bn','br','bp','bp','bp','bp','bp','bp','bp','bp',null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,'wp','wp','wp','wp','wp','wp','wp','wp','wr','wn','wb','wq','wk','wb','wn','wr'];
const CH_S={wk:'♔',wq:'♕',wr:'♖',wb:'♗',wn:'♘',wp:'♙',bk:'♚',bq:'♛',br:'♜',bb:'♝',bn:'♞',bp:'♟'};
let cB,cS,cL,cT,cCp,cMv,cLst;
function initChess() {
  cB=[...CH_I];cS=null;cL=[];cT='w';cCp={w:[],b:[]};cMv=0;cLst=null;
  ['ch-rl','ch-fl'].forEach((id,i) => { const el=$(id); if(el){
    if(i===0)el.innerHTML=['8','7','6','5','4','3','2','1'].map(r=>`<span>${r}</span>`).join('');
    else el.innerHTML=['a','b','c','d','e','f','g','h'].map(f=>`<span>${f}</span>`).join('');
  }});
  rCh();
}
function chMvs(board,idx) {
  const p=board[idx]; if(!p) return [];
  const cl=p[0],tp=p[1],op=cl==='w'?'b':'w',row=Math.floor(idx/8),col=idx%8,mv=[];
  const slide=dirs=>{for(const[dr,dc]of dirs){let r=row+dr,c=col+dc;while(r>=0&&r<8&&c>=0&&c<8){const t=board[r*8+c];if(t){if(t[0]===op)mv.push(r*8+c);break;}mv.push(r*8+c);r+=dr;c+=dc;}}};
  const step=dirs=>{for(const[dr,dc]of dirs){const r=row+dr,c=col+dc;if(r>=0&&r<8&&c>=0&&c<8){const t=board[r*8+c];if(!t||t[0]===op)mv.push(r*8+c);}}};
  if(tp==='p'){const d=cl==='w'?-1:1,st2=cl==='w'?6:1,nr=row+d;
    if(nr>=0&&nr<8&&!board[nr*8+col]){mv.push(nr*8+col);if(row===st2&&!board[(row+2*d)*8+col])mv.push((row+2*d)*8+col);}
    for(const dc of[-1,1]){const nc=col+dc;if(nr>=0&&nr<8&&nc>=0&&nc<8&&board[nr*8+nc]?.[0]===op)mv.push(nr*8+nc);}}
  if(tp==='n')step([[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]);
  if(tp==='r')slide([[0,1],[0,-1],[1,0],[-1,0]]);
  if(tp==='b')slide([[1,1],[1,-1],[-1,1],[-1,-1]]);
  if(tp==='q')slide([[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]]);
  if(tp==='k')step([[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]);
  return mv;
}
function chClick(idx) {
  if(cS===null){if(cB[idx]?.[0]===cT){cS=idx;cL=chMvs(cB,idx);}}
  else{if(cL.includes(idx)){const nb=[...cB],mv=nb[cS],cp=nb[idx];nb[idx]=mv;nb[cS]=null;
    if(mv==='wp'&&Math.floor(idx/8)===0)nb[idx]='wq';if(mv==='bp'&&Math.floor(idx/8)===7)nb[idx]='bq';
    cB=nb;if(cp)cCp[cT].push(cp);cT=cT==='w'?'b':'w';cLst=[cS,idx];cMv++;cS=null;cL=[];
  }else if(cB[idx]?.[0]===cT){cS=idx;cL=chMvs(cB,idx);}else{cS=null;cL=[];}}
  rCh();
}
function rCh() {
  $('ch-bd').innerHTML=cB.map((p,i)=>{
    const row=Math.floor(i/8),col=i%8,lt=(row+col)%2===0,isSel=cS===i,isL=cL.includes(i),isCp=isL&&!!p,isLst=cLst&&(i===cLst[0]||i===cLst[1]);
    let cls=`sq ${lt?'ls':'ds'}`;if(isSel)cls+=' sel';else if(isLst)cls+=' lm';if(isL&&!p)cls+=' leg';if(isCp)cls+=' cap';
    return`<div class="${cls}" onclick="chClick(${i})">${p?`<span class="cp ${p[0]==='w'?'w':'b'}">${CH_S[p]}</span>`:''}</div>`;
  }).join('');
  $('ch-dot').style.background=cT==='w'?'#f2f2ff':'#111827';
  $('ch-tn').textContent=cT==='w'?'WHITE':'BLACK';
  $('ch-mv').textContent=cMv;
  const fmt=arr=>arr.length?arr.map(p=>`<span style="opacity:.75">${CH_S[p]}</span>`).join(''):'<span style="font-size:10px;color:var(--muted)">—</span>';
  $('ch-wc').innerHTML=fmt(cCp.w); $('ch-bc').innerHTML=fmt(cCp.b);
}

/* ═══════════════════════════════════════════════════════════
   PWA + INIT
═══════════════════════════════════════════════════════════ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(e => console.log('SW:', e));
  });
}

window.addEventListener('DOMContentLoaded', () => {
  /* check for ?join=SYNC-XXXX in URL */
  const params = new URLSearchParams(window.location.search);
  const joinCode = params.get('join');
  if (joinCode) {
    const inp = $('code-inp');
    if (inp) { inp.value = joinCode.toUpperCase(); }
    /* switch to join tab after name entry */
    window._autoJoinCode = joinCode.toUpperCase();
  }

  if (!checkFirebaseConfig()) return;
});

/* expose functions to HTML onclick */
window.onName=onName; window.go2=go2; window.toggleJoinBox=toggleJoinBox; window.fmtCode=fmtCode;
window.doCreate=doCreate; window.doJoin=doJoin; window.copyRoomCode=copyRoomCode; window.copyInviteLink=copyInviteLink;
window.openWR=openWR; window.hostStart=hostStart;
window.goTab=goTab; window.goTabByName=goTabByName; window.goTabMob=goTabMob;
window.loadVid=loadVid; window.sendChat=sendChat; window.sendChatMob=sendChatMob;
window.collapseChat=collapseChat; window.expandChat=expandChat; window.openMobChat=openMobChat; window.closeMobChat=closeMobChat;
window.openGame=openGame; window.closeGame=closeGame;
window.tttClick=tttClick; window.initTTT=initTTT;
window.hmK=hmK; window.initHM=initHM;
window.chClick=chClick; window.initChess=initChess;
window.toggleVC=toggleVC;
