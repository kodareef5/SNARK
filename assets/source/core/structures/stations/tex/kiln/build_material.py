#!/usr/bin/env python3
"""Deterministic native 2K kiln trim. Run from this directory. No network required."""
from pathlib import Path
import json, time, hashlib
import numpy as np
from PIL import Image, ImageDraw, PngImagePlugin
from scipy.ndimage import gaussian_filter, map_coordinates, distance_transform_edt
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parent
N = 2048
MM = 2000.0
HEIGHT_MM = 40.0
SEED = 15112673

def smooth(a, b, x):
    t = np.clip((x-a)/(b-a), 0, 1)
    return t*t*(3-2*t)

def normal_from_height(h):
    step = MM/h.shape[0]
    dx = (np.roll(h,-1,1)-np.roll(h,1,1))/(2*step)
    dy = (np.roll(h,-1,0)-np.roll(h,1,0))/(2*step)
    n = np.stack([-dx,dy,np.ones_like(h)],-1)
    n /= np.linalg.norm(n,axis=-1,keepdims=True)
    return np.rint((n*.5+.5)*255).clip(0,255).astype(np.uint8)

def save_png(a, path, srgb=False):
    info = PngImagePlugin.PngInfo()
    if srgb:
        info.add(b'sRGB', b'\x00')
    Image.fromarray(a).save(path, pnginfo=info, compress_level=6)

def half(a):
    n = a.shape[0]//2
    shape = (n,2,n,2)+a.shape[2:]
    return np.rint(a.astype(np.float64).reshape(shape).mean((1,3))).astype(a.dtype)

