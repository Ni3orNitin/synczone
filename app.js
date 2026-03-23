/* ═══════════════════════════════════════════════════════════
   SYNCZONE  app.js  — complete rewrite
   • Top-1/3 video always visible
   • Turn-based games: only current player's clicks work
   • YouTube sync via Firebase (one loads → everyone plays)
   • WebRTC with corrected signaling
═══════════════════════════════════════════════════════════ */

/* ── COLOURS ── */
const PALETTE = ['#c4b5fd','#ff2d78','#fbbf24','#38bdf8','#00e5c3','#fb923c'];
const BG_MAP  = {
  '#c4b5fd':'rgba(139,92,246,.22)','#ff2d78':'rgba(255,45,120,.18)',
  '#fbbf24':'rgba(251,191,36,.18)','#38bdf8':'rgba(56,189,248,.18)',
  '#00e5c3':'rgba(0,229,195,.18)', '#fb923c':'rgba(251,146,60,.18)',
};

/* ── STATE ── */
const G = {
  userId:'', name:'', code:'', isHost:false,
  color:'', bg:'', init:'',
  members:{},       // uid → {name,init,color,bg,isHost,joinedAt,order}
  myOrder: 0,       // 0=host, 1=joiner — determines X/White/guesser
};

/* ── FIREBASE ── */
let _db, _membersRef, _chatRef, _videoRef;
let _gameTTTRef, _gameHMRef, _gameChessRef;

/* ── WEBRTC ── */
let localStream = null;
const pcs = {}, remotes = {};
const ICE = { iceServers:[
  {urls:'stun:stun.l.google.com:19302'},
  {urls:'stun:stun1.l.google.com:19302'},
]};

/* ── GAME SKIP FLAGS ── */
let skipTTT=false, skipHM=false, skipChess=false;
let pendingTTT=null, pendingHM=null, pendingChess=null;

/* ── UTIL ── */
const $  = id => document.getElementById(id);
const isMob = () => window.innerWidth < 768;
const nowTime = () => new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
function uid6(){ return Math.random().toString(36).slice(2,8)+Date.now().toString(36).slice(-4); }
function shake(id){ const e=$(id); if(!e)return; e.classList.add('err'); setTimeout(()=>e.classList.remove('err'),700); }
function toast(msg,type='info'){
  let t=$('sz-toast');
  if(!t){ t=document.createElement('div'); t.id='sz-toast';
    Object.assign(t.style,{position:'fixed',bottom:'70px',left:'50%',transform:'translateX(-50%)',
    zIndex:'9999',fontFamily:'var(--orb)',fontSize:'10px',fontWeight:'700',letterSpacing:'1.5px',
    padding:'10px 22px',border:'1px solid',pointerEvents:'none',transition:'opacity .3s',
    whiteSpace:'nowrap',maxWidth:'90vw',overflow:'hidden',textOverflow:'ellipsis'});
    document.body.appendChild(t); }
  const c={info:'var(--teal)',error:'var(--pink)',success:'var(--teal)'};
  t.textContent=msg; t.style.background='var(--bg2)'; t.style.color=c[type]||c.info; t.style.borderColor=c[type]||c.info; t.style.opacity='1';
  clearTimeout(t._tid); t._tid=setTimeout(()=>t.style.opacity='0',3000);
}

/* ═══ FIREBASE INIT ═══ */
function checkFirebase(){
  if(!FIREBASE_CONFIG.apiKey||FIREBASE_CONFIG.apiKey.startsWith('REPLACE')){
    $('cfg').style.display='flex'; return false;
  }
  try{ if(!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG); _db=firebase.database(); return true; }
  catch(e){ $('cfg').style.display='flex'; return false; }
}

/* ═══ ONBOARDING ═══ */
function setStep(n){
  $('ob-bar').style.width=[25,50,75,100][n]+'%';
  ['os0','os1','os2','os3'].forEach((id,i)=>$(id).className='ob-step'+(i<n?' done':i===n?' on':''));
}
function showS(id){ document.querySelectorAll('.ob-scr').forEach(s=>s.classList.remove('on')); $(id).classList.add('on'); }

function onName(){ const v=$('n-inp').value; $('n-av').textContent=v?v[0].toUpperCase():'?'; G.name=v||''; }

function go2(){
  const v=$('n-inp').value.trim(); if(!v){shake('n-inp');return;}
  G.name=v; G.userId=uid6(); G.init=v.slice(0,2).toUpperCase();
  showS('s2'); setStep(1);
}

function toggleJoin(){
  const b=$('join-box'); b.style.display=b.style.display==='none'?'block':'none';
  if(b.style.display!=='none') $('code-inp').focus();
}
function fmtCode(el){ let v=el.value.toUpperCase().replace(/[^A-Z0-9]/g,''); if(v.length>4)v=v.slice(0,4)+'-'+v.slice(4,8); el.value=v; }

async function doCreate(){
  const btn=$('create-btn'); btn.textContent='CREATING…'; btn.disabled=true;
  G.isHost=true; G.code='SYNC-'+Math.floor(1000+Math.random()*9000);
  G.color=PALETTE[0]; G.bg=BG_MAP[G.color]; G.myOrder=0;
  try{
    await _db.ref(`rooms/${G.code}`).set({
      meta:{host:G.userId,created:Date.now()}, started:false,
      members:{[G.userId]:{name:G.name,init:G.init,color:G.color,bg:G.bg,isHost:true,joinedAt:Date.now(),order:0}},
    });
    _db.ref(`rooms/${G.code}/members/${G.userId}`).onDisconnect().remove();
    $('disp-rc').textContent=G.code;
    $('share-link').textContent=window.location.origin+'/?join='+G.code;
    $('wr-code').textContent=G.code;
    showS('s3'); setStep(2);
  }catch(e){ toast('Error creating room','error'); console.error(e); }
  btn.textContent='CREATE →'; btn.disabled=false;
}

