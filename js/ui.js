// ===== UI(DOM):血條、星核條、快捷欄、背包合成、小地圖、選單 =====
const UI = {
  mmDirty: true, invDirty: true,
  pendingSwap: -1, panelOpen: false,
  menuOpen: false, menuView: 'main',
  els: {}, mmImage: null, mmT: 0, craftT: 0,
};

function $id(s) { return document.getElementById(s); }

function initUI() {
  UI.els = {
    hpfill: $id('hpfill'), hptext: $id('hptext'),
    corefill: $id('corefill'), coretext: $id('coretext'),
    xpfill: $id('xpfill'), xptext: $id('xptext'),
    stafill: $id('stafill'), statext: $id('statext'),
    shards: $id('shards'), wavebox: $id('wavebox'),
    hotbar: $id('hotbar'), msglog: $id('msglog'),
    chatlog: $id('chatlog'), chatbox: $id('chatbox'), chatInput: $id('chatInput'),
    invpanel: $id('invpanel'), invgrid: $id('invgrid'), craftlist: $id('craftlist'),
    overlay: $id('overlay'), minimap: $id('minimap'),
    hostBtn: $id('hostBtn'), roomcode: $id('roomcode'),
    deathbanner: $id('deathbanner'),
    menuPanel: $id('menuPanel'),
  };
  // 快捷欄 8 格
  for (let i = 0; i < 8; i++) {
    const d = document.createElement('div');
    d.className = 'slot';
    d.dataset.i = i;
    d.innerHTML = `<span class="key">${i + 1}</span><span class="icon"></span><span class="cnt"></span>`;
    d.onclick = () => { const me = myPlayer(); if (me) { me.sel = i; UI.invDirty = true; } };
    UI.els.hotbar.appendChild(d);
  }
  // 背包 32 格
  for (let i = 0; i < INV_SIZE; i++) {
    const d = document.createElement('div');
    d.className = 'slot' + (i < 8 ? ' hotrow' : '');
    d.dataset.i = i;
    d.innerHTML = `<span class="icon"></span><span class="cnt"></span>`;
    d.onclick = () => onInvClick(i);
    UI.els.invgrid.appendChild(d);
  }
  UI.els.hostBtn.onclick = openRoom;
  UI.els.roomcode.onclick = () => {
    navigator.clipboard?.writeText(NET.code);
    showMsg('📋 房號已複製:' + NET.code);
  };
}

function myPlayer() { return G.players.get(G.myId); }

function onInvClick(i) {
  const me = myPlayer();
  if (!me) return;
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
  while (log.children.length > 20) log.lastChild.remove();
  setTimeout(() => { d.classList.add('fade'); setTimeout(() => d.remove(), 900); }, 12000);
}

function openChat() {
  if (!G.started || UI.menuOpen) return;
  UI.els.chatbox.classList.remove('hidden');
  UI.els.chatInput.value = '';
  UI.els.chatInput.focus();
}

function closeChat() {
  UI.els.chatbox.classList.add('hidden');
  UI.els.chatInput.blur();
}

function sendChat() {
  const text = UI.els.chatInput.value.trim().slice(0, 80);
  closeChat();
  if (!text) return;
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

  // 小地圖
  UI.mmT -= dt;
  if (UI.mmT <= 0) { UI.mmT = 0.4; drawMinimap(); }

  UI.els.hostBtn.classList.toggle('hidden', !(NET.isHost() && NET.mode === 'single'));
}

function slotHTML(el, s, selected, pending) {
  el.querySelector('.icon').textContent = s ? ITEMS[s.id].icon : '';
  el.querySelector('.cnt').textContent = s && s.count > 1 ? s.count : '';
  el.style.background = s && ITEMS[s.id].tint ? ITEMS[s.id].tint : '';
  el.classList.toggle('sel', !!selected);
  el.classList.toggle('pending', !!pending);
  el.title = s ? ITEMS[s.id].name + (ITEMS[s.id].desc ? '\n' + ITEMS[s.id].desc : '') : '';
}

function refreshSlots() {
  const me = myPlayer();
  if (!me) return;
  [...UI.els.hotbar.children].forEach((el, i) => slotHTML(el, me.inv[i], me.sel === i));
  [...UI.els.invgrid.children].forEach((el, i) => slotHTML(el, me.inv[i], false, UI.pendingSwap === i));
}

// 依配方產出的物品欄位推斷分類(不额外改資料結構)
const RECIPE_CATS = [
  { key: 'tool',  name: '⛏️ 工具', test: it => !!it.pick },
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
    UI.catHeaders = {};
    for (const c of RECIPE_CATS) {
      const h = document.createElement('div');
      h.className = 'rcathead';
      h.textContent = c.name;
      UI.catHeaders[c.key] = h;
    }
  }

  // 分類 -> 類別內材料足夠優先,其餘維持原配方順序
  const order = RECIPES.map((r, i) => ({ i, r, cat: recipeCat(r), ok: canAfford(me, r.cost) && stationNear(me, r.station) }));
  for (const o of order) UI.recipeEls[o.i].classList.toggle('ok', o.ok);

  list.innerHTML = '';
  for (const c of RECIPE_CATS) {
    const items = order.filter(o => o.cat === c.key).sort((a, b) => b.ok - a.ok);
    if (!items.length) continue;
    list.appendChild(UI.catHeaders[c.key]);
    for (const o of items) list.appendChild(UI.recipeEls[o.i]);
  }
}

function togglePanel(open) {
  UI.panelOpen = open === undefined ? !UI.panelOpen : open;
  UI.els.invpanel.classList.toggle('hidden', !UI.panelOpen);
  UI.pendingSwap = -1;
  if (UI.panelOpen) { refreshSlots(); UI.craftT = 0; }
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
    panel.innerHTML = `
      <h2>選單</h2>
      <div class="btnrow col">
        <button id="mResume">▶️ 返回遊戲</button>
        <button id="mSettings">⚙️ 設定</button>
      </div>`;
    $id('mResume').onclick = () => toggleMenu(false);
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
      <div class="btnrow">
        <button id="mSaveNow">💾 立即存檔</button>
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
  for (const p of G.players.values()) {
    if (p.dead) continue;
    mc.fillStyle = PLAYER_COLORS[p.id % PLAYER_COLORS.length];
    mc.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
  }
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
        <div class="joinrow">
          <input id="codeInput" maxlength="5" placeholder="朋友的房號" ${netOK ? '' : 'disabled'}>
          <button id="btnJoin" ${netOK ? '' : 'disabled'}>🔗 加入房間</button>
        </div>
        ${netOK ? '' : '<p class="warn">⚠️ 目前無法載入連線元件(需網路),仍可離線單人遊玩</p>'}
        <div class="help">
          <b>目標</b>:星核能量會一直流失,挖 <b>光晶💠</b> 回來按 <b>F</b> 灌入;
          打敗外圈三座神殿的守衛、集齊 3 塊碎片,撐過最終暗潮即通關。<br>
          <b>操作</b>:WASD 移動|左鍵 挖牆/攻擊|右鍵 放置/吃|1–8 快捷欄|E 背包合成|F 餵星核<br>
          <b>連線</b>:進入遊戲後點右上「開房邀請朋友」,把房號給朋友即可;存檔在房主電腦。
        </div>
      </div>`;
    $id('btnNew').onclick = () => beginGame(false);
    $id('btnLoad').onclick = () => beginGame(true);
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
