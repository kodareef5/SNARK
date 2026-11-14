#!/usr/bin/env python3
"""Validate the SAVED maps independently; write reproducible visual diagnostics."""
from pathlib import Path
import json
import hashlib
import struct
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


def main():
    images={}
    arrays={}
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
    seam_acceptance={}
    for layer,s in seams.items():
        x_ratio=s['x_left_right']['wrap_to_line_p95']
        assert x_ratio<1.25,(layer,'left/right seam',x_ratio)
        if NAME=='floor':
            # A butt seam is intentionally stronger than ordinary reed skin.
            internal=max(s['intended_internal_mat_joints'].values())
            y_ratio=s['y_top_bottom']['wrap_mean']/max(internal,1e-10)
            y_reference='strongest of the two intended internal mat butt joints'
        else:
            y_ratio=s['y_top_bottom']['wrap_to_line_p95']
            y_reference='95th percentile full-length interior adjacent-row difference'
        assert y_ratio<1.25,(layer,'top/bottom seam',y_ratio)
        seam_acceptance[layer]={'x_ratio_to_interior_p95':x_ratio,
                                'y_ratio':y_ratio,'y_reference':y_reference,
                                'maximum_allowed_ratio':1.25,'passed':True}
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
             'assertions_passed':True,
             'note':'Wrap pixels are adjacent samples, not duplicate rows. Intended mat butt seams are also compared to internal joints. All visual sheets come from delivered PNGs.'}
    if NAME=='floor':
        coords=MAN['layout']['cord_x_per_mat']
        spacings=np.concatenate([np.diff(np.r_[row,row[0]+SIZE]) for row in coords])*pitch
        metrics['cord_spacing_mm']={'min':float(spacings.min()),'max':float(spacings.max()),'mean':float(spacings.mean())}
        assert spacings.min()>=250 and spacings.max()<=300
    # Frequency proxy distinguishes native detail from a blurred enlargement.
    luma=np.sum(b*np.array([.2126,.7152,.0722]),axis=2)
    metrics['base_native_detail_rms_8bit']=float(np.std(luma-gaussian_filter(luma,.8,mode='wrap'))*255)
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
    for key,light in [('upper_left',[-.65,.75,.65]),('lower_right',[.65,-.75,.65])]:
        pic=relight(b.astype(np.float32),n.astype(np.float32),orm.astype(np.float32),light)
        pic.save(OUT/f'relit_{key}.jpg',quality=95,subsampling=0)
        lighting.append((f'{key.replace("_"," ")} / material',pic))
    for key,light in [('upper_left',[-.65,.75,.65]),('lower_right',[.65,-.75,.65])]:
        lighting.append((f'{key.replace("_"," ")} / neutral relief',relight(b.astype(np.float32),n.astype(np.float32),orm.astype(np.float32),light,True)))
    sheet(lighting,2,1024).save(OUT/'relighting.jpg',quality=94,subsampling=0)
    # True 1:1 768px crops; no resampling in this sheet.
    crop=(352,384,1120,1152) if NAME=='floor' else (512,448,1280,1216)
    crop_items=[(f'1:1 / {k}',display[k].crop(crop)) for k in display]
    sheet(crop_items,2,768).save(OUT/'native_crop_layers.png')
    images['base'].crop(crop).save(OUT/'native_crop.png')
    if NAME=='earth':
        bands=Image.new('RGB',(2048,4*(205+38)),(26,26,25))
        for i,y in enumerate([80,525,1090,1635]):
            label(bands,(12,i*243+8),f'1:1 foundation fill band / 150 mm high / image row {y}')
            bands.paste(images['base'].crop((0,y,2048,y+205)),(0,i*243+38))
        bands.save(OUT/'foundation_bands.jpg',quality=95,subsampling=0)
    print(json.dumps({'material':NAME,'normal_error_deg':metrics['normal_against_delivered_height_deg'],
                      'mean_base':metrics['base_mean_srgb_8bit'],
                      'seam_to_p95':{k:{axis:round(v[axis]['wrap_to_line_p95'],3) for axis in ['x_left_right','y_top_bottom']} for k,v in seams.items()},
                      'assertions_passed':True}),flush=True)


if __name__=='__main__':
    main()
