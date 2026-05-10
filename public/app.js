// =====================================================================
// Тёмная Дуэль — Frontend v16 (Железобетонная версия)
// =====================================================================
var tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
if (tg) {
  if (tg.ready) tg.ready();
  if (tg.expand) tg.expand();
  if (tg.setHeaderColor) tg.setHeaderColor('#08050f');
  if (tg.setBackgroundColor) tg.setBackgroundColor('#08050f');
}

var tgUser = (tg && tg.initDataUnsafe) ? tg.initDataUnsafe.user : null;
var ME = {
  id: tgUser ? 'tg_' + tgUser.id : 'g_' + Math.random().toString(36).slice(2,9),
  name: tgUser ? [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') : 'Гость',
  avatar: tgUser ? tgUser.photo_url : null
};

var BOT_LINK = "https://t.me/PumpHuntRealBot/POGNALI";

var CARDS = {
  0: {name:'Информатор', total:2, desc:'Ничего при розыгрыше. В конце раунда, если ты единственный выживший с Информатором — +1 жетон.'},
  1: {name:'Детектив', total:6, desc:'Назови карту (не Детектив). Если у соперника она — он выбывает.'},
  2: {name:'Журналист', total:2, desc:'Тайно посмотри карту соперника.'},
  3: {name:'Громила', total:2, desc:'Сравните карты. У кого ниже — выбывает. Ничья — никто.'},
  4: {name:'Продажный коп', total:2, desc:'До следующего хода ты под защитой.'},
  5: {name:'Федерал', total:2, desc:'Выбери игрока. Он сбрасывает карту и берёт новую. Компромат=выбывает.'},
  6: {name:'Теневой брокер', total:2, desc:'Возьми 2 из колоды. Оставь 1 из 3, остальные вниз колоды.'},
  7: {name:'Босс мафии', total:1, desc:'Поменяйся картами с соперником.'},
  8: {name:'Роковая женщина', total:1, desc:'Нет эффекта. Если в руке Федерал(5) или Босс(7) — обязан сыграть.'},
  9: {name:'Компромат', total:1, desc:'Сбросишь — выбываешь.'}
};

var AVAILABLE_BACKS = [
  {id:'back', name:'Классика'},
  {id:'back_noir', name:'Нуар'},
  {id:'back_red', name:'Кровь'},
  {id:'back_gold', name:'Золото'},
  {id:'back_smoke', name:'Дым'}
];
var mySelectedBack = 'back';

// ─── БЕЗОПАСНАЯ ПРИВЯЗКА КНОПОК ───
function bindClick(id, cb) {
  var el = document.getElementById(id);
  if (el) el.addEventListener('click', cb);
}

// ─── ЗВУК И ВИБРО ───
var bgm = document.getElementById('bgm');
if (bgm) bgm.volume = 0.38;
var musicStarted = false;
function startMusic() {
  if (musicStarted || !bgm) return;
  musicStarted = true;
  bgm.play().catch(function(){ musicStarted = false; });
}

var audioCtx = null;
function playSound(type) {
  type = type || 'click';
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    var n = audioCtx.currentTime;
    var o = audioCtx.createOscillator();
    var g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    if (type === 'click') {
      o.type = 'triangle'; o.frequency.setValueAtTime(800, n); o.frequency.exponentialRampToValueAtTime(380, n+0.07);
      g.gain.setValueAtTime(0.13, n); g.gain.exponentialRampToValueAtTime(0.001, n+0.09); o.start(n); o.stop(n+0.1);
    } else if (type === 'card') {
      o.type = 'sine'; o.frequency.setValueAtTime(300, n); o.frequency.exponentialRampToValueAtTime(160, n+0.16);
      g.gain.setValueAtTime(0.16, n); g.gain.exponentialRampToValueAtTime(0.001, n+0.19); o.start(n); o.stop(n+0.2);
    } else if (type === 'clash') {
      o.type = 'square'; o.frequency.setValueAtTime(150, n); o.frequency.exponentialRampToValueAtTime(50, n+0.3);
      g.gain.setValueAtTime(0.3, n); g.gain.exponentialRampToValueAtTime(0.001, n+0.4); o.start(n); o.stop(n+0.5);
    } else if (type === 'success') {
      o.type = 'sine'; o.frequency.setValueAtTime(523, n); o.frequency.setValueAtTime(659, n+0.15); o.frequency.setValueAtTime(784, n+0.3);
      g.gain.setValueAtTime(0.15, n); g.gain.exponentialRampToValueAtTime(0.001, n+0.5); o.start(n); o.stop(n+0.55);
    }
  } catch(e) {}
}

document.body.addEventListener('click', function(e) {
  startMusic();
  if (e.target.closest('.btn,.am-opt,.g-deck-btn,.g-log-strip,.play-arrow,.chancellor-option,.lb-card,.back-option,.lc-slot,.btn-close-bottom,.do-row')) {
    playSound('click');
  }
}, true);

function triggerVibe(t) {
  if (tg && tg.HapticFeedback && tg.HapticFeedback.impactOccurred) {
    tg.HapticFeedback.impactOccurred(t || 'medium');
  }
}

