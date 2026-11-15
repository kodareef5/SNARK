#!/usr/bin/env python3
"""Rebuild the fern atlas from its frozen imagegen originals.

Dependencies: Python 3, Pillow, numpy, scipy. No network or model calls.
All paths are relative to this script. Source originals are never modified.
"""
from pathlib import Path
import hashlib
import json
import numpy as np
from PIL import Image, PngImagePlugin
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'source'
SPEC = json.loads((SOURCE / 'build_spec.json').read_text())
SIZE = SPEC['size']
SCALE = SPEC['scale_px_per_m']
RANGE_MM = SPEC['height_range_mm']
RESAMPLE = Image.Resampling.LANCZOS


def save_png(array, path, srgb=False):
    info = PngImagePlugin.PngInfo()
    if srgb:
        info.add(b'sRGB', b'\x00')
    Image.fromarray(array).save(path, pnginfo=info)


def largest_component(mask):
    labels, count = ndi.label(mask, np.ones((3, 3)))
    if not count:
        raise ValueError('Empty source mask')
    areas = np.bincount(labels.ravel())
    areas[0] = 0
    return labels == areas.argmax()


def fill_small_holes(mask, maximum=36):
    holes = ndi.binary_fill_holes(mask) & ~mask
    labels, _ = ndi.label(holes)
    counts = np.bincount(labels.ravel())
    fill = (counts <= maximum)
    fill[0] = False
    return mask | fill[labels]


def extend_colour(rgb, mask):
    """Nearest real surface colour, including fully transparent texels."""
    indices = ndi.distance_transform_edt(~mask, return_distances=False,
                                        return_indices=True)
    return rgb[indices[0], indices[1]]


def clean_source(element):
    filename = element.get('source_file', element['name'] + '_original.png')
    raw = np.array(Image.open(SOURCE / filename).convert('RGBA'))
    # Generated RGB in transparent pixels is not usable (some has saturated
    # matte colours). Derive the silhouette from alpha, then repair edge RGB.
    mask = raw[:, :, 3] >= 128
    if element.get('matte') == 'white':
        # The targeted tip revision returned a translucent white matte.
        # Chroma separates its leaf/stalk colours from that neutral backdrop.
        rgb_int = raw[:, :, :3].astype(np.int16)
        r, g, b = np.moveaxis(rgb_int, 2, 0)
        mask &= (b < 120) & (g-b > 35) & (r-b > 20)
    mask = largest_component(fill_small_holes(mask))
    before = int(mask.sum())
    yy, xx = np.where(mask)
    box = [int(xx.min()), int(yy.min()), int(xx.max()+1), int(yy.max()+1)]
    x0, y0, x1, y1 = box
    rgb = raw[y0:y1, x0:x1, :3].astype(np.float32)
    mask = mask[y0:y1, x0:x1]
    core = ndi.binary_erosion(mask, iterations=2)
    # Keep stems thinner than the erosion diameter by falling back to mask.
    trustworthy = core if element.get('matte') else core | (mask & (raw[y0:y1, x0:x1, 3] >= 250))
    rgb = np.where(trustworthy[:, :, None], rgb,
                   extend_colour(rgb, trustworthy))
    rgb = extend_colour(rgb, mask)
    return rgb, mask, {'original_size': [raw.shape[1], raw.shape[0]],
                       'source_crop': box, 'source_surface_pixels': before}


def resize_float(arr, size):
    if arr.ndim == 2:
        return np.asarray(Image.fromarray(arr.astype(np.float32)).resize(size, RESAMPLE))
    return np.stack([resize_float(arr[:, :, i], size) for i in range(arr.shape[2])], axis=2)


