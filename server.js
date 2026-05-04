// =====================================================================
// Тёмная Дуэль — Server v4 | MongoDB, Lobbies, Bot AI, Card Backs
// =====================================================================
const express  = require('express');
const http     = require('http');
const path     = require('path');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors:{ origin:'*' } });

// ─── MIME-типы ───
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, fp) {
    const t = {
      '.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8',
      '.html':'text/html; charset=utf-8','.json':'application/json',
      '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg',
      '.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml',
      '.ico':'image/x-icon','.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav',
    };
    const ext = path.extname(fp).toLowerCase();
    if (t[ext]) res.setHeader('Content-Type', t[ext]);
  }
}));
app.get('/health', (_,r) => r.send('ok'));

// ═════════════════════════════════════════════════════════════════════
// MONGODB
// ═════════════════════════════════════════════════════════════════════
const MONGO_URI = process.env.MONGO_URI || '';

const playerSchema = new mongoose.Schema({
  odlId:        { type:String, unique:true, required:true }, // tg_123 or g_xxx
  name:         String,
  avatar:       String,
  wins:         { type:Number, default:0 },
  losses:       { type:Number, default:0 },
  selectedBack: { type:String, default:'back' }, // имя файла без .png
}, { timestamps:true });

let Player = null;

async function connectDB() {
  if (!MONGO_URI) {
    console.log('⚠ MONGO_URI не задан — БД отключена, данные в памяти.');
    return;
  }
  try {
    await mongoose.connect(MONGO_URI);
    Player = mongoose.model('Player', playerSchema);
    console.log('✅ MongoDB подключена');
  } catch(e) {
    console.log('⚠ MongoDB ошибка:', e.message, '— данные в памяти.');
  }
}

// in-memory fallback
const memoryPlayers = new Map();

async function getPlayer(userId) {
  if (Player) {
    let p = await Player.findOne({ odlId:userId });
    if (!p) p = await Player.create({ odlId:userId, name:'Игрок', selectedBack:'back' });
    return p;
  }
  if (!memoryPlayers.has(userId)) {
    memoryPlayers.set(userId, { odlId:userId, name:'Игрок', wins:0, losses:0, selectedBack:'back' });
  }
  return memoryPlayers.get(userId);
}

async function savePlayer(userId, data) {
  if (Player) {
    await Player.updateOne({ odlId:userId }, { $set:data }, { upsert:true });
  } else {
    const p = memoryPlayers.get(userId) || { odlId:userId };
    Object.assign(p, data);
    memoryPlayers.set(userId, p);
  }
}

// ═════════════════════════════════════════════════════════════════════
// КАРТЫ
// ═════════════════════════════════════════════════════════════════════
const CARD_DEFS = {
  0:{ name:'Информатор',      count:2 },
  1:{ name:'Детектив',        count:6 },
  2:{ name:'Журналист',       count:2 },
  3:{ name:'Громила',         count:2 },
  4:{ name:'Продажный коп',   count:2 },
  5:{ name:'Федерал',         count:2 },
  6:{ name:'Теневой брокер',  count:2 },
  7:{ name:'Босс мафии',      count:1 },
  8:{ name:'Роковая женщина', count:1 },
  9:{ name:'Компромат',       count:1 },
};
const WIN_TOKENS = 6;

function buildDeck() {
  const deck = [];
  for (const [v, def] of Object.entries(CARD_DEFS)) {
    for (let i=0; i<def.count; i++)
      deck.push({ value:+v, id:`${v}_${i}_${Math.random().toString(36).slice(2,6)}` });
  }
  shuffle(deck);
  return deck;
}
function shuffle(a) { for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]; }}

// ═════════════════════════════════════════════════════════════════════
// СИСТЕМА ЛОББИ
// ═════════════════════════════════════════════════════════════════════
const lobbies = new Map(); // lobbyId → Lobby

class Lobby {
  constructor(id, creator) {
    this.id = id;
    this.creatorId = creator.userId;
    this.players = [creator]; // { userId, name, avatar, socketId, isBot, back }
    this.maxPlayers = 2;
    this.started = false;
    this.createdAt = Date.now();
  }
  addPlayer(p) {
    if (this.players.length >= this.maxPlayers) return false;
    if (this.players.find(x => x.userId === p.userId)) return true;
    this.players.push(p);
    return true;
  }
  removePlayer(userId) {
    this.players = this.players.filter(p => p.userId !== userId);
  }
  isFull() { return this.players.length >= this.maxPlayers; }
  toPublic() {
    return {
      id: this.id,
      creatorName: this.players[0]?.name || '?',
      playerCount: this.players.length,
      maxPlayers: this.maxPlayers,
      started: this.started,
      players: this.players.map(p => ({
        name: p.name, avatar: p.avatar, isBot: !!p.isBot, userId: p.userId,
      })),
    };
  }
}

