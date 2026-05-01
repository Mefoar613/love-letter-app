// =====================================================================
// Love Letter Mini App — Backend
// =====================================================================
const express = require('express');
const http    = require('http');
const path    = require('path');
const { Server } = require('socket.io');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] },
});

// MIME-типы явно — иначе Render отдаёт CSS как text/plain
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    const mime = {
      '.css':'.css','.js':'.js','.html':'.html',
    };
    const types = {
      '.css':'text/css; charset=utf-8',
      '.js':'application/javascript; charset=utf-8',
      '.html':'text/html; charset=utf-8',
      '.json':'application/json',
      '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg',
      '.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml',
      '.ico':'image/x-icon',
      '.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav',
      '.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf',
    };
    if (types[ext]) res.setHeader('Content-Type', types[ext]);
  },
}));

app.get('/health', (_,res) => res.send('ok'));

// ===== КОЛОДА =====
const CARD_DEFS = {
  1: { name:'Обстоятельства', count:5, variants:5, ability:'Назови карту (не «Обстоятельства»). Если у соперника она — он выбывает.' },
  2: { name:'Свидетель',      count:2, variants:2, ability:'Посмотри карту в руке соперника.' },
  3: { name:'Дуэлянт',        count:2, variants:2, ability:'Сравните карты. У кого ниже — выбывает.' },
  4: { name:'Защитник',       count:2, variants:2, ability:'До следующего своего хода ты неуязвим.' },
  5: { name:'Палач',          count:2, variants:2, ability:'Выбери игрока — он сбрасывает карту и берёт новую.' },
  6: { name:'Заговорщик',     count:1, variants:1, ability:'Обменяйся картами с соперником.' },
  7: { name:'Вдова',          count:1, variants:1, ability:'Если на руке также 5 или 6 — обязана быть сброшена. Эффекта нет.' },
  8: { name:'Императрица',    count:1, variants:1, ability:'Если сброшена по любой причине — ты выбываешь.' },
};

function buildDeck() {
  const deck = [];
  for (const [vs, def] of Object.entries(CARD_DEFS)) {
    const value = parseInt(vs, 10);
    const pool = Array.from({length: def.variants}, (_,i) => i+1);
    shuffle(pool);
    for (let i = 0; i < def.count; i++) {
      const art = pool[i % pool.length];
      deck.push({ value, art, id: `${value}_${art}_${Math.random().toString(36).slice(2,7)}` });
    }
  }
  shuffle(deck);
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]] = [arr[j],arr[i]];
  }
}

function deckByValue(deck) {
  const counts = {};
  for (const c of deck) counts[c.value] = (counts[c.value]||0)+1;
  return counts;
}

// ===== КОМНАТЫ =====
const rooms = new Map();

class Room {
  constructor(id) {
    this.id = id;
    this.players = [];
    this.state = null;
    this.hearts = {};          // userId → int (7 макс)
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
    return {
      turn:      s.turn,
      deckCount: s.deck.length,
      deckByValue: deckByValue(s.deck),
      log:       s.log.slice(-20),
      roundOver: s.roundOver || null,
      gameOver:  s.gameOver  || null,
      me: me && {
        name:      me.name,
        avatar:    me.avatar,
        hand:      me.hand,
        discard:   me.discard,
        protected: me.protected,
        eliminated:me.eliminated,
        hearts:    this.hearts[me.userId] ?? 7,
      },
      opponent: opp && {
        name:      opp.name,
        avatar:    opp.avatar,
        handCount: opp.hand.length,
        discard:   opp.discard,
        protected: opp.protected,
        eliminated:opp.eliminated,
        hearts:    this.hearts[opp.userId] ?? 7,
      },
    };
  }
}

// ===== ИГРОВАЯ ЛОГИКА =====