def build():
    start = time.perf_counter()
    out = ROOT/'source'
    out.mkdir(exist_ok=True)
    rng = np.random.default_rng(SEED)
    yy,xx = np.mgrid[:N,:N].astype(np.float32)
    def noise(sigma):
        v = gaussian_filter(rng.standard_normal((N,N),dtype=np.float32),sigma,mode='wrap')
        return (v-v.mean())/(v.std()+1e-8)
    broad = noise(85)
    mottled = noise(18)
    grit = noise(.7)
    medium = noise(3.5)
    fine = noise(1.3)
    edge_noise = noise(3)*.8+noise(12)*1.2
    fingers = noise((1.9,45))
    warp = noise((12,100))*2.8
    fingers = map_coordinates(fingers, [(yy+warp)%N,xx],order=1,mode='grid-wrap')

    # A toroidal, warped drying network. Distance is to actual Voronoi bisectors.
    seeds = rng.random((1550,2))*N
    tree = cKDTree(seeds,boxsize=N)
    wx,wy = noise(15)*5,noise(15)*5
    dist = np.empty((N,N),np.float32)
    for y0 in range(0,N,128):
        q = np.stack([(yy[y0:y0+128]+wy[y0:y0+128])%N,
                      (xx[y0:y0+128]+wx[y0:y0+128])%N],-1)
        ds,ids = tree.query(q,k=2,workers=2)
        delta=seeds[ids[...,0]]-seeds[ids[...,1]]
        delta=(delta+N/2)%N-N/2
        dist[y0:y0+128]=(ds[...,1]**2-ds[...,0]**2)/(2*np.maximum(np.linalg.norm(delta,axis=-1),1))
    crack_strength = .4+.6*smooth(-1,1.2,noise(27))
    daub_crack = np.exp(-(dist/(.62+.18*smooth(-1,1,medium)))**2)*crack_strength
    craze = np.exp(-(dist/.45)**2)*(.3+.7*smooth(-.3,1.2,mottled))
    daub_h = 10 + .55*noise(28)+.30*medium+.11*grit - daub_crack*.85
    scorch = smooth(-.2,1.75,broad*.75+noise(120)*.25)
    ash = smooth(.55,1.8,noise((9,35)))*smooth(.2,1.4,noise(50))
    fired_h = 13 + .23*noise(48)+.075*fingers+.025*fine-.23*craze
    fired_rgb = np.array([168,132,100],np.float32)+(
        -scorch[...,None]*np.array([26,19,11])+ash[...,None]*np.array([12,12,12])
        +mottled[...,None]*1.5+fingers[...,None]*.7+fine[...,None]*.5
        -craze[...,None]*np.array([12,10,8]))
    fired_rgb += np.array([168,132,100])-fired_rgb[1536:].mean((0,1))
    daub_rgb = np.array([150,124,98],np.float32)+(
        -scorch[...,None]*np.array([22,13,5])+mottled[...,None]*3
        +medium[...,None]*1.5+grit[...,None]*1.2+ash[...,None]*np.array([8,9,10])
        -daub_crack[...,None]*np.array([22,19,15]))

    src = np.asarray(Image.open(out/'riverstone_grain.png').convert('RGB'),np.float32)
    lum = src.mean(-1)
    # Detrend artwork. Large illumination and any source composition cannot enter a stone.
    hp = lum-gaussian_filter(lum,18)
    hp = np.clip(hp/(hp.std()+1e-6),-3,3)
    pigment = src-gaussian_filter(src,(18,18,0))
    pigment = np.clip(pigment/(pigment.std()+1e-6),-3,3)
    source_shape = src.shape[:2]
    stone_rgb = np.zeros((N,N,3),np.float32)
    macro_h = daub_h.copy()
    relief = np.zeros((N,N),np.float32)
    stone_mask = np.zeros((N,N),np.float32)
    ids_map = np.zeros((N,N),np.uint16)
    thermal = np.zeros((N,N),np.float32)
    soot = np.zeros((N,N),np.float32)
    records=[]
    # Unequal course pitches, with shared periodic wander; no fixed brick bond.
    pitches = np.array([149,165,145,158,148,169,145,155,154,148],np.float32)
    pitches *= 1536/pitches.sum()
    bounds=np.r_[0,np.cumsum(pitches)]
    phases=rng.random((11,3))*2*np.pi
    def course_line(row,x):
        return bounds[row]+11*np.sin(2*np.pi*x/N*3+phases[row,0])+6*np.sin(2*np.pi*x/N*7+phases[row,1])+3*np.sin(2*np.pi*x/N*11+phases[row,2])
    sid=0
    for row in range(10):
        count = [9,10,9,9,10,9,10,9,9,10][row]
        while True:
            widths = rng.uniform(150,320,count)
            widths *= N/widths.sum()
            if widths.min()>=146 and widths.max()<=316:break
        shift=rng.uniform(0,N)
        edges=np.r_[0,np.cumsum(widths)]+shift
        for col in range(count):
            sid+=1
            x0,x1=edges[col:col+2]
            cx=(x0+x1)/2
            gap=rng.uniform(15.5,24)
            l,r=x0+gap/2,x1-gap/2
            ytop=course_line(row,cx)+rng.uniform(6,12)
            ybot=course_line(row+1,cx)-rng.uniform(6,12)
            cy=(ytop+ybot)/2
            # Shorter individual stones interrupt the mortar lines locally.
            if rng.random()<.18:
                ytop+=rng.uniform(5,13)
            h=ybot-ytop
            w=r-l
            rounded = bool(rng.random()<.30)
            corners=rng.uniform(.04,.23,4)
            if rounded:
                corners+=.07
            slope=rng.uniform(-12,12)
            taper=rng.uniform(-.07,.07)*w
            # Irregular octagons with independently cut corners and sloping faces.
            pts=np.array([
                [l+w*corners[0]+taper,ytop-slope+rng.uniform(-7,7)],
                [r-w*corners[1]-taper,ytop+slope+rng.uniform(-7,7)],
                [r+rng.uniform(-5,3),ytop+h*corners[1]],
                [r+rng.uniform(-7,3),ybot-h*corners[2]],
                [r-w*corners[2]+taper,ybot+slope*.7+rng.uniform(-7,7)],
                [l+w*corners[3]-taper,ybot-slope*.7+rng.uniform(-7,7)],
                [l+rng.uniform(-3,7),ybot-h*corners[3]],
                [l+rng.uniform(-3,5),ytop+h*corners[0]]])
            minx,maxx=int(l)-24,int(r)+25
            miny,maxy=max(0,int(ytop)-25),min(N,int(ybot)+26)
            ly,lx=np.mgrid[miny:maxy,minx:maxx].astype(np.float32)
            gx=lx.astype(int)%N
            gy=ly.astype(int)%N
            poly=Image.new('L',(maxx-minx,maxy-miny),0)
            ImageDraw.Draw(poly).polygon([tuple(v-[minx,miny]) for v in pts],fill=255)
            field=np.asarray(poly)>0
            sdf=distance_transform_edt(field)-distance_transform_edt(~field)
            sdf=gaussian_filter(sdf,7.5 if rounded else 2.2)
            if rounded:
                # Some river cobbles are genuinely oval, with broad shoulders.
                su=(lx-cx+(ly-cy)*slope/100)/(w*.52)
                sv=(ly-cy-(lx-cx)*slope/250)/(h*.55)
                exponent=rng.uniform(2.3,3.4)
                round_sdf=(1-(abs(su)**exponent+abs(sv)**exponent)**(1/exponent))*min(w,h)/2
                sdf=.72*round_sdf+.28*sdf
            sdf+=edge_noise[gy,gx]
            mask=smooth(-.8,1.2,sdf).astype(np.float32)
            rise=smooth(-1,14 if rounded else 10,sdf)
            # No artificial directional height light. Off-centre crowns and split facets.
            u=(lx-cx)/(w/2);v=(ly-cy)/(h/2)
            crown=np.clip(1-(u-rng.uniform(-.2,.2))**2*.5-(v-rng.uniform(-.2,.2))**2*.7,0,1)
            flatness=rng.uniform(1.6,3.8) if rounded else rng.uniform(.7,1.7)
            face_mm=rng.uniform(9,13)+flatness*crown
            tilt=rng.uniform(-1.1,1.1)*u+rng.uniform(-.8,.8)*v
            macro=daub_h[gy,gx]+rise*(face_mm+tilt)
            # Every footprint samples its own rotation and full-resolution source crop.
            angle=rng.uniform(-np.pi,np.pi)
            scale=rng.uniform(.75,1.45)
            sx=rng.uniform(300,source_shape[1]-300)+(np.cos(angle)*(lx-cx)-np.sin(angle)*(ly-cy))*scale
            sy=rng.uniform(300,source_shape[0]-300)+(np.sin(angle)*(lx-cx)+np.cos(angle)*(ly-cy))*scale
            localgrain=map_coordinates(hp,[sy,sx],order=1,mode='reflect')
            localpig=np.stack([map_coordinates(pigment[...,c],[sy,sx],order=1,mode='reflect') for c in range(3)],-1)
            split_relief=.52*medium[gy,gx]+.55*mottled[gy,gx]+.14*localgrain+.055*grit[gy,gx]
            # A handful of thermally split stones; narrow branching irregular fissures.
            fiss=np.zeros_like(sdf,dtype=np.float32)
            has_split=rng.random()<.13
            if has_split:
                theta=rng.uniform(.7,2.4)
                cross=(lx-cx)*np.cos(theta)+(ly-cy)*np.sin(theta)
                along=-(lx-cx)*np.sin(theta)+(ly-cy)*np.cos(theta)
                cross+=3*np.sin(along*.065+rng.uniform(0,6))+1.8*medium[gy,gx]
                fiss=np.exp(-(cross/rng.uniform(.85,1.35))**2)
                branch=np.exp(-((cross-(along-8)*.50)/.75)**2)*smooth(4,12,along)*smooth(58,28,along)
                fiss=np.maximum(fiss,branch)*smooth(1,6,sdf)
            split_relief-=fiss*rng.uniform(1.3,2.5)
            localsoot=smooth(-.7,1.4,.6*broad[gy,gx]+.55*mottled[gy,gx]+rng.uniform(-.7,.7))
            tone=rng.uniform(-11,11)
            hue=rng.uniform(-1,1)
            color=np.array([80,74,68],np.float32)+tone+np.array([3,-.3,-4])*hue
            rgb=color+localpig*2.5+mottled[gy,gx,None]*2.4+fine[gy,gx,None]*.7
            rgb-=localsoot[...,None]*np.array([12,10,8])
            rgb-=fiss[...,None]*np.array([12,11,10])
            # Grey dust trapped in micro-hollows, independent of a light direction.
            dust=smooth(.8,2, -medium[gy,gx])*smooth(.4,1.5,mottled[gy,gx])
            rgb+=dust[...,None]*np.array([8,9,10])
            old=stone_mask[gy,gx]
            win=mask>old
            stone_mask[gy,gx]=np.maximum(old,mask)
            macro_h[gy,gx]=np.where(win,macro,macro_h[gy,gx])
            relief[gy,gx]=np.where(win,split_relief*rise,relief[gy,gx])
            stone_rgb[gy,gx]=np.where(win[...,None],rgb,stone_rgb[gy,gx])
            ids_map[gy,gx]=np.where(win&(mask>.5),sid,ids_map[gy,gx])
            thermal[gy,gx]=np.where(win,fiss,thermal[gy,gx])
            soot[gy,gx]=np.where(win,localsoot,soot[gy,gx])
            records.append(dict(id=sid,course=row,rounded=rounded,heat_split=bool(has_split),
                                width_mm=float(w*MM/N),height_mm=float(h*MM/N),
                                points_px=pts.tolist(),source_center=[float(sx.mean()),float(sy.mean())],
                                source_angle=float(angle),source_scale=float(scale)))

    # Reserve a real clay gap at close, tipped corners without straightening their
    # outlines. Move both nearby faces away from the equidistant joint centre.
    old_ids=ids_map.copy();old_mask=stone_mask.copy()
    for rec in records:
        sid=rec['id'];pts=np.asarray(rec['points_px'])
        x0=int(pts[:,0].min())-48;x1=int(pts[:,0].max())+49
        y0=max(0,int(pts[:,1].min())-48);y1=min(N,int(pts[:,1].max())+49)
        gy,gx=np.mgrid[y0:y1,x0:x1];gx%=N
        labels=old_ids[gy,gx];own=labels==sid
        other=(labels!=0)&~own
        if not own.any() or not other.any():continue
        signed=distance_transform_edt(own)-distance_transform_edt(~own)
        other_distance=distance_transform_edt(~other)
        adjusted=np.minimum(signed,(signed+other_distance-17)/2)
        support=(signed>-3)&(other_distance>np.maximum(-signed,0))
        new_mask=np.minimum(old_mask[gy,gx],smooth(-.8,1.2,adjusted))
        bevel=14 if rec['rounded'] else 10
        ratio=np.minimum(1,smooth(-1,bevel,adjusted)/np.maximum(smooth(-1,bevel,signed),.001))
        stone_mask[gy,gx]=np.where(support,new_mask,stone_mask[gy,gx])
        new_macro=daub_h[gy,gx]+(macro_h[gy,gx]-daub_h[gy,gx])*ratio
        macro_h[gy,gx]=np.where(support,new_macro,macro_h[gy,gx])
        relief[gy,gx]=np.where(support,relief[gy,gx]*ratio,relief[gy,gx])
        ids_map[gy,gx]=np.where(own&(new_mask<.5),0,ids_map[gy,gx])
    # Match constituent colours separately, without adding any gradient or lighting.
    interior=(stone_mask>.98)&(yy>50)&(yy<1486)
    stone_rgb+=np.array([78,73,67])-stone_rgb[interior].mean(0)
    mortar=(stone_mask<.02)&(yy>50)&(yy<1486)
    daub_rgb+=np.array([147,122,98])-daub_rgb[mortar].mean(0)
    wall_rgb=daub_rgb*(1-stone_mask[...,None])+stone_rgb*stone_mask[...,None]
    # All transitions are inside stone rows. At both exact boundaries the continuous
    # periodic fired-clay field is exposed, like a wiped clay smear over the course.
    boundary_wander=4*np.sin(xx*2*np.pi/N*5)+2*np.sin(xx*2*np.pi/N*11+.7)
    wall_weight=smooth(8+boundary_wander,34+boundary_wander,yy)*smooth(1528+boundary_wander,1502+boundary_wander,yy)
    wall_weight=np.clip(wall_weight,0,1).astype(np.float32)
    h_wall=macro_h+relief
    height=fired_h*(1-wall_weight)+h_wall*wall_weight
    # Subtexel relief prefilter preserves native grain but prevents unstable slopes.
    height=gaussian_filter(height,.55,mode='wrap')
    rgb=fired_rgb*(1-wall_weight[...,None])+wall_rgb*wall_weight[...,None]
    # Cavities only: concavity and actual crack depth, never a directional shadow.
    cavity=np.maximum(gaussian_filter(height,7,mode='wrap')-height,0)
    widecavity=np.maximum(gaussian_filter(height,18,mode='wrap')-height,0)
    ao=np.exp(-.065*cavity-.022*widecavity-.16*daub_crack*(1-stone_mask)*wall_weight-.25*thermal*wall_weight-.045*craze*(1-wall_weight))
    stone_rough=np.maximum(np.clip(.865+.018*medium+.065*soot,.80,1),.80+.10*smooth(.2,.7,soot))
    daub_rough=np.clip(.95+.012*medium+.018*scorch,.91,1)
    fired_rough=np.clip(.815+.018*mottled+.035*scorch+.018*ash,.75,.90)
    rough=fired_rough*(1-wall_weight)+(stone_rough*stone_mask+daub_rough*(1-stone_mask))*wall_weight
    orm=np.stack([ao,rough,np.zeros_like(ao)],-1)
    base=np.rint(rgb).clip(0,255).astype(np.uint8)
    h16=np.rint(height/HEIGHT_MM*65535).clip(0,65535).astype(np.uint16)
    orm8=np.rint(orm*255).clip(0,255).astype(np.uint8)
    for suffix,size in [('',N),('_1024',N//2)]:
        b,hh,o=(base,h16,orm8) if not suffix else (half(base),half(h16),half(orm8))
        save_png(b,ROOT/f'kiln_base{suffix}.png',True)
        save_png(hh,ROOT/f'kiln_height{suffix}.png')
        saved=np.asarray(Image.open(ROOT/f'kiln_height{suffix}.png'),np.float64)*HEIGHT_MM/65535
        save_png(normal_from_height(saved),ROOT/f'kiln_normal{suffix}.png')
        save_png(o,ROOT/f'kiln_orm{suffix}.png')
    np.savez_compressed(out/'construction_fields.npz',stone_mask=stone_mask,stone_ids=ids_map,
                        wall_weight=wall_weight,macro_mm=macro_h,relief_mm=relief,
                        fired_mm=fired_h,daub_crack=daub_crack,crazing=craze,
                        thermal_crack=thermal,soot=soot,scorch=scorch,ash=ash,
                        height_unfiltered_mm=fired_h*(1-wall_weight)+h_wall*wall_weight)
    save_png(ids_map,out/'stone_ids.png')
    save_png(np.rint(stone_mask*255).astype(np.uint8),out/'stone_mask.png')
    save_png(np.rint(np.stack([daub_crack,thermal,scorch],-1)*255).astype(np.uint8),out/'crack_soot_fields.png')
    meta=dict(seed=SEED,metres_per_tile=[2,2],height_encoding_mm=[0,40],
              bands_px=dict(stone=[0,1536],clay=[1536,2048]),stones=records,
              stone_count=sid,source_size=list(source_shape[::-1]),
              source_sha256=hashlib.sha256((out/'riverstone_grain.png').read_bytes()).hexdigest(),
              method='Native periodic fields and individual stone footprints. RGB8 sRGB base; all data maps linear.',
              master_mean_stone_band=base[:1536].mean((0,1)).tolist(),
              master_mean_fired_band=base[1536:].mean((0,1)).tolist(),
              stone_area_fraction=float(stone_mask[:1536].mean()),
              actual_height_mm=[float(h16.min())*40/65535,float(h16.max())*40/65535],
              build_seconds=round(time.perf_counter()-start,3))
    (out/'construction.json').write_text(json.dumps(meta,indent=2)+'\n')
    print(json.dumps({k:v for k,v in meta.items() if k!='stones'},indent=2))

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify-rebuild',action='store_true',help='Compare delivery and source bytes before/after a full rebuild.')
    args=parser.parse_args()
    paths=list(sorted(ROOT.glob('kiln_*.png')))+list(sorted((ROOT/'source').glob('*.png')))+[ROOT/'source/construction_fields.npz']
    before={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths if p.exists()} if args.verify_rebuild else None
    build()
    if before is not None:
        after={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in before}
        result=dict(checked=len(before),all_identical=before==after,files={name:dict(before=before[name],after=after[name],identical=before[name]==after[name]) for name in before})
        (ROOT/'checks').mkdir(exist_ok=True)
        (ROOT/'checks/rebuild_verification.json').write_text(json.dumps(result,indent=2)+'\n')
        print('Rebuild:',result['checked'],'files, identical =',result['all_identical'])
        if not result['all_identical']:raise SystemExit(1)
