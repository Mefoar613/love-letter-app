// =====================================================================
// Тёмная Дуэль — Frontend v3.6 (Фикс ссылки + Тряска + Прозрачный финал)
// =====================================================================
const tg = window.Telegram?.WebApp;
if (tg) { 
  tg.ready(); 
  tg.expand(); 
  tg.setHeaderColor?.('#08050f'); 
  tg.setBackgroundColor?.('#08050f'); 
}

// РЕАЛЬНАЯ ССЫЛКА НА ТВОЕГО БОТА
const BOT_LINK = "https://t.me/PumpHuntRealBot/POGNALI";

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

// --- Звуки и Вибро ---
const bgm = document.getElementById('bgm');
bgm.volume = 0.35;
let musicStarted = false;
function startMusic() { if (!musicStarted) { musicStarted = true; bgm.play().catch(()=>{}); } }

function triggerVibe(type = 'medium') {
  if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred(type);
}

function shakeScreen() {
  const gameEl = document.getElementById('game');
  gameEl.classList.remove('shake-screen');
  void gameEl.offsetWidth; // Магия для перезапуска анимации
  gameEl.classList.add('shake-screen');
  triggerVibe('heavy');
}

// --- Навигация ---
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id===id));
}

let introStep = 0;
const introLayers = document.querySelectorAll('.intro-layer');
function advanceIntro() {
  startMusic();
  if (introStep < introLayers.length) {
    introLayers[introStep].classList.add('show');
    introStep++;
  } else {
    showScreen('menu');
  }
}
document.getElementById('intro').addEventListener('click', advanceIntro);

// --- Сокеты ---
let socket = null, currentRoomId = null;
function connectSocket() {
  if (socket?.connected) return;
  socket = io();
  socket.on('lobby', d => { currentRoomId=d.roomId; renderLobbyPlayers(d.players); });
  socket.on('start', () => { showScreen('game'); resetState(); });
  socket.on('state', s => handleNewState(s));
  socket.on('peek', d => showPeek(d));
  socket.on('chancellor_choice', d => showChancellor(d.cards));
  socket.on('error_msg', m => showToast(m));
}

// ИНВАЙТ С РЕАЛЬНОЙ ССЫЛКОЙ
function shareInvite(roomId) {
  const link = `${BOT_LINK}?startapp=${roomId}`;
  if (tg?.openTelegramLink) {
    tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Погнали в Дуэль!')}`);
  } else {
    navigator.clipboard.writeText(link);
    showToast('Ссылка скопирована!');
  }
}

document.getElementById('btn-invite').addEventListener('click', () => enterGame('r'+Math.random().toString(36).slice(2,8), true));
document.getElementById('btn-quick').addEventListener('click', () => enterGame('quick', false));
function enterGame(roomId, isInvite) {
  connectSocket();
  socket.emit('join', { roomId, user:ME });
  showScreen('lobby');
  document.getElementById('lobby-room-id').textContent = roomId;
  if (isInvite) setTimeout(() => shareInvite(roomId), 300);
}

// --- Рендеринг игры ---
let lastState = null;
let stateQueue = [];
let busyAnimating = false;

function handleNewState(s) {
  if (busyAnimating) { stateQueue.push(s); return; }
  processState(s);
}

function processState(s) {
  const isFirst = !lastState;
  // Проверка: выбыл ли я в этом стейте?
  if (lastState && lastState.me && !lastState.me.eliminated && s.me && s.me.eliminated) {
    shakeScreen(); // Трясем экран при вылете!
  }
  
  lastState = s;
  renderState(s, isFirst);
}

function renderState(s, isFirst) {
  // Аватары и имена
  document.getElementById('me-name').textContent = s.me.name;
  document.getElementById('opp-name').textContent = s.opponent.name;
  if (s.me.avatar) document.getElementById('me-avatar').style.backgroundImage = `url(${s.me.avatar})`;
  if (s.opponent.avatar) document.getElementById('opp-avatar').style.backgroundImage = `url(${s.opponent.avatar})`;

  // Жетончики
  renderTokens('me-tokens', s.me.tokens);
  renderTokens('opp-tokens', s.opponent.tokens);

  // Статусы
  document.getElementById('me-status').textContent = s.isMyTurn ? 'твой ход' : (s.me.protected ? 'защита' : '');
  document.getElementById('opp-status').textContent = !s.isMyTurn ? 'ходит...' : (s.opponent.protected ? 'защита' : '');

  // Карты
  renderMyHand(s);
  renderOpponentHand(s);
  renderDiscard('me-discard', s.me.discard);
  renderDiscard('opp-discard', s.opponent.discard);
  renderExcluded(s.excludedCards);

  // Лог и колода
  document.getElementById('deck-count-badge').textContent = s.deckCount;
  updateLogStrip(s.log);

  // Финалы
  if (s.gameOver) showGameOver(s.gameOver);
  else if (s.roundOver) showRoundOver(s.roundOver);
  else {
    document.getElementById('round-over').classList.remove('show');
  }
}

