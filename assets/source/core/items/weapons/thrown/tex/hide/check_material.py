#!/usr/bin/env python3
"""Independent saved-PNG validation, repeat checks and physical-scale previews."""
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

ROOT=Path(__file__).resolve().parent
CHECKS=ROOT/'checks'
TILE_MM=200.0
HEIGHT_MM=1.0
BG=(24,25,28)
TEXT=(224,219,208)
FONT_PATH='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
try:
    FONT=ImageFont.truetype(FONT_PATH,18)
    SMALL=ImageFont.truetype(FONT_PATH,14)
    TITLE=ImageFont.truetype(FONT_PATH,25)
except OSError:
    FONT=SMALL=TITLE=ImageFont.load_default()


def load(name,suffix=''):
    return np.array(Image.open(ROOT/f'hide_{name}{suffix}.png'))


def rgb(a):
    if a.ndim==2:
        a=np.repeat(a[...,None],3,axis=2)
    return Image.fromarray(np.clip(np.rint(a),0,255).astype(np.uint8))


def s_to_l(a):
    a=np.asarray(a,dtype=np.float32)/255
    return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)


def l_to_s(a):
    a=np.maximum(a,0)
    return np.rint(np.clip(np.where(a<=.0031308,a*12.92,1.055*a**(1/2.4)-.055),0,1)*255).astype(np.uint8)


def unit(a):
    a=np.asarray(a,dtype=np.float32)
    return a/np.maximum(np.linalg.norm(a,axis=-1,keepdims=True),1e-8)


def decode_normal(a):
    return unit(a.astype(np.float32)/127.5-1)


def render(albedo,normal,orm,light=(.73,.36,.57),neutral=False):
    """Linear-light Lambert + isotropic dielectric GGX, fixed frontal view.

    Ambient is a constant diffuse dome approximation, modulated only by ORM R.
    This diagnostic is not an engine or a path tracer.
    """
    n=unit(normal)
    light=unit(light)
    half=unit(light+np.array([0,0,1]))
    nl=np.clip(np.sum(n*light,axis=-1),0,1)
    nv=np.maximum(n[...,2],.001)
    nh=np.clip(np.sum(n*half,axis=-1),0,1)
    vh=float(half[2])
    rough=np.clip(orm[...,1],.1,1)
    alpha2=rough**4
    den=nh*nh*(alpha2-1)+1
    d=alpha2/(np.pi*den*den+1e-7)
    k=(rough+1)**2/8
    g=(nl/(nl*(1-k)+k))*(nv/(nv*(1-k)+k))
    fresnel=.04+.96*(1-vh)**5
    spec=d*g*fresnel/(4*nl*nv+1e-7)
    colour=np.full_like(albedo,.22) if neutral else albedo
    direct=3.0*nl[...,None]*(colour*.96/np.pi+spec[...,None])
    ambient=colour*.28*orm[...,:1]
    return l_to_s(direct+ambient)


