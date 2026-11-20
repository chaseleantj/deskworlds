import { TREE, CAMERA, onRock } from './site.js';

// Everything that moves, with no drawing in it: the wind, and every loose petal, whether
// it is falling, drifting on the lake or lying on the rock.
export const FIXED_STEP = 1 / 60;
// The wind blows from behind the islet straight at the viewer, so what it carries off the
// tree it carries up to the eye.
export const WIND = Object.freeze({ x: 0.183, z: 0.983 });
// The evening has gusts of its own now and then. Each is a front that crosses the lake at
// `speed`, building as it arrives and dying away after; it starts `lead` metres upwind of the islet.
export const GUST = Object.freeze({ speed: 8, rise: 0.7, fall: 5.5, lead: 4 });
// Wind that is asked for is there at once, everywhere, with no front to wait for. While
// the cursor moves it blows, harder the faster the cursor goes: at full strength when the
// line of sight is turning `full` radians a second. It is up in about `rise` seconds and
// takes about `fall` to die when the cursor stops. The button's gust is the same wind, at
// full strength, left to die away over about `push` seconds.
export const STIR = Object.freeze({ full: 1.5, rise: 0.2, fall: 1.4, push: 3 });
const EYE = [CAMERA.x, CAMERA.height, CAMERA.z];
export const AIR = 900, AFLOAT = 2200, FALLEN = 3200;
export const AIR_FLOATS = 9; // position, tumble, size, seed, alpha, starlight / skylight
export const AFLOAT_FLOATS = 7; // x, z, turn, size, alpha, starlight / skylight
export const FALLEN_FLOATS = 9; // position, turn, size, tilt, starlight / skylight, alpha
export const MAX_RIPPLES = 96;
export const RIPPLE_FLOATS = 4; // x, z, radius, strength
// The last of the fallen petals are replaced as new ones land; the rest are the settled scatter.
const FRESH = 500;
const PETAL = 0.05;
// The lake has one slow current. It runs out from the islet under the long bough, then
// swings round towards the viewer, and the petals that fall on the water are drawn into
// it: a loose trail of them, bunched into rafts where the water slows and strung out where
// it quickens, leading from the foreground back to the tree.
const CURRENT = [[-0.6, 2.9], [2.2, 2.9], [4.7, 3.6], [6.5, 5.0], [7.0, 7.0], [6.5, 9.0], [5.8, 10.6], [5.4, 12.5], [5.8, 15.5], [5.6, 18.5], [5.4, 20.4], [5.4, 24]];
const PACE = 0.045; // metres a second along it

export const gustEnvelope = (since) => since < 0 ? 0 : since < GUST.rise ? (since / GUST.rise) ** 2 * (3 - 2 * since / GUST.rise) : Math.exp(-(since - GUST.rise) / GUST.fall);

// The current as closely spaced points: x, z, and the direction it runs there.
function traceCurrent() {
  const catmull = (a, b, c, d, t) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t), points = [];
  for (let s = 0; s < CURRENT.length - 1; s++) for (let k = 0; k < 12; k++) {
    const at = (axis) => catmull(CURRENT[Math.max(0, s - 1)][axis], CURRENT[s][axis], CURRENT[s + 1][axis], CURRENT[Math.min(CURRENT.length - 1, s + 2)][axis], k / 12);
    points.push([at(0), at(1)]);
  }
  return points.map(([x, z], i) => {
    const [ax, az] = points[Math.max(0, i - 1)], [bx, bz] = points[Math.min(points.length - 1, i + 1)], l = Math.hypot(bx - ax, bz - az);
    return [x, z, (bx - ax) / l, (bz - az) / l];
  });
}

