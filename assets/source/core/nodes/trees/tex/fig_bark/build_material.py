#!/usr/bin/env python3
"""Fig bark second set. Offline, deterministic, current-folder-only build.
Four native paintings -> periodic master -> separated pigment and relief ->
quantized 18 mm height -> physical OpenGL normal -> geometry AO and roughness.
"""
from pathlib import Path
import hashlib
import json
import sys
import numpy as np
from PIL import Image, PngImagePlugin
from scipy.ndimage import gaussian_filter
ROOT = Path(__file__).resolve().parent
C = json.loads((ROOT/'material.json').read_text())
N = C['resolution'][0]
RNG = np.random.default_rng(C['seed'])
SRGB = (ROOT/'source/srgb.icc').read_bytes()


def smooth(lo, hi, x):
    t = np.clip((x-lo)/(hi-lo), 0, 1)
    return t*t*(3-2*t)


def blur(a, sigma):
    return gaussian_filter(a, sigma, mode='wrap')


def luma(a):
    return a[...,0]*.2126+a[...,1]*.7152+a[...,2]*.0722


def col(key):
    h = C['palette'].get(key, key)
    return np.array([int(h[i:i+2],16) for i in (1,3,5)], np.float32)


def mix(a,b,w):
    return a*(1-w[...,None])+b*w[...,None]


def save(path,a,srgb=False,description=''):
    info = PngImagePlugin.PngInfo()
    info.add_text('Description',description)
    info.add_text('Material','Fig and banyan bark / second set')
    info.add_text('Coverage','1.6 m across x 2.0 m along; repeat U and V; top is up')
    info.add_text('Color space','sRGB' if srgb else 'linear data')
    if 'height' in path.name: info.add_text('Height encoding','0..65535 = 0..18 mm; white high')
    if 'normal' in path.name: info.add_text('Normal convention','OpenGL; +X right, +Y image-up, +Z outward')
    if a.dtype != np.uint16: a = np.clip(np.rint(a),0,255).astype(np.uint8)
    Image.fromarray(a).save(path,pnginfo=info,**({'icc_profile':SRGB} if srgb else {}))


def cut(old,new,periodic=False):
    """Minimum-error overlap path; final closure has cyclic endpoints."""
    err = gaussian_filter(np.mean((old-new)**2,axis=-1),1.4)
    err[:,:16] += 1e6
    err[:,-16:] += 1e6
    h,w = err.shape
    start = int(np.argmin(gaussian_filter(err[:12].mean(0)+err[-12:].mean(0),4)))
    back = np.empty((h,w),np.int16)
    v = err[0].copy()
    if periodic:
        v[:] = 1e20
        v[start] = err[0,start]
    for y in range(1,h):
        opts = np.stack((np.r_[1e20,v[:-1]],v,np.r_[v[1:],1e20]))
        best = opts.argmin(0)
        back[y] = np.arange(w)+best-1
        v = err[y]+opts.min(0)
    path = np.empty(h,np.int16)
    path[-1] = start if periodic else v.argmin()
    for y in range(h-2,-1,-1): path[y] = back[y+1,path[y+1]]
    return smooth(-4,4,np.arange(w)[None,:]-path[:,None]).astype(np.float32)


def close(a,overlap,cyclic=False):
    period = a.shape[1]-overlap
    w = cut(a[:,period:],a[:,:overlap],cyclic)
    result = a[:,:period].copy()
    result[:,:overlap] = mix(a[:,period:],a[:,:overlap],w)
    return result


