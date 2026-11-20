import { POLE_STAR } from './site.js';

// How much of the pole star's light and the sky's reaches each point inside the tree's crown and
// under it. Shadows on solid things are cast properly (see the shadow map in render.js);
// this is for what light does inside a mass of thin petals, where it is not stopped but thinned. The lights never
// move, so this is worked out once: the crown is poured into a grid of cells as fog of the
// right thickness, and the light is carried through it.
const CELL = 0.125;
const BOUNDS = { x0: -6, y0: 0, z0: -6.4, x1: 12, y1: 8.8, z1: 7.2 };
const NX = Math.round((BOUNDS.x1 - BOUNDS.x0) / CELL), NY = Math.round((BOUNDS.y1 - BOUNDS.y0) / CELL), NZ = Math.round((BOUNDS.z1 - BOUNDS.z0) / CELL);
// Where the sky's own light comes from: straight up, and a ring of five lower down.
const SKY = [[0, 1, 0], ...Array.from({ length: 5 }, (_, i) => { const a = i / 5 * Math.PI * 2 + 0.3; return [0.64 * Math.cos(a), 0.77, 0.64 * Math.sin(a)]; })];

export function createLight() {
  // Optical depth of each cell, for a ray crossing it straight.
  const fog = new Float32Array(NX * NY * NZ);
  const cellOf = (x, y, z) => {
    const i = Math.floor((x - BOUNDS.x0) / CELL), j = Math.floor((y - BOUNDS.y0) / CELL), k = Math.floor((z - BOUNDS.z0) / CELL);
    return i < 0 || j < 0 || k < 0 || i >= NX || j >= NY || k >= NZ ? -1 : (j * NZ + k) * NX + i;
  };
  // Something of silhouette `area` (square metres) at a point: a flower, or a length of branch.
  function add(x, y, z, area) {
    const c = cellOf(x, y, z);
    if (c >= 0) fog[c] += area / (CELL * CELL);
  }

  // Light arriving from a distant source in direction `towards`, carried down layer by layer.
  function carry(towards) {
    const field = new Float32Array(fog.length), sx = towards[0] / towards[1], sz = towards[2] / towards[1], thicken = 1 / towards[1];
    const leaving = new Float32Array(NX * NZ).fill(1), next = new Float32Array(NX * NZ);
    const at = (a, b) => a < 0 || b < 0 || a >= NX || b >= NZ ? 1 : leaving[b * NX + a];
    for (let j = NY - 1; j >= 0; j--) {
      for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) {
        // The light reaching this cell left the layer above one step towards the source.
        const u = i + sx, v = k + sz, i0 = Math.floor(u), k0 = Math.floor(v), fu = u - i0, fv = v - k0;
        const arriving = j === NY - 1 ? 1 : (at(i0, k0) * (1 - fu) + at(i0 + 1, k0) * fu) * (1 - fv) + (at(i0, k0 + 1) * (1 - fu) + at(i0 + 1, k0 + 1) * fu) * fv;
        const c = (j * NZ + k) * NX + i;
        field[c] = arriving;
        next[k * NX + i] = arriving * Math.exp(-fog[c] * thicken);
      }
      leaving.set(next);
    }
    return field;
  }

  function reader(field, outside) {
    return (x, y, z) => {
      const u = (x - BOUNDS.x0) / CELL - 0.5, v = (y - BOUNDS.y0) / CELL - 0.5, w = (z - BOUNDS.z0) / CELL - 0.5;
      if (u < 0 || w < 0 || u > NX - 1 || w > NZ - 1 || v > NY - 1) return outside;
      const i = Math.min(NX - 2, Math.floor(u)), j = Math.min(NY - 2, Math.max(0, Math.floor(v))), k = Math.min(NZ - 2, Math.floor(w));
      const fu = u - i, fv = Math.min(1, Math.max(0, v - j)), fw = w - k, c = (j * NZ + k) * NX + i, up = NZ * NX;
      const row = (o) => field[o] * (1 - fu) + field[o + 1] * fu;
      return (row(c) * (1 - fw) + row(c + NX) * fw) * (1 - fv) + (row(c + up) * (1 - fw) + row(c + up + NX) * fw) * fv;
    };
  }

  const light = { add, star: () => 1, sky: () => 1 };
  // Called once the whole tree has been poured in.
  light.bake = () => {
    light.star = reader(carry(POLE_STAR), 1);
    const sky = new Float32Array(fog.length);
    for (const direction of SKY) { const field = carry(direction); for (let c = 0; c < sky.length; c++) sky[c] += field[c] / SKY.length; }
    light.sky = reader(sky, 1);
  };
  return light;
}
