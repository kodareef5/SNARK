"""Rebuild the 3 m deck material from the four frozen native-resolution atlases.

All authoring positions use pixel-edge coordinates, with samples at (x+.5,y+.5).
No source is enlarged. Native crops are quilted only when a board exceeds 1254 px.
Dependencies: Python 3, numpy, scipy, Pillow. Run from this directory.
"""
from pathlib import Path
import json
import time
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, gaussian_filter1d, map_coordinates

ROOT = Path(__file__).resolve().parent
N = 2048
TILE_MM = 3000.0
MM_PER_PX = TILE_MM / N
HEIGHT_MM = 12.0
BOARD = N / 12
GAP = 6.0 / MM_PER_PX
# Keep the old source assembly and random stream; physical joints are separate.
SOURCE_JOINTS = [[0,1024], [512], [1536], [0,1024], [512,1536], [1024],
                 [0,1536], [512,1024], [0,1536], [512], [1024,1536], [512]]
JOINTS = [[0], [512], [], [1024], [1536], [], [0], [], [1536],
          [512], [1024], []]
JOINT_WIDTH = .65  # Subpixel coverage: 0.952 mm, versus the 6 mm long gaps.
# Pass 5: DESIGN.md / Material palette, unlit 8-bit sRGB (not painted sunlight).
PALETTE_SRGB = {'D':[167,138,101], 'B':[172,128,82], 'E':[186,149,107]}
TARGET_MEAN_SRGB = np.array(PALETTE_SRGB['D'],np.float32)
BOARD_VARIATION = .5  # Halve authored offsets; preserve local weathered fibres.
B_WEAR_BLEND = .18
E_END_BLEND = .20
# Retain the original targets as the reference for the quieter board offsets.
TARGETS = np.array([[146,126,104], [137,116,94], [144,126,107],
                    [134,112,90], [150,130,108], [140,120,101],
                    [137,118,99], [147,126,103], [133,113,93],
                    [143,122,102], [141,121,99], [148,129,108]], np.float32)


def smooth01(t):
    t = np.clip(t, 0, 1)
    return t*t*(3-2*t)


def field(rng, shape, sy, sx):
    a = gaussian_filter(rng.standard_normal(shape).astype(np.float32),
                        (sy,sx), mode='wrap')
    return a / max(float(a.std()), 1e-6)


def distance(x, center, period=N):
    return (x-center+period/2) % period-period/2


def native_strip(atlas, row, rng, flip):
    # Deliberately crop, never enlarge: at least 12 original pixels are omitted
    # at each side of a generated seam, so none of its shadows enter the material.
    a = np.asarray(Image.open(ROOT/'source'/f'atlas_{atlas}.png').convert('RGB'),
                   dtype=np.float32)
    prof = a.mean(axis=(1,2))
    edges = [0]
    for j in range(1,6):
        t = int(a.shape[0]*j/6)
        edges.append(t-35+int(np.argmin(prof[t-35:t+36])))
    edges.append(a.shape[0])
    center = (edges[row]+edges[row+1])/2
    top = int(round(center-90))
    crop = a[top:top+180, 6:-6].copy()
    if flip & 1: crop = crop[:,::-1]
    if flip & 2: crop = crop[::-1]
    # Remove first-order exposure drift, without removing actual growth figures.
    yy, xx = np.mgrid[-1:1:complex(crop.shape[0]), -1:1:complex(crop.shape[1])]
    lum = crop.mean(axis=2)
    plane = ((lum*xx).mean()/(xx*xx).mean()*xx +
             (lum*yy).mean()/(yy*yy).mean()*yy)
    crop -= plane[:,:,None]
    crop -= crop.mean(axis=(0,1), keepdims=True)
    # Reduce photographic fiber edge contrast. Pigment remains separate from AO.
    low = gaussian_filter(crop, (1.25,2.0,0), mode='reflect')
    crop = .79*low + .58*(crop-low)
    return crop.astype(np.float32), {'atlas':f'atlas_{atlas}.png','row':row,
                                   'crop':[6,top,a.shape[1]-6,top+180], 'flip':flip}


