import * as THREE from 'three';
import { merge, ellipsoid, tint } from './geometry.js';
import { randomGenerator, groundHeight } from './math.js';
import { underwater, extinctionGLSL, inscatterGLSL, surfaceGLSL, ABSORB, SURFACE, waterTime } from './water.js';
import { ROCKS, HOST, STATIONS, TANK } from './layout.js';
export {ROCKS,HOST,STATIONS};
let surfaceField=null,surfaceW=0,surfaceH=0;
export function supportHeight(x,z){
  if(surfaceField){const u=Math.max(0,Math.min(surfaceW-1,(x+9.65)/19.3*(surfaceW-1))),v=Math.max(0,Math.min(surfaceH-1,(z+4.1)/10.2*(surfaceH-1))),ix=Math.min(surfaceW-2,Math.floor(u)),iz=Math.min(surfaceH-2,Math.floor(v)),tx=u-ix,tz=v-iz;
    return (surfaceField[iz*surfaceW+ix]*(1-tx)+surfaceField[iz*surfaceW+ix+1]*tx)*(1-tz)+(surfaceField[(iz+1)*surfaceW+ix]*(1-tx)+surfaceField[(iz+1)*surfaceW+ix+1]*tx)*tz;}
  let y=groundHeight(x,z);for(const r of ROCKS){const q=((x-r[0])/r[3])**2+((z-r[2])/r[5])**2;if(q<1)y=Math.max(y,r[1]+r[4]*Math.sqrt(1-q)*.95);}return y;}

