// 動畫狀態獨立於實體與存檔,不將步伐/殘影寫入網路同步資料。
const ENTITY_MOTION = new WeakMap();
const MOTION_FLASH = new WeakMap();
const MOTION_TAU = Math.PI * 2;
const MOTION_FACE_ANGLE = [Math.PI / 2, 0, -Math.PI / 2, Math.PI];
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');

function motionAngleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function motionDirection(angle) {
  return Math.abs(Math.cos(angle)) > Math.abs(Math.sin(angle)) ? (Math.cos(angle) >= 0 ? 1 : 3) : (Math.sin(angle) >= 0 ? 0 : 2);
}

function entityMotion(entity, dt, player = false) {
  let state = ENTITY_MOTION.get(entity);
  if (!state) {
    state = { x: entity.x, y: entity.y, hp: entity.hp, phase: 0, speed: 0,
      vx: 0, vy: 0, time: (Number(entity.id) || 0) * 0.37, moveAge: 1,
      facing: motionDirection(entity.aim ?? Math.PI / 2), hurt: 0,
      trails: [], trailClock: 0, frame: 1, dash: false };
    ENTITY_MOTION.set(entity, state);
  }
  if (!(dt > 0)) return state;
  dt = Math.min(dt, 0.1);
  state.time += dt;
  const dx = entity.x - state.x, dy = entity.y - state.y, distance = Math.hypot(dx, dy);
  state.x = entity.x; state.y = entity.y;
  state.hurt = entity.hp < state.hp ? 0.18 : Math.max(0, state.hurt - dt);
  state.hp = entity.hp;
  // 傳送、復活或久未進入視野後直接重設,不把長距離位移誤判成衝刺。
  if (distance > 2.5 || entity.dead || entity.downed || entity.riding) {
    state.speed = state.vx = state.vy = state.phase = 0;
    state.trails.length = 0; state.frame = 1; state.dash = false;
    state.moveAge = 1; state.trailClock = 0;
    return state;
  }
  const blend = 1 - Math.exp(-dt * 16);
  state.speed += (distance / dt - state.speed) * blend;
  state.vx += (dx / dt - state.vx) * blend;
  state.vy += (dy / dt - state.vy) * blend;
  state.moveAge = distance > 0.0001 ? 0 : state.moveAge + dt;
  // 用行走距離推進循環,低幀率與高幀率的步幅一致;撞牆後不繼續踏步。
  state.phase = (state.phase + distance / 1.9 * MOTION_TAU) % MOTION_TAU;
  const walking = state.moveAge < 0.10 && state.speed > 0.15;
  state.frame = walking ? Math.floor(state.phase / MOTION_TAU * 4) : 1;
  const angle = player && (!walking || entity.swing > 0) ? (entity.aim ?? Math.PI / 2) : Math.atan2(state.vy, state.vx);
  // 對角線附近加入小幅容差,避免四方向圖格因座標微小抖動來回跳轉。
  if ((player || walking) && Math.abs(motionAngleDelta(MOTION_FACE_ANGLE[state.facing], angle)) > Math.PI / 4 + 0.10) {
    state.facing = motionDirection(angle);
  }
  state.dash = player && !entity.riding && walking && ((entity.dashT || 0) > 0 || state.speed > 8.5);
  for (const trail of state.trails) trail.life -= dt;
  state.trails = state.trails.filter(trail => trail.life > 0);
  state.trailClock += dt;
  if (state.dash && distance > 0.005 && state.trailClock >= 0.025 && !motionPreference.matches) {
    state.trailClock = 0;
    state.trails.push({ x: entity.x - dx, y: entity.y - dy, facing: state.facing, frame: state.frame, life: 0.15 });
    if (state.trails.length > 5) state.trails.shift();
  }
  if (motionPreference.matches) state.trails.length = 0;
  return state;
}

function explorerSprite(state) {
  const frame = motionPreference.matches ? 1 : state.frame;
  return packSprite('explorer-walk', state.facing * 4 + frame, TILE * 1.25) ||
    packSprite('creatures', PACK_CREATURES.player, TILE * 1.25);
}

