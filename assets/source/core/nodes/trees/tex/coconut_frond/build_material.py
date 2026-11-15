#!/usr/bin/env python3
"""Rebuild the coconut material from frozen painted sources. Python + numpy/scipy/Pillow."""
from pathlib import Path
import json, hashlib
import numpy as np
from scipy.ndimage import map_coordinates, gaussian_filter, distance_transform_edt, label, binary_dilation
from scipy.interpolate import PchipInterpolator
from PIL import Image, ImageCms

ROOT = Path(__file__).resolve().parent
SIZE = 2048
SS = 2
HEIGHT_MM = 8.0
LAYOUT = json.loads((ROOT/'guide/LAYOUT.json').read_text())
PX = LAYOUT['pixels_per_metre_across']
PY = LAYOUT['pixels_per_metre_along']
SRGB = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()

def png(path, a, srgb=False):
    im=Image.fromarray(a)
    im.save(ROOT/path, **({'icc_profile':SRGB} if srgb else {}))

def smooth(a,b,x):
    t=np.clip((x-a)/(b-a),0,1)
    return t*t*(3-2*t)

def source_swatches():
    src=np.array(Image.open(ROOT/'source/generated_leaflets.png').convert('RGBA'))
    centers=[70,213,357,493,635,776,903,1044,1186]
    H,W=src.shape[:2]
    swatches=[]
    for k,c in enumerate(centers):
        rows=np.linspace(1234,65,768)
        xl=[];xr=[]
        for row in rows.astype(int):
            lo=max(0,c-62);hi=min(W,c+63)
            good=src[row,lo:hi,3]>240
            # Locate the central uninterrupted opaque strip; reject alpha fringe.
            labs,n=label(good)
            j=int(np.clip(c-lo,0,len(good)-1))
            if labs[j]==0:
                ix=np.flatnonzero(good)
                j=ix[np.argmin(abs(ix-j))] if len(ix) else j
            ix=np.flatnonzero((labs==labs[j]) & good)
            if len(ix)<3: ix=np.array([max(0,j-2),min(hi-lo-1,j+2)])
            xl.append(lo+ix[0]);xr.append(lo+ix[-1])
        xl=gaussian_filter(np.array(xl,dtype=float),2)
        xr=gaussian_filter(np.array(xr,dtype=float),2)
        v=np.linspace(0.09,.91,96)[None,:]
        sx=np.array(xl)[:,None]*(1-v)+np.array(xr)[:,None]*v
        sy=np.broadcast_to(rows[:,None],sx.shape)
        tex=np.stack([map_coordinates(src[:,:,ch].astype(float),[sy,sx],order=1) for ch in range(3)],-1)
        # Remove broad transverse lighting bias; retain local fibre/pigment, age and tip marks.
        cross=np.median(tex[110:550],axis=0)
        cross=gaussian_filter(cross,(9,0))
        tex-=.75*(cross-np.median(cross,axis=0))[None,:,:]
        target=np.array([[80,109,54],[83,111,55],[77,105,51],[141,139,65],[167,153,79],[144,145,66],[136,99,60],[141,131,114],[163,139,101]][k],float)
        med=np.median(tex[100:600,12:84],axis=(0,1))
        tex=target+(tex-med)*(.70 if k<3 else .78)
        tex=np.clip(tex,0,255).astype(np.float32)
        swatches.append(tex)
    atlas=np.concatenate(swatches,axis=1)
    png('source/rectified_leaflet_swatches.png',np.uint8(np.clip(atlas,0,255)),True)
    return swatches

PROFILE=PchipInterpolator([0,.07,.22,.4,.6,.8,.92,1],[.27,.65,.99,.92,.70,.40,.20,.035])

