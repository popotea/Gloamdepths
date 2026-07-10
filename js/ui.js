// ===== UI(DOM):血條、星核條、快捷欄、背包合成、小地圖、選單 =====
const UI = {
  mmDirty: true, invDirty: true,
  pendingSwap: -1, panelOpen: false,
  menuOpen: false, menuView: 'main',
  powerOpen: false,
  talentOpen: false, talentT: 0,
  chatHistory: [], chatHistoryIdx: 0,
  els: {}, mmImage: null, mmT: 0, craftT: 0,
  enhSlot: -1,
  towerPos: null, towerT: 0,
  mapOpen: false, mapZoom: 3, mapPanX: 0, mapPanY: 0, mapDrag: null,
  traderOpen: false, traderT: 0,
};

function $id(s) { return document.getElementById(s); }

function initUI() {
  UI.els = {
    hpfill: $id('hpfill'), hptext: $id('hptext'),
    corefill: $id('corefill'), coretext: $id('coretext'),
    xpfill: $id('xpfill'), xptext: $id('xptext'),
    stafill: $id('stafill'), statext: $id('statext'),
    shards: $id('shards'), wavebox: $id('wavebox'), buffbar: $id('buffbar'),
    hotbar: $id('hotbar'), msglog: $id('msglog'),
    chatlog: $id('chatlog'), chatbox: $id('chatbox'), chatInput: $id('chatInput'),
    invpanel: $id('invpanel'), invgrid: $id('invgrid'), craftlist: $id('craftlist'), crafttabs: $id('crafttabs'),
    enhPanel: $id('enhPanel'),
    towerPanel: $id('towerPanel'), towerBody: $id('towerBody'),
    traderPanel: $id('traderPanel'),
    overlay: $id('overlay'), minimap: $id('minimap'),
    mapPanel: $id('mapPanel'), mapCanvas: $id('mapCanvas'), mapTip: $id('mapTip'),
    hostBtn: $id('hostBtn'), roomcode: $id('roomcode'),
    deathbanner: $id('deathbanner'),
    menuPanel: $id('menuPanel'),
    powerPanel: $id('powerPanel'),
    talentPanel: $id('talentPanel'), talentbadge: $id('talentbadge'),
  };
  UI.els.talentbadge.onclick = () => toggleTalentPanel(true);
  // 快捷欄 8 格
  for (let i = 0; i < 8; i++) {
    const d = document.createElement('div');
    d.className = 'slot';
    d.dataset.i = i;
    d.innerHTML = `<span class="key">${i + 1}</span><span class="icon"></span><span class="cnt"></span><span class="dur"></span>`;
    d.onclick = () => { const me = myPlayer(); if (me) { me.sel = i; UI.invDirty = true; } };
    UI.els.hotbar.appendChild(d);
  }
  // 背包 32 格(左鍵交換, 右鍵開強化面板, 可拖拽到箭塔面板的彈藥格補箭)
  for (let i = 0; i < INV_SIZE; i++) {
    const d = document.createElement('div');
    d.className = 'slot' + (i < 8 ? ' hotrow' : '');
    d.dataset.i = i;
    d.draggable = true;
    d.innerHTML = `<span class="icon"></span><span class="cnt"></span><span class="dur"></span>`;
    d.onclick = (ev) => onInvClick(i, ev.shiftKey);
    d.oncontextmenu = (ev) => { ev.preventDefault(); openEnhPanel(i); };
    d.ondragstart = (ev) => {
      const me = myPlayer();
      const s = me && me.inv[i];
      if (!s) { ev.preventDefault(); return; }
      ev.dataTransfer.setData('text/plain', String(i));
    };
    UI.els.invgrid.appendChild(d);
  }
  UI.els.hostBtn.onclick = openRoom;
  UI.els.roomcode.onclick = () => {
    navigator.clipboard?.writeText(NET.code);
    showMsg('📋 房號已複製:' + NET.code);
  };
  $id('btnSortInv').onclick = () => {
    const me = myPlayer();
    if (!me) return;
    UI.pendingSwap = -1;
    if (NET.isHost()) sortInventory(me);
    else NET.act({ t: 'sort_inv' });
    UI.invDirty = true;
  };
  bindMapPanel();
}

function myPlayer() { return G.players.get(G.myId); }

function onInvClick(i, shift) {
  const me = myPlayer();
  if (!me) return;
  // Shift+左鍵:對半拆堆到最近的空格,不進入交換流程(取消任何待交換選取)
  if (shift) {
    UI.pendingSwap = -1;
    if (NET.isHost()) splitStack(me, i);
    else NET.act({ t: 'split', slot: i });
    UI.invDirty = true;
    return;
  }
  if (UI.pendingSwap < 0) { UI.pendingSwap = i; }
  else {
    const a = UI.pendingSwap, b = i;
    UI.pendingSwap = -1;
    if (a !== b) {
      if (NET.isHost()) swapSlots(me, a, b);
      else { swapSlots(me, a, b); NET.act({ t: 'swap', a, b }); } // 本地先換,房主快照會校正
    }
  }
  UI.invDirty = true;
}

function showMsg(text) {
  const log = UI.els.msglog;
  if (!log) return;
  const d = document.createElement('div');
  d.className = 'msg';
  d.textContent = text;
  log.prepend(d);
  while (log.children.length > 6) log.lastChild.remove();
  setTimeout(() => { d.classList.add('fade'); setTimeout(() => d.remove(), 900); }, 6000);
}

// 聊天訊息不再自動淡出——保留在紀錄裡,超過上限才把最舊的擠掉(捲動可回看)
const CHAT_KEEP = 30;
function showChat(name, text) {
  const log = UI.els.chatlog;
  if (!log) return;
  const d = document.createElement('div');
  d.className = 'chatmsg';
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = name + ':';
  d.appendChild(who);
  d.appendChild(document.createTextNode(text));
  log.prepend(d);
  while (log.children.length > CHAT_KEEP) log.lastChild.remove();
}

function openChat() {
  if (!G.started || UI.menuOpen) return;
  UI.els.chatbox.classList.remove('hidden');
  UI.els.chatInput.value = '';
  UI.chatHistoryIdx = UI.chatHistory.length; // 每次打開聊天欄,history 游標歸位到最新
  UI.els.chatInput.focus();
}

function closeChat() {
  UI.els.chatbox.classList.add('hidden');
  UI.els.chatInput.blur();
}

