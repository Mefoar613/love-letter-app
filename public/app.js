// =====================================================================
// Love Letter Mini App — Frontend
// =====================================================================

// Telegram WebApp SDK
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  tg.setHeaderColor?.('#0a0612');
  tg.setBackgroundColor?.('#0a0612');
}

// Данные пользователя из Telegram (или гость для тестов в браузере)
const tgUser = tg?.initDataUnsafe?.user;
const ME = {
  id: tgUser ? `tg_${tgUser.id}` : `guest_${Math.random().toString(36).slice(2, 9)}`,
  name: tgUser ? [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') : 'Гость',
  avatar: tgUser?.photo_url || null,
};

// Описания карт (зеркало серверного, для UI)
const CARDS = {
  1: { name: 'Обстоятельства', desc: 'Назови причину от 2 до 8. Если угадал, то я мчу к тебе.' },
  2: { name: 'Чекнуть локу',      desc: 'Тайно посмотри карту в руке соперника.' },
  3: { name: 'Отдай мне',        desc: 'Сравните номера карт. У кого ниже — выбывает. При равенстве — никто.' },
  4: { name: 'Вернячок',       desc: 'До твоего следующего хода ты неуязвим — на тебя нельзя направлять эффекты.' },
  5: { name: 'Vomit',          desc: 'ФУ! Блевачка. Выбери игрока (себя или соперника) — он сбрасывает карту и берёт новую.' },
  6: { name: 'Пивас',     desc: 'Будешь пиво бро? Поменяйся картами в руке с соперником.' },
  7: { name: 'Ром',          desc: 'Ром только на вайбе. Если на руке также карта Блевотни или Пиваса — Ром обязан сбросить. Эффекта нет.' },
  8: { name: 'Наргила',    desc: 'Нет калика нет встречи. Если эту карту сбросишь по любой причине — мгновенно проигрываешь раунд.' },
};

// =====================================================================
// ЗВУКИ И МУЗЫКА
// =====================================================================

// Фоновая музыка
const bgm = document.getElementById('bgm');
bgm.volume = 0.4; // спокойная громкость; меняй если хочешь громче/тише

let musicStarted = false;
function startMusic() {
  if (musicStarted) return;
  musicStarted = true;
  // Попытка запустить — если браузер блокирует, повторим при следующем тапе
  bgm.play().catch(() => {
    musicStarted = false;
  });
}

// Звук клика — синтез через Web Audio API (не требует файла)
let audioCtx = null;
function playClickSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g);
    g.connect(audioCtx.destination);
    o.type = 'triangle';
    o.frequency.setValueAtTime(880, now);
    o.frequency.exponentialRampToValueAtTime(440, now + 0.06);
    g.gain.setValueAtTime(0.15, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    o.start(now);
    o.stop(now + 0.09);
  } catch (e) { /* тихо игнорируем */ }
}

// Привязка звука клика ко всем кнопкам и интерактивным элементам
function attachClickSounds() {
  document.body.addEventListener('click', (e) => {
    if (e.target.closest('.btn, .action-option, .online-friend, .card.playable, #intro')) {
      playClickSound();
    }
  }, true);
}
attachClickSounds();

// =====================================================================
// УПРАВЛЕНИЕ ЭКРАНАМИ
// =====================================================================
const screens = ['intro', 'menu', 'lobby', 'game'];
function showScreen(id) {
  for (const s of screens) {
    document.getElementById(s).classList.toggle('active', s === id);
  }
}

// =====================================================================
// ИНТРО (комикс с наложением)
// =====================================================================
let introStep = 0;
const introLayers = document.querySelectorAll('.intro-layer');
const introHint = document.querySelector('.intro-hint');

function advanceIntro() {
  // Стартуем музыку при первом тапе (это разблокирует автоплей)
  startMusic();

  if (introStep < introLayers.length) {
    introLayers[introStep].classList.add('show');
    introStep++;
    // Если показали последнюю — меняем подсказку
    if (introStep === introLayers.length) {
      introHint.textContent = 'тапни, чтобы войти';
    }
  } else {
    // Все 3 картинки показаны — переходим в меню
    document.getElementById('intro').removeEventListener('click', advanceIntro);
    setTimeout(() => showScreen('menu'), 250);
  }
}

window.addEventListener('load', () => {
  // Сразу показываем первую картинку
  if (introLayers.length > 0) {
    advanceIntro();
  }
  document.getElementById('intro').addEventListener('click', advanceIntro);
});

// =====================================================================
// SOCKET ПОДКЛЮЧЕНИЕ (отложенное — после клика "играть")
// =====================================================================
let socket = null;
let currentRoomId = null;

