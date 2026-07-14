// ===== 渲染(Canvas)=====
// 效能重點:只畫視野內的格子;黑暗中的格子直接不畫(底色本來就是黑)
let cv, ctx, camX = 0, camY = 0;

function initRender() {
  cv = document.getElementById('game');
  ctx = cv.getContext('2d');
  const fit = () => { cv.width = innerWidth; cv.height = innerHeight; };
  addEventListener('resize', fit);
  fit();
}

// 投射物拖尾:記上一幀的螢幕座標,畫一條漸淡短線做出飛行動態感。純渲染本地狀態,不影響模擬,
// 不需要任何同步(每個客戶端各自對著同一份 G.projs 位置算,結果自然一致)
const PROJ_TRAIL = new Map();

// ---- 角色貼圖快取(怪物/商人/動物共用,烘焙式) ----
// AI 原圖 512px、遊戲內只畫 40~120px:每幀直接大倍率縮放既傷效能、取樣又會鋸齒閃爍。
// 載入後先用高品質縮放烘成「顯示尺寸」的離屏 canvas,之後每幀都是 ~1:1 貼圖
// (squash 擠壓動畫的 ±15% 縮放很便宜也不失真)。載入失敗回 null,呼叫端退回向量/emoji 畫法
const SPRITE_CACHE = new Map();
function bakedSprite(src, sizePx) {
  const key = src + '@' + sizePx;
  let e = SPRITE_CACHE.get(key);
  if (!e) {
    e = { cv: null, failed: false };
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = sizePx;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, sizePx, sizePx);
      e.cv = c;
    };
    img.onerror = () => { e.failed = true; };
    img.src = src;
    SPRITE_CACHE.set(key, e);
  }
  return e.cv;
}
// 怪物:烘焙尺寸=顯示尺寸上限(含 squash 拉伸餘裕);失敗自動退回向量畫法
function monsterImg(type) {
  const et = ENEMY_TYPES[type];
  if (!et || !et.icon) return null;
  return bakedSprite(`assets/monsters/${et.icon}`, Math.ceil(et.r * TILE * 2.3 * 1.15));
}
// 商人(失敗退回 emoji+金色光暈)
function traderImg() {
  return bakedSprite('assets/npcs/trader.png', Math.ceil(TILE * 1.1));
}
// 動物(失敗退回 emoji——過去一直只畫 emoji,cow.png/hen.png 素材其實早就在了)
function animalImg(type) {
  return bakedSprite(`assets/animals/${type}.png`, Math.ceil(TILE * ANIMAL_TYPES[type].r * 2.3));
}
// 寵物跟班(失敗退回 emoji——找不到素材也不影響玩,跟怪物/動物同一套 fallback 慣例)
function petImg(type) {
  return bakedSprite(`assets/pets/${type}.png`, Math.ceil(TILE * 0.55));
}
// 打擊特效素材(單張圖,靠 canvas 縮放/淡出做動畫);烘一個固定小尺寸,畫的時候用動態目的地矩形
// 縮放即可做出「由小變大」的效果,不用每個當下的半徑各烤一份。找不到就交回 null,呼叫端退回向量畫法
const HITFX_IMG = { fire: 'fire.png', frost: 'frost.png', light: 'light.png', dark: 'dark.png', smash: 'smash.png' };
function hitFxSprite(elem) {
  return bakedSprite(`assets/effects/${HITFX_IMG[elem] || 'neutral.png'}`, 96);
}

// ---- 地形貼圖快取 ----
// 依 TILE_INFO[t].tex 從 assets/tiles/ 載入;載入後先預縮成 TILE 大小的離屏 canvas,
// 地形迴圈每幀畫上千格,直接畫小圖才不會每格都做大圖縮放。失敗自動退回色塊畫法
const TILE_TEX = new Map();
// 地板類貼圖要壓暗降對比:AI 材質偏亮偏花,會吃掉放在上面的物件與掉落物;
// 烘進快取(只在載入時做一次),逐幀零成本
const FLOOR_TEX_MUTE = new Set(['floor.png', 'floor_mid.png', 'floor_deep.png', 'farmland.png']);
// 牆面/實心地形壓一層較淡的暗色:統一整體色調,角色/怪物/掉落物才跳得出來
const WALL_TEX_MUTE = new Set(['dirt.png', 'stone.png', 'obsidian.png', 'voidrock.png', 'gravel.png', 'bedrock.png']);
// 2×2 格週期取樣名單:整張材質攤在 2×2 格上、每格只畫四分之一。
// AI 材質細節密度天生偏高,整張塞進 40px 一格會變成高頻雜訊、整片平鋪又滿是網格重複感;
// 攤開後細節密度減半、重複週期加倍——這是「AI 材質太花」的渲染端解法,不用重生素材。
// 礦脈/木根刻意不進名單:礦點必須每格完整置中,玩家才一眼認得出「這格是礦」
const TEX_SPREAD2 = new Set(['floor.png', 'floor_mid.png', 'floor_deep.png', 'dirt.png', 'stone.png',
  'obsidian.png', 'voidrock.png', 'gravel.png', 'bedrock.png', 'water.png', 'farmland.png']);
function tileTexFile(file) {
  let e = TILE_TEX.get(file); // 用檔名當 key:GLOW 與 FLOOR 共用 floor.png,只載一次
  if (!e) {
    e = { cv: null, failed: false };
    const img = new Image();
    img.onload = () => {
      const n = (TEX_SPREAD2.has(file) ? TILE * 2 : TILE) + 1; // +1 跟色塊畫法一致,蓋住格線縫
      const c = document.createElement('canvas');
      c.width = c.height = n;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, n, n);
      if (FLOOR_TEX_MUTE.has(file)) { g.fillStyle = 'rgba(12,10,8,0.42)'; g.fillRect(0, 0, n, n); }
      else if (WALL_TEX_MUTE.has(file)) { g.fillStyle = 'rgba(10,8,12,0.30)'; g.fillRect(0, 0, n, n); }
      e.cv = c;
    };
    img.onerror = () => { e.failed = true; };
    img.src = `assets/tiles/${file}`;
    TILE_TEX.set(file, e);
  }
  return e.cv;
}
function tileTex(t) {
  const info = TILE_INFO[t];
  return info && info.tex ? tileTexFile(info.tex) : null;
}
// 畫一格地形貼圖:2×2 週期的大貼圖依格座標取對應的四分之一,一般貼圖整張畫
function blitTile(texCv, tx, ty, sx, sy) {
  if (texCv.width > TILE + 1) ctx.drawImage(texCv, (tx & 1) * TILE, (ty & 1) * TILE, TILE + 1, TILE + 1, sx, sy, TILE + 1, TILE + 1);
  else ctx.drawImage(texCv, sx, sy);
}

// ---- 乾淨地板(程序化)----
// AI 材質縮到 40px 一格會變高頻雜訊、切割不明確;地板改純色分區 + 整齊格線,清楚不吃視線。
// 依區域(zoneOf)分四種底色,每格畫上邊+左邊各一條暗線 → 整張地圖連成清楚的網格。
const FLOOR_BASE = ['#302519', '#262b36', '#241d31', '#1b1626']; // zone 0泥土/1石/2黑曜/3淵核
const FLOOR_EDGE = ['#271d12', '#1d222d', '#1b1526', '#140e1e']; // 對應的格線暗色
const FLOOR_HI   = ['#382b1e', '#2c313d', '#2a2238', '#211a2e']; // 對應的上緣淡高光(一點點立體感)
function drawCleanFloor(sx, sy, tx, ty, t) {
  const z = zoneOf(tx + 0.5, ty + 0.5);
  let base = FLOOR_BASE[z], edge = FLOOR_EDGE[z], hi = FLOOR_HI[z];
  if (t === T.FARMLAND) { base = '#3a2b18'; edge = '#281c0e'; hi = '#46331c'; }
  else if (t === T.GLOW) { base = '#264a4e'; edge = '#1b383c'; hi = '#2e5a5e'; }
  ctx.fillStyle = base;
  ctx.fillRect(sx, sy, TILE + 1, TILE + 1);
  ctx.fillStyle = hi;                          // 上緣 1px 淡高光
  ctx.fillRect(sx, sy, TILE + 1, 1);
  ctx.fillStyle = edge;                        // 左邊+下邊暗線 = 清楚的格子切割
  ctx.fillRect(sx, sy, 1, TILE + 1);
  ctx.fillRect(sx, sy + TILE, TILE + 1, 1);
}

