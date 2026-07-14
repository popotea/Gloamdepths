// ===== 進入點:輸入處理與主迴圈 =====
const INPUT = { keys: new Set(), mx: 0, my: 0, l: false, r: false, rCD: 0 };

function typingInInput() {
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}

function bindInput() {
  UI.els.chatInput?.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') sendChat();
    else if (e.key === 'Escape') closeChat();
    else if (e.key === 'ArrowUp') {
      // 叫回上一則輸入過的內容(聊天訊息或 /power 指令都會被記住)
      e.preventDefault();
      if (!UI.chatHistory.length) return;
      UI.chatHistoryIdx = Math.max(0, UI.chatHistoryIdx - 1);
      UI.els.chatInput.value = UI.chatHistory[UI.chatHistoryIdx] || '';
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!UI.chatHistory.length) return;
      UI.chatHistoryIdx = Math.min(UI.chatHistory.length, UI.chatHistoryIdx + 1);
      UI.els.chatInput.value = UI.chatHistory[UI.chatHistoryIdx] || '';
    }
  });
  addEventListener('keydown', e => {
    if (typingInInput()) return;
    const k = e.key.toLowerCase();
    INPUT.keys.add(k);
    const me = myPlayer();
    if (!G.started || !me) return;
    if (k === 'escape') {
      if (UI.mapOpen) toggleMapPanel(false);
      else if (UI.panelOpen) togglePanel(false);
      else if (UI.towerPos) closeTowerPanel();
      else if (UI.traderOpen) closeTraderPanel();
      else if (UI.storagePos) closeStoragePanel();
      else if (UI.emoteOpen) toggleEmotePanel(false);
      else if (UI.powerOpen) togglePowerPanel(false);
      else if (UI.talentOpen) toggleTalentPanel(false);
      else toggleMenu();
      return;
    }
    if (UI.menuOpen || UI.powerOpen) return;
    if (k === 'enter') { openChat(); return; }
    if (k === 'e') togglePanel();
    else if (k === 't') toggleTalentPanel();
    else if (k === 'm') toggleMapPanel();
    else if (k === 'v') toggleSpectate();
    else if (k === 'c') toggleEmotePanel();
    else if (k >= '1' && k <= '8') { me.sel = +k - 1; UI.invDirty = true; }
    else if (k === 'f') {
      if (NET.isHost()) doDeposit(me);
      else NET.act({ t: 'deposit' });
    } else if (k === 'q' && !UI.panelOpen) {
      if (NET.isHost()) doDropItem(me, me.sel);
      else NET.act({ t: 'drop', slot: me.sel });
    }
  });
  addEventListener('keyup', e => INPUT.keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => INPUT.keys.clear());

  const gameCv = document.getElementById('game');
  addEventListener('mousemove', e => { INPUT.mx = e.clientX; INPUT.my = e.clientY; });
  gameCv.addEventListener('mousedown', e => {
    SFX.unlock();
    if (e.button === 0) INPUT.l = true;
    if (e.button === 2) INPUT.r = true;
  });
  addEventListener('mouseup', e => {
    if (e.button === 0) INPUT.l = false;
    if (e.button === 2) INPUT.r = false;
  });
  gameCv.addEventListener('contextmenu', e => e.preventDefault());
  gameCv.addEventListener('wheel', e => {
    const me = myPlayer();
    if (!me) return;
    me.sel = (me.sel + (e.deltaY > 0 ? 1 : 7)) % 8;
    UI.invDirty = true;
  }, { passive: true });

  // 把背包格子拖到地上放開 = 丟在那個位置(超出可及範圍/落點是牆會自動夾到腳邊,見 doDropAt)
  gameCv.addEventListener('dragover', e => e.preventDefault());
  gameCv.addEventListener('drop', e => {
    e.preventDefault();
    const me = myPlayer();
    const slot = +e.dataTransfer.getData('text/plain');
    if (!me || isNaN(slot) || !me.inv[slot]) return;
    const [wx, wy] = screenToWorld(e.clientX, e.clientY);
    if (NET.isHost()) doDropAt(me, slot, wx, wy);
    else NET.act({ t: 'drop_at', slot, x: wx, y: wy });
  });
}

// 觀戰自由鏡頭移動速度(格/秒)
const SPEC_CAM_SPEED = 18;

