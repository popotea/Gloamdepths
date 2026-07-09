// ===== 世界狀態與地圖生成 =====
// 效能重點:地圖用 TypedArray(200×200 僅約 40KB),渲染只處理視野內的格子
const G = {
  tiles: null,          // Uint8Array 地形
  dmg: null,            // Float32Array 挖掘進度
  explored: null,       // Uint8Array 小地圖探索記錄
  objects: new Map(),   // idx -> {type, hp} 已放置物件
  lights: new Map(),    // idx -> 光半徑(地形光 + 物件光)
  players: new Map(),   // id -> player
  myId: 0,
  enemies: [], drops: [], floaters: [], cracks: new Map(), projs: [],
  core: { x: CX + 0.5, y: CY + 0.5, energy: CORE_CFG.maxE, shards: 0 },
  wave: { n: 0, state: 'calm', timer: WAVE_CFG.first, final: false },
  shrines: [],          // [{x,y,dead}]
  playersByName: {},    // 離線好友的背包(以名字為鍵,由房主保存)
  time: 0, seed: 0, over: null, started: false,
  mushCount: 0, warned: {},
};

function idx(x, y) { return y * MAP_W + x; }
function inMap(x, y) { return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H; }
function tileAt(x, y) { return inMap(x, y) ? G.tiles[idx(x, y)] : T.BEDROCK; }
function infoAt(x, y) { return TILE_INFO[tileAt(x, y)]; }
function isSolid(x, y) {
  if (!inMap(x, y)) return true;
  if (TILE_INFO[G.tiles[idx(x, y)]].solid) return true;
  const o = G.objects.get(idx(x, y));
  return !!(o && OBJ_SOLID[o.type]);
}

// 變更地形(自動維護光源/裂痕;房主會廣播給客戶端)
function setTile(x, y, v, fromNet = false) {
  if (!inMap(x, y)) return;
  const i = idx(x, y);
  const old = G.tiles[i];
  if (old === v) return;
  const oldL = TILE_INFO[old].light, newL = TILE_INFO[v].light;
  if (oldL) G.lights.delete(i);
  if (newL) G.lights.set(i, newL);
  G.tiles[i] = v;
  G.dmg[i] = 0;
  G.cracks.delete(i);
  UI.mmDirty = true;
  if (!fromNet && NET.isHost()) NET.sendAll({ t: 'tile', i, v });
}

function objAt(x, y) { return G.objects.get(idx(x, y)) || null; }

// 放置/移除物件(o=null 移除)
function setObj(x, y, o, fromNet = false) {
  const i = idx(x, y);
  const old = G.objects.get(i);
  if (old && OBJ_LIGHT[old.type]) G.lights.delete(i);
  if (o) {
    G.objects.set(i, o);
    if (OBJ_LIGHT[o.type]) G.lights.set(i, OBJ_LIGHT[o.type]);
    if (o.type === 'mushroom') G.mushCount++;
  } else {
    if (old && old.type === 'mushroom') G.mushCount--;
    G.objects.delete(i);
  }
  UI.mmDirty = true;
  if (!fromNet && NET.isHost()) NET.sendAll({ t: 'obj', i, o: o ? { ...o } : null });
}

// 重掃全地圖光源(生成/讀檔/連線初始化後呼叫一次)
function rebuildLights() {
  G.lights.clear();
  for (let i = 0; i < G.tiles.length; i++) {
    const L = TILE_INFO[G.tiles[i]].light;
    if (L) G.lights.set(i, L);
  }
  for (const [i, o] of G.objects) {
    if (OBJ_LIGHT[o.type]) G.lights.set(i, OBJ_LIGHT[o.type]);
  }
}

