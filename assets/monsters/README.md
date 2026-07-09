# 怪物貼圖資料夾

把 AI 生成好的怪物圖示存成 PNG（建議正方形、透明背景、128x128 或 256x256）放進這裡，
檔名需對應 `js/config.js` 的 `ENEMY_TYPES[type].icon`：

| type     | 中文名   | 檔名           |
|----------|----------|----------------|
| imp      | 小蝕影   | imp.png        |
| spore    | 蝕影孢子 | spore.png      |
| hunter   | 蝕影獵手 | hunter.png     |
| spitter  | 吐影者   | spitter.png    |
| bomber   | 爆裂蝕影 | bomber.png     |
| phantom  | 穿牆幽影 | phantom.png    |
| breaker  | 裂地者   | breaker.png    |
| abyss    | 深淵蝕影 | abyss.png      |
| sentinel | 石像守衛（Boss） | sentinel.png |

沒放圖片也沒關係，遊戲會自動用原本的向量畫法（圓形+眼睛）顯示，不會出錯或擋畫面。
放進對應檔名的圖片後，重新整理頁面即可自動套用，不用改任何程式碼。

建議風格提示詞方向（配合現有暗黑地牢向量美術）：
`dark dungeon monster icon, flat minimalist vector style, transparent background, glowing eyes, centered, no text`
