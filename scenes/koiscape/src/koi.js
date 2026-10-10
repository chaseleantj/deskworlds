import * as THREE from 'three';

// A koi in its own space, before the backbone bends it: `s` runs from the nose (0) to where the
// tail fin begins (1), `a` is sideways and `b` is up, all in body lengths. The shaders place
// each vertex on the live backbone by its `s`.

// Half width seen from above, and half depth seen from the side, down the length of the body: a
// broad, blunt head, the shoulders fullest a third of the way back, and a long taper to a narrow
// but deep wrist in front of the tail.
const WIDTH = [[0, 0], [0.004, 0.026], [0.014, 0.044], [0.032, 0.06], [0.06, 0.074], [0.095, 0.085], [0.14, 0.094], [0.2, 0.105], [0.27, 0.114], [0.35, 0.12], [0.43, 0.119], [0.52, 0.111], [0.62, 0.096], [0.72, 0.076], [0.81, 0.057], [0.89, 0.042], [0.95, 0.034], [1, 0.032]];
const DEPTH = [[0, 0], [0.004, 0.02], [0.015, 0.036], [0.04, 0.057], [0.08, 0.079], [0.14, 0.103], [0.22, 0.123], [0.32, 0.136], [0.42, 0.135], [0.52, 0.125], [0.62, 0.107], [0.72, 0.086], [0.82, 0.067], [0.9, 0.057], [0.96, 0.054], [1, 0.054]];
// The head sits low, the snout below the line of the back, which rises to its highest ahead of the dorsal fin.
const CENTRE = [[0, -0.034], [0.05, -0.027], [0.12, -0.016], [0.25, -0.003], [0.4, 0], [0.7, 0.003], [1, 0.005]];

// Smooth interpolation through a table of [s, value] pairs.
function curve(table) {
  return (s) => {
    if (s <= table[0][0]) return table[0][1];
    for (let i = 1; i < table.length; i++) {
      if (s > table[i][0]) continue;
      const [s0, v0] = table[i - 1], [s1, v1] = table[i];
      const before = table[Math.max(0, i - 2)], after = table[Math.min(table.length - 1, i + 1)];
      const t = (s - s0) / (s1 - s0), h = s1 - s0;
      const m0 = i > 1 ? (v1 - before[1]) / (s1 - before[0]) * h : (v1 - v0), m1 = i < table.length - 1 ? (after[1] - v0) / (after[0] - s0) * h : (v1 - v0);
      const t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * m1;
    }
    return table[table.length - 1][1];
  };
}
export const halfWidth = curve(WIDTH), halfDepth = curve(DEPTH), centre = curve(CENTRE);
const smoothstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
export const backHeight = (s) => centre(s) + halfDepth(s);

export const FINS = {
  pectoral: { root: 0.215, out: 0.078, drop: -0.072, length: 0.2, fan: 0.95 },
  pelvic: { root: 0.5, out: 0.055, drop: -0.105, length: 0.12, fan: 0.6 },
  dorsal: { from: 0.38, to: 0.72, height: 0.085 },
  caudal: { from: 0.97, centre: 0.15, lobe: 0.29, root: 0.052, span: 0.19 },
};

