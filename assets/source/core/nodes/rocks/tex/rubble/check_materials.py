#!/usr/bin/env python3
"""Independent file/scale/normal/seam checks and review images.

Does not import the builder. Normal comparison uses convolution of saved height,
where the builder uses rolled central differences. No arbitrary normal gain.
"""
from pathlib import Path
import argparse, hashlib, json, math, struct, time
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import correlate1d, gaussian_filter

ROOT=Path(__file__).resolve().parent
N=2048
NAMES=['broken','cast','stucco','coral','block','rust']
PAINTS={'pink':(202,148,137),'mint':(157,180,157),'aqua':(135,179,175),'yellow':(213,188,122)}
CHECKS=ROOT/'checks'
try: FONT=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',20)
except OSError: FONT=ImageFont.load_default()

def load(name,kind): return np.asarray(Image.open(ROOT/f'{name}_{kind}.png'))
def u8(a): return np.uint8(np.clip(np.rint(a),0,255))
def lum(a): return a[...,0]*.2126+a[...,1]*.7152+a[...,2]*.0722
def tolinear(a):
    a=np.asarray(a,dtype=np.float32)/255
    return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)
def tosrgb(a):
    a=np.clip(a,0,1)
    return u8(np.where(a<=.0031308,12.92*a,1.055*a**(1/2.4)-.055)*255)
def image(a):
    if a.ndim==2: return Image.fromarray(u8(a)).convert('RGB')
    return Image.fromarray(u8(a))

