"""Round four colour, celestial projection and water, with registered coverage.

The moon file is read on every build. No generated land or generated disc is
used. The unmodified round-three air is retained outside celestial edits.
"""
from pathlib import Path
import hashlib
import json
import math
import numpy as np
from PIL import Image
from scipy.interpolate import PchipInterpolator
from scipy.ndimage import map_coordinates
from build_keys import (ROOT, W, H, YY, XX, AZ, EL, DIR, META, SUN_RGB,
                        dec, enc, smooth, read, vec, angle, save,
                        source_sky, paint_sky)
from round3_surfaces import material_coverage, water_field, compose_surfaces

DAY = {
    'morning': [[90, 155, 230], [75, 145, 225], [235, 229, 211], [181, 216, 229]],
    'noon': [[78, 144, 222], [60, 130, 215], [211, 230, 237], [184, 216, 236]],
    'afternoon': [[100, 155, 218], [85, 145, 210], [240, 225, 199], [183, 213, 229]],
}
SKY_POINTS = ['zenith', 'high', 'toward', 'away']
# The game's moon illuminant is slightly warm in linear RGB, from physical.py.
# Exposure controls its strength separately. Twilight extinction warms it more.
MOON_LIGHT = np.array([1.0, .94, .84])


def day_air(k, index):
    n = k['name']
    path = ROOT / 'originals/13-noon-round-4.png' if n == 'noon' else None
    bg, detail, cf, source = source_sky(k, index, edited=(n == 'afternoon'), source_path=path)
    z, high, toward, away = np.array(DAY[n], float)
    elevation = np.maximum(np.degrees(EL), 0)
    # A broad cobalt basin at 20..40 degrees, softening upward and into haze.
    anchors = [0, 3, 20, 30, 40, 65, 87, 90]
    colours = [away + [5, 5, 3], away, high + [7, 9, 7], high,
               high + [1, 2, 2], z - [4, 3, 1], z, z]
    sky = PchipInterpolator(anchors, colours)(elevation)
    azimuth = ((1 + np.cos(AZ - math.radians(k['sun']['heading']))) / 2) ** 3
    low = np.exp(-(elevation / 14) ** 1.4)
    sky += (toward - away) * (azimuth * low)[..., None]
    # Broad atmospheric scattering brightens the sun's side. The compact
    # emitting body's halo is a separate layer with explicit point clearance.
    airglow = np.exp(-.5 * (angle(k['sun']) / 28) ** 2)
    sky += airglow[..., None] * np.array([32, 29, 19])
    sky = .85 * sky + .15 * bg
    # Whole-dome controls retain small source variations and exact target means.
    ys = np.array([0, 17, 341, 494, 525, 1023])
    elevweight = (1 - np.sin(np.maximum(EL, 0))) ** 2
    aw = ((1 + np.cos(AZ - math.radians(k['sun']['heading']))) / 2) ** 2
    ptweight = ((1 + math.cos(math.radians(15))) / 2) ** 2 * (1 - math.sin(math.radians(3))) ** 2
    for _ in range(3):
        delta = np.array(DAY[n]) - np.array([read(sky, k['points'][p]) for p in SKY_POINTS])
        dd = np.array([delta[0], delta[0], delta[1], delta[3], delta[3], delta[3]])
        sky += PchipInterpolator(ys, dd)(np.arange(H))[:, None, :]
        sky += (delta[2] - delta[3]) * (aw * elevweight / ptweight)[..., None]
    if n == 'noon':
        # Keep the broad minimum around the high point, rather than allowing
        # the painted source to carry a second dark shelf up to 50 degrees.
        opposite = ((1 - np.cos(AZ - math.radians(k['sun']['heading']))) / 2) ** 2
        upper = smooth(30, 50, elevation) * (1 - smooth(55, 87, elevation))
        sky += (opposite * upper)[..., None] * np.array([12, 11, 6])
    sky += detail * .8
    sky[0] = sky[0].mean(axis=0)
    np.savez_compressed(ROOT / 'reports' / f'{n}-cloud-mask.npz', mask=(cf > .001))
    return np.clip(sky, 0, 255), source