def master():
    """Each native picture occurs once; no repeated crops inside the tile."""
    step,patch = 1024,1254
    overlap = patch-step
    canvas = np.zeros((step+patch,step+patch,3),np.float32)
    records = []
    for i,filename in enumerate(C['sources']):
        p = ROOT/filename
        im = Image.open(p).convert('RGB')
        assert im.size == (patch,patch),(p,im.size)
        a = np.array(im,np.float32)
        # Match exposures between originals, preserving within-image pigment variation.
        a += (np.array([150.,150.,138.])-a.mean((0,1)))
        if i in (1,2): a = a[:,::-1]
        iy,ix = divmod(i,2)
        target = canvas[iy*step:iy*step+patch,ix*step:ix*step+patch]
        w = np.ones((patch,patch),np.float32)
        if ix: w[:,:overlap] = cut(target[:,:overlap],a[:,:overlap])
        if iy: w[:overlap] = np.minimum(w[:overlap],cut(target[:overlap].transpose(1,0,2),a[:overlap].transpose(1,0,2)).T)
        target[:] = mix(target,a,w)
        records.append({'file':filename,'native_size':list(im.size),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'grid_xy':[ix,iy],'flip_x':i in (1,2)})
    a = close(canvas,overlap)
    a = close(a.transpose(1,0,2),overlap,cyclic=True).transpose(1,0,2)
    a = np.roll(a,(351,579),(0,1))
    assert a.shape == (N,N,3)
    save(ROOT/'source/periodic_master.png',a,True,'Native original paintings; minimum-error toroidal composition; construction source, not albedo')
    (ROOT/'source/composition.json').write_text(json.dumps({'patch_pixels':patch,'stride':step,'overlap':overlap,'roll_yx':[351,579],'sources':records},indent=2)+'\n')
    return a


def organic_field(sigma):
    """Low-frequency periodic random field; no repeated stamps or mirrored edges."""
    from scipy.ndimage import map_coordinates
    sy,sx = sigma
    small = gaussian_filter(RNG.standard_normal((256,256)).astype(np.float32),(sy/8,sx/8),mode='wrap')
    small /= max(float(small.std()),1e-8)
    yy,xx = np.meshgrid((np.arange(N)+.5)/8-.5,(np.arange(N)+.5)/8-.5,indexing='ij')
    a = map_coordinates(small,[yy,xx],order=3,mode='grid-wrap')
    return np.tanh(a/1.8).astype(np.float32)


def derive(src):
    g=luma(src)
    mid=blur(g,18)
    fine=blur(g,.65)-blur(g,3.6)
    # Preserve irregular generated anatomy, suppress its directional microshading.
    # The large pigment islands remain pigment; they do not all become bumps.
    cloud=organic_field((145,120))
    folds=organic_field((280,42))*.78+organic_field((120,22))*.22
    h=.008+.0072*folds
    h+=(blur(g,(14,3))-blur(g,(40,18)))*.000055
    h+=fine*.000031
    h=blur(h,.8)
    h-=h.min(); h*=.018/h.max()

    # Rebuild chroma and macro pigment separately from the tiny lit source pairs.
    chroma=src-g[...,None]
    chroma=blur(chroma,(1.2,1.2,0))
    pigment=150+(mid-mid.mean())*1.15+cloud*28+folds*3
    detail=(blur(g,1.2)-mid)*.78+fine*.30
    base=pigment[...,None]+chroma*1.10+detail[...,None]
    # Natural cool/cream variation is broad and soft-edged, not a grid of blobs.
    warm=organic_field((170,155))
    base+=warm[...,None]*np.array([5.0,1.0,-5.0],np.float32)
    green=src[...,1]-(src[...,0]+src[...,2])*.5
    film=smooth(7,14,blur(green,3))*smooth(-.25,.5,organic_field((140,100)))
    film=np.clip(film*.85,0,.85)
    # Follow narrow drainage anatomy already present in the native paintings.
    # An elongated local trough filter rejects broad old-grey pigment islands.
    drainage=blur(g,(22,30))-blur(g,(22,3))
    interrupted=smooth(-.65,.45,organic_field((160,85)))
    damp=smooth(2.5,12,drainage)*interrupted*.94
    tracks={'method':'source-aligned elongated local troughs; irregular periodic wetting envelope',
            'filter_sigma_mm_yx':[21.5,2.34],'typical_track_width_cm':[1.5,4],
            'wetting_field_sigma_cm_yx':[15.6,6.6]}
    base=mix(base,col('film'),film)
    base=mix(base,col('damp')+detail[...,None]*.5,damp)
    # Pale, low-chroma source colonies; high-frequency skin highlights excluded.
    desaturated=1-smooth(10,15,blur(src[...,0]-src[...,2],2))
    lichen=desaturated*smooth(3,11,blur(g,1.8)-blur(g,17))
    base=mix(base,col('lichen'),lichen*.45)
    # Soft shoulder preserves texture in the palest crowns. Solve the offset
    # from the unclipped pigment each time; repeated clipping erases detail.
    raw=base.copy()
    ceiling=np.array(C['base_ceiling'])
    offset=np.zeros(3)
    for _ in range(12):
        base=ceiling-8*np.logaddexp(0,(ceiling-raw-offset)/8)
        base=np.maximum(base,[82,87,73])
        offset+=np.array(C['base_mean_target'])-base.mean((0,1),dtype=np.float64)
    rough=np.clip(.884+.018*organic_field((65,55))+.013*np.tanh(fine/9)+.018*lichen-.065*film-.07*damp,.8,.92)
    # Geometric concavity drives occlusion, never pigment darkness.
    cavity=smooth(.00012,.0010,blur(h,10)-h)
    masks={'fold_crowns':(folds+1)/2,'film_mask':film,'damp_mask':damp,'lichen_mask':lichen,'crease_mask':cavity}
    for key,value in masks.items():
        save(ROOT/'source'/f'{key}.png',value*255,description='Rebuilt aligned construction field; not a runtime map')
    return base,h,rough,cavity,tracks


