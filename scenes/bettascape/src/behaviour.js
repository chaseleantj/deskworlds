import { Vector3 as V3 } from 'three';
import { NJ, J0, JD, IP } from './rig.js';
import { createFood } from './food.js';

// The fish: what it wants (think), how its body answers (simulate), the small signs of life,
// and the skeleton pose the shaders skin onto. Nothing here draws; the state it produces is
// the set of shader uniforms render.js hands to every material.

// Simulation runs on a fixed step, so the same seed and time give the same fish whatever the
// display rate.
export const FIXED_STEP = 1 / 60;

const TAU = Math.PI * 2;
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const approach = (x, target, rate, dt) => x + (target - x) * (1 - Math.exp(-rate * dt));
export const smooth01 = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const CURIOUS_HOLD = 5.0;    // s of cursor stillness before the fish loses interest
const SURFACE_GAP = 40;      // s at least between air gulps
const DART_STANDOFF = 0.6;   // body distance from the cursor during a curious dart; the head nearly touches
const CURIOUS_FOLLOW = 2.5;  // 1/s: how quickly the fish's attention catches up with the cursor
const CURIOUS_TURN = 0.85;   // rad a curious fish turns off its broadside toward the cursor
const REVERSAL = 2.6;        // rad of heading error beyond which a turn is routed past the viewer
const LAG_MAX = 0.25, LAG_W = 4.0, LAG_ZETA = 0.45;   // fin lag: reach, spring rate (rad/s), damping
const LAG_DELAYS = [0, 0.1, 0.22, 0.38];              // s by which the lag reaches points from root to tip
const HOVER_BRAKE = 1.2;     // 1/s: how hard a fish arriving at rest stops itself
const HEAD = 0.4;            // from the turning pivot forward to the mouth

// Feeding. Bettas are surface feeders with an upturned mouth: they notice food landing almost
// at once, swim up under it, and take it with a short lunge and a snap that sucks it in.
const FEED = {
  notice: [0.35, 0.9],   // s before the fish reacts to food on the water
  speed: [0.55, 0.7],    // approach speed
  reach: 0.2,            // mouth-to-pellet distance at which it strikes
  dart: 0.4,             // speed added by the lunge
  swallow: 0.07,         // s from the snap to the pellet gone, when the mouth is widest
  handle: [0.3, 0.8],    // s spent mouthing a pellet before the next
  floor: 0.25,           // how far below the tank floor a pellet is still worth chasing
  scull: 4,              // station keeping under a pellet, against 1 for hovering
};

// Smooth 1D value noise in about [-1, 1], two octaves; seed picks an independent channel.
const hash1 = (n) => { const h = Math.sin(n * 127.1 + 311.7) * 43758.5453; return h - Math.floor(h); };
function noise1(x, seed) {
  const oct = (y) => { const i = Math.floor(y), f = y - i, u = f * f * (3 - 2 * f); return 2 * (hash1(i + seed * 57.3) * (1 - u) + hash1(i + 1 + seed * 57.3) * u) - 1; };
  return 0.7 * oct(x) + 0.3 * oct(x * 2.13 + 5.1);
}

function basis(yaw, pitch, roll) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const F = new V3(cp * cy, sp, -cp * sy);
  const U0 = new V3(-sp * cy, cp, sp * sy);
  const S0 = new V3().crossVectors(F, U0);
  const U = U0.multiplyScalar(Math.cos(roll)).addScaledVector(S0, Math.sin(roll));
  const S = new V3().crossVectors(F, U);
  return { F, U, S };
}

