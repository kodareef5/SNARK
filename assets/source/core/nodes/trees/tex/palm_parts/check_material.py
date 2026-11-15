"""Independent saved-file validation and review renders for the palm-parts atlas.

No generation service or build-module functions are used. Failure exits nonzero.
Optional --rebuild also verifies byte-identical rebuilding of the existing PNGs.
"""
from pathlib import Path
import hashlib
import json
import math
import struct
import subprocess
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
CHECK = ROOT/'checks'
CHECK.mkdir(exist_ok=True)
META = json.loads((ROOT/'material.json').read_text())
LAYOUT = json.loads((ROOT/'guide/LAYOUT.json').read_text())
FILES = {k:ROOT/f'palm_parts_{k}.png' for k in ('base','height','normal','orm')}
IMAGES = {k:Image.open(p) for k,p in FILES.items()}
DATA = {k:np.asarray(im) for k,im in IMAGES.items()}
METRICS = {'checks':{}, 'files':{}, 'regions':{}, 'wrapping':{}, 'normal_height_agreement':{}}
FAILURES = []


def expect(key, condition, detail=None):
    METRICS['checks'][key] = {'pass':bool(condition), 'detail':detail}
    if not condition:
        FAILURES.append(key)


def font(size):
    for p in ('/System/Library/Fonts/Supplemental/Arial.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
        if Path(p).exists():
            return ImageFont.truetype(p,size)
    return ImageFont.load_default()


def panel(im, label, width):
    im = im.convert('RGB')
    ht = round(im.height*width/im.width)
    out = Image.new('RGB',(width,ht+36),(25,28,27))
    out.paste(im.resize((width,ht),Image.Resampling.LANCZOS),(0,36))
    ImageDraw.Draw(out).text((12,8),label,fill=(230,233,226),font=font(17))
    return out


def preview_array(name, a):
    if name == 'height':
        return Image.fromarray(np.uint8(np.rint(a.astype(float)/65535*255))).convert('RGB')
    return Image.fromarray(a).convert('RGB')


def stats(a):
    return {key:float(val) for key,val in {'min':a.min(),'mean':a.mean(),'p95':np.percentile(a,95),'max':a.max()}.items()}


def seam_stats(a, units):
    if a.ndim==2:
        a=a[...,None]
    a=a.astype(float)
    seam=np.abs(a[:,0]-a[:,-1])
    interior=np.abs(a[:,25:-25]-a[:,24:-26])
    colmean=interior.mean((0,2))
    # Check the nearby border strip as well as the single wrap difference.
    shoulder=np.concatenate([np.abs(np.diff(a[:,4:26],axis=1)),np.abs(np.diff(a[:,-26:-4],axis=1))],axis=1)
    return {'units':units,'wrap_absolute_difference':stats(seam),
            'interior_adjacent_absolute_difference':stats(interior),
            'interior_column_mean_p95':float(np.percentile(colmean,95)),
            'guard_shoulder_absolute_difference':stats(shoulder),
            'wrap_mean_over_interior_mean':float(seam.mean()/max(interior.mean(),1e-12)),
            'shoulder_mean_over_interior_mean':float(shoulder.mean()/max(interior.mean(),1e-12))}


def expected_normal(h,u,v,wrap):
    # Independent stencil: padded neighbor arrays, not the builder's roll routine.
    dx_m=u/h.shape[1]
    dy_m=v/h.shape[0]
    hp=np.pad(h,((0,0),(1,1)),mode='wrap' if wrap else 'edge')
    du=(hp[:,2:]-hp[:,:-2])/(2*dx_m)
    if not wrap:
        du[:,0]=(h[:,1]-h[:,0])/dx_m
        du[:,-1]=(h[:,-1]-h[:,-2])/dx_m
    dv=np.empty_like(h)
    dv[1:-1]=(h[2:]-h[:-2])/(2*dy_m)
    dv[0]=(h[1]-h[0])/dy_m
    dv[-1]=(h[-1]-h[-2])/dy_m
    n=np.dstack((-du,dv,np.ones_like(h)))
    return n/np.sqrt(np.sum(n*n,axis=2))[...,None]


def srgb_to_linear(x):
    return np.where(x<=.04045,x/12.92,((x+.055)/1.055)**2.4)


def linear_to_srgb(x):
    x=np.clip(x,0,1)
    return np.where(x<=.0031308,x*12.92,1.055*x**(1/2.4)-.055)


def light_preview(base, normals, rough, ao, light, grey=False):
    """Simple GGX directional diagnostic, no engine or baked lighting in assets."""
    light=np.array(light,dtype=float)
    light/=np.linalg.norm(light)
    view=np.array([0.,0.,1.])
    half=(light+view)/np.linalg.norm(light+view)
    nl=np.clip(np.sum(normals*light,axis=2),0,1)
    nv=np.clip(normals[...,2],1e-4,1)
    nh=np.clip(np.sum(normals*half,axis=2),0,1)
    vh=float(view@half)
    a2=rough**4
    D=a2/(np.pi*(nh**2*(a2-1)+1)**2+1e-8)
    k=(rough+1)**2/8
    G=(nl/(nl*(1-k)+k+1e-8))*(nv/(nv*(1-k)+k+1e-8))
    F=.04+.96*(1-vh)**5
    spec=D*G*F/(4*nl*nv+1e-6)
    color=np.full_like(base,.38,dtype=float) if grey else srgb_to_linear(base/255.)
    result=color*(.22*ao[...,None]+.85*nl[...,None])+spec[...,None]*nl[...,None]*.65
    return Image.fromarray(np.uint8(np.rint(linear_to_srgb(result)*255)))


def check():
    for name,p in FILES.items():
        content=p.read_bytes()
        w,h,depth,ctype=struct.unpack('>IIBB',content[16:26])
        info=IMAGES[name].info
        METRICS['files'][name]={'file':p.name,'size':[w,h],'png_bit_depth':depth,
                              'png_color_type':ctype,'mode':IMAGES[name].mode,
                              'sha256':hashlib.sha256(content).hexdigest(),'icc_profile':bool(info.get('icc_profile'))}
        expect(name+'_dimensions',w==2048 and h==2048)
        expect(name+'_format',(depth,ctype)==((16,0) if name=='height' else (8,2)))
        expect(name+'_color_encoding',bool(info.get('icc_profile'))==(name=='base') and
               (name=='base' or ('srgb' not in info and 'gamma' not in info)))
    expect('zero_metalness',np.count_nonzero(DATA['orm'][...,2])==0)
    expect('height_full_range_mm',META['height_range_mm']==16)
    coverage=np.zeros((2048,2048),np.uint8)
    allangles=[]
    H=DATA['height'].astype(float)/65535*META['height_range_mm']*.001
    N=DATA['normal'].astype(float)/255*2-1
    nlen=np.linalg.norm(N,axis=2)
    N/=nlen[...,None]
    METRICS['normal_vector_length']=stats(nlen)
    expect('normal_lengths',float(np.max(np.abs(nlen-1)))<.008)
    expect('normal_positive_z',np.all(N[...,2]>0))
    for name,p in META['patches'].items():
        x0,y0,x1,y1=p['rect']
        coverage[y0:y1,x0:x1]+=1
        h=H[y0:y1,x0:x1]
        n=N[y0:y1,x0:x1]
        u,v=p['coverage_m']
        exp=expected_normal(h,u,v,p['wrap_u'])
        angle=np.degrees(np.arccos(np.clip(np.sum(n*exp,axis=2),-1,1)))
        allangles.append(angle.ravel())
        METRICS['normal_height_agreement'][name]=stats(angle)
        expect(name+'_normal_agreement',angle.max()<.4)
        expect(name+'_normal_sign',np.mean(n[...,1]*exp[...,1])>=-1e-7)
        pix=DATA['base'][y0:y1,x0:x1]
        rough=DATA['orm'][y0:y1,x0:x1,1]/255.
        METRICS['regions'][name]={'rect':p['rect'],'coverage_m':[u,v],
                                 'height_mm':stats(h*1000),'roughness':stats(rough),
                                 'base_rgb_mean':pix.mean((0,1)).tolist()}
        if name in ('crownshaft','sheath','cut','root','stalk'):
            lr=LAYOUT['regions'][name]
            expect(name+'_layout',[lr[k] for k in ('x0','y0','x1','y1')]==p['rect'])
        if p['wrap_u']:
            METRICS['wrapping'][name]={}
            for layer,a in DATA.items():
                crop=a[y0:y1,x0:x1]
                unit='8-bit code values' if layer!='height' else 'millimetres'
                measured=crop if layer!='height' else crop.astype(float)/65535*16
                ms=seam_stats(measured,unit)
                METRICS['wrapping'][name][layer]=ms
                expect(name+'_'+layer+'_wrap',ms['wrap_absolute_difference']['mean']<=ms['interior_column_mean_p95']*1.15)
                expect(name+'_'+layer+'_shoulder',ms['shoulder_mean_over_interior_mean']<3)
                tiled=preview_array(layer,np.concatenate((crop,crop),axis=1))
                if layer in ('base','normal'):
                    tiled.save(CHECK/f'{name}_{layer}_tile2x.png')
            # Three useful views at the same coordinates, including the atlas wrap.
            crops=[]
            for layer in ('base','normal','orm'):
                crop=DATA[layer][y0:y1,x0:x1]
                crops.append(panel(preview_array(layer,np.concatenate((crop,crop),axis=1)),layer,1024))
            out=Image.new('RGB',(1024,sum(i.height for i in crops)),(25,28,27))
            pos=0
            for im in crops:
                out.paste(im,(0,pos)); pos+=im.height
            out.save(CHECK/f'{name}_wrap_layers.jpg',quality=94)
        # All islands receive four solid-material rows, including the nut splits.
        for layer in ('base','height','orm'):
            a=DATA[layer][y0:y1,x0:x1]
            expect(name+'_'+layer+'_vertical_guard',
                   np.all(a[:4]==a[4:5]) and np.all(a[-4:]==a[-5:-4]))
        if name=='crownshaft':
            expect('crownshaft_green_roughness',rough[:985].min()>=.247 and rough[:985].max()<=.353)
            expect('crownshaft_bottom_grey',np.max(np.ptp(pix[-8:].mean((0,1))))<20)
        elif name in ('nut_green','nut_yellow'):
            expect(name+'_roughness',rough.min()>=.398 and rough.max()<=.602)
        elif name not in ('sheath',):
            expect(name+'_roughness',rough.min()>=.798 and rough.max()<=.902)
    expect('pixel_exact_partition',np.all(coverage==1))
    allangles=np.concatenate(allangles)
    METRICS['normal_height_agreement']['all_degrees']=stats(allangles)
    # A synthetic height increasing toward image-bottom must point green toward top.
    ramp=np.tile(np.arange(12,dtype=float)[:,None],(1,12))*.0001
    test=expected_normal(ramp,1,1,False)
    expect('OpenGL_green_sign_ramp',np.all(test[...,1]>0))
    expect('frozen_source_hashes',all(hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==h
                                    for p,h in META['source_files'].items()))
    # Region-specific, geometric checks independent of source colour.
    deriv=np.load(ROOT/'derivation.npz')
    disc=deriv['cut_disc_mask']>.5
    inner=deriv['cut_interior_mask']>.5
    equivalent_diameter=2*np.sqrt(disc.sum()/np.pi)
    rim_mm=(np.sqrt(disc.sum()/np.pi)-np.sqrt(inner.sum()/np.pi))*(.6875/1024)*1000
    METRICS['cut_geometry']={'equivalent_disc_diameter_pixels':float(equivalent_diameter),
                             'width_fraction':float(equivalent_diameter/1024),'mean_rim_mm':float(rim_mm)}
    expect('cut_80_percent',abs(equivalent_diameter/1024-.8)<.005)
    expect('cut_bark_rim_20_to_30_mm',20<=rim_mm<=30)

    # Contact sheet: the height panel is displayed as 8-bit only for this review.
    panels=[panel(preview_array(k,DATA[k]),label,768) for k,label in
            [('base','BASE / sRGB'),('height','HEIGHT / 0-16 mm'),
             ('normal','NORMAL / OpenGL'),('orm','ORM / linear RGB')]]
    contact=Image.new('RGB',(1536,2*804),(25,28,27))
    for i,im in enumerate(panels): contact.paste(im,((i%2)*768,(i//2)*804))
    contact.save(CHECK/'layers.jpg',quality=95)
    # Actual supplied layout is visible beneath a 78% base-colour overlay.
    layout=Image.open(ROOT/'guide/layout.png').convert('RGB')
    overlay=Image.blend(layout,IMAGES['base'].convert('RGB'),.78)
    d=ImageDraw.Draw(overlay)
    for name,p in META['patches'].items():
        x0,y0,x1,y1=p['rect']
        d.rectangle((x0,y0,x1-1,y1-1),outline=(245,245,237),width=3)
        d.rectangle((x0+9,y0+9,x0+285,y0+41),fill=(25,28,27))
        d.text((x0+17,y0+14),name,fill=(245,245,237),font=font(20))
    d.ellipse((102.4,1126.4,921.6,1945.6),outline=(246,240,218),width=2)
    overlay.save(CHECK/'base_over_layout.png')
    # Opposite lighting on the cut, also in neutral grey to isolate height response.
    n=N[1024:2048,:1024]; b=DATA['base'][1024:2048,:1024]
    rough=DATA['orm'][1024:2048,:1024,1]/255.; ao=DATA['orm'][1024:2048,:1024,0]/255.
    lights=[(-.65,.55,.60),(.65,-.55,.60)]
    shots=[]
    for i,light in enumerate(lights):
        im=light_preview(b,n,rough,ao,light)
        im.save(CHECK/f'cut_lit_{"upper_left" if i==0 else "lower_right"}.png')
        shots.append(panel(im,'CUT / '+('upper-left light' if i==0 else 'lower-right light'),768))
    for i,light in enumerate(lights):
        shots.append(panel(light_preview(b,n,rough,ao,light,True),'NEUTRAL / '+('upper-left light' if i==0 else 'lower-right light'),768))
    relight=Image.new('RGB',(1536,1608))
    for i,im in enumerate(shots):relight.paste(im,((i%2)*768,(i//2)*804))
    relight.save(CHECK/'cut_relighting.jpg',quality=95)
    # Arm's-length inspection: native-size crops across the maps.
    crop_defs=[('crownshaft',(320,300,704,684)),('sheath',(1390,300,1774,684)),('cut',(380,1360,764,1744))]
    detail=Image.new('RGB',(4*384,3*420),(25,28,27))
    for row,(label,box) in enumerate(crop_defs):
        for col,k in enumerate(('base','height','normal','orm')):
            a=preview_array(k,DATA[k]).crop(box)
            detail.paste(panel(a,label+' / '+k,384),(col*384,row*420))
    detail.save(CHECK/'native_detail.jpg',quality=96)
    # Separate scalar ORM panels make the material response easy to inspect.
    chsheet=Image.new('RGB',(1536,548),(25,28,27))
    for i,k in enumerate(('AO','ROUGHNESS','METALNESS = 0')):
        im=Image.fromarray(DATA['orm'][...,i]).convert('RGB')
        chsheet.paste(panel(im,k,512),(i*512,0))
    chsheet.save(CHECK/'orm_channels.jpg',quality=95)
    # Expose the small rim at useful inspection scale, with nearest texel geometry.
    IMAGES['base'].crop((300,1090,720,1280)).resize((840,380),Image.Resampling.NEAREST).save(CHECK/'rim_detail.png')
    IMAGES['base'].resize((1280,1280),Image.Resampling.LANCZOS).save(CHECK/'base_preview.jpg',quality=95)
    METRICS['assumptions']=META['scale_notes']
    METRICS['limitations']=['Photographic pigment/relief separation is authored, not measured.',
       'Wrap edges are adjacent samples of a periodic field; equality is neither expected nor forced.',
       'Four-pixel in-island guards help early mip levels; deep full-atlas mipmaps still require UV island-aware filtering.',
       'GGX review lighting is a diagnostic, not an in-engine validation.']
    METRICS['status']='PASS' if not FAILURES else 'FAIL'
    METRICS['failures']=FAILURES
    (CHECK/'metrics.json').write_text(json.dumps(METRICS,indent=2)+'\n')
    print(METRICS['status'],len(METRICS['checks']),'checks')
    print('Normal agreement, degrees:',METRICS['normal_height_agreement']['all_degrees'])
    print('Cut geometry:',METRICS['cut_geometry'])
    if FAILURES:
        print('Failures:',FAILURES)
        raise SystemExit(1)


if __name__=='__main__':
    if '--rebuild' in sys.argv[1:]:
        before={k:hashlib.sha256(p.read_bytes()).hexdigest() for k,p in FILES.items()}
        subprocess.run([sys.executable,str(ROOT/'build_material.py')],check=True)
        after={k:hashlib.sha256(p.read_bytes()).hexdigest() for k,p in FILES.items()}
        result={'status':'PASS' if before==after else 'FAIL',
                'byte_identical_png_rebuild':before==after,'before':before,'after':after}
        (CHECK/'rebuild.json').write_text(json.dumps(result,indent=2)+'\n')
        if before!=after:
            raise SystemExit('Rebuild changed the delivered PNGs; see checks/rebuild.json')
        print('Byte-identical rebuild: True')
    check()