function broadcastLobbies() {
  const list = [];
  for (const [,l] of lobbies) {
    if (!l.started) list.push(l.toPublic());
  }
  io.emit('lobby_list', list);
}

// ═════════════════════════════════════════════════════════════════════
// ИГРОВЫЕ КОМНАТЫ (активные игры)
// ═════════════════════════════════════════════════════════════════════
const rooms = new Map();

class Room {
  constructor(id) {
    this.id = id;
    this.players = [];
    this.state = null;
    this.tokens = {};
    this.seenCounts = {};
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
    const cur = s.players[s.turn];
    return {
      isMyTurn:    cur?.socketId === forSocketId && !s.pendingChancellor && !s.roundOver && !s.gameOver,
      log:         s.log.slice(-30),
      roundOver:   s.roundOver || null,
      gameOver:    s.gameOver || null,
      deckCount:   s.deck.length,
      excludedCards: s.excludedCards,
      pendingChancellor: s.pendingChancellor?.socketId === forSocketId ? s.pendingChancellor.options : null,
      me: me && {
        name:me.name, avatar:me.avatar, hand:me.hand, discard:me.discard,
        protected:me.protected, eliminated:me.eliminated,
        tokens:this.tokens[me.userId]||0,
        seenCounts:this.seenCounts[me.userId]||{},
        back: me.back || 'back',
      },
      opponent: opp && {
        name:opp.name, avatar:opp.avatar, handCount:opp.hand.length,
        discard:opp.discard, protected:opp.protected, eliminated:opp.eliminated,
        tokens:this.tokens[opp.userId]||0,
        isBot: !!opp.isBot,
        back: opp.back || 'back',
      },
    };
  }
}

// ═════════════════════════════════════════════════════════════════════
// ИГРОВАЯ ЛОГИКА
// ═════════════════════════════════════════════════════════════════════
function addSeen(room, userId, val) {
  if (!room.seenCounts[userId]) room.seenCounts[userId] = {};
  room.seenCounts[userId][val] = (room.seenCounts[userId][val]||0)+1;
}
function addSeenBoth(room, val) { for (const p of room.players) addSeen(room, p.userId, val); }

function startRound(room, resetTokens = false) {
  if (room.roundTimeout) { clearTimeout(room.roundTimeout); room.roundTimeout = null; }
  if (resetTokens || !Object.keys(room.tokens).length) {
    for (const p of room.players) room.tokens[p.userId] = 0;
  }
  room.seenCounts = {};
  for (const p of room.players) room.seenCounts[p.userId] = {};

  const deck = buildDeck();
  const burned = deck.shift();
  const excludedCards = [];
  for (let i=0; i<3 && deck.length; i++) {
    const c = deck.shift();
    excludedCards.push(c);
    addSeenBoth(room, c.value);
  }
  const players = room.players.map(p => ({
    socketId:p.socketId, userId:p.userId, name:p.name, avatar:p.avatar||null,
    isBot:!!p.isBot, back:p.back||'back',
    hand:[], discard:[], protected:false, eliminated:false, mustPlayCountess:false,
  }));
  for (const pl of players) {
    const c = deck.shift(); pl.hand.push(c);
    addSeen(room, pl.userId, c.value);
  }
  const c2 = deck.shift(); players[0].hand.push(c2);
  addSeen(room, players[0].userId, c2.value);
  updateCountess(players[0]);

  room.state = { deck, burned, excludedCards, players, turn:0, log:[], roundOver:null, gameOver:null, pendingChancellor:null };
  room.rematchVotes.clear();

  // Если первый ход — бот, запускаем бот-ход с задержкой
  if (players[0].isBot) {
    setTimeout(() => botTurn(room), 1200);
  }
}

function updateCountess(p) {
  const vals = p.hand.map(c => c.value);
  p.mustPlayCountess = vals.includes(8) && (vals.includes(5) || vals.includes(7));
}

