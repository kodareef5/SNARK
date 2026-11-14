#!/usr/bin/env python3
"""Rebuild the 3 m, 2K oak material from its retained imagegen source.

Requires Python 3, Pillow, NumPy and SciPy. No network or external assets.
All synthesis, filtering and derivatives after quilting use a periodic domain.
"""
from pathlib import Path
import hashlib
import json
import time

import numpy as np
from PIL import Image, ImageCms, PngImagePlugin
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent
N = 2048
PIXEL_MM = 3000.0 / N
HEIGHT_MM = 10.0
SEED = 149087
TARGET = np.array([118.0, 92.0, 66.0], dtype=np.float32)
TARGET_LUMA_STD = 2 * 10.74197390490129


def blur(a, sigma):
    return ndi.gaussian_filter(a, sigma, mode="wrap")


def lum(a):
    return a[..., 0] * .2126 + a[..., 1] * .7152 + a[..., 2] * .0722


def cut_path(cost):
    """Minimum-cost top-to-bottom seam, with up to 2 pixels of side movement."""
    rows, cols = cost.shape
    prev = cost[0].copy()
    back = np.empty((rows, cols), dtype=np.int16)
    for y in range(1, rows):
        padded = np.pad(prev, 2, constant_values=np.inf)
        candidates = np.stack([padded[2 + k:2 + k + cols] + .03 * abs(k)
                               for k in range(-2, 3)])
        choices = np.argmin(candidates, axis=0)
        back[y] = choices - 2
        prev = cost[y] + np.min(candidates, axis=0)
    path = np.empty(rows, dtype=np.int32)
    path[-1] = np.argmin(prev)
    for y in range(rows - 1, 0, -1):
        path[y - 1] = path[y] + back[y, path[y]]
    return path


def quilt_axis(a, period, overlap):
    """Fold a source overlap into a torus using a feathered minimum-error cut."""
    left, right = a[:, :overlap], a[:, period:period + overlap]
    cost = blur(np.mean((left - right) ** 2, axis=2), (1.2, 1.2))
    cost /= np.mean(cost)
    # Keep room for a smooth transition, and protect the physical wrap samples.
    cost[:, :24] += 1e4
    cost[:, -24:] += 1e4
    path = cut_path(cost)
    d = np.arange(overlap)[None, :] - path[:, None]
    weight = np.clip((d + 12) / 24, 0, 1).astype(np.float32)
    weight = weight * weight * (3 - 2 * weight)
    out = a[:, :period].copy()
    out[:, :overlap] = right * (1 - weight[..., None]) + left * weight[..., None]
    return out, path


def smooth_noise(rng, sigma):
    q = blur(rng.standard_normal((N, N), dtype=np.float32), sigma)
    return q / (q.std() + 1e-8)


def steer(a, slope, sigma, radius):
    """Filter noise along the actual source grain tangent, on the torus."""
    yy, xx = np.mgrid[:N, :N].astype(np.float32)
    out = np.zeros_like(a)
    offsets = np.arange(-radius, radius + 1)
    weights = np.exp(-.5 * (offsets / sigma) ** 2)
    weights /= weights.sum()
    for dx, w in zip(offsets, weights):
        out += w * ndi.map_coordinates(a, [yy + dx * slope, xx + dx],
                                       order=1, mode="grid-wrap", prefilter=False)
    return out


def quiet_knots(a):
    """Replace two strongest swirl landmarks with quiet grain from this source.

    All coordinates refer to the original 1254 square. Donors have no knots or
    conspicuous marks. The broad feather preserves the surrounding grain flow.
    This happens before the shared feature extraction, so all maps inherit it.
    """
    original = a.copy()
    scale = a.shape[0] / 1254
    replacements = [(254, 363, 174, 113, 599, 985),
                    (889, 567, 161, 98, 1024, 963)]
    for cx, cy, ax, ay, donor_x, donor_y in replacements:
        cx, cy, ax, ay, donor_x, donor_y = np.array(
            [cx, cy, ax, ay, donor_x, donor_y]) * scale
        x = np.arange(int(cx - ax), int(cx + ax) + 1)
        y = np.arange(int(cy - ay), int(cy + ay) + 1)
        u, v = (x[None, :] - cx) / ax, (y[:, None] - cy) / ay
        r = np.sqrt(u * u + v * v)
        alpha = np.clip((1 - r) / .42, 0, 1)
        alpha = (alpha * alpha * (3 - 2 * alpha))[..., None]
        target = original[np.ix_(y, x)].copy()
        donor = original[np.ix_(np.rint(y - cy + donor_y).astype(int),
                                np.rint(x - cx + donor_x).astype(int))].copy()
        donor += target.mean((0, 1)) - donor.mean((0, 1))
        a[np.ix_(y, x)] = target * (1 - alpha) + donor * alpha
    return a, replacements


