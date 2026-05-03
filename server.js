// =====================================================================
// Тёмная Дуэль — Backend v3.5 (Фикс счетчика карт)
// Правила: Love Letter 2019 Edition (21 карта, 2 игрока = 6 жетонов)
// =====================================================================
const express = require('express');
const http    = require('http');
const path    = require('path');
const { Server } = require('socket.io');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors:{ origin:'*', methods:['GET','POST'] } });

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, fp) {
    const t = {
      '.css':'text/css; charset=utf-8',
      '.js':'application/javascript; charset=utf-8',
      '.html':'text/html; charset=utf-8',
      '.json':'application/json',
      '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
      '.gif':'image/gif', '.webp':'image/webp', '.svg':'image/svg+xml',
      '.ico':'image/x-icon', '.mp3':'audio/mpeg', '.ogg':'audio/ogg',
      '.wav':'audio/wav', '.woff':'font/woff', '.woff2':'font/woff2',
    };
    const ext = path.extname(fp).toLowerCase();
    if (t[ext]) res.setHeader('Content-Type', t[ext]);
  }
}));
app.get('/health', (_, res) => res.send('ok'));

// ===================================================================
// НУАРНАЯ КОЛОДА (21 карта)
// ===================================================================
const CARD_DEFS = {
  0: { name:'Информатор',     count:2, ability:'При розыгрыше: ничего. Бонус: если в конце раунда ты единственный выживший с сыгранным Информатором — +1 жетон.' },
  1: { name:'Детектив',       count:6, ability:'Назови карту (не Детектив). Если у соперника она — он выбывает.' },
  2: { name:'Журналист',      count:2, ability:'Тайно посмотри карту в руке соперника.' },
  3: { name:'Громила',        count:2, ability:'Тайно сравни карты. У кого номинал меньше — выбывает. Ничья — все остаются.' },
  4: { name:'Продажный коп',  count:2, ability:'До своего следующего хода ты неуязвим для чужих эффектов.' },
  5: { name:'Федерал',        count:2, ability:'Выбери игрока (можно себя). Он сбрасывает карту и берёт новую. Если сброшен Компромат — он выбывает.' },
  6: { name:'Теневой брокер', count:2, ability:'Возьми 2 карты из колоды. Оставь 1, две другие верни вниз колоды в любом порядке.' },
  7: { name:'Босс мафии',     count:1, ability:'Поменяйся картами с другим игроком.' },
  8: { name:'Роковая женщина',count:1, ability:'Ничего не делает. Но: если на руке есть Федерал (5) или Босс мафии (7) — ОБЯЗАН сыграть Роковую женщину.' },
  9: { name:'Компромат',      count:1, ability:'Если сброшен по любой причине — ты немедленно выбываешь.' },
};

const WIN_TOKENS = 6;

// ===================================================================
// СТРОИМ КОЛОДУ
// ===================================================================
function buildDeck() {
  const deck = [];
  for (const [vs, def] of Object.entries(CARD_DEFS)) {
    const value = parseInt(vs, 10);
    for (let i = 0; i < def.count; i++) {
      deck.push({ value, id:`${value}_${i}_${Math.random().toString(36).slice(2,6)}` });
    }
  }
  shuffle(deck);
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length-1; i>0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]] = [arr[j],arr[i]];
  }
}

// ===================================================================
// УЧЁТ ПРОСМОТРЕННЫХ КАРТ (ФИКС ДВОЙНОГО СЧЕТА)
// Храним уникальные ID карт, чтобы не считать одну карту дважды
// ===================================================================
function addSeen(room, userId, card) {
  if (!card || card.value === undefined || !card.id) return;
  if (!room.seenCards) room.seenCards = {};
  if (!room.seenCards[userId]) room.seenCards[userId] = new Map();
  room.seenCards[userId].set(card.id, card.value);
}

function addSeenBoth(room, card) {
  if (!card) return;
  for (const p of room.players) addSeen(room, p.userId, card);
}

// ===================================================================
// КОМНАТЫ
// ===================================================================
const rooms = new Map();

class Room {
  constructor(id) {
    this.id = id;
    this.players = [];
    this.state = null;
    this.tokens = {};          
    this.seenCards = {};       // userId → Map(card.id → card.value)
    this.roundTimeout = null;
    this.rematchVotes = new Set();
  }
  
