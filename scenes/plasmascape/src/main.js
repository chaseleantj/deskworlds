import { Vector3 } from 'three';
import { QUALITY_PRESETS as presets, qualityName, activeQuality, frameRate, framebufferSize, renderScale } from '../../shared/render-policy.js';
import { preferredQuality, reportSceneError } from '../../shared/controls.js';
import { createFrameLoop } from '../../shared/frame-loop.js';
import { randomGenerator } from '../../shared/random.js';
import { createPlasma, fingerTip, FIXED_STEP } from './plasma.js';
import { createRenderer } from './render.js';

const canvas = document.querySelector('#scene'), stage = document.querySelector('#stage'), loading = document.querySelector('#loading');
const params = new URLSearchParams(location.search), isHost = document.documentElement.dataset.motion === 'host';
const capture = params.has('capture');
let quality = preferredQuality(params);
let hostRate = isHost ? 0 : 60, onBattery = false, contextLost = false, disposed = false;
let paused = capture || (!isHost && matchMedia('(prefers-reduced-motion: reduce)').matches);
let changeRate = () => {};
let changePower = () => {};
// Installed before WebGL startup so host rate 0 cannot be lost during initialization.
window.sceneRate = fps => { if (!Number.isFinite(fps)) return; const next = Math.max(0, Math.min(60, fps)); if (next === hostRate) return; hostRate = next; changeRate(); };
window.scenePause = value => { paused = Boolean(value); changeRate(); };
// The Mac host knows the power source; a browser only sometimes does (see getBattery below).
window.scenePower = battery => { const next = Boolean(battery); if (next === onBattery) return; onBattery = next; changePower(); };

async function start() {
  // A capture is repeatable; a visit is not.
  const seed = capture ? 1 : Math.floor(Math.random() * 2 ** 32);
  const plasma = createPlasma({ random: randomGenerator(seed) });
  const { renderer, camera, render: draw, resize: sizeTargets, dispose } = createRenderer(canvas, plasma);
  const ray = new Vector3();
  let loop = null, accumulator = 0, frames = 0, zeroSize = false;
  let cpuEMA = 0, slowSamples = 0, autoScale = 1, ratio = 1;
  const running = () => !disposed && !paused && !document.hidden && !contextLost && !zeroSize && hostRate > 0;
  const fps = () => frameRate(quality, hostRate, onBattery);

  // The cursor is a fingertip: it rests on the glass over the globe and hovers beside it.
  function point(x, y) {
    const rect = canvas.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return;
    ray.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1, 0.5).unproject(camera).sub(camera.position).normalize();
    plasma.setFinger(fingerTip(camera.position, ray));
    if (paused) loop?.invalidate();
  }
  const release = () => { plasma.setFinger(null); if (paused) loop?.invalidate(); };

  function render() {
    if (contextLost || disposed || document.hidden) return;
    plasma.build();
    draw();
    frames++;
    if (!loading.hidden) loading.hidden = true;
  }
  function renderFrame(elapsed) {
    const before = performance.now();
    accumulator += elapsed;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 6) { plasma.step(FIXED_STEP); accumulator -= FIXED_STEP; steps++; }
    if (steps === 6) accumulator = 0;
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
    const { width: w, height: h } = framebufferSize(width, height, ratio, renderer.capabilities.maxTextureSize, preset.pixels);
    ratio = w / width;
    sizeTargets(width, height, w, h);
    if (wasZeroSize) restart();
    if (redrawNow && !document.hidden) render();
  }
  const observer = new ResizeObserver(() => resize());
  observer.observe(stage);
  resize(false);

  canvas.addEventListener('pointermove', event => point(event.clientX, event.clientY), { passive: true });
  canvas.addEventListener('pointerdown', event => point(event.clientX, event.clientY), { passive: true });
  canvas.addEventListener('pointerup', event => { if (event.pointerType !== 'mouse') release(); });
  canvas.addEventListener('pointerleave', release);
  document.addEventListener('keydown', event => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.code === 'Space') { event.preventDefault(); window.scenePause(!paused); }
    else if (event.key.toLowerCase() === 'f') { if (document.fullscreenElement) document.exitFullscreen(); else stage.requestFullscreen?.().catch(() => {}); }
  });
  document.addEventListener('visibilitychange', () => { release(); if (!document.hidden) { resize(false); if (paused) render(); } restart(); });
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  motionQuery.addEventListener('change', event => { if (!isHost && event.matches) { paused = true; restart(); } });
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); contextLost = true; restart(); loading.hidden = false; });
  canvas.addEventListener('webglcontextrestored', () => { contextLost = false; resize(false); render(); restart(); });
  if (navigator.getBattery && !isHost) {
    navigator.getBattery().then(battery => { function update() { onBattery = !battery.charging; resize(); restart(); } battery.addEventListener('chargingchange', update); update(); }).catch(() => {});
  }

  // Capture mode advances the actual simulation, then renders the actual WebGL scene.
  // The finger's channel is chosen from the built geometry, so a jump in time builds along the way.
  const advance = seconds => { for (let i = 0; i < Math.round(seconds / FIXED_STEP); i++) { plasma.step(FIXED_STEP); if (i % 2) plasma.build(); } };
  const fingerParam = (params.get('finger') || '').split(',').map(Number);
  if (capture && fingerParam.length === 2 && fingerParam.every(Number.isFinite)) {
    const rect = canvas.getBoundingClientRect();
    point(rect.left + fingerParam[0] * rect.width, rect.top + fingerParam[1] * rect.height);
    advance(0.8);
  }
  if (capture) advance(Math.min(120, Math.max(0, Number(params.get('time')) || 0)));
  render();
  loop = createFrameLoop(renderFrame, { fps: fps(), paused, hidden: document.hidden || contextLost || zeroSize });
  restart();
  const gl = renderer.getContext();
  window.plasmaGlobe = {
    ready: true,
    diagnostics: () => ({
      ...plasma.state, frames, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      pixels: [canvas.width, canvas.height], quality, effectiveFPS: running() ? fps() : 0, renderScale: ratio, cpuFrameEMA: cpuEMA,
      paused, hostRate, hidden: document.hidden, contextLost, webgl: 'WebGL2', renderer: gl.getParameter(gl.RENDERER),
    }),
    // Client pixel fractions of the canvas, or nothing to lift the finger.
    finger(x, y) { if (x === undefined) release(); else { const rect = canvas.getBoundingClientRect(); point(rect.left + x * rect.width, rect.top + y * rect.height); } render(); },
    pause(value = true) { paused = Boolean(value); restart(); },
    advance(seconds) {
      if (!paused) throw new Error('Pause before advancing deterministic capture time.');
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 120) throw new RangeError('Advance must be 0–120 seconds.');
      advance(seconds); render();
    },
  };
  window.sceneStats = window.plasmaGlobe.diagnostics;
  if (params.get('diagnostics') === '1') {
    const { installDiagnostics } = await import('../../shared/diagnostics.js');
    installDiagnostics({ renderer, loop, renderFrame, stats: window.sceneStats });
  }
  // Release owned GPU objects and stop callbacks when a page is really discarded.
  // BFCache pages retain resources and restart from their old simulation time.
  addEventListener('pagehide', event => {
    loop.setHidden(true); if (event.persisted) return; disposed = true; loop.dispose(); observer.disconnect(); dispose();
  });
  addEventListener('pageshow', event => { if (event.persisted) { resize(false); render(); restart(); } });
}
start().catch(reportSceneError);
