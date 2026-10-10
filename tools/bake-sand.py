"""Generate the seamless aragonite sand atlas: R grain albedo, GB tangent normal.
The atlas covers 2 units (20 cm) of bed at 1024 px, so a 1 mm grain is five pixels.
"""
from pathlib import Path
import numpy as np
from scipy.ndimage import gaussian_filter
from scipy.spatial import cKDTree
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]/'scenes/reefscape/assets'
rng=np.random.default_rng(40417);n=1024
y,x=np.mgrid[:n,:n];pix=np.stack([x.ravel(),y.ravel()],1)+.5
def grains(count,rlo,rhi,stretch=1.):
 """Wrapped cells around `count` seeds: a dome height per grain and the grain's index."""
 seeds=rng.uniform(0,n,(count,2));radius=rng.uniform(rlo,rhi,count)
 angle=rng.uniform(0,np.pi,count);d,i=cKDTree(seeds,boxsize=n).query(pix)
 off=(pix-seeds[i]+n/2)%n-n/2;c,s=np.cos(angle[i]),np.sin(angle[i])
 u=(off[:,0]*c+off[:,1]*s)/stretch;v=-off[:,0]*s+off[:,1]*c
 return np.clip(1-(u*u+v*v)/radius[i]**2,0,1).reshape(n,n),i.reshape(n,n)
# Packed aragonite: grains of one to two millimetres, each its own shade of white, a few
# dark mineral grains among them, and flat shell fragments lying on top.
dome,idx=grains(60000,2.4,4.2)
shade=rng.normal(0,.07,60000);shade[rng.uniform(size=60000)<.035]-=.35
albedo=.80+shade[idx]*(.6+.4*dome)
height=dome**.5*.6
flake,fid=grains(160,2.5,5,stretch=2.);lift=flake>0
albedo=np.where(lift,.92+rng.normal(0,.04,160)[fid],albedo);height=np.where(lift,.7+.25*flake,height)
albedo*=1-.25*(1-dome)*(~lift)
height=gaussian_filter(height,.7,mode='wrap')
gx=(np.roll(height,-1,1)-np.roll(height,1,1))*1.6;gy=(np.roll(height,-1,0)-np.roll(height,1,0))*1.6
normal=np.stack([-gx,gy,np.ones_like(height)],-1);normal/=np.linalg.norm(normal,axis=2,keepdims=True)
u8=lambda a:np.uint8(np.clip(a,0,1)*255+.5)
Image.fromarray(np.stack([u8(albedo),u8(normal[...,0]*.5+.5),u8(normal[...,1]*.5+.5)],-1)).save(ROOT/'aragonite.png')
print(f'{n}px wrapped aragonite sand atlas written.')
