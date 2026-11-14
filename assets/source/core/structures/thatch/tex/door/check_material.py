#!/usr/bin/env python3
"""Validate delivered PNG bytes and render reproducible inspection sheets.

Run: python3 check_material.py. Exit status is nonzero on a contract failure.
No generated-source changes and no dependency on build_material.py's functions.
Missing ignored round1 comparison maps are rebuilt using the frozen old builder.
"""
from pathlib import Path
import hashlib
import json
import struct
import sys
import shutil
import subprocess
import tempfile

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import binary_erosion, distance_transform_edt

ROOT = Path(__file__).resolve().parent
CHECKS = ROOT / 'checks'
ROUND1 = ROOT / 'round1'
CONCEPT = ROOT / '../../ref/concept/piece_door.png'
N = 2048
MM_PER_PX = 3000 / N
HEIGHT_RANGE_MM = 12.0
BG = np.array([19, 23, 28], dtype=np.float32)


def font(size=22, bold=False):
    names = ['/System/Library/Fonts/Supplemental/Arial Bold.ttf' if bold else
             '/System/Library/Fonts/Supplemental/Arial.ttf',
             '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']
    for name in names:
        if Path(name).exists():
            return ImageFont.truetype(name, size)
    return ImageFont.load_default(size=size)


def rgb_image(a):
    return Image.fromarray(np.rint(a).clip(0, 255).astype(np.uint8))


def over_dark(rgb, alpha):
    return rgb * alpha[..., None] + BG * (1-alpha[..., None])


def linear(c):
    c = c / 255.
    return np.where(c <= .04045, c / 12.92, ((c + .055) / 1.055) ** 2.4)


def srgb(c):
    c = np.maximum(c, 0)
    return 255 * np.where(c <= .0031308, c * 12.92, 1.055*c**(1/2.4)-.055)


def relight(base, normal, orm, light):
    """Linear-light Lambert + dielectric GGX, roughness and AO from delivered ORM.

    Image row-down is mapped to tangent y-up before the OpenGL normal is used.
    No painted directional highlights, arbitrary screen blend or height emboss.
    """
    n = normal.astype(np.float32) / 127.5 - 1
    n /= np.sqrt(np.sum(n*n, axis=2))[..., None]
    l = np.array(light, dtype=np.float32)
    l /= np.linalg.norm(l)
    half = l + np.array([0., 0., 1.])
    half /= np.linalg.norm(half)
    ndotl = np.clip(np.sum(n*l, axis=2), 0, 1)
    ndotv = np.clip(n[...,2], .001, 1)
    ndoth = np.clip(np.sum(n*half, axis=2), 0, 1)
    vdoth = half[2]
    rough = orm[...,1] / 255.
    a2 = rough ** 4
    D = a2 / (np.pi * (ndoth**2*(a2-1)+1)**2)
    k = (rough+1)**2 / 8
    G = (ndotl/(ndotl*(1-k)+k)) * (ndotv/(ndotv*(1-k)+k))
    F = .04 + .96*(1-vdoth)**5
    spec = D * G * F / np.maximum(4*ndotl*ndotv, .001)
    ao = orm[...,0] / 255.
    diffuse = linear(base) * (.29*ao + .86*ndotl)[...,None]
    out = srgb(diffuse + (spec * ndotl * .86)[...,None])
    return np.clip(out, 0, 255)


