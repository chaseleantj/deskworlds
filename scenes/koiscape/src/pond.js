// The pond: koi, floating pellets, lily pads and the ripples they make. Pure state and rules
// with no rendering, so the behaviour can be tested in node. render.js draws what is here.
//
// World units are metres. The water surface is the plane y = 0; x runs to the right of the
// frame and z toward its bottom edge. A fish's position is its centre of mass, about a third
// of the way back from the nose, and `depth` is how far below the surface that point sits.

export const FIXED_STEP = 1 / 60;
export const SPINE_JOINTS = 25;                 // nose to the tip of the tail fin
export const SPINE_SPAN = 1.3;                  // in body lengths; the body itself is 0..1
export const COM = 0.36;                        // where along the body the position is measured
export const POND_DEPTH = 1.25;
// A koi swims like a carp: the head barely moves, and one wave a little longer than the body
// runs back down it, growing as it goes, so only the rear half visibly bends.
export const WAVE = (2 * Math.PI) / 1.05;       // swimming wave number, per body length
export const STROKE = 0.075;                    // tail amplitude of an easy cruising stroke, in body lengths
export const SPLASH_LIFE = 3;                   // s a burst of bubbles lasts after a gulp
export const RIPPLE_SPEED = 0.18;               // m/s a ring spreads across the water
const RING_LIFE = 4;                            // s a ring still has the strength to push a pad
// Koi are slow to take an interest: a fingertip has to rest a while before one drifts over, and
// its attention trails behind where the fingertip has gone rather than snapping after it.
const CURIOUS = {
  wait: 1.6,                // s the cursor must rest first
  follow: 0.6,              // 1/s: how quickly a fish's attention catches up with the cursor
  turn: 0.22,               // rad/s at most a curious fish turns, on top of what its speed allows
};

export const PELLET = {
  radius: [0.0045, 0.006],
  life: 38,                 // s from landing to gone
  fade: 6,                  // s of that over which it soaks and breaks up
  stagger: 0.5,             // s over which a pinch lands
  spread: 0.2,              // radius of a pinch on the water
  drift: 0.008,             // m/s wander across the film
  pinch: 10,
  click: [2, 4],
  capacity: 48,
};

// One entry per fish in the pond, in the order they are added. Sizes are body lengths in metres.
// `deep` is how far below its usual cruising depth a fish keeps: most stay up where they glow,
// a couple hang back in the murk. `girth` is how stout it is: old females are broad.
const CAST = [
  { variety: 'kohaku', size: 0.68, deep: 0.03, girth: 1.08 },
  { variety: 'utsuri', size: 0.6, deep: 0.22, girth: 0.96 },
  { variety: 'ogon', size: 0.56, deep: 0.06, girth: 1.0 },
  { variety: 'sanke', size: 0.64, deep: 0.2, girth: 1.04 },
  { variety: 'chagoi', size: 0.74, deep: 0.32, girth: 1.12 },
  { variety: 'tancho', size: 0.5, deep: 0.17, girth: 0.94 },
  { variety: 'showa', size: 0.58, deep: 0.01, girth: 1.0 },
  { variety: 'kohaku', size: 0.44, deep: 0.42, girth: 0.92 },
  { variety: 'sanke', size: 0.4, deep: 0.05, girth: 0.9 },
  { variety: 'ogon', size: 0.36, deep: 0.34, girth: 0.9 },
];

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrap = (a) => { a = (a + Math.PI) % TAU; return (a < 0 ? a + TAU : a) - Math.PI; };
// Moves `value` toward `target` with a time constant, independent of the step length.
const approach = (value, target, tau, dt) => target + (value - target) * Math.exp(-dt / tau);

// The body down the spine, one entry per joint. `swing` is how far the swimming wave moves each
// point relative to the root of the tail: least just behind the head, and past the root the soft
// fin lags and swings only a little further. `bend` is how much of a turn has built up by there:
// the skull is rigid and the bend lives in the body behind it. `mass` is where the weight is,
// for the recoil of the head and body against each stroke of the tail.
const BODY = Array.from({ length: SPINE_JOINTS }, (_, i) => {
  const s = (i / (SPINE_JOINTS - 1)) * SPINE_SPAN, t = s - 1;
  return {
    s,
    swing: s <= 1 ? 0.1 - 0.6 * s + 1.5 * s * s : 1 + 2.4 * t - 3.5 * t * t,
    slope: s <= 1 ? -0.6 + 3 * s : 2.4 - 7 * t,
    bend: smooth(0.12, 1.15, s),
    mass: s <= 1 ? Math.exp(-(((s - 0.36) / 0.3) ** 2)) : 0.02,
  };
});
const MASS = BODY.reduce((sum, j) => sum + j.mass, 0);
const MASS_AT = BODY.reduce((sum, j) => sum + j.mass * j.s, 0) / MASS;

export function fishCount(aspect) {
  return clamp(Math.round(3.2 + aspect * 2.4), 5, CAST.length);
}

// Lily pads sit in clusters toward the corners and edges, clear of the middle of the frame and
// of the right-hand band where desktop icons live. Coordinates are fractions of the half extents.
const CLUSTERS = [
  { x: -0.82, z: 0.62, spread: [0.4, 0.42], count: 13, flower: true },
  { x: -1.0, z: -0.22, spread: [0.1, 0.22], count: 4, flower: false },
  { x: 0.08, z: 1.04, spread: [0.14, 0.08], count: 3, flower: false },
  { x: 0.56, z: 0.86, spread: [0.12, 0.12], count: 3, flower: false, scale: 0.65 },
];

