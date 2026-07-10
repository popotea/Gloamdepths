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
    msgAll(`✨ ${p.name} 升到 Lv.${p.lv}!`);
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
function circleHitsSolid(cx, cy, r) {
  const x0 = Math.floor(cx - r), x1 = Math.floor(cx + r);
  const y0 = Math.floor(cy - r), y1 = Math.floor(cy + r);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (isSolid(tx, ty)) {
      const nx = clamp(cx, tx, tx + 1), ny = clamp(cy, ty, ty + 1);
      if ((cx - nx) ** 2 + (cy - ny) ** 2 < r * r) return true;
    }
  }
  return false;
}
// X/Y 軸分開移動,撞牆貼齊;回傳是否被擋
// 大位移(如鎚子重擊退)會拆成多個子步逐步檢查,避免一步跳過整格牆體(隧穿)
// r:碰撞半徑,顯式傳入 — 敵人物件本身沒有 .r(半徑存在 ENEMY_TYPES 裡),
// 省略時退回 e.r(玩家物件有 .r);漏傳給敵人會讓 r 變 undefined,
// circleHitsSolid 內比較式對上 NaN 恆為 false,牆壁碰撞直接失效(這正是敵人偶發穿牆的成因)
function moveCircle(e, dx, dy, r) {
  const rad = r ?? e.r;
  const step = 0.4; // 遠小於一格牆體厚度
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / step));
  const sx = dx / n, sy = dy / n;
  let blocked = false;
  for (let k = 0; k < n; k++) {
    if (sx !== 0) {
      if (!circleHitsSolid(e.x + sx, e.y, rad)) e.x += sx;
      else { blocked = true; break; }
    }
    if (sy !== 0) {
      if (!circleHitsSolid(e.x, e.y + sy, rad)) e.y += sy;
      else { blocked = true; break; }
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

// ===== 視覺效果(房主產生後廣播,雙方都套用) =====
function applyFx(f) {
  if (f.k === 'ft') G.floaters.push({ x: f.x, y: f.y, txt: f.txt, color: f.color, t: 0 });
  else if (f.k === 'crack') { if (f.r >= 1) G.cracks.delete(f.i); else G.cracks.set(f.i, f.r); }
  else if (f.k === 'sfx' && SFX[f.s]) SFX[f.s]();
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
  const e = { id: nextEid++, type, x, y, hp, maxhp: hp, dmgMult: elite ? ELITE_CFG.dmgMult : 1,
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
  if (src) {
    const d = Math.max(0.1, dist(src.x, src.y, e.x, e.y));
    let kb = et.boss ? 1.5 : 5;
    if (kbF) kb = et.boss ? kbF * 0.3 : kbF;   // 鎚的大擊退,對 boss 打 3 折
    e.vx += (e.x - src.x) / d * kb; e.vy += (e.y - src.y) / d * kb;
  }
  if (e.hp <= 0) killEnemy(e, src && src.name ? src : null);
}

function killEnemy(e, killer) {
  const i = G.enemies.indexOf(e);
  if (i >= 0) G.enemies.splice(i, 1);
  emitFx({ k: 'sfx', s: 'break_' });
  if (killer) grantXp(killer, (ENEMY_XP[e.type] || 0) * (e.elite ? ELITE_CFG.xpMult : 1));
  // 精英怪(來自精英巢穴):額外保底掉卷軸+光晶,補償比一般怪更強的戰鬥難度
  if (e.elite) { spawnDrop('enh_scroll', 1, e.x, e.y); spawnDrop('lumite', 3, e.x, e.y); }
  // 戰利品:蝕影掉光晶,回饋防守循環;各怪都有機率掉強化卷軸(衝裝來源)
  const SCROLL_RATE = { imp: 0.03, spore: 0.02, hunter: 0.06, spitter: 0.08, bomber: 0.08, phantom: 0.1, breaker: 0.12, abyss: 0.1 };
  if (SCROLL_RATE[e.type] && Math.random() < SCROLL_RATE[e.type]) spawnDrop('enh_scroll', 1, e.x, e.y);
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
  else if (e.type === 'sentinel') {
    spawnDrop('enh_scroll', 2, e.x, e.y);   // 守衛必掉 2 張卷軸
    if (e.home) {
      // 神殿守衛:碎片直接給擊殺者,避免撿不到
      const owner = killer || nearestAlivePlayer(e.x, e.y, 999) || [...G.players.values()][0];
      const shrine = G.shrines.find(s => s.x === e.home.x && s.y === e.home.y);
      if (shrine) shrine.dead = true;
      if (owner) {
        if (addItem(owner, 'shard', 1) > 0) spawnDrop('shard', 1, e.x, e.y);
        msgAll(`⚔️ ${owner.name} 擊敗了石像守衛,取得星核碎片!帶回星核吧!`);
      }
      spawnDrop('gold_ore', 3, e.x, e.y);
    } else {
      spawnDrop('lumite', 4, e.x, e.y);
    }
  }
}

// 爆裂蝕影引信歸零時觸發:範圍內玩家/星核/牆壁一起炸,cfg = { r, dmg, wallDmg, core }
function explodeAt(x, y, cfg) {
  emitFx({ k: 'sfx', s: 'hurt' });
  emitFx({ k: 'ft', x, y: y - 0.3, txt: '💥', color: '#ffb35c' });
  for (const p of G.players.values()) {
    if (p.dead) continue;
    if (dist(x, y, p.x, p.y) < cfg.r) damagePlayer(p, cfg.dmg);
  }
  if (dist(x, y, G.core.x, G.core.y) < cfg.r + 1) {
    G.core.energy = Math.max(0, G.core.energy - cfg.core);
    addFloater(G.core.x, G.core.y - 1, `-${Math.round(cfg.core)} ⚡`, '#ff6b6b');
  }
  const x0 = Math.floor(x - cfg.r), x1 = Math.floor(x + cfg.r);
  const y0 = Math.floor(y - cfg.r), y1 = Math.floor(y + cfg.r);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (dist(x, y, tx + 0.5, ty + 0.5) > cfg.r) continue;
    const o = objAt(tx, ty);
    if (o && OBJ_SOLID[o.type]) {
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
      if (p) { tx = p.x; ty = p.y; targetP = p; } else { tx = core.x; ty = core.y; }
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
        });
        emitFx({ k: 'sfx', s: 'shoot' });
      }
    }

    // 跳撲移動(遠程怪保持距離:太近改往反方向跳)
    if (e.hopT <= 0) {
      if (chasing) {
        e.hopT = et.hopCD * 0.75;
        let ang = Math.atan2(ty - e.y, tx - e.x) + (Math.random() - 0.5) * 0.4;
        if (et.ranged && targetP && dist(e.x, e.y, tx, ty) < 2.8) ang += Math.PI;
        e.vx = Math.cos(ang) * et.speed; e.vy = Math.sin(ang) * et.speed;
      } else {
        e.hopT = et.hopCD * (1.5 + Math.random());
        const ang = Math.random() * TAU;
        e.vx = Math.cos(ang) * et.speed * 0.5; e.vy = Math.sin(ang) * et.speed * 0.5;
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
      blocked = moveCircle(e, e.vx * dt, e.vy * dt, et.r);
    }

    // 被牆擋住的追擊怪會啃牆/啃建築(裂地者有拆牆倍率)
    if (chasing && blocked && e.hitT <= 0) {
      const wm = et.wallMult || 1;
      const ang = Math.atan2(ty - e.y, tx - e.x);
      const fx = Math.floor(e.x + Math.cos(ang) * (et.r + 0.6));
      const fy = Math.floor(e.y + Math.sin(ang) * (et.r + 0.6));
      const info = TILE_INFO[tileAt(fx, fy)];
      const o = objAt(fx, fy);
      if (o && OBJ_SOLID[o.type]) {
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
      core.energy = Math.max(0, core.energy - CORE_CFG.hitDrain);
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
    elem: o.elem || null, owner: o.owner || null, hitSet: o.pierce ? new Set() : null };
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
            hurtEnemy(e, pj.dmg, pj.owner, null, pj.elem);
            if (pj.pierce) pj.hitSet.add(e.id); else { dead = true; }
            if (!pj.pierce) break;
          }
        }
      } else if (pj.from === 'e') {
        for (const p of G.players.values()) {
          if (p.dead || p.iframe > 0) continue;
          if (dist(pj.x, pj.y, p.x, p.y) < p.r + 0.18) {
            damagePlayer(p, pj.dmg);
            dead = true;
            break;
          }
        }
      }
    }
    if (dead) G.projs.splice(i, 1);
  }
}

