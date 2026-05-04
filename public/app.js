// =====================================================================
// Тёмная Дуэль — Frontend v4
// =====================================================================
const tg = window.Telegram?.WebApp;
if(tg){tg.ready();tg.expand();tg.setHeaderColor?.('#08050f');tg.setBackgroundColor?.('#08050f');}
const tgUser = tg?.initDataUnsafe?.user;
const ME = {
  id:tgUser?`tg_${tgUser.id}`:`g_${Math.random().toString(36).slice(2,9)}`,
  name:tgUser?[tgUser.first_name,tgUser.last_name].filter(Boolean).join(' '):'Гость',
  avatar:tgUser?.photo_url||null,
};

const CARDS={
  0:{name:'Информатор',total:2,desc:'Ничего при розыгрыше. Если в конце раунда ты единственный выживший с Информатором — +1 жетон.'},
  1:{name:'Детектив',total:6,desc:'Назови карту (не Детектив). Если у соперника она — он выбывает.'},
  2:{name:'Журналист',total:2,desc:'Тайно посмотри карту соперника.'},
  3:{name:'Громила',total:2,desc:'Сравните карты. У кого ниже — выбывает. Ничья — никто.'},
  4:{name:'Продажный коп',total:2,desc:'До следующего хода ты под защитой.'},
  5:{name:'Федерал',total:2,desc:'Выбери игрока. Он сбрасывает карту и берёт новую. Компромат = выбывает.'},
  6:{name:'Теневой брокер',total:2,desc:'Возьми 2 из колоды. Оставь 1 из 3, остальные вниз колоды.'},
  7:{name:'Босс мафии',total:1,desc:'Поменяйся картами с соперником.'},
  8:{name:'Роковая женщина',total:1,desc:'Нет эффекта. Если в руке Федерал(5) или Босс(7) — обязан сыграть.'},
  9:{name:'Компромат',total:1,desc:'Сбросишь — выбываешь.'},
};

// Список рубашек. Имя = имя файла без .png в assets/backs/
const AVAILABLE_BACKS = [
  {id:'back',       name:'Классика'},
  {id:'back_noir',  name:'Нуар'},
  {id:'back_red',   name:'Кровь'},
  {id:'back_gold',  name:'Золото'},
  {id:'back_smoke', name:'Дым'},
];
let mySelectedBack = 'back';

// ─── ЗВУК ───
const bgm=document.getElementById('bgm');bgm.volume=.38;
let musicStarted=false;
function startMusic(){if(musicStarted)return;musicStarted=true;bgm.play().catch(()=>{musicStarted=false});}
let audioCtx=null;
function playClick(){try{if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();const n=audioCtx.currentTime,o=audioCtx.createOscillator(),g=audioCtx.createGain();o.connect(g);g.connect(audioCtx.destination);o.type='triangle';o.frequency.setValueAtTime(800,n);o.frequency.exponentialRampToValueAtTime(380,n+.07);g.gain.setValueAtTime(.13,n);g.gain.exponentialRampToValueAtTime(.001,n+.09);o.start(n);o.stop(n+.1);}catch(e){}}
function playCardSound(){try{if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();const n=audioCtx.currentTime,o=audioCtx.createOscillator(),g=audioCtx.createGain();o.connect(g);g.connect(audioCtx.destination);o.type='sine';o.frequency.setValueAtTime(300,n);o.frequency.exponentialRampToValueAtTime(160,n+.16);g.gain.setValueAtTime(.16,n);g.gain.exponentialRampToValueAtTime(.001,n+.19);o.start(n);o.stop(n+.2);}catch(e){}}
document.body.addEventListener('click',e=>{if(e.target.closest('.btn,.am-opt,.g-deck-btn,.g-log-strip,.play-arrow,.chancellor-option,.lb-card,.back-option,#intro'))playClick();},true);

// ─── ЭКРАНЫ ───
function showScreen(id){document.querySelectorAll('.screen').forEach(s=>s.classList.toggle('active',s.id===id));}

