import { QUALITY_PRESETS as presets, qualityName, activeQuality, frameRate, framebufferSize, renderScale } from '../../shared/render-policy.js';
import { installControls, reportSceneError, preferredQuality } from '../../shared/controls.js';
import { createComposite } from './composite.js';
import * as THREE from 'three';
import { createTerrain, createBackdrop } from './terrain.js';
import { createCorals } from './corals.js';
import { createAnemone } from './anemone.js';
import { createFishSchool } from './fish-model.js';
import { createShrimp } from './shrimp.js';
import { createParticles } from './particles.js';
import { ReefSimulation, FIXED_STEP } from './simulation.js';
import { views } from './views.js';
import { createFrameLoop } from '../../shared/frame-loop.js';
import { waterTime, LAMP, LAMP_RANGE } from './water.js';

const canvas=document.querySelector('#scene'),stage=document.querySelector('#stage'),loading=document.querySelector('#loading');
const params=new URLSearchParams(location.search),isHost=document.documentElement.dataset.motion==='host';
const capture=params.has('capture');
if(capture)document.body.classList.add('clean','capture');
let quality=preferredQuality(params);
let hostRate=60,onBattery=false,contextLost=false,disposed=false;
let paused=capture||(!isHost&&matchMedia('(prefers-reduced-motion: reduce)').matches);
let changeRate=()=>{},changePower=()=>{},feed=()=>{};
// Installed before WebGL startup so host rate 0 cannot be lost during initialization.
window.sceneRate=fps=>{if(!Number.isFinite(fps))return;const next=Math.max(0,Math.min(60,fps));if(next===hostRate)return;hostRate=next;changeRate();};
window.sceneFeed=()=>feed();
window.scenePause=value=>{paused=Boolean(value);changeRate();};
// The Mac host knows the power source; a browser only sometimes does (see getBattery below).
window.scenePower=battery=>{const next=Boolean(battery);if(next===onBattery)return;onBattery=next;changePower();};



