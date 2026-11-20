import { GUST, WIND } from './world.js';
import { HEIGHT_MAP, TREE, CAMERA } from './site.js';

// The pole star's shadow map is this many texels each way (render.js makes it).
export const SHADOW_SIZE = 2048;
import { ATLAS } from './tree.js';
import { SKY, MOTES } from './sky.js';

const float = (n) => Number.isInteger(n) ? `${n}.0` : `${n}`;

// Shader time wraps here. Every rate a shader multiplies it by is a whole number of
// hundredths, so each cycle comes round exactly and nothing jumps after days of running.
export const TIME_WRAP = 200 * Math.PI;
// The blossom atlas is this many cells each way.
const CELLS = 4;

const NOISE = /* glsl */ `
float hash1(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash1(i), hash1(i + vec3(1, 0, 0)), f.x), mix(hash1(i + vec3(0, 1, 0)), hash1(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash1(i + vec3(0, 0, 1)), hash1(i + vec3(1, 0, 1)), f.x), mix(hash1(i + vec3(0, 1, 1)), hash1(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float sum = 0.0, amplitude = 0.5;
  for (int i = 0; i < 4; i++) { sum += amplitude * vnoise(p); p = p * 2.03 + vec3(11.7, 5.3, 7.9); amplitude *= 0.5; }
  return sum / 0.9375;
}
`;

// The wind, as world.js has it: a steady breath, the evening's gusts crossing the lake as
// fronts, and the wind that has been asked for, which is everywhere at once.
const WIND_GLSL = /* glsl */ `
uniform float uTime, uCalm, uStir;
uniform vec4 uGusts;
const vec2 WIND = vec2(${float(WIND.x)}, ${float(WIND.z)});
float gustEnvelope(float since) { return since < 0.0 ? 0.0 : since < ${float(GUST.rise)} ? smoothstep(0.0, ${float(GUST.rise)}, since) : exp(-(since - ${float(GUST.rise)}) / ${float(GUST.fall)}); }
float gustAt(vec2 p) {
  float lag = dot(p, WIND) / ${float(GUST.speed)};
  return uGusts.y * gustEnvelope(uGusts.x - lag) + uGusts.w * gustEnvelope(uGusts.z - lag) + uStir;
}
`;
// How a point on the tree or a blade of grass moves: it leans with the wind, drifts slowly
// about, and shivers when it blows hard. flex is how far this point is free to go.
const SWAY = WIND_GLSL + /* glsl */ `
vec3 sway(vec3 p, float flex) {
  float blow = uCalm + gustAt(p.xz), a = dot(p, vec3(0.31, 0.17, 0.23));
  vec2 slow = vec2(sin(uTime * 0.63 + a * 1.3), sin(uTime * 0.47 + a * 1.7 + 1.3));
  vec2 quick = vec2(sin(uTime * 2.1 + a * 4.1), sin(uTime * 2.7 + a * 3.3 + 2.1));
  vec3 lean = vec3(WIND.x, -0.3, WIND.y) * (0.65 + 0.35 * slow.x) * blow * 0.32;
  vec3 drift = vec3(slow.x * 0.6, slow.y * 0.4, slow.y * 0.6) * (0.018 + blow * 0.06);
  vec3 shiver = vec3(quick.x, quick.y * 0.5, quick.y) * blow * 0.022;
  return p + (lean + drift + shiver) * flex;
}
`;

// The pole star's shadows are real: the scene as the pole star sees it is kept as a map of depths,
// and a point the pole star cannot see is in shadow.
const SHADOW = /* glsl */ `
uniform sampler2D uShadow;
uniform mat4 uShadowMatrix;
float poleTap(vec3 at) { return step(at.z - 0.0009, texture2D(uShadow, at.xy).r); }
// How much of the pole star reaches p: 1 in the open, 0 behind a limb, a rock or the blossom.
// spread is how soft a shadow's edge is, in texels of the map; 0 asks only yes or no.
float poleLit(vec3 p, float spread) {
  vec4 at = uShadowMatrix * vec4(p, 1.0);
  if (at.x <= 0.0 || at.y <= 0.0 || at.x >= 1.0 || at.y >= 1.0 || at.z >= 1.0) return 1.0;
  if (spread == 0.0) return poleTap(at.xyz);
  float lit = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) lit += poleTap(at.xyz + vec3(float(i), float(j), 0.0) * spread / ${float(SHADOW_SIZE)});
  return lit / 9.0;
}
`;
// One light for the whole world, so that everything in it belongs together. There are three
// colours and every surface takes all three: the silver of the pole star, which stands behind
// the tree; the teal of the night sky, which is everywhere; and the rose of the blossom,
// which glows faintly where the pole star comes through it and lights whatever lies under the crown.
const LIGHTS = SHADOW + /* glsl */ `
uniform vec3 uPoleDir, uPoleLight, uSky, uGlow;
uniform float uMirror;
const vec3 MIST = vec3(0.0022, 0.009, 0.0105);
// The light that comes from all round: the sky above, the lake (dimmer) below, and, where
// the tree hides the sky, the blossom overhead. sky is how much of the sky a point sees.
vec3 ambient(vec3 n, float sky) {
  return uSky * (sky * (0.55 + 0.45 * n.y) + 0.25 * (0.5 - 0.5 * n.y)) + uGlow * (1.0 - sky) * (0.6 + 0.4 * n.y);
}
// The air over the lake is misty. What is further off is fainter, greyer, and nearer the
// colour of the mist: it is this, more than anything, that puts one bough behind another.
vec3 throughAir(vec3 colour, vec3 p) {
  float away = length(cameraPosition - p);
  colour = mix(colour, vec3(dot(colour, vec3(0.2126, 0.7152, 0.0722))), 0.5 * clamp((away - 17.0) / 12.0, 0.0, 1.0));
  return mix(colour, MIST, 0.45 * clamp((away - 16.0) / 24.0, 0.0, 1.0));
}
// A surface's normal, roughened by a height that varies across it.
vec3 bumped(vec3 n, vec3 p, float height, float strength) {
  vec3 dpx = dFdx(p), dpy = dFdy(p), r1 = cross(dpy, n), r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  return normalize(abs(det) * n - strength * sign(det) * (dFdx(height) * r1 + dFdy(height) * r2));
}
// Something solid: a dark shape in that light, with the pole star on whatever faces it and is
// not in shadow, a line of it along the edges turned its way, and a faint sheen where it
// glances off towards the eye.
// soft is how soft its shadows' edges are (see starlit).
vec3 solid(vec3 albedo, vec3 n, vec3 p, float sky, float gloss, float soft) {
  vec3 view = normalize(cameraPosition - p);
  float direct = poleLit(p + n * 0.035, soft);
  float sheen = pow(max(dot(n, normalize(view + uPoleDir)), 0.0), 26.0) * gloss, rim = pow(1.0 - max(dot(n, view), 0.0), 3.0) * max(dot(n, uPoleDir) + 0.5, 0.0);
  return throughAir(albedo * (ambient(n, sky) + uPoleLight * direct * max(dot(n, uPoleDir), 0.0)) + uPoleLight * direct * (sheen + 0.06 * rim), p);
}
`;

