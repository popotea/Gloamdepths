// ===== 遊戲模擬主邏輯(房主/單機執行)、暗潮、星核、存檔 =====
const SAVE_KEY = 'gloamdepths_save';

function msgAll(text) {
  showMsg(text);
  if (NET.isHost()) NET.sendAll({ t: 'msg', text });
}

// 開新世界(房主/單機)
function startNewGame(name, difficulty) {
  genWorld((Math.random() * 0xffffffff) >>> 0);
  G.difficulty = DIFFICULTY_CFG[difficulty] ? difficulty : 'normal';
  G.players.clear();
  G.playersByName = {};
  G.myId = 0;
  const p = makePlayer(0, name);
  G.players.set(0, p);
  spawnShrineBosses();
  G.started = true;
  showMsg('🕯️ 星核熄滅後,黑暗湧回深淵——而你們是「螢火隊」,來把光帶回來的!');
  showMsg('🌑 星核肚子咕嚕叫了!挖光晶💠(藍色礦脈)按 F 餵它一口~');
  showMsg('⛏️ 左鍵挖挖挖/打打打、右鍵放東西、E 開背包,出發!');
}

// 依 G.shrines 各自的 boss 欄位生成對應神殿守衛(舊存檔沒有 boss 欄位時退回 sentinel,
// 讓「重構前存的檔」讀進來也不會生不出怪)
function spawnShrineBosses() {
  for (const s of G.shrines) {
    if (!s.dead) spawnEnemy(s.boss || 'sentinel', s.x, s.y, { home: { x: s.x, y: s.y } });
  }
}

// ===== 每幀模擬(房主) =====
let ambientT = 0, mushT = 0, saveT = 0;
function simTick(dt) {
  G.time += dt;
  updatePlayersHost(dt);
  updateEnemies(dt);
  updateProjs(dt);
  updateTowers(dt);
  updateArcherTowers(dt);
  updateMiners(dt);
  updateNests(dt);
  updateCrops(dt);
  updateAnimals(dt);
  updateBelts(dt);  // 先推(傳輸帶)再撿(磁吸):玩家靠近時 updateDrops 的磁吸能蓋過傳輸帶推力
  updateDrops(dt);
  updateWave(dt);
  updateCore(dt);
  ambientSpawn(dt);
  mushroomRegrow(dt);
  animalRegrow(dt);
  // 自動存檔
  saveT += dt;
  if (saveT > 30) { saveT = 0; saveGame(); }
}

function updateCore(dt) {
  const c = G.core;
  const dcfg = DIFFICULTY_CFG[G.difficulty] || DIFFICULTY_CFG.normal;
  c.energy = Math.max(0, c.energy - CORE_CFG.drain * dcfg.coreDrainMult * dt);
  for (const th of [30, 15, 5]) {
    if (c.energy <= th && !G.warned['e' + th]) {
      G.warned['e' + th] = true;
      msgAll(`⚠️ 星核快沒電了(剩 ${th})!光晶!快!現在!馬上!`);
    }
    if (c.energy > th + 10) G.warned['e' + th] = false;
  }
  if (c.energy <= 0) gameOver(false);
}

// ===== 暗潮 =====
function updateWave(dt) {
  const w = G.wave;
  if (w.state === 'calm') {
    w.timer -= dt;
    if (w.timer <= WAVE_CFG.warn) {
      w.state = 'warn';
      msgAll(`🌊 蝕影大軍聞到光的味道了!${WAVE_CFG.warn} 秒後殺到,快回防星核!`);
      emitFx({ k: 'sfx', s: 'wave' });
    }
  } else if (w.state === 'warn') {
    w.timer -= dt;
    if (w.timer <= 0) startWave();
  } else if (w.state === 'active') {
    const alive = G.enemies.filter(e => e.wave).length;
    w.alive = alive;
    if (alive === 0) {
      if (w.final) { gameOver(true); return; }
      w.state = 'calm';
      w.timer = WAVE_CFG.interval;
      msgAll('☀️ 守住了!!蝕影哭著回家了~把握時間補給蓋牆!');
    }
  }
}

