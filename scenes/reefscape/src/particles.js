import * as THREE from 'three';
import { randomGenerator } from './math.js';
import { currentAt, extinctionGLSL, shadowGLSL, inscatterGLSL, waterTime } from './water.js';

/** Suspended matter. Real tank water is never optically empty: there is always detritus
 *  and marine snow drifting in the circulation, and it is most of what tells the eye the
 *  water has a front and a back. A mote is sized and faded by its own distance, so the
 *  near ones read as soft close-up specks and the far ones as fine haze. A mote is lit by
 *  the same light the water around it scatters, so it brightens in a shaft and toward the
 *  surface and goes dark in the rock's shadow: dust in a beam, not stars on a backdrop. */
// A mote is far denser than the water around it, so it sends back many times the light
// the same volume of clear water scatters.
const MOTE_GAIN=70;
export function createParticles(scene,simulation,shadow){
  const rng=randomGenerator(846),N=4500,pos=new Float32Array(N*3),vel=new THREE.Vector3(),point=new THREE.Vector3();
  // grain.x scales the mote, grain.y its brightness, grain.z how fast it sinks. A few
  // large slow flecks among many fine ones, rather than one uniform dust.
  const grain=new Float32Array(N*3),sink=new Float32Array(N);
  for(let i=0;i<N;i++){
    pos.set([(rng()-.5)*21,rng()*8,-4+rng()*10],i*3);
    const big=rng()<.05,size=big?1.6+rng()*1.4:.45+rng()*.6;
    grain.set([size,big?.3+rng()*.3:.9+rng()*.9,0],i*3);
    sink[i]=(big?.016:.006)+rng()*.008;
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(pos,3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('grain',new THREE.BufferAttribute(grain,3));
  const mat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,uniforms:{pixelRatio:{value:1},reefTime:waterTime,...shadow},
    vertexShader:`uniform float pixelRatio;uniform float reefTime;attribute vec3 grain;varying vec3 glow;varying float disc;
      #include <packing>
      ${extinctionGLSL}${shadowGLSL}${inscatterGLSL}
      void main(){
        vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;
        // A speck close to the lens is a soft disc the size of the lens's blur circle, not
        // a sharper point; the fragment spreads the big ones so their light stays the same.
        disc=clamp(26.*grain.x/(-mv.z),2.,18.);gl_PointSize=disc*pixelRatio;
        // A light dusting, not snow: the motes give the water a front and a back and catch
        // the shafts, they are not there to be looked at.
        // A mote is large beside a wavelength, so it scatters the lamp's light without the
        // water's own blue cast: brightness from the water around it, colour from the lamp,
        // blue only from the water between it and the glass.
        vec3 light=reefInscatter(position,reefTime,reefLit(position));
        glow=grain.y*${MOTE_GAIN.toFixed(1)}*dot(light,vec3(.3,.4,.3))*vec3(.62,.84,1.)*reefTransmittance(reefWaterPath(position,cameraPosition));
      }`,
    fragmentShader:`varying vec3 glow;varying float disc;
      void main(){vec2 c=gl_PointCoord-.5;float a=exp(-dot(c,c)*10.)*min(1.,5./disc);gl_FragColor=vec4(glow*a,1.);}`});
  const points=new THREE.Points(g,mat);points.frustumCulled=false;scene.add(points);
  const foodGeo=new THREE.SphereGeometry(1,7,5),foodMat=new THREE.MeshStandardMaterial({color:'#b49366',roughness:.9});
  const pellets=new THREE.InstancedMesh(foodGeo,foodMat,simulation.food.length);pellets.frustumCulled=false;scene.add(pellets);const dummy=new THREE.Object3D();
  return {update(dt){
    for(let i=0;i<N;i++){
      point.fromArray(pos,i*3);currentAt(point,simulation.time,vel);point.addScaledVector(vel,dt);point.y-=dt*sink[i];
      if(point.x>11)point.x=-11;if(point.x<-11)point.x=11;if(point.y<-.4)point.y=8;if(point.z>6)point.z=-4;if(point.z<-4)point.z=6;point.toArray(pos,i*3);
    }
    g.attributes.position.needsUpdate=true;
    simulation.food.forEach((p,i)=>{dummy.position.copy(p.position);dummy.scale.setScalar(p.active?p.size*(1-Math.pow(p.age/36,4)):0);dummy.updateMatrix();pellets.setMatrixAt(i,dummy.matrix);});
    pellets.instanceMatrix.needsUpdate=true;
  },setPixelRatio(r){mat.uniforms.pixelRatio.value=r;}};
}
