import * as THREE from 'three';
import { randomGenerator } from '../../shared/random.js';

// The fire pit, built once from a fixed seed: the ash heap and ground, the charred logs,
// loose coals and stones, and the coiled sword driven into the heap. One unit is a metre.

const V3 = THREE.Vector3;
const TAU = Math.PI * 2;

// Smooth value noise in three dimensions, for shaping geometry.
function hash(x, y, z) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function noise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const lerp = (a, b, t) => a + (b - a) * t;
  const c = (i, j, k) => hash(xi + i, yi + j, zi + k);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v), w) * 2 - 1;
}
function fbm(x, y, z, octaves = 4) {
  let sum = 0, amp = 0.5, f = 1;
  for (let i = 0; i < octaves; i++) { sum += amp * noise(x * f, y * f, z * f); f *= 2.03; amp *= 0.5; }
  return sum;
}

// The ground: a low heap of ash and earth under the fire, settling into a dirt clearing.
export function groundHeight(x, z) {
  const r = Math.hypot(x, z * 1.08);
  const heap = 0.3 * Math.exp(-Math.pow(r / 0.56, 2.2)) + 0.06 * Math.exp(-Math.pow(r / 1.0, 2));
  const lumps = fbm(x * 3.1, 0.5, z * 3.1, 4) * 0.05 * Math.exp(-r * 1.2) + fbm(x * 9, 2.5, z * 9, 3) * 0.032 * Math.exp(-r * 1.5) + fbm(x * 26, 4.5, z * 26, 2) * 0.006 * Math.exp(-r)
    + fbm(x * 0.6, 3.3, z * 0.6, 3) * 0.06;
  const grit = fbm(x * 14, 1.7, z * 14, 2) * 0.004;
  return heap + lumps + grit;
}