function shakeScreen() {
  var gameEl = document.getElementById('game');
  if (!gameEl) return;
  gameEl.classList.remove('shake-screen');
  void gameEl.offsetWidth;
  gameEl.classList.add('shake-screen');
  triggerVibe('heavy');
  playSound('clash');
}

function showScreen(id) {
  var screens = document.querySelectorAll('.screen');
  for (var i = 0; i < screens.length; i++) {
    if (screens[i].id === id) screens[i].classList.add('active');
    else screens[i].classList.remove('active');
  }
}

// ─── ИНИЦИАЛИЗАЦИЯ ───
window.addEventListener('load', function() {
  // Вырубаем заставку железно
  var introEl = document.getElementById('intro');
  if (introEl) introEl.style.display = 'none';

  showScreen('menu');
  
  try { connectSocket(); } catch(err) { console.log('Socket error', err); }

  var sp = (tg && tg.initDataUnsafe) ? tg.initDataUnsafe.start_param : null;
  if (sp && socket) {
    setTimeout(function(){ socket.emit('join_lobby', {lobbyId: sp, user: ME}); showScreen('lobby'); }, 200);
  }

  // Привязываем все кнопки
  bindClick('btn-play', function(){ showScreen('lobby-browser'); });
  bindClick('btn-backs', function(){ renderBacks(); showScreen('backs'); });
  bindClick('lb-back', function(){ showScreen('menu'); });
  bindClick('lc-back', function(){ showScreen('lobby-browser'); });
  bindClick('btn-create-lobby', function(){ renderCreateLobby(); showScreen('lobby-create'); });
  bindClick('lc-create-btn', function(){
    if (socket) socket.emit('create_lobby', {user: ME, maxPlayers: createSlotCount});
    showScreen('lobby');
  });
  bindClick('backs-back', function(){ showScreen('menu'); });
  
  bindClick('btn-tutorial', startTutorial);
  bindClick('tut-next', function(){ tutStep++; renderTutStep(); playSound('click'); });
  bindClick('tut-skip', function(){ showScreen('menu'); });

  bindClick('btn-start-game', function(){ if(socket) socket.emit('start_game'); });
  bindClick('btn-add-bot', function(){ if(socket) socket.emit('add_bot'); });
  bindClick('btn-leave-lobby', function(){ window.location.reload(); });
  bindClick('btn-leave-lobby2', function(){ window.location.reload(); });
  bindClick('btn-invite-friend', function(){
    if (!currentLobby) return;
    var link = BOT_LINK + "?startapp=" + currentLobby.id;
    if (tg && tg.openTelegramLink) tg.openTelegramLink("https://t.me/share/url?url=" + encodeURIComponent(link) + "&text=" + encodeURIComponent("ДУЭЛЬ!"));
  });

  bindClick('btn-surrender', function(){ if(confirm('Сдаться?')) { if(socket) socket.emit('surrender'); } });
  bindClick('btn-rematch', function(){ if(socket) socket.emit('rematch'); });
  bindClick('btn-to-menu', function(){ window.location.reload(); });

  // Крестики
  bindClick('cz-close', function(){ var el=document.getElementById('card-zoom'); if(el)el.classList.remove('show'); flushQueue(); });
  bindClick('lo-close', function(){ var el=document.getElementById('log-overlay'); if(el)el.classList.remove('show'); flushQueue(); });
  bindClick('do-close', function(){ var el=document.getElementById('deck-overlay'); if(el)el.classList.remove('show'); flushQueue(); });
  bindClick('action-cancel', function(){ pendingCard=null; var el=document.getElementById('action-modal'); if(el)el.classList.remove('show'); flushQueue(); });
  bindClick('target-cancel', function(){ pendingCard=null; var el=document.getElementById('target-modal'); if(el)el.classList.remove('show'); flushQueue(); });
  bindClick('peek-close', function(){ var el=document.getElementById('peek-overlay'); if(el)el.classList.remove('show'); flushQueue(); });

  bindClick('log-strip', function(){
    if (!lastState) return;
    var list = document.getElementById('lo-list');
    if (!list) return;
    list.innerHTML = '';
    var logs = lastState.log || [];
    for (var i = logs.length - 1; i >= 0; i--) {
      var line = logs[i];
      var d = document.createElement('div');
      d.className = 'lo-entry' + (line.startsWith('—') ? ' lo-entry--round' : '');
      d.textContent = line;
      list.appendChild(d);
    }
    var lo = document.getElementById('log-overlay');
    if (lo) lo.classList.add('show');
  });

  bindClick('deck-btn', function(){
    var g = document.getElementById('do-grid');
    if (!g) return;
    g.innerHTML = '';
    for(var v = 0; v <= 9; v++){
      var d = CARDS[v];
      var r = document.createElement('div');
      r.className = 'do-row';
      r.innerHTML = '<div class="do-mini"><img src="assets/cards/' + v + '.png" onerror="this.style.display=\'none\'"></div><div class="do-info"><div class="do-name">' + d.name + '</div></div>';
      (function(cardDef){
        r.onclick = function(){
          var bx = document.getElementById('do-detail-box'), nm = document.getElementById('do-detail-name'), ds = document.getElementById('do-detail-desc');
          if (bx) bx.style.display = 'block';
          if (nm) nm.textContent = cardDef.name;
          if (ds) ds.textContent = cardDef.desc;
        };
      })(d);
      g.appendChild(r);
    }
    var ov = document.getElementById('deck-overlay');
    if (ov) ov.classList.add('show');
  });
});

