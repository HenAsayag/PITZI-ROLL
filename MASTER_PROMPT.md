# MASTER PROMPT — PITZI ROLL (for Claude)

> Paste everything below the line into Claude together with this project folder (`assets/`, `levels/`). It is written as a one-shot build: Claude should deliver a finished, playable game, not a plan.

---

## Role & goal
You are a senior web game developer. Build **PITZI ROLL**, a finished, polished 3D browser game: a hamster named **Pitzi** rolls inside a transparent ball through floating obstacle courses, racing a shared countdown clock. The genre is the classic marble-maze racer (the Marble Madness / Hamsterball family). **Everything must be original.** Never use the names "Hamsterball", "Raptisoft", "8-Ball" or "Golden Weasel", or any original track layouts, music or art. The game is part of my portfolio site **HEN'S ARCADE**, so it has to feel premium, juicy and bug-free on the first run.

Deliver the complete code. Don't write TODOs, placeholders or "left as an exercise".

## Tech (fixed, don't substitute)
- A single `index.html` plus one ES-module `game.js` (split into a few modules under `src/` only if `game.js` passes ~1500 lines). No build step.
- **Three.js 0.186** and **Rapier 3D compat 0.20.0**, both via importmap from jsdelivr:
  ```html
  <script type="importmap">{"imports":{
    "three":"https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js",
    "three/addons/":"https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/",
    "rapier":"https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.20.0/dist/rapier.mjs"}}</script>
  ```
  `import RAPIER from 'rapier'; await RAPIER.init();`. These verified calls are available: `new RAPIER.World({x:0,y:-20,z:0})`, `ColliderDesc.trimesh(Float32Array, Uint32Array)`, `ColliderDesc.ball(r)`, `ColliderDesc.cuboid(hx,hy,hz)`, `ColliderDesc.cylinder(hh,r)`, `RigidBodyDesc.dynamic().setCcdEnabled(true)`, `RigidBodyDesc.kinematicPositionBased()` + `setNextKinematicTranslation/Rotation`, `body.applyImpulse`, `.setLinvel`, `.setAngvel`, `.setTranslation`, `ColliderDesc…setSensor(true).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)`, `const q = new RAPIER.EventQueue(true); world.step(q); q.drainCollisionEvents((h1,h2,started)=>…)`.
- Web Audio API for sound (decode WAVs into AudioBuffers; loops via `AudioBufferSourceNode.loop`).
- Runs from a static server (`npx serve .` or GitHub Pages). Load assets with `fetch` and `TextureLoader`.
- Target 60 fps on a mid-range laptop. Use a fixed physics step of 1/120 s with an accumulator, and interpolate render positions.

## Project assets (use them, keep their paths)
```
assets/textures/  floor_{meadow,candy,factory,castle,sky,neon,ice}.png   512² tileable checker floors
                  side_{theme}.png        track side walls (tile along length)
                  sky_{theme}.png         2048×1024 equirect → scene.background (EquirectangularReflectionMapping) + env
                  pad_{speed,bonus,goal,checkpoint,launcher}.png, bumper_top.png   decals (transparent PNG; speed-pad arrow points to texture +V = travel direction)
                  surface_{tar,collapse,glass}.png         special floor surfaces (glass is RGBA)
                  ball_roughness.png, ball_seam.png        equirect maps for the hamster ball
assets/sprites/   star_dizzy, sparkle, soft_dot, dust, glass_shard, shadow_blob (.png, particles/billboards)
assets/ui/        logo.svg/.png, pitzi_{idle,happy,dizzy,in_ball}.svg/.png, favicon.png
assets/icons/     timer, checkpoint, goal, bonus_time, ball, fall, pause, restart, sound_on/off, keys, trophy, lang, medal_{bronze,silver,gold,acorn} (.svg + .png)
assets/fonts/     rubik-{hebrew,latin}-{500,800,900}-normal.woff2  → @font-face "Rubik" (supports Hebrew)
assets/sfx/       roll_loop, vacuum_loop, saw_loop, music_loop (loops) · bump, bumper, fall_whoosh, ball_crack, respawn_pop,
                  checkpoint, time_bonus, countdown_beep, go, tick, goal_fanfare, launcher, dizzy, squeak, ui_click, ui_hover,
                  medal, hammer_slam, tile_crumble (.wav)
levels/levels.json  8 races as segment chains (schema below). levels/previews/*.png = top-down maps for reference.
```
Palette (CSS vars): navy `#1B1F3B`, cream `#FFF4E0`, hamster orange `#F4A259`, glass cyan `#7FDBFF`, magenta `#FF4F8B`, lime `#B8F35A`, gold `#FFC83D`.

