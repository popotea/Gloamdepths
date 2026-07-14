// ===== 實體:玩家、敵人、掉落物、戰鬥、挖掘、放置 =====
let nextEid = 1, nextDid = 1, nextPjid = 1, nextAid = 1;

const PLAYER_COLORS = ['#ffd97a', '#7ad0ff', '#8dff9e', '#ff9ecb'];

function makePlayer(id, name) {
  const p = {
    id, name,
    x: G.core.x + (id % 2 ? 1.5 : -1.5), y: G.core.y + (id >= 2 ? 1.5 : -1.5),
    r: 0.35, hp: 100, maxhp: 100, aim: 0,
    inv: makeStartInv(), sel: 0,
    swing: 0, atkCD: 0, mineCD: 0, iframe: 0, lastHurt: -99,
    dead: false, respawnT: 0, invDirty: true,
    downed: false, downedT: 0, reviveP: 0, // 隊友救援(倒地非陣亡),見 REVIVE_CFG
    emoteCD: 0, // 快速手勢冷卻(防手滑連點洗頻),見 EMOTE_CFG
    pet: null, // 目前出戰的寵物(PET_TYPES 的 key 或 null),見 doPet
    equip: { head: null, chest: null, legs: null, accessory: null }, // 裝備欄:{id,lv,dur} 或 null,見 doEquip/bestArmor
    lv: 1, xp: 0,
    stamina: 100, dashCD: 0, dashT: 0,
    buffs: {},   // 料理 buff:kind -> { mult/value, t 剩餘秒數 }
    talents: {}, talentPts: 0,   // 天賦:id -> 階數;升級發點,見 grantXp/applyTalent
  };
  p.maxhp = playerMaxHp(p);
  p.hp = p.maxhp;
  return p;
}

// 打怪獲得經驗;升級補滿血並跳提示
function grantXp(p, amount) {
  if (!amount || p.lv >= LEVEL_CFG.maxLv) return;
  p.xp += amount;
  while (p.lv < LEVEL_CFG.maxLv && p.xp >= xpToNext(p.lv)) {
    p.xp -= xpToNext(p.lv);
    p.lv++;
    p.talentPts = (p.talentPts || 0) + 1;
    p.maxhp = playerMaxHp(p);
    p.hp = p.maxhp;
    addFloater(p.x, p.y - 0.8, `升級!Lv.${p.lv}`, '#ffd23f');
    addFloater(p.x, p.y - 1.15, '🌟 +1 天賦點(按 T 分配)', '#ffe9a0');
    emitFx({ k: 'sfx', s: 'craft' });
    msgAll(`✨ ${p.name} 升到 Lv.${p.lv}!變強了變強了!`);
    if (p.lv >= LEVEL_CFG.maxLv) unlockAchv('max_level');
  }
}

// 分配天賦點(房主端執行;客戶端透過 { t:'talent' } 請求):加 1 階、扣 1 點
// vital 的血量加成當下就生效並補上等量現血,不用等下次回血才感覺得到
function applyTalent(p, id) {
  const t = TALENTS[id];
  if (!t || (p.talentPts | 0) <= 0) return;
  const r = talRank(p, id);
  if (r >= t.max) return;
  p.talents = p.talents || {};
  p.talents[id] = r + 1;
  p.talentPts--;
  if (id === 'vital') {
    p.maxhp = playerMaxHp(p);
    p.hp = Math.min(p.maxhp, p.hp + t.val);
  }
  addFloater(p.x, p.y - 0.8, `${t.icon} ${t.name} ${r + 1} 階`, '#ffd23f');
  emitFx({ k: 'sfx', s: 'craft' });
  p.invDirty = true;
}

// ===== 圓形 vs 格子碰撞 =====
// forEnemy:敵人/動物視角(光簾閘門對牠們算牆);玩家/掉落物不傳=照舊穿門
function circleHitsSolid(cx, cy, r, forEnemy = false) {
  const x0 = Math.floor(cx - r), x1 = Math.floor(cx + r);
  const y0 = Math.floor(cy - r), y1 = Math.floor(cy + r);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (isSolid(tx, ty, forEnemy)) {
      const nx = clamp(cx, tx, tx + 1), ny = clamp(cy, ty, ty + 1);
      if ((cx - nx) ** 2 + (cy - ny) ** 2 < r * r) return true;
    }
  }
  return false;
}
// 找離圓心最近的實心格「格內最近點」到圓心的方向(單位向量);沒撞到任何格子回 null。
// 跟 circleHitsSolid 同一套「clamp 到格子範圍」技巧,牆角滑動修正用來算切線方向
function cornerPushVec(cx, cy, r, forEnemy) {
  const x0 = Math.floor(cx - r), x1 = Math.floor(cx + r);
  const y0 = Math.floor(cy - r), y1 = Math.floor(cy + r);
  let best = null, bestDsq = Infinity;
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (!isSolid(tx, ty, forEnemy)) continue;
    const nx = clamp(cx, tx, tx + 1), ny = clamp(cy, ty, ty + 1);
    const dsq = (cx - nx) ** 2 + (cy - ny) ** 2;
    if (dsq < bestDsq) { bestDsq = dsq; best = { x: cx - nx, y: cy - ny }; }
  }
  if (!best) return null;
  const len = Math.hypot(best.x, best.y) || 0.0001;
  return { x: best.x / len, y: best.y / len };
}
// X/Y 軸分開移動,撞牆貼齊;回傳是否被擋
// 大位移(如鎚子重擊退)會拆成多個子步逐步檢查,避免一步跳過整格牆體(隧穿)
// r:碰撞半徑,顯式傳入 — 敵人物件本身沒有 .r(半徑存在 ENEMY_TYPES 裡),
// 省略時退回 e.r(玩家物件有 .r);漏傳給敵人會讓 r 變 undefined,
// circleHitsSolid 內比較式對上 NaN 恆為 false,牆壁碰撞直接失效(這正是敵人偶發穿牆的成因)
function moveCircle(e, dx, dy, r, forEnemy = false) {
  const rad = r ?? e.r;
  const step = 0.4; // 遠小於一格牆體厚度
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / step));
  const sx = dx / n, sy = dy / n;
  let blocked = false;
  for (let k = 0; k < n; k++) {
    const xOpen = sx === 0 || !circleHitsSolid(e.x + sx, e.y, rad, forEnemy);
    const yOpen = sy === 0 || !circleHitsSolid(e.x, e.y + sy, rad, forEnemy);
    if (sx !== 0 && xOpen) e.x += sx;
    if (sy !== 0 && yOpen) e.y += sy;
    const xBlocked = sx !== 0 && !xOpen, yBlocked = sy !== 0 && !yOpen;
    if (xBlocked || yBlocked) blocked = true;
    // 牆角卡死修正:斜向移動時兩軸「各自」都被同一顆牆角擋住(單獨測試 X 或 Y 都會撞到同一個
    // 牆角最近點),但沿牆角切線方向其實滑得過去——洞穴地形滿是這種孤立牆角,不修就是"卡在中間走不過去"。
    // 只在「兩軸都被擋」這個特定情況介入,單軸擋牆(絕大多數情況,包含直線走廊/正面撞牆)完全不受影響。
    if (sx !== 0 && sy !== 0 && xBlocked && yBlocked) {
      const push = cornerPushVec(e.x + sx, e.y + sy, rad, forEnemy);
      if (push) {
        let tx = -push.y, ty = push.x; // 切線 = 推出向量轉 90 度
        if (tx * sx + ty * sy < 0) { tx = -tx; ty = -ty; } // 取跟原本移動方向同側的切線
        const tlen = Math.hypot(tx, ty) || 1;
        const mag = Math.hypot(sx, sy);
        const slideX = tx / tlen * mag, slideY = ty / tlen * mag;
        if (!circleHitsSolid(e.x + slideX, e.y + slideY, rad, forEnemy)) {
          e.x += slideX; e.y += slideY;
        }
      }
    }
  }
  return blocked;
}

