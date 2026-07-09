// ===== 實體:玩家、敵人、掉落物、戰鬥、挖掘、放置 =====
let nextEid = 1, nextDid = 1;

const PLAYER_COLORS = ['#ffd97a', '#7ad0ff', '#8dff9e', '#ff9ecb'];

function makePlayer(id, name) {
  return {
    id, name,
    x: G.core.x + (id % 2 ? 1.5 : -1.5), y: G.core.y + (id >= 2 ? 1.5 : -1.5),
    r: 0.35, hp: 100, maxhp: 100, aim: 0,
    inv: makeStartInv(), sel: 0,
    swing: 0, atkCD: 0, mineCD: 0, iframe: 0, lastHurt: -99,
    dead: false, respawnT: 0, invDirty: true,
  };
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
function moveCircle(e, dx, dy) {
  let blocked = false;
  if (dx !== 0) {
    if (!circleHitsSolid(e.x + dx, e.y, e.r)) e.x += dx;
    else blocked = true;
  }
  if (dy !== 0) {
    if (!circleHitsSolid(e.x, e.y + dy, e.r)) e.y += dy;
    else blocked = true;
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
function spawnEnemy(type, x, y, extra = {}) {
  const e = { id: nextEid++, type, x, y, hp: ENEMY_TYPES[type].hp,
    vx: 0, vy: 0, hopT: Math.random(), hitT: 0, wave: false, ...extra };
  G.enemies.push(e);
  return e;
}

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
      else if (e.hp < et.hp) e.hp = Math.min(et.hp, e.hp + 10 * dt);
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
          explodeAt(e.x, e.y, et.explode);
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
          dmg: et.ranged.dmg, from: 'e', ttl: 1.4, kind: 0,
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
      blocked = moveCircle(e, e.vx * dt, e.vy * dt);
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
        o.hp -= et.dmg * 0.5 * wm;
        emitFx({ k: 'ft', x: fx + 0.5, y: fy + 0.5, txt: '💥', color: '#ff8888' });
        if (o.hp <= 0) { setObj(fx, fy, null); emitFx({ k: 'sfx', s: 'break_' }); }
        e.hitT = 1.0;
      } else if (info.solid && info.hp !== Infinity) {
        const ii = idx(fx, fy);
        G.dmg[ii] += et.dmg * 0.8 * wm;
        emitFx({ k: 'crack', i: ii, r: G.dmg[ii] / info.hp });
        if (G.dmg[ii] >= info.hp) breakTile(fx, fy, false);
        e.hitT = 0.8;
      }
    }

    // 碰撞傷害玩家
    for (const p of G.players.values()) {
      if (p.dead || p.iframe > 0) continue;
      if (dist(e.x, e.y, p.x, p.y) < et.r + p.r + 0.05) {
        damagePlayer(p, et.dmg);
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

function damagePlayer(p, amount) {
  const dmg = Math.max(1, Math.round(amount * (1 - bestArmor(p))));
  p.hp -= dmg; p.iframe = 0.8; p.lastHurt = G.time;
  addFloater(p.x, p.y - 0.6, '-' + dmg, '#ff6b6b');
  emitFx({ k: 'sfx', s: 'hurt' });
  if (p.hp <= 0) {
    p.hp = 0; p.dead = true; p.respawnT = 5;
    msgAll(`💀 ${p.name} 倒下了,5 秒後在星核重生`);
  }
}

// ===== 玩家動作(房主端執行;客戶端透過網路請求) =====
function doSwing(p, aim) {
  if (p.dead || p.atkCD > 0) return;
  p.atkCD = 0.35; p.swing = 0.22; p.aim = aim;
  const dmg = bestSword(p).dmg;
  for (const e of [...G.enemies]) {
    const d = dist(p.x, p.y, e.x, e.y);
    if (d < 1.8 + ENEMY_TYPES[e.type].r && angDiff(Math.atan2(e.y - p.y, e.x - p.x), aim) < 1.1) {
      hurtEnemy(e, dmg, p);
    }
  }
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
  p.swing = 0.2;
  const i = idx(x, y);
  const o = G.objects.get(i);
  const info = TILE_INFO[G.tiles[i]];
  if (o && o.type !== 'mushroom' && !info.solid) {
    // 敲回收已放置物件
    o.hp = (o.hp ?? OBJ_HP[o.type]) - bestPick(p).power * 4;
    emitFx({ k: 'sfx', s: 'mine' });
    if (o.hp <= 0) {
      setObj(x, y, null);
      spawnDrop(o.type, 1, x + 0.5, y + 0.5);
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
  G.dmg[i] += pick.power;
  emitFx({ k: 'sfx', s: 'mine' });
  if (G.dmg[i] >= info.hp) breakTile(x, y);
  else emitFx({ k: 'crack', i, r: G.dmg[i] / info.hp });
}

function doPlace(p, slot, x, y) {
  if (p.dead || !inMap(x, y)) return;
  const s = p.inv[slot];
  if (!s) return;
  const it = ITEMS[s.id];
  if (!it.place && it.placeTile === undefined) return;
  if (dist(p.x, p.y, x + 0.5, y + 0.5) > 3.8) return;
  if (tileAt(x, y) !== T.FLOOR || G.objects.has(idx(x, y))) return;
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
  else setObj(x, y, { type: it.place, hp: OBJ_HP[it.place] });
  emitFx({ k: 'sfx', s: 'place' });
}

function doEat(p, slot) {
  if (p.dead) return;
  const s = p.inv[slot];
  if (!s || !ITEMS[s.id].food || p.hp >= p.maxhp) return;
  p.hp = Math.min(p.maxhp, p.hp + ITEMS[s.id].food);
  addFloater(p.x, p.y - 0.6, '+' + ITEMS[s.id].food, '#7dff8e');
  emitFx({ k: 'sfx', s: 'eat' });
  consumeSlot(p, slot);
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
function spawnDrop(item, n, x, y) {
  G.drops.push({
    id: nextDid++, item, n, x, y,
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
        const left = addItem(p, d.item, d.n);
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

// ===== 光塔自動攻擊(房主) =====
let towerTick = 0;
function updateTowers(dt) {
  towerTick -= dt;
  if (towerTick > 0) return;
  towerTick = 1.2;
  for (const [i, o] of G.objects) {
    if (o.type !== 'tower') continue;
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

// ===== 玩家共通狀態(房主) =====
function updatePlayersHost(dt) {
  for (const p of G.players.values()) {
    p.iframe -= dt; p.atkCD -= dt; p.mineCD -= dt;
    if (p.swing > 0) p.swing -= dt;
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
    // 脫戰回血
    if (G.time - p.lastHurt > 10 && p.hp < p.maxhp) p.hp = Math.min(p.maxhp, p.hp + 3 * dt);
    // 走過蘑菇自動採集
    const o = objAt(Math.floor(p.x), Math.floor(p.y));
    if (o && o.type === 'mushroom') {
      if (addItem(p, 'mushroom', 1) === 0) {
        setObj(Math.floor(p.x), Math.floor(p.y), null);
        emitFx({ k: 'sfx', s: 'pickup' });
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