// ─── ЗАСТАВКА ───
let introStep=0;
const introLayers=document.querySelectorAll('.intro-layer'),introHint=document.querySelector('.intro-hint');
function advanceIntro(){startMusic();if(introStep<introLayers.length){introLayers[introStep].classList.add('show');introStep++;if(introStep===introLayers.length)introHint.textContent='тапни, чтобы войти';}else{document.getElementById('intro').removeEventListener('click',advanceIntro);setTimeout(()=>showScreen('menu'),220);}}
window.addEventListener('load',()=>{advanceIntro();document.getElementById('intro').addEventListener('click',advanceIntro);connectSocket();
  // invite link
  const sp=tg?.initDataUnsafe?.start_param;
  if(sp){document.getElementById('intro').classList.remove('active');showScreen('menu');
    setTimeout(()=>{socket.emit('join_lobby',{lobbyId:sp,user:ME});showScreen('lobby');},500);}
});

// ─── SOCKET ───
let socket=null;
function connectSocket(){
  if(socket?.connected)return;
  socket=io({transports:['websocket','polling']});
  socket.on('connect',()=>{
    console.log('✓',socket.id);
    socket.emit('get_player_data',ME.id);
  });
  socket.on('player_data',d=>{
    document.getElementById('stat-wins').textContent=d.wins||0;
    document.getElementById('stat-losses').textContent=d.losses||0;
    mySelectedBack=d.selectedBack||'back';
  });
  socket.on('back_updated',b=>{mySelectedBack=b;renderBacks();});
  socket.on('lobby_list',renderLobbyList);
  socket.on('lobby_joined',onLobbyJoined);
  socket.on('game_started',()=>{showScreen('game');closeAllOverlays();resetGameState();});
  socket.on('new_round',()=>{closeAllOverlays();stopRoundTimer();});
  socket.on('state',s=>handleNewState(s));
  socket.on('peek',d=>showPeek(d));
  socket.on('chancellor_choice',d=>showChancellor(d.cards));
  socket.on('rematch_pending',({count})=>{document.getElementById('go-pending').textContent=count>=1?'Ждём…':'';});
  socket.on('opponent_left',()=>{showToast('Соперник ушёл');setTimeout(goToMenu,1800);});
  socket.on('error_msg',msg=>showToast(msg));
  socket.on('invite_link_data',({lobbyId})=>{
    const BOT='YourBotName',APP='play';
    const link=`https://t.me/${BOT}/${APP}?startapp=${lobbyId}`;
    if(tg?.openTelegramLink)tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Дуэль! Комната '+lobbyId)}`);
    else{navigator.clipboard?.writeText(link);showToast('Ссылка скопирована');}
  });
}

// ═══ МЕНЮ ═══
document.getElementById('btn-play').addEventListener('click',()=>showScreen('lobby-browser'));
document.getElementById('btn-backs').addEventListener('click',()=>{renderBacks();showScreen('backs');});

// ═══ ЛОББИ-БРАУЗЕР ═══
document.getElementById('lb-back').addEventListener('click',()=>showScreen('menu'));
document.getElementById('btn-create-lobby').addEventListener('click',()=>{
  socket.emit('create_lobby',{user:ME});
  showScreen('lobby');
});

function renderLobbyList(list){
  const el=document.getElementById('lb-list');el.innerHTML='';
  if(!list||list.length===0){el.innerHTML='<div class="lb-empty">Нет открытых лобби. Создай своё!</div>';return;}
  list.forEach(l=>{
    const card=document.createElement('div');card.className='lb-card';
    card.innerHTML=`<div class="lb-card-info"><div class="lb-card-name">${esc(l.creatorName)}</div><div class="lb-card-count">${l.playerCount}/${l.maxPlayers} игроков</div></div>`;
    const btn=document.createElement('button');btn.className='btn btn-secondary';btn.innerHTML='<span>Войти</span>';
    btn.addEventListener('click',()=>{socket.emit('join_lobby',{lobbyId:l.id,user:ME});showScreen('lobby');});
    card.appendChild(btn);el.appendChild(card);
  });
}

// ═══ ВНУТРИ ЛОББИ ═══
let currentLobby=null;

