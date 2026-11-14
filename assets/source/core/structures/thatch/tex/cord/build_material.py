"""Build a physically scaled, periodic two-ply cord material.

Python 3 + NumPy, SciPy and Pillow. All input/output paths are relative to this
file, never the caller's working directory. No network or generation required.
The retained generated image supplies fibre morphology, not illumination.
Geometry is authored at 4096 and area integrated into the delivered 2048 maps.
"""
from pathlib import Path
import hashlib
import json
import struct
import time
import numpy as np
from PIL import Image, ImageCms, PngImagePlugin
from scipy.ndimage import gaussian_filter, map_coordinates

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'source'
CHECKS = ROOT / 'checks'
N, SS = 2048, 2
M = N * SS
TILE_MM = 1500.0
HEIGHT_MM = 10.0
PITCH_MM = TILE_MM / M
COUNT = 172
SEED = 831104
TAU = 2 * np.pi
_profile = bytearray(ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
# LittleCMS stamps freshly created profiles with the current time. Freeze the
# ICC header creation date so repeated builds are byte-identical, not merely
# pixel-identical. No colour transform or TRC is modified.
_profile[24:36] = struct.pack('>6H', 2026, 11, 14, 0, 0, 0)
_profile[84:100] = bytes(16)  # Optional profile ID: unspecified.
SRGB = bytes(_profile)


def save(path, array, srgb=False, **extra):
    info = PngImagePlugin.PngInfo()
    info.add_text('Material', 'Two-ply grass and bark cord; 1.5 x 1.5 metre repeat')
    info.add_text('Color space', 'sRGB' if srgb else 'linear data')
    for key, value in extra.items():
        info.add_text(key.replace('_', ' '), str(value))
    kw = {'icc_profile': SRGB} if srgb else {}
    Image.fromarray(array).save(path, pnginfo=info, **kw)


def area(a):
    return a.reshape(N, SS, N, SS, *a.shape[2:]).mean((1, 3))


def to8(a):
    return np.clip(np.rint(a), 0, 255).astype(np.uint8)


def strand_noise(rng, sigma):
    a = gaussian_filter(rng.standard_normal(M).astype(np.float32), sigma, mode='wrap')
    return a / max(float(a.std()), .001)


def periodic_component(a):
    """Remove the nonperiodic boundary component by a Fourier Poisson solve.

    This is used only on the source pigment atlas. Cord geometry itself is
    periodic analytically; no painted border band or duplicated last pixel.
    """
    h, w = a.shape
    v = np.zeros_like(a)
    v[0] = a[-1] - a[0]
    v[-1] = a[0] - a[-1]
    v[:, 0] += a[:, -1] - a[:, 0]
    v[:, -1] += a[:, 0] - a[:, -1]
    fy = TAU * np.fft.fftfreq(h)
    fx = TAU * np.fft.fftfreq(w)
    den = 2 * np.cos(fy[:, None]) + 2 * np.cos(fx[None]) - 4
    den[0, 0] = 1
    smooth = np.fft.fft2(v) / den
    smooth[0, 0] = 0
    return (a - np.fft.ifft2(smooth).real).astype(np.float32)


def make_atlas():
    src = np.asarray(Image.open(SOURCE / 'generated_fibres.png').convert('RGB'), dtype=np.float32)
    luma = src @ np.array([.2126, .7152, .0722], np.float32)
    # Reject generated macro lighting and original RGB. The bounded, zero-mean
    # residual is an authored pigment pattern; it never controls cavity colour.
    raw = np.log(np.maximum(luma, 1))
    raw -= gaussian_filter(raw, (12, 5), mode='reflect')
    raw = periodic_component(raw)
    raw = gaussian_filter(raw, (.42, .25), mode='wrap')
    raw /= max(float(raw.std()), .001)
    atlas = np.tanh(raw / 1.6).astype(np.float32)
    atlas -= atlas.mean()
    save(SOURCE / 'fibre_pigment_atlas.png', to8(128 + atlas * 72))
    return atlas


def normal_from_height(height_u16):
    h = height_u16.astype(np.float64) / 65535 * HEIGHT_MM
    pitch = TILE_MM / N
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * pitch)
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) / (2 * pitch)
    n = np.stack((-dx, dy, np.ones_like(h)), -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return to8((n * .5 + .5) * 255)


def geometry_ao(height_mm):
    """Wrapped eight-direction heightfield horizon AO, 0.73--17.6 mm radii.

    No albedo input. Averaged sin(horizon)^2 approximates blocked cosine-weighted
    hemisphere sectors. Fibre cavities get a small extra local term.
    """
    pitch = TILE_MM / N
    blocked = np.zeros((N, N), np.float32)
    for dy, dx in [(0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1), (-1, 0), (-1, 1)]:
        slope = np.zeros((N, N), np.float32)
        for step in [1, 2, 3, 5, 8, 13, 24]:
            dh = np.roll(height_mm, (dy * step, dx * step), (0, 1)) - height_mm
            slope = np.maximum(slope, dh / (pitch * step * np.hypot(dx, dy)))
        blocked += slope * slope / (1 + slope * slope)
    ao = 1 - .88 * blocked / 8
    concavity = np.maximum(gaussian_filter(height_mm, .8, mode='wrap') - height_mm, 0)
    return np.clip(ao - .035 * np.minimum(concavity, 1), .24, 1)


def main():
    start = time.perf_counter()
    SOURCE.mkdir(exist_ok=True)
    CHECKS.mkdir(exist_ok=True)
    rng = np.random.default_rng(SEED)
    atlas = make_atlas()
    ah, aw = atlas.shape
    # Integer frequencies and all modulo addressing make every field periodic.
    y = (np.arange(M, dtype=np.float32) + .5) * PITCH_MM
    t = y / TILE_MM
    yy = t[:, None]
    spacings = rng.uniform(8.25, 9.15, COUNT)
    spacings *= TILE_MM / spacings.sum()
    centres = np.cumsum(spacings) - spacings / 2
    sizes = rng.uniform(8.7, 9.55, COUNT)
    cycles = rng.integers(47, 68, COUNT)  # 22--32 mm full helix pitch.
    phases = rng.uniform(0, TAU, (COUNT, 10))
    shade = np.clip(rng.normal(0, 3.6, COUNT), -8, 8)
    ply_contrast = rng.uniform(4.5, 9, COUNT)
    rises = rng.uniform(-.32, .35, COUNT)
    # Sparse paired path exchanges, each with two low-angle intersections.
    crossing_pairs = [14, 43, 72, 101, 133, 157]
    crossing_y = [210, 610, 1180, 920, 340, 1390]
    crossings = {}
    compression = {}
    crossing_records = []
    for i, cy in zip(crossing_pairs, crossing_y):
        distance = (y - cy + TILE_MM / 2) % TILE_MM - TILE_MM / 2
        support = rng.uniform(100, 145)
        bump = np.where(np.abs(distance) < support, .5 + .5 * np.cos(np.pi * np.clip(distance / support, -1, 1)), 0)
        travel = (centres[i + 1] - centres[i]) * .61
        # The upper rope is lifted locally; the lower rope is pressed into its bed.
        crossings[i] = (travel * bump, 1.35 * bump)
        crossings[i + 1] = (-travel * bump, -.72 * bump)
        # The underpassing cord is locally flattened. Neighbouring turns press
        # inward, avoiding the unnaturally empty lanes of unconstrained curves.
        compression[i + 1] = 1 - .53 * np.minimum(bump * 1.7, 1)
        for j, delta in [(i - 2, .6), (i - 1, 1.8), (i + 2, -1.8), (i + 3, -.6)]:
            crossings[j] = (delta * bump, np.zeros(M, np.float32))
        crossing_records.append({'cords': [i, i + 1], 'centre_mm': [float((centres[i] + centres[i + 1]) / 2), cy],
                                 'half_length_mm': float(support), 'lateral_travel_mm': float(travel)})

    # A continuous layer of unlit loose bast occupies the deepest interstices.
    # It is the same material, with no baked black groove or colour multiplier.
    x = (np.arange(M, dtype=np.float32) + .5) * PITCH_MM
    backing = .34 + .025 * np.sin(TAU * (x[None] / TILE_MM * 389 + yy * 3))
    height = np.broadcast_to(backing, (M, M)).copy().astype(np.float32)
    pigment = np.zeros((M, M), np.float32)
    warmth = np.zeros((M, M), np.float32)
    identity = np.full((M, M), -1, np.int16)
    fibre_relief = np.zeros((M, M), np.float32)
    surface_count = np.zeros((M, M), np.uint8)
    path_records = []

    for i in range(COUNT):
        p = phases[i]
        # Small shared pack motion plus individual hand tension irregularity.
        centre = centres[i] + .53 * np.sin(TAU * (t * 3 + centres[i] / TILE_MM * 4))
        centre += .40 * np.sin(TAU * t * 5 + p[0]) + .18 * np.sin(TAU * t * 13 + p[1])
        centre += .18 * strand_noise(rng, 34)
        lift = np.zeros(M, np.float32)
        if i in crossings:
            travel, lift = crossings[i]
            centre += travel
        swelling = 1 + .035 * np.sin(TAU * t * 19 + p[2]) + .018 * np.sin(TAU * t * 71 + p[3])
        radius = sizes[i] * .286 * swelling
        orbit = sizes[i] * .214 * swelling
        theta = TAU * t * cycles[i] + p[4] + .43 * np.sin(TAU * t * 5 + p[5])
        theta += .16 * np.sin(TAU * t * 17 + p[6])
        theta += .36 * strand_noise(rng, 29)
        zc = 2.65 + rises[i] + .20 * np.sin(TAU * t * 11 + p[7]) + lift
        lo = int(np.floor((centre.min() - sizes[i] * .6) / PITCH_MM))
        hi = int(np.ceil((centre.max() + sizes[i] * .6) / PITCH_MM))
        columns = np.arange(lo, hi + 1)
        xc = (columns[None] + .5) * PITCH_MM
        ix = columns % M
        oldh = height[:, ix].copy()
        local_h = np.full_like(oldh, -100)
        local_pig = np.zeros_like(oldh)
        local_warm = np.zeros_like(oldh)
        local_fibre = np.zeros_like(oldh)
        local_id = np.full(oldh.shape, -1, np.int16)
        # Compact fibrous interior: rounded turn, visible only below ply edges.
        d = (xc - centre[:, None]) / (sizes[i] * .47 * swelling[:, None])
        core = .5 + .43 * lift[:, None] + (2.9 + .25 * rises[i]) * np.sqrt(np.maximum(0, 1 - d * d))
        valid = np.abs(d) < 1
        local_h[valid] = core[valid]
        local_pig[valid] = shade[i]
        local_id[valid] = i * 2
        for ply in range(2):
            angle = theta + ply * np.pi
            cx = centre + orbit * np.cos(angle)
            cz = zc + orbit * np.sin(angle)
            rr = radius * (1 + .027 * np.sin(TAU * t * 37 + p[ply]))
            rr *= 1 + .028 * strand_noise(rng, 9)
            # Upper envelope of densely sampled spheres swept along a helix.
            # This gives circular tubes along the true curved 3D centreline,
            # including slope, overlap, and a clean inter-ply crease.
            upper = np.full_like(oldh, -100)
            best_dx = np.zeros_like(oldh)
            best_rad = np.zeros_like(oldh)
            best_shift = np.zeros(oldh.shape, np.int8)
            reach = int(np.ceil(rr.max() / PITCH_MM))
            for k in range(-reach, reach + 1):
                dx = xc - np.roll(cx, -k)[:, None]
                r2 = np.roll(rr, -k)[:, None] ** 2
                disc = r2 - dx * dx - (k * PITCH_MM) ** 2
                top = np.roll(cz, -k)[:, None] + np.sqrt(np.maximum(disc, 0))
                take = (disc > 0) & (top > upper)
                upper[take] = top[take]
                best_dx[take] = dx[take]
                best_rad[take] = np.broadcast_to(np.roll(rr, -k)[:, None], top.shape)[take]
                best_shift[take] = k
            # UVs on each visible ply follow its helix. Noninteger local phases
            # never enter periodic y: every long-wave frequency is an integer.
            surface_y = (y[:, None] + best_shift * PITCH_MM) % TILE_MM
            radial = np.arcsin(np.clip(best_dx / np.maximum(best_rad, .1), -.98, .98))
            arc = radial * best_rad
            vx = (arc * 3.8 + p[8] * 83 + ply * 371 + 4 * np.sin(TAU * surface_y / TILE_MM * 9 + p[9])) % aw
            vy = (surface_y / TILE_MM * ah * (1 + i % 2) + p[2] * 197 + ply * 437) % ah
            fibre = map_coordinates(atlas, [vy, vx], order=1, mode='grid-wrap')
            # Native-resolution split fibres. Sizes are in physical millimetres.
            micro_phase = TAU * (arc / 1.37 + .13 * np.sin(TAU * surface_y / TILE_MM * 53 + p[1]))
            micro = np.sin(micro_phase + .45 * fibre)
            micro += .38 * np.sin(micro_phase * 1.71 + p[3] + .20 * np.sin(TAU * surface_y / TILE_MM * 83))
            fleck = .55 * np.sin(TAU * surface_y / TILE_MM * 97 + p[3] + radial * .6)
            relief = .24 * fibre + .085 * micro
            upper += relief
            colour = shade[i] + (1 if ply else -1) * ply_contrast[i]
            colour = colour + 17 * fibre + 5.3 * micro + 1.4 * fleck
            colour += 2.4 * np.sin(TAU * surface_y / TILE_MM * 7 + p[ply + 2])
            colour += 4.2 * strand_noise(rng, 27)[:, None]
            take = upper > local_h
            local_h[take] = upper[take]
            local_pig[take] = colour[take]
            local_warm[take] = (1 if ply else -1) * (1.4 + .3 * np.sin(p[1]))
            local_fibre[take] = relief[take]
            local_id[take] = i * 2 + ply
        if i in compression:
            factor = compression[i][:, None]
            local_h = .34 + (local_h - .34) * factor
            local_fibre *= factor
        take = local_h > oldh
        height[:, ix] = np.where(take, local_h, oldh)
        pigment[:, ix] = np.where(take, local_pig, pigment[:, ix])
        warmth[:, ix] = np.where(take, local_warm, warmth[:, ix])
        fibre_relief[:, ix] = np.where(take, local_fibre, fibre_relief[:, ix])
        identity[:, ix] = np.where(take, local_id, identity[:, ix])
        surface_count[:, ix] += (local_h > .6).astype(np.uint8)
        path_records.append({'index': i, 'centre_x_mm': float(centres[i]), 'diameter_mm': float(sizes[i]),
                             'helix_cycles': int(cycles[i]), 'helix_pitch_mm': float(TILE_MM / cycles[i])})
        if i % 30 == 0:
            print(f'Built {i + 1}/{COUNT} cord turns', flush=True)

    # Sparse short fibre ends, rasterized at 2x with periodic coordinates.
    # Their colour and small relief are attached to the SAME sampled surface.
    hairs = 1550
    for j in range(hairs):
        x0, y0 = rng.uniform(0, M, 2)
        length = rng.uniform(2.5, 9.0) / PITCH_MM
        side = rng.choice([-1, 1])
        dx = side * rng.uniform(.8, 3.0) / PITCH_MM
        bend = rng.uniform(-1.3, 1.3) / PITCH_MM
        samples = max(12, int(length * 2))
        f = np.linspace(0, 1, samples)
        xs = x0 + dx * f + bend * np.sin(f * np.pi)
        ys = y0 + length * f
        col = rng.uniform(11, 26)
        for ox, oy in [(0, 0), (1, 0), (0, 1), (1, 1)]:
            xx0, yy0 = np.floor(xs).astype(int) + ox, np.floor(ys).astype(int) + oy
            weight = (1 - np.abs(xs - xx0)) * (1 - np.abs(ys - yy0))
            weight *= .45 * np.sin(np.pi * f) ** .35
            xx0 %= M
            yy0 %= M
            np.add.at(pigment, (yy0, xx0), col * weight)
            np.add.at(height, (yy0, xx0), .11 * weight)
            np.add.at(fibre_relief, (yy0, xx0), .11 * weight)

    # All macro shading is absent from RGB. Contrast is between material plies,
    # independent of light direction, surface normals, AO, or height values.
    base = np.empty((M, M, 3), np.float32)
    for c, (target, gain, tint) in enumerate(zip([118, 96, 64], [1, .91, .73], [.45, .1, -.60])):
        base[..., c] = target + pigment * gain + warmth * tint
        base[..., c] += target - float(base[..., c].mean())
    save(SOURCE / 'cord_master_base.png', to8(base), True)
    save(SOURCE / 'cord_master_height.png', np.clip(np.rint(height / HEIGHT_MM * 65535), 0, 65535).astype(np.uint16),
         Height_range_mm=HEIGHT_MM)
    base2048 = area(base)
    for c, target in enumerate([118, 96, 64]):
        base2048[..., c] += target - float(base2048[..., c].mean())
    base8 = to8(base2048)
    height2048 = area(height)
    assert height2048.min() >= 0 and height2048.max() < HEIGHT_MM
    height16 = np.rint(height2048 / HEIGHT_MM * 65535).astype(np.uint16)
    delivered_height_mm = height16.astype(np.float32) / 65535 * HEIGHT_MM
    norm = normal_from_height(height16)
    print('Computing wrapped horizon occlusion', flush=True)
    ao = geometry_ao(delivered_height_mm)
    roughness = .881 + .035 * np.tanh(-area(pigment) / 19)
    roughness += .014 * np.tanh(area(fibre_relief) / .05)
    roughness = np.clip(roughness, .80, .95)
    orm = np.stack([to8(ao * 255), to8(roughness * 255), np.zeros((N, N), np.uint8)], -1)
    save(ROOT / 'cord_base.png', base8, True)
    save(ROOT / 'cord_height.png', height16, Height_range_mm=HEIGHT_MM, White='high')
    save(ROOT / 'cord_normal.png', norm, Normal_convention='OpenGL; +X right, +Y image-up, +Z outward',
         Derivation='central difference of delivered 16-bit height; wrapped; 1500/2048 mm per texel')
    save(ROOT / 'cord_orm.png', orm, Channels='R ambient occlusion; G roughness; B metalness=0')
    # Construction-only diagnostics; not additional engine material textures.
    np.savez_compressed(CHECKS / 'construction_fields.npz',
                        ply_id=identity[::2, ::2], fibre_relief_mm=area(fibre_relief),
                        coverage=area((identity >= 0).astype(np.float32)),
                        overlap=area((surface_count > 1).astype(np.float32)))
    metadata = {'seed': SEED, 'tile_metres': [1.5, 1.5], 'size': N, 'master_size': M,
                'height_range_mm': HEIGHT_MM, 'mm_per_texel': TILE_MM / N, 'cord_count': COUNT,
                'source_native_size': [aw, ah], 'source_sha256': hashlib.sha256((SOURCE / 'generated_fibres.png').read_bytes()).hexdigest(),
                'fibre_ends': hairs, 'cords': path_records, 'crossings': crossing_records,
                'build_seconds': round(time.perf_counter() - start, 3),
                'versions': {'numpy': np.__version__, 'Pillow': Image.__version__}}
    (CHECKS / 'construction.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print(f'Saved four aligned 2048 maps in {metadata["build_seconds"]:.1f}s. Base mean: {base8.mean((0, 1))}', flush=True)


if __name__ == '__main__':
    main()