function copyCode(){ navigator.clipboard?.writeText(G.code).catch(()=>{}); const b=$('copy-btn'); b.textContent='COPIED!'; setTimeout(()=>b.textContent='COPY CODE',1500); }
function copyLink(){ navigator.clipboard?.writeText(window.location.origin+'/?join='+G.code).catch(()=>{}); const b=$('copy-link-btn'); b.textContent='COPIED!'; setTimeout(()=>b.textContent='COPY',1500); }
function openWR(){ startWR(); showS('s4'); setStep(3); }

async function doJoin(){
  const code=$('code-inp').value.trim().toUpperCase();
  if(code.length<8){shake('code-inp');return;}
  const btn=$('join-btn'); btn.textContent='JOINING…'; btn.disabled=true;
  try{
    const snap=await _db.ref(`rooms/${code}`).once('value');
    if(!snap.exists()){toast('Room not found','error');btn.textContent='JOIN ROOM →';btn.disabled=false;return;}
    if(snap.val().started){toast('Party already started','error');btn.textContent='JOIN ROOM →';btn.disabled=false;return;}
    const cnt=Object.keys(snap.val().members||{}).length;
    G.color=PALETTE[cnt%PALETTE.length]; G.bg=BG_MAP[G.color]||'rgba(255,255,255,.1)';
    G.code=code; G.isHost=false; G.myOrder=cnt; // order = join sequence
    await _db.ref(`rooms/${code}/members/${G.userId}`).set({name:G.name,init:G.init,color:G.color,bg:G.bg,isHost:false,joinedAt:Date.now(),order:cnt});
    _db.ref(`rooms/${code}/members/${G.userId}`).onDisconnect().remove();
    $('wr-code').textContent=G.code;
    startWR(); showS('s4'); setStep(3);
  }catch(e){ toast('Error joining room','error'); console.error(e); }
  btn.textContent='JOIN ROOM →'; btn.disabled=false;
}

/* ═══ WAITING ROOM ═══ */
function startWR(){
  _membersRef=_db.ref(`rooms/${G.code}/members`);
  _membersRef.on('value',snap=>{ if(!snap.exists())return; G.members=snap.val()||{}; renderWRTiles(); });
  if(!G.isHost){ _db.ref(`rooms/${G.code}/started`).on('value',snap=>{ if(snap.val()===true) launch(); }); }
  $('wr-btns').innerHTML=G.isHost
    ?`<button class="btn btn-primary" id="start-btn" onclick="hostStart()" style="min-width:160px;font-size:10px">START PARTY →</button>
      <button class="btn btn-ghost" onclick="copyCode()">COPY CODE</button>`
    :`<p style="font-size:11px;color:var(--muted)">Waiting for host to start…</p>`;
}
function renderWRTiles(){
  const list=Object.entries(G.members).sort((a,b)=>a[1].joinedAt-b[1].joinedAt);
  $('wr-grid').innerHTML=list.map(([id,m])=>`
    <div class="w-tile ${id===G.userId?'you':'joined'}">
      <div class="wt-av" style="background:${m.bg};color:${m.color}">${m.init}</div>
      <div style="font-size:11px;font-weight:500">${id===G.userId?m.name+' (you)':m.name}</div>
      <div style="font-family:var(--orb);font-size:8px;letter-spacing:1.5px;color:${m.isHost?'#c4b5fd':'var(--teal)'}">${m.isHost?'HOST':'JOINED ✓'}</div>
      ${m.isHost?`<div class="wt-badge" style="color:#c4b5fd;border-color:rgba(139,92,246,.35)">YOU</div>`:''}
    </div>`).join('');
  const n=list.length;
  $('wr-sub').textContent=n<=1?'Waiting for friends to join…':`${n} people here — ${G.isHost?'start when ready ↓':'waiting for host…'}`;
}
async function hostStart(){ $('start-btn').disabled=true; $('start-btn').textContent='STARTING…'; await _db.ref(`rooms/${G.code}/started`).set(true); launch(); }

/* ═══ LAUNCH ═══ */
async function launch(){
  if(_membersRef){_membersRef.off();_membersRef=null;}
  $('onboarding').classList.add('gone');
  $('app').classList.add('on');
  await initLocalStream();
  buildApp();
  listenMembers();
  listenChat();
  listenVideo();
  listenForOffers();
  callAllPeers();
  listenAllGames();
  setTimeout(showLocalVid,400);
}

/* ═══ APP POPULATION ═══ */
function buildApp(){
  const list=sortMembers();
  const cnt=list.length;
  $('hdr-code').textContent=G.code;
  $('hdr-un').textContent=G.name;
  $('hdr-av').textContent=G.init;
  $('hdr-cnt').textContent=cnt+' in room';
  $('w-syn').textContent=cnt+' members';
  const hr=new Date().getHours();
  $('l-greet').textContent=`GOOD ${hr<12?'MORNING':hr<17?'AFTERNOON':'EVENING'}, ${G.name.toUpperCase()}`;
  $('l-sub').textContent=cnt+' friends connected · choose what to do';
  buildPips(list);
  buildVCTiles(list);
  seedChat();
}
function sortMembers(){ return Object.entries(G.members).sort((a,b)=>a[1].joinedAt-b[1].joinedAt).map(([id,m])=>({...m,uid:id})); }
function buildPips(list){
  $('l-pips').innerHTML=list.map(m=>`<div class="pip"><div class="pip-dot" style="background:${m.color}"></div><span style="font-size:10px">${m.uid===G.userId?m.name+' (you)':m.name}</span></div>`).join('');
}

/* helper: who is player 1 (order=0) and player 2 (order=1) */
function getPlayer(order){ return sortMembers().find(m=>m.order===order)||null; }
function myTurnFor(gameCurrentTurn){ return gameCurrentTurn===G.userId; }

