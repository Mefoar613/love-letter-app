// =====================================================================
// Тёмная Дуэль — Frontend v3.4
// =====================================================================
const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

const CARDS = {
  0: { name:'Информатор',      total:2, desc:'Если в конце раунда ты единственный выжил с ним — +1 жетон.' },
  1: { name:'Детектив',        total:6, desc:'Назови карту. Если у соперника она — он выбывает.' },
  2: { name:'Журналист',       total:2, desc:'Тайно посмотри карту в руке соперника.' },
  3: { name:'Громила',         total:2, desc:'Сравните карты. У кого меньше — выбывает.' },
  4: { name:'Продажный коп',   total:2, desc:'Защита от всех эффектов на один ход.' },
  5: { name:'Федерал',         total:2, desc:'Игрок сбрасывает карту и берёт новую.' },
  6: { name:'Теневой брокер',  total:2, desc:'Возьми 2 карты, одну оставь, две верни в колоду.' },
  7: { name:'Босс мафии',      total:1, desc:'Поменяйся картами с соперником.' },
  8: { name:'Роковая женщина', total:1, desc:'Обязан сбросить, если есть 5 или 7.' },
  9: { name:'Компромат',       total:1, desc:'Если сброшен — ты проиграл раунд.' },
};

let lastState = null;
let socket = null;

function openGuessModal(card) {
  const el = document.getElementById('action-modal');
  const grid = document.getElementById('action-options'); grid.innerHTML='';
  const seenCounts = lastState?.me?.seenCounts || {};

  for (let v=0; v<=9; v++) {
    if (v===1) continue;
    const def = CARDS[v];
    const seen = seenCounts[v] || 0;
    
    const opt = document.createElement('div'); opt.className='am-opt';
    opt.innerHTML = `
      <span class="num">${v}</span>
      ${def.name}
      <div style="font-size: 9px; color: var(--gold-b); margin-top: 3px;">Видено: ${seen}/${def.total}</div>
    `;
    opt.addEventListener('click', () => {
      el.classList.remove('show');
      socket.emit('play', { cardId: card.id, guess: v });
    });
    grid.appendChild(opt);
  }
  el.classList.add('show');
}

function showPeek(data) {
  const wrap = document.getElementById('peek-card'); wrap.innerHTML='';
  const nameEl = document.getElementById('peek-card-name');
  const descEl = document.getElementById('peek-card-desc');

  if (data.card) {
    const card = makeCard(data.card, true, 'card--big'); 
    wrap.appendChild(card);
    nameEl.textContent = CARDS[data.card.value].name;
    descEl.textContent = CARDS[data.card.value].desc;
  }
  
  document.getElementById('peek-title').textContent = `У ${data.playerName}`;
  document.getElementById('peek-overlay').classList.add('show');
}

function makeCard(card, faceUp, sizeClass) {
  const el = document.createElement('div');
  el.className = `card ${sizeClass||'card--big'}${faceUp?' face-up':''}`;
  const back = document.createElement('div'); back.className='card-back';
  const bi = document.createElement('img'); bi.src='assets/cards/back.png';
  back.appendChild(bi); el.appendChild(back);
  const face = document.createElement('div'); face.className='card-face';
  if (card) {
    const img = document.createElement('img');
    img.src=`assets/cards/${card.value}.png`;
    face.appendChild(img);
  }
  el.appendChild(face);
  return el;
}

// ... Остальная логика Socket.io и рендера из твоего v3.3
