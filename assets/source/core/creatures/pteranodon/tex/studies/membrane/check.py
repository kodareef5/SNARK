#!/usr/bin/env python3
"""Measure delivered PNGs independently and write ignored visual check sheets.

python3 tex/studies/membrane/check.py
python3 tex/studies/membrane/check.py --metrics-only
The renderer remains the authority: bun tex/studies/look.ts tex/studies/membrane
"""
from pathlib import Path
import argparse
import json
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt, maximum_filter, gaussian_filter
from build import linear, srgb

HERE = Path(__file__).resolve().parent
OUT = HERE/'checks'
DYES = dict(slate='56677A', pink='FF3EA5', dark='24282A', pale='C9CED3')
LIGHTS = [( .65, -.25, .72), (-.6, .3, .74), (.1, .75, .65)]


def load(name, layer):
    return np.asarray(Image.open(HERE/f'{name}_{layer}.png'))


def corr(a, b):
    a, b = a.ravel().astype(np.float64), b.ravel().astype(np.float64)
    a -= a.mean()
    b -= b.mean()
    return float(np.dot(a,b)/(np.linalg.norm(a)*np.linalg.norm(b)+1e-20))


def seam(a):
    a = a.astype(np.float32)
    return [float(np.abs(a[:,-1]-a[:,0]).mean() / max(1e-12, np.abs(np.diff(a,axis=1)).mean())),
            float(np.abs(a[-1]-a[0]).mean() / max(1e-12, np.abs(np.diff(a,axis=0)).mean()))]


def encoded(a):
    return Image.fromarray(np.rint(srgb(a)*255).astype(np.uint8))


def relight(base, normals, ao, rough, dye, light):
    color = linear(np.array([int(dye[i:i+2],16) for i in (0,2,4)],dtype=np.float32)/255)
    albedo = np.clip(base[...,None] * color / .5, 0, 1)
    light = np.asarray(light,dtype=np.float32)
    light /= np.linalg.norm(light)
    ndotl = np.maximum(0, np.sum(normals * light, axis=-1))
    shade = (.47+.53*ndotl)*ao
    # Tiny wide lobe only in this relit check, never in the delivered base.
    halfv = light + [0,0,1]
    halfv /= np.linalg.norm(halfv)
    spec = .025*np.maximum(0,np.sum(normals*halfv,axis=-1))**(2+10*(1-rough))
    return encoded(albedo*shade[...,None]+spec[...,None]*.18)


def measure(name, info):
    base = load(name,'base')
    b = linear(base[:,:,0]/255)
    hraw = load(name,'height')
    h = hraw.astype(np.float32)/65535 * info['height_mm']/1000
    n = load(name,'normal').astype(np.float32)/127.5-1
    packed = load(name,'packed')
    reg = load(name,'regions')
    pixel_m = info['span_m']/len(h)
    dx = (np.roll(h,-1,1)-np.roll(h,1,1))/(2*pixel_m)
    dy = (np.roll(h,-1,0)-np.roll(h,1,0))/(2*pixel_m)
    nl = np.linalg.norm(n,axis=-1)
    half = len(b)//2
    quarters = [float(q.mean()) for q in (b[:half,:half],b[:half,half:],b[half:,:half],b[half:,half:])]
    lc = []
    for light in LIGHTS:
        l = np.array(light); l /= np.linalg.norm(l)
        lc.append(corr(b,np.sum(n*l,axis=-1)))
    expected = np.stack([-dx,dy,np.ones_like(dx)],axis=-1)
    expected /= np.linalg.norm(expected,axis=-1,keepdims=True)
    facts = dict(mean_linear=float(b.mean()), target_mean=info['mean_linear'],
                 neutral_channel_max=int(np.ptp(base.astype(np.int16),axis=2).max()),
                 quarter_means=quarters, quarter_spread_relative=(max(quarters)-min(quarters))/float(b.mean()),
                 base_light_correlations=lc, height_bits=Image.open(HERE/f'{name}_height.png').mode,
                 relief_used_mm=[float(h.min()*1000),float(h.max()*1000)],
                 normal_height_correlations=[corr(-n[:,:,0]/n[:,:,2],dx),corr(n[:,:,1]/n[:,:,2],dy)],
                 normal_length_mean=float(nl.mean()), normal_length_max_error=float(np.abs(nl-1).max()),
                 normal_max_component_error=float(np.abs(expected-n).max()),
                 roughness_range=[float(packed[:,:,1].min()/255),float(packed[:,:,1].max()/255)],
                 roughness_mean=float(packed[:,:,1].mean()/255), ao_min=float(packed[:,:,0].min()/255),
                 seam_ratios={}, far_linear_std={})
    faults=[]
    for layer in ['base','height','normal','packed','regions']:
        a=load(name,layer)
        if a.shape[:2] != (2048,2048): faults.append(f'{layer}: wrong dimensions')
        facts['seam_ratios'][layer]=seam(a)
        if max(facts['seam_ratios'][layer]) > 1.3: faults.append(f'{layer}: wrap jump > 1.3')
    if abs(facts['mean_linear']-info['mean_linear'])>.002: faults.append('mean')
    if facts['neutral_channel_max']>2: faults.append('not neutral')
    if facts['quarter_spread_relative']>.02: faults.append('quadrant mean spread')
    if max(abs(x) for x in lc)>.1: faults.append('base correlated with light')
    if min(facts['normal_height_correlations'])<.9: faults.append('normal/height correlation')
    if facts['normal_length_max_error']>.007: faults.append('normal length')
    if facts['normal_max_component_error']>1/255+.00001: faults.append('physical normal scale')
    if not np.all(reg==[255,0,255]): faults.append('region map')
    if np.any(packed[:,:,2]): faults.append('metalness')
    if hraw.dtype != np.uint16: faults.append('height is not uint16')
    for size in [1024,102,38]:
        small=np.asarray(Image.fromarray(b).resize((size,size),Image.Resampling.BOX))
        facts['far_linear_std'][str(size)]=float(small.std())
    return facts, faults


