#!/usr/bin/env python3
"""Build periodic 3 m dressed limestone; physical height units are millimetres.

Revision 3 changes mineral colour only; revision 2 relief is preserved exactly.
Both preserve patch_layout.json. Chisel strokes are individual
supersampled multi-tooth cuts, not dashes on shared lanes. Dependencies: Pillow,
NumPy, SciPy. Run this script, then check_material.py.
"""
from pathlib import Path
import hashlib
import json
import time

import numpy as np
from PIL import Image, ImageCms
from scipy.ndimage import gaussian_filter, map_coordinates

ROOT = Path(__file__).resolve().parent
N = 2048
TILE_MM = 3000.0
HEIGHT_MM = 6.0
MM_PER_PX = TILE_MM / N
SEED = 141126


def blur(a, sigma):
    return gaussian_filter(a, sigma, mode="wrap")


def noise(rng, sigma, shape=(N, N)):
    a = gaussian_filter(rng.standard_normal(shape).astype(np.float32), sigma, mode="wrap")
    return (a-a.mean()) / max(float(a.std()), 1e-8)


def smooth(a):
    a = np.clip(a, 0, 1)
    return a*a*(3-2*a)


def carve_strokes(size, theta, rng, style):
    """Cut a face with independent overlapping chisel passes, 2x antialiasing.

    A pass has one curved path and several continuous grooves. Length, width,
    spacing, pressure, entry/exit, yaw and tooth phase belong to that pass.
    Overlaps take the deeper cut rather than adding arbitrary depth.
    """
    ss = 2
    hi = np.zeros((size*ss, size*ss), np.float32)
    count = 3100 if style != 'punched' else 450
    lengths, pitches, depths = [], [], []
    for _ in range(count):
        length_mm = rng.uniform(40, 80)
        width_mm = rng.uniform(18, 36) if style != 'clawed' else rng.uniform(22, 42)
        pitch_mm = rng.uniform(3.05, 4.0)
        depth_mm = rng.uniform(.8, 2.0)
        length, width, pitch = np.array([length_mm, width_mm, pitch_mm])/MM_PER_PX
        cx, cy = rng.uniform(0, size, 2)
        angle = theta + rng.normal(0, .105)
        ca, sa = np.cos(angle), np.sin(angle)
        bx = abs(ca)*length/2 + abs(sa)*width/2 + 4
        by = abs(sa)*length/2 + abs(ca)*width/2 + 4
        x0, x1 = max(0, int(cx-bx)), min(size, int(cx+bx)+2)
        y0, y1 = max(0, int(cy-by)), min(size, int(cy+by)+2)
        xx = (np.arange(x0*ss,x1*ss,dtype=np.float32)+.5)/ss-.5-cx
        yy = (np.arange(y0*ss,y1*ss,dtype=np.float32)+.5)/ss-.5-cy
        xx, yy = np.meshgrid(xx,yy)
        u = ca*xx + sa*yy
        v = -sa*xx + ca*yy
        t = u/length + .5
        # A few mm of lateral wander shared by all teeth of this chisel pass.
        bend = rng.uniform(-1.7,1.7)
        v -= bend*np.sin(t*np.pi) + rng.uniform(-.7,.7)*np.sin(t*2*np.pi)
        tooth_phase = rng.uniform(0,2*np.pi)
        # Continuous grooves; no per-tooth segments or periodic dash gaps.
        teeth = (.5+.5*np.cos(2*np.pi*v/pitch+tooth_phase))**.72
        # A broad pass does not leave a perfect rectangular coupon. Its outer
        # teeth fade independently, and the cut narrows and wanders at its ends.
        spread=width*(.40+.10*np.sin(np.pi*t))
        spread+=.65*np.sin(u*.43+tooth_phase)
        transverse=smooth((spread-abs(v))/(width*.24))
        entry, exit_fade = rng.uniform(.10,.24), rng.uniform(.14,.36)
        entry_offset=.065*np.sin(v*.39+tooth_phase)+.025*np.sin(v*.91)
        exit_offset=.080*np.sin(v*.29+tooth_phase+1.8)
        ends=smooth((t+entry_offset)/entry)*smooth((1-t+exit_offset)/exit_fade)
        pressure = .76+.24*np.sin(np.pi*t+rng.uniform(-.5,.5))
        # Low-frequency hardness interrupts whole runs unevenly; never a comb
        # of same-length marks. It varies within the broad footprint.
        hardness = 1-.34*np.exp(-((t-rng.uniform(.15,.85))/rng.uniform(.12,.3))**2)
        tooth_strength=.72+.28*np.sin(v*.24+tooth_phase)**2
        cut=depth_mm*(.07+.93*teeth)*transverse*ends*pressure*hardness*tooth_strength
        if style == 'punched': cut *= .38
        reg = hi[y0*ss:y1*ss,x0*ss:x1*ss]
        np.maximum(reg, cut, out=reg)
        lengths.append(length_mm); pitches.append(pitch_mm); depths.append(depth_mm)
    if style == 'punched':
        # Elliptical, asymmetric pocks with varied size and depths. Separate
        # random impacts, no lanes and no repeated circular stamp.
        for _ in range(4800):
            cx,cy = rng.uniform(0,size,2)
            rx,ry = rng.uniform(1.35,3.7,2)
            r = int(max(rx,ry)*3)+2
            x0,x1=max(0,int(cx-r)),min(size,int(cx+r)+2)
            y0,y1=max(0,int(cy-r)),min(size,int(cy+r)+2)
            xx=(np.arange(x0*ss,x1*ss,dtype=np.float32)+.5)/ss-.5-cx
            yy=(np.arange(y0*ss,y1*ss,dtype=np.float32)+.5)/ss-.5-cy
            xx,yy=np.meshgrid(xx,yy)
            a=rng.uniform(0,2*np.pi)
            u=(xx*np.cos(a)+yy*np.sin(a))/rx
            v=(-xx*np.sin(a)+yy*np.cos(a))/ry
            shape=np.maximum(0,1-.38*(u*u+v*v))**1.4
            shape*=np.clip(1+.16*np.sin(2.5*u+1.8*v),.8,1.15)
            cut=shape*rng.uniform(.8,2.0)
            reg=hi[y0*ss:y1*ss,x0*ss:x1*ss]
            np.maximum(reg,cut,out=reg)
    out=hi.reshape(size,ss,size,ss).mean((1,3))
    return out, {'passes':count,'length_mm_min_max':[min(lengths),max(lengths)],
                 'groove_pitch_mm_min_max':[min(pitches),max(pitches)],
                 'specified_cut_mm_min_max':[min(depths),max(depths)]}


