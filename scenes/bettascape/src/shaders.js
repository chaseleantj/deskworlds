import { NJ } from './rig.js';

// Every shader in the scene. The body, eyes and fins are drawn procedurally on the skeleton
// the behaviour poses (rig.js); the rest is the camera: compositing, motes, lens and sensor.

export const GLSL_COMMON = /* glsl */`
#define NJ ${NJ}
#define PI 3.14159265
#define ROWS 36.0
#define EYE_T 0.13
#define EYE_R 0.045
#define VENTRAL_T 0.205
#define VENTRAL_PH 0.40
#define PECT_C -0.44
uniform vec3 uSP[NJ];
uniform vec3 uST[NJ];
uniform vec3 uSU[NJ];
uniform float uJ0, uJD, uTime, uBreath, uWave, uSpread, uStream, uOverlap, uPleat, uExposure;
uniform vec3 uLag;
uniform float uFlap, uFlapAmp;   // pectoral beat phase and amplitude

float hash11(float p){ p = fract(p*0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y)*p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz)*p3.zy); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0 - 2.0*f);
  return mix(mix(hash21(i), hash21(i + vec2(1,0)), u.x), mix(hash21(i + vec2(0,1)), hash21(i + vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a*vnoise(p); p = p*2.03 + vec2(1.7, 9.2); a *= 0.5; } return v; }

// Body cross-section at t (0 = nose, 1 = caudal peduncle, closes at 1.06).
// The mouth is superior: the forehead rises slowly from it while the chin drops steeply.
void bodyProfile(float t, out float hu, out float hl, out float w, out float yc){
  float h = mix(0.162, 0.098, smoothstep(0.42, 1.0, t));        // laterally compressed body, deepest in front, on a thick tail stalk
  // The stalk keeps its height but flattens into a thin blade over the caudal fin base (x = -0.46),
  // so it ends lying against the fin instead of in a rounded cap.
  float close = max(pow(clamp((1.03 - t)/0.19, 0.0, 1.0), 0.8), 0.04);
  float back = (1.0 + 0.12*exp(-pow((t - 0.42)/0.22, 2.0)))*mix(1.0, 0.75, smoothstep(0.93, 1.03, t));   // eases onto the fin root
  float belly = (1.0 + 0.16*exp(-pow((t - 0.30)/0.19, 2.0)))*mix(1.0, 0.75, smoothstep(0.93, 1.03, t));
  // The snout ends in thick lips: a short rounded front, a slight neck behind them, then the head.
  float xc = clamp(t/0.014, 0.0, 1.0);
  float snout = sqrt(xc*(2.0 - xc))*(1.0 - 0.08*exp(-pow((t - 0.036)/0.011, 2.0)))*mix(0.7, 1.0, smoothstep(0.015, 0.065, t));
  // a small head with a blunt, upturned snout; the back climbs from it in a gentle hump to the dorsal origin
  float brow = mix(0.24, 1.0, 1.0 - pow(1.0 - clamp(t/0.46, 0.0, 1.0), 2.0));
  float chin = mix(0.34, 1.0, 1.0 - pow(1.0 - clamp(t/0.34, 0.0, 1.0), 1.8));
  float cheek = mix(0.42, 1.0, 1.0 - pow(1.0 - clamp(t/0.30, 0.0, 1.0), 2.0));
  hu = h*0.92*back*brow*snout;
  hl = h*belly*chin*snout;
  w = h*mix(0.54, 0.40, smoothstep(0.15, 1.0, t))*cheek*snout*close;
  yc = -0.030*(1.0 - smoothstep(0.0, 0.55, t)) - 0.006;
}

void spineFrame(float x, out vec3 P, out vec3 T, out vec3 U){
  float s = (uJ0 - x)/uJD;
  float sc = clamp(s, 0.0, float(NJ - 1) - 0.0001);
  int i = int(sc); float f = sc - float(i);
  int i0 = max(i - 1, 0), i2 = min(i + 1, NJ - 1), i3 = min(i + 2, NJ - 1);
  vec3 p0 = uSP[i0], p1 = uSP[i], p2 = uSP[i2], p3 = uSP[i3];
  float f2 = f*f, f3 = f2*f;
  P = 0.5*((2.0*p1) + (-p0 + p2)*f + (2.0*p0 - 5.0*p1 + 4.0*p2 - p3)*f2 + (-p0 + 3.0*p1 - 3.0*p2 + p3)*f3);
  T = normalize(mix(uST[i], uST[i2], f));
  U = mix(uSU[i], uSU[i2], f);
  U = normalize(U - T*dot(U, T));
  P -= T*((s - sc)*uJD);
}
vec3 skin(vec3 lp){
  vec3 P, T, U; spineFrame(lp.x, P, T, U);
  return P + U*lp.y + cross(T, U)*lp.z;
}

// Distance from the body outline in the local x-y plane; drives how freely fin membrane moves.
float finReach(vec2 xy){
  if (xy.x < -0.43) return length(vec2(xy.x + 0.43, max(abs(xy.y) - 0.045, 0.0)));
  float hu, hl, w, yc; bodyProfile(0.5 - xy.x, hu, hl, w, yc);
  return max(xy.y > yc ? xy.y - (yc + hu) : (yc - hl) - xy.y, 0.0);
}
// Shared water motion for the median fins, a function of position so overlapping fins move together.
uniform vec3 uLagW[4];        // fin lag sampled at growing delays, root to tip, so a jolt travels out along the fin
uniform float uSwayT, uFlutter;   // sway clock that drifts in rate; strength of the rim flutter
vec3 membraneSway(vec3 q){
  float r = finReach(q.xy);
  float wgt = smoothstep(0.0, 0.75, r);
  float t = uSwayT;
  // wavelengths longer than the fin, so it bows and ripples rather than corkscrewing
  float z = 0.12*sin(1.9*t - 2.8*r + 0.5*q.y)
          + 0.05*r*sin(3.7*t - 8.0*r + 1.5*q.y + 0.7)
          + 0.06*sin(1.1*t - 2.0*r - 0.9*q.y + 1.3)
          + 0.018*sin(1.73*t - 8.0*r + 3.0*q.x + 0.4);
  q.z += uWave*z*wgt;
  // Rim flutter: a fast, small ripple running out to the thin margin of the shared disc, absent at
  // the root. Its phase and strength drift with position around the rim, so lobes move out of step.
  vec2 d = q.xy - vec2(-0.46, -0.13);
  float rho = length(d); vec2 dir = d/max(rho, 1e-3);
  float rimR = mix(0.88, dir.y > 0.0 ? 0.70 : 0.82, dir.y*dir.y);
  float rim = smoothstep(0.5, 1.0, rho/rimR)*wgt;
  float T = uTime;
  float lobe = vnoise(dir*2.2 + vec2(0.31*T, -0.23*T));
  float ph = 7.0*T - 24.0*rho + 6.0*vnoise(dir*1.6 + vec2(4.0, 0.21*T));
  float fine = vnoise(dir*11.0 + vec2(1.3*T, -0.9*T)) - 0.5;
  float flutter = uFlutter*rim*rim*(0.03*(0.2 + 1.2*lobe)*sin(ph) + 0.016*fine);
  q.z += flutter;
  q.xy -= dir*0.35*abs(flutter);   // a crinkled margin draws in a little
  // lag: the tips answer a turn or a stop later than the roots
  float u = 3.0*clamp(r/0.8, 0.0, 1.0);
  vec3 lag = mix(uLagW[0], uLagW[1], clamp(u, 0.0, 1.0));
  lag = mix(lag, uLagW[2], clamp(u - 1.0, 0.0, 1.0));
  lag = mix(lag, uLagW[3], clamp(u - 2.0, 0.0, 1.0));
  q += lag*wgt*wgt;
  return q;
}

// Lighting: a soft studio key from upper front, a cool fill, and a strong rim light behind the fish.
#define KEY_DIR normalize(vec3(-0.35, 0.80, 0.85))
#define FILL_DIR normalize(vec3(0.90, -0.25, 0.55))
#define RIM_DIR normalize(vec3(0.30, 0.55, -0.95))
#define KEY_COL (vec3(1.00, 0.96, 0.90)*2.5)
#define FILL_COL (vec3(0.55, 0.66, 0.92)*0.35)
#define RIM_COL (vec3(0.85, 0.92, 1.00)*2.3)
#define AMBIENT vec3(0.02, 0.025, 0.04)

float D_GGX(float NoH, float a){ float a2 = a*a; float d = NoH*NoH*(a2 - 1.0) + 1.0; return a2/(PI*d*d); }
float V_Smith(float NoV, float NoL, float a){ float k = a*0.5; return 0.25/((NoV*(1.0 - k) + k)*(NoL*(1.0 - k) + k)); }
vec3 F_Schlick(vec3 f0, float c){ return f0 + (1.0 - f0)*pow(1.0 - c, 5.0); }
vec3 specLobe(vec3 N, vec3 V, vec3 L, vec3 f0, float rough){
  vec3 H = normalize(V + L);
  float NoL = max(dot(N, L), 0.0), NoV = max(dot(N, V), 1e-3), NoH = max(dot(N, H), 0.0);
  float a = rough*rough;
  return D_GGX(NoH, a)*V_Smith(NoV, NoL, a)*F_Schlick(f0, max(dot(V, H), 0.0))*NoL;
}
vec3 envLight(vec3 R, float rough){
  float spread = 0.35 + rough;
  float key = smoothstep(1.0 - spread, 1.0 - spread*0.15, dot(R, KEY_DIR));
  float rim = smoothstep(1.0 - spread*0.8, 1.0 - spread*0.1, dot(R, RIM_DIR));
  float top = smoothstep(-0.1, 1.0, R.y);
  float front = smoothstep(-0.2, 1.0, dot(R, normalize(vec3(0.1, 0.3, 1.0))));
  return vec3(1.0, 0.97, 0.92)*key*1.8 + vec3(0.8, 0.9, 1.0)*rim*1.2 + vec3(0.22, 0.26, 0.32)*top + vec3(0.30, 0.30, 0.32)*front;
}
vec3 aces(vec3 x){ return clamp((x*(2.51*x + 0.03))/(x*(2.43*x + 0.59) + 0.14), 0.0, 1.0); }
// Hue-preserving tone map: compress the brightest channel and scale the others with it,
// so saturated reds and blues stay saturated instead of washing out to pink.
vec3 display(vec3 c){
  c *= uExposure;
  float m = max(max(c.r, c.g), c.b);
  vec3 hp = c*(aces(vec3(m)).r/max(m, 1e-5));
  return pow(mix(aces(c), hp, 0.75), vec3(1.0/2.2));
}
`;

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------
// Head landmarks shared by the body and eye shaders.
export const HEAD_GLSL = /* glsl */`
// Free rear margin of the gill cover, as body t, around the body (c = -1 belly .. 1 back).
float opEdge(float c){ return 0.205 + 0.07*(1.0 - c*c) - 0.06*smoothstep(-0.2, -0.95, c); }
// Line where the lips of the upturned mouth part, as c along the snout.
float gapeC(float t){ return 0.38 - 11.0*t; }
// Centre of the eyeball on side +-1. It sits deep in the orbit so only a shallow dome shows.
// Pectoral fin base (as body t at height c): a short, near-vertical line just behind the gill cover,
// a third of the way up the flank, whose upper end tucks under the cover's margin.
float pectT(float c){ return mix(opEdge(PECT_C), opEdge(c), 0.5) + 0.010; }
// The fleshy muscular pad the pectoral rays grow from.
float pectPad(float t, float c){
  float e = t - pectT(c) - 0.006;
  float et = e/(e < 0.0 ? 0.010 : 0.032);
  return exp(-et*et - pow((c - PECT_C)/0.17, 2.0));
}
// How far a pectoral ray stands out from the flank, in radians. The beat alternates between sides;
// the upper, leading ray leads and the tips lag.
float pectArg(float side, float s, float a){ return uFlap + side*1.55 - s*1.5 - (1.0 - a)*0.8; }
float pectAbd(float side, float s, float a){ return 0.66 + uFlapAmp*0.34*sin(pectArg(side, s, a)); }
vec3 eyeCentre(float side){
  float hu, hl, w, yc; bodyProfile(EYE_T, hu, hl, w, yc);
  return vec3(0.5 - EYE_T, yc + hu*0.36, side*(0.94*w - EYE_R*0.63));
}
`;

export const BODY_VERT = GLSL_COMMON + HEAD_GLSL + /* glsl */`
attribute vec2 aP;
varying vec3 vW, vN, vTan, vL;
varying vec2 vTP;
varying float vU;

uniform float uOper, uMouth;   // gill cover opening and mouth opening, 0..1
vec3 bodyLocal(float t, float ph){
  float hu, hl, w, yc; bodyProfile(t, hu, hl, w, yc);
  float c = -cos(ph), s = sin(ph);
  // lips parted by a crease along the gape; the lower lip juts ahead of the upper, so the mouth faces up
  float tip = 1.0 - smoothstep(0.03, 0.05, t);
  float g = gapeC(t);
  float gape = exp(-pow((c - g)/mix(0.12, 0.07, smoothstep(0.0, 0.02, t)), 2.0))*tip;   // widest at the tip, where the mouth opens
  float lip = exp(-pow((t - 0.013)/0.010, 2.0))*(exp(-pow((c - g - 0.2)/0.13, 2.0)) + exp(-pow((c - g + 0.22)/0.15, 2.0)));   // upper and lower lip rolls
  float jaw = smoothstep(g + 0.05, g - 0.3, c)*tip;
  // the gill cover is a plate standing proud of the body just ahead of its free margin
  float edge = t - opEdge(c);
  float plate = smoothstep(-0.07, -0.01, edge)*(1.0 - smoothstep(-0.006, 0.004, edge))*smoothstep(0.75, 0.3, c);
  float gill = smoothstep(0.11, 0.17, t)*(1.0 - smoothstep(0.21, 0.27, t))*smoothstep(0.5, -0.4, c);
  // the pelvic fins grow from a pair of fleshy lobes on the throat, rounder in front, trailing into the belly
  float vph = min(abs(ph - VENTRAL_PH), abs(ph - (2.0*PI - VENTRAL_PH)));
  float vt = (t - VENTRAL_T)/(t < VENTRAL_T ? 0.016 : 0.034);
  float lobe = exp(-vt*vt - pow(vph/0.19, 2.0));
  float pad = pectPad(t, c);
  float r = 1.0 + 0.06*lip - 0.16*gape + 0.025*plate + uBreath*0.07*gill + 0.14*lobe + 0.13*pad;
  r += uOper*plate*(0.02 + 0.06*smoothstep(-0.1, -0.8, c)) - uMouth*0.12*gape;   // gill cover lifts, lower edge flares; lips part
  vec3 L = vec3(0.5 - t + 0.006*jaw - 0.008*gape*(1.0 - smoothstep(0.0, 0.015, t)), yc + c*(c > 0.0 ? hu : hl)*r, s*w*r);
  L.y -= uMouth*0.02*jaw*(1.0 - smoothstep(0.0, 0.04, t));   // the lower jaw drops
  // a fold of skin around the orbit overlaps the edge of the eyeball
  float side = s < 0.0 ? -1.0 : 1.0;
  float q = length(L - eyeCentre(side))/EYE_R;
  L.z += side*0.0065*smoothstep(0.84, 1.03, q)*(1.0 - smoothstep(1.03, 1.6, q));
  return L;
}
float circumference(float t){
  float hu, hl, w, yc; bodyProfile(t, hu, hl, w, yc);
  float a = (hu + hl)*0.5, b = w;
  return PI*(3.0*(a + b) - sqrt((3.0*a + b)*(a + 3.0*b)));
}
// Scale column coordinate: integrates so columns stay 1.25 row spacings apart all along the body,
// which with the staggered rows leaves each scale's exposed field about as long as it is tall.
float scaleColumn(float t){
  const int N = 16; float t0 = 0.15, dt = (t - t0)/float(N), sum = 0.0;
  for (int i = 0; i < N; i++) sum += 1.0/max(circumference(t0 + (float(i) + 0.5)*dt), 0.06);
  return sum*dt*ROWS/1.25;
}
void main(){
  float t = aP.x*1.06 - 0.9*aP.x*exp(-aP.x/0.05), ph = aP.y*2.0*PI;   // vertices packed toward the lips
  float te = clamp(t, 0.002, 1.054);
  vec3 L = bodyLocal(t, ph);
  vec3 W = skin(L);
  vec3 dT = skin(bodyLocal(te + 0.003, ph)) - skin(bodyLocal(te - 0.003, ph));
  vec3 dP = skin(bodyLocal(te, ph + 0.01)) - skin(bodyLocal(te, ph - 0.01));
  vN = normalize(cross(dP, dT));
  vTan = normalize(dT);
  vW = W; vL = L; vTP = vec2(t, ph);
  vU = scaleColumn(t);
  gl_Position = projectionMatrix*viewMatrix*vec4(W, 1.0);
}`;

