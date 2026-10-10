import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../gallery.js', import.meta.url), 'utf8');
function setup(reduceMotion = false) {
  const frames = new Map();
  const timers = new Map();
  let nextId = 0;
  let now = 0;
  const handlers = {};
  const classes = new Set();
  const portals = ['Riverbed', 'Coral reef', 'Betta', 'Plasma globe'].map(name => ({
    offsetWidth: 1000,
    style: { setProperty() {} },
    classList: { toggle(name, on) { this.active = on; } },
    focus() {},
    querySelector: selector => selector === 'h2' ? { firstChild: { textContent: name } } : { style: {} },
    contains: () => false, setAttribute(key, value) { this[key] = value; }, removeAttribute(key) { delete this[key]; },
  }));
  const gallery = {
    clientHeight: 700,
    querySelectorAll: selector => selector === '.portal' ? portals : [],
    classList: { add: (...items) => items.forEach(x => classes.add(x)), remove: (...items) => items.forEach(x => classes.delete(x)) },
    addEventListener: (name, fn) => { handlers[name] = fn; },
    setPointerCapture() {}, hasPointerCapture: () => false,
  };
  const status = {};
  const context = vm.createContext({
    document: { querySelector: selector => selector === '.gallery' ? gallery : selector === '#gallery-status' ? status : {}, addEventListener: (name, fn) => { handlers[name] = fn; } },
    matchMedia: () => ({ matches: reduceMotion }), performance: { now: () => now },
    requestAnimationFrame: fn => { frames.set(++nextId, fn); return nextId; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: (fn, delay) => { timers.set(++nextId, { fn, time: now + delay }); return nextId; },
    clearTimeout: id => timers.delete(id),
  });
  vm.runInContext(source, context);
  return {
    handlers, classes, portals, status, advance: ms => { now += ms; },
    tick(ms = 16) {
      now += ms;
      for (const [id, timer] of timers) {
        if (timer.time <= now) { timers.delete(id); timer.fn(); }
      }
      const pending = [...frames];
      frames.clear();
      for (const [, frame] of pending) frame(now);
    },
    read: code => vm.runInContext(code, context),
  };
}
const wheelEvent = (deltaX, deltaY) => ({ deltaX, deltaY, deltaMode: 0, preventDefault() {} });
{
  const app = setup();
  app.handlers.wheel(wheelEvent(8, -7));
  app.advance(20);
  app.handlers.wheel(wheelEvent(6, -9));
  assert(Math.abs(app.read('wheel.target') - 14 / 650) < 1e-12, 'diagonal noise must not switch axes or reverse motion');
  assert(app.classes.has('is-moving'), 'hover is suppressed throughout the gesture');
}
{
  const app = setup();
  app.read('pointer = gesture(0)');
  app.advance(100);
  app.read('position = 0.22; sample(pointer)');
  app.advance(150);
  assert.equal(app.read('releaseTarget(pointer)'), 1, 'deliberate short drag advances without crossing halfway');
  app.read('position = 0.03; pointer = gesture(0); sample(pointer)');
  assert.equal(app.read('releaseTarget(pointer)'), 0, 'tiny movements return to the current card');
}
{
  const app = setup();
  app.read('pointer = gesture(0)');
  app.advance(40);
  app.read('position = -0.09; sample(pointer)');
  assert.equal(app.read('releaseTarget(pointer)'), -1, 'quick flick advances in its direction');
  app.advance(200);
  assert.equal(app.read('releaseTarget(pointer)'), 0, 'holding after a flick discards stale velocity');
}
{
  const app = setup();
  app.handlers.pointerdown({ isPrimary: true, button: 0, pointerId: 1, clientX: 300, clientY: 100 });
  app.advance(30);
  app.handlers.pointermove({ pointerId: 1, clientX: 100, clientY: 100 });
  app.handlers.pointercancel({ pointerId: 1, type: 'pointercancel' });
  assert.equal(app.read('pointer'), undefined);
  assert.equal(app.classes.has('is-dragging'), false);
}
{
  const app = setup();
  app.read('snap(1)');
  assert.equal(app.read('position'), 0, 'selection does not jump before the first frame');
  app.tick(16);
  assert(app.read('position') > 0 && app.read('position') < 0.02, 'resting navigation accelerates gently');
  app.tick(164);
  assert(app.read('position') < 0.7, 'release is not compressed into the previous 180 ms snap');
  const position = app.read('position');
  const speed = app.read('velocity');
  app.read('snap(-1)');
  assert.equal(app.read('position'), position, 'retargeting preserves visible position');
  assert.equal(app.read('velocity'), speed, 'retargeting preserves speed');
  for (let i = 0; i < 100; i++) app.tick();
  assert.equal(app.read('position'), -1, 'interrupted motion reaches the latest destination');
  assert.equal(app.classes.has('is-moving'), false);
}
{
  const app = setup();
  for (let i = 0; i < 20; i++) {
    app.handlers.wheel(wheelEvent(8, 0));
    app.tick(16);
  }
  assert(app.read('position') < app.read('wheel.target'), 'wheel samples are smoothed instead of jumping');
  app.tick(120);
  assert.equal(app.read('wheel'), undefined, 'wheel idle releases the gesture');
  assert.equal(app.read('destination'), 1, 'slow intentional scroll completes to the next card');
  assert(app.read('position') < 0.8, 'wheel release retains a visible completion phase');
  for (let i = 0; i < 100; i++) app.tick();
  assert.equal(app.read('position'), 1);
}
{
  const app = setup();
  app.handlers.pointerdown({ isPrimary: true, button: 0, pointerId: 1, clientX: 300, clientY: 100 });
  app.advance(80);
  app.handlers.pointermove({ pointerId: 1, clientX: 170, clientY: 100 });
  const position = app.read('position');
  const speed = app.read('velocity');
  app.handlers.pointerup({ pointerId: 1, type: 'pointerup' });
  assert.equal(app.read('position'), position, 'pointer release preserves position');
  assert.equal(app.read('velocity'), speed, 'pointer release carries the hand speed into settling');
  app.tick();
  assert(app.read('position') > position);
  for (let i = 0; i < 100; i++) app.tick();
  assert.equal(app.read('position'), 1);
}
{
  const app = setup(true);
  app.read('snap(1)');
  assert.equal(app.read('position'), 1);
  assert.equal(app.read('animation'), undefined, 'reduced motion does not schedule settling');
}
{
  const app = setup();
  app.handlers.keydown({ key: 'ArrowRight', preventDefault() {} });
  assert.equal(app.read('destination'), 1, 'keyboard uses the same motion destination');
  app.read('select(0)');
  assert.equal(app.read('destination'), 0, 'card selection can retarget the same motion loop');
}
{
  const app = setup();
  app.handlers.wheel(wheelEvent(180, 0));
  app.tick(16);
  for (const delta of [50, 30, 15, 8, 3, 1, 0.3]) {
    app.handlers.wheel(wheelEvent(delta, 0));
    app.tick(32);
    assert(app.read('wheel'), 'momentum tail remains part of the original gesture');
    assert(app.read('velocity') >= 0, 'a decaying wheel tail does not reverse motion');
  }
  app.tick(120);
  for (let i = 0; i < 100; i++) app.tick();
  assert.equal(app.read('position'), 1, 'a momentum tail commits one card');
}
{
  const app = setup();
  app.read('snap(1)');
  app.tick(100);
  let prevented = false;
  const position = app.read('position');
  app.handlers.click({
    target: { closest: () => app.portals[0] }, detail: 1,
    preventDefault() { prevented = true; }, stopPropagation() {},
  });
  assert(prevented, 'a moving card click selects without accidentally opening its scene');
  assert.equal(app.read('destination'), 0, 'clicking during motion retargets the carousel');
  assert.equal(app.read('position'), position, 'click interruption does not jump');
}
{
  const app = setup();
  app.read('snap(1)');
  app.tick(100);
  const position = app.read('position');
  const speed = app.read('velocity');
  app.handlers.pointerdown({ isPrimary: true, button: 0, pointerId: 1, clientX: 300, clientY: 100 });
  assert(app.read('animation'), 'a press alone does not interrupt settling');
  app.handlers.pointerup({ pointerId: 1, type: 'pointerup' });
  assert.equal(app.read('position'), position);
  assert.equal(app.read('velocity'), speed, 'a click release does not reset settling velocity');
  // The press may begin while moving and finish after motion has settled.
  for (let i = 0; i < 100; i++) app.tick();
  let prevented = false;
  app.handlers.click({
    target: { closest: () => app.portals[1] }, detail: 1,
    preventDefault() { prevented = true; }, stopPropagation() {},
  });
  assert(prevented, 'a press begun in motion cannot accidentally navigate after settling');
}
{
  const app = setup();
  app.read('position = 0.8; velocity = 25; snap(1)');
  for (let i = 0; i < 100; i++) {
    app.tick();
    assert(app.read('position') <= 1, 'an extreme flick stops at its selected card without overshooting');
  }
  assert.equal(app.read('position'), 1);
  app.read('velocity = 25; snap(1)');
  app.tick();
  assert.equal(app.read('position'), 1, 'releasing at the destination does not push beyond it');
}
{
  const app = setup();
  const [front, right, left] = [0, 1, 3].map(index => app.read(`layout(${index} - position)`));
  assert.equal(front.depth, 0, 'the selected portal faces the viewer');
  assert(Math.abs(right.x - 48) < 1e-9 && Math.abs(left.x + 48) < 1e-9, 'neighbours recede to either side');
  assert(Math.abs(right.depth - 1) < 1e-9 && Math.abs(left.depth - 1) < 1e-9, 'both neighbours rest at the same depth');
  assert(right.turn < 0 && left.turn > 0, 'neighbours turn towards the centre');
  const zIndex = app.portals.map(portal => portal.style.zIndex);
  assert(zIndex[0] > zIndex[1] && zIndex[1] === zIndex[3], 'the front portal stacks above its neighbours');
  const back = app.read('layout(2)');
  assert(back.depth > 1 && Math.abs(back.x) < 1e-9, 'a portal changing sides passes behind the front one');
}
{
  const app = setup(true);
  const selected = () => app.portals.findIndex(portal => portal.classList.active);
  app.handlers.keydown({ key: 'ArrowLeft', preventDefault() {} });
  assert.equal(selected(), 3, 'going left from the first portal wraps to the last');
  assert.equal(app.status.textContent, 'Plasma globe');
  assert.equal(app.portals[3].role, undefined, 'the selected portal is a link');
  assert.equal(app.portals[0].role, 'button', 'the others select rather than open');
  for (const expected of [0, 1, 2, 3, 0]) {
    app.handlers.keydown({ key: 'ArrowRight', preventDefault() {} });
    assert.equal(selected(), expected, 'going right visits every portal in order and wraps');
  }
  assert.equal(app.portals[0]['aria-label'], 'Open Riverbed');
}
{
  const app = setup(true);
  app.read('select(3)');
  assert.equal(app.read('position'), -1, 'the left neighbour is one step left, not two steps right');
  app.read('select(0)');
  assert.equal(app.read('position'), 0);
  app.read('select(1)');
  assert.equal(app.read('position'), 1, 'the right neighbour is one step right');
  app.read('position = 5; select(0)');
  assert.equal(app.read('position'), 4, 'selection takes the short way round from any lap');
}
console.log('PASS: gallery axis lock, intent, velocity continuity, gentle completion, interruption, reduced motion, cancellation, ring layout and wrap-around');
