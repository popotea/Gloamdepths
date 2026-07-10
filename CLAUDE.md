# 微光深淵 Gloamdepths — 專案指南

受 Core Keeper 啟發的**原創** 2D 俯視角地底合作生存遊戲。純前端網頁(原生 JS + Canvas 2D,無框架、無建置步驟),支援 1–4 人 PeerJS 連線。GitHub:`popotea/Gloamdepths`。

## 啟動與測試
- 本地測試:雙擊 `啟動遊戲.bat`(跑 `node serve.js` → http://localhost:8000),或直接雙擊 `index.html`(file:// 也能玩)。
- ⚠️ 存檔存在 localStorage,**依網址來源(origin)區分**:file:// 與 localhost:8000 的存檔互不相通。
- 無自動化測試檔;過去用「Node 無頭測試」驗證:用 eval 串接 config→world→inventory→entities→game(→net),stub 掉 `NET/UI/SFX/showMsg/setOverlay/localStorage` 即可在 Node 跑模擬。

## 核心玩法(一句話)
守護會耗能的「星核」:挖光晶按 F 餵它 → 抵禦定期「暗潮」圍攻(建牆/光塔/箭塔)→ 擊敗外圈三座神殿的石像守衛收集 3 塊碎片 → 撐過最終暗潮通關。星核能量歸零 = 全隊失敗。

## 檔案地圖(script 以傳統 `<script>` 依序載入,順序不可亂)
| 檔案 | 職責 |
|------|------|
| `js/config.js` | **所有資料表與平衡數值**:地形 `T`/`TILE_INFO`、物品 `ITEMS`、配方 `RECIPES`、敵人 `ENEMY_TYPES`、`CORE_CFG`/`WAVE_CFG`/`ARCHER_TOWER_CFG` 等。調平衡只改這裡 |
| `js/world.js` | 全域狀態 `G`、地圖生成 `genWorld()`、`setTile/setObj`(自動維護光源+廣播)、光照、RLE 壓縮 |
| `js/inventory.js` | 背包(32 格,前 8 快捷欄)、合成、`bestPick/bestSword/bestArmor` 自動選具 |
| `js/entities.js` | 玩家/敵人 AI/投射物/掉落物、戰鬥、挖掘 `doMine`、放置 `doPlace`、圓形碰撞 `moveCircle` |
| `js/game.js` | 房主模擬主迴圈 `simTick`、暗潮、星核、存讀檔(`SAVE_KEY='gloamdepths_save'`) |
| `js/net.js` | PeerJS 連線層(見下) |
| `js/render.js` | Canvas 渲染:視野裁切、逐格光照、怪物貼圖快取 |
| `js/ui.js` | DOM HUD、背包/合成面板、小地圖、ESC 選單、主選單 |
| `js/main.js` | 輸入綁定、主迴圈 `frame()`、本地控制與客戶端預測 |

## 連線架構(關鍵設計)
- **房主權威**:房主瀏覽器跑全部模擬;客戶端只送輸入意圖 + 本地預測自己的移動(位置採信任制,朋友間不防作弊)。
- 協定(JSON over PeerJS DataConnection):客→主 `hi/pos/mine/atk/place/eat/craft/swap/deposit/fish/feed` 等;`pos` 帶 `s`(快捷欄選中格,動物跟隨判定要用)。主→客 `init`(RLE 全地圖)、`snap`(10Hz 快照,含 enemies/animals/drops/projs 與自己的 `me.inv/hp/buffs`)、`tile/obj`(地形增量)、`fx/msg/tp/join/bye/over`。
- **存檔只在房主**;所有玩家背包以「玩家名字」為鍵存進 `playersByName`,朋友同名重連取回裝備。存檔可從 ESC 選單匯出/匯入 JSON 檔轉移房主。
- 單機 = 房主模式零連線,同一套程式碼路徑(`NET.mode='single'`)。

## 慣例與注意事項
- 註解與 commit 一律**繁體中文**;註解寫「為什麼」。
- 地圖 200×200 用 `Uint8Array`;世界座標單位 = 格(浮點),`TILE=40` 只在渲染換算像素。
- 效能原則:只畫視野內格子、全黑格跳過、塔/巢穴用獨立 idx Set 避免掃全部 objects。
- **怪物貼圖**:放 `assets/monsters/<檔名>`,檔名須等於 `ENEMY_TYPES[type].icon`(如 `imp.png`);載入失敗自動退回向量畫法,任意解析度會自動縮放。
- **地形貼圖**(v39 起):放 `assets/tiles/<檔名>`,檔名須等於 `TILE_INFO[t].tex`(如 `dirt.png`);載入後預縮成 TILE 大小的離屏 canvas(`tileTex`,render.js)再逐格畫,失敗退回 c1/c2 色塊。整格材質**不去背**;唯 `fence_tile.png` 是透明物件疊在地板上。礦脈貼圖自帶礦點(有貼圖就不疊程式圓點),GLOW 與 FLOOR 共用地板貼圖;地板依區域分層:外圈 `floor.png`、中層 `floor_mid.png`、深層 `floor_deep.png`(缺層自動退回外圈那張)。貼圖由 `AI/index.html` 的 AI Hub 生產與寫入(serve.js `/api/save-asset`)。
- 多人時房主與朋友的**程式版本必須一致**(邏輯在雙方各自跑,對不上會脫序)。
- 每次改 `js/*.js` 或 `style.css` 後,記得把 `index.html` 裡所有 `?v=NN` 一起 +1,避免瀏覽器快取吃到舊檔。
- **秘笈選單 `/power`**:聊天輸入框(Enter 開啟)打 `/power` 開啟選單面板(可滑鼠點,面板上每個按鈕也會顯示對應的完整指令文字,例如 `/power spawn hunter 3`),兩種操作方式最終都走同一個入口。
  - client-only 效果(不必是房主也能用):`light`(全地圖在小地圖上開亮,純本地 `G.explored.fill(1)`,不影響其他人)。
  - 房主權威效果(自己是房主直接執行,是客戶端則送 `{t:'power',action,arg,num}` 給房主執行):`heal/godmode/infinite/home/xp/corefull/shard/wavenow/waveclear/clearmobs/spawn`。
  - 統一分派函式 `runPowerCmd(p, action, arg, num)`(`js/entities.js`),`ui.js`(自己是房主)與 `net.js` 的 `case 'power'`(轉發客戶端請求)都呼叫它,不要各寫一份邏輯。
  - 舊的 `/give_all` 指令字串仍保留相容,內部已改走 `execPower('infinite')`。

## 料理 buff / 釣魚 / 圍籬(2026-07 第一批擴充)
- **料理 buff**:食物的 `buff: { kind, mult/value, dur }` 欄位(ITEMS),吃下去寫進 `p.buffs[kind]`,同種重複吃只重置時間不疊倍率。kind 與生效點:`speed`(main.js `localControl` 移速)/`mine`(`doMine` 挖掘力)/`guard`(`damagePlayer` 額外減傷,與護甲**相乘**)/`regen`(`updatePlayersHost` 每秒回血)。計時在 `updatePlayersHost`,死亡清空;客戶端 buffs 靠快照 `me.buffs` 同步(本地移動預測的移速才會跟房主一致);HUD 顯示在 `#buffbar`。帶 buff 的料理**血滿也吃得下**(純回血食物不行)。
- **釣魚**:`T.WATER` 幽光水池(solid 擋移動、`liquid`+`low`、自帶微光)。生成規則(world.js):**水池外圈一圈必須全是地板才動工**,保證繞得過去、不堵保底隧道——改水池生成務必保住這個不變量。釣竿 `fish: true` 對水面右鍵 → `doFish` 記錄拋竿位置與隨機時間,`updatePlayersHost` 計時開獎(`FISH_CFG.loot` 權重表,移動超過 `moveCancel` 收竿);漁獲用 `spawnDrop` 掉腳邊讓磁吸撿(背包滿不會吞掉)。
- **圍籬**:`T.FENCE`,`low: true` = 擋移動但投射物飛得過(玩家箭/箭塔/怪物吐彈都是),判定走 `projHitsWall`(world.js)——投射物撞牆**不要**用 `isSolid`。怪照樣啃得爛(耐久 25),定位是圈農地/牧場不是防線。

## 耐久度(2026-07,第三批,溫和版)
- 只有**鎬 + 近戰/遠程武器**有耐久(`ITEMS[id].dur` = 上限);鏟子/釣竿/護甲刻意不做。格子物件的 `s.dur` = 目前耐久,**undefined 一律視為全滿**(合成/舊存檔免初始化),只有磨損過才寫入。
- 磨損(`wearItem`,entities.js):成功挖掘/命中才扣 1(揮空不扣、一次揮擊打到幾隻都只扣 1);`p.infinite` 不磨損。歸零 = **損壞停用但永不消失**:`bestPick/bestSword/meleeWeaponOf` 用 `isBroken` 跳過(自然退回次級裝備/徒手),`doShoot` 拒發射。
- 修理(`doRepair`):靠近工作台,花 `repairCostOf`(= 合成配方成本的一半、向上取整;無配方的木鎬/木劍= 2 木)回滿。UI 入口在**強化面板**(背包右鍵裝備)。衝裝每級 +15% 耐久上限(`maxDur`)。
- **丟出/撿取/存檔都要帶 `dur`**(spawnDrop 第 6 參數),不然「丟出去再撿回來」= 免費修理;帶 lv 或 dur 的掉落走 `addEnhancedItem` 不可堆疊合併。

## 天賦樹(2026-07,第二批)
- 每升 1 級得 1 天賦點(`grantXp`),按 **T** 開面板自由分配;資料表 `TALENTS`(config.js),6 種全是**個人被動**(刻意不做影響全隊/星核的全域天賦,多人歸屬會很難收拾),數值比衝裝小一階避免疊爆。
- **不變量:已花階數 + 剩餘點數 = 等級 − 1**。讀檔/重連一律用 `talentPtsOf(p)` 推回剩餘點數(所以存檔只存 `talents` 不存點數),舊存檔玩家會自動補發過去升級應得的點。
- 生效點分散:`vital/power` 在 config 的 `playerMaxHp/playerDmgMult`、`miner` 在 `doMine`、`chef` 在 `doEat`、`swift/dasher` 在 main.js `localControl`(客戶端本地預測,靠快照 `me.talents` 同步)。分配走房主權威(`applyTalent`,客戶端送 `{t:'talent',id}`)。
- 測試密技:`/power talentpt 3`。

## 動物養殖(2026-07,第二批)
- 被動生物走 `G.animals` + `updateAnimals`(entities.js),**跟 `updateEnemies` 完全分開**:不攻擊、不追逐、不啃牆。資料表 `ANIMAL_TYPES`(config.js):`feed`(飼料清單)/`product`+`productCD`(餵食後倒數產出)/`meat`(宰殺掉肉範圍)。
- 流程:野外(泥土區)遊蕩 → 玩家**手持飼料**在 `followRange` 內動物會跟著走(引回基地)→ 圍籬圈住(動物走 `moveCircle`,圍籬擋得住)→ 右鍵餵食 `doFeed` → 倒數掉產物 → 回到飢餓再餵。
- **宰殺只吃近戰**(`doSwing` 有掃 `G.animals`);投射物/光塔/箭塔刻意打不到動物,避免流彈屠牧場。
- 同步:動物只在 `snap` 快照(跟 enemies 一樣不進 `init`);`fedT>0` 壓成 `fed` 旗標給客戶端畫 ❤。**客戶端的 `pos` 訊息帶 `s`(選中格)**,房主才知道客戶端手上拿什麼飼料——改跟隨邏輯記得這條資料流。存檔在 buildSave/applySave 的 `animals` 欄位(舊存檔沒有就保留 genWorld 新散布的)。
- 野外自然補充 `animalRegrow`(game.js):圈養的也算在 `ANIMAL_CFG.cap` 內。
- 產物接料理:蛋→菇蛋燒、奶→奶菇濃湯(精力 buff)、肉→烤肉。

## 農耕系統
- 流程:鏟子(`shovel`,`till:true`)右鍵 `FLOOR` → `doTill` 把地形設成 `T.FARMLAND` → 種子(`mush_spore`,`seed:'mush'`)右鍵農地 → `doPlant` 消耗種子放上 `{type:'crop', crop, stage, t}` 物件 → `updateCrops`(entities.js,`simTick` 呼叫)逐格計時推進 `stage` → 成熟後玩家走過去,`updatePlayersHost` 自動收成(跟野生蘑菇同一套 auto-pickup 邏輯),農地保留可馬上再種。
- 作物種類定義在 `CROP_TYPES`(config.js):`growTime`(總成長秒數)/`icons`(每個 stage 的圖示,最後一格=成熟)/`yield`/`seedBackChance`。新增作物種類只要加一筆,不用動邏輯。
- `G.cropIdx`(world.js `TOWER_IDX_SETS` 註冊 `crop`)讓 `updateCrops` 不用掃全部 `G.objects`,跟塔/巢穴同一套機制。
- 網路同步:`stage` 推進時**不**呼叫 `setObj`(避免在 `for...of G.cropIdx` 走訪中對同一個 Set 又刪又加),改直接組 `{t:'obj'}` 訊息呼叫 `NET.sendAll` 廣播;新玩家加入時的 `init` 全量快照與存讀檔都把 `stage`/`t` 一起帶上(`game.js` buildSave/applySave、`net.js` 的 `hi`/`init` 兩處,四個地方要一起改,格式是固定欄位順序的陣列,不是 `{...o}` 那種通用 spread)。
- `doMine` 的「敲掉已放置物件回收成道具」分支明確排除 `mushroom` 與 `crop`,兩者都只能靠走過去自動採集,左鍵對它們無效。

## 大地圖(2026-07,第三批)
- M 鍵開全螢幕 `#mapPanel`(`ui.js` `toggleMapPanel`),重用小地圖既有的離線 `ImageData` 快取(`UI.mmImage`,`drawMinimap()` 產生)整倍縮放貼圖,不重算地形色塊。滾輪縮放 `UI.mapZoom`(1~12)、拖曳平移 `UI.mapPanX/Y`。
- 標記(星核/神殿/巢穴)換成圖示+滑鼠靠近顯示 tooltip(`mapMarkers()`);Esc/M 都可關閉。

## NPC 商人(2026-07,第三批)
- 獨立於 `G.objects` 的固定實體 `G.traders`(陣列,目前固定 1 位),世界生成時(`world.js` `genWorld()` 步驟 6.5)在**中層區域(zone 1,距地圖中心 42~72 格)**隨機找空地板放置,不會動、不能被攻擊/挖掘。
- **同步靠 `init` 而非 `snap`**:client 端從不執行 `genWorld()`,`G.shrines` 能雙端一致是靠 host 把整包陣列塞進 `init` 封包、client 直接賦值,商人比照同一模式(`net.js` `case 'hi'` 的 `traders: G.traders` / client `case 'init'` 的 `G.traders = d.traders`)。商人靜止不動,不需要進 10Hz `snap`、不需要插值。
- **解鎖階段判斷用 `G.core.shards`(0~3)而非 `G.shrines.filter(dead)`**:神殿的 `dead` 狀態目前沒有增量同步給客戶端(只在 `init` 傳一次),但神殿死亡與星核碎片 +1 是同一時刻發生的一對一事件(`entities.js` 擊殺守衛時 `shrine.dead=true` 同時給 `shard`),而碎片數已經透過 `snap` 的 `core:{s}` 即時同步——用它當解鎖指標完全不需要新增同步機制。
- 交易表 `TRADER_CFG`(config.js):`stages` 依 `need`(所需碎片數)分階,採**累加制**(低階項目在高階依然存在)。`traderOffers()` 即時展開目前可見的全部項目,UI 面板(`ui.js` `renderTraderPanel`,仿 `/power` 選單風格)用陣列 index 對應按鈕,`doTrade(p, offerIdx)` 房主權威執行(`canAfford`/`payCost`/`addItem` 三連發)。
- 貼圖走跟怪物同一套「`Image` 快取+找不到檔案自動退回畫法」機制(`traderImg()`,找 `assets/npcs/trader.png`),失敗時退回 emoji(`TRADER_CFG.icon`)+ 金色光暈圓的向量畫法。
- 右鍵觸發判斷寫在 `main.js` `localControl` 右鍵區塊最前面(比照動物判斷 `G.animals.find(a => dist(...) < 0.8)` 的寫法),優先於箭塔/工作台判斷。

## 神殿 Boss 差異化(2026-07,第三批,拆三次上線,目前完成第 1 隻火系)
- `G.shrines` 每筆多帶 `boss` 欄位(字串,對應 `ENEMY_TYPES` 的 key),世界生成時(`world.js` 步驟 6)用固定陣列 `SHRINE_BOSSES = ['fire_boss','sentinel','sentinel']` 依生成順序 `k` 指定;之後補第 2、3 隻只要換陣列裡的 key,不用動生成迴圈本身。`spawnShrineBosses()`(原 `spawnSentinels`,game.js)讀 `s.boss || 'sentinel'` 生成對應敵人,`||` 是舊存檔沒有 `boss` 欄位時的相容 fallback。
- **神殿死亡判斷是通用的,不是寫死 type**:`killEnemy`(entities.js)用 `e.home` 有沒有值判斷「是不是神殿守衛」,不用每加一隻新 Boss 就複製一次碎片/`shrine.dead=true` 的邏輯;各 Boss 的加碼掉落量查 `SHRINE_BOSS_LOOT[e.type]`(config.js)。**順序陷阱**:`e.type==='sentinel' && !e.home` 這支要放在通用 `e.home` 分支之前,擋住暗潮最終波那隻「裸體 sentinel」(`game.js` 生成時沒帶 `home`),否則牠死亡會被誤判成神殿守衛、不該給的碎片/神殿標記會被觸發。
- **火系 Boss(`fire_boss`)機制**:遠程吐火球彈道+命中或落地時範圍爆炸,做法是幫**投射物**加一個 `aoe:{r,wallDmg}` 欄位(`spawnProj`),不是幫 `ENEMY_TYPES` 加新的行為擴充欄位——`et.ranged.aoe` 設定值原封不動透過 `spawnProj` 傳給彈道,`updateProjs` 偵測到 `pj.aoe` 且這幀判定死亡(不論命中玩家、撞牆、出圖、ttl到期)就呼叫既有的 `explodeAt()` 一次。**傷害不疊加**:`pj.aoe` 存在時,命中判定內故意跳過 `damagePlayer` 直接扣血,只讓爆炸傷害算一次,避免正中紅心的玩家吃兩次傷害。
- `elem:'fire'` 讓既有 `ELEM_VS` 表自動生效(冰系武器 1.6 倍剋制、火系武器 0.6 倍打折),不用改 `elemMult`。渲染的 boss 描邊判斷已從寫死 `e.type==='sentinel'` 通用化成 `et.boss`(render.js),之後新 Boss 自動有描邊,不用逐一加分支。
