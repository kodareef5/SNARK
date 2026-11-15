"""Rebuild hood materials from retained generated masters. Python/Pillow/NumPy/SciPy.

Only writes beneath this directory. Source originals are never modified.
Examples:
    python3 build.py
    python3 build.py --sets cap cap_to_mane
    python3 build.py --scale 1.2 --direction 15
Direction is degrees clockwise from picture-down. Scale multiplies feather sizes.
Defaults implement the brief; altered runs are experiments, not compliant deliveries.
"""
from pathlib import Path
import argparse, hashlib, json, time
import numpy as np
from PIL import Image, PngImagePlugin
from scipy.ndimage import gaussian_filter, gaussian_filter1d, distance_transform_edt, map_coordinates

ROOT = Path(__file__).resolve().parent
SRC = ROOT/'source'
N = 2048
SEED = 419071
SOURCE_ATLASES = {'cap':'cap_plush_r3_original.png', 'mane':'mane_full_r2_original.png',
                  'mane_card':'mane_r2_original.png', 'cap_card':'cap_r2_original.png'}


def save(path, a, bits=8, srgb=False):
    path = Path(path)
    info = PngImagePlugin.PngInfo()
    info.add(b'gAMA', (45455 if srgb else 100000).to_bytes(4, 'big'))
    if srgb: info.add(b'sRGB', b'\x00')
    info.add_text('Description', 'Dodo hood study; sRGB colour' if srgb else 'Dodo hood study; linear data')
    a = np.rint(np.clip(a,0,1)*(65535 if bits==16 else 255)).astype(np.uint16 if bits==16 else np.uint8)
    Image.fromarray(a).save(path, pnginfo=info)
    return a


def linear(a):
    return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)


def srgb(a):
    return np.where(a<=.0031308,12.92*a,1.055*np.maximum(a,0)**(1/2.4)-.055)


def normal(h, span, height_mm, tiles):
    slope = height_mm/1000*N/span
    dy = (np.roll(h,-1,0)-np.roll(h,1,0))*.5 if tiles[1] else np.gradient(h,axis=0)
    dx = (np.roll(h,-1,1)-np.roll(h,1,1))*.5 if tiles[0] else np.gradient(h,axis=1)
    v = np.stack((-dx*slope,dy*slope,np.ones_like(h)),axis=-1)
    return v/np.linalg.norm(v,axis=-1,keepdims=True)


def opaque_alpha(a):
    # Retain the generated open barb gaps. No hole filling or convex silhouette.
    # Raise partially opaque fibres to an alpha-testable core; keep a narrow AA rim.
    a=np.clip((a-.035)/.48,0,1)
    return a.astype(np.float32)