export const BODY_FRAG = GLSL_COMMON + HEAD_GLSL + /* glsl */`
uniform float uMouth;   // 0 closed .. ~1 on a gulp
varying vec3 vW, vN, vTan, vL;
varying vec2 vTP;
varying float vU;

#define SCALE_AXES vec2(0.80, 0.70)
#define SROWS 56.0            // scale rows around the body; even, so the staggered lattice closes
// A scale's centre and size in its lattice cell. A few are lost, regrown small or knocked out of line.
void scaleShape(vec2 cell, out vec2 c, out float size){
  vec2 id = vec2(cell.x, mod(cell.y, SROWS));
  float odd = hash21(id + 7.3);
  c = vec2(cell.x + 0.5*mod(cell.y, 2.0), cell.y + 0.5) + (hash22(id) - 0.5)*vec2(0.34, 0.26);
  size = 0.88 + 0.26*hash21(id + 2.9);
  if (odd > 0.992) size = 0.0;
  else if (odd > 0.978) size = 0.7;
  else if (odd > 0.955) c += (hash22(id + 5.1) - 0.5)*0.5;
}
// Overlapping (imbricate) scales: the most anterior scale covering a point lies on top.
// Returns (normalised radius, offset from its centre, per-scale random); shade is the soft
// shadow cast by the lifted rear margins of the scales in front of it.
// One pass over the 3x3 neighbourhood: each cell's centre, radius and shadow are kept, so the shadow
// pass that needs the winner's position reuses them instead of rebuilding every scale.
vec4 scaleCell(vec2 p, out vec2 cellId, out float size, out float shade){
  vec3 best = vec3(1.0, 0.0, 0.0); float bestX = 1e9;
  vec2 ip = floor(p);
  cellId = ip; size = 1.0;
  float cx[9], sh[9];
  for (int k = 0; k < 9; k++){
    vec2 cell = ip + vec2(float(k - (k/3)*3 - 1), float(k/3 - 1)), c; float sz; scaleShape(cell, c, sz);
    vec2 d = p - c;
    float r = length(d/(SCALE_AXES*max(sz, 1e-3)));
    cx[k] = c.x; sh[k] = (1.0 - smoothstep(1.0, 1.35, r))*smoothstep(-0.3, 0.3, d.x);
    if (r < 1.0 && c.x < bestX){ bestX = c.x; best = vec3(r, d); cellId = cell; size = sz; }
  }
  shade = 0.0;
  for (int k = 0; k < 9; k++) if (cx[k] < bestX - 0.05) shade = max(shade, sh[k]);
  return vec4(best, bestX > 1e8 ? 0.0 : hash21(vec2(cellId.x, mod(cellId.y, SROWS)) + 17.0));
}
// Iridophore platelets: tiny mirrors much smaller than a scale, each at its own tilt.
// Returns coverage. Once a platelet is smaller than a pixel it keeps its tilt but spreads its
// area over the cell, so distant scales still twinkle cell by cell instead of going flat.
float platelets(vec2 p, float aa, out vec2 tilt, out float resolved){   // aa = length(fwidth(p)), taken outside any branch
  vec2 i = floor(p), f = fract(p) - 0.5;
  float sz = 0.2 + 0.18*hash21(i + 4.0);
  float present = step(0.3, hash21(i + 1.7));
  resolved = 1.0 - smoothstep(0.35, 0.9, aa);
  tilt = hash22(i + 9.0) - 0.5;
  float disc = 1.0 - smoothstep(sz - 0.5*aa, sz + 0.5*aa, length(f - (hash22(i) - 0.5)*0.5));
  return present*mix(PI*sz*sz, disc, resolved);
}
vec3 hash33(vec3 p){ p = fract(p*vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx)*p.zyx); }
// Sparse melanophores: dark dots scattered through the skin, one per cell with probability density.
// Solid (3D) so they stay round wherever the surface runs.
float melanophores(vec3 p, float density){
  vec3 i = floor(p), f = fract(p) - 0.5;
  vec3 h = hash33(i), g = hash33(i + 7.7);
  float r = length(f - (h - 0.5)*0.5);
  float sz = 0.12 + 0.2*g.x;
  float aa = length(fwidth(p));
  return step(g.y, density)*(1.0 - smoothstep(sz*0.3, sz + aa, r))*(1.0 - smoothstep(0.4, 1.0, aa));
}
// Height of the gill cover above the body behind it: a gently domed plate with a thickened,
// rounded free margin that drops onto the body at opEdge, and the shallow preopercular groove ahead of it.
float opercle(float t, float c){
  float e = t - opEdge(c);
  float rim = 0.0018*(0.5 + vnoise(vec2(c*5.0, 1.3)))*smoothstep(0.75, 0.3, c);
  float groove = 0.0012*exp(-pow((e + 0.05 + 0.02*c)/0.004, 2.0))*smoothstep(0.5, 0.1, c)*smoothstep(-0.8, -0.4, c);
  return rim*(smoothstep(-0.08, -0.012, e) + 0.5*exp(-pow((e + 0.006)/0.005, 2.0)))*(1.0 - smoothstep(-0.004, 0.003, e)) - groove;
}
// Under water the mucus and the water have nearly the same refractive index, so there is little
// Fresnel brightening at grazing angles: reflections keep their colour instead of going white.
vec3 waterLobe(vec3 N, vec3 V, vec3 L, vec3 f0, float rough){
  vec3 H = normalize(V + L);
  float NoL = max(dot(N, L), 0.0), NoV = max(dot(N, V), 1e-3), NoH = max(dot(N, H), 0.0);
  float a = rough*rough;
  return f0*D_GGX(NoH, a)*min(V_Smith(NoV, NoL, a), 1.0)*NoL;
}
vec3 waterFresnel(vec3 f0, float NoV){ return f0*(1.0 + 0.5*pow(1.0 - NoV, 4.0)); }
// Scale relief, in lattice units. A scale's exposed surface rises from its buried front to a lifted
// rear margin whose rounded shoulder then steps down onto the scale behind; lift and tilt vary per scale.
#define SCALE_HMAX 0.12
// lift.x scales the scale's height, lift.y how sharply its margin rolls off, lift.z where along the
// margin that roll-off is strongest, so rims catch the light in broken arcs rather than full outlines.
void scaleLift(vec2 cell, float size, out vec3 lift, out vec2 tilt){
  vec2 id = vec2(cell.x, mod(cell.y, SROWS));
  float row = hash11(id.y + 13.0);
  lift.x = (0.55 + 0.7*hash21(id + 41.0))*(hash21(id + 33.0) > 0.965 ? 1.8 : 1.0)*(size < 0.8 ? 0.6 : 1.0)   // a few stand proud, regrown ones lie flat
         *(row < 0.3 ? 0.45 : 1.0);                                                                          // and some rows lie flatter
  float sharp = hash21(id + 47.0);
  lift.y = 0.15 + 0.55*sharp*sharp;
  lift.z = hash21(id + 53.0)*6.28;
  tilt = (hash22(id + 3.1) - 0.5)*0.035;
}
float scaleProfile(vec2 dn, vec3 lift, vec2 tilt){
  float r2 = dot(dn, dn);
  float shoulder = 1.0 - lift.y*(0.55 + 0.45*sin(dn.y*4.0 + lift.z))*smoothstep(0.68, 1.0, r2);
  return lift.x*(0.075*smoothstep(-1.1, 0.85, dn.x) + 0.02*(1.0 - r2) + dot(tilt, dn))*shoulder;
}
// Height of the scale layer at p: the profile of whichever scale lies on top there.
float scaleHeight(vec2 p){
  // find the top scale first, then build only its relief (scaleLift is as costly as the search)
  vec2 ip = floor(p), bestCell = ip, bestDn = vec2(0.0); float bestX = 1e9, bestSz = 1.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
    vec2 cell = ip + vec2(float(i), float(j)), c; float sz; scaleShape(cell, c, sz);
    vec2 dn = (p - c)/(SCALE_AXES*max(sz, 1e-3));
    if (dot(dn, dn) < 1.0 && c.x < bestX){ bestX = c.x; bestCell = cell; bestSz = sz; bestDn = dn; }
  }
  if (bestX > 1e8) return 0.0;
  vec3 l; vec2 tl; scaleLift(bestCell, bestSz, l, tl);
  return scaleProfile(bestDn, l, tl);
}

// Smooth fbm for the broad skin colour fields: quintic value noise with each octave rotated, so pale,
// low-contrast regions don't show the square lattice of plain value noise as flat-edged blocks.
float vnoiseQ(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f*f*f*(f*(f*6.0 - 15.0) + 10.0);
  return mix(mix(hash21(i), hash21(i + vec2(1,0)), u.x), mix(hash21(i + vec2(0,1)), hash21(i + vec2(1,1)), u.x), u.y);
}
float skinFbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++){ v += a*vnoiseQ(p); p = mat2(1.6, -1.2, 1.2, 1.6)*p + vec2(1.7, 9.2); a *= 0.5; }
  return v/0.97;
}
// Faint healed scratches: a few short straight strokes, at most one per cell.
float scratches(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 h = hash22(i + 21.0);
  if (h.x > 0.06) return 0.0;
  float a = hash21(i + 4.4)*PI;
  vec2 d = vec2(cos(a), sin(a));
  vec2 q = f - 0.5 - (hash22(i + 8.8) - 0.5)*0.3;
  float along = dot(q, d), across = abs(dot(q, vec2(-d.y, d.x)));
  float len = 0.18 + 0.14*h.y, aa = length(fwidth(p));
  return (1.0 - smoothstep(0.004, 0.01 + aa, across))*(1.0 - smoothstep(len*0.5, len, abs(along)))*(1.0 - smoothstep(0.1, 0.4, aa));
}
// Light one glitter platelet: a near-mirror that flashes only when it reflects the key or rim softbox.
vec3 glint(vec3 gN, vec3 V, float resolved){
  float rough = mix(0.35, 0.10, resolved);
  vec3 R = reflect(-V, gN);
  float box = smoothstep(0.86, 0.95, dot(R, KEY_DIR))*1.8 + smoothstep(0.88, 0.96, dot(R, RIM_DIR))*1.2;
  return (KEY_COL*waterLobe(gN, V, KEY_DIR, vec3(1.0), rough) + RIM_COL*waterLobe(gN, V, RIM_DIR, vec3(1.0), rough))*0.3 + vec3(box);
}

void main(){
  float t = vTP.x, ph = vTP.y;
  // The stalk ends over the caudal fin base in ragged tongues running out along the fin rays,
  // which fan from about x = -0.414 on the axis; beyond them the fin itself shows.
  float finA = atan(vL.y, -0.414 - vL.x)/1.42;          // approximate caudal ray coordinate, -1..1
  float rayQ = (finA + 1.0)*23.0;
  float rayLine = 1.0 - smoothstep(0.1, 0.4, abs(fract(rayQ) - 0.5));
  // the end of the stalk is a shallow, rounded scallop over every other pair of rays, not a comb of spikes
  float lobeQ = rayQ*0.5;
  float tEnd = 0.998 + 0.012*(0.5 - 0.5*cos(2.0*PI*fract(lobeQ)))*(0.4 + 0.6*hash11(floor(lobeQ) + 3.0));
  if (t > tEnd) discard;
  float c = -cos(ph), sd = sin(ph), side = sd < 0.0 ? -1.0 : 1.0;
  vec3 N = normalize(vN);
  vec3 Tg = normalize(vTan - N*dot(vTan, N));   // toward the tail
  vec3 Pg = cross(Tg, N);                       // around the body, increasing ph
  vec3 V = normalize(cameraPosition - vW);
  float hu, hl, w, yc; bodyProfile(t, hu, hl, w, yc);
  float arcPh = max(length(vec2(sd*(c > 0.0 ? hu : hl), cos(ph)*w)), 1e-3);   // surface length per radian of ph
  float n1 = fbm(vec2(t*5.0, ph*1.6));
  vec2 sk = vec2(vL.x, vL.y + 0.6*vL.z);        // skin texture coordinates, different on each side
  vec2 ks = sk + vec2(3.7, 1.9);                // colour patterns; sk carries z, so the two flanks differ without a seam

  // Regions: head skin, gill cover plate, scaled body, the peduncle blade running into the fin
  float eo = t - opEdge(c);                     // negative on the gill cover
  float nape = smoothstep(0.3, 0.8, c);          // over the nape the gill cover has no free edge: skin grades into scales
  float head = 1.0 - smoothstep(-0.004 - 0.05*nape, 0.004 + 0.02*nape, eo);
  float tail = smoothstep(0.93, 0.995, t);             // scales give way to the fin root
  float scaleMask = smoothstep(0.0, 0.03 + 0.06*smoothstep(0.4, 0.9, c), eo)*(1.0 - smoothstep(0.975, 1.03, t));   // scales fade in over the nape and run a little way onto the caudal rays
  float cover = head*smoothstep(0.13, 0.19, t)*smoothstep(0.6, 0.1, c);
  // the pectoral pad is bare, fleshy skin that the scales thin out onto
  float padM = smoothstep(0.18, 0.6, pectPad(t, c) + 0.12*(n1 - 0.5));
  scaleMask *= 1.0 - padM;
  // the pectoral fin standing off the flank shades the body behind and under it
  float pAbd = pectAbd(side, 0.6, 0.5);
  float pectFoot = smoothstep(-0.01, 0.01, t - pectT(c))*(1.0 - smoothstep(0.13, 0.22, t - pectT(c)))*exp(-pow((c - PECT_C + 0.05)/0.4, 2.0));   // roughly under the fin
  float pe = t - pectT(c);
  float pectOcc = smoothstep(-0.004, 0.014, pe)*exp(-max(pe, 0.0)/(0.05 + 0.06*sin(pAbd)))
                * exp(-pow((c - PECT_C + 0.06)/0.26, 2.0))*(1.0 - 0.5*sin(pAbd));

  // Gill cover relief as a height field, and the soft shadow its margin casts on the body
  // (the relief is zero, to below float precision, outside a band around the margin, so it is skipped there)
  const float E = 0.0012;
  float ht = 0.0, hp = 0.0;
  if (eo > -0.125 && eo < 0.008){
    ht = (opercle(t + E, c) - opercle(t - E, c))/(2.0*E);
    hp = (opercle(t, c + E) - opercle(t, c - E))/(2.0*E)*sd/arcPh;
  }
  vec3 Nh = normalize(N - Tg*ht - Pg*hp);
  // fine soft relief in the head skin, so its highlights break up instead of sliding like a clear coat
  vec2 bg = vec2(0.0);
  if (head > 0.0){
    vec2 bq = sk*230.0;
    float b0 = vnoise(bq);
    bg = vec2(vnoise(bq + vec2(0.3, 0.0)), vnoise(bq + vec2(0.0, 0.3))) - b0;
  }
  Nh = normalize(Nh + (-Tg*bg.x + Pg*side*bg.y)*0.18*head);
  float opShadow = smoothstep(-0.002, 0.004, eo)*exp(-max(eo, 0.0)/0.014)*smoothstep(0.9, 0.4, c);
  float slit = smoothstep(-0.002, 0.003, eo)*(1.0 - smoothstep(0.003, 0.014, eo + 0.006*(n1 - 0.5)))*smoothstep(0.0, -0.4, c)*smoothstep(-0.95, -0.7, c);   // gill opening

  // Scales: rows pack tighter toward the back and the belly, columns toward the head
  float colX = (vU + 5.0*(1.0 - exp(-vU/5.0)))*(SROWS/ROWS)*0.8;
  vec2 sp = vec2(colX, (ph + 0.14*sin(2.0*ph))/(2.0*PI)*SROWS);
  // the lattice wanders; the noise is periodic around the body so it closes without a seam on the belly
  sp += (vec2(vnoise(vec2(sp.x*0.23 + 2.0*sd, 2.0*c)), vnoise(vec2(sp.x*0.23 + 5.3, 2.0*c + 2.0*sd))) - 0.5)*0.9
      + (vec2(vnoise(vec2(sp.x*0.6 + 7.1 + 5.0*sd, 5.0*c)), vnoise(vec2(sp.x*0.6 + 3.3 + 5.0*c, 5.0*sd + 1.7))) - 0.5)*0.4;
  // Fin roots: in a band a few scales wide along the dorsal and anal bases, over the peduncle and round
  // the pectoral and pelvic bases, the scales turn smaller, less regular and flatter. The fine lattice
  // takes over along a ragged edge, so the change reads as a transition rather than a seam.
  float vphB = min(abs(ph - VENTRAL_PH), abs(ph - (2.0*PI - VENTRAL_PH)));
  float dorsB = smoothstep(0.62, 0.9, c)*smoothstep(0.42, 0.5, t);
  float analB = smoothstep(-0.62, -0.9, c)*smoothstep(0.28, 0.36, t);
  float pedB = smoothstep(0.8, 0.95, t);
  float pelvB = exp(-pow((t - VENTRAL_T - 0.02)/0.05, 2.0) - pow(vphB/0.45, 2.0));
  float pectB = smoothstep(0.03, 0.3, pectPad(t, c));
  float finBand = max(max(dorsB, analB), max(pedB, max(pelvB, pectB)));
  float fineSel = step(0.5, finBand + 0.45*(vnoiseQ(ks*45.0) - 0.5));
  float fw = length(fwidth(sp))*mix(1.0, 1.95, fineSel);
  sp = mix(sp, sp*vec2(1.9, 2.0) + vec2(17.3, 0.0), fineSel);   // twice the rows, so the lattice still closes round the body
  // scales grow faint over the back and belly, and just behind the head
  float fade = (1.0 - smoothstep(0.76, 0.97, abs(c)))*smoothstep(0.0, 0.06, eo);
  // relief fades only with the pixel footprint, where it would alias
  float detail = (1.0 - smoothstep(0.2, 0.55, fw))*scaleMask*mix(0.35, 1.0, fade)*(1.0 - 0.5*finBand);
  // Parallax occlusion: the mesh is the top of the scale layer; step the view ray down through it,
  // so toward grazing angles the scales stack in depth and hide each other's fronts
  vec3 Vt = vec3(dot(V, Tg), dot(V, Pg), dot(V, N));
  vec2 pv = sp;
  bool march = detail > 0.05 && fw < 0.4;             // LOD: the marches only pay off where scales span several pixels
  if (march){
    vec2 dir = -Vt.xy/max(Vt.z, 0.25)*detail;
    float d0 = 0.0, gap0 = SCALE_HMAX - scaleHeight(sp);
    for (int k = 1; k <= 4; k++){
      float d = SCALE_HMAX*float(k)/4.0;
      float gap = SCALE_HMAX - scaleHeight(sp + dir*d) - d;
      if (gap <= 0.0){ pv = sp + dir*mix(d0, d, gap0/max(gap0 - gap, 1e-4)); break; }
      d0 = d; gap0 = gap;
    }
  }
  vec2 cid; float ssz, shade;
  vec4 sc = scaleCell(pv, cid, ssz, shade);
  float sv = sc.w;
  vec2 dn = sc.yz/(SCALE_AXES*ssz);                     // position within the scale, unit disc
  float rear = smoothstep(-0.3, 0.5, dn.x);
  float rim = smoothstep(0.8, 0.92, sc.x)*(1.0 - smoothstep(0.92, 1.0, sc.x))*rear
            *step(0.55, hash21(cid + 71.0))*smoothstep(0.35, 0.7, vnoise(dn*4.0 + cid*2.3));   // a lifted, light-catching free margin, only here and there
  float regrown = step(0.5, ssz)*step(ssz, 0.8);
  // normal from the analytic height gradient of the top scale, in the surface's tangent frame
  vec3 lift; vec2 tl; scaleLift(cid, ssz, lift, tl);
  float h0 = scaleProfile(dn, lift, tl);
  vec2 gradH = vec2(scaleProfile(dn + vec2(0.02, 0.0), lift, tl) - h0, scaleProfile(dn + vec2(0.0, 0.02), lift, tl) - h0)/(0.02*SCALE_AXES*ssz);
  vec3 Np = normalize(Nh - (Tg*gradH.x + Pg*gradH.y)*detail);
  // Self-shadowing: march the height field toward the key light, so each scale's step edge casts a soft
  // shadow onto the scale behind it that moves with the light and the body
  vec3 Lt = vec3(dot(KEY_DIR, Tg), dot(KEY_DIR, Pg), dot(KEY_DIR, N));
  float keyShadow = 1.0;
  float lh = length(Lt.xy);
  if (march && Lt.z > 0.0 && lh > 1e-3){
    vec2 ld = Lt.xy/lh;
    float rise = Lt.z/lh;                              // ray height gained per lattice unit travelled
    for (int k = 1; k <= 4; k++){
      float dist = 0.15*float(k);
      float occ = scaleHeight(pv + ld*dist) - (h0 + dist*rise);
      keyShadow = min(keyShadow, clamp(1.0 - occ/(0.008 + 0.06*dist), 0.0, 1.0));
    }
    keyShadow = mix(1.0, keyShadow, detail);
  }
  float occl = 1.0 - 0.12*shade*detail;                // a little ambient occlusion where scales tuck under

  // Melanophores along the free margins make a reticulated net; its strength drifts over the flank
  // and whole rows nearly vanish
  float rowK = smoothstep(0.1, 0.55, hash11(mod(cid.y, SROWS) + 3.0));
  float netK = smoothstep(0.2, 0.8, vnoise(vec2(sp.x*0.18 + 3.0*sd, 3.0*c)))*mix(0.12, 1.0, rowK)*(0.6 + 0.4*hash21(cid + 51.0));
  float edgeBand = smoothstep(0.8, 0.98, sc.x)*mix(0.3, 1.0, rear)*(0.5 + 0.5*vnoise(dn*3.0 + cid*1.7));
  float net = mix(max(edgeBand, 0.6*shade), 0.25, smoothstep(0.25, 0.6, fw))*netK*scaleMask*fade;

  // Colour, linear light
  vec3 red = vec3(0.60, 0.06, 0.038);
  vec3 deepRed = vec3(0.30, 0.018, 0.016);
  vec3 blueBase = vec3(0.008, 0.030, 0.10);

  // The red of the head carries back onto the body scale by scale, further along the back.
  float redP = 1.0 - smoothstep(0.0, 0.08 + 0.10*smoothstep(-0.3, 0.8, c), eo + 0.06*(n1 - 0.5));
  float redScale = clamp((redP - sv)*3.0 + 0.5*redP, 0.0, 1.0);
  float peduncle = smoothstep(0.78, 0.9, t)*(1.0 - smoothstep(0.9, 0.95, t))*(0.03 + 0.08*n1);
  // the fin-root band is cooler and deeper over the dorsal base and peduncle, warmer toward the anal and pelvic bases
  float coolB = max(dorsB, pedB)*(1.0 - head), warmB = max(analB, pelvB)*(1.0 - head);
  float warm = clamp(max(redScale, 0.6*redP) + peduncle + 0.25*warmB*n1, 0.0, 1.0);
  // a few odd scales: one flushed red, one pale and silvery
  float oddS = hash21(vec2(cid.x, mod(cid.y, SROWS)) + 91.0);
  float oddRed = step(0.994, oddS)*scaleMask, oddPale = step(0.984, oddS)*(1.0 - oddRed)*scaleMask;
  // dark pigment: the net, broad smoky patches, and the odd wholly dark scale
  float melPatch = scaleMask > 0.0 ? smoothstep(0.58, 0.8, fbm(ks*6.0 + 5.0)) : 0.0;
  float melanin = clamp(net*0.7 + melPatch*0.3*scaleMask + step(0.993, hash21(cid + 57.0))*0.4*scaleMask, 0.0, 1.0);

  // Iridophores: soft patches of view-dependent colour over groups of scales, violet through blue to teal
  float NoV = max(dot(Np, V), 1e-3);
  float patchH = fbm(ks*4.0 + 1.3);
  // the hue also follows the angle to the key light, so bands of colour roll across the body as it turns
  // Each scale's guanine plates sit at their own tilt, steeper than its surface relief, so neighbouring
  // scales flash different hues as the fish turns; hue and value also drift in patches of a few scales
  vec2 cidW = vec2(cid.x, mod(cid.y, SROWS));
  vec3 Nir = normalize(Np + (Tg*(hash21(cidW + 81.0) - 0.5) + Pg*(hash21(cidW + 87.0) - 0.5))*0.45*scaleMask);
  float NoHk = max(dot(Nir, normalize(V + KEY_DIR)), 0.0);
  float NoVi = max(dot(Nir, V), 0.0);
  float scalePatch = vnoiseQ(cidW*0.3 + 2.7);           // clusters of scales that share a cast
  float hueT = clamp(0.48 + 1.0*(NoVi - 0.65) + 0.8*(NoHk - 0.8) + 0.6*(patchH - 0.5) + 0.55*(scalePatch - 0.5) + 0.25*(sv - 0.5), 0.0, 1.0);
  vec3 irid = mix(vec3(0.10, 0.10, 0.62), vec3(0.04, 0.18, 0.78), smoothstep(0.0, 0.5, hueT));   // violet-blue to cobalt
  irid = mix(irid, vec3(0.04, 0.40, 0.58), smoothstep(0.5, 1.0, hueT));                           // to teal
  irid *= (1.0 + 0.3*(vnoiseQ(cidW*0.4 + 9.1) - 0.5) + 0.3*(hash21(cidW + 93.0) - 0.5));   // lighter and darker scales
  float turq = step(0.975, hash21(cidW + 97.0))*scaleMask;                                            // the odd bright turquoise scale
  irid = mix(irid, vec3(0.07, 0.62, 0.66)*1.2, 0.8*turq);
  irid = mix(irid, vec3(0.30, 0.07, 0.08), clamp(max(redScale, 0.6*redP)*0.8 + oddRed*0.4, 0.0, 1.0));
  irid = mix(irid, vec3(0.40, 0.46, 0.62), oddPale*0.35);
  irid = mix(irid, vec3(0.04, 0.14, 0.60), 0.6*coolB);
  irid = mix(irid, vec3(0.28, 0.08, 0.34), 0.35*warmB);
  float dull = smoothstep(0.6, 0.78, fbm(ks*3.0 + 11.0));     // duller, worn patches
  float scr = scratches(ks*9.0)*scaleMask;
  float field = mix(0.75, 1.05, smoothstep(-0.7, 0.7, dn.x))*(1.0 + 0.25*rim*detail);   // guanine densest toward the exposed rear
  float plateAmt = (1.0 - 0.35*smoothstep(0.35, 0.9, c))*(0.66 + 0.12*sv)*field*(1.0 - 0.85*melanin)*(1.0 - 0.45*regrown)*(1.0 - 0.35*dull)*(1.0 - 0.5*scr)*scaleMask*occl;

  vec3 under = mix(blueBase, deepRed, warm);
  under = mix(under, under*0.6 + vec3(0.0, 0.006, 0.03), 0.5*coolB);
  under = mix(under, vec3(0.13, 0.025, 0.07), 0.35*warmB);
  under = mix(under, deepRed, oddRed*0.4);
  under += irid*plateAmt*0.08;                           // iridophores also scatter diffusely, so the colour holds off the highlight
  under = mix(under, vec3(0.03, 0.006, 0.012), melanin*0.8);
  under += vec3(0.015, 0.024, 0.04)*rim*detail;           // the thin free margin is paler and catches the light
  under = mix(under, vec3(0.16, 0.18, 0.22), scr*0.25);

  // Head: red over the forehead and snout, grading through mottled pink into a pale bluish-silver
  // cheek and gill cover and a pale jaw; fine dark and pale freckles thin out gradually
  // (skipped off the head, where it is invisible and costly)
  float crown = 1.0, pearlSkin = 0.0, pores = 0.0, lips = 0.0, beard = 0.0;
  vec3 skinCol = vec3(0.0);
  if (head > 0.001){
    float mott = skinFbm(ks*6.0 + 4.1);
    float fine = skinFbm(ks*30.0);
    float redLine = mix(0.08, 0.45, smoothstep(0.07, 0.2, t));   // down to the eye on the snout, higher behind it
    float mott2 = skinFbm(ks*14.0 + 8.3);
    float crownField = c - redLine + 0.55*(mott - 0.5) + 0.25*(mott2 - 0.5) + 0.1*(fine - 0.5) + 0.35*smoothstep(-0.05, 0.0, eo);
    crown = smoothstep(-0.3, 0.3, crownField);
    pearlSkin = clamp(1.6*(skinFbm(ks*12.0 + 1.3) - 0.3), 0.0, 1.0);     // guanine thickens in patches
    vec3 silver = mix(vec3(0.045, 0.105, 0.20), vec3(0.10, 0.165, 0.25), pearlSkin);
    // warm flush mottles the cheek, strongest toward the red and fading into the silver; linear ramps, no plateaus
    float flush = clamp(0.5*(mott2 - 0.3) + 0.35*(crownField + 0.7), 0.0, 1.0)*0.55;
    vec3 cheekCol = mix(silver, vec3(0.24, 0.085, 0.08), flush);
    cheekCol = mix(cheekCol, vec3(0.035, 0.11, 0.28), cover*smoothstep(-0.6, 0.2, c)*(0.45 + 0.45*mott)*(1.0 - 0.3*pearlSkin));   // bluer gill cover
    cheekCol = mix(cheekCol, vec3(0.15, 0.17, 0.215), smoothstep(-0.2, -0.9, c + 0.2*(mott - 0.5))*0.6); // pale jaw and throat
    cheekCol *= 0.86 + 0.2*fine + 0.06*(skinFbm(mat2(0.8, -0.6, 0.6, 0.8)*ks*110.0) - 0.5);   // fine skin texture
    // red crown: uneven, finely mottled deep and pale red, never a flat fill
    float rm = skinFbm(ks*16.0 + 7.0), rf = skinFbm(ks*55.0 + 2.0);
    vec3 redCol = mix(red, deepRed, clamp(1.8*(rm - 0.4), 0.0, 0.8))*(0.55 + 0.3*mott2 + 0.55*rf);
    redCol = mix(redCol, vec3(0.46, 0.19, 0.16), clamp(2.2*(skinFbm(ks*34.0 + 2.0) - 0.45), 0.0, 0.65));   // paler salmon mottling
    skinCol = mix(cheekCol, redCol, crown);
    float dens = smoothstep(0.25, 0.85, fbm(ks*8.0 + 3.0));
    float freckle = max(melanophores(vL*240.0 + 5.0, 0.55*dens), 0.6*melanophores(vL*110.0, 0.35*dens*dens));
    float speck = melanophores(vL*300.0 + 11.0, 0.4*(1.0 - dens));
    pores = melanophores(vL*520.0 + 2.0, 0.55);
    skinCol = mix(skinCol, mix(vec3(0.07, 0.07, 0.09), vec3(0.09, 0.015, 0.012), crown), freckle*0.6);
    skinCol = mix(skinCol, vec3(0.45, 0.45, 0.50), speck*0.35)*(1.0 - 0.15*pores);
    // pale, fleshy, translucent lips parted by a dark gape; a dark grainy band behind the upper lip
    float tip = 1.0 - smoothstep(0.03, 0.05, t);
    lips = (1.0 - smoothstep(0.014, 0.026, t + 0.005*(n1 - 0.5)))*exp(-pow((c - gapeC(t))/0.8, 2.0));   // fleshy rims around the gape
    float gape = exp(-pow((c - gapeC(t))/mix(0.08, 0.04, smoothstep(0.0, 0.02, t)), 2.0))*tip;
    float gapeLip = exp(-pow((c - gapeC(t))/0.14, 2.0));   // the lips flush darker toward where they meet
    float upperBand = smoothstep(gapeC(t) + 0.05, gapeC(t) + 0.25, c)*smoothstep(0.024, 0.032, t)*(1.0 - smoothstep(0.042, 0.056, t + 0.01*(n1 - 0.5)));
    // the lips are thin enough for the red flesh to glow through at their base; fine creases run across them
    float lipGrain = (0.8 + 0.3*vnoise(vL.xy*420.0))*(0.88 + 0.12*vnoise(vec2(ph*60.0, t*90.0)))*(1.0 - 0.6*melanophores(vL*700.0, 0.12));
    vec3 lipCol = mix(vec3(0.36, 0.19, 0.18), vec3(0.46, 0.40, 0.40), smoothstep(0.022, 0.006, t) - 0.4*gapeLip)*lipGrain;
    skinCol = mix(skinCol, lipCol, lips);
    skinCol = mix(skinCol, vec3(0.012, 0.004, 0.004), upperBand*(0.85 + 0.15*melanophores(vL*420.0, 0.8)));
    skinCol *= 1.0 - (0.85 + 0.13*uMouth)*min(gape*(1.0 + 1.5*uMouth), 1.0);   // an open mouth shows the dark interior
    // the dark branchiostegal membrane shows along the lower rear margin of the gill cover
    beard = smoothstep(-0.55, -0.95, c + 0.25*(fbm(sk*10.0) - 0.5))*smoothstep(0.06, 0.14, t)*smoothstep(-0.14, -0.02, eo)*head;
    skinCol = mix(skinCol, vec3(0.03, 0.012, 0.016), beard*0.5);
    // nostril: a small dark pit in front of the eye
    float hn, hln, wn, ycn; bodyProfile(0.058, hn, hln, wn, ycn);
    float nd = length(vL - vec3(0.442, ycn + hn*0.55, side*wn*0.83))/0.004;
    skinCol *= 1.0 - 0.75*(1.0 - smoothstep(0.3, 1.0, nd));
    // the skin fold of the orbit darkens into the crease where it meets the eyeball, with a faint dark margin
    float orbit = length(vL - eyeCentre(side))/EYE_R;
    skinCol *= (1.0 - 0.4*(1.0 - smoothstep(0.86, 1.0, orbit)))*(1.0 - 0.25*(1.0 - smoothstep(1.0, 1.28, orbit)));
  }

  vec3 albedo = mix(under, skinCol, head);
  albedo = mix(albedo, vec3(0.025, 0.067, 0.22)*(0.9 + 0.2*rayLine), tail);   // the blue fin root, its rays already showing
  if (padM*(1.0 - head) > 0.0){
    vec3 padCol = mix(vec3(0.30, 0.10, 0.11), vec3(0.38, 0.20, 0.22), smoothstep(0.3, 0.7, vnoise(sk*70.0)));   // bare, pinkish flesh
    albedo = mix(albedo, padCol*(0.85 + 0.2*vnoise(sk*240.0)), padM*(1.0 - head));
  }
  albedo *= (1.0 - 0.45*opShadow)*occl*(1.0 - 0.6*pectOcc);
  albedo = mix(albedo, vec3(0.08, 0.008, 0.012), slit*0.6);
  // the free rear edge of the gill cover is thin: a paler, translucent margin
  float coverEdge = smoothstep(-0.016, -0.003, eo)*(1.0 - smoothstep(-0.003, 0.0, eo))*smoothstep(0.7, 0.2, c);
  albedo = mix(albedo, vec3(0.40, 0.10, 0.09), coverEdge*0.45);       // dark red gill filaments show through the opening
  // a fine dark line of pigment follows the free margin of the gill cover
  float marginLine = exp(-pow((eo + 0.005 + 0.002*(n1 - 0.5))/0.0045, 2.0))*smoothstep(0.8, 0.45, c)*(0.75 + 0.25*vnoiseQ(vec2(c*14.0, 3.0)));
  albedo = mix(albedo, vec3(0.015, 0.012, 0.022), marginLine*0.9);

  // Soft occlusion by the fins: along the dorsal and anal bases, under the caudal, round the pelvic
  // lobes, and the shadow the pectoral fan throws back and down onto the flank
  float finOcc = max(max(smoothstep(0.45, 0.52, t)*(1.0 - smoothstep(0.93, 0.99, t))*smoothstep(0.55, 0.97, c),
                         smoothstep(0.31, 0.38, t)*(1.0 - smoothstep(0.93, 0.99, t))*smoothstep(-0.55, -0.97, c)),
                     max(0.8*smoothstep(0.86, 0.99, t), exp(-pow((t - VENTRAL_T - 0.01)/0.035, 2.0) - pow(vphB/0.35, 2.0))));
  float pectShadow = smoothstep(-0.005, 0.02, pe)*exp(-pow((pe - 0.06 - 0.04*sin(pAbd))/(0.07 + 0.03*sin(pAbd)), 2.0) - pow((c - PECT_C + 0.16)/0.3, 2.0));
  float ao = (1.0 - 0.4*finOcc)*(1.0 - 0.5*pectShadow);
  // the key is a broad soft source above: the back is lit and the belly turns away into shadow
  float bellyFall = mix(0.5, 1.0, smoothstep(-0.95, -0.15, c));
  // iridophores reflect most where the scales face the viewer, so the flank darkens toward its edges
  float facing = mix(0.55, 1.0, smoothstep(0.1, 0.8, NoV))*(1.0 - head) + head;

  // Reflective layer: a broad, low-intensity guanine sheen in the scales and on the gill cover
  vec3 f0 = irid*plateAmt*0.42*facing;
  if (head > 0.0){   // cover is zero wherever head is
    vec3 coverF0 = mix(vec3(0.26, 0.44, 0.72), vec3(0.50, 0.36, 0.64), clamp(skinFbm(ks*30.0) + 0.8*(NoV - 0.6), 0.0, 1.0))*(0.6 + 0.5*skinFbm(ks*50.0 + 5.0));
    f0 += 0.26*coverF0*max(cover, 0.5*head*(1.0 - lips))*(1.0 - crown)*(1.0 - beard)*mix(0.15, 1.0, pearlSkin);
  }
  f0 = max(f0*(1.0 - 0.45*pectOcc)*(1.0 - 0.8*marginLine), vec3(0.015));
  float rough = mix(0.55, 0.6, head) + 0.1*regrown + 0.15*dull;

  // Mucus: a soft, broad sheen over everything, following the head relief rather than the scales
  vec3 Nm = mix(N, Nh, 0.8);
  float mucusRough = (0.34 + 0.08*head - 0.12*lips + 0.1*scr)*(0.85 + 0.3*vnoise(sk*20.0));
  // Subsurface scattering: thin flesh (stalk, lips, dorsal and ventral ridges, gill cover margin)
  // wraps light further round and glows warm when lit from behind
  float thin = clamp(max(max(0.5*(1.0 - smoothstep(0.018, 0.05, w)), 0.4*smoothstep(0.8, 0.98, abs(c))*(1.0 - head)), max(lips, coverEdge)), 0.0, 1.0);
  thin *= 1.0 - marginLine;
  vec3 flesh = vec3(0.60, 0.14, 0.07);
  float wrap = 0.08 + 0.2*head + 0.3*thin;
  vec3 sheenF0 = irid*plateAmt*0.14*facing;   // a soft, velvety second lobe rolling over the scales
  vec3 col = AMBIENT*albedo;
  vec3 Ls[3]; Ls[0] = KEY_DIR; Ls[1] = FILL_DIR; Ls[2] = RIM_DIR;
  vec3 Cs[3]; Cs[0] = KEY_COL; Cs[1] = FILL_COL; Cs[2] = RIM_COL;
  for (int i = 0; i < 3; i++){
    float ndl = dot(Np, Ls[i]);
    float selfSh = i == 0 ? keyShadow : 1.0;
    col += Cs[i]*albedo*max((ndl + wrap)/(1.0 + wrap), 0.0)*ao*bellyFall*selfSh;
    col += Cs[i]*flesh*0.05*max(max((ndl + 0.6)/1.6, 0.0) - max(ndl, 0.0), 0.0);   // red bleeding across the terminator
    col += Cs[i]*(waterLobe(Np, V, Ls[i], f0, rough) + waterLobe(Np, V, Ls[i], sheenF0, 0.4))*ao*mix(0.4, 1.0, bellyFall)*selfSh;
    col += Cs[i]*waterLobe(Nm, V, Ls[i], vec3(0.018)*(1.0 - 0.6*pores), mucusRough);
    col += Cs[i]*flesh*thin*pow(max(dot(V, -normalize(Ls[i] + Np*0.35)), 0.0), 3.0)*0.16;   // transmission
  }
  col += envLight(reflect(-V, Np), rough)*f0*0.55*ao*mix(0.4, 1.0, bellyFall);
  col += envLight(reflect(-V, Nm), 0.35)*waterFresnel(vec3(0.018), max(dot(Nm, V), 1e-3))*0.14;
  // glitter: rare guanine glints that cluster on a few scales and are absent from most
  // (only on the few scales of a cluster; skipped elsewhere, where it adds nothing)
  vec2 gp = mat2(0.5, 0.87, -0.87, 0.5)*pv*13.0 + 3.7;
  float gaa = length(fwidth(gp));
  if (hash21(cid*0.7 + 13.0) >= 0.8 && scaleMask*fade > 0.0){
    vec2 gt; float gr;
    float g = platelets(gp, gaa, gt, gr);
    vec3 gN = normalize(Np + (Tg*gt.x + Pg*gt.y)*1.4);
    float gClus = step(0.8, hash21(cid*0.7 + 13.0))*smoothstep(0.45, 0.7, fbm(ks*5.0 + 2.0));
    float glitter = gClus*scaleMask*fade*(1.0 - melanin)*occl*(1.0 - 0.85*pectFoot)*(1.0 - 0.6*rim);
    col += mix(irid, vec3(0.7, 0.85, 1.0), 0.35)*glitter*g*glint(gN, V, gr)*0.35;
  }
  gl_FragColor = vec4(display(col), 1.0);
}`;

