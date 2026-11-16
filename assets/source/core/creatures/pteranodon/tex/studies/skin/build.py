#!/usr/bin/env python3
"""Rebuild five aligned material sets from the untouched generated artwork.

python3 tex/studies/skin/build.py
python3 tex/studies/skin/build.py --sets skin --skin-scale .85 --direction-deg 90
Scale is feature size, not panel span. Direction is in image coordinates.
No generation service, Blender, or nonlocal writes are needed to rebuild.
"""
from pathlib import Path
import argparse
import json
import hashlib
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy.fft import fft2, ifft2

ROOT = Path(__file__).resolve().parent
N = 2048
F = np.float32
CONFIG = {
    'skin': dict(span_m=.2, tiles=True, cutout=False, height_mm=.22, regions=[2],
                 form='tube', radius=.012, taper=.6, length=.3, dyed=True),
    'scutes': dict(span_m=.2, tiles=True, cutout=False, height_mm=.32, regions=[2],
                   form='tube', radius=.012, taper=.6, length=.3, dyed=True),
    'claw': dict(span_m=.06, tiles=False, cutout=False, height_mm=.10, regions=[],
                 form='none', dyed=False),
    'eye': dict(span_m=.05, tiles=False, cutout=False, height_mm=1.5, regions=[0],
                form='none', dyed=True),
    'mouth': dict(span_m=.2, tiles=True, cutout=False, height_mm=.10, regions=[],
                  form='tube', radius=.02, flat=.5, length=.6, dyed=False),
}

def srgb(v):
    v = np.clip(v, 0, 1)
    return np.where(v <= .0031308, v*12.92, 1.055*v**(1/2.4)-.055).astype(F)

def linear(v):
    return np.where(v <= .04045, v/12.92, ((v+.055)/1.055)**2.4).astype(F)

def smooth(v):
    v = np.clip(v, 0, 1)
    return v*v*(3-2*v)

def blur(a, sigma, mode='reflect'):
    # Separable float32 filtering; never filter across channels.
    return ndi.gaussian_filter(a, (sigma,sigma,0) if a.ndim==3 else sigma, mode=mode)

def resized(a, size):
    if a.ndim == 2:
        return np.asarray(Image.fromarray(a.astype(F)).resize((size,size), Image.Resampling.LANCZOS), dtype=F)
    return np.stack([resized(a[:,:,k], size) for k in range(a.shape[2])],2)

def load(name):
    return np.asarray(Image.open(ROOT/'source'/f'{name}_original.png').convert('RGB'), dtype=F)/255

def save(name, layer, a):
    if layer == 'height':
        im = Image.fromarray(np.rint(np.clip(a,0,1)*65535).astype(np.uint16))
    else:
        im = Image.fromarray(np.rint(np.clip(a,0,1)*255).astype(np.uint8))
    im.save(ROOT/f'{name}_{layer}.png')

def periodic(a):
    """Periodic-plus-smooth boundary decomposition (no mirrored scales)."""
    if a.ndim == 3:
        return np.stack([periodic(a[:,:,k]) for k in range(a.shape[2])],2)
    h,w = a.shape
    v = np.zeros_like(a)
    v[0,:] = a[-1,:]-a[0,:]
    v[-1,:] = -v[0,:]
    v[:,0] += a[:,-1]-a[:,0]
    v[:,-1] -= a[:,-1]-a[:,0]
    denom = (2*np.cos(2*np.pi*np.arange(h,dtype=F)/h)[:,None] +
             2*np.cos(2*np.pi*np.arange(w,dtype=F)/w)[None,:]-4)
    denom[0,0]=1
    f=fft2(v)/denom
    f[0,0]=0
    return (a-ifft2(f).real).astype(F)

def edge_finish(a, width=16):
    """C1 periodic edge repair: only a narrow, smooth change to fine grain."""
    a=a.copy()
    for axis in (0,1):
        b=np.moveaxis(a,axis,0)
        # Match one-sided values and slopes to the same bridge, not a flat strip.
        delta=b[-1]-b[0]
        for i in range(width):
            weight=(1-i/width)**3*.5
            b[i] += delta*weight
            b[-1-i] -= delta*weight
    return a

