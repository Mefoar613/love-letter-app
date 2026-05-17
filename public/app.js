// =====================================================================
// Тёмная Дуэль — Frontend v11
// =====================================================================
const tg=window.Telegram?.WebApp;
if(tg){tg.ready();tg.expand();tg.setHeaderColor?.('#08050f');tg.setBackgroundColor?.('#08050f');}
const tgUser=tg?.initDataUnsafe?.user;
const ME={id:tgUser?`tg_${tgUser.id}`:`g_${Math.random().toString(36).slice(2,9)}`,name:tgUser?[tgUser.first_name,tgUser.last_name].filter(Boolean).join(' '):'Гость',avatar:tgUser?.photo_url||null};
const BOT_LINK="https://t.me/PumpHuntRealBot/POGNALI";
const IS_ADMIN = ME.id === 'tg_1095004987';

const CARDS={
  0:{name:'Информатор',total:2,desc:'Ничего при розыгрыше. В конце раунда, если ты единственный выживший с Информатором — +1 жетон.'},
  1:{name:'Детектив',total:6,desc:'Назови карту (не Детектив). Если у соперника она — он выбывает.'},
  2:{name:'Журналист',total:2,desc:'Тайно посмотри карту соперника.'},
  3:{name:'Громила',total:2,desc:'Сравните карты. У кого ниже — выбывает. Ничья — никто.'},
  4:{name:'Продажный коп',total:2,desc:'До следующего хода ты под защитой.'},
  5:{name:'Федерал',total:2,desc:'Выбери игрока. Он сбрасывает карту и берёт новую. Компромат=выбывает.'},
  6:{name:'Теневой брокер',total:2,desc:'Возьми 2 из колоды. Оставь 1 из 3, остальные вниз колоды.'},
  7:{name:'Босс мафии',total:1,desc:'Поменяйся картами с соперником.'},
  8:{name:'Роковая женщина',total:1,desc:'Нет эффекта. Если в руке Федерал(5) или Босс(7) — обязан сыграть.'},
  9:{name:'Компромат',total:1,desc:'Сбросишь — выбываешь.'},
};
const AVAILABLE_BACKS=[{id:'back',name:'Классика'},{id:'back_noir',name:'Нуар'},{id:'back_red',name:'Кровь'},{id:'back_gold',name:'Золото'},{id:'back_smoke',name:'Дым'}];
let mySelectedBack='back';

// ─── РЕЖИМ ИГРЫ ───
let gameMode = 'normal'; // 'normal' | 'fast'
let musicEnabled = true;

// ─── ЗВУК ───
const bgm=document.getElementById('bgm');
const lohSound=document.getElementById('loh-sound');
bgm.volume=.38;
let musicStarted=false;
function startMusic(){if(musicStarted||!musicEnabled)return;musicStarted=true;bgm.play().catch(()=>{musicStarted=false;});}
let audioCtx=null;
function playSound(type='click'){try{if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();const n=audioCtx.currentTime,o=audioCtx.createOscillator(),g=audioCtx.createGain();o.connect(g);g.connect(audioCtx.destination);
if(type==='click'){o.type='triangle';o.frequency.setValueAtTime(800,n);o.frequency.exponentialRampToValueAtTime(380,n+.07);g.gain.setValueAtTime(.13,n);g.gain.exponentialRampToValueAtTime(.001,n+.09);o.start(n);o.stop(n+.1);}
if(type==='card'){o.type='sine';o.frequency.setValueAtTime(320,n);o.frequency.exponentialRampToValueAtTime(160,n+.18);g.gain.setValueAtTime(.18,n);g.gain.exponentialRampToValueAtTime(.001,n+.22);o.start(n);o.stop(n+.25);}
if(type==='clash'){o.type='square';o.frequency.setValueAtTime(150,n);o.frequency.exponentialRampToValueAtTime(50,n+.3);g.gain.setValueAtTime(.3,n);g.gain.exponentialRampToValueAtTime(.001,n+.4);o.start(n);o.stop(n+.5);}
if(type==='burn'){o.type='sawtooth';o.frequency.setValueAtTime(100,n);o.frequency.linearRampToValueAtTime(200,n+.5);g.gain.setValueAtTime(.2,n);g.gain.linearRampToValueAtTime(.001,n+.6);o.start(n);o.stop(n+.7);}
if(type==='magic'){o.type='sine';o.frequency.setValueAtTime(400,n);o.frequency.exponentialRampToValueAtTime(800,n+.4);g.gain.setValueAtTime(.1,n);g.gain.exponentialRampToValueAtTime(.001,n+.5);o.start(n);o.stop(n+.6);}
if(type==='success'){o.type='sine';o.frequency.setValueAtTime(523,n);o.frequency.setValueAtTime(659,n+.15);o.frequency.setValueAtTime(784,n+.3);g.gain.setValueAtTime(.15,n);g.gain.exponentialRampToValueAtTime(.001,n+.5);o.start(n);o.stop(n+.55);}
if(type==='fail'){o.type='sawtooth';o.frequency.setValueAtTime(200,n);o.frequency.exponentialRampToValueAtTime(80,n+.4);g.gain.setValueAtTime(.2,n);g.gain.exponentialRampToValueAtTime(.001,n+.5);o.start(n);o.stop(n+.55);}
}catch(e){}}
document.body.addEventListener('click',e=>{if(e.target.closest('.btn,.am-opt,.g-deck-btn,.g-log-strip,.play-arrow,.chancellor-option,.lb-card,.back-option,.lc-slot,#intro,.btn-close-bottom,.do-row'))playSound('click');},true);
function triggerVibe(t='medium'){if(tg?.HapticFeedback)tg.HapticFeedback.impactOccurred(t);}
function shakeScreen(){const g=document.getElementById('game');g.classList.remove('shake-screen');void g.offsetWidth;g.classList.add('shake-screen');triggerVibe('heavy');playSound('clash');}

// ─── ЭКРАНЫ ───
function showScreen(id){document.querySelectorAll('.screen').forEach(s=>s.classList.toggle('active',s.id===id));}

