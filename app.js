/* ═══════════════════════════════════════════════════════════
   SYNCZONE  ·  app.js
   WebRTC video/audio  +  Firebase signaling + game sync
═══════════════════════════════════════════════════════════ */

/* ── COLOURS ── */
const PALETTE = ['#c4b5fd','#ff2d78','#fbbf24','#38bdf8',
                 '#00e5c3','#fb923c','#a3e635','#f97316'];
const BG_MAP  = {
  '#c4b5fd':'rgba(139,92,246,.22)', '#ff2d78':'rgba(255,45,120,.18)',
  '#fbbf24':'rgba(251,191,36,.18)', '#38bdf8':'rgba(56,189,248,.18)',
  '#00e5c3':'rgba(0,229,195,.18)',  '#fb923c':'rgba(251,146,60,.18)',
  '#a3e635':'rgba(163,230,53,.18)', '#f97316':'rgba(249,115,22,.18)',
};

/* ── APP STATE ── */
let G = {
  userId : null,   // unique per session
  name   : '',
  code   : '',
  isHost : false,
  color  : '',
  bg     : '',
  init   : '',
  members: {},     // uid → {name,init,color,bg,isHost,joinedAt}
  tttScores: {X:0, O:0, D:0},
  chatCollapsed: false,
};

/* ── FIREBASE REFS ── */
let _db;
let _membersRef, _chatRef, _videoRef;
let _gameTTTRef, _gameHMRef, _gameChessRef;

/* ── WEBRTC ──
   For each remote peer we keep one RTCPeerConnection.
   Signaling path:
     rooms/{code}/signals/{myId}/{theirId}/offer   ← I write when I offer
     rooms/{code}/signals/{myId}/{theirId}/answer  ← they write when they answer
     rooms/{code}/signals/{myId}/{theirId}/ice     ← my ICE candidates
   So "rooms/{code}/signals/{theirId}" is where I listen for incoming offers.
*/
let localStream = null;
const pcs       = {};   // theirId → RTCPeerConnection
const remotes   = {};   // theirId → MediaStream

const ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
};

/* ── GAME SYNC FLAGS ── */
// prevent echo: when I push state I don't re-apply my own write
let skipTTT = false, skipHM = false, skipChess = false;

/* ── PENDING GAME STATE ── */
// store latest remote state even if panel not open yet
let pendingTTT = null, pendingHM = null, pendingChess = null;

