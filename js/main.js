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
  });
  addEventListener('keydown', e => {
    if (typingInInput()) return;
    const k = e.key.toLowerCase();
    INPUT.keys.add(k);
    const me = myPlayer();
    if (!G.started || !me) return;
    if (k === 'escape') {
      if (UI.panelOpen) togglePanel(false);
      else toggleMenu();
      return;
    }
    if (UI.menuOpen) return;
    if (k === 'enter') { openChat(); return; }
    if (k === 'e') togglePanel();
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
}

// 本地玩家控制(房主與客戶端共用;客戶端做本地預測)
function localControl(me, dt) {
  if (me.dead || UI.menuOpen) return;
  // 移動
  let dx = 0, dy = 0;
  if (INPUT.keys.has('w') || INPUT.keys.has('arrowup')) dy -= 1;
  if (INPUT.keys.has('s') || INPUT.keys.has('arrowdown')) dy += 1;
  if (INPUT.keys.has('a') || INPUT.keys.has('arrowleft')) dx -= 1;
  if (INPUT.keys.has('d') || INPUT.keys.has('arrowright')) dx += 1;

  // 衝刺:Shift 瞬間加速,消耗體力,冷卻中或體力不足不能觸發
  me.dashCD -= dt; me.dashT -= dt;
  if (me.dashCD <= 0 && (INPUT.keys.has('shift') || INPUT.keys.has('shiftleft') || INPUT.keys.has('shiftright'))
      && (dx || dy) && me.stamina >= DASH_CFG.cost) {
    me.stamina -= DASH_CFG.cost;
    me.dashT = DASH_CFG.dur;
    me.dashCD = DASH_CFG.cd;
    emitFx({ k: 'sfx', s: 'dash' });
  }
  if (me.dashT <= 0) me.stamina = Math.min(100, me.stamina + DASH_CFG.regen * dt);

  if (dx || dy) {
    const len = Math.hypot(dx, dy);
    const spd = 4.6 * (me.dashT > 0 ? DASH_CFG.mult : 1);
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
      else { me.atkCD = 0.35; me.swing = 0.22; me.action = 'atk'; NET.act({ t: 'atk', aim: me.aim }); }
    }
  }

  // 右鍵:對準箭塔補箭矢/開關優先,否則依快捷欄選中物品放置/吃
  INPUT.rCD -= dt;
  if (INPUT.r && INPUT.rCD <= 0 && !UI.panelOpen) {
    INPUT.rCD = 0.25;
    const tx0 = Math.floor(wx), ty0 = Math.floor(wy);
    const targetObj = objAt(tx0, ty0);
    const s = me.inv[me.sel];
    if (targetObj && targetObj.type === 'archer_tower' && dist(me.x, me.y, tx0 + 0.5, ty0 + 0.5) <= 3.8) {
      if (s && s.id === 'arrow') {
        if (NET.isHost()) doFillTower(me, tx0, ty0);
        else NET.act({ t: 'fill_tower', x: tx0, y: ty0 });
      } else {
        if (NET.isHost()) doToggleTower(me, tx0, ty0);
        else NET.act({ t: 'toggle_tower', x: tx0, y: ty0 });
      }
    } else if (s) {
      const it = ITEMS[s.id];
      if (it.food) {
        if (NET.isHost()) doEat(me, me.sel);
        else NET.act({ t: 'eat', slot: me.sel });
      } else if (it.place || it.placeTile !== undefined) {
        if (NET.isHost()) doPlace(me, me.sel, tx0, ty0);
        else NET.act({ t: 'place', slot: me.sel, x: tx0, y: ty0 });
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
      localControl(me, dt);
      if (NET.isHost()) {
        if (!G.over) simTick(dt);
        NET.hostTick(dt);
      } else {
        NET.clientTick(dt);
        clientTimers(me, dt);
      }
      updateFloaters(dt);
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
  addEventListener('beforeunload', () => { if (NET.isHost() && G.started) saveGame(); });
  requestAnimationFrame(frame);
});
