// ===== 全域常數與資料表 =====
const TILE = 40;                 // 每格像素
const MAP_W = 200, MAP_H = 200;  // 地圖大小(格)
const CX = MAP_W / 2, CY = MAP_H / 2;
const TAU = Math.PI * 2;

// 星核設定
const CORE_CFG = {
  maxE: 100,
  drain: 0.25,        // 每秒流失能量
  feed: 6,            // 每顆光晶補充能量
  hitDrain: 5,        // 暗潮怪打星核一下扣的能量
  needShards: 3,
};

// 暗潮設定
const WAVE_CFG = {
  first: 240,         // 開局幾秒後第一波
  interval: 240,      // 之後每隔幾秒一波
  warn: 30,           // 提前幾秒警告
  spawnDist: 28,      // 從離星核多遠的黑暗處出現
};

// 玩家等級設定:每級 +HP、+攻擊力%(疊加在裝備傷害上),打怪獲得經驗
const LEVEL_CFG = {
  maxLv: 10,
  hpPer: 8,            // 每級 +最大HP
  dmgPer: 0.05,         // 每級 +5% 攻擊力
  xpNeed: lv => Math.round(20 * lv * (1 + lv * 0.15)), // 升到 lv+1 需要的經驗值
};
// 各怪物擊殺經驗值
const ENEMY_XP = {
  imp: 4, spore: 2, hunter: 9, spitter: 7, bomber: 6,
  phantom: 8, breaker: 20, abyss: 16, sentinel: 60, fire_boss: 65,
};

// 神殿 Boss 額外掉落(除了必掉 2 張強化卷軸 + 1 顆星核碎片給擊殺者之外的加碼獎勵)
const SHRINE_BOSS_LOOT = {
  sentinel:  { gold_ore: 3 },
  fire_boss: { gold_ore: 2, lumite: 4 },   // 火系加碼一點光晶,呼應「火」與能量的意象
};
function xpToNext(lv) { return LEVEL_CFG.xpNeed(lv); }

// ── 天賦:每升 1 級得 1 點(滿級共 9 點),總階數 15 刻意大於點數,一輪拿不滿要取捨。
// 全部是「個人被動」(不做影響全隊/星核的全域天賦,多人時歸屬跟疊加規則會很難收拾);
// 數值比衝裝(ENH_CFG 每級 +15%)小一階,兩套疊起來才不會爆
const TALENTS = {
  vital:  { name: '強韌體魄', icon: '💪', max: 3, val: 15,   desc: '每級:最大生命 +15' },
  power:  { name: '戰意',     icon: '⚔️', max: 3, val: 0.08, desc: '每級:攻擊力 +8%' },
  miner:  { name: '礦脈直覺', icon: '⛏️', max: 3, val: 0.12, desc: '每級:挖掘力 +12%' },
  swift:  { name: '健步如飛', icon: '👟', max: 2, val: 0.06, desc: '每級:移動速度 +6%' },
  dasher: { name: '衝刺大師', icon: '💨', max: 2, val: 0.20, desc: '每級:衝刺體力消耗 -20%' },
  chef:   { name: '大胃王',   icon: '🍽️', max: 2, val: 0.20, desc: '每級:食物回復效果 +20%' },
};
function talRank(p, id) { return (p.talents && p.talents[id]) || 0; }
// 不變量:已花階數 + 剩餘點數 = 等級 - 1。讀檔/重連一律用這條推回剩餘點數,
// 舊版存檔(沒有天賦欄位)的玩家會自動補發過去升級應得的點數
function talentPtsOf(p) {
  let spent = 0;
  if (p.talents) for (const id in p.talents) spent += p.talents[id];
  return Math.max(0, ((p.lv || 1) - 1) - spent);
}
function playerDmgMult(p) { return (1 + LEVEL_CFG.dmgPer * ((p.lv || 1) - 1)) * (1 + TALENTS.power.val * talRank(p, 'power')); }
function playerMaxHp(p) { return 100 + LEVEL_CFG.hpPer * ((p.lv || 1) - 1) + TALENTS.vital.val * talRank(p, 'vital'); }

// 衝刺設定:Shift 瞬間加速,消耗體力,體力不足需回復才能再衝
const DASH_CFG = {
  cost: 30,        // 每次衝刺消耗體力
  regen: 20,        // 每秒回復體力(衝刺中不回復)
  dur: 0.22,        // 衝刺持續秒數
  mult: 2.3,        // 衝刺時速度倍率
  cd: 0.5,          // 衝刺後的再次觸發冷卻
};

// 地形代號
const T = {
  FLOOR: 0, DIRT: 1, STONE: 2, OBSIDIAN: 3,
  COPPER: 4, IRON: 5, GOLD: 6, LUMITE: 7, ROOT: 8,
  BEDROCK: 9, GLOW: 10, WOODWALL: 11, STONEWALL: 12,
  GRAVEL: 13, COAL: 14, DIAMOND: 15, FARMLAND: 16,
  WATER: 17, FENCE: 18,
};

