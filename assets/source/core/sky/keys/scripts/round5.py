"""Small deterministic colour corrections to the accepted round-four keys.

The archive is the pixel source. Broad smooth sky fields and a land illuminant
change pass through the existing material coverage. Water and celestial pixels
are protected. No source painting or geometry is regenerated.
"""
import json
import shutil
import numpy as np
from PIL import Image
from scipy.ndimage import label
from build_keys import (ROOT, H, W, AZ, EL, HUES, FACE_LEVELS, PHYS,
                        dec, enc, lum, tone_hue, read, smooth, angle, save)
from round3_surfaces import compose_surfaces

ARCHIVE = ROOT / 'rounds/round-4'
SKY_TARGETS = {'noon': ('zenith', [89, 144, 214]),
               'afternoon': ('toward', [239, 226, 203]),
               'dusk': ('toward', [229, 155, 111])}
CARDS = ('lit', 'shaded', 'up')


def sky_weight(k):
    elevation = np.maximum(np.degrees(EL), 0)
    if k['name'] == 'noon':
        # A whole polar cap, clear of the high sun and its complete halo.
        weight = smooth(70, 85, elevation)
        weight *= smooth(12, 16, angle(k['sun']))
    else:
        # A broad sunward haze sector with finite support below 18 degrees.
        around = ((1 + np.cos(AZ - np.radians(k['sun']['heading']))) / 2) ** 2
        weight = around * (1 - smooth(4, 18, elevation))
    return weight


def land_delta(k, base, archived, targets):
    name = k['name']
    levels = [*FACE_LEVELS[name], PHYS[name]['lowPolyUp']]
    previous = {p: tone_hue(h, v) for p, h, v in zip(CARDS, HUES[name], levels)}
    raw = dec(base)
    lo = float(dec(read(base, k['points']['shaded']))[0])
    hi = float(dec(read(base, k['points']['lit']))[0])
    lit_weight = np.clip((lum(raw) - lo) / max(hi - lo, .002), 0, 1)[..., None]
    ratios = {p: dec(targets[p]) / dec(previous[p]) for p in ('lit', 'shaded')}
    gain = np.exp(np.log(ratios['shaded']) * (1 - lit_weight) + np.log(ratios['lit']) * lit_weight)
    corrected = enc(dec(archived) * gain)
    faces = {}
    for p in CARDS:
        point = k['points'][p]
        colour = base[point['y'], point['x']]
        labs, _ = label(np.all(base == colour, axis=-1))
        region = labs == labs[point['y'], point['x']]
        corrected[region] = targets[p]
        faces[p] = {'targetRGB': targets[p], 'wholeFacePixels': int(region.sum())}
    # Other grey cube tops share the face-up illuminant.
    p = k['points']['up']
    neutral = np.all(base == base[p['y'], p['x']], axis=-1)
    labs, _ = label(neutral)
    sizes = np.bincount(labs.ravel())
    corrected[neutral & (sizes[labs] > 500)] = targets['up']
    return corrected - archived, faces


def assemble_round5(k, index):
    name = k['name']
    evidence = json.loads((ARCHIVE / 'reports/key-build.json').read_text())[name]
    if name not in SKY_TARGETS:
        shutil.copy2(ARCHIVE / k['file'], ROOT / k['file'])
        evidence['round5'] = {'unchangedFromRound4': True}
        return evidence
    archived = np.array(Image.open(ARCHIVE / k['file']).convert('RGB'), float)
    base = np.array(Image.open(ROOT / 'base' / k['file']).convert('RGB'), float)
    point, target = SKY_TARGETS[name]
    weight = sky_weight(k)
    # Calibrate the continuous field by its mean, never by a local patch edit.
    shift = np.array(target) - read(archived, k['points'][point])
    sky_delta = weight[..., None] * shift / read(weight[..., None], k['points'][point])[0]
    ground_delta = np.zeros((H, W, 3))
    faces = None
    if name in ('noon', 'afternoon'):
        table = json.loads((ROOT / 'base/table.json').read_text())['keys'][name]
        ground_delta, faces = land_delta(k, base, archived, table)
    delta, _ = compose_surfaces(k, base, sky_delta,
                               water_override=np.zeros_like(sky_delta),
                               foreground_delta=ground_delta)
    out = np.rint(archived + delta).clip(0, 255)
    save(out, ROOT / k['file'])
    evidence['round5'] = {'unchangedFromRound4': False, 'skyPoint': point,
                          'skyBeforeRGB': read(archived, k['points'][point]).tolist(),
                          'skyAfterRGB': read(out, k['points'][point]).tolist(),
                          'skyTargetRGB': target, 'cards': faces,
                          'changedPixels': int(np.any(out != archived, axis=-1).sum())}
    if faces:
        evidence['faces'] = {**evidence['faces'], **faces}
    evidence['geometry'] = 'Round-four pixels plus colour deltas through unchanged original material coverage.'
    return evidence
