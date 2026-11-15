"""Physical-scale comparison from exported maps and the repository concept.

The eye's visible horizontal extent is approximately 136 source pixels for the
22 mm design eye, giving 6.182 concept pixels/mm. Both columns are enlarged 2x.
This is a local scale calibration, not a UV projection or a painted replacement.
"""
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
import check as c

ROOT=Path(__file__).resolve().parent
PPM=136/22
ZOOM=2


def unlit(a,dye):
    rgb=c.linear(a['base'][...,:3].astype(np.float32)/255)*c.hexlin(dye)/.5
    return Image.fromarray(np.uint8(np.rint(c.srgb(rgb)*255)))


def fold_placement(arrays,meta):
    """Disposable preview of the frozen complete patches on the revised skin.

    Blend linear base and physical height using continuous coverage, then
    derive normals and AO from that composite. No production map is rewritten.
    """
    from build import normal_from_mm, ambient_occlusion
    skin,folds=arrays['skin'],arrays['folds']
    alpha=folds['base'][...,3].astype(np.float32)/255
    blend=lambda a,b:a*(1-alpha)+b*alpha
    height_mm=meta['sets']['skin']['height_mm']
    h=blend(skin['height'].astype(np.float32),folds['height'].astype(np.float32))
    h=(h/65535-.5)*height_mm
    span_mm=meta['sets']['skin']['span_m']*1000
    normal=normal_from_mm(h,span_mm)
    base=blend(c.linear(skin['base'][...,0]/255),c.linear(folds['base'][...,0]/255))
    base=np.uint8(np.rint(c.srgb(base)*255))
    ao=ambient_occlusion(h,span_mm)
    rough=blend(skin['packed'][...,1]/255,folds['packed'][...,1]/255)
    composite=dict(base=np.repeat(base[...,None],3,axis=-1),
        normal=np.uint8(np.rint((normal*.5+.5)*255)),
        packed=np.uint8(np.rint(np.stack([ao,rough,np.zeros_like(ao)],-1)*255)))
    items=[]
    for name,box in [('eye',(208,168,720,680)),('mouth',(1208,168,1720,680))]:
        patch=c.crop_arrays(composite,box)
        items.extend([(name+' / frozen folds blended onto round 4 skin',c.render(patch,'#DDA089')),
                      (name+' / same blend, opposite light',c.render(patch,'#DDA089',(.6,-.55,.58)))])
    c.grid(items,2,512,'PLACEMENT / unchanged fold patches / continuous alpha / recomputed relief').save(c.QA/'folds_on_revised_skin.png')


