/* ═══════════════════════════════════════════════════════════
   SYNCZONE  app.js
   Fixed: WebRTC signaling · turn-based games · YouTube sync
═══════════════════════════════════════════════════════════ */

/* ── COLOURS ── */
const PAL = ['#c4b5fd','#ff2d78','#fbbf24','#38bdf8','#00e5c3','#fb923c'];
const BGM  = {
  '#c4b5fd':'rgba(139,92,246,.22)','#ff2d78':'rgba(255,45,120,.18)',
  '#fbbf24':'rgba(251,191,36,.18)','#38bdf8':'rgba(56,189,248,.18)',
  '#00e5c3':'rgba(0,229,195,.18)', '#fb923c':'rgba(251,146,60,.18)',
};

/* ── STATE ── */
const G = {
  uid:'', name:'', code:'', isHost:false,
  color:'', bg:'', init:'',
  members:{},           // uid → {name,init,color,bg,isHost,joinedAt,index}
  tttScores:{X:0,O:0,D:0},
};

/* ── FIREBASE REFS ── */
let _db, _membRef, _chatRef, _vidRef, _tttRef, _hmRef, _chRef;

/* ── WEBRTC ──
   Signaling path:
   signals/{MY_UID}/{THEIR_UID}/offer    ← I write my offer
   signals/{MY_UID}/{THEIR_UID}/answer   ← they write answer
   signals/{MY_UID}/{THEIR_UID}/callerIce
   signals/{THEIR_UID}/{MY_UID}/calleeIce
*/
let localStream = null;
const pcs = {};        // theirUid → RTCPeerConnection
const remotes = {};    // theirUid → MediaStream

const ICE_SERVERS = { iceServers:[
  {urls:'stun:stun.l.google.com:19302'},
  {urls:'stun:stun1.l.google.com:19302'},
  {urls:'stun:stun2.l.google.com:19302'},
]};

/* ── GAME SKIP FLAGS ── */
let skipTTT=false, skipHM=false, skipCH=false;
let pendingTTT=null, pendingHM=null, pendingCH=null;

/* ══════════════════════════════════════════════
   UTILS
══════════════════════════════════════════════ */
const $  = id => document.getElementById(id);
const isMob = () => window.innerWidth < 768;
const now = () => new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
function uid6(){ return Math.random().toString(36).slice(2,8)+Math.random().toString(36).slice(2,8); }

function shake(id){
  const el=$(id); if(!el) return;
  el.classList.add('err');
  setTimeout(()=>el.classList.remove('err'),700);
}

function toast(msg,type='info'){
  let t=$('sz-toast');
  if(!t){
    t=document.createElement('div'); t.id='sz-toast';
    Object.assign(t.style,{
      position:'fixed',bottom:'60px',left:'50%',transform:'translateX(-50%)',
      zIndex:'9999',fontFamily:'var(--orb)',fontSize:'9px',fontWeight:'700',
      letterSpacing:'1.5px',padding:'9px 18px',border:'1px solid',
      pointerEvents:'none',transition:'opacity .3s',whiteSpace:'nowrap',
      maxWidth:'90vw',overflow:'hidden',textOverflow:'ellipsis',background:'var(--bg2)',
    });
    document.body.appendChild(t);
  }
  const c={info:'var(--teal)',error:'var(--pink)',success:'var(--teal)'};
  t.textContent=msg; t.style.color=c[type]||c.info; t.style.borderColor=c[type]||c.info;
  t.style.opacity='1'; clearTimeout(t._t);
  t._t=setTimeout(()=>t.style.opacity='0',3200);
}

