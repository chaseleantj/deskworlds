// Shared by the substrate, driftwood, stone and the algae growing over them.
export const surfaceNoiseGLSL = /* glsl */ `
  float surfaceHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float surfaceNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(surfaceHash(i), surfaceHash(i + vec3(1, 0, 0)), f.x), mix(surfaceHash(i + vec3(0, 1, 0)), surfaceHash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(surfaceHash(i + vec3(0, 0, 1)), surfaceHash(i + vec3(1, 0, 1)), f.x), mix(surfaceHash(i + vec3(0, 1, 1)), surfaceHash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  // Frequencies above the pixel footprint fade to their mean instead of sparkling.
  float surfaceGrain(vec3 p) {
    float footprint = max(length(dFdx(p)), length(dFdy(p)));
    return mix(surfaceNoise(p), 0.5, smoothstep(0.35, 1.4, footprint));
  }
`;

const reliefGLSL = /* glsl */ `
  varying vec2 vSurfaceUv;
  float surfaceHeight = 0.0;
  float surfaceRoughness = 1.0;
  vec3 surfaceNormal(vec3 n, vec3 p, float height) {
    vec3 dx = dFdx(p), dy = dFdy(p);
    vec3 r1 = cross(dy, n), r2 = cross(n, dx);
    float det = dot(dx, r1);
    vec3 gradient = sign(det) * (dFdx(height) * r1 + dFdy(height) * r2);
    return normalize(abs(det) * n - gradient);
  }
`;

