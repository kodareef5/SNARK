#!/usr/bin/env python3
"""Independent measurements and visual reviews for both delivered horn sets.

Reads delivered PNGs, including quantized 16-bit height. Writes only checks/.
Run the game's review separately: bun tex/studies/look.ts tex/studies/horn.
"""
from pathlib import Path
import hashlib
import json
import runpy
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import distance_transform_edt, binary_erosion, gaussian_filter, label as component_labels

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'checks'
OUT.mkdir(exist_ok=True)
N=2048
PALETTE={'design':[(200,102,46),(42,44,47)],
         'lime / pink':[(159,224,31),(255,62,165)],
         'near black':[(24,27,30),(222,222,216)],
         'near white':[(239,236,223),(47,45,44)]}
BG=(215,213,205)
SHARED=runpy.run_path(str(ROOT.parent/'measure.py'))


def linear(v):return np.where(v<=.04045,v/12.92,((v+.055)/1.055)**2.4)
def srgb(v):
    v=np.maximum(v,0)
    return np.where(v<=.0031308,v*12.92,1.055*v**(1/2.4)-.055)

def font(size=18):
    try:return ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',size)
    except OSError:return ImageFont.load_default()

def rgb(v):return Image.fromarray(np.uint8(np.clip(np.rint(v*255),0,255)))

def read(name):
    return {k:np.asarray(Image.open(ROOT/f'{name}_{k}.png')) for k in ['base','height','normal','packed','regions']}

def colorize(maps, colors):
    base=linear(maps['base'][...,:3].astype(np.float32)/255)
    reg=maps['regions']; dye=np.zeros_like(base)
    dye[:]=linear(np.array(colors[0],np.float32)/255)
    dye[(reg[...,1]==255)&(reg[...,2]==255)]=linear(np.array(colors[1],np.float32)/255)
    return base*dye/.5

def shade(maps,colors,light=None):
    c=colorize(maps,colors)
    if light is not None:
        n=maps['normal'].astype(np.float32)/127.5-1
        n/=np.maximum(np.linalg.norm(n,axis=-1,keepdims=True),1e-6)
        p=maps['packed'].astype(np.float32)/255
        l=np.array(light,np.float32);l/=np.linalg.norm(l)
        diffuse=np.maximum((n*l).sum(-1),0)
        half=l+np.array([0,0,1],np.float32);half/=np.linalg.norm(half)
        exponent=np.maximum(2/np.maximum(p[...,1],.15)**2-2,1)
        spec=.035*(exponent+2)/8*np.maximum((n*half).sum(-1),0)**exponent
        c=c*(.28+.72*diffuse[...,None])*p[...,:1]+spec[...,None]
    im=rgb(srgb(c))
    if maps['base'].shape[-1]==4:
        back=Image.new('RGB',im.size,BG)
        back.paste(im,(0,0),Image.fromarray(maps['base'][...,3]));im=back
    return im