function startRound(room, resetHearts = false) {
  if (room.roundTimeout) { clearTimeout(room.roundTimeout); room.roundTimeout = null; }

  const deck = buildDeck();
  const burned = deck.shift();

  // Инициализируем или сбрасываем сердца
  if (resetHearts || Object.keys(room.hearts).length === 0) {
    for (const p of room.players) room.hearts[p.userId] = 7;
  }

  const players = room.players.map(p => ({
    socketId: p.socketId,
    userId:   p.userId,
    name:     p.name,
    avatar:   p.avatar || null,
    hand:     [deck.shift()],
    discard:  [],
    protected:   false,
    eliminated:  false,
    mustPlayCountess: false,
  }));

  // Первый игрок сразу берёт карту
  players[0].hand.push(deck.shift());

  room.state = {
    deck, burned, players,
    turn: 0,
    log: [`Новый раунд! Ходит ${players[0].name}.`],
    roundOver: null,
    gameOver:  null,
  };
  room.rematchVotes.clear();
}

function emitState(room) {
  for (const p of room.players) {
    const sid = p.socketId;
    if (sid) io.to(sid).emit('state', room.publicState(sid));
  }
}

function logMsg(room, msg) { room.state.log.push(msg); }

function endRound(room, winnerUserId) {
  const s = room.state;
  const winnerPlayer = s.players.find(p => p.userId === winnerUserId);
  const loserPlayer  = s.players.find(p => p.userId !== winnerUserId);

  if (!loserPlayer || !winnerPlayer) return;

  // Вычитаем сердце у проигравшего
  room.hearts[loserPlayer.userId] = (room.hearts[loserPlayer.userId] ?? 7) - 1;

  const loserHearts = room.hearts[loserPlayer.userId];

  if (loserHearts <= 0) {
    // Игра окончена
    s.gameOver = {
      winnerId:   winnerPlayer.userId,
      winnerName: winnerPlayer.name,
      loserName:  loserPlayer.name,
    };
    s.roundOver = null;
  } else {
    // Просто раунд окончен
    s.roundOver = {
      winnerId:   winnerPlayer.userId,
      winnerName: winnerPlayer.name,
      loserName:  loserPlayer.name,
      loserHearts,
    };
    // Через 3 сек автозапуск нового раунда
    room.roundTimeout = setTimeout(() => {
      startRound(room, false);
      io.to(room.id).emit('new_round');
      emitState(room);
    }, 3500);
  }
}

function nextTurn(room) {
  const s = room.state;
  if (s.roundOver || s.gameOver) return;

  const alive = s.players.filter(p => !p.eliminated);

  if (alive.length === 1) {
    logMsg(room, `🏆 ${alive[0].name} побеждает раунд: соперник выбыл.`);
    endRound(room, alive[0].userId);
    return;
  }
  if (s.deck.length === 0) {
    const ranked = [...alive].sort((a,b) => b.hand[0].value - a.hand[0].value);
    if (ranked.length>=2 && ranked[0].hand[0].value === ranked[1].hand[0].value) {
      const sum = p => p.discard.reduce((a,c)=>a+c.value,0);
      ranked.sort((a,b)=>sum(b)-sum(a));
    }
    logMsg(room, `🏆 Колода исчерпана. Побеждает раунд ${ranked[0].name}.`);
    endRound(room, ranked[0].userId);
    return;
  }

  let next = (s.turn+1) % s.players.length;
  while (s.players[next].eliminated) next = (next+1) % s.players.length;
  s.turn = next;

  const cur = s.players[next];
  cur.protected = false;
  cur.hand.push(s.deck.shift());

  const has7    = cur.hand.find(c=>c.value===7);
  const has5or6 = cur.hand.find(c=>c.value===5||c.value===6);
  cur.mustPlayCountess = !!(has7 && has5or6);

  logMsg(room, `Ходит ${cur.name}.`);
}