def cutpath(cost):
    cost=cost.copy()
    h,w=cost.shape
    back=np.zeros((h,w),np.int8)
    for y in range(1,h):
        prev=np.pad(cost[y-1],(1,1),constant_values=1e6)
        choices=np.stack((prev[:-2],prev[1:-1],prev[2:]))
        shift=np.argmin(choices,axis=0)
        back[y]=shift-1
        cost[y]+=np.min(choices,axis=0)
    path=np.empty(h,np.int32)
    path[-1]=np.argmin(cost[-1])
    for y in range(h-1,0,-1):
        path[y-1]=path[y]+back[y,path[y]]
    return path

def seamless_stitch(a, overlap=128):
    """Join a source's overlapping continuations with a minimum-error seam.

    The wrap itself comes from contiguous source pixels; the splice takes a
    winding path inside the tile, avoiding a straight amputated row of scutes.
    """
    for axis in (1,0):
        b=np.swapaxes(a,axis,1)
        left=b[:,:overlap]
        right=b[:,N:N+overlap]
        cost=(left-right)**2
        if cost.ndim==3: cost=cost.mean(2)
        path=cutpath(cost)
        blend=smooth((np.arange(overlap,dtype=F)[None,:]-path[:,None]+2)/4)
        if b.ndim==3: blend=blend[:,:,None]
        b=b[:,:N].copy()
        b[:,:overlap]=right*(1-blend)+left*blend
        a=np.swapaxes(b,axis,1)
    return a

def quilt_skin(source, feature_scale, seed=197, plates=False):
    # The raw source has 12,186 crowns over its square. At this resampling
    # the median centre spacing is ~1.1 mm instead of the source's 1.81 mm.
    source=resized(source,round((2176 if plates else 1240)*feature_scale))
    rng=np.random.default_rng(seed)
    patch,overlap=(576,96) if plates else (480,80)
    step=patch-overlap
    size=patch+step*4
    out=np.zeros((size,size),F)
    for row in range(5):
        for col in range(5):
            y,x=row*step,col*step
            best=None; bestcost=float('inf')
            for _ in range(28 if plates else 8):
                sy,sx=rng.integers(0,source.shape[0]-patch+1,2)
                p=source[sy:sy+patch,sx:sx+patch]
                if plates:
                    if rng.integers(2): p=p[::-1,:]
                else:
                    p=np.rot90(p,int(rng.integers(4)))
                cost=0
                if col: cost+=float(np.mean((out[y:y+patch,x:x+overlap]-p[:,:overlap])**2))
                if row: cost+=float(np.mean((out[y:y+overlap,x:x+patch]-p[:overlap])**2))
                if cost<bestcost: best=p.copy(); bestcost=cost
            keep=np.zeros((patch,patch),bool)
            old=out[y:y+patch,x:x+patch]
            if col:
                seam=cutpath((old[:,:overlap]-best[:,:overlap])**2)
                keep[:,:overlap]=np.arange(overlap)[None,:]<seam[:,None]
            if row:
                seam=cutpath(((old[:overlap]-best[:overlap])**2).T)
                keep[:overlap]|=np.arange(overlap)[:,None]<seam[None,:]
            # A 1px feather avoids hard sampling joins without smearing scale motifs.
            k=blur(keep.astype(F),.55)
            out[y:y+patch,x:x+patch]=old*k+best*(1-k)
    edge=N+128 if plates else N
    return out[:edge,:edge]

def rotate_tile(a, degrees):
    if degrees%90==0:
        return np.rot90(a, -round(degrees/90)).copy()
    yy,xx=np.mgrid[:N,:N].astype(F)
    angle=np.deg2rad(degrees)
    x=(xx-N/2)*np.cos(angle)+(yy-N/2)*np.sin(angle)+N/2
    y=-(xx-N/2)*np.sin(angle)+(yy-N/2)*np.cos(angle)+N/2
    return ndi.map_coordinates(a,[y,x],order=1,mode='wrap')

