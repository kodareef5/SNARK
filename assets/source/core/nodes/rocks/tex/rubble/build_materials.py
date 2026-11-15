#!/usr/bin/env python3
"""Deterministic rubble skin build. Python 3 + Pillow, NumPy, SciPy only.

Image artwork is a morphology/pigment source, not a measured scan. All geometry
amplitudes are authored in millimetres. Output normals differentiate the SAVED
16-bit height; no hidden gain or removed low frequencies.
"""
from pathlib import Path
import argparse, hashlib, json, struct, time
import numpy as np
from PIL import Image, ImageCms, ImageDraw, PngImagePlugin
from scipy.ndimage import gaussian_filter, distance_transform_edt, label, find_objects, binary_fill_holes

ROOT = Path(__file__).resolve().parent
N = 2048
SEED = 20261114
NAMES = ['broken', 'cast', 'stucco', 'coral', 'block', 'rust']
SOURCES = dict(zip(NAMES, [f'P{i+7:02d}_{n}.png' for i,n in enumerate(NAMES[:-1])]+['P06_rust.png']))
SOURCES['render']='P12_render.png'
_profile = bytearray(ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
# LittleCMS inserts today's timestamp. Canonicalize it for reproducible PNGs.
_profile[24:36] = struct.pack('>6H',2026,11,14,0,0,0)
SRGB = bytes(_profile)

def blur(a, s):
    return gaussian_filter(a, s if a.ndim == 2 else (s,s,0), mode='wrap')

def ramp(a, lo, hi):
    t = np.clip((a-lo)/(hi-lo),0,1)
    return t*t*(3-2*t)

def field(rng, sigma):
    a = blur(rng.standard_normal((N,N)).astype('float32'),sigma)
    return a / max(float(a.std()),1e-6)

def seam_path(cost):
    """Minimum-cost top-to-bottom seam, ±1 pixel horizontal movement."""
    h,w=cost.shape
    back=np.zeros((h,w),np.int8)
    acc=cost[0].copy()
    for y in range(1,h):
        candidates=np.stack([np.r_[np.inf,acc[:-1]],acc,np.r_[acc[1:],np.inf]])
        k=np.argmin(candidates,axis=0)
        back[y]=k-1
        acc=cost[y]+candidates[k,np.arange(w)]
    path=np.empty(h,np.int32); path[-1]=np.argmin(acc)
    for y in range(h-2,-1,-1): path[y]=path[y+1]+back[y+1,path[y+1]]
    return path

def quilt(name,rng):
    """Source crops on a torus: 64 for broken, 16 for all others.

    No enlargement of source pixels. Broken aggregate, coral fossils and block
    grains are reduced to the intended physical sizes before assembly.
    The last row/column overlap the first; no mirrored edge or blurred cross.
    """
    im=Image.open(ROOT/'source'/SOURCES[name]).convert('RGB')
    scale={'broken':.30,'coral':.70,'block':.80}.get(name,1.)
    if scale!=1: im=im.resize((round(im.width*scale),round(im.height*scale)),Image.Resampling.LANCZOS)
    src=np.asarray(im,dtype=np.float32)
    # Retain the two stucco pigments; detrend only luminance in other sources.
    if name!='stucco':
        lum=src[...,0]*.2126+src[...,1]*.7152+src[...,2]*.0722
        low=gaussian_filter(lum,60,mode='reflect')
        strength=.9 if name=='rust' else (.2 if name=='cast' else .65)
        src-=strength*(low-low.mean())[...,None]
    out=np.zeros((N,N,3),np.float32); occupied=np.zeros((N,N),bool)
    step=256 if name=='broken' else 512
    overlap=step//4; p=step+overlap
    records=[]
    for row in range(N//step):
        for col in range(N//step):
            yy=(np.arange(p)+row*step-overlap//2)%N; xx=(np.arange(p)+col*step-overlap//2)%N
            old=out[np.ix_(yy,xx)]; valid=occupied[np.ix_(yy,xx)]
            best=None
            for _ in range(14):
                sy=int(rng.integers(0,src.shape[0]-p+1)); sx=int(rng.integers(0,src.shape[1]-p+1))
                rot=int(rng.integers(4)); flip=bool(rng.integers(2))
                patch=np.rot90(src[sy:sy+p,sx:sx+p],rot)
                if flip: patch=patch[:,::-1]
                error=np.mean((old-patch)**2,axis=2)
                score=float(error[valid].mean()) if valid.any() else 0
                if best is None or score<best[0]: best=(score,patch.copy(),error,sy,sx,rot,flip)
            score,patch,error,sy,sx,rot,flip=best
            keep=np.ones((p,p),bool)
            # Four cuts, with missing areas filled unconditionally below.
            for side in range(4):
                ev=np.rot90(error,side); vv=np.rot90(valid,side)
                if not vv[:,:overlap].any(): continue
                cost=ev[:,:overlap]*vv[:,:overlap]
                path=seam_path(cost)
                km=np.ones((p,p),bool)
                km[:,:overlap]=np.arange(overlap)[None,:]>=path[:,None]
                keep &= np.rot90(km,-side)
            keep |= ~valid
            # Subpixel AA only; do not crossfade a wide strip of material.
            alpha=gaussian_filter(keep.astype(np.float32),.45,mode='nearest')
            alpha[~valid]=1
            out[np.ix_(yy,xx)]=old*(1-alpha[...,None])+patch*alpha[...,None]
            occupied[np.ix_(yy,xx)]=True
            records.append(dict(row=row,col=col,x=sx,y=sy,rotation=rot*90,flip=flip,error=score))
    assert occupied.all()
    # Shift the working grid away from the visible wrap. This is a torus shift.
    out=np.roll(out,(193,317),(0,1))
    metadata=dict(source=SOURCES[name],source_scale=scale,patch_pixels=p,step=step,
                  candidates=14,roll=[193,317],patches=records)
    return np.clip(np.rint(out),0,255).astype(np.float32),metadata

def pores(rng,count,radius,depth):
    """Irregular depression profiles, in mm, stamped across a toroidal field."""
    h=np.zeros((N,N),np.float32)
    mask=np.zeros_like(h)
    for _ in range(count):
        x=int(rng.integers(N));y=int(rng.integers(N))
        r=float(np.exp(rng.uniform(np.log(radius[0]),np.log(radius[1]))))
        s=int(np.ceil(r*1.8))+2
        yy,xx=np.mgrid[-s:s+1,-s:s+1].astype(np.float32)
        theta=rng.uniform(0,2*np.pi);a=rng.uniform(.6,1.2)
        u=(xx*np.cos(theta)+yy*np.sin(theta))/r
        v=(-xx*np.sin(theta)+yy*np.cos(theta))/(r*a)
        ang=np.arctan2(v,u)
        rho=np.sqrt(u*u+v*v)*(1+.12*np.sin(3*ang+rng.uniform(0,6))+.07*np.sin(5*ang))
        profile=(1-ramp(rho,.28,1.0))
        d=rng.uniform(*depth)*(min(1.,r/3)**.55)
        iy=(np.arange(y-s,y+s+1)%N);ix=np.arange(x-s,x+s+1)%N
        h[np.ix_(iy,ix)]=np.maximum(h[np.ix_(iy,ix)],profile*d)
        mask[np.ix_(iy,ix)]=np.maximum(mask[np.ix_(iy,ix)],profile)
    return h,mask

def cracks(rng,count,lengths,width=.7):
    # Pillow at twice resolution gives fractional-pixel crack coverage.
    im=Image.new('L',(N*2,N*2));d=ImageDraw.Draw(im)
    for _ in range(count):
        x,y=rng.uniform(0,N,2);theta=rng.uniform(0,2*np.pi)
        pts=[(x,y)];length=rng.uniform(*lengths);steps=max(3,int(length/8))
        for k in range(steps):
            theta+=rng.normal(0,.24)
            x+=np.cos(theta)*length/steps;y+=np.sin(theta)*length/steps
            pts.append((x,y))
        for dy in (-N,0,N):
            for dx in (-N,0,N):
                d.line([(round((a+dx)*2),round((b+dy)*2)) for a,b in pts],fill=255,width=max(1,round(width*2)))
        if rng.random()<.65:
            mid=pts[len(pts)//2];theta+=rng.choice([-1,1])*1.0
            end=(mid[0]+np.cos(theta)*length*.3,mid[1]+np.sin(theta)*length*.3)
            for dy in (-N,0,N):
                for dx in (-N,0,N):
                    d.line([(round((a+dx)*2),round((b+dy)*2)) for a,b in [mid,end]],fill=185,width=1)
    return np.asarray(im.resize((N,N),Image.Resampling.LANCZOS),np.float32)/255

def color_mix(a,b,t):
    return np.asarray(a,np.float32)*(1-t[...,None])+np.asarray(b,np.float32)*t[...,None]

def center_color(a,target):
    return a+np.array(target,np.float32)-a.mean((0,1),dtype=np.float64).astype(np.float32)

def pebble_caps(mask,rng):
    """Individual curved/fractured caps, not a brightness-to-height extrusion.

    Components include wrap copies, and each cap is sampled at the original
    material's pixel pitch. Maximum diameter is 25 mm; larger source blobs are
    excluded instead of silently becoming model-scale stones.
    """
    pad=48; padded=np.pad(mask,pad,mode='wrap')
    labels,count=label(padded)
    h=np.zeros(padded.shape,np.float32); coverage=np.zeros_like(h)
    diameters=[];peaks=[]
    for i,sl in enumerate(find_objects(labels),1):
        if sl is None: continue
        m=labels[sl]==i
        area=int(m.sum());diameter=2*np.sqrt(area/np.pi)*1500/N
        if not 3.5<=diameter<=25 or max(m.shape)>48:continue
        m=binary_fill_holes(m)
        dist=distance_transform_edt(np.pad(m,1))[1:-1,1:-1]
        peak=float(np.clip(diameter*.38,1.8,7.8))
        cap=(dist/max(dist.max(),1))**.60
        # Local facet tilt remains geometry, never a lighting term in albedo.
        yy,xx=np.mgrid[0:m.shape[0],0:m.shape[1]]
        phase=((sl[0].start-pad)%N)*.73+((sl[1].start-pad)%N)*.37
        facet=1+.12*(xx/m.shape[1]-.5)*np.sin(phase)+.12*(yy/m.shape[0]-.5)*np.cos(phase)
        h[sl]=np.maximum(h[sl],m*(.65+peak*cap*facet))
        coverage[sl]=np.maximum(coverage[sl],m)
        if pad<=sl[0].start<N+pad and pad<=sl[1].start<N+pad:
            diameters.append(diameter);peaks.append(peak)
    # Wrap labels have matching shapes; random lift is removed from this edge
    # strip by tying the actual cap to component diameter instead of random ID.
    h=h[pad:-pad,pad:-pad];coverage=coverage[pad:-pad,pad:-pad]
    return blur(h,.6),blur(coverage,.55),dict(count=len(diameters),diameter_mm_range=[min(diameters),max(diameters)],median_diameter_mm=float(np.median(diameters)))

def film_from_coverage(paint,tone):
    """Quantized paint/tone are the authority for thickness and edge lift."""
    edge=paint*(1-blur(paint,2.1))
    whole=blur(paint,8)
    film=paint*(.46+.32*whole+.08*(tone-128)/32)+1.7*edge
    return film.astype(np.float32)

def registration_samples(height,semantic):
    rng=np.random.default_rng(48213)
    coords=rng.integers(0,N,(512,2));ys,xs=coords.T
    out={'coordinates_yx':coords.tolist(),'height_mm':height[ys,xs].tolist()}
    if 'render_height_mm' in semantic:
        out['render_height_mm']=semantic['render_height_mm'][ys,xs].tolist()
    return out

def save_png(name,kind,array,scale):
    metadata=PngImagePlugin.PngInfo()
    metadata.add_text('Material',name)
    metadata.add_text('PhysicalWidthMeters',str(scale))
    metadata.add_text('Encoding','sRGB' if kind=='base' else 'linear data')
    if kind=='height':
        metadata.add_text('BlackToWhiteMillimeters','8' if name=='rust' else '30')
    if kind=='normal': metadata.add_text('Convention','OpenGL +X right, +Y up image, +Z out')
    kwargs=dict(pnginfo=metadata)
    if kind=='base': kwargs['icc_profile']=SRGB
    Image.fromarray(array).save(ROOT/f'{name}_{kind}.png',**kwargs)

def make(name):
    t=time.time(); idx=NAMES.index(name)
    q,plan=quilt(name,np.random.default_rng(SEED+idx*100))
    rng=np.random.default_rng(SEED+idx*100+1)
    lum=q[...,0]*.2126+q[...,1]*.7152+q[...,2]*.0722
    # Local residual used only at small amplitudes, not as literal light/shadow.
    local=lum-blur(lum,24)
    small=blur(local,.7)
    fine=field(rng,.55); grain=field(rng,1.4); meso=field(rng,6)
    soft=field(rng,31)
    extras={}; semantic={}; native_detail=np.zeros((N,N),np.float32)
    if name=='broken':
        # Use chroma and connected shape to distinguish stone from empty socket.
        smooth=blur(lum,.6); chroma=blur(q[...,0]-q[...,2],.7)
        pale_shape=(smooth>151)&(chroma>18)
        dark_shape=(smooth>102)&(smooth<130)&(chroma<17)
        pale_h,pale,pebble_info=pebble_caps(pale_shape,rng)
        dark_h,dark,dark_info=pebble_caps(dark_shape,rng)
        aggregate=np.maximum(pale,dark)
        pit=ramp(115-smooth,8,45)*(1-aggregate)
        socket_h,socket=pores(rng,1050,(3.4,16.8),(3.8,8.4))
        socket_h*=1-aggregate; socket*=1-aggregate
        native_pit,pm=pores(rng,5500,(.65,3.5),(.35,2.2))
        native_detail=(.10*fine+.24*grain)*(1-.65*aggregate)
        h=13+np.maximum(pale_h,dark_h)+.45*np.tanh(small/14)+.24*np.tanh(meso)+native_detail-np.maximum.reduce([2.5*pit,socket_h,native_pit*(1-.8*aggregate)])
        base=color_mix([150,148,136],[191,181,158],pale)
        base=color_mix(base,[103,106,101],dark)
        base+=(2.0*np.tanh(grain)+.09*np.clip(local,-20,20))[...,None]
        base-= (pit*7+socket*15+pm*7)[...,None]
        rough=.92-.10*aggregate+.045*pit+.022*np.tanh(grain)
        semantic=dict(aggregate=aggregate,void=np.maximum(socket,pit))
        geometry_info={'pale_pebbles':pebble_info,'dark_pebbles':dark_info,'socket_diameter_mm':[5,25]}
    elif name=='cast':
        # Broad pigments retain black grime, olive algae and rusty runoff.
        stained=blur(q,3.8)
        source_pit=ramp(blur(lum,5)-blur(lum,.7),10,35)
        native_pit,pm=pores(rng,2300,(.7,5.5),(.35,3.6))
        # Source pores already occur in clusters. Native ones fill fine scales.
        crack=cracks(rng,34,(45,380),.65)
        form=blur(local,4)-blur(local,20)
        worn=ramp(blur(lum,5)-blur(lum,24),6,18)
        native_detail=.035*fine+.065*grain
        h=15+.13*np.tanh(meso)+.02*form+.28*worn+native_detail-2.2*source_pit-native_pit-.65*crack
        base=center_color(stained,[154,151,139])
        base+=(.50*np.clip(local,-30,30)+1.1*grain)[...,None]
        base-= (source_pit*10+pm*10+crack*26)[...,None]
        base=color_mix(base,[191,181,158],worn*.30)
        base=center_color(base,[154,151,139])
        rough=.87+.025*np.tanh(grain)+.06*source_pit+.035*pm-.025*worn
        semantic=dict(void=np.maximum(source_pit,pm),crack=crack)
    elif name=='stucco':
        chroma=blur(q[...,0]-q[...,1],.45)
        # Large continuous paint and loss regions come from the NEW source.
        paint=ramp(chroma,25,43)
        major=cracks(rng,13,(260,850),1.35)
        craze=cracks(rng,170,(25,160),.55)
        near_crack=blur(major,10)*22
        vulnerable=ramp(soft,-.4,.9)
        paint*=1-ramp(near_crack*vulnerable,.05,.40)
        paint*=1-.95*major-.65*craze
        paint=np.rint(np.clip(paint,0,1)*255).astype('uint8').astype(np.float32)/255
        # Unpainted render is built from granular plaster, independent of pink.
        render_q,render_plan=quilt('render',np.random.default_rng(SEED+901))
        plan['bare_render']=render_plan
        render_lum=render_q[...,0]*.2126+render_q[...,1]*.7152+render_q[...,2]*.0722
        render_detail=render_lum-blur(render_lum,22)
        trowel=blur(render_detail,1.2)
        stipple=np.tanh(1.1*grain+.4*fine)
        render_h=14.7+.18*stipple+.025*render_detail+.045*fine-.9*major-.3*craze
        expected=paint*148+(1-paint)*209
        residual=q[...,1]-expected
        residual-=blur(residual,25)
        tone=128+.30*np.clip(residual,-40,40)+7*np.tanh(soft)+1.3*grain
        tone+=128-float(tone.mean())
        tone=np.uint8(np.clip(np.rint(tone),0,255))
        film=film_from_coverage(paint,tone.astype(np.float32))
        h=render_h+film
        base=np.array([221,209,183])+(.65*render_detail+2.2*stipple+1.0*soft-27*major-12*craze)[...,None]
        base=center_color(base,[221,209,183])
        rough=.95-.075*paint+.022*np.tanh(grain)+.02*major
        native_detail=.23*stipple+.045*fine
        extras=dict(paint=np.uint8(np.rint(paint*255)),paint_tone=tone)
        semantic=dict(paint=paint,paint_film_mm=film,render_height_mm=render_h,crack=major)
    elif name=='coral':
        # Preserve visible fossil sections; avoid compressing them to speckle.
        signal=lum-blur(lum,70)
        pore=ramp(-signal,16,52)
        shell=ramp(signal,5,26)*(1-pore)
        native_pit,pm=pores(rng,1450,(.8,17.0),(.5,7.0))
        native_detail=.035*fine+.07*grain
        # Fossil skeletons are flush; dissolution opens darker soft infills.
        h=15+.14*np.tanh(meso)+.22*shell+native_detail-5.4*blur(pore,.6)-native_pit
        base=center_color(q,[209,192,160])
        base=(base-np.array([209,192,160]))*.90+np.array([209,192,160])
        base-=pm[...,None]*13
        base+=(.8*grain)[...,None]
        base=center_color(base,[209,192,160])
        rough=.89-.065*shell+.07*pore+.016*np.tanh(grain)
        semantic=dict(void=np.maximum(pore,pm),shell=shell)
    elif name=='block':
        mid=blur(lum,1)
        pit=ramp(140-mid,12,52)
        pale=ramp(mid,153,185)
        cinder=ramp(143-mid,5,31)*(1-pit)
        native_pit,pm=pores(rng,6000,(.65,3.8),(.3,2.4))
        chips,cm=pores(rng,210,(4,10),(.9,3.6))
        native_detail=.10*fine+.16*grain
        h=15+.55*pale+.22*cinder+.30*np.tanh(small/17)+.13*meso+native_detail-2.5*pit-native_pit-chips
        base=color_mix([155,153,143],[196,187,166],pale*.85)
        base=color_mix(base,[103,105,99],cinder*.7)
        base=color_mix(base,[112,109,98],pit*.65)
        pigment=center_color(q,[154,151,139])
        base=base*.35+pigment*.65
        base+=(.12*np.clip(local,-35,35)+1.4*grain+1.8*soft)[...,None]
        base-=(pm*12+cm*8)[...,None]
        base=center_color(base,[154,151,139])
        rough=.925-.035*pale+.025*np.tanh(grain)+.04*pit+.025*pm
        semantic=dict(void=np.maximum(pit,pm),grain=pale,cinder=cinder)
    else:
        # Oxide uses chroma, so a source highlight is not a bright albedo rim.
        oxide=ramp(blur(q[...,0]-q[...,2],.8),45,88)
        pit=ramp(-small,9,30)
        flake=blur(oxide,1.0)
        native_pit,pm=pores(rng,1800,(.8,7.0),(.035,.28))
        native_detail=.012*fine+.020*grain
        h=4+.25*flake+.07*np.tanh(small/12)+.04*meso+native_detail-.25*pit-native_pit
        base=color_mix([84,49,31],[149,83,38],oxide)
        base=color_mix(base,[61,36,25],pit*.5)
        base+=(.6*grain+.25*soft)[...,None]
        rough=.89+.045*oxide+.035*pit+.012*np.tanh(grain)
        semantic=dict(oxide=oxide,void=np.maximum(pit,pm))
    scale=.25 if name=='rust' else 1.5
    span=8. if name=='rust' else 30.
    assert h.min()>0 and h.max()<span,(name,h.min(),h.max())
    base8=np.uint8(np.rint(np.clip(base,0,255)))
    h16=np.uint16(np.rint(h/span*65535))
    save_png(name,'base',base8,scale)
    save_png(name,'height',h16,scale)
    # Reopen the delivered height. +Y points UP the image, unlike array rows.
    saved=np.asarray(Image.open(ROOT/f'{name}_height.png'),np.float64)*span/65535
    pixel_mm=scale*1000/N
    dx=(np.roll(saved,-1,1)-np.roll(saved,1,1))/(2*pixel_mm)
    dy=(np.roll(saved,-1,0)-np.roll(saved,1,0))/(2*pixel_mm)
    normals=np.stack([-dx,dy,np.ones_like(dx)],axis=-1)
    normals/=np.linalg.norm(normals,axis=-1,keepdims=True)
    save_png(name,'normal',np.uint8(np.rint((normals*.5+.5)*255)),scale)
    save_png(name,'rough',np.uint8(np.rint(np.clip(rough,.65,.995)*255)),scale)
    for key,a in extras.items(): save_png(name,key,a,scale)

    info=dict(name=name,width_m=scale,black_white_mm=span,source=SOURCES[name],
              source_sha256=hashlib.sha256((ROOT/'source'/SOURCES[name]).read_bytes()).hexdigest(),
              mean_base_srgb=base8.mean((0,1)).tolist(),height_mm=[float(saved.min()),float(saved.max())],
              roughness_mean=float(np.mean(np.clip(rough,.65,.995))),
              native_detail_rms_mm=float(native_detail.std()),seconds=round(time.time()-t,2),
              quilt=plan,registration=registration_samples(h,semantic))
    if name=='broken': info['geometry']=geometry_info
    if name=='stucco':
        info['paint_film_mm']={'mean_whole':float(film[paint>.99].mean()),'maximum':float(film.max()),'mean_coverage':float(paint.mean())}
    print(name+': '+str(info['height_mm'])+' mm | '+str(info['mean_base_srgb']),flush=True)
    return info

def main():
    parser=argparse.ArgumentParser();parser.add_argument('materials',nargs='*',metavar='MATERIAL')
    parser.add_argument('--requilt',action='store_true',help='Compatibility flag; masters are always rebuilt in memory')
    args=parser.parse_args()
    names=args.materials or NAMES
    if any(n not in NAMES for n in names): parser.error('Materials: '+', '.join(NAMES))
    output=ROOT/'build_metadata.json'
    for name in names:
        info=make(name)
        metadata=json.loads(output.read_text()) if output.exists() else {}
        metadata[name]=info
        output.write_text(json.dumps(metadata,indent=2)+'\n')

if __name__=='__main__': main()