function connectSocket() {
  if (socket && socket.connected) return;
  socket = io({ transports: ['websocket', 'polling'] });

  socket.on('connect', () => console.log('socket connected', socket.id));

  socket.on('lobby', (data) => {
    currentRoomId = data.roomId;
    document.getElementById('lobby-room-id').textContent = data.roomId;
    renderLobbyPlayers(data.players);
  });

  socket.on('start', () => {
    showScreen('game');
    closeAllOverlays();
  });

  socket.on('state', (s) => {
    renderGameState(s);
  });

  socket.on('peek', (data) => {
    showPeek(data);
  });

  socket.on('rematch_pending', ({ count }) => {
    document.getElementById('result-pending').textContent =
      count === 1 ? 'Соперник, твой ход…' : '';
  });

  socket.on('opponent_left', () => {
    showToast('Соперник покинул игру');
    setTimeout(() => leaveToMenu(), 1500);
  });

  socket.on('error_msg', (msg) => showToast(msg));
}

// =====================================================================
// МЕНЮ
// =====================================================================
document.getElementById('btn-invite').addEventListener('click', () => {
  const roomId = generateRoomId();
  startGame(roomId, true /* invite */);
});
document.getElementById('btn-quick').addEventListener('click', () => {
  startGame('quick_' + Math.floor(Date.now() / 30000), false);
});

function generateRoomId() {
  return 'r' + Math.random().toString(36).slice(2, 8);
}

function startGame(roomId, isInvite) {
  connectSocket();
  currentRoomId = roomId;
  socket.emit('join', {
    roomId,
    user: { id: ME.id, name: ME.name, avatar: ME.avatar },
  });
  showScreen('lobby');
  document.getElementById('lobby-room-id').textContent = roomId;

  if (isInvite) {
    setTimeout(() => shareInvite(roomId), 300);
  }
}

function shareInvite(roomId) {
  const startParam = roomId;
  const BOT_USERNAME = 'YourBotName';   // <-- ЗАМЕНИ на username своего бота (без @)
  const APP_NAME    = 'play';           // <-- ЗАМЕНИ на короткое имя своего mini app
  const link = `https://t.me/${BOT_USERNAME}/${APP_NAME}?startapp=${startParam}`;
  const text = `Сразимся в Тёмной Дуэли? Жми, чтобы войти в комнату ${roomId}.`;

  if (tg?.openTelegramLink) {
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
    tg.openTelegramLink(shareUrl);
  } else {
    navigator.clipboard?.writeText(link);
    showToast('Ссылка скопирована');
  }
}

document.getElementById('lobby-share').addEventListener('click', () => {
  if (currentRoomId) shareInvite(currentRoomId);
});

document.getElementById('lobby-cancel').addEventListener('click', () => {
  leaveToMenu();
});

function renderLobbyPlayers(players) {
  const c = document.getElementById('lobby-players');
  c.innerHTML = '';
  for (const p of players) {
    const el = document.createElement('div');
    el.className = 'lobby-player';
    el.innerHTML = `
      <div class="lobby-player-avatar"${p.avatar ? ` style="background-image:url('${p.avatar}')"` : ''}></div>
      <div class="lobby-player-name">${escapeHtml(p.name)}</div>
    `;
    c.appendChild(el);
  }
  for (let i = players.length; i < 2; i++) {
    const el = document.createElement('div');
    el.className = 'lobby-player';
    el.style.opacity = '0.4';
    el.innerHTML = `
      <div class="lobby-player-avatar" style="border-style:dashed"></div>
      <div class="lobby-player-name">ожидание</div>
    `;
    c.appendChild(el);
  }
}

// Если пришли по ссылке с ?startapp=ROOMID — пропускаем интро и сразу в комнату
window.addEventListener('load', () => {
  const startParam = tg?.initDataUnsafe?.start_param;
  if (startParam) {
    setTimeout(() => {
      document.getElementById('intro').classList.remove('active');
      showScreen('menu');
      // Запускаем музыку немного позже (после первого взаимодействия)
      startGame(startParam, false);
    }, 100);
  }
});

// =====================================================================
// РЕНДЕР ИГРЫ
// =====================================================================
let lastState = null;
let mySelectedCardId = null;

