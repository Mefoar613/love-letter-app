// =====================================================================
// Тёмная Дуэль — Server v11 | 2-4 players, modes, admin panel
// =====================================================================
const express  = require('express');
const http     = require('http');
const path     = require('path');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

const ADMIN_ID = 'tg_1095004987';

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors:{ origin:'*' } });

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, fp) {
    const t = {'.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.html':'text/html; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon','.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav'};
    const ext = path.extname(fp).toLowerCase();
    if (t[ext]) res.setHeader('Content-Type', t[ext]);
  }
}));
app.get('/health', (_,r) => r.send('ok'));

// ═══ MONGODB ═══
const MONGO_URI = process.env.MONGO_URI || '';
const playerSchema = new mongoose.Schema({
  odlId:{ type:String, unique:true, required:true },
  name:String, avatar:String,
  wins:{ type:Number, default:0 }, losses:{ type:Number, default:0 },
  selectedBack:{ type:String, default:'back' },
}, { timestamps:true });
let Player = null;
async function connectDB() {
  if (!MONGO_URI) { console.log('⚠ MONGO_URI не задан — данные в памяти.'); return; }
  try { await mongoose.connect(MONGO_URI); Player = mongoose.model('Player', playerSchema); console.log('✅ MongoDB подключена'); }
  catch(e) { console.log('⚠ MongoDB ошибка:', e.message); }
}
const memPlayers = new Map();
async function getPlayer(uid) {
  if (Player) { let p = await Player.findOne({odlId:uid}); if(!p) p = await Player.create({odlId:uid,name:'Игрок',selectedBack:'back'}); return p; }
  if (!memPlayers.has(uid)) memPlayers.set(uid,{odlId:uid,name:'Игрок',wins:0,losses:0,selectedBack:'back'});
  return memPlayers.get(uid);
}
async function savePlayer(uid, data) {
  if (Player) await Player.updateOne({odlId:uid},{$set:data},{upsert:true});
  else { const p = memPlayers.get(uid)||{odlId:uid}; Object.assign(p,data); memPlayers.set(uid,p); }
}

// ═══ КАРТЫ ═══
const CARD_DEFS = {0:{count:2,name:'Информатор'},1:{count:6,name:'Детектив'},2:{count:2,name:'Журналист'},3:{count:2,name:'Громила'},4:{count:2,name:'Продажный коп'},5:{count:2,name:'Федерал'},6:{count:2,name:'Теневой брокер'},7:{count:1,name:'Босс мафии'},8:{count:1,name:'Роковая женщина'},9:{count:1,name:'Компромат'}};
function winTokensFor(n) { return n<=2?6:n===3?5:4; }

function buildDeck() {
  const d=[];
  for (const [v,def] of Object.entries(CARD_DEFS))
    for (let i=0;i<def.count;i++) d.push({value:+v,id:`${v}_${i}_${Math.random().toString(36).slice(2,6)}`});
  shuffle(d); return d;
}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}}

// ═══ ЛОББИ ═══
const lobbies = new Map();
class Lobby {
  constructor(id,creator){
    this.id=id; this.creatorId=creator.userId;
    this.slots=[creator];
    this.maxPlayers=2;
    this.started=false;
  }
  get players(){return this.slots;}
  addPlayer(p){
    if(this.slots.length>=this.maxPlayers)return false;
    if(this.slots.find(x=>x.userId===p.userId))return true;
    this.slots.push(p); return true;
  }
  removePlayer(uid){this.slots=this.slots.filter(p=>p.userId!==uid);}
  setMaxPlayers(n){this.maxPlayers=Math.min(4,Math.max(2,n));}
  isFull(){return this.slots.length>=this.maxPlayers;}
  toPublic(){
    return {
      id:this.id, creatorId:this.creatorId, creatorName:this.slots[0]?.name||'?',
      playerCount:this.slots.length, maxPlayers:this.maxPlayers, started:this.started,
      players:this.slots.map(p=>({name:p.name,avatar:p.avatar,isBot:!!p.isBot,userId:p.userId})),
    };
  }
}
function broadcastLobbies(){
  const list=[];for(const[,l]of lobbies){if(!l.started)list.push(l.toPublic());}
  io.emit('lobby_list',list);
}