function checkSpyBonus(room) {
  const s = room.state;
  const surv = s.players.filter(p => !p.eliminated);
  const spy = surv.filter(p => p.discard.some(c => c.value===0));
  return spy.length === 1 ? spy[0].userId : null;
}

function endRound(room, winnerId) {
  const s = room.state;
  if (room.roundTimeout) return;
  const winner = s.players.find(p => p.userId === winnerId);
  const loser  = s.players.find(p => p.userId !== winnerId);
  room.tokens[winnerId] = (room.tokens[winnerId]||0)+1;
  const spy = checkSpyBonus(room);
  if (spy) {
    room.tokens[spy] = (room.tokens[spy]||0)+1;
    const bn = room.players.find(p=>p.userId===spy)?.name;
    logMsg(room, `🃏 Бонус Информатора → +1 жетон ${bn}`);
  }
  const wt = room.tokens[winnerId], lt = room.tokens[loser?.userId]||0;

  if (wt >= WIN_TOKENS) {
    s.gameOver = { winnerId, winnerName:winner?.name, loserName:loser?.name, winnerTokens:wt, loserTokens:lt };
    // Сохраняем статистику
    recordGameEnd(winner, loser);
  } else {
    s.roundOver = { winnerId, winnerName:winner?.name, loserName:loser?.name, winnerTokens:wt, loserTokens:lt };
    room.roundTimeout = setTimeout(() => {
      startRound(room, false);
      for (const p of room.players) {
        if (!p.isBot && p.socketId) io.to(p.socketId).emit('new_round');
      }
      emitState(room);
    }, 4000);
  }
}

async function recordGameEnd(winner, loser) {
  if (winner && !winner.isBot) await savePlayer(winner.userId, { $inc:{ wins:1 } }).catch(()=>{});
  if (loser  && !loser.isBot)  await savePlayer(loser.userId,  { $inc:{ losses:1 } }).catch(()=>{});
  // Для in-memory:
  if (!Player) {
    if (winner && !winner.isBot) {
      const p = memoryPlayers.get(winner.userId);
      if (p) p.wins = (p.wins||0)+1;
    }
    if (loser && !loser.isBot) {
      const p = memoryPlayers.get(loser.userId);
      if (p) p.losses = (p.losses||0)+1;
    }
  }
}

function nextTurn(room) {
  const s = room.state;
  if (s.roundOver || s.gameOver || s.pendingChancellor) return;
  const alive = s.players.filter(p => !p.eliminated);
  if (alive.length <= 1) {
    if (alive[0]) {
      logMsg(room, `🏆 ${alive[0].name} побеждает раунд.`);
      endRound(room, alive[0].userId);
    }
    return;
  }
  if (s.deck.length === 0) {
    const ranked = [...alive].sort((a,b) => b.hand[0]?.value - a.hand[0]?.value);
    if (ranked.length>=2 && ranked[0].hand[0]?.value===ranked[1].hand[0]?.value) {
      const sum = p => p.discard.reduce((a,c)=>a+c.value,0);
      ranked.sort((a,b) => sum(b)-sum(a));
    }
    logMsg(room, `🃏 Колода исчерпана.`);
    endRound(room, ranked[0].userId);
    return;
  }
  let next = (s.turn+1)%s.players.length;
  while (s.players[next].eliminated) next = (next+1)%s.players.length;
  s.turn = next;
  const cur = s.players[next];
  cur.protected = false;
  const drawn = s.deck.shift();
  cur.hand.push(drawn);
  addSeen(room, cur.userId, drawn.value);
  updateCountess(cur);

  // Если ход бота
  if (cur.isBot && !s.roundOver && !s.gameOver) {
    emitState(room);
    setTimeout(() => botTurn(room), 1000 + Math.random()*800);
  }
}