/* ═══ VIDEO TILES ═══ */
let _spkTimer;
function buildVCTiles(list){
  clearInterval(_spkTimer);
  $('vc-zone').innerHTML=list.slice(0,4).map(m=>{
    const isMe=m.uid===G.userId;
    return `<div class="vc-tile${isMe?' you':''}" id="vt-${m.uid}">
      <div class="vc-tile-bg" style="background:${m.bg}"><div class="vc-av" style="color:${m.color}">${m.init}</div></div>
      <div class="vc-bar"><span class="vc-name">${isMe?'You':m.name}</span><span class="vc-status" id="vcs-${m.uid}" style="color:${isMe?'#4a4a72':'#4a4a72'}">mic off</span></div>
    </div>`;
  }).join('');
  setTimeout(()=>{ showLocalVid(); Object.entries(remotes).forEach(([id,s])=>showRemoteVid(id,s)); },200);
  let si=list.length>1?1:0;
  _spkTimer=setInterval(()=>{
    document.querySelectorAll('#vc-zone .vc-tile').forEach(t=>t.classList.remove('spk'));
    const all=document.querySelectorAll('#vc-zone .vc-tile');
    if(all[si])all[si].classList.add('spk');
    si=(si+1)%(list.length||1);
  },2800);
}

/* ═══ LOCAL STREAM ═══ */
async function initLocalStream(){
  for(const c of [{video:{width:640,height:480},audio:true},{audio:true}]){
    try{ localStream=await navigator.mediaDevices.getUserMedia(c);
      toast(localStream.getVideoTracks().length?'Camera & mic ready ✓':'Mic ready ✓','success'); return; }
    catch(_){}
  }
  toast('Cannot access camera/mic — check permissions','error');
}
function showLocalVid(){
  const tile=$('vt-'+G.userId); if(!tile||!localStream)return;
  tile.querySelectorAll('video').forEach(v=>v.remove());
  const vid=document.createElement('video');
  vid.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1;';
  vid.autoplay=true;vid.muted=true;vid.playsInline=true;vid.srcObject=localStream;
  tile.prepend(vid);
  const bg=tile.querySelector('.vc-tile-bg');
  vid.onplaying=()=>{ if(bg)bg.style.display='none'; };
}
function showRemoteVid(theirId,stream){
  const tile=$('vt-'+theirId); if(!tile)return;
  tile.querySelectorAll('video').forEach(v=>v.remove());
  const vid=document.createElement('video');
  vid.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1;';
  vid.autoplay=true;vid.playsInline=true;vid.srcObject=stream;
  tile.prepend(vid);
  const bg=tile.querySelector('.vc-tile-bg');
  vid.onplaying=()=>{ if(bg)bg.style.display='none'; };
}

/* ── MIC / CAM ── */
function toggleMic(btn){
  btn.classList.toggle('on'); btn.classList.toggle('off');
  if(localStream) localStream.getAudioTracks().forEach(t=>t.enabled=btn.classList.contains('on'));
}
function toggleCam(btn){
  btn.classList.toggle('on'); btn.classList.toggle('off');
  if(localStream){
    const isOn=btn.classList.contains('on');
    localStream.getVideoTracks().forEach(t=>t.enabled=isOn);
    const tile=$('vt-'+G.userId);
    if(tile){ const vid=tile.querySelector('video'),bg=tile.querySelector('.vc-tile-bg');
      if(vid)vid.style.display=isOn?'block':'none'; if(bg)bg.style.display=isOn?'none':'flex'; }
  }
}
function leaveCall(){ if(confirm('Leave the call?')){ localStream?.getTracks().forEach(t=>t.stop()); window.location.reload(); } }

/* ═══ WEBRTC — SIGNALING ═══ */
function makePc(theirId){
  if(pcs[theirId])return pcs[theirId];
  const pc=new RTCPeerConnection(ICE); pcs[theirId]=pc;
  if(localStream)localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
  pc.ontrack=e=>{ const s=e.streams[0]||new MediaStream([e.track]); remotes[theirId]=s; showRemoteVid(theirId,s); };
  pc.onconnectionstatechange=()=>{ if(['disconnected','failed'].includes(pc.connectionState)){
    pc.close();delete pcs[theirId];delete remotes[theirId];
    const t=$('vt-'+theirId);if(t){t.querySelectorAll('video').forEach(v=>v.remove());const bg=t.querySelector('.vc-tile-bg');if(bg)bg.style.display='flex';} }};
  return pc;
}
async function callPeer(theirId){
  if(pcs[theirId])return;
  const pc=makePc(theirId);
  const sigRef=_db.ref(`rooms/${G.code}/signals/${theirId}/${G.userId}`);
  pc.onicecandidate=e=>{ if(e.candidate)sigRef.child('callerIce').push(e.candidate.toJSON()); };
  const offer=await pc.createOffer(); await pc.setLocalDescription(offer);
  await sigRef.child('offer').set({sdp:offer.sdp,type:offer.type});
  sigRef.child('answer').on('value',async snap=>{ if(!snap.exists()||pc.currentRemoteDescription)return; await pc.setRemoteDescription(new RTCSessionDescription(snap.val())).catch(()=>{}); });
  _db.ref(`rooms/${G.code}/signals/${G.userId}/${theirId}/calleeIce`).on('child_added',snap=>pc.addIceCandidate(new RTCIceCandidate(snap.val())).catch(()=>{}));
}
async function answerPeer(theirId,offerData){
  if(pcs[theirId])return;
  const pc=makePc(theirId);
  const sigRef=_db.ref(`rooms/${G.code}/signals/${G.userId}/${theirId}`);
  pc.onicecandidate=e=>{ if(e.candidate)sigRef.child('calleeIce').push(e.candidate.toJSON()); };
  await pc.setRemoteDescription(new RTCSessionDescription(offerData)).catch(()=>{});
  const answer=await pc.createAnswer(); await pc.setLocalDescription(answer);
  await _db.ref(`rooms/${G.code}/signals/${theirId}/${G.userId}/answer`).set({sdp:answer.sdp,type:answer.type});
  _db.ref(`rooms/${G.code}/signals/${G.userId}/${theirId}/callerIce`).on('child_added',snap=>pc.addIceCandidate(new RTCIceCandidate(snap.val())).catch(()=>{}));
}
function listenForOffers(){
  _db.ref(`rooms/${G.code}/signals/${G.userId}`).on('child_added',snap=>{
    const cid=snap.key,d=snap.val(); if(d&&d.offer&&!pcs[cid])answerPeer(cid,d.offer);
  });
  _db.ref(`rooms/${G.code}/signals/${G.userId}`).on('child_changed',snap=>{
    const cid=snap.key,d=snap.val(); if(d&&d.offer&&!pcs[cid])answerPeer(cid,d.offer);
  });
}
function callAllPeers(){ Object.keys(G.members).forEach(id=>{ if(id!==G.userId)callPeer(id); }); }

