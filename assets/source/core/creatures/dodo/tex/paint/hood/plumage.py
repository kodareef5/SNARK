"""Extract joined contour vanes from the round-7 generated specimen atlas.

The original and prompt are immutable inputs. Crops and aligned material fields
are derived working files, rebuilt here without changing their physical layout.
"""
from pathlib import Path
import json
import numpy as np
from PIL import Image
from scipy.ndimage import (label, binary_fill_holes, binary_opening,
                           gaussian_filter, distance_transform_edt)

ROOT=Path(__file__).resolve().parent


def smooth(t):
    t=np.clip(t,0,1);return t*t*(3-2*t)


def load():
    source=ROOT/'source';original='plumage_r7_original.png'
    image=np.array(Image.open(source/original).convert('RGBA'))
    H,W=image.shape[:2];specimens=[];manifest=[]
    for i in range(16):
        row,col=divmod(i,4);x0,x1=round(col*W/4),round((col+1)*W/4)
        y0,y1=round(row*H/4),round((row+1)*H/4)
        cell=image[y0:y1,x0:x1];labels,count=label(cell[...,3]>180)
        areas=np.bincount(labels.ravel());areas[0]=0
        solid=labels==areas.argmax();solid=binary_fill_holes(solid)
        # Remove isolated matte debris and subpixel hair-like extensions while
        # retaining the original broad rounded feather contour.
        solid=binary_opening(solid,iterations=2)
        yy,xx=np.where(solid);a0=max(0,xx.min()-3);a1=min(cell.shape[1],xx.max()+4)
        b0=max(0,yy.min()-3);b1=min(cell.shape[0],yy.max()+4)
        rgba=cell[b0:b1,a0:a1];solid=solid[b0:b1,a0:a1]
        alpha=gaussian_filter(solid.astype(float),1.35)
        valid=alpha>.5;h,w=alpha.shape
        rgb=rgba[...,:3].astype(float)/255
        linear=np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4).mean(-1)
        nearest=distance_transform_edt(~valid,return_distances=False,return_indices=True)
        grey=linear[nearest[0],nearest[1]]
        # The rounded silhouette establishes the whole feather. Retain its
        # interlocked barb drawing as well, so soft vanes do not become clay.
        broad=gaussian_filter(grey,1.6)
        drawing=.20*broad+.80*grey
        pigment=(drawing-drawing[valid].mean())*(.19/max(drawing[valid].std(),.001))
        pigment=np.clip(pigment,-.36,.36);pigment-=pigment[valid].mean()
        y,x=np.mgrid[:h,:w];t=y/max(h-1,1)
        # Track the source's narrow, pale central shaft without drawing an
        # artificial full-length stripe over every specimen.
        centre=np.sum(solid*x,axis=1)/np.maximum(solid.sum(1),1)
        good=solid.sum(1)>5;centre=np.interp(np.arange(h),np.where(good)[0],centre[good])
        centre=gaussian_filter(centre,4)
        ridge=np.maximum(grey-gaussian_filter(grey,(.5,2.2)),0)
        shaft=np.clip(ridge*18,0,1)*np.exp(-((x-centre[:,None])/(w*.075))**2)
        shaft*=smooth(t/.15)*(1-smooth((t-.82)/.16))
        shaft=gaussian_filter(shaft,(.65,1.1))
        shaft/=max(float(shaft.max()),.1)
        # A few cap shafts and each broader nape shaft survive the on-bird
        # shrink. Their paths come from the original, not parallel hair lines.
        pigment+=(.13 if i>=8 else .08 if i%3==0 else .025)*shaft
        pigment-=pigment[valid].mean()
        bevel=smooth(distance_transform_edt(valid)/(min(h,w)*.09))
        fine=np.clip((grey-broad)*8,-1,1)
        height=.29+.17*smooth(t/.85)+.055*bevel+.060*shaft+.018*fine
        rough=np.clip(.91-.018*shaft+.012*(grey-broad),.87,.94)
        fields=np.stack([alpha,height,pigment,rough,shaft]).astype(np.float32)
        family='cap' if i<8 else 'mane';name=f'{family}_vane_r7_{i%8+1:02d}'
        box=[int(v) for v in (x0+a0,y0+b0,x0+a1,y0+b1)]
        item=dict(id=name,kind=family,original=original,source_box_px=box,
                  size_px=[w,h],root_px=[float(centre[4]),4.],tip_px=[float(centre[-5]),float(h-5)],
                  layers=f'source/{name}_layers.npz',source_scope='paint/hood',
                  treatment='joined vane; broad intrinsic tip value; short soft contour; low relief')
        np.savez_compressed(source/f'{name}_layers.npz',**dict(zip(['alpha','height','pigment','roughness','shaft'],fields)))
        cutout=rgba.copy();cutout[...,3]=np.rint(alpha*255).astype(np.uint8)
        Image.fromarray(cutout).save(source/f'{name}_cutout.png')
        Image.fromarray(np.uint16(np.rint(np.clip(height,0,1)*65535))).save(source/f'{name}_height.png')
        Image.fromarray(np.uint8(np.rint(shaft*255))).save(source/f'{name}_shaft.png')
        manifest.append(item);specimens.append(dict(item,fields=fields))
    (source/'plumage_r7_elements.json').write_text(json.dumps(manifest,indent=2)+'\n')
    # Preserve the painter's existing family indices, dimensions and placement
    # streams. All edge/forehead specimens now end in coherent feather vanes.
    return ([specimens[i%8] for i in range(12)]+specimens[8:16]+
            specimens[8:16]+[specimens[i%8] for i in range(12)])
