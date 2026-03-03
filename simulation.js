// simulation.js — Zombie city infection simulation

import { generateCity, buildStreetMask, renderCity } from './city.js';

// ============================================================
// CONFIGURATION — tweak these to change simulation behaviour
// ============================================================
let   numCitizens                   = 1000;   // total population (adjustable via slider, max 3000)
const DOT_RADIUS                    = 2;      // visual radius of every dot (px)
const CITIZEN_SPEED                 = 0.8;    // px per frame
const PANICKED_SPEED_MULTIPLIER     = 2.0;    // multiplier on CITIZEN_SPEED when panicked
const ZOMBIE_SPEED_MULTIPLIER       = 0.5;    // zombie wander speed multiplier
const ZOMBIE_CHASE_SPEED_MULTIPLIER = 2.0;    // zombie chase speed multiplier
const CITIZEN_VISION_DISTANCE       = 60;    // px — how far a citizen can see a zombie
const ZOMBIE_VISION_DISTANCE        = 150;    // px — how far a zombie can see a citizen
const INFECTION_DISTANCE            = 10;     // px — contact distance for infection
const INITIAL_ZOMBIE                = false; // true = auto-spawn patient zero; false = click to select patient zero(s)

// Zombie types: 0 = normal, 1 = sprinter
const SPRINTER_CHANCE               = 0.10;   // 10% of new zombies become sprinters
const SPRINTER_CHASE_SPEED_MULT     = 3.0;    // sprinters chase much faster
const SPRINTER_WANDER_SPEED_MULT    = 0.8;    // sprinters wander slightly faster
const SPRINTER_VISION_DISTANCE      = 80;     // px — sprinters have shorter vision

// Day/night cycle
const DAY_NIGHT_CYCLE_LENGTH        = 1800;  // frames per full cycle (~30s at 60fps)
const MAX_NIGHT_OPACITY             = 0.55;  // darkness overlay max opacity
const NIGHT_CITIZEN_VISION_MULT     = 0.35;  // citizen vision at midnight (fraction of base)
const NIGHT_ZOMBIE_VISION_MULT      = 0.70;  // zombie vision at midnight
const NIGHT_ZOMBIE_SPEED_MULT       = 1.35;  // zombie speed multiplier at midnight

// Barricades — player-placed walls that block zombies but not citizens
const MAX_BARRICADES    = 10;    // maximum number of barricade segments
const BARRICADE_WIDTH   = 6;     // visual + collision width (px)
const BARRICADE_HALF    = BARRICADE_WIDTH / 2;
const BARRICADE_MARGIN  = 2;     // px gap from building wall
const BARRICADE_HP              = 300;    // hit points per barricade segment
const BARRICADE_ZOMBIE_DPS      = 0.5;    // damage per frame from zombie bashing (~10s to break)
const BARRICADE_PANICKED_DPS    = 3;      // panicked citizens bash faster (~1.7s to break)
const BARRICADE_BASH_DIST       = 8;      // px — how close entity must be to bash

// Shelters / safe zones
const NUM_SHELTERS            = 6;      // buildings designated as shelters
const SHELTER_DETECTION_RANGE = 200;    // px — panicked citizens detect shelters within this range
const SHELTER_ENTRY_DIST      = 8;      // px — distance from building edge to enter shelter

// Soldiers — AI-controlled defenders that patrol, shoot zombies, and place barricades
const SOLDIER_INITIAL_PCT                = 0.02;   // 2% of population at start
const SOLDIER_MIN                        = 4;      // minimum soldiers regardless of pop
const SOLDIER_MAX_PCT                    = 0.05;   // hard cap: 5% of initial population
const SOLDIER_REINFORCE_INTERVAL         = 120;    // frames between reinforcement checks (~2s)
const SOLDIER_REINFORCE_RATIO            = 1.5;    // zombies:soldiers ratio to trigger reinforcement
const SOLDIER_SPEED                      = 0.6;    // patrol speed (px/frame)
const SOLDIER_VISION                     = 180;    // px — zombie detection range
const SOLDIER_SHOOT_RANGE                = 150;    // px — max shooting distance
const SOLDIER_SHOOT_COOLDOWN             = 90;     // frames between shots (~1.5s at 60fps)
const SOLDIER_KILL_CHANCE                = 0.7;    // probability of kill per shot
const SOLDIER_INFECTION_DIST             = 6;      // px — zombie must get very close to infect soldier
const SOLDIER_BARRICADE_COOLDOWN         = 300;    // frames between barricade placements (~5s)
const SOLDIER_BARRICADE_ZOMBIE_THRESHOLD = 3;      // minimum zombies nearby to trigger barricade
const SOLDIER_SHELTER_RETREAT_RATIO      = 4;      // zombies:1 ratio to seek shelter
const SOLDIER_SHELTER_LEAVE_FRAMES       = 180;    // frames with no zombies in vision before leaving (~3s)

// Zombie waves — escalating reinforcements from map edges
const WAVE_CALM_FRAMES   = 180;   // ~3s pause between zombie death and next wave
const WAVE_BASE_SIZE     = 5;     // first wave zombie count
const WAVE_SIZE_INCREASE = 3;     // additional zombies per wave
const WAVE_SPRINTER_RAMP = 0.03;  // sprinter chance increase per wave (additive)

// ============================================================
// CANVAS & DOM
// ============================================================
const cityCanvas = document.getElementById('city-canvas');
const heatCanvas = document.getElementById('heat-canvas');
const simCanvas  = document.getElementById('sim-canvas');
const cityCtx    = cityCanvas.getContext('2d');
const heatCtx    = heatCanvas.getContext('2d');
const simCtx     = simCanvas.getContext('2d');
const nightCanvas = document.getElementById('night-canvas');
const nightCtx    = nightCanvas.getContext('2d');

const hudCitizens = document.getElementById('cnt-citizens');
const hudPanicked = document.getElementById('cnt-panicked');
const hudZombies    = document.getElementById('cnt-zombies');
const hudTime       = document.getElementById('cnt-time');
const hudRate       = document.getElementById('cnt-rate');
const hudBarricades = document.getElementById('cnt-barricades');
const hudSaved      = document.getElementById('cnt-saved');
const hudSoldiers   = document.getElementById('cnt-soldiers');
const hudKilled     = document.getElementById('cnt-killed');
const hudWave       = document.getElementById('cnt-wave');
const endOverlay  = document.getElementById('end-overlay');
const endTitle    = document.getElementById('end-title');
const endMessage  = document.getElementById('end-message');
const pzOverlay   = document.getElementById('pz-overlay');
const chartCanvas = document.getElementById('chart-canvas');
const chartCtx    = chartCanvas.getContext('2d');

let waitingForPatientZero = false;
let patientZeroCount = 0;
const pzCount = document.getElementById('pz-count');

// Speed control: how many simulation steps per rendered frame
let simSpeed = 1;
let paused   = false;
const hudSpeed = document.getElementById('cnt-speed');

// Heat map state
let heatMapEnabled = false;
const HEAT_CELL = 8;  // px per heat grid cell
let heatCols = 0, heatRows = 0;
let heatGrid;  // Float32Array — accumulated infection intensity

// Day/night cycle state
let daylight = 1.0; // 1.0 = noon, 0.0 = midnight

// Barricade state
let barricades = [];        // [{x1, y1, x2, y2, hp}]
let barricadeMask;          // Uint8Array — 1 = barricade pixel
let barricadeMode = false;  // true = placement mode active
let barricadePreview = null; // {x1, y1, x2, y2} — ghost wall at cursor
let mouseX = 0, mouseY = 0;

// Shelter state
let shelters = []; // [{x, y, w, h, cx, cy}] — buildings designated as safe zones

// Shot visual — brief muzzle flash lines from soldier gunfire
let shotLines = []; // [{x1, y1, x2, y2, ttl}]

// Wave state
let waveNumber    = 0;
let waveCalmTimer = 0;   // frames until next wave spawns
let waveStarted   = false; // true once first zombie exists

// Soldier reinforcement state
let soldierCap       = 0;  // max soldiers for this game (3% of initial pop)
let reinforceTimer   = 0;  // countdown to next reinforcement check
let zombiesKilled    = 0;  // total zombies killed by soldiers

let canvasW = 0, canvasH = 0;

function setupCanvases() {
  canvasW = window.innerWidth;
  canvasH = window.innerHeight;
  cityCanvas.width  = canvasW;  cityCanvas.height = canvasH;
  heatCanvas.width  = canvasW;  heatCanvas.height = canvasH;
  simCanvas.width   = canvasW;  simCanvas.height  = canvasH;
  nightCanvas.width = canvasW;  nightCanvas.height = canvasH;
}

