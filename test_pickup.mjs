import { createSim, addPlayer, step } from './packages/core/src/sim/sim.js';
import { makeBuffPickup } from './packages/core/src/entities/buffPickup.js';
import { computeStorm } from './packages/core/src/systems/storm.js';

const sim = createSim({seed:1});
const p = addPlayer(sim,{id:'p1',name:'A'});
sim.matchState='match';
sim.matchStart=0;
// set p position fixed
p.x = 100; p.y = 200; p.dead = false;
// add pickup at same place
sim.buffPickups.push(makeBuffPickup({id:'b1',x:100,y:200,kind:'ms'}));
// step with dt 1/60
step(sim, 1/60);
console.log('buffPickups left', sim.buffPickups.length);
console.log('buffMsUntil', p.buffMsUntil, 'time', sim.time);