def split_lengths(ridges):
    """Periodic connected ridges classify long splits separately from pores."""
    mask = ndi.maximum_filter1d(ridges > .22, 9, axis=1, mode="wrap")
    labels, count = ndi.label(mask, structure=np.ones((3, 3)))
    parent = np.arange(count + 1)

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def unite(a, b):
        for i, j in zip(a, b):
            if i and j:
                pi, pj = find(i), find(j)
                parent[pi] = pj

    for delta in (-1, 0, 1):
        unite(labels[:, 0], np.roll(labels[:, -1], delta))
        unite(labels[0, :], np.roll(labels[-1, :], delta))
    roots = np.array([find(i) for i in range(count + 1)])
    spans = np.zeros(count + 1, dtype=np.float32)
    for i, sl in enumerate(ndi.find_objects(labels), 1):
        spans[roots[i]] += sl[1].stop - sl[1].start
    weights = np.clip((spans[roots] - 45) / 130, 0, 1) ** 1.4
    weights[0] = 0
    return weights[labels]


def adze_field(rng):
    """Local scalloped hollow cuts in millimetres, with unaligned tool strokes."""
    field = np.zeros((N, N), dtype=np.float32)
    records = []
    # Twenty-six irregular passes, each with independently phased 8–15 cm
    # advances. A pass is a placement guide, not a visible line or plank edge.
    centres = []
    for row in range(26):
        intervals = rng.uniform(80, 150, 26)
        for _ in range(18):
            intervals += (3000 - intervals.sum()) / len(intervals)
            intervals = np.clip(intervals, 80, 150)
        phase_x = rng.uniform(0, N)
        for advance in np.cumsum(intervals) / PIXEL_MM:
            centres.append(((phase_x + advance) % N,
                            ((row + .5) * N / 26 + rng.uniform(-28, 28)) % N))
    for cx, cy in centres:
        ax, ay = rng.uniform(36, 65), rng.uniform(28, 52)
        depth = rng.uniform(.75, 2.8)
        lean = rng.uniform(-.46, .46)
        direction = 1 if rng.uniform() > .20 else -1
        curvature = rng.uniform(.28, .70)
        edge_width = rng.uniform(.12, .24)
        side_width = rng.uniform(.50, .85)
        phase = rng.uniform(0, 2 * np.pi)
        x = np.arange(int(cx - ax * 1.6), int(cx + ax * 1.6) + 1)
        y = np.arange(int(cy - ay * 1.3), int(cy + ay * 1.3) + 1)
        u, v = (x[None, :] - cx) / ax, (y[:, None] - cy) / ay
        u = direction * u + lean * v
        # A shallow inclined floor and a curved blade exit. The cut's back is
        # gradual; its short lip runs across the grain, never across the tile.
        def ease(t):
            t = np.clip(t, 0, 1)
            return t * t * (3 - 2 * t)
        blade = .88 - curvature * v * v + .055 * np.sin(v * 8 + phase) + .025 * np.sin(v * 21 - phase)
        entry = ease((u + 1.1) / 1.35)
        exit_edge = ease((blade - u) / edge_width)
        sides = ease((1 - np.abs(v + .06 * np.sin(u * 6 + phase))) / side_width)
        bowl = depth * entry * exit_edge * sides
        idx = np.ix_(y % N, x % N)
        field[idx] = np.maximum(field[idx], bowl)
        records.append([float(v) for v in (cx, cy, ax, ay, depth, lean, direction,
                                          curvature, edge_width, side_width, phase)])
    # Removes subpixel cusp aliasing; the 2–3 mm hollow and scalloped rims remain.
    return blur(field, .70), records


