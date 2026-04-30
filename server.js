// =====================================================================
// Love Letter Mini App — Backend (Node.js + Socket.IO)
// =====================================================================
// Хранит лобби, игровое состояние, валидирует ходы на сервере (важно,
// иначе клиент мог бы читерить — видеть карты соперника и т.п.).
// =====================================================================

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Раздача статики (фронтенд)
app.use(express.static(path.join(__dirname, 'public')));

// Простой healthcheck (нужен для Render/Railway)
app.get('/health', (_, res) => res.send('ok'));

// =====================================================================
// Конфигурация колоды
// =====================================================================
// 16 карт. Карты, у которых несколько артов, имеют varianty: 1.1, 1.2 …
const CARD_DEFS = {
  1: { name: 'Обстоятельства',  count: 5, variants: 5, ability: 'Назови карту (не «Обстоятельства»). Если у соперника она — он выбывает.' },
  2: { name: 'Свидетель',       count: 2, variants: 2, ability: 'Посмотри карту в руке соперника.' },
  3: { name: 'Дуэлянт',         count: 2, variants: 2, ability: 'Сравните карты. У кого ниже — выбывает.' },
  4: { name: 'Защитник',        count: 2, variants: 2, ability: 'До своего следующего хода ты неуязвим.' },
  5: { name: 'Палач',           count: 2, variants: 2, ability: 'Выбери игрока — он сбрасывает карту и берёт новую.' },
  6: { name: 'Заговорщик',      count: 1, variants: 1, ability: 'Обменяйся картами с выбранным игроком.' },
  7: { name: 'Вдова',           count: 1, variants: 1, ability: 'Если на руке также 5 или 6 — обязана быть сброшена. Эффекта нет.' },
  8: { name: 'Императрица',     count: 1, variants: 1, ability: 'Если сброшена по любой причине — ты выбываешь из раунда.' },
};