function groundGeometry() {
  const radii = [];
  for (let r = 0; r < 1.6; r += 0.0085) radii.push(r);
  for (let r = 1.6; r < 16; r *= 1.025) radii.push(r);
  const around = 320;
  const position = [], index = [];
  for (const r of radii) for (let j = 0; j < around; j++) {
    const a = (j / around) * TAU, x = Math.cos(a) * r, z = Math.sin(a) * r;
    position.push(x, groundHeight(x, z), z);
  }
  for (let i = 0; i < radii.length - 1; i++) for (let j = 0; j < around; j++) {
    const a = i * around + j, b = i * around + (j + 1) % around, c = a + around, d = b + around;
    index.push(a, b, c, b, d, c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setIndex(index);
  // Normals from the height function itself, so the centre and the seam have no creases.
  const normal = [];
  const e = 0.004;
  for (let i = 0; i < position.length; i += 3) {
    const x = position[i], z = position[i + 2];
    const dx = (groundHeight(x + e, z) - groundHeight(x - e, z)) / (2 * e);
    const dz = (groundHeight(x, z + e) - groundHeight(x, z - e)) / (2 * e);
    const n = new V3(-dx, 1, -dz).normalize();
    normal.push(n.x, n.y, n.z);
  }
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  return geometry;
}

// A swept tube with per-vertex radius, surface coordinates and the frame used for detail.
class Sweep {
  constructor() { this.position = []; this.normal = []; this.surf = []; this.axis = []; this.index = []; }
  get count() { return this.position.length / 3; }

  // centre(s) and radius(s, angle) describe the tube; s runs 0..1 along it.
  tube({ centre, radius, length, rings, around, seed, kind, caps = [true, true], capShape = () => 0, girth = radius(0.5, 0), twist = () => 0 }) {
    const frames = transportFrames(centre, rings);
    const start = this.count;
    const grid = [];
    for (let i = 0; i <= rings; i++) {
      const s = i / rings, { p, t, n, b } = frames[i];
      const row = [];
      for (let j = 0; j <= around; j++) {
        // Samples turn with a twisted section, so its sharp edges always fall on a vertex.
        const a = (j / around) * TAU, w = a + twist(s);
        const r = radius(s, a);
        const dir = n.clone().multiplyScalar(Math.cos(w)).addScaledVector(b, Math.sin(w));
        row.push(p.clone().addScaledVector(dir, r));
      }
      grid.push(row);
    }
    for (let i = 0; i <= rings; i++) {
      for (let j = 0; j <= around; j++) {
        // Normal from the surface itself: cross of the along and around differences.
        const iu = Math.min(rings, i + 1), id = Math.max(0, i - 1);
        const jr = (j + 1) % around, jl = (j - 1 + around) % around;
        const du = grid[iu][j].clone().sub(grid[id][j]);
        const dv = grid[i][jr].clone().sub(grid[i][jl]);
        const nrm = dv.clone().cross(du).normalize();
        const out = grid[i][j].clone().sub(frames[i].p);
        if (nrm.dot(out) < 0) nrm.negate();
        const q = grid[i][j];
        this.position.push(q.x, q.y, q.z);
        this.normal.push(nrm.x, nrm.y, nrm.z);
        this.surf.push(i / rings * length, j / around, kind, seed);
        this.axis.push(frames[i].t.x, frames[i].t.y, frames[i].t.z, girth);
      }
    }
    const row = around + 1;
    for (let i = 0; i < rings; i++) for (let j = 0; j < around; j++) {
      const a = start + i * row + j, b = a + 1, c = a + row, d = c + 1;
      this.index.push(a, b, c, b, d, c);
    }
    // Caps: a fan from the last ring to a centre pushed in or out along the axis.
    for (const end of [0, 1]) {
      if (!caps[end]) continue;
      const i = end ? rings : 0, f = frames[i], sign = end ? 1 : -1;
      const ringStart = start + i * row;
      const centreIndex = this.count;
      const tip = f.p.clone().addScaledVector(f.t, sign * capShape(end, 0, 0));
      this.position.push(tip.x, tip.y, tip.z);
      this.normal.push(f.t.x * sign, f.t.y * sign, f.t.z * sign);
      this.surf.push(end ? length : 0, 0, kind + 0.5, seed);
      this.axis.push(f.n.x, f.n.y, f.n.z, girth);
      // An inner ring, so the cap can be broken and uneven rather than one flat fan.
      const inner = this.count;
      for (let j = 0; j <= around; j++) {
        const a = (j / around) * TAU;
        const r = radius(end, a) * 0.55;
        const q = f.p.clone().addScaledVector(f.n, Math.cos(a) * r).addScaledVector(f.b, Math.sin(a) * r)
          .addScaledVector(f.t, sign * capShape(end, a, 0.55));
        this.position.push(q.x, q.y, q.z);
        this.normal.push(f.t.x * sign, f.t.y * sign, f.t.z * sign);
        this.surf.push(end ? length : 0, j / around, kind + 0.5, seed);
        this.axis.push(f.n.x, f.n.y, f.n.z, girth);
      }
      for (let j = 0; j < around; j++) {
        const o0 = ringStart + j, o1 = ringStart + j + 1, i0 = inner + j, i1 = inner + j + 1;
        if (end) this.index.push(o0, i0, o1, o1, i0, i1, i0, centreIndex, i1);
        else this.index.push(o0, o1, i0, o1, i1, i0, i0, i1, centreIndex);
      }
    }
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3));
    g.setAttribute('aSurf', new THREE.Float32BufferAttribute(this.surf, 4));
    g.setAttribute('aAxis', new THREE.Float32BufferAttribute(this.axis, 4));
    g.setIndex(this.index);
    return g;
  }
}

// Parallel-transport frames along a curve, so a twisted section does not flip.
function transportFrames(centre, rings) {
  const frames = [];
  let n = null;
  for (let i = 0; i <= rings; i++) {
    const s = i / rings, e = 1e-3;
    const p = centre(s);
    const t = centre(Math.min(1, s + e)).sub(centre(Math.max(0, s - e))).normalize();
    if (!n) {
      const helper = Math.abs(t.y) < 0.9 ? new V3(0, 1, 0) : new V3(1, 0, 0);
      n = helper.clone().cross(t).normalize();
    } else {
      n = n.clone().sub(t.clone().multiplyScalar(n.dot(t))).normalize();
    }
    const b = t.clone().cross(n).normalize();
    frames.push({ p, t, n: n.clone(), b });
  }
  return frames;
}