// 地形資料:hp=挖掘耐久, tier=所需鎬階級, light=自帶光半徑
// 配色原則:每種牆用「不同色相」拉開辨識度(泥土=暖棕、石=冷灰藍、黑曜=紫、
// 木根=亮木色);整體提高明度與飽和度(亮處要一眼分得出來,暗處靠遮罩壓暗);
// 礦脈底色比同區牆亮一階 + 礦點高飽和 + sparkle 白點(render 畫)
// tex=貼圖檔名(放 assets/tiles/,由 AI Hub 生產);檔案不存在自動退回 c1/c2 色塊畫法
const TILE_INFO = {
  [T.FLOOR]:    { solid: false, tex: 'floor.png' },
  [T.GLOW]:     { solid: false, light: 4, tex: 'floor.png' }, // 底圖同地板,光斑在 render 疊加
  [T.FARMLAND]: { solid: false, name: '翻好的農地', tex: 'farmland.png' }, // 鏟子翻土產生;渲染在 render.js 特判(不是牆,不用 c1/c2)
  [T.DIRT]:     { solid: true, hp: 3,  tier: 0, name: '泥土牆',   drop: null,                      c1: '#96683c', c2: '#6e4a24', tex: 'dirt.png' },
  [T.STONE]:    { solid: true, hp: 10, tier: 0, name: '石牆',     drop: { id: 'stone', n: 1 },      c1: '#8d92aa', c2: '#666b80', tex: 'stone.png' },
  [T.OBSIDIAN]: { solid: true, hp: 22, tier: 2, name: '黑曜岩',   drop: { id: 'stone', n: 1 },      c1: '#6b529e', c2: '#4a3870', tex: 'obsidian.png' },
  [T.COPPER]:   { solid: true, hp: 6,  tier: 0, name: '銅礦脈',   drop: { id: 'copper_ore', n: 1 }, c1: '#a06a38', c2: '#784e24', ore: '#ff9040', tex: 'copper_vein.png' },
  [T.IRON]:     { solid: true, hp: 16, tier: 1, name: '鐵礦脈',   drop: { id: 'iron_ore', n: 1 },   c1: '#9aa0b8', c2: '#70768c', ore: '#f4f8ff', tex: 'iron_vein.png' },
  [T.GOLD]:     { solid: true, hp: 24, tier: 2, name: '金礦脈',   drop: { id: 'gold_ore', n: 1 },   c1: '#7a62b0', c2: '#564584', ore: '#ffd23f', tex: 'gold_vein.png' },
  [T.LUMITE]:   { solid: true, hp: 8,  tier: 0, name: '光晶礦脈', drop: { id: 'lumite', n: 2 },     c1: '#3e6c94', c2: '#2c4e6c', ore: '#7ef0ff', light: 2.5, tex: 'lumite_vein.png' },
  [T.ROOT]:     { solid: true, hp: 4,  tier: 0, name: '木根',     drop: { id: 'wood', n: 2 },       c1: '#b08a48', c2: '#886a34', ore: '#e0b878', tex: 'root.png' },
  [T.GRAVEL]:   { solid: true, hp: 4,  tier: 0, name: '砂礫',     drop: { id: 'stone', n: 1 },      c1: '#8a8478', c2: '#645e52', tex: 'gravel.png' },
  [T.COAL]:     { solid: true, hp: 7,  tier: 0, name: '煤礦脈',   drop: { id: 'coal', n: 1 },       c1: '#585850', c2: '#3a3a34', ore: '#26262a', tex: 'coal_vein.png' },
  [T.DIAMOND]:  { solid: true, hp: 30, tier: 3, name: '鑽石礦脈', drop: { id: 'diamond', n: 1 },    c1: '#5a4a8e', c2: '#3c3068', ore: '#6cf7ff', tex: 'diamond_vein.png' },
  [T.BEDROCK]:  { solid: true, hp: Infinity, tier: 99, name: '基岩', c1: '#16161c', c2: '#0e0e12', tex: 'bedrock.png' },
  [T.WOODWALL]: { solid: true, hp: 40, tier: 0, name: '木牆', drop: { id: 'wood_wall', n: 1 },  c1: '#c09454', c2: '#96743e', built: 'plank', tex: 'wall_wood.png' },
  [T.STONEWALL]:{ solid: true, hp: 90, tier: 0, name: '石牆(建)', drop: { id: 'stone_wall', n: 1 }, c1: '#b4b4c4', c2: '#8e8e9e', built: 'brick', tex: 'wall_stone.png' },
  // 水:solid 擋移動(人/怪都不能走進去,幽影照樣穿),liquid+low 讓投射物飛得過、鎬敲不掉;
  // 自帶微光呼應「幽光水池」,順便讓怪不會貼著水邊生成
  [T.WATER]:    { solid: true, liquid: true, low: true, hp: Infinity, tier: 99, name: '幽光水池', light: 2, c1: '#16455f', c2: '#0e2c40', tex: 'water.png' },
  // 圍籬:矮牆,擋移動但箭矢/光束/暗影彈都飛得過(low);比木牆脆,定位是圈農地/牧場不是防線
  [T.FENCE]:    { solid: true, low: true, fence: true, hp: 25, tier: 0, name: '木圍籬', drop: { id: 'fence', n: 1 }, c1: '#c09454', c2: '#96743e', tex: 'fence_tile.png' },
};