def place_bodies(k, air):
    sky = air.copy()
    clear = np.ones((H, W))
    for p in SKY_POINTS:
        # Enclose the complete 13x13 reading square, with a soft transition.
        clear *= smooth(1.7, 2.7, angle(k['points'][p]))
    glow_mask = np.zeros((H, W), bool)
    bodies = []
    for body, diameter in [('sun', 2.0), ('moon', 4.0)]:
        p = k[body]
        if p['elevation'] < -diameter / 2:
            continue
        if body == 'moon' and k['name'] not in ('sunset', 'dusk', 'night'):
            continue
        d = angle(p)
        radius = diameter / 2
        if body == 'sun':
            rgb = np.array(SUN_RGB[k['name']], float)
            # A luminous core, then a soft spherical skirt, with finite support.
            halo = (.25 * np.exp(-.5 * (d / 2.3) ** 2) +
                    .055 * np.exp(-.5 * (d / 4.5) ** 2)) * (1 - smooth(9, 12, d))
            halo *= clear
            sky = enc(dec(sky) * (1 - halo[..., None]) + dec(rgb) * halo[..., None])
            alpha = 1 - smooth(radius - .11, radius + .11, d)
            limb = 1 - .07 * np.clip(d / radius, 0, 1) ** 4
            disc = enc(dec(rgb) * limb[..., None])
        else:
            rgb = enc(MOON_LIGHT * (.86 if k['name'] == 'night' else .83))
            if k['name'] == 'night':
                halo = (.10 * np.exp(-.5 * (d / 2.8) ** 2) +
                        .035 * np.exp(-.5 * (d / 7) ** 2)) * (1 - smooth(14, 19, d))
            elif k['name'] == 'dusk':
                # Keep this halo naturally inside the clear space between the
                # 4-degree face and the rose-band sample five degrees below.
                halo = .13 * np.exp(-.5 * (d / 2) ** 2) * (1 - smooth(2.7, 3.5, d))
            else:
                halo = .09 * np.exp(-.5 * (d / 1.5) ** 2) * (1 - smooth(2.3, 3.0, d))
            halo *= clear
            sky = enc(dec(sky) * (1 - halo[..., None]) + dec(rgb) * halo[..., None])
            # Tangent-plane UVs, image top toward celestial/local north, no
            # mirroring. Equirectangular stretching follows the sphere itself.
            f = vec(p['heading'], p['elevation'])
            right = vec(p['heading'] + 90, 0)
            up = np.cross(right, f)
            denom = np.maximum(np.sum(DIR * f, axis=-1), 1e-6)
            u = np.sum(DIR * right, axis=-1) / denom / math.tan(math.radians(radius))
            v = np.sum(DIR * up, axis=-1) / denom / math.tan(math.radians(radius))
            moon_path = ROOT.parent / 'moon/moon.png'
            # Premultiply before reducing, avoiding a dark transparent fringe.
            texture = np.array(Image.open(moon_path).convert('RGBA'), float) / 255
            premul = texture.copy()
            premul[..., :3] *= premul[..., 3:]
            mip = np.stack([np.array(Image.fromarray(premul[..., c].astype('float32'), mode='F').resize((32, 32), Image.Resampling.LANCZOS)) for c in range(4)], -1)
            sx = (u + 1) * 16 - .5
            sy = (1 - v) * 16 - .5
            tex = np.stack([map_coordinates(mip[..., c], [sy, sx], order=1, mode='constant', cval=0) for c in range(4)], -1)
            alpha = np.clip(tex[..., 3], 0, 1) * (1 - smooth(radius - .08, radius + .08, d))
            face = np.clip(tex[..., :3] / np.maximum(tex[..., 3:], 1e-6), 0, 1)
            disc = enc(dec(face * 255) * MOON_LIGHT * (.95 if k['name'] == 'night' else 1.0))
        sky = sky * (1 - alpha[..., None]) + disc * alpha[..., None]
        glow_mask |= halo > 0
        area = np.where(alpha > .5)
        entry = {'body': body, 'heading': p['heading'], 'elevation': p['elevation'],
                 'diameterDegrees': diameter, 'angularHeightPixels': diameter * H / 180,
                 'centreFromAngles': [((p['heading'] - 345 + 180) % 360) / 360 * W - .5,
                                      (90 - p['elevation']) / 180 * H - .5],
                 'alphaPixels': int((alpha > .5).sum()),
                 'rasterBounds': [int(area[1].min()), int(area[0].min()), int(area[1].max()), int(area[0].max())],
                 'haloMaxAtSamples': {pn: float(read(halo[..., None], k['points'][pn])[0]) for pn in SKY_POINTS}}
        if body == 'moon':
            entry.update(texture='../moon/moon.png', textureSHA256=hashlib.sha256(moon_path.read_bytes()).hexdigest(),
                         northUp=True, lightLinearRGB=MOON_LIGHT.tolist())
        bodies.append(entry)
    sky[0] = sky[0].mean(axis=0)
    return sky, bodies, glow_mask


