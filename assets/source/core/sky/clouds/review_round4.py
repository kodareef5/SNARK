#!/usr/bin/env python3
"""Compare rounds three and four with the user's unchanged 32 km renderer.

Spatial measures, all nine views, and isolated horizon panoramas compare the
changed cloud organization under identical lighting. No constants are changed.
"""
import os
os.environ.setdefault('OPENBLAS_NUM_THREADS','1')
os.environ.setdefault('OMP_NUM_THREADS','1')
import site
site.addsitedir(site.getusersitepackages())
from pathlib import Path
import sys, json, hashlib
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
    for key,root in [('round3',HERE/'rounds/05'),('round4',HERE)]:
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
        sun=light.HOURS[hour]['sun'];yaw=float(np.degrees(np.arctan2(sun[0],sun[2])))
        for column,key in enumerate(['round3','round4']):
            for row,(az,pitch) in enumerate([(yaw,14),(yaw+180,14),(yaw,90)]):
                crop=Image.fromarray(light.render(light.view_rays(960,540,az,pitch),light.HOURS[hour],versions[key]))
                ImageDraw.Draw(crop).text((10,28),f'{key}, same 32 km light.py',fill='white',stroke_width=1,stroke_fill='black')
                sheet.paste(crop,(column*960,row*540))
        sheet.save(qa/f'{hour}_round_comparison.jpg',quality=94)
        rows=[]
        for key,stack in [('round 3 / both',versions['round3']),('round 4 / both',versions['round4']),
                          ('round 4 / low only',{'low':versions['round4']['low']}),
                          ('round 4 / high only',{'high':versions['round4']['high']})]:
            im=light.label(light.render(rays,light.HOURS[hour],stack),f'{hour}: {key}; 360 degrees across; elevation 25 at top, 5 at bottom')
            rows.append(im)
        Image.fromarray(np.concatenate(rows,axis=0)).save(qa/f'{hour}_horizon_360.jpg',quality=95)
        print(f'Reviewed comparisons and horizon: {hour}',flush=True)
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
            scale=1 if name=='low' else .25
            stack[name]=light.pyramid(np.roll(c,(int(y*scale),int(x*scale)),(0,1)),
                                      np.roll(g,(int(y*scale),int(x*scale)),(0,1)))
        a=light.label(light.render(d,light.HOURS['noon'],stack),f'noon, yaw 90; low offset {x}, {y} px')
        phases.paste(Image.fromarray(a),((i%2)*800,(i//2)*450))
        a=light.label(light.render(up,light.HOURS['noon'],stack),f'noon, straight up; low offset {x}, {y} px')
        overhead.paste(Image.fromarray(a),((i%2)*800,(i//2)*450))
    phases.save(qa/'wind_offsets_noon.jpg',quality=94)
    overhead.save(qa/'wind_offsets_overhead.jpg',quality=94)
    # Test matching physical positions after removing each build's origin
    # translation. A new seam phase must not masquerade as extra coverage.
    phase_results={}
    up=light.view_rays(240,135,0,90)
    metadata={key:json.loads((root/'build_metadata.json').read_text())
              for key,root in [('round3',HERE/'rounds/05'),('round4',HERE)]}
    unrolled={}
    for key,root in [('round3',HERE/'rounds/05'),('round4',HERE)]:
        a=np.asarray(Image.open(root/'high.png'))
        sx,sy=metadata[key]['high']['periodic_roll_xy']
        a=np.roll(a,(-sy,-sx),(0,1));unrolled[key]=a
        base=light.pyramid(a[:,:,0].astype(np.float32)/255,a[:,:,1].astype(np.float32)/255)
        samples=[]
        for y in range(0,2048,256):
            for x in range(0,2048,256):
                # Offsets are multiples of 256, so rolling levels 0 through
                # 8 is exactly equivalent to rebuilding them. Recompute the
                # remaining tiny levels from the shifted level 8.
                stack=[np.roll(level,(y//(2**i),x//(2**i)),(0,1))
                       for i,level in enumerate(base[:9])]
                stack+=light.pyramid(stack[-1][:,:,0],stack[-1][:,:,1])[1:]
                _,alpha=light.layer_colour(up,light.HOURS['sunset'],stack,light.LAYERS['high'],1)
                samples.append({'offset_xy':[x,y],'mean_cover':float(alpha.mean()),
                    'visible_area_above_002':float(np.mean(alpha>.02))})
        phase_results[key]=samples
        print(f'Checked 64 matching high positions: {key}',flush=True)
    (qa/'high_phase_comparison.json').write_text(json.dumps(phase_results,indent=2)+'\n')
    # The source identity and core pixel count of every accepted low heap stay
    # fixed. Existing high nonzero pixels stay exact after origin alignment.
    def identities(meta):
        return sorted((p['source_field'],p['component'],p['core_pixels'])
                      for p in meta['low']['retained_heaps'])
    assert identities(metadata['round3'])==identities(metadata['round4'])
    old=unrolled['round3'];new=unrolled['round4'];mask=old[:,:,0]>0
    preserved=np.array_equal(old[mask],new[mask])
    assert preserved, 'Existing high cloud data changed'
    session=json.loads((HERE/'work/round4_session.json').read_text())
    archived={name:hashlib.sha256((HERE/'rounds/05'/name).read_bytes()).hexdigest()
              for name in ['low.png','high.png']}
    assert archived==session['previous_pair_sha256']
    (qa/'preservation_check.json').write_text(json.dumps({
        'all_57_low_heap_identities_and_core_sizes_retained':True,
        'all_existing_high_nonzero_pixels_identical_after_unrolling':preserved,
        'round3_archive_hashes_match':archived},indent=2)+'\n')
    (qa/'round4_comparison.json').write_text(json.dumps(metrics,indent=2)+'\n')
    print(json.dumps(metrics,indent=2),flush=True)


if __name__=='__main__':main()
