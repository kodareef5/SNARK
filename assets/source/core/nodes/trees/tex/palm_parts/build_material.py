"""Build the palm-parts atlas from frozen generated plates, without network access.

Python 3, NumPy, Pillow, SciPy. All lengths in metres. Run from any directory.
The 16-bit saved height is the sole input to the delivered OpenGL normals.
"""
from pathlib import Path
import hashlib
import json
import math
import numpy as np
from PIL import Image, PngImagePlugin
from scipy.ndimage import gaussian_filter, map_coordinates, median_filter

ROOT = Path(__file__).resolve().parent
SIZE = 2048
HEIGHT_RANGE_M = .016
GUARD = 4
SEED = 284710
# Freeze the ICC payload as well as the pixels (profile creation dates otherwise
# change PNG hashes between runs despite identical texture data).
SRGB = (ROOT/'source/sRGB.icc').read_bytes()
LAYOUT = json.loads((ROOT / 'guide/LAYOUT.json').read_text())

# x0, y0, x1, y1, physical U coverage, physical V coverage, wrap U.
# Nut thirds use integer boundaries 0,171,341,512 (512 is not divisible by 3).
PATCHES = {
    'crownshaft': (0, 0, 1024, 1024, 1.10, 1.90, True),
    'sheath': (1024, 0, 2048, 1024, 1.20, .75, True),
    'cut': (0, 1024, 1024, 2048, .6875, .6875, False),
    'nut_green': (1024, 1024, 1536, 1195, .65, .32, True),
    'nut_yellow': (1024, 1195, 1536, 1365, .65, .32, True),
    'nut_brown': (1024, 1365, 1536, 1536, .65, .32, True),
    'root': (1536, 1024, 2048, 1536, math.pi*.006, .18, True),
    'stalk': (1024, 1536, 2048, 2048, math.pi*.015, .45, True),
}


def smooth(a, sy, sx=None, wrap=True):
    sigma = (sy, sy if sx is None else sx) + ((0,) if a.ndim == 3 else ())
    modes = ('reflect', 'wrap' if wrap else 'reflect') + (('nearest',) if a.ndim == 3 else ())
    return gaussian_filter(a, sigma, mode=modes)


def ease(a):
    a = np.clip(a, 0, 1)
    return a*a*(3-2*a)


def luminance(a):
    return a @ np.array([.2126, .7152, .0722], dtype=np.float32)


def noise(shape, sy, sx, rng, wrap=True):
    a = smooth(rng.standard_normal(shape).astype(np.float32), sy, sx, wrap)
    return np.clip(a / max(float(a.std()), 1e-6), -3, 3)


def load(name):
    return np.asarray(Image.open(ROOT/'source'/('generated_'+name+'.png')).convert('RGB'), dtype=np.float32)


def resize(a, width, height):
    if a.ndim == 3:
        return np.stack([resize(a[..., c], width, height) for c in range(a.shape[2])], -1)
    return np.asarray(Image.fromarray(a.astype(np.float32)).resize((width, height), Image.Resampling.BICUBIC))


