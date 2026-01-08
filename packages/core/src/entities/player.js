import { CONFIG, levelFromXp, clamp } from '../sim/constants.js';

export function makePlayer(id) {
  return {
    id,
    name: id,
    color: '#55aaff',

    // Cosmetic (non-gameplay): small emoji shown near name.
    // Server validates/clamps to CONFIG.AVATARS length.
    avatarId: 0,

    // Cosmetic (non-gameplay): aura/trail selection (validated by server).
    auraId: 0,
    trailId: 0,

    x: 0,
    y: 0,
    vx: 0,
    vy: 0,

    hp: CONFIG.PLAYER_MAX_HP,
    maxHp: CONFIG.PLAYER_MAX_HP,

    xp: 0,
    level: 1,

    score: 0,
    streak: 0,

    // match stats (authoritative)
    kills: 0,
    deaths: 0,
    assists: 0,
    maxLevel: 1,
    maxXp: 0,

    bloodlustStacks: 0,
    bloodlustUntil: 0,

    // temporary buff pickups (server-authoritative)
    buffMsUntil: 0,  // move speed
    buffAsUntil: 0,  // attack speed
    buffDmgUntil: 0, // damage
    buffRegenUntil: 0, // regen
    // Number of buff pickups collected this match (for achievements/UI only)
    buffsCollected: 0,
    shield: 0,

    respawnAt: 0,
    protectUntil: 0,

    // weapon timing
    nextShotAt: 0,

    // last input
    mvx: 0,
    mvy: 0,
    aimx: 1,
    aimy: 0,
    fire: false,

    // assists: attackerId -> lastDamageTime
    damageFrom: new Map(),

    dead: false
  };
}

export function applyXp(p, addXp) {
  p.xp = Math.max(0, p.xp + addXp);
  if (p.xp > p.maxXp) p.maxXp = p.xp;
  const newLevel = levelFromXp(p.xp);
  const oldLevel = p.level;
  p.level = newLevel;
  if (p.level > p.maxLevel) p.maxLevel = p.level;
  return { oldLevel, newLevel };
}

export function applyWorldBounds(p) {
  const h = CONFIG.WORLD_HALF_SIZE;
  p.x = clamp(p.x, -h, h);
  p.y = clamp(p.y, -h, h);
}