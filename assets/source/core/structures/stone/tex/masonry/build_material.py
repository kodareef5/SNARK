#!/usr/bin/env python3
"""Round 4: preserve named surfaces, refit 43 stones and their new crowns."""
from pathlib import Path
import argparse
import hashlib
import json
import time
import numpy as np
from PIL import Image, ImageCms
from scipy.ndimage import gaussian_filter, map_coordinates, binary_dilation
from scipy.interpolate import LinearNDInterpolator
from scipy.spatial import cKDTree

ROOT=Path(__file__).resolve().parent
N=2048
MM=3000/N
SEED=830127
SURFACES=['fine close limestone','cleft crystalline','coarse pitted','pitch and punch dressed','spalled face corner']
MACRO_FIT={'function':'1.8 + 42 * (1 - exp(-model_mm / 13))','mortar_mm':1.8,'amplitude_mm':42.0,'decay_mm':13.0}


def fit_macro(model):
    """One monotone LOD fit: retain the ~40 mm face level and reserve micro relief."""
    return 1.8+42.0*(-np.expm1(-model/13.0))


def crown_peak(stone):
    face=np.array(stone['face_metres']);centre=np.array(stone['crown_at_metres'])
    u,v=(centre-face.min(0))/(face.max(0)-face.min(0));r=stone['face_rise_mm_at_corners']
    return (1-v)*((1-u)*r[0]+u*r[1])+v*((1-u)*r[3]+u*r[2])+stone['crown_mm']


def smooth(x):
    x=np.clip(x,0,1)
    return x*x*(3-2*x)


def noise(shape,sigma,rng,periodic=False):
    a=gaussian_filter(rng.standard_normal(shape).astype(np.float32),sigma,
                      mode='wrap' if periodic else 'reflect')
    return (a-a.mean())/max(float(a.std()),1e-6)


def edge_distances(x,y,vertices):
    ds=[]
    for a,b in zip(vertices,np.roll(vertices,-1,0)):
        dx,dy=b-a
        ds.append((dx*(y-a[1])-dy*(x-a[0]))/np.hypot(dx,dy))
    return np.stack(ds)


def triangular_field(shape,rng,spacing):
    h,w=shape
    py,px=np.mgrid[-spacing:h+2*spacing:spacing,-spacing:w+2*spacing:spacing]
    points=np.column_stack([px.ravel(),py.ravel()])
    points+=rng.uniform(-.36,.36,points.shape)*spacing
    values=rng.uniform(-1,1,len(points))
    yy,xx=np.mgrid[:h,:w]
    out=LinearNDInterpolator(points,values)(xx,yy)
    return gaussian_filter(np.nan_to_num(out),.55).astype(np.float32)


def grains(shape,rng,spacing):
    h,w=shape
    py,px=np.mgrid[-spacing:h+2*spacing:spacing,-spacing:w+2*spacing:spacing]
    points=np.column_stack([px.ravel(),py.ravel()])
    points+=rng.uniform(-.43,.43,points.shape)*spacing
    yy,xx=np.mgrid[:h,:w]
    query=np.column_stack([xx.ravel(),yy.ravel()])
    distances,inds=cKDTree(points).query(query,k=2)
    nearest=inds[:,0];local=query-points[nearest]
    v=rng.uniform(-1,1,len(points));ang=rng.uniform(0,2*np.pi,len(points))
    planes=(local[:,0]*np.cos(ang[nearest])+local[:,1]*np.sin(ang[nearest]))/spacing
    relief=(.7*v[nearest]+.3*planes-.1*np.exp(-(distances[:,1]-distances[:,0])/.2)).reshape(shape)
    pigment=rng.normal(0,1,len(points))[nearest].reshape(shape)
    return gaussian_filter(relief,.4),gaussian_filter(pigment,.4)


