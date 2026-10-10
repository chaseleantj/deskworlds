// GLSL for the bonfire: procedural surfaces patched into the standard material, the
// flame volume, the sparks, and the passes that turn linear light into a picture.

export const NOISE = /* glsl */`
// Simplex noise after Ashima Arts and Stefan Gustavson (MIT).
vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0 / 7.0;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
float fbm3(vec3 p) { return 0.5 * snoise(p) + 0.25 * snoise(p * 2.03 + 7.1) + 0.125 * snoise(p * 4.07 + 3.3); }
float fbm4(vec3 p) { return fbm3(p) + 0.0625 * snoise(p * 8.11 + 1.7); }
float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 hash33(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
// Cellular noise: x is the distance to the nearest cell centre, y the distance to the cell wall, z a cell id.
vec3 cells(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0; vec3 id = vec3(0.0); vec3 r1 = vec3(0.0);
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(x, y, z);
    vec3 r = g + hash33(i + g) * 0.85 + 0.075 - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = i + g; r1 = r; } else if (d < d2) { d2 = d; }
  }
  return vec3(sqrt(d1), sqrt(d2) - sqrt(d1), hash13(id));
}
// Light from incandescent matter at temperature t (kelvin), relative to 1500 K red light.
vec3 blackbody(float t) {
  vec3 lambda = vec3(600e-9, 545e-9, 455e-9);
  vec3 b = 1.0 / (pow(lambda / 600e-9, vec3(5.0)) * (exp(1.4388e-2 / (lambda * t)) - 1.0));
  return b * (exp(1.4388e-2 / (600e-9 * 1500.0)) - 1.0);
}
// Glowing wood, coal and iron: black-body colour, with a brightness set for the eye rather
// than by Planck's law, which would leave anything below the flame's heat invisible.
vec3 ember(float t) {
  vec3 b = blackbody(t);
  return b / b.r * pow(t / 1100.0, 6.0);
}
`;

// How hot the heart of the fire is at a point: brightest low in the middle, cooling outward.
export const HEAT = /* glsl */`
uniform float uTime;
uniform float uEnergy;
uniform float uBlaze;     // how hard the flames burn, 1 at full strength
// Two sources of heat: the bed of coals at the base, and the flames themselves, a cone that
// grows and shrinks with how hard the fire burns. Wood inside the cone glows.
float heatAt(vec3 p) {
  vec3 q = p - vec3(0.0, 0.27, 0.0);
  float r = length(q.xz * vec2(1.0, 1.1));
  float coals = exp(-r * r / 0.07) * smoothstep(-0.25, 0.0, q.y) * exp(-max(0.0, q.y - 0.08) * 3.5);
  float h = max(q.y, 0.0) / (0.85 * uBlaze + 0.08);
  float cone = 0.34 * (1.0 - 0.7 * h);
  float flame = smoothstep(0.03, -0.09, r - cone) * smoothstep(1.0, 0.6, h) * smoothstep(-0.1, 0.02, q.y);
  return clamp(max(coals, flame * (0.55 + 0.35 * uBlaze)), 0.0, 1.0);
}
// Embers breathe: a slow, patchy flicker that differs from place to place.
float breathe(vec3 p) {
  return 0.55 + 0.45 * snoise(vec3(p.xz * 9.0, uTime * 0.9 + p.y * 4.0)) * 0.5 + 0.25 * snoise(vec3(p.xz * 3.0 + 4.0, uTime * 2.3));
}
`;

// Shared varyings for every patched surface.
export const SURFACE_VERT_PARS = /* glsl */`
attribute vec4 aSurf;
varying vec3 vWorld;
varying vec3 vWorldNormal;
varying vec4 vSurf;
#ifdef HAS_AXIS
attribute vec4 aAxis;
varying vec4 vAxis;
#endif
`;
export const SURFACE_VERT = /* glsl */`
vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
vSurf = aSurf;
#ifdef HAS_AXIS
vAxis = vec4(normalize(mat3(modelMatrix) * aAxis.xyz), aAxis.w);
#endif
`;
export const SURFACE_FRAG_PARS = /* glsl */`
varying vec3 vWorld;
varying vec3 vWorldNormal;
varying vec4 vSurf;
#ifdef HAS_AXIS
varying vec4 vAxis;
#endif
struct Surface { vec3 albedo; float rough; float metal; vec3 normal; vec3 emissive; };
`;