def make_frond(element):
    rgb, mask, record = clean_source(element)
    # Independent x/y fitting gives the specified botanical width and length;
    # every final pixel then has the same physical size across all cards.
    w = round(element['width_m'] * SCALE) + 1
    h = round(element['length_m'] * SCALE) + 1
    colour = np.clip(resize_float(rgb, (w, h)), 0, 255)
    coverage = np.clip(resize_float(mask.astype(np.float32), (w, h)), 0, 1)
    # Keep antialiasing to the one-pixel silhouette band, with opaque interiors.
    coverage[coverage < .06] = 0
    coverage[coverage > .94] = 1
    solid = coverage >= .5
    coverage[solid & (ndi.distance_transform_edt(solid)>1.5)] = 1
    coverage[~solid & (ndi.distance_transform_edt(~solid)>1.5)] = 0
    support = coverage > 0
    solid = coverage >= .5
    # Remove any detached subpixel specks introduced by resampling.
    connected = largest_component(support)
    coverage *= connected
    support = coverage > 0
    solid = coverage >= .5
    colour = extend_colour(colour, ndi.binary_erosion(solid) | (coverage == 1))
    colour = np.clip(colour, 0, 255)

    # Recovered local colour detail supplies veins, never the whole height.
    luminance = np.sum(colour * np.array([.2126, .7152, .0722]), axis=2) / 255
    vein_detail = ndi.gaussian_filter(luminance, .45) - ndi.gaussian_filter(luminance, 2.1)
    distance = ndi.distance_transform_edt(solid)
    dome = 1 - np.exp(-distance / 4.4)
    yy, xx = np.indices((h, w))

    # Smooth rachis path from the centre of the two leaflet rows. Bare stalk
    # rows are exact; broad blade rows are smoothed over several pinna pairs.
    left = np.where(solid, xx, w).min(axis=1)
    right = np.where(solid, xx, -1).max(axis=1)
    centre = (left + right) / 2
    valid = right >= 0
    centre = np.interp(np.arange(h), np.flatnonzero(valid), centre[valid])
    centre = ndi.gaussian_filter1d(centre, max(3, h*.017))
    radius = np.clip((right-left+1)*.5, 1, 3.8)
    stem = np.exp(-.5*((xx-centre[:, None])/radius[:, None])**2)
    kind = element['kind']
    if kind == 'young':
        # Crosier and stalk are round, rather than flat leaf-blade relief.
        roundness = 1-np.exp(-distance/3.8)
        curl = np.exp(-((yy/h-.085)/.13)**2)
        height = .12 + 1.2*dome + 2.8*roundness + 2.2*curl*roundness
        height += 3.0*vein_detail
    else:
        height = .10 + (1.55 if kind == 'dead' else 1.15)*dome
        height += (1.7 if kind == 'dead' else 1.9)*stem
        height += (5.0 if kind == 'dead' else 3.4)*vein_detail
        if kind == 'dead':
            # Larger correlated corrugations in dry, curled pinnae.
            height += .65*np.tanh((luminance-ndi.gaussian_filter(luminance, 5))*8)
    height = np.maximum(.04, height) * coverage
    height[~support] = 0

    # Occlusion follows local concavity and close pinna/rachis junctions.
    local_height = ndi.gaussian_filter(height, 3)
    concavity = np.clip(local_height-height, 0, 1.5)
    inner = np.exp(-((xx-centre[:, None])/(w*.14))**2)
    neighbours = ndi.gaussian_filter(solid.astype(float), 8)
    ao = np.clip(1-.19*concavity-.13*inner*neighbours, .55, 1)
    rough = element['roughness'] + np.clip(-vein_detail*.35, -.04, .04)
    if element['name'] == 'frond4':
        # Brown margins are drier and rougher than the green blade.
        brown = np.clip((colour[:, :, 0]-colour[:, :, 1]+14)/35, 0, 1)
        rough = rough + .18*brown
    rough = np.clip(rough, .35, .95)
    orm = np.stack([ao, rough, np.zeros_like(ao)], axis=2)
    orm[~support] = [1, 1, 0]
    alpha = np.rint(coverage*255).astype(np.uint8)
    rgba = np.dstack([np.rint(colour).astype(np.uint8), alpha])

    sy, sx = np.where(alpha >= 128)
    bottom = sy.max()
    top = sy.min()
    foot_candidates = sx[sy == bottom]
    tip_candidates = sx[sy == top]
    foot_x = int(foot_candidates[np.argmin(abs(foot_candidates-np.median(foot_candidates)))])
    tip_x = int(tip_candidates[np.argmin(abs(tip_candidates-np.median(tip_candidates)))])
    record.update({'fitted_size': [w, h], 'anchor_local': [foot_x, int(bottom)],
                   'tip_local': [tip_x, int(top)]})
    return rgba, height, np.rint(orm*255).astype(np.uint8), record


