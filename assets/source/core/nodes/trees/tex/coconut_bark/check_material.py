#!/usr/bin/env python3
"""Independently inspect delivered PNGs and regenerate visual checks.

Python 3 + numpy + scipy + Pillow. Reads material.json and the four exported maps.
Does not call the builder, and computes its own expected height derivatives.
"""
from pathlib import Path
import json
import struct
import hashlib
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import gaussian_filter, map_coordinates

ROOT = Path(__file__).resolve().parent
NAME = ROOT.name
OUT = ROOT/'checks'
FONT_PATH = '/System/Library/Fonts/Supplemental/Arial.ttf'


def font(size):
    try: return ImageFont.truetype(FONT_PATH, size)
    except OSError: return ImageFont.load_default()


def labeled(im, label, sub='', size=None):
    if size: im = im.resize(size, Image.Resampling.LANCZOS)
    p = Image.new('RGB', (im.width, im.height+66), (23,25,26))
    p.paste(im, (0,66))
    d = ImageDraw.Draw(p)
    d.text((14,8), label, fill=(235,235,227), font=font(22))
    if sub: d.text((14,37), sub, fill=(170,175,171), font=font(15))
    return p


def montage(ims, cols=2):
    w, h = max(i.width for i in ims), max(i.height for i in ims)
    out = Image.new('RGB',(w*cols,h*((len(ims)+cols-1)//cols)),(23,25,26))
    for k, im in enumerate(ims): out.paste(im,((k%cols)*w,(k//cols)*h))
    return out


def pil(a):
    return Image.fromarray(np.clip(np.rint(a*255),0,255).astype(np.uint8))


def edge_stats(a):
    """Compare seam pixel steps to all interior steps AND full line means."""
    if a.ndim == 2: a = a[..., None]
    result = {}
    for label, axis in [('left_right',1),('top_bottom',0)]:
        internal = np.abs(np.diff(a,axis=axis))
        edge = np.abs(np.take(a,0,axis=axis)-np.take(a,-1,axis=axis))
        lines = internal.mean(axis=(0,2) if axis==1 else (1,2))
        im = float(internal.mean())
        p95 = float(np.percentile(lines,95))
        em = float(edge.mean())
        result[label] = dict(seam_mean=em, seam_pixel_p95=float(np.percentile(edge,95)),
                             seam_max=float(edge.max()), interior_mean=im,
                             interior_pixel_p95=float(np.percentile(internal,95)),
                             interior_line_mean_p95=p95,
                             seam_over_interior_mean=em/max(im,1e-12),
                             seam_over_interior_line_p95=em/max(p95,1e-12),
                             passes=bool(em<=1.35*p95+1e-5))
    return result


def linear(c):
    return np.where(c<=.04045,c/12.92,((c+.055)/1.055)**2.4)


def srgb(c):
    c = np.maximum(c,0)
    return np.where(c<=.0031308,12.92*c,1.055*c**(1/2.4)-.055)


def shade(base,n,orm,light):
    """Linear diffuse + broad dielectric GGX lobe, tone unchanged by auto exposure."""
    l = np.array(light,np.float32); l /= np.linalg.norm(l)
    half = l+np.array([0,0,1],np.float32); half /= np.linalg.norm(half)
    nl = np.maximum(np.sum(n*l,axis=-1),0)
    nv = np.maximum(n[...,2],.02)
    nh = np.maximum(np.sum(n*half,axis=-1),0)
    a2 = orm[...,1]**4
    D = a2/(np.pi*(nh*nh*(a2-1)+1)**2+1e-6)
    k = (orm[...,1]+1)**2/8
    G = (nl/(nl*(1-k)+k+1e-6))*(nv/(nv*(1-k)+k+1e-6))
    spec = D*G*.04/(4*nv+1e-6)
    color = linear(base)*(.32*orm[...,0,None]+.90*nl[...,None])
    color += spec[...,None]*.90
    return np.clip(srgb(color),0,1)


def tile_preview(base,across,up,tile_h,aspect):
    cell=base.resize((round(tile_h*aspect),tile_h),Image.Resampling.LANCZOS)
    o=Image.new('RGB',(cell.width*across,cell.height*up))
    for y in range(up):
        for x in range(across): o.paste(cell,(x*cell.width,y*cell.height))
    return o


def cylinder(base,normal,orm,width_mm,height_mm,view_height_mm,h,light,phase,mode='lit'):
    radius_mm=width_mm/(2*np.pi)
    width=max(16,round(2*radius_mm/view_height_mm*h))
    xx=np.linspace(-.998,.998,width,dtype=np.float32)
    theta=np.arcsin(xx)
    us=(phase+theta/(2*np.pi))%1*base.shape[1]
    vs=(np.arange(h,dtype=np.float32)+.5)/h*(view_height_mm/height_mm)*base.shape[0]
    yy,ux=np.meshgrid(vs,us,indexing='ij')
    coords=[yy,ux]
    # Approximate mip filtering before minification: do not disguise repeats
    # with aliased source pixels on the 14-metre inspection cylinders.
    sx=max(0.,.42*(float(np.median(np.diff(us)))-1))
    sy=max(0.,.42*((view_height_mm/height_mm)*base.shape[0]/h-1))
    def sample(a, color=False):
        if color: a=linear(a)
        filtered=gaussian_filter(a,(sy,sx,0),mode='wrap')
        value=np.stack([map_coordinates(filtered[...,k],coords,order=1,mode='grid-wrap') for k in range(3)],-1)
        return srgb(value) if color else value
    b,n,o=sample(base,True),sample(normal),sample(orm)
    if mode=='unlit': return pil(b)
    if mode=='no_ao': o[...,0]=1
    n/=np.linalg.norm(n,axis=-1,keepdims=True)
    st,ct=np.sin(theta)[None,:],np.cos(theta)[None,:]
    world=np.stack([n[...,0]*ct+n[...,2]*st,n[...,1],-n[...,0]*st+n[...,2]*ct],-1)
    return pil(shade(b,world,o,light))


def reduced_base(im,size):
    """Exact linear-light box mip: no sharpening, AO or lighting assistance."""
    a=linear(np.asarray(im,dtype=np.float32)/255)
    factor=a.shape[0]//size
    a=a.reshape(size,factor,size,factor,3).mean(axis=(1,3))
    return pil(srgb(a))


def distance_checks(base,meta):
    old=Image.open(ROOT/'source'/'round1'/f'{NAME}_base.png').convert('RGB')
    oldmeta=json.loads((ROOT/'source'/'round1'/'material.json').read_text())
    stage=Image.new('RGB',(980,800),(39,43,42)); draw=ImageDraw.Draw(stage)
    draw.text((24,15),NAME.upper()+' / UNLIT DISTANCE CHECK',font=font(26),fill=(235,235,224))
    draw.text((24,50),'Linear-light box reduction. Native pixels, no sharpening, no lighting, no AO.',font=font(18),fill=(189,196,185))
    stats={}
    for size,xs in ((256,(24,300)),(128,(600,762))):
        for revision,im,x,m in [('round1',old,xs[0],oldmeta),('round2',base,xs[1],meta)]:
            thumb=reduced_base(im,size)
            stage.paste(thumb,(x,116))
            draw.text((x,90),f'{revision} / {size}',font=font(18),fill=(230,232,221))
            aspect=meta['physical_width_mm']/meta['physical_height_mm']
            squeezed=thumb.resize((round(size*aspect),size),Image.Resampling.BOX)
            stage.paste(squeezed,(x,458))
            draw.text((x,430),'Physical aspect',font=font(16),fill=(230,232,221))
            if revision=='round2': thumb.save(OUT/f'base_{size}.png')
            lum=np.asarray(thumb,dtype=np.float32)@np.array([.2126,.7152,.0722])
            profile=lum.mean(axis=1)
            pairs=[]
            for ring in m['rings']:
                c=ring['center_mm']/m['physical_height_mm']*size
                # Search a tight neighbourhood around the independently
                # recorded physical ring centre, then its adjacent dark line.
                r=np.arange(int(np.floor(c-1)),int(np.ceil(c+1))+1)
                crest=int(r[np.argmax(profile[r%size])])
                below=np.arange(crest+1,crest+max(3,round(size*.014))+1)
                pairs.append(float(profile[crest%size]-profile[below%size].min()))
            stats[f'{revision}_{size}']=dict(median_lip_to_recess_srgb255=float(np.median(pairs)),
                minimum_lip_to_recess_srgb255=float(min(pairs)),per_ring_lip_to_recess_srgb255=pairs,
                ring_count=len(pairs),pixel_width=size,filter='linear-light box, unsharpened')
    draw.text((24,751),'128 / 256 px are screen-size proxies, not calibrated engine distances.',font=font(18),fill=(189,196,185))
    stage.save(OUT/'distance_readability.png')
    # These bounds catch the original failure: rings disappear in unlit mips.
    royal=NAME=='royal_bark'
    stats['passes']=all(stats[f'round2_{s}']['median_lip_to_recess_srgb255']>=threshold
                        for s,threshold in ((128,3 if royal else 12),(256,5 if royal else 18)))
    return stats


def main():
    OUT.mkdir(exist_ok=True)
    meta=json.loads((ROOT/'material.json').read_text())
    arrays={}; images={}; formats={}
    for layer in ('base','height','normal','orm'):
        path=ROOT/f'{NAME}_{layer}.png'
        im=Image.open(path); images[layer]=im.copy()
        raw=path.read_bytes()
        width,height,bits,color=struct.unpack('>IIBB',raw[16:26])
        expected=(16,0) if layer=='height' else (8,2)
        assert (width,height)==(2048,2048), f'{layer} dimensions'
        assert (bits,color)==expected, f'{layer} PNG format'
        assert bool(im.info.get('icc_profile'))==(layer=='base'), f'{layer} color space'
        a=np.asarray(im,dtype=np.float32)/(65535 if layer=='height' else 255)
        arrays[layer]=a
        formats[layer]=dict(width=width,height=height,bit_depth=bits,
                            png_color_type=color,mode=im.mode,
                            icc_profile=bool(im.info.get('icc_profile')),
                            sha256=hashlib.sha256(raw).hexdigest())
    h=arrays['height']*meta['full_height_range_mm']; n=arrays['normal']*2-1
    lengths=np.linalg.norm(n,axis=-1); n/=lengths[...,None]
    wmm,hmm=meta['physical_width_mm'],meta['physical_height_mm']
    dx=(np.roll(h,-1,axis=1)-np.roll(h,1,axis=1))/(2*wmm/h.shape[1])
    dy=(np.roll(h,-1,axis=0)-np.roll(h,1,axis=0))/(2*hmm/h.shape[0])
    expect=np.stack((-dx,dy,np.ones_like(h)),axis=-1)
    expect/=np.linalg.norm(expect,axis=-1,keepdims=True)
    angle=np.degrees(np.arccos(np.clip(np.sum(expect*n,axis=-1),-1,1)))
    agreement=dict(mean_degrees=float(angle.mean()),p99_degrees=float(np.percentile(angle,99)),
                   max_degrees=float(angle.max()),
                   normal_length_min=float(lengths.min()),normal_length_max=float(lengths.max()),
                   convention='OpenGL +Y points to image top; normal G = +dH/d(image row)',
                   passes=bool(angle.max()<.5))
    assert agreement['passes'], 'Normal does not agree with delivered height'
    orm=arrays['orm']; base=arrays['base']
    assert np.all(orm[...,2]==0), 'Nonzero metalness'
    assert orm[...,1].min()>=.65-1/255 and orm[...,1].max()<=.90, 'Roughness range'
    seams={key:edge_stats(a) for key,a in arrays.items()}
    rowmeans=base.mean(axis=(1,2))*255
    colmeans=base.mean(axis=(0,2))*255
    masks=np.load(ROOT/'source'/'construction_masks.npz')
    lichen=masks['lichen'].astype(np.float32)>.25
    metrics=dict(formats=formats,physical_scale=meta,edge_difference_units='normalized [0,1] code values; height additionally uses documented full millimetre range',
                 edges=seams,normal_height_agreement=agreement,
                 height_mm=dict(min=float(h.min()),max=float(h.max()),span=float(np.ptp(h))),
                 base_mean_srgb255=[float(v) for v in base.mean(axis=(0,1),dtype=np.float64)*255],
                 base_median_srgb255=[float(v) for v in np.median(base,axis=(0,1))*255],
                 ao=dict(min=float(orm[...,0].min()),mean=float(orm[...,0].mean())),
                 roughness=dict(min=float(orm[...,1].min()),max=float(orm[...,1].max()),mean=float(orm[...,1].mean()),
                                lichen_mean=float(orm[...,1][lichen].mean()),body_mean=float(orm[...,1][~lichen].mean())),
                 metalness_nonzero_pixels=int(np.count_nonzero(orm[...,2])),
                 tonal_bands=dict(row_mean_range_255=float(np.ptp(rowmeans)),column_mean_range_255=float(np.ptp(colmeans))),
                 repeat=dict(exact_period_metres=hmm/1000,
                             exact_period_correlation=1.0,
                             note='A finite repeated texture cannot be aperiodic. Inspect the unmodified 3x8 for visual salience; no per-tile randomization in these checks.'))
    metrics['distance_readability']=distance_checks(images['base'],meta)
    gaps=np.array([r['gap_to_next_mm'] for r in meta['rings']])
    royal=NAME=='royal_bark'
    assert np.isclose(gaps.sum(),hmm), 'Ring spacings must include the vertical wrap'
    assert gaps.min()>=(80 if royal else 50) and gaps.max()<=(200 if royal else 100), 'Ring spacing'
    assert h.min()>0 and h.max()<meta['full_height_range_mm'], 'Clipped height'
    metrics['all_numeric_checks_pass']=all(v['passes'] for layer in seams.values() for v in layer.values()) and agreement['passes'] and metrics['distance_readability']['passes']
    (OUT/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
    heightim=pil(arrays['height']).convert('RGB')
    labels=[('BASE / sRGB','Flat reflectance; original paintings + authored pigmentation'),
            ('HEIGHT / 16-bit',f'Black to white = {meta["full_height_range_mm"]:.1f} mm; white high'),
            ('NORMAL / OpenGL','Metric wrapped derivatives of the delivered height'),
            ('ORM / linear','R: horizon AO   G: roughness   B: zero')]
    ims=[images['base'],heightim,images['normal'],images['orm']]
    montage([labeled(im,*label,size=(768,768)) for im,label in zip(ims,labels)]).save(OUT/'layers.jpg',quality=95,subsampling=0)
    tile_preview(images['base'],3,3,768,wmm/hmm).save(OUT/'base_tile3x3.jpg',quality=95,subsampling=0)
    tile_preview(images['base'],3,8,512,wmm/hmm).save(OUT/'base_tile3x8.jpg',quality=95,subsampling=0)
    lights=[[-.58,.60,.55],[.58,-.60,.55]]
    relit=[pil(shade(base,n,orm,l)) for l in lights]
    montage([labeled(i,t,'Neutral light; linear diffuse + dielectric specular',size=(1024,1024)) for i,t in zip(relit,['LIGHT / upper left','LIGHT / lower right'])]).save(OUT/'relighting.jpg',quality=95,subsampling=0)
    # Native samples expose detail and registration without hiding it by resizing.
    x,y=487,503
    crop=(x,y,x+640,y+640)
    montage([labeled(im.crop(crop),label[0],'Native 1:1 pixel crop') for im,label in zip(ims,labels)]).save(OUT/'detail_1to1.jpg',quality=97,subsampling=0)
    montage([labeled(Image.fromarray(np.roll(np.asarray(im),(1024,1024),(0,1))),label[0],'Half-offset: wraps cross the centre',size=(768,768)) for im,label in zip(ims,labels)]).save(OUT/'offsets.jpg',quality=95,subsampling=0)
    # Full-height columns show true perspective-free relative trunk proportions.
    stage=Image.new('RGB',(1400,1630),(39,43,42)); d=ImageDraw.Draw(stage)
    d.text((32,20),NAME.replace('_',' ').upper()+' / CYLINDER CHECK',font=font(27),fill=(230,230,219))
    d.text((32,61),'Close surfaces at two azimuths; right: 14 m repeated trunk. Diagnostic, not an engine screenshot.',font=font(18),fill=(173,180,169))
    for j in range(2):
        c=cylinder(base,n,orm,wmm,hmm,hmm,1200,lights[j],.18+.37*j)
        stage.paste(c,(100+j*410,160))
        d.text((90+j*410,1400),f'{hmm/1000:g} m surface / light {j+1}',font=font(20),fill=(215,219,208))
    for j in range(3):
        c=cylinder(base,n,orm,wmm,hmm,14000,1450,lights[0],.08+.29*j)
        stage.paste(c,(1030+j*115,130))
    stage.save(OUT/'trunk_preview.jpg',quality=95,subsampling=0)
    # Exactly repeated 14 m cylinders with AO disabled. No ray/cast shadows.
    stage=Image.new('RGB',(1100,1660),(39,43,42)); d=ImageDraw.Draw(stage)
    d.text((24,20),'14 m / UNLIT + ONE SUN AND SKY, NO AO OR CAST SHADOWS',font=font(23),fill=(230,230,219))
    for group,mode in enumerate(('unlit','no_ao')):
        d.text((30+group*540,70),'BASE ONLY' if mode=='unlit' else 'SUN + SKY / AO OFF',font=font(22),fill=(230,230,219))
        for j in range(3):
            c=cylinder(base,n,orm,wmm,hmm,14000,1450,lights[0],.08+.29*j,mode=mode)
            stage.paste(c,(100+group*540+j*145,130))
    stage.save(OUT/'no_shadow_14m.jpg',quality=95,subsampling=0)
    for k in ('base','height','normal','orm'):
        print(k, {axis:round(v['seam_over_interior_line_p95'],3) for axis,v in seams[k].items()})
    print('normal error degrees:',agreement)
    print('mip ring contrast:',{k:round(v['median_lip_to_recess_srgb255'],2) for k,v in metrics['distance_readability'].items() if isinstance(v,dict)})
    print('all numeric checks pass:',metrics['all_numeric_checks_pass'])
    assert metrics['all_numeric_checks_pass'], 'A delivered wrap needs inspection; see metrics.json'


if __name__=='__main__': main()