def sheet(images, labels, destination, tile=900, columns=2, title='', subtitle=''):
    rows = (len(images) + columns - 1) // columns
    pad, label_h, top = 24, 55, 112
    w = columns*tile + (columns+1)*pad
    h = top + rows*(tile+label_h+pad) + pad
    out = Image.new('RGB', (w,h), (19,23,28))
    d = ImageDraw.Draw(out)
    d.text((pad,22),title,font=font(32,True),fill=(232,224,204))
    d.text((pad,67),subtitle,font=font(19),fill=(152,160,165))
    for i,(im,label) in enumerate(zip(images,labels)):
        x = pad+(i%columns)*(tile+pad)
        y = top+(i//columns)*(tile+label_h+pad)
        d.text((x,y+10),label,font=font(23,True),fill=(220,215,199))
        out.paste(im.resize((tile,tile),Image.Resampling.LANCZOS),(x,y+label_h))
    out.save(CHECKS/destination, quality=94, subsampling=0)


def png_header(path):
    raw = path.read_bytes()
    width,height,depth,kind,_,_,_ = struct.unpack('>IIBBBBB',raw[16:29])
    chunks=[]; pos=8
    while pos < len(raw):
        size=struct.unpack('>I',raw[pos:pos+4])[0]
        kind_name=raw[pos+4:pos+8].decode('ascii')
        chunks.append(kind_name)
        pos += size+12
    return dict(width=width,height=height,bit_depth=depth,color_type=kind,
                chunks=chunks,bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest())


def ensure_round1():
    """Keep the checker portable: round*/ and checks/ are ignored by this repo.

    Source control retains the small old builder and reference hashes. A clean
    checkout can recreate the old comparison maps without network access or
    altering the current material. Verify the old maps against their original
    hashes even when the archive already exists.
    """
    reference=json.loads((ROOT/'source/round1_reference.json').read_text())
    builder=ROOT/'source/build_material_round1.py'
    if hashlib.sha256(builder.read_bytes()).hexdigest()!=reference['builder_sha256']:
        raise RuntimeError('Frozen round 1 builder changed')
    required=[*reference['maps_sha256'], 'checks/construction.json','checks/cord_mask.png','preserved_inputs.json']
    if not all((ROUND1/name).exists() for name in required):
        ROUND1.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='door-round1-') as temporary:
            folder=Path(temporary)
            shutil.copy2(builder,folder/'build_material.py')
            (folder/'source').symlink_to(ROOT/'source',target_is_directory=True)
            (folder/'guide').symlink_to(ROOT/'guide',target_is_directory=True)
            with (ROUND1/'rebuild_log.txt').open('w') as log:
                subprocess.run([sys.executable,str(folder/'build_material.py')],stdout=log,stderr=subprocess.STDOUT,check=True)
            for name in reference['maps_sha256']:
                shutil.copy2(folder/name,ROUND1/name)
            shutil.copytree(folder/'checks',ROUND1/'checks',dirs_exist_ok=True)
        (ROUND1/'preserved_inputs.json').write_text(json.dumps(reference['preserved_inputs'],indent=2)+'\n')
    for name,sha in reference['maps_sha256'].items():
        if hashlib.sha256((ROUND1/name).read_bytes()).hexdigest()!=sha:
            raise RuntimeError(f'Round 1 reference map changed: {name}')
    return reference