def make_periodic(arr, band=70):
    """Blend opposite edge neighbourhoods without mirroring the whole tile."""
    out = arr.copy()
    for i in range(band):
        weight = .5*(1+np.cos(np.pi*i/(band-1)))
        mean = (arr[i]+arr[-i-1])*.5
        out[i] = arr[i]*(1-weight)+mean*weight
        out[-i-1] = arr[-i-1]*(1-weight)+mean*weight
    # Flat seam derivative makes both colour and derived normal wrap exactly.
    seam = (out[0]+out[1]+out[-2]+out[-1])*.25
    out[:2] = seam
    out[-2:] = seam
    return out


def make_bark():
    raw = Image.open(SOURCE/'bark_original.png').convert('RGB')
    # Keep image-space proportions: a narrow slice, not the whole wide image
    # squeezed into 96 pixels. Bark sampling is 2048 / .5 = 4096 px/m.
    crop_w = round(raw.height*96/SIZE)
    x = (raw.width-crop_w)//2
    rgb = np.asarray(raw.crop((x, 0, x+crop_w, raw.height)).resize((96, SIZE), RESAMPLE)).astype(float)
    lum = np.sum(rgb * np.array([.2126, .7152, .0722]), axis=2)/255
    structure = ndi.gaussian_filter(lum, 1.1)
    lo, hi = np.percentile(structure, [3, 97])
    relief = np.clip((structure-lo)/(hi-lo), 0, 1)
    height = make_periodic(1.0+7.5*relief+4*(lum-structure))
    # Move broad dark crevice modulation into AO, retain intrinsic brown grain.
    flat_lum = .65*np.median(lum)+.35*lum
    rgb *= (flat_lum / np.maximum(lum, .01))[:, :, None]
    rgb *= np.array([.90, .94, 1.0])
    rgb = make_periodic(rgb)
    ao = np.clip(.60+.40*relief, .55, 1)
    rough = np.clip(.92-.05*relief, .8, .95)
    orm = make_periodic(np.stack([ao, rough, np.zeros_like(ao)], axis=2))
    rgba = np.dstack([np.rint(np.clip(rgb, 0, 255)).astype(np.uint8),
                     np.full((SIZE, 96), 255, np.uint8)])
    return rgba, height, np.rint(orm*255).astype(np.uint8)


def normals_from_delivered_height(height_u16):
    """OpenGL: image x right; tangent y up, so green is +dH/d(image-y)."""
    physical_m = height_u16.astype(np.float64)/65535*(RANGE_MM/1000)
    gy, gx = np.gradient(physical_m[:, :1952], 1/SCALE, 1/SCALE)
    vector = np.stack([-gx, gy, np.ones_like(gx)], axis=2)
    vector /= np.linalg.norm(vector, axis=2, keepdims=True)
    bark = physical_m[:, 1952:]
    spacing = .5/SIZE
    by = (np.roll(bark, -1, axis=0)-np.roll(bark, 1, axis=0))/(2*spacing)
    bx = np.gradient(bark, spacing, axis=1)
    bvector = np.stack([-bx, by, np.ones_like(bx)], axis=2)
    bvector /= np.linalg.norm(bvector, axis=2, keepdims=True)
    return np.rint((np.concatenate([vector, bvector], axis=1)+1)*127.5).astype(np.uint8)


