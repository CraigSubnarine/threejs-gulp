// Checks Gulp!'s rules in Node (no browser). Run from this game's folder: node tools/check.js   -> exits 1 on failure
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Load the plain scripts the way the page does: in order, sharing globals.
for (const f of ['data.js', 'rules.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), { filename: f });
const G = name => vm.runInThisContext(name);
const [ZONES, METER_NEED, SCORE, COMBO_MAX, TUNING, canEat, tierFor, scoreFor, speedAt, makeSpawner, hashSeed] =
  ['ZONES', 'METER_NEED', 'SCORE', 'COMBO_MAX', 'TUNING', 'canEat', 'tierFor', 'scoreFor', 'speedAt', 'makeSpawner', 'hashSeed'].map(G);

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed++;
};

// ---------- Who eats whom ----------
check('a bigger tier eats a smaller one', canEat({ tier: 2 }, { tier: 1 }) && canEat({ tier: 3 }, { tier: 0 }));
check('a smaller tier never eats a bigger one', !canEat({ tier: 1 }, { tier: 2 }));
check('the same tier just bumps', !canEat({ tier: 2 }, { tier: 2 }));

// ---------- Growth ----------
check('you start at tier 1', tierFor(0) === 1);
check('tier 2 at a third of the meter', tierFor(METER_NEED / 3 - 0.01) === 1 && tierFor(METER_NEED / 3) === 2);
check('tier 3 at two thirds', tierFor(METER_NEED * 2 / 3 - 0.01) === 2 && tierFor(METER_NEED * 2 / 3) === 3 && tierFor(METER_NEED) === 3);

// ---------- Score ----------
check('a combo multiplies the points', scoreFor(1, 3) === SCORE[1] * 3 && scoreFor(2, 1) === SCORE[2]);
check('the combo is capped', scoreFor(0, 99) === SCORE[0] * COMBO_MAX && scoreFor(0, 0) === SCORE[0]);
check('fish get faster with depth', speedAt(1) === 1 && speedAt(3) > speedAt(2));

// ---------- Zones ----------
for (const z of ZONES) {
  const tiers = new Set(z.fish.filter(f => f.behavior !== 'puff').map(f => f.tier));
  check(`${z.name}: has a fish in every tier 0-3`, [0, 1, 2, 3].every(t => tiers.has(t)));
  check(`${z.name}: species keys are unique`, new Set(z.fish.map(f => f.key)).size === z.fish.length);
}

// ---------- Spawner ----------
const reef = ZONES[0];
const run = seed => { const s = makeSpawner(seed, reef); return Array.from({ length: 200 }, (_, i) => s.next(1 + (i % 3))); };
const a = run(hashSeed('test')), b = run(hashSeed('test')), c = run(hashSeed('other'));
const sig = list => list.map(x => `${x.species.key}${x.fromLeft ? 'L' : 'R'}${x.y.toFixed(3)}${x.count}`).join();
check('the same seed gives the same spawns', sig(a) === sig(b));
check('a different seed gives different spawns', sig(a) !== sig(c));
for (const tier of [1, 2, 3]) {
  const s = makeSpawner(1, reef), list = Array.from({ length: 2000 }, () => s.next(tier));
  const share = list.filter(x => x.species.tier < tier && x.species.behavior !== 'puff').length / list.length;
  check(`at tier ${tier}, about ${TUNING.edibleShare * 100}% of spawns are food`, Math.abs(share - TUNING.edibleShare) < 0.05, share.toFixed(2));
}
check('schools come in groups', a.filter(x => x.species.group).every(x => x.count >= x.species.group[0] && x.count <= x.species.group[1]));

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
