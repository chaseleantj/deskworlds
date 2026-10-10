import * as THREE from 'three';
import { approach, smooth01 } from './behaviour.js';

const V3 = THREE.Vector3;
const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// The home camera: (0, 0.15, 5.4) looking at the tank centre with a 30 degree lens.
export const HOME = { target: new V3(0, 0, -0.3), offset: new V3(0, 0.15, 5.7), fov: 30 };
const DIST = [1.4, 12];         // zoom limits
const TAP = 5;                  // px a press may move and still count as a click
const DOUBLE_CLICK = 260;       // ms a click waits in case it is the first of a double-click

// The tank is sized to the home view, so orbiting and zooming never move its walls.
export function homeBounds(aspect) {
  const d = HOME.offset.z - 0.3;
  const halfH = d * Math.tan(THREE.MathUtils.degToRad(HOME.fov / 2));
  const halfW = halfH * aspect;
  return {
    min: new V3(-Math.max(halfW - 1.2, 0.3), -Math.max(halfH - 0.85, 0.2), -2.2),
    max: new V3(Math.max(halfW - 1.2, 0.3), Math.max(halfH - 0.8, 0.2), 0.9),
  };
}

// Orbit view: drag to rotate about the tank, wheel or pinch to zoom, double-click to return home.
// Zooming in hands the orbit centre over to the fish, so a close view keeps it in frame. Without
// `interactive` (the wallpaper) the camera stays home. `onChange` fires on any camera input, so a
// paused scene can draw it; `onTap` gets clicks that were not part of a drag or double-click.
export function createView(camera, canvas, { interactive, follow, onChange: changed = () => {}, onTap = () => {} }) {
  const view = {
    homeTarget: HOME.target.clone(), target: HOME.target.clone(),
    homeDist: HOME.offset.length(), homePitch: Math.atan2(HOME.offset.y, HOME.offset.z),
    yaw: 0, pitch: 0, dist: 0, goalYaw: 0, goalPitch: 0, goalDist: 0, spinYaw: 0, spinPitch: 0,
    drag: null, touches: new Map(), pinch: 0, press: null, tap: 0, pinned: false,
  };
  const onChange = () => { view.pinned = false; changed(); };
  view.pitch = view.goalPitch = view.homePitch;
  view.dist = view.goalDist = view.homeDist;
  camera.fov = HOME.fov;

  if (interactive) {
    canvas.addEventListener('pointerdown', (e) => {
      view.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture(e.pointerId);
      if (view.touches.size === 1) {
        view.drag = { x: e.clientX, y: e.clientY, t: performance.now() };
        view.press = e.button === 0 ? { x: e.clientX, y: e.clientY, moved: 0 } : null;
        canvas.classList.add('dragging');
      }
      if (view.touches.size === 2) { const [a, b] = [...view.touches.values()]; view.pinch = Math.hypot(a.x - b.x, a.y - b.y); view.drag = view.press = null; }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!view.touches.has(e.pointerId)) return;
      view.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (view.touches.size === 2) {
        const [a, b] = [...view.touches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (view.pinch > 0) view.goalDist = clamp(view.goalDist * view.pinch / d, ...DIST);
        view.pinch = d;
        onChange();
      } else if (view.drag) {
        if (view.press) view.press.moved = Math.max(view.press.moved, Math.hypot(e.clientX - view.press.x, e.clientY - view.press.y));
        // a click's own jitter does not turn the camera
        if (view.press && view.press.moved < TAP) return;
        const now = performance.now(), k = 4.5 / innerHeight;
        const dx = (e.clientX - view.drag.x) * k, dy = (e.clientY - view.drag.y) * k;
        view.goalYaw -= dx; view.goalPitch = clamp(view.goalPitch + dy, -1.45, 1.45);
        const dts = Math.max((now - view.drag.t) / 1000, 1 / 240);
        view.spinYaw = -dx / dts; view.spinPitch = dy / dts;
        Object.assign(view.drag, { x: e.clientX, y: e.clientY, t: now });
        onChange();
      }
    });
    const endTouch = (e) => {
      if (!view.touches.delete(e.pointerId)) return;
      if (view.touches.size < 2) view.pinch = 0;
      if (view.touches.size === 0) {
        if (view.drag && performance.now() - view.drag.t > 80) view.spinYaw = view.spinPitch = 0;
        const press = view.press;
        if (e.type === 'pointerup' && press && press.moved < TAP) {
          clearTimeout(view.tap);
          view.tap = setTimeout(() => onTap(press.x, press.y), DOUBLE_CLICK);
        }
        view.drag = view.press = null; canvas.classList.remove('dragging');
      }
    };
    canvas.addEventListener('pointerup', endTouch);
    canvas.addEventListener('pointercancel', endTouch);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      view.goalDist = clamp(view.goalDist * Math.exp(dy * 0.0012), ...DIST);
      onChange();
    }, { passive: false });
    canvas.addEventListener('dblclick', () => {
      clearTimeout(view.tap);
      view.goalYaw = Math.round(view.yaw / TAU) * TAU; view.goalPitch = view.homePitch; view.goalDist = view.homeDist;
      view.spinYaw = view.spinPitch = 0;
      onChange();
    });
  }

  // Eases the camera toward its goal. Returns whether it is still moving.
  function update(dt) {
    if (view.pinned) return false;
    if (!view.drag) {   // a flick keeps turning and coasts to a stop
      view.goalYaw += view.spinYaw * dt;
      view.goalPitch = clamp(view.goalPitch + view.spinPitch * dt, -1.45, 1.45);
      const decay = Math.exp(-3.0 * dt);
      view.spinYaw *= decay; view.spinPitch *= decay;
    }
    view.yaw = approach(view.yaw, view.goalYaw, 12, dt);
    view.pitch = approach(view.pitch, view.goalPitch, 12, dt);
    view.dist = approach(view.dist, view.goalDist, 8, dt);
    const followed = smooth01(view.homeDist * 0.85, 2.2, view.dist);
    const goal = view.homeTarget.clone().lerp(follow(), followed);
    view.target.x = approach(view.target.x, goal.x, 3, dt);
    view.target.y = approach(view.target.y, goal.y, 3, dt);
    view.target.z = approach(view.target.z, goal.z, 3, dt);
    place();
    return Math.abs(view.spinYaw) + Math.abs(view.spinPitch) > 1e-3
      || Math.abs(view.goalYaw - view.yaw) + Math.abs(view.goalPitch - view.pitch) > 1e-4
      || Math.abs(view.goalDist - view.dist) > 1e-3 || view.target.distanceTo(goal) > 1e-3;
  }
  function place() {
    const cp = Math.cos(view.pitch);
    camera.position.set(Math.sin(view.yaw) * cp, Math.sin(view.pitch), Math.cos(view.yaw) * cp)
      .multiplyScalar(view.dist).add(view.target);
    camera.lookAt(view.target);
    camera.updateMatrixWorld();
  }
  place();

  // The cursor is placed on a sheet facing the camera, a little in front of the tank centre. The
  // sheet is anchored to the tank, not to the fish, so a close view that follows the fish cannot
  // set it chasing itself.
  const raycaster = new THREE.Raycaster(), sheet = new THREE.Plane(), ndc = new THREE.Vector2();
  function project(clientX, clientY, out) {
    const box = canvas.getBoundingClientRect();
    ndc.set((clientX - box.left) / box.width * 2 - 1, -(clientY - box.top) / box.height * 2 + 1);
    const n = camera.getWorldDirection(new V3()).negate();
    sheet.setFromNormalAndCoplanarPoint(n, view.homeTarget.clone().addScaledVector(n, 1.0));
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray.intersectPlane(sheet, out);
  }

  return {
    update, project,
    get dragging() { return view.drag !== null || view.touches.size > 0; },
    // Capture framing: hold the camera on an orbit about a target, e.g. a close portrait,
    // until the next camera input.
    set({ yaw = 0, pitch = view.homePitch, dist = view.homeDist, target = HOME.target } = {}) {
      Object.assign(view, { yaw, pitch, dist, goalYaw: yaw, goalPitch: pitch, goalDist: dist, spinYaw: 0, spinPitch: 0, pinned: true });
      view.target.set(...(Array.isArray(target) ? target : target.toArray()));
      place();
    },
  };
}