function initHeatMap() {
  heatCols = Math.ceil(canvasW / HEAT_CELL);
  heatRows = Math.ceil(canvasH / HEAT_CELL);
  heatGrid = new Float32Array(heatCols * heatRows);
}

function stampHeat(px, py, intensity) {
  const col = (px / HEAT_CELL) | 0;
  const row = (py / HEAT_CELL) | 0;
  // Stamp a 3x3 kernel centered on the cell
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = row + dr, c = col + dc;
      if (r < 0 || r >= heatRows || c < 0 || c >= heatCols) continue;
      const falloff = (dr === 0 && dc === 0) ? 1.0 : 0.4;
      heatGrid[r * heatCols + c] = Math.min(1.0, heatGrid[r * heatCols + c] + intensity * falloff);
    }
  }
}

function renderHeatMap() {
  heatCtx.clearRect(0, 0, canvasW, canvasH);
  if (!heatMapEnabled) return;

  for (let r = 0; r < heatRows; r++) {
    for (let c = 0; c < heatCols; c++) {
      const v = heatGrid[r * heatCols + c];
      if (v < 0.01) continue;
      // Color ramp: black -> red -> yellow -> white
      let red, green, blue;
      if (v < 0.33) {
        const t = v / 0.33;
        red = (t * 255) | 0; green = 0; blue = 0;
      } else if (v < 0.66) {
        const t = (v - 0.33) / 0.33;
        red = 255; green = (t * 200) | 0; blue = 0;
      } else {
        const t = (v - 0.66) / 0.34;
        red = 255; green = 200 + (t * 55) | 0; blue = (t * 180) | 0;
      }
      heatCtx.fillStyle = `rgba(${red},${green},${blue},${Math.min(v * 0.8, 0.6)})`;
      heatCtx.fillRect(c * HEAT_CELL, r * HEAT_CELL, HEAT_CELL, HEAT_CELL);
    }
  }
}

// ============================================================
// ENTITY STATE — parallel typed arrays for cache efficiency
// state: 0 = citizen, 1 = panicked, 2 = zombie, 3 = saved, 4 = soldier, 5 = dead
// ============================================================
let posX, posY, targetX, targetY, states, zombieType, wanderTimer, panicTimer;
let shelterIdx;  // Int8Array — which shelter a saved citizen is inside (-1 = none)
let soldierCooldown;          // Int16Array — frames until next shot
let soldierBarricadeCooldown; // Int16Array — frames until next barricade placement

function allocateArrays(n) {
  posX        = new Float32Array(n);
  posY        = new Float32Array(n);
  targetX     = new Float32Array(n);
  targetY     = new Float32Array(n);
  states      = new Uint8Array(n);
  zombieType  = new Uint8Array(n);
  wanderTimer = new Int16Array(n);
  panicTimer  = new Int16Array(n);
  shelterIdx  = new Int8Array(n).fill(-1);
  soldierCooldown          = new Int16Array(n);
  soldierBarricadeCooldown = new Int16Array(n);
}

// ============================================================
// SPRITES — pre-rendered soft-edge dots (avoids per-frame gradient cost)
// ============================================================
function makeOffscreenCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(w, h);
  }
  // Fallback for browsers without OffscreenCanvas
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function createSprite(r, g, b) {
  const padding = 3;
  const size    = DOT_RADIUS * 2 + padding * 2;
  const oc      = makeOffscreenCanvas(size, size);
  const ctx     = oc.getContext('2d');
  const cx      = size / 2;
  const gradR   = DOT_RADIUS + 1;

  const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, gradR);
  grad.addColorStop(0,    `rgba(${r},${g},${b},1)`);
  grad.addColorStop(0.55, `rgba(${r},${g},${b},0.85)`);
  grad.addColorStop(1,    `rgba(${r},${g},${b},0)`);

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cx, gradR, 0, Math.PI * 2);
  ctx.fill();

  return { canvas: oc, half: cx };
}

let spriteCitizen, spritePanicked, spriteZombie, spriteSprinter, spriteSaved, spriteSoldier;

function initSprites() {
  spriteCitizen  = createSprite(255, 255, 255);
  spritePanicked = createSprite(255, 215,   0);
  spriteZombie   = createSprite(210,  25,  25);
  spriteSprinter = createSprite(255, 100,  30);  // orange-red for sprinters
  spriteSaved    = createSprite( 50, 200,  50);
  spriteSoldier  = createSprite(139,  90,  43);  // earthy brown
}

// ============================================================
// SPATIAL GRID — uniform grid for O(1) neighbour queries
// Cell size = largest vision radius → at most 3×3 cells to check
// ============================================================
const GRID_CELL = Math.max(ZOMBIE_VISION_DISTANCE, CITIZEN_VISION_DISTANCE, SOLDIER_VISION);
let GRID_COLS = 0, GRID_ROWS = 0, gridCells;

function initGrid() {
  GRID_COLS = Math.ceil(canvasW / GRID_CELL) + 1;
  GRID_ROWS = Math.ceil(canvasH / GRID_CELL) + 1;
  gridCells = Array.from({ length: GRID_COLS * GRID_ROWS }, () => []);
}

function rebuildGrid() {
  for (let c = 0; c < gridCells.length; c++) gridCells[c].length = 0;
  for (let i = 0; i < numCitizens; i++) {
    const col = Math.min(GRID_COLS - 1, (posX[i] / GRID_CELL) | 0);
    const row = Math.min(GRID_ROWS - 1, (posY[i] / GRID_CELL) | 0);
    gridCells[row * GRID_COLS + col].push(i);
  }
}

// ============================================================
// NAVIGATION — street mask (Uint8Array) + wall-slide movement
// ============================================================
let mask; // set by init()

// True if canvas pixel (x,y) is walkable street
function passable(x, y) {
  const px = x | 0, py = y | 0;
  if (px < 0 || px >= canvasW || py < 0 || py >= canvasH) return false;
  return mask[py * canvasW + px] === 1;
}

// True if a circle of radius DOT_RADIUS centred at (cx,cy) is fully on street.
// Uses 9 probe points: centre + 4 cardinal + 4 diagonal.
function circlePassable(cx, cy) {
  const r = DOT_RADIUS;
  const d = r * 0.707; // ≈ r / √2
  return (
    passable(cx,     cy)     &&
    passable(cx + r, cy)     && passable(cx - r, cy) &&
    passable(cx,     cy + r) && passable(cx,     cy - r) &&
    passable(cx + d, cy + d) && passable(cx - d, cy + d) &&
    passable(cx + d, cy - d) && passable(cx - d, cy - d)
  );
}

// ============================================================
// BARRICADE MASK — blocks zombies, citizens pass through
// ============================================================
function initBarricadeMask() {
  barricadeMask = new Uint8Array(canvasW * canvasH);
}

function stampBarricadeLine(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.max(1, Math.ceil(dist));
  const sx = dx / steps, sy = dy / steps;
  for (let k = 0; k <= steps; k++) {
    const cx = (x1 + sx * k) | 0;
    const cy = (y1 + sy * k) | 0;
    for (let py = -BARRICADE_HALF; py <= BARRICADE_HALF; py++) {
      for (let px = -BARRICADE_HALF; px <= BARRICADE_HALF; px++) {
        if (px * px + py * py > BARRICADE_HALF * BARRICADE_HALF) continue;
        const mx = cx + px, my = cy + py;
        if (mx >= 0 && mx < canvasW && my >= 0 && my < canvasH) {
          barricadeMask[my * canvasW + mx] = 1;
        }
      }
    }
  }
}

/** Erase a barricade from the pixel mask. */
function eraseBarricadeLine(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.max(1, Math.ceil(dist));
  const sx = dx / steps, sy = dy / steps;
  for (let k = 0; k <= steps; k++) {
    const cx = (x1 + sx * k) | 0;
    const cy = (y1 + sy * k) | 0;
    for (let py = -BARRICADE_HALF; py <= BARRICADE_HALF; py++) {
      for (let px = -BARRICADE_HALF; px <= BARRICADE_HALF; px++) {
        if (px * px + py * py > BARRICADE_HALF * BARRICADE_HALF) continue;
        const mx = cx + px, my = cy + py;
        if (mx >= 0 && mx < canvasW && my >= 0 && my < canvasH) {
          barricadeMask[my * canvasW + mx] = 0;
        }
      }
    }
  }
}

/** Distance from point (px,py) to the nearest point on segment (x1,y1)-(x2,y2). */
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
}

