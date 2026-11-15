#!/usr/bin/env python3
"""Independent checks of delivered PNGs; diagnostic pictures go in checks/."""
from pathlib import Path
import json
import math
import struct
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'checks'
OUT.mkdir(exist_ok=True)


def linear(a):
    return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)


def srgb(a):
    a=np.maximum(a,0)
    return np.clip(np.where(a<=.0031308,12.92*a,1.055*a**(1/2.4)-.055),0,1)


def corr(a,b):
    a=a.astype(np.float64).ravel(); b=b.astype(np.float64).ravel()
    a-=a.mean(); b-=b.mean()
    return float(np.sum(a*b)/max(np.sqrt(np.sum(a*a)*np.sum(b*b)),1e-14))


def pic(a):
    if a.ndim==2:
        a=np.repeat(a[:,:,None],3,2)
    return Image.fromarray(np.uint8(np.clip(np.rint(a*255),0,255)))


def panel(cells,path,cols=3,tile=384):
    rows=math.ceil(len(cells)/cols)
    out=Image.new('RGB',(cols*tile,rows*(tile+36)),(30,32,32))
    d=ImageDraw.Draw(out)
    for i,(label,im) in enumerate(cells):
        x=(i%cols)*tile; y=(i//cols)*(tile+36)
        d.text((x+10,y+10),label,fill=(232,229,217))
        out.paste(im.resize((tile,tile),Image.Resampling.LANCZOS),(x,y+36))
    out.save(OUT/path)


def load(name):
    return {k:np.asarray(Image.open(ROOT/f'{name}_{k}.png'),np.float32)/(65535 if k=='height' else 255)
            for k in ['base','height','normal','packed','regions']}


def shade(m,dye=None,light=(-.55,.4,.7)):
    b=linear(m['base'])
    if dye:
        tint=linear(np.array(dye,np.float32)/255)
        b=b*tint/.5
    n=m['normal']*2-1
    n/=np.linalg.norm(n,axis=2,keepdims=True)
    l=np.array(light,np.float32); l/=np.linalg.norm(l)
    v=np.array([0,0,1],np.float32)
    half=(v+l)/np.linalg.norm(v+l)
    nl=np.maximum(sum(n[:,:,k]*l[k] for k in range(3)),0)
    nh=np.maximum(sum(n[:,:,k]*half[k] for k in range(3)),0)
    nv=np.maximum(n[:,:,2],.001)
    rough=m['packed'][:,:,1]
    a2=np.maximum(rough,.08)**4
    distribution=a2/(np.pi*((nh*nh)*(a2-1)+1)**2)
    k=(rough+1)**2/8
    g=(nl/(nl*(1-k)+k))*(nv/(nv*(1-k)+k))
    spec=.04*distribution*g/(4*nv*np.maximum(nl,.001))
    ao=m['packed'][:,:,0]
    out=b*(.36*ao+.66*nl)[:,:,None]+(.65*spec*nl)[:,:,None]
    return pic(srgb(out))


def proxy_contact():
    paths=[OUT/f'foot_{name}.png' for name in ['ochre','slate','rear_olive']]
    if not all(p.exists() for p in paths):
        return
    panel([(label,Image.open(p).convert('RGB')) for label,p in zip(
        ['Ochre / front material proxy','Slate / opposite front','Olive / back scales and hind toe'],paths)],
        'foot_contact.png',cols=3,tile=512)
    canvas=Image.new('RGB',(800,290),(213,211,203))
    d=ImageDraw.Draw(canvas)
    ref=Image.open(ROOT.parents[2]/'ref/concept/front.png').convert('RGB').crop((460,978,800,1155))
    foot=Image.open(paths[0]).convert('RGB')
    for col,bird in enumerate([200,50]):
        x=20+col*400
        d.text((x,15),f'{bird}px bird / native size and 2x pixels',fill=(30,30,30))
        ref_small=ref.resize((max(1,round(ref.width*bird/975)),max(1,round(ref.height*bird/975))),Image.Resampling.LANCZOS)
        px=max(1,round(.228/.65*bird))
        proxy_small=foot.resize((px,px),Image.Resampling.LANCZOS)
        d.text((x,42),'Concept feet',fill=(30,30,30)); canvas.paste(ref_small,(x,62))
        d.text((x,110),'Material proxy',fill=(30,30,30)); canvas.paste(proxy_small,(x,130))
        canvas.paste(proxy_small.resize((px*2,px*2),Image.Resampling.NEAREST),(x+120,110))
    canvas.save(OUT/'foot_bird_sizes.png')


def main():
    manifest=json.loads((ROOT/'study.json').read_text())
    results={}; failures=[]; layers=[]; lights=[]; offsets=[]; crops=[]
    dyes={'ochre':(196,156,88),'slate':(101,104,111),'olive':(134,127,78),
          'dull orange':(176,96,44),'hot pink':(255,37,163),'lime':(172,247,35),
          'near black':(23,24,26),'near white':(235,234,229)}
    dye_panels=[]
    for name,c in manifest['sets'].items():
        m=load(name); n=c['size']; h=m['height']; b=m['base']; normal=m['normal']*2-1
        norm=np.linalg.norm(normal,axis=2)
        actual=normal/norm[:,:,None]
        dx=(np.roll(h,-1,1)-np.roll(h,1,1))/2 if c['tiles'][0] else np.gradient(h,axis=1)
        dy=(np.roll(h,-1,0)-np.roll(h,1,0))/2 if c['tiles'][1] else np.gradient(h,axis=0)
        scale=c['height_mm']/1000*n/c['span_m']
        ref=np.stack((-dx*scale,dy*scale,np.ones_like(h)),axis=2)
        ref/=np.linalg.norm(ref,axis=2,keepdims=True)
        r={}
        r['size']=[n,n]; r['png_formats']={}
        for k in m:
            p=ROOT/f'{name}_{k}.png'
            header=p.read_bytes()[:29]
            im=Image.open(p)
            r['png_formats'][k]=dict(size=list(im.size),bits=header[24],colour_type=header[25])
            if im.size!=(n,n) or header[24]!=(16 if k=='height' else 8):
                failures.append(f'{name} {k}: wrong dimensions or depth')
        r['normal_correlation_xy']=[corr(actual[:,:,k],ref[:,:,k]) for k in [0,1]]
        r['normal_byte_error_max']=int(np.abs(np.rint((ref*.5+.5)*255)-np.rint(m['normal']*255)).max())
        r['normal_unit_length_max_error']=float(abs(norm-1).max())
        if min(r['normal_correlation_xy'])<.9 or r['normal_byte_error_max']>1 or r['normal_unit_length_max_error']>.007:
            failures.append(f'{name}: normal against height')
        rgb=np.rint(m['regions']*255).astype(np.uint8)
        codes=rgb[:,:,0].astype(np.int32)*65536+rgb[:,:,1].astype(np.int32)*256+rgb[:,:,2]
        unique=[[int(v//65536),int(v//256%256),int(v%256)] for v in np.unique(codes)]
        r['region_colours']=unique
        wanted=[[0,0,0]] if name=='claw' else [[0,255,255]]
        if unique!=wanted:
            failures.append(f'{name}: region palette')
        r['non_neighbour_region_contacts']=0 if unique==wanted else None
        r['metalness_max']=float(m['packed'][:,:,2].max())
        if r['metalness_max']!=0:
            failures.append(f'{name}: metalness not zero')
        lin=linear(b).mean(axis=2)
        r['base_linear_mean']=float(lin.mean())
        r['base_srgb_mean']=float(b.mean()*255)
        r['base_channel_spread_max']=float((b.max(axis=2)-b.min(axis=2)).max()*255)
        q=[float(a.mean()) for a in [lin[:n//2,:n//2],lin[:n//2,n//2:],lin[n//2:,:n//2],lin[n//2:,n//2:]]]
        r['base_quadrant_linear_means']=q
        r['base_quadrant_relative_range']=(max(q)-min(q))/max(np.mean(q),1e-9)
        light_corr=[]
        for az in np.linspace(0,2*np.pi,12,endpoint=False):
            for z in [.3,.7]:
                light=np.array([np.cos(az),np.sin(az),z]); light/=np.linalg.norm(light)
                response=np.maximum(sum(actual[:,:,k]*light[k] for k in range(3)),0)
                light_corr.append(abs(corr(lin,response)))
        r['base_max_abs_correlation_24_lights']=max(light_corr)
        if name!='claw':
            if abs(r['base_linear_mean']-.5)>.02 or r['base_channel_spread_max']>2:
                failures.append(f'{name}: neutral / mean dye base')
            if r['base_quadrant_relative_range']>.02:
                failures.append(f'{name}: quadrant exposure balance')
            if r['base_max_abs_correlation_24_lights']>.08:
                failures.append(f'{name}: directional base correlation')
        else:
            r['quadrant_exception']='Intentional authored root-to-tip pigment wear, not directional illumination.'
            r['root_rgb_mean_8bit']=(b[:n//5].mean(axis=(0,1))*255).tolist()
            r['tip_rgb_mean_8bit']=(b[-n//10:].mean(axis=(0,1))*255).tolist()
        r['roughness_min_mean_max']=[float(f(m['packed'][:,:,1])) for f in [np.min,np.mean,np.max]]
        r['ao_min_mean_max']=[float(f(m['packed'][:,:,0])) for f in [np.min,np.mean,np.max]]
        r['height_used_mm']=[float(h.min()*c['height_mm']),float(h.max()*c['height_mm'])]
        seams={}
        for layer,a in m.items():
            seams[layer]={}
            for axis,key,tile in [(1,'x',c['tiles'][0]),(0,'y',c['tiles'][1])]:
                if not tile:
                    continue
                jump=float(abs(np.take(a,0,axis=axis)-np.take(a,-1,axis=axis)).mean())
                inside=float(abs(np.diff(a,axis=axis)).mean())
                ratio=jump/max(inside,1e-10)
                seams[layer][key]=dict(wrap_jump=jump,interior_jump=inside,ratio=ratio)
                if ratio>1.3:
                    failures.append(f'{name} {layer} {key}: seam ratio {ratio:.3f}')
        r['seams']=seams
        results[name]=r
        print(f'Checked {name}: mean={r["base_linear_mean"]:.5f}, normal correlations={r["normal_correlation_xy"]}',flush=True)
        for key in ['base','height','normal','packed','regions']:
            display=m[key]
            if key=='height':
                display=(display-display.min())/max(np.ptp(display),1e-6)
            layers.append((f'{name} / {key}'+(' (display stretched)' if key=='height' else ''),pic(display)))
        dye=None if name=='claw' else dyes['ochre']
        for light,label in [((-.7,.4,.7),'upper left'),((.7,-.4,.7),'lower right'),((.12,.05,1),'near frontal')]:
            lights.append((f'{name} / {label}',shade(m,dye,light)))
        relit=shade(m,dye)
        arr=np.asarray(relit)
        off=np.roll(arr,n//2,axis=1)
        if c['tiles'][1]:
            off=np.roll(off,n//2,axis=0)
        offsets.append((f'{name} / half offset',Image.fromarray(off)))
        rep=np.tile(arr,(2,2,1)) if c['tiles'][1] else np.tile(arr,(1,2,1))
        # Keep aspect for claw horizontal-only repeat by placing on square canvas.
        repeat=Image.fromarray(rep)
        if name=='claw':
            square=Image.new('RGB',(2*n,2*n),(30,32,32)); square.paste(repeat,(0,n//2)); repeat=square
        offsets.append((f'{name} / repeat',repeat))
        lo=n//2-256
        crop=arr[lo:lo+512,lo:lo+512]
        crops.append((f'{name} / centre crop (512 native pixels)',Image.fromarray(crop)))
        if name!='claw':
            for label,dye in dyes.items():
                dye_panels.append((f'{name} / {label}',shade(m,dye)))
        # Actual pixel-sized physical span at a 200 px and 50 px tall 0.65 m bird.
        sizes=Image.new('RGB',(660,240),(213,211,203)); draw=ImageDraw.Draw(sizes)
        for i,bird_pixels in enumerate([200,50]):
            px=max(1,round(c['span_m']/.65*bird_pixels))
            tiny=relit.resize((px,px),Image.Resampling.LANCZOS)
            sizes.paste(tiny,(20+i*330,55))
            sizes.paste(tiny.resize((px*4,px*4),Image.Resampling.NEAREST),(95+i*330,55))
            draw.text((20+i*330,15),f'{bird_pixels}px bird: {px}px tile, plus 4x pixel view',fill=(30,30,30))
        sizes.save(OUT/f'{name}_bird_sizes.png')
    panel(layers,'layers_contact.png',cols=5,tile=320)
    panel(lights,'relighting.png',cols=3,tile=512)
    panel(offsets,'seams.png',cols=2,tile=512)
    panel(crops,'native_crops.png',cols=3,tile=512)
    panel(dye_panels,'dyes.png',cols=4,tile=384)
    proxy_contact()
    report=dict(passed=not failures,failures=failures,sets=results)
    (OUT/'metrics.json').write_text(json.dumps(report,indent=2)+'\n')
    # A compact retained result is useful even when checks/ is excluded.
    (ROOT/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
    return 0 if not failures else 1


if __name__=='__main__':
    sys.exit(main())