// ── 箭塔:玩家手動補箭矢的防禦建築,彈藥打完就停火,靠玩家回來補給形成天然上限 ──
// dmg 比光塔(12)高,但沒箭就是廢鐵;每人可蓋數量上限避免堆成怪打不穿的彈幕牆
const ARCHER_TOWER_CFG = {
  maxAmmo: 20, dmg: 20, range: 6, cd: 0.9,
  maxPerPlayer: 3,
};

// ── 料理 buff:食物可帶 buff 欄位 { kind, mult 或 value, dur 秒 },doEat 時寫進 p.buffs[kind],
// 同種 buff 重複吃 = 重置時間(不疊加倍率,避免數值爆掉);計時與失效在 updatePlayersHost。
// kind 對應的生效點:speed=移動速度(main.js localControl)/ mine=挖掘力(doMine)/
// guard=額外減傷(damagePlayer,與護甲相乘)/ regen=每秒回血(updatePlayersHost)
const BUFF_INFO = {
  speed: { name: '疾行', icon: '👟' },
  guard: { name: '岩鎧', icon: '🛡️' },
  mine:  { name: '礦勁', icon: '⛏️' },
  regen: { name: '回春', icon: '💚' },
  vigor: { name: '精力', icon: '⚡' }, // 體力回復速度倍率(main.js localControl)
};
function buffMult(p, kind) { const b = p.buffs && p.buffs[kind]; return b ? (b.mult || 1) : 1; }
function buffVal(p, kind) { const b = p.buffs && p.buffs[kind]; return b ? (b.value || 0) : 0; }

// ── 釣魚:站在岸邊對水面右鍵拋竿,計時到就開獎(移動超過 moveCancel 格 = 收竿魚跑了);
// loot 權重表,null = 空軍(什麼都沒釣到)
const FISH_CFG = {
  timeMin: 1.5, timeMax: 4, moveCancel: 0.3,
  loot: [ ['fish', 0.5], ['crystal_fish', 0.15], ['lumite', 0.1], [null, 0.25] ],
};

// ── 動物養殖:被動生物,不攻擊不追逐(AI 在 updateAnimals,跟 updateEnemies 完全分開的一套)。
// 來源=野外偶遇:泥土區隨機遊蕩,玩家手持 feed 清單內的物品靠近,動物會跟著走(引回基地圈進圍籬);
// 右鍵拿飼料對動物餵食 → 倒數 productCD 秒後掉 product,之後回到飢餓狀態要再餵;
// 近戰攻擊可宰殺掉 meat[min,max] 塊獸肉(箭/塔打不到動物,避免箭塔把牧場屠了)
const ANIMAL_TYPES = {
  hen: { name: '幽穴雞', icon: '🐔', hp: 20, r: 0.30, speed: 2.6, hopCD: 1.6,
         feed: ['mush_spore', 'mushroom'], product: 'egg', productCD: 90, meat: [1, 1] },
  cow: { name: '苔絨牛', icon: '🐮', hp: 50, r: 0.48, speed: 2.2, hopCD: 2.0,
         feed: ['glowcap', 'mushroom'], product: 'milk', productCD: 150, meat: [2, 3] },
};
const ANIMAL_CFG = {
  worldSpawn: 8,   // 開新世界散布幾隻
  cap: 10,         // 野外自然補充的上限(圈養的也算在內)
  followRange: 5,  // 手持飼料多近會被跟隨
};

// ── 農耕:doTill(entities.js)把地板翻成 T.FARMLAND;doPlant 在農地種下 crop 物件;
// updateCrops 逐格計時推進 stage,長到 icons 最後一格(成熟)後,玩家走過去會自動收成
// (跟野生蘑菇同一套 updatePlayersHost 自動採集邏輯),收成後農地保留、可以馬上再種。
const CROP_TYPES = {
  mush: { seed: 'mush_spore', yield: 'glowcap', yieldMin: 1, yieldMax: 2, seedBackChance: 0.4,
          growTime: 90, icons: ['🌱', '🌿', '🍄'] },
};

