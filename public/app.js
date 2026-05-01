// =====================================================================
// Love Letter Mini App — Frontend v2
// =====================================================================

const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor?.('#0a0612'); tg.setBackgroundColor?.('#0a0612'); }

const tgUser = tg?.initDataUnsafe?.user;
const ME = {
  id:     tgUser ? `tg_${tgUser.id}` : `g_${Math.random().toString(36).slice(2,9)}`,
  name:   tgUser ? [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') : 'Гость',
  avatar: tgUser?.photo_url || null,
};

const CARDS = {
  1:{ name:'Обстоятельства', desc:'Назови карту от 2 до 8. Если у соперника эта карта — он выбывает.' },
  2:{ name:'Свидетель',      desc:'Тайно посмотри карту в руке соперника.' },
  3:{ name:'Дуэлянт',        desc:'Сравните карты. У кого ниже — выбывает. Ничья — никто не выбывает.' },
  4:{ name:'Защитник',       desc:'До твоего следующего хода ты неуязвим.' },
  5:{ name:'Палач',          desc:'Выбери игрока (себя или соперника) — он сбрасывает карту и берёт новую.' },
  6:{ name:'Заговорщик',     desc:'Обменяйся картами с соперником.' },
  7:{ name:'Вдова',          desc:'Если на руке также 5 или 6 — Вдову обязан сбросить. Эффекта нет.' },
  8:{ name:'Императрица',    desc:'Сбросишь по любой причине — мгновенно проигрываешь раунд.' },
};

// ===== ЗВУК =====
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
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.type='triangle';
    o.frequency.setValueAtTime(820,now);
    o.frequency.exponentialRampToValueAtTime(400,now+.07);
    g.gain.setValueAtTime(.14,now);
    g.gain.exponentialRampToValueAtTime(.001,now+.09);
    o.start(now); o.stop(now+.1);
  } catch(e){}
}
document.body.addEventListener('click', e => {
  if (e.target.closest('.btn,.am-opt,.g-deck-btn,.g-log-strip,.play-arrow,#intro')) playClick();
}, true);

// ===== ЭКРАНЫ =====
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id===id));
}

// ===== ЗАСТАВКА =====
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

  // Если пришли по invite-ссылке
  const sp = tg?.initDataUnsafe?.start_param;
  if (sp) {
    document.getElementById('intro').classList.remove('active');
    showScreen('menu');
    enterGame(sp, false);
  }
});

// ===== SOCKET =====
let socket = null;
let currentRoomId = null;

function connectSocket() {
  if (socket?.connected) return;
  socket = io({ transports:['websocket','polling'] });
  socket.on('connect', () => console.log('✓ socket', socket.id));
  socket.on('lobby', d => { currentRoomId=d.roomId; document.getElementById('lobby-room-id').textContent=d.roomId; renderLobbyPlayers(d.players); });
  socket.on('start', () => { showScreen('game'); closeAllOverlays(); resetGameState(); });
  socket.on('new_round', () => { closeAllOverlays(); stopRoundTimer(); });
  socket.on('state', s => renderGameState(s));
  socket.on('peek', d => showPeek(d));
  socket.on('rematch_pending', ({count}) => { document.getElementById('go-pending').textContent = count===1?'Ждём соперника…':''; });
  socket.on('opponent_left', () => { showToast('Соперник покинул игру'); setTimeout(()=>leaveToMenu(),1600); });
  socket.on('error_msg', msg => showToast(msg));
}

// ===== МЕНЮ =====
document.getElementById('btn-invite').addEventListener('click', () => enterGame(genRoomId(), true));
document.getElementById('btn-quick').addEventListener('click', () => enterGame('q_'+Math.floor(Date.now()/30000), false));

function genRoomId() { return 'r'+Math.random().toString(36).slice(2,8); }

function enterGame(roomId, isInvite) {
  connectSocket();
  currentRoomId = roomId;
  socket.emit('join', { roomId, user:{ id:ME.id, name:ME.name, avatar:ME.avatar } });
  showScreen('lobby');
  document.getElementById('lobby-room-id').textContent = roomId;
  if (isInvite) setTimeout(() => shareInvite(roomId), 300);
}

function shareInvite(roomId) {
  const BOT_USERNAME = 'YourBotName'; // <-- ЗАМЕНИ
  const APP_NAME     = 'play';
  const link = `https://t.me/${BOT_USERNAME}/${APP_NAME}?startapp=${roomId}`;
  const text = `Сразимся в Тёмной Дуэли? Комната ${roomId}.`;
  if (tg?.openTelegramLink) {
    tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
  } else {
    navigator.clipboard?.writeText(link);
    showToast('Ссылка скопирована');
  }
}