def area2(a):
    h,w=a.shape[:2]
    return a.astype(np.float64).reshape(h//2,2,w//2,2,*a.shape[2:]).mean(axis=(1,3))


def resize_float(a,size):
    if a.ndim==2:
        return np.array(Image.fromarray(a.astype(np.float32)).resize(size,Image.Resampling.BOX))
    return np.stack([resize_float(a[...,i],size) for i in range(a.shape[-1])],axis=-1)


def sample(a,x,y):
    h,w=a.shape[:2]
    ix,iy=np.floor(x).astype(np.int32),np.floor(y).astype(np.int32)
    fx,fy=x-ix,y-iy
    if a.ndim==3:
        fx,fy=fx[...,None],fy[...,None]
    return (a[iy%h,ix%w]*(1-fx)*(1-fy)+a[iy%h,(ix+1)%w]*fx*(1-fy)
           +a[(iy+1)%h,ix%w]*(1-fx)*fy+a[(iy+1)%h,(ix+1)%w]*fx*fy)


def panel(items,columns=2,cell=(512,512),title=None):
    cw,ch=cell
    top=62 if title else 8
    rows=math.ceil(len(items)/columns)
    out=Image.new('RGB',(columns*cw+16,rows*(ch+38)+top+8),BG)
    draw=ImageDraw.Draw(out)
    if title: draw.text((14,16),title,font=TITLE,fill=TEXT)
    for i,(im,label) in enumerate(items):
        x=8+(i%columns)*cw
        y=top+(i//columns)*(ch+38)
        thumb=im.copy()
        thumb.thumbnail((cw-12,ch),Image.Resampling.LANCZOS)
        out.paste(thumb,(x+(cw-12-thumb.width)//2,y+(ch-thumb.height)//2))
        draw.text((x+3,y+ch+7),label,font=SMALL,fill=TEXT)
    return out


def png_header(path):
    b=path.read_bytes(); pos=8; chunks=[]
    while pos<len(b):
        size=struct.unpack('>I',b[pos:pos+4])[0]
        kind=b[pos+4:pos+8].decode('ascii')
        chunks.append(kind)
        pos+=12+size
    w,h,depth,ctype=struct.unpack('>IIBB',b[16:26])
    return dict(width=w,height=h,bit_depth=depth,color_type=ctype,chunks=sorted(set(chunks)))


def independent_normal(h):
    """Independent stencil and explicit component normalization."""
    z=h.astype(np.float64)*(HEIGHT_MM/65535.)
    stride=TILE_MM/z.shape[0]
    ext=np.pad(z,1,mode='wrap')
    sx=(ext[1:-1,2:]-ext[1:-1,:-2])/(2*stride)
    sy=(ext[2:,1:-1]-ext[:-2,1:-1])/(2*stride)
    scale=1/np.sqrt(1+sx*sx+sy*sy)
    physical=np.stack([-sx*scale,sy*scale,scale],axis=-1)
    return np.rint(127.5*(physical+1)).astype(np.uint8),physical


def cylinder(base,norm,orm,ppm=18000,offset=(.21,.37),light=(.73,.36,.57),angle=0):
    """30 mm diameter cylinder, 25 mm axial band, actual-size UV footprint.

    Multisample in screen space and prefilter at the output pixel footprint.
    Smooth silhouette; the saved tangent normals affect shading only.
    """
    ss=2
    width=int(round(40*ppm/1000))*ss
    height=int(round(42*ppm/1000))*ss
    x=(np.arange(width)+.5-width/2)/(ppm*ss/1000)
    y=-(np.arange(height)+.5-height/2)/(ppm*ss/1000)
    x,y=np.meshgrid(x,y)
    mask=np.abs(x)<15
    band=np.abs(y)<=12.5
    theta=np.arcsin(np.clip(x/15,-1,1))
    # Image v downward; tangent Y along cylinder +y.
    u=offset[0]+(theta+angle)*15/TILE_MM
    v=offset[1]-y/TILE_MM
    size=min(2048,max(128,int(ppm*.2)))
    b=resize_float(s_to_l(base),(size,size))
    n=resize_float(decode_normal(norm),(size,size))
    o=resize_float(orm.astype(np.float32)/255,(size,size))
    b=sample(b,u*size-.5,v*size-.5)
    tangent=unit(sample(n,u*size-.5,v*size-.5))
    o=sample(o,u*size-.5,v*size-.5)
    # Analytic T=(cos t,0,-sin t), B=(0,1,0), N=(sin t,0,cos t).
    nx=tangent[...,0]*np.cos(theta)+tangent[...,2]*np.sin(theta)
    nz=-tangent[...,0]*np.sin(theta)+tangent[...,2]*np.cos(theta)
    world=np.stack([nx,tangent[...,1],nz],-1)
    smooth=np.stack([np.sin(theta),np.zeros_like(theta),np.cos(theta)],-1)
    world=np.where(band[...,None],world,smooth)
    # Plain honey-brown support is diagnostic context authored here.
    b=np.where(band[...,None],b,s_to_l([164,120,76]))
    o=np.where(band[...,None],o,np.array([1,.76,0]))
    rendered=render(b,world,o,light)
    rendered=np.where(mask[...,None],rendered,np.array(BG,dtype=np.uint8))
    return rgb(rendered).resize((width//ss,height//ss),Image.Resampling.LANCZOS)


def validate(maps,metrics):
    metrics['files']={}
    metrics['normals']={}
    metrics['downsampling']={}
    metrics['seams']={}
    for size,suffix in [(2048,''),(1024,'_1024')]:
        for name in ['base','height','normal','orm']:
            p=ROOT/f'hide_{name}{suffix}.png'
            meta=png_header(p)
            meta['sha256']=hashlib.sha256(p.read_bytes()).hexdigest()
            metrics['files'][p.name]=meta
            assert meta['width']==size and meta['height']==size
            assert meta['bit_depth']==(16 if name=='height' else 8)
            assert meta['color_type']==(0 if name=='height' else 2)
            if name=='base': assert 'sRGB' in meta['chunks']
            else: assert not set(meta['chunks'])&{'sRGB','gAMA','iCCP'}
            a=maps[size][name].astype(np.float64)
            comparisons=[]
            for axis in [0,1]:
                edge=np.abs(np.take(a,0,axis)-np.take(a,-1,axis)).mean()
                d=np.abs(np.diff(a,axis=axis))
                other=tuple(i for i in range(d.ndim) if i!=axis)
                lines=d.mean(axis=other)
                comparisons.append(dict(axis='y' if axis==0 else 'x',wrap_mae=float(edge),
                                        interior_median_line_mae=float(np.median(lines)),
                                        interior_p95_line_mae=float(np.percentile(lines,95)),
                                        ratio_to_p95=float(edge/max(1e-12,np.percentile(lines,95)))))
                assert edge < 1.5*max(1e-12,np.percentile(lines,95)), (p.name,axis,'boundary discontinuity')
            metrics['seams'][p.name]=comparisons
        assert np.all(maps[size]['orm'][...,2]==0)
        target,physical=independent_normal(maps[size]['height'])
        diff=np.abs(target.astype(np.int16)-maps[size]['normal'].astype(np.int16))
        angle=np.rad2deg(np.arccos(np.clip(np.sum(physical*decode_normal(maps[size]['normal']),-1),-1,1)))
        metrics['normals'][str(size)]=dict(max_byte_error=int(diff.max()),mismatched_channels=int(np.count_nonzero(diff)),
                                         angle_mean_deg=float(angle.mean()),angle_max_deg=float(angle.max()),
                                         tilt_percentiles_deg=np.percentile(np.rad2deg(np.arccos(physical[...,2])),[50,95,99,100]).tolist())
        assert diff.max()==0
    for name in ['base','height','normal','orm']:
        expected=area2(maps[2048][name])
        actual=maps[1024][name].astype(np.float64)
        mse=float(np.mean((expected-actual)**2))
        peak=65535 if name=='height' else 255
        psnr=10*np.log10(peak*peak/mse) if mse else 999
        metrics['downsampling'][name]=dict(psnr_db=float(psnr),rms_code_values=float(np.sqrt(mse)),
                                            rounded_area_exact=bool(np.array_equal(np.rint(expected),actual)))
        assert psnr>=30,(name,psnr)
    b=maps[2048]['base'].astype(np.float64)
    metrics['mean_srgb']=b.mean(axis=(0,1)).tolist()
    assert np.max(np.abs(np.array(metrics['mean_srgb'])-[122,86,56]))<.5
    block=b.reshape(8,256,8,256,3).mean(axis=(1,3))
    metrics['block_means_min']=block.min(axis=(0,1)).tolist()
    metrics['block_means_max']=block.max(axis=(0,1)).tolist()
    coords=np.linspace(-.5,.5,2048)
    metrics['fitted_end_to_end_drift_rgb']={}
    for axis in [0,1]:
        line=b.mean(axis=1-axis)
        slope=(line*coords[:,None]).sum(0)/(coords*coords).sum()
        metrics['fitted_end_to_end_drift_rgb']['y' if axis==0 else 'x']=slope.tolist()
    normal=decode_normal(maps[2048]['normal'])
    slope=normal[...,:2]/normal[...,2:]
    energy=np.mean(slope*slope,axis=(0,1))
    metrics['isotropy']=dict(slope_energy_xy=energy.tolist(),x_to_y_ratio=float(energy[0]/energy[1]))
    orm=maps[2048]['orm'].astype(np.float64)/255
    metrics['ao_percentiles']=np.percentile(orm[...,0],[0,1,50,99,100]).tolist()
    metrics['roughness_percentiles']=np.percentile(orm[...,1],[0,1,50,99,100]).tolist()
    assert orm[...,1].min() >= .55-1/255 and orm[...,1].max() <= .75+1/255
    assert orm[...,0].min() >= .82
    metrics['height_occupied_mm']=[float(maps[2048]['height'].min()/65535),float(maps[2048]['height'].max()/65535)]
    # Reconstruction check links authored shared fields to the actual deliverable.
    with np.load(ROOT/'source/construction_fields.npz') as f:
        reconstructed=.50+f['grain_mm']+f['creases_mm']+f['pores_mm']+f['scars_mm']
        reconstructed=np.rint(reconstructed*65535).astype(np.uint16)
        count=int(np.count_nonzero(reconstructed!=maps[2048]['height']))
        metrics['source_to_height_mismatches']=count
        assert count==0
        metrics['ao_outside_cavity_count']=int(np.count_nonzero((f['cavity_support']<.001)&(maps[2048]['orm'][...,0]!=255)))
        assert metrics['ao_outside_cavity_count']==0
    enlarged=np.array(Image.fromarray(maps[1024]['base']).resize((2048,2048),Image.Resampling.BICUBIC))
    metrics['native_base_rms_vs_1k_upscale']=float(np.sqrt(np.mean((enlarged.astype(float)-b)**2)))
    metrics['albedo_to_normal_xy_correlations']=[float(np.corrcoef(b.mean(-1).ravel(),normal[...,i].ravel())[0,1]) for i in [0,1]]
    manifest=json.loads((ROOT/'source/construction.json').read_text())
    metrics['feature_counts']={k:sum(r['kind']==k for r in manifest['marks']) for k in ['crease','scratch','scar']}
    metrics['max_authored_mark_length_mm']=max(r['length_mm'] for r in manifest['marks'])
    assert metrics['max_authored_mark_length_mm']<30


def previews(maps,metrics):
    m=maps[2048]
    base=m['base']; height=m['height']; norm=m['normal']; orm=m['orm']
    b=s_to_l(base); n=decode_normal(norm); o=orm.astype(np.float32)/255
    print('Rendering two light directions and native detail...',flush=True)
    lit_a=render(b,n,o)
    lit_b=render(b,n,o,light=(-.73,-.36,.57))
    neutral_a=render(b,n,o,light=(.88,.2,.43),neutral=True)
    neutral_b=render(b,n,o,light=(-.88,-.2,.43),neutral=True)
    rgb(lit_a).save(CHECKS/'lit_a.png')
    rgb(lit_b).save(CHECKS/'lit_b.png')
    # Height preview uses fixed physical contrast; delivery remains true 16-bit.
    hview=np.clip((height.astype(float)/65535-.28)/.40*255,0,255)
    ims=[rgb(base),rgb(hview),rgb(norm),rgb(orm)]
    layers=panel(list(zip(ims,['Base / sRGB','Height / 0.28–0.68 mm display','Normal / OpenGL','ORM / linear R,G,B'])),4,(450,450),
                 'HIDE  /  200 × 200 mm  /  2048 master')
    layers.save(CHECKS/'layers.jpg',quality=95)
    panel([(rgb(orm[...,0]),'Ambient occlusion / shallow cavities'),(rgb(orm[...,1]),'Roughness / satin handling polish'),
           (rgb(orm[...,2]),'Metalness / exactly zero')],3,(512,512),'ORM channels  /  linear values').save(CHECKS/'orm_channels.png')
    lightpanel=panel([(rgb(lit_a),'Light from upper right'),(rgb(lit_b),'Light from lower left'),
                      (rgb(neutral_a),'Neutral pigment / raking light A'),(rgb(neutral_b),'Neutral pigment / raking light B')],2,(780,780),
                      'Surface relief under opposed lights')
    lightpanel.save(CHECKS/'relighting.jpg',quality=95)
    region=(390,545,1158,1313)
    native=panel([(im.crop(region),label) for im,label in zip(ims+[rgb(lit_a),rgb(lit_b)],
                  ['Base at 1:1','Height at 1:1','Normal at 1:1','ORM at 1:1','Light A at 1:1','Light B at 1:1'])],3,(780,768),
                  'Native detail  /  75 × 75 mm crop')
    native.save(CHECKS/'native_detail.jpg',quality=97)
    offsets=[]
    for array,label in [(base,'Base'),(hview,'Height'),(norm,'Normal'),(orm,'ORM'),(lit_a,'Light A'),(lit_b,'Light B')]:
        offsets.append((rgb(np.roll(array,(1024,1024),(0,1))),label+' / offset x+y by 1024'))
    offsetpanel=panel(offsets,3,(540,540),'Half-tile wrap  /  original borders cross in the centre')
    offsetpanel.save(CHECKS/'offsets.jpg',quality=95)
    native_seams=panel([(im.crop((768,768,1280,1280)),label) for im,label in offsets],3,(524,512),
                       'Original tile intersection  /  native pixels')
    native_seams.save(CHECKS/'native_seams.png')
    tilepanels=[]
    for array,name in [(base,'base'),(lit_a,'lit')]:
        tiled=np.tile(array,(3,3,1))
        im=rgb(tiled)
        im.save(CHECKS/f'{name}_3x3_native.jpg',quality=94)
        im.resize((2048,2048),Image.Resampling.LANCZOS).save(CHECKS/f'{name}_3x3_large.jpg',quality=95)
        tilepanels.append((im,f'{name.title()} / 3 × 3 / 600 mm square'))
    tiling=panel(tilepanels,2,(900,900),'Repetition check')
    tiling.save(CHECKS/'tiling.jpg',quality=95)
    print('Rendering 25 mm bands on 30 mm cylinders...',flush=True)
    cylinders=[]
    for off,label in [((.21,.37),'UV sample A'),((.61,.68),'UV sample B')]:
        for light,ln in [((.73,.36,.57),'light A'),((-.73,-.36,.57),'light B')]:
            c=cylinder(base,norm,orm,ppm=15000,offset=off,light=light)
            cylinders.append((c,label+' / '+ln))
    cylpanel=panel(cylinders,4,(610,650),'25 mm leather strip  /  30 mm cylinder diameter')
    cylpanel.save(CHECKS/'cylinder_close.png')
    # Actual-size views: each render is pasted without enlargement.
    screen=Image.new('RGB',(1100,650),BG);d=ImageDraw.Draw(screen)
    d.text((20,15),'Actual screen pixels  /  no display enlargement',font=TITLE,fill=TEXT)
    for j,ppm in enumerate([1500,2200,3000]):
        x=30+j*355
        d.text((x,65),f'{ppm} px/m  ·  diameter {round(.03*ppm)} px',font=FONT,fill=TEXT)
        for k,off in enumerate([(.21,.37),(.61,.68),(.83,.17)]):
            c=cylinder(base,norm,orm,ppm=ppm,offset=off)
            screen.paste(c,(x+k*105,110))
        # 50 mm patches occupy 75–150 screen pixels and show grain without cylinder curvature.
        side=round(.05*ppm)
        crop=rgb(lit_a).crop((460,600,972,1112)).resize((side,side),Image.Resampling.LANCZOS)
        screen.paste(crop,(x,295))
        d.text((x,280),'50 × 50 mm surface patch',font=SMALL,fill=TEXT)
        d.text((x,470),f'{side} × {side} px',font=SMALL,fill=TEXT)
    # Diagnostic inventory swatches using supplied mean colours (no reference pixels).
    labels=['Hide','Wood','Lashing','Flint','Steel']
    colours=[None,(164,120,76),(176,152,88),(74,72,76),(64,64,68)]
    for i,(label,col) in enumerate(zip(labels,colours)):
        x=30+i*150
        im=rgb(base).resize((64,64),Image.Resampling.LANCZOS) if col is None else Image.new('RGB',(64,64),col)
        screen.paste(im,(x,550));d.text((x,623),label,font=SMALL,fill=TEXT)
    d.text((790,556),'64 px swatches',font=FONT,fill=TEXT)
    d.text((790,584),'Neighbours: brief means',font=SMALL,fill=TEXT)
    screen.save(CHECKS/'screen_sizes.png')
    downs=[]
    for name in ['base','height','normal','orm']:
        a=area2(maps[2048][name]);c=maps[1024][name]
        if name=='height': a=a/257;c=c/257
        downs.extend([(rgb(a),name+' / reduced 2048'),(rgb(c),name+' / saved 1024')])
    downpanel=panel(downs,4,(360,360),'2048 → 1024  /  side-by-side stored values')
    downpanel.save(CHECKS/'downsampling.jpg',quality=95)
    # Full-resolution crops of the two scars, demonstrating shared coordinates.
    scars=[]
    for cx,cy in [(630,781),(1745,1490)]:
        region=(cx-192,cy-192,cx+192,cy+192)
        for im,label in [(rgb(base),'Pigment'),(rgb(hview),'Height'),(rgb(norm),'Normal'),(rgb(lit_a),'Relit')]:
            scars.append((im.crop(region),label))
    panel(scars,4,(396,384),'Two small healed scars  /  37.5 mm crops').save(CHECKS/'feature_alignment.png')
    compare=panel([(rgb(base).crop((600,600,1112,1112)),'2048 native'),
                   (rgb(maps[1024]['base']).resize((2048,2048),Image.Resampling.BICUBIC).crop((600,600,1112,1112)),'1024 enlarged to 2048')],
                  2,(524,512),'Native fine pigment detail')
    compare.save(CHECKS/'native_vs_upscaled.png')
    overview=panel([(rgb(base),'Base / unlit pigment'),(rgb(norm),'Normal / physical height'),(rgb(orm),'AO · roughness · zero metal'),
                    (rgb(lit_a),'Light A'),(rgb(lit_b),'Light B'),(cylinders[0][0],'25 mm band / 30 mm diameter'),
                    (offsets[4][0],'Half-tile offset / relit'),(tilepanels[1][0],'3 × 3 repetition / relit'),(screen,'First-person and 64 px inventory')],
                   3,(560,560),'HIDE  /  worked, smoked leather  /  review contact sheet')
    overview.save(CHECKS/'contact_sheet.jpg',quality=95)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--verify-rebuild',action='store_true')
    args=parser.parse_args()
    started=time.perf_counter();CHECKS.mkdir(exist_ok=True)
    metrics={}
    if args.verify_rebuild:
        before={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in ROOT.glob('hide_*.png')}
        subprocess.run([sys.executable,str(ROOT/'build_material.py')],cwd=ROOT,check=True)
        after={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in ROOT.glob('hide_*.png')}
        assert len(before)==8 and before==after
        verification=dict(byte_identical=True,before=before,after=after)
        (CHECKS/'rebuild_verification.json').write_text(json.dumps(verification,indent=2)+'\n')
        metrics['rebuild_byte_identical']=True
    maps={size:{name:load(name,suffix) for name in ['base','height','normal','orm']}
          for size,suffix in [(2048,''),(1024,'_1024')]}
    validate(maps,metrics)
    # Save early, so numerical findings survive a preview renderer failure.
    (CHECKS/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
    previews(maps,metrics)
    metrics['check_seconds']=time.perf_counter()-started
    metrics['all_required_checks_passed']=True
    (CHECKS/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
    print(json.dumps({k:metrics[k] for k in ['mean_srgb','height_occupied_mm','downsampling','normals','isotropy','check_seconds']},indent=2),flush=True)


if __name__=='__main__':
    main()