function onLobbyJoined(lobby){
  currentLobby=lobby;
  document.getElementById('lobby-room-id').textContent=lobby.id;
  const isCreator=lobby.players[0]?.userId===ME.id || lobby.players.find(p=>p.userId===ME.id && !p.isBot && lobby.players[0]?.userId===ME.id);
  const amCreator=lobby.players.length>0 && lobby.players[0]?.userId===ME.id;

  // Показываем игроков
  const c=document.getElementById('lobby-players');c.innerHTML='';
  for(let i=0;i<lobby.maxPlayers;i++){
    const p=lobby.players[i];
    const el=document.createElement('div');el.className='lobby-player';
    if(p){
      el.innerHTML=`<div class="lobby-player-avatar"${p.avatar?` style="background-image:url('${p.avatar}')"`:''}>${p.isBot?'🤖':''}</div><div class="lobby-player-name">${esc(p.name)}</div>`;
    } else {
      el.style.opacity='.4';
      el.innerHTML='<div class="lobby-player-avatar" style="border-style:dashed">?</div><div class="lobby-player-name">пусто</div>';
    }
    c.appendChild(el);
  }

  // Кнопки
  const actions=document.getElementById('lobby-actions');
  const wait=document.getElementById('lobby-wait');
  if(amCreator){
    actions.style.display='flex';wait.style.display='none';
    document.getElementById('btn-start-game').style.display = lobby.players.length>=2?'flex':'none';
    const hasBot=lobby.players.some(p=>p.isBot);
    document.getElementById('btn-add-bot').style.display = (!lobby.isFull && lobby.players.length<lobby.maxPlayers && !hasBot)?'flex':'none';
  } else {
    actions.style.display='none';wait.style.display='flex';
  }
}

document.getElementById('btn-start-game').addEventListener('click',()=>socket.emit('start_game'));
document.getElementById('btn-add-bot').addEventListener('click',()=>socket.emit('add_bot'));
document.getElementById('btn-invite-friend').addEventListener('click',()=>socket.emit('invite_link'));
document.getElementById('btn-leave-lobby').addEventListener('click',leaveLobby);
document.getElementById('btn-leave-lobby2').addEventListener('click',leaveLobby);
function leaveLobby(){socket.emit('leave_lobby');currentLobby=null;showScreen('lobby-browser');}

// ═══ РУБАШКИ ═══
document.getElementById('backs-back').addEventListener('click',()=>showScreen('menu'));
function renderBacks(){
  const grid=document.getElementById('backs-grid');grid.innerHTML='';
  AVAILABLE_BACKS.forEach(b=>{
    const opt=document.createElement('div');opt.className='back-option'+(b.id===mySelectedBack?' selected':'');
    opt.innerHTML=`<img src="assets/backs/${b.id}.png" onerror="this.src='assets/cards/back.png'" alt="${b.name}"/><div class="back-option-name">${b.name}</div>`;
    opt.addEventListener('click',()=>{
      socket.emit('set_back',{userId:ME.id,backName:b.id});
      mySelectedBack=b.id;
      renderBacks();
    });
    grid.appendChild(opt);
  });
}

// ═══ ИГРОВОЕ СОСТОЯНИЕ ═══
let lastState=null,pendingCard=null,pendingCardElement=null,roundTimerInterval=null;
let prevOppDiscardLen=0,prevOppHandCount=0;
let stateQueue=[],busyAnimating=false;
function resetGameState(){lastState=null;pendingCard=null;pendingCardElement=null;prevOppDiscardLen=0;prevOppHandCount=0;stateQueue=[];busyAnimating=false;stopRoundTimer();}

