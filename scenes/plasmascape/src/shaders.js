// Shaders for the plasma globe. The scene is drawn as linear HDR light into a half-float target,
// then bloomed, tone mapped and dithered once at the end.
import { STREAMERS, ELECTRODE } from './plasma.js';

// Emission colour of a channel by position s along it (0 at the electrode, 1 at the glass). The
// gas is a neon-heavy noble mix: the hot, dense stem near the electrode radiates the violet and
// blue argon and xenon lines, and the cooler outer channel the red and orange neon lines.
const SPECTRUM = /* glsl */`
vec3 spectrum(float s) {
  vec3 stem = vec3(0.10, 0.20, 1.0);
  vec3 mid = vec3(0.36, 0.12, 1.0);
  vec3 tip = vec3(1.0, 0.13, 0.30);
  return mix(mix(stem, mid, smoothstep(0.05, 0.5, s)), tip, smoothstep(0.7, 1.0, s));
}
`;

const NOISE = /* glsl */`
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

// The lit globe as a light source for everything outside it; lampLevel() is of order one for a
// resting globe and dims as a finger draws the current. The room is dark but for a moonlit window
// to the left.
const LAMP = /* glsl */`
${NOISE}
uniform float uEnergy;
float lampLevel() { return uEnergy * 7.5; }
const vec3 LAMP_TINT = vec3(0.62, 0.22, 1.0);
const vec3 MOON = vec3(0.30, 0.38, 0.52);
const vec3 MOON_DIR = vec3(-0.7, 0.68, 0.2);
// What a ray from p sees of the globe: violet gas, brightest along long chords, a pink rim of
// brushes on the glass and the hot electrode. Roughness blurs the edge; a miss sees nothing.
vec3 globeSeen(vec3 p, vec3 rd, float rough) {
  float t = -dot(p, rd);
  if (t < 0.0) return vec3(0.0);
  float b = length(p + rd * t);
  float cover = smoothstep(1.0 + rough, 1.0 - rough * 0.5, b);
  float chord = sqrt(max(1.0 - b * b, 0.0));
  vec3 gas = vec3(0.40, 0.16, 1.0) * (0.3 + 0.7 * chord);
  vec3 rim = vec3(1.0, 0.22, 0.48) * smoothstep(0.55, 0.96, b) * 0.8;
  vec3 core = vec3(0.75, 0.55, 1.0) * exp(-b * b / (0.03 + rough * 0.3)) * 1.6;
  // Reflections carry the streaky structure of the filaments, not an even wash.
  float streaks = 0.5 + noise3(rd * 7.0 + 3.0);
  return (gas + rim + core) * streaks * cover * lampLevel();
}
// Irradiance from the globe, a sphere light of radius 0.9 at the origin, with its horizon wrap.
float lampIrradiance(vec3 p, vec3 n) {
  vec3 l = -p;
  float d2 = dot(l, l);
  l *= inversesqrt(d2);
  float s2 = min(0.81 / d2, 1.0), s = sqrt(s2);
  float e = clamp((dot(n, l) + s) / (1.0 + s), 0.0, 1.0);
  return s2 * e * e;
}
// Moonlight through the window: 1 where p sees the window pane along the moon's direction, soft
// at the edges and crossed by the frame's bars. The window is in the left wall, x = -5.5.
float moonlit(vec3 p) {
  vec3 l = normalize(MOON_DIR);
  float t = (-5.5 - p.x) / l.x;
  if (t < 0.0) return 0.0;
  vec3 h = p + l * t;
  vec2 q = vec2(h.z + 0.3, h.y - 1.4), size = vec2(0.7, 1.05);
  float soft = 0.01 + 0.012 * t;
  float pane = smoothstep(size.x + soft, size.x - soft, abs(q.x)) * smoothstep(size.y + soft, size.y - soft, abs(q.y));
  float bars = smoothstep(0.03, 0.03 + soft, abs(q.x)) * smoothstep(0.03, 0.03 + soft, abs(q.y - 0.25));
  return pane * bars;
}
// The desk seen from p along a downward direction: walnut in the violet pool the globe lays on
// it, shadowed close to the lamp by the base itself.
vec3 deskSeen(vec3 p, vec3 rd) {
  if (rd.y > -0.01) return vec3(0.0);
  vec3 h = p + rd * ((-1.75 - p.y) / rd.y);
  float rho = length(h.xz);
  float seen = smoothstep(0.1, 0.95, rho * 0.543) * (1.0 - 0.85 * exp(-max(rho - 0.712, 0.0) / 0.05));
  return vec3(0.11, 0.06, 0.04) * LAMP_TINT * lampIrradiance(h, vec3(0.0, 1.0, 0.0)) * lampLevel() * 4.5 * seen;
}
// The room seen along a direction: black, but for a tall window of moonlight with a cross bar.
vec3 roomSeen(vec3 rd, float rough) {
  float az = atan(rd.x, rd.z), el = asin(clamp(rd.y, -1.0, 1.0));
  vec2 q = vec2(az + 1.28, el - 0.42);
  float soft = 0.02 + rough * 0.6;
  float pane = smoothstep(0.30 + soft, 0.30 - soft, abs(q.x)) * smoothstep(0.42 + soft, 0.42 - soft, abs(q.y));
  float bars = 1.0 - (1.0 - smoothstep(0.012, 0.012 + soft, abs(q.x))) * (1.0 - rough) - (1.0 - smoothstep(0.012, 0.012 + soft, abs(q.y + 0.06))) * (1.0 - rough);
  float falloff = 0.55 + 0.45 * smoothstep(-0.42, 0.42, q.y);
  return MOON * pane * clamp(bars, 0.0, 1.0) * falloff * 1.2 / (1.0 + rough * 3.0);
}
`;

// Glowing line pieces: one instance per segment, drawn as a capsule of gaussian cross-section.
// Overlaps between pieces of one channel take the maximum, so joints do not beam brighter.
// Thin-lens defocus widens a channel in proportion to its distance from the focal plane while
// conserving its energy.
export const RIBBON_VERT = /* glsl */`
uniform vec2 uRes;
uniform float uFocus;
uniform float uBlur;
uniform float uGhost;
uniform vec3 uBackPoint;
uniform vec3 uBackNormal;
attribute vec4 aP0;
attribute vec4 aP1;
attribute vec4 aI;
flat varying vec2 vA;
flat varying vec2 vB;
flat varying vec2 vSigma;
flat varying vec4 vLight;
void main() {
  vec2 aCorner = position.xy;
  vec3 w0 = aP0.xyz;
  vec3 w1 = aP1.xyz;
  // The ghost is the channel's faint reflection in the inside of the back wall, seen through the gas.
  if (uGhost > 0.5) {
    w0 -= 2.0 * dot(w0 - uBackPoint, uBackNormal) * uBackNormal;
    w1 -= 2.0 * dot(w1 - uBackPoint, uBackNormal) * uBackNormal;
  }
  vec4 c0 = projectionMatrix * viewMatrix * vec4(w0, 1.0);
  vec4 c1 = projectionMatrix * viewMatrix * vec4(w1, 1.0);
  vec2 p0 = (c0.xy / c0.w * 0.5 + 0.5) * uRes;
  vec2 p1 = (c1.xy / c1.w * 0.5 + 0.5) * uRes;
  float focal = projectionMatrix[1][1] * 0.5 * uRes.y;
  float s0 = aP0.w * focal / c0.w;
  float s1 = aP1.w * focal / c1.w;
  float k0 = uBlur * abs(c0.w - uFocus) / c0.w;
  float k1 = uBlur * abs(c1.w - uFocus) / c1.w;
  float e0 = sqrt(s0 * s0 + k0 * k0 * 0.16 + 0.36);
  float e1 = sqrt(s1 * s1 + k1 * k1 * 0.16 + 0.36);
  vec2 d = p1 - p0;
  float len = length(d);
  d = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  float ext = 3.6 * max(e0, e1) + 1.5;
  vec2 pos = mix(p0, p1, aCorner.x) + d * (aCorner.x * 2.0 - 1.0) * ext + vec2(-d.y, d.x) * aCorner.y * ext;
  vA = p0; vB = p1; vSigma = vec2(e0, e1);
  float gain = uGhost > 0.5 ? 0.12 : 1.0;
  vLight = vec4(aI.x * s0 / e0 * gain, aI.y * s1 / e1 * gain, aI.z, aI.w);
  gl_Position = vec4(pos / uRes * 2.0 - 1.0, mix(c0.z / c0.w, c1.z / c1.w, aCorner.x), 1.0);
}
`;

export const RIBBON_FRAG = /* glsl */`
flat varying vec2 vA;
flat varying vec2 vB;
flat varying vec2 vSigma;
flat varying vec4 vLight;
uniform float uCoreMax;
${SPECTRUM}
void main() {
  vec2 ab = vB - vA;
  float l2 = dot(ab, ab);
  float h = l2 > 1e-6 ? clamp(dot(gl_FragCoord.xy - vA, ab) / l2, 0.0, 1.0) : 0.0;
  vec2 q = gl_FragCoord.xy - vA - ab * h;
  float sigma = mix(vSigma.x, vSigma.y, h);
  float i = mix(vLight.x, vLight.y, h);
  float s = mix(vLight.z, vLight.w, h);
  float d2 = dot(q, q);
  // A bright thin core in a violet sheath: the sheath is the cooler gas around the hot channel.
  float sheath = exp(-0.5 * d2 / (sigma * sigma));
  float sc = clamp(0.3 * sigma, 0.7, uCoreMax);
  float core = exp(-0.5 * d2 / (sc * sc));
  vec3 hot = mix(vec3(0.30, 0.42, 1.0), vec3(1.0, 0.40, 0.60), smoothstep(0.7, 1.0, s));
  vec3 light = spectrum(s) * (0.42 * i * sheath) + hot * (0.9 * i * core);
  // A channel carrying a finger's current is hot enough to burn white.
  light += vec3(1.0, 0.9, 1.0) * smoothstep(1.0, 2.6, i) * core * 1.3;
  gl_FragColor = vec4(light, 1.0);
}
`;

// Where a channel lands the discharge spreads over the glass: a soft pink brush, longer along the
// direction the channel arrives from. Quads lie in the glass tangent plane, so brushes near the
// silhouette are seen edge-on and pile up into the bright rim.
export const FOOT_VERT = /* glsl */`
uniform float uFocus;
uniform float uBlur;
uniform vec2 uRes;
attribute vec4 aFoot;
attribute vec4 aTangent;
varying vec2 vUv;
varying float vStrength;
varying float vDepth;
void main() {
  vec2 aCorner = position.xy;
  vec3 n = normalize(aFoot.xyz);
  vec3 t = aTangent.yzw - n * dot(aTangent.yzw, n);
  t = length(t) > 1e-5 ? normalize(t) : normalize(cross(n, vec3(0.0, 1.0, 0.001)));
  vec3 b = cross(n, t);
  vec4 c = projectionMatrix * viewMatrix * vec4(aFoot.xyz, 1.0);
  float focal = projectionMatrix[1][1] * 0.5 * uRes.y;
  float coc = uBlur * abs(c.w - uFocus) / c.w * 0.4 * c.w / focal;
  float size = sqrt(aFoot.w * aFoot.w + coc * coc);
  vec3 world = aFoot.xyz * 1.004 + (t * aCorner.x * 1.7 + b * aCorner.y) * size * 3.0;
  vUv = aCorner * vec2(1.7, 1.0) * 3.0;
  vStrength = aTangent.x * (aFoot.w * aFoot.w) / (size * size);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

export const FOOT_FRAG = /* glsl */`
varying vec2 vUv;
varying float vStrength;
void main() {
  float r2 = dot(vUv, vUv);
  float halo = exp(-r2 * 1.4);
  float hot = exp(-r2 * 6.0);
  vec3 white = vec3(1.0, 0.75, 0.9);
  vec3 light = vec3(1.0, 0.14, 0.28) * halo * 0.3 + mix(vec3(1.0, 0.5, 0.7), white, smoothstep(1.2, 2.6, vStrength)) * hot * 0.3;
  light += white * pow(hot, 2.0) * smoothstep(1.2, 2.6, vStrength) * 1.5;
  gl_FragColor = vec4(light * vStrength, 1.0);
}
`;

// The electrode is a small glass ball with a conductive coat inside. Its surface is wrapped in the
// dense glow where the gas breaks down, brightest at the limb where the eye looks through the
// most of it, with a white-hot pit and a softer corona where each streamer attaches. The mesh is
// a little larger than the ball; each pixel shades the exact sphere and covers only its share.
export const ELECTRODE_FRAG = /* glsl */`
${LAMP}
uniform vec4 uRoots[${STREAMERS}];
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  const float R = ${ELECTRODE.radius.toFixed(3)};
  vec3 ro = cameraPosition, rd = normalize(vWorld - ro);
  float along = -dot(ro, rd), b = sqrt(max(dot(ro, ro) - along * along, 0.0));
  float cover = clamp((R - b) / max(fwidth(b), 1e-5) + 0.5, 0.0, 1.0);
  if (cover <= 0.0) discard;
  vec3 p = ro + rd * (along - sqrt(max(R * R - b * b, 0.0)));
  vec3 n = normalize(p), v = -rd;
  float mu = max(dot(n, v), 0.0);
  float pit = 0.0, corona = 0.0;
  for (int i = 0; i < ${STREAMERS}; i++) {
    float a = uRoots[i].w;
    float c = dot(n, uRoots[i].xyz);
    float d2 = max(2.0 - 2.0 * c, 0.0);   // chord distance squared on the unit sphere
    pit += a * exp(-d2 / 0.0025);
    corona += a * exp(-d2 / 0.01);
  }
  float lamp = lampLevel();
  // Behind the glow, the frosted coat shows faintly, mottled.
  float frost = 0.6 + 0.4 * noise3(n * 14.0) * noise3(n * 5.0 + 2.0);
  float limb = pow(1.0 - mu, 2.0);
  vec3 sheath = mix(vec3(0.62, 0.55, 1.0), vec3(0.45, 0.32, 1.0), limb) * (0.3 + 0.7 * limb) * lamp * 1.0;
  vec3 coat = vec3(0.5, 0.14, 0.45) * frost * lamp * 0.035;
  vec3 light = coat + sheath
    + vec3(0.5, 0.42, 1.0) * corona * 0.4
    + vec3(1.0, 0.86, 1.0) * pit * 1.1;
  // The glass of the ball reflects the window faintly.
  float fres = 0.04 + 0.96 * pow(1.0 - mu, 5.0);
  light += roomSeen(reflect(rd, n), 0.02) * fres;
  gl_FragColor = vec4(light, cover);
}
`;

// The stem, base and table are dark: they show only what the plasma lights.
export const SOLID_VERT = /* glsl */`
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

// The base is moulded black plastic: a glossy cup that holds the glass, a satin metal trim ring,
// a satin body and a rubber foot. It shows the globe mostly as reflections.
export const BASE_FRAG = /* glsl */`
${LAMP}
varying vec3 vWorld;
varying vec3 vNormal;
// The front of the body carries a push button in a chrome bezel and a small power LED. Heights are
// in globe radii over surface coordinates q (arc length around, height up).
const vec2 BUTTON = vec2(0.0, -1.35);
const vec2 LED = vec2(0.1, -1.35);
float relief(vec2 q, out float cap, out float bezel) {
  vec2 b = q - BUTTON;
  float d = length(b);
  cap = smoothstep(0.032, 0.030, d);
  // A raised chrome ring round a recessed, domed cap.
  bezel = exp(-pow((d - 0.041) / 0.0068, 2.0));
  float h = -0.003 * smoothstep(0.036, 0.033, d) + 0.004 * bezel + cap * (0.0045 - 2.0 * d * d);
  float lens = smoothstep(0.0075, 0.006, length(q - LED));
  h += 0.0016 * lens;
  return h;
}
void main() {
  vec3 p = vWorld;
  vec3 n = normalize(vNormal);
  vec3 v = normalize(cameraPosition - p);
  if (dot(n, v) < 0.0) n = -n;   // lathe normals face either way
  float y = p.y;
  float collar = step(-1.0, y), trim = step(-1.04, y) * (1.0 - collar), foot = step(y, -1.712);
  float body = 1.0 - collar - trim - foot;
#ifdef CORD
  collar = 0.0; trim = 0.0; foot = 0.0; body = 1.0;
#endif
  // Satin plastic has a fine moulded grain; the trim is brushed around its circumference.
  float grain = noise3(p * 140.0) - 0.5;
  float brushed = noise3(vec3(atan(p.x, p.z) * 3.0, y * 900.0, 0.0)) - 0.5;
  n = normalize(n + (body * 0.025 * grain) * vec3(1.0, 0.6, 1.0) + trim * 0.08 * brushed * vec3(0.0, 1.0, 0.0));
  // Controls on the front: bend the normal by the relief's slope and pick their materials.
  vec2 q = vec2(atan(p.x, p.z) * length(p.xz), y);
  float cap = 0.0, bezel = 0.0, led = 0.0;
#ifdef CORD
  float onFront = 0.0;
#else
  float onFront = body * step(abs(q.x), 0.2) * step(-1.45, y) * step(y, -1.25);
#endif
  if (onFront > 0.5) {
    float c0, b0, e = 0.0012;
    float hx = relief(q + vec2(e, 0.0), c0, b0) - relief(q - vec2(e, 0.0), c0, b0);
    float hy = relief(q + vec2(0.0, e), c0, b0) - relief(q - vec2(0.0, e), c0, b0);
    relief(q, cap, bezel);
    vec3 around = normalize(vec3(p.z, 0.0, -p.x)), up = normalize(cross(n, around));
    n = normalize(n - (hx * around + hy * up) / (2.0 * e));
    led = length(q - LED);
  }
  float rough = collar * 0.05 + trim * 0.22 + body * (0.45 + 0.08 * grain) + foot * 0.7;
  rough = max(rough, 0.6 * step(y, -1.69));
  float f0 = collar * 0.045 + trim * 0.32 + body * 0.04 + foot * 0.02;
  float albedo = collar * 0.02 + body * 0.05 + foot * 0.012;
  bezel = smoothstep(0.3, 0.6, bezel);
  rough = mix(mix(rough, 0.12, cap), 0.1, bezel);
  albedo = mix(albedo, 0.025, cap) * (1.0 - bezel);
  f0 = mix(f0, 0.6, bezel);
  vec3 metal = mix(mix(vec3(1.0), vec3(0.78, 0.74, 0.8), trim), vec3(0.85, 0.82, 0.88), bezel);
  // Where the normal turns quickly across a pixel, a sharp highlight would alias: widen it.
  // Chrome keeps most of its sharpness: widened too far, it sees the globe from every angle and
  // looks lit from within.
  vec3 dn = fwidth(n);
  rough = sqrt(rough * rough + min(dot(dn, dn) * 2.0, mix(0.5, 0.1, bezel)));
  float mu = max(dot(n, v), 0.0);
  float fres = f0 + (1.0 - f0) * pow(1.0 - mu, 5.0) * (1.0 - 0.6 * rough);
  vec3 r = reflect(-v, n);
  // Faces turned in toward the axis are inside the cup, shaded by its walls.
  float inside = collar * step(dot(n.xz, p.xz), 0.0);
  vec3 spec = (globeSeen(p, r, rough) + roomSeen(r, rough) + deskSeen(p, r)) * metal * (1.0 - 0.7 * inside);
  // The lit desk bounces a little of the globe's light back up onto the lower body.
  // Three directions across the lower hemisphere stand in for the integral.
  vec2 out_ = normalize(n.xz + 1e-4);
  vec3 bounce = (deskSeen(p, normalize(vec3(out_.x, -0.2, out_.y))) + deskSeen(p, normalize(vec3(out_.x, -0.5, out_.y)))
    + deskSeen(p, normalize(vec3(out_.x, -1.0, out_.y)))) / 3.0 * smoothstep(0.4, -0.3, n.y);
  vec3 diffuse = albedo * (LAMP_TINT * lampIrradiance(p, n) * lampLevel() * 2.2 + MOON * 0.25 * pow(max(dot(n, normalize(MOON_DIR)), 0.0), 2.0)) + albedo * 16.0 * bounce;
  vec3 light = diffuse + spec * fres;
  // The power LED: an amber point behind a small clear lens, with a faint glow on the plastic.
  if (onFront > 0.5) {
    vec3 amber = vec3(1.0, 0.36, 0.07);
    light += amber * (2.4 * smoothstep(0.0045, 0.0028, led) + 0.2 * exp(-led * led / 0.00002) + 0.04 * exp(-led * led / 0.0016));
  }
  gl_FragColor = vec4(light, 1.0);
}
`;

// The stem is an insulating glass tube around the supply wire: clear, with bright edges where
// the plasma light runs along the glass. The wire inside is drawn separately.
export const STEM_FRAG = /* glsl */`
${LAMP}
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  float mu = abs(dot(normalize(vNormal), normalize(cameraPosition - vWorld)));
  float edge = pow(1.0 - mu, 2.5);
  // Brighter toward the electrode, where the glow is densest.
  float up = exp((vWorld.y + 0.15) * 2.2);
  gl_FragColor = vec4(vec3(0.5, 0.28, 1.0) * lampLevel() * (0.003 + 0.025 * edge) * (0.4 + up), 1.0);
}
`;

// The supply wire: dark metal that shows a thin line of plasma light along its length.
export const WIRE_FRAG = /* glsl */`
${LAMP}
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec3 n = normalize(vNormal), v = normalize(cameraPosition - vWorld);
  float mu = max(dot(n, v), 0.0);
  float sheen = pow(mu, 12.0) * 0.5 + pow(1.0 - mu, 3.0) * 0.4;
  gl_FragColor = vec4(vec3(0.62, 0.36, 1.0) * lampLevel() * (0.006 + 0.05 * sheen), 1.0);
}
`;

// A walnut desk under a satin clear coat. The wood shows by the globe's light, shadowed near the
// lamp by its own base; the coat reflects the scene through a mirrored render, blurred more the
// farther the light travels and where the coat is smudged.
export const TABLE_FRAG = /* glsl */`
${LAMP}
uniform vec2 uRes;
uniform sampler2D uMirror;
varying vec3 vWorld;
varying vec3 vNormal;
// A flat-sawn slab: a slice through a log lying along x, so its growth rings meet the surface as
// long wavering lines that close into arches where the slice cuts deeper. The figure is quiet, as
// walnut is in low light, and fades where a ring spans less than a couple of pixels.
vec3 walnut(vec2 xz, float detail) {
  float depth = 0.14 + 0.1 * sin(xz.x * 0.45) + 0.08 * noise3(vec3(xz.x * 0.7, xz.y * 0.5, 3.0));
  float across = xz.y + 0.35 * (noise3(vec3(xz.x * 0.5, xz.y * 0.8, 1.0)) - 0.5) + 0.06 * (noise3(vec3(xz.x * 2.6, xz.y * 3.0, 5.0)) - 0.5);
  float phase = sqrt(across * across + depth * depth) * 6.0 + noise3(vec3(xz.x * 0.9, xz.y * 1.5, 9.0)) * 1.6;
  float blur = clamp(length(fwidth(xz)) * 6.0 * 3.0, 0.0, 1.0);
  float band = smoothstep(0.35, 0.75, fract(phase)) * smoothstep(1.0, 0.82, fract(phase));
  float late = mix(band, 0.3, blur) * (0.6 + 0.4 * noise3(vec3(xz * 2.0, 7.0)));
  float streak = (noise3(vec3(xz.x * 1.5, xz.y * 16.0, 2.0)) - 0.5) * detail;
  float tone = 0.8 + 0.4 * noise3(vec3(xz * 0.3, 0.0));
  return mix(vec3(0.13, 0.072, 0.043), vec3(0.07, 0.036, 0.021), late) * tone * (1.0 + 0.3 * streak);
}
void main() {
  vec3 p = vWorld;
  vec3 v = normalize(cameraPosition - p);
  vec2 xz = p.xz;
  float rho = length(xz);
  float detail = 1.0 - smoothstep(0.004, 0.02, length(fwidth(xz)));
  // The base hides part of the globe from the table near it: a soft shadow, darkest at the foot.
  float cross = rho * 0.543;
  float seen = smoothstep(0.1, 0.95, cross) * (1.0 - 0.85 * exp(-max(rho - 0.712, 0.0) / 0.05));
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 wood = walnut(xz, detail);
  // Moonlight is too dim for colour vision: the wood it falls on reads grey-blue.
  vec3 grey = vec3(dot(wood, vec3(0.3, 0.5, 0.2)));
  vec3 diffuse = mix(wood, grey, 0.4) * LAMP_TINT * lampIrradiance(p, up) * lampLevel() * 4.5 * seen
    + mix(wood, grey, 0.7) * MOON * (0.004 + 0.45 * moonlit(p));
  float cosine = max(v.y, 0.0);
  float fres = 0.04 + 0.96 * pow(1.0 - cosine, 5.0);
  // Wiped streaks and smudges in the coat roughen its reflection here and there.
  float smudge = smoothstep(0.35, 0.8, noise3(vec3(xz * vec2(1.4, 2.6), 4.0)) + 0.25 * noise3(vec3(xz * 9.0, 1.0)));
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 mirror = vec3(0.0);
  float radius = (0.003 + 0.01 * clamp(rho * 0.25, 0.0, 1.0)) * (1.0 + 1.5 * smudge);
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 2.399963, r = sqrt((float(i) + 0.5) / 12.0);
    vec2 o = vec2(cos(a), sin(a)) * r * radius * vec2(uRes.y / uRes.x, 1.0) * vec2(1.0, 2.6);
    mirror += texture2D(uMirror, uv + o).rgb;
  }
  mirror /= 12.0;
  // The satin coat also spreads the globe into a broad soft sheen.
  vec3 sheen = globeSeen(p, reflect(-v, up), 0.6) * fres * 0.2 * seen;
  vec3 light = diffuse + sheen + mirror * fres * (1.3 - 0.4 * smudge);
  gl_FragColor = vec4(light, 1.0);
}
`;

// The wall behind the desk: matte paint, lit by the globe and a slant of moonlight from the window.
export const WALL_FRAG = /* glsl */`
${LAMP}
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec3 p = vWorld;
  float paint = 0.2 * (0.92 + 0.08 * noise3(p * 3.0) + 0.04 * noise3(p * 40.0));
  // The corner where the desk meets the wall collects less light.
  float corner = 1.0 - 0.6 * exp(-(p.y + 1.75) / 0.25);
  vec3 light = paint * corner * (LAMP_TINT * lampIrradiance(p, vec3(0.0, 0.0, 1.0)) * lampLevel() * 2.0 + MOON * (0.003 + 0.08 * moonlit(p)));
  gl_FragColor = vec4(light, 1.0);
}
`;

// The glass shell only adds light. The front face carries the violet haze of the gas along the
// view ray, reflections of the window and the plasma, and the dust on the outside of the glass
// that scatters the plasma's light. A hollow shell of thin glass does not
// visibly refract, so nothing behind it bends.
export const GLASS_VERT = SOLID_VERT;
export const GLASS_FRAG = /* glsl */`
${LAMP}
uniform float uHaze;
uniform vec3 uContact;
varying vec3 vWorld;
varying vec3 vNormal;
// The gas glows faintly everywhere, more densely toward the electrode: the integral of
// 1 / (r^2 + c) along the chord through the shell, closest approach b. A ray that meets the
// electrode sees only the gas in front of it.
float gasColumn(float b) {
  const float c = 0.07, R = 0.955, E = ${ELECTRODE.radius.toFixed(3)};
  float k = sqrt(b * b + c), L = sqrt(max(R * R - b * b, 0.0)), s = sqrt(max(E * E - b * b, 0.0));
  return (s > 0.0 ? atan(L / k) - atan(s / k) : 2.0 * atan(L / k)) / k;
}
void main() {
  // The mesh is a little larger than the glass; each pixel shades the exact unit sphere along its
  // ray and covers only the part of the pixel inside the silhouette, so the rim is smooth.
  vec3 ro = cameraPosition, rd = normalize(vWorld - ro);
  float along = -dot(ro, rd), b = sqrt(max(dot(ro, ro) - along * along, 0.0));
  float cover = clamp((1.0 - b) / max(fwidth(b), 1e-5) + 0.5, 0.0, 1.0);
  if (cover <= 0.0) discard;
  float half_ = sqrt(max(1.0 - b * b, 0.0));
  vec3 p = ro + rd * (gl_FrontFacing ? along - half_ : along + half_);
  vec3 n = normalize(p);
  vec3 v = -rd;
  float mu = abs(dot(n, v));
  float fres = 0.04 + 0.96 * pow(1.0 - mu, 5.0);
  float rim = pow(1.0 - mu, 2.5);
  float edge = pow(1.0 - mu, 9.0);
  float toward = smoothstep(0.35, 1.0, dot(n, uContact));
  float lamp = lampLevel();
  vec3 glow = vec3(0.9, 0.16, 0.42) * uEnergy * (0.006 + 0.015 * rim)
    + vec3(0.6, 0.36, 1.0) * uEnergy * (fres * 0.25 + edge * 0.5 + pow(1.0 - mu, 18.0) * 2.4);
  vec3 haze = vec3(1.0, 0.34, 0.5) * uHaze * (0.15 + 0.85 * toward * toward) * (0.35 + 0.65 * rim + 0.3 * mu);
  vec3 light = glow + haze;
  if (gl_FrontFacing) {
    light += vec3(0.36, 0.13, 1.0) * gasColumn(b) * lamp * 0.0045;
    // The corona: a soft violet glow hugging the electrode.
    float gap = b - ${ELECTRODE.radius.toFixed(3)};
    light += vec3(0.5, 0.38, 1.0) * exp(gap > 0.0 ? -gap / 0.04 : gap / 0.012) * lamp * 0.2;
    // Grease and dust on the outside: a smudged film and fine specks, lit from behind by the
    // plasma, which they scatter toward the eye.
    float film = smoothstep(0.45, 0.9, noise3(p * 2.3 + 7.0)) * 0.6 + 0.4 * noise3(p * 9.0);
    vec3 cell = floor(p * 260.0);
    float speck = step(0.9965, hash13(cell)) * smoothstep(0.5, 0.2, length(fract(p * 260.0) - 0.5));
    // Dust shows only where light rakes across the glass, toward the rim.
    float scatter = film * 0.006 + speck * 0.3 * rim;
    light += vec3(0.75, 0.45, 1.0) * scatter * lamp * (0.4 + 0.6 * mu);
    // The window, reflected; smudges break it up a little.
    light += roomSeen(reflect(rd, n), 0.02 + 0.05 * film) * fres;
  }
  gl_FragColor = vec4(light * cover, 1.0);
}
`;

export const POST_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Bloom is a pyramid of 13-tap downsamples and tent upsamples: the scattering of bright plasma
// in the glass, the air and the eye.
export const DOWN_FRAG = /* glsl */`
uniform sampler2D uSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 a = texture2D(uSrc, vUv + uTexel * vec2(-2.0, -2.0)).rgb, b = texture2D(uSrc, vUv + uTexel * vec2(0.0, -2.0)).rgb, c = texture2D(uSrc, vUv + uTexel * vec2(2.0, -2.0)).rgb;
  vec3 d = texture2D(uSrc, vUv + uTexel * vec2(-2.0, 0.0)).rgb, e = texture2D(uSrc, vUv).rgb, f = texture2D(uSrc, vUv + uTexel * vec2(2.0, 0.0)).rgb;
  vec3 g = texture2D(uSrc, vUv + uTexel * vec2(-2.0, 2.0)).rgb, h = texture2D(uSrc, vUv + uTexel * vec2(0.0, 2.0)).rgb, i = texture2D(uSrc, vUv + uTexel * vec2(2.0, 2.0)).rgb;
  vec3 j = texture2D(uSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb, k = texture2D(uSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  vec3 l = texture2D(uSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb, m = texture2D(uSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125, 1.0);
}
`;

export const UP_FRAG = /* glsl */`
uniform sampler2D uSrc;
uniform sampler2D uBase;
uniform vec2 uTexel;
uniform float uWeight;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(uSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(uSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
    + texture2D(uSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(uSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb
    + 2.0 * (texture2D(uSrc, vUv + uTexel * vec2(0.0, -1.0)).rgb + texture2D(uSrc, vUv + uTexel * vec2(0.0, 1.0)).rgb
      + texture2D(uSrc, vUv + uTexel * vec2(-1.0, 0.0)).rgb + texture2D(uSrc, vUv + uTexel * vec2(1.0, 0.0)).rgb)
    + 4.0 * texture2D(uSrc, vUv).rgb;
  gl_FragColor = vec4(texture2D(uBase, vUv).rgb + s / 16.0 * uWeight, 1.0);
}
`;

export const OUTPUT_FRAG = /* glsl */`
uniform sampler2D uBeauty;
uniform sampler2D uBloom;
uniform vec3 uHalo;
uniform float uExposure;
uniform float uBloomGain;
uniform float uFrame;
varying vec2 vUv;
vec3 filmic(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
void main() {
  vec3 beauty = texture2D(uBeauty, vUv).rgb;
  vec3 bloom = texture2D(uBloom, vUv).rgb * uHalo * uBloomGain;
  vec3 hdr = (beauty + bloom) * uExposure;
  vec3 mapped = filmic(hdr);
  // The filmic curve greys saturated blues; restore some of the chroma the gas actually emits.
  mapped = mix(vec3(dot(mapped, vec3(0.2126, 0.7152, 0.0722))), mapped, 1.3);
  vec3 srgb = pow(max(mapped, 0.0), vec3(1.0 / 2.2));
  // A little dither keeps the dark gradients from banding.
  srgb += (hash(gl_FragCoord.xy + uFrame) + hash(gl_FragCoord.xy * 1.7 - uFrame) - 1.0) / 255.0;
  gl_FragColor = vec4(srgb, 1.0);
}
`;
