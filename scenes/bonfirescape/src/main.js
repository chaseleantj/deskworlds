import { Vector3 } from 'three';
import { QUALITY_PRESETS as presets, activeQuality, frameRate, framebufferSize, renderScale } from '../../shared/render-policy.js';
import { preferredQuality, reportSceneError } from '../../shared/controls.js';
import { createFrameLoop } from '../../shared/frame-loop.js';
import { randomGenerator } from '../../shared/random.js';
import { createFire, FIXED_STEP } from './fire.js';
import { createRenderer } from './render.js';

const canvas = document.querySelector('#scene'), stage = document.querySelector('#stage'), loading = document.querySelector('#loading');
const params = new URLSearchParams(location.search), isHost = document.documentElement.dataset.motion === 'host';
const capture = params.has('capture');
// Fuel added per metre the cursor sweeps near the fire: a few seconds of fanning revives it.
const FAN = 0.45;
// The flame is marched per pixel; past this many the frame rate suffers more than the picture gains.
const MAX_PIXELS = 4.2e6;
const quality = preferredQuality(params);
let hostRate = isHost ? 0 : 60, onBattery = false, contextLost = false, disposed = false;
let paused = capture || (!isHost && matchMedia('(prefers-reduced-motion: reduce)').matches);
let changeRate = () => {}, changePower = () => {}, stir = () => {};
// Installed before WebGL startup so host rate 0 cannot be lost during initialization.
window.sceneRate = fps => { if (!Number.isFinite(fps)) return; const next = Math.max(0, Math.min(60, fps)); if (next === hostRate) return; hostRate = next; changeRate(); };
window.scenePause = value => { paused = Boolean(value); changeRate(); };
window.sceneFeed = () => stir();
// The Mac host knows the power source; a browser only sometimes does (see getBattery below).
window.scenePower = battery => { const next = Boolean(battery); if (next === onBattery) return; onBattery = next; changePower(); };

