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
  questOpen: false, questT: 0, questNpcKey: null, // 目前開著的委託面板是哪位 NPC(null = 開著時顯示全部)
  storagePos: null, storageT: 0,
  emoteOpen: false,
  selectedDifficulty: 'normal',
  spec: null, // 觀戰自由鏡頭 {x, y, auto};null = 鏡頭跟著自己(auto = 死亡自動啟用,復活自動收回)
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
    enhPanel: $id('enhPanel'), equipSlots: $id('equipSlots'),
    towerPanel: $id('towerPanel'), towerBody: $id('towerBody'),
    traderPanel: $id('traderPanel'),
    questPanel: $id('questPanel'),
    storagePanel: $id('storagePanel'),
    emotePanel: $id('emotePanel'),
    overlay: $id('overlay'), minimap: $id('minimap'), teamList: $id('teamList'),
    mapPanel: $id('mapPanel'), mapCanvas: $id('mapCanvas'), mapTip: $id('mapTip'),
    hostBtn: $id('hostBtn'), roomcode: $id('roomcode'),
    deathbanner: $id('deathbanner'),
    menuPanel: $id('menuPanel'),
    powerPanel: $id('powerPanel'), powerQuickBtn: $id('powerQuickBtn'),
    talentPanel: $id('talentPanel'), talentbadge: $id('talentbadge'),
  };
  UI.els.talentbadge.onclick = () => toggleTalentPanel(true);
  // 小地圖本身+下方提示都能點開大地圖(M 鍵是唯一入口太隱晦,新玩家常常不知道有這功能)
  UI.els.minimap.onclick = () => toggleMapPanel(true);
  $id('mapOpenHint').onclick = () => toggleMapPanel(true);
  // 秘笈選單快捷按鈕:點按鈕本體開面板,點右上角小 × 改成隱藏這顆按鈕(stopPropagation 避免
  // 同時觸發開面板)。初始顯示狀態看 localStorage(只有打過指令的人才看得到)
  UI.els.powerQuickBtn.onclick = () => togglePowerPanel();
  $id('powerQuickHide').onclick = e => {
    e.stopPropagation();
    try { localStorage.setItem('gld_power_hide_btn', '1'); } catch (err) { }
    updatePowerQuickBtn();
  };
  updatePowerQuickBtn();
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
  // 裝備欄位(頭盔/胸甲/護腿):點一下卸下、拖背包格進來穿上,跟箭塔彈藥格同一套拖放模式
  UI.els.equipSlots.querySelectorAll('.eqslot').forEach(el => {
    const part = el.dataset.part;
    el.onclick = () => {
      const me = myPlayer();
      if (!me) return;
      if (NET.isHost()) doUnequip(me, part);
      else NET.act({ t: 'unequip', part });
    };
    el.ondragover = (ev) => ev.preventDefault();
    el.ondrop = (ev) => {
      ev.preventDefault();
      const from = +ev.dataTransfer.getData('text/plain');
      const me = myPlayer();
      const s = me && me.inv[from];
      const it = s && ITEMS[s.id];
      if (!it || it.equipSlot !== part) return;
      if (NET.isHost()) doEquip(me, from);
      else NET.act({ t: 'equip', slot: from });
    };
  });
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
  if (head === 'give_all') { markPowerUsed(); execPower('infinite'); return true; }
  if (head === 'power') {
    markPowerUsed(); // 打過一次 /power 之後,右下角才會出現快捷按鈕(見 updatePowerQuickBtn)
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

// 秘笈選單快捷按鈕:刻意不寫進任何操作說明(跟 /power 本身同一種「知道的人才用得到」精神),
// 只有實際打過指令的人才會看到這顆按鈕。按鈕上的小 × 可以隱藏(存 localStorage),
// 隱藏之後要用回原本打 /power 指令的方式開啟——這是使用者要求的行為,不是自動恢復
function markPowerUsed() {
  try { localStorage.setItem('gld_power_used', '1'); } catch (e) { }
  updatePowerQuickBtn();
}
function updatePowerQuickBtn() {
  let used = false, hidden = false;
  try {
    used = localStorage.getItem('gld_power_used') === '1';
    hidden = localStorage.getItem('gld_power_hide_btn') === '1';
  } catch (e) { }
  UI.els.powerQuickBtn.classList.toggle('hidden', !used || hidden);
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

// /power give 的物品分類(只影響秘笈選單下拉選單的分組顯示,不影響其他任何邏輯)。
// 依序比對,第一個符合的分類就採用——優先用既有的 FURNITURE_DECOR_TYPES/TOWER_COLLECTOR_TYPES
// (跟成就判斷共用同一份清單,之後新增家具/塔類會自動歸類正確,不用維護第二份清單);
// 自動化道鏈/建材照明數量少且很少變動,直接列舉沒關係
const GIVE_ITEM_CATS = [
  { name: '🧰 工具', test: it => !!(it.pick || it.till || it.fish || it.recall) },
  { name: '⚔️ 武器', test: it => !!(it.sword || it.ranged) },
  { name: '🛡️ 裝備', test: it => !!it.equipSlot },
  { name: '🏠 家具/裝潢', test: it => FURNITURE_DECOR_TYPES.includes(it.place) },
  { name: '🏗️ 塔類/防禦', test: it => TOWER_COLLECTOR_TYPES.includes(it.place) || ['gate', 'decoy', 'spike_trap'].includes(it.place) },
  { name: '⚙️ 自動化/軌道', test: it => !!it.cart || ['auto_miner', 'belt', 'storage', 'auto_smelter', 'rail', 'rail_station'].includes(it.place) },
  { name: '🧱 建築/照明', test: it => !!it.place || it.placeTile !== undefined },
  { name: '🍲 食物/料理', test: it => !!it.food },
  { name: '📦 素材/其他', test: () => true },
];

function togglePowerPanel(open) {
  UI.powerOpen = open === undefined ? !UI.powerOpen : open;
  UI.els.powerPanel.classList.toggle('hidden', !UI.powerOpen);
  if (UI.powerOpen) {
    UI.panelOpen = false;
    UI.els.invpanel.classList.add('hidden');
    closeTowerPanel(); toggleEmotePanel(false);
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
  // 物品清單太多(100+ 種),不適合像怪物/動物那樣整排按鈕——改用下拉選單+數量,
  // 對應通用指令 /power give <id> <n>,新增物品自動出現在清單裡不用維護。
  // 玩家反映項目太多很難找,補上 GIVE_ITEM_CATS 分類(<optgroup>),一次分類、單一 select,
  // 原生下拉選單本來就支援打字跳到符合的選項,分類群組是額外的視覺輔助
  const giveGroups = GIVE_ITEM_CATS.map(cat => ({ cat, ids: [] }));
  for (const id of Object.keys(ITEMS)) {
    const g = giveGroups.find(g => g.cat.test(ITEMS[id]));
    g.ids.push(id);
  }
  const giveOptions = giveGroups.filter(g => g.ids.length).map(g =>
    `<optgroup label="${g.cat.name}">${g.ids.map(id => `<option value="${id}">${ITEMS[id].icon} ${ITEMS[id].name}</option>`).join('')}</optgroup>`
  ).join('');
  html += `<h3>🎁 物品</h3><div class="power-grid">
    <select id="giveItemSel">${giveOptions}</select>
    <input id="giveItemNum" type="number" value="1" min="1" max="999" style="width:4.5em">
    <button id="giveItemBtn">給予</button>
  </div>`;
  html += `<div class="btnrow"><button id="powerClose">關閉(Esc)</button></div>`;
  panel.innerHTML = html;
  panel.querySelectorAll('.power-btn').forEach(btn => {
    btn.onclick = () => tryDebugCommand(btn.dataset.cmd);
  });
  $id('giveItemBtn').onclick = () => {
    const id = $id('giveItemSel').value;
    const n = clamp(+$id('giveItemNum').value || 1, 1, 999);
    tryDebugCommand(`/power give ${id} ${n}`);
  };
  $id('powerClose').onclick = () => togglePowerPanel(false);
}

// ===== 天賦面板(T 鍵/點 HUD 徽章開啟):自由分配升級獲得的天賦點 =====
function toggleTalentPanel(open) {
  UI.talentOpen = open === undefined ? !UI.talentOpen : open;
  UI.els.talentPanel.classList.toggle('hidden', !UI.talentOpen);
  if (UI.talentOpen) {
    togglePowerPanel(false); toggleEmotePanel(false);
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
  UI.els.coretext.textContent = `💠 星核 ${Math.ceil(G.core.energy)}` + (G.core.shield > 0 ? ` 🛡️${Math.ceil(G.core.shield)}` : '');
  UI.els.shards.textContent = '🔷'.repeat(G.core.shards) + '◇'.repeat(Math.max(0, CORE_CFG.needShards - G.core.shards));

  // 料理 buff 列(有 buff 才顯示;客戶端的 buffs 由快照同步)+ 出戰中的寵物(常駐,沒有倒數)
  {
    const list = me.buffs ? Object.entries(me.buffs).filter(([, b]) => b && b.t > 0) : [];
    let html = list.map(([k, b]) => {
      const info = BUFF_INFO[k] || { icon: '✨', name: k };
      return `<span class="buff">${info.icon} ${info.name} ${Math.ceil(b.t)}s</span>`;
    }).join('');
    // PET_TYPES 是寫死的靜態表(不是玩家輸入),字串直接內插不用跳脫;跟玩家名字那種要另外處理不一樣
    const pet = petOf(me);
    if (pet) html += `<span class="buff pet" title="${pet.desc}">${pet.icon} ${pet.name}</span>`;
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
    UI.els.wavebox.textContent = `${w.endless ? '🌑 下一波無盡暗潮' : '🌊 下一波暗潮'} ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    UI.els.wavebox.className = '';
  } else if (w.state === 'warn') {
    UI.els.wavebox.textContent = `⚠️ 暗潮來襲倒數 ${Math.max(0, Math.ceil(w.timer))} 秒!`;
    UI.els.wavebox.className = 'warn';
  } else {
    UI.els.wavebox.textContent = (w.final ? '🌑 最終暗潮!' : w.endless ? `🌑 無盡暗潮第 ${w.en || 0} 波!` : `🌊 第 ${w.n} 波暗潮!`) + ` 剩餘 ${w.alive ?? '?'} 隻`;
    UI.els.wavebox.className = 'warn';
  }

  // 死亡橫幅(倒下待救援 / 徹底陣亡共用同一個橫幅,文字依狀態切換)
  UI.els.deathbanner.classList.toggle('hidden', !me.dead && !me.downed);
  if (me.dead) UI.els.deathbanner.textContent = `💧 你熄火了…… ${Math.max(0, Math.ceil(me.respawnT ?? 0))} 秒後在星核重新點燃(WASD 可移動鏡頭觀戰)`;
  else if (me.downed) UI.els.deathbanner.textContent = `🆘 倒下了!等隊友靠近站著救你(${Math.max(0, Math.ceil(me.downedT ?? 0))} 秒後徹底陣亡)`;

  // me.invDirty 是房主端模擬(doMine/craftRecipe/doGift...等十幾處)標記「背包變了」的旗標,
  // 但過去只有寫入從未有人讀取——房主自己的畫面因此要等 UI.invDirty 被別的操作(切換快捷欄/滑鼠滾輪)
  // 順便設成 true 才會刷新,導致「數量要動一下滾輪才會更新」。客戶端不受影響,因為每次 snap 都無條件重設 UI.invDirty。
  if (UI.invDirty || me.invDirty) { UI.invDirty = false; me.invDirty = false; refreshSlots(); }

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
  // 委託面板(開著才更新,節流;顯示兩位 NPC 全部委託,不用距離自動關閉,只需要定時刷新進度/達成狀態)
  if (UI.questOpen) {
    UI.questT -= dt;
    if (UI.questT <= 0) { UI.questT = 0.3; renderQuestPanel(); }
  }

  // 小地圖 + 隊友名單(同一個節流頻率)
  UI.mmT -= dt;
  if (UI.mmT <= 0) { UI.mmT = 0.4; drawMinimap(); renderTeamList(); }
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

  // 儲物箱面板(開著才更新,節流;走遠或箱子被拆就自動關閉。客戶端的內容變動也靠這裡的重繪反映)
  if (UI.storagePos) {
    UI.storageT -= dt;
    if (UI.storageT <= 0) {
      UI.storageT = 0.3;
      const { x, y } = UI.storagePos;
      const o = objAt(x, y);
      if (!o || o.type !== 'storage' || dist(me.x, me.y, x + 0.5, y + 0.5) > 4.5) closeStoragePanel();
      else renderStoragePanel();
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
  renderEquipSlots(me);
  if (UI.enhSlot >= 0) renderEnhPanel();
}

// 裝備欄位面板:空格顯示部位圖示提示,穿上後顯示該裝備的圖示(+強化等級)
function renderEquipSlots(me) {
  UI.els.equipSlots.querySelectorAll('.eqslot').forEach(el => {
    const part = el.dataset.part;
    const eq = me.equip && me.equip[part];
    const it = eq && ITEMS[eq.id];
    const iconEl = el.querySelector('.icon');
    el.classList.toggle('filled', !!it);
    iconEl.textContent = it ? it.icon : '';
    el.title = it ? `${EQUIP_SLOT_NAME[part]}:${it.name}${eq.lv ? ' +' + eq.lv : ''}(點一下卸下)` : `${EQUIP_SLOT_NAME[part]}(拖裝備進來穿上)`;
  });
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
  togglePowerPanel(false); toggleEmotePanel(false);
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
  togglePanel(false); togglePowerPanel(false); toggleTalentPanel(false); closeTowerPanel(); toggleEmotePanel(false);
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
    <p class="hint">「${TRADER_CFG.motto}」已喚醒 ${n}/3 位守望者——喚醒越多,好貨越多。點一下立即成交(比例固定)。</p>
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

// ===== 劇情 NPC 委託面板(右鍵任一位 NPC,或從 ESC 選單開,兩個入口共用同一份渲染)=====
function openQuestPanel(npcKey) {
  UI.questOpen = true;
  UI.questT = 0;
  UI.questNpcKey = npcKey || null;
  UI.els.questPanel.classList.remove('hidden');
  togglePanel(false); togglePowerPanel(false); toggleTalentPanel(false); closeTowerPanel(); toggleEmotePanel(false); closeStoragePanel(); closeTraderPanel();
  renderQuestPanel();
}
function closeQuestPanel() {
  UI.questOpen = false;
  UI.els.questPanel.classList.add('hidden');
}
function execQuestTurnIn(id) {
  const me = myPlayer();
  if (!me) return;
  if (NET.isHost()) {
    const r = doQuestTurnIn(me, id);
    if (r && r.err) showMsg('⚠️ ' + r.err);
    renderQuestPanel();
  } else {
    NET.act({ t: 'questturnin', id });
  }
}
// 委託進度文字:三種型態各自的「還差多少」說明,寫在 UI 讓玩家看得懂為什麼還不能交
function questProgressText(p, q) {
  if (q.type === 'deliver') {
    return Object.entries(q.need).map(([id, n]) => `${ITEMS[id].icon}${ITEMS[id].name} ${countItem(p, id)}/${n}`).join('、');
  }
  if (q.type === 'kill') {
    const k = (G.quests.active[q.id] && G.quests.active[q.id].kills) || 0;
    return `擊敗${ENEMY_TYPES[q.enemyType].name} ${k}/${q.count}`;
  }
  if (q.type === 'achv') return ACHIEVEMENTS[q.need].desc;
  return '';
}
function renderQuestPanel() {
  if (!UI.questOpen) return;
  const me = myPlayer();
  if (!me) return;
  let html = `<h2>📜 委託日誌</h2><p class="hint">完成上一關才會解鎖下一關;達成條件後按「交付」領取獎勵。</p>`;
  for (const npcKey in QUEST_NPCS) {
    const npc = QUEST_NPCS[npcKey];
    html += `<h3>${npc.icon} ${npc.name}<span class="hint">「${npc.motto}」</span></h3><div class="power-grid quest-grid">`;
    for (const q of QUESTS.filter(x => x.npc === npcKey)) {
      const done = !!G.quests.done[q.id];
      const avail = questAvailable(q.id);
      if (!avail && !done) {
        html += `<div class="power-btn quest-card locked">？？？<code>完成上一關解鎖</code></div>`;
        continue;
      }
      if (done) {
        html += `<div class="power-btn quest-card done">✅ ${q.name}<code>已完成</code></div>`;
        continue;
      }
      const ready = questReady(me, q.id);
      html += `<div class="power-btn quest-card">
        <b>${q.name}</b><span class="hint">${q.intro}</span>
        <code>${questProgressText(me, q)}</code>
        <button class="quest-turnin" data-id="${q.id}" ${ready ? '' : 'disabled'}>交付</button>
      </div>`;
    }
    html += `</div>`;
  }
  html += `<div class="btnrow"><button id="questClose">關閉(Esc)</button></div>`;
  UI.els.questPanel.innerHTML = html;
  UI.els.questPanel.querySelectorAll('.quest-turnin').forEach(btn => {
    btn.onclick = () => execQuestTurnIn(btn.dataset.id);
  });
  $id('questClose').onclick = closeQuestPanel;
}

// ===== 快速手勢輪盤:C 鍵開啟,點一下送出圖示氣泡給全隊看(仿秘笈選單的按鈕格) =====
function toggleEmotePanel(open) {
  UI.emoteOpen = open === undefined ? !UI.emoteOpen : open;
  UI.els.emotePanel.classList.toggle('hidden', !UI.emoteOpen);
  if (UI.emoteOpen) {
    togglePanel(false); togglePowerPanel(false); toggleTalentPanel(false); closeTowerPanel(); closeTraderPanel(); closeQuestPanel(); closeStoragePanel();
    renderEmotePanel();
  }
}
function execEmote(idx) {
  const me = myPlayer();
  if (!me) return;
  if (NET.isHost()) doEmote(me, idx);
  else NET.act({ t: 'emote', idx });
  toggleEmotePanel(false);
}
function renderEmotePanel() {
  let html = `<h2>💬 快速手勢</h2><p class="hint">選一個,頭上會冒出圖示讓全隊看到。</p><div class="power-grid">`;
  EMOTE_LIST.forEach((e, i) => {
    html += `<button class="power-btn emote-btn" data-idx="${i}"><span style="font-size:22px">${e.icon}</span><code>${e.text}</code></button>`;
  });
  html += `</div><div class="btnrow"><button id="emoteClose">關閉(C / Esc)</button></div>`;
  UI.els.emotePanel.innerHTML = html;
  UI.els.emotePanel.querySelectorAll('.emote-btn').forEach(btn => {
    btn.onclick = () => execEmote(+btn.dataset.idx);
  });
  $id('emoteClose').onclick = () => toggleEmotePanel(false);
}

// ===== 儲物箱面板:右鍵儲物箱開啟。上半是箱內容(點取回),下半是背包(點存入)=====
function openStoragePanel(x, y) {
  const o = objAt(x, y);
  if (!o || o.type !== 'storage') return;
  UI.storagePos = { x, y };
  UI.storageT = 0;
  UI.els.storagePanel.classList.remove('hidden');
  togglePanel(false); togglePowerPanel(false); toggleTalentPanel(false); closeTowerPanel(); closeTraderPanel(); closeQuestPanel(); toggleEmotePanel(false);
  renderStoragePanel();
}
function closeStoragePanel() {
  UI.storagePos = null;
  UI.els.storagePanel.classList.add('hidden');
}
// 存取動作:房主直接執行並立即重繪;客戶端送訊息,靠 setObj 廣播回來後由節流重繪反映
function storageAct(msg, hostFn) {
  const me = myPlayer();
  if (!me || !UI.storagePos) return;
  const { x, y } = UI.storagePos;
  if (NET.isHost()) { hostFn(me, x, y); renderStoragePanel(); refreshSlots(); }
  else NET.act(msg);
}
function renderStoragePanel() {
  if (!UI.storagePos) return;
  const me = myPlayer();
  if (!me) return;
  const { x, y } = UI.storagePos;
  const o = objAt(x, y);
  if (!o || o.type !== 'storage') { closeStoragePanel(); return; }
  const items = o.items || [];
  const cell = (s, cls, i) => {
    const it = s ? ITEMS[s.id] : null;
    const cnt = s ? (s.count > 1 ? s.count : (s.lv ? '+' + s.lv : '')) : '';
    const tint = it && it.tint ? ` style="background:${it.tint}"` : '';
    return `<div class="slot ${cls}" data-i="${i}"${tint} title="${it ? it.name + (s.lv ? ' +' + s.lv : '') : ''}">
      <span class="icon">${it ? it.icon : ''}</span><span class="cnt">${cnt}</span></div>`;
  };
  let html = `<h2>📦 儲物箱 <span class="hint">(${items.length}/${STORAGE_CFG.slots})</span></h2>
    <p class="hint">點箱內物品取回背包,點背包物品存入。傳輸帶把礦推到箱子正面會自動入庫。</p>
    <div class="store-grid">`;
  for (let i = 0; i < STORAGE_CFG.slots; i++) html += cell(items[i], 'store-cell', i);
  html += `</div><div class="store-label">你的背包(點擊存入)</div><div class="store-grid inv-side">`;
  for (let i = 0; i < INV_SIZE; i++) html += cell(me.inv[i], 'inv-cell', i);
  html += `</div><div class="btnrow"><button id="storeQuick">⤵️ 快速存入同類</button><button id="storeClose">關閉(Esc)</button></div>`;
  UI.els.storagePanel.innerHTML = html;
  UI.els.storagePanel.querySelectorAll('.store-cell').forEach(el => {
    const i = +el.dataset.i;
    el.onclick = () => storageAct({ t: 'storetake', x, y, si: i }, (m, X, Y) => doStorageWithdraw(m, X, Y, i));
  });
  UI.els.storagePanel.querySelectorAll('.inv-cell').forEach(el => {
    const i = +el.dataset.i;
    el.onclick = () => storageAct({ t: 'storeput', x, y, slot: i }, (m, X, Y) => doStorageDeposit(m, X, Y, i));
  });
  $id('storeQuick').onclick = () => storageAct({ t: 'storequick', x, y }, (m, X, Y) => doStorageQuick(m, X, Y));
  $id('storeClose').onclick = closeStoragePanel;
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
  if (UI.panelOpen) { togglePowerPanel(false); closeStoragePanel(); toggleEmotePanel(false); refreshSlots(); UI.craftT = 0; }
}

// ===== ESC 選單(設定 / 存檔資訊)=====
function toggleMenu(open) {
  UI.menuOpen = open === undefined ? !UI.menuOpen : open;
  UI.els.menuPanel.classList.toggle('hidden', !UI.menuOpen);
  if (UI.menuOpen) { UI.menuView = 'main'; renderMenu(); }
}

function saveSizeText() {
  const raw = slotRaw(SAVE_SLOT);
  if (!raw) return '目前尚無存檔';
  return `約 ${(raw.length / 1024).toFixed(1)} KB`;
}

// 遊玩時間格式化(統計頁/存檔列表共用):有小時才顯示小時
function fmtPlayTime(sec) {
  const t = Math.floor(sec || 0);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
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
        <button id="mStats">📊 統計</button>
        <button id="mAchv">🏆 圖鑑</button>
        <button id="mQuests">📜 委託</button>
        <button id="mSettings">⚙️ 設定</button>
      </div>`;
    $id('mResume').onclick = () => toggleMenu(false);
    if (canPause) $id('mPause').onclick = () => { G.paused = !G.paused; renderMenu(); };
    $id('mStats').onclick = () => { UI.menuView = 'stats'; renderMenu(); };
    $id('mAchv').onclick = () => { UI.menuView = 'achv'; renderMenu(); };
    $id('mQuests').onclick = () => { toggleMenu(false); openQuestPanel(null); };
    $id('mSettings').onclick = () => { UI.menuView = 'settings'; renderMenu(); };
    return;
  }
  // ---- 統計 ----
  if (UI.menuView === 'stats') {
    const timeText = fmtPlayTime(G.time);
    panel.innerHTML = `
      <h2>📊 統計</h2>
      <div class="btnrow col" style="align-items:stretch;text-align:left;gap:4px;">
        <p>⚔️ 累計擊殺:<b>${G.killCount || 0}</b></p>
        <p>⏱️ 存活時間:<b>${timeText}</b></p>
        <p>🌊 暗潮波數:<b>${G.wave.n || 0}</b></p>
        ${G.won ? `<p>🌑 無盡暗潮:<b>已撐過 ${G.wave.en || 0} 波</b></p>` : ''}
        <p>🎚️ 難度:<b>${(DIFFICULTY_CFG[G.difficulty] || DIFFICULTY_CFG.normal).label}</b></p>
      </div>
      <div class="btnrow"><button id="mStatsBack">← 返回</button></div>`;
    $id('mStatsBack').onclick = () => { UI.menuView = 'main'; renderMenu(); };
    return;
  }
  // ---- 圖鑑(成就 + 怪物圖鑑,全隊共享)----
  if (UI.menuView === 'achv') {
    const achvIds = Object.keys(ACHIEVEMENTS);
    const gotN = achvIds.filter(id => G.achv[id]).length;
    const achvHtml = achvIds.map(id => {
      const a = ACHIEVEMENTS[id], done = !!G.achv[id];
      return `<div class="achv-row${done ? ' done' : ''}">
        <span class="achv-icon">${done ? a.icon : '🔒'}</span>
        <span class="achv-info"><b>${done ? a.name : '???'}</b><br><span class="hint">${done ? a.desc : '尚未解鎖'}</span></span>
      </div>`;
    }).join('');
    // 怪物圖鑑:BOSS 也算(神殿三隻+暗潮最終波石像),排除純裝飾/非戰鬥種類的話目前 ENEMY_TYPES 全是可擊敗的怪
    const monIds = Object.keys(ENEMY_TYPES);
    const seenN = monIds.filter(id => G.bestiary[id]).length;
    const bestiaryHtml = monIds.map(id => {
      const et = ENEMY_TYPES[id], seen = !!G.bestiary[id];
      return `<div class="bestiary-cell${seen ? '' : ' unseen'}" title="${seen ? et.name : '尚未擊敗過'}">
        ${et.icon ? `<img src="assets/monsters/${et.icon}" onerror="this.style.display='none'">` : ''}
        <span>${seen ? et.name : '？？？'}</span>
      </div>`;
    }).join('');
    panel.innerHTML = `
      <h2>🏆 成就 <span class="enh-lv">${gotN}/${achvIds.length}</span></h2>
      <div class="achv-list">${achvHtml}</div>
      <h2 style="margin-top:16px">📖 怪物圖鑑 <span class="enh-lv">${seenN}/${monIds.length}</span></h2>
      <div class="bestiary-grid">${bestiaryHtml}</div>
      <div class="btnrow"><button id="mAchvBack">← 返回</button></div>`;
    $id('mAchvBack').onclick = () => { UI.menuView = 'main'; renderMenu(); };
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
      <p>目前使用存檔欄位:<b>欄位 ${SAVE_SLOT}</b>(識別碼 <code>${saveKeyOf(SAVE_SLOT)}</code>)<br>目前存檔大小:${saveSizeText()}</p>
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
      const raw = slotRaw(SAVE_SLOT);
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
      if (confirm(`確定要清除欄位 ${SAVE_SLOT} 的自動存檔嗎?這個動作無法復原。`)) {
        try { localStorage.removeItem(saveKeyOf(SAVE_SLOT)); } catch (e) { }
        showMsg('🗑️ 存檔已清除');
        renderMenu();
      }
    };
  }
}

// 隊友名單:小地圖標記再怎麼放大都還是很擠、顏色容易被地形吃掉,文字化的名字+距離+方向
// 才是「一眼看懂隊友在哪」的可靠答案。跟 drawMinimap 同一個節流頻率(uiTick 每 0.4s)。
// 安全性:玩家名字是別人打的(net.js 的 hi 訊息),一律用 textContent/DOM API 組,不用 innerHTML 拼字串
function renderTeamList() {
  const me = myPlayer();
  const el = UI.els.teamList;
  if (!me || !el) return;
  const others = [...G.players.values()].filter(p => p.id !== G.myId);
  el.innerHTML = '';
  for (const p of others) {
    const col = PLAYER_COLORS[p.id % PLAYER_COLORS.length];
    const row = document.createElement('div');
    row.className = 'team-row' + (p.dead ? ' dead' : p.downed ? ' downed' : '');
    const dot = document.createElement('span');
    dot.className = 'team-dot'; dot.style.background = col; dot.style.color = col;
    row.appendChild(dot);
    // 陣亡中(respawn 倒數)沒有座標意義(即將自動回星核重生);倒下待救才要看方向+距離——
    // 那正是「該不該衝過去救」的關鍵資訊,跟一般隊友定位同等重要,甚至更急
    if (!p.dead) {
      const arrow = document.createElement('span');
      arrow.className = 'team-arrow';
      arrow.textContent = '➤';
      arrow.style.transform = `rotate(${Math.atan2(p.y - me.y, p.x - me.x)}rad)`;
      arrow.style.color = col;
      row.appendChild(arrow);
    }
    row.appendChild(document.createTextNode(p.name));
    const info = document.createElement('span');
    info.className = 'team-dist';
    if (p.dead) info.textContent = '重生中';
    else if (p.downed) info.textContent = `🆘 ${Math.round(dist(me.x, me.y, p.x, p.y))}格`;
    else info.textContent = Math.round(dist(me.x, me.y, p.x, p.y)) + '格';
    row.appendChild(info);
    el.appendChild(row);
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
      [T.RAIL]: 0xff6a5a4a, [T.VOIDROCK]: 0xff522a3a, [T.SEAL]: 0xff8e3a5a,
      [T.DECOWALL]: 0xff6090c0,
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
  for (const a of G.altars) {
    if (!G.explored[idx(Math.floor(a.x), Math.floor(a.y))]) continue; // 沒探索過不暴雷,跟巢穴同規則
    mc.fillStyle = a.dead ? '#666' : '#c88cff';
    mc.fillRect(a.x - 2, a.y - 2, 4, 4);
  }
  for (const v of G.vaults) {
    if (!G.explored[idx(Math.floor(v.x), Math.floor(v.y))]) continue; // 沒探索過不暴雷,跟祭壇同規則
    mc.fillStyle = v.dead ? '#666' : '#ff8cf0';
    mc.fillRect(v.x - 2, v.y - 2, 4, 4);
  }
  for (const p of G.players.values()) {
    if (p.dead) continue;
    const isMe = p.id === G.myId;
    const col = PLAYER_COLORS[p.id % PLAYER_COLORS.length];
    const s = isMe ? 5 : 4;
    // 白色外框:170x170 的小地圖本身很擠,標記顏色常常跟地形色撞在一起看不清楚,先鋪一層白底墊出對比
    mc.fillStyle = '#fff';
    mc.fillRect(p.x - s / 2 - 1, p.y - s / 2 - 1, s + 2, s + 2);
    mc.fillStyle = col;
    mc.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    if (isMe) {
      // 自己額外套一圈脈動光環:一眼從一堆隊友裡認出「我在哪」,不用去記自己是哪個顏色
      mc.strokeStyle = col; mc.lineWidth = 1;
      mc.beginPath(); mc.arc(p.x, p.y, 5 + Math.sin(performance.now() / 300) * 1.3, 0, TAU); mc.stroke();
    }
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
  for (const a of G.altars) {
    if (!G.explored[idx(Math.floor(a.x), Math.floor(a.y))]) continue; // 沒探索過不暴雷,跟巢穴同規則
    marks.push({ x: a.x, y: a.y, icon: a.dead ? '⚫' : '🏛️', label: `深怪祭壇${a.dead ? '(已擊破)' : ''}` });
  }
  for (const v of G.vaults) {
    if (!G.explored[idx(Math.floor(v.x), Math.floor(v.y))]) continue; // 沒探索過不暴雷,跟祭壇同規則
    marks.push({ x: v.x, y: v.y, icon: v.dead ? '⚫' : '💎', label: `淵藏寶庫${v.dead ? '(已肅清)' : ''}` });
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
  // 玩家:自己用脈動光環凸顯(老遠就找得到自己在哪),名字常駐顯示在標記下方
  // (不用滑鼠 hover 才看得到——找隊友是這個面板最主要的用途,不該藏在互動後面)
  for (const p of G.players.values()) {
    if (p.dead) continue;
    const [sx, sy] = toScreen(p.x, p.y);
    const isMe = p.id === G.myId;
    const col = PLAYER_COLORS[p.id % PLAYER_COLORS.length];
    const r = Math.max(isMe ? 5 : 4, z * (isMe ? 0.75 : 0.6));
    if (isMe) {
      const pulse = r + 5 + Math.sin(performance.now() / 260) * 3;
      mc.globalAlpha = 0.55;
      mc.strokeStyle = col; mc.lineWidth = 2;
      mc.beginPath(); mc.arc(sx, sy, pulse, 0, Math.PI * 2); mc.stroke();
      mc.globalAlpha = 1;
    }
    mc.fillStyle = col;
    mc.beginPath(); mc.arc(sx, sy, r, 0, Math.PI * 2); mc.fill();
    mc.strokeStyle = '#fff'; mc.lineWidth = isMe ? 2.5 : 1.5; mc.stroke();
    const label = isMe ? `${p.name}(你)` : p.name;
    mc.font = 'bold 13px sans-serif';
    mc.textAlign = 'center'; mc.textBaseline = 'top';
    mc.fillStyle = '#000c';
    mc.fillText(label, sx + 1, sy + r + 5);
    mc.fillStyle = col;
    mc.fillText(label, sx, sy + r + 4);
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
    migrateLegacySave(); // 舊版單一存檔先搬進槽位,下面的 anySave()/存檔列表才看得到
    const netOK = NET.available();
    ov.innerHTML = `
      <div class="menu">
        <h1>微光深淵</h1>
        <p class="sub">一起把光帶回深淵吧!1~4 人合作の地底大冒險</p>
        <button id="btnChangelog" class="linklike">📜 更新紀錄</button>
        <input id="nameInput" maxlength="12" placeholder="你的名字" value="${savedName}">
        <div class="diffrow" id="diffRow">
          ${Object.entries(DIFFICULTY_CFG).map(([key, d]) => `
            <button class="diffbtn${UI.selectedDifficulty === key ? ' selected' : ''}"
                    data-diff="${key}" title="${d.desc}">${d.label}</button>
          `).join('')}
        </div>
        <div class="btnrow">
          <button id="btnNew">🌍 新世界</button>
          <button id="btnLoad" ${anySave() ? '' : 'disabled'}>📂 繼續存檔</button>
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
          <b>房主斷線?</b>沒關係——遊戲會自動把房主交棒給最早加入的隊友,其他人自動跟過去,
          進度與背包都不會丟(也可以用選單「設定」裡的匯出/匯入存檔手動換房主)。<br>
          <b>觀戰</b>:按 <b>V</b> 進入自由鏡頭看隊友,再按 V 回來;倒下等復活時也能移動鏡頭。
        </div>
      </div>`;
    for (const btn of ov.querySelectorAll('.diffbtn')) {
      btn.onclick = () => {
        UI.selectedDifficulty = btn.dataset.diff;
        for (const b of ov.querySelectorAll('.diffbtn')) b.classList.toggle('selected', b === btn);
      };
    }
    $id('btnNew').onclick = () => {
      const slot = firstEmptySlot();
      if (slot) beginGame(false, slot);
      else { UI.slotPick = 'new'; setOverlay('slots'); } // 三格都滿:讓玩家自己挑一格覆蓋
    };
    $id('btnLoad').onclick = () => { UI.slotPick = 'load'; setOverlay('slots'); };
    $id('btnChangelog').onclick = () => setOverlay('changelog');
    $id('btnImport').onclick = () => $id('importFile').click();
    $id('importFile').onchange = () => {
      const file = $id('importFile').files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        let s;
        try { s = JSON.parse(reader.result); } catch (e) { showMsg('⚠️ 檔案格式錯誤,無法讀取'); return; }
        // 匯入前先決定之後自動存檔要寫進哪一格:優先空格,都滿了挑最舊的一格並問過玩家
        let slot = firstEmptySlot();
        if (!slot) {
          let oldest = 1, oldestAt = Infinity;
          for (let n = 1; n <= SAVE_SLOTS; n++) {
            const info = slotInfo(n);
            const at = (info && info.savedAt) || 0;
            if (at < oldestAt) { oldestAt = at; oldest = n; }
          }
          if (!confirm(`存檔欄位都滿了,匯入後的進度會覆蓋最舊的欄位 ${oldest},確定嗎?`)) return;
          slot = oldest;
        }
        const name = getName();
        SFX.unlock();
        SAVE_SLOT = slot;
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
  } else if (mode === 'changelog') {
    // 純展示的靜態資料(CHANGELOG,config.js),不影響任何遊戲邏輯,回主選單就是 setOverlay('start')
    const html = CHANGELOG.map(g => `
      <div class="changelog-group">
        <div class="changelog-date">${g.date}</div>
        <ul>${g.items.map(t => `<li>${t}</li>`).join('')}</ul>
      </div>`).join('');
    ov.innerHTML = `
      <div class="menu changelog-menu">
        <h1>📜 更新紀錄</h1>
        <div class="changelog-list">${html}</div>
        <div class="btnrow"><button id="btnChangelogBack">← 返回主選單</button></div>
      </div>`;
    $id('btnChangelogBack').onclick = () => setOverlay('start');
  } else if (mode === 'slots') {
    // 存檔欄位選擇:UI.slotPick = 'load'(讀哪一格)或 'new'(三格全滿時挑一格覆蓋開新世界)
    const forNew = UI.slotPick === 'new';
    const rows = [];
    for (let n = 1; n <= SAVE_SLOTS; n++) {
      const info = slotInfo(n);
      let meta;
      if (!info) meta = '<span class="dim">(空欄位)</span>';
      else if (info.broken) meta = '<span class="warn">⚠️ 存檔資料損壞,只能刪除</span>';
      else {
        const when = info.savedAt ? new Date(info.savedAt).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        meta = `<b>${info.hostName}</b> 的世界 · ${info.diffLabel} · 💠 ${info.shards}/3${info.won ? ' · 🏆 已通關' : ''}<br>
          <span class="dim">⏱️ ${fmtPlayTime(info.time)}${when ? ' · 存於 ' + when : ''}</span>`;
      }
      const canLoad = info && !info.broken;
      const actBtn = forNew
        ? `<button class="slotAct" data-slot="${n}">🌍 ${info ? '覆蓋' : '開新世界'}</button>`
        : `<button class="slotAct" data-slot="${n}" ${canLoad ? '' : 'disabled'}>📂 讀取</button>`;
      rows.push(`
        <div class="slotrow">
          <div class="slotmeta">欄位 ${n}<br>${meta}</div>
          ${actBtn}
          <button class="slotDel" data-slot="${n}" ${info ? '' : 'disabled'} title="刪除這格存檔">🗑️</button>
        </div>`);
    }
    ov.innerHTML = `
      <div class="menu">
        <h1>${forNew ? '🌍 挑一格放新世界' : '📂 繼續存檔'}</h1>
        <p class="sub">${forNew ? '三個欄位都滿了——選一格覆蓋,或先刪掉不要的' : '選一格接著玩(存檔都在這台電腦的瀏覽器裡)'}</p>
        ${rows.join('')}
        <div class="btnrow"><button id="btnSlotBack">← 返回</button></div>
      </div>`;
    for (const btn of ov.querySelectorAll('.slotAct')) {
      btn.onclick = () => {
        const n = +btn.dataset.slot;
        if (forNew && slotInfo(n) && !confirm(`欄位 ${n} 的存檔會被新世界覆蓋,確定嗎?`)) return;
        beginGame(!forNew, n);
      };
    }
    for (const btn of ov.querySelectorAll('.slotDel')) {
      btn.onclick = () => {
        const n = +btn.dataset.slot;
        if (!confirm(`確定要刪除欄位 ${n} 的存檔嗎?這個動作無法復原。`)) return;
        try { localStorage.removeItem(saveKeyOf(n)); } catch (e) { }
        setOverlay('slots'); // 重畫列表
      };
    }
    $id('btnSlotBack').onclick = () => setOverlay('start');
  } else if (mode === 'win') {
    ov.innerHTML = `<div class="menu"><h1>🏆 通關!</h1>
      <p class="sub">星核醒了,深淵亮了——都是你們的功勞!<br>聽說最深處的「淵核區」剛剛解封了……✨<br>
      而且深淵沒打算安靜:「<b>無盡暗潮</b>」開始醞釀,一波更比一波兇,星核也還是要餵——看你們能撐到第幾波!</p>
      <div class="btnrow"><button id="btnCont">⛏️ 衝淵核區!迎戰無盡暗潮</button></div></div>`;
    $id('btnCont').onclick = () => setOverlay(null);
  } else if (mode === 'lose') {
    const host = NET.isHost();
    ov.innerHTML = `<div class="menu"><h1>💤 星核睡著了</h1>
      <p class="sub">牠沒有生氣,牠只是想睡……揉揉眼睛,再來一次吧!</p>
      <div class="btnrow">${host
        ? `<button id="btnLoad2" ${anySave() ? '' : 'disabled'}>📂 讀取存檔</button><button id="btnNew2">🌍 新世界</button>`
        : '<p class="sub">等待房主決定重來,或重新整理頁面回主選單</p>'}</div></div>`;
    if (host) {
      $id('btnLoad2').onclick = () => { location.reload(); }; // 重新整理後從選單讀檔最穩定
      $id('btnNew2').onclick = () => { try { localStorage.removeItem(saveKeyOf(SAVE_SLOT)); } catch (e) { } location.reload(); };
    }
  } else if (mode === 'migrating') {
    ov.innerHTML = `<div class="menu"><h1>⚡ 房主換人中</h1>
      <p class="sub">原房主斷線了!繼任房主正在開房,馬上把你接回去……<br>
      (背包跟著名字走,什麼都不會丟。最多等一分鐘,接不上才會回到斷線畫面)</p></div>`;
  } else if (mode === 'disconnected') {
    ov.innerHTML = `<div class="menu"><h1>🔌 與房主斷線</h1>
      <div class="btnrow"><button onclick="location.reload()">回主選單</button></div></div>`;
  }
}

function getName() {
  // 存檔欄位選擇畫面沒有名字輸入框,退回上次記住的名字(從主畫面進來時已經存過)
  const v = ($id('nameInput')?.value || '').trim() || localStorage.getItem('gld_name') || '礦工' + ((Math.random() * 99) | 0);
  localStorage.setItem('gld_name', v);
  return v;
}

function beginGame(load, slot) {
  const name = getName();
  const diff = UI.selectedDifficulty;
  SFX.unlock();
  if (slot) SAVE_SLOT = slot; // 之後整局的自動存檔都寫這一格
  if (load) {
    if (!loadGame(name)) { showMsg('⚠️ 讀檔失敗,改開新世界'); startNewGame(name, diff); }
  } else startNewGame(name, diff);
  UI.mmDirty = true; UI.invDirty = true;
  setOverlay(null);
}

// 房主斷線轉移:接棒成功後把右上角的開房 UI 切成「已開房」狀態(net.js _takeover 呼叫)
function onBecameHost(code) {
  UI.els.roomcode.textContent = `🔗 房號:${code}(點擊複製)`;
  UI.els.roomcode.classList.remove('hidden');
  UI.els.hostBtn.classList.add('hidden');
}

// 開房(單機途中隨時可開)
function openRoom() {
  SFX.unlock();
  G.paused = false; // 開房邀請朋友後就不再是單機了,暫停會卡住新加入的玩家
  UI.els.hostBtn.disabled = true;
  UI.els.hostBtn.textContent = '開房中…';
  NET.startHost(code => {
    onBecameHost(code);
    showMsg('✅ 開房成功!把房號丟給朋友,一起來挖!');
  }, err => {
    showMsg('⚠️ ' + err);
    UI.els.hostBtn.disabled = false;
    UI.els.hostBtn.textContent = '🔗 開房邀請朋友';
  });
}
