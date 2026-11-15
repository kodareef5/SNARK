#!/usr/bin/env python3
"""Build the four aligned palm maps from frozen local paintings.

Requires Python 3, numpy, scipy, Pillow. No network or generator needed.
All lengths in this builder are millimetres unless labelled otherwise.
Run from any directory: python3 /path/to/build_material.py
"""
from pathlib import Path
import hashlib
import json
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter, gaussian_filter1d, map_coordinates, median_filter

ROOT = Path(__file__).resolve().parent
NAME = ROOT.name
ROYAL = NAME == 'royal_bark'
N = 2048
WIDTH_MM, HEIGHT_MM = (1600., 2000.) if ROYAL else (1100., 1600.)
RANGE_MM = 2.5 if ROYAL else 16.0
SEED = 31073 if ROYAL else 80917
BODY = np.array([184, 183, 171] if ROYAL else [130, 123, 105], np.float32)
RIDGE = np.array([217, 217, 205] if ROYAL else [180, 171, 149], np.float32)
RECESS = np.array([155, 155, 145] if ROYAL else [88, 85, 74], np.float32)
GAPS_MM = ([115, 162, 92, 138, 180, 106, 152, 126, 195, 84, 146, 118, 171, 98, 117] if ROYAL else
           [73, 56, 61, 90, 68, 83, 95, 58, 76, 64, 87, 69, 54, 79, 93, 71, 60, 85, 77, 66, 82, 53])
assert sum(GAPS_MM) == HEIGHT_MM


def blur(a, sigma):
    return gaussian_filter(a, sigma, mode='wrap')


def smooth(a, lo, hi):
    t = np.clip((a-lo)/(hi-lo), 0, 1)
    return t*t*(3-2*t)