function renderGameState(s) {
  const wasFirst = !lastState;
  lastState = s;

  document.getElementById('me-name').textContent = s.me?.name || 'Вы';
  document.getElementById('opp-name').textContent = s.opponent?.name || 'Соперник';
  document.getElementById('me-status').textContent = playerStatus(s.me, s, true);
  document.getElementById('opp-status').textContent = playerStatus(s.opponent, s, false);
  document.getElementById('deck-count').textContent = s.deckCount;

  // моя рука
  const myHand = document.getElementById('my-hand');
  myHand.innerHTML = '';
  if (s.me) {
    const isMyTurn = isMyTurnNow(s);
    s.me.hand.forEach((c, idx) => {
      const el = createCardEl(c, /* faceUp */ true);
      if (isMyTurn) {
        el.classList.add('playable');
        el.addEventListener('click', () => onMyCardClick(c));
        if (mySelectedCardId === c.id) el.classList.add('selected');
      }
      attachLongPress(el, c);
      if (wasFirst) {
        el.classList.add('dealing');
        el.style.animationDelay = `${idx * 0.18 + 0.2}s`;
      }
      myHand.appendChild(el);
    });
  }

  // рука соперника (рубашкой)
  const oppHand = document.getElementById('opp-hand');
  oppHand.innerHTML = '';
  if (s.opponent) {
    for (let i = 0; i < s.opponent.handCount; i++) {
      const el = createCardEl(null, /* faceUp */ false);
      el.classList.add('small');
      if (wasFirst) {
        el.classList.add('dealing');
        el.style.animationDelay = `${i * 0.18}s`;
      }
      oppHand.appendChild(el);
    }
  }

  renderDiscard('me-discard', s.me?.discard || []);
  renderDiscard('opp-discard', s.opponent?.discard || []);

  const logEl = document.getElementById('log');
  logEl.innerHTML = '';
  s.log.forEach((line, i) => {
    const d = document.createElement('div');
    d.className = 'log-line' + (i === s.log.length - 1 ? ' fresh' : '');
    d.textContent = line;
    logEl.appendChild(d);
  });
  logEl.scrollTop = logEl.scrollHeight;

  if (s.winner) {
    showResult(s.winner);
  } else {
    document.getElementById('result-overlay').classList.remove('show');
  }
}

function playerStatus(p, s, isMe) {
  if (!p) return '';
  if (p.eliminated) return 'выбыл';
  if (p.protected) return '✦ под защитой';
  if (isMyTurnNow(s) && isMe) return 'твой ход';
  if (!isMyTurnNow(s) && !isMe) return 'ходит';
  return '';
}

function isMyTurnNow(s) {
  if (!s.me) return false;
  const last = s.log[s.log.length - 1] || '';
  return last.includes(`Ходит ${s.me.name}`);
}

function renderDiscard(id, cards) {
  const el = document.getElementById(id);
  el.innerHTML = '';
  const slice = cards.slice(-5);
  for (const c of slice) {
    const card = createCardEl(c, true);
    card.classList.add('tiny');
    attachLongPress(card, c);
    el.appendChild(card);
  }
}

function createCardEl(card, faceUp) {
  const el = document.createElement('div');
  el.className = 'card' + (faceUp ? ' face-up' : '');
  if (faceUp && card) {
    // Имя файла: для карт с одним вариантом — "7.png", для остальных — "1_1.png"
    const def = CARDS[card.value];
    let imgSrc;
    if (card.value >= 6) {
      // 6, 7, 8 — по одному экземпляру, файл просто 6.png / 7.png / 8.png
      imgSrc = `assets/cards/${card.value}.png`;
    } else {
      imgSrc = `assets/cards/${card.value}_${card.art}.png`;
    }
    el.innerHTML = `
      <div class="card-back"><img src="assets/cards/back.png" onerror="this.style.display='none'" alt="" /></div>
      <div class="card-face">
        <img src="${imgSrc}" onerror="this.style.display='none'" alt="" />
        <div class="card-corner">${card.value}</div>
        <div class="card-corner br">${card.value}</div>
      </div>
    `;
  } else {
    // рубашка
    el.innerHTML = `
      <div class="card-back"><img src="assets/cards/back.png" onerror="this.style.display='none'" alt="" /></div>
      <div class="card-face"></div>
    `;
  }
  return el;
}

// Long-press для описания карты
function attachLongPress(el, card) {
  if (!card) return;
  let timer = null;
  const start = (e) => {
    timer = setTimeout(() => {
      e.preventDefault?.();
      showTooltip(card);
    }, 380);
  };
  const cancel = () => { if (timer) clearTimeout(timer); timer = null; };
  el.addEventListener('touchstart', start, { passive: true });
  el.addEventListener('touchend', cancel);
  el.addEventListener('touchmove', cancel);
  el.addEventListener('mousedown', start);
  el.addEventListener('mouseup', cancel);
  el.addEventListener('mouseleave', cancel);
}

function showTooltip(card) {
  const def = CARDS[card.value];
  document.getElementById('tt-name').textContent = def.name;
  document.getElementById('tt-value').textContent = `Карта ${card.value}`;
  document.getElementById('tt-desc').textContent = def.desc;
  document.getElementById('card-tooltip').classList.add('show');
  tg?.HapticFeedback?.impactOccurred?.('light');
}
document.getElementById('card-tooltip').addEventListener('click', () => {
  document.getElementById('card-tooltip').classList.remove('show');
});