// ─── СОКЕТЫ ───
var socket = null, currentLobby = null;
function connectSocket() {
  if (socket && socket.connected) return;
  socket = io({transports:['websocket','polling']});
  socket.on('connect', function(){ socket.emit('get_player_data', ME.id); });
  socket.on('player_data', function(d){
    var w = document.getElementById('stat-wins'), l = document.getElementById('stat-losses');
    if (w) w.textContent = d.wins || 0;
    if (l) l.textContent = d.losses || 0;
    mySelectedBack = d.selectedBack || 'back';
  });
  socket.on('back_updated', function(b){ mySelectedBack = b; renderBacks(); });
  socket.on('lobby_list', renderLobbyList);
  socket.on('lobby_joined', onLobbyJoined);
  socket.on('game_started', function(){ showScreen('game'); closeAllOverlays(); resetGameState(); });
  socket.on('vfx', function(data){
    if (busyAnimating || isOverlayOpen()) stateQueue.push({type:'vfx', payload:data});
    else handleVFX(data);
  });
  socket.on('new_round', function(){ closeAllOverlays(); });
  socket.on('state', function(s){ handleNewState(s); });
  socket.on('peek', function(d){ showPeek(d); });
  socket.on('chancellor_choice', function(d){ showChancellor(d.cards); });
  socket.on('rematch_pending', function(data){
    var g = document.getElementById('go-pending');
    if (g) g.textContent = data.count >= 1 ? 'Ждём…' : '';
  });
  socket.on('opponent_left', function(){
    showToast('Соперник ушёл');
    setTimeout(goToMenu, 1800);
  });
  socket.on('player_surrendered', function(data){
    var sText = document.getElementById('surrender-text');
    var sNot = document.getElementById('surrender-notice');
    if (sText) sText.textContent = "💀 " + data.name + " позорно слился!";
    if (sNot) { sNot.classList.add('show'); setTimeout(function(){ sNot.classList.remove('show'); }, 3000); }
  });
  socket.on('error_msg', function(msg){ showToast(msg); });
}

// ─── ЛОББИ ───
function renderLobbyList(list) {
  var el = document.getElementById('lb-list');
  if (!el) return;
  el.innerHTML = '';
  if (!list || !list.length) { el.innerHTML = '<div class="lb-empty">Нет открытых лобби.</div>'; return; }
  for(var i = 0; i < list.length; i++){
    var l = list[i];
    var card = document.createElement('div');
    card.className = 'lb-card';
    card.innerHTML = '<div class="lb-card-info"><div class="lb-card-name">' + esc(l.creatorName) + '</div><div class="lb-card-count">' + l.playerCount + '/' + l.maxPlayers + '</div></div>';
    var btn = document.createElement('button');
    btn.className = 'btn btn-secondary'; btn.innerHTML = '<span>Войти</span>';
    (function(lobbyId){
      btn.addEventListener('click', function(){ if(socket) socket.emit('join_lobby', {lobbyId: lobbyId, user: ME}); showScreen('lobby'); });
    })(l.id);
    card.appendChild(btn); el.appendChild(card);
  }
}

var createSlotCount = 2;
function renderCreateLobby() { createSlotCount = 2; updateCreateSlots(); }
function updateCreateSlots() {
  var el = document.getElementById('lc-slots');
  if (!el) return;
  el.innerHTML = '<div class="lc-slot lc-slot--you">Вы</div>';
  for (var i = 1; i < createSlotCount; i++) {
    var s = document.createElement('div');
    s.className = 'lc-slot lc-slot--added';
    s.innerHTML = '<span>Слот ' + (i+1) + '</span><div class="lc-remove">✕</div>';
    el.appendChild(s);
  }
  if (createSlotCount < 4) {
    var add = document.createElement('div');
    add.className = 'lc-slot lc-slot--empty'; add.textContent = '＋';
    add.addEventListener('click', function(){ if(createSlotCount < 4){ createSlotCount++; updateCreateSlots(); } });
    el.appendChild(add);
  }
  var btns = el.querySelectorAll('.lc-remove');
  for(var k=0; k<btns.length; k++){
    btns[k].addEventListener('click', function(e){ e.stopPropagation(); if(createSlotCount > 2){ createSlotCount--; updateCreateSlots(); } });
  }
}

