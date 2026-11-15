#!/usr/bin/env python3
"""Independent saved-map checks, review sheets, and a displaced cylinder render."""
from pathlib import Path
import json
import struct
import time
import hashlib
import sys
import subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
OUT = ROOT/'checks'
TILE_MM = 200.
HEIGHT_MM = 4.
N = 2048
LIGHTS = [(-.55,.65,.80),(.65,-.55,.80)]


def font(size=20):
    p='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
    return ImageFont.truetype(p,size) if Path(p).exists() else ImageFont.load_default()


def unit(v):
    return v / np.maximum(np.linalg.norm(v,axis=-1,keepdims=True),1e-10)


def linear(a):
    a=np.asarray(a,dtype=np.float32)/255
    return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)


def encode(a):
    a=np.maximum(a,0)
    s=np.where(a<=.0031308,12.92*a,1.055*a**(1/2.4)-.055)
    return np.rint(np.clip(s*255,0,255)).astype(np.uint8)


def shade(base,n,orm,light,neutral=False):
    l=unit(np.array(light,dtype=np.float32))
    v=np.array([0.,0.,1.],np.float32)
    half=unit(l+v)
    ndl=np.maximum(np.sum(n*l,-1),0)
    ndv=np.maximum(n[...,2],.001)
    ndh=np.maximum(np.sum(n*half,-1),0)
    vdh=max(float(half[2]),.001)
    rough=orm[...,1]/255
    alpha2=np.maximum(rough,.05)**4
    D=alpha2/(np.pi*(ndh**2*(alpha2-1)+1)**2)
    k=(rough+1)**2/8
    G=(ndv/(ndv*(1-k)+k))*(ndl/(ndl*(1-k)+k+1e-8))
    F=.04+.96*(1-vdh)**5
    spec=D*G*F/(4*ndv*np.maximum(ndl,.001))
    albedo=np.full(base.shape,.35,np.float32) if neutral else linear(base)
    colour=albedo*(.24*(orm[...,0]/255)[...,None]+.95*ndl[...,None])
    colour += (.55*spec*ndl)[...,None]
    return encode(colour)


def normal_from_saved(height):
    # Kept independent of the builder and evaluated in physical millimetres.
    h=height.astype(np.float64)*4/65535
    pixels_per_mm=height.shape[0]/200
    right=np.concatenate((h[:,1:],h[:,:1]),axis=1)
    left=np.concatenate((h[:,-1:],h[:,:-1]),axis=1)
    down=np.concatenate((h[1:,:],h[:1,:]),axis=0)
    up=np.concatenate((h[-1:,:],h[:-1,:]),axis=0)
    vec=np.stack((-(right-left)*pixels_per_mm*.5,
                  (down-up)*pixels_per_mm*.5,np.ones_like(h)),axis=-1)
    return np.rint((unit(vec)+1)*127.5).astype(np.uint8)


def half(a):
    return a.astype(np.float64).reshape(1024,2,1024,2,*a.shape[2:]).mean(axis=(1,3))


def sample(a,x,y):
    x,y=np.broadcast_arrays(x,y)
    ix,iy=np.floor(x).astype(int),np.floor(y).astype(int)
    fx,fy=x-ix,y-iy
    if a.ndim==3:fx,fy=fx[...,None],fy[...,None]
    return ((1-fy)*((1-fx)*a[iy%a.shape[0],ix%a.shape[1]]+fx*a[iy%a.shape[0],(ix+1)%a.shape[1]])
            +fy*((1-fx)*a[(iy+1)%a.shape[0],ix%a.shape[1]]+fx*a[(iy+1)%a.shape[0],(ix+1)%a.shape[1]]))


def png_info(path):
    b=path.read_bytes()
    w,h,depth,kind=struct.unpack('>IIBB',b[16:26])
    i=8; chunks=[]
    while i<len(b):
        length=struct.unpack('>I',b[i:i+4])[0]
        chunks.append(b[i+4:i+8].decode('ascii'))
        i+=length+12
    return dict(size=[w,h],bit_depth=depth,colour_type=kind,
                chunks=sorted(set(chunks)),sha256=hashlib.sha256(b).hexdigest())


def rgb(a):
    a=np.asarray(a)
    if a.dtype==np.uint16 or a.max()>255:a=np.rint(a/257).astype(np.uint8)
    if a.ndim==2:a=np.repeat(a[:,:,None],3,2)
    return Image.fromarray(a.astype(np.uint8),'RGB')


