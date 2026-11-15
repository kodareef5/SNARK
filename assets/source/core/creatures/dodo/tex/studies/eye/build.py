"""Build aligned dodo eye/lid materials. Python + Pillow + NumPy + SciPy.

All writes stay beside this file. Originals are never modified. Parameters in
config.json control real-world scale, relief, source direction and iris size.
The eye has a flat tangent-space cornea: its spherical form belongs to geometry.
"""
from pathlib import Path
import hashlib
import json
import time

import numpy as np
from PIL import Image, PngImagePlugin
from scipy.ndimage import gaussian_filter, map_coordinates

ROOT = Path(__file__).resolve().parent


def linear(v):
    v = np.asarray(v)
    return np.where(v <= .04045, v/12.92, ((v+.055)/1.055)**2.4)


def srgb(v):
    v = np.maximum(v, 0)
    return np.where(v <= .0031308, v*12.92, 1.055*v**(1/2.4)-.055)


def smooth(a, b, v):
    t = np.clip((v-a)/(b-a), 0, 1)
    return t*t*(3-2*t)


def write_png(name, v, colour=False, height=False):
    m = PngImagePlugin.PngInfo()
    if colour:
        m.add(b'sRGB', b'\x00')
        m.add(b'gAMA', (45455).to_bytes(4, 'big'))
    else:
        m.add(b'gAMA', (100000).to_bytes(4, 'big'))
    m.add_text('Description', 'Dodo eye study; ' + ('sRGB albedo' if colour else 'linear material data'))
    a = np.rint(np.clip(v, 0, 1)*(65535 if height else 255)).astype(np.uint16 if height else np.uint8)
    Image.fromarray(a).save(ROOT/name, pnginfo=m)
    return a


def normal_from_height(h, span_m, height_mm, tile_x):
    n = h.shape[0]
    gy, gx = np.gradient(h)
    if tile_x:
        gx = (np.roll(h, -1, 1)-np.roll(h, 1, 1))*.5
    scale = height_mm*n/(1000*span_m)
    v = np.stack((-gx*scale, gy*scale, np.ones_like(h)), -1)
    return v/np.linalg.norm(v, axis=-1, keepdims=True)


def ao_from_height(h, span_m, height_mm, tile_x):
    """Eight azimuths, physical horizon slopes; no privileged light direction."""
    n = h.shape[0]
    y, x = np.mgrid[:n, :n]
    occ = np.zeros_like(h)
    scale = height_mm*n/(1000*span_m)
    for dx, dy in [(1,0),(-1,0),(0,1),(0,-1),(1,1),(-1,1),(1,-1),(-1,-1)]:
        horizon = np.zeros_like(h)
        for r in [1, 2, 4, 8, 16, 32]:
            ix = (x+dx*r) % n if tile_x else np.clip(x+dx*r, 0, n-1)
            iy = np.clip(y+dy*r, 0, n-1)
            slope = np.maximum(h[iy, ix]-h, 0)*scale/(r*np.hypot(dx,dy))
            horizon = np.maximum(horizon, slope)
        occ += horizon/np.sqrt(1+horizon*horizon)/8
    return np.clip(1-.75*occ, .68, 1)


def export(name, base, h, rough, cfg, region):
    write_png(name+'_base.png', base, colour=True)
    h16 = write_png(name+'_height.png', h, height=True)
    # Reload precisely the delivered quantized height before differentiation.
    saved = h16.astype(np.float64)/65535
    norm = normal_from_height(saved, cfg['span_m'], cfg['height_mm'], cfg['tiles']['x'])
    write_png(name+'_normal.png', norm*.5+.5)
    ao = ao_from_height(saved, cfg['span_m'], cfg['height_mm'], cfg['tiles']['x'])
    if cfg.get('flat_border_px'):
        edge=max(2,round(cfg['flat_border_px']*h.shape[0]/1024))
        ao[:edge]=ao[-edge:]=1
        ao[:,:edge]=ao[:,-edge:]=1
    write_png(name+'_packed.png', np.stack((ao, rough, np.zeros_like(h)), -1))
    region_map = np.zeros_like(base)
    if region == 1:
        region_map[...,1] = 1
    write_png(name+'_regions.png', region_map)
    return saved


