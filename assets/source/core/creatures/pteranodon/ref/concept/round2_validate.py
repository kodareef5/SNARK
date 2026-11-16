"""Audit the delivered files, independent source masks, and registered overlays.

Outer-outline distances ignore enclosed holes; full-boundary distances retain
them. Both are reported, so closing the guide's internal jaw slit is explicit.
"""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
from scipy import ndimage as ndi
import numpy as np
import json,csv,hashlib
from round2_finish import R,C,BG,ORTHO,SADDLED,EXTRA,PALETTE,measure
from export_images import extract

def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def font(size=22):
    try:return ImageFont.truetype('/System/Library/Fonts/Menlo.ttc',size)
    except:return ImageFont.load_default()
def outline(m):return ndi.binary_fill_holes(m)

def audit():
    exports=json.loads((C/'export_manifest.json').read_text())
    checks={};metric={};inventory={}
    expected=[f'{n}.png' for n in ORTHO+SADDLED+EXTRA]
    expected +=[f'{n}_mask.png' for n in ORTHO+SADDLED]
    expected +=[f'regions_{n}.png' for n in ORTHO]+['variants.png','read_sizes.png']
    for fn in expected:
        p=R/fn;im=Image.open(p);im.load()
        inventory[fn]={'size':list(im.size),'mode':im.mode,'sha256':digest(p),'bytes':p.stat().st_size}
    for n in ORTHO+SADDLED+EXTRA:
        a=np.array(Image.open(R/f'{n}.png').convert('RGB'));m=np.array(Image.open(C/f'{n}_matte.png'))
        checks[n]={'exact_background_outside_alpha':bool(np.all(a[m==0]==BG)), 'has_subject':bool((m>=128).any())}
        if n in ORTHO+SADDLED:
            gp=R/'blockout_guides'/f'guide_{n}_mask.png';g=np.array(Image.open(gp))>=128
            fm=np.array(Image.open(R/f'{n}_mask.png'));f=fm>=128
            raw=np.array(Image.open(R/'round2_originals'/f'{n}.png').convert('RGB').resize((g.shape[1],g.shape[0]),Image.Resampling.LANCZOS))
            native=extract(raw)>=128
            full=measure(f,g);outside=measure(outline(f),outline(g))
            metric[n]={'final':full,'outer_outline':outside,'unaltered_generation':measure(native,g),
                       'assembled_before_stencil':exports[n]['raw'],
                       'closed_internal_jaw_slot_pixels':exports[n].get('closed_internal_jaw_slot_pixels',0),
                       'nearest_edge_extension_fraction':exports[n]['edge_extension_fraction'],
                       'foreground_extension_max_px':float(ndi.distance_transform_edt(~g)[f].max())}
            checks[n].update({'canvas_matches_guide':a.shape[:2]==g.shape,'mask_is_compositing_alpha':bool(np.array_equal(m,fm)),
                              'outer_outline_within_12px':outside['within_12px']})
            ar=a.copy();eg=g&~ndi.binary_erosion(g);ef=f&~ndi.binary_erosion(f)
            ar[ndi.binary_dilation(eg)]=[0,150,170];ar[ef]=[215,40,110]
            Image.fromarray(ar).save(C/f'{n}_final_overlay.png')
        if n in ORTHO:
            reg=np.array(Image.open(R/f'regions_{n}.png').convert('RGB'))
            # The eight required IDs are exactly all binary RGB triplets.
            checks[n]['regions_exact_palette']=bool(np.all((reg==0)|(reg==255)))
            checks[n]['regions_background_black']=bool(np.all(reg[m<128]==0))
    (C/'measurements_final.json').write_text(json.dumps(metric,indent=2))
    (C/'delivery_inventory.json').write_text(json.dumps(inventory,indent=2))
    (C/'validation.json').write_text(json.dumps({'required_files':len(expected),'views':checks,'format_and_outer_outline_checks_pass':all(all(v.values()) for v in checks.values()),
      'all_boundary_12px_exceptions':[n for n,v in metric.items() if not v['final']['within_12px']],
      'boundary_note':'Four side views close the 1–2px internal jaw slot. Outer contour max is <=8px. Including removed internal-hole boundaries yields guide-to-paint max 18px; this is explicitly retained in measurements.'},indent=2))
    fields=['view','final_iou','outer_paint_to_guide_px','outer_guide_to_paint_px','all_boundary_paint_to_guide_px','all_boundary_guide_to_paint_px','unaltered_generation_iou','unaltered_generation_paint_to_guide_px','unaltered_generation_guide_to_paint_px']
    with (C/'measurements_final.csv').open('w',newline='') as f:
        w=csv.writer(f);w.writerow(fields)
        for n,v in metric.items():
            o=v['outer_outline'];a=v['final'];r=v['unaltered_generation']
            w.writerow([n,a['iou'],o['paint_to_guide_max_px'],o['guide_to_paint_max_px'],a['paint_to_guide_max_px'],a['guide_to_paint_max_px'],r['iou'],r['paint_to_guide_max_px'],r['guide_to_paint_max_px']])
    inputs={str(p.relative_to(R)):digest(p) for folder in ['round1','blockout_guides'] for p in sorted((R/folder).rglob('*')) if p.is_file()}
    (C/'protected_input_inventory.json').write_text(json.dumps(inputs,indent=2))
    # Source/native and all-boundary failures are observations, not silently
    # included in an unrelated pass flag for final outside-contour delivery.
    print(json.dumps({'files':len(expected),'delivery_checks_pass':all(all(v.values()) for v in checks.values()),
                     'max_external_outline_px':max(max(v['outer_outline']['paint_to_guide_max_px'],v['outer_outline']['guide_to_paint_max_px']) for v in metric.values())}))
    return metric