// 觀戰模式切換(V 鍵):存活時進出自由鏡頭;死亡中按 V = 鏡頭拉回自己倒下的位置
function toggleSpectate() {
  const me = myPlayer();
  if (!me) return;
  if (UI.spec && !me.dead) { UI.spec = null; showMsg('👁️ 鏡頭回到自己身上'); }
  else {
    UI.spec = { x: me.x, y: me.y, auto: me.dead };
    if (!me.dead) showMsg('👁️ 觀戰模式:WASD 移動鏡頭看隊友,V 返回');
  }
}

// 本地玩家控制(房主與客戶端共用;客戶端做本地預測)
function localControl(me, dt) {
  // 觀戰模式:死亡倒數自動啟用、復活自動收回;啟用時 WASD 移動的是鏡頭不是角色。
  // 純本地(只改 UI.spec),不影響模擬、不需要任何網路協定
  if (me.dead && !UI.spec) UI.spec = { x: me.x, y: me.y, auto: true };
  if (!me.dead && UI.spec && UI.spec.auto) UI.spec = null;
  if (UI.spec) {
    if (UI.menuOpen || UI.powerOpen) return;
    let dx = 0, dy = 0;
    if (INPUT.keys.has('w') || INPUT.keys.has('arrowup')) dy -= 1;
    if (INPUT.keys.has('s') || INPUT.keys.has('arrowdown')) dy += 1;
    if (INPUT.keys.has('a') || INPUT.keys.has('arrowleft')) dx -= 1;
    if (INPUT.keys.has('d') || INPUT.keys.has('arrowright')) dx += 1;
    if (dx || dy) {
      const len = Math.hypot(dx, dy);
      UI.spec.x = clamp(UI.spec.x + dx / len * SPEC_CAM_SPEED * dt, 0, MAP_W);
      UI.spec.y = clamp(UI.spec.y + dy / len * SPEC_CAM_SPEED * dt, 0, MAP_H);
    }
    return; // 觀戰時角色原地待機,不接受任何動作輸入
  }
  // 倒下(隊友救援待救狀態,尚未徹底陣亡):不接受任何輸入,鏡頭停在倒下位置(不進觀戰,好讓
  // 玩家看著隊友是否趕來、也讓隊友從遠處認得出你倒下的位置);渲染另有專屬畫法(見 render.js)
  if (me.dead || me.downed || UI.menuOpen || UI.powerOpen) return;
  // 移動
  let dx = 0, dy = 0;
  if (INPUT.keys.has('w') || INPUT.keys.has('arrowup')) dy -= 1;
  if (INPUT.keys.has('s') || INPUT.keys.has('arrowdown')) dy += 1;
  if (INPUT.keys.has('a') || INPUT.keys.has('arrowleft')) dx -= 1;
  if (INPUT.keys.has('d') || INPUT.keys.has('arrowright')) dx += 1;

  // 衝刺:Shift 瞬間加速,消耗體力,冷卻中或體力不足不能觸發(衝刺大師天賦降低消耗)
  me.dashCD -= dt; me.dashT -= dt;
  const dashCost = DASH_CFG.cost * (1 - TALENTS.dasher.val * talRank(me, 'dasher'));
  if (me.dashCD <= 0 && (INPUT.keys.has('shift') || INPUT.keys.has('shiftleft') || INPUT.keys.has('shiftright'))
      && (dx || dy) && me.stamina >= dashCost) {
    me.stamina -= dashCost;
    me.dashT = DASH_CFG.dur;
    me.dashCD = DASH_CFG.cd;
    emitFx({ k: 'sfx', s: 'dash' });
  }
  // 精力 buff(奶菇濃湯)× 幸運蛾寵物:體力回復速度倍率
  if (me.dashT <= 0) me.stamina = Math.min(100, me.stamina + DASH_CFG.regen * buffMult(me, 'vigor') * (1 + petVal(me, 'vigor')) * dt);

  if (dx || dy) {
    const len = Math.hypot(dx, dy);
    // 疾行 buff(料理)× 冰系減速 debuff × 健步如飛天賦 × 燼尾狐寵物:客戶端自己的 buffs/talents/pet
    // 由快照同步,本地預測才會跟房主一致
    // 軌道加速:腳下 tile 是軌道就大幅提速(軌道地形靠 setTile 廣播,雙端都知道哪裡有軌道,本地預測算得出一致移速)
    const onRail = tileAt(Math.floor(me.x), Math.floor(me.y)) === T.RAIL;
    const spd = 4.6 * (me.dashT > 0 ? DASH_CFG.mult : 1) * buffMult(me, 'speed') * buffMult(me, 'slow')
      * (1 + TALENTS.swift.val * talRank(me, 'swift')) * (1 + petVal(me, 'speed')) * (1 + equipSpeedBonus(me)) * (onRail ? RAIL_CFG.speedMult : 1);
    moveCircle(me, dx / len * spd * dt, dy / len * spd * dt);
  }
  // 瞄準
  const [wx, wy] = screenToWorld(INPUT.mx, INPUT.my);
  me.aim = Math.atan2(wy - me.y, wx - me.x);

  // 左鍵:挖牆 / 拆物件 / 攻擊(自動判斷);快捷欄選中遠程武器時優先發射,不會誤觸挖礦
  const selItem = me.inv[me.sel];
  const rangedW = selItem && ITEMS[selItem.id].ranged;
  if (INPUT.l && !UI.panelOpen) {
    const tx = Math.floor(wx), ty = Math.floor(wy);
    const info = infoAt(tx, ty);
    const o = objAt(tx, ty);
    const mineable = !rangedW && ((info.solid && info.hp !== Infinity) || (o && o.type !== 'mushroom'))
      && dist(me.x, me.y, tx + 0.5, ty + 0.5) <= 3.6;
    if (mineable) {
      if (me.mineCD <= 0) {
        if (NET.isHost()) doMine(me, tx, ty);
        else { me.mineCD = 0.26; me.swing = 0.2; me.action = 'mine'; NET.act({ t: 'mine', x: tx, y: ty }); }
      }
    } else if (rangedW) {
      if (me.atkCD <= 0) {
        if (NET.isHost()) doShoot(me, me.aim);
        else { me.atkCD = rangedW.cd; me.swing = 0.18; me.action = 'atk'; NET.act({ t: 'shoot', aim: me.aim }); }
      }
    } else if (me.atkCD <= 0) {
      if (NET.isHost()) doSwing(me, me.aim);
      else {
        const meleeW = ITEMS[selItem?.id]?.sword;
        me.atkCD = (meleeW && meleeW.manual ? meleeW.cd : null) ?? 0.35;
        me.swing = 0.22; me.action = 'atk'; NET.act({ t: 'atk', aim: me.aim });
      }
    }
  }

  // 右鍵:對準箭塔開儲物面板、對準工作台/熔爐直接開背包+合成,否則依快捷欄選中物品放置/吃
  INPUT.rCD -= dt;
  if (INPUT.r && INPUT.rCD <= 0 && !UI.panelOpen) {
    INPUT.rCD = 0.25;
    const tx0 = Math.floor(wx), ty0 = Math.floor(wy);
    const targetObj = objAt(tx0, ty0);
    const inRange = dist(me.x, me.y, tx0 + 0.5, ty0 + 0.5) <= 3.8;
    const trader = G.traders.find(t => dist(t.x, t.y, wx, wy) < 0.8);
    if (trader && dist(me.x, me.y, trader.x, trader.y) <= 3.8) {
      openTraderPanel();
    } else if (targetObj && targetObj.type === 'archer_tower' && inRange) {
      openTowerPanel(tx0, ty0);
    } else if (targetObj && targetObj.type === 'auto_miner' && inRange) {
      // 採礦機:手持光晶補燃料(不然什麼都不做,避免誤觸)
      const s = me.inv[me.sel];
      if (s && s.id === 'lumite') {
        if (NET.isHost()) doFuelMiner(me, tx0, ty0);
        else NET.act({ t: 'fuelminer', x: tx0, y: ty0 });
      } else addFloater(tx0 + 0.5, ty0 + 0.5, '手持光晶💠 右鍵供電', '#8899aa');
    } else if (targetObj && targetObj.type === 'auto_smelter' && inRange) {
      // 熔煉爐:手持煤補燃料、手持可熔礦石塞原料(判定在房主端 doFeedSmelter,這裡直接轉發)
      if (NET.isHost()) doFeedSmelter(me, tx0, ty0);
      else NET.act({ t: 'smelter', x: tx0, y: ty0 });
    } else if (targetObj && targetObj.type === 'belt' && inRange && !me.inv[me.sel]) {
      // 傳輸帶:空手右鍵旋轉方向(手上有東西時走下面的放置邏輯,才能在傳輸帶旁繼續鋪別的)
      if (NET.isHost()) doRotateBelt(me, tx0, ty0);
      else NET.act({ t: 'rotatebelt', x: tx0, y: ty0 });
    } else if (targetObj && targetObj.type === 'storage' && inRange) {
      openStoragePanel(tx0, ty0);
    } else if (targetObj && (targetObj.type === 'workbench' || targetObj.type === 'furnace') && inRange) {
      togglePanel(true);
    } else {
      const s = me.inv[me.sel];
      if (s) {
        const it = ITEMS[s.id];
        // 餵動物優先於吃/放置:滑鼠指著動物、手上又是牠的飼料才成立(蘑菇既是食物也是飼料)
        const ani = G.animals.find(a => dist(a.x, a.y, wx, wy) < 0.8);
        if (ani && ANIMAL_TYPES[ani.type].feed.includes(s.id) && dist(me.x, me.y, ani.x, ani.y) <= 3.8) {
          if (NET.isHost()) doFeed(me, ani.id, me.sel);
          else NET.act({ t: 'feed', id: ani.id, slot: me.sel });
        } else if (it.food) {
          if (NET.isHost()) doEat(me, me.sel);
          else NET.act({ t: 'eat', slot: me.sel });
        } else if (it.place || it.placeTile !== undefined) {
          if (NET.isHost()) doPlace(me, me.sel, tx0, ty0);
          else NET.act({ t: 'place', slot: me.sel, x: tx0, y: ty0 });
        } else if (it.till) {
          if (NET.isHost()) doTill(me, tx0, ty0);
          else NET.act({ t: 'till', x: tx0, y: ty0 });
        } else if (it.seed) {
          if (NET.isHost()) doPlant(me, me.sel, tx0, ty0);
          else NET.act({ t: 'plant', slot: me.sel, x: tx0, y: ty0 });
        } else if (it.fish && infoAt(tx0, ty0).liquid) {
          if (NET.isHost()) doFish(me, tx0, ty0);
          else NET.act({ t: 'fish', x: tx0, y: ty0 });
        } else if (it.recall) {
          // 歸巢螢石:引導計時/中斷/傳送全在房主端(比照釣魚),客戶端只送意圖
          if (NET.isHost()) doRecall(me, me.sel);
          else NET.act({ t: 'recall', slot: me.sel });
        } else if (it.pet) {
          // 寵物召喚物:純粹切換 p.pet 欄位,不消耗物品
          if (NET.isHost()) doPet(me, me.sel);
          else NET.act({ t: 'pet', slot: me.sel });
        } else if (it.equipSlot) {
          // 裝備欄位:右鍵自動穿上對應欄位,不做本地預測(等下一次快照的 me.equip 更新面板)
          if (NET.isHost()) doEquip(me, me.sel);
          else NET.act({ t: 'equip', slot: me.sel });
        }
      }
    }
  }
}

