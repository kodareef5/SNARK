#!/usr/bin/env python3
"""Validate the SAVED maps independently; write reproducible visual diagnostics."""
from pathlib import Path
import json
import hashlib
import struct
import argparse
import subprocess
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import gaussian_filter

ROOT=Path(__file__).resolve().parent
NAME=ROOT.name
OUT=ROOT/'checks'
OUT.mkdir(exist_ok=True)
SIZE=2048
MAN=json.loads((ROOT/'source/build_manifest.json').read_text())


def im(a):
    return Image.fromarray(np.clip(np.rint(a),0,255).astype(np.uint8))


def label(canvas, xy, text):
    d=ImageDraw.Draw(canvas)
    try:
        font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',20)
    except OSError:
        font=ImageFont.load_default(size=20)
    d.text(xy,text,fill=(235,230,218),font=font)


def sheet(items, columns, cell=768):
    rows=(len(items)+columns-1)//columns
    result=Image.new('RGB',(columns*cell,rows*(cell+38)),(26,26,25))
    for i,(name,pic) in enumerate(items):
        x=(i%columns)*cell
        y=(i//columns)*(cell+38)
        label(result,(x+12,y+8),name)
        result.paste(pic.convert('RGB').resize((cell,cell),Image.Resampling.LANCZOS),(x,y+38))
    return result


def srgb_to_linear(c):
    return np.where(c<=.04045,c/12.92,((c+.055)/1.055)**2.4)


def linear_to_srgb(c):
    c=np.clip(c,0,1)
    return np.where(c<=.0031308,c*12.92,1.055*c**(1/2.4)-.055)


def relight(base, norm, orm, light, neutral=False):
    """Diagnostic orthographic dielectric GGX + diffuse, linear-light shading.

    View is +Z, fixed dielectric F0=.04, hemispherical ambient and one light.
    This is a relief inspection, not an engine screenshot or ray-traced render.
    """
    l=np.array(light,dtype=np.float32)
    l/=np.linalg.norm(l)
    v=np.array([0,0,1],np.float32)
    hv=(l+v)/np.linalg.norm(l+v)
    nl=np.maximum(0,np.sum(norm*l,axis=2))
    nv=np.maximum(.001,norm[:,:,2])
    nh=np.maximum(0,np.sum(norm*hv,axis=2))
    vh=float(v@hv)
    rough=orm[:,:,1]
    alpha2=rough**4
    distribution=alpha2/(np.pi*(nh*nh*(alpha2-1)+1)**2+1e-7)
    k=(rough+1)**2/8
    g1=nv/(nv*(1-k)+k)
    g2=nl/(nl*(1-k)+k+1e-7)
    fresnel=.04+.96*(1-vh)**5
    spec=distribution*g1*g2*fresnel/(4*nv*nl+1e-5)
    color=np.full_like(base,.29) if neutral else srgb_to_linear(base)
    ambient=.24*orm[:,:,0]
    result=color*(ambient+nl*.96)[...,None]+(spec*nl*.8)[...,None]
    return im(linear_to_srgb(result)*255)


def seam_stats(a):
    if a.ndim==2:
        a=a[:,:,None]
    out={}
    for axis,key in [(1,'x_left_right'),(0,'y_top_bottom')]:
        interior=np.abs(np.diff(a,axis=axis))
        edge=np.abs(np.take(a,0,axis=axis)-np.take(a,-1,axis=axis))
        # Compare mean at wrap to distribution of full-length interior joins.
        reduction=(0,2) if axis==1 else (1,2)
        lines=interior.mean(axis=reduction)
        out[key]={'wrap_mean':float(edge.mean()),'interior_mean':float(interior.mean()),
                  'interior_line_p95':float(np.percentile(lines,95)),
                  'wrap_to_interior_mean':float(edge.mean()/max(interior.mean(),1e-10)),
                  'wrap_to_line_p95':float(edge.mean()/max(np.percentile(lines,95),1e-10)),
                  'wrap_pixel_p99':float(np.percentile(edge,99))}
    if NAME=='floor':
        out['intended_internal_mat_joints']={str(y):float(np.abs(a[y]-a[y-1]).mean()) for y in [683,1365]}
    return out


def engine_seams(samples):
    """Exact engine ratio on delivered integer samples, summed over channels.

    Signed int64 subtraction prevents uint8/uint16 underflow; int64 sums avoid
    overflow. No percentile normalization or exception for intended mat seams.
    """
    a=np.asarray(samples,dtype=np.int64)
    result={}
    for axis,key in [(1,'seam_x'),(0,'seam_y')]:
        edge=int(np.abs(np.take(a,-1,axis=axis)-np.take(a,0,axis=axis)).sum(dtype=np.int64))
        inner=int(np.abs(np.diff(a,axis=axis)).sum(dtype=np.int64))
        ratio=edge*(a.shape[axis]-1)/inner if inner else (0.0 if edge==0 else float('inf'))
        result[key]={'edge_abs_sum':edge,'interior_abs_sum':inner,
                     'interior_step_count':a.shape[axis]-1,'ratio':ratio}
    return result


def check_engine_formula():
    # Independent scalar form covers RGB channel summing, 16-bit underflow and
    # the constant-map convention, without reusing vectorized differences.
    cases=[np.array([[[0,255,10],[20,0,40],[30,20,255]],
                     [[255,30,0],[70,255,50],[0,80,10]]],dtype=np.uint8),
           np.array([[0,65535,100],[65535,0,60000],[10,65000,0]],dtype=np.uint16),
           np.full((3,4,3),128,dtype=np.uint8)]
    for a in cases:
        result=engine_seams(a)
        for axis,key in [(1,'seam_x'),(0,'seam_y')]:
            v=np.moveaxis(a,axis,0).reshape(a.shape[axis],-1).tolist()
            edge=sum(abs(int(p)-int(q)) for p,q in zip(v[-1],v[0]))
            interior=sum(abs(int(p)-int(q)) for first,second in zip(v[:-1],v[1:]) for p,q in zip(first,second))
            expected=edge*(len(v)-1)/interior if interior else 0
            assert result[key]['ratio']==expected
    return {'cases':len(cases),'passed':True}


def fit_panel(canvas,pic,box):
    """Fit with aspect preserved; never stretch a perspective reference."""
    x,y,w,h=box
    pic=pic.convert('RGB').copy()
    pic.thumbnail((w,h),Image.Resampling.LANCZOS)
    canvas.paste(pic,(x+(w-pic.width)//2,y+(h-pic.height)//2))


def reference_comparisons(images,crop):
    reference=ROOT/'../../ref/concept'
    foundation=Image.open(reference/'piece_foundation.png')
    inside=Image.open(reference/'house_inside.png')
    old=Image.open(ROOT/'source/round1/floor_base.png')
    sheet([('Round 1 / full tile',old),('Round 2 / full tile',images['base']),
           ('Round 1 / native 1:1',old.crop(crop)),('Round 2 / native 1:1',images['base'].crop(crop))],2,768).save(OUT/'round1_vs_round2.jpg',quality=95,subsampling=0)
    canvas=Image.new('RGB',(1536,970),(26,26,25))
    label(canvas,(12,10),'Our concept / piece_foundation.png')
    label(canvas,(780,10),'Round 2 / unlit base / complete 3 m tile')
    fit_panel(canvas,foundation,(0,38,768,512))
    fit_panel(canvas,images['base'],(768,38,768,512))
    label(canvas,(12,572),'Our concept / house_inside.png / floor crop')
    label(canvas,(780,572),'Round 2 / native 1:1 reeds, cord and mat seam')
    inside_box=(80,844,1536,1024)
    floor_crop=inside.crop(inside_box)
    fit_panel(canvas,floor_crop,(0,610,768,300))
    canvas.paste(images['base'].crop((352,628,1120,928)),(768,610))
    label(canvas,(12,934),'Concept crops retain painted lighting; the delivered base is unlit. Reference proportions are preserved.')
    canvas.save(OUT/'concept_comparison.jpg',quality=95,subsampling=0)
    # Wide native crops keep every reed and twined crossing visible beside
    # the supplied indoor floor, without a whole-tile reduction.
    side=Image.new('RGB',(1536,378),(26,26,25))
    label(side,(12,10),'house_inside.png / floor crop (concept lighting)')
    label(side,(780,10),'floor_base.png / native 1:1 (unlit)')
    fit_panel(side,inside.crop((720,852,1536,1024)),(0,38,768,300))
    side.paste(images['base'].crop((352,628,1120,928)),(768,38))
    label(side,(12,346),'Reeds, twined cord and shallow butt joints; concept is a perspective view, not a colour sample.')
    side.save(OUT/'house_inside_comparison.jpg',quality=96,subsampling=0)
    # Both halves of the periodic seam are shown adjacent at native scale.
    boundary=Image.new('RGB',(1536,4*166),(26,26,25))
    for i,k in enumerate(['base','height','normal','orm']):
        for j,folder in enumerate([ROOT/'source/round1',ROOT]):
            pic=Image.open(folder/f'floor_{k}.png')
            if k=='height':
                pic=im(np.asarray(pic,dtype=np.float32)/65535*255)
            pic=pic.convert('RGB')
            strip=Image.new('RGB',(768,128))
            strip.paste(pic.crop((352,1984,1120,2048)),(0,0))
            strip.paste(pic.crop((352,0,1120,64)),(0,64))
            label(boundary,(j*768+12,i*166+8),f'Round {j+1} / {k} / bottom above top; join at centre')
            boundary.paste(strip,(j*768,i*166+38))
    boundary.save(OUT/'boundary_comparison.png')
    (OUT/'reference_crops.json').write_text(json.dumps({
        'references':['../../ref/concept/piece_foundation.png','../../ref/concept/house_inside.png'],
        'house_inside_floor_crop_xyxy':inside_box,
        'house_inside_detail_crop_xyxy':[720,852,1536,1024],
        'floor_native_detail_crop_xyxy':[352,628,1120,928],
        'external_images_used':False,'reference_aspect_preserved':True},indent=2)+'\n')


def main():
    formula_check=check_engine_formula()
    images={}
    arrays={}
    raw={}
    metadata={}
    for layer in ['base','height','normal','orm']:
        p=ROOT/f'{NAME}_{layer}.png'
        pic=Image.open(p)
        a=np.asarray(pic)
        header=p.read_bytes()[:29]
        w,h,depth,color_type=struct.unpack('>IIBB',header[16:26])
        assert (w,h)==(SIZE,SIZE),(layer,w,h)
        assert depth==(16 if layer=='height' else 8),(layer,depth)
        assert color_type==(0 if layer=='height' else 2),(layer,color_type)
        assert ('icc_profile' in pic.info)==(layer=='base'),(layer,'colour profile')
        images[layer]=pic
        raw[layer]=a
        arrays[layer]=a.astype(np.float64)/(65535 if layer=='height' else 255)
        metadata[layer]={'path':p.name,'size':[w,h],'bit_depth':depth,'png_color_type':color_type,
                         'icc_profile':bool(pic.info.get('icc_profile')),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
    b=arrays['base']
    h=arrays['height']*MAN['height_range_mm']
    orm=arrays['orm']
    n=arrays['normal']*2-1
    lengths=np.linalg.norm(n,axis=2)
    n/=lengths[...,None]
    # Independently reconstruct from saved height, with explicit wrapped slicing.
    hx=np.concatenate((h[:,1:],h[:,:1]),axis=1)-np.concatenate((h[:,-1:],h[:,:-1]),axis=1)
    hy=np.concatenate((h[1:],h[:1]),axis=0)-np.concatenate((h[-1:],h[:-1]),axis=0)
    pitch=MAN['tile_mm']/SIZE
    ref=np.stack((-hx/(2*pitch),hy/(2*pitch),np.ones_like(h)),axis=2)
    ref/=np.linalg.norm(ref,axis=2,keepdims=True)
    angles=np.degrees(np.arccos(np.clip((n*ref).sum(axis=2),-1,1)))
    assert angles.max()<.5,float(angles.max())
    assert np.count_nonzero(orm[:,:,2])==0,'Metalness must be zero'
    assert np.all(n[:,:,2]>0),'Normals must face outward'
    assert np.min(orm[:,:,1])>.6,'Surface must remain rough'
    # Directional convention: higher next image row means +green normal.
    significant=np.abs(hy)>pitch*.1
    green_sign_agreement=float(np.mean(np.sign(n[:,:,1][significant])==np.sign(hy[significant])))
    assert green_sign_agreement==1.0
    seams={k:seam_stats(v) for k,v in arrays.items()}
    exact={k:engine_seams(v) for k,v in raw.items()}
    seam_acceptance={}
    for layer,s in exact.items():
        for axis,record in s.items():
            assert record['ratio']<2,(layer,axis,record)
        seam_acceptance[layer]={'seam_x':s['seam_x']['ratio'],
                                'seam_y':s['seam_y']['ratio'],
                                'strict_maximum':2,'passed':True}
    metrics={'material':NAME,'files':metadata,'tile_mm':MAN['tile_mm'],
             'pixel_pitch_mm':pitch,'height_encoding_range_mm':MAN['height_range_mm'],
             'height_used_mm':[float(h.min()),float(h.max())],
             'height_percentiles_mm':dict(zip(['p01','p50','p99'],np.percentile(h,[1,50,99]).tolist())),
             'base_mean_srgb_8bit':(b.mean(axis=(0,1))*255).tolist(),
             'base_mean_linear':srgb_to_linear(b).mean(axis=(0,1)).tolist(),
             'normal_against_delivered_height_deg':{'mean':float(angles.mean()),'p99':float(np.percentile(angles,99)),'max':float(angles.max())},
             'decoded_normal_length':{'mean':float(lengths.mean()),'max_error':float(np.max(np.abs(lengths-1)))},
             'opengl_green_sign_agreement':green_sign_agreement,'metalness_nonzero_pixels':0,
             'orm_min_mean_max':{c:[float(orm[:,:,i].min()),float(orm[:,:,i].mean()),float(orm[:,:,i].max())] for i,c in enumerate(['occlusion','roughness','metalness'])},
             'wrap_seams_normalized_0_1':seams,
             'seam_acceptance':seam_acceptance,
             'engine_seams':exact,'engine_formula_check':formula_check,
             'assertions_passed':True,
             'note':'Acceptance uses the exact engine integer-sum ratio < 2 in both axes for every layer. Internal-joint and percentile values are diagnostic only. All material previews come from delivered PNGs.'}
    if NAME=='floor':
        coords=MAN['layout']['cord_x_per_mat']
        spacings=np.concatenate([np.diff(np.r_[row,row[0]+SIZE]) for row in coords])*pitch
        metrics['cord_spacing_mm']={'min':float(spacings.min()),'max':float(spacings.max()),'mean':float(spacings.mean())}
        assert spacings.min()>=250 and spacings.max()<=300
        widths=np.array([r['width_px'] for r in MAN['layout']['reeds']])
        actual_min=min(r['actual_width_min_px'] for r in MAN['layout']['reeds'])
        actual_max=max(r['actual_width_max_px'] for r in MAN['layout']['reeds'])
        metrics['reed_width_px']={'min':float(widths.min()),'max':float(widths.max()),
                                 'actual_min':actual_min,'actual_max':actual_max,'count':len(widths)}
        assert widths.min()>=3 and widths.max()<=5
        assert actual_min>=3 and actual_max<=5,('Actual reed width',actual_min,actual_max)
        assert actual_min*pitch>=4 and actual_max*pitch<=8
        assert MAN['height_range_mm']==12 and MAN['height_clipped_pixels']==0
        assert 10.5<float(h.max()-h.min())<=12
        assert np.max(np.abs(b.mean((0,1))*255-[175,135,80]))<1
        assert MAN['layout']['mat_seam_rows']==[0,683,1365] and MAN['tile_mm']==3000
        archive=ROOT/'source/round1'
        original=json.loads((archive/'archive_hashes.json').read_text())
        for path,digest in original.items():
            assert hashlib.sha256((archive/path).read_bytes()).hexdigest()==digest,('archive modified',path)
        preserved=json.loads((ROOT/'source/round2_preservation.json').read_text())
        for path,digest in preserved['earth_files'].items():
            assert hashlib.sha256((ROOT/path).read_bytes()).hexdigest()==digest,('earth modified',path)
        for source in MAN['source_images']:
            assert hashlib.sha256((ROOT/source['file']).read_bytes()).hexdigest()==original[source['file']]
        metrics['preservation']={'round1_archive_files':len(original),'earth_files':len(preserved['earth_files']),'passed':True}
        metrics['round1_engine_seams']={layer:engine_seams(np.asarray(Image.open(archive/f'floor_{layer}.png'))) for layer in raw}
    # Frequency proxy distinguishes native detail from a blurred enlargement.
    luma=np.sum(b*np.array([.2126,.7152,.0722]),axis=2)
    metrics['base_native_detail_rms_8bit']=float(np.std(luma-gaussian_filter(luma,.8,mode='wrap'))*255)
    if NAME=='floor':
        old=np.asarray(Image.open(ROOT/'source/round1/floor_base.png'),np.float64)/255
        old_luma=np.sum(old*np.array([.2126,.7152,.0722]),axis=2)
        old_detail=float(np.std(old_luma-gaussian_filter(old_luma,.8,mode='wrap'))*255)
        metrics['round1_base_native_detail_rms_8bit']=old_detail
        metrics['native_detail_gain']=metrics['base_native_detail_rms_8bit']/old_detail
    (OUT/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
    height_view=im(arrays['height']*255).convert('RGB')
    display={**images,'height':height_view}
    sheet([(f'{NAME} / {k}',display[k]) for k in display],2,768).save(OUT/'layers.jpg',quality=94,subsampling=0)
    for layer,pic in display.items():
        arr=np.asarray(pic.convert('RGB'))
        shifted=Image.fromarray(np.roll(arr,(SIZE//2,SIZE//2),axis=(0,1)))
        shifted.save(OUT/f'{layer}_offset.png')
    sheet([(f'half offset / {k}',Image.open(OUT/f'{k}_offset.png')) for k in display],2,768).save(OUT/'offsets.jpg',quality=94,subsampling=0)
    base_tile=Image.new('RGB',(SIZE*3,SIZE*3))
    for y in range(3):
        for x in range(3):
            base_tile.paste(images['base'],(x*SIZE,y*SIZE))
    base_tile.save(OUT/'base_tile3x3.jpg',quality=94,subsampling=0)
    base_tile.resize((1536,1536),Image.Resampling.LANCZOS).save(OUT/'tiling.jpg',quality=94,subsampling=0)
    tile_items=[]
    for layer,pic in display.items():
        small=pic.convert('RGB').resize((384,384),Image.Resampling.LANCZOS)
        tile=Image.new('RGB',(1152,1152))
        for y in range(3):
            for x in range(3):
                tile.paste(small,(x*384,y*384))
        tile_items.append((f'3 x 3 / {layer}',tile))
    sheet(tile_items,2,1152).save(OUT/'tilings_all_layers.jpg',quality=93,subsampling=0)
    lighting=[]
    lighting_native=[]
    native_box=(352,384,1120,1152)
    for key,light in [('upper_left',[-.65,.75,.30]),('lower_right',[.65,-.75,.30])]:
        pic=relight(b.astype(np.float32),n.astype(np.float32),orm.astype(np.float32),light)
        pic.save(OUT/f'relit_{key}.jpg',quality=95,subsampling=0)
        lighting.append((f'{key.replace("_"," ")} / material',pic))
        lighting_native.append((f'{key.replace("_"," ")} / 1:1 material',pic.crop(native_box)))
    for key,light in [('upper_left',[-.65,.75,.30]),('lower_right',[.65,-.75,.30])]:
        pic=relight(b.astype(np.float32),n.astype(np.float32),orm.astype(np.float32),light,True)
        lighting.append((f'{key.replace("_"," ")} / neutral relief',pic))
        lighting_native.append((f'{key.replace("_"," ")} / 1:1 neutral',pic.crop(native_box)))
    sheet(lighting,2,1024).save(OUT/'relighting.jpg',quality=94,subsampling=0)
    sheet(lighting_native,2,768).save(OUT/'relighting_native.jpg',quality=96,subsampling=0)
    # True 1:1 768px crops; no resampling in this sheet.
    crop=(352,384,1120,1152) if NAME=='floor' else (512,448,1280,1216)
    crop_items=[(f'1:1 / {k}',display[k].crop(crop)) for k in display]
    sheet(crop_items,2,768).save(OUT/'native_crop_layers.png')
    images['base'].crop(crop).save(OUT/'native_crop.png')
    if NAME=='floor':
        reference_comparisons(images,crop)
    if NAME=='earth':
        bands=Image.new('RGB',(2048,4*(205+38)),(26,26,25))
        for i,y in enumerate([80,525,1090,1635]):
            label(bands,(12,i*243+8),f'1:1 foundation fill band / 150 mm high / image row {y}')
            bands.paste(images['base'].crop((0,y,2048,y+205)),(0,i*243+38))
        bands.save(OUT/'foundation_bands.jpg',quality=95,subsampling=0)
    print(json.dumps({'material':NAME,'normal_error_deg':metrics['normal_against_delivered_height_deg'],
                      'mean_base':metrics['base_mean_srgb_8bit'],
                      'engine_seams':seam_acceptance,
                      'seam_to_p95':{k:{axis:round(v[axis]['wrap_to_line_p95'],3) for axis in ['x_left_right','y_top_bottom']} for k,v in seams.items()},
                      'assertions_passed':True}),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rebuild',action='store_true',help='Rebuild first and require byte-identical delivered maps')
    args=parser.parse_args()
    if args.rebuild:
        paths=[ROOT/f'{NAME}_{k}.png' for k in ['base','height','normal','orm']]
        before={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
        subprocess.run([sys.executable,str(ROOT/'build_material.py')],cwd=ROOT,check=True)
        after={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
        assert before==after,'Rebuild changed delivered PNG bytes'
        (OUT/'reproducibility.json').write_text(json.dumps({'round':2,'command':'python3 check_material.py --rebuild',
            'before_sha256':before,'after_sha256':after,'all_four_byte_identical':True},indent=2)+'\n')
        MAN=json.loads((ROOT/'source/build_manifest.json').read_text())
    main()
