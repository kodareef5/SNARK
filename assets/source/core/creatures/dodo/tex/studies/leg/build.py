#!/usr/bin/env python3
"""Rebuild the leg study. Dependencies: Pillow, NumPy, SciPy.

Only writes beneath this file's directory. Generated sources are immutable.
Round 3 retains intrinsic source drawing in the base and reconstructs smooth
keratin relief from the crease network. This is not calibrated scan data.
--scale changes physical size, --direction rotates the unroll by quarter turns.
"""
from pathlib import Path
import argparse
import hashlib
import json
import time
import numpy as np
from PIL import Image, PngImagePlugin
from scipy.ndimage import gaussian_filter, gaussian_filter1d, map_coordinates, distance_transform_edt, label, find_objects, binary_fill_holes

ROOT = Path(__file__).resolve().parent
SEED = 183207
CONFIG = {
    'shank': dict(size=2048, span_m=.125, height_mm=.8, tiles=[True, True], regions=[3]),
    'toe': dict(size=1024, span_m=.060, height_mm=.7, tiles=[True, True], regions=[3]),
    'claw': dict(size=1024, span_m=.030, height_mm=.08, tiles=[True, False], regions=[]),
}


def smooth(a, b, v):
    t = np.clip((v-a)/(b-a), 0, 1)
    return t*t*(3-2*t)


def to_linear(a):
    return np.where(a <= .04045, a/12.92, ((a+.055)/1.055)**2.4)


def to_srgb(a):
    a = np.maximum(a, 0)
    return np.where(a <= .0031308, a*12.92, 1.055*a**(1/2.4)-.055)


def save(path, a, srgb=False, bits=8):
    info = PngImagePlugin.PngInfo()
    info.add(b'gAMA', (45455 if srgb else 100000).to_bytes(4, 'big'))
    if srgb:
        info.add(b'sRGB', b'\x00')
    info.add_text('Description', 'Dodo leg study; ' + ('sRGB base colour' if srgb else 'linear material data'))
    code = np.uint16(np.clip(np.rint(a*65535), 0, 65535)) if bits == 16 else np.uint8(np.clip(np.rint(a*255), 0, 255))
    Image.fromarray(code).save(ROOT/path, pnginfo=info)
    return code


def noise(n, sigma, seed, mode=('wrap','wrap')):
    a = np.random.default_rng(seed).normal(size=(n,n)).astype(np.float32)
    a = gaussian_filter(a, sigma, mode=mode)
    return a/(a.std()+1e-7)


def minimum_seam(cost):
    """Vertical minimum-error seam through an overlap; no full-strip dissolve."""
    h,w = cost.shape
    back = np.zeros((h,w), np.int8)
    acc = cost[0].copy()
    for y in range(1,h):
        opts = np.stack((np.r_[np.inf,acc[:-1]], acc, np.r_[acc[1:],np.inf]))
        arg = opts.argmin(axis=0)
        back[y] = arg-1
        acc = cost[y]+opts[arg,np.arange(w)]
    path = np.zeros(h, np.int32)
    path[-1] = np.argmin(acc)
    for y in range(h-1,0,-1):
        path[y-1] = path[y]+back[y,path[y]]
    return path


