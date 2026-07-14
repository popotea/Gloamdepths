// ===== 全域常數與資料表 =====
const TILE = 40;                 // 每格像素
const MAP_W = 200, MAP_H = 200;  // 地圖大小(格)
const CX = MAP_W / 2, CY = MAP_H / 2;
const TAU = Math.PI * 2;

// 更新紀錄:主選單「📜 更新紀錄」按鈕顯示用,純展示、不影響任何遊戲邏輯,
// 新增功能時手動往陣列最前面補一筆(最新在最上面)
const CHANGELOG = [
  { date: '2026-07-14', items: [
    '💍 裝備欄新增第四格「飾品」:拾取戒指(擴大撿東西範圍)、敏捷護符(機率完全閃避)、獵殺勳章(機率暴擊)',
    '🛡️ 星核超載餵食:能量餵滿了繼續餵光晶,多的會轉成護盾,優先幫星核擋暗潮傷害',
    '🐛 修正背包/快捷欄的道具數量有時要動一下滑鼠(切換選中格)才會更新成正確數字的問題',
    '🎁 玩家間贈送:對著隊友右鍵,手上的東西直接整疊送過去',
    '🗼 新增三種塔:加農塔(範圍爆炸傷害)、連弩塔(同時鎖定多隻怪)、重砲塔(優先狙擊精英/Boss,單發爆傷極高)',
    '🎽 角色裝備欄位:頭盔/胸甲/護腿三個獨立部位,右鍵或拖曳穿上,不再是「背包裡塞一件就生效」',
    '💀 怪物有機率掉落裝備,越強的怪物掉的越好,神殿 Boss 與最終波守衛必掉一件金裝',
    '🐾 寵物系統:5 種被動跟班寵物(螢光蝠/燼尾狐/岩甲龜/智光靈/幸運蛾),工作台合成召喚物,右鍵召喚/收回',
    '🗺️ 地圖強化:小地圖可直接點擊開啟大地圖,新增隊友名單(方向+距離),倒下隊友有醒目提示',
    '🚶 修正斜向靠近牆角會卡住走不過去的問題,移動更順暢',
  ] },
  { date: '2026-07-13', items: [
    '🆘 隊友救援系統:倒下不會直接陣亡,隊友靠近站著能救回來(再被打一下就真的沒救了)',
    '💬 快速手勢輪盤(C 鍵)+ 🏆 成就/圖鑑系統(ESC 選單新分頁)',
    '⚔️ 武器揮擊特效上色、打擊衝擊波動畫',
    '🚪 防守強化:光簾閘門、歸巢螢石、凜鈴塔、地刺陷阱、誘光罐',
    '🍲 新增多種料理/照明/裝飾物品',
  ] },
  { date: '2026-07-12', items: [
    '⛏️ 礦物分布改集中礦床(挖礦更有 Core Keeper 的感覺),新增儲物箱、自動熔煉爐,自動化道鏈全線打通',
    '🌑 通關解封第五區域「淵核區」,新增無盡模式(通關後暗潮無限循環)',
    '🎨 Q 版可愛畫風全面翻新(角色/UI/文案)',
    '💾 多存檔槽位、房主斷線自動轉移接棒、觀戰模式',
  ] },
  { date: '2026-07 上旬', items: [
    '🌟 天賦樹系統(每級 1 點,T 鍵分配 6 種被動)',
    '🐔 動物養殖、🌾 農耕系統、🎣 釣魚、🚧 圍籬',
    '🗺️ 大地圖、🧙 NPC 商人、🎚️ 難度選項',
    '🔥❄️👻 三神殿守望者差異化(火系/冰系/穿牆系 Boss)',
    '🛤️ 軌道加速、⚙️ 自動採礦機 + 傳輸帶',
    '🍳 料理 buff、🔧 裝備耐久與修理',
  ] },
];

// 星核設定
const CORE_CFG = {
  maxE: 100,
  drain: 0.25,        // 每秒流失能量
  feed: 6,            // 每顆光晶補充能量
  hitDrain: 5,        // 暗潮怪打星核一下扣的能量
  needShards: 3,
};
// 星核超載餵食(護盾):能量已滿時繼續餵光晶,多的轉換成護盾——解決「能量滿了,多挖的光晶除了賣掉沒地方用」的痛點。
// 護盾優先吸收任何星核傷害來源(見 drainCore),feedShield 刻意比 feed(6)低,反映「溢出」的轉換效率打折
const SHIELD_CFG = { maxShield: 30, feedShield: 3 };

// 暗潮設定
const WAVE_CFG = {
  first: 240,         // 開局幾秒後第一波
  interval: 240,      // 之後每隔幾秒一波
  warn: 30,           // 提前幾秒警告
  spawnDist: 28,      // 從離星核多遠的黑暗處出現
};

// 無盡模式:通關後遊戲不結束,暗潮以遞增強度繼續來襲(數量走既有 wave.n 線性成長,
// 傷害走 dmgPerWave 疊加);星核照樣耗能、能量歸零依然全隊失敗——通關不是免死金牌。
// 延續難度設計的鐵律:只加傷害與數量,不加血量(「更痛更多」而不是「更肉」)
const ENDLESS_CFG = {
  rest: 150,          // 通關後第一波無盡暗潮前的喘息(秒),讓玩家先去淵核區逛逛
  dmgPerWave: 0.06,   // 每波無盡暗潮敵人傷害 +6%
  dmgCap: 3.0,        // 傷害倍率上限(疊到 +200% 封頂,避免後期數值失控)
};