const surfaces = {
  rock: /* glsl */ `
    vec3 p = vWaterPosition;
    float body = surfaceNoise(p * 2.4 + 13.7);
    float weather = surfaceNoise(p * 7.0 + body * 1.5);
    float grain = surfaceGrain(p * 65.0);
    float mineral = surfaceGrain(p * 145.0 + 9.0);
    // Folded sedimentary seams wander through the volume, with finer fissures
    // branching off them. World coordinates keep every stone free of UV seams.
    float bed = p.y * 5.8 + p.x * 1.7 + p.z * 2.1 + body * 4.8 + weather * 0.8;
    float seam = 1.0 - smoothstep(0.008, 0.045 + fwidth(bed), abs(sin(bed)));
    seam *= smoothstep(0.22, 0.6, surfaceNoise(p * 4.5 + 37.0));
    float fracture = pow(1.0 - abs(2.0 * surfaceNoise(p * 15.0) - 1.0), 24.0);
    vec3 stone = mix(vec3(0.025, 0.030, 0.025), vec3(0.105, 0.103, 0.082),
      smoothstep(0.15, 0.85, body * 0.45 + weather * 0.55));
    stone *= 0.7 + grain * 0.6;
    stone = mix(stone, vec3(0.17, 0.155, 0.115), smoothstep(0.78, 0.92, mineral) * 0.3);
    stone *= 1.0 - 0.28 * seam - 0.2 * fracture;
    diffuseColor.rgb *= stone;
    surfaceHeight = weather * 0.018 + grain * 0.006 - seam * 0.005 - fracture * 0.004;
    surfaceRoughness = 0.83 + grain * 0.16;
  `,
  wood: /* glsl */ `
    float angle = vSurfaceUv.x * 6.28318530718;
    float along = vSurfaceUv.y;
    // Sampling on a cylinder makes the grain periodic around the branch. Its
    // length coordinate follows the curve rather than a fixed world-space axis.
    vec3 cylinder = vec3(cos(angle), sin(angle), along);
    float weather = surfaceNoise(cylinder * vec3(6.0, 6.0, 2.0) + 8.0);
    float warp = surfaceNoise(cylinder * vec3(9.0, 9.0, 3.5));
    float coarse = surfaceGrain(cylinder * vec3(22.0, 22.0, 5.0) + warp * 0.8);
    float fibres = surfaceGrain(cylinder * vec3(60.0, 60.0, 12.0) + warp * 1.8);
    float grain = surfaceGrain(cylinder * vec3(130.0, 130.0, 30.0));
    float phase = angle * 27.0 + sin(along * 4.0 + angle * 3.0) * 0.6 + warp * 4.0;
    float split = pow(0.5 + 0.5 * sin(phase), 16.0);
    split *= 1.0 - smoothstep(0.3, 1.5, fwidth(phase));
    split *= smoothstep(0.25, 0.62, weather);
    float erosion = surfaceGrain(vWaterPosition * 16.0 + 21.0);
    float fissure = 1.0 - smoothstep(0.22, 0.4, coarse);
    vec3 wood = mix(vec3(0.023, 0.019, 0.012), vec3(0.18, 0.14, 0.081), weather);
    wood *= 0.4 + 0.9 * coarse + 0.35 * fibres;
    wood = mix(wood, vec3(0.014, 0.012, 0.008), max(split * 0.65, fissure * 0.6));
    float exposed = smoothstep(0.56, 0.77, coarse) * smoothstep(0.35, 0.7, erosion);
    wood = mix(wood, vec3(0.21, 0.166, 0.095), exposed * 0.55);
    diffuseColor.rgb *= wood * (0.85 + grain * 0.3);
    surfaceHeight = coarse * 0.016 + fibres * 0.007 + grain * 0.002 - split * 0.012 - fissure * 0.009;
    surfaceRoughness = 0.82 + erosion * 0.17;
  `,
  sand: /* glsl */ `
    vec3 p = vWaterPosition;
    float drift = surfaceNoise(p * vec3(1.2, 1.2, 2.5) + 17.0);
    float deposits = surfaceGrain(p * 7.0 + 5.2) * 0.6 + surfaceGrain(p * 19.0 + 25.0) * 0.4;
    float grit = surfaceGrain(p * 38.0);
    float fine = surfaceGrain(p * 85.0 + 4.7);
    // Irregular quartz grains with a dark contact edge. The cell identity drives
    // both mineral colour and relief, and averages out beyond its visible scale.
    vec2 grainPoint = p.xz * 28.0;
    vec2 cell = floor(grainPoint), local = fract(grainPoint);
    float nearest = 2.0, mineral = 0.5;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 offset = vec2(float(x), float(y));
        vec2 id = cell + offset;
        vec2 seed = vec2(surfaceHash(vec3(id, 5.0)), surfaceHash(vec3(id, 19.0)));
        vec2 delta = offset + 0.15 + seed * 0.7 - local;
        float distance = dot(delta, delta);
        if (distance < nearest) {
          nearest = distance;
          mineral = surfaceHash(vec3(id, 31.0));
        }
      }
    }
    float footprint = max(length(dFdx(grainPoint)), length(dFdy(grainPoint)));
    float resolved = 1.0 - smoothstep(0.5, 1.6, footprint);
    float quartz = exp(-nearest * 5.0);
    float ripplePhase = p.z * 24.0 + p.x * 3.0 + drift * 3.5;
    float ripple = sin(ripplePhase) * (0.4 + 0.6 * drift);
    vec3 sand = mix(vec3(0.24, 0.17, 0.059), vec3(0.43, 0.31, 0.137), drift);
    float silt = 1.0 - smoothstep(0.28, 0.56, deposits);
    sand = mix(sand, vec3(0.13, 0.08, 0.025), silt * 0.4);
    sand *= 0.85 + deposits * 0.3;
    sand *= 0.7 + grit * 0.6;
    float grainTone = mix(0.68, 1.22, mineral) * (0.7 + quartz * 0.5);
    sand *= mix(1.0, grainTone, resolved * 0.75);
    float mineralGrit = (1.0 - smoothstep(0.04, 0.12, mineral)) * quartz * resolved;
    sand *= 1.0 - mineralGrit * 0.7;
    float darkGrains = 1.0 - smoothstep(0.22, 0.33, fine);
    sand = mix(sand, vec3(0.105, 0.086, 0.051), darkGrains * 0.32);
    diffuseColor.rgb *= sand;
    surfaceHeight = deposits * 0.002 + grit * 0.003 + fine * 0.0015 + quartz * resolved * 0.002 + ripple * 0.0008;
    surfaceRoughness = 0.88 + mix(0.5, mineral, resolved) * 0.12;
  `,
};

export function proceduralSurfaceShader(shader, kind) {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec2 vSurfaceUv;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSurfaceUv = uv;");
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\n${reliefGLSL}`)
    .replace("#include <color_fragment>", `#include <color_fragment>\n${surfaces[kind]}`)
    .replace("#include <roughnessmap_fragment>",
      "#include <roughnessmap_fragment>\nroughnessFactor *= surfaceRoughness;")
    .replace("#include <normal_fragment_maps>",
      "#include <normal_fragment_maps>\nnormal = surfaceNormal(normal, -vViewPosition, surfaceHeight);");
}
