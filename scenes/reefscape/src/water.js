import { groundHeight, smoothstep } from './math.js';
import { TANK } from './layout.js';

export const waterTime={value:0};
export const SURFACE=TANK.surface;
// The lamp bank hangs over the tank, a little toward the front-left, so its light comes
// down nearly vertical: an overhang shades what is under it and the arch's passage is
// dark, which a lamp leaning in from the camera side can never show. The key light, its
// shadow map and the glitter the surface draws on the bed all take this one direction, so
// a shadow and the caustic line at its foot lean the same way, which is what stops the
// light reading as two unrelated patterns pasted onto one scene.
export const LAMP=(()=>{const l=Math.hypot(-2.2,13,2.0);return {x:-2.2/l,y:13/l,z:2.0/l};})();
// How far up that direction the lamp bank hangs: the key light's position, and the point
// the shafts in the water fan out from.
export const LAMP_RANGE=14.2;
// Surface ripples, at the actual aquarium depth (10 cm/unit), not ocean swell.
// omega² = g k tanh(kh). Pump circulation below is a separate forced flow.
const g=98.1,h=SURFACE;
// The two short components barely move the surface anyone sees at the top of frame,
// but they are what breaks the glitter on the bed into hand-sized cells instead of
// metre-wide washes, so they belong in the same dispersion-correct set.
export const WAVES=[
  {a:.009,k:2.1,angle:.18,phase:.3},
  {a:.007,k:2.85,angle:1.37,phase:1.7},
  {a:.005,k:4.05,angle:-.42,phase:.8},
  {a:.0017,k:6.9,angle:.92,phase:2.4},
  {a:.0009,k:9.6,angle:-1.15,phase:.55},
].map(w=>({...w,dx:Math.cos(w.angle),dz:Math.sin(w.angle),omega:Math.sqrt(g*w.k*Math.tanh(w.k*h))}));
// The set keeps its dispersion-correct shape but the glitter runs at a fifteenth of real
// time. At full speed a 30 cm ripple sweeps its cells across the bed at 70 cm/s, the
// flicker of a tank with a wavemaker on, and a third of that still read as far too fast on
// the running scene. The rate is tuned to how the glitter reads on a wallpaper watched for
// hours, not to any physical rate: the cells should drift over the coral, not flicker.
const RIPPLE_TIME=.066;
const n=x=>Number(x).toFixed(7);
// Two opposed circulation pumps. Slow alternating strength and a recirculating
// return path approximate wavemaker flow; no claim of solving Navier–Stokes.
const PULSES=[{amp:.25,omega:.88,phase:.2},{amp:.115,omega:.49,phase:1.8}];
function base(p,out){
  const y=Math.max(0,Math.min(h,p.y));
  const wall=Math.max(0,1-(p.x/9.65)**8),bed=.12+.88*smoothstep(0,.9,p.y-groundHeight(p.x,p.z));
  const horizontal=(.64+.36*Math.sin(Math.PI*y/h))*wall*bed;
  out.set(horizontal,.045*Math.sin(p.x*.30)*Math.sin(Math.PI*y/h),.12*Math.sin(p.x*.23+p.z*.37)*horizontal);
  return out;
}
export function currentAt(p,t,out){
  base(p,out);let drive=.10;
  for(const q of PULSES)drive+=q.amp*Math.cos(q.omega*t+q.phase);
  return out.multiplyScalar(drive);
}
export function responseAt(p,t,tau,out){
  base(p,out);let drive=.10;
  for(const q of PULSES)drive+=q.amp*Math.cos(q.omega*t+q.phase-Math.atan(q.omega*tau))/Math.sqrt(1+(q.omega*tau)**2);
  return out.multiplyScalar(drive);
}
// Same coefficients and analytic tau db/dt + b = u response as the CPU.
export const responseGLSL=`
float reefBed(vec2 p){return -.30+.12*sin(p.x*.49+p.y*.22)+.075*sin(p.y*.75-p.x*.25)+.25*exp(-((p.x-6.)*(p.x-6.)/17.+(p.y+1.)*(p.y+1.)/13.));}
vec2 reefResponse(vec3 p,float t,float tau){
  float y=clamp(p.y,0.,${n(h)});
  float boundary=(.12+.88*smoothstep(0.,.9,p.y-reefBed(p.xz)))*max(0.,1.-pow(p.x/9.65,8.));
  float profile=(.64+.36*sin(3.14159265*y/${n(h)}))*boundary;
  float drive=.10;
  ${PULSES.map(q=>`drive+=${n(q.amp)}*cos(${n(q.omega)}*t+${n(q.phase)}-atan(${n(q.omega)}*tau))/sqrt(1.+pow(${n(q.omega)}*tau,2.));`).join('\n')}
  return vec2(profile,.12*sin(p.x*.23+p.z*.37)*profile)*drive;
}`;
// Where the lamp's ray through p crossed the surface, and the curvature of a wave set
// there. The Hessian of the surface is what a ripple does to a bundle of rays: where its
// determinant with the lens arm falls to zero the bundle has folded onto itself, and that
// fold is the bright glitter line on the bed.
const lens=(waves,arm)=>`
  float hxx=0.,hzz=0.,hxz=0.;
  ${waves.map(w=>`{float curvature=-${n(w.a*w.k*w.k)}*sin(${n(w.k)}*dot(q,vec2(${n(w.dx)},${n(w.dz)}))-${n(w.omega)}*t+${n(w.phase)});hxx+=curvature*${n(w.dx*w.dx)};hzz+=curvature*${n(w.dz*w.dz)};hxz+=curvature*${n(w.dx*w.dz)};}`).join('\n')}
  float determinant=(1.-${arm}*hxx)*(1.-${arm}*hzz)-${arm}*${arm}*hxz*hxz;`;