// Earth and ash: pale ash heaped under the fire, dark packed dirt and grit beyond. The
// detail is baked once into a texture (albedo and height) covering GROUND_SPAN metres.
export const GROUND_SPAN = 8.0;
export const GROUND_BAKE = /* glsl */`
varying vec2 vUv;
${NOISE}
float groundBump(vec2 p, float ash) {
  // Fine grit, pebbles and clods; no broad swells, which read as water under grazing light.
  float grit = snoise(vec3(p * 180.0, 1.0)) * 0.25 + snoise(vec3(p * 75.0, 2.0)) * 0.3;
  vec3 c = cells(vec3(p * 30.0, 0.5));
  float pebble = smoothstep(0.45, 0.15, c.x) * step(0.6, c.z) * (0.6 + 0.6 * c.z);
  vec3 c2 = cells(vec3(p * 9.0, 2.5));
  float clod = smoothstep(0.5, 0.1, c2.x) * step(0.7, c2.z) * 0.8;
  float soil = grit + pebble * 0.5 + clod * 0.6 + 0.25 * snoise(vec3(p * 20.0, 3.0));
  float drift = snoise(vec3(p * 30.0, 5.0)) * 0.3 + grit * 0.45 + pebble * 0.2;
  return mix(soil, drift, ash);
}
void main() {
  vec2 p = (vUv - 0.5) * ${GROUND_SPAN.toFixed(1)};
  float r = length(p * vec2(1.0, 1.08));
  float edge = 0.72 + 0.22 * fbm3(vec3(p * 2.2, 5.0)) + 0.06 * fbm3(vec3(p * 9.0, 1.0));
  float ash = smoothstep(edge + 0.18, edge - 0.12, r);
  float tone = smoothstep(-0.5, 0.6, fbm3(vec3(p * 4.0, 9.0)));
  vec3 dirt = mix(vec3(0.022, 0.017, 0.013), vec3(0.05, 0.039, 0.03), tone);
  // Scattered grit, soot and tiny stones.
  float speck = smoothstep(0.6, 0.9, snoise(vec3(p * 70.0, 5.0)));
  dirt = mix(dirt, vec3(0.09, 0.085, 0.075), speck * 0.4);
  dirt = mix(dirt, vec3(0.01), smoothstep(0.55, 0.95, snoise(vec3(p * 35.0, 7.0))) * 0.6);
  // Away from the fire the earth is damper and darker.
  dirt *= mix(1.0, 0.55, smoothstep(1.0, 2.6, r));
  // Ash: mottled grey-brown, sooty in places, white where it burned clean, full of charcoal.
  float clean = smoothstep(0.0, 0.7, fbm3(vec3(p * 5.0, 8.0)) + 0.35 * snoise(vec3(p * 17.0, 3.0)));
  vec3 ashColor = mix(vec3(0.035, 0.031, 0.027), vec3(0.12, 0.112, 0.104), clean);
  float white = smoothstep(0.7, 0.95, snoise(vec3(p * 55.0, 1.5)) * 0.6 + clean * 0.5);
  ashColor = mix(ashColor, vec3(0.32, 0.31, 0.3), white * 0.6);
  float crumbs = smoothstep(0.55, 0.95, snoise(vec3(p * 23.0, 6.0)) * 0.6 + 0.5 * snoise(vec3(p * 70.0, 2.0)) + 0.3 * snoise(vec3(p * 160.0, 9.0)));
  ashColor = mix(ashColor, vec3(0.008), crumbs * 0.9);
  ashColor = mix(ashColor, vec3(0.02, 0.017, 0.015), smoothstep(0.3, 0.05, r) * 0.6);
  gl_FragColor = vec4(mix(dirt, ashColor, ash), groundBump(p, ash));
}
`;
export const GROUND = /* glsl */`
uniform sampler2D uGroundMap;
Surface surface() {
  Surface s;
  vec2 p = vWorld.xz;
  vec2 uv = p / ${GROUND_SPAN.toFixed(1)} + 0.5;
  vec4 g = texture2D(uGroundMap, uv);
  // Normal from the baked height by central differences, one texel apart.
  float e = 1.0 / 2048.0;
  float hx = texture2D(uGroundMap, uv + vec2(e, 0.0)).a - texture2D(uGroundMap, uv - vec2(e, 0.0)).a;
  float hz = texture2D(uGroundMap, uv + vec2(0.0, e)).a - texture2D(uGroundMap, uv - vec2(0.0, e)).a;
  float k = 0.0045 / (2.0 * e * ${GROUND_SPAN.toFixed(1)});
  // Past the baked patch the ground is too far from the fire to show detail.
  float inside = smoothstep(0.5, 0.46, max(abs(uv.x - 0.5), abs(uv.y - 0.5)));
  s.normal = normalize(vWorldNormal + inside * vec3(-hx * k, 0.0, -hz * k));
  s.albedo = mix(vec3(0.012, 0.01, 0.008), g.rgb, inside);
  s.rough = 0.94;
  s.metal = 0.0;
  // A bed of embers under the logs: bright cells in the hottest ash.
  float heat = heatAt(vWorld);
  s.emissive = vec3(0.0);
  if (heat > 0.004) {
    // Coals of many sizes, each glowing with its own slow pulse.
    vec3 c = cells(vec3(p * 22.0, 0.3));
    float pulse = 0.6 + 0.4 * sin(uTime * (0.7 + c.z * 1.6) + c.z * 40.0);
    float coal = smoothstep(0.6, 0.1, c.x) * (0.3 + 0.7 * c.z) * pulse;
    float fine = smoothstep(0.5, 0.95, snoise(vec3(p * 90.0, uTime * 0.2)));
    float glow = heat * (coal * 2.6 + fine * 1.2) * breathe(vWorld) + heat * 0.08;
    s.emissive = ember(mix(950.0, 1250.0, clamp(glow, 0.0, 1.0))) * glow * 0.5 * uEnergy;
  }
  return s;
}
`;

