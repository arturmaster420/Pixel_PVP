import { generateObstacles } from './packages/core/src/systems/obstacles.js';
import { CONFIG } from './packages/core/src/sim/constants.js';

function runOnce(seed, mapId){
  const sim = {
    seed,
    mapId,
    obstacles: [],
    nextObstacleId: 1,
    _rngState: 1,
    matchMapVariant: 'labyrinth',
  };
  const circle = { cx: 0, cy: 0, r: 8000 };
  generateObstacles(sim, circle);
  return sim.obstacles.length;
}

let max = 0;
let min = 1e9;
let sum = 0;
for(let i=0;i<50;i++){
  const n = runOnce(12345+i, 2+i);
  max = Math.max(max,n);
  min = Math.min(min,n);
  sum += n;
}
console.log('CONFIG maxRects', CONFIG.OBSTACLES.maxRects);
console.log('obstacles count over 50:', {min, max, avg: sum/50});