def make_sources():
    feathers=[]; manifest=[]
    for kind, rows, cols in [('cap',3,4),('mane',2,4),('mane_card',2,4),('cap_card',3,4)]:
        source_name=SOURCE_ATLASES[kind]
        master=np.asarray(Image.open(SRC/source_name).convert('RGBA'),np.float32)/255
        mh,mw=master.shape[:2]
        for i in range(rows*cols):
            r,c=divmod(i,cols)
            cell=[round(c*mw/cols),round(r*mh/rows),round((c+1)*mw/cols),round((r+1)*mh/rows)]
            raw=master[cell[1]:cell[3],cell[0]:cell[2]]
            a=np.clip((raw[:,:,3]-.02)/.90,0,1) if kind=='cap' else opaque_alpha(raw[:,:,3])
            ys,xs=np.where(a>.08)
            x0=max(0,int(xs.min())-3); x1=min(raw.shape[1],int(xs.max())+4)
            y0=max(0,int(ys.min())-3); y1=min(raw.shape[0],int(ys.max())+4)
            raw=raw[y0:y1,x0:x1]; a=a[y0:y1,x0:x1]
            H,W=a.shape; yy,xx=np.mgrid[:H,:W].astype(np.float32)
            # Round 3 uses a new rounded plush tuft, with a naturally fuzzy
            # terminal contour. The pointed open-card tail blend is removed.
            valid=a>.5; dist=distance_transform_edt(valid).astype(np.float32)
            # Original grey value drawing survives. The atlases were generated
            # with omnidirectional diffuse illumination. Remove only the measured
            # broad left/right slope; keep darker roots and lighter terminal barbs.
            lum=raw[:,:,:3].mean(axis=2)
            # Generated semitransparent fringe pixels can carry a pale matte.
            # Continue the nearest strong fibre colour through that thin fringe.
            core=distance_transform_edt(valid)>4
            if core.any():
                near_core=distance_transform_edt(~core,return_distances=False,return_indices=True)
                edge_mix=np.clip(1-dist/4,0,1)*.8
                lum=lum*(1-edge_mix)+lum[near_core[0],near_core[1]]*edge_mix
            nearest=distance_transform_edt(~valid,return_distances=False,return_indices=True)
            lum[~valid]=lum[nearest[0],nearest[1]][~valid]
            root_y=int(np.where(valid.any(axis=1))[0][0]); tip_y=int(np.where(valid.any(axis=1))[0][-1])
            mass=np.maximum(a.sum(1),.001)
            path=(xx*a).sum(1)/mass
            # Vane centre is stable even where the fine shaft disappears in down.
            good=np.where(mass>2)[0]
            path=np.interp(np.arange(H),good,path[good]).astype(np.float32)
            path=gaussian_filter1d(path,8)
            v=np.clip((yy-root_y)/max(tip_y-root_y,1),0,1)
            cross=(xx-path[:,None])/max(W*.5,1)
            slope=np.sum((lum[valid]-lum[valid].mean())*cross[valid])/max(np.sum(cross[valid]**2),.001)
            lum-=slope*cross
            raw_linear=linear(np.clip(lum,0,1))
            # Normalize exposure while retaining generated pigment and microstructure.
            base=np.clip(raw_linear*(.50/raw_linear[valid].mean()),.10,.94)
            if kind=='cap':base+=.12*(v-.5)
            base+=.5-base[valid].mean()
            pigment=base-.5
            broad=gaussian_filter(lum,13)
            locks=np.clip((gaussian_filter(lum,1.2)-broad)*3.2,-.22,.22)
            strands=np.clip((lum-gaussian_filter(lum,1.8))*2.1,-.11,.11)
            edge=np.clip(dist/(W*.10),0,1)
            camber=np.sin(edge*np.pi/2)
            lift=np.sin(np.clip(v*.88,0,1)*np.pi)*.17
            # ~1 mm soft tuft camber plus strand bundles and fine barb relief.
            # No flat raised leaf plate: the relief tapers into the fine alpha fringe.
            shaft=np.exp(-((xx-path[:,None])/(.65+.8*(1-v)))**2)*a*np.clip((.94-v)*12,0,1)
            h=.22+.17*camber+lift+.17*locks+.08*strands+.022*shaft
            h=np.clip(h,.08,.82)
            rough=np.clip(.91-.025*shaft+.035*np.abs(strands),.86,.96)
            prefix={'cap':'cap_round_r3','mane':'mane_full_r2','mane_card':'mane_r2','cap_card':'cap_r2'}[kind]
            ident=f'{prefix}_{i+1:02d}'
            rgb=np.repeat(srgb(np.clip(base,0,1))[:,:,None],3,axis=2)
            rgb[~valid]=rgb[nearest[0],nearest[1]][~valid]
            save(SRC/f'{ident}_cutout.png',np.dstack([rgb,a]),srgb=True)
            save(SRC/f'{ident}_height.png',h,16)
            save(SRC/f'{ident}_shaft.png',shaft)
            save(SRC/f'{ident}_alpha.png',a)
            np.savez_compressed(SRC/f'{ident}_layers.npz',alpha=a,height=h.astype(np.float32),
                                pigment=pigment.astype(np.float32),roughness=rough.astype(np.float32),shaft=shaft)
            root=[float(path[root_y+2]),float(root_y)]
            ty=max(root_y,int(tip_y)-2); supported=np.where(a[ty]>.2)[0]
            tx=float(supported.mean()) if len(supported) else float(path[ty])
            item=dict(id=ident,kind=kind,original=source_name,selected=True,size_px=[W,H],root_px=root,tip_px=[tx,float(tip_y)],
                      source_box_px=[cell[0]+x0,cell[1]+y0,cell[0]+x1,cell[1]+y1],
                      cutout=f'source/{ident}_cutout.png',height=f'source/{ident}_height.png',
                      shaft=f'source/{ident}_shaft.png',alpha=f'source/{ident}_alpha.png',
                      layers=f'source/{ident}_layers.npz',height_encoding='normalized to destination set height_mm')
            if kind=='cap':item['shape_revision']='round 3: rounded tuft atlas; broad soft pale tips; no open-card tail blend'
            manifest.append(item)
            feathers.append(dict(**item,fields=np.stack([a,h,pigment,rough,shaft]).astype(np.float32)))
    (SRC/'feathers.json').write_text(json.dumps(manifest,indent=2)+'\n')
    return feathers


