import * as THREE from 'three';
import { noise, randomGenerator, smoothstep } from './math.js';

const V = (x=0,y=0,z=0) => new THREE.Vector3(x,y,z);
/** Merge compatible static meshes once. No BufferGeometryUtils / additional dependency. */
export function merge(geometries){
  // Preserve indices: static coral/animal parts formerly expanded every triangle
  // into three independent vertices. Preallocation also avoids giant JS arrays.
  let count=0,indexCount=0;
  for(const g of geometries){count+=g.attributes.position.count;indexCount+=g.index?g.index.count:g.attributes.position.count;}
  const out=new THREE.BufferGeometry(),arrays={position:new Float32Array(count*3),normal:new Float32Array(count*3),uv:new Float32Array(count*2),color:new Float32Array(count*3)};
  const indices=count>65535?new Uint32Array(indexCount):new Uint16Array(indexCount);
  let offset=0,ii=0;
  for(const g of geometries){const N=g.attributes.position.count;
    for(const [name,dest] of Object.entries(arrays)){const size=name==='uv'?2:3,attr=g.attributes[name];if(attr)dest.set(attr.array,offset*size);else if(name==='color')dest.fill(1,offset*size,(offset+N)*size);}
    if(g.index){for(const i of g.index.array)indices[ii++]=i+offset;}else for(let i=0;i<N;i++)indices[ii++]=i+offset;
    offset+=N;g.dispose();
  }
  for(const [name,data] of Object.entries(arrays))out.setAttribute(name,new THREE.BufferAttribute(data,name==='uv'?2:3));
  out.setIndex(new THREE.BufferAttribute(indices,1));out.computeBoundingSphere();return out;
}
export function tint(g, fn) {
  const p=g.attributes.position, c=new Float32Array(p.count*3), point=V();
  for(let i=0;i<p.count;i++) { point.fromBufferAttribute(p,i); const color=fn(point,i); c[i*3]=color.r;c[i*3+1]=color.g;c[i*3+2]=color.b; }
  g.setAttribute('color',new THREE.BufferAttribute(c,3));return g;
}
export function ellipsoid(position,scale,seed=1,detail=24) {
  const g=new THREE.SphereGeometry(1,detail,Math.round(detail*.66)),p=g.attributes.position;
  for(let i=0;i<p.count;i++) {
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    const d=1+.12*noise(x*1.3+seed,y*1.3,z*1.3)+.018*noise(x*5,y*5+seed,z*5);
    p.setXYZ(i,x*scale[0]*d+position[0],y*scale[1]*d+position[1],z*scale[2]*d+position[2]);
  }
  g.computeVertexNormals();return g;
}
export function tube(points, radii, radial=7, bump=0) {
  const pos=[],uv=[],idx=[], tangent=V(),side=V(),up=V(), ref=V(0,0,1);
  for(let j=0;j<points.length;j++) {
    const p=points[j];tangent.subVectors(points[Math.min(j+1,points.length-1)],points[Math.max(j-1,0)]).normalize();
    ref.set(0,0,1);if(Math.abs(tangent.z)>.92)ref.set(1,0,0);
    side.crossVectors(tangent,ref).normalize();up.crossVectors(side,tangent).normalize();
    for(let i=0;i<=radial;i++) {
      const a=i/radial*Math.PI*2,dx=Math.cos(a)*side.x+Math.sin(a)*up.x,dy=Math.cos(a)*side.y+Math.sin(a)*up.y,dz=Math.cos(a)*side.z+Math.sin(a)*up.z;
      // Corallite swelling is sampled at the smooth surface point, so the duplicated seam ring stays welded.
      const r=bump?radii[j]*(1+bump*noise((p.x+radii[j]*dx)*23,(p.y+radii[j]*dy)*23,(p.z+radii[j]*dz)*23)):radii[j];
      pos.push(p.x+r*dx,p.y+r*dy,p.z+r*dz);
      uv.push(i/radial,j/(points.length-1));
      if(j<points.length-1 && i<radial) {const k=j*(radial+1)+i;idx.push(k,k+radial+1,k+1,k+1,k+radial+1,k+radial+2);}
    }
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(idx);geo.computeVertexNormals();return geo;
}
/** Tapered, asymmetrically divided skeleton. Diameter decreases at each fork,
 *  the shaded base keeps its encrusted pigment and only the outermost branches —
 *  the ones nothing grows past — end in a pale growing tip. `order` sets how
 *  many times a stem divides, so one builder covers staghorn, needle-fine
 *  birdsnest and stubby digitata growth forms. `reach` is how far a primary stem
 *  runs before its first fork: short reach with many roots gives the dense
 *  cauliflower clump an Acropora actually grows, not a hedge of long sticks.
 *  `radials` is how many radial corallites stand per unit length of the two outer
 *  orders, `glow` how pale the growing tips go. */
export function coralBranches(origin,height,width,seed,color,tip='#cfe2f2',{thickness=.026,forks=6,roots=8,order=2,taper=.62,corallite=.14,rise=.64,blunt=.7,spread=.26,reach=.80,vary=.14,radials=0,glow=.34}={}){
  const rng=randomGenerator(seed),parts=[],base=V(...origin),c=new THREE.Color(color),tipColor=new THREE.Color(tip),side=V(),other=V(),out=V();
  const tissue=(p,start,dir,len,depth,shade,pale=0)=>{
    const t=Math.max(0,Math.min(1,(p.y-origin[1])/height)),axial=Math.max(0,Math.min(1,((p.x-start.x)*dir.x+(p.y-start.y)*dir.y+(p.z-start.z)*dir.z)/len));
    return c.clone().lerp(tipColor,Math.min(1,pale+(depth?.10*axial:.05+glow*smoothstep(.40,1,axial)))).multiplyScalar(shade*(.70+.34*t)+.10*noise(p.x*15,p.y*15,p.z*15)+.07*noise(p.x*4.5+seed,p.y*4.5,p.z*4.5));};
  function branch(start,dir,len,radius,depth){
    const pts=[],rs=[],bend=V((rng()-.5)*.28,.12,(rng()-.5)*.28),levels=depth?5:4,shade=.84+rng()*.32;
    for(let j=0;j<=levels;j++){const t=j/levels;pts.push(start.clone().addScaledVector(dir,len*t).addScaledVector(bend,len*t*t));rs.push(radius*(1-.42*t)*(1+.20*Math.sin(t*7+seed)));}
    // `blunt` runs the cap from a Seriatopora needle to a domed Montipora finger.
    const end=pts.at(-1).clone();
    pts.push(end.clone().addScaledVector(dir,radius*(.50-.20*blunt)),end.clone().addScaledVector(dir,radius*(1.05-.45*blunt)),end.clone().addScaledVector(dir,radius*(1.5-.75*blunt)));
    rs.push(radius*(.42+.46*blunt),radius*(.22+.40*blunt),.001);
    const g=tube(pts,rs,depth?6:5,corallite);tint(g,p=>tissue(p,start,dir,len,depth,shade));parts.push(g);
    // Radial corallites: short cups leaning towards the tip. They, not the stem, give an
    // Acropora branch its bottlebrush outline, and each rim is paler than the stem it sits on.
    if(radials&&depth<2){
      side.crossVectors(dir,Math.abs(dir.y)<.9?V(0,1,0):V(1,0,0)).normalize();other.crossVectors(dir,side);
      for(let k=0,n=Math.round(len*radials);k<n;k++){
        const t=.08+.86*(k+rng())/n,a=rng()*Math.PI*2,r=radius*(1-.42*t),L=r*(.70+.55*rng()),rc=r*.36;
        out.copy(side).multiplyScalar(Math.cos(a)).addScaledVector(other,Math.sin(a));
        const cup=start.clone().addScaledVector(dir,len*t).addScaledVector(bend,len*t*t).addScaledVector(out,r*.75),d=out.clone().multiplyScalar(.80).addScaledVector(dir,.62).normalize();
        const cupTube=tube([cup,cup.clone().addScaledVector(d,L),cup.clone().addScaledVector(d,L*1.05)],[rc,rc*.80,.001],3);
        tint(cupTube,p=>tissue(p,start,dir,len,depth,shade,.30*Math.min(1,p.distanceTo(cup)/L)));parts.push(cupTube);
      }
    }
    if(depth===0)return;
    for(let j=0;j<forks;j++){
      const a=rng()*Math.PI*2,idx=Math.min(levels-1,2+Math.floor(j*.65));
      const d=dir.clone().multiplyScalar(.40).add(V(Math.cos(a)*width,rise+rng()*.35,Math.sin(a)*width)).normalize();
      branch(pts[idx],d,len*(depth>1?.38+rng()*.22:.29+rng()*.18),radius*taper,depth-1);
    }
  }
  // A connected basal thicket: stems near the rim lean out and stop short, so the
  // colony carries a domed outline instead of a hedge of equal sticks.
  for(let k=0;k<roots;k++){
    const a=k*2.39996,rim=Math.sqrt(k/roots),r=rim*height*spread;
    const root=base.clone().add(V(Math.cos(a)*r,-r*.25,Math.sin(a)*r*.7));
    branch(root,V(Math.cos(a)*(.16+.60*rim),.95,Math.sin(a)*(.13+.48*rim)).normalize(),height*(reach-.30*rim*reach/.8+rng()*vary),height*thickness*(.9+rng()*.2),order);
  }
  // The colony grows from an encrusting plate that spreads over the rock and swallows the
  // stem bases, so no stick visibly stands in a hole.
  const R=height*(spread*.62+thickness*1.5),foot=ellipsoid([base.x,base.y-R*.12,base.z],[R,R*.22,R*.72],seed,16);
  tint(foot,p=>c.clone().multiplyScalar(.62+.10*noise(p.x*9,p.y*9,p.z*9)));parts.push(foot);
  return merge(parts);
}
/** Planar gorgonian: dichotomous forking confined to one gently bowed plane, so
 *  the colony reads as a net standing in the water column, not a bush. */
export function seaFan(origin,height,seed,color,tip,{order=8,thickness=.085,stems=3,yaw=0,bow=.13,split=.27,shorten=.85}={}){
  const rng=randomGenerator(seed),parts=[],c=new THREE.Color(color),tipColor=new THREE.Color(tip);
  const ax=V(Math.cos(yaw),0,Math.sin(yaw)),normal=V(-Math.sin(yaw),0,Math.cos(yaw)),o=V(...origin);
  const place=(u,v)=>o.clone().addScaledVector(ax,u).addScaledVector(normal,-bow*u*u).add(V(0,v,0));
  function limb(u,v,angle,len,radius,depth){
    const pts=[],rs=[],curl=(rng()-.5)*.8,grown=(order-depth)/order;
    let uu=u,vv=v;
    for(let j=0;j<=3;j++){
      if(j){const a=angle+curl*(j-.5)/3;uu+=Math.sin(a)*len/3;vv+=Math.cos(a)*len/3;}
      pts.push(place(uu,vv));rs.push(radius*(depth?1-.2*j/3:1-.9*j/3));
    }
    const g=tube(pts,rs,depth>3?5:3);
    // Polyp-bearing twigs carry the pale tissue; the shaded trunk keeps the bare axis colour.
    tint(g,p=>c.clone().lerp(tipColor,grown*.58).multiplyScalar(.66+.34*grown+.08*noise(p.x*9,p.y*9,p.z*9)));
    parts.push(g);
    if(depth===0)return;
    for(const s of [-1,1])limb(uu,vv,angle+curl+s*split*(.65+rng()*.75),len*(shorten+rng()*.10),radius*.86,depth-1);
  }
  for(let k=0;k<stems;k++)limb((k-(stems-1)/2)*.16,-.12,(k-(stems-1)/2)*.3,.95+rng()*.2,thickness,order);
  // Forking depth, not arithmetic, decides how tall the colony grows: scale the
  // finished mesh so `height` is the reach above the holdfast it says it is.
  const g=merge(parts),p=g.attributes.position;let top=origin[1];
  for(let i=0;i<p.count;i++)top=Math.max(top,p.getY(i));
  const k=height/(top-origin[1]);
  for(let i=0;i<p.count;i++)p.setXYZ(i,origin[0]+(p.getX(i)-origin[0])*k,origin[1]+(p.getY(i)-origin[1])*k,origin[2]+(p.getZ(i)-origin[2])*k);
  g.computeBoundingSphere();return g;
}
/** Massive stony colony. Meandroid valleys — the zero contour of two
 *  cross-modulated waves — wander like a brain coral's polyp series instead of
 *  tiling a regular grid, and stay dark where the skeleton shades itself. */
export function massiveCoral(origin,scale,seed,color,groove,{ridges=14,relief=.14,detail=72}={}){
  const g=new THREE.SphereGeometry(1,detail,Math.round(detail*.6)),p=g.attributes.position;
  const wall=(x,y,z)=>Math.min(1,Math.abs(Math.sin(ridges*x+1.9*Math.sin(ridges*.5*z+seed))+Math.sin(ridges*z*1.07-1.9*Math.sin(ridges*.48*y)))*1.35);
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i),d=1+.13*noise(x*1.6+seed,y*1.6,z*1.6)+relief*(smoothstep(0,.40,wall(x,y,z))-.62);
    p.setXYZ(i,x*scale[0]*d+origin[0],y*scale[1]*d+origin[1],z*scale[2]*d+origin[2]);
  }
  g.computeVertexNormals();
  const c=new THREE.Color(color),v=new THREE.Color(groove);
  // Tissue over a living skeleton is never one flat albedo: the ridge colour drifts across
  // the colony and the valleys hold their own shade, which is what stops a massive coral
  // reading as a painted ball.
  return tint(g,q=>{const x=(q.x-origin[0])/scale[0],y=(q.y-origin[1])/scale[1],z=(q.z-origin[2])/scale[2],n=Math.hypot(x,y,z)||1;
    const drift=.86+.28*noise(q.x*2.4+seed,q.y*2.4,q.z*2.4)+.10*noise(q.x*9,q.y*9,q.z*9);
    return v.clone().lerp(c,smoothstep(.06,.52,wall(x/n,y/n,z/n))).multiplyScalar((.72+.26*y/n)*drift);});
}
/** One zoanthid of unit radius and height, standing on the origin, for instancing: a
 *  column rising from a skirt sunk below the rock, a star of tentacles flaring past the
 *  column, and a concave oral disc around a raised pale mouth. Rings run bottom-up; the
 *  material renders both sides so the cup lights either way. */