// ═══ КОМНАТЫ ═══
const rooms = new Map();
class Room {
  constructor(id,playerCount){
    this.id=id; this.players=[]; this.state=null;
    this.tokens={}; this.seenCards={}; this.log=[]; this.roundCount=0;
    this.roundTimeout=null; this.rematchVotes=new Set();
    this.pendingVFX=[]; this.playerCount=playerCount||2;
    this.winTokens=winTokensFor(playerCount);
  }
  addPlayer(p){
    if(this.players.length>=4)return false;
    const ex=this.players.find(x=>x.userId===p.userId);
    if(ex){ex.socketId=p.socketId;return true;}
    this.players.push(p);return true;
  }
  removeBySocket(sid){this.players=this.players.filter(p=>p.socketId!==sid);}

  publicState(forSocketId){
    const s=this.state;if(!s)return null;
    const me=s.players.find(p=>p.socketId===forSocketId);
    const others=s.players.filter(p=>p.socketId!==forSocketId);
    const cur=s.players[s.turn];

    const sc={};
    if(me&&this.seenCards[me.userId]){
      for(const val of this.seenCards[me.userId].values()) sc[val]=(sc[val]||0)+1;
    }

    return {
      isMyTurn: cur?.socketId===forSocketId&&!s.pendingChancellor&&!s.roundOver&&!s.gameOver,
      turnPlayerName: cur?.name,
      playerCount: this.playerCount,
      winTokens: this.winTokens,
      log: this.log.slice(-60),
      roundOver: s.roundOver||null, gameOver: s.gameOver||null,
      deckCount: s.deck.length,
      excludedCards: s.excludedCards,
      pendingChancellor: s.pendingChancellor?.socketId===forSocketId?s.pendingChancellor.options:null,
      me: me&&{
        name:me.name,avatar:me.avatar,hand:me.hand,discard:me.discard,
        protected:me.protected,eliminated:me.eliminated,
        tokens:this.tokens[me.userId]||0,seenCounts:sc,back:me.back||'back',
        mustPlayCountess:me.mustPlayCountess,
      },
      opponents: others.map(o=>({
        name:o.name,avatar:o.avatar,handCount:o.hand.length,
        discard:o.discard,protected:o.protected,eliminated:o.eliminated,
        tokens:this.tokens[o.userId]||0,isBot:!!o.isBot,back:o.back||'back',
        userId:o.userId,isTurn:cur?.userId===o.userId,
      })),
      opponent: others[0]?{
        name:others[0].name,avatar:others[0].avatar,handCount:others[0].hand.length,
        discard:others[0].discard,protected:others[0].protected,eliminated:others[0].eliminated,
        tokens:this.tokens[others[0].userId]||0,isBot:!!others[0].isBot,back:others[0].back||'back',
      }:null,
    };
  }
}

// ═══ SEEN TRACKING ═══
function addSeen(room,uid,card){
  if(!card||card.value===undefined||!card.id)return;
  if(!room.seenCards)room.seenCards={};
  if(!room.seenCards[uid])room.seenCards[uid]=new Map();
  room.seenCards[uid].set(card.id,card.value);
}
function addSeenAll(room,card){if(!card)return;for(const p of room.players)addSeen(room,p.userId,card);}