async function start() {
  // A capture is repeatable; a visit is not.
  const seed = capture ? Number(params.get('seed')) || 1 : Math.floor(Math.random() * 2 ** 32);
  const fire = createFire({ random: randomGenerator(seed) });
  const { renderer, camera, render: draw, resize: sizeTargets, setView, dispose } = createRenderer(canvas, fire);
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
  function renderFrame(elapsed) {
    const before = performance.now();
    accumulator += elapsed;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 12) { fire.step(FIXED_STEP); accumulator -= FIXED_STEP; steps++; }
    if (steps === 12) accumulator = 0;
    render();
    if (!running()) return;
    const cost = performance.now() - before;
    cpuEMA = cpuEMA ? cpuEMA * 0.96 + cost * 0.04 : cost;
    // Conservative one-way downshift, never an oscillating up/down resolution loop.
    if (cpuEMA > 1000 / fps() * 0.85 || elapsed > 1.65 / fps()) slowSamples++; else slowSamples = Math.max(0, slowSamples - 1);
    if (slowSamples > 80 && autoScale > 0.72 && !capture) { autoScale = Math.max(0.72, autoScale - 0.1); slowSamples = 0; resize(false); }
  }
  function restart() {
    accumulator = 0;
    loop?.setRate(fps());
    loop?.setPaused(paused);
    loop?.setHidden(document.hidden || contextLost || disposed || zeroSize);
  }
  changeRate = restart;
  changePower = () => { resize(); restart(); };
  function resize(redrawNow = true) {
    const width = stage.clientWidth, height = stage.clientHeight, preset = presets[activeQuality(quality, onBattery)];
    const wasZeroSize = zeroSize;
    zeroSize = !(width > 0 && height > 0);
    if (zeroSize) { restart(); return; }
    ratio = renderScale(quality, devicePixelRatio, onBattery) * autoScale;
    const { width: w, height: h } = framebufferSize(width, height, ratio, renderer.capabilities.maxTextureSize, Math.min(preset.pixels, MAX_PIXELS));
    ratio = w / width;
    sizeTargets(width, height, w, h);
    if (wasZeroSize) restart();
    if (redrawNow && !document.hidden) render();
  }
  const observer = new ResizeObserver(() => resize());
  observer.observe(stage);
  resize(false);

  // The cursor stirs the air: near the fire it pushes flames and sparks away from it, and
  // moving it back and forth fans the fire back to life as it burns down.
  const ray = new Vector3();
  let last = null;
  function point(x, y) {
    const rect = canvas.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return;
    ray.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1, 0.5).unproject(camera).sub(camera.position).normalize();
    // Where the ray crosses the vertical plane through the fire.
    const t = -camera.position.z / ray.z;
    const px = camera.position.x + ray.x * t, py = camera.position.y + ray.y * t;
    const dx = -px, dy = 0.6 - py, d = Math.hypot(dx, dy);
    const near = Math.exp(-d * d / 0.8);
    fire.setCursor(d > 1e-3 ? [dx / d * near * 1.2, 0] : null);
    // Metres the cursor swept through near the fire, capped so a jump in position is not a gust.
    if (last && running()) fire.fan(Math.min(0.3, Math.hypot(px - last[0], py - last[1])) * near * FAN);
    last = [px, py];
  }
  canvas.addEventListener('pointermove', event => point(event.clientX, event.clientY), { passive: true });
  canvas.addEventListener('pointerleave', () => { fire.setCursor(null); last = null; });
  canvas.addEventListener('click', () => stir());
  stir = () => { if (running()) fire.stir(1); };
  document.addEventListener('keydown', event => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.code === 'Space') { event.preventDefault(); window.scenePause(!paused); }
    else if (event.key.toLowerCase() === 'f') { if (document.fullscreenElement) document.exitFullscreen(); else stage.requestFullscreen?.().catch(() => {}); }
  });
  document.addEventListener('visibilitychange', () => { fire.setCursor(null); if (!document.hidden) { resize(false); if (paused) render(); } restart(); });
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  motionQuery.addEventListener('change', event => { if (!isHost && event.matches) { paused = true; restart(); } });
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); contextLost = true; restart(); loading.hidden = false; });
  canvas.addEventListener('webglcontextrestored', () => { contextLost = false; resize(false); render(); restart(); });
  if (navigator.getBattery && !isHost) {
    navigator.getBattery().then(battery => { function update() { onBattery = !battery.charging; resize(); restart(); } battery.addEventListener('chargingchange', update); update(); }).catch(() => {});
  }

  // Open on a fire already burning, its sparks already in the air.
  // Fixed steps, then whatever is left, so a scripted capture can move time by any amount.
  const advance = seconds => {
    for (let left = seconds; left > 1e-7; left -= FIXED_STEP) fire.step(Math.min(FIXED_STEP, left));
  };
  advance(4);
  if (capture && params.has('fuel')) { fire.state.fuel = Math.min(1.4, Math.max(0, Number(params.get('fuel')) || 0)); fire.state.vigor = Math.min(1, fire.state.fuel); }
  if (capture) {
    const stirAt = Number(params.get('stir'));
    const total = Math.min(120, Math.max(0, Number(params.get('time')) || 0));
    if (Number.isFinite(stirAt) && params.has('stir')) { advance(Math.max(0, total - stirAt)); fire.stir(1); advance(Math.min(total, stirAt)); }
    else advance(total);
  }
  render();
  loop = createFrameLoop(renderFrame, { fps: fps(), paused, hidden: document.hidden || contextLost || zeroSize });
  restart();
  const gl = renderer.getContext();
  window.bonfire = {
    ready: true,
    diagnostics: () => ({
      time: fire.state.time, fuel: fire.state.fuel, vigor: fire.state.vigor, sparks: fire.state.live, flare: fire.state.flare, frames,
      drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      pixels: [canvas.width, canvas.height], quality, effectiveFPS: running() ? fps() : 0, renderScale: ratio, cpuFrameEMA: cpuEMA,
      paused, hostRate, hidden: document.hidden, contextLost, webgl: 'WebGL2', renderer: gl.getParameter(gl.RENDERER),
    }),
    pause(value = true) { paused = Boolean(value); restart(); },
    advance(seconds) {
      if (!paused) throw new Error('Pause before advancing deterministic capture time.');
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 120) throw new RangeError('Advance must be 0–120 seconds.');
      advance(seconds); render();
    },
    stir: () => fire.stir(1),
    // Turn the camera around the fire (radians) and move it closer (zoom > 1), for captures.
    view(yaw = 0, zoom = 1) { setView(yaw, zoom); if (paused) render(); },
  };
  window.sceneStats = window.bonfire.diagnostics;
  if (params.get('diagnostics') === '1') {
    const { installDiagnostics } = await import('../../shared/diagnostics.js');
    installDiagnostics({ renderer, loop, renderFrame, stats: window.sceneStats });
  }
  // Release owned GPU objects and stop callbacks when a page is really discarded.
  addEventListener('pagehide', event => {
    loop.setHidden(true); if (event.persisted) return; disposed = true; loop.dispose(); observer.disconnect(); dispose();
  });
  addEventListener('pageshow', event => { if (event.persisted) { resize(false); render(); restart(); } });
}
start().catch(reportSceneError);
