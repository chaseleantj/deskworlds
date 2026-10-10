import * as THREE from 'three';
import { randomGenerator, clamp, groundHeight, limitVector } from './math.js';
import { currentAt } from './water.js';
import { supportHeight } from './terrain.js';
import { HOST, ROCKS, STATIONS, TANK, CORAL_BOUNDS, THICKETS, PROMONTORY } from './layout.js';
import { reefNavigation, clearSegment, clearWater } from './navigation.js';

const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
export const FIXED_STEP=1/60;
// A hosting group is a breeding pair plus non-breeders — mean group size on a wild anemone
// is 3.4 — and a captive lyretail harem is one terminal male to four to six females. Nine
// chromis is also a keeper's number: below seven a pod concentrates its aggression on one
// fish and eats itself down to a single survivor.
export const POPULATION={clownfish:3,chromis:9,anthias:7,shrimp:2};
const REEF_BOUNDS=[...ROCKS,...CORAL_BOUNDS];
// Where the two Acropora thickets sit in that list. A chromis does not merely hover near
// its colony, it lives in it — juveniles barely leave the branches and the whole pod drops
// between them at an alarm — so its own head holds it off far less than everything else.
const SHELTER=ROCKS.length;
// How long one U-swim takes from the top of the dive to the top of the rise.
const USWIM=2.0;
// The shoals are moving social groups. Their original homes remain alarm refuges, not
// invisible tethers. Each group visits all three thirds of the reef at a bounded speed.
const SHOALS=[
  {kind:'chromis',home:[-4.9,5.7,.1],spread:[.90,.48,.70],speed:.56,shelter:THICKETS[0]},
  {kind:'chromis',home:[4.9,5.7,.1],spread:[.92,.46,.72],speed:.59,shelter:THICKETS[1]},
  {kind:'anthias',home:[PROMONTORY.x,5.5,1.5],spread:[1.35,.65,.90],speed:.53,shelter:PROMONTORY},
];
// Visual gait controls, not a species-specific hydrodynamic calibration. Frequency is
// derived from through-water speed / body length / stride, with no high resting floor.
// Modest propulsion bouts alternate with low-drag coasts; pectorals do the hovering.
export const GAIT={
  clown:{length:.98,stride:.70,thrust:2.7,drag:.45,bout:[.7,1.1],glide:[.7,1.3],idle:.18,slip:.22,turn:1.65,pectoral:1.8,tail:.24},
  chromis:{length:.82,stride:.68,thrust:2.5,drag:.32,bout:[.65,1.05],glide:[.8,1.65],idle:.17,slip:.12,turn:1.75,pectoral:1.65,tail:1},
  anthias:{length:1.14,stride:.68,thrust:2.2,drag:.29,bout:[.70,1.15],glide:[.9,1.8],idle:.17,slip:.12,turn:1.55,pectoral:1.5,tail:1},
};

