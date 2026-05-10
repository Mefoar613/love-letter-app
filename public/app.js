// =====================================================================
// Тёмная Дуэль — Frontend v12 (Мгновенный старт + Полное Обучение)
// =====================================================================
const tg=window.Telegram?.WebApp;
if(tg){tg.ready();tg.expand();tg.setHeaderColor?.('#08050f');tg.setBackgroundColor?.('#08050f');}

const tgUser=tg?.initDataUnsafe?.user;
const ME={
  id:tgUser?`tg_${tgUser.id}`:`g_${Math.random().toString(36).slice(2,9)}`,
  name:tgUser?[tgUser.first_name, tgUser.last_name].filter(Boolean).join(' '):'Гость',
  avatar:tgUser?.photo_url||null
};

const BOT_LINK="https://t.me/PumpHuntRealBot/POGNALI";

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

// ─── ЗВУК И ВИБРО ───
const bgm=document.getElementById('bgm');if(bgm)bgm.volume=.38;
let musicStarted=false;
function startMusic(){if(musicStarted||!bgm)return;musicStarted=true;bgm.play().catch(()=>{musicStarted=false});}
let audioCtx=null;
function playSound(type='click'){try{if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();const n=audioCtx.currentTime,o=audioCtx.createOscillator(),g=audioCtx.createGain();o.connect(g);g.connect(audioCtx.destination);
if(type==='click'){o.type='triangle';o.frequency.setValueAtTime(800,n);o.frequency.exponentialRampToValueAtTime(380,n+.07);g.gain.setValueAtTime(.13,n);g.gain.exponentialRampToValueAtTime(.001,n+.09);o.start(n);o.stop(n+.1);}
if(type==='card'){o.type='sine';o.frequency.setValueAtTime(300,n);o.frequency.exponentialRampToValueAtTime(160,n+.16);g.gain.setValueAtTime(.16,n);g.gain.exponentialRampToValueAtTime(.001,n+.19);o.start(n);o.stop(n+.2);}
if(type==='clash'){o.type='square';o.frequency.setValueAtTime(150,n);o.frequency.exponentialRampToValueAtTime(50,n+.3);g.gain.setValueAtTime(.3,n);g.gain.exponentialRampToValueAtTime(.001,n+.4);o.start(n);o.stop(n+.5);}
if(type==='success'){o.type='sine';o.frequency.setValueAtTime(523,n);o.frequency.setValueAtTime(659,n+.15);o.frequency.setValueAtTime(784,n+.3);g.gain.setValueAtTime(.15,n);g.gain.exponentialRampToValueAtTime(.001,n+.5);o.start(n);o.stop(n+.55);}
}catch(e){}}

document.body.addEventListener('click',e=>{
  startMusic();
  if(e.target.closest('.btn,.am-opt,.g-deck-btn,.g-log-strip,.play-arrow,.chancellor-option,.lb-card,.back-option,.lc-slot,.btn-close-bottom,.do-row'))playSound('click');
},true);

function triggerVibe(t='medium'){if(tg?.HapticFeedback)tg.HapticFeedback.impactOccurred(t);}
function shakeScreen(){const g=document.getElementById('game');g.classList.remove('shake-screen');void g.offsetWidth;g.classList.add('shake-screen');triggerVibe('heavy');playSound('clash');}

// ─── ЭКРАНЫ (МГНОВЕННЫЙ ЗАПУСК БЕЗ ЗАСТАВКИ) ───
function showScreen(id){document.querySelectorAll('.screen').forEach(s=>s.classList.toggle('active',s.id===id));}

document.addEventListener('DOMContentLoaded', ()=>{
  // Жёстко выключаем чёрный экран заставки, даже если он есть в HTML
  const introEl = document.getElementById('intro');
  if(introEl) introEl.style.display = 'none';
  
  // Мгновенно показываем меню
  showScreen('menu');
  connectSocket();
  
  // Проверяем, пришел ли игрок по ссылке-приглашению
  const sp = tg?.initDataUnsafe?.start_param;
  if(sp){
    setTimeout(()=>{socket.emit('join_lobby',{lobbyId:sp,user:ME});showScreen('lobby');},200);
  }
});

// ─── СОКЕТЫ ───
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
}

