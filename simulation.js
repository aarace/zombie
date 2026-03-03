// simulation.js — Zombie city infection simulation

import { generateCity, buildStreetMask, renderCity } from './city.js';

// ============================================================
// CONFIGURATION — tweak these to change simulation behaviour
// ============================================================
const NUM_CITIZENS                  = 1000;   // total population
const DOT_RADIUS                    = 2;      // visual radius of every dot (px)
const CITIZEN_SPEED                 = 1.2;    // px per frame
const PANICKED_SPEED_MULTIPLIER     = 2.0;    // multiplier on CITIZEN_SPEED when panicked
const ZOMBIE_SPEED_MULTIPLIER       = 0.5;    // zombie wander speed multiplier
const ZOMBIE_CHASE_SPEED_MULTIPLIER = 2.0;    // zombie chase speed multiplier
const CITIZEN_VISION_DISTANCE       = 60;    // px — how far a citizen can see a zombie
const ZOMBIE_VISION_DISTANCE        = 150;    // px — how far a zombie can see a citizen
const INFECTION_DISTANCE            = 10;     // px — contact distance for infection
const INITIAL_ZOMBIE                = true;  // true = auto-spawn patient zero; false = click a citizen to start

// Day/night cycle
const DAY_NIGHT_CYCLE_LENGTH        = 1800;  // frames per full cycle (~30s at 60fps)
const MAX_NIGHT_OPACITY             = 0.55;  // darkness overlay max opacity
const NIGHT_CITIZEN_VISION_MULT     = 0.35;  // citizen vision at midnight (fraction of base)
const NIGHT_ZOMBIE_VISION_MULT      = 0.70;  // zombie vision at midnight
const NIGHT_ZOMBIE_SPEED_MULT       = 1.35;  // zombie speed multiplier at midnight

// ============================================================
// CANVAS & DOM
// ============================================================
const cityCanvas = document.getElementById('city-canvas');
const simCanvas  = document.getElementById('sim-canvas');
const cityCtx    = cityCanvas.getContext('2d');
const simCtx     = simCanvas.getContext('2d');
const nightCanvas = document.getElementById('night-canvas');
const nightCtx    = nightCanvas.getContext('2d');

const hudCitizens = document.getElementById('cnt-citizens');
const hudPanicked = document.getElementById('cnt-panicked');
const hudZombies  = document.getElementById('cnt-zombies');
const hudTime     = document.getElementById('cnt-time');
const endOverlay  = document.getElementById('end-overlay');
const endMessage  = document.getElementById('end-message');
const pzOverlay   = document.getElementById('pz-overlay');

let waitingForPatientZero = false;
let daylight = 1.0; // 1.0 = noon, 0.0 = midnight

let canvasW = 0, canvasH = 0;

function setupCanvases() {
  canvasW = window.innerWidth;
  canvasH = window.innerHeight;
  cityCanvas.width  = canvasW;  cityCanvas.height = canvasH;
  simCanvas.width   = canvasW;  simCanvas.height  = canvasH;
  nightCanvas.width = canvasW;  nightCanvas.height = canvasH;
}

// ============================================================
// ENTITY STATE — parallel typed arrays for cache efficiency
// state: 0 = citizen, 1 = panicked, 2 = zombie
// ============================================================
const posX        = new Float32Array(NUM_CITIZENS);
const posY        = new Float32Array(NUM_CITIZENS);
const targetX     = new Float32Array(NUM_CITIZENS);
const targetY     = new Float32Array(NUM_CITIZENS);
const states      = new Uint8Array(NUM_CITIZENS);
const wanderTimer = new Int16Array(NUM_CITIZENS);
const panicTimer  = new Int16Array(NUM_CITIZENS);

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

let spriteCitizen, spritePanicked, spriteZombie;

function initSprites() {
  spriteCitizen  = createSprite(255, 255, 255);
  spritePanicked = createSprite(255, 215,   0);
  spriteZombie   = createSprite(210,  25,  25);
}

// ============================================================
// SPATIAL GRID — uniform grid for O(1) neighbour queries
// Cell size = largest vision radius → at most 3×3 cells to check
// ============================================================
const GRID_CELL = Math.max(ZOMBIE_VISION_DISTANCE, CITIZEN_VISION_DISTANCE);
let GRID_COLS = 0, GRID_ROWS = 0, gridCells;

function initGrid() {
  GRID_COLS = Math.ceil(canvasW / GRID_CELL) + 1;
  GRID_ROWS = Math.ceil(canvasH / GRID_CELL) + 1;
  gridCells = Array.from({ length: GRID_COLS * GRID_ROWS }, () => []);
}