async function start(){
  const renderer=new THREE.WebGLRenderer({canvas,antialias:false,alpha:false,powerPreference:'low-power',preserveDrawingBuffer:false});
  renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;
  renderer.shadowMap.enabled=true;renderer.shadowMap.needsUpdate=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.info.autoReset=false;
  const scene=new THREE.Scene();scene.background=new THREE.Color('#04101d');
  // Reef LEDs: a warm-white key from overhead, so the tops of rock, coral and fish catch
  // the light and everything under an edge falls into the water's blue, with a violet
  // actinic wash from above. The ground half of the hemisphere stands in for the bounce off
  // the bright aragonite bed, so the shaded side of a coral branch reads as tissue in shadow
  // rather than a black stick. The sky half is the water column itself, deep blue, and kept
  // low: what the lamp does not reach stays dark.
  scene.add(new THREE.HemisphereLight('#3c56c0','#4a4636',.42));
  const sun=new THREE.DirectionalLight('#ffdfba',4.3);sun.position.set(LAMP.x,LAMP.y,LAMP.z).multiplyScalar(LAMP_RANGE);sun.target.position.set(0,0,0);sun.castShadow=true;
  sun.shadow.mapSize.set(1536,1536);Object.assign(sun.shadow.camera,{left:-12,right:12,top:10,bottom:-9,near:1,far:43});sun.shadow.bias=-.0007;sun.shadow.normalBias=.018;sun.shadow.radius=2;sun.shadow.intensity=.86;
  scene.add(sun,sun.target);
  const actinic=new THREE.DirectionalLight('#4f6dff',.78);actinic.position.set(3,12,-2);scene.add(actinic);
  const bounce=new THREE.DirectionalLight('#7f8fd0',.18);bounce.position.set(3,6,8);scene.add(bounce);
  // The lamp's light scattered forward by the water behind a subject comes back toward the
  // camera from the far side: a cool rim on the backs of fish and along the crests of rock.
  const rim=new THREE.DirectionalLight('#7fc4ff',1.1);rim.position.set(1.5,6,-9);scene.add(rim);
  // The key light's shadow map, read by the motes so they go dark where the lamp is
  // blocked. The texture only exists once the first beauty pass has drawn it, so render()
  // fills it in.
  const shadow={reefShadowMap:{value:null},reefShadowMatrix:{value:sun.shadow.matrix}};
  const camera=new THREE.PerspectiveCamera(36,16/9,.08,140);
  // Capture mode may bring its own camera, for judging a detail no named view frames:
  // ?view=custom&camera=x,y,z,tx,ty,tz,fov
  if(capture&&params.has('camera')){const c=params.get('camera').split(',').map(Number);if(c.length>=6&&c.every(Number.isFinite))views.custom={position:c.slice(0,3),target:c.slice(3,6),fov:c[6]||30};}
  let view=params.get('view')||'wide';if(!views[view])view='wide';
  const postRight=new THREE.Vector3(),postUp=new THREE.Vector3(),postForward=new THREE.Vector3();
  // Declared here, but only ever called once the post material below exists.
  function syncPostCamera(){
    camera.updateMatrixWorld();const e=camera.matrixWorld.elements,tan=Math.tan(camera.fov*Math.PI/360);
    postRight.set(e[0],e[1],e[2]);postUp.set(e[4],e[5],e[6]);postForward.set(-e[8],-e[9],-e[10]);
    post.uniforms.eye.value.copy(camera.position);
    post.uniforms.rayX.value.copy(postRight).multiplyScalar(tan*camera.aspect);
    post.uniforms.rayY.value.copy(postUp).multiplyScalar(tan);
    post.uniforms.rayZ.value.copy(postForward);
  }
  function applyView(name){const v=views[name];view=name;camera.position.set(...v.position);camera.lookAt(...v.target);camera.fov=v.fov;camera.updateProjectionMatrix();syncPostCamera();}
  // The beauty pass lands in an HDR target; a short screen-space pass adds contact occlusion
  // where rock meets sand and coral meets rock, then a light vignette, before tone mapping.
  const { target, post, postScene, postCamera } = createComposite(camera,shadow);
  applyView(view);
  const envData=new Uint8Array(128*64*4);
  for(let y=0;y<64;y++)for(let x=0;x<128;x++){
    const top=1-y/63,glow=Math.exp(-(((top-.86)/.13)**2));const i=(y*128+x)*4;
    envData[i]=5+glow*186;envData[i+1]=7+glow*208;envData[i+2]=24+glow*231;envData[i+3]=255;
  }
  const environment=new THREE.DataTexture(envData,128,64);environment.mapping=THREE.EquirectangularReflectionMapping;environment.colorSpace=THREE.SRGBColorSpace;environment.needsUpdate=true;scene.environment=environment;scene.environmentIntensity=.30;
  createBackdrop(scene);
  const {rockSurface}=await createTerrain(scene);
  await createCorals(scene);
  const anemone=createAnemone(scene);
  const rockPrepass=new THREE.Scene();
  // Resolve porous rock depth before its expensive material. Hidden inner surfaces
  // then fail the depth test without sampling the triplanar texture layers.
  const rockDepthMaterial=new THREE.MeshBasicMaterial({colorWrite:false});
  rockPrepass.add(new THREE.Mesh(rockSurface.geometry,rockDepthMaterial));
  const simulation=new ReefSimulation();
  const fishSchool=createFishSchool(scene,simulation);
  const shrimp=createShrimp(scene,simulation),particles=createParticles(scene,simulation,shadow);
  function sync(dt){
    waterTime.value=simulation.time;
    fishSchool.update();
    shrimp.update();particles.update(dt);
  }
  let loop=null,accumulator=0,frames=0,zeroSize=false;
  let cpuEMA=0,slowSamples=0,autoScale=1,ratio=1;
  const running=()=>!disposed&&!paused&&!document.hidden&&!contextLost&&!zeroSize&&hostRate>0;
  const fps=()=>frameRate(quality,hostRate,onBattery);
  function render(){
    if(contextLost||disposed||document.hidden)return;
    renderer.info.reset();
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.autoClear=false;
    renderer.render(rockPrepass,camera);
    // A color background forces a clear even with autoClear disabled.
    renderer.autoClearDepth=false;
    renderer.render(scene,camera);
    renderer.autoClear=true;
    renderer.autoClearDepth=true;
    shadow.reefShadowMap.value=sun.shadow.map.texture;
    renderer.setRenderTarget(null);
    renderer.render(postScene,postCamera);
    frames++;
    if(!loading.hidden)loading.hidden=true;
  }
  function renderFrame(elapsed,now){
    const before=performance.now();
    accumulator+=elapsed;let steps=0;
    while(accumulator>=FIXED_STEP&&steps<6){simulation.step(FIXED_STEP,pointer);accumulator-=FIXED_STEP;steps++;}
    if(steps===6)accumulator=0;
    if(pointer){pointer.speed*=Math.exp(-elapsed*8);}
    sync(steps*FIXED_STEP);render();
    const cost=performance.now()-before;cpuEMA=cpuEMA?cpuEMA*.96+cost*.04:cost;
    // Conservative one-way downshift, never an oscillating up/down resolution loop.
    // CPU render time is only a pressure signal, not a claimed hardware GPU measurement.
    if(cpuEMA>1000/fps()*.85||elapsed>1.65/fps())slowSamples++;else slowSamples=Math.max(0,slowSamples-1);
    if(slowSamples>80&&autoScale>.72&&!capture){autoScale=Math.max(.72,autoScale-.10);slowSamples=0;resize(false);}
  }
  let updateControls=()=>{};
  function restart(){
    accumulator=0;
    loop?.setRate(fps());
    loop?.setPaused(paused);
    loop?.setHidden(document.hidden||contextLost||disposed||zeroSize);
    updateControls();
  }
  changeRate=restart;
  changePower=()=>{resize();restart();};
  function resize(draw=true){
    const width=stage.clientWidth,height=stage.clientHeight,active=activeQuality(quality,onBattery),preset=presets[active];
    const wasZeroSize=zeroSize;
    zeroSize=!(width>0&&height>0);
    if(zeroSize){restart();return;}
    anemone.setQuality(active);
    ratio=renderScale(quality,devicePixelRatio,onBattery)*autoScale;
    const {width:w,height:h}=framebufferSize(width,height,ratio,renderer.capabilities.maxTextureSize,preset.pixels);ratio=w/width;renderer.setSize(w,h,false);target.setSize(w,h);post.uniforms.size.value.set(w,h);post.uniforms.aoRadiusScale.value=h/972;
    camera.aspect=width/height;
    if(view==='wide'){
      const focus=-3.1*Math.min(1,Math.max(0,(1.3-camera.aspect)/.65));
      camera.position.set(views.wide.position[0]+focus,views.wide.position[1],views.wide.position[2]);
      camera.lookAt(views.wide.target[0]+focus,views.wide.target[1],views.wide.target[2]);
    }
    // Keep the central host in portrait; wide screens get the two tank islands.
    camera.fov=views[view].fov+(view==='wide'&&camera.aspect<1.3?Math.min(15,(1.3-camera.aspect)*22):0);
    camera.updateProjectionMatrix();syncPostCamera();particles.setPixelRatio(ratio);
    if(wasZeroSize)restart();
    if(draw&&!document.hidden)render();
  }
  const observer=new ResizeObserver(()=>resize());observer.observe(stage);
  resize(false);

  let pointer=null,lastPointer=0;const point=new THREE.Vector3(),lastPoint=new THREE.Vector3(),ndc=new THREE.Vector2(),raycaster=new THREE.Raycaster();
  const plane=new THREE.Plane(new THREE.Vector3(0,0,1),-2.4);
  function project(event){const bounds=canvas.getBoundingClientRect();ndc.set((event.clientX-bounds.left)/bounds.width*2-1,-(event.clientY-bounds.top)/bounds.height*2+1);raycaster.setFromCamera(ndc,camera);return raycaster.ray.intersectPlane(plane,point);}
  canvas.addEventListener('pointermove',event=>{
    if(!running()||!project(event))return;const now=performance.now();
    const speed=pointer?point.distanceTo(lastPoint)/Math.max(.016,(now-lastPointer)/1000):0;
    if(!pointer)pointer={position:new THREE.Vector3(),speed:0};
    pointer.position.copy(point);pointer.speed=Math.min(15,speed);lastPoint.copy(point);lastPointer=now;
  },{passive:true});
  canvas.addEventListener('pointerleave',()=>{pointer=null;});
  canvas.addEventListener('pointerdown',event=>{if(event.button!==0||!running()||!project(event))return;simulation.feed(point.x,1);});
  feed=()=>{if(running())simulation.feed(-2.6+Math.sin(simulation.time*.73)*1.7,1.3);};
  updateControls=installControls({stage,isPaused:()=>paused,isRunning:running,
    pause:window.scenePause,feed,quality:()=>quality,
    setQuality(value){quality=qualityName(value);autoScale=1;resize();restart();},
  });
  document.addEventListener('visibilitychange',()=>{pointer=null;if(!document.hidden){resize(false);if(paused)render();}restart();});
  const motionQuery=matchMedia('(prefers-reduced-motion: reduce)');motionQuery.addEventListener('change',event=>{if(!isHost&&event.matches){paused=true;restart();}});
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();contextLost=true;restart();loading.hidden=false;if(loading.querySelector('p'))loading.querySelector('p').textContent='Restoring aquarium…';});
  canvas.addEventListener('webglcontextrestored',()=>{contextLost=false;renderer.shadowMap.needsUpdate=true;resize(false);render();restart();});
  if(navigator.getBattery&&!isHost){navigator.getBattery().then(battery=>{function update(){onBattery=!battery.charging;resize();restart();}battery.addEventListener('chargingchange',update);update();}).catch(()=>{});}

  // Capture mode advances the actual simulation, then renders the actual WebGL scene.
  // No image composites or alternative high-cost renderer for screenshots.
  if(capture){const time=Math.min(120,Math.max(0,Number(params.get('time'))||0));for(let i=0;i<Math.round(time/FIXED_STEP);i++)simulation.step(FIXED_STEP);}
  sync(0);render();
  // Static skeleton + limestone shadow map only. Moving organisms do not cast stale
  // animated shadows: no false frozen fish silhouettes, no per-frame shadow pass.
  renderer.shadowMap.autoUpdate=false;
  loop=createFrameLoop(renderFrame,{fps:fps(),paused,hidden:document.hidden||contextLost||zeroSize});
  restart();
  window.reef={
    ready:true,diagnostics:()=>({...simulation.diagnostics(),frames,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,
      pixels:[canvas.width,canvas.height],quality,effectiveFPS:running()?fps():0,renderScale:ratio,cpuFrameEMA:cpuEMA,scheduled:loop.state.pending,paused,hostRate,hidden:document.hidden,contextLost,tentacles:anemone.tentacles.count,webgl:renderer.capabilities.isWebGL2?'WebGL2':'WebGL2',renderer:renderer.getContext().getParameter(renderer.getContext().RENDERER)}),
    setView(name){if(!views[name])throw new RangeError('Unknown reef camera');applyView(name);resize();},
    pause(value=true){paused=Boolean(value);restart();},
    advance(seconds){if(!paused)throw new Error('Pause before advancing deterministic capture time.');if(!Number.isFinite(seconds)||seconds<0||seconds>120)throw new RangeError('Advance must be 0–120 seconds.');for(let i=0;i<Math.round(seconds/FIXED_STEP);i++)simulation.step(FIXED_STEP);sync(seconds);render();},
    feed:()=>feed(),
  };
  window.sceneStats=window.reef.diagnostics;
  if(params.get('diagnostics')==='1'){
    const {installDiagnostics}=await import('../../shared/diagnostics.js');
    installDiagnostics({renderer,loop,renderFrame,stats:window.sceneStats});
  }
  // Release owned GPU objects and stop callbacks when a page is really discarded.
  // BFCache pages retain resources and restart from their old simulation time.
  addEventListener('pagehide',event=>{
    loop.setHidden(true);if(event.persisted)return;disposed=true;loop.dispose();observer.disconnect();
    const geometries=new Set(),materials=new Set(),textures=new Set();scene.traverse(object=>{if(object.geometry)geometries.add(object.geometry);if(object.material)(Array.isArray(object.material)?object.material:[object.material]).forEach(m=>materials.add(m));});
    for(const m of materials){for(const value of Object.values(m))if(value?.isTexture)textures.add(value);for(const tex of m.userData?.extraTextures||[])textures.add(tex);m.dispose();}
    geometries.forEach(g=>g.dispose());textures.forEach(t=>t.dispose());sun.shadow.map?.dispose();environment.dispose();target.dispose();post.dispose();rockDepthMaterial.dispose();renderer.dispose();
  });
  addEventListener('pageshow',event=>{if(event.persisted){resize(false);render();restart();}});
}
start().catch(reportSceneError);