// 物品表:pick=鎬(tier 階級/power 每下傷害), sword=劍, armor=減傷比例
// place='物件類型' 或 placeTile=地形代號
const ITEMS = {
  wood:            { name: '木材', icon: '🪵' },
  stone:           { name: '石頭', icon: '🪨' },
  copper_ore:      { name: '銅礦', icon: '🟤' },
  iron_ore:        { name: '鐵礦', icon: '⚪' },
  gold_ore:        { name: '金礦', icon: '🟡' },
  coal:            { name: '煤炭', icon: '⚫' },
  diamond:         { name: '鑽石', icon: '💎', desc: '深藏在黑曜岩區的頂級礦物,需要金鎬才挖得動' },
  lumite:          { name: '光晶', icon: '💠', desc: '在星核旁按 F 灌入(+6 能量),也是火把/光塔材料' },
  copper_bar:      { name: '銅錠', icon: '🥉' },
  iron_bar:        { name: '鐵錠', icon: '🥈' },
  gold_bar:        { name: '金錠', icon: '🥇' },
  mushroom:        { name: '螢光蘑菇', icon: '🍄', food: 15 },
  cooked_mushroom: { name: '烤蘑菇', icon: '🍢', food: 40 },
  shard:           { name: '星核碎片', icon: '🔷', desc: '帶回星核附近會自動放入', max: 9 },
  torch:           { name: '火把', icon: '🕯️', place: 'torch' },
  wood_wall:       { name: '木牆', icon: '🟫', placeTile: T.WOODWALL },
  stone_wall:      { name: '石牆', icon: '⬜', placeTile: T.STONEWALL },
  workbench:       { name: '工作台', icon: '🛠️', place: 'workbench' },
  furnace:         { name: '熔爐', icon: '🔥', place: 'furnace' },
  tower:           { name: '光塔', icon: '🗼', place: 'tower', desc: '照明並自動攻擊附近的蝕影' },
  archer_tower:    { name: '箭塔', icon: '🏹', place: 'archer_tower',
                     desc: `防禦力更強,但要靠玩家補箭矢(上限${ARCHER_TOWER_CFG.maxAmmo}發)才會開火,沒箭就停火。
右鍵拿著箭矢對它可補箭,右鍵拿著空手對它可切換開/關。每人最多蓋 ${ARCHER_TOWER_CFG.maxPerPlayer} 座` },
  // dur = 耐久上限:成功挖掘/命中扣 1,歸零「損壞停用」但永不消失(強化等級保留),
  // 工作台修理花合成成本的一半;衝裝每級 +15% 上限(maxDur,inventory.js)
  wood_pick:       { name: '木鎬', icon: '⛏️', pick: { tier: 0, power: 1 },   max: 1, dur: 120 },
  copper_pick:     { name: '銅鎬', icon: '⛏️', pick: { tier: 1, power: 2.5 }, max: 1, dur: 180, tint: '#7a4526' },
  iron_pick:       { name: '鐵鎬', icon: '⛏️', pick: { tier: 2, power: 5 },   max: 1, dur: 240, tint: '#5c6570' },
  gold_pick:       { name: '金鎬', icon: '⛏️', pick: { tier: 3, power: 9 },   max: 1, dur: 320, tint: '#8a6d1f' },
  // 近戰武器:dmg=傷害, cd=攻速, range=距離, arc=揮擊弧度, kb=擊退
  // 劍會被自動選用;矛/鎚要放到快捷欄「選中」才會使用(manual)
  wood_sword:      { name: '木劍', icon: '🗡️', sword: { dmg: 8 },  max: 1, dur: 100 },
  copper_sword:    { name: '銅劍', icon: '🗡️', sword: { dmg: 15 }, max: 1, dur: 160, tint: '#7a4526' },
  iron_sword:      { name: '鐵劍', icon: '🗡️', sword: { dmg: 25 }, max: 1, dur: 220, tint: '#5c6570' },
  gold_sword:      { name: '金劍', icon: '🗡️', sword: { dmg: 40 }, max: 1, dur: 300, tint: '#8a6d1f' },
  flame_sword:     { name: '焰紋劍', icon: '🔥', sword: { dmg: 22, elem: 'fire' },  max: 1, dur: 220, tint: '#7a2e1a',
                     desc: '焰屬性:剋冰(穿牆幽影),對暗小加成,別拿去打爆裂蝕影' },
  frost_sword:     { name: '霜刃',   icon: '❄️', sword: { dmg: 22, elem: 'frost' }, max: 1, dur: 220, tint: '#1f4a5c',
                     desc: '冰屬性:剋焰(爆裂蝕影),對暗小加成,別拿去打穿牆幽影' },
  copper_spear:    { name: '銅矛', icon: '🔱', sword: { dmg: 12, cd: 0.45, range: 3.0, arc: 0.5, manual: true }, max: 1, dur: 160, tint: '#7a4526',
                     desc: '選中使用:攻擊距離 3 格,適合隔牆縫戳怪' },
  iron_spear:      { name: '鐵矛', icon: '🔱', sword: { dmg: 20, cd: 0.45, range: 3.0, arc: 0.5, manual: true }, max: 1, dur: 220, tint: '#5c6570',
                     desc: '選中使用:攻擊距離 3 格,適合隔牆縫戳怪' },
  iron_hammer:     { name: '鐵鎚', icon: '🔨', sword: { dmg: 32, cd: 0.8, range: 2.0, arc: 1.5, kb: 14, manual: true, elem: 'smash' }, max: 1, dur: 220, tint: '#5c6570',
                     desc: '選中使用:慢但大範圍橫掃+超強擊退;重擊剋石(裂地者/石像守衛)' },
  gold_hammer:     { name: '金鎚', icon: '🔨', sword: { dmg: 50, cd: 0.8, range: 2.0, arc: 1.5, kb: 14, manual: true, elem: 'smash' }, max: 1, dur: 300, tint: '#8a6d1f',
                     desc: '選中使用:慢但大範圍橫掃+超強擊退;重擊剋石(裂地者/石像守衛)' },
  // 遠程武器:選中後左鍵發射,消耗彈藥
  bow:             { name: '獵弓', icon: '🏹', ranged: { dmg: 14, cd: 0.5, speed: 13, ammo: 'arrow' }, max: 1, dur: 150,
                     desc: '選中使用:發射箭矢(需背包有箭)' },
  crossbow:        { name: '強弩', icon: '🎯', ranged: { dmg: 32, cd: 0.8, speed: 16, ammo: 'arrow' }, max: 1, dur: 220, tint: '#5c6570',
                     desc: '選中使用:重擊箭矢(需背包有箭)' },
  lumite_staff:    { name: '光晶法杖', icon: '🪄', ranged: { dmg: 26, cd: 0.55, speed: 11, ammo: 'lumite', pierce: true, elem: 'light' }, max: 1, dur: 200, tint: '#1f4a5c',
                     desc: '選中使用:貫穿光束,每發耗 1 光晶;光剋暗(所有蝕影)' },
  arrow:           { name: '箭矢', icon: '➳', desc: '獵弓與強弩的彈藥' },
  enh_scroll:      { name: '強化卷軸', icon: '📜', desc: '在工作台旁對武器/鎬/護甲衝裝(+攻擊力);怪物會掉落' },
  iron_armor:      { name: '鐵甲', icon: '🛡️', armor: 0.3, max: 1, tint: '#5c6570', desc: '放在背包即生效,受傷 -30%' },
  gold_armor:      { name: '金甲', icon: '🛡️', armor: 0.5, max: 1, tint: '#8a6d1f', desc: '放在背包即生效,受傷 -50%' },
  // 農耕:鏟子只用來翻土,不能拿去挖牆(doMine 完全不認得 till 這個欄位);
  // seed 記錄要種出哪種作物,對照 CROP_TYPES 的 key
  shovel:          { name: '鏟子', icon: '🥄', till: true, max: 1, desc: '對地板右鍵翻成農地;鏟子不能用來挖牆' },
  mush_spore:      { name: '光孢子', icon: '🟤', seed: 'mush', desc: '對翻好的農地右鍵種下;採野生蘑菇有機率獲得' },
  glowcap:         { name: '光傘菇', icon: '🍄', food: 25, desc: '農地種出來的作物,比野生蘑菇更頂餓' },
  // 料理擴充:帶 buff 的熟食(重複吃同種 buff 只重置時間);血滿也吃得下去(為了 buff)
  glow_soup:       { name: '光傘菇湯', icon: '🥣', food: 30, buff: { kind: 'speed', mult: 1.2, dur: 90 },
                     desc: '回血 30;移動速度 +20%,持續 90 秒' },
  rock_stew:       { name: '岩鎧燉菜', icon: '🍲', food: 30, buff: { kind: 'guard', value: 0.25, dur: 90 },
                     desc: '回血 30;受到傷害再 -25%(與護甲相乘),持續 90 秒' },
  miner_feast:     { name: '礦工大餐', icon: '🍛', food: 40, buff: { kind: 'mine', mult: 1.6, dur: 120 },
                     desc: '回血 40;挖掘力 +60%,持續 120 秒' },
  // 釣魚:釣竿對水面右鍵拋竿;魚是料理食材
  fishing_rod:     { name: '釣竿', icon: '🎣', fish: true, max: 1, desc: '選中後對幽光水池右鍵拋竿,站著別動等魚上鉤' },
  fish:            { name: '幽潭魚', icon: '🐟', food: 15, desc: '水池釣上來的魚,生吃普通,烤過更棒' },
  crystal_fish:    { name: '晶鱗魚', icon: '🐠', food: 10, desc: '罕見的發光魚,是晶鱗魚湯的材料' },
  cooked_fish:     { name: '烤魚', icon: '🍣', food: 45 },
  fish_soup:       { name: '晶鱗魚湯', icon: '🍜', food: 35, buff: { kind: 'regen', value: 2, dur: 60 },
                     desc: '回血 35;每秒再回 2 點血,持續 60 秒' },
  // 圍籬:擋怪(也擋人)但箭矢飛得過,拿來圈農地/牧場;怪照樣啃得爛,別當防線用
  fence:           { name: '木圍籬', icon: '🚧', placeTile: T.FENCE,
                     desc: '矮柵欄:擋住怪物走動,但箭塔/弓箭可以越過它射擊;耐久比木牆低' },
  // 動物養殖:產物與肉,接進料理系統
  egg:             { name: '幽光蛋', icon: '🥚', food: 12, desc: '幽穴雞餵食後定時產下;可做菇蛋燒' },
  milk:            { name: '苔奶', icon: '🥛', food: 15, desc: '苔絨牛餵食後定時產出;可做奶菇濃湯' },
  meat:            { name: '獸肉', icon: '🥩', food: 8, desc: '生肉勉強能吃,烤過才是正餐' },
  cooked_meat:     { name: '烤肉', icon: '🍗', food: 50 },
  omelet:          { name: '菇蛋燒', icon: '🍳', food: 35 },
  cream_stew:      { name: '奶菇濃湯', icon: '🍵', food: 30, buff: { kind: 'vigor', mult: 1.8, dur: 90 },
                     desc: '回血 30;體力回復速度 +80%(衝刺更快回滿),持續 90 秒' },
};