function playCard(room, socketId, payload) {
  const s = room.state;
  if (!s || s.roundOver || s.gameOver) return { error:'Игра не активна.' };
  if (s.pendingChancellor) return { error:'Завершите выбор карты.' };
  const me = s.players[s.turn];
  if (me.socketId !== socketId && !me.isBot) return { error:'Не ваш ход.' };
  const { cardId, target, guess } = payload;
  const idx = me.hand.findIndex(c => c.id === cardId);
  if (idx<0) return { error:'Карты нет.' };
  const card = me.hand[idx];
  if (me.mustPlayCountess && card.value !== 8)
    return { error:'Обязан сыграть Роковую женщину.' };

  me.hand.splice(idx,1);
  me.discard.push(card);
  addSeenBoth(room, card.value);
  logMsg(room, `${me.name} играет «${CARD_DEFS[card.value].name}» [${card.value}].`);

  const opp = s.players.find(p => p.userId !== me.userId && !p.eliminated);

  switch(card.value) {
    case 0: logMsg(room,'Информатор сыгран.'); break;
    case 1: {
      if(!opp||opp.protected){logMsg(room,opp?`${opp.name} под защитой.`:'Нет цели.');break;}
      if(guess===undefined||guess<0||guess>9||guess===1)return rollback(room,me,card,'Назови 0-9, не 1.');
      if(opp.hand[0]?.value===guess){
        addSeenBoth(room,opp.hand[0].value);
        opp.discard.push(...opp.hand.splice(0)); opp.eliminated=true;
        logMsg(room,`🎯 Угадано! ${opp.name} выбывает.`);
      } else logMsg(room,`Промах.`);
      break;
    }
    case 2: {
      if(!opp||opp.protected){logMsg(room,opp?`${opp.name} под защитой.`:'Нет цели.');break;}
      addSeen(room,me.userId,opp.hand[0]?.value);
      if(!me.isBot) {
        io.to(me.socketId).emit('peek',{playerName:opp.name,card:opp.hand[0],cardName:CARD_DEFS[opp.hand[0]?.value]?.name});
      }
      logMsg(room,`${me.name} смотрит карту ${opp.name}.`);
      break;
    }
    case 3: {
      if(!opp||opp.protected){logMsg(room,opp?`${opp.name} под защитой.`:'Нет цели.');break;}
      const mv=me.hand[0]?.value, ov=opp.hand[0]?.value;
      if(mv===undefined||ov===undefined)break;
      if(mv>ov){addSeenBoth(room,ov);opp.discard.push(...opp.hand.splice(0));opp.eliminated=true;logMsg(room,`${me.name}(${mv})>${opp.name}(${ov}). ${opp.name} выбывает.`);}
      else if(mv<ov){addSeenBoth(room,mv);me.discard.push(...me.hand.splice(0));me.eliminated=true;logMsg(room,`${me.name}(${mv})<${opp.name}(${ov}). ${me.name} выбывает.`);}
      else logMsg(room,`Ничья (${mv}=${ov}).`);
      break;
    }
    case 4: me.protected=true; logMsg(room,`${me.name} под защитой.`); break;
    case 5: {
      const tgt=target==='self'?me:opp;
      if(!tgt)break;
      if(tgt.protected&&tgt!==me){logMsg(room,`${tgt.name} под защитой.`);break;}
      const dropped=tgt.hand.shift(); tgt.discard.push(dropped); addSeenBoth(room,dropped?.value);
      if(dropped?.value===9){tgt.eliminated=true;logMsg(room,`💀 ${tgt.name} сбросил Компромат!`);}
      else {
        if(s.deck.length>0){const nc=s.deck.shift();tgt.hand.push(nc);addSeen(room,tgt.userId,nc.value);}
        else if(s.burned){tgt.hand.push(s.burned);s.burned=null;}
        logMsg(room,`Облава! ${tgt.name} берёт новую карту.`);
      }
      updateCountess(tgt);
      break;
    }
    case 6: {
      const extra=[];
      if(s.deck.length>0)extra.push(s.deck.shift());
      if(s.deck.length>0)extra.push(s.deck.shift());
      const options=[...me.hand,...extra];
      for(const c of options) addSeen(room,me.userId,c.value);
      if (me.isBot) {
        // Бот выбирает лучшую карту
        botChancellorPick(room, me, options);
        return { ok:true };
      }
      s.pendingChancellor={socketId,options};
      logMsg(room,`${me.name} изучает варианты.`);
      io.to(socketId).emit('chancellor_choice',{cards:options});
      emitState(room);
      return { ok:true };
    }
    case 7: {
      if(!opp||opp.protected){logMsg(room,opp?`${opp.name} под защитой.`:'Нет цели.');break;}
      if(me.hand[0])addSeen(room,opp.userId,me.hand[0].value);
      if(opp.hand[0])addSeen(room,me.userId,opp.hand[0].value);
      [me.hand,opp.hand]=[opp.hand,me.hand];
      updateCountess(me); updateCountess(opp);
      logMsg(room,`${me.name} и ${opp.name} меняются картами.`);
      break;
    }
    case 8: logMsg(room,`${me.name} избавляется от Роковой женщины.`); break;
    case 9: me.eliminated=true; logMsg(room,`💀 ${me.name} сбросил Компромат!`); break;
  }
  me.mustPlayCountess=false;
  nextTurn(room);
  return { ok:true };
}