export function createPads(random, halfW, halfH) {
  const pads = [], flowers = [];
  for (const cluster of CLUSTERS) {
    const cx = cluster.x * halfW, cz = cluster.z * halfH;
    const own = [];
    for (let i = 0, tries = 0; i < cluster.count && tries < 400; tries++) {
      // The first pads of a cluster are the big old ones; later ones fill in smaller.
      const radius = mix(0.2, 0.04, Math.pow(i / cluster.count, 0.6)) * (0.8 + random() * 0.4) * (cluster.scale || 1);
      const angle = random() * TAU, reach = Math.sqrt(random());
      const x = cx + Math.cos(angle) * reach * cluster.spread[0] * halfH * 1.6;
      const z = cz + Math.sin(angle) * reach * cluster.spread[1] * halfH * 1.6;
      // Pads crowd and overlap a little at the rims but never stack.
      if (pads.some((p) => Math.hypot(p.x - x, p.z - z) < Math.max(p.radius, radius) * 0.95 + Math.min(p.radius, radius) * 0.2)) continue;
      const pad = {
        x, z, radius, homeX: x, homeZ: z,
        // Pushed about by rings and passing fish, and pulled back by the stem.
        driftX: 0, driftZ: 0, vx: 0, vz: 0, spin: 0, spinRate: 0,
        turn: random() * TAU, seed: random(),
        // Young pads are small and bronze; a few old ones have yellowed.
        age: radius < 0.06 ? random() * 0.25 : 0.3 + random() * 0.7,
        swayPhase: random() * TAU, swayRate: 0.12 + random() * 0.12,
        lift: 0,
      };
      pads.push(pad); own.push(pad); i++;
    }
    if (cluster.flower && own.length > 2) {
      // A flower stands in a gap beside the largest pads of its cluster.
      for (let tries = 0; tries < 200; tries++) {
        const host = own[Math.floor(random() * Math.min(3, own.length))];
        const angle = random() * TAU;
        const x = host.x + Math.cos(angle) * (host.radius + 0.075), z = host.z + Math.sin(angle) * (host.radius + 0.075);
        if (Math.abs(x) > halfW - 0.12 || Math.abs(z) > halfH - 0.12) continue;
        if (pads.some((p) => Math.hypot(p.x - x, p.z - z) < p.radius + 0.045)) continue;
        const flower = { x, z, radius: 0.075 + random() * 0.015, turn: random() * TAU, seed: random(), pink: flowers.length % 2 === 1, bud: null };
        // A closed bud on its own stalk nearby, in open water.
        for (let b = 0; b < 40 && !flower.bud; b++) {
          const ba = random() * TAU, bx = x + Math.cos(ba) * flower.radius * 2, bz = z + Math.sin(ba) * flower.radius * 2;
          if (!pads.some((p) => Math.hypot(p.x - bx, p.z - bz) < p.radius + 0.03)) flower.bud = { x: bx, z: bz, turn: ba };
        }
        flowers.push(flower);
        break;
      }
    }
  }
  return { pads, flowers };
}

function createFish(index, random) {
  const cast = CAST[index % CAST.length];
  const len = cast.size * (0.94 + random() * 0.12);
  return {
    id: index, variety: cast.variety, seed: random() * 1000, len, girth: cast.girth * (0.97 + random() * 0.06),
    x: 0, z: 0, heading: random() * TAU, speed: 0.08, yawRate: 0,
    depth: 0.2, depthHome: 0.07 + len * 0.08 + cast.deep + random() * 0.08, pitch: 0, roll: 0,
    cruise: (0.1 + random() * 0.07) * (0.7 + len * 0.6),
    boldness: 0.35 + random() * 0.65,
    wander: [random() * TAU, random() * TAU, 0.07 + random() * 0.06, 0.03 + random() * 0.03],
    // The tail: phase of the stroke, its amplitude in body lengths, and whether it is beating or
    // the fish is gliding. `curl` is how far the body is bent into a turn, nose to tail, in radians.
    phase: random() * TAU, amp: 0, beating: false, curl: 0,
    pectoral: 0.5, pectoralPhase: random() * TAU, mouth: 0, gill: random() * TAU,
    mode: 'cruise', modeTime: 0, target: null,
    // While cruising a koi drifts between moods: gliding about, hanging still, trailing another
    // fish, nosing about the bottom, or coming up to sip at the surface.
    mood: 'glide', moodTime: 0, moodFor: 4 + random() * 8, leader: null,
    interest: 0, interestFor: 0, bored: random() * 6, nerves: 0, notice: 0, gulp: 0,
    wake: random(), churn: random(), spine: new Float32Array(SPINE_JOINTS * 4),
  };
}