function onLobbyJoined(lobby) {
  currentLobby = lobby;
  var rId = document.getElementById('lobby-room-id');
  if (rId) rId.textContent = lobby.id;
  var c = document.getElementById('lobby-players');
  if (c) {
    c.innerHTML = '';
    for(var i=0; i<lobby.maxPlayers; i++){
      var p = lobby.players[i];
      var el = document.createElement('div'); el.className = 'lobby-player';
      if(p) el.innerHTML = '<div class="lobby-player-avatar"' + (p.avatar ? ' style="background-image:url(\''+p.avatar+'\')"' : '') + '>' + (p.isBot?'🤖':'') + '</div><div class="lobby-player-name">' + esc(p.name) + '</div>';
      else { el.style.opacity = '.4'; el.innerHTML = '<div class="lobby-player-avatar" style="border-style:dashed">?</div>'; }
      c.appendChild(el);
    }
  }
  var actions = document.getElementById('lobby-actions'), wait = document.getElementById('lobby-wait');
  var amCreator = lobby.creatorId === ME.id;
  if(actions && wait) {
    if(amCreator){
      actions.style.display = 'flex'; wait.style.display = 'none';
      var sg = document.getElementById('btn-start-game');
      if (sg) sg.style.display = lobby.playerCount >= 2 ? 'flex' : 'none';
    } else {
      actions.style.display = 'none'; wait.style.display = 'flex';
    }
  }
}

function renderBacks(){
  var grid = document.getElementById('backs-grid');
  if (!grid) return;
  grid.innerHTML = '';
  for(var i=0; i<AVAILABLE_BACKS.length; i++){
    var b = AVAILABLE_BACKS[i];
    var opt = document.createElement('div');
    opt.className = 'back-option' + (b.id === mySelectedBack ? ' selected' : '');
    opt.innerHTML = '<img src="assets/backs/' + b.id + '.png" onerror="this.src=\'assets/cards/back.png\'"/><div class="back-option-name">' + b.name + '</div>';
    (function(backId){
      opt.addEventListener('click', function(){
        if(socket) socket.emit('set_back', {userId: ME.id, backName: backId});
        mySelectedBack = backId; renderBacks();
      });
    })(b.id);
    grid.appendChild(opt);
  }
}

// ─── ОБУЧЕНИЕ ───
var TUTORIAL_STEPS = [
  {text:'Добро пожаловать в Тёмную Дуэль! Это карточная игра на логику, блеф и дедукцию.', show:[]},
  {text:'В колоде 21 карта с номиналами от 0 до 9. В начале раунда каждому игроку сдаётся по 1 карте. Ещё 1 откладывается втёмную.', show:[{v:1},{v:2},{v:3}]},
  {text:'На своём ходу ты берёшь 1 карту (автоматически). Теперь у тебя 2 карты — выбери одну и сыграй её.', highlight:'arrow', show:[{v:1, glow:true},{v:6}]},
  {text:'Тапни по карте, чтобы узнать, что она делает. Стрелка сверху — это кнопка «Сыграть».', show:[{v:1, highlight:'arrow'}]},
  {text:'Карта 1 — Детектив. Назови номинал карты соперника. Угадал? Соперник выбывает!', show:[{v:1, glow:true}]},
  {text:'Карта 3 — Громила. Сравниваете карты с соперником. У кого номинал ниже — тот выбывает.', show:[{v:3, glow:true}, {v:'back'}]},
  {text:'Карта 4 — Продажный коп. Защищает тебя до следующего хода.', show:[{v:4, glow:true}]},
  {text:'Карта 9 — Компромат. НО: если ты её сбросишь или тебя заставят — ты проигрываешь раунд!', show:[{v:9, glow:true, danger:true}]},
  {text:'Карта 8 — Роковая женщина. Если у тебя на руке одновременно 8 и (5 или 7) — обязан сыграть восьмёрку.', show:[{v:8, glow:true}, {v:5}]},
  {text:'Раунд заканчивается когда: все кроме одного выбыли, или кончилась колода.', show:[{v:2}, {v:7}]},
  {text:'Счётчик «Видено X/Y» показывает сколько карт этого типа ты уже видел. Используй для дедукции!', show:[{v:1, badge:'2/6'}]},
  {text:'Ты готов! Жми «Играть» в меню, создай лобби, добавь бота или друга. Удачи! 🎴', show:[]}
];

var tutStep = 0;
function startTutorial() { tutStep = 0; showScreen('tutorial'); renderTutStep(); }
function renderTutStep() {
  if (tutStep >= TUTORIAL_STEPS.length) { showScreen('menu'); return; }
  var step = TUTORIAL_STEPS[tutStep];
  var tText = document.getElementById('tut-text'); if(tText) tText.textContent = step.text;
  var area = document.getElementById('tut-game-area'); if(!area) return; area.innerHTML = '';

  if (step.show && step.show.length > 0) {
    var row = document.createElement('div'); row.className = 'tut-cards';
    for(var i=0; i<step.show.length; i++){
      var c = step.show[i];
      var wrap = document.createElement('div'); wrap.className = 'play-arrow-wrap';
      var card = makeCard(c.v==='back' ? null : {value:c.v}, c.v!=='back', 'card--big', mySelectedBack);
      if (c.glow) { card.classList.add('my-turn-glow'); card.style.transform = 'scale(1.1)'; triggerVibe('light'); }
      if (c.danger) { card.style.boxShadow = '0 0 20px var(--red)'; }
      if (c.badge) { var b = document.createElement('div'); b.className = 'card-seen-badge'; b.textContent = c.badge; card.appendChild(b); }
      if (c.highlight === 'arrow' || step.highlight === 'arrow') {
        var arrow = document.createElement('div'); arrow.className = 'play-arrow tut-highlight'; wrap.appendChild(arrow);
      }
      wrap.appendChild(card); row.appendChild(wrap);
    }
    area.appendChild(row);
  }
}

