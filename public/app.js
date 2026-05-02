// =====================================================================
// Тёмная Дуэль — Frontend v3.3
// =====================================================================
const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor?.('#08050f'); tg.setBackgroundColor?.('#08050f'); }

const tgUser = tg?.initDataUnsafe?.user;
const ME = {
  id:     tgUser ? `tg_${tgUser.id}` : `g_${Math.random().toString(36).slice(2,9)}`,
  name:   tgUser ? [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') : 'Гость',
  avatar: tgUser?.photo_url || null,
};

const CARDS = {
  0: { name:'Информатор',      total:2, desc:'Ничего не делает при розыгрыше. Если в конце раунда ты единственный выживший с сыгранным Информатором — +1 жетон.' },
  1: { name:'Детектив',        total:6, desc:'Назови карту (не Детектив). Если у соперника она — он выбывает.' },
  2: { name:'Журналист',       total:2, desc:'Тайно посмотри карту в руке соперника.' },
  3: { name:'Громила',         total:2, desc:'Сравните карты тайно. У кого номинал ниже — выбывает. При ничьей никто не выбывает.' },
  4: { name:'Продажный коп',   total:2, desc:'До начала своего следующего хода ты под защитой — чужие карты на тебя не действуют.' },
  5: { name:'Федерал',         total:2, desc:'Выбери игрока (себя или соперника). Он сбрасывает карту и берёт новую. Если сброшен Компромат — он выбывает.' },
  6: { name:'Теневой брокер',  total:2, desc:'Возьми 2 карты из колоды. Оставь 1 из трёх себе, остальные верни вниз колоды.' },
  7: { name:'Босс мафии',      total:1, desc:'Поменяйся картами с соперником.' },
  8: { name:'Роковая женщина', total:1, desc:'Нет эффекта. Но: если в руке есть Федерал (5) или Босс мафии (7) — обязан сыграть Роковую женщину.' },
  9: { name:'Компромат',       total:1, desc:'Если сброшен по любой причине — ты немедленно выбываешь из раунда.' },
};

// ─── ЗВУК ───
const bgm = document.getElementById('bgm');
bgm.volume = 0.38;
let musicStarted = false;
function startMusic() {
  if (musicStarted) return;
  musicStarted = true;
  bgm.play().catch(() => { musicStarted = false; });
}
let audioCtx = null;
function playClick() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.type='triangle';
    o.frequency.setValueAtTime(800,now); o.frequency.exponentialRampToValueAtTime(380,now+.07);
    g.gain.setValueAtTime(.13,now); g.gain.exponentialRampToValueAtTime(.001,now+.09);
    o.start(now); o.stop(now+.1);
  } catch(e){}
}
function playCardSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.type='sine';
    o.frequency.setValueAtTime(300,now); o.frequency.exponentialRampToValueAtTime(160,now+.16);
    g.gain.setValueAtTime(.16,now); g.gain.exponentialRampToValueAtTime(.001,now+.19);
    o.start(now); o.stop(now+.2);
  } catch(e){}
}
document.body.addEventListener('click', e => {
  if (e.target.closest('.btn,.am-opt,.g-deck-btn,.g-log-strip,.play-arrow,.chancellor-option,#intro')) playClick();
}, true);

// ─── ЭКРАНЫ ───
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id===id));
}

// ─── ЗАСТАВКА ───
let introStep = 0;
const introLayers = document.querySelectorAll('.intro-layer');
const introHint   = document.querySelector('.intro-hint');
function advanceIntro() {
  startMusic();
  if (introStep < introLayers.length) {
    introLayers[introStep].classList.add('show');
    introStep++;
    if (introStep === introLayers.length) introHint.textContent = 'тапни, чтобы войти';
  } else {
    document.getElementById('intro').removeEventListener('click', advanceIntro);
    setTimeout(() => showScreen('menu'), 220);
  }
}
window.addEventListener('load', () => {
  advanceIntro();
  document.getElementById('intro').addEventListener('click', advanceIntro);
  const sp = tg?.initDataUnsafe?.start_param;
  if (sp) {
    document.getElementById('intro').classList.remove('active');
    showScreen('menu');
    enterGame(sp, false);
  }
});