def quilt(a, b, length):
    """Min-cost irregular seam across a 192 px overlap, with 5 px feathering."""
    if length <= a.shape[1]:
        start = (a.shape[1]-length)//2
        return a[:,start:start+length].copy(), None
    overlap = 192
    left_len = (length+overlap)//2
    right_len = length+overlap-left_len
    aa, bb = a[:,-left_len:], b[:,:right_len]
    err = np.mean((aa[:,-overlap:]-bb[:,:overlap])**2, axis=2)
    err = gaussian_filter(err,(1.0,2.0))
    # Keep the seam away from the extremes of the overlap.
    err[:,:16] += 1e4; err[:,-16:] += 1e4
    cost = err[0].copy()
    links = np.empty(err.shape, np.int16)
    offsets = np.arange(-3,4)
    for y in range(1,err.shape[0]):
        candidates = np.stack([np.roll(cost,-d) for d in offsets])
        candidates[:,:3] += 1e4; candidates[:,-3:] += 1e4
        ind = np.argmin(candidates,axis=0)
        links[y] = np.arange(overlap)+offsets[ind]
        cost = err[y]+candidates[ind,np.arange(overlap)]
    seam = np.zeros(err.shape[0],np.int32)
    seam[-1] = np.argmin(cost)
    for y in range(len(seam)-1,0,-1): seam[y-1] = links[y,seam[y]]
    seam = gaussian_filter1d(seam.astype(np.float32),2)
    blend = smooth01((np.arange(overlap)[None,:]-seam[:,None]+3)/6)
    out = np.empty((a.shape[0],length,3),np.float32)
    out[:,:left_len] = aa
    out[:,left_len-overlap:] = bb
    out[:,left_len-overlap:left_len] = (aa[:,-overlap:]*(1-blend[:,:,None])+
                                                   bb[:,:overlap]*blend[:,:,None])
    return out, {'overlap_px':overlap,'seam_min_px':float(seam.min()),
                 'seam_max_px':float(seam.max()),'feather_px':6}


def save_rgb(path, a, srgb=False):
    img = Image.fromarray(np.uint8(np.clip(np.rint(a),0,255)))
    args = {}
    if srgb:
        # Freeze the existing sRGB profile, including its creation timestamp,
        # so repeated builds reproduce the entire PNG, not just its pixels.
        args['icc_profile'] = (ROOT/'source'/'srgb.icc').read_bytes()
    img.save(path, **args)


def normals_from_height(h):
    dx = (np.roll(h,-1,1)-np.roll(h,1,1))/(2*MM_PER_PX)
    dy = (np.roll(h,-1,0)-np.roll(h,1,0))/(2*MM_PER_PX)
    v = np.stack((-dx,dy,np.ones_like(dx)),axis=-1)
    v /= np.linalg.norm(v,axis=-1,keepdims=True)
    return np.rint((v*.5+.5)*255).astype(np.uint8)


