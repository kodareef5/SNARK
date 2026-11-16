#!/usr/bin/env python3
"""Build the membrane study. Requires Pillow, NumPy, SciPy; no network.

python3 tex/studies/membrane/build.py [--feature-scale 1] [--direction-deg 0]
Feature scale changes vessels/creases in physical metres; direction rotates the
authoring field before toroidal rasterisation. Under always mirrors upper in X.
The generated source stays untouched. All other source maps are reproducible.
"""
from pathlib import Path
import argparse
import json
import math
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
from scipy.fft import fft2, ifft2

HERE = Path(__file__).resolve().parent
N = 2048
SPAN = 1.0
HEIGHT_MM = 0.8


def linear(s):
    s = np.asarray(s, dtype=np.float32)
    return np.where(s <= .04045, s / 12.92, ((s + .055) / 1.055) ** 2.4)


def srgb(v):
    v = np.clip(v, 0, 1)
    return np.where(v <= .0031308, v * 12.92, 1.055 * v ** (1 / 2.4) - .055)


def rgb_save(path, a):
    if a.ndim == 2:
        a = np.repeat(a[..., None], 3, axis=2)
    Image.fromarray(a.astype(np.uint8)).save(path)


def gray16(path, a):
    Image.fromarray(np.rint(np.clip(a, 0, 1) * 65535).astype(np.uint16)).save(path)


def periodic(a):
    """Periodic-plus-smooth decomposition; remove boundary ramp, not detail."""
    v = np.zeros_like(a)
    v[0] = a[-1] - a[0]
    v[-1] = -v[0]
    v[:, 0] += a[:, -1] - a[:, 0]
    v[:, -1] -= a[:, -1] - a[:, 0]
    q = 2 * np.cos(2 * np.pi * np.arange(N, dtype=np.float32) / N)
    den = q[:, None] + q[None, :] - 4
    den[0, 0] = 1
    f = fft2(v) / den
    f[0, 0] = 0
    return (a - ifft2(f).real).astype(np.float32)


def resize_field(a, n=N):
    return np.asarray(Image.fromarray(a.astype(np.float32)).resize((n,n),Image.Resampling.BICUBIC)).copy()


def balanced(a):
    """Remove only the first two periodic illumination harmonics, retaining 5–20 cm variation."""
    f=fft2(a)
    f[:3,:3]=0; f[:3,-2:]=0; f[-2:,:3]=0; f[-2:,-2:]=0
    return ifft2(f).real.astype(np.float32)


def source_fields():
    from scipy.ndimage import map_coordinates
    # The second generated painting supplies vessel-free skin and real pleats.
    a=np.asarray(Image.open(HERE/'source/gathered_original.png').convert('L'),dtype=np.float32)/255
    fine=a-gaussian_filter(a,2.7)
    fine=gaussian_filter(periodic(resize_field(fine)),.6,mode='wrap')
    fine/=fine.std()
    yy,xx=np.mgrid[:N,:N].astype(np.float32)
    # Four physical reductions put the source's tiny reticulum at 0.4–1 mm.
    # Smooth nonuniform warping prevents a visible repeated microstamp.
    sx=4*xx+26*np.sin(yy*2*np.pi/N)+17*np.sin(xx*4*np.pi/N)
    sy=4*yy+31*np.sin(xx*2*np.pi/N)+13*np.sin(yy*6*np.pi/N)
    micro=map_coordinates(fine,[sy,sx],order=1,mode='grid-wrap')
    micro=gaussian_filter(micro,.38,mode='wrap')
    micro=np.tanh(micro/1.6)*1.6
    micro-=micro.mean();micro/=micro.std()
    # Lower-frequency skin creases are retained in gathered areas at ~2 mm.
    middle=map_coordinates(fine,[2*yy+11*np.sin(xx*2*np.pi/N),2*xx],order=1,mode='grid-wrap')
    middle=gaussian_filter(middle,.5,mode='wrap')
    middle=np.tanh(middle/1.7)*1.7;middle-=middle.mean()
    # Soft thickness comes from the first painting, with vessels masked out.
    src=np.asarray(Image.open(HERE/'source/membrane_original.png').convert('RGB'),dtype=np.float32)/255
    lum=linear(src).mean(2)
    chroma=gaussian_filter(src[:,:,0]-src[:,:,1],3)
    mask=chroma<.008
    clear=gaussian_filter(lum*mask,13)/np.maximum(gaussian_filter(mask.astype(np.float32),13),.001)
    thick=gaussian_filter(clear,20)-gaussian_filter(clear,100)
    thick=balanced(periodic(resize_field(thick)))
    thick/=thick.std();thick=1.7*np.tanh(thick/1.7);thick=balanced(thick)
    # Extract only darker pleat grooves; no directional bright edge in albedo.
    low=gaussian_filter(a,4)
    pleat=np.clip((gaussian_filter(a,24)-low-.003)/.044,0,1)
    pleat=gaussian_filter(periodic(resize_field(pleat)),1.8,mode='wrap')
    pleat=np.clip(pleat,0,1)
    return micro,thick,middle,pleat,fine


