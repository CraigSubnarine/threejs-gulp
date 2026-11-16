// Checks Gulp!'s rules in Node (no browser). Run from this game's folder: node tools/check.js   -> exits 1 on failure
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Load the plain scripts the way the page does: in order, sharing globals.
for (const f of ['data.js', 'rules.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), { filename: f });
const names = ['ZONES', 'METER_NEED', 'GROW', 'COMBO_MAX', 'COMBO_GAP', 'TUNING', 'SKILLS', 'COMBOS', 'CLASSES', 'VARIANTS', 'VARIANT_CHANCE', 'LEVELS_PER_ZONE', 'RANKS_PER_LEVEL', 'LEVEL_SCALE',
  'fishLen', 'canEat', 'tierFor', 'pointsFor', 'scoreFor', 'speedAt', 'makeSpawner', 'levelFish', 'hashSeed', 'levelInfo', 'findNode', 'nodeCost', 'canBuy', 'combosFor', 'computeStats', 'classUnlocked'];
const G = Object.fromEntries(names.map(n => [n, vm.runInThisContext(n)]));
const { ZONES, METER_NEED, GROW, COMBO_MAX, COMBO_GAP, TUNING, SKILLS, COMBOS, CLASSES, VARIANTS, VARIANT_CHANCE, LEVELS_PER_ZONE, RANKS_PER_LEVEL, LEVEL_SCALE,
  fishLen, canEat, tierFor, pointsFor, scoreFor, speedAt, makeSpawner, levelFish, hashSeed, levelInfo, findNode, nodeCost, canBuy, combosFor, computeStats, classUnlocked } = G;

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed++;
};

// ---------- Who eats whom ----------
check('a bigger tier eats a smaller one', canEat({ tier: 2 }, { tier: 1 }) && canEat({ tier: 3 }, { tier: 0 }) && canEat({ tier: 1 }, { tier: -1 }));
check('a smaller tier never eats a bigger one', !canEat({ tier: 1 }, { tier: 2 }));
check('the same tier just bumps', !canEat({ tier: 2 }, { tier: 2 }));

// ---------- Growth and size ----------
check('you start at tier 1', tierFor(0) === 1);
check('tier 2 at a third of the meter', tierFor(METER_NEED / 3 - 0.01) === 1 && tierFor(METER_NEED / 3) === 2);
check('tier 3 at two thirds', tierFor(METER_NEED * 2 / 3 - 0.01) === 2 && tierFor(METER_NEED * 2 / 3) === 3 && tierFor(METER_NEED) === 3);
check('a full-grown you is exactly a tier-1 fish one level on', Math.abs(fishLen(3) / LEVEL_SCALE - fishLen(1)) < 1e-9 && Math.abs(fishLen(1) - 70) < 1e-9);
check('one level up the ladder is two tiers', Math.abs(fishLen(2) / LEVEL_SCALE - fishLen(0)) < 1e-9 && Math.abs(fishLen(1) / LEVEL_SCALE - fishLen(-1)) < 1e-9);
const firstGrow = Math.ceil(METER_NEED / 3 / GROW[0]);
check('early growth is quick: about 12 tiny fish to your first size-up', firstGrow <= 13, `${firstGrow} bites`);
check('bigger fish are more filling', GROW[-1] < GROW[0] && GROW[0] < GROW[1] && GROW[1] < GROW[2] && GROW[2] < GROW[3]);

// ---------- Score ----------
check('a combo multiplies the points', scoreFor(1, 3) === pointsFor(1) * 3 && scoreFor(2, 1) === pointsFor(2));
check('the combo is capped', scoreFor(0, 99) === pointsFor(0) * COMBO_MAX && scoreFor(0, 0) === pointsFor(0));
check('fish higher up the ladder are worth more', pointsFor(0) === 10 && [...Array(11).keys()].every(r => pointsFor(r + 1) > pointsFor(r)));
check('fish get faster each level', speedAt(1) === 1 && speedAt(3) > speedAt(2));

// ---------- Zones, levels and the size ladder ----------
for (const z of ZONES) {
  const top = RANKS_PER_LEVEL * (LEVELS_PER_ZONE - 1) + 3, ranks = new Set(z.fish.filter(f => !['puff', 'jelly'].includes(f.behavior)).map(f => f.rank));
  const missing = [...Array(top + 1).keys()].filter(r => !ranks.has(r));
  check(`${z.name}: has a species at every rank 0-${top}`, !missing.length, missing.join());
  check(`${z.name}: species keys are unique`, new Set(z.fish.map(f => f.key)).size === z.fish.length);
  check(`${z.name}: ${LEVELS_PER_ZONE} levels, each with its own name and landmark`, z.levels.length === LEVELS_PER_ZONE
    && new Set(z.levels.map(l => l.name)).size === LEVELS_PER_ZONE && new Set(z.levels.map(l => l.landmark)).size === LEVELS_PER_ZONE);
  const keys = new Set(z.fish.map(f => f.key)), bad = z.levels.flatMap(l => Object.keys(l.mix ?? {}).filter(k => !keys.has(k)));
  check(`${z.name}: level fish mixes only name the zone's fish`, !bad.length, bad.join());
  for (let i = 0; i < LEVELS_PER_ZONE; i++) {
    const fish = levelFish(z, i), at = t => fish.filter(f => f.tier === t && !['puff', 'jelly'].includes(f.behavior));
    check(`${z.name} level ${i + 1}: food to start on, your size, and bigger fish including a hunter`, at(0).length && at(1).length && at(2).length && at(3).length
      && fish.some(f => f.tier >= 2 && f.behavior === 'hunter') && fish.every(f => f.tier >= -1 && f.tier <= 3), fish.map(f => `${f.key}:${f.tier}`).join(' '));
    if (i === 0) continue;
    // Keep your size: what you could eat at the end of the last level (its tiers 1-2) is still here and still
    // food; and new bigger fish join on top.
    const before = levelFish(z, i - 1), still = before.filter(f => f.tier >= 1 && f.tier <= 2);
    const kept = still.every(f => fish.some(g => g.key === f.key && g.tier < 1));
    const fresh = fish.filter(g => g.tier >= 2 && !before.some(f => f.key === g.key));
    check(`${z.name} level ${i + 1}: the fish you could eat are still food, plus new bigger ones`, kept && fresh.length >= 2, `new: ${fresh.map(f => f.name).join(', ')}`);
  }
}
const l1 = levelInfo(1), l5 = levelInfo(5), l6 = levelInfo(6), w2 = levelInfo(6, 1);
check('levels 1-5 are a lap of the first world; level 6 starts the next lap', l1.index === 0 && l5.index === 4 && l5.zone === ZONES[0] && l6.index === 0 && l6.loop === 1 && l1.loop === 0);
check('without the portal, the next lap is the same world; through it, the next world', l6.zone === ZONES[0] && w2.zone === ZONES[1 % ZONES.length]);
{
  const keepCount = vm.runInThisContext('keepCount');
  check('you keep 1 skill through a portal, more with pearls, up to 3', keepCount(0) === 1 && keepCount(9) === 1 && keepCount(10) === 2 && keepCount(20) === 3 && keepCount(99) === 3);
}

check('species keys are unique across every zone (each has its own model)', new Set(ZONES.flatMap(z => z.fish.map(f => f.key))).size === ZONES.reduce((n, z) => n + z.fish.length, 0));
{
  const kelp = ZONES.find(z => z.key === 'kelp');
  check('the Kelp Forest is world 2, behind the portal', kelp && levelInfo(6, 1).zone === kelp && levelInfo(1, 0).zone === ZONES[0]);
  check('the Kelp Forest has jellyfish in every level, never as food', kelp && [0, 1, 2, 3, 4].every(i => levelFish(kelp, i).some(f => f.behavior === 'jelly'))
    && [1, 2, 3].every(t => { const s = makeSpawner(4, kelp, kelp.levels[0], 0); return Array.from({ length: 2000 }, () => s.next(t)).every(x => x.species.behavior !== 'jelly' || !x.variant); }));
  check('every level of every zone has swaying kelp or not, as it says', ZONES.every(z => z.levels.every(l => l.kelp === undefined || l.kelp >= 0)));
}

// ---------- Spawner ----------
const reef = ZONES[0];
const run = seed => { const s = makeSpawner(seed, reef, reef.levels[0]); return Array.from({ length: 300 }, (_, i) => s.next(1 + (i % 3))); };
const a = run(hashSeed('test')), b = run(hashSeed('test')), c = run(hashSeed('other'));
const sig = list => list.map(x => `${x.species.key}${x.fromLeft ? 'L' : 'R'}${x.y.toFixed(3)}${x.count}${x.variant}`).join();
check('the same seed gives the same spawns (and variants)', sig(a) === sig(b));
check('a different seed gives different spawns', sig(a) !== sig(c));
for (const tier of [1, 2, 3]) {
  const s = makeSpawner(1, reef), list = Array.from({ length: 3000 }, () => s.next(tier)), want = tier <= 1 ? TUNING.edibleSmall : TUNING.edibleShare;
  const share = list.filter(x => x.species.tier < tier && !['puff', 'jelly'].includes(x.species.behavior)).length / list.length;
  check(`at tier ${tier}, about ${Math.round(want * 100)}% of spawns are food`, Math.abs(share - want) < 0.05, share.toFixed(2));
}
{
  const s = makeSpawner(3, reef, reef.levels[2], 2), list = Array.from({ length: 2000 }, () => s.next(1));
  check('a level only spawns its window of the ladder (level 3: ranks 3-7, tiers -1 to 3)', list.every(x => x.species.rank >= 3 && x.species.rank <= 7 && x.species.tier === x.species.rank - 4));
}
check('schools come in groups', a.filter(x => x.species.group && !x.variant).every(x => x.count >= x.species.group[0] && x.count <= x.species.group[1]));
{
  const s = makeSpawner(5, reef), list = Array.from({ length: 5000 }, () => s.next(2));
  const share = list.filter(x => x.variant).length / list.length, kinds = new Set(list.map(x => x.variant).filter(Boolean));
  check(`about ${VARIANT_CHANCE * 100}% of spawns are rare variants, of every kind`, Math.abs(share - VARIANT_CHANCE * 0.92) < 0.025 && kinds.size === Object.keys(VARIANTS).length, `${share.toFixed(3)} ${[...kinds]}`);
  check('puffers and tier-3 fish never get spiny/speedy', list.every(x => !x.variant || (x.species.behavior !== 'puff' && (x.species.tier < 3 || ['golden', 'giant'].includes(x.variant)))));
  const s2 = makeSpawner(5, reef), more = Array.from({ length: 5000 }, () => s2.next(2, 2.5)).filter(x => x.variant).length / 5000;
  check('Treasure Nose makes rare fish more common', more > share * 2, more.toFixed(3));
  const jacks = sp => Array.from({ length: 3000 }, () => sp.next(1)).filter(x => x.species.key === 'jack').length;
  check('a level\'s fish mix changes what shows up (more jacks in the Sandy Shallows)', jacks(makeSpawner(9, reef, reef.levels[1], 1)) > jacks(makeSpawner(9, reef, {}, 1)) * 1.3);
}

// ---------- Apex predators ----------
{
  const [APEX, APEX_ATTACKS, apexContact, apexPhase, apexHp] = ['APEX', 'APEX_ATTACKS', 'apexContact', 'apexPhase', 'apexHp'].map(n => vm.runInThisContext(n));
  for (const z of ZONES) {
    const a = z.apex;
    check(`${z.name}: has an apex with health, a taunt per moment and known attacks`, a && a.hp > 0 && a.intro && a.rage && a.defeat && a.phases.length >= 2
      && a.phases.every(p => p.length && p.every(k => APEX_ATTACKS.includes(k))));
  }
  // An apex at (0, 0), 500 long, facing right: its tail is at x = -250, its head at x = 250.
  const touch = (px, py) => apexContact(0, 0, 1, 0, 500, 50, px, py, 20);
  check('touching its tail end is a bite on the apex', touch(-260, 0) === 'tail' && touch(-100, 60) === 'tail');
  check('touching its front is its jaws', touch(200, 0) === 'head' && touch(265, 10) === 'head');
  check('the jaws start at the front 40% of the body', touch(-250 + 500 * APEX.headShare - 5, 0) === 'tail' && touch(-250 + 500 * APEX.headShare + 5, 0) === 'head');
  check('away from its body there is no contact', touch(0, 200) === null && touch(-400, 0) === null && touch(400, 0) === null);
  check('facing the other way swaps tail and jaws', apexContact(0, 0, -1, 0, 500, 50, 200, 0, 20) === 'tail' && apexContact(0, 0, -1, 0, 500, 50, -200, 0, 20) === 'head');
  const diag = Math.SQRT1_2;
  check('it works at an angle too', apexContact(0, 0, diag, diag, 500, 50, 150, 150, 20) === 'head' && apexContact(0, 0, diag, diag, 500, 50, -150, -150, 20) === 'tail');
  check('2 phases: the second starts at half health', apexPhase(6, 6, 2) === 0 && apexPhase(4, 6, 2) === 0 && apexPhase(3, 6, 2) === 1 && apexPhase(0, 6, 2) === 1);
  check('3 phases split the bar in thirds', apexPhase(7, 9, 3) === 0 && apexPhase(6, 9, 3) === 1 && apexPhase(3, 9, 3) === 2);
  check('apexes get tougher each time round', apexHp({ hp: 6 }, 0) === 6 && apexHp({ hp: 6 }, 1) === 9);
}

// ---------- Obstacles ----------
{
  const [pushOut, WORLD, OBSTACLES] = ['pushOut', 'WORLD', 'OBSTACLES'].map(n => vm.runInThisContext(n));
  check('the sea is at least 3× wider than it was (2200 half-width)', WORLD.x >= 6600);
  const rocks = [{ x: 0, y: 0, r: 100 }, { x: 150, y: 0, r: 60 }];
  let worst = Infinity;
  const rnd = vm.runInThisContext('mulberry32')(42);
  for (let i = 0; i < 5000; i++) { // drop things all over the rocks: none may stay inside one
    const e = { x: rnd() * 500 - 250, y: rnd() * 400 - 200, vx: 0, vy: 0 }, r = 20;
    pushOut(e, r, rocks);
    worst = Math.min(worst, ...rocks.map(c => Math.hypot(e.x - c.x, e.y - c.y) - (c.r + r)));
  }
  check('pushOut never leaves anything overlapping a rock', worst > -1, worst.toFixed(2));
  const e = { x: -110, y: 0, vx: 300, vy: 50 };
  const hit = pushOut(e, 20, rocks);
  check('swimming into a rock stops you going in, but you slide along it', hit && e.vx <= 0.001 && e.vy === 50 && e.x <= -120 + 1e-9, JSON.stringify(e));
  const far = { x: 400, y: 400, vx: 1, vy: 1 };
  check('away from rocks nothing changes', !pushOut(far, 20, rocks) && far.x === 400 && far.vx === 1);
  check('obstacles leave room where you start', OBSTACLES.clear >= 1000 && OBSTACLES.count >= 10);
}

// ---------- Oysters, pearls and power-ups ----------
{
  const [OYSTER, PICKUPS, PEARLS_PER_POINT, oysterPhase, pearlPoints, pearlCount, rollPickup, mulberry32] = ['OYSTER', 'PICKUPS', 'PEARLS_PER_POINT', 'oysterPhase', 'pearlPoints', 'pearlCount', 'rollPickup', 'mulberry32'].map(n => vm.runInThisContext(n));
  const o = OYSTER, open0 = o.closed, tell0 = o.closed + o.open, snap0 = tell0 + o.tell, cycle = snap0 + o.snap;
  check('an oyster starts closed, opens, shivers, then snaps', oysterPhase(0) === 'closed' && oysterPhase(open0 - 0.01) === 'closed' && oysterPhase(open0 + 0.01) === 'open'
    && oysterPhase(tell0 - 0.01) === 'open' && oysterPhase(tell0 + 0.01) === 'tell' && oysterPhase(snap0 + 0.01) === 'snap' && oysterPhase(cycle + 0.01) === 'closed');
  check('the shiver gives you a fair warning before the snap', o.tell >= 0.5);
  check('Pearl Diver keeps oysters open longer', oysterPhase(tell0 + 0.5, 1.5) === 'open' && oysterPhase(tell0 + 0.5) === 'tell');
  check('a black pearl is worth more than a white one, and counts more', pearlPoints(true, 2) > pearlPoints(false, 2) && pearlPoints(false, 3) === o.white * 3 && pearlCount(true) > pearlCount(false));
  check('pearls add up to bonus skill points', PEARLS_PER_POINT >= 3 && PEARLS_PER_POINT <= 8);
  const roll = seed => { const r = mulberry32(seed); return Array.from({ length: 400 }, () => rollPickup(r)); };
  const p1 = roll(7), kinds = new Set(p1);
  check('power-ups are the same for the same seed, and every kind comes up', p1.join() === roll(7).join() && p1.join() !== roll(8).join() && kinds.size === Object.keys(PICKUPS.kinds).length, [...kinds].join());
}

// ---------- Skill tree ----------
{
  const [ROW_COST, nodeOpen, skillName] = ['ROW_COST', 'nodeOpen', 'skillName'].map(n => vm.runInThisContext(n));
  const all = SKILLS.flatMap(b => b.nodes), ids = all.map(n => n.id);
  check('3 branches of about 10 nodes, every id unique', SKILLS.length === 3 && SKILLS.every(b => b.nodes.length >= 9 && b.nodes.length <= 12) && new Set(ids).size === ids.length);
  check('each branch has one top node that needs nothing; every other needs nodes in its own branch, one row up', SKILLS.every(b => b.nodes.filter(n => !n.needs.length).length === 1
    && b.nodes.every(n => n.needs.every(id => { const m = b.nodes.find(k => k.id === id); return m && m.row === n.row - 1; }))));
  check('paths split and join again (some nodes have two ways in)', SKILLS.every(b => b.nodes.some(n => n.needs.length === 2)));
  check('no two nodes share a spot, and they fit the 3-column grid', SKILLS.every(b => new Set(b.nodes.map(n => `${n.row}/${n.col}`)).size === b.nodes.length && b.nodes.every(n => [-1, 0, 1].includes(n.col) && ROW_COST[n.row])));
  const cost = b => b.nodes.reduce((t, n) => t + nodeCost(n), 0), total = SKILLS.reduce((t, b) => t + cost(b), 0);
  check('a branch costs about 20+ and the whole tree 60+, against about 10 points a world', SKILLS.every(b => cost(b) >= 18) && total >= 60, `${SKILLS.map(cost)} = ${total}`);
  check('the top node of a branch is buyable with 1 point', canBuy([], 'fastFins', 1) && !canBuy([], 'fastFins', 0));
  check('a node needs a node joined to it above', !canBuy([], 'quickCharge', 9) && canBuy(['fastFins'], 'quickCharge', 1));
  check('where paths join, either way in works', canBuy(['fastFins', 'quickCharge'], 'longBoost', 2) && canBuy(['fastFins', 'slipstream'], 'longBoost', 2) && !canBuy(['fastFins'], 'longBoost', 9));
  check('you can\'t buy a node twice', !canBuy(['camouflage'], 'camouflage', 9));
  check('cost goes by row', nodeCost(findNode('fastFins')) === 1 && nodeCost(findNode('longBoost')) === 2 && nodeCost(findNode('torpedo')) === 4);
  check('kept skills count as owned: a skill below one you kept opens', nodeOpen(['spines'], findNode('slippery')) && skillName('spines') === 'Spines');
  check('every combo names real nodes from two branches', COMBOS.every(c => c.needs.length === 2 && c.needs.every(id => findNode(id)) && new Set(c.needs.map(id => findNode(id).branch.key)).size === 2));
  const base = computeStats('shark', []);
  check('a Shark with no skills: base speed, a slightly bigger bite, no shields', base.speed === 1 && base.reach > 1 && base.shields === 0 && base.comboGap === COMBO_GAP && base.comboMax === COMBO_MAX && !base.torpedo && base.boostCharges === 1);
  const built = computeStats('shark', ['fastFins', 'quickCharge', 'doubleDash', 'bigMouth', 'glutton', 'frenzy', 'camouflage', 'toughSkin', 'spines', 'longBoost', 'afterburn', 'torpedo']);
  check('skills stack from scratch', Math.abs(built.speed - 1.12) < 1e-9 && Math.abs(built.boostRecharge - 0.7) < 1e-9 && built.comboGap === COMBO_GAP + 1 && built.comboMax === COMBO_MAX + 4 && built.shields === 1 && built.torpedo && built.boostCharges === 2);
  check('combos switch on when both nodes are owned', built.combos.frenzyFuel && built.combos.ghost && built.combos.sharkSkin && !built.combos.hoarder);
  check('the same nodes in any order give the same stats', JSON.stringify(computeStats('barracuda', ['bigMouth', 'fastFins'])) === JSON.stringify(computeStats('barracuda', ['fastFins', 'bigMouth'])));
  check('new powers switch on', computeStats('shark', ['pearlDiver']).pearlMul === 2 && computeStats('shark', ['oysterProof']).oysterProof && computeStats('shark', ['sharpTeeth']).apexDamage === 1 && computeStats('shark', ['regrow']).regrow === 45);
}

// ---------- Classes: Shark, Barracuda, Orca, Swordfish ----------
check('4 starters, only the Shark open at the start', CLASSES.map(c => c.key).join() === 'shark,barracuda,orca,swordfish' && CLASSES.filter(c => classUnlocked(c, { bestLevel: 0, bestScore: 0 })).length === 1);
const cls = k => CLASSES.find(c => c.key === k);
check('Barracuda at level 3, Orca for beating an apex, Swordfish for opening a portal', !classUnlocked(cls('barracuda'), { bestLevel: 2 }) && classUnlocked(cls('barracuda'), { bestLevel: 3 })
  && !classUnlocked(cls('orca'), { bestLevel: 99 }) && classUnlocked(cls('orca'), { bestLevel: 0, apexBeaten: true })
  && !classUnlocked(cls('swordfish'), { bestLevel: 99, apexBeaten: true }) && classUnlocked(cls('swordfish'), { bestLevel: 0, portals: 1 }));
check('starters play differently', computeStats('barracuda', []).speed === 1.2 && computeStats('orca', []).shields === 1 && computeStats('orca', []).speed < 1 && computeStats('swordfish', []).torpedo && computeStats('swordfish', []).boostSpeed > 1);
check('every starter\'s free skill is a real top-row skill', CLASSES.every(c => !c.free || findNode(c.free)?.row === 0));

// ---------- PvP ----------
{
  const [PVP, pvpTier, eatPlayerPoints, ranking, leaderOf, pvpWinner, respawnSpot, mulberry32] = ['PVP', 'pvpTier', 'eatPlayerPoints', 'ranking', 'leaderOf', 'pvpWinner', 'respawnSpot', 'mulberry32'].map(n => vm.runInThisContext(n));
  check('PvP sizes go 1 to 5 as the meter fills', pvpTier(0) === 1 && pvpTier(PVP.perTier - 0.1) === 1 && pvpTier(PVP.perTier) === 2 && pvpTier(PVP.perTier * 4) === 5 && pvpTier(1e6) === 5);
  check('eating a bigger player is worth much more, and the leader double', eatPlayerPoints(1) < eatPlayerPoints(2) && eatPlayerPoints(3) === PVP.eatPoints * 9 && eatPlayerPoints(3, true) === eatPlayerPoints(3) * 2);
  const ps = [{ id: 'a', tier: 2, score: 900, out: false }, { id: 'b', tier: 4, score: 300, out: false }, { id: 'c', tier: 1, score: 2000, out: true, outAt: 30 }, { id: 'd', tier: 3, score: 100, out: true, outAt: 50 }];
  check('Most Points ranks by points', ranking(ps, 'points').map(p => p.id).join() === 'c,a,b,d');
  check('Last Fish Standing ranks survivors (biggest first), then the last to go out', ranking(ps, 'lfs').map(p => p.id).join() === 'b,a,d,c');
  check('the crown goes to the leader (not someone already out)', leaderOf(ps, 'lfs') === 'b' && leaderOf(ps.filter(p => !p.out), 'points') === 'a' && leaderOf([{ id: 'x', score: 0, tier: 1 }, { id: 'y', score: 0, tier: 1 }], 'points') === null);
  check('Last Fish Standing ends when one fish is left', !pvpWinner('lfs', ps) && pvpWinner('lfs', ps.map(p => ({ ...p, out: p.id !== 'b' })))[0].id === 'b');
  check('with a time limit, time up ends it: the biggest survivor wins Last Fish Standing', pvpWinner('lfs', ps, { timeUp: true })[0].id === 'b');
  check('Most Points ends at the target or when time is up', !pvpWinner('points', ps, { target: 5000 }) && pvpWinner('points', ps, { target: 2000 })[0].id === 'c' && pvpWinner('points', ps, { timeUp: true })[0].id === 'c');
  check('a match needs two fish', pvpWinner('lfs', [ps[0]]) === null);
  const me = { id: 'm', tier: 2 }, big = [{ id: 'k', tier: 4, x: 0, y: 0 }, me], rnd = mulberry32(3), spots = Array.from({ length: 20 }, () => respawnSpot(big, me, rnd));
  check('respawn spots keep away from bigger fish', spots.every(s => Math.hypot(s.x, s.y) > 1500), Math.round(Math.min(...spots.map(s => Math.hypot(s.x, s.y)))));
  check('every starter has PvP tuning, and none is faster and bigger-biting at once', CLASSES.every(c => c.pvp?.mods && c.pvp.desc) && CLASSES.every(c => !((c.pvp.mods.speed ?? 1) > 1 && (c.pvp.mods.reach ?? 1) > 1)));
  check('PvP stats use the PvP tuning', computeStats('barracuda', [], true).speed === 1.15 && computeStats('barracuda', []).speed === 1.2 && computeStats('orca', [], true).regrow === 40);
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