function rollback(room,me,card,err){me.discard.pop();me.hand.push(card);return{error:err};}
function logMsg(room,msg){room.state.log.push(msg);}
function emitState(room){
  for(const p of room.players){
    if(!p.isBot && p.socketId) io.to(p.socketId).emit('state',room.publicState(p.socketId));
  }
}

// ═════════════════════════════════════════════════════════════════════
// БОТ AI
// ═════════════════════════════════════════════════════════════════════
// Бот знает: свою руку, все сбросы (открытые), 3 исключённые, что видел.
// НЕ знает: карту соперника (если не видел через Журналиста).
function botTurn(room) {
  const s = room.state;
  if (!s || s.roundOver || s.gameOver) return;
  const me = s.players[s.turn];
  if (!me || !me.isBot || me.eliminated) return;
  if (me.hand.length < 2) return; // ждём карту

  const opp = s.players.find(p => p.userId !== me.userId && !p.eliminated);
  const hand = me.hand;

  // Обязательно Роковая женщина
  if (me.mustPlayCountess) {
    const c8 = hand.find(c => c.value === 8);
    if (c8) return botPlay(room, me, { cardId:c8.id });
  }

  // Никогда не сбрасываем Компромат (9) добровольно
  const safe = hand.filter(c => c.value !== 9);
  const pool = safe.length > 0 ? safe : hand;

  // Подсчёт оставшихся карт в колоде по типам
  const played = {};
  for (const p of s.players) for (const c of p.discard) played[c.value] = (played[c.value]||0)+1;
  for (const c of s.excludedCards) played[c.value] = (played[c.value]||0)+1;
  for (const c of hand) played[c.value] = (played[c.value]||0)+1;

  const remaining = {};
  for (let v=0; v<=9; v++) remaining[v] = CARD_DEFS[v].count - (played[v]||0);

  // Оставшаяся карта (та что останется после хода)
  const otherCard = v => hand.find(c => c.value !== v) || hand[0];

  // Приоритеты карт для бота
  function scoreCard(card) {
    const v = card.value;
    const myOther = otherCard(v).value;

    switch(v) {
      case 0: return 90; // Информатор: играем рано для шанса на бонус
      case 1: { // Детектив: угадываем самую вероятную карту
        if (!opp || opp.protected) return 30;
        let maxProb = 0;
        for (let g=0;g<=9;g++) { if(g===1)continue; if(remaining[g]>0 && remaining[g]>maxProb) maxProb=remaining[g]; }
        return 60 + maxProb * 8; // чем больше шанс угадать — тем лучше
      }
      case 2: return 55; // Журналист: всегда полезно узнать
      case 3: { // Громила: играем если у нас высокая вторая карта
        if (!opp || opp.protected) return 20;
        return myOther >= 5 ? 75 : 25;
      }
      case 4: return 50; // Продажный коп: защита
      case 5: { // Федерал: обычно на соперника
        if (!opp || opp.protected) return 35;
        return 55;
      }
      case 6: return 65; // Теневой брокер: хороший выбор
      case 7: { // Босс мафии: меняемся если у нас карта слабая
        if (!opp || opp.protected) return 15;
        return myOther <= 3 ? 70 : 20;
      }
      case 8: return 85; // Роковая женщина: сбрасываем с удовольствием
      case 9: return -100; // Компромат: НИКОГДА
    }
    return 40;
  }

  // Выбираем лучшую карту для розыгрыша
  const scored = pool.map(c => ({ card:c, score:scoreCard(c) + Math.random()*15 }));
  scored.sort((a,b) => b.score - a.score);
  const chosen = scored[0].card;

  // Формируем payload
  const payload = { cardId: chosen.id };

  if (chosen.value === 1 && opp && !opp.protected) {
    // Угадываем самую вероятную карту
    let bestGuess = 0, bestCount = 0;
    for (let g=0;g<=9;g++) {
      if (g===1) continue;
      if (remaining[g] > bestCount) { bestCount = remaining[g]; bestGuess = g; }
    }
    payload.guess = bestGuess;
  }

  if (chosen.value === 5) {
    // Федерал: на соперника если возможно
    payload.target = (opp && !opp.protected) ? 'opp' : 'self';
  }

  botPlay(room, me, payload);
}

