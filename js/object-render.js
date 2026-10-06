// 地圖物件的裝飾動畫只使用本機時鐘,不修改物件、燃料或網路資料。
let objectVisualTime = 0;
function advanceObjectVisuals(dt) {
  if (!motionPreference.matches) objectVisualTime += Math.max(0, Math.min(dt, 0.1));
}

function objectSpriteId(o) {
  if (o.type === 'crop' && o.crop === 'mush') return 'crop_' + clamp(o.stage || 0, 0, 2);
  if (o.type === 'nest') return o.nestType === 'elite' ? 'nest_elite' : o.nestType === 'swarm' ? 'nest_swarm' : 'nest';
  return o.type;
}

function objectSignal(o) {
  if (o.type === 'auto_miner' || o.type === 'auto_smelter') return o.fuel > 0 ? '#70e8ee' : '#eea551';
  if (o.type === 'archer_tower') return o.off ? '#73808e' : o.ammo > 0 ? '#70e8ee' : '#eea551';
  if (o.type === 'nest') return (NEST_TYPES[o.nestType] || NEST_TYPES.common).color;
  if (o.type === 'decoy' || o.type === 'chest' || o.type === 'candle' || o.type === 'furnace') return '#ffbd6b';
  return '#70e8ee';
}

const OBJECT_SMALL = new Set(['torch', 'lantern', 'candle', 'mushroom']);
const OBJECT_HALO = new Set(['torch', 'lantern', 'crystal_lamp', 'candle', 'frost_tower', 'decoy', 'gate', 'nest', 'tower']);
const OBJECT_STATUS = new Set(['auto_miner', 'auto_smelter', 'archer_tower']);

