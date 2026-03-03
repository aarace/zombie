// city.js — Procedural city generation for zombie simulation

// ---- street width tiers (px) ----------------------------------------
const STREET_NARROW    = 18;   // tight side street
const STREET_NORMAL    = 28;   // standard street
const STREET_BOULEVARD = 52;   // wide boulevard
const ALLEY_WIDTH      = 14;   // passage cut through a building block
const BUILDING_INSET   = 4;    // gap from block edge to building face (= sidewalk width)

// ---- probability knobs ----------------------------------------------
const BOULEVARD_CHANCE   = 0.13;  // fraction of interior dividers that are boulevards
const NARROW_CHANCE      = 0.52;  // fraction that are narrow streets (rest = normal)
const ALLEY_CHANCE       = 0.10;  // fraction of blocks with a through-alley
const EMPTY_BLOCK_CHANCE = 0.05;  // fraction of blocks left as open plazas

// ---- target grid counts (varied slightly each run) ------------------
const TARGET_COLS = 12;
const TARGET_ROWS = 10;

// ---------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------

function randInt(min, max) { return min + (Math.random() * (max - min) | 0); }
function grayVal()         { return 32 + (Math.random() * 38 | 0); }

/** Return an array of `count` street widths; edge slots are always narrow. */
function makeStreetWidths(count) {
  return Array.from({ length: count }, (_, i) => {
    if (i === 0 || i === count - 1) return STREET_NARROW + Math.random() * 4;
    if (Math.random() < BOULEVARD_CHANCE) return STREET_BOULEVARD + Math.random() * 14;
    if (Math.random() < NARROW_CHANCE)   return STREET_NARROW    + Math.random() * 5;
    return STREET_NORMAL + Math.random() * 10;
  });
}

/**
 * Partition `totalSize` into `numBlocks` blocks separated by `streetWidths`.
 * Block sizes are randomly proportioned but always sum to fill the canvas exactly.
 * Returns [{start, end}] — the pixel extents of each block (streets are the gaps).
 */
function partitionAxis(totalSize, numBlocks, streetWidths) {
  const totalStreet = streetWidths.reduce((s, w) => s + w, 0);
  const available   = totalSize - totalStreet;

  // Random proportions for block widths (0.55 – 1.45 × average)
  const props   = Array.from({ length: numBlocks }, () => 0.55 + Math.random() * 0.9);
  const propSum = props.reduce((s, p) => s + p, 0);

  const positions = [];
  let pos = streetWidths[0]; // skip leading edge street

  for (let i = 0; i < numBlocks; i++) {
    const size = (props[i] / propSum) * available;
    positions.push({ start: pos, end: pos + size });
    pos += size + streetWidths[i + 1];
  }

  return positions;
}

/** Push a single solid building rectangle into the array. */
function solidBuilding(buildings, bx, by, bw, bh) {
  const ins = BUILDING_INSET;
  const w   = bw - ins * 2;
  const h   = bh - ins * 2;
  if (w < 8 || h < 8) return;
  buildings.push({ x: bx + ins, y: by + ins, w, h, gray: grayVal() });
}

/**
 * Split a block with a narrow through-alley (vertical or horizontal).
 * Alley position is biased toward the 40-60% mark so both halves are usable.
 */
function alleyBlock(buildings, bx, by, bw, bh) {
  const ins         = BUILDING_INSET;
  const half        = ALLEY_WIDTH / 2;
  const useVertical = (bw > ALLEY_WIDTH + 24) &&
                      (!( bh > ALLEY_WIDTH + 24) || Math.random() < 0.5);

  if (useVertical) {
    // ── vertical alley: two buildings side by side ──
    const ax = bx + bw * (0.38 + Math.random() * 0.24); // alley centre x
    const lw = ax - half - (bx + ins);
    const rx = ax + half;
    const rw = (bx + bw - ins) - rx;
    if (lw > 8) buildings.push({ x: bx + ins, y: by + ins, w: lw, h: bh - ins * 2, gray: grayVal() });
    if (rw > 8) buildings.push({ x: rx,       y: by + ins, w: rw, h: bh - ins * 2, gray: grayVal() });

  } else {
    // ── horizontal alley: two buildings stacked ──
    const ay = by + bh * (0.38 + Math.random() * 0.24); // alley centre y
    const th = ay - half - (by + ins);
    const by2 = ay + half;
    const bh2 = (by + bh - ins) - by2;
    if (th  > 8) buildings.push({ x: bx + ins, y: by + ins, w: bw - ins * 2, h: th,  gray: grayVal() });
    if (bh2 > 8) buildings.push({ x: bx + ins, y: by2,      w: bw - ins * 2, h: bh2, gray: grayVal() });
  }
}

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