// 隱藏秘笈指令:效果只有輸入的人自己看得到回饋,不會廣播給其他玩家、不留聊天紀錄,
// 刻意不寫進任何操作說明/UI 提示裡——想用要嘛自己打 /power,要嘛知道要打開選單看指令列表。
// /power              開啟秘笈選單(可滑鼠點按鈕,也可以直接看到對應指令自己打)
// /power <action> [arg] [num]  直接執行,例如 /power spawn hunter 3、/power xp 500
function tryDebugCommand(text) {
  const me = myPlayer();
  if (!me || !text.startsWith('/')) return false;
  const parts = text.slice(1).trim().split(/\s+/).filter(Boolean);
  const head = (parts[0] || '').toLowerCase();
  if (head === 'give_all') { execPower('infinite'); return true; }
  if (head === 'power') {
    if (parts.length === 1) { togglePowerPanel(); return true; }
    const action = (parts[1] || '').toLowerCase();
    const argRaw = parts[2] || '';
    const arg = argRaw.toLowerCase();
    let num;
    if (parts[3] !== undefined && !isNaN(+parts[3])) num = +parts[3];
    else if (argRaw !== '' && !isNaN(+argRaw)) num = +argRaw;
    execPower(action, arg, num);
    return true;
  }
  return false;
}

// 統一的秘笈執行入口:選單按鈕與手打指令都呼叫這裡,效果保證一致。
// light(全地圖開亮)只影響自己瀏覽器的小地圖顯示,純本地效果,host/client 都一樣處理、
// 不需要問過房主;其餘動作都是房主權威(自己是房主就地執行,否則送出請求給房主處理)。
function execPower(action, arg, num) {
  const me = myPlayer();
  if (!me) return;
  if (action === 'light') {
    G.explored.fill(1);
    UI.mmDirty = true;
    showMsg('🗺️ 全地圖已在小地圖上顯示');
    return;
  }
  if (NET.isHost()) {
    const t = runPowerCmd(me, action, arg, num);
    if (t) showMsg(t);
  } else {
    NET.act({ t: 'power', action, arg, num });
  }
}

// 秘笈選單內容:每一項同時附上真正的指令文字,滑鼠點按鈕跟自己手打是同一件事
const POWER_MENU = [
  { cat: '🗺️ 世界', items: [
    { label: '全地圖開亮', cmd: '/power light' },
    { label: '傳送回星核', cmd: '/power home' },
  ] },
  { cat: '❤️ 玩家', items: [
    { label: '補滿血量', cmd: '/power heal' },
    { label: '切換無敵', cmd: '/power godmode' },
    { label: '資源無限', cmd: '/power infinite' },
    { label: '+500 經驗', cmd: '/power xp 500' },
    { label: '+3 天賦點', cmd: '/power talentpt 3' },
  ] },
  { cat: '💠 星核', items: [
    { label: '星核灌滿', cmd: '/power corefull' },
    { label: '獲得碎片', cmd: '/power shard' },
  ] },
  { cat: '🌊 暗潮', items: [
    { label: '立即觸發暗潮', cmd: '/power wavenow' },
    { label: '清除暗潮怪物', cmd: '/power waveclear' },
  ] },
  { cat: '👹 召喚怪物', items: [
    ...Object.keys(ENEMY_TYPES).map(type => ({ label: ENEMY_TYPES[type].name, cmd: `/power spawn ${type}` })),
    { label: '清除場上怪物', cmd: '/power clearmobs' },
  ] },
  { cat: '🐄 召喚動物', items:
    Object.keys(ANIMAL_TYPES).map(type => ({ label: ANIMAL_TYPES[type].name, cmd: `/power animal ${type}` })),
  },
];

function togglePowerPanel(open) {
  UI.powerOpen = open === undefined ? !UI.powerOpen : open;
  UI.els.powerPanel.classList.toggle('hidden', !UI.powerOpen);
  if (UI.powerOpen) {
    UI.panelOpen = false;
    UI.els.invpanel.classList.add('hidden');
    closeTowerPanel();
    renderPowerPanel();
  }
}

function renderPowerPanel() {
  const panel = UI.els.powerPanel;
  let html = `<h2>🎮 秘笈選單</h2>
    <p class="hint">點按鈕直接執行,或在聊天輸入框(Enter 開啟)直接打指令,例如 <code>/power spawn hunter 3</code></p>`;
  for (const group of POWER_MENU) {
    html += `<h3>${group.cat}</h3><div class="power-grid">`;
    for (const it of group.items) {
      html += `<button class="power-btn" data-cmd="${it.cmd}">${it.label}<code>${it.cmd}</code></button>`;
    }
    html += `</div>`;
  }
  html += `<div class="btnrow"><button id="powerClose">關閉(Esc)</button></div>`;
  panel.innerHTML = html;
  panel.querySelectorAll('.power-btn').forEach(btn => {
    btn.onclick = () => tryDebugCommand(btn.dataset.cmd);
  });
  $id('powerClose').onclick = () => togglePowerPanel(false);
}

// ===== 天賦面板(T 鍵/點 HUD 徽章開啟):自由分配升級獲得的天賦點 =====
function toggleTalentPanel(open) {
  UI.talentOpen = open === undefined ? !UI.talentOpen : open;
  UI.els.talentPanel.classList.toggle('hidden', !UI.talentOpen);
  if (UI.talentOpen) {
    togglePowerPanel(false);
    UI.talentT = 0;
    renderTalentPanel();
  }
}

// 分配走房主權威:自己是房主直接執行,客戶端送請求、靠快照回來的 talents/pts 刷新面板
function execTalent(id) {
  const me = myPlayer();
  if (!me) return;
  if (NET.isHost()) { applyTalent(me, id); renderTalentPanel(); }
  else NET.act({ t: 'talent', id });
}

function renderTalentPanel() {
  const me = myPlayer();
  const panel = UI.els.talentPanel;
  if (!me) return;
  const pts = me.talentPts | 0;
  let html = `<h2>🌟 天賦 <span class="enh-lv">剩餘點數 ${pts}</span></h2>
    <p class="hint">升級獲得天賦點(每級 1 點,滿級共 ${LEVEL_CFG.maxLv - 1} 點);總階數比點數多,想清楚再點,這輪拿不滿全部。</p>`;
  for (const id in TALENTS) {
    const t = TALENTS[id];
    const r = talRank(me, id);
    const pips = '●'.repeat(r) + '○'.repeat(t.max - r);
    const can = pts > 0 && r < t.max;
    html += `<div class="talent-row">
      <span class="talent-icon">${t.icon}</span>
      <span class="talent-info"><b>${t.name}</b> <span class="talent-pips">${pips}</span><br><span class="hint">${t.desc}</span></span>
      <button class="talent-btn" data-id="${id}" ${can ? '' : 'disabled'}>${r >= t.max ? '已滿' : '+1 階'}</button>
    </div>`;
  }
  html += `<div class="btnrow"><button id="talentClose">關閉(T / Esc)</button></div>`;
  panel.innerHTML = html;
  panel.querySelectorAll('.talent-btn').forEach(btn => {
    btn.onclick = () => execTalent(btn.dataset.id);
  });
  $id('talentClose').onclick = () => toggleTalentPanel(false);
}