// ─── ИГРОВОЙ ЦИКЛ ───
var lastState=null, stateQueue=[], busyAnimating=false, prevOppDiscardLen=0, activeRevealCard=null;
function isOverlayOpen() { return document.querySelectorAll('.overlay.show:not(#round-over):not(#game-over):not(#surrender-notice)').length > 0; }
function flushQueue() {
  if (stateQueue.length > 0 && !busyAnimating && !isOverlayOpen()) {
    var next = stateQueue.shift();
    if (next.type === 'state') processState(next.payload);
    else if (next.type === 'vfx') handleVFX(next.payload);
  }
}
function resetGameState() {
  lastState = null; stateQueue = []; busyAnimating = false; prevOppDiscardLen = 0; activeRevealCard = null;
  var vl = document.getElementById('vfx-layer'); if (vl) vl.innerHTML = '';
}
function handleNewState(s) {
  if (busyAnimating || isOverlayOpen()) { stateQueue.push({type:'state', payload:s}); return; }
  processState(s);
}
function processState(s) {
  var isFirst = !lastState;
  var mainOpp = (s.opponents && s.opponents.length > 0) ? s.opponents[0] : null;
  var oppDiscardLen = (mainOpp && mainOpp.discard) ? mainOpp.discard.length : 0;
  var oppPlayed = !isFirst && mainOpp && oppDiscardLen > prevOppDiscardLen;

  if (oppPlayed) {
    var playedCard = mainOpp.discard[mainOpp.discard.length - 1];
    busyAnimating = true;
    updateLogStrip(s.log);
    animateOppRevealPart1(playedCard, mainOpp.back || 'back', function(){
      var vfxIdx = -1;
      for(var i=0; i<stateQueue.length; i++){ if(stateQueue[i].type === 'vfx') { vfxIdx = i; break; } }
      if (vfxIdx >= 0) {
        var vfx = stateQueue.splice(vfxIdx, 1)[0];
        handleVFX(vfx.payload, function(){ animateOppRevealPart2(function(){ finishProcess(s); }); });
      } else {
        setTimeout(function(){ animateOppRevealPart2(function(){ finishProcess(s); }); }, 1200);
      }
    });
  } else {
    if (lastState && lastState.me && !lastState.me.eliminated && s.me && s.me.eliminated) shakeScreen();
    finishProcess(s);
  }
}
function finishProcess(s) {
  lastState = s;
  prevOppDiscardLen = (s.opponents && s.opponents[0] && s.opponents[0].discard) ? s.opponents[0].discard.length : 0;
  renderState(s);
  busyAnimating = false;
  flushQueue();
}

// ─── АНИМАЦИИ И VFX ───
function animateOppRevealPart1(playedCard, backName, cb) {
  var layer = document.getElementById('vfx-layer');
  if (!layer) return cb();
  layer.innerHTML = '';
  var ex = document.createElement('div');
  ex.className = 'card card--big';
  ex.innerHTML = '<div class="card-back"><img src="assets/backs/' + backName + '.png" onerror="this.src=\'assets/cards/back.png\'"></div><div class="card-face"><img src="assets/cards/' + playedCard.value + '.png"></div>';
  ex.style.cssText = 'position:absolute;top:-10%;transform:scale(0.5);transition:all 0.8s cubic-bezier(0.25,1,0.5,1)';
  layer.appendChild(ex);
  void ex.offsetWidth;
  ex.style.top = '50%';
  ex.style.transform = 'translateY(-50%) scale(2.2)';
  playSound('card');
  setTimeout(function(){
    ex.classList.add('face-up');
    playSound('card');
    activeRevealCard = ex;
    setTimeout(cb, 600);
  }, 800);
}
function animateOppRevealPart2(cb) {
  if (!activeRevealCard) return cb();
  activeRevealCard.style.top = '120%';
  activeRevealCard.style.transform = 'translate(-35vw,0) scale(0.4) rotate(-25deg)';
  activeRevealCard.style.opacity = '0';
  setTimeout(function(){
    if (activeRevealCard && activeRevealCard.parentNode) activeRevealCard.parentNode.removeChild(activeRevealCard);
    activeRevealCard = null;
    cb();
  }, 800);
}
function handleVFX(data, callback) {
  if (!callback) callback = function(){};
  var isDirect = !busyAnimating;
  if (isDirect) busyAnimating = true;
  var layer = document.getElementById('vfx-layer');
  if (!layer) return callback();
  var dur = 2000;

  if (data.type === 'baron') {
    var c1 = document.createElement('div'); c1.className = 'vfx-card vfx-clash-left'; c1.innerHTML = '<img src="assets/cards/' + data.p1Card + '.png">';
    var c2 = document.createElement('div'); c2.className = 'vfx-card vfx-clash-right'; c2.innerHTML = '<img src="assets/cards/' + data.p2Card + '.png">';
    layer.appendChild(c1); layer.appendChild(c2);
    setTimeout(function(){
      if(data.winnerId === data.p1Id) c2.classList.add('vfx-clash-loser');
      else if(data.winnerId === data.p2Id) c1.classList.add('vfx-clash-loser');
    }, 1000);
    dur = 2500;
  }
  else if (data.type === 'detective') {
    var g = document.createElement('div'); g.className = 'vfx-detective-group'; g.style.top = '45%';
    var cardName = CARDS[data.guess] ? CARDS[data.guess].name : 'Карту';
    g.innerHTML = '<div class="vfx-detective-text">Проверяет: ' + cardName + '</div>';
    layer.appendChild(g);
    if (data.hit) {
      setTimeout(function(){
        var res = document.createElement('div'); res.className = 'vfx-result-text hit'; res.textContent = '✓ УСПЕХ!';
        g.appendChild(res); playSound('success');
      }, 1200);
      dur = 3500;
    } else {
      setTimeout(function(){
        var res = document.createElement('div'); res.className = 'vfx-result-text miss'; res.textContent = '✗ НЕУДАЧА';
        g.appendChild(res);
      }, 1200);
      dur = 3000;
    }
  }
  
  setTimeout(function(){
    var children = Array.prototype.slice.call(layer.children);
    for(var i=0; i<children.length; i++) {
      if (children[i] !== activeRevealCard) layer.removeChild(children[i]);
    }
    if (isDirect) { busyAnimating = false; flushQueue(); }
    callback();
  }, dur);
}