function drawTechObject(o, index, sx, sy) {
  if (texturePackId !== 'ruins') return false;
  const id = objectSpriteId(o);
  const legacySize = o.type === 'tower' || o.type === 'archer_tower';
  const size = TILE * (OBJECT_SMALL.has(o.type) ? 0.72 : legacySize ? 1.4 : 1.04);
  const sprite = packItemSprite(id, size);
  if (!sprite) return false;
  const signal = objectSignal(o), time = motionPreference.matches ? 0 : objectVisualTime;
  const pulse = motionPreference.matches ? 0.5 : 0.5 + Math.sin(time * 2.5 + index * 0.71) * 0.5;
  const group = PACK_INFRASTRUCTURE[id] !== undefined ? 'infrastructure' : PACK_INTERIORS[id] !== undefined ? 'interiors' : null;
  const frame = group ? packFrame(group, group === 'infrastructure' ? PACK_INFRASTRUCTURE[id] : PACK_INTERIORS[id]) : null;
  // 圖集的透明留白與物件高寬不同,以實際圖像底緣對齊地面。
  const heightRatio = frame ? frame[3] / Math.max(frame[2], frame[3]) : 0.78;
  const top = sy + TILE * 0.29 - size * (1 + heightRatio) / 2;
  ctx.save();
  ctx.fillStyle = '#02091488';
  ctx.beginPath(); ctx.ellipse(sx, sy + TILE * 0.24, TILE * (OBJECT_SMALL.has(o.type) ? 0.22 : 0.37), TILE * 0.12, 0, 0, TAU); ctx.fill();
  if (OBJECT_HALO.has(o.type)) {
    ctx.globalAlpha = 0.16 + pulse * 0.08;
    ctx.strokeStyle = signal; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(sx, sy + TILE * 0.2, TILE * 0.46, TILE * 0.22, 0, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if ((OBJECT_STATUS.has(o.type) && (o.off || !(o.type === 'archer_tower' ? o.ammo > 0 : o.fuel > 0)))) ctx.globalAlpha = 0.63;
  if (o.type === 'spike_trap') ctx.globalAlpha = 0.4 + clamp((o.hp ?? OBJ_HP.spike_trap) / OBJ_HP.spike_trap, 0, 1) * 0.6;
  ctx.drawImage(sprite, sx - size / 2, top, size, size);
  ctx.globalAlpha = 1;
  if (OBJECT_STATUS.has(o.type)) {
    // 電力/彈藥狀態燈;有燃料只表示供能,不冒充已採到礦或正在射擊。
    ctx.fillStyle = '#071422'; ctx.fillRect(sx - 5, sy + TILE * 0.26, 10, 4);
    ctx.fillStyle = signal; ctx.fillRect(sx - 3, sy + TILE * 0.28, 6, 2);
  }
  if (o.type === 'gate' || o.type === 'painting' || o.type === 'decoy') {
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = signal; ctx.lineWidth = 1;
    const scan = motionPreference.matches ? 0.5 : (time * 0.35 + index * 0.07) % 1;
    const y = sy - TILE * 0.38 + scan * TILE * 0.52;
    ctx.beginPath(); ctx.moveTo(sx - TILE * 0.16, y); ctx.lineTo(sx + TILE * 0.16, y); ctx.stroke();
  }
  if (o.type === 'crop' && o.stage >= 2) {
    ctx.globalAlpha = 0.65 + pulse * 0.35;
    ctx.fillStyle = '#b7ffe1';
    ctx.beginPath(); ctx.arc(sx + TILE * 0.31, sy - TILE * 0.38, 1.5, 0, TAU); ctx.fill();
  }
  ctx.restore();
  return true;
}

function drawTechFloorObject(o, sx, sy) {
  if (texturePackId !== 'ruins') return false;
  if (!['belt', 'rug_red', 'rug_blue', 'tile_deco'].includes(o.type)) return false;
  ctx.save(); ctx.translate(sx, sy);
  if (o.type === 'belt') {
    ctx.rotate((o.dir || 0) * Math.PI / 2);
    ctx.fillStyle = '#08101b'; ctx.fillRect(-TILE * 0.49, -TILE * 0.29, TILE * 0.98, TILE * 0.58);
    ctx.fillStyle = '#344b60';
    ctx.fillRect(-TILE * 0.49, -TILE * 0.33, TILE * 0.98, 3);
    ctx.fillRect(-TILE * 0.49, TILE * 0.26, TILE * 0.98, 3);
    ctx.beginPath(); ctx.rect(-TILE * 0.46, -TILE * 0.24, TILE * 0.92, TILE * 0.48); ctx.clip();
    ctx.strokeStyle = '#6dcede'; ctx.lineWidth = 1.5;
    const offset = motionPreference.matches ? 0 : (objectVisualTime * 0.45) % 0.32;
    for (let n = -3; n <= 2; n++) {
      const x = (n * 0.32 + offset) * TILE;
      ctx.beginPath(); ctx.moveTo(x - TILE * 0.1, -TILE * 0.12); ctx.lineTo(x, 0); ctx.lineTo(x - TILE * 0.1, TILE * 0.12); ctx.stroke();
    }
  } else {
    const color = o.type === 'rug_red' ? '#b46c87' : '#58b8c9';
    ctx.fillStyle = o.type === 'rug_red' ? '#2d2031' : '#122c3c';
    ctx.fillRect(-TILE * 0.48, -TILE * 0.48, TILE * 0.96, TILE * 0.96);
    ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.strokeRect(-TILE * 0.4, -TILE * 0.4, TILE * 0.8, TILE * 0.8);
    ctx.globalAlpha = 0.3;
    for (const y of [-0.22, 0, 0.22]) {
      ctx.beginPath(); ctx.moveTo(-TILE * 0.32, y * TILE); ctx.lineTo(TILE * 0.32, y * TILE); ctx.stroke();
    }
    if (o.type === 'tile_deco') {
      ctx.globalAlpha = 0.9;
      ctx.rotate(Math.PI / 4);
      ctx.strokeRect(-TILE * 0.15, -TILE * 0.15, TILE * 0.3, TILE * 0.3);
    }
  }
  ctx.restore(); return true;
}

function drawTechCart(c, sx, sy) {
  if (texturePackId !== 'ruins') return false;
  ctx.save(); ctx.translate(sx, sy); ctx.rotate(c.dir * Math.PI / 2);
  ctx.fillStyle = '#050b13'; ctx.fillRect(-TILE * 0.38, -TILE * 0.29, TILE * 0.76, TILE * 0.58);
  ctx.fillStyle = '#60778b'; ctx.fillRect(-TILE * 0.35, -TILE * 0.23, TILE * 0.7, TILE * 0.46);
  ctx.fillStyle = '#172837'; ctx.fillRect(-TILE * 0.27, -TILE * 0.17, TILE * 0.48, TILE * 0.34);
  ctx.strokeStyle = '#91aab9'; ctx.lineWidth = 1; ctx.strokeRect(-TILE * 0.27, -TILE * 0.17, TILE * 0.48, TILE * 0.34);
  for (const x of [-0.23, 0.23]) for (const y of [-0.27, 0.27]) {
    ctx.fillStyle = '#0b1521'; ctx.fillRect(TILE * (x - 0.08), TILE * (y - 0.05), TILE * 0.16, TILE * 0.1);
  }
  ctx.fillStyle = '#76e5f3'; ctx.fillRect(TILE * 0.3, -TILE * 0.12, 2, TILE * 0.24);
  if (c.items.length) {
    ctx.fillStyle = '#c69a60'; ctx.fillRect(-TILE * 0.19, -TILE * 0.1, TILE * 0.28, TILE * 0.2);
    ctx.strokeStyle = '#594a39'; ctx.strokeRect(-TILE * 0.19, -TILE * 0.1, TILE * 0.28, TILE * 0.2);
  }
  ctx.restore(); return true;
}
