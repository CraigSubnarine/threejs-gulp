# threejs-gulp

**Gulp!**: a fish-eat-fish game in three.js. You're a small fish: eat smaller fish to grow, and stay away from bigger ones. It has a 3D look with 2D gameplay: low-poly fish built in code, real lighting and underwater fog, and you swim on a flat side-view plane.

No build step and no asset files: three.js loads from a CDN through an import map, every fish and coral is built from simple 3D shapes in code, and the sounds are synthesized.

- **Play:** https://craigsubnarine.github.io/threejs-gulp/
- **Repo:** https://github.com/CraigSubnarine/threejs-gulp
- **Run locally:** the `gamedev` preview server at http://localhost:8765/threejs-gulp/ (or `node tools/server.js` from a script)
- **Controls:**
  - **Phone:** touch anywhere and drag, like a joystick. The further you drag, the faster you swim. Tap **BOOST** (bottom right) for a burst of speed. It plays upright or sideways (landscape fills the screen, with a slimmer HUD).
  - **Computer:** the fish follows the mouse, or use the arrow keys or WASD. Click or press Space to boost.
  - **Boost:** about half a second at 2.3× speed, the way you're steering. The button's ring then refills like a clock over 4 s, and it glows when it's ready (`BOOST` in `data.js`).
  - **Pause:** the top-right button, or Esc / P.
  - **Zoom:** Settings has Close / Normal / Far for how much of the sea the camera shows (`ZOOM` in `data.js`). Between levels the camera only pulls back a little (`CAMERA.widen`), then the new level eases out the rest of the way.
- **Status:** two worlds are built, the Sunny Reef and, behind its portal, the Kelp Forest. The reef has:
  - **The sea:** 5 levels in a sea 3× wider than before, with rocks to corner fish against.
  - **Things to find:** oysters with pearls, power-up bubbles, and a shard hidden in a wreck on every level.
  - **The boss:** the Giant Moray, in level 5's wreck.
  - **The portal:** with all 5 shards it opens to another world's ocean.
  - **You:** a hexagon skill tree and four starters (Shark, Barracuda, Orca, Swordfish).

  **The Kelp Forest** (world 2) has its own 5 levels and a 27-species size ladder. Kelp sways behind the play area. Jellyfish sting, and you can never eat them. The boss is the Leopard Shark, which charges across the screen. Next: the Open Sea as world 3. The full plan is in `GameDev/gulp-plan.md`.

## How it plays

- **The food chain:** every fish has a tier, from 0 (tiny fry) to 3. You start each level at tier 1. You can eat fish below your tier, fish above it eat you, and fish at your tier just bump into you.
  - The bar at the top shows each of the zone's fish: green means food, red means danger.
- **Growing:** eating fills your meter. You grow a tier at each third, and the camera pulls back so you can see more. A full meter clears the level.
- **Keeping your size (the size ladder):** every species in a zone has a size rank, from minnows (0) up to bull sharks (11). Each level shows a window of the ladder, two ranks higher than the level before.
  - When a level clears, the camera pulls back while you stay the same size. The fish you could eat at the end are still there in the next level and still food: the parrotfish you outgrew in level 1 are snacks in level 2. New bigger species join on top that you can't eat yet, and the tiniest drop out.
  - Under the hood, every level is built at the same scale. The game rescales everything by 200/70 behind the fade (one level = two ranks), so the numbers never blow up.
- **Early growth is quick:** a tiny fish gives 1.75 growth, so about 12 bites to your first size-up. While you're at your smallest, 70% of what spawns is food.
- **One life:** if a bigger fish catches you, the run is over, unless a skill or a shield saves you.
- **A wide sea:** about 7 screens across. Rock pillars and arches stand on the play plane: you and the fish can't swim through them, so a fleeing fish can be cornered against one (calm fish swim round them or turn back; panicking ones don't). Arches are tall (never two in a row), and the bottom of each leg is a **cracked door** (sandy and blotchy): boost into it to smash through and cut straight under the arch, instead of swimming over the top.
- **Oysters** (2 per level) sit on the sea floor:
  - **The cycle:** each one opens to show a pearl, shivers, then snaps shut.
  - **Pearls:** a white pearl is worth 500 × the level and a black one 2,500 × the level.
  - **The snap:** while you're small it eats you; bigger, it pinches.
  - **Bonus points:** every 5 pearls give a bonus skill point.
- **Power-ups** drift down in bubbles about every 20 s:
  - **Shock:** fish near you go limp.
  - **Shrink:** fish one size bigger than you become food for 6 s.
  - **Rush:** you swim 50% faster.
  - **Bubble Shield:** you survive the next bite.