// The pile: charred branches driven into a heap of ash from all sides, burned to points
// where they meet in the fire, with a few fallen across the flanks and twigs around.
function logLayout(random) {
  const logs = [];
  // Leaning branches: [azimuth (deg), foot radius, top height, top overshoot, radius].
  const leaning = [
    [-172, 0.72, 0.54, 0.2, 0.056], [-138, 0.5, 0.68, -0.02, 0.03], [-112, 0.8, 0.5, 0.26, 0.06],
    [-64, 0.6, 0.66, 0.06, 0.04], [-30, 0.84, 0.46, 0.32, 0.05], [10, 0.56, 0.6, 0.14, 0.034],
    [40, 0.74, 0.58, 0.1, 0.058], [96, 0.7, 0.62, 0.18, 0.042], [128, 0.8, 0.52, 0.24, 0.054],
    [166, 0.5, 0.74, -0.02, 0.028], [-86, 0.44, 0.7, 0.1, 0.026], [64, 0.48, 0.76, 0.0, 0.03],
  ];
  for (const [deg, foot, top, over, radius] of leaning) {
    const a = THREE.MathUtils.degToRad(deg + (random() - 0.5) * 26);
    const fx = Math.cos(a) * foot, fz = Math.sin(a) * foot;
    const across = a + Math.PI + (random() - 0.5) * 1.6;
    const tx = Math.cos(across) * over, tz = Math.sin(across) * over;
    logs.push({
      outer: new V3(fx, groundHeight(fx, fz) - radius * 0.6, fz),
      inner: new V3(tx, top + (random() - 0.5) * 0.08, tz),
      radius, bend: (random() - 0.5) * 0.22, burn: 0.85 + random() * 0.15,
    });
  }
  // Fallen branches lying on the flanks of the heap, half sunk in the ash.
  const lying = [[-35, 0.42, 0.85, 0.05], [140, 0.4, 0.8, 0.044], [215, 0.5, 0.75, 0.048], [60, 0.38, 0.7, 0.04], [-120, 0.36, 0.6, 0.036], [95, 0.22, 0.55, 0.04], [-5, 0.25, 0.6, 0.038], [175, 0.3, 0.5, 0.034]];
  for (const [deg, offset, length, radius] of lying) {
    const a = THREE.MathUtils.degToRad(deg);
    const cx = Math.cos(a) * offset, cz = Math.sin(a) * offset;
    const along = a + Math.PI / 2 + (random() - 0.5) * 0.9;
    const dx = Math.cos(along) * length / 2, dz = Math.sin(along) * length / 2;
    const p = new V3(cx - dx, 0, cz - dz), q = new V3(cx + dx, 0, cz + dz);
    p.y = groundHeight(p.x, p.z) - radius * 0.1;
    q.y = groundHeight(q.x, q.z) - radius * 0.1;
    // Whichever end is nearer the fire is the burned one.
    const [outer, inner] = Math.hypot(p.x, p.z) > Math.hypot(q.x, q.z) ? [p, q] : [q, p];
    logs.push({ outer, inner, radius, bend: (random() - 0.5) * 0.08, burn: 0.7 + random() * 0.3 });
  }
  // Thin sticks poking out of the heap at odd angles.
  for (let k = 0; k < 9; k++) {
    const a = random() * TAU, foot = 0.4 + random() * 0.3;
    const fx = Math.cos(a) * foot, fz = Math.sin(a) * foot;
    const across = a + Math.PI + (random() - 0.5) * 1.4;
    const reach = 0.05 + random() * 0.2;
    logs.push({
      outer: new V3(fx, groundHeight(fx, fz) - 0.01, fz),
      inner: new V3(Math.cos(across) * reach, 0.28 + random() * 0.3, Math.sin(across) * reach),
      radius: 0.01 + random() * 0.01, bend: (random() - 0.5) * 0.2, burn: 0.8 + random() * 0.2,
    });
  }
  // Twigs and splinters scattered on the ground around the fire.
  for (let k = 0; k < 26; k++) {
    const a = random() * TAU, r = 0.7 + Math.pow(random(), 0.7) * 1.1, length = 0.05 + random() * 0.16;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, d = random() * TAU;
    const p = new V3(x, 0, z), q = new V3(x + Math.cos(d) * length, 0, z + Math.sin(d) * length);
    const radius = 0.003 + random() * 0.005;
    p.y = groundHeight(p.x, p.z) + radius * 0.4;
    q.y = groundHeight(q.x, q.z) + radius * 0.4;
    logs.push({ outer: p, inner: q, radius, bend: (random() - 0.5) * 0.15, burn: random() * 0.5, twig: true });
  }
  return logs;
}