// ═══ МЕНЮ И ЛОББИ ═══
document.getElementById('btn-play').addEventListener('click',()=>showScreen('lobby-browser'));
document.getElementById('btn-backs').addEventListener('click',()=>{renderBacks();showScreen('backs');});
document.getElementById('lb-back').addEventListener('click',()=>showScreen('menu'));
document.getElementById('lc-back').addEventListener('click',()=>showScreen('lobby-browser'));
document.getElementById('lc-create-btn').addEventListener('click',()=>{socket.emit('create_lobby',{user:ME,maxPlayers:createSlotCount});showScreen('lobby');});
document.getElementById('btn-create-lobby').addEventListener('click',()=>{renderCreateLobby();showScreen('lobby-create');});
function renderLobbyList(list){const el=document.getElementById('lb-list');el.innerHTML='';if(!list||!list.length){el.innerHTML='<div class="lb-empty">Нет открытых лобби.</div>';return;}list.forEach(l=>{const card=document.createElement('div');card.className='lb-card';card.innerHTML=`<div class="lb-card-info"><div class="lb-card-name">${esc(l.creatorName)}</div><div class="lb-card-count">${l.playerCount}/${l.maxPlayers}</div></div>`;const btn=document.createElement('button');btn.className='btn btn-secondary';btn.innerHTML='<span>Войти</span>';btn.addEventListener('click',()=>{socket.emit('join_lobby',{lobbyId:l.id,user:ME});showScreen('lobby');});card.appendChild(btn);el.appendChild(card);});}
let createSlotCount=2;function renderCreateLobby(){createSlotCount=2;updateCreateSlots();}
function updateCreateSlots(){const el=document.getElementById('lc-slots');el.innerHTML='<div class="lc-slot lc-slot--you">Вы</div>';for(let i=1;i<createSlotCount;i++){const s=document.createElement('div');s.className='lc-slot lc-slot--added';s.innerHTML=`<span>Слот ${i+1}</span><div class="lc-remove">✕</div>`;el.appendChild(s);}if(createSlotCount<4){const add=document.createElement('div');add.className='lc-slot lc-slot--empty';add.textContent='＋';add.addEventListener('click',()=>{if(createSlotCount<4){createSlotCount++;updateCreateSlots();}});el.appendChild(add);}el.querySelectorAll('.lc-remove').forEach(btn=>{btn.addEventListener('click',e=>{e.stopPropagation();if(createSlotCount>2){createSlotCount--;updateCreateSlots();}});});}
function onLobbyJoined(lobby){currentLobby=lobby;document.getElementById('lobby-room-id').textContent=lobby.id;const c=document.getElementById('lobby-players');c.innerHTML='';for(let i=0;i<lobby.maxPlayers;i++){const p=lobby.players[i],el=document.createElement('div');el.className='lobby-player';if(p)el.innerHTML=`<div class="lobby-player-avatar"${p.avatar?` style="background-image:url('${p.avatar}')"`:''}>${p.isBot?'🤖':''}</div><div class="lobby-player-name">${esc(p.name)}</div>`;else{el.style.opacity='.4';el.innerHTML='<div class="lobby-player-avatar" style="border-style:dashed">?</div>';}c.appendChild(el);}const actions=document.getElementById('lobby-actions'),wait=document.getElementById('lobby-wait'),amCreator=lobby.creatorId===ME.id;if(amCreator){actions.style.display='flex';wait.style.display='none';document.getElementById('btn-start-game').style.display=lobby.playerCount>=2?'flex':'none';}else{actions.style.display='none';wait.style.display='flex';}}
document.getElementById('btn-start-game').addEventListener('click',()=>socket.emit('start_game'));
document.getElementById('btn-add-bot').addEventListener('click',()=>socket.emit('add_bot'));
document.getElementById('btn-leave-lobby').addEventListener('click',()=>window.location.reload());
document.getElementById('btn-invite-friend').addEventListener('click',()=>{if(!currentLobby)return;const link=`${BOT_LINK}?startapp=${currentLobby.id}`;if(tg?.openTelegramLink)tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('ДУЭЛЬ!')}`);});

// ═══ РУБАШКИ ═══
document.getElementById('backs-back').addEventListener('click',()=>showScreen('menu'));
function renderBacks(){const grid=document.getElementById('backs-grid');grid.innerHTML='';AVAILABLE_BACKS.forEach(b=>{const opt=document.createElement('div');opt.className='back-option'+(b.id===mySelectedBack?' selected':'');opt.innerHTML=`<img src="assets/backs/${b.id}.png" onerror="this.src='assets/cards/back.png'"/><div class="back-option-name">${b.name}</div>`;opt.addEventListener('click',()=>{socket.emit('set_back',{userId:ME.id,backName:b.id});mySelectedBack=b.id;renderBacks();});grid.appendChild(opt);});}

// ═══ ТВОЁ ИДЕАЛЬНОЕ ОБУЧЕНИЕ ═══
const TUTORIAL_STEPS=[
  {text:'Добро пожаловать в Тёмную Дуэль! Это карточная игра на логику, блеф и дедукцию. Давай я покажу тебе как играть.', show:[]},
  {text:'В колоде 21 карта с номиналами от 0 до 9. В начале раунда каждому игроку сдаётся по 1 карте. Ещё 1 карта откладывается втёмную.', show:[{v:1},{v:2},{v:3}]},
  {text:'На своём ходу ты берёшь 1 карту из колоды (автоматически). Теперь у тебя 2 карты — выбери одну и сыграй её.', cards:'hand', highlight:'arrow', show:[{v:1, glow:true},{v:6}]},
  {text:'У каждой карты есть свой эффект. Тапни по карте, чтобы узнать, что она делает. Стрелка сверху — это кнопка «Сыграть».', show:[{v:1, highlight:'arrow'}]},
  {text:'Карта 1 — Детектив. Самая частая карта (6 штук). Назови номинал карты соперника. Угадал? Соперник выбывает!', show:[{v:1, glow:true}]},
  {text:'Карта 3 — Громила. Сравниваете карты с соперником. У кого номинал ниже — тот выбывает. Опасная штука!', show:[{v:3, glow:true}, {v:'back'}]},
  {text:'Карта 4 — Продажный коп. Защищает тебя до следующего хода. Никакие эффекты на тебя не действуют.', show:[{v:4, glow:true}]},
  {text:'Карта 9 — Компромат. Самая ценная карта (номинал 9). НО: если ты её сбросишь или тебя заставят — ты проигрываешь раунд!', show:[{v:9, glow:true, danger:true}]},
  {text:'Карта 8 — Роковая женщина. Если у тебя на руке одновременно 8 и (5 или 7) — обязан сыграть восьмёрку.', show:[{v:8, glow:true}, {v:5}]},
  {text:'Раунд заканчивается когда: все кроме одного выбыли, или кончилась колода (побеждает тот, у кого номинал карты выше).', show:[{v:2}, {v:7}]},
  {text:'Побеждает тот, кто первый наберёт нужное число жетонов: 6 для двоих, 5 для троих, 4 для четверых.', show:[]},
  {text:'Счётчик «Видено X/Y» на карте показывает сколько карт этого типа ты уже видел. Используй эту информацию для дедукции!', show:[{v:1, badge:'2/6'}]},
  {text:'Ты готов! Жми «Играть» в меню, создай лобби, добавь бота или пригласи друга. Удачи в дуэли! 🎴', show:[]},
];

let tutStep=0;
document.getElementById('btn-tutorial').addEventListener('click', startTutorial);
function startTutorial(){ tutStep=0; showScreen('tutorial'); renderTutStep(); }
function renderTutStep(){
  if(tutStep>=TUTORIAL_STEPS.length){showScreen('menu');return;}
  const step=TUTORIAL_STEPS[tutStep];
  document.getElementById('tut-text').textContent=step.text;
  const area=document.getElementById('tut-game-area'); area.innerHTML='';

  if(step.show && step.show.length>0){
    const row=document.createElement('div'); row.className='tut-cards';
    step.show.forEach(c=>{
      const wrap=document.createElement('div'); wrap.className='play-arrow-wrap';
      const card=makeCard(c.v==='back'?null:{value:c.v}, c.v!=='back', 'card--big');
      if(c.glow){ card.classList.add('my-turn-glow'); card.style.transform='scale(1.1)'; triggerVibe('light'); }
      if(c.danger) card.style.boxShadow='0 0 20px var(--red)';
      if(c.badge){ const b=document.createElement('div'); b.className='card-seen-badge'; b.textContent=c.badge; card.appendChild(b); }
      if(c.highlight==='arrow' || step.highlight==='arrow'){
        const arrow=document.createElement('div'); arrow.className='play-arrow tut-highlight'; wrap.appendChild(arrow);
      }
      wrap.appendChild(card); row.appendChild(wrap);
    });
    area.appendChild(row);
  }
}
document.getElementById('tut-next').addEventListener('click',()=>{tutStep++; renderTutStep(); playSound('click');});
document.getElementById('tut-skip').addEventListener('click',()=>{showScreen('menu');});

// ─── ИГРОВОЙ ЦИКЛ ───
let lastState=null,stateQueue=[],busyAnimating=false,prevOppDiscardLen=0,activeRevealCard=null;
function isOverlayOpen(){return document.querySelectorAll('.overlay.show:not(#round-over):not(#game-over):not(#surrender-notice)').length>0;}
function flushQueue(){if(stateQueue.length>0&&!busyAnimating&&!isOverlayOpen()){const next=stateQueue.shift();if(next.type==='state')processState(next.payload);else if(next.type==='vfx')handleVFX(next.payload);}}
function resetGameState(){lastState=null;stateQueue=[];busyAnimating=false;prevOppDiscardLen=0;activeRevealCard=null;document.getElementById('vfx-layer').innerHTML='';}
function handleNewState(s){if(busyAnimating||isOverlayOpen()){stateQueue.push({type:'state',payload:s});return;}processState(s);}
function processState(s){const isFirst=!lastState;const mainOpp=s.opponents?.[0];const oppPlayed=!isFirst&&mainOpp&&(mainOpp.discard?.length||0)>prevOppDiscardLen;
if(oppPlayed){const playedCard=mainOpp.discard[mainOpp.discard.length-1];busyAnimating=true;updateLogStrip(s.log);animateOppRevealPart1(playedCard,mainOpp.back||'back',()=>{const vfxIdx=stateQueue.findIndex(q=>q.type==='vfx');if(vfxIdx>=0){const vfx=stateQueue.splice(vfxIdx,1)[0];handleVFX(vfx.payload,()=>{animateOppRevealPart2(()=>finishProcess(s));});}else setTimeout(()=>animateOppRevealPart2(()=>finishProcess(s)),1200);});}else{if(lastState&&lastState.me&&!lastState.me.eliminated&&s.me&&s.me.eliminated)shakeScreen();finishProcess(s);}}
function finishProcess(s){lastState=s;prevOppDiscardLen=s.opponents?.[0]?.discard?.length||0;renderState(s);busyAnimating=false;flushQueue();}

// ─── АНИМАЦИИ И VFX ───
function animateOppRevealPart1(playedCard,backName,cb){const layer=document.getElementById('vfx-layer');layer.innerHTML='';const ex=document.createElement('div');ex.className='card card--big';ex.innerHTML=`<div class="card-back"><img src="assets/backs/${backName}.png" onerror="this.src='assets/cards/back.png'"></div><div class="card-face"><img src="assets/cards/${playedCard.value}.png"></div>`;ex.style.cssText='position:absolute;top:-10%;transform:scale(0.5);transition:all 0.8s cubic-bezier(0.25,1,0.5,1)';layer.appendChild(ex);void ex.offsetWidth;ex.style.top='50%';ex.style.transform='translateY(-50%) scale(2.2)';playSound('card');setTimeout(()=>{ex.classList.add('face-up');playSound('card');activeRevealCard=ex;setTimeout(cb,600);},800);}
function animateOppRevealPart2(cb){if(!activeRevealCard)return cb();activeRevealCard.style.top='120%';activeRevealCard.style.transform='translate(-35vw,0) scale(0.4) rotate(-25deg)';activeRevealCard.style.opacity='0';setTimeout(()=>{if(activeRevealCard?.parentNode)activeRevealCard.parentNode.removeChild(activeRevealCard);activeRevealCard=null;cb();},800);}
function handleVFX(data,callback=()=>{const isDirect=!busyAnimating;if(isDirect)busyAnimating=true;const layer=document.getElementById('vfx-layer');let dur=2000;
if(data.type==='baron'){const c1=document.createElement('div');c1.className='vfx-card vfx-clash-left';c1.innerHTML=`<img src="assets/cards/${data.p1Card}.png">`;const c2=document.createElement('div');c2.className='vfx-card vfx-clash-right';c2.innerHTML=`<img src="assets/cards/${data.p2Card}.png">`;layer.appendChild(c1);layer.appendChild(c2);setTimeout(()=>{if(data.winnerId===data.p1Id)c2.classList.add('vfx-clash-loser');else if(data.winnerId===data.p2Id)c1.classList.add('vfx-clash-loser');},1000);dur=2500;}
else if(data.type==='detective'){const g=document.createElement('div');g.className='vfx-detective-group';g.style.top='45%';g.innerHTML=`<div class="vfx-detective-text">Проверяет: ${CARDS[data.guess]?.name}</div>`;layer.appendChild(g);if(data.hit){setTimeout(()=>{const res=document.createElement('div');res.className='vfx-result-text hit';res.textContent='✓ УСПЕХ!';g.appendChild(res);playSound('success');},1200);dur=3500;}else{setTimeout(()=>{const res=document.createElement('div');res.className='vfx-result-text miss';res.textContent='✗ НЕУДАЧА';g.appendChild(res);},1200);dur=3000;}}
setTimeout(()=>{Array.from(layer.children).forEach(ch=>{if(ch!==activeRevealCard)layer.removeChild(ch);});if(isDirect){busyAnimating=false;flushQueue();}callback();},dur);});

// ─── РЕНДЕР СТОЛА ───
function renderState(s){
  document.getElementById('me-name').textContent=s.me?.name||'Вы';
  document.getElementById('me-status').textContent=s.isMyTurn?'твой ход':(s.me?.protected?'под защитой':'');
  if(s.me?.avatar) document.getElementById('me-avatar').style.backgroundImage=`url('${s.me.avatar}')`;
  renderTokens('me-tokens',s.me?.tokens||0);
  renderOpponents(s); renderMyCards(s); renderExcluded(s.excludedCards||[]); renderDiscard('me-discard',s.me?.discard||[]);
  document.getElementById('deck-count-badge').textContent=s.deckCount; updateLogStrip(s.log);
  if(s.gameOver)showGameOver(s.gameOver); else if(s.roundOver)showRoundOver(s.roundOver);
}

function renderOpponents(s){
  const zone=document.getElementById('g-opponents'); zone.innerHTML='';
  const opps=s.opponents||[]; zone.className='g-opponents opp-count-'+opps.length;
  opps.forEach(opp=>{
    const col=document.createElement('div'); col.className='g-opp-col';
    col.innerHTML=`<div class="g-player-bar"><div class="g-av-wrap"><div class="g-avatar"${opp.avatar?` style="background-image:url('${opp.avatar}')"`:''}></div><div><div class="g-name">${esc(opp.name)}</div><div class="g-status">${opp.isTurn?'ходит':(opp.protected?'защита':'')}</div></div></div><div class="g-tokens" id="opp-tok-${opp.userId}"></div></div><div class="g-card-center"></div>`;
    if(opp.handCount>0){const card=makeCard(null,false,'card--opp',opp.back); if(opp.isTurn)card.classList.add('opp-turn-glow'); col.querySelector('.g-card-center').appendChild(card);}
    zone.appendChild(col); setTimeout(()=>renderTokens('opp-tok-'+opp.userId,opp.tokens||0),0);
  });
}

function renderMyCards(s){
  const zone=document.getElementById('my-card-zone'); zone.innerHTML='';
  if(!s.me?.hand?.length)return;
  s.me.hand.forEach(c=>{
    const wrap=document.createElement('div'); wrap.className='play-arrow-wrap';
    const cardEl=makeCard(c,true,'card--big',s.me.back); if(s.isMyTurn)cardEl.classList.add('my-turn-glow');
    const badge=document.createElement('div'); badge.className='card-seen-badge'; badge.textContent=`${(s.me.seenCounts||{})[c.value]||0}/${CARDS[c.value]?.total}`;
    cardEl.appendChild(badge); cardEl.onclick=()=>openZoom(c);
    if(s.isMyTurn){const arrow=document.createElement('div'); arrow.className='play-arrow'; arrow.onclick=(e)=>{e.stopPropagation();onPlay(c,cardEl,s);}; wrap.appendChild(arrow);}
    wrap.appendChild(cardEl); zone.appendChild(wrap);
  });
}

function makeCard(card,faceUp,sizeClass,backName){
  const el=document.createElement('div'); el.className=`card ${sizeClass||'card--big'}${faceUp?' face-up':''}`;
  el.innerHTML=`<div class="card-back"><img src="assets/backs/${backName||'back'}.png" onerror="this.src='assets/cards/back.png'"></div><div class="card-face">${card?`<img src="assets/cards/${card.value}.png">`:''}</div>`;
  return el;
}

function updateLogStrip(log){const l=(log||[]).filter(l=>l&&!l.startsWith('—')); document.getElementById('log-line-1').textContent=l[l.length-1]||'—'; document.getElementById('log-line-2').textContent=l[l.length-2]||'';}
document.getElementById('log-strip').onclick=()=>{if(!lastState)return; const list=document.getElementById('lo-list'); list.innerHTML=''; [...(lastState.log||[])].reverse().forEach(line=>{const d=document.createElement('div'); d.className='lo-entry'+(line.startsWith('—')?' lo-entry--round':''); d.textContent=line; list.appendChild(d);}); document.getElementById('log-overlay').classList.add('show');};

function renderDiscard(id,cards){const el=document.getElementById(id); el.innerHTML=''; cards.slice(-7).forEach(c=>{const card=makeCard(c,true,'card--sm'); card.onclick=()=>openZoom(c); el.appendChild(card);});}
function renderExcluded(cards){const el=document.getElementById('excluded-cards'); el.innerHTML=''; cards.forEach(c=>{const card=makeCard(c,true,'card--exc'); card.onclick=()=>openZoom(c); el.appendChild(card);});}

function renderTokens(id,count){
  const el=document.getElementById(id); if(!el)return;
  const max=lastState?.winTokens||6; let h='';
  for(let i=0;i<max;i++) h+=`<span class="token ${i<count?'earned':'empty'}">◆</span>`;
  el.innerHTML=h;
}

// ─── ДЕЙСТВИЯ ───
function onPlay(card,cardEl,s){
  if(!s?.isMyTurn)return;
  if(s.me.mustPlayCountess&&card.value!==8){showToast('Роковая женщина! Обязан сыграть карту 8.');return;}
  const opps=(s.opponents||[]).filter(o=>!o.eliminated&&!o.protected);
  if(card.value===1){if(opps.length>1)openTargetThenGuess(card,opps); else openGuessModal(card,opps[0]?.userId);}
  else if(card.value===5)openFederalModal(card,s);
  else if([2,3,7].includes(card.value)&&opps.length>1)openTargetModal(card,opps,'Выбери цель');
  else {const tid=opps[0]?.userId; cardEl.classList.add('my-playing'); playSound('card'); setTimeout(()=>socket.emit('play',{cardId:card.id,targetUserId:tid}),600);}
}

function openGuessModal(card,targetUserId){
  const el=document.getElementById('action-modal'),g=document.getElementById('action-options'); g.innerHTML='';
  for(let v=0;v<=9;v++){
    if(v===1)continue; const o=document.createElement('div'); o.className='am-opt';
    o.innerHTML=`<div class="card-seen-badge" style="top:-5px;right:-5px">${(lastState?.me?.seenCounts||{})[v]||0}/${CARDS[v].total}</div><span class="num">${v}</span>${CARDS[v].name}`;
    o.onclick=()=>{el.classList.remove('show'); socket.emit('play',{cardId:card.id,guess:v,targetUserId});}; g.appendChild(o);
  }
  el.classList.add('show');
}

function openFederalModal(card,s){
  const el=document.getElementById('target-modal'),o=document.getElementById('target-options'); o.innerHTML='';
  const self=document.createElement('div'); self.className='am-opt'; self.innerHTML=`<span class="num">★</span>Вы`;
  self.onclick=()=>{el.classList.remove('show'); socket.emit('play',{cardId:card.id,targetUserId:'self'});}; o.appendChild(self);
  (s.opponents||[]).filter(op=>!op.eliminated).forEach(op=>{
    const d=document.createElement('div'); d.className='am-opt'; if(op.protected)d.style.opacity='.4';
    d.innerHTML=`<span class="num">★</span>${esc(op.name)}`; d.onclick=()=>{if(!op.protected){el.classList.remove('show'); socket.emit('play',{cardId:card.id,targetUserId:op.userId});}}; o.appendChild(d);
  });
  el.classList.add('show');
}

function showChancellor(cards){
  const el=document.getElementById('chancellor-modal'),w=document.getElementById('chancellor-cards'); w.innerHTML='';
  cards.forEach(c=>{const o=document.createElement('div'); o.className='chancellor-option'; o.innerHTML=`<div class="card card--big face-up"><div class="card-face"><img src="assets/cards/${c.value}.png"></div></div><div class="chancellor-choose-label">ВЫБРАТЬ</div>`; o.onclick=()=>{socket.emit('chancellor_pick',c.id);el.classList.remove('show');}; w.appendChild(o);});
  el.classList.add('show');
}

function openZoom(card){if(!card)return; const def=CARDS[card.value],w=document.getElementById('cz-card-img'); w.innerHTML=`<img src="assets/cards/${card.value}.png">`; document.getElementById('cz-name').textContent=def.name; document.getElementById('cz-desc').textContent=def.desc; document.getElementById('cz-seen').textContent=`Видено: ${(lastState?.me?.seenCounts||{})[card.value]||0}/${def.total}`; document.getElementById('card-zoom').classList.add('show');}

function showPeek(data){const w=document.getElementById('peek-card'); w.innerHTML=''; if(data.card)w.appendChild(makeCard(data.card,true,'card--big')); document.getElementById('peek-card-name').textContent=data.cardName; document.getElementById('peek-overlay').classList.add('show');}

function showRoundOver(ro){const ov=document.getElementById('round-over'),iW=ro.winnerId===ME.id; document.getElementById('ro-title').textContent=iW?'✦ ПОБЕДА!':'✗ ПОРАЖЕНИЕ'; document.getElementById('ro-reason').textContent=ro.reason; if(!iW)shakeScreen(); else playSound('success'); ov.classList.add('show'); setTimeout(()=>ov.classList.remove('show'),4000);}
function showGameOver(go){const ov=document.getElementById('game-over'); document.getElementById('go-reason').textContent=go.reason; document.getElementById('go-tokens-row').innerHTML=go.scores.map(s=>`<span>${esc(s.name)}: <strong>${s.tokens}</strong></span>`).join(' | '); ov.classList.add('show');}

document.getElementById('btn-surrender').onclick=()=>{if(confirm('Сдаться?'))socket.emit('surrender');};
document.getElementById('btn-rematch').onclick=()=>socket.emit('rematch');
document.getElementById('btn-to-menu').onclick=goToMenu;
function goToMenu(){window.location.reload();}
function closeAllOverlays(){document.querySelectorAll('.overlay').forEach(o=>o.classList.remove('show'));}
function showToast(msg){const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2500);}
function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

// КРЕСТИКИ
document.getElementById('cz-close').onclick=()=>document.getElementById('card-zoom').classList.remove('show');
document.getElementById('lo-close').onclick=()=>document.getElementById('log-overlay').classList.remove('show');
document.getElementById('do-close').onclick=()=>document.getElementById('deck-overlay').classList.remove('show');
document.getElementById('action-cancel').onclick=()=>document.getElementById('action-modal').classList.remove('show');
document.getElementById('target-cancel').onclick=()=>document.getElementById('target-modal').classList.remove('show');
document.getElementById('peek-close').onclick=()=>document.getElementById('peek-overlay').classList.remove('show');

document.getElementById('deck-btn').onclick=e=>{const g=document.getElementById('do-grid'); g.innerHTML=''; for(let v=0;v<=9;v++){const d=CARDS[v],r=document.createElement('div'); r.className='do-row'; r.innerHTML=`<div class="do-mini"><img src="assets/cards/${v}.png" onerror="this.style.display='none'"></div><div class="do-info"><div class="do-name">${d.name}</div></div>`; r.onclick=()=>{document.getElementById('do-detail-box').style.display='block'; document.getElementById('do-detail-name').textContent=d.name; document.getElementById('do-detail-desc').textContent=d.desc;}; g.appendChild(r);} document.getElementById('deck-overlay').classList.add('show');};
