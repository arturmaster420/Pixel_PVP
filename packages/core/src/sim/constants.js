// Weapon definitions are server-authoritative. The client only renders what the server sim produced.
// We keep them here (shared) so that range/camera and UI can reflect the active match weapon.
const WEAPONS = Object.freeze({
  pistol: {
    id: 'pistol',
    name: 'Bombomet',
    // Grenade / bomb launcher: slow, long reach, splash damage.
    baseDamage: 36,          // damage at center of explosion
    baseFireRate: 0.9,       // rare shots
    baseBulletSpeed: 520,    // slower projectile
    baseRange: 2600,         // far travel distance
    dmgPerLevel: 0.05,
    firePerLevel: 0.015,
    rangePerLevel: 0.012,
    bulletSpeedPerLevel: 0.010,
    bulletRadius: 6,
    bulletLifeSec: 5.2,
    pellets: 1,
    spreadDeg: 0,

    explosive: true,
    splashRadius: 85,
    splashMinMul: 0.25,      // damage at edge as a fraction of baseDamage
    selfMul: 0.5             // self-damage multiplier
  },

  smg: {
    id: 'smg',
    name: 'SMG',
    baseDamage: 7,
    baseFireRate: 8.2,
    baseBulletSpeed: 980,
    baseRange: 900,
    dmgPerLevel: 0.03,
    firePerLevel: 0.025,
    rangePerLevel: 0.008,
    bulletSpeedPerLevel: 0.01,
    bulletRadius: 4,
    bulletLifeSec: 1.10,
    pellets: 1,
    spreadDeg: 0
  },

  shotgun: {
    id: 'shotgun',
    name: 'Shotgun',
    baseDamage: 6, // per pellet
    // Range nerf kept, but attack speed restored (x2 vs the nerfed value).
    baseFireRate: 1.8,
    baseBulletSpeed: 900,
    baseRange: 325,
    dmgPerLevel: 0.03,
    firePerLevel: 0.02,
    rangePerLevel: 0.008,
    bulletSpeedPerLevel: 0.008,
    bulletRadius: 4,
    bulletLifeSec: 0.95,
    pellets: 5,
    spreadDeg: 18
  },

rail: {
  id: 'rail',
  name: 'Railgun',
  // Piercing sniper: slow cadence, high damage, can hit through 1 extra player.
  baseDamage: 58,
  baseFireRate: 0.85,
  baseBulletSpeed: 2600,
  baseRange: 2800,
  dmgPerLevel: 0.045,
  firePerLevel: 0.012,
  rangePerLevel: 0.010,
  bulletSpeedPerLevel: 0.010,
  bulletRadius: 2,
  bulletLifeSec: 1.60,
  pellets: 1,
  spreadDeg: 0,
  piercePlayers: 1
},

  minigun: {
    id: 'minigun',
    name: 'Minigun',
    // High DPS up close; weaker per-bullet.
    baseDamage: 4,
    baseFireRate: 13.8,
    baseBulletSpeed: 1050,
    baseRange: 820,
    dmgPerLevel: 0.028,
    firePerLevel: 0.020,
    rangePerLevel: 0.008,
    bulletSpeedPerLevel: 0.010,
    bulletRadius: 3,
    bulletLifeSec: 1.05,
    pellets: 1,
    spreadDeg: 3.5
  },

  burst: {
    id: 'burst',
    name: 'Burst',
    // 3-round burst feel via triple pellets with tight spread.
    baseDamage: 8,
    baseFireRate: 3.1,
    baseBulletSpeed: 1020,
    baseRange: 980,
    dmgPerLevel: 0.03,
    firePerLevel: 0.018,
    rangePerLevel: 0.009,
    bulletSpeedPerLevel: 0.010,
    bulletRadius: 4,
    bulletLifeSec: 1.15,
    pellets: 3,
    spreadDeg: 6
  }
});

