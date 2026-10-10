import * as THREE from "three";
import {
  channel,
  groundHeight,
  noise,
  random,
  randomGenerator,
  range,
  smoothstep,
  vec,
} from "./math.js";
import {
  SURFACE_Y,
  currentGLSL,
  surfaceLightGLSL,
  waterLitShader,
  waterTime,
  CURRENT_SPEED,
} from "./water.js";

import { proceduralSurfaceShader, surfaceNoiseGLSL } from "./surfaces.js";

const TAU = Math.PI * 2;

// Moss and algae settle where light reaches, where the current is sheltered, and where the
// aquascaper tied moss on. Coverage runs 0 (bare) to 1 (dense turf). A slow noise field
// lowers the threshold unevenly, so patches sit at different stages of growth.
const MOSS_COLONIES = [
  // The tied-on clump at the fork of the trunk, and a thinner growth higher up.
  { center: vec(1.55, 3.07, 0.05), radius: 1.0, strength: 0.75 },
  { center: vec(2.38, 2.77, 0.15), radius: 0.8, strength: 0.6 },
  { center: vec(0.98, 3.42, -0.3), radius: 0.65, strength: 0.55 },
  { center: vec(-0.9, 6.2, -0.95), radius: 0.5, strength: 0.35 },
  // Stone shoulders: the sheltered side of the main stone where the trunk rises past it,
  // the top of the secondary stone, and the low companions. The main stone's face stays
  // mostly bare.
  { center: vec(3.55, 1.7, 0.3), radius: 0.65, strength: 0.4 },
  { center: vec(-4.25, 1.95, 0.2), radius: 0.5, strength: 0.45 },
  { center: vec(-6.0, 1.1, 0.7), radius: 0.5, strength: 0.4 },
  { center: vec(6.6, 1.35, -0.6), radius: 0.5, strength: 0.4 },
];
// The stones, shared with the plants that grow against them. They follow the convention of
// a planted riverbed: one main stone at the foot of the wood, a secondary stone about two
// thirds its size answering it across the channel, a companion behind each, a pale stone
// at the trunk's base, and small stones trailing off along the sand. `lean` tips a stone
// about the tank's front axis; the two big stones lean in toward the wood between them,
// and the rest lean toward the channel, the way stones settle in a flow.
// Order matters: the epiphytes in `broadleaf.js` hold onto a stone by its index here. Moss
// colonies, fern tufts and sediment are placed by hand, so move a stone's growth with it.
export const ROCKS = [
  { x: 4.7, z: 0.35, rx: 1.7, ry: 1.5, rz: 1.15, lean: 0.15 },
  { x: -4.7, z: -0.35, rx: 1.35, ry: 1.45, rz: 1.0, lean: -0.12 },
  { x: 6.7, z: -0.85, rx: 1.05, ry: 0.82, rz: 1.0, lean: 0.1 },
  { x: -6.05, z: 0.55, rx: 1.05, ry: 0.68, rz: 0.85, lean: -0.08 },
  { x: 3.25, z: 1.45, rx: 0.6, ry: 0.48, rz: 0.55, lean: 0.25, pale: true },
  { x: -3.05, z: 0.6, rx: 0.5, ry: 0.4, rz: 0.45, lean: -0.2 },
  { x: 0.55, z: -2.6, rx: 0.45, ry: 0.36, rz: 0.42, lean: 0.15 },
  { x: 5.35, z: 1.75, rx: 0.42, ry: 0.34, rz: 0.4, lean: 0.2 },
  { x: 6.0, z: 1.3, rx: 0.38, ry: 0.3, rz: 0.35, lean: 0.2 },
  { x: -2.1, z: 1.55, rx: 0.3, ry: 0.22, rz: 0.28, lean: -0.1 },
];
// A stone is buried to a little under half its height, and deeper the more it leans, so
// the raised side of a leaning stone still meets the sand.
export function rockCenterY(rock) {
  return (
    groundHeight(rock.x, rock.z) +
    rock.ry * 0.57 -
    Math.abs(rock.lean) * rock.rx * 0.55
  );
}
// The driftwood: a trunk rising from behind the main stone to the upper left with a fork
// at its tip, a limb reaching forward over the stones toward the glass, a stub higher up,
// and roots at the base that run out over the sand and back behind the main stone. Fish
// swim around the trunk and the limb; the trunk is also somewhere they go to look.
const BRANCHES = [
  {
    p: [
      [3.48, 0.37, -0.15],
      [2.64, 1.52, -0.42],
      [1.37, 3.6, -0.65],
      [0.15, 5.25, -0.85],
      [-1.49, 6.76, -1.05],
      [-3.33, 7.95, -1.05],
    ],
    r: 0.78,
    t: 0.12,
    obstacle: true,
    landmarks: true,
  },
  // The fork starts inside the trunk and is thinner than the trunk where it leaves it, so
  // the join reads as one piece of wood.
  {
    p: [
      [-1.45, 6.7, -1.05],
      [-2.08, 7.14, -1.17],
      [-2.17, 7.85, -1.15],
      [-2.64, 8.43, -1.08],
    ],
    r: 0.15,
    t: 0.017,
  },
  {
    p: [
      [2.71, 1.36, -0.37],
      [3.15, 0.95, -0.6],
      [4.16, 0.36, -0.92],
      [4.84, 0.17, -0.7],
    ],
    r: 0.33,
    t: 0.012,
  },
  {
    p: [
      [2.05, 2.75, -0.5],
      [2.75, 3.15, 0.15],
      [3.45, 3.4, 0.85],
      [4.0, 3.7, 1.4],
    ],
    r: 0.3,
    t: 0.03,
    obstacle: true,
  },
  {
    p: [
      [0.3, 5.03, -0.82],
      [-0.23, 5.59, -0.31],
      [-0.59, 5.76, -0.18],
    ],
    r: 0.21,
    t: 0.012,
  },
  {
    p: [
      [2.9, 0.84, -0.3],
      [1.95, 0.48, -0.06],
      [1.46, 0.14, 0.39],
      [0.74, 0.13, 0.55],
    ],
    r: 0.35,
    t: 0.02,
  },
  {
    p: [
      [2.34, 2.12, -0.38],
      [3.2, 2.58, -1.4],
      [3.55, 3.14, -1.67],
    ],
    r: 0.25,
    t: 0.022,
  },
];