def grey_base(detail, mask=None, contrast=1):
    # Linear-light mean is the contract. Preserve pigment drawing, do not flatten it.
    if mask is None: mask=np.ones(detail.shape,bool)
    d=detail-detail[mask].mean()
    out=.5+contrast*d
    out=np.clip(out,.08,.85)
    out+=.5-out[mask].mean()
    return np.repeat(srgb(out)[:,:,None],3,2)

def normal_from_height(h, span, height_mm, tiles):
    # Readback quantization happens BEFORE differentiation, so the delivered
    # 16-bit height is exactly the surface whose normal is delivered.
    h=np.rint(h*65535).astype(F)/65535
    physical=h*(height_mm/1000)
    if tiles:
        dx=(np.roll(physical,-1,1)-np.roll(physical,1,1))/(2*span/N)
        dy=(np.roll(physical,-1,0)-np.roll(physical,1,0))/(2*span/N)
    else:
        dy,dx=np.gradient(physical,span/N)
    n=np.stack((-dx,dy,np.ones_like(h)),2)
    n/=np.linalg.norm(n,axis=2)[:,:,None]
    return n*.5+.5

def ao_from_height(h, strength=.20, tiles=False):
    valley=np.maximum(blur(h,6,'wrap' if tiles else 'reflect')-h,0)
    return np.clip(1-strength*valley, .90, 1)

def eye_horizon_occlusion(physical_mm):
    """Ambient sky blocked by the panel height, evenly sampled in 16 azimuths.

    A 512px field resolves the soft fold at .098 mm per texel; subpixel
    filament crevices are handled separately at the full map resolution.
    """
    h=resized(physical_mm,512)
    occlusion=np.zeros_like(h)
    for angle in np.arange(16)*2*np.pi/16:
        slope=np.zeros_like(h)
        for mm in [.25,.5,.85,1.3,2.,3.5]:
            px=mm*512/50
            shifted=ndi.shift(h,[-np.sin(angle)*px,-np.cos(angle)*px],
                              order=1,mode='nearest',prefilter=False)
            slope=np.maximum(slope,(shifted-h)/mm)
        occlusion+=slope/np.sqrt(1+slope*slope)/16
    return resized(occlusion,N)

def detailfield(a, sigma=40, mode='reflect'):
    return a-blur(a,sigma,mode)

