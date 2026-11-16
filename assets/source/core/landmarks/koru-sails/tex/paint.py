"""Original repeatable technical sailcloth, reinforcement and painted spar surfaces."""
from pathlib import Path
import numpy as np
from PIL import Image
HERE=Path(__file__).resolve().parent
for tag,rgb,n in [('cloth',(226,225,215),1024),('reinforcement',(202,204,198),1024),('spar',(232,232,224),64)]:
 y,x=np.mgrid[0:n,0:n];weave=(np.cos(x*np.pi)+np.cos(y*np.pi))*.65+np.cos((x+y)*np.pi*.5)*.35
 tone=weave*.8 if tag!='spar' else np.cos(y*np.pi*.25)*.1
 if tag=='cloth':tone=np.where((x<2)|(x>=n-2),tone-10,tone)
 height=.5+weave*.007 if tag!='spar' else np.full((n,n),.5)
 base=np.clip(np.array(rgb)[None,None,:]+tone[:,:,None],0,255).astype('uint8')
 Image.fromarray(base).save(HERE/(tag+'_base.png'))
 Image.fromarray(np.clip(height*255,0,255).astype('uint8')).save(HERE/(tag+'_height.png'))
 dx=(np.roll(height,-1,1)-np.roll(height,1,1))*.25;dy=(np.roll(height,-1,0)-np.roll(height,1,0))*.25
 normal=np.stack([-dx,dy,np.ones_like(height)],axis=-1);normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
 Image.fromarray(np.clip((normal*.5+.5)*255,0,255).astype('uint8')).save(HERE/(tag+'_normal.png'))
 packed=np.zeros((n,n,3),np.uint8);packed[:]=[250,220 if tag!='spar' else 126,0];Image.fromarray(packed).save(HERE/(tag+'_packed.png'))
print('painted original periodic sail finishes')
