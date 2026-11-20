import { noise3, fbm3, smoothstep } from './noise.js';

// The place, in metres: the lake's surface is y = 0, the islet sits on the origin, and the
// camera looks across the water at it from +z. Everything here is fixed, so the picture is
// composed once.
export const ISLAND = Object.freeze({ rx: 1.75, rz: 1.6 });
// The tree stands at the islet's right-hand edge and leans out over the water from there.
export const TREE = Object.freeze({ x: 1.45, z: 0.25 });
// Towards the pole star: the one point of the sky that does not move, which everything
// else in the sky wheels slowly about. Here it is bright enough to see by. It stands low
// behind the tree and a little to its right, in the open sky above the long bough, so the
// tree is seen against its light and the blossom with the light coming through it.
export const POLE_STAR = Object.freeze(normalize([0.079, 0.423, -0.903]));
// The square of lake floor and islet the height map covers.
export const HEIGHT_MAP = Object.freeze({ size: 256, min: -12, span: 24 });
// The camera sits just over the water, well back from the islet, and never moves: the tree
// is small under a great deal of sky. `horizon` is how far up the frame the horizon lies,
// and `trunk` how far in from the left edge the trunk stands, in frame heights (held
// between `nearest` and `furthest` as shares of the width): the frame is cut from the
// camera's view so that a wider screen gains open lake and sky on the right and the tree
// stays where it is.
export const CAMERA = Object.freeze({ x: 5.4, height: 0.42, z: 21.5, fov: 50, horizon: 0.24, trunk: 0.52, nearest: 0.2, furthest: 0.4 });

function normalize([x, y, z]) { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; }

// A tongue of low rock running out from the islet towards the viewer.
const SPIT = { x: -0.34, z: 0.94, length: 3.4, width: 0.75 };

// Height of the ground above the lake's surface; negative is lake floor. The islet is a
// crag: steep-sided, ledged, with a low spit running out of it.
export function groundHeight(x, z) {
  const d = Math.hypot(x, z) || 1e-6, cx = x / d, cz = z / d;
  const rim = 1 + 0.5 * (fbm3(cx * 1.2 + 3.1, cz * 1.2 + 1.7, 0.5, 3) - 0.5) + 0.2 * (noise3(cx * 3.4 + 9, cz * 3.4, 1.7) - 0.5);
  const crag = 1 - Math.hypot(x / ISLAND.rx, z / ISLAND.rz) / rim;
  const along = x * SPIT.x + z * SPIT.z, across = (x * SPIT.z - z * SPIT.x) / (SPIT.width * (1 + 0.5 * (noise3(along * 0.9, 4.2) - 0.5)));
  const spit = along > 0 ? 1 - along / SPIT.length - across * across : -1;
  // The shelf of rock the tree's roots hold, at the islet's edge.
  const foot = 1 - Math.hypot(x - TREE.x, z - TREE.z) / (0.95 + 0.25 * (noise3(cx * 2 + 4, cz * 2, 9.4) - 0.5));
  if (crag <= 0 && spit <= 0 && foot <= 0) return Math.max(-1.6, Math.max(crag, spit * 0.5, foot * 0.6) * 1.5);
  let height = foot > 0 ? 0.04 + 0.3 * smoothstep(0, 0.55, foot) + 0.08 * (noise3(x * 3 + 2, z * 3, 5.5) - 0.5) * smoothstep(0, 0.3, foot) : 0;
  if (crag > 0) {
    const ledges = 0.1 * Math.sin(crag * 19 + 4 * noise3(x * 0.9, z * 0.9, 6.1));
    height = Math.max(height, 0.22 * Math.min(1, crag * 9) + 0.85 * smoothstep(0.02, 0.6, crag + ledges * smoothstep(0, 0.2, crag))
      + 0.34 * (fbm3(x * 1.4 + 20, z * 1.4 + 4, 2.2, 3) - 0.5) * smoothstep(0, 0.3, crag));
  }
  if (spit > 0) height = Math.max(height, (0.07 + 0.16 * noise3(x * 1.7 + 8, z * 1.7, 3.3)) * smoothstep(0, 0.35, spit));
  return Math.max(height, 0.004);
}

