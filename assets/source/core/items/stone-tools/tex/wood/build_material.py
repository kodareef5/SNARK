#!/usr/bin/env python3
"""Rebuild the 0.40 m stripped-sapling material. Only writes beside this script.

The frozen generated image is a pigment/grain source, never a finished map.
All physical construction and filtering is periodic. No source is enlarged.
"""
from pathlib import Path
import hashlib
import json
import time

import numpy as np
from PIL import Image, ImageCms


# NumPy implementations are deliberate: this Python has no SciPy, and using the
# same filters everywhere makes the frozen build independent of SciPy versions.
def gaussian_filter(a, sigma, mode='wrap'):
    sy, sx = sigma if hasattr(sigma, '__len__') else (sigma, sigma)
    py, px = (int(np.ceil(sy*4)), int(np.ceil(sx*4))) if mode == 'reflect' else (0, 0)
    v = np.pad(a, ((py, py), (px, px)), mode='symmetric') if py or px else a
    fy = np.fft.fftfreq(v.shape[0])[:, None]
    fx = np.fft.rfftfreq(v.shape[1])[None, :]
    filt = np.exp(-2*np.pi**2*(sy**2*fy**2+sx**2*fx**2))
    out = np.fft.irfft2(np.fft.rfft2(v)*filt, s=v.shape).astype(np.float32)
    return out[py:py+a.shape[0], px:px+a.shape[1]]


def map_coordinates(a, coordinates, order=1, mode='grid-wrap'):
    y, x = coordinates
    iy, ix = np.floor(y).astype(np.int32), np.floor(x).astype(np.int32)
    wy, wx = y-iy, x-ix
    h, w = a.shape
    out = ((1-wy)*((1-wx)*a[iy % h, ix % w]+wx*a[iy % h, (ix+1) % w])+
           wy*((1-wx)*a[(iy+1) % h, ix % w]+wx*a[(iy+1) % h, (ix+1) % w]))
    return out.astype(np.float32)

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'source'
SIZE = 2048
TILE_MM = 400.0
HEIGHT_MM = 3.0
SEED = 481172


def smooth(a):
    a = np.clip(a, 0, 1)
    return a*a*(3-2*a)


def delta(a, b, period=SIZE):
    return (a-b+period/2) % period-period/2


def noise(rng, sy, sx, shape=(SIZE, SIZE)):
    a = gaussian_filter(rng.normal(size=shape).astype(np.float32), (sy, sx), mode='wrap')
    return (a-a.mean()) / max(a.std(), 1e-8)


def box(a):
    """2x area mean, float64 accumulator; applies to all delivered mip maps."""
    n = a.shape[0]//2
    if a.ndim == 3:
        return a.astype(np.float64).reshape(n, 2, n, 2, a.shape[2]).mean((1, 3))
    return a.astype(np.float64).reshape(n, 2, n, 2).mean((1, 3))


def normals_from_height(height_u16):
    n = len(height_u16)
    h = height_u16.astype(np.float64)*HEIGHT_MM/65535
    pitch = TILE_MM/n
    dx = (np.roll(h, -1, 1)-np.roll(h, 1, 1))/(2*pitch)
    dy_down = (np.roll(h, -1, 0)-np.roll(h, 1, 0))/(2*pitch)
    v = np.stack((-dx, dy_down, np.ones_like(h)), -1)
    v /= np.linalg.norm(v, axis=-1, keepdims=True)
    return np.rint((v*.5+.5)*255).astype(np.uint8)