// The cleaner shrimp's own tunables. One unit is 10 cm and the modelled animal is about 0.9
// long. Nobody has published a kinematic study of Lysmata, so the structure here is the
// ethogram — long spells advertising, short repositioning walks, picking in between — run
// at rates borrowed from decapods that have been measured: a few centimetres a second, a
// step every 0.4 s, a tail flip of 130 ms that is 47% flexion.
export const SHRIMP={
  wrap:2,        // s; every appendage rhythm in shrimp.js is a whole multiple of 0.5 Hz off this clock
  speed:.24,     // units/s over the rock
  stride:.095,   // ground covered per leg cycle. The leg shader swings each foot half of it
  pivot:.22,     // the radius a turn on the spot makes the feet walk, so pivoting still steps
  turn:1.4,      // rad/s
  square:1.2,    // rad of heading error it will walk through: a crayfish turns by shortening
                 // the strides on one side, not by pivoting, so only a target behind it
                 // has to be squared up to first
  range:.58,     // how far from its station it works the shoulder
  roam:2.0,      // and how far an excursion may take it, onto the sand or the next rock
  outing:45,     // s at home between excursions, plus up to as much again
  graze:5,       // s picking at the far end of one, plus up to four more
  arrive:.04,
  drop:.20,      // on the shoulder it refuses a foothold this far below its own station
  grade:.62,     // or on ground this steep; on an excursion it will climb a flank of
  flank:2.1,     // this slope, which is what gets it down to the sand and back up
  lift:.22,      // how far it will stand up on its legs to carry its belly over a lump
  stretch:.14,   // how far a leg stretches or folds to put its foot on the ground under it
  lean:.9,       // the most the body rolls with the ground across it; the legs take up the rest
  seat:.132,     // how high the body rides over its feet: an eighth of its length, where a caridean carries itself
  feet:[[.092,-.15,.24],[-.002,-.15,.26],[-.096,-.15,.28]], // where the three walking pairs' feet end: ahead of the seat, below it, out to each side; shrimp.js draws the legs to them
  reach:1.35,    // units at which a client overhead is close enough to work on
  under:.16,     // how nearly beneath it the animal puts itself
  hold:.25,      // s a departed client goes on counting as one
  bout:.52,      // share of pauses that end in a walk, against `forage` in a spell of picking
  hike:.20,      // it does not get up to move less than this, so a bout is worth watching
  forage:.22,
  stand:4,       // s of advertising, plus up to five more
  rush:.81,      // (units/s)², what counts as a frightened body going past at speed
  startle:.72,   // units², and how close it has to pass
  flee:.95,      // s of tail flip and recovery
  flip:.13,      // s a flip takes, 47% of it flexion
  flips:2,       // two or three is the usual bout
  jet:2.4,       // units/s backwards while the abdomen is firing
  unroll:.62,    // how fast the abdomen straightens once the bout is over
};
// The body is a rigid length standing on feet a hand's breadth apart, and what the ground
// does under the rest of it decides how it stands. CHORD is that length as offsets along and
// across the heading from the feet, with how high the belly rides over the feet there: the
// tail fan low behind and as wide as it is long, the carapace and rostrum higher ahead.
// bodyFit finds the pitch that keeps the whole line out of the ground, nearest the ground's
// own slope, and how far the animal must stand up on its legs where no pitch will do — at
// the foot of a flank, say, with the tail still on the slope as the head reaches the sand.
// The simulation refuses a place that needs more standing up than the legs have; shrimp.js
// seats the model with the same answer.
const CHORD=[[-.62,0,.10],[-.50,-.10,.10],[-.50,.10,.10],[-.45,0,.10],[-.30,0,.10],[-.15,0,.10],[.15,0,.18],[.30,0,.22],[.45,0,.28]];
export function bodyFit(x,z,yaw){
  const h0=supportHeight(x,z),cx=Math.cos(yaw),cz=-Math.sin(yaw),sx=Math.sin(yaw),sz=Math.cos(yaw),steep=SHRIMP.flank;
  const at=CHORD.map(([a,b,c])=>{const h=supportHeight(x+cx*a+sx*b,z+cz*a+sz*b);return [a,h-c-h0,h];});
  // Each sample ahead is a floor under the pitch and each one behind a ceiling over it, and
  // the pitch itself is bounded by the steepest flank; where a floor stands above a ceiling,
  // or above what that bound allows, the body rises until they meet.
  let lift=0,low=-Infinity,high=Infinity;
  for(const [a,d] of at)lift=Math.max(lift,d-steep*Math.abs(a));
  for(const [af,df] of at)if(af>0)for(const [ar,dr] of at)if(ar<0)lift=Math.max(lift,(dr*af-df*ar)/(af-ar));
  for(const [a,d] of at)if(a>0)low=Math.max(low,(d-lift)/a);else high=Math.min(high,(d-lift)/a);
  const slope=(at[8][2]-at[3][2]+at[6][2]-at[5][2])/1.2;
  return {pitch:clamp(clamp(slope,low,high),-steep,steep),lift};
}
// How the animal sits at (x,z) facing yaw: the body's pitch and roll as angles, how far it
// stands up (`bodyFit`), where its seat is and where each walking foot comes to rest before
// the leg reaches for the ground. The same seat draws the model in shrimp.js and tests a
// foothold here, so what is refused is exactly what would have been drawn inside the rock.
export function seatShrimp(x,z,yaw){
  const fit=bodyFit(x,z,yaw),cx=Math.cos(yaw),cz=-Math.sin(yaw),sx=Math.sin(yaw),sz=Math.cos(yaw),w=SHRIMP.feet[2][2];
  const roll=Math.atan(clamp((supportHeight(x+sx*w,z+sz*w)-supportHeight(x-sx*w,z-sz*w))/(2*w),-SHRIMP.lean,SHRIMP.lean)),pitch=Math.atan(fit.pitch);
  const h=supportHeight(x,z)+fit.lift,cr=Math.cos(roll),sr=Math.sin(roll),cp=Math.cos(pitch),sp=Math.sin(pitch);
  // A point of the body (ahead, up, across the seat): rolled about its length, pitched about
  // its width, turned onto the heading and set on the ground under the seat.
  const place=(a,y,b)=>{const ry=y*cr+b*sr,rz=b*cr-y*sr,px=a*cp-ry*sp,py=a*sp+ry*cp;return [x+px*cx+rz*sx,h+py,z+px*cz+rz*sz];};
  return {pitch,roll,lift:fit.lift,root:place(0,SHRIMP.seat,0),feet:SHRIMP.feet.flatMap(([a,y,b])=>[-b,b].map(side=>place(a,SHRIMP.seat+y,side)))};
}

