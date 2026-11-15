#!/usr/bin/env python3
"""Rebuild the fig/banyan upper crown atlas offline. All writes stay beside this script.

Originals are unmodified imagegen outputs. Colour is sRGB; relief is mm.
The relief is inferred, not a recovered scan: foliage folds / sprays / blades
are frequency-separated from the generated artwork, then share one height.
"""
from pathlib import Path
import hashlib
import json
import numpy as np
from PIL import Image, PngImagePlugin
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'source'
N = 512
RADIUS = .94 * 256
HEIGHT_MM = 240.0
PITCH_MM = 2200.0 / RADIUS
TARGETS = [(96,112,58),(74,92,52),(56,74,46),(78,90,64),(36,50,36)]
LUMA = np.array([.2126,.7152,.0722])


def save_png(a, path, srgb=False, description=''):
    info = PngImagePlugin.PngInfo()
    if srgb:
        info.add(b'sRGB', b'\x00')
        info.add(b'gAMA', (45455).to_bytes(4, 'big'))
    info.add_text('Description', description)
    Image.fromarray(a).save(path, pnginfo=info, compress_level=7)


def resize(a, size):
    if a.ndim == 2:
        return np.asarray(Image.fromarray(a.astype(np.float32)).resize(size, Image.Resampling.LANCZOS))
    return np.stack([resize(a[...,k],size) for k in range(a.shape[-1])],-1)


def smooth(a, sigma, periodic=False):
    return ndi.gaussian_filter(a,sigma,mode='wrap' if periodic else 'reflect')


