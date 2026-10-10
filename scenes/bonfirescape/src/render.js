import * as THREE from 'three';
import {
  NOISE, HEAT, SURFACE_VERT_PARS, SURFACE_VERT, SURFACE_FRAG_PARS, GROUND, WOOD_PARS, WOOD, WOOD_BAKE_VERT, WOOD_BAKE_FRAG, LOGS, RUBBLE, SWORD, BONE, GRASS,
  FULLSCREEN_VERT, FLAME_FRAG, GROUND_BAKE, SPARK_VERT, SPARK_FRAG, COMPOSITE_FRAG, DOWN_FRAG, UP_FRAG, OUTPUT_FRAG,
} from './shaders.js';
import { buildWorld } from './world.js';
import { SPARKS, SPARK_FLOATS, FLICKER } from './fire.js';

const V3 = THREE.Vector3;
// The camera stands a few paces back at about kneeling height, looking a little down at the fire.
export const HOME = { fov: 30, eye: new V3(0, 0.95, 4.3), target: new V3(0, 0.88, 0), halfHeight: 1.08, halfWidth: 1.0 };
const LEVELS = 6;
const BLOOM = { weights: [0.5, 0.15, 0.04, 0.01, 0.0], gain: 0.025 };
const EXPOSURE = 1.15;
// The flame is soft enough to march at reduced resolution and filter up.
const FLAME_SCALE = 0.6;
// Firelight is a few thousand kelvin: deep orange, a little yellower in the bright core.
// Where the flames rise from: [x, z, radius, height] for each tongue.
const SOURCES = [
  [-0.06, 0.03, 0.13, 0.92], [-0.16, 0.07, 0.09, 0.55], [0.07, -0.02, 0.1, 0.76], [0.0, 0.13, 0.08, 0.45],
  [-0.08, -0.12, 0.08, 0.62], [0.15, 0.06, 0.06, 0.38], [-0.21, -0.04, 0.06, 0.32],
];
const FIRE_LIGHT = new THREE.Color().setRGB(1.0, 0.5, 0.22, THREE.LinearSRGBColorSpace);

// Point-light shadows filtered with five taps, not three.js's nine: the centre and four
// alternate corners of the cube it samples around. The penumbrae are wide and soft, so the
// coarser filter hardly shows, and every lit pixel pays for it once per light.
const SHADOW_FILTER = (() => {
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment, at = chunk.indexOf('vec2 offset = vec2( - 1, 1 )');
  const point = chunk.slice(at)
    .replace(/\t*texture2DCompare\( shadowMap, cubeToUV\( bd3D \+ offset\.(xyy|yyx|xxx|yxy), texelSize\.y \), dp \) \+\n/g, '')
    .replace('( 1.0 / 9.0 )', '( 1.0 / 5.0 )');
  return chunk.slice(0, at) + point;
})();

function patched(name, fragment, { axis = false, uniforms }) {
  const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  // Three caches programs by the patch function's source, which is the same for every surface.
  material.customProgramCacheKey = () => name;
  if (axis) material.defines = { HAS_AXIS: '' };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmap_pars_fragment>', SHADOW_FILTER);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SURFACE_VERT_PARS}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${SURFACE_VERT}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${SURFACE_FRAG_PARS}\n${NOISE}\n${HEAT}\n${fragment}`)
      .replace('#include <map_fragment>', '#include <map_fragment>\nSurface S = surface();\ndiffuseColor.rgb = S.albedo;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = S.rough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = S.metal;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(S.normal, 0.0)).xyz);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = S.emissive;');
  };
  return material;
}