document.getElementById('lobby-share').addEventListener('click', () => { if(currentRoomId) shareInvite(currentRoomId); });
document.getElementById('lobby-cancel').addEventListener('click', leaveToMenu);

function renderLobbyPlayers(players) {
  const c = document.getElementById('lobby-players');
  c.innerHTML = '';
  for (let i=0;i<2;i++) {
    const p = players[i];
    const el = document.createElement('div');
    el.className='lobby-player';
    if (p) {
      el.innerHTML=`<div class="lobby-player-avatar"${p.avatar?` style="background-image:url('${p.avatar}')"`:''}></div><div class="lobby-player-name">${esc(p.name)}</div>`;
    } else {
      el.style.opacity='.4';
      el.innerHTML='<div class="lobby-player-avatar" style="border-style:dashed"></div><div class="lobby-player-name">ожидание</div>';
    }
    c.appendChild(el);
  }
}

// ===== ИГРОВОЕ СОСТОЯНИЕ =====
let lastState = null;
let pendingPlay = null;  // { cardId } — ждём подтверждения модалки
let zoomOpen = false;
let roundTimerInterval = null;

function resetGameState() { lastState=null; pendingPlay=null; zoomOpen=false; stopRoundTimer(); }

function isMyTurn(s) {
  if (!s?.me) return false;
  const last = s.log[s.log.length-1]||'';
  return last.includes(`Ходит ${s.me.name}`);
}

// ===== ГЛАВНЫЙ РЕНДЕР =====
function renderGameState(s) {
  const firstRender = !lastState;
  lastState = s;

  // Имена
  document.getElementById('me-name').textContent  = s.me?.name  || 'Вы';
  document.getElementById('opp-name').textContent = s.opponent?.name || 'Соперник';
  document.getElementById('me-status').textContent  = getStatus(s, true);
  document.getElementById('opp-status').textContent = getStatus(s, false);

  // Аватары
  setAvatar('me-avatar',  s.me?.avatar);
  setAvatar('opp-avatar', s.opponent?.avatar);

  // Сердечки
  renderHearts('me-hearts',  s.me?.hearts  ?? 7);
  renderHearts('opp-hearts', s.opponent?.hearts ?? 7);

  // Карты
  renderOppCards(s, firstRender);
  renderMyCards(s, firstRender);

  // Сбросы
  renderDiscard('me-discard',  s.me?.discard  || []);
  renderDiscard('opp-discard', s.opponent?.discard || []);

  // Лог
  const last2 = s.log.slice(-2);
  document.getElementById('log-preview').textContent = last2[last2.length-1] || '—';
  document.getElementById('deck-count-badge').textContent = s.deckCount;

  // Конец раунда / игры
  if (s.gameOver) {
    stopRoundTimer();
    showGameOver(s.gameOver);
  } else if (s.roundOver) {
    showRoundOver(s.roundOver, s.me?.hearts, s.opponent?.hearts);
  } else {
    hideResultScreens();
  }
}

function getStatus(s, isMe) {
  const p = isMe ? s.me : s.opponent;
  if (!p) return '';
  if (p.eliminated) return 'выбыл';
  if (p.protected) return '✦ защита';
  const myTurn = isMyTurn(s);
  if (isMe && myTurn) return 'твой ход';
  if (!isMe && !myTurn) return 'ходит';
  return '';
}

function setAvatar(id, url) {
  const el = document.getElementById(id);
  if (!el) return;
  if (url) el.style.backgroundImage = `url('${url}')`;
}

// ===== СЕРДЕЧКИ =====
let prevHearts = {};
function renderHearts(id, count) {
  const el = document.getElementById(id);
  if (!el) return;
  const prev = prevHearts[id] ?? count;
  prevHearts[id] = count;
  let html = '';
  for (let i=0; i<7; i++) {
    const on = i < count;
    const lost = i === count && prev > count; // только что потеряли
    html += `<span class="heart ${on?'on':'off'}${lost?' lose':''}" aria-label="${on?'сердце':'пусто'}">♥</span>`;
  }
  el.innerHTML = html;
}