def eye(cfg, n):
    src = np.asarray(Image.open(ROOT/'source'/cfg['source_file']).convert('RGB'), dtype=float)/255
    # Exact source-space landmarks are recorded rather than guessed on rebuild.
    cy, cx = cfg['source_center_yx']
    pr, ir = cfg['source_pupil_radius_px'], cfg['source_iris_radius_px']
    y, x = np.mgrid[:n, :n]
    dx, dy = x+.5-n/2, y+.5-n/2
    radius = cfg['iris_diameter_m']/cfg['span_m']*n/2
    r = np.hypot(dx,dy)/radius
    theta = np.arctan2(dy,dx)+np.deg2rad(cfg['source_rotation_degrees'])
    p = cfg['pupil_diameter_fraction']
    # Retain crypts and fibre bundles. Remove only the first three broad
    # angular modes (capture imbalance), not the anatomical low-frequency
    # pigment with the aggressive local subtraction used in round 1.
    nr, nt = 768, 2048
    rr = np.linspace(pr+3, ir-3, nr)[:,None]
    tt = np.arange(nt)[None,:]*2*np.pi/nt
    lum = np.sum(linear(src)*np.array([.2126,.7152,.0722]),axis=-1)
    polar = map_coordinates(lum, [cy+rr*np.sin(tt), cx+rr*np.cos(tt)], order=1, mode='nearest')
    radial_mean = np.maximum(polar.mean(1,keepdims=True),.015)
    detail = polar/radial_mean-1
    spectrum = np.fft.rfft(detail,axis=1)
    spectrum[:,:4] = 0
    detail = np.fft.irfft(spectrum,n=nt,axis=1)
    detail = np.clip(detail,-.7,.65)
    rs = np.clip((r-p)/(1-p), 0, 1)*(nr-1)
    ts = np.mod(theta,2*np.pi)/(2*np.pi)*nt
    tex = map_coordinates(np.pad(detail, ((0,0),(1,1)), mode='wrap'), [rs,ts+1], order=1, mode='nearest')
    # Contraction furrows are radial pigment features, not sphere shading.
    profile = gaussian_filter(radial_mean[:,0],3)/np.maximum(gaussian_filter(radial_mean[:,0],35),.015)-1
    furrows = np.interp(rs,np.arange(nr),profile)*.45
    straw = linear(np.asarray(cfg['straw_srgb'])/255)
    rim_colour = linear(np.asarray(cfg['rim_srgb'])/255)
    collar = np.exp(-((r-(p+.045))/.04)**2)
    collar_colour = linear(np.array([175,146,72])/255)
    ground = straw[None,None,:]*(1-collar[...,None]*.32)+collar_colour*collar[...,None]*.32
    rgb = ground*(1+tex[...,None]*cfg['pigment_detail_strength']+furrows[...,None])
    rng = np.random.default_rng(cfg['fleck_seed'])
    flecks = np.zeros((n,n))
    count = int(cfg['flecks_per_mm2']*(cfg['span_m']*1000)**2)
    ix, iy = rng.integers(0,n,(2,count))
    np.add.at(flecks,(iy,ix),rng.uniform(-1,.65,count))
    sigma = cfg['fleck_radius_mm']/(cfg['span_m']*1000)*n
    flecks = gaussian_filter(flecks,sigma,mode='nearest')*(2*np.pi*sigma*sigma)*.032
    flecks *= smooth(p+.015,p+.05,r)*(1-smooth(.9,.95,r))
    rgb += flecks[...,None]
    # The dark limbal pigment lies inside the anatomical 22 mm edge; muted
    # olive extra-iris tissue fills the surrounding 2 mm margin, without white.
    rim = smooth(.94,.982,r)
    rgb = rgb*(1-rim[...,None])+rim_colour*rim[...,None]
    margin = smooth(1-.65/radius,1+.65/radius,r)
    margin_colour = linear(np.array([128,124,79])/255)
    rgb = rgb*(1-margin[...,None])+margin_colour*margin[...,None]
    pupil = 1-smooth(p-.55/radius,p+.55/radius,r)
    rgb = rgb*(1-pupil[...,None])+linear(np.array([2,2,1])/255)*pupil[...,None]
    base = srgb(np.clip(rgb,0,1))
    h = np.full((n,n), .5)
    rough = np.full((n,n), cfg['cornea_roughness'])
    export('eye',base,h,rough,cfg,None)
    np.savez_compressed(ROOT/'source/eye_fields.npz', iris_radius=r.astype('float32'),
                        iris_pigment=tex.astype('float32'), flecks=flecks.astype('float32'), pupil=pupil.astype('float32'))


