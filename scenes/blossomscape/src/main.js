import { QUALITY_PRESETS as presets, qualityName, activeQuality, frameRate, framebufferSize, renderScale } from '../../shared/render-policy.js';
import { installControls, reportSceneError, preferredQuality } from '../../shared/controls.js';
import { createFrameLoop } from '../../shared/frame-loop.js';
import { randomGenerator } from '../../shared/random.js';
import { createTerrain } from './site.js';
import { createLight } from './light.js';
import { growTree, BLOSSOM_FLOATS } from './tree.js';
import { createWorld, FIXED_STEP } from './world.js';
import { createRenderer } from './render.js';

const canvas = document.querySelector('#scene'), stage = document.querySelector('#stage'), loading = document.querySelector('#loading');
const params = new URLSearchParams(location.search), isHost = document.documentElement.dataset.motion === 'host';
const capture = params.has('capture');
if (capture) document.body.classList.add('clean', 'capture');
// The evening the world has already had when it first appears, so petals are in the air
// and rings on the water from the first frame.
const SETTLED = 12;
let quality = preferredQuality(params);
let hostRate = isHost ? 0 : 60, onBattery = false, contextLost = false, disposed = false;
let paused = capture || (!isHost && matchMedia('(prefers-reduced-motion: reduce)').matches);
let changeRate = () => {}, changePower = () => {}, feed = () => {};
// Installed before WebGL startup so host rate 0 cannot be lost during initialization.
window.sceneRate = (fps) => { if (!Number.isFinite(fps)) return; const next = Math.max(0, Math.min(60, fps)); if (next === hostRate) return; hostRate = next; changeRate(); };
// This world's one action is a breath of wind through the tree.
window.sceneFeed = () => feed();
window.scenePause = (value) => { paused = Boolean(value); changeRate(); };
// The Mac host knows the power source; a browser only sometimes does (see getBattery below).
window.scenePower = (battery) => { const next = Boolean(battery); if (next === onBattery) return; onBattery = next; changePower(); };