function handleNewState(s){
  if(busyAnimating){stateQueue.push(s);return;}
  processState(s);
}
function processState(s){
  const isFirst=!lastState;
  const oppPlayed=!isFirst&&s.opponent&&lastState.opponent&&(s.opponent.discard.length>prevOppDiscardLen);
  if(oppPlayed){
    const playedCard=s.opponent.discard[s.opponent.discard.length-1];
    busyAnimating=true;
    updateLogStrip(s.log);
    animateOppReveal(playedCard,()=>{
      lastState=s;prevOppDiscardLen=s.opponent?.discard?.length||0;prevOppHandCount=s.opponent?.handCount||0;
      renderState(s,false,true);busyAnimating=false;
      if(stateQueue.length>0){const n=stateQueue.shift();setTimeout(()=>processState(n),50);}
    });
  } else {
    const oppDrew=!isFirst&&s.opponent&&lastState.opponent&&s.opponent.handCount>prevOppHandCount;
    lastState=s;prevOppDiscardLen=s.opponent?.discard?.length||0;prevOppHandCount=s.opponent?.handCount||0;
    renderState(s,isFirst,false);
    if(oppDrew)playCardSound();
  }
}

function animateOppReveal(playedCard,cb){
  const zone=document.getElementById('opp-card-zone');
  const ex=zone.querySelector('.card');
  if(!ex||!playedCard){if(ex)zone.innerHTML='';cb();return;}
  ex.classList.remove('opp-turn-glow');
  const face=ex.querySelector('.card-face');
  face.innerHTML='';
  const img=document.createElement('img');img.src=`assets/cards/${playedCard.value}.png`;img.onerror=()=>img.style.display='none';face.appendChild(img);
  ex.classList.add('opp-zoom');
  setTimeout(()=>{ex.classList.add('face-up');playCardSound();},280);
  setTimeout(()=>{ex.classList.remove('opp-zoom');ex.classList.add('opp-fly');},700);
  setTimeout(()=>{zone.innerHTML='';cb();},1250);
}

function animateMyPlay(card,el,extra={}){
  if(!el||!el.parentElement){socket.emit('play',{cardId:card.id,...extra});return;}
  busyAnimating=true;el.classList.remove('my-turn-glow');el.classList.add('my-playing');
  setTimeout(()=>{socket.emit('play',{cardId:card.id,...extra});setTimeout(()=>{busyAnimating=false;if(stateQueue.length>0&&!busyAnimating){const n=stateQueue.shift();processState(n);}},200);},600);
}

// ═══ РЕНДЕР ═══
function renderState(s,isFirst,oppJustPlayed){
  document.getElementById('me-name').textContent=s.me?.name||'Вы';
  document.getElementById('opp-name').textContent=s.opponent?.name||'Соперник';
  document.getElementById('me-status').textContent=s.isMyTurn?'твой ход':(s.me?.protected?'под защитой':'');
  document.getElementById('opp-status').textContent=!s.isMyTurn?'ходит':(s.opponent?.protected?'под защитой':'');
  const setAv=(id,url)=>{if(url)document.getElementById(id).style.backgroundImage=`url('${url}')`;};
  setAv('me-avatar',s.me?.avatar);setAv('opp-avatar',s.opponent?.avatar);
  renderTokens('me-tokens',s.me?.tokens||0);renderTokens('opp-tokens',s.opponent?.tokens||0);
  renderOppCard(s,isFirst,oppJustPlayed);renderMyCards(s,isFirst);
  renderExcluded(s.excludedCards||[]);
  renderDiscard('me-discard',s.me?.discard||[],false);
  renderDiscard('opp-discard',s.opponent?.discard||[],oppJustPlayed);
  document.getElementById('deck-count-badge').textContent=s.deckCount;
  updateLogStrip(s.log);
  if(s.gameOver){stopRoundTimer();showGameOver(s.gameOver);}
  else if(s.roundOver)showRoundOver(s.roundOver);
  else{document.getElementById('round-over').classList.remove('show');document.getElementById('game-over').classList.remove('show');}
}

function renderOppCard(s,isFirst,oppJP){
  const zone=document.getElementById('opp-card-zone');zone.innerHTML='';
  if(!s.opponent||s.opponent.handCount===0)return;
  const backImg = s.opponent.back || 'back';
  const card=makeCard(null,false,'card--opp',backImg);
  if(!s.isMyTurn)card.classList.add('opp-turn-glow');
  if(isFirst){card.classList.add('dealing');card.style.animationDelay='0s';}
  else if(oppJP){card.classList.add('opp-incoming');playCardSound();}
  zone.appendChild(card);
}