def sheet(panels,path,cols=2,cell=(640,480),title=None):
    gap=16; label=46; top=58 if title else 0
    w,h=cell
    rows=(len(panels)+cols-1)//cols
    im=Image.new('RGB',(cols*(w+gap)+gap,rows*(h+label+gap)+gap+top),(24,27,29))
    d=ImageDraw.Draw(im)
    if title:d.text((gap,15),title,font=font(25),fill=(232,224,204))
    for i,(caption,p) in enumerate(panels):
        if not isinstance(p,Image.Image):p=rgb(p)
        p=p.copy();p.thumbnail((w,h),Image.Resampling.LANCZOS)
        x=gap+(i%cols)*(w+gap); y=gap+top+(i//cols)*(h+label+gap)
        d.text((x,y+7),caption,font=font(17),fill=(225,225,218))
        im.paste(p,(x+(w-p.width)//2,y+label+(h-p.height)//2))
    im.save(OUT/path,quality=95)
    return im


def cylinder(base,normal,orm,height):
    """Orthographic first-hit raymarch of the exported radial height field.

    24 mm core + ~3 mm cord relief gives ~30 mm outside diameter. Texture
    circumference uses nominal 15 mm radius and 200 mm UV units throughout.
    """
    w,h=600,900
    pxmm=12.
    X,Y=np.meshgrid((np.arange(w)+.5-w/2)/pxmm,
                    (h/2-np.arange(h)-.5)/pxmm)
    band=np.abs(Y)<=6*TILE_MM/56
    tex_y=(20/56-Y/TILE_MM)*N-.5
    h_mm=height.astype(np.float32)*HEIGHT_MM/65535
    bound=12+float(h_mm.max())+.05
    z=np.sqrt(np.maximum(bound*bound-X*X,0))+.05
    hit=np.zeros((h,w),bool)
    active=(np.abs(X)<bound)&band
    zhit=np.zeros_like(z)
    # First crossing, then eight bisections. It catches relief in the silhouette.
    for _ in range(100):
        theta=np.arctan2(X,z)
        tx=(.217+theta*15/TILE_MM)*N-.5
        target=12+sample(h_mm,tx,tex_y)
        inside=np.hypot(X,z)<=target
        new=active&(~hit)&inside&(z>=0)
        if new.any():
            low=z[new];high=low+.20
            xn=X[new];yn=tex_y[new]
            for _ in range(8):
                mid=(low+high)/2
                t=(.217+np.arctan2(xn,mid)*15/TILE_MM)*N-.5
                inm=np.hypot(xn,mid)<=12+sample(h_mm,t,yn)
                low=np.where(inm,mid,low);high=np.where(inm,high,mid)
            zhit[new]=(low+high)/2
            hit|=new
        z-=.20
        if np.all(hit|(~active)|(z<0)):break
    theta=np.arctan2(X,zhit)
    tx=(.217+theta*15/TILE_MM)*N-.5
    b=sample(base.astype(np.float32),tx,tex_y)
    nm=unit(sample(normal.astype(np.float32)/127.5-1,tx,tex_y))
    om=sample(orm.astype(np.float32),tx,tex_y)
    sine,cosine=np.sin(theta),np.cos(theta)
    world=unit(np.stack((nm[...,0]*cosine+nm[...,2]*sine,
                         nm[...,1],-nm[...,0]*sine+nm[...,2]*cosine),-1))
    # A simple authored brown substrate provides scale/context, not another asset.
    woodhit=(np.abs(X)<12)&(~band)
    woodz=np.sqrt(np.maximum(144-X*X,0))
    woodn=unit(np.stack((X,np.zeros_like(X),woodz),-1))
    grain=2*np.sin(X*6+.6*np.sin(Y*.25))+1.3*np.sin(X*17+Y*.07)
    wood=np.stack((103+grain,73+grain,46+grain*.8),-1)
    wom=np.zeros_like(wood);wom[...,0]=255;wom[...,1]=210
    renders=[]
    for light in LIGHTS:
        lit=shade(b,world,om,light)
        wl=shade(wood,woodn,wom,light)
        im=np.zeros_like(lit);im[:]=[28,32,35]
        im[hit]=lit[hit];im[woodhit]=wl[woodhit]
        renders.append(Image.fromarray(im))
    return renders


def main():
    started=time.perf_counter();OUT.mkdir(exist_ok=True)
    names=['base','height','normal','orm']
    maps={name:np.array(Image.open(ROOT/f'lashing_{name}.png')) for name in names}
    low={name:np.array(Image.open(ROOT/f'lashing_{name}_1024.png')) for name in names}
    metrics={'files':{},'normal':{},'downsample':{},'seams':{}}
    for name in names:
        for suffix,size in [('',2048),('_1024',1024)]:
            p=ROOT/f'lashing_{name}{suffix}.png';meta=png_info(p)
            metrics['files'][p.name]=meta
            assert meta['size']==[size,size]
            assert meta['bit_depth']==(16 if name=='height' else 8)
            assert meta['colour_type']==(0 if name=='height' else 2)
            if name=='base':assert 'sRGB' in meta['chunks']
            else:assert not set(meta['chunks'])&{'sRGB','gAMA','iCCP'}
        a=maps[name];b=low[name]
        reduced=half(a)
        rms=float(np.sqrt(np.mean((reduced-b)**2)))
        peak=65535 if name=='height' else 255
        psnr=20*np.log10(peak/max(rms,1e-12))
        metrics['downsample'][name]=dict(rms=rms,psnr_db=float(psnr),maximum_error=float(np.max(np.abs(reduced-b))))
        assert psnr>=30,(name,psnr)
        af=a.astype(np.float64)
        if name=='height':af*=HEIGHT_MM/65535
        out={}
        for axis,label in [(0,'top_bottom'),(1,'left_right')]:
            boundary=np.abs(np.take(af,0,axis=axis)-np.take(af,-1,axis=axis))
            interior=np.abs(np.diff(af,axis=axis))
            means=interior.mean(axis=tuple(k for k in range(interior.ndim) if k!=axis))
            out[label]=dict(wrap_mean=float(boundary.mean()),wrap_p95=float(np.percentile(boundary,95)),
                            interior_mean=float(interior.mean()),interior_line_p95=float(np.percentile(means,95)))
            assert boundary.mean()<=np.percentile(means,99)*1.35+.05,(name,label,out[label])
        metrics['seams'][name]=out
    for size,d in [(2048,maps),(1024,low)]:
        recomputed=normal_from_saved(d['height'])
        delta=np.abs(recomputed.astype(int)-d['normal'].astype(int))
        metrics['normal'][str(size)]=dict(maximum_byte_error=int(delta.max()),mismatched_channels=int(np.count_nonzero(delta)))
        assert delta.max()==0
        lengths=np.linalg.norm(d['normal'].astype(float)/127.5-1,axis=-1)
        metrics['normal'][str(size)]['maximum_unit_length_error']=float(np.max(np.abs(lengths-1)))
        assert np.all(d['normal'][:,:,2]>=128)
    base,height,normal,orm=[maps[n] for n in names]
    metrics['base_mean_srgb']=base.mean(axis=(0,1)).tolist()
    assert np.max(np.abs(base.mean(axis=(0,1))-[176,152,92]))<.1
    metrics['height_range_mm']=[float(height.min())*4/65535,float(height.max())*4/65535]
    metrics['roughness']={k:float(v/255) for k,v in zip(['min','median','max'],np.percentile(orm[:,:,1],[0,50,100]))}
    metrics['ao']={k:float(v/255) for k,v in zip(['min','median','max'],np.percentile(orm[:,:,0],[0,50,100]))}
    assert np.all(orm[:,:,2]==0)
    assert orm[:,:,1].min()/255>=.75 and orm[:,:,1].max()/255<=.95

    fields=np.load(ROOT/'source/construction_fields.npz')
    construction=json.loads((ROOT/'source/construction.json').read_text())
    centers=np.array([r['center_fraction'] for r in construction['rows']])*N-.5
    assert len(centers)==56
    assert np.max(np.abs(centers-((np.arange(56)+.5)*N/56-.5)))<1e-10
    # Recover macro ridge centres from the source profile by subpixel peak fits.
    body=fields['body_mm'];centroid_errors=[];ridge_peaks=[]
    for i,center in enumerate(centers):
        indices=np.flatnonzero(np.floor((np.arange(N)+.5)*56/N)==i)
        profile=body[indices].mean(axis=1)
        j=int(np.argmax(profile));absolute=indices[j]
        f0,f1,f2=profile[j-1:j+2]
        fitted=absolute+.5*(f0-f2)/(f0-2*f1+f2)
        centroid_errors.append(float(fitted-center));ridge_peaks.append(float(fitted))
    metrics['layout']=dict(turns=56,pitch_mm=200/56,pitch_pixels_2048=2048/56,
                           authored_center_max_error_px=0,
                           measured_macro_center_max_error_px=float(np.max(np.abs(centroid_errors))),
                           measured_macro_centers_px=ridge_peaks)
    assert np.max(np.abs(centroid_errors))<.08
    # Prove reconstruction alignment independently using the exported fields.
    reconstructed=np.rint((fields['body_mm']+fields['ply_mm']+fields['fibre_mm']+fields['hair_mm'])/4*65535).astype(np.uint16)
    assert np.array_equal(height,reconstructed)
    metrics['height_construction_mismatches']=int(np.count_nonzero(height!=reconstructed))
    # Evenness over 8x8 neighborhoods; there is no tile-wide lighting ramp.
    block=base.astype(float).reshape(8,256,8,256,3).mean(axis=(1,3))
    metrics['tone_block_mean_range_srgb']=[block.min(axis=(0,1)).tolist(),block.max(axis=(0,1)).tolist()]
    coords=(np.arange(N)+.5)/N-.5
    metrics['tone_linear_trend_bytes_per_tile']=dict(
        x=(np.mean(base.mean(axis=0)*coords[:,None],axis=0)/np.mean(coords**2)).tolist(),
        y=(np.mean(base.mean(axis=1)*coords[:,None],axis=0)/np.mean(coords**2)).tolist())

    nm=unit(normal.astype(np.float32)/127.5-1)
    lit=[shade(base,nm,orm,l) for l in LIGHTS]
    neutral=[shade(base,nm,orm,l,True) for l in LIGHTS]
    for i in range(2):
        Image.fromarray(lit[i]).save(OUT/f'lit_{i+1}.png')
        Image.fromarray(neutral[i]).save(OUT/f'neutral_{i+1}.png')
    sheet([(n,rgb(maps[n])) for n in names], 'layers_contact.png',4,(512,512),
          'LASHING / 200 mm tile / 56 hand-twisted turns')
    offsets={name:np.roll(maps[name],(1024,1024),(0,1)) for name in names}
    for name,a in offsets.items():rgb(a).save(OUT/f'offset_{name}.png')
    sheet([(n+' / half-tile offset',rgb(offsets[n])) for n in names],
          'offsets_contact.jpg',4,(512,512))
    box=(144,440,912,952)
    crop=lambda a:rgb(a).crop(box)
    sheet([(n+' / native 768 x 512 crop',crop(maps[n])) for n in names]
          + [('Light A / native',crop(lit[0])),('Light B / native',crop(lit[1])),
             ('Neutral relief A / native',crop(neutral[0])),('Neutral relief B / native',crop(neutral[1]))],
          'native_detail.png',2,(768,512),'One texel per pixel / relief and fibre detail')
    for i in range(2):crop(lit[i]).save(OUT/f'native_lit_{i+1}.png')
    sheet([('Light A / upper left',lit[0]),('Light B / lower right',lit[1]),
           ('Neutral pigment / A',neutral[0]),('Neutral pigment / B',neutral[1])],
          'relighting.jpg',2,(768,768))
    # Native 3x3 repeats are retained; reduced versions make repetition easy to see.
    tiled=[]
    for name,a in [('base',base),('lit',lit[0])]:
        repeat=Image.new('RGB',(6144,6144))
        tile=rgb(a)
        for y in range(3):
            for x in range(3):repeat.paste(tile,(x*N,y*N))
        repeat.save(OUT/f'{name}_3x3_native.jpg',quality=95,subsampling=0)
        small=repeat.resize((1536,1536),Image.Resampling.LANCZOS)
        small.save(OUT/f'{name}_3x3_small.jpg',quality=95)
        tiled.append(small)
    sheet([('Unlit / 3 x 3 / 600 mm',tiled[0]),('Lit / 3 x 3 / 600 mm',tiled[1])],
          'tiling_contact.jpg',2,(768,768))
    # Both original borders pass through the centre of this native intersection.
    seam_panels=[]
    for name,a in [('base',base),('normal',normal),('light A',lit[0]),('light B',lit[1])]:
        wrapped=np.roll(a,(1024,1024),(0,1))
        seam_panels.append((name+' / original seams at centre',rgb(wrapped).crop((640,768,1408,1280))))
    sheet(seam_panels,'native_seams.png',2,(768,512))
    overlay=crop(lit[0]);draw=ImageDraw.Draw(overlay)
    for i,c in enumerate(centers):
        y=c-box[1]
        if 0<=y<overlay.height:
            draw.line((0,y,overlay.width,y),fill=(73,219,214),width=1)
            draw.text((5,y-18),str(i+1),font=font(13),fill=(245,255,255))
    sheet([('Cyan = exact turn midlines',overlay),('Same crop / no overlay',crop(lit[0]))],
          'turn_alignment.png',2,(768,512))
    cyl=cylinder(base,normal,orm,height)
    for i,im in enumerate(cyl):im.save(OUT/f'cylinder_{i+1}.png')
    sheet([('30 mm outer diameter / light A',cyl[0]),('30 mm outer diameter / light B',cyl[1])],
          'cylinder_contact.png',2,(600,900),'Height-displaced wrap / 12 turns / 42.86 mm band')
    # Actual screen-size views are deliberately not enlarged.
    scale_canvas=Image.new('RGB',(900,430),(24,27,29));d=ImageDraw.Draw(scale_canvas)
    x=25
    for w in [60,100,140]:
        target=cyl[0].crop((113,140,487,760)).resize((w,round(w*620/374)),Image.Resampling.LANCZOS)
        scale_canvas.paste(target,(x,75))
        d.text((x,35),f'~{w} px across',font=font(16),fill=(235,228,209))
        x+=190
    icon=cyl[0].resize((43,64),Image.Resampling.LANCZOS)
    scale_canvas.paste(icon,(660,75))
    d.text((640,35),'64 px inventory',font=font(16),fill=(235,228,209))
    d.text((25,330),'Same displaced cylinder at actual output sizes; no sharpening.',font=font(18),fill=(205,208,207))
    scale_canvas.save(OUT/'screen_sizes.png')
    # Extra native detail compared with an enlargement of the delivered 1024.
    up=Image.open(ROOT/'lashing_base_1024.png').resize((2048,2048),Image.Resampling.BICUBIC)
    residual=base.astype(float)-np.asarray(up,dtype=float)
    metrics['native_base_residual_vs_enlarged_1024_rms']=float(np.sqrt(np.mean(residual**2)))
    sheet([('Native 2048 pigment',crop(base)),('1024 enlarged / bicubic',up.crop(box))],
          'native_vs_upscaled.png',2,(768,512))
    down_panels=[]
    for name in ['base','height','normal']:
        ref=half(maps[name])
        if name=='height':ref=np.rint(ref).astype(np.uint16)
        else:ref=np.rint(ref).astype(np.uint8)
        down_panels += [(name+' / 2048 area-reduced',rgb(ref).crop((64,256,576,768))),
                        (f'{name} / delivered 1024 / {metrics["downsample"][name]["psnr_db"]:.2f} dB',
                         rgb(low[name]).crop((64,256,576,768)))]
    down_sheet=sheet(down_panels,'downsample_comparison.png',2,(512,512),
                     'Area reduction vs delivered 1024 / all maps exceed 30 dB')
    ao_preview=rgb(orm[:,:,0]);rough_preview=rgb(orm[:,:,1])
    sheet([('Unlit base / exact mean 176, 152, 92',base),('Physical height / full range 0-4 mm',height),
           ('OpenGL tangent normal',normal),('ORM / R:AO G:rough B:0',orm),
           ('Upper-left light / native crop',crop(lit[0])),('Lower-right light / native crop',crop(lit[1])),
           ('Original seams / native intersection',seam_panels[2][1]),('56 midlines / native crop',overlay),
           ('3 x 3 repeat / 600 mm',tiled[1]),('30 mm displaced wrap / light A',cyl[0]),
           ('30 mm displaced wrap / light B',cyl[1]),('Actual screen sizes',scale_canvas),
           ('Half-tile offset / unlit pigment',offsets['base']),('1024 reduction comparison',down_sheet),
           ('Ambient occlusion / geometry only',ao_preview),('Roughness / matte fibre',rough_preview)],
          'contact_sheet.jpg',4,(520,520),'LASHING / material review / native procedural plant fibre')
    metrics['check_seconds']=round(time.perf_counter()-started,2)
    if '--rebuild' in sys.argv:
        original={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(ROOT.glob('lashing*.png'))}
        subprocess.run([sys.executable,str(ROOT/'build_material.py')],cwd=ROOT,check=True)
        after={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(ROOT.glob('lashing*.png'))}
        assert original==after,'Rebuild changed delivered pixels or PNG encoding'
        metrics['rebuild']={'all_eight_pngs_byte_identical':True,'sha256':after}
    metrics['all_checks_passed']=True
    (OUT/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
    print(json.dumps({k:v for k,v in metrics.items() if k not in ['files','seams']},indent=2))


if __name__=='__main__':main()
