#!/usr/bin/env python3
"""Rebuild this folder only. Python 3 + numpy, scipy, Pillow; no network.

Native generated paintings -> overlapping min-cut quilt -> 2304 master ->
periodic 2048 reconstruction -> semantic pigment/relief -> quantized height ->
physical OpenGL normals and horizon AO. All random fields have fixed seeds.
"""
from pathlib import Path
import hashlib
import json
import numpy as np
from PIL import Image, ImageCms, PngImagePlugin
from scipy.ndimage import gaussian_filter, map_coordinates, distance_transform_edt, label, binary_closing

ROOT = Path(__file__).resolve().parent
C = json.loads((ROOT / 'material.json').read_text())
N = 2048
RNG = np.random.default_rng(C['seed'])
MODE = ('wrap' if C['wrap_y'] else 'reflect', 'wrap')
SRGB = (ROOT / 'source/srgb.icc').read_bytes()


def smooth(a, b, x):
    t = np.clip((x-a)/(b-a), 0, 1)
    return t*t*(3-2*t)


def resample(a, shape, periodic=True):
    yy, xx = np.meshgrid((np.arange(shape[0])+.5)*a.shape[0]/shape[0]-.5,
                         (np.arange(shape[1])+.5)*a.shape[1]/shape[1]-.5, indexing='ij')
    if a.ndim == 3:
        return np.stack([resample(a[..., c], shape, periodic) for c in range(3)], -1)
    return map_coordinates(a, [yy, xx], order=3, mode='grid-wrap' if periodic else 'reflect')


