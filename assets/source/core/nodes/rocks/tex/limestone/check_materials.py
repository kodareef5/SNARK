#!/usr/bin/env python3
"""Independent checks of the saved PNGs, plus wrap and relighting proof sheets."""
from pathlib import Path
import hashlib,json,struct,time
import numpy as np
from PIL import Image,ImageDraw,ImageFont
from scipy.ndimage import convolve1d,gaussian_filter

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'checks'
OUT.mkdir(exist_ok=True)
N=2048
PITCH=1500/N
FONT_PATH=Path('/System/Library/Fonts/Supplemental/Arial.ttf')
FONT=ImageFont.truetype(str(FONT_PATH),21) if FONT_PATH.exists() else ImageFont.load_default(size=21)
SMALL=ImageFont.truetype(str(FONT_PATH),16) if FONT_PATH.exists() else ImageFont.load_default(size=16)
METRICS={"dimensions":[N,N],"pitch_mm":PITCH,"height_white_mm":40,"materials":{},"files":{},"assertions":[]}


def check(truth,msg):
    METRICS['assertions'].append({'pass':bool(truth),'check':msg})


def rgb(a):
    if a.ndim==2:return np.repeat(a[:,:,None],3,axis=2)
    return a


def u8(a):return np.clip(np.rint(a),0,255).astype('uint8')


def panel(a,title,size=None):
    im=Image.fromarray(u8(rgb(a)))
    if size:im=im.resize(size,Image.Resampling.LANCZOS)
    c=Image.new('RGB',(im.width,im.height+38),(26,28,28))
    c.paste(im,(0,38))
    draw=ImageDraw.Draw(c)
    font=FONT if draw.textlength(title,font=FONT)<=im.width-24 else SMALL
    draw.text((12,8),title,font=font,fill=(230,227,215))
    return c