export function bodyGeometry(rings = 110, around = 48) {
  const positions = [], uvs = [], index = [];
  const at = (i, j) => i * (around + 1) + j;
  for (let i = 0; i <= rings; i++) {
    // Rings crowd toward the nose, where the outline curves fastest.
    const s = Math.pow(i / rings, 1.45);
    const w = halfWidth(s), d = halfDepth(s), c = centre(s);
    // The skull is broad and flat on top; the body behind it is an egg in section, narrower over
    // the back than across the belly, so the back reads as a soft ridge from above.
    const flat = 1 - 0.28 * Math.max(0, 1 - s / 0.2);
    const taper = 0.2 * smoothstep(0.15, 0.5, s);
    for (let j = 0; j <= around; j++) {
      const v = (j / around) * 2 - 1;                    // -1..1 around, 0 on the back
      const phi = v * Math.PI;
      const sin = Math.sin(phi), cos = Math.cos(phi);
      // The eyes sit on the sides of the skull a little above its middle, and bulge just past
      // its outline, which is how they show from above.
      const eye = Math.exp(-(((s - 0.098) / 0.02) ** 2) - (((Math.abs(phi) - 1.28) / 0.3) ** 2));
      // A slight step where the gill cover overlaps the body behind it.
      const gill = smoothstep(0.012, 0, Math.abs(s - (0.205 - 0.04 * (1 - Math.cos(phi)) * 0.5))) * Math.sin(Math.abs(phi)) ** 2;
      const a = w * sin * (1 - taper * cos) / (1 + taper * 0.08) + Math.sign(sin) * (0.009 * eye + 0.0025 * gill);
      const b = c + d * cos * (cos > 0 ? flat : 0.96) + 0.004 * eye;
      positions.push(s, a, b);
      uvs.push(s, v);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < around; j++) {
    index.push(at(i, j), at(i + 1, j), at(i, j + 1), at(i, j + 1), at(i + 1, j), at(i + 1, j + 1));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  // Normals must point out of the fish whichever way the rings happened to wind.
  if (geometry.attributes.normal.getZ(at(rings >> 1, around >> 1)) < 0) {
    const n = geometry.attributes.normal.array;
    for (let i = 0; i < n.length; i++) n[i] = -n[i];
    for (let i = 0; i < index.length; i += 3) { const t = index[i + 1]; index[i + 1] = index[i + 2]; index[i + 2] = t; }
    geometry.setIndex(index);
  }
  // The seam under the belly and the pinched nose share positions; average their normals.
  const normal = geometry.attributes.normal;
  for (let i = 0; i <= rings; i++) {
    const p = at(i, 0), q = at(i, around);
    const x = normal.getX(p) + normal.getX(q), y = normal.getY(p) + normal.getY(q), z = normal.getZ(p) + normal.getZ(q);
    const n = Math.hypot(x, y, z) || 1;
    normal.setXYZ(p, x / n, y / n, z / n); normal.setXYZ(q, x / n, y / n, z / n);
  }
  for (let j = 0; j <= around; j++) normal.setXYZ(at(0, j), -1, 0, 0);
  return geometry;
}

// Every fin of one fish in a single mesh. `aFin` is (kind, side, r, q): r runs from the fin's
// root to its edge, q across it. `position` is the point on the body the fin grows from, and
// `aShape` carries what the shader needs to lay the membrane out from there.
export const FIN = { pectoral: 0, pelvic: 1, dorsal: 2, caudal: 3, barbel: 4 };

export function finGeometry() {
  const positions = [], fins = [], shapes = [], index = [];
  let base = 0;
  function grid(nr, nq, each) {
    for (let i = 0; i <= nr; i++) for (let j = 0; j <= nq; j++) each(i / nr, (j / nq) * 2 - 1);
    for (let i = 0; i < nr; i++) for (let j = 0; j < nq; j++) {
      const p = base + i * (nq + 1) + j;
      index.push(p, p + nq + 1, p + 1, p + 1, p + nq + 1, p + nq + 2);
    }
    base += (nr + 1) * (nq + 1);
  }
  // Paired fins fan out from a hinge on the flank.
  for (const [kind, fin] of [[FIN.pectoral, FINS.pectoral], [FIN.pelvic, FINS.pelvic]]) {
    for (const side of [-1, 1]) {
      grid(10, 14, (r, q) => {
        positions.push(fin.root, side * fin.out, fin.drop);
        fins.push(kind, side, r, q);
        shapes.push(fin.length, fin.fan, 0);
      });
    }
  }
  // The dorsal fin stands along the back: tall at the front, sloping away behind.
  grid(6, 40, (r, q) => {
    const t = q * 0.5 + 0.5, s = FINS.dorsal.from + (FINS.dorsal.to - FINS.dorsal.from) * t;
    const rise = Math.min(1, t / 0.07), height = FINS.dorsal.height * rise * (1 - 0.62 * t) * (1 - 0.5 * Math.pow(t, 6));
    positions.push(s, 0, backHeight(s) - 0.004);
    fins.push(FIN.dorsal, 0, r, q);
    shapes.push(height, 0.05 * r, 0);          // height, and how far the rays rake back
  });
  // The tail fin: two lobes and a shallow fork.
  grid(14, 24, (r, q) => {
    const fin = FINS.caudal, reach = fin.centre + (fin.lobe - fin.centre) * Math.pow(Math.abs(q), 1.5);
    positions.push(fin.from, 0, 0);
    fins.push(FIN.caudal, 0, r, q);
    shapes.push(reach, fin.root, fin.span);
  });
  // Two pairs of barbels at the corners of the mouth.
  for (const side of [-1, 1]) for (const pair of [0, 1]) {
    grid(6, 2, (r, q) => {
      positions.push(0.018 + pair * 0.022, side * (0.03 + pair * 0.016), -0.045);
      fins.push(FIN.barbel, side, r, q);
      shapes.push(0.04 + pair * 0.03, 0.0042, pair);
    });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aFin', new THREE.Float32BufferAttribute(fins, 4));
  geometry.setAttribute('aShape', new THREE.Float32BufferAttribute(shapes, 3));
  geometry.setIndex(index);
  return geometry;
}

// Colour and pattern for each variety. `pattern` picks the rule in the body shader; the three
// colours are ground, hi (the red) and sumi (the black), in linear light.
const WHITE = [0.8, 0.78, 0.71], RED = [0.7, 0.036, 0.011], ORANGE = [0.76, 0.07, 0.014], BLACK = [0.009, 0.01, 0.013];
export const VARIETIES = {
  kohaku: { pattern: 0, ground: WHITE, hi: ORANGE, sumi: BLACK, metal: 0, cover: 0.52 },
  sanke: { pattern: 1, ground: WHITE, hi: RED, sumi: BLACK, metal: 0, cover: 0.46 },
  showa: { pattern: 2, ground: WHITE, hi: RED, sumi: BLACK, metal: 0, cover: 0.5 },
  utsuri: { pattern: 3, ground: [0.84, 0.83, 0.79], hi: WHITE, sumi: BLACK, metal: 0, cover: 0.5 },
  ogon: { pattern: 4, ground: [0.8, 0.42, 0.04], hi: [0.95, 0.66, 0.16], sumi: BLACK, metal: 1, cover: 0 },
  chagoi: { pattern: 5, ground: [0.11, 0.06, 0.022], hi: [0.3, 0.19, 0.08], sumi: [0.04, 0.025, 0.012], metal: 0.15, cover: 0 },
  tancho: { pattern: 6, ground: WHITE, hi: RED, sumi: BLACK, metal: 0, cover: 0 },
};

// Lily pad: a disc cut by one notch to its centre. Vertex x is the angle around (0..1 between
// the two sides of the notch) and y the distance out from the stem (0..1).
export function padGeometry(spokes = 72, rings = 7) {
  const positions = [], index = [];
  for (let i = 0; i <= spokes; i++) for (let j = 0; j <= rings; j++) positions.push(i / spokes, j / rings, 0);
  for (let i = 0; i < spokes; i++) for (let j = 0; j < rings; j++) {
    const p = i * (rings + 1) + j;
    index.push(p, p + 1, p + rings + 1, p + 1, p + rings + 2, p + rings + 1);
  }
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  return geometry;
}

// One petal: x across (-1..1), y from base to tip (0..1).
export function petalGeometry(across = 6, along = 10) {
  const positions = [], index = [];
  for (let i = 0; i <= along; i++) for (let j = 0; j <= across; j++) positions.push((j / across) * 2 - 1, i / along, 0);
  for (let i = 0; i < along; i++) for (let j = 0; j < across; j++) {
    const p = i * (across + 1) + j;
    index.push(p, p + 1, p + across + 1, p + 1, p + across + 2, p + across + 1);
  }
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  return geometry;
}
