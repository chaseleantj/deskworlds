import * as THREE from 'three';
import { createPostprocessing } from '../../shared/postprocessing.js';
import { randomGenerator } from '../../shared/random.js';
import {
  TIME_WRAP, SHADOW_SIZE, QUAD_VERT, SKY_VERT, SKY_FRAG, GALAXY_FRAG, TRAIL_VERT, TRAIL_FRAG, BACKDROP_FRAG, MOTE_VERT, MOTE_FRAG, METEOR_VERT, METEOR_FRAG, MIST_VERT, MIST_FRAG, GROUND_VERT, GROUND_FRAG,
  LIMB_VERT, LIMB_FRAG, GRASS_VERT, GRASS_FRAG, ATLAS_FRAG, BLOSSOM_VERT, BLOSSOM_FRAG, AIR_VERT, AFLOAT_VERT, FALLEN_VERT, PETAL_FRAG,
  RIPPLE_STEP_FRAG, RIPPLE_STAMP_VERT, RIPPLE_STAMP_FRAG, WATER_VERT, WATER_FRAG, BLOOM_DOWN_FRAG, BLOOM_UP_FRAG, SOFT_FRAG, SMOOTH_FRAG, FINISH_FRAG,
} from './shaders.js';
import { CAMERA, POLE_STAR, TREE, HEIGHT_MAP, buildGround, buildRocks, buildGrass, GROUND_FLOATS, ROCK_FLOATS, BLADE_FLOATS } from './site.js';
import { lightBlossoms, buildLimbs, LIMB_FLOATS, BLOSSOM_FLOATS } from './tree.js';
import { SKY, POLE, MOTES, buildTrails, buildMotes, TRAIL_FLOATS, MOTE_FLOATS } from './sky.js';
import { AIR_FLOATS, AFLOAT_FLOATS, FALLEN_FLOATS, RIPPLE_FLOATS } from './world.js';

// The square of lake the rings run on: its corner (x, z), its span in metres, and its grid.
const FIELD = { x: -12, z: -16, span: 40, size: 1024 };
// The mirrored view is drawn at this share of the frame's size each way.
const MIRROR_SCALE = 0.5;
// How far past the horizon the mirrored view is drawn, as a share of its height, for ripples to bend into.
const MIRROR_MARGIN = 0.08;
const BLOOM_LEVELS = 6;
// The whole world's light: the silver of the pole star, the teal of the night sky, and the rose
// glow that starlit blossom throws on what is under it. Nothing has a light of its own.
// It is night: the pole star is a dim light, and only the stars are bright enough to glow.
const LIGHT = { star: [0.77, 0.83, 0.91], sky: [0.011, 0.027, 0.038], glow: [0.16, 0.09, 0.105], exposure: 1.5, bloom: 0.11, knee: 1.0 };
// The lens: everything is sharp as far as `distance` metres, where the tree's near side is.
// `strength` is how fast things go soft beyond that and `most` the most blur allowed, both
// as shares of the frame's height (times a metre, for the strength).
const LENS = { distance: 20.5, strength: 0.11, most: 0.002 };
// Right under the lens the picture is soft again: within `within` metres of the eye,
// softer the nearer, by `strength` and up to `most` as above.
const CLOSE = { within: 6, strength: 0.016, most: 0.006 };
// What the pole star's shadow map takes in: a box this far each way about a point in the crown.
const SHADOW = { reach: 9.5, centre: [TREE.x + 1.3, 3.4, 1.0], depth: 40 };
// Sheets of mist lying on the lake behind the islet: how many, and how far back the first is.
const MIST = { sheets: 4, nearest: -5, apart: 9 };
const SEED = 9173;
// Loose petals against the flower they came from: those on the lake are wet and half sunk,
// so they take much less light; those on the grass have begun to fade.
const PETAL_TINT = { air: [1, 0.92, 0.94], afloat: [0.85, 0.7, 0.75], fallen: [0.85, 0.72, 0.76] };