def grid(items,cols,width,title,dest):
    # Each cell is (label, image); pad without stretching the image geometry.
    rows=(len(items)+cols-1)//cols;head=55;label=34
    sizes=[int(im.height*width/im.width) for _,im in items]
    cellh=max(sizes)+label
    out=Image.new('RGB',(cols*(width+18)+18,head+rows*(cellh+18)),(237,235,228))
    d=ImageDraw.Draw(out);d.text((18,14),title,font=font(23),fill=(30,31,30))
    for i,(caption,im) in enumerate(items):
        x=18+(i%cols)*(width+18);y=head+(i//cols)*(cellh+18)
        d.text((x,y),caption,font=font(17),fill=(36,37,37))
        h=int(im.height*width/im.width)
        out.paste(im.resize((width,h),Image.Resampling.LANCZOS),(x,y+label))
    out.save(OUT/dest)
    return out


def corr(a,b):
    a=a.astype(np.float32).ravel();b=b.astype(np.float32).ravel()
    a-=a.mean();b-=b.mean()
    return float(np.dot(a,b)/max(np.linalg.norm(a)*np.linalg.norm(b),1e-12))


def measure(name,spec,maps):
    result=SHARED['measure_set'](str(ROOT),name,spec)
    failures=list(result['faults'])
    for layer,a in maps.items():
        assert a.shape[:2]==(N,N),(name,layer,a.shape)
    assert Image.open(ROOT/f'{name}_height.png').mode in ['I;16','I;16B','I']
    for k in ['base','normal','packed','regions']:assert maps[k].dtype==np.uint8
    base=maps['base'];reg=maps['regions'];solid=base[...,3]>=128 if base.shape[-1]==4 else np.ones((N,N),bool)
    assert np.max(np.ptp(base[...,:3].astype(np.int16),axis=-1)[solid])==0
    assert np.all(maps['packed'][...,2]==0)
    assert np.all(np.isin(reg,[0,255]))
    if spec['tiles']:
        for layer,ratios in result['seam'].items():
            if max(ratios)>1.3:failures.append(f'{layer} seam over 1.3: {ratios}')
    n=maps['normal'].astype(np.float32)/127.5-1
    h=maps['height'].astype(np.float32)/65535*spec['height_mm']
    factor=2*spec['span_m']*1000/N
    expected=np.stack([-(np.roll(h,-1,1)-np.roll(h,1,1))/factor,
                        (np.roll(h,-1,0)-np.roll(h,1,0))/factor,np.ones_like(h)],-1)
    expected/=np.sqrt((expected*expected).sum(-1,keepdims=True))
    expected8=np.rint((expected*.5+.5)*255).astype(np.uint8)
    byte_error=int(np.max(np.abs(expected8.astype(np.int16)-maps['normal'].astype(np.int16))))
    assert byte_error<=1
    length=np.sqrt((n*n).sum(-1))
    result['physical_normal']={'max_byte_error':byte_error,'max_length_error':float(np.max(np.abs(length-1))),
                               'height_used_mm':[float(h.min()-spec['height_mm']/2),float(h.max()-spec['height_mm']/2)]}
    if abs(result['baked_light']['corr'])>.1:failures.append('baked light correlation over .10')
    if base.shape[-1]==4:
        assert np.all((reg[...,2]==255)==solid)
        dist,near=distance_transform_edt(~solid,return_indices=True)
        gutter=(dist>0)&(dist<=16)
        expected=base[near[0][gutter],near[1][gutter],:3]
        bleed=int(np.abs(base[...,:3][gutter].astype(np.int16)-expected.astype(np.int16)).max())
        assert bleed==0
        result['alpha_bleed_max_error']=bleed
        result['alpha_coverage_by_size']={}
        for size in [2048,3600,1024,900,256]:
            a=np.asarray(Image.fromarray(base[...,3]).resize((size,size),Image.Resampling.LANCZOS))
            result['alpha_coverage_by_size'][size]=round(float((a>=128).mean()),6)
        nasal=np.asarray(Image.open(ROOT/'source/head_nostril_groove.png'))>128
        assert np.all(base[...,3][nasal]==255), 'Nostril must stay opaque'
        assert np.all(reg[nasal]==(0,0,255)), 'Nostril must stay region 2'
        result['nostril']={'alpha_min':int(base[...,3][nasal].min()),'region':2,
                           'mean_linear':float(linear(base[...,:3].astype(np.float32)/255)[nasal].mean()),
                           'mean_height_mm_relative_to_plane':float(h[nasal].mean()-spec['height_mm']/2)}
        if (OUT/'round1_regions.png').exists():
            old=np.asarray(Image.open(OUT/'round1_regions.png'))
            assert np.array_equal(old[...,1],reg[...,1]), 'Accepted crest band moved'
            oldalpha=np.asarray(Image.open(OUT/'round1_head.png'))[...,3]
            changed=oldalpha!=base[...,3]
            yy,xx=np.mgrid[:N,:N]
            in_nasal_box=(xx>990)&(xx<1120)&(yy>1360)&(yy<1420)
            assert not np.any(changed&~in_nasal_box), 'Accepted outer silhouette moved'
            result['round1_registration']={'band_identical':True,'alpha_changed_only_in_nostril':True,
                                            'alpha_changed_pixels':int(changed.sum())}
    result['faults']=failures
    return result


def tile_reviews(maps):
    crop=(704,704,1216,1216)
    items=[]
    for name,colors in PALETTE.items():
        for label,light in [('unlit',None),('light upper left',[-.6,.35,.8]),('light lower right',[.6,-.35,.8])]:
            items.append((name+' | '+label,shade(maps,colors,light).crop(crop)))
    grid(items,3,512,'HORN | 100% pixels, 100 mm crop | 3 light conditions x 4 dyes','horn_dyes_full.png')
    unlit=shade(maps,PALETTE['design'])
    lit=shade(maps,PALETTE['design'],[-.6,.35,.8])
    items=[]
    for label,im in [('Unlit dye',unlit),('Relit dye',lit)]:
        for size in [2048,960,96]:
            # Review the same full tile at actual pixel density; retain pixel size.
            a=im.resize((size,size),Image.Resampling.LANCZOS)
            if size>512:a=a.crop((size//2-256,size//2-256,size//2+256,size//2+256))
            frame=Image.new('RGB',(512,512),BG);frame.paste(a,((512-a.width)//2,(512-a.height)//2))
            items.append((label+f' | {size/0.4:.0f} px/m',frame))
    grid(items,3,512,'HORN | native study, animal density (2400 px/m), one tenth','horn_scales.png')
    tile=Image.open(ROOT/'horn_base.png').resize((512,512),Image.Resampling.LANCZOS)
    trip=Image.new('RGB',(1536,1536))
    for y in range(3):
        for x in range(3):trip.paste(tile,(x*512,y*512))
    trip.save(OUT/'horn_tiled_3x3.png')
    a=np.asarray(Image.open(ROOT/'horn_base.png'))
    Image.fromarray(np.roll(a,(1024,1024),(0,1))).save(OUT/'horn_half_offset.png')
    # Source comparison at identical positions and physical scale after the
    # necessary periodic overlap/remapping, with the original kept untouched.
    with np.load(ROOT/'source/horn_elements.npz') as z:
        source=z['source_periodic'];intrinsic=z['source_value']
    original=rgb(np.repeat(srgb(source)[...,None],3,-1))
    base=Image.open(ROOT/'horn_base.png')
    grey=[(188,188,188),(188,188,188)]
    relit=shade(maps,grey,[-.6,.35,.8])
    grid([('Generated source / registered',original.crop(crop)),('Delivered base',base.crop(crop)),
          ('Delivered set / relit',relit.crop(crop))],3,512,'SOURCE RETENTION | same 100 mm patch, no contrast tricks','source_comparison.png')
    delivered=linear(np.asarray(base,np.float32).mean(-1)/255)
    stats={'registered_intrinsic_source_base_correlation':corr(intrinsic,delivered),
           'source_intrinsic_linear_std':float(intrinsic.std()),'delivered_base_linear_std':float(delivered.std()),
           'source_original_size':list(Image.open(ROOT/'source/horn_generated.png').size)}
    residual=delivered-gaussian_filter(delivered,4,mode='wrap')
    components,count=component_labels(residual<-.07)
    areas=np.bincount(components.ravel())[1:]
    diam=2*np.sqrt(areas/np.pi)*400/N
    stats['dark_pit_components']={'count':count,'diameter_mm_p10_p50_p90':np.percentile(diam,[10,50,90]).tolist()}
    stats['broad_mottle_linear_std']=float(gaussian_filter(delivered,12,mode='wrap').std())
    animal=np.asarray(Image.open(ROOT/'horn_base.png').resize((960,960),Image.Resampling.LANCZOS),np.float32).mean(-1)/255
    animal=linear(animal)
    local=animal-gaussian_filter(animal,2,mode='wrap')
    stats['animal_density_dark_pit_fraction']=float((local<-.035).mean())
    return stats


def head_reviews(maps,spec):
    crop=(90,510,1940,1550)
    items=[]
    for name,colors in PALETTE.items():
        items.append((name+' / unlit',shade(maps,colors).crop(crop)))
        items.append((name+' / upper-left light',shade(maps,colors,[-.6,.35,.8]).crop(crop)))
        items.append((name+' / lower-right light',shade(maps,colors,[.6,-.35,.8]).crop(crop)))
    grid(items,3,900,'HEAD HORN | flat layout, pigment-only band, alpha gape and face','head_dyes.png')
    # Compare at the concept's scale: exactly 1000 pixels per metre.
    ref=Image.open(ROOT.parents[2]/'ref/concept/head_side.png').convert('RGB')
    region=(220,180,1590,915)
    concept=ref.crop(region)
    rendered=shade(maps,PALETTE['design']).resize((1500,1500),Image.Resampling.LANCZOS)
    origin=spec['reference_origin_px']
    rs=(region[0]-origin[0],region[1]-origin[1],region[2]-origin[0],region[3]-origin[1])
    study=rendered.crop(rs)
    grid([('Concept | lit illustration',concept),('Study | unlit horn layout',study)],2,1370,
         'REFERENCE MATCH | both 1000 pixels/metre; same coordinates and no shape rescale','concept_comparison.png')
    relit=shade(maps,PALETTE['design'],[-.6,.35,.8]).resize((1500,1500),Image.Resampling.LANCZOS)
    grid([('Concept | 1000 px/m',concept),('Delivered orange horn | relit | 1000 px/m',relit.crop(rs))],2,1370,
         'ROUND 2 | same physical scale, accepted silhouette and crest band','head_relit_vs_concept.png')
    details=[]
    for title,box in [('Crest',(1255,438,1385,568)),('Beak',(735,775,865,855)),('Nostril',(880,795,975,839))]:
        sourcebox=(box[0]-origin[0],box[1]-origin[1],box[2]-origin[0],box[3]-origin[1])
        for caption,im in [('concept',ref.crop(box)),('unlit',rendered.crop(sourcebox)),('relit',relit.crop(sourcebox))]:
            panel=Image.new('RGB',(160,160),BG);panel.paste(im,((160-im.width)//2,(160-im.height)//2))
            details.append((title+' / '+caption,panel.resize((480,480),Image.Resampling.NEAREST)))
    grid(details,3,480,'1000 px/m SAMPLES | enlarged 3x nearest for inspection, same scale in every column','concept_stipple_details.png')
    # Context composite uses the concept face only as an explicitly labelled preview.
    # Alpha strips removed by fuzzy tips reveal the reference's ivory fibres.
    raw=shade(maps,PALETTE['design'],[-.6,.35,.8])
    data=raw.resize((1500,1500),Image.Resampling.LANCZOS)
    alpha=Image.fromarray(maps['base'][...,3]).resize((1500,1500),Image.Resampling.LANCZOS)
    contextual=ref.copy();contextual.paste(data,tuple(origin),alpha)
    grid([('Original concept',concept),('Horn study over concept face / context only',contextual.crop(region))],2,1370,
         'CONTEXT ONLY | reference face and neck are not delivered horn pixels','head_context.png')
    # Native-resolution close-ups, without enlarging the study's sparse head panel.
    yx=[('Crest band',(1670,590,1910,910)),('Cap / fuzz contact',(1080,1190,1430,1510)),
        ('Nostril and gape',(955,1310,1325,1510))]
    ims=[]
    relit=shade(maps,PALETTE['design'],[-.6,.35,.8]);base=Image.open(ROOT/'head_side_base.png').convert('RGB')
    for title,box in yx:
        for lab,im in [('unlit',shade(maps,PALETTE['design'])),('relit',relit)]:
            c=im.crop(box);p=Image.new('RGB',(512,384),BG);p.paste(c,((512-c.width)//2,(384-c.height)//2));ims.append((title+' | '+lab,p))
    grid(ims,2,512,'HEAD DETAILS | native study pixels, background in cutouts','head_details.png')
    # Alpha cut after downsampling, exactly as the game threshold works.
    items=[]
    a=Image.fromarray(maps['base'][...,3]);r=shade(maps,PALETTE['design'])
    for size in [2048,3600,900]:
        alpha=np.asarray(a.resize((size,size),Image.Resampling.LANCZOS))>=128
        color=r.resize((size,size),Image.Resampling.LANCZOS)
        bg=Image.new('RGB',(size,size),(36,40,43));bg.paste(color,(0,0),Image.fromarray((alpha*255).astype(np.uint8)))
        # Keep the cut edge sharp even when the review enlarges it.
        viewbox=tuple(round(t*size/2048) for t in (1070,1260,1420,1520))
        c=bg.crop(viewbox).resize((700,520),Image.Resampling.NEAREST)
        items.append((f'{size}px panel / {size/1.5:.0f}px per metre | alpha .5',c))
    grid(items,3,700,'CUTOUT CHECK | native study / animal density / quarter density; enlarged nearest','head_alpha.png')
    # The scale prescribed for this layout is below final horn density; state it.
    return {'beak_to_crest_tip_m':float(np.hypot(1543-248,207-848)/1000),
            'horn_sheet_density_px_m':2048/1.5,'final_horn_density_px_m':2400,
            'note':'Head sheet is a placement guide at the explicitly requested 1.5m span; use the 0.4m tile for final-resolution grain.'}


def main():
    meta=json.loads((ROOT/'study.json').read_text())
    assert hashlib.sha256((ROOT/meta['source']['file']).read_bytes()).hexdigest()==meta['source']['sha256']
    report={'sets':{},'source_sha256_matches':True}
    for name,spec in meta['sets'].items():
        maps=read(name)
        report['sets'][name]=measure(name,spec,maps)
        print(name+': '+('PASS' if not report['sets'][name]['faults'] else str(report['sets'][name]['faults'])),flush=True)
        if name=='horn':report['source_retention']=tile_reviews(maps)
        else:report['layout']=head_reviews(maps,spec)
        del maps
    report['game_renderer']={'image':'checks/look/horn.png','exists':(OUT/'look/horn.png').exists(),
                              'head_side':'Intentionally skipped by shared renderer: form none.'}
    if (OUT/'look_round1_fixed/horn.png').exists() and (OUT/'look/horn.png').exists():
        items=[]
        for title,path in [('Round 1 | corrected outward faces',OUT/'look_round1_fixed/horn.png'),
                           ('Round 2 | delivered horn',OUT/'look/horn.png')]:
            # Pixel-preserving crops: no sharpening, regrading or enlargement.
            im=Image.open(path).convert('RGB')
            items.append((title,im.crop((8,155,764,290))))
        grid(items,1,756,'GAME | orange at 0.5 m in both lights | native screen pixels','horn_05m_compare.png')
    (OUT/'check.json').write_text(json.dumps(report,indent=2)+'\n')
    assert all(not r['faults'] for r in report['sets'].values()),'See checks/check.json'
    print('All checks passed; previews in '+str(OUT),flush=True)

if __name__=='__main__':main()