function logsGeometry(random) {
  const sweep = new Sweep();
  logLayout(random).forEach((log, k) => {
    const { outer, inner, radius, bend } = log;
    const burn = log.twig ? 0 : log.burn;
    const axis = inner.clone().sub(outer);
    const length = axis.length();
    const side = axis.clone().cross(new V3(0, 1, 0)).normalize();
    const lift = side.clone().cross(axis).normalize();
    const seed = k * 17.13 + 3.1;
    const centre = s => outer.clone().addScaledVector(axis, s)
      .addScaledVector(side, Math.sin(s * Math.PI) * bend * length)
      .addScaledVector(lift, Math.sin(s * Math.PI) * bend * 0.5 * length);
    const thin = radius < 0.02;
    const radiusAt = (s, a) => {
      const ca = Math.cos(a), sa = Math.sin(a);
      // Lumps and knots, long ridges along the grain, and the charred inner end eaten away.
      const lump = fbm(s * length * 6 + seed, ca * 0.6, sa * 0.6, 3) * 0.16;
      const ridge = fbm(s * length * 1.5 + seed, ca * 3.2, sa * 3.2, 3) * 0.1;
      // Knots: a few raised bumps where branches once grew.
      const knot = Math.pow(Math.max(0, noise(s * length * 7 + seed * 3, ca * 1.2, sa * 1.2)), 3) * 1.1;
      const blocks = Math.abs(noise(s * length * 30 + seed, ca * 5, sa * 5)) * 0.035;
      const eaten = Math.pow(THREE.MathUtils.smoothstep(s, 0.45, 1), 1.6) * burn;
      const ragged = 0.5 + 0.5 * fbm(s * length * 9 + seed * 2, ca * 1.4, sa * 1.4, 3);
      const taper = 1 - eaten * (0.7 + 0.25 * ragged);
      return radius * taper * (1 + lump + ridge + knot - blocks);
    };
    const capShape = (end, a, inner) => {
      // The outer end is broken off, the inner end burned to a ragged stub.
      const j = noise(Math.cos(a) * 3 + seed, Math.sin(a) * 3, end * 5) * radius;
      const splinter = Math.pow(Math.abs(noise(Math.cos(a) * 7 + seed, Math.sin(a) * 7, end * 3 + 1)), 0.7) * radius * 1.6;
      return end ? radius * (0.25 + 0.45 * (1 - inner)) * 0.5 + j * 0.5 : radius * 0.05 + j * 0.35 + splinter * 0.25 * (1 - inner);
    };
    sweep.tube({
      centre, radius: radiusAt, length, seed: k + 1, kind: 0,
      rings: Math.max(log.twig ? 8 : 24, Math.round(length / (thin ? 0.014 : 0.011))), around: log.twig ? 6 : thin ? 12 : 28, capShape, girth: radius,
    });
  });
  return sweep.geometry();
}

