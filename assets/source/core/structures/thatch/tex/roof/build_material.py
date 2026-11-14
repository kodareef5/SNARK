"""Build a 3 m periodic reed-roof material from the retained imagegen sources.

Dependencies: Python 3.9+, NumPy, SciPy, Pillow. Run in this folder:
    python3 build_material.py
All authoring is deterministic. Large course steps belong to the mesh.
"""
from pathlib import Path
import hashlib
import json
import time
import numpy as np
from PIL import Image, ImageCms, PngImagePlugin
from scipy.ndimage import gaussian_filter, gaussian_filter1d, map_coordinates
from scipy.signal import find_peaks

ROOT = Path(__file__).resolve().parent
N = 2048
MM_PER_PIXEL = 3000.0 / N
HEIGHT_RANGE_MM = 25.0
COURSES = [171, 512, 853, 1195, 1536, 1877]
BINDINGS = [0, 171, 345, 512, 679, 853, 1027, 1195, 1363, 1536, 1709, 1877]
SEED = 621405
# Retain Round 2's calibration: an edge repair must not recolour or raise
# the rest of the panel through a newly computed global mean/minimum.
PALETTE_TRANSLATION = [-4.24529906263956, -4.074168458971087, -3.640666844305983]
HEIGHT_DATUM_SHIFT_MM = 1.1640745520591735
SRGB = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()


def smooth(a, sy, sx=None):
    return gaussian_filter(a, (sy, sy if sx is None else sx), mode='wrap')


def unit(a):
    return (a - a.mean()) / max(float(a.std()), 1e-6)


def noise(rng, sy, sx, shape=(N, N)):
    return unit(smooth(rng.standard_normal(shape).astype(np.float32), sy, sx))


def write_png(name, a, srgb=False):
    info = PngImagePlugin.PngInfo()
    info.add_text('Material', 'Hand-packed flat reed roof; 3 x 3 metres; repeat X and Y')
    info.add_text('Color space', 'sRGB' if srgb else 'linear data')
    if 'height' in name:
        info.add_text('Height range', '0..65535 = 0..25 mm; local relief only; white high')
    if 'normal' in name:
        info.add_text('Normal convention', 'OpenGL: +X right; +Y image-up; +Z out')
    if 'orm' in name:
        info.add_text('Channels', 'R occlusion; G roughness; B metalness (zero)')
    if a.dtype != np.uint16:
        a = np.clip(np.rint(a), 0, 255).astype(np.uint8)
    Image.fromarray(a).save(ROOT / name, pnginfo=info,
                           **({'icc_profile': SRGB} if srgb else {}))


def minimum_cut(a, b):
    """Vertical minimum-error cut inside the overlapping longitudinal reeds."""
    error = gaussian_filter(np.mean((a-b)**2, axis=2), (1.0, 1.0))
    h, w = error.shape
    error[:, :8] += 1e7
    error[:, -8:] += 1e7
    cost = error[0].copy()
    trace = np.zeros((h, w), np.int16)
    for y in range(1, h):
        c = np.stack([np.r_[1e15, cost[:-1]], cost, np.r_[cost[1:], 1e15]])
        step = c.argmin(axis=0)-1
        trace[y] = np.arange(w)+step
        cost = error[y]+c.min(axis=0)
    path = np.zeros(h, int)
    path[-1] = cost.argmin()
    for y in range(h-2, -1, -1):
        path[y] = trace[y+1, path[y+1]]
    # Only a two-pixel feather, so narrow reeds remain sharp.
    weight = np.clip((np.arange(w)[None]-path[:, None])/2+.5, 0, 1)
    return a*(1-weight[..., None])+b*weight[..., None]


def quilt_strip(sources, height, rng):
    overlap = 64
    width = N+96
    canvas = np.zeros((height, width, 3), np.float32)
    x = 0
    records = []
    while x < width:
        source_id = int(rng.integers(0, 2))
        src = sources[source_id]
        pw = min(int(rng.integers(385, 545)), width-x)
        if width-x < 100:
            pw = width-x
        sy = int(rng.integers(0, src.shape[0]-height))
        sx = int(rng.integers(0, src.shape[1]-pw))
        patch = src[sy:sy+height, sx:sx+pw].copy()
        flip = bool(rng.integers(0, 2))
        if flip:
            patch = patch[:, ::-1]
        ov = min(overlap, pw) if x else 0
        if ov:
            patch[:, :ov] = minimum_cut(canvas[:, x:x+ov], patch[:, :ov])
        canvas[:, x:x+pw] = patch
        records.append(dict(source=source_id, source_x=sx, source_y=sy,
                            destination_x=x, width=pw, flip_x=flip))
        if x+pw == width:
            break
        x += pw-overlap
    canvas[:, :96] = minimum_cut(canvas[:, N:], canvas[:, :96])
    return canvas[:, :N], records