// groundHeight on a grid: what the water, the ripples and the drifting petals read, since
// they ask thousands of times a second.
export function createTerrain() {
  const { size, min, span } = HEIGHT_MAP, map = new Float32Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++)
    map[j * size + i] = groundHeight(min + (i + 0.5) / size * span, min + (j + 0.5) / size * span);
  function heightAt(x, z) {
    const u = (x - min) / span * size - 0.5, v = (z - min) / span * size - 0.5;
    if (u < 0 || v < 0 || u >= size - 1 || v >= size - 1) return -1.6;
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, at = j * size + i;
    return (map[at] * (1 - fu) + map[at + 1] * fu) * (1 - fv) + (map[at + size] * (1 - fu) + map[at + size + 1] * fu) * fv;
  }
  return { map, heightAt };
}

// --- The ground: a grid over the islet, kept where it is above or just under the water.
const GROUND = { x0: -4.2, z0: -3.4, x1: 3.6, z1: 4.6, step: 0.04 };
export const GROUND_FLOATS = 7; // position, normal, how much of the sky it sees

export function buildGround(light) {
  const nx = Math.round((GROUND.x1 - GROUND.x0) / GROUND.step) + 1, nz = Math.round((GROUND.z1 - GROUND.z0) / GROUND.step) + 1;
  const vertices = new Float32Array(nx * nz * GROUND_FLOATS), heights = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = GROUND.x0 + i * GROUND.step, z = GROUND.z0 + j * GROUND.step, y = groundHeight(x, z), e = 0.03;
    const nxv = groundHeight(x - e, z) - groundHeight(x + e, z), nzv = groundHeight(x, z - e) - groundHeight(x, z + e);
    const l = Math.hypot(nxv, 2 * e, nzv);
    heights[j * nx + i] = y;
    vertices.set([x, y, z, nxv / l, 2 * e / l, nzv / l, light.sky(x, y + 0.08, z)], (j * nx + i) * GROUND_FLOATS);
  }
  const index = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    if (Math.max(heights[a], heights[b], heights[c], heights[d]) < -0.2) continue;
    index.push(a, c, b, b, c, d);
  }
  return { vertices, index: new Uint32Array(index) };
}

// --- Rocks: crags standing up out of the islet, and a few stones in the water off it.
// `size` is the half-extent.
const ROCKS = [
  { x: -1.15, z: 0.35, size: [0.8, 0.95, 0.65], turn: 0.4 },
  { x: -0.2, z: -0.7, size: [0.7, 0.7, 0.6], turn: 1.9 },
  { x: 0.75, z: 0.95, size: [0.5, 0.36, 0.42], turn: 2.6 },
  { x: -1.6, z: 1.2, size: [0.42, 0.26, 0.36], turn: 0.9 },
  { x: -0.95, z: 2.7, size: [0.4, 0.2, 0.3], turn: 2.2 },
  { x: 4.4, z: -2.6, size: [0.5, 0.22, 0.4], turn: 1.2 },
].map((rock, i) => Object.freeze({ ...rock, seed: 13.7 * (i + 1), y: Math.max(groundHeight(rock.x, rock.z), -0.3) + rock.size[1] * 0.18 }));
export const ROCK_FLOATS = 7; // position, normal, how much of the sky it sees

const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

// A rock is a lump of noise cut by a handful of flat planes, their edges worn round.
function rockPoint(rock, planes, dx, dy, dz) {
  const s = rock.seed;
  let radius = 1 + 0.5 * (fbm3(dx * 1.5 + s, dy * 1.5, dz * 1.5 + s, 3) - 0.5);
  for (const [nx, ny, nz, c] of planes) {
    const facing = dx * nx + dy * ny + dz * nz;
    if (facing > 0.05) radius = smin(radius, c / facing, 0.14);
  }
  radius += 0.07 * (fbm3(dx * 6 + s, dy * 6 + s, dz * 6, 3) - 0.5) + 0.02 * (noise3(dx * 21, dy * 21 + s, dz * 21) - 0.5);
  const lx = dx * radius * rock.size[0], ly = dy * radius * rock.size[1], lz = dz * radius * rock.size[2];
  const c = Math.cos(rock.turn), sn = Math.sin(rock.turn);
  return [rock.x + lx * c + lz * sn, rock.y + ly, rock.z - lx * sn + lz * c];
}

