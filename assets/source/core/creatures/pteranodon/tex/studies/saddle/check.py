"""Independent measurements, source comparisons and physical-scale previews.

python3 tex/studies/saddle/check.py
Outputs stay in checks/. The game's renderer is run separately with:
bun tex/studies/look.ts tex/studies/saddle
"""
from pathlib import Path
import argparse
import hashlib
import json
import gc
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE=Path(__file__).resolve().parent
CHECK=HERE/'checks'
F32=np.float32
FONT=ImageFont.truetype('/System/Library/Fonts/Menlo.ttc',16) if Path('/System/Library/Fonts/Menlo.ttc').exists() else ImageFont.load_default()

def linear(s):
    return np.where(s<=.04045,s/12.92,((s+.055)/1.055)**2.4)

def srgb(l):
    return np.where(l<=.0031308,l*12.92,1.055*np.maximum(l,0)**(1/2.4)-.055)

def corr(a,b):
    a=a.ravel()-a.mean();b=b.ravel()-b.mean()
    return float((a*b).sum()/max(float(np.sqrt((a*a).sum()*(b*b).sum())),1e-12))

def seam(a):
    a=a.astype(F32)
    return [float(np.abs(a[:,-1]-a[:,0]).mean()/max(float(np.abs(np.diff(a,axis=1)).mean()),1e-9)),float(np.abs(a[-1]-a[0]).mean()/max(float(np.abs(np.diff(a,axis=0)).mean()),1e-9))]

def rgbim(a): return Image.fromarray(np.uint8(np.clip(np.rint(a*255),0,255)))

def label(im,xy,text): ImageDraw.Draw(im).text(xy,text,font=FONT,fill=(225,219,206))

def relight(base,n,pack,light):
    light=np.asarray(light,F32);light/=np.linalg.norm(light)
    ndl=np.maximum((n*light).sum(-1),0)
    half=light+np.array([0,0,1],F32);half/=np.linalg.norm(half)
    ndh=np.maximum((n*half).sum(-1),0)
    rough=pack[...,1]
    power=np.clip(2/(rough**4)-2,2,350)
    spec=(.035*(power+2)/8)*(ndh**power)*ndl
    lit=linear(base)*(.48+.62*ndl[...,None])*pack[...,:1]+spec[...,None]
    return rgbim(srgb(lit))

def mip_inputs(base,n,pack,size):
    """Average colour in linear light, normals as vectors, and preserve lost
    normal variance as roughness before relighting at the animal's density."""
    def resized(a):
        return np.stack([np.asarray(Image.fromarray(a[...,c]).resize((size,size),Image.Resampling.LANCZOS)) for c in range(3)],-1)
    b=srgb(np.maximum(resized(linear(base)),0))
    nn=resized(n)
    length=np.linalg.norm(nn,axis=-1)
    nn/=np.maximum(length[...,None],1e-5)
    pp=np.clip(resized(pack),0,1)
    pp[...,1]=np.clip(np.sqrt(pp[...,1]**2+np.maximum(1-length,0)),0,1)
    return b,nn,pp