def stitch_x(a, width_fraction=.105):
    """Replace the wrap with continuous side/sole material, quilted at its sides.

    The x=0 seam itself is entirely from a continuous interior donor. Two narrow
    minimum-error joins sit away from the wrap, following the organic texture.
    """
    n = a.shape[1]
    width = int(n*width_fraction)//2*2
    overlap = width//3
    half = width//2
    rolled = np.roll(a,n//2,axis=1).copy()
    lo,hi = n//2-half,n//2+half
    # Left edge content has the same biological identity as the wrap:
    # rear pebbles on shank, sole pads on toe, horn on claw.
    donor = a[:,int(n*.035):int(n*.035)+width].copy()
    old = rolled[:,lo:hi].copy()
    for left in [True,False]:
        sl = slice(0,overlap) if left else slice(width-overlap,width)
        d = donor[:,sl]-old[:,sl]
        cost = d*d if d.ndim == 2 else (d*d).mean(axis=2)
        # Avoid seams running at the end of the available overlap.
        cost[:, :2] += .5
        cost[:, -2:] += .5
        path = minimum_seam(gaussian_filter(cost, (.7,.7)))
        xx = np.arange(overlap)[None,:]
        take = smooth(-1.5,1.5,xx-path[:,None])
        if not left:
            take = 1-take
        if a.ndim == 3:
            take = take[:,:,None]
        donor[:,sl] = old[:,sl]*(1-take)+donor[:,sl]*take
    rolled[:,lo:hi] = donor
    return np.roll(rolled,-n//2,axis=1)


def bridge_y(a, row, width=8):
    """C1 bridge only where unrelated source rows meet; periodic coordinates."""
    n = len(a)
    ids = np.arange(row-width,row+width+1)%n
    v0,v1 = a[ids[0]].copy(),a[ids[-1]].copy()
    d0 = (a[ids[0]]-a[(ids[0]-1)%n])*(2*width)
    d1 = (a[(ids[-1]+1)%n]-a[ids[-1]])*(2*width)
    t = np.linspace(0,1,len(ids))[:,None]
    if a.ndim==3:
        t=t[:,:,None]
    # Limit extrapolation at unmatched tiny scales.
    d0,d1 = [np.clip(d,-.16,.16) for d in (d0,d1)]
    a[ids] = (2*t**3-3*t**2+1)*v0 + (t**3-2*t**2+t)*d0 + (-2*t**3+3*t**2)*v1 + (t**3-t**2)*d1


def normal_from_height(h,c):
    scale=c['height_mm']*.001/(c['span_m']/h.shape[0])
    dx=(np.roll(h,-1,1)-np.roll(h,1,1))*.5
    dy=(np.roll(h,-1,0)-np.roll(h,1,0))*.5 if c['tiles'][1] else np.gradient(h,axis=0)
    if not c['tiles'][0]:
        dx=np.gradient(h,axis=1)
    normal=np.stack((-dx*scale,dy*scale,np.ones_like(h)),axis=2)
    return normal/np.linalg.norm(normal,axis=2,keepdims=True)


def ao_from_height(h,c):
    """Eight equal azimuth horizons; no chosen light direction."""
    scale=c['height_mm']*.001/(c['span_m']/len(h))
    n=len(h)
    result=np.zeros_like(h)
    for dx,dy in [(1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)]:
        horizon=np.zeros_like(h)
        for r in [1,2,4,8,16]:
            ys=np.arange(n)+dy*r
            xs=np.arange(n)+dx*r
            ys=ys%n if c['tiles'][1] else np.clip(ys,0,n-1)
            xs=xs%n if c['tiles'][0] else np.clip(xs,0,n-1)
            near=h[np.ix_(ys,xs)]
            slope=np.maximum(near-h-.001,0)*scale/(r*np.hypot(dx,dy))
            horizon=np.maximum(horizon,np.arctan(slope))
        result+=np.sin(horizon)/8
    return np.clip(1-.8*result,.72,1)


def unlit_pigment(p, normal):
    """Remove directional x/y response and broad exposure, retain crease pigment.

    Crucially, normal Z is not a broad lighting direction. Projecting all material
    drawing out against Z erased the crease network in round 1.
    """
    n=len(p)
    y,x=np.mgrid[:n,:n]/n
    basis=[normal[:,:,0],normal[:,:,1],np.sin(2*np.pi*x),np.sin(2*np.pi*y),
           np.sin(2*np.pi*x)*np.sin(2*np.pi*y)]
    q=p.astype(np.float64)
    for _ in range(5):
        q-=q.mean()
        for z in basis:
            z=z-z.mean()
            q-=np.mean(q*z)/(np.mean(z*z)+1e-12)*z
    return .5+q.astype(np.float32)


def periodic_source(src):
    """Remove the harmonic boundary mismatch; preserve every guide-aligned scute.

    The R3 guide already has periodic topology. Donor quilting would cut intact
    polygons. Solve only the residual boundary value mismatch instead.
    """
    n=len(src)
    v=np.zeros_like(src,dtype=np.float64)
    v[0,:]=src[-1,:]-src[0,:];v[-1,:]=-v[0,:]
    jump=src[:,-1]-src[:,0];v[:,0]+=jump;v[:,-1]-=jump
    freqs=2*np.pi*np.arange(n)/n
    denom=2*np.cos(freqs)[:,None]+2*np.cos(freqs)[None,:]-4
    denom[0,0]=1
    spectrum=np.fft.fft2(v)/denom;spectrum[0,0]=0
    correction=np.fft.ifft2(spectrum).real
    return (src-correction).astype(np.float32)


def source_tile(name,n):
    src=np.asarray(Image.open(ROOT/'source'/f'r3_{name}_generated.png').convert('L').resize((n,n),Image.Resampling.LANCZOS),np.float32)/255
    return periodic_source(src)


def periodic_distance(mask,pad):
    padded=np.pad(mask,pad,mode='wrap')
    return distance_transform_edt(padded)[pad:-pad,pad:-pad].astype(np.float32)


def build_scales(name,c):
    n=c['size']; mmpp=c['span_m']*1000/n
    source=source_tile(name,n)
    mode=('wrap','wrap')
    g=gaussian_filter(source,.15/mmpp,mode=mode)
    local=g-gaussian_filter(g,2.0/mmpp,mode=mode)
    # Only the dark outline network determines macroscopic relief. Remove tiny
    # disconnected pigment pores so the intact plate faces cannot become craters.
    crease=local<-.026
    labs,count=label(crease)
    areas=np.bincount(labs.ravel())
    # Small dark pigment flecks inside broad scutes are not geometric holes.
    crease &= areas[labs]>max(5,round((.65 if name=='shank' else .09)/mmpp**2))
    dist=periodic_distance(~crease,round(8/mmpp))*mmpp
    # Firm rounded shoulders and a very gentle broad dome, in millimetres.
    # Unlike brightness-to-height this cannot inflate fine face grain into bark.
    dome=.18*(1-np.exp(-dist/.20))+.22*(1-np.exp(-dist/1.35))
    dome=gaussian_filter(dome,.11/mmpp,mode=mode)
    grain=source-gaussian_filter(source,.11/mmpp,mode=mode)
    height=(.09+dome+.003*np.tanh(grain*12))/c['height_mm']
    height=gaussian_filter(height,.45,mode=mode)
    if name=='shank':
        edge=np.minimum(np.arange(n),n-1-np.arange(n))[None,:]
        weight=.85*(1-smooth(0,16,edge))
        height+=(gaussian_filter1d(height,2.0,axis=1,mode='wrap')-height)*weight
    height_q=np.rint(height*65535)/65535
    normal=normal_from_height(height_q,c)
    # Preserve the generated fine grain and all of the intrinsic outline drawing.
    # Reinforce dark crease pigment independently of the geometric slope/rim.
    intrinsic=source-gaussian_filter(source,5/mmpp,mode=mode)
    if name=='shank':
        # The new master has a few coarse pigment mottles. Restrain those while
        # retaining its fine face grain and the complete crease network.
        intrinsic=.65*intrinsic+.35*(source-gaussian_filter(source,.11/mmpp,mode=mode))
    floor=gaussian_filter(crease.astype(np.float32),.07/mmpp,mode=mode)
    pigment=1.15*intrinsic-.09*floor+.008*noise(n,.9/mmpp,SEED+11)
    linear=unlit_pigment(pigment,normal)
    base=np.repeat(to_srgb(np.clip(linear,.10,.85))[:,:,None],3,axis=2)
    x=np.arange(n)[None,:]/n
    sole=(1-smooth(.15,.29,np.minimum(x,1-x))) if name=='toe' else np.zeros((1,n))
    rough=np.clip(.58+.10*floor+.08*sole+.011*np.tanh(grain*20),.53,.79)
    # Source-aligned reusable compact scute patches; six distinct large faces.
    interiors=~crease
    labs,count=label(interiors)
    boxes=[]; dimensions=[]
    for i,sl in enumerate(find_objects(labs)):
        if sl is None: continue
        yy,xx=sl; w=xx.stop-xx.start; h=yy.stop-yy.start
        cx=(xx.start+xx.stop)/2/n; cy=(yy.start+yy.stop)/2/n
        if .25<cx<.75 and .09<cy<.78 and min(w,h)*mmpp>3 and max(w,h)*mmpp<14:
            pad=round(.3/mmpp)
            boxes.append([max(0,xx.start-pad),max(0,yy.start-pad),min(n,xx.stop+pad),min(n,yy.stop+pad)])
            dimensions.append([round(w*mmpp,2),round(h*mmpp,2)])
    order=sorted(range(len(boxes)),key=lambda i:boxes[i][1])
    selected=[order[i] for i in np.linspace(0,len(order)-1,min(6,len(order))).astype(int)]
    meta=dict(layout='unequal irregular polygon scutes, no lattice; whole front half plated, smaller side plates, rear scales',
              large_plate_circumference_fraction=.50 if name=='shank' else .70,
              side_plate_diameter_mm=[3,5],
              source_prompt=f'source/r3_{name}_prompt.txt',
              central_plate_dimensions_mm=dimensions,element_boxes=[boxes[i] for i in selected],
              pebble_diameter_mm=[1.5,3] if name=='shank' else [1,2],
              relief_method='distance from source crease network; soft rounded shoulders; 3 micron maximum grain',
              base_method='generated intrinsic crease and grain drawing, directional XY and broad exposure removed')
    return base,height,rough,meta


def build_claw(c):
    n=c['size']; mode=('reflect','wrap')
    rgb=np.asarray(Image.open(ROOT/'source/r2_claw_generated.png').convert('RGB').resize((n,n),Image.Resampling.LANCZOS),np.float32)/255
    rgb=stitch_x(rgb,.10)
    lum=sum(rgb[:,:,k]*v for k,v in enumerate([.2126,.7152,.0722]))
    detail=gaussian_filter(lum,1.0,mode=mode)-gaussian_filter(lum,n*.06,mode=mode)
    y,x=np.mgrid[:n,:n].astype(np.float32)/n
    worn=smooth(.08,.92,y)
    # Full-length pigment run, explicitly independent of lighting and height.
    base=np.empty_like(rgb)
    for k,(root,tip) in enumerate(zip([77,70,63],[136,131,123])):
        base[:,:,k]=(root+(tip-root)*worn)/255+.45*detail
    # Smooth horn growth structure, entirely analytic: NO noise in height.
    # Broad micron-scale undulations and five faint wandering longitudinal traces.
    height=.5+.20*np.sin(2*np.pi*(3.1*y+.13*np.sin(2*np.pi*x)))*( .7+.3*np.cos(2*np.pi*x))*(1-.3*worn)
    for i,(pos,width,amp) in enumerate(zip([.105,.29,.47,.69,.875],[.004,.005,.0035,.0045,.0038],[.10,.075,.08,.09,.07])):
        centre=pos+.021*np.sin(2*np.pi*(1.4*y+i*.27))+.010*np.sin(2*np.pi*(3*y+i*.13))
        dx=(x-centre+.5)%1-.5
        trace=np.exp(-(dx/width)**2)
        length_envelope=smooth(.01,.12,y)*(1-.65*smooth(.72,1,y))
        height+=amp*trace*length_envelope
        base-=((1.4/255)*trace*length_envelope)[:,:,None]
    height=gaussian_filter(height,.8,mode=mode)
    rough=.30-.095*worn+.003*np.tanh(detail*20)
    meta=dict(root='top',worn_tip='bottom',growth_lines='five faint wandering longitudinal traces; smooth analytic growth relief, no height noise',
              deliberate_pigment_gradient='Full-length sRGB mean 70 at root to 130 at worn tip; undyed grey-brown horn.',
              root_srgb=[77,70,63],tip_srgb=[136,131,123])
    return np.clip(base,0,1),height,rough,meta


def export_elements(name,c,meta,maps):
    if name=='claw':
        return []
    out=[]
    n=c['size']
    for i,box in enumerate(meta['element_boxes']):
        lo,hi=box[1],box[3]
        element=f'{name}_plate_{i+1:02d}'
        directory=ROOT/'elements'/element
        directory.mkdir(exist_ok=True,parents=True)
        for layer in maps:
            with Image.open(ROOT/f'{name}_{layer}.png') as im:
                # Exact crop retains bit depth and alignment; context patches,
                # not isolated RGBA plates or replacements for the square sets.
                info=PngImagePlugin.PngInfo()
                info.add(b'gAMA',(45455 if layer=='base' else 100000).to_bytes(4,'big'))
                if layer=='base':
                    info.add(b'sRGB',b'\x00')
                info.add_text('Description',f'Aligned {element} context patch from {name}; full height range {c["height_mm"]} mm')
                im.crop(tuple(box)).save(directory/f'{layer}.png',pnginfo=info)
        out.append(dict(name=element,box_px=box,root_px=[(box[0]+box[2])//2,lo],
                        tip_px=[(box[0]+box[2])//2,hi-1],
                        source_set=name,cutout=False,usage='Aligned plate context patch; includes the soft rim and neighbouring crease.',
                        span_m=[(box[2]-box[0])/n*c['span_m'],(hi-lo)/n*c['span_m']]))
    return out


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--scale',type=float,default=1.,help='uniform physical span multiplier')
    ap.add_argument('--direction',type=int,choices=[0,90,180,270],default=0,help='clockwise orientation in degrees')
    ap.add_argument('--set',choices=list(CONFIG),action='append',dest='sets')
    args=ap.parse_args()
    if args.scale<=0:
        ap.error('--scale must be positive')
    start=time.time()
    manifest=dict(schema=2,round=3,title='Dodo cobbled shank, toe and polished claw material study',seed=SEED,
                  normal_convention='OpenGL +Y: N = normalize(-dH/dx, +dH/dimage_y, 1)',
                  packed_channels=dict(R='height-derived isotropic ambient occlusion',G='roughness',B='metalness (zero)'),
                  dye_math='linear(base) * linear(dye) / 0.5',
                  tiles_order=['across / x','down / y'],direction_degrees=args.direction,scale=args.scale,
                  sources=[],sets={})
    if args.sets and (ROOT/'study.json').exists():
        previous=json.loads((ROOT/'study.json').read_text())
        if previous.get('scale')!=args.scale or previous.get('direction_degrees')!=args.direction:
            ap.error('A partial build must keep the current scale and direction; omit --set to change them.')
        manifest['sets']=previous['sets']
    for original,prompt in [
        ('r2_claw_generated.png','r2_claw_final_prompt.txt'),
        ('r3_shank_generated.png','r3_shank_prompt.txt'),
        ('r3_toe_generated.png','r3_toe_prompt.txt'),
    ]:
        p=ROOT/'source'/original
        manifest['sources'].append(dict(path=str(p.relative_to(ROOT)),sha256=hashlib.sha256(p.read_bytes()).hexdigest(),
                                       prompt=f'source/{prompt}',size=list(Image.open(p).size),
                                       method='Built-in image generation; immutable original'))
    for name,c0 in CONFIG.items():
        if args.sets and name not in args.sets:
            continue
        c=dict(c0)
        c['span_m']*=args.scale
        base,height,rough,meta=build_claw(c) if name=='claw' else build_scales(name,c)
        turns=-(args.direction//90)
        if turns:
            base,height,rough=[np.rot90(a,turns).copy() for a in (base,height,rough)]
            if abs(turns)%2:
                c['tiles']=list(reversed(c['tiles']))
        h16=save(f'{name}_height.png',height,bits=16)
        h=h16.astype(np.float32)/65535
        normal=normal_from_height(h,c)
        ao=ao_from_height(h,c)
        save(f'{name}_base.png',base,srgb=True)
        save(f'{name}_normal.png',normal*.5+.5)
        save(f'{name}_packed.png',np.stack((ao,rough,np.zeros_like(h)),axis=2))
        regions=np.zeros((c['size'],c['size'],3),np.float32)
        if name!='claw':
            regions[:,:,1:]=1
        save(f'{name}_regions.png',regions)
        c.update(meta)
        c.update(cutout=False,height_used_mm=[float(h.min()*c['height_mm']),float(h.max()*c['height_mm'])],
                 direction='top=root, bottom=tip' if not turns else f'rotated {args.direction} degrees clockwise',
                 source=f'source/{"r2" if name=="claw" else "r3"}_{name}_generated.png',
                 files={layer:f'{name}_{layer}.png' for layer in ['base','height','normal','packed','regions']})
        c['elements']=export_elements(name,c,meta,c['files']) if not turns else []
        manifest['sets'][name]=c
        print(f'{name}: {c["size"]} px, {c["span_m"]} m, {c["height_mm"]} mm full-range height',flush=True)
    (ROOT/'study.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(f'Build: {time.time()-start:.1f} s',flush=True)


if __name__=='__main__':
    main()