def samples_for_set(name, scale, direction):
    rng=np.random.default_rng(SEED+{'cap':0,'mane':1,'cap_to_mane':2}[name])
    # Rejection-sampled variable-density point process: there are no feather rows.
    out=[]
    count={'cap':3600,'mane':350,'cap_to_mane':6000}[name]
    for i in range(count):
        x=float(rng.uniform(0,N)); y=float(rng.uniform(0,N))
        if name=='cap':
            length=float(rng.uniform(8,12) if rng.random()<.62 else rng.uniform(15,20))
            use_mane=False
        elif name=='mane':
            length=float(rng.uniform(40,70)); use_mane=True
        else:
            t=np.clip(y/N,0,1); smooth=t*t*(3-2*t)
            length=float((9+47*smooth)*rng.uniform(.80,1.21))
            # Density follows feather area so the texture does not clot at bottom.
            if rng.random()>min(1,(11/length)**1.62): continue
            use_mane=bool(rng.random()<np.clip((length-20)/24,0,1))
        sid=int(rng.integers(12,20) if use_mane else rng.integers(0,12))
        aspect=float(rng.uniform(.30,.40) if use_mane else rng.uniform(.43,.62))
        # Forward-biased, irregular overlap; no symmetric herringbone.
        angle=float(rng.normal(0,10 if use_mane else 16)+direction)
        out.append(dict(id=i,source=sid,x=x,y=y,length_mm=length*scale,
                        width_mm=length*aspect*scale,angle_deg=angle,mirror=bool(rng.integers(2)),
                        tone=float(rng.normal(0,.018)),lift=float(rng.uniform(-.045,.045))))
    return out


def stamp(canvas, f, p, cx, cy, span):
    fields=f['fields']; H,W=fields.shape[1:]
    L=p['length_mm']/1000*N/span; w=p['width_mm']/1000*N/span
    theta=np.deg2rad(p['angle_deg']); co=np.cos(theta); si=np.sin(theta)
    bw=abs(co)*w+abs(si)*L; bh=abs(co)*L+abs(si)*w
    sh,sw=canvas.shape[1:]
    x0=max(0,int(cx-bw*.5-2)); x1=min(sw,int(cx+bw*.5+3))
    y0=max(0,int(cy-bh*.5-2)); y1=min(sh,int(cy+bh*.5+3))
    if x1<=x0 or y1<=y0:return
    yy,xx=np.mgrid[y0:y1,x0:x1].astype(np.float64)
    dx=xx+.5-cx; dy=yy+.5-cy
    u=(co*dx+si*dy)/w+.5; v=(-si*dx+co*dy)/L+.5
    if p['mirror']:u=1-u
    coords=np.stack([v*H-.5,u*W-.5]).astype(np.float32)
    vals=np.stack([map_coordinates(field,coords,order=1,mode='constant',cval=0,prefilter=False) for field in fields])
    a=vals[0]
    dest=canvas[:,y0:y1,x0:x1]
    vals[1]+=p.get('lift',0)
    vals[2]+=p.get('tone',0)
    dest[1:]=dest[1:]*(1-a[None])+vals[1:]*a[None]
    dest[0]=dest[0]*(1-a)+a