// 難度選項:開新世界時選定,存進 G.difficulty(存讀檔一起帶)。
// 三個倍率各自乘進既有計算點(星核流失/暗潮數量/敵人傷害),不改動基礎數值表,
// 才不用把 easy/normal/hard 三份平衡分開維護。
const DIFFICULTY_CFG = {
  easy:   { label: '輕鬆', desc: '星核流失慢、暗潮較少較弱,適合想悠閒探索建造的玩家',
            coreDrainMult: 0.7, waveCountMult: 0.75, enemyDmgMult: 0.75 },
  normal: { label: '一般', desc: '標準難度,原汁原味的挑戰曲線',
            coreDrainMult: 1,   waveCountMult: 1,    enemyDmgMult: 1 },
  hard:   { label: '困難', desc: '星核流失快、暗潮更多更痛,適合想要硬核生存壓力的玩家',
            coreDrainMult: 1.35, waveCountMult: 1.4, enemyDmgMult: 1.3 },
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
  phantom: 8, breaker: 20, abyss: 16, sentinel: 60, fire_boss: 65, frost_boss: 68, void_boss: 70,
  revenant: 24, voidling: 18,
};

// 神殿 Boss 額外掉落(除了必掉 2 張強化卷軸 + 1 顆星核碎片給擊殺者之外的加碼獎勵)
const SHRINE_BOSS_LOOT = {
  sentinel:   { gold_ore: 3 },
  fire_boss:  { gold_ore: 2, lumite: 4 },   // 火系加碼一點光晶,呼應「火」與能量的意象
  frost_boss: { gold_ore: 2, iron_bar: 2 }, // 冰系加碼鐵錠,呼應「寒霜」與武裝意象
  void_boss:  { gold_ore: 3, lumite: 2 },   // 穿牆系加碼一點金礦+光晶,不特別偏武裝/能量
};
// 守望者甦醒台詞(Q版主題:打敗神殿 Boss 不是殺戮,是把被黑暗纏繞的守望者「喚醒」)
const SHRINE_BOSS_QUOTES = {
  sentinel:   '💬「……守望結束了。謝謝你們還記得光。」',
  fire_boss:  '💬 燼:「……火還暖著。拿去吧,別再讓它熄了。」',
  frost_boss: '💬 凜:「……好長的一場雪。碎片給你們,我想看看春天。」',
  void_boss:  '💬 寞:「……影子也想見光,你懂嗎?去吧,帶它回家。」',
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
  WATER: 17, FENCE: 18, RAIL: 19,
  VOIDROCK: 20, SEAL: 21, // 第五區域「淵核區」:淵岩(比黑曜更硬)/ 封印牆(通關前擋住,通關後解除)
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
  // 軌道:非固體(可站上去),站上去移速大幅提升(RAIL_CFG),定位是打通基地↔遠方礦區/神殿的快速通道。
  // rail:true 讓 doMine 能敲掉回收(非固體地形一般敲不掉,靠這個旗標開一條回收路徑);渲染疊在地板上(貼圖須透明背景)
  [T.RAIL]:     { solid: false, rail: true, name: '軌道', drop: { id: 'rail', n: 1 }, tex: 'rail.png' },
  // 第五區域「淵核區」(通關後解封才進得去):淵岩比黑曜更硬(tier 3,金鎬〔頂級〕才挖得動),掉石頭當建材
  [T.VOIDROCK]: { solid: true, hp: 40, tier: 3, name: '淵岩', drop: { id: 'stone', n: 2 }, c1: '#3a2a52', c2: '#241830', tex: 'voidrock.png' },
  // 封印牆:通關前圍住淵核區,hp:Infinity 挖不掉(靠通關事件解除),自帶紫色封印光暈(render 特判)
  [T.SEAL]:     { solid: true, seal: true, hp: Infinity, tier: 99, name: '遠古封印', light: 1.5, c1: '#5a3a8e', c2: '#3c2868', tex: 'seal.png' },
};

// 軌道加速:站在 T.RAIL 上時移速倍率(v1 只做「加速地板」,不做真的礦車實體)
const RAIL_CFG = { speedMult: 2.6 };

// ── 箭塔:玩家手動補箭矢的防禦建築,彈藥打完就停火,靠玩家回來補給形成天然上限 ──
// dmg 比光塔(12)高,但沒箭就是廢鐵;每人可蓋數量上限避免堆成怪打不穿的彈幕牆
const ARCHER_TOWER_CFG = {
  maxAmmo: 20, dmg: 20, range: 6, cd: 0.9,
  maxPerPlayer: 3,
};

// 自動採礦機:定位是「後期省事的 QoL」而非「取代探索的效率解」,三重設計張力折衷同時生效——
// (1) 只能架在已探索格子(玩家得先冒險點亮地圖)(2) 產量遠低於手動(cd 長)(3) 需光晶持續供電(跟星核資源迴圈掛勾)
// 定義在 ITEMS 之前:ITEMS.auto_miner 的 desc 用模板字串引用了 maxPerPlayer(const TDZ,晚定義會載入即崩)
const AUTO_MINER_CFG = {
  tier: 2,          // 可挖到金礦脈(tier 2),挖不動鑽石礦(tier 3)——最強礦物仍要玩家親自下礦
  cd: 4.0,          // 每 4 秒才採一次(玩家手動約 0.26s CD,產量遠低於手動)
  range: 1,         // 掃描相鄰 8 格(切比雪夫距離 1)內的礦脈
  maxFuel: 20,      // 光晶燃料上限
  fuelPerMine: 1,   // 每採一次礦消耗 1 光晶燃料
  maxPerPlayer: 4,  // 每人數量上限(避免整片礦區被機器佔滿,失去探索意義)
};
// 傳輸帶:把掉落物往 dir 方向推(0=右 1=下 2=左 3=上),定位是把偏遠礦機產出集中送到好撿的點
const BELT_CFG = { push: 3.2, maxPerPlayer: 40 }; // push=推力(格/秒);上限寬鬆,長距離鋪設用
// 儲物箱:放各種道具的固定容器,是自動化道鏈的終點——傳輸帶把礦推進儲物箱自動入庫。
// 房主權威:內容存在物件的 items 陣列,經 setObj 廣播讓所有客戶端同步(容量小,每次存取全量廣播沒負擔)。
const STORAGE_CFG = { slots: 24 };
// 自動熔煉爐:自動化道鏈的中繼站(礦機→帶→熔爐→帶→箱)。跟礦機同一套「慢但省事」的張力:
// 吃煤當燃料、節奏遠慢於玩家手動合成;只熔礦石,料理仍要玩家自己開熔爐做。
// 原料緩衝借用物件的 items 欄位(跟儲物箱同格式)——存讀檔/init 的固定欄位陣列完全不用改
const AUTO_SMELTER_CFG = {
  cd: 5.0,          // 每 5 秒熔一鍋(玩家手動合成是瞬間,機器慢工換免顧)
  maxFuel: 20,      // 煤炭燃料上限
  fuelPerSmelt: 1,  // 每熔一鍋吃 1 煤
  maxBuffer: 30,    // 原料緩衝上限(傳輸帶餵進來的礦石總數)
  maxPerPlayer: 4,  // 每人數量上限(跟礦機同標準)
};
// 熔煉對照表(比率與熔爐配方一致:2 礦 = 1 錠,機器不給折扣)
const SMELT_MAP = {
  copper_ore: { out: 'copper_bar', need: 2 },
  iron_ore:   { out: 'iron_bar',   need: 2 },
  gold_ore:   { out: 'gold_bar',   need: 2 },
};