def raster(paths, scale, rotation):
    """Physical Gaussian cross-sections around the GENERATED, traced drawing."""
    result=np.zeros((N,N),np.float32)
    c,s=np.cos(rotation),np.sin(rotation)
    rot=np.asarray([[c,-s],[s,c]],np.float32)
    for path in paths:
        source=np.asarray(path['points'],np.float32)
        p=((source-.5)@rot.T*scale+.5)*N
        widths=np.asarray(path['widths_mm'],np.float32)*N/1000*scale
        strength=np.asarray(path['strengths'],np.float32)
        arc=np.r_[0,np.cumsum(np.linalg.norm(np.diff(p,axis=0),axis=1))]
        opacity=strength.copy()
        if path['start_terminal']: opacity*=np.clip(arc/24,0,1)**.7
        if path['end_terminal']: opacity*=np.clip((arc[-1]-arc)/24,0,1)**.7
        # The non-periodic source's roots/endings dissolve within the boundary
        # margin, avoiding splicing unrelated vessels or making crossings.
        edge=np.minimum.reduce([source[:,0],source[:,1],1-source[:,0],1-source[:,1]])
        opacity*=np.sin(np.clip(edge/.018,0,1)*np.pi/2)**2
        for j in range(len(p)-1):
            a,b=p[j],p[j+1]
            sigma=max(.30,(widths[j]+widths[j+1])/4.71)
            radius=max(2.,sigma*3.2)
            x0,y0=np.floor(np.minimum(a,b)-radius).astype(int)
            x1,y1=np.ceil(np.maximum(a,b)+radius).astype(int)
            xx,yy=np.meshgrid(np.arange(x0,x1+1),np.arange(y0,y1+1))
            dx,dy=b-a
            u=np.clip(((xx-a[0])*dx+(yy-a[1])*dy)/(dx*dx+dy*dy+1e-12),0,1)
            d2=(xx-a[0]-u*dx)**2+(yy-a[1]-u*dy)**2
            v=np.exp(-d2/(2*sigma*sigma))*((1-u)*opacity[j]+u*opacity[j+1])
            ix,iy=xx%N,yy%N
            result[iy,ix]=np.maximum(result[iy,ix],v)
    return result


def transform_field(a,scale,rotation):
    if scale==1 and rotation==0: return a
    from scipy.ndimage import map_coordinates
    y,x=np.mgrid[:N,:N].astype(np.float32);x-=N/2;y-=N/2
    c,s=np.cos(rotation),np.sin(rotation)
    return periodic(map_coordinates(a,[(c*y-s*x)/scale+N/2,(c*x+s*y)/scale+N/2],order=1,mode='grid-wrap'))


def normal_from_height(h16):
    h = h16.astype(np.float32) / 65535 * HEIGHT_MM / 1000
    dx = (np.roll(h, -1, 1)-np.roll(h, 1, 1)) * (N / (2*SPAN))
    dy = (np.roll(h, -1, 0)-np.roll(h, 1, 0)) * (N / (2*SPAN))
    norm = np.stack([-dx, dy, np.ones_like(dx)], axis=-1)
    norm /= np.linalg.norm(norm, axis=-1, keepdims=True)
    return np.rint((norm*.5+.5)*255).astype(np.uint8)


def base_to_bytes(b, target):
    # Solve the mean after 8-bit encoding, rather than assuming quantisation is neutral.
    low, high = -.02, .02
    for _ in range(19):
        off = (low+high)/2
        q = np.rint(srgb(b + off)*255).astype(np.uint8)
        if float(linear(q/255).mean()) < target:
            low = off
        else:
            high = off
    return np.rint(srgb(b + (low+high)/2)*255).astype(np.uint8)


