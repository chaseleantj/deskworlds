import * as THREE from 'three';
import {
  BODY_VERT, BODY_FRAG, EYE_VERT, EYE_FRAG, FIN_VERT, FIN_FRAG, PELLET_VERT, PELLET_FRAG, COMPOSITE_FRAG,
  POST_VERT, MOTE_VERT, MOTE_FRAG, DOWN_FRAG, BLUR_FRAG, LENS_FRAG, OUTPUT_FRAG,
} from './shaders.js';
import { PELLET } from './food.js';
import { approach } from './behaviour.js';

const V3 = THREE.Vector3;

// Camera model. A macro lens focused on the fish's head: the circle of confusion of a point at
// distance z is APERTURE * focalPx * |z - focus| / (z * focus), so closing in both magnifies the
// blur and deepens the relative depth range; at the home view it stays under a pixel on the fish.
const LENS = { APERTURE: 0.011, MAX_COC: 10, SHUTTER: 0.006, CA: 0.0012, GLOW: 0.03, GRAIN: 0.03, MOTES: 150 };
const EXPOSURE = 0.55;
// The opaque pass, PEELS exact fin layers, then one pass that blends whatever lies deeper
// (unsorted, but by then it is mostly hidden).
const PEELS = 4;
const RED = new V3(0.72, 0.06, 0.035), BLUE = new V3(0.04, 0.20, 0.58), PALE = new V3(0.40, 0.52, 0.66);
const FINS = [
  { fin: 0, res: [46, 170], rays: 46, redBias: 0.02, opacity: 1.0, edge: 0.86, trans: 0.9, seed: 1.3 },
  { fin: 1, res: [32, 85], rays: 26, redBias: -0.10, opacity: 1.0, edge: 0.86, trans: 0.9, seed: 4.1 },
  { fin: 2, res: [32, 100], rays: 32, redBias: 0.14, opacity: 1.0, edge: 0.87, trans: 0.9, seed: 7.7 },
  { fin: 4, side: 1, res: [34, 12], rays: 9, redBias: 0.5, opacity: 0.75, edge: 0.93, trans: 1.0, seed: 2.2 },
  { fin: 4, side: -1, res: [34, 12], rays: 9, redBias: 0.5, opacity: 0.75, edge: 0.93, trans: 1.0, seed: 5.9 },
  { fin: 3, side: 1, res: [20, 23], rays: 11, redBias: -0.5, opacity: 0.07, edge: 0.95, trans: 1.6, seed: 3.3, pale: true },
  { fin: 3, side: -1, res: [20, 23], rays: 12, redBias: -0.5, opacity: 0.07, edge: 0.94, trans: 1.6, seed: 6.6, pale: true },
];
const PEEL_BLEND = { blending: THREE.NoBlending, depthTest: true, depthWrite: true };
const REST_BLEND = {
  blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, depthTest: false, depthWrite: false,
};

// A (u, v) grid in [0, 1]^2 the vertex shaders wrap onto the body and fins.
function grid(nu, nv) {
  const n = (nu + 1) * (nv + 1);
  const p = new Float32Array(n * 2);
  let k = 0;
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) { p[k++] = i / nu; p[k++] = j / nv; }
  const idx = [];
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = i * (nv + 1) + j, b = a + nv + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('aP', new THREE.BufferAttribute(p, 2));
  g.setIndex(idx);
  return g;
}

// A lumpy grain: a sphere pushed in and out by a smooth function of direction, so the seam
// vertices move together and the shading stays smooth.
function pelletGeometry() {
  const g = new THREE.SphereGeometry(1, 14, 10), pos = g.attributes.position, v = new V3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r = 1 + 0.09 * Math.sin(3.1 * v.x + 1.3) * Math.sin(2.7 * v.y + 0.4) + 0.06 * Math.sin(4.3 * v.z + 2.1 * v.x + 0.7);
    pos.setXYZ(i, v.x * r, v.y * r, v.z * r);
  }
  g.computeVertexNormals();
  return g;
}