// Everything about the wood but its glow stays put while the camera does, so it is worked out
// once per pixel and cached (see render.js). The key tells one log, and its end caps, from another.
export const WOOD_PARS = /* glsl */`
struct Wood { vec3 normal; float height; float crack; float id; float burn; float ash; };
float woodKey() { return vSurf.w + 128.0 * step(0.25, fract(vSurf.z)); }
// Unit normals packed into two numbers (octahedral mapping).
vec2 octWrap(vec2 v) { return (1.0 - abs(v.yx)) * vec2(v.x >= 0.0 ? 1.0 : -1.0, v.y >= 0.0 ? 1.0 : -1.0); }
vec2 octEncode(vec3 n) { n /= abs(n.x) + abs(n.y) + abs(n.z); return n.z >= 0.0 ? n.xy : octWrap(n.xy); }
vec3 octDecode(vec2 f) { vec3 n = vec3(f, 1.0 - abs(f.x) - abs(f.y)); if (n.z < 0.0) n.xy = octWrap(n.xy); return normalize(n); }
`;

// Charred wood: alligator-cracked charcoal with glowing seams, grey ash on top, weathered
// wood toward the cold ends.
export const WOOD = /* glsl */`
// Charred wood splits along the grain into long fissures, and each strip between them
// checks across into blocks. along is metres down the log, around is the angle.
float charHeight(float along, float around, float radius, float seed, out float crack, out float cellId) {
  vec2 ring = vec2(cos(around), sin(around));
  float strips = max(3.0, floor(6.2831853 * radius / (0.009 + 0.012 * fract(seed * 0.618)) + 0.5));
  // Fissures wander a little as they run down the log; the warp is periodic around it.
  float warp = 0.7 * snoise(vec3(ring * 1.3, along * 4.0 + seed)) + 0.3 * snoise(vec3(ring * 3.0, along * 11.0 + seed)) + 0.12 * snoise(vec3(ring * 7.0, along * 30.0 + seed));
  float sc = around / 6.2831853 * strips + warp;
  float strip = floor(sc), fs = fract(sc);
  float sid = hash13(vec3(mod(strip, strips), seed, 1.7));
  float blockLen = (0.012 + 0.04 * sid * sid) * (0.7 + 0.8 * fract(seed * 0.371));
  float bc = along / blockLen + sid * 17.0 + 0.45 * snoise(vec3(ring * 2.0, along * 9.0 + seed)) + (fs - 0.5) * (sid - 0.5) * 1.2;
  float block = floor(bc), fb = fract(bc);
  cellId = hash13(vec3(strip, block, seed));
  // Distances to the nearest fissure and check, in metres.
  float stripWidth = 6.2831853 * radius / strips;
  float dLong = min(fs, 1.0 - fs) * stripWidth;
  float dCross = min(fb, 1.0 - fb) * blockLen;
  float wLong = 0.0016 + 0.0022 * (0.5 + 0.5 * snoise(vec3(ring * 4.0, along * 6.0 + seed + 3.0)));
  float wCross = 0.0008 + 0.0014 * cellId;
  // Some checks do not run all the way across the strip.
  float partial = step(0.6, hash13(vec3(strip, block, seed + 4.0)));
  float cl = 1.0 - smoothstep(wLong * 0.4, wLong, dLong);
  float cc = (1.0 - smoothstep(wCross * 0.4, wCross, dCross)) * partial;
  crack = max(cl, cc);
  // Each block domes a little and has its own tilt; the char surface is grainy.
  float dome = smoothstep(0.0, 0.006, min(dLong, mix(1.0, dCross, partial)));
  float grain = snoise(vec3(ring * radius * 400.0, along * 60.0)) * 0.15;
  return dome * (0.85 + 0.3 * cellId) + grain + snoise(vec3(ring * 40.0, along * 140.0 + seed)) * 0.1;
}
// Bark on the cool stretches: furrows running with the grain, finer splits between them.
float barkHeight(float along, float around, float radius, float seed) {
  vec2 ring = vec2(cos(around), sin(around)) * radius;
  float furrow = abs(snoise(vec3(ring * 55.0, along * 5.0 + seed)));
  float split = abs(snoise(vec3(ring * 150.0, along * 12.0 + seed + 3.0)));
  return 1.0 - furrow * 0.75 - split * 0.35;
}
Wood wood() {
  Wood w;
  float along = vSurf.x, around = vSurf.y * 6.2831853, cap = step(0.25, fract(vSurf.z));
  float seed = vSurf.w * 7.31, radius = vAxis.w;
  vec3 T = vAxis.xyz, N = normalize(vWorldNormal);
  vec3 B = normalize(cross(N, T));
  // How burned this part is: black char where the flames reach, scorched bark beyond, plain
  // bark at the cold outer ends, with a ragged boundary between them.
  float reach = length((vWorld - vec3(0.0, 0.42, 0.0)) * vec3(1.0, 1.3, 1.0));
  float burn = smoothstep(1.0, 0.45, reach + 0.18 * fbm3(vWorld * 6.0 + seed));
  float crack, id, c2, i2;
  float e = 0.0012, aroundE = e / max(radius, 0.005);
  float h0 = mix(barkHeight(along, around, radius, seed), charHeight(along, around, radius, seed, crack, id), burn);
  float ha = mix(barkHeight(along + e, around, radius, seed), charHeight(along + e, around, radius, seed, c2, i2), burn);
  float hb = mix(barkHeight(along, around + aroundE, radius, seed), charHeight(along, around + aroundE, radius, seed, c2, i2), burn);
  crack *= smoothstep(0.15, 0.6, burn);
  if (cap > 0.5) { crack = smoothstep(0.6, 0.9, abs(snoise(vWorld * 90.0))); h0 = 0.5; ha = hb = h0; id = 0.5; }
  float k = mix(0.0011, 0.0008, burn);
  w.normal = normalize(N - (T * (ha - h0) + B * (hb - h0)) / e * k);
  // Grey-white ash where the char has burned through, mostly on top.
  float up = smoothstep(0.2, 0.85, N.y);
  w.ash = smoothstep(0.35, 0.75, fbm3(vWorld * 18.0 + seed) * 0.8 + up * 0.35 - 0.15) * smoothstep(0.5, 0.9, burn) * (1.0 - crack);
  w.height = h0; w.crack = crack; w.id = id; w.burn = burn;
  return w;
}
`;

