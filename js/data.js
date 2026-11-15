// Gulp! data: the sea, the fish and the tuning numbers. Plain script (globals), so tools/check.js can load it in Node.

// The world is a flat plane at z = 0 (side view): x runs left-right, y up (surface) and down (sea floor).
const WORLD = { x: 2200, y: 1400 };   // half-width and half-height
const VIEW_H = [0, 1280, 1650, 2100]; // how much of the plane the camera shows (height) at your tier 1, 2, 3
// tilt: degrees the camera looks down on the sea; sway: degrees it swings round as you swim sideways;
// lead: seconds of your movement it looks ahead.
const CAMERA = { tilt: 22, sway: 8, lead: 0.25 };
const FISH_LEN = [40, 70, 120, 200];  // body length per tier; you share the length of the tier you're at
const GROW = [1, 3, 6];               // meter gained for eating a fish of tier 0 / 1 / 2
const METER_NEED = 60;                // a full meter clears the zone; you grow a tier at 1/3 and 2/3
const SCORE = [10, 30, 80, 200];      // points for eating a fish of each tier, before the combo
const COMBO_GAP = 1.5;                // seconds between eats that keeps a combo going
const COMBO_MAX = 8;
const CLEAR_BONUS = 1000;             // per depth, when a zone's meter fills
const SHAPE_R = { oval: 0.3, disc: 0.36, fat: 0.33, long: 0.2, round: 0.38 }; // touch radius, as a share of length

const PLAYER = {
  speed: 380,       // units per second at full stick
  turn: 7,          // how quickly velocity catches up with the stick (per second)
  body: 0xff7a2f, belly: 0xffe0b0, fin: 0xff4d4d, stripe: 0xffffff, shape: 'oval', stripes: [0.18],
  safe: 2,          // seconds nothing can eat you at the start of a zone
};

// The boost button: a burst of speed, then it has to recharge.
const BOOST = { speed: 2.3, time: 0.55, recharge: 4 }; // × your speed, seconds it lasts, seconds to recharge

const TUNING = {
  population: 26,   // fish alive around you at once
  spawnEvery: 0.35, // seconds between spawns while below the population
  edibleShare: 0.6, // share of spawns you can eat
  fleeRange: 260,   // prey this close to a bigger you swim away
  chaseRange: 340,  // hunters bigger than you this close give chase
  chaseTime: 4,     // seconds a hunter chases before giving up
  chaseRest: 3,     // seconds before it can chase again
  chaseSpeed: 0.78, // a hunter's top chase speed, as a share of your base speed
  harder: 0.1,      // each depth: fish +10% faster
};

// shape: oval | disc (tall, flat) | fat (big head) | long (thin) | round (puffer)
// behavior: cruise (swims across) | school (comes in a group) | skittish (flees a bigger you) | hunter (chases a smaller you) | puff
const ZONES = [
  {
    key: 'reef', name: 'Sunny Reef', sub: 'Warm, shallow and full of snacks',
    water: { top: 0x8be3f2, bottom: 0x1d86b0, fog: 0x4cbfdc }, sun: 1.9, sky: 0xd8f8ff, ground: 0x3a8fa8,
    floor: 0xf2d9a0,
    fish: [
      { key: 'minnow', name: 'Minnow', tier: 0, shape: 'oval', body: 0x9fd8ff, belly: 0xf4fbff, fin: 0x7fc0ef, speed: 130, behavior: 'school', group: [4, 7], weight: 3 },
      { key: 'butterfly', name: 'Butterflyfish', tier: 1, shape: 'disc', body: 0xffd23b, belly: 0xfff2b0, fin: 0xffb000, stripe: 0x2b2b38, stripes: [0.05], speed: 110, behavior: 'skittish', weight: 3 },
      { key: 'parrot', name: 'Parrotfish', tier: 2, shape: 'oval', body: 0x2ec9b5, belly: 0xa6f2e0, fin: 0xff6fb0, stripe: 0xff6fb0, stripes: [-0.2, 0.25], speed: 140, behavior: 'skittish', weight: 2 },
      { key: 'grouper', name: 'Grouper', tier: 3, shape: 'fat', body: 0x8a6a3a, belly: 0xd9c08a, fin: 0x6b4f28, stripe: 0x5a4220, stripes: [-0.3, 0, 0.3], speed: 90, behavior: 'hunter', weight: 1.5 },
      { key: 'puffer', name: 'Pufferfish', tier: 1, shape: 'round', body: 0xe8c34a, belly: 0xfff4c8, fin: 0xd09a20, stripe: 0x8a6a20, stripes: [0], speed: 70, behavior: 'puff', weight: 0.8, puffTo: 3 },
    ],
  },
];