function barricadePassable(x, y) {
  const px = x | 0, py = y | 0;
  if (px < 0 || px >= canvasW || py < 0 || py >= canvasH) return true;
  return barricadeMask[py * canvasW + px] === 0;
}

function barricadeCirclePassable(cx, cy) {
  const r = DOT_RADIUS;
  const d = r * 0.707;
  return (
    barricadePassable(cx,     cy)     &&
    barricadePassable(cx + r, cy)     && barricadePassable(cx - r, cy) &&
    barricadePassable(cx,     cy + r) && barricadePassable(cx,     cy - r) &&
    barricadePassable(cx + d, cy + d) && barricadePassable(cx - d, cy + d) &&
    barricadePassable(cx + d, cy - d) && barricadePassable(cx - d, cy - d)
  );
}

function zombieCirclePassable(cx, cy) {
  return circlePassable(cx, cy) && barricadeCirclePassable(cx, cy);
}

/** Probe from (px,py) in direction (dx,dy) until hitting a building wall or canvas edge. */
function probeToWall(px, py, dx, dy, maxDist) {
  let dist = 0;
  let x = px, y = py;
  while (dist < maxDist) {
    x += dx; y += dy; dist++;
    const ix = x | 0, iy = y | 0;
    if (ix < 0 || ix >= canvasW || iy < 0 || iy >= canvasH) break;
    if (mask[iy * canvasW + ix] === 0) break;
  }
  return dist;
}

/** Compute a barricade that spans the street at (mx,my) wall-to-wall. */
function computeStreetBarricade(mx, my) {
  const ix = mx | 0, iy = my | 0;
  if (ix < 0 || ix >= canvasW || iy < 0 || iy >= canvasH) return null;
  if (mask[iy * canvasW + ix] === 0) return null; // cursor inside building

  const maxProbe = 150;
  const left  = probeToWall(mx, my, -1,  0, maxProbe);
  const right = probeToWall(mx, my,  1,  0, maxProbe);
  const up    = probeToWall(mx, my,  0, -1, maxProbe);
  const down  = probeToWall(mx, my,  0,  1, maxProbe);
  const hSpan = left + right;
  const vSpan = up + down;
  const m = BARRICADE_MARGIN;

  if (hSpan <= vSpan) {
    // Street runs vertically — block with horizontal barricade (wall to wall)
    return { x1: mx - left + m, y1: my, x2: mx + right - m, y2: my };
  } else {
    // Street runs horizontally — block with vertical barricade (wall to wall)
    return { x1: mx, y1: my - up + m, x2: mx, y2: my + down - m };
  }
}

// Attempt to move entity i by (vx, vy).
// Applies wall sliding; if fully blocked by a corner, sweeps up to 8 rotated
// escape directions so entities never freeze against building corners.
function moveEntity(i, vx, vy) {
  const canPass = states[i] === 2 ? zombieCirclePassable : circlePassable;
  const x = posX[i], y = posY[i];
  const nx = x + vx, ny = y + vy;

  // Full diagonal move
  if (canPass(nx, ny)) {
    posX[i] = nx; posY[i] = ny;
    return;
  }

  // Wall slide: X-only
  if (canPass(nx, y)) { posX[i] = nx; return; }

  // Wall slide: Y-only
  if (canPass(x, ny)) { posY[i] = ny; return; }

  // Corner stuck: sweep ±45° increments from desired direction until passable
  const s    = Math.sqrt(vx * vx + vy * vy) || CITIZEN_SPEED;
  const base = Math.atan2(vy, vx);

  for (let k = 1; k <= 4; k++) {
    const delta = k * (Math.PI / 4);

    let ex = x + Math.cos(base + delta) * s;
    let ey = y + Math.sin(base + delta) * s;
    if (canPass(ex, ey)) {
      posX[i] = ex; posY[i] = ey;
      targetX[i]     = Math.max(0, Math.min(canvasW, x + Math.cos(base + delta) * 200));
      targetY[i]     = Math.max(0, Math.min(canvasH, y + Math.sin(base + delta) * 200));
      wanderTimer[i] = 20 + (Math.random() * 40 | 0);
      return;
    }

    ex = x + Math.cos(base - delta) * s;
    ey = y + Math.sin(base - delta) * s;
    if (canPass(ex, ey)) {
      posX[i] = ex; posY[i] = ey;
      targetX[i]     = Math.max(0, Math.min(canvasW, x + Math.cos(base - delta) * 200));
      targetY[i]     = Math.max(0, Math.min(canvasH, y + Math.sin(base - delta) * 200));
      wanderTimer[i] = 20 + (Math.random() * 40 | 0);
      return;
    }
  }

  // Truly stuck (shouldn't happen in normal city layout) — force new target
  wanderTimer[i] = 0;
}

// ============================================================
// WANDER TARGET — random street pixel sampling
// ============================================================
function pickStreetTarget(i) {
  let x, y, att = 0;
  do {
    x = (Math.random() * canvasW) | 0;
    y = (Math.random() * canvasH) | 0;
    att++;
  } while (!circlePassable(x, y) && att < 40);

  targetX[i]     = x;
  targetY[i]     = y;
  wanderTimer[i] = 80 + (Math.random() * 220 | 0);
}

// True if the straight line from (x1,y1) to (x2,y2) passes through no building pixel.
// Ray-marches in 3px steps; skips endpoints so entities near walls aren't self-occluded.
// If fromShelter is true, the origin may be inside a building and the ray skips until
// it exits that building (allows sheltered soldiers to shoot through "windows").
function hasLineOfSight(x1, y1, x2, y2, fromShelter) {
  const dx = x2 - x1, dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return true;
  const steps = Math.ceil(dist / 3);
  const sx = dx / steps, sy = dy / steps;
  // Only allow building-skip when caller is known to be in a shelter
  let exited = true;
  if (fromShelter) {
    const ox = (x1) | 0, oy = (y1) | 0;
    const originInBuilding = (ox >= 0 && ox < canvasW && oy >= 0 && oy < canvasH)
      ? mask[oy * canvasW + ox] === 0 : false;
    exited = !originInBuilding;
  }
  for (let k = 1; k < steps; k++) {
    const px = (x1 + sx * k) | 0;
    const py = (y1 + sy * k) | 0;
    if (px < 0 || px >= canvasW || py < 0 || py >= canvasH) return false;
    if (mask[py * canvasW + px] === 0) {
      if (exited) return false; // hit a different building — blocked
      // still inside origin building, keep going
    } else {
      exited = true; // ray has left the building
    }
  }
  return true;
}

// Module-level scratch vars to avoid per-frame array allocation
let _vx = 0, _vy = 0;

// Compute normalised velocity from (ix,iy) toward (tx,ty) at given speed.
// Result stored in module vars _vx, _vy.
function computeSeek(ix, iy, tx, ty, speed) {
  const dx = tx - ix, dy = ty - iy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) { _vx = 0; _vy = 0; return; }
  _vx = (dx / dist) * speed;
  _vy = (dy / dist) * speed;
}

// ============================================================
// SHELTERS — select buildings as safe zones, render green glow
// ============================================================

/** Pick NUM_SHELTERS buildings from the top 30% largest. */
function selectShelters(buildings) {
  const sorted = buildings.slice().sort((a, b) => (b.w * b.h) - (a.w * a.h));
  const pool   = sorted.slice(0, Math.max(NUM_SHELTERS, Math.ceil(sorted.length * 0.3)));
  // Fisher-Yates partial shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  shelters = pool.slice(0, NUM_SHELTERS).map(b => ({
    x: b.x, y: b.y, w: b.w, h: b.h,
    cx: b.x + b.w / 2, cy: b.y + b.h / 2
  }));
}

/** Draw green glow borders around shelter buildings on the city canvas. */
function renderShelters(ctx) {
  ctx.save();
  ctx.shadowColor   = 'rgba(0, 220, 60, 0.8)';
  ctx.shadowBlur    = 12;
  ctx.strokeStyle   = 'rgba(0, 200, 50, 0.7)';
  ctx.lineWidth     = 2;
  for (const s of shelters) {
    ctx.strokeRect(s.x - 1, s.y - 1, s.w + 2, s.h + 2);
  }
  // Second pass for brighter core
  ctx.shadowBlur  = 4;
  ctx.strokeStyle = 'rgba(0, 255, 80, 0.5)';
  ctx.lineWidth   = 1;
  for (const s of shelters) {
    ctx.strokeRect(s.x, s.y, s.w, s.h);
  }
  ctx.restore();
}