// ─── РЕНДЕР СТОЛА ───
function renderState(s) {
  var mN = document.getElementById('me-name'), mS = document.getElementById('me-status'), mA = document.getElementById('me-avatar'), dC = document.getElementById('deck-count-badge');
  if (mN) mN.textContent = (s.me && s.me.name) ? s.me.name : 'Вы';
  if (mS) mS.textContent = s.isMyTurn ? 'твой ход' : ((s.me && s.me.protected) ? 'под защитой' : '');
  if (s.me && s.me.avatar && mA) mA.style.backgroundImage = 'url("' + s.me.avatar + '")';
  renderTokens('me-tokens', (s.me && s.me.tokens) ? s.me.tokens : 0);
  
  renderOpponents(s); 
  renderMyCards(s); 
  renderExcluded(s.excludedCards || []); 
  renderDiscard('me-discard', (s.me && s.me.discard) ? s.me.discard : []);
  
  if (dC) dC.textContent = s.deckCount || 0; 
  updateLogStrip(s.log);
  
  if (s.gameOver) showGameOver(s.gameOver); 
  else if (s.roundOver) showRoundOver(s.roundOver);
}

function renderOpponents(s) {
  var zone = document.getElementById('g-opponents'); if (!zone) return; zone.innerHTML = '';
  var opps = s.opponents || []; zone.className = 'g-opponents opp-count-' + opps.length;
  for(var i=0; i<opps.length; i++){
    var opp = opps[i];
    var col = document.createElement('div'); col.className = 'g-opp-col';
    col.innerHTML = '<div class="g-player-bar"><div class="g-av-wrap"><div class="g-avatar"' + (opp.avatar ? ' style="background-image:url(\''+opp.avatar+'\')"' : '') + '></div><div><div class="g-name">' + esc(opp.name) + '</div><div class="g-status">' + (opp.isTurn ? 'ходит' : (opp.protected ? 'защита' : '')) + '</div></div></div><div class="g-tokens" id="opp-tok-' + opp.userId + '"></div></div><div class="g-card-center"></div>';
    if (opp.handCount > 0) {
      var card = makeCard(null, false, 'card--opp', opp.back);
      if (opp.isTurn) card.classList.add('opp-turn-glow');
      col.querySelector('.g-card-center').appendChild(card);
    }
    zone.appendChild(col);
    (function(o){ setTimeout(function(){ renderTokens('opp-tok-'+o.userId, o.tokens||0); }, 0); })(opp);
  }
}

function renderMyCards(s) {
  var zone = document.getElementById('my-card-zone'); if (!zone) return; zone.innerHTML = '';
  if (!s.me || !s.me.hand || s.me.hand.length === 0) return;
  var hand = s.me.hand;
  for(var i=0; i<hand.length; i++){
    var c = hand[i];
    var wrap = document.createElement('div'); wrap.className = 'play-arrow-wrap';
    var cardEl = makeCard(c, true, 'card--big', s.me.back);
    if (s.isMyTurn) cardEl.classList.add('my-turn-glow');
    
    var seenCount = (s.me.seenCounts && s.me.seenCounts[c.value]) ? s.me.seenCounts[c.value] : 0;
    var totalCount = CARDS[c.value] ? CARDS[c.value].total : 0;
    
    var badge = document.createElement('div'); badge.className = 'card-seen-badge'; badge.textContent = seenCount + '/' + totalCount;
    cardEl.appendChild(badge);
    
    (function(cardObj){ cardEl.onclick = function(){ openZoom(cardObj); }; })(c);
    
    if (s.isMyTurn) {
      var arrow = document.createElement('div'); arrow.className = 'play-arrow';
      (function(cardObj, elObj){
        arrow.onclick = function(e){ e.stopPropagation(); onPlay(cardObj, elObj, s); };
      })(c, cardEl);
      wrap.appendChild(arrow);
    }
    wrap.appendChild(cardEl); zone.appendChild(wrap);
  }
}

