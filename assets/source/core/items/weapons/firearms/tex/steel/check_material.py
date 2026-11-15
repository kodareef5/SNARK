#!/usr/bin/env python3
"""Independent checks and plain-sky GGX previews of the saved delivery PNGs.

Run --verify-rebuild for an actual deterministic rebuild/hash comparison.
All output is local; the supplied reference checkouts are never accessed here.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
import struct
import subprocess
import sys
import time
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
OUT = ROOT/'checks'
MM = 200.0
HEIGHT = .5
NAMES = ('base','height','normal','orm')
BG = (24,27,32)
FG = (220,224,230)
MUTED = (159,170,185)
FONT_PATH = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'


def font(n=19):
    try:
        return ImageFont.truetype(FONT_PATH,n)
    except OSError:
        return ImageFont.load_default()


def label(im,xy,text,size=19,color=FG):
    ImageDraw.Draw(im).text(xy,text,font=font(size),fill=color)


def canvas(w,h,title,subtitle=''):
    im = Image.new('RGB',(w,h),BG)
    label(im,(24,15),title,27)
    if subtitle:
        label(im,(24,52),subtitle,16,MUTED)
    return im


def read(name,suffix=''):
    return np.array(Image.open(ROOT/f'steel_{name}{suffix}.png'))


def box2(a):
    h,w = a.shape[:2]
    tail = a.shape[2:]
    return a.astype(np.float64).reshape(h//2,2,w//2,2,*tail).mean(axis=(1,3))


def normal_reference(a):
    # Implemented here independently; no imports from build_material.
    h = a.astype(np.float64)/65535*HEIGHT
    pitch = MM/a.shape[0]
    left = np.concatenate((h[:,-1:],h[:,:-1]),axis=1)
    right = np.concatenate((h[:,1:],h[:,:1]),axis=1)
    above = np.concatenate((h[-1:],h[:-1]),axis=0)
    below = np.concatenate((h[1:],h[:1]),axis=0)
    n = np.stack(((left-right)/(2*pitch),(below-above)/(2*pitch),np.ones_like(h)),axis=-1)
    n /= np.sqrt(np.sum(n*n,axis=-1,keepdims=True))
    return np.floor((n+1)*127.5+.5).astype(np.uint8),n


def png_info(path):
    data=path.read_bytes()
    pos=8
    chunks=[]
    while pos<len(data):
        length=struct.unpack('>I',data[pos:pos+4])[0]
        tag=data[pos+4:pos+8].decode('ascii')
        chunks.append(tag)
        pos+=length+12
    return {'bit_depth':data[24],'color_type':data[25],
            'color_chunks':[v for v in chunks if v in ('sRGB','gAMA','iCCP')]}


def psnr(a,b,peak):
    mse=float(np.mean((a.astype(np.float64)-b.astype(np.float64))**2))
    return 999.0 if mse==0 else float(10*np.log10(peak**2/mse))


def uint8(a):
    return np.floor(np.clip(a,0,255)+.5).astype(np.uint8)


def to_srgb(a):
    a=np.maximum(0,a)
    return np.where(a<=.0031308,a*12.92,1.055*a**(1/2.4)-.055)


def to_linear(a):
    return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)


def unit(a):
    return a/np.maximum(np.linalg.norm(a,axis=-1,keepdims=True),1e-12)


def shade(base,n,orm,light):
    """Metallic GGX, one distant sun + uniform analytic sky. No env map.

    Uniform sky is a constant reflectance term, independent of image location.
    The sun alone supplies the moving specular response. No contrast boost.
    """
    albedo=to_linear(base/255)
    rough=np.clip(orm[...,1:2]/255,.08,1)
    metallic=orm[...,2:3]/255
    ao=orm[...,0:1]/255
    f0=.04*(1-metallic)+albedo*metallic
    L=unit(np.array(light,dtype=np.float64))
    V=np.array([0.,0.,1.])
    H=unit(L+V)
    nl=np.clip(np.sum(n*L,axis=-1,keepdims=True),0,1)
    nv=np.clip(n[...,2:3],.001,1)
    nh=np.clip(np.sum(n*H,axis=-1,keepdims=True),0,1)
    vh=max(.0,float(H[2]))
    a2=rough**4
    D=a2/(np.pi*(nh*nh*(a2-1)+1)**2+1e-9)
    def g1(dot):
        return 2*dot/(dot+np.sqrt(a2+(1-a2)*dot*dot)+1e-9)
    F=f0+(1-f0)*(1-vh)**5
    spec=D*g1(nv)*g1(nl)*F/(4*nv*np.maximum(nl,.0001))
    diffuse=(1-F)*(1-metallic)*albedo/np.pi
    sun=(spec+diffuse)*nl*3.4*np.array([1.0,.97,.91])
    sky=(f0*.60+(1-metallic)*albedo*.34)*np.array([.91,.96,1.0])*ao
    return uint8(to_srgb(sun+sky)*255)


def bilinear(a,x,y):
    n=a.shape[0]
    x=np.asarray(x);y=np.asarray(y)
    x0=np.floor(x).astype(int); y0=np.floor(y).astype(int)
    tx=(x-x0)[...,None];ty=(y-y0)[...,None]
    return ((1-ty)*((1-tx)*a[y0%n,x0%n]+tx*a[y0%n,(x0+1)%n])+
            ty*((1-tx)*a[(y0+1)%n,x0%n]+tx*a[(y0+1)%n,(x0+1)%n]))


def surface_preview(maps,region,light,w=1024,h=240,x_start=11,y_center=None):
    # True-length UVs, tangent along the horizontal cylinder axis.
    radius=9 if region=='face' else 5.3
    length=92 if region=='face' else 55
    center={'face':120.,'brass':12.5,'edge':37.5}[region] if y_center is None else y_center
    pxpm=min((w-24)/length,(h-24)/(2*radius))
    yy,xx=np.mgrid[:h,:w].astype(float)
    world_y=-(yy-(h-1)/2)/pxpm
    world_x=(xx-(w-1)/2)/pxpm
    active=(np.abs(world_y)<radius)&(np.abs(world_x)<length/2)
    theta=np.arcsin(np.clip(world_y/radius,-.99999,.99999))
    nsize=maps['base'].shape[0]
    u=(world_x+length/2+x_start)/MM*nsize-.5
    v=(center-theta*radius)/MM*nsize-.5
    # Sample a suitable prefiltered mip to avoid invented high-frequency moire.
    target_pitch=1/pxpm
    sample=maps
    while MM/sample['base'].shape[0]<target_pitch*.70 and sample['base'].shape[0]>256:
        sample={k:box2(a) for k,a in sample.items()}
    ratio=sample['base'].shape[0]/nsize
    u=(u+.5)*ratio-.5;v=(v+.5)*ratio-.5
    base=bilinear(sample['base'],u,v)
    orm=bilinear(sample['orm'],u,v)
    tn=unit(bilinear(sample['normal'],u,v)/127.5-1)
    # Tangent T=(1,0,0); B=(0,cos(theta),-sin(theta)); N=(0,sin,cos).
    n=np.stack((tn[...,0],tn[...,1]*np.cos(theta)+tn[...,2]*np.sin(theta),
                -tn[...,1]*np.sin(theta)+tn[...,2]*np.cos(theta)),axis=-1)
    rgb=shade(base,unit(n),orm,light)
    rgb[~active]=BG
    return Image.fromarray(rgb)


def numerical_checks():
    metrics={'checks':{},'files':{},'bands':{},'normals':{},'reduction':{},'seams':{},
             'seam_measurement': 'mean absolute last-to-first difference / mean absolute difference of all adjacent interior samples; all channels; encoded PNG values; ratio < 3'}
    def check(name,ok):
        metrics['checks'][name]=bool(ok)
    maps={n:read(n) for n in NAMES}
    small={n:read(n,'_1024') for n in NAMES}
    fields=np.load(ROOT/'source/construction_fields.npz')
    for suffix,ms,size in (('',maps,2048),('_1024',small,1024)):
        for name,a in ms.items():
            filename=f'steel_{name}{suffix}.png'
            info=png_info(ROOT/filename)
            metrics['files'][filename]={'shape':list(a.shape),**info}
            check(filename+'_dimensions',a.shape[:2]==(size,size))
            check(filename+'_bit_depth',info['bit_depth']==(16 if name=='height' else 8))
            check(filename+'_channels',info['color_type']==(0 if name=='height' else 2))
            check(filename+'_color_space',info['color_chunks']==(['sRGB'] if name=='base' else []))
            # The asset check uses ALL interior neighbours as its reference.
            # Cast before subtraction so unsigned PNG channels cannot wrap.
            a=a.astype(float)
            seam={}
            for axis in (0,1):
                wrap=float(np.abs(np.take(a,0,axis=axis)-np.take(a,-1,axis=axis)).mean())
                interior=float(np.abs(np.diff(a,axis=axis)).mean())
                ratio=wrap/interior if interior else (0.0 if wrap==0 else float('inf'))
                check(filename+'_seam_'+'yx'[axis],ratio<3)
                # Retain the old local comparison as supplementary evidence;
                # it cannot replace the whole-image acceptance measurement.
                indexes=np.r_[0:24,size-24:size]
                nearby=np.take(a,indexes,axis=axis)
                diffs=np.abs(np.diff(nearby,axis=axis))
                line_means=diffs.mean(axis=tuple(i for i in range(diffs.ndim) if i!=axis))
                ref=float(np.percentile(np.delete(line_means,23),95))
                local_ratio=wrap/max(ref,1e-9)
                seam['yx'[axis]]={'wrap_mean':wrap,'interior_mean':interior,'ratio':ratio,
                                 'nearby_p95':ref,'nearby_p95_ratio':local_ratio}
                check(filename+'_seam_local_'+'yx'[axis],local_ratio<1.5)
            metrics['seams'][filename]=seam
        expected,physical=normal_reference(ms['height'])
        delta=np.abs(expected.astype(int)-ms['normal'].astype(int))
        decoded=unit(ms['normal'].astype(float)/127.5-1)
        angle=np.degrees(np.arccos(np.clip(np.sum(decoded*physical,axis=-1),-1,1)))
        metrics['normals'][str(size)]={'mismatched_channels':int(np.count_nonzero(delta)),
                                     'max_byte_error':int(delta.max()),'mean_angle_deg':float(angle.mean()),
                                     'max_angle_deg':float(angle.max())}
        check('normal_'+str(size)+'_matches_saved_height',np.count_nonzero(delta)==0)
    for name in NAMES:
        peak=65535 if name=='height' else 255
        reference=box2(maps[name])
        score=psnr(reference,small[name],peak)
        rounded=np.floor(reference+.5).astype(small[name].dtype)
        # A second common reduction reference; height resized in floating point.
        if name=='height':
            lanc=np.array(Image.fromarray(maps[name].astype(np.float32)).resize((1024,1024),Image.Resampling.LANCZOS))
        else:
            lanc=np.array(Image.fromarray(maps[name]).resize((1024,1024),Image.Resampling.LANCZOS))
        lscore=psnr(lanc,small[name],peak)
        metrics['reduction'][name]={'area_psnr_db':score,'lanczos_psnr_db':lscore,'exact_rounded_area':bool(np.array_equal(rounded,small[name]))}
        check(name+'_reduction_area_above_30db',score>=30)
        check(name+'_reduction_lanczos_above_30db',lscore>=30)
        if name!='normal':check(name+'_exact_rounded_area',np.array_equal(rounded,small[name]))
    for name,target,rough_range in [('brass',[168,136,74],[.35,.5]),('edge',[150,150,150],[.25,.35]),('face',[64,64,68],[.4,.6])]:
        mask=fields[name]>.99999
        col=maps['base'][mask].mean(axis=0)
        rr=maps['orm'][mask,1]/255
        height=maps['height'][mask].astype(float)/65535*HEIGHT
        _,physical=normal_reference(maps['height'])
        tilts=np.degrees(np.arccos(np.clip(physical[...,2][mask],-1,1)))
        metrics['bands'][name]={'mean_srgb':col.tolist(),'std_srgb':maps['base'][mask].std(axis=0).tolist(),
                               'roughness_mean':float(rr.mean()),'roughness_p01_p99':np.percentile(rr,[1,99]).tolist(),
                               'height_p01_p99_mm':np.percentile(height,[1,99]).tolist(),
                               'normal_tilt_median_p95_deg':np.percentile(tilts,[50,95]).tolist()}
        check(name+'_palette',np.max(np.abs(col-target))<.1)
        check(name+'_roughness',np.percentile(rr,1)>=rough_range[0] and np.percentile(rr,99)<=rough_range[1])
    check('band_partition',np.max(np.abs(fields['brass']+fields['edge']+fields['face']-1))<1e-6)
    for name,row in [('brass',128),('edge',384),('face',1200)]:
        check(name+'_correct_middle_row',np.min(fields[name][row])>.9999)
    # The blended boundary midpoint straddles the specified pixel rows.
    metrics['band_boundaries']={}
    for name,row in [('brass',0),('edge',256),('face',512)]:
        arr=fields[name]
        middle=(arr[(row-1)%2048]+arr[row])/2
        local=arr[np.arange(row-30,row+31)%2048]
        widths=np.sum((local>0)&(local<1),axis=0)*MM/2048
        metrics['band_boundaries'][name]={'nominal_row':row,'mean_midpoint_weight':float(middle.mean()),
            'full_transition_mm_min_max':[float(widths.min()),float(widths.max())]}
        check(name+'_boundary_midpoint',np.max(np.abs(middle-.5))<.1)
        check(name+'_transition_3_to_4mm',widths.min()>3 and widths.max()<4)
    rust=fields['rust']; support=(fields['cavity']>0)|(fields['deep_scratch']>0)
    check('metalness_255_outside_rust',np.all(maps['orm'][rust==0,2]==255))
    check('rust_confined_to_deep_pits',np.all(fields['cavity'][rust>0]>.42))
    check('ao_white_outside_cavities',np.all(maps['orm'][~support,0]==255))
    check('ao_is_shallow',maps['orm'][...,0].min()>=195)
    reconstructed=np.floor(np.clip(fields['height_mm'].astype(float)/HEIGHT*65535,0,65535)+.5)
    # Float32 build arithmetic can differ at exact half-code thresholds.
    check('height_matches_retained_source',np.max(np.abs(reconstructed-maps['height']))<=1)
    metrics['height_mm']={'range_full_encoding':HEIGHT,'neutral':.275,
                          'actual_min':float(maps['height'].min()/65535*HEIGHT),
                          'actual_max':float(maps['height'].max()/65535*HEIGHT)}
    metrics['cavities']={'ao_min':int(maps['orm'][...,0].min()),'ao_mean':float(maps['orm'][...,0].mean()/255),
                          'rust_pixel_fraction':float(np.mean(rust>0)),
                          'nonmetal_pixel_fraction':float(np.mean(maps['orm'][...,2]<255)),
                          'rust_metalness_min':int(maps['orm'][...,2].min())}
    # Native detail and orientation, measured on only the dark steel interior.
    crop=maps['height'][560:2000].astype(float)*HEIGHT/65535
    dy=float(np.std(np.diff(crop,axis=0)));dx=float(np.std(np.diff(crop,axis=1)))
    metrics['native_detail']={'height_cross_grain_to_along_grain_derivative_ratio':dy/dx,
        'base_vs_repeated_1k_rms_bytes':float(np.sqrt(np.mean((maps['base'].astype(float)-np.repeat(np.repeat(box2(maps['base']),2,0),2,1))**2)))}
    check('file_marks_follow_x',dy/dx>2)
    # Quantify accidental broad tonal ramps inside the face, excluding transitions.
    face=maps['base'][550:2008].astype(float)
    ramps={}
    for axis in (0,1):
        profile=face.mean(axis=1-axis)
        t=np.linspace(-.5,.5,len(profile))
        slope=np.sum(t[:,None]*(profile-profile.mean(axis=0)),axis=0)/np.sum(t*t)
        ramps['yx'[axis]]=slope.tolist()
        check('face_broad_ramp_under_2bytes_'+'yx'[axis],np.max(np.abs(slope))<2)
    metrics['face_fitted_end_to_end_ramp_srgb']=ramps
    # Retained pre-fix deliveries make the requested scope independently
    # reviewable: only the wrap blend and its normal derivative may change.
    before=OUT/'wrap_fix/before'
    if before.is_dir():
        revision={'files':{},'source_fields_unchanged':{},'band_transition_steps':{}}
        original_seams=json.loads((before/'global_seams.json').read_text())
        for suffix,ms,size in (('',maps,2048),('_1024',small,1024)):
            for name,a in ms.items():
                filename=f'steel_{name}{suffix}.png'
                original=np.array(Image.open(before/filename))
                changed=a!=original
                changed_rows=np.flatnonzero(np.any(changed,axis=tuple(range(1,a.ndim))))
                groups=np.split(changed_rows,np.flatnonzero(np.diff(changed_rows)>1)+1)
                ranges=[[int(g[0]),int(g[-1])+1] for g in groups if len(g)]
                # 1.8 mm half-width + the existing <=0.18 mm irregularity;
                # central-difference normals require one extra row.
                border=math.ceil(1.98/(MM/size))+(name=='normal')
                unchanged=not np.any(changed[border:-border])
                check(filename+'_unchanged_outside_wrap',unchanged)
                revision['files'][filename]={'changed_row_ranges_end_exclusive':ranges,
                    'changed_channel_values':int(np.count_nonzero(changed)),
                    'interior_byte_exact':unchanged,'before_seams':original_seams[filename]}
                if name=='height':
                    check(filename+'_extrema_unchanged',a.min()==original.min() and a.max()==original.max())
                if name=='orm':
                    check(filename+'_ao_and_metalness_unchanged',np.array_equal(a[...,[0,2]],original[...,[0,2]]))
            # The repaired base wrap must also be no harder than the other
            # band transitions, independently of the whole-image ratio.
            steps=np.abs(np.diff(ms['base'].astype(float),axis=0)).mean(axis=(1,2))
            radius=math.ceil(2/(MM/size))
            peaks={str(row):float(steps[row-radius:row+radius].max()) for row in (size//8,size//4)}
            wrap=metrics['seams'][f'steel_base{suffix}.png']['y']['wrap_mean']
            revision['band_transition_steps'][str(size)]={'wrap_mean':wrap,'internal_peak_steps':peaks}
            check('base_'+str(size)+'_wrap_no_harder_than_internal_bands',wrap<=min(peaks.values()))
        old_hashes=json.loads((before/'field_hashes.json').read_text())
        for name,digest in old_hashes.items():
            if name in ('brass','face','strength','height_mm','roughness'):
                continue
            same=hashlib.sha256(fields[name].tobytes()).hexdigest()==digest
            revision['source_fields_unchanged'][name]=same
            check('wrap_fix_preserves_source_'+name,same)
        old_records=json.loads((before/'construction.json').read_text())
        records=json.loads((ROOT/'source/construction.json').read_text())
        revision['original_construction_parameters_unchanged']=all(records[k]==v for k,v in old_records.items())
        check('wrap_fix_preserves_feature_records_and_physical_parameters',revision['original_construction_parameters_unchanged'])
        metrics['wrap_revision']=revision
    metrics['passed']=sum(metrics['checks'].values());metrics['total']=len(metrics['checks'])
    metrics['failed']=[k for k,v in metrics['checks'].items() if not v]
    return maps,small,metrics


def render_checks(maps,small,metrics):
    lights=[(-.38,.62,.69),(.46,-.56,.69)]
    h=maps['height'].astype(float)/65535*HEIGHT
    display={'base':Image.fromarray(maps['base']),
             'height':Image.fromarray(uint8((h-.16)/.14*255)).convert('RGB'),
             'normal':Image.fromarray(maps['normal']),
             'orm':Image.fromarray(maps['orm'])}
    layers=canvas(1648,510,'STEEL / aligned delivery layers','200 mm tile; height display stretched to 0.16–0.30 mm for inspection only')
    for i,name in enumerate(NAMES):
        layers.paste(display[name].resize((390,390),Image.Resampling.LANCZOS),(24+i*406,104))
        label(layers,(24+i*406,78),name.upper(),17)
    layers.save(OUT/'layers.png')
    offset=canvas(1648,510,'HALF-TILE OFFSETS / periodic joins','Both axes wrapped by 1024 pixels. Horizontal colour transitions are the intended trim boundaries.')
    for i,name in enumerate(NAMES):
        a=np.array(display[name]);off=np.roll(a,(1024,1024),axis=(0,1))
        Image.fromarray(off).save(OUT/f'offset_{name}_native.png')
        offset.paste(Image.fromarray(off).resize((390,390),Image.Resampling.LANCZOS),(24+i*406,104))
        label(offset,(24+i*406,78),name.upper(),17)
    offset.save(OUT/'offset.png')
    tiled=canvas(1648,920,'3 × 3 / repeat inspection','Left: small-scale colour; right: normal. Native 6144 px images are retained separately.')
    for i,name in enumerate(('base','normal')):
        a=np.tile(maps[name],(3,3,1))
        im=Image.fromarray(a)
        im.save(OUT/f'tiled3x3_{name}_native.png')
        tiled.paste(im.resize((792,792),Image.Resampling.LANCZOS),(24+i*808,104))
    tiled.save(OUT/'tiled3x3.png')
    large=canvas(1648,1180,'REPEAT / native-size intersection','1400 × 1000 native texels around a four-tile corner. The brass-to-steel wrap passes through the middle.')
    native_repeat=Image.open(OUT/'tiled3x3_base_native.png')
    large.paste(native_repeat.crop((1348,1548,2748,2548)),(124,110))
    large.save(OUT/'tiled_native_intersection.png')
    # Lit flat sheets: every supplied layer participates, no added surface detail.
    lit=[]
    n=unit(maps['normal'].astype(float)/127.5-1)
    for i,L in enumerate(lights):
        rgb=shade(maps['base'],n,maps['orm'],L)
        im=Image.fromarray(rgb);im.save(OUT/f'lit_flat_{i+1}_native.png');lit.append(im)
    relit=canvas(1648,930,'RELIGHT / opposite sun directions','Linear-light metallic GGX + uniform plain sky; no environment image, no normal-strength multiplier.')
    for i,im in enumerate(lit):
        relit.paste(im.resize((792,792),Image.Resampling.LANCZOS),(24+i*808,110))
        label(relit,(24+i*808,80),f'SUN {i+1}: {lights[i]}',16)
    relit.save(OUT/'relit.png')
    neutral=canvas(1648,930,'RELIEF ONLY / neutral steel under reversed light','Uniform reflectance 150 / roughness 0.42 / metalness 1. Delivered normals at their exact physical scale.')
    for i,L in enumerate(lights):
        gray=np.full_like(maps['base'],150)
        pack=np.full_like(maps['orm'],255);pack[...,1]=107
        rgb=shade(gray,n,pack,L)
        im=Image.fromarray(rgb)
        im.save(OUT/f'neutral_relief_{i+1}_native.png')
        neutral.paste(im.resize((792,792),Image.Resampling.LANCZOS),(24+i*808,110))
    neutral.save(OUT/'neutral_relief.png')
    # Real-scale cylinder UVs, each safely inside its region.
    cyl=canvas(1648,1000,'HANDLED METAL / two-light cylinder study','Length runs along x. Face: 92 × 18 mm; brass and rubbed edge: 55 × 10.6 mm.')
    for j,region in enumerate(('face','edge','brass')):
        label(cyl,(24,88+j*296),{'face':'BROWNED / BLUED STEEL','edge':'RUBBED BARE STEEL','brass':'AGED BRASS'}[region],18)
        for i,L in enumerate(lights):
            im=surface_preview(maps,region,L,792,250)
            cyl.paste(im,(24+i*808,118+j*296))
    cyl.save(OUT/'cylinders.png')
    # Native pixels, same crop in every layer and each light.
    detail=canvas(1648,930,'NATIVE DETAIL / identical 512 px crops','50 × 34.2 mm of steel at one source texel per screen pixel; file marks stay horizontal.')
    origin=(700,1000)
    panels=[display[n] for n in NAMES]+lit
    names=['BASE','HEIGHT (DISPLAY STRETCH)','OPENGL NORMAL','ORM','LIGHT 1','LIGHT 2']
    for i,(im,name) in enumerate(zip(panels,names)):
        xx=24+(i%3)*540;yy=110+(i//3)*400
        # Wide 512x350 native slice, no resampling.
        detail.paste(im.crop((origin[0],origin[1],origin[0]+512,origin[1]+350)),(xx,yy))
        label(detail,(xx,yy-27),name,16)
    detail.save(OUT/'native_detail.png')
    # Wrap strips at exactly native scale, both joins in each map.
    seams=canvas(1648,1020,'NATIVE WRAP STRIPS','Every centre join is made by the last and first samples, with no duplicated edge pixels.')
    for i,name in enumerate(NAMES):
        a=np.array(display[name])
        across=np.concatenate((a[850:1010,-256:],a[850:1010,:256]),axis=1)
        down=np.concatenate((a[-80:,700:1212],a[:80,700:1212]),axis=0)
        label(seams,(24,88+i*220),name.upper(),17)
        seams.paste(Image.fromarray(across),(24,117+i*220))
        seams.paste(Image.fromarray(down),(580,117+i*220))
        label(seams,(1120,150+i*220),'x join at strip centre\ny join at strip centre',17,MUTED)
    seams.save(OUT/'seam_strips.png')
    if 'wrap_revision' in metrics:
        comparison=canvas(1648,1080,'WRAP REPAIR / before and after',
            'Native 2048 strips across the height wrap. Ratios use all interior neighbours; 2048 / 1024 shown below each strip.')
        for i,name in enumerate(NAMES):
            yy=110+i*238
            for j,caption in enumerate(('BEFORE','AFTER')):
                xx=24+j*808
                if j==0:
                    a=np.array(Image.open(OUT/f'wrap_fix/before/steel_{name}.png'))
                    if name=='height':
                        a=uint8((a.astype(float)/65535*HEIGHT-.16)/.14*255)
                    im=Image.fromarray(a).convert('RGB')
                    axes=[metrics['wrap_revision']['files'][f'steel_{name}{s}.png']['before_seams']
                          for s in ('','_1024')]
                else:
                    im=display[name]
                    axes=[metrics['seams'][f'steel_{name}{s}.png'] for s in ('','_1024')]
                a=np.array(im)
                strip=np.concatenate((a[-80:,628:1420],a[:80,628:1420]),axis=0)
                label(comparison,(xx,yy-27),name.upper()+' / '+caption,17)
                comparison.paste(Image.fromarray(strip),(xx,yy))
                ratios='; '.join(f"{size}: x {ax['x']['ratio']:.3f}, y {ax['y']['ratio']:.3f}"
                                for size,ax in zip((2048,1024),axes))
                label(comparison,(xx,yy+170),ratios,16)
        comparison.save(OUT/'wrap_fix/comparison.png')
    # Screen-size close-ups are rendered at target resolution, not scaled screenshots.
    screen=canvas(1648,960,'FIRST-PERSON / screen-size readings','Cylinder diameters of 100, 200, 300 pixels; physical steel diameter 18 mm. Same sun / sky.')
    for i,diam in enumerate((100,200,300)):
        width=int(diam*92/18)+24
        preview=surface_preview(maps,'face',lights[0],width,diam+24,x_start=43,y_center=143)
        ypos=[120,300,580][i]
        screen.paste(preview,(62,ypos))
        label(screen,(24,ypos-27),str(diam)+' px diameter',16)
    screen.save(OUT/'first_person.png')
    # Context is newly drawn from the user's stated palette, not reference pixels.
    context=canvas(1648,550,'INVENTORY / colour relationships','Left: actual 64 px material swatches. Right: supplied companion palette, newly drawn flat colours.')
    for i,region in enumerate(('face','edge','brass')):
        center={'face':120,'edge':37.5,'brass':12.5}[region]
        y0=int((center-8)/MM*2048)
        sw=display['base'].crop((500,y0,664,y0+164)).resize((64,64),Image.Resampling.LANCZOS)
        context.paste(sw,(24+i*180,130));label(context,(24+i*180,205),region,18)
        ci=surface_preview(maps,region,lights[0],256,92).resize((64,23),Image.Resampling.LANCZOS)
        context.paste(ci,(24+i*180,253))
    draw=ImageDraw.Draw(context)
    for i,(name,col) in enumerate([('wood',(164,120,76)),('lashing',(176,152,88)),('hide',(122,86,56)),('steel',(64,64,68)),('brass',(168,136,74))]):
        x=650+i*190
        draw.rectangle((x,130,x+166,300),fill=col);label(context,(x,321),name,18)
    label(context,(24,410),'The 64 px view carries dark steel / warm brass identity. Fine file marks belong to the closer view.',20,MUTED)
    context.save(OUT/'inventory_palette.png')
    # Reduction comparison: area reference next to saved delivery, error numbers.
    down=canvas(1648,570,'2048 → 1024 / reduction check','Base, height and ORM use rounded area means; the normal is rebuilt from the smaller saved height.')
    for i,name in enumerate(NAMES):
        xx=24+i*406
        a=box2(maps[name]);b=small[name]
        if name=='height':
            a=(a/65535*HEIGHT-.16)/.14*255;b=(b/65535*HEIGHT-.16)/.14*255
        aa=Image.fromarray(uint8(a)).convert('RGB');bb=Image.fromarray(uint8(b)).convert('RGB')
        down.paste(aa.crop((270,500,462,820)),(xx,130))
        down.paste(bb.crop((270,500,462,820)),(xx+198,130))
        label(down,(xx,90),name.upper(),18)
        label(down,(xx,465),f"PSNR {metrics['reduction'][name]['area_psnr_db']:.2f} dB",17)
        label(down,(xx,493),'area reference / delivered',14,MUTED)
    down.save(OUT/'downsample.png')
    # A readable overview, with full-size individual evidence beside it.
    rows=[(layers,offset),(cyl,detail),(tiled,relit),(screen,context),(down,neutral)]
    heights=[max(round(im.height*792/im.width) for im in pair) for pair in rows]
    contact=canvas(1648,110+sum(heights)+20*len(rows),'STEEL / village smithy trim material','0.20 m tile · native 2048 + aligned 1024 · 0.5 mm full height range · x-directed file marks')
    y=90
    for pair,row_height in zip(rows,heights):
        for column,im in enumerate(pair):
            height=round(im.height*792/im.width)
            contact.paste(im.resize((792,height),Image.Resampling.LANCZOS),(24+808*column,y))
        y+=row_height+20
    contact.save(OUT/'contact_sheet.png')


def main():
    start=time.perf_counter()
    ap=argparse.ArgumentParser()
    ap.add_argument('--verify-rebuild',action='store_true')
    args=ap.parse_args()
    OUT.mkdir(exist_ok=True)
    if args.verify_rebuild:
        paths=sorted(ROOT.glob('steel_*.png'))+sorted((ROOT/'source').glob('*'))
        before={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths if p.is_file()}
        subprocess.run([sys.executable,str(ROOT/'build_material.py')],cwd=ROOT,check=True)
        after={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in before}
        result={name:before[name]==after[name] for name in before}
        (OUT/'rebuild_verification.json').write_text(json.dumps({'all_match':all(result.values()),'matches':result,'before':before,'after':after},indent=2)+'\n')
        assert all(result.values()),'Rebuild did not reproduce retained outputs'
    maps,small,metrics=numerical_checks()
    print('Numerical checks:',metrics['passed'],'/',metrics['total'],flush=True)
    print('Failures:',metrics['failed'],flush=True)
    print('Rendering checks from delivery PNGs',flush=True)
    render_checks(maps,small,metrics)
    metrics['check_and_render_seconds']=round(time.perf_counter()-start,3)
    (OUT/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
    print(json.dumps({k:metrics[k] for k in ('bands','normals','reduction','height_mm','cavities','native_detail','check_and_render_seconds')},indent=2),flush=True)
    if metrics['failed']:raise SystemExit(1)


if __name__=='__main__':
    main()