// ---------------------------------------------------------------------------
// Eyes
// ---------------------------------------------------------------------------
export const EYE_VERT = GLSL_COMMON + HEAD_GLSL + /* glsl */`
uniform float uSide;
varying vec3 vW, vN, vD, vAx;
void main(){
  vec3 E = eyeCentre(uSide);
  vec3 P, T, U; spineFrame(E.x, P, T, U);
  vec3 S = cross(T, U);
  vec3 d = position;
  vec3 local = E + d*EYE_R;
  vW = P + U*local.y + S*local.z + T*(local.x - E.x);
  vN = normalize(T*d.x + U*d.y + S*d.z);
  vec3 a = normalize(vec3(0.2, 0.27, uSide));
  vAx = normalize(T*a.x + U*a.y + S*a.z);
  vD = d;
  gl_Position = projectionMatrix*viewMatrix*vec4(vW, 1.0);
}`;

export const EYE_FRAG = GLSL_COMMON + /* glsl */`
uniform float uSide;
uniform vec3 uGaze;
varying vec3 vW, vN, vD, vAx;
void main(){
  vec3 d = normalize(vD);
  vec3 cap = normalize(vec3(0.2, 0.27, uSide));       // where the orbit opens
  vec3 axis = normalize(cap + uGaze*0.25);             // where the eyeball looks
  float q = acos(clamp(dot(d, axis), -1.0, 1.0))/0.84;
  float edge = acos(clamp(dot(d, cap), -1.0, 1.0))/0.86;   // 1 where the eyeball meets the orbit
  // only the cap in the orbit is eyeball; the rest lies under the head, and where the head narrows
  // ahead of the eye it would otherwise poke out through the skin as a dark disc
  if (edge > 1.05) discard;
  vec3 side = normalize(cross(axis, vec3(0.0, 1.0, 0.0)));
  float around = atan(dot(d, cross(axis, side)), dot(d, side));
  float seed = uSide*1.7;

  // A large, very dark pupil in a thin, dark bronze and blue-grey iris, with fine golden and blue flecks
  float pr = 0.80 + 0.035*(vnoise(vec2(around*2.0 + seed, 4.0)) - 0.5);
  float fib = vnoise(vec2(around*16.0 + seed, q*7.0))*0.6 + vnoise(vec2(around*43.0, q*3.0 + seed))*0.4;
  float sector = smoothstep(0.25, 0.75, vnoise(vec2(around*1.6 + seed*3.0, 0.5)));
  vec3 iris = mix(vec3(0.018, 0.013, 0.009), vec3(0.050, 0.036, 0.020), fib);          // bronze
  iris = mix(iris, vec3(0.016, 0.034, 0.052)*(0.8 + 0.4*fib), sector);                  // blue-grey sectors
  float ring = smoothstep(pr, pr + 0.03, q)*(1.0 - smoothstep(0.9, 0.96, q));
  float fleck = smoothstep(0.72, 0.9, vnoise(vec2(around*70.0 + seed*5.0, q*30.0)))*ring;
  iris = mix(iris, mix(vec3(0.34, 0.24, 0.07), vec3(0.10, 0.20, 0.32), step(0.5, vnoise(vec2(around*9.0, seed)))), fleck*0.6);
  iris += vec3(0.10, 0.07, 0.02)*exp(-pow((q - pr - 0.025)/0.018, 2.0))*(0.4 + 0.6*fib)*0.5;   // faint golden pupil rim
  float pupil = 1.0 - smoothstep(pr - 0.015, pr + 0.015, q);
  // dim blue-grey guanine where the iris runs under the orbit, then the dark socket margin
  float silver = smoothstep(0.88, 0.98, edge + 0.1*(fib - 0.5))*(0.5 + 0.5*sector);
  vec3 albedo = mix(iris, vec3(0.012, 0.016, 0.02), silver*0.7);
  albedo = mix(albedo, vec3(0.002), pupil);
  float lid = smoothstep(0.96, 1.02, edge);
  albedo = mix(albedo, vec3(0.05, 0.02, 0.02), lid);
  // the eyeball runs under the skin fold of the orbit: a soft contact shadow
  float occ = 1.0 - 0.45*smoothstep(0.9, 1.0, edge)*(1.0 - smoothstep(1.0, 1.06, edge));

  vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
  vec3 Ni = normalize(mix(N, normalize(vAx), 0.7));    // the iris is a nearly flat disc under the cornea
  vec3 col = AMBIENT*albedo;
  col += (KEY_COL*max(dot(Ni, KEY_DIR), 0.0) + FILL_COL*max(dot(Ni, FILL_DIR), 0.0))*albedo*occ;
  // a faint blue-green sheen in the lower iris
  float below = smoothstep(-0.3, 0.8, sin(around))*ring;
  col += envLight(reflect(-V, Ni), 0.4)*vec3(0.04, 0.10, 0.12)*below*occ*0.5;
  // clear cornea: a small soft reflection of the key softbox and a faint image of the surroundings
  vec3 R = reflect(-V, N);
  float cornea = occ*(1.0 - lid);
  float rk = dot(R, KEY_DIR);
  float spot = smoothstep(0.975, 0.997, rk);
  float halo = smoothstep(0.93, 0.99, rk);
  col += vec3(1.0, 0.97, 0.92)*(spot*1.3 + halo*0.12)*cornea;
  col += RIM_COL*smoothstep(0.95, 0.99, dot(R, RIM_DIR))*0.15*(1.0 - smoothstep(0.6, 0.8, edge));
  // the cornea is a clear dome: it mirrors the bright top of the tank, stronger toward its rim
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += envLight(R, 0.12)*(0.05 + 0.25*fres)*cornea;
  gl_FragColor = vec4(display(col), 1.0);
}`;
// ---------------------------------------------------------------------------
// Fins. FIN: 0 caudal, 1 dorsal, 2 anal, 3 pectoral, 4 ventral.
// ---------------------------------------------------------------------------
export const FIN_VERT = GLSL_COMMON + HEAD_GLSL + /* glsl */`
attribute vec2 aP;
uniform float uSide;
varying vec2 vPar;
varying vec3 vW, vN, vTa;
varying float vFold;
float fold;

// The three median fins share one outer margin: a near-round halfmoon disc centred just behind the
// peduncle, so dorsal, caudal and anal read as one continuous "D". th is the polar angle about the
// centre: 0 straight back, +PI/2 up, -PI/2 down. The lower half is a slightly squared circle, so the
// rear and bottom bulge full; the upper half is a flatter ellipse, a broad arc over the back.
#define DISC_C vec2(-0.46, -0.03)
#define RIM_S 0.87                // s at which the visible margin sits (FIN_FRAG's uEdge)
float discR(float th){
  float sn = sin(th), n = sn > 0.0 ? 2.0 : 2.6;
  float r = pow(pow(abs(cos(th))/0.80, n) + pow(abs(sn)/(sn > 0.0 ? 0.57 : 0.79), n), -1.0/n);
  return r + 0.05*(vnoise(vec2(th*2.2 + 3.0, 1.3)) - 0.5) + 0.025*(vnoise(vec2(th*5.5, 7.1)) - 0.5);
}
vec2 discPt(float th){ return DISC_C + discR(th)*vec2(-cos(th), sin(th)); }
vec2 rot2(vec2 v, float g){ float c = cos(g), n = sin(g); return vec2(c*v.x - n*v.y, n*v.x + c*v.y); }
// A ray from root B that reaches tip T at the margin, bowed sideways by bow (in chord lengths) and
// with an optional S-shaped wiggle, so rays sweep in long curves instead of straight spokes.
vec2 rayCurve(vec2 B, vec2 T, float bow, float wig, float s){
  float u = s/RIM_S;
  vec2 c = T - B, n = vec2(-c.y, c.x);
  vec2 K = B + 0.5*c + n*bow;
  return (1.0 - u)*(1.0 - u)*B + 2.0*u*(1.0 - u)*K + u*u*T + n*wig*sin(2.0*PI*min(u, 1.0))*min(u, 1.0);
}
// Big alternating pleats whose ridges run along the rays: z offset and the fold value FIN_FRAG shades.
float pleatWave(float ph){ return sin(ph) + 0.3*sin(2.0*ph + 1.1); }

vec3 finLocal(vec2 p){
  float s = p.x;
  vec3 q;
  fold = 0.0;
#if FIN == 0
  // Caudal: a halfmoon fan whose rays sweep out from the peduncle in long curves to the shared disc
  // margin, spreading almost 180 degrees. It stays deliberately lopsided: the upper lobe is a little
  // shorter and tucked under the dorsal; the lower lobe is longer, droops, and gathers into deep
  // irregular pleats; and the lower half twists away about the body axis.
  float a = p.y*2.0 - 1.0;                                // -1 lowest ray .. 1 top ray
  float t = uTime;
  float top = smoothstep(0.15, 1.0, a), bot = smoothstep(-0.05, -1.0, a);
  // pleat phase with uneven spacing: the noise terms stretch some folds broad and squeeze others tight
  float ph = a*PI*6.4 + 2.4*vnoise(vec2(a*1.9, 6.3)) + 1.2*vnoise(vec2(a*4.1, 8.7))
           + s*(0.6 + 0.9*(vnoise(vec2(a*2.7, 3.1)) - 0.5)) + 0.35*sin(t*0.6 + a*1.7);
  float depthN = 0.45 + 1.1*vnoise(vec2(ph*0.29, 4.0));  // each fold its own depth
  float region = 0.55 + 0.45*(1.0 - top) + 0.5*bot;      // flatter top, deep heavy bottom
  float breathe = 0.85 + 0.2*sin(t*0.9 + a*3.0 + s*1.5);
  float spread = uSpread*(1.0 - 0.22*uStream*s);
  float th = a*1.50*spread + 0.035*sin(uTime*0.8 + a*2.5)*s + 0.16*s*s*(vnoise(vec2(a*3.0, 2.0)) - 0.5);
  th -= 0.06 + 0.06*bot + 0.25*uStream*top;               // fan sits low: the bottom droops; streamlined, the top tucks under the dorsal
  // folds lean sideways too, so the deepest ones in the lower lobe double over themselves
  th += uPleat*0.075*s*cos(ph)*depthN*(0.25 + 0.9*bot);
  vec2 B = vec2(-0.41, a*0.08);                           // sunk into the peduncle: rays run in under the scaled skin
  vec2 T = B + (discPt(th) - B)*(1.0 - 0.15*uStream*top)*(1.0 + 0.018*pow(s, 4.0)*sin(a*33.0 + uTime*0.7));
  // upper rays leave the peduncle heading back and arch up, lower rays curve down; some run S-shaped
  float wig = 0.08*(vnoise(vec2(a*3.3, 11.0)) - 0.5);
  q = vec3(rayCurve(B, T, 0.30*a, wig, s), 0.0);
  // twist: the lower half turns away about the body axis while the upper half faces the side;
  // the pleats are added after it, so they still hang as vertical folds
  float phi = (0.36 + 0.06*sin(t*0.5 + 0.8))*smoothstep(0.25, -0.9, a);
  q.y /= mix(1.0, cos(phi), 0.75);                       // keeps the side-view outline on the shared rim
  q.z = q.y*sin(phi); q.y *= cos(phi);
  // big creases (asymmetric profile), finer pleats between them, and a petal-like rim
  float big = pleatWave(ph);
  float mid = 0.3*sin(a*PI*11.0 + 1.5*vnoise(vec2(a*6.0, 2.2)) + s*1.4 + 0.5*sin(t*0.8 + a*3.0))
            *(0.4 + 0.9*vnoise(vec2(a*7.0, 9.0)));
  fold = clamp(1.1*depthN*big + mid, -1.0, 1.0);
  float dz = pow(s, 1.1)*0.18*(depthN*big + mid)*region*breathe;
  dz += 0.04*pow(s, 4.0)*sin(a*17.0 + 2.0*vnoise(vec2(a*5.0, 12.0)) + t*0.5)*(0.5 + bot);
  q.z += uPleat*dz;
  // the fan billows like a sail: a slow camber that drifts from lobe to lobe
  q.z += 0.11*s*s*sin(a*1.1 + 0.7*sin(uTime*0.23) + 0.9)*(0.7 + 0.3*sin(uTime*0.41 + a))*(1.0 - 0.6*top);
  q.z += 0.012*pow(s, 3.0)*sin(a*41.0 + uTime*0.9);
  q.z += 0.035*s*s*(0.6 + 0.4*a);                                   // habitual curl
  q.z -= 0.08*pow(s, 3.0)*smoothstep(0.55, 1.0, a);                  // top rim curves away
  q = membraneSway(q);
#elif FIN == 1
  // Dorsal: a long base along the back. Its rays rise steeply, then sweep back to the shared margin;
  // the rear rays are longest and hang back and down over the upper caudal with free trailing ends.
  float a = p.y;                                          // 0 leading ray .. 1 rearmost
  float xb = mix(0.03, -0.44, a);
  float hu, hl, w, yc; bodyProfile(0.5 - xb, hu, hl, w, yc);
  vec2 B = vec2(xb, yc + hu - 0.04);                      // sunk into the back, following bodyProfile
  float hang = smoothstep(0.74, 1.0, a);
  // the margin rises quickly from a short, raked leading ray and eases onto the disc rim, so the front
  // of the dorsal is a rounded shoulder rather than a point
  float k = 1.0 - clamp(a/0.45, 0.0, 1.0);
  vec2 T = B + (discPt(mix(2.25, 0.80, pow(a, 0.9))) - B)*(1.0 - 0.55*k*k);
  // the rear hangs back over the upper caudal as a narrow, drooping sheet that splits into a few
  // long, tapered flaps of different lengths
  float flap = pow(0.5 + 0.5*sin(a*PI*30.0 + 3.0*vnoise(vec2(a*6.0, 21.0))), 2.0)*hang;
  T = mix(T, B + vec2(-0.50, 0.14), hang*hang);
  T = B + (T - B)*(1.0 - 0.22*hang + 0.42*flap);
  // streamlining folds it back along the body; flaring raises it
  T = B + rot2(T - B, 0.40*uStream*(1.0 - 0.4*a) - 1.2*(uSpread - 1.0))*mix(1.0, 0.92, uStream);
  q = vec3(rayCurve(B, T, -0.13 - 0.10*hang, 0.03*(vnoise(vec2(a*4.0, 13.0)) - 0.5), s), 0.0);
  q.y -= (0.04 + 0.12*flap)*pow(s, 3.0)*hang;             // the loose trailing ends droop
  float ph = a*PI*10.0 + 1.8*vnoise(vec2(a*2.6, 1.0)) + 0.8*s + 0.5*sin(uTime*0.4 + a*3.0);
  float dep = 0.55 + 0.9*vnoise(vec2(a*5.0, 1.0));
  fold = clamp(1.1*dep*pleatWave(ph), -1.0, 1.0);
  q.z += uPleat*0.10*pow(s, 1.1)*dep*pleatWave(ph);
  q.z += 0.05*s*s*sin(uTime*0.29 + a*2.0)*(1.0 - smoothstep(0.35, 0.85, a)*0.5);
  q.z += 0.03*s*s*(1.0 - a);
  q.z += uOverlap*(0.006 + 0.05*pow(s, 1.3))*smoothstep(0.35, 0.85, a);
  q = membraneSway(q);
#elif FIN == 2
  // Anal: a deep curtain from a long base under the belly. Shallow in front, it deepens toward the
  // rear to the shared margin, and its rearmost rays hang back over the lower caudal.
  float a = p.y;                                          // 0 leading ray .. 1 rearmost
  // the base runs back under the peduncle, so the rear of the curtain overlaps the lower caudal root
  float xb = mix(0.17, -0.53, a);
  float hu, hl, w, yc; bodyProfile(0.5 - xb, hu, hl, w, yc);
  vec2 B = vec2(xb, yc - hl + 0.04);                      // sunk into the belly, following bodyProfile
  float hang = smoothstep(0.70, 1.0, a);
  // the front margin drops in a soft convex curve, scalloped where the curtain folds
  float k = 1.0 - clamp(a/0.60, 0.0, 1.0);
  float reach = (1.0 - 0.62*k*k)*(1.0 + 0.07*k*sin(a*PI*9.0 + 0.8));
  vec2 T = B + (discPt(-mix(2.25, 1.10, pow(a, 0.8))) - B)*reach;
  T = mix(T, B + vec2(-0.50, 0.02), 0.85*hang*hang);        // the rearmost rays run back under the peduncle
  T = B + rot2(T - B, -0.40*uStream*(1.0 - 0.4*a) + 1.2*(uSpread - 1.0))*mix(1.0, 0.92, uStream);
  q = vec3(rayCurve(B, T, 0.12 + 0.05*hang, 0.03*(vnoise(vec2(a*4.0, 17.0)) - 0.5) + 0.05*k, s), 0.0);
  float ph = a*PI*11.0 + 1.8*vnoise(vec2(a*2.6, 3.0)) + 0.8*s + 0.5*sin(uTime*0.37 + a*2.0);
  float dep = 0.55 + 0.9*vnoise(vec2(a*5.0, 3.0));
  fold = clamp(1.1*dep*pleatWave(ph), -1.0, 1.0);
  q.z += uPleat*0.10*pow(s, 1.1)*dep*pleatWave(ph);
  q.z += 0.05*s*s*sin(uTime*0.26 + a*2.3 + 2.0)*(1.0 - smoothstep(0.4, 0.85, a)*0.5);
  q.z -= 0.02*s*s;
  q.z += uOverlap*(0.006 + 0.05*pow(s, 1.3))*smoothstep(0.4, 0.85, a);
  // under the thin, flattened stalk the base lies just outside its skin on the viewer's side, so the
  // stalk's shaded underside never shows past it as a dark sliver
  q.z -= uOverlap*0.018*smoothstep(-0.32, -0.46, xb);
  q = membraneSway(q);
#elif FIN == 3
  // Pectoral: rays converge on a short base in the fleshy pad behind the gill cover and fan out
  // into a rounded paddle held out from the flank. The fan cups and flexes as it beats.
  float a = p.y;                                        // 0 lowest ray .. 1 upper, leading ray
  float cb = PECT_C + (a - 0.5)*0.22;
  float tb = pectT(cb);
  float hu, hl, w, yc; bodyProfile(tb, hu, hl, w, yc);
  float rp = 0.99 + 0.10*pectPad(tb, cb);              // rooted just inside the pad's skin
  vec3 base = vec3(0.5 - tb, yc + cb*hl*rp, uSide*w*sqrt(1.0 - cb*cb)*rp);
  float g = pectAbd(uSide, s, a)*(1.0 + 0.05*uSide);
  vec3 D = normalize(vec3(-cos(g), -0.22*sin(g), uSide*sin(g)));   // back and out from the flank
  vec3 U = normalize(vec3(0.10, 1.0, 0.0) - D*dot(vec3(0.10, 1.0, 0.0), D));
  vec3 away = -uSide*cross(D, U);                        // the fin face turned away from the body
  float fan = mix(-0.62, 0.95, a);                      // spread behind the gill cover, upper rays rising
  float L = 0.255*(0.62 + 0.38*sin(clamp(a*1.05, 0.0, 1.0)*PI) + 0.06*a)*(1.0 + 0.05*uSide);
  L *= 1.0 + 0.05*(vnoise(vec2(a*7.0, 4.0 + uSide*3.0)) - 0.5);   // soft, slightly uneven margin
  q = base + (cos(fan)*D + sin(fan)*U)*L*s;
  q.y -= 0.022*s*s;                                     // rays arc a little downward
  // the membrane lags the rays: it bulges against the stroke, the flexible lower rays most
  float cup = (0.05 - 0.13*cos(pectArg(uSide, s, a))*uFlapAmp)*sin(a*PI)*(1.0 - 0.45*a) + 0.03*(1.0 - a)*s;
  q += away*cup*L*s*s;
  q += away*L*0.035*smoothstep(0.6, 1.0, s)*sin(a*31.0 + uSide*2.0 + 1.3*sin(a*11.0));   // ruffled margin
#else
  // Pelvic fin: a short base on the throat lobe, a long leading spine angled back and down,
  // and a narrow membrane trailing behind it whose rays shorten toward the rear, so the tip is pointed.
  float a = p.y;                                        // 0 rearmost ray .. 1 leading spine
  float tb = mix(VENTRAL_T + 0.026, VENTRAL_T - 0.010, a);
  float hu, hl, w, yc; bodyProfile(tb, hu, hl, w, yc);
  float cb = -cos(VENTRAL_PH), sb = sin(VENTRAL_PH);
  float sk = 0.97 + 0.12*exp(-pow((tb - VENTRAL_T)/0.02, 2.0));   // just under the lobe's skin
  vec3 base = vec3(0.5 - tb, yc + cb*hl*sk, uSide*sb*w*sk);
  float ang = mix(0.74, 0.93, pow(a, 0.8))*(1.0 + 0.05*uSide)*mix(1.0, 0.55, uStream);   // below the body axis
  float splay = mix(0.22, 0.34, a)*(1.0 - 0.06*uSide);
  vec3 dir = normalize(vec3(-cos(ang), -sin(ang), uSide*splay));
  float L = 0.44*(1.0 + 0.07*uSide)*mix(0.40, 1.0, pow(a, 0.8));
  L *= 1.0 + 0.16*(vnoise(vec2(a*6.0, 3.0 + uSide*2.0)) - 0.5)*(1.0 - a);   // ragged trailing edge
  q = base + dir*L*s;
  q.x -= 0.10*s*s*L;                                    // sweeps back toward the tip
  q.z += uSide*0.018*sin(a*PI)*s;                       // slight cup in the membrane
  float sw = s*s;
  float lag = s*2.2 + (1.0 - a)*0.9;                    // tips and trailing edge follow late
  q.z += sw*(0.045*sin(uTime*1.1 + uSide*1.7 - lag) + uLag.z*0.6);
  q.z += s*sw*(1.0 - a)*0.018*sin(uTime*3.3 + uSide - s*7.0 + a*4.0);   // trailing-edge flutter
  q.x += sw*(0.025*sin(uTime*0.8 + uSide) + uLag.x*0.5);
  q.y += sw*(0.02*sin(uTime*0.9 + uSide*2.1 - lag) + uLag.y*0.5);
#endif
  return q;
}
vec3 finWorld(vec2 p){
  vec3 q = finLocal(p);
#if FIN <= 2
  // Median fins are stiffer than the spine behind the peduncle: each point there follows the frame
  // part-way back to the caudal root, the same for all three so overlapping fins stay together.
  float xa = mix(q.x, -0.46, 0.45*smoothstep(-0.40, -0.56, q.x));
  vec3 P, T, U; spineFrame(xa, P, T, U);
  return P + T*(q.x - xa) + U*q.y + cross(T, U)*q.z;
#else
  return skin(q);
#endif
}
// Soft shadow of the body: the body is a chain of ellipsoids along the spine, and a ray's closest
// approach to each gives a soft occlusion that widens with distance. x: toward the key light;
// y: toward the broad light overhead (the soft top-down look), with a much wider penumbra.
varying vec2 vShadow;
float ellOcc(vec3 oo, vec3 dd, float soft){
  float tc = max(-dot(oo, dd)/dot(dd, dd), 0.0);
  float k = clamp(soft*(0.3 + 0.6*tc), 0.2, 1.5);
  return smoothstep(1.0 - k, 1.0 + k, length(oo + dd*tc));
}
vec2 bodyShadow(vec3 W){
  vec2 vis = vec2(1.0);
  for (int i = 2; i < 19; i += 2){
    float t = 0.5 - (uJ0 - float(i)*uJD);
    float hu, hl, w, yc; bodyProfile(clamp(t, 0.06, 1.03), hu, hl, w, yc);
    vec3 T = uST[i], U = uSU[i], B = cross(T, U);
    vec3 o = W - (uSP[i] + U*(yc + 0.5*(hu - hl)));
    vec3 rad = vec3(uJD*2.3, max(0.5*(hu + hl), 0.02), max(w, 0.02));
    vec3 oo = vec3(dot(o, T), dot(o, U), dot(o, B))/rad;
    vec3 up = vec3(0.0, 1.0, 0.0);
    vis = min(vis, vec2(ellOcc(oo, vec3(dot(KEY_DIR, T), dot(KEY_DIR, U), dot(KEY_DIR, B))/rad, 1.0),
                        ellOcc(oo*vec3(1.0, 1.0, 0.4), vec3(dot(up, T), dot(up, U), 0.4*dot(up, B))/rad, 2.5)));   // wide: the overhead light is broad
  }
  return vis;
}
void main(){
  vec2 p = aP;
  fold = 0.0;
  vec3 W = finWorld(p);
  vFold = fold;
  vShadow = bodyShadow(W);
  float e = 0.004;
  vec3 dS = finWorld(vec2(p.x + e, p.y)) - finWorld(vec2(p.x - e, p.y));
  vec3 dA = finWorld(vec2(p.x, p.y + e)) - finWorld(vec2(p.x, p.y - e));
  vN = normalize(cross(dS, dA));
  vTa = normalize(dA);
  vW = W; vPar = p;
  gl_Position = projectionMatrix*viewMatrix*vec4(W, 1.0);
}`;