function sendChat() {
  const text = UI.els.chatInput.value.trim().slice(0, 80);
  closeChat();
  if (!text) return;
  // 輸入歷史:按 ↑/↓ 可叫回之前打過的內容(聊天訊息與 /power 指令都算),連續重複的不重存
  if (UI.chatHistory[UI.chatHistory.length - 1] !== text) UI.chatHistory.push(text);
  if (UI.chatHistory.length > 50) UI.chatHistory.shift();
  UI.chatHistoryIdx = UI.chatHistory.length;
  if (tryDebugCommand(text)) return;
  const me = myPlayer();
  if (!me) return;
  if (NET.isHost()) {
    showChat(me.name, text);
    NET.sendAll({ t: 'chat', name: me.name, text });
  } else {
    NET.act({ t: 'chat', name: me.name, text });
  }
}

// ===== 每幀 UI 更新(內部有節流)=====
function uiTick(dt) {
  const me = myPlayer();
  if (!G.started || !me) return;

  // 血條 / 星核
  UI.els.hpfill.style.width = (me.hp / me.maxhp * 100) + '%';
  UI.els.hptext.textContent = `❤ ${Math.ceil(me.hp)}/${me.maxhp}`;
  UI.els.stafill.style.width = (me.stamina || 0) + '%';
  UI.els.statext.textContent = `⚡ ${Math.ceil(me.stamina || 0)}` + (me.dashT > 0 ? ' 衝刺中!' : '');
  const eR = G.core.energy / CORE_CFG.maxE;
  UI.els.corefill.style.width = (eR * 100) + '%';
  UI.els.corefill.classList.toggle('low', eR < 0.3);
  UI.els.coretext.textContent = `💠 星核 ${Math.ceil(G.core.energy)}`;
  UI.els.shards.textContent = '🔷'.repeat(G.core.shards) + '◇'.repeat(Math.max(0, CORE_CFG.needShards - G.core.shards));

  // 料理 buff 列(有 buff 才顯示;客戶端的 buffs 由快照同步)
  {
    const list = me.buffs ? Object.entries(me.buffs).filter(([, b]) => b && b.t > 0) : [];
    const html = list.map(([k, b]) => {
      const info = BUFF_INFO[k] || { icon: '✨', name: k };
      return `<span class="buff">${info.icon} ${info.name} ${Math.ceil(b.t)}s</span>`;
    }).join('');
    if (UI.els.buffbar.innerHTML !== html) UI.els.buffbar.innerHTML = html;
  }

  // 等級 / 經驗
  const lv = me.lv || 1;
  if (lv >= LEVEL_CFG.maxLv) {
    UI.els.xpfill.style.width = '100%';
    UI.els.xptext.textContent = `⭐ Lv.${lv} (滿級)`;
  } else {
    const need = xpToNext(lv);
    UI.els.xpfill.style.width = (Math.min(1, (me.xp || 0) / need) * 100) + '%';
    UI.els.xptext.textContent = `⭐ Lv.${lv}  ${Math.floor(me.xp || 0)}/${need}`;
  }

  // 暗潮狀態
  const w = G.wave;
  if (w.state === 'calm') {
    const t = Math.max(0, Math.ceil(w.timer));
    UI.els.wavebox.textContent = `🌊 下一波暗潮 ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    UI.els.wavebox.className = '';
  } else if (w.state === 'warn') {
    UI.els.wavebox.textContent = `⚠️ 暗潮來襲倒數 ${Math.max(0, Math.ceil(w.timer))} 秒!`;
    UI.els.wavebox.className = 'warn';
  } else {
    UI.els.wavebox.textContent = (w.final ? '🌑 最終暗潮!' : `🌊 第 ${w.n} 波暗潮!`) + ` 剩餘 ${w.alive ?? '?'} 隻`;
    UI.els.wavebox.className = 'warn';
  }

  // 死亡橫幅
  UI.els.deathbanner.classList.toggle('hidden', !me.dead);
  if (me.dead) UI.els.deathbanner.textContent = `💀 你倒下了…… ${Math.max(0, Math.ceil(me.respawnT ?? 0))} 秒後在星核重生`;

  if (UI.invDirty) { UI.invDirty = false; refreshSlots(); }

  // 合成清單(開著才更新,節流)
  if (UI.panelOpen) {
    UI.craftT -= dt;
    if (UI.craftT <= 0) { UI.craftT = 0.4; refreshCraft(); }
  }

  // 天賦點提示徽章(有點數沒花才顯示);面板開著時節流刷新(客戶端等快照回寫 talents/pts)
  const pts = me.talentPts | 0;
  UI.els.talentbadge.classList.toggle('hidden', pts <= 0);
  if (pts > 0) UI.els.talentbadge.textContent = `🌟 天賦點 ×${pts}(按 T 分配)`;
  if (UI.talentOpen) {
    UI.talentT -= dt;
    if (UI.talentT <= 0) { UI.talentT = 0.3; renderTalentPanel(); }
  }

  // 小地圖
  UI.mmT -= dt;
  if (UI.mmT <= 0) { UI.mmT = 0.4; drawMinimap(); }
  if (UI.mapOpen) drawFullMap(); // 大地圖開著時每幀刷新玩家位置

  // 箭塔面板(開著才更新,節流;走遠或塔被拆掉就自動關閉)
  if (UI.towerPos) {
    UI.towerT -= dt;
    if (UI.towerT <= 0) {
      UI.towerT = 0.3;
      const { x, y } = UI.towerPos;
      const o = objAt(x, y);
      if (!o || o.type !== 'archer_tower' || dist(me.x, me.y, x + 0.5, y + 0.5) > 4.5) closeTowerPanel();
      else renderTowerPanel();
    }
  }

  // 商人交易面板(開著才更新,節流;走遠就自動關閉——商人不會動也不會消失,不用檢查存在性)
  if (UI.traderOpen) {
    UI.traderT -= dt;
    if (UI.traderT <= 0) {
      UI.traderT = 0.3;
      const trader = G.traders[0];
      if (!trader || dist(me.x, me.y, trader.x, trader.y) > 4.5) closeTraderPanel();
      else renderTraderPanel();
    }
  }

  UI.els.hostBtn.classList.toggle('hidden', !(NET.isHost() && NET.mode === 'single'));
}

function slotHTML(el, s, selected, pending) {
  el.querySelector('.icon').textContent = s ? ITEMS[s.id].icon : '';
  el.querySelector('.cnt').textContent = s && s.count > 1 ? s.count : (s && s.lv ? '+' + s.lv : '');
  el.style.background = s && ITEMS[s.id].tint ? ITEMS[s.id].tint : '';
  el.classList.toggle('sel', !!selected);
  el.classList.toggle('pending', !!pending);
  // 耐久條:滿的不畫(乾淨),磨損才出現;歸零整格變紅+圖示轉灰(損壞停用)
  const durEl = el.querySelector('.dur');
  let durTip = '';
  let broken = false;
  if (durEl) {
    const max = s && ITEMS[s.id].dur ? maxDur(s) : 0;
    const cur = max ? (s.dur ?? max) : 0;
    if (max && cur < max) {
      durEl.style.display = 'block';
      durEl.style.width = Math.max(4, Math.round(cur / max * 76)) + '%';
      durEl.style.background = cur === 0 ? '#ff5d5d' : cur / max < 0.3 ? '#ffb35c' : '#7dff8e';
      durTip = `\n耐久 ${cur}/${max}` + (cur === 0 ? '(已損壞,右鍵開面板修理)' : '');
      broken = cur === 0;
    } else durEl.style.display = 'none';
  }
  el.classList.toggle('broken', broken);
  el.title = s ? ITEMS[s.id].name + (s.lv ? ` +${s.lv}` : '') + durTip + (ITEMS[s.id].desc ? '\n' + ITEMS[s.id].desc : '') : '';
}

function refreshSlots() {
  const me = myPlayer();
  if (!me) return;
  [...UI.els.hotbar.children].forEach((el, i) => slotHTML(el, me.inv[i], me.sel === i));
  [...UI.els.invgrid.children].forEach((el, i) => slotHTML(el, me.inv[i], false, UI.pendingSwap === i));
  if (UI.enhSlot >= 0) renderEnhPanel();
}

// ===== 箭塔面板:右鍵箭塔開啟,像儲物櫃一樣把箭矢拖進彈藥格補彈 =====
function openTowerPanel(x, y) {
  const o = objAt(x, y);
  if (!o || o.type !== 'archer_tower') { closeTowerPanel(); return; }
  UI.towerPos = { x, y };
  UI.towerT = 0;
  UI.els.towerPanel.classList.remove('hidden');
  // 補彈整個流程是把背包裡的箭矢拖進彈藥格,背包一定要跟著開著、格子才拖得出來
  UI.panelOpen = true;
  UI.els.invpanel.classList.remove('hidden');
  UI.pendingSwap = -1;
  UI.enhSlot = -1;
  UI.els.enhPanel.classList.add('hidden');
  togglePowerPanel(false);
  refreshSlots();
  UI.craftT = 0;
  renderTowerPanel();
}
function closeTowerPanel() {
  UI.towerPos = null;
  UI.els.towerPanel.classList.add('hidden');
}
function renderTowerPanel() {
  if (!UI.towerPos) return;
  const { x, y } = UI.towerPos;
  const o = objAt(x, y);
  if (!o || o.type !== 'archer_tower') { closeTowerPanel(); return; }
  const ammo = o.ammo || 0, max = ARCHER_TOWER_CFG.maxAmmo;
  const body = UI.els.towerBody;
  body.innerHTML = `
    <div class="tower-row">
      <div id="towerAmmoSlot" class="slot tower-slot">
        <span class="icon">${ammo > 0 ? ITEMS.arrow.icon : ''}</span>
        <span class="cnt">${ammo > 0 ? ammo : ''}</span>
      </div>
      <div class="tower-info">
        <p>彈藥 <b>${ammo} / ${max}</b></p>
        <p class="hint">傷害 ${ARCHER_TOWER_CFG.dmg} · 射程 ${ARCHER_TOWER_CFG.range} 格 · ${o.off ? '<span class="warn">已關閉</span>' : '運作中'}</p>
      </div>
    </div>
    <div class="btnrow">
      <button id="towerToggle">${o.off ? '▶️ 開啟' : '⏸️ 關閉'}</button>
      <button id="towerClose">✖ 關閉面板</button>
    </div>`;
  $id('towerClose').onclick = closeTowerPanel;
  $id('towerToggle').onclick = () => {
    if (NET.isHost()) doToggleTower(myPlayer(), x, y);
    else NET.act({ t: 'toggle_tower', x, y });
  };
  const slot = $id('towerAmmoSlot');
  slot.ondragover = (ev) => ev.preventDefault();
  slot.ondrop = (ev) => {
    ev.preventDefault();
    const from = +ev.dataTransfer.getData('text/plain');
    const me = myPlayer();
    if (!me || isNaN(from) || !me.inv[from] || me.inv[from].id !== 'arrow') return;
    if (NET.isHost()) doFillTower(me, x, y);
    else NET.act({ t: 'fill_tower', x, y });
  };
}

// ===== NPC 商人面板:右鍵商人開啟,仿 /power 秘笈選單的點擊式清單(點一下立即成交) =====
function openTraderPanel() {
  UI.traderOpen = true;
  UI.traderT = 0;
  UI.els.traderPanel.classList.remove('hidden');
  togglePanel(false); togglePowerPanel(false); toggleTalentPanel(false); closeTowerPanel();
  renderTraderPanel();
}
function closeTraderPanel() {
  UI.traderOpen = false;
  UI.els.traderPanel.classList.add('hidden');
}
function execTrade(offerIdx) {
  const me = myPlayer();
  if (!me) return;
  if (NET.isHost()) {
    const r = doTrade(me, offerIdx);
    if (r && r.err) showMsg('⚠️ ' + r.err);
    renderTraderPanel();
  } else {
    NET.act({ t: 'trade', idx: offerIdx });
  }
}
function renderTraderPanel() {
  if (!UI.traderOpen) return;
  const me = myPlayer();
  if (!me) return;
  const n = G.core.shards;
  const offers = traderOffers();
  let html = `<h2>${TRADER_CFG.icon} ${TRADER_CFG.name}</h2>
    <p class="hint">已擊敗 ${n}/3 座神殿,擊敗更多神殿解鎖更好的兌換。點一下立即成交(比例固定)。</p>
    <div class="power-grid">`;
  offers.forEach((o, i) => {
    const giveText = Object.entries(o.give).map(([id, c]) => `${ITEMS[id].icon}${ITEMS[id].name}×${c}`).join(' + ');
    const getText = Object.entries(o.get).map(([id, c]) => `${ITEMS[id].icon}${ITEMS[id].name}×${c}`).join(' + ');
    const can = canAfford(me, o.give);
    html += `<button class="power-btn trade-btn" data-idx="${i}" ${can ? '' : 'disabled'}>
      <span>${giveText}</span><code>→ ${getText}</code></button>`;
  });
  html += `</div><div class="btnrow"><button id="traderClose">關閉(Esc)</button></div>`;
  UI.els.traderPanel.innerHTML = html;
  UI.els.traderPanel.querySelectorAll('.trade-btn').forEach(btn => {
    btn.onclick = () => execTrade(+btn.dataset.idx);
  });
  $id('traderClose').onclick = closeTraderPanel;
}

// ===== 衝裝(強化卷軸)面板:右鍵背包格開啟 =====
function openEnhPanel(slot) {
  const me = myPlayer();
  if (!me) return;
  const s = me.inv[slot];
  if (!s || !isEnhancable(s.id)) { UI.enhSlot = -1; UI.els.enhPanel.classList.add('hidden'); return; }
  UI.enhSlot = slot;
  UI.els.enhPanel.classList.remove('hidden');
  renderEnhPanel();
}

function renderEnhPanel() {
  const me = myPlayer();
  const panel = UI.els.enhPanel;
  if (!me || UI.enhSlot < 0) { panel.classList.add('hidden'); return; }
  const s = me.inv[UI.enhSlot];
  if (!s || !isEnhancable(s.id)) { UI.enhSlot = -1; panel.classList.add('hidden'); return; }
  const it = ITEMS[s.id];
  const lv = s.lv || 0;
  const maxed = lv >= ENH_CFG.maxLv;
  const near = stationNear(me, 'workbench');
  const need = maxed ? 0 : ENH_CFG.scrolls(lv);
  const have = countItem(me, 'enh_scroll');
  const rate = maxed ? 0 : Math.round(ENH_CFG.rate[lv] * 100);
  const bonus = it.armor ? `護甲 +${Math.round(ENH_CFG.armorPer * 100)}%/級` : `攻擊力 +${Math.round(ENH_CFG.dmgPer * 100)}%/級`;
  // 耐久/修理區:只有帶 dur 的裝備顯示;修理成本 = 合成成本一半,靠近工作台才能修
  let durHTML = '';
  const dMax = it.dur ? maxDur(s) : 0;
  if (dMax) {
    const dCur = s.dur ?? dMax;
    const cost = repairCostOf(s.id);
    const costText = Object.entries(cost).map(([k, n]) => `${ITEMS[k].icon}×${n}`).join(' ');
    const canRepair = dCur < dMax && near && canAfford(me, cost);
    durHTML = `
    <p>🛡️ 耐久 <b${dCur === 0 ? ' class="warn"' : ''}>${dCur} / ${dMax}</b>${dCur === 0 ? '(已損壞,修好前無法使用)' : ''}
      · 修理費用 ${costText}${near ? '' : '<span class="warn"> · 需靠近工作台</span>'}</p>
    <div class="btnrow"><button id="enhRepair" ${canRepair ? '' : 'disabled'}>🔧 修理(耐久回滿)</button></div>`;
  }
  panel.innerHTML = `
    <div class="enh-row">
      <span class="enh-icon">${it.icon}</span>
      <b>${it.name}</b> <span class="enh-lv">目前 +${lv}${maxed ? '(已滿級)' : ` / 上限 +${ENH_CFG.maxLv}`}</span>
    </div>
    <p class="hint">${bonus}${it.dur ? `,耐久上限 +15%/級` : ''};成功只消耗卷軸不會讓裝備變差。</p>
    ${maxed ? '' : `<p>需要 <b>${need}</b> 張強化卷軸(目前有 ${have} 張),成功率 <b>${rate}%</b>${near ? '' : '<span class="warn"> · 需靠近工作台</span>'}</p>`}
    ${durHTML}
    <div class="btnrow">
      <button id="enhGo" ${maxed || !near || have < need ? 'disabled' : ''}>✨ 強化 (+${lv} → +${lv + 1})</button>
      <button id="enhClose">✖ 關閉</button>
    </div>`;
  $id('enhClose').onclick = () => { UI.enhSlot = -1; panel.classList.add('hidden'); };
  if (dMax) {
    $id('enhRepair').onclick = () => {
      if (NET.isHost()) {
        const r = doRepair(me, UI.enhSlot);
        if (r.err) showMsg('⚠️ ' + r.err);
        UI.invDirty = true;
      } else {
        NET.act({ t: 'repair', slot: UI.enhSlot });
      }
    };
  }
  if (!maxed) {
    $id('enhGo').onclick = () => {
      if (NET.isHost()) {
        const r = doEnh(me, UI.enhSlot);
        if (r.err) showMsg('⚠️ ' + r.err);
        UI.invDirty = true;
      } else {
        NET.act({ t: 'enh', slot: UI.enhSlot });
      }
    };
  }
}

// 依配方產出的物品欄位推斷分類(不额外改資料結構)
const RECIPE_CATS = [
  { key: 'tool',  name: '⛏️ 工具', test: it => !!it.pick || !!it.till || !!it.fish },
  { key: 'weapon',name: '⚔️ 武器', test: it => !!it.sword || !!it.ranged },
  { key: 'armor', name: '🛡️ 防具', test: it => !!it.armor },
  { key: 'build', name: '🏗️ 建築', test: it => !!it.place || it.placeTile !== undefined },
  { key: 'misc',  name: '📦 素材/其他', test: () => true },
];
function recipeCat(r) {
  const it = ITEMS[r.out];
  return RECIPE_CATS.find(c => c.test(it)).key;
}

function refreshCraft() {
  const me = myPlayer();
  const list = UI.els.craftlist;
  const tabs = UI.els.crafttabs;
  if (!list.dataset.built) {
    list.dataset.built = '1';
    UI.recipeEls = RECIPES.map((r, i) => {
      const d = document.createElement('div');
      d.className = 'recipe';
      const cost = Object.entries(r.cost).map(([id, n]) => `${ITEMS[id].icon}×${n}`).join(' ');
      const st = r.station === 'workbench' ? '🛠️' : r.station === 'furnace' ? '🔥' : '✋';
      d.innerHTML = `<span class="ricon">${ITEMS[r.out].icon}</span>
        <span class="rname">${ITEMS[r.out].name}${r.n > 1 ? '×' + r.n : ''}</span>
        <span class="rcost">${cost}</span><span class="rst">${st}</span>`;
      d.title = (ITEMS[r.out].desc || '') + (r.station ? `\n需靠近${r.station === 'furnace' ? '熔爐' : '工作台'}` : '');
      d.onclick = () => {
        const p = myPlayer();
        if (!p) return;
        if (NET.isHost()) {
          const err = craftRecipe(p, i);
          if (err) showMsg('⚠️ ' + err);
          else { SFX.craft(); UI.invDirty = true; }
        } else NET.act({ t: 'craft', ri: i });
      };
      return d;
    });
    UI.craftTab = RECIPE_CATS[0].key;
    tabs.innerHTML = '';
    UI.tabEls = {};
    for (const c of RECIPE_CATS) {
      const b = document.createElement('button');
      b.className = 'ctab';
      b.textContent = c.name;
      b.onclick = () => { UI.craftTab = c.key; refreshCraft(); };
      tabs.appendChild(b);
      UI.tabEls[c.key] = b;
    }
  }

  const order = RECIPES.map((r, i) => ({ i, r, cat: recipeCat(r), ok: canAfford(me, r.cost) && stationNear(me, r.station) }));
  for (const o of order) UI.recipeEls[o.i].classList.toggle('ok', o.ok);

  for (const c of RECIPE_CATS) UI.tabEls[c.key].classList.toggle('active', c.key === UI.craftTab);

  // 只顯示目前分頁的配方,類別內材料足夠優先
  list.innerHTML = '';
  const items = order.filter(o => o.cat === UI.craftTab).sort((a, b) => b.ok - a.ok);
  for (const o of items) list.appendChild(UI.recipeEls[o.i]);
}

function togglePanel(open) {
  UI.panelOpen = open === undefined ? !UI.panelOpen : open;
  UI.els.invpanel.classList.toggle('hidden', !UI.panelOpen);
  UI.pendingSwap = -1;
  UI.enhSlot = -1;
  UI.els.enhPanel.classList.add('hidden');
  closeTowerPanel();
  if (UI.panelOpen) { togglePowerPanel(false); refreshSlots(); UI.craftT = 0; }
}

// ===== ESC 選單(設定 / 存檔資訊)=====
function toggleMenu(open) {
  UI.menuOpen = open === undefined ? !UI.menuOpen : open;
  UI.els.menuPanel.classList.toggle('hidden', !UI.menuOpen);
  if (UI.menuOpen) { UI.menuView = 'main'; renderMenu(); }
}

function saveSizeText() {
  let raw = null;
  try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { }
  if (!raw) return '目前尚無存檔';
  return `約 ${(raw.length / 1024).toFixed(1)} KB`;
}

function renderMenu() {
  const panel = UI.els.menuPanel;
  if (UI.menuView === 'main') {
    // 暫停只在單機模式提供:多人共用同一個模擬,房主暫停會連帶卡住其他人的遊戲
    const canPause = NET.mode === 'single';
    panel.innerHTML = `
      <h2>選單${G.paused ? ' <span class="warn">(已暫停)</span>' : ''}</h2>
      <div class="btnrow col">
        <button id="mResume">▶️ 返回遊戲</button>
        ${canPause ? `<button id="mPause">${G.paused ? '▶️ 繼續遊戲' : '⏸️ 暫停遊戲'}</button>` : ''}
        <button id="mSettings">⚙️ 設定</button>
      </div>`;
    $id('mResume').onclick = () => toggleMenu(false);
    if (canPause) $id('mPause').onclick = () => { G.paused = !G.paused; renderMenu(); };
    $id('mSettings').onclick = () => { UI.menuView = 'settings'; renderMenu(); };
    return;
  }
  // ---- 設定 ----
  const isHost = NET.isHost();
  let originNote;
  if (location.protocol === 'file:') {
    originNote = `目前是用「雙擊開啟檔案」的方式遊玩,存檔會存在瀏覽器對這個資料夾路徑的
      本機儲存空間裡,並不是一般看得到的檔案(不在 D:\\game 資料夾內),換瀏覽器或清瀏覽器資料會遺失。`;
  } else {
    originNote = `存檔存在<b>瀏覽器的 localStorage</b>裡,綁定於網址
      <code>${location.origin}</code>,不是電腦裡看得到的檔案,換瀏覽器、換裝置、
      或清除該瀏覽器的「網站資料/瀏覽資料」都會遺失存檔。`;
  }
  let body;
  if (isHost) {
    body = `
      <p>💾 <b>地圖存檔存在房主(你)的電腦裡</b>,每 30 秒自動存一次,關閉分頁前也會存一次。</p>
      <p>${originNote}</p>
      <p>存檔識別碼(key):<code>${SAVE_KEY}</code><br>目前存檔大小:${saveSizeText()}</p>
      <p>📤 <b>匯出成檔案</b>:下載一份地圖存檔到電腦,可以傳給別人。若你之後要關機、
      或想把房主交給別人,對方可以在主選單用「匯入存檔檔案」讀取這份檔案,以新房主身分
      開房繼續(地圖、怪物進度、所有人的背包都會保留)。</p>
      <div class="btnrow">
        <button id="mSaveNow">💾 立即存檔</button>
        <button id="mExportSave" ${hasSave() ? '' : 'disabled'}>📤 匯出成檔案</button>
        <button id="mClearSave">🗑️ 清除存檔</button>
      </div>`;
  } else {
    body = `
      <p>你是以<b>連線客戶端</b>身分遊玩,存檔只會存在<b>房主</b>的電腦裡,不會存在你這台電腦。</p>
      <p>你的背包會以你的名字保存在房主那邊,下次用<b>同樣的名字</b>加入同一位房主的房間,
      就能拿回目前的裝備與血量。</p>`;
  }
  panel.innerHTML = `
    <h2>設定</h2>
    ${body}
    <p>🔄 <b>遊戲有更新但畫面沒變?</b>瀏覽器可能還在用快取的舊檔案,點下面按鈕強制重新抓取最新版本
    (不會影響存檔,但網頁本身無法清除瀏覽器的「瀏覽紀錄」,那是瀏覽器設定裡的功能)。</p>
    <div class="btnrow">
      <button id="mForceUpdate">🔄 強制更新(清快取重載)</button>
    </div>
    <div class="btnrow"><button id="mBack">← 返回</button></div>`;
  $id('mBack').onclick = () => { UI.menuView = 'main'; renderMenu(); };
  $id('mForceUpdate').onclick = async () => {
    if (!confirm('確定要強制更新嗎?會重新載入頁面(存檔不受影響)。')) return;
    try {
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      if (navigator.serviceWorker) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
    } catch (e) { }
    const u = new URL(location.href);
    u.searchParams.set('_t', Date.now());
    location.replace(u.toString());
  };
  if (isHost) {
    $id('mSaveNow').onclick = () => { saveGame(); renderMenu(); };
    $id('mExportSave').onclick = () => {
      let raw = null;
      try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { }
      if (!raw) { showMsg('⚠️ 尚無存檔可匯出'); return; }
      const blob = new Blob([raw], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      a.href = url; a.download = `gloamdepths-save-${stamp}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      showMsg('📤 存檔已匯出,傳給朋友後對方可用「匯入存檔檔案」接手當房主');
    };
    $id('mClearSave').onclick = () => {
      if (confirm('確定要清除自動存檔嗎?這個動作無法復原。')) {
        try { localStorage.removeItem(SAVE_KEY); } catch (e) { }
        showMsg('🗑️ 存檔已清除');
        renderMenu();
      }
    };
  }
}