export class ReefSimulation {
  constructor(seed=36719) {
    this.random=randomGenerator(seed);this.time=0;this.fish=[];this.food=Array.from({length:32},()=>({active:false,position:V(),velocity:V(),age:0,size:0}));
    this.lastFeed=-10;this.consumed=0;this.steps=0;
    this._flow=V();this._delta=V();this._desired=V();this._force=V();this._sep=V();this._cohesion=V();this._align=V();this._relative=V();this._heading=V();this.navigation=reefNavigation();
    this.shoals=SHOALS.map((s,i)=>({...s,home:V(...s.home),centre:V(...s.home),velocity:V(),swell:1,out:V(),path:[],sector:i===0?2:i===1?0:1,direction:i===1?-1:1,legs:1}));
    // Buston & Cant measured 177 adjacent-rank pairs on wild percula: a dominant ends up
    // 1.26 times its immediate subordinate's length, and 1.37 for the two smallest fish.
    // These three sizes are that ladder, so the group reads as a queue rather than a trio.
    const initial=[[-5.15,4.18,2.1],[-2.78,3.99,1.85],[-3.54,3.85,2.35]];
    for(let i=0;i<3;i++)this.add('clown',initial[i],[.84,.66,.48][i],i);
    for(let i=0;i<9;i++)this.add('chromis',null,.63+(i?this.random()*.13:.15),i,i%2);
    // Rank 0 is the terminal male. FishBase puts the male at 15 cm against 7 cm for the
    // female, and an aquarium harem at about 12.5 cm to 9; he is half again their length.
    for(let i=0;i<7;i++)this.add('anthias',null,(i?.66:1.00)+this.random()*.09,i,2);
    this.previous=this.fish.map(()=>({p:V(),v:V(),alarm:0}));
    // The shrimp draw from their own stream. Sharing the fish's made every tuning of a walk
    // bout shift nineteen fish trajectories with it, which is a trap rather than a coupling.
    this.shrimpRandom=randomGenerator(seed^0x5bf03635);
    this.shrimp=STATIONS.map((p,i)=>({position:V(p.x,p.y,p.z),home:V(p.x,p.y,p.z),goal:V(p.x,p.y,p.z),yaw:i===0?.30:2.8,state:'advertise',timer:3+i*2,
      rhythm:i*.7,step:0,walk:0,pick:0,reach:0,curl:0,sway:0,signal:0,flick:0,sniff:0,burst:1+i,reverse:false,out:0,away:SHRIMP.outing*(.5+.8*this.shrimpRandom())}));
  }
  add(kind,position,size,rank,shoal=-1) {
    const r=this.random;
    const f={kind,rank,size,shoal,station:V(r()*2-1,r()*2-1,r()*2-1),position:V(),velocity:V(kind==='clown'?.11:-.28,0,.02),goal:V(),goalTimer:0,phase:r()*6.28,yaw:kind==='clown'?0:Math.PI,pitch:0,bank:0,roll:0,bend:0,turning:0,
      speed:.1,wave:0,tailAmplitude:0,tailHz:0,steer:V(),route:[],routeTimer:0,cruise:.92+r()*.16,beat:false,bout:r(),pectoral:r()*6.28,rowing:1,alarm:0,shelterAccess:0,spook:0,state:'forage',hold:0,show:6+r()*9,display:0,roam:0,follow:null};
    if(position)f.position.set(...position);else{
      this.station(f,f.position);
      // Spawn in water, not inside a thicket followed by a visible first-frame push-out.
      for(let attempt=0;attempt<24&&!clearWater(f.position,.40);attempt++)f.position.lerp(this.shoals[shoal].centre,.22);
    }
    f.goal.copy(f.position);this.fish.push(f);return f;
  }
  // Where this animal's slot in its shoal currently sits. Popper & Fishelson found the
  // territorial male anthias holding the water right against the rock with the females and
  // juveniles ranging above him, so his slot only ever runs downward from the group's
  // centre where theirs runs either way: the harem stacks male-low, not male-high.
  station(f,out) {
    const s=this.shoals[f.shoal],k=s.swell,lead=f.kind==='anthias'&&!f.rank;
    const rise=lead?-.62-Math.abs(f.station.y)*.55:f.station.y;
    return out.set(s.centre.x+f.station.x*s.spread[0]*k,s.centre.y+rise*s.spread[1]*k,s.centre.z+f.station.z*s.spread[2]*k).addScaledVector(s.velocity,1.5);
  }
  // A personal excursion shares the navigable water with the shoals, rather than a
  // separate little open-water box. Prefer a different third from the animal's position.
  openWater(out,from=out) {
    const sector=from.x<-2?2:from.x>2?0:(this.random()<.5?0:2);
    return out.copy(this.navigation.destination(from,sector,this.random));
  }
  travelGoal(f,goal,dt){
    f.routeTimer-=dt;
    if(clearSegment(f.position,goal))return goal;
    if(f.routeTimer<=0||!f.route.length){f.route=this.navigation.route(f.position,goal);f.routeTimer=2.4;}
    while(f.route.length>1&&f.position.distanceToSquared(f.route[0])<.30)f.route.shift();
    return f.route[0]||goal;
  }
  // Pellets enter just inside the wide view's top edge, which meets the front of the reef
  // about 1.2 units below the surface; dropped at the surface they took six seconds to show.
  feed(x=0,z=1) {
    if(this.time-this.lastFeed<1)return 0;
    let count=0;
    for(const pellet of this.food)if(!pellet.active&&count<8){
      pellet.active=true;pellet.age=0;pellet.size=.027+this.random()*.015;
      pellet.position.set(clamp(x+(this.random()-.5)*1.3,-7,7),TANK.surface-1.35-this.random()*.16,z+(this.random()-.5)*.9);
      pellet.velocity.set(0,-.04,0);count++;
    }
    if(count)this.lastFeed=this.time;return count;
  }
  chooseGoal(f) {
    const r=this.random;
    if(f.kind==='clown') {
      // Buston's field work: percula rarely stray past the periphery of their host's
      // tentacles, and the dominant female ranges widest while the smallest non-breeder is
      // held closest by her. Roughly a third of those excursions are a bathe instead — the
      // fish swims down through the crown, which is how it keeps its coat of host mucus
      // and, incidentally, how it ventilates the anemone.
      f.hold=r()<(f.rank?.36:.22)?2.2+r()*2.6:0;
      const a=r()*Math.PI*2,radius=HOST.radius*(f.hold?r()*.50:.34+r()*(f.rank===0?.98:f.rank===1?.74:.50));
      f.goal.set(HOST.x+Math.cos(a)*radius,HOST.y+(f.hold?.20+r()*.26:.66+r()*.94)-f.rank*.12,HOST.z+.34+Math.sin(a)*radius*.58);
      f.goalTimer=f.hold||2.8+r()*4.4;return;
    }
    // A wanderer takes its next leg, then rejoins the moving shoal when the legs run out; the shoalmates that left with it keep following instead.
    if(f.roam>0&&--f.roam>0){this.openWater(f.goal,f.position);f.goalTimer=24+r()*12;f.hold=0;return;}
    // A cleaner shrimp rocking its white antennae over a rock shoulder is advertising, and
    // a planktivore will leave the shoal to be worked over, hanging almost still above the
    // station for several seconds. Clownfish get cleaned at the anemone instead.
    const open=this.shrimp.filter(s=>s.state==='advertise'&&s.position.distanceToSquared(f.position)<16);
    if(open.length&&r()<.12){
      const s=open[Math.floor(r()*open.length)%open.length];
      f.goal.set(s.position.x+(r()-.5)*.4,s.position.y+.50+r()*.22,s.position.z+.28);
      f.hold=f.goalTimer=8+r()*5;return;
    }
    // Neither species is tied to its rock the way a goby is: a chromis or an anthias will
    // leave the shoal for a turn round the open column and come back to its slot, and a
    // shoalmate close enough to see it go is likely to go with it. Those small breakaway
    // groups, two or three fish sweeping the tank together and rejoining, are what the
    // school does between alarms; the alignment below keeps them moving as one.
    if(r()<(f.kind==='chromis'?.16:.23)&&f.alarm<=0){
      f.roam=2+Math.floor(r()*2);this.openWater(f.goal,f.position);f.goalTimer=24+r()*12;f.hold=0;
      for(const o of this.fish)if(o!==f&&o.kind===f.kind&&o.roam<=0&&!o.follow&&o.hold<=0&&o.position.distanceToSquared(f.position)<2.6&&r()<.40)o.follow=f;
      return;
    }
    // Change a local offset gently, but never choose a fixed world-space home. A fish
    // keeps travelling with the group when it is not on its own excursion or being cleaned.
    f.hold=0;
    const keep=.72,churn=1-keep;
    f.station.set(f.station.x*keep+(r()*2-1)*churn,f.station.y*keep+(r()*2-1)*churn,f.station.z*keep+(r()*2-1)*churn);
    if(f.kind==='chromis'&&r()<.12){
      const other=1-f.shoal;
      if(f.position.distanceToSquared(this.shoals[other].centre)<9)f.shoal=other;
    }
    this.station(f,f.goal);f.goalTimer=6+r()*8;
  }
  // Turn the wanted swim velocity into what a fish can actually do with it. The heading
  // turns at a bounded rate and the body bends into the turn; thrust only acts along the
  // heading, so a fish pointed the wrong way slows, pivots and goes, rather than sliding
  // sideways to its goal. Speed rides the bout-and-glide cycle, and when there is nowhere
  // to go the tail falls still and the pectorals take over the hovering.
  swim(f,want,dt) {
    const g=GAIT[f.kind],r=this.random,ease=k=>1-Math.exp(-dt*k);
    f.steer.lerp(want,ease(f.alarm>0?12:4.5));
    const demand=f.steer.length();
    if(demand>.025){
      const yawTo=Math.atan2(-f.steer.z,f.steer.x),angle=Math.atan2(Math.sin(yawTo-f.yaw),Math.cos(yawTo-f.yaw));
      const rate=g.turn*(f.alarm>0?2.1:.32+.68*clamp(f.speed/.5,0,1));
      f.turning+=(clamp(angle*2.8,-rate,rate)-f.turning)*ease(6);
      f.yaw+=f.turning*dt;
      f.pitch+=(clamp(Math.atan2(f.steer.y,Math.hypot(f.steer.x,f.steer.z)),-.60,.60)-f.pitch)*ease(2.4);
    }else{f.turning*=Math.exp(-dt*6);f.pitch*=Math.exp(-dt);}
    f.bend+=(clamp(f.turning*.10,-.23,.23)-f.bend)*ease(6);
    f.bank+=(clamp(-f.turning*.055,-.13,.13)-f.bank)*ease(4);
    const h=this._heading.set(Math.cos(f.yaw)*Math.cos(f.pitch),Math.sin(f.pitch),-Math.sin(f.yaw)*Math.cos(f.pitch));
    const target=f.alarm>0?demand:Math.max(0,h.dot(f.steer));
    f.bout-=dt;
    if(target<g.idle&&f.alarm<=0){
      f.beat=false;f.speed+=(target-f.speed)*ease(3.5);f.wave*=Math.exp(-dt*8);
    }else if(f.kind==='clown'&&f.alarm<=0){
      // Normal clownfish swimming is pectoral-powered, not an axial tail oscillator.
      f.beat=false;f.speed+=(target-f.speed)*ease(g.thrust);
      const effort=clamp((target-.32)/.55,0,1)*g.tail;
      f.wave+=(effort-f.wave)*ease(5);
    }else if(f.beat){
      f.speed+=(target*1.16-f.speed)*ease(g.thrust*(f.alarm>0?1.7:1));
      const effort=clamp(target/(g.length*f.size*1.1),.22,1);
      f.wave+=((f.alarm>0?1:effort)-f.wave)*ease(9);
      if(f.bout<=0){if(f.alarm>0)f.bout=.3;else{f.beat=false;f.bout=g.glide[0]+r()*(g.glide[1]-g.glide[0]);}}
    }else{
      f.speed*=Math.exp(-g.drag*dt);f.wave*=Math.exp(-dt*7);
      if(f.alarm>0||f.bout<=0||f.speed<target*.64){f.beat=true;f.bout=g.bout[0]+r()*(g.bout[1]-g.bout[0]);}
    }
    // Through-water distance per beat: the big male does not wag at a juvenile's rate.
    // A coast genuinely straightens the tail; no baseline wave is added in the renderer.
    f.tailHz=clamp(f.speed/(g.length*f.size*g.stride),0,f.alarm>0?4.2:2.8);
    if(f.wave>.008)f.phase=(f.phase+dt*Math.PI*2*f.tailHz)%(Math.PI*2);
    f.tailAmplitude=(f.kind==='clown'?.060:.095)*f.wave;
    const rowing=f.kind==='clown'?1:clamp(1-f.speed/.42,.18,1);
    f.rowing+=(rowing-f.rowing)*ease(6);
    f.pectoral=(f.pectoral+dt*Math.PI*2*(g.pectoral+(f.kind==='clown'?1.4:.5)*f.speed))%(Math.PI*2);
    this._relative.copy(f.steer).addScaledVector(h,-h.dot(f.steer));
    limitVector(this._relative,g.slip*(1-clamp((f.speed-.08)/.3,0,1)));
    f.velocity.copy(this._flow).addScaledVector(h,f.speed).add(this._relative);
  }
  step(dt=FIXED_STEP,pointer=null) {
    if(!Number.isFinite(dt)||dt<=0||dt>.101)throw new RangeError('Simulation step must be 0 < dt <= 0.101 seconds.');
    this.time+=dt;this.steps++;
    const t=this.time;
    for(const p of this.food)if(p.active){
      p.age+=dt;if(p.age>36){p.active=false;continue;}
      currentAt(p.position,t,this._flow);
      this._flow.y-=.17; // reduced gravity balanced by drag: bounded settling velocity
      p.velocity.lerp(this._flow,1-Math.exp(-dt*4));p.position.addScaledVector(p.velocity,dt);
      const bed=groundHeight(p.position.x,p.position.z)+p.size;
      if(p.position.y<bed){p.position.y=bed;p.velocity.multiplyScalar(.1);}
    }
    // Move the social centres along collision-checked routes at swimming speed, not
    // exponentially towards distant targets (which made a centre race ahead then stall).
    for(const s of this.shoals){
      if(!s.path.length){
        s.out.copy(this.navigation.destination(s.centre,s.sector,this.random));
        s.path=this.navigation.route(s.centre,s.out);s.sector=(s.sector+s.direction+3)%3;
      }
      while(s.path.length>1&&s.centre.distanceToSquared(s.path[0])<.16)s.path.shift();
      this._desired.subVectors(s.path[0],s.centre);
      const d=this._desired.length(),speed=s.speed*(.92+.08*Math.sin(t*.19+s.home.x));
      if(d<.14){s.path.shift();s.velocity.multiplyScalar(.9);}
      else{s.velocity.copy(this._desired).multiplyScalar(Math.min(speed,d/dt)/d);s.centre.addScaledVector(s.velocity,dt);}
    }
    // Read neighbours from a snapshot: no order-dependent following of already-updated fish.
    const old=this.previous;
    for(let i=0;i<this.fish.length;i++){old[i].p.copy(this.fish[i].position);old[i].v.copy(this.fish[i].velocity);old[i].alarm=this.fish[i].alarm;}
    for(let index=0;index<this.fish.length;index++) {
      const f=this.fish[index],p=f.position;
      currentAt(p,t,this._flow);
      f.alarm=Math.max(0,f.alarm-dt);f.goalTimer-=dt;
      // A neighbour's bolt takes about seventy milliseconds to reach this fish, against
      // about eight for the one that saw the threat itself, so the response is held here
      // and released a few frames late. That delay is the whole difference between a
      // school that flinches as one object and one that flinches as a wave.
      if(f.spook>0&&(f.spook-=dt)<=0)f.alarm=2.3;
      if(pointer&&pointer.speed>.9&&p.distanceToSquared(pointer.position)<8.5)f.alarm=2.6;
      // Ease out of the shelter envelope after an alarm. Restoring its full radius in a
      // single step would visibly eject a chromis from the thicket when the timer expires.
      f.shelterAccess+=((f.alarm>0?1:0)-f.shelterAccess)*(1-Math.exp(-dt*(f.alarm>0?4:.9)));
      if(f.hold>0)f.hold=Math.max(0,f.hold-dt);
      // The terminal male's U-swim: a fast dive under the harem and back up the far side.
      // Shapiro's counts make this and the nose rush male-only — a female performs them at
      // effectively zero rate — so it is the single movement that sexes the fish on sight.
      if(f.kind==='anthias'&&!f.rank){
        f.show-=dt;
        if(f.show<=0){f.display=USWIM;f.show=11+this.random()*13;}
        if(f.display>0)f.display=Math.max(0,f.display-dt);
      }
      // A follower's goal is its leader's flank for as long as the leader is out roaming.
      if(f.follow&&(f.follow.roam<=0||f.alarm>0))f.follow=null;
      if(f.follow){f.goal.copy(f.follow.position).addScaledVector(f.station,1.2);f.goalTimer=1;}
      else if(f.goalTimer<=0||(!f.hold&&p.distanceToSquared(f.goal)<(f.roam>0?.8:.10)))this.chooseGoal(f);
      else if(f.shoal>=0&&!f.hold&&f.roam<=0)this.station(f,f.goal); // the slot travels with its shoal
      let goal=f.goal,food=null,nearest=2.5**2;
      if(f.alarm>0){
        f.state='shelter';f.roam=0;
        // A percula backs into the tentacles; every open-water fish goes down to the
        // structure its shoal is attached to — the chromis into the branches of their own
        // coral head in unison, the anthias to the arch and the holes in it. The chromis
        // goal sits inside the colony's own envelope, so the pod presses down onto the
        // branches and the obstacle field is what stops it, rather than hovering politely
        // above the coral it is supposed to be hiding in.
        if(f.kind==='clown')this._desired.set(HOST.x+(f.rank-1)*.44,HOST.y+.50,HOST.z+.30);
        else{const s=this.shoals[f.shoal].shelter;this._desired.set(s.x+(p.x-s.x)*.30,s.y+(f.kind==='chromis'?.55:1.05),s.z+(p.z-s.z)*.30);}
        goal=this._desired;
      }else if(f.display>0){
        f.state='display';
        const s=this.shoals[f.shoal],k=1-f.display/USWIM;
        this._desired.set(s.centre.x+(k*2-1)*2.1,s.centre.y+.40-Math.sin(k*Math.PI)*1.75,s.centre.z+.30);
        goal=this._desired;
      }else{
        f.state=f.hold?(f.kind==='clown'?'bathe':'clean'):f.kind!=='clown'?'roam':'forage';
        for(const item of this.food)if(item.active){
          if(f.kind==='clown'&&((item.position.x-HOST.x)**2+(item.position.y-HOST.y-.7)**2+(item.position.z-HOST.z)**2)>10)continue;
          const d=p.distanceToSquared(item.position);if(d<nearest){nearest=d;food=item;goal=item.position;}
        }
        if(food)f.state='feed';
      }
      // A fish being cleaned, or one wallowing in the tentacles, is barely swimming.
      if(f.kind!=='clown'&&f.alarm<=0)goal=this.travelGoal(f,goal,dt);
      const topSpeed=(f.kind==='clown'?.59:f.kind==='anthias'?.98:1.10)*f.cruise*(f.alarm>0?1.65:f.display>0?1.5:food?1.3:f.hold&&p.distanceToSquared(f.goal)<.5?.16:1);
      this._delta.subVectors(goal,p);const dist=this._delta.length();
      this._force.copy(this._delta).multiplyScalar(dist>1e-5?Math.min(topSpeed,dist*.68)/dist:0);
      this._force.sub(this._flow); // swim velocity relative to the moving water
      this._sep.set(0,0,0);this._cohesion.set(0,0,0);this._align.set(0,0,0);let neighbors=0;
      for(let j=0;j<this.fish.length;j++)if(j!==index){
        const other=this.fish[j],q=old[j].p;this._delta.subVectors(p,q);const d2=this._delta.lengthSq();
        // Open-water fish keep well over a body length between them; the clownfish crowd.
        const personal=(f.size+other.size)*(f.kind==='clown'?.46:.68);
        if(d2<personal*personal&&d2>1e-8)this._sep.addScaledVector(this._delta,(personal-Math.sqrt(d2))/d2*(f.kind==='clown'&&other.kind==='clown'&&f.rank>other.rank?1.9:1.1));
        if(f.kind!=='clown'&&other.kind===f.kind&&d2<7.84&&d2>.18){this._cohesion.add(q);this._align.add(old[j].v);neighbors++;}
        // Only a fresh bolt recruits, so the alarm cannot circulate back round the school
        // and hold it up indefinitely.
        if(f.alarm<=0&&f.spook<=0&&other.kind===f.kind&&old[j].alarm>1.9&&d2<4.0)f.spook=.055;
      }
      this._force.addScaledVector(this._sep,1.3);
      // Moving destinations keep the shoal together, so cohesion only softens the edges;
      // alignment is what makes a turn run through the group.
      if(neighbors&&f.alarm<=0&&!food){
        this._cohesion.multiplyScalar(1/neighbors).sub(p);this._align.multiplyScalar(1/neighbors).sub(f.velocity);
        this._force.addScaledVector(this._cohesion,.035).addScaledVector(this._align,.20);
      }
      // Non-host fish avoid cnidarian tentacles; residents can enter the living crown.
      if(f.kind!=='clown'){
        this._delta.set(p.x-HOST.x,(p.y-HOST.y-.55)*1.2,p.z-HOST.z);
        const d=this._delta.length();if(d<2.4&&d>.001)this._force.addScaledVector(this._delta,(2.4-d)/d*1.9);
      }
      // Anticipatory ellipsoid avoidance before position integration.
      const own=f.kind==='chromis'?SHELTER+f.shoal:-1;
      for(let k=0;k<REEF_BOUNDS.length;k++){
        const o=REEF_BOUNDS[k],keep=k===own?1.22-.38*f.shelterAccess:1.22;
        const mx=o[3]+f.size*.26,my=o[4]+f.size*.25,mz=o[5]+f.size*.25;
        const dx=(p.x+f.velocity.x*.6-o[0])/mx,dy=(p.y+f.velocity.y*.6-o[1])/my,dz=(p.z+f.velocity.z*.6-o[2])/mz;
        const d=Math.hypot(dx,dy,dz);
        if(d<keep&&d>1e-6){this._delta.set(dx/mx,dy/my,dz/mz).normalize();this._force.addScaledVector(this._delta,(keep-d)*2.6);}
      }
      if(p.y<.55)this._force.y+=(.55-p.y)*2;
      if(p.y>TANK.surface-.6)this._force.y-=(p.y-(TANK.surface-.6))*2;
      if(Math.abs(p.x)>8)this._force.x-=Math.sign(p.x)*(Math.abs(p.x)-8)*2;
      if(p.z>4.5)this._force.z-=(p.z-4.5)*2;
      if(p.z<TANK.back+.45)this._force.z+=(TANK.back+.45-p.z)*3;
      limitVector(this._force,topSpeed);
      this.swim(f,this._force,dt);
      limitVector(f.velocity,1.7);p.addScaledVector(f.velocity,dt);
      // Robust final nonpenetration for rocks. Smooth steering normally keeps this idle.
      for(let k=0;k<REEF_BOUNDS.length;k++){
        const o=REEF_BOUNDS[k],shrink=k===own?1-.30*f.shelterAccess:1;
        const rx=(o[3]+f.size*.19)*shrink,ry=(o[4]+f.size*.18)*shrink,rz=(o[5]+f.size*.19)*shrink;
        const dx=(p.x-o[0])/rx,dy=(p.y-o[1])/ry,dz=(p.z-o[2])/rz,d=Math.hypot(dx,dy,dz);
        if(d<1&&d>1e-7){
          p.set(o[0]+dx/d*rx,o[1]+dy/d*ry,o[2]+dz/d*rz);
          this._delta.set(dx/rx,dy/ry,dz/rz).normalize();const into=f.velocity.dot(this._delta);if(into<0){f.velocity.addScaledVector(this._delta,-into);f.speed*=.5;}
        }
      }
      p.y=clamp(p.y,groundHeight(p.x,p.z)+.2,TANK.surface-.18);p.x=clamp(p.x,TANK.left+.25,TANK.right-.25);p.z=clamp(p.z,TANK.back+.22,TANK.front-.3);
      // percula rows with its pectorals and the body rocks against the stroke. The waddle
      // is the species' walk, not a symptom of hurrying, so it rides on the bank angle at
      // the pectoral beat rather than replacing it.
      f.roll=f.bank+(f.kind==='clown'?Math.sin(f.pectoral)*.075:0);
      if(food&&p.distanceToSquared(food.position)<(f.size*.42)**2){food.active=false;this.consumed++;f.goalTimer=0;}
    }
    this.stepShrimp(dt,pointer);
  }
  // A cleaner shrimp lives on one rock shoulder. Most of its day is spent standing over it
  // advertising — whipping the long white antennae, which precedes four cleans in five, and
  // rocking the white first pair of legs fore and aft, which is the display Caves measured
  // in this species rather than the whole-body sway of the swimming cleaners — broken by
  // short walks to reposition and longer spells picking at the rock with the two chelate
  // pairs. Now and then it leaves the shoulder altogether: down the flank onto the sand
  // around the rock, or along the next rock where the sand is walled off, a spell picking
  // there, and the walk home, as a tank cleaner does between clients. Fish only steer for a
  // shrimp that is advertising (`chooseGoal`); one that arrives is turned to, stepped under
  // and reached at. A tail flip is the only violent thing the animal does and only a body
  // going past at speed sets it off.
  stepShrimp(dt,pointer) {
    const r=this.shrimpRandom;
    // A place is tested for the whole animal and not for one point. It fits where the body
    // can be carried over the ground under its length without standing up higher than its
    // legs allow, and where every walking foot, seated exactly as the model will be drawn
    // (`seatShrimp`), can still fold down to its own ground — so a tail never runs into the
    // rock behind, a head into the one ahead nor a foot into the one beside, turning or
    // stepping.
    const fits=(x,z,yaw)=>{const seat=seatShrimp(x,z,yaw);return seat.lift<=SHRIMP.lift&&seat.feet.every(([fx,fy,fz])=>supportHeight(fx,fz)-fy<=SHRIMP.stretch);};
    // And a foot only goes down where the animal can stand. On the shoulder that is within
    // its working range, never far below the station and never on ground too steep; on an
    // excursion it is anywhere within roam, down a flank it can climb.
    const tread=(s,x,z,yaw,out)=>{
      if((x-s.home.x)**2+(z-s.home.z)**2>(out?SHRIMP.roam:SHRIMP.range)**2)return false;
      const h=supportHeight(x,z);
      if(!out&&Math.abs(h-supportHeight(s.home.x,s.home.z))>SHRIMP.drop)return false;
      if(Math.hypot(supportHeight(x+.12,z)-supportHeight(x-.12,z),supportHeight(x,z+.12)-supportHeight(x,z-.12))>(out?SHRIMP.flank:SHRIMP.grade)*.24)return false;
      return fits(x,z,yaw);
    };
    // A leg is walked at the animal's own pace with time to square up first. A route is a spot
    // between rmin and rmax of a centre that a straight walk from here reaches with every
    // finger's breadth of the way tested for the body as it will be carried, forward or astern;
    // on the sand first when asked, then on any ground.
    const leg=s=>Math.hypot(s.goal.x-s.position.x,s.goal.z-s.position.z)/SHRIMP.speed*1.4+2.5;
    const route=(s,cx,cz,rmin,rmax,sand,astern)=>{
      for(let pass=sand?0:1;pass<2;pass++)for(let k=0;k<10;k++){
        const a=r()*6.2832,d=rmin+r()*(rmax-rmin),x=cx+Math.cos(a)*d,z=cz+Math.sin(a)*d;
        if(pass===0&&supportHeight(x,z)-groundHeight(x,z)>.03)continue;
        const dx=x-s.position.x,dz=z-s.position.z,n=Math.hypot(dx,dz),yaw=Math.atan2(-dz,dx)+(astern?Math.PI:0);let open=n>SHRIMP.hike;
        for(let t=.03;t<=n&&open;t+=.03)open=tread(s,s.position.x+dx/n*t,s.position.z+dz/n*t,yaw,true);
        if(open){s.goal.set(x,supportHeight(x,z),z);s.reverse=astern;return true;}
      }
      return false;
    };
    // Square up onto the bearing first and only then walk it. Returns how far off the target
    // still was, so the caller can tell arrival from a step that is going nowhere.
    const toward=(s,tx,tz,astern,near)=>{
      const dx=tx-s.position.x,dz=tz-s.position.z,range=Math.hypot(dx,dz);
      const bearing=Math.atan2(-dz,dx)+(astern?Math.PI:0)-s.yaw;
      const off=Math.atan2(Math.sin(bearing),Math.cos(bearing));
      // Turning sweeps the tail and the claws through a body's length of ground, so a turn
      // is tested like a step, and one the rock refuses is not made.
      let turn=clamp(off,-SHRIMP.turn*dt,SHRIMP.turn*dt);
      if(fits(s.position.x,s.position.z,s.yaw+turn))s.yaw+=turn;else turn=0;
      let gone=0;
      if(Math.abs(off)<SHRIMP.square&&range>near){
        gone=Math.min(SHRIMP.speed*dt,range-near);
        const x=s.position.x+dx/range*gone,z=s.position.z+dz/range*gone;
        if(tread(s,x,z,s.yaw,s.out>0)){s.position.x=x;s.position.z=z;}else{gone=0;s.timer=0;}
      }else if(!turn&&range>near)s.timer=0;
      // Ground covered drives the gait — by the feet as much as by the body, so a turn on
      // the spot steps too — and nothing else does, so the legs can never skate.
      s.step=(s.step+((astern?-gone:gone)+Math.abs(turn)*SHRIMP.pivot)/SHRIMP.stride+1)%1;
      return range;
    };
    for(const s of this.shrimp) {
      s.rhythm=(s.rhythm+dt)%SHRIMP.wrap;s.timer-=dt;if(!s.out)s.away-=dt;
      s.position.y=supportHeight(s.position.x,s.position.z);
      let client=null,nearest=SHRIMP.reach**2;
      for(const f of this.fish)if(f.state==='clean'){const d=f.position.distanceToSquared(s.position);if(d<nearest){nearest=d;client=f;}}
      // Caridoid escape. Only a body going past at speed sets it off, never the client
      // hanging still overhead, so it stays the rarity it is in an undisturbed tank.
      if(s.state!=='escape'&&!client&&((pointer&&pointer.speed>1.2&&pointer.position.distanceToSquared(s.position)<SHRIMP.startle)
        ||this.fish.some(f=>f.alarm>0&&f.velocity.lengthSq()>SHRIMP.rush&&f.position.distanceToSquared(s.position)<SHRIMP.startle))){s.state='escape';s.timer=SHRIMP.flee;}
      let stepping=false;
      if(s.state==='escape'){
        const age=SHRIMP.flee-s.timer,bout=SHRIMP.flip*SHRIMP.flips;
        if(age<bout){
          // Flexion is 47% of the stroke and the abdomen never straightens fully between
          // flips, which is why a bout reads as one movement and not as two twitches.
          const k=(age%SHRIMP.flip)/SHRIMP.flip;s.curl=k<.47?k/.47:1-(k-.47)/.53*.70;
          if(k<.47){const x=s.position.x-Math.cos(s.yaw)*SHRIMP.jet*dt,z=s.position.z+Math.sin(s.yaw)*SHRIMP.jet*dt;
            if(tread(s,x,z,s.yaw,s.out>0)){s.position.x=x;s.position.z=z;}}
        }else s.curl=Math.max(0,.30-(age-bout)*SHRIMP.unroll);
        // It goes over onto one side as it fires — within fifteen milliseconds of the first
        // flexion in Arnott's frames — and rights itself as the abdomen comes back down.
        s.sway=s.curl*1.3;
        if(s.timer<=0){s.state='advertise';s.timer=SHRIMP.stand+r()*5;}
      }else if(client){
        s.state='serve';s.timer=SHRIMP.hold;
        stepping=toward(s,client.position.x,client.position.z,false,SHRIMP.under)>SHRIMP.under;
      }else if(s.state==='walk'){
        stepping=true;
        if(toward(s,s.goal.x,s.goal.z,s.reverse,SHRIMP.arrive)<=SHRIMP.arrive)s.timer=0;
      }
      if(s.timer<=0){
        // An excursion is one leg out, a spell picking wherever it got to, and the leg home.
        // A home leg the ground cuts short is walked again from where it stopped, forward and
        // astern by turns, with a spell of picking between tries, until it is home.
        const far=(s.position.x-s.home.x)**2+(s.position.z-s.home.z)**2>SHRIMP.hike**2;
        if(s.out===1){s.state='pick';s.timer=SHRIMP.graze+r()*4;s.out=2;}
        else if(s.out===3&&!far){s.out=0;s.away=SHRIMP.outing*(1+r());s.state='advertise';s.timer=SHRIMP.stand+r()*5;}
        else if(s.out>=2){if(route(s,s.home.x,s.home.z,0,SHRIMP.hike,false,s.out===3&&!s.reverse)){s.state='walk';s.timer=leg(s);}else{s.state='pick';s.timer=2.5+r()*3.5;}s.out=3;}
        else if(s.away<=0&&route(s,s.home.x,s.home.z,SHRIMP.range+.3,SHRIMP.roam,true,false)){s.state='walk';s.timer=leg(s);s.out=1;}
        else{
          if(s.away<=0)s.away=SHRIMP.outing*.3;
          const roll=r();let footing=false;
          if(roll<SHRIMP.bout)for(let k=0;k<8&&!footing;k++){
            const a=r()*6.2832,d=SHRIMP.hike+r()*(SHRIMP.range-SHRIMP.hike),x=s.home.x+Math.cos(a)*d,z=s.home.z+Math.sin(a)*d;
            if((x-s.position.x)**2+(z-s.position.z)**2>SHRIMP.hike**2&&tread(s,x,z,Math.atan2(s.position.z-z,x-s.position.x),false)){s.goal.set(x,supportHeight(x,z),z);footing=true;}
          }
          // Carideans back out of places as readily as they walk into them.
          if(footing){s.state='walk';s.timer=1.2+r()*1.8;s.reverse=r()<.22;}
          else if(roll<SHRIMP.bout+SHRIMP.forage){s.state='pick';s.timer=2.5+r()*3.5;}
          else{s.state='advertise';s.timer=SHRIMP.stand+r()*5;}
        }
      }
      // Rocking is elicited by a big dark shape overhead rather than by a fish as such, and
      // it runs four times as often at a predator-sized client as at a small one.
      const show=client?.62+.38*Math.min(1,client.size*1.3):s.state==='walk'?.10:s.state==='pick'?.26:s.state==='escape'?0:.58;
      s.signal+=(show-s.signal)*(1-Math.exp(-dt*2.4));
      s.walk+=((stepping?1:0)-s.walk)*(1-Math.exp(-dt*7));
      s.pick+=((s.state==='pick'?1:0)-s.pick)*(1-Math.exp(-dt*3));
      s.reach+=((s.state==='serve'?1:0)-s.reach)*(1-Math.exp(-dt*2.8));
      // Antennules flick in bursts of a few and then rest. A lobster's rate climbs from
      // under one a second to three and a half once there is food in the water, so the
      // bursts close up when this animal has something worth reading.
      if((s.burst-=dt)<=0){s.sniff=1-s.sniff;s.burst=s.sniff?1.4+r()*1.6:(1.2+r()*2.8)/(1+s.signal);}
      s.flick+=(s.sniff-s.flick)*(1-Math.exp(-dt*9));
      // The whole-body rock that goes with the antennal whip: a slow half-hertz lean that
      // grows with the signal rather than quickening. At two hertz it read as a shiver.
      if(s.state!=='escape'){s.sway=Math.sin(3.1416*s.rhythm)*s.signal;s.curl-=s.curl*(1-Math.exp(-dt*6));}
    }
  }
  diagnostics(){
    return {time:this.time,steps:this.steps,population:POPULATION,food:this.food.filter(p=>p.active).length,consumed:this.consumed,
      maxSpeed:Math.max(...this.fish.map(f=>f.velocity.length())),finite:this.fish.every(f=>[...f.position,...f.velocity,f.yaw,f.phase].every(Number.isFinite))};
  }
}