export const FIN_FRAG = GLSL_COMMON + /* glsl */`
uniform vec3 uRed, uBlue, uPale;
uniform float uRays, uRedBias, uOpacity, uEdge, uSeed, uTrans, uLead, uPeel, uSideFade, uPathMax, uGlow;
uniform sampler2D uOpaqueDepth, uPrevDepth;
varying vec2 vPar;
varying vec3 vW, vN, vTa;
varying float vFold;
varying vec2 vShadow;

#define SKIN_ROOT vec3(0.15, 0.17, 0.40)   // the peduncle's blue-violet skin over the caudal ray bases
// streaks run along the rays: stretched noise, long in s, narrow across rays
float streak(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++){ v += a*vnoise(p); p = p*vec2(2.1, 1.35) + vec2(3.7, 1.9); a *= 0.5; }
  return v;
}
// Crisp fibres from noise: threshold n at t with a one-pixel antialiased edge, fading to the
// expected coverage once the noise cells (fp = cells per pixel) get finer than a pixel.
float fibre(float n, float t, float mean, float fp){
  float w = 0.6*fp + 1e-3;      // the noise's typical slope over one pixel; fwidth(n) is too blocky here
  return mix(smoothstep(t - w, t + w, n), mean, smoothstep(0.5, 1.0, fp));
}
// Thin crisp lines along the level set n = 0.5: about a pixel wide when far, a fixed width close up,
// fading to their mean coverage once the noise cells get finer than a pixel.
float fibreLine(float n, float fp, float lw0){
  float w = 0.7*fp + 1e-3;
  float lw = max(0.5*w, lw0);
  return mix(1.0 - smoothstep(lw - w, lw + w, abs(n - 0.5)), 1.5*lw, smoothstep(0.45, 0.9, fp));
}
// Fibre detail scaled to the pixel: two neighbouring octaves of stretched noise, blended so the
// fibres stay about cellPx pixels across whether the rays are sparse or crowded on screen.
float octN(float fq, float s, float k, float seed){ return vnoise(vec2(fq*exp2(k) + 1.7*k + seed, s*(0.9 + 0.12*k) + 3.1*k + seed)); }
float fibreLines(float fq, float s, float fwq, float cellPx, float seed, float lw){
  float lev = clamp(log2(1.0/(cellPx*fwq)), 1.5, 5.0), k = floor(lev);
  return mix(fibreLine(octN(fq, s, k, seed), fwq*exp2(k), lw), fibreLine(octN(fq, s, k + 1.0, seed), fwq*exp2(k + 1.0), lw), lev - k);
}
float fibreBands(float fq, float s, float fwq, float cellPx, float seed){
  float lev = clamp(log2(1.0/(cellPx*fwq)), 1.5, 5.0), k = floor(lev);
  return mix(fibre(octN(fq, s, k, seed), 0.5, 0.5, fwq*exp2(k)), fibre(octN(fq, s, k + 1.0, seed), 0.5, 0.5, fwq*exp2(k + 1.0)), lev - k);
}
// Blemishes. Pinholes: a few cells of the grid p hold a tiny, slightly clearer spot of irregular
// outline (x) with a faint pale rim (y).
vec2 pinhole(vec2 p, float seed){
  vec2 c = floor(p), f = fract(p) - 0.5 - (hash22(c + seed*1.3) - 0.5)*0.4;
  float on = step(0.985, hash21(c + seed));
  float ang = atan(f.y, f.x);
  float r = (0.07 + 0.08*hash21(c + seed*2.1))*(1.0 + 0.3*sin(3.0*ang + 6.28*hash21(c + 4.0)) + 0.15*sin(5.0*ang + 2.0));
  float d = length(f)/r;
  float w = min(fwidth(d), 0.5);
  float hole = 1.0 - smoothstep(1.0 - w, 1.0 + w, d);
  return on*vec2(hole, (1.0 - hole)*(1.0 - smoothstep(1.0, 1.6 + w, d)));
}
// Melanophores: very fine specks scattered in irregular clusters on a jittered grid that ignores the
// rays; they fade out once a cell is under about three pixels, so they vanish at normal distance.
float specks(vec2 p, float seed, float density){
  p = mat2(0.8, 0.6, -0.6, 0.8)*p;
  vec2 c = floor(p), f = fract(p) - 0.5 - (hash22(c + seed) - 0.5)*0.7;
  float on = step(1.0 - density, hash21(c + seed*1.7));
  float d = length(f)/(0.15 + 0.15*hash21(c + seed*2.9));
  float w = min(fwidth(d), 0.5);
  return on*(1.0 - smoothstep(1.0 - w, 1.0 + w, d))*(1.0 - smoothstep(0.2, 0.35, length(fwidth(p))));
}

void main(){
  // Depth peeling: keep only the nearest fin surface behind the previously peeled layer.
  ivec2 px = ivec2(gl_FragCoord.xy);
  if (gl_FragCoord.z >= texelFetch(uOpaqueDepth, px, 0).r) discard;
  if (uPeel > 0.5 && gl_FragCoord.z <= texelFetch(uPrevDepth, px, 0).r) discard;
  float s = vPar.x, a = vPar.y;

  // Rays: irregular spacing, gently wavy, each forking twice on its way to the edge
  float warp = 0.55*(vnoise(vec2(a*6.0 + uSeed, s*1.3)) - 0.5) + 0.22*(vnoise(vec2(a*uRays*0.5, s*5.0 + uSeed)) - 0.5);
#if FIN == 0
  warp += 0.30*(vnoise(vec2(a*uRays*0.3 + 5.0, s*3.0 + uSeed)) - 0.5);   // neighbouring rays drift apart and together
  warp += 0.28*sin(2.0*PI*a*uRays/3.3 + 3.0*vnoise(vec2(a*4.0, s*1.5 + uSeed)));   // rays gather into loose bundles
#endif
#if FIN < 3
  // two rays carry a kink where they healed after a break
  warp += (hash11(uSeed*5.3) - 0.5)*0.5*exp(-pow(a*uRays - (0.15 + 0.7*hash11(uSeed*7.3))*uRays, 2.0)/0.8)*smoothstep(-0.012, 0.012, s - mix(0.35, 0.8, hash11(uSeed*3.1)));
  warp += (hash11(uSeed*9.7) - 0.5)*0.5*exp(-pow(a*uRays - (0.15 + 0.7*hash11(uSeed*2.9))*uRays, 2.0)/0.8)*smoothstep(-0.012, 0.012, s - mix(0.35, 0.8, hash11(uSeed*6.1)));
#endif
  // Offsets are in units of the primary ray spacing; each fork opens gradually into a Y.
  float q1 = a*uRays + warp;
  float n1 = floor(q1 + 0.5);
  float dp = q1 - n1;
  float f1 = smoothstep(0.0, 0.10, s - 0.30 - 0.12*hash11(n1 + uSeed));
  float dc = dp - sign(dp)*0.25*f1;
  float n2 = n1*2.0 + step(0.0, dp);
  float f2 = smoothstep(0.0, 0.08, s - 0.60 - 0.12*hash11(n2 + uSeed*1.7))*f1;
  float d = dc - sign(dc)*0.125*f2;
  float rayId = n2*2.0 + step(0.0, dc)*step(0.5, f2);
  float branches = 1.0 + f1 + 2.0*f2;
  float fw = fwidth(q1);
  float edge = uEdge + 0.07*(vnoise(vec2(a*uRays*0.18, 3.1 + uSeed)) - 0.5) + 0.04*vnoise(vec2(a*uRays*0.8, 7.3 + uSeed)) + 0.015*vnoise(vec2(a*uRays*3.0, 1.1));
  float clump = smoothstep(0.35, 0.8, vnoise(vec2(a*uRays*0.7, 5.5 + uSeed)));  // tips stick out in clumps
  float tipEnd = edge + 0.002 + (0.008 + 0.03*clump)*hash11(rayId + uSeed*3.0)*step(0.35, hash11(rayId*1.9 + uSeed));
#if FIN == 0
  // the long caudal rays fork a third time near the margin
  float f3 = smoothstep(0.0, 0.06, s - 0.78 - 0.10*hash11(rayId + uSeed*2.3))*f2;
  float d3 = d;
  d -= sign(d)*0.0625*f3;
  rayId = rayId*2.0 + step(0.0, d3)*step(0.5, f3);
  branches += 4.0*f3;
#endif
#if FIN < 3
  // Petal-like margin: one continuous rim scalloped into small rounded lobes at two scales on slow
  // lumps, with a few shallow tears at the cusps. No bare ray tips stick out past it.
  float gA = a*uRays*0.9 + 1.2*vnoise(vec2(a*uRays*0.2, uSeed + 2.0));
  float gB = a*uRays*0.3 + 0.8*vnoise(vec2(a*6.0, uSeed + 4.0));
  float xa = 2.0*fract(gA) - 1.0, xb = 2.0*fract(gB) - 1.0;
  float lobes = (0.008 + 0.016*hash11(floor(gA) + uSeed))*(sqrt(1.0 - xa*xa) - 1.0)
              + (0.016 + 0.026*hash11(floor(gB)*1.7 + uSeed))*(sqrt(1.0 - xb*xb) - 1.0);
  float cid = floor(gB + 0.5);
  float tear = step(0.86, hash11(cid*3.1 + uSeed))*(0.015 + 0.04*hash11(cid*1.7 + uSeed))*smoothstep(0.12, 0.0, abs(gB - cid));
  edge = uEdge + 0.06*(vnoise(vec2(a*uRays*0.1, 3.1 + uSeed)) - 0.5) + 0.02*(vnoise(vec2(a*uRays*0.4, 7.3 + uSeed)) - 0.5) + lobes - tear;
  tipEnd = edge - 0.02;
  // small nicks in the rim, here and there
  float nickC = a*uRays*1.5 + 0.5*vnoise(vec2(a*9.0, uSeed + 6.0));
  edge -= step(0.86, hash11(floor(nickC)*2.17 + uSeed*4.3))*(0.012 + 0.028*hash11(floor(nickC) + uSeed))*smoothstep(0.3, 0.0, abs(fract(nickC) - 0.5));
#endif
  float rw = mix(0.11, 0.17, s)/branches*(1.0 - 0.75*smoothstep(edge - 0.03, tipEnd, s));   // half-thickness, tapering at the tips
  float ray = 1.0 - smoothstep(rw - fw, rw + fw, abs(d));
  float resolved = 1.0 - smoothstep(0.25, 0.6, fw*branches);
  ray = mix(min(2.0*rw*branches, 1.0), ray, resolved)*smoothstep(0.03, 0.22, s);   // rays emerge from under the scaled root
  float tube = clamp(d/rw, -1.0, 1.0)*resolved;                   // across-ray position, for the rounded profile
  float seg = smoothstep(0.1, 0.9, 0.5 + 0.5*sin(s*230.0/sqrt(branches) + hash11(rayId)*6.28));

  // Pigment: red and structural blue in long streaks; blue dominates at the base
  float st = streak(vec2(q1*0.24 + uSeed, s*0.85));
  float rayVar = hash11(rayId*0.73 + uSeed);                        // every ray is a little different
  float redAmt = smoothstep(0.30, 0.70, st + uRedBias + 0.12*(s - 0.35) + 0.12*(rayVar - 0.5)*ray);
  float nearBody = 1.0 - smoothstep(0.03, 0.2, s);
  redAmt *= 1.0 - nearBody*0.8;
  vec3 membraneRed = uRed*vec3(0.9, 1.15, 1.0);                    // thinner, paler between rays
  vec3 rayRed = uRed*vec3(0.85, 0.6, 0.7);
  vec3 blueBase = uBlue*0.35;
  vec3 col = mix(mix(blueBase, blueBase*0.8, ray), mix(membraneRed, rayRed, ray), redAmt);
  // feathery white-blue streaks, more of them toward the edge
  float wst = streak(vec2(q1*0.5 + uSeed*3.0, s*1.6 + 7.0));
  float whiteAmt = smoothstep(0.55, 0.8, wst + 0.35*s - 0.1)*(1.0 - nearBody);
  col = mix(col, mix(uPale, uBlue*1.2, 0.6), whiteAmt*mix(0.5, 0.15, uLead));                  // slate-blue, not lilac
  col *= 0.85 + 0.3*mix(0.5, rayVar, ray) + 0.12*(vnoise(vec2(q1*1.3, s*9.0 + uSeed)) - 0.5);
  float blueAmt = max(1.0 - redAmt, whiteAmt*0.6);

  // Edge: pale blue-white band, then a comb of bare ray tips continuing the rays
  float rim = smoothstep(edge - 0.14, edge - 0.02, s)*(0.3 + 0.7*vnoise(vec2(a*uRays*0.45, s*7.0 + uSeed)));
  col = mix(col, mix(uPale, uBlue*1.3, 0.45 + 0.4*ray), rim*mix(0.6, 0.2, uLead));
  float membraneEdge = edge - 0.025 + 0.02*(1.0 - smoothstep(0.0, 0.45/branches, abs(d)));   // membrane recedes between tips
  float gap = floor(q1);
  float split = step(0.96, hash11(gap*1.37 + uSeed*7.1))*(0.03 + 0.07*hash11(gap + uSeed));
  membraneEdge -= split*(1.0 - smoothstep(0.1, 0.45, abs(fract(q1) - 0.5)));        // torn membrane, bare rays
#if FIN == 4
  // Pelvic trailing edge: most gaps between rays tear open part-way out, so the membrane ends in long
  // separate strands, each a tapering, wavering ribbon around its ray that stops at its own length.
  float rn = floor(q1 + 0.5);
  float splitAt = hash11(gap*2.31 + uSeed*3.7) < 0.3 ? 0.97 : mix(0.40, 0.78, hash11(gap*0.7 + uSeed));
  float strandEnd = mix(0.78, 1.0, hash11(rn*1.9 + uSeed*2.3));
  float into = clamp((s - splitAt)/max(strandEnd - splitAt, 0.02), 0.0, 1.0);
  float wob = 0.14*into*sin(s*16.0 + hash11(rn + uSeed)*6.28 + uTime*0.7);
  float halfW = 0.5*pow(1.0 - into, 0.7);
  float strand = 1.0 - smoothstep(halfW - fw, halfW + fw, abs(q1 - rn + wob));
  float mem4 = mix(1.0, strand, step(splitAt, s))*(1.0 - smoothstep(strandEnd - 0.03, strandEnd, s));
#endif
  float membrane = 1.0 - smoothstep(membraneEdge - 0.008, membraneEdge, s);
  float tips = ray*(1.0 - smoothstep(membraneEdge, max(tipEnd, membraneEdge + 0.004), s))*step(membraneEdge - 0.01, s);

  // Opacity: sheer membrane thinning outward, dense rays
  float memA = mix(0.82, 0.50, smoothstep(0.15, 0.85, s))*uOpacity;
  float sideEdge = smoothstep(0.0, 0.012, a)*smoothstep(1.0, 0.975, a);
  float alpha = max(mix(memA, min(0.95, uOpacity*1.6), ray)*membrane, tips*0.9)*mix(1.0, sideEdge, uSideFade);
#if FIN < 3
  // Combed-silk fibres: crisp stripes along the rays at three widths, each with its own pigment,
  // width and brightness. Every stripe is box-filtered over the pixel footprint, so it stays sharp
  // where it is resolved and averages cleanly to its mean where it is not.
  float fq = q1 + 0.25*(vnoise(vec2(q1*1.3 + uSeed, s*2.5)) - 0.5);          // fibres wander a little
  float fwq = max(fwidth(fq), 1e-4);
  // bundles, about five per primary ray: each leans red or blue
  float hA = fibre(vnoise(vec2(fq*5.0, s*1.8 + uSeed)), 0.5, 0.5, fwq*5.0);
  // thin fibres of irregular width, parted by fine dark lines
  float kB = 1.0 - smoothstep(0.4, 1.0, fwq*9.0);
  float gapB = max(fibreLines(fq, s, fwq, 4.0, uSeed, 0.035), 0.7*fibreLines(fq, s, fwq, 2.5, uSeed + 7.0, 0.03));
  float hB = vnoise(vec2(fq*9.0 + 5.0, s*2.0));
  // hair: fine bright silver fibres, in some places and not others
  float hairC = fibreLines(fq, s, fwq, 5.0, uSeed + 3.0, 0.025)*smoothstep(0.35, 0.65, vnoise(vec2(fq*1.5 + 9.0, s*2.5)));
  float fibCol = fibreBands(fq, s, fwq, 5.0, uSeed + 5.0);   // fibre by fibre, red or blue
  float F = 0.6*hairC - 0.4*gapB;
  // Pigment comes in broad zones that blend over long distances: steel blue at the base and in the
  // centre, a band of blood red through the mid-fan, a wide aqua fringe. In the zones' borders the
  // fibres interleave; inside a zone they vary in tone, and only a rare streak takes the other colour.
  float zoneN = vnoise(vec2(a*2.5 + uSeed, s*1.1 + 2.0));
  float along = vnoise(vec2(fq*1.2 + 4.0, s*1.6 + uSeed));
  float zone = 0.8*smoothstep(0.12, 0.62, s)*(1.0 - 0.45*smoothstep(0.7, 0.98, s))
             + 0.5*(zoneN - 0.5) + 0.6*(vnoise(vec2(q1*0.13 + 3.0, s*1.2 + uSeed)) - 0.5)
             + 0.3*(vnoise(vec2(q1*0.45 + 8.0, s*2.2 + uSeed)) - 0.5) + uRedBias - 0.07 - 0.7*nearBody;
#if FIN == 0
  zone += 0.3*(0.5 - a);                                           // the lower rear of the fan is redder
#elif FIN == 1
  zone += 0.30*smoothstep(0.70, 0.88, a)*smoothstep(0.35, 0.8, s);  // the flaps keep the mid-fan pigment out to their tips
#endif
  float pig = zone + 0.32*(fibCol - 0.5) + 0.14*(hA - 0.5);
  float pw = max(fwidth(pig), 0.01);
  redAmt = mix(smoothstep(0.42, 0.58, pig), smoothstep(0.5 - pw, 0.5 + pw, pig), 0.6);
  float flip = fibreBands(fq, s, fwq, 6.0, uSeed + 13.0)*smoothstep(0.74, 0.86, vnoise(vec2(fq*0.6 + 2.0, s*2.0 + uSeed)));
  redAmt = mix(redAmt, 1.0 - redAmt, 0.85*flip);                  // the odd contrasting streak
  whiteAmt = 0.0;
  vec3 deepRed = uRed*mix(vec3(0.42, 0.40, 0.75), vec3(0.62, 0.72, 0.9), hB);
  vec3 steel = mix(vec3(0.018, 0.065, 0.14), vec3(0.04, 0.13, 0.22), along)*mix(1.0, 0.6, smoothstep(0.4, 0.05, s));
  vec3 aqua = mix(vec3(0.08, 0.30, 0.42), vec3(0.28, 0.55, 0.65), fibreBands(fq, s, fwq, 4.5, uSeed + 17.0));
  vec3 silver = vec3(0.50, 0.70, 0.78);
  col = mix(steel, deepRed, redAmt);
  // the wide aqua fringe, reaching further in along some bundles than others
  rim = smoothstep(edge - 0.24, edge - 0.03, s + 0.1*(zoneN - 0.5) + 0.06*(along - 0.5) + 0.06*(fibCol - 0.5));
#if FIN == 1
  // the hanging rear flaps are the same tissue as the rest of the dorsal: full colour zones, denser,
  // with only a thin pale fringe at the very tip
  float flapZ = smoothstep(0.70, 0.88, a);
  rim *= 1.0 - flapZ*(1.0 - smoothstep(edge - 0.06, edge - 0.015, s));
#endif
  col = mix(col, aqua, rim*0.8);
  // fibres: lighter and darker versions of the zone's hue
  col *= mix(1.0, 0.3, gapB)*(0.7 + 0.55*fibreBands(fq, s, fwq, 3.5, uSeed + 9.0));
  col = mix(col, col*1.7 + vec3(0.04, 0.06, 0.07), hairC*(0.5 + 0.3*s)*(1.0 - nearBody));
  float layer = vnoise(vec2(a*4.0 + 2.0*uSeed, s*2.5 + 1.0));
  col *= 0.85 + 0.3*layer;
#if FIN == 0
  // at the peduncle a few thick rays run under the scaled skin before they fan out: no starburst
  float root = 1.0 - smoothstep(0.04, 0.24, s);
  col = mix(col, steel*(0.85 + 0.4*smoothstep(0.2, -0.2, abs(fract(a*uRays*0.25 + 0.3*(vnoise(vec2(a*8.0, s*4.0)) - 0.5)) - 0.5) - 0.25)), 0.85*root);
  // where it leaves the stalk the root is skin-covered and takes the peduncle's colour, so the stalk's
  // ragged end blends into it instead of standing out as a comb of spikes
  float skinRoot = (1.0 - smoothstep(0.07, 0.15, s + 0.03*(vnoise(vec2(a*uRays*0.5, 2.0)) - 0.5)))*(1.0 - smoothstep(0.30, 0.45, abs(a - 0.5)));
  col = mix(col, SKIN_ROOT*(0.85 + 0.3*vnoise(vec2(a*uRays*0.6, s*12.0))), skinRoot);
#endif
  blueAmt = max(1.0 - redAmt, rim)*(0.1 + 0.15*layer);
  nearBody *= 0.5;
  // Root band: a short way out from the body the membrane is thick and fleshy, carried on a few broad
  // ray bases that only split into fine fibres further out. Its colour shifts toward the body's: a deep
  // iridescent steel blue at the caudal and dorsal roots, a warmer red-violet at the anal root.
#if FIN == 0
  float bandW = 0.16 + 0.07*vnoise(vec2(a*7.0, uSeed + 1.0));
#else
  float bandW = 0.08 + 0.07*vnoise(vec2(a*9.0, uSeed + 1.0));
#endif
  float band = 1.0 - smoothstep(bandW - 0.05, bandW + 0.03, s);
  float bq = a*uRays*0.35 + 0.4*(vnoise(vec2(a*5.0, uSeed + 8.0)) - 0.5);
  float fleshy = smoothstep(0.1, 0.5, abs(fract(bq) - 0.5));        // gaps between the broad ray bases
#if FIN == 2
  vec3 bandCol = mix(vec3(0.17, 0.035, 0.07), vec3(0.12, 0.04, 0.13), vnoise(vec2(a*6.0, s*8.0 + uSeed)));
#else
  vec3 bandCol = mix(vec3(0.025, 0.06, 0.17), vec3(0.045, 0.10, 0.24), vnoise(vec2(a*6.0, s*8.0 + uSeed)));
#endif
  bandCol *= mix(0.95, 0.45, fleshy)*(0.7 + 0.55*fibreBands(fq, s, fwq, 3.0, uSeed + 21.0))
           *(0.85 + 0.3*vnoise(vec2(bq*3.0, s*30.0 + uSeed)));   // fleshy bases, lightly striated
#if FIN == 0
  band *= 1.0 - skinRoot;
#endif
  col = mix(col, bandCol, 0.9*band);
  gapB *= 1.0 - band; hairC *= 1.0 - band;
  ray = mix(ray, 1.0 - fleshy, band);
  tube = mix(tube, clamp((fract(bq) - 0.5)*2.2, -1.0, 1.0), band);  // rounded, fleshy ray bases
#if FIN != 2
  blueAmt = mix(blueAmt, 0.22, band);                              // the iridescent sheen of the body
#endif

  // Margin: a crisp, lobed silhouette. Along stretches of it the membrane frays: the gaps between
  // fibres open up and fibres of uneven length run out past the rim as fine wisps.
  float sw = max(fwidth(s), 1e-5);
  float thin = smoothstep(edge - 0.03, edge, s);
  float fray = smoothstep(0.35, 0.75, vnoise(vec2(a*uRays*0.5, 3.3 + uSeed)));
  float solid = 1.0 - smoothstep(edge - sw, edge + sw, s);
  float hairEnd = edge + fray*mix(0.0103, 0.003 + 0.03*hB*hB, kB);
  float wisps = fibreBands(fq, s, fwq, 3.0, uSeed + 11.0)*(1.0 - smoothstep(hairEnd - sw, hairEnd + sw, s));
  membrane = max(solid*mix(1.0, 1.0 - gapB, fray*thin), 0.8*wisps)*(1.0 - 0.15*thin);
  tips = 0.0;
  col = mix(col, silver*1.2, smoothstep(edge - 0.025, edge + 0.01, s)*0.35);
  memA = mix(0.94, 0.84, smoothstep(0.15, 0.9, s))*(0.9 + 0.12*layer)*uOpacity;
#if FIN == 1
  memA = mix(memA, 0.97*uOpacity, flapZ);
#endif
  // soft, uneven side margins, so overlapping fins do not show hard straight borders
  float sideF = smoothstep(0.0, 0.006 + 0.014*vnoise(vec2(s*7.0, uSeed)), a)*smoothstep(1.0, 0.992 - 0.014*vnoise(vec2(s*7.0, uSeed + 3.0)), a);
#if FIN == 0
  sideF = mix(1.0, sideF, smoothstep(0.08, 0.25, s));              // no soft side edge at the root, where it meets the anal under the peduncle
#elif FIN == 2
  sideF *= 1.0 - smoothstep(0.93, 0.99, a)*(1.0 - smoothstep(0.05, 0.25, s));   // the rear corner of the base thins into the caudal root
#endif
  alpha = mix(memA, min(0.95, memA + 0.12), ray)*membrane*mix(1.0, sideF, uSideFade);
  alpha = mix(alpha, max(alpha, 0.97*membrane*mix(1.0, sideF, uSideFade)), band);   // thick at the root

  // Blemishes, sparse and different on every fin. The damage is on the rim: a couple of splits
  // between rays, a few rays broken short with the membrane torn back beside them, one thinned and
  // curled tip. On the membrane only faint things: clearer windows, tiny pinholes, fine melanophores
  // and a gentle unevenness in thickness that never darkens it.
  float gi = floor(q1);
  float splitD = step(0.93, hash11(gi*1.37 + uSeed*5.0))*(0.07 + 0.16*hash11(gi*0.61 + uSeed));
  float splitW = 0.12*smoothstep(edge - splitD, edge, s);
  alpha *= 1.0 - step(0.001, splitD)*step(edge - splitD, s)*(1.0 - smoothstep(splitW - fw, splitW + fw, abs(fract(q1) - 0.5)));
  float shortAt = edge - (0.03 + 0.08*hash11(n1*0.37 + uSeed*2.0));
  float shortR = step(0.92, hash11(n1*1.77 + uSeed))*smoothstep(shortAt - 0.004, shortAt + 0.004, s);
  alpha *= 1.0 - shortR*(0.9 - 0.9*smoothstep(0.28, 0.42, abs(q1 - n1)));   // torn back along the broken ray
  float tipW = exp(-pow((a - (0.2 + 0.6*hash11(uSeed*4.1)))/0.035, 2.0));
  alpha *= 1.0 - 0.65*tipW*smoothstep(edge - 0.08, edge - 0.01, s);
  col = mix(col, silver*1.2, 0.3*tipW*exp(-pow((s - edge + 0.04)/0.005, 2.0)));   // the curl's fold catches the light
  float win = smoothstep(0.85, 0.93, vnoise(vec2(a*6.0 + uSeed*3.0, s*5.0 + 1.0)))*smoothstep(0.2, 0.3, s);
  col = mix(col, mix(col, aqua, 0.5)*1.1, 0.5*win);                // a clearer window: pigment thins out
  alpha *= 1.0 - 0.25*win;
  vec2 ph = pinhole(vec2(a*uRays*0.9, s*28.0), uSeed)*smoothstep(0.25, 0.3, s)*(1.0 - smoothstep(edge - 0.08, edge - 0.04, s));
  alpha *= 1.0 - 0.5*ph.x;
  col = mix(col, silver, 0.15*ph.y);
  float mel = specks(vec2(a*uRays*12.0, s*380.0), uSeed, 0.5*smoothstep(0.72, 0.9, vnoise(vec2(a*9.0 + uSeed, s*7.0))));
  col = mix(col, col*vec3(0.55, 0.35, 0.3) + vec3(0.03, 0.005, 0.0), 0.6*mel);   // red-brown, within the local colour
  float dens = vnoise(vec2(a*uRays*0.35 + uSeed, s*6.0));
  alpha *= 0.92 + 0.16*dens;
  col *= 0.96 + 0.1*dens;
#endif
#if FIN == 4
  // deep blood red, darker between the rays so they read
  col = mix(col*vec3(0.85, 0.45, 0.5), vec3(0.40, 0.012, 0.025), 0.55)*mix(0.7, 1.2, ray);
  // the leading spine: thick and dense, red at the root and whitening toward its tip
  float spine = 1.0 - smoothstep(0.0, 0.08, 1.0 - a);
  col = mix(col, mix(uRed*vec3(1.1, 0.8, 0.8), uPale*1.3, smoothstep(0.35, 0.95, s)), spine);
  mem4 = max(mem4, spine*(1.0 - smoothstep(0.97, 1.0, s)));
  alpha = mix(memA, min(0.95, uOpacity*1.6), ray)*mem4;
  alpha = max(alpha, 0.95*spine*(1.0 - smoothstep(0.97, 1.0, s)));
  ray = max(ray*mem4, spine);
  tube = mix(tube, clamp((a - 0.96)/0.04, -1.0, 1.0), spine);
  // the rearmost ray frays into the water rather than ending on a clean line
  alpha *= smoothstep(0.0, 0.05 + 0.06*vnoise(vec2(s*14.0, uSeed)), a);
  // fleshy root: carries the belly's colour out over the lobe
  float flesh = 1.0 - smoothstep(0.12, 0.36, s + 0.04*(vnoise(vec2(a*9.0, uSeed)) - 0.5));
  col = mix(col, mix(vec3(0.018, 0.024, 0.055), vec3(0.20, 0.02, 0.03), smoothstep(0.14, 0.30, s)), flesh);
  alpha = max(alpha, 0.94*flesh);
  ray *= 1.0 - 0.7*flesh;
  // red pelvic membrane has little structural blue: keep the iridescent film off it and its root
  nearBody = 0.0; blueAmt *= 0.3;
  // blemishes: a pinhole or two, clustered melanophores, uneven thickness
  vec2 ph4 = pinhole(vec2(a*uRays*1.5, s*24.0), uSeed)*smoothstep(0.35, 0.45, s)*(1.0 - smoothstep(0.8, 0.9, s))*(1.0 - spine);
  alpha *= 1.0 - 0.5*ph4.x;
  col = mix(col, col*vec3(0.55, 0.35, 0.3), 0.6*specks(vec2(a*uRays*8.0, s*300.0), uSeed, 0.5*smoothstep(0.72, 0.9, vnoise(vec2(a*5.0 + uSeed, s*5.0)))));
  col = mix(col, uPale, 0.3*ph4.y);
  alpha *= 0.92 + 0.16*vnoise(vec2(a*6.0 + uSeed, s*6.0));
#endif
#if FIN == 3
  // Clear, nearly colourless membrane on thin milky rays, with a soft, slightly uneven margin
  // instead of a comb of bare tips. The root is the pale flesh of the pad.
  float pEdge = uEdge + 0.05*(vnoise(vec2(a*6.0, uSeed)) - 0.5) + 0.05*(vnoise(vec2(a*23.0, uSeed + 2.0)) - 0.5) + 0.02*sin(a*47.0 + uSeed);
  float pMem;
  // soft ray bundles of uneven width that fork twice toward the tip, curving a little toward the leading edge
  float pq = a*uRays + 0.30*(vnoise(vec2(a*5.0 + uSeed, s*1.5)) - 0.5) - 0.9*s*s*(1.0 - 0.6*a);
  float pn = floor(pq + 0.5), pd = pq - pn;
  float pf = smoothstep(0.0, 0.12, s - 0.52 - 0.14*hash11(pn + uSeed));
  pd -= sign(pd)*0.25*pf;
  float pn2 = pn*2.0 + step(0.0, pd);
  float pf2 = smoothstep(0.0, 0.08, s - 0.76 - 0.10*hash11(pn2 + uSeed*1.7))*pf;
  pd -= sign(pd)*0.125*pf2;
  float pb = 1.0 + pf + 2.0*pf2;                           // branches from this primary ray
  float pfw = fwidth(pq);
  float prw = mix(0.13, 0.09, s)*(0.6 + 0.8*hash11(pn*3.1 + uSeed))/sqrt(pb);   // bundles differ in width
  resolved = 1.0 - smoothstep(0.35, 0.8, pfw*pb);
  float halo = 1.0 - smoothstep(0.0, prw*2.5 + 0.16/pb + pfw, abs(pd));     // soft milky sheath around each bundle
  ray = mix(min(2.0*prw*pb, 1.0), max(1.0 - smoothstep(0.4*prw - pfw, 1.4*prw + pfw, abs(pd)), 0.75*halo), resolved);   // soft-edged cores
  // streaky white wisps run along the rays and merge the sheaths into a haze
  float wisp = smoothstep(0.35, 0.8, streak(vec2(pq*1.1 + uSeed*2.0, s*2.2)));
  ray *= (0.5 + 0.5*hash11(pn2*2.7 + uSeed))*(0.75 + 0.35*wisp);
  tube = clamp(pd/prw, -1.0, 1.0)*resolved;
  // frilled margin: the membrane scallops back between the ray tips, which run on a little past it
  float scallop = 1.0 - smoothstep(0.0, 0.45, abs(pd));
  pMem = 1.0 - smoothstep(pEdge - 0.05, pEdge, s + 0.025*(1.0 - scallop));
  float pTip = scallop*(1.0 - smoothstep(pEdge - 0.01, pEdge + 0.012, s));
  // milky, icy aqua rays, densest at the base and along the leading rays; a near-clear aqua membrane;
  // a warm blush where the root meets the red throat
  float milk = (1.0 - 0.5*smoothstep(0.25, 0.95, s))*(0.65 + 0.55*smoothstep(0.35, 1.0, a));   // whitest on the upper, leading rays
  col = mix(mix(vec3(0.16, 0.58, 0.85), vec3(0.62, 0.90, 0.98), clamp(wisp*milk, 0.0, 1.0)), mix(vec3(0.40, 0.86, 0.97), vec3(0.90, 0.99, 1.0), clamp(milk, 0.0, 1.0)), ray);
  float blush = (1.0 - smoothstep(0.12, 0.52, s + 0.10*(vnoise(vec2(a*4.0, s*3.0 + uSeed)) - 0.5)))*(0.6 + 0.4*(1.0 - a));
  col = mix(col, mix(vec3(0.60, 0.06, 0.08), vec3(0.85, 0.24, 0.26), ray), blush*0.95);
  float flesh = 1.0 - smoothstep(0.0, 0.17, s + 0.04*(vnoise(vec2(a*8.0, uSeed)) - 0.5));
  col = mix(col, mix(vec3(0.34, 0.12, 0.13), vec3(0.42, 0.22, 0.24), vnoise(vec2(a*5.0, s*9.0 + uSeed))), flesh);
  float haze = 0.03 + (0.07 + 0.18*smoothstep(0.4, 1.0, a))*wisp*(1.0 - 0.4*s)
              + 0.10*(1.0 - smoothstep(0.15, 0.55, s));   // milky near the base
  alpha = max(mix(haze + 0.25*blush, 0.7*milk, ray)*pMem, 0.12*ray*pTip)*smoothstep(0.0, 0.10, a);   // the lowest rays fade into the water
  alpha = max(alpha, 0.9*flesh*flesh*smoothstep(0.0, 0.3, a)*smoothstep(1.0, 0.8, a));
  tube *= 1.0 - flesh;
  ray *= 1.0 - flesh;
  rim = 0.0; nearBody = 0.0; blueAmt = 0.25*ray*(1.0 - blush);   // faint aqua iridescence on the rays
  // blemishes: a few dark melanophore specks on the rays, uneven haze
  col = mix(col, col*vec3(0.6, 0.45, 0.4), 0.5*specks(vec2(a*uRays*8.0, s*260.0), uSeed, 0.4*smoothstep(0.72, 0.9, vnoise(vec2(a*5.0 + uSeed, s*4.0))))*(1.0 - flesh));
  alpha *= 0.92 + 0.16*vnoise(vec2(a*7.0 + uSeed, s*5.0));
#endif

  // Root contact: fins are denser and darker where they meet the body
  float contact = 1.0 - smoothstep(0.0, FIN == 0 ? 0.07 : 0.14, s);   // the caudal root is skin-covered: little contact darkening
  alpha = mix(alpha, min(1.0, alpha*1.2 + 0.05), contact);

  vec3 V = normalize(cameraPosition - vW);
  vec3 N = normalize(vN);
  if (dot(N, V) < 0.0) N = -N;
  vec3 Ta = normalize(vTa - N*dot(vTa, N));
  vec3 Nr = normalize(N + Ta*tube*0.5*ray);                        // rounded rays
  float NoV = max(dot(N, V), 0.02);
  // a membrane seen at a grazing angle is a longer optical path: denser and more saturated
  float path = min(1.0/max(NoV, 0.2), uPathMax);
  float aEff = 1.0 - pow(1.0 - clamp(alpha, 0.0, 0.999), path);
  vec3 albedo = pow(max(col, 1e-4), vec3(1.0 + 0.12*(path - 1.0)));
  float valley = (1.0 - 0.6*smoothstep(0.3, -0.9, vFold)*smoothstep(0.05, 0.4, s))*(1.0 + 0.3*smoothstep(0.4, 1.0, vFold));

  // Key visibility: the body's soft shadow, contact darkening at the root, deeper peel layers sitting
  // behind other fin layers (the key comes from the camera side), and a broad light from above that
  // leaves the lower parts of the fins a little darker.
  float peelShade = 1.0 - 0.1*min(uPeel, 3.0)*smoothstep(-0.2, 0.6, dot(V, KEY_DIR));
  float topDown = mix(0.78, 1.06, smoothstep(-0.55, 0.3, vW.y - uSP[10].y))*mix(0.6, 1.0, vShadow.y);
  float keyVis = mix(0.3, 1.0, vShadow.x)*peelShade*topDown*(1.0 - 0.35*contact);
  vec3 keyC = KEY_COL*keyVis;
  // pleats: facets turned toward the key pass and scatter more of it than facets turned away
  float pleatK = valley*mix(0.5, 1.25, smoothstep(0.1, 0.75, abs(dot(N, KEY_DIR))));
  vec3 lit = AMBIENT*albedo*2.0*(0.7 + 0.3*topDown)*(1.0 - 0.4*contact);
  vec3 Ls[3]; Ls[0] = KEY_DIR; Ls[1] = FILL_DIR; Ls[2] = RIM_DIR;
  vec3 Cs[3]; Cs[0] = keyC; Cs[1] = FILL_COL*(1.0 - 0.3*contact); Cs[2] = RIM_COL;
  vec3 transCol = pow(albedo, vec3(1.3))*2.2;
  for (int i = 0; i < 3; i++){
    float ndl = dot(Nr, Ls[i]);
    lit += Cs[i]*albedo*max(ndl, 0.0)*0.6*valley;
    lit += Cs[i]*transCol*max(-dot(N, Ls[i]), 0.0)*uTrans*(1.0 - 0.6*ray)*(i == 2 ? mix(1.0, pleatK, 0.6) : pleatK);
    lit += Cs[i]*specLobe(Nr, V, Ls[i], vec3(0.04), 0.5)*(0.03 + 0.07*seg*ray);   // membrane is nearly matte
  }
  lit += RIM_COL*transCol*pow(max(dot(-V, RIM_DIR), 0.0), 3.0)*0.6*uTrans;
  lit += (keyC + RIM_COL)*albedo*0.08*uTrans*pleatK;                    // thin tissue scatters light in every direction
  // structural blue: iridescent reflection that shifts with the viewing angle
  vec3 film = 0.5 + 0.5*cos(2.0*PI*(vec3(0.0, 0.33, 0.67) + NoV*0.9 + s*0.6 + st));
  vec3 irid = mix(vec3(0.06, 0.34, 1.0), vec3(0.20, 0.30, 1.0), film.x) + vec3(0.0, 0.30, 0.25)*film.y;
  vec3 Rr = reflect(-V, Nr);
  lit += envLight(Rr, 0.35)*irid*F_Schlick(vec3(0.25), max(dot(Nr, V), 0.0))*(blueAmt*(0.5 + 0.5*ray) + nearBody)*(1.0 - rim*0.5)*0.6;
  // glitter: tiny guanine platelets on the rays that catch the light individually
  vec2 gcell = floor(vec2(q1*3.0*branches, s*260.0));
  float g = hash21(gcell + uSeed);
  vec3 gN = normalize(Nr + (vec3(hash21(gcell + 1.3), hash21(gcell + 2.7), hash21(gcell + 4.1)) - 0.5)*0.9);
  lit += keyC*specLobe(gN, V, KEY_DIR, vec3(0.3), 0.12)*step(0.82, g)*ray*(0.3 + blueAmt)*resolved*0.12*(FIN == 3 ? 0.0 : 1.0);
  lit += envLight(reflect(-V, N), 0.5)*F_Schlick(vec3(0.02), NoV)*0.12;   // a soft sheen only at grazing angles
#if FIN < 3
  // silk: a sheen along the fibres, and light carried through the thin membrane toward the eye
  vec3 Tf = normalize(cross(N, Ta));
  float tk = dot(Tf, normalize(V + KEY_DIR));
  float sheen = pow(max(1.0 - tk*tk, 0.0), 30.0);
  lit += keyC*sheen*(0.02 + 0.06*clamp(F + 0.5, 0.0, 1.0))*(vec3(0.05) + albedo*2.5)*(0.3 + 0.7*(1.0 - NoV)*(1.0 - NoV));
  lit += (keyC + RIM_COL)*albedo*(0.02 + 0.10*rim)*pleatK;
#endif
#if FIN == 3
  // milky rays and a clear membrane scatter light toward the eye from any side, so the fin never reads dark
  lit += (keyC*0.6 + RIM_COL*0.4 + FILL_COL)*albedo*(0.6 + 1.5*ray)*(1.0 - flesh);
#endif

#if FIN == 4 || FIN == 3
  // the root is opaque flesh like the belly: no light through it, no iridescent film
  vec3 fleshLit = AMBIENT*albedo*2.0 + KEY_COL*albedo*max(dot(Nr, KEY_DIR), 0.0)*0.5 + FILL_COL*albedo*max(dot(Nr, FILL_DIR), 0.0)*0.6
                + RIM_COL*albedo*0.15 + KEY_COL*specLobe(Nr, V, KEY_DIR, vec3(0.04), 0.35)*0.3;
  lit = mix(lit, fleshLit, flesh);
#endif
#if FIN == 4
  // the pelvic root is matte like the belly skin beside it: only a faint, broad sheen
  lit -= flesh*KEY_COL*specLobe(Nr, V, KEY_DIR, vec3(0.04), 0.35)*0.24;
#endif
  // the body also blocks the broad overhead light and the water's scattered light beneath it, and
  // the pleats alternate light and dark in everything the membrane scatters
  lit *= mix(0.5, 1.0, vShadow.y)*(1.0 - 0.25*contact)*mix(1.0, pleatK, 0.35);
  if (aEff < 0.004) discard;
  // uGlow: light scattered by a clear membrane that absorbs almost nothing behind it
  float coverage = alpha > 0.004 ? 1.0 : 0.0;
  gl_FragColor = vec4(display(lit)*(aEff + uGlow*coverage*(0.25 + 0.75*ray)), aEff);
#if FIN == 3
  // milky rays scatter light toward the eye; the clear membrane only faintly: a cool film, never a grey disc
  gl_FragColor.rgb = display(lit)*(aEff + uGlow*coverage*(0.3 + 3.2*ray*milk)*max(pMem, pTip));
#endif
}`;