// Mist is lit by what shines through it. Under the pole star it glows: the star's light
// has a body there, and the lake shows it back.
const MIST_LIGHT = /* glsl */ `
vec3 mistLit(float bearing) {
  float under = bearing - atan(uPoleDir.x, -uPoleDir.z);
  return MIST * (1.0 + 2.6 * exp(-under * under / 0.16)) + uPoleLight * vec3(0.55, 0.8, 0.9) * 0.04 * exp(-under * under / 0.035);
}
`;
// The far shore and the mist that lies along the horizon, which the sky, the stars and the
// water must agree on. Heights are sines of the elevation above the horizon.
const HORIZON = /* glsl */ `
float mistAt(float elevation) { return 0.8 * exp(-abs(elevation) / 0.016); }
float ridgeNoise(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash1(vec3(i, 3.7, 1.3)), hash1(vec3(i + 1.0, 3.7, 1.3)), f); }
// One long mountain, high away to the left behind the tree and falling to open water on
// the right, where the lake runs unbroken to the horizon.
float farRidge(float bearing) {
  float mass = smoothstep(0.24, -0.55, bearing);
  return mass * mass * (0.085 * (0.5 + 0.5 * ridgeNoise(bearing * 5.0 + 2.0)) * (0.82 + 0.18 * ridgeNoise(bearing * 19.0)) + 0.004 * ridgeNoise(bearing * 80.0));
}
// Behind it, much further off, low hills run the whole way round, a little higher to the right.
float distantRidge(float bearing) {
  return 0.01 + (0.012 + 0.03 * smoothstep(-0.3, 1.0, bearing)) * (0.4 + 0.6 * ridgeNoise(bearing * 3.6 + 7.0)) + 0.003 * ridgeNoise(bearing * 31.0);
}
// The highest land in a direction: what hides the sky there.
float skyline(float bearing) { return max(farRidge(bearing), distantRidge(bearing)); }
`;

