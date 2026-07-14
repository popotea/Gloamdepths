// ===== 世界狀態與地圖生成 =====
// 效能重點:地圖用 TypedArray(280×280 僅約 77KB),渲染只處理視野內的格子
const G = {
  tiles: null,          // Uint8Array 地形
  dmg: null,            // Float32Array 挖掘進度
  explored: null,       // Uint8Array 小地圖探索記錄
  objects: new Map(),   // idx -> {type, hp} 已放置物件
  // 塔/巢穴的獨立索引(idx 集合):updateTowers/updateArcherTowers/updateNests 每幀都要找同類物件,
  // 直接掃 G.objects 要連蘑菇/火把等大量無關物件一起看過一遍;setObj 增減物件時同步維護,
  // 讓這幾個 tick 函式只掃自己關心的那一小撮,不受地圖上其他建築/採集物數量影響
  towerIdx: new Set(), archerTowerIdx: new Set(), nestIdx: new Set(), cropIdx: new Set(),
  minerIdx: new Set(), beltIdx: new Set(), // 自動採礦機/傳輸帶的獨立索引(updateMiners/updateBelts 用,不掃全部 objects)
  smelterIdx: new Set(), // 自動熔煉爐索引(updateSmelters 用)
  frostIdx: new Set(),   // 凜鈴塔索引(updateFrostTowers 用)
  decoyIdx: new Set(),   // 誘光罐索引(updateEnemies 的目標選擇每敵每幀要查最近誘餌,掃全 objects 太貴)
  cannonIdx: new Set(), multiIdx: new Set(), sniperIdx: new Set(), // 塔類第二批:加農塔/連弩塔/重砲塔索引
  lights: new Map(),    // idx -> 光半徑(地形光 + 物件光)
  players: new Map(),   // id -> player
  myId: 0,
  enemies: [], drops: [], floaters: [], cracks: new Map(), projs: [],
  hitFx: [],             // 打擊特效(命中閃光,純視覺、client/host 各自倒數,不進存檔)
  emoteFx: [],           // 快速手勢特效(頭上的圖示氣泡,純視覺、client/host 各自倒數,不進存檔)
  animals: [],          // 被動生物(牲畜),房主模擬、快照同步,跟 enemies 分開的一套

  core: { x: CX + 0.5, y: CY + 0.5, energy: CORE_CFG.maxE, shards: 0, shield: 0 },
  wave: { n: 0, state: 'calm', timer: WAVE_CFG.first, final: false },
  shrines: [],          // [{x,y,dead,boss}]  boss = ENEMY_TYPES 的 key,固定分配三座神殿各自守哪隻 Boss
  traders: [],          // [{x,y}] 中層區域固定攤位,不會動,不進 snap(靠 init/存讀檔同步)
  altars: [],           // [{x,y,dead,zone}] 深怪祭壇(迷你王據點),資料/實體分離同神殿——實際守衛敵人由 spawnAltarGuardians() 另外生成
  questNpcs: [],        // [{x,y,npc}] 劇情 NPC 固定攤位(不會動),npc = QUEST_NPCS 的 key
  quests: { active: {}, done: {} }, // active: {questId:{kills}} 只有擊殺型任務要記錄;done: {questId:true}
  playersByName: {},    // 離線好友的背包(以名字為鍵,由房主保存)
  time: 0, seed: 0, over: null, started: false,
  mushCount: 0, warned: {},
  paused: false,  // 只有單機模式能暫停(多人共享同一個模擬,暫停會卡住其他人)
  killCount: 0,   // 統計面板用:全隊累計擊殺數(killEnemy 累加,存讀檔保留)
  difficulty: 'normal', // DIFFICULTY_CFG 的 key,開新世界時選定;只影響房主模擬,不用同步給客戶端
  unsealed: false,      // 第五區域「淵核區」是否已解封(通關後 true);存讀檔保留,重連靠 init 同步
  bestiary: {},          // 圖鑑:擊殺過的敵人種類(type -> true),全隊共享、存讀檔保留
  achv: {},               // 成就:達成過的里程碑(id -> true,見 ACHIEVEMENTS),全隊共享、存讀檔保留
};

