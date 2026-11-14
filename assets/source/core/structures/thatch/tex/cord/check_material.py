"""Independent saved-file QA, native-resolution proofs and relighting.

Run after build_material.py. Uses NumPy, SciPy and Pillow. Does not import the
builder: normals, PNG headers, colour spaces and seam statistics are rechecked
from the files a game would actually load. No network access.
"""
from pathlib import Path
import hashlib
import json
import struct
import numpy as np
from PIL import Image, ImageDraw, ImageCms
from scipy.ndimage import gaussian_filter, map_coordinates

ROOT = Path(__file__).resolve().parent
CHECKS = ROOT / 'checks'
N = 2048
TILE_MM = 1500.0
HEIGHT_MM = 10.0
NAMES = ['cord_base', 'cord_height', 'cord_normal', 'cord_orm']
_profile = bytearray(ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
_profile[24:36] = struct.pack('>6H', 2026, 11, 14, 0, 0, 0)
_profile[84:100] = bytes(16)
SRGB = bytes(_profile)


def preview(a):
    if a.ndim == 2:
        return Image.fromarray(np.rint(a.astype(np.float64) / 257).astype(np.uint8)).convert('RGB')
    return Image.fromarray(a)


def sheet(items, name, cell=512, cols=2):
    rows = (len(items) + cols - 1) // cols
    out = Image.new('RGB', (cols * cell, rows * (cell + 34)), '#181b1b')
    d = ImageDraw.Draw(out)
    for i, (title, im) in enumerate(items):
        x, y = (i % cols) * cell, (i // cols) * (cell + 34)
        d.text((x + 12, y + 10), title, fill='#e5ddd0')
        if im.size != (cell, cell):
            im = im.resize((cell, cell), Image.Resampling.LANCZOS)
        out.paste(im, (x, y + 34))
    args = {'quality': 96, 'subsampling': 0} if name.endswith('.jpg') else {}
    out.save(CHECKS / name, **args)


def decode_srgb(a):
    return np.where(a <= .04045, a / 12.92, ((a + .055) / 1.055) ** 2.4)


def encode_srgb(a):
    a = np.maximum(a, 0)
    return np.where(a <= .0031308, a * 12.92, 1.055 * a ** (1 / 2.4) - .055)


def normalize(a):
    return a / np.maximum(np.linalg.norm(a, axis=-1, keepdims=True), 1e-10)


def png_info(path):
    data = path.read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    width, height, depth, colour = struct.unpack('>IIBB', data[16:26])
    chunks = []
    i = 8
    while i < len(data):
        length = struct.unpack('>I', data[i:i + 4])[0]
        chunks.append(data[i + 4:i + 8].decode('ascii'))
        i += 12 + length
    im = Image.open(path)
    return {'dimensions': [width, height], 'bit_depth': depth, 'png_colour_type': colour,
            'mode': im.mode, 'icc_profile': bool(im.info.get('icc_profile')),
            'chunks': sorted(set(chunks)), 'sha256': hashlib.sha256(data).hexdigest(),
            'bytes': len(data)}


def seam_metrics(a):
    a = a.astype(np.float64)
    if a.ndim == 2:
        a = a[..., None] / 257  # Compare all maps in equivalent 8-bit code values.
    result = {}
    for axis, title in [(1, 'left_right'), (0, 'top_bottom')]:
        diffs = np.abs(np.diff(a, axis=axis))
        wrap = np.abs(np.take(a, 0, axis=axis) - np.take(a, -1, axis=axis))
        lines = diffs.mean(axis=tuple(j for j in range(3) if j != axis))
        result[title] = {'wrap_mean': float(wrap.mean()), 'interior_mean': float(diffs.mean()),
                         'wrap_to_interior_mean_ratio': float(wrap.mean() / max(diffs.mean(), 1e-9)),
                         'interior_line_p95': float(np.quantile(lines, .95)),
                         'interior_line_p99': float(np.quantile(lines, .99)),
                         'interior_line_max': float(lines.max()),
                         'wrap_line_percentile': float(np.mean(lines <= wrap.mean()) * 100),
                         'wrap_pixel_p99': float(np.quantile(wrap, .99)),
                         'interior_pixel_p99': float(np.quantile(diffs, .99))}
    return result


def relight(base, normals, orm, light, clay=False):
    l = normalize(np.asarray(light, dtype=np.float32))
    nl = np.maximum(0, (normals * l).sum(-1))
    ao = orm[..., 0].astype(np.float32) / 255
    roughness = orm[..., 1].astype(np.float32) / 255
    albedo = np.full(base.shape, .24, dtype=np.float32) if clay else decode_srgb(base.astype(np.float32) / 255)
    # Lambert + very broad weak dielectric lobe; AO affects environment only.
    # This is an inspection shader, with no height displacement/self-shadow.
    half = normalize(l + np.array([0, 0, 1], np.float32))
    nh = np.maximum(0, (normals * half).sum(-1))
    specular = .017 * nh ** (2 + (1 - roughness) * 32) * nl
    rgb = albedo * (.25 * ao[..., None] + .95 * nl[..., None]) + specular[..., None]
    return Image.fromarray(np.uint8(np.clip(np.rint(encode_srgb(rgb) * 255), 0, 255)))


def lashing_on_cylinder(base, normals, orm, width_mm, offset):
    """Inspection of a small patch on a 60 mm diameter neutral support.

    Same physical UV scale as the flat tile. This is a smooth cylinder carrying
    tangent normals, not displaced geometry; the silhouette is intentionally
    not claimed as a model of the rope.
    """
    size = 640
    yy, xx = np.mgrid[:size, :size]
    world_x = (xx - size / 2) * .22
    world_y = -(yy - size / 2) * .22
    radius = 30.0
    phi = np.arcsin(np.clip(world_y / radius, -.99999, .99999))
    surface = np.abs(world_y) <= radius
    band = surface & (np.abs(world_x) <= width_mm / 2)
    u = ((world_x + offset[0]) / TILE_MM * N) % N
    v = ((offset[1] - phi * radius) / TILE_MM * N) % N
    sampled_rgb = np.stack([map_coordinates(base[..., c].astype(float), [v, u], order=1, mode='grid-wrap') for c in range(3)], -1)
    sampled_orm = np.stack([map_coordinates(orm[..., c].astype(float), [v, u], order=1, mode='grid-wrap') for c in range(3)], -1)
    tn = normalize(np.stack([map_coordinates(normals[..., c], [v, u], order=1, mode='grid-wrap') for c in range(3)], -1))
    sin, cos = np.sin(phi), np.cos(phi)
    world_n = np.stack([tn[..., 0], tn[..., 1] * cos + tn[..., 2] * sin, -tn[..., 1] * sin + tn[..., 2] * cos], -1)
    plain = np.stack([np.zeros_like(phi), sin, cos], -1)
    world_n = np.where(band[..., None], world_n, plain)
    rgb = np.where(band[..., None], sampled_rgb, np.array([74, 76, 73]))
    packed = np.where(band[..., None], sampled_orm, np.array([255, 230, 0]))
    out = np.array(relight(rgb, world_n, packed, [-.45, .65, .8]))
    out[~surface] = [26, 29, 28]
    return Image.fromarray(out)


def main():
    CHECKS.mkdir(exist_ok=True)
    images = {name: Image.open(ROOT / (name + '.png')) for name in NAMES}
    arrays = {name: np.asarray(im) for name, im in images.items()}
    files = {name: png_info(ROOT / (name + '.png')) for name in NAMES}
    for name, info in files.items():
        assert info['dimensions'] == [N, N], (name, info)
        assert info['bit_depth'] == (16 if name == 'cord_height' else 8)
        assert info['png_colour_type'] == (0 if name == 'cord_height' else 2)
        assert info['icc_profile'] == (name == 'cord_base')
        if name != 'cord_base':
            assert not ({'gAMA', 'sRGB', 'iCCP'} & set(info['chunks']))

    base, height16, normal8, orm = (arrays[n] for n in NAMES)
    h = height16.astype(np.float64) / 65535 * HEIGHT_MM
    raw_n = normal8.astype(np.float64) / 127.5 - 1
    n = normalize(raw_n)
    # Independent finite differences, matching the physical delivered grid.
    hx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) / (2 * TILE_MM / N)
    hy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) / (2 * TILE_MM / N)
    expected = normalize(np.stack([-hx, hy, np.ones_like(h)], axis=2))
    angular = np.degrees(np.arccos(np.clip((n * expected).sum(2), -1, 1)))
    encoded_expected = np.clip(np.rint((expected * .5 + .5) * 255), 0, 255).astype(np.uint8)
    exact_mismatch = int(np.count_nonzero(normal8 != encoded_expected))
    lengths = np.linalg.norm(raw_n, axis=2)
    assert angular.max() < .5
    assert exact_mismatch == 0
    assert np.count_nonzero(orm[..., 2]) == 0
    assert orm[..., 1].min() >= round(.8 * 255)
    assert orm[..., 1].max() <= round(.95 * 255)
    mean = base.mean((0, 1))
    assert np.max(np.abs(mean - [118, 96, 64])) < .1
    seams = {name: seam_metrics(a) for name, a in arrays.items()}

    sheet([(name, preview(a)) for name, a in arrays.items()], 'layers.jpg', 768, 2)
    offsets = []
    for name, a in arrays.items():
        rolled = np.roll(a, (N // 2, N // 2), (0, 1))
        kw = {'icc_profile': SRGB} if name == 'cord_base' else {}
        Image.fromarray(rolled).save(CHECKS / (name + '_offset.png'), **kw)
        offsets.append((name + ' | half-offset, wrap at centre', preview(rolled)))
    sheet(offsets, 'offsets.jpg', 768, 2)
    seam_box = (768, 768, 1280, 1280)
    sheet([(name + ' | wrap intersection at centre, native pixels',
            preview(np.roll(a, (N // 2, N // 2), (0, 1))).crop(seam_box))
           for name, a in arrays.items()], 'seam_detail_1to1.png', 512, 2)
    tiled = Image.new('RGB', (N * 3, N * 3))
    for y in range(3):
        for x in range(3):
            tiled.paste(images['cord_base'], (N * x, N * y))
    tiled.save(CHECKS / 'cord_base_tile3x3.png', icc_profile=SRGB)
    sheet([('3 x 3 repeat | 4.5 x 4.5 metres', tiled)], 'tilings.jpg', 1536, 1)

    crop_box = (660, 600, 1172, 1112)
    crops = []
    for name in NAMES:
        im = preview(arrays[name]).crop(crop_box)
        im.save(CHECKS / (name + '_crop_1to1.png'))
        crops.append((name + ' | native pixels, 375 x 375 mm', im))
    sheet([crops[0], crops[2]], 'detail_1to1.png', 512, 2)
    sheet(crops, 'alignment_1to1.png', 512, 4)
    # Eight small independently chosen lashing patches from the full material.
    patch_items = []
    for i, (x, y) in enumerate([(30, 85), (329, 642), (640, 1320), (985, 88), (1208, 804), (1552, 1560), (1777, 315), (130, 1710)]):
        box = (x, y, x + 128, y + 128)
        patch_items.append((f'patch {i + 1} | 93.75 mm, enlarged 4x', images['cord_base'].crop(box).resize((512, 512), Image.Resampling.NEAREST)))
    sheet(patch_items, 'lashing_patches.png', 512, 4)

    lights = [('upper left', [-.65, .48, .6]), ('lower right', [.65, -.48, .6]), ('top rake', [.05, .92, .38])]
    lit, lit_crops, clay_crops = [], [], []
    for i, (label, light) in enumerate(lights):
        im = relight(base, n, orm, light)
        im.save(CHECKS / f'relit_{i + 1}.png', icc_profile=SRGB)
        lit.append((label + ' | diagnostic light', im))
        lit_crops.append((label + ' | native pixels', im.crop(crop_box)))
        clay = relight(base, n, orm, light, clay=True)
        clay_crops.append((label + ' | neutral clay, native pixels', clay.crop(crop_box)))
    sheet(lit, 'relighting.jpg', 682, 3)
    sheet(lit_crops + clay_crops, 'relighting_detail.png', 512, 3)
    sheet([(f'{width} mm band | 60 mm support | physically scaled UVs',
            lashing_on_cylinder(base, n, orm, width, offset))
           for width, offset in [(30, (110, 365)), (60, (642, 710)), (100, (1040, 1210))]],
          'lashing_scale_preview.png', 640, 3)
    # Crossing check centred on a paired exchange; the colour is still unlit.
    con = json.loads((CHECKS / 'construction.json').read_text())
    cr = con['crossings'][1]['centre_mm']
    cx, cy = (round(v / TILE_MM * N) for v in cr)
    box = (cx - 128, cy - 128, cx + 128, cy + 128)
    crossing_views = [(name + ' | crossing, enlarged 2x', preview(arrays[name]).crop(box).resize((512, 512))) for name in NAMES]
    crossing_views += [(label + ' | crossing, enlarged 2x', relight(base, n, orm, light).crop(box).resize((512, 512))) for label, light in lights[:2]]
    sheet(crossing_views, 'crossing_detail.png', 512, 3)

    # Fine-detail evidence: residual against a 1024 reconstruction is measured,
    # not falsely described as proof of a scan or a generated 2K image.
    low = images['cord_base'].resize((1024, 1024), Image.Resampling.BOX).resize((N, N), Image.Resampling.BICUBIC)
    residual = base.astype(np.float32) - np.asarray(low).astype(np.float32)
    local_cavity = gaussian_filter(h, 2.0, mode='wrap') - h
    low_mask = local_cavity > np.quantile(local_cavity, .8)
    high_mask = local_cavity < np.quantile(local_cavity, .2)
    ao = orm[..., 0] / 255
    assert ao[low_mask].mean() < ao[high_mask].mean()
    fields = np.load(CHECKS / 'construction_fields.npz')
    metrics = {
        'files': files, 'tile_metres': [1.5, 1.5], 'mm_per_texel': TILE_MM / N,
        'height_range_mm': HEIGHT_MM, 'height_used_mm': {'min': float(h.min()), 'max': float(h.max()),
                                                      'p01': float(np.quantile(h, .01)), 'p99': float(np.quantile(h, .99))},
        'base_mean_srgb_8bit': mean.tolist(), 'base_std_srgb_8bit': base.std((0, 1)).tolist(),
        'base_target_absolute_error': np.abs(mean - [118, 96, 64]).tolist(),
        'normal_height_agreement_degrees': {'mean': float(angular.mean()), 'p99': float(np.quantile(angular, .99)), 'max': float(angular.max())},
        'normal_reencoded_channel_mismatches': exact_mismatch,
        'normal_decoded_length': {'min': float(lengths.min()), 'max': float(lengths.max())},
        'seams_8bit_equivalent': seams,
        'roughness': {'min': float(orm[..., 1].min() / 255), 'mean': float(orm[..., 1].mean() / 255), 'max': float(orm[..., 1].max() / 255)},
        'ambient_occlusion': {'min': float(ao.min()), 'mean': float(ao.mean()), 'max': float(ao.max()),
                              'cavity_mean': float(ao[low_mask].mean()), 'crown_mean': float(ao[high_mask].mean())},
        'metalness_nonzero_pixels': int(np.count_nonzero(orm[..., 2])),
        'high_frequency_rgb_rms_vs_1024_reconstruction': float(np.sqrt(np.mean(residual ** 2))),
        'fibre_relief_mm_std': float(fields['fibre_relief_mm'].std()),
        'cord_surface_coverage_fraction': float(fields['coverage'].mean()),
        'construction': {'master_size': con['master_size'], 'source_native_size': con['source_native_size'],
                         'cord_count': con['cord_count'], 'nominal_diameter_mm': [min(c['diameter_mm'] for c in con['cords']), max(c['diameter_mm'] for c in con['cords'])],
                         'crossing_pairs': len(con['crossings']), 'fibre_ends': con['fibre_ends']},
        'native_crop_xyxy': list(crop_box),
        'notes': ['Opposite edge texels are adjacent samples, not duplicated pixels.',
                  'Normal errors are from RGB8 vector quantization; re-encoding the exact derivative matches every channel.',
                  'AO is a wrapped heightfield horizon approximation, not measured occlusion.',
                  'Relighting uses the delivered RGB8 normal and ORM. No displacement or ray-traced self shadows.',
                  'Base mean is measured in encoded sRGB code values, not linear light.'],
        'all_required_numerical_checks_passed': True,
    }
    # A seam may fall on a real groove. Reject a new boundary jump greater than
    # every interior line; report the full distribution, not only pass/fail.
    # This numerical bound complements native seam/offset/repeat inspection.
    for name, dirs in seams.items():
        for direction, s in dirs.items():
            assert s['wrap_mean'] <= s['interior_line_max'], (name, direction, s)
    (CHECKS / 'metrics.json').write_text(json.dumps(metrics, indent=2) + '\n')
    print(json.dumps({k: v for k, v in metrics.items() if k not in ['files', 'seams_8bit_equivalent', 'notes']}, indent=2))


if __name__ == '__main__':
    main()