// ═══ ИГРОВАЯ ЛОГИКА ═══
function startRound(room, resetTokens=false){
  if(room.roundTimeout){clearTimeout(room.roundTimeout);room.roundTimeout=null;}
  if(resetTokens||!Object.keys(room.tokens).length){
    for(const p of room.players)room.tokens[p.userId]=0;
    room.log=[]; room.roundCount=0;
  }
  room.roundCount++;
  room.log.push(`— РАУНД ${room.roundCount} —`);
  room.seenCards={};
  for(const p of room.players)room.seenCards[p.userId]=new Map();
  room.pendingVFX=[];

  const deck=buildDeck();
  const burned=deck.shift();

  const excludedCards=[];
  if(room.playerCount===2){
    for(let i=0;i<3&&deck.length;i++){const c=deck.shift();excludedCards.push(c);addSeenAll(room,c);}
  }

  const players=room.players.map(p=>({
    socketId:p.socketId,userId:p.userId,name:p.name,avatar:p.avatar||null,
    isBot:!!p.isBot,back:p.back||'back',
    hand:[],discard:[],protected:false,eliminated:false,mustPlayCountess:false,
  }));

  for(const pl of players){const c=deck.shift();pl.hand.push(c);addSeen(room,pl.userId,c);}

  const firstIdx=Math.floor(Math.random()*players.length);
  const c2=deck.shift();players[firstIdx].hand.push(c2);addSeen(room,players[firstIdx].userId,c2);
  updateCountess(players[firstIdx]);

  room.state={deck,burned,excludedCards,players,turn:firstIdx,roundOver:null,gameOver:null,pendingChancellor:null};
  room.rematchVotes.clear();

  room.log.push(`Первый ход: ${players[firstIdx].name}`);

  if(players[firstIdx].isBot)setTimeout(()=>botTurn(room),1500);
}

function updateCountess(p){
  const v=p.hand.map(c=>c.value);
  p.mustPlayCountess=v.includes(8)&&(v.includes(5)||v.includes(7));
}

function checkSpyBonus(room){
  const s=room.state;const surv=s.players.filter(p=>!p.eliminated);
  const spy=surv.filter(p=>p.discard.some(c=>c.value===0));
  return spy.length===1?spy[0].userId:null;
}

function endRound(room,winnerId,reason){
  const s=room.state;
  if(room.roundTimeout)return;
  const winner=s.players.find(p=>p.userId===winnerId);
  room.tokens[winnerId]=(room.tokens[winnerId]||0)+1;
  const spy=checkSpyBonus(room);
  if(spy){room.tokens[spy]=(room.tokens[spy]||0)+1;const bn=room.players.find(p=>p.userId===spy)?.name;logMsg(room,`🃏 Бонус Информатора → +1 ${bn}`);}

  const wt=room.tokens[winnerId];
  const scores=s.players.map(p=>({name:p.name,userId:p.userId,tokens:room.tokens[p.userId]||0}));

  if(wt>=room.winTokens){
    s.gameOver={winnerId,winnerName:winner?.name,scores,reason:reason||'Набрано нужное число жетонов'};
    recordGameEnd(room,winnerId);
  } else {
    s.roundOver={winnerId,winnerName:winner?.name,scores,reason:reason||''};
    room.roundTimeout=setTimeout(()=>{
      startRound(room,false);
      for(const p of room.players){if(!p.isBot&&p.socketId)io.to(p.socketId).emit('new_round');}
      emitState(room);
    },4000);
  }
}

async function recordGameEnd(room,winnerId){
  for(const p of room.players){
    if(p.isBot)continue;
    const isWinner=p.userId===winnerId;
    if(Player){
      try{await Player.updateOne({odlId:p.userId},{$inc:isWinner?{wins:1}:{losses:1}},{upsert:true});}catch(e){}
    } else {
      const mp=memPlayers.get(p.userId);
      if(mp){if(isWinner)mp.wins=(mp.wins||0)+1;else mp.losses=(mp.losses||0)+1;}
    }
  }
}

