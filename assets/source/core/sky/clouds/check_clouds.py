#!/usr/bin/env python3
"""Read-only validation of delivered data; writes QA evidence under qa/.

Uses the supplied renderer without modifying its lighting. Moderate small
diagnostic renders are optional (--relight); ordinary checks are lightweight.
"""
import os
os.environ.setdefault('OPENBLAS_NUM_THREADS','1')
os.environ.setdefault('OMP_NUM_THREADS','1')
from pathlib import Path
import sys
import site
site.addsitedir(site.getusersitepackages())
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import argparse
import hashlib
import json
import struct
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage, fft
import light


def png_chunks(path):
    b=path.read_bytes(); pos=8; chunks=[]
    while pos<len(b):
        length=struct.unpack('>I',b[pos:pos+4])[0]
        chunks.append(b[pos+4:pos+8].decode())
        pos+=length+12
    return chunks


def summarize(a):
    return {'mean':float(a.mean()),'std':float(a.std()),
            'percentiles_0_10_25_50_75_90_95_99_100':np.percentile(a,[0,10,25,50,75,90,95,99,100]).tolist()}


def components(c,g):
    # Connected components merged through both wrapping edges.
    lab,n=ndimage.label(c>.5)
    parent=np.arange(n+1)
    def find(v):
        while parent[v]!=v:
            parent[v]=parent[parent[v]];v=parent[v]
        return v
    for left,right in [(lab[:,0],lab[:,-1]),(lab[0,:],lab[-1,:])]:
        for a,b in zip(left,right):
            if a and b: parent[find(a)]=find(b)
    lookup=np.array([find(i) for i in range(n+1)])
    lab=lookup[lab]
    count=np.bincount(lab.ravel());count[0]=0
    ids=np.flatnonzero(count>=64)
    sizes=2*np.sqrt(count[ids]/np.pi)
    main=sizes[sizes>=80]
    # Circular moment centroids avoid misleading seam-crossing displacements.
    theta=2*np.pi*(np.arange(c.shape[0])+.5)/c.shape[0]
    offsets=[]
    for axis in [1,0]:
        cs=np.cos(theta)[None,:] if axis==1 else np.cos(theta)[:,None]
        sn=np.sin(theta)[None,:] if axis==1 else np.sin(theta)[:,None]
        centres=[]
        for w in [c,g]:
            s=np.bincount(lab.ravel(),weights=(w*sn).ravel(),minlength=len(count))
            x=np.bincount(lab.ravel(),weights=(w*cs).ravel(),minlength=len(count))
            centres.append(np.arctan2(s[ids],x[ids]))
        delta=np.angle(np.exp(1j*(centres[1]-centres[0])))
        offsets.append(delta*c.shape[0]/(2*np.pi)/(sizes/2))
    return {'count_area_ge_64px':len(ids),
            'equivalent_diameter_px_p10_p50_p90_max':np.percentile(sizes,[10,50,90,100]).tolist() if len(ids) else [],
            'count_equivalent_diameter_ge_80px':len(main),
            'main_equivalent_diameter_px_p10_p50_p90_max':np.percentile(main,[10,50,90,100]).tolist() if len(main) else [],
            'mean_thickness_centroid_minus_cover_centroid_in_radii_xy':np.mean(offsets,axis=1).tolist() if len(ids) else []}


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--relight',action='store_true');args=ap.parse_args()
    qa=HERE/'qa';qa.mkdir(exist_ok=True)
    metrics={}; stacks={}; contact=Image.new('RGB',(1024,1060),(18,18,18))
    for row,name in enumerate(['low','high']):
        p=HERE/f'{name}.png'; im=Image.open(p);a=np.asarray(im)
        assert im.mode=='RGB' and im.size==(2048,2048) and a.dtype==np.uint8
        assert p.read_bytes()[24:26]==bytes([8,2]), 'PNG IHDR must be RGB8'
        assert np.all(a[:,:,2]==0)
        chunks=png_chunks(p)
        assert not any(t in chunks for t in ['sRGB','gAMA','iCCP'])
        c=a[:,:,0].astype(np.float32)/255;g=a[:,:,1].astype(np.float32)/255
        assert np.all(g[c==0]==0)
        stacks[name]=light.pyramid(c,g)
        seams={'cover':light.seam(c),'thickness':light.seam(g)}
        assert max(sum([list(s) for s in seams.values()],[]))<2
        mipstats=[]
        for level,pair in enumerate(stacks[name]):
            if pair.shape[0]<16: break
            mipstats.append({'level':level,'size':pair.shape[0],
                             'seams_cover':light.seam(pair[:,:,0]),'seams_thickness':light.seam(pair[:,:,1]),
                             'cover_mean':float(pair[:,:,0].mean())})
        assert max(v for m in mipstats for key in ['seams_cover','seams_thickness'] for v in m[key])<2
        # Whole-tile autocorrelation, no non-periodic zero padding.
        small=np.asarray(Image.fromarray(a[:,:,0]).resize((512,512),Image.Resampling.BOX),np.float32)
        small-=small.mean(); spectrum=fft.rfft2(small,workers=1)
        ac=fft.irfft2(spectrum*spectrum.conj(),s=small.shape,workers=1)
        ac/=ac[0,0]
        yy,xx=np.mgrid[:512,:512]; rad=np.hypot(np.minimum(xx,512-xx),np.minimum(yy,512-yy))
        distant=np.where(rad>=128,ac,-1)
        peak=np.unravel_index(np.argmax(distant),distant.shape)
        # Structure tensor's weak-gradient eigenvector is the streak axis.
        dx=(np.roll(c,-1,1)-np.roll(c,1,1))*.5
        dy=(np.roll(c,-1,0)-np.roll(c,1,0))*.5
        tensor=np.array([[np.mean(dx*dx),np.mean(dx*dy)],[np.mean(dx*dy),np.mean(dy*dy)]])
        ev,vec=np.linalg.eigh(tensor);direction=vec[:,0]
        angle=float(np.degrees(np.arctan2(-direction[1],direction[0]))%180)
        m={'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'png_chunks':chunks,'seams':seams,
           'cover':summarize(c),'thickness':summarize(g),
           'fraction_cover_zero':float((c==0).mean()),
           'fraction_cover_over_002':float((c>.02).mean()),
           'fraction_cover_over_01':float((c>.1).mean()),
           'fraction_cover_over_05':float((c>.5).mean()),
           'fraction_cover_over_09':float((c>.9).mean()),
           'thickness_on_cover_over_01':summarize(g[c>.1]),
           'cover_thickness_correlation':float(np.corrcoef(c.ravel()[::8],g.ravel()[::8])[0,1]),
           'gradient_axis_degrees_above_image_right':angle,
           'gradient_anisotropy_ratio':float(ev[1]/max(ev[0],1e-12)),
           'autocorrelation_half_tile_x_y':[float(ac[0,256]),float(ac[256,0])],
           'largest_autocorrelation_at_distance_ge_quarter_tile':float(ac[peak]),
           'peak_shift_pixels_xy':[int(peak[1])*4,int(peak[0])*4],
           'mips':mipstats}
        if name=='low':m['components']=components(c,g)
        # Fine source detail vs a mere enlargement of mip 1.
        coarse=im.resize((1024,1024),Image.Resampling.BOX).resize(im.size,Image.Resampling.BICUBIC)
        diff=np.asarray(im,dtype=np.float32)-np.asarray(coarse,dtype=np.float32)
        m['native_minus_bicubic_mip1_rms_bytes_rg']=np.sqrt(np.mean(diff[:,:,:2]**2,axis=(0,1))).tolist()
        metrics[name]=m
        for col,channel in enumerate([0,1]):
            gray=Image.fromarray(a[:,:,channel]).resize((512,512),Image.Resampling.BOX).convert('RGB')
            contact.paste(gray,(col*512,row*530+18))
            ImageDraw.Draw(contact).text((col*512+8,row*530+2),f'{name}: '+['cover R','thickness G'][channel],fill='white')
        # 1:1 data crops placed beside enlargement, for visible native detail.
        crop=(480,420,992,932) if name=='low' else (240,300,752,812)
        sheet=Image.new('RGB',(1024,540),(20,20,20))
        sheet.paste(im.crop(crop),(0,28));sheet.paste(coarse.crop(crop),(512,28))
        ImageDraw.Draw(sheet).text((10,8),'native 2K data | bicubic enlargement of mip 1',fill='white')
        sheet.save(qa/f'{name}_detail.png')
        shifted=np.roll(a,(1024,1024),(0,1))
        Image.fromarray(shifted).resize((1024,1024),Image.Resampling.BOX).save(qa/f'{name}_offset.png')
    contact.save(qa/'channels.jpg',quality=94)
    # Pin this round to the supplied renderer's immutable starting hash.
    original=json.loads((HERE/'work/round4_session.json').read_text())['light_sha256']
    actual=hashlib.sha256((HERE/'light.py').read_bytes()).hexdigest()
    assert original==actual
    metrics['renderer_sha256_unchanged']=actual
    (qa/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
    # Convenient crops of the unchanged supplied renderer's final output.
    if all((HERE/'lit'/f'{h}.jpg').exists() for h in ['noon','sunset','moon']):
        review=Image.new('RGB',(1920,1128),(16,16,16))
        draw=ImageDraw.Draw(review)
        for i,hour in enumerate(['noon','sunset','moon']):
            sheet=Image.open(HERE/'lit'/f'{hour}.jpg')
            size=sheet.height//3
            for j,(name,top) in enumerate([('toward',0),('away',size),('up',2*size)]):
                crop=sheet.crop((size,top,sheet.width,top+size))
                crop.save(qa/f'{hour}_{name}.jpg',quality=95)
                review.paste(crop.resize((640,360),Image.Resampling.LANCZOS),(640*j,376*i+16))
                draw.text((640*j+8,376*i+2),f'{hour} / {name}',fill='white')
        review.save(qa/'final_review.jpg',quality=94)
    print(json.dumps({n:{k:v for k,v in m.items() if k in ['seams','fraction_cover_zero','fraction_cover_over_05','gradient_axis_degrees_above_image_right','components']} for n,m in metrics.items() if isinstance(m,dict)},indent=2))
    if args.relight:
        # Same renderer, same channels, opposite physical sun azimuths.
        rays=light.view_rays(800,500,0,90)
        imgs=[]
        for az in [0,90,180,270]:
            hour=dict(light.HOURS['sunset']);hour['sun']=light.sun_dir(15,az)
            imgs.append(light.label(light.render(rays,hour,stacks),f'light.py, sun elevation 15, azimuth {az}'))
        Image.fromarray(np.concatenate([np.concatenate(imgs[:2],1),np.concatenate(imgs[2:],1)],0)).save(qa/'opposite_suns.jpg',quality=92)
        for n in ['low','high']:
            Image.fromarray(light.sheet('noon',light.HOURS['noon'],{n:stacks[n]},480)).save(qa/f'{n}_alone_noon.jpg',quality=92)


if __name__=='__main__':main()
