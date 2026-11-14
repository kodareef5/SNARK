#!/usr/bin/env python3
"""Validate delivered PNGs and render repeatable, labelled material evidence.

Run: python3 check_material.py. No external images, renderer or network required.
Relief preview is an orthographic two-surface height-field renderer. Geometry
comes only from guide/depth.png; material normals come from the delivered map.
"""
from pathlib import Path
import argparse, hashlib, json, subprocess, sys, time
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import gaussian_filter, distance_transform_edt, label
from build_material import read_guides, N, HEIGHT_MM, PIXEL_MM, ROOT, intervals

OUT=ROOT/'checks'
BG=np.array([24,28,31],np.float32)/255

def u8(a): return np.rint(np.clip(a,0,1)*255).astype(np.uint8)
def img(a): return Image.fromarray(u8(a))
def linear(c): return np.where(c<=.04045,c/12.92,((c+.055)/1.055)**2.4)
def srgb(c): return np.where(c<=.0031308,c*12.92,1.055*np.maximum(c,0)**(1/2.4)-.055)

def font(size):
    for p in ['/System/Library/Fonts/Supplemental/Arial.ttf','/Library/Fonts/Arial.ttf']:
        if Path(p).exists(): return ImageFont.truetype(p,size)
    return ImageFont.load_default(size=size)

