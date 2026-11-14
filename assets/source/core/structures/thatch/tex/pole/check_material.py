#!/usr/bin/env python3
"""Independently validate the saved PNGs and produce repeat/alignment diagnostics.

Run after build_material.py. No generation, network access, or source mutation.
"""
from pathlib import Path
import argparse
import hashlib
import json
import struct
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'checks'
N=2048
TILE_M=1.5
HEIGHT_MM=12.0
LAYERS=['base','height','normal','orm']


def rgb8(a):
    return Image.fromarray(np.rint(np.clip(a,0,255)).astype(np.uint8))


def sheet(images, labels, columns=2, size=768):
    rows=(len(images)+columns-1)//columns
    out=Image.new('RGB',(columns*size,rows*(size+34)),(24,24,23))
    draw=ImageDraw.Draw(out)
    try:
        font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',16)
    except OSError:
        font=ImageFont.load_default()
    for i,(im,label) in enumerate(zip(images,labels)):
        x,y=(i%columns)*size,(i//columns)*(size+34)
        draw.text((x+10,y+9),label,fill=(222,220,213),font=font)
        out.paste(im.convert('RGB').resize((size,size),Image.Resampling.LANCZOS),(x,y+34))
    return out


def png_info(path):
    content=path.read_bytes()
    width,height,depth,kind=struct.unpack('>IIBB',content[16:26])
    kinds={0:'grayscale',2:'RGB',4:'grayscale+alpha',6:'RGBA'}
    chunks=[]; offset=8
    while offset<len(content):
        length=int.from_bytes(content[offset:offset+4],'big')
        chunks.append(content[offset+4:offset+8].decode())
        offset+=length+12
    return {'width':width,'height':height,'bit_depth':depth,'colour_type':kinds.get(kind,kind),
            'chunks':chunks,'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest()}


def seam_stats(a):
    a=np.asarray(a,dtype=np.float32)
    if a.ndim==2: a=a[...,None]
    result={}
    for name,axis in [('x_along_pole',1),('y_around_pole',0)]:
        delta=np.abs(np.diff(a,axis=axis))
        wrap=np.abs(np.take(a,0,axis=axis)-np.take(a,-1,axis=axis))
        # Compare line means with line means, not one boundary average with
        # a misleading percentile over millions of unrelated individual pixels.
        line_means=delta.mean(axis=(0,2) if axis==1 else (1,2))
        neighboring_lines=np.r_[line_means[:16],line_means[-16:]]
        result[name]={'wrap_mean':float(wrap.mean()),'wrap_p95_pixel':float(np.percentile(wrap,95)),
                      'interior_mean':float(delta.mean()),'interior_line_p95':float(np.percentile(line_means,95)),
                      'interior_line_p99':float(np.percentile(line_means,99)),
                      'interior_line_max':float(line_means.max()),
                      'neighboring_32_lines_mean':float(neighboring_lines.mean()),
                      'neighboring_32_lines_max':float(neighboring_lines.max()),
                      'wrap_over_interior_mean':float(wrap.mean()/max(delta.mean(),1e-8)),
                      'wrap_line_percentile':float((line_means<wrap.mean()).mean()*100)}
    return result


def srgb_to_linear(a):
    return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)


def linear_to_srgb(a):
    a=np.maximum(a,0)
    return np.where(a<=.0031308,a*12.92,1.055*a**(1/2.4)-.055)


def relight(base, normal, ao, direction, clay=False):
    l=np.asarray(direction,dtype=np.float32);l/=np.linalg.norm(l)
    ndotl=np.maximum((normal*l).sum(2),0)
    diffuse=srgb_to_linear(base/255.) if not clay else np.full(base.shape,.32,dtype=np.float32)
    # Linear-light diffuse inspection. AO only affects the ambient term.
    radiance=diffuse*(.24*ao[...,None]+1.05*ndotl[...,None])
    return rgb8(linear_to_srgb(radiance)*255)


def cylinder_preview(base,normal,ao):
    """Context preview: four 1.5m-long poles, selecting different 20-55cm bands.

    Uses actual circular geometry and transforms tangent normals onto it. This
    is diagnostic shading only; curvature never enters the supplied textures.
    """
    w,h=1680,980
    canvas=np.zeros((h,w,3),np.float32)+np.array([.040,.047,.052],np.float32)
    l=np.array([-.25,.65,.72],np.float32);l/=np.linalg.norm(l)
    for i,(start,girth) in enumerate([(70,.20),(570,.31),(1130,.43),(1680,.55)]):
        cy=125+i*240
        radius=girth/(2*np.pi)/TILE_M*1500
        yy,xx=np.mgrid[:h,:w]
        dy=(yy-cy)/radius
        mask=(abs(dy)<1)&(xx>=90)&(xx<1590)
        theta=np.arcsin(np.clip(dy,-1,1))
        u=(xx-90)/1500*N
        v=start+theta/(2*np.pi)*girth/TILE_M*N
        coords=[v%N,u%N]
        col=np.stack([ndi.map_coordinates(base[...,c],[coords[0],coords[1]],order=1,mode='grid-wrap') for c in range(3)],2)/255
        nt=np.stack([ndi.map_coordinates(normal[...,c],coords,order=1,mode='grid-wrap') for c in range(3)],2)
        ny=nt[...,1]*np.cos(theta)-nt[...,2]*np.sin(theta)
        nz=nt[...,1]*np.sin(theta)+nt[...,2]*np.cos(theta)
        light=np.maximum(nt[...,0]*l[0]+ny*l[1]+nz*l[2],0)
        amb=ndi.map_coordinates(ao,coords,order=1,mode='grid-wrap')
        colour=srgb_to_linear(col)*(.28*amb[...,None]+1.15*light[...,None])
        canvas[mask]=colour[mask]
    return rgb8(linear_to_srgb(canvas)*255)


def main():
    OUT.mkdir(exist_ok=True)
    raw={k:np.asarray(Image.open(ROOT/f'pole_{k}.png')) for k in LAYERS}
    info={k:png_info(ROOT/f'pole_{k}.png') for k in LAYERS}
    # PNG header checks are authoritative for uint16: Pillow may expose it as I.
    assertions={}
    assertions['all_2048_square']=all(v['width']==N and v['height']==N for v in info.values())
    assertions['formats_correct']=all(v['colour_type']==('grayscale' if k=='height' else 'RGB') and v['bit_depth']==(16 if k=='height' else 8) for k,v in info.items())
    assertions['base_has_srgb_profile']='iCCP' in info['base']['chunks']
    assertions['data_have_no_colour_transfer_chunks']=all(not any(c in v['chunks'] for c in ['iCCP','gAMA','sRGB']) for k,v in info.items() if k!='base')
    assertions['zero_metalness']=bool((raw['orm'][...,2]==0).all())
    # Independent finite differences from disk, with double precision.
    height=raw['height'].astype(np.float64)/65535*HEIGHT_MM/1000
    sx=(np.roll(height,-1,1)-np.roll(height,1,1))/(2*TILE_M/N)
    sy=(np.roll(height,-1,0)-np.roll(height,1,0))/(2*TILE_M/N)
    expected=np.stack([-sx,sy,np.ones_like(sx)],2)
    expected/=np.linalg.norm(expected,axis=2,keepdims=True)
    delivered=raw['normal'].astype(np.float64)/255*2-1
    lengths=np.linalg.norm(delivered,axis=2)
    normal=delivered/lengths[...,None]
    cross=np.linalg.norm(np.cross(expected,normal),axis=2)
    dot=(expected*normal).sum(2)
    angle=np.degrees(np.arctan2(cross,dot))
    normal_metrics={'mean_degrees':float(angle.mean()),'p99_degrees':float(np.percentile(angle,99)),
                    'max_degrees':float(angle.max()),'decoded_vector_length_range':[float(lengths.min()),float(lengths.max())]}
    assertions['normal_height_agreement_under_half_degree']=bool(angle.max()<.5)
    mean=raw['base'].mean((0,1))
    assertions['base_mean_within_one_code_value']=bool(np.max(abs(mean-[132,112,88]))<1)
    seams={k:seam_stats(v.astype(np.float32)/(257 if k=='height' else 1)) for k,v in raw.items()}
    # Long horizontal checks can legitimately exceed the global 99th percentile.
    # Detect isolated jumps relative to BOTH the local strip and the full image.
    # Keep p95/p99 and the full ratio in the JSON for transparent interpretation.
    assertions['seams_within_interior_and_local_line_ranges']=all(s['wrap_mean']<=min(s['interior_line_max'],s['neighboring_32_lines_max']) for m in seams.values() for s in m.values())
    deriv=np.load(OUT/'derivation.npz')
    bark=deriv['bark'].astype(np.float32)
    incisions=deriv['incisions'].astype(np.float32)
    coverage={}
    for cm in [20,55]:
        band=int(round(cm/100/TILE_M*N))
        by_row=(bark>.5).mean(1)
        bands=ndi.uniform_filter1d(by_row,size=band,mode='wrap')
        coverage[f'{cm}cm_band_bark_fraction_min_max']=[float(bands.min()),float(bands.max())]
    coverage['whole_tile_bark_fraction']=float((bark>.5).mean())
    assertions['bark_about_fifteen_percent']=.13<coverage['whole_tile_bark_fraction']<.17
    assertions['all_20cm_bands_mixed']=coverage['20cm_band_bark_fraction_min_max'][0]>.06 and coverage['20cm_band_bark_fraction_min_max'][1]<.25
    semantic={'mean_height_wood_mm':float(height[bark<.05].mean()*1000),
              'mean_height_bark_mm':float(height[bark>.95].mean()*1000),
              'mean_roughness_wood':float(raw['orm'][...,1][bark<.05].mean()/255),
              'mean_roughness_bark':float(raw['orm'][...,1][bark>.95].mean()/255),
              'mean_AO_deep_checks':float(raw['orm'][...,0][incisions>1].mean()/255),
              'mean_AO_clear_wood':float(raw['orm'][...,0][(incisions<.02)&(bark<.05)].mean()/255)}
    assertions['bark_is_raised']=semantic['mean_height_bark_mm']>semantic['mean_height_wood_mm']+1.5
    assertions['checks_have_more_AO']=semantic['mean_AO_deep_checks']<semantic['mean_AO_clear_wood']
    # A normalized high-frequency check is a measurement, not a claim of a scan.
    lum=raw['base'].astype(np.float32).mean(2)
    detail={'residual_after_1px_gaussian_rms':float(np.std(lum-ndi.gaussian_filter(lum,1,mode='wrap'))),
            'gradient_x_rms':float(np.std(np.roll(lum,-1,1)-lum)),
            'gradient_y_rms':float(np.std(np.roll(lum,-1,0)-lum))}
    metrics={'all_checks_pass':all(assertions.values()),'assertions':assertions,'files':info,
             'base_srgb_mean':mean.tolist(),'tile_metres':[TILE_M,TILE_M],
             'texel_mm':TILE_M*1000/N,'height_full_range_mm':HEIGHT_MM,
             'height_used_mm':[float(height.min()*1000),float(height.max()*1000)],
             'seams_8bit_equivalent':seams,'normal_against_saved_height':normal_metrics,
             'coverage':coverage,'semantic_alignment':semantic,'native_2048_detail':detail}
    metrics['seam_interpretation']='Line statistics are not proof of seamlessness; inspect the saved half-offsets and 3x3 repeat. A 36cm drying check straddles the Y wrap, increasing height/normal line means above global p99 but within neighboring interior values. It is continuous, not removed to lower the metric.'
    (OUT/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
    images={k:(rgb8(v/257).convert('RGB') if k=='height' else Image.fromarray(v)) for k,v in raw.items()}
    sheet([images[k] for k in LAYERS],['Base colour | sRGB','Height | 0–12 mm, white high','Normal | OpenGL, physical scale','ORM | AO / roughness / zero metal']).save(OUT/'layers.jpg',quality=95,subsampling=0)
    offsets=[]
    for k in LAYERS:
        v=np.roll(raw[k],(N//2,N//2),(0,1))
        Image.fromarray(v).save(OUT/f'pole_{k}_offset.png')
        offsets.append(rgb8(v/257).convert('RGB') if k=='height' else Image.fromarray(v))
    sheet(offsets,[f'{k} | half-offset, wrapped X and Y' for k in LAYERS]).save(OUT/'offsets.jpg',quality=95,subsampling=0)
    tiled=np.tile(raw['base'],(3,3,1))
    Image.fromarray(tiled).save(OUT/'pole_base_tile3x3.png')
    Image.fromarray(tiled).resize((2048,2048),Image.Resampling.LANCZOS).save(OUT/'tiling_3x3.jpg',quality=95,subsampling=0)
    ao=raw['orm'][...,0].astype(np.float32)/255
    lights=[(-.45,.75,.48),(.45,-.75,.48),(.75,.18,.64)]
    labels=['Upper left','Lower right','Across the grain']
    renders=[]; names=[]
    for light,label in zip(lights,labels):
        renders.append(relight(raw['base'].astype(np.float32),normal,ao,light)); names.append(label+' | colour + normal + AO')
    for light,label in zip(lights,labels):
        renders.append(relight(raw['base'].astype(np.float32),normal,ao,light,clay=True)); names.append(label+' | neutral clay + normal + AO')
    sheet(renders,names,columns=3,size=640).save(OUT/'relighting.jpg',quality=95,subsampling=0)
    for i,im in enumerate(renders): im.save(OUT/f'relight_{i+1}.png')
    relight_crop=Image.new('RGB',(1536,512))
    for i in range(3): relight_crop.paste(renders[i].crop((900,650,1412,1162)),(i*512,0))
    relight_crop.save(OUT/'relight_detail.png')
    wrap_detail=Image.new('RGB',(2048,560),(20,20,20))
    for i,k in enumerate(LAYERS):
        a=raw[k]
        if k=='height': a=np.rint(a/257).astype(np.uint8)
        strip=np.concatenate([a[-64:],a[:64]],axis=0)
        wrap_detail.paste(Image.fromarray(strip).convert('RGB'),(0,i*140+12))
        ImageDraw.Draw(wrap_detail).text((4,i*140),k,fill='white')
    wrap_detail.save(OUT/'wrap_detail.png')
    # Exact 1:1 pixels, including native source fibres, bark and checks.
    box=(730,610,1498,1378)
    crop_images=[images[k].crop(box) for k in LAYERS]
    sheet(crop_images,[f'{k} | 1:1 pixels, x730 y610' for k in LAYERS],size=768).save(OUT/'detail_1to1.png')
    crop_images[0].save(OUT/'pole_base_crop_1to1.png')
    crop_images[2].save(OUT/'pole_normal_crop_1to1.png')
    # Alignment mask outline over the base, plus numerical source feature fields.
    edges=(ndi.maximum_filter(bark>.5,size=3)!=ndi.minimum_filter(bark>.5,size=3))
    overlay=raw['base'].copy()
    overlay[edges]=[60,220,165]
    masks=np.stack([bark,np.clip(incisions/2.5,0,1),np.zeros_like(bark)],2)*255
    sheet([Image.fromarray(overlay),rgb8(masks)],['Bark boundary overlay','Shared fields | red bark / green incisions'],size=768).save(OUT/'alignment.jpg',quality=95,subsampling=0)
    cylinder_preview(raw['base'].astype(np.float32),normal.astype(np.float32),ao).save(OUT/'pole_context.jpg',quality=95,subsampling=0)
    print(json.dumps({k:metrics[k] for k in ['all_checks_pass','assertions','base_srgb_mean','normal_against_saved_height','coverage','semantic_alignment']},indent=2))
    if not metrics['all_checks_pass']: sys.exit(1)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--band-dir',type=Path,help='Validate an optional closed-band export instead of the primary maps')
    args=parser.parse_args()
    if args.band_dir is None:
        main()
    else:
        dest=args.band_dir.resolve()
        metadata=json.loads((dest/'band.json').read_text())
        width,rows=metadata['dimensions']
        data={k:np.asarray(Image.open(dest/f'pole_{k}.png')) for k in LAYERS}
        header={k:png_info(dest/f'pole_{k}.png') for k in LAYERS}
        h=data['height'].astype(np.float64)/65535*metadata['height_range_mm']/1000
        sx=(np.roll(h,-1,1)-np.roll(h,1,1))/(2*metadata['tile_metres'][0]/width)
        sy=(np.roll(h,-1,0)-np.roll(h,1,0))/(2*metadata['tile_metres'][1]/rows)
        expected=np.stack([-sx,sy,np.ones_like(h)],axis=2)
        expected/=np.linalg.norm(expected,axis=2,keepdims=True)
        normal=data['normal'].astype(np.float64)/127.5-1
        normal/=np.linalg.norm(normal,axis=2,keepdims=True)
        angle=np.degrees(np.arctan2(np.linalg.norm(np.cross(expected,normal),axis=2),(expected*normal).sum(2)))
        seams={k:seam_stats(a.astype(np.float32)/(257 if k=='height' else 1)) for k,a in data.items()}
        passed=all(a.shape[:2]==(rows,width) for a in data.values()) and float(angle.max())<.5 and bool((data['orm'][...,2]==0).all())
        passed=passed and all(s['wrap_mean']<=s['interior_line_max'] for m in seams.values() for s in m.values())
        result={'all_checks_pass':passed,'dimensions':[width,rows],'tile_metres':metadata['tile_metres'],
                'height_range_mm':metadata['height_range_mm'],'normal_error_mean_degrees':float(angle.mean()),
                'normal_error_max_degrees':float(angle.max()),'seams_8bit_equivalent':seams,'files':header}
        (dest/'metrics.json').write_text(json.dumps(result,indent=2)+'\n')
        # Horizontal grain remains at native density in this strip preview.
        preview=np.tile(data['base'],(3,2,1))
        Image.fromarray(preview).save(dest/'tiling_2x3.png')
        offset=np.roll(data['base'],(rows//2,width//2),(0,1))
        Image.fromarray(offset).save(dest/'half_offset.png')
        print(json.dumps({k:v for k,v in result.items() if k not in ['seams_8bit_equivalent','files']},indent=2))
        if not passed: sys.exit(1)
