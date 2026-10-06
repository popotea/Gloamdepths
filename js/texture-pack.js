// 材質只影響本機呈現,不改 ITEMS/TILE_INFO、存檔或網路封包。
const TEXTURE_PACKS = {
  ruins: { name: '深色科幻遺跡', description: '裝甲探索者、機械生物、能源裝備與遺跡礦脈。' },
  classic: { name: '原版素材', description: '使用原有角色、怪物、牆面與物品圖示。' },
};
let texturePackId = 'ruins';
try {
  const saved = localStorage.getItem('gld_texture_pack');
  if (Object.hasOwn(TEXTURE_PACKS, saved)) texturePackId = saved;
} catch (e) { /* 儲存空間受限時仍能切換本次工作階段的外觀。 */ }

const PACK_ATLASES = new Map();
const PACK_SPRITES = new Map();
const PACK_GROUPS = ['terrain', 'creatures', 'equipment', 'supplies', 'explorer-walk', 'infrastructure', 'interiors'];
const PACK_INFRASTRUCTURE = {
  auto_miner: 0, auto_smelter: 1, cannon_tower: 2, multi_tower: 3,
  sniper_tower: 4, frost_tower: 5, gate: 6, decoy: 7,
  rail_station: 8, banner: 9, crystal_lamp: 10, lantern: 11,
  torch: 12, storage: 13, chest: 14, nest_elite: 15,
};
const PACK_INTERIORS = {
  chair: 0, bed: 1, toilet: 2, sofa: 3, bookshelf: 4, plant_pot: 5,
  painting: 6, candle: 7, crop_0: 8, crop_1: 9, crop_2: 10,
  spike_trap: 11, nest: 12, nest_swarm: 13, workbench: 14, furnace: 15,
};
const PACK_TILES = {
  'dirt.png': 0, 'gravel.png': 0, 'stone.png': 1, 'obsidian.png': 2,
  'bedrock.png': 3, 'coal_vein.png': 4, 'copper_vein.png': 5,
  'iron_vein.png': 6, 'gold_vein.png': 7, 'lumite_vein.png': 8,
  'diamond_vein.png': 9, 'voidrock.png': 10, 'water.png': 11,
  'wall_wood.png': 12, 'wall_stone.png': 13, 'wall_deco.png': 13,
  'seal.png': 14, 'root.png': 15,
};
const PACK_CREATURES = {
  imp: 0, hunter: 1, breaker: 2, spitter: 3, phantom: 4, abyss: 5,
  bomber: 6, spore: 7, revenant: 8, voidling: 9, sentinel: 10,
  fire_boss: 11, frost_boss: 12, void_boss: 13, void_lord: 13,
  player: 14, trader: 15,
};
const PACK_ITEMS = {
  wood_pick: 0, copper_pick: 0, iron_pick: 0, gold_pick: 0,
  wood_sword: 1, copper_sword: 1, iron_sword: 1, gold_sword: 1,
  flame_sword: 1, frost_sword: 1, void_sword: 1,
  iron_hammer: 2, gold_hammer: 2, copper_spear: 3, iron_spear: 3,
  crossbow: 4, lumite_staff: 5, iron_armor: 6, gold_armor: 6, void_armor: 6,
  iron_helmet: 7, gold_helmet: 7, torch: 8, lantern: 8, crystal_lamp: 8,
  lumite: 9, copper_bar: 10, iron_bar: 10, gold_bar: 10, shard: 11, void_shard: 11,
  workbench: 12, furnace: 13, auto_smelter: 13, archer_tower: 14,
  tower: 15, frost_tower: 15,
};
const PACK_ITEM_IDS_BY_NAME = new Map(Object.entries(ITEMS).map(([id, item]) => [item.name, id]));
const PACK_SUPPLIES = {
  mushroom: 0, glowcap: 1, wood: 2, stone: 3, copper_ore: 4, iron_ore: 5,
  gold_ore: 6, coal: 7, diamond: 8, meat: 9, cooked_fish: 10,
  cooked_mushroom: 11, mushroom_skewer: 11, arrow: 12, enh_scroll: 13,
  storage: 14, chest: 14, nest: 15,
};
// 角色圖集保留了足夠透明間距;記錄各角色的有效範圍,顯示時依比例置中而不拉扁。
const PACK_CREATURE_FRAMES = [
  [0.08293,0.08214,0.11643,0.14514], [0.32217,0.0614,0.11483,0.17464],
  [0.53349,0.06699,0.18501,0.1555], [0.80303,0.07416,0.13955,0.16029],
  [0.06539,0.29585,0.14593,0.18022], [0.3118,0.31021,0.14912,0.14833],
  [0.55901,0.30383,0.13477,0.15869], [0.80303,0.30542,0.13796,0.16587],
  [0.07735,0.51675,0.13317,0.18979], [0.31738,0.56619,0.12998,0.12121],
  [0.53349,0.52632,0.18421,0.17384], [0.78788,0.52711,0.17065,0.17384],
  [0.05502,0.76236,0.16268,0.17145], [0.30144,0.76316,0.16906,0.16986],
  [0.57416,0.78309,0.10207,0.14354], [0.81978,0.7799,0.11404,0.14992],
];
// 所有行走圖格用相同大小與腳底基準裁切,轉向時不因透明留白不同而上下跳動。
const PACK_EXPLORER_FRAMES = [
  [0.040271,0.042265,0.204944,0.204944], [0.279107,0.043062,0.204944,0.204944],
  [0.51555,0.044657,0.204944,0.204944], [0.754386,0.042265,0.204944,0.204944],
  [0.039075,0.273525,0.204944,0.204944], [0.277512,0.274322,0.204944,0.204944],
  [0.525917,0.275917,0.204944,0.204944], [0.767943,0.27193,0.204944,0.204944],
  [0.037081,0.513557,0.204944,0.204944], [0.280303,0.512759,0.204944,0.204944],
  [0.51874,0.515152,0.204944,0.204944], [0.758373,0.511164,0.204944,0.204944],
  [0.037879,0.739234,0.204944,0.204944], [0.279107,0.740032,0.204944,0.204944],
  [0.516746,0.732057,0.204944,0.204944], [0.76236,0.739234,0.204944,0.204944],
];