/** Distance from point to nearest edge of a rectangle. Returns 0 if inside. */
function distToRect(px, py, rx, ry, rw, rh) {
  const dx = Math.max(rx - px, 0, px - (rx + rw));
  const dy = Math.max(ry - py, 0, py - (ry + rh));
  return Math.sqrt(dx * dx + dy * dy);
}

// ============================================================
// CITIZEN UPDATE
// ============================================================
function updateCitizen(i) {
  // Saved — wander inside the shelter building
  if (states[i] === 3) {
    const si = shelterIdx[i];
    if (si < 0 || si >= shelters.length) return;
    const s = shelters[si];
    const pad = 4; // inset from walls
    if (wanderTimer[i] <= 0) {
      targetX[i] = s.x + pad + Math.random() * (s.w - pad * 2);
      targetY[i] = s.y + pad + Math.random() * (s.h - pad * 2);
      wanderTimer[i] = 30 + (Math.random() * 60 | 0);
    }
    wanderTimer[i]--;
    computeSeek(posX[i], posY[i], targetX[i], targetY[i], CITIZEN_SPEED * 0.5);
    // Move but clamp to shelter bounds
    posX[i] = Math.max(s.x + pad, Math.min(s.x + s.w - pad, posX[i] + _vx));
    posY[i] = Math.max(s.y + pad, Math.min(s.y + s.h - pad, posY[i] + _vy));
    return;
  }

  const x  = posX[i], y  = posY[i];
  const vR = CITIZEN_VISION_DISTANCE * (NIGHT_CITIZEN_VISION_MULT + daylight * (1 - NIGHT_CITIZEN_VISION_MULT));

  // Scan nearby grid cells for zombies
  let nearestZDist2 = Infinity;
  let nearestZX = 0, nearestZY = 0;

  const minCol = Math.max(0, ((x - vR) / GRID_CELL) | 0);
  const maxCol = Math.min(GRID_COLS - 1, ((x + vR) / GRID_CELL) | 0);
  const minRow = Math.max(0, ((y - vR) / GRID_CELL) | 0);
  const maxRow = Math.min(GRID_ROWS - 1, ((y + vR) / GRID_CELL) | 0);

  for (let gr = minRow; gr <= maxRow; gr++) {
    for (let gc = minCol; gc <= maxCol; gc++) {
      const cell = gridCells[gr * GRID_COLS + gc];
      for (let k = 0; k < cell.length; k++) {
        const j = cell[k];
        if (states[j] !== 2) continue;
        const dx = posX[j] - x, dy = posY[j] - y;
        const d2 = dx * dx + dy * dy;
        if (d2 < vR * vR && d2 < nearestZDist2) {
          if (hasLineOfSight(x, y, posX[j], posY[j])) {
            nearestZDist2 = d2;
            nearestZX = posX[j]; nearestZY = posY[j];
          }
        }
      }
    }
  }

  if (nearestZDist2 < Infinity) {
    // --- PANIC MODE ---
    states[i]     = 1;
    panicTimer[i] = 90;

    // Check if a shelter is nearby — flee toward it instead of random direction
    let shelterTarget = false;
    let bestShelterDist = SHELTER_DETECTION_RANGE;
    let bestSX = 0, bestSY = 0;
    for (const s of shelters) {
      const sd = distToRect(x, y, s.x, s.y, s.w, s.h);
      if (sd < bestShelterDist) {
        bestShelterDist = sd;
        bestSX = s.cx; bestSY = s.cy;
        shelterTarget = true;
      }
    }

    if (shelterTarget) {
      // Flee toward the shelter
      computeSeek(x, y, bestSX, bestSY, PANICKED_SPEED_MULTIPLIER * CITIZEN_SPEED);
    } else {
      // Flee: direction directly away from zombie + angular jitter
      const ang = Math.atan2(y - nearestZY, x - nearestZX)
                + (Math.random() - 0.5) * (Math.PI * 0.55);
      const fleeX = Math.max(0, Math.min(canvasW - 1, x + Math.cos(ang) * 200));
      const fleeY = Math.max(0, Math.min(canvasH - 1, y + Math.sin(ang) * 200));
      computeSeek(x, y, fleeX, fleeY, PANICKED_SPEED_MULTIPLIER * CITIZEN_SPEED);
    }

  } else {
    // --- CALM / RECOVERING ---
    if (states[i] === 1) {
      if (--panicTimer[i] <= 0) states[i] = 0;
    }

    // Wander toward current target; pick a new one when timer expires
    if (wanderTimer[i] <= 0) pickStreetTarget(i);
    wanderTimer[i]--;
    computeSeek(x, y, targetX[i], targetY[i], CITIZEN_SPEED);
  }

  moveEntity(i, _vx, _vy);

  // --- SHELTER ENTRY CHECK (after movement) — only panicked citizens seek shelter ---
  if (states[i] === 1) {
    for (let si = 0; si < shelters.length; si++) {
      const s = shelters[si];
      if (distToRect(posX[i], posY[i], s.x, s.y, s.w, s.h) < SHELTER_ENTRY_DIST) {
        states[i] = 3; // saved!
        shelterIdx[i] = si;
        // Teleport inside the building
        posX[i] = s.cx + (Math.random() - 0.5) * (s.w * 0.6);
        posY[i] = s.cy + (Math.random() - 0.5) * (s.h * 0.6);
        wanderTimer[i] = 0; // pick a wander target next frame
        return;
      }
    }
  }
}

// ============================================================
// ZOMBIE UPDATE
// ============================================================
function updateZombie(i, toInfect) {
  const x    = posX[i], y = posY[i];
  const isSprinter = zombieType[i] === 1;
  const nightVis = NIGHT_ZOMBIE_VISION_MULT + daylight * (1 - NIGHT_ZOMBIE_VISION_MULT);
  const vR   = (isSprinter ? SPRINTER_VISION_DISTANCE : ZOMBIE_VISION_DISTANCE) * nightVis;
  const iR2  = INFECTION_DISTANCE * INFECTION_DISTANCE;
  const nightSpd = 1 + (1 - daylight) * (NIGHT_ZOMBIE_SPEED_MULT - 1);

  let nearestDist2 = Infinity;
  let nearestTX = 0, nearestTY = 0;

  const minCol = Math.max(0, ((x - vR) / GRID_CELL) | 0);
  const maxCol = Math.min(GRID_COLS - 1, ((x + vR) / GRID_CELL) | 0);
  const minRow = Math.max(0, ((y - vR) / GRID_CELL) | 0);
  const maxRow = Math.min(GRID_ROWS - 1, ((y + vR) / GRID_CELL) | 0);

  for (let gr = minRow; gr <= maxRow; gr++) {
    for (let gc = minCol; gc <= maxCol; gc++) {
      const cell = gridCells[gr * GRID_COLS + gc];
      for (let k = 0; k < cell.length; k++) {
        const j = cell[k];
        if (j === i || states[j] === 2 || states[j] === 3 || states[j] === 5) continue; // skip self, zombies, saved, dead
        if (states[j] === 4 && shelterIdx[j] >= 0) continue; // soldier inside shelter — immune

        const dx = posX[j] - x, dy = posY[j] - y;
        const d2 = dx * dx + dy * dy;

        // Infect if within contact distance (soldiers require closer range)
        const infDist = states[j] === 4 ? SOLDIER_INFECTION_DIST : INFECTION_DISTANCE;
        if (d2 < infDist * infDist) toInfect.add(j);

        // Track nearest visible citizen for chasing
        if (d2 < vR * vR && d2 < nearestDist2) {
          nearestDist2 = d2;
          nearestTX = posX[j]; nearestTY = posY[j];
        }
      }
    }
  }

  if (nearestDist2 < Infinity) {
    // --- CHASE MODE ---
    const chaseMult = isSprinter ? SPRINTER_CHASE_SPEED_MULT : ZOMBIE_CHASE_SPEED_MULTIPLIER;
    computeSeek(x, y, nearestTX, nearestTY, chaseMult * CITIZEN_SPEED * nightSpd);
  } else {
    // --- WANDER MODE ---
    if (wanderTimer[i] <= 0) pickStreetTarget(i);
    wanderTimer[i]--;
    const wanderMult = isSprinter ? SPRINTER_WANDER_SPEED_MULT : ZOMBIE_SPEED_MULTIPLIER;
    computeSeek(x, y, targetX[i], targetY[i], wanderMult * CITIZEN_SPEED * nightSpd);
  }

  moveEntity(i, _vx, _vy);
}