// Loose coals in the ash and stones around the clearing.
function rubbleGeometry(random) {
  const sweep = { position: [], normal: [], surf: [], index: [] };
  const base = new THREE.IcosahedronGeometry(1, 2);
  const bp = base.getAttribute('position');
  const lumps = [];
  for (let k = 0; k < 160; k++) {
    const a = random() * TAU, r = Math.pow(random(), 0.6) * 0.95;
    lumps.push({ x: Math.cos(a) * r, z: Math.sin(a) * r * 0.9, size: 0.005 + Math.pow(random(), 2.5) * 0.028, kind: 0 });
  }
  for (let k = 0; k < 26; k++) {
    const a = random() * TAU, r = 1.0 + Math.pow(random(), 0.8) * 1.8;
    lumps.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, size: 0.012 + Math.pow(random(), 3) * 0.045, kind: 1 });
  }
  for (const [k, lump] of lumps.entries()) {
    const start = sweep.position.length / 3;
    const seed = k * 3.7 + 1.3;
    const squash = lump.kind ? 0.5 + random() * 0.3 : 0.55 + random() * 0.4;
    const rot = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(random() * 0.4, random() * TAU, random() * 0.4));
    const verts = [];
    for (let i = 0; i < bp.count; i++) {
      const v = new V3().fromBufferAttribute(bp, i);
      const facet = lump.kind ? fbm(v.x * 1.5 + seed, v.y * 1.5, v.z * 1.5, 3) * 0.35 : Math.round(fbm(v.x * 2 + seed, v.y * 2, v.z * 2, 2) * 4) / 4 * 0.3;
      v.multiplyScalar(1 + facet);
      v.y *= squash;
      v.multiplyScalar(lump.size).applyMatrix4(rot);
      verts.push(v);
    }
    const y = groundHeight(lump.x, lump.z) + lump.size * squash * (lump.kind ? -0.1 : 0.2);
    for (const v of verts) sweep.position.push(v.x + lump.x, v.y + y, v.z + lump.z);
    const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(verts.flatMap(v => [v.x, v.y, v.z]), 3));
    g.computeVertexNormals();
    const gn = g.getAttribute('normal');
    for (let i = 0; i < gn.count; i++) {
      sweep.normal.push(gn.getX(i), gn.getY(i), gn.getZ(i));
      sweep.surf.push(lump.kind, seed, lump.size, 0);
    }
    for (let i = 0; i < bp.count; i++) sweep.index.push(start + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(sweep.position, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(sweep.normal, 3));
  g.setAttribute('aSurf', new THREE.Float32BufferAttribute(sweep.surf, 4));
  return g;
}

// The coiled sword, modelled point down along +y from its tip at the origin.
export const SWORD = { blade: 1.5, grip: 0.28, tip: new V3(-0.14, -0.02, 0.04), lean: 16, back: 4, spin: 35 };