// ===== КАРТЫ СОПЕРНИКА =====
function renderOppCards(s, firstRender) {
  const zone = document.getElementById('opp-card-zone');
  zone.innerHTML = '';
  const cnt = s.opponent?.handCount || 0;
  if (cnt === 0) return;
  const card = makeCard(null, false, 'card--opp');
  if (firstRender) { card.classList.add('dealing'); card.style.animationDelay = '0s'; }
  zone.appendChild(card);
}

// ===== МОИ КАРТЫ =====
function renderMyCards(s, firstRender) {
  const zone = document.getElementById('my-card-zone');
  zone.innerHTML = '';
  if (!s.me?.hand?.length) return;

  const myTurn = isMyTurn(s);
  const dbv = s.deckByValue || {};

  // Если мой ход и 2 карты — показываем обе с кнопкой «сыграть»
  // Если не мой ход или 1 карта — просто карта (тапаемая для зума)
  const hand = s.me.hand;

  // Контейнер для нескольких карт
  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.gap = '14px';
  row.style.alignItems = 'flex-end';

  hand.forEach((c, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'play-arrow-wrap';

    // Стрелка «сыграть» (только в мой ход)
    if (myTurn) {
      const arrow = document.createElement('div');
      arrow.className = 'play-arrow';
      arrow.title = 'Сыграть карту';
      arrow.addEventListener('click', e => { e.stopPropagation(); onPlayCard(c); });
      wrap.appendChild(arrow);
    }

    // Карта
    const cardEl = makeCard(c, true, 'card--big');
    if (firstRender) { cardEl.classList.add('dealing'); cardEl.style.animationDelay = `${idx*0.18+0.1}s`; }

    // Бейдж с остатком для карты 1
    if (c.value === 1) {
      const badge = document.createElement('div');
      badge.className = 'card-badge';
      const rem = dbv[1] ?? '?';
      badge.textContent = `в колоде: ${rem}`;
      cardEl.appendChild(badge);
    }

    // Тап по карте = зум
    cardEl.addEventListener('click', e => { e.stopPropagation(); openCardZoom(c, dbv); });

    wrap.appendChild(cardEl);
    row.appendChild(wrap);
  });

  zone.appendChild(row);
}

// ===== СОЗДАНИЕ ЭЛЕМЕНТА КАРТЫ =====
function makeCard(card, faceUp, sizeClass='card--big') {
  const el = document.createElement('div');
  el.className = `card ${sizeClass}${faceUp?' face-up':''}`;

  // Рубашка
  const back = document.createElement('div');
  back.className = 'card-back';
  const backImg = document.createElement('img');
  backImg.src = 'assets/cards/back.png';
  backImg.onerror = () => backImg.style.display='none';
  backImg.alt = '';
  back.appendChild(backImg);
  el.appendChild(back);

  // Лицо
  const face = document.createElement('div');
  face.className = 'card-face';
  if (card) {
    const imgSrc = card.value >= 6
      ? `assets/cards/${card.value}.png`
      : `assets/cards/${card.value}_${card.art}.png`;
    const img = document.createElement('img');
    img.src = imgSrc;
    img.onerror = () => img.style.display='none';
    img.alt = CARDS[card.value]?.name || '';
    face.appendChild(img);

    // Уголки с цифрой
    const tl = document.createElement('div');
    tl.className='card-corner tl'; tl.textContent=card.value;
    const br = document.createElement('div');
    br.className='card-corner br'; br.textContent=card.value;
    face.appendChild(tl); face.appendChild(br);
  }
  el.appendChild(face);
  return el;
}

// ===== СБРОС =====
function renderDiscard(id, cards) {
  const el = document.getElementById(id);
  el.innerHTML = '';
  cards.slice(-6).forEach(c => {
    const card = makeCard(c, true, 'card--sm');
    // Тап по карте сброса = зум
    card.addEventListener('click', () => openCardZoom(c, lastState?.deckByValue||{}));
    el.appendChild(card);
  });
}

// ===== СЫГРАТЬ КАРТУ =====
function onPlayCard(card) {
  if (!isMyTurn(lastState)) return;
  pendingPlay = card;

  if (card.value === 1) {
    openGuessModal(card);
  } else if (card.value === 5) {
    openTargetModal(card);
  } else {
    socket.emit('play', { cardId: card.id });
    pendingPlay = null;
  }
}