// ============================================================
// SPAWN
// ============================================================
function spawnEntities() {
  for (let i = 0; i < numCitizens; i++) {
    let x, y, att = 0;
    do {
      x = (Math.random() * canvasW) | 0;
      y = (Math.random() * canvasH) | 0;
      att++;
    } while (!circlePassable(x, y) && att < 100);

    posX[i]        = x;
    posY[i]        = y;
    states[i]      = 0;
    panicTimer[i]  = 0;
    wanderTimer[i] = (Math.random() * 120) | 0;
    pickStreetTarget(i);
  }

  // Promote a percentage of citizens to soldiers (1% of pop, min 4)
  const soldierCount = Math.min(
    Math.max(SOLDIER_MIN, Math.round(numCitizens * SOLDIER_INITIAL_PCT)),
    numCitizens - 1 // leave at least 1 citizen
  );
  soldierCap = Math.max(soldierCount, Math.round(numCitizens * SOLDIER_MAX_PCT));
  const indices = [];
  for (let i = 0; i < numCitizens; i++) indices.push(i);
  // Fisher-Yates partial shuffle to pick soldierCount random indices
  for (let i = indices.length - 1; i > indices.length - 1 - soldierCount; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  for (let k = 0; k < soldierCount; k++) {
    const si = indices[indices.length - 1 - k];
    states[si] = 4;
    soldierCooldown[si] = 0;
    soldierBarricadeCooldown[si] = 0;
    shelterIdx[si] = -1;
  }

  // Patient zero — only if configured to auto-spawn
  if (INITIAL_ZOMBIE) {
    let pz;
    do { pz = (Math.random() * numCitizens) | 0; } while (states[pz] === 4);
    states[pz]       = 2;
    zombieType[pz]   = 0;  // patient zero is always normal
    wanderTimer[pz]  = 0;
    waveStarted = true;
    waveCalmTimer = WAVE_CALM_FRAMES; // delay before first wave can spawn
  }
}

// Convert the citizen closest to canvas position (mx, my) into the first zombie.
function infectNearestCitizen(mx, my) {
  let bestDist2 = Infinity;
  let bestIdx   = -1;
  for (let i = 0; i < numCitizens; i++) {
    if (states[i] === 2) continue;
    const dx = posX[i] - mx, dy = posY[i] - my;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDist2) { bestDist2 = d2; bestIdx = i; }
  }
  if (bestIdx !== -1) {
    states[bestIdx]      = 2;
    zombieType[bestIdx]  = 0;  // manually selected zombies are normal
    wanderTimer[bestIdx] = 0;
    if (!waveStarted) {
      waveStarted = true;
      waveCalmTimer = WAVE_CALM_FRAMES; // delay before first wave can spawn
    }
  }
}

// ============================================================
// RENDER — three passes to batch by sprite type
// ============================================================
function render() {
  simCtx.clearRect(0, 0, canvasW, canvasH);

  const sc = spriteCitizen,  sp = spritePanicked;
  const sz = spriteZombie,   ss = spriteSprinter, sv = spriteSaved;

  for (let i = 0; i < numCitizens; i++) {
    if (states[i] !== 0) continue;
    simCtx.drawImage(sc.canvas, posX[i] - sc.half, posY[i] - sc.half);
  }
  for (let i = 0; i < numCitizens; i++) {
    if (states[i] !== 1) continue;
    simCtx.drawImage(sp.canvas, posX[i] - sp.half, posY[i] - sp.half);
  }
  for (let i = 0; i < numCitizens; i++) {
    if (states[i] !== 2) continue;
    const spr = zombieType[i] === 1 ? ss : sz;
    simCtx.drawImage(spr.canvas, posX[i] - spr.half, posY[i] - spr.half);
  }

  // Saved citizens (in shelters)
  for (let i = 0; i < numCitizens; i++) {
    if (states[i] !== 3) continue;
    simCtx.drawImage(sv.canvas, posX[i] - sv.half, posY[i] - sv.half);
  }

  // Soldiers
  const so = spriteSoldier;
  for (let i = 0; i < numCitizens; i++) {
    if (states[i] !== 4) continue;
    simCtx.drawImage(so.canvas, posX[i] - so.half, posY[i] - so.half);
  }

  // Shot lines (muzzle flash)
  if (shotLines.length > 0) {
    simCtx.save();
    simCtx.strokeStyle = '#ffff44';
    simCtx.lineWidth = 1.5;
    simCtx.globalAlpha = 0.9;
    for (const sl of shotLines) {
      simCtx.beginPath();
      simCtx.moveTo(sl.x1, sl.y1);
      simCtx.lineTo(sl.x2, sl.y2);
      simCtx.stroke();
    }
    simCtx.restore();
  }

  // Barricades — color shifts from orange (#ff8c00) to dark red (#8b0000) as HP drops
  if (barricades.length > 0) {
    simCtx.lineWidth = BARRICADE_WIDTH;
    simCtx.lineCap = 'round';
    for (const b of barricades) {
      const t = Math.max(0, Math.min(1, b.hp / BARRICADE_HP)); // 1 = full, 0 = destroyed
      const r = Math.round(255 * t + 139 * (1 - t));
      const g = Math.round(140 * t);
      const bl = 0;
      simCtx.strokeStyle = `rgb(${r},${g},${bl})`;
      simCtx.beginPath();
      simCtx.moveTo(b.x1, b.y1);
      simCtx.lineTo(b.x2, b.y2);
      simCtx.stroke();
    }
  }

  // Barricade placement preview — ghost wall fitted to street width
  if (barricadeMode && barricadePreview) {
    const bp = barricadePreview;
    simCtx.strokeStyle = 'rgba(255, 140, 0, 0.5)';
    simCtx.lineWidth = BARRICADE_WIDTH;
    simCtx.lineCap = 'round';
    simCtx.beginPath();
    simCtx.moveTo(bp.x1, bp.y1);
    simCtx.lineTo(bp.x2, bp.y2);
    simCtx.stroke();
  }
}

// ============================================================
// NIGHT OVERLAY — dark blue tint proportional to darkness
// ============================================================
function renderNightOverlay() {
  nightCtx.clearRect(0, 0, canvasW, canvasH);
  const darkness = (1 - daylight) * MAX_NIGHT_OPACITY;
  if (darkness > 0.01) {
    nightCtx.fillStyle = `rgba(5, 5, 25, ${darkness})`;
    nightCtx.fillRect(0, 0, canvasW, canvasH);
  }
}

// ============================================================
// HUD
// ============================================================
function updateHUD() {
  let nc = 0, np = 0, nz = 0, ns = 0, nsol = 0;
  for (let i = 0; i < numCitizens; i++) {
    const s = states[i];
    if (s === 0)      nc++;
    else if (s === 1) np++;
    else if (s === 2) nz++;
    else if (s === 3) ns++;
    else if (s === 4) nsol++;
    // state 5 = dead, not counted
  }
  hudCitizens.textContent = nc;
  hudPanicked.textContent = np;
  hudZombies.textContent  = nz;
  hudSaved.textContent    = ns;
  hudSoldiers.textContent = nsol;
  hudKilled.textContent   = zombiesKilled;
  hudWave.textContent = waveNumber > 0 ? waveNumber : '-';

  // Time-of-day indicator
  let timeLabel, timeColor;
  if (daylight > 0.75) {
    timeLabel = 'DAY';   timeColor = '#ffd700';
  } else if (daylight > 0.35) {
    const sineVal = Math.sin(frameCount * 2 * Math.PI / DAY_NIGHT_CYCLE_LENGTH);
    timeLabel = sineVal > 0 ? 'DUSK' : 'DAWN';
    timeColor = '#cc7722';
  } else {
    timeLabel = 'NIGHT'; timeColor = '#4466aa';
  }
  hudTime.textContent = timeLabel;
  hudTime.style.color = timeColor;

  // Infection rate (updated every 500ms)
  const now = performance.now();
  if (now - lastRateTime >= 500) {
    const dt = (now - lastRateTime) / 1000;
    currentRate = Math.max(0, (nz - lastZombieCount) / dt);
    lastZombieCount = nz;
    lastRateTime = now;
  }
  hudRate.textContent = currentRate.toFixed(1) + '/s';

  // Barricade count
  const remaining = MAX_BARRICADES - barricades.length;
  hudBarricades.textContent = barricadeMode
    ? `${remaining} left [PLACING]`
    : `${remaining} left`;

  // Sample for chart (every 10 frames)
  if (frameCount % 10 === 0) {
    zombieHistory.push(nz);
    savedHistory.push(ns);
    if (zombieHistory.length > CHART_W) zombieHistory.shift();
    if (savedHistory.length  > CHART_W) savedHistory.shift();
    renderChart();
  }

  return { nc, np, nz, ns, nsol };
}

