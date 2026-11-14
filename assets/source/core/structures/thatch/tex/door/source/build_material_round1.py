#!/usr/bin/env python3
"""Build the door material from the retained generated scans and exact UV guide.

Python 3, numpy, scipy and Pillow. Run from any directory. No network or model
calls are needed. Sources are never resized or overwritten on disk.

Scale: 3000 mm / 2048 px. Height encodes 0..12 mm of LOCAL surface relief.
Normals use the quantized, re-opened 16-bit height, not an intermediate field.
"""
from pathlib import Path
import hashlib
import json
import time

import numpy as np
from PIL import Image, PngImagePlugin
from scipy.ndimage import (distance_transform_edt, gaussian_filter,
                           gaussian_filter1d, map_coordinates)
from scipy.signal import find_peaks

ROOT = Path(__file__).resolve().parent
N = 2048
MM_PER_PX = 3000.0 / N
HEIGHT_MM = 12.0
SEED = 71814


def luminance(a):
    # Explicit channel sums also avoid platform-specific BLAS warnings.
    return a[..., 0] * .2126 + a[..., 1] * .7152 + a[..., 2] * .0722


def png(a, path, srgb=False):
    info = PngImagePlugin.PngInfo()
    if srgb:
        info.add(b'sRGB', b'\x00')
    Image.fromarray(a).save(ROOT / path, pnginfo=info, compress_level=6)