def source_image(name,n):
    src='hide_supple' if name in ('hide','hide_edge') else 'fibre' if name.startswith('rope') else 'chitin_layers' if name=='chitin' else name
    im=Image.open(HERE/'source'/f'{src}_original.png').convert('RGB')
    if name=='hide_edge':
        w,h=im.size;im=im.crop((round(.19*w),round(.13*h),round(.69*w),round(.63*h)))
    return im.resize((n,n),Image.Resampling.LANCZOS)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--sets',default='')
    ap.add_argument('--metrics-only',action='store_true')
    args=ap.parse_args()
    meta=json.loads((HERE/'study.json').read_text())
    sets={k:v for k,v in meta['sets'].items() if not args.sets or k in args.sets.split(',')}
    CHECK.mkdir(exist_ok=True)
    manifest=json.loads((HERE/'source/manifest.json').read_text())
    for original in manifest['sources'].values():
        data=(HERE/'source'/original['file']).read_bytes()
        assert hashlib.sha256(data).hexdigest()==original['sha256'], f'Original changed: {original["file"]}'
    results={}
    if not args.metrics_only:
        overview=Image.new('RGB',(5*338+20,len(sets)*370+58),(31,32,32))
        for j,title in enumerate(['SOURCE','DELIVERED BASE','RELIT LEFT','RELIT RIGHT','RELIT LOW']):label(overview,(20+j*338,14),title)
        scales=Image.new('RGB',(1480,len(sets)*500+55),(31,32,32))
        label(scales,(20,15),'PHYSICAL DENSITIES: 900 px/m | 90 px/m | native crop at 1:1')
        native=Image.new('RGB',(2000,len(sets)*510+50),(31,32,32))
        label(native,(20,15),'900 px/m: inputs filtered before relighting / base | left | right | low')
    for row,(name,info) in enumerate(sets.items()):
        raw={k:np.asarray(Image.open(HERE/f'{name}_{k}.png')) for k in ['base','height','normal','packed','regions']}
        base=raw['base'].astype(F32)/255
        h16=raw['height']; nsize=base.shape[0]
        h=h16.astype(F32)/65535*info['height_mm']
        n=raw['normal'].astype(F32)/255*2-1
        pack=raw['packed'].astype(F32)/255
        means=[float(q.mean()*255) for q in [base[:nsize//2,:nsize//2],base[:nsize//2,nsize//2:],base[nsize//2:,:nsize//2],base[nsize//2:,nsize//2:]]]
        dx=np.roll(h,-1,1)-np.roll(h,1,1)
        dy=np.roll(h,-1,0)-np.roll(h,1,0)
        z=np.maximum(n[...,2],.05)
        nh=[corr(-n[...,0]/z,dx),corr(n[...,1]/z,dy)]
        lengths=np.linalg.norm(n,axis=-1)
        light_corr=[]
        lum=base.mean(-1)
        for az in np.arange(8)*np.pi/4:
            lit=n[...,0]*np.cos(az)*.7+n[...,1]*np.sin(az)*.7+n[...,2]*.71
            light_corr.append(corr(lum,lit))
        seams={k:seam(a) for k,a in raw.items() if k!='regions'}
        step=info['span_m']*1000/nsize
        exact=np.stack([-dx/(2*step),dy/(2*step),np.ones_like(h)],-1)
        exact/=np.linalg.norm(exact,axis=-1,keepdims=True)
        angles=np.rad2deg(np.arccos(np.clip((exact*n/lengths[...,None]).sum(-1),-1,1)))
        failures=[]
        if any(a.shape[:2]!=(2048,2048) for a in raw.values()):failures.append('not all maps 2048 square')
        if h16.dtype!=np.uint16:failures.append('height not 16-bit')
        if raw['regions'].any():failures.append('nonblack region pixel')
        if raw['packed'][...,2].any():failures.append('nonzero metalness')
        if min(nh)<.9:failures.append('normal/height correlation < 0.9')
        if (max(means)-min(means))/np.mean(means)>.02:failures.append('quarter mean spread > 2%')
        if max(abs(v) for v in light_corr)>.30:failures.append('baked light correlation > 0.30')
        if max(max(v) for v in seams.values())>1.3:failures.append('wrap jump > 1.3 interior jump')
        if abs(float(lengths.mean())-1)>.01:failures.append('normal mean length not one')
        grey=(linear(base)*np.array([.2126,.7152,.0722],F32)).sum(-1)
        out=dict(pass_all=not failures,failures=failures,quarters_srgb=means,quarter_spread_percent=100*(max(means)-min(means))/np.mean(means),
                 undyed_mean_srgb=base.mean(axis=(0,1),dtype=np.float64).tolist(),undyed_mean_linear_luminance=float(grey.mean()),
                 normal_height_correlation=nh,normal_mean_length=float(lengths.mean()),normal_angle_error_p99_degrees=float(np.percentile(angles,99)),
                 baked_light_correlations=light_corr,seams=seams,actual_height_mm=float(h.max()-h.min()),height_encoding_mm=info['height_mm'],
                 roughness_p01_mean_p99=[float(np.percentile(pack[...,1],1)),float(pack[...,1].mean()),float(np.percentile(pack[...,1],99))],
                 occlusion_min_mean=[float(pack[...,0].min()),float(pack[...,0].mean())],
                 all_regions_black=not bool(raw['regions'].any()),metalness_zero=not bool(raw['packed'][...,2].any()))
        if name in ('rope_plait','rope_twist'):
            out['two_circumference_max_byte_error']={k:int(np.max(np.abs(v[:nsize//2].astype(int)-v[nsize//2:].astype(int)))) for k,v in raw.items()}
            if any(out['two_circumference_max_byte_error'].values()):
                failures.append('rope maps do not close after one circumference')
                out['pass_all']=False
        results[name]=out
        print(f'{name}: {"PASS" if not failures else "FAIL"} | normal {nh[0]:.4f}, {nh[1]:.4f} | quarters {out["quarter_spread_percent"]:.2f}% | worst seam {max(max(v) for v in seams.values()):.3f} | {failures}',flush=True)
        if not args.metrics_only:
            source=source_image(name,nsize)
            baseim=rgbim(base)
            relits=[relight(base,n,pack,l) for l in [(-.65,.35,.8),(.7,-.2,.8),(.1,-.8,.55)]]
            images=[source,baseim]+relits
            y0=50+row*370
            label(overview,(20,y0),f'{name} / {info["span_m"]*1000:g} mm')
            for j,im in enumerate(images):
                overview.paste(im.resize((320,320),Image.Resampling.LANCZOS),(20+j*338,y0+25))
            for j,im in enumerate(relits):im.save(CHECK/f'{name}_relit_{j+1}.png')
            # Native 512-pixel crops retain the actual authored detail. For the
            # edge, use the top strip so the entire stitch/crease is present.
            by=0 if name=='hide_edge' else (nsize-512)//2
            bx=(nsize-512)//2
            crops=Image.new('RGB',(5*512,550),(31,32,32))
            for j,im in enumerate(images):
                label(crops,(j*512+5,5),['source','delivered base','relit left','relit right','relit low'][j])
                crops.paste(im.crop((bx,by,bx+512,by+512)),(j*512,35))
            crops.save(CHECK/f'{name}_source_base_relit_detail.png')
            # Half-offset at full size: every old tile edge lies in the middle.
            rgbim(np.roll(base,(nsize//2,nsize//2),axis=(0,1))).save(CHECK/f'{name}_half_offset.png')
            tile=baseim.resize((384,384),Image.Resampling.LANCZOS)
            tiled=Image.new('RGB',(1152,1152))
            for ty in range(3):
                for tx in range(3):tiled.paste(tile,(tx*384,ty*384))
            tiled.save(CHECK/f'{name}_3x3.png')
            y0=55+row*500
            label(scales,(20,y0),name)
            for column,density in [(20,900),(520,90)]:
                size=max(1,round(info['span_m']*density))
                label(scales,(column,y0+26),f'{size} px / {density} px per m')
                tiny=baseim.resize((size,size),Image.Resampling.LANCZOS)
                scales.paste(tiny,(column,y0+53))
            scales.paste(baseim.crop((bx,by,bx+450,by+420)),(990,y0+53))
            bs,ns,ps=mip_inputs(base,n,pack,max(1,round(info['span_m']*900)))
            native_pics=[rgbim(bs)]+[relight(bs,ns,ps,l) for l in [(-.65,.35,.8),(.7,-.2,.8),(.1,-.8,.55)]]
            for j,im in enumerate(native_pics):
                label(native,(20+j*500,55+row*510),name)
                native.paste(im,(20+j*500,85+row*510))
            if name.startswith('rope'):
                zoom=Image.new('RGB',(native_pics[0].width*4*4, native_pics[0].height*4+35),(31,32,32))
                label(zoom,(5,5),'900 px/m, shown 4x nearest for inspection')
                for j,im in enumerate(native_pics):zoom.paste(im.resize((im.width*4,im.height*4),Image.Resampling.NEAREST),(j*im.width*4,35))
                zoom.save(CHECK/f'{name}_900ppm_4x_nearest.png')
            if name=='hide_edge':
                # The native-density stitch row is only 12.6 px from the top.
                row900=baseim.resize((225,225),Image.Resampling.LANCZOS).crop((0,0,225,25))
                row900.resize((900,100),Image.Resampling.NEAREST).save(CHECK/'stitch_900ppm_4x_nearest.png')
            del relits,images,source,baseim
        del raw,base,h16,h,n,pack,exact,angles,grey,dx,dy
        gc.collect()
    (CHECK/'validation.json').write_text(json.dumps(results,indent=2)+'\n')
    if not args.metrics_only:
        overview.save(CHECK/'materials_overview.png')
        scales.save(CHECK/'physical_scales.png')
        native.save(CHECK/'relit_900ppm.png')
        concept=Image.open(HERE.parents[2]/'ref/concept/saddle_detail.png').convert('RGB')
        compare=Image.new('RGB',(1600,max(1000,95+280*((len(sets)+1)//2))),(31,32,32))
        compare.paste(concept.resize((840,840),Image.Resampling.LANCZOS),(20,60))
        label(compare,(20,20),'SADDLE CONCEPT / material palette and physical density')
        label(compare,(900,45),'Swatches at 900 pixels / metre')
        for i,(name,info) in enumerate(sets.items()):
            x=900+(i%2)*330;y=95+(i//2)*280
            label(compare,(x,y),name)
            size=min(290,round(info['span_m']*900))
            im=Image.open(HERE/f'{name}_base.png').convert('RGB')
            actual=round(info['span_m']*900)
            im=im.resize((actual,actual),Image.Resampling.LANCZOS).crop((0,0,size,min(size,235)))
            compare.paste(im,(x,y+28))
        # The orthographic concept has an explicitly known 400 px/m scale.
        side=Image.open(HERE.parents[2]/'ref/concept/saddled_side.png').convert('RGB')
        strip=Image.new('RGB',(1600,410),(31,32,32))
        label(strip,(10,10),'ORTHOGRAPHIC CONCEPT AND MATERIALS: 400 pixels / metre (no magnification)')
        strip.paste(side.crop((810,900,1160,1250)),(15,45))
        xx=390
        for name,info in sets.items():
            label(strip,(xx,65),name)
            px=max(1,round(info['span_m']*400))
            strip.paste(Image.open(HERE/f'{name}_base.png').resize((px,px),Image.Resampling.LANCZOS),(xx,100))
            xx+=max(120,px+15)
        strip.save(CHECK/'concept_400ppm.png')
        compare.save(CHECK/'concept_comparison.png')
    if any(not v['pass_all'] for v in results.values()):raise SystemExit(1)

if __name__=='__main__':main()