export function createRenderer(canvas, fire) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(HOME.fov, 1, 0.1, 60);
  const shared = { uTime: { value: 0 }, uEnergy: { value: 1 }, uBlaze: { value: 1 } };

  const world = buildWorld();
  const mesh = (geometry, material, { cast = true, receive = true } = {}) => {
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = cast; m.receiveShadow = receive;
    scene.add(m);
    return m;
  };
  // The ground's fine detail is baked once into a mipmapped texture.
  const groundMap = new THREE.WebGLRenderTarget(2048, 2048, {
    type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
  });
  groundMap.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  mesh(world.ground, patched('ground', GROUND, { uniforms: { ...shared, uGroundMap: { value: groundMap.texture } } }), { cast: false });
  // The logs' detail is costly and fixed, so it is drawn once into a per-pixel cache (the
  // front-most log's normal, height and crack; its cell, burn, ash and key) and redrawn only
  // when the view changes.
  const wood = new THREE.WebGLRenderTarget(1, 1, { count: 2, type: THREE.HalfFloatType });
  wood.textures[1].type = THREE.UnsignedByteType;
  let woodStale = true;
  mesh(world.logs, patched('logs', `${WOOD_PARS}\n${LOGS}`, { axis: true, uniforms: { ...shared, uWood: { value: wood.textures } } }));
  const woodScene = new THREE.Scene();
  woodScene.add(new THREE.Mesh(world.logs, new THREE.ShaderMaterial({
    defines: { HAS_AXIS: '' }, vertexShader: WOOD_BAKE_VERT,
    fragmentShader: `${SURFACE_FRAG_PARS}\n${NOISE}\n${WOOD_PARS}\n${WOOD}\n${WOOD_BAKE_FRAG}`,
  })));
  mesh(world.rubble, patched('rubble', RUBBLE, { uniforms: shared }));
  mesh(world.sword, patched('sword', SWORD, { axis: true, uniforms: shared }));
  mesh(world.bones, patched('bone', BONE, { axis: true, uniforms: shared }));
  const grass = patched('grass', GRASS, { uniforms: shared });
  grass.side = THREE.DoubleSide;
  mesh(world.grass, grass);

  // Firelight: three shadowed lights wandering through the flames stand in for one large, soft
  // source; a fourth, low and unshadowed, is the glow of the coals.
  const lights = [0, 1, 2].map(() => {
    const light = new THREE.PointLight(FIRE_LIGHT, 1, 0, 2);
    light.castShadow = true;
    light.shadow.mapSize.set(512, 512);
    light.shadow.camera.near = 0.03;
    light.shadow.camera.far = 20;
    light.shadow.bias = -0.0015;
    light.shadow.normalBias = 0.01;
    light.shadow.radius = 8;
    light.shadow.blurSamples = 16;
    light.shadow.autoUpdate = false;
    scene.add(light);
    return light;
  });
  const coals = new THREE.PointLight(new THREE.Color().setRGB(1, 0.28, 0.06, THREE.LinearSRGBColorSpace), 1, 0, 2);
  coals.position.set(0, 0.32, 0);
  scene.add(coals);
  scene.add(new THREE.HemisphereLight(new THREE.Color().setRGB(0.05, 0.06, 0.09), 0x000000, 0.04));

  // Sparks.
  const sparkGeometry = new THREE.InstancedBufferGeometry();
  sparkGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
  sparkGeometry.setIndex([0, 1, 2, 0, 2, 3]);
  const sparkBuffer = new THREE.InstancedInterleavedBuffer(fire.sparks, SPARK_FLOATS);
  sparkBuffer.setUsage(THREE.DynamicDrawUsage);
  sparkGeometry.setAttribute('aNow', new THREE.InterleavedBufferAttribute(sparkBuffer, 4, 0));
  sparkGeometry.setAttribute('aWas', new THREE.InterleavedBufferAttribute(sparkBuffer, 4, 4));
  sparkGeometry.setAttribute('aSpark', new THREE.InterleavedBufferAttribute(sparkBuffer, 4, 8));
  sparkGeometry.instanceCount = SPARKS;
  const sparkMaterial = new THREE.ShaderMaterial({
    uniforms: { uRes: { value: new THREE.Vector2(1, 1) }, uShutter: { value: 1 / 240 }, uTime: shared.uTime, uStepRate: { value: 120 } },
    vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG,
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
  });
  const sparkMesh = new THREE.Mesh(sparkGeometry, sparkMaterial);
  sparkMesh.frustumCulled = false;
  sparkMesh.castShadow = false;
  scene.add(sparkMesh);

  // Targets: linear HDR beauty with depth, the flame at half size, a composite and the bloom pyramid.
  const hdr = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  hdr.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  const flameRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const compRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const chain = () => Array.from({ length: LEVELS }, () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }));
  const downs = chain(), ups = chain();

  const screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  function pass(fragmentShader, uniforms, options = {}) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms, vertexShader: FULLSCREEN_VERT, fragmentShader, depthTest: false, depthWrite: false, ...options,
    }));
    m.frustumCulled = false;
    const s = new THREE.Scene();
    s.add(m);
    return { scene: s, u: m.material.uniforms };
  }
  const flame = pass(FLAME_FRAG, {
    uDepth: { value: hdr.depthTexture }, uProjectionInverse: { value: camera.projectionMatrixInverse }, uCameraWorld: { value: camera.matrixWorld },
    uNearFar: { value: new THREE.Vector2(camera.near, camera.far) }, uTime: { value: 0 }, uEnergy: { value: 1 },
    uFlare: { value: 0 }, uWind: { value: new THREE.Vector2() }, uFrame: { value: 0 }, uSources: { value: SOURCES.map(() => new THREE.Vector4()) },
  });
  const composite = pass(COMPOSITE_FRAG, {
    uBeauty: { value: hdr.texture }, uFlame: { value: flameRT.texture }, uFlameTexel: { value: new THREE.Vector2() },
    uTime: shared.uTime, uHaze: { value: new THREE.Vector4(0.5, 0.4, 0.9, 0.1) }, uAspect: { value: 1 },
  });
  const down = pass(DOWN_FRAG, { uSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
  const up = pass(UP_FRAG, { uSrc: { value: null }, uBase: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } });
  const output = pass(OUTPUT_FRAG, {
    uImage: { value: compRT.texture }, uBloom: { value: ups[1].texture }, uExposure: { value: EXPOSURE },
    uBloomGain: { value: BLOOM.gain }, uFrame: { value: 0 }, uAspect: { value: 1 },
  });

  {
    const bake = pass(GROUND_BAKE, {});
    renderer.setRenderTarget(groundMap);
    renderer.render(bake.scene, screenCamera);
    renderer.setRenderTarget(null);
    bake.scene.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  }
  const size = new THREE.Vector2(1, 1);
  let frame = 0, shadowTime = -Infinity;
  const projected = new V3();

  // yaw (radians) and zoom move the camera around and toward the fire, for scripted captures.
  const view = { yaw: 0, zoom: 1 };
  function frameCamera(aspect) {
    camera.aspect = aspect;
    // Keep the whole fire and the sword's hilt in view whatever the window's shape.
    const tan = Math.tan(THREE.MathUtils.degToRad(HOME.fov / 2));
    const distance = Math.max(HOME.halfHeight / tan, HOME.halfWidth / (tan * aspect)) / view.zoom;
    const dir = HOME.eye.clone().sub(HOME.target).normalize().applyAxisAngle(new V3(0, 1, 0), view.yaw);
    camera.position.copy(HOME.target).addScaledVector(dir, distance);
    camera.lookAt(HOME.target);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    woodStale = true;
    composite.u.uAspect.value = output.u.uAspect.value = aspect;
    // The shimmer sits over the flames.
    projected.set(0, 0.25, 0).project(camera);
    const base = projected.clone();
    projected.set(0, 1.9, 0).project(camera);
    const halfWidth = new V3(0.45, 0.6, 0).project(camera).x - base.x;
    composite.u.uHaze.value.set(base.x * 0.5 + 0.5, base.y * 0.5 + 0.5, projected.y * 0.5 + 0.5, Math.abs(halfWidth) * 0.5);
  }

  // The lights drift with the flames and flicker with their brightness.
  function placeLights() {
    const s = fire.state, t = s.time * FLICKER;
    const n = (a, b) => Math.sin(t * a + b) * 0.5 + Math.sin(t * a * 2.13 + b * 1.7) * 0.3 + Math.sin(t * a * 4.7 + b * 2.9) * 0.2;
    // The flame is one body, so its lights sway and flicker together, each with only a
    // little play of its own. They sit up in the flames, clear of the blade, so the logs
    // below cast short shadows that shimmer rather than swing.
    const flicker = 1 + 0.12 * n(5.1, 0.3) + 0.05 * n(11.3, 2.1);
    const gx = Math.max(-0.3, Math.min(0.3, s.gust[0])), gz = Math.max(-0.3, Math.min(0.3, s.gust[1]));
    const sx = 0.03 * n(1.6, 1.0) + gx * 0.12, sz = 0.025 * n(1.3, 4.0) + gz * 0.12, sy = 0.03 * n(2.0, 2.5);
    const own = (i) => 1 + 0.05 * n(6.3 + i, i * 2.7);
    lights[0].position.set(-0.18 + sx + 0.012 * n(3.1, 1.1), 0.72 + sy, 0.1 + sz);
    lights[1].position.set(0.3 + sx + 0.012 * n(2.9, 5.3), 0.68 + sy, 0.1 + sz);
    lights[2].position.set(-0.12 + sx * 1.4 + 0.012 * n(2.7, 7.7), 0.95 + sy * 1.3, -0.12 + sz * 1.4);
    lights[0].intensity = 2.1 * flicker * own(0) * s.energy;
    lights[1].intensity = 1.9 * flicker * own(1) * s.energy;
    lights[2].intensity = 2.2 * flicker * own(2) * s.energy;
    coals.intensity = 0.8 * (1 + 0.1 * n(1.3, 8.1)) * s.glow;
  }

  function render() {
    renderer.info.reset();
    const s = fire.state;
    shared.uTime.value = s.time;
    shared.uEnergy.value = s.glow;
    shared.uBlaze.value = s.energy;
    flame.u.uTime.value = s.time * FLICKER;
    flame.u.uFlare.value = s.boost * 0.4;
    flame.u.uEnergy.value = 1 + 0.1 * s.boost;
    flame.u.uWind.value.set(s.gust[0], s.gust[1]);
    flame.u.uFrame.value = frame % 64;
    // Each tongue of flame wanders over the coals and pulses on its own beat; now and then
    // one gutters almost to nothing and flares back.
    SOURCES.forEach(([x, z, radius, height], i) => {
      const t = s.time * FLICKER, w = (a, b) => Math.sin(t * a + i * b);
      const p = w(1.9, 2.1) * 0.5 + w(3.7, 4.3) * 0.3 + w(6.1, 1.3) * 0.2;
      const gutter = 0.72 + 0.28 * Math.max(0, Math.min(1, 0.5 + 1.5 * w(0.31, 5.7)));
      flame.u.uSources.value[i].set(
        x + 0.05 * w(0.53, 1.7) + 0.02 * w(1.31, 3.1), z + 0.05 * w(0.47, 4.1) + 0.02 * w(1.17, 0.9),
        radius, height * (1 + 0.25 * p) * s.energy * gutter);
    });
    placeLights();
    // The lights move only a little from one frame to the next, so each frame redraws one
    // shadow map in turn, and every one after a jump in time.
    const jump = Math.abs(s.time - shadowTime) > 0.1;
    shadowTime = s.time;
    lights.forEach((light, i) => { if (jump || frame % lights.length === i) light.shadow.needsUpdate = true; });
    sparkBuffer.needsUpdate = true;
    sparkMaterial.uniforms.uStepRate.value = 1 / Math.max(1e-4, s.step);

    if (woodStale) {
      renderer.setRenderTarget(wood);
      renderer.render(woodScene, camera);
      woodStale = false;
    }
    renderer.setRenderTarget(hdr);
    renderer.clear();
    renderer.render(scene, camera);

    renderer.setRenderTarget(flameRT);
    renderer.render(flame.scene, screenCamera);

    renderer.setRenderTarget(compRT);
    renderer.render(composite.scene, screenCamera);

    let src = compRT.texture, w = size.x, h = size.y;
    for (let k = 1; k < LEVELS; k++) {
      down.u.uSrc.value = src;
      down.u.uTexel.value.set(1 / w, 1 / h);
      renderer.setRenderTarget(downs[k]);
      renderer.render(down.scene, screenCamera);
      src = downs[k].texture; w = downs[k].width; h = downs[k].height;
    }
    for (let k = LEVELS - 2; k >= 1; k--) {
      const coarse = k === LEVELS - 2 ? downs[k + 1] : ups[k + 1];
      up.u.uSrc.value = coarse.texture;
      up.u.uBase.value = downs[k].texture;
      up.u.uTexel.value.set(1 / coarse.width, 1 / coarse.height);
      up.u.uWeight.value = BLOOM.weights[k - 1];
      renderer.setRenderTarget(ups[k]);
      renderer.render(up.scene, screenCamera);
    }
    output.u.uFrame.value = frame++ % 4096;
    renderer.setRenderTarget(null);
    renderer.render(output.scene, screenCamera);
  }

  function resize(cssWidth, cssHeight, w, h) {
    renderer.setSize(w, h, false);
    size.set(w, h);
    hdr.setSize(w, h);
    wood.setSize(w, h);
    const fw = Math.ceil(w * FLAME_SCALE), fh = Math.ceil(h * FLAME_SCALE);
    flameRT.setSize(fw, fh);
    composite.u.uFlameTexel.value.set(1 / fw, 1 / fh);
    compRT.setSize(w, h);
    for (let k = 1; k < LEVELS; k++) {
      const lw = Math.max(1, Math.ceil(w / 2 ** k)), lh = Math.max(1, Math.ceil(h / 2 ** k));
      downs[k].setSize(lw, lh);
      ups[k].setSize(lw, lh);
    }
    sparkMaterial.uniforms.uRes.value.set(w, h);
    frameCamera(cssWidth / cssHeight);
  }

  function dispose() {
    const geometries = new Set(), materials = new Set();
    for (const root of [scene, woodScene, flame.scene, composite.scene, down.scene, up.scene, output.scene]) {
      root.traverse(o => { if (o.geometry) geometries.add(o.geometry); if (o.material) materials.add(o.material); });
    }
    geometries.forEach(g => g.dispose());
    materials.forEach(m => m.dispose());
    for (const rt of [hdr, wood, flameRT, compRT, groundMap, ...downs, ...ups]) rt.dispose();
    for (const light of lights) light.shadow.map?.dispose();
    renderer.dispose();
  }

  function setView(yaw, zoom) {
    view.yaw = yaw; view.zoom = zoom;
    frameCamera(camera.aspect);
  }

  return { renderer, camera, render, resize, setView, dispose };
}
