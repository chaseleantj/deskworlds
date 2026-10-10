import assert from 'node:assert/strict';
import { renderSettings, framebufferSize } from '../src/render-policy.js';
import { frameRate, qualityName, renderScale, QUALITY_PRESETS } from '../../shared/render-policy.js';
import { createFrameLoop } from '../../shared/frame-loop.js';

const reference = renderSettings({ profile: 'reference', wallpaper: true, pixelRatio: 2 });
const balanced = renderSettings({ wallpaper: true, pixelRatio: 2 });
const battery = renderSettings({ wallpaper: true, pixelRatio: 2, onBattery: true });
assert.equal(reference.resolution, 2);
assert.equal(balanced.resolution, 1.25);
assert.equal(battery.resolution, 1.125);
assert.equal(balanced.samples, 4, 'Preserve quarter-coverage foliage translucency');
assert.equal(balanced.shadowSize, 2048);
assert.equal(balanced.shadowHz, Infinity);
assert.equal(battery.shadowHz, Infinity);
assert.equal(renderSettings({ profile: 'typo' }).name, 'balanced');
assert.equal(renderSettings({ profile: 'reference', pixelRatio: 3 }).resolution, 1.5);
assert.equal(renderSettings({ profile: 'reference', wallpaper: true, pixelRatio: NaN }).resolution, 1.5);
assert.equal(renderSettings({ profile: 'native', wallpaper: true, pixelRatio: 2 }).resolution, 2);
assert.equal(renderSettings({ profile: 'native', pixelRatio: 2 }).maxPixels, 16000000);
assert.deepEqual(renderSettings({ profile: 'native', pixelRatio: 2, onBattery: true }),
  renderSettings({ profile: 'balanced', pixelRatio: 2, onBattery: true }));
assert.equal(frameRate('native', 60), 60);
assert.equal(frameRate('native', 60, true), 30);
assert.equal(framebufferSize(0, 900, 1.25), null);
assert.deepEqual(framebufferSize(1280, 720, 1.25), {width:1600,height:900,scale:1.25});
assert.deepEqual(framebufferSize(10000, 5000, 2, 8192), {width:8192,height:4096,scale:0.8192});

// Virtual time, a real refresh cadence, and separate timer/rAF queues. A stopped
// scene must have no callbacks at all, not just an early return inside a live rAF.
function harness(fps = 30, refreshHz = 60, paused = false) {
  let now = 0, serial = 0, callbacks = 0;
  const tasks = new Map(), frames = [];
  const period = 1000 / refreshHz;
  const add = (fn, due) => { const id=++serial; tasks.set(id,{fn,due}); return id; };
  const loop = createFrameLoop((dt,t) => frames.push({dt,t}), {
    fps, paused, clock:()=>now,
    requestFrame: (fn) => add(fn, (Math.floor((now + 1e-6) / period) + 1) * period),
    cancelFrame: (id)=>tasks.delete(id),
    delay: (fn,ms)=>add(fn,now+ms), cancelDelay:(id)=>tasks.delete(id),
  });
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      let next = null;
      for (const entry of tasks) if (!next || entry[1].due < next[1].due) next = entry;
      if (!next || next[1].due > end + 1e-6) break;
      tasks.delete(next[0]); now=next[1].due; callbacks++; next[1].fn(now);
      assert(callbacks < 100000, 'Unexpected busy loop');
    }
    now=end;
  }
  return {loop,frames,tasks,advance,get callbacks(){return callbacks;}};
}
for (const refresh of [60,120]) for (const fps of [20,30,60]) {
  const h=harness(fps,refresh);h.advance(10000);
  assert(Math.abs(h.frames.length - fps * 10) <= 1, `${fps} fps at ${refresh} Hz: ${h.frames.length}`);
  const simulated = h.frames.reduce((sum,f)=>sum+f.dt,0);
  assert(Math.abs(simulated - (10 - 1/refresh)) < 0.06, `Clock drift: ${simulated}`);
  h.loop.dispose();assert.equal(h.tasks.size,0);
}
const h=harness(30);
h.advance(1000);h.loop.setPaused(true);
const before=h.frames.length, callbacks=h.callbacks;
h.advance(60000);assert.equal(h.frames.length,before);assert.equal(h.callbacks,callbacks);assert.equal(h.tasks.size,0);
h.loop.invalidate();h.advance(100);assert.equal(h.frames.length,before+1);assert.equal(h.frames.at(-1).dt,0);assert.equal(h.tasks.size,0);
h.loop.setPaused(false);h.advance(100);assert(h.frames.length>before+1);assert(h.frames.every(f=>f.dt<=0.1));
h.loop.setRate(0);assert.equal(h.tasks.size,0);h.advance(10000);assert.equal(h.tasks.size,0);
h.loop.setRate(30);h.advance(100);h.loop.setHidden(true);const hiddenFrames=h.frames.length;
h.loop.invalidate();h.advance(10000);assert.equal(h.frames.length,hiddenFrames);assert.equal(h.tasks.size,0);
h.loop.setHidden(false);h.advance(100);assert(h.frames.length>hiddenFrames);assert.equal(h.frames[hiddenFrames].dt,0);
h.loop.setRate(NaN);assert.equal(h.tasks.size,0);
h.loop.setRate(30);h.advance(100);h.loop.dispose();h.loop.invalidate();assert.equal(h.tasks.size,0);
const still=harness(0);still.advance(100);assert.equal(still.frames.length,1);assert.equal(still.tasks.size,0);
const reduced=harness(60,60,true);reduced.advance(1000);assert.equal(reduced.frames.length,1);assert.equal(reduced.tasks.size,0);
console.log('PASS: render budgets, zero-size/large targets, 20/30/60 fps pacing at 60/120 Hz, stop/resume, reduced motion, hidden invalidation and zero idle callbacks');

for (const [quality, fps] of [['eco',20],['balanced',30],['detail',60]]) {
  assert.equal(frameRate(quality), fps);
  assert.equal(frameRate(quality, 0), 0);
  assert.equal(frameRate(quality, NaN), 0);
  assert.equal(frameRate(quality, 60, true), Math.min(fps,30));
  assert.equal(renderScale(quality, 3), QUALITY_PRESETS[quality].dpr);
}
assert.equal(qualityName('toString'), 'balanced');
assert.equal(renderScale('balanced', NaN), 1);
assert.equal(renderScale('detail', 1), 1);
assert.deepEqual(framebufferSize(3840,2160,1.25,8192,1800000), {width:1789,height:1006,scale:Math.sqrt(1800000/(3840*2160))});
