"""Inspect full-resolution delivered texels, without the software renderer's mip.

python3 -B tex/paint/body/atlas_review.py
Reads checks/composed (run compose.py there first). All shading is from the
delivered normal/occlusion; region colours are the game's default palette.
"""
import json,hashlib
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
import paint

ROOT=Path(__file__).resolve().parent;QA=ROOT/'checks'
REGIONS=[(255,0,0),(0,255,0),(0,0,255),(0,255,255),(255,0,255),(255,255,0)]
DYES=np.array([[107,115,122],[209,162,146],[139,145,102],[194,149,51],[49,45,42],[230,226,214]])/255

def colour(base,regions,normal,ao):
    rgb=paint.lin(base[...,:3]/255)
    for col,dye in zip(REGIONS,DYES):
        m=np.all(regions==col,-1);rgb[m]*=paint.lin(dye)/.5
    n=paint.norm(normal[...,:3]/127.5-1)
    light=np.array([-.45,.65,1.]);light/=np.linalg.norm(light)
    # AO reduces ambient light, not direct illumination of the atlas. This
    # keeps the surface inspectable where a wing casts baked form occlusion.
    diffuse=.42*ao+.58*np.maximum(np.sum(n*light,-1),0)
    return Image.fromarray(np.uint8(np.rint(np.clip(paint.srgb(rgb*diffuse[...,None]),0,1)*255)))

def measurements():
    z=np.load(QA/'ownership.npz');rg=np.asarray(Image.open(QA/'composed/dodo_regions.png'))
    layer=np.asarray(Image.open(ROOT/'layers/dodo_regions.png'))
    valid=np.asarray(Image.open(ROOT/'layers/dodo_base.png'))[...,3]>128
    assert np.array_equal(rg[...,1][valid]>128,layer[...,1][valid]>128),'Compose the current layers before measuring'
    cream=rg[...,1]>128;placements=json.loads((QA/'placements.json').read_text())
    records=[];bins=np.arange(0,12.5,.5);total=np.zeros(len(bins)-1);pale=total.copy()
    for i,s in enumerate(placements):
        if s['family']!='barred' or s['centre'][0]>82 or s['centre'][1]<340:continue
        owned=z['feather']==i;d=z['tip_depth_mm'];u=z['tip_u']
        centre=owned&(abs(u-.5)<.06)&(d>=0)&(d<12)
        side=owned&(abs(u-.5)>.32)&(abs(u-.5)<.39)&(d>=0)&(d<12)
        q=d[centre&cream];r=d[side&cream]
        if len(q)<8:continue
        total+=np.histogram(d[centre],bins)[0];pale+=np.histogram(q,bins)[0]
        records.append(dict(feather=i,row=s['row'],column=s['col'],source=s['source'],
            shaft_reach_mm=float(np.percentile(q,98)),shaft_max_mm=float(q.max()),
            side_reach_mm=float(np.percentile(r,98)) if len(r) else None,
            shaft_texels=int(len(q))))
    fractions=pale/np.maximum(total,1);mid=(bins[1:]+bins[:-1])/2
    # The pooled 90% -> 10% decline reports actual delivered coverage, rather
    # than nominal source probability before the sampling/threshold stages.
    inward=mid>=3
    decline=np.minimum.accumulate(fractions[inward])
    root90=float(np.interp(.90,decline[::-1],mid[inward][::-1]))
    root10=float(np.interp(.10,decline[::-1],mid[inward][::-1]))
    result=dict(definition='Composed binary 2048 region texels belonging to each feather; physical distance along its own direction from its free fringe. Shaft window +/- 6% of width; dorsal feathers only. 98th percentile discounts isolated tips.',
        feathers=records,shaft_reach_median_mm=float(np.median([r['shaft_reach_mm'] for r in records])),
        shaft_reach_range_mm=[float(min(r['shaft_reach_mm'] for r in records)),float(max(r['shaft_reach_mm'] for r in records))],
        side_reach_median_mm=float(np.median([r['side_reach_mm'] for r in records if r['side_reach_mm'] is not None])),
        shaft_depth_bins_mm=bins.tolist(),shaft_cream_fraction=np.round(fractions,4).tolist(),
        dissolve_90_to_10_mm=root10-root90,dissolve_interval_mm=[root90,root10],
        region_sha256=hashlib.sha256((QA/'composed/dodo_regions.png').read_bytes()).hexdigest(),
        composed_matches_owned_tips=True)
    (QA/'tip_depth_2048.json').write_text(json.dumps(result,indent=2)+'\n')
    return result

def main():
    cp=QA/'composed'
    read=lambda n:np.asarray(Image.open(cp/f'dodo_{n}.png'))
    base,regions,normal,packed=[read(n) for n in ['base','regions','normal','packed']]
    lit=colour(base,regions,normal,packed[...,0]/255)
    box=(530,1010,1190,1510);crop=lit.crop(box)
    crop.save(QA/'bars_2048_native.png')
    mm=np.asarray(Image.open(paint.PAINT/'texel_mm.png'))/1000
    own=np.asarray(Image.open(ROOT/'layers/dodo_base.png'))[...,3]>128
    sel=np.s_[box[1]:box[3],box[0]:box[2]];scale=float(np.median(mm[sel][own[sel]]))
    concept=Image.open(paint.DODO/'ref/concept/top.png').crop((417,600,837,918))
    factor=1/(1.5*scale);concept=concept.resize((round(concept.width*factor),round(concept.height*factor)),Image.Resampling.LANCZOS)
    W=max(crop.width,concept.width);H=max(crop.height,concept.height)
    board=Image.new('RGB',(2*W,H+78),(29,31,34));draw=ImageDraw.Draw(board)
    board.paste(concept,(0,30));board.paste(crop,(W,30))
    draw.text((8,9),f'Concept / {1000/scale:.0f} pixels per metre',fill='white')
    draw.text((W+8,9),'Composed 2048 map / native texels / dyed + relit',fill='white')
    length=round(10/scale)
    for x in [8,W+8]:
        draw.line((x,H+43,x+length,H+43),fill='white',width=2)
        draw.text((x,H+51),'10 mm (atlas median; UV scale varies)',fill='white')
    board.save(QA/'bars_2048_beside_concept.png')
    before=QA/'round5_before/layers'
    if before.exists():
        old_base=base.copy();old_regions=regions.copy()
        old_layer=np.asarray(Image.open(before/'dodo_base.png'));m=old_layer[...,3]>128
        old_base[m]=old_layer[m,:3]
        old_regions[m]=np.asarray(Image.open(before/'dodo_regions.png'))[m]
        old=colour(old_base,old_regions,normal,packed[...,0]/255).crop(box)
        pair=Image.new('RGB',(2*crop.width,crop.height+30),(29,31,34));d=ImageDraw.Draw(pair)
        pair.paste(old,(0,30));pair.paste(crop,(crop.width,30))
        d.text((8,9),'Previous body layers / same normal, light and texels',fill='white')
        d.text((crop.width+8,9),'Revised body / native 2048 texels',fill='white')
        pair.save(QA/'bars_2048_before_after.png')
    print(json.dumps(measurements(),indent=2))

if __name__=='__main__':main()