function swordGeometry() {
  const sweep = new Sweep();
  const L = SWORD.blade;
  // The blade: a straight, thick core of diamond section with a raised ridge wound round it
  // in a tight double spiral, the coil that names the sword. It tapers to a blunted point.
  const turns = 6;
  const bladeCentre = s => new V3(noise(s * 4, 1, 2) * 0.0012, s * L, noise(s * 4, 4, 2) * 0.0012);
  const bladeRadius = (s, a) => {
    const taper = 0.3 + 0.7 * THREE.MathUtils.smoothstep(s, 0, 0.14);
    const width = 0.031 * taper * (1 - 0.15 * (1 - s));
    const thick = 0.012 * (0.6 + 0.4 * taper);
    const c = Math.abs(Math.cos(a)), sn = Math.abs(Math.sin(a));
    const core = 1 / Math.pow(Math.pow(c / width, 1.6) + Math.pow(sn / thick, 1.6), 1 / 1.6);
    // Two ridges spiral round the core; corrosion has eaten them unevenly.
    const phase = a - s * turns * TAU;
    const ridge = Math.pow(Math.max(Math.max(0, Math.cos(phase)), Math.max(0, Math.cos(phase + Math.PI))), 4);
    const wear = 0.6 + 0.4 * noise(s * 30, 2.2, 0.7);
    const pit = 1 - 0.05 * Math.max(0, noise(s * 70, Math.cos(a) * 3, Math.sin(a) * 3));
    return (core + 0.0075 * ridge * wear * taper) * pit * (s < 0.015 ? 0.35 + 43 * s : 1);
  };
  sweep.tube({ centre: bladeCentre, radius: bladeRadius, length: L, rings: 520, around: 40, seed: 1, kind: 1, caps: [true, false], capShape: () => 0.002 });
  // A plain collar where the blade enters the guard.
  sweep.tube({
    centre: s => new V3(0, L - 0.02 + s * 0.05, 0),
    radius: (s, a) => (0.024 + 0.005 * Math.sin(s * Math.PI)) / Math.pow(Math.pow(Math.abs(Math.cos(a)) / 1.5, 4) + Math.pow(Math.abs(Math.sin(a)), 4), 0.25) * 0.7,
    length: 0.05, rings: 16, around: 32, seed: 2, kind: 2,
  });
  // The guard: a bar swept out to each side, each arm ending in a coil curling back toward the blade.
  for (const side of [-1, 1]) {
    const reach = 0.1, coil = 0.02, top = L + 0.03;
    const centre = s => {
      if (s < 0.55) {
        const u = s / 0.55;
        return new V3(side * u * reach, L + 0.015 + Math.sin(u * Math.PI / 2) * 0.012, 0);
      }
      const u = (s - 0.55) / 0.45;
      const angle = Math.PI / 2 - u * Math.PI * 1.6, r = coil * (1 - 0.55 * u);
      return new V3(side * (reach + Math.cos(angle) * r), top - coil + Math.sin(angle) * r, 0);
    };
    sweep.tube({
      centre, length: 0.15, rings: 100, around: 20, seed: 3 + side, kind: 2,
      // A forged bar, squarish in section, thinning toward the scroll.
      radius: (s, a) => (0.019 - 0.007 * s) / Math.pow(Math.pow(Math.abs(Math.cos(a)), 3) + Math.pow(Math.abs(Math.sin(a)), 3), 1 / 3) * (1 + 0.06 * noise(s * 30, a, side)),
    });
  }
  // The grip, bound in cord, and the pommel.
  const G = SWORD.grip;
  sweep.tube({
    centre: s => new V3(0, L + 0.03 + s * G, 0), length: G, rings: 260, around: 32, seed: 6, kind: 3, caps: [false, false],
    // Leather strip wound in a helix, each turn a raised band.
    radius: (s, a) => 0.0148 * (1 + 0.07 * Math.sin(s * Math.PI)) + 0.0022 * Math.pow(Math.abs(Math.sin(Math.PI * (s * G / 0.017 + a / TAU))), 0.35),
  });
  sweep.tube({
    centre: s => new V3(0, L + 0.03 + G - 0.004 + s * 0.06, 0), length: 0.06, rings: 40, around: 32, seed: 7, kind: 2,
    radius: s => s < 0.15 ? 0.019 : 0.027 * Math.sqrt(Math.max(0, Math.sin(Math.min(1, (s - 0.1) / 0.9) * Math.PI))) + 0.003 * (s < 0.98),
    caps: [true, true], capShape: () => 0,
  });
  const geometry = sweep.geometry();
  const lean = THREE.MathUtils.degToRad(SWORD.lean), back = THREE.MathUtils.degToRad(SWORD.back), spin = THREE.MathUtils.degToRad(SWORD.spin);
  geometry.applyMatrix4(new THREE.Matrix4().makeRotationY(spin));
  geometry.applyMatrix4(new THREE.Matrix4().makeRotationX(-back));
  geometry.applyMatrix4(new THREE.Matrix4().makeRotationZ(-lean));
  geometry.translate(SWORD.tip.x, SWORD.tip.y, SWORD.tip.z);
  // The frame attribute must follow the rotation too.
  const axis = geometry.getAttribute('aAxis'), m = new THREE.Matrix3().setFromMatrix4(
    new THREE.Matrix4().makeRotationZ(-lean).multiply(new THREE.Matrix4().makeRotationX(-back)).multiply(new THREE.Matrix4().makeRotationY(spin)));
  const v = new V3();
  for (let i = 0; i < axis.count; i++) { v.fromBufferAttribute(axis, i).applyMatrix3(m); axis.setXYZ(i, v.x, v.y, v.z); }
  return geometry;
}

