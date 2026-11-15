#!/usr/bin/env python3
"""Ignored same-scale source/base/relight sheet; diagnostic only, not game lighting."""
from pathlib import Path
import sys
sys.dont_write_bytecode = True
import numpy as np
from PIL import Image,ImageDraw
from scipy.ndimage import map_coordinates
from scipy.spatial import cKDTree
import paint

ROOT=Path(__file__).resolve().parent
MEM=paint.study('membrane',['membrane_upper_base.png'])
FUZZ=ROOT/'source/accepted_fuzz'
w=paint.Wing()
base=np.asarray(Image.open(ROOT/'layers/pteranodon_wing_base.png'))
h=np.asarray(Image.open(ROOT/'layers/pteranodon_wing_height.png')).astype(np.float32)/65535*.8
occ=np.asarray(Image.open(ROOT/'layers/pteranodon_wing_occlusion.png')).astype(np.float32)/255

def derivative(a,axis):
    forward=np.roll(a,-1,axis);back=np.roll(a,1,axis)
    af=np.roll(w.piece,-1,axis)==w.piece;ab=np.roll(w.piece,1,axis)==w.piece
    return np.where(af&ab,(forward-back)*.5,np.where(af,forward-a,np.where(ab,a-back,0)))/np.maximum(w.mm,.001)
n=np.stack([-derivative(h,1),derivative(h,0),np.ones_like(h)],axis=2)
n/=np.linalg.norm(n,axis=2,keepdims=True)
# Physical rectangle within the inner main membrane. Every panel is 600 px/m.
width,height=420,300
x=.43+(np.arange(width)+.5)/600
z=-.07-(np.arange(height)+.5)/600
xx,zz=np.meshgrid(x,z)
up=w.mask('membrane_upper');yy,ux=np.where(up)
_,i=cKDTree(np.c_[w.x[up],w.z[up]]).query(np.c_[xx.ravel(),zz.ravel()])
sy=yy[i].reshape(height,width);sx=ux[i].reshape(height,width)

def atlas(a):
    return a[sy,sx]

def picture(a):
    return Image.fromarray(np.rint(np.clip(a,0,1)*255).astype(np.uint8))

def source_crop(path,linear_grey=False):
    a=Image.open(path).convert('RGB');side=a.width
    # 0.7 x 0.5 metres from an accepted 1 m source/study, no contrast adjustment.
    return a.crop((round(side*.10),round(side*.15),round(side*.80),round(side*.65))).resize((width,height),Image.Resampling.LANCZOS)

panels=[('Generated skin original / 600 px per m',source_crop(MEM/'source/gathered_original.png')),
        ('Accepted upper study / 600 px per m',source_crop(MEM/'membrane_upper_base.png')),
        ('Wing upper base / 600 px per m',Image.fromarray(atlas(base)[...,:3]))]
for light,label in [((-.6,.45,.7),'left'),((.6,.15,.8),'right'),((.05,-.75,.65),'rear')]:
    light=np.array(light);light=light/np.linalg.norm(light)
    diffuse=np.maximum(0,(atlas(n)*light).sum(2))
    color=paint.linear(atlas(base)[...,:3]/255)*(.34+.78*diffuse)[...,None]*atlas(occ)[...,None]
    panels.append((f'Python relief check: {label} light',picture(paint.srgb(color))))
sheet=Image.new('RGB',(3*(width+16)+16,2*(height+42)+16),(218,216,210));draw=ImageDraw.Draw(sheet)
for index,(label,im) in enumerate(panels):
    px=16+(index%3)*(width+16);py=16+(index//3)*(height+42)
    draw.text((px,py),label,fill=(35,37,40));sheet.paste(im,(px,py+24))
sheet.save(ROOT/'checks/source_base_relief.png')

# Physical comparison of the live fuzz tile and its arm placement, both approximately 738 px/m.
arm=w.mask('arm');ys,xs=np.where(arm)
col_start=int(np.percentile(xs,25));row_mid=int(np.median(ys))
arm_crop=Image.fromarray(base[...,:3]).crop((col_start,row_mid-60,col_start+280,row_mid+60))
fuzz=Image.open(FUZZ/'fuzz_base.png').convert('RGB').resize((369,369),Image.Resampling.LANCZOS)
fuzz=fuzz.rotate(90).crop((30,110,310,230))
out=Image.new('RGB',(592,164),(218,216,210));d=ImageDraw.Draw(out)
d.text((12,10),'Accepted fuzz, rotated out along arm',fill=(35,37,40))
d.text((304,10),'Arm placement at its measured texel scale',fill=(35,37,40))
out.paste(fuzz,(12,32));out.paste(arm_crop,(304,32));out.save(ROOT/'checks/fuzz_at_scale.png')
print('Wrote source, base and three physical relief previews; fuzz scale comparison.')