def periodic_quilt(raw, w=512, h=512, overlap=80):
    """Join opposite edges with minimum-error cuts, not mirrored leaves.

    Sample a larger source rectangle; select one crossing path through each
    overlap, put that join in the tile centre. All filtering subsequently uses
    wrap. A three-pixel feather limits discontinuities at the selected join.
    """
    raw=resize(raw,(w+overlap,h+overlap))
    def join(a,period):
        ov=a.shape[1]-period
        left=a[:,:ov];right=a[:,period:]
        error=np.mean((left-right)**2,axis=2)
        error=ndi.gaussian_filter(error,(1.3,1.0))
        cost=error.copy();backs=np.zeros(cost.shape,np.int8)
        for y in range(1,len(cost)):
            p=np.pad(cost[y-1],(1,1),constant_values=1e12)
            candidates=np.stack([p[:-2],p[1:-1],p[2:]])
            choice=candidates.argmin(0)
            backs[y]=choice-1
            cost[y]+=candidates[choice,np.arange(ov)]
        x=int(cost[-1].argmin());path=np.empty(len(cost),int)
        for y in range(len(cost)-1,-1,-1):
            path[y]=x
            x+=int(backs[y,x])
        t=np.clip((np.arange(ov)[None,:]-path[:,None]+1.5)/3,0,1)
        t=t*t*(3-2*t)
        band=right*(1-t[...,None])+left*t[...,None]
        out=np.concatenate([band,a[:,ov:period]],axis=1)
        return np.roll(out,period//2,axis=1),path
    out,px=join(raw,w)
    out,py=join(out.transpose(1,0,2),h)
    return out.transpose(1,0,2),dict(overlap=overlap,x_path=px.tolist(),y_path=py.tolist())


def field(raw, mask, periodic=False):
    """Remove first-order image-axis lighting; keep local folded foliage."""
    lum=np.sum(raw*LUMA,axis=-1)
    log=np.log(np.maximum(lum,5))
    y,x=np.mgrid[:log.shape[0],:log.shape[1]].astype(float)
    x=(x-(log.shape[1]-1)/2)/(log.shape[1]/2)
    y=(y-(log.shape[0]-1)/2)/(log.shape[0]/2)
    if not periodic:
        # Radial terms prevent confusing centre-to-edge occlusion with lighting.
        design=np.stack([np.ones_like(x),x,y,x*x+y*y,(x*x+y*y)**2],-1)
        fit=np.linalg.lstsq(design[mask],log[mask],rcond=None)[0]
        log-=fit[1]*x+fit[2]*y
    else:
        fit=np.zeros(5)
    med=np.median(log[mask]);spread=np.std(log[mask])
    q=(log-med)/max(spread,.1)
    q=np.clip(q,-2.6,2.6)
    return q,fit[1:3]


def calibrate(rgb, mask, target, low, high, weight=None):
    """Meet the requested disc mean without raising the protected outer ring."""
    if weight is None:weight=np.ones(mask.shape)
    out=rgb.copy()
    for _ in range(35):
        out=np.clip(out,low,high)
        difference=np.array(target)-out[mask].mean(0)
        out+=weight[...,None]*difference/max(weight[mask].mean(),.001)
    return np.clip(out,low,high)


def head_colour(q, macro, radius, mask, target, group):
    """Monotonic pigment mapping: no clipped flat faces or lifted gap floor.

    Monotonic sigmoids meet the three means. Blue is constrained below green
    even when the underside blue mean is near its ceiling. Radial shading
    changes pigment, never resolution or blur.
    """
    low=np.array([13.,22.,15.])
    # Habitat pigment ceilings keep shade leaves cool and the interior dim;
    # achieving the same mean alone would allow too many sun-coloured faces.
    high=np.array([(160,165,80),(143,155,80),(118,137,80),
                   (126,140,80),(74,92,65)][group],float)
    edge=np.clip((radius-.88)/.12,0,1)
    edge=edge*edge*(3-2*edge)
    shade=(1-.24*edge)*(1-.30*np.clip((radius-1)/.4,0,1))
    tone=q+.20*np.tanh(macro*1.25)
    def channel(c,ceiling,slope):
        lower,upper=-12.,12.
        for _ in range(45):
            offset=(lower+upper)/2
            v=low[c]+(ceiling-low[c])/(1+np.exp(-slope*(tone+offset)))
            if v[mask].mean()<target[c]:lower=offset
            else:upper=offset
        return v
    slope=2.2
    green=channel(1,low[1]+(high[1]-low[1])*shade,slope)
    # Keep enough blue headroom to retain pale underside tissue, without a
    # blue shadow population or hard colour clipping.
    while np.minimum(high[2],green-4)[mask].mean()<target[2]+3:
        slope*=.85
        if slope<.3:raise ValueError('Infeasible pigment targets')
        green=channel(1,low[1]+(high[1]-low[1])*shade,slope)
    red=channel(0,np.minimum(low[0]+(high[0]-low[0])*shade,green+4),slope)
    blue=channel(2,np.minimum(low[2]+(high[2]-low[2])*shade,green-4),slope)
    return np.stack([red,green,blue],-1)


def material(raw, group, periodic=False):
    h,w=raw.shape[:2]
    y,x=np.mgrid[:h,:w]
    radius=np.hypot(x-(w-1)/2,y-(h-1)/2)/RADIUS
    mask=np.ones((h,w),bool) if periodic else radius<=1
    q,plane=field(raw,mask,periodic)
    macro=smooth(q,32 if periodic else 20,periodic)
    # Fig heads: 11–15px blades; the 2.4m interior has roughly twice the texel density.
    blade_sigma=9.0 if periodic else 5.0
    spray=smooth(q,blade_sigma,periodic)-macro
    blade=smooth(q,.45 if periodic else .30,periodic)-smooth(q,blade_sigma,periodic)
    # No metre-scale dome in height: the closed mesh supplies that normal.
    relief=112+70*np.tanh(macro*1.35)+22*np.tanh(spray*1.35)+7*np.tanh(blade*1.5)
    if periodic:relief=88+(relief-112)*.65
    relief=np.clip(relief,4,HEIGHT_MM-4)
    recess=np.maximum(0,smooth(relief,11,periodic)-relief)
    ao=.82+.20*np.tanh(macro*1.5)-.27*np.clip(recess/20,0,1)
    ao=np.clip(ao,.34,.98)
    # Sharp local pigment shapes retain individual oval blades. Coarse
    # colour contrast is subordinate to the AO and shared relief.
    detail=34*np.tanh(q*.85)+13*np.tanh(spray*1.5)+17*np.tanh(macro*1.25)
    hue=raw/np.maximum(np.sum(raw*LUMA,axis=-1),8)[...,None]
    hue-=np.mean(hue[mask],axis=0)
    hue=np.clip(hue,-.22,.22)*13
    target=np.array(TARGETS[group],float)
    rgb=target+detail[...,None]*[1,.94,.55]+hue
    if not periodic:
        rgb=head_colour(q,macro,radius,mask,target,group)
        ao*=1-.13*np.clip(radius,0,1)**4
    else:
        # Interior uses the same monotonic palette mapping without radial falloff.
        rgb=head_colour(q,macro,np.zeros_like(radius),mask,target,group)
    roughbase=[.32,.39,.48,.76,.72][group]
    rough=roughbase+.065*np.tanh(-blade)+.055*np.maximum(0,-macro)
    rough=np.clip(rough,.24,.90)
    return dict(rgb=rgb,z=relief,ao=ao,rough=rough,plane=plane,mask=mask)


def normals(height,pitch,periodic=False):
    if periodic:
        dx=(np.roll(height,-1,1)-np.roll(height,1,1))/(2*pitch)
        dy=(np.roll(height,-1,0)-np.roll(height,1,0))/(2*pitch)
    else:
        dy,dx=np.gradient(height,pitch)
    n=np.stack([-dx,dy,np.ones_like(height)],-1)
    return n/np.linalg.norm(n,axis=-1,keepdims=True)


def main():
    top=np.asarray(Image.open(SOURCE/'top_heads_generated.png').convert('RGB'),float)
    under=np.asarray(Image.open(SOURCE/'underside_generated.png').convert('RGB'),float)
    interior=np.asarray(Image.open(SOURCE/'interior_generated.png').convert('RGB'),float)
    base=np.zeros((1024,2048,3),np.uint8)
    height=np.zeros((1024,2048),np.uint16)
    normal=np.zeros((1024,2048,3),np.uint8)
    orm=np.zeros((1024,2048,3),float)
    regions=[]
    for i in range(6):
        row,col=divmod(i,2)
        raw=top[row*top.shape[0]//3:(row+1)*top.shape[0]//3,
                col*top.shape[1]//2:(col+1)*top.shape[1]//2]
        regions.append((resize(raw,(N,N)),i//2,False))
    regions.append((resize(under,(N,N)),3,False))
    tile,quilt=periodic_quilt(interior)
    regions.append((tile,4,True))
    records=[]
    for i,(raw,group,periodic) in enumerate(regions):
        y,x=(i//4)*N,(i%4)*N
        sl=np.s_[y:y+N,x:x+N]
        m=material(raw,group,periodic)
        # The exported quantized height is the single source of normal slopes.
        hz=np.rint(m['z']/HEIGHT_MM*65535).astype(np.uint16)
        height[sl]=hz
        pitch=2400/N if periodic else PITCH_MM
        nn=normals(hz.astype(float)*HEIGHT_MM/65535,pitch,periodic)
        normal[sl]=np.rint((nn*.5+.5)*255).astype(np.uint8)
        base[sl]=np.rint(m['rgb']).astype(np.uint8)
        orm[sl][...,0]=m['ao']*255
        orm[sl][...,1]=m['rough']*255
        records.append(dict(index=i,group=['sun','middle','shade','underside','interior'][group],
            xywh=[x,y,N,N],periodic=periodic,pitch_mm=pitch,
            removed_log_luminance_plane=m['plane'].tolist(),
            mean_rgb=base[sl][m['mask']].mean(0).tolist(),
            height_mm=[float(hz.min()*HEIGHT_MM/65535),float(hz.max()*HEIGHT_MM/65535)]))
    save_png(base,ROOT/'fig_heads_base.png',True,
        'Fig/banyan upper atlas: sun 0/1, middle 2/3, shade 4/5, underside 6, periodic interior 7. Opaque sRGB.')
    save_png(height,ROOT/'fig_heads_height.png',False,
        'Linear uint16: black=0 mm, white=240 mm. Local foliage relief; mesh supplies head curvature.')
    save_png(normal,ROOT/'fig_heads_normal.png',False,
        'Linear tangent normal normalize(-dH/dx,+dH/drow,1), from delivered uint16 height.')
    small=np.rint(orm.reshape(512,2,1024,2,3).mean((1,3))).astype(np.uint8)
    save_png(small,ROOT/'fig_heads_orm.png',False,
        'Linear R=occlusion G=roughness B=0 metal. Aligned 2x2 area reduction.')
    (SOURCE/'layout.json').write_text(json.dumps(dict(size=[2048,1024],radius_pixels=RADIUS,
        disc_surface_radius_mm=2200,height_range_mm=[0,HEIGHT_MM],leaf_length_mm=[100,140],
        targets=TARGETS,regions=records),indent=2)+'\n')
    (SOURCE/'interior_quilt.json').write_text(json.dumps(quilt,separators=(',',':'))+'\n')
    manifest={p.name:dict(size=list(Image.open(p).size),sha256=hashlib.sha256(p.read_bytes()).hexdigest())
        for p in SOURCE.glob('*_generated.png')}
    (SOURCE/'originals.json').write_text(json.dumps(dict(method='built-in imagegen',sources=manifest,
        source_policy='Generated from words informed by the project art. No external imagery.'),indent=2)+'\n')
    print('Built four maps: 2048x1024 base/normal/height, 1024x512 ORM; height 0–240 mm.')
    for r in records:print(r['index'],r['group'],np.round(r['mean_rgb'],2).tolist())


if __name__=='__main__':main()