// `random` drives the fish's choices; `lifeSeed` its small involuntary movements (gulps,
// saccades), kept on their own stream so a posed fish breathes the same way every time.
export function createBetta({ random = Math.random, lifeSeed = 7 } = {}) {
  const rand = (a, b) => a + random() * (b - a);
  function lifeRand(a, b) {
    lifeSeed = (lifeSeed + 0x6D2B79F5) | 0;
    let t = Math.imul(lifeSeed ^ (lifeSeed >>> 15), 1 | lifeSeed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return a + (((t ^ (t >>> 14)) >>> 0) / 4294967296) * (b - a);
  }

  // Shader uniforms, owned here because the simulation writes them every step.
  const uniforms = {
    uSP: { value: Array.from({ length: NJ }, () => new V3()) },
    uST: { value: Array.from({ length: NJ }, () => new V3(1, 0, 0)) },
    uSU: { value: Array.from({ length: NJ }, () => new V3(0, 1, 0)) },
    uJ0: { value: J0 }, uJD: { value: JD },
    uTime: { value: 0 }, uBreath: { value: 0 }, uWave: { value: 1 },
    uSpread: { value: 1 }, uStream: { value: 0 }, uOverlap: { value: 1 },
    uPleat: { value: 1 }, uLag: { value: new V3() },
    uLagW: { value: Array.from({ length: 4 }, () => new V3()) }, uSwayT: { value: 0 }, uFlutter: { value: 1 },
    uOper: { value: 0 }, uMouth: { value: 0 },
  };
  const flap = { phase: { value: 0 }, amp: { value: 1 } };   // pectoral beat, shared with the body for the pad's shading
  const gaze = { [1]: { value: new V3() }, [-1]: { value: new V3() } };   // each eye moves on its own

  const bounds = { min: new V3(-2, -1, -2.2), max: new V3(2, 1, 1.0) };
  const fish = {
    pos: new V3(0.3, 0.05, -0.2), vel: new V3(),
    yaw: 0.25, pitch: 0, roll: 0, yawRate: 0, pitchRate: 0, rollRate: 0,
    tailPhase: 0, tailAmp: 0.1, tailFreq: 1, beating: false, reversal: 0,
    kTurn: new Float32Array(NJ), kPitch: new Float32Array(NJ),
    lag: new V3(), lagVel: new V3(), prevVel: new V3(), stream: 0, flare: 0,
    basis: basis(0.25, 0, 0),
  };
  const pointer = { lastMove: -1e9, inside: false, world: new V3(), interest: new V3() };
  const brain = {
    mode: 'hover', until: 8, nextLook: 3, lookYaw: 0.25, lookPitch: 0, turnRate: 0.5, goal: new V3(), speed: 0,
    lastSurface: 0, station: new V3(), standoff: 0.95, dartUntil: 0, side: 0, faceUntil: 0, nextGlance: 0,
    noticeAt: null, target: null, strikeAt: 0, handleUntil: 0,
  };
  // Small signs of life: breathing, mouth, eyes, fin tone, and the delayed wave of the fin lag.
  const life = {
    activity: 0, breath: 0, swayT: 0, lagHist: [],
    gulpAt: 5, gulpStart: -10, gulpLen: 0.4, gulpAmp: 0,
    saccadeAt: 0.6, look: new V3(),                       // shared gaze offset, jumped to at each saccade
    eyes: { [1]: { off: new V3(), at: 1.3, g: new V3() }, [-1]: { off: new V3(), at: 2.1, g: new V3() } },
  };
  const food = createFood(random);
  const stats = { strikes: 0, eaten: 0 };
  let time = 0, frozen = false;

  // A swim goal between depths yLo and yHi, with enough horizontal run that the fish can reach it on a
  // shallow glide slope (the heading controller pitches well short of a steep target). Legs run
  // mostly across the tank, along the glass, so the fish swims broadside to the viewer.
  const GLIDE_SLOPE = 0.5, ACROSS = 0.5;   // max rise per unit run; max toward/away-from-glass travel per unit sideways
  function swimGoal(yLo, yHi) {
    const g = new V3();
    const reach = rand(0.6, 1.5);
    for (let i = 0; i < 24; i++) {
      g.set(rand(bounds.min.x, bounds.max.x), rand(yLo, yHi), rand(bounds.min.z * 0.6, bounds.max.z)).clamp(bounds.min, bounds.max);
      const dx = Math.abs(g.x - fish.pos.x), run = Math.hypot(dx, g.z - fish.pos.z);
      // the first tries only look ahead, so a leg carries on the way the fish faces when there is room
      const ahead = i >= 12 || (g.x - fish.pos.x) * fish.basis.F.x > 0;
      if (ahead && run > reach && Math.abs(g.y - fish.pos.y) < run * GLIDE_SLOPE && Math.abs(g.z - fish.pos.z) < dx * ACROSS) break;
    }
    return g;
  }

  // Next heading while hovering. A betta idling by the glass mostly shows its flank: small settles
  // around the broadside it already presents, sometimes a three-quarter turn toward the viewer, and
  // rarely a full reversal, which the heading controller routes through facing the viewer.
  function lookHeading() {
    const side = Math.cos(fish.yaw) >= 0 ? 0 : Math.PI;
    const toViewer = side === 0 ? -1 : 1;   // turning this way from a broadside brings the head round to the glass
    const r = random();
    if (r < 0.6) return side + clamp(wrapPi(fish.yaw - side) + rand(-0.3, 0.3), -0.4, 0.4);
    if (r < 0.92) return side + toViewer * rand(0.5, 0.9);
    return side + Math.PI + rand(-0.3, 0.3);
  }

  function setMode(mode, now) {
    brain.mode = mode;
    if (mode === 'hover') {
      brain.until = now + rand(6, 15); brain.lookYaw = fish.yaw; brain.lookPitch = fish.pitch;
      brain.nextLook = now + (Math.abs(fish.basis.F.z) > 0.5 ? rand(0.2, 0.6) : rand(2, 5));   // soon, if arriving end-on
    }
    // Bettas patrol mostly level, near the current depth and easing back toward mid-water.
    if (mode === 'cruise') { brain.goal.copy(swimGoal(fish.pos.y * 0.7 - 0.4, fish.pos.y * 0.7 + 0.4)); brain.speed = rand(0.3, 0.55); brain.until = now + 14; }
    if (mode === 'surface') { brain.speed = 0.4; brain.until = now + 12; brain.lastSurface = now; }
    if (mode === 'breathe') brain.until = now + rand(0.8, 1.3);
    if (mode === 'descend') { brain.goal.copy(swimGoal(bounds.min.y, 0.1)); brain.speed = 0.3; brain.until = now + 12; }
    if (mode === 'curious') {
      pointer.interest.copy(pointer.world);
      brain.nextGlance = now; brain.side = Math.cos(fish.yaw) >= 0 ? 0 : Math.PI; brain.standoff = rand(0.8, 1.1);
      if (random() < 0.3) fish.flare = 1;
    }
    if (mode === 'feed') { brain.speed = rand(...FEED.speed); brain.target = null; brain.strikeAt = 0; brain.handleUntil = 0; }
  }

  // Food outranks everything else: once the fish has noticed a pellet it feeds until none is left.
  function appetite(now, head) {
    const floor = bounds.min.y - FEED.floor;
    if (!food.nearest(head, floor) && !brain.strikeAt) {
      brain.noticeAt = null;
      if (brain.mode === 'feed') setMode('hover', now);
      return;
    }
    if (brain.mode === 'feed') return;
    if (brain.noticeAt === null) brain.noticeAt = now + rand(...FEED.notice);
    else if (now >= brain.noticeAt) setMode('feed', now);
  }

  // The mouth snap of a strike, on the same gulp channel the fish breathes and gapes with.
  function snap(now) {
    life.gulpStart = now; life.gulpLen = 0.16; life.gulpAmp = 1;
    life.gulpAt = Math.max(life.gulpAt, now + 1);
  }

  function think(now, dt) {
    const F = fish.basis.F;
    const head = fish.pos.clone().addScaledVector(F, HEAD);
    appetite(now, head);
    const curious = brain.mode !== 'feed' && pointer.inside && now - pointer.lastMove < CURIOUS_HOLD;
    if (curious && brain.mode !== 'curious') setMode('curious', now);
    if (!curious && brain.mode === 'curious') setMode('hover', now);

    let dir = F.clone(), speed = 0, hold = null, holdGain = 1, levelPitch = 0.6, turn = 1.0;

    switch (brain.mode) {
      case 'hover': {
        if (now > brain.nextLook) {
          brain.lookYaw = lookHeading();
          brain.lookPitch = rand(-0.35, 0.2);
          const sweep = Math.abs(wrapPi(brain.lookYaw - fish.yaw));
          brain.turnRate = rand(0.3, 0.5);
          // a three-quarter look at the viewer is held briefly; a settled broadside is held long
          const dwell = Math.abs(Math.sin(brain.lookYaw)) > 0.45 ? rand(1.5, 3) : rand(4, 9);
          brain.nextLook = now + sweep / brain.turnRate + dwell;
        }
        // never quite still: small continuous corrections of heading and trim
        const yaw = brain.lookYaw + 0.05 * noise1(now * 0.45, 11) + 0.012 * noise1(now * 1.7, 12);
        const pitch = brain.lookPitch + 0.07 * noise1(now * 0.55, 13) + 0.02 * noise1(now * 1.9, 14);
        dir.set(Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), -Math.cos(pitch) * Math.sin(yaw));
        hold = fish.pos.clone().clamp(bounds.min, bounds.max);
        turn = brain.turnRate;
        if (now > brain.until) {
          const r = random();
          setMode(now - brain.lastSurface > SURFACE_GAP && r < 0.35 ? 'surface' : r < 0.7 ? 'cruise' : 'hover', now);
        }
        break;
      }
      case 'cruise':
      case 'descend': {
        const to = brain.goal.clone().sub(head);
        const dist = to.length();
        dir.copy(to).normalize();
        speed = Math.min(brain.speed, dist * 0.55 + 0.05);
        turn = 0.6;
        if (dist < 0.3 || now > brain.until) setMode('hover', now);
        break;
      }
      // A steep climb along the current heading, a nose-up pause at the top, then back down.
      case 'surface':
      case 'breathe': {
        dir.set(F.x, 0, F.z).normalize().multiplyScalar(0.6).add(new V3(0, 0.8, 0)).normalize();
        levelPitch = 1;
        if (brain.mode === 'surface') {
          speed = brain.speed;
          if (head.y > bounds.max.y + 0.05) setMode('breathe', now);
          else if (now > brain.until) setMode('hover', now);
        } else {
          hold = fish.pos.clone();
          if (now > brain.until) setMode('descend', now);
        }
        break;
      }
      case 'curious': {
        pointer.interest.x = approach(pointer.interest.x, pointer.world.x, CURIOUS_FOLLOW, dt);
        pointer.interest.y = approach(pointer.interest.y, pointer.world.y, CURIOUS_FOLLOW, dt);
        pointer.interest.z = approach(pointer.interest.z, pointer.world.z, CURIOUS_FOLLOW, dt);
        const I = pointer.interest;
        const look = I.clone().sub(head).normalize();
        // Bettas inspect with one eye: the body keeps presenting its flank, turning only part way
        // toward the cursor while the eyes track it, and swings round to the other flank only once
        // the cursor has been left behind. Facing it head-on is a brief moment, sometimes with a dart.
        if (now > brain.nextGlance) {
          if ((I.x - fish.pos.x) * Math.cos(brain.side) < -0.35) brain.side = brain.side === 0 ? Math.PI : 0;
          brain.faceUntil = random() < 0.3 ? now + rand(1, 1.8) : 0;
          brain.standoff = rand(0.8, 1.1);
          if (brain.faceUntil && random() < 0.35) { brain.dartUntil = now + rand(0.6, 1.0); if (random() < 0.4) fish.flare = 1; }
          brain.nextGlance = brain.faceUntil || now + rand(1.5, 3.5);
        }
        const lookYaw = Math.atan2(-look.z, look.x);
        const yaw = now < brain.faceUntil ? lookYaw : brain.side + clamp(wrapPi(lookYaw - brain.side), -CURIOUS_TURN, CURIOUS_TURN);
        const pitch = Math.asin(clamp(look.y, -1, 1));
        look.set(Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), -Math.cos(pitch) * Math.sin(yaw));
        const away = head.clone().sub(I); away.z -= 0.6; away.normalize();
        brain.station.copy(I).addScaledVector(away, now < brain.dartUntil ? DART_STANDOFF : brain.standoff);
        brain.station.clamp(bounds.min, bounds.max);
        const toStation = brain.station.clone().sub(fish.pos);
        const dist = toStation.length();
        const far = smooth01(0.5, 1.2, dist);   // small offsets are taken up by sculling, not by turning to swim
        dir.copy(toStation).normalize().multiplyScalar(far).addScaledVector(look, 1 - far).normalize();
        speed = far * Math.min(0.7, dist * 0.8);
        hold = brain.station;
        levelPitch = 0.85;
        turn = 0.9;
        break;
      }
      // Swim for the nearest pellet, slow so the mouth arrives on it, then lunge and snap.
      case 'feed': {
        if (brain.strikeAt && now >= brain.strikeAt + FEED.swallow) {
          if (food.has(brain.target)) { food.eat(brain.target); stats.eaten++; }
          brain.strikeAt = 0; brain.target = null; brain.handleUntil = now + rand(...FEED.handle);
        }
        if (!brain.strikeAt && !food.has(brain.target)) brain.target = null;
        if (!brain.target && now >= brain.handleUntil) brain.target = food.nearest(head, bounds.min.y - FEED.floor);
        const p = brain.target;
        if (!p) { hold = fish.pos.clone(); levelPitch = 0.85; break; }
        const P = new V3(p.x, p.y, p.z);
        const to = P.clone().sub(head);
        const dist = to.length();
        dir.copy(to).normalize();
        if (!brain.strikeAt && dist < FEED.reach && (F.dot(dir) > 0.3 || dist < FEED.reach * 0.4)) {
          brain.strikeAt = now; stats.strikes++;
          fish.vel.addScaledVector(dir, FEED.dart);
          snap(now);
        }
        speed = Math.min(brain.speed, dist * 0.9 + 0.06);
        // Close in, it sculls with its pectorals to put the mouth on the pellet, which is how a
        // betta takes food from right above it, steeper than it can swim.
        if (dist < 0.6) { hold = brain.station.copy(P).addScaledVector(F, -HEAD); holdGain = FEED.scull; }
        levelPitch = 1;
        turn = 1.1;
        break;
      }
    }

    // Steer off the walls while swimming. A hovering fish is held inside by station keeping instead,
    // so it can still look out through the glass.
    if (speed > 0) {
      const ahead = fish.pos.clone().addScaledVector(F, 0.8);
      const push = new V3();
      for (const ax of ['x', 'y', 'z']) {
        if (ahead[ax] > bounds.max[ax]) push[ax] -= (ahead[ax] - bounds.max[ax]);
        if (ahead[ax] < bounds.min[ax]) push[ax] += (bounds.min[ax] - ahead[ax]);
      }
      // food floats above the swimming space and may sink below it: let the fish follow it there
      if (brain.mode === 'surface' || brain.mode === 'feed') push.y = 0;
      dir.addScaledVector(push, 2.5).normalize();
    }
    return { dir, speed, hold, holdGain, levelPitch, turn };
  }

  function step(dt, cameraPosition) {
    time += dt;
    const now = time;
    food.step(dt);
    if (frozen) {
      fish.basis = basis(fish.yaw, fish.pitch, fish.roll);
      fish.tailPhase += TAU * fish.tailFreq * dt;
      flap.phase.value += TAU * 5.0 * dt;
      updateSkeleton(dt);
      updateUniforms(now, dt, cameraPosition);
      return;
    }
    const { dir, speed, hold, holdGain, levelPitch, turn } = think(now, dt);

    // Heading control: yaw about world up, limited pitch, bank into turns.
    const yawD = Math.atan2(-dir.z, dir.x);
    const horiz = Math.hypot(dir.x, dir.z);
    const pitchD = clamp(Math.atan2(dir.y, horiz) * levelPitch, -0.8, 0.8);
    let yawErr = wrapPi(yawD - fish.yaw);
    // A near-reversal goes the way round that passes through facing the viewer, not tail-on.
    // The way is chosen once, when the reversal starts: re-deciding every step deadlocks a
    // fish that faces the viewer with its goal straight behind it, where both ways tie.
    const toBack = wrapPi(Math.PI / 2 - fish.yaw);
    if (Math.abs(yawErr) > REVERSAL) {
      if (!fish.reversal) fish.reversal = Math.sign(toBack) === Math.sign(yawErr) && Math.abs(toBack) < Math.abs(yawErr) ? -Math.sign(yawErr) : Math.sign(yawErr);
      if (Math.sign(yawErr) !== fish.reversal) yawErr -= Math.sign(yawErr) * TAU;
    } else fish.reversal = 0;
    const yawRateD = clamp(yawErr * (speed > 0.05 ? 1.9 : 1.5), -turn, turn) * smooth01(0, 0.1, horiz);
    fish.yawRate = approach(fish.yawRate, yawRateD, 3.2, dt);
    fish.yaw = wrapPi(fish.yaw + fish.yawRate * dt);
    fish.pitchRate = approach(fish.pitchRate, clamp((pitchD - fish.pitch) * 1.6, -0.7, 0.7), 3.0, dt);
    fish.pitch += fish.pitchRate * dt;
    const fwd = fish.vel.dot(fish.basis.F);
    const rollD = clamp(-fish.yawRate * (0.15 + fwd * 0.6), -0.4, 0.4) + 0.05 * noise1(now * 0.4, 15) + 0.025 * noise1(now * 1.5, 16);
    fish.rollRate = approach(fish.rollRate, (rollD - fish.roll) * 2.5, 4, dt);
    fish.roll += fish.rollRate * dt;
    fish.basis = basis(fish.yaw, fish.pitch, fish.roll);
    const { F, U, S } = fish.basis;

    // Burst and glide: beat the tail until up to speed, then coast.
    const want = speed * smooth01(0.3, 0.85, F.dot(dir));
    if (!fish.beating && want > 0.05 && fwd < want * 0.7) fish.beating = true;
    if (fish.beating && (fwd > want * 1.08 || want <= 0.05)) fish.beating = false;
    if (fish.beating) fish.vel.addScaledVector(F, Math.max(want * 1.15 - fwd, 0) * 2.4 * dt);

    // Pectoral station keeping, and the slow drift a hovering fish never quite cancels.
    if (hold) {
      const err = hold.clone().sub(fish.pos);
      const len = err.length();
      if (len > 0.001) fish.vel.addScaledVector(err, Math.min(0.5, 0.25 / Math.max(len, 0.25)) * holdGain * dt * 0.8);
    }
    if (brain.mode === 'hover' && !fish.beating) fish.vel.multiplyScalar(Math.exp(-HOVER_BRAKE * dt));   // pectorals back water to stop
    fish.vel.x += 0.014 * noise1(now * 0.25, 17) * dt;
    fish.vel.y += 0.017 * noise1(now * 0.3, 18) * dt;
    fish.vel.z += 0.014 * noise1(now * 0.2, 19) * dt;

    // Water drag: strong sideways, weaker along the body so glides carry.
    const vf = fish.vel.dot(F);
    const vside = fish.vel.clone().addScaledVector(F, -vf);
    fish.vel.copy(F).multiplyScalar(vf * Math.exp(-dt * 0.8)).addScaledVector(vside, Math.exp(-dt * 3.0));
    fish.pos.addScaledVector(fish.vel, dt);
    fish.pos.clamp(new V3(bounds.min.x - 0.4, bounds.min.y - 0.3, bounds.min.z - 0.3), new V3(bounds.max.x + 0.4, bounds.max.y + 0.45, bounds.max.z + 0.3));

    // Tail beat and fins
    const moving = smooth01(0.05, 0.4, vf);
    fish.tailFreq = approach(fish.tailFreq, fish.beating ? 2.4 + 1.6 * want : 0.8, 3, dt);
    fish.tailAmp = approach(fish.tailAmp, fish.beating ? 0.55 + 0.55 * want : 0.10, fish.beating ? 5 : 1.5, dt);
    fish.tailPhase += TAU * fish.tailFreq * dt;
    fish.stream = approach(fish.stream, moving, 1.5, dt);
    fish.flare = approach(fish.flare, 0, 0.5, dt);
    // the pectorals beat unevenly, and harder while they correct a wobble in trim
    const trimming = clamp(Math.abs(fish.rollRate) * 5 + Math.abs(fish.pitchRate) * 3, 0, 1);
    flap.phase.value += TAU * (fish.beating ? 3.2 : 4.2 + 0.7 * noise1(now * 0.5, 20) + 1.0 * trimming) * dt;
    flap.amp.value = approach(flap.amp.value, fish.beating ? 0.45 : 0.9 + 0.35 * trimming, 3, dt);
    life.activity = approach(life.activity, Math.max(fish.beating ? 1 : 0.7 * moving, fish.flare), fish.beating ? 1.5 : 0.12, dt);

    // Fin lag in the fish frame. Fins are displaced against acceleration and against the sweep of the
    // rear body as it rotates (a left turn swings the tail right, so the fins trail left), and follow
    // that target through an underdamped spring so they stream behind, overshoot a little and settle.
    const acc = fish.vel.clone().sub(fish.prevVel).divideScalar(Math.max(dt, 1e-4));
    fish.prevVel.copy(fish.vel);
    const lagT = new V3(-acc.dot(F) * 0.25, -acc.dot(U) * 0.2 + fish.pitchRate * 0.12, -acc.dot(S) * 0.25 - fish.yawRate * 0.28);
    lagT.clampLength(0, LAG_MAX);
    fish.lagVel.addScaledVector(lagT.sub(fish.lag), LAG_W * LAG_W * dt).multiplyScalar(Math.exp(-2 * LAG_ZETA * LAG_W * dt));
    fish.lag.addScaledVector(fish.lagVel, dt);

    updateSkeleton(dt);
    updateUniforms(now, dt, cameraPosition);
  }

  function updateUniforms(now, dt, cameraPosition) {
    const { F, U, S } = fish.basis;
    uniforms.uTime.value = now;
    updateLife(now, dt);
    uniforms.uWave.value = (1 - 0.45 * fish.stream) * (1 + 0.2 * noise1(now * 0.2, 21));
    uniforms.uStream.value = fish.stream;
    // hovering, the median fins slowly open and close a little, unevenly
    const idle = 1 - fish.stream, tone = noise1(now * 0.2, 22);
    uniforms.uSpread.value = 1 + 0.10 * fish.flare - 0.05 * fish.stream + idle * 0.04 * tone;
    uniforms.uPleat.value = 1 - 0.6 * fish.flare + 0.3 * fish.stream + idle * (-0.2 * tone + 0.08 * noise1(now * 0.35, 23));
    uniforms.uLag.value.copy(fish.lag);
    const toCam = cameraPosition.clone().sub(fish.pos).normalize();
    uniforms.uOverlap.value = approach(uniforms.uOverlap.value, clamp(S.dot(toCam) * 5, -1, 1), 3, dt);

    // eyes follow what the fish is attending to, in quick jumps between short fixations
    const target = brain.mode === 'curious' ? pointer.interest
      : brain.mode === 'feed' && brain.target ? new V3(brain.target.x, brain.target.y, brain.target.z)
      : fish.pos.clone().addScaledVector(F, 2);
    const g = target.clone().sub(fish.pos).normalize();
    const attend = new V3(g.dot(F), g.dot(U), g.dot(S)).add(life.look);
    for (const side of [1, -1]) {
      const eye = life.eyes[side];
      if (now > eye.at) {   // a small solo movement of one eye
        eye.off.set(0, lifeRand(-0.12, 0.12), lifeRand(-0.15, 0.15));
        eye.at = now + lifeRand(0.8, 3.5);
      }
      const goal = attend.clone().add(eye.off);
      goal.y += 0.04 * noise1(now * 0.9, 30 + side);
      goal.z += 0.04 * noise1(now * 0.8, 32 + side);
      eye.g.lerp(goal, 1 - Math.exp(-28 * dt));   // a saccade completes in about 0.1 s
      gaze[side].value.copy(eye.g);
    }
  }

  function updateLife(now, dt) {
    // Breathing: buccal pumping, then the gill covers open, at 1-2 Hz and faster after activity.
    const rate = 1.1 + 1.0 * life.activity + 0.2 * noise1(now * 0.3, 24);
    life.breath += TAU * rate * dt;
    const depth = (0.7 + 0.25 * noise1(now * 0.4, 25)) * (1 + 0.5 * life.activity);
    const pump = (lag, k) => Math.pow(0.5 - 0.5 * Math.cos(life.breath - lag), k);
    uniforms.uBreath.value = depth * pump(0, 1.4);
    uniforms.uOper.value = depth * pump(1.3, 2.0);
    // the mouth parts a little on each breath, with now and then a gulp or a snap
    if (now > life.gulpAt) {
      life.gulpStart = now; life.gulpAmp = lifeRand(0.6, 1.0);
      life.gulpLen = lifeRand(0, 1) < 0.4 ? 0.18 : lifeRand(0.35, 0.6);
      life.gulpAt = now + lifeRand(5, 14);
    }
    const tg = (now - life.gulpStart) / life.gulpLen;
    const gulp = tg < 0 || tg > 1 ? 0 : life.gulpAmp * smooth01(0, 0.2, tg) * (1 - smooth01(0.45, 1, tg));
    uniforms.uMouth.value = Math.max(0.25 * depth * pump(-0.4, 2.0), gulp);
    // saccades of both eyes together
    if (now > life.saccadeAt) {
      life.look.set(0, lifeRand(-0.25, 0.2), lifeRand(-0.45, 0.45));
      life.saccadeAt = now + (lifeRand(0, 1) < 0.25 ? lifeRand(0.15, 0.35) : lifeRand(0.5, 2.2));
    }
    // fin tone: the sway runs at an uneven pace; the rim flutters harder after activity
    life.swayT += dt * (1 + 0.3 * noise1(now * 0.15, 26));
    uniforms.uSwayT.value = life.swayT;
    uniforms.uFlutter.value = (1 + 0.8 * life.activity) * (0.85 + 0.3 * noise1(now * 0.5, 27));
    // the lag travels out along each fin: sample its recent history at growing delays
    const hist = life.lagHist;
    hist.push({ t: now, v: fish.lag.clone() });
    while (hist.length > 2 && hist[1].t < now - LAG_DELAYS[3] - 0.05) hist.shift();
    LAG_DELAYS.forEach((d, k) => {
      let j = hist.length - 1;
      while (j > 0 && hist[j - 1].t >= now - d) j--;
      const a = hist[Math.max(j - 1, 0)], b = hist[j];
      const f = b.t > a.t ? clamp((now - d - a.t) / (b.t - a.t), 0, 1) : 1;
      uniforms.uLagW.value[k].lerpVectors(a.v, b.v, f);
    });
  }

  const localP = Array.from({ length: NJ }, () => new V3());
  function updateSkeleton(dt) {
    const { F, U, S } = fish.basis;
    const bendTarget = -fish.yawRate * 1.1;
    const pitchTarget = -fish.pitchRate * 0.6;
    const alpha = new Float32Array(NJ), beta = new Float32Array(NJ);
    const k = 5.2;
    for (let i = 0; i < NJ; i++) {
      const sd = i * JD;
      const tau = 0.05 + 0.4 * Math.pow(i / NJ, 1.5);
      const w = smooth01(0.12, 0.4, sd);
      fish.kTurn[i] = approach(fish.kTurn[i], bendTarget * w, 1 / tau, dt);
      fish.kPitch[i] = approach(fish.kPitch[i], pitchTarget * w, 1 / tau, dt);
    }
    const kappa = (i) => {
      const sd = i * JD;
      return fish.kTurn[i] + fish.tailAmp * smooth01(0.2, 1.05, sd) * Math.sin(fish.tailPhase - k * sd);
    };
    for (let i = IP + 1; i < NJ; i++) { alpha[i] = alpha[i - 1] + kappa(i) * JD; beta[i] = beta[i - 1] + fish.kPitch[i] * JD; }
    for (let i = IP - 1; i >= 0; i--) { alpha[i] = alpha[i + 1] - kappa(i) * JD; beta[i] = beta[i + 1] - fish.kPitch[i] * JD; }
    const tangent = (a, b) => new V3(Math.cos(a) * Math.cos(b), Math.sin(b), -Math.sin(a) * Math.cos(b));
    localP[IP].set(J0 - IP * JD, 0, 0);
    for (let i = IP + 1; i < NJ; i++) localP[i].copy(localP[i - 1]).addScaledVector(tangent((alpha[i] + alpha[i - 1]) / 2, (beta[i] + beta[i - 1]) / 2), -JD);
    for (let i = IP - 1; i >= 0; i--) localP[i].copy(localP[i + 1]).addScaledVector(tangent((alpha[i] + alpha[i + 1]) / 2, (beta[i] + beta[i + 1]) / 2), JD);

    const P = uniforms.uSP.value, T = uniforms.uST.value, Up = uniforms.uSU.value;
    const pivotX = J0 - IP * JD;
    for (let i = 0; i < NJ; i++) {
      const l = localP[i];
      P[i].copy(fish.pos).addScaledVector(F, l.x - pivotX).addScaledVector(U, l.y).addScaledVector(S, l.z);
    }
    for (let i = 0; i < NJ; i++) {
      const a = P[Math.max(i - 1, 0)], b = P[Math.min(i + 1, NJ - 1)];
      T[i].subVectors(a, b).normalize();
      Up[i].copy(U).addScaledVector(T[i], -U.dot(T[i])).normalize();
    }
  }

  // The water film sits just above the fish's swimming space, where it breaks the surface to gulp air.
  const surface = () => bounds.max.y + 0.12;

  return {
    uniforms, flap, gaze, bounds, fish, brain, food, stats,
    get time() { return time; },
    step,
    // The tank walls, from the home view (view.js homeBounds).
    setBounds(min, max) { bounds.min.copy(min); bounds.max.copy(max); },
    // The cursor on its sheet in the tank, or null when it leaves. `moved` is false when only
    // the camera moved, so a still cursor stops holding the fish's interest.
    point(world, moved = true) {
      if (!world) { pointer.inside = false; return; }
      pointer.world.copy(world).clamp(bounds.min, bounds.max);
      if (moved) pointer.lastMove = time;
      pointer.inside = true;
    },
    // Food lands on the film above x, z.
    feed(x, z, count) {
      food.drop(clamp(x, bounds.min.x, bounds.max.x), clamp(z, bounds.min.z * 0.6, bounds.max.z), surface(), count);
    },
    // Hold the fish in one pose, still breathing and finning, for stills (capture mode only).
    pose({ x = fish.pos.x, y = fish.pos.y, z = fish.pos.z, yaw = fish.yaw, pitch = 0, roll = 0 } = {}) {
      frozen = true;
      Object.assign(fish, { yaw, pitch, roll, yawRate: 0, pitchRate: 0, tailAmp: 0.1, tailFreq: 0.8 });
      fish.pos.set(x, y, z);
    },
    diagnostics() {
      const finite = [fish.pos.x, fish.pos.y, fish.pos.z, fish.yaw, fish.pitch, fish.roll, uniforms.uMouth.value].every(Number.isFinite)
        && uniforms.uSP.value.every((p) => Number.isFinite(p.x + p.y + p.z));
      return { time, mode: brain.mode, pellets: food.pellets.length, strikes: stats.strikes, eaten: stats.eaten, frozen, finite };
    },
  };
}