function renderChart() {
  chartCanvas.width  = CHART_W;
  chartCanvas.height = CHART_H;
  const ctx = chartCtx;
  const len = zombieHistory.length;
  if (len < 2) return;

  ctx.clearRect(0, 0, CHART_W, CHART_H);

  // Draw infection curve
  const max = numCitizens;
  const pad = 4;
  const w = CHART_W - pad * 2;
  const h = CHART_H - pad * 2;

  ctx.beginPath();
  ctx.strokeStyle = '#cc2222';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < len; i++) {
    const x = pad + (i / (len - 1)) * w;
    const y = pad + h - (zombieHistory[i] / max) * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Fill under infection curve
  const lastX = pad + w;
  ctx.lineTo(lastX, pad + h);
  ctx.lineTo(pad, pad + h);
  ctx.closePath();
  ctx.fillStyle = 'rgba(210, 25, 25, 0.15)';
  ctx.fill();

  // Draw saved curve
  ctx.beginPath();
  ctx.strokeStyle = '#00cc44';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < len; i++) {
    const x = pad + (i / (len - 1)) * w;
    const y = pad + h - (savedHistory[i] / max) * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Fill under saved curve
  ctx.lineTo(pad + w, pad + h);
  ctx.lineTo(pad, pad + h);
  ctx.closePath();
  ctx.fillStyle = 'rgba(0, 200, 60, 0.10)';
  ctx.fill();

  // Key
  ctx.font = '9px Courier New';
  ctx.fillStyle = '#cc2222';
  ctx.fillRect(pad + 2, pad + 2, 8, 2);
  ctx.fillStyle = 'rgba(200,200,200,0.6)';
  ctx.fillText('INFECTED', pad + 14, pad + 6);

  ctx.fillStyle = '#00cc44';
  ctx.fillRect(pad + 2, pad + 11, 8, 2);
  ctx.fillStyle = 'rgba(200,200,200,0.6)';
  ctx.fillText('SAVED', pad + 14, pad + 15);
}

// ============================================================
// SOLDIER UPDATE — scan, shoot, place barricades, patrol
// ============================================================
function updateSoldier(i, toKill) {
  const x = posX[i], y = posY[i];
  const vR = SOLDIER_VISION;
  const sR2 = SOLDIER_SHOOT_RANGE * SOLDIER_SHOOT_RANGE;
  const inShelter = shelterIdx[i] >= 0;

  // Scan for zombies in vision range
  let nearestZDist2 = Infinity;
  let nearestZIdx = -1;
  let zombiesInVision = 0;
  let avgZX = 0, avgZY = 0;

  const minCol = Math.max(0, ((x - vR) / GRID_CELL) | 0);
  const maxCol = Math.min(GRID_COLS - 1, ((x + vR) / GRID_CELL) | 0);
  const minRow = Math.max(0, ((y - vR) / GRID_CELL) | 0);
  const maxRow = Math.min(GRID_ROWS - 1, ((y + vR) / GRID_CELL) | 0);

  for (let gr = minRow; gr <= maxRow; gr++) {
    for (let gc = minCol; gc <= maxCol; gc++) {
      const cell = gridCells[gr * GRID_COLS + gc];
      for (let k = 0; k < cell.length; k++) {
        const j = cell[k];
        if (states[j] !== 2) continue; // only interested in zombies
        const dx = posX[j] - x, dy = posY[j] - y;
        const d2 = dx * dx + dy * dy;
        if (d2 < vR * vR) {
          zombiesInVision++;
          avgZX += posX[j];
          avgZY += posY[j];
          if (d2 < nearestZDist2) {
            nearestZDist2 = d2;
            nearestZIdx = j;
          }
        }
      }
    }
  }

  // Shoot nearest zombie if in range, cooldown expired, and line of sight clear
  if (nearestZIdx >= 0 && nearestZDist2 <= sR2 && soldierCooldown[i] <= 0) {
    if (hasLineOfSight(x, y, posX[nearestZIdx], posY[nearestZIdx], inShelter)) {
      if (Math.random() < SOLDIER_KILL_CHANCE) {
        toKill.add(nearestZIdx);
      }
      shotLines.push({
        x1: x, y1: y,
        x2: posX[nearestZIdx], y2: posY[nearestZIdx],
        ttl: 8
      });
      soldierCooldown[i] = SOLDIER_SHOOT_COOLDOWN;
    }
  }

  // Barricade placement — cluster of zombies approaching (not while in shelter)
  if (!inShelter
      && zombiesInVision >= SOLDIER_BARRICADE_ZOMBIE_THRESHOLD
      && soldierBarricadeCooldown[i] <= 0
      && barricades.length < MAX_BARRICADES) {
    avgZX /= zombiesInVision;
    avgZY /= zombiesInVision;
    // Place barricade 40% of the way toward zombie cluster
    const bx = x + (avgZX - x) * 0.4;
    const by = y + (avgZY - y) * 0.4;
    const b = computeStreetBarricade(bx, by);
    if (b) {
      b.hp = BARRICADE_HP;
      barricades.push(b);
      stampBarricadeLine(b.x1, b.y1, b.x2, b.y2);
      soldierBarricadeCooldown[i] = SOLDIER_BARRICADE_COOLDOWN;
    }
  }

  // Decrement cooldowns
  if (soldierCooldown[i] > 0) soldierCooldown[i]--;
  if (soldierBarricadeCooldown[i] > 0) soldierBarricadeCooldown[i]--;

  // --- SHELTER BEHAVIOR ---
  if (inShelter) {
    const si = shelterIdx[i];
    const s = shelters[si];
    const pad = 4;

    if (zombiesInVision === 0) {
      // Count down to leave shelter
      if (--wanderTimer[i] <= 0) {
        // Safe enough — leave shelter and resume patrol
        // Step outside the shelter building — try each side, pick first passable
        const exits = [
          { x: s.x - 6,         y: s.cy },
          { x: s.x + s.w + 6,   y: s.cy },
          { x: s.cx,             y: s.y - 6 },
          { x: s.cx,             y: s.y + s.h + 6 }
        ];
        const startSide = (Math.random() * 4) | 0;
        let exitFound = false;
        for (let e = 0; e < 4; e++) {
          const exit = exits[(startSide + e) % 4];
          if (circlePassable(exit.x, exit.y)) {
            posX[i] = exit.x; posY[i] = exit.y;
            shelterIdx[i] = -1;
            pickStreetTarget(i);
            exitFound = true;
            break;
          }
        }
        if (exitFound) {
          return; // soldier left shelter — skip shelter wander
        }
        // All exits blocked — stay in shelter, retry later
        wanderTimer[i] = 60;
      }
    } else {
      // Zombies visible — stay in shelter, reset leave timer
      wanderTimer[i] = SOLDIER_SHELTER_LEAVE_FRAMES;
    }

    // Wander inside shelter (same as saved citizens)
    const tx = s.x + pad + Math.random() * (s.w - pad * 2);
    const ty = s.y + pad + Math.random() * (s.h - pad * 2);
    computeSeek(x, y, tx, ty, SOLDIER_SPEED * 0.3);
    posX[i] = Math.max(s.x + pad, Math.min(s.x + s.w - pad, x + _vx));
    posY[i] = Math.max(s.y + pad, Math.min(s.y + s.h - pad, y + _vy));
    return;
  }

  // --- RETREAT TO SHELTER — when heavily outnumbered ---
  if (zombiesInVision >= SOLDIER_SHELTER_RETREAT_RATIO) {
    let bestSD = SHELTER_DETECTION_RANGE;
    let bestSI = -1;
    for (let si = 0; si < shelters.length; si++) {
      const sd = distToRect(x, y, shelters[si].x, shelters[si].y, shelters[si].w, shelters[si].h);
      if (sd < bestSD) { bestSD = sd; bestSI = si; }
    }
    if (bestSI >= 0) {
      const s = shelters[bestSI];
      if (bestSD < SHELTER_ENTRY_DIST) {
        // Enter shelter
        shelterIdx[i] = bestSI;
        posX[i] = s.cx + (Math.random() - 0.5) * (s.w * 0.6);
        posY[i] = s.cy + (Math.random() - 0.5) * (s.h * 0.6);
        wanderTimer[i] = SOLDIER_SHELTER_LEAVE_FRAMES;
        return;
      }
      // Move toward shelter
      computeSeek(x, y, s.cx, s.cy, SOLDIER_SPEED);
      moveEntity(i, _vx, _vy);
      return;
    }
  }

  // --- NORMAL MOVEMENT ---
  if (nearestZIdx >= 0 && nearestZDist2 > sR2) {
    // Move toward zombie — out of shoot range
    computeSeek(x, y, posX[nearestZIdx], posY[nearestZIdx], SOLDIER_SPEED);
  } else if (nearestZIdx < 0) {
    // No threats — patrol streets
    if (wanderTimer[i] <= 0) pickStreetTarget(i);
    wanderTimer[i]--;
    computeSeek(x, y, targetX[i], targetY[i], SOLDIER_SPEED);
  } else {
    // In firing range — hold position with slight drift
    if (wanderTimer[i] <= 0) pickStreetTarget(i);
    wanderTimer[i]--;
    computeSeek(x, y, targetX[i], targetY[i], SOLDIER_SPEED * 0.3);
  }

  moveEntity(i, _vx, _vy);
}