// ---------------------------------------------------------------------------
// Food: dry pellets, lit like the fish and drawn with it in the opaque pass, so they take the
// fins' depth peeling and the lens's depth of field.
// ---------------------------------------------------------------------------
export const PELLET_VERT = /* glsl */`
attribute vec3 aPellet;   // per pellet: tint seed, wetness 0..1, how whole it still is 0..1
varying vec3 vW, vN, vO, vPellet;
void main(){
  vec4 w = modelMatrix*instanceMatrix*vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix*instanceMatrix)*normal);   // the pellets are only mildly stretched
  vO = position;
  vPellet = aPellet;
  gl_Position = projectionMatrix*viewMatrix*w;
}`;

export const PELLET_FRAG = GLSL_COMMON + /* glsl */`
varying vec3 vW, vN, vO, vPellet;
void main(){
  vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
  // pressed meal: brown-red, flecked darker and paler, darkening as it soaks
  float grain = 0.6*vnoise(vO.xy*7.0 + vPellet.x*31.0) + 0.4*vnoise(vO.yz*19.0 + 5.0);
  vec3 albedo = mix(vec3(0.13, 0.035, 0.018), vec3(0.30, 0.10, 0.045), grain)*(0.85 + 0.3*vPellet.x);
  albedo *= mix(1.0, 0.7, vPellet.y)*vPellet.z;   // and dims away as it dissolves
  vec3 col = AMBIENT*albedo;
  vec3 Ls[3]; Ls[0] = KEY_DIR; Ls[1] = FILL_DIR; Ls[2] = RIM_DIR;
  vec3 Cs[3]; Cs[0] = KEY_COL; Cs[1] = FILL_COL; Cs[2] = RIM_COL;
  for (int i = 0; i < 3; i++){
    col += Cs[i]*albedo*max((dot(N, Ls[i]) + 0.2)/1.2, 0.0);
    col += Cs[i]*specLobe(N, V, Ls[i], vec3(0.02 + 0.02*vPellet.y), mix(0.7, 0.45, vPellet.y))*vPellet.z;
  }
  gl_FragColor = vec4(display(col), 1.0);
}`;