def panel(images, labels, name, width=768, columns=2, height=None):
    rows=(len(images)+columns-1)//columns
    height=width if height is None else height
    h=height+58
    sheet=Image.new('RGB',(width*columns,h*rows),(22,26,29))
    d=ImageDraw.Draw(sheet)
    for k,(im,label) in enumerate(zip(images,labels)):
        x=(k%columns)*width;y=(k//columns)*h
        im=im.copy();im.thumbnail((width,height),Image.Resampling.LANCZOS)
        sheet.paste(im,(x+(width-im.width)//2,y+58))
        d.text((x+17,y+14),label,font=font(20),fill=(225,221,210))
    sheet.save(OUT/name,quality=94)

def seam(a):
    a=a.astype(np.float64)
    if a.ndim==2:a=a[...,None]
    edge=np.abs(a[:,0]-a[:,-1])
    inside=np.abs(np.diff(a,axis=1))
    col=np.mean(inside,axis=(0,2))
    m=float(edge.mean());im=float(inside.mean())
    return dict(seam_mean=m,interior_mean=im,seam_to_interior=m/max(im,1e-12),
                seam_p95=float(np.percentile(edge,95)),interior_p95=float(np.percentile(inside,95)),
                seam_column_percentile=float((col<m).mean()*100))

def relief(base,normal,orm,g,direction,sun_strength=.92):
    rgb=base[...,:3]/255
    a=base[...,3]>127
    y=np.arange(N)[:,None]
    upper_tip=g['upper']&(y>=g['upper_start'])
    front=g['upper'] & a
    visible=(y<g['lower_start']) | a
    # Reconstruct both guide surfaces independently, then shade their smooth
    # normals. The silhouette is a cutout, not a sloped ridge in a height map.
    gx=np.arange(N)[None,:]
    upper_z=g['depth'][np.minimum(np.arange(N)[:,None],g['upper_end'][None,:]),gx]
    upper_z=gaussian_filter(upper_z,(12,1),mode=('nearest','wrap'))
    lower_row=g['lower_body_row']+20
    slope=(g['depth'][lower_row+10]-g['depth'][lower_row-10])/20
    lower_z=np.where(y<lower_row,g['depth'][lower_row][None,:]+(y-lower_row)*slope[None,:],g['depth'])
    lower_z=gaussian_filter(lower_z,(12,1),mode=('nearest','wrap'))
    ux=(np.roll(upper_z,-1,1)-np.roll(upper_z,1,1))/(2*PIXEL_MM/1000)
    uy=np.gradient(upper_z,PIXEL_MM/1000,axis=0)
    lx=(np.roll(lower_z,-1,1)-np.roll(lower_z,1,1))/(2*PIXEL_MM/1000)
    ly=np.gradient(lower_z,PIXEL_MM/1000,axis=0)
    dx=np.where(front,ux,lx);dy=np.where(front,uy,ly)
    z=np.where(front,upper_z,lower_z)
    n=normal.astype(np.float32)/255*2-1
    # Add local slopes to the guide surface slopes, then renormalize.
    nz=np.maximum(n[...,2],.05)
    nx=n[...,0]/nz-dx
    ny=n[...,1]/nz+dy
    nn=np.stack([nx,ny,np.ones_like(nx)],axis=2)
    nn/=np.linalg.norm(nn,axis=2,keepdims=True)
    L=np.array([direction*.86,.34,.38],np.float32);L/=np.linalg.norm(L)
    nd=np.maximum(0,np.sum(nn*L,axis=2))
    ao=orm[...,0]/255
    rough=orm[...,1]/255
    # A short ray march gives the raised fringe an actual directional shadow
    # on the exposed backing surface; it is not written into base colour.
    shadow=np.ones((N,N),np.float32)
    for step in [3,6,10,16,24,36,52,72,96,132]:
        shiftx=int(round(step*L[0]));shifty=int(round(-step*L[1]))
        zz=np.roll(np.roll(z,-shiftx,axis=1),-shifty,axis=0)
        valid=np.roll(np.roll(visible,-shiftx,axis=1),-shifty,axis=0)
        rise=step*PIXEL_MM/1000*L[2]
        occ=(zz>z+rise+.002)&valid
        if shifty<0:occ[:abs(shifty)]=False
        elif shifty>0:occ[-shifty:]=False
        shadow[occ]=np.minimum(shadow[occ],.16)
    light=(.34*ao+sun_strength*nd*shadow)[...,None]
    tint=np.array([1.025,1.0,.95])
    # Small broad dry dielectric highlight; roughness comes from ORM.
    half=L+np.array([0,0,1]);half/=np.linalg.norm(half)
    spec=np.maximum(0,np.sum(nn*half,axis=2))**(7+(1-rough)*65)
    spec*=(.012+(1-rough)*.065)*sun_strength/.92
    out=srgb(linear(rgb)*light*tint+spec[...,None]*shadow[...,None])
    return np.where(visible[...,None],np.clip(out,0,1),BG)

def round4_evidence(base,h,normal,orm,g,left,right,bodies,tips):
    """Measure colour changes and prove the accepted round 3 surfaces are fixed."""
    archive=ROOT/'source/round3'
    previous=np.array(Image.open(archive/'thatch_base.png'))
    previous_n=np.array(Image.open(archive/'thatch_normal.png'))
    previous_orm=np.array(Image.open(archive/'thatch_orm.png'))
    old_g=read_guides(archive)
    previous_lit=relief(previous,previous_n,previous_orm,old_g,1)
    material_box=(360,340,1128,1012)
    hero_box=(545,318,797,538)
    hero_path=ROOT/'../../ref/concept/house_hero.png'
    hero_crop=Image.open(hero_path).convert('RGB').crop(hero_box)
    hero_crop.resize((768,670),Image.Resampling.LANCZOS).save(OUT/'house_hero_crop.png')
    panel([img(right).crop(material_box),hero_crop.resize((768,670),Image.Resampling.LANCZOS)],
          ['ROUND 4  |  relief-lit skirt / 1:1 texels','OUR CONCEPT  |  house_hero crop / enlarged 3.05x'],
          'concept_comparison.png',height=672)
    panel([Image.fromarray(previous[...,:3]).crop(material_box),Image.fromarray(base[...,:3]).crop(material_box),
           img(previous_lit).crop(material_box),img(right).crop(material_box)],
          ['ROUND 3  |  unlit base','ROUND 4  |  unlit base','ROUND 3  |  same guide / same sun','ROUND 4  |  same guide / same sun'],
          'round3_vs_round4.png',height=672)
    shade=relief(base,normal,orm,g,1,sun_strength=0)
    img(shade).save(OUT/'ambient_shade.png')
    panel([img(right).crop(material_box),hero_crop.resize((768,670),Image.Resampling.LANCZOS),
           img(shade).crop(material_box),Image.fromarray(base[...,:3]).crop(material_box)],
          ['ROUND 4  |  skirt / low warm sun','OUR CONCEPT  |  house_hero / no grading',
           'ROUND 4  |  same skirt / ambient shade','ROUND 4  |  same skirt / unlit base'],
          'skirt_vs_house_hero.png',height=672)
    panel([img(previous_lit),img(right),img(shade)],
          ['ROUND 3 / low sun','ROUND 4 / low sun','ROUND 4 / shade'],
          'distance_comparison.png',width=256,height=256,columns=3)
    manifest=json.loads((ROOT/'source/build_manifest.json').read_text())
    old_manifest=json.loads((archive/'source/build_manifest.json').read_text())
    tie_images=[];tie_labels=[];tie_stats={};sheaves=[]
    z=h.astype(float)/65535*HEIGHT_MM
    for tier in ['upper','lower']:
        p=manifest[tier];row=round(p['tie_row'])
        box=(384,row-80,1152,row+120)
        tie_images.extend([Image.fromarray(base[...,:3]).crop(box),img(right).crop(box)])
        tie_labels.extend([f'{tier.upper()} TIE  |  unlit / 1:1',f'{tier.upper()} TIE  |  lit / 1:1'])
        for b in p['bundles']:
            cols=np.arange(b['left'],b['right'])%N
            sample=base[row+50:g[tier+'_start']-70,cols,:3]
            sheaves.append(dict(tier=tier,id=b['id'],mean_rgb=sample.mean(axis=(0,1)).tolist()))
        band=base[row-6:row+7,:,:3].mean(axis=(0,1))
        shoulder=np.concatenate([base[row-48:row-28,:,:3],base[row+28:row+48,:,:3]]).mean(axis=(0,1))
        rows=np.arange(row-20,row+21)
        detected=int(rows[np.argmin(base[rows,:,:3].mean(axis=(1,2)))])
        height_shoulder=np.concatenate([z[row-48:row-28],z[row+28:row+48]]).mean()
        guide_rows=np.flatnonzero(np.all(g['layout']==[110,60,30],axis=2).all(axis=1))
        guide_rows=guide_rows[np.abs(guide_rows-row)<30]
        tie_stats[tier]=dict(row=p['tie_row'],layout_bar_center=float(guide_rows.mean()),
                             detected_darkest_row=detected,detected_error_px=abs(detected-p['tie_row']),
                             mean_rgb=band.tolist(),adjacent_rgb=shoulder.tolist(),
                             darkening_rgb=(shoulder-band).tolist(),
                             local_compression_mm=float(height_shoulder-z[row-6:row+7].mean()))
    panel(tie_images,tie_labels,'tie_details.png',height=200)
    guide_hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'guide').iterdir() if p.is_file()}
    source_hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'source').glob('*generated.png')}
    archives={}
    for revision in ['round1','round2','round3']:
        saved=json.loads((ROOT/f'source/{revision}_archive_sha256.json').read_text())
        archives[revision]=dict(files=len(saved),byte_identical=all(
            hashlib.sha256((ROOT/'source'/revision/p).read_bytes()).hexdigest()==v for p,v in saved.items()))
    means=np.array([s['mean_rgb'] for s in sheaves])
    visible_body=bodies & (base[...,3]>127)
    visible_tip=tips & (base[...,3]>127)
    old_y=np.arange(N)[:,None]
    old_body=((old_y<old_g['upper_start'])|((~old_g['upper'])&(old_y<old_g['lower_start'])))&(previous[...,3]>127)
    old_tip=((old_g['upper']&(old_y>=old_g['upper_start']))|(old_g['env']&(old_y>=old_g['lower_start'])))&(previous[...,3]>127)
    return dict(
        preservation=dict(archives=archives,
                          guides_byte_identical=guide_hashes==json.loads((ROOT/'source/round3_guides_sha256.json').read_text()),
                          generated_sources_byte_identical=source_hashes==old_manifest['source_sha256'],
                          protected=round4_preservation(base,orm),
                          placement_identical=manifest['placement']==old_manifest['placement']),
        colour=dict(body_mean_rgb=base[visible_body,:3].mean(0).tolist(),tip_mean_rgb=base[visible_tip,:3].mean(0).tolist(),
                    round3_body_mean_rgb=previous[old_body,:3].mean(0).tolist(),round3_tip_mean_rgb=previous[old_tip,:3].mean(0).tolist(),
                    body_target_rgb=[191,146,82],tip_target_rgb=[214,184,132],
                    bundle_body_means=sheaves,bundle_mean_std_rgb=means.std(0).tolist(),
                    bundle_mean_range_rgb=[means.min(0).tolist(),means.max(0).tolist()],
                    body_rgb_std=base[visible_body,:3].std(0).tolist(),
                    dark_stems=sum(manifest[t]['dark_stems'] for t in ['upper','lower']),
                    waxy_stems=sum(manifest[t]['waxy_stems'] for t in ['upper','lower']),
                    body_roughness_percentiles=np.percentile(orm[...,1][visible_body]/255,[1,10,50,90,99]).tolist(),
                    body_p05_rgb=np.percentile(base[visible_body,:3],5,axis=0).tolist(),
                    round3_body_p05_rgb=np.percentile(previous[old_body,:3],5,axis=0).tolist(),
                    round3_bundle_mean_std_rgb=json.loads((archive/'checks/measurements.json').read_text())['round3']['colour']['bundle_mean_std_rgb'],
                    golden_tip_stems=sum(manifest[t]['golden_tip_stems'] for t in ['upper','lower']),
                    paler_tip_stems=sum(manifest[t]['paler_tip_stems'] for t in ['upper','lower']),
                    shade_tip_mean_rgb=u8(shade)[visible_tip].mean(0).tolist()),
        fade=fade_evidence(base,previous,g,manifest),
        ties=tie_stats,
        comparison=dict(material_crop=list(material_box),material_scale=1,concept_path='../../ref/concept/house_hero.png',
                        concept_sha256=hashlib.sha256(hero_path.read_bytes()).hexdigest(),concept_crop=list(hero_box),
                        concept_enlargement=768/(hero_box[2]-hero_box[0]),colour_grading='none',
                        before_after_lighting_identical=True,before_after_guides_identical=True,
                        distance_preview_wall_width_pixels=256,
                        shade='same renderer with direct sun and its specular term off; 0.34 ambient times unchanged AO'))