export function createRenderer(canvas, { world, tree, light, terrain }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.autoClear = false;
  renderer.info.autoReset = false;

  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.5, 4000), mirror = camera.clone();
  const { target, post, postScene, postCamera } = createPostprocessing(camera, {
    samples: 4, fragmentShader: FINISH_FRAG,
    uniforms: {
      uBloom: { value: null }, uSoft: { value: null }, uExposure: { value: LIGHT.exposure }, uBloomStrength: { value: LIGHT.bloom },
      uRise: { value: new THREE.Vector4() }, uLens: { value: new THREE.Vector2() }, uNear: { value: new THREE.Vector3() }, uFocus: { value: LENS.distance },
    },
  });
  const half = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
  const reflection = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 2, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
  const painted = new THREE.WebGLRenderTarget(1, 1, half), paintedMirror = new THREE.WebGLRenderTarget(1, 1, half), soft = new THREE.WebGLRenderTarget(1, 1, half), softer = new THREE.WebGLRenderTarget(1, 1, half);
  const bloom = Array.from({ length: BLOOM_LEVELS }, () => new THREE.WebGLRenderTarget(1, 1, half));
  let ripples = [new THREE.WebGLRenderTarget(FIELD.size, FIELD.size, half), new THREE.WebGLRenderTarget(FIELD.size, FIELD.size, half)];
  const atlas = new THREE.WebGLRenderTarget(1024, 1024, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
  atlas.texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const heights = new THREE.DataTexture(Uint16Array.from(terrain.map, THREE.DataUtils.toHalfFloat), HEIGHT_MAP.size, HEIGHT_MAP.size, THREE.RedFormat, THREE.HalfFloatType);
  heights.minFilter = heights.magFilter = THREE.LinearFilter;
  heights.needsUpdate = true;
  // The map of the turning sky: once round it is one turn, so its left edge meets its right.
  const trails = new THREE.WebGLRenderTarget(SKY.width, SKY.height, half);
  trails.texture.wrapS = THREE.RepeatWrapping;
  // The pole star's view of the islet and the tree, kept as the depths it sees. Nothing the
  // pole star lights moves more than a few centimetres, so it is taken once.
  const shadow = new THREE.WebGLRenderTarget(SHADOW_SIZE, SHADOW_SIZE, { format: THREE.RedFormat });
  shadow.depthTexture = new THREE.DepthTexture(SHADOW_SIZE, SHADOW_SIZE, THREE.UnsignedIntType);
  // What the shaders read while that map is being drawn: nothing in shadow.
  const unshadowed = new THREE.DataTexture(new Float32Array([1]), 1, 1, THREE.RedFormat, THREE.FloatType);
  unshadowed.needsUpdate = true;
  const poleEye = new THREE.OrthographicCamera(-SHADOW.reach, SHADOW.reach, SHADOW.reach, -SHADOW.reach, 0.1, SHADOW.depth);
  poleEye.position.set(...SHADOW.centre).addScaledVector(new THREE.Vector3(...POLE_STAR), SHADOW.depth / 2);
  poleEye.lookAt(...SHADOW.centre);
  poleEye.updateMatrixWorld();
  const shadowMatrix = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(poleEye.projectionMatrix).multiply(poleEye.matrixWorldInverse);

  const shared = {
    uTime: { value: 0 }, uCalm: { value: 0 }, uStir: { value: 0 }, uGusts: { value: new THREE.Vector4() }, uMirror: { value: 0 }, uPixel: { value: 0.001 },
    uPoleDir: { value: new THREE.Vector3(...POLE_STAR) }, uPoleLight: { value: new THREE.Vector3(...LIGHT.star) }, uSky: { value: new THREE.Vector3(...LIGHT.sky) }, uGlow: { value: new THREE.Vector3(...LIGHT.glow) },
    uAtlas: { value: atlas.texture }, uDrift: { value: 0 }, uShadow: { value: unshadowed }, uShadowMatrix: { value: shadowMatrix },
    uRes: { value: new THREE.Vector2(1, 1) }, uHeights: { value: heights }, uField: { value: new THREE.Vector3(FIELD.x, FIELD.z, FIELD.span) }, uTexel: { value: 1 / FIELD.size },
  };
  const scene = new THREE.Scene();
  let order = 0;
  function add(root, geometry, vertexShader, fragmentShader, uniforms = {}, options = {}, Kind = THREE.Mesh) {
    const mesh = new Kind(geometry, new THREE.ShaderMaterial({ uniforms: { ...shared, ...uniforms }, vertexShader, fragmentShader, ...options }));
    mesh.frustumCulled = false;
    mesh.renderOrder = order++;
    root.add(mesh);
    return mesh;
  }
  // A mesh whose vertices are `stride` floats each, laid out as `layout` says.
  function packed(array, stride, layout, index, Buffer = THREE.InterleavedBuffer, geometry = new THREE.BufferGeometry()) {
    const buffer = new Buffer(array, stride);
    let offset = 0;
    for (const [name, size] of layout) { geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, size, offset)); offset += size; }
    if (index) geometry.setIndex(new THREE.BufferAttribute(index, 1));
    return { geometry, buffer };
  }
  // One shape drawn many times, each copy reading its own slice of `array`.
  function instanced(base, array, stride, layout, usage = THREE.StaticDrawUsage) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index;
    geometry.setAttribute('position', base.getAttribute('position'));
    const made = packed(array, stride, layout, null, THREE.InstancedInterleavedBuffer, geometry);
    made.buffer.setUsage(usage);
    geometry.instanceCount = array.length / stride;
    return made;
  }
  const quad = new THREE.PlaneGeometry(2, 2);
  const screen = { depthTest: false, depthWrite: false };
  const cutout = { side: THREE.DoubleSide, alphaToCoverage: true };
  const additive = { transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor };
  // Laid over what is behind it, in proportion to how much of the pixel it covers.
  const veil = { transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor };

  // --- The world, back to front.
  // The two directions the way round the pole is measured from (see sky.js).
  const poleFrame = { uPoleEast: { value: new THREE.Vector3(...POLE.east) }, uPoleNorth: { value: new THREE.Vector3(...POLE.north) } };
  const backdrop = add(scene, quad, SKY_VERT, BACKDROP_FRAG, {
    ...poleFrame, uStarAt: { value: new THREE.Vector2() }, uPainted: { value: painted.texture }, uTrails: { value: trails.texture }, uSpin: { value: 0 }, uCameraWorld: { value: new THREE.Matrix4() }, uUnproject: { value: new THREE.Matrix4() },
  }, screen);
  const ground = buildGround(light);
  // Everything solid enough to throw a shadow.
  const casters = [add(scene, packed(ground.vertices, GROUND_FLOATS, [['position', 3], ['normal', 3], ['aSky', 1]], ground.index).geometry, GROUND_VERT, GROUND_FRAG)];
  const rocks = buildRocks(light);
  casters.push(add(scene, packed(rocks.vertices, ROCK_FLOATS, [['position', 3], ['normal', 3], ['aSky', 1]], rocks.index).geometry, GROUND_VERT, GROUND_FRAG));
  const limbs = buildLimbs(tree.chains, light);
  casters.push(add(scene, packed(limbs.vertices, LIMB_FLOATS, [['position', 3], ['normal', 3], ['aBark', 3], ['aFlex', 1], ['aSky', 1]], limbs.index).geometry, LIMB_VERT, LIMB_FRAG));
  // A blade is a strip of three quads.
  const blade = new THREE.BufferGeometry();
  {
    const positions = [], index = [];
    for (let j = 0; j <= 3; j++) positions.push(-1, j / 3, 0, 1, j / 3, 0);
    for (let j = 0; j < 3; j++) index.push(j * 2, j * 2 + 1, j * 2 + 3, j * 2, j * 2 + 3, j * 2 + 2);
    blade.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    blade.setIndex(index);
  }
  const grass = instanced(blade, buildGrass(light, randomGenerator(SEED)), BLADE_FLOATS, [['aRoot', 4], ['aBlade', 4], ['aSky', 1]]);
  const blades = grass.geometry.instanceCount;
  add(scene, grass.geometry, GRASS_VERT, GRASS_FRAG, {}, { side: THREE.DoubleSide });
  const petalLayout = { blossom: [['aAt', 4], ['aFace', 4], ['aLook', 3], ['aLit', 2]], air: [['aAt', 4], ['aLook', 3], ['aLit', 2]], afloat: [['aAt', 4], ['aLit', 3]], fallen: [['aAt', 4], ['aLook', 2], ['aLit', 3]] };
  casters.push(add(scene, instanced(quad, lightBlossoms(tree.blossoms, light), BLOSSOM_FLOATS, petalLayout.blossom).geometry, BLOSSOM_VERT, BLOSSOM_FRAG, {}, cutout));
  const fallen = instanced(quad, world.fallen, FALLEN_FLOATS, petalLayout.fallen, THREE.DynamicDrawUsage);
  const tint = (which) => ({ uPetalTint: { value: new THREE.Vector3(...PETAL_TINT[which]) } });
  // Petals lying flat are seen edge-on, where a cut-out edge would be ragged, so they are laid over instead.
  const fallenMesh = add(scene, fallen.geometry, FALLEN_VERT, PETAL_FRAG, tint('fallen'), { ...veil, defines: { LYING: 1 } });
  const lake = new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2);
  const water = add(scene, lake, WATER_VERT, WATER_FRAG, { uReflection: { value: reflection.texture }, uRipples: { value: ripples[0].texture }, uBend: { value: 1 } });
  const afloat = instanced(quad, world.afloat, AFLOAT_FLOATS, petalLayout.afloat, THREE.DynamicDrawUsage);
  // They keep their place in depth, so that the lens can tell them from the water they lie on.
  const afloatMesh = add(scene, afloat.geometry, AFLOAT_VERT, PETAL_FRAG, tint('afloat'), { ...veil, depthWrite: true, defines: { LYING: 1, AFLOAT: 1 } });
  const air = instanced(quad, world.air, AIR_FLOATS, petalLayout.air, THREE.DynamicDrawUsage);
  add(scene, air.geometry, AIR_VERT, PETAL_FRAG, tint('air'), cutout);
  // The mist, furthest sheet first, each wider and taller than the one in front of it.
  for (let k = MIST.sheets - 1; k >= 0; k--) {
    const width = 46 + 14 * k, height = 1.2 + 0.45 * k;
    add(scene, new THREE.PlaneGeometry(width, height).translate(4 + (k % 3 - 1) * 7, height / 2, MIST.nearest - k * MIST.apart), MIST_VERT, MIST_FRAG, { uSeed: { value: 1.7 * k + 0.4 } }, veil);
  }
  const motes = add(scene, packed(buildMotes(randomGenerator(SEED + 2)), MOTE_FLOATS, [['aMote', 4], ['aLook', 4], ['aTint', 3]]).geometry, MOTE_VERT, MOTE_FRAG, { ...poleFrame, uMoteSpin: { value: 0 }, uMoteScale: { value: 1 } }, additive, THREE.Points);
  const meteor = add(scene, new THREE.PlaneGeometry(1, 2).translate(0.5, 0, 0), METEOR_VERT, METEOR_FRAG, { uFrom: { value: new THREE.Vector3() }, uHeading: { value: new THREE.Vector3() }, uAge: { value: 9 } }, { ...additive, side: THREE.DoubleSide });

  // --- Things painted once and kept: the flowers the tree is drawn from, the map of the
  // turning sky, the pole star's shadows, and (again on each resize) the still part of the sky.
  const flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), once = new THREE.Scene(), map = new THREE.Scene();
  const atlasPaint = add(once, quad, QUAD_VERT, ATLAS_FRAG, {}, screen);
  const sky = add(once, quad, SKY_VERT, SKY_FRAG, { uCameraWorld: { value: new THREE.Matrix4() }, uUnproject: { value: new THREE.Matrix4() } }, screen);
  add(map, quad, QUAD_VERT, GALAXY_FRAG, {}, screen);
  // Every star as a dash, drawn a second time one turn back so those that run off the right edge come in at the left.
  const dashes = instanced(quad, buildTrails(randomGenerator(SEED + 1)), TRAIL_FLOATS, [['aDash', 4], ['aTint', 3]]).geometry;
  for (const shift of [0, -1]) add(map, dashes, TRAIL_VERT, TRAIL_FRAG, { uShift: { value: shift } }, { ...screen, ...additive });
  let stale = { kept: true, sky: true };
  function paintKept() {
    atlasPaint.visible = true; sky.visible = false;
    renderer.setRenderTarget(atlas);
    renderer.render(once, flat);
    renderer.setRenderTarget(trails);
    renderer.clear();
    renderer.render(map, flat);
    // The tree at rest, as the pole star sees it, with nothing else in the picture.
    const others = scene.children.filter((mesh) => mesh.visible && !casters.includes(mesh));
    for (const mesh of others) mesh.visible = false;
    shared.uShadow.value = unshadowed;
    shared.uMirror.value = shared.uPixel.value = shared.uTime.value = shared.uCalm.value = shared.uStir.value = 0;
    shared.uGusts.value.set(0, 0, 0, 0);
    renderer.setRenderTarget(shadow);
    renderer.clear();
    renderer.render(scene, poleEye);
    for (const mesh of others) mesh.visible = true;
    shared.uShadow.value = shadow.depthTexture;
    stale.kept = false;
  }
  function paintSky() {
    atlasPaint.visible = false; sky.visible = true;
    for (const [view, into] of [[camera, painted], [mirror, paintedMirror]]) {
      sky.material.uniforms.uCameraWorld.value.copy(view.matrixWorld);
      sky.material.uniforms.uUnproject.value.copy(view.projectionMatrixInverse);
      renderer.setRenderTarget(into);
      renderer.render(once, flat);
    }
    stale.sky = false;
  }

  // --- The rings on the water.
  const stamps = new THREE.Scene(), stepping = new THREE.Scene();
  const stamp = instanced(quad, world.ripples, RIPPLE_FLOATS, [['aRipple', 4]], THREE.DynamicDrawUsage);
  add(stamps, stamp.geometry, RIPPLE_STAMP_VERT, RIPPLE_STAMP_FRAG, {}, { ...screen, ...additive });
  const stepper = add(stepping, quad, QUAD_VERT, RIPPLE_STEP_FRAG, { uState: { value: null } }, screen);
  for (const field of ripples) { renderer.setRenderTarget(field); renderer.clear(); }
  // Press in the rings made since last time, then let the water move on by `steps`.
  function advance(steps) {
    if (world.state.rippleCount) {
      stamp.buffer.needsUpdate = true;
      stamp.geometry.instanceCount = world.state.rippleCount;
      renderer.setRenderTarget(ripples[0]);
      renderer.render(stamps, flat);
      world.clearRipples();
    }
    for (let i = 0; i < steps; i++) {
      stepper.material.uniforms.uState.value = ripples[0].texture;
      renderer.setRenderTarget(ripples[1]);
      renderer.render(stepping, flat);
      ripples = [ripples[1], ripples[0]];
    }
    water.material.uniforms.uRipples.value = ripples[0].texture;
    renderer.setRenderTarget(null);
  }

  // --- Focus: the soft version of the picture, which the finish mixes in by distance.
  const softening = new THREE.Scene(), softStep = { value: new THREE.Vector2() };
  add(softening, quad, QUAD_VERT, SOFT_FRAG, { ...post.uniforms, uStep: softStep }, screen);
  const smoothing = new THREE.Scene();
  add(smoothing, quad, QUAD_VERT, SMOOTH_FRAG, { uSoft: { value: soft.texture }, uStep: softStep }, screen);
  post.uniforms.uSoft.value = softer.texture;
  post.uniforms.uStep = softStep;

  // --- The glow: the picture halved again and again, then added back up.
  const glow = new THREE.Scene();
  const down = add(glow, quad, QUAD_VERT, BLOOM_DOWN_FRAG, { uSource: { value: null }, uStep: { value: new THREE.Vector2() }, uKnee: { value: 0 } }, screen);
  const up = add(glow, quad, QUAD_VERT, BLOOM_UP_FRAG, { uSource: { value: null }, uStep: { value: new THREE.Vector2() } }, { ...screen, ...additive });
  function bloomPass() {
    up.visible = false; down.visible = true;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      const source = i ? bloom[i - 1] : target, u = down.material.uniforms;
      u.uSource.value = source.texture; u.uStep.value.set(1 / source.width, 1 / source.height); u.uKnee.value = i ? 0 : LIGHT.knee;
      renderer.setRenderTarget(bloom[i]);
      renderer.render(glow, flat);
    }
    up.visible = true; down.visible = false;
    for (let i = BLOOM_LEVELS - 2; i >= 0; i--) {
      const source = bloom[i + 1], u = up.material.uniforms;
      u.uSource.value = source.texture; u.uStep.value.set(0.5 / source.width, 0.5 / source.height);
      renderer.setRenderTarget(bloom[i]);
      renderer.render(glow, flat);
    }
    post.uniforms.uBloom.value = bloom[0].texture;
  }

  const ray = new THREE.Vector3();
  let landed = -1;
  function view(eye, into, picture, mirrored) {
    shared.uMirror.value = mirrored ? 1 : 0;
    shared.uRes.value.set(into.width, into.height);
    shared.uPixel.value = 2 * Math.tan(eye.fov * Math.PI / 360) / into.height;
    motes.material.uniforms.uMoteScale.value = into.height / 1000;
    const b = backdrop.material.uniforms;
    b.uPainted.value = picture.texture; b.uCameraWorld.value.copy(eye.matrixWorld); b.uUnproject.value.copy(eye.projectionMatrixInverse);
    // Where in this view the pole star is, as a share of the frame each way.
    ray.set(...POLE_STAR).multiplyScalar(1000).add(eye.position).project(eye);
    b.uStarAt.value.set(ray.x * 0.5 + 0.5, ray.y * 0.5 + 0.5);
    // The mirror shows neither the water nor what lies flat on it or on the grass, and
    // little enough of the turf that a quarter of the blades will do.
    water.visible = afloatMesh.visible = fallenMesh.visible = !mirrored;
    grass.geometry.instanceCount = mirrored ? Math.floor(blades / 4) : blades;
    renderer.setRenderTarget(into);
    renderer.clear();
    renderer.render(scene, eye);
  }

  function render() {
    renderer.info.reset();
    const s = world.state;
    shared.uTime.value = s.time % TIME_WRAP;
    shared.uCalm.value = s.calm;
    shared.uGusts.value.fromArray(world.gusts);
    shared.uStir.value = s.stir;
    // The mist creeps along the lake. Far too slow to see a jump when this wraps, days in.
    shared.uDrift.value = (s.time * 0.006) % 4096;
    backdrop.material.uniforms.uSpin.value = (s.time / SKY.turn) % 1;
    motes.material.uniforms.uMoteSpin.value = (s.time / MOTES.turn) % 1;
    const m = meteor.material.uniforms;
    m.uAge.value = s.meteor.age; m.uFrom.value.fromArray(s.meteor.from); m.uHeading.value.fromArray(s.meteor.heading);
    meteor.visible = s.meteor.age < 1;
    air.buffer.needsUpdate = afloat.buffer.needsUpdate = true;
    if (landed !== s.landed) { fallen.buffer.needsUpdate = true; landed = s.landed; }
    if (stale.kept) paintKept();
    if (stale.sky) paintSky();
    view(mirror, reflection, paintedMirror, true);
    view(camera, target, painted, false);
    renderer.setRenderTarget(soft);
    renderer.render(softening, flat);
    renderer.setRenderTarget(softer);
    renderer.render(smoothing, flat);
    bloomPass();
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCamera);
  }

  function resize(cssWidth, cssHeight, w, h) {
    renderer.setSize(w, h, false);
    target.setSize(w, h);
    painted.setSize(w, h);
    for (const made of [soft, softer]) made.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
    softStep.value.set(1 / w, 1 / h);
    post.uniforms.uLens.value.set(LENS.strength, LENS.most).multiplyScalar(h);
    post.uniforms.uNear.value.set(CLOSE.within, CLOSE.strength * h, CLOSE.most * h);
    const mw = Math.ceil(w * MIRROR_SCALE), mh = Math.ceil(h * MIRROR_SCALE);
    reflection.setSize(mw, mh);
    // The lake fills only the frame below the horizon, so it only ever shows the strip of
    // the mirrored view just above the mirrored horizon. Nothing else of it is drawn.
    reflection.scissorTest = true;
    reflection.scissor.set(0, Math.floor(mh * (1 - CAMERA.horizon - MIRROR_MARGIN)), mw, mh);
    paintedMirror.setSize(mw, mh);
    bloom.forEach((level, i) => level.setSize(Math.max(1, w >> (i + 1)), Math.max(1, h >> (i + 1))));
    // The trunk keeps its distance from the left edge, the horizon its height in the frame.
    const aspect = cssWidth / cssHeight, half = Math.tan(CAMERA.fov * Math.PI / 360), rise = (1 - 2 * CAMERA.horizon) * half;
    const across = Math.min(CAMERA.furthest, Math.max(CAMERA.nearest, CAMERA.trunk / aspect));
    // Where the trunk and the frame's edges lie across the camera's view, in frame heights
    // from its axis. The frame is a window in a wider view that is centred on the axis.
    const trunk = (TREE.x - CAMERA.x) / (2 * half * (CAMERA.z - TREE.z)), left = trunk - across * aspect, full = 2 * Math.max(-left, left + aspect);
    camera.position.set(CAMERA.x, CAMERA.height, CAMERA.z);
    camera.lookAt(CAMERA.x, CAMERA.height + rise, CAMERA.z - 1);
    // The mirror's eye is the camera's, as far below the water as the camera is above it.
    mirror.position.set(CAMERA.x, -CAMERA.height, CAMERA.z);
    mirror.lookAt(CAMERA.x, -CAMERA.height - rise, CAMERA.z - 1);
    for (const eye of [camera, mirror]) { eye.fov = CAMERA.fov; eye.aspect = full; eye.setViewOffset(full, 1, left + full / 2, 0, aspect, 1); }
    for (const eye of [camera, mirror]) { eye.updateProjectionMatrix(); eye.updateMatrixWorld(); }
    water.material.uniforms.uBend.value = 2 / (camera.fov * Math.PI / 180);
    // How the line of sight climbs across the frame, for the lens to tell the lake's surface by.
    const climb = (x, y) => ray.set(x, y, 1).unproject(camera).y - camera.position.y, corner = climb(-1, -1);
    post.uniforms.uRise.value.set(camera.position.y, corner, climb(1, -1) - corner, climb(-1, 1) - corner);
    stale.sky = true;
  }

  // The line of sight through a point of the frame (x and y from -1 to 1), as a direction from the eye.
  const sight = (x, y) => ray.set(x, y, 0.5).unproject(camera).sub(camera.position).normalize().toArray();

  function dispose() {
    const geometries = new Set(), materials = new Set();
    for (const root of [scene, once, map, stamps, stepping, softening, smoothing, glow, postScene]) root.traverse((o) => { if (o.geometry) geometries.add(o.geometry); if (o.material) materials.add(o.material); });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    for (const made of [target, reflection, painted, paintedMirror, soft, softer, atlas, trails, heights, shadow, unshadowed, ...bloom, ...ripples]) made.dispose();
    renderer.dispose();
  }

  return {
    renderer, render, resize, advance, sight, dispose,
    // After the graphics context has been lost and given back, everything kept must be made again.
    repaint() { stale = { kept: true, sky: true }; },
  };
}