function mossCoverage(p, n, shelter, bias = 0) {
  let colony = 0;
  for (const c of MOSS_COLONIES) {
    const d = p.distanceToSquared(c.center) / (c.radius * c.radius);
    colony = Math.max(colony, c.strength * Math.exp(-d * 1.6));
  }
  const patch =
    noise(p.x * 1.15 + 5.2, p.y * 1.15, p.z * 1.15) * 0.55 +
    noise(p.x * 3.4 + 1.7, p.y * 3.4, p.z * 3.4 + 8.4) * 0.45;
  const age = noise(p.x * 0.4 + 21.3, p.y * 0.4, p.z * 0.4 + 4.6);
  const exposure = 0.4 + 0.6 * Math.max(0, n.y);
  const value = patch * exposure + shelter * 0.25 + colony + bias;
  const threshold = 0.7 - age * 0.3;
  return smoothstep(threshold, threshold + 0.25, value);
}

// Writes per-vertex coverage into `geometry` (in world space through `matrix`) and returns
// the vertices that could carry fronds.
function growMoss(geometry, matrix, shelterAt, bias = 0) {
  const positions = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
  const coverage = new Float32Array(positions.count);
  const samples = [];
  const p = new THREE.Vector3(),
    n = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    p.fromBufferAttribute(positions, i).applyMatrix4(matrix);
    n.fromBufferAttribute(normals, i).applyMatrix3(normalMatrix).normalize();
    const c = mossCoverage(p, n, shelterAt(p, i), bias);
    coverage[i] = c;
    if (c > 0.3)
      samples.push({ position: p.clone(), normal: n.clone(), coverage: c });
  }
  geometry.setAttribute("moss", new THREE.BufferAttribute(coverage, 1));
  return samples;
}