function renderMyCards(s,isFirst){
  const zone=document.getElementById('my-card-zone');zone.innerHTML='';
  if(!s.me?.hand?.length)return;
  const myTurn=s.isMyTurn;
  const myBack=s.me.back||mySelectedBack||'back';
  const row=document.createElement('div');row.style.cssText='display:flex;gap:24px;align-items:center;';
  s.me.hand.forEach((c,idx)=>{
    const wrap=document.createElement('div');wrap.className='play-arrow-wrap';
    const cardEl=makeCard(c,true,'card--big',myBack);
    if(myTurn)cardEl.classList.add('my-turn-glow');
    if(isFirst){cardEl.classList.add('dealing');cardEl.style.animationDelay=`${idx*.2+.15}s`;}
    const seen=(s.me?.seenCounts||{})[c.value]||0;
    const badge=document.createElement('div');badge.className='card-seen-badge';badge.textContent=`${seen}/${CARDS[c.value]?.total||'?'}`;
    cardEl.appendChild(badge);
    cardEl.addEventListener('click',e=>{e.stopPropagation();openZoom(c,s.me?.seenCounts||{});});
    if(myTurn){const arrow=document.createElement('div');arrow.className='play-arrow';arrow.addEventListener('click',e=>{e.stopPropagation();onPlay(c,cardEl);});wrap.appendChild(arrow);}
    wrap.appendChild(cardEl);row.appendChild(wrap);
  });
  zone.appendChild(row);
}

function makeCard(card,faceUp,sizeClass,backName){
  const el=document.createElement('div');
  el.className=`card ${sizeClass||'card--big'}${faceUp?' face-up':''}`;
  const back=document.createElement('div');back.className='card-back';
  const bi=document.createElement('img');
  bi.src=`assets/backs/${backName||'back'}.png`;
  bi.onerror=()=>{bi.src='assets/cards/back.png';bi.onerror=()=>bi.style.display='none';};
  bi.alt='';back.appendChild(bi);el.appendChild(back);
  const face=document.createElement('div');face.className='card-face';
  if(card){const img=document.createElement('img');img.src=`assets/cards/${card.value}.png`;img.onerror=()=>img.style.display='none';img.alt='';face.appendChild(img);}
  el.appendChild(face);return el;
}

function updateLogStrip(log){
  const l=(log||[]).filter(Boolean);
  document.getElementById('log-line-1').textContent=l[l.length-1]||'—';
  document.getElementById('log-line-2').textContent=l[l.length-2]||'';
}
document.getElementById('log-strip').addEventListener('click',()=>{
  if(!lastState)return;const list=document.getElementById('lo-list');list.innerHTML='';
  [...(lastState.log||[])].reverse().forEach(line=>{const d=document.createElement('div');d.className='lo-entry';d.textContent=line;list.appendChild(d);});
  document.getElementById('log-overlay').classList.add('show');
});
document.getElementById('log-overlay').addEventListener('click',()=>document.getElementById('log-overlay').classList.remove('show'));

function renderDiscard(id,cards,animLast){
  const el=document.getElementById(id);el.innerHTML='';
  cards.slice(-7).forEach((c,i)=>{
    const card=makeCard(c,true,'card--sm');
    if(animLast&&i===cards.slice(-7).length-1)card.classList.add('discard-entry');
    card.addEventListener('click',()=>openZoom(c,lastState?.me?.seenCounts||{}));el.appendChild(card);
  });
}
function renderExcluded(cards){
  const el=document.getElementById('excluded-cards');el.innerHTML='';
  cards.forEach(c=>{const card=makeCard(c,true,'card--exc');card.addEventListener('click',()=>openZoom(c,lastState?.me?.seenCounts||{}));el.appendChild(card);});
}
let prevTokens={};
function renderTokens(id,count){
  const el=document.getElementById(id);if(!el)return;const prev=prevTokens[id]??0;prevTokens[id]=count;let h='';
  for(let i=0;i<6;i++){const e=i<count,n=e&&i>=prev;h+=`<span class="token ${e?'earned':'empty'}${n?' new-earn':''}">◆</span>`;}el.innerHTML=h;
}