  addPlayer(p) {
    if (this.players.length >= 2) return false;
    const ex = this.players.find(x => x.userId === p.userId);
    if (ex) { ex.socketId = p.socketId; return true; }
    this.players.push(p);
    return true;
  }
  
  removeBySocket(sid) {
    this.players = this.players.filter(p => p.socketId !== sid);
  }

  publicState(forSocketId) {
    const s = this.state;
    if (!s) return null;
    const me  = s.players.find(p => p.socketId === forSocketId);
    const opp = s.players.find(p => p.socketId !== forSocketId);
    const myId = me?.userId;
    const cur  = s.players[s.turn];

    // Вычисляем seenCounts на лету из уникальных карт
    const mySeenMap = this.seenCards ? this.seenCards[myId] : null;
    const computedSeenCounts = {};
    if (mySeenMap) {
       for (const val of mySeenMap.values()) {
           computedSeenCounts[val] = (computedSeenCounts[val] || 0) + 1;
       }
    }

    return {
      isMyTurn:    cur?.socketId === forSocketId && !s.pendingChancellor && !s.roundOver && !s.gameOver,
      turnName:    cur?.name,
      log:         s.log.slice(-30),
      roundOver:   s.roundOver  || null,
      gameOver:    s.gameOver   || null,
      deckCount:   s.deck.length,
      excludedCards: s.excludedCards, 
      pendingChancellor: s.pendingChancellor?.socketId === forSocketId ? s.pendingChancellor.options : null,
      me: me && {
        name:      me.name,
        avatar:    me.avatar,
        hand:      me.hand,
        discard:   me.discard,
        protected: me.protected,
        eliminated:me.eliminated,
        tokens:    this.tokens[me.userId] || 0,
        seenCounts:computedSeenCounts,
      },
      opponent: opp && {
        name:      opp.name,
        avatar:    opp.avatar,
        handCount: opp.hand.length,
        discard:   opp.discard,
        protected: opp.protected,
        eliminated:opp.eliminated,
        tokens:    this.tokens[opp.userId] || 0,
      },
    };
  }
}

// ===================================================================
// ИГРОВАЯ ЛОГИКА — НАЧАЛО РАУНДА
// ===================================================================
function startRound(room, resetTokens = false) {
  if (room.roundTimeout) { clearTimeout(room.roundTimeout); room.roundTimeout = null; }

  if (resetTokens || Object.keys(room.tokens).length === 0) {
    for (const p of room.players) room.tokens[p.userId] = 0;
  }
  
  room.seenCards = {};
  for (const p of room.players) room.seenCards[p.userId] = new Map();

  const deck = buildDeck();

  const burned = deck.shift();

  const excludedCards = [];
  for (let i = 0; i < 3 && deck.length > 0; i++) {
    const c = deck.shift();
    excludedCards.push(c);
    addSeenBoth(room, c);
  }

  const players = room.players.map((p) => ({
    socketId:  p.socketId,
    userId:    p.userId,
    name:      p.name,
    avatar:    p.avatar || null,
    hand:      [],
    discard:   [],
    protected: false,
    eliminated:false,
    mustPlayCountess: false,
  }));

  for (const pl of players) {
    const c = deck.shift();
    pl.hand.push(c);
    addSeen(room, pl.userId, c);
  }
  const c2 = deck.shift();
  players[0].hand.push(c2);
  addSeen(room, players[0].userId, c2);
  updateCountess(players[0]);

  room.state = {
    deck, burned, excludedCards, players,
    turn: 0,
    log:  [],
    roundOver: null,
    gameOver:  null,
    pendingChancellor: null,
  };
  room.rematchVotes.clear();
}

function updateCountess(player) {
  const vals = player.hand.map(c => c.value);
  player.mustPlayCountess = vals.includes(8) && (vals.includes(5) || vals.includes(7));
}

// ===================================================================
// КОНЕЦ РАУНДА
// ===================================================================
function checkSpyBonus(room) {
  const s = room.state;
  const survivors = s.players.filter(p => !p.eliminated);
  const withSpy = survivors.filter(p => p.discard.some(c => c.value === 0));
  return withSpy.length === 1 ? withSpy[0].userId : null;
}