def drying_checks(slope):
    """Analytical, subpixel-filtered 2–6 mm openings on a wrapped surface.

    Parent lengths are 0.2–1 m; narrower forks inherit their parent's identity.
    Colour coverage and the recessed cross-section share exactly the same path.
    """
    rng = np.random.default_rng(531702)
    coverage = np.zeros((N, N), dtype=np.float32)
    section = np.zeros_like(coverage)
    ids = np.zeros((N, N), dtype=np.uint16)
    records = []
    tangents = blur(slope, (5, 18))

    def deposit(x, centre_y, widths_mm, check_id):
        half = widths_mm / (2 * PIXEL_MM)
        yy = np.arange(int(np.floor(centre_y.min() - half.max() - 2)),
                       int(np.ceil(centre_y.max() + half.max() + 2)) + 1)
        colour = np.zeros((len(yy), len(x)), dtype=np.float32)
        recess = np.zeros_like(colour)
        # Integrate the thin profile across the pixel footprint, rather than
        # rounding a 2 mm opening to an arbitrary integer number of pixels.
        for offset in (-.375, -.125, .125, .375):
            d = np.abs(yy[:, None] + offset - centre_y[None, :])
            colour += np.clip((half[None, :] - d) * 4 + .5, 0, 1) / 4
            t = np.clip((half[None, :] - d) / np.maximum(half[None, :] * .48, .10), 0, 1)
            recess += (t * t * (3 - 2 * t)) / 4
        colour[:, widths_mm < .05] = 0
        recess[:, widths_mm < .05] = 0
        index = np.ix_(yy % N, x % N)
        old = coverage[index]
        ids[index] = np.where(colour > old, check_id, ids[index])
        coverage[index] = np.maximum(old, colour)
        section[index] = np.maximum(section[index], recess)

    for row in range(32):
        for col in range(6):
            check_id = len(records) + 1
            cx = ((col + .5 + rng.uniform(-.43, .43)) * N / 6) % N
            cy = ((row + .5 + rng.uniform(-.42, .42)) * N / 32) % N
            length_m = .2 + .8 * rng.beta(1.4, 2.4)
            length = length_m * 1000 / PIXEL_MM
            width_mm = rng.uniform(2.0, 6.0)
            x = np.arange(int(cx - length / 2), int(cx + length / 2) + 1)
            t = np.clip((x - (cx - length / 2)) / length, 0, 1)
            flow = ndi.map_coordinates(tangents, [np.full(len(x), cy), x],
                                       order=1, mode="grid-wrap", prefilter=False)
            drift = np.cumsum(flow)
            drift -= np.median(drift)
            phase = rng.uniform(0, 2 * np.pi)
            wobble = ndi.gaussian_filter1d(rng.standard_normal(len(x)), 4)
            centre = cy + 11 * np.tanh(drift / 11) + rng.uniform(.6, 2) * np.sin(t * 9 + phase) + wobble * 1.3
            tip = np.minimum(np.clip(t / .10, 0, 1), np.clip((1 - t) / .12, 0, 1))
            lobes = np.zeros_like(t)
            for _ in range(rng.integers(2, 5)):
                lobes += rng.uniform(.5, 1) * np.exp(-.5 * ((t - rng.uniform(.10, .90)) / rng.uniform(.06, .18)) ** 2)
            lobes /= max(lobes.max(), 1e-6)
            edge_wear = ndi.gaussian_filter1d(rng.uniform(.65, 1.0, len(x)), 1.2)
            opening = width_mm * (.10 + .90 * lobes) * tip ** .9 * edge_wear
            opening *= width_mm / max(opening.max(), 1e-6)
            deposit(x, centre, opening, check_id)
            branched = bool(rng.uniform() < .23)
            if branched:
                start = rng.uniform(.30, .60)
                end = min(.97, start + rng.uniform(.18, .42))
                select = (t >= start) & (t <= end)
                bt = (t[select] - start) / (end - start)
                branch_y = centre[select] + rng.choice([-1, 1]) * rng.uniform(5, 17) * bt ** 1.25
                branch_width = opening[select] * rng.uniform(.40, .70) * (1 - bt) ** .6
                deposit(x[select], branch_y, branch_width, check_id)
            records.append({"id": check_id, "cx": float(cx), "cy": float(cy),
                            "length_m": float(length_m), "maximum_width_mm": float(width_mm),
                            "branched": branched})
    return coverage, section, ids, records


