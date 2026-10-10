const gallery = document.querySelector('.gallery');
const portals = [...gallery.querySelectorAll('.portal')];
const status = document.querySelector('#gallery-status');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const names = portals.map(portal => portal.querySelector('h2').firstChild.textContent);
const DRAG_THRESHOLD = 10;
const WHEEL_IDLE_MS = 120;
const TRACKING_FREQUENCY = 28;
const SETTLE_FREQUENCY = 9;
const REST_DISTANCE = 0.0005;
const REST_SPEED = 0.005;
const INTENT_DISTANCE = 0.18;
const VELOCITY_WINDOW_MS = 100;
const PROJECTION_MS = 140;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrap = value => ((value % portals.length) + portals.length) % portals.length;
const nearest = value => Math.sign(value) * Math.round(Math.abs(value));
const stepWidth = () => portals[0].offsetWidth * 0.65;
let position = 0;
let animation;
let velocity = 0;
let destination = 0;
let wheel;
let pointer;
let suppressClick = false;
let clickDuringMotion = false;

// Portals sit on a ring of three or more, one slot apart; the selected slot faces the viewer.
// Neighbours rest at depth 1, receding to either side. A portal changing ends passes
// the back of the ring (depth above 1), hidden behind the front portal.
const slot = 2 * Math.PI / portals.length;
function layout(offset) {
  const angle = offset * slot;
  const depth = (1 - Math.cos(angle)) / (1 - Math.cos(slot));
  const side = Math.sin(angle) / Math.sin(slot);
  return { x: 48 * side, y: -4 * Math.min(depth, 1), z: -520 * depth, turn: -18 * side, depth };
}
function render() {
  for (const [index, portal] of portals.entries()) {
    const { x, y, z, turn, depth } = layout(index - position);
    portal.style.transform = `translate3d(${x}%, ${y}%, ${z}px) rotateY(${turn}deg)`;
    portal.style.zIndex = Math.round(1000 / (1 + depth));
    portal.style.setProperty('--brightness', 1 - 0.55 * Math.min(depth, 1));
    portal.querySelector('.portal-caption').style.visibility = depth < 0.65 ? 'visible' : 'hidden';
  }
}
function announce() {
  const selected = wrap(nearest(position));
  const restoreFocus = portals.some(portal => portal.contains(document.activeElement));
  for (const [index, portal] of portals.entries()) {
    const active = index === selected;
    portal.classList.toggle('is-active', active);
    portal.setAttribute('aria-label', `${active ? 'Open' : 'Preview'} ${names[index]}`);
    if (active) portal.removeAttribute('role');
    else portal.setAttribute('role', 'button');
  }
  status.textContent = names[selected];
  if (restoreFocus) portals[selected].focus({ preventScroll: true });
}
function gesture(origin) {
  return { origin, samples: [{ position, time: performance.now() }] };
}
function sample(input, value = position) {
  const now = performance.now();
  input.samples.push({ position: value, time: now });
  while (input.samples.length > 2 && input.samples[0].time < now - VELOCITY_WINDOW_MS) input.samples.shift();
}
function releaseVelocity(input, idle = 0) {
  const first = input.samples[0];
  const last = input.samples.at(-1);
  const elapsed = last.time - first.time;
  return elapsed > 0 && performance.now() - last.time < VELOCITY_WINDOW_MS + idle
    ? (last.position - first.position) / elapsed : 0;
}
function releaseTarget(input, idle = 0) {
  const travel = input.samples.at(-1).position - input.origin;
  const intent = travel + releaseVelocity(input, idle) * PROJECTION_MS;
  const origin = nearest(input.origin);
  return Math.abs(intent) >= INTENT_DISTANCE ? origin + Math.sign(intent) : origin;
}
function stopAnimation() {
  cancelAnimationFrame(animation);
  animation = undefined;
  gallery.classList.remove('is-moving');
}
function stopWheel() {
  clearTimeout(wheel?.idle);
  wheel = undefined;
}
function moveTo(target) {
  destination = target;
  if (reducedMotion.matches) {
    stopAnimation();
    position = target;
    velocity = 0;
    render();
    if (!wheel) announce();
    return;
  }
  gallery.classList.add('is-moving');
  if (animation) return;
  let previous = performance.now();
  function frame(now) {
    const dt = (now - previous) / 1000;
    previous = now;
    const frequency = wheel ? TRACKING_FREQUENCY : SETTLE_FREQUENCY;
    // Exact critically damped spring: changing the target preserves position and speed.
    const offset = position - destination;
    const impulse = velocity + frequency * offset;
    const decay = Math.exp(-frequency * dt);
    position = destination + (offset + impulse * dt) * decay;
    velocity = (velocity - frequency * impulse * dt) * decay;
    const resting = Math.abs(position - destination) < REST_DISTANCE && Math.abs(velocity) < REST_SPEED;
    if (resting) {
      position = destination;
      velocity = 0;
    }
    render();
    if (!resting) animation = requestAnimationFrame(frame);
    else {
      animation = undefined;
      if (!wheel) {
        gallery.classList.remove('is-moving');
        announce();
      }
    }
  }
  animation = requestAnimationFrame(frame);
}
function snap(target) {
  stopWheel();
  // Faster releases would carry the critical spring beyond the intended card.
  const distance = target - position;
  if (distance === 0) velocity = 0;
  else if (velocity * distance > 0) {
    velocity = Math.sign(velocity) * Math.min(Math.abs(velocity), SETTLE_FREQUENCY * Math.abs(distance));
  }
  moveTo(target);
}
function select(index) {
  // Take the shorter way round the ring.
  const front = nearest(position);
  const ahead = wrap(index - front);
  snap(front + (ahead > portals.length / 2 ? ahead - portals.length : ahead));
}