function buildRock(rock, light) {
  const n = rock.size[0] > 0.45 ? 26 : 14, planes = [];
  for (let k = 0; k < 7; k++) {
    const a = noise3(rock.seed, k * 3.1) * Math.PI * 2, up = k === 0 ? 0.95 : noise3(rock.seed + 5, k * 2.3) * 1.3 - 0.55;
    const l = Math.hypot(Math.cos(a), up, Math.sin(a));
    planes.push([Math.cos(a) / l, up / l, Math.sin(a) / l, 0.6 + 0.3 * noise3(rock.seed + 9, k * 1.7)]);
  }
  const vertices = new Float32Array(6 * (n + 1) * (n + 1) * ROCK_FLOATS), index = [];
  const point = (d) => rockPoint(rock, planes, ...d);
  const unit = ([x, y, z]) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };
  const faces = [(u, v) => [1, v, -u], (u, v) => [-1, v, u], (u, v) => [u, 1, -v], (u, v) => [u, -1, v], (u, v) => [u, v, 1], (u, v) => [-u, v, -1]];
  faces.forEach((face, f) => {
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const u = Math.tan((i / n - 0.5) * Math.PI / 2), v = Math.tan((j / n - 0.5) * Math.PI / 2), e = 0.02;
      const p = point(unit(face(u, v))), pu = point(unit(face(u + e, v))), pv = point(unit(face(u, v + e)));
      const ax = pu[0] - p[0], ay = pu[1] - p[1], az = pu[2] - p[2], bx = pv[0] - p[0], by = pv[1] - p[1], bz = pv[2] - p[2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const q = [p[0] + nx * 0.12, Math.max(0.05, p[1] + ny * 0.12), p[2] + nz * 0.12];
      vertices.set([...p, nx, ny, nz, light.sky(...q)], (f * (n + 1) * (n + 1) + j * (n + 1) + i) * ROCK_FLOATS);
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = f * (n + 1) * (n + 1) + j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  });
  return { vertices, index };
}

// Every rock in one mesh.
export function buildRocks(light) {
  const parts = ROCKS.map((rock) => buildRock(rock, light));
  const vertices = new Float32Array(parts.reduce((sum, part) => sum + part.vertices.length, 0)), index = [];
  let offset = 0;
  for (const part of parts) {
    vertices.set(part.vertices, offset * ROCK_FLOATS);
    for (const i of part.index) index.push(i + offset);
    offset += part.vertices.length / ROCK_FLOATS;
  }
  return { vertices, index: new Uint32Array(index) };
}

// Whether a spot of ground is taken up by a rock.
export const onRock = (x, z, margin = 0.85) => ROCKS.some((rock) => ((x - rock.x) / rock.size[0]) ** 2 + ((z - rock.z) / rock.size[2]) ** 2 < margin);

// --- Grass: not a lawn. Tufts where the moss holds enough soil, and sedge at the waterline.
export const BLADE_FLOATS = 9; // root, height, yaw, lean, tint, width, how much of the sky it sees
export const BLADE_COUNT = 22000;

export function buildGrass(light, random) {
  const blades = new Float32Array(BLADE_COUNT * BLADE_FLOATS);
  let count = 0;
  for (let tries = 0; count < BLADE_COUNT && tries < BLADE_COUNT * 40; tries++) {
    const x = GROUND.x0 + random() * (GROUND.x1 - GROUND.x0), z = GROUND.z0 + random() * (GROUND.z1 - GROUND.z0), y = groundHeight(x, z);
    if (y < 0.02 || onRock(x, z) || Math.hypot(x - TREE.x, z - TREE.z) < 0.5) continue;
    const steep = Math.hypot(groundHeight(x + 0.05, z) - y, groundHeight(x, z + 0.05) - y) / 0.05;
    // Tufts: a blade grows where its patch of noise says there is a tuft, and the rock is not too steep.
    const tuft = smoothstep(0.6, 0.74, noise3(x * 2.6, z * 2.6, 8.2)) * smoothstep(1.3, 0.5, steep), shore = (1 - smoothstep(0.03, 0.22, y)) * smoothstep(0.6, 0.72, noise3(x * 3.4 + 5, z * 3.4, 2.4));
    if (random() > Math.max(tuft, shore)) continue;
    const height = shore > tuft ? 0.2 + 0.34 * random() : 0.07 + 0.16 * random();
    blades.set([
      x, y - 0.01, z, height, random() * Math.PI * 2, 0.2 + 0.6 * random() + (shore > tuft ? 0.3 : 0), random(), 0.005 + 0.004 * random() + height * 0.012,
      light.sky(x, y + 0.1, z),
    ], count++ * BLADE_FLOATS);
  }
  return blades.subarray(0, count * BLADE_FLOATS);
}