function startWave() {
  const w = G.wave;
  w.n++; w.state = 'active';
  const alive = [...G.players.values()];
  const players = Math.max(1, alive.length);
  const avgLv = alive.length ? alive.reduce((s, p) => s + (p.lv || 1), 0) / alive.length : 1;
  const lvMult = 1 + (avgLv - 1) * 0.12; // 隊伍平均等級每高一級,數量再多 12%
  const waveMult = (DIFFICULTY_CFG[G.difficulty] || DIFFICULTY_CFG.normal).waveCountMult;
  let count = Math.round((4 + 3 * w.n) * (0.7 + 0.3 * players) * lvMult * waveMult);
  if (w.final) count = Math.round(20 * (0.7 + 0.3 * players) * lvMult * waveMult);
  msgAll(w.final ? '🌑💥 最終暗潮來襲!!撐過去,星核就會甦醒!' : `🌊 第 ${w.n} 波暗潮來襲!共 ${count} 隻`);
  emitFx({ k: 'sfx', s: 'wave' });
  for (let k = 0; k < count; k++) {
    const pos = findWaveSpawn();
    if (!pos) continue;
    let type = 'imp';
    const roll = Math.random(), n = w.final ? 6 : w.n;
    if (n >= 5 && roll < 0.3) type = 'abyss';
    else if (n >= 3 && roll < 0.6) type = 'hunter';
    const e = spawnEnemy(type, pos.x, pos.y);
    e.wave = true;
  }
  if (w.final) {
    const pos = findWaveSpawn();
    if (pos) { const e = spawnEnemy('sentinel', pos.x, pos.y); e.wave = true; }
  }
  w.alive = G.enemies.filter(e => e.wave).length;
}

// 在星核周圍固定距離找地面生成點
function findWaveSpawn() {
  for (let tries = 0; tries < 40; tries++) {
    const ang = Math.random() * TAU;
    const d = WAVE_CFG.spawnDist + (Math.random() - 0.5) * 10;
    const x = Math.floor(G.core.x + Math.cos(ang) * d);
    const y = Math.floor(G.core.y + Math.sin(ang) * d);
    if (inMap(x, y) && tileAt(x, y) === T.FLOOR) return { x: x + 0.5, y: y + 0.5 };
  }
  return null;
}

function triggerFinalWave() {
  const w = G.wave;
  if (w.final) return;
  w.final = true; w.state = 'warn'; w.timer = 20;
  msgAll('✨ 星核要醒了!黑暗氣到跳腳——最終暗潮 20 秒後全軍壓上,大家站穩!');
  emitFx({ k: 'sfx', s: 'wave' });
}

// 黑暗處自然生怪(遠離星核、在玩家附近的暗處)
function ambientSpawn(dt) {
  ambientT -= dt;
  if (ambientT > 0) return;
  ambientT = 1.5;
  const players = [...G.players.values()].filter(p => !p.dead);
  if (!players.length) return;
  const cap = 10 + 2 * players.length;
  if (G.enemies.filter(e => !e.wave && !e.home).length >= cap) return;
  const p = players[(Math.random() * players.length) | 0];
  const ang = Math.random() * TAU, d = 9 + Math.random() * 7;
  const x = Math.floor(p.x + Math.cos(ang) * d), y = Math.floor(p.y + Math.sin(ang) * d);
  if (!inMap(x, y) || tileAt(x, y) !== T.FLOOR) return;
  if (dist(x + 0.5, y + 0.5, G.core.x, G.core.y) < 12) return;
  if (lightAtPoint(x + 0.5, y + 0.5) > 0.12) return; // 亮處不生怪
  const zone = zoneOf(x + 0.5, y + 0.5);
  // 淵核區(zone 3)生更兇的專屬怪(淵魂/蝕裂者各半);通關解封前玩家進不去,自然也不會在那生
  const type = zone === 0 ? 'imp' : zone === 1 ? 'hunter' : zone === 2 ? 'abyss'
    : (Math.random() < 0.5 ? 'revenant' : 'voidling');
  spawnEnemy(type, x + 0.5, y + 0.5);
}

// 蘑菇緩慢重生
function mushroomRegrow(dt) {
  mushT -= dt;
  if (mushT > 0) return;
  mushT = 15;
  if (G.mushCount >= 150) return;
  const ang = Math.random() * TAU, d = 8 + Math.random() * 32;
  const x = Math.floor(CX + Math.cos(ang) * d), y = Math.floor(CY + Math.sin(ang) * d);
  if (inMap(x, y) && tileAt(x, y) === T.FLOOR && !G.objects.has(idx(x, y)))
    setObj(x, y, { type: 'mushroom' });
}

