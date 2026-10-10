// The discharge inside a plasma globe, as a small electrostatic model.
//
// A high-voltage electrode sits at the centre of a glass shell filled with a low-pressure noble
// gas mix. Near the electrode the field is strongest, the gas breaks down and ionised streamers
// leave it. A streamer is a thin conducting channel that grows along the local electric field,
// stiffly, with a random kink now and then, and is lifted a little by the hot gas around it. It
// ends on the inside of the glass, where it spreads into a brush of short surface discharges.
//
//  - Field: the electrode is a point charge Q. A finger touching or near the glass is a grounded
//    conductor, which pulls field lines toward itself like a negative charge; its strength grows
//    with proximity. Channels are traced along the summed field, so those near the finger lean in
//    and converge on it.
//  - Spacing: streamers carry the same charge, so their roots on the electrode repel and glide
//    apart until the pattern is nearly even. Each lives a few seconds, fades, and strikes again
//    at the emptiest spot.
//  - Current: a grounded finger offers a low-impedance path, so one channel takes most of the
//    current and grows thick and white, and the electrode potential drops, dimming the rest.
//
// Lengths are in globe radii: the outer glass has radius 1. The renderer reads `segments`
// (glowing line pieces), `feet` (glass brushes) and `roots` (electrode attachments).
import { randomGenerator } from '../../shared/random.js';

export const GLOBE = { outer: 1, inner: 0.955 };
export const ELECTRODE = { radius: 0.19 };
export const FINGER = { radius: 0.16, reach: 0.55 };   // fingertip radius, and the gap over which it is felt
export const STREAMERS = 40;
export const SEGMENT_FLOATS = 12;
export const MAX_SEGMENTS = 9000;
export const MAX_FEET = 640;
export const FIXED_STEP = 1 / 60;

const TAU = Math.PI * 2;
const STEP = 0.033;             // arc length per traced point
const MAX_POINTS = 44;
const STIFFNESS = 0.74;         // how much of the previous heading a channel keeps
const KINK = 1.05;              // sideways kink strength against the field direction
const RISE = 0.22;              // buoyancy of the hot channel
const REPEL = 0.2;              // root repulsion
const CORE = 0.0072;            // channel radius (gaussian sigma) near the electrode
const WAVE = 1.5;               // spatial frequency of the kinks, per globe radius
const SOFTEN = 0.12;            // softening length of the finger's field
const SINK = 2.4;               // finger charge at contact, relative to the electrode
const BRANCH_MAX = 4;
const TENDRILS = 3;
const TENDRIL_POINTS = 6;

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Smooth value noise in [-1, 1].
function hash(x, y, z) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 2147483648 - 1;
}
function noise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10), w = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hash(ix, iy, iz), hash(ix + 1, iy, iz), u), l(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), u), v),
    l(l(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), u), l(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), u), v), w);
}

// Where a fingertip is when the cursor points along a ray from the camera. The finger moves in the
// plane through the globe centre facing the camera; over the disc of the globe it rests on the
// glass in front, beside it the tip hovers in that plane.
export function fingerTip(origin, direction) {
  const distance = Math.hypot(origin.x, origin.y, origin.z);
  const nx = origin.x / distance, ny = origin.y / distance, nz = origin.z / distance;
  const along = direction.x * nx + direction.y * ny + direction.z * nz;
  if (along >= -1e-4) return null;
  const t = distance / -along;
  const px = origin.x + direction.x * t, py = origin.y + direction.y * t, pz = origin.z + direction.z * t;
  const reach = GLOBE.outer + FINGER.radius, r2 = px * px + py * py + pz * pz;
  const lift = r2 < reach * reach ? Math.sqrt(reach * reach - r2) : 0;
  return { x: px + nx * lift, y: py + ny * lift, z: pz + nz * lift };
}