function endRound(room, winnerUserId) {
  const s = room.state;
  if (room.roundTimeout) return; 

  const winner = s.players.find(p => p.userId === winnerUserId);
  const loser  = s.players.find(p => p.userId !== winnerUserId);

  const revealedHands = {};
  for (const pl of s.players.filter(p => !p.eliminated)) {
    revealedHands[pl.userId] = pl.hand;
  }

  room.tokens[winnerUserId] = (room.tokens[winnerUserId] || 0) + 1;

  const spyBonus = checkSpyBonus(room);
  if (spyBonus) {
    room.tokens[spyBonus] = (room.tokens[spyBonus] || 0) + 1;
    const bonusName = room.players.find(p => p.userId === spyBonus)?.name;
    logMsg(room, `🃏 Бонус Информатора → +1 жетон ${bonusName}`);
  }

  const winnerTokens = room.tokens[winnerUserId];
  const loserTokens  = room.tokens[loser?.userId] || 0;

  if (winnerTokens >= WIN_TOKENS) {
    s.gameOver = {
      winnerId:    winnerUserId,
      winnerName:  winner?.name,
      loserName:   loser?.name,
      winnerTokens,
      loserTokens,
    };
  } else {
    s.roundOver = {
      winnerId:    winnerUserId,
      winnerName:  winner?.name,
      loserName:   loser?.name,
      winnerTokens,
      loserTokens,
      revealedHands,
      spyBonus,
    };
    room.roundTimeout = setTimeout(() => {
      startRound(room, false);
      io.to(room.id).emit('new_round');
      emitState(room);
    }, 4000);
  }
}

function nextTurn(room) {
  const s = room.state;
  if (s.roundOver || s.gameOver || s.pendingChancellor) return;

  const alive = s.players.filter(p => !p.eliminated);

  if (alive.length <= 1) {
    const winner = alive[0];
    if (winner) {
      logMsg(room, `🏆 ${winner.name} побеждает раунд — остался один.`);
      endRound(room, winner.userId);
    }
    return;
  }

  if (s.deck.length === 0) {
    const ranked = [...alive].sort((a,b) => b.hand[0]?.value - a.hand[0]?.value);
    if (ranked.length >= 2 && ranked[0].hand[0]?.value === ranked[1].hand[0]?.value) {
      const sum = p => p.discard.reduce((a,c) => a + c.value, 0);
      ranked.sort((a,b) => sum(b)-sum(a));
    }
    logMsg(room, `🃏 Колода исчерпана. Показываем карты.`);
    endRound(room, ranked[0].userId);
    return;
  }

  let next = (s.turn+1) % s.players.length;
  while (s.players[next].eliminated) next = (next+1) % s.players.length;
  s.turn = next;

  const cur = s.players[next];
  cur.protected = false;  

  const drawn = s.deck.shift();
  cur.hand.push(drawn);
  addSeen(room, cur.userId, drawn);
  updateCountess(cur);
}