def guide_masks():
    guide = np.asarray(Image.open(ROOT / 'guide/layout.png').convert('RGB'))
    colored = (guide.max(2) - guide.min(2) > 65) & (guide.max(2) > 120)
    inside = colored.copy()
    inside[:, :N // 2] = False
    # The unobscured back supplies the exact reed silhouette behind the poles.
    outside = inside[:, ::-1].copy()
    frame = np.all(guide == [90, 50, 25], axis=2)
    row = guide[400]
    edges = [1072]
    for x in range(1073, 2000):
        if np.any(row[x] != row[x - 1]):
            edges.append(x)
    edges.append(2000)
    outer_edges = [N - x for x in edges[::-1]]
    return guide, outside | inside, frame, outer_edges


def source_library(name):
    """Trace longitudinal groove paths, then extract individual source reeds.

    Each groove stays in its own search corridor. Following it in y preserves
    the generated sheaths and fibers instead of cutting straight across them.
    """
    a = np.asarray(Image.open(ROOT / f'source/reeds_{name}_generated.png')
                   .convert('RGB'), dtype=np.float32)
    lum = luminance(a)
    profile = gaussian_filter1d(lum.mean(0), .7)
    valleys, _ = find_peaks(-profile, distance=4, prominence=5)
    valleys = np.r_[0, valleys, a.shape[1] - 1]
    smooth = gaussian_filter(lum, (15, .65))
    paths = []
    rows = np.arange(a.shape[0])
    for j, x in enumerate(valleys):
        if j in (0, len(valleys) - 1):
            paths.append(np.full(a.shape[0], x, dtype=np.float32))
            continue
        lo = int(np.ceil((valleys[j - 1] + x) / 2))
        hi = int(np.floor((valleys[j + 1] + x) / 2))
        xx = np.arange(lo, hi + 1)
        cost = smooth[:, lo:hi + 1] + .55 * (xx[None, :] - x) ** 2
        p = lo + np.argmin(cost, axis=1)
        paths.append(gaussian_filter1d(p.astype(np.float32), 8))
    reeds = []
    for j in range(len(paths) - 1):
        left, right = paths[j:j + 2]
        if np.median(right - left) < 4.2:
            continue
        xx = left[:, None] + (right - left)[:, None] * np.linspace(.12, .88, 12)[None, :]
        yy = np.broadcast_to(rows[:, None], xx.shape)
        sample = np.stack([map_coordinates(a[..., c], [yy, xx], order=1,
                                          mode='nearest') for c in range(3)], axis=2)
        reeds.append(sample)
    return reeds


def normal_from_height(height_u16):
    physical = height_u16.astype(np.float64) * (HEIGHT_MM / 65535.)
    dy, dx = np.gradient(physical, MM_PER_PX)
    normal = np.stack((-dx, dy, np.ones_like(dx)), axis=2)
    normal /= np.sqrt(np.sum(normal * normal, axis=2))[..., None]
    return np.rint((normal * .5 + .5) * 255).clip(0, 255).astype(np.uint8)


def make_reed_plan(edges, allowed):
    rng = np.random.default_rng(SEED)
    plan = []
    for bundle, (lo, hi) in enumerate(zip(edges[:-1], edges[1:])):
        count = round((hi - lo) / rng.uniform(4.5, 5.3))
        widths = np.clip(rng.lognormal(np.log(4.9), .22, count), 3.0, 7.5)
        widths *= (hi - lo) / widths.sum()
        boundaries = np.r_[lo, lo + np.cumsum(widths)]
        bundle_tone = rng.normal(0, 4.2)
        bundle_raise = rng.uniform(.7, 1.3)
        bundle_phase = rng.uniform(0, 6.28)
        for i, (left, right) in enumerate(zip(boundaries[:-1], boundaries[1:])):
            mid = (left + right) / 2
            col = int(np.clip(mid, lo, hi - 1))
            ys = np.flatnonzero(allowed[:, col])
            # Keep cut ends inside the guide; both faces share the same ends.
            top = int(ys[0]) + rng.integers(2, 11)
            foot = int(ys[-1]) - rng.integers(3, 14)
            nodes = []
            y = top + rng.uniform(55, 175)
            while y < foot - 20:
                nodes.append([float(y), float(rng.uniform(.12, .40)),
                              float(rng.uniform(.6, 1.0))])
                y += rng.uniform(120, 210)
            plan.append(dict(bundle=bundle, lo=lo, hi=hi, left=float(left),
                             right=float(right), top=int(top), foot=int(foot),
                             cut_slant=float(rng.uniform(-2, 2)),
                             radius_mm=float(rng.uniform(1.45, 2.35)),
                             tone=float(rng.normal(0, 8)), bundle_tone=bundle_tone,
                             bundle_raise=bundle_raise, phase=bundle_phase,
                             waviness=float(rng.uniform(.1, .55)),
                             nodes=nodes, seed=int(rng.integers(1, 10000000))))
    return plan


def render_face(face, plan, library, color, height, alpha, dry, allowed):
    yy = np.arange(N, dtype=np.float32)[:, None]
    for idx, reed in enumerate(plan):
        rng = np.random.default_rng(reed['seed'] + face * 3179)
        left, right = reed['left'], reed['right']
        x0, x1 = max(0, int(np.floor(left)) - 2), min(N, int(np.ceil(right)) + 2)
        xx = np.arange(x0, x1, dtype=np.float32)[None, :] + .5
        width = right - left
        # Bundle-scale bow moves neighboring reeds coherently, with all motion
        # going to zero at the fixed UV bundle boundaries.
        bundle_u = (xx - reed['lo']) / (reed['hi'] - reed['lo'])
        bow = .52 * np.sin(yy / 250 + reed['phase']) * np.sin(np.pi * bundle_u)
        u = (xx - bow - left) / width
        own = (u >= 0) & (u < 1)
        t = np.clip(u, 0, 1)
        src = library[int(rng.integers(len(library)))]
        # Alternate source ends and choose different windows: no whole-sheet
        # enlargement, repeated square tiles, or crosswise image join.
        src_start = rng.uniform(0, 120)
        src_end = src.shape[0] - rng.uniform(0, 120)
        sy = np.clip((yy - 280) / 1550, 0, 1) * (src_end - src_start) + src_start
        if rng.random() < .43:
            sy = src.shape[0] - 1 - sy
        sx = t * (src.shape[1] - 1)
        sy = np.broadcast_to(sy, sx.shape)
        tex = np.stack([map_coordinates(src[..., c], [sy, sx], order=1,
                                       mode='nearest') for c in range(3)], axis=2)
        # Remove most source cross-stem lighting; retain botanical color and
        # small sheaths/nodes. Cylindrical lighting comes from the normal map.
        mean_rgb = np.mean(src, axis=(0, 1))
        slow = gaussian_filter(luminance(tex), (45, 0))
        slow_center = np.mean(slow[350:1700])
        natural_detail = .66 * (tex - mean_rgb) - .41 * (slow - slow_center)[..., None]
        straw = np.array([205., 177., 122.]) if face == 0 else np.array([193., 163., 109.])
        source_tone = np.clip((mean_rgb - np.array([211, 173, 111])) * .27, -9, 9)
        tone = reed['tone'] + reed['bundle_tone']
        bleach = rng.uniform(-.5, 1.0) if face == 0 else rng.uniform(-.4, .4)
        rgb = straw + source_tone + tone * np.array([1., .9, .7]) + natural_detail
        rgb += bleach * np.array([6., 8., 11.])
        # Symmetric faint seam color is material weathering, not directional
        # cylinder shading. It remains restrained in the flat albedo.
        edge = np.exp(-t / .07) + np.exp(-(1 - t) / .07)
        rgb -= edge[..., None] * np.array([10., 9., 6.])
        fine = rng.normal(0, .7, t.shape).astype(np.float32)
        fibers = np.sin(t * rng.uniform(17, 29) + yy * .008 + rng.uniform(0, 6.28))
        fibers *= .45 + .55 * np.sin(yy / 53 + rng.uniform(0, 6.28)) ** 2
        rgb += (fine + fibers * 1.15)[..., None]

        cylinder = np.sqrt(np.clip(1 - ((t - .5) / .53) ** 2, 0, 1))
        broad = np.clip(np.sin(np.pi * np.clip(bundle_u, 0, 1)), 0, 1) ** .75
        h = 1.65 + reed['bundle_raise'] * broad + reed['radius_mm'] * cylinder
        h += .055 * fibers + gaussian_filter(fine, (.5, .35)) * .028
        # Generated fine surface texture contributes only a bounded microheight.
        detail = luminance(tex) - gaussian_filter(luminance(tex), (4, .65))
        h += np.clip(detail * .008, -.16, .16)
        for y, amount, node_width in reed['nodes']:
            band = np.exp(-.5 * ((yy - y - (t - .5) * rng.uniform(-1, 1)) / node_width) ** 2)
            h += amount * band * (.3 + .7 * cylinder)
            rgb -= band[..., None] * np.array([4., 4.3, 3.7])
            lip = np.exp(-.5 * ((yy - y + 1.2) / .6) ** 2)
            rgb += lip[..., None] * np.array([2.2, 2.3, 1.6])

        top = reed['top'] + reed['cut_slant'] * (t - .5)
        foot = reed['foot'] - reed['cut_slant'] * (t - .5)
        # A short split at a few ends, never a repeating sawtooth silhouette.
        if idx % 7 == 2:
            top += np.exp(-((t - .65) / .13) ** 2) * rng.uniform(2, 5)
        if idx % 9 == 3:
            foot -= np.exp(-((t - .38) / .12) ** 2) * rng.uniform(2, 5)
        keep = own & (yy >= top) & (yy <= foot)
        endwear = np.exp(-np.maximum(yy - top, 0) / 4) + np.exp(-np.maximum(foot - yy, 0) / 4)
        rgb += endwear[..., None] * np.array([5., 5., 4.])
        h -= .25 * endwear

        if face == 0:
            tx = slice(x0, x1)
            k, v, hv, dv, ow = keep, rgb, h, (bleach + 1) / 2, own
        else:
            tx = slice(N - x1, N - x0)
            k, v, hv, dv, ow = keep[:, ::-1], rgb[:, ::-1], h[:, ::-1], (bleach + 1) / 2, own[:, ::-1]
        # Tile every reed shoulder tightly; alpha stays binary and exact.
        view = color[:, tx]
        view[ow] = v[ow]
        height[:, tx][ow] = hv[ow]
        dry[:, tx][ow] = dv
        alpha[:, tx] |= k & allowed[:, tx]


def add_cord(color, height, dry, alpha, edges):
    """Two thin, two-ply bast cords, physically raised above the reed surface."""
    rope_mask = np.zeros((N, N), dtype=np.float32)
    Y, X = np.mgrid[:N, :N].astype(np.float32)
    # Use guide-measured inside extent; the loose ties stop on the reed panel.
    left, right = N - edges[-1], N - edges[0]
    bed = gaussian_filter(height, (1.3, 4))

    def strand(cx, cy, radius, t, base_z, tint=0):
        # Draw a polyline with a true rounded cross-section and wound fibers.
        xmin, xmax = max(left, int(np.min(cx) - radius - 2)), min(right, int(np.max(cx) + radius + 3))
        ymin, ymax = max(0, int(np.min(cy) - radius - 2)), min(N, int(np.max(cy) + radius + 3))
        xx = X[ymin:ymax, xmin:xmax]
        yy = Y[ymin:ymax, xmin:xmax]
        dist = np.full(xx.shape, 1e4, dtype=np.float32)
        path_t = np.zeros_like(dist)
        for j in range(len(cx) - 1):
            dx, dy = cx[j + 1] - cx[j], cy[j + 1] - cy[j]
            f = np.clip(((xx - cx[j]) * dx + (yy - cy[j]) * dy) / max(dx*dx+dy*dy, .0001), 0, 1)
            d = np.sqrt((xx - cx[j] - f*dx)**2 + (yy - cy[j] - f*dy)**2)
            choose = d < dist
            dist = np.minimum(dist, d)
            path_t[choose] = (t[j] + f * (t[j + 1] - t[j]))[choose]
        cov = np.clip(radius + .5 - dist, 0, 1)
        cov *= alpha[ymin:ymax, xmin:xmax]
        p = np.sqrt(np.clip(1 - (dist / radius) ** 2, 0, 1))
        twist = np.cos(path_t * 4.4 + dist * 2.0)
        z = base_z + p * (radius * MM_PER_PX) + .08 * twist
        old = height[ymin:ymax, xmin:xmax]
        # Near the silhouette, fade the ply rather than carving a moat.
        proposed = z if np.isscalar(z) else z
        old[:] = old * (1 - cov) + np.maximum(old, proposed) * cov
        rope_rgb = np.array([224., 204., 163.]) + tint + twist[..., None] * np.array([4., 4., 3.])
        rope_rgb -= ((dist / radius) ** 2)[..., None] * np.array([4., 4., 3.])
        dst = color[ymin:ymax, xmin:xmax]
        dst[:] = dst * (1 - cov[..., None]) + rope_rgb * cov[..., None]
        dry[ymin:ymax, xmin:xmax] = np.maximum(dry[ymin:ymax, xmin:xmax], cov * .94)
        rope_mask[ymin:ymax, xmin:xmax] = np.maximum(rope_mask[ymin:ymax, xmin:xmax], cov)

    # Light panel ties at about 0.48 m and 1.67 m above the door's foot.
    rows = [int(round(N - (1.67 + .3) / 3 * N)), int(round(N - (.48 + .3) / 3 * N))]
    for row_index, row in enumerate(rows):
        cord_rng = np.random.default_rng(SEED + 900 + row_index)
        xs = np.arange(left + 3, right - 3, 1.5, dtype=np.float32)
        # Hand tension: an inconspicuous smooth sag of 2-3 mm between bundles.
        baseline = row + 1.45 * np.sin(xs / 130 + row_index) + .85 * np.sin(xs / 39)
        winding = (xs - left) / 1.8 + .28 * np.sin(xs / 21)
        for phase in [np.pi, 0.]:
            ys = baseline + 1.15 * np.sin(winding + phase)
            # Process local spans to bound work and preserve the varying bed.
            for j in range(0, len(xs) - 1, 36):
                x = xs[j:j+38]; y = ys[j:j+38]
                if len(x) < 2:
                    continue
                z = float(np.mean(bed[row-2:row+3, int(x[0]):int(x[-1])+1])) + 1.1
                strand(x, y, 1.05, x - left, z, tint=0 if phase == 0 else -4)
        # Small binding hitches, one on each bundle seam; no fake frame.
        for j, bx in enumerate([N - e for e in edges[1:-1]]):
            center_y = row + 1.45 * np.sin(bx / 130 + row_index) + .85 * np.sin(bx / 39)
            shift = cord_rng.uniform(-1.25, 1.25)
            rx, ry = cord_rng.uniform(1.7, 2.6), cord_rng.uniform(3.4, 5.3)
            tilt = cord_rng.uniform(-.24, .24)
            theta = np.linspace(0, 2*np.pi, 35)
            cx = bx + shift + rx * np.cos(theta) + tilt * ry * np.sin(theta)
            cy = center_y + ry * np.sin(theta) + .45 * np.cos(theta * 2)
            z = float(bed[row, bx]) + 1.35
            strand(cx, cy, .88, theta * 3.0, z)
            sign = 1 if (j + row_index) % 2 else -1
            length = cord_rng.uniform(.7, 1.3)
            cx = bx + shift + np.array([-1., 1.6, 3.7, 4.2]) * length
            cy = center_y + sign * np.array([1.5, 4, 6, 8.5]) * length
            strand(cx, cy, .72, np.array([0., 3., 6., 8.]), z-.4, tint=-3)
            if j % 3 == row_index:
                # One short split bast fiber at selected tails, sub-millimetre
                # thickness rasterized with analytic coverage at native scale.
                fx = cx[-1] + np.array([0., 1.4, 2.8])
                fy = cy[-1] + sign * np.array([0., 1.2, 2.2])
                strand(fx, fy, .28, np.array([0., 2., 4.]), z-.6, tint=-2)
    return rope_mask, rows


def build():
    start = time.perf_counter()
    (ROOT / 'checks').mkdir(exist_ok=True)
    guide, allowed, frame, edges = guide_masks()
    plan = make_reed_plan(edges, allowed)
    color = np.full((N, N, 3), [199, 170, 117], dtype=np.float32)
    height = np.full((N, N), 3., dtype=np.float32)
    alpha = np.zeros((N, N), dtype=bool)
    dry = np.full((N, N), .5, dtype=np.float32)
    libraries = [source_library('outer'), source_library('inner')]
    print('Source reed samples:', [len(x) for x in libraries], flush=True)
    for face in range(2):
        render_face(face, plan, libraries[face], color, height, alpha, dry, allowed)
    # Reconcile tiny subpixel raster differences: the two UV islands represent
    # the same physical cut ends. Both inherit the same opaque silhouette.
    mirrored = alpha[:, :N//2] & alpha[:, N//2:][:, ::-1]
    alpha[:, :N//2] = mirrored
    alpha[:, N//2:] = mirrored[:, ::-1]
    contact = gaussian_filter(frame.astype(np.float32), 3.4)
    distance = distance_transform_edt(~frame)
    edge_contact = np.exp(-distance / 3.5) * (~frame)
    edge_contact[:, N//2:] = 0
    # Flatten local reed bulges beneath the actual geometric frame. Never add
    # pole-shaped positive relief or paint the poles into the albedo.
    softened = gaussian_filter(height, (1, 4))
    height = height * (1 - .28 * contact) + (softened - .45) * .28 * contact
    color *= (1 - .016*contact - .040*edge_contact)[..., None]
    rope, rows = add_cord(color, height, dry, alpha, edges)

    # AO is local concavity, separate from the albedo. Multi-scale gives reed
    # grooves, bundle recesses and the small cord contact their own scale.
    cavity = np.maximum(gaussian_filter(height, 2.1) - height, 0) * .19
    cavity += np.maximum(gaussian_filter(height, 8) - height, 0) * .10
    cavity += np.maximum(gaussian_filter(height, 23) - height, 0) * .035
    ao = np.clip(1 - cavity - .075*contact - .13*edge_contact, .58, 1.)
    roughness = .825 + .057*dry + .018*(1-ao)
    micro = luminance(color) - gaussian_filter(luminance(color), (2, .65))
    roughness += np.clip(np.abs(micro)*.0012, 0, .026) + rope*.025
    roughness = np.clip(roughness, .7, .948)

    # Bleed actual edge texels into ALL invisible RGB, including distant empty
    # space; use 20 px of geometric padding before fading height to neutral.
    distance, nearest = distance_transform_edt(~alpha, return_indices=True)
    color[~alpha] = color[nearest[0][~alpha], nearest[1][~alpha]]
    height[~alpha] = height[nearest[0][~alpha], nearest[1][~alpha]]
    blend = np.clip((distance - 20) / 24, 0, 1)
    blend = blend * blend * (3 - 2*blend)
    height = height * (1 - blend) + 3 * blend
    for a in (ao, roughness):
        a[~alpha] = a[nearest[0][~alpha], nearest[1][~alpha]]
    ao = ao * (1-blend) + blend
    roughness = roughness * (1-blend) + .87*blend

    base = np.dstack((np.rint(color).clip(0, 255).astype(np.uint8), alpha.astype(np.uint8)*255))
    height_u16 = np.rint(np.clip(height / HEIGHT_MM, 0, 1)*65535).astype(np.uint16)
    png(base, 'door_base.png', srgb=True)
    png(height_u16, 'door_height.png')
    # Explicitly reopen delivered height so byte-for-byte normal regeneration
    # can be verified independently by check_material.py.
    reopened = np.asarray(Image.open(ROOT / 'door_height.png'), dtype=np.uint16)
    png(normal_from_height(reopened), 'door_normal.png')
    orm = np.stack((np.rint(ao*255), np.rint(roughness*255), np.zeros_like(ao)), axis=2)
    png(orm.clip(0, 255).astype(np.uint8), 'door_orm.png')
    png((allowed*255).astype(np.uint8), 'checks/guide_reed_footprint.png')
    png((rope*255).clip(0, 255).astype(np.uint8), 'checks/cord_mask.png')
    construction = dict(seed=SEED, size=[N,N], covers_mm=[3000,3000],
                        mm_per_pixel=MM_PER_PX, height_range_mm=[0,HEIGHT_MM],
                        height_used_mm=[float(height[alpha].min()),float(height[alpha].max())],
                        normal_convention='OpenGL: RGB = (-dh/dx, +dh/drow, 1), normalized',
                        outer_bundle_edges_px=edges, reed_count_per_face=len(plan),
                        source_samples=[len(x) for x in libraries],
                        cord_rows_px=rows, reed_plan=plan,
                        generation_metadata='source/generation.json',
                        source_sha256={p.name:hashlib.sha256(p.read_bytes()).hexdigest()
                                       for p in sorted((ROOT/'source').glob('*generated.png'))},
                        build_seconds=time.perf_counter()-start)
    (ROOT/'checks/construction.json').write_text(json.dumps(construction, indent=2)+'\n')
    print(json.dumps({k:v for k,v in construction.items() if k != 'reed_plan'}, indent=2))


if __name__ == '__main__':
    build()
