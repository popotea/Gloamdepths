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
| `js/game.js` | 房主模擬主迴圈 `simTick`、暗潮、星核、存讀檔(3 槽位 `gloamdepths_save_1~3`,見「多存檔」) |
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
- 地圖 280×280(`MAP_W`/`MAP_H`,2026-07-15 由 200×200 放大)用 `Uint8Array`;世界座標單位 = 格(浮點),`TILE=40` 只在渲染換算像素;分區半徑集中在 `ZONE_R`(config.js),不要在別處寫死魔術數字。
- 效能原則:只畫視野內格子、全黑格跳過、塔/巢穴用獨立 idx Set 避免掃全部 objects。
- **怪物貼圖**:放 `assets/monsters/<檔名>`,檔名須等於 `ENEMY_TYPES[type].icon`(如 `imp.png`);載入失敗自動退回向量畫法,任意解析度會自動縮放。**烘焙式快取**(v60 起,`bakedSprite`,render.js):怪物/商人/動物共用,載入後先高品質預縮到顯示尺寸的離屏 canvas,每幀 ~1:1 貼圖(不再每幀 512px→40px 大倍率縮放,畫質與效能雙贏)。動物貼圖 `assets/animals/<type>.png`(hen/cow)v60 起真正啟用(先前只畫 emoji),失敗退回 emoji。
- **地形貼圖**(v39 起):放 `assets/tiles/<檔名>`,檔名須等於 `TILE_INFO[t].tex`(如 `dirt.png`);載入後預縮成離屏 canvas(`tileTex`,render.js)再逐格畫,失敗退回 c1/c2 色塊。**2×2 週期取樣**(v59 起):`TEX_SPREAD2` 名單的地板/牆面材質攤在 2×2 格上、每格畫四分之一(`blitTile`)——AI 材質細節密度偏高,整張塞進 40px 一格會變高頻雜訊+滿版網格重複感;**礦脈/木根刻意不進名單**(礦點須每格完整置中才認得出是礦)。牆面類另壓 `WALL_TEX_MUTE` 暗色統一色調,讓角色/掉落物跳出來。整格材質**不去背**;唯 `fence_tile.png` 是透明物件疊在地板上。礦脈貼圖自帶礦點(有貼圖就不疊程式圓點)。貼圖由 `AI/index.html` 的 AI Hub 生產與寫入(serve.js `/api/save-asset`)。
- **地板改程序化乾淨畫法**(v61 起,render.js `drawCleanFloor`):AI 地板材質縮到 40px 一格仍太花、切割不明確,**非固體地形(FLOOR/GLOW/FARMLAND/RAIL 底、圍籬底)一律不用貼圖**,改純色分區(`FLOOR_BASE/EDGE/HI` 依 `zoneOf` 四級)+ 每格上緣淡高光、左/下邊暗線 = 清楚的網格切割。`floor*.png/farmland.png` 貼圖已不再被地形迴圈使用(礦脈/牆面材質仍用)。改地板觀感只動這支,不碰貼圖系統。
- **鐵軌自動轉向**(v61 起,render.js `drawRail`):鐵軌只是加速地板(移動無方向性),轉向是**純視覺**——讀四鄰 `T.RAIL` 決定畫直線/轉彎(一橫一縱=二次貝茲曲線轉彎,其餘直線),鄰居靠 `G.tiles` 已同步,雙端各自畫出一致造型,**零額外資料/協定**。`rail.png` 貼圖不再使用(改程序化才能轉彎且線條乾淨)。
- 多人時房主與朋友的**程式版本必須一致**(邏輯在雙方各自跑,對不上會脫序)。
- 每次改 `js/*.js` 或 `style.css` 後,記得把 `index.html` 裡所有 `?v=NN` 一起 +1,避免瀏覽器快取吃到舊檔。
- **秘笈選單 `/power`**:聊天輸入框(Enter 開啟)打 `/power` 開啟選單面板(可滑鼠點,面板上每個按鈕也會顯示對應的完整指令文字,例如 `/power spawn hunter 3`),兩種操作方式最終都走同一個入口。
  - client-only 效果(不必是房主也能用):`light`(全地圖在小地圖上開亮,純本地 `G.explored.fill(1)`,不影響其他人)。
  - 房主權威效果(自己是房主直接執行,是客戶端則送 `{t:'power',action,arg,num}` 給房主執行):`heal/godmode/infinite/home/xp/corefull/shard/wavenow/waveclear/clearmobs/spawn`。
  - 統一分派函式 `runPowerCmd(p, action, arg, num)`(`js/entities.js`),`ui.js`(自己是房主)與 `net.js` 的 `case 'power'`(轉發客戶端請求)都呼叫它,不要各寫一份邏輯。
  - 舊的 `/give_all` 指令字串仍保留相容,內部已改走 `execPower('infinite')`。
  - `give`(2026-07-15 補):`/power give <物品id> <數量>`,`ITEMS` 表本來就是 `Object.keys` 泛用寫法(`ui.js` 的下拉選單也是),新物品(礦車/家具/裝潢…)一律免改код自動出現在清單裡。
  - **`/power infinite` 除了免扣材料,也免除合成站距離限制**(2026-07-15 補,`craftRecipe`/`doRepair` 各加一行 `!p.infinite &&`):使用者反映「不需要站在熔爐也能製作任何東西」,判斷是同一個除錯精神(不受限測試任何配方),延伸既有的 `p.infinite` 旗標而不是另開新指令。
  - **程式碼精簡**(2026-07-15):`BELT_VX/BELT_VY` 與 `CART_VX/CART_VY` 是同一組數字,合併成共用的 `DIR_VX/DIR_VY`;`storageAdd`/`cartAdd` 的堆疊塞入邏輯抽成共用的 `slotAdd(items, slots, id, n, lv, dur)`,兩者都只是套上各自的容量常數——用既有的 `simtest_minecart.js`/`simtest_furniture.js`(間接跑到 `storageAdd`)複查過行為不變,沒有另外寫新測試(使用者要求以後驗證力道整體輕量化)。
  - **權限範圍已跟使用者確認過,維持現狀不鎖房主**(2026-07-15):曾經一度嘗試把 `net.js` 的 `case 'power'` 改成只有房主能執行(任何連線的客戶端打 `/power xxx` 都會被房主的瀏覽器執行,無敵/資源無限/召喚怪物…沒有權限檢查),但使用者明確要求維持原樣——不限制誰能用,只要求「畫面上沒有任何提示/說明會洩漏這個指令存在」即可(這點本來就成立,`ui.js` 的秘笈選單/指令從一開始就刻意不寫進任何操作說明)。之後如果要再改權限範圍,記得這是使用者刻意的選擇,不是遺漏。

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

## 神殿 Boss 差異化(2026-07,第三批,三隻全數上線:火系/冰系/穿牆系)
- `G.shrines` 每筆多帶 `boss` 欄位(字串,對應 `ENEMY_TYPES` 的 key),世界生成時(`world.js` 步驟 6)用固定陣列 `SHRINE_BOSSES = ['fire_boss','frost_boss','void_boss']` 依生成順序 `k` 指定。`spawnShrineBosses()`(原 `spawnSentinels`,game.js)讀 `s.boss || 'sentinel'` 生成對應敵人,`||` 是舊存檔沒有 `boss` 欄位時的相容 fallback(舊存檔會退回原本的 `sentinel`)。
- **神殿死亡判斷是通用的,不是寫死 type**:`killEnemy`(entities.js)用 `e.home` 有沒有值判斷「是不是神殿守衛」,不用每加一隻新 Boss 就複製一次碎片/`shrine.dead=true` 的邏輯;各 Boss 的加碼掉落量查 `SHRINE_BOSS_LOOT[e.type]`(config.js)。**順序陷阱**:`e.type==='sentinel' && !e.home` 這支要放在通用 `e.home` 分支之前,擋住暗潮最終波那隻「裸體 sentinel」(`game.js` 生成時沒帶 `home`),否則牠死亡會被誤判成神殿守衛、不該給的碎片/神殿標記會被觸發。三隻新 Boss 上線過程完全沒再碰過這支通用邏輯,驗證了當初「架構打通」的設計。
- **火系 Boss(`fire_boss`)機制**:遠程吐火球彈道+命中或落地時範圍爆炸,做法是幫**投射物**加一個 `aoe:{r,wallDmg}` 欄位(`spawnProj`),不是幫 `ENEMY_TYPES` 加新的行為擴充欄位——`et.ranged.aoe` 設定值原封不動透過 `spawnProj` 傳給彈道,`updateProjs` 偵測到 `pj.aoe` 且這幀判定死亡(不論命中玩家、撞牆、出圖、ttl到期)就呼叫既有的 `explodeAt()` 一次。**傷害不疊加**:`pj.aoe` 存在時,命中判定內故意跳過 `damagePlayer` 直接扣血,只讓爆炸傷害算一次,避免正中紅心的玩家吃兩次傷害。
- **冰系 Boss(`frost_boss`)機制**:沿用同一套 `aoe` 彈道架構,`aoe` 多帶一個可選的 `slow:{mult,dur}` 子欄位,`explodeAt(x,y,cfg)` 對應新增可選的 `cfg.slow`——範圍內玩家中彈時額外寫入 `p.buffs.slow`。**`bomber`/火球等既有呼叫端不傳 `slow`,`explodeAt` 內用 `if (cfg.slow)` 短路,完全不影響原行為**(這是修改共用函式時的關鍵防線)。
- **減速用獨立的 `p.buffs.slow` key,不是 `speed`**:`p.buffs.speed` 已被料理疾行 buff(`mult>1`)佔用,若共用同一個 key,玩家被冰凍後吃一口疾行料理會直接把減速洗掉,是規則漏洞。`main.js` 的移速公式改成 `buffMult('speed') × buffMult('slow')` 兩個獨立倍率相乘,兩種效果可以共存疊乘,互不覆蓋。`p.buffs` 整包已經在 `snap.me.buffs` 同步(net.js),`slow` 不需要新增任何網路協定,且 `updatePlayersHost` 的 buff 倒數迴圈(`for k in p.buffs`)本來就是通用的,新 key 自動被涵蓋。
- **穿牆系 Boss(`void_boss`「虛境潛獵者」)機制**:直接複用既有的 `et.ghost` 欄位(`phantom` 穿牆幽影本來就在用),`updateEnemies` 對 `ghost` 敵人已經是「無視牆壁直接飄,不啃牆」的通用處理,完全不用新寫移動邏輯——這隻 Boss 的機制差異化**只靠複用一個既有 boolean 欄位**,是三隻裡實作量最小的一隻,佐證了「先查現有欄位能不能組出新機制,而不是急著加新欄位」的做法。純近戰(無 `ranged`),定位是靠穿牆突襲繞過玩家的牆/圍籬直取後排,不是靠彈道花樣。
- `elem:'fire'`/`elem:'frost'`/`elem:'dark'` 讓既有 `ELEM_VS` 表自動生效(冰剋火、火剋冰、光剋暗,`void_boss` 是目前唯一會被光系武器剋制的神殿 Boss,不用改 `elemMult`)。渲染的 boss 描邊判斷已從寫死 `e.type==='sentinel'` 通用化成 `et.boss`(render.js),描邊顏色依 `e.type` 三元判斷分流(火紅/冰藍/幽紫/預設灰),之後若要再加新 Boss 只要照樣加一支三元分支。
- 目前仍缺美術素材(`assets/monsters/void_boss.png` 不存在),自動 fallback 成向量畫法(`shape:'ghost'`,顏色/描邊與另兩隻區隔),不影響遊戲運作。

## 難度選項(2026-07,第三批)
- `DIFFICULTY_CFG`(config.js)三檔 easy/normal/hard,各帶 `coreDrainMult`/`waveCountMult`/`enemyDmgMult` 三個倍率,只乘進**既有計算點**,不複製一份平衡數值表:`updateCore` 的 `CORE_CFG.drain`、`startWave` 的怪物數量 `count`、`spawnEnemy` 建立時的 `dmgMult`(與精英倍率 `ELITE_CFG.dmgMult` 相乘疊加,不衝突)。**故意不動敵人血量**——難度差異體現在「更痛更多」而不是「更肉」,血量只受精英倍率影響。
- `G.difficulty` 存 key(預設 `'normal'`),只在 `startNewGame(name, difficulty)` 建新世界時決定,之後整局不變;`genWorld()` 本身不碰這個欄位(難度是規則參數,不是地圖生成參數)。存讀檔走 `buildSave`/`applySave` 的 `difficulty` 欄位,舊存檔沒有這欄位一律 fallback `'normal'`。
- **房主權威,但客戶端也要知道**:雖然難度只影響房主端模擬(星核流失/暗潮數量/敵人傷害都在房主跑),但客戶端 UI(ESC 選單「統計」分頁)想顯示目前難度就得知道這個值——比照商人/神殿的做法,**放進 `init` 封包一次性同步**(`net.js` 的 `hi` 回應與 `case 'init'` 兩處各加一行),不用進 10Hz `snap`(開局後不會變動)。
- UI 入口:主選單「新世界」按鈕上方新增三顆難度按鈕(`ui.js` `setOverlay('start')`),點擊切換 `UI.selectedDifficulty`(純前端暫存,不影響任何遊戲狀態,選完才在 `beginGame()` 傳給 `startNewGame`),選中態用金色高亮(`.diffbtn.selected`,呼應天賦/Boss 的既有金色強調色 `--gold`)。戰敗畫面的「新世界」按鈕(`btnNew2`)是直接 `location.reload()` 回主選單重新走一次選擇流程,不用額外處理。

## 軌道快速移動(2026-07,第四批,v1「加速地板」)
- `T.RAIL`(config.js)是**非固體地形**(`solid: false`,可站上去),站在上面移速 ×`RAIL_CFG.speedMult`(2.6),定位是打通基地↔遠方礦區/神殿的快速通道。v1 只做「加速地板」,不做真的沿軌前進的礦車實體(v2 會需要軌道連通圖+尋路,先不做)。
- **移速判定在 `main.js` `localControl`**(客戶端本地移動預測):`tileAt(玩家格) === T.RAIL` 就把倍率乘進既有移速公式(與疾行 buff/減速 debuff/衝刺/健步天賦全部**獨立相乘**)。軌道地形靠 `setTile` 廣播、`init` 全量 `rleEnc(G.tiles)` 同步,雙端都知道哪裡有軌道,所以每個玩家在自己的 `localControl` 算得出一致移速——**不需要新增任何網路協定**。敵人的 `updateEnemies` 不看軌道(怪不該因為踩到玩家鋪的軌道就變快)。
- **`doPlace` 的 `solidPlace` 判定要看地形的 `solid` 屬性,不是「只要用 `placeTile` 就當擋路」**:原本 `it.placeTile !== undefined` 一律當固體,會導致玩家站原地時沒法在腳下鋪軌道(非固體地形本該可蓋在自己身上)。改成 `it.placeTile !== undefined && TILE_INFO[it.placeTile].solid`,圍籬/水這種固體地形仍受「不能蓋在玩家/怪身上」檢查,軌道則放行。
- **非固體地形的回收要靠 `rail` 旗標**:`doMine` 的地形挖掘分支開頭 `if (!info.solid) return`,非固體地形一般敲不掉。軌道加了 `rail: true` 旗標,`doMine` 在「敲回收放置物件(obj)」分支之後、`!info.solid` return 之前插一條:偵測到 `info.rail` 就一敲即回收(不做耐久,踩掉重鋪很順手)、掉回 `rail` 物品、還原 `FLOOR`。
- **渲染疊在地板上(貼圖須透明背景)**:軌道走 `render.js` 的 `!info.solid` 分支,但不能用自己的 `tex` 當地板底(會蓋掉整格)——比照農地/圍籬,先強制鋪 `FLOOR` 底(含區域分層 floor_mid/deep),再疊軌道貼圖 `rail.png`;貼圖不存在時 fallback 向量畫法(白色雙鋼軌+深色枕木)。
- 存讀檔/多人同步**完全免額外處理**:軌道是 `G.tiles` 的一部分,`buildSave` 的 `rleEnc(G.tiles)` 與 `init` 的全量地圖同步自動涵蓋(跟圍籬同一條路徑)。
- **高速不會穿牆**:`moveCircle` 本來就把大位移拆成 `step=0.4` 子步逐格檢查,軌道+疾行+衝刺疊到 ~38 格/秒,單幀位移仍被子步保護,不會跳過牆體。

## 自動化道鏈:自動採礦機 + 傳輸帶(2026-07,第四批)
- **設計張力三重折衷同時生效**(全自動化會削弱「黑暗生怪、玩家主動冒險挖礦」的核心迴圈,`AUTO_MINER_CFG` 用三道限制壓制):(1) 只能架在**已探索格子**(`doPlace` 查 `G.explored[i]`,玩家得先冒險點亮地圖)(2) **產量遠低於手動**(cd 4 秒 vs 玩家 0.26s)(3) **需光晶持續供電**(`o.fuel`,跟星核資源迴圈掛勾)。外加每人數量上限 4 台。
- **自動採礦機(`auto_miner`,固體物件,`G.minerIdx`)**:比照塔類用獨立 idx Set + `updateMiners`(半秒掃一次,每台自己的 `o.mineT` 計 cd)。掃相鄰 8 格找「有 `info.ore` 礦點的礦脈」(排除普通牆),受 `AUTO_MINER_CFG.tier`(2)限制——**採不動鑽石礦(tier 3),最強礦物仍要玩家親自下礦**。採礦會**消耗礦脈**(`setTile → FLOOR`),礦物 `spawnDrop` 掉機器腳邊,採完周圍要搬機器,不是無限產出。右鍵拿光晶補燃料(`doFuelMiner`,比照箭塔補箭)。
- **傳輸帶(`belt`,非固體物件,`G.beltIdx`,帶 `dir` 0=右1=下2=左3=上)**:做成**物件而非地形**,因為地形是 `Uint8Array` 存不了方向。`updateBelts` 偵測掉落物所在格有 belt 就往 `dir` 加位移(撞牆不推)。**呼叫順序:`updateMiners`(產出)→ `updateBelts`(推)→ `updateDrops`(磁吸+撿)**——玩家靠近時磁吸能蓋過傳輸帶推力(期望行為)。放置方向依玩家 `p.aim` 量化(`dirFromAngle`),右鍵空手 `doRotateBelt` 順時針旋轉。
- **物件多帶 `dir`/`fuel` 兩個新欄位,存讀檔/init 的固定欄位順序陣列要四處一起改**:`buildSave`(game.js)、`init` 封包(net.js `hi`)兩個編碼端,`applySave`(game.js)、`case 'init'`(net.js)兩個解碼端,在 `nestType` 之後append `o.dir ?? null, o.fuel ?? null`(舊存檔沒這兩格 = undefined,解碼端 `!== null && !== undefined` 守衛跳過)。`setObj` 的廣播用通用 `{ ...o }` spread,增量更新(補燃料/旋轉/採礦扣燃料)自動帶新欄位,不用改。
- **兩個新 idx Set(`minerIdx`/`beltIdx`)要在三處 `.clear()` 一起清**:`genWorld`(world.js)、`applySave`(game.js)、`case 'init'`(net.js),跟既有 towerIdx/cropIdx 同一行。`TOWER_IDX_SETS`(world.js)註冊 `auto_miner→minerIdx`/`belt→beltIdx`,`setObj` 增減物件時自動維護。
- **TDZ 陷阱**:`ITEMS.auto_miner` 的 desc 模板字串引用了 `AUTO_MINER_CFG.maxPerPlayer`,所以 `AUTO_MINER_CFG`/`BELT_CFG` 必須定義在 `ITEMS` **之前**(緊接 `ARCHER_TOWER_CFG`),否則 `const` 暫時性死區會讓 config.js 載入即崩(整個遊戲白屏)。加需要被 ITEMS desc 引用的 CFG 時務必注意順序。
- 渲染:採礦機是站立機台(⚙️ emoji + 青色燃料條,比照箭塔彈藥條);傳輸帶是**貼地方向箭頭**(自畫兩個青色雪佛龍,按 `dir` 旋轉,跳過通用的底影+emoji 畫法),`render.js` 物件迴圈開頭 `if (o.type === 'belt') {...; continue;}`。

