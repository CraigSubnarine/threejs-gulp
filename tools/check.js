// Checks Gulp!'s rules in Node (no browser). Run from this game's folder: node tools/check.js   -> exits 1 on failure
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Load the plain scripts the way the page does: in order, sharing globals.
for (const f of ['data.js', 'rules.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), { filename: f });
const names = ['ZONES', 'METER_NEED', 'SCORE', 'COMBO_MAX', 'COMBO_GAP', 'TUNING', 'SKILLS', 'COMBOS', 'CLASSES', 'VARIANTS', 'VARIANT_CHANCE', 'LEVELS_PER_ZONE', 'FISH_LEN', 'LEVEL_SCALE',
  'canEat', 'tierFor', 'scoreFor', 'speedAt', 'makeSpawner', 'hashSeed', 'levelInfo', 'nodeId', 'nodeCost', 'canBuy', 'combosFor', 'computeStats', 'classUnlocked'];
const G = Object.fromEntries(names.map(n => [n, vm.runInThisContext(n)]));
const { ZONES, METER_NEED, SCORE, COMBO_MAX, COMBO_GAP, TUNING, SKILLS, COMBOS, CLASSES, VARIANTS, VARIANT_CHANCE, LEVELS_PER_ZONE, FISH_LEN, LEVEL_SCALE,
  canEat, tierFor, scoreFor, speedAt, makeSpawner, hashSeed, levelInfo, nodeId, nodeCost, canBuy, combosFor, computeStats, classUnlocked } = G;

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed++;
};

// ---------- Who eats whom ----------
check('a bigger tier eats a smaller one', canEat({ tier: 2 }, { tier: 1 }) && canEat({ tier: 3 }, { tier: 0 }));
check('a smaller tier never eats a bigger one', !canEat({ tier: 1 }, { tier: 2 }));
check('the same tier just bumps', !canEat({ tier: 2 }, { tier: 2 }));

// ---------- Growth and size ----------
check('you start at tier 1', tierFor(0) === 1);
check('tier 2 at a third of the meter', tierFor(METER_NEED / 3 - 0.01) === 1 && tierFor(METER_NEED / 3) === 2);
check('tier 3 at two thirds', tierFor(METER_NEED * 2 / 3 - 0.01) === 2 && tierFor(METER_NEED * 2 / 3) === 3 && tierFor(METER_NEED) === 3);
check('a full-grown you is exactly a tier-1 fish one level on', Math.abs(FISH_LEN[3] / LEVEL_SCALE - FISH_LEN[1]) < 1e-9);

// ---------- Score ----------
check('a combo multiplies the points', scoreFor(1, 3) === SCORE[1] * 3 && scoreFor(2, 1) === SCORE[2]);
check('the combo is capped', scoreFor(0, 99) === SCORE[0] * COMBO_MAX && scoreFor(0, 0) === SCORE[0]);
check('fish get faster each level', speedAt(1) === 1 && speedAt(3) > speedAt(2));

// ---------- Zones and levels ----------
for (const z of ZONES) {
  const tiers = new Set(z.fish.filter(f => f.behavior !== 'puff').map(f => f.tier));
  check(`${z.name}: has a fish in every tier 0-3`, [0, 1, 2, 3].every(t => tiers.has(t)));
  check(`${z.name}: at least 7 species`, z.fish.length >= 7, String(z.fish.length));
  check(`${z.name}: species keys are unique`, new Set(z.fish.map(f => f.key)).size === z.fish.length);
  check(`${z.name}: ${LEVELS_PER_ZONE} levels, each with its own name and landmark`, z.levels.length === LEVELS_PER_ZONE
    && new Set(z.levels.map(l => l.name)).size === LEVELS_PER_ZONE && new Set(z.levels.map(l => l.landmark)).size === LEVELS_PER_ZONE);
  const keys = new Set(z.fish.map(f => f.key)), bad = z.levels.flatMap(l => Object.keys(l.mix ?? {}).filter(k => !keys.has(k)));
  check(`${z.name}: level fish mixes only name the zone's fish`, !bad.length, bad.join());
}
const l1 = levelInfo(1), l5 = levelInfo(5), l6 = levelInfo(6);
check('levels 1-5 are the first zone in order, level 6 starts the next zone', l1.index === 0 && l5.index === 4 && l5.zone === ZONES[0] && l6.index === 0
  && (ZONES.length > 1 ? l6.zone === ZONES[1] : l6.loop === 1));

// ---------- Spawner ----------
const reef = ZONES[0];
const run = seed => { const s = makeSpawner(seed, reef, reef.levels[0]); return Array.from({ length: 300 }, (_, i) => s.next(1 + (i % 3))); };
const a = run(hashSeed('test')), b = run(hashSeed('test')), c = run(hashSeed('other'));
const sig = list => list.map(x => `${x.species.key}${x.fromLeft ? 'L' : 'R'}${x.y.toFixed(3)}${x.count}${x.variant}`).join();
check('the same seed gives the same spawns (and variants)', sig(a) === sig(b));
check('a different seed gives different spawns', sig(a) !== sig(c));
for (const tier of [1, 2, 3]) {
  const s = makeSpawner(1, reef), list = Array.from({ length: 3000 }, () => s.next(tier));
  const share = list.filter(x => x.species.tier < tier && x.species.behavior !== 'puff').length / list.length;
  check(`at tier ${tier}, about ${TUNING.edibleShare * 100}% of spawns are food`, Math.abs(share - TUNING.edibleShare) < 0.05, share.toFixed(2));
}
check('schools come in groups', a.filter(x => x.species.group && !x.variant).every(x => x.count >= x.species.group[0] && x.count <= x.species.group[1]));
{
  const s = makeSpawner(5, reef), list = Array.from({ length: 5000 }, () => s.next(2));
  const share = list.filter(x => x.variant).length / list.length, kinds = new Set(list.map(x => x.variant).filter(Boolean));
  check(`about ${VARIANT_CHANCE * 100}% of spawns are rare variants, of every kind`, Math.abs(share - VARIANT_CHANCE * 0.92) < 0.025 && kinds.size === Object.keys(VARIANTS).length, `${share.toFixed(3)} ${[...kinds]}`);
  check('puffers and tier-3 fish never get spiny/speedy', list.every(x => !x.variant || (x.species.behavior !== 'puff' && (x.species.tier < 3 || ['golden', 'giant'].includes(x.variant)))));
  const s2 = makeSpawner(5, reef), more = Array.from({ length: 5000 }, () => s2.next(2, 2.5)).filter(x => x.variant).length / 5000;
  check('Treasure Nose makes rare fish more common', more > share * 2, more.toFixed(3));
  const sand = makeSpawner(9, reef, reef.levels[1]), garden = makeSpawner(9, reef, reef.levels[0]);
  const gobies = sp => Array.from({ length: 3000 }, () => sp.next(1)).filter(x => x.species.key === 'goby').length;
  check('a level\'s fish mix changes what shows up (more gobies in the Sandy Shallows)', gobies(sand) > gobies(garden) * 1.3);
}

// ---------- Skill tree ----------
check('3 branches of 5 nodes', SKILLS.length === 3 && SKILLS.every(b => b.nodes.length === 5));
check('node n costs n points; everything costs 45', nodeCost(0) === 1 && nodeCost(4) === 5 && SKILLS.length * [0, 1, 2, 3, 4].reduce((t, i) => t + nodeCost(i), 0) === 45);
check('the first node of a branch is buyable with 1 point', canBuy([], 'fins', 0, 1) && !canBuy([], 'fins', 0, 0));
check('a node needs the one before it', !canBuy([], 'jaws', 1, 9) && canBuy(['jaws1'], 'jaws', 1, 2));
check('you can\'t buy a node twice', !canBuy(['scales1'], 'scales', 0, 9));
check('every combo names real nodes from two branches', COMBOS.every(c => c.needs.length === 2 && c.needs.every(id => SKILLS.some(b => id.startsWith(b.key) && Number(id.slice(b.key.length)) <= 5))
  && new Set(c.needs.map(id => id.replace(/\d/g, ''))).size === 2));
const base = computeStats('scamp', []);
check('a Scamp with no skills has the base stats', base.speed === 1 && base.reach === 1 && base.shields === 0 && base.comboGap === COMBO_GAP && base.comboMax === COMBO_MAX && !base.torpedo);
const built = computeStats('scamp', ['fins1', 'fins2', 'jaws1', 'jaws2', 'jaws3', 'scales1', 'scales2', 'scales3', 'fins3', 'fins4', 'fins5']);
check('skills stack from scratch', Math.abs(built.speed - 1.12) < 1e-9 && Math.abs(built.boostRecharge - 0.7) < 1e-9 && built.comboGap === COMBO_GAP + 1 && built.comboMax === COMBO_MAX + 4 && built.shields === 1 && built.torpedo);
check('combos switch on when both nodes are owned', built.combos.frenzyFuel && built.combos.ghost && built.combos.sharkSkin && !built.combos.hoarder);
check('the same nodes in any order give the same stats', JSON.stringify(computeStats('dart', ['jaws1', 'fins1'])) === JSON.stringify(computeStats('dart', ['fins1', 'jaws1'])));

// ---------- Classes ----------
check('4 classes, only the first open at the start', CLASSES.length === 4 && CLASSES.filter(c => classUnlocked(c, { bestLevel: 0, bestScore: 0 })).length === 1);
const dart = CLASSES.find(c => c.key === 'dart'), puffy = CLASSES.find(c => c.key === 'puffy'), gob = CLASSES.find(c => c.key === 'gobbler');
check('Dart opens at level 3, Puffy at level 6, Gobbler at 20,000 points', !classUnlocked(dart, { bestLevel: 2, bestScore: 0 }) && classUnlocked(dart, { bestLevel: 3, bestScore: 0 })
  && classUnlocked(puffy, { bestLevel: 6, bestScore: 0 }) && !classUnlocked(gob, { bestLevel: 99, bestScore: 19999 }) && classUnlocked(gob, { bestLevel: 0, bestScore: 20000 }));
check('classes change your stats', computeStats('dart', []).speed === 1.2 && computeStats('puffy', []).shields === 1 && computeStats('gobbler', []).reach === 1.25);
check('every class\'s free node is a real first node', CLASSES.every(c => !c.free || SKILLS.some(b => c.free === nodeId(b.key, 0))));

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