export function createWorld({ random, sources, terrain, light }) {
  const air = new Float32Array(AIR * AIR_FLOATS), afloat = new Float32Array(AFLOAT * AFLOAT_FLOATS), fallen = new Float32Array(FALLEN * FALLEN_FLOATS);
  // What the drawing does not need: each falling petal's velocity, each drifting one's age and span.
  const drift = new Float32Array(AIR * 3), age = new Float32Array(AFLOAT), span = new Float32Array(AFLOAT);
  const ripples = new Float32Array(MAX_RIPPLES * RIPPLE_FLOATS), freeAfloat = [], current = traceCurrent();
  // Each gust: seconds since its front crossed the origin, and its strength.
  const gusts = new Float32Array(4);
  const state = { time: 0, calm: 0.16, stir: 0, rippleCount: 0, airborne: 0, drifting: 0, landed: 0, wetted: 0, meteor: { age: Infinity, from: [0, 0, 0], heading: [0, 0, 0] } };
  let owed = 0, travelled = 0, following = 0, pushed = 0, nextGust = 25 + random() * 50, nextFresh = FALLEN - FRESH, nextMeteor = 40 + random() * 120, aim = null, slice = 0;

  // How hard the wind is blowing at a point, 0 to about 1: the evening's own fronts, and the wind that has been asked for.
  const gustAt = (x, z) => { const lag = (x * WIND.x + z * WIND.z) / GUST.speed; return gusts[1] * gustEnvelope(gusts[0] - lag) + gusts[3] * gustEnvelope(gusts[2] - lag) + state.stir; };
  const shade = (buffer, o, x, y, z) => { buffer[o] = light.star(x, y, z); buffer[o + 1] = light.sky(x, y, z); };
  // Each petal keeps to its own lane in the current, some way to one side of its middle,
  // so the trail has width and never closes up into single file. The lanes spread as the
  // current runs on, and wander.
  const laneOf = (i, k) => ((i * 0.618034) % 1 + (i * 0.754878) % 1 - 1) * (0.45 + 1.5 * k / current.length) + 0.4 * Math.sin(k * 0.21 + i * 1.7);
  // The current is not even: it slows in places and quickens in others, and petals bunch where it slows.
  const paceAt = (k) => 0.6 + 0.8 * (0.5 + 0.5 * Math.sin(k * 0.17 + 0.8) * Math.sin(k * 0.05 + 2));
  // How the water carries petal `i` at (x, z), in metres a second: along the current, and gently across towards its lane.
  function carried(i, x, z) {
    let k = 0, distance = Infinity;
    for (let n = 0; n < current.length; n++) { const d = (current[n][0] - x) ** 2 + (current[n][1] - z) ** 2; if (d < distance) { distance = d; k = n; } }
    const [cx, cz, tx, tz] = current[k], near = Math.exp(-distance / 12), lane = laneOf(i, k), along = PACE * paceAt(k) * (0.25 + 0.75 * near);
    return [tx * along + (cx + tz * lane - x) * 0.02 * near, tz * along + (cz - tx * lane - z) * 0.02 * near];
  }

  function ripple(x, z, radius, strength) {
    if (state.rippleCount >= MAX_RIPPLES) return;
    ripples.set([x, z, radius, strength], state.rippleCount++ * RIPPLE_FLOATS);
  }

  // One of the evening's own gusts sets out across the lake.
  function front(strength) {
    // Take the place of whichever gust has more nearly blown itself out.
    const slot = gusts[1] * gustEnvelope(gusts[0]) <= gusts[3] * gustEnvelope(gusts[2]) ? 0 : 2;
    gusts[slot] = -GUST.lead / GUST.speed;
    gusts[slot + 1] = Math.min(1, Math.max(0, strength));
  }

  function settle(x, y, z, o) {
    fallen.set([x, y, z, random() * Math.PI * 2, PETAL * (0.75 + 0.5 * random()), random() * 0.9 - 0.45], o);
    shade(fallen, o + 6, x, y + 0.05, z);
    fallen[o + 8] = 1;
  }
  function launch(x, z, life, lived) {
    const i = freeAfloat.pop();
    if (i === undefined) return false;
    // It is there in full from the moment it touches down: nothing sinks and comes up again.
    afloat.set([x, z, random() * Math.PI * 2, PETAL * (0.75 + 0.5 * random()), Math.min(1, (life - lived) / 12)], i * AFLOAT_FLOATS);
    shade(afloat, i * AFLOAT_FLOATS + 5, x, 0.05, z);
    age[i] = lived; span[i] = life;
    return true;
  }
  // A petal comes away from the flower at `s` in sources, already moving as the air is.
  function release(s, vx, vz) {
    let i = 0;
    while (i < AIR && air[i * AIR_FLOATS + 6] > 0) i++;
    if (i === AIR) return;
    air.set([sources[s], sources[s + 1], sources[s + 2], random() * Math.PI * 2, PETAL * (0.75 + 0.5 * random()), random(), 1], i * AIR_FLOATS);
    drift.set([vx, -0.1, vz], i * 3);
  }
  const anyFlower = () => Math.floor(random() * sources.length / 3) * 3;

  // The lake as it is after a long quiet evening: the current already carrying its line of
  // petals, a scattering of others under the tree, and more lying on the rock.
  for (let i = AFLOAT - 1; i >= 0; i--) freeAfloat.push(i);
  for (let n = 0, tries = 0; n < 1700 && tries < 80000; tries++) {
    const life = 620 + random() * 300, lived = random() * life * 0.96;
    let x, z;
    if (n % 5) {
      // In the current: each in the lane it will keep to, and more of them where the water is slow.
      const k = Math.floor(random() ** 0.8 * (current.length - 1));
      if (random() * 1.4 > 1 / paceAt(k)) continue;
      const [cx, cz, tx, tz] = current[k], lane = laneOf(freeAfloat.at(-1), k), slack = (random() - 0.5) * 0.5;
      x = cx + tz * lane + tx * slack; z = cz - tx * lane + tz * slack;
    } else {
      const s = Math.floor(random() * sources.length / 3) * 3, gone = lived * 0.012;
      x = sources[s] + WIND.x * gone + (random() - 0.5) * 2; z = sources[s + 2] + WIND.z * gone + (random() - 0.5) * 2;
    }
    if (terrain.heightAt(x, z) > -0.03) continue;
    launch(x, z, life, lived);
    n++;
  }
  for (let n = 0, tries = 0; n < FALLEN && tries < FALLEN * 60; tries++) {
    const s = Math.floor(random() * sources.length / 3) * 3, x = sources[s] + (random() - 0.5) * 1.6 + WIND.x * 0.5, z = sources[s + 2] + (random() - 0.5) * 1.6 + WIND.z * 0.5;
    const ground = terrain.heightAt(x, z);
    if (ground < 0.02 || onRock(x, z) || Math.hypot(x - TREE.x, z - TREE.z) < 0.4) continue;
    settle(x, ground + 0.012 + random() * 0.03, z, n++ * FALLEN_FLOATS);
  }

  function step(dt) {
    state.time += dt;
    gusts[0] += dt; gusts[2] += dt;
    state.calm = 0.16 + 0.07 * Math.sin(state.time * 0.07) + 0.05 * Math.sin(state.time * 0.031 + 1.3);
    if (state.time > nextGust) { front(0.3 + 0.3 * random()); nextGust = state.time + 45 + random() * 80; }
    state.meteor.age += dt;
    if (state.time > nextMeteor) {
      // A shooting star, somewhere in the open sky to the right of the tree.
      const bearing = 0.05 + random() * 0.6, elevation = 0.14 + random() * 0.26, turn = random() < 0.5 ? -1 : 1;
      state.meteor = { age: 0, from: [Math.sin(bearing) * Math.cos(elevation), Math.sin(elevation), -Math.cos(bearing) * Math.cos(elevation)], heading: [turn * (0.5 + random() * 0.5), -0.25 - random() * 0.3, 0] };
      nextMeteor = state.time + 90 + random() * 240;
    }

    // Petals come away all the time, and many at once when a gust reaches the tree.
    const windy = gustAt(TREE.x, TREE.z);
    owed += dt * (2.6 + 16 * state.calm + 170 * windy * windy);
    for (; owed >= 1; owed--) release(anyFlower(), WIND.x * windy * 0.8, WIND.z * windy * 0.8);

    // The wind that has been asked for: it follows how fast the cursor is moving, quickly up
    // and more slowly down, and is never less than what is left of the button's gust.
    const wanted = Math.min(1, travelled / (dt || 1) / STIR.full);
    travelled = 0;
    following += (wanted - following) * Math.min(1, dt / (wanted > following ? STIR.rise : STIR.fall));
    pushed *= Math.exp(-dt / STIR.push);
    state.stir = Math.max(following, pushed);

    state.airborne = 0;
    for (let i = 0; i < AIR; i++) {
      const o = i * AIR_FLOATS;
      if (air[o + 6] <= 0) continue;
      state.airborne++;
      const seed = air[o + 5], x0 = air[o], z0 = air[o + 2], blow = state.calm + 4.4 * gustAt(x0, z0), flutter = air[o + 3] += dt * (2.2 + 1.8 * seed);
      // A petal is so light that the air carries it: it is soon moving as the wind is, and
      // falls through it at a steady slow rate, never faster. As it falls it slips from side
      // to side, sinking fastest at the middle of each slip. Moving air is never smooth, so
      // it is jostled about as well, a little up as often as a little down: wind can hold a
      // petal up for a moment but cannot lift it away.
      const slip = 0.22 + 0.2 * seed, rough = 0.1 + 0.16 * Math.min(blow, 2.5);
      const wantX = WIND.x * blow + slip * Math.cos(flutter) + rough * Math.sin(z0 * 0.9 + state.time * 0.7 + seed * 6);
      const wantZ = WIND.z * blow + slip * Math.sin(flutter * 0.7 + seed * 4) + rough * Math.cos(x0 * 0.8 - state.time * 0.6);
      const wantY = -(0.5 + 0.3 * seed) * (0.75 + 0.25 * Math.cos(2 * flutter)) + 0.7 * rough * Math.sin(x0 * 0.6 + z0 * 0.5 + state.time * 1.1 + seed * 9);
      drift[i * 3] += (wantX - drift[i * 3]) * dt * 3; drift[i * 3 + 1] += (wantY - drift[i * 3 + 1]) * dt * 3; drift[i * 3 + 2] += (wantZ - drift[i * 3 + 2]) * dt * 3;
      const x = air[o] += drift[i * 3] * dt, y = air[o + 1] += drift[i * 3 + 1] * dt, z = air[o + 2] += drift[i * 3 + 2] * dt;
      shade(air, o + 7, x, y, z);
      const ground = terrain.heightAt(x, z);
      if (ground > 0 ? y > ground + 0.02 : y > 0.004) continue;
      air[o + 6] = 0;
      if (ground > 0) {
        if (!onRock(x, z)) { settle(x, ground + 0.02, z, nextFresh * FALLEN_FLOATS); nextFresh = nextFresh + 1 < FALLEN ? nextFresh + 1 : FALLEN - FRESH; }
        state.landed++;
      } else {
        // On the water it makes a ring, and stays to drift.
        // A petal weighs almost nothing: the ring it makes is a hand's breadth across and soon gone.
        ripple(x, z, 0.09, 0.12);
        launch(x, z, 620 + random() * 300, 0);
        state.wetted++;
      }
    }

    // The petals on the water move slowly, so only an eighth of them are moved each step.
    slice = (slice + 1) % 8;
    state.drifting = AFLOAT - freeAfloat.length;
    for (let i = slice; i < AFLOAT; i += 8) {
      if (span[i] <= 0) continue;
      const o = i * AFLOAT_FLOATS, elapsed = dt * 8, x = afloat[o], z = afloat[o + 1];
      age[i] += elapsed;
      if (age[i] >= span[i] || Math.hypot(x, z) > 60) { span[i] = 0; afloat[o + 4] = 0; freeAfloat.push(i); continue; }
      afloat[o + 4] = Math.min(1, (span[i] - age[i]) / 12);
      const [fx, fz] = carried(i, x, z), hurry = 0.8 + 0.4 * (i % 7) / 7 + 2.2 * gustAt(x, z);
      const nx = x + (fx * hurry + WIND.x * 0.004 * state.calm) * elapsed, nz = z + (fz * hurry + WIND.z * 0.004 * state.calm) * elapsed;
      // A petal that reaches the shore stays against it.
      if (terrain.heightAt(nx, nz) > -0.025) continue;
      afloat[o] = nx; afloat[o + 1] = nz;
      afloat[o + 2] += 0.02 * elapsed * Math.sin(i);
      shade(afloat, o + 5, nx, 0.05, nz);
    }
  }

  return {
    step, air, afloat, fallen, ripples, gusts, state,
    // The button's gust: wind at this strength at once, dying away after.
    gust(strength = 1) { pushed = Math.max(pushed, Math.min(1, Math.max(0, strength))); },
    clearRipples() { state.rippleCount = 0; },
    // Where the cursor points, as a direction from the eye, or null when it has left the frame.
    point(direction) {
      // Arriving is not movement: only travel across the frame counts.
      if (direction && aim) travelled += Math.hypot(direction[0] - aim[0], direction[1] - aim[1], direction[2] - aim[2]);
      aim = direction;
    },
    // A click where the line of sight meets open water drops a pebble in; anywhere else it is a gust of wind.
    tap(direction) {
      const reach = direction && direction[1] < 0 ? -EYE[1] / direction[1] : -1, x = EYE[0] + direction?.[0] * reach, z = EYE[2] + direction?.[2] * reach;
      if (reach > 0 && terrain.heightAt(x, z) < -0.01) ripple(x, z, 0.5, 2.2); else pushed = 1;
    },
    gustAt,
  };
}