// Bones in the ash: part of a rib cage arching out of the heap, and a long bone on its flank.
function bonesGeometry(random) {
  const sweep = new Sweep();
  const spine = new V3(-0.5, 0, 0.36), along = new V3(0.8, 0, 0.6).normalize();
  const across = new V3(0, 1, 0).cross(along).normalize();
  // The cage lies on its side, so the ribs lean over together, each a little different.
  const tilt = 0.75;
  for (let k = 0; k < 5; k++) {
    const base = spine.clone().addScaledVector(along, (k - 2) * 0.05 + (random() - 0.5) * 0.01);
    base.y = groundHeight(base.x, base.z) - 0.09;
    const R = 0.19 - Math.abs(k - 2) * 0.02 + random() * 0.015;
    const start = 0.25 + random() * 0.15, end = 2.0 + random() * 0.5 - Math.abs(k - 2) * 0.15;
    const lean = tilt + (random() - 0.5) * 0.2;
    const up = new V3(0, Math.cos(lean), 0).addScaledVector(along, -Math.sin(lean) * 0.4).addScaledVector(across, Math.sin(lean) * 0.6).normalize();
    const centre = s => {
      const t = start + (end - start) * s;
      // Ribs bow outward and sweep back along the spine as they go.
      return base.clone().addScaledVector(across, Math.cos(t) * R * 0.85).addScaledVector(up, Math.sin(t) * R)
        .addScaledVector(along, s * s * 0.06);
    };
    sweep.tube({
      centre, length: R * (end - start), rings: 60, around: 12, seed: 40 + k, kind: 4, girth: 0.008,
      // A rib is flat in section and thins toward its free end.
      radius: (s, a) => (0.0085 - 0.004 * s) * (1 / Math.sqrt(Math.pow(Math.cos(a), 2) + Math.pow(Math.sin(a) / 0.5, 2))) * (1 + 0.08 * noise(s * 9, a, k)),
    });
  }
  // A long bone with knuckled ends, half buried.
  const p = new V3(0.24, 0, 0.48), q = new V3(0.62, 0, 0.3);
  p.y = groundHeight(p.x, p.z) + 0.004; q.y = groundHeight(q.x, q.z) + 0.006;
  sweep.tube({
    centre: s => p.clone().lerp(q, s).add(new V3(0, Math.sin(s * Math.PI) * 0.012, 0)), length: p.distanceTo(q), rings: 90, around: 18, seed: 50, kind: 4, girth: 0.014,
    radius: (s, a) => {
      const shaft = 0.012 + 0.002 * Math.cos(a * 2);
      const ends = Math.max(Math.exp(-Math.pow(s / 0.07, 2)), Math.exp(-Math.pow((1 - s) / 0.08, 2)));
      const knuckle = 1 + 0.35 * Math.cos(a * 2 + 0.6) * ends;
      return (shaft + 0.016 * ends * knuckle) * (1 + 0.05 * noise(s * 12, a, 3));
    },
  });
  return sweep.geometry();
}

// Tufts of dry grass at the edge of the clearing.
function grassGeometry(random) {
  const position = [], normal = [], surf = [], index = [];
  for (let t = 0; t < 70; t++) {
    const a = random() * TAU, r = 1.05 + Math.pow(random(), 0.8) * 2.2;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    const blades = 8 + Math.floor(random() * 14);
    for (let b = 0; b < blades; b++) {
      const h = 0.05 + random() * random() * 0.2, w = 0.0018 + random() * 0.0018;
      const yaw = random() * TAU, tilt = 0.15 + random() * 0.6;
      const ox = cx + (random() - 0.5) * 0.06, oz = cz + (random() - 0.5) * 0.06;
      const y0 = groundHeight(ox, oz) - 0.005;
      const dir = new V3(Math.cos(yaw), 0, Math.sin(yaw)), side = new V3(-dir.z, 0, dir.x);
      const start = position.length / 3, segs = 5, seed = random();
      for (let i = 0; i <= segs; i++) {
        const u = i / segs;
        // Each blade arcs over under its own weight.
        const bendAngle = tilt * u * (1 + u);
        const centre = new V3(ox, y0, oz).addScaledVector(dir, Math.sin(bendAngle) * h * u * 0.9).add(new V3(0, Math.cos(bendAngle * 0.7) * h * u, 0));
        const half = w * (1 - u * 0.92);
        for (const sgn of [-1, 1]) {
          const q = centre.clone().addScaledVector(side, sgn * half);
          position.push(q.x, q.y, q.z);
          const n = dir.clone().multiplyScalar(-Math.cos(bendAngle)).add(new V3(0, Math.sin(bendAngle), 0)).normalize();
          normal.push(n.x, n.y, n.z);
          surf.push(5, seed, u, r);
        }
      }
      for (let i = 0; i < segs; i++) {
        const k = start + i * 2;
        index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  g.setAttribute('aSurf', new THREE.Float32BufferAttribute(surf, 4));
  g.setIndex(index);
  return g;
}

export function buildWorld() {
  const random = randomGenerator(20111);
  return {
    ground: groundGeometry(),
    logs: logsGeometry(random),
    rubble: rubbleGeometry(random),
    sword: swordGeometry(),
    bones: bonesGeometry(random),
    grass: grassGeometry(random),
  };
}