def sheet(items,cols,path):
    w=max(i.width for i in items);h=max(i.height for i in items)
    im=Image.new('RGB',(w*cols,h*((len(items)+cols-1)//cols)),(26,28,28))
    for n,i in enumerate(items):im.paste(i,((n%cols)*w,(n//cols)*h))
    im.save(path,quality=94,subsampling=0)
    return im


def linear(a):
    a=a/255
    return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)


def srgb(a):
    a=np.maximum(a,0)
    return np.where(a<=.0031308,a*12.92,1.055*a**(1/2.4)-.055)*255


def relight(base,normal,azimuth):
    t=np.deg2rad(azimuth)
    # +Y is image-up. The four directions have the same elevation and energy.
    light=np.array([np.cos(t)*.78,np.sin(t)*.78,.6258])
    light/=np.linalg.norm(light)
    lambert=np.maximum((normal*light).sum(2),0)
    return u8(srgb(linear(base)*(.27+.98*lambert[:,:,None])))


def wrap_stats(a):
    a=a.astype(np.float32)
    dx=np.abs(a-np.roll(a,1,1));dy=np.abs(a-np.roll(a,1,0))
    edge_x=float(dx[:,0].mean());edge_y=float(dy[0].mean())
    axes_x=(0,2) if a.ndim==3 else (0,)
    axes_y=(1,2) if a.ndim==3 else (1,)
    interior_x=float(np.percentile(dx[:,1:].mean(axis=axes_x),95))
    interior_y=float(np.percentile(dy[1:].mean(axis=axes_y),95))
    return {'wrap_mean_x':edge_x,'wrap_mean_y':edge_y,'interior_line_p95_x':interior_x,'interior_line_p95_y':interior_y,'ratio_x':edge_x/(interior_x+1e-9),'ratio_y':edge_y/(interior_y+1e-9)}


def main():
    t=time.perf_counter()
    metadata=json.loads((ROOT/'build_metadata.json').read_text())
    sources=json.loads((ROOT/'source/manifest.json').read_text())
    for name,record in sources.items():
        check(hashlib.sha256((ROOT/'source'/name).read_bytes()).hexdigest()==record['sha256'],
              f'{name}: original generated source preserved')
    check(not list(ROOT.glob('*_derivation.npz')),'delivery: no rebuildable intermediate arrays retained')
    preserved=json.loads((ROOT/'preserved_round1.json').read_text())
    for name,sha in preserved.items():
        check(hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==sha,
              f'{name}: accepted crust or weathered relief preserved byte-for-byte')
    all_layers=[];all_offset=[];all_tiles=[];all_lit=[];detail=[]
    variants={}
    for name in ['weathered','fresh']:
        bases=[name]+(['weathered_crust'] if name=='weathered' else [])
        layers={}
        for role in ['base','height','normal','rough']:
            path=ROOT/f'{name}_{role}.png'
            im=Image.open(path)
            a=np.asarray(im)
            layers[role]=a.astype(np.float32)
            # Inspect the actual PNG IHDR, not Pillow's promoted in-memory dtype.
            ihdr=struct.unpack('>IIBBBBB',path.read_bytes()[16:29])
            check(im.size==(N,N),f'{path.name}: 2048 square')
            check(ihdr[2:4]==((16,0) if role=='height' else (8,0) if role=='rough' else (8,2)),f'{path.name}: correct PNG bit depth and colour type')
            check(bool(im.info.get('icc_profile'))==(role=='base'),f'{path.name}: correct colour/data profile')
            if role=='height':layers[role]*=40/65535
            s=wrap_stats(layers[role])
            check(s['ratio_x']<1.20 and s['ratio_y']<1.20,f'{path.name}: wrap difference below 1.20 × interior line p95')
            METRICS['files'][path.name]={'png_ihdr':list(ihdr),'wrap':s,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
        h=layers['height']
        # Independent stencil implementation: convolution flips its kernel.
        gx=convolve1d(h,np.array([1,0,-1],np.float32)/(2*PITCH),axis=1,mode='wrap')
        gy=convolve1d(h,np.array([1,0,-1],np.float32)/(2*PITCH),axis=0,mode='wrap')
        reference=np.stack([-gx,gy,np.ones_like(h)],2)
        reference/=np.linalg.norm(reference,axis=2,keepdims=True)
        normal=layers['normal']/127.5-1
        raw_lengths=np.linalg.norm(normal,axis=2)
        normal/=raw_lengths[:,:,None]
        errors=np.rad2deg(np.arccos(np.clip((normal*reference).sum(2),-1,1)))
        check(float(errors.max())<.45,f'{name}: normal from full saved height, including OpenGL Y sign')
        check(h.min()>0 and h.max()<40,f'{name}: no height clipping at either end')
        rough=layers['rough']/255
        check(rough.min()>=.8 and rough.max()<=1,f'{name}: roughness in [0.8, 1.0]')
        # Derivation arrays stay in memory during the build. Check the delivered
        # maps independently; retain only the build's tiny quantization summary.
        quant_error=metadata[name]['height_quantization_max_mm']
        check(quant_error<=40/65535*.501,f'{name}: authoring quantization below half a 16-bit step')
        depression=gaussian_filter(h,4,mode='wrap')-h
        deep=(h<np.percentile(h,12))&(depression>.6)
        ridge=(h>np.percentile(h,70))&(depression<.1)
        b=layers['base']
        luminance=b[:,:,0]*.2126+b[:,:,1]*.7152+b[:,:,2]*.0722
        pore_ratio=float(luminance[deep].mean()/luminance[ridge].mean())
        # Relief-linked pigment must remain visible even without normal lighting.
        if name=='weathered':
            check(.68<pore_ratio<.83,'weathered: deep pores about one quarter darker than exposed ridges in unlit colour')
        else:
            highpass=luminance-gaussian_filter(luminance,1.6,mode='wrap')
            check(float(highpass.std())>3,'fresh: visible native-scale mineral colour grain')
            jump=np.maximum(np.abs(np.roll(h,1,0)-np.roll(h,-1,0)),np.abs(np.roll(h,1,1)-np.roll(h,-1,1)))
            check(float(np.percentile(jump,99.8))>3,'fresh: sharp millimetre fracture steps survive the saved height')
        slope=np.sqrt(gx*gx+gy*gy)
        anisotropy=float(np.sqrt((gx*gx).mean()/(gy*gy).mean()))
        check(.85<anisotropy<1.15,f'{name}: no preferred relief axis (RMS X/Y within 15 percent)')
        stats={'height_mm':{'min':float(h.min()),'max':float(h.max()),'mean':float(h.mean()),'percentiles':np.percentile(h,[1,5,50,95,99]).tolist()},'normal_error_degrees':{'mean':float(errors.mean()),'max':float(errors.max())},'normal_unit_length_max_error':float(np.abs(raw_lengths-1).max()),'slope_rms_x_y':[float(np.sqrt((gx*gx).mean())),float(np.sqrt((gy*gy).mean()))],'roughness':{'min':float(rough.min()),'mean':float(rough.mean()),'max':float(rough.max())},'native_height_quantization_max_mm':quant_error,'cavity_fraction_over_half':metadata[name]['pore_fraction_over_half'],'slope_percentiles':np.percentile(slope,[50,90,99]).tolist(),
               'unlit_pore_to_ridge_luma_ratio':pore_ratio,
               'unlit_pore_mean_rgb':layers['base'][deep].mean(0,dtype=np.float64).tolist(),
               'unlit_ridge_mean_rgb':layers['base'][ridge].mean(0,dtype=np.float64).tolist()}
        if name=='fresh':
            stats['grain_highpass_std']=float(highpass.std())
            stats['two_pixel_height_jump_percentiles_mm']=np.percentile(jump,[95,99,99.8,100]).tolist()
        METRICS['materials'][name]=stats
        normals_visual=layers['normal']
        roles=[('base',layers['base']),('height / fixed 0–40 mm',h/40*255),('normal / OpenGL',normals_visual),('rough / linear',layers['rough'])]
        if name=='weathered':
            for extra in ['weathered_crust_base','weathered_crust_rough']:
                p=ROOT/(extra+'.png');im=Image.open(p);a=np.asarray(im,dtype=np.float32)
                s=wrap_stats(a)
                ih=struct.unpack('>IIBBBBB',p.read_bytes()[16:29])
                role=extra.split('_')[-1]
                check(im.size==(N,N) and ih[2:4]==((8,2) if role=='base' else (8,0)),f'{extra}: dimensions and bit depth')
                check(bool(im.info.get('icc_profile'))==(role=='base'),f'{extra}: correct colour/data profile')
                check(s['ratio_x']<1.2 and s['ratio_y']<1.2,f'{extra}: wrap continuity')
                METRICS['files'][p.name]={'wrap':s,'png_ihdr':list(ih),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
                roles.append((extra,a))
            cr=np.asarray(Image.open(ROOT/'weathered_crust_rough.png'),dtype=np.float32)/255
            check(cr.min()>=.8 and np.all(cr<=rough+1/255), 'crust: roughness is lower only, within physical range')
            stats['crust_roughness']={'min':float(cr.min()),'mean':float(cr.mean()),'max':float(cr.max())}
            stats['crust_point_roughness_drop']=metadata[name]['crust_point_roughness_drop']
        for role,a in roles:
            all_layers.append(panel(a,name+' — '+role,(512,512)))
            all_offset.append(panel(np.roll(a,(N//2,N//2),(0,1)),name+' — '+role+' | half offset',(512,512)))
        for variant in bases:
            d=OUT/variant;d.mkdir(exist_ok=True)
            base=np.asarray(Image.open(ROOT/(variant+'_base.png')),dtype=np.float32)
            variants[variant]=(base,normal)
            target={'weathered':[196,178,140],'weathered_crust':[120,116,106],'fresh':[222,208,176]}[variant]
            mean=base.mean((0,1),dtype=np.float64)
            check(np.max(np.abs(mean-target))<.1,f'{variant}: mean colour matches requested target')
            blocks=base.reshape(8,256,8,256,3).mean((1,3))
            colour_stats={'mean_srgb':mean.tolist(),'std_srgb':base.std((0,1),dtype=np.float64).tolist(),'256px_block_mean_channel_range':(blocks.max((0,1))-blocks.min((0,1))).tolist(),'base_gradient_height_gradient_correlation_x':float(np.corrcoef(np.diff(base.mean(2),axis=1).ravel(),gx[:,:-1].ravel())[0,1])}
            METRICS['materials'][variant]=dict(METRICS['materials'].get(variant,{}),**colour_stats)
            # A native half-resolution 3x3 is kept per base; summary is smaller.
            tile=np.asarray(Image.fromarray(u8(base)).resize((1024,1024),Image.Resampling.LANCZOS))
            tiled=np.tile(tile,(3,3,1))
            Image.fromarray(tiled).save(d/'tiled3x3.jpg',quality=94,subsampling=0)
            all_tiles.append(panel(tiled,variant+' — 3 × 3 | 4.5 m square',(1536,1536)))
            lit=relight(base,normal,90)
            all_lit.append(panel(lit,variant+' — full tile, top light',(1024,1024)))
            detail.append(panel(base[720:1232,720:1232],variant+' — unlit 375 mm crop'))
            detail.append(panel(lit[720:1232,720:1232],variant+' — relit same crop'))
    sheet(all_layers,4,OUT/'layers.jpg')
    sheet(all_offset,4,OUT/'offset.jpg')
    sheet(all_tiles,3,OUT/'tiled3x3.jpg')
    sheet(all_lit,3,OUT/'relit_overview.jpg')
    # Four directions for all three colours; 768 px crops keep pores several pixels wide.
    expanded=[]
    for name,(base,normal) in variants.items():
        for az,label in [(0,'right'),(90,'top'),(180,'left'),(270,'bottom')]:
            expanded.append(panel(relight(base,normal,az)[640:1408,640:1408],name+' | '+label+' light'))
    sheet(expanded,4,OUT/'relit.jpg')
    sheet(detail,2,OUT/'detail.jpg')
    # Find the sparse small fossils, rather than relying on a chance central crop.
    inclusions=[]
    sections=json.loads((ROOT/'build_metadata.json').read_text())['fresh_sections']
    fb,fn=variants['fresh']
    fl=relight(fb,fn,60)
    fh=np.asarray(Image.open(ROOT/'fresh_height.png'),dtype=np.float32)/65535*40
    for section in sections[:3]:
        cx=section['x']+int(section['width_mm']/PITCH/2)
        cy=section['y']+int(section['width_mm']/PITCH/2)
        ix=(np.arange(96)+cx-48)%N;iy=(np.arange(96)+cy-48)%N
        for title,a in [('unlit',fb),('height: 0–40 mm',fh/40*255),('relit',fl)]:
            inclusions.append(panel(a[np.ix_(iy,ix)],section['kind']+' | '+title,(384,384)))
    sheet(inclusions,3,OUT/'inclusions.jpg')
    clean,norm=variants['weathered'];crust,_=variants['weathered_crust']
    yy,xx=np.indices((N,N),dtype=np.float32)
    mask=.5+.5*np.sin(2*np.pi*(xx/N)+.62*np.sin(2*np.pi*yy/N))
    # Blend in linear light, as a shader should with decoded sRGB textures.
    blended=srgb(linear(clean)*(1-mask[:,:,None])+linear(crust)*mask[:,:,None])
    sheet([panel(clean,'clean',(768,768)),panel(mask*255,'soft periodic mask',(768,768)),panel(crust,'crust',(768,768)),panel(blended,'blend — unlit',(768,768)),panel(relight(blended,norm,45),'blend — relit NE',(768,768)),panel(relight(blended,norm,225),'blend — relit SW',(768,768))],3,OUT/'blend.jpg')
    # No independently generated crust relief exists: shared normal is byte-identical.
    METRICS['crust_registration']={'shared_height':'weathered_height.png','shared_normal':'weathered_normal.png','separate_displacement':False,'blend_space':'linear-light RGB','crust_rough_optional':True}
    METRICS['check_seconds']=round(time.perf_counter()-t,2)
    (OUT/'metrics.json').write_text(json.dumps(METRICS,indent=2)+'\n')
    failed=[a['check'] for a in METRICS['assertions'] if not a['pass']]
    report='\n'.join(('PASS ' if a['pass'] else 'FAIL ')+a['check'] for a in METRICS['assertions'])+'\n'
    report+=f'\n{len(METRICS["assertions"])-len(failed)}/{len(METRICS["assertions"])} passed. {METRICS["check_seconds"]} seconds.\n'
    (OUT/'validation.txt').write_text(report)
    manifest={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(ROOT.glob('*.png'))}
    (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(report)
    if failed:raise SystemExit(1)

if __name__=='__main__':main()