export const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// --- The sky. What does not move in it (the dark itself, the far shore, the mist along
// the horizon) is painted once for each camera and kept. What turns is kept as a map of
// the sky round the pole star (see sky.js), painted once too, and looked up afresh each
// frame, a little further round.
export const SKY_VERT = /* glsl */ `
uniform mat4 uCameraWorld, uUnproject;
varying vec3 vDir;
void main() {
  vec4 far = uUnproject * vec4(position.xy, 1.0, 1.0);
  vDir = mat3(uCameraWorld) * (far.xyz / far.w);
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;
export const SKY_FRAG = NOISE + LIGHTS + MIST_LIGHT + HORIZON + /* glsl */ `
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  d.y = abs(d.y);
  float e = d.y, bearing = atan(d.x, -d.z);
  // Blue-black overhead, sinking to a teal airglow along the horizon. No other hue.
  vec3 colour = mix(vec3(0.0012, 0.0078, 0.0095), vec3(0.0003, 0.0005, 0.0018), pow(e, 0.36));
  colour += vec3(0.0006, 0.0046, 0.0042) * exp(-e * 8.0);
  float far = farRidge(bearing), distant = distantRidge(bearing), edge = fwidth(e) * 1.2, mist = mistAt(e);
  float shore = 1.0 - smoothstep(far - edge, far + edge, e), hills = 1.0 - smoothstep(distant - edge, distant + edge, e);
  vec3 lit = mistLit(bearing);
  // The distant hills are pale with all the air in front of them; the near shore is dark.
  colour = mix(colour, mix(vec3(0.0011, 0.0042, 0.0052), lit, 0.28), hills);
  colour = mix(colour, mix(vec3(0.0007, 0.0022, 0.003), lit, 0.55 * exp(-e / 0.022)), shore);
  // With it goes how much of the turning sky shows here: none through the land, less through the mist.
  gl_FragColor = vec4(mix(colour, lit, mist), (1.0 - max(shore, hills)) * (1.0 - mist));
}
`;
// The map of the turning sky, before the stars are drawn on it: the pole star at its
// heart, and winding out from it the two arms of a great spiral. An arm is not a cloud.
// It is billows of starlight drawn out along its length into threads, cut by lanes of dust
// along its inner edge and by feathers of dust slanting across it, and beaded with small
// bright knots: rose where stars are being made, blue-white where they are newly made.
// Silver on the whole, bluer towards its outer edge and warmer towards the pole.
export const GALAXY_FRAG = NOISE + /* glsl */ `
varying vec2 vUv;
float deep(vec3 p) {
  float sum = 0.0, amplitude = 0.5;
  for (int i = 0; i < 6; i++) { sum += amplitude * vnoise(p); p = p * 2.07 + vec3(11.7, 5.3, 7.9); amplitude *= 0.5; }
  return sum / 0.984;
}
// Noise folded into ridges: bright along thin winding lines, dark between.
float ridged(vec3 p) {
  float sum = 0.0, amplitude = 0.5;
  for (int i = 0; i < 5; i++) { float n = 1.0 - abs(2.0 * vnoise(p) - 1.0); sum += amplitude * n * n; p = p * 2.11 + vec3(3.1, 17.3, 9.7); amplitude *= 0.5; }
  return sum / 0.969;
}
// Small soft lights, at most one to a cell and fewer the higher the rarity.
float knots(vec2 p, float seed, float rarity) {
  vec2 cell = floor(p), within = fract(p);
  float sum = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 over = vec2(float(i), float(j));
    vec3 key = vec3(cell + over, seed);
    float chance = hash1(key);
    if (chance < rarity) continue;
    vec2 away = over + vec2(hash1(key + 3.7), hash1(key + 9.1)) - within;
    float size = 0.07 + 0.2 * hash1(key + 5.3), near = dot(away, away) / (size * size);
    sum += (chance - rarity) / (1.0 - rarity) * (exp(-near) + 0.25 * exp(-near / 6.0));
  }
  return sum;
}
void main() {
  float out_ = vUv.y * ${float(SKY.reach)}, round = vUv.x * 6.2832;
  vec3 d = vec3(sin(out_) * cos(round), cos(out_), sin(out_) * sin(round)), colour = vec3(0.0);
  for (int arm = 0; arm < 2; arm++) for (int n = -1; n <= 2; n++) {
    // An arm is this far out when it has come this many turns round, and wider the
    // further out it is. It begins faint, close in by the pole star, with no hard start.
    float turns = vUv.x + float(n) + 0.5 * float(arm), centre = 0.1 + 0.55 * turns, which = float(arm) * 7.3;
    if (centre < 0.0) continue;
    // Its own coordinates: how far along it (about as arc), and how far across (in arm widths), wandering a little.
    float along = turns * 6.2832 * (0.25 + centre);
    float across = (out_ - centre) / (0.045 + 0.1 * centre) + 0.9 * (deep(vec3(along * 1.4, 3.1, which)) - 0.5);
    float body = exp(-across * across), strength = exp(-centre / 0.7) * smoothstep(0.0, 0.22, centre) * (arm == 0 ? 1.0 : 0.6);
    // Billows, each folded by the ones beside it, and the threads they are drawn out into.
    vec3 here = vec3(along * 2.2, across * 1.3, which + 2.0);
    float billow = deep(here + 1.7 * vec3(deep(here * 0.7 + 5.0), deep(here * 0.7 + 11.0), 0.0));
    float threads = ridged(vec3(along * 5.0, across * 2.6 + billow * 1.5, which + 7.0));
    float light = body * (0.14 + 3.3 * billow * billow) * (0.4 + 1.25 * threads);
    // Dust: a lane along the inner edge, and feathers slanting across.
    float lane = ridged(vec3(along * 3.2 + 4.0, (across + 0.7) * 2.2 - billow, which + 13.0)) * smoothstep(0.5, -0.9, across);
    float feather = pow(ridged(vec3(along * 7.0 + across * 3.0, across * 1.4, which + 19.0)), 2.0) * body;
    float dust = clamp(1.2 * pow(lane, 1.6) + 0.75 * feather, 0.0, 1.0);
    // Knots: where stars are being made, and clusters of those just made, further out across the arm.
    // They keep to the inner edge, by the dust, and blush the starlight about them.
    float nests = knots(vec2(along * 13.0, across * 3.0), which + 23.0, 0.5) * smoothstep(0.35, 0.65, billow) * exp(-pow(across + 0.25, 2.0) * 1.8);
    float clusters = knots(vec2(along * 44.0, across * 10.0), which + 31.0, 0.45) * smoothstep(0.3, 0.6, billow) * exp(-pow(across - 0.3, 2.0) * 2.0);
    float blush = smoothstep(0.45, 0.75, deep(vec3(along * 3.0, across * 0.9, which + 41.0))) * smoothstep(0.6, -0.6, across);
    vec3 tint = mix(vec3(1.0, 0.84, 0.74), vec3(0.4, 0.66, 1.0), smoothstep(-0.8, 0.8, across) * smoothstep(0.08, 0.5, centre));
    tint = mix(tint, vec3(1.0, 0.46, 0.6), 0.45 * blush);
    // Light that comes through the dust comes through redder.
    colour += strength * (tint * light * (1.0 - 0.85 * dust) + vec3(0.8, 0.42, 0.36) * light * dust * 0.3
      + vec3(1.0, 0.36, 0.55) * nests * 2.6 + vec3(0.55, 0.78, 1.0) * clusters * 1.7);
  }
  // Between the arms, the faint general glow of the disk.
  colour += vec3(0.3, 0.38, 0.62) * 0.07 * exp(-out_ / 0.45) * (0.5 + deep(d * 6.0));
  // The grain of stars too faint and too many to draw one by one.
  colour *= 0.06 * mix(1.0, clamp(4.2 * fbm(d * 140.0) * fbm(d * 45.0 + 3.0), 0.3, 2.2), 0.6);
  // The pole star itself, and the glow round it.
  colour += vec3(1.0, 0.96, 0.93) * (9.0 * exp(-out_ * out_ / 0.00003) + 0.22 * exp(-out_ * out_ / 0.0012) + 0.028 * exp(-out_ / 0.07) + 0.006 * exp(-out_ / 0.3));
  gl_FragColor = vec4(colour, 1.0);
}
`;
// A star on that map: a dash lying the way the sky turns, as long as the exposure, bright
// at its leading end and fading back along its length.
export const TRAIL_VERT = /* glsl */ `
uniform float uShift;
attribute vec4 aDash;
attribute vec3 aTint;
varying vec3 vColour;
varying vec2 vAt;
void main() {
  vAt = position.xy;
  vColour = aTint * 0.085 * pow(aDash.w, 0.85);
  gl_Position = vec4((aDash.x + (position.x * 0.5 + 0.5) * aDash.z + uShift) * 2.0 - 1.0, (aDash.y + position.y * 1.2 / ${float(SKY.height)}) * 2.0 - 1.0, 0.0, 1.0);
}
`;
export const TRAIL_FRAG = /* glsl */ `
varying vec3 vColour;
varying vec2 vAt;
void main() {
  // The sky turns towards the low end of the map, so that end of the dash leads.
  float back = vAt.x * 0.5 + 0.5;
  gl_FragColor = vec4(vColour * smoothstep(0.0, 0.05, back) * (1.0 - 0.75 * back) * smoothstep(1.0, 0.7, back) * exp(-vAt.y * vAt.y * 2.5), 1.0);
}
`;
// The sky behind everything: the kept picture of what is still, and over it the map of
// what turns, looked up by how far each line of sight is from the pole and how far round.
export const BACKDROP_FRAG = /* glsl */ `
uniform sampler2D uPainted, uTrails;
uniform vec2 uRes;
uniform vec3 uPoleDir, uPoleEast, uPoleNorth, uPoleLight;
uniform vec2 uStarAt;
uniform float uSpin;
varying vec3 vDir;
void main() {
  vec4 still = texture2D(uPainted, gl_FragCoord.xy / uRes);
  // A lens draws a very bright point as a small star of four rays. They belong to the
  // lens, so they stay upright while the sky turns.
  vec2 off = (gl_FragCoord.xy / uRes - uStarAt) * vec2(uRes.x / uRes.y, 1.0);
  float along = abs(off.x * 0.966 + off.y * 0.259), across = abs(off.y * 0.966 - off.x * 0.259);
  still.rgb += uPoleLight * vec3(0.9, 0.95, 1.0) * 0.45 * (exp(-across * 260.0 - along * 38.0) + exp(-along * 260.0 - across * 38.0));
  vec3 d = normalize(vDir);
  float out_ = acos(clamp(dot(d, uPoleDir), -1.0, 1.0)) / ${float(SKY.reach)};
  vec3 turning = out_ < 1.0 ? texture2D(uTrails, vec2(atan(dot(d, uPoleNorth), dot(d, uPoleEast)) / 6.2832 + uSpin, out_)).rgb : vec3(0.0);
  // Low in the sky there is more air to look through, and the stars dim.
  gl_FragColor = vec4(still.rgb + turning * still.a * exp(-0.03 / max(d.y, 0.012)), 1.0);
}
`;
// A mote: a speck of light going round the pole in its own time.
export const MOTE_VERT = NOISE + HORIZON + /* glsl */ `
uniform vec3 uPoleDir, uPoleEast, uPoleNorth;
uniform float uTime, uMoteSpin, uMoteScale;
attribute vec4 aMote, aLook;
attribute vec3 aTint;
varying vec3 vColour;
void main() {
  // The sky turns towards the low end of its map, and the motes go the same way round.
  float round = (aMote.x - aMote.z * uMoteSpin) * 6.2832, out_ = (aMote.y + aMote.w * sin(6.2832 * 2.0 * aMote.z * uMoteSpin + aLook.y)) * ${float(SKY.reach)};
  vec3 d = uPoleDir * cos(out_) + (uPoleEast * cos(round) + uPoleNorth * sin(round)) * sin(out_);
  float flux = aLook.x * (1.0 + 0.45 * sin(uTime * aLook.z + aLook.y)) * exp(-0.03 / max(d.y, 0.012));
  float size = (1.4 + 1.6 * sqrt(aLook.x)) * uMoteScale;
  vColour = aTint * flux;
  vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * d, 1.0);
  gl_Position = d.y > skyline(atan(d.x, -d.z)) + 0.004 ? vec4(clip.xy, clip.w * 0.99999, clip.w) : vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = size;
}
`;
export const MOTE_FRAG = /* glsl */ `
varying vec3 vColour;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  gl_FragColor = vec4(vColour * (exp(-r2 * 6.0) + 0.2 * exp(-r2 * 1.8)) * (1.0 - smoothstep(0.8, 1.0, r2)), 1.0);
}
`;
// A shooting star: a short streak that brightens, runs and fades.
export const METEOR_VERT = /* glsl */ `
uniform vec3 uFrom, uHeading;
uniform float uAge;
varying vec2 vAt;
void main() {
  // position.x runs from the head (0) back along the tail (1); position.y is across.
  float run = uAge * 0.34;
  vec3 head = normalize(uFrom + uHeading * run), tail = normalize(uFrom + uHeading * max(0.0, run - 0.07));
  vec4 a = projectionMatrix * vec4(mat3(viewMatrix) * head, 1.0), b = projectionMatrix * vec4(mat3(viewMatrix) * tail, 1.0);
  vec2 along = normalize(a.xy / a.w - b.xy / b.w);
  vec4 clip = mix(a, b, position.x);
  clip.xy += vec2(-along.y, along.x) * position.y * 0.0026 * clip.w;
  gl_Position = vec4(clip.xy, clip.w * 0.99999, clip.w);
  vAt = position.xy;
}
`;
export const METEOR_FRAG = /* glsl */ `
uniform float uAge;
varying vec2 vAt;
void main() {
  float life = smoothstep(0.0, 0.12, uAge) * (1.0 - smoothstep(0.55, 0.9, uAge));
  float streak = (1.0 - vAt.x) * (1.0 - vAt.x) * exp(-vAt.y * vAt.y * 4.0);
  gl_FragColor = vec4(vec3(0.8, 0.9, 1.0) * streak * life * 2.4, 1.0);
}
`;

// --- Mist: thin sheets of it lying on the lake behind the islet, lit from behind by the pole star.
export const MIST_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() { vUv = uv; vWorld = position; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }
`;
export const MIST_FRAG = NOISE + LIGHTS + /* glsl */ `
uniform float uDrift, uSeed;
const vec2 TREE = vec2(${float(TREE.x)}, ${float(TREE.z)});
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  // Thickest just above the water, torn into banks along its length, gone at its ends.
  float shape = smoothstep(0.0, 0.12, vUv.y) * pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.6) * smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
  if (shape < 0.004) discard;
  float body = fbm(vec3(vWorld.x * 0.07 + uDrift + uSeed, vWorld.y * 1.1, uSeed * 3.0)) * (0.6 + 0.8 * vnoise(vec3(vWorld.x * 0.3 - uDrift * 2.0, vWorld.y * 3.0, uSeed)));
  float alpha = smoothstep(0.26, 0.7, body) * shape * 0.42;
  vec3 view = normalize(cameraPosition - vWorld);
  // Mist throws light forwards, so it is brightest looking towards the pole star.
  // It is the sky's colour, brightened by the pole star behind it, and blushes near the tree.
  float towards = max(dot(-view, uPoleDir), 0.0);
  vec3 colour = uSky * (0.9 + 2.6 * pow(towards, 3.0)) + uPoleLight * (0.008 + 0.07 * pow(towards, 14.0))
    + uGlow * 0.6 * exp(-dot(vWorld.xz - TREE, vWorld.xz - TREE) / 160.0);
  gl_FragColor = vec4(colour * alpha, alpha);
}
`;