// ===== ЗАРЕШИТЬ КАРТУ (модалки) =====
function openGuessModal(card) {
  const el = document.getElementById('action-modal');
  document.getElementById('action-title').textContent = 'Назови карту соперника';
  const grid = document.getElementById('action-options');
  grid.innerHTML = '';
  for (let v=2; v<=8; v++) {
    const opt = document.createElement('div');
    opt.className = 'am-opt';
    const rem = (lastState?.deckByValue||{})[v] ?? '?';
    opt.innerHTML = `<span class="num">${v}</span>${CARDS[v].name}<br/><small style="opacity:.5;font-size:9px">${rem} в колоде</small>`;
    opt.addEventListener('click', () => {
      socket.emit('play', { cardId: card.id, guess: v });
      pendingPlay = null;
      el.classList.remove('show');
    });
    grid.appendChild(opt);
  }
  el.classList.add('show');
}

function openTargetModal(card) {
  const el = document.getElementById('target-modal');
  const opts = document.getElementById('target-options');
  opts.innerHTML = '';
  const me  = lastState?.me?.name  || 'Я';
  const opp = lastState?.opponent?.name || 'Соперник';
  [{ id:'self', label:me, sub:'себя' }, { id:'opp', label:opp, sub:'соперника' }].forEach(t => {
    const opt = document.createElement('div');
    opt.className = 'am-opt';
    opt.innerHTML = `<span class="num">★</span>${t.label}<br/><small style="opacity:.55">${t.sub}</small>`;
    opt.addEventListener('click', () => {
      socket.emit('play', { cardId: card.id, target: t.id });
      pendingPlay = null;
      el.classList.remove('show');
    });
    opts.appendChild(opt);
  });
  el.classList.add('show');
}

document.getElementById('action-cancel').addEventListener('click', () => { pendingPlay=null; document.getElementById('action-modal').classList.remove('show'); });
document.getElementById('target-cancel').addEventListener('click', () => { pendingPlay=null; document.getElementById('target-modal').classList.remove('show'); });

// ===== ЗУМ КАРТЫ =====
function openCardZoom(card, dbv) {
  if (!card) return;
  const def = CARDS[card.value];
  const imgSrc = card.value>=6 ? `assets/cards/${card.value}.png` : `assets/cards/${card.value}_${card.art}.png`;

  // Большая картинка
  const wrap = document.getElementById('cz-card-img');
  wrap.innerHTML = '';
  const img = document.createElement('img');
  img.src = imgSrc;
  img.onerror = () => img.style.display='none';
  img.alt = '';
  wrap.appendChild(img);

  // Номер в углу
  const corn = document.createElement('div');
  corn.className='card-corner tl'; corn.textContent=card.value;
  wrap.appendChild(corn);

  document.getElementById('cz-name').textContent  = def.name;
  document.getElementById('cz-value').textContent = `Карта ${card.value}`;
  document.getElementById('cz-desc').textContent  = def.desc;

  const rem = dbv[card.value];
  document.getElementById('cz-remaining').textContent =
    card.value===1 && rem!==undefined ? `В колоде осталось: ${rem}` : '';

  document.getElementById('card-zoom').classList.add('show');
  zoomOpen = true;
}

document.getElementById('card-zoom').addEventListener('click', () => {
  document.getElementById('card-zoom').classList.remove('show');
  zoomOpen = false;
});

// ===== ЛОГ =====
document.getElementById('log-strip').addEventListener('click', () => {
  if (!lastState) return;
  const list = document.getElementById('lo-list');
  list.innerHTML = '';
  [...lastState.log].reverse().forEach(line => {
    const d = document.createElement('div');
    d.className = 'lo-entry';
    d.textContent = line;
    list.appendChild(d);
  });
  document.getElementById('log-overlay').classList.add('show');
});
document.getElementById('log-overlay').addEventListener('click', () => {
  document.getElementById('log-overlay').classList.remove('show');
});

// ===== ПРОСМОТР КОЛОДЫ =====
document.getElementById('deck-btn').addEventListener('click', e => {
  e.stopPropagation(); // не открывать лог
  if (!lastState) return;
  const dbv = lastState.deckByValue || {};
  const grid = document.getElementById('do-grid');
  grid.innerHTML = '';
  for (let v=1; v<=8; v++) {
    const cnt = dbv[v] || 0;
    const row = document.createElement('div');
    row.className = `do-card-row${cnt===0?' do-zero':''}`;
    const mini = document.createElement('div');
    mini.className = 'do-mini';
    const imgSrc = v>=6 ? `assets/cards/${v}.png` : `assets/cards/${v}_1.png`;
    mini.innerHTML = `<img src="${imgSrc}" onerror="this.style.display='none'" alt="" />`;
    const info = document.createElement('div');
    info.className = 'do-info';
    info.innerHTML = `<div class="do-name">${CARDS[v].name}</div><div class="do-cnt">${cnt}</div>`;
    row.appendChild(mini); row.appendChild(info);
    grid.appendChild(row);
  }
  document.getElementById('deck-overlay').classList.add('show');
});
document.getElementById('deck-overlay').addEventListener('click', () => {
  document.getElementById('deck-overlay').classList.remove('show');
});