/* ═══ MEMBERS LISTENER ═══ */
function listenMembers(){
  _membersRef=_db.ref(`rooms/${G.code}/members`);
  _membersRef.on('value',snap=>{
    if(!snap.exists())return;
    const prev=Object.keys(G.members);
    G.members=snap.val()||{};
    // update my order from Firebase (in case it changed)
    if(G.members[G.userId]) G.myOrder=G.members[G.userId].order||0;
    const list=sortMembers(); const cnt=list.length;
    $('hdr-cnt').textContent=cnt+' in room'; $('w-syn').textContent=cnt+' members';
    $('l-sub').textContent=cnt+' friends connected · choose what to do';
    buildPips(list); buildVCTiles(list);
    Object.keys(G.members).filter(id=>!prev.includes(id)&&id!==G.userId).forEach(id=>callPeer(id));
  });
}

/* ═══ NAVIGATION ═══ */
function goTabByName(name){ const idx={lobby:0,watch:1,games:2}[name]; const tabs=document.querySelectorAll('.hdr-tab'); goTab(name,tabs[idx]); }
function goTab(name,tabEl){
  document.querySelectorAll('.app-scr').forEach(s=>s.classList.remove('on'));
  document.querySelectorAll('.hdr-tab').forEach(t=>t.classList.remove('on'));
  $('scr-'+name).classList.add('on'); if(tabEl)tabEl.classList.add('on');
  if(name==='games')closeGame();
}
function goTabMob(name,tabEl){
  document.querySelectorAll('.app-scr').forEach(s=>s.classList.remove('on'));
  document.querySelectorAll('.bn').forEach(t=>t.classList.remove('on'));
  $('scr-'+name).classList.add('on'); if(tabEl)tabEl.classList.add('on');
  if(name==='games')closeGame();
}

/* ═══ YOUTUBE SYNC ═══ */
function loadVid(){
  const url=$('yt-url').value.trim();
  const m=url.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
  if(!m){shake('yt-url');toast('Invalid YouTube URL','error');return;}
  /* push to Firebase — everyone will receive and play */
  _db.ref(`rooms/${G.code}/video`).set({ytId:m[1],by:G.name,at:Date.now()});
}
function playVideoById(ytId){
  $('player-box').innerHTML=`
    <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--pink),var(--violet),var(--blue));z-index:2"></div>
    <iframe src="https://www.youtube.com/embed/${ytId}?autoplay=1&rel=0&modestbranding=1"
      allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowfullscreen></iframe>`;
  $('w-status').textContent='● LIVE'; $('w-status').style.color='var(--pink)';
}
function listenVideo(){
  _videoRef=_db.ref(`rooms/${G.code}/video`);
  _videoRef.on('value',snap=>{
    if(!snap.exists())return; const d=snap.val(); if(!d.ytId)return;
    /* everyone plays — this fires on all devices including loader */
    playVideoById(d.ytId);
    addChatMsg('System',`${d.by} loaded a video — all synced!`,'var(--teal)');
  });
}

/* ═══ CHAT ═══ */
function seedChat(){
  if(G.isHost) _db.ref(`rooms/${G.code}/chat`).push({user:'System',text:'Party started! Room: '+G.code,color:'var(--teal)',ts:Date.now()});
}
function listenChat(){
  _chatRef=_db.ref(`rooms/${G.code}/chat`).limitToLast(80);
  _chatRef.on('child_added',snap=>{ const d=snap.val(); addChatMsg(d.user,d.text,d.color); });
}
function addChatMsg(user,text,color){
  const t=nowTime();
  const html=`<div style="animation:fadeIn .2s ease"><div><span class="cm-who" style="color:${color}">${user}</span><span class="cm-time">${t}</span></div><div class="cm-txt">${text}</div></div>`;
  const b=$('chat-msgs'); if(b){b.insertAdjacentHTML('beforeend',html);b.scrollTop=99999;}
}
function sendChat(){
  const i=$('chat-inp'); if(!i?.value.trim())return;
  _db.ref(`rooms/${G.code}/chat`).push({user:G.name,text:i.value.trim(),color:G.color,ts:Date.now()});
  i.value='';
}

/* ═══ GAME LISTENERS ═══ */
function listenAllGames(){
  _gameTTTRef  =_db.ref(`rooms/${G.code}/games/ttt`);
  _gameHMRef   =_db.ref(`rooms/${G.code}/games/hangman`);
  _gameChessRef=_db.ref(`rooms/${G.code}/games/chess`);

  _gameTTTRef.on('value',snap=>{
    if(skipTTT||!snap.exists())return;
    pendingTTT=snap.val();
    if($('gp-ttt')?.classList.contains('on'))applyTTT(pendingTTT);
  });
  _gameHMRef.on('value',snap=>{
    if(skipHM||!snap.exists())return;
    pendingHM=snap.val();
    if($('gp-hm')?.classList.contains('on'))applyHM(pendingHM);
  });
  _gameChessRef.on('value',snap=>{
    if(skipChess||!snap.exists())return;
    pendingChess=snap.val();
    if($('gp-chess')?.classList.contains('on'))applyChess(pendingChess);
  });
}
function pushGame(ref,data,setSkip){
  setSkip(true); ref.set(data); setTimeout(()=>setSkip(false),400);
}

