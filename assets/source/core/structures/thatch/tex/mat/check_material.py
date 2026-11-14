#!/usr/bin/env python3
"""Validate the delivered maps and regenerate every visual check, offline."""
from pathlib import Path
import hashlib
import json
import struct

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import gaussian_filter

ROOT = Path(__file__).resolve().parent
CHECK = ROOT/'checks'
N = 2048
TILE_M = 1.5
HEIGHT_MM = 8.
NAMES = ['base','height','normal','orm']


def save_view(path, array):
    Image.fromarray(np.clip(np.rint(array),0,255).astype(np.uint8)).save(CHECK/path)


def sheet(items, path, columns=2, side=768):
    rows = (len(items)+columns-1)//columns
    canvas = Image.new('RGB',(columns*side, rows*(side+36)),(25,26,25))
    draw = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',17)
    except OSError:
        font = ImageFont.load_default()
    for idx,(label,im) in enumerate(items):
        x, y = (idx%columns)*side,(idx//columns)*(side+36)
        draw.text((x+12,y+10),label,fill=(234,233,223),font=font)
        canvas.paste(im.convert('RGB').resize((side,side),Image.Resampling.LANCZOS),(x,y+36))
    canvas.save(CHECK/path,quality=94,subsampling=0)


def seam_stats(a):
    """All errors in encoded 8-bit-equivalent units, even for uint16 height."""
    a = a.astype(np.float64)
    if a.ndim == 2:
        a = a[...,None]
    result = {}
    for axis,label in [(1,'left_right'),(0,'top_bottom')]:
        wrap = np.abs(np.take(a,0,axis)-np.take(a,-1,axis))
        interior = np.abs(np.diff(a,axis=axis))
        other = 0 if axis == 1 else 1
        edge_means = interior.mean(axis=(other,2))
        mean = float(wrap.mean())
        p95 = float(np.percentile(edge_means,95))
        result[label] = {'wrap_mean':mean,'interior_mean':float(interior.mean()),
            'interior_line_p50':float(np.median(edge_means)),
            'interior_line_p95':p95,'wrap_to_interior_p95':mean/max(p95,1.e-8),
            'wrap_pixel_p99':float(np.percentile(wrap,99)),
            'interior_pixel_p99':float(np.percentile(interior,99)),
            'within_interior_p95':bool(mean<=p95)}
    return result


def decode_srgb(s):
    return np.where(s<=.04045,s/12.92,((s+.055)/1.055)**2.4)


def encode_srgb(l):
    l = np.maximum(l,0)
    return np.where(l<=.0031308,12.92*l,1.055*l**(1/2.4)-.055)


def main():
    CHECK.mkdir(exist_ok=True)
    maps = {name:np.array(Image.open(ROOT/f'mat_{name}.png')) for name in NAMES}
    formats = {}
    for name in NAMES:
        path = ROOT/f'mat_{name}.png'
        with Image.open(path) as im:
            ihdr = struct.unpack('>IIBBBBB',path.read_bytes()[16:29])
            formats[name] = {'size':list(im.size),'mode':im.mode,'bit_depth':ihdr[2],
                'png_color_type':ihdr[3],'has_icc_profile':bool(im.info.get('icc_profile')),
                'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
                'pixel_sha256':hashlib.sha256(im.tobytes()).hexdigest()}
            assert im.size == (N,N), f'{name}: wrong dimensions'
            assert ihdr[2] == (16 if name=='height' else 8), f'{name}: wrong bit depth'
            assert ihdr[3] == (0 if name=='height' else 2), f'{name}: wrong channels'
            assert bool(im.info.get('icc_profile')) == (name=='base'), f'{name}: colour profile'
    base = maps['base'].astype(np.float32)
    height = maps['height'].astype(np.float64) * HEIGHT_MM / 65535.
    normal_raw = maps['normal'].astype(np.float64)/127.5-1.
    lengths = np.linalg.norm(normal_raw,axis=-1)
    normal = normal_raw/lengths[...,None]
    orm = maps['orm'].astype(np.float64)/255.
    # Independent reconstruction: pad the saved height, differentiate, normalize.
    hp = np.pad(height,1,mode='wrap')
    px_mm = TILE_M*1000/N
    dx = (hp[1:-1,2:]-hp[1:-1,:-2])/(2*px_mm)
    drow = (hp[2:,1:-1]-hp[:-2,1:-1])/(2*px_mm)
    expected = np.stack([-dx,drow,np.ones_like(dx)],-1)
    expected /= np.linalg.norm(expected,axis=-1,keepdims=True)
    angular = np.degrees(np.arccos(np.clip((normal*expected).sum(-1),-1,1)))
    directx = expected.copy()
    directx[...,1] *= -1
    wrong_g = np.degrees(np.arccos(np.clip((normal*directx).sum(-1),-1,1)))
    assert angular.max()<.45, 'Normal does not agree with height within 8-bit quantization'
    assert np.all(maps['orm'][...,2]==0),'Nonzero metalness'
    mean = base.astype(np.float64).mean((0,1))
    assert np.max(np.abs(mean-[178,160,118]))<.1,'Base colour mean missed target'
    seam = {name:seam_stats(a*(255./65535.) if name=='height' else a) for name,a in maps.items()}
    assert all(s['within_interior_p95'] for m in seam.values() for s in m.values()), 'A border exceeds normal interior variation'

    fields = np.load(ROOT/'source/derivation.npz')
    u,v = fields['u'],fields['v']
    ui,vi = np.floor(u).astype(int),np.floor(v).astype(int)
    label = (vi%40)*40+(ui%40)
    centre_distance = (u-ui-.5)**2+(v-vi-.5)**2
    mins = np.full(1600,np.inf)
    np.minimum.at(mins,label.ravel(),centre_distance.ravel())
    centres = centre_distance==mins[label]
    expected_top = ((ui-vi)%4)<2
    wrong_centres = np.count_nonzero((fields['horizontal_top'][centres]>.5)!=expected_top[centres])
    assert np.count_nonzero(centres)==1600 and wrong_centres==0,'Incorrect 2/2 crossing order'
    # Central differences on the unwrapped coordinates, excluding wrap jumps.
    du = np.diff(u,axis=1)
    dv = np.diff(v,axis=0)
    assert du.min()>0 and dv.min()>0,'Warp folds or reverses strips'
    wrap_du = u[:,0]+40-u[:,-1]
    wrap_dv = v[0]+40-v[-1]
    assert wrap_du.min()>0 and wrap_dv.min()>0,'Grid does not continue at the border'
    du_dy,du_dx = np.gradient(u)
    dv_dy,dv_dx = np.gradient(v)
    jacobian = du_dx*dv_dy-du_dy*dv_dx
    assert jacobian.min()>0,'Grid contains a folded cell'
    wear = fields['wear'].ravel()[::7]
    wear_correlation = float(np.corrcoef(wear,orm[...,1].ravel()[::7])[0,1])
    assert wear_correlation<-.6,'Worn areas should be smoother'
    cavity = gaussian_filter(height,3.,mode='wrap')-height
    cavity_ao = float(orm[...,0][cavity>.2].mean())
    flat_ao = float(orm[...,0][np.abs(cavity)<.015].mean())
    assert cavity_ao<flat_ao,'Cavity AO appears inverted'
    baseline_path = CHECK/'rebuild_baseline.json'
    rebuild = None
    if baseline_path.exists():
        baseline = json.loads(baseline_path.read_text())
        rebuild = {name:formats[name]['pixel_sha256']==baseline[name] for name in NAMES}
        assert all(rebuild.values()),'Rebuilt pixels differ from the saved reference; if intentionally changing the material, refresh or remove checks/rebuild_baseline.json'
    metrics = {'physical':{'tile_metres':[TILE_M,TILE_M],'resolution':[N,N],
        'strip_count_each_axis':40,'nominal_strip_pitch_mm':37.5,'pixel_mm':px_mm,
        'full_height_range_mm':HEIGHT_MM,'actual_height_min_max_mm':[float(height.min()),float(height.max())]},
        'formats':formats,'base_mean_srgb':mean.tolist(),
        'base_channel_min_max':[[int(base[...,i].min()),int(base[...,i].max())] for i in range(3)],
        'wrap_seams_8bit_equivalent':seam,
        'normal_height_agreement_degrees':{'mean':float(angular.mean()),'p99':float(np.percentile(angular,99)),
            'max':float(angular.max()),'wrong_green_convention_mean':float(wrong_g.mean())},
        'decoded_normal_length':{'mean':float(lengths.mean()),'max_error':float(np.max(np.abs(lengths-1)))},
        'weave':{'verified_crossings':int(np.count_nonzero(centres)),'wrong_crossings':int(wrong_centres),
            'pattern':'horizontal on top iff (column - row) mod 4 is 0 or 1; both axes 40',
            'minimum_grid_axis_derivatives':[float(du.min()),float(dv.min())],
            'minimum_grid_jacobian_determinant':float(jacobian.min()),
            'wrap_axis_derivative_minima':[float(wrap_du.min()),float(wrap_dv.min())]},
        'roughness':{'min':float(orm[...,1].min()),'max':float(orm[...,1].max()),
            'mean':float(orm[...,1].mean()),'wear_correlation':wear_correlation},
        'ao':{'min':float(orm[...,0].min()),'mean':float(orm[...,0].mean()),
            'cavity_mean':cavity_ao,'flat_mean':flat_ao},
        'metalness_nonzero_pixels':int(np.count_nonzero(maps['orm'][...,2])),
        'native_detail':{'procedural_fibre_rms_mm':float(fields['native_fibre_mm'].std()),
            'base_highpass_rms_1px':float((base-gaussian_filter(base,(1.,1.,0.),mode='wrap')).std())},
        'rebuild_matches_saved_pixel_hashes':rebuild,
        'checks_passed':True}
    (CHECK/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
    display = {name:Image.fromarray((a/257.).astype(np.uint8) if name=='height' else a) for name,a in maps.items()}
    sheet([(f'mat_{name} | '+('sRGB' if name=='base' else 'linear data'),im) for name,im in display.items()],
          'layers.jpg')
    offsets=[]
    for name,a in maps.items():
        off=np.roll(a,(N//2,N//2),axis=(0,1))
        Image.fromarray(off).save(CHECK/f'{name}_half_offset.png')
        off_view=Image.fromarray((off/257.).astype(np.uint8) if name=='height' else off)
        offsets.append((f'{name} | wrap offset 1024,1024',off_view))
    sheet(offsets,'offsets.jpg')
    tile=Image.fromarray(np.tile(maps['base'],(3,3,1)))
    tile.save(CHECK/'base_tiled_3x3.png')
    tile.resize((1920,1920),Image.Resampling.LANCZOS).save(CHECK/'tilings.jpg',quality=95,subsampling=0)
    crop=(704,704,1344,1344)
    display['base'].crop(crop).save(CHECK/'base_crop_1to1.png')
    display['normal'].crop(crop).save(CHECK/'normal_crop_1to1.png')
    sheet([(f'{name} | 1:1, x704 y704, 640px',display[name].crop(crop)) for name in ['base','normal']],
          'detail_1to1.png',side=640)
    sheet([(f'{name} | aligned 640px crop',display[name].crop(crop)) for name in NAMES],
          'alignment.jpg',side=640)
    # Relighting is diagnostic. The delivered base contains none of this light.
    linear=decode_srgb(base/255.)
    lighting=[]
    lights=[('upper left',[-.63,.45,.64]),('lower right',[.57,-.55,.61]),('upper grazing',[.1,.86,.5])]
    for label,vec in lights:
        light=np.array(vec)/np.linalg.norm(vec)
        ndotl=np.maximum(0.,(normal*light).sum(-1))
        shade=.28*orm[...,0]+.91*ndotl*(.75+.25*orm[...,0])
        lit=encode_srgb(linear*shade[...,None])
        lit=Image.fromarray(np.uint8(np.clip(np.rint(lit*255),0,255)))
        lit.save(CHECK/('relit_'+label.replace(' ','_')+'.png'))
        lighting.append((label+' | full tile',lit))
    lighting.extend([(label.replace('full tile','1:1 detail'),im.crop(crop)) for label,im in lighting.copy()])
    sheet(lighting,'relighting.jpg',columns=3,side=640)
    # Neutral clay views expose the crossing shape independently of pigmentation.
    clay=[]
    for label,vec in lights[:2]:
        light=np.array(vec)/np.linalg.norm(vec)
        shade=.25*orm[...,0]+.72*np.maximum(0.,(normal*light).sum(-1))
        im=Image.fromarray(np.uint8(np.clip(encode_srgb(shade)*220,0,255))).convert('RGB')
        clay.append((label+' | height-derived normals + AO',im.crop(crop)))
    sheet(clay,'clay_crossings.jpg',side=640)
    print(json.dumps({k:metrics[k] for k in ['base_mean_srgb','normal_height_agreement_degrees',
        'weave','roughness','ao','checks_passed']},indent=2))
    print('Checks and previews saved in',CHECK)


if __name__=='__main__':
    main()