// 合成配方:station=null 徒手 / 'workbench' / 'furnace'
const RECIPES = [
  { out: 'torch',       n: 3, cost: { wood: 1, lumite: 1 },  station: null },
  { out: 'workbench',   n: 1, cost: { wood: 8 },             station: null },
  { out: 'wood_wall',   n: 4, cost: { wood: 2 },             station: 'workbench' },
  { out: 'stone_wall',  n: 4, cost: { stone: 2 },            station: 'workbench' },
  { out: 'furnace',     n: 1, cost: { stone: 10 },           station: 'workbench' },
  { out: 'tower',       n: 1, cost: { lumite: 6, stone: 4, copper_bar: 2 }, station: 'workbench' },
  { out: 'archer_tower',n: 1, cost: { wood: 10, stone: 6, iron_bar: 3 },    station: 'workbench' },
  { out: 'copper_pick', n: 1, cost: { copper_bar: 3, wood: 1 }, station: 'workbench' },
  { out: 'copper_sword',n: 1, cost: { copper_bar: 3, wood: 1 }, station: 'workbench' },
  { out: 'iron_pick',   n: 1, cost: { iron_bar: 3, wood: 1 },   station: 'workbench' },
  { out: 'iron_sword',  n: 1, cost: { iron_bar: 3, wood: 1 },   station: 'workbench' },
  { out: 'iron_armor',  n: 1, cost: { iron_bar: 5 },            station: 'workbench' },
  { out: 'gold_pick',   n: 1, cost: { gold_bar: 3, wood: 1 },   station: 'workbench' },
  { out: 'gold_sword',  n: 1, cost: { gold_bar: 3, wood: 1 },   station: 'workbench' },
  { out: 'gold_armor',  n: 1, cost: { gold_bar: 5 },            station: 'workbench' },
  { out: 'bow',          n: 1, cost: { wood: 6 },                        station: 'workbench' },
  { out: 'arrow',        n: 8, cost: { wood: 1, stone: 1 },              station: 'workbench' },
  { out: 'copper_spear', n: 1, cost: { copper_bar: 2, wood: 2 },         station: 'workbench' },
  { out: 'iron_spear',   n: 1, cost: { iron_bar: 2, wood: 2 },           station: 'workbench' },
  { out: 'iron_hammer',  n: 1, cost: { iron_bar: 4, wood: 1 },           station: 'workbench' },
  { out: 'crossbow',     n: 1, cost: { iron_bar: 3, wood: 3 },           station: 'workbench' },
  { out: 'gold_hammer',  n: 1, cost: { gold_bar: 4, wood: 1 },           station: 'workbench' },
  { out: 'flame_sword',  n: 1, cost: { iron_bar: 2, copper_bar: 3 },     station: 'furnace' },
  { out: 'frost_sword',  n: 1, cost: { iron_bar: 2, lumite: 6 },         station: 'workbench' },
  { out: 'lumite_staff', n: 1, cost: { gold_bar: 2, lumite: 8, wood: 2 }, station: 'workbench' },
  { out: 'enh_scroll',   n: 1, cost: { lumite: 4, stone: 2 },            station: 'workbench' },
  { out: 'copper_bar',  n: 1, cost: { copper_ore: 2 },  station: 'furnace' },
  { out: 'iron_bar',    n: 1, cost: { iron_ore: 2 },    station: 'furnace' },
  { out: 'gold_bar',    n: 1, cost: { gold_ore: 2 },    station: 'furnace' },
  { out: 'cooked_mushroom', n: 1, cost: { mushroom: 1 }, station: 'furnace' },
  { out: 'shovel',       n: 1, cost: { wood: 4, stone: 2 },  station: 'workbench' },
  // 料理擴充(全在熔爐):光傘菇當基底,礦物入菜
  { out: 'glow_soup',    n: 1, cost: { glowcap: 2 },                              station: 'furnace' },
  { out: 'rock_stew',    n: 1, cost: { glowcap: 1, coal: 2 },                     station: 'furnace' },
  { out: 'miner_feast',  n: 1, cost: { cooked_mushroom: 1, glowcap: 1, copper_ore: 1 }, station: 'furnace' },
  // 釣魚
  { out: 'fishing_rod',  n: 1, cost: { wood: 5, stone: 1 },   station: 'workbench' },
  { out: 'cooked_fish',  n: 1, cost: { fish: 1 },             station: 'furnace' },
  { out: 'fish_soup',    n: 1, cost: { crystal_fish: 1, glowcap: 1 }, station: 'furnace' },
  // 圍籬
  { out: 'fence',        n: 6, cost: { wood: 2 },             station: 'workbench' },
  // 動物養殖產物料理
  { out: 'cooked_meat',  n: 1, cost: { meat: 1 },              station: 'furnace' },
  { out: 'omelet',       n: 1, cost: { egg: 1, mushroom: 1 },  station: 'furnace' },
  { out: 'cream_stew',   n: 1, cost: { milk: 1, glowcap: 1 },  station: 'furnace' },
];