def previews(name):
    base = load(name,'base')
    b = linear(base[:,:,0]/255)
    n = load(name,'normal').astype(np.float32)/127.5-1
    n /= np.linalg.norm(n,axis=-1,keepdims=True)
    p = load(name,'packed').astype(np.float32)/255
    native = Image.new('RGB',(1556,2222),(235,235,232))
    draw=ImageDraw.Draw(native)
    draw.text((15,8),f'{name}: 512 px crops at delivered density; three relighting directions',(35,35,35))
    densities=Image.new('RGB',(1590,2230),(235,235,232))
    dd=ImageDraw.Draw(densities)
    dd.text((15,8),f'{name}: full 1 m / half-offset / 102 px & 38 px distance samples',(35,35,35))
    crop=(250,200,762,712) if name!='membrane_under' else (1286,200,1798,712)
    for r,(dye,hexx) in enumerate(DYES.items()):
        draw.text((15,35+r*546),dye,(35,35,35))
        dd.text((15,35+r*546),dye,(35,35,35))
        color=linear(np.array([int(hexx[i:i+2],16) for i in (0,2,4)],dtype=np.float32)/255)
        encoded(b[...,None]*color/.5).save(OUT/f'{name}_{dye}_unlit_full.png')
        for c,light in enumerate(LIGHTS):
            im=relight(b,n,p[:,:,0],p[:,:,1],hexx,light)
            im.save(OUT/f'{name}_{dye}_light{c+1}_full.png')
            native.paste(im.crop(crop),(12+c*516,55+r*546))
            if c==0:
                densities.paste(im.resize((512,512),Image.Resampling.LANCZOS),(15,55+r*546))
                offset=np.roll(np.asarray(im),[1024,1024],[0,1])
                densities.paste(Image.fromarray(offset).resize((512,512),Image.Resampling.LANCZOS),(545,55+r*546))
                for size,yoff in [(102,70),(38,240)]:
                    small=im.resize((size,size),Image.Resampling.BOX)
                    densities.paste(small,(1100,55+r*546+yoff))
                    dd.text((1100,55+r*546+yoff-18),f'{size} px per metre',(35,35,35))
    native.save(OUT/f'{name}_native_relit.png')
    densities.save(OUT/f'{name}_densities.png')
    tile=Image.fromarray(base).resize((400,400),Image.Resampling.LANCZOS)
    repeat=Image.new('RGB',(1200,1200))
    for y in range(3):
        for x in range(3): repeat.paste(tile,(x*400,y*400))
    repeat.save(OUT/f'{name}_3x3.png')
    # Source and final at one scale, with an unlit base as the essential middle panel.
    original=Image.open(HERE/'source/membrane_refined_original.png').convert('RGB').resize((2048,2048),Image.Resampling.LANCZOS)
    if name=='membrane_under': original=original.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    source=Image.new('RGB',(1556,560),(235,235,232))
    sd=ImageDraw.Draw(source)
    neutral=relight(b,n,p[:,:,0],p[:,:,1],'BCBCBC',LIGHTS[0])
    for i,(label,im) in enumerate([('Generated membrane (same centreline scale)',original),('Delivered unlit base',Image.fromarray(base)),('Delivered relief + neutral dye',neutral)]):
        sd.text((12+516*i,12),label,(35,35,35)); source.paste(im.crop(crop),(12+516*i,35))
    source.save(OUT/f'{name}_source_comparison.png')


def concept_preview():
    # Native 400 px/m concept orthographics, no reference download or repaint.
    color=linear(np.asarray([86,103,122],dtype=np.float32)/255)
    sheet=Image.new('RGB',(1660,1040),(235,235,232))
    d=ImageDraw.Draw(sheet)
    d.text((15,12),'Concepts at their native 400 px/m scale; study squares at the same 400 px/m',(35,35,35))
    ref=HERE.parents[2]/'ref/concept'
    for row,name in enumerate(['top','underside']):
        im=Image.open(ref/f'{name}.png').convert('RGB')
        sheet.paste(im.crop((1750,760,2950,1220)),(15,45+row*490))
        study=Image.open(HERE/f'membrane_{"upper" if row==0 else "under"}_base.png')
        sb=linear(np.asarray(study)[:,:,0]/255)
        sq=encoded(sb[...,None]*color/.5).resize((400,400),Image.Resampling.LANCZOS)
        sheet.paste(sq,(1240,65+row*490))
        d.text((15,32+row*490),name,(35,35,35))
    sheet.save(OUT/'concept_scale.png')


