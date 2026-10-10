import * as THREE from "three";
import { range, smoothstep, vec } from "./math.js";
import { FLOW_DIRECTION, currentGLSL, waterLitShader, waterTime } from "./water.js";

// Shared foliage construction: the current model in the vertex stage, the submerged
// leaf material, and the blade and stem generators every plant species is built from.

export const TAU = Math.PI * 2;

// Displacement of a strand along `direction`, and its slope along the strand, at distance
// `s` from the root. Drag bends the strand downstream with a deflection that grows with
// the square of the distance and saturates as it streams out; the shear layer over its
// surface raises a wave that travels from root to tip and grows toward the tip. The slope
// rotates the shading normal so light travels down the blade with the wave.
const strandVertex = /* glsl */ `
  attribute vec3 anchor;
  attribute vec4 bend;
  attribute vec4 along;
  attribute float thin;
  varying float vThin;
  ${currentGLSL}
  vec2 strandMotion(vec3 root, vec3 direction, float s, float compliance) {
    float strength = currentStrength(root, waterTime);
    float seed = fract(sin(root.x * 12.9898 + root.z * 78.233) * 43758.5453);
    float phase = seed * 6.2832 + root.x * 0.9;
    float drag = compliance * dot(FLOW_DIRECTION, direction) * strength;
    float saturation = 1.0 + 0.06 * s * s;
    float bendAmount = drag * 0.09 * s * s / saturation;
    float bendSlope = drag * 0.18 * s / (saturation * saturation);
    float gain = compliance * (0.012 + 0.02 * strength);
    float safeS = max(s, 1e-4);
    float sPower = pow(safeS, 0.3);
    float envelope = gain * safeS * sPower;
    float envelopeSlope = gain * 1.3 * sPower;
    float theta = waterTime * 0.95 - 1.05 * s + phase;
    float ripple = waterTime * 1.55 - 1.7 * s + phase * 2.3;
    float shape = sin(theta) + 0.3 * sin(ripple);
    float wave = envelope * shape;
    float waveSlope = envelopeSlope * shape - envelope * (1.05 * cos(theta) + 0.51 * cos(ripple));
    return vec2(bendAmount + wave, bendSlope + waveSlope);
  }
  vec2 gMotion;
`;
const strandNormal = /* glsl */ `
  gMotion = strandMotion(anchor, bend.xyz, along.w, bend.w);
  vec3 objectNormal = normalize(normal - along.xyz * (gMotion.y * dot(bend.xyz, normal)));
`;
const strandPosition = /* glsl */ `
  vec3 transformed = position + bend.xyz * gMotion.x;
  vThin = thin;
`;