// ---- 鐵軌(程序化,依相鄰鐵軌自動轉向,類似 Minecraft)----
// 鐵軌只是「加速地板」(移動無方向性),所以自動轉向是純視覺:讀四鄰的 T.RAIL 決定畫直線還是轉彎。
// 鄰居靠 G.tiles 已同步,雙端各自畫得出一致造型,不需要任何額外資料/協定。
const RAIL_TIE = '#6a5236', RAIL_STEEL = '#c8ccd8';
function drawRail(sx, sy, tx, ty) {
  const u = tileAt(tx, ty - 1) === T.RAIL, d = tileAt(tx, ty + 1) === T.RAIL;
  const l = tileAt(tx - 1, ty) === T.RAIL, r = tileAt(tx + 1, ty) === T.RAIL;
  const cx = sx + TILE / 2, cy = sy + TILE / 2, gap = TILE * 0.15;
  const hc = (l ? 1 : 0) + (r ? 1 : 0), vc = (u ? 1 : 0) + (d ? 1 : 0);
  ctx.lineCap = 'round';
  // 剛好「一橫一縱」= 轉彎:用二次貝茲曲線連接兩條邊的中點,控制點放在共用角落
  if (hc === 1 && vc === 1) {
    const ex = r ? sx + TILE : sx, ey = d ? sy + TILE : sy; // 角落(圓心方向)
    const p0 = [ex, cy], p2 = [cx, ey], cp = [ex, ey];
    const bez = (tt, i) => (1 - tt) * (1 - tt) * p0[i] + 2 * (1 - tt) * tt * cp[i] + tt * tt * p2[i];
    ctx.strokeStyle = RAIL_TIE; ctx.lineWidth = TILE * 0.13;
    for (const tt of [0.22, 0.5, 0.78]) {                    // 沿弧鋪 3 根枕木(垂直於軌向)
      const bx = bez(tt, 0), by = bez(tt, 1);
      const gx = 2 * (1 - tt) * (cp[0] - p0[0]) + 2 * tt * (p2[0] - cp[0]);
      const gy = 2 * (1 - tt) * (cp[1] - p0[1]) + 2 * tt * (p2[1] - cp[1]);
      const gl = Math.hypot(gx, gy) || 1, nx = -gy / gl, ny = gx / gl;
      ctx.beginPath(); ctx.moveTo(bx - nx * gap * 1.5, by - ny * gap * 1.5); ctx.lineTo(bx + nx * gap * 1.5, by + ny * gap * 1.5); ctx.stroke();
    }
    ctx.strokeStyle = RAIL_STEEL; ctx.lineWidth = 2.5;
    const ox = cx - ex, oy = cy - ey, ol = Math.hypot(ox, oy) || 1; // 往格中心方向的單位向量,做內外偏移
    for (const s of [-1, 1]) {
      const dx = ox / ol * gap * s, dy = oy / ol * gap * s;
      ctx.beginPath(); ctx.moveTo(p0[0] + dx, p0[1] + dy); ctx.quadraticCurveTo(cp[0] + dx, cp[1] + dy, p2[0] + dx, p2[1] + dy); ctx.stroke();
    }
    return;
  }
  // 其餘(直線 / 孤立 / 三叉四叉):只有縱向連接畫直立,否則畫水平(孤立預設水平)
  const vert = vc > 0 && hc === 0;
  ctx.save(); ctx.translate(cx, cy); if (vert) ctx.rotate(Math.PI / 2);
  ctx.strokeStyle = RAIL_TIE; ctx.lineWidth = TILE * 0.13;
  for (const ox of [-TILE * 0.3, 0, TILE * 0.3]) { ctx.beginPath(); ctx.moveTo(ox, -TILE * 0.24); ctx.lineTo(ox, TILE * 0.24); ctx.stroke(); }
  ctx.strokeStyle = RAIL_STEEL; ctx.lineWidth = 2.5;
  for (const oy of [-gap, gap]) { ctx.beginPath(); ctx.moveTo(-TILE * 0.5, oy); ctx.lineTo(TILE * 0.5, oy); ctx.stroke(); }
  ctx.restore();
}

// ---- 隊友救援(倒地非陣亡):倒地的身體(黑暗遮罩前畫,跟正常玩家一樣受光照影響) ----
function drawDownedBody(p, sx, sy) {
  const col = PLAYER_COLORS[p.id % PLAYER_COLORS.length];
  const R = p.r * TILE;
  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.ellipse(sx, sy + R * 0.5, R * 1.2, R * 0.5, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(15,15,20,0.4)'; // 灰階疊層:倒地虛弱感,跟站立時的鮮豔顏色拉開差異
  ctx.fill();
  ctx.strokeStyle = '#0008'; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
  // 昏迷的 ✕✕ 眼睛
  ctx.strokeStyle = '#222'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  for (const ex of [-7, 7]) {
    ctx.beginPath();
    ctx.moveTo(sx + ex - 3, sy + R * 0.3 - 3); ctx.lineTo(sx + ex + 3, sy + R * 0.3 + 3);
    ctx.moveTo(sx + ex + 3, sy + R * 0.3 - 3); ctx.lineTo(sx + ex - 3, sy + R * 0.3 + 3);
    ctx.stroke();
  }
}
// 倒地標記(SOS + 救援進度環 + 倒數):黑暗遮罩之後畫,跟名字同一批「暗處也要看得到」的資訊
function drawDownedMarker(p, sx, sy) {
  const R = p.r * TILE;
  const pulse = 0.75 + Math.sin(performance.now() / 260) * 0.25;
  ctx.font = `${TILE * 0.46 * pulse}px "Segoe UI Emoji"`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('🆘', sx, sy - R * 1.3);
  if (p.reviveP > 0) {
    const rr = R * 1.35;
    ctx.strokeStyle = 'rgba(40,40,50,0.55)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(sx, sy, rr, 0, TAU); ctx.stroke();
    ctx.strokeStyle = '#7dff8e'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(sx, sy, rr, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, p.reviveP));
    ctx.stroke();
  }
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = '#ff9d9d';
  ctx.fillText(Math.ceil(p.downedT || 0) + 's', sx, sy + R * 1.5);
}

function worldToScreen(x, y) { return [(x - camX) * TILE, (y - camY) * TILE]; }
function screenToWorld(sx, sy) { return [sx / TILE + camX, sy / TILE + camY]; }