def sheet(items,path,cols=2,size=640,footer=''):
    rows=math.ceil(len(items)/cols)
    canvas=Image.new('RGB',(cols*size,rows*(size+36)+(36 if footer else 0)),(29,31,32))
    draw=ImageDraw.Draw(canvas)
    for i,(label,im) in enumerate(items):
        im=im if isinstance(im,Image.Image) else image(im)
        x=(i%cols)*size;y=(i//cols)*(size+36)
        draw.text((x+10,y+7),label,fill=(230,230,230),font=FONT)
        canvas.paste(im.resize((size,size),Image.Resampling.LANCZOS),(x,y+36))
    if footer: draw.text((10,rows*(size+36)+7),footer,fill=(230,230,230),font=FONT)
    canvas.save(path,quality=92,subsampling=0)

def relight(base,normal,rough,azimuth):
    n=np.asarray(normal,np.float32)/127.5-1
    n/=np.linalg.norm(n,axis=-1,keepdims=True)
    phi=np.deg2rad(azimuth); elev=np.deg2rad(38)
    l=np.array([np.cos(phi)*np.cos(elev),np.sin(phi)*np.cos(elev),np.sin(elev)],np.float32)
    ndl=np.maximum(np.sum(n*l,axis=-1),0)
    # Neutral sky plus one white light, in linear space.
    diffuse=(.23+.77*ndl)/(.23+.77*l[2])
    h=l+np.array([0,0,1]);h/=np.linalg.norm(h)
    ndh=np.maximum(np.sum(n*h,axis=-1),0);ndv=np.maximum(n[...,2],.02)
    alpha=(np.asarray(rough,np.float32)/255)**2; a2=alpha*alpha
    D=a2/(np.pi*(ndh*ndh*(a2-1)+1)**2+1e-7)
    k=(np.sqrt(alpha)+1)**2/8
    G=(ndl/(ndl*(1-k)+k+1e-6))*(ndv/(ndv*(1-k)+k))
    spec=.04*D*G/(4*ndv+1e-6)*.35
    return tosrgb(tolinear(base)*diffuse[...,None]+spec[...,None])

def seam_metrics(a):
    a=a.astype(np.float32)
    if a.ndim==2: a=a[...,None]
    dx=np.abs(np.diff(a,axis=1));dy=np.abs(np.diff(a,axis=0))
    # Compare the wrap against entire interior lines, not per-pixel extrema.
    col=dx.mean((0,2));row=dy.mean((1,2))
    x=float(np.abs(a[:,0]-a[:,-1]).mean()); y=float(np.abs(a[0]-a[-1]).mean())
    px=float(np.percentile(col,95));py=float(np.percentile(row,95))
    return dict(wrap_x=x,wrap_y=y,interior_line_p95_x=px,interior_line_p95_y=py,
                ratio_x=x/max(px,1e-8),ratio_y=y/max(py,1e-8))

def check_one(name):
    out=CHECKS
    metadata=json.loads((ROOT/'build_metadata.json').read_text())[name]
    kinds=['base','height','normal','rough']+(['paint','paint_tone'] if name=='stucco' else [])
    raw={k:load(name,k) for k in kinds}
    checks=[]; info={}; span=8 if name=='rust' else 30; width=.25 if name=='rust' else 1.5
    for k,a in raw.items():
        path=ROOT/f'{name}_{k}.png';b=path.read_bytes()
        w,h,depth,ctype=struct.unpack('>IIBB',b[16:26])
        expected_type=2 if k in ['base','normal'] else 0
        checks.append((f'{k}: 2048 square, PNG type and bit depth',w==h==N and depth==(16 if k=='height' else 8) and ctype==expected_type))
        im=Image.open(path)
        checks.append((f'{k}: colour-space metadata',bool(im.info.get('icc_profile')) if k=='base' else not im.info.get('icc_profile')))
        checks.append((f'{k}: physical width metadata',float(im.info['PhysicalWidthMeters'])==width))
        measured=a.astype(np.float32)*(span/65535 if k=='height' else 1)
        seam=seam_metrics(measured)
        checks.append((f'{k}: both wrap boundaries comparable to interior',max(seam['ratio_x'],seam['ratio_y'])<1.5))
        info[k]=dict(mode=im.mode,bit_depth=depth,sha256=hashlib.sha256(b).hexdigest(),
                     mean=a.mean((0,1)).tolist(),min=int(a.min()),max=int(a.max()),seams=seam)
    height=raw['height'].astype(np.float64)*span/65535
    pitch=width*1000/N
    dx=correlate1d(height,[-.5,0,.5],axis=1,mode='wrap')/pitch
    dy=correlate1d(height,[-.5,0,.5],axis=0,mode='wrap')/pitch
    expected=np.stack([-dx,dy,np.ones_like(dx)],-1)
    expected/=np.linalg.norm(expected,axis=-1,keepdims=True)
    actual=raw['normal'].astype(np.float64)/127.5-1
    actual/=np.linalg.norm(actual,axis=-1,keepdims=True)
    angle=np.rad2deg(np.arccos(np.clip(np.sum(expected*actual,-1),-1,1)))
    normal_info=dict(mean_degrees=float(angle.mean()),max_degrees=float(angle.max()),
                     p99_degrees=float(np.percentile(angle,99)),pitch_mm=pitch,
                     convention='OpenGL +X right / +Y up picture / +Z out',mean_unit_vector=actual.mean((0,1)).tolist())
    checks.append(('normal: independent full saved-height derivation < 0.4 degree',angle.max()<.4))
    checks.append(('height: no clipping, scale metadata',height.min()>0 and height.max()<span and float(Image.open(ROOT/f'{name}_height.png').info['BlackToWhiteMillimeters'])==span))
    info['height_mm']=dict(min=float(height.min()),max=float(height.max()),mean=float(height.mean()),p01=float(np.percentile(height,1)),p99=float(np.percentile(height,99)))
    info['normal_validation']=normal_info
    # Large-scale colour uniformity and residual light-direction diagnostics.
    l=lum(raw['base'].astype(np.float32)); low=gaussian_filter(l,40,mode='wrap')
    low=low[::8,::8]; yy,xx=np.mgrid[-1:1:complex(low.shape[0]),-1:1:complex(low.shape[1])]
    A=np.stack([np.ones(low.size),xx.ravel(),yy.ravel()],axis=-1)
    fit=np.linalg.lstsq(A,low.ravel(),rcond=None)[0]
    high=l-gaussian_filter(l,12,mode='wrap')
    correlations=[float(np.corrcoef(high.ravel()[::8],actual[...,i].ravel()[::8])[0,1]) for i in (0,1)]
    info['lighting_diagnostics']=dict(fitted_edge_to_edge_gradient_srgb=[float(2*fit[1]),float(2*fit[2])],
                                      albedo_normal_xy_correlation=correlations)
    checks.append(('base: fitted whole-tile gradient under 3 sRGB levels',max(abs(2*fit[1]),abs(2*fit[2]))<3))
    checks.append(('base: global directional correlation under 0.10',max(map(abs,correlations))<.1))
    # Fundamental repeat is inherent; these measure stronger interior repetition.
    small=Image.fromarray(raw['base']).resize((256,256),Image.Resampling.BOX)
    sl=lum(np.asarray(small,dtype=float));sl-=sl.mean()
    repeat={}
    for shift in (32,64,128):
        repeat[str(shift*N//256)]=[float(np.mean(sl*np.roll(sl,shift,axis))/max(np.mean(sl*sl),1e-12)) for axis in (0,1)]
    info['internal_repeat_correlation']=repeat
    info['native_detail_rms_mm']=metadata['native_detail_rms_mm']
    if 'registration' in metadata:
        samples=metadata['registration'];ys,xs=np.array(samples['coordinates_yx']).T
        residual=np.abs(height[ys,xs]-np.array(samples['height_mm']))
        checks.append(('height: 512 construction samples agree within quantization',residual.max()<span/65535*.51+1e-5))
        info['construction_sample_max_error_mm']=float(residual.max())
    if name=='broken':
        checks.append(('fracture: actual total relief spans 10 to 20 mm',10<=height.max()-height.min()<=20))
        info['aggregate_geometry']=metadata['geometry']
    if name=='stucco':
        p=raw['paint'].astype(np.float64)/255
        tone=raw['paint_tone'].astype(np.float64)
        rim=p*(1-gaussian_filter(p,2.1,mode='wrap'))
        whole=gaussian_filter(p,8,mode='wrap')
        film=p*(.46+.32*whole+.08*(tone-128)/32)+1.7*rim
        samples=metadata['registration'];ys,xs=np.array(samples['coordinates_yx']).T
        error=np.abs(height[ys,xs]-film[ys,xs]-np.array(samples['render_height_mm']))
        density=gaussian_filter(p,64,mode='wrap')
        info['paint_registration']=dict(height_residual_max_mm=float(error.max()),
            film_on_whole_paint_mm=float(film[p>.99].mean()),film_max_mm=float(film.max()),paint_mean_coverage=float(p.mean()),
            bare_fraction=float((p<.01).mean()),whole_fraction=float((p>.99).mean()),
            film_off_paint_max_mm=float(film[p==0].max()),tone_mean=float(tone.mean()),
            local_coverage_p10_p90=np.percentile(density,[10,90]).tolist())
        checks.append(('paint: independently reconstructed film matches 512 render samples',error.max()<span/65535*.51+1e-5))
        checks.append(('paint: raised only where paint remains',film[p==0].max()==0 and film[p>.99].mean()>.6))
        checks.append(('paint: large intact and largely bare weathering regions',np.percentile(density,90)-np.percentile(density,10)>.5))
        checks.append(('paint tone: midgrey average',abs(float(tone.mean())-128)<.1))
    previews={k:(a/65535*255 if k=='height' else a) for k,a in raw.items()}
    sheet([(k,previews[k]) for k in kinds],out/f'{name}_layers.jpg',cols=len(kinds),size=512,
          footer=f'{name} | {width:g} m tile | height 0 to {span} mm, shown without contrast stretch | normal OpenGL')
    offset={k:np.roll(v,(N//2,N//2),(0,1)) for k,v in previews.items()}
    sheet([(f'{k}: half-tile wrap',offset[k]) for k in kinds],out/f'{name}_offset.jpg',cols=3 if len(kinds)==6 else 2,size=640)
    base_tile=Image.fromarray(raw['base']).resize((640,640),Image.Resampling.LANCZOS)
    tiled=Image.new('RGB',(1920,1920))
    for y in range(3):
        for x in range(3): tiled.paste(base_tile,(x*640,y*640))
    tiled.save(out/f'{name}_tiled3x3.jpg',quality=92,subsampling=0)
    lit=[(f'Light {a} degrees / elevation 38',relight(raw['base'],raw['normal'],raw['rough'],a)) for a in (0,90,180,270)]
    crop=(slice(750,1262),slice(690,1202))
    sheet(lit+[(f'{a} degrees / native {width*250:g} mm crop',im[crop]) for a,(_,im) in zip((0,90,180,270),lit)],
          out/f'{name}_relit.jpg',cols=4,size=512,
          footer=f'{name}: full tile above, native-pixel crop below. Actual saved normal; no strength boost.')
    info['checks']=[{'name':k,'pass':bool(v)} for k,v in checks]
    info['pass']=all(v for k,v in checks)
    print(name+': '+('PASS' if info['pass'] else 'FAIL')+' | normal max '+str(round(float(angle.max()),4))+' deg',flush=True)
    for k,v in checks:
        if not v: print('  FAILED: '+k,flush=True)
    return info

def make_paint():
    base=load('stucco','base');p=load('stucco','paint').astype(np.float32)/255
    tone=load('stucco','paint_tone').astype(np.float32)/128
    normal=load('stucco','normal');rough=load('stucco','rough')
    items=[];stats={};lit_items=[];crop_items=[]
    crop=(slice(750,1262),slice(690,1202))
    for name,c in PAINTS.items():
        paint=tolinear(np.asarray(c))*tone[...,None]
        linear=tolinear(base)*(1-p[...,None])+paint*p[...,None]
        composite=tosrgb(linear)
        stats[name]=dict(swatch_srgb=c,mean_composite_srgb=composite.mean((0,1)).tolist(),
                         mean_on_whole_paint_srgb=composite[p>.99].mean(0).tolist())
        items.append((f'{name}: flat albedo',composite))
        lit=relight(composite,normal,rough,45)
        lit_items.append((f'{name}: normal lit',lit))
        crop_items.append((f'{name}: native 375 mm crop, lit',lit[crop]))
    sheet(items+lit_items+crop_items,CHECKS/'paint.jpg',cols=4,size=512)
    return stats

def main():
    ap=argparse.ArgumentParser();ap.add_argument('materials',nargs='*');args=ap.parse_args()
    names=args.materials or NAMES
    if any(n not in NAMES for n in names):ap.error('Unknown material')
    CHECKS.mkdir(exist_ok=True);t=time.time()
    path=CHECKS/'metrics.json'; result=json.loads(path.read_text()) if path.exists() else {}
    for n in names: result[n]=check_one(n)
    if 'stucco' in names: result['paint_colours']=make_paint()
    sources=json.loads((ROOT/'source'/'manifest.json').read_text())
    originals=all(hashlib.sha256((ROOT/r['file']).read_bytes()).hexdigest()==r['sha256'] for r in sources)
    old_rust=json.loads((ROOT/'source'/'rust_round1_hashes.json').read_text())
    rust_unchanged=all(hashlib.sha256((ROOT/f).read_bytes()).hexdigest()==h for f,h in old_rust.items())
    previews_exist=all((CHECKS/f'{n}_{kind}.jpg').exists() for n in NAMES for kind in ('tiled3x3','offset','layers','relit')) and (CHECKS/'paint.jpg').exists()
    result['global_checks']=[dict(name='every kept image-tool source matches its archived SHA-256',pass_=originals),
                             dict(name='all four rust PNGs unchanged from round one',pass_=rust_unchanged),
                             dict(name='all 25 requested preview sheets exist',pass_=previews_exist)]
    result['check_seconds']=round(time.time()-t,2)
    path.write_text(json.dumps(result,indent=2)+'\n')
    lines=[]
    for n in NAMES:
        if n not in result:continue
        lines.append(n.upper()+' '+('PASS' if result[n]['pass'] else 'FAIL'))
        lines.extend(('  PASS ' if c['pass'] else '  FAIL ')+c['name'] for c in result[n]['checks'])
    lines.extend(('PASS ' if c['pass_'] else 'FAIL ')+c['name'] for c in result['global_checks'])
    (CHECKS/'validation.txt').write_text('\n'.join(lines)+'\n')
    manifest={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(ROOT.glob('*.png'))}
    (CHECKS/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('Checks completed in',result['check_seconds'],'seconds',flush=True)
    if not all(result[n]['pass'] for n in names) or not all(c['pass_'] for c in result['global_checks']): raise SystemExit(1)

if __name__=='__main__':main()