export function createRenderer(canvas, betta, random) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;   // the output pass writes display values itself
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();       // opaque: body, eyes, food
  const finScene = new THREE.Scene();    // translucent fins, depth peeled
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
  const common = { ...betta.uniforms, uExposure: { value: EXPOSURE } };
  const { flap, gaze } = betta;

  function addMesh(geo, mat, target = scene) {
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    target.add(m);
    return m;
  }
  addMesh(grid(220, 96), new THREE.ShaderMaterial({
    uniforms: { ...common, uFlap: flap.phase, uFlapAmp: flap.amp }, vertexShader: BODY_VERT, fragmentShader: BODY_FRAG, side: THREE.FrontSide,
  }));
  const eyeGeo = new THREE.SphereGeometry(1, 48, 32);
  for (const side of [1, -1]) {
    addMesh(eyeGeo, new THREE.ShaderMaterial({
      uniforms: { ...common, uSide: { value: side }, uGaze: gaze[side] },
      vertexShader: EYE_VERT, fragmentShader: EYE_FRAG,
    }));
  }
  const peel = { uPeel: { value: 0 }, uOpaqueDepth: { value: null }, uPrevDepth: { value: null } };
  for (const f of FINS) {
    const uniforms = {
      ...common,
      uSide: { value: f.side ?? 1 }, uFlap: flap.phase, uFlapAmp: flap.amp,
      uRed: { value: f.pale ? new V3(0.55, 0.62, 0.75) : RED },
      uBlue: { value: f.pale ? new V3(0.50, 0.60, 0.78) : BLUE },
      uPale: { value: PALE },
      uRays: { value: f.rays }, uRedBias: { value: f.redBias }, uOpacity: { value: f.opacity },
      uEdge: { value: f.edge }, uSeed: { value: f.seed }, uTrans: { value: f.trans }, uLead: { value: f.fin === 4 ? 1 : 0 }, uSideFade: { value: f.fin <= 2 ? 1 : 0 }, uPathMax: { value: f.pale ? 1.3 : 4.0 }, uGlow: { value: f.pale ? 0.16 : 0.0 },
      ...peel,
    };
    addMesh(grid(f.res[0], f.res[1]), new THREE.ShaderMaterial({
      uniforms, vertexShader: FIN_VERT, fragmentShader: FIN_FRAG, defines: { FIN: f.fin }, side: THREE.DoubleSide,
    }), finScene);
  }

  // Food pellets, one instance each.
  const pelletAttr = new THREE.InstancedBufferAttribute(new Float32Array(PELLET.capacity * 3), 3);
  pelletAttr.setUsage(THREE.DynamicDrawUsage);
  const pelletGeo = pelletGeometry();
  pelletGeo.setAttribute('aPellet', pelletAttr);
  const pellets = new THREE.InstancedMesh(pelletGeo, new THREE.ShaderMaterial({
    uniforms: common, vertexShader: PELLET_VERT, fragmentShader: PELLET_FRAG,
  }), PELLET.capacity);
  pellets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  pellets.frustumCulled = false;
  pellets.count = 0;
  scene.add(pellets);
  const pelletPose = { m: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new V3(), p: new V3(), axis: new V3() };
  function syncPellets() {
    const { food } = betta, { m, q, s, p, axis } = pelletPose;
    let n = 0;
    for (const pellet of food.pellets) {
      if (pellet.age < 0) continue;
      const h = pellet.seed * 1000;
      const whole = food.whole(pellet);
      axis.set(Math.sin(h * 1.3), Math.cos(h * 2.9), Math.sin(h * 4.1 + 1)).normalize();
      q.setFromAxisAngle(axis, pellet.turn);
      s.set(1 + 0.18 * Math.sin(h * 7.7), 1 + 0.14 * Math.sin(h * 5.3), 1 + 0.16 * Math.sin(h * 3.7)).multiplyScalar(pellet.radius * (0.4 + 0.6 * whole));
      m.compose(p.set(pellet.x, pellet.y, pellet.z), q, s);
      pellets.setMatrixAt(n, m);
      pelletAttr.setXYZ(n, pellet.seed, Math.min(1, Math.max(0, (pellet.age - pellet.floatFor) / 3)), whole);
      n++;
    }
    pellets.count = n;
    pellets.instanceMatrix.needsUpdate = true;
    pelletAttr.needsUpdate = true;
  }

  // Render targets, all but the lens chain supersampled ss x ss when the pixel budget allows.
  function depthTarget() {
    const rt = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    rt.depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);
    return rt;
  }
  const opaqueRT = depthTarget();
  const peelRTs = Array.from({ length: PEELS }, depthTarget);
  const restRT = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
  const screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  function postPass(frag, uniforms, vertexShader = POST_VERT) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: { uFrame: { value: 0 }, ...uniforms }, vertexShader, fragmentShader: frag, depthTest: false, depthWrite: false,
    }));
    m.frustumCulled = false;
    const sc = new THREE.Scene();
    sc.add(m);
    return { scene: sc, u: m.material.uniforms };
  }
  // Composites the opaque pass and the peeled layers front to back, averaging the supersamples.
  const compositePass = postPass(COMPOSITE_FRAG, {
    uOpaque: { value: opaqueRT.texture }, uRest: { value: restRT.texture }, uSS: { value: 1 },
    ...Object.fromEntries(peelRTs.map((rt, i) => [`uL${i}`, { value: rt.texture }])),
    uOpaqueZ: { value: opaqueRT.depthTexture }, uL0Z: { value: peelRTs[0].depthTexture },
    uLens: { value: new V3(5.7, 0, 1) }, uClip: { value: new THREE.Vector2(camera.near, camera.far) },
  }, 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }');
  const composite = compositePass.u;
  peel.uOpaqueDepth.value = opaqueRT.depthTexture;

  const post = { focus: 0, frame: 0, histValid: false, ratio: 1, fetch: new V3(), size: new THREE.Vector2() };
  const linearRT = (filter, type = THREE.UnsignedByteType) => new THREE.WebGLRenderTarget(1, 1, { minFilter: filter, magFilter: filter, depthBuffer: false, type });
  const lensSrcRT = linearRT(THREE.LinearFilter);             // composite + motes, alpha = CoC
  const glowRTs = [linearRT(THREE.LinearFilter, THREE.HalfFloatType), linearRT(THREE.LinearFilter, THREE.HalfFloatType)];
  const histRTs = [linearRT(THREE.LinearFilter), linearRT(THREE.LinearFilter)];
  const downPass = postPass(DOWN_FRAG, { uSrc: { value: lensSrcRT.texture }, uTexel: { value: new THREE.Vector2() } });
  const blurPass = postPass(BLUR_FRAG, { uSrc: { value: null }, uStep: { value: new THREE.Vector2() } });
  const lensPass = postPass(LENS_FRAG, {
    uSrc: { value: lensSrcRT.texture }, uTiles: { value: glowRTs[0].texture }, uHist: { value: null },
    uTexel: { value: new THREE.Vector2() }, uMaxCoc: { value: 1 }, uHistW: { value: 0 },
  });
  const outputPass = postPass(OUTPUT_FRAG, {
    uSrc: { value: null }, uGlow: { value: glowRTs[0].texture }, uAspect: { value: 1 },
    uCA: { value: LENS.CA }, uGlowGain: { value: LENS.GLOW }, uGrain: { value: LENS.GRAIN },
  });

  // Faint specks drifting in the tank.
  const moteScene = new THREE.Scene();
  const moteUniforms = {
    uTime: common.uTime, uPx: { value: 2 }, uLens: composite.uLens, uSS: composite.uSS,
    uOpaqueZ: { value: opaqueRT.depthTexture }, uL0Z: { value: peelRTs[0].depthTexture }, uL0: { value: peelRTs[0].texture },
  };
  const seeds = new Float32Array(LENS.MOTES * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = random();
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LENS.MOTES * 3), 3));
  moteGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  const motes = new THREE.Points(moteGeo, new THREE.ShaderMaterial({
    uniforms: moteUniforms, vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  }));
  motes.frustumCulled = false;
  moteScene.add(motes);

  // dt is the real time since the last drawn frame (0 for a still: the focus settles at once and
  // no earlier frame is blended in); `advanced` says whether the fish moved since.
  function updateLens(dt, advanced) {
    if (advanced) post.frame++;   // grain and lens sampling hold still on a paused frame
    const head = betta.uniforms.uSP.value[2];   // just behind the eye
    const fwd = camera.getWorldDirection(post.fetch);
    const d = Math.max(fwd.dot(head.clone().sub(camera.position)), camera.near * 4);
    post.focus = post.focus && dt > 0 ? approach(post.focus, d, 6, dt) : d;
    const focalPx = post.size.y / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const maxCoc = LENS.MAX_COC * post.ratio;   // MAX_COC is in CSS px
    composite.uLens.value.set(post.focus, LENS.APERTURE * focalPx / post.focus, maxCoc);
    lensPass.u.uMaxCoc.value = maxCoc;
    moteUniforms.uPx.value = post.ratio * 1.2;
    // exposure blend: the share of the last frame an open shutter of SHUTTER seconds would still hold
    lensPass.u.uHistW.value = post.histValid && dt > 0 ? Math.exp(-dt / LENS.SHUTTER) : 0;
    for (const p of [lensPass, outputPass]) p.u.uFrame.value = post.frame % 4096;
  }

  // `cheap` (Eco) drops the full-resolution depth-of-field and shutter pass.
  function render({ dt = 0, advanced = false, cheap = false } = {}) {
    renderer.info.reset();
    syncPellets();
    renderer.setClearColor(0x000000, 1);
    renderer.setRenderTarget(opaqueRT);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setClearColor(0x000000, 0);
    for (let i = 0; i < PEELS; i++) {
      peel.uPeel.value = i;
      peel.uPrevDepth.value = i > 0 ? peelRTs[i - 1].depthTexture : opaqueRT.depthTexture;
      renderer.setRenderTarget(peelRTs[i]);
      renderer.clear();
      renderer.render(finScene, camera);
    }
    peel.uPeel.value = PEELS;
    peel.uPrevDepth.value = peelRTs[PEELS - 1].depthTexture;
    finScene.traverse((o) => { if (o.material) Object.assign(o.material, REST_BLEND); });
    renderer.setRenderTarget(restRT);
    renderer.clear();
    renderer.render(finScene, camera);
    finScene.traverse((o) => { if (o.material) Object.assign(o.material, PEEL_BLEND); });
    updateLens(dt, advanced);
    renderer.setRenderTarget(lensSrcRT);
    renderer.render(compositePass.scene, screenCamera);
    renderer.autoClear = false;
    renderer.render(moteScene, camera);
    renderer.autoClear = true;
    renderer.setRenderTarget(glowRTs[0]);
    renderer.render(downPass.scene, screenCamera);
    for (const [src, dst, x, y] of [[0, 1, 1, 0], [1, 0, 0, 1]]) {
      blurPass.u.uSrc.value = glowRTs[src].texture;
      blurPass.u.uStep.value.set(x / glowRTs[0].width, y / glowRTs[0].height);
      renderer.setRenderTarget(glowRTs[dst]);
      renderer.render(blurPass.scene, screenCamera);
    }
    if (cheap) {
      outputPass.u.uSrc.value = lensSrcRT.texture;
      post.histValid = false;
    } else {
      const [prev, cur] = post.frame % 2 ? histRTs : [histRTs[1], histRTs[0]];
      lensPass.u.uHist.value = prev.texture;
      renderer.setRenderTarget(cur);
      renderer.render(lensPass.scene, screenCamera);
      post.histValid = true;
      outputPass.u.uSrc.value = cur.texture;
    }
    renderer.setRenderTarget(null);
    renderer.render(outputPass.scene, screenCamera);
  }

  // Sizes every target from the framebuffer (w x h device pixels for a css-pixel canvas). The
  // peeled passes supersample 2 x 2 only while four times the framebuffer still fits `maxPixels`.
  function resize(cssWidth, cssHeight, w, h, maxPixels) {
    const ss = w * h * 4 <= maxPixels ? 2 : 1;
    renderer.setSize(w, h, false);
    post.size.set(w, h);
    post.ratio = w / cssWidth;
    for (const rt of [opaqueRT, ...peelRTs, restRT]) rt.setSize(w * ss, h * ss);
    composite.uSS.value = ss;
    for (const rt of [lensSrcRT, ...histRTs]) rt.setSize(w, h);
    for (const rt of glowRTs) rt.setSize(Math.ceil(w / 4), Math.ceil(h / 4));
    downPass.u.uTexel.value.set(1 / w, 1 / h);
    lensPass.u.uTexel.value.set(1 / w, 1 / h);
    outputPass.u.uAspect.value = w / h;
    post.histValid = false;
    camera.aspect = cssWidth / cssHeight;
    camera.updateProjectionMatrix();
    return ss;
  }

  function dispose() {
    const geometries = new Set(), materials = new Set();
    for (const root of [scene, finScene, moteScene, compositePass.scene, downPass.scene, blurPass.scene, lensPass.scene, outputPass.scene]) {
      root.traverse((o) => { if (o.geometry) geometries.add(o.geometry); if (o.material) materials.add(o.material); });
    }
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    pellets.dispose();
    for (const rt of [opaqueRT, ...peelRTs, restRT, lensSrcRT, ...glowRTs, ...histRTs]) { rt.depthTexture?.dispose(); rt.dispose(); }
    renderer.dispose();
  }

  return { renderer, camera, render, resize, dispose };
}