def canvas_new(size, cutout=False):
    a=np.zeros((5,size,size),np.float32)
    a[1]=0 if cutout else .21
    a[3]=.91
    return a


def material_tile(name,feathers,scale,direction):
    points=samples_for_set(name,scale,direction)
    pad=32  # Neighbourhood audit band; stamps clip independently at canvas edges.
    s=N+pad*2; canvas=canvas_new(s)
    copies=[]
    # All translated elements retain the exact same data; compositing order is
    # sorted in unwrapped coordinates, so boundary neighbourhoods agree.
    for p in points:
        for dx in (-N,0,N):
            for dy in ((0,) if name=='cap_to_mane' else (-N,0,N)):
                xx=p['x']+dx; yy=p['y']+dy
                if -pad-300<xx<N+pad+300 and -pad-500<yy<N+pad+500:
                    copies.append((yy,xx,p))
    if name=='cap_to_mane':
        # Extrapolate the cap above and the mane below; never wrap the gradient.
        for edge,kind in [(-1,'cap'),(1,'mane')]:
            for p in samples_for_set(kind,scale,direction):
                yy=p['y']-N if edge==-1 else p['y']+N
                if -pad-500<yy<N+pad+500:
                    for dx in (-N,0,N):copies.append((yy,p['x']+dx,p))
    # Layer roots along the requested flow, including horizontal/reversed reuse.
    co=np.cos(np.deg2rad(direction)); si=np.sin(np.deg2rad(direction))
    copies.sort(key=lambda t:(-t[0]*co+t[1]*si,t[1]*co+t[0]*si))
    for index,(yy,xx,p) in enumerate(copies):
        stamp(canvas,feathers[p['source']],p,xx+pad,yy+pad,.284)
        if index and index%3000==0:print(name,'placements',index,'/',len(copies),flush=True)
    periodic={}
    for label0,k in [('height',1),('pigment',2),('roughness',3)]:
        a=canvas[k]
        periodic[label0]={'x':float(np.max(np.abs(a[pad:pad+N,pad-8:pad+8]-a[pad:pad+N,pad+N-8:pad+N+8])))}
        if name!='cap_to_mane':periodic[label0]['y']=float(np.max(np.abs(a[pad-8:pad+8,pad:pad+N]-a[pad+N-8:pad+N+8,pad:pad+N])) )
    (ROOT/f'{name}_layout.json').write_text(json.dumps(points,indent=2)+'\n')
    tile=canvas[:,pad:pad+N,pad:pad+N].copy()
    original=tile.copy()
    # Fine overlapping underfeathers, visible only through sparse spaces in the
    # primary canopy. Translate the same complete material, keeping root-to-tip
    # structure; this prevents blank, smooth backing islands.
    for dx,dy in [(773,491),(1297,997)]:
        if name=='cap_to_mane':dy=0
        donor=np.roll(original,(dy,dx),axis=(1,2))
        gap=1-tile[0]
        tile[1]+=gap*(donor[1]-.21-.035*donor[0])
        tile[2]+=gap*donor[2]
        tile[3]+=gap*(donor[3]-.91)
        tile[4]+=gap*donor[4]
        tile[0]+=gap*donor[0]
    return tile,periodic,len(points)


