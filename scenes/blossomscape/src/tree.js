import { randomGenerator } from '../../shared/random.js';
import { noise3, smoothstep } from './noise.js';
import { TREE, groundHeight } from './site.js';

// An old cherry that has grown out over the water all its life: a heavy trunk leaning from
// the islet's edge, one long bough reaching low across the lake, and the rest of its crown
// swept back up over the island. Always the same tree, so it is grown from a fixed seed.
const SEED = 20417;
const STEP = 0.2; // metres between the skeleton's joints
const TIP_RADIUS = 0.0045, BASE_RADIUS = 0.32;
const FOOT = groundHeight(TREE.x, TREE.z);

// The limbs drawn by hand, in metres from the foot of the trunk: +x is out over the water,
// +z towards the viewer. Each starts on an earlier one.
const LIMBS = [
  // The trunk, leaning out, then turning back up and over the island as the leader.
  [[0, -0.5, 0], [0.13, 0.4, 0.03], [0.42, 1.1, 0.1], [0.8, 1.75, 0.15], [1.1, 2.5, 0], [0.95, 3.6, -0.3], [0.4, 4.9, -0.6], [-0.3, 6.1, -0.8]],
  // The long bough, reaching low across the water and sinking towards it at the tip.
  [[0.78, 1.7, 0.15], [2.0, 2.05, 0.5], [3.2, 2.1, 1.0], [4.3, 1.8, 1.6], [5.2, 1.25, 2.2], [5.9, 0.7, 2.7]],
  // Back over the island to the left.
  [[1.0, 2.3, 0.05], [0, 3.2, -0.6], [-1.6, 3.9, -1.0], [-3.2, 4.3, -1.2], [-4.6, 4.3, -1.0]],
  // Out overhead towards the viewer: the blossom that hangs into the top of the frame.
  [[1.1, 2.6, 0], [1.0, 3.6, 1.0], [0.6, 4.4, 2.2], [0.9, 4.9, 3.6], [2.0, 5.2, 4.8]],
  // Up and out to the right, well above the long bough, with open sky between them.
  [[1.12, 2.4, 0], [2.0, 3.3, -0.4], [2.9, 4.0, -0.8], [3.8, 4.4, -1.0]],
  // Away behind.
  [[0.9, 3.3, -0.3], [1.2, 4.3, -1.6], [1.8, 5.1, -2.8]],
];
// The crown is not one dome but separate pads of blossom, each on its limb, with sky
// between: centre, then half-extents, in the limbs' own coordinates.
const PADS = [
  [-0.3, 6.5, -0.8, 1.9, 0.8, 1.6], [0.9, 5.2, -0.4, 1.6, 0.7, 1.4], [-1.8, 5.3, -1.0, 1.8, 0.75, 1.5],
  [-3.2, 4.8, -1.2, 1.7, 0.7, 1.4], [-4.7, 4.6, -0.9, 1.3, 0.6, 1.1], [-1.5, 4.1, -0.9, 1.3, 0.55, 1.2],
  [0.3, 4.9, 2.3, 1.4, 0.6, 1.3], [0.9, 5.4, 3.9, 1.5, 0.65, 1.3], [2.3, 5.6, 5.0, 1.2, 0.55, 1.0],
  [2.9, 4.5, -0.8, 1.4, 0.6, 1.2], [4.0, 4.75, -1.0, 1.0, 0.5, 0.9], [1.7, 5.5, -2.8, 1.5, 0.65, 1.3],
  [2.4, 2.3, 0.7, 1.0, 0.42, 0.75], [3.7, 2.15, 1.3, 1.0, 0.42, 0.7], [4.8, 1.65, 1.95, 0.9, 0.4, 0.65], [5.75, 1.0, 2.6, 0.7, 0.36, 0.5],
];
const ATTRACTORS = 7600, INFLUENCE = 1.7, REACHED = 0.3;
const ROOTS = 7;
// Stubs where limbs broke off long ago: where on the tree, and which way they pointed.
const STUBS = [[[0.3, 0.95, 0.1], [-0.55, 0.45, 0.7]], [[0.95, 2.15, 0.05], [0.25, 0.25, 0.94]], [[2.5, 2.1, 0.72], [0.1, 0.85, 0.5]], [[-0.55, 3.45, -0.75], [-0.35, 0.3, 0.89]], [[1.0, 3.2, -0.2], [0.8, 0.35, 0.5]]];