function makeCard(card, faceUp, sizeClass, backName) {
  var el = document.createElement('div'); el.className = 'card ' + (sizeClass || 'card--big') + (faceUp ? ' face-up' : '');
  el.innerHTML = '<div class="card-back"><img src="assets/backs/' + (backName || 'back') + '.png" onerror="this.src=\'assets/cards/back.png\'"></div><div class="card-face">' + (card ? '<img src="assets/cards/' + card.value + '.png">' : '') + '</div>';
  return el;
}

function updateLogStrip(log) {
  var l = (log || []).filter(function(line){ return line && !line.startsWith('—'); });
  var l1 = document.getElementById('log-line-1'), l2 = document.getElementById('log-line-2');
  if (l1) l1.textContent = l[l.length - 1] || '—';
  if (l2) l2.textContent = l[l.length - 2] || '';
}

function renderDiscard(id, cards) {
  var el = document.getElementById(id); if (!el) return; el.innerHTML = '';
  var slice = cards.slice(-7);
  for(var i=0; i<slice.length; i++){
    var c = slice[i];
    var card = makeCard(c, true, 'card--sm', mySelectedBack);
    (function(cardObj){ card.onclick = function(){ openZoom(cardObj); }; })(c);
    el.appendChild(card);
  }
}

function renderExcluded(cards) {
  var el = document.getElementById('excluded-cards'); if (!el) return; el.innerHTML = '';
  for(var i=0; i<cards.length; i++){
    var c = cards[i];
    var card = makeCard(c, true, 'card--exc', mySelectedBack);
    (function(cardObj){ card.onclick = function(){ openZoom(cardObj); }; })(c);
    el.appendChild(card);
  }
}

function renderTokens(id, count) {
  var el = document.getElementById(id); if (!el) return;
  var max = (lastState && lastState.winTokens) ? lastState.winTokens : 6;
  var h = '';
  for (var i = 0; i < max; i++) {
    h += '<span class="token ' + (i < count ? 'earned' : 'empty') + '">◆</span>';
  }
  el.innerHTML = h;
}

// ─── ДЕЙСТВИЯ ───
function onPlay(card, cardEl, s) {
  if (!s || !s.isMyTurn) return;
  if (s.me && s.me.mustPlayCountess && card.value !== 8) { showToast('Роковая женщина! Обязан сыграть карту 8.'); return; }
  
  var opps = [];
  if (s.opponents) {
    for(var i=0; i<s.opponents.length; i++){
      if (!s.opponents[i].eliminated && !s.opponents[i].protected) opps.push(s.opponents[i]);
    }
  }

  if (card.value === 1) {
    if (opps.length > 1) openTargetThenGuess(card, opps);
    else openGuessModal(card, opps[0] ? opps[0].userId : null);
  }
  else if (card.value === 5) openFederalModal(card, s);
  else if ((card.value === 2 || card.value === 3 || card.value === 7) && opps.length > 1) openTargetModal(card, opps, 'Выбери цель');
  else {
    var tid = opps[0] ? opps[0].userId : null;
    cardEl.classList.add('my-playing'); playSound('card');
    setTimeout(function(){ if(socket) socket.emit('play', {cardId: card.id, targetUserId: tid}); }, 600);
  }
}

function openGuessModal(card, targetUserId) {
  var el = document.getElementById('action-modal'), g = document.getElementById('action-options');
  if (!el || !g) return;
  g.innerHTML = '';
  for (var v = 0; v <= 9; v++) {
    if (v === 1) continue;
    var o = document.createElement('div'); o.className = 'am-opt';
    var seenCount = (lastState && lastState.me && lastState.me.seenCounts && lastState.me.seenCounts[v]) ? lastState.me.seenCounts[v] : 0;
    var totalCount = CARDS[v] ? CARDS[v].total : 0;
    o.innerHTML = '<div class="card-seen-badge" style="top:-5px;right:-5px">' + seenCount + '/' + totalCount + '</div><span class="num">' + v + '</span>' + (CARDS[v] ? CARDS[v].name : '');
    (function(guessVal){
      o.onclick = function(){ el.classList.remove('show'); if(socket) socket.emit('play', {cardId: card.id, guess: guessVal, targetUserId: targetUserId}); };
    })(v);
    g.appendChild(o);
  }
  el.classList.add('show');
}

function openFederalModal(card, s) {
  var el = document.getElementById('target-modal'), o = document.getElementById('target-options');
  if (!el || !o) return;
  o.innerHTML = '';
  var selfOpt = document.createElement('div'); selfOpt.className = 'am-opt'; selfOpt.innerHTML = '<span class="num">★</span>Вы';
  selfOpt.onclick = function(){ el.classList.remove('show'); if(socket) socket.emit('play', {cardId: card.id, targetUserId: 'self'}); };
  o.appendChild(selfOpt);
  
  var opps = s.opponents || [];
  for(var i=0; i<opps.length; i++) {
    var op = opps[i];
    if (op.eliminated) continue;
    var d = document.createElement('div'); d.className = 'am-opt';
    if (op.protected) d.style.opacity = '.4';
    d.innerHTML = '<span class="num">★</span>' + esc(op.name);
    (function(targetOp){
      d.onclick = function(){ if(!targetOp.protected){ el.classList.remove('show'); if(socket) socket.emit('play', {cardId: card.id, targetUserId: targetOp.userId}); } };
    })(op);
    o.appendChild(d);
  }
  el.classList.add('show');
}

