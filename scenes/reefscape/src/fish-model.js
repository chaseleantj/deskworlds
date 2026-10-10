import * as THREE from 'three';
import { underwater } from './water.js';
import { merge } from './geometry.js';

const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const n=x=>Number(x).toFixed(5);
function part(g,id) {g.setAttribute('part',new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(id),1));return g;}
// Merger with an extra anatomical attribute. This is one mesh / draw per species including eyes.
function join(parts) {
  const anatomy=[];
  for(const g of parts) {
    const a=g.attributes.part;
    for(let i=0;i<a.count;i++)anatomy.push(a.getX(i));
  }
  const g=merge(parts);g.setAttribute('part',new THREE.Float32BufferAttribute(anatomy,1));return g;
}

// The snout sits at +SNOUT and the hypural plate at SNOUT-len; u runs 0 at the snout to
// 1 there, so `len` is standard length and the caudal fin hangs off its back end. `back`
// and `belly` are the half-heights above and below the spine, `half` the half-width, at
// the knots below, and `scales` the scale rows along and around the flank.
// Depths are measured ones where the literature has them: Pseudanthias squamipinnis has
// a fineness ratio of 2.68±0.07 (Frontiers in Marine Science 2023, Gulf of Eilat flume
// work), so its depth is len/2.68. Amphiprion percula is the deep one at about half its
// length, Chromis viridis a shallower ovate damsel, thin enough to vanish edge-on.
// Part ids: 0 body, 1 median fin, 2 pectoral, 3 pelvic, 4 eye.
const SNOUT=.54,RAYS=11;
const KNOTS=[0,.05,.12,.20,.30,.42,.55,.68,.80,.90,1];
const SPECIES={
  clown:{
    len:.98,
    back:[.046,.142,.206,.234,.246,.246,.226,.188,.134,.082,.045],
    belly:[.036,.124,.194,.232,.248,.246,.222,.172,.114,.066,.038],
    half:[.018,.054,.074,.083,.087,.084,.075,.058,.039,.024,.014],
    eye:{u:.130,v:.34,r:.044},scales:[34,13],cheek:.22,veil:[.98,.86],
    // Nine or ten dorsal spines, and percula's spinous dorsal is the low one — 3.0–3.4 in
    // head length, against a taller anterior fin in ocellaris, which is how the two are
    // separated on a photograph. The soft lobe behind the notch is the fin's high point.
    dorsal:{from:.195,to:.855,sink:.016,reach:[.050,.086,.080,.072,.070,.104,.114,.082,.026]},
    anal:{from:.605,to:.880,sink:.013,reach:[.038,.092,.100,.074,.026]},
    // Rounded caudal, a little under a quarter of standard length: the fan on a percula is
    // short, not the long paddle a generic fish model gives it.
    caudal:[[-.578,.148,0],[-.638,.174,0],[-.678,.156,0],[-.700,.092,0],[-.708,0,0],[-.700,-.090,0],[-.678,-.154,0],[-.638,-.172,0],[-.578,-.146,0]],
    // The pectoral is the engine, not a trim tab: percula rows with it at 2.4–4.6 Hz and
    // only adds the tail above about three body lengths a second (J. Exp. Biol. 2019).
    pectoral:{base:[[.272,.32],[.305,.00],[.338,-.32]],tip:[[.378,.022,.108],[.456,-.030,.134],[.508,-.116,.124],[.468,-.184,.094],[.388,-.166,.064]]},
    pelvic:{base:[[.365,-.88],[.400,-.98]],tip:[[.432,-.316,.040],[.508,-.392,.048],[.566,-.330,.032]]},
  },
  chromis:{
    len:.82,
    // Sources disagree on depth — 35–38% of standard length in the measured Lakshadweep
    // series, nearer 48% in the classic literature — so this takes 40%, which is what a
    // live fish photographs at. The peduncle stays deep at 16%, the eye 8.5%.
    back:[.016,.074,.132,.158,.166,.162,.146,.118,.086,.068,.046],
    belly:[.018,.078,.134,.156,.162,.156,.134,.102,.070,.062,.042],
    half:[.007,.029,.039,.044,.045,.043,.038,.030,.021,.015,.010],
    eye:{u:.112,v:.32,r:.035},scales:[26,10],cheek:.11,veil:[.56,.22],
    // Twelve spines then nine to eleven soft rays in one continuous fin. Spread, the
    // spinous half's upper edge is a perfectly straight line — a damsel's dorsal, not a
    // sail — and the soft lobe behind it is barely higher.
    dorsal:{from:.200,to:.815,sink:.011,reach:[.030,.062,.062,.062,.062,.070,.086,.058,.018]},
    anal:{from:.575,to:.830,sink:.010,reach:[.028,.066,.078,.058,.018]},
    // Broadly forked, concavity about 18% of standard length, the lobes tapering to points
    // that hook inward toward the fork. They do not run out into filaments: that, and the
    // blackish outer caudal margin, belong to C. atripectoralis.
    caudal:[[-.556,.196,0],[-.508,.140,0],[-.452,.088,0],[-.408,.042,0],[-.386,0,0],[-.408,-.041,0],[-.452,-.086,0],[-.508,-.138,0],[-.556,-.194,0]],
    pectoral:{base:[[.252,.30],[.285,.00],[.318,-.30]],tip:[[.350,.016,.066],[.418,-.024,.082],[.460,-.094,.078],[.428,-.144,.056],[.360,-.130,.040]]},
    pelvic:{base:[[.345,-.88],[.380,-.98]],tip:[[.410,-.238,.028],[.472,-.292,.034],[.518,-.246,.022]]},
  },
  anthias:{
    len:1.14,
    back:[.018,.078,.136,.182,.206,.210,.194,.160,.114,.070,.037],
    belly:[.016,.070,.126,.172,.198,.200,.180,.140,.094,.056,.031],
    half:[.006,.033,.052,.062,.066,.064,.056,.043,.029,.018,.010],
    eye:{u:.118,v:.34,r:.046},scales:[40,15],cheek:.10,veil:[.94,.62],
    // Ten spines and fifteen to seventeen soft rays make a long, low, even-topped dorsal;
    // the third spine is drawn out in both sexes and greatly so in the terminal male.
    dorsal:{from:.175,to:.865,sink:.012,reach:[.044,.072,.078,.074,.072,.082,.092,.068,.024]},
    // Three spines and only six or seven rays: the anal fin is short-based and set well
    // back, nothing like the long anal the dorsal would suggest.
    anal:{from:.640,to:.855,sink:.011,reach:[.034,.082,.094,.070,.024]},
    // Lunate in both sexes — the species' common name in the trade is lyretail — with the
    // lobes drawn into filaments on the male by the vertex shader below.
    caudal:[[-.940,.250,0],[-.876,.176,0],[-.814,.112,0],[-.758,.052,0],[-.726,0,0],[-.758,-.050,0],[-.814,-.110,0],[-.876,-.174,0],[-.940,-.248,0]],
    pectoral:{base:[[.248,.30],[.282,.00],[.316,-.30]],tip:[[.348,.020,.074],[.416,-.026,.092],[.462,-.106,.088],[.428,-.166,.066],[.356,-.148,.046]]},
    pelvic:{base:[[.340,-.88],[.375,-.98]],tip:[[.408,-.268,.032],[.476,-.336,.038],[.526,-.284,.024]]},
  },
};
const axis=(kind,u)=>SNOUT-u*SPECIES[kind].len;
// A cubic Hermite through the knots with central-difference tangents, so the profile has
// no flat spot at each knot (a smoothstep per segment scallops the outline), and a steep
// start at the snout so the head rounds off instead of ending in a pout.
function slope(values,k) {
  const last=KNOTS.length-1;
  if(k===0)return 3*(values[1]-values[0])/KNOTS[1];
  if(k===last)return (values[last]-values[last-1])/(KNOTS[last]-KNOTS[last-1]);
  return (values[k+1]-values[k-1])/(KNOTS[k+1]-KNOTS[k-1]);
}
function along(values,u) {
  let i=1;while(i<KNOTS.length-1&&KNOTS[i]<u)i++;
  const h=KNOTS[i]-KNOTS[i-1],t=(u-KNOTS[i-1])/h,t2=t*t,t3=t2*t;
  return (2*t3-3*t2+1)*values[i-1]+(t3-2*t2+t)*h*slope(values,i-1)+(3*t2-2*t3)*values[i]+(t3-t2)*h*slope(values,i);
}
function section(kind,u) {
  const s=SPECIES[kind];u=Math.max(0,Math.min(1,u));
  return {top:along(s.back,u),bottom:along(s.belly,u),half:along(s.half,u)};
}
/** Surface point at axial fraction u and angle a, a=0 on the dorsal midline.
 *  Fullness above 1 pinches the section toward a ridge at the back and a softer keel at
 *  the belly, which is what a laterally compressed fish's cross-section actually does;
 *  the gill chamber swells the cheek so the head is not a cone. percula's cheek swells
 *  hardest: seen head-on its face bulges, which is one of the marks that separates it
 *  from the flat-headed ocellaris. */
