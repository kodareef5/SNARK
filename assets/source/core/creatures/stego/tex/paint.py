"""Original Stego surface painting, reproducible without external pictures.

Cell-by-cell scale relief, anatomical pigment fields, horn growth and wear are
independent layers. Base is unlit, normal derives from height, roughness does
not carry painted lighting. Preview colors are separate from neutral dye maps.
"""
from pathlib import Path
import numpy as np
from PIL import Image

OUT=Path(__file__).resolve().parent
SIZE=2048
REGIONS=np.array([(255,0,0),(0,255,0),(0,0,255),(0,255,255),(255,0,255),(255,255,0)],dtype=np.uint8)
COLORS=np.array([[.31,.39,.28],[.49,.54,.39],[.73,.68,.48],[.55,.29,.16],[.24,.20,.13],[.79,.70,.48]],dtype=np.float32)

def srgb(x):return np.where(x<=.0031308,x*12.92,1.055*np.clip(x,0,1)**(1/2.4)-.055)
def linear(x):return np.where(x<=.04045,x/12.92,((x+.055)/1.055)**2.4)
def hash2(x,y,s=0):return np.mod(np.sin(x*127.1+y*311.7+s*74.7)*43758.5453,1)
def noise(u,v,frequency):
 x=u*frequency;y=v*frequency;ix=np.floor(x);iy=np.floor(y);fx=x-ix;fy=y-iy;fx=fx*fx*(3-2*fx);fy=fy*fy*(3-2*fy)
 return (1-fy)*((1-fx)*hash2(ix,iy)+fx*hash2(ix+1,iy))+fy*((1-fx)*hash2(ix,iy+1)+fx*hash2(ix+1,iy+1))

def save(name,a):
 a=np.clip(a,0,1);Image.fromarray(np.round(a*255).astype(np.uint8)).save(OUT/name)

def write(name,base,height,rough,occlusion,regions,physical_mm):
 # Hold dyed areas at the native 0.5 linear grey while preserving individual scales.
 for r in range(6):
  mask=regions==r
  if mask.any():base[mask]*=.5/max(.01,float(base[mask].mean()))
 base=np.clip(base,0,1)
 dy,dx=np.gradient(height,physical_mm,physical_mm);normal=np.stack([-dx,dy,np.ones_like(height)],-1);normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
 save(name+'_base.png',srgb(base));save(name+'_normal.png',normal*.5+.5)
 save(name+'_height.png',(height-height.min())/max(.001,float(height.max()-height.min())))
 save(name+'_packed.png',np.stack([occlusion,rough,np.zeros_like(rough)],-1))
 colors=np.zeros((*regions.shape,3),np.uint8)
 for r in range(6):colors[regions==r]=REGIONS[r]
 Image.fromarray(colors).save(OUT/(name+'_regions.png'))
 preview=base.copy()
 for r in range(6):preview[regions==r]*=linear(COLORS[r])/.5
 save(name+'_preview.png',srgb(preview))
 # Injury and decay are sparse in UV, independent of creature dye. Three alpha
 # thresholds reveal bruising/scratches progressively; no detached body parts.
 n=512;vv,uu=np.mgrid[0:n,0:n].astype(np.float32)/(n-1);vv=1-vv
 patch=noise(uu,vv,17);fine=noise(uu,vv,140)
 cuts=np.maximum(0,1-np.abs(np.sin(uu*170+vv*91+noise(uu,vv,25)*4))/.10)
 flesh=(patch>.62)&(vv>.12)&(vv<.72)&(uu>.20)&(uu<.88)
 alpha=np.where(flesh, np.where(cuts>.3,.90,np.where(fine>.62,.56,.24)),0)
 injury=np.empty((n,n,4),np.float32);injury[...,:3]=np.stack([.30+.12*fine,.10+.08*fine,.07+.05*fine],-1);injury[...,3]=alpha
 save(name+'_hurt.png',injury)
 decay=np.empty_like(injury);decay[...,:3]=np.stack([.21+.10*fine,.21+.08*fine,.14+.08*fine],-1);decay[...,3]=np.where((patch>.40)&(alpha==0),.15+.48*patch,0)
 save(name+'_decay.png',decay)


def saddle():
 n=1024;v,u=np.mgrid[0:n,0:n].astype(np.float32)/(n-1);v=1-v
 fine=noise(u,v,380);grain=noise(u,v,40);broad=noise(u,v,9)
 regions=np.full(u.shape,-1,dtype=np.int8);height=.08*fine+.07*grain
 base=np.empty((n,n,3),np.float32);base[:]=linear(np.array([.29,.17,.08]));base*=((.78+.30*grain+.13*broad)[...,None])
 rough=.76-.08*fine;occ=.94-.07*(1-grain)
 wood=u>.70;base[wood]=linear(np.array([.36,.22,.10]));woodgrain=.80+.15*np.sin(v*210+noise(u,v,13)*5);base[wood]*=woodgrain[wood,None];height[wood]=.12*woodgrain[wood];rough[wood]=.59
 iron=(u>.70)&(v>.74);base[iron]=linear(np.array([.20,.22,.23]));height[iron]=.02*fine[iron];rough[iron]=.35+.12*grain[iron]
 write('stego_saddle',base,height,rough,occ,regions,1.5)
 packed=np.asarray(Image.open(OUT/'stego_saddle_packed.png')).copy();packed[...,2][iron]=210;Image.fromarray(packed).save(OUT/'stego_saddle_packed.png')

if __name__=='__main__':
 import sys
 OUT.mkdir(parents=True,exist_ok=True)
 if '--fields' in sys.argv:
  from paint_fields import main
  main(Path(sys.argv[sys.argv.index('--fields')+1]))
 else:
  raise SystemExit("Run bun run art -- core:stego: body maps require freshly unwrapped geometry fields.")
 print('Painted original skin, horn and saddle maps at',OUT)