// ── 防守主城強化批(2026-07-13,第六批):城門/回城/控場塔/地刺/誘餌 ──
// 凜鈴塔:零傷害的純控場塔——把怪「黏」在箭塔/光塔火力圈與地刺毯上,不替玩家殺怪(鐵律:自動化不取代玩家)。
// 緩速對穿牆幽影一樣有效(ghost 的移動用同一份 e.vx/vy),是目前唯一反制穿牆突襲的防禦建築;冰系蝕影抗性=緩速時間減半
const FROST_TOWER_CFG = { range: 3.5, cd: 2.5, dur: 2.6, mult: 0.55, maxPerPlayer: 2 };

// ── 塔類第二批(2026-07-14,第十二批):填補光塔/箭塔/凜鈴塔之外的空缺,三塔各自不重疊 ──
// 加農塔:慢速砲彈,命中處範圍爆炸,克怪群(唯一會動 explodeAt/updateProjs 共用函式的塔,見 cfg.hitEnemies)
const CANNON_TOWER_CFG = { range: 6, cd: 3.2, dmg: 18, aoeR: 1.8, speed: 9, maxPerPlayer: 2 };
// 連弩塔:同時鎖定範圍內最多 targets 隻怪各射一箭,免彈藥但單發傷害低,克分散怪群(跟箭塔的彈藥制單體高傷互補)
const MULTI_TOWER_CFG = { range: 5, cd: 1.6, dmg: 9, targets: 3, speed: 12, maxPerPlayer: 2 };
// 重砲塔:射程全塔類最遠,優先鎖定精英/神殿 Boss(沒有才退回打最近的),單發爆傷極高但冷卻很慢
const SNIPER_TOWER_CFG = { range: 9, cd: 4.0, dmg: 55, eliteMult: 1.6, speed: 20, maxPerPlayer: 2 };
// 地刺陷阱:貼地消耗性陷阱,蝕影踩到被扎(穿牆幽影飄在空中扎不到)。o.hp 直接當「剩餘刺數」用,
// 扎完自動碎裂;不給經驗值(hurtEnemy 的 src 不帶 name)=補位而非取代玩家輸出
const SPIKE_TRAP_CFG = { dmg: 7, cd: 0.8, charges: 20 };
// 誘光罐:裝滿光的假星核——「蝕影怕光又想搶光」的敘事直接變機制:暗潮怪在範圍內且身邊沒玩家可追時,
// 優先撲向罐子(4 格內有玩家仍追人=不能拿它當隱形掛機盾;穿牆系看得穿贗品不上當)
const DECOY_CFG = { range: 10, maxPerPlayer: 2 };

// 快速手勢(emote):按 C 開輪盤,選了就在頭上冒圖示氣泡,co-op 溝通用(「這裡有礦」「小心」),
// 純視覺+一句話廣播,不影響任何遊戲數值。冷卻防手滑連點洗頻。
const EMOTE_CFG = { dur: 2.2, cd: 0.6 };
const EMOTE_LIST = [
  { icon: '👋', text: '哈囉!' },
  { icon: '👍', text: '好耶' },
  { icon: '❗', text: '這裡有礦!' },
  { icon: '⚠️', text: '小心!' },
  { icon: '🆘', text: '救我!' },
  { icon: '❤️', text: '謝啦' },
  { icon: '😂', text: '笑死' },
  { icon: '🎉', text: '太棒了!' },
];

