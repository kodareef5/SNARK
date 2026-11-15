"""Validate delivered PNGs independently and regenerate disposable review boards.

python3 check.py
Reads no unpublished working arrays. All measurements use exported textures.
Review images are intentionally lit/dyed; none is a production base map.
"""
from pathlib import Path
import json
import hashlib
import math
import struct
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import gaussian_filter, gaussian_filter1d
from scipy.signal import find_peaks

ROOT=Path(__file__).resolve().parent
QA=ROOT/'checks'
SIZE=2048
PALETTE={(0,0,0),(255,0,0),(0,255,0),(0,0,255),(0,255,255),(255,0,255),(255,255,0)}
RING=[(255,0,0),(255,255,0),(0,255,0),(0,255,255),(0,0,255),(255,0,255)]


def linear(a):
    return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)


def srgb(a):
    a=np.clip(a,0,1)
    return np.where(a<=.0031308,12.92*a,1.055*a**(1/2.4)-.055)


def corr(a,b):
    a=a.ravel().astype(np.float64); b=b.ravel().astype(np.float64)
    a-=a.mean(); b-=b.mean()
    return float(np.sum(a*b)/max(np.sqrt(np.sum(a*a)*np.sum(b*b)),1e-20))


def seam(a):
    a=a.astype(np.float32)
    rx=float(np.abs(a[:,0]-a[:,-1]).mean())/max(float(np.abs(np.diff(a,axis=1)).mean()),1e-12)
    ry=float(np.abs(a[0]-a[-1]).mean())/max(float(np.abs(np.diff(a,axis=0)).mean()),1e-12)
    return dict(x=rx,y=ry)


def font(size):
    for p in ['/System/Library/Fonts/Supplemental/Arial.ttf','/System/Library/Fonts/Helvetica.ttc']:
        if Path(p).exists():
            return ImageFont.truetype(p,size)
    return ImageFont.load_default(size=size)