// ===== 小地圖 =====
const MM_COLORS = {};
function drawMinimap() {
  const mc = UI.els.minimap.getContext('2d');
  if (UI.mmDirty || !UI.mmImage) {
    UI.mmDirty = false;
    const img = mc.createImageData(MAP_W, MAP_H);
    const px = new Uint32Array(img.data.buffer);
    // ABGR(little-endian)
    const C = {
      [T.FLOOR]: 0xff28211c, [T.GLOW]: 0xff5a4a2e,
      [T.DIRT]: 0xff27405c, [T.STONE]: 0xff6e6363, [T.OBSIDIAN]: 0xff4e2f37,
      [T.COPPER]: 0xff4078e0, [T.IRON]: 0xffe3ddd8, [T.GOLD]: 0xff3fd2ff,
      [T.LUMITE]: 0xfffff07e, [T.ROOT]: 0xff305c6d, [T.BEDROCK]: 0xff000000,
      [T.WOODWALL]: 0xff3e6a8a, [T.STONEWALL]: 0xff968a8a,
      [T.GRAVEL]: 0xff787e8a, [T.COAL]: 0xff2a2a2a, [T.DIAMOND]: 0xffffc76a,
      [T.FARMLAND]: 0xff1c3a5c, [T.WATER]: 0xff8a622a, [T.FENCE]: 0xff5494c0,
    };
    for (let i = 0; i < G.tiles.length; i++) {
      px[i] = G.explored[i] ? (C[G.tiles[i]] || 0xff000000) : 0xff000000;
    }
    UI.mmImage = img;
  }
  mc.putImageData(UI.mmImage, 0, 0);
  // 標記:星核 / 神殿 / 玩家
  mc.fillStyle = '#7ef0ff';
  mc.fillRect(CX - 2, CY - 2, 4, 4);
  for (const s of G.shrines) {
    mc.fillStyle = s.dead ? '#666' : '#ffd23f';
    mc.fillRect(s.x - 2, s.y - 2, 4, 4);
  }
  for (const i of G.nestIdx) {
    const o = G.objects.get(i);
    if (!o) continue;
    const nx = i % MAP_W, ny = (i / MAP_W) | 0;
    if (!G.explored[i]) continue; // 沒探索過的巢穴不暴雷
    const ndef = NEST_TYPES[o.nestType] || NEST_TYPES.common;
    mc.fillStyle = ndef.color;
    mc.fillRect(nx - 2, ny - 2, 4, 4);
  }
  for (const p of G.players.values()) {
    if (p.dead) continue;
    mc.fillStyle = PLAYER_COLORS[p.id % PLAYER_COLORS.length];
    mc.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
  }
}