// =====================================================================
// КЛИК ПО МОЕЙ КАРТЕ — играем её
// =====================================================================
function onMyCardClick(card) {
  if (!isMyTurnNow(lastState)) return;
  mySelectedCardId = card.id;
  if (card.value === 1) {
    openGuessModal(card);
  } else if (card.value === 5) {
    openTargetModal(card);
  } else {
    socket.emit('play', { cardId: card.id });
  }
}

function openGuessModal(card) {
  const modal = document.getElementById('action-modal');
  document.getElementById('action-title').textContent = 'Назови карту соперника';
  const opts = document.getElementById('action-options');
  opts.innerHTML = '';
  for (let v = 2; v <= 8; v++) {
    const def = CARDS[v];
    const o = document.createElement('div');
    o.className = 'action-option';
    o.innerHTML = `<span class="num">${v}</span>${def.name}`;
    o.addEventListener('click', () => {
      socket.emit('play', { cardId: card.id, guess: v });
      modal.classList.remove('show');
    });
    opts.appendChild(o);
  }
  modal.classList.add('show');
}

function openTargetModal(card) {
  const modal = document.getElementById('action-modal');
  document.getElementById('action-title').textContent = 'Кого заставить сбросить?';
  const opts = document.getElementById('action-options');
  opts.style.gridTemplateColumns = '1fr 1fr';
  opts.innerHTML = '';
  const oppName = lastState.opponent?.name || 'Соперник';
  const meName = lastState.me?.name || 'Я';
  for (const t of [
    { id: 'self', label: meName, sub: '(себя)' },
    { id: 'opp',  label: oppName, sub: '(соперника)' },
  ]) {
    const o = document.createElement('div');
    o.className = 'action-option';
    o.innerHTML = `<span class="num">★</span>${t.label}<br/><small style="opacity:0.6">${t.sub}</small>`;
    o.addEventListener('click', () => {
      socket.emit('play', { cardId: card.id, target: t.id });
      modal.classList.remove('show');
      opts.style.gridTemplateColumns = 'repeat(3, 1fr)';
    });
    opts.appendChild(o);
  }
  modal.classList.add('show');
}

document.getElementById('action-cancel').addEventListener('click', () => {
  document.getElementById('action-modal').classList.remove('show');
  document.getElementById('action-options').style.gridTemplateColumns = 'repeat(3, 1fr)';
  mySelectedCardId = null;
});

// =====================================================================
// PEEK
// =====================================================================
function showPeek(data) {
  const card = createCardEl(data.card, true);
  const wrap = document.getElementById('peek-card');
  wrap.innerHTML = '';
  wrap.appendChild(card);
  document.getElementById('peek-overlay').classList.add('show');
  tg?.HapticFeedback?.impactOccurred?.('medium');
}
document.getElementById('peek-close').addEventListener('click', () => {
  document.getElementById('peek-overlay').classList.remove('show');
});

// =====================================================================
// РЕЗУЛЬТАТ И РЕВАНШ
// =====================================================================
function showResult(winner) {
  const overlay = document.getElementById('result-overlay');
  const meWon = winner.userId === ME.id;
  overlay.classList.toggle('lose', !meWon);
  document.getElementById('result-title').textContent = meWon ? 'Победа' : 'Поражение';
  document.getElementById('result-text').textContent = meWon
    ? `Тёмная сторона улыбнулась тебе.`
    : `Сегодня твой соперник оказался хитрее.`;
  document.getElementById('result-glyph').textContent = '✦';
  document.getElementById('result-pending').textContent = '';
  overlay.classList.add('show');
  tg?.HapticFeedback?.notificationOccurred?.(meWon ? 'success' : 'error');
}

document.getElementById('btn-rematch').addEventListener('click', () => {
  socket.emit('rematch');
  document.getElementById('result-pending').textContent = 'Ждём соперника…';
});

document.getElementById('btn-to-menu').addEventListener('click', () => {
  leaveToMenu();
});

function leaveToMenu() {
  if (socket) {
    socket.emit('leave');
    socket.disconnect();
    socket = null;
  }
  currentRoomId = null;
  lastState = null;
  closeAllOverlays();
  showScreen('menu');
}

function closeAllOverlays() {
  for (const id of ['action-modal', 'peek-overlay', 'result-overlay', 'card-tooltip']) {
    document.getElementById(id).classList.remove('show');
  }
}

// =====================================================================
// УТИЛИТЫ
// =====================================================================
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
