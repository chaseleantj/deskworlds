// Floating betta pellets: pure state and rules, no rendering, so the fish's feeding can be
// tested in node. render.js draws whatever is in `pellets`; behaviour.js hunts them.
//
// Units are the scene's: the body from lips to tail stalk is about 1 long, some 3.5 cm on a
// real betta, so a 1.2 mm pellet is about 0.035 across. A dry pellet lands on the film and floats; surface tension holds it
// until water soaks into the pores and the contact line lets go, which takes a few seconds
// and varies from pellet to pellet. Once wet it falls slowly and nearly straight, turning a
// little about its own axis as an irregular grain does, and softens away.
export const PELLET = {
  radius: [0.016, 0.021],
  float: [2.5, 7],          // s held in the surface film
  sink: [0.035, 0.055],     // fall speed once soaked, per second
  settle: 1.5,              // s to reach that speed after letting go
  wobble: 0.012,            // sideways sway of the fall
  wobbleRate: [0.7, 1.3],   // rad/s
  drift: 0.012,             // slow wander across the film while floating
  turn: [0.2, 0.7],         // rad/s of tumble once sinking
  life: 30,                 // s from touching the water to gone
  fade: 5,                  // s of that over which it dissolves
  stagger: 0.35,            // s over which a pinch lands
  spread: 0.14,             // radius of a pinch on the water
  pinch: [6, 8],
  click: [1, 3],
  capacity: 32,
};

const range = (random, [min, max]) => min + random() * (max - min);

export function createFood(random) {
  const pellets = [];
  let nextId = 1;

  // `count` pellets on the water at (x, z); `surface` is the height of the film.
  function drop(x, z, surface, count) {
    for (let i = 0; i < count && pellets.length < PELLET.capacity; i++) {
      const angle = random() * Math.PI * 2, reach = PELLET.spread * Math.sqrt(random()) * (count > 1 ? 1 : 0.2);
      const radius = range(random, PELLET.radius);
      pellets.push({
        id: nextId++,
        x: x + Math.cos(angle) * reach, y: surface - radius * 0.4, z: z + Math.sin(angle) * reach,
        radius, seed: random(),
        // Negative age: still in the air. The pinch lands over a moment, not all at once.
        age: -random() * PELLET.stagger * (count > 1 ? 1 : 0),
        floatFor: range(random, PELLET.float), sink: range(random, PELLET.sink),
        phase: random() * Math.PI * 2, wobbleRate: range(random, PELLET.wobbleRate),
        driftX: (random() - 0.5) * 2 * PELLET.drift, driftZ: (random() - 0.5) * 2 * PELLET.drift,
        turnRate: range(random, PELLET.turn), turn: random() * Math.PI * 2,
        swayX: 0, swayZ: 0,
      });
    }
  }

  function step(dt) {
    for (let i = pellets.length - 1; i >= 0; i--) {
      const p = pellets[i];
      p.age += dt;
      if (p.age >= PELLET.life) { pellets.splice(i, 1); continue; }
      if (p.age < 0) continue;
      const sinking = p.age - p.floatFor;
      if (sinking < 0) {
        p.x += p.driftX * dt; p.z += p.driftZ * dt;
        continue;
      }
      const ease = Math.min(1, sinking / PELLET.settle);
      p.y -= p.sink * ease * dt;
      p.turn += p.turnRate * ease * dt;
      // The sway is an offset, not a velocity, so it never walks the pellet sideways.
      const a = p.phase + p.wobbleRate * sinking;
      const swayX = PELLET.wobble * ease * Math.sin(a), swayZ = PELLET.wobble * ease * Math.sin(a * 0.73 + 1.9);
      p.x += swayX - p.swayX; p.z += swayZ - p.swayZ;
      p.swayX = swayX; p.swayZ = swayZ;
    }
  }

  // How whole a pellet still is: 1 until it starts to dissolve, 0 when gone.
  const whole = (p) => p.age < 0 ? 0 : Math.min(1, (PELLET.life - p.age) / PELLET.fade);

  // The closest pellet in the water to `point` that lies above `floor`.
  function nearest(point, floor = -Infinity) {
    let best = null, bestD = Infinity;
    for (const p of pellets) {
      if (p.age < 0 || p.y < floor || whole(p) < 0.35) continue;
      const d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2 + (p.z - point.z) ** 2;
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  const has = (p) => pellets.includes(p);
  function eat(p) {
    const i = pellets.indexOf(p);
    if (i >= 0) pellets.splice(i, 1);
  }

  return { pellets, drop, step, whole, nearest, has, eat };
}
