"""Generate the seamless live-rock surface atlas and its matching normal map.
No image-generation references are sampled into the running environment.
live-rock-surface.png: R relief height, G coralline cover, B algae film.
live-rock-normal.png: RG tangent normal of the relief, B encrusting speckle.
"""
from pathlib import Path
import numpy as np
from scipy.ndimage import gaussian_filter
from scipy.spatial import cKDTree
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]/'scenes/reefscape/assets'
rng=np.random.default_rng(912824);n=1024
def fbm(octaves):
 out=np.zeros((n,n),np.float32)
 for sigma,amp in octaves:
  q=gaussian_filter(rng.normal(size=(n,n)),sigma,mode='wrap');q/=q.std();out+=q*amp
 return out
y,x=np.mgrid[:n,:n]
# Seeds are looked up through a warped plane, so pits and nodules come out as irregular
# lobes rather than circles. Each pixel takes the strongest of its four nearest seeds,
# which keeps the Voronoi edges between them from showing as creases.
def bend(size):
 w=gaussian_filter(rng.normal(size=(n,n)),size*1.5,mode='wrap');return w*(.45*size/w.std())
def stamp(count,rlo,rhi,shape):
 pix=np.stack([(x+bend(rhi)).ravel()%n,(y+bend(rhi)).ravel()%n],1)
 seeds=rng.uniform(0,n,(count,2));radius=rng.uniform(rlo,rhi,count);strength=rng.uniform(.4,1,count)
 d,i=cKDTree(seeds,boxsize=n).query(pix,k=4)
 return (shape(d/radius[i])*strength[i]).max(1).reshape(n,n)
# The atlas covers about 1.6 units (16 cm) of rock. Live rock is lumpy before it is
# pitted: a crust of rounded nodules a few centimetres across, the gaps between them
# deep and dark, and pores punched through everything at every size down to a millimetre.
height=.50+fbm([(60,.06),(18,.05),(5,.03),(1.2,.02)])
height+=.24*stamp(1400,14,30,lambda d:np.clip(1-d*d,0,1)**.6)
# A pit is a steep-walled hole with a rounded floor.
for count,lo,hi,depth in [(260,12,30,.55),(1600,4,10,.42),(8000,1.2,3.5,.26)]:
 height-=depth*stamp(count,lo,hi,lambda d:np.clip((1.15-d)*2.4,0,1)**1.5)
height=np.clip((height-height.min())/(np.ptp(height)),0,1)
# Coralline sits on the raised crust and never lines a pit. Its outline is a warped
# threshold, so patches end in a ragged margin a few millimetres wide.
warp=fbm([(40,1.)]);field=fbm([(36,.7),(12,.35),(3,.14)])
coralline=np.clip((np.roll(field,(8,5),(0,1))+.9*(height-.5)+.25*warp+.10)*3.2,0,1)
# The olive film and turf fill what the crust leaves bare, darker in the hollows.
algae=np.clip((fbm([(28,.8),(7,.3),(1.5,.12)])-.35*coralline+.1)*1.8,0,1)
# Encrusting polyps and new coralline starts: small bright discs, sparse.
speck=gaussian_filter((stamp(6000,2.,5.,lambda d:np.clip(1.6-1.6*d,0,1))>.55).astype(np.float32),.7,mode='wrap')
gx=(np.roll(height,-1,1)-np.roll(height,1,1))*9.0;gy=(np.roll(height,-1,0)-np.roll(height,1,0))*9.0
normal=np.stack([-gx,gy,np.ones_like(height)],-1);normal/=np.linalg.norm(normal,axis=2,keepdims=True)
u8=lambda a:np.uint8(np.clip(a,0,1)*255+.5)
Image.fromarray(np.stack([u8(height),u8(coralline),u8(algae)],-1)).save(ROOT/'live-rock-surface.png')
Image.fromarray(np.stack([u8(normal[...,0]*.5+.5),u8(normal[...,1]*.5+.5),u8(speck)],-1)).save(ROOT/'live-rock-normal.png')
print(f'{n}px wrapped live-rock surface / normal maps written.')
