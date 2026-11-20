// Value noise the island, its rocks and the tree are shaped with. It has no state: the same
// point always gives the same value, so the place is the same on every visit.
function hash(x, y, z) {
  let n = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x9e3779b1);
  n = Math.imul(n ^ (n >>> 15), 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

const fade = (t) => t * t * (3 - 2 * t);
const mix = (a, b, t) => a + (b - a) * t;

// 0 to 1, smooth, with features about one unit across.
export function noise3(x, y = 0, z = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = fade(x - ix), fy = fade(y - iy), fz = fade(z - iz);
  const at = (dx, dy, dz) => hash(ix + dx, iy + dy, iz + dz);
  return mix(
    mix(mix(at(0, 0, 0), at(1, 0, 0), fx), mix(at(0, 1, 0), at(1, 1, 0), fx), fy),
    mix(mix(at(0, 0, 1), at(1, 0, 1), fx), mix(at(0, 1, 1), at(1, 1, 1), fx), fy),
    fz,
  );
}

// 0 to 1: `octaves` layers of noise3, each twice as fine and half as strong.
export function fbm3(x, y = 0, z = 0, octaves = 4) {
  let sum = 0, weight = 0, amplitude = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * noise3(x, y, z);
    weight += amplitude;
    x = x * 2.03 + 11.7; y = y * 2.03 + 5.3; z = z * 2.03 + 7.9;
    amplitude *= 0.5;
  }
  return sum / weight;
}

export const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