// 取得某矩形範圍會影響到的光源(含玩家)
function lightSources(x0, y0, x1, y1) {
  const srcs = [];
  for (const p of G.players.values()) {
    if (!p.dead) srcs.push({ x: p.x, y: p.y, r: 5 });
  }
  if (G.core.energy > 0) srcs.push({ x: G.core.x, y: G.core.y, r: 10 });
  for (const [i, r] of G.lights) {
    const lx = (i % MAP_W) + 0.5, ly = ((i / MAP_W) | 0) + 0.5;
    if (lx > x0 - 8 && lx < x1 + 8 && ly > y0 - 8 && ly < y1 + 8) srcs.push({ x: lx, y: ly, r });
  }
  return srcs;
}
function lightAt(srcs, x, y) {
  let m = 0;
  for (const s of srcs) {
    const v = 1 - Math.hypot(x - s.x, y - s.y) / s.r;
    if (v > m) m = v;
  }
  return m;
}
// 單點光照(生怪判定用,直接掃全部光源,呼叫頻率低)
function lightAtPoint(x, y) {
  return lightAt(lightSources(x - 0.1, y - 0.1, x + 0.1, y + 0.1), x, y);
}

// ===== 地圖生成 =====
function genWorld(seed) {
  const rnd = mulberry32(seed);
  G.seed = seed;
  G.tiles = new Uint8Array(MAP_W * MAP_H);
  G.dmg = new Float32Array(MAP_W * MAP_H);
  G.explored = new Uint8Array(MAP_W * MAP_H);
  G.objects.clear(); G.lights.clear(); G.cracks.clear();
  G.enemies = []; G.drops = []; G.floaters = []; G.projs = [];
  G.shrines = []; G.mushCount = 0; G.warned = {};
  G.core = { x: CX + 0.5, y: CY + 0.5, energy: CORE_CFG.maxE, shards: 0 };
  G.wave = { n: 0, state: 'calm', timer: WAVE_CFG.first, final: false };
  G.time = 0; G.over = null;

  // 1) 細胞自動機長洞穴
  let a = new Uint8Array(MAP_W * MAP_H);
  for (let i = 0; i < a.length; i++) a[i] = rnd() < 0.46 ? 1 : 0;
  for (let it = 0; it < 4; it++) {
    const b = new Uint8Array(a.length);
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= MAP_W || yy >= MAP_H || a[idx(xx, yy)]) n++;
      }
      b[idx(x, y)] = n >= 5 ? 1 : 0;
    }
    a = b;
  }

  // 2) 依距離分區指定材質
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const d = Math.hypot(x + 0.5 - CX, y + 0.5 - CY);
    let t;
    if (d >= 96) t = T.BEDROCK;
    else if (d < 6) t = d < 3.5 ? T.GLOW : T.FLOOR;
    else if (!a[idx(x, y)]) t = T.FLOOR;
    else t = d < 42 ? T.DIRT : d < 72 ? T.STONE : T.OBSIDIAN;
    G.tiles[idx(x, y)] = t;
  }

  // 3) 保底隧道:從中心往外挖 12 條,確保各區可達
  for (let k = 0; k < 12; k++) {
    let ang = rnd() * TAU;
    for (let r = 5; r < 92; r += 0.7) {
      ang += (rnd() - 0.5) * 0.25;
      const px = CX + Math.cos(ang) * r, py = CY + Math.sin(ang) * r;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const tx = Math.floor(px + dx * 0.7), ty = Math.floor(py + dy * 0.7);
        if (inMap(tx, ty) && G.tiles[idx(tx, ty)] !== T.BEDROCK && G.tiles[idx(tx, ty)] !== T.GLOW &&
            TILE_INFO[G.tiles[idx(tx, ty)]].solid) G.tiles[idx(tx, ty)] = T.FLOOR;
      }
    }
  }

  // 4) 礦脈(隨機漫步覆蓋在對應材質的牆上)
  const vein = (count, len0, len1, host, ore, dMin, dMax) => {
    for (let n = 0; n < count; n++) {
      const ang = rnd() * TAU, d = dMin + rnd() * (dMax - dMin);
      let x = Math.floor(CX + Math.cos(ang) * d), y = Math.floor(CY + Math.sin(ang) * d);
      const len = len0 + Math.floor(rnd() * (len1 - len0 + 1));
      for (let s = 0; s < len; s++) {
        if (inMap(x, y) && host.includes(G.tiles[idx(x, y)])) G.tiles[idx(x, y)] = ore;
        x += Math.floor(rnd() * 3) - 1; y += Math.floor(rnd() * 3) - 1;
      }
    }
  };
  vein(90, 3, 6, [T.DIRT], T.COPPER, 8, 42);
  vein(70, 3, 6, [T.STONE], T.IRON, 42, 72);
  vein(55, 3, 5, [T.OBSIDIAN], T.GOLD, 72, 94);
  vein(120, 2, 4, [T.DIRT, T.STONE, T.OBSIDIAN], T.LUMITE, 8, 94);
  vein(70, 3, 5, [T.DIRT], T.ROOT, 8, 42);
  // 砂礫:泥土區成片出現(比礦脈粗胖許多),打散大範圍同色泥土牆的單調感
  vein(50, 8, 16, [T.DIRT], T.GRAVEL, 8, 42);
  vein(90, 4, 8, [T.DIRT, T.STONE], T.COAL, 8, 72);
  vein(28, 2, 4, [T.OBSIDIAN], T.DIAMOND, 72, 94);

  // 5) 螢光蘑菇(泥土區地面)
  for (let n = 0; n < 300 && G.mushCount < 120; n++) {
    const ang = rnd() * TAU, d = 8 + rnd() * 32;
    const x = Math.floor(CX + Math.cos(ang) * d), y = Math.floor(CY + Math.sin(ang) * d);
    if (inMap(x, y) && G.tiles[idx(x, y)] === T.FLOOR && !G.objects.has(idx(x, y))) {
      G.objects.set(idx(x, y), { type: 'mushroom' });
      G.mushCount++;
    }
  }

  // 6) 三座守衛神殿(外圈,120 度間隔)
  const baseAng = rnd() * TAU;
  for (let k = 0; k < 3; k++) {
    const ang = baseAng + k * TAU / 3;
    const sx = Math.floor(CX + Math.cos(ang) * 80), sy = Math.floor(CY + Math.sin(ang) * 80);
    const toCenter = Math.atan2(CY - sy, CX - sx);
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
      const x = sx + dx, y = sy + dy;
      if (!inMap(x, y) || G.tiles[idx(x, y)] === T.BEDROCK) continue;
      const d = Math.hypot(dx, dy);
      if (d <= 3) { G.tiles[idx(x, y)] = T.FLOOR; G.objects.delete(idx(x, y)); }
      else if (d <= 4.6) {
        // 朝地圖中心留一個開口
        if (angDiff(Math.atan2(dy, dx), toCenter) > 0.55) G.tiles[idx(x, y)] = T.OBSIDIAN;
        else { G.tiles[idx(x, y)] = T.FLOOR; G.objects.delete(idx(x, y)); }
      }
    }
    G.shrines.push({ x: sx + 0.5, y: sy + 0.5, dead: false });
  }

  rebuildLights();
}

function zoneOf(x, y) {
  const d = Math.hypot(x - CX, y - CY);
  return d < 42 ? 0 : d < 72 ? 1 : 2;
}

// ===== RLE 壓縮(存檔 / 連線初始傳輸用) =====
function rleEnc(arr) {
  const out = [];
  let v = arr[0], c = 1;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] === v && c < 65535) c++;
    else { out.push(v, c); v = arr[i]; c = 1; }
  }
  out.push(v, c);
  return out;
}
function rleDec(data, len, Type) {
  const arr = new Type(len);
  let p = 0;
  for (let i = 0; i < data.length; i += 2) {
    const v = data[i], c = data[i + 1];
    arr.fill(v, p, p + c);
    p += c;
  }
  return arr;
}
