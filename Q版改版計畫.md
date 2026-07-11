# 《微光深淵》Q 版視覺與主題改版計畫

目標:把整體視覺與文案從「嚴肅黑暗奇幻」轉向 **Q 版可愛黑暗風(cute-spooky)**,讓現代年輕玩家第一眼就想玩;同步把 AI 產圖提示詞、遊戲主題框架補完整。**本文件是計畫,尚未實作**;文末「決策點」拍板後依批次動工。

---

## 零、風格定位(所有後續工作的錨)

**一句話:黑暗的世界,可愛的居民。**

參考座標(年輕玩家市場驗證過的路線):
- **Cult of the Lamb(咩咩啟示錄)**:黑暗主題 × 圓滾滾貼紙感角色 = Z 世代爆紅的核心配方
- **Core Keeper**:地底挖礦氛圍保留,但生物圓潤討喜
- **Forager / 月光石**:高飽和色塊 + 粗描邊 + 果凍動效

風格三支柱(產圖、UI、向量畫法都遵守):
1. **圓潤厚實**:一切輪廓圓角化、比例矮胖(2 頭身)、粗深色描邊(貼紙感)
2. **大發光眼 = 情感核心**:蝕影的發光眼睛本來就是全遊戲最有記憶點的元素,放大它、給它表情(瞇眼壞笑/鼓臉生氣),兇狠感全部改用「表情」而不是「尖刺與獠牙」表達
3. **暗底 × 糖果色**:保留黑暗洞穴底色與青藍發光識別(`--glow #7ef0ff` 不變),但 UI 回饋與可愛元素加入高飽和糖果色(桃粉/檸檬黃/薄荷綠),暗底讓糖果色更跳

敘事支點(讓「可愛」與「黑暗生存」不打架的關鍵):
> **蝕影不是邪惡,是「怕光又想搶光」的黑暗小生物。** 牠們撲向火把與星核,是因為世界熄滅太久、牠們也想要光。玩家不是在「消滅怪物」,是在「把光帶回深淵」。這一句讓所有 Q 版化的文案有了統一的語氣依據。

---

## 一、UI Q 版化(優先度最高)

### U1. 字體(第一眼印象的一半)
- 現況:`Microsoft JhengHei`——方正、公文感。
- 方案 A(建議):自 host 開源圓體 **jf open 粒粒體(open-huninn)**,woff2 約 4~5MB 放 `assets/fonts/`,`@font-face` + `font-display: swap` 載入,fallback 回正黑。SIL OFL 授權可打包;file:// 離線也能載本地字體檔,符合「無建置、雙擊可玩」原則。
- 方案 B:純系統字體堆疊(0 成本,但 Windows 沒有內建圓體,效果打折)。
- 落點:`style.css` 的 `body font-family` 一處 + `@font-face` 一段。

### U2. 面板與按鈕(果凍感)
- 圓角加大:`--radius-lg 16→22px`、`--radius-md 10→14px`、按鈕膠囊化(`border-radius: 999px` 用於主要 CTA)。
- 按鈕動效:hover 放大 1.04 + 微上浮(現有 translateY 保留),active 擠壓(`scale(0.96, 0.92)`)——squash & stretch 是 Q 版動效的靈魂。
- 新增糖果色 token:
  ```css
  --candy-pink:  #ff9de2;  /* 愛心/好感/動物 */
  --candy-yellow:#ffd93d;  /* 獎勵/金幣/升級 */
  --candy-mint:  #7dffb2;  /* 成功/回血/完成 */
  ```
  用途限定在「回饋時刻」(撿到東西、升級、餵食愛心),平常介面仍以青藍為主——糖果色是調味料不是主菜。
- 主選單標題「微光深淵」加輕微上下浮動 + 字距動畫;副標改口語(見文案表)。
- `prefers-reduced-motion` 全域關閉動畫的既有規則沿用,不用另外處理。

### U3. HUD
- 血條/體力/星核條:方角玻璃管 → **圓角膠囊**,條頭加對應 emoji 端點(❤️/⚡/💠),數值變動時輕微 pop(scale 1→1.15→1)。
- floater(浮動文字):出現時彈跳(上移 + overshoot),吃料理/撿寶時偶發表情符號雨(限 3~5 顆,別吵)。
- 快捷欄:選中格的框線動畫改成呼吸發光 + 圓角加大。