// ===== 大地圖(M 鍵開,滾輪縮放 + 拖曳平移)=====
function mapMarkers() {
  const marks = [];
  marks.push({ x: CX, y: CY, icon: '💠', label: '星核' });
  G.shrines.forEach((s, i) => {
    marks.push({ x: s.x, y: s.y, icon: s.dead ? '⚫' : '🗿', label: `神殿 ${i + 1}${s.dead ? '(已擊敗)' : ''}` });
  });
  for (const i of G.nestIdx) {
    if (!G.explored[i]) continue; // 沒探索過的巢穴不暴雷
    const o = G.objects.get(i);
    if (!o) continue;
    const ndef = NEST_TYPES[o.nestType] || NEST_TYPES.common;
    marks.push({ x: (i % MAP_W) + 0.5, y: ((i / MAP_W) | 0) + 0.5, icon: ndef.icon, label: ndef.name });
  }
  return marks;
}

function toggleMapPanel(open) {
  UI.mapOpen = open === undefined ? !UI.mapOpen : open;
  UI.els.mapPanel.classList.toggle('hidden', !UI.mapOpen);
  if (UI.mapOpen) {
    togglePanel(false); togglePowerPanel(false); toggleTalentPanel(false); closeTowerPanel();
    const me = myPlayer();
    UI.mapPanX = me ? me.x : MAP_W / 2;
    UI.mapPanY = me ? me.y : MAP_H / 2;
    resizeMapCanvas();
    drawFullMap();
  }
}

