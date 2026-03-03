# Zombie City

A browser-based zombie infection simulation rendered on HTML Canvas. A procedurally generated city fills the screen; citizens wander the streets until a zombie appears and the infection spreads.

## Running

ES modules require an HTTP server — opening `index.html` directly via `file://` will not work.

```bash
npx serve .
# or
python -m http.server 8000
```

Then open `http://localhost:8000` (or the port shown).

## Controls

| Action | Input |
|---|---|
| Select patient zero | Click any citizen (when `INITIAL_ZOMBIE = false`) |
| Restart after infection complete | Click or press any key |

## Settings

All simulation knobs live at the top of `simulation.js`.

### Population

| Constant | Default | Description |
|---|---|---|
| `NUM_CITIZENS` | `1000` | Total number of entities in the simulation |
| `DOT_RADIUS` | `2` | Visual radius of every dot in pixels |

### Speeds

All speeds are in pixels per frame (target 60 fps).

| Constant | Default | Description |
|---|---|---|
| `CITIZEN_SPEED` | `1.2` | Base walking speed of calm citizens |
| `PANICKED_SPEED_MULTIPLIER` | `2.0` | Speed multiplier applied to citizens who are fleeing |
| `ZOMBIE_SPEED_MULTIPLIER` | `0.5` | Speed multiplier for zombies wandering with no target |
| `ZOMBIE_CHASE_SPEED_MULTIPLIER` | `2.0` | Speed multiplier for zombies actively chasing a citizen |

### Vision & Infection

| Constant | Default | Description |
|---|---|---|
| `CITIZEN_VISION_DISTANCE` | `60` | Pixels — radius in which a citizen can see a zombie. Line-of-sight occluded by buildings. |
| `ZOMBIE_VISION_DISTANCE` | `150` | Pixels — radius in which a zombie can detect a citizen |
| `INFECTION_DISTANCE` | `10` | Pixels — contact distance at which a zombie infects a citizen |

### Patient Zero

| Constant | Default | Description |
|---|---|---|
| `INITIAL_ZOMBIE` | `true` | `true` — one random citizen is auto-infected at start. `false` — simulation waits; click any citizen to create patient zero. |

### City Generation

City layout constants live at the top of `city.js`.

| Constant | Default | Description |
|---|---|---|
| `TARGET_COLS` | `12` | Target number of building columns (varies ±1 each run) |
| `TARGET_ROWS` | `10` | Target number of building rows (varies ±1 each run) |
| `STREET_NARROW` | `18` | Width of narrow side streets in pixels |
| `STREET_NORMAL` | `28` | Width of standard streets in pixels |
| `STREET_BOULEVARD` | `52` | Width of wide boulevards in pixels |
| `ALLEY_WIDTH` | `14` | Width of through-building alleys in pixels |
| `BUILDING_INSET` | `4` | Sidewalk width — gap between street edge and building face |
| `BOULEVARD_CHANCE` | `0.13` | Fraction of interior street dividers that become boulevards |
| `NARROW_CHANCE` | `0.52` | Fraction of remaining dividers that become narrow streets |
| `ALLEY_CHANCE` | `0.10` | Fraction of building blocks split by a through-alley |
| `EMPTY_BLOCK_CHANCE` | `0.05` | Fraction of blocks left empty (open plazas) |