def main():
    started = time.time()
    (ROOT/'checks').mkdir(exist_ok=True)
    rng = np.random.default_rng(163621)
    base = np.zeros((N,N,3),np.float32)
    height = np.zeros((N,N),np.float32)
    rough = np.zeros((N,N),np.float32)
    ao = np.ones((N,N),np.float32)
    metal = np.zeros((N,N),np.uint8)
    gap_mask = np.zeros((N,N),np.float32)
    joint_mask = np.zeros((N,N),np.float32)
    check_mask = np.zeros((N,N),np.float32)
    polish_mask = np.zeros((N,N),np.float32)
    latewood_mask = np.zeros((N,N),np.float32)
    nail_coverage = np.zeros((N,N),np.float32)
    stain_mask = np.zeros((N,N),np.float32)
    # Keep pass-two surface choices; only end treatments and joint hardware move.
    detail_masks = {key: np.zeros((N,N),np.float32) for key in
                    ['cup_mm','edge_mm','grain_mm','split_mm','grit','chips',
                     'water','scuff','rust','hammer_mm']}
    board_id = np.floor((np.arange(N)+.5)/BOARD).astype(int)
    boards_meta = []
    xx = np.arange(N,dtype=np.float32)[None,:]+.5
    # Two different source rows per board, each used at its native scale.
    source_order = [(a,r) for r in [0,3,1,5,2,4] for a in 'abcd']
    for k in range(12):
        age_rng = np.random.default_rng(910210+k)
        ids = np.where(board_id==k)[0]
        yy = ids.astype(np.float32)[:,None]+.5
        local_y = yy-k*BOARD
        shape = (len(ids),N)
        a,ma = native_strip(*source_order[2*k],rng,int(rng.integers(0,4)))
        b,mb = native_strip(*source_order[2*k+1],rng,int(rng.integers(0,4)))
        src = np.empty((*shape,3),np.float32)
        segmeta=[]
        js = JOINTS[k]
        source_js = SOURCE_JOINTS[k]
        segment_colour = np.zeros((*shape,3),np.float32)
        extended_sources=[]
        feather=48
        # These source boundaries are no longer necessarily physical board ends.
        for j,start in enumerate(source_js):
            end = source_js[(j+1)%len(source_js)]
            length = (end-start)%N or N
            ca,cb = (a,b) if j==0 else (b[:,::-1],a[:,::-1])
            strip,qmeta = quilt(ca,cb,length)
            cols = (np.arange(length)+start)%N
            # 180 original rows supply a 170/171 px face, still without enlargement.
            ry = local_y[:,0]+(180-BOARD)/2-.5
            coords = np.meshgrid(ry,np.arange(length),indexing='ij')
            for c in range(3):
                src[np.arange(len(ids))[:,None],cols[None,:],c] = map_coordinates(
                    strip[:,:,c],coords,order=1,mode='nearest')
            # Small segment-specific pigment change makes the end joint believable.
            delta = rng.uniform(-2.2,2.2) if len(source_js)>1 else 0
            segment_colour[:,cols] = delta*np.array([1,.88,.72])
            segmeta.append({'start_x':start,'length_px':length,'quilt':qmeta})
            # Continue the actual native crop beyond each old boundary. Blend
            # those continuations only where a butt joint has been removed;
            # this avoids leaving a source-cut line disguised as another joint.
            if length<=ca.shape[1]:
                first=(ca.shape[1]-length)//2
                left=ca[:,first-feather:first]
                right=ca[:,first+length:first+length+feather]
            else:
                left_len=(length+192)//2
                right_len=length+192-left_len
                first=ca.shape[1]-left_len
                left=ca[:,first-feather:first]
                right=cb[:,right_len:right_len+feather]
            extended=np.concatenate([left,strip,right],axis=1)
            coords=np.meshgrid(ry,np.arange(length+2*feather),indexing='ij')
            sampled=np.stack([map_coordinates(extended[:,:,c],coords,order=1,
                                              mode='nearest') for c in range(3)],axis=-1)
            extended_sources.append((sampled,delta))
        for j,start in enumerate(source_js):
            if start in js: continue
            left,ld=extended_sources[j-1]
            right,rd=extended_sources[j]
            cols=(np.arange(-feather,feather)+start)%N
            t=smooth01((np.arange(2*feather)+.5)/(2*feather))[None,:,None]
            src[:,cols]=left[:,-2*feather:]*(1-t)+right[:,:2*feather]*t
            segment_colour[:,cols]=((1-t)*ld+t*rd)*np.array([1,.88,.72])
        coarse = field(rng,shape,14,70)
        medium = field(rng,shape,2.4,24)
        fine = field(rng,shape,.48,4.0)
        micro = field(rng,shape,.33,1.15)
        # Subtle boot scuffing: broad irregular worn patches, not literal footprints.
        wear = np.zeros(shape,np.float32)
        water = np.zeros(shape,np.float32)
        for j in range(2):
            cx = rng.uniform(0,N); cy=rng.uniform(35,BOARD-35)
            dx=distance(xx,cx); dy=local_y-cy
            p=np.exp(-.5*((dx/rng.uniform(70,145))**2+(dy/rng.uniform(18,34))**2))
            wear=np.maximum(wear,p*np.clip(.73+.14*coarse+.1*medium,.1,1))
        for j in range(2 if k%3==0 else 1):
            dx=distance(xx,rng.uniform(0,N)); dy=local_y-rng.uniform(10,BOARD-10)
            p=np.exp(-.5*((dx/rng.uniform(45,110))**2+(dy/rng.uniform(16,38))**2))
            water=np.maximum(water,p*np.clip(.6+.13*coarse+.09*medium,0,1))
        polish_mask[ids]=wear
        # Pale exposed fibres in the retained weathered source are worn hard
        # latewood; darker troughs collect dirt. Both pigment and relief agree.
        lum=src.mean(axis=2)
        grain=gaussian_filter(lum,(.55,1.7),mode=('reflect','wrap'))
        band=grain-gaussian_filter(grain,(4.0,20),mode=('reflect','wrap'))
        latewood=smooth01((band+1.0)/8.5)
        latewood_mask[ids]=latewood
        # Soft earlywood is eroded; hard latewood carries 0.65-1.15 mm of
        # differential relief. Cupping is a separate, broad physical component.
        ridge_amplitude=.90+.25*np.tanh(coarse*.45)
        grain_mm=ridge_amplitude*latewood*(1-.12*wear)
        cup_depth=float(age_rng.uniform(1.05,1.95))
        cup=cup_depth*np.sin(np.pi*local_y/BOARD)**2*(1+.025*np.tanh(coarse))
        h=10.50+.055*coarse+grain_mm-.38-cup
        h+=(.045*fine+.018*micro)*(1-.5*wear)
        detail_masks['cup_mm'][ids]=cup
        detail_masks['grain_mm'][ids]=grain_mm
        # Native 2K fiber colour is shared with the finest height detail.
        rgb=TARGETS[k]+src+segment_colour
        rgb+= (1.8*coarse+.8*medium+1.1*fine+.55*micro)[:,:,None]*np.array([1,.96,.88])
        rgb+= wear[:,:,None]*np.array([2.0,2.1,2.0])
        rgb-= water[:,:,None]*np.array([6.5,6.8,6.8])
        # Pale polish on raised fibres and trapped dirt in low fibres, without
        # cancelling the retained wood colour or baking in any light direction.
        fibre_wear=(latewood-.5)*(5.0+4*wear)
        rgb+=fibre_wear[:,:,None]*np.array([1,.98,.93])
        low_dirt=(1-latewood)*smooth01((medium+.7)/2.5)
        rgb-=low_dirt[:,:,None]*np.array([2.6,2.7,2.5])
        r=.925+.013*coarse+.012*medium-.15*wear+.03*water-.105*latewood
        detail_masks['water'][ids]=water
        # A few broken diagonal rubs, under 0.4 mm deep, at native resolution.
        scuff=np.zeros(shape,np.float32)
        if k in [1,4,8,10]:
            cx=float(age_rng.uniform(120,N-120)); cy=float(age_rng.uniform(50,BOARD-50))
            dx=distance(xx,cx); dy=local_y-cy
            u=dx*.93+dy*.37; v=-dx*.37+dy*.93
            footprint=np.exp(-.5*((u/28)**2+(v/18)**2))
            scratches=smooth01((np.cos(v*2.2+.2*np.sin(u*.15))-.25)/.65)
            scuff=footprint*scratches*smooth01((medium+1.5)/3)
            rgb+=scuff[:,:,None]*np.array([4.5,4.8,4.5])
            h-=.16*scuff; r-=.085*scuff
        detail_masks['scuff'][ids]=scuff
        # The strongest dark, horizontally coherent source hairlines are checks,
        # not latewood: recess them rather than turning them into raised ridges.
        darkline=np.maximum(gaussian_filter1d(lum,2.2,axis=0,mode='reflect')-lum,0)
        support=gaussian_filter1d(darkline,4.0,axis=1,mode='wrap')
        inferred_check=smooth01((darkline-7)/6)*smooth01((support-3.1)/4.5)
        checks=inferred_check*.8
        # Longitudinal hairline checks: finite tapered curves; wrapped distance.
        for j in range(4):
            cx=rng.uniform(0,N); cy=rng.uniform(15,BOARD-15)
            dx=distance(xx,cx); length=rng.uniform(24,95)
            path=cy+.65*np.sin(dx/22+rng.uniform(0,6))+.003*dx
            envelope=smooth01((1-np.abs(dx)/length)*3)
            width=rng.uniform(.4,.85)*np.sqrt(envelope)
            crack=np.clip(width+.45-np.abs(local_y-path),0,1)*envelope
            checks=np.maximum(checks,crack)
        # Board-end splits taper away from the existing exact joist lines.
        end_splits=np.zeros(shape,np.float32)
        for xj in source_js:
            for side in [-1,1]:
                dx=distance(xx,xj)*side
                for split in range(5):
                    cy=float(age_rng.uniform(10,BOARD-10))
                    length=float(age_rng.uniform(18,85))
                    envelope=smooth01((1-dx/length)*2)*(dx>0)
                    path=cy+.7*np.sin(dx/13+split)+dx*.012
                    width=float(age_rng.uniform(.55,1.05))*np.sqrt(envelope)
                    crack=np.clip(width+.5-np.abs(local_y-path),0,1)*envelope
                    # Still consume the old stream so rolled edges, chips and
                    # cupping stay identical. Retained ends have restrained cuts.
                    if xj in js and split<2:
                        end_splits=np.maximum(end_splits,crack*.28)
        checks=np.maximum(checks,end_splits)
        split_mm=checks*(2.4+.8*smooth01((coarse+1)/2))
        h-=split_mm
        detail_masks['split_mm'][ids]=split_mm
        # Source checks already contain their dark pigment; only authored checks
        # need additional dirt colour. Both kinds share height, AO and roughness.
        new_check=np.maximum(checks-inferred_check*.8,0)
        rgb=rgb*(1-new_check[:,:,None]*.63)+np.array([56,46,37])*new_check[:,:,None]*.63
        r+=checks*.065
        # Exact 6 mm board gap with analytic coverage of subpixel horizontal lines.
        d=np.minimum(local_y,BOARD-local_y)
        g=np.clip(GAP/2+.5-d,0,1)+np.zeros(shape,np.float32)
        # The last 10-15 mm roll down by 2-4 mm. The core gap remains exactly
        # six millimetres wide; sparse missing fibres roughen only its lips.
        roll_width=float(age_rng.uniform(10,15))/MM_PER_PX
        roll_drop=float(age_rng.uniform(2.3,3.8))
        edge=roll_drop*(1-smooth01(np.maximum(d-GAP/2,0)/roll_width))
        edge=edge*(1+.045*np.tanh(medium))
        h-=edge
        detail_masks['edge_mm'][ids]=edge
        chip_signal=field(age_rng,shape,.6,2.7)
        chips=smooth01((chip_signal-1.15)/1.3)*np.clip(2.0-np.maximum(d-GAP/2,0),0,1)*(1-g)
        detail_masks['chips'][ids]=chips
        grit=smooth01((micro-.8)/1.1)
        dust=smooth01((medium-.1)/1.5)
        dirty=(45+7*np.tanh(micro)+20*grit+14*dust)[:,:,None]+np.array([7,1,-7])
        dirt_cover=np.maximum(g,chips*.72)
        rgb=rgb*(1-dirt_cover[:,:,None])+dirty*dirt_cover[:,:,None]
        h-=chips*.9
        h=h*(1-g)+(.40+.12*np.tanh(medium)+.70*grit+.16*dust)*g
        r=r*(1-dirt_cover)+(.975+.01*np.tanh(micro))*dirt_cover
        gap_mask[ids]=g
        # End joints centered exactly on their joist lines, not noise-displaced.
        joint=np.zeros(shape,np.float32)
        for xj in js:
            dj=np.abs(distance(xx,xj))+np.zeros(shape,np.float32)
            joint=np.maximum(joint,np.clip(JOINT_WIDTH/2+.5-dj,0,1))
            end=np.exp(-dj/2.5)*(1-g)
            # End wear and pigment are independent of illumination direction.
            rgb-=end[:,:,None]*np.array([2.0,2.2,2.0])
            h-=.12*end
            r-=.015*end
        joint*=1-g
        rgb=rgb*(1-joint[:,:,None])+dirty*joint[:,:,None]
        h=h*(1-joint)+(.75+.12*np.tanh(medium)+.6*grit+.13*dust)*joint
        r=r*(1-joint)+.98*joint
        aoval=1-.55*g-.22*joint-.38*checks*(1-g)-.14*chips
        aoval-=.018*np.maximum(-fine-1.2,0)*(1-g)
        base[ids]=rgb; height[ids]=h; rough[ids]=r; ao[ids]=aoval
        joint_mask[ids]=joint; check_mask[ids]=checks
        detail_masks['grit'][ids]=grit*np.maximum(g,joint)
        boards_meta.append({'board':k,'y0':k*BOARD,'y1':(k+1)*BOARD,
                            'joints_x':js,'source_crops':[ma,mb],'segments':segmeta,
                            'source_boundaries_x':source_js,
                            'healed_source_boundaries_x':[x for x in source_js if x not in js],
                            'cup_depth_mm':cup_depth,'edge_roll_width_mm':roll_width*MM_PER_PX,
                            'edge_roll_drop_mm':roll_drop})
    # Preserve the old nail random stream and each surviving head's individual
    # forging. A replacement ordinary pair uses the former left pair's seed.
    nail_styles={}
    legacy_index=0
    for k in range(12):
        for joist in [0,512,1024,1536]:
            xs=[joist-12.,joist+12.] if joist in SOURCE_JOINTS[k] else [float(joist)]
            for cx in xs:
                for edge_index in range(2):
                    theta=rng.uniform(-.14,.14)
                    forged=field(rng,(39,73),.55,.65)
                    nail_styles[(k,joist,cx%N,edge_index)]=(legacy_index,theta,forged)
                    legacy_index+=1
    nails=[]
    # Fast local patches on the torus. Ordinary joist nails really cross x=0.
    for k in range(12):
        for joist in [0,512,1024,1536]:
            on_joint=joist in JOINTS[k]
            xs=[joist-12.0,joist+12.0] if on_joint else [float(joist)]
            for cx in xs:
                for edge_index,cy in enumerate([k*BOARD+50/MM_PER_PX,
                                               (k+1)*BOARD-50/MM_PER_PX]):
                    cx%=N
                    rx=np.arange(int(np.floor(cx))-36,int(np.floor(cx))+37)
                    ry=np.arange(int(np.floor(cy))-19,int(np.floor(cy))+20)
                    ix=rx%N; iy=ry%N
                    dx=rx[None,:]+.5-cx; dy=ry[:,None]+.5-cy
                    style_x=(joist-12.)%N if joist in SOURCE_JOINTS[k] and not on_joint else cx
                    legacy_index,theta,forged=nail_styles[(k,joist,style_x,edge_index)]
                    forge_rng=np.random.default_rng(671020+legacy_index)
                    u=dx*np.cos(theta)+dy*np.sin(theta)
                    v=-dx*np.sin(theta)+dy*np.cos(theta)
                    half=4.0
                    # Forged square head, lightly clipped corners, no screw slot.
                    sdf=np.maximum(np.maximum(np.abs(u)-half,np.abs(v)-half),
                                   (np.abs(u)+np.abs(v)-7.35)*.7071)
                    # Four slightly uneven forged sides, clipped corners and
                    # small waviness. Maximum departures stay below one texel.
                    sdf+=.24*np.sin(u*1.55+float(forge_rng.uniform(0,6)))
                    sdf+=.22*np.sin(v*1.8+float(forge_rng.uniform(0,6)))
                    cover=np.clip(.5-sdf,0,1)
                    head=cover>=.5
                    radial=np.sqrt((dx/6.4)**2+(dy/6.4)**2)
                    pocket=np.exp(-(radial**4)*.9)
                    localgrain=latewood_mask[np.ix_(iy,ix)]
                    # Shorter joint stains keep the two heads from forming a
                    # single black bar. Iron reflectance is identical elsewhere.
                    halo=np.exp(-.5*((dx/(8.5 if on_joint else 19.0))**2+(dy/5.6)**2))
                    halo*=np.clip(.95-.36*localgrain+.19*np.sin(dx*.25+dy*1.7),.25,1.1)
                    halo*=metal[np.ix_(iy,ix)]==0
                    block=base[np.ix_(iy,ix)]
                    block-=halo[:,:,None]*np.array([27.0,26.0,23.0])
                    rust=np.exp(-(np.maximum(sdf-.5,0)/1.65)**2)*(1-cover)
                    rust*=np.clip(.65+.24*np.sin(u*.8+v*1.7),.3,.9)
                    block=block*(1-rust[:,:,None]*.65)+np.array([96,65,43])*rust[:,:,None]*.65
                    # Flat iron reflectance; facet relief belongs only in height.
                    iron=np.clip(np.array([70,68,64])+forged[:,:,None]*4,60,80)
                    block=block*(1-cover[:,:,None])+iron*cover[:,:,None]
                    block[head]=iron[head]
                    base[np.ix_(iy,ix)]=block
                    patch_h=height[np.ix_(iy,ix)]
                    face=float(np.percentile(patch_h[(radial>1.1)&(radial<1.8)],65))
                    patch_h-=.50*pocket
                    dent=np.zeros_like(patch_h)
                    if legacy_index%7==2:
                        ox=float(forge_rng.uniform(-6,6)); oy=float(forge_rng.uniform(-4,4))
                        dent=np.exp(-.5*(((dx-ox)/7)**2+((dy-oy)/5)**2))
                        dent*=float(forge_rng.uniform(.65,1.15))*(1-cover)
                        dent*=~(head|(metal[np.ix_(iy,ix)]>0))
                        patch_h-=dent
                        base[np.ix_(iy,ix)]-=dent[:,:,None]*np.array([2.5,2.2,1.6])
                    headh=face-.27-.22*smooth01((sdf+1.3)/1.4)+.055*forged
                    # Shallow, asymmetric hammer facets live in the height map.
                    headh+=.12*u/4-.09*np.abs(v+.5)/4-.08*np.abs(u-v)/5
                    patch_h=patch_h*(1-cover)+headh*cover
                    height[np.ix_(iy,ix)]=patch_h
                    rough[np.ix_(iy,ix)]=(rough[np.ix_(iy,ix)]*(1-cover)+
                                                  (.70+.045*forged)*cover)
                    rough[np.ix_(iy,ix)]+=rust*.055
                    ao[np.ix_(iy,ix)]-=.19*pocket*(1-cover)+.025*cover
                    metal[np.ix_(iy,ix)]=np.maximum(metal[np.ix_(iy,ix)],head*255)
                    nail_coverage[np.ix_(iy,ix)]=np.maximum(nail_coverage[np.ix_(iy,ix)],cover)
                    stain_mask[np.ix_(iy,ix)]=np.maximum(stain_mask[np.ix_(iy,ix)],halo)
                    detail_masks['rust'][np.ix_(iy,ix)]=np.maximum(detail_masks['rust'][np.ix_(iy,ix)],rust)
                    detail_masks['hammer_mm'][np.ix_(iy,ix)]=np.maximum(detail_masks['hammer_mm'][np.ix_(iy,ix)],dent)
                    nails.append({'board':k,'joist_x':joist,'x':cx,'y':cy,
                                  'at_joint':on_joint,'side_edge':edge_index,
                                  'legacy_style_index':legacy_index,
                                  'angle_radians':theta,'head_size_px':8.0})
    # Base-colour-only palette adjustment. Keep all local grain and foot wear;
    # quiet the board offsets without flattening the weathering within a board.
    # Existing polish and exposed ends receive restrained B/E pigment shifts.
    # Nothing here enters the physical maps or consumes a random sample.
    woodweight=(1-gap_mask)*(1-joint_mask)*(1-nail_coverage)*(metal==0)
    board_shift=(1-BOARD_VARIATION)*(TARGETS.mean(axis=0)-TARGETS)
    colour_shift=np.broadcast_to(board_shift[board_id,None,:],base.shape).copy()
    colour_shift+=B_WEAR_BLEND*polish_mask[:,:,None]*(np.array(PALETTE_SRGB['B'])-TARGET_MEAN_SRGB)
    for k,js in enumerate(JOINTS):
        ids=np.where(board_id==k)[0]
        end=sum((np.exp(-np.abs(distance(xx,xj))/2.5) for xj in js),
                np.zeros_like(xx))
        colour_shift[ids]+=E_END_BLEND*end[:,:,None]*(np.array(PALETTE_SRGB['E'])-TARGET_MEAN_SRGB)
    base+=woodweight[:,:,None]*colour_shift
    # Coverage-weighted translation meets D across the whole saved tile, while
    # full dirt gaps and dark iron heads retain their exact original colours.
    target_mean=TARGET_MEAN_SRGB
    delta=(target_mean-base.mean(axis=(0,1),dtype=np.float64))/woodweight.mean(dtype=np.float64)
    base+=woodweight[:,:,None]*delta
    assert base.min()>=0 and base.max()<=255, 'Palette translation clipped local colour variation'
    height16=np.uint16(np.clip(np.rint(height/HEIGHT_MM*65535),0,65535))
    Image.fromarray(height16).save(ROOT/'deck_height.png')
    # Read the final quantized file: the normal is derived from the delivered data.
    saved_height=np.asarray(Image.open(ROOT/'deck_height.png'),np.float64)*HEIGHT_MM/65535
    normal=normals_from_height(saved_height)
    save_rgb(ROOT/'deck_base.png',base,srgb=True)
    Image.fromarray(normal).save(ROOT/'deck_normal.png')
    orm=np.stack((np.clip(ao,.3,1)*255,np.clip(rough,.52,.99)*255,metal),axis=-1)
    save_rgb(ROOT/'deck_orm.png',orm)
    # Frozen construction masks for independent verification; not engine textures.
    np.savez_compressed(ROOT/'source'/'construction_masks.npz',
                        gap=gap_mask.astype(np.float16),joint=joint_mask.astype(np.float16),
                        checks=check_mask.astype(np.float16),polish=polish_mask.astype(np.float16),
                        latewood=latewood_mask.astype(np.float16),nails=nail_coverage.astype(np.float16),
                        iron_stain=stain_mask.astype(np.float16),
                        **{key:value.astype(np.float16) for key,value in detail_masks.items()})
    meta={'tile_metres':3.0,'size':N,'pixel_mm':MM_PER_PX,'height_range_mm':[0,HEIGHT_MM],
          'sample_centres':'x+0.5, y+0.5; geometry lines are pixel-edge coordinates',
          'gap_width_px':GAP,'joint_width_px':JOINT_WIDTH,'seed':163621,
          'boards':boards_meta,'nails':nails,'target_mean_srgb':target_mean.tolist(),
          'height_observed_mm':[float(saved_height.min()),float(saved_height.max())],
          'revision':5,'grain_amplitude_mm':[.65,1.15],
          'palette':'unlit worn deck D, restrained B wear and E exposed ends',
          'palette_source':'../../ref/concept/DESIGN.md / Material palette',
          'palette_srgb':PALETTE_SRGB,
          'palette_method':'coverage-weighted sRGB translation, quieter board offsets and local B/E wear',
          'board_variation_scale':BOARD_VARIATION,
          'wear_blend_B':B_WEAR_BLEND,'end_blend_E':E_END_BLEND,
          'joint_end_darkening_srgb':[2.0,2.2,2.0],
          'removed_source_seam_blend_width_px':2*feather,
          'build_seconds':round(time.time()-started,2)}
    (ROOT/'source'/'construction.json').write_text(json.dumps(meta,indent=2)+'\n')
    print(f'Built {N}², 12 boards, {sum(map(len,JOINTS))} joints, {len(nails)} nails in {time.time()-started:.1f}s')


if __name__=='__main__':
    main()