function resizeMapCanvas() {
  const cv = UI.els.mapCanvas;
  cv.width = innerWidth; cv.height = innerHeight;
}

function drawFullMap() {
  if (!UI.mapOpen) return;
  const cv = UI.els.mapCanvas, mc = cv.getContext('2d');
  const z = UI.mapZoom;
  mc.fillStyle = '#000'; mc.fillRect(0, 0, cv.width, cv.height);
  if (UI.mmDirty || !UI.mmImage) drawMinimap(); // 重用小地圖的離線 ImageData 快取(避免重複逐格算色)
  // 把探索過的地形(小地圖那張 200x200 ImageData)以整數倍縮放貼到畫面中心,中心點跟隨 mapPanX/Y 平移
  const off = document.createElement('canvas');
  off.width = MAP_W; off.height = MAP_H;
  off.getContext('2d').putImageData(UI.mmImage, 0, 0);
  mc.imageSmoothingEnabled = false;
  const ox = cv.width / 2 - UI.mapPanX * z;
  const oy = cv.height / 2 - UI.mapPanY * z;
  mc.drawImage(off, 0, 0, MAP_W, MAP_H, ox, oy, MAP_W * z, MAP_H * z);

  const toScreen = (x, y) => [ox + x * z, oy + y * z];

  // 標記(星核/神殿/巢穴)
  for (const m of mapMarkers()) {
    const [sx, sy] = toScreen(m.x, m.y);
    if (sx < -20 || sy < -20 || sx > cv.width + 20 || sy > cv.height + 20) continue;
    mc.font = `${Math.max(14, Math.min(28, z * 5))}px sans-serif`;
    mc.textAlign = 'center'; mc.textBaseline = 'middle';
    mc.fillText(m.icon, sx, sy);
    m._sx = sx; m._sy = sy;
  }
  // 玩家
  for (const p of G.players.values()) {
    if (p.dead) continue;
    const [sx, sy] = toScreen(p.x, p.y);
    mc.fillStyle = PLAYER_COLORS[p.id % PLAYER_COLORS.length];
    mc.beginPath(); mc.arc(sx, sy, Math.max(3, z * 0.6), 0, Math.PI * 2); mc.fill();
    mc.strokeStyle = '#fff'; mc.lineWidth = 1; mc.stroke();
  }

  // tooltip:滑鼠附近的標記
  const mm = UI.mapMouse;
  let hover = null, bestD = 26;
  if (mm) {
    for (const m of mapMarkers()) {
      if (m._sx === undefined) continue;
      const d = Math.hypot(mm[0] - m._sx, mm[1] - m._sy);
      if (d < bestD) { bestD = d; hover = m; }
    }
  }
  const tip = UI.els.mapTip;
  if (hover) {
    tip.classList.remove('hidden');
    tip.textContent = hover.label;
    tip.style.left = hover._sx + 'px';
    tip.style.top = (hover._sy - 14) + 'px';
  } else tip.classList.add('hidden');
}

