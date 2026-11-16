#!/usr/bin/env python3
"""Measure delivered maps and produce inspectable previews. No source images modified."""
from pathlib import Path
import json
import struct
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi
from build import ROOT, N, F, linear, srgb

OUT=ROOT/'checks'
FONT=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',20)
SMALL=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',16)
COLORS={0:np.array([46,49,52],F)/255,2:np.array([200,102,46],F)/255}
VALID={(0,0,0),(255,0,0),(0,255,0),(0,0,255),(0,255,255),(255,0,255),(255,255,0)}

def arr(name,layer): return np.asarray(Image.open(ROOT/f'{name}_{layer}.png'))
def corr(a,b):
    a=a.ravel().astype(np.float64); b=b.ravel().astype(np.float64)
    a-=a.mean(); b-=b.mean()
    denom=np.sqrt(np.dot(a,a)*np.dot(b,b))
    return float(np.dot(a,b)/denom) if denom else 0.

def seam(a):
    a=a.astype(F)
    return [float(np.abs(a[:,-1]-a[:,0]).mean()/max(np.abs(np.diff(a,axis=1)).mean(),1e-9)),
            float(np.abs(a[-1]-a[0]).mean()/max(np.abs(np.diff(a,axis=0)).mean(),1e-9))]

def dyed(base,regions,scheme='design'):
    result=linear(base)
    for rid,code in [(0,(255,0,0)),(2,(0,0,255))]:
        mask=np.all(regions==code,2)
        c=COLORS[rid] if scheme=='design' else np.array({'loud':[159,224,31], 'dark':[22,24,26], 'pale':[242,239,230]}[scheme],F)/255
        result[mask]*=linear(c)/.5
    return np.clip(result,0,1)

def light(base,n,packed,direction=(.65,.45,.65)):
    l=np.array(direction,F); l/=np.linalg.norm(l)
    diffuse=np.maximum(np.sum(n*l,axis=2),0)
    half=l+np.array([0,0,1],F); half/=np.linalg.norm(half)
    specdot=np.maximum(np.sum(n*half,axis=2),0)
    rough=packed[:,:,1]
    exponent=np.minimum(2000,2/(rough**4+.001)-2)
    spec=specdot**exponent*.12*(1-rough)
    lit=base*(.35+.65*diffuse[:,:,None])*packed[:,:,:1]+spec[:,:,None]
    return srgb(lit)

def im(a): return Image.fromarray(np.rint(np.clip(a,0,1)*255).astype(np.uint8))
def label(canvas,text,x,y): ImageDraw.Draw(canvas).text((x,y),text,fill=(210,215,219),font=SMALL)

