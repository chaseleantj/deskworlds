import * as THREE from 'three';
import { merge, coralBranches, seaFan, massiveCoral, polyp, plateCoral } from './geometry.js';
import { underwater, responseGLSL } from './water.js';
import { randomGenerator, clamp } from './math.js';
import { supportHeight } from './terrain.js';
// uv.x carries how far a vertex stands from its holdfast, and so how much of the
// flow it answers; the tissue material reads it instead of a per-colony constant.
const flexible=(g,root,span)=>{const p=g.attributes.position,uv=g.attributes.uv;for(let i=0;i<p.count;i++)uv.setX(i,clamp((p.getY(i)-root)/span,0,1));return g;};

// Living coral is a skin of polyps over a skeleton, finer than any vertex can carry: a
// cellular field in world space places one polyp per cell, so no texture has to be
// unwrapped over a branching mesh. A polyp's relief is a profile of d, the distance to
// its centre, and e, how far inside its cell it lies, both in cell widths; the slope
// comes from their exact gradients rather than screen derivatives, which step in 2x2
// blocks. The field fades out once a cell shrinks to a few pixels.
const cellGLSL=`vec3 polypV1;vec3 polypV2;float polypFade;float polypD;float polypE;
vec3 polypHash(vec3 p){p=fract(p*vec3(.1031,.1030,.0973));p+=dot(p,p.yxz+33.33);return fract((p.xxy+p.yxx)*p.zyx);}
void polypCells(vec3 p){vec3 i=floor(p),f=fract(p);float d1=8.,d2=8.;
  for(int z=-1;z<=1;z++)for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec3 g=vec3(x,y,z),v=f-g-polypHash(i+g);float d=dot(v,v);
    if(d<d1){d2=d1;polypV2=polypV1;d1=d;polypV1=v;}else if(d<d2){d2=d;polypV2=v;}}
  polypD=sqrt(d1);polypE=sqrt(d2)-polypD;}`;
/** One physical material per coral kind over the shared polyp field. `cells` is polyps per
 *  tank unit, `shape` the GLSL relief profile of d and e, `relief` its slope gain, `cup`
 *  the colour multiplier at a polyp's centre and `groove` between polyps; `sheen` is the
 *  velvet of extended tentacles catching the light. */
const POLYP='.8*(1.-smoothstep(0.,.45,d))+.3*smoothstep(0.,.25,e)';
function coralMaterial(key,{cells=60,shape=POLYP,relief=.35,cup=[1.18,1.14,1.06],groove=.84,sheen=0,sheenColor='#d8d4c4',roughness=.7,transmission=.15,side=THREE.FrontSide,...hooks}={}){
  const f=x=>Number(x).toFixed(4),[r,g,b]=cup.map(f);
  return underwater(new THREE.MeshPhysicalMaterial({vertexColors:true,roughness,side,sheen,sheenRoughness:.55,sheenColor:new THREE.Color(sheenColor)}),{key,transmission,...hooks,
    fragment:cellGLSL+`float polypShape(float d,float e){return ${shape};}`+(hooks.fragment||''),
    color:`polypCells(vReefWorld*${f(cells)});polypFade=1.-smoothstep(.12,.45,length(fwidth(vReefWorld))*${f(cells)});
      diffuseColor.rgb*=mix(vec3(1.),mix(vec3(${f(groove)}),vec3(${r},${g},${b}),1.-smoothstep(.0,.42,polypD))*mix(.9,1.,smoothstep(0.,.2,polypE)),polypFade);${hooks.color||''}`,
    surfaceNormal:`{float h0=polypShape(polypD,polypE),hd=(polypShape(polypD+.01,polypE)-h0)*100.,he=(polypShape(polypD,polypE+.01)-h0)*100.;
      vec3 n1=normalize(polypV1),grad=mat3(viewMatrix)*(hd*n1+he*(normalize(polypV2)-n1));
      normal=normalize(normal-${f(relief)}*polypFade*(grad-dot(grad,normal)*normal));}${hooks.surfaceNormal||''}`});
}
const mesh=(geometry,material,cast=true)=>{const m=new THREE.Mesh(geometry,material);m.castShadow=cast;m.receiveShadow=true;return m;};

/** Every coral in the tank: stony skeletons are static, and only the gorgonian fan
 *  answers the flow. */
