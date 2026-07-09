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

function worldToScreen(x, y) { return [(x - camX) * TILE, (y - camY) * TILE]; }
function screenToWorld(sx, sy) { return [sx / TILE + camX, sy / TILE + camY]; }

function render(dt) {
  ctx.fillStyle = '#050508';
  ctx.fillRect(0, 0, cv.width, cv.height);
  if (!G.started) return;
  const me = G.players.get(G.myId);
  if (!me) return;

  camX = me.x - cv.width / 2 / TILE;
  camY = me.y - cv.height / 2 / TILE;

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
      if (!info.solid) {
        // 地板(依區域變色)
        const z = zoneOf(tx + 0.5, ty + 0.5);
        ctx.fillStyle = t === T.GLOW ? '#2e4a52' : z === 0 ? '#2b2118' : z === 1 ? '#232329' : '#1b1826';
        ctx.fillRect(sx, sy, TILE + 1, TILE + 1);
        if (t === T.GLOW) {
          ctx.fillStyle = 'rgba(126,240,255,0.25)';
          ctx.fillRect(sx + TILE * 0.4, sy + TILE * 0.4, TILE * 0.2, TILE * 0.2);
        }
      } else {
        ctx.fillStyle = info.c1;
        ctx.fillRect(sx, sy, TILE + 1, TILE + 1);
        ctx.fillStyle = info.c2;
        ctx.fillRect(sx, sy + TILE * 0.75, TILE + 1, TILE * 0.25); // 底部陰影,立體感
        if (info.ore) {
          ctx.fillStyle = info.ore;
          const rr = TILE * 0.11;
          ctx.beginPath();
          ctx.arc(sx + TILE * 0.3, sy + TILE * 0.32, rr, 0, TAU);
          ctx.arc(sx + TILE * 0.68, sy + TILE * 0.6, rr, 0, TAU);
          ctx.arc(sx + TILE * 0.42, sy + TILE * 0.72, rr * 0.8, 0, TAU);
          ctx.fill();
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
  const OBJ_ICON = { mushroom: '🍄', torch: '🕯️', workbench: '🛠️', furnace: '🔥', tower: '🗼' };
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const [i, o] of G.objects) {
    const tx = i % MAP_W, ty = (i / MAP_W) | 0;
    if (tx < x0 || tx > x1 || ty < y0 || ty > y1) continue;
    if (lightOf(tx + 0.5, ty + 0.5) < 0.05) continue;
    const [sx, sy] = worldToScreen(tx + 0.5, ty + 0.5);
    ctx.font = `${TILE * 0.7}px "Segoe UI Emoji"`;
    ctx.fillText(OBJ_ICON[o.type] || '❓', sx, sy);
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
    ctx.font = `${TILE * 0.45}px "Segoe UI Emoji"`;
    ctx.fillText(ITEMS[d.item] ? ITEMS[d.item].icon : '❓', sx, sy + bob);
    if (d.n > 1) {
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText('x' + d.n, sx + 10, sy + bob + 10);
    }
  }

  // ---- 敵人 ----
  for (const e of G.enemies) {
    if (e.x < x0 - 1 || e.x > x1 + 2 || e.y < y0 - 1 || e.y > y1 + 2) continue;
    const L = lightOf(e.x, e.y);
    if (L < 0.04) continue;
    const et = ENEMY_TYPES[e.type];
    const [sx, sy] = worldToScreen(e.x, e.y);
    const squash = 1 + Math.sin(performance.now() / 200 + e.id) * 0.08;
    // 暗潮怪:紅色脈動外圈 + 頭頂警示標記,一眼分辨優先目標
    if (e.wave) {
      const pulse = 1 + Math.sin(performance.now() / 220) * 0.12;
      ctx.strokeStyle = `rgba(255,70,70,${0.55 + Math.sin(performance.now() / 220) * 0.25})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(sx, sy, et.r * TILE * 1.4 * pulse, 0, TAU);
      ctx.stroke();
      ctx.font = `${TILE * 0.4}px "Segoe UI Emoji"`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('⚠️', sx, sy - et.r * TILE - 16);
    }
    ctx.fillStyle = et.color;
    ctx.beginPath();
    ctx.ellipse(sx, sy, et.r * TILE * squash, et.r * TILE / squash, 0, 0, TAU);
    ctx.fill();
    if (e.type === 'sentinel') {
      ctx.strokeStyle = '#8a90a5'; ctx.lineWidth = 3; ctx.stroke();
    }
    // 發光的眼睛(黑暗氛圍重點)
    ctx.fillStyle = et.eye;
    const ex = et.r * TILE * 0.35;
    ctx.beginPath();
    ctx.arc(sx - ex, sy - et.r * TILE * 0.15, et.r * TILE * 0.14, 0, TAU);
    ctx.arc(sx + ex, sy - et.r * TILE * 0.15, et.r * TILE * 0.14, 0, TAU);
    ctx.fill();
    // 血條
    if (e.hp < et.hp) {
      const w = et.r * 2 * TILE;
      ctx.fillStyle = '#3336';
      ctx.fillRect(sx - w / 2, sy - et.r * TILE - 9, w, 5);
      ctx.fillStyle = '#ff5d5d';
      ctx.fillRect(sx - w / 2, sy - et.r * TILE - 9, w * Math.max(0, e.hp / et.hp), 5);
    }
  }

  // ---- 玩家 ----
  for (const p of G.players.values()) {
    if (p.dead) continue;
    const [sx, sy] = worldToScreen(p.x, p.y);
    if (sx < -60 || sy < -60 || sx > cv.width + 60 || sy > cv.height + 60) continue;
    const col = PLAYER_COLORS[p.id % PLAYER_COLORS.length];
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(sx, sy, p.r * TILE, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#0008'; ctx.lineWidth = 2; ctx.stroke();
    // 面向的眼睛
    ctx.fillStyle = '#222';
    const ex = Math.cos(p.aim) * p.r * TILE * 0.45, ey = Math.sin(p.aim) * p.r * TILE * 0.45;
    ctx.beginPath();
    ctx.arc(sx + ex - Math.sin(p.aim) * 4, sy + ey + Math.cos(p.aim) * 4, 2.5, 0, TAU);
    ctx.arc(sx + ex + Math.sin(p.aim) * 4, sy + ey - Math.cos(p.aim) * 4, 2.5, 0, TAU);
    ctx.fill();
    // 揮擊弧光
    if (p.swing > 0) {
      ctx.strokeStyle = `rgba(255,255,255,${p.swing / 0.22 * 0.8})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(sx, sy, TILE * 1.3, p.aim - 0.8, p.aim + 0.8);
      ctx.stroke();
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

  // ---- 名字(畫在黑暗之上,找得到隊友)----
  ctx.font = 'bold 13px sans-serif';
  for (const p of G.players.values()) {
    if (p.dead || p.id === G.myId) continue;
    const [sx, sy] = worldToScreen(p.x, p.y);
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
      else if (info.solid && info.name) label = (info.ore ? '⛏️ ' : '') + info.name;
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
}
