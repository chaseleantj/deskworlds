import assert from 'node:assert/strict';
import { register } from 'node:module';
register('../../riverscape/tests/three-loader.mjs', import.meta.url);
const { createFood, PELLET }=await import('../src/food.js');
const { createBetta, FIXED_STEP }=await import('../src/behaviour.js');
const { homeBounds }=await import('../src/view.js');
const { randomGenerator }=await import('../../shared/random.js');
const { Vector3 }=await import('three');

// Pellets: a pinch lands over a moment, floats on the film, then sinks slowly and nearly straight,
// and is gone about 30 s after it touched the water.
{
  const food=createFood(randomGenerator(3));
  food.drop(0.5,-0.3,0.8,7);
  assert.equal(food.pellets.length,7);
  const start=food.pellets.map(p=>({...p}));
  let t=0;const landed=new Set(),sank=new Set();let maxSway=0;
  while(food.pellets.length){
    food.step(FIXED_STEP);t+=FIXED_STEP;
    for(const p of food.pellets){
      const s=start.find(q=>q.id===p.id);
      assert.ok([p.x,p.y,p.z,p.turn].every(Number.isFinite),'Pellet state finite');
      if(p.age>=0)landed.add(p.id);
      if(p.age<p.floatFor)assert.ok(Math.abs(p.y-s.y)<1e-9,'A pellet floats until it soaks');
      else if(p.y<s.y)sank.add(p.id);
      maxSway=Math.max(maxSway,Math.hypot(p.x-s.x,p.z-s.z)-PELLET.drift*Math.min(p.age,p.floatFor)*Math.SQRT2);
      assert.ok(food.whole(p)>=0&&food.whole(p)<=1);
      if(p.age<PELLET.life-PELLET.fade)assert.ok(p.age<0||food.whole(p)===1,'Whole until it starts to dissolve');
    }
    assert.ok(t<PELLET.life+PELLET.stagger+.1,'Pellets dissolve on time');
  }
  assert.equal(landed.size,7);assert.equal(sank.size,7,'Every pellet sinks');
  assert.ok(maxSway<PELLET.wobble*1.5,`Falls nearly straight ${maxSway.toFixed(3)}`);
  assert.ok(t>PELLET.life-.1,'No pellet leaves early');
  // The fall is slow: after 30 s none has dropped more than about a body length and a half.
  const deep=createFood(randomGenerator(4));deep.drop(0,0,.8,8);
  for(let i=0;i<Math.round((PELLET.life-.5)/FIXED_STEP);i++)deep.step(FIXED_STEP);
  for(const p of deep.pellets)assert.ok(.8-p.y<1.6&&.8-p.y>.4,`Sink depth ${(.8-p.y).toFixed(2)}`);
  // Capacity holds, and the same seed drops the same pinch.
  const full=createFood(randomGenerator(5));for(let i=0;i<10;i++)full.drop(0,0,0,8);assert.equal(full.pellets.length,PELLET.capacity);
  const a=createFood(randomGenerator(9)),b=createFood(randomGenerator(9));a.drop(1,0,.5,6);b.drop(1,0,.5,6);assert.deepEqual(a.pellets,b.pellets);
}

// Feeding: the fish notices food, swims to it, strikes each pellet with a mouth snap and eats the
// lot, then goes back to its own business. Food outranks the cursor.
const camera=new Vector3(0,.15,5.4);
function tank(seed){const betta=createBetta({random:randomGenerator(seed)});const {min,max}=homeBounds(1440/900);betta.setBounds(min,max);return betta;}
const run=(betta,seconds,each=()=>{})=>{for(let i=0;i<Math.round(seconds/FIXED_STEP);i++){betta.step(FIXED_STEP,camera);each();}};
for(const seed of [1,2,3,4,5,6,7,8]){
  const betta=tank(seed);
  run(betta,20);
  const x=Math.sin(betta.time*.73)*betta.bounds.max.x*.7;
  betta.feed(x,-.3,7);
  const t0=betta.time;let noticed=null,first=null,cleared=null,snap=0;
  run(betta,30,()=>{
    if(noticed===null&&betta.brain.mode==='feed')noticed=betta.time-t0;
    if(first===null&&betta.stats.strikes)first=betta.time-t0;
    if(betta.brain.strikeAt)snap=Math.max(snap,betta.uniforms.uMouth.value);
    if(cleared===null&&!betta.food.pellets.length)cleared=betta.time-t0;
    assert.ok(betta.diagnostics().finite,'Fish state finite');
  });
  assert.ok(noticed>.3&&noticed<1.3,`Seed ${seed}: notices food after a short delay (${noticed?.toFixed(2)} s)`);
  assert.ok(first!==null&&first<10,`Seed ${seed}: first strike ${first?.toFixed(1)} s`);
  assert.equal(betta.stats.eaten,7,`Seed ${seed}: eats every pellet`);
  assert.equal(betta.stats.strikes,7,`Seed ${seed}: one strike a pellet`);
  assert.ok(cleared<25,`Seed ${seed}: pinch eaten in ${cleared?.toFixed(1)} s, before it dissolves`);
  assert.ok(snap>.9,`Seed ${seed}: strikes snap the mouth open (${snap.toFixed(2)})`);
  assert.notEqual(betta.brain.mode,'feed','Returns to normal behaviour');
}
{
  const betta=tank(11);run(betta,10);
  const cursor=new Vector3(-1,0,.7);
  run(betta,3,()=>betta.point(cursor));
  assert.equal(betta.brain.mode,'curious');
  betta.feed(1.5,-.3,2);
  run(betta,2,()=>betta.point(cursor));
  assert.equal(betta.brain.mode,'feed','Food outranks cursor curiosity');
  run(betta,20,()=>betta.point(cursor));
  assert.equal(betta.food.pellets.length,0);
  assert.equal(betta.brain.mode,'curious','Curiosity returns once the food is gone');
  // A click far outside the tank still lands on the water inside it.
  betta.feed(99,-.3,1);assert.ok(betta.food.pellets[0].x<=betta.bounds.max.x+PELLET.spread);
}
console.log('betta food ok');