## Level data: build the world from `levels.json`
Conventions: **Y up**, meters. Each segment has a precomputed `start` pose `{x,y,z,heading}`. Use it directly; don't accumulate your own cursor. Heading `h` is in degrees, `dir = (sin h, 0, -cos h)` and `right = (cos h, 0, sin h)`. A **positive curve `angle` turns right**. `drop` is the Δy across the segment (negative = downhill). Height changes linearly along the segment.

Segment fields: `type`, `length` (not on curves), `angle`+`radius` (curves), `width`, `drop`, `rails` (`both|left|right|none`), optional `surface` (`normal|ice|tar|glass`), `checkpoint: true`, `collapse: true`, `hazards: [{type, at, x, ...params}]`. `at` runs 0..1 along the segment and `x` runs −1..1 across the half-width (+ = right).

Build per segment:
- **straight / platform**: a slab 0.6 m thick. Top surface from the start pose along `dir`, sloped by `drop`. Floor UVs world-scaled (1 texture repeat = 4 m). Side walls use `side_{theme}`.
- **curve**: sweep along the arc (≥ 24 subdivisions). The center is `start + right·R·sign(angle)`, and the heading at u is `h + angle·u`. Same slab profile.
- **rails**: rounded curbs, 0.5 m high and 0.25 m wide, on the requested sides, with their own colliders.
- **gap**: no floor. Draw a faint dotted guide line only.
- **tube**: a translucent enclosed pipe (radius 1.5) from start to end. While the ball is inside, disable player control and move the ball kinematically along the tube's centerline over `max(1.2, length/12)` s, then release it with exit velocity 8 m/s along `dir`.
- **lift** (vacuum): a translucent cylinder of rising particles, height `drop`. On entering the base, disable control and lift the ball over 1.2 s (play `vacuum_loop`), then eject it 1.5 m forward onto the next segment.
- Build **one merged trimesh collider per segment** (floor + rails). Set friction per surface: normal 0.9, ice 0.05 (plus angular damping 0.05 while on it), glass 0.9 (semi-transparent floor, render order last), tar 1.0 with a strong linear damping of 3 while inside.
- `collapse: true`: build the floor from 2 m × 2 m tiles, each its own collider. When the ball touches a tile: it shakes for 0.35 s, falls (kinematic, then removed), plays `tile_crumble`, and respawns after 5 s. All tiles reset on player respawn.
- **killY** is given per level. Below it, the ball breaks (see *Fail states*).