def round4_preservation(base,orm):
    """Compare file bytes and packed-channel bytes with the frozen acceptance."""
    archive=ROOT/'source/round3'
    old_base=np.array(Image.open(archive/'thatch_base.png'))
    old_orm=np.array(Image.open(archive/'thatch_orm.png'))
    result={}
    for name in ['thatch_height.png','thatch_normal.png','source/relief_layers.npz']:
        old=(archive/name).read_bytes();new=(ROOT/name).read_bytes()
        result[name]=dict(byte_identical=new==old,sha256=hashlib.sha256(new).hexdigest(),
                          round3_sha256=hashlib.sha256(old).hexdigest())
    channels=[('base_alpha',base[...,3],old_base[...,3]),('orm_occlusion',orm[...,0],old_orm[...,0]),
              ('orm_metalness',orm[...,2],old_orm[...,2])]
    for tier in ['upper','lower']:
        channels.append((tier+'_master_alpha',np.array(Image.open(ROOT/f'source/{tier}_master.png'))[...,3],
                         np.array(Image.open(archive/f'source/{tier}_master.png'))[...,3]))
    for name,new,old in channels:
        result[name]=dict(byte_identical=new.tobytes()==old.tobytes(),changed_pixels=int(np.count_nonzero(new!=old)),
                          sha256=hashlib.sha256(new.tobytes()).hexdigest(),
                          round3_sha256=hashlib.sha256(old.tobytes()).hexdigest())
    (OUT/'round4_preservation.json').write_text(json.dumps(result,indent=2)+'\n')
    return result