// ─── SOCKET ───
let socket = null, currentRoomId = null;
function connectSocket() {
  if (socket?.connected) return;
  socket = io({ transports:['websocket','polling'] });
  socket.on('connect', () => console.log('✓ socket', socket.id));
  socket.on('lobby', d => {
    currentRoomId = d.roomId;
    document.getElementById('lobby-room-id').textContent = d.roomId;
    renderLobbyPlayers(d.players);
  });
  socket.on('start',     () => { showScreen('game'); closeAllOverlays(); resetState(); });
  socket.on('new_round', () => { closeAllOverlays(); stopRoundTimer(); });
  socket.on('state',     s  => handleNewState(s));
  socket.on('peek',      d  => showPeek(d));
  socket.on('chancellor_choice', d => showChancellor(d.cards));
  socket.on('rematch_pending', ({count}) => { document.getElementById('go-pending').textContent = count===1?'Ждём соперника…':''; });
  socket.on('opponent_left', () => { showToast('Соперник покинул игру'); setTimeout(leaveToMenu, 1800); });
  socket.on('error_msg', msg => showToast(msg));
}

// ─── МЕНЮ ───
document.getElementById('btn-invite').addEventListener('click', () => enterGame(genRoomId(), true));
document.getElementById('btn-quick').addEventListener('click', () => enterGame('q'+Math.floor(Date.now()/30000), false));
function genRoomId() { return 'r'+Math.random().toString(36).slice(2,8); }
function enterGame(roomId, isInvite) {
  connectSocket(); currentRoomId = roomId;
  socket.emit('join', { roomId, user:{ id:ME.id, name:ME.name, avatar:ME.avatar } });
  showScreen('lobby');
  document.getElementById('lobby-room-id').textContent = roomId;
  if (isInvite) setTimeout(() => shareInvite(roomId), 300);
}
function shareInvite(roomId) {
  const BOT='YourBotName', APP='play';
  const link=`https://t.me/${BOT}/${APP}?startapp=${roomId}`;
  if (tg?.openTelegramLink) tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Дуэль! Комната '+roomId)}`);
  else { navigator.clipboard?.writeText(link); showToast('Ссылка скопирована'); }
}
document.getElementById('lobby-share').addEventListener('click', () => { if(currentRoomId) shareInvite(currentRoomId); });
document.getElementById('lobby-cancel').addEventListener('click', leaveToMenu);
function renderLobbyPlayers(players) {
  const c = document.getElementById('lobby-players'); c.innerHTML='';
  for (let i=0;i<2;i++) {
    const p=players[i], el=document.createElement('div'); el.className='lobby-player';
    if (p) el.innerHTML=`<div class="lobby-player-avatar"${p.avatar?` style="background-image:url('${p.avatar}')"`:''}></div><div class="lobby-player-name">${esc(p.name)}</div>`;
    else { el.style.opacity='.4'; el.innerHTML='<div class="lobby-player-avatar" style="border-style:dashed"></div><div class="lobby-player-name">ожидание</div>'; }
    c.appendChild(el);
  }
}

// ─── СОСТОЯНИЕ ───
let lastState = null;
let pendingCard = null;
let pendingCardElement = null;  // ссылка на DOM-элемент моей выбранной карты
let roundTimerInterval = null;
let prevOppDiscardLen = 0;
let prevOppHandCount  = 0;

// Очередь состояний — если анимация идёт, ставим в очередь
let stateQueue = [];
let busyAnimating = false;

function resetState() {
  lastState = null; pendingCard = null; pendingCardElement = null;
  prevOppDiscardLen = 0; prevOppHandCount = 0;
  stateQueue = []; busyAnimating = false;
  stopRoundTimer();
}

// ═══════════════════════════════════════════════════════════════════
// ОБРАБОТКА СОСТОЯНИЯ
// Если идёт анимация — кладём в очередь, чтобы не сбить визуал.
// ═══════════════════════════════════════════════════════════════════
function handleNewState(s) {
  if (busyAnimating) {
    stateQueue.push(s);
    return;
  }
  processState(s);
}