function renderTokens(id, count) {
  const el = document.getElementById(id);
  el.innerHTML = '';
  for (let i=0; i<6; i++) {
    const s = document.createElement('span');
    s.className = `token ${i < count ? 'earned' : 'empty'}`;
    s.textContent = '◆';
    el.appendChild(s);
  }
}

function renderMyHand(s) {
  const zone = document.getElementById('my-card-zone');
  zone.innerHTML = '';
  s.me.hand.forEach(c => {
    const wrap = document.createElement('div');
    wrap.className = 'play-arrow-wrap';
    const card = makeCard(c, true, 'card--big');
    if (s.isMyTurn) card.classList.add('my-turn-glow');
    
    // Бейдж "Видено"
    const seen = s.me.seenCounts[c.value] || 0;
    const badge = document.createElement('div');
    badge.className = 'card-seen-badge';
    badge.textContent = `${seen}/${CARDS[c.value].total}`;
    card.appendChild(badge);

    card.onclick = () => openZoom(c);
    
    if (s.isMyTurn) {
      const arrow = document.createElement('div');
      arrow.className = 'play-arrow';
      arrow.onclick = (e) => { e.stopPropagation(); playCard(c); };
      wrap.appendChild(arrow);
    }
    wrap.appendChild(card);
    zone.appendChild(wrap);
  });
}

function renderOpponentHand(s) {
  const zone = document.getElementById('opp-card-zone');
  zone.innerHTML = '';
  for (let i=0; i<s.opponent.handCount; i++) {
    const card = makeCard(null, false, 'card--opp');
    if (!s.isMyTurn) card.classList.add('opp-turn-glow');
    zone.appendChild(card);
  }
}

function makeCard(card, faceUp, sizeClass) {
  const el = document.createElement('div');
  el.className = `card ${sizeClass} ${faceUp ? 'face-up' : ''}`;
  el.innerHTML = `
    <div class="card-back"><img src="assets/cards/back.png"></div>
    <div class="card-face">${card ? `<img src="assets/cards/${card.value}.png">` : ''}</div>
  `;
  return el;
}

function playCard(card) {
  if (card.value === 1) openGuessModal(card);
  else if (card.value === 5) openTargetModal(card);
  else socket.emit('play', { cardId: card.id });
}

function openGuessModal(card) {
  const modal = document.getElementById('action-modal');
  const grid = document.getElementById('action-options');
  grid.innerHTML = '';
  for (let i=0; i<=9; i++) {
    if (i === 1) continue;
    const opt = document.createElement('div');
    opt.className = 'am-opt';
    const seen = lastState.me.seenCounts[i] || 0;
    opt.innerHTML = `<span class="num">${i}</span>${CARDS[i].name}<br/><small>Видено: ${seen}/${CARDS[i].total}</small>`;
    opt.onclick = () => { socket.emit('play', { cardId:card.id, guess:i }); modal.classList.remove('show'); };
    grid.appendChild(opt);
  }
  modal.classList.add('show');
}

function openTargetModal(card) {
  const modal = document.getElementById('target-modal');
  const grid = document.getElementById('target-options');
  grid.innerHTML = '';
  const targets = [
    { id:'self', name:'На себя' },
    { id:'opp',  name: lastState.opponent.name }
  ];
  targets.forEach(t => {
    const opt = document.createElement('div');
    opt.className = 'am-opt';
    opt.innerHTML = `<span class="num">★</span>${t.name}`;
    opt.onclick = () => { socket.emit('play', { cardId:card.id, target:t.id }); modal.classList.remove('show'); };
    grid.appendChild(opt);
  });
  modal.classList.add('show');
}