export const LIMB_FLOATS = 11; // position, normal, bark (metres round, metres along, radius), flex, how much of the sky it sees
export const BLOSSOM_FLOATS = 13; // position, size, facing, spin, atlas cell, tint, flex, starlight / skylight
// Which cells of the blossom atlas hold what (see ATLAS_FRAG).
export const ATLAS = Object.freeze({ open: [0, 8], side: [8, 4], bud: [12, 3], petal: 15 });

const catmull = (a, b, c, d, t) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);

// Under 1 inside a pad of blossom, rising beyond it. Lumpy, so a pad is a cloud and not an
// egg, and ragged underneath, where sprays hang down in places.
function crownDepth(x, y, z) {
  let depth = 9;
  for (const [cx, cy, cz, rx, ry, rz] of PADS) {
    const hang = y < cy ? 1 + 0.9 * noise3(x * 1.4, 2.7, z * 1.4) : 1;
    depth = Math.min(depth, Math.hypot((x - cx) / rx, (y - cy) / (ry * hang), (z - cz) / rz));
  }
  return depth * (1 + 0.45 * (noise3(x * 0.9 + 7, y * 1.3, z * 0.9 + 2) - 0.5));
}

// Grows the tree and pours it into `light` as fog. The result is the skeleton as rings to
// skin, and every flower.
export function growTree(light) {
  const random = randomGenerator(SEED);
  const X = [], Y = [], Z = [], parent = [], radius = [], reach = [], sprouts = [];
  const node = (x, y, z, from, sprout = true) => {
    X.push(x); Y.push(y); Z.push(z); parent.push(from); sprouts.push(sprout);
    reach.push(from < 0 ? 0 : reach[from] + Math.hypot(x - X[from], y - Y[from], z - Z[from]));
    return X.length - 1;
  };
  const nearest = (x, y, z) => {
    let best = -1, distance = Infinity;
    for (let i = 0; i < X.length; i++) { const d = (X[i] - x) ** 2 + (Y[i] - y) ** 2 + (Z[i] - z) ** 2; if (d < distance) { distance = d; best = i; } }
    return best;
  };

  // --- The drawn limbs, as joints a STEP apart, a little gnarled.
  LIMBS.forEach((path, limb) => {
    const points = [path[0], ...path, path.at(-1)], dense = [];
    for (let s = 1; s < points.length - 2; s++) for (let k = 0; k < 24; k++)
      dense.push([0, 1, 2].map((axis) => catmull(points[s - 1][axis], points[s][axis], points[s + 1][axis], points[s + 2][axis], k / 24)));
    dense.push(path.at(-1));
    let from = limb === 0 ? -1 : nearest(...path[0]), travelled = 0, due = limb === 0 ? 0 : STEP, along = 0;
    for (let i = 0; i < dense.length; i++) {
      if (i > 0) travelled += Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1], dense[i][2] - dense[i - 1][2]);
      if (travelled < due) continue;
      due += STEP; along += STEP;
      const [x, y, z] = dense[i], gnarl = 0.22 * Math.min(1, along / 1.5) * (limb === 0 ? Math.min(1, Math.max(0, y - 1)) : 1);
      from = node(
        x + gnarl * (noise3(x * 0.9 + limb * 7, y * 0.9, z * 0.9) - 0.5), y + gnarl * (noise3(x * 0.9, y * 0.9 + limb * 7, z * 0.9 + 3) - 0.5), z + gnarl * (noise3(x * 0.9 + 5, y * 0.9, z * 0.9 + limb * 7) - 0.5),
        // Only some joints of a drawn limb put out branches, or they would stand along it like a comb.
        from, y > 1.9 && random() < 0.4,
      );
    }
  });

  // --- The crown: points scattered through it draw the branches towards them, each branch
  // growing a step at a time towards the points nearest to it until it has reached them.
  const attractors = [], volume = PADS.map(([, , , rx, ry, rz]) => rx * ry * rz), whole = volume.reduce((a, b) => a + b);
  while (attractors.length < ATTRACTORS) {
    let pick = random() * whole, pad = 0;
    while (pick > volume[pad]) pick -= volume[pad++];
    const [cx, cy, cz, rx, ry, rz] = PADS[pad];
    const x = cx + (random() * 2 - 1) * rx * 1.25, y = cy + (random() * 3.2 - 2.1) * ry, z = cz + (random() * 2 - 1) * rz * 1.25;
    const depth = crownDepth(x, y, z);
    if (depth < 1 && random() < 0.2 + 0.8 * smoothstep(0.3, 0.85, depth)) attractors.push([x, y, z]);
  }
  const cells = new Map(), cell = (v) => Math.floor(v / INFLUENCE) + 512, key = (cx, cy, cz) => (cx * 1024 + cy) * 1024 + cz;
  const file = (i) => { const k = key(cell(X[i]), cell(Y[i]), cell(Z[i])); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(i); };
  for (let i = 0; i < X.length; i++) if (sprouts[i]) file(i);
  for (let round = 0; round < 160 && attractors.length; round++) {
    const pulls = new Map();
    for (let a = attractors.length - 1; a >= 0; a--) {
      const [x, y, z] = attractors[a], cx = cell(x), cy = cell(y), cz = cell(z);
      let best = -1, distance = INFLUENCE * INFLUENCE;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const filed = cells.get(key(cx + dx, cy + dy, cz + dz));
        if (filed) for (const i of filed) {
          const d = (X[i] - x) ** 2 + (Y[i] - y) ** 2 + (Z[i] - z) ** 2;
          if (d < distance) { distance = d; best = i; }
        }
      }
      if (best < 0) continue;
      if (distance < REACHED * REACHED) { attractors[a] = attractors.at(-1); attractors.pop(); continue; }
      const d = Math.sqrt(distance), pull = pulls.get(best) || [0, 0, 0];
      pull[0] += (x - X[best]) / d; pull[1] += (y - Y[best]) / d; pull[2] += (z - Z[best]) / d;
      pulls.set(best, pull);
    }
    if (!pulls.size) break;
    for (const [i, pull] of pulls) {
      const l = Math.hypot(...pull) || 1, from = parent[i];
      // A branch keeps something of the way it was already going, and sags a little.
      let dx = pull[0] / l + random() * 0.24 - 0.12, dy = pull[1] / l - 0.08 + random() * 0.24 - 0.12, dz = pull[2] / l + random() * 0.24 - 0.12;
      if (from >= 0) { const pl = Math.hypot(X[i] - X[from], Y[i] - Y[from], Z[i] - Z[from]) || 1; dx += 0.45 * (X[i] - X[from]) / pl; dy += 0.45 * (Y[i] - Y[from]) / pl; dz += 0.45 * (Z[i] - Z[from]) / pl; }
      const dl = Math.hypot(dx, dy, dz) || 1, x = X[i] + dx / dl * STEP, y = Y[i] + dy / dl * STEP, z = Z[i] + dz / dl * STEP;
      // Not twice into the same place.
      let taken = false;
      for (const j of cells.get(key(cell(x), cell(y), cell(z))) || []) if ((X[j] - x) ** 2 + (Y[j] - y) ** 2 + (Z[j] - z) ** 2 < (STEP * 0.6) ** 2) { taken = true; break; }
      if (!taken) file(node(x, y, z, i));
    }
  }

  // --- Thickness: a branch is as thick as the twigs it carries need, so the trunk comes out
  // at BASE_RADIUS and every tip at TIP_RADIUS.
  const skeleton = X.length, tips = new Float64Array(skeleton), children = Array.from({ length: skeleton }, () => []);
  for (let i = skeleton - 1; i >= 0; i--) {
    if (!children[i].length) tips[i] = 1;
    if (parent[i] >= 0) { tips[parent[i]] += tips[i]; children[parent[i]].push(i); }
  }
  const power = Math.log(BASE_RADIUS / TIP_RADIUS) / Math.log(tips[0]);
  for (let i = 0; i < skeleton; i++) radius[i] = TIP_RADIUS * tips[i] ** power;
  // How far a joint swings in the wind: more the further out it is and the thinner.
  const flexOf = (i) => Math.min(1, Math.max(0, (reach[i] - 1.8) / 7)) ** 1.2 * (0.35 + 0.65 * (1 - smoothstep(0.01, 0.12, radius[i])));

  // --- Twigs: short shoots off every thin branch, which carry most of the blossom.
  let twigs = 0;
  for (let i = 1; i < skeleton; i++) {
    if (radius[i] > 0.04) continue;
    const from = parent[i], ax = X[i] - X[from], ay = Y[i] - Y[from], az = Z[i] - Z[from], al = Math.hypot(ax, ay, az) || 1;
    const shoot = (start, dx, dy, dz, joints, thick) => {
      let at = start;
      for (let k = 0; k < joints; k++) {
        dx += random() * 0.4 - 0.2; dy += random() * 0.4 - 0.2 - 0.035 * k; dz += random() * 0.4 - 0.2;
        const l = Math.hypot(dx, dy, dz) || 1;
        dx /= l; dy /= l; dz /= l;
        at = node(X[at] + dx * 0.11, Y[at] + dy * 0.11, Z[at] + dz * 0.11, at);
        radius[at] = thick * (1 - 0.5 * (k + 1) / joints);
        if (k === 1 && joints > 2 && random() < 0.4) shoot(at, dx + random() - 0.5, dy + random() * 0.6, dz + random() - 0.5, 2, thick * 0.7);
      }
    };
    // One shoot or two: out sideways from the branch, away from the trunk, and a little up.
    for (let shoots = random() < 0.45 ? 2 : 1; shoots > 0; shoots--) {
      const rx = random() * 2 - 1, ry = random() * 2 - 1, rz = random() * 2 - 1, along = (rx * ax + ry * ay + rz * az) / al;
      const ox = X[i], oz = Z[i], ol = Math.hypot(ox, oz) || 1;
      shoot(i, rx - along * ax / al + 0.4 * ax / al + 0.25 * ox / ol, ry - along * ay / al + 0.4 * ay / al + 0.3, rz - along * az / al + 0.4 * az / al + 0.25 * oz / ol, 2 + Math.floor(random() * 4), Math.min(0.0065, radius[i]));
      twigs++;
    }
  }
  const main = new Int32Array(X.length).fill(-1), flex = new Float32Array(X.length);
  for (let i = 1; i < X.length; i++) {
    const p = parent[i];
    if (main[p] < 0 || radius[i] > radius[main[p]]) main[p] = i;
    // A twig swings with the branch it grows from, and a little more.
    flex[i] = i < skeleton ? flexOf(i) : Math.min(1, flex[p] + 0.04);
  }

  // --- The skeleton as chains of rings to skin: each chain follows the thickest way on.
  const chains = [];
  for (let start = 0; start < X.length; start++) {
    if (start > 0 && main[parent[start]] === start) continue;
    const joints = [];
    for (let i = start; i >= 0; i = main[i]) joints.push(i);
    const rings = joints.map((i) => ({ x: TREE.x + X[i], y: FOOT + Y[i], z: TREE.z + Z[i], radius: radius[i], flex: flex[i] }));
    // A side branch starts inside the one it grows from, with a collar where it leaves.
    if (start > 0) { const p = parent[start]; rings.unshift({ x: TREE.x + X[p], y: FOOT + Y[p], z: TREE.z + Z[p], radius: Math.min(radius[p] * 0.9, radius[start] * 1.3), flex: rings[0].flex }); }
    if (rings.length > 1) chains.push({ rings, trunk: start === 0 });
  }
  // Stubs: each a short thick end sticking out of the limb nearest to where it was, snapped off ragged.
  for (const [[sx, sy, sz], [dx, dy, dz]] of STUBS) {
    let base = 0, distance = Infinity;
    for (let i = 0; i < skeleton; i++) { const d = (X[i] - sx) ** 2 + (Y[i] - sy) ** 2 + (Z[i] - sz) ** 2; if (d < distance) { distance = d; base = i; } }
    const thick = Math.min(0.075, radius[base] * 0.55), length = radius[base] + 0.12 + 0.12 * random();
    chains.push({
      trunk: false,
      rings: [0, 0.5, 0.85, 1, 1.04].map((t, k) => ({ x: TREE.x + X[base] + dx * length * t, y: FOOT + Y[base] + dy * length * t, z: TREE.z + Z[base] + dz * length * t, radius: thick * [1.25, 1, 0.92, 0.7, 0.15][k], flex: flex[base] })),
    });
  }
  // Roots: running out over the ground from the foot of the trunk, then under it.
  for (let k = 0; k < ROOTS; k++) {
    const angle = k / ROOTS * Math.PI * 2 + 0.3 + random() * 0.5, length = 1.5 + random() * 1.2, rings = [];
    for (let s = 0; s <= length; s += 0.12) {
      const a = angle + 0.35 * Math.sin(s * 2.1 + k), x = TREE.x + Math.cos(a) * (0.08 + s), z = TREE.z + Math.sin(a) * (0.08 + s);
      rings.push({ x, y: s === 0 ? FOOT + 0.3 : groundHeight(x, z) + 0.1 * Math.exp(-s / 0.6) - 0.01 - 0.12 * (s / length) ** 2, z, radius: 0.2 * Math.exp(-s / 0.8) + 0.014, flex: 0 });
    }
    chains.push({ rings, trunk: false });
  }

  // --- Blossom: clusters along every twig and thin branch, thicker on some boughs than others.
  const flowers = [];
  let bunch = [0, 0, 0], shade = 0;
  // Cherry flowers come in bunches, each on its own short stalks from one bud of the twig.
  const cluster = (i, bunches) => {
    const from = parent[i], thick = 0.3 + 0.7 * smoothstep(0.25, 0.55, noise3(X[i] * 0.5 + 11, Y[i] * 0.9, Z[i] * 0.5 + 4));
    for (let n = 0; n < bunches * 5; n++) {
      // Every fifth flower starts a new bunch, a little way out from the twig.
      if (n % 5 === 0) {
        const t = random(), bx = random() * 2 - 1, by = random() * 2 - 1.3, bz = random() * 2 - 1, bl = Math.hypot(bx, by, bz) || 1, out = 0.03 + 0.07 * random();
        bunch = [X[from] + (X[i] - X[from]) * t + bx / bl * out, Y[from] + (Y[i] - Y[from]) * t + by / bl * out, Z[from] + (Z[i] - Z[from]) * t + bz / bl * out];
        // A bunch is all much of a colour, and some boughs are paler than others.
        shade = 0.25 + 0.5 * random() + 0.6 * (noise3(X[i] * 0.45 + 3, Y[i] * 0.45, Z[i] * 0.45 + 8) - 0.5);
      }
      if (random() > thick) continue;
      const ox = random() * 2 - 1, oy = random() * 2 - 1, oz = random() * 2 - 1, ol = Math.hypot(ox, oy, oz) || 1, out = 0.012 + 0.03 * random();
      const x = TREE.x + bunch[0] + ox / ol * out, y = FOOT + bunch[1] + oy / ol * out, z = TREE.z + bunch[2] + oz / ol * out;
      // Flowers face out from their bunch, and hang a little.
      let nx = ox / ol + random() - 0.5, ny = oy / ol + random() - 0.5 - 0.25, nz = oz / ol + random() - 0.5;
      const nl = Math.hypot(nx, ny, nz) || 1, kind = random();
      const [first, cellCount] = kind < 0.1 ? ATLAS.bud : kind < 0.36 ? ATLAS.side : ATLAS.open;
      const size = (kind < 0.1 ? 0.028 : 0.038) + 0.022 * random();
      flowers.push(x, y, z, size, nx / nl, ny / nl, nz / nl, random() * Math.PI * 2, first + Math.floor(random() * cellCount), Math.min(1, Math.max(0, shade + 0.3 * (random() - 0.5))), Math.min(1, flex[i] + 0.08), 0, 0);
      light.add(x, y, z, 0.4 * size * size);
    }
  };
  for (let i = 1; i < X.length; i++) {
    if (i >= skeleton) cluster(i, 3);
    else if (radius[i] < 0.02) cluster(i, 2);
  }
  // The wood shades too. A thick limb is wider than a cell of the fog, so it is spread out.
  for (let i = 1; i < skeleton; i++) {
    const from = parent[i], length = Math.hypot(X[i] - X[from], Y[i] - Y[from], Z[i] - Z[from]), r = radius[i];
    const x = TREE.x + (X[i] + X[from]) / 2, y = FOOT + (Y[i] + Y[from]) / 2, z = TREE.z + (Z[i] + Z[from]) / 2, spread = r > 0.1 ? [-0.66, 0, 0.66] : [0];
    for (const dx of spread) for (const dz of spread) light.add(x + dx * r, y, z + dz * r, 2 * r * length / spread.length ** 2);
  }

  const blossoms = new Float32Array(flowers);
  // Where petals fall from: a scattering of the flowers.
  const sources = new Float32Array(Math.floor(blossoms.length / BLOSSOM_FLOATS / 24) * 3);
  for (let s = 0; s < sources.length / 3; s++) sources.set(blossoms.subarray(s * 24 * BLOSSOM_FLOATS, s * 24 * BLOSSOM_FLOATS + 3), s * 3);
  return { chains, blossoms, sources, joints: skeleton, twigs };
}