// Submerged leaves show almost no specular reflection: leaf tissue and water have
// nearly the same refractive index, so what reaches the eye is diffuse reflection
// and light transmitted through the thin blade.
export function foliageMaterial() {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.58,
    metalness: 0,
    specularIntensity: 0.07,
    side: THREE.DoubleSide,
    vertexColors: true,
    alphaToCoverage: true,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = strandVertex + shader.vertexShader;
    shader.vertexShader = shader.vertexShader
      .replace("#include <beginnormal_vertex>", strandNormal)
      .replace(
        "#include <begin_vertex>",
        `${strandPosition}
      leafUv = uv; leafPosition = position;`,
      );
    shader.vertexShader =
      "varying vec2 leafUv; varying vec3 leafPosition;\n" + shader.vertexShader;
    shader.fragmentShader =
      `varying vec2 leafUv; varying vec3 leafPosition; varying float vThin;
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      /* glsl */ `#include <color_fragment>
      // The midrib highlight fades once a leaf is only a few pixels wide, so needle
      // leaves do not clip to white specks.
      float midrib = (1.0 - smoothstep(.008, .035, abs(leafUv.x - .5))) * (1.0 - smoothstep(.02, .06, fwidth(leafUv.x)));
      float veins = pow(.5 + .5 * cos((leafUv.y - abs(leafUv.x - .5) * .32) * 155.0), 22.0);
      // MSAA shades edge pixels at the pixel centre, where leafUv extrapolates past 0..1;
      // unclamped, this goes hugely negative and ACES turns it into white/black specks.
      float edge = pow(min(abs(leafUv.x - .5) * 2.0, 1.0), 5.0);
      float mottling = .965 + .035 * sin(leafUv.y * 64.0 + sin(leafUv.x * 25.0));
      diffuseColor.rgb *= mottling * (1.0 - .09 * edge + .12 * veins);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.22 + vec3(.008,.012,0.), midrib * .6);
      // Leaf undersides are paler and warmer than the upper surface.
      if (!gl_FrontFacing) diffuseColor.rgb *= vec3(.82, .76, .66);
      // Thin tissue lets part of the scene behind show through. Coverage is held to exact
      // quarters of the four multisamples so the driver never dithers it into a pattern:
      // ribbon leaves pass a quarter of the light, their thinner edges half.
      diffuseColor.a = vThin < .7 ? 1.0 : (edge > .45 ? .5 : .75);
    `,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_maps>",
      /* glsl */ `#include <normal_fragment_maps>
      float rib = exp(-pow((leafUv.x-.5)*60.,2.))*.0015;
      float veinHeight = pow(.5+.5*cos((leafUv.y-abs(leafUv.x-.5)*.32)*155.),16.)*.00025;
      float detailFade = 1.-smoothstep(.003,.012,max(fwidth(leafUv.x),fwidth(leafUv.y)));
      float micro = sin(leafUv.x*230.)*sin(leafUv.y*310.)*.00003*detailFade;
      float surfaceHeight = rib + veinHeight + micro;
      vec3 dp1=dFdx(-vViewPosition),dp2=dFdy(-vViewPosition);
      vec3 r1=cross(dp2,normal),r2=cross(normal,dp1);
      float det=dot(dp1,r1);
      normal=normalize(abs(det)*normal-sign(det)*(dFdx(surfaceHeight)*r1+dFdy(surfaceHeight)*r2));
    `,
    );
    waterLitShader(shader, {
      // Light reaching the far side of a thin leaf is scattered through the tissue, which
      // passes green far more readily than red or blue.
      perLight: /* glsl */ `
        float backLight = saturate(dot(-geometryNormal, lit.direction));
        reflectedLight.directDiffuse += lit.color * backLight * RECIPROCAL_PI * material.diffuseColor * vec3(.55, .85, .30) * (vThin * .9);
      `,
    });
  };
  material.customProgramCacheKey = () => "aquatic-leaves-v2";
  return material;
}

// Shadows follow the same motion.
export function foliageDepth({ animated = true } = {}) {
  const material = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    // Depth shaders do not pass through waterLitShader, so bind the clock here too.
    if (animated) shader.uniforms.waterTime = waterTime;
    shader.vertexShader = strandVertex + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `gMotion = strandMotion(anchor, bend.xyz, along.w, bend.w);
      ${strandPosition}`,
    );
  };
  material.customProgramCacheKey = () => "aquatic-leaf-shadow-v3";
  return material;
}

// How a stem or petiole answers the current at parameter t: it bends across its axis,
// toward wherever the flow pushes it.
export function stemStrand(curve, t, length, compliance) {
  const tangent = curve.getTangent(t);
  const direction = FLOW_DIRECTION.clone().addScaledVector(
    tangent,
    -FLOW_DIRECTION.dot(tangent),
  );
  if (direction.lengthSq() < 1e-4) direction.crossVectors(tangent, vec(0, 1, 0));
  return {
    direction: direction.normalize(),
    tangent,
    distance: t * length,
    compliance,
  };
}

// Each blade is a curved, cupped surface. It bends across its face unless it rides on a
// parent strand, in which case it inherits the parent's motion at the attachment.
export function blade(
  batch,
  points,
  width,
  color,
  root,
  compliance,
  {
    rows = 12,
    cols = 4,
    twist = 0,
    ribbon = false,
    thin = 0.3,
    attached = null,
    browning = 0,
    emit = true,
  } = {},
) {
  // Even an omitted background blade consumes its original two random values. This
  // preserves all subsequent procedural geometry rather than regenerating the scene.
  const phase = range(0, TAU);
  const turn = ribbon ? range(-0.7, 0.7) : range(-0.12, 0.12);
  if (!emit) return;
  const curve =
    points.length === 3
      ? new THREE.QuadraticBezierCurve3(...points)
      : ribbon && points.length === 4
        ? new THREE.CubicBezierCurve3(...points)
        : new THREE.CatmullRomCurve3(points);
  const length = curve.getLength();
  const start = batch.positions.length / 3;
  const brown = new THREE.Color("#6b5a2a");
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const center = curve.getPoint(t);
    const tangent = curve.getTangent(t);
    const theta = twist + turn * t;
    const side = vec(Math.cos(theta), 0, Math.sin(theta));
    side.addScaledVector(tangent, -side.dot(tangent)).normalize();
    const normal = new THREE.Vector3().crossVectors(side, tangent).normalize();
    const envelope = ribbon
      ? Math.pow(Math.sin(Math.PI * Math.pow(t, 0.58)), 0.34)
      : Math.pow(Math.sin(Math.PI * Math.pow(t, 0.73)), 0.76);
    const halfWidth = width * Math.max(0.005, envelope);
    const strand = attached || {
      direction: normal,
      tangent,
      distance: t * length,
      compliance,
    };
    const tint = color
      .clone()
      .multiplyScalar(0.86 + 0.14 * Math.sin(Math.PI * t * 0.9));
    if (browning) tint.lerp(brown, smoothstep(1 - browning, 1, t) * 0.8);
    for (let j = 0; j <= cols; j++) {
      const u = (j / cols) * 2 - 1;
      const wave = 1 + 0.016 * Math.sin(t * 25 + phase) * u * u;
      const p = center.clone().addScaledVector(side, u * halfWidth * wave);
      p.addScaledVector(
        normal,
        halfWidth *
          (0.19 * u * u + 0.045 * Math.sin(t * 15 + phase) * Math.abs(u)),
      );
      batch.vertex(p, [j / cols, t], tint, root, strand, thin);
      if (i < rows && j < cols) {
        const a = start + i * (cols + 1) + j;
        batch.quad(a, a + 1, a + cols + 1, a + cols + 2);
      }
    }
  }
}

export function stem(batch, points, radius, color, root, compliance, attached = null) {
  const curve = new THREE.CatmullRomCurve3(points);
  const length = curve.getLength();
  const rows = Math.max(4, points.length * 3),
    cols = 5;
  const start = batch.positions.length / 3;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows,
      p = curve.getPoint(t),
      tangent = curve.getTangent(t);
    const a = new THREE.Vector3()
      .crossVectors(tangent, vec(0.2, 0.01, 1))
      .normalize();
    const b = new THREE.Vector3().crossVectors(tangent, a).normalize();
    const strand = attached || stemStrand(curve, t, length, compliance);
    for (let j = 0; j <= cols; j++) {
      const angle = (j / cols) * TAU;
      const v = p
        .clone()
        .addScaledVector(a, Math.cos(angle) * radius * (1 - 0.65 * t))
        .addScaledVector(b, Math.sin(angle) * radius * (1 - 0.65 * t));
      batch.vertex(v, [j / cols, t], color, root, strand, 0);
      if (i < rows && j < cols) {
        const k = start + i * (cols + 1) + j;
        batch.quad(k, k + 1, k + cols + 1, k + cols + 2);
      }
    }
  }
  return { curve, length };
}
