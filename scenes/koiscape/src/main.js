import { QUALITY_PRESETS as presets, qualityName, activeQuality, frameRate, framebufferSize, renderScale } from '../../shared/render-policy.js';
import { installControls, reportSceneError, preferredQuality } from '../../shared/controls.js';
import { createFrameLoop } from '../../shared/frame-loop.js';
import { randomGenerator } from '../../shared/random.js';
import { createPond, fishCount, FIXED_STEP, PELLET } from './pond.js';
import { createRenderer, homeBounds } from './render.js';

const canvas = document.querySelector('#scene'), stage = document.querySelector('#stage'), loading = document.querySelector('#loading');
const params = new URLSearchParams(location.search), isHost = document.documentElement.dataset.motion === 'host';
const capture = params.has('capture');
if (capture) document.body.classList.add('clean', 'capture');
let quality = preferredQuality(params);
let hostRate = isHost ? 0 : 60, onBattery = false, contextLost = false, disposed = false;
let paused = capture || (!isHost && matchMedia('(prefers-reduced-motion: reduce)').matches);
let changeRate = () => {}, changePower = () => {}, feed = () => {};
// Installed before WebGL startup so host rate 0 cannot be lost during initialization.
window.sceneRate = (fps) => { if (!Number.isFinite(fps)) return; const next = Math.max(0, Math.min(60, fps)); if (next === hostRate) return; hostRate = next; changeRate(); };
window.sceneFeed = () => feed();
window.scenePause = (value) => { paused = Boolean(value); changeRate(); };
// The Mac host knows the power source; a browser only sometimes does (see getBattery below).
window.scenePower = (battery) => { const next = Boolean(battery); if (next === onBattery) return; onBattery = next; changePower(); };

// Capture framing, all optional: ?cursor=x,y rests the cursor at that fraction of the frame,
// ?feed=seconds drops a pinch that long before the picture is taken.
function numbers(name, min) { const v = (params.get(name) || '').split(',').map(Number); return v.length >= min && v.every(Number.isFinite) ? v : null; }