## 礦床(Core Keeper 式集中礦)+ 儲物箱(2026-07-12,第五批)
- **礦物分布改「礦床」集中制**(world.js 步驟4):新增 `deposit(count, rMin, rMax, host, ore, dMin, dMax)`——用 3~5 顆重疊子圓聯集出不規則塊狀,每塊約 20~55 格同種礦。主要金屬礦(銅/鐵/金/鑽石/煤)改用 deposit 集中成塊,**讓自動採礦機+傳輸帶+軌道的道鏈有意義**(一台機器守一塊礦床能連採一陣,再用軌道/傳輸帶運回)。保留少量細 `vein()` 當「探索沿途的零星收穫」;光晶刻意維持零星散布(到處撿得到才餵得起機器)。`G.depositCenters`(礦床中心陣列)是可選裝飾資料,不進存檔/同步(讀檔不重跑礦生成),目前無邏輯依賴。
- **儲物箱(`storage`,固體物件)= 自動化道鏈的終點**:內容存在 `o.items` 陣列(每格 `{id,count[,lv,dur]}`,跟背包同格式)。右鍵開 `#storagePanel`(上半箱內容點取回、下半背包點存入、「快速存入同類」`doStorageQuick` 只併已有同類且跳過快捷欄)。**傳輸帶正前方是儲物箱就自動入庫**(`updateBelts` 偵測 `dir` 前方格是 storage → `storageAdd`,箱滿則剩下留帶上)——這就是「採礦機→傳輸帶→儲物箱」的 Core Keeper 閉環。敲爛箱子 `spillStorage` 內容全掉出來不消失。
- **同步靠既有 `setObj` 廣播**:`items` 隨 `{ ...o }` spread 全量廣播(容量小,每次存取全發沒負擔),客戶端 `G.objects` 一直是最新內容,面板每 0.3s 節流重繪即反映;存取是房主權威(client 送 `storeput`/`storetake`/`storequick`,net.js dispatch)。
- **`items` 是物件固定欄位陣列的第 12 格**:`buildSave`/`applySave`(game.js)、`init` 編/解碼(net.js `hi` 與 `case 'init'`)**四處**在 `fuel` 之後 append `o.items ?? null`,解碼 `!== null && !== undefined` 守衛(舊存檔沒這格自動跳過)。storage 不需要獨立 idx Set(沒有每幀 tick,傳輸帶用 `objAt` 查前方格即可)。

## 第五區域「淵核區」通關後解封(2026-07,第四批,原 3.1 選項B)
- **地圖幾何**:`zoneOf` 加第四級(`d < 96 ? 2 : 3`)。地形生成(world.js 步驟2)把 BEDROCK 外邊界從 96 推到 **116**,96~116 是淵核區(`T.VOIDROCK` 淵岩,tier 3——金鎬即頂級鎬 tier 3,沒有「鑽石鎬」這一階),94~96 是**封印環**(`T.SEAL`,一圈**強制填滿不看細胞自動機**才不會有洞)。鑽石/光晶礦脈延伸進淵核區(更密集)。
- **地圖尺寸幾何陷阱**:地圖 200×200、中心到「正上下左右」邊緣只有 100 格(角落才 141),所以 d=116 的外邊界圓在正方向會**超出地圖、露出被切平的直邊**——用「最外 2 格強制 BEDROCK」(`x<2||y<2||x>=MAP_W-2||...`,優先於距離判定)收邊。結果:淵核區是「四個胖角落 + 四條窄邊」的不規則環,約 8000 格可探索(佔全圖 20%),形狀不規則但面積充足。
- **封印機制**:`T.SEAL` 是 `hp: Infinity` 挖不掉的牆(通關前擋住淵核區,BFS 驗證過玩家挖不進去)。通關 `gameOver(true)` 時房主呼叫 `unsealVoidZone()`(world.js):掃全圖把 SEAL→FLOOR、清封印光源,設 `G.unsealed=true`。**不逐格 `setTile` 廣播**(1200 格會發爆封包),改直接改 `G.tiles` + 發一個 `{ t:'unseal' }` 小封包,客戶端 `case 'unseal'` 各自跑同一個 `unsealVoidZone(true)`。
- **存讀檔/同步**:`G.unsealed` 進 buildSave/applySave/init(舊存檔沒有 = false)。但 SEAL→FLOOR 的地形變化**已寫進 `G.tiles`**,RLE 存檔與 init 全量同步自動保存,所以 reload/新客戶端加入看到的就是解封後的地圖;`G.unsealed` 旗標只用來**防止重複解封**(通關後存檔再讀不會又跑一次)。
- **新怪(只新區域+新怪,不做新裝備線)**:`revenant`(淵魂,高血高傷近戰)/`voidling`(蝕裂者,遠程+拆牆 `wallMult:3`),比 `abyss` 強一階但非 Boss;`ambientSpawn` 的 zone 3 生它們(通關解封前玩家進不去,自然不會在那生),掉落豐厚(高卷軸率+機率鑽石)。渲染:VOIDROCK 走既有固體地形 c1/c2 分支;SEAL 額外疊脈動紫色符文光(`info.seal` 特判,一眼認出是屏障)。小地圖色表(ui.js)補了 RAIL/VOIDROCK/SEAL 三色。

## Q 版視覺與主題改版(2026-07-12,詳見《Q版改版計畫.md》)
- **風格定位「黑暗的世界,可愛的居民」**:光照/黑暗系統是遊戲性**不動**,Q 版化的是角色/UI/文案。三支柱:圓潤厚實(膠囊/大圓角)、大發光眼=情感核心、暗底×糖果色(`--candy-pink/yellow/mint`,**限回饋時刻**使用,平常仍以 `--glow` 青藍為識別)。敘事支點:「蝕影不是邪惡,是怕光又想搶光的小生物」——所有文案語氣的統一依據。
- **AI Hub 三套產圖模板已改 v2 貼紙卡通風**(`AI/index.html`):`ASSET_LIB.master`/`MASTER_TILE`/`MASTER_CREATURE`,移除 pixel art/16色,改厚描邊 sticker+cel shading。**特徵字陷阱**:`applySpec` 靠 `true top-down`/`fills the entire square`/`full body from head to feet` 三句判斷「已套用模板」,改模板措辭**務必保留這三句**。怪物描述原則:配色/輪廓關鍵字保留(遊戲辨識),兇狠詞(menacing/imposing)全換表情詞(鼓臉/瞇眼壞笑)。`isTileTexture` 的透明例外=fence_tile+rail;`specKindOf` npcs→creature。**模板改版後素材要整組同批重生**,混批風格會漂移。
- **主題定名**:玩家=「螢火隊」、商人=「莫勾」(`TRADER_CFG.name/motto`)、三神殿 Boss=守望者(火・燼/冰・凜/影・寞,`ENEMY_TYPES` name);擊殺守望者訊息是「喚醒」語氣+`SHRINE_BOSS_QUOTES` 專屬台詞(config.js)。文案語氣「再放飛」尺度:全面梗化+emoji 用滿,**唯暗潮警告/星核低電量保留緊張感**,⚠️ 錯誤訊息保持清楚不搞笑。
- **UI Q 版化**(style.css):血條膠囊化(`border-radius:999px`,`.bar` 本有 `overflow:hidden` 不露角)、主選單按鈕全膠囊、按鈕 active 擠壓(squash & stretch)、快捷欄選中呼吸發光(`slotBreath`)、標題浮動。canvas floater 的糖果色直接寫 hex(canvas 吃不到 CSS 變數):回復類=薄荷綠 `#7dffb2`、動物好感=糖果粉 `#ff9de2`。
- **向量畫法 Q 版**(render.js):怪物 fallback 眼睛放大 20%+白色高光點;玩家大眼 3.5+淡粉腮紅,**血量 <30% 眼睛變「><」**(用 `p.hp/p.maxhp` 判斷——雙端都有這兩個欄位,客戶端不用等快照同步新欄位)。
- 金鎬(tier 3)即頂級鎬,**沒有「鑽石鎬」這一階**——鑽石/淵岩都是金鎬挖。

## 多存檔/世界選擇(2026-07-12,原 3.4)
- **3 個槽位**:key = `gloamdepths_save_1~3`(`SAVE_SLOTS`/`saveKeyOf`,game.js);`SAVE_SLOT`(let,非 G 欄位)記目前遊戲寫入的槽位,**主選單決定、整局不變**,不進存檔內容(它是「存在哪」不是「存了什麼」)。存檔格式本身零改動,新舊互通。
- **舊版單一 key 自動搬遷**:`migrateLegacySave()` 把 `gloamdepths_save`(`LEGACY_SAVE_KEY`)搬進第一個空槽後刪舊 key(冪等);三格全滿時**保留舊 key 不動**,寧可不搬也不丟資料。呼叫點在 `setOverlay('start')` 開頭——主選單是唯一入口,列表/`anySave()` 之前一定先搬完。
- **槽位摘要 `slotInfo(n)`**:回 `hostName/diffLabel/time/shards/won/savedAt/size`;空槽回 `null`、JSON 壞掉回 `{broken:true}`(列表顯示「損壞」仍可刪)。`buildSave` 多存 `savedAt`(純顯示用,`applySave` 不吃)。`hasSave(n=SAVE_SLOT)` 查單槽(設定頁按鈕態),主選單「繼續存檔」要用 `anySave()`。
- **UI 流程**(ui.js `setOverlay('slots')`,`UI.slotPick='load'|'new'`):「繼續存檔」開槽位列表(讀取/刪除);「新世界」自動用 `firstEmptySlot()`,**三格全滿才進「挑一格覆蓋」**(覆蓋/刪除都 confirm)。匯入存檔檔案也先挑空格,全滿 confirm 後覆蓋 `savedAt` 最舊的一格——**槽位要在 `loadGameFromObject` 之前決定**,取消才不會弄髒世界狀態。
- **`getName()` 陷阱**:槽位畫面沒有 `#nameInput`,getName 已加 fallback 讀 `localStorage.gld_name`(從主畫面進槽位畫面時已存過);改主選單流程時別把「名字輸入 → 進槽位畫面」的順序反過來。

## 連線基礎建設批次(2026-07-12,原規劃第四章 4.1/4.2/4.3 整章完成)
- **⚠️ binarypack 大陣列序列化陷阱(全專案最重要的連線地雷)**:PeerJS 預設序列化器對**上萬元素的陣列**(如 `rleEnc(G.tiles)` 的 1.2 萬元素)會 `Maximum call stack size exceeded`,且**視當下呼叫深度偶爾成功**——這就是過去 join 偶發失敗的根因。對單一長字串則是線性處理、實測 10/10 穩定。因此大封包(`init`/`backup`)一律走 `NET.sendBig(conn, obj)`(包成 `{t:'big', json}` 送、收端在 `conn.on('data')` 開頭解包)。**之後任何新協定要帶大陣列,必走 sendBig**。
- **房主斷線轉移(4.1)**:自動化既有的「匯出存檔→匯入接手」手動流程。房主把 `buildSave()` 每 `MIGRATE_CFG.interval`(20s)推給**繼任者**(pid 最小=最早加入的客戶端,`_refreshSuccessor`),並向全員廣播 `{t:'succ', sid, code}` 講好**接棒房號**(入房/繼任者變動/定時三個時機都推,新人才會立刻知道)。房主失聯 → 繼任者 `_takeover()`:用接棒房號開房 + `loadGameFromObject(backupSave)`(跟匯入存檔完全同一條路徑),其他人 `_chase()` 每 2.5s 敲門最多 6 次;背包以名字為鍵自動拿回。接棒房主的自動存檔落到 `firstEmptySlot()`,沒空格就整局不落地(絕不默默蓋別人的世界)。
- **斷線偵測靠雙保險**:`conn.on('close')` + **心跳逾時**(`clientTick` 裡 `lastMsgT > 8s`,快照本來就 10Hz)——分頁被強制關閉時 close 事件**可能永遠不來**,不能只靠它。心跳守衛要有 `conn && conn.open`(接棒過渡期新連線未開,不能誤判)。
- **join 的 onOk/onErr 必須單發**:peer error 與逾時可能各觸發一次 onErr,若都往外報,接棒重試鏈會**分裂成多條互相銷毀對方 peer**(曾把已成功的連線殺掉)。`fail()` 用 `opened/failed` 旗標收斂,且放棄時一定 `peer.destroy()`(否則已放棄的連線稍後連上=同名殭屍玩家)。
- **觀戰模式(4.3)**:V 鍵切換自由鏡頭(`UI.spec = {x,y,auto}`,死亡自動啟用/復活自動收回),`localControl` 開頭攔截 WASD 改移動鏡頭並 `return`(角色不動作),`render.js` 鏡頭 `const cam = UI.spec || me`。**純本地零網路協定**。
- **TURN 中繼(4.2)**:`PEER_OPTS`(net.js)給兩處 `new Peer` 帶 `ICE_SERVERS`(Google STUN + Open Relay 免費 TURN)。TURN 只在打洞失敗才走;免費服務掛了=退回純 STUN,不會更差。
- 測試:`e2e_migrate.js`(scratchpad)三個獨立 browser context 走**真 PeerJS 雲端**全流程(開房→兩人加入→塞特徵物品→關房主→驗證接棒/跳房/背包完整/觀戰),17 斷言全過。

## 網頁載入與效能規則(2026-07-12,設計判斷用的歸因指南)
遊戲是純前端網頁,設計任何新東西前先分清楚「慢」是哪一種,規則才管得對地方:
1. **載入慢 = 資產問題,不是程式碼問題**。全部 JS 合計才 ~270KB(毫秒級),資產才是大頭:AI 產圖的 PNG 單張常破 1MB,遊戲內卻只縮到 TILE=40px 使用。**規格:tiles/items ≤ 256×256、生物(monsters/npcs/animals)≤ 512×512**——2026-07-12 已把全部 100 張從 67MB 預縮到 12MB(畫質零差異,遊戲內顯示尺寸遠小於此),AI Hub 的 `saveToGame` 已加 `shrinkBlob` 預縮步驟,之後新生成的圖存檔時自動符合規格。原始高解析圖在 git 歷史與本機 `assets_raw/`(已 gitignore)可撈回。file:// 本機玩感覺不到差異,放上網(GitHub Pages 等)差距巨大。
2. **遊戲中卡頓 = 每幀工作量問題,跟檔案大小無關**。新系統的每幀邏輯遵守既有效能原則:只處理視野內、獨立 idx Set 不掃全部 objects、離屏快取(tileTex/mmImage);低頻工作降頻跑(如 updateMiners 半秒一次)。
3. **單一 JS 檔變大影響的是可維護性,不是效能**。要拆檔是為了職責清楚,拆了記得 index.html 的 `<script>` 順序不可亂、`?v=NN` 同步加。

## 自動熔煉爐(2026-07-12,自動化 v2,原 3.6 v2 的「自動熔煉」)
- **道鏈中繼站**:礦機→帶→**熔煉爐**→帶→箱,自動化產線就此打通。`auto_smelter`(固體物件,`G.smelterIdx`),`AUTO_SMELTER_CFG`/`SMELT_MAP`(config.js,**TDZ:定義在 ITEMS 之前**,desc 引用了 maxPerPlayer)。比率跟熔爐配方一致(2 礦=1 錠)、每 5 秒一鍋、吃煤當燃料、每人上限 4 台——延續礦機「慢但省事」的設計張力;**只熔礦石**,料理仍要玩家手動做。
- **原料緩衝借用 `o.items` 欄位(跟儲物箱同格式)、燃料借用 `o.fuel`**:存讀檔/init 的固定欄位順序陣列**零改動**,新物件免碰四處編解碼。`smeltT` 是暫態計時不落檔。
- **餵料統一走 `smelterFeed(o,id,n)`**(回傳吃不下的量):傳輸帶(`updateBelts` 比照儲物箱的「正前方一格」分支,**帶 lv/dur 的強化裝備掉落不吸**,免得被熔掉)與玩家右鍵(`doFeedSmelter`,手持煤=補燃料/手持可熔礦=整批投料,協定 `{t:'smelter',x,y}`)共用。
- **出料口是固定方位**:成品掉在第一個相鄰非固體格(右→下→左→上順序),在那格鋪傳輸帶就能自動接走——爐子本身是固體,掉自己腳下的話帶子推不到,道鏈會斷。
- `updateSmelters` 在 simTick 排在 `updateBelts` 之前(剛出爐的錠同幀就能被帶子接走);敲爛時 `spillSmelter` 把緩衝礦石+剩煤全噴出來,不憑空消失。渲染:🏭 + 橘色燃料條(沒煤變暗)+ 上方細灰白條=緩衝量(render.js)。

## 物品擴充(2026-07-13,第五批補內容)
- **全部重用既有系統、零新 tick 邏輯**:料理 5 種(`mushroom_skewer/crystal_cake/spicy_meat/hearty_soup/power_shake`,走既有 food+buff,kind 限既有 speed/mine/regen/vigor)、照明 2 種(`lantern` 光 10 / `crystal_lamp` 光 14,`place` 物件+`OBJ_LIGHT`,不擋路)、裝飾 1 種(`banner` 純擺飾)。每種都補了 `RECIPES` 且成本只用既有可取得材料。
- **照明/裝飾的 item id === place type**(如 `lantern`),放置走 `doPlace` 通用路徑建 `{type:it.place}`、敲回收走 `doMine` 通用分支 `spawnDrop(o.type,1)` 掉回同 id——所以新增這類「純放置物」只要:ITEMS 一筆(place=自己的 id)+ `OBJ_HP`(必)+ `OBJ_LIGHT`(要發光才加)+ render `OBJ_ICON` emoji 一筆 + RECIPES 一筆,不碰任何 tick/存檔/同步。**加更多放置物照這個模板最省事**。
- 物品在**遊戲內用 emoji**(`ITEMS[id].icon`),`assets/items/*.png` 是 AI Hub 素材庫用(遊戲目前不讀),但仍照 Q 版可愛風補齊、預縮 ≤256px。