// ─── ЗАСТАВКА ───
let introStep=0;const introLayers=document.querySelectorAll('.intro-layer'),introHint=document.querySelector('.intro-hint');
function advanceIntro(){startMusic();if(introStep<introLayers.length){introLayers[introStep].classList.add('show');introStep++;if(introStep===introLayers.length)introHint.textContent='тапни, чтобы войти';}else{document.getElementById('intro').removeEventListener('click',advanceIntro);setTimeout(()=>showScreen('menu'),220);}}
window.addEventListener('load',()=>{
  advanceIntro();
  document.getElementById('intro').addEventListener('click',advanceIntro);
  connectSocket();
  if(IS_ADMIN)document.getElementById('admin-panel').style.display='flex';
  const sp=tg?.initDataUnsafe?.start_param;
  if(sp){document.getElementById('intro').classList.remove('active');showScreen('menu');setTimeout(()=>{socket.emit('join_lobby',{lobbyId:sp,user:ME});showScreen('lobby');},500);}
});

// ═══ SOCKET ═══
let socket=null,currentLobby=null;
function connectSocket(){
  if(socket?.connected)return;socket=io({transports:['websocket','polling']});
  socket.on('connect',()=>socket.emit('get_player_data',ME.id));
  socket.on('player_data',d=>{document.getElementById('stat-wins').textContent=d.wins||0;document.getElementById('stat-losses').textContent=d.losses||0;mySelectedBack=d.selectedBack||'back';});
  socket.on('back_updated',b=>{mySelectedBack=b;renderBacks();});
  socket.on('lobby_list',renderLobbyList);
  socket.on('lobby_joined',onLobbyJoined);
  socket.on('game_started',()=>{showScreen('game');closeAllOverlays();resetGameState();});
  socket.on('vfx',data=>{if(busyAnimating||isOverlayOpen())stateQueue.push({type:'vfx',payload:data});else handleVFX(data);});
  socket.on('new_round',()=>closeAllOverlays());
  socket.on('state',s=>handleNewState(s));
  socket.on('peek',d=>showPeek(d));
  socket.on('chancellor_choice',d=>showChancellor(d.cards));
  socket.on('rematch_pending',({count})=>{document.getElementById('go-pending').textContent=count>=1?'Ждём…':'';});
  socket.on('opponent_left',()=>{showToast('Соперник ушёл');setTimeout(goToMenu,1800);});
  socket.on('player_surrendered',({name})=>{
    document.getElementById('surrender-text').textContent=`💀 ${name} позорно слился!`;
    document.getElementById('surrender-notice').classList.add('show');
    setTimeout(()=>document.getElementById('surrender-notice').classList.remove('show'),3000);
  });
  socket.on('error_msg',msg=>showToast(msg));

  // Admin VFX
  socket.on('admin_vfx',data=>{
    if(data.type==='loh')showRainbowLoh();
  });
  socket.on('tomato_vfx',()=>showTomatoFly());
}

// ═══ НАСТРОЙКИ ═══
function openSettings(){
  document.getElementById('toggle-fast-mode').checked = gameMode==='fast';
  document.getElementById('toggle-music').checked = musicEnabled;
  updateModeLabels();
  document.getElementById('settings-overlay').classList.add('show');
}
function updateModeLabels(){
  const isFast = gameMode==='fast';
  document.getElementById('stg-normal').classList.toggle('active',!isFast);
  document.getElementById('stg-fast').classList.toggle('active',isFast);
}
document.getElementById('btn-settings-menu').addEventListener('click',openSettings);
document.getElementById('btn-settings-game').addEventListener('click',openSettings);
document.getElementById('settings-close').addEventListener('click',()=>document.getElementById('settings-overlay').classList.remove('show'));
document.getElementById('toggle-fast-mode').addEventListener('change',e=>{
  gameMode=e.target.checked?'fast':'normal';
  updateModeLabels();
});
document.getElementById('toggle-music').addEventListener('change',e=>{
  musicEnabled=e.target.checked;
  if(musicEnabled){bgm.play().catch(()=>{});}
  else{bgm.pause();}
});

// ═══ ADMIN ═══
document.getElementById('btn-admin-loh').addEventListener('click',()=>{
  socket?.emit('admin_loh');
});
document.getElementById('btn-admin-tomato').addEventListener('click',()=>{
  socket?.emit('throw_tomato');
});

// ─── Rainbow LOH animation ───
function showRainbowLoh(){
  if(lohSound){lohSound.currentTime=0;lohSound.play().catch(()=>{});}
  const overlay=document.createElement('div');
  overlay.className='rainbow-loh-overlay';
  const word='ЛОООООХ';
  // Заполняем экран словами
  for(let i=0;i<36;i++){
    const el=document.createElement('span');
    el.className='rainbow-loh-item';
    el.textContent=word;
    const size=36+Math.random()*52;
    el.style.fontSize=size+'px';
    el.style.animationDuration=`.${3+Math.floor(Math.random()*3)}s,${1.2+Math.random()*1.5}s`;
    el.style.animationDelay=`${Math.random()*.4}s,${Math.random()*1.5}s`;
    overlay.appendChild(el);
  }
  document.body.appendChild(overlay);
  setTimeout(()=>{
    overlay.style.opacity='0';
    overlay.style.transition='opacity .4s';
    setTimeout(()=>overlay.remove(),400);
  },2200);
}

// ─── Tomato animation ───
function showTomatoFly(){
  const el=document.createElement('div');
  el.className='tomato-fly';
  el.textContent='🍅';
  document.body.appendChild(el);
  setTimeout(()=>el.remove(),1600);
}

// ─── Event text banner ───
let eventBannerTimer=null;
function showEventText(text,duration=2200){
  if(gameMode==='fast')return;
  const banner=document.getElementById('event-banner');
  banner.textContent=text;
  banner.classList.add('show');
  clearTimeout(eventBannerTimer);
  eventBannerTimer=setTimeout(()=>banner.classList.remove('show'),duration);
}