async function start() {
  // A capture is repeatable; a visit is not. The island and its tree are the same either way.
  const seed = capture ? Number(params.get('seed')) || 1 : Math.floor(Math.random() * 2 ** 32);
  const terrain = createTerrain(), light = createLight(), tree = growTree(light);
  light.bake();
  const world = createWorld({ random: randomGenerator(seed), sources: tree.sources, terrain, light });
  const { renderer, render: draw, resize: sizeTargets, advance: moveWater, sight, repaint, dispose } = createRenderer(canvas, { world, tree, light, terrain });
  let loop = null, accumulator = 0, frames = 0, zeroSize = false;
  let cpuEMA = 0, slowSamples = 0, autoScale = 1, ratio = 1;
  const running = () => !disposed && !paused && !document.hidden && !contextLost && !zeroSize && hostRate > 0;
  const fps = () => frameRate(quality, hostRate, onBattery);

  function render() {
    if (contextLost || disposed || document.hidden) return;
    draw();
    frames++;
    if (!loading.hidden) loading.hidden = true;
  }
  // The petals and the wind move on, and the water with them, a few steps at a time.
  function advance(seconds) {
    for (let left = Math.round(seconds / FIXED_STEP); left > 0; left -= 4) {
      const steps = Math.min(4, left);
      for (let i = 0; i < steps; i++) world.step(FIXED_STEP);
      moveWater(steps);
    }
  }
  function renderFrame(elapsed) {
    const before = performance.now();
    accumulator += elapsed;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 6) { world.step(FIXED_STEP); accumulator -= FIXED_STEP; steps++; }
    if (steps === 6) accumulator = 0;
    moveWater(steps);
    render();
    if (!running()) return;
    const cost = performance.now() - before;
    cpuEMA = cpuEMA ? cpuEMA * 0.96 + cost * 0.04 : cost;
    // Conservative one-way downshift, never an oscillating up/down resolution loop.
    // CPU render time is only a pressure signal, not a claimed hardware GPU measurement.
    if (cpuEMA > 1000 / fps() * 0.85 || elapsed > 1.65 / fps()) slowSamples++; else slowSamples = Math.max(0, slowSamples - 1);
    if (slowSamples > 80 && autoScale > 0.72 && !capture) { autoScale = Math.max(0.72, autoScale - 0.1); slowSamples = 0; resize(false); }
  }
  let updateControls = () => {};
  function restart() {
    accumulator = 0;
    loop?.setRate(fps());
    loop?.setPaused(paused);
    loop?.setHidden(document.hidden || contextLost || disposed || zeroSize);
    updateControls();
  }
  changeRate = restart;
  changePower = () => { resize(); restart(); };
  function resize(redrawNow = true) {
    const width = stage.clientWidth, height = stage.clientHeight, preset = presets[activeQuality(quality, onBattery)];
    const wasZeroSize = zeroSize;
    zeroSize = !(width > 0 && height > 0);
    if (zeroSize) { restart(); return; }
    ratio = renderScale(quality, devicePixelRatio, onBattery) * autoScale;
    const { width: w, height: h } = framebufferSize(width, height, ratio, renderer.capabilities.maxTextureSize, preset.pixels);
    ratio = w / width;
    sizeTargets(width, height, w, h);
    if (wasZeroSize) restart();
    if (redrawNow && !document.hidden) render();
  }
  const observer = new ResizeObserver(() => resize());
  observer.observe(stage);
  resize(false);

  // Moving the cursor about stirs up a gust; the world is told where the cursor points.
  function along(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return null;
    return sight(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
  }
  canvas.addEventListener('pointermove', (event) => world.point(along(event.clientX, event.clientY)), { passive: true });
  canvas.addEventListener('pointerleave', () => world.point(null));
  // In a browser a click drops a pebble in the lake, or sends a gust. The wallpaper never gets clicks.
  canvas.addEventListener('click', (event) => { world.tap(along(event.clientX, event.clientY)); if (paused) render(); });
  feed = () => { world.gust(1); };
  updateControls = installControls({
    stage, isPaused: () => paused, isRunning: running,
    pause: window.scenePause, feed: () => feed(), feedIcon: 'breeze', quality: () => quality,
    setQuality(value) { quality = qualityName(value); autoScale = 1; resize(); restart(); },
  });
  document.addEventListener('visibilitychange', () => { world.point(null); if (!document.hidden) { resize(false); if (paused) render(); } restart(); });
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  motionQuery.addEventListener('change', (event) => { if (!isHost && event.matches) { paused = true; restart(); } });
  canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); contextLost = true; restart(); loading.hidden = false; });
  canvas.addEventListener('webglcontextrestored', () => { contextLost = false; repaint(); resize(false); render(); restart(); });
  if (navigator.getBattery && !isHost) {
    navigator.getBattery().then((battery) => { function update() { onBattery = !battery.charging; resize(); restart(); } battery.addEventListener('chargingchange', update); update(); }).catch(() => {});
  }

  advance(SETTLED + (capture ? Math.min(120, Math.max(0, Number(params.get('time')) || 0)) : 0));
  render();
  loop = createFrameLoop(renderFrame, { fps: fps(), paused, hidden: document.hidden || contextLost || zeroSize });
  restart();
  const gl = renderer.getContext();
  window.blossomIsland = {
    ready: true,
    diagnostics: () => ({
      flowers: tree.blossoms.length / BLOSSOM_FLOATS, joints: tree.joints, twigs: tree.twigs, airborne: world.state.airborne, drifting: world.state.drifting,
      frames, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
      pixels: [canvas.width, canvas.height], quality, effectiveFPS: running() ? fps() : 0, renderScale: ratio, cpuFrameEMA: cpuEMA,
      scheduled: loop.state.pending, paused, hostRate, hidden: document.hidden, contextLost, webgl: 'WebGL2', renderer: gl.getParameter(gl.RENDERER),
    }),
    state: () => ({ ...world.state }),
    pause(value = true) { paused = Boolean(value); restart(); },
    advance(seconds) {
      if (!paused) throw new Error('Pause before advancing deterministic capture time.');
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 120) throw new RangeError('Advance must be 0–120 seconds.');
      advance(seconds); render();
    },
    // Frame fractions from the top left, or nothing to take the cursor away.
    cursor(x, y) { world.point(x === undefined ? null : sight(x * 2 - 1, 1 - y * 2)); if (paused) render(); },
    gust(strength = 1) { world.gust(strength); },
  };
  window.sceneStats = window.blossomIsland.diagnostics;
  if (params.get('diagnostics') === '1') {
    const { installDiagnostics } = await import('../../shared/diagnostics.js');
    installDiagnostics({ renderer, loop, renderFrame, stats: window.sceneStats });
  }
  // Release owned GPU objects and stop callbacks when a page is really discarded.
  // BFCache pages retain resources and restart from where the evening had got to.
  addEventListener('pagehide', (event) => {
    loop.setHidden(true); if (event.persisted) return; disposed = true; loop.dispose(); observer.disconnect(); dispose();
  });
  addEventListener('pageshow', (event) => { if (event.persisted) { resize(false); render(); restart(); } });
}
start().catch(reportSceneError);
