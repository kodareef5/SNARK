#!/usr/bin/env python3
"""Compare rounds two and three with the user's unchanged round-two renderer.

Spatial measures, all nine views, and isolated horizon panoramas compare the
changed cloud organization under identical lighting. No constants are changed.
"""
import os
os.environ.setdefault('OPENBLAS_NUM_THREADS','1')
os.environ.setdefault('OMP_NUM_THREADS','1')
import site
site.addsitedir(site.getusersitepackages())
from pathlib import Path
import sys, json
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import numpy as np
from scipy import ndimage, fft
from PIL import Image, ImageDraw
import light
from build_clouds import torus_labels


def panorama(w=1920,h=240):
    az=np.deg2rad(np.linspace(-180,180,w,endpoint=False))[None,:]
    el=np.deg2rad(np.linspace(25,5,h))[:,None]
    return np.stack([np.cos(el)*np.sin(az),np.broadcast_to(np.sin(el),(h,w)),
                     np.cos(el)*np.cos(az)],-1).astype(np.float32)


def spatial(cover):
    result={'quarter_mean_cover':[[float(cover[y:y+1024,x:x+1024].mean())
             for x in [0,1024]] for y in [0,1024]]}
    for threshold in [.1,.5]:
        lab=torus_labels(cover>threshold)
        sizes=np.bincount(lab.ravel())[1:]
        sizes=sizes[sizes>0]
        if threshold==.5:
            diam=2*np.sqrt(sizes/np.pi)
            result['diameter_bins_px_at_cover_05']={f'{lo}-{hi}':int(np.sum((diam>=lo)&(diam<hi)))
                for lo,hi in [(0,38),(38,80),(80,102),(102,205),(205,250),(250,400),(400,2048)]}
        result[str(threshold)]={
            'components':int(len(sizes)),
            'components_under_80px_equivalent_diameter':int(np.sum(sizes<np.pi*40**2)),
            'area_fraction_in_those_small_components':float(sizes[sizes<np.pi*40**2].sum()/cover.size),
            'components_ge_80px_equivalent_diameter':int(np.sum(sizes>=np.pi*40**2))}
    # Blur out lobes and scraps to test the spacing of whole complexes.
    coarse=cover.reshape(512,4,512,4).mean(axis=(1,3))
    for sigma in [32,64,128]:
        a=ndimage.gaussian_filter(coarse,sigma/4,mode='wrap')
        a=a-a.mean();f=fft.rfft2(a,workers=1)
        ac=fft.irfft2(f*f.conj(),s=a.shape,workers=1);ac/=ac[0,0]
        result[f'group_autocorrelation_sigma_{sigma}_half_tile_xy']=[float(ac[0,256]),float(ac[256,0])]
    return result


def main():
    qa=HERE/'qa';qa.mkdir(exist_ok=True)
    versions={};metrics={}
    rays=panorama()
    for key,root in [('round2',HERE/'rounds/04'),('round3',HERE)]:
        versions[key]={}
        for layer in ['low','high']:
            c,g=light.load_layer(root/f'{layer}.png')
            versions[key][layer]=light.pyramid(c,g)
            if layer=='low':metrics[key]={'low_spatial':spatial(c)}
            metrics[key][layer+'_cover']={'mean':float(c.mean()),
                'fraction_exact_zero':float(np.mean(c==0)),
                'fraction_over_002':float(np.mean(c>.02)),
                'fraction_over_05':float(np.mean(c>.5))}
        # Same mip footprints as the panorama, no new horizon lighting model.
        _,alpha=light.layer_colour(rays,light.HOURS['noon'],versions[key]['low'],light.LAYERS['low'],1)
        rings={}
        for elevation in [5,10,15,20]:
            row=int(round((25-elevation)/20*(rays.shape[0]-1)))
            mask=alpha[row]>.35
            rings[str(elevation)]={'fraction_low_cover_over_035':float(mask.mean()),
                'cloud_intervals_on_360_degree_ring':int(np.sum(mask & ~np.roll(mask,1)))}
        metrics[key]['low_horizon_rings']=rings
    for hour in ['noon','sunset','moon']:
        # Standard supplied horizon views at both 0 and 180 degrees.
        sheet=Image.new('RGB',(1920,1620),(15,15,15))
        for column,(key,root) in enumerate([('round2',HERE/'rounds/04/lit'),('round3',HERE/'lit')]):
            source=Image.open(root/f'{hour}.jpg');size=source.height//3
            for row in range(3):
                crop=source.crop((size,row*size,source.width,(row+1)*size)).resize((960,540),Image.Resampling.LANCZOS)
                ImageDraw.Draw(crop).text((10,28),f'{key}, same updated light.py',fill='white',stroke_width=1,stroke_fill='black')
                sheet.paste(crop,(column*960,row*540))
        sheet.save(qa/f'{hour}_round_comparison.jpg',quality=94)
        rows=[]
        for key,stack in [('round 2 / both',versions['round2']),('round 3 / both',versions['round3']),
                          ('round 3 / low only',{'low':versions['round3']['low']}),
                          ('round 3 / high only',{'high':versions['round3']['high']})]:
            im=light.label(light.render(rays,light.HOURS[hour],stack),f'{hour}: {key}; 360 degrees across; elevation 25 at top, 5 at bottom')
            rows.append(im)
        Image.fromarray(np.concatenate(rows,axis=0)).save(qa/f'{hour}_horizon_360.jpg',quality=95)
    # Several static wind offsets, using the same renderer and physical mips.
    # These are snapshots, not an animation or a separate output framework.
    phases=Image.new('RGB',(1600,900));overhead=Image.new('RGB',(1600,900))
    d=light.view_rays(800,450,90,14)
    up=light.view_rays(800,450,90,90)
    for i,(x,y) in enumerate([(0,0),(437,701),(1024,1024),(1661,319)]):
        stack={}
        for name in ['low','high']:
            c,g=light.load_layer(HERE/f'{name}.png')
            # Same axis of translation for both layers, high moves less.
            scale=1 if name=='low' else .5
            stack[name]=light.pyramid(np.roll(c,(int(y*scale),int(x*scale)),(0,1)),
                                      np.roll(g,(int(y*scale),int(x*scale)),(0,1)))
        a=light.label(light.render(d,light.HOURS['noon'],stack),f'noon, yaw 90; low offset {x}, {y} px')
        phases.paste(Image.fromarray(a),((i%2)*800,(i//2)*450))
        a=light.label(light.render(up,light.HOURS['noon'],stack),f'noon, straight up; low offset {x}, {y} px')
        overhead.paste(Image.fromarray(a),((i%2)*800,(i//2)*450))
    phases.save(qa/'wind_offsets_noon.jpg',quality=94)
    overhead.save(qa/'wind_offsets_overhead.jpg',quality=94)
    (qa/'round3_comparison.json').write_text(json.dumps(metrics,indent=2)+'\n')
    print(json.dumps(metrics,indent=2),flush=True)


if __name__=='__main__':main()