const surfaceCrossing=`float depth=clamp(${n(h)}-p.y,.02,9.);vec2 q=p.xz+depth*vec2(${n(LAMP.x/LAMP.y)},${n(LAMP.z/LAMP.y)});`;
export const causticGLSL=`
vec3 reefIrradiance(vec3 p,float t){
  ${surfaceCrossing}
  t*=${n(RIPPLE_TIME)};
  // Surface ripples are small, but a point-like LED focuses them into glitter lines on the bed;
  // the factor stands in for that concentration.
  ${lens(WAVES,'(depth*1.2488)')}
  // Glitter lines: the fold where the ray map loses rank is a thin bright band, the rest a
  // mild dimming, as point-like LEDs draw on a tank bed.
  float focus=.84+4.40*pow(clamp(1.-abs(determinant)*1.35,0.,1.),3.4);
  // The bank sits over the front half of the tank, so the rear hardscape is lit at a slant
  // and through more water: it falls off toward the back wall instead of meeting it lit.
  float reach=.46+.54*smoothstep(-4.6,-.6,p.z);
  return exp(-vec3(.13,.046,.026)*depth*.16)*focus*reach;
}`;
// Display water is clear but never empty: over the ten units from the front glass to the
// back wall it takes most of the red and a third of the blue out of what lies behind, and
// that veil is the whole depth cue the tank has. The path is measured from the front
// glass, because every camera stands in air in front of the tank. One length and one
// absorption serve every surface, the motes, the back wall and the post pass's own march.
export const ABSORB=[.108,.052,.030];
export const extinctionGLSL=`
float reefAirPath(vec3 eye,vec3 ray){return eye.z>${n(TANK.front)}?(eye.z-${n(TANK.front)})/max(-ray.z,.05):0.;}
float reefWaterPath(vec3 p,vec3 eye){vec3 ray=p-eye;float d=length(ray);return max(0.,d-reefAirPath(eye,ray/max(d,1e-5)));}
vec3 reefTransmittance(float path){return exp(-vec3(${ABSORB.map(n).join(',')})*path);}`;
// What the water column itself sends toward the eye per unit of path: a skylight that is
// brightest just under the surface and dies away with depth, cyan above and indigo below,
// and the shafts. A shaft is the lamp's light gathered by the long, slow surface swell and
// scattered by the water it crosses. Its pattern is read where the ray from the lamp
// through p left the surface; refraction bends those rays toward the vertical, which is
// the same as the lamp hanging n times higher, so they fan out gently from above the
// tank and lean the way the key light does. The pattern is mostly across x, so it changes
// slowly along a view ray and a short march resolves it.
const IOR=1.333,lamp=[LAMP.x*LAMP_RANGE,h+(LAMP.y*LAMP_RANGE-h)*IOR,LAMP.z*LAMP_RANGE];
export const inscatterGLSL=`
float reefShafts(vec3 p,float t){
  vec2 q=vec2(${n(lamp[0])},${n(lamp[2])});q+=(p.xz-q)*${n(lamp[1]-h)}/max(${n(lamp[1])}-p.y,1.);
  float a=pow(.5+.5*sin(q.x*1.3+.8*sin(q.y*.5+t*.05)+t*.031),10.)
    +.8*pow(.5+.5*sin(q.x*2.3-q.y*.4-t*.047+1.3),12.)
    +.6*pow(.5+.5*sin(q.x*3.7+q.y*.3+t*.023+.4),14.)
    +.5*pow(.5+.5*sin(q.x*.55-t*.013+2.),6.);
  return a*exp(-q.x*q.x/90.);
}
vec3 reefInscatter(vec3 p,float t,float lit){
  float depth=clamp(${n(h)}-p.y,0.,12.),sky=exp(-.48*depth);
  return mix(vec3(.00012,.0007,.0030),vec3(.0009,.0034,.0082),sky)+vec3(.0030,.0070,.0110)*reefShafts(p,t)*lit*sky;
}`;
// The underside of the surface, seen from below at a grazing angle. Beyond the critical
// angle it is a mirror for the water under it; where the pump chop tilts a facet far
// enough toward the eye it opens onto the lit air above and flashes cyan-white. The swell
// is the dispersion-correct set above; the chop is finer and only ever seen, never cast,
// so it lives here. It thins with distance, as a surface does once its facets fall below
// what a pixel resolves, so it never sparkles into aliasing.
const CHOP=[[9.,.3,.9,.26],[13.,-1.1,1.4,.2],[19.,.8,2.1,.14],[27.,2.,2.9,.09]].map(([k,angle,speed,slope])=>({k,dx:Math.cos(angle),dz:Math.sin(angle),speed,slope}));
export const surfaceGLSL=`
vec3 reefSurfaceUnderside(vec3 s,vec3 dir,float distance,float t){
  vec2 q=s.xz;float st=t*${n(RIPPLE_TIME)};vec2 slope=vec2(0.);
  ${WAVES.map(w=>`slope+=${n(w.a*w.k*10)}*vec2(${n(w.dx)},${n(w.dz)})*cos(${n(w.k)}*dot(q,vec2(${n(w.dx)},${n(w.dz)}))-${n(w.omega)}*st+${n(w.phase)});`).join('\n')}
  float fine=exp(-distance*.09);
  ${CHOP.map((c,i)=>`slope+=fine*${n(c.slope)}*vec2(${n(c.dx)},${n(c.dz)})*cos(${n(c.k)}*dot(q,vec2(${n(c.dx)},${n(c.dz)}))+${n(c.speed)}*t*.1+${i*1.7+.4}*sin(q.y*.9+q.x*.4));`).join('\n')}
  vec3 facet=normalize(vec3(-slope.x,1.,-slope.y));
  float window=smoothstep(.30,.70,dot(dir,facet));
  vec3 mirror=vec3(.035,.13,.26)*(.75+.5*dot(slope,vec2(.6,.8)));
  return mix(mirror,vec3(.30,.62,.80),window);
}`;
// The key light's own shadow map, read by whatever lights the water itself: a mote in
// the arch's shadow stays dark because the lamp never reached it. The map is three's
// RGBA-packed depth, so <packing> must precede this.
export const shadowGLSL=`uniform sampler2D reefShadowMap;uniform mat4 reefShadowMatrix;
float reefLit(vec3 p){vec4 c=reefShadowMatrix*vec4(p,1.);c.xyz/=c.w;
  if(c.x<0.||c.x>1.||c.y<0.||c.y>1.||c.z>1.)return 1.;
  return step(c.z,unpackRGBAToDepth(texture2D(reefShadowMap,c.xy))+.0015);}`;