function nextTurn(room){
  const s=room.state;
  if(s.roundOver||s.gameOver||s.pendingChancellor)return;
  const alive=s.players.filter(p=>!p.eliminated);

  if(alive.length<=1){
    if(alive[0]){
      const loserNames=s.players.filter(p=>p.eliminated).map(p=>p.name).join(', ');
      endRound(room,alive[0].userId,`${alive[0].name} — последний на ногах. Выбыли: ${loserNames}`);
    }
    return;
  }
  if(s.deck.length===0){
    const ranked=[...alive].sort((a,b)=>b.hand[0]?.value-a.hand[0]?.value);
    if(ranked.length>=2&&ranked[0].hand[0]?.value===ranked[1].hand[0]?.value){
      const sum=p=>p.discard.reduce((a,c)=>a+c.value,0);ranked.sort((a,b)=>sum(b)-sum(a));
    }
    const vals=ranked.map(p=>`${p.name}(${p.hand[0]?.value})`).join(' vs ');
    endRound(room,ranked[0].userId,`Колода кончилась. ${vals}. Побеждает ${ranked[0].name}.`);
    return;
  }

  let next=(s.turn+1)%s.players.length;
  while(s.players[next].eliminated)next=(next+1)%s.players.length;
  s.turn=next;
  const cur=s.players[next];
  cur.protected=false;
  const drawn=s.deck.shift();cur.hand.push(drawn);addSeen(room,cur.userId,drawn);updateCountess(cur);

  if(cur.isBot&&!s.roundOver&&!s.gameOver){
    emitState(room);
    // Увеличена задержка для нормального режима анимаций
    setTimeout(()=>botTurn(room),3500+Math.random()*1500);
  }
}