// 客戶端本地冷卻計時(房主端由 updatePlayersHost 處理)
function clientTimers(me, dt) {
  me.mineCD -= dt; me.atkCD -= dt;
  if (me.swing > 0) me.swing -= dt;
  for (const p of G.players.values()) {
    if (p.id !== G.myId && p.swing > 0) p.swing -= dt;
  }
}

// ===== 主迴圈 =====
let lastTS = performance.now();
function frame(ts) {
  const dt = Math.min(0.05, (ts - lastTS) / 1000);
  lastTS = ts;
  if (G.started) {
    const me = myPlayer();
    if (me) {
      if (!G.paused) localControl(me, dt);
      if (NET.isHost()) {
        if (!G.over && !G.paused) simTick(dt);
        NET.hostTick(dt);
      } else {
        NET.clientTick(dt);
        clientTimers(me, dt);
      }
      if (!G.paused) { updateFloaters(dt); updateHitFx(dt); updateEmoteFx(dt); }
    }
  }
  render(dt);
  uiTick(dt);
  requestAnimationFrame(frame);
}

addEventListener('load', () => {
  initRender();
  initUI();
  bindInput();
  setOverlay('start');
  addEventListener('beforeunload', () => {
    if (NET.isHost() && G.started) saveGame();
    // 房主關頁面前盡力推最後一份備援給繼任者(best effort:unload 時 datachannel 不保證送達,
    // 送不到也只是繼任者用最多 20 秒前的那份)
    if (NET.mode === 'host') { try { NET._pushBackup(); } catch (e) { } }
  });
  requestAnimationFrame(frame);
});