/**
 * Generate an array of building rectangles.
 * Streets (and alleys) are the negative space between / through them.
 */
export function generateCity(canvasW, canvasH) {
  const numCols = TARGET_COLS + randInt(-1, 2); // 10 – 12
  const numRows = TARGET_ROWS + randInt(-1, 2); // 7 – 9

  const colStreets = makeStreetWidths(numCols + 1);
  const rowStreets = makeStreetWidths(numRows + 1);
  const colBlocks  = partitionAxis(canvasW, numCols, colStreets);
  const rowBlocks  = partitionAxis(canvasH, numRows, rowStreets);

  const buildings = [];

  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      const bx = colBlocks[c].start;
      const by = rowBlocks[r].start;
      const bw = colBlocks[c].end - bx;
      const bh = rowBlocks[r].end - by;

      if (bw < 20 || bh < 20) continue;          // block too small to build on
      if (Math.random() < EMPTY_BLOCK_CHANCE) continue; // open plaza

      const canAlleyV = bw > ALLEY_WIDTH + 24;
      const canAlleyH = bh > ALLEY_WIDTH + 24;

      if (Math.random() < ALLEY_CHANCE && (canAlleyV || canAlleyH)) {
        alleyBlock(buildings, bx, by, bw, bh);
      } else {
        solidBuilding(buildings, bx, by, bw, bh);
      }
    }
  }

  return buildings;
}

/**
 * Build a pixel-level street mask.
 * mask[y * canvasW + x] === 1  →  walkable street / alley
 * mask[y * canvasW + x] === 0  →  inside a building
 */
export function buildStreetMask(buildings, canvasW, canvasH) {
  const mask = new Uint8Array(canvasW * canvasH).fill(1);

  for (const b of buildings) {
    const x0 = Math.max(0, Math.floor(b.x));
    const y0 = Math.max(0, Math.floor(b.y));
    const x1 = Math.min(canvasW, Math.ceil(b.x + b.w));
    const y1 = Math.min(canvasH, Math.ceil(b.y + b.h));

    for (let py = y0; py < y1; py++) {
      const rowStart = py * canvasW;
      for (let px = x0; px < x1; px++) {
        mask[rowStart + px] = 0;
      }
    }
  }

  return mask;
}

/**
 * Draw the static city background to a 2D canvas context.
 * Call once at startup; result lives on the bottom canvas layer.
 *
 * Rendering order:
 *   1. Street background (near-black)
 *   2. Sidewalk zones — a concrete-coloured band equal to BUILDING_INSET px
 *      drawn around every building before the building itself is painted.
 *      Because two passes are used (all sidewalks, then all buildings) the
 *      bands never bleed on top of neighbouring buildings.
 *   3. 1-px curb line at the building edge — slightly brighter than the
 *      sidewalk, mimicking the raised kerb stone.
 *   4. Building body + bevel highlights.
 */
export function renderCity(ctx, buildings, w, h) {
  const SW = BUILDING_INSET; // sidewalk width in px — equals the building inset

  // ── 1. Street background ─────────────────────────────────────────────
  ctx.fillStyle = '#060606';
  ctx.fillRect(0, 0, w, h);

  // ── 2. Sidewalk zones (concrete, slightly lighter than road) ──────────
  // All sidewalks drawn before any building so no band bleeds onto an
  // adjacent building face.  In alleys the bands from both sides overlap
  // and leave a ~(ALLEY_WIDTH - 2*SW) dark strip down the alley centre.
  ctx.fillStyle = '#191919';
  for (const b of buildings) {
    ctx.fillRect(b.x - SW, b.y - SW, b.w + SW * 2, b.h + SW * 2);
  }

  // ── 3 & 4. Curb highlight + building body ────────────────────────────
  for (const b of buildings) {
    const g = b.gray;

    // 1-px kerb line: bright edge where the building wall meets the pavement
    ctx.fillStyle = '#333333';
    ctx.fillRect(b.x - 1, b.y - 1, b.w + 2, b.h + 2);

    // Building body
    ctx.fillStyle = `rgb(${g},${g},${g})`;
    ctx.fillRect(b.x, b.y, b.w, b.h);

    // Top + left face highlight (ambient occlusion / light-from-above)
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(b.x,           b.y,          b.w, 1);
    ctx.fillRect(b.x,           b.y,          1,   b.h);

    // Bottom + right face shadow
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(b.x,           b.y + b.h - 1, b.w, 1);
    ctx.fillRect(b.x + b.w - 1, b.y,           1,   b.h);
  }
}