def quilt(a, overlap=None):
    """A minimum-error overlapping cut, followed by a periodic pixel-centre resize.

    At the wrap, the two edge texels originate from adjacent source texels.
    A small feather follows the cut rather than dissolving two whole strips.
    """
    h, w = a.shape[:2]
    overlap = overlap or max(64, int(w*.15))
    p = w-overlap
    err = smooth(((a[:, :overlap]-a[:, p:])**2).mean(2), 2, 2, False)
    margin = max(10, overlap//8)
    err[:, :margin] += 1e8
    err[:, -margin:] += 1e8
    pred = np.zeros((h, overlap), np.int16)
    acc = err[0].copy()
    for y in range(1, h):
        choices = np.stack([np.r_[1e20, acc[:-1]], acc, np.r_[acc[1:], 1e20]])
        step = choices.argmin(0)-1
        pred[y] = np.arange(overlap)+step
        acc = err[y]+choices.min(0)
    path = np.empty(h, np.int32)
    path[-1] = acc.argmin()
    for y in range(h-2, -1, -1):
        path[y] = pred[y+1, path[y+1]]
    alpha = ease((np.arange(overlap)[None]-path[:, None])/8+.5)[..., None]
    out = a[:, :p].copy()
    out[:, :overlap] = a[:, p:]*(1-alpha)+a[:, :overlap]*alpha
    return out


def periodic_resize(a, w, h):
    # Cubic reconstruction wraps only U; V is clamped, never wraps top into bottom.
    pad = np.pad(a, ((0, 0), (4, 4), (0, 0)), mode='wrap')
    yy, xx = np.meshgrid((np.arange(h)+.5)*a.shape[0]/h-.5,
                         (np.arange(w)+.5)*a.shape[1]/w-.5+4, indexing='ij')
    return np.stack([map_coordinates(pad[..., c], [yy, xx], order=3, mode='nearest') for c in range(3)], -1)


def source_patch(a, w, h):
    return periodic_resize(quilt(a), w, h).astype(np.float32)


def guard(a, wrap=True):
    """Four same-material padding texels at every island border.

    U-periodic islands retain their wrapped continuation at the sides: copying
    identical columns here would create a visible smooth stripe on fibrous parts.
    At clamped borders we extrude four rows/columns from the interior.
    """
    a = a.copy()
    if not wrap:
        a[:, :GUARD] = a[:, GUARD:GUARD+1]
        a[:, -GUARD:] = a[:, -GUARD-1:-GUARD]
    a[:GUARD] = a[GUARD:GUARD+1]
    a[-GUARD:] = a[-GUARD-1:-GUARD]
    return a


def normal_from_height(h, u, v, wrap):
    dx = (np.roll(h, -1, 1)-np.roll(h, 1, 1))/(2*u/h.shape[1])
    if not wrap:
        dx[:, 0] = (h[:, 1]-h[:, 0])/(u/h.shape[1])
        dx[:, -1] = (h[:, -1]-h[:, -2])/(u/h.shape[1])
    dy = np.gradient(h, v/h.shape[0], axis=0)
    n = np.stack([-dx, dy, np.ones_like(h)], -1)
    return n/np.linalg.norm(n, axis=-1, keepdims=True)


def ao_from_height(h, radius=5, strength=130):
    # Multi-radius height-field cavity approximation, not source-pigment darkness.
    cavity = np.maximum(smooth(h, radius)-h, 0)
    cavity += .4*np.maximum(smooth(h, radius*3)-h, 0)
    return np.clip(1-cavity*strength, .65, 1)


def crownshaft(rng):
    s = source_patch(load('crownshaft'), 1024, 1024)
    yy, xx = np.mgrid[:1024, :1024]
    y = yy/1024
    l = luminance(s)
    med = np.median(s[40:960].reshape(-1, 3), axis=0)
    # Broad pigment streaks survive; narrow bright relief lines are compressed.
    low = smooth(s, 8, 3)
    base = np.array([113, 156, 53]) + .83*(low-med)+.40*(s-low)
    detail = noise((1024, 1024), 3.5, .5, rng)
    base += detail[..., None]*.36
    broad = smooth(l, 16, 8)-smooth(l, 55, 55)
    seam = l-smooth(l, 3, 3)
    h = .008 + .00032*np.tanh(broad/10)+.00042*np.tanh(seam/4)
    h += .000010*detail
    # The generated collar is replaced with registered, physically shallow masks.
    lip_edge = 12+2*np.sin(xx[0]*2*np.pi/1024*3)+noise((1,1024), 0, 18, rng)[0]
    lip = ease((lip_edge[None]-yy)/4)
    base = base*(1-lip[...,None])+np.array([162,185,71])*lip[...,None]
    h += lip*.00042
    collar_edge = 994+1.5*np.sin(xx[0]*2*np.pi/1024*4)+noise((1,1024),0,15,rng)[0]
    tan = ease((yy-collar_edge[None])/2)
    grey = ease((yy-collar_edge[None]-9)/2)
    base = base*(1-tan[...,None])+(np.array([158,142,101])+detail[...,None]*1.0)*tan[...,None]
    base = base*(1-grey[...,None])+(np.array([184,183,171])+detail[...,None]*.75)*grey[...,None]
    h = h*(1-tan)+(.0077+detail*.000016)*tan
    h -= grey*.0002
    rough = np.clip(.292-.015*np.tanh(broad/12)+detail*.003, .25, .35)
    rough = rough*(1-tan)+(.72+detail*.006)*tan
    return base, h, rough, {'green_mask':(1-tan)}


def sheath(rng):
    s = source_patch(load('sheath'), 1024, 1024)
    l = luminance(s)
    green = ease(((s[...,1]-s[...,2])-(s[...,0]-s[...,1])*.6-33)/35)
    low = smooth(s, 6, 6)
    # This remap lifts painted occlusion while retaining the organic fibre network.
    med = np.median(s[500:].reshape(-1,3), axis=0)
    base = np.array([120,103,74]) + .70*(low-med)+.48*(s-low)
    fine = noise(l.shape, 2.2, .43, rng)
    base += fine[...,None]*.45
    medium = smooth(l, 1.1)-smooth(l, 15)
    broad = smooth(l, 12)-smooth(l, 54)
    h = .008 + .0012*np.tanh(broad/14)+.00085*np.tanh(medium/18)
    h += .00034*np.tanh((l-smooth(l,1.3))/12)+fine*.000025
    rough = np.clip(.852+fine*.007-.012*np.tanh(medium/18), .80, .90)
    rough = rough*(1-green*.55)+(.63)*green*.55
    return base, h, rough, {'live_base_mask':green}


def cut(rng):
    s = load('cut')
    sy, sx = s.shape[:2]
    yy, xx = np.mgrid[:1024, :1024]
    x, y = xx-511.5, yy-511.5
    r = np.hypot(x, y)
    theta = np.arctan2(y, x)
    # Register the irregular generated fibre field to the exact guide circle.
    # Source interior ends at about r=550; use only this interior, never its sky/shading.
    src_r = r*(550/372.4)
    qx = (sx-1)/2+src_r*np.cos(theta)
    qy = (sy-1)/2+src_r*np.sin(theta)
    a = np.stack([map_coordinates(s[...,c], [qy,qx], order=3, mode='reflect') for c in range(3)],-1)
    l = luminance(a)
    n = noise(r.shape, 9, 9, rng, False)
    nf = noise(r.shape, .5, .5, rng, False)
    # No radial oscillation: only a monotonic, irregular peripheral density change.
    rim_outer = 409.6 + 1.2*np.sin(theta*19)+.7*np.sin(theta*43)+.45*n
    rim_inner = rim_outer-37.24+1.4*n
    inside = ease((rim_inner-r)/1.7+.5)
    disc = ease((rim_outer-r)/1.3+.5)
    density = ease((r+9*n-240)/140)
    target = np.array([216,191,136])[None,None,:]*(1-density[...,None])
    target += np.array([164,135,86])[None,None,:]*density[...,None]
    # Flatten broad source light; retain pigment on individual fibre ends and chips.
    residual = a-smooth(a, 26, 26, False)
    coarse = smooth(a, 15, 15, False)-smooth(a, 68, 68, False)
    inner_base = target+.60*residual+.22*coarse+nf[...,None]*.6
    # Register and reuse the source's actual grey bark edge, which is much thinner
    # than the requested 25 mm rim. Polar resampling widens it without a flat band.
    angles = np.linspace(-np.pi,np.pi,4096,endpoint=False)
    radii = np.arange(490,615,dtype=np.float32)
    px = (sx-1)/2+np.cos(angles)[None,:]*radii[:,None]
    py = (sy-1)/2+np.sin(angles)[None,:]*radii[:,None]
    polar = np.stack([map_coordinates(s[...,c],[py,px],order=1,mode='nearest') for c in range(3)],-1)
    colored = (polar[...,0]-polar[...,2])>35
    outer = 614-np.argmax(colored[::-1],axis=0)
    outer = gaussian_filter(median_filter(outer.astype(float),size=15,mode='wrap'),2,mode='wrap')
    ri = map_coordinates(outer,[(theta+np.pi)/(2*np.pi)*4096],order=1,mode='grid-wrap')
    t = np.clip((r-rim_inner)/(rim_outer-rim_inner),0,1)
    bark_r = ri+1+12*t
    bx = (sx-1)/2+bark_r*np.cos(theta)
    by = (sy-1)/2+bark_r*np.sin(theta)
    bark_sample = np.stack([map_coordinates(s[...,c],[by,bx],order=3,mode='reflect') for c in range(3)],-1)
    bark_l = luminance(bark_sample)
    bark_detail = np.clip(bark_l-smooth(bark_l,6,6,False),-32,32)
    # Some angles in the source have almost no exposed grey bark. Add a continuous
    # field of short radial bark fibres so widening that narrow source edge does
    # not leave stretched grey/blank wedges. This is detail, not growth rings.
    polar_fibres = noise((96,2048),2.2,.7,rng)
    bf = map_coordinates(polar_fibres,[t*80+8,(theta+np.pi)/(2*np.pi)*2048],
                         order=1,mode='grid-wrap')
    bark = np.array([162,160,147])+n[...,None]*.85+nf[...,None]*1.1
    rim = np.array([157,154,141])+bark_detail[...,None]*.18+bf[...,None]*4+n[...,None]*1.5+nf[...,None]*1.2
    base = bark*(1-disc[...,None])+rim*disc[...,None]
    base = base*(1-inside[...,None])+inner_base*inside[...,None]
    # Independent frequency bands retain the splinters' actual source positions.
    broad = smooth(l, 9, 9, False)-smooth(l, 40, 40, False)
    mid = smooth(l, 1.3, 1.3, False)-smooth(l, 9, 9, False)
    fine = l-smooth(l, 1.3, 1.3, False)
    inner_h = .009+.00125*np.tanh(broad/12)+.00135*np.tanh(mid/20)+.00047*np.tanh(fine/15)
    # Subpixel fracture ends add new master-resolution detail shared by albedo/height.
    inner_h += nf*.000035
    # A low, uneven cut plane, not tall silhouette geometry or a cylinder cap.
    inner_h += .00085*(x/410)*ease((r-150)/250)
    bark_h = .007+n*.00013+nf*.000026
    rim_h = .0077+n*.00013+nf*.00005+bark_detail*.000007+bf*.00010
    h = bark_h*(1-disc)+rim_h*disc
    h = h*(1-inside)+inner_h*inside
    rough = np.clip(.855+nf*.006+.012*np.tanh(-mid/24), .80,.90)
    return base, h, rough, {'cut_interior_mask':inside, 'cut_disc_mask':disc}


def nuts_and_roots(rng):
    s = load('details')
    # Registered hard borders of this frozen generated source, in native pixels.
    crops = {
        'nut_green':s[2:202, 2:625],
        'nut_yellow':s[206:404, 2:625],
        'nut_brown':s[410:625, 2:625],
        'root':s[2:625, 629:1252],
        'stalk':s[630:1252, 2:1252],
    }
    targets = {'nut_green':[126,146,60], 'nut_yellow':[183,161,81],
               'nut_brown':[121,88,58], 'root':[124,101,72], 'stalk':[159,129,85]}
    results = {}
    for name, src in crops.items():
        x0,y0,x1,y1,*_ = PATCHES[name]
        w,ht = x1-x0,y1-y0
        a = source_patch(src,w,ht)
        l = luminance(a)
        low = smooth(a,3,3)
        target = np.array(targets[name])
        median = np.median(a.reshape(-1,3),axis=0)
        base = target+.72*(low-median)+.45*(a-low)
        fine = noise((ht,w),2.8,.48,rng)
        base += fine[...,None]*(.38 if name.startswith('nut') else .55)
        broad = smooth(l,2,.9)-smooth(l,12,12)
        micro = l-smooth(l,1.0)
        if name in ('nut_green','nut_yellow'):
            h = .008+.00027*np.tanh(broad/10)+.000040*np.tanh(micro/8)+fine*.000008
            rough = np.clip(.48+fine*.006+.025*np.tanh(-broad/15),.40,.60)
        elif name == 'nut_brown':
            h = .008+.00052*np.tanh(broad/16)+.00022*np.tanh(micro/12)+fine*.000018
            rough = np.clip(.857+fine*.008,.80,.90)
        elif name == 'root':
            y = np.linspace(0,1,ht)[:,None]
            soil = ease((y-.38)/.60)
            # A single 6 mm root's circumference, not a bundle of separate roots.
            h = .008+.000014*np.tanh(broad/12)+.000004*np.tanh(micro/8)+fine*.0000015
            grains = np.maximum(noise((ht,w),1.1,1.1,rng)-1.0,0)
            h += soil*grains*.000012
            base -= soil[...,None]*np.array([14,13,10])
            rough = np.clip(.836+.040*soil+fine*.004,.80,.90)
        else:
            h = .008+.000042*np.tanh(broad/10)+.000009*np.tanh(micro/10)+fine*.0000025
            rough = np.clip(.842+fine*.006,.80,.90)
        results[name] = (base,h,rough,{})
    return results


def save_png(name, data, color=False):
    info = PngImagePlugin.PngInfo()
    info.add_text('Material','Original palm parts; exact regions in guide/LAYOUT.json and material.json')
    info.add_text('Color space','sRGB' if color else 'linear data')
    if 'height' in name:
        info.add_text('Height scale','0..65535 = 0..16 millimetres, white high')
    if 'normal' in name:
        info.add_text('Normal convention','OpenGL: +X right, +Y image-up, +Z outward; derived from saved height')
    if 'orm' in name:
        info.add_text('Channels','R ambient occlusion; G roughness; B metalness (zero)')
    Image.fromarray(data).save(ROOT/name,pnginfo=info,**({'icc_profile':SRGB} if color else {}))


def build():
    rng = np.random.default_rng(SEED)
    parts = {'crownshaft':crownshaft(rng), 'sheath':sheath(rng), 'cut':cut(rng)}
    parts.update(nuts_and_roots(rng))
    # Run the original sequence in full before replacing these two regions.
    # This preserves the exact RNG state, pixels and metadata of every other part.
    import round2_material
    parts['crownshaft'] = round2_material.crownshaft(parts['crownshaft'])
    parts['root'] = round2_material.root()
    base = np.zeros((SIZE,SIZE,3),np.uint8)
    height = np.zeros((SIZE,SIZE),np.uint16)
    orm = np.zeros((SIZE,SIZE,3),np.uint8)
    manifest = {'size':[SIZE,SIZE], 'height_range_mm':HEIGHT_RANGE_M*1000,
                'seed':SEED, 'guard_pixels':GUARD, 'normal_convention':'OpenGL +Y image-up',
                'nut_rows_local':[0,171,341,512], 'patches':{}}
    masks = {}
    for name,(x0,y0,x1,y1,u,v,wrap) in PATCHES.items():
        b,h,rough,extra = parts[name]
        b,h,rough = [guard(a,wrap) for a in (b,h,rough)]
        if np.min(h)<0 or np.max(h)>HEIGHT_RANGE_M:
            raise ValueError('Out-of-range height: '+name)
        base[y0:y1,x0:x1] = np.uint8(np.clip(np.rint(b),0,255))
        height[y0:y1,x0:x1] = np.uint16(np.rint(h/HEIGHT_RANGE_M*65535))
        strength = 125 if name not in ('root','stalk') else (4200 if name=='root' else 1600)
        ao = guard(ao_from_height(h,strength=strength),wrap)
        orm[y0:y1,x0:x1,0] = np.uint8(np.rint(ao*255))
        orm[y0:y1,x0:x1,1] = np.uint8(np.rint(rough*255))
        manifest['patches'][name] = {'rect':[x0,y0,x1,y1], 'coverage_m':[u,v], 'wrap_u':wrap,
                                    'height_min_max_mm':[float(h.min()*1000),float(h.max()*1000)],
                                    'roughness_min_max':[float(rough.min()),float(rough.max())]}
        for key, value in extra.items():
            masks[key] = value.astype(np.float32)
    save_png('palm_parts_base.png',base,True)
    save_png('palm_parts_height.png',height)
    save_png('palm_parts_orm.png',orm)
    # Read the delivered PNG back: no hidden unquantized height is used below.
    delivered = np.asarray(Image.open(ROOT/'palm_parts_height.png'),dtype=np.float64)*HEIGHT_RANGE_M/65535
    normal = np.empty((SIZE,SIZE,3),np.uint8)
    for name,(x0,y0,x1,y1,u,v,wrap) in PATCHES.items():
        n = normal_from_height(delivered[y0:y1,x0:x1],u,v,wrap)
        normal[y0:y1,x0:x1] = np.uint8(np.clip(np.rint((n*.5+.5)*255),0,255))
    save_png('palm_parts_normal.png',normal)
    np.savez_compressed(ROOT/'derivation.npz',**masks)
    manifest['source_files'] = {str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest()
                                for p in sorted((ROOT/'source').glob('generated_*.png'))}
    manifest['source_files']['source/sRGB.icc'] = hashlib.sha256(SRGB).hexdigest()
    manifest['scale_notes'] = {
        'crownshaft':'Brief: 1.10 m around, 1.90 m long',
        'sheath':'Brief: 1.20 m around, 0.75 m long',
        'cut':'Assumed 0.55 m outer disc diameter in 0.6875 m square; 25 mm grey bark rim',
        'nuts':'Assumed 0.65 m equatorial circumference and 0.32 m pole-to-tip surface length per band',
        'root':'Representative 6 mm diameter root, 180 mm visible length (allowed diameters 2–10 mm)',
        'stalk':'Representative 15 mm diameter stalk, 450 mm visible length',
    }
    manifest['revision'] = {
        'round':2, 'changed_regions':['crownshaft','root'],
        'baseline':'source/round1',
        'crownshaft_lip_plus_shoulder_peak_mm':[1.4,1.7],
        'crownshaft_streak_relief_mm_peak_to_peak':1.32,
        'root_mid_srgb':'#78674A',
        'note':'Living crownshaft roughness 0.25–0.35; original dry tan/grey foot collar retained.',
    }
    (ROOT/'material.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('Built four aligned 2048-square PNGs. Height full range: 16 mm.')
    for name,p in manifest['patches'].items():
        print(name, 'height mm', [round(x,4) for x in p['height_min_max_mm']])


if __name__ == '__main__':
    build()