def comparisons(arrays=None):
    meta=json.loads((ROOT/'study.json').read_text())
    if arrays is None:
        arrays={n:{k:np.asarray(Image.open(ROOT/f)) for k,f in v['maps'].items()} for n,v in meta['sets'].items()}
    concept=Image.open(ROOT.parents[2]/'ref/concept/head_side.png').convert('RGB')
    # Centres select the intended feature, not the empty middle of the atlas.
    rows=[('skin / cheek','skin',(790,510,930,600),(800,800)),
          ('folds / four lower-eye rolls','folds',(795,425,975,555),(464,399)),
          ('folds / mouth corner','folds',(770,603,890,703),(1468,440)),
          ('brow / shallow grain','brow',(760,315,1010,395),(850,850)),
          ('pouch / pleats and a fork','pouch',(691,712,831,907),(740,330))]
    board=Image.new('RGB',(1560,1750),(27,30,32));d=ImageDraw.Draw(board)
    d.text((22,18),f'ROUND {meta["round"]} / DEFAULT DYES / MATCHED PHYSICAL SCALE',font=c.font(26),fill=(236,231,220))
    d.text((22,56),'Concept: 136 px eye / 22 mm. All panels show 2x concept scale; no texture rescaling to force a match.',font=c.font(17),fill=(203,205,198))
    for x,text in [(20,'Concept head detail'),(540,'Delivered base / default dye / unlit'),(1060,'Delivered maps / default dye / relit')]:
        d.text((x,95),text,font=c.font(19),fill=(235,229,215))
    records=[]
    for i,(label,name,refbox,centre) in enumerate(rows):
        y=135+i*320;d.text((22,y),label,font=c.font(21),fill=(235,229,215))
        ref=concept.crop(refbox);w,h=ref.size
        px_mm=2048/(meta['sets'][name]['span_m']*1000)
        sw,sh=round(w/PPM*px_mm),round(h/PPM*px_mm)
        sx,sy=round(centre[0]-sw/2),round(centre[1]-sh/2)
        a=c.crop_arrays(arrays[name],(sx,sy,sx+sw,sy+sh))
        dye='#DDA089' if name in ('skin','folds') else '#C49C58'
        ims=[ref,unlit(a,dye),c.render(a,dye)]
        for j,im in enumerate(ims):
            target=(w*ZOOM,h*ZOOM)
            im=im.resize(target,Image.Resampling.LANCZOS)
            # Very tall pouch is shown at the same zoom, with a narrower crop.
            if im.height>280: im=im.crop((0,0,im.width,280))
            board.paste(im,(j*520+(520-im.width)//2,y+35))
        bar=round(5*PPM*ZOOM)
        d.line((1475-bar,y+12,1475,y+12),fill=(230,227,217),width=3)
        d.text((1475-bar,y-9),'5 mm',font=c.font(13),fill=(220,218,208))
        records.append(dict(label=label,set=name,reference_crop_px=refbox,study_crop_px=[sx,sy,sx+sw,sy+sh],concept_pixels_per_mm=PPM,zoom=ZOOM))
    board.save(c.QA/'concept_scale.png')
    (c.QA/'concept_scale.json').write_text(json.dumps(records,indent=2)+'\n')
    # Full source next to default-lit study chips at native concept scale.
    head=concept.copy();canvas=Image.new('RGB',(2055,1085),(27,30,32));canvas.paste(head,(0,0));d=ImageDraw.Draw(canvas)
    for i,(name,box) in enumerate([('skin',(650,650,1150,1000)),('folds',(300,280,630,510)),('brow',(650,650,1150,880)),('pouch',(600,620,1000,890))]):
        a=c.crop_arrays(arrays[name],box);span=meta['sets'][name]['span_m']*1000
        im=c.render(a,'#DDA089' if name in ('skin','folds') else '#C49C58')
        im=im.resize((round(im.width/2048*span*PPM),round(im.height/2048*span*PPM)),Image.Resampling.LANCZOS)
        y=30+i*260;canvas.paste(im,(1570,y+35));d.text((1570,y),name+' / default dye / native concept scale',font=c.font(17),fill=(232,228,218))
    canvas.save(c.QA/'head_comparison.png')
    # Original, physical size, and its role are explicit: these originals supply
    # micrograin, while the large rounded cells are reconstructed at physical scale.
    items=[]
    for name,source,source_mm in [('skin','skin_relief_original.png',60),('brow','brow_relief_original.png',48)]:
        original=Image.open(ROOT/'source'/source).convert('RGB')
        # A 40 mm square from every column; same enlargement, no hidden scaling.
        ow=round(original.width*40/source_mm);o=original.crop((0,0,ow,ow))
        sw=round(2048*40/(meta['sets'][name]['span_m']*1000))
        a=c.crop_arrays(arrays[name],(400,400,400+sw,400+sw))
        items.extend([(name+' original / micrograin source / 40 mm',o),
                      (name+' delivered neutral base / 40 mm',Image.fromarray(a['base'][...,:3])),
                      (name+' delivered relit / 40 mm',c.render(a,'#DDA089' if name=='skin' else '#C49C58'))])
    c.grid(items,3,480,'SOURCE COMPARISON / original grain vs reconstructed material / equal physical spans').save(c.QA/'source_comparison.png')
    if 'folds_reference_skin' in meta:
        fold_placement(arrays,meta)


if __name__=='__main__':
    c.QA.mkdir(exist_ok=True)
    comparisons()