def paint_triangle(out,x,y,vertices,values):
    a,b,c=np.asarray(vertices,dtype=float)
    denom=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
    wa=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/denom
    wb=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/denom
    wc=1-wa-wb
    mask=(wa>=-1e-6)&(wb>=-1e-6)&(wc>=-1e-6)
    out[mask]=(wa*values[0]+wb*values[1]+wc*values[2])[mask]


def geometry_profiles(x,y,foot,face,stone):
    """Exact rings and off-centre triangle-fan crown; model height in millimetres."""
    profile=np.zeros(x.shape,np.float32)
    geo=np.zeros(x.shape,np.float32)
    r=stone['face_rise_mm_at_corners']
    rises=np.array([r[0],r[1],r[1],r[2],r[2],r[3],r[3],r[0]])
    centre=np.array(stone['crown_at_metres'])*N/3
    ch=crown_peak(stone)
    for a in range(8):
        b=(a+1)%8
        for verts,pvals,gvals in [([foot[a],foot[b],face[b]],[0,0,1],[0,0,rises[b]]),
                                  ([foot[a],face[b],face[a]],[0,1,1],[0,rises[b],rises[a]]),
                                  ([face[a],face[b],centre],[1,1,1],[rises[a],rises[b],ch])]:
            paint_triangle(profile,x,y,verts,pvals)
            paint_triangle(geo,x,y,verts,gvals)
    return profile,geo