function playCard(room,socketId,payload){
  const s=room.state;
  if(!s||s.roundOver||s.gameOver)return{error:'Игра не активна.'};
  if(s.pendingChancellor)return{error:'Завершите выбор карты.'};
  const me=s.players[s.turn];
  if(me.socketId!==socketId&&!me.isBot)return{error:'Не ваш ход.'};
  const{cardId,targetUserId,guess}=payload;
  const idx=me.hand.findIndex(c=>c.id===cardId);
  if(idx<0)return{error:'Карты нет.'};
  const card=me.hand[idx];

  if(me.mustPlayCountess&&card.value!==8)
    return{error:'Роковая женщина! Обязан сыграть карту 8.'};

  me.hand.splice(idx,1);me.discard.push(card);addSeenAll(room,card);

  let target=null;
  const aliveOpps=s.players.filter(p=>p.userId!==me.userId&&!p.eliminated);
  if(targetUserId){
    target=aliveOpps.find(p=>p.userId===targetUserId);
  } else if(aliveOpps.length===1){
    target=aliveOpps[0];
  }

  const cn=CARD_DEFS[card.value].name;
  logMsg(room,`${me.name}: ${cn}`);

  switch(card.value){
    case 0: break;
    case 1:{
      if(!target||target.protected){logMsg(room,target?`${target.name} под защитой.`:'Нет цели.');break;}
      if(guess===undefined||guess<0||guess>9||guess===1)return rollback(room,me,card,'Назови 0-9, не 1.');
      const hit=target.hand[0]?.value===guess;
      const hitMsg = hit
        ? `🎯 ${me.name} угадал ${CARD_DEFS[guess].name} у ${target.name}!`
        : `✗ Промах! У ${target.name} нет ${CARD_DEFS[guess].name}`;
      room.pendingVFX.push({type:'detective',guess,hit,targetCard:target.hand[0]?.value,targetName:target.name,playerName:me.name,message:hitMsg});
      if(hit){
        addSeenAll(room,target.hand[0]);target.discard.push(...target.hand.splice(0));target.eliminated=true;
        logMsg(room,hitMsg);
      } else logMsg(room,hitMsg);
      break;
    }
    case 2:{
      if(!target||target.protected)break;
      addSeen(room,me.userId,target.hand[0]);
      room.pendingVFX.push({type:'journalist',playerName:me.name,message:`👀 ${me.name} подсмотрел карту ${target.name}`});
      if(!me.isBot)io.to(me.socketId).emit('peek',{playerName:target.name,card:target.hand[0],cardName:CARD_DEFS[target.hand[0]?.value]?.name});
      logMsg(room,`${me.name} изучает карту ${target.name}.`);
      break;
    }
    case 3:{
      if(!target||target.protected){logMsg(room,target?`${target.name} под защитой.`:'Нет цели.');break;}
      const mv=me.hand[0]?.value,ov=target.hand[0]?.value;
      if(mv===undefined||ov===undefined)break;
      let winnerId=null;
      let baronMsg='';
      if(mv>ov){winnerId=me.userId;addSeenAll(room,target.hand[0]);target.discard.push(...target.hand.splice(0));target.eliminated=true;baronMsg=`⚔️ ${me.name}(${mv}) побеждает ${target.name}(${ov})!`;}
      else if(mv<ov){winnerId=target.userId;addSeenAll(room,me.hand[0]);me.discard.push(...me.hand.splice(0));me.eliminated=true;baronMsg=`⚔️ ${target.name}(${ov}) побеждает ${me.name}(${mv})!`;}
      else baronMsg=`⚔️ Ничья! Оба с картой ${mv}`;
      logMsg(room,baronMsg);
      room.pendingVFX.push({type:'baron',p1Id:me.userId,p2Id:target.userId,p1Card:mv,p2Card:ov,winnerId,p1Name:me.name,p2Name:target.name,message:baronMsg});
      break;
    }
    case 4:me.protected=true;logMsg(room,`🛡 ${me.name} под защитой до следующего хода.`);break;
    case 5:{
      let tgt;
      if(payload.targetUserId==='self'||payload.target==='self')tgt=me;
      else if(target&&!target.protected)tgt=target;
      else if(!target)tgt=me;
      else{logMsg(room,`${target.name} под защитой.`);break;}
      const dropped=tgt.hand.shift();tgt.discard.push(dropped);addSeenAll(room,dropped);
      if(dropped?.value===9){
        tgt.eliminated=true;
        const burnMsg=`💀 Федерал заставил ${tgt.name} сбросить Компромат!`;
        room.pendingVFX.push({type:'burn',message:burnMsg});
        logMsg(room,burnMsg);
      } else {
        if(s.deck.length>0){const nc=s.deck.shift();tgt.hand.push(nc);addSeen(room,tgt.userId,nc);}
        else if(s.burned){tgt.hand.push(s.burned);s.burned=null;}
        logMsg(room,`Облава на ${tgt.name}: сброс и новая карта.`);
      }
      updateCountess(tgt);
      break;
    }
    case 6:{
      const extra=[];
      if(s.deck.length>0)extra.push(s.deck.shift());
      if(s.deck.length>0)extra.push(s.deck.shift());
      const options=[...me.hand,...extra];
      for(const c of options)addSeen(room,me.userId,c);
      if(me.isBot){botChancellorPick(room,me,options);return{ok:true};}
      s.pendingChancellor={socketId,options};
      io.to(socketId).emit('chancellor_choice',{cards:options});
      emitState(room);return{ok:true};
    }
    case 7:{
      if(!target||target.protected){logMsg(room,target?`${target.name} под защитой.`:'Нет цели.');break;}
      if(me.hand[0])addSeen(room,target.userId,me.hand[0]);
      if(target.hand[0])addSeen(room,me.userId,target.hand[0]);
      [me.hand,target.hand]=[target.hand,me.hand];
      updateCountess(me);updateCountess(target);
      logMsg(room,`🔀 ${me.name} и ${target.name} обменялись картами.`);
      break;
    }
    case 8:logMsg(room,`${me.name} сбрасывает Роковую женщину.`);break;
    case 9:{
      me.eliminated=true;
      const burn9Msg=`💀 ${me.name} сбросил Компромат — выбывает!`;
      room.pendingVFX.push({type:'burn',message:burn9Msg});
      logMsg(room,burn9Msg);
      break;
    }
  }
  me.mustPlayCountess=false;
  nextTurn(room);
  return{ok:true};
}

function rollback(room,me,card,err){me.discard.pop();me.hand.push(card);return{error:err};}
function logMsg(room,msg){room.log.push(msg);}
function emitState(room){
  for(const p of room.players){
    if(!p.isBot&&p.socketId)io.to(p.socketId).emit('state',room.publicState(p.socketId));
  }
}