function botPlay(room, me, payload) {
  const result = playCard(room, me.socketId, payload);
  if (result?.error) {
    // Фоллбэк: играем первую доступную карту
    const fb = me.hand.find(c => c.value !== 9) || me.hand[0];
    if (fb) playCard(room, me.socketId, { cardId: fb.id });
  }
  emitState(room);
}

function botChancellorPick(room, me, options) {
  // Бот выбирает карту с наибольшим номиналом (но не 9 если есть альтернатива)
  const safe = options.filter(c => c.value !== 9);
  const pool = safe.length > 0 ? safe : options;
  pool.sort((a,b) => b.value - a.value);
  const kept = pool[0];
  const returns = options.filter(c => c.id !== kept.id);
  me.hand = [kept];
  updateCountess(me);
  shuffle(returns);
  room.state.deck.push(...returns);
  room.state.pendingChancellor = null;
  logMsg(room, `${me.name} выбрал карту.`);
  nextTurn(room);
  emitState(room);
}

// ═════════════════════════════════════════════════════════════════════
// SOCKET.IO
// ═════════════════════════════════════════════════════════════════════
io.on('connection', socket => {
  // Отправляем список лобби при подключении
  const list = [];
  for (const [,l] of lobbies) { if (!l.started) list.push(l.toPublic()); }
  socket.emit('lobby_list', list);

  // ─── ЛОББИ ───
  socket.on('get_player_data', async (userId) => {
    const p = await getPlayer(userId);
    socket.emit('player_data', {
      wins: p.wins||0, losses: p.losses||0,
      selectedBack: p.selectedBack || 'back',
    });
  });

  socket.on('set_back', async ({ userId, backName }) => {
    await savePlayer(userId, { selectedBack: backName });
    socket.emit('back_updated', backName);
  });

  socket.on('create_lobby', async ({ user }) => {
    const lobbyId = 'L' + Math.random().toString(36).slice(2,8);
    const playerData = await getPlayer(user.id);
    const lobby = new Lobby(lobbyId, {
      userId: user.id, name: user.name, avatar: user.avatar,
      socketId: socket.id, isBot: false, back: playerData.selectedBack || 'back',
    });
    lobbies.set(lobbyId, lobby);
    socket.join(lobbyId);
    socket.data.lobbyId = lobbyId;
    socket.data.userId  = user.id;
    socket.emit('lobby_joined', lobby.toPublic());
    broadcastLobbies();
  });

  socket.on('join_lobby', async ({ lobbyId, user }) => {
    const lobby = lobbies.get(lobbyId);
    if (!lobby || lobby.started || lobby.isFull()) {
      socket.emit('error_msg', 'Лобби недоступно.');
      return;
    }
    const playerData = await getPlayer(user.id);
    const ok = lobby.addPlayer({
      userId:user.id, name:user.name, avatar:user.avatar,
      socketId:socket.id, isBot:false, back: playerData.selectedBack || 'back',
    });
    if (!ok) { socket.emit('error_msg', 'Лобби заполнено.'); return; }

    socket.join(lobbyId);
    socket.data.lobbyId = lobbyId;
    socket.data.userId  = user.id;
    io.to(lobbyId).emit('lobby_joined', lobby.toPublic());
    broadcastLobbies();
  });

  socket.on('add_bot', () => {
    const lobby = lobbies.get(socket.data.lobbyId);
    if (!lobby || lobby.creatorId !== socket.data.userId) return;
    if (lobby.isFull()) { socket.emit('error_msg','Лобби полно.'); return; }

    const botNames = ['Тень','Ворон','Мрак','Сыщик','Барон','Призрак','Шёпот','Молния'];
    const botName = botNames[Math.floor(Math.random()*botNames.length)];
    const botId = 'bot_' + Math.random().toString(36).slice(2,8);
    lobby.addPlayer({
      userId:botId, name:`🤖 ${botName}`, avatar:null,
      socketId: null, isBot:true, back:'back',
    });
    io.to(lobby.id).emit('lobby_joined', lobby.toPublic());
    broadcastLobbies();
  });

  socket.on('remove_bot', () => {
    const lobby = lobbies.get(socket.data.lobbyId);
    if (!lobby || lobby.creatorId !== socket.data.userId) return;
    const bot = lobby.players.find(p => p.isBot);
    if (bot) lobby.removePlayer(bot.userId);
    io.to(lobby.id).emit('lobby_joined', lobby.toPublic());
    broadcastLobbies();
  });

  socket.on('start_game', () => {
    const lobby = lobbies.get(socket.data.lobbyId);
    if (!lobby || lobby.creatorId !== socket.data.userId) return;
    if (lobby.players.length < 2) { socket.emit('error_msg','Нужно 2 игрока.'); return; }

    lobby.started = true;
    const roomId = lobby.id;
    const room = new Room(roomId);
    rooms.set(roomId, room);

    for (const p of lobby.players) {
      room.addPlayer(p);
      if (!p.isBot && p.socketId) {
        const s = io.sockets.sockets.get(p.socketId);
        if (s) { s.join(roomId); s.data.roomId = roomId; }
      }
    }

    startRound(room, true);
    io.to(roomId).emit('game_started');
    emitState(room);
    broadcastLobbies();
  });

  socket.on('leave_lobby', () => {
    const lobby = lobbies.get(socket.data.lobbyId);
    if (!lobby) return;
    lobby.removePlayer(socket.data.userId);
    socket.leave(lobby.id);
    if (lobby.players.filter(p=>!p.isBot).length === 0) {
      lobbies.delete(lobby.id);
    } else {
      // Если создатель ушёл, передаём создание первому
      if (lobby.creatorId === socket.data.userId && lobby.players.length > 0) {
        lobby.creatorId = lobby.players[0].userId;
      }
      io.to(lobby.id).emit('lobby_joined', lobby.toPublic());
    }
    socket.data.lobbyId = null;
    broadcastLobbies();
  });

  socket.on('invite_link', () => {
    const lobby = lobbies.get(socket.data.lobbyId);
    if (!lobby) return;
    socket.emit('invite_link_data', { lobbyId: lobby.id });
  });

  // ─── ИГРА ───
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
    const kept = options.find(c => c.id === keepCardId);
    const returns = options.filter(c => c.id !== keepCardId);
    if (!kept) { socket.emit('error_msg','Неверный выбор.'); return; }
    const me = s.players.find(p => p.socketId === socket.id);
    me.hand = [kept]; updateCountess(me);
    shuffle(returns); s.deck.push(...returns);
    s.pendingChancellor = null;
    logMsg(room, `${me.name} выбрал карту.`);
    nextTurn(room); emitState(room);
  });

  socket.on('rematch', () => {
    const room = rooms.get(socket.data.roomId);
    if (!room || !room.state?.gameOver) return;
    room.rematchVotes.add(socket.data.userId);
    // Бот автоматически соглашается
    for (const p of room.players) { if(p.isBot) room.rematchVotes.add(p.userId); }
    if (room.rematchVotes.size >= room.players.length) {
      startRound(room, true);
      io.to(room.id).emit('game_started');
      emitState(room);
    } else {
      io.to(room.id).emit('rematch_pending', { count: room.rematchVotes.size });
    }
  });

  socket.on('leave_game', () => cleanupGame(socket));

  socket.on('disconnect', () => {
    // Лобби
    const lobby = lobbies.get(socket.data.lobbyId);
    if (lobby) {
      lobby.removePlayer(socket.data.userId);
      if (lobby.players.filter(p=>!p.isBot).length === 0) lobbies.delete(lobby.id);
      else io.to(lobby.id).emit('lobby_joined', lobby.toPublic());
      broadcastLobbies();
    }
    // Игра
    setTimeout(() => {
      const room = rooms.get(socket.data.roomId);
      if (room?.players.find(p => p.socketId === socket.id)) cleanupGame(socket);
    }, 30000);
  });
});

function cleanupGame(socket) {
  const room = rooms.get(socket.data.roomId);
  if (!room) return;
  room.removeBySocket(socket.id);
  if (room.players.filter(p=>!p.isBot).length === 0) {
    if(room.roundTimeout) clearTimeout(room.roundTimeout);
    rooms.delete(room.id);
  } else {
    io.to(room.id).emit('opponent_left');
  }
  socket.leave(socket.data.roomId);
  socket.data.roomId = null;
}

// ─── ЗАПУСК ───
connectDB().then(() => {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => console.log(`✨ Сервер запущен на порту ${PORT}`));
});