### U4. 遊戲內向量畫法微調(render.js,小改)
- 玩家:眼睛半徑 2.5→3.5、加兩坨淡粉腮紅(挖礦/戰鬥時消失,避免違和)、受擊時眼睛變「><」二筆——本體圓頭圓身結構不動。
- 怪物 fallback 向量:眼睛整體放大 20%,`spike` 形狀的刺縮短變圓(縮短 30% + lineCap round)。
- 這些只影響「沒有貼圖時的備援畫法」;素材重生後多數時候看到的是貼圖,所以此項優先度最低、量也最小。

### U5. 不動的東西(明確劃界)
- 光照/黑暗氛圍系統:**不動**——黑暗是遊戲性(生怪、探索張力),Q 版化只動「居民」不動「世界的暗」。
- 面板資訊架構(背包 8×4、合成清單、天賦樹佈局):不動,只換皮。
- SFX:不動(現有 8-bit 音效與 Q 版相容)。

---

## 二、AI 產圖提示詞修正(AI Hub `AI/index.html`)

### P1. master 模板 v2(貼紙卡通方向)
現況 master 已寫 `cute chibi style`,但同時要求 `pixel art`、`16-color palette`,細節風格拉扯。v2 二選一(見決策點 1):

**路線 B(建議)——貼紙卡通風,全量重生:**
```
Cute chibi game asset, kawaii sticker art style, true top-down (90-degree overhead) view,
transparent background, soft rounded blob shapes, chunky short proportions,
bold thick dark outline like a sticker, big glowing friendly eyes,
flat cel shading with one soft highlight, vivid saturated colors that pop on a dark background,
centered single subject, game-ready PNG.
```
**路線 A(保守)——保留 pixel art 但更圓**:master 僅把 `clean pixel art` 強化為 `chunky rounded pixel art, no sharp corners`,其餘不動;既有素材可不重生,新舊風格差異小。

negative v2(兩路線通用):
```
isometric, 45 degree, side view, 3D, realistic, photo, horror, scary, creepy, gritty,
text, watermark, logo, background scenery, thin spindly shapes, sharp needle spikes,
muted dull colors, excessive detail
```
(新增 horror/scary/creepy/gritty——現在的怪物描述會把生圖帶往恐怖方向,必須從 negative 擋回來。)

### P2. 怪物描述全面改寫(兇狠詞 → 表情詞)
原則:**保留配色與輪廓關鍵字**(遊戲內辨識靠它),把攻擊性形容詞換成「表情/性格」。全 14 條 v2 逐字稿:

| 檔名 | v2 描述(直接可貼) |
|---|---|
| imp.png | small round blob shadow slime, dark navy body, two huge glowing cyan puppy eyes, tiny happy smile, bouncy and squishy, single creature |
| spore.png | tiny round dark teal spore ball, one single huge glowing aqua eye blinking curiously, very small and simple, single creature |
| hunter.png | chubby dark purple shadow cat-like beast with short soft rounded spikes like plush fur, big glowing violet eyes with a mischievous grin, single creature |
| spitter.png | round dark magenta shadow puffball with one big open mouth showing tiny glowing teeth like a singing frog, cheerful glowing pink eyes, single creature |
| bomber.png | round bulging rust-red creature puffing its cheeks, body glowing warm orange from inside like a lantern, wide surprised glowing eyes, single creature |
| phantom.png | pale ice-blue ghost with a soft wispy trailing tail, shy sleepy glowing white eyes, floating gently, adorable, single creature |
| breaker.png | chunky round rock golem, brown-grey pebble body, stubby little arms, grumpy pouting glowing yellow eyes, single creature |
| abyss.png | plump crimson shadow ball with short soft rounded spikes like a plush sea urchin, big glowing red eyes with a naughty frown, single creature |
| sentinel.png | big round ancient stone statue guardian, smooth cracked grey body with cute carved patterns, calm sleepy glowing golden eyes, gentle giant, single creature |
| fire_boss.png | big round lava golem, warm red-orange rocky body with glowing magma cracks, puffy cheeks, fierce but cute glowing amber eyes, gentle giant boss, single creature |
| frost_boss.png | big round ice golem, pale blue frosty body with snow patches, chubby arms, proud sparkling ice-blue eyes, gentle giant boss, single creature |
| void_boss.png | large round dark violet ghost with a wispy tail, mysterious glowing pink crescent eyes like a smiling mask, floating, spooky-cute boss, single creature |
| revenant.png | plump dark purple shadow spirit with short soft spikes, intense glowing magenta eyes, determined pout, single creature |
| voidling.png | small dark indigo shadow creature with a big round open mouth, glowing lavender eyes, cheeky expression, single creature |