// 成就/圖鑑:全隊共享的里程碑紀錄(不分玩家,呼應「螢火隊」是一起打拼的);
// 達成時 unlockAchv(entities.js)廣播訊息+寫入 G.achv,存讀檔保留。圖鑑(擊殺過的怪物種類)
// 另外走 G.bestiary,直接借用 ENEMY_TYPES 的 name/icon,不用再開一張表。
const ACHIEVEMENTS = {
  first_blood:   { name: '初次獵殺', icon: '⚔️', desc: '擊敗第一隻蝕影' },
  first_shard:   { name: '星核之心', icon: '🔷', desc: '帶回第一塊星核碎片' },
  first_boss:    { name: '喚醒者', icon: '🗿', desc: '擊敗一座神殿守望者' },
  all_boss:      { name: '三神合一', icon: '👑', desc: '擊敗全部三座神殿守望者' },
  first_diamond: { name: '閃耀之礦', icon: '💎', desc: '挖到第一顆鑽石' },
  auto_pioneer:  { name: '自動化先驅', icon: '⚙️', desc: '建造第一台自動採礦機' },
  first_tame:    { name: '牧場主人', icon: '🐔', desc: '第一次餵飽動物' },
  revive_hero:   { name: '救援英雄', icon: '💪', desc: '成功救起一次倒下的隊友' },
  wave_survivor: { name: '暗潮不倒', icon: '🌊', desc: '撐過第一波暗潮' },
  void_breach:   { name: '深淵行者', icon: '🌑', desc: '踏入淵核區' },
  endless_enter: { name: '永不止息', icon: '🏆', desc: '通關,進入無盡模式' },
  max_level:     { name: '滿級戰士', icon: '⭐', desc: `練到等級上限 Lv.${LEVEL_CFG.maxLv}` },
  first_pet:     { name: '有夥伴了', icon: '🐾', desc: '第一次召喚寵物出戰' },
  first_equip:   { name: '全副武裝', icon: '🎽', desc: '第一次穿上裝備欄裝備' },
  first_gift:    { name: '好朋友', icon: '🎁', desc: '第一次送禮給隊友' },
};
// 歸巢螢石:手持右鍵引導數秒傳送回星核;移動/受傷立即中斷(不消耗),完成才消耗——
// 探索半徑不再被「暗潮警告 30 秒內趕不趕得回」綁死,但被怪纏上時還是得先殺出來才能回城
const RECALL_CFG = { channel: 4, moveCancel: 0.3 };

// 隊友救援(倒地非陣亡):致命傷不再直接進入 5 秒重生,而是先「倒下」——
// 有其他存活(且非倒下)隊友時才會觸發此狀態,單機/隊友全滅時直接走原本的陣亡流程(零額外等待)。
// 倒下期間不能行動、不能移動,靠隊友靠近站著讀秒救回(不是無腦送頭:再挨一下=直接陣亡,是真正的風險)。
const REVIVE_CFG = {
  downedDur: 25,   // 倒下後幾秒沒被救回 = 徹底陣亡(走原本的重生流程)
  range: 1.6,      // 隊友要多近才算「在救援」
  reviveTime: 3.5, // 需要持續站在旁邊幾秒才能救起來
  hpFrac: 0.35,    // 救起來時的血量比例(不是滿血,避免無腦送頭變成零成本)
};
// 打擊特效(命中閃光/衝擊波)動畫時長,entities.js(產生)與 render.js(繪製進度)共用同一個數字
const HITFX_DUR = 0.32;

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

// ── 寵物/跟班:純被動,不會被打也不會攻擊,右鍵召喚物切換出戰(不消耗,可換著玩)。
// kind 沿用 BUFF_INFO 的分類(speed/guard/mine/regen/vigor),數值比天賦小一階避免疊爆;
// 視覺上是「跟著玩家位置算出來的裝飾性偏移」(render.js),不是獨立模擬的實體——
// 不用另外同步座標、不用碰撞判定,零額外連線負擔,召喚狀態只有 p.pet 一個欄位要同步。
const PET_TYPES = {
  glowbat:     { name: '螢光蝠', icon: '🦇', item: 'pet_glowbat',      kind: 'mine',  val: 0.08, desc: '挖掘力 +8%' },
  emberfox:    { name: '燼尾狐', icon: '🦊', item: 'pet_emberfox',     kind: 'speed', val: 0.06, desc: '移動速度 +6%' },
  stoneturtle: { name: '岩甲龜', icon: '🐢', item: 'pet_stoneturtle',  kind: 'guard', val: 0.08, desc: '受到的傷害再 -8%' },
  witlight:    { name: '智光靈', icon: '🧚', item: 'pet_witlight',     kind: 'regen', val: 1,    desc: '每秒回 1 點血' },
  luckmoth:    { name: '幸運蛾', icon: '🦋', item: 'pet_luckmoth',     kind: 'vigor', val: 0.4,  desc: '體力回復速度 +40%' },
};
function petOf(p) { return (p.pet && PET_TYPES[p.pet]) || null; }
function petVal(p, kind) { const pet = petOf(p); return (pet && pet.kind === kind) ? pet.val : 0; }

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