## 防守主城強化批(2026-07-13,第六批:城門/回城/控場塔/地刺/誘餌)
強化「防守星核 ↔ 出門探索」的核心張力。整批**零新增存檔欄位**(物件只用 type/hp/owner 既有格)、唯一新協定是客→主 `recall`;新 CFG 全放 ITEMS 之前的 CFG 區(TDZ 鐵律)。
- **光簾閘門 `gate`**:玩家與投射物自由穿過、蝕影/動物視為牆——解「築牆把自己出門的路也堵死」的痛點。實作是**反向的 solid 判定**:`gate` 刻意不進 `OBJ_SOLID`(玩家、投射物、掉落物都不擋),`isSolid/circleHitsSolid/moveCircle` 加第三/四/五參數 `forEnemy`,只有 `updateEnemies` 與 `updateAnimals` 的 moveCircle 傳 `true`——玩家端(含客戶端本地預測)所有既有呼叫零改動,雙端天然一致。**啃牆分支與 `explodeAt` 的物件迴圈要同步補 `|| o.type === 'gate'`**(怪才啃得爛門、炸彈才炸得到門),`doPlace` 的 `solidPlace` 也要補(不能蓋在怪身上關禁閉)。穿牆系(ghost)照樣飄過去=城門的天然剋星;敵人吐彈也射得過門(跟圍籬同邏輯),別站門口。
- **歸巢螢石 `recall_stone`**:手持右鍵引導 `RECALL_CFG.channel`(4s)後傳送回星核;**移動(>0.3 格)或受任何傷害立即中斷、不消耗,完成才 `removeOne` 消耗**——受擊中斷寫在 `damagePlayer`(堵死戰鬥免死脫逃),移動中斷比照釣魚寫在 `updatePlayersHost`。傳送重用既有 `tp` 協定與重生座標邏輯;`p.recall` 是房主端暫態(不進存檔,比照 `p.fish`)。設計意義:探索半徑不再被「暗潮警告 30 秒內趕不趕得回」綁死,而它是「把人送回來防守」而非「替人防守」,反而保證暗潮全員到場。成本吃光晶=跟餵星核搶同一資源的機會成本。
- **凜鈴塔 `frost_tower`**:零傷害純控場塔,每 `FROST_TOWER_CFG.cd`(2.5s)對 3.5 格內敵人上緩速(移速 ×0.55、持續 2.6s)。**緩速在敵人「起跳瞬間」取樣**(`updateEnemies` 的 hop 速度乘 `slowF`,跳程中不變速;`e.slowT` 暫態倒數)——因為 ghost 用同一份 `e.vx/vy`,**緩速是目前唯一反制穿牆幽影的建築**;冰系(elem frost)抗性=時間減半,刻意不做全免。`frostIdx` 進 `TOWER_IDX_SETS` + 三處 `.clear()`;每人上限 2(`doPlace` 比照箭塔模板+`o.owner`)。**snap 的敵人陣列加了第 8 欄緩速旗標**(`e.slowT>0?1:0`,客戶端解回 `e.sl`),render 畫冰藍圈+❄——這是本批唯一動 snap 編碼的地方,雙端版本必須一致(本來就是專案鐵律)。
- **地刺陷阱 `spike_trap`**:貼地非固體消耗品,**零 tick 迴圈、零 idx Set**——判定反過來由敵人做:`updateEnemies` 移動後查 `objAt(腳下格)`,是地刺就扣血+被彈開(`hurtEnemy` 的 src 傳純座標=有擊退、無 name=**不給經驗值**,塔類同慣例)。每隻怪自帶 `e.trapT`(0.8s)免疫節奏;**`o.hp` 直接當剩餘刺數**(`OBJ_HP.spike_trap === SPIKE_TRAP_CFG.charges` 綁定),扎完 `setObj null` 碎裂、每次觸發 `setObj` 廣播刺數(render 畫透明度)。ghost 飄著扎不到(跟凜鈴塔/閘門同一套「穿牆怪剋地面工事」的弱點語言)。**觸發後若怪死了要 `continue`**(killEnemy 已 splice,倒序迴圈安全,但不能再跑本幀後續邏輯)。回收=滿刺重生的小福利,接受(跟火把同規則)。
- **誘光罐 `decoy`**:假星核嘲諷柱(OBJ_SOLID+發光 5)。`updateEnemies` 暗潮分支的目標優先序:**追玩家(4 格)> 誘光罐(`DECOY_CFG.range` 10 格,`nearestDecoy` 走 `decoyIdx`)> 星核**——玩家在場怪照打人,不能拿它隱形掛機;怪抵達被擋→走既有啃牆分支啃爛(HP 150),爛掉自動回頭衝星核。**`!et.ghost` 守衛必加**:ghost 永遠不會 blocked、啃不到罐子,不排除會飄在罐上無限徘徊=永久免費嘲諷漏洞。`decoyIdx` 是「查詢索引」不是 tick 索引(每敵每幀查最近誘餌,掃全 objects 太貴),一樣進 `TOWER_IDX_SETS` + 三處 clear。
- 設計官否決存檔:**自動修牆機**(自動化防守會殺掉「暗潮=全員回防」的緊張感,鐵律違反,永不做)、預警鐘(warn 30s 已夠,方向情報一波就過期)、星核護盾(要動 snap 的 core 欄位,改「超載餵食」構想留待後批)。**加農塔(AoE 彈道塔)列為下批候選**:唯一要動共用函式 `explodeAt/updateProjs` 的方案(cfg.hitEnemies 旗標短路),務必單獨 commit 並回歸測 bomber 自爆與火/冰 Boss 彈道。

## 無盡模式(2026-07-12,原 3.1 選項A)
- **`G.over` 只留給真正的結局(lose),通關改設 `G.won` 旗標**——這順手修掉一個舊 bug:過去 `G.over='win'` 永遠不清,`simTick` 被 `!G.over` 擋住,通關後全世界凍結(敵人不動、掉落物撿不起來),淵核區名存實亡。勝利入口是 `winGame()`(冪等,`gameOver(true)` 相容轉呼叫),失敗照走 `gameOver(false)`。
- **通關後暗潮進入無盡循環**:`G.wave.endless=true` + `en`(無盡波數),喘息 `ENDLESS_CFG.rest`(150s)後照 `WAVE_CFG.interval` 排波。強度遵守難度設計鐵律「**更痛更多、不更肉**」:數量走既有 `wave.n` 線性成長、傷害每波 +6% 封頂 3 倍(`endlessDmgMult()` 疊乘在難度/精英倍率之上)、淵核區高階怪(revenant/voidling)進場占比隨波數升到最高 50%。**星核照樣耗能、歸零照樣輸**——通關不是免死金牌。
- **同步/存讀檔**:`won` 進 buildSave/init(客戶端靠 init 拿 `G.won`、靠 snap 的 wave 拿 `endless/en`);讀通關存檔一律進無盡模式(舊存檔沒有 `wave.en` 從 0 起算)。net 的 `over` 訊息:win 不再設 client 的 `G.over`,只秀慶祝畫面。
- **讀檔急救能量**(連帶修復):戰敗當下存的檔能量是 0,原樣讀回第一個 tick 就再敗——applySave 給 `max(存檔值, 25)` 的地板值,讀檔至少有機會搶救。