// Composites the opaque pass and the peeled fin layers front to back, averaging the supersamples.
// Alpha carries the signed circle of confusion (0.5 = in focus) for the depth-of-field gather.
export const COMPOSITE_FRAG = /* glsl */`
uniform sampler2D uOpaque, uL0, uL1, uL2, uL3, uRest, uOpaqueZ, uL0Z;
uniform int uSS;
uniform vec3 uLens;   // focus distance, CoC scale (px), max CoC (px)
uniform vec2 uClip;   // camera near, far
vec3 over(vec4 l, vec3 c){ return l.rgb + (1.0 - l.a)*c; }
float coc(float d){
  float z = uClip.x*uClip.y/(uClip.y - d*(uClip.y - uClip.x));
  return clamp(uLens.y*(z - uLens.x)/z, -uLens.z, uLens.z);
}
void main(){
  ivec2 base = ivec2(gl_FragCoord.xy)*uSS;
  vec3 sum = vec3(0.0);
  float aF = 0.0;
  for (int j = 0; j < uSS; j++) for (int i = 0; i < uSS; i++){
    ivec2 p = base + ivec2(i, j);
    vec3 c = texelFetch(uOpaque, p, 0).rgb;
    c = over(texelFetch(uRest, p, 0), c);
    c = over(texelFetch(uL3, p, 0), c);
    c = over(texelFetch(uL2, p, 0), c);
    c = over(texelFetch(uL1, p, 0), c);
    vec4 l0 = texelFetch(uL0, p, 0);
    aF += l0.a;
    c = over(l0, c);
    sum += c;
  }
  aF /= float(uSS*uSS);
  // Depth that dominates the pixel: the nearest fin sheet where it covers, else the body, else
  // the far black background (which counts as maximally defocused, so it never smears onto the fish).
  float dO = texelFetch(uOpaqueZ, base, 0).r, dF = texelFetch(uL0Z, base, 0).r;
  float cO = dO < 1.0 ? coc(dO) : uLens.z;
  float cF = dF < 1.0 ? coc(dF) : cO;
  float c = mix(cO, cF, dO < 1.0 ? smoothstep(0.0, 0.6, aF) : step(0.004, aF));
  gl_FragColor = vec4(sum/float(uSS*uSS), 0.5 + 0.5*c/uLens.z);
}`;