/* ═══ GAME OPEN/CLOSE ═══ */
async function openGame(id){
  $('gz-lobby').style.display='none';
  const panels={ttt:'gp-ttt',hm:'gp-hm',chess:'gp-chess'};
  const panel=$(panels[id]); panel.classList.add('on');
  // load spinner
  const spin=document.createElement('div');
  spin.id='gp-spin';spin.style.cssText='text-align:center;padding:30px;font-family:var(--orb);font-size:10px;color:var(--muted);letter-spacing:2px';
  spin.textContent='LOADING…'; panel.appendChild(spin);
  const refs={ttt:_gameTTTRef,hm:_gameHMRef,chess:_gameChessRef};
  const snap=await refs[id].once('value');
  const sp=$('gp-spin');if(sp)sp.remove();
  const existing=snap.exists()?snap.val():null;
  if(id==='ttt'){
    if(existing){applyTTT(existing);pendingTTT=existing;}
    else if(G.isHost)initTTT();
    else showWaitMsg(panel);
  }
  if(id==='hm'){
    if(existing){applyHM(existing);pendingHM=existing;}
    else if(G.isHost)initHM();
    else showWaitMsg(panel);
  }
  if(id==='chess'){
    if(existing){applyChess(existing);pendingChess=existing;}
    else if(G.isHost)initChess();
    else showWaitMsg(panel);
  }
}
function showWaitMsg(panel){
  const w=document.createElement('div');w.id='gp-wait';
  w.style.cssText='text-align:center;padding:30px 20px;font-family:var(--orb);font-size:10px;color:var(--muted);letter-spacing:2px;line-height:2';
  w.innerHTML='WAITING FOR HOST<br/>TO START THE GAME…';
  panel.appendChild(w);
}
function closeGame(){
  document.querySelectorAll('.gp').forEach(p=>p.classList.remove('on'));
  ['gp-spin','gp-wait'].forEach(id=>{const e=$(id);if(e)e.remove();});
  $('gz-lobby').style.display='block';
}

/* ═══════════════════════════════════════════
   TIC-TAC-TOE — TURN-BASED
   Player order=0 → X (always)
   Player order=1 → O (always)
   currentTurn stores userId of whose turn it is
═══════════════════════════════════════════ */
const TLINES=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
let tB,tR,tTurn; // tTurn = userId of whose turn

function initTTT(){
  const p0=getPlayer(0),p1=getPlayer(1);
  if(!p0||!p1){toast('Need 2 players in room','error');return;}
  tB=Array(9).fill(null); tR=null;
  tTurn=p0.uid; // X (order 0) goes first
  const data={board:tB,turn:tTurn,result:null,scores:{X:0,O:0,D:0},
    playerX:p0.uid,playerO:p1?.uid||null,startedBy:G.name,at:Date.now()};
  const wm=$('gp-wait');if(wm)wm.remove();
  pushGame(_gameTTTRef,data,v=>skipTTT=v);
  addChatMsg('System',G.name+' started Tic-Tac-Toe!','var(--teal)');
}

function tttClick(i){
  if(!tB||tB[i]||tR)return;
  if(!myTurnFor(tTurn)){toast("Not your turn!",'error');return;}
  const newB=[...tB];
  const p0=getPlayer(0),p1=getPlayer(1);
  const isX=G.userId===p0?.uid;
  newB[i]=isX?'X':'O';
  const result=tttCheck(newB);
  // next turn = other player
  const nextTurn=isX?p1?.uid:p0?.uid;
  const scores=pendingTTT?.scores||{X:0,O:0,D:0};
  if(result){
    if(result.w==='draw')scores.D++;
    else scores[result.w]++;
  }
  const data={board:newB,turn:result?null:nextTurn,result:result?JSON.stringify(result):null,
    scores,playerX:p0?.uid,playerO:p1?.uid,at:Date.now()};
  pushGame(_gameTTTRef,data,v=>skipTTT=v);
}

function tttCheck(b){
  for(const[a,c,d]of TLINES) if(b[a]&&b[a]===b[c]&&b[a]===b[d])return{w:b[a],l:[a,c,d]};
  if(b.every(Boolean))return{w:'draw',l:[]};
  return null;
}

function applyTTT(s){
  if(!s)return;
  tB=s.board||Array(9).fill(null);
  tTurn=s.turn;
  tR=s.result?JSON.parse(s.result):null;
  const scores=s.scores||{X:0,O:0,D:0};
  const p0=s.playerX?Object.values(G.members).find(m=>m.uid===s.playerX)||getPlayer(0):getPlayer(0);
  const p1=s.playerO?Object.values(G.members).find(m=>m.uid===s.playerO)||getPlayer(1):getPlayer(1);
  const p0m=sortMembers().find(m=>m.uid===s.playerX)||getPlayer(0);
  const p1m=sortMembers().find(m=>m.uid===s.playerO)||getPlayer(1);
  renderTTT(s,p0m,p1m,scores);
}