export const CONFIG = Object.freeze({
  // Match length (used for UI timers). Gameplay may end earlier if a single survivor remains.
  MATCH_DURATION_SEC: 720,

  // Snapshot event delivery: keep recent events so clients don't miss them between snapshots.
  EVENT_BUFFER_MAX: 80,
  EVENT_BUFFER_KEEP_SEC: 2.5,


  XP_THRESHOLDS: [
    0,   // L1
    80,  // L2
    180, // L3
    320, // L4
    500, // L5
    720, // L6
    980, // L7
    1280,// L8
    1620,// L9
    2000 // L10
  ],

  XP_KILL: 150,
  XP_ASSIST: 60,
  XP_SURVIVAL_PER_SEC: 1,
  XP_ORB_VALUE: 5,
  ASSIST_WINDOW_SEC: 4,

  SCORE_KILL: 100,
  SCORE_ASSIST: 40,
  SCORE_SURVIVAL_PER_SEC: 1,
  SCORE_STREAK_BONUS_PER_KILL: 10, // multiplied by current streak after increment

  DROP_XP_RATIO_ON_DEATH: 0.30,
  // Respawn delay after death (seconds). QoL: prevent instant respawn.
  RESPAWN_DELAY_SEC: 5.0,
  SPAWN_PROTECT_SEC: 1.2,

  // Bloodlust
  BLOODLUST_MAX_STACKS: 3,
  BLOODLUST_DURATION_SEC: 8,
  BLOODLUST_MOVE_BONUS_PER_STACK: 0.06,
  BLOODLUST_FIRE_BONUS_PER_STACK: 0.06,
  BLOODLUST_SHIELD_AT_STACKS: 3,

  // Temporary Buff Pickups (rare, 30s)
  BUFF_DURATION_SEC: 30,
  BUFF_BONUS_MUL: 0.20, // +20%
  BUFF_REGEN_HP_PER_SEC: 2.0,
  BUFF_PICKUP_RADIUS: 18,
  BUFF_KINDS: Object.freeze(['ms', 'as', 'dmg', 'regen']),
  BUFF_FIELD: {
    enabled: true,
    // 2x more common: more baseline + faster replenishment.
    baseTarget: 4,
    perAlivePlayer: 1.20,
    maxTarget: 18,
    spawnIntervalMinSec: 2,
    spawnIntervalMaxSec: 3.5,
    spawnInsideMul: 0.88,
    pruneOutsideMul: 1.15,
    spawnBurstMax: 3
  },

  // World
  WORLD_HALF_SIZE: 9000, // square bounds for MVP
  BASE_CIRCLE_RADIUS: 8000,

  // Storm phases over ~12 minutes.
  // We add a 1:00 "hold" before each shrink. The last hold is 2:00.
  // Final minute (last shrink): the zone shrinks all the way to 0.
  STORM_PHASES: [
    // initial grace (slightly shorter so we can keep the 12:00 total while
    // giving the final shrink a full 60 seconds)
    { start: 0,   end: 30,  radiusMulEnd: 1.00, dmgPerSec: 0 },

    // hold 1 (pre-shrink to 0.70)
    { start: 30,  end: 90,  radiusMulEnd: 1.00, dmgPerSec: 2 },
    // shrink 1 (120s)
    { start: 90,  end: 210, radiusMulEnd: 0.70, dmgPerSec: 2 },

    // hold 2 (pre-shrink to 0.45)
    { start: 210, end: 270, radiusMulEnd: 0.70, dmgPerSec: 3 },
    // shrink 2 (120s)
    { start: 270, end: 390, radiusMulEnd: 0.45, dmgPerSec: 3 },

    // hold 3 (pre-shrink to 0.25)
    { start: 390, end: 450, radiusMulEnd: 0.45, dmgPerSec: 5 },
    // shrink 3 (90s)
    { start: 450, end: 540, radiusMulEnd: 0.25, dmgPerSec: 5 },

    // hold 4 (pre-final shrink) — 2 minutes
    { start: 540, end: 660, radiusMulEnd: 0.25, dmgPerSec: 8 },
    // final shrink (60s) -> 0
    { start: 660, end: 720, radiusMulEnd: 0.00, dmgPerSec: 10 }
  ],

  // Movement & combat
  PLAYER_RADIUS: 14,
  PLAYER_MAX_HP: 100,
  // Base move speed (px/sec). v0.2.28: doubled for snappier pacing.
  PLAYER_BASE_SPEED: 480,

  // Weapon pool for "Featured Weapon" matches.
  WEAPONS,
  MATCH_WEAPON_POOL: Object.freeze(['pistol', 'smg', 'shotgun', 'rail', 'minigun', 'burst']),

  // Map pool for lobby voting.
  // Map identifiers correspond to obstacle-generator variants.
  MATCH_MAP_POOL: Object.freeze(['default', 'labyrinth', 'pillars', 'cross']),

  // Cosmetic avatars (non-gameplay). Client renders them; server validates/clamps.
  // Lots of variety; unlocks are handled client-side via profile level (no gameplay impact).
  AVATARS: Object.freeze([
    // Faces
    '🙂','😀','😃','😄','😁','😆','😅','🤣','😂','😉','😊','😇','😍','😘','😋','😜','🤪','😎','🥳','🤩',
    '😏','😬','😌','🤓','😴','🤤','😵‍💫','🤯','😱','😤','😡','🤬','🤡',
    // Spooky / sci-fi
    '👻','💀','☠️','👽','👾','🤖','🎃',
    // Cats
    '😺','😸','😹','😻','😼','😽','🙀','😿','😾',
    // Animals
    '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🦉','🦄',
    '🐝','🐛','🦋','🐌','🐞','🐢','🐍','🦖','🦕','🐙','🦑','🦀','🐡','🐠','🐬','🐳','🦈',
    // Nature / elements
    '🌟','✨','⚡','🔥','💧','🌊','🌪️','❄️','🌈','🌙','☀️','☁️','🌋','🌍','🌵','🌲','🍀','🌸','🌺','🌻',
    // Food
    '🍎','🍉','🍌','🍇','🍓','🍒','🍑','🍍','🥥','🥝','🍋','🥑','🥦','🥕','🌽','🍔','🍕','🌭','🍟','🍿',
    '🍣','🍜','🍩','🍪','🍫','🍦','🧁','🥤','🍵','☕',
    // Objects / tech
    '🎮','🕹️','🎲','🧩','🎯','🏆','🏅','🎧','📱','💻','⌨️','🖱️','📷','🔦','🧲','🧪','🧬','🛰️','🚀','🛸',
    // Vehicles
    '🚁','✈️','🚗','🏎️','🚕','🚌','🚓','🚑','🚒','🚜','🏍️','🚲','🛴','🛹',
    // Fantasy / combat vibe
    '👑','⚔️','🛡️','🏹','🧙‍♂️','🧚‍♂️','🧛‍♂️','🧟‍♂️','🦸‍♂️','🦹‍♂️',
    // Sports
    '⚽','🏀','🏈','⚾','🎾','🏐','🏓','🥊','🏒','⛳',
    // Symbols / shapes
    '❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💥','💢','💫','✅','❌','⭐',
    '🔺','🔻','⚪','⚫','🟠','🟡','🟢','🔵','🟣','🟤','🟥','🟧','🟨','🟩','🟦','🟪','🟫',

    // More faces
    '🤗','🤠','🥸','🥲','🫠','😶‍🌫️','😮','😲','😳','🥶','🥵','😷','🤒','🤕','🤮','🤢',

    // More animals
    '🐺','🦝','🦓','🦒','🦌','🐗','🐴','🐑','🐐','🦙','🦘','🦡','🦔','🦦','🦥','🐊','🐅','🐆',
    '🦅','🦆','🦢','🦜','🦩','🐟','🐋','🐚',

    // More nature / space
    '🌌','🌠','☄️','🪐','🌞','🌛','🌜','🌑','🌕','🌖','🌗','🌘',

    // More objects / icons
    '💣','🧨','🔮','🧿','🪄','🗡️','🪓','🔫','🧯','🧱','🪙','💎','🔑','🔒','🧰','🛠️','⚙️','🧭','🗺️',

    // More symbols
    '♠️','♥️','♦️','♣️','🎵','🎶','🔔','📌','📍','✳️','❇️','⭕'
  ]),

  // Cosmetic auras/trails (non-gameplay). Server clamps ids; client renders.
  // Cosmetics (purely visual). Player identity is still emoji-avatar (24px).
  // Aura/Trail are intentionally NOT tied to per-player colors.
  AURAS: Object.freeze(['Default', 'Crown', 'Predator', 'Void', 'Emerald', 'Frost', 'Inferno', 'Prism']),
  TRAILS: Object.freeze([
    'Default (White)',
    'Dotted (Cyan)',
    'Comet (Purple)',
    'Spark (Amber)',
    'Neon (Green Squares)',
    'Laser (Red Beam)',
    'Star (Yellow)',
    'Ice (Blue Triangles)',
  ]),

  // Backwards-compat alias (legacy code used CONFIG.PISTOL directly)
  PISTOL: WEAPONS.pistol,

  // Neutral XP orbs on the map (not only death drops)
  ORB_FIELD: {
    // Desired on-map orb count (scaled by alive players)
    baseTarget: 60,
    perAlivePlayer: 12,
    maxTarget: 260,

    // Spawn pacing (only if below target)
    spawnIntervalMinSec: 0.22,
    spawnIntervalMaxSec: 0.55,

    // Clusters are kept smaller and a bit rarer so the map also has lots of singles.
    clusterMin: 4,
    clusterMax: 8,
    clusterRadius: 140,

    // Also sprinkle single orbs across the map (so it doesn't feel empty between clusters)
    // User request: ~3x more single orbs.
    singleChance: 0.985,
    singleBurstMin: 6,
    singleBurstMax: 20,

    // Keep orbs relevant as the circle shrinks
    pruneOutsideMul: 1.2
  },


// Random indestructible obstacles (cover). Obstacles are axis-aligned rectangles.
// Instead of only long walls, we generate varied "glyph" shapes (H, U, O, P, F, K, Y, V, X, Z, ...)
// composed of multiple short rectangles, plus a set of short walls.
OBSTACLES: {
  enabled: true,

  // How many composite shapes to place per match (each shape = 3..12 rectangles)
  // User request: obstacles ~2x more frequent.
  glyphCount: 48,

  // Additional simple short walls sprinkled around the map
  shortWallCount: 72,

  // Keep the very center a bit clearer, but still put cover in the mid ring
  centerClearMul: 0.10, // fraction of base circle radius
  edgeMarginMul: 0.88,  // place obstacle centers within this fraction of circle radius

  // Overall "glyph" span (world units)
  // User request: 2-3x smaller than previous.
  glyphScaleMin: 160,
  glyphScaleMax: 380,

  // Stroke thickness range (world units)
  thickMin: 8,
  thickMax: 18,

  // Short wall length range
  wallLenMin: 70,
  wallLenMax: 220,

  // Diagonal approximation resolution (more = smoother diagonals but more rects)
  // Keep steps a bit lower so doubling counts doesn't explode rect count.
  diagStepsMin: 3,
  diagStepsMax: 5,

  // Minimum spacing between obstacle rectangles (AABB padding)
  pad: 14,

  // Safety cap to keep snapshots lightweight
  maxRects: 360,

  // Spatial index cell size (server perf): keep slightly larger than typical cover size.
  gridCellSize: 520
}
});

export function levelFromXp(xp) {
  // Levels are 1..10
  const t = CONFIG.XP_THRESHOLDS;
  let lvl = 1;
  for (let i = 1; i < t.length; i++) {
    if (xp >= t[i]) lvl = i + 1;
  }
  return Math.min(lvl, 10);
}

export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}