// ─── СЫГРАТЬ ───
function onPlay(card,cardEl){
  if(!lastState?.isMyTurn)return;pendingCard=card;pendingCardElement=cardEl;
  if(card.value===1)openGuessModal(card);
  else if(card.value===5)openTargetModal(card);
  else animateMyPlay(card,cardEl);
}
function openGuessModal(card){
  const el=document.getElementById('action-modal'),g=document.getElementById('action-options');g.innerHTML='';
  for(let v=0;v<=9;v++){if(v===1)continue;const o=document.createElement('div');o.className='am-opt';o.innerHTML=`<span class="num">${v}</span>${CARDS[v].name}`;
    o.addEventListener('click',()=>{el.classList.remove('show');animateMyPlay(card,pendingCardElement,{guess:v});pendingCard=null;});g.appendChild(o);}
  el.classList.add('show');
}
function openTargetModal(card){
  const el=document.getElementById('target-modal'),o=document.getElementById('target-options');o.innerHTML='';
  [{id:'self',label:lastState?.me?.name||'Я',sub:'себя'},{id:'opp',label:lastState?.opponent?.name||'Соперник',sub:'соперника'}].forEach(t=>{
    const d=document.createElement('div');d.className='am-opt';d.innerHTML=`<span class="num">★</span>${esc(t.label)}<br/><small style="opacity:.5;font-size:9px">${t.sub}</small>`;
    d.addEventListener('click',()=>{el.classList.remove('show');animateMyPlay(card,pendingCardElement,{target:t.id});pendingCard=null;});o.appendChild(d);});
  el.classList.add('show');
}
document.getElementById('action-cancel').addEventListener('click',()=>{pendingCard=null;document.getElementById('action-modal').classList.remove('show');});
document.getElementById('target-cancel').addEventListener('click',()=>{pendingCard=null;document.getElementById('target-modal').classList.remove('show');});

function showChancellor(cards){
  const el=document.getElementById('chancellor-modal'),w=document.getElementById('chancellor-cards');w.innerHTML='';
  cards.forEach(c=>{const o=document.createElement('div');o.className='chancellor-option';const ce=makeCard(c,true,'card--big');
    const l=document.createElement('div');l.className='chancellor-choose-label';l.textContent='Выбрать';
    o.addEventListener('click',()=>{socket.emit('chancellor_pick',c.id);el.classList.remove('show');});
    o.appendChild(ce);o.appendChild(l);w.appendChild(o);});el.classList.add('show');
}

// ─── ЗУМ ───
function openZoom(card,seen){
  if(!card)return;const def=CARDS[card.value],w=document.getElementById('cz-card-img');w.innerHTML='';
  const img=document.createElement('img');img.src=`assets/cards/${card.value}.png`;img.onerror=()=>img.style.display='none';w.appendChild(img);
  document.getElementById('cz-name').textContent=def.name;document.getElementById('cz-value').textContent=`Карта ${card.value}`;
  document.getElementById('cz-desc').textContent=def.desc;
  const s=(seen||{})[card.value]||0;document.getElementById('cz-seen').textContent=`Видено: ${s} из ${def.total}`;
  document.getElementById('card-zoom').classList.add('show');
}
document.getElementById('card-zoom').addEventListener('click',()=>document.getElementById('card-zoom').classList.remove('show'));

document.getElementById('deck-btn').addEventListener('click',e=>{
  e.stopPropagation();const g=document.getElementById('do-grid');g.innerHTML='';
  for(let v=0;v<=9;v++){const d=CARDS[v],r=document.createElement('div');r.className='do-row';
    const m=document.createElement('div');m.className='do-mini';const i=document.createElement('img');i.src=`assets/cards/${v}.png`;i.onerror=()=>i.style.display='none';m.appendChild(i);
    const inf=document.createElement('div');inf.className='do-info';inf.innerHTML=`<div class="do-name">${d.name}</div><div class="do-cnt">${d.total}</div>`;
    r.appendChild(m);r.appendChild(inf);g.appendChild(r);}
  document.getElementById('deck-overlay').classList.add('show');
});
document.getElementById('deck-overlay').addEventListener('click',()=>document.getElementById('deck-overlay').classList.remove('show'));

