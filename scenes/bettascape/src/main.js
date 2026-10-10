import { Vector3 } from 'three';
import { QUALITY_PRESETS as presets, qualityName, activeQuality, frameRate, framebufferSize, renderScale } from '../../shared/render-policy.js';
import { installControls, reportSceneError, preferredQuality } from '../../shared/controls.js';
import { createFrameLoop } from '../../shared/frame-loop.js';
import { randomGenerator } from '../../shared/random.js';
import { createBetta, FIXED_STEP } from './behaviour.js';
import { PELLET } from './food.js';
import { createRenderer } from './render.js';
import { createView, homeBounds } from './view.js';

const canvas=document.querySelector('#scene'),stage=document.querySelector('#stage'),loading=document.querySelector('#loading');
const params=new URLSearchParams(location.search),isHost=document.documentElement.dataset.motion==='host';
const capture=params.has('capture');
if(capture)document.body.classList.add('clean','capture');
let quality=preferredQuality(params);
let hostRate=isHost?0:60,onBattery=false,contextLost=false,disposed=false;
let paused=capture||(!isHost&&matchMedia('(prefers-reduced-motion: reduce)').matches);
let changeRate=()=>{},changePower=()=>{},feed=()=>{};
// Installed before WebGL startup so host rate 0 cannot be lost during initialization.
window.sceneRate=fps=>{if(!Number.isFinite(fps))return;const next=Math.max(0,Math.min(60,fps));if(next===hostRate)return;hostRate=next;changeRate();};
window.sceneFeed=()=>feed();
window.scenePause=value=>{paused=Boolean(value);changeRate();};
// The Mac host knows the power source; a browser only sometimes does (see getBattery below).
window.scenePower=battery=>{const next=Boolean(battery);if(next===onBattery)return;onBattery=next;changePower();};

// Capture framing, both optional: ?camera=yaw,pitch,distance[,x,y,z] orbits the camera about a
// target; ?pose=x,y,z,yaw[,pitch,roll] holds the fish still in a pose.
function numbers(name,min){const v=(params.get(name)||'').split(',').map(Number);return v.length>=min&&v.every(Number.isFinite)?v:null;}

