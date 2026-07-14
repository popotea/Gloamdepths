// ===== 遊戲模擬主邏輯(房主/單機執行)、暗潮、星核、存檔 =====
// 多存檔槽位:key 依槽位編號區分(gloamdepths_save_1~3);
// 舊版單一 key 由 migrateLegacySave() 自動搬進第一個空槽,老玩家的存檔不會不見
const LEGACY_SAVE_KEY = 'gloamdepths_save';
const SAVE_SLOTS = 3;
let SAVE_SLOT = 1; // 目前遊戲寫入的槽位(主選單讀檔/開新世界時決定,整局不變)
const saveKeyOf = n => `gloamdepths_save_${n}`;

// 舊版單一存檔搬進第一個空槽(冪等:搬完就刪舊 key,之後呼叫直接 return)
function migrateLegacySave() {
  try {
    const raw = localStorage.getItem(LEGACY_SAVE_KEY);
    if (!raw) return;
    for (let n = 1; n <= SAVE_SLOTS; n++) {
      if (!localStorage.getItem(saveKeyOf(n))) {
        localStorage.setItem(saveKeyOf(n), raw);
        localStorage.removeItem(LEGACY_SAVE_KEY);
        return;
      }
    }
  } catch (e) { }
}

function slotRaw(n) {
  try { return localStorage.getItem(saveKeyOf(n)); } catch (e) { return null; }
}

// 槽位摘要(主選單存檔列表用):不存在回 null;JSON 壞掉回 { broken: true } 讓玩家仍可刪除
function slotInfo(n) {
  const raw = slotRaw(n);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    return {
      hostName: s.hostName || '?',
      diffLabel: (DIFFICULTY_CFG[s.difficulty] || DIFFICULTY_CFG.normal).label,
      time: s.time || 0,
      shards: (s.core && s.core.shards) || 0,
      won: !!s.won,
      savedAt: s.savedAt || 0,
      size: raw.length,
    };
  } catch (e) { return { broken: true, size: raw.length }; }
}

function firstEmptySlot() {
  for (let n = 1; n <= SAVE_SLOTS; n++) if (!slotRaw(n)) return n;
  return 0;
}

function anySave() {
  for (let n = 1; n <= SAVE_SLOTS; n++) if (slotRaw(n)) return true;
  return false;
}

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
  spawnAltarGuardians();
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

// 依 G.altars 各自的生死生成深怪祭壇看守者(資料/實體分離同 spawnShrineBosses):
// 守衛套 ALTAR_CFG 的倍率疊在精英怪加成之上,elite:true 讓渲染/existing 精英視覺一併套用
function spawnAltarGuardians() {
  for (const a of G.altars) {
    if (a.dead) continue;
    const type = ALTAR_CFG.guardian[a.zone] || 'hunter';
    const e = spawnEnemy(type, a.x, a.y, { elite: true, home: { x: a.x, y: a.y }, altar: { x: a.x, y: a.y } });
    e.hp = Math.round(e.hp * ALTAR_CFG.hpMult); e.maxhp = e.hp;
    e.dmgMult *= ALTAR_CFG.dmgMult;
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
  updateFrostTowers(dt); // 凜鈴塔緩速脈衝(生效點在 updateEnemies 的起跳取樣,下一幀吃到)
  updateCannonTowers(dt); updateMultiTowers(dt); updateSniperTowers(dt); // 塔類第二批
  updateMiners(dt);
  updateSmelters(dt); // 熔煉在推帶之前:剛出爐的錠這幀就能被帶子接走
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
      if (w.final) { winGame(); return; }
      w.state = 'calm';
      w.timer = WAVE_CFG.interval;
      msgAll(w.endless
        ? `☀️ 無盡暗潮第 ${w.en || 0} 波退散!(蝕影:怎麼還打不下來啊)`
        : '☀️ 守住了!!蝕影哭著回家了~把握時間補給蓋牆!');
      unlockAchv('wave_survivor');
    }
  }
}