def periodic_source(src, n, overlap):
    """Overlap-add one period: joins are inside a smooth 3 mm transition.

    Pixel centers and grid-wrap preserve first derivatives at the repeat. The
    unmodified source is retained; this derived field is an aligned reusable tile.
    """
    w = src.shape[1]
    period = w-overlap
    strip = src[:,:period].copy()
    blend = smooth(0,overlap-1,np.arange(overlap))[None,:]
    strip[:,:overlap] = src[:,period:period+overlap]*(1-blend)+src[:,:overlap]*blend
    y,x = np.mgrid[:n,:n].astype(float)
    return map_coordinates(strip, [(y+.5)*src.shape[0]/n-.5, (x+.5)*period/n-.5], order=3, mode='grid-wrap')


def lid(cfg,n):
    """One anatomical panel, using generated folds and cells at physical scale."""
    source=Image.open(ROOT/'source'/cfg['source_file']).convert('L')
    g=np.asarray(source.resize((n,n),Image.Resampling.LANCZOS),dtype=float)/255
    y,x=np.mgrid[:n,:n].astype(float)
    u=(x+.5)/n
    v=(y+.5)/n
    # Separate anatomy from cells, without replacing it by repeated profiles.
    # Broad source illumination is discarded; local creases and asymmetric
    # raised tissue remain together in this mid-frequency relief field.
    macro=gaussian_filter(g,7*n/1024)-gaussian_filter(g,100*n/1024)
    macro/=np.percentile(macro,99)-np.percentile(macro,1)
    cell_source=g-gaussian_filter(g,6*n/1024)
    # Enlarge only the cells, preserving the source's entire fold composition.
    scale=cfg['cell_scale']
    cells=map_coordinates(cell_source,[(y-n/2)/scale+n/2,(x-n/2)/scale+n/2],order=3,mode='reflect')
    cells=gaussian_filter(cells,1.2*n/1024)
    cells/=np.percentile(cells,95)-np.percentile(cells,5)
    # A 12-pixel truly flat guard band has identical values at opposite edges.
    border=(cfg['flat_border_px']+2)/1024
    guard=smooth(border,.055,u)*(1-smooth(.945,1-border,u))*smooth(border,.05,v)*(1-smooth(.975,1-border,v))
    skin_fade=1-smooth(.89,.945,v)
    macro*=guard*skin_fade
    cells*=guard*skin_fade
    rim_width=cfg['rim_width_m']/cfg['span_m']
    rim=np.exp(-.5*((v-cfg['rim_center_v'])/(rim_width*.45))**2)*guard
    folds=macro*cfg['fold_relief_mm']
    rounding_px=cfg['cell_rounding_mm']/(cfg['span_m']*1000)*n
    pebbles=gaussian_filter(cells*cfg['cell_relief_mm'],rounding_px)*guard
    relief_mm=folds+pebbles+cfg['rim_lift_mm']*rim
    h=.50+relief_mm/cfg['height_mm']
    # Intrinsic cell tops and crease floors are drawn in neutral value. All
    # inputs are anatomical scalar fields, with no normal, light or AO input.
    fold_pigment=.15*np.maximum(macro,0)**3/.3**2+.15*np.minimum(macro,0)**3/.7**2
    pigment=.075*np.tanh(2*cells)+fold_pigment+.005*rim
    pigment-=pigment.mean()
    base=np.repeat(srgb(.5+pigment)[...,None],3,axis=2)
    rough=cfg['skin_roughness']+.016*np.tanh(-cells)-.025*np.maximum(macro,0)
    rough=rough*(1-rim)+cfg['rim_roughness']*rim
    rough=rough*guard+cfg['skin_roughness']*(1-guard)
    def orient(a):
        return a[:,::-1] if cfg['reverse_along_lid'] else a
    base,h,rough=[orient(a) for a in (base,h,rough)]
    saved=export('lid',base,h,rough,cfg,1)
    np.savez_compressed(ROOT/'source/lid_fields.npz',
        pebbles_mm=orient(pebbles).astype('float32'),
        wrinkles_mm=orient(folds).astype('float32'),
        pigment=orient(pigment).astype('float32'),
        cell_pigment=orient(np.tanh(2*cells)).astype('float32'),
        rim=orient(rim).astype('float32'),
        border_guard=orient(guard).astype('float32'),
        source_cells=cell_source.astype('float32'),
        height_mm=(saved*cfg['height_mm']).astype('float32'))