async function start() {
  // A capture is repeatable; a visit is not.
  const seed = capture ? Number(params.get('seed')) || 1 : Math.floor(Math.random() * 2 ** 32);
  const random = randomGenerator(seed);
  const first = homeBounds(stage.clientWidth / Math.max(1, stage.clientHeight));
  const pond = createPond({ random, count: fishCount(first.halfW / first.halfH), ...first });
  const { renderer, render: draw, resize: sizeTargets, step: stepRipples, project, locate, dispose } = createRenderer(canvas, pond);
  const between = ([min, max]) => min + Math.floor(random() * (max - min + 1));
  let loop = null, accumulator = 0, frames = 0, zeroSize = false;
  let cpuEMA = 0, slowSamples = 0, autoScale = 1, ratio = 1;
  const running = () => !disposed && !paused && !document.hidden && !contextLost && !zeroSize && hostRate > 0;
  const fps = () => frameRate(quality, hostRate, onBattery);

  const advanceOne = () => { pond.step(FIXED_STEP); stepRipples(); };
  function render() {
    if (contextLost || disposed || document.hidden) return;
    draw({ cheap: quality === 'eco' });
    frames++;
    if (!loading.hidden) loading.hidden = true;
  }
  function renderFrame(elapsed) {
    const before = performance.now();
    accumulator += elapsed;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 6) { advanceOne(); accumulator -= FIXED_STEP; steps++; }
    if (steps === 6) accumulator = 0;
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
    const { halfW, halfH } = sizeTargets(width, height, w, h);
    pond.setBounds(halfW, halfH);
    if (wasZeroSize) restart();
    if (redrawNow && !document.hidden) render();
  }
  const observer = new ResizeObserver(() => resize());
  observer.observe(stage);
  resize(false);

  // The cursor is a fingertip at the surface of the water.
  function point(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return null;
    const at = project(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
    pond.point(at.x, at.z);
    return at;
  }
  canvas.addEventListener('pointermove', (event) => { point(event.clientX, event.clientY); }, { passive: true });
  canvas.addEventListener('pointerleave', () => pond.point(null));
  // In a browser a click drops a few pellets where it lands. The wallpaper never gets clicks.
  canvas.addEventListener('click', (event) => {
    if (isHost || !running()) return;
    const at = point(event.clientX, event.clientY);
    if (at) pond.feed(at.x, at.z, between(PELLET.click));
  });
  feed = () => { if (running()) pond.pinch(); };
  updateControls = installControls({
    stage, isPaused: () => paused, isRunning: running,
    pause: window.scenePause, feed, quality: () => quality,
    setQuality(value) { quality = qualityName(value); autoScale = 1; resize(); restart(); },
  });
  document.addEventListener('visibilitychange', () => { pond.point(null); if (!document.hidden) { resize(false); if (paused) render(); } restart(); });
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  motionQuery.addEventListener('change', (event) => { if (!isHost && event.matches) { paused = true; restart(); } });
  canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); contextLost = true; restart(); loading.hidden = false; });
  canvas.addEventListener('webglcontextrestored', () => { contextLost = false; resize(false); render(); restart(); });
  if (navigator.getBattery && !isHost) {
    navigator.getBattery().then((battery) => { function update() { onBattery = !battery.charging; resize(); restart(); } battery.addEventListener('chargingchange', update); update(); }).catch(() => {});
  }

  // Capture mode advances the actual simulation, ripples included, then renders the actual scene.
  const advance = (seconds) => { for (let i = 0; i < Math.round(seconds / FIXED_STEP); i++) advanceOne(); };
  if (capture) {
    const total = Math.min(120, Math.max(0, Number(params.get('time')) || 0));
    const cursor = numbers('cursor', 2), fed = Math.min(total, Math.max(0, Number(params.get('feed')) || 0));
    const hold = () => { if (cursor) pond.point((cursor[0] * 2 - 1) * pond.bounds.halfW, (cursor[1] * 2 - 1) * pond.bounds.halfH); };
    for (let i = 0, n = Math.round(total / FIXED_STEP), feedAt = Math.round((total - fed) / FIXED_STEP); i < n; i++) {
      if (params.has('feed') && i === feedAt) pond.pinch();
      hold();
      advanceOne();
    }
  } else {
    // A visit opens on a pond already in motion, not on fish starting from rest.
    for (let i = 0; i < 240; i++) pond.step(FIXED_STEP);
    pond.impulses.length = 0;
  }
  render();
  loop = createFrameLoop(renderFrame, { fps: fps(), paused, hidden: document.hidden || contextLost || zeroSize });
  restart();
  const gl = renderer.getContext();
  window.koiPond = {
    ready: true,
    diagnostics: () => ({
      ...pond.diagnostics(), frames, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
      pixels: [canvas.width, canvas.height], quality, effectiveFPS: running() ? fps() : 0, renderScale: ratio, cpuFrameEMA: cpuEMA,
      scheduled: loop.state.pending, paused, hostRate, hidden: document.hidden, contextLost, webgl: 'WebGL2', renderer: gl.getParameter(gl.RENDERER),
    }),
    // Where each fish is in the frame (fractions of its width and height), for framing captures.
    fish: () => pond.fish.map((f) => ({ variety: f.variety, length: f.len, depth: f.depth, mode: f.mode, heading: f.heading, ...locate(f.x, f.z) })),
    pause(value = true) { paused = Boolean(value); restart(); },
    advance(seconds) {
      if (!paused) throw new Error('Pause before advancing deterministic capture time.');
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 120) throw new RangeError('Advance must be 0–120 seconds.');
      advance(seconds); render();
    },
    // Frame fractions, or nothing to lift the cursor out of the water.
    cursor(x, y) { if (x === undefined) pond.point(null); else pond.point((x * 2 - 1) * pond.bounds.halfW, (y * 2 - 1) * pond.bounds.halfH); },
    feed: () => pond.pinch(),
  };
  window.sceneStats = window.koiPond.diagnostics;
  if (params.get('diagnostics') === '1') {
    const { installDiagnostics } = await import('../../shared/diagnostics.js');
    installDiagnostics({ renderer, loop, renderFrame, stats: window.sceneStats });
  }
  // Release owned GPU objects and stop callbacks when a page is really discarded.
  // BFCache pages retain resources and restart from their old simulation time.
  addEventListener('pagehide', (event) => {
    loop.setHidden(true); if (event.persisted) return; disposed = true; loop.dispose(); observer.disconnect(); dispose();
  });
  addEventListener('pageshow', (event) => { if (event.persisted) { resize(false); render(); restart(); } });
}
start().catch(reportSceneError);