function motionFlashSprite(sprite) {
  if (MOTION_FLASH.has(sprite)) return MOTION_FLASH.get(sprite);
  const cv = document.createElement('canvas'); cv.width = sprite.width; cv.height = sprite.height;
  const g = cv.getContext('2d');
  g.drawImage(sprite, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = '#d9faff'; g.fillRect(0, 0, cv.width, cv.height);
  MOTION_FLASH.set(sprite, cv);
  return cv;
}

function drawMotionSprite(sprite, x, y, size, state, tilt = 0, scaleY = 1) {
  ctx.save(); ctx.translate(x, y);
  if (!motionPreference.matches) { ctx.rotate(tilt); ctx.scale(1, scaleY); }
  ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
  if (state.hurt > 0) {
    ctx.globalAlpha *= Math.min(0.75, state.hurt / 0.18);
    ctx.drawImage(motionFlashSprite(sprite), -size / 2, -size / 2, size, size);
  }
  ctx.restore();
}

function weaponMotion(p, held, radius, offset = 0) {
  const mining = p.action === 'mine', ranged = !mining && !!held?.ranged;
  const duration = mining ? 0.2 : ranged ? 0.18 : 0.22;
  const active = p.swing > 0;
  const progress = active ? Math.max(0, Math.min(1, 1 - p.swing / duration - offset)) : 1;
  const ease = 1 - (1 - progress) ** 3;
  const stroke = active ? Math.sin(progress * Math.PI) : 0;
  let angle = p.aim + 1.65, reach = radius * 1.05;
  if (active) {
    angle = ranged ? p.aim : p.aim - (mining ? 1 : 1.15) + ease * (mining ? 1.6 : 2.1);
    reach = radius * (ranged ? 1.15 - (1 - progress) ** 2 * 0.32 : 1.15 + stroke * 0.65);
  }
  return { active, progress, stroke, angle, reach, ranged, mining };
}

function drawExplorerMotion(p, sprite, state, sx, sy, col, pose) {
  const radius = p.r * TILE, size = TILE * 1.25;
  const bodyOffset = radius * 0.8 - size * 0.47;
  ctx.save();
  ctx.fillStyle = '#0007';
  ctx.beginPath(); ctx.ellipse(sx, sy + radius * 0.8, radius, radius * 0.42, 0, 0, MOTION_TAU); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 1.3; ctx.stroke();
  for (const trail of state.trails) {
    const image = explorerSprite(trail);
    if (!image) continue;
    const [x, y] = worldToScreen(trail.x, trail.y);
    ctx.globalAlpha = trail.life / 0.15 * 0.24;
    ctx.drawImage(image, x - size / 2, y + bodyOffset - size / 2, size, size);
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = p.hp / p.maxhp < 0.3 ? '#ff826c' : '#88dfe9';
  ctx.beginPath(); ctx.arc(sx, sy, radius * 1.35, p.aim - 0.18, p.aim + 0.18); ctx.stroke();
  const walk = state.moveAge < 0.1 ? Math.sin(state.phase) : 0;
  const speed = Math.min(1, state.speed / 4.6);
  const impulse = pose.active ? (pose.ranged ? -((1 - pose.progress) ** 2) * 3 : pose.stroke * 2.5) : 0;
  const reduced = motionPreference.matches;
  const x = sx + (reduced ? 0 : Math.cos(p.aim) * impulse + Math.sin(state.time * 110) * state.hurt * 9);
  const y = sy + bodyOffset + (reduced ? 0 : Math.sin(p.aim) * impulse - Math.abs(walk) * 0.6);
  const tilt = reduced ? 0 : Math.max(-0.10, Math.min(0.10, state.vx * 0.008)) + walk * 0.013 * speed;
  drawMotionSprite(sprite, x, y, size, state, tilt, 1 + Math.sin(state.time * 2.6) * 0.008 * (1 - speed));
  ctx.restore();
}

function drawEnemyMotion(e, sprite, state, sx, sy, size) {
  const floating = e.type === 'phantom' || e.type === 'abyss';
  const heavy = ENEMY_TYPES[e.type].boss || e.type === 'breaker';
  const walking = state.moveAge < 0.1 ? Math.min(1, state.speed / 3) : 0;
  const wave = Math.sin(state.phase);
  const reduced = motionPreference.matches;
  const bob = reduced ? 0 : floating ? Math.sin(state.time * 2.4) * 3 : -Math.abs(wave) * walking * (heavy ? 0.65 : 1.8);
  const tilt = reduced ? 0 : floating ? Math.sin(state.time * 1.8) * 0.045 : wave * walking * (heavy ? 0.014 : 0.045);
  const scaleY = floating ? 1 : 1 + Math.abs(wave) * walking * (heavy ? 0.012 : 0.025);
  ctx.save(); ctx.fillStyle = '#0006';
  ctx.beginPath(); ctx.ellipse(sx, sy + size * 0.43, size * 0.32, size * 0.12, 0, 0, MOTION_TAU); ctx.fill(); ctx.restore();
  drawMotionSprite(sprite, sx, sy + bob, size, state, tilt, scaleY);
}

function drawPlayerWeapon(p, held, sprite, pose, sx, sy, radius) {
  if (!held?.icon) return;
  const rgb = held.elem && ELEM_FX_COLOR[held.elem] ? ELEM_FX_COLOR[held.elem] : '139,234,255';
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (pose.active && !motionPreference.matches) {
    if (!pose.ranged) {
      const sweepRadius = radius * (pose.mining ? 1.8 : 2.2);
      ctx.strokeStyle = `rgba(${rgb},${Math.sin(pose.progress * Math.PI) * 0.65})`;
      ctx.lineWidth = pose.mining ? 2 : 3.5;
      ctx.beginPath(); ctx.arc(sx, sy, sweepRadius, pose.angle - 0.65, pose.angle); ctx.stroke();
    } else if (pose.progress < 0.35) {
      ctx.strokeStyle = `rgba(${rgb},${(1 - pose.progress / 0.35) * 0.8})`; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx + Math.cos(p.aim) * radius * 1.8, sy + Math.sin(p.aim) * radius * 1.8);
      ctx.lineTo(sx + Math.cos(p.aim) * radius * 2.25, sy + Math.sin(p.aim) * radius * 2.25); ctx.stroke();
    }
  }
  const draw = (sample, alpha) => {
    const x = sx + Math.cos(sample.angle) * sample.reach, y = sy + Math.sin(sample.angle) * sample.reach;
    const size = TILE * (sample.active ? 0.7 : 0.5);
    ctx.save(); ctx.globalAlpha = alpha;
    if (sprite) {
      ctx.translate(x, y); ctx.rotate(sample.angle + Math.PI / 4);
      ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
    } else {
      ctx.font = `${TILE * (sample.active ? 0.5 : 0.34)}px "Segoe UI Emoji"`;
      ctx.fillText(held.icon, x, y);
    }
    ctx.restore();
  };
  if (pose.active && !pose.ranged && !motionPreference.matches) {
    for (const offset of [0.16, 0.08]) {
      if (pose.progress > offset) draw(weaponMotion(p, held, radius, offset), (1 - pose.progress) * 0.22);
    }
  }
  draw(pose, 1);
  ctx.restore();
}

function drawImpactSparks(sx, sy, h, progress) {
  const rgb = h.elem && ELEM_FX_COLOR[h.elem] ? ELEM_FX_COLOR[h.elem] : '139,234,255';
  const fade = (1 - progress) ** 2;
  const radius = TILE * (0.12 + (1 - (1 - progress) ** 3) * (h.crit ? 0.75 : 0.48));
  ctx.save(); ctx.lineCap = 'round';
  if (progress < 0.18) {
    ctx.fillStyle = `rgba(231,252,255,${(1 - progress / 0.18) * 0.8})`;
    ctx.beginPath(); ctx.arc(sx, sy, TILE * (h.crit ? 0.15 : 0.1), 0, MOTION_TAU); ctx.fill();
  }
  if (!motionPreference.matches) {
    const count = h.crit ? 8 : 5;
    ctx.strokeStyle = `rgba(${rgb},${fade * 0.9})`; ctx.lineWidth = h.crit ? 2 : 1.3;
    for (let i = 0; i < count; i++) {
      const angle = h.seed + i * MOTION_TAU / count;
      const length = TILE * (0.09 + (i % 3) * 0.025) * (1 - progress);
      ctx.beginPath(); ctx.moveTo(sx + Math.cos(angle) * radius, sy + Math.sin(angle) * radius);
      ctx.lineTo(sx + Math.cos(angle) * (radius + length), sy + Math.sin(angle) * (radius + length)); ctx.stroke();
    }
  }
  ctx.restore();
}