Hazards:
| type | behavior |
|---|---|
| `start` | spawn point, facing the segment heading |
| `goal` | `pad_goal` decal, 3 m radius, sensor. Entering it finishes the race |
| checkpoint (segment flag) | a thin glowing blue ring gate across the segment start. The first pass plays `checkpoint` and sets it as respawn |
| `bumper` | cylinder r 0.8, h 0.8, with `bumper_top` texture. On hit: impulse 12 m/s radial outward, scale-pop 1.3 → 1 over 0.2 s, emissive flash, `bumper` sfx |
| `rival` | an AI ball (dark glossy with a magenta stripe, r 0.55, heavier ×1.4). It idles on its spot, rams the player when within 7 m (steering force toward the player, max 7 m/s), and returns home otherwise. Knocking it below killY = +2000 score and it respawns after 4 s |
| `spinner` | kinematic bar (`length`, 0.6 × 0.6), rotating about Y at `speed` rad/s at the given spot, 0.5 m above the floor |
| `hammer` | kinematic 2 × 2 m block that slams down from 3 m every `period` s (`phase` offset). Being hit from above while grounded breaks the ball. Plays `hammer_slam` and camera shake |
| `saw` | spinning blade (r 0.9, emissive red teeth) sliding across the track ±`travel`/2 with `period`. Touch = break. `saw_loop` is positional audio |
| `mover` | kinematic 4 × 4 m platform shuttling along the gap's `dir`, ±`travel`/2 around the gap middle, with a smooth sine over `period`. The ball must ride it (kinematic friction carries it) |
| `launcher` | `pad_launcher` decal. On contact: set the ball velocity to reach the next landing platform with a ballistic arc (compute v from the distance to the next platform's center and Δy, apex +3 m) × `power`. Plays `launcher` |
| `speedpad` | `pad_speed` decal oriented to `dir`. Adds velocity along `dir` up to 14 m/s. Streak particles |
| `bonus` | `pad_bonus` button, 1.2 m, one-shot per run: +`seconds` to the clock, `time_bonus` sfx, floating "+5" text |

## Pitzi & the ball
- **Ball**: Rapier dynamic sphere r 0.5, CCD on, restitution 0.25, friction 1.0, linear damping 0.15, angular damping 0.4. Render it as `MeshPhysicalMaterial` (transmission 0.9, thickness 0.3, ior 1.3, roughnessMap `ball_roughness`, clearcoat 1, envMap = sky) with a second shell mesh carrying the `ball_seam` alpha band. The mesh rotation follows the physics body.
- **Hamster**: a procedural, cute low-poly Three.js model matching `assets/ui/pitzi_idle.png` (orange `#F4A259` body, cream belly and muzzle, pink inner ears and cheeks, glossy black eyes, tiny paws). About 0.7 m tall and centered in the ball. It **stays upright** (never rotates with the ball), yaws smoothly toward the velocity direction, and bobs with a run cycle whose speed ∝ rolling speed (legs cycle, ears flop). Expressions: normal; **dizzy** (eyes → spirals, 3 `star_dizzy` sprites orbiting the head); **happy** at the goal (eyes → arcs, jump, `squeak`).
- `shadow_blob` decal under the ball, projected onto the floor below by a downward raycast, scaled and faded by height.

## Controls & camera
- Arrow keys / WASD apply **screen-relative** force (impulse 0.9 × dt × 60 per step, capped to a horizontal speed of 11 m/s when grounded). In the air you get 35% control. The mouse is optional: holding the left button rolls toward the cursor direction.
- Gamepad: left stick (standard mapping). Touch: a virtual joystick bottom-left on touch devices.
- `Space` = brake (strong horizontal damping, 0.5 s), `R` = give up to the last checkpoint (costs the respawn time), `Esc`/`P` = pause.
- **Camera**: fixed-angle chase. It sits at offset `(0, 9, 9)` rotated to face the level's general forward direction and smoothly re-oriented only at checkpoints (lerp over 1 s). Controls stay relative to the current camera yaw. Critically damped follow. It never clips under the floor (raycast up). FOV 50. It pulls back slightly with speed. Screen shake on crack or slam.

## Rules & modes
- **Tournament** (main): races 1→8 in order. At each race start, add `raceTime` × difficulty multiplier (Easy ×1.3, Normal ×1.0, Hard ×0.75) to a shared **time pool**. The remaining time carries over. When it hits 0: "TIME'S UP" → results → back to menu. Score per race = remaining seconds × 100 + 1000 if finished under `par`, plus rival knock-offs. Beating the tournament unlocks **Mirror mode** (negate X of all geometry and input).
- **Time Trial**: any unlocked race, a clock counting up with a ghost of your best run (record the position each 0.05 s and replay it as a translucent ball). Medals from `medals` {bronze, silver, gold, acorn}. "Golden Acorn" is our secret top tier.
- **Practice**: any unlocked race, no clock.
- Race intro: a short flyover of the course from goal to start (2.5 s, skippable), then a 3-2-1-GO countdown (`countdown_beep`, `go`). The clock starts on GO.
- **Fail states**: ① **Hard landing**: vertical impact speed > 9 m/s → dizzy for 1.5 s (controls are rotated by a random ±60° wobble and reduced 50%), `dizzy` sfx. ② **Break**: below killY, or hit by a saw or hammer → `ball_crack`, glass shards burst, the ball disappears, and after 1.5 s it respawns at the last checkpoint with `respawn_pop` and 1 s of invulnerable blinking. **The clock keeps running during all of this.** That's the penalty.
- Clock at ≤ 10 s: HUD timer turns magenta and pulses, with `tick` every second.

## Screens & UI (Hebrew RTL default, EN toggle)
- All strings live in one `STRINGS = {he:{…}, en:{…}}` object. `<html dir>` switches with the language. Font: Rubik. Numbers and times stay LTR (`<bdi>`).
- **Main menu**: the logo, Pitzi in the ball idly rolling on a small turntable diorama, and buttons for Tournament / Time Trial / Practice / Settings. The difficulty selector is in Tournament. Soft parallax.
- **Race select** (Time Trial and Practice): cards with the level name (he/en), description, theme color, best time and medal icon. The locked cards have a lock.
- **HUD**: big timer (top center, `timer` icon), race name and n/8, a medal-target hint in Time Trial, checkpoint toast, "+5" popups, a mini course-progress bar (distance along the path).
- **Race results**: time, remaining, par bonus, score count-up, medal earned (`medal` sfx, confetti from `sparkle`), then Continue / Retry.
- **Pause**: Resume / Restart race / Settings / Quit.
- **Settings**: music and sfx volume, language, show FPS, invert mouse, reduced motion (disables shake and flyover).
- UI style: chunky rounded cards, 3px navy outlines, soft drop shadows, hover scale 1.04 (`ui_hover`), press squash (`ui_click`). Fully responsive.

## Audio
Music loop at −14 dB, ducked during the countdown and results. `roll_loop` volume and playbackRate are driven by ball speed when grounded (silent in the air). `bump` plays on impacts > 3 m/s with volume ∝ impulse. Use positional audio (PannerNode) for saws, hammers and lifts. Audio unlocks on the first user gesture.

## Juice (must have)
Dust puffs on hard landings; speed streaks above 9 m/s; a squash-stretch of the hamster (not the ball) on landing; a glow pulse on checkpoint rings; the goal pad sparkles; a floating hazard wobble anticipation (hammers rise before a slam, saw teeth glow). Themes get a matching fog color and a hemisphere + directional light with soft shadows (one 2048 shadow map following the ball). Neon gets bloom (UnrealBloomPass, subtle).

## Persistence
`localStorage` key `pitziroll.v1`: unlocked races, best times, medals, ghosts (compressed: Float32 → base64), settings, language. Wrap every read and write in try/catch. The game must work if storage is unavailable.

## Code quality
Keep the modules clear: `Level` (build from JSON, dispose), `Player`, `Hazards`, `CameraRig`, `Audio`, `UI`, `Game` (state machine: `boot → menu → intro → countdown → racing → finished|timeup → results`). Dispose geometries and materials on level change (no leaks after 20 restarts). A dev overlay on the backtick key shows fps, speed, grounded state, current segment index, and `Shift+N` to skip a race.

## Acceptance checklist (verify before you finish)
1. All 8 races load from `levels.json` with no console errors, and each one can be completed.
2. The ball can't tunnel through floors at max speed (CCD). Rails block it, and gaps can only be crossed via launcher, speedpad or mover as designed.
3. Tube and lift transport works and returns control. Collapse tiles fall and reset.
4. The time pool carries across races. Dying costs time and never freezes the clock or the game.
5. The Hebrew UI is fully RTL and the EN toggle works live.
6. Time Trial medals and ghosts save and reload.
7. The game still works with audio blocked until a click, and with localStorage disabled.
8. It runs at ≥ 55 fps on the Neon and Glass Rink levels on a mid-range laptop.

Output: the full contents of `index.html` and `game.js` (and `src/*.js` if split), ready to drop next to `assets/` and `levels/`.