export function createCorals(scene){
  const rng=randomGenerator(22097);
  // Colonies stand on the baked rock: x and z place a colony, sink is how far its base
  // plate settles below the surface there.
  const grow=(x,z,sink,...rest)=>coralBranches([x,supportHeight(x,z)-sink,z],...rest);
  // Acropora, needle-fine Seriatopora and stubby Montipora digitata. Live coral tissue
  // is mostly tan and brown — zooxanthellae, not pigment — tinted green, cream or lilac
  // by the host's own proteins, with pale, still-calcifying growing tips.
  const ACRO={roots:18,forks:5,thickness:.056,reach:.50,spread:.44,radials:34,glow:.62},NEEDLE={thickness:.033,forks:3,roots:6,order:3,rise:.80,corallite:.08,blunt:0,radials:22,glow:.5};
  const FINGER={thickness:.070,forks:2,roots:16,order:1,rise:1.0,taper:.78,blunt:1,spread:.46,radials:26,glow:.45},BRUSH={roots:16,forks:3,order:1,thickness:.062,reach:.66,spread:.36,taper:.70,blunt:.8,radials:86,glow:.55};
  const branches=[
    grow(-5.82,-1.00,.42,2.10,1.05,39,'#b88a44','#f4e2b0',ACRO),
    grow(-7.10,-1.05,.42,1.75,1.16,74,'#7e9a36','#e0f090',{...ACRO,roots:14,thickness:.050,reach:.58,spread:.34}),
    grow(-4.35,-2.15,.60,2.30,.99,122,'#8e7898','#e6d6f0',NEEDLE),
    grow(5.45,-1.52,.05,1.80,1.22,82,'#a4a03c','#eef2a0',ACRO),
    grow(7.34,-1.62,.38,1.30,1.00,417,'#b88a44','#f4e2b0',{...ACRO,roots:12,thickness:.052,reach:.62,spread:.34}),
    grow(3.28,-1.52,.38,1.60,.86,23,'#b08c76','#eedcd0',NEEDLE),
    grow(4.30,1.55,.17,.84,.98,611,'#8a6a48','#d4c098',{...FINGER,vary:.40}),
    // The arch lintel carries its own colonies, a tan Acropora and a purple bottlebrush;
    // the cave beneath stays open.
    grow(-.45,-1.14,.12,.95,.90,707,'#a08050','#ecdab0',{...ACRO,roots:12,forks:4,reach:.56}),
    grow(1.34,-1.24,.30,.95,.55,811,'#6c4e8c','#cdb4ec',BRUSH),
    // Low colonies crowd the host's foot, so its column rises out of the reef, not bare rock.
    grow(-3.66,1.34,.10,.92,.95,1201,'#6e8636','#d4e894',{...FINGER,roots:13,vary:.30}),
    grow(-4.38,1.30,.10,.84,.80,1207,'#8a6a92','#e2cdea',{...FINGER,roots:10,thickness:.075,vary:.30}),
    grow(-7.30,1.10,.06,.55,.90,1213,'#8a6a48','#d4c098',{...FINGER,roots:12,vary:.30}),
    // A lime Pocillopora on the right shoulder, all blunt lumpy branchlets.
    grow(6.15,.50,.02,.85,1.05,905,'#6aa232','#d4f482',{...FINGER,roots:30,forks:3,order:1,thickness:.11,reach:.46,spread:.50,taper:.72,radials:40,glow:.5,vary:.25}),
  ];
  scene.add(mesh(merge(branches),coralMaterial('branching-coral',{cells:70,sheen:.55,transmission:.20})));

  // Capricornis grows in overlapping whorls, so each colony gets a second tier; the
  // one olive morph stands on both islands.
  const plates=[
    plateCoral([4.38,2.98,-.30],.60,180,'#6a7e3e','#cbd49a',.42),plateCoral([4.88,2.62,.10],.46,183,'#64763a','#cbd49a',.32),
    plateCoral([-6.05,2.22,.30],.58,271,'#6a7e3e','#cbd49a',.42),plateCoral([-5.62,1.84,.70],.46,274,'#64763a','#cbd49a',.30),
    plateCoral([-4.05,supportHeight(-4.05,1.85)+.04,1.85],.36,277,'#6a7e3e','#cbd49a',.36)];
  scene.add(mesh(merge(plates),coralMaterial('plate-coral',{cells:46,relief:.25,side:THREE.DoubleSide,roughness:.8,sheen:.25,transmission:.16})));

  // Massive colonies on the rock shoulders, half buried in it: a meandering brain on the
  // left, and on the right a Favia whose cups carry a green oral disc between brown walls.
  const brain=massiveCoral([-4.95,supportHeight(-4.95,2.05)+.10,2.05],[.66,.40,.54],-94,'#8a7446','#2a3018',{ridges:26,relief:.17});
  scene.add(mesh(brain,coralMaterial('brain-coral',{cells:34,relief:.3,roughness:.6,transmission:.12,cup:[1.1,1.12,.95]})));
  const favia=massiveCoral([3.35,supportHeight(3.35,1.45)+.08,1.45],[.70,.44,.58],64,'#98805a','#6e5a3c',{ridges:0,relief:0});
  scene.add(mesh(favia,coralMaterial('favia-coral',{cells:13,relief:.5,roughness:.55,transmission:.12,cup:[.80,1.25,.60],groove:.62,
    shape:'.55*smoothstep(0.,.32,e)+.45*exp(-pow((d-.30)/.12,2.))-.55*(1.-smoothstep(0.,.15,d))'})));

  // Zoanthid mats: hundreds of polyps, instanced, standing on the rock's own slope and
  // packed so their tentacle rings touch. Each mat is one clone of one of a few morphs —
  // green, a tan Palythoa with lime mouths, a teal with orange mouths — drifting in hue
  // and brightness from polyp to polyp, so it reads as a colony, not a tiled texture.
  const MORPHS=[['#d8c060','#4f8a36','#173c1e'],['#a8d858','#7c6a3c','#2a2414'],['#e89a48','#3a7a6e','#12302a']];
  const patches=[[-6.00,1.85,1.02,0],[-3.13,2.03,.86,1],[2.72,.40,.80,0],[-5.45,-.26,.58,2],[4.74,-.81,.74,1],[-1.30,2.05,.55,2],[6.95,1.80,.62,0],[-6.95,1.25,.55,1]];
  const normal=new THREE.Vector3(),up=new THREE.Vector3(0,1,0),q=new THREE.Quaternion(),m=new THREE.Matrix4(),color=new THREE.Color(),mats=MORPHS.map(()=>({placed:[],colors:[]}));
  const zoaMat=coralMaterial('zoanthid-gardens',{cells:150,relief:.2,roughness:.55,side:THREE.DoubleSide,sheen:.4,sheenColor:'#c8f0a0',transmission:.28,cup:[1,1,1]});
  for(const [cx,cz,size,morph] of patches){const {placed,colors}=mats[morph];
    const count=Math.round(460*size*size);
    for(let j=0;j<count;j++){
      const a=j*2.399963+rng()*.3,r=size*Math.sqrt((j+.5)/count),x=cx+Math.cos(a)*r,z=cz+Math.sin(a)*r*.66;
      // A mat thins out towards its margin along a ragged line, so the colony has no
      // disc-shaped footprint.
      if(rng()<clamp((r/size-.62+.22*Math.sin(a*5.3+cx))/.40,0,1))continue;
      const e=.05,dx=(supportHeight(x+e,z)-supportHeight(x-e,z))/(2*e),dz=(supportHeight(x,z+e)-supportHeight(x,z-e))/(2*e);
      if(Math.hypot(dx,dz)>3.5||supportHeight(x,z)<.15)continue;
      normal.set(-dx,1,-dz).normalize().lerp(up,.35).add(new THREE.Vector3((rng()-.5)*.5,0,(rng()-.5)*.5)).normalize();
      const s=.045+rng()*.040,h=.06+rng()*.14;
      q.setFromUnitVectors(up,normal);m.compose(new THREE.Vector3(x,supportHeight(x,z)-.03,z),q,new THREE.Vector3(s,h,s));placed.push(m.clone());
      color.setRGB(1,1,1).offsetHSL((rng()-.5)*.07,(rng()-.5)*.25,(rng()-.5)*.16);colors.push(color.r,color.g,color.b);
    }
  }
  MORPHS.forEach((colours,i)=>{const {placed,colors}=mats[i],zoanthids=new THREE.InstancedMesh(polyp(...colours),zoaMat,placed.length);
    placed.forEach((matrix,k)=>zoanthids.setMatrixAt(k,matrix));zoanthids.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(colors),3);
    zoanthids.receiveShadow=true;zoanthids.computeBoundingSphere();scene.add(zoanthids);});

  // The gorgonian fan is the one colony that bends: it stands well up into the water
  // column and sways from its holdfast.
  const fan=flexible(seaFan([6.85,3.30,-.62],3.05,54,'#8a5a58','#e2b8b0',{yaw:-.26,order:9,thickness:.084,shorten:.84}),3.30,3.05);
  scene.add(mesh(fan,underwater(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.6}),{key:'reef-tissue',transmission:.18,vertex:responseGLSL,
    normal:`objectNormal.y-=.52*uv.x*dot(reefResponse(position,reefTime,.85),objectNormal.xz);`,
    begin:`transformed.xz+=reefResponse(position,reefTime,.85)*uv.x*uv.x*.30;`}),false));
}