function openTargetThenGuess(card, opps) {
  var el = document.getElementById('target-modal'), o = document.getElementById('target-options');
  if (!el || !o) return;
  o.innerHTML = '';
  var tt = document.getElementById('target-title'); if(tt) tt.textContent = 'Кого проверить?';
  for(var i=0; i<opps.length; i++){
    var op = opps[i];
    var d = document.createElement('div'); d.className = 'am-opt'; d.innerHTML = '<span class="num">🔍</span>' + esc(op.name);
    (function(targetOp){
      d.onclick = function(){ el.classList.remove('show'); openGuessModal(card, targetOp.userId); };
    })(op);
    o.appendChild(d);
  }
  el.classList.add('show');
}

function openTargetModal(card, opps, title) {
  var el = document.getElementById('target-modal'), o = document.getElementById('target-options');
  if (!el || !o) return;
  o.innerHTML = '';
  var tt = document.getElementById('target-title'); if(tt) tt.textContent = title || 'Выбери цель';
  for(var i=0; i<opps.length; i++){
    var op = opps[i];
    var d = document.createElement('div'); d.className = 'am-opt'; d.innerHTML = '<span class="num">★</span>' + esc(op.name);
    (function(targetOp){
      d.onclick = function(){ el.classList.remove('show'); if(socket) socket.emit('play', {cardId: card.id, targetUserId: targetOp.userId}); };
    })(op);
    o.appendChild(d);
  }
  el.classList.add('show');
}

function showChancellor(cards) {
  var el = document.getElementById('chancellor-modal'), w = document.getElementById('chancellor-cards');
  if (!el || !w) return;
  w.innerHTML = '';
  for(var i=0; i<cards.length; i++) {
    var c = cards[i];
    var o = document.createElement('div'); o.className = 'chancellor-option';
    o.innerHTML = '<div class="card card--big face-up"><div class="card-face"><img src="assets/cards/' + c.value + '.png"></div></div><div class="chancellor-choose-label">ВЫБРАТЬ</div>';
    (function(cardObj){
      o.onclick = function(){ if(socket) socket.emit('chancellor_pick', cardObj.id); el.classList.remove('show'); };
    })(c);
    w.appendChild(o);
  }
  el.classList.add('show');
}

function openZoom(card) {
  if (!card) return;
  var def = CARDS[card.value];
  var w = document.getElementById('cz-card-img');
  if (!w || !def) return;
  w.innerHTML = '<img src="assets/cards/' + card.value + '.png">';
  var nm = document.getElementById('cz-name'), ds = document.getElementById('cz-desc'), sn = document.getElementById('cz-seen');
  if (nm) nm.textContent = def.name;
  if (ds) ds.textContent = def.desc;
  if (sn) {
    var seenCount = (lastState && lastState.me && lastState.me.seenCounts && lastState.me.seenCounts[card.value]) ? lastState.me.seenCounts[card.value] : 0;
    sn.textContent = 'Видено: ' + seenCount + '/' + def.total;
  }
  var el = document.getElementById('card-zoom'); if(el) el.classList.add('show');
}

function showPeek(data) {
  var w = document.getElementById('peek-card');
  if (!w) return;
  w.innerHTML = '';
  if (data.card) w.appendChild(makeCard(data.card, true, 'card--big', mySelectedBack));
  var pN = document.getElementById('peek-card-name'); if(pN) pN.textContent = data.cardName;
  var pO = document.getElementById('peek-overlay'); if(pO) pO.classList.add('show');
}

function showRoundOver(ro) {
  var ov = document.getElementById('round-over');
  if (!ov) return;
  var iW = ro.winnerId === ME.id;
  var rT = document.getElementById('ro-title'), rR = document.getElementById('ro-reason');
  if (rT) rT.textContent = iW ? '✦ ПОБЕДА!' : '✗ ПОРАЖЕНИЕ';
  if (rR) rR.textContent = ro.reason || '';
  if (!iW) shakeScreen(); else playSound('success');
  ov.classList.add('show');
  setTimeout(function(){ ov.classList.remove('show'); }, 4000);
}

function showGameOver(go) {
  var ov = document.getElementById('game-over');
  if (!ov) return;
  var gR = document.getElementById('go-reason'), gT = document.getElementById('go-tokens-row');
  if (gR) gR.textContent = go.reason || '';
  if (gT) {
    var arr = [];
    for(var i=0; i<(go.scores||[]).length; i++){
      arr.push('<span>' + esc(go.scores[i].name) + ': <strong>' + go.scores[i].tokens + '</strong></span>');
    }
    gT.innerHTML = arr.join(' | ');
  }
  ov.classList.add('show');
}

function goToMenu() { window.location.reload(); }
function closeAllOverlays() {
  var els = document.querySelectorAll('.overlay');
  for(var i=0; i<els.length; i++) els[i].classList.remove('show');
}
function showToast(msg) {
  var t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function(){ t.classList.remove('show'); }, 2500);
}
function esc(s) {
  return String(s||'').replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