// 掉落物磁吸基礎半徑,拾取戒指(ring_magnet)在這基礎上乘倍率(updateDrops 用)。
// 定義在 ITEMS 之前:ring_magnet 的 desc 模板字串引用了這個值(TDZ,晚定義會載入即崩)
const MAGNET_RANGE = 2.4;

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
  // 裝備欄位(頭盔/胸甲/護腿):equipSlot 標記穿哪格,右鍵或拖進裝備格生效,跟舊版「背包裡最好的一件」不同
  iron_armor:      { name: '鐵甲', icon: '🛡️', armor: 0.3, equipSlot: 'chest', max: 1, tint: '#5c6570', desc: '裝備欄:胸甲,受傷 -30%' },
  gold_armor:      { name: '金甲', icon: '🛡️', armor: 0.5, equipSlot: 'chest', max: 1, tint: '#8a6d1f', desc: '裝備欄:胸甲,受傷 -50%' },
  iron_helmet:     { name: '鐵盔', icon: '🪖', armor: 0.12, equipSlot: 'head', max: 1, tint: '#5c6570', desc: '裝備欄:頭盔,受傷 -12%(與胸甲疊加)' },
  gold_helmet:     { name: '金盔', icon: '🪖', armor: 0.20, equipSlot: 'head', max: 1, tint: '#8a6d1f', desc: '裝備欄:頭盔,受傷 -20%(與胸甲疊加)' },
  iron_greaves:    { name: '鐵護腿', icon: '🥾', speedBonus: 0.05, equipSlot: 'legs', max: 1, tint: '#5c6570', desc: '裝備欄:護腿,移動速度 +5%' },
  gold_greaves:    { name: '金護腿', icon: '🥾', speedBonus: 0.08, equipSlot: 'legs', max: 1, tint: '#8a6d1f', desc: '裝備欄:護腿,移動速度 +8%' },
  ring_magnet:     { name: '拾取戒指', icon: '🧲', equipSlot: 'accessory', magnetMult: 1.5, max: 1,
                     desc: `裝備欄:飾品,掉落物磁吸範圍 ×1.5(${MAGNET_RANGE}→${MAGNET_RANGE * 1.5} 格)` },
  ring_dodge:      { name: '敏捷護符', icon: '💨', equipSlot: 'accessory', dodgeChance: 0.15, max: 1,
                     desc: '裝備欄:飾品,15% 機率完全閃避受到的傷害' },
  ring_crit:       { name: '獵殺勳章', icon: '🏅', equipSlot: 'accessory', critChance: 0.2, critMult: 1.8, max: 1,
                     desc: '裝備欄:飾品,近戰/遠程攻擊 20% 機率造成 1.8 倍傷害' },
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
  // 軌道:放在地板上的加速地帶,站上去移速大增,拿來打通基地↔遠方礦區/神殿的快速通道
  rail:            { name: '軌道', icon: '🛤️', placeTile: T.RAIL,
                     desc: '鋪在地板上,站上去移動速度大幅提升;可用鎬敲掉回收' },
  // 自動採礦機:架在已探索的礦脈旁,右鍵拿光晶供電,自動慢慢採礦(掉在腳邊)
  auto_miner:      { name: '自動採礦機', icon: '⚙️', place: 'auto_miner',
                     desc: `架在已探索區域的礦脈旁,右鍵拿光晶供電後自動採集鄰近礦脈(可採到金礦,挖不動鑽石)。
產量遠低於手動,是省事用的;每人最多蓋 ${AUTO_MINER_CFG.maxPerPlayer} 台` },
  // 傳輸帶:把地上的掉落物往箭頭方向推,連成道鏈把偏遠礦機的產出送回好撿的點;右鍵空手旋轉方向
  belt:            { name: '傳輸帶', icon: '➡️', place: 'belt',
                     desc: '鋪在地板上,把地上的掉落物往箭頭方向推送;右鍵空手可旋轉方向,可站上去、可敲掉回收' },
  // 儲物箱:放各種道具的大容器,右鍵開啟存取;傳輸帶把礦推進來會自動入庫(道鏈終點)
  storage:         { name: '儲物箱', icon: '📦', place: 'storage',
                     desc: `放各種道具的容器(${STORAGE_CFG.slots} 格),右鍵開啟存取。傳輸帶把掉落物推到它上面會自動入庫,是自動採礦道鏈的終點` },
  // 自動熔煉爐:道鏈中繼站,傳輸帶送礦石/煤進來自動熔錠
  auto_smelter:    { name: '自動熔煉爐', icon: '🏭', place: 'auto_smelter',
                     desc: `自動把礦石熔成錠(每 ${AUTO_SMELTER_CFG.cd} 秒一鍋,吃煤當燃料,比率跟熔爐一樣 2 礦=1 錠)。
傳輸帶把礦石/煤推進來會自動吸收,成品掉在爐邊可再用帶子接走;右鍵手持煤補燃料、手持礦石塞原料。每人最多 ${AUTO_SMELTER_CFG.maxPerPlayer} 台` },
  // 動物養殖:產物與肉,接進料理系統
  egg:             { name: '幽光蛋', icon: '🥚', food: 12, desc: '幽穴雞餵食後定時產下;可做菇蛋燒' },
  milk:            { name: '苔奶', icon: '🥛', food: 15, desc: '苔絨牛餵食後定時產出;可做奶菇濃湯' },
  meat:            { name: '獸肉', icon: '🥩', food: 8, desc: '生肉勉強能吃,烤過才是正餐' },
  cooked_meat:     { name: '烤肉', icon: '🍗', food: 50 },
  omelet:          { name: '菇蛋燒', icon: '🍳', food: 35 },
  cream_stew:      { name: '奶菇濃湯', icon: '🍵', food: 30, buff: { kind: 'vigor', mult: 1.8, dur: 90 },
                     desc: '回血 30;體力回復速度 +80%(衝刺更快回滿),持續 90 秒' },
  // ── 第五批擴充(2026-07-13):更多料理 / 照明 / 裝飾,全部重用既有系統(food+buff / place 物件)──
  mushroom_skewer: { name: '螢菇串燒', icon: '🍡', food: 55, desc: '烤得金黃的螢光蘑菇串,純飽足、大回血' },
  crystal_cake:    { name: '晶糖糕', icon: '🍰', food: 30, buff: { kind: 'mine', mult: 1.4, dur: 100 },
                     desc: '回血 30;挖掘力 +40%,持續 100 秒' },
  spicy_meat:      { name: '香辣烤肉', icon: '🌶️', food: 45, buff: { kind: 'speed', mult: 1.25, dur: 100 },
                     desc: '回血 45;移動速度 +25%,持續 100 秒' },
  hearty_soup:     { name: '暖心濃湯', icon: '🥘', food: 40, buff: { kind: 'regen', value: 3, dur: 70 },
                     desc: '回血 40;每秒再回 3 點血,持續 70 秒' },
  power_shake:     { name: '光晶能量飲', icon: '🧋', food: 20, buff: { kind: 'vigor', mult: 2.0, dur: 100 },
                     desc: '回血 20;體力回復速度翻倍,持續 100 秒(衝刺流最愛)' },
  // 照明:place 物件,自帶光源、不擋路(比火把亮,基地照明用);item id === place type,敲掉回收同一 id
  lantern:         { name: '提燈', icon: '🏮', place: 'lantern', desc: '暖光提燈,照明範圍比火把大;可敲掉回收' },
  crystal_lamp:    { name: '晶燈柱', icon: '💡', place: 'crystal_lamp', desc: '光晶燈柱,照明範圍最大,把基地照得亮堂堂;可敲掉回收' },
  // 裝飾:純擺飾,不擋路無功能,蓋基地插旗宣示地盤用
  banner:          { name: '螢火旗幟', icon: '🚩', place: 'banner', desc: '螢火隊的旗幟,純裝飾;插一面宣示這是你們的地盤' },
  // ── 防守主城強化批(2026-07-13,第六批):詳見 CLAUDE.md「防守主城強化批」──
  // 光簾閘門:玩家(與投射物)自由穿過、蝕影視為牆——解「築牆防守把自己出門的路也堵死」的痛點。
  // 刻意不進 OBJ_SOLID(isSolid 的 forEnemy 參數才把它當牆),投射物也飛得過=箭塔隔門開火
  gate:            { name: '光簾閘門', icon: '🚪', place: 'gate',
                     desc: '掛滿光晶簾的小門:螢火隊與箭矢自由穿過,蝕影會被擋住(牠們怕這道光,只敢隔著簾子啃)' },
  recall_stone:    { name: '歸巢螢石', icon: '🌀', recall: true, max: 5,
                     desc: `握緊它呼喚星核:站穩 ${RECALL_CFG.channel} 秒後傳送回家。移動或受傷會中斷(沒成功不消耗);暗潮警報響了也來得及回防` },
  frost_tower:     { name: '凜鈴塔', icon: '🔔', place: 'frost_tower',
                     desc: `掛著冰晶的小鈴鐺:每 ${FROST_TOWER_CFG.cd} 秒叮一聲,${FROST_TOWER_CFG.range} 格內的蝕影通通腳麻(大幅緩速;連穿牆幽影都黏得住,冰系抗性減半)。
不造成傷害,搭配箭塔/地刺效果拔群。每人最多 ${FROST_TOWER_CFG.maxPerPlayer} 座` },
  cannon_tower:    { name: '加農塔', icon: '🎆', place: 'cannon_tower',
                     desc: `發射會爆炸的砲彈,命中處 ${CANNON_TOWER_CFG.aoeR} 格內的蝕影一起遭殃,克怪群。射程 ${CANNON_TOWER_CFG.range} 格,冷卻較慢。每人最多蓋 ${CANNON_TOWER_CFG.maxPerPlayer} 座` },
  multi_tower:     { name: '連弩塔', icon: '🎯', place: 'multi_tower',
                     desc: `同時鎖定最多 ${MULTI_TOWER_CFG.targets} 隻範圍內的蝕影各射一箭,不用彈藥,適合對付分散的怪群。單發傷害不高,靠數量取勝。每人最多蓋 ${MULTI_TOWER_CFG.maxPerPlayer} 座` },
  sniper_tower:    { name: '重砲塔', icon: '🔭', place: 'sniper_tower',
                     desc: `射程全塔類最遠(${SNIPER_TOWER_CFG.range} 格),優先鎖定精英怪與神殿守衛狙擊,單發爆傷極高但冷卻很慢。每人最多蓋 ${SNIPER_TOWER_CFG.maxPerPlayer} 座` },
  spike_trap:      { name: '地刺陷阱', icon: '🪤', place: 'spike_trap',
                     desc: `鋪在地上的光刺:蝕影踩到被扎 ${SPIKE_TRAP_CFG.dmg} 傷還會被彈開(穿牆幽影飄著扎不到;螢火隊有穿鞋不怕)。共 ${SPIKE_TRAP_CFG.charges} 刺,扎完自動碎裂` },
  decoy:           { name: '誘光罐', icon: '🏺', place: 'decoy',
                     desc: `裝滿光的罐罐:暗潮蝕影會忍不住先去搶它,幫你分散火力、爭取回防時間(身邊有玩家時牠們還是先打人;穿牆幽影看得穿贗品)。每人最多 ${DECOY_CFG.maxPerPlayer} 個` },
  // 寵物召喚物:right-click 切換出戰/收回(不消耗,身上帶著就能反覆召喚);同時只能出戰一隻,
  // 召喚新的會自動收回舊的(doPet 的邏輯,不用玩家自己先收再召)
  pet_glowbat:     { name: '螢光蝠哨', icon: '🦇', pet: 'glowbat', max: 1,
                     desc: `召喚螢光蝠跟著你:${PET_TYPES.glowbat.desc}。右鍵切換出戰/收回` },
  pet_emberfox:    { name: '燼尾狐哨', icon: '🦊', pet: 'emberfox', max: 1,
                     desc: `召喚燼尾狐跟著你:${PET_TYPES.emberfox.desc}。右鍵切換出戰/收回` },
  pet_stoneturtle: { name: '岩甲龜哨', icon: '🐢', pet: 'stoneturtle', max: 1,
                     desc: `召喚岩甲龜跟著你:${PET_TYPES.stoneturtle.desc}。右鍵切換出戰/收回` },
  pet_witlight:    { name: '智光靈哨', icon: '🧚', pet: 'witlight', max: 1,
                     desc: `召喚智光靈跟著你:${PET_TYPES.witlight.desc}。右鍵切換出戰/收回` },
  pet_luckmoth:    { name: '幸運蛾哨', icon: '🦋', pet: 'luckmoth', max: 1,
                     desc: `召喚幸運蛾跟著你:${PET_TYPES.luckmoth.desc}。右鍵切換出戰/收回` },
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
  { out: 'iron_armor',   n: 1, cost: { iron_bar: 5 },            station: 'workbench' },
  { out: 'iron_helmet',  n: 1, cost: { iron_bar: 3 },            station: 'workbench' },
  { out: 'iron_greaves', n: 1, cost: { iron_bar: 3 },            station: 'workbench' },
  { out: 'gold_pick',   n: 1, cost: { gold_bar: 3, wood: 1 },   station: 'workbench' },
  { out: 'gold_sword',  n: 1, cost: { gold_bar: 3, wood: 1 },   station: 'workbench' },
  { out: 'gold_armor',   n: 1, cost: { gold_bar: 5 },            station: 'workbench' },
  { out: 'gold_helmet',  n: 1, cost: { gold_bar: 3 },            station: 'workbench' },
  { out: 'gold_greaves', n: 1, cost: { gold_bar: 3 },            station: 'workbench' },
  { out: 'ring_magnet',  n: 1, cost: { copper_bar: 3, lumite: 4 }, station: 'workbench' },
  { out: 'ring_dodge',   n: 1, cost: { iron_bar: 3, lumite: 6 },   station: 'workbench' },
  { out: 'ring_crit',    n: 1, cost: { gold_bar: 2, lumite: 6 },   station: 'workbench' },
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
  // 軌道:一次產 4 段,鐵錠+木材(金屬軌+木枕木的意象);要中期鐵器才鋪得起,但單段夠便宜可長距離鋪設
  { out: 'rail',         n: 4, cost: { iron_bar: 1, wood: 2 }, station: 'workbench' },
  // 自動化道鏈:採礦機是後期建築(金錠級,呼應「金鎬才挖得動金礦」),傳輸帶便宜可長距離鋪
  { out: 'auto_miner',   n: 1, cost: { gold_bar: 2, iron_bar: 3, lumite: 5 }, station: 'workbench' },
  { out: 'belt',         n: 4, cost: { iron_bar: 1, lumite: 1 },              station: 'workbench' },
  { out: 'storage',      n: 1, cost: { wood: 12, iron_bar: 2 },              station: 'workbench' },
  { out: 'auto_smelter', n: 1, cost: { stone: 8, copper_bar: 2, iron_bar: 2 }, station: 'furnace' }, // 在熔爐旁打造會熔煉的機器,主題呼應

  // 動物養殖產物料理
  { out: 'cooked_meat',  n: 1, cost: { meat: 1 },              station: 'furnace' },
  { out: 'omelet',       n: 1, cost: { egg: 1, mushroom: 1 },  station: 'furnace' },
  { out: 'cream_stew',   n: 1, cost: { milk: 1, glowcap: 1 },  station: 'furnace' },
  // 第五批擴充:料理(熔爐)
  { out: 'mushroom_skewer', n: 1, cost: { mushroom: 3 },                 station: 'furnace' },
  { out: 'crystal_cake',    n: 1, cost: { glowcap: 1, lumite: 2 },       station: 'furnace' },
  { out: 'spicy_meat',      n: 1, cost: { meat: 1, coal: 2 },            station: 'furnace' },
  { out: 'hearty_soup',     n: 1, cost: { fish: 1, glowcap: 1, egg: 1 }, station: 'furnace' },
  { out: 'power_shake',     n: 1, cost: { milk: 1, lumite: 1 },          station: 'workbench' },
  // 第五批擴充:照明/裝飾(工作台)
  { out: 'lantern',      n: 1, cost: { iron_bar: 1, lumite: 2 },         station: 'workbench' },
  { out: 'crystal_lamp', n: 1, cost: { gold_bar: 1, lumite: 4, stone: 2 }, station: 'workbench' },
  { out: 'banner',       n: 2, cost: { wood: 3, lumite: 1 },             station: 'workbench' },
  // 防守主城強化批:門/地刺開局就做得起,回城石/誘光罐吃光晶(跟餵星核搶同一資源=機會成本),凜鈴塔鐵器期解鎖
  { out: 'gate',         n: 1, cost: { wood: 8, lumite: 2 },             station: 'workbench' },
  { out: 'spike_trap',   n: 2, cost: { wood: 3, stone: 3 },              station: 'workbench' },
  { out: 'recall_stone', n: 1, cost: { lumite: 3, stone: 5 },            station: 'workbench' },
  { out: 'frost_tower',  n: 1, cost: { stone: 6, iron_bar: 2, lumite: 8 }, station: 'workbench' },
  { out: 'decoy',        n: 1, cost: { stone: 6, lumite: 4 },            station: 'workbench' },
  { out: 'cannon_tower', n: 1, cost: { stone: 10, iron_bar: 4, lumite: 8 }, station: 'workbench' },
  { out: 'multi_tower',  n: 1, cost: { wood: 12, stone: 4, iron_bar: 2 },   station: 'workbench' },
  { out: 'sniper_tower', n: 1, cost: { stone: 8, gold_bar: 4, lumite: 6 },  station: 'workbench' },
  // 寵物召喚物:成本跟天賦點取得速度相仿的中期材料,五選一慢慢收集不強迫二選一
  { out: 'pet_glowbat',     n: 1, cost: { copper_bar: 3, lumite: 3 },         station: 'workbench' },
  { out: 'pet_emberfox',    n: 1, cost: { iron_bar: 2, coal: 4 },             station: 'workbench' },
  { out: 'pet_stoneturtle', n: 1, cost: { stone: 10, iron_bar: 2 },           station: 'workbench' },
  { out: 'pet_witlight',    n: 1, cost: { lumite: 6, gold_ore: 2 },           station: 'workbench' },
  { out: 'pet_luckmoth',    n: 1, cost: { glowcap: 3, lumite: 3 },            station: 'workbench' },
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
  fire_boss: { name: '火之守望者・燼', hp: 380, dmg: 22, r: 0.90, speed: 4.8, hopCD: 2.0,
               color: '#b8442a', eye: '#ffb35c', shape: 'tank', elem: 'fire', boss: true, icon: 'fire_boss.png',
               ranged: { range: 6.5, cd: 2.6, dmg: 16, speed: 6.5,
                          aoe: { r: 1.8, wallDmg: 30 } } },
  frost_boss: { name: '冰之守望者・凜', hp: 400, dmg: 20, r: 0.90, speed: 4.2, hopCD: 2.0,
                color: '#3a6a8a', eye: '#c8f4ff', shape: 'tank', elem: 'frost', boss: true, icon: 'frost_boss.png',
                ranged: { range: 6.5, cd: 2.8, dmg: 14, speed: 6.0,
                           aoe: { r: 1.8, wallDmg: 26, slow: { mult: 0.5, dur: 2.5 } } } },
  void_boss: { name: '影之守望者・寞', hp: 360, dmg: 26, r: 0.85, speed: 5.4, hopCD: 1.6,
               color: '#4a3568', eye: '#ff8cf0', shape: 'ghost', elem: 'dark', boss: true, ghost: true, icon: 'void_boss.png' },
  // 第五區域「淵核區」專屬深層怪(比深淵蝕影強一階,但非 Boss;成群出現才危險)
  revenant: { name: '淵魂',   hp: 140, dmg: 28, r: 0.55, speed: 4.8, hopCD: 1.1, color: '#5a2a6e', eye: '#ff6cf0', shape: 'spike', elem: 'dark', icon: 'revenant.png' },
  voidling: { name: '蝕裂者', hp: 90,  dmg: 16, r: 0.46, speed: 3.8, hopCD: 1.5, color: '#3e2a6a', eye: '#c88cff', shape: 'mouth', elem: 'dark', wallMult: 3, icon: 'voidling.png',
              ranged: { range: 6, cd: 2.0, dmg: 16, speed: 8 } },
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
// 屬性特效色(揮擊弧光/投射物拖尾/命中衝擊波共用,render.js 讀):RGB 字串方便直接拼進 rgba()
const ELEM_FX_COLOR = { fire: '255,140,60', frost: '110,220,255', light: '255,240,180', dark: '190,120,255', smash: '210,210,220' };

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