/* ═══════════════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);
const isMob = () => window.innerWidth < 768;
const nowTime = () =>
  new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});

function uid6() {
  return Math.random().toString(36).slice(2,8) +
         Math.random().toString(36).slice(2,8);
}

function shake(id) {
  const el = $(id); if (!el) return;
  el.classList.add('error');
  setTimeout(() => el.classList.remove('error'), 700);
}

function toast(msg, type = 'info') {
  let t = $('sz-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'sz-toast';
    Object.assign(t.style, {
      position:'fixed', bottom:'72px', left:'50%',
      transform:'translateX(-50%)', zIndex:'9999',
      fontFamily:'var(--orb)', fontSize:'10px',
      fontWeight:'700', letterSpacing:'1.5px',
      padding:'10px 22px', border:'1px solid',
      pointerEvents:'none', transition:'opacity .3s',
      whiteSpace:'nowrap', maxWidth:'90vw',
      overflow:'hidden', textOverflow:'ellipsis',
    });
    document.body.appendChild(t);
  }
  const c = {info:'var(--teal)', error:'var(--pink)', success:'var(--teal)'};
  t.textContent = msg;
  t.style.background = 'var(--bg2)';
  t.style.color = c[type] || c.info;
  t.style.borderColor = c[type] || c.info;
  t.style.opacity = '1';
  clearTimeout(t._tid);
  t._tid = setTimeout(() => (t.style.opacity = '0'), 3200);
}

/* ═══════════════════════════════════════════════════════════
   FIREBASE INIT
═══════════════════════════════════════════════════════════ */
function checkFirebaseConfig() {
  if (!FIREBASE_CONFIG.apiKey ||
      FIREBASE_CONFIG.apiKey.startsWith('REPLACE')) {
    $('config-overlay').style.display = 'flex';
    return false;
  }
  try {
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
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
  ['os0','os1','os2','os3'].forEach((id,i) =>
    $(id).className = 'ob-step' +
      (i < n ? ' done' : i === n ? ' on' : ''));
}
function showS(id) {
  document.querySelectorAll('.ob-scr')
    .forEach(s => s.classList.remove('on'));
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
  G.name   = v;
  G.userId = uid6();
  G.init   = v.slice(0, 2).toUpperCase();
  showS('s2'); setStep(1);
}

function toggleJoinBox() {
  const b = $('join-box');
  b.style.display = b.style.display === 'none' ? 'block' : 'none';
  if (b.style.display !== 'none') $('code-inp').focus();
}

function fmtCode(el) {
  let v = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (v.length > 4) v = v.slice(0, 4) + '-' + v.slice(4, 8);
  el.value = v;
}

/* ── CREATE ROOM ── */
async function doCreate() {
  const btn = $('create-btn');
  btn.textContent = 'CREATING…'; btn.disabled = true;
  G.isHost = true;
  G.code   = 'SYNC-' + Math.floor(1000 + Math.random() * 9000);
  G.color  = PALETTE[0];
  G.bg     = BG_MAP[G.color];

  try {
    const me = {
      name: G.name, init: G.init,
      color: G.color, bg: G.bg,
      isHost: true, joinedAt: Date.now(),
    };
    await _db.ref(`rooms/${G.code}`).set({
      meta    : { host: G.userId, created: Date.now() },
      started : false,
      members : { [G.userId]: me },
    });
    _db.ref(`rooms/${G.code}/members/${G.userId}`)
       .onDisconnect().remove();

    $('disp-rc').textContent  = G.code;
    $('share-link').textContent =
      window.location.origin + '/?join=' + G.code;
    $('wr-code-display').textContent = G.code;
    showS('s3'); setStep(2);
  } catch (e) {
    toast('Error creating room — check Firebase config.', 'error');
    console.error(e);
  }
  btn.textContent = 'CREATE →'; btn.disabled = false;
}

function copyRoomCode() {
  navigator.clipboard?.writeText(G.code).catch(() => {});
  const b = $('copy-btn');
  b.textContent = 'COPIED!';
  setTimeout(() => (b.textContent = 'COPY CODE'), 1500);
}
function copyInviteLink() {
  navigator.clipboard?.writeText(
    window.location.origin + '/?join=' + G.code).catch(() => {});
  const b = $('copy-link-btn');
  b.textContent = 'LINK COPIED!';
  setTimeout(() => (b.textContent = 'COPY INVITE LINK'), 1500);
}

function openWR() { startWaitingRoom(); showS('s4'); setStep(3); }

/* ── JOIN ROOM ── */
async function doJoin() {
  const code = $('code-inp').value.trim().toUpperCase();
  if (code.length < 8) { shake('code-inp'); return; }
  const btn = $('join-btn');
  btn.textContent = 'JOINING…'; btn.disabled = true;

  try {
    const snap = await _db.ref(`rooms/${code}`).once('value');
    if (!snap.exists()) {
      toast('Room not found. Check the code.', 'error');
      btn.textContent = 'JOIN ROOM →'; btn.disabled = false; return;
    }
    if (snap.val().started) {
      toast('This party already started.', 'error');
      btn.textContent = 'JOIN ROOM →'; btn.disabled = false; return;
    }
    const cnt   = Object.keys(snap.val().members || {}).length;
    G.color     = PALETTE[cnt % PALETTE.length];
    G.bg        = BG_MAP[G.color] || 'rgba(255,255,255,.1)';
    G.code      = code;
    G.isHost    = false;

    const me = {
      name: G.name, init: G.init,
      color: G.color, bg: G.bg,
      isHost: false, joinedAt: Date.now(),
    };
    await _db.ref(`rooms/${code}/members/${G.userId}`).set(me);
    _db.ref(`rooms/${code}/members/${G.userId}`)
       .onDisconnect().remove();

    $('wr-code-display').textContent = G.code;
    startWaitingRoom(); showS('s4'); setStep(3);
  } catch (e) {
    toast('Error joining room.', 'error'); console.error(e);
  }
  btn.textContent = 'JOIN ROOM →'; btn.disabled = false;
}

/* ═══════════════════════════════════════════════════════════
   WAITING ROOM
═══════════════════════════════════════════════════════════ */
function startWaitingRoom() {
  _membersRef = _db.ref(`rooms/${G.code}/members`);
  _membersRef.on('value', snap => {
    if (!snap.exists()) return;
    G.members = snap.val() || {};
    renderWaitingTiles();
  });

  if (!G.isHost) {
    _db.ref(`rooms/${G.code}/started`).on('value', snap => {
      if (snap.val() === true) launch();
    });
  }

  $('wr-btns').innerHTML = G.isHost
    ? `<button class="btn btn-primary" id="start-btn"
         onclick="hostStart()" style="min-width:160px;font-size:10px">
         START PARTY →</button>
       <button class="btn btn-ghost" onclick="copyRoomCode()">
         COPY CODE</button>`
    : `<p style="font-size:11px;color:var(--muted)">
         Waiting for host to start the party…</p>`;
}

function renderWaitingTiles() {
  const list = Object.entries(G.members)
    .sort((a, b) => a[1].joinedAt - b[1].joinedAt);

  $('wr-grid').innerHTML = list.map(([id, m]) => `
    <div class="w-tile ${m.isHost ? 'you' : 'joined'}" id="wt-${id}">
      <div class="wt-av" style="background:${m.bg};color:${m.color}">
        ${m.init}</div>
      <div style="font-size:11px;font-weight:500">
        ${id === G.userId ? m.name + ' (you)' : m.name}</div>
      <div style="font-family:var(--orb);font-size:8px;
           letter-spacing:1.5px;
           color:${m.isHost ? '#c4b5fd' : 'var(--teal)'}">
        ${m.isHost ? 'HOST' : 'JOINED ✓'}</div>
      ${m.isHost
        ? `<div class="wt-badge"
               style="color:#c4b5fd;border-color:rgba(139,92,246,.35)">
               YOU</div>`
        : ''}
    </div>`).join('');

  const n = list.length;
  $('wr-sub').textContent = n <= 1
    ? 'Waiting for friends to join…'
    : `${n} people here — ${G.isHost
        ? 'start when ready ↓' : 'waiting for host…'}`;
}

async function hostStart() {
  $('start-btn').disabled  = true;
  $('start-btn').textContent = 'STARTING…';
  await _db.ref(`rooms/${G.code}/started`).set(true);
  launch();
}

/* ═══════════════════════════════════════════════════════════
   LOCAL MEDIA
═══════════════════════════════════════════════════════════ */
async function initLocalStream() {
  /* try video+audio, fall back to audio-only, then nothing */
  for (const constraints of [
    { video: { width:640, height:480 }, audio: true },
    { audio: true },
  ]) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia(constraints);
      const hasVideo = localStream.getVideoTracks().length > 0;
      toast(hasVideo ? 'Camera & mic ready ✓' : 'Mic ready (no camera) ✓',
            'success');
      return;
    } catch (_) { /* try next */ }
  }
  toast('No camera/mic — check browser permissions', 'error');
}

function showLocalVideo() {
  const tile = $('vt-' + G.userId);
  if (!tile || !localStream) return;

  /* remove stale video if any */
  tile.querySelectorAll('video').forEach(v => v.remove());

  const vid = document.createElement('video');
  vid.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1;';
  vid.autoplay = true; vid.muted = true; vid.playsInline = true;
  vid.srcObject = localStream;
  tile.prepend(vid);

  const bg = tile.querySelector('.vt-bg');
  if (bg) {
    vid.onplaying = () => (bg.style.display = 'none');
  }
}