function renderTTT(s,p0m,p1m,scores){
  const wl=tR?.l||[];
  const isMyTurn=myTurnFor(tTurn);

  // Turn banner
  const banner=$('ttt-banner');
  const bannerAv=$('ttt-banner-av');
  const bannerTxt=$('ttt-banner-txt');
  const scoreDisp=$('ttt-score-display');
  let turnColor='var(--muted)';
  if(tR){
    banner.style.borderBottomColor='var(--muted)';
    bannerTxt.textContent=tR.w==='draw'?"IT'S A DRAW!":tR.w==='X'?(p0m?.name||'?')+' WINS!':(p1m?.name||'?')+' WINS!';
    bannerTxt.style.color='var(--amber)';
    bannerAv.style.background='rgba(251,191,36,.2)'; bannerAv.style.color='var(--amber)'; bannerAv.textContent='★';
    banner.style.borderBottomColor='var(--amber)';
  } else if(tTurn){
    const turnMem=sortMembers().find(m=>m.uid===tTurn);
    const isX=tTurn===(s.playerX);
    turnColor=isX?'var(--pink)':'var(--teal)';
    banner.style.borderBottomColor=turnColor;
    bannerAv.style.background=isX?'rgba(255,45,120,.18)':'rgba(0,229,195,.18)';
    bannerAv.style.color=turnColor; bannerAv.textContent=turnMem?.init||'?';
    bannerTxt.textContent=(tTurn===G.userId?'YOUR':((turnMem?.name||'?').toUpperCase()+'\'S'))+' TURN · '+(isX?'X':'O');
    bannerTxt.style.color=turnColor;
  }
  scoreDisp.innerHTML=`<span style="color:var(--pink)">${scores.X}</span><span style="color:var(--muted)"> — </span><span style="color:var(--teal)">${scores.O}</span>`;

  // Score boxes
  const sxEl=$('tsx'),soEl=$('tso'),sdEl=$('tsd');
  if(sxEl)sxEl.textContent=scores.X; if(soEl)soEl.textContent=scores.O; if(sdEl)sdEl.textContent=scores.D;
  const txn=$('ttt-x-name'),ton=$('ttt-o-name');
  if(txn)txn.textContent=p0m?.name||'?'; if(ton)ton.textContent=p1m?.name||'?';

  // Player labels
  const px=$('ttt-plx'),po=$('ttt-plo');
  if(px)px.textContent=p0m?.name||'?'; if(po)po.textContent=p1m?.name||'?';

  // Board
  const bd=$('ttt-bd'); if(!bd)return;
  bd.innerHTML=tB.map((c,i)=>{
    const win=wl.includes(i), cc=c==='X'?'var(--pink)':'var(--teal)';
    const canClick=!c&&!tR&&isMyTurn;
    return `<div class="ttt-cell${c?' taken':''}${win?' wc':''}${!canClick&&!c&&!tR?' blocked':''}"
      onclick="tttClick(${i})"
      style="color:${c?cc:'transparent'};background:${win?(c==='X'?'rgba(255,45,120,.1)':'rgba(0,229,195,.1)'):'var(--bg2)'};border-color:${win?cc:'var(--border)'};cursor:${canClick?'pointer':'default'}"
    >${c||''}</div>`;
  }).join('');

  // Buttons
  const btns=$('ttt-btns'); if(!btns)return;
  btns.innerHTML=tR
    ?`<button class="btn btn-teal" style="font-size:10px" onclick="initTTT()">↺ NEW GAME</button>`
    :(isMyTurn?'':`<p style="font-size:10px;color:var(--muted);font-family:var(--orb);letter-spacing:1px">WAITING FOR OPPONENT…</p>`);
}

/* ═══════════════════════════════════════════
   HANGMAN — TURN-BASED
   Both players share guessing turns.
   currentTurn alternates per guess.
═══════════════════════════════════════════ */
const HM_WORDS=['JAVASCRIPT','ELEPHANT','MOUNTAIN','KEYBOARD','UNIVERSE','PENGUIN','CHOCOLATE','QUANTUM','SYMPHONY','BUTTERFLY','ASTRONAUT','LABYRINTH','TELESCOPE','ADVENTURE','ALGORITHM','WATERFALL','DINOSAUR','HURRICANE','COMPUTER','NEBULA','CRYSTAL','ZEPPELIN','PARADOX','ECLIPSE'];
const MAXW=6; const ALP='ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
let hW,hG,hE,hTurn;

function initHM(){
  const p0=getPlayer(0),p1=getPlayer(1);
  if(!p0){toast('Need 2 players in room','error');return;}
  hW=HM_WORDS[Math.floor(Math.random()*HM_WORDS.length)];
  hG=new Set(); hE=0;
  hTurn=p1?.uid||p0.uid; // guest (order=1) guesses first, host picks word
  const wm=$('gp-wait');if(wm)wm.remove();
  const data={word:hW,guessed:[],wrong:0,turn:hTurn,
    playerHost:p0.uid,playerGuest:p1?.uid||null,startedBy:G.name,at:Date.now()};
  pushGame(_gameHMRef,data,v=>skipHM=v);
  addChatMsg('System',G.name+' started Hangman!','var(--pink)');
}

function hmKey(l){
  if(!hW||hG.has(l))return;
  const won=hW.split('').every(c=>hG.has(c)), lost=hE>=MAXW;
  if(won||lost)return;
  if(!myTurnFor(hTurn)){toast("Not your turn!",'error');return;}
  const newG=new Set(hG); newG.add(l);
  const newE=hW.includes(l)?hE:hE+1;
  const newWon=hW.split('').every(c=>newG.has(c)), newLost=newE>=MAXW;
  // alternate turn
  const s=pendingHM||{};
  const p0uid=s.playerHost||getPlayer(0)?.uid;
  const p1uid=s.playerGuest||getPlayer(1)?.uid;
  const nextTurn=(!newWon&&!newLost)?(hTurn===p1uid?p0uid:p1uid):null;
  const data={...s,guessed:[...newG],wrong:newE,turn:nextTurn};
  pushGame(_gameHMRef,data,v=>skipHM=v);
}

function applyHM(s){
  if(!s)return;
  hW=s.word||HM_WORDS[0]; hG=new Set(s.guessed||[]); hE=s.wrong||0; hTurn=s.turn;
  renderHM(s);
}

function drawGallows(e){
  const svg=$('hm-svg');if(!svg)return;
  svg.innerHTML=`<line x1="14" y1="150" x2="166" y2="150" stroke="#00e5c3" stroke-width="2"/>
    <line x1="48" y1="150" x2="48" y2="8" stroke="#00e5c3" stroke-width="2"/>
    <line x1="48" y1="8" x2="108" y2="8" stroke="#00e5c3" stroke-width="2"/>
    <line x1="108" y1="8" x2="108" y2="22" stroke="#00e5c3" stroke-width="2"/>
    ${[`<circle cx="108" cy="36" r="13" stroke="#ff2d78" stroke-width="2.5" fill="none"/>`,
       `<line x1="108" y1="49" x2="108" y2="94" stroke="#ff2d78" stroke-width="2.5"/>`,
       `<line x1="108" y1="63" x2="86" y2="83" stroke="#ff2d78" stroke-width="2.5"/>`,
       `<line x1="108" y1="63" x2="130" y2="83" stroke="#ff2d78" stroke-width="2.5"/>`,
       `<line x1="108" y1="94" x2="86" y2="122" stroke="#ff2d78" stroke-width="2.5"/>`,
       `<line x1="108" y1="94" x2="130" y2="122" stroke="#ff2d78" stroke-width="2.5"/>`].slice(0,e).join('')}`;
}

