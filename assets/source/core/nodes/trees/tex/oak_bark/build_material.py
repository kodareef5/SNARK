#!/usr/bin/env python3
"""Live oak second set. Offline, deterministic, current-folder-only build.
Four native paintings -> periodic master -> separated pigment and relief ->
quantized 48 mm height -> physical OpenGL normal -> geometry AO and roughness.
"""
from pathlib import Path
import hashlib
import json
import sys
import numpy as np
from PIL import Image, PngImagePlugin
from scipy.ndimage import gaussian_filter, distance_transform_edt, label
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


def field(sigma):
    a = blur(RNG.standard_normal((N,N)).astype(np.float32), sigma)
    return np.tanh(a/(a.std()*1.8))


def col(key):
    h = C['palette'].get(key, key)
    return np.array([int(h[i:i+2],16) for i in (1,3,5)], np.float32)


def mix(a,b,w):
    return a*(1-w[...,None])+b*w[...,None]


def save(path,a,srgb=False,description=''):
    info = PngImagePlugin.PngInfo()
    info.add_text('Description',description)
    info.add_text('Material','Live oak bark / second set')
    info.add_text('Coverage','1.6 m across x 2.0 m along; repeat U and V; top is up')
    info.add_text('Color space','sRGB' if srgb else 'linear data')
    if 'height' in path.name: info.add_text('Height encoding','0..65535 = 0..48 mm; white high')
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
        wide = gaussian_filter(luma(a),100,mode='reflect')
        a -= .72*(wide-np.median(wide))[...,None]
        a += (np.array([111.,94.,74.])-a.mean((0,1)))
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


def distance(mask):
    return distance_transform_edt(np.pad(mask,160,mode='wrap'))[160:-160,160:-160].astype(np.float32)


def derive(src):
    g = luma(src)
    g -= .5*(blur(g,70)-np.median(g))
    g2 = blur(g,1.6)
    cracks = g2 < 70
    padded = np.pad(cracks,96,mode='wrap')
    labs,_ = label(padded)
    sizes = np.bincount(labs.ravel())
    cracks = (padded & (sizes[labs] >= 140))[96:-96,96:-96]
    dist = distance(~cracks)
    # Almost planar bevels retain fractured facets rather than inflated mounds.
    shoulder = blur(np.clip(blur(dist,.6)/16.,0,1),.65)
    face_var = smooth(65,128,blur(g,10))
    # Centimetres belong to broad facets and fissures, not individual pigment pores.
    # Unequal plate beds use some of the full range; typical adjacent cavities
    # remain about 2-3 cm deep rather than every pore becoming a 4 cm borehole.
    bed = field((95,60))
    h = .012 + .016*shoulder + .010*face_var + .010*bed
    h += (blur(g,2.2)-blur(g,10))*.000075*(.35+.65*shoulder)
    h += np.clip(g-blur(g,2.2),-22,22)*.000019
    micro = field((2.2,.65))
    h += micro*.00013
    h = blur(h,.65)
    h -= h.min()
    h *= (C['height_range_mm']/1000)/h.max()
    # Reconstruct pigment from swatches, discarding source lighting/exposure.
    # Broad face and recess pigment are distinct; use geometry to avoid treating
    # an old dark face as a hole. Source fine texture supplies small pigment detail.
    face_tone = smooth(85,143,blur(g,3))
    face_color = mix(col('face_dark'),col('face_light'),face_tone)
    cavity_color = mix(col('deepest'),col('fissure'),smooth(28,72,g2))
    face_weight = shoulder**1.6
    base = mix(cavity_color,face_color,face_weight)
    base += np.clip(g-blur(g,5),-32,32)[...,None]*.37*(.45+.55*shoulder[...,None])
    stops = np.array([28.,66.,90.,110.,135.,160.])
    swatches = np.stack([col('deepest'),col('fissure'),col('#393229'),col('#63533F'),col('face_light'),col('weathered')])
    pigment = np.stack([np.interp(g,stops,swatches[:,c]) for c in range(3)],-1)
    # Keep fractured fine flakes and local pigment variation; the broad physical
    # shoulder field must not become a thick, soft outline in the albedo.
    base = base*.30 + pigment*.70
    chip = smooth(3,14,blur(g,.8)-blur(g,4.2))
    worn = (chip*.32+smooth(114,153,blur(g,3))*.20)*smooth(.4,.95,shoulder)
    base = mix(base,col('weathered'),worn)
    chroma = src-src.mean(-1)[...,None]
    chroma -= np.array([18.,1.,-19.],np.float32)
    base += np.clip(chroma,-12,12)*.18
    base += micro[...,None]*.7
    green = src[...,1]-.5*(src[...,0]+src[...,2])
    lichen = smooth(4.8,10,green)*smooth(95,122,g)*smooth(.3,.8,shoulder)*.7
    base = mix(base,col('lichen'),lichen)
    for key,arr in {'fissure_mask':cracks.astype(np.float32),'plate_shoulders':shoulder,'lichen_mask':lichen,'weathering_mask':worn}.items():
        save(ROOT/'source'/f'{key}.png',arr*255,description='Derived semantic field; rebuilt from frozen source pictures')
    rough = np.clip(.871+.031*shoulder+.010*np.tanh((g-blur(g,3))/15)+.028*worn+.045*lichen,.85,.95)
    return base,h,rough,cracks,shoulder