def build():
    base = np.zeros((SIZE, SIZE, 4), np.uint8)
    height_mm = np.zeros((SIZE, SIZE), np.float64)
    orm = np.empty((SIZE, SIZE, 3), np.uint8)
    orm[:] = [255, 255, 0]
    layout = {'scale_px_per_m': SCALE, 'elements': []}
    records = {}
    for element in SPEC['elements']:
        name = element['name']
        x0, y0, x1, y1 = element['rect']
        if element['kind'] == 'bark':
            rgba, heights, material = make_bark()
            base[:, x0:x1] = rgba
            height_mm[:, x0:x1] = heights
            orm[:, x0:x1] = material
            layout['elements'].append({'name': name, 'role': 'bark',
                                      'rect': element['rect'], 'metres': .5})
            continue
        rgba, heights, material, record = make_frond(element)
        h, w = rgba.shape[:2]
        px = x0+(x1-x0-w)//2
        py = y0+(y1-y0-h)//2
        if min(px-x0, py-y0, x1-px-w, y1-py-h) < 24:
            raise ValueError(f'{name}: insufficient margin')
        base[py:py+h, px:px+w] = rgba
        height_mm[py:py+h, px:px+w] = heights
        orm[py:py+h, px:px+w] = material
        anchor = [px+record['anchor_local'][0], py+record['anchor_local'][1]]
        tip = [px+record['tip_local'][0], py+record['tip_local'][1]]
        metres = float(np.hypot(tip[0]-anchor[0], tip[1]-anchor[1])/SCALE)
        layout['elements'].append({'name': name, 'rect': element['rect'],
                                  'anchor': anchor, 'tip': tip,
                                  'metres': round(metres, 6)})

        # Each rectangle owns its own transparent RGB: 40 px nearest-colour
        # extension, followed by an 8 px blend to that element's mean colour.
        tile = base[y0:y1, x0:x1]
        mask = tile[:, :, 3] > 0
        rgb = tile[:, :, :3].astype(float)
        dist, indices = ndi.distance_transform_edt(~mask, return_indices=True)
        extended = rgb[indices[0], indices[1]]
        mean = rgb[tile[:, :, 3] >= 128].mean(axis=0)
        fade = np.clip((dist-SPEC['edge_bleed_px'])/8, 0, 1)[:, :, None]
        rgb = extended*(1-fade)+mean*fade
        tile[:, :, :3] = np.rint(rgb).astype(np.uint8)
        record['placement'] = [px, py]
        record['mean_colour'] = mean.tolist()
        record['physical_width_m'] = element['width_m']
        records[name] = record

    height_u16 = np.rint(np.clip(height_mm/RANGE_MM, 0, 1)*65535).astype(np.uint16)
    save_png(base, ROOT/'fern_base.png', srgb=True)
    save_png(height_u16, ROOT/'fern_height.png')
    # Read it back: delivered 16-bit quantisation is the source of the normals.
    delivered_height = np.asarray(Image.open(ROOT/'fern_height.png'))
    save_png(normals_from_delivered_height(delivered_height), ROOT/'fern_normal.png')
    save_png(orm, ROOT/'fern_orm.png')
    (ROOT/'layout.json').write_text(json.dumps(layout, indent=2)+'\n')
    provenance = {'height_range_mm': RANGE_MM, 'normal_convention': 'OpenGL +Y',
                  'bark_px_per_m': SIZE/.5, 'elements': records,
                  'sources_sha256': {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                                     for p in sorted(SOURCE.glob('*_original.png'))}}
    (SOURCE/'build_metadata.json').write_text(json.dumps(provenance, indent=2)+'\n')
    print(f'Built four {SIZE}x{SIZE} layers and layout.json from 11 selected frozen sources.')


if __name__ == '__main__':
    build()