def point_transform(pt, f, p, span):
    W,H=f['size_px']; L=p['length_mm']/1000*N/span; w=p['width_mm']/1000*N/span
    u=pt[0]/W-.5; v=pt[1]/H-.5
    if p['mirror']:u=-u
    co=np.cos(np.deg2rad(p['angle_deg'])); si=np.sin(np.deg2rad(p['angle_deg']))
    return [round(p['x']+co*u*w-si*v*L,2),round(p['y']+si*u*w+co*v*L,2)]


def cards(feathers,scale,direction):
    canvas=canvas_new(N,True); rng=np.random.default_rng(SEED+77)
    elements=[]; placements=[]
    # Ten little tufts across two rows, then eight long elements in two rows.
    for i in range(18):
        if i<10:
            row,col=divmod(i,5); cx=205+col*410; cy=190+row*350
            count=[2,3,4,5,3,4,2,5,3,4][i]
            name='forehead_point' if i in (3,7) else 'edge_tuft'
        else:
            row,col=divmod(i-10,4); cx=256+col*512; cy=1110+row*560
            count=1; name='mane_feather'
        before=canvas[0].copy(); parts=[]
        for j in range(count):
            sid=(i-10)+20 if i>=10 else 28+(i*5+j)%12
            L=float(rng.uniform(14,20)) if i<10 else float(40+(i-10)*30/7)
            spread=(j-(count-1)/2)
            if name=='forehead_point':L=20.-.85*abs(spread)+float(rng.uniform(-.35,.35))
            w=L*(float(rng.uniform(.58,.78)) if i<10 else float(rng.uniform(.30,.38)))
            ang=-spread*13+float(rng.uniform(-6,6))+direction if i<10 else float(rng.uniform(-5,5))+direction
            p=dict(source=sid,x=cx+spread*30*scale,y=cy+abs(spread)*(-9)*scale,
                   length_mm=L*scale,width_mm=w*scale,angle_deg=ang,mirror=bool(i%2),tone=0.,lift=0.)
            parts.append(p); stamp(canvas,feathers[sid],p,p['x'],p['y'],.341)
        changed=(canvas[0]>.02)&(before<=.02)
        ys,xs=np.where(changed)
        box=[max(0,int(xs.min())-2),max(0,int(ys.min())-2),min(N,int(xs.max())+3),min(N,int(ys.max())+3)]
        center=min(parts,key=lambda p:abs(p['x']-cx)); f=feathers[center['source']]
        root=point_transform(f['root_px'],f,center,.341)
        tips=[point_transform(feathers[p['source']]['tip_px'],feathers[p['source']],p,.341) for p in parts]
        tip=max(tips,key=lambda p:p[1])
        elements.append(dict(id=f'{name}_{i+1:02d}',kind=name,box_px=box,root_px=root,tip_px=tip,
                             feather_count=count,feathers=[feathers[p['source']]['id'] for p in parts],placements=parts))
        placements+=parts
    (ROOT/'hood_cards_layout.json').write_text(json.dumps(placements,indent=2)+'\n')
    return canvas,elements


def occlusion(h,span,height_mm,tiles):
    out=np.zeros_like(h); factor=height_mm/1000*N/span
    padded=np.pad(h,32,mode='edge')
    for dx,dy in [(1,0),(-1,0),(0,1),(0,-1),(1,1),(-1,1),(1,-1),(-1,-1)]:
        horizon=np.zeros_like(h)
        for rad in [1,2,4,8,16,24]:
            sampled=np.roll(h,(dy*rad,dx*rad),axis=(0,1))
            # Correct nonperiodic axes with edge-clamped samples.
            if not all(tiles):
                yy=np.arange(N)-dy*rad; xx=np.arange(N)-dx*rad
                yy=yy%N if tiles[1] else np.clip(yy,0,N-1)
                xx=xx%N if tiles[0] else np.clip(xx,0,N-1)
                sampled=h[np.ix_(yy,xx)]
            slope=np.maximum(sampled-h-.001,0)*factor/(rad*np.hypot(dx,dy))
            horizon=np.maximum(horizon,np.arctan(slope))
        out+=np.sin(horizon)/8
    return np.clip(1-.60*out,.73,1)