def concept_comparison(base, studio, low_sun, mean_rgb):
    """Use only the repository-owned concept, preserving its painted lighting.

    The concept crop is displayed at native resolution. The corresponding
    material patch is reduced to a similar apparent physical scale. Neither
    concept color nor texture data is sampled into the delivered material.
    """
    concept = Image.open(CONCEPT).convert('RGB')
    concept_box = (930, 310, 1314, 694)
    material_box = (1160, 810, 1800, 1450)
    panels = [concept.crop(concept_box), base.crop(material_box).resize((384,384),Image.Resampling.LANCZOS),
              studio.crop(material_box).resize((384,384),Image.Resampling.LANCZOS),
              low_sun.crop(material_box).resize((384,384),Image.Resampling.LANCZOS)]
    out = Image.new('RGB',(1656,648),(19,23,28)); d = ImageDraw.Draw(out)
    d.text((24,18),'DOOR / OWN CONCEPT + ROUND 2 MATERIAL',font=font(27,True),fill=(232,224,204))
    d.text((24,58),'Inside reed infill: similar apparent scale; concept is painted and lit, material base is unlit.',font=font(18),fill=(169,176,178))
    labels = ['OWN CONCEPT / native crop','ROUND 2 / base colour','ROUND 2 / upper-left light','ROUND 2 / grazing light']
    for i,(im,label) in enumerate(zip(panels,labels)):
        x = 24+i*408
        d.text((x,101),label,font=font(20,True),fill=(230,223,206))
        out.paste(im,(x,137))
    achieved=tuple(int(round(c)) for c in mean_rgb)
    for i,(label,rgb) in enumerate([('Wall target / brief',(191,146,82)),('Door target',(195,155,92)),('Door achieved / rounded',achieved)]):
        x=24+i*408
        d.rectangle((x,544,x+70,606),fill=rgb)
        d.text((x+83,546),label,font=font(17),fill=(224,219,204))
        d.text((x+83,573),str(rgb),font=font(18,True),fill=(224,219,204))
    d.text((24,621),'Concept crop: 384 px native. Material crop: 640 px / 0.938 m, reduced to 384 px for this comparison.',font=font(16),fill=(169,176,178))
    out.save(CHECKS/'concept_comparison.png')
    return dict(path='../../ref/concept/piece_door.png',sha256=hashlib.sha256(CONCEPT.read_bytes()).hexdigest(),
                concept_crop_xyxy=list(concept_box),material_crop_xyxy=list(material_box),
                display_px=384,concept_color_modified=False,material_crop_width_m=640*MM_PER_PX/1000)