function renderHM(s){
  const wd=$('hm-wd');if(!wd)return;
  drawGallows(hE);
  const won=hW.split('').every(l=>hG.has(l)), lost=hE>=MAXW;
  const isMyTurn=myTurnFor(hTurn);
  const p0m=sortMembers().find(m=>m.uid===s.playerHost)||getPlayer(0);
  const p1m=sortMembers().find(m=>m.uid===s.playerGuest)||getPlayer(1);

  // Banner
  const banner=$('hm-banner'), bav=$('hm-banner-av'), btxt=$('hm-banner-txt'), attDisp=$('hm-attempts-display');
  if(won||lost){
    banner.style.borderBottomColor=won?'var(--teal)':'var(--pink)';
    btxt.textContent=won?'🎉 WORD GUESSED!':'GAME OVER!'; btxt.style.color=won?'var(--teal)':'var(--pink)';
    bav.style.background=won?'rgba(0,229,195,.18)':'rgba(255,45,120,.18)'; bav.style.color=won?'var(--teal)':'var(--pink)'; bav.textContent=won?'✓':'✗';
  } else if(hTurn){
    const turnMem=sortMembers().find(m=>m.uid===hTurn);
    const c=hTurn===G.userId?'var(--teal)':'var(--muted2)';
    banner.style.borderBottomColor=c; btxt.style.color=c;
    bav.style.background=hTurn===G.userId?'rgba(0,229,195,.18)':'rgba(255,255,255,.05)';
    bav.style.color=turnMem?.color||'var(--text)'; bav.textContent=turnMem?.init||'?';
    btxt.textContent=(hTurn===G.userId?'YOUR':((turnMem?.name||'?').toUpperCase()+'\'S'))+' TURN';
  }
  attDisp.innerHTML=`<span style="color:${hE>3?'var(--pink)':'var(--teal)'}">${MAXW-hE}</span><span style="color:var(--muted)">/${MAXW}</span>`;

  wd.innerHTML=hW.split('').map(l=>`<div class="l-box" style="border-color:${hG.has(l)?'var(--pink)':'var(--border)'};color:${hG.has(l)?'var(--text)':'transparent'}">${l}</div>`).join('');
  const st=$('hm-st');if(st){st.textContent=won?'YOU WIN!':lost?'GAME OVER — WORD: '+hW:(MAXW-hE)+' GUESSES REMAIN';st.style.color=won?'var(--teal)':lost?'var(--pink)':'var(--muted2)';}
  const pf=$('hm-pf');if(pf){pf.style.width=Math.round(((MAXW-hE)/MAXW)*100)+'%';pf.style.background=hE>3?'var(--pink)':'var(--teal)';}
  const kb=$('hm-kb');if(kb) kb.innerHTML=ALP.map(l=>{
    const u=hG.has(l),h=u&&hW.includes(l),m2=u&&!hW.includes(l);
    const canGuess=!u&&!won&&!lost&&isMyTurn;
    return `<button class="k${h?' hit':m2?' miss':''}${!canGuess&&!u?' blocked':''}" onclick="hmKey('${l}')" ${u||won||lost?'disabled':''}>${l}</button>`;
  }).join('');
  const hb=$('hm-btns');if(hb)hb.innerHTML=(won||lost)
    ?`<button class="btn btn-primary" style="font-size:10px" onclick="initHM()">↺ NEW WORD</button>`
    :(!isMyTurn?`<p style="font-size:10px;color:var(--muted);font-family:var(--orb);letter-spacing:1px">WAITING FOR OPPONENT…</p>`:'');
}

/* ═══════════════════════════════════════════
   CHESS — TURN-BASED
   Host = White (order 0), Guest = Black (order 1)
   cTurnUid = userId whose turn it is
═══════════════════════════════════════════ */
const CH_INIT=['br','bn','bb','bq','bk','bb','bn','br','bp','bp','bp','bp','bp','bp','bp','bp',...Array(32).fill(null),'wp','wp','wp','wp','wp','wp','wp','wp','wr','wn','wb','wq','wk','wb','wn','wr'];
const CH_SYM={wk:'♔',wq:'♕',wr:'♖',wb:'♗',wn:'♘',wp:'♙',bk:'♚',bq:'♛',br:'♜',bb:'♝',bn:'♞',bp:'♟'};
let cB,cSel,cLegal,cTurnUid,cCap,cMoveCount,cLastMove,cWhiteUid,cBlackUid;

function initChess(){
  const p0=getPlayer(0),p1=getPlayer(1);
  if(!p0){toast('Need 2 players','error');return;}
  cWhiteUid=p0.uid; cBlackUid=p1?.uid||null;
  cB=[...CH_INIT];cSel=null;cLegal=[];cTurnUid=p0.uid;cCap={w:[],b:[]};cMoveCount=0;cLastMove=null;
  const wm=$('gp-wait');if(wm)wm.remove();
  const data={board:cB,turnUid:cTurnUid,whiteUid:cWhiteUid,blackUid:cBlackUid,capW:[],capB:[],moves:0,last:null,at:Date.now()};
  pushGame(_gameChessRef,data,v=>skipChess=v);
  addChatMsg('System',G.name+' started Chess!','var(--amber)');
}

function applyChess(s){
  if(!s)return;
  cB=s.board||[...CH_INIT]; cTurnUid=s.turnUid; cWhiteUid=s.whiteUid; cBlackUid=s.blackUid;
  cCap={w:s.capW||[],b:s.capB||[]}; cMoveCount=s.moves||0; cLastMove=s.last||null;
  cSel=null;cLegal=[];
  renderChess(s);
}

