"""Bake porous limestone once, never on the wallpaper's animation loop.
Requires Python, numpy, scipy and scikit-image ONLY to rebuild this asset.
The shipped asset is read directly by the dependency-free browser application.
A sampled signed density surface produces actual cavities and irregular outlines;
vertex occlusion is baked from hemispherical visibility, not a screen-space pass.
"""
from pathlib import Path
import ast, re, struct
import numpy as np
from scipy.ndimage import gaussian_filter, map_coordinates
from skimage.measure import marching_cubes

ROOT=Path(__file__).resolve().parents[1]
layout=(ROOT/'scenes/reefscape/src/layout.js').read_text()
rocks=ast.literal_eval(re.search(r'export const ROCKS=(\[.*?\]);',layout,re.S).group(1).replace(',\n]', '\n]'))
rng=np.random.default_rng(82641)
pos=[]; norms=[]; colors=[]; faces=[]; offset=0
for ri,r in enumerate(rocks):
    center=np.array(r[:3]); scale=np.array(r[3:]); n=54 if max(scale)>1.4 else 38
    span=1.4; step=span*2/(n-1)
    grid=np.linspace(-span,span,n,dtype=np.float32)
    x,y,z=np.meshgrid(grid,grid,grid,indexing='ij')
    # Asymmetry at three scales: limestone lobes, erosion, then resolved pores.
    noise=np.zeros((n,n,n),np.float32)
    for sig,amp in [(7,.28),(2.5,.13),(.85,.065)]:
        ns=gaussian_filter(rng.standard_normal((n,n,n)).astype(np.float32),sig,mode='reflect')
        ns/=max(ns.std(),1e-6);noise+=amp*ns
    # The knobbly crust a few centimetres across that live rock is built from. It draws on
    # its own stream so the rock outlines above, which everything is placed on, stay put.
    ns=gaussian_filter(np.random.default_rng(5117+ri).standard_normal((n,n,n)).astype(np.float32),1.3,mode='reflect')
    noise+=.10*ns/max(ns.std(),1e-6)
    f=1-(x*x+y*y+z*z)+noise
    # Real recesses, not black dots pasted onto an unbroken smooth boulder.
    for k in range(35):
        d=rng.normal(size=3);d/=np.linalg.norm(d)
        rr=rng.uniform(.065,.165);c=d*rng.uniform(.77,1.08)
        rs=np.array([rr,rr*rng.uniform(.75,1.3),rr*rng.uniform(.8,1.4)])
        cavity=((x-c[0])/rs[0])**2+((y-c[1])/rs[1])**2+((z-c[2])/rs[2])**2-1
        f=np.minimum(f,cavity*.4)
    # A few deeper openings through the thinner rock shoulders.
    if ri in (2,8):
        cx,cy=rng.uniform(-.22,.22,2)
        tunnel=((x-cx)/.19)**2+((y-cy)/.16)**2-1+.25*np.sin(z*5)
        f=np.minimum(f,tunnel*.5)
    v,fc,nm,_=marching_cubes(f,0,spacing=(step,)*3,allow_degenerate=False)
    v=v-span
    # skimage's density gradient normals point out of the positive rock volume.
    nm=nm/scale;nm/=np.linalg.norm(nm,axis=1,keepdims=True)
    wp=v*scale+center
    # Visibility of a handful of sky directions baked into vertex albedo/AO.
    ao=np.ones(len(v),np.float32)
    samples=[np.array([0,1,0]),np.array([.65,.7,.3]),np.array([-.7,.6,.3]),np.array([.1,.55,-.8])]
    for d in samples:
        d=d/np.linalg.norm(d)
        for dist in (.09,.23,.46):
            points=(v+(nm*.035+d*dist)/scale+span)/step
            val=map_coordinates(f,points.T,order=1,mode='constant',cval=-1)
            ao-=np.maximum(0,np.minimum(1,val*6))*.056
    # The per-pixel crust is composed in the shader from the surface atlas; the vertex
    # stream only carries what varies over a whole rock: R is the baked sky visibility,
    # G how thickly coralline has taken over this stretch, B its hue from deep violet to
    # rose. Coralline runs thin on the lit tops, where turf algae outcompete it.
    up=np.clip(nm[:,1],0,1)
    patch=np.sin(wp[:,0]*2.9+np.sin(wp[:,2]*3.7))*np.sin(wp[:,1]*3.3+wp[:,2]*1.1)
    hue=np.sin(wp[:,0]*1.7+wp[:,2]*1.3+ri)*np.sin(wp[:,1]*1.9-wp[:,0]*1.1)
    co=np.stack([ao,np.clip(.55+.35*patch-.25*up,0,1),np.clip(.5+.6*hue,0,1)],1)
    pos.append(wp.astype('<f4'));norms.append(nm.astype('<f4'));colors.append(np.clip(co*255,0,255).astype('u1'))
    faces.append((fc[:, ::-1]+offset).astype('<u4'));offset+=len(v)
    print(f'rock {ri+1}: {len(v):,} vertices / {len(fc):,} triangles',flush=True)