function processState(s) {
  const isFirst = !lastState;

  // Соперник сыграл карту — его сброс вырос
  const oppPlayed = !isFirst
    && s.opponent && lastState.opponent
    && (s.opponent.discard.length > prevOppDiscardLen);

  if (oppPlayed) {
    // Берём последнюю карту из сброса соперника — это та, что он только что сыграл
    const playedCard = s.opponent.discard[s.opponent.discard.length - 1];
    busyAnimating = true;
    // Обновляем лог сразу — пусть игрок видит текст пока идёт анимация
    updateLogStrip(s.log);
    animateOppRevealAndPlay(playedCard, () => {
      lastState = s;
      prevOppDiscardLen = s.opponent?.discard?.length || 0;
      prevOppHandCount  = s.opponent?.handCount || 0;
      renderState(s, false, true /* oppJustPlayed */);
      busyAnimating = false;
      // Если в очереди есть состояние — обрабатываем
      if (stateQueue.length > 0) {
        const next = stateQueue.shift();
        setTimeout(() => processState(next), 50);
      }
    });
  } else {
    const oppDrewCard = !isFirst && s.opponent && lastState.opponent
      && s.opponent.handCount > prevOppHandCount;

    lastState = s;
    prevOppDiscardLen = s.opponent?.discard?.length || 0;
    prevOppHandCount  = s.opponent?.handCount || 0;
    renderState(s, isFirst, false);

    if (oppDrewCard) playCardSound();
  }
}

// ───────────────────────────────────────────────────────────────────
// АНИМАЦИЯ ХОДА СОПЕРНИКА
// 1) Карта зумится ко мне (увеличивается + смещается вниз к экрану)
// 2) В середине зума — кросс-фейд через .face-up класс показывает,
//    что соперник сыграл (рубашка → лицо)
// 3) Карта улетает в сброс
// 4) После завершения вызываем callback (рендер нового состояния)
// ───────────────────────────────────────────────────────────────────
function animateOppRevealAndPlay(playedCard, callback) {
  const zone = document.getElementById('opp-card-zone');
  const existing = zone.querySelector('.card');

  // Если по каким-то причинам элемента нет — просто рендерим
  if (!existing || !playedCard) {
    if (existing) zone.innerHTML = '';
    callback();
    return;
  }

  // Убираем свечение чтобы не мешало анимации
  existing.classList.remove('opp-turn-glow');

  // Подставляем картинку сыгранной карты на лицевую сторону
  const face = existing.querySelector('.card-face');
  face.innerHTML = '';
  const img = document.createElement('img');
  img.src = `assets/cards/${playedCard.value}.png`;
  img.onerror = () => { img.style.display = 'none'; };
  img.alt = '';
  face.appendChild(img);

  // Фаза 1: зум к экрану (650мс)
  existing.classList.add('opp-zoom');

  // Фаза 2: на середине зума — переворот через face-up (плавный кросс-фейд 350мс)
  setTimeout(() => {
    existing.classList.add('face-up');
    playCardSound();
  }, 280);

  // Фаза 3: после зума — улёт в сброс (550мс)
  setTimeout(() => {
    existing.classList.remove('opp-zoom');
    existing.classList.add('opp-fly');
  }, 700);

  // Фаза 4: завершение, очищаем зону и рендерим новое состояние
  setTimeout(() => {
    zone.innerHTML = '';
    callback();
  }, 1250);
}

// ───────────────────────────────────────────────────────────────────
// АНИМАЦИЯ МОЕГО ХОДА
// Карта подлетает (зум вверх) → улетает в сброс
// Эмитим play на сервер ПОСЛЕ окончания анимации
// ───────────────────────────────────────────────────────────────────
function animateMyPlayAndEmit(card, cardElement, extraData = {}) {
  if (!cardElement || !cardElement.parentElement) {
    socket.emit('play', { cardId: card.id, ...extraData });
    return;
  }

  busyAnimating = true;
  // Снимаем свечение чтобы не мешало
  cardElement.classList.remove('my-turn-glow');
  cardElement.classList.add('my-playing');

  setTimeout(() => {
    socket.emit('play', { cardId: card.id, ...extraData });
    // Через короткое время разрешаем рендер новых состояний
    setTimeout(() => { busyAnimating = false; flushStateQueue(); }, 200);
  }, 600); // ждём пока анимация закончится
}

