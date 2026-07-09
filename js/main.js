// ===== 進入點:輸入處理與主迴圈 =====
const INPUT = { keys: new Set(), mx: 0, my: 0, l: false, r: false, rCD: 0 };

function typingInInput() {
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}

function bindInput() {
  addEventListener('keydown', e => {
    if (typingInInput()) return;
    const k = e.key.toLowerCase();
    INPUT.keys.add(k);
    const me = myPlayer();
    if (!G.started || !me) return;
    if (k === 'e') togglePanel();
    else if (k === 'escape') togglePanel(false);
    else if (k >= '1' && k <= '8') { me.sel = +k - 1; UI.invDirty = true; }
    else if (k === 'f') {
      if (NET.isHost()) doDeposit(me);
      else NET.act({ t: 'deposit' });
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
  if (me.dead) return;
  // 移動
  let dx = 0, dy = 0;
  if (INPUT.keys.has('w') || INPUT.keys.has('arrowup')) dy -= 1;
  if (INPUT.keys.has('s') || INPUT.keys.has('arrowdown')) dy += 1;
  if (INPUT.keys.has('a') || INPUT.keys.has('arrowleft')) dx -= 1;
  if (INPUT.keys.has('d') || INPUT.keys.has('arrowright')) dx += 1;
  if (dx || dy) {
    const len = Math.hypot(dx, dy);
    const spd = 4.6;
    moveCircle(me, dx / len * spd * dt, dy / len * spd * dt);
  }
  // 瞄準
  const [wx, wy] = screenToWorld(INPUT.mx, INPUT.my);
  me.aim = Math.atan2(wy - me.y, wx - me.x);

  // 左鍵:挖牆 / 拆物件 / 攻擊(自動判斷)
  if (INPUT.l && !UI.panelOpen) {
    const tx = Math.floor(wx), ty = Math.floor(wy);
    const info = infoAt(tx, ty);
    const o = objAt(tx, ty);
    const mineable = ((info.solid && info.hp !== Infinity) || (o && o.type !== 'mushroom'))
      && dist(me.x, me.y, tx + 0.5, ty + 0.5) <= 3.6;
    if (mineable) {
      if (me.mineCD <= 0) {
        if (NET.isHost()) doMine(me, tx, ty);
        else { me.mineCD = 0.26; me.swing = 0.2; NET.act({ t: 'mine', x: tx, y: ty }); }
      }
    } else if (me.atkCD <= 0) {
      if (NET.isHost()) doSwing(me, me.aim);
      else { me.atkCD = 0.35; me.swing = 0.22; NET.act({ t: 'atk', aim: me.aim }); }
    }
  }

  // 右鍵:放置 / 吃(依快捷欄選中物品)
  INPUT.rCD -= dt;
  if (INPUT.r && INPUT.rCD <= 0 && !UI.panelOpen) {
    INPUT.rCD = 0.25;
    const s = me.inv[me.sel];
    if (s) {
      const it = ITEMS[s.id];
      if (it.food) {
        if (NET.isHost()) doEat(me, me.sel);
        else NET.act({ t: 'eat', slot: me.sel });
      } else if (it.place || it.placeTile !== undefined) {
        const tx = Math.floor(wx), ty = Math.floor(wy);
        if (NET.isHost()) doPlace(me, me.sel, tx, ty);
        else NET.act({ t: 'place', slot: me.sel, x: tx, y: ty });
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