// ============================================================
// WAVE SPAWNING — recycle dead slots, spawn zombies from edges
// ============================================================

/** Find a street-passable position near a random map edge. */
function pickEdgeSpawn() {
  const edge = (Math.random() * 4) | 0; // 0=top, 1=right, 2=bottom, 3=left
  const margin = 15; // px inset from canvas edge
  for (let att = 0; att < 60; att++) {
    let x, y;
    switch (edge) {
      case 0: x = (Math.random() * canvasW) | 0; y = margin + (Math.random() * 20) | 0; break;
      case 1: x = canvasW - margin - (Math.random() * 20) | 0; y = (Math.random() * canvasH) | 0; break;
      case 2: x = (Math.random() * canvasW) | 0; y = canvasH - margin - (Math.random() * 20) | 0; break;
      case 3: x = margin + (Math.random() * 20) | 0; y = (Math.random() * canvasH) | 0; break;
    }
    if (circlePassable(x, y)) return { x, y };
  }
  // Fallback: any street position
  for (let att = 0; att < 40; att++) {
    const x = (Math.random() * canvasW) | 0;
    const y = (Math.random() * canvasH) | 0;
    if (circlePassable(x, y)) return { x, y };
  }
  return null;
}

/** Spawn a wave of zombies by recycling dead entity slots, or converting edge citizens. */
function spawnWave() {
  waveNumber++;
  const count = WAVE_BASE_SIZE + (waveNumber - 1) * WAVE_SIZE_INCREASE;
  const sprinterChance = Math.min(0.5, SPRINTER_CHANCE + waveNumber * WAVE_SPRINTER_RAMP);
  let spawned = 0;

  // First pass: recycle dead (state 5) slots
  for (let i = 0; i < numCitizens && spawned < count; i++) {
    if (states[i] !== 5) continue;
    const pos = pickEdgeSpawn();
    if (!pos) continue;
    posX[i] = pos.x;
    posY[i] = pos.y;
    states[i] = 2;
    zombieType[i] = Math.random() < sprinterChance ? 1 : 0;
    wanderTimer[i] = 0;
    shelterIdx[i] = -1;
    spawned++;
  }

  // Second pass: if not enough dead slots, convert calm citizens (state 0) near edges
  if (spawned < count) {
    const edgeDist = 80; // px from canvas edge
    for (let i = 0; i < numCitizens && spawned < count; i++) {
      if (states[i] !== 0) continue;
      const ex = posX[i], ey = posY[i];
      if (ex < edgeDist || ex > canvasW - edgeDist || ey < edgeDist || ey > canvasH - edgeDist) {
        const pos = pickEdgeSpawn();
        if (!pos) continue;
        posX[i] = pos.x;
        posY[i] = pos.y;
        states[i] = 2;
        zombieType[i] = Math.random() < sprinterChance ? 1 : 0;
        wanderTimer[i] = 0;
        spawned++;
      }
    }
  }
}

/** Spawn 1–2 soldier reinforcements by recycling dead entity slots. */
function spawnReinforcements() {
  // Count current living soldiers
  let currentSoldiers = 0;
  for (let i = 0; i < numCitizens; i++) if (states[i] === 4) currentSoldiers++;
  if (currentSoldiers >= soldierCap) return; // at cap

  const toSpawn = Math.min(2, soldierCap - currentSoldiers);
  let spawned = 0;

  for (let i = 0; i < numCitizens && spawned < toSpawn; i++) {
    if (states[i] !== 5) continue; // only recycle dead slots
    const pos = pickEdgeSpawn();
    if (!pos) continue;
    posX[i] = pos.x;
    posY[i] = pos.y;
    states[i] = 4;
    soldierCooldown[i] = 0;
    soldierBarricadeCooldown[i] = 0;
    shelterIdx[i] = -1;
    wanderTimer[i] = 0;
    spawned++;
  }
}

// ============================================================
// GAME LOOP
// ============================================================
let rafHandle  = null;
let frameCount = 0;
let startTime  = 0;
let lastZombieCount = 0;
let lastRateTime    = 0;
let currentRate     = 0;
const CHART_W       = 200;
const CHART_H       = 80;
const zombieHistory  = [];  // sampled zombie counts for the chart
const savedHistory   = [];  // sampled saved counts for the chart

function simStep() {
  frameCount++;

  // 0. Update day/night cycle
  daylight = 0.5 + 0.5 * Math.cos(frameCount * 2 * Math.PI / DAY_NIGHT_CYCLE_LENGTH);

  // 1. Rebuild spatial grid each frame
  rebuildGrid();

  // 2. Update all entities; collect infections and kills in Sets (deferred)
  const toInfect = new Set();
  const toKill   = new Set();
  for (let i = 0; i < numCitizens; i++) {
    const st = states[i];
    if (st === 5) continue; // dead — skip
    if (st === 2)      updateZombie(i, toInfect);
    else if (st === 4) updateSoldier(i, toKill);
    else               updateCitizen(i);
  }

  // 3. Apply infections after full update (avoids mid-loop state mutation)
  for (const idx of toInfect) {
    if (states[idx] === 3 || states[idx] === 5) continue; // sheltered or dead — immune
    states[idx]      = 2;
    zombieType[idx]  = Math.random() < SPRINTER_CHANCE ? 1 : 0;
    wanderTimer[idx] = 0;
    shelterIdx[idx]  = -1; // clear shelter if soldier was infected
    stampHeat(posX[idx], posY[idx], 0.15);
  }

  // 4. Apply soldier kills
  for (const idx of toKill) {
    if (states[idx] === 2) { states[idx] = 5; zombiesKilled++; }
  }

  // 5. Barricade bashing — zombies and panicked citizens damage nearby barricades
  if (barricades.length > 0) {
    for (let i = 0; i < numCitizens; i++) {
      const st = states[i];
      if (st !== 2 && st !== 1) continue; // only zombies and panicked
      const dps = st === 2 ? BARRICADE_ZOMBIE_DPS : BARRICADE_PANICKED_DPS;
      const ex = posX[i], ey = posY[i];
      for (let b = 0; b < barricades.length; b++) {
        const bar = barricades[b];
        if (distToSegment(ex, ey, bar.x1, bar.y1, bar.x2, bar.y2) < BARRICADE_BASH_DIST) {
          bar.hp -= dps;
          break; // each entity bashes at most one barricade per frame
        }
      }
    }
    // Remove destroyed barricades
    for (let b = barricades.length - 1; b >= 0; b--) {
      if (barricades[b].hp <= 0) {
        const bar = barricades[b];
        eraseBarricadeLine(bar.x1, bar.y1, bar.x2, bar.y2);
        barricades.splice(b, 1);
      }
    }
  }

  // 6. Decay shot line TTLs
  for (let s = shotLines.length - 1; s >= 0; s--) {
    if (--shotLines[s].ttl <= 0) shotLines.splice(s, 1);
  }

  // 7. Wave spawning — when all zombies are dead but citizens remain
  if (waveStarted) {
    let nzNow = 0, nsolNow = 0;
    for (let i = 0; i < numCitizens; i++) {
      if (states[i] === 2) nzNow++;
      else if (states[i] === 4) nsolNow++;
    }

    if (nzNow === 0) {
      // Count remaining civilians
      let civLeft = 0;
      for (let i = 0; i < numCitizens; i++) if (states[i] === 0 || states[i] === 1) civLeft++;
      if (civLeft > 0) {
        if (waveCalmTimer <= 0) {
          spawnWave();
          waveCalmTimer = WAVE_CALM_FRAMES;
        } else {
          waveCalmTimer--;
        }
      }
    }

    // 8. Soldier reinforcements — spawn when outnumbered
    if (--reinforceTimer <= 0) {
      reinforceTimer = SOLDIER_REINFORCE_INTERVAL;
      if (nsolNow > 0 && nzNow > nsolNow * SOLDIER_REINFORCE_RATIO) {
        spawnReinforcements();
      }
    }
  }
}