function flushStateQueue() {
  if (stateQueue.length > 0 && !busyAnimating) {
    const next = stateQueue.shift();
    processState(next);
  }
}

// ═══════════════════════════════════════
// РЕНДЕР
// ═══════════════════════════════════════
function renderState(s, isFirst, oppJustPlayed) {
  // Имена / статусы
  document.getElementById('me-name').textContent  = s.me?.name  || 'Вы';
  document.getElementById('opp-name').textContent = s.opponent?.name || 'Соперник';
  document.getElementById('me-status').textContent  = s.isMyTurn   ? 'твой ход' : (s.me?.protected       ? 'под защитой' : '');
  document.getElementById('opp-status').textContent = !s.isMyTurn  ? 'ходит'    : (s.opponent?.protected ? 'под защитой' : '');

  // Аватары
  const setAv = (id,url) => { if(url) document.getElementById(id).style.backgroundImage=`url('${url}')`; };
  setAv('me-avatar',  s.me?.avatar);
  setAv('opp-avatar', s.opponent?.avatar);

  // Жетоны
  renderTokens('me-tokens',  s.me?.tokens  || 0);
  renderTokens('opp-tokens', s.opponent?.tokens || 0);

  // Карты
  renderOppCard(s, isFirst, oppJustPlayed);
  renderMyCards(s, isFirst);

  // Исключённые
  renderExcluded(s.excludedCards || []);

  // Сбросы
  renderDiscard('me-discard',  s.me?.discard  || [], false);
  renderDiscard('opp-discard', s.opponent?.discard || [], oppJustPlayed);

  // Колода
  document.getElementById('deck-count-badge').textContent = s.deckCount;

  // Лог
  updateLogStrip(s.log);

  // Результаты
  if (s.gameOver)        { stopRoundTimer(); showGameOver(s.gameOver); }
  else if (s.roundOver)  { showRoundOver(s.roundOver); }
  else {
    document.getElementById('round-over').classList.remove('show');
    document.getElementById('game-over').classList.remove('show');
  }
}

// ─── КАРТА СОПЕРНИКА ───
function renderOppCard(s, isFirst, oppJustPlayed) {
  const zone = document.getElementById('opp-card-zone');
  zone.innerHTML = '';
  if (!s.opponent || s.opponent.handCount === 0) return;

  const card = makeCard(null, false, 'card--opp');

  // Свечение когда ход соперника
  if (!s.isMyTurn) card.classList.add('opp-turn-glow');

  if (isFirst) {
    card.classList.add('dealing');
    card.style.animationDelay = '0s';
  } else if (oppJustPlayed) {
    // Соперник только что сыграл — новая карта прилетает
    card.classList.add('opp-incoming');
    playCardSound();
  }

  zone.appendChild(card);
}

// ─── МОИ КАРТЫ ───
function renderMyCards(s, isFirst) {
  const zone = document.getElementById('my-card-zone'); zone.innerHTML='';
  if (!s.me?.hand?.length) return;
  const myTurn = s.isMyTurn;
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:24px;align-items:center;';

  s.me.hand.forEach((c, idx) => {
    const wrap = document.createElement('div'); wrap.className='play-arrow-wrap';

    const cardEl = makeCard(c, true, 'card--big');
    if (myTurn) cardEl.classList.add('my-turn-glow');
    if (isFirst) { cardEl.classList.add('dealing'); cardEl.style.animationDelay=`${idx*.2+.15}s`; }

    // Бейдж видено X/N — теперь снаружи карты, не обрезается
    const seen  = (s.me?.seenCounts||{})[c.value] || 0;
    const total = CARDS[c.value]?.total || '?';
    const badge = document.createElement('div'); badge.className='card-seen-badge';
    badge.textContent = `${seen}/${total}`;
    cardEl.appendChild(badge);

    // Тап = зум
    cardEl.addEventListener('click', e => { e.stopPropagation(); openZoom(c, s.me?.seenCounts||{}); });

    if (myTurn) {
      const arrow = document.createElement('div');
      arrow.className='play-arrow'; arrow.title='Сыграть';
      // Передаём элемент карты в onPlay чтобы потом анимировать его
      arrow.addEventListener('click', e => { e.stopPropagation(); onPlay(c, cardEl); });
      wrap.appendChild(arrow);
    }

    wrap.appendChild(cardEl);
    row.appendChild(wrap);
  });
  zone.appendChild(row);
}