function sectionPoint(kind,u,a,out=V()) {
  const s=section(kind,u),v=Math.cos(a),lateral=Math.sin(a);
  const full=.95+.48*Math.pow(Math.max(0,v),1.6)+.40*Math.pow(Math.max(0,-v),1.6);
  const cheek=1+SPECIES[kind].cheek*Math.exp(-(((u-.155)/.072)**2))*(.5-v*.5);
  const width=s.half*cheek*Math.pow(Math.abs(lateral),full)*Math.sign(lateral);
  return out.set(axis(kind,u),v>=0?v*s.top:v*s.bottom,width);
}
const skinPoint=(kind,u,v,side)=>{const q=sectionPoint(kind,u,Math.acos(v));return [q.x,q.y,side*Math.abs(q.z)];};

function bodyGeometry(kind) {
  const rings=56,sides=34,p=[],uv=[],index=[],q=V(),previous=V();
  for(let j=0;j<=rings;j++) {
    // Rows crowd toward the snout, where the profile and the orbit turn hardest.
    const u=Math.pow(j/rings,1.24),arc=[0];
    sectionPoint(kind,u,0,previous);
    for(let i=1;i<=sides;i++){sectionPoint(kind,u,i/sides*Math.PI*2,q);arc.push(arc[i-1]+q.distanceTo(previous));previous.copy(q);}
    const half=Math.max(arc[sides>>1],1e-6);
    for(let i=0;i<=sides;i++) {
      sectionPoint(kind,u,i/sides*Math.PI*2,q);p.push(q.x,q.y,q.z);
      // uv.y is the arc fraction from the dorsal midline to the ventral, identical on
      // both flanks: every colour zone then follows the outline rather than a height.
      uv.push(u,i<=sides>>1?arc[i]/half:(arc[sides]-arc[i])/half);
      if(j<rings&&i<sides){const k=j*(sides+1)+i;index.push(k,k+1,k+sides+1,k+1,k+sides+2,k+sides+1);}
    }
  }
  // Close both ends so nothing is seen through the snout or the peduncle.
  for(const [row,u,flip] of [[0,0,false],[rings,1,true]]) {
    const hub=p.length/3;p.push(axis(kind,u),0,0);uv.push(u,.5);
    for(let i=0;i<sides;i++){const a=row*(sides+1)+i,b=a+1;index.push(...(flip?[hub,b,a]:[hub,a,b]));}
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setIndex(index);g.computeVertexNormals();return part(g,0);
}

/** A fin is a sheet lofted from its insertion line in the skin to its free margin.
 *  uv.x runs along the base — which ray — and uv.y from the hinge to the edge; the
 *  shader draws the rays, the pigment gradient and the membrane's thinning from those.
 *  The membrane falls short of the ray tips between rays, which is what makes a real
 *  fin's edge finely scalloped rather than a clean arc. */
function fin(base,tip,id,columns,steps=5) {
  const hinge=new THREE.CatmullRomCurve3(base.map(k=>V(...k))),margin=new THREE.CatmullRomCurve3(tip.map(k=>V(...k)));
  const p=[],uv=[],index=[],a=V(),b=V(),q=V();
  for(let i=0;i<=columns;i++) {
    const s=i/columns;hinge.getPoint(s,a);margin.getPoint(s,b);
    const reach=1-.034*Math.pow(.5-.5*Math.cos(Math.PI*2*s*RAYS),1.4);
    for(let j=0;j<=steps;j++) {
      const t=j/steps;q.lerpVectors(a,b,t*reach);p.push(q.x,q.y,q.z);uv.push(s,t);
      if(i<columns&&j<steps){const k=i*(steps+1)+j;index.push(k,k+1,k+steps+1,k+1,k+steps+2,k+steps+1);}
    }
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setIndex(index);g.computeVertexNormals();return part(g,id);
}
// Median fins hinge a little inside the dorsal or ventral margin, so the membrane grows
// out of the skin instead of balancing on it. Both curves are sampled at the same
// stations: a ray then runs straight out from its own insertion.
function median(kind,{from,to,sink,reach},up) {
  const base=[],tip=[],count=reach.length-1;
  for(let i=0;i<=count;i++) {
    const u=from+(to-from)*i/count,s=section(kind,u),x=axis(kind,u),edge=up?s.top:-s.bottom;
    base.push([x,edge-(up?sink:-sink),0]);tip.push([x,edge+(up?reach[i]:-reach[i]),0]);
  }
  return [base,tip];
}
const hypural=kind=>{
  const s=section(kind,1),line=[];
  for(let i=0;i<=8;i++){const t=i/8;line.push([axis(kind,1)+.024*Math.sin(Math.PI*t),s.top+(-s.bottom-s.top)*t,0]);}
  return line;
};
// A flattened lens seated in the orbit. Its centre is shared with the shader, which
// paints the pupil, the thin iris ring and the sharp dark rim by radius.
function eyeSeat(kind) {
  const e=SPECIES[kind].eye,q=sectionPoint(kind,e.u,Math.acos(e.v));
  return {x:q.x,y:q.y,z:Math.abs(q.z)*.84,r:e.r};
}
function eye(kind,side) {
  const e=eyeSeat(kind),g=new THREE.SphereGeometry(1,16,10);
  g.scale(e.r,e.r*1.05,e.r*.32);g.translate(e.x,e.y,side*e.z);
  return part(g,4);
}

export function makeFishGeometry(kind='clown') {
  const s=SPECIES[kind],parts=[bodyGeometry(kind)];
  parts.push(fin(...median(kind,s.dorsal,true),1,20));
  parts.push(fin(...median(kind,s.anal,false),1,13));
  parts.push(fin(hypural(kind),s.caudal,1,22));
  for(const side of [-1,1]) {
    parts.push(fin(s.pectoral.base.map(([u,v])=>skinPoint(kind,u,v,side)),s.pectoral.tip.map(([u,y,z])=>[axis(kind,u),y,side*z]),2,10,4));
    parts.push(fin(s.pelvic.base.map(([u,v])=>skinPoint(kind,u,v,side)),s.pelvic.tip.map(([u,y,z])=>[axis(kind,u),y,side*z]),3,7,3));
    parts.push(eye(kind,side));
  }
  return join(parts);
}

// Skin pigment per species, in the order back → flank → belly. Bars, stripes and the
// iridescent layer are written against uv: uv.x is the axial fraction u, uv.y the arc
// fraction from the dorsal midline (0) to the ventral (1).
const SKIN={
  clown:`
    // Orange from xanthophores across the whole flank, only a shade deeper along the back.
    vec3 skin=mix(vec3(.74,.125,.005),vec3(1.00,.270,.010),smoothstep(.06,.46,band));
    skin=mix(skin,vec3(1.00,.420,.060),smoothstep(.66,.98,band));
    // Three bars, in the rostro-caudal order a settling juvenile grows them: the head bar
    // behind the eye leaning forward at the throat, the trunk bar with the forward wedge
    // that marks percula, the peduncle bar. The white is a guanine iridophore plate and
    // the black edge is the melanophore band those iridophores position, so the two are
    // one feature and are drawn from one signed distance.
    float b1=abs(u-(.246-.048*band))-.042;
    float b2=abs(u-(.520-.104*exp(-pow((band-.46)/.215,2.))))-.058;
    float d=min(min(b1,b2),abs(u-.872)-.030);
    // percula carries thick black borders where ocellaris has a hairline or none at all,
    // and the black broadens with age: the big female in a group is the blackest fish.
    float edge=.013+.013*vTrim.x,aa=max(fwidth(d),.0012);
    skin=mix(skin,vec3(.009,.012,.016),1.-smoothstep(edge-aa,edge+aa,d));
    skin=mix(skin,vec3(.86,.90,.96),1.-smoothstep(-aa,aa,d));`,
  chromis:`
    // A blue-green chromis is mostly green: pale apple-green over the back washing out
    // almost to white at the belly, with the blue held in the peduncle and in the
    // iridophore flare rather than in the base coat. Measured reflectance for the species
    // carries nothing above green — no yellow, no orange, no red — so the whole coat is
    // built from green and cyan over a silver belly.
    vec3 skin=mix(vec3(.045,.300,.235),vec3(.215,.610,.315),smoothstep(.04,.34,band));
    skin=mix(skin,vec3(.720,.820,.760),smoothstep(.52,.94,band));
    skin=mix(skin,vec3(.090,.470,.530),smoothstep(.70,1.,u)*.72);
    // A pair of electric turquoise lines runs from the upper lip to the front of the orbit.
    skin=mix(skin,vec3(.10,.78,.82),exp(-pow((band-(.30+1.5*u))/.030,2.))*(1.-smoothstep(.04,.11,u))*.8);
    // The solid black axil is Chromis atripectoralis, sold beside this fish and mistaken
    // for it; on viridis the upper pectoral base only carries scattered black dots, and
    // even those show solely when the fin swings forward.
    skin*=1.-.13*exp(-pow((u-.292)/.032,2.)-pow((band-.44)/.070,2.));
    // One aggregation runs from green through to blue, and the same fish shifts as it
    // turns, so the per-animal constant only picks where in that range it sits.
    skin=mix(skin,skin*vec3(.60,.94,1.34),vTrim.x*.52);
    // The nesting male goes yellowish while he tends his patch of rubble.
    skin=mix(skin,skin*vec3(1.55,1.14,.40),vTrim.y*.70);`,
  anthias:`
    // Golden orange, deepest along the back and paling to a yellow belly.
    vec3 skin=mix(vec3(.84,.170,.006),vec3(.92,.330,.018),smoothstep(.05,.40,band));
    skin=mix(skin,vec3(.98,.570,.135),smoothstep(.56,.96,band));
    // The species character, and it is not a violet bar: an orange stripe edged in violet
    // running from the upper lip, under the eye, back to the pectoral-fin base.
    float line=(band-(.415+.58*u))/.052;
    float stripe=exp(-line*line)*(1.-smoothstep(.22,.33,u));
    skin=mix(skin,vec3(1.00,.360,.070),stripe*.90);
    skin=mix(skin,vec3(.46,.14,.58),stripe*min(1.,abs(line))*.85);
    // The terminal male: magenta head and peduncle over a rose-orange flank. The pale
    // square patch behind the pectoral belongs to P. pleurotaenia, not to this fish, so
    // it is deliberately absent; his one body mark is the red blotch on the pectoral fin.
    vec3 male=mix(vec3(.62,.070,.190),vec3(.74,.250,.130),smoothstep(.13,.46,u));
    male=mix(male,vec3(.66,.105,.205),smoothstep(.60,.94,u));
    skin=mix(skin,mix(male,male*vec3(1.22,.88,1.18),smoothstep(.54,1.,band)),vTrim.y);`,
};
// Fin membranes: the pigment across the span, hinge (0) to free margin (1). `tail`,
// `below`, `paired` and `pelvic` name which fin this fragment is on, because the median
// fins share one sheet and a caudal is not painted like a dorsal.
const FINS={
  clown:`
    // Orange membrane with a heavy black margin on the median fins, a translucent rim
    // outside it, and pelvics that are all but solid black. A flat membrane picks up far
    // more of the blue ambient than the curved flank beside it, so an orange mixed to
    // match the skin renders sand: these are cut back in green and blue to compensate.
    vec3 web=mix(vec3(.80,.150,.004),vec3(.98,.260,.012),span);
    web=mix(web,vec3(.011,.014,.018),smoothstep(.74,.90,span)*(1.-.70*tail)*(1.-paired+pelvic));
    web=mix(web,vec3(.46,.48,.50),smoothstep(.95,1.,span)*(1.-paired));
    // The peduncle bar's black runs on across the base of the caudal, a third of the way out.
    web=mix(web,vec3(.011,.014,.018),tail*(1.-smoothstep(.20,.36,span)));
    web=mix(web,vec3(.013,.016,.020),pelvic*.78);
    // The trunk bar does not stop at the skin: it carries on up the soft dorsal and down
    // the anal, which is why those two fins look notched white on a photograph.
    web=mix(web,vec3(.82,.86,.92),(1.-tail)*(1.-smoothstep(.030,.070,abs(axial-.520)))*(1.-smoothstep(.40,.92,span)));`,
  chromis:`
    // Hyaline fins the colour of the water it hovers in. Only the outer edges of the
    // caudal lobes take the livery; a blackish dorsal margin, or a caudal that ran out
    // into dark filaments, would make this C. atripectoralis instead.
    vec3 web=mix(vec3(.230,.620,.470),vec3(.520,.820,.740),span);
    web=mix(web,vec3(.090,.500,.540),tail*smoothstep(.34,1.,span)*smoothstep(.34,.04,min(vSkinUv.x,1.-vSkinUv.x)));`,
  anthias:`
    // Golden membrane on both sexes. The male carries it rose instead, and adds a dusky
    // blue anal, a red blotch on the pectoral and a violet edge along both lobes of the
    // lyre — the three marks that separate a terminal male from a big female.
    vec3 web=mix(vec3(.90,.265,.022),vec3(1.00,.470,.048),smoothstep(.16,.82,span));
    web=mix(web,mix(vec3(.90,.155,.155),vec3(.50,.075,.290),smoothstep(.45,1.,span)),vTrim.y*(.50+.44*tail));
    web=mix(web,vec3(.115,.140,.40),vTrim.y*below*(1.-tail)*.62);
    web=mix(web,vec3(.82,.045,.030),vTrim.y*(paired-pelvic)*smoothstep(.22,.74,span));`,
};
// Guanine platelets under the scales: a thin-film flare that only shows off normal. It is
// the whole point of a chromis and barely there on the barred clownfish.
const SHEEN={clown:'vec3(.080,.085,.125)',chromis:'vec3(.090,.330,.430)',anthias:'vec3(.230,.100,.290)'};
// The iris is the fastest species mark at tank distance. percula's is bright orange, and
// ocellaris' greyish one is exactly how the trade tells the two apart; a damsel's is a
// silver ring round a large dark pupil; both sexes of sea goldie carry the metallic
// pink-violet orbital ring that runs straight on into the cheek stripe.
const EYE={
  clown:'vec3 iris=vec3(.90,.380,.030),rim=vec3(.10,.035,.012);',
  chromis:'vec3 iris=vec3(.52,.58,.56),rim=vec3(.030,.110,.120);',
  anthias:'vec3 iris=vec3(.86,.560,.120),rim=mix(vec3(.40,.16,.42),vec3(.46,.10,.20),vTrim.y);',
};

/** The skin, fin and eye shading for one species. Every animal of that species shares
 *  this material; what differs between them travels in the per-instance aFishTrim:
 *  x tail phase, y beat amplitude, z a per-animal shade — relative body size on the
 *  clownfish, where the black borders broaden with age — and w the sexed-up individual,
 *  the terminal male anthias or the chromis holding the nest. aFishGait carries the
 *  rest of the animal's motion: x the pectoral phase, y how hard the pectorals row, z the
 *  body's bend into a turn. */
function fishMaterial(kind) {
  const e=eyeSeat(kind),[rows,files]=SPECIES[kind].scales,[hinge,margin]=SPECIES[kind].veil;
  // percula rows with its pectorals hard enough to drive the whole fish and only folds
  // them in for a caudal burst; the two open-water species use theirs to trim and hover,
  // so their stroke is smaller than the tail that carries them.
  const stroke=kind==='clown'?[.050,.034]:kind==='chromis'?[.024,.010]:[.030,.014];
  return underwater(new THREE.MeshStandardMaterial({roughness:.38,metalness:.02,side:THREE.DoubleSide,transparent:true,forceSinglePass:true}),{
    key:`fish-${kind}`,transmission:.085,
    vertex:`attribute float part;attribute vec4 aFishTrim;attribute vec4 aFishGait;varying float vPart;varying vec3 vAnatomy;varying vec2 vSkinUv;varying vec2 vTrim;
      #define fishTrim aFishTrim
      #define fishGait aFishGait
      // The propulsive wave grows toward the tail, and a turn bends the whole body the same
      // way: a fish turns as a C, not as a rigid arrow swung about its middle.
      float fishFlex(float x) {float q=clamp((.30-x)/1.14,0.,1.);return (sin(fishTrim.x-q*3.7)*fishTrim.y+fishGait.z)*q*q;}
      float fishSlope(float x){float q=clamp((.30-x)/1.14,0.,1.);return -(2.*q*(fishTrim.y*sin(fishTrim.x-q*3.7)+fishGait.z)-3.7*q*q*fishTrim.y*cos(fishTrim.x-q*3.7))/1.14;}`,
    normal:`objectNormal=normalize(vec3(normal.x-fishSlope(position.x)*normal.z,normal.y,normal.z));`,
    begin:`vPart=part;vAnatomy=position;vSkinUv=uv;vTrim=fishTrim.zw;
      transformed.z+=fishFlex(position.x);
      // A pectoral rows through an abduction–adduction cycle rather than flapping: the
      // blade sweeps out and then back along the flank, so the stroke has a fore-aft part.
      if(part>1.5&&part<3.5){
        float hinge=clamp((.30-position.x)*3.4,0.,1.),row=sin(fishGait.x)*fishGait.y;
        transformed.z+=sign(position.z)*row*hinge*${n(stroke[0])};
        transformed.x-=row*hinge*hinge*${n(stroke[1])};
      }
      ${kind==='anthias'?`// Both sexes carry the lyre and a prolonged third dorsal spine; on the terminal
      // male the lobe tips run out a little further and that spine stands about twice the
      // fin height, not the whips the species is often drawn with.
      if(part>.5&&part<1.5){
        if(position.x<${n(axis(kind,1))}){float lobe=uv.y*uv.y*smoothstep(.12,.24,abs(position.y));transformed.x-=fishTrim.w*.12*lobe;transformed.y+=sign(position.y)*fishTrim.w*.035*lobe;}
        else if(position.y>.10){float spine=uv.y*uv.y*exp(-pow((uv.x-.150)/.034,2.));transformed.y+=(.045+.11*fishTrim.w)*spine;transformed.x-=.05*fishTrim.w*spine;}
      }`:''}`,
    fragment:`varying float vPart;varying vec3 vAnatomy;varying vec2 vSkinUv;varying vec2 vTrim;`,
    color:`
      float u=vSkinUv.x,band=vSkinUv.y,span=clamp(vSkinUv.y,0.,1.),scaleEdge=0.;
      if(vPart<.5){
        ${SKIN[kind]}
        // The opercular margin and the mouth cleft are seams in the pigment, not geometry:
        // at this size a modelled gill cover would cost triangles nobody could resolve.
        // The gill cover's free edge bows back toward the pectoral base.
        skin*=1.-.13*exp(-pow((u-(.215+.09*sin(3.1416*clamp(band,0.,1.))))/.009,2.))*(1.-smoothstep(.70,.95,band));
        float cleft=exp(-pow((band-(.60+2.6*u))/.045,2.))*(1.-smoothstep(.035,.085,u));
        skin=mix(skin,skin*.34,cleft*.8);
        // Imbricate scale rows: each scale's exposed free edge is an arc swept back over the
        // one behind. Under mucus they are all but invisible as pigment and show as a break
        // in the sheen, so the pattern mostly drives roughness below, and fades out once a
        // scale falls under a pixel. Painted as dots they read as a polka-dot print.
        vec2 cell=vec2(u*${n(rows)},band*${n(files)});cell.x+=mod(floor(cell.y),2.)*.5;
        vec2 tile=fract(cell)-.5;float lip=length(vec2(tile.x+.5,tile.y*1.15));
        scaleEdge=smoothstep(.30,.0,abs(lip-.62))*(1.-smoothstep(.40,1.05,max(fwidth(cell.x),fwidth(cell.y))))*smoothstep(.08,.24,band);
        skin*=1.-${kind==='chromis'?'.060':'.035'}*scaleEdge;
        // Countershading and a per-animal shift, so no two of a species read identical.
        skin*=1.-.34*(1.-smoothstep(0.,.11,band));
        skin*=vec3(.93+.14*vTrim.x,.96+.08*vTrim.x,1.03-.10*vTrim.x);
        diffuseColor.rgb=skin*(.975+.025*sin(vAnatomy.x*96.+sin(vAnatomy.y*88.)));
      }else if(vPart<3.5){
        // Which fin this is. The three median fins are lofted from one sheet, so a caudal
        // is told from a dorsal by sitting behind the gap between the anal fin's last ray
        // and the front of the tail, and an anal from a dorsal by sitting below the spine.
        float tail=step(vAnatomy.x,${n(axis(kind,1)+.06)}),below=step(vAnatomy.y,0.);
        float paired=step(1.5,vPart),pelvic=step(2.5,vPart);
        float axial=(${n(SNOUT)}-vAnatomy.x)/${n(SPECIES[kind].len)};
        ${FINS[kind]}
        // Bone splints stand proud of the membrane between them.
        float rib=pow(.5+.5*cos(vSkinUv.x*${n(Math.PI*2*RAYS)}),40.);
        // Lifted above the skin's albedo for the light scattered through the thin membrane,
        // so a fin edge-on to the lamps keeps its own colour rather than going brown.
        diffuseColor.rgb=min(web*1.35,vec3(1.))*(.92+.22*rib)*(.94+.12*vTrim.x);
        // The membrane between the splints is a couple of cell layers, clear enough to see
        // the water through; the rays carry most of the opacity. Thickest at the hinge,
        // thinnest at the free margin, and the paired fins thinner again.
        diffuseColor.a=clamp((${n(margin)}+${n(hinge-margin)}*(1.-span))*(.74+.26*rib)*(paired>.5?.66:1.),.10,1.);
      }else{
        float r=length((vAnatomy.xy-vec2(${n(e.x)},${n(e.y)}))/${n(e.r)});
        ${EYE[kind]}
        // A fish's pupil fills most of the eye: the iris is only a narrow ring round it.
        diffuseColor.rgb=mix(vec3(.004,.005,.007),iris*(1.30-.45*r),smoothstep(.56,.64,r));
        diffuseColor.rgb=mix(diffuseColor.rgb,rim,smoothstep(.80,.95,r));
        // A wet cornea always carries one small catchlight; without it the eye is a
        // printed dot, and at this size that reads before anything else does.
        diffuseColor.rgb+=vec3(.62,.64,.66)*exp(-dot((vAnatomy.xy-vec2(${n(e.x+e.r*.30)},${n(e.y+e.r*.32)}))/${n(e.r*.27)},(vAnatomy.xy-vec2(${n(e.x+e.r*.30)},${n(e.y+e.r*.32)}))/${n(e.r*.27)}));
      }
    `,
    surfaceNormal:`
      if(vPart<.5){
        float fresnel=pow(1.-abs(dot(normal,normalize(vViewPosition))),3.4);
        float flank=smoothstep(.09,.33,vSkinUv.y)*(1.-smoothstep(.60,.92,vSkinUv.y));
        diffuseColor.rgb+=${SHEEN[kind]}*fresnel*flank*(.75+.5*vTrim.x)*(1.-.45*scaleEdge);
        // Mucus over scales is wet and glossy, and each scale's edge breaks the highlight,
        // which is where the scales show at all. The dorsal ridge and the belly keel face
        // the lamps square on; kept a little rougher, or the back reads as a white stripe.
        roughnessFactor=.30+.22*(1.-smoothstep(.05,.26,vSkinUv.y))+.10*smoothstep(.78,1.,vSkinUv.y)+.12*scaleEdge;
      }else if(vPart>3.5)roughnessFactor=.06;
      else{
        // A fin is a membrane stretched between round splints, and it corrugates across
        // them. Left as one flat sheet it faces the lamps square on and takes a broad
        // specular wash the curved flank never gets, which bleaches every warm membrane
        // toward sand; corrugated, the rays catch the light one at a time instead.
        normal=normalize(normal+vec3(.14,.06,0.)*sin(vSkinUv.x*${n(Math.PI*2*RAYS)}));
        // Matt collagen: a glossy fin throws a hard white line along the back that no
        // fish has.
        roughnessFactor=.88;
      }
    `,
  });
}

/** A draw call per species rather than per animal. The same anatomical geometry
 *  and muscle-wave shader are used, with per-instance phase, gait and transform.
 */
export function createFishSchool(scene,simulation){
  const groups=[];
  for(const kind of ['clown','chromis','anthias']){
    const fish=simulation.fish.filter(f=>f.kind===kind),geometry=makeFishGeometry(kind);
    const data=new Float32Array(fish.length*4),attribute=new THREE.InstancedBufferAttribute(data,4).setUsage(THREE.DynamicDrawUsage);
    const gait=new Float32Array(fish.length*4),gaitAttribute=new THREE.InstancedBufferAttribute(gait,4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aFishTrim',attribute);geometry.setAttribute('aFishGait',gaitAttribute);
    const mesh=new THREE.InstancedMesh(geometry,fishMaterial(kind),fish.length);mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(mesh); // tiny fixed population, shader-deformed bounds
    // Trim z shades each animal a little differently — for the clownfish it instead
    // carries relative size, because percula's black borders broaden with age and the
    // biggest fish on an anemone is the blackest. Trim w marks the sexed-up individual:
    // the terminal male anthias, and the chromis holding the nest.
    const largest=Math.max(...fish.map(f=>f.size));
    groups.push({fish,data,attribute,gait,gaitAttribute,mesh,trim:fish.map((f,i)=>[kind==='clown'?f.size/largest:(i*.6180339887+.31)%1,(kind==='anthias'||kind==='chromis')&&f.rank===0?1:0])});
  }
  const dummy=new THREE.Object3D(),euler=new THREE.Euler(0,0,0,'YZX');
  return {update(){
    for(const group of groups){
      for(let i=0;i<group.fish.length;i++){
        const f=group.fish[i];dummy.position.copy(f.position);dummy.scale.setScalar(f.size);euler.set(f.roll,f.yaw,f.pitch);dummy.quaternion.setFromEuler(euler);dummy.updateMatrix();group.mesh.setMatrixAt(i,dummy.matrix);
        // The simulation owns effort and amplitude. No hidden idle oscillation here;
        // a coast is straight. The travelling wave runs from the head toward the tail.
        group.data.set([f.phase,f.tailAmplitude,...group.trim[i]],i*4);
        group.gait.set([f.pectoral,f.rowing,f.bend,0],i*4);
      }
      group.attribute.needsUpdate=true;group.gaitAttribute.needsUpdate=true;group.mesh.instanceMatrix.needsUpdate=true;
    }
  },groups};
}