// 敵人表:speed=跳撲衝量, hopCD=跳撲間隔
// shape=外形(blob 圓球/spike 帶刺/mono 獨眼/mouth 大嘴/ghost 半透明/tank 方甲),無對應貼圖時的備用畫法
// icon=貼圖檔名(放在 assets/monsters/ 底下);找不到檔案會自動退回 shape 向量畫法,不影響遊戲運作
// 行為擴充:pack=成群生成數, ranged=遠程吐彈, explode=自爆, ghost=穿牆, wallMult=拆牆倍率
const ENEMY_TYPES = {
  imp:      { name: '小蝕影',   hp: 18,  dmg: 6,  r: 0.36, speed: 3.6, hopCD: 1.6, color: '#39435c', eye: '#7ef0ff', shape: 'blob',  elem: 'dark', icon: 'imp.png' },
  spore:    { name: '蝕影孢子', hp: 8,   dmg: 3,  r: 0.22, speed: 4.4, hopCD: 0.9, color: '#2e544e', eye: '#9fffec', shape: 'mono',  elem: 'dark', pack: 3, icon: 'spore.png' },
  hunter:   { name: '蝕影獵手', hp: 40,  dmg: 12, r: 0.42, speed: 4.4, hopCD: 1.3, color: '#523a70', eye: '#c06cff', shape: 'spike', elem: 'dark', icon: 'hunter.png' },
  spitter:  { name: '吐影者',   hp: 30,  dmg: 8,  r: 0.40, speed: 3.4, hopCD: 1.7, color: '#63357e', eye: '#e08cff', shape: 'mouth', elem: 'dark', icon: 'spitter.png',
              ranged: { range: 5.5, cd: 2.2, dmg: 10, speed: 7.5 } },
  bomber:   { name: '爆裂蝕影', hp: 26,  dmg: 6,  r: 0.38, speed: 5.2, hopCD: 1.1, color: '#7e3524', eye: '#ffb35c', shape: 'blob',  elem: 'fire', icon: 'bomber.png',
              explode: { fuse: 0.9, r: 1.9, dmg: 24, wallDmg: 45, core: 10 } },
  phantom:  { name: '穿牆幽影', hp: 22,  dmg: 10, r: 0.40, speed: 2.6, hopCD: 1.4, color: '#3e6480', eye: '#dffbff', shape: 'ghost', elem: 'frost', ghost: true, icon: 'phantom.png' },
  breaker:  { name: '裂地者',   hp: 130, dmg: 14, r: 0.55, speed: 3.6, hopCD: 1.9, color: '#6b6250', eye: '#ffd23f', shape: 'tank',  elem: 'earth', wallMult: 4, icon: 'breaker.png' },
  abyss:    { name: '深淵蝕影', hp: 75,  dmg: 20, r: 0.50, speed: 4.6, hopCD: 1.2, color: '#742e42', eye: '#ff5d5d', shape: 'spike', elem: 'dark', icon: 'abyss.png' },
  sentinel: { name: '石像守衛', hp: 350, dmg: 25, r: 0.90, speed: 5.5, hopCD: 2.0, color: '#767c94', eye: '#ffd23f', shape: 'tank',  elem: 'earth', boss: true, icon: 'sentinel.png' },
  fire_boss: { name: '熔岩魔像', hp: 380, dmg: 22, r: 0.90, speed: 4.8, hopCD: 2.0,
               color: '#b8442a', eye: '#ffb35c', shape: 'tank', elem: 'fire', boss: true, icon: 'fire_boss.png',
               ranged: { range: 6.5, cd: 2.6, dmg: 16, speed: 6.5,
                          aoe: { r: 1.8, wallDmg: 30 } } },
};

