import { register } from 'node:module';
import assert from 'node:assert/strict';

register('./three-loader.mjs', import.meta.url);
const THREE = await import('three');
const { createEnvironment, ROCKS } = await import('../src/environment.js');

// The contact-shadow canvas is generated locally. Any attempt to load an image
// fails here, so this builds the whole environment without an asset service.
THREE.TextureLoader.prototype.load = () => { throw new Error('External image requested'); };
globalThis.document = {
  createElement(name) {
    assert.equal(name, 'canvas');
    return {
      getContext() {
        return {
          createRadialGradient: () => ({ addColorStop() {} }),
          fillRect() {},
        };
      },
    };
  },
};

const scene = new THREE.Scene();
const { obstacles, landmarks } = createEnvironment(scene);
assert(obstacles.length > ROCKS.length, 'Fish need wood obstacles in addition to the stones');
for (const obstacle of obstacles) {
  assert(obstacle.radius > 0 && Number.isFinite(obstacle.radius));
  assert(obstacle.center.toArray().every(Number.isFinite));
}
assert(landmarks.some((landmark) => landmark.kind === 'wood'));
assert(landmarks.some((landmark) => landmark.kind === 'rock'));
const materials = new Set();
scene.traverse((object) => {
  if (!object.isMesh) return;
  for (const attribute of Object.values(object.geometry.attributes)) {
    for (const value of attribute.array) assert(Number.isFinite(value));
  }
  for (const index of object.geometry.index?.array ?? [])
    assert(index < object.geometry.attributes.position.count);
  const material = object.material;
  materials.add(material);
  assert.equal(material.normalMap ?? null, null);
  assert.equal(material.bumpMap ?? null, null);
  if (material.map) assert(material.map.isCanvasTexture, 'Only generated contact shadows use a map');
});
const surfaces = [...materials].filter((material) => material.customProgramCacheKey().startsWith('procedural-mossy-'));
assert.equal(surfaces.length, 4, 'Sand, stone, pale stone and wood each have a procedural surface');
assert.equal(new Set(surfaces.map((material) => material.customProgramCacheKey())).size, 3,
  'The renderer must distinguish stone, wood and sand programs');
console.log(`PASS: asset-free riverbed; ${scene.children.length} meshes, finite geometry, fish obstacles and distinct surface programs`);
