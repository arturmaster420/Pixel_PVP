import { CONFIG, clamp } from '../sim/constants.js';

export function computeStorm(elapsedSec) {
  const base = CONFIG.BASE_CIRCLE_RADIUS;
  const phases = CONFIG.STORM_PHASES;

  let phaseIndex = 0;
  let radiusMul = phases[0].radiusMulEnd;
  let dmgPerSec = phases[0].dmgPerSec;

  for (let i = 0; i < phases.length; i++) {
    const ph = phases[i];
    if (elapsedSec >= ph.start) {
      phaseIndex = i;
      dmgPerSec = ph.dmgPerSec;

      const prevMul = i === 0 ? ph.radiusMulEnd : phases[i - 1].radiusMulEnd;
      const t = ph.end > ph.start ? clamp((elapsedSec - ph.start) / (ph.end - ph.start), 0, 1) : 1;
      radiusMul = prevMul + (ph.radiusMulEnd - prevMul) * t;
    }
  }

  return {
    cx: 0,
    cy: 0,
    r: base * radiusMul,
    phase: phaseIndex,
    dmgPerSec
  };
}