// ═══ МЕНЮ ═══
document.getElementById('btn-play').addEventListener('click',()=>showScreen('lobby-browser'));
document.getElementById('btn-backs').addEventListener('click',()=>{renderBacks();showScreen('backs');});
document.getElementById('btn-tutorial').addEventListener('click',startTutorial);

// ═══ ЛОББИ БРАУЗЕР ═══
document.getElementById('lb-back').addEventListener('click',()=>showScreen('menu'));
document.getElementById('btn-create-lobby').addEventListener('click',()=>{renderCreateLobby();showScreen('lobby-create');});
function renderLobbyList(list){
  const el=document.getElementById('lb-list');el.innerHTML='';
  if(!list||!list.length){el.innerHTML='<div class="lb-empty">Нет открытых лобби. Создай своё!</div>';return;}
  list.forEach(l=>{
    const card=document.createElement('div');card.className='lb-card';
    card.innerHTML=`<div class="lb-card-info"><div class="lb-card-name">${esc(l.creatorName)}</div><div class="lb-card-count">${l.playerCount}/${l.maxPlayers} игроков</div></div>`;
    const btn=document.createElement('button');btn.className='btn btn-secondary';btn.innerHTML='<span>Войти</span>';
    btn.addEventListener('click',()=>{socket.emit('join_lobby',{lobbyId:l.id,user:ME});showScreen('lobby');});
    card.appendChild(btn);el.appendChild(card);
  });
}

// ═══ СОЗДАНИЕ ЛОББИ ═══
let createSlotCount=2;
document.getElementById('lc-back').addEventListener('click',()=>showScreen('lobby-browser'));
function renderCreateLobby(){createSlotCount=2;updateCreateSlots();}
function updateCreateSlots(){
  const el=document.getElementById('lc-slots');el.innerHTML='';
  el.innerHTML='<div class="lc-slot lc-slot--you">Вы</div>';
  for(let i=1;i<createSlotCount;i++){
    const s=document.createElement('div');s.className='lc-slot lc-slot--added';
    s.innerHTML=`<span>Слот ${i+1}</span><div class="lc-remove" data-idx="${i}">✕</div>`;
    el.appendChild(s);
  }
  if(createSlotCount<4){
    const add=document.createElement('div');add.className='lc-slot lc-slot--empty';add.textContent='＋';
    add.addEventListener('click',()=>{if(createSlotCount<4){createSlotCount++;updateCreateSlots();}});
    el.appendChild(add);
  }
  el.querySelectorAll('.lc-remove').forEach(btn=>{
    btn.addEventListener('click',e=>{e.stopPropagation();if(createSlotCount>2){createSlotCount--;updateCreateSlots();}});
  });
}
document.getElementById('lc-create-btn').addEventListener('click',()=>{
  socket.emit('create_lobby',{user:ME,maxPlayers:createSlotCount});showScreen('lobby');
});