def blur(a, sy, sx=None, periodic=None):
    sx = sy if sx is None else sx
    mode = MODE if periodic is None else ('wrap' if periodic else 'reflect')
    # Large fields are calculated on a reduced grid, not a huge Gaussian kernel.
    scale = max(1, int(min(sy, sx)/6))
    if scale > 1:
        sh = (max(16, a.shape[0]//scale), max(16, a.shape[1]//scale))
        small = np.asarray(Image.fromarray(a.astype('float32')).resize(sh[::-1], Image.Resampling.BOX))
        v = gaussian_filter(small, (sy*sh[0]/a.shape[0], sx*sh[1]/a.shape[1]), mode=mode)
        # For nonperiodic Y, padding prevents vertical wrap in reconstruction.
        if C['wrap_y'] or periodic is True:
            return resample(v, a.shape)
        pad = np.pad(v, ((4, 4), (0, 0)), mode='reflect')
        yy, xx = np.meshgrid((np.arange(a.shape[0])+.5)*sh[0]/a.shape[0]-.5+4,
                             (np.arange(a.shape[1])+.5)*sh[1]/a.shape[1]-.5, indexing='ij')
        return map_coordinates(pad, [yy,xx], order=3, mode='grid-wrap')
    return gaussian_filter(a, (sy,sx), mode=mode)


def field(sy, sx=None):
    f = blur(RNG.standard_normal((N,N)).astype('float32'), sy, sx)
    return np.tanh((f-f.mean()) / max(f.std(), 1e-6) / 1.8).astype('float32')


def colour(h):
    return np.array([int(h[i:i+2],16) for i in (1,3,5)], dtype='float32')


def mix(a, c, mask):
    return a*(1-mask[...,None])+colour(c)*mask[...,None]


def save_image(path, a, albedo=False, description=''):
    info = PngImagePlugin.PngInfo()
    info.add_text('Description', description)
    info.add_text('Material', C['name'])
    info.add_text('Physical coverage', f"{C['width_m']} m x {C['height_m']} m")
    info.add_text('Wrap', 'XY' if C['wrap_y'] else 'X only; clamp Y')
    info.add_text('Color space', 'sRGB' if albedo else 'linear data; disable sRGB decoding')
    if 'height' in str(path):
        info.add_text('Height range', f"0..65535 = 0..{C['height_range_mm']} mm; white high")
    if 'normal' in str(path):
        info.add_text('Normal convention', 'OpenGL: +X right, +Y image-up, +Z outward')
    if 'orm' in str(path):
        info.add_text('Channels', 'R=AO, G=roughness, B=metalness (zero)')
    if a.dtype != np.uint16:
        a = np.clip(np.rint(a),0,255).astype('uint8')
    Image.fromarray(a).save(path, pnginfo=info, **({'icc_profile': SRGB} if albedo else {}))


def seam_weight(old, new, feather=7):
    """Dynamic-programming vertical minimum-error cut through an overlap."""
    error = ((old-new)**2).mean(-1)
    error = gaussian_filter(error, 1.2)
    error[:,:12] += 1e5
    error[:,-12:] += 1e5
    h,w = error.shape
    back = np.empty((h,w),dtype='int16')
    v = error[0].copy()
    for y in range(1,h):
        choices = np.stack((np.r_[1e20,v[:-1]],v,np.r_[v[1:],1e20]))
        step = choices.argmin(0)-1
        back[y] = np.arange(w)+step
        v = error[y]+choices.min(0)
    path = np.empty(h,dtype='int16')
    path[-1] = v.argmin()
    for y in range(h-2,-1,-1):
        path[y] = back[y+1,path[y+1]]
    return smooth(-feather/2,feather/2,np.arange(w)[None,:]-path[:,None])


def close_period(a, overlap):
    length = a.shape[1]-overlap
    w = seam_weight(a[:,length:],a[:,:overlap])
    out = a[:,:length].copy()
    out[:,:overlap] = a[:,length:]*(1-w[...,None])+a[:,:overlap]*w[...,None]
    return out


def quilt():
    sources=[]
    record=[]
    for suffix in ['a','b']:
        p = ROOT/'source'/f"{C['source_prefix']}_{suffix}.png"
        a = np.asarray(Image.open(p).convert('RGB'),dtype='float32')
        # Remove broad exposure/colour drift before finding cuts. No input resized up.
        g = a.mean(-1)
        wide = gaussian_filter(g[::4,::4],24,mode='reflect')
        wide = resample(wide, g.shape, False)
        a -= (wide-np.median(wide))[...,None]*.8
        a += (140 if C['name']=='fig_bark' else 68 if C['name']=='oak_bark' else 124)-a.mean()
        sources.append(a)
        record.append({'file':p.name,'native_size':list(Image.open(p).size),
                       'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
    block, step, overlap = 1024, 768, 256
    canvas=np.zeros((2560,2560,3),dtype='float32')
    placements=[]
    for iy in range(3):
        for ix in range(3):
            candidates=[]
            for k in range(10):
                si=int(RNG.integers(2))
                src=sources[si]
                y=int(RNG.integers(src.shape[0]-block+1));x=int(RNG.integers(src.shape[1]-block+1))
                patch=src[y:y+block,x:x+block].copy()
                fx=bool(RNG.integers(2));fy=bool(RNG.integers(2))
                if fx:patch=patch[:,::-1]
                if fy:patch=patch[::-1]
                old=canvas[iy*step:iy*step+block,ix*step:ix*step+block]
                score=0
                if ix:score+=np.mean((old[:,:overlap:4]-patch[:,:overlap:4])**2)
                if iy:score+=np.mean((old[:overlap:4]-patch[:overlap:4])**2)
                candidates.append((score,patch,{'source':si,'crop_xy':[x,y],'flip_x':fx,'flip_y':fy}))
            _,patch,rec=min(candidates,key=lambda z:z[0])
            old=canvas[iy*step:iy*step+block,ix*step:ix*step+block]
            weight=np.ones((block,block),dtype='float32')
            if ix:weight[:,:overlap]=seam_weight(old[:,:overlap],patch[:,:overlap])
            if iy:weight[:overlap]=np.minimum(weight[:overlap],seam_weight(old[:overlap].transpose(1,0,2),patch[:overlap].transpose(1,0,2)).T)
            old[:]=old*(1-weight[...,None])+patch*weight[...,None]
            rec['grid_xy']=[ix,iy];placements.append(rec)
    master=close_period(canvas,overlap)
    # Dry substrate is periodic in both directions even for roots; height-based
    # wet treatment subsequently breaks Y periodicity deliberately.
    master=close_period(master.transpose(1,0,2),overlap).transpose(1,0,2)
    save_image(ROOT/'source/composed_master_2304.png',master,True,'Minimum-error quilt of native generated paintings; geometry source, not final albedo')
    (ROOT/'source/composition.json').write_text(json.dumps({'sources':record,'placements':placements,'master_size':[2304,2304],'patch_px':block,'stride_px':step,'overlap_px':overlap},indent=2)+'\n')
    return resample(master,(N,N))


def tiny_scars():
    scar=np.zeros((N,N),dtype='float32');rim=scar.copy()
    for _ in range(4):
        x=int(RNG.integers(N)); y=int(RNG.integers(N))
        rx=RNG.uniform(7,13);ry=RNG.uniform(10,19)
        px=np.arange(-28,29);py=np.arange(-35,36)
        yy,xx=np.meshgrid(py,px,indexing='ij')
        r=np.sqrt((xx/rx)**2+(yy/ry)**2)
        sel=np.ix_((y+py)%N,(x+px)%N)
        scar[sel]+=np.exp(-r*r*2)*.6
        rim[sel]+=np.exp(-((r-1)/.15)**2)*.6
    return scar,rim


def horizon_ao(h):
    """16 azimuths, 7 radial samples; integrate cosine-weighted visibility."""
    ao=np.zeros_like(h)
    dx=C['width_m']/N;dy=C['height_m']/(N if C['wrap_y'] else N-1)
    for theta in np.arange(16)*2*np.pi/16:
        horizon=np.zeros_like(h)
        for r in [1,2,4,8,16,32,64]:
            sx=int(round(np.cos(theta)*r));sy=int(round(np.sin(theta)*r))
            if sx==sy==0:continue
            dist=np.hypot(sx*dx,sy*dy)
            neighbour=np.roll(h,(-sy,-sx),(0,1))
            if not C['wrap_y']:
                if sy>0:neighbour[-sy:]=np.roll(h[-1:],-sx,1)
                if sy<0:neighbour[:-sy]=np.roll(h[:1],-sx,1)
            horizon=np.maximum(horizon,(neighbour-h)/dist)
        ao+=1/(1+horizon*horizon)
    visibility=ao/16
    if C['name']=='oak_bark':
        # Additional local cavity attenuation models light loss inside porous
        # bark. Geometry only: no albedo darkness is used as occlusion.
        cavity=np.maximum(blur(h,20,10)-h,0)
        visibility*=np.exp(-cavity/.003)
    return np.clip(visibility,.12,1)


def derive(master):
    p=C['palette'];name=C['name']
    g=master.mean(-1)
    fine=(blur(g,.65)-blur(g,5,5))/13
    pores=field(.55,.65)
    mottles=field(24,18)*.65+field(7,8)*.35
    var=field(70,45)
    pale=smooth(.12,.68,mottles)*.19
    aged=smooth(.15,.68,-mottles)*.12
    pigment=blur(g,.65)-blur(g,48,36)
    base=np.broadcast_to(colour(p['main']),(N,N,3)).copy()
    aux={}
    if name=='oak_bark':
        # Source pigmentation is NOT copied: narrow dark regions label cavities.
        # Distance to those cavities defines rounded, irregular plate shoulders.
        sm=blur(g,3.8,2.5)
        cutoff=float(np.quantile(sm,.13))
        initial=sm<cutoff
        padded=np.pad(initial,128,mode='wrap')
        connected=binary_closing(padded,structure=np.ones((5,3)))
        ids,count=label(connected)
        sizes=np.bincount(ids.ravel())
        keep=sizes>180;keep[0]=False
        cracks=keep[ids][128:-128,128:-128]
        distance=distance_transform_edt(np.pad(~cracks,96,mode='wrap'))[96:-96,96:-96].astype('float32')
        shoulder=smooth(0,17,distance)
        coarse=np.clip((blur(g,4,2)-cutoff)/40,0,1)
        plate_shape=smooth(cutoff-6,99,blur(g,8.0,5.0))
        flake_detail=np.tanh((blur(g,1.1)-blur(g,8,5))/16)
        h=.0012+.0070*shoulder+.0084*plate_shape+.00075*flake_detail+.00030*np.tanh(fine)*shoulder
        h+=.00022*field(3,1.2)*shoulder+.00008*pores*shoulder
        h=blur(h,.85)
        # Base uses restrained pigment variation. Dark source shadow is replaced
        # by a matte crack swatch; its deep shading is supplied by horizon AO.
        # Long plate relief and fine cork grain have separate physical amplitudes.
        exposed=smooth(.10,.93,shoulder)*(.04+.43*smooth(38,108,blur(g,1.2)))
        base=mix(base,p['ridge'],np.clip(exposed,0,.65))
        base=mix(base,p['crack'],smooth(cutoff+8,cutoff-13,blur(g,1.1))*.62)
        weather=smooth(.30,.82,field(9,4))*smooth(.08,.45,shoulder)*(1-smooth(.55,.95,shoulder))*.34
        base=mix(base,p['weathered'],weather)
        lichen=smooth(-9,-2,master[...,1]-master[...,0])*smooth(70,100,g)*.65
        lichen=np.maximum(lichen,smooth(.66,.93,field(11,8)+field(1,1)*.25)*.26)
        base=mix(base,'#92947C',lichen)
        # Only subdued high-frequency pigment remains; no direct source RGB.
        base+=np.tanh(pigment/14)[...,None]*7.0*shoulder[...,None]+pores[...,None]*1.0
        rough=np.clip(.84+.025*mottles+.035*(1-shoulder)+.015*pores-.025*lichen,.76,.90)
        aux['crack_mask']=cracks.astype('uint8')*255
        aux['lichen_mask']=lichen*255
        aux['plate_shoulders']=shoulder*255
    else:
        # The low-frequency source light is discarded. New neutral pigment
        # fields use the design swatches, with fine generated pores retained.
        base=mix(base,p['pale'],pale)
        base=mix(base,p['aged'],aged)
        base+=np.tanh(pigment/14)[...,None]*(8.0 if name=='fig_bark' else 9.5)
        base+=pores[...,None]*.75
        if name=='fig_bark':
            folds=field(230,38)*.75+field(90,19)*.25
            h=.001+.00064*folds+.00012*np.tanh(fine)+.000024*pores
            film=smooth(.60,.94,field(24,18)+field(1.5,1.5)*.28)*.25
            base=mix(base,p['film'],film)
            scars,rim=tiny_scars()
            h+=.00016*rim-.00010*scars
            base=mix(base,p['aged'],scars*.28)
            base=mix(base,p['pale'],rim*.14)
            rough=np.clip(.73+.045*mottles+.025*pores-.05*film,.63,.83)
            aux['film_mask']=film*255
        else:
            local=blur(g,2,5)
            fissure=smooth(3,17,local-g)
            fissure=blur(fissure,1.6,.65)
            folds=field(150,18)
            if name=='mangrove_bark':
                h=.0023+.00072*folds-.00085*fissure+.00014*np.tanh(fine)+.000025*pores
                rough=np.clip(.79+.035*mottles+.025*pores+.02*fissure,.68,.89)
                base=mix(base,p['aged'],fissure*.16)
            else:
                h=.0015+.00043*folds-.00055*fissure+.00012*np.tanh(fine)+.000022*pores
                rough=np.clip(.77+.035*mottles+.02*pores,.65,.86)
                # Endpoint rows are exactly +2.0 / -0.2 m in WORLD height.
                z=np.linspace(2.0,-.2,N,dtype='float32')
                x=np.arange(N,dtype='float32')/N
                line_noise=gaussian_filter(RNG.standard_normal(N),27,mode='wrap')
                line_noise+=gaussian_filter(RNG.standard_normal(N),80,mode='wrap')
                waterline=.25+.065*np.tanh(line_noise/line_noise.std())
                wet=1-smooth(waterline[None,:]-.035,waterline[None,:]+.035,z[:,None]+mottles*.012)
                basal=1-smooth(-.15,.18,z[:,None])
                wet_col=np.broadcast_to(colour(p['wet']),(N,N,3)).copy()
                wet_col=mix(wet_col,p['base'],np.broadcast_to(basal,(N,N)))
                wet_col+=mottles[...,None]*3+np.tanh(fine)[...,None]*1.2
                algae=smooth(.63,.96,field(12,8)+field(1.5,1.5)*.3)*wet*smooth(-.12,.02,z[:,None])
                wet_col=mix(wet_col,p['algae'],algae*.72)
                base=base*(1-wet[...,None])+wet_col*wet[...,None]
                wet_rough=np.clip(.425+.035*mottles+.016*pores,.35,.50)
                rough=rough*(1-wet)+wet_rough*wet
                # Sparse accretion is local and irregular, not a horizontal stripe.
                mud=smooth(.64,.92,field(8,15)+field(2,2)*.20)*wet*smooth(-.18,.04,z[:,None])*(1-smooth(.15,.36,z[:,None]))
                base=mix(base,'#81755D',mud*.45)
                h+=mud*.00016
                rough=rough*(1-mud*.35)+.82*mud*.35
                shells=np.zeros((N,N),dtype='float32');centres=shells.copy()
                for _ in range(100):
                    cx=int(RNG.integers(N));cy=int(RNG.integers(int(N*.79),int(N*.94)))
                    radius=RNG.uniform(1.3,3.5)
                    oy,ox=np.mgrid[-6:7,-6:7]
                    r=np.sqrt((ox/(radius*RNG.uniform(.8,1.2)))**2+(oy/radius)**2)
                    sel=np.ix_((cy+np.arange(-6,7))%N,(cx+np.arange(-6,7))%N)
                    shells[sel]=np.maximum(shells[sel],np.exp(-((r-.65)/.30)**2))
                    centres[sel]=np.maximum(centres[sel],np.exp(-(r/.3)**2))
                shells*=wet;centres*=wet
                base=mix(base,'#B0AC91',shells*.65)
                base=mix(base,p['base'],centres*.22)
                h+=shells*.00055-centres*.00008
                rough=rough*(1-shells*.6)+.84*shells*.6
                aux.update({'wet_mask':wet*255,'algae_mask':algae*255,'barnacle_mask':shells*255})
                aux['waterline_m']=waterline
            aux['fissure_mask']=fissure*255
    full_range=C['height_range_mm']/1000
    assert h.min()>0 and h.max()<full_range, (name,float(h.min()),float(h.max()))
    return base,h,rough,aux


def main():
    print('Quilting',C['name'],flush=True)
    master=quilt()
    print('Deriving pigment and relief',flush=True)
    base,h,rough,aux=derive(master)
    scale=C['height_range_mm']/1000
    h16=np.rint(h/scale*65535).astype('uint16')
    # Derive only from precisely the values that will be delivered.
    hq=h16.astype('float32')/65535*scale
    dx=(np.roll(hq,-1,1)-np.roll(hq,1,1))/(2*C['width_m']/N)
    if C['wrap_y']:
        dy=(np.roll(hq,-1,0)-np.roll(hq,1,0))/(2*C['height_m']/N)
    else:
        dy=np.gradient(hq,C['height_m']/(N-1),axis=0,edge_order=2)
    normal=np.stack([-dx,dy,np.ones_like(dx)],-1)
    normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
    print('Integrating horizon occlusion',flush=True)
    ao=horizon_ao(hq)
    orm=np.stack([ao,rough,np.zeros_like(ao)],-1)*255
    name=C['name']
    save_image(ROOT/f'{name}_base.png',base,True,'Unlit pigment from design swatches, generated botanical features and deterministic microdetail')
    save_image(ROOT/f'{name}_height.png',h16,description='16-bit unsigned displacement; white high; physical range in metadata')
    save_image(ROOT/f'{name}_normal.png',(normal*.5+.5)*255,description='Physical central-difference gradient of delivered quantized height; OpenGL')
    save_image(ROOT/f'{name}_orm.png',orm,description='Linear ORM: geometry horizon ambient occlusion, material roughness, metalness zero')
    for key,value in aux.items():
        if value.ndim==2:save_image(ROOT/'source'/f'{key}.png',value,description='Derived semantic construction mask; not a runtime texture')
    stats={'height_range_mm':C['height_range_mm'],'actual_height_mm':[float(hq.min()*1000),float(hq.max()*1000)],
           'coverage_m':[C['width_m'],C['height_m']],'seed':C['seed'],
           'normal_formula':'normalize(-dh/dx, +dh/d(image_down), 1); central differences on quantized height',
           'ambient_occlusion':'16 azimuths, sample radii 1 2 4 8 16 32 64 px; cosine-weighted horizon visibility; oak adds geometric cavity attenuation'}
    if 'waterline_m' in aux:
        stats['waterline_above_mud_m']=[float(aux['waterline_m'].min()),float(aux['waterline_m'].max())]
    (ROOT/'checks/construction.json').write_text(json.dumps(stats,indent=2)+'\n')
    print('Built',name,stats,flush=True)


if __name__=='__main__':
    main()