function playCard(room, socketId, payload) {
  const s = room.state;
  if (!s || s.roundOver || s.gameOver) return { error: 'Игра не активна.' };

  const me = s.players[s.turn];
  if (me.socketId !== socketId) return { error: 'Сейчас не твой ход.' };

  const { cardId, target, guess } = payload;
  const idx = me.hand.findIndex(c => c.id === cardId);
  if (idx < 0) return { error: 'Карты нет в руке.' };
  const card = me.hand[idx];

  if (me.mustPlayCountess && card.value !== 7)
    return { error: 'У тебя Вдова — обязан сбросить её.' };

  me.hand.splice(idx, 1);
  me.discard.push(card);
  logMsg(room, `${me.name} играет «${CARD_DEFS[card.value].name}».`);

  const opp = s.players.find(p => p.socketId !== socketId && !p.eliminated);

  switch (card.value) {
    case 1: {
      if (!opp || opp.protected) { logMsg(room, opp ? `${opp.name} защищён.` : 'Нет цели.'); break; }
      if (!guess || guess<2 || guess>8) return rollback(room, me, card, 'Назови карту от 2 до 8.');
      if (opp.hand[0]?.value === guess) {
        opp.eliminated = true;
        opp.discard.push(...opp.hand.splice(0));
        logMsg(room, `🎯 Угадано! ${opp.name} выбывает.`);
      } else {
        logMsg(room, `Промах. У соперника не ${CARD_DEFS[guess].name}.`);
      }
      break;
    }
    case 2: {
      if (!opp || opp.protected) { logMsg(room, opp ? `${opp.name} защищён.` : 'Нет цели.'); break; }
      io.to(me.socketId).emit('peek', {
        playerName: opp.name,
        card: opp.hand[0],
        cardName: CARD_DEFS[opp.hand[0]?.value]?.name,
      });
      logMsg(room, `${me.name} смотрит карту соперника.`);
      break;
    }
    case 3: {
      if (!opp || opp.protected) { logMsg(room, opp ? `${opp.name} защищён.` : 'Нет цели.'); break; }
      const mv = me.hand[0]?.value, ov = opp.hand[0]?.value;
      if (mv > ov) {
        opp.eliminated = true; opp.discard.push(...opp.hand.splice(0));
        logMsg(room, `${me.name} (${mv}) > ${opp.name} (${ov}). Соперник выбывает.`);
      } else if (mv < ov) {
        me.eliminated = true; me.discard.push(...me.hand.splice(0));
        logMsg(room, `${me.name} (${mv}) < ${opp.name} (${ov}). ${me.name} выбывает.`);
      } else {
        logMsg(room, `Ничья (${mv}=${ov}).`);
      }
      break;
    }
    case 4: {
      me.protected = true;
      logMsg(room, `${me.name} под защитой.`);
      break;
    }
    case 5: {
      const tgt = target === 'self' ? me : opp;
      if (!tgt) break;
      if (tgt.protected && tgt !== me) { logMsg(room,`${tgt.name} защищён.`); break; }
      const dropped = tgt.hand.shift();
      tgt.discard.push(dropped);
      if (dropped?.value === 8) {
        tgt.eliminated = true;
        logMsg(room, `${tgt.name} сбрасывает Императрицу и выбывает!`);
      } else {
        if (s.deck.length>0) tgt.hand.push(s.deck.shift());
        else if (s.burned) { tgt.hand.push(s.burned); s.burned=null; }
        logMsg(room, `${tgt.name} сбрасывает карту и берёт новую.`);
      }
      break;
    }
    case 6: {
      if (!opp || opp.protected) { logMsg(room, opp?`${opp.name} защищён.`:'Нет цели.'); break; }
      [me.hand, opp.hand] = [opp.hand, me.hand];
      logMsg(room, `${me.name} и ${opp.name} обменялись картами.`);
      break;
    }
    case 7: { logMsg(room, `${me.name} сбрасывает Вдову.`); break; }
    case 8: {
      me.eliminated = true;
      logMsg(room, `💔 ${me.name} сбросил Императрицу и проигрывает.`);
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

// ===== SOCKET.IO =====
io.on('connection', socket => {
  socket.on('join', ({ roomId, user }) => {
    if (!roomId || !user) return;
    let room = rooms.get(roomId);
    if (!room) { room = new Room(roomId); rooms.set(roomId, room); }

    const ok = room.addPlayer({ socketId:socket.id, userId:user.id, name:user.name||'Игрок', avatar:user.avatar||null });
    if (!ok) { socket.emit('error_msg','Комната заполнена.'); return; }

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.userId = user.id;

    io.to(roomId).emit('lobby', {
      roomId,
      players: room.players.map(p=>({name:p.name, avatar:p.avatar, userId:p.userId})),
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
    if (result.error) socket.emit('error_msg', result.error);
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
      if (room?.players.find(p=>p.socketId===socket.id)) {
        cleanup(socket);
      }
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