// ===================================================================
// ПРИМЕНЕНИЕ КАРТЫ
// ===================================================================
function playCard(room, socketId, payload) {
  const s = room.state;
  if (!s || s.roundOver || s.gameOver) return { error:'Игра не активна.' };
  if (s.pendingChancellor) return { error:'Сначала выбери карту для руки (Теневой брокер).' };

  const me = s.players[s.turn];
  if (me.socketId !== socketId) return { error:'Сейчас не твой ход.' };

  const { cardId, target, guess } = payload;
  const idx = me.hand.findIndex(c => c.id === cardId);
  if (idx < 0) return { error:'Карты нет в руке.' };
  const card = me.hand[idx];

  if (me.mustPlayCountess && card.value !== 8)
    return { error:'На руке Роковая женщина (8) — обязан сыграть её.' };

  me.hand.splice(idx, 1);
  me.discard.push(card);
  addSeenBoth(room, card);
  logMsg(room, `${me.name} играет «${CARD_DEFS[card.value].name}» [${card.value}].`);

  const opp = s.players.find(p => p.socketId !== socketId && !p.eliminated);

  switch (card.value) {
    case 0: { 
      logMsg(room, `Информатор сыгран. Бонус считается в конце раунда.`);
      break;
    }
    case 1: { 
      if (!opp || opp.protected) { logMsg(room, opp ? `${opp.name} под защитой.`:'Нет цели.'); break; }
      if (guess === undefined || guess < 0 || guess > 9 || guess === 1)
        return rollback(room, me, card, 'Назови карту от 0 до 9 (не Детектив).');
      if (opp.hand[0]?.value === guess) {
        addSeenBoth(room, opp.hand[0]);
        opp.discard.push(...opp.hand.splice(0));
        opp.eliminated = true;
        logMsg(room, `🎯 Угадано! У ${opp.name} был ${CARD_DEFS[guess].name}. Выбывает.`);
      } else {
        logMsg(room, `Промах — у ${opp.name} нет ${CARD_DEFS[guess].name}.`);
      }
      break;
    }
    case 2: { 
      if (!opp || opp.protected) { logMsg(room, opp ? `${opp.name} под защитой.`:'Нет цели.'); break; }
      addSeen(room, me.userId, opp.hand[0]);
      io.to(me.socketId).emit('peek', {
        playerName: opp.name,
        card: opp.hand[0],
        cardName: CARD_DEFS[opp.hand[0]?.value]?.name,
      });
      logMsg(room, `${me.name} тайно смотрит карту ${opp.name}.`);
      break;
    }
    case 3: { 
      if (!opp || opp.protected) { logMsg(room, opp ? `${opp.name} под защитой.`:'Нет цели.'); break; }
      const mvCard = me.hand[0], ovCard = opp.hand[0];
      const mv = mvCard?.value, ov = ovCard?.value;
      if (mv === undefined || ov === undefined) break;
      if (mv > ov) {
        addSeenBoth(room, ovCard);
        opp.discard.push(...opp.hand.splice(0)); opp.eliminated = true;
        logMsg(room, `Разборка: ${me.name}(${mv}) > ${opp.name}(${ov}). ${opp.name} выбывает.`);
      } else if (mv < ov) {
        addSeenBoth(room, mvCard);
        me.discard.push(...me.hand.splice(0)); me.eliminated = true;
        logMsg(room, `Разборка: ${me.name}(${mv}) < ${opp.name}(${ov}). ${me.name} выбывает.`);
      } else {
        logMsg(room, `Разборка: ничья (${mv}=${ov}). Все остаются.`);
      }
      break;
    }
    case 4: { 
      me.protected = true;
      logMsg(room, `${me.name} под защитой Продажного копа до следующего хода.`);
      break;
    }
    case 5: { 
      const tgt = target === 'self' ? me : opp;
      if (!tgt) break;
      if (tgt.protected && tgt !== me) { logMsg(room, `${tgt.name} под защитой.`); break; }
      const dropped = tgt.hand.shift();
      tgt.discard.push(dropped);
      addSeenBoth(room, dropped);
      if (dropped?.value === 9) {
        tgt.eliminated = true;
        logMsg(room, `💀 ${tgt.name} сбросил Компромат — выбывает!`);
      } else {
        if (s.deck.length > 0) {
          const newCard = s.deck.shift();
          tgt.hand.push(newCard);
          addSeen(room, tgt.userId, newCard);
        } else if (s.burned) {
          tgt.hand.push(s.burned);
          addSeen(room, tgt.userId, s.burned);
          s.burned = null;
        }
        logMsg(room, `Облава! ${tgt.name} сбрасывает карту и берёт новую.`);
      }
      updateCountess(tgt);
      break;
    }
    case 6: { 
      const extra = [];
      if (s.deck.length > 0) extra.push(s.deck.shift());
      if (s.deck.length > 0) extra.push(s.deck.shift());
      const options = [...me.hand, ...extra];
      for (const c of options) addSeen(room, me.userId, c);
      s.pendingChancellor = { socketId, options };
      logMsg(room, `${me.name} изучает варианты Теневого брокера…`);
      io.to(socketId).emit('chancellor_choice', { cards: options });
      emitState(room); 
      return { ok: true };
    }
    case 7: { 
      if (!opp || opp.protected) { logMsg(room, opp ? `${opp.name} под защитой.`:'Нет цели.'); break; }
      if (me.hand[0]) addSeen(room, opp.userId, me.hand[0]);
      if (opp.hand[0]) addSeen(room, me.userId, opp.hand[0]);
      [me.hand, opp.hand] = [opp.hand, me.hand];
      updateCountess(me); updateCountess(opp);
      logMsg(room, `Дон приказал — ${me.name} и ${opp.name} меняются картами.`);
      break;
    }
    case 8: { 
      logMsg(room, `${me.name} избавляется от Роковой женщины.`);
      break;
    }
    case 9: { 
      me.eliminated = true;
      logMsg(room, `💀 ${me.name} сбросил Компромат — выбывает!`);
      break;
    }
  }

  me.mustPlayCountess = false;
  nextTurn(room);
  return { ok: true };
}