function showPeek(data){
  const w=document.getElementById('peek-card');w.innerHTML='';
  if(data.card){w.appendChild(makeCard(data.card,true,'card--big'));}
  document.getElementById('peek-title').textContent=`У ${data.playerName}`;
  document.getElementById('peek-card-name').textContent=data.cardName||'';
  document.getElementById('peek-card-desc').textContent=CARDS[data.card?.value]?.desc||'';
  document.getElementById('peek-overlay').classList.add('show');
  tg?.HapticFeedback?.impactOccurred?.('medium');
}
document.getElementById('peek-close').addEventListener('click',()=>document.getElementById('peek-overlay').classList.remove('show'));

// ─── РЕЗУЛЬТАТЫ ───
let roundTimerVal=4;
function showRoundOver(ro){
  stopRoundTimer();const ov=document.getElementById('round-over'),iW=ro.winnerId===ME.id;
  document.getElementById('ro-glyph').textContent=iW?'✦':'✗';document.getElementById('ro-glyph').style.color=iW?'var(--gold)':'var(--red-b)';
  document.getElementById('ro-title').textContent=iW?'Раунд ваш!':'Раунд потерян';
  document.getElementById('ro-sub').textContent=iW?`${esc(ro.loserName)} теряет`:'Вы теряете';
  document.getElementById('ro-tokens-row').innerHTML=`<span>${esc(ro.winnerName)}: <strong>${ro.winnerTokens} ◆</strong></span> <span style="margin:0 8px;opacity:.4">|</span> <span>${esc(ro.loserName)}: <strong>${ro.loserTokens} ◆</strong></span>`;
  ov.classList.add('show');tg?.HapticFeedback?.notificationOccurred?.(iW?'success':'error');
  roundTimerVal=4;document.getElementById('ro-timer').textContent=roundTimerVal;
  roundTimerInterval=setInterval(()=>{roundTimerVal--;document.getElementById('ro-timer').textContent=roundTimerVal;if(roundTimerVal<=0){stopRoundTimer();ov.classList.remove('show');}},1000);
}
function stopRoundTimer(){if(roundTimerInterval){clearInterval(roundTimerInterval);roundTimerInterval=null;}}
function showGameOver(go){
  stopRoundTimer();const iW=go.winnerId===ME.id;
  document.getElementById('go-glyph').textContent=iW?'✦':'✗';document.getElementById('go-title').textContent=iW?'Победа!':'Поражение';
  document.getElementById('go-sub').textContent=iW?`${esc(go.loserName)} разоблачён.`:'Связи уничтожены.';
  document.getElementById('go-tokens-row').innerHTML=`<span>${esc(go.winnerName)}: <strong>${go.winnerTokens} ◆</strong></span> <span style="margin:0 8px;opacity:.4">|</span> <span>${esc(go.loserName)}: <strong>${go.loserTokens} ◆</strong></span>`;
  document.getElementById('go-pending').textContent='';document.getElementById('game-over').classList.add('show');
  tg?.HapticFeedback?.notificationOccurred?.(iW?'success':'error');
}
document.getElementById('btn-rematch').addEventListener('click',()=>{socket.emit('rematch');document.getElementById('go-pending').textContent='Ждём…';});
document.getElementById('btn-to-menu').addEventListener('click',goToMenu);

function goToMenu(){
  stopRoundTimer();socket?.emit('leave_game');
  lastState=null;resetGameState();closeAllOverlays();showScreen('menu');
  socket?.emit('get_player_data',ME.id); // обновить статистику
}
function closeAllOverlays(){document.querySelectorAll('.overlay').forEach(o=>o.classList.remove('show'));}
function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500);}
function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