export function createPond({ random, count = 8, halfW = 2.6, halfH = 1.1 } = {}) {
  const fish = Array.from({ length: count }, (_, i) => createFish(i, random));
  const pellets = [];
  const impulses = [];                    // ripples made this step; the renderer drains them
  const rings = [];                       // the rings still spreading, for what floats on them
  const splashes = [];                    // where mouths broke the surface lately
  const bounds = { halfW, halfH };
  const cursor = { x: 0, z: 0, vx: 0, vz: 0, speed: 0, still: 0, active: false, fresh: false, lastX: 0, lastZ: 0, trail: 0, interestX: 0, interestZ: 0 };
  const stats = { eaten: 0, startles: 0, gulps: 0 };
  let { pads, flowers } = createPads(random, halfW, halfH);
  let time = 0, nextPellet = 1;

  // Start spread across the pond, facing along it, at their own depths.
  fish.forEach((f, i) => {
    const u = (i + 0.5) / fish.length;
    f.x = mix(-halfW * 0.8, halfW * 0.8, (u * 0.618 * 5 + random() * 0.15) % 1);
    f.z = mix(-halfH * 0.6, halfH * 0.6, random());
    f.heading = (random() < 0.5 ? 0 : Math.PI) + (random() - 0.5) * 1.2;
    f.depth = f.depthHome;
  });

  const ripple = (x, z, radius, strength) => {
    if (impulses.length < 48) impulses.push(x, z, radius, strength);
    if (strength > 0.1) { if (rings.length >= 64) rings.shift(); rings.push({ x, z, age: 0, strength }); }
  };

  function setBounds(nextW, nextH) {
    if (Math.abs(nextW - bounds.halfW) < 1e-6 && Math.abs(nextH - bounds.halfH) < 1e-6) return false;
    // Pads keep their place relative to the frame, so a cluster stays in its corner.
    for (const p of pads) {
      p.homeX *= nextW / bounds.halfW; p.homeZ *= nextH / bounds.halfH;
      p.x = p.homeX; p.z = p.homeZ;
    }
    for (const f of flowers) {
      f.x *= nextW / bounds.halfW; f.z *= nextH / bounds.halfH;
      if (f.bud) { f.bud.x *= nextW / bounds.halfW; f.bud.z *= nextH / bounds.halfH; }
    }
    bounds.halfW = nextW; bounds.halfH = nextH;
    return true;
  }

  // The cursor is something at the surface: a fingertip trailing in the water.
  function point(x, z) {
    if (x === null || x === undefined) { cursor.active = false; cursor.fresh = false; return; }
    if (!cursor.active) { cursor.lastX = cursor.interestX = x; cursor.lastZ = cursor.interestZ = z; cursor.vx = cursor.vz = 0; cursor.still = 0; }
    cursor.x = x; cursor.z = z; cursor.active = true; cursor.fresh = true;
  }

  function feed(x, z, count) {
    x = clamp(x, -bounds.halfW * 0.92, bounds.halfW * 0.92);
    z = clamp(z, -bounds.halfH * 0.88, bounds.halfH * 0.88);
    for (let i = 0; i < count && pellets.length < PELLET.capacity; i++) {
      const angle = random() * TAU, reach = PELLET.spread * Math.sqrt(random()) * (count > 4 ? 1 : 0.35);
      pellets.push({
        id: nextPellet++,
        x: x + Math.cos(angle) * reach, z: z + Math.sin(angle) * reach,
        radius: mix(PELLET.radius[0], PELLET.radius[1], random()), seed: random(),
        age: -random() * PELLET.stagger * (count > 1 ? 1 : 0),
        driftX: (random() - 0.5) * 2 * PELLET.drift, driftZ: (random() - 0.5) * 2 * PELLET.drift,
        claims: 0, landed: false,
      });
    }
  }
  // A handful scattered where the fish are not all crowded, the way a keeper would throw it.
  function pinch() {
    const x = Math.sin(time * 0.37 + 1.3) * bounds.halfW * 0.55, z = Math.sin(time * 0.23 + 0.4) * bounds.halfH * 0.4;
    feed(x, z, PELLET.pinch);
  }
  const whole = (p) => p.age < 0 ? 0 : Math.min(1, (PELLET.life - p.age) / PELLET.fade);

  function stepCursor(dt) {
    if (!cursor.active) { cursor.speed = approach(cursor.speed, 0, 0.2, dt); return; }
    const dx = cursor.x - cursor.lastX, dz = cursor.z - cursor.lastZ;
    const moved = Math.hypot(dx, dz);
    cursor.vx = approach(cursor.vx, dx / dt, 0.08, dt);
    cursor.vz = approach(cursor.vz, dz / dt, 0.08, dt);
    cursor.speed = Math.hypot(cursor.vx, cursor.vz);
    cursor.still = cursor.speed < 0.18 ? cursor.still + dt : 0;
    const follow = 1 - Math.exp(-CURIOUS.follow * dt);
    cursor.interestX += (cursor.x - cursor.interestX) * follow; cursor.interestZ += (cursor.z - cursor.interestZ) * follow;
    // A moving fingertip draws a line of small rings; a resting one leaves the water alone.
    cursor.trail += moved;
    if (cursor.trail > 0.05 && cursor.speed > 0.04) {
      ripple(cursor.x, cursor.z, 0.011, clamp(cursor.speed * 0.16, 0.08, 0.38));
      cursor.trail = 0;
    }
    cursor.lastX = cursor.x; cursor.lastZ = cursor.z;
    cursor.fresh = false;
  }

  function stepPellets(dt) {
    for (let i = pellets.length - 1; i >= 0; i--) {
      const p = pellets[i];
      p.age += dt;
      if (p.age < 0) continue;
      if (!p.landed) { p.landed = true; ripple(p.x, p.z, 0.012, 0.22); }
      if (p.age >= PELLET.life) { pellets.splice(i, 1); continue; }
      p.x += p.driftX * dt; p.z += p.driftZ * dt;
    }
  }

  // Pads float free on their stems. A ring running into one shoves it away from where the ring
  // started and turns it a little, a fish passing just under it heaves it aside, and the stem
  // draws it back to where it was. (How each pad rides up and over the rings is the renderer's:
  // it reads the ripple field itself.)
  function stepPads(dt) {
    for (let i = rings.length - 1; i >= 0; i--) if ((rings[i].age += dt) > RING_LIFE) rings.splice(i, 1);
    for (const p of pads) {
      let ax = 0, az = 0, torque = 0;
      for (const r of rings) {
        const dx = p.x - r.x, dz = p.z - r.z, d = Math.hypot(dx, dz) || 1e-4;
        const front = Math.abs(d - RIPPLE_SPEED * r.age);
        if (front > p.radius + 0.04) continue;
        // Spreading rings weaken with distance; a small pad is pushed further than a big one.
        const push = r.strength * smooth(p.radius + 0.04, 0, front) * Math.exp(-r.age * 0.9) / (1 + d * 6) / (0.3 + p.radius * 7);
        ax += dx / d * push * 0.16; az += dz / d * push * 0.16;
        torque += push * (p.seed - 0.5) * 2.4;
      }
      for (const f of fish) {
        if (f.depth > 0.14 + f.len * 0.1) continue;
        const d = Math.hypot(p.x - f.x, p.z - f.z), reach = p.radius + f.len * 0.25;
        if (d > reach) continue;
        const shove = smooth(reach, reach * 0.4, d) * clamp(f.speed * 3, 0.15, 1) * smooth(0.14 + f.len * 0.1, 0.04, f.depth);
        ax += Math.cos(f.heading) * shove * 0.12; az += Math.sin(f.heading) * shove * 0.12;
        torque += f.yawRate * shove * 0.3;
        p.lift = Math.min(1, p.lift + dt * 2.5 * shove);
      }
      // The stem: a soft spring back to home, and water drag on the leaf.
      ax -= p.driftX * 0.9; az -= p.driftZ * 0.9;
      p.vx = approach(p.vx + ax * dt, 0, 1.4, dt); p.vz = approach(p.vz + az * dt, 0, 1.4, dt);
      p.driftX += p.vx * dt; p.driftZ += p.vz * dt;
      p.spinRate = approach(p.spinRate + (torque - p.spin * 0.6) * dt, 0, 1.2, dt);
      p.spin += p.spinRate * dt;
      // Tethered by their stems, pads also wander a few centimetres of their own accord.
      const a = p.swayPhase + time * p.swayRate;
      p.x = p.homeX + p.driftX + Math.sin(a) * 0.012 + Math.sin(a * 0.37 + 2) * 0.008;
      p.z = p.homeZ + p.driftZ + Math.cos(a * 0.81) * 0.012 + Math.sin(a * 0.29 + 1) * 0.008;
      p.lift = approach(p.lift, 0, 0.6, dt);
    }
  }

  // Which pellet a hungry fish goes for: the nearest that not too many others are already after.
  function choosePellet(f) {
    let best = null, bestScore = Infinity;
    for (const p of pellets) {
      if (p.age < 0 || whole(p) < 0.3) continue;
      const score = Math.hypot(p.x - f.x, p.z - f.z) + p.claims * 0.3;
      if (score < bestScore) { bestScore = score; best = p; }
    }
    return best;
  }
  function release(f) { if (f.target) { f.target.claims = Math.max(0, f.target.claims - 1); f.target = null; } }
  function setMode(f, mode) { if (f.mode === mode) return; f.mode = mode; f.modeTime = 0; }

  const mouthPoint = (f) => ({ x: f.x + Math.cos(f.heading) * f.len * COM, z: f.z + Math.sin(f.heading) * f.len * COM });

  // A new mood for a cruising fish. Hanging still and sipping suit fish near the top; bigger,
  // deeper fish go down to nose about the bottom; and a fish will now and then fall in behind
  // another, the way koi trail round a pond in a loose line.
  function chooseMood(f) {
    f.moodTime = 0; f.leader = null;
    const roll = random(), shallow = f.depthHome < 0.25;
    const trailing = fish.filter((o) => o.mood === 'follow').length;
    let mood = 'glide';
    if (roll < 0.16) mood = 'hover';
    else if (roll < 0.34 && trailing < 2) {
      let best = null, bestD = 1.6;
      for (const o of fish) {
        if (o === f || o.mood === 'follow' || o.mode !== 'cruise') continue;
        const d = Math.hypot(o.x - f.x, o.z - f.z);
        if (d < bestD) { bestD = d; best = o; }
      }
      if (best) { mood = 'follow'; f.leader = best; }
    } else if (roll < 0.44 && !shallow) mood = 'forage';
    else if (roll < 0.5 && shallow) mood = 'sip';
    f.mood = mood;
    f.moodFor = { glide: 6 + random() * 10, hover: 3 + random() * 6, follow: 8 + random() * 12, forage: 6 + random() * 8, sip: 3.5 }[mood];
  }

  function stepFish(f, dt) {
    f.modeTime += dt;
    f.nerves = approach(f.nerves, 0, 45, dt);
    f.bored = Math.max(0, f.bored - dt);
    const mouth = mouthPoint(f);

    // --- What does it want to do?
    const hungry = pellets.some((p) => p.age >= 0 && whole(p) >= 0.3);
    if (f.mode !== 'startle') {
      if (hungry) {
        // Food is noticed after a moment, sooner by a fish that is close to it.
        if (f.mode !== 'feed') {
          const near = choosePellet(f);
          const d = near ? Math.hypot(near.x - f.x, near.z - f.z) : 9;
          f.notice += dt * (0.35 + 1.6 / (0.4 + d)) * (0.6 + f.boldness * 0.6);
          if (f.notice > 1) { setMode(f, 'feed'); f.notice = 0; }
        }
      } else {
        f.notice = 0;
        if (f.mode === 'feed') { release(f); setMode(f, 'cruise'); f.bored = 3 + random() * 4; }
      }
    }
    if (f.mode === 'cruise' && cursor.active && f.bored <= 0 && cursor.still > CURIOUS.wait) {
      const d = Math.hypot(cursor.x - f.x, cursor.z - f.z);
      const watching = fish.reduce((n, o) => n + (o.mode === 'curious' ? 1 : 0), 0);
      if (d < 0.55 + f.boldness * 1.1 && watching < 3) {
        setMode(f, 'curious');
        f.interestFor = 5 + random() * 9 * f.boldness;
      }
    }
    if (f.mode === 'curious' && (!cursor.active || f.modeTime > f.interestFor)) {
      setMode(f, 'cruise'); f.bored = 8 + random() * 14;
    }
    // A fast pass close by is a threat. Each fright leaves a fish harder to frighten for a while.
    // Pond koi are used to shadows overhead: only a quick swipe right over one sets it off.
    if (f.mode !== 'startle' && cursor.active && cursor.speed > 1.8 + f.nerves * 1.6) {
      const d = Math.hypot(cursor.x - mouth.x, cursor.z - mouth.z);
      if (d < 0.22 + f.len * 0.12 - f.nerves * 0.12) startle(f, cursor.x, cursor.z, 1);
    }

    // --- Steering: a wanted heading, speed and depth for the mode it is in.
    let wantHeading = f.heading, wantSpeed = f.cruise, wantDepth = f.depthHome, wantPitch = 0;
    let yawLimit = 0.12 + 1.3 * f.speed / f.len, quickness = 0.6;
    const w = f.wander;
    w[0] += w[2] * dt; w[1] += w[3] * dt;

    if (f.mode === 'cruise') {
      f.moodTime += dt;
      if (f.moodTime > f.moodFor || (f.mood === 'follow' && (!f.leader || f.leader.mode !== 'cruise'))) chooseMood(f);
      // Long, lazy arcs: the wanted heading wanders slowly either side of the way it is going.
      wantHeading = f.heading + (Math.sin(w[0]) * 0.45 + Math.sin(w[1] * 2.3 + 1) * 0.22);
      wantSpeed = f.cruise * (0.85 + 0.25 * Math.sin(w[1] * 1.7 + f.seed));
      wantDepth = f.depthHome + Math.sin(w[0] * 0.6 + f.seed) * 0.08;
      if (f.mood === 'hover') {
        // Hangs in the water, sculling with the pectorals, drifting round a little.
        wantSpeed = 0.012;
        wantHeading = f.heading + Math.sin(w[0] * 3.0) * 0.25;
        yawLimit = 0.25;
      } else if (f.mood === 'follow' && f.leader) {
        // A body length behind the leader and a little to one side, on the path it swam.
        const o = f.leader, back = o.len * 0.9 + f.len * 0.5, side = (f.seed % 2 < 1 ? 1 : -1) * o.len * 0.18;
        const tx = o.x - Math.cos(o.heading) * back - Math.sin(o.heading) * side, tz = o.z - Math.sin(o.heading) * back + Math.cos(o.heading) * side;
        const d = Math.hypot(tx - f.x, tz - f.z);
        wantHeading = Math.atan2(tz - f.z, tx - f.x);
        wantSpeed = clamp(o.speed + (d - 0.05) * 0.5, 0.02, f.cruise * 1.5);
        wantDepth = mix(f.depthHome, o.depth + 0.06, 0.6);
      } else if (f.mood === 'forage') {
        // Down to the bottom, nose first, to work slowly along it.
        wantDepth = POND_DEPTH - 0.3;
        wantSpeed = f.cruise * 0.55;
        wantPitch = f.depth < POND_DEPTH - 0.4 ? -0.18 : -0.08;
      } else if (f.mood === 'sip') {
        // Up under the film, slowing, to mouth at the surface once or twice.
        wantDepth = 0.035 + f.len * 0.085;
        wantSpeed = f.cruise * 0.4;
        wantPitch = 0.22;
        if (f.depth < 0.06 + f.len * 0.1 && f.gulp <= 0 && f.moodTime > 1.2) {
          f.gulp = 1;
          ripple(mouth.x, mouth.z, 0.014 + f.len * 0.01, 0.35);
          f.moodFor = Math.min(f.moodFor, f.moodTime + 1.4);
        }
      }
    } else if (f.mode === 'curious') {
      const dx = cursor.interestX - mouth.x, dz = cursor.interestZ - mouth.z, d = Math.hypot(dx, dz);
      // Drifts up under the fingertip, slows, and holds off a little short of it. Close in, small
      // shifts are left alone: the fish hangs there and only turns once the fingertip is well off
      // to one side.
      const hold = 0.1 + (1 - f.boldness) * 0.14;
      const far = smooth(hold, hold + 0.35, d);
      wantHeading = f.heading + wrap(Math.atan2(dz, dx) - f.heading) * mix(0.25, 1, far);
      wantSpeed = clamp((d - hold) * 0.35, 0, f.cruise * 1.1);
      if (d < hold) wantSpeed = 0;
      wantDepth = mix(f.depthHome, 0.07 + f.len * 0.13, smooth(1.2, 0.3, d));
      wantPitch = smooth(0.5, 0.12, d) * 0.16;
      yawLimit = CURIOUS.turn + 1.3 * f.speed / f.len; quickness = 1.2;
    } else if (f.mode === 'feed') {
      if (!f.target || !pellets.includes(f.target) || whole(f.target) < 0.3) {
        release(f);
        f.target = choosePellet(f);
        if (f.target) f.target.claims++;
      }
      if (f.target) {
        const dx = f.target.x - mouth.x, dz = f.target.z - mouth.z, d = Math.hypot(dx, dz);
        // Aimed from the body, not the mouth: a fish pivots about its middle, so a pellet close
        // beside the head would otherwise stay just out of reach however it turned.
        const cx = f.target.x - f.x, cz = f.target.z - f.z, reach = f.len * COM;
        wantHeading = Math.atan2(cz, cx);
        wantSpeed = clamp(0.08 + d * 0.75, 0.08, 0.5 + f.boldness * 0.2) * (0.75 + f.len * 0.5);
        // Food off to one side is not circled: the fish checks, nearly stops, and pivots onto it.
        const off = Math.abs(wrap(wantHeading - f.heading));
        wantSpeed *= mix(1, 0.12, smooth(0.35, 1.4, off) * smooth(0.7, 0.1, d));
        // Too close to bring the mouth round onto it: back off a little with the pectorals.
        if (Math.hypot(cx, cz) < reach * 0.85) wantSpeed = -0.05;
        // Rises as it closes, so the mouth meets the pellet at the surface.
        const rise = smooth(0.9, 0.15, d);
        wantDepth = mix(f.depthHome, 0.035 + f.len * 0.085, rise);
        wantPitch = rise * 0.24 + smooth(0.12, 0.03, d) * 0.3;
        yawLimit = 1.5 + f.speed * 3 + smooth(0.4, 0.05, d) * 1.5; quickness = 0.22;
        if (d < 0.03 + f.len * 0.025 && f.depth < 0.07 + f.len * 0.1) {
          const i = pellets.indexOf(f.target);
          if (i >= 0) pellets.splice(i, 1);
          f.target = null; f.gulp = 1; stats.eaten++; stats.gulps++;
          // The lips break the film: a spray of bubbles and a wet shine where the head came up.
          if (splashes.length >= 8) splashes.shift();
          splashes.push({ x: mouth.x, z: mouth.z, age: 0, size: 0.04 + f.len * 0.06, seed: random() });
          ripple(mouth.x, mouth.z, 0.022 + f.len * 0.012, 0.75);
        }
      }
    } else if (f.mode === 'startle') {
      wantHeading = f.flee;
      // A couple of firm strokes and a heavy glide: a big koi moves off rather than darting.
      wantSpeed = f.modeTime < 0.4 ? (0.35 + f.boldness * 0.15) * f.fright : f.cruise * 1.15;
      wantDepth = f.depthHome + 0.09 * f.fright;
      yawLimit = f.modeTime < 0.4 ? 1.75 * f.fright : 0.6; quickness = 0.2;
      if (f.modeTime > 1.1 + f.fright * 0.9) { setMode(f, 'cruise'); f.bored = 6 + random() * 10; }
    }

    // --- The pond's edge, and each other. These bend the wanted heading in every mode but flight.
    if (f.mode !== 'startle' || f.modeTime > 0.4) {
      // The right-hand band, where the desktop icons sit, is kept mostly clear.
      const left = bounds.halfW + 0.12, right = bounds.halfW * 0.9, mz = bounds.halfH + 0.05, soft = 0.7;
      const ahead = 0.35 + f.speed * 1.5;
      const px = f.x + Math.cos(f.heading) * ahead, pz = f.z + Math.sin(f.heading) * ahead;
      const ox = px > right - soft ? (px - (right - soft)) / soft : px < -left + soft ? (px + left - soft) / soft : 0;
      const oz = pz > mz - soft ? (pz - (mz - soft)) / soft : pz < -mz + soft ? (pz + mz - soft) / soft : 0;
      const out = Math.min(1.4, Math.hypot(ox, oz));
      if (out > 0 && f.mode !== 'feed') {
        // Turn along the bank toward the open water rather than bouncing straight back.
        const home = Math.atan2(-f.z * 0.6 - oz, -f.x * 0.25 - ox * 1.5);
        wantHeading = f.heading + wrap(home - f.heading) * Math.min(1, out * 1.2) + wrap(wantHeading - f.heading) * Math.max(0, 1 - out * 1.2);
        yawLimit += out * 0.6;
        if (f.mood === 'hover') wantSpeed = Math.max(wantSpeed, f.cruise * 0.6 * out);
      }
      for (const o of fish) {
        if (o === f) continue;
        const dx = f.x - o.x, dz = f.z - o.z, d = Math.hypot(dx, dz), room = (f.len + o.len) * 0.5;
        if (d > room * 1.5 || d < 1e-4) continue;
        const press = 1 - d / (room * 1.5);
        // Cruising koi keep a little room between them, giving way sideways; two at the same
        // depth also part vertically, one slipping under the other. A follower keeps its line.
        const give = f.mood === 'follow' && o === f.leader ? 0.3 : 1;
        if (f.mode !== 'feed') wantHeading += wrap(Math.atan2(dz, dx) - f.heading) * press * (Math.abs(f.depth - o.depth) < 0.1 ? 0.7 : 0.35) * give;
        if (Math.abs(f.depth - o.depth) < 0.1 && f.mode !== 'feed') wantDepth += (f.depthHome >= o.depthHome ? 0.14 : -0.06) * press;
      }
      // Loose company: a fish far from all the others drifts back toward them.
      if (f.mode === 'cruise') {
        let cx = 0, cz = 0;
        for (const o of fish) { cx += o.x; cz += o.z; }
        cx /= fish.length; cz /= fish.length;
        const d = Math.hypot(cx - f.x, cz - f.z);
        if (d > 2.2) wantHeading += wrap(Math.atan2(cz - f.z, cx - f.x) - f.heading) * smooth(2.2, 3.6, d) * 0.4;
      }
    }

    // --- Motion. Heading and depth ease toward what is wanted.
    let turn = wrap(wantHeading - f.heading);
    // Wanting to go straight back the way it came, a fish commits to turning one way instead of
    // dithering between left and right.
    if (Math.abs(turn) > 2.6) turn = (Math.sign(f.yawRate) || 1) * Math.abs(turn);
    const wantYaw = clamp(turn * (f.mode === 'startle' ? 2.5 : 0.8), -yawLimit, yawLimit);
    f.yawRate = approach(f.yawRate, wantYaw, quickness, dt);
    f.heading = wrap(f.heading + f.yawRate * dt);

    // Speed comes in bursts and glides: a few strokes of the tail to get going a little faster than
    // wanted, then a long coast with the body straight until it has slowed to a little under. A
    // dart or a hard turn keeps the tail going; backing off and hovering is all pectorals.
    const startled = f.mode === 'startle' && f.modeTime < 0.6;
    if (wantSpeed <= 0.02) f.beating = false;
    else if (f.speed < wantSpeed * 0.78 || startled) f.beating = true;
    else if (f.speed > wantSpeed * 1.2) f.beating = false;
    const braking = wantSpeed < f.speed * 0.5 && f.speed > 0.06;
    if (wantSpeed < 0) f.speed = approach(f.speed, wantSpeed, 0.8, dt);
    else if (f.beating) f.speed = approach(f.speed, wantSpeed * 1.3, startled ? 0.12 : 0.9, dt);
    else f.speed = approach(f.speed, braking ? wantSpeed : 0, braking ? 0.7 : 3.4, dt);
    f.x += Math.cos(f.heading) * f.speed * dt;
    f.z += Math.sin(f.heading) * f.speed * dt;
    const floor = POND_DEPTH - 0.25, ceiling = 0.03 + f.len * 0.08;
    f.depth = approach(f.depth, clamp(wantDepth, ceiling, floor), f.mode === 'feed' ? 0.7 : 1.6, dt);
    f.pitch = approach(f.pitch, wantPitch, 0.5, dt);
    f.roll = approach(f.roll, clamp(-f.yawRate * (0.1 + f.speed * 0.4), -0.35, 0.35), 0.3, dt);

    // --- The body. While the tail beats, the stroke is as big as the speed it is after needs; a
    // gliding fish lets it die away, so the body straightens and the fish slides on.
    const sweeping = Math.abs(f.yawRate) > 0.45 && f.speed < 0.1 ? 0.035 : 0;
    const want = f.beating ? clamp(0.045 + 0.1 * Math.max(0, wantSpeed) / f.len, 0.05, startled ? 0.13 : 0.1) : Math.max(sweeping, 0.004);
    f.amp = approach(f.amp, want, f.beating ? (startled ? 0.05 : 0.35) : 0.7, dt);
    // A fish's tail beats about as fast as keeps the wake it sheds efficient (a Strouhal number
    // near 0.3), but never slower than a lazy beat a second.
    const tip = 2 * f.amp * 1.4 * f.len;
    const beat = clamp(0.3 * Math.max(Math.abs(f.speed), wantSpeed, 0.05) / Math.max(tip, 0.02), 0.85, 4);
    f.phase = (f.phase + TAU * beat * dt) % TAU;
    // Turning bends the body into a curve, nose to tail, as tight as the path it is swimming.
    const path = f.yawRate * f.len / Math.max(Math.abs(f.speed), 0.07);
    const most = f.mode === 'startle' ? 1.5 : 1.0;
    f.curl = approach(f.curl, clamp(path * 0.45, -most, most), f.mode === 'startle' ? 0.06 : 0.35, dt);
    // Pectoral fins: spread wide to hover and to brake, held back along the body at speed.
    const hovering = f.speed < 0.05;
    const spread = braking ? 1 : hovering ? 0.85 : mix(0.6, 0.12, smooth(0.04, 0.35, f.speed));
    f.pectoral = approach(f.pectoral, spread + Math.abs(f.yawRate) * 0.1, 0.35, dt);
    f.pectoralPhase = (f.pectoralPhase + TAU * (0.35 + (1 - smooth(0.02, 0.2, f.speed)) * 0.55) * dt) % TAU;
    f.gill = (f.gill + TAU * (0.9 + f.speed * 1.5) * dt) % TAU;
    // The mouth opens for a gulp and works idly as it breathes.
    f.gulp = Math.max(0, f.gulp - dt / 0.42);
    const reaching = f.mode === 'feed' && f.target ? smooth(0.14, 0.03, Math.hypot(f.target.x - mouth.x, f.target.z - mouth.z)) : 0;
    f.mouth = approach(f.mouth, Math.max(reaching, Math.sin(f.gulp * Math.PI) * (f.gulp > 0 ? 1 : 0)), 0.06, dt);

    // --- Its mark on the surface: a fish close under the film drags a wake behind its back.
    // Feeding at the surface churns it: lips, gill covers and pectorals all break the film.
    if (f.mode === 'feed' && f.depth < 0.15) {
      f.churn += dt * (5 + random() * 4);
      if (f.churn > 1) {
        f.churn = 0;
        const along = (random() - 0.2) * f.len * 0.5;
        ripple(mouth.x - Math.cos(f.heading) * along + (random() - 0.5) * 0.04, mouth.z - Math.sin(f.heading) * along + (random() - 0.5) * 0.04, 0.01 + random() * 0.008, 0.12 + random() * 0.2);
      }
    }
    const cover = f.depth - f.len * 0.15;
    if (cover < 0.05 && f.speed > 0.05) {
      f.wake += dt * (2 + f.speed * 14);
      if (f.wake > 1) {
        f.wake = 0;
        const s = 0.55 * f.len, along = f.heading - f.curl * 0.5;
        ripple(f.x - Math.cos(along) * s, f.z - Math.sin(along) * s, 0.02 + f.len * 0.02, clamp(f.speed * 0.8, 0.05, 0.6) * smooth(0.05, -0.02, cover));
      }
    }
  }

  function startle(f, fromX, fromZ, fright) {
    if (f.mode === 'startle') return;
    release(f);
    setMode(f, 'startle');
    f.fright = fright * (1 - f.nerves * 0.5);
    const away = Math.atan2(f.z - fromZ, f.x - fromX);
    // Bolts away, but not into the bank.
    const inward = Math.atan2(-f.z, -f.x);
    f.flee = away + wrap(inward - away) * 0.3 + (random() - 0.5) * 0.9;
    f.nerves = Math.min(1, f.nerves + 0.4);
    stats.startles++;
    if (f.depth < 0.25) ripple(f.x - Math.cos(f.heading) * f.len * 0.4, f.z - Math.sin(f.heading) * f.len * 0.4, 0.018 + f.len * 0.012, 0.2 * f.fright * smooth(0.25, 0.05, f.depth));
    // Fright spreads to fish close by, weaker each time.
    if (fright > 0.6) for (const o of fish) {
      if (o !== f && Math.hypot(o.x - f.x, o.z - f.z) < 0.7 && random() < 0.7) startle(o, fromX, fromZ, fright * 0.6);
    }
  }

  // The backbone as the renderer draws it: for each joint, world position and heading. The turn
  // bends the body into a curve; the swimming wave rides on it, and the whole body recoils against
  // each stroke, the head yawing a little the other way, so the centre of mass runs true.
  function pose(f) {
    const seg = (SPINE_SPAN / (SPINE_JOINTS - 1)) * f.len, out = f.spine;
    const angles = out;                                   // headings first, positions after
    let recoil = 0;
    for (let i = 0; i < SPINE_JOINTS; i++) {
      const j = BODY[i], wave = f.phase - j.s * WAVE;
      // The slope of the travelling wave y = amp * swing(s) * sin(phase - k s).
      const swing = clamp(f.amp * (j.slope * Math.sin(wave) - j.swing * WAVE * Math.cos(wave)), -0.75, 0.75);
      angles[i * 4 + 3] = swing;
      recoil += swing * j.mass;
    }
    recoil /= MASS;
    let x = 0, z = 0, cx = 0, cz = 0;
    for (let i = 0; i < SPINE_JOINTS; i++) {
      const j = BODY[i];
      const angle = f.heading - f.curl * j.bend + angles[i * 4 + 3] - recoil;
      out[i * 4] = x; out[i * 4 + 2] = z; out[i * 4 + 3] = angle;
      out[i * 4 + 1] = -f.depth + Math.sin(f.pitch) * (COM - j.s) * f.len;
      cx += x * j.mass; cz += z * j.mass;
      x -= Math.cos(angle) * seg; z -= Math.sin(angle) * seg;
    }
    // Place the body so its centre of mass sits where a straight fish's would.
    const back = (MASS_AT - COM) * f.len;
    const ox = f.x - Math.cos(f.heading) * back - cx / MASS, oz = f.z - Math.sin(f.heading) * back - cz / MASS;
    for (let i = 0; i < SPINE_JOINTS; i++) { out[i * 4] += ox; out[i * 4 + 2] += oz; }
    return out;
  }

  // Now and then something touches the still water: an insect, a drip from the leaves overhead.
  let nextTouch = 1 + random() * 3;
  function stepTouches(dt) {
    nextTouch -= dt;
    if (nextTouch > 0) return;
    nextTouch = 2.5 + random() * 6;
    const x = (random() * 2 - 1) * bounds.halfW * 0.95, z = (random() * 2 - 1) * bounds.halfH * 0.95;
    if (pads.some((p) => Math.hypot(p.x - x, p.z - z) < p.radius)) return;
    ripple(x, z, 0.01 + random() * 0.008, 0.15 + random() * 0.3);
  }

  // Bodies are solid. Each is three discs down its length; where two fish at about the same
  // depth touch, they are eased apart sideways and the one that belongs deeper slips under.
  const DISCS = [[0.12, 0.105], [0.38, 0.12], [0.66, 0.085]];
  function stepContacts(dt) {
    for (let a = 0; a < fish.length; a++) for (let b = a + 1; b < fish.length; b++) {
      const f = fish[a], g = fish[b];
      const reach = (f.len + g.len) * 0.75;
      if (Math.abs(f.x - g.x) > reach || Math.abs(f.z - g.z) > reach) continue;
      const thick = (f.len + g.len) * 0.16;
      const gap = Math.abs(f.depth - g.depth);
      if (gap > thick) continue;
      let px = 0, pz = 0, worst = 0;
      for (const [sf, rf] of DISCS) for (const [sg, rg] of DISCS) {
        const fx = f.x + Math.cos(f.heading) * (COM - sf) * f.len, fz = f.z + Math.sin(f.heading) * (COM - sf) * f.len;
        const gx = g.x + Math.cos(g.heading) * (COM - sg) * g.len, gz = g.z + Math.sin(g.heading) * (COM - sg) * g.len;
        const dx = fx - gx, dz = fz - gz, d = Math.hypot(dx, dz) || 1e-4, overlap = rf * f.len * f.girth + rg * g.len * g.girth - d;
        if (overlap > 0) { px += dx / d * overlap; pz += dz / d * overlap; worst = Math.max(worst, overlap); }
      }
      if (worst <= 0) continue;
      const push = 1 - 0.5 * gap / thick;
      const share = g.len / (f.len + g.len);
      f.x += px * push * share * 0.5; f.z += pz * push * share * 0.5;
      g.x -= px * push * (1 - share) * 0.5; g.z -= pz * push * (1 - share) * 0.5;
      // Shouldering through a crowd is slow going.
      f.speed *= 1 - Math.min(1, dt * 1.2); g.speed *= 1 - Math.min(1, dt * 1.2);
      // The one with the deeper habit, or the smaller in a feeding crowd, ducks under.
      // Fish crowding the same food jostle sideways: nobody gives up the surface.
      if (f.mode === 'feed' && g.mode === 'feed') continue;
      const under = f.depthHome > g.depthHome ? f : g;
      under.depth = Math.min(POND_DEPTH - 0.25, under.depth + dt * 0.1 * (1 - gap / thick));
    }
  }

  function step(dt) {
    time += dt;
    stepTouches(dt);
    stepCursor(dt);
    stepPellets(dt);
    for (let i = splashes.length - 1; i >= 0; i--) if ((splashes[i].age += dt) > SPLASH_LIFE) splashes.splice(i, 1);
    for (const f of fish) stepFish(f, dt);
    stepContacts(dt);
    stepContacts(dt);
    stepPads(dt);
  }

  function diagnostics() {
    return {
      time, fish: fish.length, pellets: pellets.length, pads: pads.length, ...stats,
      modes: fish.map((f) => f.mode), moods: fish.map((f) => f.mood),
      finite: fish.every((f) => [f.x, f.z, f.heading, f.speed, f.depth, f.phase, f.yawRate, f.curl, f.amp].every(Number.isFinite)),
    };
  }

  return {
    fish, pellets, impulses, splashes, bounds, cursor, stats,
    get pads() { return pads; }, get flowers() { return flowers; }, get time() { return time; },
    step, pose, setBounds, point, feed, pinch, whole, startle, diagnostics,
    relayout(seedRandom) { ({ pads, flowers } = createPads(seedRandom, bounds.halfW, bounds.halfH)); },
  };
}