export function polyp(mouth,disc,skirt){
  const tips=12,pos=[],col=[],idx=[],m=new THREE.Color(mouth),d=new THREE.Color(disc),s=new THREE.Color(skirt);
  const put=(x,y,z,c)=>{pos.push(x,y,z);col.push(c.r,c.g,c.b);};
  const rings=[[.62,-.35,s.clone().multiplyScalar(.30),0],[.60,.40,s.clone().multiplyScalar(.70),0],[.74,.80,s,0],[1,.97,d.clone().lerp(m,.22),1],[.74,.92,d,0],[.36,.86,d.clone().multiplyScalar(.78),0]];
  for(const [r,h,c,star] of rings)
    for(let i=0;i<=tips;i++){const a=i/tips*Math.PI*2,f=star&&i%2?.86:1;put(Math.cos(a)*r*f,h,Math.sin(a)*r*f,c);}
  put(0,.90,0,m);
  for(let k=0;k<rings.length-1;k++)for(let i=0;i<tips;i++){const a=k*(tips+1)+i,b=a+tips+1;idx.push(a,b,a+1,a+1,b,b+1);}
  const last=(rings.length-1)*(tips+1),apex=rings.length*(tips+1);for(let i=0;i<tips;i++)idx.push(apex,last+i+1,last+i);
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
  geo.setIndex(idx);geo.computeVertexNormals();return geo;
}
export function plateCoral(origin,radius,seed,color,rim='#e6dfc8',tilt=0){
  const rng=randomGenerator(seed),phase=rng()*6,p=[],uv=[],index=[],c=new THREE.Color(color);
  const rings=15,sides=84;
  // Thin foliose whorls: the ruffle and the upturned margin scale with the plate,
  // so a big colony is not just a smooth slab of the small one.
  for(let j=0;j<=rings;j++)for(let i=0;i<=sides;i++){
    const a=i/sides*Math.PI*2,s=j/rings,r=radius*s*(1+.14*Math.sin(a*3+phase)+.06*Math.sin(a*7-phase));
    const y=radius*(.10*s*s+s*s*(.19*Math.sin(a*3+phase)+.085*Math.sin(a*7-phase*1.7))+.16*smoothstep(.62,1,s)+.022*s*Math.sin(s*22+a*2));
    p.push(origin[0]+r*Math.cos(a),origin[1]+y+.095*r*Math.cos(a+phase),origin[2]+r*Math.sin(a)*.69);uv.push(i/sides,s);
    if(j<rings&&i<sides){const k=j*(sides+1)+i;index.push(k,k+sides+1,k+1,k+1,k+sides+1,k+sides+2);}
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(index);
  // Capricornis whorls stand on edge; a tilted plate shows the camera its coloured face instead of a sliver.
  if(tilt)geo.applyMatrix4(new THREE.Matrix4().makeTranslation(origin[0],origin[1],origin[2]).multiply(new THREE.Matrix4().makeRotationX(-tilt)).multiply(new THREE.Matrix4().makeTranslation(-origin[0],-origin[1],-origin[2])));
  geo.computeVertexNormals();
  // Montipora lays down a pale, still-calcifying margin; the shaded centre keeps the deep pigment.
  const edge=new THREE.Color(rim);
  tint(geo,(pt,i)=>{const s=Math.floor(i/(sides+1))/rings;
    return c.clone().lerp(edge,Math.pow(s,11)*.85).multiplyScalar(.74+.22*s+.07*Math.sin(s*22)+.075*noise(pt.x*25,pt.y*25,pt.z*25));});return geo;
}
