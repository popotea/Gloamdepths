// 驗證純視覺狀態的時間與位移行為,不需啟動伺服器。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const preference = { matches: false };
const sandbox = vm.createContext({ matchMedia: () => preference });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/animation.js'), 'utf8') +
  '\nglobalThis.api = { entityMotion, motionDirection, weaponMotion };', sandbox);
const { entityMotion, motionDirection, weaponMotion } = sandbox.api;
const makePlayer = () => ({ id: 1, x: 0, y: 0, hp: 100, aim: 0, swing: 0, dashT: 0 });

// 相同距離不因繪製頻率改變步伐進度。
const phases = [30, 60, 144].map(fps => {
  const p = makePlayer(); let motion = entityMotion(p, 0, true);
  for (let i = 0; i < fps * 2; i++) { p.x += 4.6 / fps; motion = entityMotion(p, 1 / fps, true); }
  assert.equal(motion.facing, 1);
  return motion.phase;
});
assert.ok(Math.max(...phases) - Math.min(...phases) < 1e-9);

const p = makePlayer(); let motion = entityMotion(p, 0, true);
for (let i = 0; i < 15; i++) { p.x += 0.08; motion = entityMotion(p, 1 / 60, true); }
const stoppedPhase = motion.phase;
for (let i = 0; i < 20; i++) motion = entityMotion(p, 1 / 60, true);
assert.equal(motion.phase, stoppedPhase);
assert.equal(motion.frame, 1);
assert.equal(motion.dash, false);

// 暫停不推進呼吸、受擊與殘影計時。
const frozen = JSON.stringify(motion);
entityMotion(p, 0, true);
assert.equal(JSON.stringify(motion), frozen);

// 扣血觸發短暫受擊,回血不重播;動畫讀取不污染實體/存檔。
p.hp -= 10;
const before = JSON.stringify(p);
motion = entityMotion(p, 1 / 60, true);
assert.equal(JSON.stringify(p), before);
assert.equal(motion.hurt, 0.18);
for (let i = 0; i < 20; i++) entityMotion(p, 1 / 60, true);
p.hp += 5;
assert.equal(entityMotion(p, 1 / 60, true).hurt, 0);

// 衝刺殘影數量有硬上限,傳送與坐車時清空;停止後自行消失。
p.dashT = 1;
for (let i = 0; i < 30; i++) { p.x += 0.25; motion = entityMotion(p, 1 / 60, true); }
assert.equal(motion.dash, true);
assert.ok(motion.trails.length > 0 && motion.trails.length <= 5);
p.x += 40;
motion = entityMotion(p, 1 / 60, true);
assert.equal(motion.trails.length, 0);
assert.equal(motion.dash, false);
p.x += 0.25; entityMotion(p, 1 / 60, true);
p.riding = 1; motion = entityMotion(p, 1 / 60, true);
assert.equal(motion.trails.length, 0);
delete p.riding;
p.dashT = 0;
for (let i = 0; i < 20; i++) entityMotion(p, 1 / 60, true);
assert.equal(motion.trails.length, 0);

// 系統偏好減少動態時不產生殘影。
preference.matches = true; p.dashT = 1;
for (let i = 0; i < 10; i++) { p.x += 0.25; motion = entityMotion(p, 1 / 60, true); }
assert.equal(motion.trails.length, 0);
preference.matches = false;

assert.deepEqual([Math.PI/2, 0, -Math.PI/2, Math.PI].map(motionDirection), [0, 1, 2, 3]);
// 斜向瞄準的小抖動不造成不停切換方向。
const q = makePlayer(); q.aim = 0; entityMotion(q, 0, true);
for (let i = 0; i < 10; i++) {
  q.aim = Math.PI / 4 + (i % 2 ? 0.03 : -0.03);
  assert.equal(entityMotion(q, 1 / 60, true).facing, 1);
}
q.aim = Math.PI / 2;
assert.equal(entityMotion(q, 1 / 60, true).facing, 0);

// 弓弩後座不畫近戰揮砍,挖礦不誤用目前選取的遠程武器動畫。
q.swing = 0.18; q.action = 'atk';
assert.equal(weaponMotion(q, { ranged: true }, 14).ranged, true);
q.action = 'mine'; q.swing = 0.2;
assert.equal(weaponMotion(q, { ranged: true }, 14).ranged, false);
q.action = 'atk'; q.swing = 0.22;
const start = weaponMotion(q, {}, 14);
q.swing = 0.04;
const end = weaponMotion(q, {}, 14);
assert.ok(end.angle > start.angle);
assert.ok(Number.isFinite(end.reach));
console.log('Animation checks passed: cadence, stop, pause, damage, isolation, dash, teleport, reduced motion, direction, weapon poses.');