const PACK_OBJECT_FRAMES = {
  "infrastructure": [
    [0.027911,0.036683,0.23126,0.208134],
    [0.283892,0.031898,0.208134,0.217703],
    [0.521531,0.046252,0.222488,0.211324],
    [0.775917,0.051037,0.197767,0.205742],
    [0.028708,0.275917,0.217703,0.207337],
    [0.292663,0.263955,0.169059,0.224083],
    [0.513557,0.278309,0.236045,0.214514],
    [0.822169,0.279107,0.121212,0.212121],
    [0.032695,0.503987,0.214514,0.22807],
    [0.325359,0.499203,0.132376,0.220893],
    [0.569378,0.50319,0.11244,0.227273],
    [0.818182,0.507177,0.111643,0.208134],
    [0.064593,0.740829,0.129984,0.220096],
    [0.27193,0.775917,0.208134,0.181021],
    [0.525518,0.770335,0.205742,0.191388],
    [0.764753,0.738437,0.216906,0.232855],
  ],
  "interiors": [
    [0.064593,0.066986,0.15311,0.183413],
    [0.278309,0.044657,0.208931,0.214514],
    [0.559809,0.058214,0.128389,0.19697],
    [0.755981,0.085327,0.217703,0.174641],
    [0.054226,0.307018,0.173844,0.181021],
    [0.301435,0.295853,0.165869,0.188995],
    [0.563796,0.282297,0.141148,0.200159],
    [0.822967,0.330144,0.096491,0.147528],
    [0.057416,0.566986,0.165072,0.133971],
    [0.303828,0.561404,0.164274,0.141148],
    [0.541467,0.523126,0.165869,0.183413],
    [0.777512,0.544657,0.184211,0.161085],
    [0.039075,0.76236,0.197767,0.188198],
    [0.279904,0.741627,0.201754,0.210526],
    [0.515152,0.755183,0.226475,0.196172],
    [0.771132,0.729665,0.197767,0.220893],
  ],
};

function packFrame(group, cell) {
  if (PACK_OBJECT_FRAMES[group]) return PACK_OBJECT_FRAMES[group][cell];
  if (group === 'explorer-walk') return PACK_EXPLORER_FRAMES[cell];
  if (group === 'creatures') return PACK_CREATURE_FRAMES[cell];
  const row = Math.floor(cell / 4);
  // 食物與長箭之間的空白略高於標準格線,避免相鄰列取到箭尖。
  const rows = group === 'supplies' ? [0, 0.25, 0.5, 0.73, 1] : [0, 0.25, 0.5, 0.75, 1];
  return [(cell % 4) / 4, rows[row], 0.25, rows[row + 1] - rows[row]];
}

function packAtlas(group) {
  let entry = PACK_ATLASES.get(group);
  if (!entry) {
    const img = new Image();
    entry = { img, ready: false, failed: false, src: `assets/packs/ruins/${group}.png` };
    PACK_ATLASES.set(group, entry);
    img.onload = () => {
      entry.ready = true;
      dispatchEvent(new Event('texturepackchange'));
    };
    img.onerror = () => {
      entry.failed = true;
      dispatchEvent(new Event('texturepackchange'));
    };
    img.src = entry.src;
  }
  return entry;
}

function preloadTexturePack() {
  if (texturePackId === 'ruins') PACK_GROUPS.forEach(packAtlas);
}