function showRoundOver(ro) {
  const overlay = document.getElementById('round-over');
  const inner = overlay.querySelector('.ro-inner');
  const iWon = ro.winnerId === ME.id;
  
  inner.className = `ro-inner ${iWon ? '' : 'loss'}`;
  document.getElementById('ro-title').textContent = iWon ? 'Раунд твой!' : 'Ты выбываешь';
  document.getElementById('ro-sub').textContent = iWon ? `${ro.loserName} не справился` : 'Тебя раскрыли';
  document.getElementById('ro-tokens-row').innerHTML = `Жетоны: ${ro.winnerName} <strong>${ro.winnerTokens}</strong> — ${ro.loserName} <strong>${ro.loserTokens}</strong>`;
  
  overlay.classList.add('show');
  
  let sec = 4;
  const timerEl = document.getElementById('ro-timer');
  const inv = setInterval(() => {
    sec--;
    if (timerEl) timerEl.textContent = sec;
    if (sec <= 0) clearInterval(inv);
  }, 1000);
}

function showGameOver(go) {
  const overlay = document.getElementById('game-over');
  const iWon = go.winnerId === ME.id;
  document.getElementById('go-title').textContent = iWon ? 'ПОБЕДА В МАТЧЕ!' : 'ИГРА ОКОНЧЕНА';
  document.getElementById('go-tokens-row').innerHTML = `${go.winnerName} <strong>${go.winnerTokens}</strong> — ${go.loserName} <strong>${go.loserTokens}</strong>`;
  overlay.classList.add('show');
}

// --- Помогаторы ---
function updateLogStrip(log) {
  const l1 = document.getElementById('log-line-1');
  const l2 = document.getElementById('log-line-2');
  const last = log.slice(-2);
  l1.textContent = last[1] || '—';
  l2.textContent = last[0] || '';
}

function renderDiscard(id, cards) {
  const el = document.getElementById(id);
  el.innerHTML = '';
  cards.slice(-6).forEach(c => {
    const card = makeCard(c, true, 'card--sm');
    card.onclick = () => openZoom(c);
    el.appendChild(card);
  });
}

function renderExcluded(cards) {
  const el = document.getElementById('excluded-cards');
  el.innerHTML = '';
  cards.forEach(c => {
    const card = makeCard(c, true, 'card--sm card--exc');
    card.onclick = () => openZoom(c);
    el.appendChild(card);
  });
}

function openZoom(c) {
  const modal = document.getElementById('card-zoom');
  document.getElementById('cz-card-img').innerHTML = `<img src="assets/cards/${c.value}.png">`;
  document.getElementById('cz-name').textContent = CARDS[c.value].name;
  document.getElementById('cz-desc').textContent = CARDS[c.value].desc;
  document.getElementById('cz-seen').textContent = `Карта №${c.value}`;
  modal.classList.add('show');
}

function showPeek(d) {
  const modal = document.getElementById('peek-overlay');
  document.getElementById('peek-card').innerHTML = `<div class="card card--big face-up"><div class="card-face"><img src="assets/cards/${d.card.value}.png"></div></div>`;
  document.getElementById('peek-card-name').textContent = d.cardName;
  document.getElementById('peek-card-desc').textContent = CARDS[d.card.value].desc;
  modal.classList.add('show');
}

function showChancellor(cards) {
  const modal = document.getElementById('chancellor-modal');
  const grid = document.getElementById('chancellor-cards');
  grid.innerHTML = '';
  cards.forEach(c => {
    const opt = document.createElement('div');
    opt.className = 'chancellor-option';
    opt.innerHTML = `<div class="card card--big face-up"><div class="card-face"><img src="assets/cards/${c.value}.png"></div></div><div class="chancellor-choose-label">ВЫБРАТЬ</div>`;
    opt.onclick = () => { socket.emit('chancellor_pick', c.id); modal.classList.remove('show'); };
    grid.appendChild(opt);
  });
  modal.classList.add('show');
}

function resetState() { 
  lastState = null; 
  stateQueue = []; 
  busyAnimating = false; 
  document.querySelectorAll('.overlay').forEach(o => o.classList.remove('show'));
}

function showToast(m) {
  const t = document.getElementById('toast');
  t.textContent = m;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// Закрытие оверлеев по клику
document.getElementById('card-zoom').onclick = () => document.getElementById('card-zoom').classList.remove('show');
document.getElementById('peek-close').onclick = () => document.getElementById('peek-overlay').classList.remove('show');
document.getElementById('btn-rematch').onclick = () => socket.emit('rematch');
document.getElementById('btn-to-menu').onclick = () => window.location.reload();
document.getElementById('action-cancel').onclick = () => document.getElementById('action-modal').classList.remove('show');
document.getElementById('target-cancel').onclick = () => document.getElementById('target-modal').classList.remove('show');