def normal_from_height(height_u16):
    h = height_u16.astype(np.float32) / 65535 * HEIGHT_RANGE_MM
    dx = (np.roll(h, -1, 1)-np.roll(h, 1, 1))/(2*MM_PER_PIXEL)
    dy = (np.roll(h, -1, 0)-np.roll(h, 1, 0))/(2*MM_PER_PIXEL)
    v = np.stack([-dx, dy, np.ones_like(h)], axis=2)
    return v / np.linalg.norm(v, axis=2, keepdims=True)


def build():
    started = time.time()
    rng = np.random.default_rng(SEED)
    (ROOT/'source').mkdir(exist_ok=True)
    (ROOT/'checks').mkdir(exist_ok=True)
    sources = []
    source_info = []
    for name in ['generated_reeds_c.png', 'generated_reeds_d.png']:
        im = Image.open(ROOT/'source'/name).convert('RGB')
        source_info.append(dict(file='source/'+name, size=list(im.size),
                                sha256=hashlib.sha256((ROOT/'source'/name).read_bytes()).hexdigest()))
        # Slight compression across stems gives 2–7 px reeds. No enlargement.
        im = im.resize((int(im.width*.64), im.height), Image.Resampling.LANCZOS)
        a = np.asarray(im).astype(np.float32)
        # Translate channel means only. Do not flatten source contrast/chroma.
        a += np.array([182, 147, 92], np.float32)-a.mean((0, 1))
        sources.append(a)
    raw = np.zeros((N, N, 3), np.float32)
    bundle_height = np.zeros((N, N), np.float32)
    bundle_colour = np.zeros((N, N, 3), np.float32)
    bundle_records = []
    quilt_log = []
    # The strip ending at 171 crosses row zero continuously.
    for i, end in enumerate(COURSES):
        previous = COURSES[i-1]
        length = (end-previous) % N
        strip, records = quilt_strip(sources, length, rng)
        rows = (np.arange(length)+previous) % N
        # 40 independently angled handfuls per course, 5–10 cm wide.
        widths = rng.uniform(38, 64, 40)
        widths *= N/widths.sum()
        edges = np.r_[0, np.cumsum(widths)]
        bx = np.arange(N, dtype=np.float32)
        by = np.arange(length, dtype=np.float32)[:, None]
        shift = np.zeros((length, N), np.float32)
        hills = np.zeros_like(shift)
        colours = np.zeros((length, N, 3), np.float32)
        weight_sum = np.zeros_like(shift)
        record = []
        for j, width in enumerate(widths):
            centre = (edges[j]+edges[j+1])/2
            lean = float(rng.uniform(-.045, .045))
            dist = (bx[None]-centre-lean*(by-length/2)+N/2) % N-N/2
            weight = np.exp(-(dist/(width*.48))**4)
            crown = np.exp(-(dist/(width*.38))**2)
            hills += crown*float(rng.uniform(3.2, 6.8))
            shift += weight*lean*(by-length/2)
            tone = rng.normal(0, 6)*np.array([1, .85, .5])+rng.normal(0, 2)*np.array([-1, .1, 1.2])
            colours += weight[..., None]*tone
            weight_sum += weight
            record.append(dict(centre_x=float(centre), width_mm=float(width*MM_PER_PIXEL), lean_degrees=float(np.degrees(np.arctan(lean)))))
        shift /= weight_sum
        sy = np.broadcast_to(by, shift.shape)
        strip = np.stack([map_coordinates(strip[..., c], [sy, bx[None]-shift], order=1, mode='grid-wrap') for c in range(3)], axis=2)
        raw[rows] = strip
        bundle_height[rows] = hills
        bundle_colour[rows] = colours/weight_sum[..., None]
        bundle_records.append(record)
        quilt_log.append(dict(start_row=previous, end_row=end, patches=records))

    yy, xx = np.mgrid[:N, :N].astype(np.float32)
    distance_x = np.minimum(xx+.5, N-xx-.5)
    distance_y = np.minimum(yy+.5, N-yy-.5)
    edge_x = np.exp(-(distance_x/15)**2)
    edge_y = np.exp(-(distance_y/15)**2)
    joint = np.maximum(edge_x, edge_y)
    joint_width_x = 4.8+1.2*noise(rng, 32, 32)
    joint_width_y = 4.6+1.1*noise(rng, 32, 32)
    joint_core = np.maximum(np.exp(-(distance_x/np.clip(joint_width_x, 2.8, 7))**2),
                            np.exp(-(distance_y/np.clip(joint_width_y, 2.8, 7))**2))
    # Periodic deformation roughens just the outer 15–30 pixels.
    tousle = noise(rng, 9, 2)*2.7*joint
    # Small per-stem variation of cut positions, centred on the six fixed rows.
    cut_jitter = []
    dy = np.zeros((N, N), np.float32)
    for row in COURSES:
        jitter = np.clip(unit(gaussian_filter1d(rng.standard_normal(N), 1.4, mode='wrap'))*1.8, -4.2, 4.2)
        cut_jitter.append(jitter)
        dist = (yy-row+N/2) % N-N/2
        dy += jitter[None]*np.exp(-(dist/13)**2)
    raw = np.stack([map_coordinates(raw[..., c], [yy-dy, xx+tousle],
                                   order=1, mode='grid-wrap') for c in range(3)], axis=2)
    write_png('source/assembled_reeds.png', raw, True)
    lum = np.sum(raw * np.array([.2126, .7152, .0722], np.float32), axis=2)
    # Keep the photographic reed detail and colour differences. Only remove
    # a fraction of very broad exposure drift, not stalk or handful contrast.
    illumination = smooth(lum, 110, 110)
    base = raw-(illumination-illumination.mean())[..., None]*.25+bundle_colour
    weather = noise(rng, 90, 55)
    damp = np.maximum(weather-1.2, 0)
    bleach = np.maximum(-weather-1.15, 0)
    base -= damp[..., None]*np.array([10, 11, 8])
    base += bleach[..., None]*np.array([10, 11, 12])
    # Extra sub-source-resolution fibres, coherent along the reeds.
    fine = noise(rng, 5.5, .32)
    fine2 = noise(rng, 18, .52)
    base += (fine*.95+fine2*.55)[..., None]
    ridge = np.clip((smooth(lum, .45, .55)-smooth(lum, 13, 9))/75+.5, 0, 1)
    # Compressed stalk crowns are shallower than the handfuls they sit on.
    # This keeps grazing light matte rather than turning every fibre into a fin.
    height = 4.8+3.4*ridge+bundle_height*1.18+noise(rng, 35, 4)*.28+fine*.10+fine2*.08
    # The mattress swells between successive cross-bindings.
    for i, start in enumerate(BINDINGS):
        length = (BINDINGS[(i+1) % len(BINDINGS)]-start) % N
        rows = (np.arange(length)+start) % N
        height[rows] += (2.3*np.sin(np.pi*np.arange(length)/length)**1.3)[:, None]
    height -= joint*(2.0+.20*noise(rng, 3, 3))+joint_core*1.2
    base -= (joint*(8.0+1.2*noise(rng, 2, 4))+joint_core*15)[..., None]
    course_mask = np.zeros((N, N), np.float32)
    butt_mask = np.zeros((N, N), np.float32)
    butt_count = 0
    # A shallow cut lip only, not the centimetre step already supplied by mesh.
    for row, jitter in zip(COURSES, cut_jitter):
        d = (yy-row+N/2) % N-N/2-jitter[None]
        lip = np.exp(-((d+3.2)/9.0)**2)
        cavity = np.exp(-((d-7.2)/3.7)**2)
        height += 5.8*lip-2.3*cavity
        course_mask = np.maximum(course_mask, cavity)
        trace = gaussian_filter1d(lum[(row-5) % N], .65, mode='wrap')
        peaks, _ = find_peaks(trace, distance=4, prominence=7)
        for x in peaks:
            if x < 5 or x > N-6:
                continue
            w = float(rng.uniform(1.6, 3.3))
            y = row+float(jitter[x])+float(rng.uniform(2.6, 5.2))
            xs = np.arange(max(0, x-5), min(N, x+6))
            ys = np.arange(int(y)-6, int(y)+7)
            u = (xs[None]-x)/w
            v = (ys[:, None]-y)/float(rng.uniform(2.3, 3.8))
            rad = np.sqrt(u*u+v*v)
            cap = np.clip((1.2-rad)*3, 0, 1).astype(np.float32)
            pith = np.exp(-((u/.42)**2+(v/.43)**2))*cap
            ix = np.ix_(ys % N, xs)
            colour = np.array([216, 177, 112])+rng.normal(0, 10)
            grain = np.sin(u*10+v*4)*2
            base[ix] = base[ix]*(1-.92*cap[..., None]) + \
                (colour[None, None]-pith[..., None]*65+grain[..., None])*(.92*cap[..., None])
            height[ix] += cap*1.6-pith*1.2
            butt_mask[ix] = np.maximum(butt_mask[ix], cap)
            butt_count += 1

    cord_mask = np.zeros((N, N), np.float32)
    stitch_mask = np.zeros((N, N), np.float32)
    cord_cavity = np.zeros((N, N), np.float32)
    dimple_mask = np.zeros((N, N), np.float32)
    cord_records = []
    xx1 = np.arange(N, dtype=np.float32)
    cord_paths = []
    for i, row in enumerate(BINDINGS):
        wiggle = unit(gaussian_filter1d(rng.standard_normal(N), 23, mode='wrap'))*.72
        # Values and derivatives at the image border are neighbours on a torus.
        centre = row+1.45*np.sin(2*np.pi*xx1/N*(3+i % 3)+i)+wiggle
        if row == 0:
            # The boundary is between texel centres -1 and 0. Seat this cord
            # on that joint so equal halves occupy the bottom and top rows.
            # Keep the RNG draws above: all other bindings retain their paths.
            centre = np.full_like(xx1, -.5)
        # Cyclic stitch spacing includes the last-to-first stitch across X.
        gaps = rng.uniform(.90, 1.10, 25)
        gaps *= N/gaps.sum()
        ties = (np.cumsum(gaps)+rng.uniform(0, gaps[0])) % N
        ties.sort()
        ys = np.arange(row-30, row+31)
        d = ys[:, None]-centre[None]
        compression = 1.5*np.exp(-(d/8.5)**2)
        dimples = np.zeros_like(compression)
        for x in ties:
            ux = (xx1-x+N/2) % N-N/2
            dimples += np.exp(-(ux[None]/9.0)**2-(d/10.5)**2)
        ix = np.ix_(ys % N, np.arange(N))
        height[ix] -= compression+dimples*3.2
        dimple_mask[ix] = np.maximum(dimple_mask[ix], dimples)
        cord_paths.append((row, centre, wiggle, ties))
    surface = smooth(height, 2, 3)
    for i, (row, centre, wiggle, ties) in enumerate(cord_paths):
        radius = 2.05+.18*np.sin(2*np.pi*xx1/N*7+i)
        ys = np.arange(row-12, row+13)
        d = ys[:, None]-centre[None]
        alpha = np.clip(radius[None]+.65-np.abs(d), 0, 1)
        cap = np.sqrt(np.clip(1-(d/radius[None])**2, 0, 1))
        twist_distance = d
        if row == 0:
            # A compressed cord has a broad crown and rounded shoulders.
            # Resolve that crown across the boundary without a sharp change
            # of slope between the two centre samples. The twist continues
            # over both halves of this one cross-section.
            cap = np.sqrt(np.clip(1-(d/radius[None])**6, 0, 1))
            twist_distance = .15*d+.85*d**3/radius[None]**2
        # Integer twist cycles guarantee exact period; thin diagonal fibre ribs.
        cycles = 281+i*3
        phase = 2*np.pi*cycles*xx1[None]/N+twist_distance*1.17 + i*.7
        twist = np.cos(phase)
        ribs = np.maximum(twist, 0)**2
        cord_height = surface[ys % N]+.9+cap*3.5+ribs*.65
        cord_colour = np.array([151, 116, 65])[None, None] + \
            (twist*17+np.sin(phase*3)*3+wiggle[None]*1.2+cap*12)[..., None]
        ix = np.ix_(ys % N, np.arange(N))
        base[ix] = base[ix]*(1-alpha[..., None])+cord_colour*alpha[..., None]
        height[ix] = height[ix]*(1-alpha)+cord_height*alpha
        cord_mask[ix] = np.maximum(cord_mask[ix], alpha)
        cavity = np.exp(-((np.abs(d)-radius[None]-.55)/1.6)**2)*(1-alpha)
        cord_cavity[ix] = np.maximum(cord_cavity[ix], cavity)
        stitches = []
        for x in ties:
            x0 = int(x)
            y0 = float(centre[x0])
            lean = float(rng.uniform(-.19, .19))
            # Two compact twine turns tied through the mattress; avoid big bows.
            for off in [-1.5, 1.1]:
                xs = np.arange(x0-7, x0+8)
                yv = np.arange(int(y0)-13, int(y0)+14)
                v = yv[:, None]-y0
                u = xs[None]-x-off-lean*v
                a = np.clip(1.5-np.abs(u), 0, 1)*np.clip(10.2-np.abs(v), 0, 1)
                turns = np.cos(v*2.3+u*2)
                ix2 = np.ix_(yv % N, xs % N)
                stitch_height = 1.2+np.sqrt(np.clip(1-(u/1.6)**2, 0, 1))*1.1
                height[ix2] += a*stitch_height
                sc = np.array([173, 134, 77])[None, None]+turns[..., None]*12
                base[ix2] = base[ix2]*(1-a[..., None])+sc*a[..., None]
                stitch_mask[ix2] = np.maximum(stitch_mask[ix2], a)
                ends = np.exp(-(u/1.9)**2-((np.abs(v)-10.5)/1.5)**2)
                height[ix2] -= ends*1.4
                cord_cavity[ix2] = np.maximum(cord_cavity[ix2], ends)
            stitches.append([round(x, 3), round(y0 % N, 3)])
        cord_records.append(dict(nominal_row=row, minimum_row=float(centre.min()),
                                 maximum_row=float(centre.max()), twist_cycles=cycles,
                                 stitch_centres=stitches))

    # Mean translation preserves local RGB contrast (no tanh or desaturation).
    base += np.array(PALETTE_TRANSLATION)
    unclipped_height = [float(height.min()), float(height.max())]
    # Height is not range-normalized: every displacement is authored in mm.
    # A constant datum shift makes the deepest stitch positive; it does not
    # change any local relief, slopes, normal or contrast.
    height_datum_shift = HEIGHT_DATUM_SHIFT_MM
    height += height_datum_shift
    height_clipped_fraction = float(np.mean((height < 0) | (height > HEIGHT_RANGE_MM)))
    height = np.clip(height, 0, HEIGHT_RANGE_MM)
    h16 = np.rint(height/HEIGHT_RANGE_MM*65535).astype(np.uint16)
    write_png('roof_base.png', base, True)
    write_png('roof_height.png', h16)
    # Reopen the delivered PNG; normals use exactly the quantized delivered data.
    saved = np.asarray(Image.open(ROOT/'roof_height.png')).astype(np.uint16)
    normals = normal_from_height(saved)
    write_png('roof_normal.png', (normals*.5+.5)*255)
    # Cavity AO from scale-dependent depressions, with shared feature masks.
    h = saved.astype(np.float32)/65535*HEIGHT_RANGE_MM
    depression = np.maximum(smooth(h, 2, 2)-h, 0)
    depression_wide = np.maximum(smooth(h, 9, 9)-h, 0)
    ao = np.clip(1-depression*.055-depression_wide*.025-
                 cord_cavity*.16-course_mask*.24-joint*.09-joint_core*.06-dimple_mask*.075, .43, 1)
    roughness = np.clip(.855+noise(rng, 7, 2)*.018+fine*.008+
                        (1-ridge)*.022+joint*.025-cord_mask*.055-stitch_mask*.025, .70, .95)
    # Round inward to keep the decoded 8-bit range strictly within 0.70..0.95.
    orm = np.stack([np.rint(ao*255), np.clip(np.rint(roughness*255), 179, 242),
                    np.zeros_like(h)], axis=2)
    write_png('roof_orm.png', orm)
    np.savez_compressed(ROOT/'source/derivation.npz', course_mask=course_mask.astype(np.float16),
                        butt_mask=butt_mask.astype(np.float16), cord_mask=cord_mask.astype(np.float16),
                        stitch_mask=stitch_mask.astype(np.float16), joint_mask=joint.astype(np.float16),
                        dimple_mask=dimple_mask.astype(np.float16), bundle_height=bundle_height.astype(np.float16))
    metadata = dict(size=N, coverage_mm=[3000, 3000], mm_per_pixel=MM_PER_PIXEL,
                    height_range_mm=HEIGHT_RANGE_MM, actual_height_mm=[float(h.min()), float(h.max())],
                    course_rows=COURSES, binding_rows=BINDINGS, binding_paths=cord_records,
                    bundle_courses=bundle_records, round=3, unclipped_height_mm=unclipped_height,
                    height_clipped_fraction=height_clipped_fraction, height_datum_shift_mm=height_datum_shift,
                    palette_translation=PALETTE_TRANSLATION,
                    edge_binding=dict(centre_row=-.5, crown_power=6, wrapped=True),
                    seed=SEED, cut_end_count=butt_count, sources=source_info, quilting=quilt_log,
                    build_seconds=round(time.time()-started, 3))
    (ROOT/'material.json').write_text(json.dumps(metadata, indent=2)+'\n')
    print(json.dumps({k: metadata[k] for k in ['size', 'height_range_mm', 'actual_height_mm',
                                              'cut_end_count', 'build_seconds']}, indent=2))


if __name__ == '__main__':
    build()
