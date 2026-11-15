#!/usr/bin/env python3
"""Validate the final atlas and reproduce it from only its active source inputs.

No archived delivery or comparison baseline is needed. Review renders are
texture-space diagnostics, using mean-scaled dye and approximate material light.
"""
from pathlib import Path
import hashlib
import json
import math
import shutil
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as nd
from scipy.spatial import ConvexHull

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'source'
OUT = ROOT / 'checks'
LAYERS = ['base', 'height', 'normal', 'orm', 'regions']
COLORS = {'red': [207, 43, 42], 'deep_blue': [35, 58, 137],
          'violet': [127, 64, 161], 'yellow_orange': [236, 161, 38],
          'near_black': [21, 24, 32], 'white': [238, 238, 224]}
RETAINED = ('fallen1', 'stripped1', 'stripped2')


def byte(a):
    return np.clip(np.rint(a), 0, 255).astype(np.uint8)


def save_json(path, obj):
    path.write_text(json.dumps(obj, indent=2) + '\n')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def over(rgba, background):
    alpha = rgba[..., 3:4].astype(float) / 255
    return Image.fromarray(byte(rgba[..., :3] * alpha + np.asarray(background) * (1-alpha)))


def raw_resize(rgba, size):
    # Average unassociated channels, including padding, like atlas mip filtering.
    return np.stack([np.asarray(Image.fromarray(rgba[..., i]).resize(size, Image.Resampling.BOX))
                     for i in range(4)], -1)


