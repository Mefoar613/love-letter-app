// =====================================================================
// Тёмная Дуэль — Frontend v3
// =====================================================================
const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor?.('#08050f'); tg.setBackgroundColor?.('#08050f'); }

const tgUser = tg?.initDataUnsafe?.user;
const ME = {
  id:     tgUser ? `tg_${tgUser.id}` : `g_${Math.random().toString(36).slice(2,9)}`,
  name:   tgUser ? [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') : 'Гость',
  avatar: tgUser?.photo_url || null,
};

// Описания карт (нуарный сеттинг, 0-9)
const CARDS = {
  0: { name:'Информатор',      total:2, desc:'Ничего не делает при розыгрыше. Если в конце раунда ты единственный выживший с сыгранным Информатором — получи +1 жетон.' },
  1: { name:'Детектив',        total:6, desc:'Назови карту (не Детектив). Если у соперника она — он выбывает.' },
  2: { name:'Журналист',       total:2, desc:'Тайно посмотри карту в руке соперника.' },
  3: { name:'Громила',         total:2, desc:'Сравните карты тайно. У кого номинал ниже — выбывает. При ничьей никто не выбывает.' },
  4: { name:'Продажный коп',   total:2, desc:'До начала своего следующего хода ты под защитой — чужие карты на тебя не действуют.' },
  5: { name:'Федерал',         total:2, desc:'Выбери игрока (себя или соперника). Он сбрасывает карту и берёт новую. Если сброшен Компромат — он выбывает.' },
  6: { name:'Теневой брокер',  total:2, desc:'Возьми 2 карты из колоды. Оставь 1 из трёх себе, остальные верни вниз колоды в любом порядке.' },
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
    o.type = 'triangle';
    o.frequency.setValueAtTime(800, now);
    o.frequency.exponentialRampToValueAtTime(380, now+.07);
    g.gain.setValueAtTime(.13, now);
    g.gain.exponentialRampToValueAtTime(.001, now+.09);
    o.start(now); o.stop(now+.1);
  } catch(e) {}
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
  socket.on('start', () => { showScreen('game'); closeAllOverlays(); resetState(); });
  socket.on('new_round', () => { closeAllOverlays(); stopRoundTimer(); });
  socket.on('state', s => renderState(s));
  socket.on('peek', d => showPeek(d));
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
  const BOT = 'YourBotName'; const APP = 'play'; // ← замени
  const link = `https://t.me/${BOT}/${APP}?startapp=${roomId}`;
  if (tg?.openTelegramLink) tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(`Дуэль! Комната ${roomId}`)}`);
  else { navigator.clipboard?.writeText(link); showToast('Ссылка скопирована'); }
}
document.getElementById('lobby-share').addEventListener('click', () => { if(currentRoomId) shareInvite(currentRoomId); });
document.getElementById('lobby-cancel').addEventListener('click', leaveToMenu);
function renderLobbyPlayers(players) {
  const c = document.getElementById('lobby-players'); c.innerHTML = '';
  for (let i=0;i<2;i++) {
    const p = players[i], el = document.createElement('div');
    el.className='lobby-player';
    if (p) el.innerHTML=`<div class="lobby-player-avatar"${p.avatar?` style="background-image:url('${p.avatar}')"`:''}></div><div class="lobby-player-name">${esc(p.name)}</div>`;
    else { el.style.opacity='.4'; el.innerHTML='<div class="lobby-player-avatar" style="border-style:dashed"></div><div class="lobby-player-name">ожидание</div>'; }
    c.appendChild(el);
  }
}

// ─── ИГРОВОЕ СОСТОЯНИЕ ───
let lastState = null;
let pendingCard = null;  // карта, ожидающая выбора цели/угадывания
let roundTimerInterval = null;
function resetState() { lastState=null; pendingCard=null; stopRoundTimer(); }

// ─── ГЛАВНЫЙ РЕНДЕР ───
function renderState(s) {
  const first = !lastState;
  lastState = s;

  // Имена/статусы
  document.getElementById('me-name').textContent  = s.me?.name  || 'Вы';
  document.getElementById('opp-name').textContent = s.opponent?.name || 'Соперник';
  document.getElementById('me-status').textContent  = s.isMyTurn ? 'твой ход' : (s.me?.protected?'под защитой':'');
  document.getElementById('opp-status').textContent = !s.isMyTurn ? 'ходит' : (s.opponent?.protected?'под защитой':'');

  // Аватары
  const setAv = (id, url) => { if (url) document.getElementById(id).style.backgroundImage = `url('${url}')`; };
  setAv('me-avatar', s.me?.avatar);
  setAv('opp-avatar', s.opponent?.avatar);

  // Жетоны
  renderTokens('me-tokens',  s.me?.tokens  || 0);
  renderTokens('opp-tokens', s.opponent?.tokens || 0);

  // Карты
  renderOppCard(s, first);
  renderMyCards(s, first);

  // Исключённые карты
  renderExcluded(s.excludedCards || []);

  // Сбросы
  renderDiscard('me-discard',  s.me?.discard  || []);
  renderDiscard('opp-discard', s.opponent?.discard || []);

  // Счётчик колоды
  document.getElementById('deck-count-badge').textContent = s.deckCount;

  // Лог (2 последних события)
  updateLogStrip(s.log);

  // Результаты
  if (s.gameOver) { stopRoundTimer(); showGameOver(s.gameOver); }
  else if (s.roundOver) showRoundOver(s.roundOver);
  else { document.getElementById('round-over').classList.remove('show'); document.getElementById('game-over').classList.remove('show'); }
}

// ─── ЛОГ ───
function updateLogStrip(log) {
  // log-line-1 = последнее событие, log-line-2 = предыдущее
  const relevant = log.filter(Boolean);
  document.getElementById('log-line-1').textContent = relevant[relevant.length-1] || '—';
  document.getElementById('log-line-2').textContent = relevant[relevant.length-2] || '';
}
document.getElementById('log-strip').addEventListener('click', () => {
  if (!lastState) return;
  const list = document.getElementById('lo-list'); list.innerHTML = '';
  [...lastState.log].reverse().forEach(line => {
    const d = document.createElement('div'); d.className='lo-entry'; d.textContent=line; list.appendChild(d);
  });
  document.getElementById('log-overlay').classList.add('show');
});
document.getElementById('log-overlay').addEventListener('click', () => document.getElementById('log-overlay').classList.remove('show'));

// ─── ЖЕТОНЫ ───
let prevTokens = {};
function renderTokens(id, count) {
  const el = document.getElementById(id); if (!el) return;
  const prev = prevTokens[id] ?? 0;
  prevTokens[id] = count;
  let html = '';
  for (let i=0; i<6; i++) {
    const earned = i < count;
    const newlyEarned = earned && i >= prev;
    html += `<span class="token ${earned?'earned':'empty'}${newlyEarned?' new-earn':''}" title="${earned?'жетон':'пусто'}">◆</span>`;
  }
  el.innerHTML = html;
}

// ─── КАРТА СОПЕРНИКА ───
function renderOppCard(s, first) {
  const zone = document.getElementById('opp-card-zone'); zone.innerHTML='';
  if (!s.opponent || s.opponent.handCount === 0) return;
  const card = makeCard(null, false, 'card--opp');
  if (first) { card.classList.add('dealing'); card.style.animationDelay='0s'; }
  zone.appendChild(card);
}

// ─── МОИ КАРТЫ ───
function renderMyCards(s, first) {
  const zone = document.getElementById('my-card-zone'); zone.innerHTML='';
  if (!s.me?.hand?.length) return;
  const myTurn = s.isMyTurn;
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:16px;align-items:flex-end;';
  s.me.hand.forEach((c, idx) => {
    const wrap = document.createElement('div'); wrap.className='play-arrow-wrap';
    if (myTurn) {
      const arrow = document.createElement('div');
      arrow.className='play-arrow'; arrow.title='Сыграть';
      arrow.addEventListener('click', e => { e.stopPropagation(); onPlay(c); });
      wrap.appendChild(arrow);
    }
    const cardEl = makeCard(c, true, 'card--big');
    if (myTurn) cardEl.classList.add('my-turn-glow');
    if (first)  { cardEl.classList.add('dealing'); cardEl.style.animationDelay=`${idx*.18+.1}s`; }
    // Бейдж «видено/всего»
    const seen = (s.me?.seenCounts || {})[c.value] || 0;
    const total = CARDS[c.value]?.total || '?';
    const badge = document.createElement('div'); badge.className='card-seen-badge';
    badge.textContent = `${seen}/${total}`;
    cardEl.appendChild(badge);
    cardEl.addEventListener('click', e => { e.stopPropagation(); openZoom(c, s.me?.seenCounts || {}); });
    wrap.appendChild(cardEl); row.appendChild(wrap);
  });
  zone.appendChild(row);
}

// ─── СОЗДАНИЕ ЭЛЕМЕНТА КАРТЫ ───
function makeCard(card, faceUp, sizeClass) {
  const el = document.createElement('div');
  el.className = `card ${sizeClass||'card--big'}${faceUp?' face-up':''}`;
  const back = document.createElement('div'); back.className='card-back';
  const bi = document.createElement('img'); bi.src='assets/cards/back.png'; bi.onerror=()=>bi.style.display='none'; bi.alt='';
  back.appendChild(bi); el.appendChild(back);
  const face = document.createElement('div'); face.className='card-face';
  if (card) {
    const img = document.createElement('img');
    img.src = `assets/cards/${card.value}.png`;
    img.onerror = () => img.style.display='none'; img.alt='';
    face.appendChild(img);
    const tl = document.createElement('div'); tl.className='card-corner tl'; tl.textContent=card.value;
    const br = document.createElement('div'); br.className='card-corner br'; br.textContent=card.value;
    face.appendChild(tl); face.appendChild(br);
  }
  el.appendChild(face);
  return el;
}

// ─── СБРОС ───
function renderDiscard(id, cards) {
  const el = document.getElementById(id); el.innerHTML='';
  cards.slice(-7).forEach(c => {
    const card = makeCard(c, true, 'card--sm');
    card.addEventListener('click', () => openZoom(c, lastState?.me?.seenCounts||{}));
    el.appendChild(card);
  });
}

// ─── ИСКЛЮЧЁННЫЕ КАРТЫ ───
function renderExcluded(cards) {
  const el = document.getElementById('excluded-cards'); el.innerHTML='';
  cards.forEach(c => {
    const card = makeCard(c, true, 'card--exc');
    card.addEventListener('click', () => openZoom(c, lastState?.me?.seenCounts||{}));
    el.appendChild(card);
  });
}

// ─── СЫГРАТЬ КАРТУ ───
function onPlay(card) {
  if (!lastState?.isMyTurn) return;
  pendingCard = card;
  if (card.value === 1) openGuessModal(card);
  else if (card.value === 5) openTargetModal(card);
  else { socket.emit('play', { cardId:card.id }); pendingCard=null; }
}

// Детектив (1): угадать карту
function openGuessModal(card) {
  const el = document.getElementById('action-modal');
  const grid = document.getElementById('action-options'); grid.innerHTML='';
  // Все карты кроме Детектива (1)
  for (let v=0; v<=9; v++) {
    if (v===1) continue;
    const opt = document.createElement('div'); opt.className='am-opt';
    opt.innerHTML=`<span class="num">${v}</span>${CARDS[v].name}`;
    opt.addEventListener('click', () => {
      socket.emit('play', { cardId:card.id, guess:v });
      pendingCard=null; el.classList.remove('show');
    });
    grid.appendChild(opt);
  }
  el.classList.add('show');
}

// Федерал (5): выбрать цель
function openTargetModal(card) {
  const el = document.getElementById('target-modal');
  const opts = document.getElementById('target-options'); opts.innerHTML='';
  const me  = lastState?.me?.name  || 'Я';
  const opp = lastState?.opponent?.name || 'Соперник';
  [{ id:'self', label:me, sub:'себя' }, { id:'opp', label:opp, sub:'соперника' }].forEach(t => {
    const o = document.createElement('div'); o.className='am-opt';
    o.innerHTML=`<span class="num">★</span>${esc(t.label)}<br/><small style="opacity:.5;font-size:9px">${t.sub}</small>`;
    o.addEventListener('click', () => {
      socket.emit('play', { cardId:card.id, target:t.id });
      pendingCard=null; el.classList.remove('show');
    });
    opts.appendChild(o);
  });
  el.classList.add('show');
}

document.getElementById('action-cancel').addEventListener('click', () => { pendingCard=null; document.getElementById('action-modal').classList.remove('show'); });
document.getElementById('target-cancel').addEventListener('click', () => { pendingCard=null; document.getElementById('target-modal').classList.remove('show'); });

// ─── ТЕНЕВОЙ БРОКЕР (Chancellor/6): выбор карты ───
function showChancellor(cards) {
  const el = document.getElementById('chancellor-modal');
  const wrap = document.getElementById('chancellor-cards'); wrap.innerHTML='';
  cards.forEach(c => {
    const opt = document.createElement('div'); opt.className='chancellor-option';
    const cardEl = makeCard(c, true, 'card--big');
    const lbl = document.createElement('div'); lbl.className='chancellor-choose-label'; lbl.textContent='Выбрать';
    opt.addEventListener('click', () => {
      socket.emit('chancellor_pick', c.id);
      el.classList.remove('show');
    });
    opt.appendChild(cardEl); opt.appendChild(lbl);
    wrap.appendChild(opt);
  });
  el.classList.add('show');
}

// ─── ЗУМ КАРТЫ ───
function openZoom(card, seenCounts) {
  if (!card) return;
  const def = CARDS[card.value];
  const wrap = document.getElementById('cz-card-img'); wrap.innerHTML='';
  const img = document.createElement('img'); img.src=`assets/cards/${card.value}.png`; img.onerror=()=>img.style.display='none'; img.alt='';
  wrap.appendChild(img);
  const cn = document.createElement('div'); cn.className='card-corner tl'; cn.textContent=card.value; wrap.appendChild(cn);
  document.getElementById('cz-name').textContent  = def.name;
  document.getElementById('cz-value').textContent = `Карта ${card.value}`;
  document.getElementById('cz-desc').textContent  = def.desc;
  const seen = (seenCounts||{})[card.value] || 0;
  document.getElementById('cz-seen').textContent  = `Видено: ${seen} из ${def.total}`;
  document.getElementById('card-zoom').classList.add('show');
}
document.getElementById('card-zoom').addEventListener('click', () => document.getElementById('card-zoom').classList.remove('show'));

// ─── КНОПКА КОЛОДЫ: полное распределение ───
document.getElementById('deck-btn').addEventListener('click', e => {
  e.stopPropagation();
  const grid = document.getElementById('do-grid'); grid.innerHTML='';
  // Показываем ВСЕ карты (всего в игре), не зависимо от остатка
  for (let v=0; v<=9; v++) {
    const def = CARDS[v];
    const row = document.createElement('div'); row.className='do-row';
    const mini = document.createElement('div'); mini.className='do-mini';
    const img = document.createElement('img'); img.src=`assets/cards/${v}.png`; img.onerror=()=>img.style.display='none'; img.alt='';
    mini.appendChild(img);
    const info = document.createElement('div'); info.className='do-info';
    info.innerHTML=`<div class="do-name">${def.name}</div><div class="do-cnt">${def.total}</div>`;
    row.appendChild(mini); row.appendChild(info); grid.appendChild(row);
  }
  document.getElementById('deck-overlay').classList.add('show');
});
document.getElementById('deck-overlay').addEventListener('click', () => document.getElementById('deck-overlay').classList.remove('show'));

// ─── PEEK (Журналист/2) ───
function showPeek(data) {
  const wrap = document.getElementById('peek-card'); wrap.innerHTML='';
  if (data.card) {
    const card = makeCard(data.card, true, 'card--big'); wrap.appendChild(card);
    document.getElementById('peek-title').textContent = `У ${data.playerName}: ${data.cardName}`;
  }
  document.getElementById('peek-overlay').classList.add('show');
  tg?.HapticFeedback?.impactOccurred?.('medium');
}
document.getElementById('peek-close').addEventListener('click', () => document.getElementById('peek-overlay').classList.remove('show'));

// ─── КОНЕЦ РАУНДА ───
let roundTimerVal = 4;
function showRoundOver(ro) {
  stopRoundTimer();
  const overlay = document.getElementById('round-over');
  const iWon = ro.winnerId === ME.id;
  document.getElementById('ro-glyph').textContent = iWon ? '✦' : '✗';
  document.getElementById('ro-glyph').style.color = iWon ? 'var(--gold)' : 'var(--red-b)';
  document.getElementById('ro-title').textContent = iWon ? 'Раунд ваш!' : 'Раунд потерян';
  document.getElementById('ro-sub').textContent = iWon
    ? `${esc(ro.loserName)} теряет позиции`
    : `Вы теряете позиции`;
  document.getElementById('ro-tokens-row').innerHTML =
    `<span>${esc(ro.winnerName)}: <strong>${ro.winnerTokens} ◆</strong></span>
     <span style="margin:0 8px;opacity:.4">|</span>
     <span>${esc(ro.loserName)}: <strong>${ro.loserTokens} ◆</strong></span>`;
  overlay.classList.add('show');
  tg?.HapticFeedback?.notificationOccurred?.(iWon?'success':'error');
  roundTimerVal = 4;
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

// ─── КОНЕЦ ИГРЫ ───
function showGameOver(go) {
  stopRoundTimer();
  const overlay = document.getElementById('game-over');
  const iWon = go.winnerId === ME.id;
  document.getElementById('go-glyph').textContent = iWon ? '✦' : '✗';
  document.getElementById('go-title').textContent = iWon ? 'Победа!' : 'Поражение';
  document.getElementById('go-sub').textContent = iWon
    ? `${esc(go.loserName)} разоблачён.`
    : `Ваши связи уничтожены.`;
  document.getElementById('go-tokens-row').innerHTML =
    `<span>${esc(go.winnerName)}: <strong>${go.winnerTokens} ◆</strong></span>
     <span style="margin:0 8px;opacity:.4">|</span>
     <span>${esc(go.loserName)}: <strong>${go.loserTokens} ◆</strong></span>`;
  document.getElementById('go-pending').textContent = '';
  overlay.classList.add('show');
  tg?.HapticFeedback?.notificationOccurred?.(iWon?'success':'error');
}
document.getElementById('btn-rematch').addEventListener('click', () => {
  socket.emit('rematch');
  document.getElementById('go-pending').textContent = 'Ждём соперника…';
});
document.getElementById('btn-to-menu').addEventListener('click', leaveToMenu);

// ─── ВСПОМОГАТЕЛЬНЫЕ ───
function leaveToMenu() {
  stopRoundTimer();
  socket?.emit('leave'); socket?.disconnect(); socket=null;
  currentRoomId=null; resetState(); closeAllOverlays(); showScreen('menu');
}
function closeAllOverlays() { document.querySelectorAll('.overlay').forEach(o => o.classList.remove('show')); }
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}
function esc(s) {
  return String(s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