def weathered_colour(l, tone, facets, fine_source, fibres, pores, source_checks,
                     crack_coverage):
    """Silver-grey exposed fibre, brown recesses, and 0.2–1 m tonal streaks."""
    rng = np.random.default_rng(742019)
    streak = .72 * smooth_noise(rng, (6, 84)) + .40 * smooth_noise(rng, (16, 180))
    streak -= blur(streak, (55, 180))
    streak /= streak.std()
    raised = np.tanh(fine_source / 18)
    ridge = np.clip((blur(facets, (3, 5)) - facets) / .30, 0, 1)
    wear = np.clip(.32 + .24 * streak + .20 * raised + .16 * ridge - .10 * facets / 2.8, 0, 1)
    # Palette endpoints are reflectance colours, independent of any light vector.
    raw = np.array([97, 65, 34], dtype=np.float32) + wear[..., None] * np.array([66, 81, 98], dtype=np.float32)
    raw += (.65 * tone + 1.55 * fibres - 9 * pores - 4 * source_checks)[..., None]
    delta = raw - raw.mean((0, 1), dtype=np.float64)
    dark = np.array([30, 21, 13], dtype=np.float32)
    weight = np.clip(crack_coverage, 0, 1)[..., None]
    # Solve contrast after adding dark splits, then balance the delivered sRGB
    # values. This doubles luminance standard deviation without drifting mean.
    lo, hi = .35, 2.0
    for _ in range(16):
        gain = (lo + hi) / 2
        colour = (TARGET + delta * gain) * (1 - weight) + dark * weight
        for _ in range(3):
            colour = np.clip(colour, 0, 255)
            colour += TARGET - colour.mean((0, 1), dtype=np.float64)
        if lum(colour).std() < TARGET_LUMA_STD:
            lo = gain
        else:
            hi = gain
    for _ in range(8):
        colour = np.clip(colour, 0, 255)
        colour += TARGET - colour.mean((0, 1), dtype=np.float64)
    return colour.astype(np.float32), wear, ridge, streak, gain


def save_rgb(name, a, srgb=False):
    info = PngImagePlugin.PngInfo()
    info.add_text("Material", "Hewn oak; 3 x 3 m; horizontal grain; repeat XY")
    opts = {"pnginfo": info}
    if srgb:
        opts["icc_profile"] = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    encoded = np.uint8(np.clip(np.rint(a), 0, 255))
    if srgb:
        # Balanced integer rounding makes the delivered whole-image mean exact,
        # changing only a sparse set of pixels by one level near rounding ties.
        for channel in range(3):
            values = encoded[..., channel].copy().reshape(-1)
            residual = int(TARGET[channel]) * values.size - int(values.sum(dtype=np.int64))
            if residual:
                sign = 1 if residual > 0 else -1
                scores = (a[..., channel].reshape(-1) - values) * sign
                scores[(values == 255) if sign > 0 else (values == 0)] = -np.inf
                chosen = np.argpartition(-scores, abs(residual) - 1)[:abs(residual)]
                values[chosen] = values[chosen].astype(np.int16) + sign
                encoded[..., channel] = values.reshape(N, N)
    Image.fromarray(encoded).save(ROOT / name, **opts)