// How much light reaches the far side of the tissue. A solid body is one number, but a
// fin or a tentacle is a membrane a few cells thick and passes several times what the
// animal it hangs off does, so one material can carry both: pass a GLSL expression and it
// is evaluated per fragment instead.
const thickness=t=>typeof t==='number'?n(t):`(${t})`;
/** PBR lighting with short in-water paths. Camera air path is deliberately excluded.
 *  Geometry is kept in the bounded tank; neither fog nor sun rays hide bad modelling.
 */
export function underwater(material,{vertex='',begin='',normal='',fragment='',color='',map='',surfaceNormal='',key='reef',transmission=0}={}){
  material.onBeforeCompile=shader=>{
    shader.uniforms.reefTime=waterTime;
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>\nuniform float reefTime;varying vec3 vReefWorld;${vertex}`)
      .replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>\n${normal}`)
      .replace('#include <begin_vertex>',`#include <begin_vertex>\n${begin}`)
      .replace('#include <worldpos_vertex>',`#include <worldpos_vertex>\nvec4 reefPosition=vec4(transformed,1.);
      #ifdef USE_INSTANCING
      reefPosition=instanceMatrix*reefPosition;
      #endif
      vReefWorld=(modelMatrix*reefPosition).xyz;`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nuniform float reefTime;varying vec3 vReefWorld;vec3 reefLight=vec3(1.);${causticGLSL}${extinctionGLSL}${fragment}`)
      .replace('#include <map_fragment>',map||'#include <map_fragment>')
      .replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\n'+surfaceNormal)
      .replace('#include <color_fragment>',`#include <color_fragment>\n${color}`)
      .replace('#include <lights_physical_pars_fragment>',`#include <lights_physical_pars_fragment>
      #undef RE_Direct
      void RE_Direct_Reef(const in IncidentLight directLight,const in vec3 geometryPosition,const in vec3 geometryNormal,const in vec3 geometryViewDir,const in vec3 geometryClearcoatNormal,const in PhysicalMaterial material,inout ReflectedLight reflectedLight){
        IncidentLight light=directLight;light.color*=reefLight;
        RE_Direct_Physical(light,geometryPosition,geometryNormal,geometryViewDir,geometryClearcoatNormal,material,reflectedLight);
        ${transmission?`float wrap=pow(clamp(dot(-geometryNormal,light.direction)*.5+.5,0.,1.),2.);reflectedLight.directDiffuse+=light.color*material.diffuseColor*wrap*${thickness(transmission)};`:''}
      }
      #define RE_Direct RE_Direct_Reef`)
      .replace('#include <lights_fragment_begin>','reefLight=reefIrradiance(vReefWorld,reefTime);\n#include <lights_fragment_begin>')
      .replace('#include <opaque_fragment>',`outgoingLight*=reefTransmittance(reefWaterPath(vReefWorld,cameraPosition));
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey=()=>key;return material;
}