def main():
    start=time.monotonic()
    rng=np.random.default_rng(SEED)
    src_path=ROOT/'source/limestone_generated.png'
    src=np.asarray(Image.open(src_path).convert('RGB'),np.float32)
    sy,sx=src.shape[:2]
    lum=src[...,0]*.2126+src[...,1]*.7152+src[...,2]*.0722
    # Retain the actual source mineral structure at every useful local scale.
    # Remove only its very broad illumination, not the 20-pixel stone features.
    mineral_src=lum-gaussian_filter(lum,160,mode='reflect')
    mineral_src/=mineral_src.std()
    filtered=gaussian_filter(lum,1.1)
    sg_y,sg_x=np.gradient(filtered)
    tensor=np.array([[np.mean(sg_x*sg_x),np.mean(sg_x*sg_y)],
                     [np.mean(sg_x*sg_y),np.mean(sg_y*sg_y)]])
    _,eigenvectors=np.linalg.eigh(tensor)
    source_angle=np.arctan2(eigenvectors[1,0],eigenvectors[0,0])
    chroma=src[...,0]-src[...,2]
    chroma-=gaussian_filter(chroma,160,mode='reflect')
    chroma/=max(chroma.std(),1)

    # Preserve the original four random warp fields and every patch record.
    warp_x=noise(rng,31)*17+noise(rng,9)*3
    warp_y=noise(rng,31)*17+noise(rng,9)*3
    layout=json.loads((ROOT/'patch_layout.json').read_text())
    patch_records=layout['patches']
    weight_sum=np.zeros((N,N),np.float32)
    mineral=np.zeros_like(weight_sum); warmth=np.zeros_like(weight_sum)
    tool=np.zeros_like(weight_sum); style_sum=np.zeros_like(weight_sum)
    orient_x=np.zeros_like(weight_sum); orient_y=np.zeros_like(weight_sum)
    radius=470
    local=np.arange(-radius,radius+1,dtype=np.float32)
    dx,dy=np.meshgrid(local,local)
    stroke_records=[]
    for idx,patch in enumerate(patch_records):
        prng=np.random.default_rng(SEED+1000+idx)
        cx,cy=patch['center_px']
        theta=np.radians(patch['direction_degrees_image_down'])
        style=patch['style']
        ix=(int(cx)+local.astype(int))%N
        iy=(int(cy)+local.astype(int))%N
        region=np.ix_(iy,ix)
        wx=dx+warp_x[region]; wy=dy+warp_y[region]
        w=np.exp(-(wx*wx+wy*wy)/(2*89.0**2)).astype(np.float32)
        w*=smooth((radius-np.maximum(abs(dx),abs(dy)))/42)
        mark,stats=carve_strokes(len(local),theta,prng,style)
        stats['patch']=idx; stroke_records.append(stats)
        angle=source_angle-theta+prng.uniform(-.12,.12)
        scale=prng.uniform(.83,1.12)
        xx=(np.cos(angle)*dx-np.sin(angle)*dy)*scale+prng.uniform(sx*.28,sx*.72)
        yy=(np.sin(angle)*dx+np.cos(angle)*dy)*scale+prng.uniform(sy*.28,sy*.72)
        m=map_coordinates(mineral_src,[yy,xx],order=1,mode='reflect')
        c=map_coordinates(chroma,[yy,xx],order=1,mode='reflect')
        # Hard light calcite interrupts the depth, using the same mineral map
        # which survives visibly in the albedo and shallow height relief.
        hard=gaussian_filter(m,2.2,mode='reflect')
        mark*=1-.24*smooth((hard-.2)/1.2)
        weight_sum[region]+=w
        mineral[region]+=w*m; warmth[region]+=w*c
        tool[region]+=w*mark; style_sum[region]+=w*(style=='punched')
        orient_x[region]+=w*np.cos(2*theta)
        orient_y[region]+=w*np.sin(2*theta)
        if idx%8==7: print(f'Carved {idx+1}/48 patches',flush=True)
    assert weight_sum.min()>1e-6
    mineral/=weight_sum; mineral/=mineral.std()
    warmth/=weight_sum; tool/=weight_sum
    punched=style_sum/weight_sum

    rng=np.random.default_rng(SEED+9000)
    Y,X=np.mgrid[:N,:N].astype(np.float32)
    broad=1.8*np.tanh(noise(rng,85)/1.8)
    wider=1.6*np.tanh(noise(rng,170)/1.6)
    medium=noise(rng,16)
    grain=noise(rng,.60); fine=noise(rng,.42)
    bedding=np.zeros((N,N),np.float32)
    for ky,kx,phase_shift in [(7,1,.8),(11,-1,2.7),(4,1,4.2)]:
        phase=2*np.pi*(ky*Y/N+kx*X/N)+.60*noise(rng,65)+phase_shift
        layer=np.exp(-((np.sin(phase)/.13)**2))
        layer*=smooth((noise(rng,40)+.3)/1.8)
        bedding+=layer
    bedding=blur(bedding,1.2)

    pits=np.zeros((N,N),np.float32)
    inclusions=np.zeros_like(pits); shells=np.zeros_like(pits)
    rust=np.zeros_like(pits)
    features=[]
    for kind,count in [('pit',155),('inclusion',150),('shell',75),('iron',24)]:
        for _ in range(count):
            cx,cy=rng.integers(0,N,2)
            r=55 if kind=='iron' else 22
            q=np.arange(-r,r+1)
            a,b=np.meshgrid(q,q)
            theta=rng.uniform(0,2*np.pi)
            u=a*np.cos(theta)+b*np.sin(theta)
            v=-a*np.sin(theta)+b*np.cos(theta)
            if kind=='pit': rx,ry=rng.uniform(1.4,3.5),rng.uniform(1.2,2.5)
            elif kind=='iron': rx,ry=rng.uniform(9,22),rng.uniform(5,13)
            else: rx,ry=rng.uniform(2.3,6.0),rng.uniform(1.3,3.5)
            d=(u/rx)**2+(v/ry)**2
            footprint=np.exp(-d*.8)*(1+.10*np.sin(u*1.7+v))
            reg=np.ix_((cy+q)%N,(cx+q)%N)
            depth=None
            if kind=='pit':
                depth=float(rng.uniform(2.0,3.0))
                pits[reg]=np.maximum(pits[reg],footprint*depth)
            elif kind=='inclusion': inclusions[reg]+=footprint*rng.uniform(.45,1)
            elif kind=='iron':
                cloud=(.7+.3*np.sin(.19*u+.4*np.sin(v*.23))**2)
                rust[reg]+=footprint*cloud*rng.uniform(.45,1)
            else:
                arc=np.exp(-((np.sqrt(d)-1)/.23)**2)*smooth((u/rx+.45)*2)
                shell_body=.26*np.exp(-d*1.4)
                shells[reg]+=(arc+shell_body)*rng.uniform(.55,1)
            rec={'kind':kind,'center_px':[int(cx),int(cy)]}
            if depth is not None: rec['pit_depth_mm']=depth
            features.append(rec)
    mineral_relief=.065*np.clip(mineral,-3.5,3.5)
    native_detail=.025*grain+.010*fine
    geology=(mineral_relief+native_detail+.050*medium+.055*broad
             -.055*bedding-.080*inclusions+.080*shells)
    height_mm=5.35-tool-pits+geology
    assert height_mm.min()>0 and height_mm.max()<6,(height_mm.min(),height_mm.max())
    Image.fromarray(np.rint(height_mm/6*65535).astype(np.uint16)).save(ROOT/'dressed_height.png')
    delivered_h=np.asarray(Image.open(ROOT/'dressed_height.png'),np.float64)/65535*6
    gx=(np.roll(delivered_h,-1,1)-np.roll(delivered_h,1,1))/(2*MM_PER_PX)
    gy=(np.roll(delivered_h,-1,0)-np.roll(delivered_h,1,0))/(2*MM_PER_PX)
    normal=np.stack((-gx,gy,np.ones_like(gx)),2)
    normal/=np.linalg.norm(normal,axis=2,keepdims=True)
    Image.fromarray(np.rint((normal*.5+.5)*255).astype(np.uint8)).save(ROOT/'dressed_normal.png')

    # Dirt is symmetric reflectance in recesses; no directional height lighting.
    groove=tool-gaussian_filter(tool,3.5,mode='wrap')
    dirt=np.maximum(groove,0)+.18*tool
    scalar=(8.3*mineral+1.30*medium+2.8*broad+1.2*wider+.75*grain
            -3.8*dirt-2.4*bedding-3.6*pits-26*inclusions+22*shells-2*rust)
    scalar-=scalar.mean(dtype=np.float64)
    scalar*=10.1/scalar.std(dtype=np.float64)
    # Concept palette: creamy calcite with distributed buff/ochre minerals.
    # Chromatic changes follow the source mineral colour, existing geological
    # drift and individual inclusions. Shell calcite stays less yellow, while
    # dirt in the grooves stays greyer. This is spatial pigment variation,
    # not a uniform colour overlay or directional lighting.
    buff=1.15*noise(rng,105)+.60*broad+.30*wider+.55*warmth
    ochre=1.6*inclusions+rust+.11*np.maximum(-mineral-.4,0)
    base=np.stack([206+scalar+1.65*buff+6*ochre-4.5*shells-.6*dirt,
                   198+scalar+.35*buff+1.6*ochre-1.0*shells-.2*dirt,
                   180+scalar-1.5*buff-7.5*ochre+6*shells+1.3*dirt],2)
    target=np.array([206,198,180])
    base+=target-base.mean((0,1),dtype=np.float64)
    # Very rare source features may exceed the gamut; recenter after clipping.
    base=np.clip(base,0,255)
    base+=target-base.mean((0,1),dtype=np.float64)
    base8=np.clip(np.rint(base),0,255).astype(np.uint8)
    profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
    Image.fromarray(base8).save(ROOT/'dressed_base.png',icc_profile=profile)

    cavity=np.maximum(0,blur(height_mm,3)-height_mm)
    ao=1-np.clip(.045*np.maximum(cavity-.16,0)+.060*pits,0,.32)
    rough=(.80+.018*medium+.012*mineral+.009*grain+.027*dirt
           +.012*pits+.020*punched-.026*shells+.012*rust)
    rough=np.clip(rough,.70,.90)
    orm=np.stack([ao,rough,np.zeros_like(ao)],2)
    Image.fromarray(np.rint(orm*255).astype(np.uint8)).save(ROOT/'dressed_orm.png')
    np.savez_compressed(ROOT/'derivation.npz',tool_depth_mm=tool,pits_mm=pits,
                        inclusions=inclusions,shells=shells,iron_stains=rust,
                        mineral=mineral,native_detail_mm=native_detail,
                        orientation_x=orient_x/weight_sum,orientation_y=orient_y/weight_sum,
                        punched=punched,dirt=dirt,geology_mm=geology)
    manifest={'revision':3,'seed':SEED,'size':N,'tile_metres':3,
              'colour_target_srgb':target.tolist(),
              'colour_references':['../../ref/concept/pieces_walls.png','../../ref/concept/inside.png'],
              'colour_revision':'Cream calcite, buff geological drift, ochre-bearing inclusions; physical maps unchanged from round2.',
              'height_black_to_white_mm':6,'mm_per_pixel':MM_PER_PX,
              'source_size':[sx,sy],'source_grain_direction_degrees':float(np.degrees(source_angle)),
              'source_sha256':hashlib.sha256(src_path.read_bytes()).hexdigest(),
              'patches':patch_records,'tooling':stroke_records,'features':features,
              'build_seconds':round(time.monotonic()-start,2)}
    (ROOT/'build_manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({'build_seconds':manifest['build_seconds'],'mean_srgb':base8.mean((0,1)).tolist(),
                      'std_srgb':base8.std((0,1)).tolist(),
                      'height_mm':[float(height_mm.min()),float(height_mm.max())],
                      'tool_mm_percentiles':np.percentile(tool,[0,25,50,75,95,99,100]).tolist()},indent=2))


if __name__=='__main__': main()