// ─── СОЗДАНИЕ КАРТЫ (БЕЗ цифр в углах) ───
function makeCard(card, faceUp, sizeClass) {
  const el = document.createElement('div');
  el.className = `card ${sizeClass||'card--big'}${faceUp?' face-up':''}`;
  const back = document.createElement('div'); back.className='card-back';
  const bi = document.createElement('img'); bi.src='assets/cards/back.png'; bi.onerror=()=>bi.style.display='none'; bi.alt='';
  back.appendChild(bi); el.appendChild(back);
  const face = document.createElement('div'); face.className='card-face';
  if (card) {
    const img = document.createElement('img');
    img.src=`assets/cards/${card.value}.png`;
    img.onerror=()=>img.style.display='none'; img.alt='';
    face.appendChild(img);
    // ← НЕТ card-corner элементов, чтобы цифры не загораживали картинку
  }
  el.appendChild(face);
  return el;
}

// ─── ЛОГ ───
function updateLogStrip(log) {
  const lines = (log||[]).filter(Boolean);
  document.getElementById('log-line-1').textContent = lines[lines.length-1] || '—';
  document.getElementById('log-line-2').textContent = lines[lines.length-2] || '';
}
document.getElementById('log-strip').addEventListener('click', () => {
  if (!lastState) return;
  const list = document.getElementById('lo-list'); list.innerHTML='';
  [...(lastState.log||[])].reverse().forEach(line => {
    const d=document.createElement('div'); d.className='lo-entry'; d.textContent=line; list.appendChild(d);
  });
  document.getElementById('log-overlay').classList.add('show');
});
document.getElementById('log-overlay').addEventListener('click', () => document.getElementById('log-overlay').classList.remove('show'));

// ─── СБРОС ───
function renderDiscard(id, cards, animateLast) {
  const el = document.getElementById(id); el.innerHTML='';
  const slice = cards.slice(-7);
  slice.forEach((c,i) => {
    const card = makeCard(c, true, 'card--sm');
    if (animateLast && i === slice.length-1) card.classList.add('discard-entry');
    card.addEventListener('click', () => openZoom(c, lastState?.me?.seenCounts||{}));
    el.appendChild(card);
  });
}

// ─── ИСКЛЮЧЁННЫЕ ───
function renderExcluded(cards) {
  const el = document.getElementById('excluded-cards'); el.innerHTML='';
  cards.forEach(c => {
    const card = makeCard(c, true, 'card--exc');
    card.addEventListener('click', () => openZoom(c, lastState?.me?.seenCounts||{}));
    el.appendChild(card);
  });
}

// ─── ЖЕТОНЫ ───
let prevTokens = {};
function renderTokens(id, count) {
  const el = document.getElementById(id); if (!el) return;
  const prev = prevTokens[id] ?? 0;
  prevTokens[id] = count;
  let html = '';
  for (let i=0;i<6;i++) {
    const earned=i<count, newlyEarned=earned&&i>=prev;
    html+=`<span class="token ${earned?'earned':'empty'}${newlyEarned?' new-earn':''}" title="${earned?'жетон':'пусто'}">◆</span>`;
  }
  el.innerHTML = html;
}

// ─── СЫГРАТЬ КАРТУ ───
function onPlay(card, cardElement) {
  if (!lastState?.isMyTurn) return;
  pendingCard = card;
  pendingCardElement = cardElement;
  if      (card.value === 1) openGuessModal(card);
  else if (card.value === 5) openTargetModal(card);
  else { animateMyPlayAndEmit(card, cardElement); }
}