p=np.concatenate(pos);normal=np.concatenate(norms);col=np.concatenate(colors);idx=np.concatenate(faces).ravel()
target=ROOT/'scenes/reefscape/assets/live-rock.bin'
# header 4 uint32: magic, format version, vertices, indices; 3f position, 3f normal,
# 3u8 visibility / coralline / hue per vertex; align the index stream to 4 bytes.
blob=bytearray(struct.pack('<IIII',0x52454546,1,len(p),len(idx)))
blob.extend(p.tobytes());blob.extend(normal.tobytes());blob.extend(col.tobytes())
while len(blob)%4:blob.append(0)
blob.extend(idx.tobytes());target.write_bytes(blob)
# A small top-surface field seats polyps on the actual baked rock, rather than
# the coarser ellipsoid collision envelopes used by swimming fish.
# Rasterize the mesh's top surface with barycentric interpolation. Unlike a max
# filter over nearby vertices, this does not lift polyps off steep rock faces.
W,H=385,193
field=np.full((H,W),-99,dtype=np.float32)
tri=p[np.concatenate(faces)]
gx=(tri[:,:,0]+9.65)/19.3*(W-1);gz=(tri[:,:,2]+4.1)/10.2*(H-1)
ytri=tri[:,:,1]
x0=np.floor(gx.min(axis=1)).astype(int);z0=np.floor(gz.min(axis=1)).astype(int)
dx=np.ceil(gx.max(axis=1)).astype(int)-x0;dz=np.ceil(gz.max(axis=1)).astype(int)-z0
den=(gz[:,1]-gz[:,2])*(gx[:,0]-gx[:,2])+(gx[:,2]-gx[:,1])*(gz[:,0]-gz[:,2])
valid_den=np.abs(den)>1e-9;den=np.where(valid_den,den,1.)
for j in range(int(dz.max())+1):
    for i in range(int(dx.max())+1):
        xx=x0+i;zz=z0+j
        aa=((gz[:,1]-gz[:,2])*(xx-gx[:,2])+(gx[:,2]-gx[:,1])*(zz-gz[:,2]))/den
        bb=((gz[:,2]-gz[:,0])*(xx-gx[:,2])+(gx[:,0]-gx[:,2])*(zz-gz[:,2]))/den
        cc=1-aa-bb
        mask=valid_den&(i<=dx)&(j<=dz)&(aa>=-1e-5)&(bb>=-1e-5)&(cc>=-1e-5)&(xx>=0)&(xx<W)&(zz>=0)&(zz<H)
        yy=aa*ytri[:,0]+bb*ytri[:,1]+cc*ytri[:,2]
        np.maximum.at(field,(zz[mask],xx[mask]),yy[mask])
xx,zz=np.meshgrid(np.linspace(-9.65,9.65,W),np.linspace(-4.1,6.1,H))
bed=-.30+.12*np.sin(xx*.49+zz*.22)+.075*np.sin(zz*.75-xx*.25)+.25*np.exp(-((xx-6)**2/17+(zz+1)**2/13))
field=np.maximum(field,bed)
(ROOT/'scenes/reefscape/assets/rock-support.bin').write_bytes(struct.pack('<II',W,H)+field.astype('<f4').tobytes())
print(f'{target.name}: {len(blob):,} bytes; {len(idx)//3:,} triangles')
