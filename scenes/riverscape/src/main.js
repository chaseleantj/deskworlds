import { qualityName, frameRate } from '../../shared/render-policy.js';
import { installControls, reportSceneError, preferredQuality } from '../../shared/controls.js';
import { createComposite } from './composite.js';
import * as THREE from "three";
import { createEnvironment, createParticles } from "./environment.js";
import { createPlants } from "./plants.js";
import { createFishSchool } from "./fish.js";
import { createFood } from "./food.js";
import { randomGenerator } from "./math.js";
import { waterTime } from "./water.js";
import { createFrameLoop } from "../../shared/frame-loop.js";
import { renderSettings, framebufferSize } from "./render-policy.js";

const canvas = document.querySelector("#scene");
const stage = document.querySelector("#stage");
const loading = document.querySelector("#loading");
// A page that says the host owns its motion leaves the system's reduced-motion
// preference to the host, which is the only one that can offer a way back: the wallpaper
// sits at the desktop window level and never sees a key, so a preview's Space would never
// reach it and the water would be frozen for good. The preview keeps the preference
// itself, where Space can clear it.
let paused =
  document.documentElement.dataset.motion !== "host" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;
const query = new URLSearchParams(location.search);
const wallpaper = document.documentElement.dataset.motion === "host";
let profile = query.get("quality") === "reference" ? "reference" : preferredQuality(query);
if (query.get("still") === "1") paused = true;
let onBattery = false;
let settings = renderSettings({ profile, wallpaper, pixelRatio: devicePixelRatio });
let requestedRate = 60;
let loop = null, applyPower = null, updateControls = () => {};
window.scenePause = (value) => { paused = Boolean(value); loop?.setPaused(paused); updateControls(); };
window.sceneRate = (fps) => {
  requestedRate = Number.isFinite(fps) && fps > 0 ? Math.min(120, fps) : 0;
  loop?.setRate(frameRate(profile, requestedRate, onBattery));
  updateControls();
};
// Geometry never changes on a power transition: no plant popping or regeneration.
window.scenePower = (battery) => {
  const next = Boolean(battery);
  if (next === onBattery) return;
  onBattery = next;
  settings = renderSettings({ profile, wallpaper, pixelRatio: devicePixelRatio, onBattery });
  applyPower?.();
  loop?.setRate(frameRate(profile, requestedRate, onBattery));
  updateControls();
};
// A pinch of food, for a host with no pointer to click with. Defined before the scene
// exists and harmless until it does. Nothing is dropped into water that is not moving,
// whichever of the two reasons it is still for: pellets nobody is drawing are pellets the
// fish never see, and they would all arrive at once whenever the water started again.
let sprinkle = null;
window.sceneFeed = () => {
  if (sprinkle && loop?.state.running) sprinkle();
};