def drawing_metrics():
    """Check vascular geometry and delivered linear pigment contrast."""
    paths=json.loads((HERE/'source/paths.json').read_text())['paths']
    segments=[];buckets={};crossings=[]
    def cross(a,b): return a[0]*b[1]-a[1]*b[0]
    for pi,p in enumerate(paths):
        points=np.asarray(p['points'])
        for j in range(len(points)-1):
            a,b=points[j:j+2]
            idx=len(segments);segments.append((a,b,pi,j))
            lo=np.floor(np.minimum(a,b)*100).astype(int);hi=np.floor(np.maximum(a,b)*100).astype(int)
            candidates=set()
            cells=[(x,y) for x in range(lo[0],hi[0]+1) for y in range(lo[1],hi[1]+1)]
            for cell in cells: candidates.update(buckets.get(cell,[]))
            for k in candidates:
                c,d,qi,qj=segments[k]
                if pi==qi and abs(j-qj)<=1: continue
                # Strict interior intersections; connected Y endpoints are legal.
                e,f=b-a,d-c
                if cross(e,c-a)*cross(e,d-a)<-1e-18 and cross(f,a-c)*cross(f,b-c)<-1e-18:
                    crossings.append([pi,j,qi,qj])
            for cell in cells: buckets.setdefault(cell,[]).append(idx)
    vein=np.asarray(Image.open(HERE/'source/veins_upper.png'),np.float32)/65535
    widths=np.concatenate([p['widths_mm'] for p in paths])
    facts=dict(path_segments=len(paths),centreline_crossings=crossings,
        width_mm_percentiles=np.percentile(widths,[0,10,50,90,99,100]).tolist(),
        traced_roots=sum(p['root'] for p in paths),contrast={})
    # Neighbouring skin estimated outside the vessel support, in a 1 cm window.
    core=vein>.82;skin=vein<.05
    for name in ['membrane_upper','membrane_under']:
        b=linear(load(name,'base')[:,:,0]/255)
        if name.endswith('under'): b=b[:,::-1]
        surround=gaussian_filter(b*skin,18,mode='wrap')/np.maximum(gaussian_filter(skin.astype(np.float32),18,mode='wrap'),.001)
        contrast=(1-b/surround)[core]
        facts['contrast'][name]=dict(core_darkening_p10_p50_p90=np.percentile(contrast,[10,50,90]).tolist(),
                                    srgb_range=[int(load(name,'base').min()),int(load(name,'base').max())])
    return facts


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--metrics-only',action='store_true')
    args=parser.parse_args()
    OUT.mkdir(exist_ok=True)
    info=json.loads((HERE/'study.json').read_text())
    result={'sets':{},'faults':[],'drawing':drawing_metrics()}
    if result['drawing']['centreline_crossings']: result['faults'].append('vessel centrelines cross')
    for name,spec in info['sets'].items():
        facts,faults=measure(name,spec)
        result['sets'][name]=facts
        result['faults'] += [f'{name}: {f}' for f in faults]
        if not args.metrics_only: previews(name)
        print(name,json.dumps(dict(mean=facts['mean_linear'],normal=facts['normal_height_correlations'],
                                   seam=facts['seam_ratios'],faults=faults)),flush=True)
    upper=np.asarray(Image.open(HERE/'source/veins_upper.png'))
    under=np.asarray(Image.open(HERE/'source/veins_under.png'))
    result['mirrored_veins_exact']=bool(np.array_equal(upper[:,::-1],under))
    result['mirrored_height_exact']=bool(np.array_equal(load('membrane_upper','height')[:,::-1],load('membrane_under','height')))
    result['face_pair_mean']=(result['sets']['membrane_upper']['mean_linear']+result['sets']['membrane_under']['mean_linear'])/2
    if not result['mirrored_veins_exact'] or not result['mirrored_height_exact']:
        result['faults'].append('faces do not match under mirror')
    # Local maximal empty circles, measured on a periodic 512-square support map.
    support=np.asarray(Image.fromarray(upper).resize((512,512),Image.Resampling.BOX)) > 65535*.08
    dist=distance_transform_edt(np.tile(~support,(3,3)))[512:1024,512:1024]/512
    maxima=(dist==maximum_filter(dist,25,mode='wrap')) & (dist>.008)
    result['open_cell_diameter_mm_p10_p50_p90_max']=(np.percentile(dist[maxima]*2000,[10,50,90,100])).tolist()
    if not args.metrics_only: concept_preview()
    (OUT/'metrics.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k!='sets'},indent=2))
    if result['faults']: raise SystemExit(1)


if __name__=='__main__':
    main()