def grid(items, cols, cell=360, title=''):
    top=66 if title else 0
    out=Image.new('RGB',(cols*cell,math.ceil(len(items)/cols)*(cell+43)+top),(25,28,31))
    d=ImageDraw.Draw(out)
    if title: d.text((18,18),title,font=font(24),fill=(230,226,215))
    for i,(label,im) in enumerate(items):
        x=(i%cols)*cell; y=top+(i//cols)*(cell+43)
        if im.size!=(cell,cell): im=im.resize((cell,cell),Image.Resampling.LANCZOS)
        out.paste(im,(x,y+43))
        d.text((x+12,y+12),label,font=font(15),fill=(220,220,213))
    return out


def hexlin(s):
    return linear(np.array([int(s[i:i+2],16)/255 for i in (1,3,5)],np.float32))


def render(arrays,dye,light=(-.48,.58,.66),norm_override=None):
    n=arrays['normal'].astype(np.float32)/127.5-1 if norm_override is None else norm_override
    n/=np.linalg.norm(n,axis=-1,keepdims=True)
    light=np.array(light,np.float32);light/=np.linalg.norm(light)
    ndl=np.maximum(np.sum(n*light,axis=-1),0)
    rough=arrays['packed'][...,1].astype(np.float32)/255
    ao=arrays['packed'][...,0].astype(np.float32)/255
    base=linear(arrays['base'][...,:3].astype(np.float32)/255)
    albedo=base*hexlin(dye)/.5
    # Soft broad key, ambient fill, and restrained dielectric satin highlight.
    half=light+np.array([0,0,1]);half/=np.linalg.norm(half)
    ndh=np.maximum(np.sum(n*half,axis=-1),0)
    exponent=np.maximum(2/(rough**4)-2,2)
    spec=.018*(exponent+2)/24*ndh**exponent*ndl
    lit=albedo*(.32+.68*ndl[...,None])*(.75+.25*ao[...,None])+spec[...,None]*ao[...,None]
    return Image.fromarray(np.uint8(np.rint(srgb(lit)*255)))


def crop_arrays(arrays,box):
    x0,y0,x1,y1=box
    return {k:v[y0:y1,x0:x1].copy() for k,v in arrays.items()}


def curved_proxy(arrays,name):
    """Analytic curved material patch, not a final creature or UV preview."""
    w=520
    y,x=np.mgrid[:w,:w].astype(np.float32)
    u=(x-w/2)/(w*.40);v=(y-w/2)/(w*.43)
    if name=='pouch':
        u*=1.65
    if name=='brow':
        v*=2.5
    r2=u*u+v*v
    inside=r2<1
    z=np.sqrt(np.maximum(1-r2,1e-5))
    # Gradual elliptical cap leaves enough front surface to assess fine relief.
    geom=np.stack((u*.56,-v*.56,z),-1)
    geom/=np.linalg.norm(geom,axis=-1,keepdims=True)
    tangent=np.stack((geom[...,2],np.zeros_like(z),-geom[...,0]),-1)
    tangent/=np.linalg.norm(tangent,axis=-1,keepdims=True)
    bitangent=np.cross(geom,tangent)
    src=crop_arrays(arrays,(550,500,1070,1020))
    micro=src['normal'].astype(np.float32)/127.5-1
    n=tangent*micro[...,:1]+bitangent*micro[...,1:2]+geom*micro[...,2:]
    img=np.array(render(src,'#DDA089' if name in ('skin','folds') else '#C49C58',norm_override=n))
    img[~inside]=(43,46,48)
    return Image.fromarray(img)


def checks():
    start=time.time(); QA.mkdir(exist_ok=True)
    meta=json.loads((ROOT/'study.json').read_text())
    all_arrays={};report={'sets':{},'failures':[]}
    if 'accepted_asset_hashes' in meta:
        accepted=json.loads((ROOT/meta['accepted_asset_hashes']).read_text())
        for path,digest in accepted.items():
            assert hashlib.sha256((ROOT/path).read_bytes()).hexdigest()==digest, 'Accepted asset changed: '+path
        report['accepted_sets_preserved']=dict(png_count=len(accepted),sha256_exact=True,
            sets=['skin','brow','pouch','folds'])
    # One deterministic random sample in every 4x4 block. A fixed four-pixel
    # stride aliases against the 16-pixel pouch period and gives false bias.
    sample_rng=np.random.default_rng(78104)
    sy,sx=np.mgrid[:SIZE//4,:SIZE//4]
    sample_y=sy*4+sample_rng.integers(0,4,sy.shape)
    sample_x=sx*4+sample_rng.integers(0,4,sx.shape)
    report['light_correlation_sampling']='262144 stratified samples, one deterministic random pixel per 4x4 block; seed 78104'
    layers=[];offsets=[];closeups=[];lights=[];dyes=[]
    failure=report['failures']
    for name,spec in meta['sets'].items():
        print('Checking '+name+'...',flush=True)
        arr={};metrics={};map_info={}
        for key,filename in spec['maps'].items():
            p=ROOT/filename
            image=Image.open(p)
            a=np.asarray(image)
            arr[key]=a
            bits=p.read_bytes()[24]
            assert image.size==(SIZE,SIZE),(name,key,image.size)
            assert bits==(16 if key=='height' else 8),(filename,bits)
            assert image.info.get('gamma')==(.45455 if key=='base' else 1.0)
            assert image.mode==('RGBA' if key=='base' and name=='folds' else 'RGB' if key!='height' else 'I;16')
            map_info[key]=dict(size=list(image.size),bit_depth=bits,mode=image.mode,wrap=seam(a[...,:3] if key=='base' else a))
            if key=='height':
                # Display amplification only, explicitly labelled.
                lo,hi=np.percentile(a,[.2,99.8])
                preview=Image.fromarray(np.uint8(np.clip((a.astype(float)-lo)/max(hi-lo,1)*255,0,255))).convert('RGB')
            else: preview=image.convert('RGB')
            layers.append((f'{name} / {key}'+(' (view contrast)' if key=='height' else ''),preview))
            if spec['tiles']:
                offset=np.roll(np.asarray(preview),(SIZE//2,SIZE//2),(0,1))
                offsets.append((f'{name} / {key} / half offset',Image.fromarray(offset)))
                if max(map_info[key]['wrap'].values())>1.30:
                    failure.append(f'{name}_{key}: edge jump over 1.30 interior')
        all_arrays[name]=arr
        base=arr['base'][...,:3]
        assert np.max(base.max(axis=-1).astype(int)-base.min(axis=-1).astype(int))<=2
        lin=linear(base[...,0].astype(np.float64)/255)
        mean=float(lin.mean())
        quarters=[float(lin[y:y+SIZE//2,x:x+SIZE//2].mean()) for y in (0,SIZE//2) for x in (0,SIZE//2)]
        assert abs(mean-.5)<=.02
        assert (max(quarters)-min(quarters))/mean<.02
        metrics['base']=dict(mean_linear=mean,mean_srgb=float(base[...,0].mean()),quarter_means_linear=quarters,
                             quarters_range_fraction=(max(quarters)-min(quarters))/mean,neutral_max_channel_difference=0,
                             linear_percentiles_p01_p10_p90_p99=np.percentile(lin,[1,10,90,99]).tolist(),linear_std=float(lin.std()))
        # The satin brow deliberately has much fainter drawing than the face.
        assert lin.std()>({'brow':.002,'skin':.010,'folds':.010,'pouch':.015}[name]), (name,"missing intrinsic value drawing")
        h=(arr['height'].astype(np.float64)/65535-.5)*spec['height_mm']
        step=spec['span_m']*1000/SIZE
        dx=(np.roll(h,-1,1)-np.roll(h,1,1))/(2*step)
        dy=(np.roll(h,-1,0)-np.roll(h,1,0))/(2*step)
        expected=np.stack((-dx,dy,np.ones_like(h)),-1)
        expected/=np.linalg.norm(expected,axis=-1,keepdims=True)
        encoded=np.uint8(np.rint((expected*.5+.5)*255))
        n=arr['normal'].astype(np.float64)/127.5-1
        length=np.linalg.norm(n,axis=-1)
        xcorr=corr(-dx,n[...,0]/n[...,2]);ycorr=corr(dy,n[...,1]/n[...,2])
        byte_error=int(np.max(np.abs(encoded.astype(int)-arr['normal'].astype(int))))
        assert byte_error<=1
        assert xcorr>.90 and ycorr>.90
        assert np.max(np.abs(length-1))<.008
        metrics['normal']=dict(height_slope_correlation_x=xcorr,height_slope_correlation_y=ycorr,
                               expected_max_byte_difference=byte_error,unit_length_max_error=float(np.max(np.abs(length-1))),
                               rms_slope=float(np.sqrt(np.mean(dx*dx+dy*dy))))
        n/=length[...,None]
        lightcorr=[]
        for az in np.linspace(0,2*np.pi,16,endpoint=False):
            for elev in (20,45,70):
                el=math.radians(elev)
                light=np.array([math.cos(az)*math.cos(el),math.sin(az)*math.cos(el),math.sin(el)])
                lightcorr.append(abs(corr(lin[sample_y,sample_x],np.maximum(np.sum(n[sample_y,sample_x]*light,axis=-1),0))))
        metrics['base']['max_light_correlation_48_directions']=max(lightcorr)
        if max(lightcorr)>.03: failure.append(f'{name}: base/light correlation > .03')
        r=arr['regions'].astype(np.uint32)
        codes,counts=np.unique((r[...,0]<<16)+(r[...,1]<<8)+r[...,2],return_counts=True)
        colours=np.array([[(c>>16)&255,(c>>8)&255,c&255] for c in codes])
        assert all(tuple(c) in PALETTE for c in colours)
        assert len(colours)==1 # no region joins exist inside these standalone studies
        assert tuple(colours[0])==((0,255,0) if name in ('skin','folds') else (0,255,255))
        assert not arr['packed'][...,2].any()
        metrics['regions']={str(tuple(int(v) for v in c)):int(n) for c,n in zip(colours,counts)}
        metrics['packed']=dict(ao_min=float(arr['packed'][...,0].min()/255),ao_mean=float(arr['packed'][...,0].mean()/255),
                               roughness_mean=float(arr['packed'][...,1].mean()/255),metalness_max=0)
        metrics['height']=dict(actual_min_mm=float(h.min()),actual_max_mm=float(h.max()))
        metrics['files']=map_info
        report['sets'][name]=metrics
        default='#DDA089' if name in ('skin','folds') else '#C49C58'
        box=(208,168,720,680) if name=='folds' else (600,650,1112,1162)
        crop=crop_arrays(arr,box)
        closeups.append((f'{name} / 512 px at 1:1',render(crop,default)))
        for label,light in [('upper left',(-.6,.55,.58)),('upper right',(.6,.55,.58)),('low right',(.55,-.68,.48))]:
            lights.append((f'{name} / {label}',render(crop,default,light)))
        choices=[('default',default),('hot pink','#F22B92'),('lime','#A9D91C'),('near black','#161719'),('near white','#EEECE6'),
                 ('ivory' if name in ('skin','folds') else 'slate','#F3E5D0' if name in ('skin','folds') else '#65686F')]
        for label,dye in choices:
            dyes.append((f'{name} / {label}',render(crop,dye)))

    print('Checking folds, feature scale and presentation...',flush=True)
    # Round 4 freezes the accepted fold sheet, including its original substrate
    # and delta. Validate that relationship against the regenerated round 3 substrate.
    skin=({k:np.asarray(Image.open(ROOT/f)) for k,f in meta['folds_reference_skin'].items()}
          if 'folds_reference_skin' in meta else all_arrays['skin'])
    folds=all_arrays['folds']
    alpha=np.asarray(Image.open(ROOT/'folds_alpha.png'))
    assert np.array_equal(alpha,folds['base'][...,3])
    assert np.array_equal(skin['base'][alpha==0],folds['base'][...,:3][alpha==0])
    assert np.array_equal(skin['height'][alpha==0],folds['height'][alpha==0])
    elements=meta['sets']['folds']['elements']
    box_fail=[]
    for el in elements:
        x0,y0,x1,y1=el['box_px']
        border=np.zeros((SIZE,SIZE),bool)
        border[y0:y1,x0:x0+8]=True;border[y0:y1,x1-8:x1]=True
        border[y0:y0+8,x0:x1]=True;border[y1-8:y1,x0:x1]=True
        assert not alpha[border].any()
        for k in ('base','height','normal','packed','regions'):
            a=folds[k][...,:3] if k=='base' else folds[k]
            if not np.array_equal(a[border],skin[k][border]): box_fail.append(el['name']+':'+k)
        for key,filename in el.get('files',{}).items():
            atlas=alpha if key=='alpha' else np.asarray(Image.open(ROOT/'folds_delta_height.png')) if key=='delta_height' else folds[key]
            excerpt=np.asarray(Image.open(ROOT/filename))
            assert np.array_equal(excerpt,atlas[y0:y1,x0:x1]),filename
    assert not box_fail,box_fail
    report['folds_compositing']=dict(element_count=len(elements),alpha_matches_rgba=True,
        reference_skin=meta.get('folds_reference_skin','current skin'),
        height_exactly_plain_skin_where_alpha_zero=True,all_five_layers_equal_skin_on_every_box_border=True,
        opacity_weighted_linear_mean=float((linear(folds['base'][...,0]/255)*alpha).sum()/alpha.sum()),
        delta_zero_count=int(np.count_nonzero(np.asarray(Image.open(ROOT/'folds_delta_height.png'))==32768)))
    report['folds_compositing']['individual_exports_match_atlas']=all('files' in e for e in elements)
    delta=(np.asarray(Image.open(ROOT/'folds_delta_height.png')).astype(np.float64)-32768)*meta['sets']['folds']['height_mm']/65535
    actual=(folds['height'].astype(np.float64)-skin['height'].astype(np.float64))*meta['sets']['folds']['height_mm']/65535
    assert np.max(np.abs(delta-actual)) <= meta['sets']['folds']['height_mm']/65535+1e-9
    report['folds_compositing']['delta_max_error_mm']=float(np.max(np.abs(delta-actual)))

    ph=(all_arrays['pouch']['height'].astype(float)/65535-.5)*meta['sets']['pouch']['height_mm']
    pitches=[];groove_pitches=[]
    for x in (80,512,960,1350,1900):
        # Measure the pleat rather than individual micron-scale skin bumps on
        # its rounded crown. Average 1.125 mm along the ridge and lightly smooth
        # across it; parabolic interpolation avoids whole-texel pitch jumps.
        section=gaussian_filter1d(ph[:,x-4:x+5].mean(axis=1),.9,mode='wrap')
        for sign,destination in [(1,pitches),(-1,groove_pitches)]:
            v=section*sign
            peaks,_=find_peaks(v,distance=12,prominence=.15)
            positions=peaks+.5*(v[peaks-1]-v[peaks+1])/(v[peaks-1]-2*v[peaks]+v[peaks+1])
            destination.extend(np.diff(positions)*256/SIZE)
    report['pouch_pitch']=dict(median_mm=float(np.median(pitches)),p05_mm=float(np.percentile(pitches,5)),p95_mm=float(np.percentile(pitches,95)),
                                measured_peak_intervals=len(pitches),branch_count=len(meta['sets']['pouch']['branches']),
                                groove_p05_p50_p95_mm=np.percentile(groove_pitches,[5,50,95]).tolist(),
                                method='9-column mean, 0.9-pixel Gaussian along section, subpixel parabolic peak/trough positions')
    if meta['sets']['pouch']['wave_vector']==[0,128]:
        assert 1.875<=np.percentile(pitches,5) and np.percentile(pitches,95)<=2.125
    assert report['sets']['brow']['normal']['rms_slope'] < report['sets']['skin']['normal']['rms_slope']*.6

    grid(layers,5,300,'FACE / aligned production layers').save(QA/'layers_contact.png')
    grid(offsets,5,280,'HALF OFFSETS / original joins cross the centre').save(QA/'offsets_contact.png')
    grid(closeups,2,512,'SURFACE DETAIL / actual study pixels').save(QA/'detail_100percent.png')
    grid(lights,3,384,'RELIGHT / same normals under three light directions').save(QA/'relighting.png')
    grid(dyes,6,300,'DYE / linear tint divided by 0.50, then lighting').save(QA/'dyes.png')
    proxies=[(name+' / curved diagnostic patch',curved_proxy(a,name)) for name,a in all_arrays.items() if name!='folds']
    grid(proxies,3,520,'CURVED PATCHES / analytic proxies, not the final bird').save(QA/'curved_patches.png')
    sheet=render(folds,'#DDA089')
    sheet=sheet.resize((1024,1024),Image.Resampling.LANCZOS)
    d=ImageDraw.Draw(sheet)
    for e in elements:
        box=[v//2 for v in e['box_px']]
        d.rectangle(box,outline=(90,51,39),width=1)
        d.text((box[0]+8,box[1]+8),e['name'],font=font(17),fill=(80,43,35))
    sheet.save(QA/'folds_layout.png')

    # Render full tile, then filter in linear light to exact physical read sizes.
    scales=Image.new('RGB',(1400,1120),(28,31,33));d=ImageDraw.Draw(scales)
    d.text((22,18),'PHYSICAL READ SIZE / 0.65 m bird / native-size chips',font=font(24),fill=(235,230,217))
    for i,(name,a) in enumerate(all_arrays.items()):
        span=meta['sets'][name]['span_m']; y=75+i*250
        d.text((22,y),f'{name}: {span*1000:.0f} mm square',font=font(20),fill=(235,230,217))
        lit=render(a,'#DDA089' if name in ('skin','folds') else '#C49C58')
        # Bird UV density is half the study; display 180 px crop at native scale.
        bird=lit.resize((1024,1024),Image.Resampling.LANCZOS)
        crop=bird.crop((160,145,340,325))
        scales.paste(crop,(320,y+28))
        d.text((320,y),'bird UV: 180 px native crop',font=font(15),fill=(202,205,199))
        for bx,height in ((600,200),(870,50)):
            px=max(1,round(span/.65*height))
            rgb=linear(np.asarray(lit).astype(np.float32)/255)
            reduced=np.stack([np.asarray(Image.fromarray(rgb[...,c]).resize((px,px),Image.Resampling.BOX)) for c in range(3)],-1)
            im=Image.fromarray(np.uint8(np.rint(srgb(reduced)*255)))
            scales.paste(im,(bx,y+40))
            d.text((bx,y),f'{height} px bird: tile {px} px',font=font(15),fill=(202,205,199))
        neutral=Image.new('RGB',(90,90),(188,188,188));scales.paste(neutral,(1190,y+40))
        d.text((1130,y),'target mean: sRGB 188',font=font(15),fill=(202,205,199))
    scales.save(QA/'read_sizes.png')

    # Full-resolution border-crossing crops, and an actual 2x2 repeat.
    joins=[];repeats=[]
    for name in ('skin','brow','pouch'):
        lit=render(all_arrays[name],'#DDA089' if name=='skin' else '#C49C58')
        a=np.asarray(lit)
        shifted=np.roll(a,(1024,1024),(0,1))
        joins.append((name+' / wrap intersection at 1:1',Image.fromarray(shifted[768:1280,768:1280])))
        repeats.append((name+' / 2x2 repeat',Image.fromarray(np.tile(a,(2,2,1)))))
    grid(joins,3,512,'BOUNDARIES / full-resolution wrap intersections').save(QA/'seams_100percent.png')
    grid(repeats,3,512,'TILING / four repeated copies per panel').save(QA/'tiling_2x2.png')
    # Under-eye centre section: measure the delivered relief, including its
    # soft crease interaction and fine skin; report rather than assume widths.
    from scipy.signal import peak_widths
    profile=delta[290:520,460:469].mean(axis=1)
    fold_peaks,peak_info=find_peaks(profile,distance=25,prominence=.20)
    report['under_eye_section']=dict(peak_y_px=(fold_peaks+290).tolist(),
        peak_spacing_mm=(np.diff(fold_peaks)*205/SIZE).tolist(),
        half_prominence_width_mm=(peak_widths(profile,fold_peaks)[0]*205/SIZE).tolist(),
        peak_elevation_mm=profile[fold_peaks].tolist(),
        peak_prominence_mm=peak_info['prominences'].tolist())
    assert len(fold_peaks)==4, 'Four lower-eye rolls should survive in delivered height'
    assert np.all(peak_info['prominences']>2.0), 'Each eye roll must stand distinctly proud of its crease'
    assert profile[fold_peaks[0]]>max(profile[fold_peaks[1:]]), 'The top eye roll must be the heaviest'
    from compare import comparisons
    comparisons(all_arrays)
    report['elapsed_seconds']=round(time.time()-start,2)
    report['passed']=not failure
    (QA/'metrics.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(dict(passed=report['passed'],failures=failure,pouch_pitch=report['pouch_pitch'],
        sets={k:dict(mean=v['base']['mean_linear'],normal_corr=[v['normal']['height_slope_correlation_x'],v['normal']['height_slope_correlation_y']],
                     light_corr=v['base']['max_light_correlation_48_directions'],seams={j:d['wrap'] for j,d in v['files'].items()}) for k,v in report['sets'].items()},
        seconds=report['elapsed_seconds']),indent=2))
    if failure: raise SystemExit(1)


if __name__=='__main__': checks()