function bindMapPanel() {
  const cv = UI.els.mapCanvas;
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    UI.mapZoom = Math.max(1, Math.min(12, UI.mapZoom * (e.deltaY > 0 ? 0.88 : 1.14)));
    drawFullMap();
  }, { passive: false });
  cv.addEventListener('mousedown', e => {
    UI.mapDrag = { x: e.clientX, y: e.clientY, panX: UI.mapPanX, panY: UI.mapPanY };
    cv.classList.add('grabbing');
  });
  addEventListener('mouseup', () => { UI.mapDrag = null; cv.classList.remove('grabbing'); });
  addEventListener('mousemove', e => {
    UI.mapMouse = [e.clientX, e.clientY];
    if (UI.mapDrag) {
      UI.mapPanX = UI.mapDrag.panX - (e.clientX - UI.mapDrag.x) / UI.mapZoom;
      UI.mapPanY = UI.mapDrag.panY - (e.clientY - UI.mapDrag.y) / UI.mapZoom;
    }
    if (UI.mapOpen) drawFullMap();
  });
  addEventListener('resize', () => { if (UI.mapOpen) { resizeMapCanvas(); drawFullMap(); } });
}

// ===== 全螢幕選單 =====
function setOverlay(mode) {
  const ov = UI.els.overlay;
  if (!mode) { ov.classList.add('hidden'); ov.innerHTML = ''; return; }
  ov.classList.remove('hidden');
  const savedName = localStorage.getItem('gld_name') || '';
  if (mode === 'start') {
    const netOK = NET.available();
    ov.innerHTML = `
      <div class="menu">
        <h1>微光深淵</h1>
        <p class="sub">守護星核,奪回光明 — 1~4 人合作生存</p>
        <input id="nameInput" maxlength="12" placeholder="你的名字" value="${savedName}">
        <div class="btnrow">
          <button id="btnNew">🌍 新世界</button>
          <button id="btnLoad" ${hasSave() ? '' : 'disabled'}>📂 繼續存檔</button>
        </div>
        <div class="btnrow">
          <button id="btnImport">📤 匯入存檔檔案</button>
          <input id="importFile" type="file" accept="application/json,.json" class="hidden">
        </div>
        <div class="joinrow">
          <input id="codeInput" maxlength="5" placeholder="朋友的房號" ${netOK ? '' : 'disabled'}>
          <button id="btnJoin" ${netOK ? '' : 'disabled'}>🔗 加入房間</button>
        </div>
        ${netOK ? '' : '<p class="warn">⚠️ 目前無法載入連線元件(需網路),仍可離線單人遊玩</p>'}
        <div class="help">
          <b>目標</b>:星核能量會一直流失,挖 <b>光晶💠</b> 回來按 <b>F</b> 灌入;
          打敗外圈三座神殿的守衛、集齊 3 塊碎片,撐過最終暗潮即通關。<br>
          <b>操作</b>:WASD 移動|左鍵 挖牆/攻擊|右鍵 放置/吃|1–8 快捷欄|E 背包合成|F 餵星核|T 天賦<br>
          <b>連線</b>:進入遊戲後點右上「開房邀請朋友」,把房號給朋友即可;存檔在房主電腦。<br>
          <b>換房主</b>:原房主可在選單(Esc)「設定」裡匯出存檔檔案傳給你,用「匯入存檔檔案」
          讀取後,你就能以新房主身分開房,讓大家用原本的名字加入拿回進度。
        </div>
      </div>`;
    $id('btnNew').onclick = () => beginGame(false);
    $id('btnLoad').onclick = () => beginGame(true);
    $id('btnImport').onclick = () => $id('importFile').click();
    $id('importFile').onchange = () => {
      const file = $id('importFile').files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        let s;
        try { s = JSON.parse(reader.result); } catch (e) { showMsg('⚠️ 檔案格式錯誤,無法讀取'); return; }
        const name = getName();
        SFX.unlock();
        if (loadGameFromObject(s, name)) {
          UI.mmDirty = true; UI.invDirty = true;
          setOverlay(null);
          showMsg('📂 已匯入存檔,你現在是房主,可點右上「開房邀請朋友」讓大家加入');
        } else showMsg('⚠️ 存檔內容無效,無法匯入');
      };
      reader.onerror = () => showMsg('⚠️ 讀取檔案失敗');
      reader.readAsText(file);
      $id('importFile').value = '';
    };
    $id('btnJoin').onclick = () => {
      const name = getName();
      const code = $id('codeInput').value.trim();
      if (!code) { showMsg('請輸入房號'); return; }
      $id('btnJoin').disabled = true;
      $id('btnJoin').textContent = '連線中…';
      NET.join(name, code,
        () => setOverlay(null),
        err => { showMsg('⚠️ ' + err); $id('btnJoin').disabled = false; $id('btnJoin').textContent = '🔗 加入房間'; });
    };
  } else if (mode === 'win') {
    ov.innerHTML = `<div class="menu"><h1>🏆 通關!</h1>
      <p class="sub">星核甦醒,微光深淵重見光明。感謝遊玩!</p>
      <div class="btnrow"><button id="btnCont">✨ 繼續自由遊玩</button></div></div>`;
    $id('btnCont').onclick = () => setOverlay(null);
  } else if (mode === 'lose') {
    const host = NET.isHost();
    ov.innerHTML = `<div class="menu"><h1>💀 星核熄滅了</h1>
      <p class="sub">黑暗吞噬了一切……</p>
      <div class="btnrow">${host
        ? `<button id="btnLoad2" ${hasSave() ? '' : 'disabled'}>📂 讀取存檔</button><button id="btnNew2">🌍 新世界</button>`
        : '<p class="sub">等待房主決定重來,或重新整理頁面回主選單</p>'}</div></div>`;
    if (host) {
      $id('btnLoad2').onclick = () => { location.reload(); }; // 重新整理後從選單讀檔最穩定
      $id('btnNew2').onclick = () => { localStorage.removeItem(SAVE_KEY); location.reload(); };
    }
  } else if (mode === 'disconnected') {
    ov.innerHTML = `<div class="menu"><h1>🔌 與房主斷線</h1>
      <div class="btnrow"><button onclick="location.reload()">回主選單</button></div></div>`;
  }
}