// Детектив (1)
function openGuessModal(card) {
  const el = document.getElementById('action-modal');
  const grid = document.getElementById('action-options'); grid.innerHTML='';
  for (let v=0;v<=9;v++) {
    if (v===1) continue;
    const opt=document.createElement('div'); opt.className='am-opt';
    opt.innerHTML=`<span class="num">${v}</span>${CARDS[v].name}`;
    opt.addEventListener('click', () => {
      el.classList.remove('show');
      // Анимируем + эмитим с задержкой
      animateMyPlayAndEmit(card, pendingCardElement, { guess: v });
      pendingCard = null;
    });
    grid.appendChild(opt);
  }
  el.classList.add('show');
}

// Федерал (5)
function openTargetModal(card) {
  const el = document.getElementById('target-modal');
  const opts = document.getElementById('target-options'); opts.innerHTML='';
  const me  = lastState?.me?.name  || 'Я';
  const opp = lastState?.opponent?.name || 'Соперник';
  [{id:'self',label:me,sub:'себя'},{id:'opp',label:opp,sub:'соперника'}].forEach(t => {
    const o=document.createElement('div'); o.className='am-opt';
    o.innerHTML=`<span class="num">★</span>${esc(t.label)}<br/><small style="opacity:.5;font-size:9px">${t.sub}</small>`;
    o.addEventListener('click', () => {
      el.classList.remove('show');
      animateMyPlayAndEmit(card, pendingCardElement, { target: t.id });
      pendingCard = null;
    });
    opts.appendChild(o);
  });
  el.classList.add('show');
}

document.getElementById('action-cancel').addEventListener('click', () => { pendingCard=null; pendingCardElement=null; document.getElementById('action-modal').classList.remove('show'); });
document.getElementById('target-cancel').addEventListener('click', () => { pendingCard=null; pendingCardElement=null; document.getElementById('target-modal').classList.remove('show'); });

// ─── ТЕНЕВОЙ БРОКЕР ───
function showChancellor(cards) {
  const el = document.getElementById('chancellor-modal');
  const wrap = document.getElementById('chancellor-cards'); wrap.innerHTML='';
  cards.forEach(c => {
    const opt=document.createElement('div'); opt.className='chancellor-option';
    const cardEl=makeCard(c,true,'card--big');
    const lbl=document.createElement('div'); lbl.className='chancellor-choose-label'; lbl.textContent='Выбрать';
    opt.addEventListener('click', () => { socket.emit('chancellor_pick',c.id); el.classList.remove('show'); });
    opt.appendChild(cardEl); opt.appendChild(lbl); wrap.appendChild(opt);
  });
  el.classList.add('show');
}

// ─── ЗУМ ───
function openZoom(card, seenCounts) {
  if (!card) return;
  const def=CARDS[card.value];
  const wrap=document.getElementById('cz-card-img'); wrap.innerHTML='';
  const img=document.createElement('img'); img.src=`assets/cards/${card.value}.png`; img.onerror=()=>img.style.display='none'; img.alt='';
  wrap.appendChild(img);
  document.getElementById('cz-name').textContent  = def.name;
  document.getElementById('cz-value').textContent = `Карта ${card.value}`;
  document.getElementById('cz-desc').textContent  = def.desc;
  const seen=(seenCounts||{})[card.value]||0;
  document.getElementById('cz-seen').textContent  = `Видено: ${seen} из ${def.total}`;
  document.getElementById('card-zoom').classList.add('show');
}
document.getElementById('card-zoom').addEventListener('click', () => document.getElementById('card-zoom').classList.remove('show'));

// ─── КНОПКА КОЛОДЫ ───
document.getElementById('deck-btn').addEventListener('click', e => {
  e.stopPropagation();
  const grid=document.getElementById('do-grid'); grid.innerHTML='';
  for (let v=0;v<=9;v++) {
    const def=CARDS[v], row=document.createElement('div'); row.className='do-row';
    const mini=document.createElement('div'); mini.className='do-mini';
    const img=document.createElement('img'); img.src=`assets/cards/${v}.png`; img.onerror=()=>img.style.display='none'; img.alt='';
    mini.appendChild(img);
    const info=document.createElement('div'); info.className='do-info';
    info.innerHTML=`<div class="do-name">${def.name}</div><div class="do-cnt">${def.total}</div>`;
    row.appendChild(mini); row.appendChild(info); grid.appendChild(row);
  }
  document.getElementById('deck-overlay').classList.add('show');
});
document.getElementById('deck-overlay').addEventListener('click', () => document.getElementById('deck-overlay').classList.remove('show'));