/* ═══════════════════════════════════════════════════════════
   WEBRTC SIGNALING
   Path layout (per PAIR, per direction):
     signals/{calleeId}/{callerId}/offer   ← callerID writes offer
     signals/{calleeId}/{callerId}/answer  ← callee writes answer
     signals/{calleeId}/{callerId}/callerIce  ← caller writes ICE
     signals/{callerId}/{calleeId}/calleeIce  ← callee writes ICE
═══════════════════════════════════════════════════════════ */

/* Create or return existing PC for a peer */
function makePc(theirId) {
  if (pcs[theirId]) return pcs[theirId];

  const pc = new RTCPeerConnection(ICE);
  pcs[theirId] = pc;

  /* attach our tracks */
  if (localStream) {
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  }

  /* receive remote tracks */
  pc.ontrack = e => {
    let stream = remotes[theirId];
    if (!stream) { stream = new MediaStream(); remotes[theirId] = stream; }
    e.streams[0]
      ? (remotes[theirId] = e.streams[0])
      : stream.addTrack(e.track);
    showRemoteVideo(theirId, remotes[theirId]);
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'disconnected' ||
        pc.connectionState === 'failed') {
      pc.close();
      delete pcs[theirId];
      delete remotes[theirId];
      removeRemoteVideo(theirId);
    }
  };

  return pc;
}