function nearestAlivePlayer(x, y, maxD) {
  let best = null, bd = maxD;
  for (const p of G.players.values()) {
    if (p.dead) continue;
    const d = dist(x, y, p.x, p.y);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

// 最近的誘光罐(格中心座標);走 decoyIdx 小集合,不掃全 objects
function nearestDecoy(x, y, maxD) {
  let best = null, bd = maxD;
  for (const i of G.decoyIdx) {
    const dx = (i % MAP_W) + 0.5, dy = ((i / MAP_W) | 0) + 0.5;
    const d = dist(x, y, dx, dy);
    if (d < bd) { bd = d; best = { x: dx, y: dy }; }
  }
  return best;
}

// ===== 視覺效果(房主產生後廣播,雙方都套用) =====
function applyFx(f) {
  if (f.k === 'ft') G.floaters.push({ x: f.x, y: f.y, txt: f.txt, color: f.color, t: 0 });
  else if (f.k === 'crack') { if (f.r >= 1) G.cracks.delete(f.i); else G.cracks.set(f.i, f.r); }
  else if (f.k === 'sfx' && SFX[f.s]) SFX[f.s]();
  // 打擊特效:命中衝擊波(elem 決定顏色,crit=屬性剋制大成功放大範圍),render.js 畫、這裡只記錄時間軸
  else if (f.k === 'hit') G.hitFx.push({ x: f.x, y: f.y, elem: f.elem || null, crit: !!f.crit, t: 0, seed: Math.random() * TAU });
  // 快速手勢:頭上的圖示氣泡,錨定在觸發當下的位置(跟其他浮動特效同一套慣例,不追蹤移動)
  else if (f.k === 'emote') G.emoteFx.push({ x: f.x, y: f.y, icon: f.icon, name: f.name, t: 0 });
}
function emitFx(f) {
  applyFx(f);
  if (NET.isHost()) NET.sendAll({ t: 'fx', f });
}
function addFloater(x, y, txt, color) { emitFx({ k: 'ft', x, y, txt, color }); }

// ===== 敵人 =====
// 精英怪(elite:true,通常來自精英巢穴)hp/傷害套 ELITE_CFG 倍率;
// maxhp 獨立存一份給血條/回血邏輯用,不能直接拿 ENEMY_TYPES[type].hp 比,
// 不然精英怪滿血時 e.hp(已放大)會大於 et.hp(基礎值),血條/回血判定全部失準
function spawnEnemy(type, x, y, extra = {}) {
  const base = ENEMY_TYPES[type].hp;
  const elite = !!extra.elite;
  const hp = elite ? Math.round(base * ELITE_CFG.hpMult) : base;
  // 難度傷害倍率疊乘在精英倍率之上(困難模式的精英怪理應更痛),不動 hp——
  // 血量只受精英倍率影響,難度差異體現在「更痛更多」而不是「更肉」
  const diffDmgMult = (DIFFICULTY_CFG[G.difficulty] || DIFFICULTY_CFG.normal).enemyDmgMult;
  const e = { id: nextEid++, type, x, y, hp, maxhp: hp, dmgMult: (elite ? ELITE_CFG.dmgMult : 1) * diffDmgMult,
    vx: 0, vy: 0, hopT: Math.random(), hitT: 0, wave: false, ...extra };
  G.enemies.push(e);
  return e;
}
// 敵人實際輸出傷害(套精英倍率);wall-bash/碰撞/遠程都要走這裡,不要直接讀 et.dmg
function enemyDmg(e, base) { return Math.round(base * (e.dmgMult || 1)); }

function hurtEnemy(e, dmg, src, kbF, atkElem) {
  const et = ENEMY_TYPES[e.type];
  // 屬性相剋:剋制橘字加驚嘆號、被抗性灰字,讓玩家看得懂為什麼痛/不痛
  const mult = elemMult(atkElem, et.elem);
  const final = Math.max(1, Math.round(dmg * mult));
  e.hp -= final;
  const col = mult > 1.3 ? '#ff9d3c' : mult < 1 ? '#8899aa' : '#ffdf6b';
  addFloater(e.x, e.y - 0.5, '-' + final + (mult > 1.3 ? '!' : mult < 1 ? '↓' : ''), col);
  emitFx({ k: 'sfx', s: 'hit' });
  emitFx({ k: 'hit', x: e.x, y: e.y, elem: atkElem || null, crit: mult > 1.3 });
  if (src) {
    const d = Math.max(0.1, dist(src.x, src.y, e.x, e.y));
    let kb = et.boss ? 1.5 : 5;
    if (kbF) kb = et.boss ? kbF * 0.3 : kbF;   // 鎚的大擊退,對 boss 打 3 折
    e.vx += (e.x - src.x) / d * kb; e.vy += (e.y - src.y) / d * kb;
  }
  if (e.hp <= 0) killEnemy(e, src && src.name ? src : null);
}

function randChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
// 一般怪掉裝備:機率與掉哪個檔次的裝備都查 EQUIP_DROP_CFG(config.js),調數值不用碰這裡
function rollEquipDrop(e) {
  const rate = EQUIP_DROP_CFG.rate[e.type];
  if (!rate) return;
  if (Math.random() >= rate * (e.elite ? EQUIP_DROP_CFG.eliteMult : 1)) return;
  const pool = EQUIP_DROP_CFG.pools[EQUIP_DROP_CFG.tier[e.type] || 'weak'];
  spawnDrop(randChoice(pool), 1, e.x, e.y);
}
function killEnemy(e, killer) {
  const i = G.enemies.indexOf(e);
  if (i >= 0) G.enemies.splice(i, 1);
  markSeen(e.type);
  unlockAchv('first_blood');
  G.killCount++;
  emitFx({ k: 'sfx', s: 'break_' });
  if (killer) grantXp(killer, (ENEMY_XP[e.type] || 0) * (e.elite ? ELITE_CFG.xpMult : 1));
  // 精英怪(來自精英巢穴):額外保底掉卷軸+光晶,補償比一般怪更強的戰鬥難度
  if (e.elite) { spawnDrop('enh_scroll', 1, e.x, e.y); spawnDrop('lumite', 3, e.x, e.y); }
  // 戰利品:蝕影掉光晶,回饋防守循環;各怪都有機率掉強化卷軸(衝裝來源)
  const SCROLL_RATE = { imp: 0.03, spore: 0.02, hunter: 0.06, spitter: 0.08, bomber: 0.08, phantom: 0.1, breaker: 0.12, abyss: 0.1, revenant: 0.18, voidling: 0.15 };
  if (SCROLL_RATE[e.type] && Math.random() < SCROLL_RATE[e.type]) spawnDrop('enh_scroll', 1, e.x, e.y);
  rollEquipDrop(e); // 怪物掉裝備:越強的怪 pool 越好,機率在 EQUIP_DROP_CFG 調(config.js)
  if (e.type === 'imp') { if (Math.random() < 0.4) spawnDrop('lumite', 1, e.x, e.y); }
  else if (e.type === 'spore') { if (Math.random() < 0.25) spawnDrop('lumite', 1, e.x, e.y); }
  else if (e.type === 'hunter') spawnDrop('lumite', 1 + (Math.random() < 0.5 ? 1 : 0), e.x, e.y);
  else if (e.type === 'spitter') spawnDrop('lumite', 1, e.x, e.y);
  else if (e.type === 'bomber') { spawnDrop('lumite', 1, e.x, e.y); if (Math.random() < 0.3) spawnDrop('stone', 2, e.x, e.y); }
  else if (e.type === 'phantom') spawnDrop('lumite', 1 + (Math.random() < 0.25 ? 1 : 0), e.x, e.y);
  else if (e.type === 'breaker') { spawnDrop('lumite', 2, e.x, e.y); spawnDrop('iron_ore', 1, e.x, e.y); }
  else if (e.type === 'abyss') {
    spawnDrop('lumite', 2, e.x, e.y);
    if (Math.random() < 0.25) spawnDrop('gold_ore', 1, e.x, e.y);
  }
  else if (e.type === 'revenant') {
    // 淵核區深層怪:通關後內容,獎勵豐厚(光晶+機率鑽石)
    spawnDrop('lumite', 3, e.x, e.y);
    if (Math.random() < 0.35) spawnDrop('diamond', 1, e.x, e.y);
  }
  else if (e.type === 'voidling') {
    spawnDrop('lumite', 2, e.x, e.y);
    if (Math.random() < 0.2) spawnDrop('diamond', 1, e.x, e.y);
  }
  else if (e.type === 'sentinel' && !e.home) {
    // 暗潮最終波的裸體石像守衛(game.js):不是神殿 Boss,維持原掉落,不進神殿死亡流程
    spawnDrop('lumite', 4, e.x, e.y);
    spawnDrop(randChoice(EQUIP_DROP_CFG.bossPool), 1, e.x, e.y); // 最終波 Boss 必掉一件金裝
  }
  else if (e.home) {
    // 神殿 Boss 共用死亡流程:任何有 e.home 的敵人都是某座神殿的守衛,
    // 之後新增冰系/穿牆系 Boss 只要 spawnShrineBosses() 生成時帶 home,這裡完全不用再改
    const et = ENEMY_TYPES[e.type];
    spawnDrop('enh_scroll', 2, e.x, e.y);   // 守衛必掉 2 張卷軸
    spawnDrop(randChoice(EQUIP_DROP_CFG.bossPool), 1, e.x, e.y); // 神殿 Boss 必掉一件金裝
    const owner = killer || nearestAlivePlayer(e.x, e.y, 999) || [...G.players.values()][0];
    const shrine = G.shrines.find(s => s.x === e.home.x && s.y === e.home.y);
    if (shrine) shrine.dead = true;
    if (owner) {
      if (addItem(owner, 'shard', 1) > 0) spawnDrop('shard', 1, e.x, e.y);
      // Q版主題:打敗守望者=把被黑暗纏繞的它「喚醒」,不是殺戮
      msgAll(`⚔️ ${owner.name} 喚醒了${et.name}!它揉揉眼睛,交出了星核碎片——快帶回去!`);
      if (SHRINE_BOSS_QUOTES[e.type]) msgAll(SHRINE_BOSS_QUOTES[e.type]);
      unlockAchv('first_boss');
      if (G.shrines.every(sh => sh.dead)) unlockAchv('all_boss');
    }
    const loot = SHRINE_BOSS_LOOT[e.type] || SHRINE_BOSS_LOOT.sentinel;
    for (const id in loot) spawnDrop(id, loot[id], e.x, e.y);
  }
}

// 星核護盾(超載餵食來的,見 doDeposit)優先吸收任何星核傷害來源,扣完護盾才動到本體能量——
// 唯一的星核扣血入口,暗潮怪直接攻擊/爆裂蝕影炸到星核都走這裡,不用各自複製一份「先扣護盾」的邏輯
function drainCore(amount) {
  G.core.shield = G.core.shield || 0;
  const fromShield = Math.min(G.core.shield, amount);
  G.core.shield -= fromShield;
  const remain = amount - fromShield;
  if (remain > 0) G.core.energy = Math.max(0, G.core.energy - remain);
}

// 爆裂蝕影引信歸零時觸發:範圍內玩家/星核/牆壁一起炸,cfg = { r, dmg, wallDmg, core }
function explodeAt(x, y, cfg) {
  emitFx({ k: 'sfx', s: 'hurt' });
  emitFx({ k: 'ft', x, y: y - 0.3, txt: cfg.slow ? '❄️' : '💥', color: cfg.slow ? '#a8e8ff' : '#ffb35c' });
  for (const p of G.players.values()) {
    if (p.dead) continue;
    if (dist(x, y, p.x, p.y) < cfg.r) {
      damagePlayer(p, cfg.dmg);
      if (cfg.slow) { p.buffs = p.buffs || {}; p.buffs.slow = { mult: cfg.slow.mult, t: cfg.slow.dur }; }
    }
  }
  // 加農塔用:玩家發射的 aoe 彈道要炸到敵人(既有呼叫端都是敵方彈道炸玩家,cfg.hitEnemies 短路不影響原行為)。
  // 倒序迴圈:hurtEnemy 可能觸發 killEnemy 從 G.enemies 中 splice,正序迭代會跳過緊接著的下一隻
  if (cfg.hitEnemies) {
    for (let i = G.enemies.length - 1; i >= 0; i--) {
      const e = G.enemies[i];
      if (dist(x, y, e.x, e.y) < cfg.r) hurtEnemy(e, cfg.dmg, { x, y }, null, cfg.elem || null);
    }
  }
  if (dist(x, y, G.core.x, G.core.y) < cfg.r + 1) {
    drainCore(cfg.core);
    addFloater(G.core.x, G.core.y - 1, `-${Math.round(cfg.core)} ⚡`, '#ff6b6b');
  }
  const x0 = Math.floor(x - cfg.r), x1 = Math.floor(x + cfg.r);
  const y0 = Math.floor(y - cfg.r), y1 = Math.floor(y + cfg.r);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (dist(x, y, tx + 0.5, ty + 0.5) > cfg.r) continue;
    const o = objAt(tx, ty);
    if (o && (OBJ_SOLID[o.type] || o.type === 'gate')) { // 光簾閘門對怪是牆,爆炸也要炸得到(行為一致)
      o.hp -= cfg.wallDmg;
      if (o.hp <= 0) { setObj(tx, ty, null); emitFx({ k: 'sfx', s: 'break_' }); }
      continue;
    }
    const info = TILE_INFO[tileAt(tx, ty)];
    if (info.solid && info.hp !== Infinity) {
      const ii = idx(tx, ty);
      G.dmg[ii] += cfg.wallDmg;
      if (G.dmg[ii] >= info.hp) breakTile(tx, ty, false);
      else emitFx({ k: 'crack', i: ii, r: G.dmg[ii] / info.hp });
    }
  }
}

// 敵人 AI(僅房主執行)
function updateEnemies(dt) {
  const core = G.core;
  for (let i = G.enemies.length - 1; i >= 0; i--) {
    const e = G.enemies[i];
    const et = ENEMY_TYPES[e.type];
    e.hitT -= dt; e.hopT -= dt;
    if (e.slowT > 0) e.slowT -= dt; // 凜鈴塔緩速倒數(暫態欄位,不進存檔;客戶端靠 snap 旗標畫 ❄)

    // 決定目標
    let tx = null, ty = null, chasing = false, targetP = null;
    if (e.home) {
      // 神殿守衛:離家太遠就回防並回血
      const dHome = dist(e.x, e.y, e.home.x, e.home.y);
      const p = nearestAlivePlayer(e.x, e.y, 8);
      if (p && dHome < 10) { tx = p.x; ty = p.y; chasing = true; targetP = p; }
      else if (dHome > 1.5) { tx = e.home.x; ty = e.home.y; chasing = true; }
      else if (e.hp < e.maxhp) e.hp = Math.min(e.maxhp, e.hp + 10 * dt);
    } else if (e.wave) {
      const p = nearestAlivePlayer(e.x, e.y, 4);
      if (p) { tx = p.x; ty = p.y; targetP = p; }
      else {
        // 誘光罐:身邊沒玩家可追時優先搶罐子(蝕影怕光又想搶光)。
        // ghost 必須排除——牠們移動不做碰撞、永遠不會 blocked、啃不到罐子,
        // 不排除會飄到罐子上無限徘徊=永久免費嘲諷的規則漏洞
        const dc = et.ghost ? null : nearestDecoy(e.x, e.y, DECOY_CFG.range);
        if (dc) { tx = dc.x; ty = dc.y; } else { tx = core.x; ty = core.y; }
      }
      chasing = true;
    } else {
      const p = nearestAlivePlayer(e.x, e.y, 7);
      if (p) { tx = p.x; ty = p.y; chasing = true; targetP = p; }
    }

    // 自爆怪:貼近目標就點引信,引信到 0 轟一波(炸人/炸牆/炸星核)
    if (et.explode) {
      const dT = chasing ? dist(e.x, e.y, tx, ty) : 99;
      if (e.fuse === undefined && dT < 1.4) {
        e.fuse = et.explode.fuse;
        emitFx({ k: 'ft', x: e.x, y: e.y - 0.5, txt: '⚠️', color: '#ffb35c' });
      }
      if (e.fuse !== undefined) {
        e.fuse -= dt;
        if (e.fuse <= 0) {
          G.enemies.splice(i, 1);
          const m = e.dmgMult || 1;
          explodeAt(e.x, e.y, { r: et.explode.r, dmg: et.explode.dmg * m, wallDmg: et.explode.wallDmg * m, core: et.explode.core * m });
          continue;
        }
      }
    }

    // 遠程怪:太近會往後跳開,拉到射程內就吐暗影彈(只對玩家)
    if (et.ranged && targetP) {
      e.shootT = (e.shootT ?? Math.random()) - dt;
      const dT = dist(e.x, e.y, tx, ty);
      if (dT < et.ranged.range && e.shootT <= 0) {
        e.shootT = et.ranged.cd;
        const ang = Math.atan2(ty - e.y, tx - e.x);
        spawnProj({
          x: e.x + Math.cos(ang) * 0.4, y: e.y + Math.sin(ang) * 0.4,
          vx: Math.cos(ang) * et.ranged.speed, vy: Math.sin(ang) * et.ranged.speed,
          dmg: enemyDmg(e, et.ranged.dmg), from: 'e', ttl: 1.4, kind: 0,
          aoe: et.ranged.aoe || null,
        });
        emitFx({ k: 'sfx', s: 'shoot' });
      }
    }

    // 跳撲移動(遠程怪保持距離:太近改往反方向跳)
    // 凜鈴塔緩速在「起跳瞬間」取樣(跳程中不即時變慢;hopCD 短,誤差可接受)——
    // ghost 用同一份 vx/vy,所以緩速對穿牆幽影一樣有效(唯一反制穿牆突襲的建築)
    if (e.hopT <= 0) {
      const slowF = e.slowT > 0 ? FROST_TOWER_CFG.mult : 1;
      if (chasing) {
        e.hopT = et.hopCD * 0.75;
        let ang = Math.atan2(ty - e.y, tx - e.x) + (Math.random() - 0.5) * 0.4;
        if (et.ranged && targetP && dist(e.x, e.y, tx, ty) < 2.8) ang += Math.PI;
        e.vx = Math.cos(ang) * et.speed * slowF; e.vy = Math.sin(ang) * et.speed * slowF;
      } else {
        e.hopT = et.hopCD * (1.5 + Math.random());
        const ang = Math.random() * TAU;
        e.vx = Math.cos(ang) * et.speed * 0.5 * slowF; e.vy = Math.sin(ang) * et.speed * 0.5 * slowF;
      }
    }
    const f = Math.exp(-4 * dt);
    e.vx *= f; e.vy *= f;
    let blocked = false;
    if (et.ghost) {
      // 穿牆幽影:無視牆壁直接飄(不會啃牆,靠光塔與屬性剋制防守)
      e.x = clamp(e.x + e.vx * dt, 1, MAP_W - 1);
      e.y = clamp(e.y + e.vy * dt, 1, MAP_H - 1);
    } else {
      blocked = moveCircle(e, e.vx * dt, e.vy * dt, et.r, true); // forEnemy:光簾閘門對怪是牆
    }

    // 地刺陷阱:非 ghost 的怪查自己腳下格(反向判定=零 tick 迴圈、零 idx Set);
    // 每隻怪自己帶 0.8 秒免疫節奏(e.trapT 暫態),刺數直接扣 o.hp,扎完碎裂
    if (!et.ghost) {
      if ((e.trapT ?? 0) > 0) e.trapT -= dt;
      else {
        const gx = Math.floor(e.x), gy = Math.floor(e.y);
        const so = objAt(gx, gy);
        if (so && so.type === 'spike_trap') {
          e.trapT = SPIKE_TRAP_CFG.cd;
          hurtEnemy(e, SPIKE_TRAP_CFG.dmg, { x: gx + 0.5, y: gy + 0.5 }); // src 無 name=不給經驗;有擊退=被彈開
          so.hp = (so.hp ?? OBJ_HP.spike_trap) - 1;
          if (so.hp <= 0) { setObj(gx, gy, null); emitFx({ k: 'sfx', s: 'break_' }); }
          else setObj(gx, gy, so, false); // 廣播剩餘刺數(客戶端畫透明度)
          if (e.hp <= 0) continue; // 被扎死的已從 G.enemies 移除,跳過本幀剩餘邏輯
        }
      }
    }

    // 被牆擋住的追擊怪會啃牆/啃建築(裂地者有拆牆倍率)
    if (chasing && blocked && e.hitT <= 0) {
      const wm = et.wallMult || 1;
      const ang = Math.atan2(ty - e.y, tx - e.x);
      const fx = Math.floor(e.x + Math.cos(ang) * (et.r + 0.6));
      const fy = Math.floor(e.y + Math.sin(ang) * (et.r + 0.6));
      const info = TILE_INFO[tileAt(fx, fy)];
      const o = objAt(fx, fy);
      if (o && (OBJ_SOLID[o.type] || o.type === 'gate')) { // 光簾閘門對怪是牆,被擋住就照啃牆邏輯啃它
        o.hp -= enemyDmg(e, et.dmg) * 0.5 * wm;
        emitFx({ k: 'ft', x: fx + 0.5, y: fy + 0.5, txt: '💥', color: '#ff8888' });
        if (o.hp <= 0) { setObj(fx, fy, null); emitFx({ k: 'sfx', s: 'break_' }); }
        e.hitT = 1.0;
      } else if (info.solid && info.hp !== Infinity) {
        const ii = idx(fx, fy);
        G.dmg[ii] += enemyDmg(e, et.dmg) * 0.8 * wm;
        emitFx({ k: 'crack', i: ii, r: G.dmg[ii] / info.hp });
        if (G.dmg[ii] >= info.hp) breakTile(fx, fy, false);
        e.hitT = 0.8;
      }
    }

    // 碰撞傷害玩家
    for (const p of G.players.values()) {
      if (p.dead || p.iframe > 0) continue;
      if (dist(e.x, e.y, p.x, p.y) < et.r + p.r + 0.05) {
        damagePlayer(p, enemyDmg(e, et.dmg));
        const d = Math.max(0.1, dist(e.x, e.y, p.x, p.y));
        p.kbx = (p.x - e.x) / d * 6; p.kby = (p.y - e.y) / d * 6;
      }
    }

    // 攻擊星核(直接扣能量)
    if (e.wave && e.hitT <= 0 && dist(e.x, e.y, core.x, core.y) < et.r + 1.3) {
      e.hitT = 1.0;
      drainCore(CORE_CFG.hitDrain);
      addFloater(core.x, core.y - 1, `-${CORE_CFG.hitDrain} ⚡`, '#ff6b6b');
      emitFx({ k: 'sfx', s: 'hurt' });
    }
  }
}

// ===== 投射物(玩家遠程武器 / 遠程怪的暗影彈,僅房主端模擬)=====
// from: 'p'=玩家發射(打怪) / 'e'=怪物發射(打玩家)
// pierce=貫穿(不因命中而消失,靠 ttl/出圖結束) elem=屬性(供 elemMult 相剋判定)
function spawnProj(o) {
  const pj = { id: nextPjid++, x: o.x, y: o.y, vx: o.vx, vy: o.vy,
    dmg: o.dmg, from: o.from, ttl: o.ttl ?? 1.4, pierce: !!o.pierce,
    elem: o.elem || null, owner: o.owner || null, hitSet: o.pierce ? new Set() : null,
    aoe: o.aoe || null };   // {r, wallDmg}:命中/飛行結束時觸發範圍爆炸(火球用),其餘彈道維持 null
  G.projs.push(pj);
  return pj;
}

function updateProjs(dt) {
  for (let i = G.projs.length - 1; i >= 0; i--) {
    const pj = G.projs[i];
    pj.ttl -= dt;
    pj.x += pj.vx * dt; pj.y += pj.vy * dt;
    // projHitsWall:水面與矮圍籬(low 地形)擋不住飛行物,箭塔隔著圍籬照樣開火
    let dead = pj.ttl <= 0 || !inMap(Math.floor(pj.x), Math.floor(pj.y)) || projHitsWall(Math.floor(pj.x), Math.floor(pj.y));
    if (!dead) {
      if (pj.from === 'p') {
        for (const e of G.enemies) {
          if (pj.hitSet && pj.hitSet.has(e.id)) continue;
          const et = ENEMY_TYPES[e.type];
          if (dist(pj.x, pj.y, e.x, e.y) < et.r + 0.18) {
            if (!pj.aoe) hurtEnemy(e, pj.dmg, pj.owner, null, pj.elem); // 加農塔的 aoe 彈道改由爆炸統一處理,避免直擊+爆炸疊加兩次傷害
            if (pj.pierce) pj.hitSet.add(e.id); else { dead = true; }
            if (!pj.pierce) break;
          }
        }
      } else if (pj.from === 'e') {
        for (const p of G.players.values()) {
          if (p.dead || p.iframe > 0) continue;
          if (dist(pj.x, pj.y, p.x, p.y) < p.r + 0.18) {
            if (!pj.aoe) damagePlayer(p, pj.dmg); // 無 aoe 的一般暗影彈:維持原本直接命中扣血
            dead = true;
            break;
          }
        }
      }
    }
    // 帶 aoe 的彈道(敵方火球 / 玩家加農砲彈):不論是命中死、還是撞牆/出圖自然死,
    // 落地那一刻都炸一次範圍傷害(直擊改由爆炸傷害統一處理,避免命中+爆炸疊加兩次傷害)
    if (dead && pj.aoe) {
      if (pj.from === 'e') explodeAt(pj.x, pj.y, { r: pj.aoe.r, dmg: pj.dmg, wallDmg: pj.aoe.wallDmg, core: 0, slow: pj.aoe.slow || null });
      else explodeAt(pj.x, pj.y, { r: pj.aoe.r, dmg: pj.dmg, wallDmg: pj.aoe.wallDmg || 0, core: 0, hitEnemies: true, elem: pj.elem || null });
    }
    if (dead) G.projs.splice(i, 1);
  }
}

// 徹底陣亡(倒下讀秒歸零 / 已倒下時又挨一下「補刀」/ 沒有隊友可救)——
// 統一入口,原本 damagePlayer 裡的死亡處理原封不動搬進來,updatePlayersHost 的倒下逾時分支也共用
function enterDead(p) {
  p.hp = 0; p.dead = true; p.respawnT = 5;
  p.downed = false; p.downedT = 0; p.reviveP = 0;
  p.buffs = {}; p.fish = null; p.recall = null; // 死亡清空料理 buff、釣魚與回城引導狀態
  msgAll(`💧 ${p.name} 熄火了……5 秒後在星核重新點燃!`);
}

// 飾品欄(敏捷護符)的完全閃避判定,獨立於護甲/buff 的減傷計算之外(0 傷害而不是打折)
function rollDodge(p) {
  const eq = p.equip && p.equip.accessory;
  const it = eq && ITEMS[eq.id];
  return !!(it && it.dodgeChance && Math.random() < it.dodgeChance);
}
// 飾品欄(獵殺勳章)的暴擊判定,回傳傷害倍率(沒觸發=1)
function rollCrit(p) {
  const eq = p.equip && p.equip.accessory;
  const it = eq && ITEMS[eq.id];
  return (it && it.critChance && Math.random() < it.critChance) ? it.critMult : 1;
}

function damagePlayer(p, amount) {
  if (p.godmode) return; // /power godmode:秘笈開啟的無敵狀態
  if (rollDodge(p)) { addFloater(p.x, p.y - 0.6, '💨 閃避!', '#a0e8ff'); return; }
  // 岩鎧 buff 與護甲相乘(不是相加),兩者都拉滿也不會變成免疫
  const dmg = Math.max(1, Math.round(amount * (1 - bestArmor(p)) * (1 - buffVal(p, 'guard')) * (1 - petVal(p, 'guard'))));
  p.hp -= dmg; p.iframe = 0.8; p.lastHurt = G.time;
  // 歸巢螢石:受到任何傷害立即中斷引導(不消耗)——堵死「戰鬥中免死脫逃」,張力來源
  if (p.recall) { p.recall = null; addFloater(p.x, p.y - 0.9, '🌀 引導被打斷!', '#ff9d5c'); }
  addFloater(p.x, p.y - 0.6, '-' + dmg, '#ff6b6b');
  emitFx({ k: 'sfx', s: 'hurt' });
  if (p.hp <= 0) {
    // 已經倒下的人再挨一下 = 補刀,直接徹底陣亡(不是無腦送頭的風險來源)
    if (p.downed) { enterDead(p); return; }
    // 有其他存活且非倒下的隊友在場,才進入「倒下待救」;單機/隊友全滅時沒人救得了,直接陣亡
    const rescuable = [...G.players.values()].some(q => q.id !== p.id && !q.dead && !q.downed);
    if (rescuable) {
      p.hp = 1; p.downed = true; p.downedT = REVIVE_CFG.downedDur; p.reviveP = 0;
      p.buffs = {}; p.fish = null; p.recall = null;
      msgAll(`🆘 ${p.name} 倒下了!快靠近站著救他(要 ${REVIVE_CFG.reviveTime} 秒,再被打一下就沒救了)!`);
    } else {
      enterDead(p);
    }
  }
}

// 隱藏除錯指令 /give_all:切換「資源無限」狀態(payCost/removeOne/consumeSlot 見 inventory.js 旁路),
// 開啟當下順便把常用基礎材料補到 99,讓效果立刻看得見。
// 只影響下指令的這個玩家物件本身,且回饋只送給觸發者(見呼叫端用 sendToPid/本地 showMsg,
// 不走 addFloater/emitFx,避免其他玩家在畫面上看到任何提示或聊天紀錄)
function toggleInfinite(p) {
  p.infinite = !p.infinite;
  if (p.infinite) {
    for (const id of ['wood', 'stone', 'copper_ore', 'iron_ore', 'gold_ore', 'lumite',
      'copper_bar', 'iron_bar', 'gold_bar', 'arrow', 'enh_scroll']) {
      addItem(p, id, 99 - countItem(p, id));
    }
  }
  p.invDirty = true;
  return p.infinite;
}

// ===== /power 秘笈選單:統一入口,一律在房主端執行 =====
// UI(自己是房主時直接呼叫)與 net.js 收到客戶端 { t:'power' } 請求時都呼叫這裡,
// 確保「滑鼠點選單」跟「手打指令」兩條路徑效果完全一致、不用各寫一份。
// 效果只回饋給下指令的玩家自己(呼叫端用 sendToPid/本地 showMsg),不廣播給其他人;
// 但世界共用狀態(星核/暗潮/怪物)本來就會透過快照自然讓所有人看到,這是預期中的。
function cheatHeal(p) {
  p.hp = p.maxhp;
  addFloater(p.x, p.y - 0.6, '❤ 已補滿', '#7dffb2'); // candy-mint:回復類回饋統一薄荷綠
}
function cheatGodmode(p) {
  p.godmode = !p.godmode;
  return p.godmode;
}
function cheatTeleportHome(p) {
  p.x = G.core.x + (Math.random() - 0.5) * 2;
  p.y = G.core.y + 1.5;
  if (p.id !== G.myId && NET.isHost()) NET.sendToPid(p.id, { t: 'tp', x: p.x, y: p.y });
}
function cheatCoreFull() { G.core.energy = CORE_CFG.maxE; }
function cheatShard(p) { addItem(p, 'shard', 1); }
function cheatWaveNow() {
  const w = G.wave;
  if (w.state === 'calm') { w.state = 'warn'; w.timer = 3; return true; }
  if (w.state === 'warn') { w.timer = 0.05; return true; }
  return false; // 暗潮已在進行中,不重複觸發
}
function cheatWaveClear() {
  const before = G.enemies.length;
  G.enemies = G.enemies.filter(e => !e.wave);
  return before - G.enemies.length;
}
function cheatClearMobs() {
  const before = G.enemies.length;
  G.enemies = G.enemies.filter(e => e.home); // 神殿守衛保留,其餘全清
  return before - G.enemies.length;
}
// 在玩家周圍找一格空地板召喚怪物,避免直接卡進牆裡
function findSpawnSpot(p) {
  for (let tries = 0; tries < 30; tries++) {
    const ang = Math.random() * TAU, d = 2 + Math.random() * 3;
    const x = Math.floor(p.x + Math.cos(ang) * d), y = Math.floor(p.y + Math.sin(ang) * d);
    if (inMap(x, y) && tileAt(x, y) === T.FLOOR) return { x: x + 0.5, y: y + 0.5 };
  }
  return { x: p.x, y: p.y };
}
function cheatSpawn(p, type, count) {
  const n = clamp(count | 0 || 1, 1, 10);
  for (let i = 0; i < n; i++) {
    const pos = findSpawnSpot(p);
    spawnEnemy(type, pos.x, pos.y);
  }
  return n;
}

function runPowerCmd(p, action, arg, num) {
  switch (action) {
    case 'heal': cheatHeal(p); return '❤ 已補滿血量';
    case 'godmode': return cheatGodmode(p) ? '🛡️ 無敵模式已開啟' : '🛡️ 無敵模式已關閉';
    case 'infinite': return toggleInfinite(p) ? '♾️ 資源無限已開啟' : '資源無限已關閉';
    case 'home': cheatTeleportHome(p); return '🏠 已傳送回星核';
    case 'xp': { const n = clamp(num || 500, 1, 99999); grantXp(p, n); return `⭐ 獲得 ${n} 經驗值`; }
    case 'corefull': cheatCoreFull(); return '💠 星核能量已灌滿';
    case 'shard': cheatShard(p); return '🔷 獲得 1 顆星核碎片(靠近星核會自動放入)';
    case 'wavenow': return cheatWaveNow() ? '🌊 已強制觸發暗潮' : '⚠️ 暗潮已在進行中';
    case 'waveclear': return `☀️ 已清除 ${cheatWaveClear()} 隻暗潮怪物`;
    case 'clearmobs': return `🧹 已清除 ${cheatClearMobs()} 隻怪物(神殿守衛除外)`;
    case 'spawn': {
      if (!ENEMY_TYPES[arg]) return `⚠️ 找不到怪物「${arg}」`;
      return `👹 召喚了 ${cheatSpawn(p, arg, num)} 隻${ENEMY_TYPES[arg].name}`;
    }
    case 'animal': {
      if (!ANIMAL_TYPES[arg]) return `⚠️ 找不到動物「${arg}」`;
      const n = clamp(num | 0 || 1, 1, 10);
      for (let i = 0; i < n; i++) { const pos = findSpawnSpot(p); spawnAnimal(arg, pos.x, pos.y); }
      return `🐄 召喚了 ${n} 隻${ANIMAL_TYPES[arg].name}`;
    }
    case 'talentpt': {
      const n = clamp(num | 0 || 1, 1, 99);
      p.talentPts = (p.talentPts || 0) + n;
      p.invDirty = true;
      return `🌟 +${n} 天賦點(按 T 分配)`;
    }
    default: return `⚠️ 未知指令 /power ${action}`;
  }
}

// ===== 耐久度:磨損與修理(房主端) =====
// 只在「成功命中/成功挖掘」時扣;歸零鎖 0 = 損壞停用(自動選具會跳過),永不消失。
// /power infinite 開著不磨損(跟免扣材料同一個除錯精神)
function wearItem(p, s, n = 1) {
  if (!s || p.infinite) return;
  const it = ITEMS[s.id];
  if (!it || !it.dur || s.dur === 0) return;
  const max = maxDur(s);
  s.dur = (s.dur ?? max) - n;
  if (s.dur <= 0) {
    s.dur = 0;
    addFloater(p.x, p.y - 0.8, `💥 ${it.name}損壞了!背包右鍵它修理`, '#ff9d5c');
    emitFx({ k: 'sfx', s: 'break_' });
  }
  p.invDirty = true;
}

// 修理:靠近工作台,花該裝備合成成本的一半(repairCostOf),耐久回滿
function doRepair(p, slot) {
  if (p.dead || p.downed) return { err: '你已倒下' };
  if (!stationNear(p, 'workbench')) return { err: '需要靠近工作台' };
  const s = p.inv[slot];
  const it = s && ITEMS[s.id];
  if (!s || !it.dur) return { err: '這個物品不需要修理' };
  const max = maxDur(s);
  if ((s.dur ?? max) >= max) return { err: '耐久已滿' };
  const cost = repairCostOf(s.id);
  if (!canAfford(p, cost))
    return { err: '修理材料不足:需要 ' + Object.entries(cost).map(([k, n]) => `${ITEMS[k].name}×${n}`).join('、') };
  payCost(p, cost);
  s.dur = max;
  p.invDirty = true;
  addFloater(p.x, p.y - 0.6, `🔧 ${it.name}修好了`, '#7dff8e');
  emitFx({ k: 'sfx', s: 'craft' });
  return { ok: true };
}

// ===== 玩家動作(房主端執行;客戶端透過網路請求) =====
function doSwing(p, aim) {
  if (p.dead || p.downed || p.atkCD > 0) return;
  const w = meleeWeaponOf(p);
  p.atkCD = w.cd ?? 0.35; p.swing = w.manual ? 0.22 : 0.22; p.aim = aim; p.action = 'atk';
  const dmg = w.dmg * playerDmgMult(p) * rollCrit(p);
  let hits = 0;
  for (const e of [...G.enemies]) {
    const d = dist(p.x, p.y, e.x, e.y);
    if (d < w.range + ENEMY_TYPES[e.type].r && angDiff(Math.atan2(e.y - p.y, e.x - p.x), aim) < w.arc) {
      hurtEnemy(e, dmg, p, w.kb, w.elem);
      hits++;
    }
  }
  // 宰殺牲畜:只有近戰打得到(箭/塔刻意打不到,避免流彈把牧場屠了)
  for (const a of [...G.animals]) {
    const d = dist(p.x, p.y, a.x, a.y);
    if (d < w.range + ANIMAL_TYPES[a.type].r && angDiff(Math.atan2(a.y - p.y, a.x - p.x), aim) < w.arc) {
      hurtAnimal(a, dmg, p);
      hits++;
    }
  }
  if (hits > 0 && w.slot) wearItem(p, w.slot); // 揮空不磨損,命中才扣(一次揮擊只扣 1 不論打到幾隻)
}

// 遠程武器發射(選中弓/弩/法杖時觸發);消耗對應彈藥,沒彈藥就不發射
function doShoot(p, aim) {
  if (p.dead || p.downed || p.atkCD > 0) return;
  const s = p.inv[p.sel];
  const w = s && ITEMS[s.id].ranged;
  if (!w) return;
  if (isBroken(s)) {
    addFloater(p.x, p.y - 0.6, `${ITEMS[s.id].name}已損壞,先修理`, '#ff9d5c');
    p.atkCD = 0.4;
    return;
  }
  if (!removeOne(p, w.ammo)) {
    addFloater(p.x, p.y - 0.6, `沒有${ITEMS[w.ammo].name}了`, '#8899aa');
    return;
  }
  wearItem(p, s);
  p.atkCD = w.cd; p.swing = 0.18; p.aim = aim; p.action = 'atk';
  const dmg = w.dmg * enhMult(s) * playerDmgMult(p) * rollCrit(p);
  spawnProj({
    x: p.x + Math.cos(aim) * 0.4, y: p.y + Math.sin(aim) * 0.4,
    vx: Math.cos(aim) * w.speed, vy: Math.sin(aim) * w.speed,
    dmg, from: 'p', owner: p, ttl: 1.6, pierce: !!w.pierce, elem: w.elem || null,
  });
  emitFx({ k: 'sfx', s: 'shoot' });
}

function breakTile(x, y, withDrop = true) {
  const info = infoAt(x, y);
  if (!info.solid || info.hp === Infinity) return;
  if (withDrop && info.drop) {
    spawnDrop(info.drop.id, info.drop.n, x + 0.5, y + 0.5);
    if (info.drop.id === 'diamond') unlockAchv('first_diamond');
  }
  setTile(x, y, T.FLOOR);
  emitFx({ k: 'sfx', s: 'break_' });
}

function doMine(p, x, y) {
  if (p.dead || p.downed || p.mineCD > 0 || !inMap(x, y)) return;
  if (dist(p.x, p.y, x + 0.5, y + 0.5) > 3.6) return;
  p.mineCD = 0.26;
  p.aim = Math.atan2(y + 0.5 - p.y, x + 0.5 - p.x);
  p.swing = 0.2; p.action = 'mine';
  const i = idx(x, y);
  const o = G.objects.get(i);
  const info = TILE_INFO[G.tiles[i]];
  if (o && o.type !== 'mushroom' && o.type !== 'crop' && !info.solid) {
    // 敲回收已放置物件
    const pk = bestPick(p);
    o.hp = (o.hp ?? OBJ_HP[o.type]) - pk.power * 4 * buffMult(p, 'mine');
    wearItem(p, pk.slot);
    emitFx({ k: 'sfx', s: 'mine' });
    if (o.hp <= 0) {
      // 寶箱/巢穴不是可攜帶物品,拆掉直接開獎勵,不走「物件變回背包道具」那條路
      if (o.type === 'chest') openChest(p, x, y);
      else if (o.type === 'nest') breakNest(x, y, o);
      else if (o.type === 'storage') { spillStorage(x, y, o); spawnDrop('storage', 1, x + 0.5, y + 0.5); } // 內容全掉出來再掉回箱子
      else if (o.type === 'auto_smelter') { spillSmelter(x, y, o); spawnDrop('auto_smelter', 1, x + 0.5, y + 0.5); } // 緩衝礦石+剩煤掉出來再掉回爐子
      else spawnDrop(o.type, 1, x + 0.5, y + 0.5);
      setObj(x, y, null);
      emitFx({ k: 'sfx', s: 'break_' });
    }
    return;
  }
  // 軌道:非固體地形一般敲不掉(下面 !info.solid 就 return),靠 rail 旗標開一條回收路徑。
  // 定位是玩家自己鋪的通道,一敲即回收(不做耐久),踩掉重鋪很順手
  if (info.rail) {
    if (info.drop) spawnDrop(info.drop.id, info.drop.n, x + 0.5, y + 0.5);
    setTile(x, y, T.FLOOR);
    emitFx({ k: 'sfx', s: 'break_' });
    return;
  }
  if (!info.solid || info.hp === Infinity) return;
  const pick = bestPick(p);
  if (pick.tier < info.tier) {
    addFloater(x + 0.5, y + 0.5, '太硬了!需要更好的鎬', '#ff9d5c');
    p.mineCD = 0.5;
    return;
  }
  // 挖掘力加成:料理礦勁 buff × 礦脈直覺天賦
  G.dmg[i] += pick.power * buffMult(p, 'mine') * (1 + TALENTS.miner.val * talRank(p, 'miner')) * (1 + petVal(p, 'mine'));
  wearItem(p, pick.slot); // 有效敲擊才磨損(tier 不夠的「太硬了」在上面就 return 了)
  emitFx({ k: 'sfx', s: 'mine' });
  if (G.dmg[i] >= info.hp) breakTile(x, y);
  else emitFx({ k: 'crack', i, r: G.dmg[i] / info.hp });
}

// 衝裝(強化卷軸):消耗卷軸嘗試把裝備 +1 級,靠近工作台才能用;失敗只噴卷軸不降級
// 回傳 { ok, lv, fail } 供呼叫端顯示結果;err 字串表示無法執行(不消耗卷軸)
function doEnh(p, slot) {
  if (p.dead || p.downed) return { err: '你已倒下' };
  if (!stationNear(p, 'workbench')) return { err: '需要靠近工作台' };
  const s = p.inv[slot];
  if (!s || !isEnhancable(s.id)) return { err: '這個物品無法強化' };
  const lv = s.lv || 0;
  if (lv >= ENH_CFG.maxLv) return { err: '已達最高強化等級' };
  const need = ENH_CFG.scrolls(lv);
  if (countItem(p, 'enh_scroll') < need) return { err: `需要 ${need} 張強化卷軸` };
  payCost(p, { enh_scroll: need });
  const rate = ENH_CFG.rate[lv];
  if (Math.random() < rate) {
    s.lv = lv + 1;
    p.invDirty = true;
    addFloater(p.x, p.y - 0.6, `✨ 強化成功 +${s.lv}`, '#ffd23f');
    emitFx({ k: 'sfx', s: 'craft' });
    return { ok: true, lv: s.lv };
  } else {
    addFloater(p.x, p.y - 0.6, '強化失敗(裝備無損)', '#ff9d5c');
    emitFx({ k: 'sfx', s: 'hit' });
    return { ok: false, fail: true, lv };
  }
}

// NPC 商人交易:offerIdx 對應 traderOffers() 目前展開後的索引
function doTrade(p, offerIdx) {
  if (p.dead || p.downed) return { err: '你已倒下' };
  const trader = G.traders[0];
  if (!trader || dist(p.x, p.y, trader.x, trader.y) > 3.8) return { err: '離商人太遠了' };
  const offer = traderOffers()[offerIdx];
  if (!offer) return { err: '交易項目不存在' };
  if (!canAfford(p, offer.give)) return { err: '材料不足' };
  payCost(p, offer.give);
  for (const id in offer.get) {
    const left = addItem(p, id, offer.get[id]);
    if (left > 0) spawnDrop(id, left, p.x, p.y);
  }
  emitFx({ k: 'sfx', s: 'craft' });
  return null;
}

// ===== 成就 / 圖鑑(全隊共享,房主權威)=====
// 達成時房主寫入 G.achv 並廣播 {t:'achv'} 讓客戶端同步狀態(msgAll 已經負責廣播文字了,
// 這裡只補「這個 id 已解鎖」這個旗標,面板才畫得出勾選狀態)。冪等:重複呼叫直接 return。
function unlockAchv(id) {
  if (G.achv[id]) return;
  G.achv[id] = true;
  const a = ACHIEVEMENTS[id];
  if (a) { msgAll(`🏆 成就達成:${a.icon} ${a.name}——${a.desc}`); emitFx({ k: 'sfx', s: 'craft' }); }
  if (NET.isHost()) NET.sendAll({ t: 'achv', id });
}
// 圖鑑:擊殺過的怪物種類,靜默記錄(不跳訊息,面板裡慢慢收集就好,不用每隻小蝕影都跳一次)
function markSeen(type) {
  if (G.bestiary[type]) return;
  G.bestiary[type] = true;
  if (NET.isHost()) NET.sendAll({ t: 'seen', type });
}

// 快速手勢:倒下也能用(呼叫隊友救援正是它的用途之一),陣亡才擋——房主權威 + 冷卻防洗頻
function doEmote(p, idx) {
  if (p.dead || p.emoteCD > 0) return;
  const e = EMOTE_LIST[idx];
  if (!e) return;
  p.emoteCD = EMOTE_CFG.cd;
  emitFx({ k: 'emote', x: p.x, y: p.y, icon: e.icon, name: p.name });
}

// 寵物召喚物右鍵切換出戰/收回:同時只能出戰一隻,召喚新的自動收回舊的(不用先手動收回)。
// 純粹改 p.pet 這個欄位,不消耗物品(身上帶著就能反覆召喚)。這裡只擋 p.dead——
// p.downed 不用另外擋,main.js 的右鍵輸入本來就在 localControl 開頭被 me.downed 整個攔住了
function doPet(p, slot) {
  if (p.dead) return;
  const s = p.inv[slot];
  const it = s && ITEMS[s.id];
  if (!it || !it.pet) return;
  p.pet = p.pet === it.pet ? null : it.pet;
  if (p.pet) {
    addFloater(p.x, p.y - 0.8, `${PET_TYPES[p.pet].icon} ${PET_TYPES[p.pet].name} 出戰!`, '#7dff8e');
    emitFx({ k: 'sfx', s: 'place' });
    unlockAchv('first_pet');
  } else {
    addFloater(p.x, p.y - 0.8, '寵物收回了', '#8899aa');
  }
}

// 裝備欄位(頭盔/胸甲/護腿):右鍵背包裡的裝備自動穿上對應欄位,原本穿著的那件退回背包(背包滿了就掉在腳邊)
function doEquip(p, slot) {
  if (p.dead) return;
  const s = p.inv[slot];
  const it = s && ITEMS[s.id];
  if (!it || !it.equipSlot) return;
  const part = it.equipSlot;
  const old = p.equip[part];
  p.equip[part] = { id: s.id, lv: s.lv || 0, dur: s.dur };
  p.inv[slot] = null;
  if (old) {
    if (addEnhancedItem(p, old.id, old.lv, old.dur)) spawnDrop(old.id, 1, p.x, p.y, old.lv, old.dur);
  }
  p.invDirty = true;
  addFloater(p.x, p.y - 0.8, `已裝備 ${it.name}`, '#7dff8e');
  emitFx({ k: 'sfx', s: 'craft' });
  unlockAchv('first_equip');
}
function doUnequip(p, part) {
  if (p.dead || !p.equip || !p.equip[part]) return;
  const eq = p.equip[part];
  p.equip[part] = null;
  if (addEnhancedItem(p, eq.id, eq.lv, eq.dur)) spawnDrop(eq.id, 1, p.x, p.y, eq.lv, eq.dur);
  p.invDirty = true;
}

// 玩家間贈送:對著隊友右鍵,把選中格整疊道具送過去。帶強化等級/耐久的裝備類走 addEnhancedItem 保留狀態,
// 一般道具照堆疊規則送(對方背包沒滿位置就先給多少,沒送出去的留在自己背包,不會憑空消失)
function doGift(p, slot, targetId) {
  if (p.dead || p.downed) return;
  const target = G.players.get(targetId);
  if (!target || target.id === p.id || target.dead) return;
  if (dist(p.x, p.y, target.x, target.y) > 3.8) return;
  const s = p.inv[slot];
  if (!s) return;
  const it = ITEMS[s.id];
  const hasEnh = s.lv || (s.dur !== undefined && s.dur !== null);
  let given;
  if (hasEnh) {
    given = addEnhancedItem(target, s.id, s.lv, s.dur) === 0 ? 1 : 0;
    if (given) p.inv[slot] = null;
  } else {
    const rest = addItem(target, s.id, s.count);
    given = s.count - rest;
    if (given > 0) { s.count -= given; if (s.count <= 0) p.inv[slot] = null; }
  }
  if (!given) { addFloater(target.x, target.y - 0.8, '對方背包滿了', '#ff9d5c'); return; }
  p.invDirty = true;
  addFloater(target.x, target.y - 0.8, `${p.name} 送來 ${it.icon}${it.name}`, '#7dff8e');
  emitFx({ k: 'sfx', s: 'craft' });
  unlockAchv('first_gift');
}
// 舊存檔沒有 equip 欄位:掃背包找最好的胸甲類裝備自動穿上,保留原本的防禦力(見 CLAUDE.md 裝備欄位一節)
function migrateLegacyArmor(p) {
  if (p.equip) return;
  p.equip = { head: null, chest: null, legs: null, accessory: null };
  let bestI = -1, bestV = 0;
  for (let i = 0; i < p.inv.length; i++) {
    const s = p.inv[i];
    const it = s && ITEMS[s.id];
    if (it && it.equipSlot === 'chest' && it.armor > bestV) { bestV = it.armor; bestI = i; }
  }
  if (bestI >= 0) {
    const s = p.inv[bestI];
    p.equip.chest = { id: s.id, lv: s.lv || 0, dur: s.dur };
    p.inv[bestI] = null;
  }
}

function doPlace(p, slot, x, y) {
  if (p.dead || p.downed || !inMap(x, y)) return;
  const s = p.inv[slot];
  if (!s) return;
  const it = ITEMS[s.id];
  if (!it.place && it.placeTile === undefined) return;
  if (dist(p.x, p.y, x + 0.5, y + 0.5) > 3.8) return;
  if (tileAt(x, y) !== T.FLOOR || G.objects.has(idx(x, y))) return;
  // 箭塔太強會讓怪完全打不進來,靠彈藥上限自然限流之外,再限制每人可蓋數量避免堆成彈幕牆
  if (it.place === 'archer_tower') {
    let owned = 0;
    for (const [, o] of G.objects) if (o.type === 'archer_tower' && o.owner === p.id) owned++;
    if (owned >= ARCHER_TOWER_CFG.maxPerPlayer) {
      addFloater(x + 0.5, y + 0.5, `每人最多 ${ARCHER_TOWER_CFG.maxPerPlayer} 座箭塔`, '#ff9d5c');
      return;
    }
  }
  // 自動採礦機:設計張力折衷之一——只能架在已探索的格子(玩家得先冒險把地圖點亮才能佈署),
  // 且每人數量上限避免整片礦區被機器佔滿失去探索意義
  if (it.place === 'auto_miner') {
    if (!G.explored[idx(x, y)]) {
      addFloater(x + 0.5, y + 0.5, '只能架在探索過的區域', '#ff9d5c');
      return;
    }
    let owned = 0;
    for (const [, o] of G.objects) if (o.type === 'auto_miner' && o.owner === p.id) owned++;
    if (owned >= AUTO_MINER_CFG.maxPerPlayer) {
      addFloater(x + 0.5, y + 0.5, `每人最多 ${AUTO_MINER_CFG.maxPerPlayer} 台採礦機`, '#ff9d5c');
      return;
    }
  }
  // 自動熔煉爐:跟礦機同標準的每人上限(不需要已探索限制——它不產資源,只加工)
  if (it.place === 'auto_smelter') {
    let owned = 0;
    for (const [, o] of G.objects) if (o.type === 'auto_smelter' && o.owner === p.id) owned++;
    if (owned >= AUTO_SMELTER_CFG.maxPerPlayer) {
      addFloater(x + 0.5, y + 0.5, `每人最多 ${AUTO_SMELTER_CFG.maxPerPlayer} 台熔煉爐`, '#ff9d5c');
      return;
    }
  }
  // 凜鈴塔:控場太強會讓防線變鐵桶,比照箭塔限制每人數量
  if (it.place === 'frost_tower') {
    let owned = 0;
    for (const [, o] of G.objects) if (o.type === 'frost_tower' && o.owner === p.id) owned++;
    if (owned >= FROST_TOWER_CFG.maxPerPlayer) {
      addFloater(x + 0.5, y + 0.5, `每人最多 ${FROST_TOWER_CFG.maxPerPlayer} 座凜鈴塔`, '#ff9d5c');
      return;
    }
  }
  // 誘光罐:上限避免「誘餌陣」把暗潮永遠擋在外圍掛機
  if (it.place === 'decoy') {
    let owned = 0;
    for (const [, o] of G.objects) if (o.type === 'decoy' && o.owner === p.id) owned++;
    if (owned >= DECOY_CFG.maxPerPlayer) {
      addFloater(x + 0.5, y + 0.5, `每人最多 ${DECOY_CFG.maxPerPlayer} 個誘光罐`, '#ff9d5c');
      return;
    }
  }
  // 塔類第二批(加農塔/連弩塔/重砲塔):比照凜鈴塔同標準的每人上限
  if (it.place === 'cannon_tower' || it.place === 'multi_tower' || it.place === 'sniper_tower') {
    const cfg = it.place === 'cannon_tower' ? CANNON_TOWER_CFG : it.place === 'multi_tower' ? MULTI_TOWER_CFG : SNIPER_TOWER_CFG;
    let owned = 0;
    for (const [, o] of G.objects) if (o.type === it.place && o.owner === p.id) owned++;
    if (owned >= cfg.maxPerPlayer) {
      addFloater(x + 0.5, y + 0.5, `每人最多 ${cfg.maxPerPlayer} 座${it.name}`, '#ff9d5c');
      return;
    }
  }
  // 會擋路的東西不能蓋在任何人/怪身上;非固體地形(如軌道)可站上去,不受這個限制
  // (否則玩家站原地就沒法在自己腳下鋪軌道),所以查地形的 solid 屬性而不是「只要用 placeTile 就當擋路」。
  // 光簾閘門雖不在 OBJ_SOLID(玩家可穿),但對怪是牆,不能蓋在怪身上瞬間關禁閉
  const solidPlace = (it.placeTile !== undefined && TILE_INFO[it.placeTile].solid) || OBJ_SOLID[it.place] || it.place === 'gate';
  if (solidPlace) {
    for (const pl of G.players.values())
      if (!pl.dead && Math.abs(pl.x - x - 0.5) < 0.5 + pl.r && Math.abs(pl.y - y - 0.5) < 0.5 + pl.r) return;
    for (const e of G.enemies)
      if (Math.abs(e.x - x - 0.5) < 0.5 + ENEMY_TYPES[e.type].r && Math.abs(e.y - y - 0.5) < 0.5 + ENEMY_TYPES[e.type].r) return;
  }
  consumeSlot(p, slot);
  if (it.placeTile !== undefined) setTile(x, y, it.placeTile);
  else {
    const o = { type: it.place, hp: OBJ_HP[it.place] };
    if (it.place === 'archer_tower') { o.owner = p.id; o.ammo = 0; }
    if (it.place === 'auto_miner') { o.owner = p.id; o.fuel = 0; unlockAchv('auto_pioneer'); } // 空燃料放置,靠玩家右鍵光晶供電
    if (it.place === 'auto_smelter') { o.owner = p.id; o.fuel = 0; o.items = []; } // 空爐放置,煤/礦石靠右鍵或傳輸帶餵
    // 傳輸帶方向依玩家「放置時面向」決定(0=右 1=下 2=左 3=上),之後可右鍵空手旋轉
    if (it.place === 'belt') { o.owner = p.id; o.dir = dirFromAngle(p.aim); }
    if (it.place === 'frost_tower' || it.place === 'decoy') o.owner = p.id; // maxPerPlayer 計數用
    if (it.place === 'cannon_tower' || it.place === 'multi_tower' || it.place === 'sniper_tower') o.owner = p.id; // maxPerPlayer 計數用
    setObj(x, y, o);
  }
  emitFx({ k: 'sfx', s: 'place' });
}

// 把瞄準角度(弧度)量化成 4 向:0=右 1=下 2=左 3=上(y 軸向下,跟世界座標一致)
function dirFromAngle(ang) {
  return ((Math.round(ang / (Math.PI / 2)) % 4) + 4) % 4;
}

// 農耕:鏟子翻土(不消耗、不扣格數,單純是把地板變農地),右鍵觸發
function doTill(p, x, y) {
  if (p.dead || p.downed || !inMap(x, y)) return;
  if (dist(p.x, p.y, x + 0.5, y + 0.5) > 3.8) return;
  if (tileAt(x, y) !== T.FLOOR || G.objects.has(idx(x, y))) return;
  setTile(x, y, T.FARMLAND);
  emitFx({ k: 'sfx', s: 'place' });
}

// 農耕:在翻好的農地上種下種子(消耗 1 顆),長熟後見 updateCrops + updatePlayersHost 的自動收成
function doPlant(p, slot, x, y) {
  if (p.dead || p.downed || !inMap(x, y)) return;
  const s = p.inv[slot];
  if (!s || !ITEMS[s.id].seed) return;
  if (dist(p.x, p.y, x + 0.5, y + 0.5) > 3.8) return;
  if (tileAt(x, y) !== T.FARMLAND || G.objects.has(idx(x, y))) return;
  consumeSlot(p, slot);
  setObj(x, y, { type: 'crop', crop: ITEMS[s.id].seed, stage: 0, t: 0 });
  emitFx({ k: 'sfx', s: 'place' });
}

// 釣魚:拿釣竿對水面右鍵拋竿,站著不動等 FISH_CFG 的隨機秒數,開獎邏輯在 updatePlayersHost;
// 移動會收竿(魚跑了),不用瞄準浮標、不用 QTE,跟翻土/種植同一套「右鍵→判定→結果」節奏
function doFish(p, x, y) {
  if (p.dead || p.downed || !inMap(x, y) || p.fish) return;
  if (!infoAt(x, y).liquid) return;
  if (dist(p.x, p.y, x + 0.5, y + 0.5) > 3.8) return;
  p.aim = Math.atan2(y + 0.5 - p.y, x + 0.5 - p.x);
  p.fish = { x: p.x, y: p.y, t: FISH_CFG.timeMin + Math.random() * (FISH_CFG.timeMax - FISH_CFG.timeMin) };
  addFloater(p.x, p.y - 0.6, '🎣 拋竿……', '#7ec8ff');
}

// 歸巢螢石:手持右鍵開始引導(比照釣魚「站著別動」的節奏,計時/中斷在 updatePlayersHost);
// 受傷中斷寫在 damagePlayer;完成才消耗石頭並傳送(重用既有 tp 協定)
function doRecall(p, slot) {
  if (p.dead || p.downed || p.recall) return;
  const s = p.inv[slot];
  if (!s || !ITEMS[s.id].recall) return;
  if (dist(p.x, p.y, G.core.x, G.core.y) < 8) { addFloater(p.x, p.y - 0.6, '已經在星核旁了', '#8899aa'); return; }
  p.recall = { x: p.x, y: p.y, t: RECALL_CFG.channel };
  addFloater(p.x, p.y - 0.6, `🌀 呼喚星核……站穩 ${RECALL_CFG.channel} 秒`, '#7ec8ff');
}

// 開獎:依 FISH_CFG.loot 權重抽一項;掉在腳邊讓磁吸撿取處理(背包滿了會留在地上,不會憑空消失)
function resolveFishing(p) {
  let r = Math.random();
  for (const [id, w] of FISH_CFG.loot) {
    if ((r -= w) >= 0) continue;
    if (!id) { addFloater(p.x, p.y - 0.6, '💧 空軍……魚跑了', '#8899aa'); return; }
    spawnDrop(id, 1, p.x, p.y);
    addFloater(p.x, p.y - 0.9, `${ITEMS[id].icon} ${ITEMS[id].name}上鉤了!`, '#7dff8e');
    emitFx({ k: 'sfx', s: 'pickup' });
    return;
  }
}

function doEat(p, slot) {
  if (p.dead || p.downed) return;
  const s = p.inv[slot];
  if (!s) return;
  const it = ITEMS[s.id];
  if (!it.food) return;
  // 純回血食物血滿吃不下去(避免浪費);帶 buff 的料理為了 buff 血滿也能吃
  if (p.hp >= p.maxhp && !it.buff) return;
  const heal = Math.round(it.food * (1 + TALENTS.chef.val * talRank(p, 'chef'))); // 大胃王天賦
  p.hp = Math.min(p.maxhp, p.hp + heal);
  addFloater(p.x, p.y - 0.6, '+' + heal, '#7dff8e');
  if (it.buff) {
    // 同種 buff 重複吃只重置時間,不疊加倍率(平衡上限)
    p.buffs = p.buffs || {};
    p.buffs[it.buff.kind] = { mult: it.buff.mult, value: it.buff.value, t: it.buff.dur };
    const info = BUFF_INFO[it.buff.kind];
    addFloater(p.x, p.y - 0.9, `${info.icon} ${info.name} ${it.buff.dur}秒`, '#7ec8ff');
  }
  emitFx({ k: 'sfx', s: 'eat' });
  consumeSlot(p, slot);
}

// 丟出快捷欄選中格子的物品(Q鍵);裝備類(count=1)整把丟出並保留強化等級,
// 可堆疊物一次丟1個,方便多人合作時分批分享而不是整疊倒出去
function doDropItem(p, slot) {
  if (p.dead || p.downed) return;
  const s = p.inv[slot];
  if (!s) return;
  const ang = p.aim + (Math.random() - 0.5) * 0.6;
  const dx = Math.cos(ang) * 0.8, dy = Math.sin(ang) * 0.8;
  spawnDrop(s.id, 1, p.x + dx, p.y + dy, s.lv || 0, s.dur);
  consumeSlot(p, slot);
  emitFx({ k: 'sfx', s: 'place' });
}

// 把背包格子拖曳到地圖上放開:丟在滑鼠指的那個位置。
// 拖太遠夾到玩家可及範圍邊緣(不是直接失敗,拖曳落點通常沒那麼精準);
// 落點卡在牆裡就退回腳邊,避免道具卡進牆體拿不到
function doDropAt(p, slot, x, y) {
  if (p.dead || p.downed) return;
  const s = p.inv[slot];
  if (!s) return;
  const maxD = 3.8;
  const d = dist(p.x, p.y, x, y);
  if (d > maxD) {
    const t = maxD / d;
    x = p.x + (x - p.x) * t;
    y = p.y + (y - p.y) * t;
  }
  if (isSolid(Math.floor(x), Math.floor(y))) { x = p.x; y = p.y; }
  spawnDrop(s.id, 1, x, y, s.lv || 0, s.dur);
  consumeSlot(p, slot);
  emitFx({ k: 'sfx', s: 'place' });
}

function doDeposit(p) {
  if (p.dead || p.downed || dist(p.x, p.y, G.core.x, G.core.y) > 3) return;
  const n = countItem(p, 'lumite');
  if (n <= 0) { addFloater(p.x, p.y - 0.6, '沒有光晶', '#8899aa'); return; }
  const canUse = Math.min(n, Math.ceil((CORE_CFG.maxE - G.core.energy) / CORE_CFG.feed));
  if (canUse > 0) {
    payCost(p, { lumite: canUse });
    G.core.energy = Math.min(CORE_CFG.maxE, G.core.energy + canUse * CORE_CFG.feed);
    addFloater(G.core.x, G.core.y - 1, `+${canUse * CORE_CFG.feed} ⚡`, '#7ef0ff');
    emitFx({ k: 'sfx', s: 'deposit' });
    msgAll(`💠 ${p.name} 餵了 ${canUse} 顆光晶,星核滿足地嗡嗡發亮(能量 ${Math.round(G.core.energy)})`);
    return;
  }
  // 超載餵食:能量已滿時繼續餵,多的轉換成護盾(SHIELD_CFG.feedShield 比正常 feed 低,反映溢出損耗)
  G.core.shield = G.core.shield || 0;
  const shieldRoom = Math.ceil((SHIELD_CFG.maxShield - G.core.shield) / SHIELD_CFG.feedShield);
  const useShield = Math.min(n, shieldRoom);
  if (useShield <= 0) { addFloater(G.core.x, G.core.y - 1, '星核能量與護盾都已滿', '#7ef0ff'); return; }
  payCost(p, { lumite: useShield });
  G.core.shield = Math.min(SHIELD_CFG.maxShield, G.core.shield + useShield * SHIELD_CFG.feedShield);
  addFloater(G.core.x, G.core.y - 1, `🛡️+${useShield * SHIELD_CFG.feedShield}`, '#a0e8ff');
  emitFx({ k: 'sfx', s: 'deposit' });
  msgAll(`🛡️ ${p.name} 超載餵食了 ${useShield} 顆光晶,星核張開了一層護盾!(護盾 ${Math.round(G.core.shield)})`);
}

// ===== 掉落物 =====
// lv:強化等級 / dur:目前耐久(只有裝備類會帶,撿回背包時要一併還原,
// 否則「丟出去再撿回來」會變成免費修理/洗掉強化)
function spawnDrop(item, n, x, y, lv, dur) {
  G.drops.push({
    id: nextDid++, item, n, x, y, lv: lv || 0, dur,
    vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 3,
  });
}
function updateDrops(dt) {
  for (let i = G.drops.length - 1; i >= 0; i--) {
    const d = G.drops[i];
    const f = Math.exp(-5 * dt);
    d.vx *= f; d.vy *= f;
    if (!circleHitsSolid(d.x + d.vx * dt, d.y, 0.15)) d.x += d.vx * dt;
    if (!circleHitsSolid(d.x, d.y + d.vy * dt, 0.15)) d.y += d.vy * dt;
    // 磁吸 + 撿取:拾取戒指讓範圍因人而異,不能用固定半徑的 nearestAlivePlayer,自己找最近符合範圍的人
    let p = null, bd = Infinity;
    for (const q of G.players.values()) {
      if (q.dead) continue;
      const dd = dist(d.x, d.y, q.x, q.y);
      if (dd < magnetRangeOf(q) && dd < bd) { bd = dd; p = q; }
    }
    if (p) {
      const dd = dist(d.x, d.y, p.x, p.y);
      if (dd < 0.55) {
        // 帶強化等級/耐久狀態的裝備(max:1)不能走一般堆疊邏輯合併,否則等級/耐久會被吃掉
        const left = (d.lv || d.dur !== undefined && d.dur !== null)
          ? addEnhancedItem(p, d.item, d.lv, d.dur) : addItem(p, d.item, d.n);
        if (left === 0) {
          G.drops.splice(i, 1);
          emitFx({ k: 'sfx', s: 'pickup' });
          hintOnPickup(p, d.item);
        } else d.n = left;
      } else {
        d.x += (p.x - d.x) / dd * 5 * dt;
        d.y += (p.y - d.y) / dd * 5 * dt;
      }
    }
  }
}

// 撿到關鍵物品時給新手提示(每種只提示一次)
function hintOnPickup(p, item) {
  const hints = {
    lumite: '💠 光晶 get!星核的最愛——站它旁邊按 F 餵一口,或做成火把',
    copper_ore: '🟤 銅礦 get!工作台→熔爐→銅裝備,升級之路開張!',
    iron_ore: '⚪ 鐵礦 get!有鐵才敢往深處走~',
    gold_ore: '🟡 金礦 get!!最強裝備的原料,發財了發財了!',
    shard: '🔷 星核碎片!!抱緊它,走到星核旁會自動歸位',
  };
  if (hints[item] && !G.warned['h_' + item]) {
    G.warned['h_' + item] = true;
    msgAll(hints[item]);
  }
}

// ===== 廢墟寶箱 / 蝕影巢穴 =====
// 開箱:依所在區域(zone 0/1/2)從 CHEST_LOOT 抽 2~3 項掉在地上,不進背包(避免一開就滿)
function openChest(p, x, y) {
  const zone = zoneOf(x + 0.5, y + 0.5);
  const table = CHEST_LOOT[zone] || CHEST_LOOT[0];
  const picks = [...table].sort(() => Math.random() - 0.5).slice(0, 2 + (Math.random() < 0.5 ? 1 : 0));
  for (const [id, n] of picks) spawnDrop(id, n, x + 0.5, y + 0.5);
  msgAll(`📦 ${p.name} 開出寶箱!是誰埋的不重要,現在是我們的了!`);
}

// 拆巢穴:給光晶+機率卷軸做回饋(補償玩家主動清除生怪源的努力);精英巢穴給雙倍
function breakNest(x, y, o) {
  const def = (o && NEST_TYPES[o.nestType]) || NEST_TYPES.common;
  const mult = def.elite ? 2 : 1;
  spawnDrop('lumite', (2 + Math.floor(Math.random() * 3)) * mult, x + 0.5, y + 0.5);
  if (Math.random() < 0.4) spawnDrop('enh_scroll', mult, x + 0.5, y + 0.5);
}

// ===== 動物養殖(房主):被動生物,遊蕩/跟隨飼料/餵食產出,永遠不攻擊 =====
function spawnAnimal(type, x, y) {
  const at = ANIMAL_TYPES[type];
  const a = { id: nextAid++, type, x, y, hp: at.hp, maxhp: at.hp,
    fedT: 0, vx: 0, vy: 0, hopT: Math.random() * 2, };
  G.animals.push(a);
  return a;
}

// 手持該動物飼料、且在跟隨範圍內的最近玩家(動物會跟著走,用來引回基地圈養)
function feederNear(a, at) {
  let best = null, bd = ANIMAL_CFG.followRange;
  for (const p of G.players.values()) {
    if (p.dead) continue;
    const s = p.inv[p.sel];
    if (!s || !at.feed.includes(s.id)) continue;
    const d = dist(a.x, a.y, p.x, p.y);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

function hurtAnimal(a, dmg, src) {
  a.hp -= Math.round(dmg);
  addFloater(a.x, a.y - 0.5, '-' + Math.round(dmg), '#ffdf6b');
  emitFx({ k: 'sfx', s: 'hit' });
  if (src) {
    const d = Math.max(0.1, dist(src.x, src.y, a.x, a.y));
    a.vx += (a.x - src.x) / d * 5; a.vy += (a.y - src.y) / d * 5;
    a.hopT = 0; // 受驚,馬上跳開
  }
  if (a.hp <= 0) {
    const i = G.animals.indexOf(a);
    if (i >= 0) G.animals.splice(i, 1);
    const at = ANIMAL_TYPES[a.type];
    const n = at.meat[0] + Math.floor(Math.random() * (at.meat[1] - at.meat[0] + 1));
    spawnDrop('meat', n, a.x, a.y);
    emitFx({ k: 'sfx', s: 'break_' });
  }
}

// 右鍵拿飼料對動物:餵食(消耗 1 個),倒數 productCD 後掉產物;吃飽的動物不收
function doFeed(p, aid, slot) {
  if (p.dead || p.downed) return;
  const a = G.animals.find(x => x.id === aid);
  if (!a) return;
  if (dist(p.x, p.y, a.x, a.y) > 3.8) return;
  const at = ANIMAL_TYPES[a.type];
  const s = p.inv[slot];
  if (!s || !at.feed.includes(s.id)) return;
  if (a.fedT > 0) { addFloater(a.x, a.y - 0.6, `${at.icon} 還不餓`, '#8899aa'); return; }
  consumeSlot(p, slot);
  a.fedT = at.productCD;
  a.hp = Math.min(a.maxhp, a.hp + 10);
  unlockAchv('first_tame');
  addFloater(a.x, a.y - 0.6, `💕 好吃!${Math.round(at.productCD)}秒後產出${ITEMS[at.product].name}`, '#ff9de2'); // candy-pink:動物好感
  emitFx({ k: 'sfx', s: 'eat' });
}

function updateAnimals(dt) {
  for (const a of G.animals) {
    const at = ANIMAL_TYPES[a.type];
    a.hopT -= dt;
    // 餵飽倒數,時間到掉產物、回到飢餓狀態(要再餵才有下一顆)
    if (a.fedT > 0) {
      a.fedT -= dt;
      if (a.fedT <= 0) {
        a.fedT = 0;
        spawnDrop(at.product, 1, a.x, a.y);
        addFloater(a.x, a.y - 0.6, `${ITEMS[at.product].icon}!`, '#ffd23f');
      }
    }
    // 移動:附近有人拿飼料就跟著走,否則慢速隨機遊蕩
    if (a.hopT <= 0) {
      const feeder = feederNear(a, at);
      if (feeder && dist(a.x, a.y, feeder.x, feeder.y) > 1.2) {
        a.hopT = at.hopCD * 0.7;
        const ang = Math.atan2(feeder.y - a.y, feeder.x - a.x) + (Math.random() - 0.5) * 0.3;
        a.vx = Math.cos(ang) * at.speed; a.vy = Math.sin(ang) * at.speed;
      } else {
        a.hopT = at.hopCD * (1.5 + Math.random());
        const ang = Math.random() * TAU;
        a.vx = Math.cos(ang) * at.speed * 0.4; a.vy = Math.sin(ang) * at.speed * 0.4;
      }
    }
    const f = Math.exp(-4 * dt);
    a.vx *= f; a.vy *= f;
    // 撞牆/圍籬就停(圍籬圈養靠這個);卡住就馬上重新起跳換方向,
    // 不然體型大的牛在一格寬走廊裡會整段跳程貼牆磨,跟隨玩家時卡到不動。
    // forEnemy:光簾閘門對動物也是牆(牧場開口裝門,牲畜不會溜出去)
    if (moveCircle(a, a.vx * dt, a.vy * dt, at.r, true)) a.hopT = Math.min(a.hopT, 0.15);
  }
}

// ===== 農耕:作物成長(房主)=====
// 只在 stage 推進的當下才廣播(呼叫頻率低),不是每幀都送封包;
// 直接組 { t:'obj' } 訊息送出,不走 setObj(避免重覆 delete/re-add cropIdx,
// 因為這裡本來就在 for...of 走訪 G.cropIdx,對同一個 Set 又刪又加會讓走訪順序不可預期)
function updateCrops(dt) {
  for (const i of G.cropIdx) {
    const o = G.objects.get(i);
    if (!o) continue;
    const def = CROP_TYPES[o.crop];
    if (!def || o.stage >= def.icons.length - 1) continue;
    o.t += dt;
    const stageTime = def.growTime / (def.icons.length - 1);
    if (o.t >= stageTime) {
      o.t = 0;
      o.stage++;
      UI.mmDirty = true;
      if (NET.isHost()) NET.sendAll({ t: 'obj', i, o: { ...o } });
    }
  }
}

// 巢穴持續生怪(房主):每座巢穴每隔一段時間嘗試在周圍生 1 隻,
// 巢穴附近活怪數達上限就暫停,避免玩家不清怪就被越滾越多的怪淹沒
function updateNests(dt) {
  for (const i of G.nestIdx) {
    const o = G.objects.get(i);
    const def = NEST_TYPES[o.nestType] || NEST_TYPES.common;
    o.spawnT = (o.spawnT ?? Math.random() * def.spawnCD) - dt;
    if (o.spawnT > 0) continue;
    o.spawnT = def.spawnCD;
    const nx = (i % MAP_W) + 0.5, ny = ((i / MAP_W) | 0) + 0.5;
    const near = G.enemies.filter(e => !e.wave && dist(e.x, e.y, nx, ny) < 10).length;
    if (near >= def.nearCap) continue;
    for (let k = 0; k < (def.spawnCount || 1); k++) {
      const ang = Math.random() * TAU, d = 1.5 + Math.random() * 2;
      const x = Math.floor(nx + Math.cos(ang) * d), y = Math.floor(ny + Math.sin(ang) * d);
      if (!inMap(x, y) || tileAt(x, y) !== T.FLOOR) continue;
      const zone = zoneOf(x + 0.5, y + 0.5);
      const type = def.spawnType || (zone === 0 ? 'imp' : zone === 1 ? 'hunter' : 'abyss');
      spawnEnemy(type, x + 0.5, y + 0.5, def.elite ? { elite: true } : undefined);
    }
  }
}

// ===== 光塔自動攻擊(房主) =====
let towerTick = 0;
function updateTowers(dt) {
  towerTick -= dt;
  if (towerTick > 0) return;
  towerTick = 1.2;
  for (const i of G.towerIdx) {
    const tx = (i % MAP_W) + 0.5, ty = ((i / MAP_W) | 0) + 0.5;
    let best = null, bd = 5.5;
    for (const e of G.enemies) {
      const d = dist(tx, ty, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    if (best) {
      hurtEnemy(best, 12, { x: tx, y: ty });
      emitFx({ k: 'ft', x: tx, y: ty - 0.6, txt: '⚡', color: '#7ef0ff' });
    }
  }
}

// ===== 箭塔(房主):要玩家補箭矢才會開火,彈藥打完自動停火;可手動開關省彈藥 =====
function updateArcherTowers(dt) {
  for (const i of G.archerTowerIdx) {
    const o = G.objects.get(i);
    o.shootT = (o.shootT ?? 0) - dt;
    if (o.off || o.shootT > 0 || !o.ammo) continue;
    const tx = (i % MAP_W) + 0.5, ty = ((i / MAP_W) | 0) + 0.5;
    let best = null, bd = ARCHER_TOWER_CFG.range;
    for (const e of G.enemies) {
      const d = dist(tx, ty, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    if (best) {
      o.shootT = ARCHER_TOWER_CFG.cd;
      o.ammo--;
      const ang = Math.atan2(best.y - ty, best.x - tx);
      spawnProj({
        x: tx + Math.cos(ang) * 0.4, y: ty + Math.sin(ang) * 0.4,
        vx: Math.cos(ang) * 14, vy: Math.sin(ang) * 14,
        dmg: ARCHER_TOWER_CFG.dmg, from: 'p', owner: null, ttl: 1.2,
      });
      emitFx({ k: 'sfx', s: 'shoot' });
    }
  }
}

// ===== 凜鈴塔(房主):零傷害的範圍緩速脈衝,把怪黏在火力圈上 =====
// 全域節流比照光塔(所有塔同拍脈衝);緩速實際生效在 updateEnemies 的起跳取樣。
// 冰系蝕影(phantom/frost_boss)抗性=緩速時間減半,不做全免——凜鈴塔的賣點就是黏得住穿牆幽影
let frostTick = 0;
function updateFrostTowers(dt) {
  frostTick -= dt;
  if (frostTick > 0) return;
  frostTick = FROST_TOWER_CFG.cd;
  for (const i of G.frostIdx) {
    const tx = (i % MAP_W) + 0.5, ty = ((i / MAP_W) | 0) + 0.5;
    let hit = 0;
    for (const e of G.enemies) {
      if (dist(tx, ty, e.x, e.y) >= FROST_TOWER_CFG.range) continue;
      const durF = ENEMY_TYPES[e.type].elem === 'frost' ? 0.5 : 1;
      // 剛被凍上的那一下,現有跳程速度也立刻打折(只打一次,已在緩速中就不重複疊)
      if (!(e.slowT > 0)) { e.vx *= FROST_TOWER_CFG.mult; e.vy *= FROST_TOWER_CFG.mult; }
      e.slowT = Math.max(e.slowT || 0, FROST_TOWER_CFG.dur * durF);
      hit++;
    }
    if (hit) emitFx({ k: 'ft', x: tx, y: ty - 0.6, txt: '❄️', color: '#a8e8ff' });
  }
}

// ===== 加農塔(房主):慢速發射會爆炸的砲彈,命中處範圍傷害,克怪群 =====
// 彈道帶 aoe,實際傷害在 updateProjs 落地時透過 explodeAt(cfg.hitEnemies) 統一結算,這裡只負責瞄準/發射
function updateCannonTowers(dt) {
  for (const i of G.cannonIdx) {
    const o = G.objects.get(i);
    o.shootT = (o.shootT ?? 0) - dt;
    if (o.shootT > 0) continue;
    const tx = (i % MAP_W) + 0.5, ty = ((i / MAP_W) | 0) + 0.5;
    let best = null, bd = CANNON_TOWER_CFG.range;
    for (const e of G.enemies) {
      const d = dist(tx, ty, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    if (best) {
      o.shootT = CANNON_TOWER_CFG.cd;
      const ang = Math.atan2(best.y - ty, best.x - tx);
      spawnProj({
        x: tx + Math.cos(ang) * 0.4, y: ty + Math.sin(ang) * 0.4,
        vx: Math.cos(ang) * CANNON_TOWER_CFG.speed, vy: Math.sin(ang) * CANNON_TOWER_CFG.speed,
        dmg: CANNON_TOWER_CFG.dmg, from: 'p', owner: null, ttl: 1.6,
        aoe: { r: CANNON_TOWER_CFG.aoeR, wallDmg: 0 }, // wallDmg=0:不會炸到自己蓋的牆/塔
      });
      emitFx({ k: 'sfx', s: 'shoot' });
    }
  }
}

// ===== 連弩塔(房主):同時鎖定範圍內最多 targets 隻怪各射一箭,免彈藥但單發傷害低,克分散怪群 =====
function updateMultiTowers(dt) {
  for (const i of G.multiIdx) {
    const o = G.objects.get(i);
    o.shootT = (o.shootT ?? 0) - dt;
    if (o.shootT > 0) continue;
    const tx = (i % MAP_W) + 0.5, ty = ((i / MAP_W) | 0) + 0.5;
    const targets = G.enemies
      .map(e => ({ e, d: dist(tx, ty, e.x, e.y) }))
      .filter(t => t.d < MULTI_TOWER_CFG.range)
      .sort((a, b) => a.d - b.d)
      .slice(0, MULTI_TOWER_CFG.targets);
    if (targets.length) {
      o.shootT = MULTI_TOWER_CFG.cd;
      for (const { e } of targets) {
        const ang = Math.atan2(e.y - ty, e.x - tx);
        spawnProj({
          x: tx + Math.cos(ang) * 0.4, y: ty + Math.sin(ang) * 0.4,
          vx: Math.cos(ang) * MULTI_TOWER_CFG.speed, vy: Math.sin(ang) * MULTI_TOWER_CFG.speed,
          dmg: MULTI_TOWER_CFG.dmg, from: 'p', owner: null, ttl: 1.2,
        });
      }
      emitFx({ k: 'sfx', s: 'shoot' });
    }
  }
}

// ===== 重砲塔(房主):射程最遠,優先鎖定精英/神殿 Boss(沒有才退回打最近的),單發爆傷極高但冷卻很慢 =====
function updateSniperTowers(dt) {
  for (const i of G.sniperIdx) {
    const o = G.objects.get(i);
    o.shootT = (o.shootT ?? 0) - dt;
    if (o.shootT > 0) continue;
    const tx = (i % MAP_W) + 0.5, ty = ((i / MAP_W) | 0) + 0.5;
    let best = null, bd = SNIPER_TOWER_CFG.range;
    for (const e of G.enemies) { // 第一輪:只找精英/Boss
      const d = dist(tx, ty, e.x, e.y);
      if (d < bd && (e.elite || ENEMY_TYPES[e.type].boss)) { best = e; bd = d; }
    }
    if (!best) { // 沒有精英/Boss 才退回打最近的一般怪
      bd = SNIPER_TOWER_CFG.range;
      for (const e of G.enemies) {
        const d = dist(tx, ty, e.x, e.y);
        if (d < bd) { best = e; bd = d; }
      }
    }
    if (best) {
      o.shootT = SNIPER_TOWER_CFG.cd;
      const tough = best.elite || ENEMY_TYPES[best.type].boss;
      const dmg = tough ? SNIPER_TOWER_CFG.dmg * SNIPER_TOWER_CFG.eliteMult : SNIPER_TOWER_CFG.dmg;
      const ang = Math.atan2(best.y - ty, best.x - tx);
      spawnProj({
        x: tx + Math.cos(ang) * 0.4, y: ty + Math.sin(ang) * 0.4,
        vx: Math.cos(ang) * SNIPER_TOWER_CFG.speed, vy: Math.sin(ang) * SNIPER_TOWER_CFG.speed,
        dmg, from: 'p', owner: null, ttl: 1.0,
      });
      emitFx({ k: 'sfx', s: 'shoot' });
    }
  }
}

// ===== 自動採礦機(房主):慢慢採鄰近礦脈,採出的礦掉腳邊靠傳輸帶/玩家搬走 =====
// 定位是「後期省事 QoL」:cd 長(產量遠低於手動)、需光晶供電、會消耗礦脈(採完周圍要搬機器)
let minerTick = 0;
function updateMiners(dt) {
  minerTick -= dt;
  if (minerTick > 0) return;
  minerTick = 0.5; // 半秒掃一次,實際採礦節奏由每台機器自己的 cd 計時器控制
  for (const i of G.minerIdx) {
    const o = G.objects.get(i);
    o.mineT = (o.mineT ?? AUTO_MINER_CFG.cd) - 0.5;
    if (o.mineT > 0) continue;
    o.mineT = AUTO_MINER_CFG.cd;
    if ((o.fuel || 0) <= 0) continue; // 沒燃料就停機(不重置 cd 也沒關係,反正下輪還是沒燃料)
    const mx = (i % MAP_W), my = ((i / MAP_W) | 0);
    // 掃相鄰 8 格找可採礦脈(有 ore 礦點且鎬階級夠),採到第一個就停(一次採一格)
    let done = false;
    for (let dy = -AUTO_MINER_CFG.range; dy <= AUTO_MINER_CFG.range && !done; dy++) {
      for (let dx = -AUTO_MINER_CFG.range; dx <= AUTO_MINER_CFG.range && !done; dx++) {
        if (dx === 0 && dy === 0) continue;
        const tx = mx + dx, ty = my + dy;
        if (!inMap(tx, ty)) continue;
        const info = TILE_INFO[tileAt(tx, ty)];
        if (!info.ore || !info.solid || !info.drop) continue;       // 只採礦脈,不挖普通牆
        if (info.tier > AUTO_MINER_CFG.tier) continue;              // 挖不動的高階礦(鑽石)跳過
        // 採掉這格礦脈:消耗 1 燃料、礦物掉在採礦機腳邊(往機器方向噴一點好被傳輸帶接)
        o.fuel = Math.max(0, (o.fuel || 0) - AUTO_MINER_CFG.fuelPerMine);
        spawnDrop(info.drop.id, info.drop.n, mx + 0.5, my + 0.5);
        setTile(tx, ty, T.FLOOR);
        emitFx({ k: 'ft', x: mx + 0.5, y: my + 0.3, txt: '⛏️', color: '#ffd23f' });
        emitFx({ k: 'sfx', s: 'mine' });
        setObj(mx, my, o, false); // 廣播更新後的燃料量給客戶端(HUD 顯示用)
        done = true;
      }
    }
  }
}

// ===== 自動熔煉爐(房主):道鏈中繼站,把緩衝裡的礦石定時熔成錠掉在爐邊 =====
// 原料緩衝借用 o.items(跟儲物箱同格式 [{id,count}]),存讀檔/init 的固定欄位陣列零改動
let smelterTick = 0;
function updateSmelters(dt) {
  smelterTick -= dt;
  if (smelterTick > 0) return;
  smelterTick = 0.5; // 半秒掃一次,熔煉節奏由每台自己的 smeltT 計時
  for (const i of G.smelterIdx) {
    const o = G.objects.get(i);
    o.smeltT = (o.smeltT ?? AUTO_SMELTER_CFG.cd) - 0.5;
    if (o.smeltT > 0) continue;
    o.smeltT = AUTO_SMELTER_CFG.cd;
    if ((o.fuel || 0) < AUTO_SMELTER_CFG.fuelPerSmelt) continue; // 沒煤就熄火
    const s = (o.items || []).find(s => SMELT_MAP[s.id] && s.count >= SMELT_MAP[s.id].need);
    if (!s) continue; // 緩衝裡沒有湊得滿一鍋的礦
    const m = SMELT_MAP[s.id];
    s.count -= m.need;
    if (s.count <= 0) o.items.splice(o.items.indexOf(s), 1);
    o.fuel -= AUTO_SMELTER_CFG.fuelPerSmelt;
    const mx = i % MAP_W, my = (i / MAP_W) | 0;
    // 成品掉在第一個相鄰非固體格(右下左上順序=固定出料口):在那格鋪傳輸帶就能自動接走,
    // 道鏈才串得下去(爐子本身是固體,掉在自己腳下的話帶子推不到)
    let sx = mx + 0.5, sy = my + 0.5;
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      if (!isSolid(mx + dx, my + dy)) { sx = mx + dx + 0.5; sy = my + dy + 0.5; break; }
    }
    spawnDrop(m.out, 1, sx, sy);
    emitFx({ k: 'ft', x: mx + 0.5, y: my + 0.3, txt: '🔥', color: '#ff9d5c' });
    emitFx({ k: 'sfx', s: 'craft' });
    setObj(i % MAP_W, (i / MAP_W) | 0, o, false); // 廣播燃料/緩衝變化
  }
}

// 熔煉爐吸收物料(傳輸帶與玩家右鍵共用):煤→燃料、SMELT_MAP 的礦石→原料緩衝;回傳放不下的數量
function smelterFeed(o, id, n) {
  if (id === 'coal') {
    const take = Math.min(n, AUTO_SMELTER_CFG.maxFuel - (o.fuel || 0));
    o.fuel = (o.fuel || 0) + take;
    return n - take;
  }
  if (!SMELT_MAP[id]) return n; // 不是它吃的東西,原封不動
  if (!o.items) o.items = [];
  const total = o.items.reduce((a, s) => a + s.count, 0);
  const take = Math.min(n, AUTO_SMELTER_CFG.maxBuffer - total);
  if (take <= 0) return n;
  const s = o.items.find(s => s.id === id);
  if (s) s.count += take; else o.items.push({ id, count: take });
  return n - take;
}

// 玩家右鍵熔煉爐:手持煤=補燃料、手持可熔礦石=塞原料(整組塞到滿),其他=提示
function doFeedSmelter(p, x, y) {
  const o = objAt(x, y);
  if (!o || o.type !== 'auto_smelter') return;
  if (dist(p.x, p.y, x + 0.5, y + 0.5) > 3.8) return;
  const sel = p.inv[p.sel];
  const id = sel && (sel.id === 'coal' || SMELT_MAP[sel.id]) ? sel.id : null;
  if (!id) { addFloater(x + 0.5, y + 0.5, '手持煤⚫或礦石 右鍵投料', '#8899aa'); return; }
  const have = countItem(p, id);
  const left = smelterFeed(o, id, have);
  if (left >= have) { addFloater(x + 0.5, y + 0.5, id === 'coal' ? '燃料已滿' : '原料緩衝已滿', '#8899aa'); return; }
  payCost(p, { [id]: have - left });
  addFloater(x + 0.5, y + 0.5, `+${have - left} ${ITEMS[id].icon}`, '#ff9d5c');
  emitFx({ k: 'sfx', s: 'place' });
  setObj(x, y, o, false);
}

// 熔煉爐被敲爛:緩衝的礦石與剩餘的煤全部掉出來(不憑空消失),再掉回爐子本身
function spillSmelter(x, y, o) {
  for (const s of o.items || []) spawnDrop(s.id, s.count, x + 0.5, y + 0.5);
  if (o.fuel > 0) spawnDrop('coal', o.fuel, x + 0.5, y + 0.5);
}

// ===== 傳輸帶(房主):把地上的掉落物往 dir 方向推,連成道鏈集中礦機產出 =====
const BELT_VX = [1, 0, -1, 0], BELT_VY = [0, 1, 0, -1]; // dir 0=右 1=下 2=左 3=上
function updateBelts(dt) {
  if (G.beltIdx.size === 0) return;
  for (let di = G.drops.length - 1; di >= 0; di--) { // 倒序:入庫的掉落物要 splice
    const d = G.drops[di];
    const bx = Math.floor(d.x), by = Math.floor(d.y);
    const bi = idx(bx, by);
    if (!G.beltIdx.has(bi)) continue;
    const o = G.objects.get(bi);
    const dir = o.dir || 0;
    // 道鏈終點:傳輸帶正前方是儲物箱 → 直接入庫(不用等玩家撿),Core Keeper 式自動化
    const fx = bx + BELT_VX[dir], fy = by + BELT_VY[dir];
    const fo = inMap(fx, fy) ? G.objects.get(idx(fx, fy)) : null;
    if (fo && fo.type === 'storage') {
      const left = storageAdd(fo, d.item, d.n, d.lv, d.dur);
      if (left < d.n) { setObj(fx, fy, fo, false); emitFx({ k: 'sfx', s: 'pickup' }); } // 有入庫才廣播
      if (left <= 0) { G.drops.splice(di, 1); continue; }
      d.n = left; // 箱滿了:剩下的留在帶子上堆著,不再前推
      continue;
    }
    // 道鏈中繼:帶子正前方是自動熔煉爐 → 礦石進原料緩衝、煤進燃料槽(強化裝備掉落不吸,免得被熔掉)
    if (fo && fo.type === 'auto_smelter' && !d.lv && d.dur === undefined) {
      const left = smelterFeed(fo, d.item, d.n);
      if (left < d.n) { setObj(fx, fy, fo, false); emitFx({ k: 'sfx', s: 'pickup' }); }
      if (left <= 0) { G.drops.splice(di, 1); continue; }
      d.n = left; // 吃不下的留在帶子上(爐滿/不是它吃的東西)
      continue;
    }
    // 直接加位移(不動 vx/vy,避免跟磁吸/摩擦力互相打架);撞牆就不推
    const nx = d.x + BELT_VX[dir] * BELT_CFG.push * dt;
    const ny = d.y + BELT_VY[dir] * BELT_CFG.push * dt;
    if (!circleHitsSolid(nx, d.y, 0.15)) d.x = nx;
    if (!circleHitsSolid(d.x, ny, 0.15)) d.y = ny;
  }
}

// 玩家右鍵拿光晶對準採礦機:補燃料(比照箭塔補箭)
function doFuelMiner(p, x, y) {
  const o = objAt(x, y);
  if (!o || o.type !== 'auto_miner') return;
  if (dist(p.x, p.y, x + 0.5, y + 0.5) > 3.8) return;
  const have = countItem(p, 'lumite');
  if (have <= 0) { addFloater(x + 0.5, y + 0.5, '沒有光晶', '#8899aa'); return; }
  const room = AUTO_MINER_CFG.maxFuel - (o.fuel || 0);
  if (room <= 0) { addFloater(x + 0.5, y + 0.5, '燃料已滿', '#8899aa'); return; }
  const use = Math.min(have, room);
  payCost(p, { lumite: use });
  o.fuel = (o.fuel || 0) + use;
  addFloater(x + 0.5, y + 0.5, `+${use} 💠`, '#7ef0ff');
  emitFx({ k: 'sfx', s: 'place' });
  setObj(x, y, o, false);
}

// 玩家右鍵空手對傳輸帶:順時針旋轉方向(右→下→左→上→右)
function doRotateBelt(p, x, y) {
  const o = objAt(x, y);
  if (!o || o.type !== 'belt') return;
  if (dist(p.x, p.y, x + 0.5, y + 0.5) > 3.8) return;
  o.dir = ((o.dir || 0) + 1) % 4;
  addFloater(x + 0.5, y + 0.5, ['➡️', '⬇️', '⬅️', '⬆️'][o.dir], '#7ef0ff');
  emitFx({ k: 'sfx', s: 'place' });
  setObj(x, y, o, false);
}

// ===== 儲物箱(房主權威):放各種道具的容器,自動化道鏈的終點 =====
// 內容存在 o.items(陣列,每格 {id,count[,lv,dur]},跟背包同格式);任何改動都 setObj 廣播全量內容給客戶端。
// 存入:可堆疊物併進現有堆疊/新格;帶強化等級或耐久的裝備各佔一格。回傳放不下的數量。
function storageAdd(o, id, n, lv, dur) {
  if (!o.items) o.items = [];
  const slots = STORAGE_CFG.slots;
  const enhanced = (lv && lv > 0) || (dur !== undefined && dur !== null);
  if (enhanced) {
    let left = n;
    while (left > 0 && o.items.length < slots) {
      const s = { id, count: 1 };
      if (lv) s.lv = lv;
      if (dur !== undefined && dur !== null) s.dur = dur;
      o.items.push(s); left--;
    }
    return left;
  }
  const mx = stackMax(id);
  for (const s of o.items) {
    if (n <= 0) break;
    if (s.id === id && !s.lv && s.dur === undefined && s.count < mx) {
      const add = Math.min(n, mx - s.count); s.count += add; n -= add;
    }
  }
  while (n > 0 && o.items.length < slots) {
    const add = Math.min(n, mx); o.items.push({ id, count: add }); n -= add;
  }
  return n;
}
// 玩家把背包某格全部存進儲物箱(放不下的留在背包)
function doStorageDeposit(p, x, y, slot) {
  const o = objAt(x, y);
  if (!o || o.type !== 'storage') return;
  if (dist(p.x, p.y, x + 0.5, y + 0.5) > 3.8) return;
  const s = p.inv[slot];
  if (!s) return;
  const left = storageAdd(o, s.id, s.count, s.lv, s.dur);
  if (left >= s.count) { addFloater(x + 0.5, y + 0.5, '儲物箱滿了', '#ff9d5c'); return; }
  if (left <= 0) p.inv[slot] = null; else s.count = left;
  p.invDirty = true;
  emitFx({ k: 'sfx', s: 'pickup' });
  setObj(x, y, o, false);
}
// 玩家從儲物箱取出某格到背包(背包放不下的留在箱裡)
function doStorageWithdraw(p, x, y, si) {
  const o = objAt(x, y);
  if (!o || o.type !== 'storage' || !o.items) return;
  if (dist(p.x, p.y, x + 0.5, y + 0.5) > 3.8) return;
  const s = o.items[si];
  if (!s) return;
  if (s.lv || s.dur !== undefined) {
    if (addEnhancedItem(p, s.id, s.lv, s.dur)) { addFloater(x + 0.5, y + 0.5, '背包滿了', '#ff9d5c'); return; }
    o.items.splice(si, 1);
  } else {
    const left = addItem(p, s.id, s.count);
    if (left >= s.count) { addFloater(x + 0.5, y + 0.5, '背包滿了', '#ff9d5c'); return; }
    if (left <= 0) o.items.splice(si, 1); else s.count = left;
  }
  emitFx({ k: 'sfx', s: 'pickup' });
  setObj(x, y, o, false);
}
// 快速堆疊:把背包(跳過快捷欄)中「儲物箱已有同類」的可堆疊物一次全丟進去(Core Keeper 式 QoL)
function doStorageQuick(p, x, y) {
  const o = objAt(x, y);
  if (!o || o.type !== 'storage' || dist(p.x, p.y, x + 0.5, y + 0.5) > 3.8) return;
  if (!o.items) o.items = [];
  const have = new Set(o.items.filter(s => !s.lv && s.dur === undefined).map(s => s.id));
  let moved = false;
  for (let i = 8; i < INV_SIZE; i++) { // 跳過快捷欄 0~7,免得把正在用的工具/武器丟進去
    const s = p.inv[i];
    if (!s || s.lv || s.dur !== undefined || !have.has(s.id)) continue;
    const left = storageAdd(o, s.id, s.count);
    if (left <= 0) { p.inv[i] = null; moved = true; }
    else if (left < s.count) { s.count = left; moved = true; }
  }
  if (moved) { p.invDirty = true; emitFx({ k: 'sfx', s: 'pickup' }); setObj(x, y, o, false); }
  else addFloater(x + 0.5, y + 0.5, '沒有可快速堆疊的物品', '#8899aa');
}
// 儲物箱被敲爛:內容全部掉出來(不憑空消失),再掉回箱子本身
function spillStorage(x, y, o) {
  if (!o.items) return;
  for (const s of o.items) spawnDrop(s.id, s.count, x + 0.5, y + 0.5, s.lv || 0, s.dur);
}

// 玩家右鍵拿箭矢對準箭塔:補彈藥(最多補到上限,多的箭矢留在背包)
function doFillTower(p, x, y) {
  const o = objAt(x, y);
  if (!o || o.type !== 'archer_tower') return;
  if (dist(p.x, p.y, x + 0.5, y + 0.5) > 3.8) return;
  const have = countItem(p, 'arrow');
  if (have <= 0) { addFloater(x + 0.5, y + 0.5, '沒有箭矢', '#8899aa'); return; }
  const room = ARCHER_TOWER_CFG.maxAmmo - (o.ammo || 0);
  if (room <= 0) { addFloater(x + 0.5, y + 0.5, '箭塔彈藥已滿', '#8899aa'); return; }
  const use = Math.min(have, room);
  payCost(p, { arrow: use });
  o.ammo = (o.ammo || 0) + use;
  addFloater(x + 0.5, y + 0.5, `+${use} 🏹`, '#ffd23f');
  emitFx({ k: 'sfx', s: 'place' });
  setObj(x, y, o, false); // 廣播更新後的彈藥狀態給客戶端
}

// 玩家右鍵空手對箭塔:切換開/關,關閉時不消耗彈藥也不攻擊
function doToggleTower(p, x, y) {
  const o = objAt(x, y);
  if (!o || o.type !== 'archer_tower') return;
  if (dist(p.x, p.y, x + 0.5, y + 0.5) > 3.8) return;
  o.off = !o.off;
  addFloater(x + 0.5, y + 0.5, o.off ? '🏹 已關閉' : '🏹 已啟動', o.off ? '#8899aa' : '#7dff8e');
  setObj(x, y, o, false);
}

// ===== 玩家共通狀態(房主) =====
function updatePlayersHost(dt) {
  for (const p of G.players.values()) {
    p.iframe -= dt; p.atkCD -= dt; p.mineCD -= dt; p.emoteCD -= dt;
    if (p.swing > 0) p.swing -= dt;
    // 料理 buff 倒數(死亡時 damagePlayer 已直接清空)
    if (p.buffs) for (const k in p.buffs) {
      p.buffs[k].t -= dt;
      if (p.buffs[k].t <= 0) delete p.buffs[k];
    }
    // 擊退
    if (p.kbx || p.kby) {
      moveCircle(p, (p.kbx || 0) * dt, (p.kby || 0) * dt);
      const f = Math.exp(-8 * dt);
      p.kbx = (p.kbx || 0) * f; p.kby = (p.kby || 0) * f;
      if (Math.abs(p.kbx) < 0.05) p.kbx = 0;
      if (Math.abs(p.kby) < 0.05) p.kby = 0;
    }
    if (p.dead) {
      p.respawnT -= dt;
      if (p.respawnT <= 0) {
        p.dead = false; p.hp = p.maxhp;
        p.x = G.core.x + (Math.random() - 0.5) * 2;
        p.y = G.core.y + 1.5;
        if (p.id !== G.myId && NET.isHost()) NET.sendToPid(p.id, { t: 'tp', x: p.x, y: p.y });
      }
      continue;
    }
    // 隊友救援:倒下期間不能行動(localControl 擋輸入),靠隊友靠近讀秒救回;逾時沒救到 = 徹底陣亡
    if (p.downed) {
      p.downedT -= dt;
      if (p.downedT <= 0) { enterDead(p); continue; }
      let rescuer = false;
      for (const q of G.players.values()) {
        if (q.id === p.id || q.dead || q.downed) continue;
        if (dist(p.x, p.y, q.x, q.y) < REVIVE_CFG.range) { rescuer = true; break; }
      }
      if (rescuer) {
        p.reviveP = (p.reviveP || 0) + dt / REVIVE_CFG.reviveTime;
        if (p.reviveP >= 1) {
          p.downed = false; p.downedT = 0; p.reviveP = 0;
          p.hp = Math.max(1, Math.round(p.maxhp * REVIVE_CFG.hpFrac));
          p.iframe = 1.2; // 剛救起來給點喘息時間,別站起來就被秒
          msgAll(`💪 ${p.name} 被救起來了!螢火隊不拋棄任何人~`);
          emitFx({ k: 'sfx', s: 'deposit' });
          unlockAchv('revive_hero');
        }
      }
      continue;
    }
    // 釣魚計時:離開拋竿位置太遠 = 收竿;時間到就開獎
    if (p.fish) {
      if (dist(p.x, p.y, p.fish.x, p.fish.y) > FISH_CFG.moveCancel) {
        p.fish = null;
        addFloater(p.x, p.y - 0.6, '🎣 收竿了', '#8899aa');
      } else if ((p.fish.t -= dt) <= 0) {
        p.fish = null;
        resolveFishing(p);
      }
    }
    // 歸巢螢石引導:移動就中斷(受傷中斷在 damagePlayer);完成才消耗石頭並傳送回星核
    if (p.recall) {
      if (dist(p.x, p.y, p.recall.x, p.recall.y) > RECALL_CFG.moveCancel) {
        p.recall = null;
        addFloater(p.x, p.y - 0.6, '🌀 引導中斷(要站穩啦)', '#8899aa');
      } else {
        const before = Math.ceil(p.recall.t);
        p.recall.t -= dt;
        const left = Math.ceil(p.recall.t);
        if (left < before && left > 0) addFloater(p.x, p.y - 0.8, `🌀 ${left}…`, '#7ec8ff');
        if (p.recall.t <= 0) {
          p.recall = null;
          // 引導中把石頭丟掉/存進箱子的邊角案例:找不到石頭就取消,不白嫖傳送
          if (removeOne(p, 'recall_stone')) {
            p.x = G.core.x + (Math.random() - 0.5) * 2;
            p.y = G.core.y + 1.5;
            p.iframe = 1; // 落地短暫無敵,避免暗潮圍核時直接傳進怪堆秒吃傷害
            if (p.id !== G.myId && NET.isHost()) NET.sendToPid(p.id, { t: 'tp', x: p.x, y: p.y });
            addFloater(G.core.x, G.core.y - 1.2, `🌀 ${p.name} 回家了!`, '#7ec8ff');
            emitFx({ k: 'sfx', s: 'deposit' });
          }
        }
      }
    }
    // 脫戰回血
    if (G.time - p.lastHurt > 10 && p.hp < p.maxhp) p.hp = Math.min(p.maxhp, p.hp + 3 * dt);
    // 回春 buff:不受脫戰限制,戰鬥中也持續回血(晶鱗魚湯的價值所在)
    if (p.buffs && p.buffs.regen && p.hp < p.maxhp)
      p.hp = Math.min(p.maxhp, p.hp + p.buffs.regen.value * dt);
    // 智光靈寵物:持續回血,不受料理 buff 那條的限制(獨立生效點,兩者疊加不衝突)
    if (petVal(p, 'regen') > 0 && p.hp < p.maxhp)
      p.hp = Math.min(p.maxhp, p.hp + petVal(p, 'regen') * dt);
    // 走過蘑菇自動採集(有機率額外掉一顆光孢子,鼓勵去找野生蘑菇拿種子來種)
    const fx = Math.floor(p.x), fy = Math.floor(p.y);
    const o = objAt(fx, fy);
    if (o && o.type === 'mushroom') {
      if (addItem(p, 'mushroom', 1) === 0) {
        if (Math.random() < 0.2) addItem(p, 'mush_spore', 1);
        setObj(fx, fy, null);
        emitFx({ k: 'sfx', s: 'pickup' });
      }
    } else if (o && o.type === 'crop') {
      // 走過成熟的作物自動收成:給收成物+機率退還種子,農地保留可以馬上再種
      const def = CROP_TYPES[o.crop];
      if (def && o.stage >= def.icons.length - 1) {
        const n = def.yieldMin + Math.floor(Math.random() * (def.yieldMax - def.yieldMin + 1));
        if (addItem(p, def.yield, n) === 0) {
          if (Math.random() < def.seedBackChance) addItem(p, def.seed, 1);
          setObj(fx, fy, null);
          emitFx({ k: 'sfx', s: 'pickup' });
        }
      }
    }
    // 帶碎片靠近星核自動放入
    if (countItem(p, 'shard') > 0 && dist(p.x, p.y, G.core.x, G.core.y) < 3) {
      removeOne(p, 'shard');
      G.core.shards++;
      msgAll(`🔷 碎片歸位 ${G.core.shards}/${CORE_CFG.needShards}!星核開心到嗡嗡叫~`);
      emitFx({ k: 'sfx', s: 'deposit' });
      unlockAchv('first_shard');
      if (G.core.shards >= CORE_CFG.needShards) triggerFinalWave();
    }
    // 淵核區(zone 3)踏入判定:跟碎片歸位同一個每人每幀的位置檢查,不用額外掃描
    if (zoneOf(p.x, p.y) === 3) unlockAchv('void_breach');
  }
}

// 浮動文字(所有端各自更新)
function updateFloaters(dt) {
  for (let i = G.floaters.length - 1; i >= 0; i--) {
    const f = G.floaters[i];
    f.t += dt;
    if (f.t > 1.1) G.floaters.splice(i, 1);
  }
}
// 打擊特效倒數(所有端各自更新,純視覺不影響模擬)
function updateHitFx(dt) {
  for (let i = G.hitFx.length - 1; i >= 0; i--) {
    const h = G.hitFx[i];
    h.t += dt;
    if (h.t > HITFX_DUR) G.hitFx.splice(i, 1);
  }
}
// 快速手勢特效倒數(所有端各自更新,純視覺不影響模擬)
function updateEmoteFx(dt) {
  for (let i = G.emoteFx.length - 1; i >= 0; i--) {
    const em = G.emoteFx[i];
    em.t += dt;
    if (em.t > EMOTE_CFG.dur) G.emoteFx.splice(i, 1);
  }
}