def occlusion(h,cavity):
    visibility=np.zeros_like(h)
    for phi in np.linspace(0,2*np.pi,16,endpoint=False):
        maximum=np.zeros_like(h)
        for radius in (2,4,8,16,32,64,96):
            sx=int(round(np.cos(phi)*radius));sy=int(round(np.sin(phi)*radius))
            metres=np.hypot(sx*C['width_m']/N,sy*C['height_m']/N)
            maximum=np.maximum(maximum,(np.roll(h,(-sy,-sx),(0,1))-h)/metres)
        visibility+=1/(1+maximum*maximum)
    visibility/=16
    return np.clip(visibility*(1-.35*cavity),.6,1)


def main():
    (ROOT/'checks').mkdir(exist_ok=True)
    print('Composing four unique native source paintings...',flush=True)
    src=master()
    if '--master-only' in sys.argv: return
    print('Separating pigment, folds, creases, film and damp tracks...',flush=True)
    b,h,r,cavity,tracks=derive(src)
    h16=np.rint(h/.018*65535).astype(np.uint16)
    hq=h16.astype(np.float64)/65535*.018
    sx=(np.roll(hq,-1,1)-np.roll(hq,1,1))/(2*C['width_m']/N)
    sy=(np.roll(hq,-1,0)-np.roll(hq,1,0))/(2*C['height_m']/N)
    n=np.stack([-sx,sy,np.ones_like(hq)],-1)
    n/=np.linalg.norm(n,axis=-1,keepdims=True)
    print('Integrating height horizons and cavity occlusion...',flush=True)
    ao=occlusion(hq.astype(np.float32),cavity)
    orm=np.stack([ao,r,np.zeros_like(r)],-1)*255
    for key,value,is_srgb,desc in [
        ('base',b,True,'Unlit calibrated living fig pigment; weathering, film, damp tracks and fine skin anatomy'),
        ('height',h16,False,'White high; unsigned 16-bit 0..65535 encodes 0..18 mm'),
        ('normal',(n*.5+.5)*255,False,'OpenGL; physical gradient of quantized delivered height; wrapped XY'),
        ('orm',orm,False,'Linear R=occlusion, G=roughness, B=metalness zero')]:
        save(ROOT/f'fig_bark_{key}.png',value,is_srgb,desc)
    result={'coverage_m':[C['width_m'],C['height_m']],'height_full_and_used_range_mm':[0,18],
            'base_mean_before_quantization':b.mean((0,1),dtype=np.float64).tolist(),
            'source_native_sizes':[[1254,1254]]*4,'periodic_master_size':[N,N],
            'no_internal_reused_crops':True,'damp_tracks':tracks,
            'normal_formula':'normalize(-dh/dx,+dh/dimage_down,1); wrapped central differences of delivered uint16 samples',
            'AO':'16 azimuths x 7 radii (2,4,8,16,32,64,96 px), cosine-weighted horizon visibility plus local geometric concavity; clamp 0.6..1',
            'source_microshading':'suppressed to 30% in finest residual; broad source pigment retained; no lighting or AO multiplied into base'}
    (ROOT/'checks/construction.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:result[k] for k in ('height_full_and_used_range_mm','base_mean_before_quantization')},indent=2),flush=True)


if __name__=='__main__':main()