// --- The islet and its rocks: one stone.
export const GROUND_VERT = /* glsl */ `
attribute float aSky;
varying vec3 vWorld, vNormal;
varying float vSky;
void main() {
  vWorld = position; vNormal = normal; vSky = aSky;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;
const STONE = /* glsl */ `
// Dark weathered rock, split along its bedding, with moss wherever it faces the sky and a
// black band where the lake wets it.
vec3 stone(vec3 p, inout vec3 n) {
  float coarse = fbm(p * 3.0), fine = fbm(p * 13.0 + 3.0), speck = vnoise(p * 90.0);
  float bedding = fbm(vec3(p.x * 1.4, p.y * 7.0, p.z * 1.4) + coarse), crack = smoothstep(0.44, 0.5, bedding) * (1.0 - smoothstep(0.5, 0.56, bedding));
  vec3 albedo = mix(vec3(0.03, 0.033, 0.038), vec3(0.085, 0.088, 0.09), coarse) * (0.8 + 0.4 * fine) * (1.0 - 0.5 * crack);
  albedo = mix(albedo, vec3(0.13, 0.13, 0.125), smoothstep(0.8, 0.95, speck) * 0.4);
  // Only the broad shapes tilt the surface; anything finer would glitter as the eye moves over it.
  n = bumped(n, p, coarse * 0.7 + bedding * 0.3, 0.045);
  float mossy = smoothstep(0.35, 0.75, n.y * 0.8 + fbm(p * 2.2 + 7.0) * 0.55) * smoothstep(0.03, 0.2, p.y);
  albedo = mix(albedo, vec3(0.016, 0.03, 0.024) * (0.6 + 0.8 * fine), mossy * 0.9);
  return albedo * mix(1.0, 0.3, 1.0 - smoothstep(0.0, 0.07, p.y + (fine - 0.5) * 0.04));
}
`;
export const GROUND_FRAG = NOISE + LIGHTS + STONE + /* glsl */ `
varying vec3 vWorld, vNormal;
varying float vSky;
void main() {
  if (uMirror > 0.5 && vWorld.y < 0.0) discard;
  vec3 n = normalize(vNormal), albedo = stone(vWorld, n);
  gl_FragColor = vec4(solid(albedo, n, vWorld, vSky, 0.05, 1.5), 1.0);
}
`;
// --- The trunk and branches.
export const LIMB_VERT = SWAY + /* glsl */ `
attribute vec3 aBark;
attribute float aFlex, aSky;
varying vec3 vWorld, vNormal, vBark;
varying float vSky;
void main() {
  vWorld = sway(position, aFlex); vNormal = normal; vBark = aBark; vSky = aSky;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;
export const LIMB_FRAG = NOISE + LIGHTS + /* glsl */ `
varying vec3 vWorld, vNormal, vBark;
varying float vSky;
void main() {
  if (uMirror > 0.5 && vWorld.y < 0.0) discard;
  // A twig is a dark line a pixel or two wide: it has no room for bark, or for a soft-edged shadow.
  if (vBark.z < 0.02) { gl_FragColor = vec4(solid(vec3(0.05, 0.04, 0.04), normalize(vNormal), vWorld, vSky, 0.0, 0.0), 1.0); return; }
  // Cherry bark: dark and faintly glossy, with pale lenticels lying in soft bands round the
  // limb, and the old wood of the trunk broken into long plates with furrows between. All
  // of it soft-edged, and fading out before it gets too fine to draw.
  vec2 q = vBark.xy;
  float thick = smoothstep(0.05, 0.22, vBark.z), drawn = 1.0 - smoothstep(0.004, 0.02, max(length(dFdx(q)), length(dFdy(q))));
  float broad = fbm(vec3(q * vec2(3.0, 1.2), 1.0)), bands = fbm(vec3(q.x * 3.0, q.y * 24.0, 3.0)), plates = fbm(vec3(q.x * 9.0, q.y * 1.6, 7.0));
  float furrow = smoothstep(0.38, 0.5, plates) * (1.0 - smoothstep(0.5, 0.62, plates)) * thick * drawn;
  vec3 albedo = mix(vec3(0.03, 0.024, 0.024), vec3(0.085, 0.064, 0.062), broad);
  albedo = mix(albedo, vec3(0.12, 0.09, 0.085), smoothstep(0.5, 0.72, bands) * 0.5 * drawn) * (1.0 - 0.7 * furrow);
  vec3 n = bumped(normalize(vNormal), vWorld, broad * 0.5 + plates * 0.6 * thick, 0.03 * (0.3 + thick));
  // Moss on the upper sides of the old limbs and round the foot of the trunk.
  float green = smoothstep(0.5, 0.85, n.y * 0.6 + fbm(vWorld * 3.0 + 4.0) * 0.75 + 0.35 * exp(-max(vWorld.y - 0.9, 0.0) / 0.35)) * smoothstep(0.02, 0.07, vBark.z);
  albedo = mix(albedo, vec3(0.016, 0.03, 0.024) * (0.6 + 0.8 * vnoise(vWorld * 17.0)), green * 0.8);
  gl_FragColor = vec4(solid(albedo, n, vWorld, vSky, 0.1 * (1.0 - green), 1.5), 1.0);
}
`;

// --- Grass: each blade a narrow strip, curved over and tapering to its tip.
export const GRASS_VERT = SWAY + SHADOW + /* glsl */ `
uniform float uPixel;
attribute vec4 aRoot, aBlade;
attribute float aSky;
varying vec3 vWorld, vNormal;
varying vec2 vLit, vLook;
void main() {
  float t = position.y, height = aRoot.w, lean = aBlade.y;
  vec3 side = vec3(cos(aBlade.x), 0.0, sin(aBlade.x)), forward = vec3(-side.z, 0.0, side.x);
  vec3 p = aRoot.xyz + vec3(0.0, 1.0, 0.0) * height * t * (1.0 - 0.3 * lean * t) + forward * height * lean * t * t;
  p = sway(p, t * t * (0.2 + height * 1.6));
  // Never much thinner than a pixel, or the tufts would shimmer.
  float width = max(aBlade.w * (1.0 - 0.85 * t * t), length(cameraPosition - p) * uPixel * 0.5 * (1.0 - 0.6 * t));
  p += side * position.x * width;
  vWorld = p;
  vNormal = normalize(vec3(0.0, 1.0, 0.0) + forward * (0.5 * lean + 0.25) * (1.0 - 2.0 * step(0.5, fract(aBlade.z * 7.0))));
  // A whole blade is in the pole star's light or out of it.
  vLit = vec2(poleLit(aRoot.xyz + vec3(0.0, 0.6 * height, 0.0), 0.0), aSky);
  vLook = vec2(t, aBlade.z);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
export const GRASS_FRAG = LIGHTS + /* glsl */ `
varying vec3 vWorld, vNormal;
varying vec2 vLit, vLook;
void main() {
  float t = vLook.x;
  vec3 albedo = mix(vec3(0.022, 0.03, 0.028), vec3(0.036, 0.046, 0.04), vLook.y) * (0.35 + 0.65 * t);
  vec3 n = normalize(vNormal), view = normalize(cameraPosition - vWorld);
  // The pole star stands behind, so it shines through the tips of the blades.
  float through = pow(max(dot(-view, uPoleDir), 0.0), 2.0) * t;
  vec3 lit = ambient(n, vLit.y) + uPoleLight * vLit.x * (0.8 * max(dot(n, uPoleDir), 0.0) + 0.6 * through);
  gl_FragColor = vec4(throughAir(albedo * lit, vWorld), 1.0);
}
`;

// --- The blossom atlas: sixteen small paintings of flowers, buds and one loose petal,
// which every flower on the tree is drawn from.
export const ATLAS_FRAG = NOISE + /* glsl */ `
varying vec2 vUv;
const vec3 PALE = vec3(1.0, 0.93, 0.94), ROSE = vec3(0.98, 0.78, 0.82), DEEP = vec3(0.82, 0.42, 0.52), CALYX = vec3(0.42, 0.14, 0.2);
vec3 painted;
float cover;
void lay(vec3 colour, float alpha) { painted = mix(painted, colour, alpha); cover = max(cover, alpha); }
// One petal from the origin along its angle: narrow at the base, widest past the middle,
// and notched at the tip.
void petal(vec2 p, float angle, float len, float wide, float notch) {
  float c = cos(angle), s = sin(angle);
  vec2 q = vec2(c * p.x + s * p.y, c * p.y - s * p.x);
  float a = q.x / len, half_ = wide * pow(sin(3.14159 * pow(clamp(a, 0.0, 1.0), 0.62)), 0.75);
  float tip = 1.0 - notch * (1.0 - smoothstep(0.0, 0.35 * wide, abs(q.y)));
  float inside = min(min(half_ - abs(q.y), (tip - a) * len), q.x);
  // The petal casts a little shade on whatever is under its edge.
  painted *= 1.0 - 0.2 * smoothstep(-0.07, 0.0, inside) * cover;
  float across = q.y / max(half_, 0.001);
  vec3 colour = mix(DEEP, mix(ROSE, PALE, smoothstep(0.35, 0.95, a)), smoothstep(0.05, 0.6, a));
  colour *= 0.9 + 0.1 * across * across - 0.05 * smoothstep(0.75, 1.0, abs(sin(across * 9.0)));
  lay(colour, smoothstep(-0.008, 0.008, inside));
}
void main() {
  vec2 cell = floor(vUv * ${float(CELLS)}), p = fract(vUv * ${float(CELLS)}) * 2.0 - 1.0;
  float kind = cell.x + cell.y * ${float(CELLS)}, seed = kind * 7.31;
  painted = ROSE; cover = 0.0;
  if (kind < ${float(ATLAS.side[0])}) {
    // An open flower, face on: five petals, then the stamens over their bases.
    for (int k = 0; k < 5; k++) {
      float f = float(k);
      if (kind == 5.0 && k == 3) continue;
      petal(p, f * 1.2566 + seed + 0.2 * (hash1(vec3(f, seed, 1.0)) - 0.5), 0.72 + 0.1 * hash1(vec3(f, seed, 2.0)), 0.2 + 0.06 * hash1(vec3(f, seed, 3.0)), 0.08 + 0.08 * hash1(vec3(f, seed, 4.0)));
    }
    float r = length(p), around = atan(p.y, p.x) * 16.0 / 6.28318 + seed, reach = 0.2 + 0.14 * hash1(vec3(floor(around), seed, 5.0));
    float thread = smoothstep(0.2, 0.05, abs(fract(around) - 0.5)) * smoothstep(reach + 0.02, reach - 0.02, r);
    lay(mix(DEEP, PALE, 0.5), thread * 0.8 * cover);
    lay(vec3(0.98, 0.8, 0.3), smoothstep(0.045, 0.02, length(vec2(r - reach, (fract(around) - 0.5) * r * 0.39))) * cover);
    lay(CALYX * 1.4, smoothstep(0.1, 0.06, r));
  } else if (kind < ${float(ATLAS.bud[0])}) {
    // A flower seen from the side: a cup of petals on its dark calyx and stalk.
    lay(CALYX * 0.8, smoothstep(0.035, 0.015, abs(p.x + 0.1 * p.y * p.y)) * step(p.y, -0.3) * step(-0.85, p.y));
    for (int k = 0; k < 5; k++) {
      float f = float(k);
      petal(vec2(p.x, (p.y + 0.3) * 1.25), 1.5708 + (f - 2.0) * 0.5 + 0.12 * (hash1(vec3(f, seed, 1.0)) - 0.5), 0.78 + 0.12 * hash1(vec3(f, seed, 2.0)), 0.24, 0.1);
    }
    lay(CALYX, smoothstep(1.0, 0.8, length((p - vec2(0.0, -0.3)) / vec2(0.15, 0.2))));
  } else if (kind < ${float(ATLAS.petal)}) {
    // A bud, still shut, deeper pink than the open flower.
    lay(CALYX * 0.8, smoothstep(0.035, 0.015, abs(p.x)) * step(p.y, -0.2) * step(-0.85, p.y));
    vec2 q = (p - vec2(0.0, 0.08)) / vec2(0.25 + 0.04 * (kind - 12.0), 0.4);
    lay(mix(DEEP, ROSE, smoothstep(-0.6, 0.9, q.y + 0.4 * q.x)), smoothstep(1.0, 0.92, length(q)));
    lay(CALYX, smoothstep(1.0, 0.85, length((p - vec2(0.0, -0.22)) / vec2(0.17, 0.2))));
  } else {
    // A loose petal.
    petal(p + vec2(0.8, 0.0), 0.0, 1.6, 0.52, 0.09);
  }
  gl_FragColor = vec4(painted, cover);
}
`;
const ATLAS_CELL = /* glsl */ `
vec2 atlasUv(float cell, vec2 q) { return (vec2(mod(cell, ${float(CELLS)}), floor(cell / ${float(CELLS)})) + 0.5 + q * 0.5) / ${float(CELLS)}; }
`;
// Reading the atlas: the flower's colour, and how much of the pixel it covers, kept from
// thinning away as the flower gets small.
const ATLAS_GLSL = /* glsl */ `
uniform sampler2D uAtlas;
vec4 atlas(vec2 uv) {
  // Never so coarse a level of the atlas that one cell runs into the next.
  float level = log2(max(length(dFdx(uv)), length(dFdy(uv))) * 1024.0);
  vec4 flower = textureLod(uAtlas, uv, min(level, 6.0));
  // Close to, the edge is cut clean; far off, a flower is a few pixels of partial cover.
  float crisp = (flower.a - 0.5) / max(fwidth(flower.a), 0.0001) + 0.5, soft = flower.a * (1.05 + 0.2 * max(level, 0.0));
  flower.a = clamp(mix(crisp, soft, clamp(level + 0.5, 0.0, 1.0)), 0.0, 1.0);
  return flower;
}
`;
const PETAL_LIGHT = /* glsl */ `
// A petal is thin: it turns back about half the light that falls on it and passes the
// rest, a little pinker for the passage. The pole star is behind the tree, so most of what
// reaches the eye has come through a petal or two; deeper in the crown the light has been
// thinned by everything it passed (see light.js) and the blossom is nearly dark. It is
// starlight, so none of it is bright. pale is how white the flower is.
vec3 petalLight(vec3 albedo, vec3 n, vec3 p, vec2 lit, float pale) {
  vec3 view = normalize(cameraPosition - p);
  if (dot(n, view) < 0.0) n = -n;
  float facing = dot(n, uPoleDir);
  vec3 passed = albedo * mix(vec3(0.96, 0.72, 0.78), vec3(0.97, 0.9, 0.92), pale);
  vec3 around = uSky * lit.y * (0.7 + 0.3 * n.y) + 0.4 * uGlow * (1.0 - lit.y);
  // Looking towards the star through the blossom, the petals in the way are full of its
  // light: that is where the crown burns brightest, and only there.
  float towards = pow(max(dot(-view, uPoleDir), 0.0), 40.0);
  return throughAir(albedo * around + uPoleLight * lit.x * (0.5 * albedo * max(facing, 0.0) + passed * (0.5 * max(-facing, 0.0) + 1.3 * towards)), p);
}
`;

// --- Blossom: every flower a small card facing its own way, turned a little to the eye.
export const BLOSSOM_VERT = SWAY + ATLAS_CELL + /* glsl */ `
attribute vec4 aAt, aFace;
attribute vec3 aLook;
attribute vec2 aLit;
varying vec3 vWorld, vNormal, vAcross, vUp;
varying vec2 vQ, vUv, vLit;
varying float vTint;
void main() {
  vec3 centre = sway(aAt.xyz, aLook.z), eye = normalize(cameraPosition - centre);
  vec3 n = normalize(mix(aFace.xyz, eye * sign(dot(aFace.xyz, eye) + 0.0001), 0.3));
  vec3 across = normalize(cross(n, vec3(0.13, 1.0, 0.07))), up = cross(n, across);
  float c = cos(aFace.w), s = sin(aFace.w);
  vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
  vWorld = centre + (across * q.x + up * q.y) * aAt.w * 0.5;
  vNormal = n; vAcross = across * c + up * s; vUp = up * c - across * s;
  vQ = position.xy; vUv = atlasUv(aLook.x, position.xy); vTint = aLook.y; vLit = aLit;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;
export const BLOSSOM_FRAG = LIGHTS + ATLAS_GLSL + PETAL_LIGHT + /* glsl */ `
varying vec3 vWorld, vNormal, vAcross, vUp;
varying vec2 vQ, vUv, vLit;
varying float vTint;
void main() {
  if (uMirror > 0.5 && vWorld.y < 0.0) discard;
  vec4 flower = atlas(vUv);
  if (flower.a < 0.08) discard;
  // Some flowers are nearly white, some a deeper pink; each is a shallow cup.
  vec3 albedo = flower.rgb * mix(vec3(1.0, 0.8, 0.85), vec3(1.0, 0.99, 0.98), vTint) * (0.86 + 0.14 * fract(vTint * 9.7));
  vec3 n = normalize(vNormal + (vAcross * vQ.x + vUp * vQ.y) * 0.55);
  gl_FragColor = vec4(petalLight(albedo, n, vWorld, vLit, vTint), flower.a);
}
`;

// --- Loose petals: in the air, on the water and on the rock.
export const AIR_VERT = ATLAS_CELL + /* glsl */ `
attribute vec4 aAt;
attribute vec3 aLook;
attribute vec2 aLit;
varying vec3 vWorld, vNormal;
varying vec2 vUv, vLit;
varying float vAlpha;
void main() {
  float tumble = aAt.w, turn = aLook.y * 6.2832;
  vec3 n = normalize(vec3(sin(tumble) * cos(turn), 0.8 * cos(tumble * 0.8) + 0.3, sin(tumble) * sin(turn) + 0.4 * cos(tumble * 1.3)));
  vec3 across = normalize(cross(n, vec3(sin(turn), 0.2, cos(turn)))), up = cross(n, across);
  float c = cos(tumble * 0.6 + turn), s = sin(tumble * 0.6 + turn);
  vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
  // A petal can blow right up to the eye. Only at arm's length does it shrink away, so it never fills the frame.
  float size = aLook.x * smoothstep(0.0, 0.3, aLook.z) * smoothstep(0.35, 0.9, length(cameraPosition - aAt.xyz));
  vWorld = aAt.xyz + (across * q.x + up * q.y + n * 0.3 * position.x * position.x) * size * 0.5;
  vNormal = n; vLit = aLit; vAlpha = aLook.z;
  vUv = atlasUv(${float(ATLAS.petal)}, position.xy);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;
// A petal lying flat is all but edge-on from across the lake, so it is tipped towards the
// eye a little with distance: enough to stay a fleck of colour, not enough to stand up.
const LYING = /* glsl */ `
vec3 lying(vec3 centre, vec3 n, float turn, float size, vec2 corner) {
  vec3 eye = cameraPosition - centre;
  n = normalize(n + normalize(eye) * clamp(length(eye) * 0.011, 0.0, 0.34));
  vec3 across = normalize(cross(n, vec3(sin(turn), 0.0, cos(turn)))), up = cross(n, across);
  return centre + (across * corner.x + up * corner.y) * size * 0.5;
}
`;
export const AFLOAT_VERT = ATLAS_CELL + LYING + /* glsl */ `
attribute vec4 aAt;
attribute vec3 aLit;
varying vec3 vWorld, vNormal;
varying vec2 vUv, vLit, vQ;
varying float vAlpha, vShade;
void main() {
  // The card is larger than the petal, to hold the dark ring of water pressed down round it.
  vWorld = lying(vec3(aAt.x, 0.006, aAt.y), vec3(0.0, 1.0, 0.0), aAt.z, aAt.w * ${float(1.45)} * step(0.001, aLit.x), position.xy);
  vNormal = vec3(0.0, 1.0, 0.0); vLit = aLit.yz; vAlpha = aLit.x; vQ = position.xy; vShade = 0.72 + 0.38 * fract(aAt.z * 3.7);
  vUv = atlasUv(${float(ATLAS.petal)}, position.xy);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;
export const FALLEN_VERT = ATLAS_CELL + LYING + /* glsl */ `
attribute vec4 aAt;
attribute vec3 aLit;
attribute vec2 aLook;
varying vec3 vWorld, vNormal;
varying vec2 vUv, vLit;
varying float vAlpha;
void main() {
  vec3 n = normalize(vec3(sin(aAt.w * 3.0) * aLook.y, 1.0, cos(aAt.w * 3.0) * aLook.y));
  vWorld = lying(aAt.xyz, n, aAt.w, aLook.x * step(0.5, aLit.z), position.xy);
  vNormal = n; vLit = aLit.xy; vAlpha = aLit.z;
  vUv = atlasUv(${float(ATLAS.petal)}, position.xy);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;
export const PETAL_FRAG = LIGHTS + ATLAS_CELL + ATLAS_GLSL + PETAL_LIGHT + /* glsl */ `
uniform vec3 uPetalTint;
varying vec3 vWorld, vNormal;
varying vec2 vUv, vLit;
varying float vAlpha;
#ifdef AFLOAT
varying vec2 vQ;
varying float vShade;
#endif
void main() {
  if (uMirror > 0.5 && vWorld.y < 0.0) discard;
#ifdef AFLOAT
  // The petal takes the middle of its card. Round it the water is pressed down a little by
  // its weight and mirrors nothing, which is what makes it sit in the lake and not on it.
  vec2 q = vQ * ${float(1.45)};
  vec4 flower = abs(q.x) < 1.0 && abs(q.y) < 1.0 ? atlas(atlasUv(${float(ATLAS.petal)}, q)) : vec4(0.0);
  float dimple = 0.36 * atlas(vUv).a * vAlpha;
  flower.a *= vAlpha;
  if (flower.a + dimple < 0.02) discard;
  flower.rgb *= vShade;
#else
  vec4 flower = atlas(vUv);
  flower.a *= vAlpha;
#endif
  vec2 lit = vLit;
#ifdef LYING
  // A petal lying in the tree's shade still has the sky on it: dimmer, not black.
  lit.x = 0.3 + 0.7 * lit.x;
#else
  if (flower.a < 0.08) discard;
#endif
  vec3 colour = petalLight(flower.rgb * uPetalTint, normalize(vNormal), vWorld, lit, 0.5);
#ifdef AFLOAT
  gl_FragColor = vec4(colour * flower.a, flower.a + dimple * (1.0 - flower.a));
#elif defined(LYING)
  gl_FragColor = vec4(colour * flower.a, flower.a);
#else
  gl_FragColor = vec4(colour, flower.a);
#endif
}
`;

// --- The lake. Rings on it are a wave equation on a grid; the rest of its movement is a
// handful of long slow swells. It mirrors a second view of the world taken from below.
const FIELD = /* glsl */ `
uniform sampler2D uHeights;
uniform vec3 uField; // the ripple field's corner (x, z) and its span, in metres
float groundAt(vec2 p) {
  vec2 uv = (p - ${float(HEIGHT_MAP.min)}) / ${float(HEIGHT_MAP.span)};
  return uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 ? -1.6 : texture2D(uHeights, uv).r;
}
`;
export const RIPPLE_STEP_FRAG = FIELD + /* glsl */ `
uniform sampler2D uState;
uniform float uTexel;
varying vec2 vUv;
float heightAt(vec2 uv, float here) { return groundAt(uField.xy + uv * uField.z) > -0.01 ? here : texture2D(uState, uv).r; }
void main() {
  vec2 state = texture2D(uState, vUv).rg;
  if (groundAt(uField.xy + vUv * uField.z) > -0.01) { gl_FragColor = vec4(0.0); return; }
  // Height and its rate of change: each cell is pulled towards the mean of its neighbours.
  // The shore sends a ring back; the edge of the field swallows it.
  float around = heightAt(vUv + vec2(uTexel, 0.0), state.r) + heightAt(vUv - vec2(uTexel, 0.0), state.r) + heightAt(vUv + vec2(0.0, uTexel), state.r) + heightAt(vUv - vec2(0.0, uTexel), state.r);
  float rate = (state.g + (around - 4.0 * state.r) * 0.03) * 0.9975;
  vec2 fromEdge = min(vUv, 1.0 - vUv);
  float keep = mix(0.92, 1.0, smoothstep(0.0, 0.05, min(fromEdge.x, fromEdge.y)));
  gl_FragColor = vec4((state.r + rate) * keep, rate * keep, 0.0, 1.0);
}
`;
export const RIPPLE_STAMP_VERT = /* glsl */ `
uniform vec3 uField;
attribute vec4 aRipple;
varying vec2 vAt;
varying float vStrength;
void main() {
  vAt = position.xy * 3.0; vStrength = aRipple.w;
  vec2 uv = (aRipple.xy + vAt * aRipple.z - uField.xy) / uField.z;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}
`;
export const RIPPLE_STAMP_FRAG = /* glsl */ `
varying vec2 vAt;
varying float vStrength;
// A dimple pressed into the water, in metres.
void main() { gl_FragColor = vec4(-0.004 * vStrength * exp(-dot(vAt, vAt)), 0.0, 0.0, 0.0); }
`;
export const WATER_VERT = /* glsl */ `
varying vec3 vWorld;
void main() { vWorld = position; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }
`;
export const WATER_FRAG = NOISE + LIGHTS + MIST_LIGHT + HORIZON + WIND_GLSL + FIELD + /* glsl */ `
uniform sampler2D uReflection, uRipples;
uniform vec2 uRes;
uniform float uBend, uPixel, uTexel;
varying vec3 vWorld;
// One long swell: direction, wavenumber (rad/m), rate (rad/s) and slope. Waves too fine
// to see at this distance are not drawn as waves but blur the mirror instead.
void swell(vec2 p, float footprint, vec2 direction, float number, float rate, float slope, inout vec2 slopes, inout float rough) {
  float seen = 1.0 - smoothstep(0.5, 1.6, number * footprint);
  slopes += direction * slope * seen * cos(dot(direction, p) * number - uTime * rate);
  rough += slope * slope * 0.5 * (1.0 - seen);
}
void main() {
  vec2 p = vWorld.xz;
  vec3 view = cameraPosition - vWorld;
  float distance_ = length(view);
  view /= distance_;
  // How much water one pixel covers, measured away from the eye.
  float footprint = distance_ * distance_ * uPixel / cameraPosition.y;

  // A gust darkens the water in patches as it crosses: cat's paws.
  float gust = gustAt(p);
  if (gust > 0.001) gust *= 0.35 + 0.65 * smoothstep(0.3, 0.7, fbm(vec3(p * 0.16, 1.0)));
  float stir = 0.3 + 0.7 * uCalm / 0.16 + 9.0 * gust;
  vec2 slopes = vec2(0.0);
  float rough = 0.0;
  swell(p, footprint, vec2(0.3, 0.954), 0.9, 0.52, 0.00055 * stir, slopes, rough);
  swell(p, footprint, vec2(-0.5, 0.866), 1.43, 0.71, 0.00045 * stir, slopes, rough);
  swell(p, footprint, vec2(0.8, 0.6), 2.4, 0.93, 0.0004 * stir, slopes, rough);
  swell(p, footprint, vec2(-0.199, 0.98), 4.2, 1.31, 0.00032 * stir, slopes, rough);
  swell(p, footprint, vec2(0.6, -0.8), 7.0, 1.77, 0.00026 * stir, slopes, rough);
  swell(p, footprint, vec2(-0.898, 0.44), 11.4, 2.33, 0.0002 * stir, slopes, rough);
  rough += gust * gust * 0.00002;

  // Rings, where the field covers.
  vec2 uv = (p - uField.xy) / uField.z, fromEdge = min(uv, 1.0 - uv);
  if (min(fromEdge.x, fromEdge.y) > 0.0) {
    // The slope is measured across the water one pixel covers, so rings too fine to see
    // from here average away instead of sparkling.
    float across = max(uTexel * uField.z, distance_ * uPixel), away = max(uTexel * uField.z, footprint);
    vec2 du = vec2(across / uField.z, 0.0), dv = vec2(0.0, away / uField.z);
    vec2 ring = vec2((texture2D(uRipples, uv + du).r - texture2D(uRipples, uv - du).r) / across, (texture2D(uRipples, uv + dv).r - texture2D(uRipples, uv - dv).r) / away) * 0.5;
    slopes += ring * 1.6 * smoothstep(0.0, 0.04, min(fromEdge.x, fromEdge.y));
  }

  vec3 n = normalize(vec3(-slopes.x, 1.0, -slopes.y));
  float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(n, view), 0.0), 5.0);

  // The mirror: the view from below the surface, upside down, bent by the slope of the
  // water and drawn out into a streak where the water is rough.
  vec2 at = gl_FragCoord.xy / uRes;
  at.y = 1.0 - at.y;
  at += vec2(slopes.x * 0.3 * uRes.y / uRes.x, slopes.y) * uBend;
  float streak = sqrt(rough) * uBend;
  float blur = log2(max(1.0, streak * 0.6 * uRes.y * 0.5));
  vec3 mirrored = vec3(0.0);
  float total = 0.0;
  for (int i = -2; i <= 2; i++) {
    float o = float(i) / 2.0, w = exp(-o * o * 1.8);
    mirrored += textureLod(uReflection, at + vec2(0.0, o * streak * 1.8), blur).rgb * w;
    total += w;
  }
  mirrored /= total;

  // What is under the surface: nothing in deep water, the lake floor near the shore.
  float depth = -groundAt(p);
  vec3 under = MIST * 0.16;
  if (depth < 1.5) {
    vec3 floor_ = vec3(0.04, 0.05, 0.045) * (0.6 + 0.8 * fbm(vec3(p * 5.0, 4.0))) * (uSky + uPoleLight * 0.25);
    under = mix(under, floor_ * vec3(0.5, 0.9, 0.85), exp(-max(depth, 0.0) * 3.2));
  }
  vec3 colour = mix(under, mirrored, fresnel);
  // The star's light lies on the lake below it: a soft path, brightest towards the viewer,
  // broken wherever the water is not flat.
  colour += uPoleLight * vec3(0.8, 0.92, 1.0) * 0.05 * fresnel * pow(max(dot(reflect(-view, n), uPoleDir), 0.0), 26.0);
  colour = mix(colour, mistLit(atan(-view.x, view.z)), mistAt(view.y));
  gl_FragColor = vec4(colour, 1.0);
}
`;

// --- Finishing: the glow round bright things, then the tone of the whole picture.
export const BLOOM_DOWN_FRAG = /* glsl */ `
uniform sampler2D uSource;
uniform vec2 uStep;
uniform float uKnee;
varying vec2 vUv;
void main() {
  vec3 sum = texture2D(uSource, vUv).rgb * 4.0;
  sum += texture2D(uSource, vUv + uStep).rgb + texture2D(uSource, vUv - uStep).rgb + texture2D(uSource, vUv + vec2(uStep.x, -uStep.y)).rgb + texture2D(uSource, vUv - vec2(uStep.x, -uStep.y)).rgb;
  sum /= 8.0;
  // Only what is brighter than the knee glows; applied on the first step down alone.
  float brightest = max(sum.r, max(sum.g, sum.b));
  // One broken pixel must not spread: anything that is not a sane brightness glows not at all.
  if (!(brightest >= 0.0 && brightest < 1000.0)) sum = vec3(0.0);
  gl_FragColor = vec4(sum * (uKnee > 0.0 ? smoothstep(uKnee * 0.5, uKnee * 2.0, brightest) : 1.0), 1.0);
}
`;
export const BLOOM_UP_FRAG = /* glsl */ `
uniform sampler2D uSource;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
  vec3 sum = texture2D(uSource, vUv + vec2(-uStep.x * 2.0, 0.0)).rgb + texture2D(uSource, vUv + vec2(uStep.x * 2.0, 0.0)).rgb + texture2D(uSource, vUv + vec2(0.0, -uStep.y * 2.0)).rgb + texture2D(uSource, vUv + vec2(0.0, uStep.y * 2.0)).rgb;
  sum += 2.0 * (texture2D(uSource, vUv + uStep).rgb + texture2D(uSource, vUv - uStep).rgb + texture2D(uSource, vUv + vec2(uStep.x, -uStep.y)).rgb + texture2D(uSource, vUv - vec2(uStep.x, -uStep.y)).rgb);
  gl_FragColor = vec4(sum / 12.0, 1.0);
}
`;
// The picture is sharp from a few metres in front of the eye as far as the tree. Beyond
// the tree a thing is softer the further off it is, and so is what lies right under the lens. This works out how soft each point is from how far away it really is,
// so depth is in the whole picture and not painted on.
const FOCUS = /* glsl */ `
uniform sampler2D depth;
uniform vec2 nearFar;
uniform vec4 uRise; // the eye's height, then how far the line of sight through a point of the frame climbs by the far plane: at the corner, and per frame-width and frame-height
uniform vec2 uLens; // how fast things go soft beyond the focus, and the most blur allowed: in pixels
uniform vec3 uNear; // within how many metres of the eye things go soft, how fast, and the most blur allowed there
uniform float uFocus; // metres
// The radius of the blur at a point of the frame, in pixels.
float blurAt(vec2 uv) {
  float d = texture2D(depth, uv).r, away = nearFar.x * nearFar.y / (nearFar.y - d * (nearFar.y - nearFar.x));
  // The sky is left sharp: stars are points, and a point that is not sharp is not a star.
  if (away > nearFar.y * 0.999) return 0.0;
  // So is the lake, which is a mirror and shows things at their own distance, not at its
  // own. Only what floats on it is at the water's distance.
  if (abs(uRise.x + (uRise.y + uRise.z * uv.x + uRise.w * uv.y) * away / nearFar.y) < 0.004) return 0.0;
  return max(clamp(uLens.x * (1.0 / uFocus - 1.0 / away), 0.0, uLens.y), clamp(uNear.y * (1.0 / away - 1.0 / uNear.x), 0.0, uNear.z));
}
`;
// The soft version of the picture, at half size: each point takes in its neighbours as far
// as its own blur reaches, counting only those whose blur reaches it in return, so a sharp
// thing does not smear into a soft one beside it.
export const SOFT_FRAG = FOCUS + /* glsl */ `
uniform sampler2D beauty;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
  // Each pixel of a block of four turns its ring of samples a different way, and the
  // finish averages the four: sixty-four samples for the price of sixteen.
  float radius = blurAt(vUv), turn = (mod(gl_FragCoord.x, 2.0) + 2.0 * mod(gl_FragCoord.y, 2.0)) * 0.6;
  // A soft thing spreads over the sharp things beside it, so a point takes in at least
  // most of the blur of what is round about.
  for (int i = 0; i < 4; i++) {
    float a = float(i) * 1.5708 + 0.7854;
    radius = max(radius, blurAt(vUv + vec2(cos(a), sin(a)) * max(uLens.y, 0.6 * uNear.z) * uStep) * 0.8);
  }
  vec3 sum = texture2D(beauty, vUv).rgb;
  float total = 1.0;
  // A little blur needs few samples; most of the picture has little.
  int samples = radius < 0.5 ? 0 : radius < 3.0 ? 4 : 16;
  for (int i = 0; i < samples; i++) {
    float out_ = sqrt((float(i) + 0.5) / float(samples)) * radius, a = float(i) * 2.39996 + turn;
    vec2 at = vUv + vec2(cos(a), sin(a)) * out_ * uStep;
    float w = smoothstep(-1.0, 1.0, blurAt(at) * 1.2 - out_);
    sum += texture2D(beauty, at).rgb * w;
    total += w;
  }
  gl_FragColor = vec4(sum / total, radius);
}
`;
// Very soft things are gone over once more, a ring of samples part-way out, so that the
// first pass's few samples do not show as copies of the thing.
export const SMOOTH_FRAG = /* glsl */ `
uniform sampler2D uSoft;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
  vec4 soft = texture2D(uSoft, vUv);
  if (soft.a > 2.5) {
    vec3 sum = soft.rgb;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7854 + 0.39;
      sum += texture2D(uSoft, vUv + vec2(cos(a), sin(a)) * soft.a * (i % 2 == 0 ? 0.45 : 0.25) * uStep).rgb;
    }
    soft.rgb = sum / 9.0;
  }
  gl_FragColor = soft;
}
`;
export const FINISH_FRAG = FOCUS + /* glsl */ `
uniform sampler2D beauty, uBloom, uSoft;
uniform vec2 uStep;
uniform float uExposure, uBloomStrength;
varying vec2 vUv;
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
vec3 film(vec3 x) { return clamp(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main() {
  // A real lens does not bring every colour to quite the same place: towards the corners
  // red falls a little outside green, and blue a little inside.
  vec2 fromCentre = vUv - 0.5, fringe = fromCentre * dot(fromCentre, fromCentre) * 0.005;
  vec3 colour = vec3(texture2D(beauty, vUv + fringe).r, texture2D(beauty, vUv).g, texture2D(beauty, vUv - fringe).b);
  // The soft picture knows how far each soft thing has spread; the sharp one is kept where nothing has.
  vec4 soft = 0.25 * (texture2D(uSoft, vUv + uStep) + texture2D(uSoft, vUv - uStep) + texture2D(uSoft, vUv + vec2(uStep.x, -uStep.y)) + texture2D(uSoft, vUv - vec2(uStep.x, -uStep.y)));
  colour = mix(colour, soft.rgb, smoothstep(0.4, 1.6, soft.a));
  colour = (colour + texture2D(uBloom, vUv).rgb * uBloomStrength) * uExposure;
  vec2 q = vUv - 0.5;
  // The corners fall away into the dark, as they do through an old fast lens.
  colour *= 1.0 - 1.25 * dot(q, q) + 0.35 * dot(q, q) * dot(q, q);
  // Tone each channel, but keep most of the hue the light had before it was squeezed.
  float luma = dot(colour, vec3(0.2126, 0.7152, 0.0722));
  colour = mix(film(colour), colour * film(vec3(luma)).r / max(luma, 0.0001), 0.2);
  // The picture has two colours, the teal of the night and the rose of the blossom, and it means them.
  colour = mix(vec3(dot(colour, vec3(0.2126, 0.7152, 0.0722))), colour, 1.1);
  colour = pow(clamp(colour, 0.0, 1.0), vec3(1.0 / 2.2));
  // Grain, as film has: it keeps the dark sky from banding, and the picture from looking drawn.
  gl_FragColor = vec4(colour + (hash(gl_FragCoord.xy) + hash(gl_FragCoord.xy + 17.0) - 1.0) * (1.6 - colour.g) / 255.0, 1.0);
}
`;
