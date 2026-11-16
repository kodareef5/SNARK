"""Original procedural marine surfaces and in-world wayfinding; no source photo pixels are sampled."""
from pathlib import Path
import json,math
import numpy as np
from PIL import Image,ImageDraw,ImageFont
HERE=Path(__file__).resolve().parent;ASSET=HERE.parent
LOOK=json.loads((ASSET/'materials.json').read_text());N=2048;C=N//4
rng=np.random.default_rng(125172)
base=np.zeros((N,N,3),np.float32);height=np.full((N,N),.5,np.float32);rough=np.zeros((N,N),np.float32);metal=np.zeros((N,N),np.float32)
y,x=np.mgrid[0:C,0:C];u=x/C;v=y/C
for tag,p in LOOK.items():
 cell=p['cell'];cx=cell%4*C;cy=cell//4*C
 noise=rng.normal(0,1,(C,C));grain=(np.sin(u*870+np.sin(v*28)*3)+np.sin(u*1800+np.sin(v*70)*5))*.5
 tone=noise*.8;h=np.full((C,C),.5,np.float32)
 if tag in('teak','mahogany'):
  boards=32 if tag=='teak' else 10;seam=np.minimum((u*boards)%1,1-(u*boards)%1)<(.025 if tag=='teak' else .018)
  variation=np.sin(np.floor(u*boards)*2.37)*5;tone=grain*3+variation+noise*.6;tone[seam]-=35;h+=grain*.007;h[seam]-=.08
  if tag=='teak':
   joints=np.minimum((v*3+np.floor(u*boards)*.37)%1,1-(v*3+np.floor(u*boards)*.37)%1)<.006;tone[joints]-=24;h[joints]-=.045
 elif tag in('fabric','white','rug'):
  weave=((x%3==0).astype(float)+(y%3==0).astype(float)-.6);tone=weave*2.2+noise*.6;h+=weave*.012
  if tag=='rug':
   pattern=((np.floor(u*16)+np.floor(v*16))%2)*8;diamonds=np.abs((u*8)%1-.5)+np.abs((v*8)%1-.5)<.25;tone+=pattern; tone[diamonds]+=15
 elif tag=='pool':
  caustic=np.sin(u*33+np.sin(v*19)*2)*np.sin(v*35+np.sin(u*14));tone=caustic*8+noise*.3;h+=caustic*.006
 elif tag=='steel':tone=np.sin(v*2400)*2+noise*.4;h+=np.sin(v*2400)*.0015
 elif tag=='screen':
  tone=noise*.2;grid=(x%43<1)|(y%43<1);tone[grid]+=9
  coast=(v-(.5+.18*np.sin(u*5)+.04*np.sin(u*24)))>.0;tone[coast]+=12
 else:tone+=np.sin(u*3+v*2)*.8
 rgb=np.array(p['rgb'])[None,None,:]+tone[:,:,None]
 if tag=='screen':rgb[:,:,1]+=9
 base[cy:cy+C,cx:cx+C]=rgb;height[cy:cy+C,cx:cx+C]=h
 rough[cy:cy+C,cx:cx+C]=p['roughness'];metal[cy:cy+C,cx:cx+C]=p['metal']
# Neutral outer gutter; all semantic UVs stay at least20px inside their cell. The atlas itself is non-tiling.
for arr,value in [(base,[147,142,131]),(height,.5),(rough,.5),(metal,0)]:
 arr[:8]=value;arr[-8:]=value;arr[:,:8]=value;arr[:,-8:]=value
Image.fromarray(np.clip(base,0,255).astype('uint8')).save(HERE/'surfaces_base.png')
Image.fromarray(np.clip(height*255,0,255).astype('uint8')).save(HERE/'surfaces_height.png')
# The same finite-difference height field defines the normal map, including a deliberately small relief amplitude.
dx=np.roll(height,-1,axis=1)-np.roll(height,1,axis=1);dy=np.roll(height,-1,axis=0)-np.roll(height,1,axis=0)
normal=np.stack([-dx*2,dy*2,np.ones_like(height)],axis=-1);normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
Image.fromarray(np.clip((normal*.5+.5)*255,0,255).astype('uint8')).save(HERE/'surfaces_normal.png')
packed=np.stack([np.ones_like(rough)*.97,rough,metal],axis=-1)
Image.fromarray(np.clip(packed*255,0,255).astype('uint8')).save(HERE/'surfaces_packed.png')
layout=json.loads((ASSET.parents[4]/'content/landmarks/koru-layout.json').read_text())
labels=sorted(set(r['label'] for r in layout['rooms'])|{'KORU','LOWER DECK','MAIN DECK','UPPER DECK','SUN DECK','COASTAL CHART','SAILS'})
signs={label:i for i,label in enumerate(labels)};(ASSET/'signs.json').write_text(json.dumps(signs,indent=2)+'\n')
atlas=Image.new('RGB',(2048,2048),(95,65,39));draw=ImageDraw.Draw(atlas)
fontpath='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
for label,i in signs.items():
 xx=i%8*256;yy=i//8*256
 draw.rounded_rectangle((xx+8,yy+78,xx+248,yy+178),radius=7,fill=(158,123,67),outline=(213,186,124),width=3)
 words=label.upper();lines=[words]
 if len(words)>22:
  split=words.rfind(' ',0,len(words)//2+4);lines=[words[:split],words[split+1:]]
 for j,line in enumerate(lines):
  size=19
  while size>10:
   font=ImageFont.truetype(fontpath,size);b=draw.textbbox((0,0),line,font=font)
   if b[2]-b[0]<222:break
   size-=1
  b=draw.textbbox((0,0),line,font=font);draw.text((xx+128-(b[2]-b[0])/2,yy+128-12*len(lines)+j*25),line,font=font,fill=(240,224,183))
atlas.save(HERE/'signs_base.png')
Image.new('RGB',(2048,2048),(247,100,180)).save(HERE/'signs_packed.png')
print('painted original surface atlas and',len(signs),'in-world plaques')
