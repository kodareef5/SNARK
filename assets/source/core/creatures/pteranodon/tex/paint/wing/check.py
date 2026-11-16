#!/usr/bin/env python3
"""Check the delivered textures, physical scales, ownership and face registration."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.spatial import cKDTree
from scipy.ndimage import map_coordinates, binary_erosion

sys.dont_write_bytecode = True
import paint

HERE = Path(__file__).resolve().parent
LAYERS = HERE/'layers'
CHECKS = HERE/'checks'
MAT = paint.MATERIAL


def load(name):
    return np.asarray(Image.open(LAYERS/f'{MAT}_{name}.png'))


def main():
    w = paint.Wing()
    base,h,r,o = [load(n) for n in ['base','height','rough','occlusion']]
    masks = np.concatenate([load('mask'),load('mask2')],axis=2)
    assert base.shape == w.shape+(4,)
    assert h.dtype == np.uint16 and h.shape == w.shape
    assert all(a.dtype == np.uint8 for a in [base,r,o,masks])
    assert np.array_equal(base[...,3],w.cover.astype(np.uint8)*255)
    assert np.all(np.ptp(base[...,:3][w.cover],axis=1)==0)
    for a in [base,h,r,o,masks]:
        assert np.all(a[~w.cover] == 0), 'paint escaped the owned pieces'
    assert np.all(masks.sum(2)[w.cover] == 255)
    assert not masks[...,2:4].any(), 'wing must not use regions 2 or 3'
    assert np.all(masks[...,5][w.mask('arm')]==255)
    lum = paint.linear(base[...,0]/255.)
    weighted = {}
    for k in [0,1,4,5]:
        a = masks[...,k].astype(np.float32)
        mean = float((lum*a).sum(dtype=np.float64)/a.sum(dtype=np.float64))
        assert abs(mean-.5)<.001
        weighted[str(k)] = mean
    parts = {}
    for piece in w.meta['pieces']:
        sel = w.mask(piece['name'])
        values = lum[sel]
        parts[piece['name']] = {'texels':int(sel.sum()),'linear_mean':float(values.mean()),
             'srgb_range':[int(base[...,0][sel].min()),int(base[...,0][sel].max())],
             'height_mm_range':[float(v) for v in np.percentile(h[sel]/65535*.8,[0,100])],
             'roughness_range':[float(v) for v in np.percentile(r[sel]/255.,[0,100])],
             'fine_occlusion_range':[float(v) for v in np.percentile(o[sel]/255.,[0,100])]}
    assert abs(parts['membrane_upper']['linear_mean']-.4)<.003
    assert abs(parts['membrane_under']['linear_mean']-.6)<.003
    upper,under = w.mask('membrane_upper'),w.mask('membrane_under')
    # Registration is measured in X/Z, the skin's middle surface; the physical
    # upper/under Y separation intentionally differs by the model's thickness.
    upper_pos = np.c_[w.x[upper],w.z[upper]]
    under_pos = np.c_[w.x[under],w.z[under]]
    dist,idx = cKDTree(upper_pos).query(under_pos)
    same = dist < .0015
    veins = np.asarray(Image.open(CHECKS/'veins.png')).astype(np.float32)/65535
    raw_correlation = float(np.corrcoef(veins[upper][idx][same],veins[under][same])[0,1])
    # Reproject through the local position Jacobian, so the comparison tests
    # the same point in skin rather than two grids offset by ~0.7 mm.
    uy,ux = np.where(upper); yy,xx = uy[idx],ux[idx]
    dxr,dxc = np.gradient(w.x);dzr,dzc = np.gradient(w.z)
    ex = under_pos[:,0]-upper_pos[idx,0]
    ez = under_pos[:,1]-upper_pos[idx,1]
    det = dxc[yy,xx]*dzr[yy,xx]-dxr[yy,xx]*dzc[yy,xx]
    det = np.where(abs(det)<1e-10,1e-10,det)
    col = (ex*dzr[yy,xx]-ez*dxr[yy,xx])/det
    row = (ez*dxc[yy,xx]-ex*dzc[yy,xx])/det
    matched = same & binary_erosion(upper,iterations=2)[yy,xx]
    projected = map_coordinates(veins,[yy+row,xx+col],order=1,prefilter=False)
    correlation = float(np.corrcoef(projected[matched],veins[under][matched])[0,1])
    assert correlation > .96
    mask_error = abs(masks[upper][idx][same].astype(float)-masks[under][same].astype(float))
    # Tip and wash have shared object coordinates; only nearest-texel rounding remains.
    assert float(np.percentile(mask_error,99)) <= 3
    vein_core = w.mem & (veins>.55)
    vein_surround = w.mem & (veins<.04)
    core_contrast = {}
    for name in ['membrane_upper','membrane_under']:
        p = w.mask(name)
        core_contrast[name] = 1-float(lum[p&vein_core].mean()/lum[p&vein_surround].mean())
    recipe = paint.RECIPE
    shaft_mm = float(np.median(w.mm[w.mem]))
    assert recipe['trunk_fwhm_mm'][0]/shaft_mm >= 2
    paths = json.loads((CHECKS/'vessels.json').read_text())
    trunks = [p for p in paths if p['kind'] == 'trunk']
    assert 2 <= len(trunks) <= 4, 'review calls for a few main supplies'
    trunk_lengths = [float(np.linalg.norm(np.diff(p['points'],axis=0),axis=1).sum()) for p in trunks]
    trunk_widths = [float(p['width'])/shaft_mm for p in trunks]
    assert min(trunk_widths) >= 2 and max(trunk_widths) <= 3
    connections = sum(bool(p.get('join') or p.get('joined')) for p in paths)
    assert connections > 0, 'the vascular network needs occasional reconnections'
    stats = {
        'passed':True,'painted_texels':int(w.cover.sum()),'neutral_rgb':True,
        'mask_sum_on_every_owned_texel':255,'unowned_nonzero_pixels':0,
        'region_weighted_linear_means':weighted,'pieces':parts,
        'face_registration':{'pairs':int(same.sum()),'median_distance_mm':float(np.median(dist)*1000),
            'vein_correlation_subpixel':correlation,'vein_correlation_nearest':raw_correlation,'mask_error_p99_levels':float(np.percentile(mask_error,99)),
            'mask_error_max_levels':float(mask_error.max())},
        'main_vessel_fwhm_mm':recipe['trunk_fwhm_mm'],
        'minimum_main_vessel_fwhm_texels':recipe['trunk_fwhm_mm'][0]/shaft_mm,
        'vessel_core_darkening_linear':core_contrast,
        'vessel_segments':len(paths),'height_encoding_mm':.8,
        'main_supplies':len(trunks),'trunk_lengths_m':trunk_lengths,
        'trunk_root_widths_texels':trunk_widths,'reconnections':connections,
        'arm_flow_dot_uv_length_median':float(np.median(w.flow[w.mask('arm'),0])),
        'finger_flow_dot_uv_length_median':float(np.median(w.flow[w.mask('finger'),0])),
        'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(LAYERS.iterdir()) if p.is_file()}}
    if '--baseline' in sys.argv:
        folder = Path(sys.argv[sys.argv.index('--baseline')+1])
        preservation = {}
        limbs = w.mask('arm') | w.mask('finger')
        for name in ['base','height','rough','occlusion','mask','mask2']:
            old = np.asarray(Image.open(folder/f'{MAT}_{name}.png'))
            new = load(name)
            difference = abs(old.astype(np.float64)-new)
            preservation[name] = {
                'changed_values':int(np.count_nonzero(difference)),
                'limb_changed_values':int(np.count_nonzero(difference[limbs])),
                'limb_max_change':float(difference[limbs].max())}
            if name in ['mask','mask2','occlusion']:
                assert not difference.any(), f'accepted {name} changed'
            if name != 'base':
                assert not difference[limbs].any(), f'accepted limb {name} changed'
            else:
                # The same limb drawing may round one sRGB level differently
                # after the whole-material region means are held at 0.50 again.
                assert difference[limbs].max() <= 1
        stats['accepted_surface_preservation'] = preservation
    # Neutral, natural dye, loud and near-black unlit texture previews. A preview
    # has no fake light and therefore shows whether drawing lives in the base.
    palettes = {
       'design':['2E3134','9C8B78','C8662E','2A2C2F','56677A','E9E4D8'],
       'loud':['2030C0','FFE020','9FE01F','FF3EA5','FF3EA5','9FE01F'],
       'dark':['E6E3DC','4A3A2E','E0C07E','6E2E2A','24282A','3C3A38']}
    for name,palette in palettes.items():
        colors = paint.linear(np.array([[int(v[i:i+2],16) for i in [0,2,4]] for v in palette])/255)
        color = np.zeros(w.shape+(3,),np.float32)
        for k in range(6):
            color += masks[...,k,None].astype(np.float32)/255*colors[k]
        color = np.rint(paint.srgb(color*lum[...,None]/.5)*255).astype(np.uint8)
        color[~w.cover] = [218,216,210]
        Image.fromarray(color).save(CHECKS/f'unlit_{name}.png')
    if '--rebuild' in sys.argv:
        before = stats['files'].copy()
        subprocess.run([sys.executable,str(HERE/'paint.py')],check=True)
        after = {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(LAYERS.iterdir()) if p.is_file()}
        assert before == after, 'rebuild changed delivery bytes'
        stats['byte_identical_rebuild'] = True
    (CHECKS/'measurements.json').write_text(json.dumps(stats,indent=2)+'\n')
    print(json.dumps({k:v for k,v in stats.items() if k not in ['files','pieces']},indent=2))


if __name__ == '__main__':
    main()