function chMoves(board,idx){
  const p=board[idx];if(!p)return[];
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

function chClick(idx){
  if(!myTurnFor(cTurnUid)){toast("Not your turn!",'error');return;}
  const myColor=G.userId===cWhiteUid?'w':'b';
  if(cSel===null){
    if(cB[idx]?.[0]===myColor){cSel=idx;cLegal=chMoves(cB,idx);renderChessLocal();}
  } else {
    if(cLegal.includes(idx)){
      const nb=[...cB],moved=nb[cSel],cap=nb[idx];
      nb[idx]=moved;nb[cSel]=null;
      if(moved==='wp'&&Math.floor(idx/8)===0)nb[idx]='wq';
      if(moved==='bp'&&Math.floor(idx/8)===7)nb[idx]='bq';
      const newCapW=[...cCap.w],newCapB=[...cCap.b];
      if(cap){if(myColor==='w')newCapW.push(cap);else newCapB.push(cap);}
      const nextTurn=G.userId===cWhiteUid?cBlackUid:cWhiteUid;
      const data={board:nb,turnUid:nextTurn,whiteUid:cWhiteUid,blackUid:cBlackUid,
        capW:newCapW,capB:newCapB,moves:cMoveCount+1,last:[cSel,idx],at:Date.now()};
      cSel=null;cLegal=[];
      pushGame(_gameChessRef,data,v=>skipChess=v);
    } else if(cB[idx]?.[0]===myColor){cSel=idx;cLegal=chMoves(cB,idx);renderChessLocal();}
    else{cSel=null;cLegal=[];renderChessLocal();}
  }
}

function renderChessLocal(){
  // re-render just the board squares with current sel/legal highlights
  const bd=$('ch-bd');if(!bd)return;
  renderChessBoardOnly();
}

function renderChess(s){
  // banner
  const wMem=sortMembers().find(m=>m.uid===cWhiteUid)||getPlayer(0);
  const bMem=sortMembers().find(m=>m.uid===cBlackUid)||getPlayer(1);
  const banner=$('ch-banner'),btxt=$('ch-banner-txt'),dot=$('ch-turn-dot'),mv=$('ch-move-cnt');
  const isWhiteTurn=cTurnUid===cWhiteUid;
  const c=isWhiteTurn?'var(--amber)':'var(--muted2)';
  banner.style.borderBottomColor=c; btxt.style.color=c;
  dot.style.background=isWhiteTurn?'#f2f2ff':'#111827';
  btxt.textContent=(cTurnUid===G.userId?'YOUR':((sortMembers().find(m=>m.uid===cTurnUid)?.name||'?').toUpperCase()+'\'S'))+' TURN · '+(isWhiteTurn?'WHITE':'BLACK');
  if(mv)mv.textContent='MOVE '+cMoveCount;

  // name labels
  const wn=$('ch-white-name'),bn=$('ch-black-name');
  if(wn)wn.textContent=wMem?.name||'?'; if(bn)bn.textContent=bMem?.name||'?';

  // captured
  const fmt=arr=>arr.length?arr.map(p=>`<span style="opacity:.75">${CH_SYM[p]}</span>`).join(''):'<span style="color:var(--muted);font-size:10px">none</span>';
  const wc=$('ch-wcap'),bc=$('ch-bcap');
  if(wc)wc.innerHTML=fmt(cCap.w); if(bc)bc.innerHTML=fmt(cCap.b);

  // status
  const st=$('ch-status');
  if(st)st.textContent=cTurnUid===G.userId?'YOUR MOVE':'THEIR MOVE';

  renderChessBoardOnly();
}

function renderChessBoardOnly(){
  const bd=$('ch-bd');if(!bd)return;
  // auto-size squares
  const availW=Math.min(window.innerWidth-32,400);
  const sq=Math.floor(availW/8);
  bd.style.setProperty('--sq',sq+'px');
  bd.innerHTML=cB.map((p,i)=>{
    const row=Math.floor(i/8),col=i%8,lt=(row+col)%2===0;
    const isSel=cSel===i,isL=cLegal.includes(i),isCap=isL&&!!p,isLst=cLastMove&&(i===cLastMove[0]||i===cLastMove[1]);
    let cls=`sq ${lt?'ls':'ds'}`;
    if(isSel)cls+=' sel';else if(isLst)cls+=' lm';
    if(isL&&!p)cls+=' leg';if(isCap)cls+=' cap';
    const myColor=G.userId===cWhiteUid?'w':'b';
    const canInteract=myTurnFor(cTurnUid)&&(isSel||isL||(p?.[0]===myColor));
    if(!canInteract&&!isSel&&!isL)cls+=' blocked';
    return `<div class="${cls}" onclick="chClick(${i})">${p?`<span class="cp ${p[0]==='w'?'w':'b'}">${CH_SYM[p]}</span>`:''}</div>`;
  }).join('');
}

/* ═══ PWA ═══ */
if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));

window.addEventListener('DOMContentLoaded',()=>{
  const code=new URLSearchParams(window.location.search).get('join');
  if(code){const ci=$('code-inp');if(ci)ci.value=code.toUpperCase();const jb=$('join-box');if(jb)jb.style.display='block';}
  checkFirebase();
});
window.addEventListener('resize',()=>{ if($('ch-bd')&&$('gp-chess')?.classList.contains('on'))renderChessBoardOnly(); });

/* ── EXPOSE ── */
window.onName=onName;window.go2=go2;window.toggleJoin=toggleJoin;window.fmtCode=fmtCode;
window.doCreate=doCreate;window.doJoin=doJoin;window.copyCode=copyCode;window.copyLink=copyLink;
window.openWR=openWR;window.hostStart=hostStart;
window.goTab=goTab;window.goTabByName=goTabByName;window.goTabMob=goTabMob;
window.loadVid=loadVid;window.sendChat=sendChat;
window.openGame=openGame;window.closeGame=closeGame;
window.tttClick=tttClick;window.initTTT=initTTT;
window.hmKey=hmKey;window.initHM=initHM;
window.chClick=chClick;window.initChess=initChess;
window.toggleMic=toggleMic;window.toggleCam=toggleCam;window.leaveCall=leaveCall;