def fade_evidence(base,previous,g,manifest):
    """Sample delivered RGB along each skirt, independent of the recipe curve."""
    y=np.arange(N)[:,None];a=base[...,3]>127
    records=[];profiles=[]
    for tier in ['upper','lower']:
        domain=g['upper'] if tier=='upper' else g['env']&~g['upper']
        domain=domain&a
        for b in manifest[tier]['bundles']:
            cols=np.arange(b['left'],b['right'])%N
            pixels=base[:,cols,:3];old_pixels=previous[:,cols,:3]
            along=g['along'][:,cols];visible=domain[:,cols]
            bins=[]
            for lo in np.arange(.35,.95,.05):
                mask=visible&(along>=lo)&(along<lo+.05)
                if not mask.any():continue
                bins.append(dict(along_start=round(float(lo),2),pixels=int(mask.sum()),
                                 mean_rgb=pixels[mask].mean(0).tolist(),round3_mean_rgb=old_pixels[mask].mean(0).tolist()))
            tip=visible&(y>=g[tier+'_start'])
            records.append(dict(tier=tier,bundle=b['id'],fade_start=b['fade_start'],fade_end=b['fade_end'],
                                tip_mean_rgb=pixels[tip].mean(0).tolist(),bins=bins))
        # Finer bins expose an accidental horizontal colour step in a long fade.
        for lo in np.arange(.35,.98,.01):
            mask=domain&(g['along']>=lo)&(g['along']<lo+.01)
            if mask.sum()<100:continue
            profiles.append(dict(tier=tier,along=round(float(lo+.005),3),pixels=int(mask.sum()),
                                 mean_rgb=base[mask,:3].mean(0).tolist(),round3_mean_rgb=previous[mask,:3].mean(0).tolist()))
    sheet=Image.new('RGB',(1200,690),(22,26,29));d=ImageDraw.Draw(sheet)
    d.text((24,15),'DELIVERED RGB / rod-to-end position / current solid, round 3 dotted',font=font(22),fill=(230,225,212))
    maximum_steps={}
    for k,tier in enumerate(['upper','lower']):
        pts=[p for p in profiles if p['tier']==tier]
        x0=75+k*585;y0=100;w=515;h=500
        for val in [80,120,160,200,240]:
            yy=y0+h-(val-70)/180*h
            d.line((x0,yy,x0+w,yy),fill=(48,53,56));d.text((x0-38,yy-8),str(val),font=font(15),fill=(180,180,180))
        for val in [.4,.5,.6,.7,.8,.9]:
            xx=x0+(val-.35)/.64*w
            d.text((xx-12,y0+h+10),str(val),font=font(16),fill=(190,190,190))
        d.text((x0,y0-35),tier.upper()+' SKIRT',font=font(22),fill=(230,225,212))
        for channel,color in enumerate([(238,119,93),(176,203,94),(112,164,225)]):
            for field in ['round3_mean_rgb','mean_rgb']:
                xy=[(x0+(p['along']-.35)/.64*w,y0+h-(p[field][channel]-70)/180*h) for p in pts]
                if field=='mean_rgb':d.line(xy,fill=color,width=3)
                else:
                    for i in range(0,len(xy)-1,3):d.line(xy[i:i+2],fill=color,width=1)
        maximum_steps[tier]=np.abs(np.diff([p['mean_rgb'] for p in pts],axis=0)).max(axis=0).tolist()
    d.text((24,653),'Bin means use only visible reeds; irregular coverage changes the sampled reed population near the ends.',font=font(17),fill=(200,195,180))
    sheet.save(OUT/'fade_profiles.png')
    result=dict(bundle_profiles=records,tier_profiles=profiles,max_one_percent_step_rgb=maximum_steps,
                method='Visible delivered RGB grouped by guide/along.png; 5% bins per bundle, 1% bins per tier')
    (OUT/'fade_profiles.json').write_text(json.dumps(result,indent=2)+'\n')
    return result

