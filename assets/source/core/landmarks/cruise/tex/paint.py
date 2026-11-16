"""Original cruise finishes at plausible physical scale; photographs are never texture inputs."""
from pathlib import Path
import json
import numpy as np
from PIL import Image

HERE=Path(__file__).resolve().parent
LOOK=json.loads((HERE.parent/'materials.json').read_text())
N=2048;C=N//4;rng=np.random.default_rng(365485)
base=np.zeros((N,N,3),np.float32);height=np.full((N,N),.5,np.float32)
rough=np.zeros((N,N),np.float32);metal=np.zeros((N,N),np.float32)
y,x=np.mgrid[0:C,0:C];u=x/C;v=y/C
for tag,prop in LOOK.items():
 cell=prop['cell'];xx=cell%4*C;yy=cell//4*C
 noise=rng.normal(0,1,(C,C));tone=noise*.45;h=np.full((C,C),.5,np.float32)
 if tag in('deck','oak'):
  count=24 if tag=='deck' else 10
  seam=np.minimum((u*count)%1,1-(u*count)%1)<.025
  grain=np.sin(u*1300+np.sin(v*25)*5)*1.9+np.sin(u*610+np.sin(v*70))*1.1
  tone=grain+np.sin(np.floor(u*count)*2.71)*4+noise*.5;tone[seam]-=30;h+=grain*.002;h[seam]-=.06
  if tag=='deck':
   joins=np.minimum((v*2+np.floor(u*count)*.371)%1,1-(v*2+np.floor(u*count)*.371)%1)<.004
   tone[joins]-=18;h[joins]-=.035
 elif tag in('carpet','linen'):
  weave=(x%3==0).astype(float)+(y%3==0).astype(float)-.6
  tone=weave*1.7+noise*.65;h+=weave*.009
  if tag=='carpet':tone+=np.sin((u+v)*44)*2+np.cos((u-v)*45)*2
 elif tag=='tile':
  seam=(x%32<2)|(y%32<2);tone=np.sin(u*35+np.sin(v*17))*np.cos(v*29)*3;tone[seam]-=22;h[seam]-=.025
 elif tag=='stone':tone=noise*.8+np.sin(u*28+np.sin(v*9)*3)*.8
 elif tag=='steel':tone=np.sin(v*1800)*1.3+noise*.3
 elif tag=='glass':tone=np.sin(u*31+v*11)*1.5
 base[yy:yy+C,xx:xx+C]=np.array(prop['rgb'])[None,None,:]+tone[:,:,None]
 height[yy:yy+C,xx:xx+C]=h;rough[yy:yy+C,xx:xx+C]=prop['roughness'];metal[yy:yy+C,xx:xx+C]=prop['metal']
Image.fromarray(np.clip(base,0,255).astype('uint8')).save(HERE/'surfaces_base.png')
Image.fromarray(np.clip(height*255,0,255).astype('uint8')).save(HERE/'surfaces_height.png')
dx=np.roll(height,-1,axis=1)-np.roll(height,1,axis=1);dy=np.roll(height,-1,axis=0)-np.roll(height,1,axis=0)
normal=np.stack([-dx*2,dy*2,np.ones_like(height)],axis=-1);normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
Image.fromarray(np.clip((normal*.5+.5)*255,0,255).astype('uint8')).save(HERE/'surfaces_normal.png')
Image.fromarray(np.clip(np.stack([np.ones_like(rough)*.97,rough,metal],axis=-1)*255,0,255).astype('uint8')).save(HERE/'surfaces_packed.png')
print('Painted original cruise enamel, deck, textile, tile, metal and glass-edge atlas')