// 野生動物緩慢補充(被宰太兇也不會絕種;圈養的也算在 cap 內,避免牧場無限膨脹)
let animalT = 0;
function animalRegrow(dt) {
  animalT -= dt;
  if (animalT > 0) return;
  animalT = 45;
  if (G.animals.length >= ANIMAL_CFG.cap) return;
  const ang = Math.random() * TAU, d = 10 + Math.random() * 30;
  const x = Math.floor(CX + Math.cos(ang) * d), y = Math.floor(CY + Math.sin(ang) * d);
  if (!inMap(x, y) || tileAt(x, y) !== T.FLOOR || G.objects.has(idx(x, y))) return;
  const kinds = Object.keys(ANIMAL_TYPES);
  spawnAnimal(kinds[(Math.random() * kinds.length) | 0], x + 0.5, y + 0.5);
}

function gameOver(win) {
  if (G.over) return;
  G.over = win ? 'win' : 'lose';
  if (win) {
    msgAll('🏆 星核醒來了!!整個深淵都亮起來了——你們就是傳說!✨🎉');
    emitFx({ k: 'sfx', s: 'win' });
    // 通關獎勵:解除淵核區(第五區域)的封印,開放更深、更危險的探索
    if (NET.isHost()) unsealVoidZone();
    msgAll('🔓 咔啦——遠古封印碎了!最深處的「淵核區」開門營業:怪更兇、礦更肥,敢不敢?');
  } else {
    msgAll('💀 星核睡著了……沒關係,深淵永遠歡迎再來一次(牠沒生氣,牠只是想睡)');
    emitFx({ k: 'sfx', s: 'lose' });
  }
  if (NET.isHost()) { NET.sendAll({ t: 'over', win }); saveGame(); }
  setOverlay(G.over);
}

// ===== 存檔(只存在房主/單機的瀏覽器) =====
function buildSave() {
  // 把目前所有玩家的背包記進名字表,離線好友下次同名加入可拿回
  for (const p of G.players.values()) {
    G.playersByName[p.name] = { inv: p.inv, hp: p.hp, x: p.x, y: p.y, lv: p.lv, xp: p.xp, talents: p.talents };
  }
  return {
    v: 1, seed: G.seed, time: G.time, killCount: G.killCount, difficulty: G.difficulty, unsealed: G.unsealed,
    tiles: rleEnc(G.tiles),
    explored: rleEnc(G.explored),
    objects: [...G.objects].map(([i, o]) => [i, o.type, o.hp ?? null, o.ammo ?? null, o.off ? 1 : 0, o.owner ?? null, o.stage ?? null, o.t ?? null, o.nestType ?? null, o.dir ?? null, o.fuel ?? null, o.items ?? null]),
    // lv/dur 一起存:掉在地上的強化裝備讀檔回來不能被洗白(0 與 undefined 用 null 佔位)
    drops: G.drops.map(d => [d.item, d.n, d.x, d.y, d.lv || 0, d.dur ?? null]),
    animals: G.animals.map(a => [a.type, Math.round(a.x * 10) / 10, Math.round(a.y * 10) / 10, Math.round(a.hp), Math.round(a.fedT || 0)]),
    core: { energy: G.core.energy, shards: G.core.shards },
    wave: { n: G.wave.n, timer: Math.max(45, G.wave.state === 'calm' ? G.wave.timer : 45), final: G.wave.final && G.core.shards < CORE_CFG.needShards ? false : G.wave.final },
    shrines: G.shrines.map(s => ({ x: s.x, y: s.y, dead: s.dead, boss: s.boss })),
    traders: G.traders.map(t => ({ x: t.x, y: t.y })),
    playersByName: G.playersByName,
    hostName: G.players.get(G.myId)?.name || '',
    won: G.over === 'win',
  };
}

function saveGame() {
  if (!G.started || !NET.isHost()) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(buildSave()));
    showMsg('💾 進度存好了(乖乖躺在房主電腦裡)');
  } catch (e) { showMsg('⚠️ 存檔失敗:' + e.message); }
}

function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
}

function loadGame(name) {
  let s;
  try { s = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return false; }
  if (!s) return false;
  return applySave(s, name);
}

// 匯入的存檔檔案(非房主本機 localStorage)套用同一套流程,讓任何人拿到匯出的
// JSON 檔案都能以新房主身分開房繼續,不受原房主電腦是否在線影響
function loadGameFromObject(s, name) {
  if (!s || typeof s !== 'object') return false;
  try { return applySave(s, name); } catch (e) { return false; }
}