// ── 屬性相剋:attackElem → enemyElem → 倍率(未列 = 1.0)──
// 光剋暗、焰剋冰、冰剋焰、重擊(鎚)剋石;同屬性打折
const ELEM_VS = {
  light: { dark: 1.6 },
  fire:  { frost: 1.6, dark: 1.2, fire: 0.6 },
  frost: { fire: 1.6, dark: 1.2, frost: 0.6 },
  smash: { earth: 1.6 },
};
function elemMult(atk, def) {
  return (atk && def && ELEM_VS[atk] && ELEM_VS[atk][def]) || 1;
}

// ── 衝裝(強化卷軸)──
// 每級 +15% 武器/鎬威力、護甲 +4%;+4/+5 有失敗率(失敗只噴卷軸不炸裝)
const ENH_CFG = {
  maxLv: 5,
  scrolls: lv => lv + 1,            // 衝到 lv 需要的卷軸數(衝+1要1張…衝+5要5張)
  rate:    [1, 1, 1, 0.7, 0.5],     // 衝 +1..+5 的成功率
  dmgPer: 0.15, armorPer: 0.04,
};
function enhMult(s) { return 1 + ENH_CFG.dmgPer * ((s && s.lv) || 0); }
function enhArmorBonus(s) { return ENH_CFG.armorPer * ((s && s.lv) || 0); }
// 該物品是否可強化(武器/鎬/護甲/遠程武器皆可,消耗品與建材不行)
function isEnhancable(id) {
  const it = ITEMS[id];
  return !!(it && (it.sword || it.pick || it.armor || it.ranged));
}