async function start(){
  // A capture is repeatable; a visit is not.
  const seed=capture?1:Math.floor(Math.random()*2**32);
  const random=randomGenerator(seed);
  const betta=createBetta({random});
  const {renderer,camera,render:draw,resize:sizeTargets,dispose}=createRenderer(canvas,betta,randomGenerator(seed^0x5bd1e995));
  const between=([min,max])=>min+Math.floor(random()*(max-min+1));
  const point=new Vector3();
  let pointer=null;
  let loop=null,accumulator=0,frames=0,zeroSize=false,lastDraw=0,viewMoving=false;
  let cpuEMA=0,slowSamples=0,autoScale=1,ratio=1,supersample=1;
  const running=()=>!disposed&&!paused&&!document.hidden&&!contextLost&&!zeroSize&&hostRate>0;
  const fps=()=>frameRate(quality,hostRate,onBattery);
  // A paused scene draws on demand: orbiting or zooming a still fish still has to be seen.
  const redraw=()=>{if(!running())loop?.invalidate();};
  // The wallpaper never gets clicks or drags, so its camera stays home.
  const view=createView(camera,canvas,{interactive:!isHost,follow:()=>betta.fish.pos,onChange:redraw,
    onTap(x,y){if(running()&&view.project(x,y,point))betta.feed(point.x,point.z,between(PELLET.click));}});
  if(capture){
    const c=numbers('camera',3);if(c)view.set({yaw:c[0],pitch:c[1],dist:c[2],...(c.length>=6&&{target:c.slice(3,6)})});
    const p=numbers('pose',4);if(p)betta.pose({x:p[0],y:p[1],z:p[2],yaw:p[3],pitch:p[4]||0,roll:p[5]||0});
  }

  function render(dt,advanced){
    if(contextLost||disposed||document.hidden)return;
    draw({dt,advanced,cheap:quality==='eco'});
    frames++;
    if(!loading.hidden)loading.hidden=true;
  }
  function renderFrame(elapsed,now){
    const before=performance.now();
    // Real time since the last drawn frame drives the camera, focus and shutter; a frame after a
    // long gap starts them afresh.
    const dt=lastDraw&&now-lastDraw<250?Math.min(.1,(now-lastDraw)/1000):0;lastDraw=now;
    accumulator+=elapsed;let steps=0;
    while(accumulator>=FIXED_STEP&&steps<6){betta.step(FIXED_STEP,camera.position);accumulator-=FIXED_STEP;steps++;}
    if(steps===6)accumulator=0;
    viewMoving=view.update(dt);
    if(pointer&&!view.dragging&&view.project(pointer.x,pointer.y,point))betta.point(point,false);
    render(dt,steps>0);
    if(!running()){if(viewMoving)loop?.invalidate();return;}
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
  function resize(redrawNow=true){
    const width=stage.clientWidth,height=stage.clientHeight,active=activeQuality(quality,onBattery),preset=presets[active];
    const wasZeroSize=zeroSize;
    zeroSize=!(width>0&&height>0);
    if(zeroSize){restart();return;}
    ratio=renderScale(quality,devicePixelRatio,onBattery)*autoScale;
    const {width:w,height:h}=framebufferSize(width,height,ratio,renderer.capabilities.maxTextureSize,preset.pixels);ratio=w/width;
    supersample=sizeTargets(width,height,w,h,preset.pixels);
    const {min,max}=homeBounds(width/height);betta.setBounds(min,max);
    if(wasZeroSize)restart();
    if(redrawNow&&!document.hidden)render(0,false);
  }
  const observer=new ResizeObserver(()=>resize());observer.observe(stage);
  resize(false);

  canvas.addEventListener('pointermove',event=>{
    pointer={x:event.clientX,y:event.clientY};
    if(view.project(pointer.x,pointer.y,point))betta.point(point);
  },{passive:true});
  canvas.addEventListener('pointerleave',()=>{pointer=null;betta.point(null);});
  // A pinch on the water somewhere along the tank, as a keeper would feed.
  const pinch=()=>betta.feed(Math.sin(betta.time*.73)*betta.bounds.max.x*.7,-.3+.25*Math.sin(betta.time*.41),between(PELLET.pinch));
  feed=()=>{if(running())pinch();};
  updateControls=installControls({stage,isPaused:()=>paused,isRunning:running,
    pause:window.scenePause,feed,quality:()=>quality,
    setQuality(value){quality=qualityName(value);autoScale=1;resize();restart();},
  });
  document.addEventListener('visibilitychange',()=>{pointer=null;betta.point(null);if(!document.hidden){resize(false);if(paused)render(0,false);}restart();});
  const motionQuery=matchMedia('(prefers-reduced-motion: reduce)');motionQuery.addEventListener('change',event=>{if(!isHost&&event.matches){paused=true;restart();}});
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();contextLost=true;restart();loading.hidden=false;if(loading.querySelector('p'))loading.querySelector('p').textContent='Restoring aquarium…';});
  canvas.addEventListener('webglcontextrestored',()=>{contextLost=false;resize(false);render(0,false);restart();});
  if(navigator.getBattery&&!isHost){navigator.getBattery().then(battery=>{function update(){onBattery=!battery.charging;resize();restart();}battery.addEventListener('chargingchange',update);update();}).catch(()=>{});}

  // Capture mode advances the actual simulation, then renders the actual WebGL scene.
  const advance=seconds=>{for(let i=0;i<Math.round(seconds/FIXED_STEP);i++)betta.step(FIXED_STEP,camera.position);};
  if(capture)advance(Math.min(120,Math.max(0,Number(params.get('time'))||0)));
  betta.step(0,camera.position);render(0,false);
  loop=createFrameLoop(renderFrame,{fps:fps(),paused,hidden:document.hidden||contextLost||zeroSize});
  restart();
  const gl=renderer.getContext();
  window.betta={
    ready:true,diagnostics:()=>({...betta.diagnostics(),frames,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,
      pixels:[canvas.width,canvas.height],supersample,lensPass:quality!=='eco',quality,effectiveFPS:running()?fps():0,renderScale:ratio,cpuFrameEMA:cpuEMA,scheduled:loop.state.pending,paused,hostRate,hidden:document.hidden,contextLost,webgl:'WebGL2',renderer:gl.getParameter(gl.RENDERER)}),
    setView(orbit){view.set(orbit);render(0,false);},
    pose(state){betta.pose(state);betta.step(0,camera.position);render(0,false);},
    pause(value=true){paused=Boolean(value);restart();},
    advance(seconds){if(!paused)throw new Error('Pause before advancing deterministic capture time.');if(!Number.isFinite(seconds)||seconds<0||seconds>120)throw new RangeError('Advance must be 0–120 seconds.');advance(seconds);render(0,true);},
    feed:pinch,
  };
  window.sceneStats=window.betta.diagnostics;
  if(params.get('diagnostics')==='1'){
    const {installDiagnostics}=await import('../../shared/diagnostics.js');
    installDiagnostics({renderer,loop,renderFrame,stats:window.sceneStats});
  }
  // Release owned GPU objects and stop callbacks when a page is really discarded.
  // BFCache pages retain resources and restart from their old simulation time.
  addEventListener('pagehide',event=>{
    loop.setHidden(true);if(event.persisted)return;disposed=true;loop.dispose();observer.disconnect();dispose();
  });
  addEventListener('pageshow',event=>{if(event.persisted){resize(false);render(0,false);restart();}});
}
start().catch(reportSceneError);
