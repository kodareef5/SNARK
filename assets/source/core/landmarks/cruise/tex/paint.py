"""Original cruise finishes at plausible physical scale; photographs are never texture inputs."""
from pathlib import Path
import json
import numpy as np
from PIL import Image,ImageDraw,ImageFont

HERE=Path(__file__).resolve().parent
LOOK=json.loads((HERE.parent/'materials.json').read_text())
N=2048;C=N//8;rng=np.random.default_rng(365485)
base=np.zeros((N,N,3),np.float32);height=np.full((N,N),.5,np.float32)
rough=np.zeros((N,N),np.float32);metal=np.zeros((N,N),np.float32)
y,x=np.mgrid[0:C,0:C];u=x/C;v=y/C
for tag,prop in LOOK.items():
 cell=prop['cell'];xx=cell%8*C;yy=cell//8*C
 noise=rng.normal(0,1,(C,C));tone=noise*.45;h=np.full((C,C),.5,np.float32)
 if tag in('deck','oak'):
  count=24 if tag=='deck' else 10
  seam=np.minimum((u*count)%1,1-(u*count)%1)<.025
  grain=np.sin(u*1300+np.sin(v*25)*5)*1.9+np.sin(u*610+np.sin(v*70))*1.1
  tone=grain+np.sin(np.floor(u*count)*2.71)*4+noise*.5;tone[seam]-=30;h+=grain*.002;h[seam]-=.06
  if tag=='deck':
   joins=np.minimum((v*2+np.floor(u*count)*.371)%1,1-(v*2+np.floor(u*count)*.371)%1)<.004
   tone[joins]-=18;h[joins]-=.035
 elif tag in('carpet','linen','purple'):
  weave=(x%3==0).astype(float)+(y%3==0).astype(float)-.6
  tone=weave*1.7+noise*.65;h+=weave*.009
  if tag=='carpet':tone+=np.sin((u+v)*44)*2+np.cos((u-v)*45)*2
 elif tag=='tile':
  seam=(x%32<2)|(y%32<2);tone=np.sin(u*35+np.sin(v*17))*np.cos(v*29)*3;tone[seam]-=22;h[seam]-=.025
 elif tag in('stone','marble'):tone=noise*.8+np.sin(u*28+np.sin(v*9)*3)*.8
 elif tag=='steel':tone=np.sin(v*1800)*1.3+noise*.3
 elif tag in('glass','dome_glaze'):tone=np.sin(u*31+v*11)*1.5
 elif tag=='water':
  wave=np.sin(u*52+np.sin(v*23)*1.4)+np.sin(v*61+np.sin(u*19)*1.2)
  tone=wave*5+np.maximum(0,np.cos(u*73+v*41+wave)-.65)*32;h+=wave*.008
 base[yy:yy+C,xx:xx+C]=np.array(prop['rgb'])[None,None,:]+tone[:,:,None]
 height[yy:yy+C,xx:xx+C]=h;rough[yy:yy+C,xx:xx+C]=prop['roughness'];metal[yy:yy+C,xx:xx+C]=prop['metal']
Image.fromarray(np.clip(base,0,255).astype('uint8')).save(HERE/'surfaces_base.png')
Image.fromarray(np.clip(height*255,0,255).astype('uint8')).save(HERE/'surfaces_height.png')
dx=np.roll(height,-1,axis=1)-np.roll(height,1,axis=1);dy=np.roll(height,-1,axis=0)-np.roll(height,1,axis=0)
normal=np.stack([-dx*2,dy*2,np.ones_like(height)],axis=-1);normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
Image.fromarray(np.clip((normal*.5+.5)*255,0,255).astype('uint8')).save(HERE/'surfaces_normal.png')
Image.fromarray(np.clip(np.stack([np.ones_like(rough)*.97,rough,metal],axis=-1)*255,0,255).astype('uint8')).save(HERE/'surfaces_packed.png')
print('Painted original cruise enamel, deck, textile, tile, metal and glass-edge atlas')
layout=json.loads((HERE.parent.parents[4]/'content/landmarks/cruise-layout.json').read_text())
labels=sorted(set(r['label'] for r in layout['rooms'])|{'ICON OF THE SEAS','CRUISE PORT','BOARDING - DECK 5','KORU + UTILITY LAUNCH'}|{f'DECK {d["id"]}' for d in layout['decks']})
assert len(labels)<=64,len(labels)
signs={label:i for i,label in enumerate(labels)};(HERE.parent/'signs.json').write_text(json.dumps(signs,indent=2)+'\n')
atlas=Image.new('RGB',(2048,2048),(23,53,72));draw=ImageDraw.Draw(atlas)
for label,i in signs.items():
 xx=i%8*256;yy=i//8*256
 draw.rounded_rectangle((xx+8,yy+74,xx+248,yy+182),radius=8,fill=(27,60,81),outline=(185,170,125),width=3)
 words=label.upper();lines=[words]
 if len(words)>22:
  split=words.rfind(' ',0,len(words)//2+4);lines=[words[:split],words[split+1:]]
 for j,line in enumerate(lines):
  size=22
  while size>10:
   font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',size);bounds=draw.textbbox((0,0),line,font=font)
   if bounds[2]-bounds[0]<222:break
   size-=1
  draw.text((xx+128-(bounds[2]-bounds[0])/2,yy+128-13*len(lines)+j*26),line,font=font,fill=(244,238,218))
atlas.resize((1024,1024),Image.Resampling.LANCZOS).save(HERE/'signs_base.png')
Image.new('RGB',(1024,1024),(247,133,18)).save(HERE/'signs_packed.png')
