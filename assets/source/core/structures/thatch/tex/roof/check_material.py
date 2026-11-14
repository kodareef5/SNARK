"""Independent validation and inspection renders for the delivered roof maps.

Run: python3 check_material.py
Uses only the delivered maps plus material.json, not build_material's normal code.
The optional mesh-step preview adds the specified 10 mm course steps solely in
the renderer. It never changes the delivered material.
"""
from pathlib import Path
import json
import struct
import hashlib
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import map_coordinates, gaussian_filter

ROOT = Path(__file__).resolve().parent
CHECK = ROOT/'checks'
CHECK.mkdir(exist_ok=True)


def rgb(a):
    return Image.fromarray(np.clip(np.rint(a), 0, 255).astype(np.uint8))


def labeled(im, title, size):
    im = im.convert('RGB').resize((size, size), Image.Resampling.LANCZOS)
    out = Image.new('RGB', (size, size+38), (28, 29, 31))
    out.paste(im, (0, 38))
    ImageDraw.Draw(out).text((14, 10), title, fill=(230, 232, 228), font=font(16))
    return out


def font(size):
    for path in ['/System/Library/Fonts/Supplemental/Arial.ttf',
                 '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def contact(images, labels, name, size=768):
    panels = [labeled(i, t, size) for i, t in zip(images, labels)]
    out = Image.new('RGB', (size*2, (size+38)*2), (28, 29, 31))
    for i, p in enumerate(panels):
        out.paste(p, ((i % 2)*size, (i//2)*(size+38)))
    out.save(CHECK/name, quality=95, subsampling=0)


def paired(left, right, labels, name, native=False):
    """Native comparison does not resize either input: one texel = one pixel."""
    if native:
        assert left.size == right.size
        w, h = left.size
    else:
        w, h = 1300, 900
    out = Image.new('RGB', (w*2, h+42), (28, 29, 31))
    for i, im in enumerate([left, right]):
        im = im.convert('RGB')
        if not native:
            im.thumbnail((w, h), Image.Resampling.LANCZOS)
        out.paste(im, (i*w+(w-im.width)//2, 42+(h-im.height)//2))
        ImageDraw.Draw(out).text((i*w+14, 12), labels[i], fill=(230, 232, 228), font=font(17))
    out.save(CHECK/name, quality=95, subsampling=0)


def seam_metrics(a, binding_rows):
    if a.ndim == 2:
        a = a[..., None]
    result = {}
    for axis, label in [(1, 'left_right'), (0, 'top_bottom')]:
        across = np.abs(np.take(a, 0, axis=axis)-np.take(a, -1, axis=axis))
        diff = np.abs(np.diff(a, axis=axis))
        line_means = diff.mean(axis=(0, 2) if axis == 1 else (1, 2))
        result[label] = dict(wrap_mean=float(across.mean()), wrap_pixel_p95=float(np.percentile(across, 95)),
                             interior_mean=float(diff.mean()),
                             interior_line_median=float(np.median(line_means)),
                             interior_line_p95=float(np.percentile(line_means, 95)),
                             interior_line_p99=float(np.percentile(line_means, 99)),
                             wrap_over_interior_mean=float(across.mean()/max(diff.mean(), 1e-9)))
        if axis == 0:
            # Row zero passes through a real cord. Compare with equivalent
            # samples around internal cords as well as the whole reed field.
            rows = np.concatenate([np.arange(r-6, r+7) for r in binding_rows if r > 8])
            band = line_means[rows]
            result[label]['internal_binding_line_mean'] = float(band.mean())
            result[label]['internal_binding_line_p95'] = float(np.percentile(band, 95))
            result[label]['internal_binding_line_max'] = float(band.max())
    return result


def engine_seam_metrics(p):
    """Engine metric, summed over every pixel/channel in the delivered PNG.

    edge_x = sum |p[y][w-1] - p[y][0]|
    inner_x = sum |p[y][x] - p[y][x+1]|, x < w-1
    seam_x = edge_x * (w - 1) / inner_x; analogously for Y.
    Signed 64-bit subtraction/sums avoid uint8/uint16 wrap and overflow.
    """
    p = np.asarray(p, dtype=np.int64)
    h, w = p.shape[:2]
    edge_x = int(np.abs(p[:, w-1]-p[:, 0]).sum())
    inner_x = int(np.abs(p[:, :-1]-p[:, 1:]).sum())
    edge_y = int(np.abs(p[h-1]-p[0]).sum())
    inner_y = int(np.abs(p[:-1]-p[1:]).sum())
    # A constant layer has no discontinuity; no epsilon alters real ratios.
    seam_x = edge_x*(w-1)/inner_x if inner_x else (0.0 if not edge_x else float('inf'))
    seam_y = edge_y*(h-1)/inner_y if inner_y else (0.0 if not edge_y else float('inf'))
    return dict(edge_x=edge_x, inner_x=inner_x, seam_x=seam_x,
                edge_y=edge_y, inner_y=inner_y, seam_y=seam_y,
                engine_failure=seam_x > 4 or seam_y > 4,
                engine_remark=seam_x > 2 or seam_y > 2)


def edge_binding_comparison(names, current, n):
    """Native strips through the Y wrap: bottom half above, top half below."""
    width, half = 1024, 40
    out = Image.new('RGB', (width*2, 42+len(names)*(half*2+28)), (28, 29, 31))
    draw = ImageDraw.Draw(out)
    for col, title in enumerate(['ROUND 2 / boundary cord', 'ROUND 3 / boundary cord']):
        draw.text((col*width+14, 12), title+' / native pixels', font=font(17), fill=(230, 232, 228))
    for row, (name, im) in enumerate(zip(names, current)):
        for col, source in enumerate([Image.open(ROOT/'source/round2'/name), im]):
            a = np.asarray(source)
            if 'height' in name:
                a = a.astype(np.float64)/65535*255
            strip = np.concatenate([a[-half:], a[:half]], axis=0)[:, n//4:n//4+width]
            top = 42+row*(half*2+28)
            out.paste(rgb(strip).convert('RGB'), (col*width, top+28))
            draw.text((col*width+14, top+5), name+' / join at strip centre', font=font(15), fill=(230, 232, 228))
    out.save(CHECK/'edge_binding_comparison.png')


def to_linear(x):
    return np.where(x <= .04045, x/12.92, ((x+.055)/1.055)**2.4)


def to_srgb(x):
    x = np.maximum(x, 0)
    return np.where(x <= .0031308, x*12.92, 1.055*x**(1/2.4)-.055)


def cast_shadow(h, light, mm_per_pixel):
    """Wrapped height-field visibility under a low directional sun."""
    n = h.shape[0]
    yy, xx = np.mgrid[:n, :n].astype(np.float32)
    planar = np.hypot(light[0], light[1])
    ux, uy = light[0]/planar, -light[1]/planar
    slope = light[2]/planar
    visible = np.ones_like(h)
    for step in [1, 2, 3, 4, 6, 8, 11, 15, 20, 27, 36, 48, 64]:
        occluder = map_coordinates(h, [yy+uy*step, xx+ux*step], order=1, mode='grid-wrap')
        clearance = h+step*mm_per_pixel*slope-occluder
        visible = np.minimum(visible, np.clip(clearance/.7+.6, 0, 1))
    return visible


def relight(base, normal, orm, h, light, mm_per_pixel, late_sun=False):
    l = np.array(light, np.float32)
    l /= np.linalg.norm(l)
    nl = np.maximum(np.sum(normal*l, axis=2), 0)
    shadow = cast_shadow(h, l, mm_per_pixel)
    ao = orm[..., 0]
    rough = orm[..., 1]
    # Dielectric rough diffuse with a very subdued broad reflection.
    sky = [.86, .93, 1.06]
    sun = [1.04, .99, .88]
    energy = 1.40
    if late_sun:
        sun, energy = [1.20, 1.01, .74], 1.85
    diffuse = .42*ao[..., None]*np.array(sky)+ \
        (nl*shadow*energy)[..., None]*np.array(sun)
    halfway = l+np.array([0, 0, 1], np.float32)
    halfway /= np.linalg.norm(halfway)
    nh = np.maximum(np.sum(normal*halfway, axis=2), 0)
    spec = .018*nh**(2/np.maximum(rough, .1)**2)*shadow
    return rgb(to_srgb(to_linear(base)*diffuse+spec[..., None])*255)


def roof_projection(tile, title):
    """Orthographic 6 m by 6 m, four-panel roof with a 25 cm slab silhouette."""
    W, H = 1300, 900
    out = Image.new('RGB', (W, H), (39, 43, 44))
    draw = ImageDraw.Draw(out)
    p0 = np.array([65., 330.])
    vx = np.array([710., -245.])
    vy = np.array([455., 445.])
    corners = np.array([p0, p0+vx, p0+vx+vy, p0+vy])
    down = np.array([0, 28])
    # Diagnostic neutral slab fascia; eave/wall material is outside this task.
    draw.polygon([tuple(corners[2]), tuple(corners[3]), tuple(corners[3]+down),
                  tuple(corners[2]+down)], fill=(75, 66, 48))
    draw.polygon([tuple(corners[1]), tuple(corners[2]), tuple(corners[2]+down),
                  tuple(corners[1]+down)], fill=(91, 79, 57))
    inv = np.linalg.inv(np.column_stack([vx, vy]))
    size = 2048
    repeat = Image.new('RGB', (size, size))
    small = tile.resize((size//2, size//2), Image.Resampling.LANCZOS)
    for j in range(2):
        for i in range(2):
            repeat.paste(small, (i*size//2, j*size//2))
    a, b = inv*size
    coeff = [a[0], a[1], -np.dot(a, p0), b[0], b[1], -np.dot(b, p0)]
    plane = repeat.transform((W, H), Image.Transform.AFFINE, coeff, Image.Resampling.BICUBIC)
    mask = Image.new('L', (W, H))
    ImageDraw.Draw(mask).polygon([tuple(p) for p in corners], fill=255)
    out.paste(plane, (0, 0), mask)
    draw.text((35, 24), title, font=font(24), fill=(232, 231, 220))
    draw.text((35, H-60), '6 m x 6 m / four panels / 20-degree sun / 10 mm mesh course steps',
              font=font(18), fill=(178, 183, 180))
    return out


def main():
    meta = json.loads((ROOT/'material.json').read_text())
    names = ['roof_base.png', 'roof_height.png', 'roof_normal.png', 'roof_orm.png']
    ims = [Image.open(ROOT/n) for n in names]
    base = np.asarray(ims[0], dtype=np.float32)
    h16 = np.asarray(ims[1], dtype=np.float64)
    norm8 = np.asarray(ims[2], dtype=np.float64)
    orm8 = np.asarray(ims[3], dtype=np.float32)
    n = meta['size']
    checks = {}
    files = {}
    for name, im in zip(names, ims):
        data = (ROOT/name).read_bytes()
        w, h, bits, colour = struct.unpack('>IIBB', data[16:26])
        files[name] = dict(size=[w, h], bit_depth=bits, png_colour_type=colour,
                           mode=im.mode, icc_profile=bool(im.info.get('icc_profile')),
                           sha256=hashlib.sha256(data).hexdigest())
        checks[name+'_dimensions'] = w == h == 2048
        checks[name+'_format'] = (bits, colour) == ((16, 0) if 'height' in name else (8, 2))
        checks[name+'_colour_space'] = bool(im.info.get('icc_profile')) == ('base' in name)
    h = h16/65535*meta['height_range_mm']
    px = meta['mm_per_pixel']
    # Independent double-precision derivation from the saved 16-bit height.
    dx = (np.roll(h, -1, axis=1)-np.roll(h, 1, axis=1))/(2*px)
    dy = (np.roll(h, -1, axis=0)-np.roll(h, 1, axis=0))/(2*px)
    expected = np.stack([-dx, dy, np.ones_like(h)], axis=2)
    expected /= np.linalg.norm(expected, axis=2, keepdims=True)
    decoded = norm8/127.5-1
    lengths = np.linalg.norm(decoded, axis=2)
    actual = decoded/lengths[..., None]
    angle = np.degrees(np.arccos(np.clip(np.sum(expected*actual, axis=2), -1, 1)))
    normal_metrics = dict(mean_angle_degrees=float(angle.mean()),
                          p99_angle_degrees=float(np.percentile(angle, 99)),
                          max_angle_degrees=float(angle.max()),
                          encoded_length_min=float(lengths.min()),
                          encoded_length_max=float(lengths.max()),
                          convention='OpenGL +X right, +Y image-up, +Z outward',
                          central_difference_mm_per_pixel=px)
    checks['normal_height_agreement'] = angle.max() < .45
    checks['normal_points_outward'] = bool(np.all(decoded[..., 2] > 0))
    checks['metalness_zero'] = bool(np.all(orm8[..., 2] == 0))
    checks['roughness_range'] = bool(orm8[..., 1].min()/255 >= .70 and orm8[..., 1].max()/255 <= .95)
    checks['course_rows'] = meta['course_rows'] == [171, 512, 853, 1195, 1536, 1877]
    checks['binding_count'] = len(meta['binding_rows']) == 12
    checks['binding_rows_unchanged'] = meta['binding_rows'] == [0, 171, 345, 512, 679, 853, 1027, 1195, 1363, 1536, 1709, 1877]
    checks['coverage_unchanged'] = meta['coverage_mm'] == [3000, 3000] and px == 3000/2048
    checks['height_uses_20_to_25_mm'] = 20 <= float(h.max()-h.min()) <= 25 and 20 <= meta['height_range_mm'] <= 25
    checks['height_not_clipped'] = meta['height_clipped_fraction'] == 0
    gaps = []
    for path in meta['binding_paths']:
        x = np.array([p[0] for p in path['stitch_centres']])
        gaps.extend(((np.roll(x, -1)-x) % n*px).tolist())
    checks['stitches_100_to_150_mm_including_wrap'] = min(gaps) >= 100 and max(gaps) <= 150
    widths = [b['width_mm'] for c in meta['bundle_courses'] for b in c]
    checks['handfuls_50_to_100_mm'] = min(widths) >= 50 and max(widths) <= 100
    mean = base.mean((0, 1), dtype=np.float64)
    checks['golden_straw_mean'] = bool(np.all(np.abs(mean-[180, 145, 90]) < 4))
    old = np.asarray(Image.open(ROOT/'source/round1/roof_base.png'), dtype=np.float32)
    lum = np.sum(base*np.array([.2126, .7152, .0722]), axis=2)
    oldlum = np.sum(old*np.array([.2126, .7152, .0722]), axis=2)
    contrast = float((lum-gaussian_filter(lum, 8, mode='wrap')).std())
    oldcontrast = float((oldlum-gaussian_filter(oldlum, 8, mode='wrap')).std())
    checks['source_detail_contrast_retained'] = contrast > oldcontrast*1.5
    archive = json.loads((ROOT/'source/round1/material.json').read_text())
    checks['round1_sources_unchanged'] = all(hashlib.sha256((ROOT/s['file']).read_bytes()).hexdigest() == s['sha256'] for s in archive['sources'])
    checks['source_native_resolution_retained'] = all(Image.open(ROOT/s['file']).size == tuple(s['size']) for s in meta['sources'])
    seams = {name: seam_metrics(a, meta['binding_rows']) for name, a in zip(names, [base/255, h16/65535, norm8/255, orm8/255])}
    engine_seams = {name: engine_seam_metrics(im) for name, im in zip(names, ims)}
    for name, m in engine_seams.items():
        checks[name+'_seam_x_under_2'] = m['seam_x'] < 2
        checks[name+'_seam_y_under_2'] = m['seam_y'] < 2
    # Changes are confined to the edge binding and its derived AO/normal
    # neighbourhood. Verify the accepted panel against the retained maps.
    round2_seams = {}
    unchanged_margin = 80
    for name, im in zip(names, ims):
        prior = np.asarray(Image.open(ROOT/'source/round2'/name))
        current = np.asarray(im)
        round2_seams[name] = engine_seam_metrics(prior)
        checks[name+'_round2_interior_unchanged'] = np.array_equal(
            prior[unchanged_margin:-unchanged_margin], current[unchanged_margin:-unchanged_margin])
    prior_meta = json.loads((ROOT/'source/round2/material.json').read_text())
    checks['internal_binding_paths_unchanged'] = meta['binding_paths'][1:] == prior_meta['binding_paths'][1:]
    with np.load(ROOT/'source/derivation.npz') as fields, np.load(ROOT/'source/round2/derivation.npz') as prior_fields:
        checks['edge_cord_covers_both_sides'] = bool(np.all(fields['cord_mask'][[0, -1]] > .95))
        for name in ['joint_mask', 'course_mask', 'butt_mask', 'bundle_height']:
            checks[name+'_unchanged'] = np.array_equal(fields[name], prior_fields[name])
    # The generated sRGB profile contains a creation date; compare pixels.
    checks['assembled_reeds_unchanged'] = np.array_equal(
        np.asarray(Image.open(ROOT/'source/assembled_reeds.png')),
        np.asarray(Image.open(ROOT/'source/round2/assembled_reeds.png')))
    checks = {k: bool(v) for k, v in checks.items()}
    metrics = dict(passed=bool(all(checks.values())), assertions=checks, files=files,
                   engine_seams=engine_seams,
                   round2_engine_seams=round2_seams,
                   round2_unchanged_interior_rows=[unchanged_margin, n-unchanged_margin-1],
                   wrap_seams_normalized_0_1=seams, normal_against_height=normal_metrics,
                   base_colour_mean_srgb_8bit=base.mean((0, 1), dtype=np.float64).tolist(),
                   base_colour_mean_linear=to_linear(base/255).mean((0, 1), dtype=np.float64).tolist(),
                   base_colour_percentiles_srgb_8bit={str(p): np.percentile(base, p, axis=(0, 1)).tolist() for p in [1, 50, 99]},
                   height_range_mm=meta['height_range_mm'], actual_height_mm=[float(h.min()), float(h.max())],
                   roughness_range=[float(orm8[..., 1].min()/255), float(orm8[..., 1].max()/255)],
                   roughness_mean=float(orm8[..., 1].mean()/255),
                   occlusion_range=[float(orm8[..., 0].min()/255), float(orm8[..., 0].max()/255)],
                   course_rows=meta['course_rows'], binding_rows=meta['binding_rows'],
                   local_luminance_contrast_std=dict(round1=oldcontrast, current_round=meta['round'], current=contrast, ratio=contrast/oldcontrast, filter_sigma_px=8),
                   stitch_spacing_mm=dict(minimum=min(gaps), maximum=max(gaps), count=len(gaps)),
                   handful_width_mm=dict(minimum=min(widths), maximum=max(widths), count=len(widths)),
                   actual_height_span_mm=float(h.max()-h.min()),
                   preview='Both directions have elevation 20 deg; diagnostic linear-light diffuse, cavity AO and wrapped height shadows. Roof perspective previews add 10 mm mesh steps and warm late sun RGB [1.20,1.01,.74] at intensity 1.85; map-only repeat previews retain round-1 neutral light RGB [1.04,.99,.88] at intensity 1.40. No colour adjustment to the concept.')
    (CHECK/'metrics.json').write_text(json.dumps(metrics, indent=2)+'\n')
    edge_binding_comparison(names, ims, n)
    height_im = rgb(h16/65535*255)
    layers = [ims[0], height_im, ims[2], ims[3]]
    labels = ['BASE / sRGB / unlit', f'HEIGHT / 16-bit / full scale {meta["height_range_mm"]:g} mm',
              'NORMAL / OpenGL / from delivered height', 'ORM / linear / AO, roughness, zero metal']
    contact(layers, labels, 'layers.jpg')
    # Native detail preserved in the full tiling and 1:1 crops.
    native = Image.new('RGB', (n*3, n*3))
    for y in range(3):
        for x in range(3):
            native.paste(ims[0], (x*n, y*n))
    native.save(CHECK/'tiling_3x3.jpg', quality=94, subsampling=0)
    native.resize((2048, 2048), Image.Resampling.LANCZOS).save(CHECK/'tiling_3x3_overview.jpg', quality=95)
    offsets = [rgb(np.roll(np.asarray(i), (n//2, n//2), axis=(0, 1))) for i in layers]
    offsets[0].save(CHECK/'half_offset.png')
    contact(offsets, labels, 'offsets.jpg')
    crop = (620, 390, 1388, 1158)
    contact([i.crop(crop) for i in layers], labels, 'detail_1to1.png', size=768)
    ims[0].crop(crop).save(CHECK/'base_1to1.png')
    wood_path = ROOT/'../../../../../../../planning/artist-test/wood/wood_base.png'
    wood_crop = (128, 128, 896, 896)
    paired(ims[0].crop(crop), Image.open(wood_path).crop(wood_crop),
           ['ROOF / base 1:1 / 1.465 mm per pixel', 'WOOD BENCHMARK / native base 1:1 / 1.953 mm per pixel'],
           'wood_comparison_1to1.png', native=True)
    paired(Image.open(ROOT/'source/round1/roof_base.png').crop(crop), ims[0].crop(crop),
           ['ROUND 1 / base 1:1', f'ROUND {meta["round"]} / base 1:1'], 'round_comparison_1to1.png', native=True)
    # Show feature registration independently of the text descriptions.
    diag = ims[0].resize((1024, 1024), Image.Resampling.LANCZOS)
    d = ImageDraw.Draw(diag)
    for row in meta['course_rows']:
        d.line((0, row//2, 1023, row//2), fill=(185, 48, 46), width=1)
        d.text((12, row//2+5), 'course '+str(row), fill=(135, 26, 24), font=font(13))
    diag.save(CHECK/'course_registration.jpg', quality=94)
    lights = [(-.81, .48, .342), (.74, -.583, .342)]
    relit = []
    roofs = []
    # Mesh-only sawtooth: increases toward each downward-facing cut butt,
    # drops 10 mm at the cut, and ramps gradually along the next course.
    mesh = np.zeros((n, 1), np.float32)
    for i, end in enumerate(meta['course_rows']):
        start = meta['course_rows'][i-1]
        length = (end-start) % n
        rows = (np.arange(length)+start) % n
        mesh[rows, 0] = np.arange(length)/length*10
    mesh_dy = (np.roll(mesh, -1, 0)-np.roll(mesh, 1, 0))/(2*px)
    mesh_norm = np.stack([-dx, dy+mesh_dy, np.ones_like(h)], axis=2)
    mesh_norm /= np.linalg.norm(mesh_norm, axis=2, keepdims=True)
    for i, light in enumerate(lights):
        title = ['Northwest sun', 'Southeast sun'][i]
        lit = relight(base/255, actual.astype(np.float32), orm8/255, h.astype(np.float32), light, px)
        lit.save(CHECK/('relit_'+str(i+1)+'.png'))
        lit.crop(crop).save(CHECK/('relit_'+str(i+1)+'_1to1.png'))
        repeat = Image.new('RGB', (2048, 2048))
        tile = lit.resize((1024, 1024), Image.Resampling.LANCZOS)
        for y in range(2):
            for x in range(2):
                repeat.paste(tile, (x*1024, y*1024))
        relit.append(labeled(repeat, title+' / 2 x 2 / delivered maps only', 1536))
        mesh_lit = relight(base/255, mesh_norm.astype(np.float32), orm8/255,
                           (h+mesh).astype(np.float32), light, px, late_sun=True)
        roofs.append(roof_projection(mesh_lit, title+' / warm late sun / flat reed roof'))
    out = Image.new('RGB', (3072, 1574))
    out.paste(relit[0], (0, 0)); out.paste(relit[1], (1536, 0))
    out.save(CHECK/'relighting.jpg', quality=95, subsampling=0)
    out = Image.new('RGB', (2600, 900))
    out.paste(roofs[0], (0, 0)); out.paste(roofs[1], (1300, 0))
    out.save(CHECK/'roof_preview.jpg', quality=95, subsampling=0)
    concept = Image.open(ROOT/'../../ref/concept/house_high.png')
    paired(roofs[0], concept, [f'ROUND {meta["round"]} / four-panel roof / northwest sun', 'REPOSITORY CONCEPT / house_high.png / original colour'],
           'concept_comparison.jpg')
    paired(ims[0], concept, [f'ROUND {meta["round"]} / roof_base.png / unlit', 'REPOSITORY CONCEPT / house_high.png / original colour'],
           'base_concept_comparison.jpg')
    (CHECK/'comparison_sources.json').write_text(json.dumps(dict(
        roof_crop=list(crop), wood_crop=list(wood_crop), wood_file=str(wood_path.resolve()),
        wood_sha256=hashlib.sha256(wood_path.read_bytes()).hexdigest(),
        concept_file=str((ROOT/'../../ref/concept/house_high.png').resolve()),
        concept_sha256=hashlib.sha256((ROOT/'../../ref/concept/house_high.png').read_bytes()).hexdigest(),
        native_comparison_resampling='none; 1 source pixel per output pixel',
        concept_colour_adjustment='none'), indent=2)+'\n')
    print(json.dumps(dict(passed=metrics['passed'], failures=[k for k, v in checks.items() if not v],
                          base_mean=metrics['base_colour_mean_srgb_8bit'],
                          normal=normal_metrics, engine_seams=engine_seams, seams=seams), indent=2))
    if not metrics['passed']:
        raise SystemExit('Material validation failed; see checks/metrics.json')


if __name__ == '__main__':
    main()