def field(rng, sy, sx=None):
    """Periodic normalized Gaussian field; coarse evaluation saves large kernels."""
    sx = sy if sx is None else sx
    scale = max(1, int(min(sy, sx)//3))
    size = int(np.ceil(N/scale))
    z = gaussian_filter(rng.standard_normal((size, size), dtype=np.float32),
                        (sy*size/N, sx*size/N), mode='wrap')
    z = (z-z.mean())/(z.std()+1e-8)
    if size != N:
        coord = np.arange(N, dtype=np.float32)*size/N
        yy, xx = np.meshgrid(coord, coord, indexing='ij')
        z = map_coordinates(z, [yy, xx], order=3, mode='grid-wrap')
    return z.astype(np.float32)


def linefield(rng, sigma):
    a = gaussian_filter1d(rng.standard_normal(N).astype(np.float32), sigma,
                          mode='wrap')
    return (a-a.mean())/(a.std()+1e-8)


def save_rgb(path, rgb, srgb=False):
    im = Image.fromarray(np.clip(np.rint(rgb), 0, 255).astype(np.uint8))
    # A frozen profile avoids a new ICC creation timestamp on every rebuild.
    kwargs = {'icc_profile': (ROOT/'source'/'sRGB.icc').read_bytes()} if srgb else {}
    im.save(path, **kwargs)


def quilt(rng):
    """Nine native 1024px crops, 256px overlaps, on a 2304px torus.

    Only the completed larger master is reduced to 2048. No source is enlarged.
    Each crop has a different origin and reflection; there is no 1024px subtile.
    Raised cosine overlap weights vanish with zero slope at patch boundaries.
    """
    stem = 'royal' if ROYAL else 'coconut'
    sources = [np.asarray(Image.open(ROOT/'source'/f'{stem}_{s}.png').convert('RGB'),
                          dtype=np.float32) for s in ('a', 'b')]
    master = np.zeros((2304, 2304, 3), np.float32)
    weights = np.zeros((2304, 2304), np.float32)
    t = np.arange(1024, dtype=np.float32)
    feather = smooth(np.minimum(t+.5, 1023.5-t), 0, 256)
    weight = feather[:, None]*feather[None, :]
    provenance = []
    for row in range(3):
        for col in range(3):
            si = (row+col) % 2
            src = sources[si]
            x = int(rng.integers(0, src.shape[1]-1024+1))
            y = int(rng.integers(0, src.shape[0]-1024+1))
            crop = src[y:y+1024, x:x+1024].copy()
            flip_x, flip_y = bool(rng.integers(2)), bool(rng.integers(2))
            if flip_x: crop = crop[:, ::-1]
            if flip_y: crop = crop[::-1]
            crop -= crop.mean(axis=(0, 1), keepdims=True)
            # Remove large source illumination / density drift before quilting.
            coarse = gaussian_filter(crop, (64, 64, 0), mode='reflect')
            crop -= .85*coarse
            yy = (np.arange(1024)+row*768) % 2304
            xx = (np.arange(1024)+col*768) % 2304
            master[np.ix_(yy, xx)] += crop*weight[..., None]
            weights[np.ix_(yy, xx)] += weight
            provenance.append(dict(source=f'{stem}_{"ab"[si]}.png', crop_xy=[x, y],
                                   master_xy=[col*768, row*768], flip_x=flip_x,
                                   flip_y=flip_y))
    master /= weights[..., None]
    save_rgb(ROOT/'source'/'composed_master_2304.png', master+BODY, srgb=True)
    # A periodic cubic reconstruction also preserves boundary derivatives.
    c = (np.arange(N, dtype=np.float32)+.5)*2304/N-.5
    yy, xx = np.meshgrid(c, c, indexing='ij')
    tex = np.stack([map_coordinates(master[..., k], [yy, xx], order=3,
                                    mode='grid-wrap') for k in range(3)], axis=-1)
    return tex, provenance


def fissures(rng):
    im = Image.new('L', (N, N))
    draw = ImageDraw.Draw(im)
    count = 400 if ROYAL else 900
    for _ in range(count):
        x, y = rng.uniform(0, N, 2)
        length = rng.uniform(7, 37) if ROYAL else rng.uniform(8, 65)
        width = int(rng.choice([1, 1, 1, 2]))
        alpha = int(rng.uniform(45, 145))
        pts = [(x, y), (x+rng.uniform(-1.6, 1.6), y+length*.35),
               (x+rng.uniform(-3, 3), y+length*.7),
               (x+rng.uniform(-3, 3), y+length)]
        for dx in (-N, 0, N):
            for dy in (-N, 0, N):
                draw.line([(a+dx, b+dy) for a, b in pts], fill=alpha, width=width)
    return blur(np.asarray(im, dtype=np.float32)/255, .55)


def small_scars(rng, chip):
    scar = np.zeros((N, N), np.float32)
    yy, xx = np.ogrid[:N, :N]
    for _ in range(9 if ROYAL else 13):
        cx, cy = rng.uniform(0, N, 2)
        dx = (xx-cx+N/2) % N-N/2
        dy = (yy-cy+N/2) % N-N/2
        wx = rng.uniform(4, 11)
        wy = rng.uniform(7, 20)
        d = ((dx+.13*dy)/wx)**2+(dy/wy)**2
        scar = np.maximum(scar, np.exp(-d*1.3).astype(np.float32))
    return scar*smooth(chip, -1.6, .7)


def ridge_anatomy():
    """Extract aligned pale fibre and recessed-tissue masks from the v2 painting.

    Broad illumination is discarded. Calibrated pigment colours, rather than
    the generated RGB strip or its lighting, are applied to the two masks.
    """
    stem = 'royal' if ROYAL else 'coconut'
    src = np.asarray(Image.open(ROOT/'source'/f'{stem}_rings_v2.png'), np.float32)
    lum = src[...,0]*.2126+src[...,1]*.7152+src[...,2]*.0722
    response = lum-gaussian_filter(lum, (20, 5), mode='reflect')
    nominal = [81, 252, 389, 533, 667, 817, 980, 1150] if ROYAL else [73, 235, 351, 492, 641, 774, 925, 1084, 1203]
    detect = gaussian_filter(response, (2, 9), mode='reflect')
    cols = np.arange(src.shape[1], dtype=np.float32)
    dy = np.arange(-54,55,dtype=np.float32)[:,None]
    bank = []
    for center in nominal:
        low, high = center-45, center+45
        trace = np.argmax(detect[low:high], axis=0).astype(np.float32)+low
        trace = gaussian_filter1d(median_filter(trace, size=19), 5)
        yy = trace[None,:]+dy
        xx = np.broadcast_to(cols[None,:],yy.shape)
        r = map_coordinates(response,[yy,xx],order=1,mode='nearest')
        m = smooth(gaussian_filter(r,.5), 1.5 if ROYAL else 2, 14 if ROYAL else 26)
        gate = np.exp(-.5*(dy/(8 if ROYAL else 17))**4)
        dark = smooth(-gaussian_filter(r,.75), 1.5, 11 if ROYAL else 23)
        dark *= smooth(dy, 0, 4)*np.exp(-.5*((dy-(7 if ROYAL else 16))/(7 if ROYAL else 13))**4)
        bank.append(np.stack([m*gate, dark], -1).astype(np.float32))
    sheet = np.concatenate(bank)
    save_rgb(ROOT/'source'/'ridge_extraction.png', np.stack([sheet[...,0],sheet[...,1],np.zeros(sheet.shape[:2])],-1)*255)
    return bank


def ring_strip(rng, bank):
    """Assemble three different painted ridge segments around one circumference."""
    strip = np.zeros((109,2304,2),np.float32)
    weight = np.zeros(2304,np.float32)
    t = np.arange(1024,dtype=np.float32)
    w = smooth(np.minimum(t+.5,1023.5-t),0,256)
    for col in range(3):
        src = bank[int(rng.integers(len(bank)))]
        x = int(rng.integers(0,src.shape[1]-1024+1))
        patch = src[:,x:x+1024]
        if rng.integers(2): patch = patch[:,::-1]
        ix = (np.arange(1024)+col*768)%2304
        strip[:,ix] += patch*w[None,:,None]
        weight[ix] += w
    strip /= weight[None,:,None]
    yy,xx = np.meshgrid(np.arange(109,dtype=np.float32),
                       (np.arange(N,dtype=np.float32)+.5)*2304/N-.5,indexing='ij')
    return np.clip(np.stack([map_coordinates(strip[...,k],[yy,xx],order=3,mode='grid-wrap') for k in range(2)],-1),0,1)


def rings(rng, chips, fibres):
    yy = np.arange(N, dtype=np.float32)[:, None]
    mask = np.zeros((N, N), np.float32)
    relief = np.zeros_like(mask)
    recess = np.zeros_like(mask)
    traces = []
    bank = ridge_anatomy()
    centers = (np.cumsum([0]+GAPS_MM[:-1])+31) / HEIGHT_MM*N
    common_wave = linefield(rng,120)*(3 if ROYAL else 5)
    for i, cy in enumerate(centers):
        painted = ring_strip(rng, bank)
        wav = common_wave+linefield(rng, 95)*(2.0 if ROYAL else 3.1)
        wav += linefield(rng, 15)*(.4 if ROYAL else .8)
        widths = np.exp(.16*linefield(rng, 70))*rng.uniform(.88,1.18)
        wear = smooth(linefield(rng, 65), -1.1, .20)
        wear = (.18+.82*wear) if ROYAL else (.70+.30*wear)
        # Short feathered breaks, distributed differently on every ring.
        x = np.arange(N,dtype=np.float32)
        for _ in range(2 if ROYAL else int(i%3==1)):
            gapdist = np.abs((x-rng.uniform(0,N)+N/2)%N-N/2)
            wear *= .08+.92*smooth(gapdist, rng.uniform(10,24),rng.uniform(38,64))
        d = (yy-cy-wav[None, :]+N/2) % N-N/2
        local_width = widths[None, :]*(1+.065*np.clip(chips,-2,2))
        ratio = 1.12 if ROYAL else 1.40
        sy = 54+d*ratio/local_width
        sx = np.broadcast_to(np.arange(N,dtype=np.float32)[None,:],sy.shape)
        crown = map_coordinates(painted[...,0],[sy,sx],order=1,mode='constant',cval=0)
        under = map_coordinates(painted[...,1],[sy,sx],order=1,mode='constant',cval=0)
        ridge = crown*wear[None, :]
        mask = np.maximum(mask, ridge)
        rise = rng.uniform(.60,.84) if ROYAL else rng.uniform(8.4,11.4)
        crest_h = blur(ridge,.80 if ROYAL else 1.25)
        crest_h /= max(float(crest_h.max()),1e-6)
        support = np.exp(-.5*((d+2)/(local_width*(5 if ROYAL else 12)))**2)*wear[None,:]
        local_h = crest_h*(rise-(.08 if ROYAL else .90))+support*(.08 if ROYAL else .90)
        # The v2 brief explicitly calls for a dark line alongside each pale lip.
        # A small continuous tissue trace lets chipped gaps remain perceptible
        # after mip filtering without painting an external cast shadow.
        tissue = np.exp(-.5*((d-local_width*(7 if ROYAL else 15))/(local_width*(2.7 if ROYAL else 5.8)))**2)
        cavity = np.maximum(under,tissue*(.55 if ROYAL else .55))*wear[None,:]
        recess = np.maximum(recess, cavity)
        local_h -= cavity*(.09 if ROYAL else .65)
        if not ROYAL:
            if i in (3,8,14,19):
                t = smooth(linefield(rng,110), .1,1.3)
                ssy = 54+(d-18*t[None,:])*ratio/local_width
                split = map_coordinates(painted[...,0],[ssy,sx],order=1,mode='constant',cval=0)
                split *= t[None,:]*wear[None,:]*.70
                mask = np.maximum(mask, split)
                local_h = np.maximum(local_h,blur(split,1.25)*(rise*.75))
        relief += local_h
        traces.append(dict(center_mm=float(cy/N*HEIGHT_MM),
                           gap_to_next_mm=GAPS_MM[i],
                           source_width_multiplier=float(widths.mean()),
                           peak_rise_parameter_mm=float(rise),
                           measured_ring_relief_mm=float(local_h.max()-local_h.min()),
                           visible_fraction=float((wear>.4).mean())))
    return mask, relief, recess, traces


def normals_from_saved_height(path):
    h = np.asarray(Image.open(path), dtype=np.float32)/65535*RANGE_MM
    gx = (np.roll(h, -1, 1)-np.roll(h, 1, 1))/(2*WIDTH_MM/N)
    gy = (np.roll(h, -1, 0)-np.roll(h, 1, 0))/(2*HEIGHT_MM/N)
    n = np.stack([-gx, gy, np.ones_like(h)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n


def ambient_occlusion(h):
    """Eight azimuth height-horizon estimates, all toroidal and metric."""
    occ = np.zeros_like(h)
    for dx, dy in ((1,0), (1,1), (0,1), (-1,1), (-1,0), (-1,-1), (0,-1), (1,-1)):
        slope = np.zeros_like(h)
        for radius in (1, 2, 4, 8, 16, 32, 64):
            distance = np.hypot(dx*radius*WIDTH_MM/N, dy*radius*HEIGHT_MM/N)
            other = np.roll(h, (dy*radius, dx*radius), axis=(0,1))
            slope = np.maximum(slope, (other-h)/distance)
        occ += slope*slope/(1+slope*slope)
    return np.clip(1-occ/8, 0, 1)


def build():
    for f in ('source', 'checks'): (ROOT/f).mkdir(exist_ok=True)
    rng = np.random.default_rng(SEED)
    tex, provenance = quilt(rng)
    if not ROYAL:
        # Suppress the old paintings' larger grey colonies; leave only small
        # fragments plus the new sparse procedural colonies below.
        old_lum = tex[...,0]*.2126+tex[...,1]*.7152+tex[...,2]*.0722
        old_lichen = smooth(tex[...,2]-tex[...,0],2,8)*smooth(blur(old_lum,7),1,7)
        tex *= 1-.82*old_lichen[...,None]
    lum = tex[...,0]*.2126+tex[...,1]*.7152+tex[...,2]*.0722
    soft = blur(lum, 7)
    mid = blur(lum, 35)
    # Suppress source light/dark micro-pairs; retain pigment variation.
    pigment = .45*(lum-soft)+.68*(soft-mid)+.35*mid
    chroma = (tex-lum[..., None])*.45
    chips = field(rng, 2.4)
    fibres = field(rng, 13, .85 if ROYAL else 1.05)
    fine = field(rng, 2.5, .48 if ROYAL else .65)
    mottle = .60*field(rng, 48)+.40*field(rng, 13)
    warmth = field(rng, 66)
    cracks = fissures(rng)
    scar = small_scars(rng, chips)
    ring, ring_h, recess, traces = rings(rng, chips, fibres)
    # Small, broken colonies, not one recognizable feature per tile.
    colony = field(rng, 9)+.30*field(rng, 2.3)
    lichen = smooth(colony, 1.95 if ROYAL else 2.80, 2.85 if ROYAL else 3.60)*smooth(chips,-.65,.70)
    lower = np.exp(-.5*((np.arange(N,dtype=np.float32)/N-.77+.5)%1-.5)**2/.18**2)[:,None]
    algae = smooth(field(rng,36,14),.70,2.3)*(.11+.15*lower) if ROYAL else np.zeros_like(ring)
    body = BODY+pigment[..., None]+chroma
    body += (mottle*(2.5 if ROYAL else 1.5))[..., None]
    body += warmth[..., None]*np.array([1.35,.12,-1.45] if ROYAL else [.6,.05,-.65],np.float32)
    body += (fibres*(.50 if ROYAL else 1.4)+fine*.3)[..., None]
    # Authored local tissue contrast is required by the round-2 brief. It is
    # independent of lighting direction; height-derived AO stays in ORM only.
    darkmix = recess*(.65 if ROYAL else .90)
    body = body*(1-darkmix[...,None])+(RECESS+pigment[...,None]*.35)*darkmix[...,None]
    mix = ring*(.98 if ROYAL else .97)
    body = body*(1-mix[..., None])+(RIDGE+pigment[..., None]*.6)*mix[..., None]
    lichencol = np.array([155,161,144] if ROYAL else [160,159,141], np.float32)
    lm = lichen*(.55 if ROYAL else .50)
    body = body*(1-lm[..., None])+lichencol*lm[..., None]
    body += algae[..., None]*np.array([-26,-19,-27], np.float32)
    # Small old discoloration is pigment; checks themselves are height/AO only.
    body += scar[..., None]*np.array([-19,-19,-18], np.float32)
    save_rgb(ROOT/f'{NAME}_base.png', body, srgb=True)
    if not ROYAL:
        lichen = np.maximum(lichen,old_lichen*.18)
    source_relief = np.tanh((blur(lum, .70)-blur(lum, 12))/12)
    h = np.full((N,N), .92 if ROYAL else 2.20, np.float32)
    h += source_relief*(.18 if ROYAL else .40)
    h += fibres*(.019 if ROYAL else .045)+fine*(.008 if ROYAL else .016)
    h += blur(mottle, 5)*(.045 if ROYAL else .09)
    h += ring_h+lichen*(.055 if ROYAL else .11)
    h -= cracks*(.33 if ROYAL else .64)+scar*(.20 if ROYAL else .35)
    assert h.min()>0 and h.max()<RANGE_MM, 'Height needs more headroom; do not clip relief.'
    quantized = np.rint(h/RANGE_MM*65535).astype(np.uint16)
    heightpath = ROOT/f'{NAME}_height.png'
    Image.fromarray(quantized).save(heightpath)
    normal = normals_from_saved_height(heightpath)
    save_rgb(ROOT/f'{NAME}_normal.png', (normal*.5+.5)*255)
    ao = ambient_occlusion(quantized.astype(np.float32)/65535*RANGE_MM)
    rough = (.765 if ROYAL else .78)+.013*np.tanh(mottle)+.012*np.tanh(fibres)
    rough -= ring*(.027 if ROYAL else .045)
    rough += lichen*.095+scar*.02+algae*.05+recess*(.012 if ROYAL else .025)
    rough = np.clip(rough, .65, .89)
    save_rgb(ROOT/f'{NAME}_orm.png', np.stack([ao, rough, np.zeros_like(ao)], -1)*255)
    # Frozen semantic diagnostics keep the layer registration reviewable.
    np.savez_compressed(ROOT/'source'/'construction_masks.npz', rings=ring.astype(np.float16),
                        lichen=lichen.astype(np.float16), scars=scar.astype(np.float16),
                        fissures=cracks.astype(np.float16),recesses=recess.astype(np.float16),
                        weathering=algae.astype(np.float16))
    meta = dict(name=NAME, revision=2, size=[N,N], physical_width_mm=WIDTH_MM,
                physical_height_mm=HEIGHT_MM, full_height_range_mm=RANGE_MM,
                height_used_mm=[float(h.min()),float(h.max())], seed=SEED,
                normal_convention='OpenGL; +X image-right; +Y image-up; +Z outward',
                normal_derivative='central differences of decoded delivered 16-bit height, wrapping both axes',
                master_size=[2304,2304], source_crops=provenance, rings=traces,
                neutral_height_mm=.92 if ROYAL else 2.20,
                base_ring_colours_srgb255=dict(body=BODY.tolist(),lip=RIDGE.tolist(),recess=RECESS.tolist()),
                base_contrast='Pale exposed scar fibre plus dark recessed-tissue pigment, calibrated independently of illumination. No broad directional light or cast shadows; AO is not multiplied into base.',
                lichen_coverage_over_025=float((lichen>.25).mean()),
                repeat_note='Any single fixed UV tile repeats exactly after its specified physical height. Contrast and salience are minimized; true aperiodicity needs engine-side variation.',
                source_sha256={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((ROOT/'source').glob('*.png'))})
    (ROOT/'material.json').write_text(json.dumps(meta, indent=2)+'\n')
    print(f'{NAME}: built 2048px maps; full height scale {RANGE_MM} mm; used {h.min():.3f}..{h.max():.3f} mm')


if __name__ == '__main__':
    build()
