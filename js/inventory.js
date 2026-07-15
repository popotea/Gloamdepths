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

// ===== 耐久度 =====
// 格子物件的 dur 欄位 = 目前耐久;undefined 一律視為全滿(合成/撿取/舊存檔不用特別初始化),
// 只有磨損過才寫入,歸零鎖在 0(損壞停用,永不消失)
function maxDur(s) {
  const base = ITEMS[s.id].dur;
  return base ? Math.round(base * (1 + 0.15 * (s.lv || 0))) : 0; // 衝裝每級 +15% 耐久上限
}
function isBroken(s) { return !!(s && ITEMS[s.id].dur && s.dur === 0); }
// 修理成本 = 合成成本的一半(向上取整);沒有配方的初始裝備(木鎬/木劍)修理只要木材
function repairCostOf(id) {
  const r = RECIPES.find(r => r.out === id);
  if (!r) return { wood: 2 };
  const cost = {};
  for (const k in r.cost) cost[k] = Math.ceil(r.cost[k] / 2);
  return cost;
}

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

// 帶強化等級/耐久狀態的裝備(max:1)只能找空格放,不可與其他堆疊合併(等級/耐久會不一致);
// 回傳 0=放入成功 / 1=背包滿放不下(呼叫端用來決定要不要留在地上)
function addEnhancedItem(p, id, lv, dur) {
  for (let i = 0; i < INV_SIZE; i++) {
    if (!p.inv[i]) {
      p.inv[i] = { id, count: 1, lv };
      if (dur !== undefined && dur !== null) p.inv[i].dur = dur;
      p.invDirty = true;
      return 0;
    }
  }
  return 1;
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
// p.infinite:隱藏指令 /give_all 開啟的除錯狀態,開啟時所有消耗一律跳過扣款
function payCost(p, cost) {
  if (p.infinite) return;
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
  if (p.infinite) return true;
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
  if (p.infinite) return;
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

// 背包「整理」:只動快捷欄之後的格子(INV_SIZE 前8格是快捷欄,保留原位不打亂正在用的裝備)。
// 同 id 且無強化等級的堆疊會先合併到上限,帶等級的裝備各自獨立一格不合併(等級不能被吃掉);
// 依 RECIPE_CATS 分類排序(工具/武器/防具/建築/素材),同分類內依 id 字母序,空格全部推到最後
function sortInventory(p) {
  const HOT = 8;
  const items = p.inv.slice(HOT).filter(Boolean);
  const merged = [];
  for (const s of items) {
    if (s.lv) { merged.push(s); continue; } // 強化裝備各自獨立,不與其他堆疊合併
    const mx = stackMax(s.id);
    const existing = merged.find(m => m.id === s.id && !m.lv && m.count < mx);
    if (existing) {
      const room = mx - existing.count;
      const move = Math.min(room, s.count);
      existing.count += move;
      if (s.count - move > 0) merged.push({ id: s.id, count: s.count - move });
    } else merged.push(s);
  }
  const catIndex = id => RECIPE_CATS.findIndex(c => c.test(ITEMS[id]));
  merged.sort((a, b) => catIndex(a.id) - catIndex(b.id) || a.id.localeCompare(b.id));
  for (let i = HOT; i < INV_SIZE; i++) p.inv[i] = merged[i - HOT] || null;
  p.invDirty = true;
}

// Shift+左鍵對半拆堆:把該格數量砍半,移到最近的空格;數量1或裝備類(帶lv)不能拆
function splitStack(p, slot) {
  if (slot < 0 || slot >= INV_SIZE) return;
  const s = p.inv[slot];
  if (!s || s.count <= 1 || s.lv) return;
  const empty = p.inv.findIndex(x => !x);
  if (empty < 0) return; // 背包滿了拆不出去
  const half = Math.floor(s.count / 2);
  s.count -= half;
  p.inv[empty] = { id: s.id, count: half };
  p.invDirty = true;
}

// 自動選最好的工具(徒手也能挖/打,避免卡死);挖掘力會套用強化卷軸加成。
// 損壞(dur=0)的一律跳過(自然退回次級裝備或徒手);slot 欄位帶回格子物件,磨損要用
function bestPick(p) {
  let best = { tier: 0, power: 0.5, name: '徒手', icon: '✊', slot: null };
  for (const s of p.inv) {
    if (s && ITEMS[s.id].pick && !isBroken(s) && ITEMS[s.id].pick.power > best.power)
      best = { ...ITEMS[s.id].pick, name: ITEMS[s.id].name, icon: ITEMS[s.id].icon, power: ITEMS[s.id].pick.power * enhMult(s), slot: s };
  }
  return best;
}
function bestSword(p) {
  // 只自動選「劍」;矛/鎚(manual)要放快捷欄選中才會用,保留武器選擇的意義
  let best = { dmg: 4, name: '徒手', icon: '✊', slot: null };
  for (const s of p.inv) {
    const w = s && ITEMS[s.id].sword;
    if (w && !w.manual && !isBroken(s) && w.dmg > best.dmg)
      best = { ...w, name: ITEMS[s.id].name, icon: ITEMS[s.id].icon, dmg: w.dmg * enhMult(s), slot: s };
  }
  return best;
}

// 近戰攻擊實際使用的武器:快捷欄選中矛/鎚(manual)時用其專屬 range/arc/kb/elem,
// 否則退回自動選劍(補上劍的預設攻擊距離/弧度,維持原本手感)
const SWORD_DEFAULT_RANGE = 1.8, SWORD_DEFAULT_ARC = 1.1;
function meleeWeaponOf(p) {
  const s = p.inv[p.sel];
  const w = s && ITEMS[s.id].sword;
  if (w && w.manual && !isBroken(s)) { // 損壞的矛/鎚不能用,退回自動選劍
    return { ...w, name: ITEMS[s.id].name, icon: ITEMS[s.id].icon, dmg: w.dmg * enhMult(s),
      range: w.range ?? SWORD_DEFAULT_RANGE, arc: w.arc ?? SWORD_DEFAULT_ARC, slot: s };
  }
  const best = bestSword(p);
  return { ...best, range: SWORD_DEFAULT_RANGE, arc: SWORD_DEFAULT_ARC };
}

// 目前使用的武器:快捷欄選中的武器(近戰/遠程)優先,否則自動用最好的劍;傷害套用強化卷軸加成
function weaponOf(p) {
  const s = p.inv[p.sel];
  if (s && ITEMS[s.id].ranged) return { ...ITEMS[s.id].ranged, name: ITEMS[s.id].name, icon: ITEMS[s.id].icon, ranged: true, dmg: ITEMS[s.id].ranged.dmg * enhMult(s) };
  if (s && ITEMS[s.id].sword)  return { ...ITEMS[s.id].sword,  name: ITEMS[s.id].name, icon: ITEMS[s.id].icon, dmg: ITEMS[s.id].sword.dmg * enhMult(s) };
  return bestSword(p);
}
// 裝備欄的護甲值:頭盔+胸甲相加(不是取最好一件),護腿不計入
function bestArmor(p) {
  if (!p.equip) return 0;
  let total = 0;
  for (const part of ['head', 'chest']) {
    const eq = p.equip[part];
    const it = eq && ITEMS[eq.id];
    if (it && it.armor) total += it.armor + enhArmorBonus(eq);
  }
  return Math.min(0.8, total);
}
// 護腿的移動速度加成
function equipSpeedBonus(p) {
  const eq = p.equip && p.equip.legs;
  const it = eq && ITEMS[eq.id];
  return (it && it.speedBonus) || 0;
}
// 飾品欄的掉落物磁吸範圍(拾取戒指用),沒裝就是基礎值
function magnetRangeOf(p) {
  const eq = p.equip && p.equip.accessory;
  const it = eq && ITEMS[eq.id];
  return (it && it.magnetMult) ? MAGNET_RANGE * it.magnetMult : MAGNET_RANGE;
}
// 飾品欄(暖絨護符)的緩速抗性:遭冰系攻擊附加的 p.buffs.slow debuff,持續時間打折(explodeAt 套用)
function slowResistOf(p) {
  const eq = p.equip && p.equip.accessory;
  const it = eq && ITEMS[eq.id];
  return (it && it.slowResist) || 0;
}

// 附近是否有指定合成站
const STATION_RANGE = 6;
function stationNear(p, type) {
  if (!type) return true;
  const px = Math.floor(p.x), py = Math.floor(p.y);
  for (let dy = -STATION_RANGE; dy <= STATION_RANGE; dy++) for (let dx = -STATION_RANGE; dx <= STATION_RANGE; dx++) {
    const o = objAt(px + dx, py + dy);
    if (o && o.type === type) return true;
  }
  return false;
}

// 合成(房主端);回傳錯誤訊息或 null=成功
// /power infinite 開著時連合成站距離限制都跳過(跟免扣材料同一個除錯精神:不受限測試任何配方)
function craftRecipe(p, ri) {
  const r = RECIPES[ri];
  if (!r) return '無效配方';
  if (!p.infinite && !stationNear(p, r.station)) return `需要靠近${r.station === 'furnace' ? '熔爐' : '工作台'}`;
  if (!canAfford(p, r.cost)) return '材料不足';
  payCost(p, r.cost);
  const left = addItem(p, r.out, r.n);
  if (left > 0) spawnDrop(r.out, left, p.x, p.y); // 背包滿了就掉在腳邊
  if (r.out === 'void_sword' || r.out === 'void_armor') unlockAchv('void_forge');
  return null;
}