// 無盡暗潮的敵人傷害倍率:每波 +6%、封頂 3 倍(數量成長走既有 wave.n 公式,這裡只管傷害)
function endlessDmgMult() {
  return Math.min(ENDLESS_CFG.dmgCap, 1 + ENDLESS_CFG.dmgPerWave * (G.wave.en || 0));
}

function startWave() {
  const w = G.wave;
  w.n++; w.state = 'active';
  if (w.endless) w.en = (w.en || 0) + 1;
  const alive = [...G.players.values()];
  const players = Math.max(1, alive.length);
  const avgLv = alive.length ? alive.reduce((s, p) => s + (p.lv || 1), 0) / alive.length : 1;
  const lvMult = 1 + (avgLv - 1) * 0.12; // 隊伍平均等級每高一級,數量再多 12%
  const waveMult = (DIFFICULTY_CFG[G.difficulty] || DIFFICULTY_CFG.normal).waveCountMult;
  let count = Math.round((4 + 3 * w.n) * (0.7 + 0.3 * players) * lvMult * waveMult);
  if (w.final) count = Math.round(20 * (0.7 + 0.3 * players) * lvMult * waveMult);
  msgAll(w.final ? '🌑💥 最終暗潮來襲!!撐過去,星核就會甦醒!'
    : w.endless ? `🌑 無盡暗潮第 ${w.en} 波來襲!共 ${count} 隻,一波更比一波兇!`
    : `🌊 第 ${w.n} 波暗潮來襲!共 ${count} 隻`);
  emitFx({ k: 'sfx', s: 'wave' });
  for (let k = 0; k < count; k++) {
    const pos = findWaveSpawn();
    if (!pos) continue;
    let type = pickZoneEnemy(0); // 預設池:imp 為主,混一點 bomber(呼應「地圖怪物種類單調」的修正)
    const roll = Math.random(), n = w.final ? 6 : w.n;
    if (w.endless) {
      // 無盡波:淵核區的高階蝕影加入陣容,越後面占比越高(最高一半)
      const hi = Math.min(0.5, 0.15 + w.en * 0.03);
      if (roll < hi * 0.4) type = 'voidling';
      else if (roll < hi) type = 'revenant';
      else if (roll < hi + 0.25) type = 'abyss';
      else if (roll < hi + 0.5) type = 'hunter';
    } else if (n >= 5 && roll < 0.3) type = pickZoneEnemy(2);
    else if (n >= 3 && roll < 0.6) type = pickZoneEnemy(1);
    const e = spawnEnemy(type, pos.x, pos.y);
    e.wave = true;
    if (w.endless) e.dmgMult *= endlessDmgMult(); // 疊在難度/精英倍率之上
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
  // zone 0~2 走分區加權池(ZONE_SPAWN_POOL,config.js),不再是「一區只有一種怪」
  const type = zone === 3 ? (Math.random() < 0.5 ? 'revenant' : 'voidling') : pickZoneEnemy(zone);
  spawnEnemy(type, x + 0.5, y + 0.5);
}

// 蘑菇緩慢重生
function mushroomRegrow(dt) {
  mushT -= dt;
  if (mushT > 0) return;
  mushT = 15;
  if (G.mushCount >= 285) return; // 地圖放大批:上限跟著 genWorld() 的初始生成量一起調高
  const ang = Math.random() * TAU, d = 11 + Math.random() * 45;
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
  const ang = Math.random() * TAU, d = 14 + Math.random() * 42;
  const x = Math.floor(CX + Math.cos(ang) * d), y = Math.floor(CY + Math.sin(ang) * d);
  if (!inMap(x, y) || tileAt(x, y) !== T.FLOOR || G.objects.has(idx(x, y))) return;
  const kinds = Object.keys(ANIMAL_TYPES);
  spawnAnimal(kinds[(Math.random() * kinds.length) | 0], x + 0.5, y + 0.5);
}

// 真正的結局只有失敗:G.over='lose' 會凍結模擬(main.js 的 simTick 守衛)。
// 勝利不再走這裡凍結遊戲——改走 winGame() 進無盡模式(修掉「通關後全世界凍結、
// 掉落物撿不起來、淵核區名存實亡」的舊 bug)
function gameOver(win) {
  if (win) return winGame();
  if (G.over) return;
  G.over = 'lose';
  msgAll('💀 星核睡著了……沒關係,深淵永遠歡迎再來一次(牠沒生氣,牠只是想睡)');
  emitFx({ k: 'sfx', s: 'lose' });
  if (NET.isHost()) { NET.sendAll({ t: 'over', win: false }); saveGame(); }
  setOverlay('lose');
}

// 通關:慶祝+解封淵核區,接著進入無盡模式——模擬不停、暗潮照來、星核照樣要餵,
// 能量歸零依然全隊失敗。G.won 只是「已通關」的旗標(存檔/顯示用),不影響模擬
function winGame() {
  if (G.won) return;
  G.won = true;
  msgAll('🏆 星核醒來了!!整個深淵都亮起來了——你們就是傳說!✨🎉');
  emitFx({ k: 'sfx', s: 'win' });
  unlockAchv('endless_enter');
  // 通關獎勵:解除淵核區(第五區域)的封印,開放更深、更危險的探索
  if (NET.isHost()) unsealVoidZone();
  msgAll('🔓 咔啦——遠古封印碎了!最深處的「淵核區」開門營業:怪更兇、礦更肥,敢不敢?');
  G.wave = { n: G.wave.n, state: 'calm', timer: ENDLESS_CFG.rest, final: false, endless: true, en: 0 };
  msgAll('🌊 不過深淵沒打算就此安靜——「無盡暗潮」開始醞釀,一波更比一波兇。看你們能撐到第幾波!');
  if (NET.isHost()) { NET.sendAll({ t: 'over', win: true }); saveGame(); }
  setOverlay('win');
}

// ===== 存檔(只存在房主/單機的瀏覽器) =====
function buildSave() {
  // 把目前所有玩家的背包記進名字表,離線好友下次同名加入可拿回
  for (const p of G.players.values()) {
    G.playersByName[p.name] = { inv: p.inv, hp: p.hp, x: p.x, y: p.y, lv: p.lv, xp: p.xp, talents: p.talents, pet: p.pet, equip: p.equip };
  }
  return {
    v: 1, seed: G.seed, time: G.time, killCount: G.killCount, difficulty: G.difficulty, unsealed: G.unsealed,
    savedAt: Date.now(), // 主選單存檔列表顯示「上次遊玩時間」用,讀檔邏輯不吃這欄位

    tiles: rleEnc(G.tiles),
    explored: rleEnc(G.explored),
    objects: [...G.objects].map(([i, o]) => [i, o.type, o.hp ?? null, o.ammo ?? null, o.off ? 1 : 0, o.owner ?? null, o.stage ?? null, o.t ?? null, o.nestType ?? null, o.dir ?? null, o.fuel ?? null, o.items ?? null]),
    // lv/dur 一起存:掉在地上的強化裝備讀檔回來不能被洗白(0 與 undefined 用 null 佔位)
    drops: G.drops.map(d => [d.item, d.n, d.x, d.y, d.lv || 0, d.dur ?? null]),
    animals: G.animals.map(a => [a.type, Math.round(a.x * 10) / 10, Math.round(a.y * 10) / 10, Math.round(a.hp), Math.round(a.fedT || 0)]),
    core: { energy: G.core.energy, shards: G.core.shards, shield: G.core.shield || 0 },
    wave: { n: G.wave.n, timer: Math.max(45, G.wave.state === 'calm' ? G.wave.timer : 45), final: G.wave.final && G.core.shards < CORE_CFG.needShards ? false : G.wave.final, en: G.wave.en || 0 },
    shrines: G.shrines.map(s => ({ x: s.x, y: s.y, dead: s.dead, boss: s.boss })),
    traders: G.traders.map(t => ({ x: t.x, y: t.y })),
    altars: G.altars.map(a => ({ x: a.x, y: a.y, dead: a.dead, zone: a.zone })),
    questNpcs: G.questNpcs.map(n => ({ x: n.x, y: n.y, npc: n.npc })),
    quests: G.quests,
    playersByName: G.playersByName,
    hostName: G.players.get(G.myId)?.name || '',
    won: G.won,
    bestiary: G.bestiary, achv: G.achv,
  };
}

function saveGame() {
  if (!G.started || !NET.isHost()) return;
  if (!SAVE_SLOT) return; // 接棒房主找不到空存檔欄位時整局不落地(接棒當下已提示過)
  try {
    localStorage.setItem(saveKeyOf(SAVE_SLOT), JSON.stringify(buildSave()));
    showMsg(`💾 進度存好了(欄位 ${SAVE_SLOT},乖乖躺在房主電腦裡)`);
  } catch (e) { showMsg('⚠️ 存檔失敗:' + e.message); }
}

// 預設查目前槽位(設定頁的匯出/清除按鈕用);主選單「繼續存檔」要看全部槽位,用 anySave()
function hasSave(n = SAVE_SLOT) {
  return !!slotRaw(n);
}

function loadGame(name) {
  let s;
  try { s = JSON.parse(slotRaw(SAVE_SLOT)); } catch (e) { return false; }
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
  G.objects.clear(); G.towerIdx.clear(); G.archerTowerIdx.clear(); G.nestIdx.clear(); G.cropIdx.clear(); G.minerIdx.clear(); G.beltIdx.clear(); G.smelterIdx.clear(); G.frostIdx.clear(); G.decoyIdx.clear(); G.cannonIdx.clear(); G.multiIdx.clear(); G.sniperIdx.clear(); G.mushCount = 0;
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
  // 戰敗當下存的檔能量是 0,原樣讀回來第一個 tick 就再敗一次(讀檔即輸的死循環)——
  // 給一口急救能量,玩家至少有機會衝去挖光晶搶救
  G.core.energy = Math.max(s.core.energy, 25); G.core.shards = s.core.shards; G.core.shield = s.core.shield || 0;
  G.wave = { n: s.wave.n, state: 'calm', timer: s.wave.timer, final: false };
  G.shrines = s.shrines;
  G.traders = s.traders || G.traders;
  G.altars = s.altars || G.altars; // 舊存檔沒有這欄位就留著 genWorld 剛生成的(新世界升級舊存檔也不會少一批據點)
  G.questNpcs = s.questNpcs || G.questNpcs;
  G.quests = s.quests || G.quests; // 同上;genWorld 已經 seed 過 requires:null 的擊殺型任務進度
  G.playersByName = s.playersByName || {};
  G.time = s.time || 0;
  G.killCount = s.killCount || 0;
  G.difficulty = DIFFICULTY_CFG[s.difficulty] ? s.difficulty : 'normal'; // 舊存檔沒有這欄位就退回一般難度
  G.unsealed = !!s.unsealed; // 淵核區解封狀態(SEAL→FLOOR 已寫進 tiles 存下來,這旗標只防重複解封)
  G.bestiary = s.bestiary || {}; G.achv = s.achv || {}; // 舊存檔沒有這兩欄位就從空的開始,不會噴錯
  // 通關過的存檔:讀回來直接是無盡模式(G.over 只留給 lose,勝利不凍結模擬)。
  // 舊版存檔沒有 wave.en 就從 0 起算,給 90 秒喘息再開下一波
  G.won = !!s.won;
  G.over = null;
  if (s.won) G.wave = { n: s.wave.n, state: 'calm', timer: Math.max(90, s.wave.timer || 90), final: false, endless: true, en: s.wave.en || 0 };
  rebuildLights();
  spawnShrineBosses();
  spawnAltarGuardians();
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
    p.pet = saved.pet || null;
    p.equip = saved.equip || null;
    migrateLegacyArmor(p); // 舊存檔沒有 equip 欄位,從背包裡挑一件胸甲自動穿上
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
    p.pet = saved.pet || null;
    p.equip = saved.equip || null;
    migrateLegacyArmor(p); // 舊存檔沒有 equip 欄位,從背包裡挑一件胸甲自動穿上
  }
  G.players.set(id, p);
  return p;
}