def save_rgb(name, a, srgb=False):
    kwargs = {}
    if srgb:
        profile = SOURCE/'srgb.icc'
        if not profile.exists():
            profile.write_bytes(ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
        kwargs['icc_profile'] = profile.read_bytes()
    Image.fromarray(np.clip(np.rint(a), 0, 255).astype(np.uint8)).save(ROOT/name, **kwargs)


def make_source(rng):
    """Native 1:1 periodic quilting with partition-of-unity overlaps.

    Remove source's three dark cambium pieces and two knots before quilting;
    authored sparse features below then have explicit physical geometry.
    """
    a = np.asarray(Image.open(SOURCE/'generated_wood.png').convert('RGB')).astype(np.float32)
    h, w = a.shape[:2]
    yy, xx = np.mgrid[:h, :w].astype(np.float32)
    removal = [(56, 933, 24, 135, 117), (295, 458, 22, 160, 134),
               (1005, 281, 22, 114, -125), (409, 200, 40, 70, 115),
               (829, 785, 43, 73, -120)]
    for cx, cy, rx, ry, shift in removal:
        mask = (1-smooth((np.abs(xx-cx)/rx-.55)/.45))*(1-smooth((np.abs(yy-cy)/ry-.55)/.45))
        donor = np.roll(a, -shift, axis=1)
        a = a*(1-mask[..., None])+donor*mask[..., None]
    Image.fromarray(np.rint(a).astype(np.uint8)).save(SOURCE/'cleaned_source.png')

    # Remove illumination/large colour drift before synthesis. Keep only narrow
    # vertical reflectance structure. Positive highlight-like residue is reduced.
    lum = a@np.array([.2126, .7152, .0722], np.float32)
    residual = lum-gaussian_filter(lum, (90, 30), mode='reflect')
    residual = np.where(residual > 0, residual*.35, residual*.74)
    residual -= gaussian_filter(residual, (95, 38), mode='reflect')
    chroma = a-lum[..., None]
    for c in range(3):
        chroma[..., c] -= gaussian_filter(chroma[..., c], (70, 25), mode='reflect')
    packed = np.concatenate((residual[..., None], chroma*.15), axis=2)

    stride, overlap = 512, 96
    p = stride+overlap*2
    q = np.arange(p)
    weight = smooth(np.minimum(q+.5, p-q-.5)/(2*overlap))
    ww = weight[:, None]*weight[None, :]
    acc = np.zeros((SIZE, SIZE, 4), np.float32)
    den = np.zeros((SIZE, SIZE), np.float32)
    placements = []
    for iy in range(4):
        for ix in range(4):
            sy, sx = rng.integers(10, h-p-10), rng.integers(10, w-p-10)
            patch = packed[sy:sy+p, sx:sx+p].copy()
            flip_y, flip_x = bool(rng.integers(2)), bool(rng.integers(2))
            if flip_y:
                patch = patch[::-1]
            if flip_x:
                patch = patch[:, ::-1]
            ys = (np.arange(p)+iy*stride-overlap) % SIZE
            xs = (np.arange(p)+ix*stride-overlap) % SIZE
            acc[ys[:, None], xs[None, :]] += patch*ww[..., None]
            den[ys[:, None], xs[None, :]] += ww
            placements.append(dict(tile=[ix, iy], source_xy=[int(sx), int(sy)],
                                   crop_size=p, flip_y=flip_y, flip_x=flip_x))
    return acc/den[..., None], placements


def main():
    started = time.monotonic()
    SOURCE.mkdir(exist_ok=True)
    rng = np.random.default_rng(SEED)
    yy, xx = np.mgrid[:SIZE, :SIZE].astype(np.float32)
    ppmm = SIZE/TILE_MM
    master, placements = make_source(rng)

    # Four small twig insertions. All their grain displacement is periodic.
    knots = [(.119, .277, 2.0, 3.8, .21), (.417, .758, 2.7, 4.6, .27),
             (.681, .431, 1.7, 3.1, .18), (.899, .907, 2.2, 4.1, .23)]
    warp = np.zeros((SIZE, SIZE), np.float32)
    knot_core = np.zeros_like(warp)
    knot_ring = np.zeros_like(warp)
    knot_height = np.zeros_like(warp)
    knot_support = np.zeros_like(warp)
    for k, (fx, fy, width, length, depth) in enumerate(knots):
        dx = delta(xx, fx*SIZE)/ppmm
        dy = delta(yy, fy*SIZE)/ppmm
        # Grain fans softly around each tiny twig rather than continuing through.
        warp += ppmm*.8*dx*np.exp(-((dx/3.8)**2+(dy/8)**2))
        ax = dx+.09*np.sin(dy*3+k)
        q = np.sqrt((ax/(width/2))**2+(dy/(length/2))**2)
        core = np.exp(-(q/.64)**4)
        rings = (np.exp(-((q-1.03)/.11)**2)*.75+
                 np.exp(-((q-1.5)/.16)**2)*.25)
        knot_core = np.maximum(knot_core, core)
        knot_ring += rings
        knot_support = np.maximum(knot_support, np.exp(-(q/2)**4))
        knot_height += -depth*core + .023*np.exp(-((q-.9)/.22)**2) - .012*rings
    coords = np.array([yy, (xx+warp) % SIZE])
    for c in range(4):
        master[..., c] = map_coordinates(master[..., c], coords, order=1, mode='grid-wrap')
    grain = master[..., 0]

    # Native detail (not an enlargement): pores, torn longitudinal fibres and
    # weak narrow growth streaks, bent coherently with the twig grain.
    fine = noise(rng, 6.5, .62)
    micro = noise(rng, 1.3, .40)
    growth = noise(rng, 105, 5.0)
    drift = 2.2*noise(rng, 135, 42)
    fcoords = np.array([yy, (xx+drift+warp) % SIZE])
    fine = map_coordinates(fine, fcoords, order=1, mode='grid-wrap')
    growth = map_coordinates(growth, fcoords, order=1, mode='grid-wrap')
    pore = np.clip(-fine-1.0, 0, 2.8)
    # No structure wider than 30 mm: the largest pigment filter is 5 px across.
    pigment = grain*.83+fine*.85+micro*.28+growth*1.5-pore*1.8

    # Broadly planar shallow stone-edge passes, not cylindrical saw channels.
    # Widths are physical, 5–15 mm; softly tapered longitudinal terminations.
    scrape = np.zeros((SIZE, SIZE), np.float32)
    scrape_edges = np.zeros_like(scrape)
    scrape_polish = np.zeros_like(scrape)
    scrape_pigment = np.zeros_like(scrape)
    strokes = []
    for _ in range(115):
        cx, cy = rng.uniform(0, SIZE, 2)
        width, length = rng.uniform(5, 15), rng.uniform(45, 145)
        depth = rng.uniform(.12, .34)
        slant = rng.uniform(-.014, .014)
        phase = rng.uniform(0, 6.283)
        dx = delta(xx, cx)/ppmm
        dy = delta(yy, cy)/ppmm
        dx -= slant*dy+.20*np.sin(dy/18+phase)
        u = np.abs(dx)/(width*.5)
        v = np.abs(dy)/(length*.5)
        across = 1-smooth((u-.74)/.26)
        along = 1-smooth((v-.55)/.45)
        mask = across*along
        # Flat centre, a slight hand roll; softer at the entering/leaving ends.
        # A shallow chord-like shaving partially flattens the round branch.
        # The weak bowl in the height relative to the cylinder reduces its crown;
        # an irregular tilt records the hand's changing edge angle.
        tilt = rng.uniform(-.36, .36)
        cut = depth*mask*(1-.36*np.minimum(u, 1)**2+tilt*dx/(width*.5))
        scrape = np.maximum(scrape, cut)
        scrape_edges = np.maximum(scrape_edges, np.exp(-((u-.84)/.14)**2)*along)
        scrape_polish = np.maximum(scrape_polish, mask*rng.uniform(.45, 1))
        scrape_pigment += mask*rng.uniform(-.7, .7)
        strokes.append(dict(x_mm=float(cx/ppmm), y_mm=float(cy/ppmm), width_mm=float(width),
                            length_mm=float(length), depth_mm=float(depth), hand_tilt=float(tilt)))
    # Polishing has gentle boundaries and does not erase source grain.
    polish = np.clip(.75*scrape_polish+.10*noise(rng, 85, 9)+.05, 0, 1)
    grain_relief = (grain*.0017+fine*.007+micro*.0018-pore*.011)*(1-.32*polish)
    height = 1.85+.021*growth+grain_relief-scrape+knot_height

    check_mask = np.zeros((SIZE, SIZE), np.float32)
    check_cut = np.zeros_like(check_mask)
    checks = [(.272, .623, 33, .34, .47), (.785, .009, 42, .28, .42)]
    for i, (fx, fy, length, width, depth) in enumerate(checks):
        dy = delta(yy, fy*SIZE)/ppmm
        dx = delta(xx, fx*SIZE)/ppmm
        taper = np.clip(1-(2*dy/length)**2, 0, 1)**.7
        path = .11*np.sin(dy*1.4+i)+.045*np.sin(dy*3.8)+.009*dy
        distance = np.abs(dx-path)
        mask = np.exp(-(distance/(width*.5*taper+.025))**2)*taper
        check_mask = np.maximum(check_mask, mask)
        check_cut = np.maximum(check_cut, depth*mask)
    height -= check_cut

    bark_mask = np.zeros((SIZE, SIZE), np.float32)
    bark_cut = np.zeros_like(bark_mask)
    barks = [(.057, .708, 13, .73), (.494, .184, 19, .66),
             (.622, .837, 9, .91), (.943, .516, 16, .54)]
    for i, (fx, fy, length, width) in enumerate(barks):
        dx = delta(xx, fx*SIZE)/ppmm
        dy = delta(yy, fy*SIZE)/ppmm
        taper = np.clip(1-(2*dy/length)**2, 0, 1)**.8
        d = dx-.13*np.sin(dy*.9+i)-.012*dy
        ragged = 1+.16*np.sin(dy*4.5+i)+.10*np.sin(dy*8)
        mask = np.exp(-(d/(width*.5*taper*ragged+.02))**4)*taper
        hollow = np.exp(-(d/(width*.8*taper+.08))**2)*taper
        bark_mask = np.maximum(bark_mask, mask)
        bark_cut = np.maximum(bark_cut, .14*hollow)
    height -= bark_cut

    # Reflectance only: none of the following uses normals, lights or AO.
    base = np.zeros((SIZE, SIZE, 3), np.float32)
    target = np.array([164., 120., 76.], np.float32)
    for c, gain in enumerate([.94, 1.0, 1.04]):
        base[..., c] = target[c]+pigment*gain+master[..., c+1]+scrape_pigment
    base -= knot_core[..., None]*np.array([32, 28, 21])
    base -= knot_ring[..., None]*np.array([9, 8, 6])
    # Oxidized interior fibres / pigmented cambium, independently from cavity AO.
    base -= check_mask[..., None]*np.array([23, 24, 20])
    base -= bark_mask[..., None]*np.array([40, 36, 27])
    base += target-base.mean((0, 1), dtype=np.float64)
    base8 = np.clip(np.rint(base), 0, 255).astype(np.uint8)

    rough = .659-.071*polish+.009*fine+.009*pore+.018*knot_core+.044*bark_mask+.036*check_mask
    rough = np.clip(rough, .55, .75)
    # AO uses actual concavity at several local horizons. Its support is limited
    # to authored cavities; pigment or ordinary dark growth streaks cannot cast AO.
    cavity_support = np.maximum.reduce([check_mask, knot_core, bark_mask, scrape_edges*.40])
    horizon = np.zeros_like(height)
    for radius in (1, 2, 4, 8, 16):
        slopes = []
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            neighbour = np.roll(height, (dy*radius, dx*radius), axis=(0, 1))
            slopes.append(np.maximum(neighbour-height, 0)/(radius/ppmm))
        horizon = np.maximum(horizon, np.mean(slopes, axis=0))
    ao = 1-np.clip(horizon*.68, 0, .55)*cavity_support
    orm = np.stack((ao*255, rough*255, np.zeros_like(rough)), -1)
    orm8 = np.rint(orm).astype(np.uint8)
    assert height.min() > 0 and height.max() < HEIGHT_MM
    h16 = np.rint(height/HEIGHT_MM*65535).astype(np.uint16)
    Image.fromarray(h16).save(ROOT/'wood_height.png')
    # Derive normals from the reopened quantized delivery, never floating source.
    saved_height = np.asarray(Image.open(ROOT/'wood_height.png'))
    normal8 = normals_from_height(saved_height)
    save_rgb('wood_base.png', base8, True)
    save_rgb('wood_normal.png', normal8)
    save_rgb('wood_orm.png', orm8)

    # The 1K maps use area reduction, with normals regenerated from the reduced
    # saved height for physical consistency. check_material measures mip PSNR.
    h1024 = np.rint(box(h16)).astype(np.uint16)
    Image.fromarray(h1024).save(ROOT/'wood_height_1024.png')
    save_rgb('wood_base_1024.png', box(base8), True)
    save_rgb('wood_orm_1024.png', box(orm8))
    save_rgb('wood_normal_1024.png', normals_from_height(np.asarray(Image.open(ROOT/'wood_height_1024.png'))))

    # Full-size construction fields retain every authored component for inspection.
    np.savez_compressed(SOURCE/'construction_fields.npz', pigment=grain, fine=fine,
                        growth=growth, grain_relief_mm=grain_relief, scrape_mm=scrape,
                        scrape_edges=scrape_edges, polish=polish, knot_core=knot_core,
                        knot_ring=knot_ring, knot_support=knot_support, knot_height_mm=knot_height,
                        check_mask=check_mask, check_cut_mm=check_cut, bark_mask=bark_mask,
                        bark_cut_mm=bark_cut, cavity_support=cavity_support, warp_pixels=warp)
    save_rgb('source/quilted_pigment.png', master[..., 0, None]*np.array([.94, 1., 1.04])+target, True)
    metadata = dict(seed=SEED, pixels=SIZE, metres_per_tile=.4, full_height_range_mm=HEIGHT_MM,
                    generated_source_dimensions=list(Image.open(SOURCE/'generated_wood.png').size),
                    source_sha256=hashlib.sha256((SOURCE/'generated_wood.png').read_bytes()).hexdigest(),
                    source_native_pixel_scale=True, source_placements=placements,
                    knots_xy_fraction_width_length_depth_mm=knots,
                    checks_xy_fraction_length_width_depth_mm=checks,
                    cambium_xy_fraction_length_width_mm=barks, scrapes=strokes,
                    build_seconds=round(time.monotonic()-started, 2))
    (SOURCE/'construction.json').write_text(json.dumps(metadata, indent=2)+'\n')
    print(json.dumps({k: metadata[k] for k in ('pixels', 'metres_per_tile', 'full_height_range_mm', 'build_seconds')}, indent=2))


if __name__ == '__main__':
    main()