// ===== PEEK =====
function showPeek(data) {
  const wrap = document.getElementById('peek-card');
  wrap.innerHTML = '';
  const card = makeCard(data.card, true, 'card--big');
  wrap.appendChild(card);
  document.getElementById('peek-overlay').classList.add('show');
  tg?.HapticFeedback?.impactOccurred?.('medium');
}
document.getElementById('peek-close').addEventListener('click', () => {
  document.getElementById('peek-overlay').classList.remove('show');
});

// ===== КОНЕЦ РАУНДА =====
let roundTimerVal = 3;
function showRoundOver(ro, meHearts, oppHearts) {
  stopRoundTimer();
  const overlay = document.getElementById('round-over');
  const iWon = ro.winnerId === ME.id;
  document.getElementById('ro-glyph').textContent = iWon ? '✦' : '✦';
  document.getElementById('ro-glyph').style.color = iWon ? 'var(--gold)' : 'var(--crimson-bright)';
  document.getElementById('ro-title').textContent = iWon ? 'Раунд ваш!' : 'Раунд потерян';
  document.getElementById('ro-sub').textContent = iWon
    ? `${ro.loserName} потерял сердце`
    : `Вы потеряли сердце (осталось ${ro.loserHearts})`;

  // Показываем оставшиеся сердца
  const hr = document.getElementById('ro-hearts');
  hr.innerHTML = '';
  const h = iWon ? meHearts : (ro.loserHearts ?? 0);
  for (let i=0;i<7;i++) hr.innerHTML += `<span style="font-size:18px;color:${i<(iWon?meHearts:ro.loserHearts)?'var(--heart-on)':'var(--heart-off)'}"}>♥</span>`;

  overlay.classList.add('show');
  tg?.HapticFeedback?.notificationOccurred?.(iWon?'success':'error');

  // Таймер
  roundTimerVal = 3;
  document.getElementById('ro-timer').textContent = roundTimerVal;
  roundTimerInterval = setInterval(() => {
    roundTimerVal--;
    document.getElementById('ro-timer').textContent = roundTimerVal;
    if (roundTimerVal <= 0) { stopRoundTimer(); overlay.classList.remove('show'); }
  }, 1000);
}

function stopRoundTimer() {
  if (roundTimerInterval) { clearInterval(roundTimerInterval); roundTimerInterval=null; }
}

function showGameOver(go) {
  stopRoundTimer();
  const overlay = document.getElementById('game-over');
  const iWon = go.winnerId === ME.id;
  document.getElementById('go-glyph').textContent = iWon ? '✦' : '✗';
  document.getElementById('go-title').textContent = iWon ? 'Победа!' : 'Поражение';
  document.getElementById('go-sub').textContent = iWon
    ? `${go.loserName} лишился всех сердец.`
    : `Ваши сердца иссякли.`;
  document.getElementById('go-pending').textContent = '';
  overlay.classList.add('show');
  tg?.HapticFeedback?.notificationOccurred?.(iWon?'success':'error');
}

function hideResultScreens() {
  document.getElementById('round-over').classList.remove('show');
  document.getElementById('game-over').classList.remove('show');
}

document.getElementById('btn-rematch').addEventListener('click', () => {
  socket.emit('rematch');
  document.getElementById('go-pending').textContent = 'Ждём соперника…';
});
document.getElementById('btn-to-menu').addEventListener('click', leaveToMenu);

// ===== ВСПОМОГАТЕЛЬНЫЕ =====
function leaveToMenu() {
  stopRoundTimer();
  socket?.emit('leave');
  socket?.disconnect();
  socket = null;
  currentRoomId = null;
  resetGameState();
  closeAllOverlays();
  showScreen('menu');
}

function closeAllOverlays() {
  document.querySelectorAll('.overlay').forEach(o => o.classList.remove('show'));
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2400);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