def deliver(name,canvas,span,height_mm,tiles,cutout):
    a,h,p,rough,shaft=canvas
    mode=('wrap' if tiles[1] else 'nearest','wrap' if tiles[0] else 'nearest')
    h=gaussian_filter(h,1.6,mode=mode)
    # Fine barbs sit on the soft tuft volume: micrometre-scale relief, not grooves.
    h+=(gaussian_filter(p,.6,mode=mode)-gaussian_filter(p,2.2,mode=mode))*.025
    h16=save(ROOT/f'{name}_height.png',h,16)
    h=h16.astype(np.float32)/65535
    n=normal(h,span,height_mm,tiles)
    valid=a>=.5 if cutout else np.ones_like(a,dtype=bool)
    base=.5+p
    # Correct only a weak residual directional component. Rich anatomical value
    # remains: record variance retention, and never flatten each feather's drawing.
    before_variance=float(base[valid].var())
    sub=np.s_[::3,::3]; select=valid[sub]
    X=n[sub][select].astype(np.float64); X-=X.mean(axis=0)
    y=base[sub][select].astype(np.float64); y-=y.mean()
    coef=np.linalg.lstsq(X,y,rcond=None)[0]
    base-=np.sum((n-n[valid].mean(axis=0))*coef,axis=-1)
    # A small smooth exposure correction balances unequal specimen populations.
    # It has no seam or feather-sized influence; intrinsic tip drawing is retained.
    yy,xx=np.mgrid[:N,:N].astype(np.float32)
    fy=np.sin(2*np.pi*(yy+.5)/N); fx=np.sin(2*np.pi*(xx+.5)/N)
    basis=[fx,fy,fx*fy]
    B=np.stack([q[sub][select] for q in basis],axis=1).astype(np.float64)
    B-=B.mean(axis=0)
    weights=np.linalg.lstsq(B,(base[sub][select]-base[sub][select].mean()),rcond=None)[0]
    for w,q in zip(weights,basis):base-=float(w)*(q-q[valid].mean())
    if cutout:
        # Atlas quarters contain different numbers and kinds of opaque feathers.
        # Balance the visible populations, not the large transparent background.
        means=[]; design=[]
        for sy,sx in [(0,0),(0,1),(1,0),(1,1)]:
            sl=np.s_[sy*N//2:(sy+1)*N//2,sx*N//2:(sx+1)*N//2]
            mask=valid[sl]
            means.append(float(base[sl][mask].mean()))
            design.append([1.]+[float(q[sl][mask].mean()) for q in basis])
        extra=np.linalg.solve(np.array(design),np.array(means)-.5)
        base-=extra[0]
        for w,q in zip(extra[1:],basis):base-=float(w)*q
        weights+=extra[1:]
    base+=.5-base[valid].mean()
    base=np.clip(base,.075,.94)
    base+=.5-base[valid].mean()
    variance_retained=float(base[valid].var()/max(before_variance,1e-12))
    colour=np.repeat(srgb(base)[:,:,None],3,axis=-1)
    if cutout:
        nearest=distance_transform_edt(~valid,return_distances=False,return_indices=True)
        colour[~valid]=colour[nearest[0],nearest[1]][~valid]
        colour=np.dstack([colour,a])
    b8=save(ROOT/f'{name}_base.png',colour,srgb=True)
    save(ROOT/f'{name}_normal.png',n*.5+.5)
    ao=occlusion(h,span,height_mm,tiles)
    packed=np.stack([ao,rough,np.zeros_like(h)],axis=-1)
    save(ROOT/f'{name}_packed.png',packed)
    regions=np.zeros((N,N,3),np.uint8); regions[:]=[255,0,255]
    # Transparent atlas padding carries magenta too: colour filters cannot turn
    # a surviving fringe black. No other dyed surface is present in this study.
    Image.fromarray(regions).save(ROOT/f'{name}_regions.png')
    return dict(span_m=span,tiles=all(tiles),tile_axes=dict(x=tiles[0],y=tiles[1]),cutout=cutout,
                height_mm=height_mm,regions=[4],size_px=[N,N],
                mean_linear=float(linear(b8[:,:,:3]/255)[valid].mean()),
                roughness_mean=float(rough[valid].mean()),
                intrinsic_value_std=float(base[valid].std()),value_variance_retained=variance_retained,
                removed_directional_coefficients=coef.tolist(),broad_exposure_coefficients=weights.tolist(),
                normal_convention='OpenGL +Y; Ny = +dH/d(pixel-down)',
                alpha_cutoff=.5 if cutout else None,
                files={layer:f'{name}_{layer}.png' for layer in ['base','height','normal','packed','regions']})


def build(scale=1.,direction=0.,selected=None):
    start=time.time(); feathers=make_sources()
    # A full build never reads an existing manifest or any derived source layers.
    previous=json.loads((ROOT/'study.json').read_text()) if selected and (ROOT/'study.json').exists() else {}
    sets=previous.get('sets',{}).copy(); periodic=previous.get('periodic_neighbourhood_max_difference',{}).copy()
    selected=set(selected or ['cap','mane','cap_to_mane','hood_cards'])
    for name,height_mm in [('cap',3.2),('mane',4.2),('cap_to_mane',3.8)]:
        if name not in selected:continue
        print('Building',name,flush=True)
        canvas,periodic[name],count=material_tile(name,feathers,scale,direction)
        sets[name]=deliver(name,canvas,.284,height_mm,[True,name!='cap_to_mane'],False)
        sets[name]['feather_instances']=count
    if 'hood_cards' in selected:
        print('Building hood_cards',flush=True)
        canvas,elements=cards(feathers,scale,direction)
        sets['hood_cards']=deliver('hood_cards',canvas,.341,4.2,[False,False],True)
        sets['hood_cards']['elements']=elements
    study=dict(schema_version=2,round=3,study='hood',seed=SEED,region=4,default_dye='#413225',
               generated_with='built-in image_gen; four accepted source atlases; all prepared layers rebuilt from originals',
               source_atlas_native_sizes_px={name:list(Image.open(SRC/name).size) for name in SOURCE_ATLASES.values()},source_manifest='source/feathers.json',
               units='metres for span; millimetres for full black-to-white height; pixels for landmarks',
               coordinate_system='origin upper left; +x right; +y down; boxes [left,top,right,bottom), root to tip',
               build_parameters=dict(scale=scale,direction_degrees=direction),rebuilt_sets=sorted(selected),accepted_hashes='accepted_hashes.json',sets=sets,
               integration='All visible feathers are region 4. On the bird, add a natural dark undyed contact crease at least 4 px wide at 2048 between hood magenta and face green/brow cyan. Never bake a pale separator into these cards.',
               source_sha256={name:hashlib.sha256((SRC/name).read_bytes()).hexdigest() for name in SOURCE_ATLASES.values()},
               periodic_neighbourhood_max_difference=periodic,build_seconds=round(time.time()-start,2))
    (ROOT/'study.json').write_text(json.dumps(study,indent=2)+'\n')
    print(json.dumps(dict(seconds=study['build_seconds'],sets={k:v['mean_linear'] for k,v in sets.items()})),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--scale',type=float,default=1.); parser.add_argument('--direction',type=float,default=0.)
    parser.add_argument('--sets',nargs='+',choices=['cap','mane','cap_to_mane','hood_cards'])
    args=parser.parse_args(); build(args.scale,args.direction,args.sets)
