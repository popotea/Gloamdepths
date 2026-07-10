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
- 協定(JSON over PeerJS DataConnection):客→主 `hi/pos/mine/atk/place/eat/craft/swap/deposit`;主→客 `init`(RLE 全地圖)、`snap`(10Hz 快照)、`tile/obj`(地形增量)、`fx/msg/tp/join/bye/over`。
- **存檔只在房主**;所有玩家背包以「玩家名字」為鍵存進 `playersByName`,朋友同名重連取回裝備。存檔可從 ESC 選單匯出/匯入 JSON 檔轉移房主。
- 單機 = 房主模式零連線,同一套程式碼路徑(`NET.mode='single'`)。

## 慣例與注意事項
- 註解與 commit 一律**繁體中文**;註解寫「為什麼」。
- 地圖 200×200 用 `Uint8Array`;世界座標單位 = 格(浮點),`TILE=40` 只在渲染換算像素。
- 效能原則:只畫視野內格子、全黑格跳過、塔/巢穴用獨立 idx Set 避免掃全部 objects。
- **怪物貼圖**:放 `assets/monsters/<檔名>`,檔名須等於 `ENEMY_TYPES[type].icon`(如 `imp.png`);載入失敗自動退回向量畫法,任意解析度會自動縮放。
- 多人時房主與朋友的**程式版本必須一致**(邏輯在雙方各自跑,對不上會脫序)。
- 每次改 `js/*.js` 或 `style.css` 後,記得把 `index.html` 裡所有 `?v=NN` 一起 +1,避免瀏覽器快取吃到舊檔。
- **秘笈選單 `/power`**:聊天輸入框(Enter 開啟)打 `/power` 開啟選單面板(可滑鼠點,面板上每個按鈕也會顯示對應的完整指令文字,例如 `/power spawn hunter 3`),兩種操作方式最終都走同一個入口。
  - client-only 效果(不必是房主也能用):`light`(全地圖在小地圖上開亮,純本地 `G.explored.fill(1)`,不影響其他人)。
  - 房主權威效果(自己是房主直接執行,是客戶端則送 `{t:'power',action,arg,num}` 給房主執行):`heal/godmode/infinite/home/xp/corefull/shard/wavenow/waveclear/clearmobs/spawn`。
  - 統一分派函式 `runPowerCmd(p, action, arg, num)`(`js/entities.js`),`ui.js`(自己是房主)與 `net.js` 的 `case 'power'`(轉發客戶端請求)都呼叫它,不要各寫一份邏輯。
  - 舊的 `/give_all` 指令字串仍保留相容,內部已改走 `execPower('infinite')`。

## 農耕系統
- 流程:鏟子(`shovel`,`till:true`)右鍵 `FLOOR` → `doTill` 把地形設成 `T.FARMLAND` → 種子(`mush_spore`,`seed:'mush'`)右鍵農地 → `doPlant` 消耗種子放上 `{type:'crop', crop, stage, t}` 物件 → `updateCrops`(entities.js,`simTick` 呼叫)逐格計時推進 `stage` → 成熟後玩家走過去,`updatePlayersHost` 自動收成(跟野生蘑菇同一套 auto-pickup 邏輯),農地保留可馬上再種。
- 作物種類定義在 `CROP_TYPES`(config.js):`growTime`(總成長秒數)/`icons`(每個 stage 的圖示,最後一格=成熟)/`yield`/`seedBackChance`。新增作物種類只要加一筆,不用動邏輯。
- `G.cropIdx`(world.js `TOWER_IDX_SETS` 註冊 `crop`)讓 `updateCrops` 不用掃全部 `G.objects`,跟塔/巢穴同一套機制。
- 網路同步:`stage` 推進時**不**呼叫 `setObj`(避免在 `for...of G.cropIdx` 走訪中對同一個 Set 又刪又加),改直接組 `{t:'obj'}` 訊息呼叫 `NET.sendAll` 廣播;新玩家加入時的 `init` 全量快照與存讀檔都把 `stage`/`t` 一起帶上(`game.js` buildSave/applySave、`net.js` 的 `hi`/`init` 兩處,四個地方要一起改,格式是固定欄位順序的陣列,不是 `{...o}` 那種通用 spread)。
- `doMine` 的「敲掉已放置物件回收成道具」分支明確排除 `mushroom` 與 `crop`,兩者都只能靠走過去自動採集,左鍵對它們無效。