function damagePlayer(p, amount) {
  if (p.godmode) return; // /power godmode:秘笈開啟的無敵狀態
  // 岩鎧 buff 與護甲相乘(不是相加),兩者都拉滿也不會變成免疫
  const dmg = Math.max(1, Math.round(amount * (1 - bestArmor(p)) * (1 - buffVal(p, 'guard'))));
  p.hp -= dmg; p.iframe = 0.8; p.lastHurt = G.time;
  addFloater(p.x, p.y - 0.6, '-' + dmg, '#ff6b6b');
  emitFx({ k: 'sfx', s: 'hurt' });
  if (p.hp <= 0) {
    p.hp = 0; p.dead = true; p.respawnT = 5;
    p.buffs = {}; p.fish = null; // 死亡清空料理 buff 與釣魚狀態
    msgAll(`💀 ${p.name} 倒下了,5 秒後在星核重生`);
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
  addFloater(p.x, p.y - 0.6, '❤ 已補滿', '#7dff8e');
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
  if (p.dead) return { err: '你已倒下' };
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
  if (p.dead || p.atkCD > 0) return;
  const w = meleeWeaponOf(p);
  p.atkCD = w.cd ?? 0.35; p.swing = w.manual ? 0.22 : 0.22; p.aim = aim; p.action = 'atk';
  const dmg = w.dmg * playerDmgMult(p);
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
  if (p.dead || p.atkCD > 0) return;
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
  const dmg = w.dmg * enhMult(s) * playerDmgMult(p);
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
  if (withDrop && info.drop) spawnDrop(info.drop.id, info.drop.n, x + 0.5, y + 0.5);
  setTile(x, y, T.FLOOR);
  emitFx({ k: 'sfx', s: 'break_' });
}

function doMine(p, x, y) {
  if (p.dead || p.mineCD > 0 || !inMap(x, y)) return;
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
      else spawnDrop(o.type, 1, x + 0.5, y + 0.5);
      setObj(x, y, null);
      emitFx({ k: 'sfx', s: 'break_' });
    }
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
  G.dmg[i] += pick.power * buffMult(p, 'mine') * (1 + TALENTS.miner.val * talRank(p, 'miner'));
  wearItem(p, pick.slot); // 有效敲擊才磨損(tier 不夠的「太硬了」在上面就 return 了)
  emitFx({ k: 'sfx', s: 'mine' });
  if (G.dmg[i] >= info.hp) breakTile(x, y);
  else emitFx({ k: 'crack', i, r: G.dmg[i] / info.hp });
}