async function liveRockGeometry(){
  const response=await fetch(new URL('../assets/live-rock.bin',import.meta.url));if(!response.ok&&response.status!==0)throw new Error('Unable to load live-rock geometry.');
  const support=await fetch(new URL('../assets/rock-support.bin',import.meta.url));if(!support.ok&&support.status!==0)throw new Error('Unable to load attachment field.');
  const sb=await support.arrayBuffer(),sh=new Uint32Array(sb,0,2);surfaceW=sh[0];surfaceH=sh[1];surfaceField=new Float32Array(sb,8,surfaceW*surfaceH);
  const buffer=await response.arrayBuffer(),head=new Uint32Array(buffer,0,4),N=head[2],I=head[3];
  if(head[0]!==0x52454546||head[1]!==1||buffer.byteLength<16+N*27+I*4)throw new Error('Invalid live-rock asset.');
  const geo=new THREE.BufferGeometry();let offset=16;
  geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(buffer,offset,N*3),3));offset+=N*12;
  geo.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(buffer,offset,N*3),3));offset+=N*12;
  geo.setAttribute('surface',new THREE.BufferAttribute(new Uint8Array(buffer,offset,N*3),3,true));offset=Math.ceil((offset+N*3)/4)*4;
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(buffer,offset,I),1));geo.computeBoundingSphere();return geo;
}
export async function createTerrain(scene){
  const rng=randomGenerator(952),loader=new THREE.TextureLoader();
  const [rockGeo,sandMap,crustMap,reliefMap]=await Promise.all([liveRockGeometry(),
    ...['aragonite.png','live-rock-surface.png','live-rock-normal.png'].map(name=>loader.loadAsync(new URL('../assets/'+name,import.meta.url).href))]);
  for(const t of [sandMap,crustMap,reliefMap]){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=8;}
  // Aragonite is a bright bed under a reef lamp — near white, faintly warm — bright enough
  // to throw a real bounce back into the rock. The baked atlas carries the millimetre grain
  // and the odd shell flake; slow drifts break up the sheet at the wide view; and a warped
  // ripple field lays the soft marks the pumps leave, which the bed mesh is far too coarse
  // to carry. Troughs hold a little fine detritus, so they read a shade darker.
  const sandMat=underwater(new THREE.MeshStandardMaterial({roughness:.92,map:sandMap}),{key:'tank-sand',
    vertex:'attribute float shade;varying float vShade;varying vec3 vBedNormal;',begin:'vShade=shade;',normal:'vBedNormal=normal;',fragment:'varying float vShade;varying vec3 vBedNormal;',
    map:`vec2 bed=vReefWorld.xz;vec3 reefGrain=mix(texture2D(map,bed*.5).rgb,texture2D(map,bed*.21+.43).rgb,.55);
      float drift=sin(bed.x*.71+2.*sin(bed.y*.93))*sin(bed.y*.83+bed.x*.37)+.5*sin(bed.x*2.3-bed.y*1.7+sin(bed.y*2.9));
      // Two crossed wave sets, each bent by a slow warp, give the low hummocks of a bed
      // the pumps keep stirring rather than a ruled field of dune ripples.
      float warpA=bed.x*.83+1.7*sin(bed.y*.61),warpB=bed.y*1.37-bed.x*.29;
      float phase=dot(bed,vec2(.34,.94))*10.5+1.1*sin(warpA)+.6*sin(warpB),cross=dot(bed,vec2(.91,-.41))*7.3+.9*sin(warpB);
      vec2 dPhase=vec2(.34,.94)*10.5+1.1*cos(warpA)*vec2(.83,1.7*.61*cos(bed.y*.61))+.6*cos(warpB)*vec2(-.29,1.37),dCross=vec2(.91,-.41)*7.3+.9*cos(warpB)*vec2(-.29,1.37);
      float ripple=sin(phase)+.25*sin(2.*phase+.8)+.6*sin(cross);
      vec2 rippleSlope=.10*vShade*((cos(phase)+.5*cos(2.*phase+.8))*dPhase+.6*cos(cross)*dCross);`,
    color:`diffuseColor.rgb=mix(vec3(.42,.33,.23),vec3(.92,.875,.78),smoothstep(.42,.92,reefGrain.r))*(.90+.08*drift)*(.90+.055*ripple)*vShade;`,
    surfaceNormal:`vec2 grainSlope=reefGrain.gb*2.-1.;
      normal=normalize(mat3(viewMatrix)*normalize(normalize(vBedNormal)+vec3(grainSlope.x*.7-rippleSlope.x,0.,grainSlope.y*.7-rippleSlope.y)));`});
  // The bed runs past every frame edge, like Riverbed's, so no rim or wall is ever seen.
  const ground=new THREE.PlaneGeometry(30,14,180,84);ground.rotateX(-Math.PI/2);ground.translate(0,0,1.0);const p=ground.attributes.position,shade=new Float32Array(p.count);
  // Sand darkens where it meets the rock: a baked contact shadow from each rock footprint,
  // so the hardscape sits in the bed instead of floating on a lit sheet.
  for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i);p.setY(i,groundHeight(x,z));
    let contact=0;for(const r of ROCKS){const d=Math.max(0,Math.hypot((x-r[0])/r[3],(z-r[2])/r[5])-1)*Math.min(r[3],r[5]);contact=Math.max(contact,Math.exp(-d*d/(.55*r[4])));}
    shade[i]=1-.62*contact;}
  ground.setAttribute('shade',new THREE.BufferAttribute(shade,1));ground.computeVertexNormals();const sand=new THREE.Mesh(ground,sandMat);sand.receiveShadow=true;scene.add(sand);
  // Live rock is composed per pixel from the surface atlas, laid tri-planar over the baked
  // limestone: a dark brown-olive base of turf and detritus, coralline crust over the
  // raised parts in violet to rose, small bright encrusting polyps, and every pit dark.
  // The vertex stream brings sky visibility and how thick and which hue the crust runs.
  const rockMat=underwater(new THREE.MeshStandardMaterial({roughness:1,map:crustMap}),{key:'live-rock',
    vertex:'attribute vec3 surface;varying vec3 vRockNormal,vSurface;',begin:'vSurface=surface;',normal:'vRockNormal=normal;',
    fragment:'varying vec3 vRockNormal,vSurface;uniform sampler2D reefRelief;',map:`
    vec3 w=pow(abs(normalize(vRockNormal)),vec3(4.));w/=max(.001,w.x+w.y+w.z);
    vec3 q=vReefWorld*.62,f=vReefWorld*2.3+.37;
    vec3 crust=texture2D(map,q.yz).rgb*w.x+texture2D(map,q.xz).rgb*w.y+texture2D(map,q.xy).rgb*w.z;
    vec3 fine=texture2D(map,f.yz).rgb*w.x+texture2D(map,f.xz).rgb*w.y+texture2D(map,f.xy).rgb*w.z;
    vec3 rx=texture2D(reefRelief,q.yz).xyz,ry=texture2D(reefRelief,q.xz).xyz,rz=texture2D(reefRelief,q.xy).xyz;
    float relief=min(crust.r,fine.r*.9+.12),speck=rx.z*w.x+ry.z*w.y+rz.z*w.z;
    float cover=smoothstep(.47,.66,fine.g*.65+crust.g*.35+(vSurface.g-.5)*.5),hue=clamp(vSurface.b+(crust.b-.45)*.9+(fine.b-.5)*.5,0.,1.);
    vec3 coralline=mix(mix(vec3(.17,.025,.19),vec3(.36,.035,.16),smoothstep(.05,.55,hue)),vec3(.42,.08,.10),smoothstep(.6,1.,hue));
    coralline=mix(coralline,vec3(.42,.17,.27),fine.g*fine.r*.4);
    vec3 turf=mix(mix(vec3(.090,.052,.026),vec3(.085,.074,.018),crust.b),vec3(.050,.030,.022),fine.b*(1.-crust.b));
    vec3 rock=mix(turf,coralline,cover);
    rock=mix(rock,mix(vec3(.30,.34,.07),vec3(.40,.22,.30),step(.55,fine.b)),speck*.85);
    diffuseColor.rgb=rock*mix(.05,1.,smoothstep(.36,.68,relief))*(.18+.82*vSurface.r*vSurface.r*vSurface.r);`,
    surfaceNormal:`vec3 rn=normalize(vRockNormal);
      vec3 rq=vReefWorld*4.0;
      vec3 perturb=vec3(0.,rx.xy*2.-1.)*w.x+vec3(ry.x*2.-1.,0.,ry.y*2.-1.)*w.y+vec3(rz.xy*2.-1.,0.)*w.z;
      // The first octave lays the atlas over 1.6 units, so its pits land at the 1-3 cm the
      // eye resolves; this second one is the millimetre grain between them, for close views.
      vec2 fx=texture2D(reefRelief,rq.yz).xy*2.-1.,fy=texture2D(reefRelief,rq.xz).xy*2.-1.,fz=texture2D(reefRelief,rq.xy).xy*2.-1.;
      perturb+=(vec3(0.,fx)*w.x+vec3(fy.x,0.,fy.y)*w.y+vec3(fz,0.)*w.z)*.6;
      normal=normalize(mat3(viewMatrix)*normalize(rn+perturb*.9));
      // Coralline and turf are matt; only the bare raised limestone keeps a faint wet film.
      roughnessFactor*=1.-.22*smoothstep(.7,.95,relief)*(1.-cover);`});
  const rockCompile=rockMat.onBeforeCompile;rockMat.onBeforeCompile=shader=>{rockCompile(shader);shader.uniforms.reefRelief={value:reliefMap};};
  // Keep extra shader textures visible to the common disposal path.
  rockMat.userData.extraTextures=[reliefMap];
  const rocks=new THREE.Mesh(rockGeo,rockMat);rocks.castShadow=rocks.receiveShadow=true;scene.add(rocks);
  // Rubble is broken live rock, so it takes the rock's own crust, each piece its own mix.
  const rubble=[];
  for(let i=0;i<220;i++){
    const x=(rng()-.5)*22,z=-2.8+rng()*8;
    if(Math.abs(x)<1.2&&rng()>.32)continue;
    const s=.025+Math.pow(rng(),3)*.13,g=ellipsoid([x,groundHeight(x,z)+s*.14,z],[s,s*.53,s*.76],i+91,12),piece=new THREE.Color(.65+rng()*.25,rng(),rng());
    tint(g,()=>piece);rubble.push(g);
  }
  // merge() carries a color stream, which is where each piece's surface triple rides.
  const rubbleGeo=merge(rubble);rubbleGeo.setAttribute('surface',rubbleGeo.getAttribute('color'));rubbleGeo.deleteAttribute('color');
  const rubbleMesh=new THREE.Mesh(rubbleGeo,rockMat);rubbleMesh.receiveShadow=true;scene.add(rubbleMesh);
  return {obstacles:ROCKS,host:HOST,stations:STATIONS,rockSurface:rocks};
}
/** The tank's back wall, seen from inside the water. A real reef tank's rear pane is lost
 *  in the blue, so the wall is painted as the water carrying on past it: the same glow and
 *  shafts the post pass sums in front of it, integrated over a further stretch of water,
 *  so the frame fades into depth instead of stopping at a painted panel. Nothing of the
 *  enclosure itself (glass, rim, pumps) is modelled. */
