#!/usr/bin/env python3
"""Independent delivered-file checks and reproducible material inspection sheets."""
from pathlib import Path
import hashlib
import json
import struct
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "checks"
N = 2048
MM_PER_PIXEL = 3000 / N
NAMES = ["timber_base", "timber_height", "timber_normal", "timber_orm"]
FONT_PATH = "/System/Library/Fonts/Supplemental/Arial.ttf"


def font(size):
    try:
        return ImageFont.truetype(FONT_PATH, size)
    except OSError:
        return ImageFont.load_default(size=size)


def label(draw, xy, text, size=20, fill=(220, 218, 211)):
    draw.text(xy, text, font=font(size), fill=fill)


def rgb(a):
    if a.ndim == 2:
        return Image.fromarray(np.uint8(np.rint(a / 65535 * 255))).convert("RGB")
    return Image.fromarray(a)


def save_jpg(im, name):
    im.save(OUT / name, quality=94, subsampling=0)


def sheet(images, titles, name, cell=640, columns=4, footer=None):
    rows = (len(images) + columns - 1) // columns
    im = Image.new("RGB", (columns * cell, rows * (cell + 46) + (40 if footer else 0)), (27, 28, 28))
    d = ImageDraw.Draw(im)
    for i, (pic, title) in enumerate(zip(images, titles)):
        x, y = (i % columns) * cell, (i // columns) * (cell + 46)
        im.paste(pic.resize((cell, cell), Image.Resampling.LANCZOS), (x, y + 46))
        label(d, (x + 12, y + 13), title)
    if footer:
        label(d, (12, im.height - 28), footer, 17)
    save_jpg(im, name)


def srgb_decode(x):
    return np.where(x <= .04045, x / 12.92, ((x + .055) / 1.055) ** 2.4)


def srgb_encode(x):
    return np.where(x <= .0031308, x * 12.92, 1.055 * np.maximum(x, 0) ** (1 / 2.4) - .055)


def seam_metrics(a):
    a = a.astype(np.float32)
    if a.ndim == 2:
        a = a[..., None] / 257  # Report height in comparable 0..255 display units.
    result = {}
    for axis, name in ((1, "x"), (0, "y")):
        dif = np.abs(np.diff(a, axis=axis))
        edge = np.abs(np.take(a, 0, axis=axis) - np.take(a, -1, axis=axis))
        per_line = dif.mean(axis=(0, 2) if axis == 1 else (1, 2))
        p95 = float(np.percentile(per_line, 95))
        result[name] = {"wrap_mean_255": float(edge.mean()),
                        "interior_mean_255": float(dif.mean()),
                        "interior_line_p95_255": p95,
                        "wrap_over_p95": float(edge.mean()) / max(p95, 1e-9)}
        assert float(edge.mean()) <= max(p95 * 1.35, .12), (name, result[name])
    return result


def main():
    started = time.perf_counter()
    OUT.mkdir(exist_ok=True)
    maps, checks = {}, {}
    for name in NAMES:
        path = ROOT / (name + ".png")
        im = Image.open(path)
        a = np.asarray(im)
        bit_depth, color_type = struct.unpack("BB", path.read_bytes()[24:26])
        is_h = name == "timber_height"
        assert im.size == (N, N)
        assert bit_depth == (16 if is_h else 8)
        assert color_type == (0 if is_h else 2)
        assert ("icc_profile" in im.info) == (name == "timber_base")
        assert is_h or im.mode == "RGB"
        if name != "timber_base":
            assert "gamma" not in im.info and "srgb" not in im.info
        maps[name] = a
        checks[name] = {"size": list(im.size), "mode": im.mode, "bits": bit_depth,
                        "color_type": color_type, "srgb_profile": "icc_profile" in im.info,
                        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                        "seams": seam_metrics(a)}

    base, height, packed_normal, orm = [maps[k] for k in NAMES]
    mean = base.mean((0, 1))
    assert np.all(np.abs(mean - [118, 92, 66]) <= 8)
    assert not np.any(orm[..., 2])
    assert orm[..., 1].min() / 255 >= .64 and orm[..., 1].max() / 255 <= .91
    assert orm[..., 0].mean() / 255 > .96
    h = height.astype(np.float64) * (10 / 65535)
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * MM_PER_PIXEL)
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) / (2 * MM_PER_PIXEL)
    expected = np.stack([-gx, gy, np.ones_like(h)], axis=-1)
    expected /= np.linalg.norm(expected, axis=-1, keepdims=True)
    decoded = packed_normal.astype(np.float64) * (2 / 255) - 1
    lengths = np.linalg.norm(decoded, axis=-1)
    decoded /= lengths[..., None]
    cos = np.clip(np.sum(decoded * expected, axis=-1), -1, 1)
    angles = np.degrees(np.arccos(cos))
    assert angles.max() < .45
    encoding = np.uint8(np.clip(np.rint((expected * .5 + .5) * 255), 0, 255))
    # Float32 build versus independent float64 calculation can straddle a half LSB.
    max_channel_error = int(np.abs(encoding.astype(int) - packed_normal.astype(int)).max())
    assert max_channel_error <= 1
    fields = np.load(ROOT / "derivation.npz")
    cracks = fields["checks"].astype(np.float32)
    pores = fields["pores"].astype(np.float32)
    coverage = fields["crack_coverage"].astype(np.float32)
    section = fields["crack_section"].astype(np.float32)
    crack_ids = fields["crack_ids"]
    reconstruction = (fields["uncracked_mm"].astype(np.float32) * (1 - section)
                      + fields["crack_floor_mm"].astype(np.float32) * section)
    height_error = float(np.max(np.abs(reconstruction - h)))
    assert height_error < .006
    strong, quiet = coverage > .85, (coverage < .02) & (cracks < .05)
    assert np.mean(orm[..., 0][strong]) < np.mean(orm[..., 0][quiet]) - 35
    assert np.mean(base[strong]) < np.mean(base[quiet]) - 9
    assert np.median(h[strong]) < 1.2
    assert h[strong].min() < h[coverage < .05].min()
    yy, xx = np.mgrid[:N, :N]
    luminance = base[..., 0] * .2126 + base[..., 1] * .7152 + base[..., 2] * .0722
    previous_base = np.asarray(Image.open(OUT / "pre_feedback_01/timber_base.png"))
    previous_luma = previous_base[..., 0] * .2126 + previous_base[..., 1] * .7152 + previous_base[..., 2] * .0722
    tonal_ratio = float(luminance.std() / previous_luma.std())
    assert 1.85 < tonal_ratio < 2.3
    source_records = json.loads((OUT / 'build.json').read_text())
    assert all(.2 <= r['length_m'] <= 1 for r in source_records['open_cracks'])
    assert all(2 <= r['maximum_width_mm'] <= 6 for r in source_records['open_cracks'])
    assert source_records['adze_advance_mm_min_max'][0] >= 79.99
    assert source_records['adze_advance_mm_min_max'][1] <= 150.01
    xline, yline = luminance.mean(0), luminance.mean(1)
    plane_slopes = [float(np.polyfit(np.arange(N) / N, v, 1)[0]) for v in (xline, yline)]
    quadrant_means = [float(luminance[y:y + N // 2, x:x + N // 2].mean())
                      for y in (0, N // 2) for x in (0, N // 2)]
    # Exhaustive scan of the smallest allowed beam footprint at every pixel.
    # This catches blank regions that a dozen random examples could miss.
    window = (round(.1 / 3 * N), round(1 / 3 * N))
    local_mean = ndi.uniform_filter(luminance, size=window, mode="wrap")
    local_square = ndi.uniform_filter(luminance ** 2, size=window, mode="wrap")
    local_std = np.sqrt(np.maximum(local_square - local_mean ** 2, 0))
    min_beam_std = float(local_std.min())
    assert min_beam_std > 4
    grain_ratio = float(np.abs(np.diff(luminance, axis=0)).mean()
                        / np.abs(np.diff(luminance, axis=1)).mean())
    assert grain_ratio > 1.5

    pics = [rgb(maps[k]) for k in NAMES]
    sheet(pics, ["Base colour / sRGB", "Height / 0–10 mm", "Normal / OpenGL", "AO · Roughness · Metalness"],
          "layers.jpg", footer="2048 × 2048 each · 3 × 3 metres · actual delivered map values")
    shifted = [rgb(np.roll(maps[k], (N // 2, N // 2), axis=(0, 1))) for k in NAMES]
    sheet(shifted, ["Base / half offset", "Height / half offset", "Normal / half offset", "ORM / half offset"],
          "offset.jpg", footer="Original texture boundaries now pass through the centre of each square; wrap on both axes.")
    for k in NAMES:
        rgb(np.roll(maps[k], (N // 2, N // 2), axis=(0, 1))).save(OUT / (k + "_offset.png"))

    tile = pics[0].resize((682, 682), Image.Resampling.LANCZOS)
    tiled = Image.new("RGB", (2046, 2046))
    for y in range(3):
        for x in range(3):
            tiled.paste(tile, (682 * x, 682 * y))
    save_jpg(tiled, "tiled3x3.jpg")

    # Actual UV crops at a common scale, with no per-strip colour correction.
    # Their rectangle is the mesh face: no artificial end grain or painted edge.
    rng = np.random.default_rng(82019)
    beam_canvas = Image.new("RGB", (1900, 1650), (176, 172, 160))
    d = ImageDraw.Draw(beam_canvas)
    label(d, (28, 22), "TWELVE BEAM FACES — random wrapped UV cuts against pale stone", 24, (38, 35, 29))
    label(d, (28, 56), "Same scale and colour throughout · horizontal grain · dimensions are in metres", 18, (55, 51, 43))
    beam_records = []
    for i in range(12):
        length = rng.uniform(1, 2)
        tall = rng.uniform(.1, .4)
        w, ht = round(length / 3 * N), round(tall / 3 * N)
        x, y = rng.integers(0, N, 2)
        cut = base[(np.arange(ht)[:, None] + y) % N, (np.arange(w)[None, :] + x) % N]
        cut_ids = crack_ids[(np.arange(ht)[:, None] + y) % N, (np.arange(w)[None, :] + x) % N]
        cut_coverage = coverage[(np.arange(ht)[:, None] + y) % N, (np.arange(w)[None, :] + x) % N]
        ids_present, id_counts = np.unique(cut_ids[cut_coverage > .4], return_counts=True)
        visible_checks = int(np.sum((ids_present > 0) & (id_counts > 12)))
        assert visible_checks >= 3, (i, visible_checks)
        scale = .62
        pic = Image.fromarray(cut).resize((round(w * scale), round(ht * scale)), Image.Resampling.LANCZOS)
        col, row = i % 2, i // 2
        bx, by = 30 + col * 945, 112 + row * 250
        label(d, (bx, by), f"{i + 1:02d}   {length:.2f} × {tall:.2f} m", 19, (45, 41, 34))
        d.rectangle([bx + 4, by + 38, bx + pic.width + 4, by + pic.height + 38], fill=(112, 109, 101))
        beam_canvas.paste(pic, (bx, by + 34))
        beam_records.append({"index": i + 1, "x": int(x), "y": int(y),
                             "width_px": w, "height_px": ht, "length_m": length, "height_m": tall,
                             "luma_std": float(cut.astype(float).mean(2).std()),
                             "visible_drying_checks": visible_checks})
    save_jpg(beam_canvas, "beams.jpg")
    (OUT / "beam_crops.json").write_text(json.dumps(beam_records, indent=2) + "\n")

    # Linear-light diffuse preview. All four lights have identical exposure and
    # elevation. No exaggerated normals, displacement, or direct AO multiplication.
    base_linear = srgb_decode(base.astype(np.float32) / 255)
    lit = []
    for azimuth in (0, 90, 180, 270):
        az = np.radians(azimuth)
        elevation = np.radians(32)
        light = np.array([np.cos(az) * np.cos(elevation),
                          np.sin(az) * np.cos(elevation), np.sin(elevation)])
        cosine = np.clip(np.sum(decoded * light, axis=-1), 0, 1)
        irradiance = .30 + 1.0 * cosine
        result = srgb_encode(base_linear * irradiance[..., None])
        lit.append(Image.fromarray(np.uint8(np.clip(np.rint(result * 255), 0, 255))))
    sheet(lit, ["Light from right", "Light from image top", "Light from left", "Light from image bottom"],
          "relit.jpg", cell=768, columns=2,
          footer="Actual physical normals · light elevation 32° · equal exposure · linear-light diffuse preview")

    # Neutral reflectance isolates the adze shape from oak pigmentation.
    clay = []
    for azimuth in (0, 90, 180, 270):
        az = np.radians(azimuth)
        v = np.array([np.cos(az) * .94, np.sin(az) * .94, .342])
        c = np.clip(np.sum(decoded * v, axis=-1), 0, 1)
        grey = np.uint8(np.clip(srgb_encode(.19 * (.25 + 1.4 * c)) * 255, 0, 255))
        clay.append(Image.fromarray(grey).convert("RGB"))
    sheet(clay, ["Clay / right", "Clay / top", "Clay / left", "Clay / bottom"],
          "relief.jpg", cell=640, columns=2,
          footer="Neutral grey reflectance; 20° light elevation; physical normal strength unchanged.")

    # True height-field visibility at a grazing side light. This is a diagnostic
    # for depth, not a promise that a normal-only engine material self-shadows.
    elev, az = np.radians(22), np.radians(32)
    light = np.array([np.cos(az) * np.cos(elev), np.sin(az) * np.cos(elev), np.sin(elev)])
    obstruction = np.zeros_like(h)
    for step in np.arange(.5, 20, .5):
        sample = ndi.map_coordinates(h, [yy - step * np.sin(az), xx + step * np.cos(az)],
                                     order=1, mode="grid-wrap", prefilter=False)
        obstruction = np.maximum(obstruction, sample - h - step * MM_PER_PIXEL * np.tan(elev) - .08)
    visibility = np.clip(1 - obstruction / .35, 0, 1)
    cosine = np.clip(np.sum(decoded * light, axis=-1), 0, 1)
    irradiance = .26 * (orm[..., 0] / 255) + 1.35 * cosine * visibility
    side_lit = np.uint8(np.clip(srgb_encode(base_linear * irradiance[..., None]) * 255, 0, 255))
    side_canvas = beam_canvas.copy()
    sd = ImageDraw.Draw(side_canvas)
    sd.rectangle((0, 0, side_canvas.width, 88), fill=(176, 172, 160))
    label(sd, (28, 22), "SAME TWELVE FACES — side light at 22° with physical height shadows", 24, (38, 35, 29))
    label(sd, (28, 56), "Actual normal strength · height ray test · AO on ambient only · identical UV crops", 18, (55, 51, 43))
    for i, r in enumerate(beam_records):
        cut = side_lit[(np.arange(r['height_px'])[:, None] + r['y']) % N,
                       (np.arange(r['width_px'])[None, :] + r['x']) % N]
        pic = Image.fromarray(cut).resize((round(r['width_px'] * .62), round(r['height_px'] * .62)), Image.Resampling.LANCZOS)
        side_canvas.paste(pic, (30 + (i % 2) * 945, 112 + (i // 2) * 250 + 34))
    save_jpg(side_canvas, "beams_side_lit.jpg")
    sheet([Image.fromarray(previous_base), pics[0]],
          [f"Previous / luma SD {previous_luma.std():.2f}", f"Revised / luma SD {luminance.std():.2f}"],
          "before_after.jpg", cell=1024, columns=2,
          footer="Same mean sRGB (118, 92, 66); no lighting applied to either base colour.")

    crop_x, crop_y, crop_size = 1110, 1050, 480
    closeups = [pic.crop((crop_x, crop_y, crop_x + crop_size, crop_y + crop_size)) for pic in pics]
    sheet(closeups, ["Base / same crop", "Height / same crop", "Normal / same crop", "ORM / same crop"],
          "detail.jpg", cell=720, footer="Identical 480 × 480 pixel crop enlarged 1.5×; no layer moved independently.")
    fibre = fields["fibre_mm"].astype(np.float32)
    fibre_pic = Image.fromarray(np.uint8(np.clip(128 + fibre * 1700, 0, 255))).convert("RGB")
    diagnostic = [pics[0].crop((crop_x, crop_y, crop_x + 384, crop_y + 384)),
                  fibre_pic.crop((crop_x, crop_y, crop_x + 384, crop_y + 384)),
                  rgb(np.repeat(np.uint8(pores[..., None] * 255), 3, -1)).crop((crop_x, crop_y, crop_x + 384, crop_y + 384))]
    sheet(diagnostic, ["Delivered 2K crop", "Added fibres / amplified", "Added pore coverage"],
          "native_detail.jpg", cell=768, columns=3,
          footer="Procedural submillimetre relief and final-resolution pore detail added after source interpolation.")

    metrics = {"status": "PASS", "files": checks, "mean_srgb": mean.tolist(),
               "mean_target_error": (mean - [118, 92, 66]).tolist(),
               "height_mm_min_max": [float(h.min()), float(h.max())],
               "height_reconstruction_error_mm_max": height_error,
               "normal_angular_error_deg": {"mean": float(angles.mean()),
                   "p99": float(np.percentile(angles, 99)), "max": float(angles.max())},
               "normal_reencoding_max_channel_error": max_channel_error,
               "normal_encoded_vector_length_min_max": [float(lengths.min()), float(lengths.max())],
               "metalness_nonzero_pixels": int(np.count_nonzero(orm[..., 2])),
               "roughness_min_mean_max": [float(orm[..., 1].min() / 255),
                    float(orm[..., 1].mean() / 255), float(orm[..., 1].max() / 255)],
               "ao_min_mean_max": [float(orm[..., 0].min() / 255),
                    float(orm[..., 0].mean() / 255), float(orm[..., 0].max() / 255)],
               "ao_strong_checks_vs_clear": [float(orm[..., 0][strong].mean() / 255),
                                             float(orm[..., 0][quiet].mean() / 255)],
               "broad_gradient_levels_per_tile_xy": plane_slopes,
               "luminance_quadrant_means": quadrant_means,
               "all_small_beam_windows_min_luminance_std": min_beam_std,
               "all_small_beam_windows_size_px": list(window),
               "horizontal_grain_gradient_anisotropy": grain_ratio,
               "native_fibre_rms_mm": float(np.sqrt(np.mean(fibre ** 2))),
               "luminance_std": float(luminance.std()),
               "previous_luminance_std": float(previous_luma.std()),
               "tonal_variation_ratio": tonal_ratio,
               "open_checks_core_height_mm_median": float(np.median(h[strong])),
               "open_checks_core_luminance_mean": float(luminance[strong].mean()),
               "open_checks_depth_mm_median_max": [float(np.median((fields['uncracked_mm'].astype(np.float32) - h)[strong])),
                                                   float(np.max(fields['uncracked_mm'].astype(np.float32) - h))],
               "minimum_visible_checks_in_twelve_beams": min(r['visible_drying_checks'] for r in beam_records),
               "maximum_height_shadow_mm": float(obstruction.max()),
               "beam_crops": beam_records,
               "check_seconds": round(time.perf_counter() - started, 3)}
    (OUT / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n")
    print(json.dumps({k: v for k, v in metrics.items() if k not in ("files", "beam_crops")}, indent=2))


if __name__ == "__main__":
    main()