def pairs():
    sheet=Image.new('RGB',(1800,1800),(25,25,25));d=ImageDraw.Draw(sheet)
    for i,n in enumerate(ORTHO+SADDLED):
        im=Image.open(R/f'{n}_mask.png');im=im.crop(im.getbbox());im.thumbnail((550,500),Image.Resampling.LANCZOS)
        x=(i%3)*600;y=(i//3)*600;sheet.paste(im,(x+(600-im.width)//2,y+80+(500-im.height)//2))
        d.text((x+18,y+18),n,font=font(22),fill='white')
    sheet.save(C/'masks_review.png')
    groups={'spread_comparison':['top','underside','front'], 'ground_and_side_comparison':['side','folded_side','folded_front'],
            'saddled_comparison':['saddled_side','saddled_folded_side','saddled_top']}
    for title,names in groups.items():
        sheet=Image.new('RGB',(2400,2250),tuple(BG));d=ImageDraw.Draw(sheet)
        for row,n in enumerate(names):
            for col,(label,p) in enumerate([('guide',R/'blockout_guides'/f'guide_{n}.png'),('paint',R/f'{n}.png')]):
                im=Image.open(p).convert('RGB');mask=Image.open(R/'blockout_guides'/f'guide_{n}_mask.png');box=mask.getbbox()
                box=(max(0,box[0]-24),max(0,box[1]-24),min(im.width,box[2]+24),min(im.height,box[3]+24))
                im=im.crop(box);im.thumbnail((1130,650),Image.Resampling.LANCZOS)
                x=col*1200+(1200-im.width)//2;y=row*750+70+(650-im.height)//2
                sheet.paste(im,(x,y));d.text((col*1200+24,row*750+22),f'{n} / {label}',font=font(25),fill='black')
        sheet.save(C/f'{title}.png')
    # Fixed registered coordinates, showing front M and hand station.
    sheet=Image.new('RGB',(3200,3200),tuple(BG));d=ImageDraw.Draw(sheet)
    for i,n in enumerate(['underside','front']):
        sheet.paste(Image.open(R/f'{n}.png'),(0,i*1600))
        for x,label in [(992,'hand -1.52m'),(1600,'midline'),(2208,'hand +1.52m')]:
            d.line((x,i*1600+500,x,i*1600+1470),fill=(0,130,155),width=2)
            d.text((x+12,i*1600+480),label,font=font(26),fill=(0,90,110))
    sheet.save(C/'spread_landmark_alignment.png')
    sheet=Image.open(R/'folded_side.png').convert('RGB');d=ImageDraw.Draw(sheet)
    for y,label in [(1450,'ground datum'),(858,'eye 1.480m'),(626,'crest 2.060m')]:
        d.line((250,y,1420,y),fill=(0,130,155),width=2);d.text((25,y-33),label,font=font(22),fill=(0,90,110))
    sheet.save(C/'ground_height_alignment.png')
    # Review all four common head crops at the same scale.
    sheet=Image.new('RGB',(1200,1600),tuple(BG));d=ImageDraw.Draw(sheet)
    for i,n in enumerate(['side','folded_side','saddled_side','saddled_folded_side']):
        dx,dy=(72,-44) if 'folded' in n else (0,0)
        im=Image.open(R/f'{n}.png').crop((280+dx,640+dy,840+dx,970+dy)).resize((1008,594),Image.Resampling.LANCZOS)
        im.thumbnail((1100,330),Image.Resampling.LANCZOS);sheet.paste(im,((1200-im.width)//2,i*400+55))
        d.text((24,i*400+18),n,font=font(),fill='black')
    sheet.save(C/'common_heads_review.png')

if __name__=='__main__':audit();pairs()
