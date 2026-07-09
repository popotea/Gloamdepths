// ===== 背包與合成(所有判定都在房主端執行) =====
const INV_SIZE = 32; // 前 8 格是快捷欄

function makeStartInv() {
  const inv = new Array(INV_SIZE).fill(null);
  inv[0] = { id: 'wood_pick', count: 1 };
  inv[1] = { id: 'wood_sword', count: 1 };
  inv[2] = { id: 'torch', count: 8 };
  inv[3] = { id: 'mushroom', count: 2 };
  inv[4] = { id: 'wood', count: 8 };
  return inv;
}

function stackMax(id) { return ITEMS[id].max || 99; }

// 回傳放不下的數量(0=全部放入)
function addItem(p, id, n = 1) {
  const mx = stackMax(id);
  for (let i = 0; i < INV_SIZE && n > 0; i++) {
    const s = p.inv[i];
    if (s && s.id === id && s.count < mx) {
      const add = Math.min(n, mx - s.count);
      s.count += add; n -= add;
    }
  }
  for (let i = 0; i < INV_SIZE && n > 0; i++) {
    if (!p.inv[i]) {
      const add = Math.min(n, mx);
      p.inv[i] = { id, count: add }; n -= add;
    }
  }
  p.invDirty = true;
  return n;
}

function countItem(p, id) {
  let c = 0;
  for (const s of p.inv) if (s && s.id === id) c += s.count;
  return c;
}
function canAfford(p, cost) {
  for (const id in cost) if (countItem(p, id) < cost[id]) return false;
  return true;
}
function payCost(p, cost) {
  for (const id in cost) {
    let need = cost[id];
    for (let i = 0; i < INV_SIZE && need > 0; i++) {
      const s = p.inv[i];
      if (s && s.id === id) {
        const take = Math.min(need, s.count);
        s.count -= take; need -= take;
        if (s.count <= 0) p.inv[i] = null;
      }
    }
  }
  p.invDirty = true;
}
function removeOne(p, id) {
  for (let i = 0; i < INV_SIZE; i++) {
    const s = p.inv[i];
    if (s && s.id === id) {
      s.count--;
      if (s.count <= 0) p.inv[i] = null;
      p.invDirty = true;
      return true;
    }
  }
  return false;
}
function consumeSlot(p, slot) {
  const s = p.inv[slot];
  if (!s) return;
  s.count--;
  if (s.count <= 0) p.inv[slot] = null;
  p.invDirty = true;
}
function swapSlots(p, a, b) {
  if (a < 0 || b < 0 || a >= INV_SIZE || b >= INV_SIZE) return;
  const t = p.inv[a]; p.inv[a] = p.inv[b]; p.inv[b] = t;
  p.invDirty = true;
}

// 自動選最好的工具(徒手也能挖/打,避免卡死)
function bestPick(p) {
  let best = { tier: 0, power: 0.5, name: '徒手' };
  for (const s of p.inv) {
    if (s && ITEMS[s.id].pick && ITEMS[s.id].pick.power > best.power)
      best = { ...ITEMS[s.id].pick, name: ITEMS[s.id].name };
  }
  return best;
}
function bestSword(p) {
  // 只自動選「劍」;矛/鎚(manual)要放快捷欄選中才會用,保留武器選擇的意義
  let best = { dmg: 4, name: '徒手' };
  for (const s of p.inv) {
    const w = s && ITEMS[s.id].sword;
    if (w && !w.manual && w.dmg > best.dmg)
      best = { ...w, name: ITEMS[s.id].name };
  }
  return best;
}

// 目前使用的武器:快捷欄選中的武器(近戰/遠程)優先,否則自動用最好的劍
function weaponOf(p) {
  const s = p.inv[p.sel];
  if (s && ITEMS[s.id].ranged) return { ...ITEMS[s.id].ranged, name: ITEMS[s.id].name, ranged: true };
  if (s && ITEMS[s.id].sword)  return { ...ITEMS[s.id].sword,  name: ITEMS[s.id].name };
  return bestSword(p);
}
function bestArmor(p) {
  let best = 0;
  for (const s of p.inv) {
    if (s && ITEMS[s.id].armor && ITEMS[s.id].armor > best) best = ITEMS[s.id].armor;
  }
  return best;
}

// 附近是否有指定合成站
function stationNear(p, type) {
  if (!type) return true;
  const px = Math.floor(p.x), py = Math.floor(p.y);
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const o = objAt(px + dx, py + dy);
    if (o && o.type === type) return true;
  }
  return false;
}

// 合成(房主端);回傳錯誤訊息或 null=成功
function craftRecipe(p, ri) {
  const r = RECIPES[ri];
  if (!r) return '無效配方';
  if (!stationNear(p, r.station)) return `需要靠近${r.station === 'furnace' ? '熔爐' : '工作台'}`;
  if (!canAfford(p, r.cost)) return '材料不足';
  payCost(p, r.cost);
  const left = addItem(p, r.out, r.n);
  if (left > 0) spawnDrop(r.out, left, p.x, p.y); // 背包滿了就掉在腳邊
  return null;
}