def normal_from_height(h):
    dx=(np.roll(h,-1,1)-np.roll(h,1,1))/(2*MM)
    dy=(np.roll(h,-1,0)-np.roll(h,1,0))/(2*MM)
    n=np.stack([-dx,dy,np.ones_like(h)],-1)
    n/=np.linalg.norm(n,axis=-1,keepdims=True)
    return n


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--normal-mode',choices=['surface','full'],default='surface')
    args=parser.parse_args()
    start=time.time();rng=np.random.default_rng(SEED)
    layout=json.loads((ROOT/'layout/layout.json').read_text())
    assert layout['pixels']==N and layout['tile_metres']==3
    previous=json.loads((ROOT/'round3/build_metadata.json').read_text())
    old_records={s['name']:s for s in previous['stones']}
    old_der=np.load(ROOT/'round3/derivation.npz')
    old_ids=old_der['stone_id']
    old_base=np.array(Image.open(ROOT/'round3/masonry_base.png'),np.float32)
    old_orm=np.array(Image.open(ROOT/'round3/masonry_orm.png'),np.float32)/255
    old_height=np.array(Image.open(ROOT/'round3/masonry_height.png'),np.float64)*(48/65535)
    old_residual=(old_height-old_der['macro_height_mm']).astype(np.float32)
    reused=np.zeros((N,N),bool)
    source_path=ROOT/'source/limestone_pigment.png'
    source=np.array(Image.open(source_path).convert('RGB'),np.float32)
    sy,sx=source.shape[:2]
    lum=np.sum(source*np.array([.2126,.7152,.0722],np.float32),axis=-1)
    # Suppress source shading and omit all generated fine luminance from the normal.
    pigment_lum=gaussian_filter(lum,3.5)-gaussian_filter(lum,58)
    pigment_chroma=gaussian_filter(source-lum[...,None],(3.5,3.5,0))
    pigment_chroma-=pigment_chroma.mean((0,1))
    fracture_path=ROOT/'source/limestone_fracture_height.png'
    fracture=np.array(Image.open(fracture_path).convert('L'),np.float32)
    # Treat this generated scalar artwork as displacement, not as photographed
    # depth. Remove its broad trend and normalize every physical stone separately.
    fracture=gaussian_filter(fracture,.65)-gaussian_filter(fracture,70)
    shape=(N,N)
    fine=noise(shape,.65,rng,True);grain=noise(shape,1.8,rng,True)
    medium=noise(shape,6,rng,True);coarse=noise(shape,26,rng,True)
    aggregate=np.maximum(grain-.75,0)
    pores=np.maximum(-grain-1.1,0)
    mortar_relief=np.clip(.14*fine+.25*grain+.17*medium+.16*coarse+.18*aggregate-.25*pores,-1.35,1.7)
    mortar_color=np.array([125,120,108],np.float32)+(2.3*fine+2.8*grain+1.8*medium+1.5*coarse)[...,None]
    mortar_color+=(5.0*aggregate-3.0*pores)[...,None]
    base=mortar_color.copy();macro=np.full(shape,1.8,np.float32)
    residual=mortar_relief.copy();mesh_h=np.zeros(shape,np.float32)
    ao=np.clip(.66+.025*medium-.06*pores,.45,.81)
    rough=np.clip(.958+.014*fine+.012*pores,.90,1)
    ids=np.full(shape,-1,np.int16);face_ids=ids.copy()
    footprint_distance=np.zeros(shape,np.float32);face_distance=np.zeros(shape,np.float32)
    profile_all=np.zeros(shape,np.float32);coverage=np.zeros(shape,np.float32)
    ochres={'k0s2':.65,'k2s0l1':.8,'k3s0':.55,'k4s0b':.85,'k5s3':.75,'k7s2':.65}
    records=[]
    for i,stone in enumerate(layout['stones']):
        old_record=old_records.get(stone['name'])
        stable_seed=(SEED+1009*(old_record['index']+1) if old_record else
                     int.from_bytes(hashlib.sha256(stone['name'].encode()).digest()[:4],'little'))
        srng=np.random.default_rng(stable_seed)
        style_rng=np.random.default_rng(stable_seed+41)
        kind=SURFACES.index(old_record['surface']) if old_record else int(style_rng.integers(0,5))
        tone=old_record['tone'] if old_record else float(style_rng.uniform(-6,7))
        tint=old_record['tint'] if old_record else float(style_rng.uniform(-.4,1.8))
        has_vein=old_record['calcite_vein'] if old_record else style_rng.random()<.12
        warmth=ochres.get(stone['name'],float(style_rng.uniform(0,.25)))
        foot=np.array(stone['footprint_metres'])*N/3
        face=np.array(stone['face_metres'])*N/3
        x0,y0=np.floor(foot.min(0)).astype(int);x1,y1=np.ceil(foot.max(0)).astype(int)
        yy,xx=np.mgrid[y0:y1,x0:x1].astype(np.float32);xx+=.5;yy+=.5
        df=edge_distances(xx,yy,foot).min(0)*MM
        ds=edge_distances(xx,yy,face).min(0)*MM
        inside=df>=0;is_face=ds>=0;h,w=df.shape;local_shape=df.shape
        a=noise(local_shape,.8,srng);b=noise(local_shape,3.0,srng)
        c=noise(local_shape,11,srng);d=noise(local_shape,34,srng)
        f=triangular_field(local_shape,srng,srng.uniform(19,33))
        broad=triangular_field(local_shape,srng,srng.uniform(38,65))
        mineral,mineral_color=grains(local_shape,srng,[1.7,2.6,3.3,2.0,2.9][kind])
        ht=srng.uniform(0,2*np.pi);hs=srng.uniform(.95,1.25)
        lx=xx-(x0+x1)/2;ly=yy-(y0+y1)/2
        hx=(lx*np.cos(ht)-ly*np.sin(ht))*hs;hy=(lx*np.sin(ht)+ly*np.cos(ht))*hs
        hox=srng.uniform(5-hx.min(),sx-6-hx.max());hoy=srng.uniform(5-hy.min(),sy-6-hy.max())
        rock=map_coordinates(fracture,[hy+hoy,hx+hox],order=1,mode='reflect')
        rock=(rock-rock[is_face].mean())/max(float(rock[is_face].std()),1e-5)
        rock=2.6*np.tanh(rock/2.6)
        relief=[.85,1.55,1.35,1.25,1.65][kind]*rock+.35*f+.25*broad
        relief+=[.11,.23,.20,.13,.20][kind]*mineral
        pit_field=noise(local_shape,[.9,1.15,1.7,1.0,1.5][kind],srng)
        pits=np.maximum(-pit_field-[1.8,1.55,1.15,1.6,1.35][kind],0)
        relief-=pits*[.35,.50,.85,.45,.70][kind]
        # Open, irregular cleavage terraces: a cut dies away on one side rather
        # than leaving a round stamped crater. Sizes are centimetres, depths mm.
        clefts=np.zeros(local_shape,np.float32);fresh=np.zeros_like(clefts)
        count=[0,1,1,3,2][kind]
        for _ in range(count):
            cx=srng.uniform(.08,.92)*w+x0;cy=srng.uniform(.08,.92)*h+y0
            radius=srng.uniform(9,27);theta=srng.uniform(0,2*np.pi)
            angles=np.linspace(0,2*np.pi,7,endpoint=False)+theta
            vertices=np.column_stack([cx+np.cos(angles)*radius*srng.uniform(.80,1.15,7),
                                      cy+np.sin(angles)*radius*srng.uniform(.55,.95,7)])
            boundary=edge_distances(xx,yy,vertices).min(0)+.6*b
            mask=smooth(boundary/srng.uniform(.9,1.8))
            u=((xx-cx)*np.cos(theta)+(yy-cy)*np.sin(theta))/radius
            ramp=smooth((u+.5)/1.25)
            depth=srng.uniform(1.0,[2.5,4.6,3.7,4.7,5.6][kind])
            clefts+=mask*ramp*depth
            fresh+=mask*ramp*srng.uniform(-1.7,2.5)
        relief-=clefts
        tools=np.zeros_like(clefts)
        if kind==3:
            direction=srng.uniform(0,np.pi)
            for _ in range(int(srng.integers(9,20))):
                cx=srng.uniform(.1,.9)*w+x0;cy=srng.uniform(.1,.9)*h+y0
                theta=direction+srng.uniform(-.4,.4)
                u=(xx-cx)*np.cos(theta)+(yy-cy)*np.sin(theta)
                v=-(xx-cx)*np.sin(theta)+(yy-cy)*np.cos(theta)
                tools+=np.maximum(0,1-np.abs(u)/srng.uniform(3,7)-np.abs(v)/srng.uniform(1.2,2.5))*srng.uniform(1.2,3.6)
        relief-=tools
        if kind==4:
            corner=face[int(srng.integers(0,8))]
            radius=srng.uniform(19,35)
            cut=np.maximum(0,1-np.hypot(xx-corner[0],yy-corner[1])/radius)
            relief-=cut*srng.uniform(4.8,7.8)
        vein=np.zeros_like(clefts)
        if has_vein:
            vx=xx-x0-srng.uniform(.25,.75)*w;vy=yy-y0-srng.uniform(.25,.75)*h
            bend=srng.uniform(-.4,.4)*vx+1.7*np.sin(vx/21)
            vein=np.exp(-((vy-bend)/.9)**2)*np.exp(-(vx/srng.uniform(27,60))**4)
            relief+=.16*vein
        # No crown or corner-rise field goes into the delivered surface relief.
        relief-=np.mean(relief[is_face])
        relief=np.clip(relief,-7.8,5.2)
        p,model=geometry_profiles(xx,yy,foot,face,stone)
        p[is_face]=1
        # Arris weathering is small-scale relief on the geometric bevel.
        arris=(1-smooth(ds/7))*smooth(df/4)
        relief-=arris*(.55*np.maximum(b-.2,0)+.45*np.maximum(c-.3,0))
        fade=smooth(df/3.0)*smooth(p/.2)
        gy=yy.astype(int)%N;gx=xx.astype(int)%N
        res=relief*fade+mortar_relief[gy,gx]*(1-fade)
        res=np.maximum(res,.35-(1.8+38.2*p))
        cov=smooth(df/.75)
        # Independent source crop per physical stone, in unwrapped coordinates.
        theta=srng.uniform(0,2*np.pi);scale=srng.uniform(.95,1.25)
        lx=xx-(x0+x1)/2;ly=yy-(y0+y1)/2
        tx=(lx*np.cos(theta)-ly*np.sin(theta))*scale;ty=(lx*np.sin(theta)+ly*np.cos(theta))*scale
        ox=srng.uniform(5-tx.min(),sx-6-tx.max());oy=srng.uniform(5-ty.min(),sy-6-ty.max())
        sampled=map_coordinates(pigment_lum,[ty+oy,tx+ox],order=1,mode='reflect')
        sampled-=sampled[inside].mean()
        chroma=np.stack([map_coordinates(pigment_chroma[...,ch],[ty+oy,tx+ox],order=1,mode='reflect') for ch in range(3)],-1)
        centre=np.array([164,157,143],np.float32)+tone+tint*np.array([1.4,.25,-1.1])
        pigment=.28*sampled+[1.8,2.6,2.7,2.1,2.5][kind]*mineral_color+1.0*b+1.8*c+2.0*d
        pigment+=.45*(rock-gaussian_filter(rock,9))
        col=centre+pigment[...,None]+.35*chroma
        # Pigment follows geology and age, not a directional light or macro normal.
        vertical=(yy-y0)/h
        bed=np.exp(-((vertical-srng.uniform(.35,.75)-.027*c)/srng.uniform(.07,.14))**2)
        iron=smooth((d-.15)*.65)*smooth((c+.4)*.7)
        crust=smooth((c-.1)*.8)*np.exp(-vertical*2.6)
        col-=bed[...,None]*srng.uniform(2.0,4.5)
        col+=iron[...,None]*np.array([4.6,1.2,-2.8])
        col+=crust[...,None]*np.array([4.0,3.8,3.0])
        col+=fresh[...,None]*.65+vein[...,None]*4.0
        stains=np.zeros_like(df)
        for _ in range(4):
            cx=srng.uniform(0,w);top=np.maximum(yy-y0,0)
            stains+=np.exp(-((xx-x0-cx-.02*top-.9*b)/srng.uniform(2,5))**2)*np.exp(-top/srng.uniform(16,43))
        lower=np.exp(-(h-(yy-y0))/10)*(.6+.2*np.clip(c,-1,1))
        col-=stains[...,None]*np.array([4.0,4.0,3.2])+lower[...,None]*np.array([3.6,3.4,2.8])
        lichen=smooth((b-1.8)*1.2)*smooth((a-.4)*1.6)*smooth(df/8)
        col+=lichen[...,None]*np.array([6.0,6.3,1.5])
        # Stone and mortar stay separated by the prescribed footprint, not old joints.
        col=mortar_color[gy,gx]*(1-cov[...,None])+col*cov[...,None]
        cavity=np.maximum(gaussian_filter(relief,4)-relief-.25,0)
        rock_ao=np.clip(1-.035*cavity-.025*pits,.82,1)
        local_ao=np.minimum(rock_ao,.70+.30*p)+.01*medium[gy,gx]*(1-p)
        local_rough=np.clip([.81,.84,.89,.85,.88][kind]+.012*b+.010*mineral_color+.012*pits,.75,.95)
        local_rough=rough[gy,gx]*(1-cov)+local_rough*cov
        iy=gy[inside];ix=gx[inside]
        assert np.all(ids[iy,ix]==-1),'Overlapping footprints'
        reuse=(old_record is not None and np.count_nonzero(old_ids==old_record['index'])==len(iy)
               and np.all(old_ids[iy,ix]==old_record['index']))
        if reuse:
            col[inside]=old_base[iy,ix]
            local_rough[inside]=old_orm[iy,ix,1]
            reused[iy,ix]=True
        else:
            # Bring new procedural pigment into the same round-three exposure.
            col+=np.array(previous['color_correction'])*cov[...,None]
        # Redistribute chroma: most stones become balanced pale buff, with a
        # sparse continuous ochre tail. Global RGB mean is restored below.
        hue=np.array([1.3,-.8,.5])+warmth*np.array([8.5,1.0,-10.0])
        col+=hue*cov[...,None]
        ids[iy,ix]=i;face_ids[gy[is_face],gx[is_face]]=i
        base[iy,ix]=col[inside];macro[iy,ix]=fit_macro(model[inside])
        residual[iy,ix]=res[inside];mesh_h[iy,ix]=model[inside]
        ao[iy,ix]=local_ao[inside];rough[iy,ix]=local_rough[inside]
        footprint_distance[iy,ix]=df[inside];face_distance[iy,ix]=ds[inside]
        profile_all[iy,ix]=p[inside];coverage[iy,ix]=cov[inside]
        record={'index':i,'name':stone['name'],'surface':SURFACES[kind],
                        'source_angle':float(theta),'source_scale':float(scale),'source_offset':[float(ox),float(oy)],
                        'fracture_angle':float(ht),'fracture_scale':float(hs),'fracture_offset':[float(hox),float(hoy)],
                        'tone':float(tone),'tint':float(tint),'calcite_vein':bool(has_vein)}
        if reuse:
            record={**old_record,'index':i}
        record.update({'appearance_reused':bool(reuse),'previous_index':old_record['index'] if old_record else None,
                       'seed':stable_seed,'ochre_weight':warmth,'crown_peak_model_mm':float(crown_peak(stone)),
                       'crown_mm':stone['crown_mm'],'crown_at_metres':stone['crown_at_metres']})
        records.append(record)
    # Suppress accidental course-wide color bands while keeping ~25 levels between stones.
    course_balance={};face_mask=face_ids>=0;mean=base[face_mask].mean(0,dtype=np.float64)
    for course in range(8):
        members=[i for i,s in enumerate(layout['stones']) if s['name'].startswith(f'k{course}s')]
        m=np.isin(ids,members);adjust=.55*(mean-base[m&face_mask].mean(0,dtype=np.float64))
        base[m]+=coverage[m,None]*adjust;course_balance[str(course)]=adjust.tolist()
    # The 3x3 review exposed two isolated dark anchors. Keep a continuous
    # 22-level range of stone means without those outliers dominating the repeat.
    stone_adjustments={}
    weights=np.array([.2126,.7152,.0722])
    face_luma=float(base[face_mask].mean(0,dtype=np.float64)@weights)
    for i,stone in enumerate(layout['stones']):
        current=float(base[face_ids==i].mean(0,dtype=np.float64)@weights)
        adjust=float(np.clip(current,face_luma-10,face_luma+12)-current)
        group=ids==i;base[group]+=coverage[group,None]*adjust
        stone_adjustments[stone['name']]=adjust
    target=np.array([156.,150.,138.]);correction=target-base.mean((0,1),dtype=np.float64)
    graded=np.clip(base+correction,0,255)
    # Unbiased sub-level rounding avoids a mean shift when preserved 8-bit stone
    # colours receive constant grades. One shared threshold avoids RGB speckle.
    threshold=np.random.default_rng(SEED+4004).random((N,N,1),dtype=np.float32)
    base=(np.floor(graded)+(graded-np.floor(graded)>threshold)).astype(np.uint8)
    # Both components use the same tiny periodic anti-alias filter, preserving subtraction.
    macro=gaussian_filter(macro,.36,mode='wrap')
    residual=gaussian_filter(residual,.36,mode='wrap')
    # The archived surface was already filtered. Copy it after filtering to avoid
    # softening approved detail a second time. Include its immediate mortar fringe.
    reuse_mask=reused|(binary_dilation(reused,iterations=2)&(ids<0)&(old_ids<0))
    residual[reuse_mask]=old_residual[reuse_mask]
    newly_exposed=(face_ids>=0)&(~reused|(old_der['face_distance_mm']<2))
    spall_limited=newly_exposed&(residual < -8)
    residual[spall_limited]=-8
    # Update AO for the widened face rings, preserving roughness and all reused grain.
    cavity=np.maximum(gaussian_filter(residual,4,mode='wrap')-residual-.25,0)
    rock_ao=np.clip(1-.04*cavity,.82,1)
    stone_pixels=ids>=0
    ao[stone_pixels]=np.minimum(rock_ao,.70+.30*profile_all)[stone_pixels]
    # The common monotone fit keeps faces near 40 mm and preserves every
    # off-centre peak location. Fine relief remains at its original mm scale.
    # Deep chips at the foot of a newly lowered bevel cannot pass below the
    # representable mortar floor. Face detail is unaffected by this contact bound.
    floor_limited=(macro+residual)<.35
    residual=np.maximum(residual,.35-macro)
    h=macro+residual
    assert h.min()>=0 and h.max()<=48
    height16=np.rint(h/48*65535).astype(np.uint16)
    srgb=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
    Image.fromarray(base).save(ROOT/'masonry_base.png',icc_profile=srgb)
    Image.fromarray(height16).save(ROOT/'masonry_height.png')
    delivered=np.array(Image.open(ROOT/'masonry_height.png'),np.float32)*(48/65535)
    normal_input=delivered-macro if args.normal_mode=='surface' else delivered
    n=normal_from_height(normal_input)
    Image.fromarray(np.rint((n*.5+.5)*255).astype(np.uint8)).save(ROOT/'masonry_normal.png')
    orm=np.stack([ao,rough,np.zeros(shape,np.float32)],-1)
    Image.fromarray(np.rint(np.clip(orm,0,1)*255).astype(np.uint8)).save(ROOT/'masonry_orm.png')
    np.savez_compressed(ROOT/'derivation.npz',stone_id=ids,face_id=face_ids,
                        footprint_distance_mm=footprint_distance,face_distance_mm=face_distance,
                        stone_coverage=coverage,bevel_fraction=profile_all,
                        macro_height_mm=macro,geometry_preview_height_mm=mesh_h,reused_appearance=reused)
    (ROOT/'build_layout.json').write_text(json.dumps(layout,indent=2)+'\n')
    meta={'round':4,'seed':SEED,'pixels':N,'tile_metres':3,'mm_per_pixel':MM,'height_range_mm':48,
          'normal_mode':args.normal_mode,'normal_formula':'normalize(-dh/dx, +dh/dy_image, 1)',
          'macro_height':'One monotone fit of layout corner rises and off-centre crowns into 48 mm, faces near 40 mm; micro relief unscaled',
          'macro_fit':MACRO_FIT,'reused_stone_count':sum(s['appearance_reused'] for s in records),
          'rebuilt_stone_count':sum(not s['appearance_reused'] for s in records),
          'bevel_floor_limited_pixels':int(floor_limited.sum()),
          'newly_exposed_spall_limited_pixels':int(spall_limited.sum()),
          'appearance_archive':'round3','palette':'balanced warm buff continuum with six restrained ochre accents; exact original RGB mean',
          'layout_sha256':hashlib.sha256((ROOT/'layout/layout.json').read_bytes()).hexdigest(),
          'source':{'file':'source/limestone_pigment.png','dimensions':[sx,sy],'sha256':hashlib.sha256(source_path.read_bytes()).hexdigest(),
                    'use':'Only subdued, band-limited mineral pigment and chroma. No generated relief or fine luminance.'},
          'fracture_source':{'file':'source/limestone_fracture_height.png','dimensions':[sx,sy],
                    'sha256':hashlib.sha256(fracture_path.read_bytes()).hexdigest(),
                    'use':'Scalar displacement artwork, detrended, cropped independently, rescaled to millimetres. Native grain, pits and tool cuts added procedurally.'},
          'mean_base_srgb':base.mean((0,1)).tolist(),'color_correction':correction.tolist(),
          'course_balance':course_balance,'repeat_review_stone_adjustments':stone_adjustments,
          'stones':records,'build_seconds':time.time()-start}
    (ROOT/'build_metadata.json').write_text(json.dumps(meta,indent=2)+'\n')
    print(json.dumps({k:v for k,v in meta.items() if k!='stones'},indent=2))


if __name__=='__main__':main()