def occlusion(h,shoulder):
    """Cosine-weighted horizon visibility plus narrow-crack cavity attenuation."""
    visibility = np.zeros_like(h)
    for phi in np.linspace(0,2*np.pi,16,endpoint=False):
        maximum = np.zeros_like(h)
        for radius in (2,4,8,16,32,64,96):
            sx = int(round(np.cos(phi)*radius)); sy = int(round(np.sin(phi)*radius))
            metres = np.hypot(sx*C['width_m']/N,sy*C['height_m']/N)
            slope = (np.roll(h,(-sy,-sx),(0,1))-h)/metres
            maximum = np.maximum(maximum,slope)
        visibility += 1/(1+maximum*maximum)
    visibility /= 16
    ao = (.22+.78*visibility)*(.39+.61*shoulder)
    return np.clip(ao,.20,1.)


def main():
    (ROOT/'checks').mkdir(exist_ok=True)
    print('Composing four original native sources...',flush=True)
    src = master()
    if '--master-only' in sys.argv: return
    print('Separating pigment, shoulder geometry and microrelief...',flush=True)
    base,h,rough,cracks,shoulder = derive(src)
    h16 = np.rint(h/(C['height_range_mm']/1000)*65535).astype(np.uint16)
    hq = h16.astype(np.float64)/65535*(C['height_range_mm']/1000)
    dx = (np.roll(hq,-1,1)-np.roll(hq,1,1))/(2*C['width_m']/N)
    dy = (np.roll(hq,-1,0)-np.roll(hq,1,0))/(2*C['height_m']/N)
    normal = np.stack([-dx,dy,np.ones_like(dx)],-1)
    normal /= np.linalg.norm(normal,axis=-1,keepdims=True)
    print('Integrating geometry occlusion...',flush=True)
    ao = occlusion(hq.astype(np.float32),shoulder)
    orm = np.stack([ao,rough,np.zeros_like(ao)],-1)*255
    for key,value,srgb,description in [
        ('base',base,True,'Unlit palette-calibrated bark pigment; sparse weathering and lichen'),
        ('height',h16,False,'Unsigned 16-bit height, white high; full range 48 mm'),
        ('normal',(normal*.5+.5)*255,False,'Wrapped central differences of delivered quantized height at physical 1.6 x 2.0 m scale'),
        ('orm',orm,False,'Linear R=geometry occlusion, G=roughness, B=zero metalness')]:
        save(ROOT/f'oak_bark_{key}.png',value,srgb,description)
    result = {'height_encoding_mm':C['height_range_mm'],'actual_height_mm':[float(hq.min()*1000),float(hq.max()*1000)],
              'source_count':4,'native_sources':[1254,1254],'master_resolution':[N,N],
              'fissure_area_fraction':float(cracks.mean()),'base_mean_sRGB':base.mean((0,1),dtype=np.float64).tolist(),
              'normal':'normalize(-dh/dx,+dh/dimage_down,1), from saved uint16 samples, wrapped central difference',
              'ao':'16 horizon azimuths; 2 4 8 16 32 64 96 pixel radii; cosine-weighted visibility and cavity term',
              'source_luminance_percentiles':np.percentile(luma(src),[1,10,25,50,75,90,99]).tolist()}
    (ROOT/'checks/construction.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2),flush=True)


if __name__ == '__main__': main()