// ═══ БОТ ═══
function botTurn(room){
  const s=room.state;if(!s||s.roundOver||s.gameOver)return;
  const me=s.players[s.turn];if(!me||!me.isBot||me.eliminated||me.hand.length<2)return;
  const aliveOpps=s.players.filter(p=>p.userId!==me.userId&&!p.eliminated);
  const opp=aliveOpps[0];
  if(me.mustPlayCountess){const c8=me.hand.find(c=>c.value===8);if(c8)return botPlay(room,me,{cardId:c8.id});}
  const safe=me.hand.filter(c=>c.value!==9);const pool=safe.length>0?safe:me.hand;
  const played={};
  for(const p of s.players)for(const c of p.discard)played[c.value]=(played[c.value]||0)+1;
  for(const c of s.excludedCards)played[c.value]=(played[c.value]||0)+1;
  for(const c of me.hand)played[c.value]=(played[c.value]||0)+1;
  const remaining={};for(let v=0;v<=9;v++)remaining[v]=CARD_DEFS[v].count-(played[v]||0);
  const otherCard=v=>me.hand.find(c=>c.value!==v)||me.hand[0];
  function scoreCard(card){
    const v=card.value,myOther=otherCard(v).value;
    switch(v){
      case 0:return 90;
      case 1:{if(!opp||opp.protected)return 30;let mx=0;for(let g=0;g<=9;g++){if(g===1)continue;if(remaining[g]>mx)mx=remaining[g];}return 60+mx*8;}
      case 2:return 55;case 3:return(!opp||opp.protected)?20:(myOther>=5?75:25);
      case 4:return 50;case 5:return(!opp||opp.protected)?35:55;case 6:return 65;
      case 7:return(!opp||opp.protected)?15:(myOther<=3?70:20);case 8:return 85;case 9:return-100;
    }return 40;
  }
  const scored=pool.map(c=>({card:c,score:scoreCard(c)+Math.random()*15}));scored.sort((a,b)=>b.score-a.score);
  const chosen=scored[0].card;
  const payload={cardId:chosen.id};
  if(chosen.value===1&&opp&&!opp.protected){
    let bg=0,bc=0;for(let g=0;g<=9;g++){if(g===1)continue;if(remaining[g]>bc){bc=remaining[g];bg=g;}}
    payload.guess=bg;
  }
  if(chosen.value===5)payload.target=(opp&&!opp.protected)?'opp':'self';
  if([1,2,3,5,7].includes(chosen.value)&&aliveOpps.length>1){
    const unprotected=aliveOpps.filter(p=>!p.protected);
    const t=unprotected.length>0?unprotected[Math.floor(Math.random()*unprotected.length)]:aliveOpps[0];
    payload.targetUserId=t.userId;
  } else if(opp&&chosen.value!==5){
    payload.targetUserId=opp.userId;
  }
  botPlay(room,me,payload);
}
function botPlay(room,me,payload){
  const result=playCard(room,me.socketId,payload);
  if(result?.error){const fb=me.hand.find(c=>c.value!==9)||me.hand[0];if(fb)playCard(room,me.socketId,{cardId:fb.id});}
  emitState(room);
  if(room.pendingVFX.length>0){room.pendingVFX.forEach(v=>io.to(room.id).emit('vfx',v));room.pendingVFX=[];}
}
function botChancellorPick(room,me,options){
  const safe=options.filter(c=>c.value!==9);const pool=safe.length>0?safe:options;
  pool.sort((a,b)=>b.value-a.value);const kept=pool[0];const returns=options.filter(c=>c.id!==kept.id);
  me.hand=[kept];updateCountess(me);shuffle(returns);room.state.deck.push(...returns);
  room.state.pendingChancellor=null;nextTurn(room);emitState(room);
}