function render(dt) {
  ctx.fillStyle = '#050508';
  ctx.fillRect(0, 0, cv.width, cv.height);
  if (!G.started) return;
  const me = G.players.get(G.myId);
  if (!me) return;

  // 觀戰模式:鏡頭跟著自由觀戰點走,不跟角色(UI.spec 純本地,見 main.js localControl)
  const cam = UI.spec || me;
  camX = cam.x - cv.width / 2 / TILE;
  camY = cam.y - cv.height / 2 / TILE;

  const x0 = Math.max(0, Math.floor(camX)), y0 = Math.max(0, Math.floor(camY));
  const x1 = Math.min(MAP_W - 1, Math.ceil(camX + cv.width / TILE));
  const y1 = Math.min(MAP_H - 1, Math.ceil(camY + cv.height / TILE));
  const srcs = lightSources(x0, y0, x1, y1);
  const W = x1 - x0 + 1;
  const lightBuf = new Float32Array(W * (y1 - y0 + 1));

  // ---- 地形 ----
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const L = lightAt(srcs, tx + 0.5, ty + 0.5);
      lightBuf[(ty - y0) * W + (tx - x0)] = L;
      if (L < 0.03) continue; // 全黑就不用畫
      const i = idx(tx, ty);
      if (L > 0.12 && !G.explored[i]) { G.explored[i] = 1; UI.mmDirty = true; }
      const t = G.tiles[i];
      const info = TILE_INFO[t];
      const [sx, sy] = worldToScreen(tx, ty);
      const tex = tileTex(t); // 有貼圖畫貼圖,沒有(未生產/載入失敗)退回原本色塊
      if (info.liquid) {
        // 幽光水池:深藍底 + 相位錯開的波光(用格子座標當相位,不用另存動畫狀態);波光疊在貼圖上照樣有動態感
        if (tex) blitTile(tex, tx, ty, sx, sy);
        else { ctx.fillStyle = info.c1; ctx.fillRect(sx, sy, TILE + 1, TILE + 1); }
        const ph = performance.now() / 700 + tx * 1.7 + ty * 2.3;
        ctx.fillStyle = `rgba(126,220,255,${0.13 + 0.1 * Math.sin(ph)})`;
        ctx.fillRect(sx + TILE * 0.12, sy + TILE * 0.22, TILE * 0.34, TILE * 0.1);
        ctx.fillRect(sx + TILE * 0.52, sy + TILE * 0.62, TILE * 0.3, TILE * 0.09);
      } else if (!info.solid) {
        // 地板一律走乾淨程序化畫法(純色分區+清楚格線),不再用會變高頻雜訊的 AI 材質
        drawCleanFloor(sx, sy, tx, ty, t);
        if (t === T.GLOW) {
          // 發光地板:中央青色光斑
          ctx.fillStyle = 'rgba(126,240,255,0.28)';
          ctx.fillRect(sx + TILE * 0.38, sy + TILE * 0.38, TILE * 0.24, TILE * 0.24);
        } else if (t === T.FARMLAND) {
          // 翻土紋路:三條深色橫紋,一眼認得出是農地
          ctx.strokeStyle = '#2a1c0f'; ctx.lineWidth = 2;
          for (let row = 0.3; row < 1; row += 0.28) {
            ctx.beginPath();
            ctx.moveTo(sx + TILE * 0.1, sy + TILE * row);
            ctx.lineTo(sx + TILE * 0.9, sy + TILE * row);
            ctx.stroke();
          }
        } else if (t === T.RAIL) {
          drawRail(sx, sy, tx, ty); // 依相鄰鐵軌自動轉向(Minecraft 式)
        }
      } else {
        if (info.fence) {
          // 圍籬:乾淨地板打底 + 木柵欄(視覺上矮一截),跟整格實心的木牆做出區隔;裂痕沿用下方共用邏輯
          drawCleanFloor(sx, sy, tx, ty, T.FLOOR);
          if (tex) ctx.drawImage(tex, sx, sy); // 圍籬貼圖須帶透明背景,否則會整格蓋掉地板
          else {
            ctx.strokeStyle = info.c1; ctx.lineWidth = 4;
            ctx.beginPath();
            for (const fx of [0.22, 0.5, 0.78]) {
              ctx.moveTo(sx + TILE * fx, sy + TILE * 0.18);
              ctx.lineTo(sx + TILE * fx, sy + TILE * 0.92);
            }
            ctx.stroke();
            ctx.strokeStyle = info.c2; ctx.lineWidth = 3;
            ctx.beginPath();
            for (const fy of [0.35, 0.68]) {
              ctx.moveTo(sx + TILE * 0.06, sy + TILE * fy);
              ctx.lineTo(sx + TILE * 0.94, sy + TILE * fy);
            }
            ctx.stroke();
          }
        } else if (tex) {
          blitTile(tex, tx, ty, sx, sy); // 礦脈貼圖自帶礦點(不進 2×2 名單,整張畫),牆面類取四分之一
        } else {
          ctx.fillStyle = info.c1;
          ctx.fillRect(sx, sy, TILE + 1, TILE + 1);
          ctx.fillStyle = info.c2;
          ctx.fillRect(sx, sy + TILE * 0.75, TILE + 1, TILE * 0.25); // 底部陰影,立體感
        }
        if (info.ore && !tex) {
          ctx.fillStyle = info.ore;
          const rr = TILE * 0.11;
          ctx.beginPath();
          ctx.arc(sx + TILE * 0.3, sy + TILE * 0.32, rr, 0, TAU);
          ctx.arc(sx + TILE * 0.68, sy + TILE * 0.6, rr, 0, TAU);
          ctx.arc(sx + TILE * 0.42, sy + TILE * 0.72, rr * 0.8, 0, TAU);
          ctx.fill();
        }
        // 封印牆:脈動的紫色符文光,一眼認出是「通關才能破除的神秘屏障」(貼圖版可自帶符文,這裡是 fallback 疊光)
        if (info.seal) {
          const pulse = 0.4 + Math.sin(performance.now() / 500 + tx * 0.7 + ty * 0.5) * 0.3;
          ctx.fillStyle = `rgba(180,120,255,${pulse})`;
          ctx.beginPath();
          ctx.arc(sx + TILE * 0.5, sy + TILE * 0.5, TILE * 0.22, 0, TAU);
          ctx.fill();
          ctx.strokeStyle = `rgba(220,180,255,${pulse * 0.8})`;
          ctx.lineWidth = 2;
          ctx.strokeRect(sx + TILE * 0.2, sy + TILE * 0.2, TILE * 0.6, TILE * 0.6);
        }
        // 挖掘裂痕
        const cr = G.cracks.get(i);
        if (cr) {
          ctx.strokeStyle = `rgba(0,0,0,${0.35 + cr * 0.45})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(sx + TILE * 0.2, sy + TILE * 0.25);
          ctx.lineTo(sx + TILE * 0.55, sy + TILE * 0.55);
          ctx.lineTo(sx + TILE * 0.4, sy + TILE * 0.8);
          ctx.moveTo(sx + TILE * 0.75, sy + TILE * 0.2);
          ctx.lineTo(sx + TILE * 0.55, sy + TILE * 0.55);
          ctx.stroke();
        }
      }
    }
  }

  const lightOf = (x, y) => {
    const gx = Math.floor(x) - x0, gy = Math.floor(y) - y0;
    if (gx < 0 || gy < 0 || gx >= W) return 0;
    const v = lightBuf[gy * W + gx];
    return v === undefined ? 0 : v;
  };

  // ---- 物件 ----
  const OBJ_ICON = { mushroom: '🍄', torch: '🕯️', workbench: '🛠️', furnace: '🔥', tower: '🗼', archer_tower: '🏹',
    chest: '🎁', nest: '🕸️', auto_miner: '⚙️', storage: '📦', auto_smelter: '🏭',
    lantern: '🏮', crystal_lamp: '💡', banner: '🚩',
    gate: '🚪', frost_tower: '🔔', decoy: '🏺',
    cannon_tower: '🎆', multi_tower: '🎯', sniper_tower: '🔭' }; // 地刺(spike_trap)走下面的貼地特例畫法,不在這表
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const [i, o] of G.objects) {
    const tx = i % MAP_W, ty = (i / MAP_W) | 0;
    if (tx < x0 || tx > x1 || ty < y0 || ty > y1) continue;
    if (lightOf(tx + 0.5, ty + 0.5) < 0.05) continue;
    const [sx, sy] = worldToScreen(tx + 0.5, ty + 0.5);
    // 傳輸帶:貼地的方向箭頭(不是站著的機台),自己畫、跳過下面的底影+emoji 通用畫法
    if (o.type === 'belt') {
      const dir = o.dir || 0;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(dir * Math.PI / 2); // 0=右基準,順時針旋轉到下/左/上
      // 帶面(深灰底條)
      ctx.fillStyle = 'rgba(40,44,54,0.55)';
      ctx.fillRect(-TILE * 0.42, -TILE * 0.28, TILE * 0.84, TILE * 0.56);
      // 流向箭頭(青色,兩個雪佛龍)
      ctx.strokeStyle = '#7ef0ff'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (const ox of [-TILE * 0.14, TILE * 0.12]) {
        ctx.beginPath();
        ctx.moveTo(ox - TILE * 0.1, -TILE * 0.16);
        ctx.lineTo(ox + TILE * 0.08, 0);
        ctx.lineTo(ox - TILE * 0.1, TILE * 0.16);
        ctx.stroke();
      }
      ctx.restore();
      continue;
    }
    // 地刺陷阱:貼地的三根小光刺(不是站著的機台),剩餘刺數越少越透明(快報廢的視覺提示)
    if (o.type === 'spike_trap') {
      const chargeR = clamp((o.hp ?? OBJ_HP.spike_trap) / OBJ_HP.spike_trap, 0, 1);
      ctx.save();
      ctx.globalAlpha = 0.45 + chargeR * 0.55;
      ctx.fillStyle = '#cfd8e3';
      ctx.strokeStyle = '#7ea8c0';
      ctx.lineWidth = 1;
      for (const [ox, oy] of [[-0.22, 0.1], [0, -0.12], [0.22, 0.1]]) {
        const bx = sx + TILE * ox, by = sy + TILE * oy;
        ctx.beginPath();
        ctx.moveTo(bx - TILE * 0.09, by + TILE * 0.13);
        ctx.lineTo(bx, by - TILE * 0.15);
        ctx.lineTo(bx + TILE * 0.09, by + TILE * 0.13);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
      }
      ctx.restore();
      continue;
    }
    ctx.globalAlpha = o.type === 'archer_tower' && o.off ? 0.45 : 1;
    // 深色底影:emoji 物件(火把/工作台等)放在貼圖地板上才看得見
    ctx.fillStyle = 'rgba(5,5,10,0.42)';
    ctx.beginPath();
    ctx.arc(sx, sy + TILE * 0.06, TILE * 0.40, 0, TAU);
    ctx.fill();
    ctx.font = `${TILE * 0.7}px "Segoe UI Emoji"`;
    if (o.type === 'crop') {
      const def = CROP_TYPES[o.crop];
      const icon = def ? def.icons[Math.min(o.stage, def.icons.length - 1)] : '❓';
      ctx.font = `${TILE * (0.4 + 0.3 * (o.stage / Math.max(1, (def?.icons.length ?? 2) - 1)))}px "Segoe UI Emoji"`;
      ctx.fillText(icon, sx, sy);
    } else if (o.type === 'nest') {
      const ndef = NEST_TYPES[o.nestType] || NEST_TYPES.common;
      if (ndef.elite) {
        // 精英巢穴外圈脈動紅光,遠遠就能認出比較危險
        ctx.strokeStyle = `rgba(255,93,93,${0.5 + Math.sin(performance.now() / 260) * 0.25})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(sx, sy, TILE * 0.55, 0, TAU);
        ctx.stroke();
      }
      ctx.fillText(ndef.icon, sx, sy);
    } else {
      ctx.fillText(OBJ_ICON[o.type] || '❓', sx, sy);
    }
    ctx.globalAlpha = 1;
    if (o.type === 'archer_tower') {
      const w = TILE * 0.8, ammoR = (o.ammo || 0) / ARCHER_TOWER_CFG.maxAmmo;
      ctx.fillStyle = '#3336';
      ctx.fillRect(sx - w / 2, sy + TILE * 0.42, w, 4);
      ctx.fillStyle = o.off ? '#8899aa' : '#ffd23f';
      ctx.fillRect(sx - w / 2, sy + TILE * 0.42, w * ammoR, 4);
    } else if (o.type === 'auto_miner') {
      // 燃料條(光晶青色);沒燃料時整條變暗提示要供電
      const w = TILE * 0.8, fuelR = (o.fuel || 0) / AUTO_MINER_CFG.maxFuel;
      ctx.fillStyle = '#3336';
      ctx.fillRect(sx - w / 2, sy + TILE * 0.42, w, 4);
      ctx.fillStyle = fuelR > 0 ? '#7ef0ff' : '#664';
      ctx.fillRect(sx - w / 2, sy + TILE * 0.42, w * fuelR, 4);
    } else if (o.type === 'auto_smelter') {
      // 燃料條(煤炭橘):沒煤=熄火變暗;上面再疊一條細的原料緩衝量(灰白)
      const w = TILE * 0.8, fuelR = (o.fuel || 0) / AUTO_SMELTER_CFG.maxFuel;
      const bufR = Math.min(1, (o.items || []).reduce((a, s) => a + s.count, 0) / AUTO_SMELTER_CFG.maxBuffer);
      ctx.fillStyle = '#3336';
      ctx.fillRect(sx - w / 2, sy + TILE * 0.42, w, 4);
      ctx.fillStyle = fuelR > 0 ? '#ff9d5c' : '#664';
      ctx.fillRect(sx - w / 2, sy + TILE * 0.42, w * fuelR, 4);
      ctx.fillStyle = '#cfd8e3';
      ctx.fillRect(sx - w / 2, sy + TILE * 0.36, w * bufR, 2);
    } else if (o.type === 'storage') {
      // 裝填量條(金色):一眼看出箱子有多滿
      const w = TILE * 0.8, fillR = Math.min(1, (o.items ? o.items.length : 0) / STORAGE_CFG.slots);
      ctx.fillStyle = '#3336';
      ctx.fillRect(sx - w / 2, sy + TILE * 0.42, w, 4);
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(sx - w / 2, sy + TILE * 0.42, w * fillR, 4);
    } else if (o.type === 'frost_tower') {
      // 冰藍脈動環:一眼認出「這座塔在控場」(純裝飾,雙端各自用時間畫,不用同步脈衝時機)
      ctx.strokeStyle = `rgba(168,232,255,${0.35 + Math.sin(performance.now() / 400) * 0.15})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, TILE * 0.6, 0, TAU);
      ctx.stroke();
    } else if (o.type === 'decoy') {
      // 金色脈動環:仿星核的「假光」既視感,遠遠看就知道是誘餌在嘲諷
      ctx.strokeStyle = `rgba(255,210,63,${0.4 + Math.sin(performance.now() / 300) * 0.2})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, TILE * 0.58, 0, TAU);
      ctx.stroke();
    } else if (o.type === 'gate') {
      // 光簾:門框下掛一道半透明青色光簾,示意「玩家能穿、蝕影不敢鑽」
      const shimmer = 0.22 + Math.sin(performance.now() / 500 + sx) * 0.08;
      ctx.fillStyle = `rgba(126,240,255,${shimmer})`;
      ctx.fillRect(sx - TILE * 0.32, sy - TILE * 0.1, TILE * 0.64, TILE * 0.5);
    }
  }

  // ---- 星核 ----
  {
    const [sx, sy] = worldToScreen(G.core.x, G.core.y);
    if (sx > -80 && sy > -80 && sx < cv.width + 80 && sy < cv.height + 80) {
      const pulse = 1 + Math.sin(performance.now() / 400) * 0.08;
      const eR = G.core.energy / CORE_CFG.maxE;
      const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, TILE * 2.2 * pulse);
      grad.addColorStop(0, `rgba(126,240,255,${0.35 + eR * 0.3})`);
      grad.addColorStop(1, 'rgba(126,240,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(sx - TILE * 2.5, sy - TILE * 2.5, TILE * 5, TILE * 5);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(Math.PI / 4);
      const s = TILE * 0.55 * pulse;
      ctx.fillStyle = eR > 0.3 ? '#9ff4ff' : '#4d7f8a';
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.restore();
      // 能量環
      ctx.strokeStyle = eR > 0.3 ? '#7ef0ff' : '#ff6b6b';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(sx, sy, TILE * 1.1, -Math.PI / 2, -Math.PI / 2 + TAU * eR);
      ctx.stroke();
      // 已收集碎片
      for (let k = 0; k < G.core.shards; k++) {
        const a = performance.now() / 900 + k * TAU / CORE_CFG.needShards;
        ctx.font = `${TILE * 0.45}px "Segoe UI Emoji"`;
        ctx.fillText('🔷', sx + Math.cos(a) * TILE * 1.5, sy + Math.sin(a) * TILE * 1.5);
      }
    }
  }

  // ---- 掉落物 ----
  for (const d of G.drops) {
    if (d.x < x0 || d.x > x1 + 1 || d.y < y0 || d.y > y1 + 1) continue;
    if (lightOf(d.x, d.y) < 0.05) continue;
    const [sx, sy] = worldToScreen(d.x, d.y);
    const bob = Math.sin(performance.now() / 300 + d.id) * 3;
    // 深色底影:掉落物在貼圖地板上才看得見
    ctx.fillStyle = 'rgba(5,5,10,0.38)';
    ctx.beginPath();
    ctx.arc(sx, sy + bob, TILE * 0.26, 0, TAU);
    ctx.fill();
    ctx.font = `${TILE * 0.45}px "Segoe UI Emoji"`;
    ctx.fillText(ITEMS[d.item] ? ITEMS[d.item].icon : '❓', sx, sy + bob);
    if (d.n > 1) {
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText('x' + d.n, sx + 10, sy + bob + 10);
    } else if (d.lv) {
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = '#ffd23f';
      ctx.fillText('+' + d.lv, sx + 10, sy + bob + 10);
    }
  }

  // ---- 投射物(箭矢/暗影彈;不受黑暗遮罩影響,飛行中要能被看見閃避) ----
  const projSeen = new Set();
  for (const pj of G.projs) {
    if (pj.x < x0 - 1 || pj.x > x1 + 2 || pj.y < y0 - 1 || pj.y > y1 + 2) continue;
    const [sx, sy] = worldToScreen(pj.x, pj.y);
    projSeen.add(pj.id);
    const rgb = pj.elem && ELEM_FX_COLOR[pj.elem] ? ELEM_FX_COLOR[pj.elem] : (pj.from === 'e' ? '224,140,255' : '255,232,154');
    // 拖尾:上一幀螢幕座標畫一條漸淡短線,飛行時的動態感(比純圓點好閃避判斷)
    const prev = PROJ_TRAIL.get(pj.id);
    if (prev) {
      ctx.strokeStyle = `rgba(${rgb},0.4)`; ctx.lineWidth = TILE * 0.1; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(prev.sx, prev.sy); ctx.lineTo(sx, sy); ctx.stroke();
    }
    PROJ_TRAIL.set(pj.id, { sx, sy });
    ctx.fillStyle = `rgb(${rgb})`;
    ctx.beginPath();
    ctx.arc(sx, sy, TILE * 0.1, 0, TAU);
    ctx.fill();
    ctx.fillStyle = `rgba(${rgb},0.35)`;
    ctx.beginPath();
    ctx.arc(sx, sy, TILE * 0.22, 0, TAU);
    ctx.fill();
  }
  // 清掉已消失投射物的拖尾記憶,避免 Map 隨對局時間無限增長
  if (PROJ_TRAIL.size > projSeen.size + 20) {
    for (const id of PROJ_TRAIL.keys()) if (!projSeen.has(id)) PROJ_TRAIL.delete(id);
  }

  // ---- 動物(被動生物) ----
  for (const a of G.animals) {
    if (a.x < x0 - 1 || a.x > x1 + 2 || a.y < y0 - 1 || a.y > y1 + 2) continue;
    if (lightOf(a.x, a.y) < 0.04) continue;
    const at = ANIMAL_TYPES[a.type];
    const [sx, sy] = worldToScreen(a.x, a.y);
    const bob = Math.sin(performance.now() / 260 + a.id) * 2;
    const aimg = animalImg(a.type);
    if (aimg) {
      const size = TILE * at.r * 2.3;
      ctx.drawImage(aimg, sx - size / 2, sy - size / 2 + bob, size, size);
    } else {
      ctx.font = `${TILE * at.r * 2.3}px "Segoe UI Emoji"`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(at.icon, sx, sy + bob);
    }
    // 餵飽狀態:頭上小愛心(host 看 fedT,client 看快照的 fed 旗標)
    if (a.fedT > 0 || a.fed) {
      ctx.font = `${TILE * 0.28}px "Segoe UI Emoji"`;
      ctx.fillText('❤️', sx, sy - at.r * TILE - 8 + bob);
    }
    const amax = a.maxhp || at.hp;
    if (a.hp < amax) {
      const w = at.r * 2 * TILE;
      ctx.fillStyle = '#3336';
      ctx.fillRect(sx - w / 2, sy - at.r * TILE - 9, w, 4);
      ctx.fillStyle = '#7dff8e';
      ctx.fillRect(sx - w / 2, sy - at.r * TILE - 9, w * Math.max(0, a.hp / amax), 4);
    }
    if (dist(me.x, me.y, a.x, a.y) < 4) {
      ctx.font = 'bold 12px sans-serif';
      const label = at.name + ((a.fedT > 0 || a.fed) ? '' : `(可餵${at.feed.map(id => ITEMS[id].icon).join('')})`);
      ctx.fillStyle = '#000a';
      ctx.fillText(label, sx + 1, sy - at.r * TILE - (a.hp < amax ? 18 : 12) + 1);
      ctx.fillStyle = '#c8f0d0';
      ctx.fillText(label, sx, sy - at.r * TILE - (a.hp < amax ? 18 : 12));
    }
  }

  // ---- NPC 商人(固定攤位,不會動;貼圖失敗時用 emoji + 底部光暈 fallback) ----
  for (const t of G.traders) {
    if (t.x < x0 - 1 || t.x > x1 + 2 || t.y < y0 - 1 || t.y > y1 + 2) continue;
    if (lightOf(t.x, t.y) < 0.04) continue;
    const [sx, sy] = worldToScreen(t.x, t.y);
    const bob = Math.sin(performance.now() / 500) * 2;
    const img = traderImg();
    if (img) {
      const size = TILE * 1.1;
      ctx.drawImage(img, sx - size / 2, sy - size / 2 + bob, size, size);
    } else {
      ctx.fillStyle = 'rgba(255,210,63,0.18)';
      ctx.beginPath();
      ctx.arc(sx, sy + TILE * 0.1, TILE * 0.55, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(5,5,10,0.42)';
      ctx.beginPath();
      ctx.arc(sx, sy + TILE * 0.42, TILE * 0.32, 0, TAU);
      ctx.fill();
      ctx.font = `${TILE * 0.85}px "Segoe UI Emoji"`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(TRADER_CFG.icon, sx, sy + bob);
    }
    if (dist(me.x, me.y, t.x, t.y) < 4) {
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const nameY = sy - TILE * 0.7;
      const label = `${TRADER_CFG.name}(右鍵交易)`;
      ctx.fillStyle = '#000a'; ctx.fillText(label, sx + 1, nameY + 1);
      ctx.fillStyle = '#ffd23f'; ctx.fillText(label, sx, nameY);
    }
  }

  // ---- 敵人 ----
  for (const e of G.enemies) {
    if (e.x < x0 - 1 || e.x > x1 + 2 || e.y < y0 - 1 || e.y > y1 + 2) continue;
    const L = lightOf(e.x, e.y);
    if (L < 0.04) continue;
    const et = ENEMY_TYPES[e.type];
    const emaxhp = e.maxhp || et.hp; // 精英怪血量放大過,不能拿 et.hp(基礎值)當滿血
    const escale = e.elite ? ELITE_CFG.scale : 1;
    const er = et.r * escale;
    const [sx, sy] = worldToScreen(e.x, e.y);
    const squash = 1 + Math.sin(performance.now() / 200 + e.id) * 0.08;
    // 精英怪:紫色脈動外圈,一眼認出比一般怪更硬更痛
    if (e.elite) {
      ctx.strokeStyle = `rgba(224,140,255,${0.5 + Math.sin(performance.now() / 240) * 0.25})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(sx, sy, er * TILE * 1.25, 0, TAU);
      ctx.stroke();
    }
    // 暗潮怪:紅色脈動外圈 + 頭頂警示標記,一眼分辨優先目標
    if (e.wave) {
      const pulse = 1 + Math.sin(performance.now() / 220) * 0.12;
      ctx.strokeStyle = `rgba(255,70,70,${0.55 + Math.sin(performance.now() / 220) * 0.25})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(sx, sy, er * TILE * 1.4 * pulse, 0, TAU);
      ctx.stroke();
      ctx.font = `${TILE * 0.4}px "Segoe UI Emoji"`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('⚠️', sx, sy - er * TILE - 16);
    }
    // 凜鈴塔緩速:冰藍圈+小雪花(host 看 e.slowT,client 看快照的 sl 旗標)
    if (e.slowT > 0 || e.sl) {
      ctx.strokeStyle = 'rgba(168,232,255,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, er * TILE * 1.1, 0, TAU);
      ctx.stroke();
      ctx.font = `${TILE * 0.3}px "Segoe UI Emoji"`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('❄️', sx + er * TILE * 0.85, sy - er * TILE * 0.85);
    }
    const img = monsterImg(e.type);
    if (img) {
      const size = er * TILE * 2.3 * squash;
      ctx.drawImage(img, sx - size / 2, sy - size / 2, size, size);
    } else {
      ctx.fillStyle = et.color;
      ctx.beginPath();
      ctx.ellipse(sx, sy, er * TILE * squash, er * TILE / squash, 0, 0, TAU);
      ctx.fill();
      if (et.boss) {
        ctx.strokeStyle = e.type === 'fire_boss' ? '#ff8f4a' : e.type === 'frost_boss' ? '#bfe8ff' : e.type === 'void_boss' ? '#e0a0ff' : '#8a90a5';
        ctx.lineWidth = 3; ctx.stroke();
      }
      // 發光的眼睛(黑暗氛圍重點;Q版改版:放大 20% + 白色高光點,一顆高光讓眼睛「活」起來)
      ctx.fillStyle = et.eye;
      const ex = er * TILE * 0.35, eyeR = er * TILE * 0.17;
      ctx.beginPath();
      ctx.arc(sx - ex, sy - er * TILE * 0.15, eyeR, 0, TAU);
      ctx.arc(sx + ex, sy - er * TILE * 0.15, eyeR, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#ffffffcc';
      ctx.beginPath();
      ctx.arc(sx - ex + eyeR * 0.3, sy - er * TILE * 0.15 - eyeR * 0.3, eyeR * 0.32, 0, TAU);
      ctx.arc(sx + ex + eyeR * 0.3, sy - er * TILE * 0.15 - eyeR * 0.3, eyeR * 0.32, 0, TAU);
      ctx.fill();
    }
    // 血條
    if (e.hp < emaxhp) {
      const w = er * 2 * TILE;
      ctx.fillStyle = '#3336';
      ctx.fillRect(sx - w / 2, sy - er * TILE - 9, w, 5);
      ctx.fillStyle = e.elite ? '#e08cff' : '#ff5d5d';
      ctx.fillRect(sx - w / 2, sy - er * TILE - 9, w * Math.max(0, e.hp / emaxhp), 5);
    }
    // 名稱:只在玩家靠近時顯示,避免遠處一堆怪把畫面塞滿文字
    if (dist(me.x, me.y, e.x, e.y) < 4) {
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const nameY = sy - er * TILE - (e.hp < emaxhp ? 18 : 12);
      const label = e.elite ? `精英${et.name}` : et.name;
      ctx.fillStyle = '#000a';
      ctx.fillText(label, sx + 1, nameY + 1);
      ctx.fillStyle = et.boss ? '#ffd23f' : e.elite ? '#e08cff' : '#dde4ee';
      ctx.fillText(label, sx, nameY);
    }
  }

  // ---- 玩家 ----
  for (const p of G.players.values()) {
    if (p.dead) continue;
    const [sx, sy] = worldToScreen(p.x, p.y);
    if (sx < -60 || sy < -60 || sx > cv.width + 60 || sy > cv.height + 60) continue;
    // 倒下(隊友救援待救,見 REVIVE_CFG):畫倒地的身體就好,不接受任何動作輸入所以不用畫走路/揮擊;
    // SOS 標記/救援進度環/倒數畫在黑暗遮罩之上(跟名字同一批),暗處也找得到人
    if (p.downed) { drawDownedBody(p, sx, sy); continue; }
    const col = PLAYER_COLORS[p.id % PLAYER_COLORS.length];
    const R = p.r * TILE;
    // 移動時偵測位移做走路擺腿動畫(不額外存狀態,用位置差推斷)
    const mvx = p.x - (p._lrx ?? p.x), mvy = p.y - (p._lry ?? p.y);
    const moving = (mvx * mvx + mvy * mvy) > 0.00002;
    p._lrx = p.x; p._lry = p.y;
    if (moving) p._walkPh = (p._walkPh ?? 0) + dt * 9;
    const walk = moving ? Math.sin(p._walkPh ?? 0) : 0;

    // 護甲等級決定輪廓色(無甲=深色 / 鐵甲=銀邊 / 金甲=金邊)
    // 房主端 p.equip 是正確的即時資料;客戶端看別人時要靠快照同步的 armorPct(自己的 p.equip 也有同步,兩者算出來一致)
    const armor = NET.isHost() ? bestArmor(p) : (p.armorPct || 0) / 100;
    const outline = armor >= 0.5 ? '#ffd23f' : armor >= 0.3 ? '#c8ced8' : '#0008';
    const outlineW = armor > 0 ? 3 : 2;

    // 雙腳(走路交替擺動)
    ctx.fillStyle = '#0006';
    const legOff = R * 0.4;
    ctx.beginPath();
    ctx.ellipse(sx - legOff, sy + R * 0.75 + walk * 3, R * 0.22, R * 0.32, 0, 0, TAU);
    ctx.ellipse(sx + legOff, sy + R * 0.75 - walk * 3, R * 0.22, R * 0.32, 0, 0, TAU);
    ctx.fill();

    // 身體(略呈橢圓,呼吸/步伐輕微擠壓)
    const squashB = 1 + Math.abs(walk) * 0.03;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.ellipse(sx, sy + R * 0.12, R * 0.92 * squashB, R * 0.8 / squashB, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = outline; ctx.lineWidth = outlineW; ctx.stroke();

    // 頭部(疊在身體上方,略偏向瞄準方向做出朝向感)
    const hx0 = sx + Math.cos(p.aim) * R * 0.12, hy0 = sy - R * 0.45 + Math.sin(p.aim) * R * 0.06;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(hx0, hy0, R * 0.62, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = outline; ctx.lineWidth = outlineW * 0.8; ctx.stroke();

    // 面向的眼睛(Q版改版:眼睛加大;低血時變「><」求救臉,雙端都有 hp/maxhp 可判)
    const ex = Math.cos(p.aim) * R * 0.3, ey = Math.sin(p.aim) * R * 0.3;
    const e1x = hx0 + ex - Math.sin(p.aim) * 4.5, e1y = hy0 + ey + Math.cos(p.aim) * 4.5;
    const e2x = hx0 + ex + Math.sin(p.aim) * 4.5, e2y = hy0 + ey - Math.cos(p.aim) * 4.5;
    if (p.hp / p.maxhp < 0.3) {
      // 「><」瀕死表情:比血條更直覺的求救訊號
      ctx.strokeStyle = '#222'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      for (const [cx0, cy0, flip] of [[e1x, e1y, 1], [e2x, e2y, -1]]) {
        ctx.beginPath();
        ctx.moveTo(cx0 - 3 * flip, cy0 - 3); ctx.lineTo(cx0 + 3 * flip, cy0);
        ctx.lineTo(cx0 - 3 * flip, cy0 + 3);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.arc(e1x, e1y, 3.5, 0, TAU);
      ctx.arc(e2x, e2y, 3.5, 0, TAU);
      ctx.fill();
      // 淡粉腮紅:Q 版臉頰的靈魂,順著臉的朝向擺在眼睛外側下方
      ctx.fillStyle = 'rgba(255,157,226,0.35)';
      ctx.beginPath();
      ctx.ellipse(e1x - Math.sin(p.aim) * 5, e1y + Math.cos(p.aim) * 5 + 2, 3.2, 2.2, 0, 0, TAU);
      ctx.ellipse(e2x + Math.sin(p.aim) * 5, e2y - Math.cos(p.aim) * 5 + 2, 3.2, 2.2, 0, 0, TAU);
      ctx.fill();
    }
    // 手持物品(先算出來,揮擊弧光要用它的屬性上色):待機時偏向側後方貼身顯示(避開頭部),
    // 攻擊/挖礦時往瞄準方向揮出到身體外側
    const held = p.swing > 0 && p.action === 'mine' ? bestPick(p) : weaponOf(p);
    // weaponOf/bestPick 把 ITEMS[id].sword/ranged 子物件展平合併進回傳值,elem 直接掛在 held 上(不是 held.sword.elem)
    const heldElem = held && held.elem;
    const arcRgb = heldElem && ELEM_FX_COLOR[heldElem] ? ELEM_FX_COLOR[heldElem] : '255,255,255';
    // 揮擊弧光:白色=無屬性,有屬性武器染成對應顏色(焰橘/霜藍/光金/暗紫/重擊灰)
    if (p.swing > 0) {
      ctx.strokeStyle = `rgba(${arcRgb},${p.swing / 0.22 * 0.85})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(sx, sy, TILE * 1.3, p.aim - 0.8, p.aim + 0.8);
      ctx.stroke();
    }
    if (held && held.icon) {
      const swinging = p.swing > 0;
      const swingF = swinging ? (p.action === 'mine' ? p.swing / 0.2 : p.swing / 0.22) : 0;
      // 拖影:近戰揮擊時額外畫兩個「稍早角度、較淡」的殘影,做出揮動的動態感(挖礦不畫,避免視覺雜訊)
      if (swinging && p.action !== 'mine') {
        for (const off of [0.32, 0.16]) {
          const ghostF = Math.min(1, swingF + off);
          const gAng = p.aim + (ghostF - 0.5) * 1.1;
          const gr = R * 1.35;
          ctx.save();
          ctx.font = `${TILE * 0.44}px "Segoe UI Emoji"`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.globalAlpha = (1 - off) * 0.35;
          ctx.fillText(held.icon, sx + Math.cos(gAng) * gr, sy + Math.sin(gAng) * gr);
          ctx.restore();
        }
      }
      // 待機時擺在慣用手側(瞄準方向 +100°),不擋住臉;揮動時甩到瞄準方向前方
      const ang = swinging ? p.aim + (swingF - 0.5) * 1.1 : p.aim + 1.75;
      const hr = R * (swinging ? 1.35 : 0.95);
      const hx = sx + Math.cos(ang) * hr, hy = sy + Math.sin(ang) * hr;
      ctx.save();
      ctx.font = `${TILE * (swinging ? 0.5 : 0.34)}px "Segoe UI Emoji"`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = swinging ? 1 : 0.85;
      ctx.fillText(held.icon, hx, hy);
      ctx.restore();
    }
    // 寵物:純裝飾偏移(繞著玩家位置算出來的軌跡,不是獨立模擬的實體),host/client 用同一份
    // p.x/p.y+performance.now() 算,結果自然一致,不用額外同步座標。受黑暗遮罩影響(跟玩家本體一樣暗處看不見)
    if (p.pet) {
      const pet = PET_TYPES[p.pet];
      if (pet) {
        const orbT = performance.now() / 1000 + p.id * 1.7; // 每個玩家的寵物相位錯開,不會疊在一起
        const orbR = R * 1.7;
        const px = sx - Math.cos(p.aim) * orbR * 0.5 + Math.cos(orbT * 1.3) * orbR * 0.35;
        const py = sy + R * 0.5 - Math.sin(p.aim) * orbR * 0.2 + Math.sin(orbT * 1.3) * orbR * 0.25;
        const img = petImg(p.pet);
        ctx.save();
        ctx.globalAlpha = 0.95;
        if (img) {
          const size = TILE * 0.55;
          ctx.drawImage(img, px - size / 2, py - size / 2, size, size);
        } else {
          ctx.font = `${TILE * 0.4}px "Segoe UI Emoji"`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(pet.icon, px, py);
        }
        ctx.restore();
      }
    }
  }

  // ---- 黑暗遮罩 ----
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const L = lightBuf[(ty - y0) * W + (tx - x0)];
      const a = clamp(1 - L * 1.5, 0, 1);
      if (a < 0.04) continue;
      ctx.fillStyle = `rgba(3,3,8,${a})`;
      const [sx, sy] = worldToScreen(tx, ty);
      ctx.fillRect(sx, sy, TILE + 1, TILE + 1);
    }
  }

  // ---- 名字(畫在黑暗之上,找得到隊友)+ 倒下標記(SOS/救援環/倒數,自己倒下時也要看到) ----
  ctx.font = 'bold 13px sans-serif';
  for (const p of G.players.values()) {
    if (p.dead) continue;
    const [sx, sy] = worldToScreen(p.x, p.y);
    if (p.downed) drawDownedMarker(p, sx, sy);
    if (p.id === G.myId) continue;
    const label = `${p.name} Lv.${p.lv || 1}`;
    ctx.fillStyle = '#000a';
    ctx.fillText(label, sx + 1, sy - p.r * TILE - 9);
    ctx.fillStyle = PLAYER_COLORS[p.id % PLAYER_COLORS.length];
    ctx.fillText(label, sx, sy - p.r * TILE - 10);
  }

  // ---- 滑鼠挖礦/放置高亮框 ----
  {
    const [wx, wy] = screenToWorld(INPUT.mx, INPUT.my);
    const tx = Math.floor(wx), ty = Math.floor(wy);
    if (inMap(tx, ty) && lightOf(tx + 0.5, ty + 0.5) > 0.03) {
      const info = TILE_INFO[tileAt(tx, ty)];
      const inRange = dist(me.x, me.y, tx + 0.5, ty + 0.5) <= 3.6;
      const sel = me.inv[me.sel];
      const placing = sel && (ITEMS[sel.id].place || ITEMS[sel.id].placeTile !== undefined);
      let col = null;
      if (info.solid && info.hp !== Infinity)
        col = !inRange ? '#ffffff33' : bestPick(me).tier >= info.tier ? '#ffffffaa' : '#ff5d5daa';
      else if (placing && tileAt(tx, ty) === T.FLOOR && !G.objects.has(idx(tx, ty)))
        col = inRange ? '#7dff8eaa' : '#7dff8e33';
      if (col) {
        const [sx, sy] = worldToScreen(tx, ty);
        ctx.strokeStyle = col; ctx.lineWidth = 2;
        ctx.strokeRect(sx + 1, sy + 1, TILE - 2, TILE - 2);
      }
    }
  }

  // ---- 角色附近格子說明(走近一格內自動顯示)----
  {
    const tip = document.getElementById('tileTip');
    const px = Math.floor(me.x), py = Math.floor(me.y);
    let best = null, bestD = Infinity;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const gx = px + dx, gy = py + dy;
      if (!inMap(gx, gy)) continue;
      const d = dist(me.x, me.y, gx + 0.5, gy + 0.5);
      if (d > 1.5 || d >= bestD) continue;
      const obj = G.objects.get(idx(gx, gy));
      const info = TILE_INFO[tileAt(gx, gy)];
      let label = null;
      if (obj) label = (ITEMS[obj.type] ? ITEMS[obj.type].icon + ' ' + ITEMS[obj.type].name : null);
      else if (dist(gx + 0.5, gy + 0.5, G.core.x, G.core.y) < 2) label = '💠 星核';
      else if (info.solid && info.name) label = (info.liquid ? '💧 ' : info.ore ? '⛏️ ' : '') + info.name;
      if (label) { best = { label, gx, gy }; bestD = d; }
    }
    if (best && !UI.panelOpen && !UI.menuOpen) {
      const [sx, sy] = worldToScreen(best.gx + 0.5, best.gy + 0.5);
      tip.textContent = best.label;
      tip.style.left = sx + 'px';
      tip.style.top = (sy - TILE * 0.9) + 'px';
      tip.classList.remove('hidden');
    } else tip.classList.add('hidden');
  }

  // ---- 浮動文字 ----
  ctx.textAlign = 'center';
  for (const f of G.floaters) {
    const [sx, sy] = worldToScreen(f.x, f.y);
    const a = clamp(1 - f.t / 1.1, 0, 1);
    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = '#000000' + Math.round(a * 160).toString(16).padStart(2, '0');
    ctx.fillText(f.txt, sx + 1, sy - f.t * 28 + 1);
    ctx.fillStyle = f.color + Math.round(a * 255).toString(16).padStart(2, '0');
    ctx.fillText(f.txt, sx, sy - f.t * 28);
  }

  // ---- 快速手勢氣泡(co-op 溝通,跟浮動文字一樣畫在黑暗之上,暗處也要看得到)----
  // 動畫:前 0.15s 從 0 彈到 1(pop-in),中段持平,最後 0.4s 淡出;不像浮動文字一直往上飄,
  // 圖示夠大且停留久才看得清楚是誰喊了什麼
  for (const em of G.emoteFx) {
    const [sx, sy] = worldToScreen(em.x, em.y);
    const dur = EMOTE_CFG.dur;
    const pop = Math.min(1, em.t / 0.15);
    const scale = pop < 1 ? pop * (1.15 - 0.15 * pop) : 1; // 輕微過衝再回穩,Q 版彈跳感
    const fadeStart = dur - 0.4;
    const alpha = em.t > fadeStart ? clamp(1 - (em.t - fadeStart) / 0.4, 0, 1) : 1;
    const by = sy - TILE * 1.5;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(20,20,28,0.55)';
    ctx.beginPath();
    ctx.ellipse(sx, by, TILE * 0.48 * scale, TILE * 0.4 * scale, 0, 0, TAU);
    ctx.fill();
    ctx.font = `${TILE * 0.5 * scale}px "Segoe UI Emoji"`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(em.icon, sx, by);
    ctx.font = 'bold 11px sans-serif';
    ctx.fillStyle = '#fff'; // emote fx 沒存玩家 id,對不到 PLAYER_COLORS,固定白字看得清楚就好
    ctx.fillText(em.name, sx, by + TILE * 0.55 * scale);
    ctx.restore();
  }

  // ---- 打擊特效(命中衝擊波,跟浮動文字一樣畫在黑暗之上)----
  // 素材有生產好的話畫「單張圖 + canvas 縮放/淡出做動畫」(比逐格動畫圖穩,AI 生不出連續一致的動畫幀);
  // 沒有素材(未生產/載入失敗)自動退回純向量畫法(衝擊環+放射短線),兩者互不依賴、零風險疊加
  for (const h of G.hitFx) {
    const [sx, sy] = worldToScreen(h.x, h.y);
    const t = clamp(h.t / HITFX_DUR, 0, 1);
    const img = hitFxSprite(h.elem);
    const a = (1 - t) * (h.crit ? 0.95 : 0.75);
    if (img) {
      const size = TILE * (0.85 + t * (h.crit ? 1.35 : 0.9));
      ctx.save();
      ctx.globalAlpha = a;
      ctx.drawImage(img, sx - size / 2, sy - size / 2, size, size);
      ctx.restore();
    } else {
      const rgb = h.elem && ELEM_FX_COLOR[h.elem] ? ELEM_FX_COLOR[h.elem] : (h.crit ? '255,157,60' : '255,223,107');
      const r = TILE * (0.14 + t * (h.crit ? 0.55 : 0.38));
      ctx.strokeStyle = `rgba(${rgb},${a})`;
      ctx.lineWidth = 3 * (1 - t) + 1;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.stroke();
      const n = h.crit ? 6 : 4;
      ctx.lineWidth = 2;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * TAU + h.seed;
        const r1 = r * 0.55, r2 = r * 1.1;
        ctx.beginPath();
        ctx.moveTo(sx + Math.cos(ang) * r1, sy + Math.sin(ang) * r1);
        ctx.lineTo(sx + Math.cos(ang) * r2, sy + Math.sin(ang) * r2);
        ctx.stroke();
      }
    }
  }

  // ---- 倒下畫面(全螢幕暗紅暈,純本地渲染不影響模擬;倒數/救援環已在世界空間畫在自己頭上)----
  if (me.downed) {
    ctx.save();
    const g = ctx.createRadialGradient(cv.width / 2, cv.height / 2, cv.height * 0.22, cv.width / 2, cv.height / 2, cv.height * 0.72);
    g.addColorStop(0, 'rgba(120,10,10,0)');
    g.addColorStop(1, 'rgba(120,10,10,0.5)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.restore();
  }
}
