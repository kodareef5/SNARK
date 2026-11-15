"""Registered round-three water and silhouette composition.

The archived second-round foreground is immutable. All replacements use the
base raster's material membership / recovered coverage, never a shifted edge.
"""
from pathlib import Path
import json
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, map_coordinates, distance_transform_edt

ROOT = Path(__file__).resolve().parents[1]
LOW = {'dawn', 'golden', 'sunset', 'dusk'}


def decode(c):
    c = np.asarray(c, float) / 255
    return np.where(c <= .04045, c / 12.92, ((c + .055) / 1.055) ** 2.4)


def encode(c):
    c = np.clip(c, 0, 1)
    return 255 * np.where(c <= .0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - .055)


def material_coverage(base):
    h, w = base.shape[:2]
    yy, xx = np.mgrid[:h, :w]
    flat, sea = base[0, 0], base[560, 500]
    # The raster's distant sea is already blended toward flat sky over rows
    # 518..525. Recover that blend at EACH pixel, including one-pixel slivers.
    mix = np.sum((base - sea) * (flat - sea), axis=-1) / np.sum((flat - sea) ** 2)
    residual = np.max(np.abs(base - (sea + mix[..., None] * (flat - sea))), axis=-1)
    sky = np.all(base == flat, axis=-1)
    water = np.all(base == sea, axis=-1)
    horizon = (residual < 1.7) & (yy >= 510) & (yy < 530) & (mix >= -.012) & (mix <= 1.012)
    background = sky | water | horizon
    # Obtain the unoccluded background at each row from a clear ocean sector.
    # This is only the backdrop against which mixed terrain pixels were drawn.
    profile = np.ones(h)
    profile[518:530] = np.median(mix[518:530, 300:600], axis=1).clip(0, 1)
    profile[530:] = 0
    alpha_sky = np.broadcast_to(profile[:, None], (h, w)).copy()
    alpha_sky[background] = np.clip(mix[background], 0, 1)
    source_bg = sea + profile[:, None, None] * (flat - sea)
    source_bg = np.broadcast_to(source_bg, base.shape)
    return sky, water, horizon, background, alpha_sky, source_bg


def water_field(k, base, sky, old, exact_water):
    h, w = base.shape[:2]
    yy, xx = np.mgrid[:h, :w].astype(float)
    depression = np.maximum((yy + .5) * 180 / h - 90, 0)
    sy = np.clip(h - 1 - yy, 0, 511)
    if k['name'] not in LOW:
        # Reconstruct the previous deep-blue water field for newly exposed AA
        # pixels. Every existing solid water pixel is then copied verbatim.
        old_air = old.copy()
        old_air[505:] = old_air[504]
        refl = np.stack([map_coordinates(old_air[..., c], [sy, xx], order=1, mode='nearest') for c in range(3)], -1)
        refl = gaussian_filter(refl, (2, 8, 0), mode='wrap')
        fresnel = .045 + .065 * np.exp(-depression / 4)
        deep = [13, 43, 59] if k['name'] != 'night' else [8, 15, 25]
        water = encode(decode(refl) * fresnel[..., None] + decode(base[560, 500]) * .65 + decode(deep) * .15)
        water[exact_water] = old[exact_water]
        return water
    # Calm-water Fresnel reflectance tends to one at grazing incidence. The
    # reflected direction has the same azimuth and opposite elevation.
    refl = np.stack([map_coordinates(sky[..., c], [sy, xx], order=1, mode='nearest') for c in range(3)], -1)
    refl = gaussian_filter(refl, (1.2, 3.5, 0), mode=('nearest', 'wrap', 'nearest'))
    fresnel = .0204 + .9796 * (1 - np.sin(np.radians(depression))) ** 5
    # Compress the reflected value range for the painter's luminous water.
    # The grazing limit remains one; this is an art grade of the reflection,
    # not a claim that this compressed curve is a dielectric BRDF.
    fresnel = fresnel ** .60
    body = decode([10, 24, 39])
    radiance = decode(refl) * (.94 * fresnel[..., None]) + body * (1 - fresnel[..., None])
    # Small calm ripples break the solar image into horizontal glints centered
    # at the disc's heading. No sunlight path remains after the sun has set.
    if k['sun']['elevation'] >= 0:
        az = 345 + (xx + .5 - w / 2) * 360 / w
        dh = (az - k['sun']['heading'] + 180) % 360 - 180
        width = .28 + .11 * depression
        footprint = np.exp(-.5 * (dh / width) ** 2)
        vertical = np.exp(-.5 * ((depression - k['sun']['elevation']) / max(5, k['sun']['elevation'] * 1.5)) ** 2)
        ripple = (.5 + .5 * np.sin(yy * 2.37 + .65 * np.sin(yy * .37) + dh * 1.6)) ** 9
        sparkle = footprint * vertical * (.035 + .65 * ripple)
        colour = {'dawn': [255, 235, 202], 'golden': [255, 230, 161], 'sunset': [255, 185, 92]}[k['name']]
        radiance += sparkle[..., None] * decode(colour)
    return encode(radiance)


