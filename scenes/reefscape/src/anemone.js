import * as THREE from 'three';
import { underwater,responseGLSL } from './water.js';
import { smoothstep,clamp,lerp,noise } from './math.js';
import { merge } from './geometry.js';
import { ANEMONES } from './layout.js';
import { supportHeight } from './terrain.js';
import { crownProfile, buildCrown, crownOrder, crownBudget } from './anemone-crown.js';

// The finished host retains its broad, long-fingered crown. Small specimens use the
// compact oral-disc layout in anemone-crown.js, with a wider disc, shorter column and
// shorter tentacles. All bodies share a mesh; all tentacles share an instanced draw.
const COLUMN_HEIGHT=.66,RIM=.36;
// Column silhouette as [share of height, radius/S]: the pedal disc gripping the rock, a
// waist, and the flare to the rim; cosine-blended so the rim rounds off and the waist is a
// smooth throat rather than a kink. Below the rock the foot spreads on, hidden, so no
// edge of it can float over a hollow.
const COLUMN=[[0,.37],[.10,.31],[.5,.28],[1,RIM]];
function columnRadius(u){
  if(u<0)return COLUMN[0][1]*(1-u*.8);
  for(let i=1;i<COLUMN.length;i++){const [u0,r0]=COLUMN[i-1],[u1,r1]=COLUMN[i];if(u<=u1)return lerp(r0,r1,.5-.5*Math.cos(Math.PI*(u-u0)/(u1-u0)));}
  return RIM;
}
// The disc is a shallow dome over the tentacle field; v runs from the rim (0) to the
// centre (1). The mouth is an elliptical slit with raised lips, so e is the distance from
// the centre stretched along the slit's axis.
const discLift=v=>.045*smoothstep(0,.45,v);
const mouthLift=e=>.030*Math.exp(-(((e-.20)/.08)**2))-.045*(1-smoothstep(0,.11,e));
const E=Math.E,hash=seed=>{const v=Math.sin(seed*E)*Math.cos(seed*Math.PI)*1e4;return v-Math.floor(v);};
// Verrucae: the adhesive warts a column carries, a staggered lattice crowding toward the
// rim with a share of its sites left bare, read as a pale mottle and a slight relief.
const VERRUCAE={rows:12,cols:20,skip:.22,jitter:.9,topBias:.55,size:.020};
function verruca(a,u,seed){
  const {rows,cols,skip,jitter,topBias,size}=VERRUCAE,rf=Math.pow(clamp(u,0,1),1/topBias)*rows;let best=0;
  for(let dr=-1;dr<=1;dr++){const row=Math.floor(rf)+dr;if(row<0||row>=rows)continue;
    const cf=a/(2*Math.PI)*cols-(row%2)/2;
    for(let dc=-1;dc<=1;dc++){const col=((Math.floor(cf)+dc)%cols+cols)%cols,site=row*cols+col+seed;
      if(hash(site*E+401)<skip)continue;
      const cy=Math.pow((row+.5+(hash(site*Math.PI+411)-.5)*jitter)/rows,topBias),cx=(col+.5+(row%2)/2+(hash(site*E+421)-.5)*jitter)/cols*2*Math.PI;
      const wart=size*(.45+.9*hash(site*E+441))*(.5+.5*cy),da=Math.atan2(Math.sin(a-cx),Math.cos(a-cx))*columnRadius(clamp(u,0,1)),dy=(u-cy)*COLUMN_HEIGHT;
      best=Math.max(best,Math.exp(-(da*da+dy*dy)/(wart*wart)*1.6)*(.55+.45*hash(site*Math.PI+431)));}}
  return best;
}
const FOOT=new THREE.Color('#4a2420'),SHAFT=new THREE.Color('#84402e'),LIP=new THREE.Color('#a8663e'),WART=new THREE.Color('#c89a80'),DISC=new THREE.Color('#a8564c'),LIPS=new THREE.Color('#c07868'),MOUTH=new THREE.Color('#3a1018');
// Each placement becomes one column-and-disc surface of revolution about its own axis,
// standing on the rock; the disc's dome carries the tentacle roots.
function specimen(spec,index){
  const crown=buildCrown(spec,index),{S,rim,compact}=crown,H=crown.height*S,up=new THREE.Vector3(0,1,0),axis=new THREE.Vector3();
  // The axis leans a little with the rock it stands on and by whatever the placement asks
  // for; the disc's position is authored, the column drops from it to wherever the rock is.
  const step=.25,lean=spec.lean||[0,0],slopeX=(supportHeight(spec.x+step,spec.z)-supportHeight(spec.x-step,spec.z))/(2*step),slopeZ=(supportHeight(spec.x,spec.z+step)-supportHeight(spec.x,spec.z-step))/(2*step);
  axis.set(-slopeX*.35+lean[0],1,-slopeZ*.35+lean[1]).normalize();
  const frame=new THREE.Quaternion().setFromUnitVectors(up,axis),disc=new THREE.Vector3(spec.x,spec.y-(compact?.12*S:0),spec.z);
  const foot=disc.clone().addScaledVector(axis,-H),sunk=Math.max(.12*S,foot.y-supportHeight(foot.x,foot.z)+.04);
  return {S,H,rim,compact,crown,frame,foot,sunk,seed:index*977,count:crown.count};
}
function bodyGeometry(sp){
  const {S,H,rim,frame,foot,sunk,seed}=sp,rings=56,segments=72,pos=[],col=[],idx=[],point=new THREE.Vector3(),color=new THREE.Color(),FOLD=.68;
  for(let j=0;j<=rings;j++){const t=j/rings;
    for(let i=0;i<=segments;i++){const a=i/segments*Math.PI*2;
      let r,y,shade=1;
      if(t<FOLD){
        // Column: u runs from below the rock (hidden, so the foot never floats) to the rim.
        const u=lerp(-sunk/H,1,t/FOLD),wart=verruca(a,u,seed),edge=1+.012*noise(Math.cos(a)*3+seed,u*4,Math.sin(a)*3);
        // Longitudinal striation: the mesenterial insertions show through the body wall as
        // shallow grooves that fade below the rim.
        const groove=Math.pow(.5+.5*Math.cos(a*14+seed),1.5)*(1-smoothstep(.70,.92,u)),base=columnRadius(u)*(1+(rim/RIM-1)*smoothstep(.35,1,u));
        r=S*base*edge*(1-.012*groove)*(1+.8*VERRUCAE.size*wart/base);y=H*u;
        color.copy(FOOT).lerp(SHAFT,smoothstep(.05,.55,u)).lerp(LIP,smoothstep(.55,1,u)).lerp(WART,Math.min(1,wart*.55));
        // The crown shades the top of the column and the grooves lie in their own shadow.
        shade=(1-.42*smoothstep(.72,1,u))*(1-.30*groove);
      }else{
        const v=(t-FOLD)/(1-FOLD),e=(1-v)*(1+.30*Math.cos(2*a+seed));r=S*rim*(1-v);y=H+S*(discLift(v)+mouthLift(e));
        // Mesenterial lines radiate from the mouth across the disc, which sits in the crown's shade.
        color.copy(DISC).lerp(LIPS,Math.exp(-(((e-.20)/.10)**2))).lerp(MOUTH,1-smoothstep(.04,.13,e));
        shade=.45*(1-.14*smoothstep(.55,1,Math.cos(a*24))*smoothstep(.15,.4,v)*(1-smoothstep(.7,.9,v)));
      }
      point.set(Math.cos(a)*r,y,Math.sin(a)*r).applyQuaternion(frame).add(foot);
      pos.push(point.x,point.y,point.z);col.push(color.r*shade,color.g*shade,color.b*shade);
      if(j<rings&&i<segments){const k=j*(segments+1)+i;idx.push(k,k+segments+1,k+1,k+1,k+segments+1,k+segments+2);}}}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(col,3));geo.setIndex(idx);geo.computeVertexNormals();
  return geo;
}
// A tentacle's mesh is a straight tube whose position.y is the axial parameter and whose
// cross-section is the profile in shares of the base radius; the vertex shader bends it.
function tentacleGeometry(){
  const levels=[0,.10,.20,.30,.40,.50,.59,.67,.74,.80,.85,.89,.92,.945,.96,.972,.983,.992,.998,1],sides=12,CAP=.945,pos=[],idx=[];
  // Tapers to half its base by the neck, swells into a small knob, then closes as a
  // rounded tip a little longer than it is wide.
  const neck=s=>(1-.50*Math.pow(s,2.0))*(1+.24*Math.exp(-(((s-.91)/.065)**2)));
  const radius=s=>s<=CAP?neck(s):neck(CAP)*Math.sqrt(Math.max(0,1-((s-CAP)/(1-CAP))**2));
  for(let j=0;j<levels.length;j++){const s=levels[j],r=radius(s);
    for(let i=0;i<=sides;i++){const a=i/sides*Math.PI*2;pos.push(Math.cos(a)*r,s,Math.sin(a)*r);if(j<levels.length-1&&i<sides){const k=j*(sides+1)+i;idx.push(k,k+sides+1,k+1,k+1,k+sides+1,k+sides+2);}}}
  // Closed base: a root standing a little proud of the disc would otherwise show as a black slot.
  const hub=pos.length/3;pos.push(0,0,0);for(let i=0;i<sides;i++)idx.push(hub,i,i+1);
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setIndex(idx);geo.computeVertexNormals();return geo;
}
// Every specimen has its own density budget; the host retains its previous shape.
export const TENTACLE_COUNT=ANEMONES.reduce((n,spec)=>n+crownProfile(spec).count,0);
export function createAnemone(scene){
  // Built after the terrain, so the columns stand on the baked rock rather than its analytic stand-in.
  const specimens=ANEMONES.map(specimen);
  const vertex=`attribute vec4 aShape;attribute vec4 aCurve;attribute float aFlex;varying float vAxis;varying float vAround;varying float vTone;varying float vRing;varying float vSeed;${responseGLSL}
    // The resting strand is a circular arc in the local x-y plane (x outward from the disc,
    // y the anemone's axis): it leaves the disc aCurve.x from the axis and turns a further
    // aCurve.y by the tip, so a small curl is a straight finger and a large one hooks over
    // the rim. A slight wander out of that plane, phased per tentacle, keeps a crown seen
    // face-on from reading as spines on a ball. The flow adds a cantilever bend on top,
    // solved once in the normal hook, which three runs before begin_vertex.
    vec2 tSway;vec2 tTip;
    void tentacleSolve(){vec3 root=instanceMatrix[3].xyz;mat3 toLocal=transpose(mat3(instanceMatrix));
      vec2 f=reefResponse(root,reefTime,.45+aShape.x*.60+aCurve.z*.50),g=reefResponse(root,reefTime,1.3+aShape.x*.80);
      float gain=.90*aShape.x*aFlex;
      tSway=(toLocal*vec3(f.x,0.,f.y)).xz*gain;tTip=(toLocal*vec3(g.x,0.,g.y)).xz*gain*.5;}
    vec3 arcPoint(float s){float c=max(aCurve.y,.02),t=aCurve.x+c*s;return vec3(cos(aCurve.x)-cos(t),sin(t)-sin(aCurve.x),.05*s*sin(s*5.5+aCurve.w*25.)*c)*aShape.x/c;}
    vec3 tentacleCenter(float s){vec2 h=tSway*s*s+tTip*s*s*s*s;return arcPoint(s)+vec3(h.x,0.,h.y);}
    vec3 tentacleSlope(float s){vec2 dh=tSway*2.*s+tTip*4.*s*s*s;float t=aCurve.x+aCurve.y*s;float z=.05*(sin(s*5.5+aCurve.w*25.)+5.5*s*cos(s*5.5+aCurve.w*25.));return vec3(sin(t),cos(t),z)*aShape.x+vec3(dh.x,0.,dh.y);}`;
  const mat=underwater(new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.52,metalness:0}),{
    key:'tank-anemone',vertex,
    // Tissue a few cells thick: the base passes a little light, the tip most of it.
    transmission:'(.20+.40*smoothstep(.20,1.,vAxis))',
    normal:`tentacleSolve();vec3 slope=normalize(tentacleSlope(position.y));vec3 tx=normalize(vec3(slope.y,-slope.x,0.));vec3 tz=normalize(cross(tx,slope));objectNormal=normalize((tx*normal.x+tz*normal.z)/aShape.y+slope*normal.y/length(tentacleSlope(position.y)));`,
    begin:`float s=position.y;vec3 dir=normalize(tentacleSlope(s));vec3 ax=normalize(vec3(dir.y,-dir.x,0.));vec3 az=normalize(cross(ax,dir));
      transformed=tentacleCenter(s)+(ax*position.x+az*position.z)*aShape.y;
      vAxis=s;vAround=atan(position.z,position.x);vTone=aShape.z;vRing=aShape.w;vSeed=aCurve.w;`,
    fragment:`varying float vAxis;varying float vAround;varying float vTone;varying float vRing;varying float vSeed;`,
    // Light through the thin edge of a tentacle: where the surface turns away from the
    // eye the tissue goes pale and warm instead of dark, and the wet tip carries the highlight.
    surfaceNormal:`float thin=smoothstep(.30,.95,vAxis),rim=pow(1.-abs(dot(normal,normalize(vViewPosition))),2.5);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.80,.64,.50),rim*thin*.32);roughnessFactor*=1.-.10*thin;`,
    // Kept well below the tone mapper's shoulder: under the reef lamp a brighter gold shaft
    // turns cream. The knob goes lilac. Brown pigment lies in irregular blotches along the
    // shaft, not rings: two waves
    // along the axis beat against one round the tube, phased per tentacle.
    color:`float mottle=smoothstep(.30,.80,.5+.5*sin(vAxis*17.+vSeed*40.)*sin(vAround*2.+vAxis*6.+vSeed*23.)*(.7+.3*sin(vAxis*7.3-vSeed*13.)));
      vec3 root=vec3(.16,.05,.04),shaft=mix(vec3(.42,.24,.07),vec3(.52,.33,.10),vTone),bands=vec3(.42,.20,.05),tip=vec3(.64,.46,.58);
      vec3 tissue=mix(root,shaft,smoothstep(0.,.22,vAxis));
      tissue=mix(tissue,bands,mottle*.45*smoothstep(.08,.30,vAxis)*(1.-smoothstep(.78,.98,vAxis)));
      tissue=mix(tissue,tip,smoothstep(.80,.96,vAxis));
      // Inside the crown the roots and the inner rings' shafts are buried among their
      // neighbours and only the tips and the outer envelope stand in the light; what
      // reaches the depths has come through tissue, so they go deep orange rather than
      // grey. Cheaper and steadier than shadowing a few hundred swaying instances.
      float buried=(1.-smoothstep(.22,.82,vAxis))*(1.-.60*vRing*vRing);
      diffuseColor.rgb=mix(tissue,vec3(.14,.06,.015),buried*.78);`
  });
  const tentacles=new THREE.InstancedMesh(tentacleGeometry(),mat,TENTACLE_COUNT);
  const shapes=new Float32Array(TENTACLE_COUNT*4),curves=new Float32Array(TENTACLE_COUNT*4),flex=new Float32Array(TENTACLE_COUNT);
  const matrix=new THREE.Matrix4(),rotation=new THREE.Matrix4(),X=new THREE.Vector3(),Y=new THREE.Vector3(),Z=new THREE.Vector3(),root=new THREE.Vector3();
  const crowns=[];
  for(const sp of specimens){const {S,H,rim,frame,foot,crown}=sp,instances=[];
    for(const t of crown.roots){
      X.set(Math.cos(t.angle),0,Math.sin(t.angle));Y.set(0,1,0);Z.crossVectors(X,Y);
      root.set(X.x*t.radius*rim*S,H+S*discLift(1-t.radius)-.006*S,X.z*t.radius*rim*S).applyQuaternion(frame).add(foot);
      rotation.makeBasis(X,Y,Z);matrix.makeRotationFromQuaternion(frame).multiply(rotation).setPosition(root);
      instances.push({matrix:matrix.clone(),shape:[t.length,t.girth,t.tone,t.ring],curve:[t.tilt,t.curl,t.lag,t.seed],flex:t.flex});
    }
    crowns.push({crown,instances,order:crownOrder(crown.roots)});
  }
  const shapeAttribute=new THREE.InstancedBufferAttribute(shapes,4),curveAttribute=new THREE.InstancedBufferAttribute(curves,4),flexAttribute=new THREE.InstancedBufferAttribute(flex,1);
  tentacles.geometry.setAttribute('aShape',shapeAttribute);tentacles.geometry.setAttribute('aCurve',curveAttribute);tentacles.geometry.setAttribute('aFlex',flexAttribute);
  let lastQuality=null;
  function setQuality(quality){
    if(quality===lastQuality)return;lastQuality=quality;let count=0;
    for(const {crown,instances,order} of crowns){
      const budget=crownBudget(crown,quality);
      for(let i=0;i<budget;i++){
        const t=instances[order[i]];tentacles.setMatrixAt(count,t.matrix);shapes.set(t.shape,count*4);curves.set(t.curve,count*4);flex[count]=t.flex;count++;
      }
    }
    tentacles.count=count;tentacles.instanceMatrix.needsUpdate=true;shapeAttribute.needsUpdate=true;curveAttribute.needsUpdate=true;flexAttribute.needsUpdate=true;
  }
  setQuality('detail');
  tentacles.frustumCulled=false;tentacles.receiveShadow=true;scene.add(tentacles);
  const body=new THREE.Mesh(merge(specimens.map(bodyGeometry)),underwater(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.44}),{key:'anemone-body',transmission:.10}));
  body.castShadow=body.receiveShadow=true;scene.add(body);
  return {tentacles,count:TENTACLE_COUNT,setQuality};
}