/* ══════════════════════════════════════════════
   FIREBASE INIT
══════════════════════════════════════════════ */
function checkFirebase(){
  if(!FIREBASE_CONFIG.apiKey||FIREBASE_CONFIG.apiKey.startsWith('REPLACE')){
    $('cfg-overlay').style.display='flex'; return false;
  }
  try{
    if(!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    _db=firebase.database(); return true;
  }catch(e){ $('cfg-overlay').style.display='flex'; return false; }
}

/* ══════════════════════════════════════════════
   ONBOARDING
══════════════════════════════════════════════ */
function setStep(n){
  $('ob-fill').style.width=[25,50,75,100][n]+'%';
  ['os0','os1','os2','os3'].forEach((id,i)=>
    $(id).className='ob-step'+(i<n?' done':i===n?' on':''));
}
function showS(id){
  document.querySelectorAll('.ob-scr').forEach(s=>s.classList.remove('on'));
  $(id).classList.add('on');
}
function onName(){
  const v=$('n-inp').value;
  $('n-av').textContent=v?v[0].toUpperCase():'?'; G.name=v||'';
}
function go2(){
  const v=$('n-inp').value.trim(); if(!v){shake('n-inp');return;}
  G.name=v; G.uid=uid6(); G.init=v.slice(0,2).toUpperCase();
  showS('s2'); setStep(1);
}
function toggleJoin(){
  const b=$('jbox'); b.style.display=b.style.display==='none'?'block':'none';
  if(b.style.display!=='none') $('c-inp').focus();
}
function fmtCode(el){
  let v=el.value.toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(v.length>4) v=v.slice(0,4)+'-'+v.slice(4,8); el.value=v;
}

/* ── CREATE ── */
async function doCreate(){
  const btn=$('create-btn'); btn.textContent='…'; btn.disabled=true;
  G.isHost=true; G.code='SYNC-'+Math.floor(1000+Math.random()*9000);
  G.color=PAL[0]; G.bg=BGM[G.color];
  try{
    await _db.ref(`rooms/${G.code}`).set({
      meta:{host:G.uid,created:Date.now()}, started:false,
      members:{[G.uid]:{name:G.name,init:G.init,color:G.color,bg:G.bg,isHost:true,joinedAt:Date.now(),index:0}},
    });
    _db.ref(`rooms/${G.code}/members/${G.uid}`).onDisconnect().remove();
    $('disp-rc').textContent=G.code; $('wr-code-disp').textContent=G.code;
    showS('s3'); setStep(2);
  }catch(e){toast('Error creating room','error');console.error(e);}
  btn.textContent='CREATE →'; btn.disabled=false;
}
function copyCode(){
  navigator.clipboard?.writeText(G.code).catch(()=>{});
  const b=$('copy-btn'); b.textContent='COPIED!';
  setTimeout(()=>b.textContent='COPY',1500);
}
function openWR(){ startWR(); showS('s4'); setStep(3); }

/* ── JOIN ── */
async function doJoin(){
  const code=$('c-inp').value.trim().toUpperCase();
  if(code.length<8){shake('c-inp');return;}
  const btn=$('join-btn'); btn.textContent='…'; btn.disabled=true;
  try{
    const snap=await _db.ref(`rooms/${code}`).once('value');
    if(!snap.exists()){toast('Room not found','error');btn.textContent='JOIN ROOM →';btn.disabled=false;return;}
    if(snap.val().started){toast('Party already started','error');btn.textContent='JOIN ROOM →';btn.disabled=false;return;}
    const members=snap.val().members||{};
    const idx=Object.keys(members).length;
    G.color=PAL[idx%PAL.length]; G.bg=BGM[G.color]||'rgba(255,255,255,.1)';
    G.code=code; G.isHost=false;
    await _db.ref(`rooms/${code}/members/${G.uid}`).set({
      name:G.name,init:G.init,color:G.color,bg:G.bg,isHost:false,joinedAt:Date.now(),index:idx,
    });
    _db.ref(`rooms/${code}/members/${G.uid}`).onDisconnect().remove();
    $('wr-code-disp').textContent=G.code;
    startWR(); showS('s4'); setStep(3);
  }catch(e){toast('Error joining','error');console.error(e);}
  btn.textContent='JOIN ROOM →'; btn.disabled=false;
}

/* ══════════════════════════════════════════════
   WAITING ROOM
══════════════════════════════════════════════ */
function startWR(){
  _membRef=_db.ref(`rooms/${G.code}/members`);
  _membRef.on('value',snap=>{
    if(!snap.exists())return;
    G.members=snap.val()||{}; renderWRTiles();
  });
  if(!G.isHost){
    _db.ref(`rooms/${G.code}/started`).on('value',snap=>{
      if(snap.val()===true) launch();
    });
  }
  $('wr-btns').innerHTML=G.isHost
    ?`<button class="btn btn-primary" id="start-btn" onclick="hostStart()" style="min-width:150px;font-size:10px">START PARTY →</button>
      <button class="btn btn-ghost" onclick="copyCode()">COPY CODE</button>`
    :`<p style="font-size:11px;color:var(--muted)">Waiting for host to start…</p>`;
}
function renderWRTiles(){
  const list=Object.entries(G.members).sort((a,b)=>a[1].joinedAt-b[1].joinedAt);
  $('wr-grid').innerHTML=list.map(([id,m])=>`
    <div class="wr-tile ${id===G.uid?'you':'joined'}" id="wt-${id}">
      <div class="wr-av" style="background:${m.bg};color:${m.color}">${m.init}</div>
      <div style="font-size:10px;font-weight:500">${id===G.uid?m.name+' (you)':m.name}</div>
      <div style="font-family:var(--orb);font-size:8px;letter-spacing:1.5px;color:${m.isHost?'#c4b5fd':'var(--teal)'}">${m.isHost?'HOST':'JOINED ✓'}</div>
      ${m.isHost?`<div class="wr-badge" style="color:#c4b5fd;border-color:rgba(139,92,246,.35)">YOU</div>`:''}
    </div>`).join('');
  const n=list.length;
  $('wr-sub').textContent=n<=1?'Waiting for friends to join…'
    :`${n} people here — ${G.isHost?'start when ready ↓':'waiting for host…'}`;
}
async function hostStart(){
  $('start-btn').disabled=true; $('start-btn').textContent='STARTING…';
  await _db.ref(`rooms/${G.code}/started`).set(true);
  launch();
}

/* ══════════════════════════════════════════════
   LOCAL MEDIA
══════════════════════════════════════════════ */
async function initMedia(){
  for(const c of[{video:{width:640,height:480},audio:true},{audio:true}]){
    try{
      localStream=await navigator.mediaDevices.getUserMedia(c);
      toast(localStream.getVideoTracks().length?'Camera & mic ready ✓':'Mic ready ✓','success');
      return;
    }catch(_){}
  }
  toast('No camera/mic — check permissions','error');
}

/* ══════════════════════════════════════════════
   WEBRTC SIGNALING
══════════════════════════════════════════════ */
function makePc(theirUid){
  if(pcs[theirUid]) return pcs[theirUid];
  const pc=new RTCPeerConnection(ICE_SERVERS);
  pcs[theirUid]=pc;
  if(localStream) localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
  pc.ontrack=e=>{
    const stream=e.streams[0]||new MediaStream([e.track]);
    remotes[theirUid]=stream; showRemoteVideo(theirUid,stream);
  };
  pc.onconnectionstatechange=()=>{
    if(pc.connectionState==='disconnected'||pc.connectionState==='failed'){
      pc.close(); delete pcs[theirUid]; delete remotes[theirUid];
      clearRemoteVideo(theirUid);
    }
  };
  return pc;
}

/* I call them: write offer to signals/{MY_UID}/{THEIR_UID} */
async function callPeer(theirUid){
  if(pcs[theirUid]) return;
  const pc=makePc(theirUid);
  const sigRef=_db.ref(`rooms/${G.code}/signals/${G.uid}/${theirUid}`);
  pc.onicecandidate=e=>{if(e.candidate) sigRef.child('callerIce').push(e.candidate.toJSON());};
  const offer=await pc.createOffer();
  await pc.setLocalDescription(offer);
  await sigRef.child('offer').set({sdp:offer.sdp,type:offer.type});
  /* listen for their answer */
  sigRef.child('answer').on('value',async snap=>{
    if(!snap.exists()||pc.currentRemoteDescription) return;
    await pc.setRemoteDescription(new RTCSessionDescription(snap.val())).catch(()=>{});
  });
  /* listen for their ICE */
  _db.ref(`rooms/${G.code}/signals/${theirUid}/${G.uid}/calleeIce`)
     .on('child_added',snap=>pc.addIceCandidate(new RTCIceCandidate(snap.val())).catch(()=>{}));
}

/* They called me: signals/{THEIR_UID}/{MY_UID}/offer exists */
async function answerPeer(theirUid,offerData){
  if(pcs[theirUid]) return;
  const pc=makePc(theirUid);
  const sigRef=_db.ref(`rooms/${G.code}/signals/${theirUid}/${G.uid}`);
  pc.onicecandidate=e=>{if(e.candidate) sigRef.child('calleeIce').push(e.candidate.toJSON());};
  await pc.setRemoteDescription(new RTCSessionDescription(offerData)).catch(()=>{});
  const answer=await pc.createAnswer();
  await pc.setLocalDescription(answer);
  /* write answer where caller is listening */
  await _db.ref(`rooms/${G.code}/signals/${G.uid}/${theirUid}/answer`)
           .set({sdp:answer.sdp,type:answer.type});
  /* listen for their ICE */
  _db.ref(`rooms/${G.code}/signals/${theirUid}/${G.uid}/callerIce`)
     .on('child_added',snap=>pc.addIceCandidate(new RTCIceCandidate(snap.val())).catch(()=>{}));
}

/* Listen for anyone who posted offer at signals/{THEIR_UID}/{MY_UID} */
function listenForOffers(){
  _db.ref(`rooms/${G.code}/signals`).on('child_added',snap=>{
    const callerId=snap.key; if(callerId===G.uid) return;
    const sub=snap.val();
    if(sub&&sub[G.uid]&&sub[G.uid].offer&&!pcs[callerId])
      answerPeer(callerId,sub[G.uid].offer);
  });
  _db.ref(`rooms/${G.code}/signals`).on('child_changed',snap=>{
    const callerId=snap.key; if(callerId===G.uid) return;
    const sub=snap.val();
    if(sub&&sub[G.uid]&&sub[G.uid].offer&&!pcs[callerId])
      answerPeer(callerId,sub[G.uid].offer);
  });
}

function callAllPeers(){
  Object.keys(G.members).forEach(uid=>{if(uid!==G.uid) callPeer(uid);});
}

/* ── VIDEO TILES ── */
function buildVCTiles(){
  const list=Object.values(G.members).sort((a,b)=>a.joinedAt-b.joinedAt);
  const zone=$('vc-zone');
  zone.innerHTML=list.map(m=>{
    const isMe=m.name===G.name&&m.init===G.init;
    const tileId=isMe?'vt-me':('vt-'+Object.keys(G.members).find(k=>G.members[k].name===m.name&&G.members[k].init===m.init));
    return`<div class="vc-tile${isMe?' you':''}" id="${tileId}">
      <div class="vc-bg" style="background:${m.bg}">
        <span class="vc-av" style="color:${m.color}">${m.init}</span>
      </div>
      <div class="vc-bar">
        <span class="vc-name">${isMe?'You':m.name}</span>
        <div class="vc-icons">
          <svg class="vi" viewBox="0 0 16 16"><rect x="5" y="1" width="6" height="9" rx="3" fill="${isMe?'#00e5c3':'#4a4a72'}"/><path d="M3 8a5 5 0 0010 0" stroke="${isMe?'#00e5c3':'#4a4a72'}" fill="none" stroke-width="1.5"/><line x1="8" y1="13" x2="8" y2="15" stroke="${isMe?'#00e5c3':'#4a4a72'}" stroke-width="1.5"/></svg>
          <svg class="vi" viewBox="0 0 16 16"><rect x="1" y="4" width="9" height="8" rx="1.5" stroke="${isMe?'#00e5c3':'#4a4a72'}" stroke-width="1.5" fill="none"/><path d="M10 6.5l4-2v7l-4-2" stroke="${isMe?'#00e5c3':'#4a4a72'}" stroke-width="1.5" fill="none"/></svg>
        </div>
      </div>
    </div>`;
  }).join('');
  setTimeout(()=>{
    attachLocalVideo();
    Object.entries(remotes).forEach(([uid,stream])=>{
      const k=Object.keys(G.members).find(k=>k===uid);
      showRemoteVideo(k,stream);
    });
  },300);
  animateSpeaker(list);
}

let _spkTimer;
function animateSpeaker(list){
  clearInterval(_spkTimer); let si=list.length>1?1:0;
  _spkTimer=setInterval(()=>{
    document.querySelectorAll('.vc-tile').forEach(t=>t.classList.remove('spk'));
    const all=document.querySelectorAll('.vc-tile');
    if(all[si]) all[si].classList.add('spk');
    si=(si+1)%(list.length||1);
  },2800);
}

function attachLocalVideo(){
  const tile=$('vt-me'); if(!tile||!localStream) return;
  tile.querySelectorAll('video').forEach(v=>v.remove());
  const vid=document.createElement('video');
  vid.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1;';
  vid.autoplay=true; vid.muted=true; vid.playsInline=true; vid.srcObject=localStream;
  tile.prepend(vid);
  const bg=tile.querySelector('.vc-bg');
  if(bg) vid.onplaying=()=>bg.style.display='none';
}

function showRemoteVideo(theirUid,stream){
  /* find tile by uid */
  const tile=$('vt-'+theirUid);
  if(!tile) return;
  tile.querySelectorAll('video').forEach(v=>v.remove());
  const vid=document.createElement('video');
  vid.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1;';
  vid.autoplay=true; vid.playsInline=true; vid.srcObject=stream;
  tile.prepend(vid);
  const bg=tile.querySelector('.vc-bg');
  if(bg) vid.onplaying=()=>bg.style.display='none';
}

function clearRemoteVideo(theirUid){
  const tile=$('vt-'+theirUid); if(!tile) return;
  tile.querySelectorAll('video').forEach(v=>v.remove());
  const bg=tile.querySelector('.vc-bg'); if(bg) bg.style.display='flex';
}

function toggleVC(btn,type){
  btn.classList.toggle('on');
  const isOn=btn.classList.contains('on');
  if(!localStream) return;
  if(type==='mic') localStream.getAudioTracks().forEach(t=>t.enabled=isOn);
  if(type==='cam'){
    localStream.getVideoTracks().forEach(t=>t.enabled=isOn);
    const tile=$('vt-me');
    if(tile){
      const vid=tile.querySelector('video'),bg=tile.querySelector('.vc-bg');
      if(vid) vid.style.display=isOn?'block':'none';
      if(bg)  bg.style.display=isOn?'none':'flex';
    }
  }
}

/* ══════════════════════════════════════════════
   LAUNCH
══════════════════════════════════════════════ */
async function launch(){
  if(_membRef){_membRef.off();_membRef=null;}
  $('ob').classList.add('gone'); $('app').classList.add('on');
  await initMedia();
  populateApp();
  listenMembers();
  listenChat();
  listenVideo();
  listenForOffers();
  callAllPeers();
  listenGames();
  setTimeout(attachLocalVideo,600);
}

function populateApp(){
  const list=sortedMembers(); const n=list.length;
  ['bar-code'].forEach(id=>{const el=$(id);if(el)el.textContent=G.code;});
  ['bar-un'].forEach(id=>{const el=$(id);if(el)el.textContent=G.name;});
  ['bar-av'].forEach(id=>{const el=$(id);if(el)el.textContent=G.init;});
  $('bar-cnt').textContent=n+' in room';
  $('w-syn').textContent=n+' members';
  const hr=new Date().getHours();
  $('l-greet').textContent=`GOOD ${hr<12?'MORNING':hr<17?'AFTERNOON':'EVENING'}, ${G.name.toUpperCase()}`;
  $('l-sub').textContent=n+' friends connected · choose what to do';
  $('l-pips').innerHTML=list.map(m=>`
    <div class="pip">
      <div class="pip-dot" style="background:${m.color}"></div>
      <span style="font-size:10px">${m.uid===G.uid?m.name+' (you)':m.name}</span>
    </div>`).join('');
  buildVCTiles();
  seedChat(list);
}

function sortedMembers(){
  return Object.entries(G.members)
    .sort((a,b)=>a[1].joinedAt-b[1].joinedAt)
    .map(([uid,m])=>({...m,uid}));
}

/* ══════════════════════════════════════════════
   LIVE MEMBER UPDATES
══════════════════════════════════════════════ */
function listenMembers(){
  _membRef=_db.ref(`rooms/${G.code}/members`);
  _membRef.on('value',snap=>{
    if(!snap.exists()) return;
    const prev=Object.keys(G.members);
    G.members=snap.val()||{};
    const list=sortedMembers(); const n=list.length;
    $('bar-cnt').textContent=n+' in room';
    $('w-syn').textContent=n+' members';
    $('l-sub').textContent=n+' friends connected · choose what to do';
    $('l-pips').innerHTML=list.map(m=>`
      <div class="pip"><div class="pip-dot" style="background:${m.color}"></div>
      <span style="font-size:10px">${m.uid===G.uid?m.name+' (you)':m.name}</span></div>`).join('');
    buildVCTiles();
    Object.keys(G.members).filter(uid=>!prev.includes(uid)&&uid!==G.uid)
      .forEach(uid=>callPeer(uid));
  });
}

/* ══════════════════════════════════════════════
   NAVIGATION
══════════════════════════════════════════════ */
function goTab(name){
  document.querySelectorAll('.scr').forEach(s=>s.classList.remove('on'));
  document.querySelectorAll('.bn').forEach(b=>b.classList.remove('on'));
  $('scr-'+name).classList.add('on');
  const bnMap={lobby:'bn-lobby',watch:'bn-watch',games:'bn-games'};
  const bn=$(bnMap[name]); if(bn) bn.classList.add('on');
  if(name==='games') closeGame();
}
function goTabMob(name,tabEl){
  document.querySelectorAll('.scr').forEach(s=>s.classList.remove('on'));
  document.querySelectorAll('.bn').forEach(b=>b.classList.remove('on'));
  $('scr-'+name).classList.add('on');
  if(tabEl) tabEl.classList.add('on');
  if(name==='games') closeGame();
}

/* ══════════════════════════════════════════════
   WATCH PARTY
══════════════════════════════════════════════ */
function loadVid(){
  const url=$('yt-url').value.trim();
  const m=url.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
  if(!m){shake('yt-url');toast('Invalid YouTube URL','error');return;}
  /* push to Firebase — everyone will receive this */
  _db.ref(`rooms/${G.code}/video`).set({ytId:m[1],by:G.name,at:Date.now()});
}

function embedVideo(ytId){
  $('player-box').innerHTML=`
    <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--pink),var(--violet),var(--blue));z-index:2"></div>
    <iframe src="https://www.youtube.com/embed/${ytId}?autoplay=1&rel=0&modestbranding=1"
      allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture"
      allowfullscreen></iframe>`;
  $('w-stat').textContent='● LIVE'; $('w-stat').style.color='var(--pink)';
}

function listenVideo(){
  _vidRef=_db.ref(`rooms/${G.code}/video`);
  _vidRef.on('value',snap=>{
    if(!snap.exists()) return;
    const d=snap.val(); if(!d.ytId) return;
    embedVideo(d.ytId);
    addMsg('System',`${d.by} loaded a video — synced for everyone!`,'var(--teal)');
  });
}

/* ══════════════════════════════════════════════
   CHAT
══════════════════════════════════════════════ */
function seedChat(list){
  if(G.isHost)
    _db.ref(`rooms/${G.code}/chat`).push({
      user:'System',text:'Party started! Room: '+G.code,color:'var(--teal)',ts:Date.now()
    });
}
function listenChat(){
  _chatRef=_db.ref(`rooms/${G.code}/chat`).limitToLast(60);
  _chatRef.on('child_added',snap=>{
    const d=snap.val(); addMsg(d.user,d.text,d.color);
  });
}
function addMsg(user,text,color){
  const t=now();
  const html=`<div style="animation:fadeIn .2s ease">
    <div><span class="cm-who" style="color:${color}">${user}</span><span class="cm-time">${t}</span></div>
    <div class="cm-text">${text}</div></div>`;
  const b=$('wc-msgs'); if(b){b.insertAdjacentHTML('beforeend',html);b.scrollTop=99999;}
}
function sendChat(){
  const inp=$('wc-inp'); if(!inp?.value.trim()) return;
  _db.ref(`rooms/${G.code}/chat`).push({user:G.name,text:inp.value.trim(),color:G.color,ts:Date.now()});
  inp.value='';
}

/* ══════════════════════════════════════════════
   GAME SYNC ENGINE
   Rule: only the player whose turn it is can make a move.
   Player assignment: member index 0 = X/White, index 1 = O/Black.
   Turn stored in Firebase as the UID of who should move next.
══════════════════════════════════════════════ */
function listenGames(){
  _tttRef=_db.ref(`rooms/${G.code}/games/ttt`);
  _hmRef =_db.ref(`rooms/${G.code}/games/hm`);
  _chRef =_db.ref(`rooms/${G.code}/games/chess`);
  _tttRef.on('value',snap=>{
    if(skipTTT||!snap.exists()) return;
    pendingTTT=snap.val();
    if($('gp-ttt')?.classList.contains('on')) applyTTT(pendingTTT);
  });
  _hmRef.on('value',snap=>{
    if(skipHM||!snap.exists()) return;
    pendingHM=snap.val();
    if($('gp-hm')?.classList.contains('on')) applyHM(pendingHM);
  });
  _chRef.on('value',snap=>{
    if(skipCH||!snap.exists()) return;
    pendingCH=snap.val();
    if($('gp-chess')?.classList.contains('on')) applyCH(pendingCH);
  });
}

function push(ref,data,flag){
  window[flag]=true;
  ref.set(data);
  setTimeout(()=>window[flag]=false,500);
}

/* Player helpers */
function getPlayerUids(){
  const list=sortedMembers();
  return{xUid:list[0]?.uid||'',oUid:list[1]?.uid||''};
}
function getPlayerName(uid){
  return G.members[uid]?.name||'?';
}
function isMyTurn(turnUid){
  return turnUid===G.uid;
}

/* ══════════════════════════════════════════════
   GAMES — OPEN/CLOSE
══════════════════════════════════════════════ */
async function openGame(id){
  $('gz-lobby').style.display='none';
  const panel=$('gp-'+id); panel.classList.add('on');
  /* fetch current state from Firebase */
  const refMap={ttt:_tttRef,hm:_hmRef,chess:_chRef};
  const snap=await refMap[id].once('value');
  const existing=snap.exists()?snap.val():null;
  if(id==='ttt'){
    if(existing){applyTTT(existing);pendingTTT=existing;}
    else if(G.isHost) initTTT();
    else showWait(panel);
  }
  if(id==='hm'){
    if(existing){applyHM(existing);pendingHM=existing;}
    else if(G.isHost) initHM();
    else showWait(panel);
  }
  if(id==='chess'){
    if(existing){applyCH(existing);pendingCH=existing;}
    else if(G.isHost) initChess();
    else showWait(panel);
  }
}
function showWait(panel){
  let w=panel.querySelector('.game-overlay'); if(w) return;
  w=document.createElement('div'); w.className='game-overlay';
  w.innerHTML=`<div class="go-icon">⏳</div>
    <div class="go-title">WAITING FOR HOST</div>
    <div class="go-sub">The host will start the game</div>`;
  panel.appendChild(w);
}
function closeGame(){
  document.querySelectorAll('.gp').forEach(p=>{
    p.classList.remove('on');
    const ov=p.querySelector('.game-overlay'); if(ov) ov.remove();
  });
  $('gz-lobby').style.display='block';
}

/* ══════════════════════════════════════════════
   TIC-TAC-TOE
══════════════════════════════════════════════ */
const TTT_L=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
let tB,tR;

function initTTT(){
  const{xUid,oUid}=getPlayerUids();
  const state={
    board:Array(9).fill(null),
    turnUid:xUid, xUid, oUid,
    result:null,
    scores:{X:0,O:0,D:0},
    by:G.name, at:Date.now(),
  };
  push(_tttRef,state,'skipTTT');
  addMsg('System',G.name+' started Tic-Tac-Toe!','var(--teal)');
}

function tttClick(i){
  if(!pendingTTT||tB[i]||tR) return;
  if(!isMyTurn(pendingTTT.turnUid)){toast('Not your turn!','error');return;}
  const{xUid,oUid}=pendingTTT;
  const isX=(G.uid===xUid);
  tB[i]=isX?'X':'O';
  tR=tttCheck(tB);
  const scores={...pendingTTT.scores};
  if(tR){if(tR.w==='draw')scores.D++;else scores[tR.w]++;}
  const nextTurn=isX?oUid:xUid;
  push(_tttRef,{...pendingTTT,board:tB,turnUid:tR?null:nextTurn,result:tR?JSON.stringify(tR):null,scores},'skipTTT');
}

function tttCheck(b){
  for(const[a,c,d]of TTT_L) if(b[a]&&b[a]===b[c]&&b[a]===b[d]) return{w:b[a],l:[a,c,d]};
  if(b.every(Boolean)) return{w:'draw',l:[]};
  return null;
}

function applyTTT(s){
  tB=s.board||Array(9).fill(null);
  tR=s.result?JSON.parse(s.result):null;
  renderTTT(s);
}

function renderTTT(s){
  if(!$('ttt-bd')) return;
  const{xUid,oUid,turnUid,scores}=s||{};
  const xName=getPlayerName(xUid);
  const oName=getPlayerName(oUid)||'Waiting…';
  const wl=tR?.l||[];
  /* labels */
  if($('ttt-x-lbl')) $('ttt-x-lbl').textContent='X — '+xName;
  if($('ttt-o-lbl')) $('ttt-o-lbl').textContent='O — '+oName;
  if($('ttt-x-name')) $('ttt-x-name').textContent=xName;
  if($('ttt-o-name')) $('ttt-o-name').textContent=oName;
  if($('ttt-sx')) $('ttt-sx').textContent=scores?.X||0;
  if($('ttt-so')) $('ttt-so').textContent=scores?.O||0;
  if($('ttt-sd')) $('ttt-sd').textContent=scores?.D||0;
  /* turn banner */
  const banner=$('ttt-turn-banner');
  const bAv=$('ttt-turn-av');
  const bTxt=$('ttt-turn-text');
  if(banner&&bAv&&bTxt){
    if(tR){
      const winMsg=tR.w==='draw'?"IT'S A DRAW!":
        `${tR.w==='X'?xName:oName} (${tR.w}) WINS!`;
      bTxt.textContent=winMsg;
      const c=tR.w==='draw'?'var(--muted)':tR.w==='X'?'var(--pink)':'var(--teal)';
      bTxt.style.color=c; banner.style.borderColor=c;
      bAv.textContent=tR.w==='draw'?'—':tR.w;
      bAv.style.color=c; bAv.style.borderColor=c; bAv.style.background='transparent';
    }else if(turnUid){
      const isMe=isMyTurn(turnUid);
      const tName=getPlayerName(turnUid);
      const tInit=G.members[turnUid]?.init||'?';
      const isX=(turnUid===xUid);
      const c=isX?'var(--pink)':'var(--teal)';
      bAv.textContent=tInit; bAv.style.color=c; bAv.style.borderColor=c;
      bAv.style.background=isX?'rgba(255,45,120,.15)':'rgba(0,229,195,.15)';
      bTxt.textContent=(isMe?'YOUR TURN':tName+"'S TURN")+(isX?' · X':' · O');
      bTxt.style.color=c; banner.style.borderColor=c;
    }
  }
  /* board */
  $('ttt-bd').innerHTML=tB.map((c,i)=>{
    const win=wl.includes(i);
    const cc=c==='X'?'var(--pink)':'var(--teal)';
    const canClick=!c&&!tR&&isMyTurn(s?.turnUid||'');
    return`<div class="ttt-cell${c?' taken':''}${win?' wc':''}${!canClick&&!c&&!tR?' blocked':''}"
      onclick="tttClick(${i})"
      style="color:${c?cc:'transparent'};
             background:${win?(c==='X'?'rgba(255,45,120,.1)':'rgba(0,229,195,.1)'):'var(--bg2)'};
             border-color:${win?cc:'var(--border)'};">${c||''}</div>`;
  }).join('');
  /* play again */
  $('ttt-ag').innerHTML=tR
    ?`<button class="btn btn-teal" style="font-size:10px" onclick="initTTT()">↺ PLAY AGAIN</button>`:'';
}

/* ══════════════════════════════════════════════
   HANGMAN — cooperative: anyone can guess
══════════════════════════════════════════════ */
const HM_WORDS=['JAVASCRIPT','ELEPHANT','MOUNTAIN','KEYBOARD','UNIVERSE','PENGUIN','CHOCOLATE','QUANTUM','SYMPHONY','BUTTERFLY','ASTRONAUT','LABYRINTH','TELESCOPE','ADVENTURE','ALGORITHM','WATERFALL','DINOSAUR','HURRICANE','COMPUTER','NEBULA','CRYSTAL','ZEPPELIN','PARADOX','ECLIPSE'];
const HM_MAX=6;
const ALP='ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
let hW,hG,hE;

function initHM(){
  const state={word:HM_WORDS[Math.floor(Math.random()*HM_WORDS.length)],guessed:[],wrong:0,by:G.name,at:Date.now()};
  push(_hmRef,state,'skipHM');
  addMsg('System',G.name+' started Hangman!','var(--pink)');
}
function hmKey(l){
  if(!pendingHM) return;
  const won=pendingHM.word.split('').every(c=>pendingHM.guessed.includes(c));
  const lost=pendingHM.wrong>=HM_MAX;
  if(won||lost||pendingHM.guessed.includes(l)) return;
  const g=[...pendingHM.guessed,l];
  const e=pendingHM.word.includes(l)?pendingHM.wrong:pendingHM.wrong+1;
  push(_hmRef,{...pendingHM,guessed:g,wrong:e},'skipHM');
}
function applyHM(s){
  hW=s.word||HM_WORDS[0]; hG=new Set(s.guessed||[]); hE=s.wrong||0;
  renderHM(s);
}
function drawGallows(e){
  const s=$('hm-svg'); if(!s) return;
  s.innerHTML=`<line x1="14" y1="152" x2="166" y2="152" stroke="#00e5c3" stroke-width="2"/>
    <line x1="46" y1="152" x2="46" y2="8" stroke="#00e5c3" stroke-width="2"/>
    <line x1="46" y1="8" x2="106" y2="8" stroke="#00e5c3" stroke-width="2"/>
    <line x1="106" y1="8" x2="106" y2="22" stroke="#00e5c3" stroke-width="2"/>
    ${[`<circle cx="106" cy="34" r="12" stroke="#ff2d78" stroke-width="2.5" fill="none"/>`,
       `<line x1="106" y1="46" x2="106" y2="90" stroke="#ff2d78" stroke-width="2.5"/>`,
       `<line x1="106" y1="60" x2="86" y2="78" stroke="#ff2d78" stroke-width="2.5"/>`,
       `<line x1="106" y1="60" x2="126" y2="78" stroke="#ff2d78" stroke-width="2.5"/>`,
       `<line x1="106" y1="90" x2="86" y2="116" stroke="#ff2d78" stroke-width="2.5"/>`,
       `<line x1="106" y1="90" x2="126" y2="116" stroke="#ff2d78" stroke-width="2.5"/>`].slice(0,e).join('')}`;
}
function renderHM(s){
  if(!$('hm-wd')) return;
  drawGallows(hE);
  const won=hW.split('').every(l=>hG.has(l)), lost=hE>=HM_MAX;
  $('hm-wd').innerHTML=hW.split('').map(l=>`
    <div class="l-box" style="border-color:${hG.has(l)?'var(--pink)':'var(--border)'};color:${hG.has(l)?'var(--text)':'transparent'}">${l}</div>`).join('');
  const st=$('hm-st'); if(st){
    st.textContent=won?'🎉 WORD FOUND!':lost?'GAME OVER — WORD: '+hW:(HM_MAX-hE)+' GUESSES LEFT';
    st.style.color=won?'var(--teal)':lost?'var(--pink)':'var(--muted2)';
  }
  const pct=Math.round(((HM_MAX-hE)/HM_MAX)*100);
  const pf=$('hm-pf'); if(pf){pf.style.width=pct+'%';pf.style.background=hE>3?'var(--pink)':'var(--teal)';}
  const pl=$('hm-pl'); if(pl) pl.textContent=`Attempts left: ${HM_MAX-hE} / ${HM_MAX}`;
  /* turn banner */
  const hbt=$('hm-turn-banner'),htt=$('hm-turn-text');
  if(hbt&&htt){
    hbt.style.borderColor=won?'var(--teal)':lost?'var(--pink)':'var(--pink)';
    htt.style.color=hbt.style.borderColor;
    htt.textContent=won?'EVERYONE WINS!':lost?'GAME OVER':' COOPERATIVE — ANYONE CAN GUESS';
  }
  const kb=$('hm-kb'); if(kb) kb.innerHTML=ALP.map(l=>{
    const u=hG.has(l),h=u&&hW.includes(l),m=u&&!hW.includes(l);
    return`<button class="k${h?' hit':m?' miss':''}" onclick="hmKey('${l}')" ${u||won||lost?'disabled':''}>${l}</button>`;
  }).join('');
  const ag=$('hm-ag'); if(ag) ag.innerHTML=(won||lost)?`<button class="btn btn-primary" style="font-size:10px" onclick="initHM()">↺ NEW WORD</button>`:'';
}

/* ══════════════════════════════════════════════
   CHESS — turn-based by UID
══════════════════════════════════════════════ */
const CH_INIT=['br','bn','bb','bq','bk','bb','bn','br','bp','bp','bp','bp','bp','bp','bp','bp',...Array(32).fill(null),'wp','wp','wp','wp','wp','wp','wp','wp','wr','wn','wb','wq','wk','wb','wn','wr'];
const CH_SYM={wk:'♔',wq:'♕',wr:'♖',wb:'♗',wn:'♘',wp:'♙',bk:'♚',bq:'♛',br:'♜',bb:'♝',bn:'♞',bp:'♟'};
let cB,cSel,cLeg,cLast;

function initChess(){
  const{xUid:wUid,oUid:bUid}=getPlayerUids();
  const snap={board:[...CH_INIT],turnUid:wUid,wUid,bUid,capW:[],capB:[],moves:0,last:null,by:G.name,at:Date.now()};
  push(_chRef,snap,'skipCH');
  addMsg('System',G.name+' started Chess!','var(--amber)');
}

function chClick(idx){
  if(!pendingCH||!isMyTurn(pendingCH.turnUid)){
    if(!isMyTurn(pendingCH?.turnUid||'')) toast('Not your turn!','error');
    return;
  }
  const{wUid,bUid}=pendingCH;
  const myColor=(G.uid===wUid)?'w':'b';
  if(cSel===null){
    if(cB[idx]?.[0]===myColor){cSel=idx;cLeg=chMoves(cB,idx);}
  }else{
    if(cLeg.includes(idx)){
      const nb=[...cB],mv=nb[cSel],cp=nb[idx];
      nb[idx]=mv;nb[cSel]=null;
      if(mv==='wp'&&Math.floor(idx/8)===0)nb[idx]='wq';
      if(mv==='bp'&&Math.floor(idx/8)===7)nb[idx]='bq';
      const capW=myColor==='w'&&cp?[...pendingCH.capW,cp]:pendingCH.capW;
      const capB=myColor==='b'&&cp?[...pendingCH.capB,cp]:pendingCH.capB;
      const nextTurn=myColor==='w'?bUid:wUid;
      push(_chRef,{...pendingCH,board:nb,turnUid:nextTurn,capW,capB,moves:pendingCH.moves+1,last:[cSel,idx]},'skipCH');
      cSel=null;cLeg=[];return;
    }else if(cB[idx]?.[0]===myColor){cSel=idx;cLeg=chMoves(cB,idx);}
    else{cSel=null;cLeg=[];}
  }
  renderChessLocal();
}

function chMoves(board,idx){
  const p=board[idx];if(!p)return[];
  const cl=p[0],tp=p[1],op=cl==='w'?'b':'w',row=Math.floor(idx/8),col=idx%8,mv=[];
  const slide=dirs=>{for(const[dr,dc]of dirs){let r=row+dr,c=col+dc;while(r>=0&&r<8&&c>=0&&c<8){const t=board[r*8+c];if(t){if(t[0]===op)mv.push(r*8+c);break;}mv.push(r*8+c);r+=dr;c+=dc;}}};
  const step=dirs=>{for(const[dr,dc]of dirs){const r=row+dr,c=col+dc;if(r>=0&&r<8&&c>=0&&c<8){const t=board[r*8+c];if(!t||t[0]===op)mv.push(r*8+c);}}};
  if(tp==='p'){const d=cl==='w'?-1:1,st=cl==='w'?6:1,nr=row+d;
    if(nr>=0&&nr<8&&!board[nr*8+col]){mv.push(nr*8+col);if(row===st&&!board[(row+2*d)*8+col])mv.push((row+2*d)*8+col);}
    for(const dc of[-1,1]){const nc=col+dc;if(nr>=0&&nr<8&&nc>=0&&nc<8&&board[nr*8+nc]?.[0]===op)mv.push(nr*8+nc);}
  }
  if(tp==='n')step([[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]);
  if(tp==='r')slide([[0,1],[0,-1],[1,0],[-1,0]]);
  if(tp==='b')slide([[1,1],[1,-1],[-1,1],[-1,-1]]);
  if(tp==='q')slide([[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]]);
  if(tp==='k')step([[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]);
  return mv;
}

function applyCH(s){
  cB=s.board||[...CH_INIT]; cSel=null; cLeg=[]; cLast=s.last||null;
  renderChess(s);
}
function renderChessLocal(){ if(pendingCH) renderChess({...pendingCH,board:cB,last:cLast}); }
function renderChess(s){
  const bd=$('ch-bd'); if(!bd) return;
  const{wUid,bUid,turnUid,capW=[],capB=[],moves=0}=s||{};
  const wName=getPlayerName(wUid); const bName=getPlayerName(bUid)||'?';
  /* board */
  bd.innerHTML=cB.map((p,i)=>{
    const row=Math.floor(i/8),col=i%8,lt=(row+col)%2===0;
    const isSel=cSel===i,isLeg=cLeg.includes(i),isCap=isLeg&&!!p;
    const isLast=cLast&&(i===cLast[0]||i===cLast[1]);
    let cls=`sq ${lt?'ls':'ds'}`;
    if(isSel)cls+=' sel';else if(isLast)cls+=' lm';
    if(isLeg&&!p)cls+=' leg';if(isCap)cls+=' cap';
    if(!isMyTurn(turnUid||''))cls+=' blocked';
    return`<div class="${cls}" onclick="chClick(${i})">${p?`<span class="cp ${p[0]==='w'?'w':'b'}">${CH_SYM[p]}</span>`:''}</div>`;
  }).join('');
  /* turn banner */
  const dot=$('ch-turn-dot'),tn=$('ch-turn-text'),mv=$('ch-moves');
  if(dot) dot.style.background=turnUid===wUid?'#f2f2ff':'#111827';
  if(tn){
    const isMe=isMyTurn(turnUid||'');
    const tName=getPlayerName(turnUid||'');
    tn.textContent=isMe?`YOUR TURN (${turnUid===wUid?'WHITE':'BLACK'})`:tName+"'S TURN";
    tn.style.color=turnUid===wUid?'var(--amber)':'var(--muted2)';
    $('ch-turn-banner').style.borderColor=tn.style.color;
  }
  if(mv) mv.textContent=moves;
  /* labels */
  const wl=$('ch-w-lbl'),bl=$('ch-b-lbl');
  if(wl) wl.textContent=`WHITE — ${wName}`;
  if(bl) bl.textContent=`BLACK — ${bName}`;
  const fmt=arr=>arr.length?arr.map(p=>`<span style="opacity:.75">${CH_SYM[p]}</span>`).join(''):'—';
  const wc=$('ch-wc'),bc=$('ch-bc');
  if(wc) wc.innerHTML=fmt(capW); if(bc) bc.innerHTML=fmt(capB);
}

/* ══════════════════════════════════════════════
   PWA + BOOT
══════════════════════════════════════════════ */
if('serviceWorker' in navigator)
  window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));

window.addEventListener('DOMContentLoaded',()=>{
  const code=new URLSearchParams(window.location.search).get('join');
  if(code){
    const ci=$('c-inp'); if(ci) ci.value=code.toUpperCase();
    const jb=$('jbox'); if(jb) jb.style.display='block';
  }
  /* auto-size chess squares based on viewport */
  const sq=Math.floor(Math.min(window.innerWidth-24,360)/8);
  document.documentElement.style.setProperty('--sq',sq+'px');
  checkFirebase();
});

/* ── EXPOSE TO HTML ── */
window.onName=onName; window.go2=go2; window.toggleJoin=toggleJoin; window.fmtCode=fmtCode;
window.doCreate=doCreate; window.doJoin=doJoin; window.copyCode=copyCode; window.openWR=openWR;
window.hostStart=hostStart;
window.goTab=goTab; window.goTabMob=goTabMob;
window.toggleVC=toggleVC; window.loadVid=loadVid; window.sendChat=sendChat;
window.openGame=openGame; window.closeGame=closeGame;
window.tttClick=tttClick; window.initTTT=initTTT;
window.hmKey=hmKey; window.initHM=initHM;
window.chClick=chClick; window.initChess=initChess;