// ===== 遊戲模擬主邏輯(房主/單機執行)、暗潮、星核、存檔 =====
const SAVE_KEY = 'gloamdepths_save';

function msgAll(text) {
  showMsg(text);
  if (NET.isHost()) NET.sendAll({ t: 'msg', text });
}

// 開新世界(房主/單機)
function startNewGame(name) {
  genWorld((Math.random() * 0xffffffff) >>> 0);
  G.players.clear();
  G.playersByName = {};
  G.myId = 0;
  const p = makePlayer(0, name);
  G.players.set(0, p);
  spawnSentinels();
  G.started = true;
  showMsg('🌑 星核能量正在流失,挖光晶(藍色礦脈)按 F 餵它!');
  showMsg('⛏️ 左鍵挖牆/攻擊、右鍵放置、E 開背包');
}

function spawnSentinels() {
  for (const s of G.shrines) {
    if (!s.dead) spawnEnemy('sentinel', s.x, s.y, { home: { x: s.x, y: s.y } });
  }
}

// ===== 每幀模擬(房主) =====
let ambientT = 0, mushT = 0, saveT = 0;
function simTick(dt) {
  G.time += dt;
  updatePlayersHost(dt);
  updateEnemies(dt);
  updateTowers(dt);
  updateDrops(dt);
  updateWave(dt);
  updateCore(dt);
  ambientSpawn(dt);
  mushroomRegrow(dt);
  // 自動存檔
  saveT += dt;
  if (saveT > 30) { saveT = 0; saveGame(); }
}

function updateCore(dt) {
  const c = G.core;
  c.energy = Math.max(0, c.energy - CORE_CFG.drain * dt);
  for (const th of [30, 15, 5]) {
    if (c.energy <= th && !G.warned['e' + th]) {
      G.warned['e' + th] = true;
      msgAll(`⚠️ 星核能量剩 ${th}!快挖光晶回來按 F 灌入!`);
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
      msgAll(`🌊 暗潮將至!${WAVE_CFG.warn} 秒後來襲,守住星核!`);
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
      msgAll('☀️ 暗潮退去了,把握時間補給與建設!');
    }
  }
}

function startWave() {
  const w = G.wave;
  w.n++; w.state = 'active';
  const players = Math.max(1, [...G.players.values()].length);
  let count = Math.round((4 + 3 * w.n) * (0.7 + 0.3 * players));
  if (w.final) count = Math.round(20 * (0.7 + 0.3 * players));
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
  msgAll('✨ 星核開始甦醒……黑暗發出怒吼,最終暗潮 20 秒後來襲!');
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
  spawnEnemy(zone === 0 ? 'imp' : zone === 1 ? 'hunter' : 'abyss', x + 0.5, y + 0.5);
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

function gameOver(win) {
  if (G.over) return;
  G.over = win ? 'win' : 'lose';
  if (win) {
    msgAll('🏆 星核甦醒!微光深淵重見光明,通關!');
    emitFx({ k: 'sfx', s: 'win' });
  } else {
    msgAll('💀 星核熄滅了……全隊失敗');
    emitFx({ k: 'sfx', s: 'lose' });
  }
  if (NET.isHost()) { NET.sendAll({ t: 'over', win }); saveGame(); }
  setOverlay(G.over);
}

// ===== 存檔(只存在房主/單機的瀏覽器) =====
function buildSave() {
  // 把目前所有玩家的背包記進名字表,離線好友下次同名加入可拿回
  for (const p of G.players.values()) {
    G.playersByName[p.name] = { inv: p.inv, hp: p.hp, x: p.x, y: p.y };
  }
  return {
    v: 1, seed: G.seed, time: G.time,
    tiles: rleEnc(G.tiles),
    explored: rleEnc(G.explored),
    objects: [...G.objects].map(([i, o]) => [i, o.type, o.hp ?? null]),
    drops: G.drops.map(d => [d.item, d.n, d.x, d.y]),
    core: { energy: G.core.energy, shards: G.core.shards },
    wave: { n: G.wave.n, timer: Math.max(45, G.wave.state === 'calm' ? G.wave.timer : 45), final: G.wave.final && G.core.shards < CORE_CFG.needShards ? false : G.wave.final },
    shrines: G.shrines.map(s => ({ x: s.x, y: s.y, dead: s.dead })),
    playersByName: G.playersByName,
    hostName: G.players.get(G.myId)?.name || '',
    won: G.over === 'win',
  };
}

function saveGame() {
  if (!G.started || !NET.isHost()) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(buildSave()));
    showMsg('💾 已自動存檔(存在房主電腦)');
  } catch (e) { showMsg('⚠️ 存檔失敗:' + e.message); }
}

function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
}

function loadGame(name) {
  let s;
  try { s = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return false; }
  if (!s) return false;
  genWorld(s.seed >>> 0); // 先生成再覆蓋,結構才齊全
  G.tiles = rleDec(s.tiles, MAP_W * MAP_H, Uint8Array);
  G.explored = rleDec(s.explored, MAP_W * MAP_H, Uint8Array);
  G.dmg = new Float32Array(MAP_W * MAP_H);
  G.objects.clear(); G.mushCount = 0;
  for (const [i, type, hp] of s.objects) {
    G.objects.set(i, hp === null ? { type } : { type, hp });
    if (type === 'mushroom') G.mushCount++;
  }
  G.enemies = []; G.drops = [];
  for (const [item, n, x, y] of s.drops || []) spawnDrop(item, n, x, y);
  G.core.energy = s.core.energy; G.core.shards = s.core.shards;
  G.wave = { n: s.wave.n, state: 'calm', timer: s.wave.timer, final: false };
  G.shrines = s.shrines;
  G.playersByName = s.playersByName || {};
  G.time = s.time || 0;
  G.over = s.won ? 'win' : null;
  rebuildLights();
  spawnSentinels();
  if (s.core.shards >= CORE_CFG.needShards && !s.won) G.wave = { n: s.wave.n, state: 'warn', timer: 20, final: true };

  // 用名字還原玩家背包
  G.players.clear();
  G.myId = 0;
  const p = makePlayer(0, name);
  const saved = G.playersByName[name];
  if (saved) { p.inv = saved.inv; p.hp = saved.hp; }
  G.players.set(0, p);
  G.started = true;
  showMsg('📂 讀取存檔完成,歡迎回到微光深淵');
  return true;
}

// 客戶端玩家加入時由房主呼叫:依名字還原或給新手包
function playerJoinAs(id, name) {
  const p = makePlayer(id, name);
  const saved = G.playersByName[name];
  if (saved) { p.inv = saved.inv; p.hp = Math.max(30, saved.hp); }
  G.players.set(id, p);
  return p;
}