function rollback(room, me, card, errMsg) {
  me.discard.pop();
  me.hand.push(card);
  return { error: errMsg };
}

function logMsg(room, msg) { room.state.log.push(msg); }

// ===================================================================
// ОТПРАВКА СОСТОЯНИЯ
// ===================================================================
function emitState(room) {
  for (const p of room.players) {
    if (p.socketId) io.to(p.socketId).emit('state', room.publicState(p.socketId));
  }
}

// ===================================================================
// SOCKET.IO
// ===================================================================
io.on('connection', socket => {
  socket.on('join', ({ roomId, user }) => {
    if (!roomId || !user) return;
    let room = rooms.get(roomId);
    if (!room) { room = new Room(roomId); rooms.set(roomId, room); }

    const ok = room.addPlayer({
      socketId: socket.id, userId: user.id,
      name: user.name || 'Игрок', avatar: user.avatar || null,
    });
    if (!ok) { socket.emit('error_msg','Комната заполнена.'); return; }

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.userId = user.id;

    io.to(roomId).emit('lobby', {
      roomId,
      players: room.players.map(p => ({ name:p.name, avatar:p.avatar, userId:p.userId })),
    });

    if (room.players.length === 2 && !room.state) {
      startRound(room, true);
      io.to(roomId).emit('start');
      emitState(room);
    } else if (room.state) {
      emitState(room);
    }
  });

  socket.on('play', payload => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return;
    const result = playCard(room, socket.id, payload);
    if (result?.error) socket.emit('error_msg', result.error);
    else emitState(room);
  });

  socket.on('chancellor_pick', keepCardId => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return;
    const s = room.state;
    if (!s?.pendingChancellor || s.pendingChancellor.socketId !== socket.id) return;

    const { options } = s.pendingChancellor;
    const kept    = options.find(c => c.id === keepCardId);
    const returns = options.filter(c => c.id !== keepCardId);
    if (!kept) { socket.emit('error_msg','Неверный выбор.'); return; }

    const me = s.players.find(p => p.socketId === socket.id);
    me.hand = [kept];
    updateCountess(me);
    
    shuffle(returns);
    s.deck.push(...returns);
    s.pendingChancellor = null;
    logMsg(room, `${me.name} выбрал карту, вернул ${returns.length} в колоду.`);
    nextTurn(room);
    emitState(room);
  });

  socket.on('rematch', () => {
    const room = rooms.get(socket.data.roomId);
    if (!room || !room.state?.gameOver) return;
    room.rematchVotes.add(socket.data.userId);
    if (room.rematchVotes.size >= room.players.length) {
      startRound(room, true);
      io.to(room.id).emit('start');
      emitState(room);
    } else {
      io.to(room.id).emit('rematch_pending', { count: room.rematchVotes.size });
    }
  });

  socket.on('leave', () => cleanup(socket));
  socket.on('disconnect', () => {
    setTimeout(() => {
      const room = rooms.get(socket.data.roomId);
      if (room?.players.find(p => p.socketId === socket.id)) cleanup(socket);
    }, 30000);
  });
});

function cleanup(socket) {
  const room = rooms.get(socket.data.roomId);
  if (!room) return;
  room.removeBySocket(socket.id);
  if (room.players.length === 0) rooms.delete(room.id);
  else io.to(room.id).emit('opponent_left');
  socket.leave(socket.data.roomId);
  socket.data.roomId = null;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✨ Сервер запущен на порту ${PORT}`));
