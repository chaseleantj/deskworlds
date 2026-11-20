import assert from 'node:assert/strict';
import { createLight } from '../src/light.js';
import { growTree, lightBlossoms, buildLimbs, BLOSSOM_FLOATS, LIMB_FLOATS, ATLAS } from '../src/tree.js';
import { TREE, POLE_STAR, groundHeight } from '../src/site.js';

const light = createLight(), tree = growTree(light);
light.bake();
const flowers = tree.blossoms.length / BLOSSOM_FLOATS;

// The tree is always the same tree, and a full one.
{
  const again = growTree(createLight());
  assert.equal(again.blossoms.length, tree.blossoms.length, 'The same tree every time');
  assert.deepEqual([...again.blossoms.subarray(0, 300)], [...tree.blossoms.subarray(0, 300)], 'Flower for flower');
  assert.ok(flowers > 120000 && flowers < 220000, `In full blossom, within what the GPU is asked to draw (${flowers} flowers)`);
  assert.ok(tree.sources.length / 3 > 1000, 'Plenty of places for petals to fall from');
}

// The shape the picture depends on: most of the crown swept back over the island, and one
// long bough reaching far out the other way, low over the water. Every flower is a real
// cell of the atlas.
{
  let left = 0, right = 0, lowest = 99, over = 0, back = 0;
  for (let o = 0; o < tree.blossoms.length; o += BLOSSOM_FLOATS) {
    const [x, y, z, size, nx, ny, nz, , cell] = tree.blossoms.subarray(o, o + BLOSSOM_FLOATS);
    left = Math.min(left, x - TREE.x); right = Math.max(right, x - TREE.x);
    if (x - TREE.x > 4) { over++; lowest = Math.min(lowest, y); } else if (x - TREE.x < 1.5) back++;
    assert.ok(y > 0.2 || groundHeight(x, z) < 0, 'No blossom on the ground');
    assert.ok(size > 0.02 && size < 0.08, 'Flowers are flower-sized');
    assert.ok(Math.abs(Math.hypot(nx, ny, nz) - 1) < 1e-3, 'Each faces somewhere');
    assert.ok(Number.isInteger(cell) && cell >= 0 && cell < ATLAS.petal, 'Each is drawn from a flower or a bud, never the loose petal');
  }
  assert.ok(right > 5.5 && left < -4, `The crown spreads wide (${left.toFixed(1)} to ${right.toFixed(1)} m)`);
  assert.ok(lowest < 1.3 && lowest > 0.15, `The long bough comes down close to the lake without touching it (${lowest.toFixed(2)} m)`);
  assert.ok(back > 2.5 * over && over > 4000, 'Most of the blossom is back over the island; the bough is the smaller part');
}

// The wood: a heavy trunk tapering to fine twigs, and no branch thicker than where it began.
{
  const trunk = tree.chains.find((chain) => chain.trunk);
  assert.ok(trunk.rings[0].radius > 0.3, 'A heavy trunk');
  const fork = trunk.rings.find((ring) => ring.y > groundHeight(TREE.x, TREE.z) + 1.7);
  assert.ok(fork.x - TREE.x > 0.5, 'It leans out over the water');
  assert.ok(trunk.rings[0].y < groundHeight(TREE.x, TREE.z), 'Rooted below the ground');
  for (const { rings } of tree.chains) {
    for (let i = 2; i < rings.length; i++) assert.ok(rings[i].radius <= rings[i - 1].radius + 1e-9, 'A branch only tapers');
    for (const ring of rings) assert.ok(ring.flex >= 0 && ring.flex <= 1, 'Sway is a share of the whole');
  }
  assert.equal(trunk.rings[0].flex, 0, 'The foot of the trunk does not move');
  const limbs = buildLimbs(tree.chains, light);
  assert.ok(limbs.index.length / 3 < 400000, 'The wood stays within its share of the frame');
  for (let v = 0; v < limbs.vertices.length; v += LIMB_FLOATS) assert.ok(Number.isFinite(limbs.vertices[v] + limbs.vertices[v + 3] + limbs.vertices[v + 10]), 'No broken vertex');
}

// The light: the pole star stands behind the tree, low in the sky, so the far side of each
// pad of blossom is lit and the side towards the viewer is in its shade.
{
  assert.ok(POLE_STAR[2] < -0.5 && POLE_STAR[1] > 0.2 && POLE_STAR[1] < 0.7, 'The pole star is behind the tree, and low enough to be in the picture');
  assert.equal(light.star(20, 1, 20), 1, 'Starlight out on the lake');
  assert.ok(light.sky(TREE.x - 1.5, groundHeight(TREE.x - 1.5, TREE.z - 0.5) + 0.1, TREE.z - 0.5) < 0.8 && light.sky(15, 1, 15) === 1, 'Less of the sky under the crown, all of it over the open lake');
  lightBlossoms(tree.blossoms, light);
  let lit = 0, shaded = 0;
  for (let o = 0; o < tree.blossoms.length; o += BLOSSOM_FLOATS) {
    if (tree.blossoms[o + 11] > 0.7) lit++; else if (tree.blossoms[o + 11] < 0.25) shaded++;
    assert.ok(tree.blossoms[o + 11] >= 0 && tree.blossoms[o + 11] <= 1 && tree.blossoms[o + 12] >= 0 && tree.blossoms[o + 12] <= 1, 'Light is a share of the whole');
  }
  assert.ok(lit / flowers > 0.15 && shaded / flowers > 0.15, `Bright rims and dark hearts: ${(100 * lit / flowers).toFixed(0)}% lit, ${(100 * shaded / flowers).toFixed(0)}% in shade`);
}
console.log(`PASS: a leaning cherry of ${flowers} flowers on ${tree.joints} joints and ${tree.twigs} twigs, lit from behind by the pole star`);