// ---------------------------------------------------------------------------
// Camera: suspended particles, lens and sensor
// ---------------------------------------------------------------------------
export const POST_VERT = 'varying vec2 vUv; void main(){ vUv = position.xy*0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }';
export const POST_COMMON = /* glsl */`
varying vec2 vUv;
uniform float uFrame;
float hash12(vec2 p){ vec3 q = fract(vec3(p.xyx)*0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y)*q.z); }
float ign(vec2 p){ return fract(52.9829189*fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

// Faint specks drifting in the tank. Each is a disc sized by its own circle of confusion, dimmed by
// area so defocus spreads rather than adds light, lit only inside the key light's beam, and hidden
// behind the body (opaque depth) or behind the fins in proportion to their coverage.
export const MOTE_VERT = /* glsl */`
attribute vec4 aSeed;
uniform float uTime, uPx;
uniform vec3 uLens;
varying float vGain;
varying float vSize;
#define KEY_DIR normalize(vec3(-0.35, 0.80, 0.85))
void main(){
  vec3 lo = vec3(-3.2, -1.9, -2.8), span = vec3(6.4, 3.8, 4.6);
  vec3 drift = vec3(0.010, -0.006, 0.004) + 0.008*vec3(sin(aSeed.w*7.1), cos(aSeed.w*5.3), sin(aSeed.w*3.7));
  vec3 p = lo + mod(aSeed.xyz*span + drift*uTime + 0.03*sin(uTime*vec3(0.13, 0.11, 0.17) + aSeed.w*20.0), span);
  vec4 v = modelViewMatrix*vec4(p, 1.0);
  float z = -v.z;
  gl_Position = projectionMatrix*v;
  // key light: a broad beam from upper front through the tank centre
  vec3 q = p - vec3(0.0, 0.0, -0.3);
  float off = length(q - KEY_DIR*dot(q, KEY_DIR));
  float lit = 0.25 + 0.75*exp(-off*off/3.0);
  float coc = abs(uLens.y*(z - uLens.x)/max(z, 1e-3));
  float size = clamp(uPx*(0.9 + 0.8*fract(aSeed.w*13.0)) + 2.0*coc, 1.5, 64.0);
  vSize = size;
  gl_PointSize = size;
  float bright = 0.22 + 0.5*pow(fract(aSeed.w*91.0), 3.0);
  vGain = bright*lit*smoothstep(0.35, 0.9, z)*uPx*uPx*2.5/(size*size);
}`;
export const MOTE_FRAG = /* glsl */`
uniform sampler2D uOpaqueZ, uL0Z, uL0;
uniform int uSS;
varying float vGain;
varying float vSize;
void main(){
  vec2 d = gl_PointCoord*2.0 - 1.0;
  float r = dot(d, d);
  float disc = smoothstep(1.0, 1.0 - min(0.9, 3.0/vSize), sqrt(r));
  if (disc <= 0.0) discard;
  ivec2 p = ivec2(gl_FragCoord.xy)*uSS;
  float z = gl_FragCoord.z;
  if (z > texelFetch(uOpaqueZ, p, 0).r) discard;
  float fin = z > texelFetch(uL0Z, p, 0).r ? texelFetch(uL0, p, 0).a : 0.0;
  gl_FragColor = vec4(vec3(0.85, 0.9, 1.0)*vGain*disc*(1.0 - fin), 0.0);
}`;

// Quarter-resolution bright pass for halation; alpha keeps the largest non-background CoC nearby,
// so the full-resolution pass can skip the depth-of-field gather where everything is in focus.
export const DOWN_FRAG = POST_COMMON + /* glsl */`
uniform sampler2D uSrc;
uniform vec2 uTexel;   // source texel
void main(){
  vec3 c = vec3(0.0); float m = 0.0;
  ivec2 base = ivec2(gl_FragCoord.xy)*4, top = textureSize(uSrc, 0) - 1;
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++){
    vec4 s = texelFetch(uSrc, min(base + ivec2(i, j), top), 0);
    vec3 lin = s.rgb*s.rgb;
    c += lin*smoothstep(0.25, 0.85, luma(lin));
    float k = abs(s.a*2.0 - 1.0);
    m = max(m, k > 0.995 ? 0.0 : k);
  }
  gl_FragColor = vec4(c/16.0, m);
}`;
export const BLUR_FRAG = POST_COMMON + /* glsl */`
uniform sampler2D uSrc;
uniform vec2 uStep;
void main(){
  vec4 c0 = texture2D(uSrc, vUv);
  vec3 c = c0.rgb*0.227; float m = c0.a;
  float w[4]; w[0] = 0.194; w[1] = 0.121; w[2] = 0.054; w[3] = 0.016;
  for (int i = 0; i < 4; i++){
    vec4 a = texture2D(uSrc, vUv + uStep*float(i + 1)*1.4), b = texture2D(uSrc, vUv - uStep*float(i + 1)*1.4);
    c += (a.rgb + b.rgb)*w[i];
    m = max(m, max(a.a, b.a));
  }
  gl_FragColor = vec4(c, m);
}`;

// Full resolution: depth-of-field gather, then a short exposure blended with the last frame.
// A sample spreads onto this pixel if its own blur disc reaches it; a sample behind a sharper
// pixel is held back so an in-focus eye never picks up the blurred tail behind it. The history is
// clamped to the colours around this pixel now, so a fast fin leaves a short smear, not a ghost.
export const LENS_FRAG = POST_COMMON + /* glsl */`
uniform sampler2D uSrc, uTiles, uHist;
uniform vec2 uTexel;
uniform float uMaxCoc, uHistW;
void main(){
  vec4 c0 = texture2D(uSrc, vUv);
  vec3 col = c0.rgb;
  float R = texture2D(uTiles, vUv).a*uMaxCoc;
  if (R > 0.6){
    float cc = (c0.a*2.0 - 1.0)*uMaxCoc;
    vec3 acc = c0.rgb*c0.rgb; float wsum = 1.0;
    float rot = ign(gl_FragCoord.xy + uFrame*5.588)*6.2832;
    for (int i = 0; i < 16; i++){
      float t = (float(i) + 0.5)/16.0;
      float a = float(i)*2.39996 + rot;
      vec2 o = floor(vec2(cos(a), sin(a))*R*sqrt(t) + 0.5);   // whole-pixel offset, so the weight uses the true distance
      float r = length(o);
      vec4 s = texelFetch(uSrc, ivec2(gl_FragCoord.xy) + ivec2(o), 0);
      float cs = (s.a*2.0 - 1.0)*uMaxCoc;
      float w = r > 0.0 ? clamp(abs(cs) - r + 0.5, 0.0, 1.0) : 0.0;
      if (cs > cc) w *= clamp(abs(cc) - r + 0.5, 0.0, 1.0);
      acc += s.rgb*s.rgb*w; wsum += w;
    }
    col = sqrt(acc/wsum);
  }
  vec3 h = texture2D(uHist, vUv).rgb;
  vec3 n0 = texture2D(uSrc, vUv + vec2(3.0, 0.0)*uTexel).rgb, n1 = texture2D(uSrc, vUv - vec2(3.0, 0.0)*uTexel).rgb;
  vec3 n2 = texture2D(uSrc, vUv + vec2(0.0, 3.0)*uTexel).rgb, n3 = texture2D(uSrc, vUv - vec2(0.0, 3.0)*uTexel).rgb;
  vec3 lo = min(min(min(n0, n1), min(n2, n3)), col), hi = max(max(max(n0, n1), max(n2, n3)), col);
  gl_FragColor = vec4(mix(col, clamp(h, lo, hi), uHistW), 1.0);
}`;

// Output: halation, lateral chromatic aberration, vignette, and film-like grain. Every term
// multiplies the signal except a dither under one code value, so the black stays black.
export const OUTPUT_FRAG = POST_COMMON + /* glsl */`
uniform sampler2D uSrc, uGlow;
uniform float uAspect, uCA, uGlowGain, uGrain;
void main(){
  vec2 q = vUv - 0.5;
  vec2 ca = q*uCA*dot(q, q)*4.0;
  vec3 col = vec3(texture2D(uSrc, vUv + ca).r, texture2D(uSrc, vUv).g, texture2D(uSrc, vUv - ca).b);
  vec3 lin = col*col + texture2D(uGlow, vUv).rgb*uGlowGain;
  float r2 = dot(q*vec2(uAspect, 1.0), q*vec2(uAspect, 1.0))/(0.25*(uAspect*uAspect + 1.0));
  lin *= 1.0 - 0.16*smoothstep(0.1, 1.0, r2);
  col = sqrt(lin);
  vec2 g = gl_FragCoord.xy + fract(uFrame*vec2(0.618, 0.382))*1024.0;
  float n = hash12(g) + hash12(g + 71.3) - 1.0;
  col *= 1.0 + n*uGrain*mix(2.2, 0.8, sqrt(luma(col)));
  col += (hash12(g + 13.7) + hash12(g + 29.1) - 1.0)/255.0;
  gl_FragColor = vec4(col, 1.0);
}`;