// 已放置物件的耐久
const OBJ_HP = { torch: 4, workbench: 20, furnace: 20, tower: 50, archer_tower: 40, chest: 12, nest: 60 };
// 物件光照半徑
const OBJ_LIGHT = { torch: 7, tower: 6, furnace: 3, workbench: 2.5, archer_tower: 3 };
// 會擋路的物件
const OBJ_SOLID = { workbench: true, furnace: true, tower: true, archer_tower: true, chest: true, nest: true };

// ── 世界據點(隨機生成)──
// chest=廢墟寶箱(敲開拿戰利品) / nest=蝕影巢穴(持續生怪,拆掉噴光晶+卷軸)
const POI_CFG = {
  ruins: 7,   // 廢墟數(石磚小房,內有寶箱)
  nests: 6,   // 巢穴數
  pools: 10,  // 幽光水池數(釣魚點)
};

// ── NPC 商人:中層區域隨機生成的固定攤位,用多餘資源換稀有材料。
// 解鎖階段 = 星核碎片數(0~3,跟已擊敗神殿數一對一對應,且已經是即時同步資料,不用另外做同步)。
// 各階 offers 採累加制:低階項目在高階依然存在,不會消失。
const TRADER_CFG = {
  count: 1, icon: '🧙', name: '流浪商人',
  stages: [
    { need: 0, offers: [
      { give: { stone: 20 },      get: { lumite: 3 } },
      { give: { wood: 15 },       get: { coal: 6 } },
      { give: { copper_ore: 10 }, get: { iron_ore: 4 } },
    ] },
    { need: 1, offers: [
      { give: { iron_bar: 4 },    get: { enh_scroll: 1 } },
      { give: { lumite: 12 },     get: { gold_ore: 3 } },
      { give: { coal: 15 },       get: { iron_bar: 3 } },
    ] },
    { need: 2, offers: [
      { give: { gold_bar: 3 },    get: { enh_scroll: 3 } },
      { give: { gold_ore: 8 },    get: { diamond: 1 } },
      { give: { arrow: 20 },      get: { lumite: 10 } },
    ] },
    { need: 3, offers: [
      { give: { diamond: 2 },     get: { enh_scroll: 5 } },
      { give: { gold_bar: 6 },    get: { diamond: 2 } },
    ] },
  ],
};
// 目前對玩家可見的全部交易項目(依 G.core.shards 累加展開),扁平陣列方便面板用 index 對應
function traderOffers() {
  const n = G.core.shards;
  const list = [];
  for (const stage of TRADER_CFG.stages) if (stage.need <= n) list.push(...stage.offers);
  return list;
}

// 巢穴種類(世界生成時依 weight 加權抽選,見 world.js pickNestType):
// spawnCD=每次嘗試生怪的間隔秒數 / nearCap=周圍活怪數到此就暫停生 /
// spawnType 不填=沿用原本依區域決定生什麼怪的邏輯,填了就固定生該種
// spawnCount=一次生幾隻 / elite=精英巢穴,生出來的怪會套用 ELITE_CFG 加成
const NEST_TYPES = {
  common: { name: '蝕影巢穴', icon: '🕸️', hp: 60,  spawnCD: 8,  nearCap: 3, weight: 6, color: '#ffb35c' },
  swarm:  { name: '孢群巢穴', icon: '🟢', hp: 45,  spawnCD: 4,  nearCap: 5, weight: 3, color: '#7dff8e',
            spawnType: 'spore', spawnCount: 2 },
  elite:  { name: '精英巢穴', icon: '💀', hp: 150, spawnCD: 16, nearCap: 2, weight: 1, color: '#ff5d5d',
            elite: true },
};
// 精英怪加成(套用在 NEST_TYPES.elite 生出來的怪身上,見 entities.js spawnEnemy)
const ELITE_CFG = { hpMult: 2.2, dmgMult: 1.5, scale: 1.35, xpMult: 2 };
// 寶箱戰利品表(依區域 zone 0/1/2 抽 2~3 項)
const CHEST_LOOT = [
  [ ['arrow', 8], ['copper_bar', 2], ['enh_scroll', 1], ['lumite', 3], ['cooked_mushroom', 2] ],
  [ ['arrow', 12], ['iron_bar', 2], ['enh_scroll', 1], ['lumite', 4], ['bow', 1] ],
  [ ['arrow', 15], ['gold_bar', 2], ['enh_scroll', 2], ['lumite', 6], ['crossbow', 1] ],
];

// ===== 小工具 =====
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function dist(x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); }
function angDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return Math.abs(d);
}