def build():
    start=time.time()
    cfg=json.loads((ROOT/'config.json').read_text())
    accepted=json.loads((ROOT/'source/accepted_eye_sha256.json').read_text())
    eye(cfg['eye'],cfg['size_px'])
    assert all(hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==digest for name,digest in accepted.items()), 'Accepted eye changed'
    lid(cfg['lid'],cfg['size_px'])
    study = {'name':'Straw eye and upper lid', 'revision':3, 'size_px':cfg['size_px'],
             'normal_convention':'OpenGL +Y; image y runs down',
             'packed_channels':{'R':'height-derived ambient occlusion','G':'perceptual roughness','B':'metalness, zero'},
             'colour_space':{'base':'sRGB','height':'linear 16-bit','normal':'linear 8-bit','packed':'linear 8-bit','regions':'linear categorical RGB8'},
             'sets':{}}
    for name,region in [('eye',None),('lid',1)]:
        c=cfg[name]
        h=np.asarray(Image.open(ROOT/(name+'_height.png')),dtype=float)/65535
        b=np.asarray(Image.open(ROOT/(name+'_base.png')),dtype=float)/255
        study['sets'][name] = {'span_m':c['span_m'],'tiles':c['tiles'],'cutout':False,
          'height_mm':c['height_mm'],'height_used_mm':float(np.ptp(h)*c['height_mm']),
          'regions':[region] if region is not None else [],'region_map_rgb':[0,255,0] if region==1 else [0,0,0],
          'mean_linear_rgb':linear(b).mean((0,1)).tolist(),'mean_srgb_rgb':(b*255).mean((0,1)).tolist(),
          'files':{k:f'{name}_{k}.png' for k in ['base','height','normal','packed','regions']}}
    study['sets']['eye'].update({'iris_diameter_m':cfg['eye']['iris_diameter_m'],
       'pupil_diameter_m':cfg['eye']['iris_diameter_m']*cfg['eye']['pupil_diameter_fraction'],
       'center_px':[cfg['size_px']/2]*2,'projection':'front planar onto modeller eyeball sphere',
       'note':'Flat height and normal describe smooth cornea; iris fibres belong only to pigment. Sphere curvature and highlights come from geometry and lighting. Clamp both axes.'})
    study['sets']['lid'].update({'direction':{'u':'front corner to back corner','v':'brow to rim'},
       'rim_width_m':cfg['lid']['rim_width_m'],'principal_fold_count':3,
       'source_fold_paths_uv':cfg['lid']['source_fold_paths'],
       'cell_diameter_target_mm':[.5,1.0],
       'cell_relief_mm':cfg['lid']['cell_relief_mm'],
       'flat_border_px':cfg['lid']['flat_border_px'],
       'anatomical_pigment':True,'note':'Single anatomical panel; clamp U and V, do not repeat. Unequal generated folds taper and merge at distinct locations. Pebbled throughout, smoothing into the retained 1 mm rim. Opposite boundaries have matching flat guard bands for wrapped normal measurement. Dyed region 1 throughout.'})
    study['sources']={p.name:{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'size_px':list(Image.open(p).size)} for p in (ROOT/'source').glob('*_original.png')}
    (ROOT/'study.json').write_text(json.dumps(study,indent=2)+'\n')
    print(json.dumps({'build_seconds':round(time.time()-start,2),'sets':list(study['sets'])}))


if __name__=='__main__':
    build()