/* ── OFFER (we call them) ── */
async function callPeer(theirId) {
  if (pcs[theirId]) return;           // already connected
  const pc    = makePc(theirId);
  const sigRef = _db.ref(
    `rooms/${G.code}/signals/${theirId}/${G.userId}`);

  /* send ICE candidates to them */
  pc.onicecandidate = e => {
    if (e.candidate) {
      sigRef.child('callerIce').push(e.candidate.toJSON());
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await sigRef.child('offer').set({ sdp: offer.sdp, type: offer.type });

  /* listen for their answer */
  sigRef.child('answer').on('value', async snap => {
    if (!snap.exists() || pc.currentRemoteDescription) return;
    await pc.setRemoteDescription(
      new RTCSessionDescription(snap.val())).catch(console.warn);
  });

  /* listen for their (callee) ICE */
  _db.ref(`rooms/${G.code}/signals/${G.userId}/${theirId}/calleeIce`)
     .on('child_added', snap => {
       pc.addIceCandidate(
         new RTCIceCandidate(snap.val())).catch(console.warn);
     });
}

/* ── ANSWER (they called us) ── */
async function answerPeer(theirId, offerData) {
  if (pcs[theirId]) return;
  const pc      = makePc(theirId);
  const sigRef  = _db.ref(
    `rooms/${G.code}/signals/${G.userId}/${theirId}`);

  /* send ICE candidates to them */
  pc.onicecandidate = e => {
    if (e.candidate) {
      sigRef.child('calleeIce').push(e.candidate.toJSON());
    }
  };

  await pc.setRemoteDescription(
    new RTCSessionDescription(offerData)).catch(console.warn);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  /* write answer where caller is listening */
  await _db.ref(
    `rooms/${G.code}/signals/${theirId}/${G.userId}/answer`)
    .set({ sdp: answer.sdp, type: answer.type });

  /* listen for caller's ICE */
  _db.ref(`rooms/${G.code}/signals/${G.userId}/${theirId}/callerIce`)
     .on('child_added', snap => {
       pc.addIceCandidate(
         new RTCIceCandidate(snap.val())).catch(console.warn);
     });
}

/* ── WATCH FOR INCOMING OFFERS directed at ME ── */
function listenForOffers() {
  /* signals/{MY_ID}/{ANY_CALLER_ID}/offer  →  answer them */
  _db.ref(`rooms/${G.code}/signals/${G.userId}`)
     .on('child_added', snap => {
       const callerId = snap.key;
       const data     = snap.val();
       if (data && data.offer && !pcs[callerId]) {
         answerPeer(callerId, data.offer);
       }
     });

  _db.ref(`rooms/${G.code}/signals/${G.userId}`)
     .on('child_changed', snap => {
       const callerId = snap.key;
       const data     = snap.val();
       if (data && data.offer && !pcs[callerId]) {
         answerPeer(callerId, data.offer);
       }
     });
}

/* ── CALL ALL CURRENT MEMBERS ── */
function callAllPeers() {
  Object.keys(G.members).forEach(id => {
    if (id !== G.userId) callPeer(id);
  });
}

/* ── SHOW REMOTE VIDEO IN TILE ── */
function showRemoteVideo(theirId, stream) {
  const tile = $('vt-' + theirId);
  if (!tile) return;
  tile.querySelectorAll('video').forEach(v => v.remove());

  const vid = document.createElement('video');
  vid.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1;';
  vid.autoplay = true; vid.playsInline = true;
  vid.srcObject = stream;
  tile.prepend(vid);

  const bg = tile.querySelector('.vt-bg');
  if (bg) vid.onplaying = () => (bg.style.display = 'none');
}

function removeRemoteVideo(theirId) {
  const tile = $('vt-' + theirId);
  if (!tile) return;
  tile.querySelectorAll('video').forEach(v => v.remove());
  const bg = tile.querySelector('.vt-bg');
  if (bg) bg.style.display = 'flex';
}

/* ═══════════════════════════════════════════════════════════
   LAUNCH
═══════════════════════════════════════════════════════════ */
async function launch() {
  /* detach waiting-room listeners */
  if (_membersRef) { _membersRef.off(); _membersRef = null; }

  $('onboarding').classList.add('gone');
  $('app').classList.add('on');

  await initLocalStream();   // ask browser for camera/mic

  populateApp();
  listenToMembers();
  listenToChat();
  listenToVideo();
  listenForOffers();
  callAllPeers();
  listenToAllGames();

  setTimeout(showLocalVideo, 500);
}

/* ═══════════════════════════════════════════════════════════
   POPULATE APP
═══════════════════════════════════════════════════════════ */
function populateApp() {
  const list = sortedMembers();
  const cnt  = list.length;

  ['hdr-code','mob-code','w-room'].forEach(id => {
    const el = $(id); if (el) el.textContent = G.code;
  });
  ['hdr-un','mob-un'].forEach(id => {
    const el = $(id); if (el) el.textContent = G.name;
  });
  ['hdr-av','mob-av'].forEach(id => {
    const el = $(id); if (el) el.textContent = G.init;
  });
  ['hdr-cnt','mob-vc-cnt'].forEach(id => {
    const el = $(id); if (el) el.textContent = cnt + ' in room';
  });
  $('w-syn').textContent = cnt + ' members';

  const hr = new Date().getHours();
  $('l-greet').textContent =
    `GOOD ${hr<12?'MORNING':hr<17?'AFTERNOON':'EVENING'}, ` +
    G.name.toUpperCase();
  $('l-sub').textContent =
    cnt + ' friends connected · choose what to do';
  renderPips(list);
  buildVCTiles(list);
  buildMobStrip(list);
  seedChat();
}

function sortedMembers() {
  return Object.entries(G.members)
    .sort((a, b) => a[1].joinedAt - b[1].joinedAt)
    .map(([id, m]) => ({ ...m, uid: id }));
}
function renderPips(list) {
  $('l-pips').innerHTML = list.map(m =>
    `<div class="pip">
       <div class="pip-dot" style="background:${m.color}"></div>
       <span style="font-size:10px">
         ${m.uid === G.userId ? m.name + ' (you)' : m.name}
       </span></div>`).join('');
}

/* ═══════════════════════════════════════════════════════════
   MEMBERS LIVE LISTENER
═══════════════════════════════════════════════════════════ */
function listenToMembers() {
  _membersRef = _db.ref(`rooms/${G.code}/members`);
  _membersRef.on('value', snap => {
    if (!snap.exists()) return;
    const prev = Object.keys(G.members);
    G.members  = snap.val() || {};
    const list = sortedMembers();
    const cnt  = list.length;

    ['hdr-cnt','mob-vc-cnt'].forEach(id => {
      const el = $(id); if (el) el.textContent = cnt + ' in room';
    });
    $('w-syn').textContent = cnt + ' members';
    $('l-sub').textContent =
      cnt + ' friends connected · choose what to do';
    renderPips(list);
    buildVCTiles(list);
    buildMobStrip(list);

    /* call anyone who joined after us */
    Object.keys(G.members)
      .filter(id => !prev.includes(id) && id !== G.userId)
      .forEach(id => callPeer(id));
  });
}

/* ═══════════════════════════════════════════════════════════
   VIDEO CALL TILES
═══════════════════════════════════════════════════════════ */
let _speakIdx = 0, _speakTimer;

function buildVCTiles(list) {
  clearInterval(_speakTimer);
  $('vc-tiles').innerHTML = list.map(m => {
    const isMe = m.uid === G.userId;
    return `
      <div class="vt${isMe ? ' you' : ''}" id="vt-${m.uid}">
        <div class="vt-bg"
             style="background:${m.bg}">
          <div class="vt-av" style="color:${m.color}">${m.init}</div>
        </div>
        <div class="vt-bar">
          <span class="vt-name">${isMe ? 'You' : m.name}</span>
          <div class="vt-icons">
            <svg class="vi" viewBox="0 0 16 16">
              <rect x="5" y="1" width="6" height="9" rx="3"
                fill="${isMe ? '#00e5c3' : '#4a4a72'}"/>
              <path d="M3 8a5 5 0 0010 0"
                stroke="${isMe ? '#00e5c3' : '#4a4a72'}"
                fill="none" stroke-width="1.5"/>
              <line x1="8" y1="13" x2="8" y2="15"
                stroke="${isMe ? '#00e5c3' : '#4a4a72'}"
                stroke-width="1.5"/>
            </svg>
            <svg class="vi" viewBox="0 0 16 16">
              <rect x="1" y="4" width="9" height="8" rx="1.5"
                stroke="${isMe ? '#00e5c3' : '#4a4a72'}"
                stroke-width="1.5" fill="none"/>
              <path d="M10 6.5l4-2v7l-4-2"
                stroke="${isMe ? '#00e5c3' : '#4a4a72'}"
                stroke-width="1.5" fill="none"/>
            </svg>
          </div>
        </div>
      </div>`;
  }).join('');

  /* reattach streams */
  setTimeout(() => {
    showLocalVideo();
    Object.entries(remotes).forEach(
      ([id, s]) => showRemoteVideo(id, s));
  }, 200);

  /* speaking indicator pulse */
  _speakIdx = list.length > 1 ? 1 : 0;
  _speakTimer = setInterval(() => {
    document.querySelectorAll('#vc-tiles .vt')
      .forEach(t => t.classList.remove('spk'));
    const all = document.querySelectorAll('#vc-tiles .vt');
    if (all[_speakIdx]) all[_speakIdx].classList.add('spk');
    _speakIdx = (_speakIdx + 1) % (list.length || 1);
  }, 2800);
}

function buildMobStrip(list) {
  $('vc-mob-tiles').innerHTML = list.map((m, i) => {
    const isMe = m.uid === G.userId;
    return `<div class="vt-mob${isMe ? ' you' : ''}" id="vtm-${i}">
      <div style="font-size:11px;font-weight:700;
           color:${m.color};font-family:var(--orb)">${m.init}</div>
      <div class="vt-mob-name">${isMe ? 'You' : m.name}</div>
    </div>`;
  }).join('');

  let msi = list.length > 1 ? 1 : 0;
  setInterval(() => {
    document.querySelectorAll('.vt-mob').forEach(t => t.classList.remove('spk'));
    const all = document.querySelectorAll('.vt-mob');
    if (all[msi]) all[msi].classList.add('spk');
    msi = (msi + 1) % (list.length || 1);
  }, 2800);
}

/* ── MIC / CAM CONTROLS ── */
function toggleVC(btn) {
  btn.classList.toggle('on');
  if (!localStream) return;
  const micIds = ['btn-mic','mob-mic'];
  const camIds = ['btn-cam','mob-cam'];
  const isOn   = btn.classList.contains('on');

  if (micIds.includes(btn.id)) {
    localStream.getAudioTracks().forEach(t => (t.enabled = isOn));
    /* sync sibling button */
    micIds.filter(id => id !== btn.id)
      .forEach(id => {
        const b = $(id);
        if (b) b.classList.toggle('on', isOn);
      });
  } else {
    localStream.getVideoTracks().forEach(t => (t.enabled = isOn));
    camIds.filter(id => id !== btn.id)
      .forEach(id => {
        const b = $(id);
        if (b) b.classList.toggle('on', isOn);
      });
    /* hide / show local video overlay */
    const tile = $('vt-' + G.userId);
    if (tile) {
      const vid = tile.querySelector('video');
      const bg  = tile.querySelector('.vt-bg');
      if (vid) vid.style.display = isOn ? 'block' : 'none';
      if (bg)  bg.style.display  = isOn ? 'none'  : 'flex';
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════════════════════════ */
function goTabByName(name) {
  const idx = {lobby:0, watch:1, games:2}[name];
  const tabs = document.querySelectorAll('.hdr-tab');
  goTab(name, tabs[idx]);
}
function goTab(name, tabEl) {
  document.querySelectorAll('.app-scr').forEach(s => s.classList.remove('on'));
  document.querySelectorAll('.hdr-tab').forEach(t => t.classList.remove('on'));
  $('scr-' + name).classList.add('on');
  if (tabEl) tabEl.classList.add('on');
  if (name === 'games') closeGame();
  closeMobChat();
  $('chat-fab').style.display =
    (name === 'watch' && isMob()) ? 'flex' : 'none';
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
  const m   = url.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
  if (!m) { shake('yt-url'); toast('Invalid YouTube URL', 'error'); return; }
  _db.ref(`rooms/${G.code}/video`)
     .set({ ytId: m[1], by: G.name, at: Date.now() });
}

function loadVideoById(ytId) {
  $('player-box').innerHTML = `
    <div style="position:absolute;top:0;left:0;right:0;height:2px;
         background:linear-gradient(90deg,var(--pink),var(--violet),var(--blue));
         z-index:2"></div>
    <iframe
      src="https://www.youtube.com/embed/${ytId}?autoplay=1&rel=0&modestbranding=1"
      allow="accelerometer;autoplay;clipboard-write;
             encrypted-media;gyroscope;picture-in-picture"
      allowfullscreen></iframe>`;
  $('w-status').textContent = '● LIVE';
  $('w-status').style.color = 'var(--pink)';
}

function listenToVideo() {
  _videoRef = _db.ref(`rooms/${G.code}/video`);
  _videoRef.on('value', snap => {
    if (!snap.exists()) return;
    const d = snap.val();
    if (!d.ytId) return;
    loadVideoById(d.ytId);
    addChatMsg('System',
      `${d.by} loaded a video — everyone is synced!`, 'var(--teal)');
  });
}

/* ═══════════════════════════════════════════════════════════
   CHAT
═══════════════════════════════════════════════════════════ */
function collapseChat() {
  G.chatCollapsed = true;
  $('chat-panel').classList.add('collapsed');
  $('chat-mini-bar').classList.add('show');
}
function expandChat() {
  G.chatCollapsed = false;
  $('chat-panel').classList.remove('collapsed');
  $('chat-mini-bar').classList.remove('show');
}
function openMobChat()  { $('chat-drawer').classList.add('open'); }
function closeMobChat() { $('chat-drawer').classList.remove('open'); }

function seedChat() {
  if (!G.isHost) return;
  _db.ref(`rooms/${G.code}/chat`).push({
    user:'System', text:'Party started! Room: ' + G.code,
    color:'var(--teal)', ts: Date.now(),
  });
}

function listenToChat() {
  _chatRef = _db.ref(`rooms/${G.code}/chat`).limitToLast(80);
  _chatRef.on('child_added', snap => {
    const d = snap.val();
    addChatMsg(d.user, d.text, d.color);
  });
}

function addChatMsg(user, text, color) {
  const t    = nowTime();
  const html = `
    <div style="animation:fadeIn .2s ease">
      <div>
        <span class="cm-who" style="color:${color}">${user}</span>
        <span class="cm-time">${t}</span>
      </div>
      <div class="cm-text">${text}</div>
    </div>`;
  ['wc-msgs','wc-msgs-mob'].forEach(id => {
    const b = $(id);
    if (b) { b.insertAdjacentHTML('beforeend', html); b.scrollTop = 99999; }
  });
  $('chat-mini-preview').textContent = `${user}: ${text}`;
}

function sendChat() {
  const inp = $('wc-inp');
  if (!inp?.value.trim()) return;
  _db.ref(`rooms/${G.code}/chat`).push({
    user: G.name, text: inp.value.trim(),
    color: G.color, ts: Date.now(),
  });
  inp.value = '';
}
function sendChatMob() {
  const inp = $('wc-inp-mob');
  if (!inp?.value.trim()) return;
  _db.ref(`rooms/${G.code}/chat`).push({
    user: G.name, text: inp.value.trim(),
    color: G.color, ts: Date.now(),
  });
  inp.value = '';
}

/* ═══════════════════════════════════════════════════════════
   GAME SYNC LISTENERS
   All three games share one pattern:
   1. On every local move  → push full state to Firebase
   2. On Firebase update   → store in pendingXXX
   3. When panel opens     → apply pending state immediately
   4. skip flag prevents echo from own writes
═══════════════════════════════════════════════════════════ */
function listenToAllGames() {
  _gameTTTRef   = _db.ref(`rooms/${G.code}/games/ttt`);
  _gameHMRef    = _db.ref(`rooms/${G.code}/games/hangman`);
  _gameChessRef = _db.ref(`rooms/${G.code}/games/chess`);

  _gameTTTRef.on('value', snap => {
    if (skipTTT || !snap.exists()) return;
    const s = snap.val();
    pendingTTT = s;
    if ($('gp-ttt')?.classList.contains('on')) applyTTT(s);
  });

  _gameHMRef.on('value', snap => {
    if (skipHM || !snap.exists()) return;
    const s = snap.val();
    pendingHM = s;
    if ($('gp-hm')?.classList.contains('on')) applyHM(s);
  });

  _gameChessRef.on('value', snap => {
    if (skipChess || !snap.exists()) return;
    const s = snap.val();
    pendingChess = s;
    if ($('gp-chess')?.classList.contains('on')) applyChess(s);
  });
}

function pushGameState(ref, data, flagSetter) {
  flagSetter(true);
  ref.set(data);
  setTimeout(() => flagSetter(false), 400);
}

/* ═══════════════════════════════════════════════════════════
   GAMES
═══════════════════════════════════════════════════════════ */
function openGame(id) {
  $('gz-lobby').style.display = 'none';
  if (id === 'ttt') {
    if (pendingTTT) { applyTTT(pendingTTT); }
    else             { initTTT(); }
    $('gp-ttt').classList.add('on');
  }
  if (id === 'hm') {
    if (pendingHM) { applyHM(pendingHM); }
    else            { initHM(); }
    $('gp-hm').classList.add('on');
  }
  if (id === 'chess') {
    if (pendingChess) { applyChess(pendingChess); }
    else               { initChess(); }
    $('gp-chess').classList.add('on');
  }
}

function closeGame() {
  document.querySelectorAll('.gp').forEach(p => p.classList.remove('on'));
  $('gz-lobby').style.display = 'block';
}

/* ─── TIC-TAC-TOE ─── */
const TLINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],
                [1,4,7],[2,5,8],[0,4,8],[2,4,6]];
let tB, tX, tR;

function initTTT() {
  tB = Array(9).fill(null); tX = true; tR = null;
  renderTTT();
  pushGameState(_gameTTTRef,
    { board:tB, xNext:tX, result:null, scores:G.tttScores },
    v => (skipTTT = v));
}

function tttCheck(b) {
  for (const [a,c,d] of TLINES)
    if (b[a] && b[a]===b[c] && b[a]===b[d])
      return { w:b[a], l:[a,c,d] };
  if (b.every(Boolean)) return { w:'draw', l:[] };
  return null;
}

function tttClick(i) {
  if (tB[i] || tR) return;
  tB[i] = tX ? 'X' : 'O';
  tR = tttCheck(tB);
  if (tR) {
    if (tR.w === 'draw') G.tttScores.D++;
    else G.tttScores[tR.w]++;
  }
  tX = !tX;
  renderTTT();
  pushGameState(_gameTTTRef,
    { board:tB, xNext:tX, result:tR?JSON.stringify(tR):null,
      scores:G.tttScores },
    v => (skipTTT = v));
}

function applyTTT(s) {
  tB = s.board || Array(9).fill(null);
  tX = s.xNext !== undefined ? s.xNext : true;
  tR = s.result ? JSON.parse(s.result) : null;
  if (s.scores) G.tttScores = s.scores;
  renderTTT();
}

function renderTTT() {
  const bd = $('ttt-bd'); if (!bd) return;
  const wl = tR?.l || [];
  const st = tR
    ? (tR.w==='draw' ? "IT'S A DRAW!" : `PLAYER ${tR.w} WINS!`)
    : `PLAYER ${tX?'X':'O'}'S TURN`;
  const sc = tR
    ? (tR.w==='draw' ? 'var(--muted)' :
       tR.w==='X' ? 'var(--pink)' : 'var(--teal)')
    : (tX ? 'var(--pink)' : 'var(--teal)');

  $('tsx').textContent = G.tttScores.X;
  $('tso').textContent = G.tttScores.O;
  $('tsd').textContent = G.tttScores.D;
  const se = $('ttt-st'); if (se) { se.textContent=st; se.style.color=sc; }

  bd.innerHTML = tB.map((c, i) => {
    const win = wl.includes(i);
    const cc  = c==='X' ? 'var(--pink)' : 'var(--teal)';
    return `<div class="ttt-cell${c?' taken':''}${win?' wc':''}"
      onclick="tttClick(${i})"
      style="color:${c ? cc : 'transparent'};
             background:${win
               ? (c==='X'
                  ? 'rgba(255,45,120,.1)'
                  : 'rgba(0,229,195,.1)')
               : 'var(--bg2)'};
             border-color:${win ? cc : 'var(--border)'};
             cursor:${c||tR ? 'default' : 'pointer'}"
    >${c||''}</div>`;
  }).join('');

  const ag = $('ttt-ag');
  if (ag) ag.innerHTML = tR
    ? `<button class="btn btn-teal" style="font-size:10px"
         onclick="initTTT()">↺ PLAY AGAIN</button>` : '';
}

/* ─── HANGMAN ─── */
const WORDS = [
  'JAVASCRIPT','ELEPHANT','MOUNTAIN','KEYBOARD','UNIVERSE','PENGUIN',
  'CHOCOLATE','QUANTUM','SYMPHONY','BUTTERFLY','ASTRONAUT','LABYRINTH',
  'TELESCOPE','ADVENTURE','ALGORITHM','WATERFALL','DINOSAUR','HURRICANE',
  'COMPUTER','NEBULA','CRYSTAL','ZEPPELIN','PARADOX','ECLIPSE',
];
const MAXW = 6;
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
let hW, hG, hE;

function initHM() {
  hW = WORDS[Math.floor(Math.random() * WORDS.length)];
  hG = new Set(); hE = 0;
  renderHM();
  pushGameState(_gameHMRef,
    { word:hW, guessed:[], wrong:0 },
    v => (skipHM = v));
}

function hmKey(l) {
  if (hG.has(l)) return;
  const won  = hW.split('').every(c => hG.has(c));
  const lost = hE >= MAXW;
  if (won || lost) return;
  hG.add(l);
  if (!hW.includes(l)) hE++;
  renderHM();
  pushGameState(_gameHMRef,
    { word:hW, guessed:[...hG], wrong:hE },
    v => (skipHM = v));
}

function applyHM(s) {
  hW = s.word || WORDS[0];
  hG = new Set(s.guessed || []);
  hE = s.wrong || 0;
  renderHM();
}

function drawGallows(e) {
  const s = $('hm-svg'); if (!s) return;
  s.innerHTML = `
    <line x1="16" y1="160" x2="174" y2="160"
      stroke="#00e5c3" stroke-width="2"/>
    <line x1="52" y1="160" x2="52" y2="8"
      stroke="#00e5c3" stroke-width="2"/>
    <line x1="52" y1="8"  x2="112" y2="8"
      stroke="#00e5c3" stroke-width="2"/>
    <line x1="112" y1="8" x2="112" y2="22"
      stroke="#00e5c3" stroke-width="2"/>
    ${[
      `<circle cx="112" cy="36" r="14"
        stroke="#ff2d78" stroke-width="2.5" fill="none"/>`,
      `<line x1="112" y1="50" x2="112" y2="96"
        stroke="#ff2d78" stroke-width="2.5"/>`,
      `<line x1="112" y1="64" x2="90"  y2="84"
        stroke="#ff2d78" stroke-width="2.5"/>`,
      `<line x1="112" y1="64" x2="134" y2="84"
        stroke="#ff2d78" stroke-width="2.5"/>`,
      `<line x1="112" y1="96" x2="90"  y2="124"
        stroke="#ff2d78" stroke-width="2.5"/>`,
      `<line x1="112" y1="96" x2="134" y2="124"
        stroke="#ff2d78" stroke-width="2.5"/>`,
    ].slice(0, e).join('')}`;
}

function renderHM() {
  const wd = $('hm-wd'); if (!wd) return;
  drawGallows(hE);
  const won  = hW.split('').every(l => hG.has(l));
  const lost = hE >= MAXW;

  wd.innerHTML = hW.split('').map(l =>
    `<div class="l-box"
       style="border-color:${hG.has(l)?'var(--pink)':'var(--border)'};
              color:${hG.has(l)?'var(--text)':'transparent'}">${l}</div>`
  ).join('');

  const st = $('hm-st');
  if (st) {
    st.textContent = won ? '🎉 YOU WIN!'
      : lost ? 'GAME OVER — WORD: ' + hW
      : (MAXW - hE) + ' GUESSES REMAIN';
    st.style.color = won ? 'var(--teal)' : lost ? 'var(--pink)' : 'var(--muted2)';
  }

  const pct = Math.round(((MAXW - hE) / MAXW) * 100);
  const pf  = $('hm-pf');
  if (pf) {
    pf.style.width      = pct + '%';
    pf.style.background = hE > 3 ? 'var(--pink)' : 'var(--teal)';
  }
  const pl = $('hm-pl');
  if (pl) pl.textContent = `ATTEMPTS LEFT: ${MAXW - hE} / ${MAXW}`;

  const kb = $('hm-kb');
  if (kb) kb.innerHTML = ALPHA.map(l => {
    const u = hG.has(l), h = u && hW.includes(l), m = u && !hW.includes(l);
    return `<button class="k${h?' hit':m?' miss':''}"
      onclick="hmKey('${l}')"
      ${u||won||lost ? 'disabled' : ''}>${l}</button>`;
  }).join('');

  const ag = $('hm-ag');
  if (ag) ag.innerHTML = (won || lost)
    ? `<button class="btn btn-primary" style="font-size:10px"
         onclick="initHM()">↺ NEW WORD</button>` : '';
}

/* ─── CHESS ─── */
const CH_INIT = [
  'br','bn','bb','bq','bk','bb','bn','br',
  'bp','bp','bp','bp','bp','bp','bp','bp',
  ...Array(32).fill(null),
  'wp','wp','wp','wp','wp','wp','wp','wp',
  'wr','wn','wb','wq','wk','wb','wn','wr',
];
const CH_SYM = {
  wk:'♔',wq:'♕',wr:'♖',wb:'♗',wn:'♘',wp:'♙',
  bk:'♚',bq:'♛',br:'♜',bb:'♝',bn:'♞',bp:'♟',
};
let cB, cSel, cLegal, cTurn, cCap, cMoveCount, cLastMove;

function initChess() {
  cB = [...CH_INIT]; cSel = null; cLegal = []; cTurn = 'w';
  cCap = {w:[], b:[]}; cMoveCount = 0; cLastMove = null;
  buildChessLabels();
  renderChess();
  pushGameState(_gameChessRef, chessSnapshot(), v => (skipChess = v));
}

function chessSnapshot() {
  return {
    board   : cB,
    turn    : cTurn,
    capW    : cCap.w,
    capB    : cCap.b,
    moves   : cMoveCount,
    last    : cLastMove,
  };
}

function applyChess(s) {
  cB         = s.board   || [...CH_INIT];
  cTurn      = s.turn    || 'w';
  cCap       = { w: s.capW || [], b: s.capB || [] };
  cMoveCount = s.moves   || 0;
  cLastMove  = s.last    || null;
  cSel       = null; cLegal = [];
  buildChessLabels();
  renderChess();
}

function buildChessLabels() {
  const rl = $('ch-rl'), fl = $('ch-fl');
  if (rl) rl.innerHTML =
    ['8','7','6','5','4','3','2','1']
      .map(r => `<span>${r}</span>`).join('');
  if (fl) fl.innerHTML =
    ['a','b','c','d','e','f','g','h']
      .map(f => `<span>${f}</span>`).join('');
}

function chMoves(board, idx) {
  const p = board[idx]; if (!p) return [];
  const cl=p[0], tp=p[1], op=cl==='w'?'b':'w';
  const row=Math.floor(idx/8), col=idx%8, mv=[];

  const slide = dirs => {
    for (const [dr,dc] of dirs) {
      let r=row+dr, c=col+dc;
      while (r>=0&&r<8&&c>=0&&c<8) {
        const t=board[r*8+c];
        if (t) { if (t[0]===op) mv.push(r*8+c); break; }
        mv.push(r*8+c); r+=dr; c+=dc;
      }
    }
  };
  const step = dirs => {
    for (const [dr,dc] of dirs) {
      const r=row+dr, c=col+dc;
      if (r>=0&&r<8&&c>=0&&c<8) {
        const t=board[r*8+c];
        if (!t||t[0]===op) mv.push(r*8+c);
      }
    }
  };

  if (tp==='p') {
    const d=cl==='w'?-1:1, start=cl==='w'?6:1, nr=row+d;
    if (nr>=0&&nr<8&&!board[nr*8+col]) {
      mv.push(nr*8+col);
      if (row===start && !board[(row+2*d)*8+col])
        mv.push((row+2*d)*8+col);
    }
    for (const dc of [-1,1]) {
      const nc=col+dc;
      if (nr>=0&&nr<8&&nc>=0&&nc<8&&board[nr*8+nc]?.[0]===op)
        mv.push(nr*8+nc);
    }
  }
  if (tp==='n') step([[-2,-1],[-2,1],[-1,-2],[-1,2],
                       [1,-2],[1,2],[2,-1],[2,1]]);
  if (tp==='r') slide([[0,1],[0,-1],[1,0],[-1,0]]);
  if (tp==='b') slide([[1,1],[1,-1],[-1,1],[-1,-1]]);
  if (tp==='q') slide([[0,1],[0,-1],[1,0],[-1,0],
                        [1,1],[1,-1],[-1,1],[-1,-1]]);
  if (tp==='k') step([[-1,-1],[-1,0],[-1,1],[0,-1],
                       [0,1],[1,-1],[1,0],[1,1]]);
  return mv;
}

function chClick(idx) {
  if (cSel === null) {
    if (cB[idx]?.[0] === cTurn) {
      cSel   = idx;
      cLegal = chMoves(cB, idx);
    }
  } else {
    if (cLegal.includes(idx)) {
      const nb=[...cB], moved=nb[cSel], cap=nb[idx];
      nb[idx]=moved; nb[cSel]=null;
      if (moved==='wp'&&Math.floor(idx/8)===0) nb[idx]='wq';
      if (moved==='bp'&&Math.floor(idx/8)===7) nb[idx]='bq';
      cB = nb;
      if (cap) cCap[cTurn].push(cap);
      cTurn = cTurn==='w' ? 'b' : 'w';
      cLastMove = [cSel, idx]; cMoveCount++;
      cSel = null; cLegal = [];
      renderChess();
      pushGameState(_gameChessRef, chessSnapshot(), v => (skipChess = v));
      return;
    }
    if (cB[idx]?.[0] === cTurn) {
      cSel   = idx;
      cLegal = chMoves(cB, idx);
    } else {
      cSel = null; cLegal = [];
    }
  }
  renderChess();
}

function renderChess() {
  const bd = $('ch-bd'); if (!bd) return;
  bd.innerHTML = cB.map((p, i) => {
    const row=Math.floor(i/8), col=i%8, lt=(row+col)%2===0;
    const isSel  = cSel===i;
    const isLeg  = cLegal.includes(i);
    const isCap  = isLeg && !!p;
    const isLast = cLastMove && (i===cLastMove[0]||i===cLastMove[1]);
    let cls = `sq ${lt?'ls':'ds'}`;
    if (isSel)       cls += ' sel';
    else if (isLast) cls += ' lm';
    if (isLeg && !p) cls += ' leg';
    if (isCap)       cls += ' cap';
    return `<div class="${cls}" onclick="chClick(${i})">
      ${p ? `<span class="cp ${p[0]==='w'?'w':'b'}">${CH_SYM[p]}</span>` : ''}
    </div>`;
  }).join('');

  const dot = $('ch-dot'), tn = $('ch-tn'), mv = $('ch-mv');
  if (dot) dot.style.background = cTurn==='w' ? '#f2f2ff' : '#111827';
  if (tn)  tn.textContent       = cTurn==='w' ? 'WHITE'  : 'BLACK';
  if (mv)  mv.textContent       = cMoveCount;

  const fmt = arr => arr.length
    ? arr.map(p => `<span style="opacity:.75">${CH_SYM[p]}</span>`).join('')
    : '<span style="font-size:10px;color:var(--muted)">—</span>';
  const wc = $('ch-wc'), bc = $('ch-bc');
  if (wc) wc.innerHTML = fmt(cCap.w);
  if (bc) bc.innerHTML = fmt(cCap.b);
}

/* ═══════════════════════════════════════════════════════════
   PWA + BOOT
═══════════════════════════════════════════════════════════ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () =>
    navigator.serviceWorker.register('/sw.js').catch(console.warn));
}

window.addEventListener('DOMContentLoaded', () => {
  /* auto-fill join code from URL param */
  const code = new URLSearchParams(window.location.search).get('join');
  if (code) {
    const ci = $('code-inp');
    if (ci) ci.value = code.toUpperCase();
    const jb = $('join-box');
    if (jb) jb.style.display = 'block';
  }
  checkFirebaseConfig();
});

/* ── EXPOSE TO HTML onclick ── */
window.onName=onName; window.go2=go2;
window.toggleJoinBox=toggleJoinBox; window.fmtCode=fmtCode;
window.doCreate=doCreate; window.doJoin=doJoin;
window.copyRoomCode=copyRoomCode; window.copyInviteLink=copyInviteLink;
window.openWR=openWR; window.hostStart=hostStart;
window.goTab=goTab; window.goTabByName=goTabByName;
window.goTabMob=goTabMob;
window.loadVid=loadVid;
window.sendChat=sendChat; window.sendChatMob=sendChatMob;
window.collapseChat=collapseChat; window.expandChat=expandChat;
window.openMobChat=openMobChat; window.closeMobChat=closeMobChat;
window.openGame=openGame; window.closeGame=closeGame;
window.tttClick=tttClick; window.initTTT=initTTT;
window.hmKey=hmKey; window.initHM=initHM;
window.chClick=chClick; window.initChess=initChess;
window.toggleVC=toggleVC;