const BEYOND=14,SURFACE_REACH=8;
export function createBackdrop(scene){
  const backMat=new THREE.ShaderMaterial({uniforms:{reefTime:{value:0}},
    vertexShader:`varying vec3 p;
      void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`varying vec3 p;uniform float reefTime;
      ${extinctionGLSL}${inscatterGLSL}${surfaceGLSL}
      void main(){
        // A ray climbing steeply enough meets the underside of the surface a short way past
        // the wall, and that is the faint shimmer along the top of frame. Farther off the
        // surface is lost in the water like everything else, so it fades out before it can
        // draw a horizon.
        vec3 absorb=vec3(${ABSORB.join(',')}),dir=normalize(p-cameraPosition);
        vec3 col=reefInscatter(p,reefTime,1.)*(1.-exp(-absorb*${BEYOND}.))/absorb;
        float reach=dir.y>0.?(${SURFACE.toFixed(3)}-p.y)/dir.y:${BEYOND}.;
        if(reach<${SURFACE_REACH}.){
          vec3 veil=exp(-absorb*reach);
          vec3 under=reefInscatter(p,reefTime,1.)*(1.-veil)/absorb+veil*reefSurfaceUnderside(p+dir*reach,dir,reach,reefTime);
          col=mix(col,under,smoothstep(${SURFACE_REACH}.,1.,reach));
        }
        col*=reefTransmittance(reefWaterPath(p,cameraPosition));
        gl_FragColor=vec4(col,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`});
  const backGeo=new THREE.PlaneGeometry(44,24);backGeo.translate(0,7,TANK.back-.05);
  const wall=new THREE.Mesh(backGeo,backMat);
  // The wall is not an `underwater` material, so it carries the shared clock itself.
  wall.onBeforeRender=()=>{backMat.uniforms.reefTime.value=waterTime.value;};
  scene.add(wall);
}
