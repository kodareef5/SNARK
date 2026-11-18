"""Original shed outer-scute fleck, not a feather or imported texture.

The silhouette is a shallow asymmetric keratin flake; the two short edge
breaks distinguish it from a leaf. It is dyed with the creature's flank.
"""
from pathlib import Path
import numpy as np
from PIL import Image

HERE=Path(__file__).resolve().parent
size=512;y,x=np.mgrid[:size,:size];x=(x+.5)/size*2-1;y=1-(y+.5)/size*2
angle=np.arctan2(y/1.05,x/.8);r=np.sqrt((x/.8)**2+(y/1.05)**2)
edge=.67+.045*np.sin(angle*5+.4)+.024*np.sin(angle*8)
cut=.10*np.exp(-((angle+.6)/.15)**2)+.09*np.exp(-((angle-2.4)/.18)**2)
alpha=np.clip((edge-cut-r)*size*.5+.5,0,1)
groove=np.clip((edge-cut-r)/.055,0,1)
grain=np.sin(x*83+y*37)*np.sin(x*47-y*103)
value=np.clip(174+48*groove+4*grain,0,255).astype(np.uint8)
rgba=np.zeros((size,size,4),np.uint8);rgba[...,:3]=value[...,None];rgba[...,3]=(alpha*255).astype(np.uint8)
regions=np.zeros((size,size,3),np.uint8);regions[...,0]=255
Image.fromarray(rgba).save(HERE/'scute.png',compress_level=9)
Image.fromarray(regions).save(HERE/'scute_regions.png',compress_level=9)
preview=Image.new('RGBA',(256,160),(48,48,48,255))
for side,left in ((128,16),(32,192)):
    small=Image.fromarray(rgba).resize((side,side),Image.Resampling.LANCZOS)
    preview.alpha_composite(small,(left,(160-side)//2))
preview.convert('RGB').save(HERE/'preview.png')