### P3. 補齊缺漏條目(GAME_ASSETS 資料表)
- **monsters/**:加 `fire_boss / frost_boss / void_boss / revenant / voidling` 五條(描述如上表)。
- **npcs/**(新分組,目前整個資料夾不在清單):`trader.png` — `round friendly mole merchant wearing a tiny lantern hat and a backpack full of goods, warm golden glow, big kind eyes, single character`。
- **tiles/**:加 `rail.png`(transparent background 例外規則——比照 fence_tile 是「透明物件疊地板」,提示詞要標注)、`voidrock.png`(deep violet dense rock, faint purple cracks)、`seal.png`(dark purple wall with glowing pink-violet rune circle, magical barrier)。
- **items/**:加 `rail / auto_miner / belt`(遊戲尚未讀 items,先備存)。
- **注意**:tiles 是整格材質「不去背」,而 rail/fence 是例外要透明——批次生成時 `autoMatte` 開關對這兩張的處理要再確認(實作時驗證)。

### P4. 風格一致性守則(寫進 AI Hub 頁面提示)
- **同資料夾整組同一天、同一模型、同一 master 版本重生**——AI 生圖跨批次風格漂移是常態,混批 = 畫面雜。
- master 模板改版後,舊素材與新素材必然風格衝突 → 決策點 1 若選路線 B,**全部 29 張既有素材重生一輪**(成本 = 點一次「⚡ 整組補齊」批次鈕 × 4 個資料夾,先手動清空舊檔)。

---

## 三、遊戲主題框架完整化(Theme Bible)

### T1. 世界觀一頁(五句版,所有文案的依據)
1. 很久以前,地底世界由無數顆「星核」照亮,那是個溫暖的微光時代。
2. 星核一顆顆熄滅,黑暗湧回,誕生了怕光又渴望光的小生物——蝕影。
3. 你們是「螢火隊」:背著鎬子與火把的小小拓荒者,受最後的星核呼喚而來。
4. 三座神殿的守望者曾是星核之友,在漫長黑暗中沉睡、被蝕影纏繞——打敗他們不是殺戮,是**喚醒**,取回他們守護的碎片。
5. 集齊碎片、撐過最後的暗潮,星核甦醒——而世界最深處「淵核區」的遠古封印,也隨之崩解……(通關後內容的敘事鉤)

### T2. 主角:螢火隊(the Glimmer Crew)
- 圓滾滾的小小礦工,1~4 人一隊;現有 PLAYER_COLORS 多人變色 = 隊員識別,向量畫法保留(見決策點 3)。
- 玩家死亡文案從「倒下」改成「熄火了…正在重新點燃(復活倒數)」——把復活機制包進「螢火」意象。

### T3. 角色個性化
- **商人**:定名「**莫勾**」(鼴鼠商人,戴著小提燈帽)。口頭禪:「嘿嘿,碎片越多,好貨越多~」。交易面板標題與開場訊息帶名字。
- **三守望者**(神殿 Boss 統一稱號,原「守衛」):熔岩魔像=火之守望者「燼」/寒霜巨像=冰之守望者「凜」/虛境潛獵者=影之守望者「寞」。擊殺訊息改「甦醒」語氣:「⚔️ ○○ 喚醒了火之守望者!取得星核碎片!」
- **動物**:幽穴雞「咕光」、苔絨牛「苔苔」(圖鑑式暱稱,餵食 floater 可帶)。
- **蝕影家族**:每種一句圖鑑短語(放物品/敵人 tooltip 或未來圖鑑),例:小蝕影「最膽小也最貪心,看到火把就挪不開眼」。

### T4. 文案語氣指南 + 改寫對照(樣例)
語氣:**輕鬆友善、一點點俏皮、不裝可怕**。驚嘆號少用兩成,「!」保留給真正危險。

| 現行 | v2 |
|---|---|
| 守護星核,奪回光明 — 1~4 人合作生存 | 一起把光帶回深淵吧!1~4 人合作の地底大冒險 |
| 🌑 星核能量正在流失,挖光晶(藍色礦脈)按 F 餵它! | 🌑 星核餓了!挖點光晶💠(藍色礦脈)按 F 餵餵它 |
| 🌊 暗潮將至!30 秒後來襲,守住星核! | 🌊 蝕影大軍聞到光的味道了!30 秒後到,快守住星核! |
| 💀 星核熄滅了……全隊失敗 | 💀 星核睡著了……沒關係,深淵永遠歡迎再來一次 |
| 🏆 星核甦醒!微光深淵重見光明,通關! | 🏆 星核醒來了!!整個深淵亮起來了——是你們做到的! |
| ⚠️ 星核能量剩 15! | ⚠️ 星核快撐不住了(剩 15)!光晶!快! |

全量文案盤點(`msgAll`/`showMsg`/選單/ITEMS desc 約 60~80 條)在實作批次 C 逐條過。

### T5. 命名一致性小修
- 「石像守衛 sentinel」在暗潮最終波仍會出現(裸體 sentinel)→ 文案側稱「失控的石像」與神殿守望者區隔,程式不動。
- 金鎬即頂級鎬(tier 3,挖得動鑽石/淵岩)——CLAUDE.md 內兩處註解寫「鑽石鎬」是誤稱,順手更正,避免未來誤判成缺一階裝備。

### T6. 進程敘事節點(全部只是加/改訊息文字,零機制)
開場 → 第一次暗潮前 → 每喚醒一位守望者(專屬一句)→ 集滿 3 碎片 → 最終暗潮 → 通關+淵核區解封。現有訊息已覆蓋大半,補「守望者專屬台詞」3 條與開場世界觀 1 條即可。

---

## 四、實施批次(每批獨立可驗收、可先玩)

| 批次 | 內容 | 動到的檔案 | 狀態 |
|---|---|---|---|
| **A. 提示詞 v2** | master/negative 改版、14 條怪物描述改寫、補 5 怪+商人+3 地形+3 物品條目、npcs 分組 | 只有 `AI/index.html`(純資料) | ✅ 完成(2026-07-12,Playwright 斷言全過) |
| **B. 素材重生** | 用 AI Hub 批次鈕整組重生 monsters→npcs→tiles→items | 只有 assets/*.png | ⏳ 待玩家手動操作(見下方指引) |
| **C. UI Q 版化** | 圓角/膠囊/糖果色 token、按鈕果凍動效、HUD 膠囊化、選中呼吸、標題浮動(字體依決策維持系統堆疊) | `style.css` | ✅ 完成(2026-07-12) |
| **D. 文案 pass** | 「再放飛」尺度全量改寫(約 40 條)+ 螢火隊/莫勾/三守望者定名 + 甦醒台詞 + 開場世界觀 | `js/*.js` 字串、`config.js` | ✅ 完成(2026-07-12) |
| **E. 向量微調** | 玩家大眼+腮紅+低血「><」、怪物眼睛放大+高光(「刺圓化」作廢——fallback 本來就沒畫刺) | `render.js` | ✅ 完成(2026-07-12) |

**批次 B 操作指引(唯一剩餘步驟,需要你動手)**:
1. 雙擊「啟動遊戲.bat」讓伺服器跑著,開 `http://localhost:8000/AI/index.html`
2. 「連線設定」填 API Key(或選 Pollinations 免費)、到「圖像生成」填圖像模型 ID
3. **先把 `assets/monsters/`、`assets/tiles/` 裡的舊 .png 手動移走/刪掉**(換風格必須整組重生;批次鈕只補缺檔、不覆蓋既有)
4. 在「遊戲貼圖檔名/資料夾」對每個資料夾按「⚡ 整組補齊」:monsters(14)→ npcs(1)→ tiles(23)→ animals(2)
5. 同一資料夾同一天同一模型跑完,風格才不漂移;生完遊戲頁 Ctrl+F5 即可看到

驗收方式:每批完成後照慣例 Playwright 截圖對比(主選單/遊戲中/面板三景),文案批次用 grep 全量盤點確保沒漏。版號規則(`?v=NN` +1)與多人版本一致原則照舊。

---

## 五、決策點(2026-07-12 已全部拍板)

1. **素材風格路線 → B 貼紙卡通**:三套 master 模板全面改版(移除 pixel art / 16-color palette,換成 sticker 厚描邊 + cel shading),既有素材全量重生。
2. **字體 → 系統字體堆疊**:不自 host 字體檔;Q 版感改由 UI 形狀(圓角/膠囊/動效)承擔,未來想升級再回頭evaluated自 host 圓體。批次 C 的 U1 對應縮減為「字重與字距微調」。
3. **玩家角色 → 保持向量 + 腮紅微調**(批次 E 照原計畫)。
4. **文案尺度 → 再放飛一點**:比對照表樣例更梗、表情符號用好用滿;危險警告(暗潮倒數/星核低電量)仍保留緊張感,其餘全面歡樂化。批次 D 依此尺度執行。