def build_slot(slot, textures):
    k=slot['slot'];w=slot['x1']-slot['x0'];cx=slot['midrib_x']-slot['x0']
    sh=(SIZE*SS,w*SS)
    rgb=np.zeros((*sh,3),np.float32)
    alpha=np.zeros(sh,np.float32)
    height=np.zeros(sh,np.float32)
    ao=np.zeros(sh,np.float32)
    rough=np.zeros(sh,np.float32)
    ids=np.zeros(sh,np.uint16)
    rng=np.random.default_rng(140726+k*137)
    rec=[];seq=0
    num=[86,88,98][k]
    # Slight alternation, coherent groups and a few intentionally missing pinnae.
    missing=([{(1,27),(-1,63)}, {(-1,19),(-1,20),(1,43),(1,67),(-1,73)},
              {(s,i) for s in [-1,1] for i in [13,14,29,46,47,65,82,90]}][k])
    for side in [-1,1]:
      for j in range(num):
        if (side,j) in missing: continue
        s=j/(num-1)
        group=np.sin(j*.29+k+side*.6)
        jitter=0 if j==0 else rng.uniform(-2.0,2.0)
        ry=(SIZE-1)-.85*PY-s*(4.09*PY)+jitter-(4.0 if side==1 and j>0 else 0)
        length=float(PROFILE(s))*(1+.045*group+rng.uniform(-.035,.035))
        theta=np.deg2rad(55-19*s**2+2.2*group+rng.uniform(-1.5,1.5))
        width=rng.uniform(.043,.050)*(1-.47*s**2)
        torn=rng.random() < [.04,.16,.38][k] and .08<s<.88
        split=rng.random() < [.045,.26,.48][k]
        if k==2:
            length*=rng.uniform(.71,.92)
            width*=rng.uniform(.66,.87)
        break_at=rng.uniform(.64,.87) if torn else 1.0
        if torn: length*=break_at
        ex=length*np.sin(theta)*PX
        rise=length*np.cos(theta)*PY
        bend=rng.uniform(-4,6)+([4,7,21][k])*np.sin(j*.77+side)
        wave=rng.uniform(-2,2) if k<2 else rng.uniform(-15,15)
        # Each shape stays within margins without clipping any tip.
        ex=min(ex,cx-18,w-cx-18)
        xlo=max(0,int((cx-ex-3 if side<0 else cx-3)*SS))
        xhi=min(w*SS,int((cx+3 if side<0 else cx+ex+3)*SS)+1)
        ylo=max(0,int((ry-rise-abs(bend)-abs(wave)-25)*SS))
        yhi=min(SIZE*SS,int((ry+abs(bend)+25)*SS)+1)
        yy,xx=np.mgrid[ylo:yhi,xlo:xhi].astype(np.float32)
        xx=(xx+.5)/SS-.5; yy=(yy+.5)/SS-.5
        u=side*(xx-cx)/ex
        uc=np.clip(u,0,1)
        cy=ry-rise*uc+bend*np.sin(np.pi*uc)+wave*np.sin(2*np.pi*uc)*uc
        dydx=(-rise+bend*np.pi*np.cos(np.pi*uc)+wave*(np.sin(2*np.pi*uc)+uc*2*np.pi*np.cos(2*np.pi*uc)))/ex
        metric_slope=dydx*PX/PY
        material_u=uc*break_at
        taper=(.55+.45*smooth(0,.10,material_u))*(1-smooth(.48,1,material_u))**.72
        if k==2:
            taper*=.65+.35*np.sin(uc*(9+j%4)+j*.37)**2
        half=width*PY*.5*np.sqrt(1+metric_slope**2)*taper
        # Tiny edge waves follow fibres rather than random silhouette speckle.
        edge=1+(.015 if k<2 else .045)*np.sin(uc*88+j)
        half*=edge
        v=(yy-cy)/np.maximum(half,.12)
        cov=np.clip((half-np.abs(yy-cy))*SS+.5,0,1)
        ragged_end=1-(.014 if torn else 0)*(1+.45*np.sin(v*17+j)+.25*np.sin(v*37))
        cov*=((u>=0)&(u<=ragged_end))
        if split:
            splitstart=rng.uniform(.74,.90) if k<2 else rng.uniform(.52,.78)
            slit=(.45 if k==0 else .8 if k==1 else 1.0)*smooth(splitstart,1,uc)
            shift=.14*np.sin(uc*9+j)
            cov*=np.clip((np.abs((v-shift)*half)-slit)*SS+.5,0,1)
        if k>0 and rng.random()<.30:
            p=rng.uniform(.65,.9)
            notch=np.exp(-((uc-p)/.022)**2)*.50
            cov*=np.clip((1-notch-v)*half*SS+.5,0,1)
        texidx=k*3+int(rng.integers(0,3))
        tx=(np.clip(v,-1,1)*.5+.5)*95
        ty=material_u**rng.uniform(.92,1.12)*767
        col=np.stack([map_coordinates(textures[texidx][:,:,ch],[ty,tx],order=1,mode='nearest') for ch in range(3)],-1)
        shift=rng.normal(0,[3.0,3.2,2.0])
        col+=shift+group*np.array([3.0,4.0,1.0])
        # Fine texture authored in material coordinates at final 2K detail scale.
        fibre=np.sin(v*22+np.sin(uc*19+j)*.22)+.4*np.sin(v*48+uc*13)
        col+=fibre[:,:,None]*np.array([.8,1,.4])
        vein=np.exp(-(v/.10)**2)*(1-smooth(.86,1,uc))
        col+=vein[:,:,None]*np.array([7,8,3])
        pigment_half=np.tanh(v*6)*rng.uniform(2.0,4.0)
        col+=pigment_half[:,:,None]
        if k==0:
            brown=smooth(.89 if torn else .97,1,uc)*(.5 if torn else .22)
        elif k==1:
            brown=smooth(rng.uniform(.70,.87),.98,uc)*rng.uniform(.60,1.0)
            green=(.08+.48*(.5+.5*np.sin(j*.23+side*.9))**2)*(1-.65*smooth(.4,.9,uc))
            col=col*(1-green[:,:,None])+np.array([92,115,52])*green[:,:,None]
        else: brown=np.zeros_like(uc)
        col=col*(1-brown[:,:,None])+np.array([134,101,58])*brown[:,:,None]
        # Height in mm: shallow folded lamina, rounded edge and narrow raised vein.
        vv=np.clip(np.abs(v),0,1)
        h=1.05+(1.85 if k<2 else 2.0)*(1-vv)**.85+.20*vein
        h+=.05*fibre+(.07 if k<2 else .20)*np.sin(uc*14+j)*v
        h+=1.7*np.exp(-uc*ex/11)
        h*=.55+.45*smooth(0,.08,uc)
        # Matte: a glossier leaflet picks up the sky in the game and reads blue-grey from beneath.
        r0=[.82,.85,.90][k]
        r=np.clip(r0+.018*fibre+.035*np.sin(j*.79)+brown*.05,.78 if k==0 else .80 if k==1 else .86,.88 if k==0 else .92 if k==1 else .96)
        occ=1-.16*np.exp(-uc*ex/17)
        ys=slice(ylo,yhi);xs=slice(xlo,xhi)
        old=alpha[ys,xs]
        overlap=(old>.5)&(cov>.1)&(np.abs(v)>.63)
        occ=np.minimum(occ,1-.10*overlap)
        c=cov[:,:,None]
        rgb[ys,xs]=rgb[ys,xs]*(1-c)+col*c
        height[ys,xs]=height[ys,xs]*(1-cov)+h*cov
        rough[ys,xs]=rough[ys,xs]*(1-cov)+r*cov
        ao[ys,xs]=ao[ys,xs]*(1-cov)+occ*cov
        alpha[ys,xs]=old+(1-old)*cov
        seq+=1
        ids[ys,xs][cov>.5]=seq
        rec.append(dict(side=side,index=j,root_y=round(ry,3),length_m=round(length,4),width_m=round(width,4),angle_deg=round(float(np.rad2deg(theta)),2),torn=bool(torn),split=bool(split),texture=texidx))
    # Continuous straight stout rachis, from exact bottom row to exact top row.
    yy,xx=np.mgrid[:SIZE*SS,:w*SS].astype(np.float32)
    xx=(xx+.5)/SS-.5;yy=(yy+.5)/SS-.5
    t=np.clip(yy/(SIZE-1),0,1)
    hw=.7+9.1*t**1.16
    dx=xx-cx
    v=dx/hw
    cov=np.clip((hw-abs(dx))*SS+.5,0,1)
    ridge=np.sqrt(np.maximum(0,1-np.clip(abs(v),0,1)**2))
    fibr=np.sin(dx*5+np.sin(yy*.018))*.4+np.sin(dx*1.9+yy*.008)*.6
    stripe=np.exp(-((v+.12)/.17)**2)
    if k==0: c0=np.array([129,144,74]);cb=np.array([138,133,72])
    elif k==1: c0=np.array([153,150,83]);cb=np.array([149,130,76])
    else: c0=np.array([172,153,119]);cb=np.array([150,126,89])
    col=c0[None,None,:]*(1-smooth(.81,1,t)[:,:,None])+cb[None,None,:]*smooth(.81,1,t)[:,:,None]
    col=col+stripe[:,:,None]*[9,10,5]+fibr[:,:,None]*1.5
    h=.6+(2.0+4.9*t**.45)*ridge+.07*fibr
    if k==2:
        cracks=(np.sin(dx*3.1+np.sin(yy*.026)*1.3)>.95).astype(np.float32)*smooth(.0,.15,abs(v))
        cracks*=smooth(.1,.3,np.sin(yy*.073+dx))
        col-=cracks[:,:,None]*[22,20,16]
        h-=cracks*.5
    r=np.full_like(h,[.80,.84,.90][k])+.012*fibr
    occ=np.ones_like(h)*.98
    c=cov[:,:,None]
    rgb=rgb*(1-c)+col*c
    height=height*(1-cov)+h*cov
    rough=rough*(1-cov)+r*cov
    ao=ao*(1-cov)+occ*cov
    alpha+= (1-alpha)*cov
    ids[cov>.5]=65535
    # Resolve 2x coverage. Colours and scalar fields are alpha-weighted.
    def down(a): return a.reshape(SIZE,SS,w,SS,*a.shape[2:]).mean(axis=(1,3))
    ad=down(alpha)
    den=np.maximum(ad,1e-7)
    rgb=down(rgb)/den[:,:,None]
    height=down(height)/den
    ao=down(ao)/den
    rough=down(rough)/den
    a8=np.uint8(np.clip(np.round(ad*255),0,255))
    # Remove any disconnected alpha speck (including a potential detached split tip).
    labs,n=label(a8>0,np.ones((3,3)))
    keep=labs[-1,int(round(cx))]
    a8[labs!=keep]=0
    solid_labs,_=label(a8>=128,np.ones((3,3)))
    solid_main=solid_labs[-1,int(round(cx))]
    specks=(solid_labs>0)&(solid_labs!=solid_main)
    a8[binary_dilation(specks)&(solid_labs!=solid_main)]=0
    labs,_=label(a8>0,np.ones((3,3)))
    a8[labs!=labs[-1,int(round(cx))]]=0
    assert not np.any(a8[:,:12]) and not np.any(a8[:,-12:]), 'geometry entered slot margin'
    # Nearest visible leaflet colour fills EVERY transparent texel within its own slot.
    valid=a8>=128
    nearest=distance_transform_edt(~valid,return_distances=False,return_indices=True)
    outside=~valid
    for a in [rgb,height,ao,rough]: a[outside]=a[tuple(nearest)][outside]
    # Smooth far-transparent height extensions, leaving visible relief and its immediate border intact.
    dist=distance_transform_edt(~valid)
    blend=smooth(2,12,dist)
    height=height*(1-blend)+gaussian_filter(height,3)*blend
    return np.uint8(np.clip(np.round(rgb),0,255)),a8,height,ao,rough,rec