function applySave(s, name) {
  genWorld(s.seed >>> 0); // 先生成再覆蓋,結構才齊全
  G.tiles = rleDec(s.tiles, MAP_W * MAP_H, Uint8Array);
  G.explored = rleDec(s.explored, MAP_W * MAP_H, Uint8Array);
  G.dmg = new Float32Array(MAP_W * MAP_H);
  G.objects.clear(); G.towerIdx.clear(); G.archerTowerIdx.clear(); G.nestIdx.clear(); G.cropIdx.clear(); G.minerIdx.clear(); G.beltIdx.clear(); G.mushCount = 0;
  for (const [i, type, hp, ammo, off, owner, stage, t, nestType, dir, fuel, items] of s.objects) {
    const o = hp === null ? { type } : { type, hp };
    if (ammo !== null && ammo !== undefined) o.ammo = ammo;
    if (off) o.off = true;
    if (owner !== null && owner !== undefined) o.owner = owner;
    if (stage !== null && stage !== undefined) o.stage = stage;
    if (t !== null && t !== undefined) o.t = t;
    if (nestType !== null && nestType !== undefined) o.nestType = nestType;
    if (dir !== null && dir !== undefined) o.dir = dir;     // 傳輸帶方向
    if (fuel !== null && fuel !== undefined) o.fuel = fuel;  // 自動採礦機光晶燃料
    if (items !== null && items !== undefined) o.items = items; // 儲物箱內容
    G.objects.set(i, o);
    if (type === 'mushroom') G.mushCount++;
    const key = TOWER_IDX_SETS[type]; if (key) G[key].add(i);
  }
  G.enemies = []; G.drops = []; G.projs = [];
  for (const [item, n, x, y, lv, dur] of s.drops || []) spawnDrop(item, n, x, y, lv || 0, dur === null ? undefined : dur);
  // 動物:清掉 genWorld 剛散布的野生個體,還原存檔裡的(舊版存檔沒這欄位就留著新散布的)
  if (s.animals) {
    G.animals = [];
    for (const [type, x, y, hp, fedT] of s.animals) {
      if (!ANIMAL_TYPES[type]) continue;
      const a = spawnAnimal(type, x, y);
      a.hp = Math.min(a.maxhp, hp || a.maxhp);
      a.fedT = fedT || 0;
    }
  }
  G.core.energy = s.core.energy; G.core.shards = s.core.shards;
  G.wave = { n: s.wave.n, state: 'calm', timer: s.wave.timer, final: false };
  G.shrines = s.shrines;
  G.traders = s.traders || G.traders;
  G.playersByName = s.playersByName || {};
  G.time = s.time || 0;
  G.killCount = s.killCount || 0;
  G.difficulty = DIFFICULTY_CFG[s.difficulty] ? s.difficulty : 'normal'; // 舊存檔沒有這欄位就退回一般難度
  G.unsealed = !!s.unsealed; // 淵核區解封狀態(SEAL→FLOOR 已寫進 tiles 存下來,這旗標只防重複解封)
  G.over = s.won ? 'win' : null;
  rebuildLights();
  spawnShrineBosses();
  if (s.core.shards >= CORE_CFG.needShards && !s.won) G.wave = { n: s.wave.n, state: 'warn', timer: 20, final: true };

  // 用名字還原玩家背包
  G.players.clear();
  G.myId = 0;
  const p = makePlayer(0, name);
  const saved = G.playersByName[name];
  if (saved) {
    p.inv = saved.inv;
    p.lv = saved.lv || 1; p.xp = saved.xp || 0;
    // 天賦點用不變量(已花階數+剩餘=等級-1)推回:舊版存檔沒有天賦欄位,會自動補發應得點數
    p.talents = saved.talents || {};
    p.talentPts = talentPtsOf(p);
    p.maxhp = playerMaxHp(p);
    p.hp = Math.min(p.maxhp, saved.hp);
  }
  G.players.set(0, p);
  G.started = true;
  showMsg('📂 歡迎回家!深淵想你們了~');
  return true;
}

// 客戶端玩家加入時由房主呼叫:依名字還原或給新手包
function playerJoinAs(id, name) {
  const p = makePlayer(id, name);
  const saved = G.playersByName[name];
  if (saved) {
    p.inv = saved.inv;
    p.lv = saved.lv || 1; p.xp = saved.xp || 0;
    p.talents = saved.talents || {};
    p.talentPts = talentPtsOf(p);
    p.maxhp = playerMaxHp(p);
    p.hp = Math.max(30, Math.min(p.maxhp, saved.hp));
  }
  G.players.set(id, p);
  return p;
}