def revised_water(k, original, air):
    water = original.copy()
    depression = np.maximum(-np.degrees(EL), 0)
    if k['name'] == 'dawn':
        # Far water is lilac blue air; reflection darkens as the eye looks down.
        sample_e = np.clip(8 + depression * 1.35, 0, 89)
        sy = (90 - sample_e) / 180 * H - .5
        reflected = np.stack([map_coordinates(air[..., c], [sy, XX], order=1, mode='nearest') for c in range(3)], -1)
        cool = reflected * np.array([.94, .97, 1.02])
        fresnel = .0204 + .9796 * (1 - np.sin(np.radians(depression))) ** 5
        radiance = dec(cool) * fresnel[..., None] * .85 + dec([28, 63, 99]) * (1 - fresnel[..., None])
        away = (1 - np.cos(AZ - math.radians(k['sun']['heading']))) / 2
        blend = smooth(.15, .85, away)
        water = water * (1 - blend[..., None]) + enc(radiance) * blend[..., None]
    if k['name'] in ('sunset', 'dusk', 'night'):
        dh = (np.degrees(AZ) - k['moon']['heading'] + 180) % 360 - 180
        if k['name'] == 'night':
            width = 16 + .75 * depression
            footprint = np.exp(-.5 * (dh / width) ** 2)
            vertical = .45 + .55 * (1 - np.exp(-depression / 10))
            ripple = (.5 + .5 * np.sin(YY * 1.83 + .45 * np.sin(dh * .7))) ** 6
            silver = footprint * vertical * (.045 + .04 * ripple)
        else:
            width = 1.4 + .25 * depression
            footprint = np.exp(-.5 * (dh / width) ** 2)
            vertical = np.exp(-.5 * ((depression - max(0, k['moon']['elevation'])) / 13) ** 2)
            ripple = (.5 + .5 * np.sin(YY * 2.17 + .55 * np.sin(YY * .29) + dh * 1.5)) ** 8
            silver = footprint * vertical * (.025 + .35 * ripple)
        water = enc(dec(water) + silver[..., None] * MOON_LIGHT)
    return water


def assemble_round4(k, index):
    n = k['name']
    base = np.array(Image.open(ROOT / 'base' / k['file']).convert('RGB'), float)
    archived = np.array(Image.open(ROOT / 'rounds/round-3' / k['file']).convert('RGB'), float)
    old2 = np.array(Image.open(ROOT / 'rounds/round-2' / k['file']).convert('RGB'), float)
    oldsky, ev = paint_sky(k, index)
    _, wm, _, _, _, _ = material_coverage(base)
    oldwater = water_field(k, base, oldsky, old2, wm)
    if n in DAY:
        air, source = day_air(k, index)
        ev.update(source=str(source.relative_to(ROOT)), nativeSize=list(Image.open(source).size),
                  sha256=hashlib.sha256(source.read_bytes()).hexdigest(), targets=DAY[n])
    else:
        air, _ = paint_sky(k, index, include_bodies=False)
    sky, bodies, glow = place_bodies(k, air)
    if n not in DAY:
        # Fade the delta to zero at finite angular bounds. This also retains
        # single quantisation levels in the old halo's vanishing Gaussian tail.
        edit = np.zeros((H, W))
        for b in bodies:
            limit = 16 if b['body'] == 'sun' else (50 if n == 'night' else 19)
            edit = np.maximum(edit, 1 - smooth(limit - 3, limit, angle(k[b['body']])))
        sky = oldsky + (sky - oldsky) * edit[..., None]
    # Exact unchanged air outside the region altered by old or new celestial
    # overlays. The archived image remains the source of all solid terrain.
    celestial_changes = np.any(np.rint(sky) != np.rint(oldsky), axis=-1) if n not in DAY else np.zeros((H, W), bool)
    water = revised_water(k, oldwater, air)
    out, surfaces = compose_surfaces(k, base, sky, water_override=water)
    save(out, ROOT / k['file'])
    np.savez_compressed(ROOT / 'reports' / f'{n}-round4-masks.npz', celestialChanges=celestial_changes,
                        newGlow=glow, waterChanges=np.any(np.rint(water) != np.rint(oldwater), axis=-1))
    ev.update(bodies=bodies, surfaces=surfaces, geometry='Original base coverage with unchanged round-three solid terrain and complete grey faces.')
    ev['faces'] = json.loads((ROOT / 'rounds/round-3/reports/key-build.json').read_text())[n]['faces']
    ev['round4'] = {'approvedAirPreserved': n not in DAY, 'celestialSkyPixels': int(celestial_changes.sum()),
                     'waterTreatment': 'lilac blue reflection with shoreward darkening' if n == 'dawn' else
                     'silver moon path' if n in ('sunset', 'dusk') else
                     'broad silver moon sheen' if n == 'night' else 'round-three water retained'}
    return ev