async function start() {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: settings.powerPreference,
  });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  renderer.info.autoReset = false;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.17;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#050f0c");
  // A faint green-blue veil builds along the viewing ray, leaving the foreground clear
  // while the back planting loses a little contrast through the water.
  scene.fog = new THREE.FogExp2("#16312a", 0.034);
  const camera = new THREE.PerspectiveCamera(25.8, 1420 / 740, 0.2, 65);
  camera.position.set(0, 4.65, 20.5);
  camera.lookAt(0, 4.15, 0);

  // Overhead lamp with a soft skylight-like fill; the back light passes through the
  // thin leaves and reads as their translucency.
  scene.add(new THREE.HemisphereLight(0xc3d7bd, 0x353427, 0.3));
  const key = new THREE.DirectionalLight(0xfff8ee, 4.5);
  key.position.set(-3, 11.5, 4.4);
  key.target.position.set(0, 1, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(settings.shadowSize, settings.shadowSize);
  // The frustum reaches the foot of the backboard behind the right-hand bed; a fragment
  // outside the shadow map is lit as if nothing stood in front of it.
  Object.assign(key.shadow.camera, {
    left: -12,
    right: 12,
    top: 14,
    bottom: -10,
    near: 1,
    far: 27,
  });
  key.shadow.bias = -0.00012;
  key.shadow.normalBias = 0.018;
  // Keep the filter footprint approximately the same in world space.
  key.shadow.radius = 3 * settings.shadowSize / 4096;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xc2d8e4, 0.44);
  fill.position.set(1, 5, 10);
  scene.add(fill);
  const back = new THREE.DirectionalLight(0xdbf9ba, 0.8);
  back.position.set(2, 10, -4);
  scene.add(back);

  // A compact HDR environment gives silver scales a broad overhead reflection.
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color("#253129");
  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 4),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(3.7, 3.8, 3.4),
      side: THREE.DoubleSide,
    }),
  );
  strip.position.set(0, 6, 1);
  strip.rotation.x = Math.PI / 2;
  envScene.add(strip);
  const frontBounce = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 8),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.24, 0.32, 0.29),
      side: THREE.DoubleSide,
    }),
  );
  frontBounce.position.z = 8;
  envScene.add(frontBounce);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(envScene, 0.025, 0.1, 30);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();
  strip.geometry.dispose();
  strip.material.dispose();
  frontBounce.geometry.dispose();
  frontBounce.material.dispose();

  // The tank's dark backboard: it catches a little of the lamp and the planting's shadows,
  // so gaps between blades read as lit water in front of a wall rather than a void.
  const backboard = new THREE.Mesh(
    new THREE.PlaneGeometry(44, 24),
    new THREE.MeshStandardMaterial({ color: 0x1d3a2c, roughness: 1 }),
  );
  backboard.position.set(0, 7, -7.2);
  backboard.receiveShadow = true;
  scene.add(backboard);
  const { obstacles, landmarks } = createEnvironment(scene);
  const plants = createPlants(scene, {
    ...settings, animatedShadows: profile !== "reference",
  });
  const food = createFood(scene, { thickets: plants.thickets });
  const fish = createFishSchool(scene, {
    obstacles,
    landmarks,
    thickets: plants.thickets,
    food,
  });
  const particles = createParticles(scene, { thickets: plants.thickets });

  const { target, post, postScene, postCamera } = createComposite(camera, settings);

  let contextLost = false, zeroSize = false, forceShadows = true;
  const maxDimension = Math.min(renderer.capabilities.maxTextureSize,
    renderer.getContext().getParameter(renderer.getContext().MAX_RENDERBUFFER_SIZE));
  function visibility() {
    loop?.setHidden(document.hidden || contextLost || zeroSize);
    updateControls();
  }
  function resize() {
    const bounds = canvas.getBoundingClientRect();
    // DPR may change when a preview moves between monitors.
    settings = renderSettings({ profile, wallpaper, pixelRatio: devicePixelRatio, onBattery });
    const dimensions = framebufferSize(bounds.width, bounds.height, settings.resolution, maxDimension, settings.maxPixels);
    zeroSize = !dimensions;
    visibility();
    if (!dimensions) return;
    const { width, height, scale } = dimensions;
    if (target.width !== width || target.height !== height) {
      renderer.setSize(width, height, false);
      target.setSize(width, height);
      post.uniforms.size.value.set(width, height);
      // Preserve the depth effect's screen-space radius as resolution changes.
      post.uniforms.aoRadiusScale.value = scale / settings.referenceResolution;
      camera.aspect = bounds.width / bounds.height;
      camera.updateProjectionMatrix();
      particles.update(height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)));
      forceShadows = true;
      loop?.invalidate();
    }
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", visibility);
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    contextLost = true;
    visibility();
  });
  canvas.addEventListener("webglcontextrestored", () => {
    // The prefiltered HDR environment is GPU-generated and cannot be recovered just
    // by reuploading CPU textures. Rebuild the scene once instead of rendering black.
    location.reload();
  });
  applyPower = () => { forceShadows = true; resize(); };
  resize();

  // The pointer is a hand at the front glass. The fish read where it is and how fast it
  // is coming toward them, so its velocity is kept, smoothed over a few events, and let
  // die away once the events stop.
  let pointer = null,
    lastPointerTime = 0;
  const pointerPosition = new THREE.Vector3();
  const pointerSample = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const waterPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -2.6);
  canvas.addEventListener("pointermove", (event) => {
    const bounds = canvas.getBoundingClientRect();
    const normalized = new THREE.Vector2(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      (-(event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    raycaster.setFromCamera(normalized, camera);
    if (raycaster.ray.intersectPlane(waterPlane, pointerPosition)) {
      const now = performance.now();
      if (pointer) {
        const seconds = Math.max(0.004, (now - lastPointerTime) / 1000);
        pointerSample
          .subVectors(pointerPosition, pointer.position)
          .divideScalar(seconds);
        pointer.velocity.lerp(pointerSample, 0.5);
        pointer.position.copy(pointerPosition);
      } else
        pointer = {
          position: pointerPosition.clone(),
          velocity: new THREE.Vector3(),
        };
      lastPointerTime = now;
    }
  });
  canvas.addEventListener("pointerleave", () => {
    pointer = null;
  });

  // Clicking the water drops a pinch of food where the click was. The ray is cast again
  // here rather than reusing the hovering pointer, because a touch or a pen presses
  // before it ever moves and there would be nothing to reuse. Only the horizontal place
  // is taken from the click: food is sprinkled onto the surface wherever it landed, and
  // how far back in the tank each pellet falls is food.js's own business, since a click
  // can only ever say two of the three things.
  const dropPoint = new THREE.Vector3();
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !event.isPrimary || !loop?.state.running) return;
    const bounds = canvas.getBoundingClientRect();
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        (-(event.clientY - bounds.top) / bounds.height) * 2 + 1,
      ),
      camera,
    );
    if (raycaster.ray.intersectPlane(waterPlane, dropPoint)) food.drop(dropPoint);
  });
  // The same pinch without a click, for the wallpaper's menu: the cursor is up in the
  // menu bar at that moment, so the food goes over the open middle of the tank instead,
  // in a different place each time.
  const scatter = randomGenerator(715249);
  sprinkle = () => {
    food.drop(dropPoint.set(-3.6 + scatter() * 7.2, 0, 0));
  };

  updateControls = installControls({
    stage, isPaused: () => paused,
    isRunning: () => Boolean(loop?.state.running),
    pause: window.scenePause, feed: window.sceneFeed,
    quality: () => profile === 'reference' ? 'detail' : profile,
    setQuality(value) {
      profile = qualityName(value);
      loop?.setRate(frameRate(profile, requestedRate, onBattery));
      resize();
      updateControls();
    },
  });
  // Mesh transforms are static. Fish/food use instance matrices, foliage and particles
  // move in vertex shaders. Avoid recomposing every unchanged object matrix per frame.
  scene.traverse((object) => { object.updateMatrix(); object.matrixAutoUpdate = false; });
  scene.updateMatrixWorld(true);
  let time = 0, lastShadowTime = -Infinity, renderedFrames = 0, shadowFrames = 0;
  let ready = false;
  function renderFrame(dt, now) {
    // Short substeps keep feeding/swimming stable at 20/30 fps without slowing the
    // simulation down. Long suspended periods never reach this function as elapsed time.
    // Equal steps, rounded to the nearest 60 Hz count: one at 60 fps, two at 30, three
    // at 20. Timer jitter must not turn one step into a full step plus a sliver.
    const total = Math.min(0.1, dt);
    const steps = Math.max(1, Math.round(total * 60));
    const step = total / steps;
    for (let i = 0; total > 0 && i < steps; i++) {
      time += step;
      waterTime.value = time;
      food.update(step, time);
      fish.update(step, time, pointer);
    }
    if (pointer && now - lastPointerTime > 60)
      pointer.velocity.multiplyScalar(Math.exp(-dt * 12));
    const refreshShadow = forceShadows || time - lastShadowTime + 1e-7 >= 1 / settings.shadowHz;
    renderer.shadowMap.needsUpdate = refreshShadow;
    if (refreshShadow) {
      lastShadowTime = time;
      forceShadows = false;
      shadowFrames++;
    }
    renderer.info.reset();
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCamera);
    renderedFrames++;
    if (!ready) {
      ready = true;
      loading.style.opacity = 0;
      setTimeout(() => { loading.hidden = true; }, 850);
    }
  }
  loop = createFrameLoop(renderFrame, {
    fps: frameRate(profile, requestedRate, onBattery), paused, hidden: document.hidden || zeroSize || contextLost,
  });
  updateControls();
  window.sceneStats = () => ({
    profile, onBattery, resolution: settings.resolution,
    framebuffer: [target.width, target.height], samples: target.samples,
    shadowSize: settings.shadowSize,
    shadowHz: Number.isFinite(settings.shadowHz) ? settings.shadowHz : "per-frame",
    renderedFrames, shadowFrames, simulationTime: time,
    drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
    plants: { ...plants.stats }, loop: loop.state,
  });
  // Diagnostics are opt-in: no timing queries, synchronization or arrays in normal use.
  if (query.get("diagnostics") === "1") {
    const { installDiagnostics } = await import("../../shared/diagnostics.js");
    installDiagnostics({ renderer, loop, renderFrame, stats: window.sceneStats });
  }
  window.addEventListener("pagehide", () => {
    loop.setHidden(true);
  });
  window.addEventListener("pageshow", visibility);

}

start().catch(reportSceneError);