export function createPlasma({ random = randomGenerator(1) } = {}) {
  const N = STREAMERS;
  const root = new Float32Array(N * 3);          // unit direction of each root on the electrode
  const rootVel = new Float32Array(N * 3);
  const age = new Float32Array(N), span = new Float32Array(N), rank = new Float32Array(N), offset = new Float32Array(N);
  const level = new Float32Array(N);             // current brightness, 0..1
  const power = new Float32Array(N), reach = new Float32Array(N);   // how strong a channel is, and how much of it survives to the glass
  const main = new Float32Array(N);              // share of the finger current, eased
  const branchAt = new Float32Array(N * BRANCH_MAX), branchAngle = new Float32Array(N * BRANCH_MAX);
  const branchTwist = new Float32Array(N * BRANCH_MAX), branchLen = new Float32Array(N * BRANCH_MAX);
  const branchCount = new Uint8Array(N);
  const tendrilAngle = new Float32Array(N * TENDRILS), tendrilLen = new Float32Array(N * TENDRILS), tendrilPower = new Float32Array(N * TENDRILS);

  const segments = new Float32Array(MAX_SEGMENTS * SEGMENT_FLOATS);
  const feet = new Float32Array(MAX_FEET * 8);
  const roots = new Float32Array(N * 4);         // xyz on the electrode, brightness
  const state = {
    time: 0, segmentCount: 0, footCount: 0, energy: 0,
    finger: { x: 0, y: 0, z: 0, near: 0, present: false },
    contact: { x: 0, y: 0, z: 1 },               // unit direction of the fingertip, seen from the centre
    mainIndex: -1, discharge: 0,
  };
  const goal = { x: 0, y: 0, z: 3, near: 0, present: false };


  function angularGap(x, y, z, skip) {
    let best = 4;
    for (let j = 0; j < N; j++) {
      if (j === skip || level[j] < 0.05) continue;
      const d = 1 - (x * root[j * 3] + y * root[j * 3 + 1] + z * root[j * 3 + 2]);
      if (d < best) best = d;
    }
    return best;
  }

  // A fresh streamer strikes at the emptiest of a handful of candidate spots; a finger nearby
  // biases the choice toward its side, where the field is strongest.
  function strike(i) {
    let bx = 0, by = 1, bz = 0, bestScore = -1;
    const f = state.finger, fl = Math.hypot(f.x, f.y, f.z) || 1;
    for (let k = 0; k < 9; k++) {
      const z = random() * 2 - 1, a = random() * TAU, r = Math.sqrt(1 - z * z);
      const x = r * Math.cos(a), y = r * Math.sin(a);
      const score = angularGap(x, y, z, i) + 1.4 * f.near * (x * f.x + y * f.y + z * f.z) / fl + random() * 0.05;
      if (score > bestScore) { bestScore = score; bx = x; by = y; bz = z; }
    }
    root.set([bx, by, bz], i * 3);
    rootVel.fill(0, i * 3, i * 3 + 3);
    age[i] = 0; span[i] = 1.4 + random() * 3.6; rank[i] = random(); offset[i] = random() * 100;
    power[i] = 0.3 + 1.1 * Math.pow(random(), 1.8); reach[i] = 0.3 + 0.7 * random();
    const n = 2 + Math.floor(random() * 3);
    branchCount[i] = n;
    for (let b = 0; b < BRANCH_MAX; b++) {
      const at = i * BRANCH_MAX + b;
      branchAt[at] = 0.22 + random() * 0.55; branchAngle[at] = 0.4 + random() * 0.85;
      branchTwist[at] = random() * TAU; branchLen[at] = 0.3 + random() * 0.5;
    }
    for (let t = 0; t < TENDRILS; t++) {
      const at = i * TENDRILS + t;
      tendrilAngle[at] = (t + random() * 0.7) * TAU / TENDRILS; tendrilLen[at] = 0.04 + random() * 0.14; tendrilPower[at] = random() < 0.3 ? 0.15 : 0.4 + random() * 0.8;
    }
  }
  // Start from an even spread (a Fibonacci lattice, randomly turned) so the pattern is settled at once.
  const turn = random() * TAU;
  for (let i = 0; i < N; i++) {
    strike(i);
    const z = 1 - (2 * i + 1) / N, r = Math.sqrt(1 - z * z), a = i * 2.399963 + turn;
    root.set([r * Math.cos(a), z, r * Math.sin(a)], i * 3);
    age[i] = random() * span[i] * 0.9; level[i] = 1;
  }

  // The fingertip as the renderer sees it: position in the globe frame and how near it is.
  // `near` runs from 0 (far) to 1 (touching the glass).
  function setFinger(tip) {
    if (!tip) { goal.present = false; goal.near = 0; return; }
    const clearance = Math.hypot(tip.x, tip.y, tip.z) - GLOBE.outer - FINGER.radius;
    goal.x = tip.x; goal.y = tip.y; goal.z = tip.z; goal.present = true;
    goal.near = clearance <= 0 ? 1 : Math.exp(-clearance / FINGER.reach);
  }

  function step(dt) {
    state.time += dt;
    const f = state.finger, ease = 1 - Math.exp(-dt / 0.07);
    if (goal.present) {
      if (!f.present) { f.x = goal.x; f.y = goal.y; f.z = goal.z; }
      f.x += (goal.x - f.x) * ease; f.y += (goal.y - f.y) * ease; f.z += (goal.z - f.z) * ease;
    }
    f.present = goal.present || f.near > 0.004;
    f.near += (goal.near - f.near) * (1 - Math.exp(-dt / (goal.near > f.near ? 0.09 : 0.16)));
    const fl = Math.hypot(f.x, f.y, f.z) || 1;
    const fx = f.x / fl, fy = f.y / fl, fz = f.z / fl;
    if (goal.present) { state.contact.x = fx; state.contact.y = fy; state.contact.z = fz; }
    const near = f.near;

    for (let i = 0; i < N; i++) {
      const o = i * 3;
      let rx = root[o], ry = root[o + 1], rz = root[o + 2];
      let ax = 0, ay = 0, az = 0;
      for (let j = 0; j < N; j++) {
        if (j === i || level[j] < 0.05) continue;
        const dx = rx - root[j * 3], dy = ry - root[j * 3 + 1], dz = rz - root[j * 3 + 2];
        const d2 = dx * dx + dy * dy + dz * dz + 0.03, w = REPEL * level[j] / (d2 * Math.sqrt(d2));
        ax += dx * w; ay += dy * w; az += dz * w;
      }
      // Roots on the finger's side slide toward it.
      const align = rx * fx + ry * fy + rz * fz;
      const pull = near * 0.9 * smooth(-0.2, 0.9, align) * (i === state.mainIndex ? 4 : 1);
      ax += (fx - rx * align) * pull; ay += (fy - ry * align) * pull; az += (fz - rz * align) * pull;
      // Wander: the attachment crawls over the electrode.
      const t = state.time * 0.4 + offset[i];
      ax += 0.5 * noise(t, i, 1.3); ay += 0.5 * noise(t, i, 5.1); az += 0.5 * noise(t, i, 9.7);
      const damp = Math.exp(-dt * 3);
      rootVel[o] = (rootVel[o] + ax * dt) * damp; rootVel[o + 1] = (rootVel[o + 1] + ay * dt) * damp; rootVel[o + 2] = (rootVel[o + 2] + az * dt) * damp;
      // Only the tangential part moves a root over the sphere.
      const vn = rootVel[o] * rx + rootVel[o + 1] * ry + rootVel[o + 2] * rz;
      rx += (rootVel[o] - rx * vn) * dt; ry += (rootVel[o + 1] - ry * vn) * dt; rz += (rootVel[o + 2] - rz * vn) * dt;
      const l = Math.hypot(rx, ry, rz);
      root[o] = rx / l; root[o + 1] = ry / l; root[o + 2] = rz / l;

      main[i] += ((i === state.mainIndex ? 1 : 0) - main[i]) * (1 - Math.exp(-dt / (i === state.mainIndex ? 0.1 : 0.15)));

      // Life cycle: fade in, hold, fade out, strike again. A finger takes current from all
      // channels but those leading to it, so most go out as it closes in.
      age[i] += dt;
      const sector = smooth(0.2, 0.85, align);
      const keep = 1 - 0.9 * Math.pow(near, 0.8) * (1 - 0.35 * sector);
      // The channel carrying the finger's current is never let go.
      const carrying = i === state.mainIndex;
      if (carrying) age[i] = Math.min(age[i], span[i] - 0.35);
      const gate = carrying ? 1 : smooth(-0.06, 0.06, keep - rank[i]);
      const envelope = smooth(0, 0.14, age[i]) * (1 - smooth(span[i] - 0.3, span[i], age[i]));
      const target = envelope * gate;
      level[i] += (target - level[i]) * (1 - Math.exp(-dt / (target > level[i] ? 0.06 : 0.12)));
      if (age[i] >= span[i]) strike(i);
    }
  }

  // Trace one channel from (x, y, z) along heading (dx, dy, dz) until it reaches the glass or runs
  // out of points. Points land in `out`; returns their count.
  function trace(out, x, y, z, dx, dy, dz, seed, kink, limit, jag = 0.35) {
    const f = state.finger, q = SINK * Math.pow(f.near, 1.25);
    const t = state.time * 0.5;
    out[0] = x; out[1] = y; out[2] = z;
    let n = 1;
    while (n < limit) {
      const r2 = x * x + y * y + z * z, r = Math.sqrt(r2);
      // Field of the electrode charge plus the finger sink, the sink softened.
      const inv = 1 / (r2 * r);
      let ex = x * inv, ey = y * inv, ez = z * inv;
      if (q > 0) {
        const gx = f.x - x, gy = f.y - y, gz = f.z - z;
        const g2 = gx * gx + gy * gy + gz * gz + SOFTEN * SOFTEN, w = q / (Math.sqrt(g2) * (g2 + 0.35));
        ex += gx * w; ey += gy * w; ez += gz * w;
      }
      const el = Math.hypot(ex, ey, ez) || 1;
      ex /= el; ey /= el; ez /= el;
      // A kink, perpendicular to the field so it bends the channel without stalling it.
      const u = x * WAVE, v = y * WAVE, w = z * WAVE;
      let kx = noise(u + seed + t, v + t * 0.6, w - t * 0.8), ky = noise(u - t * 0.7, v + seed * 1.3 + t, w + 31.7), kz = noise(u + 57.3, v - t * 0.9, w + seed * 0.7 + t * 0.5);
      kx += jag * noise(u * 3.1 + seed, v * 3.1 + t * 2, w * 3.1); ky += jag * noise(u * 3.1 + 9.1, v * 3.1 + seed, w * 3.1 - t * 2); kz += jag * noise(u * 3.1 - t * 2, v * 3.1 + 4.4, w * 3.1 + seed);
      const kd = kx * ex + ky * ey + kz * ez;
      kx -= ex * kd; ky -= ey * kd; kz -= ez * kd;
      const tx = ex + kink * kx, ty = ey + kink * ky + RISE * (1 - f.near * 0.6), tz = ez + kink * kz;
      const tl = Math.hypot(tx, ty, tz) || 1;
      dx = dx * STIFFNESS + tx / tl * (1 - STIFFNESS); dy = dy * STIFFNESS + ty / tl * (1 - STIFFNESS); dz = dz * STIFFNESS + tz / tl * (1 - STIFFNESS);
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl; dy /= dl; dz /= dl;
      x += dx * STEP; y += dy * STEP; z += dz * STEP;
      const rr = Math.hypot(x, y, z);
      if (rr >= GLOBE.inner) {
        // Land on the glass along the last step.
        const k = GLOBE.inner / rr;
        out[n * 3] = x * k; out[n * 3 + 1] = y * k; out[n * 3 + 2] = z * k;
        return n + 1;
      }
      if (rr < ELECTRODE.radius) { const k = ELECTRODE.radius / rr; x *= k; y *= k; z *= k; }
      out[n * 3] = x; out[n * 3 + 1] = y; out[n * 3 + 2] = z; n++;
    }
    return n;
  }

  let count = 0, footCount = 0;
  // Channel brightness varies along its length in soft beads that drift.
  const bead = (k, phase, steady) => 1 + (0.7 + 0.6 * noise(k * 0.5 + phase, state.time * 2.2, phase) - 1) * (1 - steady);
  function emit(pts, n, strength, width, s0, s1, profile, phase = 0, steady = 0) {
    for (let k = 0; k < n - 1 && count < MAX_SEGMENTS; k++) {
      const u0 = k / (n - 1), u1 = (k + 1) / (n - 1), a = k * 3, b = a + 3;
      segments.set([pts[a], pts[a + 1], pts[a + 2], width * (1.45 - 0.85 * u0), pts[b], pts[b + 1], pts[b + 2], width * (1.45 - 0.85 * u1),
        strength * profile(u0) * bead(k, phase, steady), strength * profile(u1) * bead(k + 1, phase, steady), s0 + (s1 - s0) * u0, s0 + (s1 - s0) * u1], count * SEGMENT_FLOATS);
      count++;
    }
  }
  function addFoot(x, y, z, size, strength, tx, ty, tz) {
    if (footCount >= MAX_FEET) return;
    feet.set([x, y, z, size, strength, tx, ty, tz], footCount * 8);
    footCount++;
  }
  const reachesGlass = (pts, n) => Math.hypot(pts[n * 3 - 3], pts[n * 3 - 2], pts[n * 3 - 1]) >= GLOBE.inner - 1e-4;
  const fadeOut = reach => u => (1 - 0.35 * u) * (1 - (1 - reach) * smooth(0.45, 1, u));
  const dwindle = u => Math.pow(1 - u, 0.6);

  // A side channel leaves `pts` at point k, turned by `angle` about the trunk (twisted by
  // `twist`), and follows the field to the glass or dies on the way. Long ones fork once more.
  const limbs = [new Float32Array(MAX_POINTS * 3), new Float32Array(MAX_POINTS * 3)];
  function branch(pts, k, twist, angle, length, seed, strength, width, s0, share, depth) {
    const o = k * 3, out = limbs[depth];
    let tx = pts[o + 3] - pts[o - 3], ty = pts[o + 4] - pts[o - 2], tz = pts[o + 5] - pts[o - 1];
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    // Any vector not parallel to the trunk gives a side axis; twist it around the trunk.
    const ux = Math.abs(tx) < 0.8 ? 1 : 0, uy = 1 - ux;
    let sx = ty * 0 - tz * uy, sy = tz * ux - tx * 0, sz = tx * uy - ty * ux;
    const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
    const px = ty * sz - tz * sy, py = tz * sx - tx * sz, pz = tx * sy - ty * sx;
    const ct = Math.cos(twist), st = Math.sin(twist), ca = Math.cos(angle), sa = Math.sin(angle);
    const m = trace(out, pts[o], pts[o + 1], pts[o + 2],
      tx * ca + (sx * ct + px * st) * sa, ty * ca + (sy * ct + py * st) * sa, tz * ca + (sz * ct + pz * st) * sa,
      seed, KINK * 1.2, Math.max(4, Math.round(length)));
    emit(out, m, strength, width, s0, Math.min(1, s0 + 0.45), dwindle, seed);
    if (reachesGlass(out, m)) {
      const e = (m - 1) * 3;
      addFoot(out[e], out[e + 1], out[e + 2], 0.05, strength * 0.6, out[e] - out[e - 3], out[e + 1] - out[e - 2], out[e + 2] - out[e - 1]);
    } else if (depth === 0 && m > 8) {
      branch(out, Math.floor(m * 0.5), twist + 2.1, angle * 1.1, length * 0.7, seed + 5.3, strength * 0.6, width * 0.85, s0 + 0.2, share, 1);
    }
  }

  // Short discharges that spread over the glass from where a channel lands.
  const spray = new Float32Array(TENDRIL_POINTS * 3);
  function brush(i, fx, fy, fz, strength, width, share) {
    const nl = Math.hypot(fx, fy, fz), nx = fx / nl, ny = fy / nl, nz = fz / nl;
    const ux = Math.abs(ny) > 0.9 ? 1 : 0, uy = 1 - ux, dn = ux * nx + uy * ny;
    let e1x = ux - nx * dn, e1y = uy - ny * dn, e1z = -nz * dn;
    const e1l = Math.hypot(e1x, e1y, e1z); e1x /= e1l; e1y /= e1l; e1z /= e1l;
    const e2x = ny * e1z - nz * e1y, e2y = nz * e1x - nx * e1z, e2z = nx * e1y - ny * e1x;
    for (let t = 0; t < TENDRILS; t++) {
      const at = i * TENDRILS + t;
      const th = tendrilAngle[at] + 0.6 * noise(state.time * 0.5 + offset[i], t, 8.1);
      let dx = e1x * Math.cos(th) + e2x * Math.sin(th), dy = e1y * Math.cos(th) + e2y * Math.sin(th), dz = e1z * Math.cos(th) + e2z * Math.sin(th);
      const len = tendrilLen[at] / (TENDRIL_POINTS - 1);
      let x = fx, y = fy, z = fz;
      spray[0] = x; spray[1] = y; spray[2] = z;
      for (let k = 1; k < TENDRIL_POINTS; k++) {
        const curl = noise(x * 6 + t * 3.7, y * 6 + offset[i], z * 6 + state.time * 0.8);
        // Turn about the surface normal, then re-project onto the shell.
        const cx = ny * dz - nz * dy, cy = nz * dx - nx * dz, cz = nx * dy - ny * dx;
        dx += cx * curl * 0.9; dy += cy * curl * 0.9; dz += cz * curl * 0.9;
        const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
        x += dx * len; y += dy * len; z += dz * len;
        const rl = GLOBE.inner / Math.hypot(x, y, z); x *= rl; y *= rl; z *= rl;
        spray[k * 3] = x; spray[k * 3 + 1] = y; spray[k * 3 + 2] = z;
      }
      emit(spray, TENDRIL_POINTS, strength * tendrilPower[at], width, 1, 1, dwindle);
    }
  }

  const paths = Array.from({ length: N }, () => new Float32Array(MAX_POINTS * 3));
  const pathLength = new Uint8Array(N), gap = new Float32Array(N);

  // Rebuild the glowing geometry for the current state.
  function build() {
    count = 0; footCount = 0;
    const f = state.finger, near = f.near, { x: cx, y: cy, z: cz } = state.contact;
    // Voltage droop: the finger draws current, so the free channels dim.
    const droop = 1 - 0.5 * Math.pow(near, 0.9);
    let energy = 0, nearest = -1, nearestGap = Infinity;

    for (let i = 0; i < N; i++) {
      pathLength[i] = 0;
      if (level[i] < 0.01) continue;
      const rx = root[i * 3], ry = root[i * 3 + 1], rz = root[i * 3 + 2], pts = paths[i];
      const n = trace(pts, rx * ELECTRODE.radius, ry * ELECTRODE.radius, rz * ELECTRODE.radius, rx, ry, rz, offset[i], KINK * (1 - 0.6 * near * main[i]), MAX_POINTS, 0.35 + 1.3 * near * main[i]);
      pathLength[i] = n;
      const e = (n - 1) * 3;
      gap[i] = Math.hypot(pts[e] - cx * GLOBE.inner, pts[e + 1] - cy * GLOBE.inner, pts[e + 2] - cz * GLOBE.inner);
      if (near > 0.05 && level[i] > 0.3 && gap[i] < nearestGap) { nearestGap = gap[i]; nearest = i; }
    }
    // The finger's channel keeps its identity while it stays nearest, so it does not flicker.
    const held = state.mainIndex;
    if (nearest >= 0 && held >= 0 && held !== nearest && pathLength[held] && level[held] > 0.3 && gap[held] < Math.max(0.5, nearestGap * 1.6)) nearest = held;
    state.mainIndex = near > 0.05 ? nearest : -1;

    for (let i = 0; i < N; i++) {
      const n = pathLength[i];
      if (!n) continue;
      const pts = paths[i], share = main[i] * near;
      const captured = smooth(0.45, 0.1, gap[i]) * near * (1 - main[i]);
      const flick = 1 + 0.12 * noise(state.time * 9 + offset[i], i, 4.4);
      const strength = level[i] * (power[i] + (1.2 - power[i]) * share) * flick * droop * (1 - 0.92 * captured) * (1 + 5 * share);
      const width = CORE * (1 + 1.8 * share);
      if (share > 0.05) {
        // The last stretch of the finger's channel closes on the fingertip's landing point.
        const k0 = Math.max(1, n - 4);
        for (let k = k0; k < n; k++) {
          const w = share * smooth(k0 - 1, n - 1, k);
          pts[k * 3] += (cx * GLOBE.inner - pts[k * 3]) * w; pts[k * 3 + 1] += (cy * GLOBE.inner - pts[k * 3 + 1]) * w; pts[k * 3 + 2] += (cz * GLOBE.inner - pts[k * 3 + 2]) * w;
        }
      }
      // The finger's channel stays blue-white end to end; the pink of a channel's cooler tip is lost to its heat.
      emit(pts, n, strength, width, 0, 1 - 0.7 * share, fadeOut(reach[i]), offset[i], share);
      energy += strength * 0.25;
      for (let b = 0; b < branchCount[i]; b++) {
        const at = i * BRANCH_MAX + b, k = Math.max(2, Math.min(n - 3, Math.floor(branchAt[at] * (n - 1))));
        const twist = branchTwist[at] + state.time * 0.06 * (b + 1);
        branch(pts, k, twist, branchAngle[at] * (1 - 0.5 * share), branchLen[at] * (n - 1) + 3, offset[i] + 13.7 * (b + 1),
          strength * (0.55 - 0.1 * b) * (1 - 0.55 * share), width * 0.72, k / (n - 1), share, 0);
      }
      const e = (n - 1) * 3, fx = pts[e], fy = pts[e + 1], fz = pts[e + 2];
      // A landing's glow does not grow with the current: the hot patch is drawn separately at the fingertip.
      const glow = strength / (1 + 5 * share);
      addFoot(fx, fy, fz, (0.03 + 0.05 * power[i]) * (1 + 0.6 * share), glow * reach[i] * (1 + share), fx - pts[e - 3], fy - pts[e - 2], fz - pts[e - 1]);
      brush(i, fx, fy, fz, glow * 0.45 * reach[i], CORE * 1.2, share);
    }
    // Where the finger touches, a hot patch on the glass.
    if (near > 0.03) addFoot(cx * GLOBE.inner, cy * GLOBE.inner, cz * GLOBE.inner, 0.05 + 0.05 * near, 3 * Math.pow(near, 2), 0, 1, 0);
    state.discharge = state.mainIndex >= 0 ? main[state.mainIndex] * near : 0;
    state.energy += (energy * 0.02 - state.energy) * 0.1;
    state.segmentCount = count; state.footCount = footCount;
    for (let i = 0; i < N; i++) {
      roots[i * 4] = root[i * 3]; roots[i * 4 + 1] = root[i * 3 + 1]; roots[i * 4 + 2] = root[i * 3 + 2];
      roots[i * 4 + 3] = level[i] * power[i] * droop * (1 + 3 * main[i] * near);
    }
    return state;
  }

  return {
    state, segments, feet, roots, setFinger, step, build,
  };
}
