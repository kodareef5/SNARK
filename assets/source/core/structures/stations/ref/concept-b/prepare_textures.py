"""Crop generated atlas and calibrate albedo means. No object imagery is used."""
from PIL import Image, ImageFilter
import numpy as np
from pathlib import Path
import shutil
root=Path(__file__).resolve().parent
src=root/'textures'/'source_atlas.png'
if not src.exists():
 raise FileNotFoundError('Missing local textures/source_atlas.png; retain this generated source when copying the project.')
im=Image.open(src).convert('RGB');w,h=im.size
spec=[('stone',(80,74,68),0,0),('clay',(168,132,100),1,0),('wood',(172,128,82),2,0),('paint',(98,110,100),0,1),('iron',(44,41,39),1,1),('steel',(150,150,148),2,1)]
for name,target,x,y in spec:
 tile=im.crop((x*w//3+8,y*h//2+8,(x+1)*w//3-8,(y+1)*h//2-8)).resize((768,768))
 a=np.asarray(tile).astype(float)
 # Remove the atlas stone's unwanted large joint-like shading, retaining mineral pores.
 if name=='stone':
  low=np.asarray(tile.filter(ImageFilter.GaussianBlur(1.8))).astype(float)
  a=a-low+a.mean(axis=(0,1));a=(a-a.mean(axis=(0,1)))*.45+a.mean(axis=(0,1))
 a+=np.array(target)-a.mean(axis=(0,1))
 Image.fromarray(np.uint8(np.clip(a,0,255))).save(root/'textures'/f'{name}.png')
 if name=='clay':
  a+=np.array((150,124,98))-np.array(target)
  Image.fromarray(np.uint8(np.clip(a,0,255))).save(root/'textures'/'mortar.png')
print('Seven albedo swatches saved from the six-material source atlas.')