def labelled_sheet(panels, columns, thumb, filename):
    w, h = thumb
    sheet = Image.new('RGB', (columns*w, math.ceil(len(panels)/columns)*(h+30)), (26, 29, 31))
    draw = ImageDraw.Draw(sheet)
    for i, (label, image) in enumerate(panels):
        x, y = (i % columns)*w, (i // columns)*(h+30)
        fitted = image.copy()
        fitted.thumbnail((w, h), Image.Resampling.LANCZOS)
        sheet.paste(fitted, (x+(w-fitted.width)//2, y+30))
        draw.text((x+10, y+9), label, fill=(228, 235, 232))
    sheet.save(OUT / filename, quality=94)


def normal_expected(height):
    z = height.astype(np.float64)/65535*16
    sy, sx = np.gradient(z, 1000/1300)
    bark = z[:, 1952:]
    sx[:, 1952:] = np.gradient(bark, 1000/1300, axis=1)
    by = (np.roll(bark, -1, axis=0)-np.roll(bark, 1, axis=0))/(2*600/2048)
    by[0] = by[-1] = (bark[1]-bark[-2])/(2*600/2048)
    sy[:, 1952:] = by
    expected = np.stack([-sx, sy, np.ones_like(z)], axis=-1)
    return expected/np.linalg.norm(expected, axis=-1, keepdims=True)


def illuminate(base, normal, orm, light):
    n = normal.astype(float)/255*2-1
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    light = np.array(light, float)
    light /= np.linalg.norm(light)
    lambert = np.maximum(np.sum(n*light, axis=-1), 0)
    half = light+[0, 0, 1]
    half /= np.linalg.norm(half)
    rough = orm[..., 1]/255
    spec = np.maximum(np.sum(n*half, axis=-1), 0)**(8+100*(1-rough)**3)
    linear = (base[..., :3]/255)**2.2
    # AO attenuates ambient illumination only. This is an offline approximation.
    illumination = .26*(orm[..., 0]/255)+.84*lambert
    lit = linear*illumination[..., None]+(.04*(1-rough)*spec)[..., None]
    return np.dstack([byte(np.maximum(lit, 0)**(1/2.2)*255), base[..., 3]])


def dye(base, region, colour):
    result = base.copy()
    # Region-0 mean scaling precedes clipping and lighting. Glints are excluded.
    mean = base[region, :3].mean(axis=0)
    scaled = base[region, :3]*np.array(colour)/mean
    result[region, :3] = byte(scaled)
    return result, dict(target=colour, region_mean_before=mean.tolist(),
                       mean_before_clipping=scaled.mean(axis=0).tolist(),
                       mean_after_clipping=result[region, :3].mean(axis=0).tolist(),
                       clipped_channel_share=float(np.mean(scaled > 255)))


def source_inputs():
    """Minimal build inputs, including the originals behind retained crops."""
    originals = [f'{name}_original.png' for name in
                 [*[f'spray{i}' for i in range(1, 7)], 'inner1', 'inner2',
                  *[f'bunch{i}' for i in range(1, 4)], *[f'leaf{i}' for i in range(1, 4)],
                  *RETAINED, 'bark']]
    settings = ['annotations.json', 'bunch_annotations.json', 'berry_base.json',
                'packed_materials.json', 'preserved/geometry.json']
    crops = [f'preserved/{name}_{layer}.png' for name in RETAINED
             for layer in ('base', 'height', 'orm')]
    return [Path('source') / name for name in originals+settings+crops]


def verify_rebuild(require):
    """Build in an empty directory: cached elements cannot conceal dependencies."""
    inputs = source_inputs()
    missing = [str(p) for p in inputs if not (ROOT/p).is_file()]
    require(not missing, f'Missing build inputs: {missing}')
    if missing:
        return dict(passed=False, missing=missing)
    with tempfile.TemporaryDirectory(prefix='bush-atlas-check-') as directory:
        clean = Path(directory)
        shutil.copy2(ROOT/'build_atlas.py', clean/'build_atlas.py')
        for path in inputs:
            (clean/path).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT/path, clean/path)
        run = subprocess.run([sys.executable, str(clean/'build_atlas.py')], cwd=clean,
                             capture_output=True, text=True, timeout=180)
        require(run.returncode == 0, f'Clean rebuild failed: {run.stderr}')
        if run.returncode:
            return dict(passed=False, stdout=run.stdout, stderr=run.stderr)
        generated = sorted({p.relative_to(clean) for p in clean.rglob('*') if p.is_file()}
                           - set(inputs) - {Path('build_atlas.py')})
        comparisons = {}
        for path in generated:
            actual = digest(ROOT/path) if (ROOT/path).is_file() else None
            rebuilt = digest(clean/path)
            comparisons[str(path)] = dict(delivered=actual, rebuilt=rebuilt, equal=actual == rebuilt)
            require(actual == rebuilt, f'Clean rebuild differs: {path}')
        # Prompts and documentation are intentionally retained alongside inputs.
        documents = {Path('source')/p for p in ('README.md', 'requirements.txt', 'prompts.json',
                     'bunch_prompts.json', 'inner1_edit.json', 'original_prompts.json')}
        for path in documents:
            require((ROOT/path).is_file(), f'Missing provenance/documentation: {path}')
        allowed = set(inputs) | set(generated) | documents
        unused = sorted(str(p.relative_to(ROOT)) for p in SOURCE.rglob('*')
                        if p.is_file() and p.relative_to(ROOT) not in allowed)
        require(not unused, f'Unused source files: {unused}')
        result = dict(passed=all(v['equal'] for v in comparisons.values()) and not unused,
                      isolated_build=True, inputs=[str(p) for p in inputs],
                      compared_files=comparisons, unused_source_files=unused)
        save_json(OUT/'rebuild_verification.json', result)
        return result


def validate_fruit(entry, arrays, rect, require):
    """Reconstruct visible ownership and spherical height independently."""
    name = entry['name']
    x0, y0, x1, y1 = rect
    base, height, normal, orm, regions = [arrays[k][y0:y1, x0:x1] for k in LAYERS]
    yy, xx = np.indices(base.shape[:2])
    ids = np.zeros(base.shape[:2], np.uint16)
    scar = np.zeros(ids.shape, bool)
    unripe = np.zeros(ids.shape, bool)
    expected_z = np.zeros(ids.shape)
    for i, b in enumerate(entry['berries']):
        distance = np.hypot(xx-b['x'], yy-b['y'])
        mask = distance <= b['r']+.40
        ids[mask] = i+1
        unripe[mask] = b['unripe']
        scar[mask] = ((np.hypot(xx-(b['x']+b['r']*.21), yy-(b['y']+b['r']*.28))
                       < max(.75, b['r']*.17)) & b.get('calyx', True))[mask]
        expected_z[mask] = (b.get('depth_mm', 5.2+(i % 4)*.21)
                           + np.sqrt(np.maximum(b['r']**2-distance[mask]**2, 0))*1000/1300)
        limits = (.008, .012) if name.startswith('bunch') else (.011, .014)
        require(limits[0] <= 2*b['r']/1300 <= limits[1], f'{name}: invalid berry diameter')
    exported = np.asarray(Image.open(SOURCE/'elements'/f'{name}_berry_ids.png'))
    require(np.array_equal(ids, exported), f'{name}: berry ownership differs from spheres')
    fruit = ids > 0
    ripe = fruit & ~unripe
    glints = np.zeros(ids.shape, bool)
    body_stats = []
    for i, b in enumerate(entry['berries']):
        owner = ids == i+1
        if b['unripe']:
            rgb = np.array([118+(i % 3)*8, 139+(i % 2)*6, 57])
            expected = np.broadcast_to(rgb, base[..., :3].shape).copy()
            expected[scar] = byte(rgb*.85)
            require(np.array_equal(base[owner, :3], expected[owner]), f'{name}: wrong unripe colour')
            continue
        require(owner.any(), f'{name}: invisible ripe berry {i+1}')
        expected_scar = round((84+[-2, 0, 2][i % 3])*.85)
        require(np.all(base[owner & scar, :3] == expected_scar), f'{name}: wrong calyx grey')
        if b.get('calyx', True):
            gx = round(b['x']-.28*b['r'])
            gy = round(b['y']-.34*b['r'])
            points = [(gy, gx), (gy, gx+1), (gy+1, gx)]
            require(all(owner[q] and not scar[q] and base[q][3] == 255 for q in points),
                    f'{name}: catchlight not on its opaque berry body')
            for q in points:
                glints[q] = True
            require(all(230 <= int(base[q][0]) <= 245 for q in points),
                    f'{name}: catchlight outside near-white range')
        body = owner & ~scar & ~glints
        values = base[body, 0]
        require(values.size > 0 and values.min() >= 55 and values.max() <= 170,
                f'{name}: body/bloom outside grey range')
        u, v = (xx-b['x'])/b['r'], (yy-b['y'])/b['r']
        top = body & (np.abs(u+.18) < .30) & (v >= -.85) & (v < -.50)
        cap = body & (np.abs(u) < .75) & (v >= -.80) & (v < -.20)
        upper_half = body & (v < 0)
        lower_half = body & (v >= 0)
        middle = body & (np.abs(u) < .35) & (v >= .15) & (v < .35)
        bottom = body & (np.abs(u) < .40) & (v > .85)
        # A rear sphere may have its bright cap or lower edge hidden by fruit.
        if top.any():
            require(150 <= base[top, 0].max() <= 170, f'{name}: missing upper bloom on berry {i+1}')
        if cap.any():
            require(base[cap, 0].mean() >= 125, f'{name}: upper bloom is too narrow on berry {i+1}')
        if upper_half.any() and lower_half.any():
            require(base[upper_half, 0].mean() >= base[lower_half, 0].mean()+30,
                    f'{name}: insufficient upper/lower contrast on berry {i+1}')
        if middle.any():
            require(75 <= base[middle, 0].mean() <= 85, f'{name}: incorrect body grey')
        if bottom.any():
            require(55 <= base[bottom, 0].mean() <= 65, f'{name}: missing darker lower rim')
        body_stats.append(dict(id=i+1, minimum=int(values.min()), maximum=int(values.max()),
                               visible_pixels=int(owner.sum()), facing=b.get('calyx', True),
                               cap_mean=float(base[cap, 0].mean()) if cap.any() else None,
                               upper_half_mean=float(base[upper_half, 0].mean()) if upper_half.any() else None,
                               lower_half_mean=float(base[lower_half, 0].mean()) if lower_half.any() else None))
    require(np.all(base[ripe, :3] == base[ripe, 0, None]), f'{name}: ripe albedo is not neutral')
    require(np.array_equal(regions[..., 0] == 255, ripe & ~glints),
            f'{name}: region 0 must contain ripe berries, excluding only catchlights')
    require(np.all(np.abs(orm[glints, 1]/255-.35) <= 1/255), f'{name}: catchlight roughness')
    ordinary = fruit & ~glints
    require(np.all((orm[ordinary, 1]/255 >= .62) & (orm[ordinary, 1]/255 <= .70)),
            f'{name}: ordinary berry roughness outside .62-.70')
    error = int(np.max(np.abs(height[fruit].astype(int)-np.rint(expected_z[fruit]/16*65535).astype(int))))
    require(error <= 1, f'{name}: sphere height disagrees with annotated geometry')
    stalks = np.asarray(Image.open(SOURCE/'elements'/f'{name}_stalk_mask.png')) > 0
    require(stalks.shape == ids.shape and stalks.any(), f'{name}: invalid stalk mask')
    require(not np.any((regions[..., 0] > 0) & stalks & ~fruit), f'{name}: region on exposed stalk')
    if name.startswith('spray'):
        exported_unripe = np.asarray(Image.open(SOURCE/'elements'/f'{name}_unripe.png')) > 0
        require(np.array_equal(exported_unripe, unripe), f'{name}: unripe mask mismatch')
        require(2 <= len(entry['clusters']) <= 4, f'{name}: invalid cluster count')
        for i, cluster in enumerate(entry['clusters']):
            require(15 <= cluster['count'] <= 30, f'{name}: invalid berries per cluster')
            require(sum(b['cluster'] == i for b in entry['berries']) == cluster['count'],
                    f'{name}: cluster count disagrees with manifest')
    else:
        require(10 <= len(entry['berries']) <= 18, f'{name}: invalid bunch berry count')
        stem = (base[..., 3] > 0) & ~fruit
        require(np.all(base[stem, :3] == [105, 110, 53]), f'{name}: invalid exposed stalk colour')
    return dict(berries=len(entry['berries']), ripe_berries=len(body_stats),
                catchlights=int(glints.sum()//3), catchlight_pixels=int(glints.sum()),
                sphere_height_max_error_u16=error, body=body_stats), ids, scar, unripe, glints


def make_reviews(arrays, layout):
    base, height, normal, orm, regions = [arrays[k] for k in LAYERS]
    red = regions[..., 0] == 255
    byname = {e['name']: e for e in layout['elements']}
    for name, colour in [('dark_grey', [44, 47, 50]), ('white', [255, 255, 255]),
                         ('mid_green', [74, 111, 71])]:
        over(base, colour).save(OUT/f'base_{name}_2048.png')
        over(raw_resize(base, (256, 256)), colour).save(OUT/f'base_{name}_256.png')
    panels = []
    for key in LAYERS:
        image = (over(base, [44, 47, 50]) if key == 'base' else
                 Image.fromarray(byte(height/65535*255)).convert('RGB') if key == 'height' else
                 Image.fromarray(arrays[key]).convert('RGB'))
        panels.append(('bush_'+key, image))
    labelled_sheet(panels, 3, (512, 512), 'layers.jpg')
    overlay = np.array(over(base, [44, 47, 50]))
    overlay[red] = byte(overlay[red]*.30+np.array([255, 45, 40])*.70)
    Image.fromarray(overlay).save(OUT/'regions_overlay.png')
    outline = over(base, [44, 47, 50])
    draw = ImageDraw.Draw(outline)
    light_panels = []
    (OUT/'relit').mkdir(exist_ok=True)
    for entry in layout['elements']:
        name = entry['name']
        x0, y0, x1, y1 = entry['rect']
        draw.rectangle((x0, y0, x1-1, y1-1), outline=(115, 174, 158), width=2)
        draw.text((x0+5, y0+5), name, fill='white')
        for key, colour in [('anchor', (255, 167, 40)), ('tip', (95, 220, 255))]:
            if key in entry:
                x, y = entry[key]
                draw.ellipse((x-4, y-4, x+4, y+4), fill=colour)
        b, n, mat = base[y0:y1, x0:x1], normal[y0:y1, x0:x1], orm[y0:y1, x0:x1]
        pair = Image.new('RGB', ((x1-x0)*2, y1-y0))
        for i, light in enumerate([(-.65, .45, .62), (.65, -.45, .62)]):
            pair.paste(over(illuminate(b, n, mat, light), [44, 47, 50]), (i*(x1-x0), 0))
        pair.save(OUT/'relit'/f'{name}.png')
        light_panels.append((name+' | upper left / lower right', pair))
    outline.save(OUT/'layout.png')
    labelled_sheet(light_panels, 4, (360, 500), 'lighting_contact.jpg')
    dye_panels, statistics = [], {}
    for label, colour in COLORS.items():
        dyed, stats = dye(base, red, colour)
        stats['formula'] = 'base * dye / region_0_mean; clip to 0..255 before lighting'
        statistics[label] = stats
        image = over(dyed, [44, 47, 50])
        image.save(OUT/f'dyed_{label}.png')
        dye_panels.append((label+' | mean-scaled', image))
    labelled_sheet(dye_panels, 3, (512, 512), 'dyes.jpg')
    # Actual accepted leaf artwork, darkened only in this diagnostic backdrop.
    x0, y0, x1, y1 = byname['spray1_bare']['rect']
    leaf = base[y0:y1, x0:x1].copy()
    leaf[..., :3] = byte(leaf[..., :3]*.32)
    backdrop = over(leaf, [13, 20, 14])
    width, header = 488, 36
    heights = [260, 260, 260, 508]
    sheet = Image.new('RGB', (6*width, sum(heights)+4*header+38), (20, 26, 21))
    draw = ImageDraw.Draw(sheet)
    draw.text((12, 12), 'MEAN-SCALED DYES | 3-texel white glints | approximate upper-left light | dark leaf background', fill='white')
    y = 38
    # Native-scale scenes for the distance sheet: three bunches across the
    # upper row, then one spray. The quarter view averages the entire scene,
    # including its leaf backdrop and existing glints, without enlarging fruit.
    distance_scenes = {label: Image.new('RGB', (488, 668)) for label in COLORS}
    for name, panel_height in zip(['bunch1', 'bunch2', 'bunch3', 'spray1'], heights):
        x0, y0, x1, y1 = byname[name]['rect']
        b, n, mat = base[y0:y1, x0:x1], normal[y0:y1, x0:x1], orm[y0:y1, x0:x1]
        region = red[y0:y1, x0:x1]
        statistics[name] = {}
        for column, (label, colour) in enumerate(COLORS.items()):
            dyed, stats = dye(b, region, colour)
            statistics[name][label] = stats
            lit = illuminate(dyed, n, mat, [-.65, .45, .62])
            native = lit
            if name.startswith('bunch'):
                ys, xs = np.where(b[..., 3] > 0)
                lit = lit[max(ys.min()-4, 0):ys.max()+5, max(xs.min()-4, 0):xs.max()+5]
                native = lit
                # Nearest sampling makes the deliberately tiny texel area inspectable.
                lit = np.asarray(Image.fromarray(lit).resize((lit.shape[1]*2, lit.shape[0]*2), Image.Resampling.NEAREST))
            if name.startswith('bunch'):
                index = int(name[-1])-1
                left, right = index*488//3, (index+1)*488//3
                native_width, native_height, top = right-left, 160, 0
            else:
                left, native_width, native_height, top = 0, 488, 508, 160
            native_canvas = np.zeros((native_height, native_width, 4), np.uint8)
            nx, ny = (native_width-native.shape[1])//2, (native_height-native.shape[0])//2
            native_canvas[ny:ny+native.shape[0], nx:nx+native.shape[1]] = native
            native_background = backdrop.resize((native_width, native_height), Image.Resampling.LANCZOS)
            distance_scenes[label].paste(over(native_canvas, native_background), (left, top))
            background = backdrop.resize((width, panel_height), Image.Resampling.LANCZOS)
            canvas = np.zeros((panel_height, width, 4), np.uint8)
            ox, oy = (width-lit.shape[1])//2, (panel_height-lit.shape[0])//2
            canvas[oy:oy+lit.shape[0], ox:ox+lit.shape[1]] = lit
            sheet.paste(over(canvas, background), (column*width, y+header))
            scale = '2x' if name.startswith('bunch') else '1x'
            draw.text((column*width+12, y+12), f'{name} | {label.replace("_", " ")} | {scale}', fill='white')
        y += panel_height+header
    sheet.save(OUT/'berry_dyes.png')
    distance_sheet = Image.new('RGB', (3*650, 2*744+36), (20, 26, 21))
    draw = ImageDraw.Draw(distance_sheet)
    draw.text((12, 12), 'SIX DYES | native atlas scale beside 25% BOX average (~7 m proxy) | same dye, light and leaf background', fill='white')
    for i, (label, scene) in enumerate(distance_scenes.items()):
        x, y = (i % 3)*650, (i // 3)*744+36
        draw.text((x+12, y+8), label.replace('_', ' ').upper()+' | 1x atlas pixels', fill='white')
        draw.text((x+504, y+8), '0.25x | ~7 m', fill='white')
        for j in range(3):
            draw.text((x+j*488//3+12, y+34), f'bunch{j+1}', fill=(195, 208, 198))
        distance_sheet.paste(scene, (x, y+60))
        distance_sheet.paste(scene.resize((122, 167), Image.Resampling.BOX), (x+504, y+60))
    distance_sheet.save(OUT/'berry_dyes_distance.png')
    save_json(OUT/'dye_measurements.json', statistics)


def main():
    OUT.mkdir(exist_ok=True)
    errors = []

    def require(condition, message):
        if not bool(condition):
            errors.append(message)

    files = {key: Image.open(ROOT/f'bush_{key}.png') for key in LAYERS}
    for key, image in files.items():
        require(image.size == (2048, 2048), f'{key}: wrong dimensions')
        header = (ROOT/f'bush_{key}.png').read_bytes()[:29]
        require(header[24] == (16 if key == 'height' else 8), f'{key}: wrong bit depth')
        require(header[25] == {'base': 6, 'height': 0}.get(key, 2), f'{key}: wrong PNG colour type')
    if errors:
        save_json(OUT/'measurements.json', dict(passed=False, errors=errors))
        raise SystemExit('\n'.join(errors))
    arrays = {key: np.asarray(image) for key, image in files.items()}
    base, height, normal, orm, regions = [arrays[key] for key in LAYERS]
    active = base[..., 3] > 0
    red = regions[..., 0] == 255
    require(np.all(height[~active] == 0), 'Nonzero height outside alpha')
    require(np.all(orm[~active] == [255, 230, 0]), 'Invalid packed background')
    require(np.all(orm[..., 2] == 0), 'Nonzero metalness')
    require(np.all((regions == [255, 0, 0]).all(-1) | (regions == [0, 0, 0]).all(-1)),
            'Regions must be pure red or black')
    require(not np.any(red & ~active), 'Region outside alpha')
    expected = normal_expected(height)
    actual = normal.astype(float)/255*2-1
    lengths = np.linalg.norm(actual, axis=-1, keepdims=True)
    require(np.max(np.abs(lengths-1)) < .012, 'Non-unit tangent normals')
    actual /= lengths
    angles = np.degrees(np.arccos(np.clip(np.sum(expected*actual, axis=-1), -1, 1)))
    agreement = dict(mean_surface_degrees=float(angles[active].mean()),
                     p99_surface_degrees=float(np.percentile(angles[active], 99)),
                     maximum_degrees=float(angles.max()))
    require(agreement['maximum_degrees'] < .40, 'Normal does not agree with physical height')
    layout = json.loads((ROOT/'layout.json').read_text())
    require(layout['scale_px_per_m'] == 1300, 'Incorrect physical scale')
    byname = {e['name']: e for e in layout['elements']}
    expected_names = {*[f'spray{i}{suffix}' for i in range(1, 7) for suffix in ('', '_bare')],
                      'inner1', 'inner2', *RETAINED, 'leaf1', 'leaf2', 'leaf3',
                      'bunch1', 'bunch2', 'bunch3', 'bark'}
    require(set(byname) == expected_names and len(layout['elements']) == len(expected_names),
            'Missing, extra or duplicate layout elements')
    manifest = json.loads((SOURCE/'berries.json').read_text())
    fruit_byname = {e['name']: e for e in manifest}
    require(set(fruit_byname) == {*[f'spray{i}' for i in range(1, 7)], 'bunch1', 'bunch2', 'bunch3'}
            and len(manifest) == 9, 'Incorrect berry manifest elements')
    occupancy = np.zeros(active.shape, np.uint8)
    metrics, fruits, twins = {}, {}, {}
    leaf_roughness_values = []
    for entry in layout['elements']:
        name = entry['name']
        x0, y0, x1, y1 = entry['rect']
        valid = 0 <= x0 < x1 <= 2048 and 0 <= y0 < y1 <= 2048
        require(valid, f'{name}: invalid rectangle')
        if not valid:
            continue
        occupancy[y0:y1, x0:x1] += 1
        b, z, mat = base[y0:y1, x0:x1], height[y0:y1, x0:x1], orm[y0:y1, x0:x1]
        visible = b[..., 3] > 0
        require(visible.any(), f'{name}: empty element')
        if not visible.any():
            continue
        ys, xs = np.where(visible)
        margins = [int(xs.min()), int(ys.min()), int(x1-x0-1-xs.max()), int(y1-y0-1-ys.max())]
        labels, count = nd.label(visible, np.ones((3, 3)))
        areas = np.bincount(labels.ravel())[1:]
        fractional = (b[..., 3] > 0) & (b[..., 3] < 255)
        deep_fractional = fractional & (nd.distance_transform_edt(visible) > 2.01)
        # Fine stalk intersections and retained cutout edges can leave sparse
        # fractional pixels inside the combined silhouette. They must not form
        # a translucent backdrop; the compact bunch interiors are fully opaque.
        require(not deep_fractional.any() if name.startswith('bunch') else
                deep_fractional.sum()/visible.sum() < .005,
                f'{name}: excessive fractional alpha inside silhouette')
        require(areas.max()/visible.sum() > .999, f'{name}: disconnected material')
        metrics[name] = dict(padding_ltrb=margins, occupied_pixels=int(visible.sum()),
                             fractional_alpha_pixels=int(fractional.sum()),
                             deep_fractional_alpha_pixels=int(deep_fractional.sum()),
                             connected_components=int(count))
        if name == 'bark':
            require(entry == dict(name='bark', role='bark', rect=[1952, 0, 2048, 2048], metres=.6),
                    'Incorrect bark rectangle/scale')
            require(np.all(b[..., 3] == 255), 'Bark must be opaque')
            continue
        require(x1 <= 1952 and min(margins) >= (4 if name.startswith('bunch') else 24),
                f'{name}: insufficient padding or overlaps bark')
        exported = np.asarray(Image.open(SOURCE/'elements'/f'{name}.png'))
        require(np.array_equal(exported, b), f'{name}: exported element differs from atlas')
        anchor, tip = np.array(entry['anchor']), np.array(entry['tip'])
        require(x0 <= anchor[0] < x1 and y0 <= anchor[1] < y1, f'{name}: anchor outside cell')
        require(x0 <= tip[0] < x1 and y0 <= tip[1] < y1, f'{name}: tip outside cell')
        require(base[anchor[1], anchor[0], 3] > 0 and base[tip[1], tip[0], 3] > 0,
                f'{name}: anchor or tip outside alpha')
        require(abs(np.linalg.norm(tip-anchor)/1300-entry['metres']) < 1e-5, f'{name}: incorrect physical length')
        require((tip[1] > anchor[1]) == name.startswith('bunch'), f'{name}: incorrect growth direction')
        if name.startswith('bunch'):
            i = int(name[-1])-1
            require(entry['rect'] == [976, 1524+i*174, 1170, 2048 if i == 2 else 1524+(i+1)*174],
                    f'{name}: wrong bunch slot')
            require(anchor.tolist() == [1073, y0+6] and tip[1] == y0+ys.max(), f'{name}: bunch anchor/tip')
        if name.startswith(('spray', 'inner')):
            fill = float(np.sum(b[..., 3]/255)/ConvexHull(np.column_stack([xs, ys])).volume)
            require(.60 <= fill <= .75, f'{name}: foliage density outside accepted range')
            require(.32 <= entry['metres'] <= .45 and .25 <= (xs.max()-xs.min()+1)/1300 <= .40,
                    f'{name}: incorrect physical crown size')
            metrics[name]['outline_fill'] = fill
        ids = np.zeros(visible.shape, np.uint16)
        scar = unripe = np.zeros(visible.shape, bool)
        if name in fruit_byname:
            fruits[name], ids, scar, unripe, glints = validate_fruit(fruit_byname[name], arrays, entry['rect'], require)
        else:
            require(not red[y0:y1, x0:x1].any(), f'{name}: region 0 on non-fruit element')
        # Existing padding keeps neutral berry colour, with no painted glints.
        distance, nearest = nd.distance_transform_edt(~visible, return_indices=True)
        band = (distance > 0) & (distance <= 32)
        expected_rgb = b[nearest[0], nearest[1], :3].copy()
        edge_ids = ids[nearest[0], nearest[1]]
        ripe_edge = (edge_ids > 0) & ~unripe[nearest[0], nearest[1]]
        greys = 84+np.array([-2, 0, 2])[(edge_ids.astype(int)-1) % 3]
        greys = byte(greys*np.where(scar[nearest[0], nearest[1]], .85, 1))
        expected_rgb[ripe_edge] = greys[ripe_edge, None]
        require(np.array_equal(b[band, :3], expected_rgb[band]), f'{name}: incorrect edge colour extension')
        if not name.startswith('bunch'):
            leaf = np.asarray(Image.open(SOURCE/'elements'/f'{name}_leaf_mask.png')) > 0
            require(leaf.shape == visible.shape and not np.any(leaf & ~visible), f'{name}: invalid leaf mask')
            roughness = mat[leaf, 1]/255
            require(roughness.size > 0 and np.all((roughness >= .88) & (roughness <= .94)),
                    f'{name}: leaf roughness outside .88-.94')
            if roughness.size:
                leaf_roughness_values.append(roughness)
                metrics[name]['leaf_roughness'] = dict(
                    pixels=int(roughness.size), mean=float(roughness.mean()),
                    minimum=float(roughness.min()), maximum=float(roughness.max()))
        if 'twin' in entry:
            twin = byname[entry['twin']]
            tx0, ty0, tx1, ty1 = twin['rect']
            other = base[ty0:ty1, tx0:tx1]
            damage = np.asarray(Image.open(SOURCE/'elements'/f'{name}_damage.png')) > 0
            changed = (ids > 0) | damage
            common = ~changed & (visible | (other[..., 3] > 0))
            mismatches = {}
            for key in ('base', 'height', 'orm', 'normal'):
                left, right = arrays[key][y0:y1, x0:x1], arrays[key][ty0:ty1, tx0:tx1]
                difference = left != right
                if difference.ndim == 3:
                    difference = difference.any(-1)
                stable = common & ~nd.binary_dilation(changed) if key == 'normal' else common
                mismatches[key] = int(np.sum(difference & stable))
                require(mismatches[key] == 0, f'{name}: unchanged twin {key} pixels differ')
            for key in ('anchor', 'tip'):
                require(np.array_equal(np.array(entry[key])-[x0, y0], np.array(twin[key])-[tx0, ty0]),
                        f'{name}: twin {key} moved')
            twins[name] = mismatches
    require(occupancy.max() == 1, 'Layout rectangles overlap')
    require(np.all(occupancy[active] == 1), 'Visible pixels outside layout rectangles')
    seams = {key: int(np.max(np.abs(a[0, 1952:].astype(int)-a[-1, 1952:].astype(int))))
             for key, a in arrays.items()}
    require(all(value == 0 for value in seams.values()), 'Bark endpoint seam differs')
    metadata = json.loads((SOURCE/'build_metadata.json').read_text())
    require(metadata['height_range_mm'] == 16 and metadata['normal_convention'] == 'OpenGL +Y up',
            'Incorrect material conventions')
    for filename, expected_hash in metadata['originals'].items():
        require(digest(SOURCE/filename) == expected_hash, f'Original checksum mismatch: {filename}')
    print('Final atlas checks complete; rebuilding in an empty temporary directory...', flush=True)
    rebuild = verify_rebuild(require)
    leaf_roughness = np.concatenate(leaf_roughness_values)
    result = dict(passed=not errors, errors=errors, elements=metrics, fruit=fruits, twins=twins,
                  leaf_roughness=dict(pixels=int(leaf_roughness.size), mean=float(leaf_roughness.mean()),
                                      minimum=float(leaf_roughness.min()), maximum=float(leaf_roughness.max())),
                  region_outside_alpha_count=int(np.sum(red & ~active)), normal_agreement=agreement,
                  bark_seam_max_channel_error=seams, ripe_mean_rgb=base[red, :3].mean(axis=0).tolist(),
                  catchlight_pixels=sum(f['catchlight_pixels'] for f in fruits.values()),
                  rebuild_exact=rebuild['passed'], rebuild_compared_files=len(rebuild.get('compared_files', {})))
    save_json(OUT/'measurements.json', result)
    make_reviews(arrays, layout)
    print(json.dumps({k: result[k] for k in ('passed', 'errors', 'normal_agreement', 'catchlight_pixels',
                                           'leaf_roughness', 'rebuild_exact', 'rebuild_compared_files')}, indent=2))
    if errors:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