def main():
    started = time.perf_counter()
    rng = np.random.default_rng(SEED)
    (ROOT / "checks").mkdir(exist_ok=True)
    src_path = ROOT / "source/oak_generated_01.png"
    source = Image.open(src_path).convert("RGB")
    overlap = 256
    a = np.asarray(source.resize((N + overlap, N + overlap), Image.Resampling.LANCZOS),
                   dtype=np.float32)
    a, knot_repairs = quiet_knots(a)
    a, seam_x = quilt_axis(a, N, overlap)
    a, seam_y = quilt_axis(a.transpose(1, 0, 2), N, overlap)
    a = a.transpose(1, 0, 2).copy()
    # Distribute the overlap cuts away from the image origin for inspection.
    a = np.roll(a, (713, 419), axis=(0, 1))
    l = lum(a)
    broad = blur(l, (48, 88))
    # Remove broad illumination and compress bright fibre rims without turning
    # the naturally dark pigment inside splits into a lighting contribution.
    fine = l - broad
    tone = 26 * np.tanh(fine / 34) + .18 * (broad - broad.mean())
    chroma = a - l[..., None]
    chroma -= chroma.mean(axis=(0, 1))
    albedo = TARGET + tone[..., None] + .28 * chroma

    # Source structure tensor gives the local tangent of the mostly horizontal
    # fibres, including the grain bending around knots.
    lx = (np.roll(l, -1, 1) - np.roll(l, 1, 1)) * .5
    ly = (np.roll(l, -1, 0) - np.roll(l, 1, 0)) * .5
    jxy, jyy = blur(lx * ly, 5), blur(ly * ly, 5)
    slope = np.clip(-jxy / (jyy + 3), -.65, .65)
    del lx, ly, jxy, jyy, chroma, a

    # Source splits: dark, coherent, elongated structures rather than all dark
    # wood pigment. The broad kernel distinguishes checks from surface patina.
    darkness = blur(l, (4, 22)) - blur(l, (.55, .7))
    ridges = np.clip((darkness - 13) / 24, 0, 1)
    coherence = steer(ridges, slope, 7, 15)
    length_weight = split_lengths(ridges)
    source_pores = blur(ridges * (1 - length_weight), (.55, .5))
    checks = ridges * np.clip((coherence - .05) / .28, 0, 1) * length_weight
    checks = blur(checks, (.55, .5))
    checks = np.clip(checks * 1.35, 0, 1)

    facets, facet_records = adze_field(rng)
    crack_coverage, crack_section, crack_ids, crack_records = drying_checks(slope)
    fibres = steer(blur(rng.standard_normal((N, N), dtype=np.float32), .40), slope, 4.0, 9)
    fibres = np.clip(fibres / fibres.std(), -3, 3)
    impulses = np.zeros((N, N), dtype=np.float32)
    count = 24500
    np.add.at(impulses, (rng.integers(0, N, count), rng.integers(0, N, count)),
              rng.uniform(.6, 1.3, count))
    pores = steer(blur(impulses, .42), slope, 1.55, 4)
    pores = np.clip(pores * 6.0, 0, 1)
    del impulses
    rough_noise = np.clip(smooth_noise(rng, (1.4, 5)), -2, 2)
    fine_source = blur(l, .65) - blur(l, (2.2, 8))
    grain_mm = .26 * np.tanh(fine_source / 20)
    fibre_mm = fibres * .028
    surface_mm = 8.10 - facets + .12 * np.tanh((blur(l, (7, 20)) - broad) / 12)
    uncracked_mm = surface_mm + grain_mm + fibre_mm - 2.6 * checks - .32 * pores - .48 * source_pores
    # Deep open splits terminate near the bottom of the 10 mm range, regardless
    # of whether they cut a raised grain ridge or a pre-existing adze hollow.
    crack_floor_mm = .22 + .16 * np.clip(.5 + fine_source / 50, 0, 1)
    h_mm = uncracked_mm * (1 - crack_section) + crack_floor_mm * crack_section
    assert float(h_mm.min()) > 0 and float(h_mm.max()) < HEIGHT_MM

    # Microdetail is new at 2K, present at precisely the same pixels in colour,
    # displacement, AO and roughness. Facets do not bake a light direction.
    albedo, wear, adze_ridges, streaks, colour_gain = weathered_colour(
        l, tone, facets, fine_source, fibres, pores, checks, crack_coverage)
    save_rgb("timber_base.png", albedo, srgb=True)

    encoded_h = np.uint16(np.rint(h_mm / HEIGHT_MM * 65535))
    info = PngImagePlugin.PngInfo()
    info.add_text("HeightRangeMM", "10")
    info.add_text("TileSizeMeters", "3")
    Image.fromarray(encoded_h).save(ROOT / "timber_height.png", pnginfo=info)
    # The delivered PNG is the authority, not an unquantized in-memory height.
    delivered_h = np.asarray(Image.open(ROOT / "timber_height.png"), dtype=np.float32)
    delivered_h *= HEIGHT_MM / 65535.0
    dx = (np.roll(delivered_h, -1, 1) - np.roll(delivered_h, 1, 1)) / (2 * PIXEL_MM)
    dy = (np.roll(delivered_h, -1, 0) - np.roll(delivered_h, 1, 0)) / (2 * PIXEL_MM)
    normal = np.stack([-dx, dy, np.ones_like(dx)], axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    save_rgb("timber_normal.png", (normal * .5 + .5) * 255)

    concavity = np.maximum(blur(delivered_h, (2, 4)) - delivered_h - .05, 0)
    ao = np.clip(.994 - .20 * checks - .050 * pores - .050 * source_pores - .018 * concavity, .5, 1)
    ao *= 1 - .82 * crack_section ** 1.15
    ray = np.clip((fine_source - 12) / 28, 0, 1)
    rough = np.clip(.785 + .045 * wear + .060 * crack_coverage + .035 * checks + .025 * pores
                    + .020 * source_pores + .013 * rough_noise - .025 * ray - .020 * (facets / 2.8), .65, .90)
    orm = np.stack([ao, rough, np.zeros_like(ao)], axis=-1)
    save_rgb("timber_orm.png", orm * 255)

    # Compact audit fields let the checks inspect registration and detail.
    np.savez_compressed(ROOT / "derivation.npz", checks=checks.astype(np.float16),
                        pores=pores.astype(np.float16), facets_mm=facets.astype(np.float16),
                        fibre_mm=fibre_mm.astype(np.float16),
                        source_luma=l.astype(np.float16),
                        source_pores=source_pores.astype(np.float16),
                        surface_mm=surface_mm.astype(np.float16),
                        grain_mm=grain_mm.astype(np.float16),
                        uncracked_mm=uncracked_mm.astype(np.float16),
                        crack_floor_mm=crack_floor_mm.astype(np.float16),
                        crack_coverage=crack_coverage.astype(np.float16),
                        crack_section=crack_section.astype(np.float16), crack_ids=crack_ids,
                        weathering=wear.astype(np.float16), adze_ridges=adze_ridges.astype(np.float16),
                        seam_x=seam_x, seam_y=seam_y)
    advances = []
    for row in range(26):
        positions = np.sort([r[0] for r in facet_records[row * 26:(row + 1) * 26]])
        advances.extend(np.diff(np.r_[positions, positions[0] + N]) * PIXEL_MM)
    stats = {
        "seed": SEED, "size": N, "tile_size_m": 3, "pixel_mm": PIXEL_MM,
        "height_range_mm": HEIGHT_MM, "source_size": list(source.size),
        "source_sha256": hashlib.sha256(src_path.read_bytes()).hexdigest(),
        "source_resize": N + overlap, "overlap_pixels": overlap,
        "knot_repairs_source_coordinates": knot_repairs,
        "mean_srgb": np.asarray(Image.open(ROOT / "timber_base.png")).mean((0, 1)).tolist(),
        "actual_height_mm_min_max": [float(h_mm.min()), float(h_mm.max())],
        "facet_depth_mm_max": float(facets.max()),
        "adze_advance_mm_min_max": [float(min(advances)), float(max(advances))],
        "checks_fraction_over_0_5": float(np.mean(checks > .5)),
        "open_crack_fraction": float(crack_coverage.mean()),
        "open_crack_count": len(crack_records),
        "open_crack_branches": sum(r['branched'] for r in crack_records),
        "open_cracks": crack_records,
        "colour_gain": colour_gain,
        "target_luminance_std": TARGET_LUMA_STD,
        "actual_luminance_std": float(lum(np.asarray(Image.open(ROOT / 'timber_base.png'), dtype=np.float32)).std()),
        "normal_z_min": float(normal[..., 2].min()),
        "roughness_min_mean_max": [float(rough.min()), float(rough.mean()), float(rough.max())],
        "ao_min_mean_max": [float(ao.min()), float(ao.mean()), float(ao.max())],
        "native_fibre_height_std_mm": float(fibre_mm.std()),
        "adze_strokes": facet_records,
        "build_seconds": round(time.perf_counter() - started, 3),
    }
    (ROOT / "checks/build.json").write_text(json.dumps(stats, indent=2) + "\n")
    print(json.dumps({k: v for k, v in stats.items() if k not in ("adze_strokes", "open_cracks")}, indent=2))


if __name__ == "__main__":
    main()