def compose_surfaces(k, base, sky, water_override=None, foreground_delta=None):
    # Round five transfers a signed colour delta through the same coverage.
    # This preserves the archived composite exactly wherever the delta is zero.
    old = (np.array(Image.open(ROOT / 'rounds/round-2' / k['file']).convert('RGB'), float)
           if foreground_delta is None else foreground_delta)
    sky_mask, wm, hm, bg, sky_alpha, source_bg = material_coverage(base)
    water = water_field(k, base, sky, old, wm) if water_override is None else water_override
    new_bg = sky * sky_alpha[..., None] + water * (1 - sky_alpha[..., None])
    out = old.copy()
    out[bg] = new_bg[bg]
    # Recover mixed foreground coverage from locally available source colours.
    # Fully solid land is untouched; only a colour-consistent AA mixture can
    # be recomposited. No dilation, blur or interpolation of geometry occurs.
    dist = distance_transform_edt(~bg)
    edge = (~bg) & (dist <= 2.3)
    interior = (~bg) & (dist > 2.3)
    ey, ex = np.where(edge)
    pixels = base[ey, ex]
    backdrop = source_bg[ey, ex]
    best = np.full(len(ey), np.inf)
    best_alpha = np.ones(len(ey))
    best_foreground = old[ey, ex].copy()
    _, near = distance_transform_edt(~interior, return_indices=True)
    candidates = [(near[0, ey, ex], near[1, ey, ex])]
    for dy, dx in [(0, 3), (0, -3), (3, 0), (-3, 0), (3, 3), (3, -3), (-3, 3), (-3, -3), (0, 5), (0, -5), (5, 0), (-5, 0)]:
        candidates.append((np.clip(ey + dy, 0, base.shape[0] - 1), (ex + dx) % base.shape[1]))
    for cy, cx in candidates:
        fg = base[cy, cx]
        delta = fg - backdrop
        a = np.sum((pixels - backdrop) * delta, axis=-1) / np.maximum(np.sum(delta * delta, axis=-1), 1e-6)
        residual = np.max(np.abs(pixels - (backdrop + a[:, None] * delta)), axis=-1)
        valid = interior[cy, cx] & (a > .015) & (a < .985) & (residual < 1.25)
        choose = valid & (residual < best)
        best[choose] = residual[choose]
        best_alpha[choose] = a[choose]
        best_foreground[choose] = old[cy[choose], cx[choose]]
        # Adjacent terrain samples often belong to the same material at a
        # different brightness (checker / sloped lighting). Solve its gain
        # together with background coverage, rather than rejecting that edge
        # and leaving the old blue water in its antialias fringe.
        ff = np.sum(fg * fg, axis=-1)
        bb = np.sum(backdrop * backdrop, axis=-1)
        fb = np.sum(fg * backdrop, axis=-1)
        fc = np.sum(fg * pixels, axis=-1)
        bc = np.sum(backdrop * pixels, axis=-1)
        det = ff * bb - fb * fb
        gain = (fc * bb - bc * fb) / np.maximum(det, 1e-6)
        back = (bc * ff - fc * fb) / np.maximum(det, 1e-6)
        coverage = 1 - back
        scale = gain / np.maximum(coverage, 1e-6)
        fit_error = np.max(np.abs(pixels - (fg * gain[:, None] + backdrop * back[:, None])), axis=-1)
        score = fit_error + .35 * np.abs(np.log(np.maximum(scale, 1e-6)))
        valid = interior[cy, cx] & (back > .015) & (back < .985) & (scale > .55) & (scale < 1.45) & (fit_error < 1.25) & (det > 100)
        choose = valid & (score < best)
        best[choose] = score[choose]
        best_alpha[choose] = coverage[choose]
        adjusted = old[cy[choose], cx[choose]] * scale[choose, None]
        best_foreground[choose] = (np.clip(adjusted, 0, 255) if foreground_delta is None else adjusted)
    selected = np.isfinite(best)
    alpha = best_alpha[selected, None]
    out[ey[selected], ex[selected]] = best_foreground[selected] * alpha + new_bg[ey[selected], ex[selected]] * (1 - alpha)
    changed_edges = np.zeros(bg.shape, bool)
    changed_edges[ey[selected], ex[selected]] = True
    if foreground_delta is None:
        np.savez_compressed(ROOT / 'reports' / f"{k['name']}-surface-masks.npz", background=bg, sky=sky_mask, water=wm, horizon=hm, mixedEdge=changed_edges)
    return out, {'pureSkyPixels': int(sky_mask.sum()), 'pureWaterPixels': int(wm.sum()), 'horizonMixtures': int(hm.sum()), 'recompositedForegroundEdgePixels': int(selected.sum()), 'preservedLandPixels': int((~bg & ~changed_edges).sum()), 'waterTreatment': 'grazing Fresnel sky reflection and angular solar glitter' if k['name'] in LOW else 'round-two deep water retained', 'sourceCoverageMaxResidual': float(best[selected].max()) if selected.any() else 0}