## 隊友救援(倒下非陣亡)(2026-07-13,第七批)
參考同類遊戲的團隊合作機制(Deep Rock Galactic 的「流血倒地待救」、Don't Starve Together 的「復活需要隊友」)設計:陣亡不再是單人事件,給「一起把人拖回來」一個具體的互動,同時保留死亡的風險(不是無腦送頭)。
- **狀態機是「倒下」插在「致命傷」與「陣亡」之間,不是取代陣亡**:`damagePlayer` 致命傷時,若場上有其他存活且未倒下的隊友(`rescuable`),進入 `p.downed=true`(hp 釘 1、`p.downedT=REVIVE_CFG.downedDur` 25 秒倒數);沒有隊友可救(單機、或隊友也都倒下/陣亡)則直接走原本的 `enterDead(p)` 陣亡流程——**單機模式行為完全不變**,零回歸風險。
- **`enterDead(p)` 是抽出來的共用函式**,原本 `damagePlayer` 內建的死亡處理搬進去,三處呼叫:①沒隊友可救的致命傷 ②倒下期間又挨一下(補刀,直接陣亡,擋住無腦送頭)③倒下讀秒歸零仍沒被救到。
- **救援零額外協定**:`updatePlayersHost`(host-only tick)每幀檢查倒下玩家 `REVIVE_CFG.range`(1.6 格)內有沒有「存活且未倒下」的隊友,有就 `p.reviveP += dt/REVIVE_CFG.reviveTime`(3.5 秒),滿了就救起(hp=`maxhp*REVIVE_CFG.hpFrac` 35%、`iframe=1.2` 給緩衝)。全靠 host 讀雙方已知的 `p.x/y`(專案既有的「位置採信任制」),不用新增 client→host 訊息——跟歸巢螢石/地刺一樣的「零新協定」設計語言。
- **16 個動作函式加 `|| p.downed` 守衛**(doSwing/doShoot/doMine/doPlace/doTill/doPlant/doFish/doRecall/doEat/doDropItem/doDropAt/doFeed/doEnh/doTrade/doRepair/doDeposit):倒下等於徹底失能,不能戰鬥/挖礦/放置/吃東西/交易。`localControl`(main.js)加 `me.downed` 到既有的 `me.dead` 輸入攔截,**故意不進觀戰鏡頭**(跟 `me.dead` 不同)——鏡頭留在倒下位置,玩家能親眼看著隊友是否趕來,也能在聊天喊「這邊這邊」。
- **`nearestAlivePlayer` 等既有的 `!p.dead` 過濾器完全不用改**:倒下期間 `p.dead` 仍是 false,敵人照樣把倒地的人當有效目標追殺——這正是「情勢緊張,快救人」的張力來源;`explodeAt`(爆炸 AOE)本來就不看 iframe,倒地的人被炸到照樣直接補刀陣亡。
- **同步**:`downed/downedT/reviveP` 三欄位加進玩家 tuple 的**尾端**(snap 與 init 兩處編碼、兩處解碼,共 4 處一起改,固定欄位順序陣列,不是 spread),客戶端才畫得出倒地畫面與救援進度環。
- **渲染分兩層**(render.js):倒地的「身體」畫在黑暗遮罩**之前**(受光照影響,跟正常玩家一樣暗處看不見合理);SOS 標記+救援進度環+倒數畫在黑暗遮罩**之後**(跟名字同一批「暗處也要找得到隊友」的設計),包含自己倒下時也看得到自己的倒數(不用另外查 UI)。全螢幕暗紅暈疊在最後(`me.downed` 才畫,純氛圍,不重複顯示倒數文字避免資訊重複)。

## 武器動畫效果 + 打擊特效(2026-07-13,第七批)
給揮擊/命中補上「動起來」的回饋,原則是**程序化 canvas 動畫優先於逐格 AI 圖**——AI 生圖一次只能出一張穩定構圖,做不出前後幀連貫的揮擊/爆炸動畫(每張姿勢都會漂移),硬做只會抖動穿幫;canvas 用同一個形狀做位移/縮放/淡出,天生保證幀與幀連貫,而且雙端(host/client)各自算、零額外頻寬。單張 AI 圖只用在「命中衝擊波」這種不需要連續姿態、純粹放大淡出的地方,且做成有 fallback 的疊加層(找不到圖就退回純向量,兩者互不依賴)。
- **揮擊弧光上色**:`ELEM_FX_COLOR`(config.js)依武器 `elem` 給弧光/拖影染色(焰橘/霜藍/光金/暗紫/重擊灰,無屬性=白);**踩雷记录**:`weaponOf`/`bestPick`/`meleeWeaponOf`(inventory.js)回傳值是把 `ITEMS[id].sword`/`.ranged` 子物件**展平 spread** 進結果,`elem` 直接掛在 `held.elem`,不是 `held.sword.elem`——寫成巢狀存取會靜默失效(不噴錯,弧光就是一直白色),已用 `simtest4.js` 鎖住這個形狀假設。
- **揮擊拖影**:近戰揮擊(非挖礦)時額外畫 2 個「稍早角度、較淡」的武器圖示殘影(`swingF+off` 往回推算角度),做出動態模糊感;`swingF` 是遞減的(1→0),稍早位置 = 稍高的 swingF,拖影方向不能算反。
- **打擊特效(`G.hitFx`)**:`hurtEnemy` 統一發 `emitFx({k:'hit',x,y,elem,crit})`(涵蓋近戰/遠程/塔/陷阱等**所有**傷害來源,單一插入點),`applyFx` 收到後 push 進 `G.hitFx`(host/client 各自的陣列,`HITFX_DUR`=0.32 秒共用常數在 config.js,entities.js 倒數用、render.js 算動畫進度用同一個數字)。`crit`(屬性剋制 mult>1.3)放大範圍與亮度,呼應既有的傷害數字「!」標記。
- **打擊特效素材**(`assets/effects/*.png`,6 張:fire/frost/light/dark/smash/neutral):`hitFxSprite(elem)` 用既有的 `bakedSprite` 快取(固定烤 96px,動畫縮放靠 `ctx.drawImage` 動態目的地矩形,不用每個當下半徑各烤一份)。**圖片是加分項不是必要項**:找不到就退回純向量畫法(衝擊環+放射短線),遊戲永遠能玩,只是視覺豐富度差異。
- **投射物拖尾**:`pj.elem` 加進投射物 snap tuple(第 5 格),client 端才畫得出跟 host 一致的顏色(不加的話 host 看到彩色拖尾、client 看到預設色,視覺會兜不起來)。`PROJ_TRAIL`(render.js 模組層級 Map)記上一幀螢幕座標畫漸淡短線,純渲染本地狀態、每幀清掉已消失投射物的記憶避免無限增長。

## 快速手勢輪盤 + 成就/圖鑑(2026-07-13,第八批)
- **快速手勢(emote)**:C 鍵開輪盤(`EMOTE_LIST`,config.js,8 種圖示+短句),選一個就在頭上冒圖示氣泡給全隊看(co-op 溝通用,「這裡有礦」「小心」)。**零狀態同步**:`doEmote`(entities.js,房主權威+`p.emoteCD` 冷卻防洗頻)只送一次性 `emitFx({k:'emote',...})`,跟打擊特效一樣走「host 產生→sendAll 廣播→雙端各自倒數」的既有模式,不進 `G.players` 的持續狀態、不進存檔。**倒下也能用**(`doEmote` 只擋 `p.dead`,不擋 `p.downed`)——呼叫隊友救援正是這功能的核心使用情境之一,跟隊友救援系統的設計意圖直接呼應。渲染在黑暗遮罩**之後**畫(跟浮動文字/打擊特效同一批「暗處也要看得到」的資訊,溝通類 UI 不該被光照擋住)。
- **面板互斥**:比照既有的天賦/商人/儲物箱等面板慣例,`toggleEmotePanel` 開啟時關掉其他所有面板,其他面板開啟時也回頭關掉 emote 輪盤——這是全專案面板系統原本就有的「開一個關其他全部」寫法,新面板要記得把自己接進**所有**既有面板的互斥鏈,不是只顧自己那一條。
- **成就/圖鑑是全隊共享,不分玩家**:呼應「螢火隊」一起打拼的主題,存在 `G.achv`(id→true)/`G.bestiary`(怪物 type→true)兩個扁平物件,跟 `G.killCount` 同等級的簡單世界狀態,不用 `Set`(JSON 原生序列化,存讀檔零轉換)。**12 個成就的觸發點全部插在既有事件的確切發生處**(不用額外輪詢),例如 `killEnemy` 開頭一行 `markSeen`+`first_blood`、`breakTile` 掉落判斷 `info.drop.id==='diamond'` 那行、`doFeed` 餵食成功那行、`updatePlayersHost` 救援完成/碎片歸位那兩行——每個只加 1 行,不新開檢查迴圈。**唯一的輪詢例外**是 `void_breach`(踏入淵核區),借用 `updatePlayersHost` 既有的「帶碎片歸位」每人每幀位置檢查順便查 `zoneOf(p.x,p.y)===3`,不為了這一個成就多開一個掃描。
- **`unlockAchv(id)`/`markSeen(type)`(entities.js)是冪等的統一入口**:重複呼叫直接 return,不會重複跳訊息或重複廣播(`simtest5.js` 有測「重複擊殺不重複觸發成就廣播」)。`unlockAchv` 解鎖時 `msgAll` 跳全隊慶祝訊息+廣播 `{t:'achv',id}`;`markSeen` 刻意**不跳訊息**(每隻小蝕影都跳圖鑑通知會洗頻,圖鑑是安靜收集,只有成就才配得上慶祝)。
- **同步靠專屬的 `{t:'achv'}`/`{t:'seen'}` 增量訊息**(net.js,host→client only),不是等下次 init 才更新——`msgAll` 已經廣播了「文字」,但客戶端的 `G.achv[id]` 這個**狀態旗標**要另外同步,面板才能即時反映勾選,不用重連才看得到新解鎖。同時 `bestiary`/`achv` 兩個物件也整包放進 `init`(新加入的人立刻看到全隊至今的進度)與 `buildSave`/`applySave`(舊存檔沒有這兩欄位就從空物件開始,不會噴錯)。
- **`genWorld()` 會重置 `G.bestiary`/`G.achv` 為空物件**(跟 `G.killCount` 同一行歸零)——新世界 = 全隊圖鑑/成就重新開始收集,這是刻意設計(呼應每個世界是一趟獨立的旅程),不是漏加保留邏輯;**寫測試時要注意這個副作用**:同一支測試腳本裡多次呼叫 `genWorld()` 會把先前解鎖的成就全部洗掉,`simtest5.js` 的存讀檔驗證因此改成「存檔前後快照比對」而不是寫死特定 id,才不會跟測試執行順序綁死。
- **UI 入口是 ESC 選單新分頁**(`UI.menuView='achv'`,ui.js,仿既有的 `'stats'` 分頁寫法),不是獨立面板+新鍵位——成就/圖鑑是「查詢」性質,跟統計頁的定位一致,沒必要占用一個新按鍵。怪物圖鑑格子直接用 `<img src="assets/monsters/${et.icon}">` 讀怪物貼圖(找不到 `onerror` 隱藏),未擊敗過的怪顯示「？？？」+灰階濾鏡。

## 地圖可視性強化(2026-07-13,第九批)
玩家反映「M 開地圖不夠明顯」「看隊友位置不夠清楚」——小地圖只有 170px,標記再放大也擠,顏色容易被地形色吃掉,兩個問題其實是同一個根因(**入口太隱晦 + 標記資訊密度不夠**),分開處理。
- **discoverability**:小地圖本身(`#minimap`)加 `cursor:pointer` + hover 發光 + `onclick=toggleMapPanel(true)`,下方新增常駐提示 `#mapOpenHint`(「🗺️ 按 M 看大地圖」,同樣可點)——**在這之前整個 HUD 沒有任何地方提示過 M 鍵存在**,新玩家理論上永遠不會發現這功能,這是比「畫得不夠清楚」更根本的問題。
- **小地圖/大地圖玩家標記**:兩處都改成「白框+彩色填色」(先鋪白底墊對比,再疊玩家色,對抗被地形色吃掉)、自己額外套一圈 `Math.sin` 脈動光環(小地圖/大地圖各自算,不同步、純本地動畫)——不用去記「我是哪個顏色」,脈動的那個一定是自己。大地圖的名字**改成常駐顯示**(原本要 hover 才看到),隊友定位是這個面板最主要的用途,不該藏在互動後面。
- **隊友名單 `#teamList`**(小地圖正下方,`renderTeamList()`,ui.js):文字化列出每位隊友的顏色圓點+方向箭頭(`transform:rotate()`,角度=`atan2(隊友-自己)`)+距離格數,是比「瞇眼看小色塊」更可靠的定位方式。**三種狀態要分開處理**,一開始漏了會把「陣亡重生中」跟「倒下待救」搞混:陣亡中(`p.dead`)沒有座標意義(即將自動傳回星核),只顯示「重生中」不畫方向箭頭;倒下待救(`p.downed`,呼應隊友救援系統)最需要方向+距離(決定衝不衝得過去救),用 🆘 + 紅色閃爍樣式凸顯,比一般隊友定位更急迫。
- **安全性**:玩家名字是別人打的(net.js 的 `hi` 訊息來源),`renderTeamList` 一律用 `textContent`/`createTextNode`/DOM API 組節點,不用 `innerHTML` 拼字串,跟既有的 `showChat` 同一套防注入慣例。
- 節流頻率跟小地圖共用(`uiTick` 的 `UI.mmT`,0.4 秒),沒有另開計時器。

## 移動碰撞:牆角滑動修正(2026-07-13,第九批)
玩家反映「上下都有方塊,中間走過去會卡住」——這是圓形碰撞對抗格子地圖的經典 bug:斜向逼近一個**孤立牆角**時,`moveCircle` 原本的「X 軸單獨測試 / Y 軸單獨測試,任一失敗就整格放棄」邏輯,在兩軸個別測試都會撞到**同一個牆角最近點**的情況下會完全卡死——用無頭模擬實測過,舊版在這個情境下 93%~97% 的影格完全不動(120 幀裡卡住 112~117 幀),而洞穴地形(細胞自動機生成)滿是這種孤立牆角,幾乎每次探索都會遇到。
- **修法是加一個「牆角滑動」逃生分支,不是重寫整個碰撞系統**:新增 `cornerPushVec(cx,cy,r,forEnemy)`(找離圓心最近的實心格邊界點,回傳「格子→圓心」的單位方向向量,複用 `circleHitsSolid` 內同一套 `clamp` 技巧)。`moveCircle` 只在**兩軸個別測試都失敗、且移動是真正斜向的**(`sx!==0 && sy!==0`)這個特定情況下才介入:算出牆角推出向量、轉 90 度得到切線方向(取跟原本移動方向同側的那一支),把移動投影到切線上再試一次——過得去就滑過去,過不去(真的整個被包圍)才維持原地不動。
- **對既有行為零影響,純粹是新增的逃生分支**:單軸擋牆(直線走廊、正面撞一整片牆)完全走原本的邏輯,連 `blocked` 回傳值的語意都沒變(敵人 AI 的啃牆判斷、玩家的挖礦/放置距離檢查都不用碰)。`simtest6.js` 專門鎖住這個修正:①孤立牆角斜向逼近不再卡死(3 種角度全測)②正面撞牆依然正確擋住不會穿過去、也不會被牆角修正誤觸發側移③直線走廊斜向移動的既有平滑度沒有退化④敵人撞牆仍正確回報 `blocked`(啃牆 AI 依賴這個)且不會穿牆⑤鎚子重擊退等級的大位移(子步拆分)依然不會隧穿薄牆。
- **`forEnemy` 參數全程透傳**:牆角推出向量的計算也要用同一份 `forEnemy` 旗標查 `isSolid`(光簾閘門對敵人是牆、對玩家不是),不能漏傳,否則敵人會在閘門旁邊算出錯誤的滑動方向。

## 寵物/跟班系統(2026-07-14,第十批)
延續動物養殖的既有 AI 架構精神,但刻意做成**輕量許多的版本**:寵物是被動加成,不用重現餵食/跟隨/圈養那一整套。
- **視覺是「跟著玩家位置算出來的裝飾偏移」,不是獨立模擬的實體**:沒有 `G.pets` 陣列、沒有 `updatePets` tick、沒有寵物自己的座標同步協定。渲染(render.js)直接用 `p.x/p.y + performance.now()`(每個玩家用 `p.id` 錯開相位)算出一個繞著玩家的軌跡即時畫,host/client 各自算但公式相同,結果自然一致——這是本批唯一的核心設計決策,後面所有「簡單」都是它的直接結果。
- **召喚機制是右鍵切換,不是消耗品**:5 個召喚物(`ITEMS[id].pet` 掛 `PET_TYPES` 的 key)`max:1` 放背包,右鍵 `doPet(p,slot)` 純粹切換 `p.pet` 欄位(同一件裝備再按一次 = 收回;召喚新的自動收回舊的,同時只能一隻),物品本身不會消失,可以隨時換著玩。
- **被動加成沿用 `BUFF_INFO` 的既有分類**(speed/guard/mine/regen/vigor)但**不寫進 `p.buffs`**(那是給料理 buff 的時效系統用的,寵物是永久生效,兩者是平行的加成來源,不衝突不覆蓋)。`petVal(p,kind)`(config.js)在 4 個既有計算點各加一行相乘/相加:`doMine` 挖掘力、`damagePlayer` 減傷、`updatePlayersHost` 回血 tick(獨立於料理 regen 那行,寫死不受脫戰限制)、main.js 的移速與體力回復。**跟天賦/料理 buff 疊加、不互相取代**——多重加成來源疊乘是這個專案一路的既有模式(天賦×料理×寵物×難度),沒有另外設計互斥規則。
- **同步只有一個欄位**:`p.pet`(字串 key 或 null)加進玩家 tuple 尾端(snap 與 init 兩處編碼、兩處解碼,共 4 處一起改,固定欄位順序陣列),外加 `playersByName`(存讀檔、房主重新登入、朋友重連三處都要記得帶上,不然重連會把出戰中的寵物弄丟)。
- **素材走跟動物同一套 `bakedSprite` + emoji fallback**(`petImg`,render.js):找不到 `assets/pets/<type>.png` 就退回 `PET_TYPES[type].icon` 的 emoji,不影響遊戲運作。
- **成就掛勾**:`first_pet`(ACHIEVEMENTS,config.js)在 `doPet` 首次召喚成功時解鎖,跟其他成就同一套 `unlockAchv` 冪等入口。

## 主選單更新紀錄(2026-07-14,第十批)
- **`CHANGELOG`(config.js)是純展示的靜態陣列**,不影響任何遊戲邏輯,新增功能時手動把最新一筆加到陣列最前面(最新在最上面)——沒有自動從 git log 產生,純手動維護,寫的時候要用玩家看得懂的語氣(不是 commit message 那種開發者向的技術敘述)。

## 角色裝備欄位 + 怪物掉裝備(2026-07-14,第十一批)
玩家要求「類似創世神,有各個部位」——把原本「護甲丟進背包 32 格任一格就自動生效(取最好一件)」的機制,換成頭盔/胸甲/護腿三個獨立欄位,並讓怪物死亡有機會掉裝備(越強的怪掉越好的)。
- **`p.equip = { head, chest, legs }`**(entities.js `makePlayer`),每格是 `{id, lv, dur}` 或 `null`。物品定義新增 `equipSlot: 'head'|'chest'|'legs'` 欄位(config.js `ITEMS`)——**沿用既有的 `iron_armor`/`gold_armor` 當胸甲**(補上 `equipSlot:'chest'`,數值完全不動,避免動到舊玩家已經在用的裝備平衡),新增 `iron_helmet`/`gold_helmet`(頭盔,護甲 0.12/0.20)與 `iron_greaves`/`gold_greaves`(護腿,**給移動速度 +5%/+8% 而不是護甲**,刻意做出取捨差異,呼應寵物系統「不同裝備給不同種加成」的既有設計語言)。
- **`bestArmor(p)`(inventory.js)語意整個換掉**:舊版掃 32 格背包取單一最好的一件,新版改成**頭盔+胸甲相加**(各自套 `enhArmorBonus`,合計封頂 0.8)、護腿不計入護甲。**函式名字/簽章刻意不改**,兩個既有呼叫點(`damagePlayer`、render.js 的外框顏色判斷)完全不用碰。新增 `equipSpeedBonus(p)` 讀護腿,套用點在 main.js `localControl` 的移速公式,跟天賦/料理 buff/寵物同一套疊乘模式。
- **穿脫是 `doEquip(p,slot)`/`doUnequip(p,part)`(entities.js)**,host 權威。穿上:讀該背包格 `it.equipSlot`,原本佔用該欄位的裝備退回背包(背包滿了用 `spawnDrop` 掉腳邊,同一套溢出慣例)。**強化等級(`lv`)在穿脫之間完整保留**——衝裝要在還沒穿上/先卸下時對背包裡的那個格子右鍵開強化面板(`isEnhancable` 認 `it.armor`,頭盔/胸甲都算,護腿沒有 `armor` 欄位所以不能衝裝,只能透過升級到金護腿換更高速度加成)。
- **互動方式雙軌**:①右鍵背包裡的裝備類物品(選中快捷欄再對世界右鍵,跟寵物/歸巢螢石同一套 `it.equipSlot` 分派模式,main.js)②把背包格拖到 `#invpanel` 新增的 `#equipSlots` 三格上(`ondragover`/`ondrop`,複製箭塔彈藥格那套既有拖放模式,ui.js `initUI`);點裝備欄格子 = 卸下。兩條路徑最終都走 `doEquip`/`doUnequip`,不重複寫邏輯。
- **同步是「私有全量 + 公開摘要」兩層,不是整包广播**:`p.equip` 完整物件只在 host 每個連線各自的私有 `me` 頻道帶給本人(hostTick 的 per-client send,跟 `inv`/`talents` 同一個管道;`init` 封包的頂層 `equip` 欄位也是給剛加入的自己),因為只有自己需要面板細節。**其他玩家只需要一個衍生出來的護甲百分比**(`Math.round(bestArmor(p)*100)`)塞進玩家 tuple 尾端(snap+init 各一次編碼、對應兩處解碼,共 4 處),純粹是給 render.js 畫外框顏色用——**這順便修掉一個從寵物系統之前就存在的潛在 bug**:客戶端看別人的外框顏色以前是直接呼叫 `bestArmor(otherPlayer)`,但別人的 `p.inv`/`p.equip` 從來沒同步過,算出來永遠是空的;現在 render.js 改成「host 自己算是即時的 `bestArmor(p)`,client 一律讀同步來的 `p.armorPct`」(`NET.isHost()` 判斷),兩邊都對。
- **舊存檔遷移(`migrateLegacyArmor`,entities.js)**:舊存檔沒有 `equip` 欄位,restore 時傳進來是 `undefined`,guard 條件 `if (p.equip) return` 會放行遷移邏輯——掃該玩家背包找 `equipSlot==='chest'` 裡護甲值最高的一件自動穿上(對應舊版「取最好一件」的行為,讓老玩家讀檔後防禦力不會憑空消失),沒找到就給空殼 `{head:null,chest:null,legs:null}`。**兩個還原點(game.js 的房主自己重登、`playerJoinAs` 朋友重連)都要呼叫**,新玩家因為 `makePlayer` 已經給了非 null 的 `equip`,guard 會直接跳過(no-op),不會誤觸發。
- **怪物掉裝備(`EQUIP_DROP_CFG`,config.js)**:沿用既有 `SCROLL_RATE` 那套「每個怪類型一個機率,查表不用改邏輯」的模式,`rate`/`tier` 兩張表決定「多容易掉」跟「掉哪個檔次的池子」(`weak`/`mid`/`elite`,越強的怪類型只出現在後面的池子,越強的怪→越好的裝備),`eliteMult` 是精英巢穴怪(`e.elite`)的機率倍率。**機率就是這張表裡的數字,要調平衡直接改 `rate`,不用碰程式邏輯**(對應玩家提出的「機率是否可調整」)。神殿 Boss 與暗潮最終波守衛額外**必掉**一件 `bossPool`(金裝)隨機一件,走既有的 `e.home`/`sentinel` 死亡分支,不跟 `rollEquipDrop` 的隨機池重疊(那兩個分支的怪類型本來就不在 `rate` 表裡,不會被判定第二次)。
- 測試:`simtest8.js`(31 個斷言)涵蓋穿脫/退回背包、護甲相加不是取最好、護腿移速加成、強化等級穿脫保留、傷害計算實際吃到裝備、存讀檔/朋友重連保留裝備欄、舊存檔遷移(含沒有裝備跟已遷移過兩種邊界)、怪物掉裝備機率與池子分層、精英倍率、Boss 必掉金裝。

## 塔類第二批:加農塔/連弩塔/重砲塔(2026-07-14,第十二批)
玩家反映「塔類總類太少」——原本只有光塔(免維護單體)、箭塔(彈藥制單體)、凜鈴塔(純控場)三種,新增三座**各自不重疊**的塔,分工變成「群體/分散群體/單體爆發」三種輸出型態。
- **加農塔(`cannon_tower`)是唯一動到共用函式的塔**:彈道沿用既有的 `aoe:{r,wallDmg}` 機制(火/冰系 Boss 彈道同一套),但既有的 `explodeAt`/`updateProjs` 只處理「敵方彈道炸玩家」,沒有「玩家彈道炸敵人」的路徑——新增 `cfg.hitEnemies` 旗標(`explodeAt`),true 時額外掃 `G.enemies` 造成範圍傷害。**倒序迴圈**(`for (let i = G.enemies.length-1; i>=0; i--)`)是必要的,`hurtEnemy` 可能觸發 `killEnemy` 從 `G.enemies` 中 `splice`,正序迭代會跳過緊接著的下一隻(跟地刺陷阱、加農塔命中判斷同一個雷)。`updateProjs` 的 `pj.from==='p'` 分支比照既有 `pj.from==='e'` 的寫法補上「有 aoe 就跳過直擊、改在落地時統一由爆炸結算」,避免主目標命中+爆炸疊加兩次傷害。**`wallDmg:0`**:加農塔的爆炸不會傷到自己蓋的牆/塔,只有 `hitEnemies` 生效。
- **連弩塔(`multi_tower`)**:免彈藥(跟光塔同定位,靠冷卻/單發低傷平衡,不像箭塔要顧彈藥),`updateMultiTowers` 每次 tick 抓範圍內**最近的 N 隻**(`MULTI_TOWER_CFG.targets=3`)個別發射一般彈道(無 aoe),分散命中不同目標——跟加農塔的「範圍傷害波及聚在一起的怪」是互補而非重疊的克群手段。
- **重砲塔(`sniper_tower`)**:射程全塔類最遠,**目標選擇用兩輪掃描**——第一輪只找 `e.elite || et.boss` 的目標中最近的一個,找不到才退回第二輪找一般敵人中最近的;命中精英/Boss 額外乘 `eliteMult`(1.6)。這是本批唯一「挑目標」而非「打最近」的塔,呼應「越硬越有感」的設計初衷,冷卻極慢(4 秒)換取單發爆傷。
- **三座塔的 `maxPerPlayer` 檢查與 `owner` 賦值完全比照凜鈴塔既有寫法**(`doPlace` 加一個共用 if 分支用三元運算子挑對應 CFG,不是複製三份重複程式碼)。三個新的 idx Set(`cannonIdx`/`multiIdx`/`sniperIdx`)進 `TOWER_IDX_SETS` + world.js/game.js/net.js 三處 `.clear()`——跟自動採礦機/傳輸帶當初加 idx Set 是同一條檢查清單,漏一處會導致讀檔或新玩家加入後塔「不會動」(idx Set 沒有物件的索引,tick 函式掃不到)。
- **不需要新的存檔/同步欄位**:三座塔沒有彈藥/燃料這類要持久化的狀態(`o.shootT` 冷卻計時器是純執行期暫態,比照箭塔的 `o.shootT`,故意不進固定欄位順序陣列),放置後全自動運作,零 UI 面板、零玩家互動,行為跟光塔一致。
- 測試:`simtest9.js`(15 個斷言),特別針對「共用函式沒有動到既有行為」補了回歸測試(CLAUDE.md 先前就點名這是風險點):敵方無 aoe 彈道直擊玩家如常、Boss 火球(`aoe` + `from:'e'`)確認**不會**誤傷旁邊的怪(`hitEnemies` 短路只在 `from:'p'` 路徑生效);另外驗證加農塔波及多隻怪且主目標不疊加傷害、連弩塔同時鎖定 3 隻不同目標、重砲塔優先鎖定較遠的精英怪而非較近的雜兵、沒有精英時正確退回一般目標、每人數量上限。

## 玩家間贈送(2026-07-14,第十二批延伸)+ 成就補完
- **`doGift(p, slot, targetId)`(entities.js)**:對著隊友右鍵、手上選中任意物品,把整疊直接送進對方背包,不看物品種類——插入點是 main.js 右鍵分派鏈的**最頂端**(比餵動物判斷還優先),因為送禮不像餵動物需要「物品是牠的飼料」這種前提,只要滑鼠指著隊友就成立,擋在其他所有判斷之前才不會被 `it.food`/`it.place` 等分支搶走。
- **堆疊道具 vs 帶狀態裝備,沿用既有的掉落物拾取判斷式**(`entities.js` 的 `updateDrops` 早就在用):`s.lv || (s.dur !== undefined && s.dur !== null)` 為真就走 `addEnhancedItem`(保留強化等級/耐久,不可疊合併),否則走 `addItem`(照堆疊規則,回傳裝不下的剩餘量)。**送禮允許部分成功**:對方背包只剩少數空位時,送出裝得下的量、剩的留在自己背包(不會憑空消失,也不會失敗整批取消)。
- **零新增同步欄位**:送禮結果體現在雙方 `p.inv` 的既有變化上,靠下一次 `snap` 的 `me.inv`(自己)/`inv` 廣播自然同步,不需要額外協定欄位;唯一的新協定是 client→host 的 `{t:'gift',slot,id}`(net.js),跟 `equip`/`pet` 同一套「純意圖轉發,房主權威執行」模式。
- **成就補完**:新增 `first_equip`(第一次穿上裝備欄)、`first_gift`(第一次送禮)兩枚,分別掛在 `doEquip`/`doGift` 成功執行處,跟其他成就同一套 `unlockAchv` 冪等入口——這兩個是上一批裝備系統跟這批送禮系統各自「漏掉的收尾」,不是獨立功能。
- 測試:`simtest10.js`(13 個斷言)涵蓋一般堆疊道具送禮、對方背包沒滿位置時部分送出且剩餘不消失、裝備類強化等級/耐久完整保留、倒下/對自己/距離太遠時正確擋下、兩枚新成就的解鎖時機與冪等性。**踩雷記錄**:測試一開始用全新玩家的背包驗證「收到整疊 10 個木材」失敗,原因是 `makeStartInv()` 給每個新玩家起始背包就帶了 8 個木材,`addItem` 會先合併進那個既有堆疊而不是開新格——不是遊戲邏輯錯誤,是測試沒清空起始背包導致的假陽性,修法是測試裡先 `B.inv.fill(null)` 清空再送禮。

## Bug 修正:背包數量要滾滑鼠才會更新(2026-07-14)
玩家反映「都要動一下滑鼠滾輪,道具數量才會更新成正確的」——根因是**兩個同名不同層級的旗標長期被搞混**:`p.invDirty`(玩家物件上的旗標,`doMine`/`craftRecipe`/`doGift`/`addItem`/`addEnhancedItem`…十幾處房主端函式都有寫入)跟 `UI.invDirty`(全域 UI 旗標,`ui.js` 的 `uiTick` 只認這個,`true` 才會呼叫 `refreshSlots()` 重畫背包/快捷欄格子上的數量文字)。**`p.invDirty` 從頭到尾只有寫入、從來沒有任何地方讀取過**(`grep` 全專案確認),等於是個純裝飾、完全不起作用的旗標。
- **為什麼滾滑鼠才會動**:`UI.invDirty` 真正會被設成 `true` 的地方是切換快捷欄選中格(按 1-8、點格子、滑鼠滾輪換選中物品),這些操作剛好「順便」觸發了重畫,製造出「要滾一下才會更新」的錯覺——本質是背包內容真的變了但沒人通知 UI,直到另一個不相干的操作意外觸發重畫才把積壓的變化一次顯示出來。
- **為什麼多人連線時客戶端感覺不到**:客戶端的畫面靠 10Hz 的 `snap` 快照驅動,`net.js` 收到快照時**無條件** `UI.invDirty = true`(不管背包實際有沒有變),等於每秒強制重畫 10 次蓋過了這個 bug。**房主(含單機,本質是零連線的房主模式)才是真正受影響的對象**——房主端的動作是直接呼叫函式改 `p.inv`,沒有經過快照這道「順便重畫」的保險。
- **修法**(`ui.js` 的 `uiTick`):把讀取端補上,一行解決——`if (UI.invDirty || me.invDirty) { UI.invDirty = false; me.invDirty = false; refreshSlots(); }`。`me` 在房主端就是被十幾處函式直接改動的那個活物件,`me.invDirty` 因此能立刻反映出「這一幀背包真的變了」;對客戶端沒有副作用,因為客戶端自己的 `me.invDirty` 只在剛建立時的預設值 `true` 生效一次就被這行清掉,之後完全靠既有的快照機制驅動,行為不變。**沒有改任何一處寫入端**,單純讓既有一直存在但沒人用的旗標開始發揮作用。
- 順便修掉裝備欄面板(`renderEquipSlots`,同一個 `refreshSlots()` 呼叫鏈)的同一種延遲——房主端穿脫裝備後,裝備欄圖示現在也會立刻反映,不用等滾一下滑鼠。
- 沒有寫自動化測試:這是 DOM 渲染時機的 bug,現有的無頭模擬測試框架只載入 config/world/inventory/entities/game 五支檔案(不含 `ui.js`),純邏輯層面在這次改動前後行為完全一致(照跑過整套既有回歸測試,10 支全過),建議直接在遊戲裡操作驗證(挖礦/合成/送禮後數量是否立即更新)。

## 星核超載餵食(護盾)(2026-07-14,第十三批)
延續核心迴圈「挖光晶回來按 F 灌星核」,解決「能量已經滿了,多挖的光晶除了賣掉沒地方用」的痛點——CLAUDE.md 先前就把這個構想記為候補。
- **`G.core.shield`**:能量滿了以後 `doDeposit` 繼續收光晶,依 `SHIELD_CFG.feedShield`(3,刻意比正常餵食的 `CORE_CFG.feed`=6 低,反映「溢出」轉換有損耗)疊護盾值,封頂 `SHIELD_CFG.maxShield`(30)。護盾與能量是兩段獨立判斷(先試填能量,`canUse<=0` 才進超載分支),UI 訊息與音效比照原本的餵食流程,只是文字/顏色換成護盾主題(🛡️ 青色)。
- **`drainCore(amount)` 是新增的唯一星核扣血入口**(entities.js):護盾優先吸收,扣完護盾才動到本體 `energy`。原本兩處各自直接改 `G.core.energy` 的地方(`explodeAt` 的爆炸炸到星核、`updateEnemies` 暗潮怪直接打星核)都改呼叫這個共用函式——**跟 `hurtEnemy`/`damagePlayer` 是同一種「傷害先過一層共用函式」的設計語言**,之後任何新的星核傷害來源(如果有的話)也該接這個函式,不要繞過去直接扣 `energy`。
- **存讀檔/同步是熟悉的既有模式**:`G.core` 多一個 `shield` 欄位,`buildSave`/`applySave`(game.js)與 `init`/`snap` 的編解碼(net.js,四處)各自比照 `energy`/`shards` 補上一行,舊存檔沒有這欄位時 `|| 0` 兜底。snap 的欄位縮寫成 `sh`(呼應既有 `e`=energy、`s`=shards 的精簡命名慣例)。
- **視覺**:星核外圍除了原本的能量環(青/紅,依比例畫弧),護盾 >0 時在外側多畫一圈淡青色護盾環(`render.js`);HUD 的星核數字後面有護盾時附加 `🛡️數字`(`ui.js`);hover 提示文字補一句超載說明,新玩家才會知道這個機制存在(呼應先前地圖入口太隱晦的教訓,新機制優先確保「玩家找得到」)。
- 測試:`simtest11.js`(11 個斷言)涵蓋能量未滿時正常餵食不轉護盾、能量滿後溢出正確轉換效率、護盾封頂且用不完的光晶留在背包不會被白吃、`drainCore` 優先扣護盾且護盾扣完才動能量(含護盾恰好不夠扣的邊界)、爆炸傷害星核同樣先扣護盾、存讀檔保留護盾值。

## 飾品欄(第四裝備格)(2026-07-14,第十三批延伸)
延續裝備欄系統,加第四格「飾品」,給拾取範圍/閃避/暴擊這類「特殊」被動,跟頭盔/胸甲(護甲%)、護腿(移速%)的數值型加成做出區隔——比照設計官對寵物系統的評語,不同裝備類型給不同種加成才有取捨感。
- **`doEquip`/`doUnequip` 完全不用改**:當初裝備欄設計就是讀 `it.equipSlot` 存進 `p.equip[part]` 的通用邏輯,沒有寫死 head/chest/legs 三選一。`p.equip` 多一個 `accessory` 鍵、`EQUIP_SLOT_NAME` 補一筆、`index.html` 的 `#equipSlots` 多一個 `.eqslot` div——**ui.js 的穿脫/拖放/面板刷新也完全不用改**,因為那些程式碼本來就是 `querySelectorAll('.eqslot')` 掃現有的 DOM 元素,不是寫死的清單。這是先前裝備欄批次「做成通用機制」的直接回報。
- **三款飾品各自對應一個從沒被動過的生效點**,刻意不跟已有系統(天賦/料理/寵物)重疊數值類型:
  - `ring_magnet`(拾取戒指):掉落物磁吸範圍 ×1.5。原本 `updateDrops` 用寫死的 `nearestAlivePlayer(d.x,d.y,2.4)` 找最近的人,**因為磁吸範圍現在因人而異,不能再用固定半徑的通用函式**,改成自己寫迴圈比大小(`dd < magnetRangeOf(q) && dd < bd`)——這是本批唯一動到既有共用函式呼叫方式的地方,注意不要漏改別的呼叫端(`nearestAlivePlayer` 本身沒有改,其他呼叫這個函式的地方不受影響)。
  - `ring_dodge`(敏捷護符):15% 機率完全免傷,插入點在 `damagePlayer` 最頂端(`p.godmode` 檢查之後、算傷害之前)——**是「0 傷害」不是「打折」**,跟護甲/岩鎧 buff 的減傷計算完全獨立,兩者不衝突(閃避沒觸發時,原本的護甲%計算照常套用)。
  - `ring_crit`(獵殺勳章):20% 機率造成 1.8 倍傷害,插入點是 `doSwing`/`doShoot` 的傷害計算式(`* rollCrit(p)`)。**一次揮擊只roll一次**(多目標的範圍武器,揮到的所有敵人共用同一次判定結果),沿用原本 `dmg` 只算一次、迴圈裡重複套用的既有寫法,不是每個目標各自判定。
- **踩雷記錄(TDZ)**:一開始把 `MAGNET_RANGE` 常數定義在 `ITEMS` 表**之後**(跟着 `EQUIP_SLOT_NAME` 放),但 `ring_magnet` 的 desc 模板字串在 `ITEMS` 表**之內**引用了它——`const` 的暫時性死區導致載入就整個崩掉(`ReferenceError: Cannot access 'MAGNET_RANGE' before initialization`),回歸測試一跑全部炸掉才抓到。**這正是 CLAUDE.md 反覆提醒過的「TDZ 陷阱」,這次還是中招**,修法跟 `AUTO_MINER_CFG`/`EQUIP_DROP_CFG` 同一套:把常數搬到 `ITEMS` 定義之前。教訓:新增任何會被 `ITEMS` 內 desc 模板引用的常數,寫的當下就要確認插入位置在 `ITEMS` 之前,不要等測試爆炸才發現。
- 測試:`simtest12.js`(11 個斷言)涵蓋飾品欄穿脫沿用既有邏輯、拾取戒指的磁吸範圍計算與實際掉落物拉近行為、敏捷護符觸發時完全免傷/沒觸發時正常受傷兩種分支、獵殺勳章暴擊傷害倍率(含 `hurtEnemy` 取整的容許誤差)、存讀檔保留飾品欄。

## 成就補完:塔類/護盾/飾品(2026-07-14,第十三批延伸)
本輪新增的系統(3 座新塔、星核護盾、3 款飾品)都還沒有對應的成就收尾,補上 5 枚,插入點沿用既有 `unlockAchv` 冪等入口,每個都插在「效果真正生效」的那一行,不是插在「玩家嘗試」的那一行:
- `full_loadout`(全副打扮):`doEquip` 成功穿上後檢查 `p.equip` 四格是否**同時**非 null——用 `&&` 串接四個欄位,任一格空著都不算,所以插在穿上「第四件」的那次呼叫才會觸發,不是穿第一件就觸發。
- `shield_up`(護盾騎士):插在 `drainCore` 內,**用 `fromShield > 0` 判斷,不是「護盾欄位存在」**——星核護盾是 0 時 `drainCore` 照樣會被呼叫(暗潮怪打星核是常態),此時全部傷害走能量,不該解鎖;只有護盾真的墊掉至少 1 點傷害才算。
- `crit_master`/`first_dodge`:插在 `rollCrit`/`rollDodge` 這兩個「機率判定」函式**內部**,判定結果為真的那個分支才解鎖——不是每次攻擊/受傷都檢查一次觸發與否,而是把解鎖邏輯跟機率判定綁在同一個函式裡,呼叫端(`doSwing`/`doShoot`/`damagePlayer`)完全不用知道成就系統的存在。
- `tower_collector`(塔藝大師):**全隊共享,不分誰蓋的**——`checkTowerCollector()` 直接掃 `G.objects` 找 6 種塔類型是否至少各有一座在地圖上,不記錄「誰蓋了哪一種」。插入點在 `doPlace` 放置成功後,且用 `TOWER_COLLECTOR_TYPES.includes(it.place)` 短路,只有放的是塔類才觸發檢查(其他上百種可放置物件不用陪跑這個迴圈)。
- **踩雷記錄(測試,非遊戲 bug)**:`simtest13.js` 一開始把測試玩家的座標**直接疊在要放置的塔的目標格中心**,結果全部 6 次 `doPlace` 都靜默失敗——不是遊戲邏輯錯誤,是 `doPlace` 既有的「固體物件不能蓋在玩家身上」保護機制正常擋下(玩家站在格子正中央,跟自己蓋的塔判定成重疊)。修法是把測試玩家移到目標格「旁邊」(y 差 2 格)而非疊上去,呼應建塔本來就該有的正常操作距離。
- 測試:`simtest13.js`(10 個斷言),對每枚成就都驗證「條件不足時不解鎖」與「條件滿足時才解鎖」兩種分支,不是只測正向案例。
- **UI 走既有的 `setOverlay(mode)` 多模式 overlay 架構**,新增 `'changelog'` 分支(仿 `'slots'`/`'win'` 等既有分支的寫法),不是另開一個獨立面板系統。主選單標題下方加一顆低調的文字連結按鈕(`.linklike`,不搶新世界/繼續存檔等主要按鈕的視覺重量),點了切到 `setOverlay('changelog')`,返回按鈕切回 `setOverlay('start')`。

## 新內容批次:新動物/淵核區終極裝備線(2026-07-14,第十四批)
延續「未來開發規劃.md」留下的兩個候選(3.5 v2 真礦車實體 / 新內容批次),選擇工程量小、風險低的新內容批次先做,重點是驗證既有系統的「模板可擴充性」——這批**零新增 tick 迴圈、零新增同步協定**,全部套用既有通用邏輯。
- **新動物 `sheep`(幽草羊→羊毛)/`pig`(沼躣豬→松露)**:純粹在 `ANIMAL_TYPES` 各加一筆,`grep` 確認過全專案所有動物系統的呼叫點(生成/餵食/宰殺/存讀檔/init 同步/UI 秘笈選單/渲染)都是 `Object.keys(ANIMAL_TYPES)` 或 `ANIMAL_TYPES[a.type]` 這種通用寫法,新增品種**沒有改動任何一行既有邏輯**,直接印證了動物養殖批當初「之後想加新動物只要加一筆」的設計預期。宰殺掉落的 `meat` 是通用道具(不分物種),沿用既有行為。
- **飾品欄第四款效果類型「debuff 抗性」——`wool_charm`(暖絨護符)**:跟既有三款飾品(拾取/閃避/暴擊)刻意不重疊數值類型,對抗冰系 Boss 彈道附加的 `p.buffs.slow` debuff。插入點在 `explodeAt` 套用 `cfg.slow` 的那一行:`t: cfg.slow.dur * (1 - slowResistOf(p))`——沒裝備時 `slowResistOf` 回傳 0,乘出來完全不變,對既有行為零回歸(`simtest14.js` 用對照組驗證過)。`slowResistOf(p)`(inventory.js)是跟 `magnetRangeOf` 同一套「讀 `p.equip.accessory` 對應 `ITEMS[id]` 欄位」的樣板函式。
- **淵核區終極裝備線,呼應 3.1 遺留項**(當初「第五區域專屬新裝備線仍留待日後」):新材料 `void_shard`(淵晶)只能從淵核區深層怪(`revenant`/`voidling`)擊殺掉落(機率 0.22/0.18,插入點跟 `SCROLL_RATE`/既有掉落分支同一處),`void_sword`(dmg 58,超越金劍的 40)與 `void_armor`(armor 0.62,超越金甲的 0.5)在工作台用金錠+淵晶合成——**故意做成「用材料當進度門檻」而不是額外加鎖判斷**,沒打過淵核區深層怪就湊不齊材料,配方本身不用另外檢查 `G.unsealed`。
- **成就 `void_forge`**:插入點在 `craftRecipe`(inventory.js)成功合成之後,用 `r.out === 'void_sword' || r.out === 'void_armor'` 判斷——**是本專案第一個掛在「合成配方」而非「戰鬥/採集/事件」上的成就觸發點**,證明 `unlockAchv` 這個統一冪等入口可以插在任何函式裡,不限定特定系統。
- **測試方法論踩雷(vm 而非巢狀 eval)**:`simtest14.js` 一開始比照過去慣例把 `eval(src)` 包在一個 `run()` 函式裡呼叫,結果 `ANIMAL_TYPES is not defined`——**直接 eval 的 `const`/`let` 宣告只存在於該次 eval 呼叫自己的詞法作用域,呼叫結束就消失,連呼叫它的外層函式都讀不到**(這跟瀏覽器多個 `<script>` 標籤共享同一個「Script Global 詞法環境」的行為不一樣)。修法改用 Node `vm.createContext()` + 一次性 `vm.runInContext(全部檔案原始碼 + 測試邏輯, context)`——把所有檔案內容跟測試斷言接成同一段字串一次執行,重現瀏覽器多 `<script>` 標籤共享頂層 `const` 的語意。**之後寫無頭測試,直接照 `simtest14.js` 的 vm 寫法起手,不要再用巢狀 `eval()`**。另外 headless 測試除了 CLAUDE.md 原本記載的 `NET/UI/SFX/showMsg/setOverlay/localStorage` 要 stub,這次另外發現 `G.drops` 掉落物物件的道具欄位是 `item`不是 `id`(`id` 是掉落物實例自己的流水號)——寫斷言比對道具種類時要注意這個欄位名稱陷阱。
- 測試:`simtest14.js`(21 個斷言,vm context 版)涵蓋新動物載入/餵食倒數/產物掉落/宰殺掉肉、淵晶裝備合成成功與成就解鎖、暖絨護符緩速抗性打對折且對照組(沒裝備)行為不變、淵魂機率掉落淵晶。

## 地圖放大 + 怪物種類單調修正(2026-07-15,第十五批)
玩家實際反映兩個問題:「地圖有點太小,一下就被探索完」「地圖上怪物種類出現率似乎很單調」,分開驗證後發現是兩個獨立成因,分開修。
- **地圖放大 200×200→280×280(×1.4)**:新增 `ZONE_R = { dirt, stone, obsidian, sealIn, sealOut, voidOut }`(config.js)取代 `world.js` 裡散落十幾處的分區半徑魔術數字(42/72/96/94/116),`genWorld()`/`zoneOf()` 全部改讀 `ZONE_R`——**之後要再調地圖大小只要改 `MAP_W/MAP_H` 跟 `ZONE_R` 這一處**,不用再滿檔案抓數字。`CX/CY` 本來就是 `MAP_W/2` 算出來的,不用額外處理。「最外 2 格強制 BEDROCK 收邊」的既有幾何陷阱手法(見「大地圖」章節)在新尺寸下依然適用(淵核區外邊界 162 > 地圖半寬 140,一樣會在正上下左右方向撞到邊緣,收邊邏輯原封不動)。
- **據點/礦物數量同步 ×1.9(地圖面積放大倍率)**:光是放大距離不加數量,只會讓資源被拉得更稀疏、觀感更空曠,違背「放大地圖」原本想解決的問題。`POI_CFG`(廢墟/巢穴/水池)、`ANIMAL_CFG`(動物)、`genWorld()` 內所有 `deposit()`/`vein()` 呼叫的數量參數、蘑菇生成上限,全部跟著同一個放大倍率調高,維持跟放大前相近的密度。**只有距離參數 ×1.4、數量參數 ×1.9,不要搞混**(距離是空間尺度,數量要補償空間變大的稀釋效果)。
- **世界生成時間**:實測 280×280 約 220ms(200×200 時代約估 110ms),一次性成本(開新世界才跑),不影響遊玩中的效能;渲染早就是視野裁切,地圖變大不影響每幀畫多少格。
- **怪物種類單調,根因是三處生怪表各自寫死「一區只有一種怪」**:`ambientSpawn`(暗處自然生怪,game.js)、`updateNests` 一般/精英巢穴無 `spawnType` 時的 fallback(entities.js)、`startWave`(暗潮,game.js)三處各自用 `zone===0?'imp':zone===1?'hunter':'abyss'` 這種寫死的三元式——**結果是 `spitter`(吐影者/遠程)、`bomber`(爆裂蝕影/自爆)、`phantom`(穿牆幽影)、`breaker`(裂地者/拆牆)這 4 種完整實作好行為(遠程彈道/自爆 AOE/穿牆/拆牆倍率全部寫好了)的怪,全專案沒有任何自然生成點,只能靠 `/power spawn` 召喚**——`ENEMY_TYPES` 裡近半數的非 Boss 怪其實是死代碼,這才是「單調」的真正原因,不是機率或美術風格問題。
- **修法是新增一個共用的分區加權池 `ZONE_SPAWN_POOL` + `pickZoneEnemy(zone)`(config.js)**,三處呼叫端全部改呼叫這個函式,不再各自維護一份邏輯。池子刻意讓該區「招牌怪」仍占多數(zone0 imp 7:2 bomber、zone1 hunter 5:2:2 spitter/phantom、zone2 abyss 5:3 breaker)——**保留原本一區一特色的設計語感,只是混入同分區調性的變化款**,不是把所有怪打散到全地圖亂生。`spore` 刻意不放進加權池,維持它只在 `swarm` 巢穴成群出現的「特色」定位不被稀釋。
- **淵核區(zone 3)維持原本 revenant/voidling 各半的獨立分支**,沒有併進 `ZONE_SPAWN_POOL`(那是通關後內容,呼叫端各自處理更清楚);`pickZoneEnemy` 對未知 zone 的防呆 fallback 實際上不會被呼叫到(zone3 呼叫端都繞過它),純粹是防禦性寫法。
- 測試:延伸 `simtest14.js` 到 31 個斷言,新增地圖尺寸/分區邊界/`ZONE_R` 讀值驗證,`pickZoneEnemy` 三分區各抽樣 300~400 次確認新舊怪種都會出現,以及跑 30 波 `startWave()` 驗證暗潮確實會生出「過去暗潮從未生成過」的新變化款怪物(不是只驗證「有 3 種怪」這種舊代碼也能通過的弱斷言)。額外用獨立腳本量測 `genWorld(12345)` 實際耗時與地形/據點統計數字,確認放大後生成時間與密度都在合理範圍。

## 深怪祭壇:迷你王據點(2026-07-15,第十六批)
呼應剛放大的地圖需要「更多值得走過去的據點」——新增一種比精英巢穴更兇一階、但比神殿更輕量的單次遭遇戰,**全程刻意最大化重用既有系統**,零新增怪物美術/新協定/main.js 改動。
- **資料/實體分離,完全比照神殿的既有模式**:`G.altars`(`[{x,y,dead,zone}]`)只存位置與生死,跟 `G.shrines` 一樣不落 `G.enemies`(敵人不進存檔)。實際守衛實體由 `spawnAltarGuardians()`(game.js)另外生成,呼叫點也完全比照 `spawnShrineBosses()`——`startNewGame()`、`applySave()` 各一次,`net.js` 的 client `case 'init'` 完全不用管(守衛跟其他敵人一樣,靠之後的 `snap` 快照自然同步給客戶端,不需要客戶端自己生成)。
- **看守者重用既有怪種,不新增 `ENEMY_TYPES`**:`ALTAR_CFG.guardian` 依生成所在分區(zone1→hunter、zone2→abyss)決定底怪種,`spawnEnemy(..., {elite:true, home:{x,y}, altar:{x,y}})` 疊 `ELITE_CFG` 再疊 `ALTAR_CFG.hpMult/dmgMult` 兩層倍率,省掉設計新怪美術/新元素相剋的成本。`home` 欄位是刻意重用神殿守衛既有的「戀家」AI(`updateEnemies` 對 `e.home` 的通用處理:玩家靠近就追、拉太遠就回防回血),**零改動**就讓看守者不會離開祭壇亂跑。
- **`e.altar` 這支 `else if` 一定要放在 `killEnemy` 整條 `e.type===X` 判斷鏈的最前面,不能插在 `e.home` 前面就好**:第一次寫的時候插在 `e.home` 判斷之前,想說「反正比 `e.home` 早檢查就對了」,結果測試全滅——因為看守者的底怪種(`hunter`/`abyss`)自己就有專屬的 `else if (e.type==='hunter')`/`else if (e.type==='abyss')` 分支(掉一般光晶用),這兩支排在更前面,鏈式 `else if` 一路比對下來早就先命中、走不到後面的 `e.altar` 分支。**修法是把 `e.altar` 檢查移到整條 `if/else if` 鏈的最開頭**(在 `if (e.type==='imp')` 之前),不管守衛底怪種是什麼都優先攔截。`simtest16.js` 一開始就是被這個 bug 抓到全部相關斷言失敗,才挖出問題所在。
- **死亡不給碎片,跟神殿死亡流程明確分開**:保底 2 張卷軸 + 重用 `EQUIP_DROP_CFG.pools['mid'/'elite']`(依 zone)保底一件精良裝備 + 在祭壇中心 `setObj` 生一個 `chest` 物件(**重用整套既有寶箱系統**:玩家用鎬敲開,自動走 `openChest`/`CHEST_LOOT`,零新程式碼)。`unlockAchv('altar_breaker')` 走既有冪等入口。
- **存讀檔完全比照 `traders` 的寫法**(`G.altars = s.altars || G.altars`):`applySave` 一開始就用同一個種子重跑 `genWorld()`,新舊版本的 `genWorld` 都會產生確定性一致的祭壇位置,舊存檔沒有 `altars` 欄位時直接沿用剛生成的那份(不會少一批據點);已擊破的祭壇讀檔後不會重新長出守衛(`spawnAltarGuardians()` 對 `a.dead` 的檢查沿用跟 `spawnShrineBosses()` 一樣的邏輯)。**唯一的已知小缺口**:非常舊、在此功能上線前存的檔,讀回來後 `G.altars`(重新生成的)座標理論上跟該局的 `s.tiles`(舊地形,沒有祭壇的石環造型)對不上,看守者會站在普通洞穴裡而不是石環空地——純視覺落差,不影響戰鬥/掉落功能,沿用專案一貫「新地形特徵不回溯裝飾舊地圖」的做法不特別處理。
- 大/小地圖標記(ui.js `mapMarkers`/`drawMinimap`)比照巢穴的「沒探索過不暴雷」規則,圖示 `🏛️` 跟神殿的 `🗿` 刻意用不同符號區分。
- 測試:`simtest16.js`(20 個斷言)涵蓋祭壇生成數量與 zone 分佈、守衛血量正確疊乘兩層倍率、擊殺後 `altar.dead`/成就/掉落/開箱、**神殿死亡流程的回歸測試**(確保沒有把 `e.altar` 分支插壞 `e.home` 分支,神殿守衛死亡依然正常給碎片)、存讀檔往返後祭壇生死狀態與守衛不重複生成。

## 劇情 NPC + 任務日誌(2026-07-15,第十七批)
玩家提議「可以新增更多 NPC 需求/劇情等設計嗎」,選定規模是**獨立任務日誌系統**(新 UI 面板追蹤多條進度)+ **新增 1、2 位有個性的 NPC**——這是遊戲第一個任務系統,設計重點是把三種任務型態的判斷條件全部掛在既有資料上,不建立新的追蹤機制。
- **兩位新 NPC**:鐵匠錚錚(要材料練裝備)、拾光者微塵(研究蝕影與守望者,呼應既有「喚醒不是殺戮」的敘事支線),各自 3 關委託組成一條小劇情,`requires` 欄位串成鏈——完成上一關才解鎖下一關,面板對未解鎖的關卡顯示「？？？」保留懸念。站位/渲染/存讀檔/init 同步**完全比照商人「莫勾」的既有模式**(`G.questNpcs` 對應 `G.traders`,`questNpcImg` 對應 `traderImg`,右鍵距離判定同一套寫法)。
- **三種任務型態,判斷條件全部重用既有資料,只有一種需要新追蹤**:
  - `deliver`(遞交材料):直接重用商人交易的 `canAfford`/`payCost`,零新邏輯。
  - `achv`(達成某成就):直接讀 `G.achv[need]`,**零額外追蹤**——「擊敗神殿」「踏入淵核區」本來就有對應成就,拿來當任務條件不用另外設計判斷式。
  - `kill`(累計擊殺數):**唯一需要新狀態的型態**,`G.quests.active[id] = {kills}` 記錄「接到委託之後」的擊殺數(不是歷史總擊殺,不然還沒解鎖的任務會因為玩家過去打過那種怪而偷跑完成)。`advanceKillQuests(type)`(entities.js)插在 `killEnemy` 最開頭(`markSeen` 之後),逐一比對 6 筆任務找出「型態是 kill 且種類符合且已接取未完成」的那筆才加 1——資料量小(目前只有 1 筆是 kill 型),用迴圈掃描比額外維護一份索引更簡單。
  - 一個任務解鎖時,若下一關剛好是 kill 型,`doQuestTurnIn` 會在該時刻才幫它 seed `active` 記錄(`requires:null` 的第一關則在 `genWorld()` 直接 seed)——**確保進度只從「玩家看得到這個任務」的那一刻算起**。
  - `questAvailable(id)`/`questReady(p,id)` 兩個函式**不修改任何狀態**,client/host 都能直接呼叫(用來畫面板);真正的 `doQuestTurnIn` 才是房主權威、會改動背包與 `G.quests`。這跟磁吸範圍/裝備加成那套「唯讀計算本地跑,異動一定過房主」的既有分工原則一致。
- **同步走「全量 init 快照 + 增量 `{t:'quest'}` 廣播」雙層模式,完全比照 `achv`/`seen` 的既有寫法**:新加入的人從 `init` 拿到目前全部 `G.quests`(含 `active`/`done`),完成當下再補一個小封包讓在線的人立刻更新面板,不用等下次重連。
- **踩到一個順序雷,教訓值得記住**:第一版把 `else if (e.altar)`(上一批深怪祭壇)前面新插的 `advanceKillQuests` 呼叫點放對了位置(`killEnemy` 最前面,不受任何 `else if` 鏈影響),但這正是因為**上一批才剛學到「新的通用判斷要放在型別分支最前面」的教訓**——這批直接用「不透過 `killEnemy` 內的 `else if` 鏈,獨立一行呼叫」完全繞開同一個陷阱,不用擔心分支順序。
- **`/power give <物品> <數量>`(同一批附帶修的缺口)**:玩家反映 `/power` 選單能召喚任何怪物/動物(`Object.keys(ENEMY_TYPES)`/`Object.keys(ANIMAL_TYPES)` 自動列出、新種類免維護),但完全沒有「給物品」的通用指令,測試新道具(羊毛/淵晶/祭壇裝備池…)只能用合成或運氣取得。新增 `case 'give'`(entities.js `runPowerCmd`)+ 秘笈選單的下拉選單(`Object.keys(ITEMS)` 自動列出所有物品,同樣不用手動維護清單)。背包滿了掉腳邊(沿用 `spawnDrop` 慣例),不會憑空消失。
- 測試:`simtest17.js`(40 個斷言)涵蓋 NPC 生成數量、三種任務型態各自的可見性/達成判斷、deliver 型材料正確扣除、kill 型擊殺累計與解鎖時機、achv 型讀成就狀態、完成委託解鎖下一關與 `quest_novice`/`quest_master` 成就、**既有商人交易的回歸測試**(確保新系統沒有動到 `doTrade`)、存讀檔往返保留任務進度,以及 `/power give` 的正常給予與找不到物品的錯誤處理。

## 淵核區終極守護者「淵魄君主」+ 任務終章串接(2026-07-15,第十八批)
使用者請我自行判斷「還有什麼推薦玩法」並實作,選定方向是**幫淵核區(通關後內容)補上真正的收尾**——目前為止淵核區只有環境怪(淵魂/蝕裂者)跟礦物,沒有一個「這就是終點」的指標性戰鬥,而剛上線的任務系統也還沒有把「擊敗最強的怪」納入委託鏈。這批把兩者串起來。
- **資料/實體分離,第三次沿用同一套模式(神殿→深怪祭壇→這次)**:`G.voidLord = {x,y,dead}` 在 `genWorld()` 於淵核區深處(`ZONE_R.obsidian+8` 到 `ZONE_R.voidOut-8` 之間)挖一個小競技場,只存位置/生死;真正的敵人實體由 `spawnVoidLord()`(game.js)另外生成,而且**只有 `G.unsealed` 為真時才會真的生成**——通關前這隻怪存在於資料裡,但 `spawnVoidLord()` 呼叫都是 no-op,不會有玩家碰不到的閒置敵人佔用 `G.enemies`。
- **呼叫時機是本批最容易出錯的地方,刻意想清楚三個時機**:①`startNewGame()`(新世界,`G.unsealed` 必為 false,no-op,純粹跟 `spawnShrineBosses`/`spawnAltarGuardians` 對稱呼叫)②`applySave()`(讀檔還原 `G.unsealed` 之後呼叫,若存檔當下已通關且守護者未死,正確補回實體)③**`unsealVoidZone(fromNet)` 內部**——這支函式很特殊,**房主觸發通關時 `fromNet=false`,但客戶端收到 `{t:'unseal'}` 廣播後也會呼叫同一支函式(`fromNet=true`)只為了同步地形**,若沒有用 `if (!fromNet)` 擋住,每個客戶端都會在自己的 `G.enemies` 額外生一隻「假的」淵魄君主(反正下一次 `snap` 就會被房主的權威資料覆蓋掉,但期間會有一瞬間的重複顯示/邏輯錯亂)。`simtest18.js` 特別分別測了 `fromNet=true`(不生成)與 `fromNet=false`(房主路徑,正確生成)兩種呼叫,鎖住這個時機判斷。
- **死亡分支比照深怪祭壇的教訓,一次到位插在 `killEnemy` 鏈最前面**(`e.altar` 判斷式的正下方),不會被任何 `e.type===X` 的既有分支攔截(`void_lord` 本身是全新種類,理論上不會撞到既有分支,但沿用「新判斷一律放最前面」的既定紀律,不留任何僥倖空間)。獨立戰利品表 `VOID_LORD_LOOT`(不進 `SHRINE_BOSS_LOOT`,語意上這不是神殿守衛),死亡不給星核碎片。
- **戰鬥機制重用火/冰系神殿 Boss 已經驗證過的 `aoe` 彈道 + 可選 `slow` 減速**(`ranged.aoe.slow`),零新戰鬥邏輯;`elem:'dark'` 呼應「牠是所有暗系生物的源頭」的敘事設定,光系武器(光晶法杖)剋制牠,跟 `void_boss`/`revenant`/`voidling` 同一條相剋線。
- **任務終章串接**:`scholar4`(拾光者)要求 `G.achv.void_lord_slain` 已解鎖才能交付,`smith4`(鐵匠)要求遞交 5 顆淵晶——兩條委託鏈藉由同一隻 Boss 收斂成一個共同的「終局」節奏,呼應拾光者一路的敘事主題(牠的最後一句台詞回應了整個「蝕影不是邪惡,只是想要光」的敘事支點)。
- 渲染:目前缺美術素材(`assets/monsters/void_lord.png` 不存在),自動 fallback 成向量畫法;Boss 描邊色補了 `void_lord` 專屬的洋紅色(`render.js` 的三元判斷鏈,跟其他 Boss 同一套機制)。
- 測試:`simtest18.js`(24 個斷言)涵蓋世界生成資料/通關前無實體、`spawnVoidLord` 在未解封時的 no-op、`unsealVoidZone` 的 `fromNet` 兩種路徑分別驗證、重複呼叫不重複生成、擊殺後掉落/成就/`dead` 標記正確、死後不重生、任務終章解鎖與交付。
- **這次沒做,先寫進未來開發規劃.md 留著之後挑**:更長的委託鏈(3rd NPC 或既有兩位再加關卡)、新武器線(中期過渡的鎚/雙持等變體)、隨機世界事件(資源潮汐/流星雨)、真礦車實體 v2——都評估過會需要新美術/新 UI 互動或較大工程量,不適合在沒有即時人工驗證的情況下一次做完,留給下次有你在場時再排。

## 雙持匕首武器線 + 第三位 NPC「拓路人耘」(2026-07-15,第十九批)
延續「候選功能清單」裡標記為低風險的兩項(委託內容擴充、新武器線),沒有動用任何新美術/新 UI 互動,純粹是既有系統的資料擴充。
- **匕首是第三種「manual 近戰武器」,零新機制**:`meleeWeaponOf`/`bestSword`(inventory.js)對 `manual` 欄位的判斷從一開始就是通用的(矛/鎚已經證明過),新增 `iron_dagger`/`gold_dagger` 只要照樣填 `sword:{dmg,cd,range,arc,manual:true}` 就會自動接上快捷欄選中判定,entities.js/main.js 完全不用碰。
- **耐久按攻速比例放大,不是隨便給個數字**:磨損是「每次命中扣 1」不是按傷害扣,`cd:0.2` 比一般劍的預設 `0.35` 快 1.75 倍,代表同樣的實戰時間裡匕首會多消耗 1.75 倍耐久——鐵匕首 `dur:380`(鐵劍 `220 × 1.75 ≈ 385`,取整)、金匕首 `dur:520`(金劍 `300 × 1.75 = 525`,取整),讓匕首在「耐久撐多久」的體感上跟同代劍一致,不會因為出手快就頻繁損壞。定位是搭配獵殺勳章(暴擊飾品)的高頻出手流,跟矛(長距離)/鎚(範圍+擊退)三分近戰打法的取捨。
- **第三位 NPC「拓路人耘」的委託鏈刻意全部設計成 achv 型(除了第一關)**:探索里程碑(挖到鑽石/擊敗三神殿/通關無盡模式)本來就有對應成就(`first_diamond`/`all_boss`/`endless_enter`),直接拿來當條件,**零額外追蹤邏輯**——這是延續拾光者微塵那條線已經驗證過的做法,是三種任務型態裡最低成本的一種。世界生成完全免改:`world.js` 的 NPC 放置迴圈本來就是 `for (const npcKey of Object.keys(QUEST_NPCS))` 泛用寫法,`QUEST_NPCS` 多一筆 `guide` 就自動多生成一位、多一個攤位,沒有動到任何生成邏輯。
- **`quest_master` 成就的門檻自動跟著任務數量成長**:判斷式是 `QUESTS.every(...)`,新增 4 關委託後自動變成「全部 12 關都完成」才解鎖,不用手動調整這個成就的條件——這是資料驅動設計的自然結果,加內容不用同步改判斷邏輯。
- 測試:`simtest19.js`(24 個斷言)涵蓋匕首資料正確性(攻速比較快/傷害比較低)、選中匕首時 `meleeWeaponOf` 正確回傳匕首本身數值而非背包裡更強的劍(**這是本批最重要的回歸點**——manual 武器的判斷必須是「有沒有被選中」而不是「哪個最強」)、實際掄一次驗證扣血量吻合、第三位 NPC 生成、achv 型任務鏈的完整解鎖流程。

## 淵藏寶庫(2026-07-15,第二十批)
承接「候選功能清單」的「淵核區更多據點」——通關前淵核區只有淵魄君主一個指標戰鬥,POI 密度比其他分區低。新增 4 座「淵藏寶庫」,**第三次沿用神殿→深怪祭壇→淵魄君主一路驗證過的「資料/實體分離」模式**,零新美術、零新協定欄位種類(只是既有欄位多帶一份資料)。
- **`G.vaults = [{x,y,dead}]`**(world.js),`genWorld()` 在淵核區(`ZONE_R.obsidian+6` 到 `ZONE_R.voidOut-6`)挖小房間+一圈淵岩收邊,做法幾乎照抄淵魄君主競技場的邏輯,額外多兩個距離檢查——跟淵魄君主保持 ≥22 格、寶庫彼此也保持 ≥22 格,避免地圖上這幾個「特殊房間」擠成一團。
- **跟深怪祭壇的關鍵差異是「兩隻守衛同時上」而不是單體**:`VAULT_CFG.guardianCount=2`,固定混編 `revenant`(淵魂)+`voidling`(蝕裂者),不像祭壇要依 zone 查表決定底怪種(淵核區只有一種分區,不需要)。
- **守衛生成的門檻比照淵魄君主,不是比照深怪祭壇**:深怪祭壇在 zone1~2,一開局就進得去,`spawnAltarGuardians()` 沒有 `G.unsealed` 門檻;淵藏寶庫在 zone3,通關前玩家根本進不去,所以 `spawnVaultGuardians()` 完全比照 `spawnVoidLord()` 的寫法——`if (!G.unsealed) return`,呼叫點也比照三處(`startNewGame`/`applySave`/`unsealVoidZone` 內 `if (!fromNet)` 那行一起呼叫)。**重複生成防護是「逐座寶庫」而非全域旗標**:用 `G.enemies.some(e=>e.vault的座標吻合)` 判斷該座寶庫是否還有存活守衛,不能用單一 boolean,不然一座寶庫清空、另一座還沒清空時,重呼叫這支函式會漏補未清空那座。
- **`killEnemy` 的 `e.vault` 判斷插在 `e.altar` 之後、`e.voidLord` 之前**,是同一條「新的資料/實體分離分支要在型別分支最前面攔截」的紀律(這條紀律在深怪祭壇那批就已經記取教訓)。判斷「兩隻是否都死了」用 `!G.enemies.some(e2=>e2.vault座標吻合)`——`killEnemy` 開頭已經把 `e` 自己 `splice` 出 `G.enemies`,所以檢查的當下陣列裡只剩「還沒死的那些」,是最後一隻時 `some()` 自然回傳 `false`,不用額外排除 `e` 自己。清空獎勵:2 淵晶 + 一件精良裝備(`EQUIP_DROP_CFG.pools.elite`)+ 開一個 `chest` 物件(重用既有寶箱系統)。
- **`CHEST_LOOT` 補上 `[3]`(zone3)**:`openChest` 原本 `CHEST_LOOT[zone] || CHEST_LOOT[0]` 的 fallback 意味著淵核區的箱子(以前從沒出現過,這批是第一次)會不小心開出 zone0 等級的寒酸獎勵——加這格之後零其他程式碼改動就自動接上正確的終局份量。
- 每隻守衛個別死亡時仍吃到 `killEnemy` 開頭通用的 `e.elite` 加成(卷軸+光晶)與 `SCROLL_RATE`/`rollEquipDrop`,但**不會**額外吃到 `revenant`/`voidling` 各自的 `else if (e.type===...)` 掉落分支(因為 `e.vault` 分支在那些之前攔截),這跟深怪祭壇守衛的既有行為完全一致(守衛的「特殊 POI 掉落」取代「一般同型怪掉落」,不是疊加)。
- **存讀檔/同步四處一起改**(跟祭壇一模一樣的檢查清單):`buildSave`/`applySave`(game.js)、`init` 封包編解碼(net.js 兩處),舊存檔沒有 `vaults` 欄位時保留 `genWorld` 剛生成的那份。大/小地圖標記(ui.js)沿用「沒探索過不暴雷」規則,圖示 `💎`(存活)/`⚫`(已肅清),顏色跟深怪祭壇的紫色區隔開(粉紫 `#ff8cf0`)。
- 測試:`simtest_vault.js`(scratchpad,89 個斷言,vm context 寫法)涵蓋寶庫生成數量/邊界/與淵魄君主及彼此的最小距離、通關前 `spawnVaultGuardians` 為 no-op、`unsealVoidZone` 的 `fromNet` 兩種路徑分別驗證(client 路徑不生成守衛,host 路徑生成正確數量)、守衛屬性(elite+雙層倍率+底怪種)、殺第一隻不觸發清空/殺第二隻才觸發、存讀檔往返保留生死狀態且已清空寶庫不重新生成守衛、**神殿/深怪祭壇死亡流程回歸測試**(確保 `e.vault` 分支插入位置沒有攔截到既有的 `e.home`/`e.altar` 分支)。

## 隨機世界事件(2026-07-15,第二十一批)
承接「候選功能清單」的「隨機世界事件」,同時直接落實候選清單自己點名的顧慮(「太頻繁會干擾核心的暗潮防守節奏,需要之後找人試玩抓手感」)——**刻意做成零新增存檔欄位、零新增網路協定的最小風險版本**,數值明確標註為第一版估計,調參只改兩個 CFG,不用碰觸發邏輯。
- **狀態是純房主端模組層級變數,不是 `G` 的欄位**:`let worldEventT, worldEvent = null;`(game.js),比照既有的 `ambientT`/`mushT`/`saveT` 那組計時器——同一組既有變數也**沒有**在 `startNewGame`/`applySave` 時被重置(這是既有慣例,不是本批新引入的缺口),`worldEvent`/`worldEventT` 照樣不特別處理,行為一致。事件效果(資源潮汐改變 `breakTile` 掉落量、流星雨純粹 `spawnDrop` 在地上)兩者客戶端都是靠既有的 `obj`/`drops` 快照自然同步,**完全不需要新協定**——連「目前有沒有事件在跑」這件事本身都不用同步給客戶端,只用 `msgAll` 的聊天訊息通知(跟暗潮警告同一套「文字通知就夠」的做法),換取零 UI 面板風險。
- **暗潮 `calm` 狀態才會嘗試觸發新事件**:`updateWorldEvent` 每 `WORLD_EVENT_CFG.checkInterval`(5 分鐘)檢查一次,若 `G.wave.state !== 'calm'` 直接跳過(下個週期再檢查,不會累積補觸發)——這是本批對候選清單顧慮的直接回應,把「探索誘因」跟「暗潮防守節奏」的衝突降到最低,不需要額外設計。
- **資源潮汐**:期間隨機一種礦物(`RESOURCE_TIDE_CFG.ores`)掉落量 ×2.5,生效點是 `breakTile`(entities.js)裡一行 `tideMult` 計算——`entities.js` 定義早於 `game.js` 載入,但函式在遊戲真正開始跑之後才會被呼叫,那時 `game.js` 的 `let worldEvent` 已經宣告,跨檔案讀取這個自由變數完全沒問題(跟 `msgAll` 早就在用的同一種「瀏覽器多 `<script>` 標籤共享頂層詞法環境,呼叫時才解析」既有寫法一致,不是新踩雷)。
- **流星雨**:期間每 `METEOR_SHOWER_CFG.interval`(8 秒)在隨機一位存活玩家附近(`range` 距離帶,刻意不是腳邊,鼓勵移動過去撿)掉落一項稀有材料,`spawnMeteor()` 的選點邏輯直接照抄 `ambientSpawn()` 既有的「隨機玩家+隨機角度/距離+找空地板」寫法,沒有發明新的選點演算法。
- 兩種事件互斥(同時只會有一個在跑),各自 `duration` 倒數結束後 `msgAll` 一則收尾訊息、`worldEvent = null`。新增成就 `world_event_seen`(第一次見證任一種事件,插在觸發當下,不分事件種類)。
- **這批沒做、留給下次找人試玩再排的**:目前完全沒有持續性 UI 倒數/橫幅(只有開始/結束兩則聊天訊息),如果實際試玩覺得訊息不夠顯眼,可以之後比照暗潮的 HUD 計時器補一個,做法是把 `worldEvent` 摘要塞進既有的 `snap` 封包(跟 `G.wave` 同一個位置),客戶端目前完全不知道 `worldEvent` 存在。
- 測試:`simtest_worldevent.js`(scratchpad,22 個斷言,vm context 寫法,用 `Math.random` 的呼叫順序控制走向以固定測到兩種事件分支)涵蓋暗潮非 calm 時不觸發、calm+機率必中觸發資源潮汐/流星雨、資源潮汐期間指定礦物掉落量正確乘倍率且**其他礦物不受影響**(回歸)、事件結束後掉落量與 `worldEvent` 正確恢復、流星雨會在玩家附近的 range 距離內掉落清單內的道具、沒有玩家時 `spawnMeteor` 安全地什麼都不做不拋錯、機率沒中時不觸發、**無事件時一般挖礦掉落量完全不受影響的回歸測試**。

## 家具與裝潢(2026-07-15,第二十二批)
玩家提議「可以增加家具類型物件嗎,讓玩家能設計家庭」,並確認方向:部分家具帶小功能(不是純裝飾)、地板設計走疊加式地毯/花磚(不碰目前刻意改成純色分區的乾淨地板畫法)。這批新增 12 個物件(1 種牆+3 種地板裝飾+5 件家具+3 件裝飾品),**全部零新增存檔欄位/網路協定**——除了椅子(坐下回血)跟床鋪(認床重生點)兩個功能點各自需要一小段既有模式的複用。
- **地板裝飾(rug_red/rug_blue/tile_deco)是疊加式物件,不是新地形**:跟圍籬貼圖 `fence_tile.png`「疊在地板上不去背」是同一種既有做法,render.js 在物件迴圈裡加兩個 `continue` 特例分支(跟 `belt`/`spike_trap` 同一批既有特例並列),用純色矩形/棋盤格畫,不需要新美術資產。**故意不碰 `drawCleanFloor`**——CLAUDE.md 先前就記載地板已刻意改成純色分區乾淨畫法以避免 AI 材質太花,這批的地板裝飾是「疊加裝飾物」而非「改地板本身」,兩者是不同層級,互不衝突。
- **裝飾磚牆(`deco_wall`/`T.DECOWALL`)是新地形類型**,跟 `T.WOODWALL`/`T.STONEWALL` 完全同一套 `placeTile` 通用路徑(蓋牆/回收/渲染零額外程式碼),`hp` 刻意跟石牆(建)一致(90),純粹只換 `c1`/`c2` 顏色,不影響防禦數值平衡。
- **家具/裝飾物件(chair/bed/toilet/sofa/bookshelf/plant_pot/painting/candle)全部沿用「物品擴充」批次早就驗證過的純放置物模板**(item id === place type,`doPlace`/`doMine` 零改動,只要 `ITEMS`+`OBJ_HP`+`OBJ_ICON`+`RECIPES` 四處各補一筆)。**刻意全部設成非固體(不進 `OBJ_SOLID`)**,跟火把/提燈/旗幟同一套既有慣例(這款遊戲的小型擺飾一律可以走過去,不會被塞爆的房間卡住玩家)。
- **椅子(`chair`)是唯一動到共用函式的家具**:右鍵坐下/起身完全比照歸巢螢石/釣魚既有的「channel + moveCancel」設計語言——`p.sitting = {x,y}` 記錄坐下當下的位置,`updatePlayersHost` 每幀檢查移動距離超過 `CHAIR_CFG.moveCancel` 就自動起身,`damagePlayer` 頂端跟 `p.recall` 中斷邏輯並列補一行「受傷立即起身」。回血生效點插在既有的「脫戰回血/回春 buff/寵物回血」那一組平行生效點旁邊,**疊加不衝突**(這批的測試就踩過一次:一開始沒排除脫戰回血,量出來的回血量對不上預期,才想起椅子回血是疊加在既有回血之上,不是唯一來源)。**右鍵判定不看手上拿什麼**,對著椅子右鍵就切換,跟箭塔/採礦機的 `targetObj.type` 判定同一種寫法。
- **床鋪(`bed`)只新增兩個玩家欄位 `p.bedX`/`p.bedY`**,右鍵認床(`doClaimBed`)寫入座標,生效點是 `updatePlayersHost` 死亡讀秒歸零那一行——`p.bedX != null` 就重生在床的位置,否則走原本星核旁的預設邏輯。**不驗證床是否還存在**(跟其餘暫態設計的「不為邊角案例加防呆」原則一致,床被拆掉後重生點還留著舊座標也無妨,純視覺落差不影響遊戲性)。持久化走跟 `pet`/`equip` 完全相同的既有管道:`G.playersByName[p.name]` 快照多帶兩個欄位、`applySave`(房主自己重登)與 `playerJoinAs`(朋友重連)兩個還原點各補一行——**這是本批唯一需要碰存檔的地方**,而且是走完全既有的既有機制,沒有新增欄位到 `buildSave` 的頂層或 `init` 封包。
- **`home_sweet_home` 成就**沿用 `tower_collector` 一模一樣的寫法(`FURNITURE_DECOR_TYPES` 陣列 + `checkHomeSweetHome()`,插在 `doPlace` 成功放置後),門檻是「湊滿 5 種不同」而非「全部湊齊」(家具種類比塔類多,湊滿全部太苛刻)。**`deco_wall` 刻意不算進這張清單**——它是 `placeTile` 地形存在 `G.tiles`,跟其餘物件存在 `G.objects` 結構不同,要另外掃全地圖 tiles 才查得到,不值得為了湊數多開一次昂貴掃描。
- **踩雷記錄(測試,非遊戲 bug)**:`simtest_furniture.js` 一開始隨便挑地圖座標(如中心±2)測 `doPlace`,結果大量靜默失敗——`world.js` 的 `genWorld()` 只在距地圖中心 **[5,8) 格的環狀帶**保證是 `T.FLOOR`(`d<5` 是 `T.GLOW` 不算 `T.FLOOR`,`d>=8` 才吃細胞自動機雜訊,可能是牆),隨便選的座標大機率落在 GLOW 或未清空的牆體。修法是所有放置測試都挑這個保證帶內、彼此分散不重疊的座標,並直接把玩家傳送到目標格中心再放置(非固體家具擺在玩家腳下不受阻擋,`doPlace` 的 3.8 格距離檢查自然通過)。
- 測試:`simtest_furniture.js`(scratchpad,74 個斷言,vm context 寫法)涵蓋 12 個新物件的資料完整性(ITEMS/TILE_INFO/OBJ_HP/OBJ_LIGHT/OBJ_SOLID/RECIPES)、放置後可敲掉回收、椅子坐下回血(隔開既有脫戰回血後單獨量測)/移動起身/受傷起身、床鋪認床後死亡重生到床位/沒認床回歸星核旁預設位置(回歸測試)、存讀檔往返保留重生點、`home_sweet_home` 成就湊滿 5 種才解鎖且無關物件不誤觸發(回歸測試)。

## 真礦車實體 v2(2026-07-15,第十八批)
候選清單只剩兩項大工程,使用者明確選定「3.5 v2 真礦車實體」(另一項是「社交/團隊向被動」)。這批**先用 EnterPlanMode 走完整的規劃流程**(研究現有軌道/傳輸帶/enemies-animals 同步慣例 → 設計 → 派一個 Plan agent 做設計驗證 → 寫成計畫檔給使用者核准),因為文件早就點名這是「複雜度接近 Terraria 礦車/Factorio 火車」的大工程,不適合像先前幾批一樣直接自主判斷。**範圍刻意大幅收斂**:延續自動化道鏈(自動採礦機→傳輸帶→自動熔煉爐→儲物箱)補上長途運輸,不做玩家可騎乘、不做真正的目的地尋路/可設定站點(那些需要軌道連通圖+尋路演算法,是文件點名的複雜度來源本體)。
- **`G.carts`(陣列,比照 `G.enemies`/`G.animals`,不是 `G.objects`/idx-Set)**:每台 `{id,x,y,dir,owner,items}`,`items` 跟 `storage.items` 完全同格式,讓「卸貨進儲物箱/熔煉爐」直接重用既有的 `storageAdd`/`smelterFeed`(entities.js)零風險;礦車自己「收貨」的 `cartAdd` 刻意寫成 `storageAdd` 的獨立複製版(容量常數換成 `CART_CFG.capacity`),不去重構 `storageAdd` 本身——避免動到儲物箱/傳輸帶這條已經高度依賴的既有管線。
- **移動規則是簡化但確定性的版本,不是真正尋路**:`updateCarts`(entities.js)每一幀都從目前 tile 重新檢查 4 鄰格連通性(不是只在剛跨入新格時查一次),規則是「直行優先→右轉(`(dir+1)%4`)→左轉(`(dir+3)%4`)→死路迴轉(`(dir+2)%4`)→都不行就原地停等」。**轉向瞬間要把座標對齊格中心**(`c.x=tx+0.5; c.y=ty+0.5`)——這是 Plan agent 設計驗證階段抓到的關鍵細節,沒有這行會讓礦車貼著格子邊緣走、多次轉彎後偏移累積、切齊詭異的角而不是乾淨直角。腳下軌道被玩家拆掉時礦車直接卡住等人工撿回去,不做「掉落軌道」之類的處理。
- **執行順序**:`simTick` 裡 `updateCarts` 排在 `updateBelts` 之後、`updateDrops`(玩家磁吸)之前——礦車經過時比玩家磁吸優先吸走地上的掉落物,跟既有的「傳輸帶推力先於磁吸」是同一種順序哲學,刻意選擇不是意外。
- **放置不走 `doPlace` 通用路徑**:`ITEMS.minecart` 用全新的 `cart:true` 旗標(不是 `place`/`placeTile`),因為目標地形(必須是 `T.RAIL` 不是 `T.FLOOR`)、結果型態(陣列實體不是 `G.objects`)都跟現有放置物不合——寫獨立的 `doPlaceCart`,比照 `doTill`/`doPlant`/`doFish`「需求分歧夠大時另開一支」的既有慣例。`doPlace` 本身完全沒改動。
- **互動優先順序是 Plan agent 抓到的另一個重點**:`main.js` 右鍵區塊新增的 `G.carts.find(...)` 連續座標判定要放在跟 `trader`/`qnpc` **同一層級、比 `targetObj` 鏈更早**的位置,理由跟既有的 `mate`/`ani` 判斷要蓋過 `it.place` 完全一樣——手上拿著 `minecart` 想放新車時,滑鼠指著一台已存在的礦車要優先判定成「跟這台車互動」而不是「這裡放一台新車」。空手右鍵收回(貨艙內容 `spawnDrop` 灑在地上,比照 `spillStorage`);拿著東西右鍵**純本地讀取**秀貨艙摘要浮動文字——**刻意不做貨艙面板 UI**,因為貨艙內容本來就整包隨 snap 同步到每個客戶端,格式化文字是零成本的本地操作,不需要任何新協定。
- **網路同步比照 enemies/animals,不進 `init`**:`net.js` 的 `hostTick` snap payload 加 `carts` 固定欄位陣列(`items` 整包帶,因為貨艙是全隊共享資源不是私人背包,跟 `storage.items` 全量廣播同一種定位);`case 'snap'` 解碼用跟 enemies/animals 完全同款的 `id` 對帳寫法,**新出現的 cart 一定要先建好 `{id,x,y,dir,items}` 物件再設定 `tx/ty`**(這也是 Plan agent 設計驗證抓到的——enemies/animals 的既有寫法就是這個順序,漏掉會讓客戶端第一次看到某台車時插值算出 NaN)。`case 'init'` 現有的重置行要記得補 `G.carts = []`,避免跳房/重連殘留舊車。
- **持久化但客戶端得知不靠 init**:礦車跟塔類一樣是玩家投資的基礎建設,要存讀檔保留(不像 enemies/animals 是重新生成的),`buildSave`/`applySave` 各加一段 `carts` 欄位、`nextCid` 計數器比照既有的 `nextEid`/`nextAid` 加進同一行宣告。但客戶端「知道」礦車存在的機制完全走既有的 snap(不進 `init`)——持久化是房主端存檔的關心,跟客戶端同步時機是兩件事,既有的 snap 機制已經在 100ms 內自然涵蓋後者,零額外程式碼。
- **渲染是內嵌在 `render()` 裡,不是獨立函式**:這是 Plan agent 設計驗證階段推翻的一個原始構想——`render.js` 其餘實體(drops/animals/enemies/players)全部直接寫在 `render(dt)` 函式內,因為要用到這個函式的區域變數(`lightOf`/`x0,y0,x1,y1`/`worldToScreen`),獨立的零參數 `drawCarts()` 讀不到這些閉包變數。改成在動物迴圈與商人迴圈之間內嵌一段迴圈,畫法比照傳輸帶的「依方向旋轉」(`ctx.rotate(dir*Math.PI/2)`),加一條貨艙容量條(視覺比照箭塔彈藥條/熔煉爐緩衝條)。放置預覽高光的既有判斷式(`placing = sel && (...)`)也要補上 `it.cart` 分支,目標格判斷從 `T.FLOOR` 換成 `T.RAIL`,不然瞄準軌道放礦車時螢幕上完全沒有綠色預覽提示,跟其他所有可放置物不一致。
- **明確排除的範圍**(避免範圍蔓延,寫進計畫檔跟這裡雙重記錄):玩家騎乘/上下車、可設定的目的地/停靠站/玩家指定路線、真正的貨艙存取面板 UI、礦車在小地圖/大地圖上的即時標記、礦車可被怪物攻擊/摧毀——這些都是不同方向或需要真正尋路演算法的功能,留給日後有明確需求再評估。
- 測試:`simtest_minecart.js`(scratchpad,40 個斷言,vm context 寫法,直接改寫 `G.tiles` 佈置測試軌道不透過 `doPlace`)涵蓋直線軌道等速前進、L 型轉彎精確對齊格中心、死路迴轉、孤立單一軌道格原地不動不拋錯、T 字分岔驗證「直行優先→右轉→左轉」固定規則、沿途吸收掉落物進貨艙且滿了不再吸、經過儲物箱/熔煉爐自動卸貨且強化裝備不會被塞進熔煉爐(但可進儲物箱)、`doPlaceCart` 的三種放置規則(只能在軌道/每人上限/同格不能疊)、空手收回保留貨艙內容、存讀檔往返、**`storageAdd`/`smelterFeed`/`updateBelts` 既有行為的回歸測試**(這批只新增呼叫端,沒有修改這兩支共用函式本身)。**限制**:`net.js`/`render.js`/`main.js` 的改動(網路同步/繪製/輸入分派)沒有瀏覽器無法端對端驗證,建議之後找時間開兩個瀏覽器分頁實際連線測試礦車同步流暢度。

### 礦車升級:騎乘 + 軌道站台真尋路(2026-07-15,承接使用者「礦車繼續」的要求)
使用者要求把先前明確排除的兩項都做:玩家可騎乘、可設定目的地/停靠站。這批之後使用者要求「以後驗證力道整體輕量化」,所以跳過完整 Explore/Plan agent 研究流程,靠既有理解直接設計實作,只用一支中等份量的測試檔(不像 v2 那樣 40 條全覆蓋)驗證新增的核心行為。
- **騎乘**:`p.riding`(cart id 或 null,暫態不進存檔,比照 `p.sitting`)。上車 `doBoardCart`/下車 `doDisembark`,一台車同時限一人。**host 端 `updateCarts` 每 tick 把騎乘者的 `p.x/y` 設成礦車座標**,這樣就自動透過既有的玩家位置 snap 機制同步給其他人看,零新協定;`main.js` 的 `localControl` 開頭新增騎乘分支,擋掉移動/攻擊/挖礦輸入,只留「對著自己開的車再次右鍵=下車」。互動配置改成:**空手右鍵=上車**(取代原本的「空手右鍵=收回」)、**左鍵敲擊=收回背包**(呼應「敲爛/敲掉回收」的既有慣例,跟其他放置物一致)、拿東西右鍵=看貨艙摘要(不變)。`p.riding` 加進 snap 的玩家欄位(供其他客戶端知道自己是否要擋輸入),**沒有**放進 `init`(暫態,跟 sitting 同一套邏輯)。
- **軌道站台(`rail_station`)+ 真尋路**:站台是普通 `it.place` 物件(放在 FLOOR,不是走 `doPlaceCart` 那條特殊路),`doPlace` 加一個前置檢查「必須貼著軌道」(貼不到就放置失敗),成功放置後給 `o.num = ++G.stationSeq`(全域流水號,照放置順序排巡迴序)。**故意不存 `rx/ry`(站台貼著的軌道格)**,而是 `findStation(num)` 每次即時掃 4 鄰格算——省一個要存讀檔/同步的欄位,站台數量少、只在礦車決定方向時查,換這點計算量很划算。有礦車在跑時,`updateCarts`/`decideCartDir` 用簡單 BFS(`railBFS`,陣列當佇列)算最短路徑真的走過去,到站停留 `RAIL_STATION_CFG.waitTime` 秒再找下一個「編號更大、路徑可達」的站台(繞一圈回最小的),都繞不到就退回原本 v2 的固定轉向規則。**沒有站台時行為跟 v2 完全一致**(回歸測試有覆蓋)。**刻意不做玩家指定目的地的面板/UI**——用放置順序當路線,零 UI 成本。
- **踩雷記錄(這批抓到兩個真的會讓礦車卡死的 bug,不是測試寫錯)**:
  1. 把移動判斷從「continue-based」重構成「if/else-based」時,漏掉了「decideCartDir 判定死路+無岔路、放棄不改 c.dir」跟「後面還是無條件套用移動公式」兩段之間的落差——孤立軌道格會被推出軌道外。修法是移動前多驗證一次「目前方向真的能走」(`tileAt(tx+DIR_VX[c.dir],...)===T.RAIL`),不能只靠「有沒有呼叫過 decideCartDir」判斷。
  2. 到站换下一个目标時,如果沒有在**同一次呼叫**裡順便算出新方向,礦車停留期間(`c.waitT>0`)因為 `curIdx` 沒變、`decideCartDir` 不會再被呼叫,方向就會停留在舊的(前一段路的方向),停留結束後往錯的方向衝出去撞死路。修法是把「到站換目標」跟「算新方向」寫在同一個函式呼叫裡處理完,不留到下一次。
- **物件固定欄位陣列多一格**:`o.num` 加進既有的 12 欄物件陣列變成第 13 欄(`buildSave`/`applySave`/net.js 的 `hi`/`case 'init'` 四處都要一起改,這是專案自己的既有檢查清單)。`G.stationSeq` 比照 `killCount` 存讀檔保留,避免重載後跟舊站台撞號。
- 測試:`simtest_cart_v3.js`(scratchpad,18 個斷言)涵蓋上車後位置跟車走且一車限一人、收回礦車時強制騎乘者下車、有站台時真的巡迴到兩座站台(不是被固定規則卡在岔路)、站台不可達時安全退回固定規則不拋錯、沒有站台時跟 v2 行為一致(回歸)、存讀檔保留 `stationSeq`/站台編號、`doPlace` 的「必須貼軌道」規則。**限制同 v2**:網路/渲染/輸入分派沒有瀏覽器無法端對端驗證。

## 丟出物品:自撿延遲 + Shift+Q 整疊丟出 + 視覺加強(2026-07-15)
玩家反映三個問題:①丟出的物品似乎馬上被自己撿回去 ②掉落物顯示太不明顯 ③堆疊物有沒有辦法選數量丟出。逐一確認後只有第一個是真的 bug,其餘是設計選擇或視覺調整。
- **自撿延遲是真的 bug**:`doDropItem`/`doDropAt` 原本把物品丟在玩家面前僅 0.8 格處,而磁吸範圍(`MAGNET_RANGE`)是 2.4 格——物品一落地就在丟的人自己的磁吸範圍內,幾乎瞬間被吸回去撿起,「分批分享」的設計意圖(見既有註解)完全沒生效。修法:`spawnDrop` 現在回傳建立的物件(純加法,不影響其餘幾十個呼叫端),`doDropItem`/`doDropAt` 額外設定 `drop.noPickup = p.id; drop.noPickupT = DROP_CFG.selfPickupDelay`(1.5 秒);`updateDrops` 的磁吸/撿取迴圈找最近玩家時,`noPickupT>0` 期間跳過 `noPickup` 那個人——**只擋丟的人自己,隊友完全不受影響、能馬上撿**。一般戰利品/溢出掉落(`spawnDrop` 的其餘呼叫端)沒有設定這兩個欄位,行為完全不變。
- **視覺加強**(render.js 掉落物迴圈):底影半徑/透明度都加大(0.26→0.32、0.38→0.55)、圖示放大一階(0.45→0.56,仍比一般物件的 0.7 小,維持「小東西」的視覺區隔)、新增一圈淡青色描邊呼應遊戲的 `--glow` 識別色,在複雜地板/暗處更容易一眼認出。
- **Shift+Q 整疊丟出**:確認過使用者要保留「Q 鍵一次丟 1 個方便分批分享」的既有設計,只加一個修飾鍵——`main.js` 的 Q 鍵判斷讀 `e.shiftKey` 傳給 `doDropItem(me, me.sel, e.shiftKey)`,`all=true` 時丟出整疊、背包格直接清空(不是重複呼叫 `consumeSlot`)。**`doDropAt`(拖曳丟到地上)刻意不套用整疊邏輯**,維持原本一次 1 個的既有行為,只加自撿延遲——踩雷記錄:第一版寫代碼時誤把 `doDropAt` 也改成整疊丟出,超出使用者實際要求的範圍(只要求 Q 鍵加修飾鍵),之後改回只加延遲修正。
- 測試:`simtest_drop_fix.js`(scratchpad,14 個斷言)涵蓋 Q 鍵/Shift+Q 的丟出數量差異、剛丟出的物品在延遲內不會被自己撿走但延遲過後正常撿回、隊友完全不受延遲影響可以馬上撿、一般戰利品掉落沒有 `noPickup` 欄位的回歸測試、`doDropAt` 維持一次 1 個但也套用延遲。**踩雷記錄(測試,非程式邏輯錯)**:第一版測試直接對 `updateDrops` 餵一兩個很大的 `dt`(如 1.2 秒)模擬「經過一段時間」,結果磁吸的位移公式在單一大 dt 內衝過頭,把掉落物「甩」出磁吸範圍——這是測試不切實際(真實遊戲是每幀呼叫、`dt` 很小),改成迴圈餵一堆小步長(0.05 秒)才符合實際運作方式。

## /power 快捷按鈕 + 給予物品分類(2026-07-15)
玩家提出兩個 `/power` 相關的可用性問題:①打過指令的人能不能有個固定按鈕快速開啟,也能選擇隱藏 ②`給予物品` 下拉選單項目太多很難找。
- **快捷按鈕**(`index.html`/`style.css`/`ui.js`):右下角圓形按鈕 `#powerQuickBtn`,**只有實際打過 `/power`(或舊版 `/give_all`)的人才會看到**——沿用整個秘笈選單「刻意不寫進任何操作說明」的既有精神,不是給沒用過的人一個顯眼入口,只是給已經知道的人一個捷徑。用兩個 `localStorage` 旗標控制:`gld_power_used`(第一次成功打指令時 `markPowerUsed()` 設定,永久生效)、`gld_power_hide_btn`(按鈕右上角小 × 設定)。**隱藏是使用者刻意要的單向動作**——隱藏後要回去用打指令的方式開啟,不會因為之後又打了指令就自動重新顯示按鈕(讀使用者原話「下次再輸入指令」,不是「自動恢復」)。
- **給予物品分類**(`ui.js` `GIVE_ITEM_CATS`):純粹是秘笈選單下拉選單的顯示分組(`<optgroup>`),不影響 `/power give` 指令本身或其他任何邏輯。**分類優先重用既有的 `FURNITURE_DECOR_TYPES`/`TOWER_COLLECTOR_TYPES`**(跟家具/塔類成就判斷共用同一份清單)而不是另外維護一份——之後新增家具/塔類物品會自動歸類正確,不用同時改兩個地方;自動化道鏈/建材照明這兩類數量少且很少變動,直接列舉可接受。跑過一次分類驗證(scratchpad 一次性腳本,非存檔測試):116 個物品全部剛好歸進 9 類、無重複無漏網。

## 音效/音樂 Hub(2026-07-15,產線工具,尚未接進遊戲)
玩家想要地區型背景音樂 + Boss/特殊狀況音效。查證後 OpenRouter **沒有**音效/音樂生成端點(只有 TTS 人聲),而遊戲本體目前完全沒有真實音檔——`js/sfx.js` 純粹是 Web Audio 即時合成的短促 beep,沒有 BGM 播放機制,這是全新的一塊。真正的音樂生成 API(Stable Audio/ElevenLabs 等)大多要金鑰、非同步任務,跟 AI Hub 圖片產線「同步呼叫拿 URL」的假設差異大,風險偏高,所以先只做「產線管理工具」,**不碰遊戲內播放整合**(地區音樂切換/Boss 音效觸發留待下一批,等音檔真的備齊再串)。
- **`AI/audio.html`(新檔,獨立頁面)**:不擴充既有的 `AI/index.html`(1562 行的圖片生成邏輯,`generateSrcs`/`shrinkBlob`/`removeBgBlob` 全是 PNG 專用,音訊完全用不到)。資料表 `AUDIO_ASSETS` 定義 4 首地區 BGM(`assets/bgm/`:dirt/stone/obsidian/void,對應 `zoneOf()` 0~3)+ 5 個 SFX(`assets/sfx/`:boss_appear/boss_defeat/world_event/victory/defeat)。頁面用 `fetch` 偵測檔案是否已存在(200/404)、`<input type=file>` 讀成 base64 直接 POST 到既有的 `/api/save-asset` 端點(不做任何 PNG 專屬的轉檔/去背/縮圖,音訊不需要那些前處理)。**零 API Key、零 AI 生成串接**——使用者自己去外部平台免費額度手動生成後拖進來上傳。
- **`serve.js` 擴充既有端點**:`SAVE_DIRS` 加 `bgm`/`sfx`(順手補上 `GAME_ASSETS` 早就有列但白名單漏加的 `npcs`,同一行程式碼);檔名正則放寬成 `.png|.mp3|.wav|.ogg`;body 上限 15MB→30MB(BGM 檔比圖片大,留緩衝);MIME 對照表補 `.mp3/.wav/.ogg`。
- **踩雷記錄:`content-length` 標頭讀不到**:原計畫想靠 HTTP `Content-Length` 顯示檔案大小,但 `serve.js` 的回應其實是 `Transfer-Encoding: chunked`(node 沒有自動補 Content-Length),`checkFile()` 改成直接讀 `(await res.blob()).size`——檔案不大,多讀一次沒差。
- **自動生成音樂的嘗試失敗,記錄下來避免下次重踩**:試過用 `@gradio/client`(npm 套件,已移除)呼叫 Hugging Face 上公開的 `facebook/MusicGen` Space 自動生成,結果不論有沒有帶使用者的免費 HF token,都回傳 `ZeroGPU client error`——**這是已知限制,ZeroGPU 額度主要保留給瀏覽器互動操作,拒絕純 API 呼叫**,不是程式碼寫錯。`facebook/musicgen-small` 模型頁本身也寫明「沒有被任何 Inference Provider 部署」,代表連正規的 HF Inference API 路徑都不通(先前查到的教學文章已過時)。**目前沒有可靠的免費全自動 BGM 生成管道**,已改為請使用者手動到 `huggingface.co/spaces/facebook/MusicGen` 網頁版依提供的 4 組 prompt 生成後,用這批做的 Hub 上傳——測試用的 `.env`(內含真實 HF token)與整個 `AI/audio-gen/` 實驗資料夾已清除,`.gitignore` 保留 `AI/audio-gen/.env`/`node_modules/` 規則以防之後重新嘗試自動化時又不小心把金鑰寫進版控。
- **這批沒做,等音檔真的備齊再排**:遊戲內播放邏輯(`js/sfx.js`/`js/main.js`/`js/game.js`/`js/render.js` 完全沒碰)、地區 BGM 隨玩家位置切換(候選掛點是 `zoneOf()`,純本地不需新協定)、Boss/事件音效觸發(候選掛點是 `emitFx({k:'sfx',...})` 這個既有 choke point,entities.js `applyFx`)、`index.html` 沒有改動不用動 `?v=`(這支新頁面不在遊戲的 `<script>` 載入鏈裡)。展示頁生成的音樂長度通常只有幾秒到十幾秒,不到原訂的 60~120 秒,之後串接時可能要考慮短循環播放而非長曲。