// The moss layer on rock, wood and sand: a thin algal film where growth is young, a dark
// velvety turf where it is established. Turf is rough, its fibres scatter light at grazing
// angles, and its fringe is broken up by fine noise.
const mossGLSL = /* glsl */ `
  varying float vMoss;
  uniform vec3 mossFilm;
  uniform vec3 mossTurf;
  float gMoss = 0.0;
  vec3 gMossColor = vec3(0.0);
  ${surfaceNoiseGLSL}
`;
function mossLayer(material, film, turf, kind) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.mossFilm = { value: new THREE.Color(film) };
    shader.uniforms.mossTurf = { value: new THREE.Color(turf) };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float moss; varying float vMoss;",
      )
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMoss = moss;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${mossGLSL}`)
      .replace(
        "#include <color_fragment>",
        /* glsl */ `
        #include <color_fragment>
        vec3 mossFuzz = vec3(0.0);
        if (vMoss > 0.02) {
          float mossFine = surfaceNoise(vWaterPosition * 9.0) * 0.6 + surfaceNoise(vWaterPosition * 27.0) * 0.4;
          gMoss = smoothstep(0.07, 0.5, vMoss + (mossFine - 0.5) * 0.45);
          gMossColor = mix(mossFilm, mossTurf, smoothstep(0.15, 0.85, vMoss)) * (0.6 + 0.8 * mossFine);
          // Growth lies in the same shade as the surface it grows on: the pit of a stone,
          // a split in the bark, the sand under the canopy.
          #ifdef USE_COLOR
            gMossColor *= vColor;
          #endif
          diffuseColor.rgb = mix(diffuseColor.rgb, gMossColor, gMoss);
          mossFuzz = vec3(mossFine - 0.5, surfaceNoise(vWaterPosition * 31.0 + 7.0) - 0.5, fract(mossFine * 7.0) - 0.5);
        }
      `,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 1.0, gMoss);",
      )
      .replace(
        "#include <normal_fragment_maps>",
        /* glsl */ `
        #include <normal_fragment_maps>
        normal = normalize(normal + gMoss * 0.5 * mossFuzz);
      `,
      )
      .replace(
        "#include <lights_fragment_end>",
        /* glsl */ `
        #include <lights_fragment_end>
        float grazing = pow(1.0 - saturate(dot(normal, geometryViewDir)), 3.0);
        reflectedLight.indirectDiffuse += gMoss * grazing * gMossColor * 0.6;
      `,
      );
    proceduralSurfaceShader(shader, kind);
    waterLitShader(shader);
  };
  material.customProgramCacheKey = () => `procedural-mossy-${kind}-v1`;
  return material;
}

// A young film of algae is olive and thin; established turf is dark green. The film on
// sand is browner (diatoms) than on stone and wood.
function surface(kind, film, turf = "#0b1e08") {
  return mossLayer(
    new THREE.MeshStandardMaterial({ roughness: 1, vertexColors: true }),
    film,
    turf,
    kind,
  );
}

function rockGeometry(seed, detail = 112) {
  const geometry = new THREE.SphereGeometry(
    1,
    detail,
    Math.floor(detail * 0.7),
  );
  const positions = geometry.attributes.position;
  const color = new THREE.Color();
  const colors = [];
  const planes = [];
  const sample = randomGenerator(Math.round(seed * 1000) + 27461);
  const pits = [];
  if (detail > 20)
    for (let i = 0; i < 115; i++) {
      const y = sample() * 2 - 1,
        a = sample() * Math.PI * 2,
        r = Math.sqrt(1 - y * y);
      const radius = 0.022 + sample() ** 2 * 0.18;
      pits.push({
        x: Math.cos(a) * r,
        y,
        z: Math.sin(a) * r,
        radius,
        depth: radius * (0.3 + sample() * 0.8),
      });
    }
  for (let i = 0; i < 15; i++) {
    const a = i * 2.399963 + seed,
      y = 1 - (2 * (i + 0.5)) / 15,
      r = Math.sqrt(1 - y * y);
    planes.push({
      normal: vec(Math.cos(a) * r, y, Math.sin(a) * r),
      distance: 0.76 + noise(i, seed, 4) * 0.35,
    });
  }
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i),
      y = positions.getY(i),
      z = positions.getZ(i);
    const a = noise(x * 2.5 + seed, y * 2.5, z * 2.5);
    const b = noise(x * 7 + seed, y * 7, z * 7);
    const c = noise(x * 22 + seed, y * 22, z * 22);
    const strata = Math.pow(
      Math.abs(Math.sin(x * 3.2 + y * 9 + z * 2.7 + a * 6)),
      18,
    );
    let radius = 1.28;
    for (const plane of planes) {
      const dot = x * plane.normal.x + y * plane.normal.y + z * plane.normal.z;
      if (dot > 0) radius = Math.min(radius, plane.distance / dot);
    }
    radius +=
      (a - 0.5) * 0.1 + (b - 0.5) * 0.055 + (c - 0.5) * 0.023 - strata * 0.017;
    let depression = 0;
    let rim = 0;
    for (const pit of pits) {
      const d =
        Math.sqrt(
          (x - pit.x) ** 2 + ((y - pit.y) * 1.17) ** 2 + (z - pit.z) ** 2,
        ) / pit.radius;
      if (d < 1) depression += pit.depth * (1 - d * d) ** 0.65;
      else if (d < 1.2) rim += (1.2 - d) * 0.1;
    }
    radius -= Math.min(0.25, depression);
    positions.setXYZ(i, x * radius, y * radius, z * radius);
    color
      .setRGB(1, 0.985, 0.945)
      .multiplyScalar(
        (0.8 + 0.2 * a + rim) * (1 - Math.min(0.52, depression * 2.1)),
      );
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function branchGeometry(points, baseRadius, tipRadius, seed) {
  const curve = new THREE.CatmullRomCurve3(points);
  const length = curve.getLength();
  const rows = Math.ceil(length * 30),
    cols = 96;
  const positions = [],
    uv = [],
    indices = [],
    colors = [];
  const frames = curve.computeFrenetFrames(rows, false);
  const splitRandom = randomGenerator(Math.round(seed * 1000) + 51781);
  const splits = Array.from({ length: 14 }, () => ({
    a: splitRandom() * Math.PI * 2,
    t: splitRandom(),
    width: 0.025 + splitRandom() * 0.09,
    length: 0.025 + splitRandom() * 0.15,
    depth: 0.08 + splitRandom() * 0.32,
  }));
  for (let i = 0; i <= rows; i++) {
    const t = i / rows,
      p = curve.getPointAt(t);
    const radius = THREE.MathUtils.lerp(
      baseRadius,
      tipRadius,
      Math.pow(t, 0.8),
    );
    for (let j = 0; j <= cols; j++) {
      const a = (j / cols) * Math.PI * 2;
      const ridges =
        0.077 * Math.sin(a * 9 + t * 12 + seed) +
        0.042 * Math.sin(a * 17 - t * 7) +
        0.022 * Math.sin(a * 31 + t * 33);
      const weather = noise(Math.cos(a) * 5 + seed, t * 30, Math.sin(a) * 5);
      const channel =
        Math.pow(0.5 + 0.5 * Math.sin(a * 13 + Math.sin(t * 15) * 0.25), 10) *
        0.07;
      const knot = 1 + 0.15 * Math.exp(-(((t - 0.47) / 0.08) ** 2));
      let splitDepth = 0;
      for (const split of splits) {
        const angle = a - split.a - 0.07 * Math.sin(t * 37 + seed);
        const around =
          Math.atan2(Math.sin(angle), Math.cos(angle)) / split.width;
        const along = (t - split.t) / split.length;
        const distance = around * around + along * along;
        if (distance < 1)
          splitDepth += split.depth * Math.pow(1 - distance, 0.6);
      }
      const r =
        radius *
        knot *
        (1 +
          ridges +
          (weather - 0.5) * 0.3 -
          channel -
          Math.min(0.65, splitDepth));
      const radial = frames.normals[i]
        .clone()
        .multiplyScalar(Math.cos(a))
        .addScaledVector(frames.binormals[i], Math.sin(a));
      const v = p.clone().addScaledVector(radial, r);
      positions.push(v.x, v.y, v.z);
      uv.push(j / cols, length * t);
      const tint =
        (0.7 + weather * 0.27 + ridges * 0.7 - channel) *
        (1 - Math.min(0.6, splitDepth * 1.5));
      colors.push(tint, tint * 0.97, tint * 0.92);
      if (i < rows && j < cols) {
        const k = i * (cols + 1) + j;
        indices.push(k, k + 1, k + cols + 1, k + 1, k + cols + 2, k + cols + 1);
      }
    }
  }
  // Close the weathered tips; the narrower branches intersect inside their parent.
  for (const i of [0, rows]) {
    const p = curve.getPointAt(i / rows),
      k = positions.length / 3;
    positions.push(p.x, p.y, p.z);
    uv.push(0.5, 0.5);
    colors.push(0.38, 0.32, 0.23);
    for (let j = 0; j < cols; j++) {
      if (i === 0) indices.push(k, j + 1, j);
      else indices.push(k, i * (cols + 1) + j, i * (cols + 1) + j + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createContactShadows(scene, rocks) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(64, 64, 5, 64, 64, 64);
  gradient.addColorStop(0, "rgba(0,0,0,.85)");
  gradient.addColorStop(0.42, "rgba(0,0,0,.48)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const map = new THREE.CanvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    depthWrite: false,
    opacity: 0.67,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  for (const rock of rocks) {
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(rock.rx * 3.5, rock.rz * 3.5),
      material,
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(rock.x, groundHeight(rock.x, rock.z) + 0.008, rock.z);
    scene.add(plane);
  }
}

// One moss frond: a short curved stem carrying pairs of tiny leaflets. Instances differ in
// size, lean and colour with the coverage where they grow.
function frondGeometry() {
  const positions = [],
    colors = [],
    indices = [];
  const stem = new THREE.QuadraticBezierCurve3(
    vec(0, 0, 0),
    vec(0.02, 0.11, 0.01),
    vec(0.07, 0.2, 0.03),
  );
  const push = (p, color) => {
    positions.push(p.x, p.y, p.z);
    colors.push(color.r, color.g, color.b);
    return positions.length / 3 - 1;
  };
  const stemColor = new THREE.Color("#3a5a1e");
  const segments = 4;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments,
      p = stem.getPoint(t),
      radius = 0.0035 * (1 - 0.6 * t);
    for (let j = 0; j < 3; j++) {
      const a = (j / 3) * TAU;
      push(p.clone().add(vec(Math.cos(a) * radius, 0, Math.sin(a) * radius)), stemColor);
      if (i < segments) {
        const k = i * 3 + j,
          next = i * 3 + ((j + 1) % 3);
        indices.push(k, k + 3, next, next, k + 3, next + 3);
      }
    }
  }
  for (let i = 0; i < 6; i++) {
    const t = 0.2 + i * 0.15,
      base = stem.getPoint(t),
      tangent = stem.getTangent(t);
    for (const side of [-1, 1]) {
      const out = vec(side, 0.55 + 0.1 * (i % 2), 0.45 * side * (i % 2 ? 1 : -1)).normalize();
      out.addScaledVector(tangent, -out.dot(tangent) * 0.4).normalize();
      const across = new THREE.Vector3().crossVectors(out, tangent).normalize();
      const length = 0.042 * (1 - 0.08 * i),
        width = 0.017;
      const shade = new THREE.Color().setHSL(0.245 + 0.015 * side, 0.65, 0.22 + 0.05 * t);
      const a = push(base, shade);
      const b = push(base.clone().addScaledVector(out, length * 0.5).addScaledVector(across, width * 0.5), shade);
      const c = push(base.clone().addScaledVector(out, length), shade.clone().multiplyScalar(1.15));
      const d = push(base.clone().addScaledVector(out, length * 0.5).addScaledVector(across, -width * 0.5), shade);
      indices.push(a, b, c, a, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Fronds stand where the turf is dense. They grow up toward the light more than straight
// off the surface, lean at random, and are picked by weighted sampling so the count is fixed.
function plantFronds(scene, groups) {
  const total = groups.reduce((sum, group) => sum + group.count, 0);
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (shader) => waterLitShader(shader);
  material.customProgramCacheKey = () => "moss-frond-v1";
  const fronds = new THREE.InstancedMesh(frondGeometry(), material, total);
  const object = new THREE.Object3D(),
    up = new THREE.Vector3(),
    color = new THREE.Color();
  let index = 0;
  for (const { samples, count, scale = 1 } of groups) {
    const weights = samples.map((s) => Math.max(0, s.coverage - 0.3) ** 2.2);
    const sum = weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < count; i++) {
      let pick = random() * sum,
        j = 0;
      while (j < weights.length - 1 && pick > weights[j]) pick -= weights[j++];
      const { position, normal, coverage } = samples[j];
      up.copy(normal).lerp(vec(0, 1, 0), 0.4).normalize();
      up.add(vec(range(-0.3, 0.3), range(-0.15, 0.15), range(-0.3, 0.3))).normalize();
      object.position.copy(position).addScaledVector(normal, -0.01);
      object.position.add(vec(range(-0.03, 0.03), 0, range(-0.03, 0.03)));
      object.quaternion.setFromUnitVectors(vec(0, 1, 0), up);
      object.rotateY(range(0, TAU));
      const size = (0.4 + coverage * 0.8) * range(0.5, 1.6) * scale;
      object.scale.set(size * range(0.8, 1.2), size, size * range(0.8, 1.2));
      object.updateMatrix();
      fronds.setMatrixAt(index, object.matrix);
      color.setHSL(0.25 + range(-0.02, 0.02), 0.55, 0.42 - coverage * 0.2 + range(-0.05, 0.05));
      fronds.setColorAt(index, color);
      index++;
    }
  }
  fronds.receiveShadow = true;
  scene.add(fronds);
}

export function createEnvironment(scene) {
  const rockMaterial = surface("rock", "#2e4315");
  const woodMaterial = surface("wood", "#334a16");
  const sandMaterial = surface("sand", "#5a5a26", "#23401a");

  const rocks = ROCKS;
  const woodBase = vec(...BRANCHES[0].p[0]);
  // How sheltered the sand is from the flow: against the stones and the foot of the wood,
  // and under the back planting.
  const shelterAt = (x, z) => {
    let shelter = 0;
    for (const r of rocks) {
      const size = Math.max(r.rx, r.rz);
      const gap = Math.hypot(x - r.x, z - r.z) - size;
      shelter = Math.max(shelter, smoothstep(0.6 + 0.8 * size, 0.1, gap));
    }
    shelter = Math.max(
      shelter,
      smoothstep(2.2, 0.3, Math.hypot(x - woodBase.x, z - woodBase.z)),
    );
    return Math.max(shelter, 0.55 * smoothstep(-1.4, -3.2, z));
  };
  // Algae films the sheltered sand; the open channel is swept nearly clean.
  const sandShelter = (p) => shelterAt(p.x, p.z) * (1 - 0.85 * channel(p.x, p.z));
  // Relative sediment density: grit and pebbles gather where the sand is sheltered and
  // along the banks of the channel, where the flow leaving it slackens.
  const sediment = (x, z) => {
    const open = channel(x, z);
    const bank = smoothstep(0.55, 0.2, open) * smoothstep(0.02, 0.1, open);
    return (0.06 + 1.3 * shelterAt(x, z) + 0.6 * bank) * (1 - 0.85 * open);
  };
  // A spot on the sand drawn with probability rising with the sediment there; `floor` is
  // the share that falls everywhere regardless.
  const sedimentSpot = (minX, maxX, minZ, maxZ, floor = 0) => {
    for (;;) {
      const x = range(minX, maxX),
        z = range(minZ, maxZ);
      if (random() * 2 < floor + (1 - floor) * sediment(x, z)) return [x, z];
    }
  };

  const ground = new THREE.PlaneGeometry(24, 18, 200, 140);
  ground.rotateX(-Math.PI / 2);
  const position = ground.attributes.position;
  const groundColors = [];
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      z = position.getZ(i);
    position.setY(i, groundHeight(x, z) + 0.008 * noise(x * 40, 0, z * 40));
    // Sand darkens under the canopy toward the back; the open channel stays lit further in.
    const lit = THREE.MathUtils.smoothstep(z, -4.4, 0.6);
    const litChannel = THREE.MathUtils.smoothstep(z, -6.0, -1.2);
    const shade = 0.04 + 0.96 * Math.max(lit, litChannel * channel(x, z));
    groundColors.push(shade, shade, shade);
  }
  ground.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(groundColors, 3),
  );
  ground.computeVertexNormals();
  const sand = new THREE.Mesh(ground, sandMaterial);
  sand.receiveShadow = true;
  scene.add(sand);
  // Only the most sheltered sand films over; a healthy riverbed is mostly clean.
  const sandSamples = growMoss(
    ground,
    sand.matrix,
    (p) => 0.4 * sandShelter(p),
    -0.26,
  ).filter((s) => s.position.z > -3.6 && Math.abs(s.position.x) < 9.5);

  const obstacles = [];
  const landmarks = [];
  const rockSamples = [];
  // The pale stone is a lighter piece of the same rock, not a second kind of stone.
  const pale = mossLayer(rockMaterial.clone(), "#2e4315", "#0b1e08", "rock");
  pale.color.setRGB(1.75, 1.6, 1.35);
  rocks.forEach((r, i) => {
    const geometry = rockGeometry(i * 2.63);
    const mesh = new THREE.Mesh(geometry, r.pale ? pale : rockMaterial);
    mesh.scale.set(r.rx, r.ry, r.rz);
    mesh.position.set(r.x, rockCenterY(r), r.z);
    // The lean is applied after the stone's turn, about the tank's front axis, so the
    // stones share a direction however each one is turned.
    mesh.rotation.set(range(-0.1, 0.1), range(-3, 3), r.lean, "ZYX");
    mesh.updateMatrix();
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    // Crevices shelter spores: the darker the stone (its pits), the more growth.
    const tints = mesh.geometry.attributes.color;
    rockSamples.push(
      ...growMoss(
        mesh.geometry,
        mesh.matrix,
        (p, index) =>
          0.6 * (1 - tints.getX(index)) +
          0.3 * smoothstep(0.9, 0.2, p.y - groundHeight(p.x, p.z)),
        0.1,
      ),
    );
    const radius = Math.max(r.rx, r.ry, r.rz) * 0.82;
    obstacles.push({ center: mesh.position.clone(), radius });
    if (radius > 0.5)
      landmarks.push({
        kind: "rock",
        point: mesh.position.clone().add(vec(0, r.ry * 0.85, r.rz * 0.55)),
        obstacle: obstacles.length - 1,
      });
  });
  createContactShadows(scene, rocks);

  const smallRockGeometry = rockGeometry(37, 12);
  smallRockGeometry.setAttribute(
    "moss",
    new THREE.BufferAttribute(new Float32Array(smallRockGeometry.attributes.position.count), 1),
  );
  const gravel = new THREE.InstancedMesh(smallRockGeometry, rockMaterial, 340);
  const matrix = new THREE.Object3D(),
    color = new THREE.Color();
  for (let i = 0; i < gravel.count; i++) {
    const [x, z] = sedimentSpot(-8.7, 8.7, -3.2, 3.1);
    // Mostly small, a few large, and the large ones lie where the flow dropped them, by
    // the stones; only fine grains stay in the swept channel. Pebbles lie flat, part sunk
    // in the sand. They are the same rock as the stones.
    const s =
      (0.02 + 0.1 * random() ** 2.4) *
      (0.7 + 0.8 * Math.min(1, sediment(x, z))) *
      (1 - 0.45 * channel(x, z));
    matrix.position.set(x, groundHeight(x, z) + s * 0.3, z);
    matrix.scale.set(s * range(0.8, 1.35), s * range(0.45, 0.8), s);
    matrix.rotation.set(range(-0.4, 0.4), range(0, 3), range(-0.4, 0.4));
    matrix.updateMatrix();
    gravel.setMatrixAt(i, matrix.matrix);
    gravel.setColorAt(i, color.setHSL(0.1, 0.1, range(0.5, 0.95)));
  }
  gravel.castShadow = gravel.receiveShadow = true;
  scene.add(gravel);

  const gritMaterial = new THREE.MeshStandardMaterial({
    color: 0xb6a07a,
    roughness: 1,
  });
  const grit = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0),
    gritMaterial,
    4200,
  );
  for (let i = 0; i < grit.count; i++) {
    const [x, z] = sedimentSpot(-9, 9, -4, 4, 0.35);
    const s = range(0.006, 0.022);
    matrix.position.set(x, groundHeight(x, z) + s * 0.3, z);
    matrix.scale.set(s, s * 0.55, s);
    matrix.rotation.set(range(0, 3), range(0, 3), range(0, 3));
    matrix.updateMatrix();
    grit.setMatrixAt(i, matrix.matrix);
    grit.setColorAt(
      i,
      color.setHSL(range(0.08, 0.16), range(0.12, 0.34), range(0.15, 0.66)),
    );
  }
  grit.receiveShadow = true;
  scene.add(grit);

  const woodSamples = [];
  BRANCHES.forEach((branch, i) => {
    const points = branch.p.map((p) => vec(...p));
    const geometry = branchGeometry(points, branch.r, branch.t, i * 5.7);
    const mesh = new THREE.Mesh(geometry, woodMaterial);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    // Splits and channels in the bark hold moss; the bark tint records them.
    const tints = geometry.attributes.color;
    woodSamples.push(
      ...growMoss(geometry, mesh.matrix, (p, index) => 0.7 * (1 - tints.getX(index)), 0.04),
    );
    if (branch.obstacle) {
      const curve = new THREE.CatmullRomCurve3(points);
      const steps = Math.ceil(curve.getLength() / 0.75);
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const radius =
          THREE.MathUtils.lerp(branch.r, branch.t, t) * 0.87 + 0.12;
        obstacles.push({ center: curve.getPoint(t), radius });
        if (branch.landmarks && t > 0.1 && t < 0.8 && k % 3 === 0)
          landmarks.push({
            kind: "wood",
            point: curve.getPoint(t).add(vec(0, radius * 0.6, radius * 0.9)),
            obstacle: obstacles.length - 1,
          });
      }
    }
  });
  // Fronds stand thick on the tied-on wood clump; on stone and sand the growth is a short
  // turf, so the fronds there are few and small.
  plantFronds(scene, [
    { samples: woodSamples, count: 1600 },
    { samples: rockSamples, count: 800, scale: 0.5 },
    { samples: sandSamples, count: 80, scale: 0.6 },
  ]);
  return { obstacles, landmarks };
}

// Suspended matter that reveals the water: flecks of detritus carried by the current, and
// oxygen bubbles pearling off the plants. Both are lit only where the key light reaches
// them, so they sparkle in the light and vanish in shade.
export function createParticles(scene, { thickets }) {
  const debris = 780,
    bubbles = 120,
    count = debris + bubbles;
  const positions = new Float32Array(count * 3),
    seeds = new Float32Array(count),
    kinds = new Float32Array(count),
    sizes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const bubble = i >= debris;
    if (bubble) {
      const bed = thickets.length ? thickets[i % thickets.length] : null;
      if (bed && i % 3 !== 0)
        positions.set(
          [range(bed.minX, bed.maxX), range(1.5, 6.5), range(bed.minZ, bed.maxZ)],
          i * 3,
        );
      else {
        const x = range(-7, 7),
          z = range(-1.5, 2.6);
        positions.set([x, groundHeight(x, z) + 0.1, z], i * 3);
      }
      sizes[i] = range(0.03, 0.075);
    } else {
      positions.set([range(-9, 9), range(0.4, 9.6), range(-5.4, 3.4)], i * 3);
      // Mostly fine suspended matter, with an occasional larger fragment catching light.
      sizes[i] = 0.005 + 0.038 * random() ** 2.4;
    }
    seeds[i] = random();
    kinds[i] = bubble ? 1 : 0;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("seed", new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute("kind", new THREE.BufferAttribute(kinds, 1));
  geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.lights,
    THREE.UniformsLib.fog,
    { pixelScale: { value: 1000 } },
  ]);
  uniforms.waterTime = waterTime;
  const material = new THREE.ShaderMaterial({
    uniforms,
    lights: true,
    fog: true,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      #include <common>
      #include <packing>
      #include <fog_pars_vertex>
      uniform float pixelScale;
      attribute float seed;
      attribute float kind;
      attribute float size;
      varying float vKind;
      varying float vFade;
      varying float vLight;
      varying vec2 vGlint;
      ${currentGLSL}
      ${surfaceLightGLSL}
      #if NUM_DIR_LIGHT_SHADOWS > 0
        uniform mat4 directionalShadowMatrix[NUM_DIR_LIGHT_SHADOWS];
        uniform sampler2D directionalShadowMap[NUM_DIR_LIGHT_SHADOWS];
      #endif
      void main() {
        float t = waterTime;
        vec3 p = position;
        vKind = kind;
        float tumble = 1.0;
        if (kind > 0.5) {
          // Buoyancy carries a bubble up at a speed set by its size; it wobbles as it rises
          // and is released again at its origin once it reaches the surface.
          float speed = 1.2 + size * 30.0;
          float travel = ${SURFACE_Y.toFixed(1)} - position.y;
          float period = travel / speed + 2.0 + seed * 9.0;
          float age = mod(t + seed * period, period);
          float risen = age * speed;
          p.y += min(risen, travel);
          p.x += sin(age * 6.0 + seed * 20.0) * 0.035;
          p.z += cos(age * 5.1 + seed * 17.0) * 0.03;
          vFade = smoothstep(0.0, 0.15, age) * (1.0 - step(travel, risen));
        } else {
          // Neutrally buoyant flecks ride the current, sinking a little, tumbling as they go.
          p += FLOW_DIRECTION * currentTravel(position, t) * ${CURRENT_SPEED.toFixed(3)} * (0.75 + seed * 0.5);
          p.x = mod(p.x + 9.5, 19.0) - 9.5;
          p.z = mod(p.z + 5.6, 9.2) - 5.6;
          p.y = mod(position.y - t * (0.012 + seed * 0.02) - 0.3, 9.4) + 0.3;
          tumble = 0.35 + 0.65 * abs(sin(t * (1.1 + seed * 2.5) + seed * 40.0));
          vFade = smoothstep(9.5, 8.6, abs(p.x)) * smoothstep(0.3, 0.9, p.y) * (0.45 + 0.55 * fract(seed * 7.31));
        }
        float lit = 1.0;
        #if NUM_DIR_LIGHT_SHADOWS > 0
          vec4 shadowCoord = directionalShadowMatrix[0] * vec4(p, 1.0);
          shadowCoord.xyz /= shadowCoord.w;
          if (all(greaterThan(shadowCoord.xy, vec2(0.0))) && all(lessThan(shadowCoord.xy, vec2(1.0)))) {
            float occluder = unpackRGBAToDepth(texture2D(directionalShadowMap[0], shadowCoord.xy));
            lit = shadowCoord.z - 0.0015 <= occluder ? 1.0 : 0.0;
          }
        #endif
        vec3 water = waterLight(p, t) * waterLightDrift(p, t);
        vLight = (0.08 + 0.92 * lit) * water.g * tumble;
        vGlint = vec2(-0.16, 0.2);
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = max(1.3, size * pixelScale / -mvPosition.z);
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      varying float vKind;
      varying float vFade;
      varying float vLight;
      varying vec2 vGlint;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float r = length(c) * 2.0;
        if (r > 1.0 || vFade <= 0.0) discard;
        vec3 color;
        float alpha;
        if (vKind > 0.5) {
          // An air sphere: light refracts around a dark rim, and a bright glint faces the lamp.
          float rim = smoothstep(0.5, 1.0, r);
          float glint = exp(-dot(c - vGlint, c - vGlint) * 55.0);
          color = mix(vec3(0.22, 0.27, 0.22), vec3(0.02, 0.03, 0.02), rim) * (0.4 + 0.6 * vLight) + glint * 3.2 * vLight;
          alpha = (0.3 + 0.6 * rim) * vFade;
        } else {
          // A matte fleck: bright in the beam, invisible in shade; some are darker plant
          // fragments, some pale mulm.
          color = vec3(0.62, 0.64, 0.5) * vLight * (1.2 + 2.4 * vFade);
          alpha = (1.0 - smoothstep(0.15, 1.0, r)) * vFade * 0.72;
        }
        gl_FragColor = vec4(color, alpha);
        #include <fog_fragment>
      }`,
  });
  const particles = new THREE.Points(geometry, material);
  particles.frustumCulled = false;
  scene.add(particles);
  return {
    // pixelScale converts a world-space size at unit distance into rendered pixels.
    update(pixelScale) {
      uniforms.pixelScale.value = pixelScale;
    },
  };
}