def write_set(name, micro, thick, vein, middle, pleat, stretch, target, under=False, creased=False):
    # Crease floors carry pigment; remove the generated bright rims so the
    # albedo describes a fine living reticulum rather than embossed paper.
    fine_groove=np.maximum(-micro,0)
    mid_groove=np.maximum(-middle,0)
    stretch_groove=np.maximum(-stretch,0)
    crease=fine_groove/3
    b=target+target*.025*thick-(.305 if under else .145)*vein
    b-=(.026 if under else .016)*fine_groove
    b-=(.090 if under else .028)*mid_groove
    b-=(.065 if under else .022)*stretch_groove
    if creased: b-=.028*mid_groove+.070*pleat
    b=balanced(b)+target
    h=.4-.012*fine_groove-.010*mid_groove-.008*stretch_groove+.009*thick
    h+=.080*gaussian_filter(vein,.65,mode='wrap')
    if creased: h-=.015*mid_groove+.215*pleat
    roughness=.75+.009*micro-.045*vein+.012*crease
    ao=1-np.clip(gaussian_filter(h,3.5,mode='wrap')-h,0,.25)*.45
    if under: b,h,roughness,ao=[np.fliplr(x).copy() for x in (b,h,roughness,ao)]
    h16=np.rint(np.clip(h/HEIGHT_MM,0,1)*65535).astype(np.uint16)
    Image.fromarray(h16).save(HERE/f'{name}_height.png')
    rgb_save(HERE/f'{name}_base.png',base_to_bytes(b,target))
    rgb_save(HERE/f'{name}_normal.png',normal_from_height(h16))
    rgb_save(HERE/f'{name}_packed.png',np.rint(np.clip(np.stack([ao,roughness,np.zeros_like(ao)],-1),0,1)*255))
    Image.new('RGB',(N,N),(255,0,255)).save(HERE/f'{name}_regions.png')
    print(f'{name}: linear mean {linear(np.asarray(Image.open(HERE/f"{name}_base.png"))[:,:,0]/255).mean():.6f}; height {h.min():.4f}..{h.max():.4f} mm',flush=True)


def main():
    from extract import extract
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--feature-scale',type=float,default=1.)
    parser.add_argument('--direction-deg',type=float,default=0.)
    args=parser.parse_args()
    if not .1<=args.feature_scale<=5: parser.error('feature scale must be between 0.1 and 5')
    (HERE/'checks').mkdir(exist_ok=True)
    paths=extract()
    micro,thick,middle,pleat,stretch=source_fields()
    rad=math.radians(args.direction_deg)
    micro,thick,middle,pleat,stretch=[transform_field(a,args.feature_scale,rad) for a in (micro,thick,middle,pleat,stretch)]
    for name,field in [('skin_detail',micro),('skin_thickness',thick),('skin_gathered_detail',middle),('skin_stretch_detail',stretch)]:
        gray16(HERE/'source'/f'{name}.png',.5+field/10)
    vein=raster(paths,args.feature_scale,rad)
    for name,a in [('veins_upper',vein),('veins_under',vein[:,::-1]),
                   ('creases_quiet',np.clip(-micro/3,0,1)),
                   ('creases_gathered',np.clip(-middle/3,0,1)),('pleats',pleat)]:
        gray16(HERE/'source'/f'{name}.png',a)
    sets={}
    for name,target,under,creased in [('membrane_upper',.4,False,False),('membrane_under',.6,True,False),('membrane_creased',.4,False,True)]:
        write_set(name,micro,thick,vein,middle,pleat,stretch,target,under,creased)
        sets[name]=dict(span_m=1.,tiles=True,cutout=False,height_mm=HEIGHT_MM,regions=[4],form='sheet',
            width=2.,depth=1.,camber=.05,face='under' if under else 'upper',mean_linear=target,pixels=N,height_zero_mm=-.4)
    data=dict(sets=sets,round=2,generator=dict(feature_scale=args.feature_scale,direction_deg=args.direction_deg),
        direction='x span toward tip, y leading to trailing; underside mirrored in x for back-to-back UVs',
        normal='OpenGL, red=-dH/dx, green=+dH/d(image y), wrapped centred derivative in metres',
        height_encoding='0..65535 represents 0.8 mm; midgrey is zero displacement',
        physical_features=dict(primary_fwhm_mm=[2.3,2.8],terminal_fwhm_mm=[.5,.9],vein_rise_mm=.080,
            microcrease_spacing_mm=[.4,1.],pleat_depth_mm=.215),
        source='Built-in imagegen membrane_original.png, membrane_refined_original.png and gathered_original.png; traced painted vessels; extracted generated skin and folds')
    (HERE/'study.json').write_text(json.dumps(data,indent=2)+'\n')


if __name__=='__main__': main()