function getName() {
  const v = ($id('nameInput')?.value || '').trim() || '礦工' + ((Math.random() * 99) | 0);
  localStorage.setItem('gld_name', v);
  return v;
}

function beginGame(load) {
  const name = getName();
  SFX.unlock();
  if (load) {
    if (!loadGame(name)) { showMsg('⚠️ 讀檔失敗,改開新世界'); startNewGame(name); }
  } else startNewGame(name);
  UI.mmDirty = true; UI.invDirty = true;
  setOverlay(null);
}

// 開房(單機途中隨時可開)
function openRoom() {
  SFX.unlock();
  G.paused = false; // 開房邀請朋友後就不再是單機了,暫停會卡住新加入的玩家
  UI.els.hostBtn.disabled = true;
  UI.els.hostBtn.textContent = '開房中…';
  NET.startHost(code => {
    UI.els.roomcode.textContent = `🔗 房號:${code}(點擊複製)`;
    UI.els.roomcode.classList.remove('hidden');
    UI.els.hostBtn.classList.add('hidden');
    showMsg('✅ 開房成功!把房號告訴朋友,他們在主選單輸入即可加入');
  }, err => {
    showMsg('⚠️ ' + err);
    UI.els.hostBtn.disabled = false;
    UI.els.hostBtn.textContent = '🔗 開房邀請朋友';
  });
}