def main():
    CHECKS.mkdir(exist_ok=True)
    reference=ensure_round1()
    names=['door_base.png','door_height.png','door_normal.png','door_orm.png']
    paths=[ROOT/n for n in names]
    headers={p.name:png_header(p) for p in paths}
    arrays=[np.array(Image.open(p)) for p in paths]
    base,h16,normal,orm=arrays
    alpha=base[...,3]/255.
    opaque=alpha==1
    rgb=base[...,:3].astype(np.float32)
    height=h16.astype(np.float64)/65535.*HEIGHT_RANGE_MM
    guide=np.asarray(Image.open(ROOT/'guide/layout.png').convert('RGB'))
    col=(guide.max(2)-guide.min(2)>65)&(guide.max(2)>120)
    col[:,:1024]=False
    allowed=col|col[:,::-1]
    failures=[]
    def require(test,message):
        if not bool(test): failures.append(message)
    require(all((h['width'],h['height'])==(N,N) for h in headers.values()),'2048 square dimensions')
    require(headers[names[0]]['bit_depth']==8 and headers[names[0]]['color_type']==6,'base is RGBA8')
    require(headers[names[1]]['bit_depth']==16 and headers[names[1]]['color_type']==0,'height is 16-bit grayscale')
    require(all(headers[n]['bit_depth']==8 and headers[n]['color_type']==2 for n in names[2:]),'normal and ORM are RGB8')
    require('sRGB' in headers[names[0]]['chunks'],'base explicitly marked sRGB')
    require(all('sRGB' not in headers[n]['chunks'] for n in names[1:]),'data maps not tagged sRGB')
    require(set(np.unique(base[...,3]))=={0,255},'alpha is binary')
    leaks=int(np.count_nonzero(opaque&~allowed))
    require(leaks==0,'alpha fits guide with no spill')
    mirror_error=int(np.count_nonzero(opaque!=opaque[:,::-1]))
    require(mirror_error==0,'front/back cutout is physically mirrored')
    coverage=float(opaque.sum()/allowed.sum())
    require(coverage>.96,'tight reed panel covers more than 96 percent of guide')
    require(np.all(orm[...,2]==0),'metalness is identically zero')
    roughness=orm[...,1]/255.
    require(roughness.min()>=.7 and roughness.max()<=.95,'roughness in requested range')
    require(np.count_nonzero(np.all(base[...,:3]==0,axis=2)&~opaque)==0,'nonblack RGB padding everywhere')
    # Independently reconstruct tangent normals from the DELIVERED uint16 PNG.
    gy,gx=np.gradient(height,MM_PER_PX)
    expected=np.stack((-gx,gy,np.ones_like(gx)),axis=2)
    expected/=np.sqrt(np.sum(expected**2,axis=2))[...,None]
    packed=np.rint((expected*.5+.5)*255).astype(np.uint8)
    err=np.abs(normal.astype(np.int16)-packed.astype(np.int16))
    require(err.max()==0,'normal is exact derivative of delivered height, OpenGL sign')
    decoded=normal.astype(np.float64)/127.5-1
    norm_length=np.sqrt(np.sum(decoded**2,axis=2))
    require(np.max(np.abs(norm_length-1))<.008,'normal unit length within 8-bit quantization')
    # A positive row derivative MUST pack above 127 in the G channel.
    green_test=(gy>.02)&opaque
    require(np.all(normal[...,1][green_test]>127),'green channel is toward image top')
    distance, nearest=distance_transform_edt(~opaque,return_indices=True)
    pad=(distance>0)&(distance<=16)
    nearest_rgb=base[nearest[0],nearest[1],:3]
    padding_err=np.abs(base[...,:3].astype(np.int16)-nearest_rgb.astype(np.int16))
    require(padding_err[pad].max()==0,'16 px filtering gutter copies edge color exactly')
    padding_max=int(padding_err[pad].max())
    normal_error=int(err.max())
    normal_length_error=float(np.max(np.abs(norm_length-1)))
    tilt_percentiles=np.percentile(np.degrees(np.arccos(np.clip(expected[...,2][opaque],-1,1))),[50,95,99]).tolist()
    green_pixels=int(green_test.sum())
    # Normal and bleed reconstruction arrays are large; release them before
    # rendering the comparison sheets, keeping the independent measurements.
    del expected,packed,err,decoded,norm_length,green_test,gy,gx
    del distance,nearest,nearest_rgb,padding_err,pad

    # Round 2 acceptance: independently compare against the frozen delivery.
    old_base=np.array(Image.open(ROUND1/'door_base.png'))
    old_normal=np.array(Image.open(ROUND1/'door_normal.png'))
    old_orm=np.array(Image.open(ROUND1/'door_orm.png'))
    rope=np.array(Image.open(CHECKS/'cord_mask.png'))
    old_rope=np.array(Image.open(ROUND1/'checks/cord_mask.png'))
    alpha_changes=int(np.count_nonzero(base[...,3]!=old_base[...,3]))
    cord_changes=int(np.count_nonzero(rope!=old_rope))
    require(alpha_changes==0,'round 1 alpha preserved exactly')
    require(cord_changes==0,'round 1 cord footprint preserved exactly')
    construct=json.loads((CHECKS/'construction.json').read_text())
    old_construct=json.loads((ROUND1/'checks/construction.json').read_text())
    require(construct['reed_plan']==old_construct['reed_plan'],'round 1 reed and bundle plan preserved')
    require(construct['cord_rows_px']==old_construct['cord_rows_px']==[703,1516],'inside cords stay at rows 703 and 1516')
    preserved=reference['preserved_inputs']
    unchanged={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==sha for name,sha in preserved.items()}
    require(all(unchanged.values()),'all round 1 source files and guide bytes preserved')
    mean_rgb=rgb[opaque].astype(np.float64).mean(0)
    require(np.max(np.abs(mean_rgb-[195,155,92]))<1,'visible base mean within 1 byte of requested straw gold')
    hue_rgb=rgb[opaque].astype(np.float64)/255.
    hi=hue_rgb.max(1);lo=hue_rgb.min(1);delta=hi-lo
    red_is_max=(hue_rgb[:,0]==hi)&(delta>1e-6)
    hue=np.full(len(hi),np.nan)
    hue[red_is_max]=60*(hue_rgb[red_is_max,1]-hue_rgb[red_is_max,2])/delta[red_is_max]
    hue_pcts=np.nanpercentile(hue,[1,50,99])
    del hue_rgb,hi,lo,delta,red_is_max,hue
    require(hue_pcts[0]>=30 and hue_pcts[2]<=52,'straw yellow hue; no orange-dyed body')
    # Measure body vs foot in fixed unobscured zones, excluding pale cord.
    zones={}
    for label,(lo,hi) in {'body':(500,1100),'foot':(1620,1740)}.items():
        mask=opaque[lo:hi]&(rope[lo:hi]==0)
        zones[label]=rgb[lo:hi][mask].astype(np.float64).mean(0)
    wear=zones['body']-zones['foot']
    require(np.all(wear>1.5) and np.all(wear<12),'bottom gently darker than body in every channel')
    relief_span=float(np.ptp(height[opaque]))
    reed_span=float(np.ptp(height[opaque&(rope==0)]))
    require(8<=relief_span<=10,'8 to 10 mm visible relief')
    require(8<=reed_span<=10,'reed relief itself spans 8 to 10 mm without relying on cords')
    require(height[opaque].min()>0 and height[opaque].max()<HEIGHT_RANGE_MM,'height has no black/white clipping')
    chroma_std=rgb[opaque].astype(np.float64).std(0)
    old_chroma_std=old_base[...,:3][opaque].astype(np.float64).std(0)
    require(np.all(chroma_std<old_chroma_std),'colour variation calmer than round 1')
    delta_rgb=rgb[opaque].astype(np.float64)-old_base[...,:3][opaque].astype(np.float64)
    pure_grade_residual=float(np.sqrt(np.mean((delta_rgb-delta_rgb.mean(0))**2)))
    del delta_rgb
    require(pure_grade_residual>2,'variation and wear changed beyond a uniform recolour')

    dark=over_dark(rgb,alpha)
    dark_im=rgb_image(dark)
    dark_im.save(CHECKS/'alpha_dark.png')
    rgb_image(rgb*alpha[...,None]+guide*(1-alpha[...,None])).save(CHECKS/'base_over_layout.png')
    # Transparent diagnostic overlay exposes the exact color bundle divisions.
    overlay=rgb*.74+guide*.26
    overlay=overlay*alpha[...,None]+guide*(1-alpha[...,None])
    outline=allowed&~binary_erosion(allowed)
    overlay[outline]=[120,235,213]
    rgb_image(overlay).save(CHECKS/'layout_overlay.png')
    lit_a=relight(rgb,normal,orm,(-.67,.46,.59))
    lit_b=relight(rgb,normal,orm,(.67,-.46,.59))
    im_a=rgb_image(over_dark(lit_a,alpha)); im_b=rgb_image(over_dark(lit_b,alpha))
    im_a.save(CHECKS/'relit_upper_left.png');im_b.save(CHECKS/'relit_lower_right.png')
    sheet([im_a,im_b],['01 / Light from upper left','02 / Light from lower right'],
          'relighting.jpg',tile=1024,title='THATCH / DOOR — RELIEF CHECK',
          subtitle='Delivered normal + ORM · linear-light diffuse / dielectric GGX · alpha cutout · no frame geometry')
    # Low sun is above the horizon on both sides, ~13 degrees elevation and
    # ~14.5 degrees above the surface plane. Same exposure for both rounds.
    lights=[(-.94,.23,.25),(.94,.23,.25)]
    low=[rgb_image(over_dark(relight(rgb,normal,orm,l),alpha)) for l in lights]
    low[0].save(CHECKS/'relit_low_sun_left.png');low[1].save(CHECKS/'relit_low_sun_right.png')
    sheet(low,['LOW SUN / left','LOW SUN / right'],'low_sun.jpg',tile=1024,
          title='ROUND 2 / LOW SUN',subtitle='Opposed grazing lights · rounded reed relief from delivered height · same exposure')
    old_dark=rgb_image(over_dark(old_base[...,:3].astype(np.float32),alpha))
    sheet([old_dark,dark_im],['ROUND 1 / accepted layout','ROUND 2 / warmer straw'],
          'round_comparison.jpg',tile=1024,title='DOOR / ROUND 1 AND ROUND 2',
          subtitle='Identical alpha, bundle layout and cord positions · unlit sRGB · dark background')
    # Native detail comparison makes the increased relief directly reviewable.
    crop=(1260,810,1772,1322)
    old_low=[rgb_image(over_dark(relight(old_base[...,:3],old_normal,old_orm,l),alpha)) for l in lights]
    sheet([old_low[0].crop(crop),old_low[1].crop(crop),low[0].crop(crop),low[1].crop(crop)],
          ['ROUND 1 / low sun left','ROUND 1 / low sun right','ROUND 2 / low sun left','ROUND 2 / low sun right'],
          'low_sun_detail_1to1.png',tile=512,title='NATIVE DETAIL / MORE PHYSICAL RELIEF',
          subtitle='512 px crops · one texture pixel per image pixel · identical light and exposure')
    concept_record=concept_comparison(dark_im,im_a,low[0],mean_rgb)
    hdisplay=np.repeat((h16/65535.*255)[...,None],3,axis=2)
    sheet([dark_im,rgb_image(hdisplay),Image.fromarray(normal),Image.fromarray(orm)],
          ['BASE / sRGB + binary alpha','HEIGHT / 16 bit · 0–12 mm',
           'NORMAL / OpenGL · from delivered height','ORM / AO · roughness · metalness 0'],
          'layers.jpg',tile=900,title='THATCH / DOOR — MATERIAL ATLAS',
          subtitle='2048 × 2048 · 3 × 3 metres · outside left / inside right · 14 bundles per face')

    # Six genuine 512 px crops: paste at native resolution, never enlarge.
    front=(200,520,712,1032); back=(1260,520,1772,1032)
    crops=[dark_im.crop(front),dark_im.crop(back),Image.fromarray(normal).crop(back),
           im_a.crop(front),im_a.crop(back),im_b.crop(back)]
    labels=['OUTSIDE / flat base','INSIDE / flat base + cord','INSIDE / normal',
            'OUTSIDE / upper-left light','INSIDE / upper-left light','INSIDE / lower-right light']
    out=Image.new('RGB',(1600,1260),(19,23,28));d=ImageDraw.Draw(out)
    d.text((20,18),'NATIVE DETAIL / one texture pixel = one image pixel',font=font(26,True),fill=(232,224,204))
    d.text((20,57),'Each crop is 512 × 512 pixels, or 0.75 × 0.75 metres on the door.',font=font(18),fill=(152,160,165))
    for i,(crop,label) in enumerate(zip(crops,labels)):
        x=16+(i%3)*528;y=100+(i//3)*566
        d.text((x,y),label,font=font(19,True),fill=(225,218,201))
        out.paste(crop,(x,y+32))
    out.save(CHECKS/'detail_1to1.png')
    edges=Image.new('RGB',(1920,440),(19,23,28));d=ImageDraw.Draw(edges)
    d.text((20,16),'CUT ENDS / native pixels · top, then bottom',font=font(25,True),fill=(232,224,204))
    edges.paste(dark_im.crop((40,260,1000,420)),(0,64))
    edges.paste(dark_im.crop((1048,260,2008,420)),(960,64))
    edges.paste(dark_im.crop((40,1690,1000,1850)),(0,254))
    edges.paste(dark_im.crop((1048,1690,2008,1850)),(960,254))
    edges.save(CHECKS/'ends_1to1.png')
    # Pole overlay is explicitly a guide diagnostic, not painted material.
    frame=np.all(guide==[90,50,25],axis=2)
    frame_preview=dark.copy();frame_preview[frame]=[91,62,37]
    rgb_image(frame_preview).save(CHECKS/'frame_placement.png')

    width_px=np.array([r['right']-r['left'] for r in construct['reed_plan']])
    metrics=dict(status='PASS' if not failures else 'FAIL',failures=failures,
                 files=headers,texture_scale_mm_per_px=MM_PER_PX,
                 encoded_height_range_mm=[0,HEIGHT_RANGE_MM],
                 visible_height_min_max_mm=[float(height[opaque].min()),float(height[opaque].max())],
                 visible_relief_span_mm=float(np.ptp(height[opaque])),
                 visible_height_percentiles_p1_p5_p50_p95_p99_mm=np.percentile(height[opaque],[1,5,50,95,99]).tolist(),
                 reeds_only_relief_span_mm=reed_span,
                 round1_preservation=dict(alpha_changed_pixels=alpha_changes,cord_mask_changed_pixels=cord_changes,
                                          cord_rows_px=construct['cord_rows_px'],source_and_guide_unchanged=unchanged,
                                          reed_plan_identical=construct['reed_plan']==old_construct['reed_plan']),
                 colour=dict(target_visible_rgb=[195,155,92],visible_mean_rgb=mean_rgb.tolist(),
                             round1_mean_rgb=old_base[...,:3][opaque].mean(0).tolist(),
                             visible_std_rgb=chroma_std.tolist(),round1_std_rgb=old_chroma_std.tolist(),
                             hue_degrees_p1_p50_p99=hue_pcts.tolist(),
                             zones_mean_rgb={k:v.tolist() for k,v in zones.items()},
                             body_minus_foot_rgb=wear.tolist(),
                             nonuniform_recolour_rms=pure_grade_residual),
                 concept_comparison=concept_record,
                 low_sun_lights=lights,
                 alpha=dict(values=[int(v) for v in np.unique(base[...,3])],
                            opaque_pixels=int(opaque.sum()),coverage_of_guide=coverage,
                            pixels_outside_guide=leaks,mirror_mismatch_pixels=mirror_error,
                            exact_16px_edge_bleed_max_error=padding_max),
                 normals=dict(max_byte_error_from_height=normal_error,
                              max_length_error=normal_length_error,
                              green_top_sign_test_pixels=green_pixels,
                              tilt_degrees_p50_p95_p99=tilt_percentiles),
                 roughness=dict(global_min=float(roughness.min()),global_max=float(roughness.max()),
                                visible_mean=float(roughness[opaque].mean())),
                 occlusion=dict(min=float(orm[...,0][opaque].min()/255),mean=float(orm[...,0][opaque].mean()/255)),
                 metalness_nonzero_pixels=int(np.count_nonzero(orm[...,2])),
                 reeds=dict(per_face=construct['reed_count_per_face'],bundles_per_face=14,
                            widths_px_min_median_max=[float(width_px.min()),float(np.median(width_px)),float(width_px.max())],
                            widths_mm_min_median_max=[float(width_px.min()*MM_PER_PX),float(np.median(width_px)*MM_PER_PX),float(width_px.max()*MM_PER_PX)]),
                 checks=['PNG IHDR/channel/depth and color-space tags','exact guide containment',
                         'binary mirrored alpha','nearest-edge RGB bleed','height-to-normal byte equality',
                         'OpenGL positive-green sign','normal vector lengths','roughness range / zero metalness',
                         'two opposite-direction linear-light relights','1:1 reed / cord / end crops',
                         'round 1 alpha / cord / reed plan / source / guide equality',
                         'target RGB / straw hue / bottom wear / calmer colour variation',
                         '8–10 mm visible relief with and without cords / no height clipping',
                         'opposed grazing relights and round comparison at native pixels',
                         'repository-owned concept crop side by side'])
    (CHECKS/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
    print(json.dumps({k:v for k,v in metrics.items() if k!='files'},indent=2))
    return 1 if failures else 0


if __name__=='__main__':
    sys.exit(main())