- **Shards and the portal:**
  - **Finding them:** each level hides *its own* shard (the level card says which, e.g. "Shard 2 of 5 is hidden in a wreck here") in a wreck, out in the wide sea (a different place each run). It glints once you're close.
  - **With all five:** they make an orb, and beating the world's apex opens a **portal** to another world's ocean (the reef's portal leads to the Kelp Forest; after the last built world they loop round, recoloured and faster).
  - **Keeping skills:** at the portal you keep 1 skill, plus 1 per 10 pearls found in that world (up to 3). Your size, tree and shards start over.
  - **Missing shards:** the portal stays dark and the world replays, faster, keeping the shards you found.
- **Combos:** eats less than 1.5 s apart multiply the points (up to ×8).
- **The Sunny Reef** has 5 levels, each its own spot with its own colours, prop mix, fish mix and a landmark built in code:
  1. Coral Garden
  2. Sandy Shallows
  3. Shipwreck Cove
  4. Arch Rocks
  5. The Drop-off

  After level 5 comes the apex, then the portal (or another lap of the reef, if you're missing shards).
- **The apex predator (the Giant Moray):** a long, rippling serpent. Filling level 5's meter wakes it in its own rock with three holes, on the other side of the sea from the wreck (so the shard stays easy to reach). An arrow points the way, and the other fish clear off.
  - **Its tail is where you bite it.** Each bite takes 1 health, and boosting into it takes 2 (the boost button works during the fight; it used not to).
  - **Its jaws** (the front 40% of its body) eat you, unless a shield or Second Wind saves you.
  - **How it fights:** it hides in one of its rock's three holes. That hole shakes and bubbles with a red "!", then it strikes out at you, stays stretched out for about 2 s (its tail still in the hole: bite it there), and pulls back in.
  - **Phase 2:** at half health it gets angry, moves faster, and sometimes strikes from two holes in a row.
  - **Beating it** pays 3,000 × the level, plus a bonus skill point.
  - It's data plus an attack library (`apex` in `data.js`, `APEX_ATTACKS`). Chasing apexes use `lunge`/`flurry`; lair apexes (`lair: true`) use `ambush`/`double`.
- **The reef's fish (25 species, smallest first):**

  | Ranks | Species |
  |---|---|
  | 0-1 | minnows, gobies, butterflyfish, damselfish, pufferfish (they swell into a danger when you're close) |
  | 2-3 | parrotfish, triggerfish, groupers, snappers |
  | 4-5 | angelfish, moray eels, wrasse, jacks |
  | 6-7 | reef sharks, tarpon, goliath groupers, bumpheads |
  | 8-9 | giant trevally, humphead wrasse, tiger sharks, sunfish |
  | 10-11 | whale sharks, sawfish, bull sharks, oarfish |

  Every level has at least one hunter bigger than you. A red "!" means one is chasing you; it gives up after a few seconds.
- **The Kelp Forest (world 2):** 5 levels, each with its own landmark:
  1. Kelp Edge: boulders and sand ripples.
  2. Garibaldi Rocks: giant boulders with sea stars.
  3. The Canopy: kelp mats under the surface.
  4. Urchin Barren: purple urchins everywhere.
  5. The Deep Stand: ancient thick kelp trunks.

  The kelp itself sways in the vertex shader, so a whole forest is one draw call. Its fish, smallest first:

  | Ranks | Species |
  |---|---|
  | 0-1 | anchovies, kelp blennies, señoritas, surfperch, moon jellies |
  | 2-3 | garibaldi, kelp bass (hunter), blue rockfish, opaleye |
  | 4-5 | sheephead, cabezon (hunter), halfmoon, lingcod (hunter), sea nettles |
  | 6-7 | horn sharks (hunter), bat rays, giant sea bass (hunter), yellowtail |
  | 8-9 | wolf eels (hunter), bonito, soupfin sharks (hunter), bluefin tuna, lion's mane jellies |
  | 10-11 | sevengill sharks (hunter), opah, thresher sharks (hunter), basking sharks |

  - **Jellyfish** (`behavior: 'jelly'`) drift in slow pulses. They can't be eaten at any size, and touching one stings: a 1 s stun and a shove (`JELLY` in `data.js`; Tough Skin halves it). They get their own pink chip on the food chain bar.
  - **The Leopard Shark** is a chasing apex like the old Barracuda (circle, lunge, and a flurry in phase 2), plus a **charge**: it swims off the side of the screen, a "!" shows at the edge, then it charges straight across at your height.
- **Rare variants (8%):**

  | Variant | Effect |
  |---|---|
  | Golden | ×5 points |
  | Spiny | stings you for a moment, but gives ×2 growth |
  | Speedy | fast and jumpy, ×2 points |
  | Giant | one size bigger |
- **Skill tree:** three dark panels, Scales (green, survive), Jaws (red, hunt) and Fins (yellow, speed). Each is a web of 10 glowing hexagons under its emblem. On a phone held upright the panels are tabs, with smaller hexagons, so the tree, a tapped skill's description and the Learn and Next buttons fit on one screen.
  - **Unlocking:** a node opens once you own *any* node joined to it above, so paths split and join again. Cost goes by row (1, 1, 2, 3, 4).
  - **Points:** 1 per level, 1 per 5 pearls and 1 per apex, about 10 a world. A branch costs about 23 and the tree about 70, so each world you pick a direction. Unspent points carry over.
  - **Capstones:** Second Wind, Gulp, Torpedo.
  - **New skills:**
    - **Scales:** Ink Cloud, Oyster Proof, Mimic, Shell Up, Regrow.
    - **Jaws:** Pearl Diver, Sharp Teeth, Magnet, Iron Jaw, Shard Sense.
    - **Fins:** Slipstream, Double Dash, Wake, Ghost Fin, Jet Stream.
  - **Combos:** owning a pair across two branches unlocks a bonus: Feeding Frenzy, Ghost, Shark Skin, Hoarder.
- **Starters**, picked on the main menu (you're always a young one, tier 1):

  | Starter | What it's like | Unlock |
  |---|---|---|
  | Shark | all-rounder with a bigger bite | open from the start |
  | Barracuda | fast, with a quick boost, but a small bite (starts with Fast Fins) | reach level 3 |
  | Orca | survives a bite each level, but slower (starts with Camouflage) | beat the reef's apex |
  | Swordfish | Spear: eats fish its own size while boosting; the fastest boost, but a slow recharge | open a portal |

## Play online (PvP, up to 8 fish)

- **Rooms:** Play online, pick a name, then **Create a room** (you get a 5-letter code to share) or **Join** with a friend's code.
- **The lobby:**
  - Everyone picks a fish; all four are open online, with PvP tuning.
  - The host sets the **mode**, the **time limit** (off / 3 / 5 / 10 min), the score to win (10,000 or 15,000, for Most Points with no time limit), the **sea** (Sunny Reef / Kelp Forest) and **Power-up rain**.
  - The host can **add bots** to fill seats, so you can try it alone. A match needs 2-8 fish.
- **The match:** everyone starts small, spread out, after a 3-2-1 countdown, in one level of the chosen sea, with its rocks, arch doors, oysters and power-ups.
  - **Sizes 1-5:** grow by eating. Bigger players eat smaller ones; the same size just bumps.
  - **Eating a player** scores 300 × their size² (a size-4 fish is worth 4,800), plus a big meal.
  - **Crown bounty:** the leader wears a gold crown and is worth double.
  - **Tail bites:** a player your size or bigger can be bitten on the tail (the back of its body, like an apex; its jaws are the front 40%). Each bite moves a quarter of a size from them to you (×1.6 if you're the smaller one) and scores 150 × their size. Head to head, you just bump.
- **Last Fish Standing:** eaten means out, and you watch the others (tap to switch who). The last fish wins; with a time limit, the biggest survivor wins when time's up.
- **Most Points:** eaten means back in 3 s at **the same size**, at a random spot away from bigger fish, keeping your points. The most points when time's up wins (or the first to the target, with no time limit).
- **On screen:**
  - a live scoreboard (top 3 plus you)
  - a kill feed
  - name tags with sizes
  - edge arrows to power-up bubbles and the nearest pearls
  - power-up indicators on every fish: a shield bubble, Rush's blue glow, purple shrunk fish, sparks over stunned ones
- **Power-ups online:**
  - Shock also zaps nearby players (a 1.5 s stun).
  - **Power-up rain** drops bubbles 3× as often, up to 3 at once.
- **Afterwards:** the results show place, points and fish eaten. The host's **Rematch** takes everyone back to the lobby.
- **How it works (engineering):**
  - The match runs browser to browser over **WebRTC** data channels, with the host as the hub.
  - Supabase Realtime (the Arcade's shared project) is used only to find each other: presence for who's in the room, and a two-message connection handshake. (The free plan allows only 100 Realtime messages a second for the whole project.)
  - Each player moves their own fish and sends it 20× a second. The host runs the sea fish, bubbles, bites between players, the timer and the crown, and sends each guest the sea around it 12× a second.
  - Eating a sea fish, grabbing a bubble or a pearl is claimed by whoever did it, and the host settles ties. Bots run on the host.
  - Code: `js/net.js` (rooms), `js/pvp.js` (lobby and match), and the PvP rules in `js/rules.js`.
  - **When a direct connection is blocked** (some routers and networks block them; Craig's two PCs on different networks did), the player falls back to a **relay** after 7 s. Their match messages then go through a private Supabase channel with the host. It updates 6 times a second instead of 20, so it's a little less smooth. The lobby marks them "via relay".
  - The project's message cap allows up to 3 relayed players per room. If bigger rooms need it, add a real TURN server (Cloudflare's free tier, through a small Edge Function).
  - `node tools/pvp-test.js --relay` runs the whole match test through the relay.

## Replay and competition hooks

- A score, always: points per fish × combo, plus a clear bonus per level. Your best score and level are saved.
- Seeded spawns: each run has a seed, and the same seed gives the same sea and rare fish (ready for a Daily Dive and leaderboards).
- Build variety: 4 starters × a branching skill tree you can only partly fill, reset at each portal except the skills you keep.
- Exploration: shards in wrecks, pearls in oysters, power-ups, and a different wreck spot every run.
- Leaderboard and accounts (2026-11-16): optional Google sign-in through the Arcade's shared backend (`js/arcade.js`). Signed in, every run posts its score, the game over screen shows your rank, and the main menu shows your player name (Change name / Sign out). Your best score and unlocked fish are kept in a cloud save, merged with whatever this device has. Guests play as before, and their best posts the first time they sign in.
- Next: the Open Sea and deeper worlds behind the portal, endless mode and the Daily Dive (a second board, `mode: 'daily-<date>'`).

## Code layout

- `index.html`: the page, the import map, the menus and the HUD (all HTML/CSS).
- `js/data.js`: the world size, tiers, growth, score and the zones with their fish.
- `js/rules.js`: who eats whom, growth, score and the seeded spawner. Plain JS, tested in Node.
- `js/art.js`: fish, coral, rocks, light rays and bubbles, all built from three.js shapes.
- `js/ui.js`: saves, sound, menus and input (the floating joystick, mouse, keys).
- `js/arcade.js`: Google sign-in, leaderboards and cloud saves through the Arcade's shared Supabase backend. The same file goes in every game (see `GameDev/CLAUDE.md`).
- `js/game.js`: the scene, camera, game loop, player, fish behaviour, collisions and HUD.

## Testing

- `node tools/check.js`: checks the rules in Node (tiers, growth, combos, the spawner's seed and food share).
- `node tools/pvp-test.js`: online matches with 3 players as pages in one browser, over a local stand-in for the network (`?net=local`).
  - It covers the lobby, settings and bots, the countdown, syncing fish and the sea, Power-up rain, shields, edge arrows, players eating players, respawns, the crown, the timer, results, rematch, Last Fish Standing, and the host leaving.
  - `--real` plays two pages over the real Supabase + WebRTC.
  - `--tourney 20` runs bot matches to check the four starters are balanced.
- `node tools/playtest.js`: plays the real page headlessly on a phone and a desktop screen. It covers:
  - the menus and settings
  - a real joystick drag, the mouse and the arrow keys
  - eating, combos and growing (with the camera pulling back)
  - the wide sea, rocks (you can't pass them; a fleeing fish gets cornered), the surface
  - oysters, pearls and skill points, the four power-ups
  - wrecks and shards, the portal, the keep screen and the next world
  - the hexagon skill tree (tabs on a phone), the four starters, the Moray's ambushes
  - a short landscape run (812 × 375)
  - the puffer and the hunter
  - pause and auto-pause
  - getting eaten and the game over screen
  - a bot that clears the reef

  WebGL runs in software (SwiftShader). Screenshots go to `playtest-output/` (git-ignored). See `GameDev/CLAUDE.md` for the `NODE_PATH` on this PC.

## What I learned

- **three.js with no build step:** an import map points `three` at the CDN. Plain scripts (data, rules, ui) load first and share globals, then the game loads as a module, which can still see those globals.
- **Low-poly fish from shapes:** a sphere stretched along x for the body (coloured belly to back with vertex colours), a flat extruded tail on a pivot that wags, fins, and sphere eyes. Build each species' geometry once and share it between every fish.
- **Side view in 3D:** everything plays on the z = 0 plane. Scenery sits behind it (z < 0), so the perspective camera gives parallax for free, and fog hides the far edge. Turning the fish slightly towards the camera shows off the 3D.
- **Growing = pulling the camera back:** the camera's distance sets how much of the plane you see (`viewHeight / 2 / tan(fov / 2)`).
- **Making a side view look 3D** (all cheap enough for phones):
  - **The camera tilts** down 22° and swings a few degrees as you swim, so you see the fish's backs, the floor recedes and the parallax always shows. The area on screen is then a trapezoid: four corner rays against z = 0 give the box used for spawning and despawning.
  - **The fish swim:** the body swings against the tail, and they bank into turns.
  - **Caustics:** a few lines of shader added to the standard material (`onBeforeCompile`).
  - **Depth layers:** rock spires in the middle distance and marine snow between you and the camera.
  - Tuning lives in `CAMERA` in `data.js`.