def bundle_edge_evidence(base,g):
    """Independently locate boundaries in delivered RGB, then compare to IDs.

    Integrating squared colour differences down the whole opaque body suppresses
    individual stems that flare or wander. Search a quarter of the neighbouring
    bundle widths on either side. Retain local peaks within 5% of the strongest
    response, since a thick reed can compete with the actual sheaf boundary.
    Match the nearest retained candidate; record all candidates for review.
    A four-texel tolerance allows a reed/stray over a pigmentation edge.
    Construction interval alignment and guide verticality are exact checks.
    """
    manifest=json.loads((ROOT/'source/build_manifest.json').read_text())
    annotated=Image.fromarray(base[...,:3]).copy();draw=ImageDraw.Draw(annotated)
    records=[];controls={}
    previous=np.array(Image.open(ROOT/'source/round2/thatch_base.png'))
    for tier,reference_row in [('upper',0),('lower',g['lower_body_row'])]:
        row=g['labels'][reference_row]
        edges=np.flatnonzero(np.any(row!=np.roll(row,1,axis=0),axis=1))
        ends=np.r_[edges[1:],edges[0]+N]
        widths=ends-edges
        start=0 if tier=='upper' else g['lower_body_row']
        stop=g[tier+'_start']
        def detect(pixels):
            rgb=pixels[start:stop,:,:3].astype(np.float32)
            # RGB-only signal: no source master, manifest or painted marker.
            score=np.sqrt(np.mean((rgb-np.roll(rgb,1,axis=1))**2,axis=(0,2)))
            locations=[];peak_sets=[]
            for i,e in enumerate(edges):
                radius=int(min(widths[i-1],widths[i])//4)
                candidates=np.arange(e-radius,e+radius+1)
                local_max=score[candidates%N]>=np.maximum(score[(candidates-1)%N],score[(candidates+1)%N])
                strong=score[candidates%N]>=.95*score[candidates%N].max()
                peaks=candidates[local_max & strong]
                if not len(peaks): peaks=candidates[np.argmax(score[candidates%N]):np.argmax(score[candidates%N])+1]
                locations.append(int(peaks[np.argmin(np.abs(peaks-e))]))
                peak_sets.append(peaks.tolist())
            return score,locations,peak_sets
        score,locations,peak_sets=detect(base)
        controls[tier]={}
        for name,pixels in [('shift_left_16',np.roll(base,-16,axis=1)),
                            ('shift_right_16',np.roll(base,16,axis=1)),('old_round2_layout',previous)]:
            _,detected,_=detect(pixels)
            errors=np.abs(np.array(detected)-edges)
            controls[tier][name]=dict(rejected_edges=int(np.sum(errors>4)),total=len(edges),
                                      errors_px=errors.tolist(),rejected=bool(np.any(errors>4)))
        spec=g['spec'][tier+'_tier']
        declared=np.array(spec['bundle_edges_x'])
        declared=(declared-g['spec']['covers']['x'][0])/g['spec']['covers']['metres_per_pixel']
        construction=manifest[tier]['bundles']
        assert len(edges)==len(construction)==spec['bundles']
        for i,(edge,end,detected,p) in enumerate(zip(edges,ends,locations,construction)):
            col=int(edge)
            record=dict(tier=tier,bundle=i,guide_x=col,guide_right=int(end),
                        layout_json_x=float(declared[i]),layout_raster_error_px=float(abs(col-declared[i])),
                        construction_left=p['left'],construction_right=p['right'],
                        construction_error_px=max(abs(p['left']-col),abs(p['right']-int(end))),
                        uv_axis_lean_px=p['lean'],
                        guide_body_vertical=bool(np.all(g['labels'][start:stop,col]==row[col])),
                        detected_rgb_edge_x=detected,rgb_error_px=abs(detected-col),
                        rgb_edge_rms=float(score[col]),strong_candidate_x=peak_sets[i],
                        body_rows=[start,stop])
            records.append(record)
            # Cyan: guide / dashed pink: RGB peak. Leave raw pixels alongside.
            draw.line((col,start,col,stop-1),fill=(30,235,235),width=1)
            for y in range(start+8,stop,22):
                draw.line((detected%N,y,detected%N,min(stop-1,y+7)),fill=(255,85,150),width=1)
            mid=int((edge+end)/2)%N
            draw.text((mid-12,start+24),str(i+1),font=font(18),fill=(245,245,245),stroke_width=2,stroke_fill=(25,25,25))
    annotated.save(OUT/'bundle_edges_overlay.png')
    panel([Image.fromarray(base[...,:3]),annotated],
          ['DELIVERED RGB  |  new sheaf layout','CYAN guide  /  PINK detected RGB edge'],
          'bundle_alignment.png',width=1024)
    result=dict(method='RMS horizontal RGB derivative over opaque body; find local peaks >=95% of maximum within +/- quarter neighbour width; match nearest strong candidate',
                exact_construction_tolerance_px=0,rgb_tolerance_px=4,
                tolerance_reason='a reed or crossing stray may cover the precise pigment boundary; all competing strong peaks are recorded',
                edges=records,negative_controls=controls,
                max_construction_error_px=max(r['construction_error_px'] for r in records),
                max_rgb_error_px=max(r['rgb_error_px'] for r in records),
                all_edges_aligned=all(r['construction_error_px']==0 and r['rgb_error_px']<=4
                                      and r['layout_raster_error_px']<=1 and r['guide_body_vertical']
                                      and r['uv_axis_lean_px']==0 for r in records))
    (OUT/'bundle_edges.json').write_text(json.dumps(result,indent=2)+'\n')
    return result

def main():
    OUT.mkdir(exist_ok=True)
    names=['thatch_base.png','thatch_height.png','thatch_normal.png','thatch_orm.png']
    ims=[Image.open(ROOT/n) for n in names]
    base,h,normal,orm=[np.array(i) for i in ims]
    g=read_guides();a=base[...,3]>127;y=np.arange(N)[:,None]
    raw=base[...,:3]/255*a[...,None]+BG*(~a)[...,None]
    # Native generated-alpha proof, also regenerated by this checker.
    source=np.array(Image.open(ROOT/'source/reed_sheaves_generated.png')).astype(np.float32)/255
    img(source[...,:3]*source[...,3:4]+BG*(1-source[...,3:4])).save(OUT/'source_sheaves_on_dark.png')
    # Native-size evidence, plus presentation contact sheets.
    img(raw).save(OUT/'base_cutout.png')
    panel([img(raw),Image.fromarray((h/257).astype(np.uint8)).convert('RGB'),Image.fromarray(normal),Image.fromarray(orm)],
          ['BASE  |  sRGB + binary cutout','HEIGHT  |  16-bit / 16 mm range','NORMAL  |  OpenGL / physical scale','ORM  |  AO / dry roughness / zero metal'], 'layers.jpg')
    layout=g['layout']/255
    comp=np.where(a[...,None],base[...,:3]/255*.83+layout*.17,layout)
    img(comp).save(OUT/'base_over_layout.png')
    # White=covered reed, blue=allowed but empty, red=illegal (must be absent).
    env=np.zeros((N,N,3),np.float32)+BG
    env[g['env']]=[.11,.25,.32];env[a]=[.89,.86,.73];env[a&~g['env']]=[1,0,.12]
    img(env).save(OUT/'alpha_over_envelope.png')
    # Also show the UPPER contour, which the global envelope cannot constrain.
    out=np.where(g['upper'][...,None],np.array([.11,.25,.32]),BG)
    out=np.broadcast_to(out,(N,N,3)).copy()
    out[g['upper']&a]=[.89,.86,.73]
    img(out).save(OUT/'upper_alpha_over_layout.png')
    left=relief(base,normal,orm,g,-1);right=relief(base,normal,orm,g,1)
    img(left).save(OUT/'relief_sun_left.png');img(right).save(OUT/'relief_sun_right.png')
    panel([img(left),img(right)],['LOW SUN FROM LEFT  |  guide relief + material','LOW SUN FROM RIGHT  |  guide relief + material'],'relit_relief.jpg',1024)
    tiled=np.tile(right,(1,3,1));img(tiled).save(OUT/'three_walls.png')
    img(tiled).resize((2304,768),Image.Resampling.LANCZOS).save(OUT/'three_walls.jpg',quality=95)
    # A 1:1 crop: 768 physical texels wide, absolutely no scaling.
    box=(390,724,1158,1108)
    crop=img(right).crop(box);crop.save(OUT/'skirt_tips_1to1.png')
    rawcrop=img(raw).crop(box)
    evidence=Image.new('RGB',(768,2*384+96),(22,26,29));d=ImageDraw.Draw(evidence)
    d.text((15,12),'1:1 TEXELS  |  lit upper skirt, lower reeds behind',font=font(20),fill=(230,225,212));evidence.paste(crop,(0,48))
    d.text((15,444),'1:1 TEXELS  |  same crop, raw alpha over dark',font=font(20),fill=(230,225,212));evidence.paste(rawcrop,(0,480));evidence.save(OUT/'skirt_tips_comparison.png')
    # Independent finite difference implementation against the delivered 16-bit PNG.
    z=h.astype(np.float64)/65535*HEIGHT_MM
    dx=np.empty_like(z);dx[:,1:-1]=(z[:,2:]-z[:,:-2])/(2*PIXEL_MM)
    dx[:,0]=(z[:,1]-z[:,-1])/(2*PIXEL_MM);dx[:,-1]=(z[:,0]-z[:,-2])/(2*PIXEL_MM)
    dy=np.empty_like(z);dy[1:-1]=(z[2:]-z[:-2])/(2*PIXEL_MM)
    dy[0]=(z[1]-z[0])/PIXEL_MM;dy[-1]=(z[-1]-z[-2])/PIXEL_MM
    ref=np.stack([-dx,dy,np.ones_like(z)],axis=2);ref/=np.linalg.norm(ref,axis=2,keepdims=True)
    quant=np.rint((ref*.5+.5)*255).astype(np.uint8)
    decoded=normal.astype(np.float64)/255*2-1;decoded/=np.linalg.norm(decoded,axis=2,keepdims=True)
    angle=np.degrees(np.arccos(np.clip(np.sum(ref*decoded,axis=2),-1,1)))
    bodies=(y<g['upper_start'])|((~g['upper'])&(y<g['lower_start']))
    upper_tip=g['upper'] & (y>=g['upper_start'])
    lower_tip=g['env'] & (y>=g['lower_start'])
    revision=round4_evidence(base,h,normal,orm,g,left,right,bodies,upper_tip|lower_tip)
    bundle_edges=bundle_edge_evidence(base,g)
    inset=g['lower_end'][None,:]-y
    upinset=g['upper_end'][None,:]-y
    # Measure real Euclidean clearance (not just vertical distance), with the
    # same periodic topology as adjacent walls. Quantify detached alpha flecks.
    clear_lower=distance_transform_edt(np.tile(g['env'],(1,3)))[:,N:2*N]
    clear_upper=distance_transform_edt(np.tile(g['upper'],(1,3)))[:,N:2*N]
    fragments={}
    for tier in ['upper','lower']:
        master=np.array(Image.open(ROOT/f'source/{tier}_master.png'))[...,3]>127
        labels,_=label(np.tile(master,(1,3)),structure=np.ones((3,3),int))
        fragments[tier]=int(np.sum(master & (labels[:,N:2*N]!=labels[0,N])))
    low_frequency=gaussian_filter(z,(32,32),mode=('nearest','wrap'))
    manifest=json.loads((ROOT/'source/build_manifest.json').read_text())
    measurements=dict(
        files={n:dict(size=list(i.size),mode=i.mode,png_bit_depth=(ROOT/n).read_bytes()[24],sha256=hashlib.sha256((ROOT/n).read_bytes()).hexdigest()) for n,i in zip(names,ims)},
        physical=dict(width_metres=3,height_metres=3,pixel_mm=PIXEL_MM,height_full_range_mm=HEIGHT_MM,used_height_mm=[float(z.min()),float(z.max())],normal_convention='OpenGL: +G toward image top; x periodic, y one-sided only at outer rows'),
        alpha=dict(values=np.unique(base[...,3]).tolist(),outside_envelope_pixels=int(np.sum(a&~g['env'])),outside_envelope_alpha_sum=int(base[...,3][~g['env']].sum()),body_nonopaque_pixels=int(np.sum(bodies&~a)),upper_tip_coverage=float(a[upper_tip].mean()),lower_tip_coverage=float(a[lower_tip].mean()),lower_tip_min_inset_px=int(np.min(inset[a&lower_tip])),upper_tip_min_inset_px=int(np.min(upinset[a&upper_tip])),upper_tip_min_clearance_px=float(clear_upper[upper_tip&a].min()),lower_tip_min_clearance_px=float(clear_lower[lower_tip&a].min()),detached_tip_pixels=fragments),
        round4=revision,
        bundle_alignment=bundle_edges,
        wrap_seam={n:seam(v) for n,v in zip(['base_rgb','alpha','height_u16','normal_rgb','orm_rgb'],[base[...,:3],base[...,3],h,normal,orm])},
        normal_height=dict(max_byte_error=int(np.abs(quant.astype(int)-normal.astype(int)).max()),mean_angular_error_degrees=float(angle.mean()),p99_angular_error_degrees=float(np.percentile(angle,99)),max_angular_error_degrees=float(angle.max())),
        material=dict(roughness_min=float(orm[...,1].min()/255),roughness_max=float(orm[...,1].max()/255),metalness_nonzero_pixels=int(np.count_nonzero(orm[...,2])),ao_range=[int(orm[...,0].min()),int(orm[...,0].max())]),
        construction=dict(upper_bundles=len(manifest['upper']['bundles']),lower_bundles=len(manifest['lower']['bundles']),analytic_stems=manifest['upper']['stem_count']+manifest['lower']['stem_count'],geometry_depth_in_delivered_height=False,low_frequency_height_std_mm=float(low_frequency.std()),height_depth_correlation=float(np.corrcoef(z[bodies],g['depth'][bodies])[0,1])),
        preview=dict(method='linear-light orthographic two-surface relief, delivered OpenGL normal + guide/depth; ray marched sun shadow; upper holes reveal lower RGB; exterior is dark',sun_directions=[[-.86,.34,.38],[.86,.34,.38]],crop_box=list(box),crop_scale=1)
    )
    measurements['all_assertions_passed']=False
    (OUT/'measurements.json').write_text(json.dumps(measurements,indent=2)+'\n')
    assert all(i.size==(N,N) for i in ims)
    assert [i.mode for i in ims]==['RGBA','I;16','RGB','RGB']
    assert [measurements['files'][n]['png_bit_depth'] for n in names]==[8,16,8,8]
    assert 'srgb' in ims[0].info and all('srgb' not in i.info for i in ims[1:])
    assert measurements['alpha']['values']==[0,255]
    assert bundle_edges['all_edges_aligned'], 'Delivered RGB bundle edges do not match guides'
    assert all(c['rejected'] for tier in bundle_edges['negative_controls'].values() for c in tier.values())
    assert measurements['alpha']['outside_envelope_pixels']==0
    assert measurements['alpha']['body_nonopaque_pixels']==0
    assert measurements['alpha']['upper_tip_min_inset_px']>=8
    assert measurements['alpha']['lower_tip_min_inset_px']>=8
    preservation=revision['preservation']
    assert preservation['guides_byte_identical'] and preservation['generated_sources_byte_identical']
    assert preservation['placement_identical']
    assert all(v['byte_identical'] for v in preservation['protected'].values()), 'Round 3 protected surface changed'
    assert all(v['byte_identical'] for v in preservation['archives'].values())
    assert np.max(np.abs(np.array(revision['colour']['body_mean_rgb'])-[191,146,82]))<3
    assert np.max(np.abs(np.array(revision['colour']['tip_mean_rgb'])-[214,184,132]))<3
    assert np.all(np.array(revision['colour']['bundle_mean_std_rgb'])>revision['colour']['round3_bundle_mean_std_rgb'])
    assert np.all(np.array(revision['colour']['body_p05_rgb'])<revision['colour']['round3_body_p05_rgb'])
    assert all(.43<b['fade_start']<.57 and b['fade_end']-b['fade_start']>.4
               for b in revision['fade']['bundle_profiles'])
    assert all(max(v)<8 for v in revision['fade']['max_one_percent_step_rgb'].values()), 'Abrupt delivered fade'
    visible_tips=base[(upper_tip|lower_tip)&a,:3].astype(int)
    assert np.all(visible_tips[:,0]-visible_tips[:,2]>35), 'A tip lost its warm straw chroma'
    assert all(min(t['darkening_rgb'])>3 and t['local_compression_mm']>.1 and t['detected_error_px']<2 for t in revision['ties'].values())
    assert all(abs(t['layout_bar_center']-t['row'])<1 for t in revision['ties'].values())
    assert min(measurements['alpha']['upper_tip_min_clearance_px'],measurements['alpha']['lower_tip_min_clearance_px'])>=14
    assert sum(fragments.values())==0
    assert measurements['normal_height']['max_byte_error']<=1
    assert measurements['material']['metalness_nonzero_pixels']==0
    assert measurements['material']['roughness_min']>=.70-1/255
    assert measurements['material']['roughness_max']<=.95+1/255
    for key in ['base_rgb','height_u16','normal_rgb','orm_rgb']:
        assert measurements['wrap_seam'][key]['seam_to_interior']<2
    assert measurements['wrap_seam']['alpha']['seam_to_interior']<3
    assert measurements['construction']['low_frequency_height_std_mm']<.3
    measurements['all_assertions_passed']=True
    (OUT/'measurements.json').write_text(json.dumps(measurements,indent=2)+'\n')
    print(json.dumps({k:measurements[k] for k in ['alpha','normal_height','wrap_seam','all_assertions_passed']},indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rebuild',action='store_true',help='Rebuild maps first and verify byte-identical reproduction when maps already exist')
    args=parser.parse_args()
    if args.rebuild:
        names=['thatch_base.png','thatch_height.png','thatch_normal.png','thatch_orm.png']
        before={n:hashlib.sha256((ROOT/n).read_bytes()).hexdigest() for n in names if (ROOT/n).exists()}
        t=time.perf_counter()
        subprocess.run([sys.executable,str(ROOT/'build_material.py')],check=True)
        build_time=time.perf_counter()-t
        t=time.perf_counter();main();check_time=time.perf_counter()-t
        after={n:hashlib.sha256((ROOT/n).read_bytes()).hexdigest() for n in names}
        result=dict(command='python3 check_material.py --rebuild',maps_byte_identical=(before==after if len(before)==4 else None),
                    per_file={n:before[n]==after[n] for n in before},sha256=after,
                    rebuild_seconds=round(build_time,3),check_seconds=round(check_time,3))
        (OUT/'rebuild.json').write_text(json.dumps(result,indent=2)+'\n')
        if len(before)==4: assert before==after,'Rebuild changed delivered maps'
    else:
        main()
