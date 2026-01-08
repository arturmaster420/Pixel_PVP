function mixU32(x) {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x >>> 0;
}

function makeLocalRng(seedU32) {
  let s = (seedU32 >>> 0) || 1;
  return {
    nextU32() {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s;
    },
    next01() {
      return this.nextU32() / 4294967296;
    },
    int(a, b) {
      const u = this.next01();
      return a + Math.floor(u * (b - a + 1));
    },
    pick(arr) {
      return arr[this.int(0, arr.length - 1)];
    }
  };
}

function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

function carveRoomsInMaze(vWalls, hWalls, w, h, rooms) {
  const rm = (x, y) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    vWalls[x][y] = false;
    vWalls[x + 1][y] = false;
    hWalls[x][y] = false;
    hWalls[x][y + 1] = false;
  };
  for (const r of rooms) {
    const x0 = clamp((r.cx - r.rx) | 0, 0, w - 1);
    const x1 = clamp((r.cx + r.rx) | 0, 0, w - 1);
    const y0 = clamp((r.cy - r.ry) | 0, 0, h - 1);
    const y1 = clamp((r.cy + r.ry) | 0, 0, h - 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        rm(x, y);
        if (x < x1) vWalls[x + 1][y] = false;
        if (y < y1) hWalls[x][y + 1] = false;
      }
    }
  }
}

function countSegments(vWalls, hWalls, w, h){
  let rects = 0;
  // vertical
  for (let i=0;i<=w;i++){
    let j=0;
    while(j<h){
      if(!vWalls[i][j]){ j++; continue; }
      while(j<h && vWalls[i][j]) j++;
      rects++;
    }
  }
  // horizontal
  for (let j=0;j<=h;j++){
    let i=0;
    while(i<w){
      if(!hWalls[i][j]){ i++; continue; }
      while(i<w && hWalls[i][j]) i++;
      rects++;
    }
  }
  return rects;
}

function genCount({w,h,seed=1,mapId=2,openSpan=3,deadPass=3,deadProb=0.88,loopFrac=0.28,loopMin=90,rooms=true}){
  const rng = makeLocalRng(mixU32((seed>>>0) ^ Math.imul((mapId>>>0)+11,0x85ebca6b)));
  const vWalls = Array.from({length:w+1},()=>Array.from({length:h},()=>true));
  const hWalls = Array.from({length:w},()=>Array.from({length:h+1},()=>true));
  const visited = Array.from({length:w},()=>Array.from({length:h},()=>false));
  const stack=[];
  const sx=rng.int(0,w-1); const sy=rng.int(0,h-1);
  stack.push([sx,sy]); visited[sx][sy]=true;
  const dirs=[[1,0,'E'],[-1,0,'W'],[0,1,'S'],[0,-1,'N']];
  const shuffleDirs=()=>{
    const a=dirs.slice();
    for(let i=a.length-1;i>0;i--){
      const j=rng.int(0,i);
      const t=a[i]; a[i]=a[j]; a[j]=t;
    }
    return a;
  };
  while(stack.length){
    const [cx,cy]=stack[stack.length-1];
    let progressed=false;
    for(const [dx,dy,d] of shuffleDirs()){
      const nx=cx+dx, ny=cy+dy;
      if(nx<0||nx>=w||ny<0||ny>=h) continue;
      if(visited[nx][ny]) continue;
      if(d==='E') vWalls[cx+1][cy]=false;
      else if(d==='W') vWalls[cx][cy]=false;
      else if(d==='S') hWalls[cx][cy+1]=false;
      else if(d==='N') hWalls[cx][cy]=false;
      visited[nx][ny]=true;
      stack.push([nx,ny]);
      progressed=true;
      break;
    }
    if(!progressed) stack.pop();
  }

  const cells=w*h;
  const extraLoops=Math.max(loopMin, Math.floor(cells*loopFrac));
  for(let k=0;k<extraLoops;k++){
    const x=rng.int(0,w-1); const y=rng.int(0,h-1);
    const [dx,dy,d]=rng.pick(dirs);
    const nx=x+dx, ny=y+dy;
    if(nx<0||nx>=w||ny<0||ny>=h) continue;
    if(d==='E') vWalls[x+1][y]=false;
    else if(d==='W') vWalls[x][y]=false;
    else if(d==='S') hWalls[x][y+1]=false;
    else if(d==='N') hWalls[x][y]=false;
  }

  const degree=(x,y)=>{
    let c=0;
    if(x>0 && vWalls[x][y]===false) c++;
    if(x<w-1 && vWalls[x+1][y]===false) c++;
    if(y>0 && hWalls[x][y]===false) c++;
    if(y<h-1 && hWalls[x][y+1]===false) c++;
    return c;
  };
  const openRandomClosedWall=(x,y)=>{
    const opts=[];
    if(x>0 && vWalls[x][y]===true) opts.push('W');
    if(x<w-1 && vWalls[x+1][y]===true) opts.push('E');
    if(y>0 && hWalls[x][y]===true) opts.push('N');
    if(y<h-1 && hWalls[x][y+1]===true) opts.push('S');
    if(!opts.length) return;
    const d=opts[rng.int(0, opts.length-1)];
    if(d==='E') vWalls[x+1][y]=false;
    else if(d==='W') vWalls[x][y]=false;
    else if(d==='S') hWalls[x][y+1]=false;
    else if(d==='N') hWalls[x][y]=false;
  };
  for(let pass=0; pass<deadPass; pass++){
    for(let y=0;y<h;y++){
      for(let x=0;x<w;x++){
        if(degree(x,y)<=1 && rng.next01()<deadProb) openRandomClosedWall(x,y);
      }
    }
  }

  if(rooms){
    carveRoomsInMaze(vWalls, hWalls, w, h, [
      { cx:(w/2)|0, cy:(h/2)|0, rx:1, ry:1 },
      { cx:3, cy:3, rx:1, ry:1 },
      { cx:w-4, cy:3, rx:1, ry:1 },
      { cx:3, cy:h-4, rx:1, ry:1 },
      { cx:w-4, cy:h-4, rx:1, ry:1 },
    ]);
  }

  const midX=(w/2)|0; const midY=(h/2)|0;
  for(let t=-openSpan;t<=openSpan;t++){
    const xi=clamp(midX+t,0,w-1);
    const yi=clamp(midY+t,0,h-1);
    hWalls[xi][0]=false; hWalls[xi][h]=false;
    vWalls[0][yi]=false; vWalls[w][yi]=false;
  }

  return countSegments(vWalls,hWalls,w,h);
}

function sample(cfg, n=60){
  let min=1e9,max=0,sum=0;
  for(let i=0;i<n;i++){
    const c=genCount({...cfg, seed: 12345+i*17, mapId: 2+i});
    min=Math.min(min,c); max=Math.max(max,c); sum+=c;
  }
  return {min,max,avg:sum/n};
}

const candidates=[
  {w:19,h:19},
  {w:21,h:21},
  {w:23,h:23},
  {w:25,h:25},
  {w:27,h:27},
  {w:29,h:29},
  {w:31,h:31},
];

for(const c of candidates){
  const stats=sample(c,40);
  console.log(`grid ${c.w}x${c.h}:`, stats);
}