function idx(x, y) { return y * MAP_W + x; }
function inMap(x, y) { return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H; }
function tileAt(x, y) { return inMap(x, y) ? G.tiles[idx(x, y)] : T.BEDROCK; }
function infoAt(x, y) { return TILE_INFO[tileAt(x, y)]; }
// forEnemy:敵人/動物視角的固體判定——光簾閘門(gate)只對牠們算牆,玩家與投射物自由穿過。
// 玩家端(含客戶端本地預測)一律不傳=照舊,雙端行為天然一致
function isSolid(x, y, forEnemy = false) {
  if (!inMap(x, y)) return true;
  if (TILE_INFO[G.tiles[idx(x, y)]].solid) return true;
  const o = G.objects.get(idx(x, y));
  return !!(o && (OBJ_SOLID[o.type] || (forEnemy && o.type === 'gate')));
}

// 投射物專用的阻擋判定:low 地形(水面/矮圍籬)擋得住人卻擋不住飛行物,其餘同 isSolid
function projHitsWall(x, y) {
  if (!inMap(x, y)) return true;
  const info = TILE_INFO[G.tiles[idx(x, y)]];
  if (info.solid && !info.low) return true;
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

const TOWER_IDX_SETS = { tower: 'towerIdx', archer_tower: 'archerTowerIdx', nest: 'nestIdx', crop: 'cropIdx', auto_miner: 'minerIdx', belt: 'beltIdx', auto_smelter: 'smelterIdx', frost_tower: 'frostIdx', decoy: 'decoyIdx',
  cannon_tower: 'cannonIdx', multi_tower: 'multiIdx', sniper_tower: 'sniperIdx' };
// 放置/移除物件(o=null 移除)
function setObj(x, y, o, fromNet = false) {
  const i = idx(x, y);
  const old = G.objects.get(i);
  if (old && OBJ_LIGHT[old.type]) G.lights.delete(i);
  if (old) { const key = TOWER_IDX_SETS[old.type]; if (key) G[key].delete(i); }
  if (o) {
    G.objects.set(i, o);
    if (OBJ_LIGHT[o.type]) G.lights.set(i, OBJ_LIGHT[o.type]);
    if (o.type === 'mushroom') G.mushCount++;
    const key = TOWER_IDX_SETS[o.type]; if (key) G[key].add(i);
  } else {
    if (old && old.type === 'mushroom') G.mushCount--;
    G.objects.delete(i);
  }
  UI.mmDirty = true;
  if (!fromNet && NET.isHost()) NET.sendAll({ t: 'obj', i, o: o ? { ...o } : null });
}

// 解封淵核區(第五區域):把整圈封印牆 SEAL 換成 FLOOR,玩家就能挖進去了。
// 通關事件觸發(房主呼叫並廣播 { t:'unseal' } 讓客戶端也跑一次);存讀檔靠 G.unsealed 記憶,
// 直接改 G.tiles(不逐格 setTile 廣播,避免幾百格封包)並清掉封印光源、重掃光照。
function unsealVoidZone(fromNet = false) {
  if (G.unsealed) return;
  G.unsealed = true;
  for (let i = 0; i < G.tiles.length; i++) {
    if (G.tiles[i] === T.SEAL) { G.tiles[i] = T.FLOOR; G.lights.delete(i); G.dmg[i] = 0; G.cracks.delete(i); }
  }
  UI.mmDirty = true;
  if (!fromNet && NET.isHost()) NET.sendAll({ t: 'unseal' });
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
  G.towerIdx.clear(); G.archerTowerIdx.clear(); G.nestIdx.clear(); G.cropIdx.clear();
  G.minerIdx.clear(); G.beltIdx.clear(); G.smelterIdx.clear(); G.frostIdx.clear(); G.decoyIdx.clear();
  G.cannonIdx.clear(); G.multiIdx.clear(); G.sniperIdx.clear();
  G.enemies = []; G.drops = []; G.floaters = []; G.projs = []; G.animals = []; G.hitFx = [];
  G.shrines = []; G.traders = []; G.altars = []; G.questNpcs = []; G.mushCount = 0; G.warned = {}; G.killCount = 0;
  // 任務日誌:每個新世界重新開始收集(跟 achv/bestiary 同一套設計語言);requires:null 的擊殺型任務
  // 一開局就要開始累計進度,所以在這裡直接 seed 一筆(其餘擊殺型任務——目前沒有——會在上一關完成時才 seed)
  G.quests = { active: {}, done: {} };
  for (const q of QUESTS) if (q.type === 'kill' && !q.requires) G.quests.active[q.id] = { kills: 0 };
  G.bestiary = {}; G.achv = {}; G.emoteFx = [];
  G.core = { x: CX + 0.5, y: CY + 0.5, energy: CORE_CFG.maxE, shards: 0, shield: 0 };
  G.wave = { n: 0, state: 'calm', timer: WAVE_CFG.first, final: false };
  G.time = 0; G.over = null; G.won = false;

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
  // 第五區域「淵核區」(obsidian~voidOut)在最外圈,外邊界 BEDROCK 推到 ZONE_R.voidOut;
  // sealIn~sealOut 是「封印環」——一圈強制填滿的 SEAL 牆(不看細胞自動機,才不會有洞讓玩家通關前溜進去),通關事件才解除
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const d = Math.hypot(x + 0.5 - CX, y + 0.5 - CY);
    let t;
    // 地圖最外 2 格強制基岩:淵核區外邊界比地圖半寬(MAP_W/2)大,上下左右方向會直接撞地圖邊緣,
    // 用這圈基岩收邊,不會露出「地圖被切平」的直邊
    if (x < 2 || y < 2 || x >= MAP_W - 2 || y >= MAP_H - 2) t = T.BEDROCK;
    else if (d >= ZONE_R.voidOut) t = T.BEDROCK;
    else if (d >= ZONE_R.sealIn && d < ZONE_R.sealOut) t = T.SEAL; // 封印環:完整封閉,擋住淵核區
    else if (d < 8) t = d < 5 ? T.GLOW : T.FLOOR;
    else if (!a[idx(x, y)]) t = T.FLOOR;
    else t = d < ZONE_R.dirt ? T.DIRT : d < ZONE_R.stone ? T.STONE : d < ZONE_R.obsidian ? T.OBSIDIAN : T.VOIDROCK;
    G.tiles[idx(x, y)] = t;
  }

  // 3) 保底隧道:從中心往外挖 12 條,確保各區可達
  for (let k = 0; k < 12; k++) {
    let ang = rnd() * TAU;
    for (let r = 7; r < 129; r += 0.7) {
      ang += (rnd() - 0.5) * 0.25;
      const px = CX + Math.cos(ang) * r, py = CY + Math.sin(ang) * r;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const tx = Math.floor(px + dx * 0.7), ty = Math.floor(py + dy * 0.7);
        if (inMap(tx, ty) && G.tiles[idx(tx, ty)] !== T.BEDROCK && G.tiles[idx(tx, ty)] !== T.GLOW &&
            TILE_INFO[G.tiles[idx(tx, ty)]].solid) G.tiles[idx(tx, ty)] = T.FLOOR;
      }
    }
  }

  // 3.5) 幽光水池(釣魚點):只挖在開闊地——水池外圈一圈必須全是地板才動工,
  // 走路的人永遠繞得過去,不會把保底隧道或礦區通道堵死(這是水池生成最容易出的 bug)
  for (let n = 0; n < POI_CFG.pools; n++) {
    for (let tries = 0; tries < 40; tries++) {
      const ang = rnd() * TAU, d = 20 + rnd() * 98;
      const cx = Math.floor(CX + Math.cos(ang) * d), cy = Math.floor(CY + Math.sin(ang) * d);
      const r = 1.6 + rnd() * 1.2; // 半徑 1.6~2.8 格的小圓池
      let ok = true;
      const R = Math.ceil(r + 1.5);
      for (let dy = -R; dy <= R && ok; dy++) for (let dx = -R; dx <= R && ok; dx++) {
        if (Math.hypot(dx, dy) > r + 1.4) continue; // 只檢查池體+外圈一圈
        const x = cx + dx, y = cy + dy;
        if (!inMap(x, y) || G.tiles[idx(x, y)] !== T.FLOOR) ok = false;
      }
      if (!ok) continue;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        if (Math.hypot(dx, dy) <= r) G.tiles[idx(cx + dx, cy + dy)] = T.WATER;
      }
      break;
    }
  }

  // 4) 礦物分布(Core Keeper 式):主要金屬礦以「礦床」集中成塊出現,
  //    讓自動採礦機+傳輸帶+軌道的道鏈有意義——一台機器守著一塊礦床能連採一陣子,再用軌道把礦運回基地;
  //    另外保留少量細礦脈當「探索途中的零星收穫」,鼓勵玩家四處挖。
  //
  // vein=細礦脈(隨機漫步,零星散布):探索沿途的小驚喜
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
  // deposit=礦床(集中成塊):用數顆重疊的子圓聯集出不規則塊狀,填滿範圍內的對應母岩。
  // 每塊約 20~55 格同種礦,是「值得架採礦機」的量級。回傳實際生成的礦床中心(給礦床標記用)。
  const depositCenters = []; // [{x,y,ore}] 記錄大礦床位置,之後可在小地圖標記
  const deposit = (count, rMin, rMax, host, ore, dMin, dMax) => {
    for (let n = 0; n < count; n++) {
      let placed = false;
      for (let tries = 0; tries < 12 && !placed; tries++) {
        const ang = rnd() * TAU, d = dMin + rnd() * (dMax - dMin);
        const cx = Math.floor(CX + Math.cos(ang) * d), cy = Math.floor(CY + Math.sin(ang) * d);
        if (!inMap(cx, cy) || !host.includes(G.tiles[idx(cx, cy)])) continue; // 中心必須落在對應母岩上
        // 3~5 顆子圓聯集成不規則團塊
        const blobs = 3 + Math.floor(rnd() * 3);
        let count2 = 0;
        for (let b = 0; b < blobs; b++) {
          const br = rMin + rnd() * (rMax - rMin);
          const ox = cx + Math.floor((rnd() - 0.5) * rMax * 1.6);
          const oy = cy + Math.floor((rnd() - 0.5) * rMax * 1.6);
          const R = Math.ceil(br);
          for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
            if (dx * dx + dy * dy > br * br) continue;
            const x = ox + dx, y = oy + dy;
            if (inMap(x, y) && host.includes(G.tiles[idx(x, y)])) { G.tiles[idx(x, y)] = ore; count2++; }
          }
        }
        if (count2 > 0) { depositCenters.push({ x: cx, y: cy, ore }); placed = true; }
      }
    }
  };
  // 主要金屬礦=礦床(集中),各分布在自己的區域深度;數量少但每塊肥
  // 地圖放大批(2026-07-15):distance 參數跟著 ZONE_R 等比例縮放;count 參數 ×~1.9(地圖面積放大倍率),
  // 讓放大後的地圖維持跟原本差不多的礦物密度(單純放大距離不加數量,只會讓資源被拉得更稀疏)
  deposit(19, 2.4, 3.8, [T.DIRT], T.COPPER, 17, 56);
  deposit(17, 2.4, 3.8, [T.STONE], T.IRON, 62, 98);
  deposit(13, 2.0, 3.4, [T.OBSIDIAN], T.GOLD, 104, 129);
  deposit(9,  1.8, 2.8, [T.OBSIDIAN], T.DIAMOND, 109, 130);
  deposit(9,  1.6, 2.6, [T.DIRT, T.STONE, T.OBSIDIAN], T.LUMITE, 20, 126); // 光晶小礦床,供採礦機燃料
  deposit(11, 2.0, 3.2, [T.DIRT, T.STONE], T.COAL, 17, 98);
  // 零星細礦脈:探索沿途的小驚喜,量少不足以養採礦機,但夠早期起步
  vein(42, 2, 4, [T.DIRT], T.COPPER, 11, 59);
  vein(34, 2, 4, [T.STONE], T.IRON, 59, 101);
  vein(27, 2, 3, [T.OBSIDIAN], T.GOLD, 101, 132);
  vein(171, 2, 4, [T.DIRT, T.STONE, T.OBSIDIAN], T.LUMITE, 11, 132); // 光晶保持零星散布(到處撿得到,才餵得起機器)
  vein(133, 3, 5, [T.DIRT], T.ROOT, 11, 59);
  // 砂礫:泥土區成片出現(比礦脈粗胖許多),打散大範圍同色泥土牆的單調感
  vein(95, 8, 16, [T.DIRT], T.GRAVEL, 11, 59);
  vein(76, 3, 6, [T.DIRT, T.STONE], T.COAL, 11, 101);
  vein(19, 2, 3, [T.OBSIDIAN], T.DIAMOND, 104, 132);
  // 淵核區(第五區域):礦床更肥更集中,呼應「更深區域更好的礦物」(通關解封後才採得到)
  deposit(15, 2.2, 3.4, [T.VOIDROCK], T.DIAMOND, 137, 158);
  deposit(11, 2.0, 3.0, [T.VOIDROCK], T.LUMITE, 137, 158);
  G.depositCenters = depositCenters;

  // 5) 螢光蘑菇(泥土區地面):count 上限跟著地圖放大批(×1.9)一起放大,維持密度
  for (let n = 0; n < 570 && G.mushCount < 228; n++) {
    const ang = rnd() * TAU, d = 11 + rnd() * 45;
    const x = Math.floor(CX + Math.cos(ang) * d), y = Math.floor(CY + Math.sin(ang) * d);
    if (inMap(x, y) && G.tiles[idx(x, y)] === T.FLOOR && !G.objects.has(idx(x, y))) {
      G.objects.set(idx(x, y), { type: 'mushroom' });
      G.mushCount++;
    }
  }

  // 6) 三座守衛神殿(外圈,120 度間隔),各自固定分配不同屬性 Boss(呼應元素相剋系統)
  // 火系/冰系/穿牆系三隻新 Boss 已全數上線
  const SHRINE_BOSSES = ['fire_boss', 'frost_boss', 'void_boss'];
  const baseAng = rnd() * TAU;
  for (let k = 0; k < 3; k++) {
    const ang = baseAng + k * TAU / 3;
    const sx = Math.floor(CX + Math.cos(ang) * 112), sy = Math.floor(CY + Math.sin(ang) * 112);
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
    G.shrines.push({ x: sx + 0.5, y: sy + 0.5, dead: false, boss: SHRINE_BOSSES[k] });
  }

  // 6.5) NPC 商人:中層區域(zone 1,距中心 dirt~stone 格)隨機找一格空地板放置
  for (let n = 0; n < TRADER_CFG.count; n++) {
    for (let tries = 0; tries < 40; tries++) {
      const ang = rnd() * TAU, d = ZONE_R.dirt + rnd() * (ZONE_R.stone - ZONE_R.dirt); // 對應 zoneOf() 的 zone 1 範圍
      const x = Math.floor(CX + Math.cos(ang) * d), y = Math.floor(CY + Math.sin(ang) * d);
      if (!inMap(x, y) || G.tiles[idx(x, y)] !== T.FLOOR || G.objects.has(idx(x, y))) continue;
      G.traders.push({ x: x + 0.5, y: y + 0.5 });
      break;
    }
  }

  // 6.6) 劇情 NPC:兩位固定站在近距離的據點(zone0~zone1 邊界,方便早期就找到、之後回頭交任務)
  for (const npcKey of Object.keys(QUEST_NPCS)) {
    for (let tries = 0; tries < 40; tries++) {
      const ang = rnd() * TAU, d = ZONE_R.dirt * 0.5 + rnd() * (ZONE_R.dirt * 0.6);
      const x = Math.floor(CX + Math.cos(ang) * d), y = Math.floor(CY + Math.sin(ang) * d);
      if (!inMap(x, y) || G.tiles[idx(x, y)] !== T.FLOOR || G.objects.has(idx(x, y))) continue;
      if (dist(x, y, G.core.x, G.core.y) < 14) continue;
      G.questNpcs.push({ x: x + 0.5, y: y + 0.5, npc: npcKey });
      break;
    }
  }

  // 6.7) 深怪祭壇:小型迷你王據點(呼應地圖放大批——放大後的地圖需要更多「值得走過去」的據點)。
  // 只放在 zone1~zone2(石岩/黑曜),清出一塊小空地+一圈石環當標記;守衛實體不在這裡生成,
  // 只存座標/生死資料,比照神殿的「資料/實體分離」模式,實際敵人由 spawnAltarGuardians()(game.js)另外生成
  for (let n = 0; n < ALTAR_CFG.count; n++) {
    for (let tries = 0; tries < 30; tries++) {
      const ang = rnd() * TAU, d = ZONE_R.dirt + rnd() * (ZONE_R.obsidian - ZONE_R.dirt);
      const cx = Math.floor(CX + Math.cos(ang) * d), cy = Math.floor(CY + Math.sin(ang) * d);
      if (!inMap(cx, cy) || dist(cx, cy, CX, CY) < 20) continue;
      let ok = true;
      for (let dy = -3; dy <= 3 && ok; dy++) for (let dx = -3; dx <= 3 && ok; dx++) {
        const x = cx + dx, y = cy + dy;
        if (!inMap(x, y) || G.tiles[idx(x, y)] === T.BEDROCK || dist(x, y, G.core.x, G.core.y) < 20) ok = false;
      }
      if (!ok) continue;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const dd = Math.hypot(dx, dy);
        const x = cx + dx, y = cy + dy;
        if (dd <= 2.2) { G.tiles[idx(x, y)] = T.FLOOR; G.objects.delete(idx(x, y)); }
        else if (dd <= 3) G.tiles[idx(x, y)] = T.STONEWALL; // 一圈石環,標記出「這裡不一樣」
      }
      const zone = Math.min(2, Math.max(1, zoneOf(cx + 0.5, cy + 0.5))); // 夾在 zone1~zone2,邊界誤差保底不落到 zone0
      G.altars.push({ x: cx + 0.5, y: cy + 0.5, dead: false, zone });
      break;
    }
  }

  // 7) 廢墟(石磚小房+寶箱):在各區隨機找地板挖出 3x3 石磚房間,中央放寶箱
  for (let n = 0; n < POI_CFG.ruins; n++) {
    for (let tries = 0; tries < 30; tries++) {
      const ang = rnd() * TAU, d = 14 + rnd() * 115;
      const cx = Math.floor(CX + Math.cos(ang) * d), cy = Math.floor(CY + Math.sin(ang) * d);
      if (!inMap(cx, cy) || dist(cx, cy, CX, CY) < 11) continue;
      let ok = true;
      for (let dy = -2; dy <= 2 && ok; dy++) for (let dx = -2; dx <= 2 && ok; dx++) {
        const x = cx + dx, y = cy + dy;
        if (!inMap(x, y) || G.tiles[idx(x, y)] === T.BEDROCK || dist(x, y, G.core.x, G.core.y) < 14) ok = false;
      }
      if (!ok) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        G.tiles[idx(cx + dx, cy + dy)] = (Math.abs(dx) === 1 && Math.abs(dy) === 1) ? T.STONEWALL : T.FLOOR;
      }
      G.objects.set(idx(cx, cy), { type: 'chest', hp: OBJ_HP.chest });
      break;
    }
  }

  // 8) 蝕影巢穴:持續生怪的據點,拆掉噴獎勵;離星核夠遠避免開局就被暗潮波及
  // 種類依 NEST_TYPES 的 weight 加權抽選(用同一個 rnd 來源,確保同種子重生世界結果一致)
  const nestEntries = Object.entries(NEST_TYPES);
  const nestWeightSum = nestEntries.reduce((s, [, def]) => s + def.weight, 0);
  const pickNestType = () => {
    let r = rnd() * nestWeightSum;
    for (const [key, def] of nestEntries) { if ((r -= def.weight) < 0) return key; }
    return nestEntries[0][0];
  };
  for (let n = 0; n < POI_CFG.nests; n++) {
    for (let tries = 0; tries < 30; tries++) {
      const ang = rnd() * TAU, d = 20 + rnd() * 109;
      const x = Math.floor(CX + Math.cos(ang) * d), y = Math.floor(CY + Math.sin(ang) * d);
      if (!inMap(x, y) || G.tiles[idx(x, y)] !== T.FLOOR || G.objects.has(idx(x, y))) continue;
      if (dist(x, y, G.core.x, G.core.y) < 20) continue;
      const nestType = pickNestType();
      const ni = idx(x, y);
      G.objects.set(ni, { type: 'nest', nestType, hp: NEST_TYPES[nestType].hp });
      G.nestIdx.add(ni);
      break;
    }
  }

  // 9) 野生動物:泥土區地面散布,拿飼料(見 ANIMAL_TYPES.feed)可引誘跟隨、圈進圍籬養
  const animalKinds = Object.keys(ANIMAL_TYPES);
  for (let n = 0; n < ANIMAL_CFG.worldSpawn; n++) {
    for (let tries = 0; tries < 30; tries++) {
      const ang = rnd() * TAU, d = 14 + rnd() * 42;
      const x = Math.floor(CX + Math.cos(ang) * d), y = Math.floor(CY + Math.sin(ang) * d);
      if (!inMap(x, y) || G.tiles[idx(x, y)] !== T.FLOOR || G.objects.has(idx(x, y))) continue;
      spawnAnimal(animalKinds[(rnd() * animalKinds.length) | 0], x + 0.5, y + 0.5);
      break;
    }
  }

  rebuildLights();
}

function zoneOf(x, y) {
  const d = Math.hypot(x - CX, y - CY);
  return d < ZONE_R.dirt ? 0 : d < ZONE_R.stone ? 1 : d < ZONE_R.obsidian ? 2 : 3; // zone 3 = 第五區域「淵核區」(通關後解封)
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