function rebuildGrid() {
  for (let c = 0; c < gridCells.length; c++) gridCells[c].length = 0;
  for (let i = 0; i < NUM_CITIZENS; i++) {
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

// Attempt to move entity i by (vx, vy).
// Applies wall sliding; if fully blocked by a corner, sweeps up to 8 rotated
// escape directions so entities never freeze against building corners.
function moveEntity(i, vx, vy) {
  const x = posX[i], y = posY[i];
  const nx = x + vx, ny = y + vy;

  // Full diagonal move
  if (circlePassable(nx, ny)) {
    posX[i] = nx; posY[i] = ny;
    return;
  }

  // Wall slide: X-only
  if (circlePassable(nx, y)) { posX[i] = nx; return; }

  // Wall slide: Y-only
  if (circlePassable(x, ny)) { posY[i] = ny; return; }

  // Corner stuck: sweep ±45° increments from desired direction until passable
  const s    = Math.sqrt(vx * vx + vy * vy) || CITIZEN_SPEED;
  const base = Math.atan2(vy, vx);

  for (let k = 1; k <= 4; k++) {
    const delta = k * (Math.PI / 4);

    let ex = x + Math.cos(base + delta) * s;
    let ey = y + Math.sin(base + delta) * s;
    if (circlePassable(ex, ey)) {
      posX[i] = ex; posY[i] = ey;
      // Steer in the escape direction for a short while to clear the corner
      targetX[i]     = Math.max(0, Math.min(canvasW, x + Math.cos(base + delta) * 200));
      targetY[i]     = Math.max(0, Math.min(canvasH, y + Math.sin(base + delta) * 200));
      wanderTimer[i] = 20 + (Math.random() * 40 | 0);
      return;
    }

    ex = x + Math.cos(base - delta) * s;
    ey = y + Math.sin(base - delta) * s;
    if (circlePassable(ex, ey)) {
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
function hasLineOfSight(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return true;
  const steps = Math.ceil(dist / 3);
  const sx = dx / steps, sy = dy / steps;
  for (let k = 1; k < steps; k++) {
    const px = (x1 + sx * k) | 0;
    const py = (y1 + sy * k) | 0;
    if (px < 0 || px >= canvasW || py < 0 || py >= canvasH) return false;
    if (mask[py * canvasW + px] === 0) return false;
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
// CITIZEN UPDATE
// ============================================================
function updateCitizen(i) {
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

    // Flee: direction directly away from zombie + angular jitter
    const ang = Math.atan2(y - nearestZY, x - nearestZX)
              + (Math.random() - 0.5) * (Math.PI * 0.55);
    const fleeX = Math.max(0, Math.min(canvasW - 1, x + Math.cos(ang) * 200));
    const fleeY = Math.max(0, Math.min(canvasH - 1, y + Math.sin(ang) * 200));
    computeSeek(x, y, fleeX, fleeY, PANICKED_SPEED_MULTIPLIER * CITIZEN_SPEED);

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
}

// ============================================================
// ZOMBIE UPDATE
// ============================================================
function updateZombie(i, toInfect) {
  const x   = posX[i], y   = posY[i];
  const vR  = ZOMBIE_VISION_DISTANCE * (NIGHT_ZOMBIE_VISION_MULT + daylight * (1 - NIGHT_ZOMBIE_VISION_MULT));
  const iR2 = INFECTION_DISTANCE * INFECTION_DISTANCE;
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
        if (j === i || states[j] === 2) continue; // skip self & other zombies

        const dx = posX[j] - x, dy = posY[j] - y;
        const d2 = dx * dx + dy * dy;

        // Infect if within contact distance
        if (d2 < iR2) toInfect.add(j);

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
    computeSeek(x, y, nearestTX, nearestTY, ZOMBIE_CHASE_SPEED_MULTIPLIER * CITIZEN_SPEED * nightSpd);
  } else {
    // --- WANDER MODE ---
    if (wanderTimer[i] <= 0) pickStreetTarget(i);
    wanderTimer[i]--;
    computeSeek(x, y, targetX[i], targetY[i], ZOMBIE_SPEED_MULTIPLIER * CITIZEN_SPEED * nightSpd);
  }

  moveEntity(i, _vx, _vy);
}

// ============================================================
// SPAWN
// ============================================================
function spawnEntities() {
  for (let i = 0; i < NUM_CITIZENS; i++) {
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

  // Patient zero — only if configured to auto-spawn
  if (INITIAL_ZOMBIE) {
    const pz        = (Math.random() * NUM_CITIZENS) | 0;
    states[pz]      = 2;
    wanderTimer[pz] = 0;
  }
}

// Convert the citizen closest to canvas position (mx, my) into the first zombie.
function infectNearestCitizen(mx, my) {
  let bestDist2 = Infinity;
  let bestIdx   = -1;
  for (let i = 0; i < NUM_CITIZENS; i++) {
    if (states[i] === 2) continue;
    const dx = posX[i] - mx, dy = posY[i] - my;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDist2) { bestDist2 = d2; bestIdx = i; }
  }
  if (bestIdx !== -1) {
    states[bestIdx]      = 2;
    wanderTimer[bestIdx] = 0;
  }
}

// ============================================================
// RENDER — three passes to batch by sprite type
// ============================================================
function render() {
  simCtx.clearRect(0, 0, canvasW, canvasH);

  const sc = spriteCitizen,  sp = spritePanicked,  sz = spriteZombie;

  for (let i = 0; i < NUM_CITIZENS; i++) {
    if (states[i] !== 0) continue;
    simCtx.drawImage(sc.canvas, posX[i] - sc.half, posY[i] - sc.half);
  }
  for (let i = 0; i < NUM_CITIZENS; i++) {
    if (states[i] !== 1) continue;
    simCtx.drawImage(sp.canvas, posX[i] - sp.half, posY[i] - sp.half);
  }
  for (let i = 0; i < NUM_CITIZENS; i++) {
    if (states[i] !== 2) continue;
    simCtx.drawImage(sz.canvas, posX[i] - sz.half, posY[i] - sz.half);
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
  let nc = 0, np = 0, nz = 0;
  for (let i = 0; i < NUM_CITIZENS; i++) {
    const s = states[i];
    if (s === 0) nc++;
    else if (s === 1) np++;
    else nz++;
  }
  hudCitizens.textContent = nc;
  hudPanicked.textContent = np;
  hudZombies.textContent  = nz;

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

  return nz;
}

// ============================================================
// GAME LOOP
// ============================================================
let rafHandle  = null;
let frameCount = 0;

function gameLoop() {
  frameCount++;

  // 0. Update day/night cycle
  daylight = 0.5 + 0.5 * Math.cos(frameCount * 2 * Math.PI / DAY_NIGHT_CYCLE_LENGTH);

  // 1. Rebuild spatial grid each frame
  rebuildGrid();

  // 2. Update all entities; collect infections in a Set (deferred)
  const toInfect = new Set();
  for (let i = 0; i < NUM_CITIZENS; i++) {
    if (states[i] === 2) updateZombie(i, toInfect);
    else                  updateCitizen(i);
  }

  // 3. Apply infections after full update (avoids mid-loop state mutation)
  for (const idx of toInfect) {
    states[idx]      = 2;
    wanderTimer[idx] = 0;
  }

  // 4. Render, night overlay, and update HUD
  render();
  renderNightOverlay();
  const nz = updateHUD();

  // 5. Win condition
  if (nz >= NUM_CITIZENS) {
    const secs = (frameCount / 60).toFixed(0);
    endMessage.textContent =
      `All ${NUM_CITIZENS} citizens infected — ${frameCount} frames (~${secs}s)`;
    endOverlay.style.display = 'flex';
    return; // stop loop
  }

  rafHandle = requestAnimationFrame(gameLoop);
}

// ============================================================
// INIT & RESTART
// ============================================================
function init() {
  if (rafHandle) { cancelAnimationFrame(rafHandle); rafHandle = null; }

  setupCanvases();
  initSprites();
  initGrid();

  const buildings = generateCity(canvasW, canvasH);
  mask = buildStreetMask(buildings, canvasW, canvasH);
  renderCity(cityCtx, buildings, canvasW, canvasH);

  spawnEntities();

  endOverlay.style.display = 'none';

  waitingForPatientZero = !INITIAL_ZOMBIE;
  pzOverlay.style.display = waitingForPatientZero ? 'flex' : 'none';

  frameCount = 0;
  daylight   = 1.0;
  rafHandle  = requestAnimationFrame(gameLoop);
}

// Start on load
init();

// Click: select patient zero (when waiting) OR restart after game-over
window.addEventListener('click', (e) => {
  if (endOverlay.style.display !== 'none') { init(); return; }
  if (waitingForPatientZero) {
    infectNearestCitizen(e.clientX, e.clientY);
    waitingForPatientZero = false;
    pzOverlay.style.display = 'none';
  }
});

// Keydown: only restarts after game-over (no position, can't select a citizen)
window.addEventListener('keydown', () => {
  if (endOverlay.style.display !== 'none') init();
});

// Restart on resize (city proportions change with canvas dimensions)
let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(init, 150);
});