// Drawn once into the wood cache: the logs' fixed detail, front-most log per pixel.
export const WOOD_BAKE_VERT = /* glsl */`
${SURFACE_VERT_PARS}
void main() {
  vec3 transformed = position, objectNormal = normal;
  ${SURFACE_VERT}
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
export const WOOD_BAKE_FRAG = /* glsl */`
layout(location = 1) out highp vec4 gWood;
void main() {
  Wood w = wood();
  gl_FragColor = vec4(octEncode(w.normal), w.height, w.crack);
  gWood = vec4(w.id, w.burn, w.ash, woodKey() / 255.0);
}
`;

export const LOGS = /* glsl */`
uniform sampler2D uWood[2];
// The cached wood at this pixel, or, on the edge of a log, at the neighbour this same log
// covered when the cache was drawn. Working the wood out here instead, even rarely, would
// make the whole shader slower. A sliver too thin to cover any pixel's centre is plain bark.
Wood cachedWood() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  const ivec2 around[5] = ivec2[5](ivec2(0), ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1));
  for (int i = 0; i < 5; i++) {
    vec4 b = texelFetch(uWood[1], pixel + around[i], 0);
    if (abs(b.w * 255.0 - woodKey()) > 0.5) continue;
    vec4 a = texelFetch(uWood[0], pixel + around[i], 0);
    return Wood(octDecode(a.xy), a.z, a.w, b.x, b.y, b.z);
  }
  return Wood(normalize(vWorldNormal), 0.5, 0.0, 0.5, 0.0, 0.0);
}
Surface surface() {
  Surface s;
  Wood w = cachedWood();
  float seed = vSurf.w * 7.31, burn = w.burn, crack = w.crack, id = w.id, h0 = w.height, ashMask = w.ash;
  // Colour: grey-brown bark, scorched to dark brown, then matte charcoal with a faint sheen.
  float tone = fract(seed * 0.4137);
  vec3 bark = mix(vec3(0.03, 0.025, 0.02), vec3(0.075, 0.065, 0.055), smoothstep(0.2, 0.9, h0)) * (0.8 + 0.4 * tone);
  vec3 scorched = vec3(0.025, 0.017, 0.012);
  vec3 charcoal = mix(vec3(0.014, 0.013, 0.012), vec3(0.045, 0.042, 0.04), id * id);
  vec3 albedo = mix(bark, scorched, smoothstep(0.0, 0.4, burn));
  albedo = mix(albedo, charcoal, smoothstep(0.35, 0.8, burn));
  albedo = mix(albedo, vec3(0.004), crack);
  albedo = mix(albedo, mix(vec3(0.13, 0.125, 0.12), vec3(0.26, 0.25, 0.24), id), ashMask * 0.7);
  s.albedo = albedo;
  s.rough = mix(0.9, mix(0.72, 1.0, crack), burn);
  s.rough = mix(s.rough, 1.0, ashMask);
  s.metal = 0.0;
  s.normal = w.normal;
  // Glow in the fissures where the log sits in the fire, and whole faces at the burned end.
  // Where the flames wrap the wood it glows: the fissures first, then, at the hottest tips,
  // the whole surface red-hot under a skin of ash, pulsing with the fire.
  float heat = heatAt(vWorld) * smoothstep(0.2, 0.7, burn);
  float flicker = breathe(vWorld) * (0.75 + 0.25 * uBlaze);
  float seam = crack * smoothstep(0.15, 0.5, heat) * flicker;
  float face = smoothstep(0.55, 0.9, heat) * (0.35 + 0.65 * smoothstep(0.1, 0.8, h0)) * flicker * (1.0 - 0.7 * ashMask);
  float glow = seam * 4.0 + face * 2.0;
  s.emissive = ember(mix(850.0, 1180.0, clamp(heat * 0.9 + 0.15 * seam, 0.0, 1.0))) * glow * 0.55 * uEnergy;
  // Red-hot wood is not dark char: the glow replaces the diffuse look.
  s.albedo *= 1.0 - 0.6 * smoothstep(0.55, 0.95, heat);
  return s;
}
`;

// Loose coals in the fire and stones around it.
export const RUBBLE = /* glsl */`
Surface surface() {
  Surface s;
  float kind = vSurf.x, seed = vSurf.y;
  vec3 q = vWorld * 70.0 + seed;
  vec3 c = cells(q);
  float n = fbm3(vWorld * 120.0 + seed);
  s.normal = normalize(vWorldNormal + 0.25 * vec3(snoise(q * 0.7), snoise(q * 0.7 + 5.0), snoise(q * 0.7 + 9.0)));
  s.metal = 0.0;
  if (kind < 0.5) {
    float crack = 1.0 - smoothstep(0.02, 0.1, c.y);
    s.albedo = mix(vec3(0.02, 0.018, 0.016), vec3(0.006), crack);
    s.albedo = mix(s.albedo, vec3(0.16, 0.155, 0.15), smoothstep(0.45, 0.85, n + vWorldNormal.y * 0.3 - 0.3) * 0.5);
    s.rough = 0.65;
    float heat = heatAt(vWorld);
    float glow = (crack * 1.5 + 0.4) * smoothstep(0.05, 0.6, heat) * breathe(vWorld);
    s.emissive = ember(mix(900.0, 1250.0, heat)) * glow * 0.5 * uEnergy;
  } else {
    vec3 stone = mix(vec3(0.10, 0.095, 0.085), vec3(0.2, 0.18, 0.16), hash13(vec3(seed)));
    s.albedo = stone * (0.75 + 0.5 * n);
    s.rough = 0.8;
    s.emissive = vec3(0.0);
  }
  return s;
}
`;

// Old bone, yellowed and sooty, scorched dark where it lies near the fire.
export const BONE = /* glsl */`
Surface surface() {
  Surface s;
  vec3 q = vWorld * 140.0;
  float pores = snoise(q) * 0.5 + snoise(q * 2.3) * 0.25;
  float stain = smoothstep(-0.2, 0.6, fbm3(vWorld * 25.0 + 2.0));
  vec3 bone = mix(vec3(0.045, 0.036, 0.027), vec3(0.018, 0.015, 0.012), stain);
  float scorch = smoothstep(0.75, 0.45, length(vWorld.xz)) * 0.8;
  s.albedo = mix(bone, vec3(0.03, 0.025, 0.02), max(scorch * stain, smoothstep(0.4, 0.8, snoise(vWorld * 60.0)) * 0.5)) * (0.9 + 0.2 * pores);
  s.rough = 0.82 + 0.15 * stain;
  s.metal = 0.0;
  s.normal = normalize(vWorldNormal + 0.08 * vec3(snoise(q), snoise(q + 3.0), snoise(q + 7.0)));
  s.emissive = vec3(0.0);
  return s;
}
`;

// Dry grass at the edge of the light: straw, darkened toward the root.
export const GRASS = /* glsl */`
Surface surface() {
  Surface s;
  float u = vSurf.z, seed = vSurf.y;
  vec3 straw = mix(vec3(0.16, 0.12, 0.065), vec3(0.24, 0.19, 0.11), seed);
  s.albedo = mix(vec3(0.03, 0.025, 0.018), straw, smoothstep(0.0, 0.5, u));
  s.rough = 0.7;
  s.metal = 0.0;
  s.normal = normalize(vWorldNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  s.emissive = vec3(0.0);
  return s;
}
`;

// The coiled sword: old iron, dark with soot and fire scale, rusted in patches; it glows
// dull orange where it stands in the fire.
export const SWORD = /* glsl */`
Surface surface() {
  Surface s;
  float part = vSurf.z;
  vec3 N = normalize(vWorldNormal);
  // Pitting at a few scales, coarse enough to read as corrosion rather than grain.
  vec3 q = vWorld * 70.0;
  float pits = fbm3(q) * 0.6 + snoise(q * 2.5) * 0.25;
  float pock = smoothstep(0.55, 0.9, snoise(vWorld * 110.0)) * 0.6;
  vec3 bump = vec3(snoise(q * 0.8), snoise(q * 0.8 + 4.0), snoise(q * 0.8 + 8.0));
  if (part > 2.5) {
    // A leather strip wound round the grip, dark with handling and soot.
    s.albedo = vec3(0.07, 0.045, 0.03) * (0.75 + 0.5 * pits);
    s.rough = 0.72;
    s.metal = 0.0;
    s.normal = normalize(N + 0.05 * bump);
  } else {
    float rust = smoothstep(0.0, 0.5, fbm3(vWorld * 11.0 + 3.0) + 0.2 * snoise(vWorld * 50.0));
    float soot = max(smoothstep(-0.3, 0.3, fbm3(vWorld * 6.0 + 9.0)), smoothstep(1.0, 0.45, vWorld.y)) * smoothstep(1.45, 0.6, vWorld.y);
    vec3 iron = vec3(0.12, 0.11, 0.1) * (0.8 + 0.25 * pits);
    vec3 scale = vec3(0.06, 0.055, 0.05);
    vec3 oxide = mix(vec3(0.1, 0.045, 0.02), vec3(0.2, 0.1, 0.05), pits * 0.5 + 0.5);
    s.albedo = mix(iron, scale, max(soot * 0.9, 0.45));
    s.metal = mix(0.75, 0.15, soot);
    s.albedo = mix(s.albedo, oxide, rust * 0.75);
    s.metal = mix(s.metal, 0.0, rust * 0.8);
    s.albedo *= 1.0 - pock * 0.4;
    // Blotches of scale a few centimetres across and fine scratches running down the blade.
    vec3 T = vAxis.xyz, X = normalize(cross(T, vec3(0.0, 0.0, 1.0))), Y = cross(T, X);
    vec3 local = vec3(dot(vWorld, T), dot(vWorld, X), dot(vWorld, Y));
    float blotch = fbm3(vWorld * 32.0 + 1.3);
    float scratch = snoise(vec3(local.x * 4.0, local.yz * 260.0));
    s.albedo *= (0.55 + 0.7 * smoothstep(-0.5, 0.5, blotch)) * (0.85 + 0.25 * scratch);
    s.rough = clamp(s.rough - 0.12 * smoothstep(0.3, 0.9, scratch) + 0.1 * blotch, 0.4, 1.0);
    s.rough = clamp(mix(0.6, 0.85, soot) + rust * 0.2 + pock * 0.1 - 0.15 * smoothstep(0.3, 0.8, pits), 0.45, 1.0);
    s.normal = normalize(N + (0.05 + 0.08 * rust) * bump);
  }
  // Iron in the flames glows dull red to orange, brightest lowest down.
  float heat = heatAt(vWorld);
  float glow = smoothstep(0.35, 0.95, heat) * (0.65 + 0.35 * pits) * step(part, 2.5);
  s.emissive = ember(mix(880.0, 1200.0, heat)) * glow * 0.6 * uEnergy;
  return s;
}
`;

// ---------------------------------------------------------------------------------------
// The flame volume, marched through a box around the fire at reduced resolution.

export const FULLSCREEN_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const FLAME_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uDepth;
uniform mat4 uProjectionInverse;
uniform mat4 uCameraWorld;
uniform vec2 uNearFar;
uniform float uTime;
uniform float uEnergy;
uniform float uFlare;
uniform vec2 uWind;
uniform float uFrame;
${NOISE}

const vec3 BASE = vec3(0.0, 0.27, 0.0);
const vec3 CYL = vec3(0.7, 0.1, 1.9);   // radius, bottom, top

// Flame sources sit where the logs meet: each is a tongue with its own place, width and
// height (x, z, radius, height), which wander and pulse over time.
const int SOURCES = 7;
uniform vec4 uSources[7];

// The flame's outline before turbulence: smooth-merged cones over the sources.
float outline(vec3 q, float hs) {
  float shape = -3.0;
  for (int i = 0; i < SOURCES; i++) {
    vec4 s = uSources[i];
    float H = s.w;
    float u = hs / H;
    float rad = s.z * (1.0 + 0.5 * uFlare) * pow(clamp(1.0 - u, 0.0, 1.0), 0.95);
    float si = (rad - length(q.xz - s.xy)) / s.z - max(0.0, u - 1.0) * 3.0;
    // Smooth union, so neighbouring tongues merge at the root.
    float k = 0.25;
    float m = clamp(0.5 + 0.5 * (si - shape) / k, 0.0, 1.0);
    shape = mix(shape, si, m) + k * m * (1.0 - m);
  }
  return shape;
}

// Signed flame field: above zero is burning gas. temp is its temperature, 0..1.
float flame(vec3 p, out float temp) {
  vec3 q = p - BASE;
  float h = q.y;
  temp = 0.0;
  if (h < -0.1) return -1.0;
  float hs = max(h, 0.0);
  float t = uTime;
  // Wind leans the flame, more the higher it goes, and the whole body sways.
  q.xz -= uWind * hs * hs * 0.5;
  q.xz -= hs * 0.1 * vec2(sin(hs * 4.1 - t * 2.3) * 0.6 + sin(hs * 7.3 - t * 3.7 + 1.3) * 0.4, sin(hs * 3.7 - t * 2.1 + 2.0) * 0.6 + sin(hs * 6.9 - t * 3.3 + 4.1) * 0.4);
  float erosion = mix(0.6, 1.3, smoothstep(0.0, 0.5, hs));
  float shape = outline(q, hs);
  // Empty air: turbulence cannot reach this far, so skip the expensive part. Each noise
  // term is at most 1 in magnitude, so the billows below lift the field by at most 0.95
  // times the erosion, and the fine detail by at most lift.
  float lift = 1.5 * 0.07 * (0.4 + hs);
  float reachable = 0.95 * erosion * 1.15 + lift;
  if (shape + reachable < 0.0) return shape + reachable;
  // Gas rises and accelerates, so features stretch as they climb and the top breaks into tongues.
  vec3 w = vec3(q.x * 7.5, hs * 2.6 - t * 3.6, q.z * 7.5);
  vec3 warp = vec3(snoise(w * 0.55 + vec3(3.1, -t * 0.5, 0.0)), 0.0, snoise(w * 0.55 + vec3(9.7, -t * 0.5, 2.0)));
  vec3 v = w + warp * 0.9;
  // Broad billows, then ridged sheets that pull the flame into separate licking tongues.
  // The same bound, tightened after each stage, skips the finer octaves outside the flame.
  float n = 0.55 * snoise(v);
  float bound = shape + (n + 0.4) * erosion * 1.15 + lift;
  if (bound < 0.0) return bound;
  n += 0.3 * (0.6 - 1.4 * abs(snoise(v * 2.1 + 5.0))) + 0.15 * snoise(v * 4.3 + 1.0) + 0.07 * snoise(v * 8.7 + 2.0);
  bound = shape + n * erosion * 1.15 + lift;
  if (bound < 0.0) return bound;
  float fine = snoise(vec3(q.x * 20.0, hs * 8.0 - t * 7.0, q.z * 20.0)) + 0.5 * snoise(vec3(q.x * 42.0, hs * 16.0 - t * 10.0, q.z * 42.0));
  float f = shape + n * erosion * 1.15 + fine * 0.07 * (0.4 + hs);
  // Hottest low and deep inside; streaks of hotter gas run through it; tips cool to red.
  float streak = snoise(vec3(q.x * 9.0, hs * 4.0 - t * 3.0, q.z * 9.0 + 5.0));
  temp = clamp(0.42 + f * 0.9 + streak * 0.12 - hs * 1.25, 0.0, 1.0);
  return f;
}

float viewDistance(vec2 uv, vec3 dirView) {
  float d = texture2D(uDepth, uv).r;
  float n = uNearFar.x, fr = uNearFar.y;
  float viewZ = (n * fr) / ((fr - n) * d - fr);
  return viewZ / dirView.z;
}

void main() {
  vec4 ndc = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec4 view = uProjectionInverse * ndc;
  vec3 dirView = normalize(view.xyz / view.w);
  vec3 ro = (uCameraWorld * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 rd = normalize((uCameraWorld * vec4(dirView, 0.0)).xyz);
  // March only through a cylinder around the flame, so the steps stay short.
  vec2 oc = ro.xz, dc = rd.xz;
  float a = dot(dc, dc), b = dot(oc, dc), c = dot(oc, oc) - CYL.x * CYL.x;
  float disc = b * b - a * c;
  if (disc <= 0.0) { gl_FragColor = vec4(0.0); return; }
  float sq = sqrt(disc);
  float enter = (-b - sq) / a, leave = (-b + sq) / a;
  float ty0 = (CYL.y - ro.y) / rd.y, ty1 = (CYL.z - ro.y) / rd.y;
  enter = max(enter, min(ty0, ty1));
  leave = min(leave, max(ty0, ty1));
  enter = max(enter, 0.0);
  leave = min(leave, viewDistance(vUv, dirView));
  if (leave <= enter) { gl_FragColor = vec4(0.0); return; }
  // A span cut short by the logs or the flame's edge would get ever finer steps; 8 mm is fine enough.
  const int STEPS = 110;
  float dt = max((leave - enter) / float(STEPS), 0.008);
  float jitter = hash13(vec3(gl_FragCoord.xy, uFrame * 7.0 + 1.0));
  float t = enter + dt * jitter;
  vec3 light = vec3(0.0);
  float transmit = 1.0;
  for (int i = 0; i < STEPS; i++) {
    vec3 p = ro + rd * t;
    float temp;
    float f = flame(p, temp);
    if (f > 0.0) {
      // Glowing soot: it emits like a black body and hides what lies behind it, so a thick
      // flame shows the temperature of its surface and a thin one stays translucent.
      float density = smoothstep(0.0, 0.025, f) * mix(1.5, 36.0, smoothstep(0.15, 0.55, temp));
      float kelvin = mix(1150.0, 1860.0, temp * temp * (3.0 - 2.0 * temp));
      float absorbed = 1.0 - exp(-density * dt);
      light += transmit * absorbed * blackbody(kelvin) * 2.2 * mix(4.0, 1.0, smoothstep(0.15, 0.55, temp)) * smoothstep(0.02, 0.18, temp);
      transmit *= 1.0 - absorbed;
      if (transmit < 0.01) break;
    }
    // Far outside the flame the field cannot turn positive within a few steps: stride.
    t += f < -0.45 ? dt * 2.5 : dt;
    if (t > leave) break;
  }
  gl_FragColor = vec4(light * uEnergy, 1.0 - transmit);
}
`;

// ---------------------------------------------------------------------------------------
// Sparks: each is a short streak between where it is and where it was an instant ago.

export const SPARK_VERT = /* glsl */`
attribute vec4 aNow;
attribute vec4 aWas;
attribute vec4 aSpark;
uniform vec2 uRes;
uniform float uShutter;
uniform float uTime;
uniform float uStepRate;
varying vec2 vLocal;
varying float vLength;
varying vec3 vColor;
varying float vHalo;
${NOISE}
void main() {
  float heat = aSpark.x;
  if (heat <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 velocity = (aNow.xyz - aWas.xyz) * uStepRate;
  vec3 tail = aNow.xyz - velocity * uShutter;
  vec4 a = projectionMatrix * viewMatrix * vec4(aNow.xyz, 1.0);
  vec4 b = projectionMatrix * viewMatrix * vec4(tail, 1.0);
  vec2 sa = a.xy / a.w * 0.5 * uRes, sb = b.xy / b.w * 0.5 * uRes;
  vec2 axis = sa - sb;
  float len = length(axis);
  vec2 dir = len > 1e-4 ? axis / len : vec2(0.0, 1.0);
  vec2 side = vec2(-dir.y, dir.x);
  // Physical size in pixels, never thinner than a pixel; energy spreads over the drawn area.
  float px = aSpark.y * projectionMatrix[1][1] / a.w * 0.5 * uRes.y;
  float width = max(px * 0.5, 0.6);
  // Big embers carry a faint halo, drawn by widening their quad.
  float halo = aSpark.y > 0.0034 ? 4.0 : 1.0;
  vec2 corner = position.xy;           // x: 0 at tail, 1 at head; y: -1..1 across
  vec2 s = mix(sb, sa, corner.x) + dir * (corner.x * 2.0 - 1.0) * width * halo + side * corner.y * width * halo;
  vec4 clip = mix(b, a, corner.x);
  gl_Position = vec4(s / (0.5 * uRes) * clip.w, clip.z, clip.w);
  vLocal = vec2(mix(-width * halo, len + width * halo, corner.x), corner.y * width * halo) / width;
  vHalo = halo;
  vLength = len / width;
  // Cooling: white-yellow when fresh, deep orange, then a dull red before it goes out.
  float kelvin = mix(950.0, 1900.0, pow(heat, 1.3));
  float tumble = 1.0;
  if (aSpark.y > 0.0034) tumble = 0.55 + 0.45 * sin(uTime * (9.0 + fract(aSpark.z) * 14.0) + aSpark.z);
  float coverage = min(1.0, px / width);
  float spread = width / (width + len);
  vColor = blackbody(kelvin) * 2.6 * (0.15 + 1.6 * pow(fract(aSpark.z * 7.13), 3.0)) * coverage * coverage * spread * tumble * smoothstep(0.0, 0.08, aSpark.w);
}
`;

export const SPARK_FRAG = /* glsl */`
varying vec2 vLocal;
varying float vLength;
varying vec3 vColor;
varying float vHalo;
void main() {
  // Distance to the streak's segment, in units of its half-width: a tight core and, for big
  // embers, a faint glow around it.
  float along = clamp(vLocal.x, 0.0, vLength);
  vec2 d = vec2(vLocal.x - along, vLocal.y);
  float r2 = dot(d, d);
  float k = exp(-r2 / 0.7) + (vHalo > 1.5 ? 0.06 * exp(-r2 / 5.0) : 0.0);
  gl_FragColor = vec4(vColor * k, 1.0);
}
`;

// ---------------------------------------------------------------------------------------
// Composite, bloom and output.

export const COMPOSITE_FRAG = /* glsl */`
varying vec2 vUv;
uniform sampler2D uBeauty;
uniform sampler2D uFlame;
uniform vec2 uFlameTexel;
uniform float uTime;
uniform vec4 uHaze;       // screen-space centre x, base y, top y, half-width
uniform float uAspect;
${NOISE}
void main() {
  // Heat shimmer above the flames: the air bends what lies behind it.
  vec2 uv = vUv;
  float across = (uv.x - uHaze.x) / uHaze.w;
  float up = (uv.y - uHaze.y) / max(1e-3, uHaze.z - uHaze.y);
  float mask = exp(-across * across * 1.5) * smoothstep(-0.05, 0.25, up) * smoothstep(1.4, 0.6, up);
  vec2 offset = vec2(0.0);
  if (mask > 0.002) {
    vec2 q = vec2(uv.x * uAspect * 22.0, uv.y * 14.0 - uTime * 3.2);
    offset = vec2(snoise(vec3(q, uTime * 0.7)), snoise(vec3(q + 17.0, uTime * 0.7))) * 0.0018 * mask;
  }
  vec3 beauty = texture2D(uBeauty, uv + offset).rgb;
  vec2 fuv = uv + offset * 0.5, d = uFlameTexel * 0.75;
  vec4 flame = 0.25 * (texture2D(uFlame, fuv + vec2(d.x, d.y)) + texture2D(uFlame, fuv + vec2(-d.x, d.y))
    + texture2D(uFlame, fuv + vec2(d.x, -d.y)) + texture2D(uFlame, fuv - d));
  gl_FragColor = vec4(beauty * (1.0 - flame.a) + flame.rgb, 1.0);
}
`;

export const DOWN_FRAG = /* glsl */`
varying vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
void main() {
  vec3 c = texture2D(uSrc, vUv).rgb * 4.0;
  c += texture2D(uSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture2D(uSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture2D(uSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture2D(uSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(c / 8.0, 1.0);
}
`;

export const UP_FRAG = /* glsl */`
varying vec2 vUv;
uniform sampler2D uSrc;
uniform sampler2D uBase;
uniform vec2 uTexel;
uniform float uWeight;
void main() {
  vec3 c = vec3(0.0);
  c += texture2D(uSrc, vUv + uTexel * vec2(-1.0, 0.0)).rgb * 2.0;
  c += texture2D(uSrc, vUv + uTexel * vec2(1.0, 0.0)).rgb * 2.0;
  c += texture2D(uSrc, vUv + uTexel * vec2(0.0, -1.0)).rgb * 2.0;
  c += texture2D(uSrc, vUv + uTexel * vec2(0.0, 1.0)).rgb * 2.0;
  c += texture2D(uSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture2D(uSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture2D(uSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture2D(uSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(c / 12.0 + texture2D(uBase, vUv).rgb * uWeight, 1.0);
}
`;

export const OUTPUT_FRAG = /* glsl */`
varying vec2 vUv;
uniform sampler2D uImage;
uniform sampler2D uBloom;
uniform float uExposure;
uniform float uBloomGain;
uniform float uFrame;
uniform float uAspect;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
// A film-like curve per channel: bright orange climbs through yellow toward white.
vec3 film(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec3 c = texture2D(uImage, vUv).rgb + texture2D(uBloom, vUv).rgb * uBloomGain;
  vec2 v = (vUv - 0.5) * vec2(uAspect, 1.0);
  c *= 1.0 - 0.35 * smoothstep(0.35, 1.1, length(v));
  c = film(c * uExposure);
  // A quiet grade: firelight warm but not garish, highlights a little creamy.
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(luma), c, 0.8);
  c = mix(c, c * vec3(1.0, 0.96, 0.9) + vec3(0.03, 0.025, 0.02) * luma, smoothstep(0.5, 1.0, luma));
  c = toSRGB(c);
  // Fine grain, enough to break up banding in the deep blacks.
  float g = hash12(gl_FragCoord.xy + uFrame * 17.0) + hash12(gl_FragCoord.xy * 1.3 - uFrame * 7.0) - 1.0;
  c += g * (0.012 + 0.02 * (1.0 - smoothstep(0.0, 0.4, dot(c, vec3(0.33)))));
  gl_FragColor = vec4(c, 1.0);
}
`;