def normals_from_height(h16):
    h=h16.astype(np.float64)/65535*HEIGHT_MM/1000
    dy,dx=np.gradient(h,1/PY,1/PX)
    n=np.stack([-dx,dy,np.ones_like(h)],-1) # +Y is image-up (OpenGL).
    n/=np.linalg.norm(n,axis=-1,keepdims=True)
    return np.uint8(np.clip(np.round((n*.5+.5)*255),0,255))

def main():
    textures=source_swatches()
    base=np.zeros((SIZE,SIZE,4),np.uint8)
    height=np.zeros((SIZE,SIZE),np.float32)
    orm=np.zeros((SIZE,SIZE,3),np.uint8)
    records=[]
    for slot in LAYOUT['slots']:
        print('Building slot',slot['slot'],flush=True)
        rgb,a,h,ao,r,rec=build_slot(slot,textures)
        sl=slice(slot['x0'],slot['x1'])
        base[:,sl,:3]=rgb;base[:,sl,3]=a
        height[:,sl]=h
        orm[:,sl,0]=np.uint8(np.clip(np.round(ao*255),0,255))
        orm[:,sl,1]=np.uint8(np.clip(np.round(r*255),0,255))
        records.append(dict(slot=slot['slot'],leaflets=rec))
    h16=np.uint16(np.clip(np.round(height/HEIGHT_MM*65535),0,65535))
    png('coconut_frond_base.png',base,True)
    png('coconut_frond_height.png',h16)
    # Reload actual saved height: no unquantized intermediate is used for normals.
    saved=np.array(Image.open(ROOT/'coconut_frond_height.png'))
    png('coconut_frond_normal.png',normals_from_height(saved))
    png('coconut_frond_orm.png',orm)
    (ROOT/'source/leaflet_placement.json').write_text(json.dumps(records,indent=2)+'\n')
    meta=dict(size=SIZE,supersampling=SS,height_range_mm=HEIGHT_MM,seed='140726 + slot*137',pixels_per_metre_across=PX,pixels_per_metre_along=PY,normal_convention='+X right, +Y image-up, +Z outward; OpenGL',source='source/generated_leaflets.png',source_sha256=hashlib.sha256((ROOT/'source/generated_leaflets.png').read_bytes()).hexdigest(),leaflet_counts=[len(r['leaflets']) for r in records])
    (ROOT/'source/build_metadata.json').write_text(json.dumps(meta,indent=2)+'\n')
    print('Built all four 2048 maps.',flush=True)

if __name__=='__main__':main()