// ═══ SOCKET.IO ═══
io.on('connection',socket=>{
  {const list=[];for(const[,l]of lobbies){if(!l.started)list.push(l.toPublic());}socket.emit('lobby_list',list);}

  socket.on('get_player_data',async uid=>{const p=await getPlayer(uid);socket.emit('player_data',{wins:p.wins||0,losses:p.losses||0,selectedBack:p.selectedBack||'back'});});
  socket.on('set_back',async({userId,backName})=>{await savePlayer(userId,{selectedBack:backName});socket.emit('back_updated',backName);});

  socket.on('create_lobby',async({user,maxPlayers})=>{
    const lid='L'+Math.random().toString(36).slice(2,8);
    const pd=await getPlayer(user.id);
    const lobby=new Lobby(lid,{userId:user.id,name:user.name,avatar:user.avatar,socketId:socket.id,isBot:false,back:pd.selectedBack||'back'});
    lobby.setMaxPlayers(maxPlayers||2);
    lobbies.set(lid,lobby);socket.join(lid);socket.data.lobbyId=lid;socket.data.userId=user.id;
    socket.emit('lobby_joined',lobby.toPublic());broadcastLobbies();
  });

  socket.on('set_max_players',n=>{
    const lobby=lobbies.get(socket.data.lobbyId);
    if(!lobby||lobby.creatorId!==socket.data.userId)return;
    lobby.setMaxPlayers(n);
    while(lobby.slots.length>lobby.maxPlayers){
      const bot=lobby.slots.findLast(p=>p.isBot);
      if(bot)lobby.removePlayer(bot.userId);else break;
    }
    io.to(lobby.id).emit('lobby_joined',lobby.toPublic());broadcastLobbies();
  });

  socket.on('join_lobby',async({lobbyId,user})=>{
    const lobby=lobbies.get(lobbyId);if(!lobby||lobby.started||lobby.isFull()){socket.emit('error_msg','Лобби недоступно.');return;}
    const pd=await getPlayer(user.id);
    const ok=lobby.addPlayer({userId:user.id,name:user.name,avatar:user.avatar,socketId:socket.id,isBot:false,back:pd.selectedBack||'back'});
    if(!ok){socket.emit('error_msg','Лобби заполнено.');return;}
    socket.join(lobbyId);socket.data.lobbyId=lobbyId;socket.data.userId=user.id;
    io.to(lobbyId).emit('lobby_joined',lobby.toPublic());broadcastLobbies();
  });

  socket.on('add_bot',()=>{
    const lobby=lobbies.get(socket.data.lobbyId);if(!lobby||lobby.creatorId!==socket.data.userId||lobby.isFull())return;
    const names=['Тень','Ворон','Мрак','Сыщик','Барон','Призрак','Клинок','Молния'];
    lobby.addPlayer({userId:'bot_'+Math.random().toString(36).slice(2,8),name:`🤖 ${names[Math.floor(Math.random()*names.length)]}`,avatar:null,socketId:null,isBot:true,back:'back'});
    io.to(lobby.id).emit('lobby_joined',lobby.toPublic());broadcastLobbies();
  });

  socket.on('remove_slot',uid=>{
    const lobby=lobbies.get(socket.data.lobbyId);if(!lobby||lobby.creatorId!==socket.data.userId)return;
    const p=lobby.slots.find(s=>s.userId===uid&&s.isBot);
    if(p)lobby.removePlayer(uid);
    io.to(lobby.id).emit('lobby_joined',lobby.toPublic());broadcastLobbies();
  });

  socket.on('start_game',()=>{
    const lobby=lobbies.get(socket.data.lobbyId);if(!lobby||lobby.creatorId!==socket.data.userId)return;
    if(lobby.slots.length<2){socket.emit('error_msg','Нужно минимум 2 игрока.');return;}
    lobby.started=true;
    const roomId=lobby.id;
    const room=new Room(roomId,lobby.slots.length);
    rooms.set(roomId,room);
    for(const p of lobby.slots){
      room.addPlayer(p);
      if(!p.isBot&&p.socketId){const s=io.sockets.sockets.get(p.socketId);if(s){s.join(roomId);s.data.roomId=roomId;}}
    }
    startRound(room,true);io.to(roomId).emit('game_started');emitState(room);broadcastLobbies();
  });

  socket.on('leave_lobby',()=>{
    const lobby=lobbies.get(socket.data.lobbyId);if(!lobby)return;
    lobby.removePlayer(socket.data.userId);socket.leave(lobby.id);
    if(lobby.slots.filter(p=>!p.isBot).length===0)lobbies.delete(lobby.id);
    else{if(lobby.creatorId===socket.data.userId&&lobby.slots.length>0)lobby.creatorId=lobby.slots[0].userId;io.to(lobby.id).emit('lobby_joined',lobby.toPublic());}
    socket.data.lobbyId=null;broadcastLobbies();
  });

  socket.on('play',payload=>{
    const room=rooms.get(socket.data.roomId);if(!room)return;
    const result=playCard(room,socket.id,payload);
    if(result?.error)socket.emit('error_msg',result.error);
    else{emitState(room);if(room.pendingVFX.length>0){room.pendingVFX.forEach(v=>io.to(room.id).emit('vfx',v));room.pendingVFX=[];}}
  });

  socket.on('chancellor_pick',keepId=>{
    const room=rooms.get(socket.data.roomId);if(!room)return;
    const s=room.state;if(!s?.pendingChancellor||s.pendingChancellor.socketId!==socket.id)return;
    const{options}=s.pendingChancellor;const kept=options.find(c=>c.id===keepId);const returns=options.filter(c=>c.id!==keepId);
    if(!kept){socket.emit('error_msg','Неверный выбор.');return;}
    const me=s.players.find(p=>p.socketId===socket.id);me.hand=[kept];updateCountess(me);
    shuffle(returns);s.deck.push(...returns);s.pendingChancellor=null;
    logMsg(room,`${me.name} выбрал карту.`);
    nextTurn(room);emitState(room);
  });

  socket.on('surrender',()=>{
    const room=rooms.get(socket.data.roomId);if(!room||!room.state)return;
    const s=room.state;
    const me=s.players.find(p=>p.socketId===socket.id);if(!me)return;
    me.eliminated=true;
    logMsg(room,`💀 ${me.name} сдался!`);
    io.to(room.id).emit('player_surrendered',{name:me.name});
    const alive=s.players.filter(p=>!p.eliminated);
    if(alive.length<=1&&alive[0]){
      endRound(room,alive[0].userId,`${me.name} сдался. Побеждает ${alive[0].name}.`);
    }
    emitState(room);
  });

  socket.on('rematch',()=>{
    const room=rooms.get(socket.data.roomId);if(!room||!room.state?.gameOver)return;
    room.rematchVotes.add(socket.data.userId);
    for(const p of room.players){if(p.isBot)room.rematchVotes.add(p.userId);}
    if(room.rematchVotes.size>=room.players.length){startRound(room,true);io.to(room.id).emit('game_started');emitState(room);}
    else io.to(room.id).emit('rematch_pending',{count:room.rematchVotes.size});
  });

  // ═══ ADMIN EVENTS ═══
  socket.on('admin_loh',()=>{
    const room=rooms.get(socket.data.roomId);if(!room)return;
    if(socket.data.userId!==ADMIN_ID)return;
    io.to(room.id).emit('admin_vfx',{type:'loh'});
  });

  socket.on('throw_tomato',()=>{
    const room=rooms.get(socket.data.roomId);if(!room)return;
    if(socket.data.userId!==ADMIN_ID)return;
    io.to(room.id).emit('tomato_vfx',{});
  });

  socket.on('leave_game',()=>cleanupGame(socket));
  socket.on('disconnect',()=>{
    const lobby=lobbies.get(socket.data.lobbyId);
    if(lobby){lobby.removePlayer(socket.data.userId);if(lobby.slots.filter(p=>!p.isBot).length===0)lobbies.delete(lobby.id);else io.to(lobby.id).emit('lobby_joined',lobby.toPublic());broadcastLobbies();}
    setTimeout(()=>{const room=rooms.get(socket.data.roomId);if(room?.players.find(p=>p.socketId===socket.id))cleanupGame(socket);},30000);
  });
});
function cleanupGame(socket){
  const room=rooms.get(socket.data.roomId);if(!room)return;room.removeBySocket(socket.id);
  if(room.players.filter(p=>!p.isBot).length===0){if(room.roundTimeout)clearTimeout(room.roundTimeout);rooms.delete(room.id);}
  else io.to(room.id).emit('opponent_left');
  socket.leave(socket.data.roomId);socket.data.roomId=null;
}

connectDB().then(()=>{const PORT=process.env.PORT||3000;server.listen(PORT,()=>console.log(`✨ Сервер v11 на порту ${PORT}`));});