// 裝備欄位(頭盔/胸甲/護腿),類似創世神的分部位裝備;護腿刻意給移速而非護甲,跟胸甲/頭盔做出取捨差異
const EQUIP_SLOT_NAME = { head: '頭盔', chest: '胸甲', legs: '護腿', accessory: '飾品' };
// 飾品欄(第四裝備格):給元素抗性/拾取範圍/閃避/暴擊這類「特殊」被動,跟頭盔/胸甲(護甲)、護腿(移速)的
// 數值型加成做出區隔;doEquip/doUnequip 已經是通用邏輯(讀 it.equipSlot 存進 p.equip[part]),
// 新增這個欄位不用改穿脫邏輯,只要新增物品+各自的生效點

// 怪物掉裝備:越強的怪 pool 越好,機率調這裡就好(不用動邏輯)。rate 是每隻怪死亡時的判定機率
const EQUIP_DROP_CFG = {
  pools: {
    weak:  ['iron_helmet', 'iron_greaves'],
    mid:   ['iron_helmet', 'iron_greaves', 'iron_armor'],
    elite: ['gold_helmet', 'gold_greaves', 'gold_armor'],
  },
  rate: { imp: 0.02, spore: 0.015, hunter: 0.04, spitter: 0.05, bomber: 0.05, phantom: 0.06, breaker: 0.08, abyss: 0.08, revenant: 0.12, voidling: 0.12 },
  tier: { imp: 'weak', spore: 'weak', hunter: 'weak', spitter: 'mid', bomber: 'mid', phantom: 'mid', breaker: 'mid', abyss: 'elite', revenant: 'elite', voidling: 'elite' },
  eliteMult: 3, // 精英巢穴怪(e.elite)機率倍率
  bossPool: ['gold_helmet', 'gold_greaves', 'gold_armor'], // 神殿 Boss/暗潮最終波守衛必掉一件金裝
};