def balance_quarters(base):
    """Remove only three smooth macro-value modes in linear light.

    Preserves the localized lighter wear; prevents its quadrant bias from being
    mistaken for illumination. There are no piecewise quadrant adjustments.
    """
    a=linear(base)
    wave=np.cos(np.pi*(np.arange(N,dtype=F)+.5)/N)
    m=wave[:N//2].mean()
    q=[a[y:y+N//2,x:x+N//2].mean((0,1)) for y in (0,N//2) for x in (0,N//2)]
    cx=(q[0]+q[2]-q[1]-q[3])/(4*m)
    cy=(q[0]+q[1]-q[2]-q[3])/(4*m)
    cxy=(q[0]-q[1]-q[2]+q[3])/(4*m*m)
    for c in range(3):
        a[:,:,c]-=cx[c]*wave[None,:]+cy[c]*wave[:,None]+cxy[c]*(wave[:,None]*wave[None,:])
    return srgb(a)

def build_tiled(name,args):
    original=load(name)
    lum=original.mean(2)
    if name=='skin':
        aligned=quilt_skin(lum,args.skin_scale)
    elif name=='scutes':
        aligned=seamless_stitch(quilt_skin(lum,args.scutes_scale,seed=539,plates=True))
    else:
        aligned=resized(lum,N+128)
        scale=args.mouth_scale
        if scale!=1:
            yy,xx=np.mgrid[:N+128,:N+128].astype(F)
            aligned=ndi.map_coordinates(aligned,[yy/scale,xx/scale],order=1,mode='wrap')
        aligned=seamless_stitch(aligned)
    aligned=rotate_tile(aligned,args.direction_deg)
    aligned=periodic(aligned)
    detail=detailfield(aligned,55,'wrap')
    detail=edge_finish(detail)
    if name=='skin':
        base=grey_base(detail,contrast=1.05)
        relief=np.clip(.48+detail*2.2,.06,.94)
        height=blur(relief,1.15,'wrap')
        rough=np.clip(.69-detail*.48,.57,.79)
    elif name=='scutes':
        base=grey_base(detail,contrast=1.30)
        relief=np.clip(.50+detail*3.1,.08,.92)
        height=blur(relief,1.6,'wrap')
        rough=np.clip(.59-detail*.60,.46,.72)
    else:
        # The generated tissue's hue is tempered towards pale pinkish grey.
        pigment=detail*.55
        base=np.clip(np.array([.65,.572,.581],F)[None,None,:]+pigment[:,:,None],0,1)
        relief=np.clip(.50+detail*5,.12,.88)
        height=blur(relief,2.3,'wrap')
        rough=np.clip(.32-detail*.65,.26,.38)
    height=edge_finish(height)
    ao=ao_from_height(height,.22,True)
    region=np.zeros((N,N,3),F)
    if name!='mouth': region[:,:,2]=1
    if name=='mouth':
        # Preserve the generated colour in the source comparison, at the same
        # registration as the scalar drawing used to construct the maps.
        aligned=np.clip(aligned[:,:,None]+(original.mean((0,1))-original.mean())[None,None,:],0,1)
    return base,height,np.stack((ao,rough,np.zeros_like(rough)),2),region,aligned

def build_eye(args):
    raw=load('eye')
    s=raw.shape[0]
    yy,xx=np.mgrid[:N,:N].astype(F)
    dx,dy=xx-(N-1)/2, yy-(N-1)/2
    r=np.hypot(dx,dy)
    # Detected source iris: centre (626,630), radii about 340/336 source px.
    # Nonlinear registration preserves iris detail while extending surrounding skin.
    iris_radius=args.eye_mm/.05/1000*N/2
    inner_scale=339/iris_radius
    factor=inner_scale+(s/N-inner_scale)*smooth((r-iris_radius-55)/600)
    sx=626+dx*factor; sy=630+dy*factor
    mapped=np.stack([ndi.map_coordinates(raw[:,:,k],[sy,sx],order=1,mode='reflect') for k in range(3)],2)
    # An actual colour boundary, with holes filled, follows the asymmetric lid.
    ry,rx=np.mgrid[:s,:s].astype(F)
    color=(raw[:,:,0]-raw[:,:,2]>.045)&(np.hypot(rx-626,ry-630)<385)
    color=ndi.binary_fill_holes(color)
    lab,count=ndi.label(color)
    sizes=np.bincount(lab.ravel()); sizes[0]=0
    color=lab==sizes.argmax()
    color=ndi.binary_fill_holes(ndi.binary_closing(color,iterations=3))
    # Inner 0.10 mm of lid is the undyed wet rim.
    wet=ndi.binary_dilation(color,iterations=4)
    eye=ndi.map_coordinates(wet.astype(F),[sy,sx],order=0,mode='nearest')>.5
    iris=ndi.map_coordinates(color.astype(F),[sy,sx],order=0,mode='nearest')>.5
    skin=~eye
    distout=ndi.distance_transform_edt(skin).astype(F)*.05/N*1000
    distin=ndi.distance_transform_edt(eye).astype(F)*.05/N*1000

    # Round 1: the original supplies ONLY the accepted eye and thin bare rim.
    # The new imagegen edit supplies the short horizontal facial filaments.
    # Register its eye to the accepted one, but never use its reinterpreted iris.
    surround_path=ROOT/'source'/'eye_surround_round1.png'
    surround=np.asarray(Image.open(surround_path).convert('RGB'),dtype=F)/255
    sh,sw=surround.shape[:2]
    ry,rx=np.mgrid[:sh,:sw].astype(F)
    warm=(surround[:,:,0]-surround[:,:,2]>.08)&(np.hypot(rx-sw/2,ry-sh/2)<min(sh,sw)*.28)
    warm=ndi.binary_fill_holes(warm)
    labels,_=ndi.label(warm)
    sizes=np.bincount(labels.ravel()); sizes[0]=0
    warm=ndi.binary_fill_holes(labels==sizes.argmax())
    cy,cx=ndi.center_of_mass(warm)
    surround_scale=np.sqrt(warm.sum()/iris.sum())
    sx=cx+dx*surround_scale; sy=cy+dy*surround_scale
    field=np.stack([ndi.map_coordinates(surround[:,:,k],[sy,sx],order=1,mode='reflect') for k in range(3)],2)
    gray=field.mean(2)
    # Exclude the coloured eye and its dark inner edge before removing broad
    # light, so neither makes a bright halo in the neutral skin/fuzz base.
    safe=distout>.65
    nearest=ndi.distance_transform_edt(~safe,return_distances=False,return_indices=True)
    filled=gray[tuple(nearest)]
    fuzz_detail=detailfield(filled,38)
    skin_detail=detailfield(mapped.mean(2),35)
    # A narrow irregular transition follows fine strand tips. Bare skin ends
    # within 2.1 mm of the wet edge; beyond it every pixel is facial fuzz.
    edge_waver=np.clip(blur(fuzz_detail,2.0)*2.2,-.16,.16)
    fuzz=smooth((distout-args.eye_lid_mm-edge_waver)/.55)*skin
    # Retain the generated strand contrast in albedo. At a .50 linear mean,
    # sRGB encoding attenuates it; compensate here instead of carving it into
    # an overly strong normal map. The thin skin keeps its accepted contrast.
    detail=.80*skin_detail*(1-fuzz)+1.30*fuzz_detail*fuzz
    base=grey_base(detail,skin)
    base[eye]=mapped[eye]
    # This is the unchanged accepted iris/inner-rim base construction.
    base[eye&~iris]*=.82

    iris_r=iris_radius*.05/N*1000
    # Smooth corneal cap: iris pigment does not become carved relief.
    cap=.72*smooth(distin/iris_r)
    lid=.12*np.exp(-((distout-.28)/.24)**2)*skin
    # One soft upper fold, not concentric ornamental wrinkles. Its steeper
    # inner lip overhangs the upper lid; a broad outer shoulder carries fuzz.
    upper=smooth((-dy/np.maximum(r,1)-.10)/.90)
    shoulder=np.where(distout<1.15,.68,1.65)
    brow=args.eye_brow_mm*np.exp(-((distout-1.15)/shoulder)**2)*upper*skin
    skin_micro=np.clip(skin_detail,-.1,.1)*.10
    pile_micro=np.clip(blur(fuzz_detail,1.35)*.38,-.045,.060)
    micro=(skin_micro*(1-fuzz)+pile_micro*fuzz)*skin
    height=np.clip((.35+cap+lid+brow+micro+.035*fuzz)/1.5,0,1)
    rough=np.clip(.62-skin_detail*.4,.48,.74)*(1-fuzz)+np.clip(.90-fuzz_detail*.12,.86,.94)*fuzz
    rough[eye]=.075
    rough[eye&~iris]=.18
    ao=ao_from_height(height,.25)
    # Directionless ambient occlusion from the actual fold's concavity.
    # All azimuths are treated alike; it is the raised upper fold that shades
    # its inner side. No brow shadow is added to base colour.
    physical=height*1.5
    cavity=np.maximum(blur(physical,20)-physical,0)
    ao*=1-np.clip(cavity*1.65,0,.14)
    # Height-horizon comparison isolates the sky blocked by the upper fold.
    # It shades the lid beneath it even where a local blur sees a convex lip.
    brow_occlusion=np.clip(eye_horizon_occlusion(physical)-
                           eye_horizon_occlusion(physical-brow),0,.18)
    ao*=1-brow_occlusion
    # Keep reusable aligned scalar layers for this panel's lid/fuzz/brow.
    elements=ROOT/'source'
    for name,a in [('eye_fuzz_weight',fuzz),('eye_brow_height',brow/1.5),
                   ('eye_brow_occlusion',brow_occlusion)]:
        if args.panel_turns%4: a=np.rot90(a,-(args.panel_turns%4)).copy()
        Image.fromarray(np.rint(np.clip(a,0,1)*65535).astype(np.uint16)).save(elements/f'{name}.png')
    (elements/'eye_layers.json').write_text(json.dumps({
        'span_m':.05,'size_px':N,'panel_turns_clockwise':args.panel_turns%4,
        'eye_fuzz_weight.png':'16-bit weight: 0 bare lid, 1 face fuzz; aligned to delivered maps',
        'eye_brow_height.png':'16-bit additive height, black-to-white = 1.5 mm',
        'eye_brow_occlusion.png':'16-bit fraction of ambient sky occluded by the brow',
        'source':'eye_surround_round1.png'},indent=2)+'\n')
    region=np.zeros((N,N,3),F); region[:,:,0]=skin
    CONFIG['eye']['eye_mm']=args.eye_mm
    CONFIG['eye']['revision']='round 1 feedback: narrow bare lid, horizontal face fuzz, soft upper brow'
    CONFIG['eye']['bare_lid_mm']={'full_skin':args.eye_lid_mm-.16,'full_fuzz':args.eye_lid_mm+.55+.16}
    CONFIG['eye']['fuzz_filament_mm']=[2,4]
    CONFIG['eye']['brow_peak_mm']=args.eye_brow_mm
    CONFIG['eye']['surround_source']='source/eye_surround_round1.png'
    CONFIG['eye']['sha256_surround_source']=hashlib.sha256(surround_path.read_bytes()).hexdigest()
    CONFIG['eye']['surround_registration']={'source_center_px':[float(cx),float(cy)],'source_px_per_output_px':float(surround_scale)}
    CONFIG['eye']['elements']=[{'name':'eye_and_lid','box':[int(N/2-iris_radius-80),int(N/2-iris_radius-100),int(N/2+iris_radius+80),int(N/2+iris_radius+80)],'center':[1024,1024]}]
    # Review original in the identical registration, restoring accepted eye.
    field[eye]=mapped[eye]
    return base,height,np.stack((ao,rough,np.zeros_like(rough)),2),region,field

def build_claw(args):
    raw=load('claw')
    # Scale the source's 1,280px curved centreline to 45mm in the 60mm panel.
    # Source 1254 panel: root (115,490), hooked tip (1033,1073).
    curve=np.array([[115,490],[400,435],[704,493],[942,674],[1058,904],[1033,1073]],F)
    arclength=np.linalg.norm(np.diff(curve,axis=0),axis=1).sum()
    scale=(args.claw_mm/.06/1000*N)/arclength
    yy,xx=np.mgrid[:N,:N].astype(F)
    root=np.array([310,710],F)
    sx=(xx-root[0])/scale+115
    sy=(yy-root[1])/scale+490
    # Extend plain horn into the margin. Never reflect the claw into a second hook.
    mapped=np.stack([ndi.map_coordinates(raw[:,:,k],[sy,sx],order=1,mode='nearest') for k in range(3)],2)
    backing=np.stack([ndi.map_coordinates(raw[:190,:,k],[(sy*.65)%189,sx%1253],order=1,mode='wrap') for k in range(3)],2)
    edge=np.minimum.reduce([sx,sy,1253-sx,1253-sy])
    inside=smooth(edge/65)
    mapped=mapped*inside[:,:,None]+backing*(1-inside[:,:,None])
    lum=mapped.mean(2)
    grain=detailfield(lum,16)
    # Retain local pigment grain while removing the source's light-facing broad edge.
    base=np.empty_like(mapped)
    natural=np.array([.135,.125,.113],F)
    # Continuous wear on the hooked point, intrinsic lighter horn not lighting.
    tip=root+(curve[-1]-curve[0])*scale
    worn=np.exp(-(((xx-tip[0])/105)**2+((yy-tip[1]+60)/175)**2))
    for k in range(3): base[:,:,k]=natural[k]+grain*.80+worn*.075
    # Keep a small source-derived patch-to-patch keratin variation.
    mid=blur(lum,8)-blur(lum,70)
    base+=mid[:,:,None]*.25
    base=np.clip(base,.035,.32)
    base=balance_quarters(base)
    height=np.clip(.5+blur(grain,1.2)*3.2,.10,.90)
    rough=np.clip(.245-grain*.7-worn*.09,.13,.33)
    ao=ao_from_height(height,.16)
    region=np.zeros((N,N,3),F)
    points=root+(curve-curve[0])*scale
    CONFIG['claw']['curve_mm']=args.claw_mm
    CONFIG['claw']['elements']=[{'name':'claw_side','box':[175,490,1500,1420],
                                'root':root.round().astype(int).tolist(),
                                'tip':tip.round().astype(int).tolist(),
                                'centerline':points.round().astype(int).tolist()}]
    return base,height,np.stack((ao,rough,np.zeros_like(rough)),2),region,mapped

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--sets',default=','.join(CONFIG))
    p.add_argument('--skin-scale',type=float,default=1)
    p.add_argument('--scutes-scale',type=float,default=1)
    p.add_argument('--mouth-scale',type=float,default=1)
    p.add_argument('--direction-deg',type=float,default=0)
    p.add_argument('--eye-mm',type=float,default=18)
    p.add_argument('--eye-lid-mm',type=float,default=1.35,help='bare lid width before a .55 mm filament transition')
    p.add_argument('--eye-brow-mm',type=float,default=.38,help='height of the soft upper fold')
    p.add_argument('--claw-mm',type=float,default=45)
    p.add_argument('--panel-turns',type=int,default=0,help='clockwise quarter turns of eye/claw, preserving pure masks')
    args=p.parse_args()
    (ROOT/'checks'/'aligned').mkdir(parents=True,exist_ok=True)
    results={}
    if (ROOT/'study.json').exists(): results=json.loads((ROOT/'study.json').read_text())['sets']
    for name in args.sets.split(','):
        print('Building',name,flush=True)
        base,h,packed,regions,aligned=(build_eye(args) if name=='eye' else build_claw(args) if name=='claw' else build_tiled(name,args))
        cfg=CONFIG[name].copy()
        if name in ['eye','claw'] and args.panel_turns%4:
            turns=args.panel_turns%4
            base,h,packed,regions,aligned=[np.rot90(a,-turns).copy() for a in [base,h,packed,regions,aligned]]
            def turnpoint(p):
                x,y=p
                for _ in range(turns): x,y=N-1-y,x
                return [x,y]
            for element in cfg.get('elements',[]):
                for key in ['root','tip','center']:
                    if key in element: element[key]=turnpoint(element[key])
                if 'centerline' in element: element['centerline']=[turnpoint(p) for p in element['centerline']]
                x0,y0,x1,y1=element['box']
                pts=np.array([turnpoint(p) for p in [(x0,y0),(x0,y1),(x1,y0),(x1,y1)]])
                element['box']=np.concatenate((pts.min(0),pts.max(0))).tolist()
        cfg['size_px']=N
        cfg['normal_convention']='OpenGL, +Y towards image top'
        cfg['source']='source/'+name+'_original.png'
        cfg['parameters']=vars(args)
        cfg['sha256_source']=hashlib.sha256((ROOT/cfg['source']).read_bytes()).hexdigest()
        cfg['animal_texels_per_m']=2400
        cfg['detail_direction']='root left, tip right' if name=='claw' else 'toe/ridges left to right; scutes cross top to bottom' if name in ['scutes','mouth'] else 'isotropic'
        if name=='eye': cfg['detail_direction']='face fuzz left to right, beak to nape; brow above the eye'
        n=normal_from_height(h,cfg['span_m'],cfg['height_mm'],cfg['tiles'])
        for layer,a in [('base',base),('height',h),('normal',n),('packed',packed),('regions',regions)]: save(name,layer,a)
        if aligned.ndim==2: aligned=np.repeat(aligned[:,:,None],3,2)
        Image.fromarray(np.rint(np.clip(aligned,0,1)*255).astype(np.uint8)).save(ROOT/'checks'/'aligned'/f'{name}.png')
        results[name]=cfg
        del base,h,packed,regions,n,aligned
    info={'title':'Pteranodon: feet, claws, eye and mouth','resolution':N,
          'region_encoding':{'0':[255,0,0],'2':[0,0,255],'undyed':[0,0,0]},
          'source_method':'Built-in imagegen; five original sources plus round-1 eye-surround edits; untouched originals retained in source/',
          'height_note':'height_mm is the physical range represented by black-to-white; it need not all be occupied',
          'sets':results}
    (ROOT/'study.json').write_text(json.dumps(info,indent=2)+'\n')

if __name__=='__main__': main()