def panel_sheet(name,cfg,base,n,packed,regions):
    canvas=Image.new('RGB',(1640,1460),(28,32,36))
    draw=ImageDraw.Draw(canvas)
    draw.text((24,18),f'{name.upper()}  |  {cfg["span_m"]*1000:g} mm panel  |  2048 px',font=FONT,fill='white')
    col=dyed(base,regions)
    original=np.asarray(Image.open(OUT/'aligned'/f'{name}.png'),dtype=F)/255
    views=[original,srgb(col),light(col,n,packed),light(col,n,packed,(-.65,-.35,.7))]
    captions=['Generated source, registered to delivered scale','Delivered base, design dye, UNLIT','Delivered maps, light upper left','Delivered maps, opposite light']
    for k,(a,title) in enumerate(zip(views,captions)):
        x=20+k*405; label(canvas,title,x,62)
        canvas.paste(im(a).resize((390,390),Image.Resampling.LANCZOS),(x,88))
        label(canvas,'1:1 pixels: central 390 px crop',x,490)
        canvas.paste(im(a).crop((829,829,1219,1219)),(x,516))
    schemes=['design','loud','dark','pale'] if cfg['dyed'] else ['design']
    for k,scheme in enumerate(schemes):
        x=20+k*405
        label(canvas,scheme+' dye | 2400 texels/m, shown at native size',x,926)
        a=im(light(dyed(base,regions,scheme),n,packed))
        pixels=round(cfg['span_m']*cfg['animal_texels_per_m'])
        down=a.resize((pixels,pixels),Image.Resampling.LANCZOS)
        if pixels>365: down=down.crop((0,0,365,365))
        canvas.paste(down,(x,953))
        tiny=max(1,round(pixels/10)); label(canvas,'1/10 density',x,1330)
        canvas.paste(a.resize((tiny,tiny),Image.Resampling.LANCZOS),(x,1355))
    canvas.save(OUT/f'{name}_review.png')
    if cfg['tiles']:
        t=im(srgb(col)).resize((512,512),Image.Resampling.LANCZOS)
        tiled=Image.new('RGB',(1536,1536))
        for y in range(3):
            for x in range(3): tiled.paste(t,(x*512,y*512))
        tiled.save(OUT/f'{name}_3x3.png')
        offset=np.roll(np.roll(srgb(col),N//2,0),N//2,1)
        im(offset).save(OUT/f'{name}_half_offset.png')
    # Every layer, at identical scale, including the pure region boundary.
    layers=Image.new('RGB',(1548,340),(28,32,36))
    for k,role in enumerate(['base','height','normal','packed','regions']):
        label(layers,role,12+k*308,10)
        a=Image.open(ROOT/f'{name}_{role}.png')
        if role=='height': a=Image.fromarray((np.asarray(a)/257).astype(np.uint8))
        layers.paste(a.convert('RGB').resize((296,296),Image.Resampling.LANCZOS),(12+k*308,36))
    layers.save(OUT/f'{name}_layers.png')

def concept_comparison(info):
    canvas=Image.new('RGB',(1400,730),(225,223,216)); d=ImageDraw.Draw(canvas)
    d.text((24,20),'Concept and material at the SAME physical scale',font=FONT,fill=(30,30,30))
    head=Image.open(ROOT.parents[2]/'ref'/'concept'/'head_side.png')
    feet=Image.open(ROOT.parents[2]/'ref'/'concept'/'folded_front.png')
    # Eye head reference nominal 1000 px/m; ground feet 400 px/m.
    d.text((25,64),'Head reference: 1000 px/m; both displayed 4x nearest',font=SMALL,fill=(30,30,30))
    canvas.paste(head.crop((1015,755,1135,875)).resize((480,480),Image.Resampling.NEAREST),(25,98))
    reg=arr('eye','regions'); base=arr('eye','base').astype(F)/255
    eye=im(srgb(dyed(base,reg))).resize((50,50),Image.Resampling.LANCZOS).resize((200,200),Image.Resampling.NEAREST)
    canvas.paste(eye,(530,210))
    d.text((530,430),'18 mm iris / 50 mm panel',font=SMALL,fill=(30,30,30))
    d.text((530,460),'Explicit brief controls eye size.',font=SMALL,fill=(30,30,30))
    d.text((800,64),'Ground reference: 400 px/m, displayed 4x',font=SMALL,fill=(30,30,30))
    canvas.paste(feet.crop((705,1370,780,1455)).resize((300,340),Image.Resampling.NEAREST),(800,98))
    for j,name in enumerate(['skin','scutes','claw']):
        base=arr(name,'base').astype(F)/255; reg=arr(name,'regions')
        pixels=round(info['sets'][name]['span_m']*400)
        a=im(srgb(dyed(base,reg))).resize((pixels,pixels),Image.Resampling.LANCZOS).resize((pixels*4,pixels*4),Image.Resampling.NEAREST)
        x=25+j*440
        d.text((x,608),name+f': {pixels} pixels at concept density',font=SMALL,fill=(30,30,30))
        # A strip, never rescale the representative material to fit.
        canvas.paste(a.crop((0,0,min(a.width,390),min(a.height,75))),(x,638))
    canvas.save(OUT/'concept_scale.png')

def main():
    OUT.mkdir(exist_ok=True)
    info=json.loads((ROOT/'study.json').read_text())
    reports={}; faults=[]
    for name,cfg in info['sets'].items():
        print('Checking',name,flush=True)
        report={'layers':{},'regions':{}}
        arrays={}
        for role in ['base','height','normal','packed','regions']:
            path=ROOT/f'{name}_{role}.png'; a=arr(name,role); arrays[role]=a
            bits=path.read_bytes()[24]
            report['layers'][role]={'size':list(a.shape[:2]),'depth':bits}
            if a.shape[:2]!=(N,N): faults.append(f'{name}/{role}: wrong dimensions')
            if bits!=(16 if role=='height' else 8): faults.append(f'{name}/{role}: wrong PNG depth')
            if cfg['tiles']:
                ratio=seam(a); report['layers'][role]['edge_ratio']=ratio
                if max(ratio)>1.3: faults.append(f'{name}/{role}: seam {ratio}')
        b=arrays['base'].astype(F)/255; h=arrays['height'].astype(F)/65535
        n=arrays['normal'].astype(F)/127.5-1; p=arrays['packed'].astype(F)/255; r=arrays['regions']
        lb=linear(b)
        quarters=[float(lb[y:y+N//2,x:x+N//2].mean()) for y in (0,N//2) for x in (0,N//2)]
        spread=(max(quarters)-min(quarters))/float(lb.mean())
        report['base_quarter_relative_spread']=spread
        if spread>.02: faults.append(f'{name}: whole-base quadrant spread {spread}')
        del lb
        colors=set(map(tuple,np.unique(r.reshape(-1,3),axis=0)))
        report['region_colors']=[list(map(int,c)) for c in sorted(colors)]
        if not colors<=VALID: faults.append(name+': region colors are not pure')
        if p[:,:,2].max()!=0: faults.append(name+': metalness not zero')
        lengths=np.linalg.norm(n,axis=2)
        gx=np.roll(h,-1,1)-np.roll(h,1,1); gy=np.roll(h,-1,0)-np.roll(h,1,0)
        nx=corr(-n[:,:,0]/n[:,:,2],gx); ny=corr(n[:,:,1]/n[:,:,2],gy)
        report['normal']={'x':nx,'y':ny,'length_mean':float(lengths.mean()),'max_length_error':float(np.abs(lengths-1).max())}
        if min(nx,ny)<.9: faults.append(f'{name}: normal/height correlation {nx}, {ny}')
        if np.abs(lengths-1).max()>.01: faults.append(name+': normal length')
        report['roughness']={'min':float(p[:,:,1].min()),'mean':float(p[:,:,1].mean()),'max':float(p[:,:,1].max())}
        report['ao_min']=float(p[:,:,0].min())
        report['height_used_mm']=float((h.max()-h.min())*cfg['height_mm'])
        for rid,code in [(0,(255,0,0)),(2,(0,0,255))]:
            mask=np.all(r==code,2)
            if not mask.any(): continue
            lum=linear(b).mean(2)
            mean=float(lum[mask].mean())
            neutral=int(np.ptp(arrays['base'][mask].astype(np.int16),axis=1).max())
            quarters=[]
            for ys,xs in [(slice(0,1024),slice(0,1024)),(slice(0,1024),slice(1024,N)),(slice(1024,N),slice(0,1024)),(slice(1024,N),slice(1024,N))]:
                quarters.append(float(lum[ys,xs][mask[ys,xs]].mean()))
            spread=(max(quarters)-min(quarters))/mean
            directional=[corr(lum[mask],n[:,:,k][mask]) for k in [0,1]]
            report['regions'][str(rid)]={'mean_linear':mean,'mean_srgb':float(b[mask].mean()*255),'neutral_channel_delta':neutral,'quarter_means_linear':quarters,'quarter_relative_spread':spread,'tangent_lighting_correlation':directional}
            if abs(mean-.5)>.02 or neutral>2 or spread>.02: faults.append(f'{name}: region {rid} neutral/mean/quarters')
        if name=='eye':
            undyed=np.all(r==0,2)
            y,x=np.where(undyed)
            report['eye_and_wet_rim_mm']=[float((x.max()-x.min()+1)*cfg['span_m']*1000/N),float((y.max()-y.min()+1)*cfg['span_m']*1000/N)]
            report['pupil_max_srgb']=int(arrays['base'][N//2-80:N//2+80,N//2-80:N//2+80].max())
        panel_sheet(name,cfg,b,n,p,r)
        reports[name]=report
        del arrays,b,h,n,p,r
    concept_comparison(info)
    result={'passed':not faults,'faults':faults,'sets':reports}
    (OUT/'metrics.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'passed':not faults,'faults':faults},indent=2),flush=True)
    if faults: raise SystemExit(1)

if __name__=='__main__': main()