function gameLoop() {
  if (!paused && !waitingForPatientZero) {
    for (let s = 0; s < simSpeed; s++) {
      simStep();
    }
  }

  // 3b. Zombies radiate low heat as they wander
  if (heatMapEnabled && frameCount % 6 === 0) {
    for (let i = 0; i < numCitizens; i++) {
      if (states[i] === 2) stampHeat(posX[i], posY[i], 0.008);
    }
  }

  // 4. Render heat map, entities, night overlay, and update HUD
  renderHeatMap();
  render();
  renderNightOverlay();
  const { nc, np, nz, ns, nsol } = updateHUD();

  // 5. Win condition — no civilians left (all are zombie, saved, soldier, or dead)
  if (nc + np === 0 && frameCount > 0) {
    const secs = (frameCount / 60).toFixed(0);

    if (ns > 0) {
      // Survivors made it to shelters
      endTitle.textContent = 'SURVIVORS FOUND';
      endTitle.style.textShadow = '0 0 40px rgba(30, 255, 60, 0.9), 0 0 80px rgba(0, 200, 50, 0.4)';
      endOverlay.style.background = 'rgba(0, 60, 20, 0.72)';
      const waveStr = waveNumber > 0 ? ` — survived ${waveNumber} wave${waveNumber > 1 ? 's' : ''}` : '';
      const killStr = zombiesKilled > 0 ? `, ${zombiesKilled} zombies killed` : '';
      endMessage.textContent =
        `${ns} saved, ${nsol} soldiers${killStr}, ${nz} infected${waveStr} — ${frameCount} frames (~${secs}s)`;
    } else {
      // Total infection
      endTitle.textContent = 'INFECTION COMPLETE';
      endTitle.style.textShadow = '0 0 40px rgba(255, 30, 30, 0.9), 0 0 80px rgba(255, 0, 0, 0.4)';
      endOverlay.style.background = 'rgba(90, 0, 0, 0.72)';
      const waveStr = waveNumber > 0 ? ` — wave ${waveNumber}` : '';
      const killStr = zombiesKilled > 0 ? `, ${zombiesKilled} killed` : '';
      endMessage.textContent =
        `All overrun — ${nz} infected${killStr}${waveStr} — ${frameCount} frames (~${secs}s)`;
    }

    endOverlay.style.display = 'flex';

    // Demo mode: auto-restart after delay
    if (demoMode) {
      demoTimer = setTimeout(init, DEMO_RESTART_DELAY);
    }
    return; // stop loop
  }

  rafHandle = requestAnimationFrame(gameLoop);
}

// ============================================================
// DEMO MODE — ?demo in URL for hands-free autoplay loop
// ============================================================
const demoMode = new URLSearchParams(window.location.search).has('demo');
const DEMO_RESTART_DELAY = 5000; // ms to show end screen before restarting
let demoTimer = null;

// ============================================================
// INIT & RESTART
// ============================================================
function init() {
  if (rafHandle) { cancelAnimationFrame(rafHandle); rafHandle = null; }
  if (demoTimer) { clearTimeout(demoTimer); demoTimer = null; }

  // Read population from slider, or randomize in demo mode
  if (demoMode) {
    numCitizens = 400 + ((Math.random() * 53) | 0) * 50; // 400–3000 in steps of 50
  } else {
    const popSlider = document.getElementById('pop-slider');
    if (popSlider) {
      numCitizens = parseInt(popSlider.value, 10);
      const popLabel = document.getElementById('cnt-pop');
      if (popLabel) popLabel.textContent = numCitizens;
    }
  }
  allocateArrays(numCitizens);

  setupCanvases();
  initSprites();
  initGrid();
  initBarricadeMask();

  const buildings = generateCity(canvasW, canvasH);
  mask = buildStreetMask(buildings, canvasW, canvasH);
  renderCity(cityCtx, buildings, canvasW, canvasH);

  initHeatMap();
  selectShelters(buildings);
  renderShelters(cityCtx);

  spawnEntities();

  endOverlay.style.display = 'none';

  // Reset game state BEFORE demo/patient-zero setup
  frameCount = 0;
  startTime  = performance.now();
  lastZombieCount = INITIAL_ZOMBIE ? 1 : 0;
  lastRateTime    = startTime;
  currentRate     = 0;
  zombieHistory.length = 0;
  savedHistory.length  = 0;
  daylight       = 1.0;
  barricades     = [];
  barricadeMode  = false;
  shotLines      = [];
  waveNumber     = 0;
  waveCalmTimer  = 0;
  waveStarted    = false;
  reinforceTimer = 0;
  zombiesKilled  = 0;

  if (demoMode) {
    // Auto-pick 1–3 patient zeros, skip overlay entirely
    waitingForPatientZero = false;
    pzOverlay.style.display = 'none';
    const pzCount_ = 1 + ((Math.random() * 3) | 0);
    for (let p = 0; p < pzCount_; p++) {
      let idx;
      do { idx = (Math.random() * numCitizens) | 0; } while (states[idx] === 2 || states[idx] === 4);
      states[idx]      = 2;
      zombieType[idx]  = 0;
      wanderTimer[idx] = 0;
    }
    waveStarted = true;
    waveCalmTimer = WAVE_CALM_FRAMES; // delay before first wave can spawn
  } else {
    waitingForPatientZero = !INITIAL_ZOMBIE;
    patientZeroCount = 0;
    pzOverlay.style.display = waitingForPatientZero ? 'flex' : 'none';
    if (pzCount) pzCount.textContent = '';
  }

  rafHandle  = requestAnimationFrame(gameLoop);
}

// Start on load
init();

// Click: barricade placement, patient zero selection, or restart
window.addEventListener('click', (e) => {
  if (endOverlay.style.display !== 'none') { init(); return; }

  // Barricade placement — single click stamps the street-fitted wall
  if (barricadeMode && !waitingForPatientZero) {
    if (barricadePreview && barricades.length < MAX_BARRICADES) {
      const b = { ...barricadePreview, hp: BARRICADE_HP };
      barricades.push(b);
      stampBarricadeLine(b.x1, b.y1, b.x2, b.y2);
      if (barricades.length >= MAX_BARRICADES) barricadeMode = false;
    }
    return;
  }

  if (waitingForPatientZero) {
    infectNearestCitizen(e.clientX, e.clientY);
    patientZeroCount++;
    if (pzCount) pzCount.textContent = `${patientZeroCount} selected — ENTER to begin`;
  }
});

// Keydown: speed, multi-pz, heat map, barricades, restart
window.addEventListener('keydown', (e) => {
  if (endOverlay.style.display !== 'none') { init(); return; }

  // Multi-patient-zero: Enter confirms selection
  if (waitingForPatientZero && e.key === 'Enter' && patientZeroCount > 0) {
    waitingForPatientZero = false;
    pzOverlay.style.display = 'none';
    return;
  }

  // Heat map toggle
  if (e.key === 'h' || e.key === 'H') {
    heatMapEnabled = !heatMapEnabled;
    if (!heatMapEnabled) heatCtx.clearRect(0, 0, canvasW, canvasH);
    return;
  }

  // Barricade mode toggle
  if ((e.key === 'b' || e.key === 'B') && barricades.length < MAX_BARRICADES) {
    barricadeMode = !barricadeMode;
    barricadePreview = barricadeMode ? computeStreetBarricade(mouseX, mouseY) : null;
    return;
  }
  if (e.key === 'Escape') {
    barricadeMode = false;
    barricadePreview = null;
    return;
  }

  switch (e.key) {
    case '1': simSpeed = 1; paused = false; break;
    case '2': simSpeed = 2; paused = false; break;
    case '3': simSpeed = 5; paused = false; break;
    case ' ':
      e.preventDefault();
      paused = !paused;
      break;
    default: return;
  }
  hudSpeed.textContent = paused ? '||' : simSpeed + 'x';
});

// Track mouse position; recompute barricade preview when in placement mode
window.addEventListener('mousemove', (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;
  if (barricadeMode) {
    barricadePreview = computeStreetBarricade(mouseX, mouseY);
  }
});

// Population slider — only active during patient-zero setup, reinits with new count
const _popSlider = document.getElementById('pop-slider');
if (_popSlider) {
  _popSlider.addEventListener('input', () => {
    const lbl = document.getElementById('cnt-pop');
    if (lbl) lbl.textContent = _popSlider.value;
  });
  _popSlider.addEventListener('change', () => {
    if (waitingForPatientZero) init();
  });
}

// Restart on resize (city proportions change with canvas dimensions)
let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(init, 150);
});
