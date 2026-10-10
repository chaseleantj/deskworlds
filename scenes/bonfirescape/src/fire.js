// The fire's state over time: how hard it burns, the air around it, and the sparks it throws.
// Everything here is plain arithmetic on a seeded generator, so a capture is repeatable.

export const FIXED_STEP = 1 / 120;
export const SPARKS = 3000;
export const SPARK_FLOATS = 12;      // [x, y, z, -], [previous x, y, z, -], [heat, size, phase, life]
export const FIRE = { base: [0, 0.33, 0], radius: 0.32 };
// The flames move at this fraction of their natural pace: slower reads as calmer.
export const FLICKER = 0.42;
// Fuel above 1 keeps the fire at full strength; it burns away at this many units a second,
// so a fire left alone holds for a while, then sinks to embers over a few minutes.
export const FUEL = { full: 1.4, burn: 1 / 200 };

const TAU = Math.PI * 2;

// Smooth pseudo-random signal in time, a sum of incommensurate sines.
function wobble(t, seed) {
  return (Math.sin(t * 1.31 + seed) * 0.5 + Math.sin(t * 2.71 + seed * 1.7) * 0.3 + Math.sin(t * 5.13 + seed * 2.3) * 0.2);
}

export function createFire({ random }) {
  const sparks = new Float32Array(SPARKS * SPARK_FLOATS);
  const velocity = new Float32Array(SPARKS * 3);
  const age = new Float32Array(SPARKS);
  const span = new Float32Array(SPARKS);
  const state = { time: 0, flare: 0, boost: 0, stoked: 0, fuel: FUEL.full, vigor: 1, glow: 1, step: FIXED_STEP, energy: 1, wind: [0, 0], gust: [0, 0], cursor: null, live: 0 };
  let emitDebt = 0;

  function spawn(i, burst, pop = null) {
    const o = i * SPARK_FLOATS;
    const a = random() * TAU, r = Math.sqrt(random()) * FIRE.radius * (burst ? 0.75 : 0.55);
    let x = FIRE.base[0] + Math.cos(a) * r, z = FIRE.base[2] + Math.sin(a) * r * 0.8;
    let y = FIRE.base[1] + 0.05 + random() * (burst ? 0.25 : 0.55);
    if (pop) { x = pop[0] + (random() - 0.5) * 0.03; y = pop[1] + (random() - 0.5) * 0.03; z = pop[2] + (random() - 0.5) * 0.03; }
    sparks[o] = sparks[o + 4] = x;
    sparks[o + 1] = sparks[o + 5] = y;
    sparks[o + 2] = sparks[o + 6] = z;
    const up = burst ? 1.8 + random() * 2.6 : 0.6 + random() * 1.6;
    const side = burst ? 1.1 : 0.45;
    velocity[i * 3] = (random() - 0.5) * side + Math.cos(a) * 0.25;
    velocity[i * 3 + 1] = up;
    velocity[i * 3 + 2] = (random() - 0.5) * side + Math.sin(a) * 0.2;
    // A pop throws its sparks out together in a spray.
    if (pop) { velocity[i * 3] = pop[3] + (random() - 0.5) * 0.9; velocity[i * 3 + 1] = pop[4] + (random() - 0.5) * 0.9; velocity[i * 3 + 2] = pop[5] + (random() - 0.5) * 0.9; }
    // Most sparks are tiny and short-lived; a few bigger embers float for a long time.
    // Sizes span a wide range: mostly specks, some grains, a few glowing flakes.
    const kind = random();
    const big = kind < 0.025;
    sparks[o + 8] = 1;                                              // heat, cools to 0
    sparks[o + 9] = big ? 0.0035 + random() * 0.003 : kind < 0.2 ? 0.0014 + random() * 0.0012 : 0.0003 + random() * 0.0009;
    sparks[o + 10] = random() * 1000;                               // phase for tumbling flicker
    span[i] = big ? 2.5 + random() * 3.5 : 0.4 + Math.pow(random(), 1.5) * 3.2;
    age[i] = 0;
  }

  // Air rising off the fire: a gentle curl that shears the sparks into wandering paths.
  function air(x, y, z, t, out) {
    const k = 2.3, s = t * 0.9;
    out[0] = Math.sin(y * k * 1.3 + s + z * 2.1) * 0.8 + Math.sin(y * 4.1 - s * 1.7 + x * 3.3) * 0.5 + Math.sin(y * 9.3 + s * 2.9 + z * 7.1) * 0.35;
    out[2] = Math.cos(y * k * 1.1 - s * 1.2 + x * 1.9) * 0.7 + Math.sin(y * 3.7 + s * 1.3 + z * 2.9) * 0.4 + Math.cos(y * 8.7 - s * 3.1 + x * 6.3) * 0.3;
    // Buoyancy is strongest in the plume above the fire and dies off to the side and with height.
    const plume = Math.exp(-((x * x + z * z) / 0.25)) * Math.exp(-Math.max(0, y - 0.4) * 0.45);
    out[1] = 1.8 * plume + 0.2;
  }

  const feed = amount => { state.fuel = Math.min(FUEL.full, state.fuel + Math.max(0, amount)); };
  const flow = [0, 0, 0];
  function step(dt) {
    state.time += dt;
    const t = state.time;
    state.step = dt;
    // A stir catches over a few frames, then the flare dies away slowly.
    const caught = state.stoked * Math.min(1, dt * 9);
    state.stoked -= caught;
    state.flare = Math.min(1, Math.max(0, state.flare + caught - dt * 0.55));
    // Stirring again and again has less and less effect: a fire only burns so hard.
    state.boost = 1 - Math.exp(-1.4 * state.flare);
    // A cursor near the fire pushes the air away from it. Otherwise the air is nearly still,
    // with only a faint drift that turns over minutes, so the sparks rise roughly straight up.
    const drift = state.cursor ? state.cursor : [wobble(t * 0.035, 4.1) * 0.06, wobble(t * 0.03, 9.3) * 0.03];
    state.wind[0] += (drift[0] - state.wind[0]) * Math.min(1, dt * 1.4);
    state.wind[1] += (drift[1] - state.wind[1]) * Math.min(1, dt * 1.4);
    state.gust[0] = state.wind[0] + wobble(t * 0.25, 2.2) * 0.025;
    state.gust[1] = state.wind[1] + wobble(t * 0.22, 7.7) * 0.015;
    // The fire burns down unless it is fed; the flames follow the fuel, quickly as it catches,
    // slowly as it dies.
    state.fuel = Math.max(0, state.fuel - dt * FUEL.burn);
    const target = Math.min(1, state.fuel);
    state.vigor += (target - state.vigor) * Math.min(1, dt * (target > state.vigor ? 0.9 : 0.25));
    const f = t * FLICKER;
    state.energy = (0.2 + 0.8 * state.vigor) * (1 + 0.08 * wobble(f * 1.9, 0.4) + 0.05 * wobble(f * 5.3, 3.1)) * (1 + 0.4 * state.boost);
    // Embers keep glowing long after the flames have sunk.
    state.glow = 0.8 + 0.2 * state.vigor + 0.25 * state.boost;

    // Now and then a pocket of sap bursts and throws a cluster of sparks at once.
    if (random() < dt * 0.42 * state.vigor) {
      const a = random() * TAU, r = random() * FIRE.radius * 0.6;
      const pop = [Math.cos(a) * r, FIRE.base[1] + 0.05 + random() * 0.3, Math.sin(a) * r * 0.8,
        (random() - 0.5) * 1.6, 2.5 + random() * 2.5, (random() - 0.5) * 1.2];
      for (let n = 10 + Math.floor(random() * 25), i = 0; n > 0 && i < SPARKS; i++) {
        if (sparks[i * SPARK_FLOATS + 8] <= 0) { spawn(i, false, pop); n--; }
      }
    }
    emitDebt += dt * (18 + 280 * state.vigor + 2400 * state.boost) * (0.75 + 0.5 * Math.max(0, wobble(t * 2.3, 5.5)));
    let live = 0;
    for (let i = 0; i < SPARKS; i++) {
      const o = i * SPARK_FLOATS;
      if (sparks[o + 8] <= 0) {
        if (emitDebt >= 1) { emitDebt--; spawn(i, state.flare > 0.25 && random() < state.flare); }
        else continue;
      }
      age[i] += dt;
      const big = sparks[o + 9] > 0.0034;
      sparks[o + 4] = sparks[o]; sparks[o + 5] = sparks[o + 1]; sparks[o + 6] = sparks[o + 2];
      air(sparks[o], sparks[o + 1], sparks[o + 2], t + sparks[o + 10], flow);
      const v = i * 3;
      // Small sparks follow the air closely; big embers are heavier and lag behind.
      const follow = big ? 1.6 : 3.2;
      velocity[v] += ((flow[0] + state.gust[0] * 1.6) - velocity[v]) * follow * dt;
      velocity[v + 1] += (flow[1] - velocity[v + 1]) * follow * 0.35 * dt - (big ? 0.15 : 0.05) * dt;
      velocity[v + 2] += ((flow[2] + state.gust[1] * 1.2) - velocity[v + 2]) * follow * dt;
      // A random walk on top of the flow, so the cloud spreads as it climbs.
      const kick = (big ? 1.2 : 2.6) * Math.sqrt(dt);
      velocity[v] += (random() - 0.5) * kick; velocity[v + 2] += (random() - 0.5) * kick; velocity[v + 1] += (random() - 0.5) * kick * 0.5;
      sparks[o] += velocity[v] * dt;
      sparks[o + 1] += velocity[v + 1] * dt;
      sparks[o + 2] += velocity[v + 2] * dt;
      const life = age[i] / span[i];
      sparks[o + 8] = life >= 1 ? 0 : Math.pow(1 - life, 0.8);
      sparks[o + 11] = life;
      if (sparks[o + 8] > 0) live++;
    }
    state.live = live;
    emitDebt = Math.min(emitDebt, 40);
  }

  return {
    sparks, state, step,
    // A click stirs the embers: the fire flares and throws a burst of sparks.
    stir(amount = 1) { state.stoked = Math.min(1, state.stoked + amount); feed(amount * 0.5); },
    // Air fanned across the fire feeds it: amount is in units of fuel.
    fan(amount) { feed(amount); },
    // Air movement from the cursor, as a horizontal push in world units; null lets it settle.
    setCursor(value) { state.cursor = value; },
  };
}
