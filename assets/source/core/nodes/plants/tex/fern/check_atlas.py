#!/usr/bin/env python3
"""Independent numerical checks and review images for the delivered fern PNGs.

Run: python3 check_atlas.py. Returns nonzero if a required check fails.
Normal verification intentionally does not import the builder.
"""
from pathlib import Path
import json
import struct
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent
OUT = ROOT/'checks'
N = 2048
LANCZOS = Image.Resampling.LANCZOS
BOX = Image.Resampling.BOX


def font(size=22):
    for path in ['/System/Library/Fonts/Supplemental/Arial.ttf',
                 '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def composite(rgb, alpha, background):
    a = alpha.astype(float)[:, :, None]/255
    return Image.fromarray(np.rint(np.clip(rgb*a+np.array(background)*(1-a), 0, 255)).astype(np.uint8))


def channel_resize(rgb, alpha, size=256):
    # Emulate the stated game filter: colour and alpha averaged separately.
    r = np.asarray(Image.fromarray(rgb).resize((size, size), BOX))
    a = np.asarray(Image.fromarray(alpha).resize((size, size), BOX))
    return r, a


def independent_normals(height, scale, range_mm, bark_metres):
    z = height.astype(np.float64)/65535*(range_mm/1000)
    x = np.zeros_like(z)
    y = np.zeros_like(z)
    plant = z[:, :1952]
    x[:, 1:1951] = (plant[:, 2:]-plant[:, :-2])*(scale/2)
    x[:, 0] = (plant[:, 1]-plant[:, 0])*scale
    x[:, 1951] = (plant[:, -1]-plant[:, -2])*scale
    y[1:-1, :1952] = (plant[2:]-plant[:-2])*(scale/2)
    y[0, :1952] = (plant[1]-plant[0])*scale
    y[-1, :1952] = (plant[-1]-plant[-2])*scale
    bark = z[:, 1952:]
    rate = N/bark_metres
    x[:, 1953:-1] = (bark[:, 2:]-bark[:, :-2])*(rate/2)
    x[:, 1952] = (bark[:, 1]-bark[:, 0])*rate
    x[:, -1] = (bark[:, -1]-bark[:, -2])*rate
    y[:, 1952:] = (np.roll(bark, -1, 0)-np.roll(bark, 1, 0))*(rate/2)
    result = np.stack([-x, y, np.ones_like(z)], axis=2)
    return result/np.linalg.norm(result, axis=2, keepdims=True)


def save_lighting(base, normal, orm, elements):
    directions = [np.array([-.55, .65, .65]), np.array([.65, -.45, .65])]
    n = normal.astype(float)/127.5-1
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    srgb = base[:, :, :3].astype(float)/255
    linear = np.where(srgb <= .04045, srgb/12.92, ((srgb+.055)/1.055)**2.4)
    lit = []
    for direction in directions:
        direction /= np.linalg.norm(direction)
        diffuse = np.maximum(0, np.sum(n*direction, axis=2))
        rgb = linear*(.28+.90*diffuse[:, :, None])*(orm[:, :, :1]/255)
        rgb = np.where(rgb <= .0031308, rgb*12.92, 1.055*np.maximum(rgb, 0)**(1/2.4)-.055)
        lit.append(composite(np.clip(rgb*255, 0, 255), base[:, :, 3], [40, 42, 44]))
    contact = Image.new('RGB', (1680, 2040), (27, 29, 31))
    draw = ImageDraw.Draw(contact)
    for i, e in enumerate(elements):
        x0, y0, x1, y1 = e['rect']
        a, b = [im.crop(e['rect']) for im in lit]
        pair = Image.new('RGB', (a.width*2+16, a.height+42), (40, 42, 44))
        pair.paste(a, (0, 42)); pair.paste(b, (a.width+16, 42))
        d = ImageDraw.Draw(pair)
        d.text((8, 8), e['name']+' / NW', fill='white', font=font(18))
        d.text((a.width+24, 8), 'SE', fill='white', font=font(18))
        pair.save(OUT/(e['name']+'_lit_two_directions.png'))
        thumb = pair.copy(); thumb.thumbnail((540, 470), LANCZOS)
        cx, cy = (i%3)*560, (i//3)*510
        contact.paste(thumb, (cx+(560-thumb.width)//2, cy+32))
        draw.text((cx+14, cy+5), e['name'], fill=(222, 226, 220), font=font(20))
    contact.save(OUT/'lighting_contact.jpg', quality=94)


def main():
    OUT.mkdir(exist_ok=True)
    layout = json.loads((ROOT/'layout.json').read_text())
    metadata = json.loads((ROOT/'source/build_metadata.json').read_text())
    measurements = {'atlas': 'fern', 'checks': {}, 'files': {}, 'elements': {}}
    failures = []
    def check(name, okay, detail=None):
        measurements['checks'][name] = {'pass': bool(okay), 'detail': detail}
        if not okay:
            failures.append(name)

    arrays = {}
    for kind, channels, bits, colour_type in [('base', 4, 8, 6), ('height', 1, 16, 0),
                                              ('normal', 3, 8, 2), ('orm', 3, 8, 2)]:
        path = ROOT/f'fern_{kind}.png'
        data = path.read_bytes()
        w, h, bit_depth, ct = struct.unpack('>IIBB', data[16:26])
        im = Image.open(path)
        arrays[kind] = np.asarray(im)
        measurements['files'][path.name] = {'size': [w, h], 'mode': im.mode,
                                              'bit_depth': bit_depth, 'colour_type': ct}
        check(kind+'_encoding', (w, h, bit_depth, ct)==(N, N, bits, colour_type))
    base, height, normal, orm = [arrays[k] for k in ['base', 'height', 'normal', 'orm']]
    alpha = base[:, :, 3]
    check('base_srgb_tag', Image.open(ROOT/'fern_base.png').info.get('srgb') == 0)
    check('metalness_zero', np.max(orm[:, :, 2])==0)
    check('height_zero_outside_alpha', np.all(height[alpha==0]==0))
    check('no_regions', not (ROOT/'fern_regions.png').exists())
    check('scale_1400', layout['scale_px_per_m']==1400)
    names = [e['name'] for e in layout['elements']]
    check('exact_element_names', set(names)=={*[f'frond{i}' for i in range(1, 7)],
                  'deadfrond1', 'deadfrond2', 'young1', 'young2', 'bark'} and len(names)==11)
    owner = np.zeros((N, N), np.uint8)
    for e in layout['elements']:
        x0, y0, x1, y1 = e['rect']
        check(e['name']+'_rect_in_bounds', 0<=x0<x1<=N and 0<=y0<y1<=N)
        owner[y0:y1, x0:x1] += 1
    check('rectangles_do_not_overlap', owner.max()==1)
    check('all_alpha_has_owner', np.all(owner[alpha>0]==1))
    measurements['rectangle_utilization'] = float(np.mean(owner>0))

    for e in layout['elements']:
        name = e['name']; x0, y0, x1, y1 = e['rect']
        a = alpha[y0:y1, x0:x1]
        mask = a > 0
        solid = a >= 128
        partial = (a>0)&(a<255)
        y, x = np.where(mask)
        margins = [int(x.min()), int(y.min()), int(a.shape[1]-1-x.max()), int(a.shape[0]-1-y.max())]
        row = {'coverage_fraction': float(np.mean(solid)),
               'alpha_weighted_coverage_fraction': float(np.mean(a)/255),
               'partial_alpha_pixels': int(partial.sum()),
               'partial_alpha_fraction_of_rectangle': float(np.mean(partial)),
               'partial_alpha_fraction_of_surface': float(partial.sum()/mask.sum()),
               'margin_px_left_top_right_bottom': margins,
               'roughness_min_mean_max': [float(v) for v in
                   [orm[y0:y1, x0:x1, 1][solid].min()/255,
                    orm[y0:y1, x0:x1, 1][solid].mean()/255,
                    orm[y0:y1, x0:x1, 1][solid].max()/255]],
               'height_max_mm': float(height[y0:y1, x0:x1].max()/65535*metadata['height_range_mm'])}
        measurements['elements'][name] = row
        if e.get('role') == 'bark':
            check('bark_rectangle', e['rect']==[1952, 0, 2048, 2048] and e['metres']==.5)
            check('bark_opaque', np.all(a==255))
            continue
        check(name+'_24px_margin', min(margins)>=24, margins)
        for point_name in ['anchor', 'tip']:
            px, py = e[point_name]
            check(name+'_'+point_name+'_on_surface',
                  x0<=px<x1 and y0<=py<y1 and alpha[py, px]>=128)
        check(name+'_grows_up', e['tip'][1]<e['anchor'][1])
        distance = np.linalg.norm(np.array(e['anchor'])-np.array(e['tip']))
        error = abs(distance/layout['scale_px_per_m']-e['metres'])
        row['scale_length_error_m'] = float(error)
        check(name+'_physical_scale', error<1e-6)
        # Semi-transparent pixels may only live in a narrow silhouette band.
        inside = ndi.distance_transform_edt(solid)
        outside = ndi.distance_transform_edt(~solid)
        broad = partial & (np.where(solid, inside, outside)>2)
        check(name+'_no_alpha_haze', not np.any(broad), int(broad.sum()))
        labels, count = ndi.label(mask, np.ones((3, 3)))
        row['alpha_components'] = count
        check(name+'_connected_surface', count==1)
        # Verify every texel in the requested >=32px bleed, independently.
        dist, idx = ndi.distance_transform_edt(~mask, return_indices=True)
        rgb = base[y0:y1, x0:x1, :3].astype(np.int16)
        ring = (dist>0)&(dist<=32)
        difference = np.abs(rgb-rgb[idx[0], idx[1]])
        max_error = int(difference[ring].max())
        row['rgb_bleed_max_error_32px'] = max_error
        check(name+'_rgb_bleed_32px', max_error==0, max_error)
        # Lowest 15-25% of mature fronds is a bare rachis.
        if name.startswith('frond'):
            widths = solid.sum(axis=1)
            yy = np.where(widths>0)[0]
            width_threshold = max(6, widths.max()*.13)
            blade_rows = yy[widths[yy]>width_threshold]
            bare = (yy.max()-blade_rows.max())/(yy.max()-yy.min())
            row['estimated_bare_stalk_fraction'] = float(bare)
            check(name+'_bare_stalk_15_to_25_percent', .14<=bare<=.26, float(bare))

    check('global_partial_alpha_near_zero', np.mean((alpha>0)&(alpha<255))<.025,
          float(np.mean((alpha>0)&(alpha<255))))
    expected = independent_normals(height, layout['scale_px_per_m'], metadata['height_range_mm'], .5)
    decoded = normal.astype(float)/127.5-1
    lengths = np.linalg.norm(decoded, axis=2)
    decoded /= lengths[:, :, None]
    angle = np.degrees(np.arccos(np.clip(np.sum(expected*decoded, axis=2), -1, 1)))
    measurements['normal_height_agreement'] = {'mean_angle_degrees': float(angle.mean()),
        'maximum_angle_degrees': float(angle.max()),
        'surface_mean_angle_degrees': float(angle[alpha>=128].mean()),
        'p99_angle_degrees': float(np.percentile(angle, 99)),
        'encoded_unit_length_max_error': float(np.max(np.abs(lengths-1))),
        'formula': 'normalize(-dH/dx, +dH/d_image_y, 1); central differences; 12 mm / 65535',
        'plant_px_per_m': 1400, 'bark_px_per_m': 4096}
    check('normal_matches_height', angle.max()<.4)
    check('normal_positive_z', np.min(normal[:, :, 2])>=128)
    check('normal_unit_length', np.max(np.abs(lengths-1))<.008)
    for kind, array in arrays.items():
        difference = np.abs(array[0, 1952:].astype(float)-array[-1, 1952:].astype(float))
        check(kind+'_bark_vertical_seam', difference.max()==0, float(difference.max()))
    measurements['height_encoding_range_mm'] = metadata['height_range_mm']
    measurements['height_occupied_max_mm'] = float(height.max()/65535*metadata['height_range_mm'])

    # Full-size and independently mip-filtered alpha composites.
    for name, background in [('dark', [40, 42, 44]), ('white', [255, 255, 255]),
                             ('green', [76, 112, 72])]:
        composite(base[:, :, :3], alpha, background).save(OUT/f'base_{name}_2048.png')
        small_rgb, small_a = channel_resize(base[:, :, :3], alpha)
        composite(small_rgb, small_a, background).save(OUT/f'base_{name}_256.png')

    # Contact sheet with the real height encoding (no per-element rescaling).
    previews = [('BASE / sRGB + alpha', Image.open(OUT/'base_dark_2048.png')),
                ('HEIGHT / 0-12 mm', Image.fromarray((height.astype(float)/65535*255).astype(np.uint8)).convert('RGB')),
                ('NORMAL / OpenGL +Y', Image.fromarray(normal)),
                ('ORM / AO, roughness, metalness', Image.fromarray(orm))]
    sheet = Image.new('RGB', (1536, 1632), (25, 27, 29)); draw = ImageDraw.Draw(sheet)
    for i, (label, im) in enumerate(previews):
        x, y = (i%2)*768, (i//2)*816
        draw.text((x+16, y+12), label, fill='white', font=font(22))
        sheet.paste(im.resize((768, 768), LANCZOS), (x, y+48))
    sheet.save(OUT/'layers.jpg', quality=95)

    diagram = Image.open(OUT/'base_dark_2048.png').convert('RGB'); d = ImageDraw.Draw(diagram)
    for e in layout['elements']:
        x0, y0, x1, y1 = e['rect']
        d.rectangle((x0, y0, x1-1, y1-1), outline=(148, 181, 180), width=2)
        d.text((x0+7, y0+7), e['name'], fill='white', font=font(21))
        if 'anchor' in e:
            for p, c in [(e['anchor'], (40, 225, 255)), (e['tip'], (255, 202, 61))]:
                x, y = p; d.ellipse((x-6, y-6, x+6, y+6), outline=c, width=3)
            d.line((*e['anchor'], *e['tip']), fill=(65, 113, 117), width=1)
    diagram.save(OUT/'layout_overlay.png')
    save_lighting(base, normal, orm, layout['elements'])

    # A close-up centred on the crown's vertical repeat boundary.
    bark = Image.fromarray(base[:, 1952:, :3])
    seam = Image.new('RGB', (96, 512)); seam.paste(bark.crop((0, N-256, 96, N)), (0, 0)); seam.paste(bark.crop((0, 0, 96, 256)), (0, 256))
    seam.resize((384, 2048), Image.Resampling.NEAREST).save(OUT/'bark_repeat_seam.png')
    mip_sheet = Image.new('RGB', (768, 256))
    for i, name in enumerate(['dark', 'white', 'green']):
        mip_sheet.paste(Image.open(OUT/f'base_{name}_256.png'), (256*i, 0))
    mip_sheet.save(OUT/'mip_backgrounds.png')
    details = [('Fresh blade', (60, 600, 340, 900)),
               ('Broken tip', (820, 15, 1090, 315)),
               ('Dry blade', (1570, 1300, 1850, 1600)),
               ('Crosier', (520, 1480, 660, 1680))]
    detail_sheet = Image.new('RGB', (1120, 660), (35, 37, 39))
    d = ImageDraw.Draw(detail_sheet)
    dark = Image.open(OUT/'base_dark_2048.png')
    for i, (label, box) in enumerate(details):
        d.text((280*i+8, 8), label, fill='white', font=font(14))
        detail_sheet.paste(dark.crop(box), (280*i, 32))
        detail_sheet.paste(Image.fromarray(normal).crop(box), (280*i, 354))
    detail_sheet.save(OUT/'detail_review.png')
    measurements['status'] = 'PASS' if not failures else 'FAIL'
    measurements['failed_checks'] = failures
    measurements['check_count'] = len(measurements['checks'])
    (OUT/'measurements.json').write_text(json.dumps(measurements, indent=2)+'\n')
    print(json.dumps({'status': measurements['status'], 'checks': measurements['check_count'],
                      'failed': failures, 'normal_max_error_deg': float(angle.max())}, indent=2))
    return int(bool(failures))


if __name__ == '__main__':
    sys.exit(main())