document.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.repeat || pointer) return;
  if (event.code === 'Space' && event.target.matches('.portal[role=button]')) {
    event.preventDefault();
    select(portals.indexOf(event.target));
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    snap(nearest(position) + (event.key === 'ArrowRight' ? 1 : -1));
  }
});
gallery.addEventListener('wheel', event => {
  if (event.ctrlKey || pointer) return;
  if (!event.deltaX && !event.deltaY) return;
  event.preventDefault();
  if (!wheel) {
    stopAnimation();
    wheel = { ...gesture(position), target: position, axis: Math.abs(event.deltaX) > Math.abs(event.deltaY) ? 'deltaX' : 'deltaY', idle: undefined };
    gallery.classList.add('is-moving');
  }
  const delta = event[wheel.axis];
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? gallery.clientHeight : 1;
  wheel.target = clamp(wheel.target + delta * unit / stepWidth(), wheel.origin - 1, wheel.origin + 1);
  sample(wheel, wheel.target);
  moveTo(wheel.target);
  clearTimeout(wheel.idle);
  wheel.idle = setTimeout(() => snap(releaseTarget(wheel, WHEEL_IDLE_MS)), WHEEL_IDLE_MS);
}, { passive: false });

gallery.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0) return;
  clickDuringMotion = Boolean(animation || wheel);
  suppressClick = false;
  pointer = { ...gesture(position), id: event.pointerId, x: event.clientX, y: event.clientY, dragged: false };
});
gallery.addEventListener('pointermove', event => {
  if (!pointer || pointer.id !== event.pointerId) return;
  const dx = event.clientX - pointer.x;
  const dy = event.clientY - pointer.y;
  if (!pointer.dragged && (Math.abs(dx) < DRAG_THRESHOLD || Math.abs(dx) <= Math.abs(dy))) return;
  if (!pointer.dragged) {
    pointer.origin = position;
    pointer.samples = [{ position, time: pointer.samples[0].time }];
    stopAnimation();
    stopWheel();
    pointer.dragged = true;
  }
  gallery.setPointerCapture(event.pointerId);
  gallery.classList.add('is-dragging', 'is-moving');
  position = pointer.origin + clamp(-dx / stepWidth(), -1, 1);
  sample(pointer);
  velocity = releaseVelocity(pointer) * 1000;
  render();
});
function endDrag(event) {
  if (!pointer || pointer.id !== event.pointerId) return;
  if (!pointer.dragged) {
    pointer = undefined;
    return;
  }
  const target = event.type !== 'pointerup' ? nearest(pointer.origin) : releaseTarget(pointer);
  velocity = pointer.dragged && event.type === 'pointerup' ? releaseVelocity(pointer) * 1000 : 0;
  suppressClick = pointer.dragged;
  pointer = undefined;
  gallery.classList.remove('is-dragging');
  if (gallery.hasPointerCapture(event.pointerId)) gallery.releasePointerCapture(event.pointerId);
  snap(target);
}
gallery.addEventListener('pointerup', endDrag);
gallery.addEventListener('pointercancel', endDrag);
gallery.addEventListener('lostpointercapture', endDrag);
gallery.addEventListener('dragstart', event => event.preventDefault());
gallery.addEventListener('click', event => {
  const portal = event.target.closest('.portal');
  if (!portal) return;
  if (suppressClick && event.detail !== 0) {
    event.preventDefault();
    event.stopPropagation();
  } else if (clickDuringMotion || animation || wheel || portals.indexOf(portal) !== wrap(nearest(position))) {
    event.preventDefault();
    select(portals.indexOf(portal));
  }
  suppressClick = false;
  clickDuringMotion = false;
}, true);

render();
for (const image of gallery.querySelectorAll('.portal-image img')) {
  const showUnavailable = () => {
    image.hidden = true;
    image.previousElementSibling.hidden = false;
  };
  image.addEventListener('error', showUnavailable);
  if (image.complete && image.naturalWidth === 0) showUnavailable();
}
