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
- 地圖 200×200 用 `Uint8Array`;世界座標單位 = 格(浮點),`TILE=40` 只在渲染換算像素。
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