function buildDeck() {
  // Возвращаем массив карт вида { value, art } где art — индекс варианта.
  // Каждый вариант используется не более одного раза за раунд.
  const deck = [];
  for (const [valueStr, def] of Object.entries(CARD_DEFS)) {
    const value = parseInt(valueStr, 10);
    // Готовим пул вариантов и тасуем
    const variantPool = [];
    for (let v = 1; v <= def.variants; v++) variantPool.push(v);
    shuffle(variantPool);
    // На случай если count > variants — повторяем варианты по кругу
    for (let i = 0; i < def.count; i++) {
      const art = variantPool[i % variantPool.length];
      deck.push({ value, art, id: `${value}_${art}_${i}_${Math.random().toString(36).slice(2, 7)}` });
    }
  }
  shuffle(deck);
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// =====================================================================
// Хранилище комнат
// =====================================================================
const rooms = new Map(); // roomId -> Room

class Room {
  constructor(id) {
    this.id = id;
    this.players = []; // [{ socketId, userId, name, avatar, ready }]
    this.state = null; // игровое состояние (см. startGame)
    this.rematchVotes = new Set();
  }

  addPlayer(p) {
    if (this.players.length >= 2) return false;
    if (this.players.find(x => x.userId === p.userId)) {
      // переподключение
      const existing = this.players.find(x => x.userId === p.userId);
      existing.socketId = p.socketId;
      return true;
    }
    this.players.push(p);
    return true;
  }

  removeBySocket(socketId) {
    this.players = this.players.filter(p => p.socketId !== socketId);
  }

  publicState(forSocketId) {
    if (!this.state) return null;
    const me = this.state.players.find(p => p.socketId === forSocketId);
    const opp = this.state.players.find(p => p.socketId !== forSocketId);
    return {
      turn: this.state.turn,
      deckCount: this.state.deck.length,
      log: this.state.log.slice(-15),
      pendingAction: this.state.pendingAction,
      winner: this.state.winner,
      me: me && {
        name: me.name,
        hand: me.hand,
        discard: me.discard,
        protected: me.protected,
        eliminated: me.eliminated,
      },
      opponent: opp && {
        name: opp.name,
        handCount: opp.hand.length,
        discard: opp.discard,
        protected: opp.protected,
        eliminated: opp.eliminated,
      },
    };
  }
}

// =====================================================================
// Игровая логика
// =====================================================================
function startGame(room) {
  const deck = buildDeck();
  // 1 карта откладывается лицом вниз
  const burned = deck.shift();
  const players = room.players.map(p => ({
    socketId: p.socketId,
    userId: p.userId,
    name: p.name,
    hand: [deck.shift()],
    discard: [],
    protected: false,
    eliminated: false,
    mustPlayCountess: false,
  }));
  // Первый игрок берёт карту сразу
  players[0].hand.push(deck.shift());

  room.state = {
    deck,
    burned,
    players,
    turn: 0, // индекс ходящего
    log: [`Раздача завершена. Ходит ${players[0].name}.`],
    pendingAction: null, // для карт, требующих выбор цели/угадывания
    winner: null,
  };
  room.rematchVotes.clear();
}

function emitState(room) {
  for (const p of room.players) {
    io.to(p.socketId).emit('state', room.publicState(p.socketId));
  }
}

function logMsg(room, msg) {
  room.state.log.push(msg);
}

function nextTurn(room) {
  const s = room.state;
  if (s.winner) return;

  const alive = s.players.filter(p => !p.eliminated);
  if (alive.length === 1) {
    s.winner = { type: 'last', userId: alive[0].userId, name: alive[0].name };
    logMsg(room, `🏆 ${alive[0].name} побеждает: соперник выбыл.`);
    return;
  }
  if (s.deck.length === 0) {
    // Сравнить руки
    const ranked = [...alive].sort((a, b) => b.hand[0].value - a.hand[0].value);
    if (ranked.length >= 2 && ranked[0].hand[0].value === ranked[1].hand[0].value) {
      // ничья по сумме сброса
      const sum = p => p.discard.reduce((a, c) => a + c.value, 0);
      ranked.sort((a, b) => sum(b) - sum(a));
    }
    s.winner = { type: 'showdown', userId: ranked[0].userId, name: ranked[0].name };
    logMsg(room, `🏆 Колода исчерпана. Побеждает ${ranked[0].name}.`);
    return;
  }

  // Передаём ход
  let next = (s.turn + 1) % s.players.length;
  while (s.players[next].eliminated) next = (next + 1) % s.players.length;
  s.turn = next;

  const cur = s.players[next];
  cur.protected = false; // защита снимается на твоём ходу
  cur.hand.push(s.deck.shift());

  // Проверка обязательного сброса Вдовы (карта 7 при наличии 5 или 6)
  const has7 = cur.hand.find(c => c.value === 7);
  const has5or6 = cur.hand.find(c => c.value === 5 || c.value === 6);
  cur.mustPlayCountess = !!(has7 && has5or6);

  logMsg(room, `Ходит ${cur.name}.`);
}

// Применение карты
function playCard(room, socketId, payload) {
  const s = room.state;
  if (!s || s.winner) return { error: 'Игра окончена.' };
  const me = s.players[s.turn];
  if (me.socketId !== socketId) return { error: 'Сейчас не твой ход.' };
  if (s.pendingAction) return { error: 'Заверши текущее действие.' };

  const { cardId, target, guess } = payload;
  const cardIdx = me.hand.findIndex(c => c.id === cardId);
  if (cardIdx < 0) return { error: 'Карты нет в руке.' };
  const card = me.hand[cardIdx];

  // Правило Вдовы: если на руке 7 + (5 или 6), нужно сыграть 7
  if (me.mustPlayCountess && card.value !== 7) {
    return { error: 'У тебя на руке Вдова, обязана сбросить её.' };
  }

  // Удаляем карту из руки и кладём в сброс
  me.hand.splice(cardIdx, 1);
  me.discard.push(card);
  logMsg(room, `${me.name} играет «${CARD_DEFS[card.value].name}» (${card.value}.${card.art}).`);

  const opp = s.players.find(p => p.socketId !== socketId && !p.eliminated);

  // === Эффекты карт ===
  switch (card.value) {
    case 1: { // Обстоятельства — угадай карту соперника
      if (!opp) break;
      if (opp.protected) { logMsg(room, `${opp.name} защищён, эффект пропадает.`); break; }
      if (!guess || guess < 2 || guess > 8) return rollback(room, me, card, 'Нужно назвать карту от 2 до 8.');
      if (opp.hand[0].value === guess) {
        opp.eliminated = true;
        opp.discard.push(...opp.hand.splice(0));
        logMsg(room, `🎯 Угадано! ${opp.name} выбывает (была ${CARD_DEFS[guess].name}).`);
      } else {
        logMsg(room, `Промах. У соперника не ${CARD_DEFS[guess].name}.`);
      }
      break;
    }
    case 2: { // Свидетель — посмотреть руку соперника
      if (!opp || opp.protected) { logMsg(room, opp ? `${opp.name} защищён.` : 'Цели нет.'); break; }
      // Передаём приватно ходящему игроку
      io.to(me.socketId).emit('peek', {
        playerName: opp.name,
        card: opp.hand[0],
        cardName: CARD_DEFS[opp.hand[0].value].name,
      });
      logMsg(room, `${me.name} тайно смотрит карту соперника.`);
      break;
    }
    case 3: { // Дуэлянт — сравнить
      if (!opp || opp.protected) { logMsg(room, opp ? `${opp.name} защищён.` : 'Цели нет.'); break; }
      const myCard = me.hand[0];
      const oppCard = opp.hand[0];
      if (myCard.value > oppCard.value) {
        opp.eliminated = true;
        opp.discard.push(...opp.hand.splice(0));
        logMsg(room, `${me.name} (${myCard.value}) > ${opp.name} (${oppCard.value}). Соперник выбывает.`);
      } else if (myCard.value < oppCard.value) {
        me.eliminated = true;
        me.discard.push(...me.hand.splice(0));
        logMsg(room, `${me.name} (${myCard.value}) < ${opp.name} (${oppCard.value}). ${me.name} выбывает.`);
      } else {
        logMsg(room, `Ничья (${myCard.value} = ${oppCard.value}). Все остаются в игре.`);
      }
      break;
    }
    case 4: { // Защитник
      me.protected = true;
      logMsg(room, `${me.name} под защитой до следующего хода.`);
      break;
    }
    case 5: { // Палач — заставляем сбросить и взять новую (можно цель: я или соперник)
      const targetPlayer = target === 'self' ? me : opp;
      if (!targetPlayer) break;
      if (targetPlayer.protected && targetPlayer !== me) {
        logMsg(room, `${targetPlayer.name} защищён.`);
        break;
      }
      const dropped = targetPlayer.hand.shift();
      targetPlayer.discard.push(dropped);
      if (dropped.value === 8) {
        targetPlayer.eliminated = true;
        logMsg(room, `${targetPlayer.name} вынужден сбросить Императрицу и выбывает!`);
      } else {
        if (s.deck.length > 0) {
          targetPlayer.hand.push(s.deck.shift());
        } else if (s.burned) {
          targetPlayer.hand.push(s.burned);
          s.burned = null;
        }
        logMsg(room, `${targetPlayer.name} сбрасывает карту и берёт новую.`);
      }
      break;
    }
    case 6: { // Заговорщик — обмен
      if (!opp || opp.protected) { logMsg(room, opp ? `${opp.name} защищён.` : 'Цели нет.'); break; }
      const tmp = me.hand;
      me.hand = opp.hand;
      opp.hand = tmp;
      logMsg(room, `${me.name} и ${opp.name} обменялись картами.`);
      break;
    }
    case 7: { // Вдова — эффекта нет
      logMsg(room, `${me.name} сбрасывает Вдову.`);
      break;
    }
    case 8: { // Императрица — самосброс ведёт к поражению
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
  // Возвращаем карту в руку (если игрок сделал недопустимый ход)
  me.discard.pop();
  me.hand.push(card);
  return { error: errMsg };
}

// =====================================================================
// Socket.IO события
// =====================================================================
io.on('connection', (socket) => {
  // join: { roomId, user: { id, name, avatar } }
  socket.on('join', ({ roomId, user }) => {
    if (!roomId || !user) return;
    let room = rooms.get(roomId);
    if (!room) {
      room = new Room(roomId);
      rooms.set(roomId, room);
    }
    const ok = room.addPlayer({
      socketId: socket.id,
      userId: user.id,
      name: user.name || 'Игрок',
      avatar: user.avatar || null,
      ready: false,
    });
    if (!ok) {
      socket.emit('error_msg', 'Комната заполнена.');
      return;
    }
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.userId = user.id;

    io.to(roomId).emit('lobby', {
      roomId,
      players: room.players.map(p => ({ name: p.name, avatar: p.avatar, userId: p.userId })),
    });

    // Если 2 игрока — стартуем
    if (room.players.length === 2 && !room.state) {
      startGame(room);
      io.to(roomId).emit('start');
      emitState(room);
    } else if (room.state) {
      // переподключение
      emitState(room);
    }
  });

  socket.on('play', (payload) => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return;
    const result = playCard(room, socket.id, payload);
    if (result.error) {
      socket.emit('error_msg', result.error);
    }
    emitState(room);
  });

  socket.on('rematch', () => {
    const room = rooms.get(socket.data.roomId);
    if (!room || !room.state || !room.state.winner) return;
    room.rematchVotes.add(socket.data.userId);
    if (room.rematchVotes.size === room.players.length) {
      startGame(room);
      io.to(room.id).emit('start');
      emitState(room);
    } else {
      io.to(room.id).emit('rematch_pending', { count: room.rematchVotes.size });
    }
  });

  socket.on('leave', () => {
    const room = rooms.get(socket.data.roomId);
    if (room) {
      room.removeBySocket(socket.id);
      if (room.players.length === 0) rooms.delete(room.id);
      else io.to(room.id).emit('opponent_left');
    }
    socket.leave(socket.data.roomId);
    socket.data.roomId = null;
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomId);
    if (room) {
      // Не удаляем сразу — даём 30с на переподключение
      setTimeout(() => {
        const stillThere = room.players.find(p => p.socketId === socket.id);
        if (stillThere) {
          room.removeBySocket(socket.id);
          if (room.players.length === 0) rooms.delete(room.id);
          else io.to(room.id).emit('opponent_left');
        }
      }, 30000);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✨ Love Letter сервер запущен на порту ${PORT}`);
});