// 衝裝(強化卷軸):消耗卷軸嘗試把裝備 +1 級,靠近工作台才能用;失敗只噴卷軸不降級
// 回傳 { ok, lv, fail } 供呼叫端顯示結果;err 字串表示無法執行(不消耗卷軸)
function doEnh(p, slot) {
  if (p.dead) return { err: '你已倒下' };
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
  if (p.dead) return { err: '你已倒下' };
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

function doPlace(p, slot, x, y) {
  if (p.dead || !inMap(x, y)) return;
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
  // 會擋路的東西不能蓋在任何人/怪身上
  const solidPlace = it.placeTile !== undefined || OBJ_SOLID[it.place];
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
    setObj(x, y, o);
  }
  emitFx({ k: 'sfx', s: 'place' });
}

// 農耕:鏟子翻土(不消耗、不扣格數,單純是把地板變農地),右鍵觸發
function doTill(p, x, y) {
  if (p.dead || !inMap(x, y)) return;
  if (dist(p.x, p.y, x + 0.5, y + 0.5) > 3.8) return;
  if (tileAt(x, y) !== T.FLOOR || G.objects.has(idx(x, y))) return;
  setTile(x, y, T.FARMLAND);
  emitFx({ k: 'sfx', s: 'place' });
}

// 農耕:在翻好的農地上種下種子(消耗 1 顆),長熟後見 updateCrops + updatePlayersHost 的自動收成
function doPlant(p, slot, x, y) {
  if (p.dead || !inMap(x, y)) return;
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
  if (p.dead || !inMap(x, y) || p.fish) return;
  if (!infoAt(x, y).liquid) return;
  if (dist(p.x, p.y, x + 0.5, y + 0.5) > 3.8) return;
  p.aim = Math.atan2(y + 0.5 - p.y, x + 0.5 - p.x);
  p.fish = { x: p.x, y: p.y, t: FISH_CFG.timeMin + Math.random() * (FISH_CFG.timeMax - FISH_CFG.timeMin) };
  addFloater(p.x, p.y - 0.6, '🎣 拋竿……', '#7ec8ff');
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
  if (p.dead) return;
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
  if (p.dead) return;
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
  if (p.dead) return;
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
  if (p.dead || dist(p.x, p.y, G.core.x, G.core.y) > 3) return;
  const n = countItem(p, 'lumite');
  if (n <= 0) { addFloater(p.x, p.y - 0.6, '沒有光晶', '#8899aa'); return; }
  const canUse = Math.min(n, Math.ceil((CORE_CFG.maxE - G.core.energy) / CORE_CFG.feed));
  if (canUse <= 0) { addFloater(G.core.x, G.core.y - 1, '星核能量已滿', '#7ef0ff'); return; }
  payCost(p, { lumite: canUse });
  G.core.energy = Math.min(CORE_CFG.maxE, G.core.energy + canUse * CORE_CFG.feed);
  addFloater(G.core.x, G.core.y - 1, `+${canUse * CORE_CFG.feed} ⚡`, '#7ef0ff');
  emitFx({ k: 'sfx', s: 'deposit' });
  msgAll(`💠 ${p.name} 灌入 ${canUse} 顆光晶,星核能量 ${Math.round(G.core.energy)}`);
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
    // 磁吸 + 撿取
    const p = nearestAlivePlayer(d.x, d.y, 2.4);
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
    lumite: '💠 撿到光晶!站在星核旁按 F 灌入能量,或合成火把',
    copper_ore: '🟤 撿到銅礦!蓋工作台→熔爐,煉銅錠做銅裝',
    iron_ore: '⚪ 撿到鐵礦!鐵甲與鐵鎬是深入黑曜區的關鍵',
    gold_ore: '🟡 撿到金礦!金裝是最強裝備',
    shard: '🔷 星核碎片!走到星核旁會自動放入',
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
  msgAll(`📦 ${p.name} 打開了廢墟寶箱!`);
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
  if (p.dead) return;
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
  addFloater(a.x, a.y - 0.6, `❤ ${Math.round(at.productCD)}秒後產出${ITEMS[at.product].name}`, '#7dff8e');
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
    // 不然體型大的牛在一格寬走廊裡會整段跳程貼牆磨,跟隨玩家時卡到不動
    if (moveCircle(a, a.vx * dt, a.vy * dt, at.r)) a.hopT = Math.min(a.hopT, 0.15);
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
    p.iframe -= dt; p.atkCD -= dt; p.mineCD -= dt;
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
    // 脫戰回血
    if (G.time - p.lastHurt > 10 && p.hp < p.maxhp) p.hp = Math.min(p.maxhp, p.hp + 3 * dt);
    // 回春 buff:不受脫戰限制,戰鬥中也持續回血(晶鱗魚湯的價值所在)
    if (p.buffs && p.buffs.regen && p.hp < p.maxhp)
      p.hp = Math.min(p.maxhp, p.hp + p.buffs.regen.value * dt);
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
      msgAll(`🔷 星核碎片 ${G.core.shards}/${CORE_CFG.needShards} 已放入!`);
      emitFx({ k: 'sfx', s: 'deposit' });
      if (G.core.shards >= CORE_CFG.needShards) triggerFinalWave();
    }
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