// ═══ ВНУТРИ ЛОББИ ═══
function onLobbyJoined(lobby){
  currentLobby=lobby;document.getElementById('lobby-room-id').textContent=lobby.id;
  const amCreator=lobby.creatorId===ME.id;
  const c=document.getElementById('lobby-players');c.innerHTML='';
  for(let i=0;i<lobby.maxPlayers;i++){
    const p=lobby.players[i],el=document.createElement('div');el.className='lobby-player';
    if(p)el.innerHTML=`<div class="lobby-player-avatar"${p.avatar?` style="background-image:url('${p.avatar}')"`:''}>${p.isBot?'🤖':''}</div><div class="lobby-player-name">${esc(p.name)}</div>`;
    else{el.style.opacity='.4';el.innerHTML='<div class="lobby-player-avatar" style="border-style:dashed">?</div><div class="lobby-player-name">пусто</div>';}
    c.appendChild(el);
  }
  const actions=document.getElementById('lobby-actions'),wait=document.getElementById('lobby-wait');
  if(amCreator){actions.style.display='flex';wait.style.display='none';
    document.getElementById('btn-start-game').style.display=lobby.playerCount>=2?'flex':'none';
    document.getElementById('btn-add-bot').style.display=lobby.playerCount<lobby.maxPlayers?'flex':'none';
  } else{actions.style.display='none';wait.style.display='flex';}
}
document.getElementById('btn-start-game').addEventListener('click',()=>socket.emit('start_game'));
document.getElementById('btn-add-bot').addEventListener('click',()=>socket.emit('add_bot'));
document.getElementById('btn-leave-lobby').addEventListener('click',leaveLobby);
document.getElementById('btn-leave-lobby2').addEventListener('click',leaveLobby);
function leaveLobby(){socket.emit('leave_lobby');currentLobby=null;showScreen('lobby-browser');}
document.getElementById('btn-invite-friend').addEventListener('click',()=>{
  if(!currentLobby)return;const link=`${BOT_LINK}?startapp=${currentLobby.id}`;
  if(tg?.openTelegramLink)tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('ПОГНАЛИ!')}`);
  else{navigator.clipboard?.writeText(link);showToast('Ссылка скопирована!');}
});

// ═══ РУБАШКИ ═══
document.getElementById('backs-back').addEventListener('click',()=>showScreen('menu'));
function renderBacks(){
  const grid=document.getElementById('backs-grid');grid.innerHTML='';
  AVAILABLE_BACKS.forEach(b=>{
    const opt=document.createElement('div');opt.className='back-option'+(b.id===mySelectedBack?' selected':'');
    opt.innerHTML=`<img src="assets/backs/${b.id}.png" onerror="this.src='assets/cards/back.png'" alt="${b.name}"/><div class="back-option-name">${b.name}</div>`;
    opt.addEventListener('click',()=>{socket.emit('set_back',{userId:ME.id,backName:b.id});mySelectedBack=b.id;renderBacks();});
    grid.appendChild(opt);
  });
}

// ═══ ОБУЧЕНИЕ ═══
const TUTORIAL_STEPS=[
  {text:'Добро пожаловать в Тёмную Дуэль! Это карточная игра на логику, блеф и дедукцию. Давай я покажу тебе как играть.'},
  {text:'В колоде 21 карта с номиналами от 0 до 9. В начале раунда каждому игроку сдаётся по 1 карте. Ещё 1 карта откладывается втёмную, а 3 — открытыми (для игры вдвоём).'},
  {text:'На своём ходу ты берёшь 1 карту из колоды (она приходит автоматически). Теперь у тебя 2 карты — выбери одну и сыграй её.',cards:'hand',highlight:'arrow'},
  {text:'У каждой карты есть свой эффект. Тапни по карте, чтобы узнать, что она делает. А стрелка сверху — это кнопка «Сыграть».'},
  {text:'Карта 1 — Детектив. Самая частая карта (6 штук). Назови номинал карты соперника. Угадал? Соперник выбывает!'},
  {text:'Карта 3 — Громила. Сравниваете карты с соперником. У кого номинал ниже — тот выбывает. Опасная штука!'},
  {text:'Карта 4 — Продажный коп. Защищает тебя до следующего хода. Никакие эффекты на тебя не действуют.'},
  {text:'Карта 9 — Компромат. Самая ценная карта (номинал 9). НО: если ты её сбросишь или тебя заставят — ты проигрываешь раунд!'},
  {text:'Карта 8 — Роковая женщина. Если у тебя на руке одновременно 8 и (5 или 7) — обязан сыграть восьмёрку.'},
  {text:'Раунд заканчивается когда: все кроме одного выбыли, или кончилась колода (побеждает тот, у кого номинал карты выше).'},
  {text:'Побеждает тот, кто первый наберёт нужное число жетонов: 6 для двоих, 5 для троих, 4 для четверых.'},
  {text:'Счётчик «Видено X/Y» на карте показывает сколько карт этого типа ты уже видел. Используй эту информацию для блефа и дедукции!'},
  {text:'Ты готов! Жми «Играть» в меню, создай лобби, добавь бота или пригласи друга. Удачи в дуэли! 🎴'},
];
let tutStep=0;
function startTutorial(){tutStep=0;showScreen('tutorial');renderTutStep();}
function renderTutStep(){
  try{
    if(tutStep>=TUTORIAL_STEPS.length){showScreen('menu');return;}
    const step=TUTORIAL_STEPS[tutStep];
    const textEl=document.getElementById('tut-text');if(textEl)textEl.textContent=step.text;
    const gameArea=document.getElementById('tut-game-area');if(gameArea)gameArea.innerHTML='';
    const cardsRow=document.createElement('div');cardsRow.className='tut-cards';
    const addCard=(val,hl)=>{const c=makeCard({value:val},true,'card--big',mySelectedBack);if(hl)c.classList.add('tut-highlight');cardsRow.appendChild(c);return c;};
    if(tutStep===1)cardsRow.appendChild(makeCard(null,false,'card--big',mySelectedBack));
    else if(tutStep===2){const wrap=document.createElement('div');wrap.className='play-arrow-wrap';const c=makeCard({value:1},true,'card--big',mySelectedBack);c.classList.add('my-turn-glow');const arr=document.createElement('div');arr.className='play-arrow';wrap.appendChild(arr);wrap.appendChild(c);const c2=makeCard({value:3},true,'card--big',mySelectedBack);cardsRow.appendChild(wrap);cardsRow.appendChild(c2);}
    else if(tutStep===4)addCard(1,true);
    else if(tutStep===5)addCard(3,true);
    else if(tutStep===6)addCard(4,true);
    else if(tutStep===7)addCard(9,true);
    else if(tutStep===8){addCard(8,true);addCard(5,false);}
    if(gameArea&&cardsRow.children.length>0)gameArea.appendChild(cardsRow);
    const nextBtn=document.getElementById('tut-next');
    if(nextBtn)nextBtn.querySelector('span').textContent=(tutStep===TUTORIAL_STEPS.length-1)?'Начать играть!':'Далее';
    playSound('card');
  }catch(e){alert('Ошибка: '+e.message);}
}
document.getElementById('tut-next').addEventListener('click',()=>{tutStep++;renderTutStep();});
document.getElementById('tut-skip').addEventListener('click',()=>showScreen('menu'));

// ═══ ИГРОВОЕ СОСТОЯНИЕ ═══
let lastState=null,pendingCard=null,pendingCardElement=null;
let stateQueue=[],busyAnimating=false,prevOppDiscardLen=0;
let activeRevealCard=null;
function isOverlayOpen(){return document.querySelectorAll('.overlay.show:not(#round-over):not(#game-over):not(#surrender-notice):not(#settings-overlay)').length>0;}
function flushQueue(){if(stateQueue.length>0&&!busyAnimating&&!isOverlayOpen()){const next=stateQueue.shift();if(next.type==='state')processState(next.payload);else if(next.type==='vfx')handleVFX(next.payload);}}
function resetGameState(){lastState=null;pendingCard=null;pendingCardElement=null;stateQueue=[];busyAnimating=false;prevOppDiscardLen=0;activeRevealCard=null;document.getElementById('vfx-layer').innerHTML='';document.getElementById('event-banner').classList.remove('show');}

function handleNewState(s){if(busyAnimating||isOverlayOpen()){stateQueue.push({type:'state',payload:s});return;}processState(s);}

function processState(s){
  const isFirst=!lastState;
  const mainOpp=s.opponents?.[0];
  const oppPlayed=!isFirst&&mainOpp&&(mainOpp.discard?.length||0)>prevOppDiscardLen;

  if(oppPlayed&&gameMode==='normal'){
    const playedCard=mainOpp.discard[mainOpp.discard.length-1];
    busyAnimating=true;updateLogStrip(s.log);
    animateOppRevealPart1(playedCard,mainOpp.back||'back',()=>{
      // Показываем event text из VFX или лога
      const queuedVfx=stateQueue.find(q=>q.type==='vfx');
      if(queuedVfx?.payload?.message){
        showEventText(queuedVfx.payload.message,2000);
      } else {
        const sig=s.log?.filter(l=>!l.startsWith('—')&&!l.startsWith('Первый')).slice(-1)[0];
        if(sig)showEventText(sig,1800);
      }
      const vfxIdx=stateQueue.findIndex(q=>q.type==='vfx');
      if(vfxIdx>=0){const vfx=stateQueue.splice(vfxIdx,1)[0];handleVFX(vfx.payload,()=>{animateOppRevealPart2(()=>finishProcess(s));});}
      else setTimeout(()=>animateOppRevealPart2(()=>finishProcess(s)),2000);
    });
  } else {
    if(lastState&&lastState.me&&!lastState.me.eliminated&&s.me&&s.me.eliminated)shakeScreen();
    finishProcess(s);
  }
}

function finishProcess(s){
  lastState=s;prevOppDiscardLen=s.opponents?.[0]?.discard?.length||0;
  renderState(s);busyAnimating=false;flushQueue();
}

// ─── Анимация карты соперника: Part1 — вылет к экрану, Part2 — в сброс ───
function animateOppRevealPart1(playedCard,backName,cb){
  const layer=document.getElementById('vfx-layer');layer.innerHTML='';
  const ex=document.createElement('div');ex.className='card card--big';
  ex.innerHTML=`<div class="card-back"><img src="assets/backs/${backName}.png" onerror="this.src='assets/cards/back.png'"></div><div class="card-face"><img src="assets/cards/${playedCard.value}.png" onerror="this.style.display='none'"></div>`;
  ex.style.cssText='position:absolute;top:-12%;left:50%;transform:translateX(-50%) scale(0.5);opacity:0;transition:all 0.75s cubic-bezier(0.2,1.1,0.4,1)';
  layer.appendChild(ex);void ex.offsetWidth;
  ex.style.top='48%';ex.style.transform='translateX(-50%) translateY(-50%) scale(2.3)';ex.style.opacity='1';
  playSound('card');
  setTimeout(()=>{ex.classList.add('face-up');playSound('card');activeRevealCard=ex;setTimeout(cb,700);},800);
}
function animateOppRevealPart2(cb){
  if(!activeRevealCard)return cb();
  activeRevealCard.style.transition='all 0.65s cubic-bezier(0.4,0,1,1)';
  activeRevealCard.style.top='115%';activeRevealCard.style.transform='translate(-35vw,0) scale(0.35) rotate(-28deg)';activeRevealCard.style.opacity='0';
  setTimeout(()=>{if(activeRevealCard?.parentNode)activeRevealCard.parentNode.removeChild(activeRevealCard);activeRevealCard=null;cb();},700);
}

// ─── Анимация СВОЕЙ карты в нормальном режиме ───
function animateMyCardReveal(card, backName, callback){
  const layer=document.getElementById('vfx-layer');
  const el=document.createElement('div');el.className='card card--big';
  el.innerHTML=`<div class="card-back"><img src="assets/backs/${backName}.png" onerror="this.src='assets/cards/back.png'"></div><div class="card-face"><img src="assets/cards/${card.value}.png" onerror="this.style.display='none'"></div>`;
  el.style.cssText='position:absolute;bottom:-12%;left:50%;transform:translateX(-50%) scale(0.5);opacity:0;transition:all 0.75s cubic-bezier(0.2,1.1,0.4,1)';
  layer.appendChild(el);void el.offsetWidth;
  el.style.bottom='48%';el.style.transform='translateX(-50%) translateY(50%) scale(2.3)';el.style.opacity='1';
  playSound('card');
  setTimeout(()=>{
    el.classList.add('face-up');playSound('card');activeRevealCard=el;
    // Показываем Event text из очереди если пришёл
    setTimeout(()=>{
      const queuedVfx=stateQueue.find(q=>q.type==='vfx');
      const queuedState=stateQueue.find(q=>q.type==='state');
      if(queuedVfx?.payload?.message){showEventText(queuedVfx.payload.message,2000);}
      else if(queuedState){
        const sig=queuedState.payload.log?.filter(l=>!l.startsWith('—')&&!l.startsWith('Первый')).slice(-1)[0];
        if(sig)showEventText(sig,1800);
      }
    },400);
    setTimeout(()=>animateOppRevealPart2(callback),2200);
  },800);
}

// ─── Универсальная функция разыгрывания карты (с анимацией или без) ───
function playCardWithAnim(payload, card, cardEl){
  const myBack=lastState?.me?.back||mySelectedBack;
  if(gameMode==='normal'){
    busyAnimating=true;
    socket.emit('play',payload);
    animateMyCardReveal(card,myBack,()=>{
      busyAnimating=false;
      flushQueue();
    });
  } else {
    if(cardEl){cardEl.classList.remove('my-turn-glow');cardEl.classList.add('my-playing');}
    playSound('card');
    setTimeout(()=>socket.emit('play',payload),600);
  }
}

function handleVFX(data,callback=()=>{}){
  const isDirect=!busyAnimating;if(isDirect)busyAnimating=true;
  const layer=document.getElementById('vfx-layer');let dur=2000;

  if(data.type==='baron'){
    playSound('card');if(activeRevealCard)activeRevealCard.style.opacity='0';
    const c1=document.createElement('div');c1.className='vfx-card vfx-clash-left';c1.innerHTML=`<img src="assets/cards/${data.p1Card}.png">`;
    const c2=document.createElement('div');c2.className='vfx-card vfx-clash-right';c2.innerHTML=`<img src="assets/cards/${data.p2Card}.png">`;
    layer.appendChild(c1);layer.appendChild(c2);
    setTimeout(()=>{playSound('clash');triggerVibe('heavy');
      if(data.winnerId===data.p1Id)c2.classList.add('vfx-clash-loser');
      else if(data.winnerId===data.p2Id)c1.classList.add('vfx-clash-loser');
    },1000);dur=2800;
  }
  else if(data.type==='burn'){
    playSound('burn');triggerVibe('medium');
    const c=document.createElement('div');c.className='vfx-card vfx-burn';c.innerHTML=`<img src="assets/cards/9.png">`;layer.appendChild(c);dur=1800;
  }
  else if(data.type==='detective'){
    playSound('card');
    const g=document.createElement('div');g.className='vfx-detective-group';
    g.style.top=activeRevealCard?'12%':'45%';
    g.innerHTML=`<div class="vfx-detective-text">Проверяет: ${CARDS[data.guess]?.name||data.guess}</div>`;
    layer.appendChild(g);
    if(data.hit){
      setTimeout(()=>{
        const res=document.createElement('div');res.className='vfx-result-text hit';res.textContent='✓ УГАДАЛ!';
        g.appendChild(res);playSound('success');triggerVibe('heavy');
      },1200);dur=3500;
    } else {
      setTimeout(()=>{
        const res=document.createElement('div');res.className='vfx-result-text miss';res.textContent='✗ ПРОМАХ';
        g.appendChild(res);playSound('fail');
      },1200);dur=3000;
    }
  }
  else if(data.type==='journalist'){
    playSound('magic');
    const eyes=document.createElement('div');eyes.className='vfx-eyes';eyes.innerHTML='👀';layer.appendChild(eyes);dur=2000;
  }

  // Показываем message если есть
  if(gameMode==='normal'&&data.message){
    setTimeout(()=>showEventText(data.message,Math.min(dur-300,2200)),600);
  }

  setTimeout(()=>{
    Array.from(layer.children).forEach(ch=>{if(ch!==activeRevealCard)layer.removeChild(ch);});
    if(activeRevealCard)activeRevealCard.style.opacity='1';
    if(isDirect){busyAnimating=false;flushQueue();}
    callback();
  },dur);
}

function renderState(s){
  document.getElementById('me-name').textContent=s.me?.name||'Вы';
  document.getElementById('me-status').textContent=s.isMyTurn?'твой ход':(s.me?.protected?'под защитой':'');
  const setAv=(id,url)=>{if(url)document.getElementById(id).style.backgroundImage=`url('${url}')`;};
  setAv('me-avatar',s.me?.avatar);
  renderTokens('me-tokens',s.me?.tokens||0);
  renderOpponents(s);
  renderMyCards(s);
  renderExcluded(s.excludedCards||[]);
  renderDiscard('me-discard',s.me?.discard||[]);
  document.getElementById('deck-count-badge').textContent=s.deckCount;
  updateLogStrip(s.log);
  if(s.gameOver)showGameOver(s.gameOver);
  else if(s.roundOver)showRoundOver(s.roundOver);
  else{document.getElementById('round-over').classList.remove('show');document.getElementById('game-over').classList.remove('show');}
}

function renderOpponents(s){
  const zone=document.getElementById('g-opponents');zone.innerHTML='';
  const opps=s.opponents||[];
  zone.className='g-opponents opp-count-'+opps.length;

  opps.forEach(opp=>{
    const col=document.createElement('div');col.className='g-opp-col';
    const bar=document.createElement('div');bar.className='g-player-bar';
    bar.innerHTML=`<div class="g-av-wrap"><div class="g-avatar"${opp.avatar?` style="background-image:url('${opp.avatar}')"`:''}></div><div><div class="g-name">${esc(opp.name)}</div><div class="g-status">${opp.isTurn?'ходит':(opp.protected?'защита':(opp.eliminated?'выбыл':''))}</div></div></div><div class="g-tokens" id="opp-tok-${opp.userId}"></div>`;
    col.appendChild(bar);
    const cardZone=document.createElement('div');cardZone.className='g-card-center';
    if(opp.handCount>0){
      const card=makeCard(null,false,'card--opp',opp.back||'back');
      if(opp.isTurn)card.classList.add('opp-turn-glow');
      cardZone.appendChild(card);
    }
    col.appendChild(cardZone);
    const dstrip=document.createElement('div');dstrip.className='g-discard-strip';
    dstrip.innerHTML=`<span class="g-discard-label">Сброс</span>`;
    const drow=document.createElement('div');drow.className='g-discard-row';
    (opp.discard||[]).slice(-5).forEach(c=>{
      const card=makeCard(c,true,'card--sm');
      card.addEventListener('click',()=>openZoom(c));
      drow.appendChild(card);
    });
    dstrip.appendChild(drow);col.appendChild(dstrip);
    zone.appendChild(col);
    setTimeout(()=>renderTokens('opp-tok-'+opp.userId,opp.tokens||0),0);
  });
}

function renderMyCards(s){
  const zone=document.getElementById('my-card-zone');zone.innerHTML='';
  if(!s.me?.hand?.length)return;
  const myTurn=s.isMyTurn;const myBack=s.me.back||mySelectedBack;
  const row=document.createElement('div');row.style.cssText='display:flex;gap:24px;align-items:center;';
  s.me.hand.forEach(c=>{
    const wrap=document.createElement('div');wrap.className='play-arrow-wrap';
    const cardEl=makeCard(c,true,'card--big',myBack);
    if(myTurn)cardEl.classList.add('my-turn-glow');
    const seen=(s.me.seenCounts||{})[c.value]||0;
    const badge=document.createElement('div');badge.className='card-seen-badge';badge.textContent=`${seen}/${CARDS[c.value]?.total||'?'}`;
    cardEl.appendChild(badge);
    cardEl.addEventListener('click',e=>{e.stopPropagation();openZoom(c);});
    if(myTurn){
      const arrow=document.createElement('div');arrow.className='play-arrow';
      arrow.addEventListener('click',e=>{e.stopPropagation();onPlay(c,cardEl,s);});
      wrap.appendChild(arrow);
    }
    wrap.appendChild(cardEl);row.appendChild(wrap);
  });
  zone.appendChild(row);
}

function makeCard(card,faceUp,sizeClass,backName){
  const el=document.createElement('div');el.className=`card ${sizeClass||'card--big'}${faceUp?' face-up':''}`;
  const back=document.createElement('div');back.className='card-back';
  const bi=document.createElement('img');bi.src=`assets/backs/${backName||'back'}.png`;bi.onerror=()=>{bi.src='assets/cards/back.png';bi.onerror=()=>bi.style.display='none';};
  back.appendChild(bi);el.appendChild(back);
  const face=document.createElement('div');face.className='card-face';
  if(card){const img=document.createElement('img');img.src=`assets/cards/${card.value}.png`;img.onerror=()=>img.style.display='none';face.appendChild(img);}
  el.appendChild(face);return el;
}

function updateLogStrip(log){
  const l=(log||[]).filter(l=>l&&!l.startsWith('—'));
  document.getElementById('log-line-1').textContent=l[l.length-1]||'—';
  document.getElementById('log-line-2').textContent=l[l.length-2]||'';
}

document.getElementById('log-strip').addEventListener('click',()=>{
  if(!lastState)return;const list=document.getElementById('lo-list');list.innerHTML='';
  [...(lastState.log||[])].reverse().forEach(line=>{
    const d=document.createElement('div');
    d.className='lo-entry'+(line.startsWith('—')?' lo-entry--round':'');
    d.textContent=line;list.appendChild(d);
  });
  document.getElementById('log-overlay').classList.add('show');
});

function renderDiscard(id,cards){
  const el=document.getElementById(id);el.innerHTML='';
  cards.slice(-7).forEach(c=>{const card=makeCard(c,true,'card--sm');card.addEventListener('click',()=>openZoom(c));el.appendChild(card);});
}
function renderExcluded(cards){
  const el=document.getElementById('excluded-cards');el.innerHTML='';
  cards.forEach(c=>{const card=makeCard(c,true,'card--exc');card.addEventListener('click',()=>openZoom(c));el.appendChild(card);});
}

let prevTokens={};
function renderTokens(id,count){
  const el=document.getElementById(id);if(!el)return;const prev=prevTokens[id]??0;prevTokens[id]=count;
  const max=lastState?.winTokens||6;let h='';
  for(let i=0;i<max;i++){const e=i<count,n=e&&i>=prev;h+=`<span class="token ${e?'earned':'empty'}${n?' new-earn':''}">◆</span>`;}
  el.innerHTML=h;
}

function onPlay(card,cardEl,s){
  if(!s?.isMyTurn)return;
  if(s.me.mustPlayCountess&&card.value!==8){
    if(window.Telegram?.WebApp?.showAlert)window.Telegram.WebApp.showAlert('Роковая женщина! Обязан сыграть карту 8.');
    else showToast('Роковая женщина! Обязан сыграть карту 8.');
    return;
  }
  pendingCard=card;pendingCardElement=cardEl;
  const opps=(s.opponents||[]).filter(o=>!o.eliminated&&!o.protected);

  if(card.value===1){
    if(opps.length>1)openTargetThenGuess(card,opps);
    else openGuessModal(card,opps[0]?.userId);
  }
  else if(card.value===5)openFederalModal(card,s);
  else if([2,3,7].includes(card.value)&&opps.length>1)openTargetModal(card,opps,'Выбери цель');
  else{
    const targetId=opps[0]?.userId;
    playCardWithAnim({cardId:card.id,targetUserId:targetId},card,cardEl);
  }
}

function openGuessModal(card,targetUserId){
  const el=document.getElementById('action-modal'),g=document.getElementById('action-options');g.innerHTML='';
  for(let v=0;v<=9;v++){
    if(v===1)continue;const o=document.createElement('div');o.className='am-opt';
    const seen=(lastState?.me?.seenCounts||{})[v]||0;
    o.innerHTML=`<div style="position:absolute;top:-6px;right:-6px;background:#000;color:var(--gold-b);border:1px solid var(--gold);border-radius:10px;font-size:10px;padding:2px 6px;font-weight:bold;box-shadow:0 2px 4px rgba(0,0,0,.8)">${seen}/${CARDS[v].total}</div><span class="num">${v}</span>${CARDS[v].name}`;
    o.addEventListener('click',()=>{
      el.classList.remove('show');flushQueue();
      playCardWithAnim({cardId:card.id,guess:v,targetUserId},card,pendingCardElement);
    });g.appendChild(o);
  }
  el.classList.add('show');
}

function openTargetThenGuess(card,opps){
  const el=document.getElementById('target-modal'),o=document.getElementById('target-options');o.innerHTML='';
  document.getElementById('target-title').textContent='Кого проверить?';
  opps.forEach(t=>{
    const d=document.createElement('div');d.className='am-opt';d.innerHTML=`<span class="num">🔍</span>${esc(t.name)}`;
    d.addEventListener('click',()=>{el.classList.remove('show');openGuessModal(card,t.userId);});
    o.appendChild(d);
  });
  el.classList.add('show');
}

function openFederalModal(card,s){
  const el=document.getElementById('target-modal'),o=document.getElementById('target-options');o.innerHTML='';
  document.getElementById('target-title').textContent='Облава: на кого?';
  const selfOpt=document.createElement('div');selfOpt.className='am-opt';selfOpt.innerHTML=`<span class="num">★</span>${esc(s.me.name)}<br><small style="opacity:.5">себя</small>`;
  selfOpt.addEventListener('click',()=>{el.classList.remove('show');flushQueue();
    playCardWithAnim({cardId:card.id,targetUserId:'self',target:'self'},card,pendingCardElement);
  });o.appendChild(selfOpt);
  (s.opponents||[]).filter(op=>!op.eliminated).forEach(op=>{
    if(op.protected){const d=document.createElement('div');d.className='am-opt';d.style.opacity='.4';d.innerHTML=`<span class="num">🛡</span>${esc(op.name)}<br><small>защищён</small>`;o.appendChild(d);return;}
    const d=document.createElement('div');d.className='am-opt';d.innerHTML=`<span class="num">★</span>${esc(op.name)}`;
    d.addEventListener('click',()=>{el.classList.remove('show');flushQueue();
      playCardWithAnim({cardId:card.id,targetUserId:op.userId},card,pendingCardElement);
    });o.appendChild(d);
  });
  el.classList.add('show');
}

function openTargetModal(card,opps,title){
  const el=document.getElementById('target-modal'),o=document.getElementById('target-options');o.innerHTML='';
  document.getElementById('target-title').textContent=title||'Выбери цель';
  opps.forEach(t=>{
    const d=document.createElement('div');d.className='am-opt';d.innerHTML=`<span class="num">★</span>${esc(t.name)}`;
    d.addEventListener('click',()=>{el.classList.remove('show');flushQueue();
      playCardWithAnim({cardId:card.id,targetUserId:t.userId},card,pendingCardElement);
    });o.appendChild(d);
  });
  el.classList.add('show');
}

function showChancellor(cards){
  const el=document.getElementById('chancellor-modal'),w=document.getElementById('chancellor-cards');w.innerHTML='';
  cards.forEach(c=>{const o=document.createElement('div');o.className='chancellor-option';const ce=makeCard(c,true,'card--big');
    const l=document.createElement('div');l.className='chancellor-choose-label';l.textContent='Выбрать';
    o.addEventListener('click',()=>{socket.emit('chancellor_pick',c.id);el.classList.remove('show');flushQueue();});
    o.appendChild(ce);o.appendChild(l);w.appendChild(o);});el.classList.add('show');
}

function openZoom(card){
  if(!card)return;const def=CARDS[card.value],w=document.getElementById('cz-card-img');w.innerHTML='';
  const img=document.createElement('img');img.src=`assets/cards/${card.value}.png`;img.onerror=()=>img.style.display='none';w.appendChild(img);
  document.getElementById('cz-name').textContent=def.name;
  document.getElementById('cz-value').textContent=`Карта ${card.value}`;
  document.getElementById('cz-desc').textContent=def.desc;
  const seen=(lastState?.me?.seenCounts||{})[card.value]||0;
  document.getElementById('cz-seen').textContent=`Видено: ${seen} из ${def.total}`;
  document.getElementById('card-zoom').classList.add('show');
}

document.getElementById('deck-btn').addEventListener('click',e=>{
  e.stopPropagation();const g=document.getElementById('do-grid');g.innerHTML='';
  document.getElementById('do-detail-box').style.display='none';
  for(let v=0;v<=9;v++){const d=CARDS[v],r=document.createElement('div');r.className='do-row';
    const m=document.createElement('div');m.className='do-mini';const i=document.createElement('img');i.src=`assets/cards/${v}.png`;i.onerror=()=>i.style.display='none';m.appendChild(i);
    const inf=document.createElement('div');inf.className='do-info';inf.innerHTML=`<div class="do-name">${d.name}</div>`;
    r.appendChild(m);r.appendChild(inf);
    r.addEventListener('click',()=>{document.getElementById('do-detail-box').style.display='block';document.getElementById('do-detail-name').textContent=d.name;document.getElementById('do-detail-desc').textContent=d.desc;});
    g.appendChild(r);}
  document.getElementById('deck-overlay').classList.add('show');
});

function showPeek(data){
  const w=document.getElementById('peek-card');w.innerHTML='';
  if(data.card)w.appendChild(makeCard(data.card,true,'card--big'));
  document.getElementById('peek-title').textContent=`У ${data.playerName}`;
  document.getElementById('peek-card-name').textContent=data.cardName||'';
  document.getElementById('peek-card-desc').textContent=CARDS[data.card?.value]?.desc||'';
  document.getElementById('peek-overlay').classList.add('show');
}

function showRoundOver(ro){
  const ov=document.getElementById('round-over'),iW=ro.winnerId===ME.id;
  document.getElementById('ro-title').textContent=iW?'✦ РАУНД ВАШ ✦':'✗ РАУНД ПОТЕРЯН';
  document.getElementById('ro-title').style.color=iW?'var(--gold)':'var(--red-b)';
  document.getElementById('ro-sub').textContent=`Побеждает ${esc(ro.winnerName)}`;
  document.getElementById('ro-reason').textContent=ro.reason||'';
  if(!iW)shakeScreen();else playSound('success');
  ov.classList.add('show');
  setTimeout(()=>ov.classList.remove('show'),4000);
}

function showGameOver(go){
  const iW=go.winnerId===ME.id;
  document.getElementById('go-glyph').textContent=iW?'✦':'✗';
  document.getElementById('go-title').textContent=iW?'Победа!':'Поражение';
  document.getElementById('go-sub').textContent=iW?`${esc(go.winnerName)} побеждает!`:'Вы проиграли.';
  document.getElementById('go-reason').textContent=go.reason||'';
  const scores=go.scores||[];
  document.getElementById('go-tokens-row').innerHTML=scores.map(s=>`<span>${esc(s.name)}: <strong>${s.tokens} ◆</strong></span>`).join('<span style="margin:0 6px;opacity:.3">|</span>');
  document.getElementById('go-pending').textContent='';
  document.getElementById('game-over').classList.add('show');
  tg?.HapticFeedback?.notificationOccurred?.(iW?'success':'error');
}

document.getElementById('btn-surrender').addEventListener('click',()=>{
  if(!lastState)return;
  if(confirm('Точно сдаёшься? 💀')){socket.emit('surrender');}
});

document.getElementById('btn-rematch').addEventListener('click',()=>{socket.emit('rematch');document.getElementById('go-pending').textContent='Ждём…';});
document.getElementById('btn-to-menu').addEventListener('click',goToMenu);

function goToMenu(){socket?.emit('leave_game');lastState=null;resetGameState();closeAllOverlays();showScreen('menu');socket?.emit('get_player_data',ME.id);}
function closeAllOverlays(){document.querySelectorAll('.overlay').forEach(o=>o.classList.remove('show'));}
function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500);}
function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

document.getElementById('cz-close').addEventListener('click',()=>{document.getElementById('card-zoom').classList.remove('show');flushQueue();});
document.getElementById('lo-close').addEventListener('click',()=>{document.getElementById('log-overlay').classList.remove('show');flushQueue();});
document.getElementById('do-close').addEventListener('click',()=>{document.getElementById('deck-overlay').classList.remove('show');flushQueue();});
document.getElementById('action-cancel').addEventListener('click',()=>{pendingCard=null;document.getElementById('action-modal').classList.remove('show');flushQueue();});
document.getElementById('target-cancel').addEventListener('click',()=>{pendingCard=null;document.getElementById('target-modal').classList.remove('show');flushQueue();});
document.getElementById('peek-close').addEventListener('click',()=>{document.getElementById('peek-overlay').classList.remove('show');flushQueue();});