// ─── PEEK ───
function showPeek(data) {
  const wrap=document.getElementById('peek-card'); wrap.innerHTML='';
  if (data.card) { const card=makeCard(data.card,true,'card--big'); wrap.appendChild(card); }
  document.getElementById('peek-title').textContent=`У ${data.playerName}: ${data.cardName}`;
  document.getElementById('peek-overlay').classList.add('show');
  tg?.HapticFeedback?.impactOccurred?.('medium');
}
document.getElementById('peek-close').addEventListener('click', () => document.getElementById('peek-overlay').classList.remove('show'));

// ─── КОНЕЦ РАУНДА ───
let roundTimerVal = 4;
function showRoundOver(ro) {
  stopRoundTimer();
  const overlay=document.getElementById('round-over');
  const iWon=ro.winnerId===ME.id;
  document.getElementById('ro-glyph').textContent     = iWon?'✦':'✗';
  document.getElementById('ro-glyph').style.color     = iWon?'var(--gold)':'var(--red-b)';
  document.getElementById('ro-title').textContent     = iWon?'Раунд ваш!':'Раунд потерян';
  document.getElementById('ro-sub').textContent       = iWon?`${esc(ro.loserName)} теряет позиции`:'Вы теряете позиции';
  document.getElementById('ro-tokens-row').innerHTML  =
    `<span>${esc(ro.winnerName)}: <strong>${ro.winnerTokens} ◆</strong></span>
     <span style="margin:0 8px;opacity:.4">|</span>
     <span>${esc(ro.loserName)}: <strong>${ro.loserTokens} ◆</strong></span>`;
  overlay.classList.add('show');
  tg?.HapticFeedback?.notificationOccurred?.(iWon?'success':'error');
  roundTimerVal=4; document.getElementById('ro-timer').textContent=roundTimerVal;
  roundTimerInterval=setInterval(()=>{
    roundTimerVal--; document.getElementById('ro-timer').textContent=roundTimerVal;
    if(roundTimerVal<=0){stopRoundTimer();overlay.classList.remove('show');}
  },1000);
}
function stopRoundTimer(){if(roundTimerInterval){clearInterval(roundTimerInterval);roundTimerInterval=null;}}

// ─── КОНЕЦ ИГРЫ ───
function showGameOver(go) {
  stopRoundTimer();
  const iWon=go.winnerId===ME.id;
  document.getElementById('go-glyph').textContent = iWon?'✦':'✗';
  document.getElementById('go-title').textContent = iWon?'Победа!':'Поражение';
  document.getElementById('go-sub').textContent   = iWon?`${esc(go.loserName)} разоблачён.`:'Ваши связи уничтожены.';
  document.getElementById('go-tokens-row').innerHTML =
    `<span>${esc(go.winnerName)}: <strong>${go.winnerTokens} ◆</strong></span>
     <span style="margin:0 8px;opacity:.4">|</span>
     <span>${esc(go.loserName)}: <strong>${go.loserTokens} ◆</strong></span>`;
  document.getElementById('go-pending').textContent='';
  document.getElementById('game-over').classList.add('show');
  tg?.HapticFeedback?.notificationOccurred?.(iWon?'success':'error');
}
document.getElementById('btn-rematch').addEventListener('click',()=>{ socket.emit('rematch'); document.getElementById('go-pending').textContent='Ждём соперника…'; });
document.getElementById('btn-to-menu').addEventListener('click', leaveToMenu);

// ─── ВСПОМОГАТЕЛЬНЫЕ ───
function leaveToMenu(){
  stopRoundTimer(); socket?.emit('leave'); socket?.disconnect(); socket=null;
  currentRoomId=null; resetState(); closeAllOverlays(); showScreen('menu');
}
function closeAllOverlays(){ document.querySelectorAll('.overlay').forEach(o=>o.classList.remove('show')); }
function showToast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2500);
}
function esc(s){
  return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