function setTexturePack(id) {
  if (!Object.hasOwn(TEXTURE_PACKS, id) || id === texturePackId) return;
  texturePackId = id;
  try { localStorage.setItem('gld_texture_pack', id); } catch (e) { }
  // 只留當前使用的烘焙圖,多次切換不累積顯存。
  PACK_SPRITES.clear();
  preloadTexturePack();
  dispatchEvent(new Event('texturepackchange'));
}

// 使用 atlas 原始座標裁切並烘焙,不讀回像素或轉 data URL,直接雙擊 HTML 也能用。
function packSprite(group, cell, size, filter = 'none', mute = false) {
  if (texturePackId !== 'ruins' || cell === undefined) return null;
  const atlas = packAtlas(group);
  if (!atlas.ready) return null;
  const scale = Math.min(devicePixelRatio || 1, 2);
  const key = `${group}:${cell}:${size}:${scale}:${filter}:${mute}`;
  if (PACK_SPRITES.has(key)) return PACK_SPRITES.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.ceil(size * scale);
  canvas.logicalSize = size;
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.filter = filter;
  const [fx, fy, fw, fh] = packFrame(group, cell);
  const w = atlas.img.naturalWidth * fw, h = atlas.img.naturalHeight * fh;
  const fit = group === 'terrain' ? null : Math.min(canvas.width / w, canvas.height / h);
  const dw = fit ? w * fit : canvas.width, dh = fit ? h * fit : canvas.height;
  // 半像素內縮避免縮小取樣時混到隔壁格的色邊。
  g.drawImage(atlas.img, atlas.img.naturalWidth * fx + 0.5, atlas.img.naturalHeight * fy + 0.5,
    w - 1, h - 1, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
  g.filter = 'none';
  if (mute) { g.fillStyle = '#08152338'; g.fillRect(0, 0, canvas.width, canvas.height); }
  PACK_SPRITES.set(key, canvas);
  return canvas;
}

function packItemFilter(id) {
  if (/^(gold|flame)_/.test(id)) return 'sepia(0.8) saturate(1.8) hue-rotate(345deg)';
  if (/^(copper|wood)_/.test(id)) return 'sepia(0.75) saturate(1.1)';
  if (/^void_/.test(id)) return 'hue-rotate(65deg)';
  return 'none';
}

function packItemSprite(id, size) {
  if (PACK_INFRASTRUCTURE[id] !== undefined) return packSprite('infrastructure', PACK_INFRASTRUCTURE[id], size);
  if (PACK_INTERIORS[id] !== undefined) return packSprite('interiors', PACK_INTERIORS[id], size);
  if (PACK_SUPPLIES[id] !== undefined) return packSprite('supplies', PACK_SUPPLIES[id], size);
  return packSprite('equipment', PACK_ITEMS[id], size, packItemFilter(id || ''));
}

function packIconHTML(group, cell, filter = 'none') {
  if (texturePackId !== 'ruins' || cell === undefined || !packAtlas(group).ready) return '';
  const [x, y, w, h] = packFrame(group, cell), longest = Math.max(w, h);
  const dw = w / longest * 100, dh = h / longest * 100;
  return `<span class="pack-icon" aria-hidden="true" style="filter:${filter}"><span class="pack-sprite" style="width:${dw}%;height:${dh}%;left:${(100-dw)/2}%;top:${(100-dh)/2}%;background-image:url('assets/packs/ruins/${group}.png');background-size:${100/w}% ${100/h}%;background-position:${x/(1-w)*100}% ${y/(1-h)*100}%"></span></span>`;
}

function itemIconHTML(id) {
  if (!id || !ITEMS[id]) return '';
  if (PACK_INFRASTRUCTURE[id] !== undefined) return packIconHTML('infrastructure', PACK_INFRASTRUCTURE[id]) || ITEMS[id].icon;
  if (PACK_INTERIORS[id] !== undefined) return packIconHTML('interiors', PACK_INTERIORS[id]) || ITEMS[id].icon;
  return (PACK_SUPPLIES[id] !== undefined ? packIconHTML('supplies', PACK_SUPPLIES[id]) :
    packIconHTML('equipment', PACK_ITEMS[id], packItemFilter(id))) || ITEMS[id].icon;
}

function texturePackControl(id) {
  const failed = texturePackId === 'ruins' && [...PACK_ATLASES.values()].some(a => a.failed);
  return `<div class="texture-control"><label for="${id}">材質包</label>
    <select id="${id}">${Object.entries(TEXTURE_PACKS).map(([key, pack]) =>
      `<option value="${key}"${key === texturePackId ? ' selected' : ''}>${pack.name}</option>`).join('')}</select>
    <small>${failed ? '部分素材載入失敗，已使用原版替代。' : TEXTURE_PACKS[texturePackId].description}</small></div>`;
}

preloadTexturePack();