// Once the light has been worked out, each flower is told how much of it it gets.
export function lightBlossoms(blossoms, light) {
  for (let o = 0; o < blossoms.length; o += BLOSSOM_FLOATS) {
    const x = blossoms[o], y = blossoms[o + 1], z = blossoms[o + 2];
    blossoms[o + 11] = light.star(x, y, z); blossoms[o + 12] = light.sky(x, y, z);
  }
  return blossoms;
}

const sidesFor = (radius) => radius > 0.2 ? 40 : radius > 0.1 ? 24 : radius > 0.03 ? 8 : radius > 0.008 ? 5 : 3;
// Burrs on the old trunk: how far up it (metres along), which way round, and how big.
const BURRS = [[0.75, 1.1, 0.34], [1.5, 4.0, 0.42], [2.25, 2.3, 0.3], [3.1, 5.3, 0.36], [3.9, 0.6, 0.26]];
const wrapped = (a) => Math.abs(((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);

// Skin the chains: a tube round each, wider and buttressed where the trunk meets the ground.
export function buildLimbs(chains, light) {
  const vertices = [], index = [];
  chains.forEach(({ rings: joints, trunk }, chain) => {
    // Thick limbs are drawn through their joints as a curve, not as straight pieces.
    let rings = joints;
    if (joints[0].radius > 0.02) {
      rings = [];
      for (let i = 0; i < joints.length - 1; i++) {
        const a = joints[Math.max(0, i - 1)], b = joints[i], c = joints[i + 1], d = joints[Math.min(joints.length - 1, i + 2)];
        // The thicker the limb, the more its surface has to say, and the more rings it takes to say it.
        for (const t of joints[0].radius > 0.1 ? [0, 0.25, 0.5, 0.75] : [0, 0.5]) rings.push({ x: catmull(a.x, b.x, c.x, d.x, t), y: catmull(a.y, b.y, c.y, d.y, t), z: catmull(a.z, b.z, c.z, d.z, t), radius: b.radius + (c.radius - b.radius) * t, flex: b.flex + (c.flex - b.flex) * t });
      }
      rings.push(joints.at(-1));
    }
    const sides = sidesFor(joints[Math.min(1, joints.length - 1)].radius), first = vertices.length / LIMB_FLOATS, seed = chain * 3.7;
    let nx = 0, ny = 0, nz = 0, along = 0;
    const grid = [];
    for (let i = 0; i < rings.length; i++) {
      const ring = rings[i], before = rings[Math.max(0, i - 1)], after = rings[Math.min(rings.length - 1, i + 1)];
      let tx = after.x - before.x, ty = after.y - before.y, tz = after.z - before.z;
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      if (i === 0) { if (Math.abs(ty) < 0.9) { nx = 0; ny = 1; nz = 0; } else { nx = 1; ny = 0; nz = 0; } }
      else along += Math.hypot(ring.x - before.x, ring.y - before.y, ring.z - before.z);
      // Carry the ring's frame along the limb without twisting it.
      const dot = nx * tx + ny * ty + nz * tz;
      nx -= dot * tx; ny -= dot * ty; nz -= dot * tz;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
      const above = ring.y - FOOT;
      for (let j = 0; j <= sides; j++) {
        const a = j / sides * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        let r = ring.radius;
        if (r > 0.05) {
          // Old wood is not round. It is lumpy on the large scale, ridged along its length
          // where the bark has split into plates, and the grain winds slowly round the limb.
          const old = smoothstep(0.05, 0.2, r), wound = a + along * 0.45, wc = Math.cos(wound), ws = Math.sin(wound);
          const ridge = 1 - Math.abs(2 * noise3(wc * 2.6 + seed, ws * 2.6, along * 0.7) - 1);
          r *= 1 + 0.2 * (noise3(c * 1.3 + seed, s * 1.3, along * 1.6) - 0.5) + old * (0.2 * (ridge - 0.55) + 0.07 * (noise3(wc * 7 + seed, ws * 7, along * 2.4) - 0.5));
          if (trunk) for (const [up, round, size] of BURRS) r += ring.radius * size * Math.exp(-(((along - 0.5 - up) / 0.2) ** 2) - (wrapped(a - round) / 0.55) ** 2);
        }
        // The trunk flares into buttresses as it nears the ground.
        if (trunk) r *= 1 + 0.9 * Math.exp(-Math.max(above, 0) / 0.32) * (0.5 + 0.5 * (0.5 + 0.5 * Math.cos(a * ROOTS + 1.3)) ** 2);
        grid.push([ring.x + r * (c * nx + s * bx), ring.y + r * (c * ny + s * by), ring.z + r * (c * nz + s * bz), a * ring.radius, along, ring.radius, ring.flex]);
      }
    }
    const at = (i, j) => grid[Math.min(rings.length - 1, Math.max(0, i)) * (sides + 1) + (j + sides) % sides];
    for (let i = 0; i < rings.length; i++) for (let j = 0; j <= sides; j++) {
      const p = grid[i * (sides + 1) + j], l = at(i, j - 1), r = at(i, j + 1), d = at(i - 1, j), u = at(i + 1, j);
      const ax = r[0] - l[0], ay = r[1] - l[1], az = r[2] - l[2], bx = u[0] - d[0], by = u[1] - d[1], bz = u[2] - d[2];
      let x = ay * bz - az * by, y = az * bx - ax * bz, z = ax * by - ay * bx;
      const len = Math.hypot(x, y, z) || 1;
      x /= len; y /= len; z /= len;
      // The sky it sees is the sky the air just off the bark sees, or the limb would hide it from itself.
      const off = p[5] + 0.14, qx = p[0] + x * off, qy = Math.max(0.05, p[1] + y * off), qz = p[2] + z * off;
      vertices.push(p[0], p[1], p[2], x, y, z, p[3], p[4], p[5], p[6], light.sky(qx, qy, qz));
    }
    for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < sides; j++) {
      const a = first + i * (sides + 1) + j, b = a + sides + 1;
      index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  });
  return { vertices: new Float32Array(vertices), index: new Uint32Array(index) };
}