// 已放置物件的耐久(地刺的 hp 直接當「剩餘刺數」用,跟 SPIKE_TRAP_CFG.charges 綁定)
const OBJ_HP = { torch: 4, workbench: 20, furnace: 20, tower: 50, archer_tower: 40, chest: 12, nest: 60, auto_miner: 30, belt: 8, storage: 30, auto_smelter: 30, lantern: 4, crystal_lamp: 8, banner: 4,
  gate: 60, frost_tower: 40, spike_trap: SPIKE_TRAP_CFG.charges, decoy: 150, cannon_tower: 55, multi_tower: 45, sniper_tower: 50 };
// 物件光照半徑(自動採礦機自帶微光,呼應「需供電」的能量意象也順便讓機器周圍看得清)
const OBJ_LIGHT = { torch: 7, tower: 6, furnace: 3, workbench: 2.5, archer_tower: 3, auto_miner: 3, auto_smelter: 3, lantern: 10, crystal_lamp: 14,
  gate: 2, frost_tower: 3, decoy: 5, cannon_tower: 3, multi_tower: 3, sniper_tower: 3 }; // 光簾門/誘光罐會發光是主題(蝕影搶光),凜鈴塔冰晶微光
// 會擋路的物件(自動採礦機是機台,擋路;傳輸帶是地面軌道,不擋路可站上去)。
// 光簾閘門刻意不在這裡:對玩家/投射物不算牆,只有 isSolid 的 forEnemy 參數會把它當牆(見 world.js);
// 地刺是貼地陷阱,誰都能踩上去
const OBJ_SOLID = { workbench: true, furnace: true, tower: true, archer_tower: true, chest: true, nest: true, auto_miner: true, storage: true, auto_smelter: true, frost_tower: true, decoy: true,
  cannon_tower: true, multi_tower: true, sniper_tower: true };

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
  // Q版改版:商人定名「莫勾」(鼴鼠商人,戴小提燈帽)——有名字的 NPC 才有記憶點
  count: 1, icon: '🧙', name: '商人莫勾', motto: '嘿嘿,碎片越多,好貨越多~',
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
