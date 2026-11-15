"""Build aligned feather studies from the untouched generated atlas.

Python 3 + Pillow, NumPy, SciPy. All writes stay beside this script.
Examples: python3 build.py; python3 build.py --feather-scale .75 --direction down
Default physical sizes are documented in study.json. No network calls.
"""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
import argparse, json, time, hashlib, shutil
import numpy as np
from PIL import Image, PngImagePlugin
from scipy.ndimage import (gaussian_filter, gaussian_filter1d, distance_transform_edt,
                           map_coordinates, binary_erosion, label)

ROOT = Path(__file__).resolve().parent
SRC = ROOT/'source'
N = 2048
SEED = 14327
HEIGHT_MM = 4.0
EDGE_RANGE_MM = 64.0

def srgb_to_linear(a):
    a=np.asarray(a,dtype=np.float32)
    return np.where(a <= .04045,a/12.92,((a+.055)/1.055)**2.4)

def linear_to_srgb(a):
    a=np.maximum(a,0)
    return np.where(a<=.0031308,a*12.92,1.055*a**(1/2.4)-.055)

def save(path, a, srgb=False, bits=8):
    path=Path(path)
    info=PngImagePlugin.PngInfo()
    if srgb: info.add(b'sRGB',b'\x00')
    info.add(b'gAMA',(45455 if srgb else 100000).to_bytes(4,'big'))
    info.add_text('Description','Dodo body study. sRGB albedo.' if srgb else 'Dodo body study. Linear data, no sRGB decoding.')
    z=np.uint16(np.clip(np.round(a*65535),0,65535)) if bits==16 else np.uint8(np.clip(np.round(a*255),0,255))
    Image.fromarray(z).save(path,pnginfo=info)
    return z

def bleed(a, valid):
    """Nearest covered texel, retaining every real fringe texel's RGB."""
    idx=distance_transform_edt(~valid,return_distances=False,return_indices=True)
    return np.where(valid,a,a[tuple(idx)])

def normals(h,span_m,wrap):
    step=span_m/h.shape[0]*1000
    if wrap:
        dx=(np.roll(h,-1,1)-np.roll(h,1,1))*HEIGHT_MM/(2*step)
        dy=(np.roll(h,-1,0)-np.roll(h,1,0))*HEIGHT_MM/(2*step)
    else:
        dy,dx=np.gradient(h*HEIGHT_MM,step)
    n=np.stack((-dx,dy,np.ones_like(h)),axis=-1)
    return n/np.linalg.norm(n,axis=-1,keepdims=True)

def occlusion(h,span_m,wrap):
    """Eight azimuth height horizons, no privileged lighting direction."""
    px=span_m*1000/h.shape[0]
    h=h*HEIGHT_MM
    out=np.zeros_like(h)
    for dx,dy in [(1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)]:
        horizon=np.zeros_like(h)
        for r in [1,2,4,8,16,32]:
            other=np.roll(h,(dy*r,dx*r),(0,1))
            if not wrap:
                if dy>0: other[:dy*r]=h[:dy*r]
                if dy<0: other[dy*r:]=h[dy*r:]
                if dx>0: other[:,:dx*r]=h[:,:dx*r]
                if dx<0: other[:,dx*r:]=h[:,dx*r:]
            slope=np.maximum(other-h-.015,0)/(r*px*np.hypot(dx,dy))
            horizon=np.maximum(horizon,slope/np.sqrt(1+slope*slope))
        out+=horizon/8
    return np.clip(1-1.15*out,.56,1)

def source_elements():
    atlas=np.asarray(Image.open(SRC/'generated_atlas_round2.png').convert('RGBA'),dtype=np.float32)/255
    ah,aw=atlas.shape[:2]
    elements=[]; records=[]
    for i in range(16):
        r,c=divmod(i,4)
        bounds=[round(c*aw/4),round(r*ah/4),round((c+1)*aw/4),round((r+1)*ah/4)]
        raw=atlas[bounds[1]:bounds[3],bounds[0]:bounds[2]]
        # The original source alpha is retained; do not use RGB as a mask.
        alpha=raw[:,:,3].copy()
        mask=alpha>=.5
        hh,ww=alpha.shape
        yy,xx=np.mgrid[:hh,:ww].astype(np.float32)
        ys,xs=np.where(mask)
        y0,y1=int(ys.min()),int(ys.max()); x0,x1=int(xs.min()),int(xs.max())
        v=np.clip((yy-y0)/max(y1-y0,1),0,1)
        lum=np.sum(srgb_to_linear(raw[:,:,:3])*np.array([.2126,.7152,.0722],np.float32),axis=-1)
        # Extend covered luminance through alpha before removing broad form illumination.
        ext=bleed(lum,alpha>.50)
        broad=gaussian_filter(ext,55)
        detail=np.clip(ext-broad,-.18,.18)
        fine=ext-gaussian_filter(ext,2.2)
        # Detect the curved bright rachis, with the generated central ridge.
        ridge=gaussian_filter(ext,(3,.65))-gaussian_filter(ext,(3,7))
        path=np.zeros(hh,np.float32)
        root_y=y0+3
        root_x=float(np.median(np.flatnonzero(mask[root_y])))
        prev=root_x
        for y in range(hh):
            if y<root_y:
                path[y]=root_x
                continue
            lo=max(int(ww*.29),int(prev-13)); hi=min(int(ww*.71),int(prev+14))
            path[y]=lo+np.argmax(ridge[y,lo:hi]); prev=path[y]
        path=gaussian_filter1d(path,3.2)
        shaft=np.exp(-((xx-path[:,None])/1.2)**2)*np.clip((.89-v)/.18,0,1)*np.clip(v/.08,0,1)
        shaft*=alpha
        # Larger full vanes allow exposed ends around 40 to 45 mm after overlap.
        rng=np.random.default_rng(SEED+i)
        length_mm=float(rng.uniform(55,63))
        width_mm=float(rng.uniform(48,56))
        dx_mm=width_mm/(x1-x0+1); dy_mm=length_mm/(y1-y0+1)
        dist=distance_transform_edt(mask,sampling=(dy_mm,dx_mm)).astype(np.float32)
        # Distal perimeter: bottom-most opaque barb in each occupied column.
        # This is a contour, not a horizontal threshold through the feather.
        free=np.zeros_like(mask)
        for x in range(ww):
            y=np.flatnonzero(mask[:,x])
            if len(y) and y[-1]>y0+.76*(y1-y0): free[y[-1],x]=True
        edge=distance_transform_edt(~free,sampling=(dy_mm,dx_mm)).astype(np.float32)
        # Broad lift and cupping are geometric. Fine barbs follow the source.
        dome=np.sin(np.clip(dist/18,0,1)*np.pi/2)
        h_mm=.30+1.90*v+.65*dome+.065*shaft+fine*.65
        h_mm=bleed(h_mm,alpha>=.5)
        # Intrinsic value only. No AO/height shading enters this field.
        pigment=.50+detail*2.6+.045*shaft+.16*(v-.55)
        pigment+=.040*np.exp(-edge/1.15)
        pigment=np.clip(pigment,.16,.84)
        # Crescent tapers out before the feather shoulder. Its lower boundary
        # remains the true ragged alpha contour, including separate barb tips.
        lateral=np.abs((xx-(x0+x1)/2)/((x1-x0)*.5))
        taper=np.clip((.82-lateral)/.25,0,1)
        taper*=np.clip((v-.77)/.12,0,1)
        pigment=bleed(pigment,alpha>.03)
        rough=np.clip(.885-.052*shaft+.045*np.abs(detail)+.025*(1-dome),.79,.95)
        ident=f'feather_{i+1:02d}'
        save(SRC/(ident+'_original.png'),raw,srgb=True)
        cut=np.dstack((np.repeat(linear_to_srgb(pigment)[:,:,None],3,axis=2),alpha))
        save(SRC/(ident+'_cutout.png'),cut,srgb=True)
        save(SRC/(ident+'_height.png'),h_mm/HEIGHT_MM,bits=16)
        save(SRC/(ident+'_shaft.png'),shaft,bits=16)
        save(SRC/(ident+'_free_edge_distance.png'),edge/EDGE_RANGE_MM,bits=16)
        save(SRC/(ident+'_free_edge.png'),free.astype(float))
        np.savez_compressed(SRC/(ident+'_layers.npz'),alpha=alpha,height_mm=h_mm,pigment_linear=pigment,
                            shaft=shaft,free_edge_distance_mm=edge,bar_distance_mm=edge+.55*np.tanh(fine*70),bar_taper=taper,roughness=rough)
        # Coordinates for reusable placing: the full source cell, plus occupied bounds.
        rec=dict(id=ident,atlas_box=bounds,box_px=[x0,y0,x1+1,y1+1],root_px=[root_x,root_y],
                 tip_px=[int(xs[ys.argmax()]),y1],length_mm=length_mm,width_mm=width_mm,
                 pixel_mm=[dx_mm,dy_mm],height_mm=HEIGHT_MM,free_edge_distance_range_mm=EDGE_RANGE_MM,
                 files={k:ident+'_'+k+'.png' for k in ['original','cutout','height','shaft','free_edge_distance','free_edge']},
                 layers=ident+'_layers.npz')
        records.append(rec)
        elements.append(dict(alpha=alpha,height=h_mm/HEIGHT_MM,pigment=pigment,rough=rough,shaft=shaft,
                             edge=edge+.55*np.tanh(fine*70),taper=taper,meta=rec))
    (SRC/'elements.json').write_text(json.dumps(records,indent=2)+'\n')
    return elements

def stamp(canvas,el,cx,cy,width,height,angle,flip,bar_mm,ident,shade=0):
    """All aligned layers use precisely the same inverse transform."""
    H,W=canvas['height'].shape
    sh,sw=el['alpha'].shape
    co,si=np.cos(angle),np.sin(angle)
    bw=abs(co)*width+abs(si)*height; bh=abs(si)*width+abs(co)*height
    x0=max(0,int(cx-bw/2-2)); x1=min(W,int(cx+bw/2+3))
    y0=max(0,int(cy-bh/2-2)); y1=min(H,int(cy+bh/2+3))
    if x1<=x0 or y1<=y0: return
    yy,xx=np.mgrid[y0:y1,x0:x1].astype(np.float64)
    u=(co*(xx+.5-cx)+si*(yy+.5-cy))/width+.5
    v=(-si*(xx+.5-cx)+co*(yy+.5-cy))/height+.5
    if flip: u=1-u
    coords=np.stack((v*sh-.5,u*sw-.5))
    a=map_coordinates(el['alpha'],coords,order=1,mode='constant',cval=0,prefilter=False)
    sl=np.s_[y0:y1,x0:x1]
    for key in ['height','pigment','rough']:
        z=map_coordinates(el[key],coords,order=1,mode='nearest',prefilter=False)
        if key=='pigment': z=z+shade
        canvas[key][sl]=canvas[key][sl]*(1-a)+z*a
    canvas['alpha'][sl]=1-(1-canvas['alpha'][sl])*(1-a)
    edge=map_coordinates(el['edge'],coords,order=1,mode='nearest',prefilter=False)
    take=a>=.5
    taper=map_coordinates(el['taper'],coords,order=1,mode='nearest',prefilter=False)
    canvas['bar'][sl][take]=(edge[take]<=bar_mm*taper[take])&(taper[take]>.01)
    canvas['owner'][sl][take]=ident
    canvas['free'][sl][take]=(edge[take]<=1.0)

def canvas(size,opaque=False):
    return dict(height=np.full((size,size),.10,np.float32),pigment=np.full((size,size),.5,np.float32),
                rough=np.full((size,size),.92,np.float32),alpha=np.zeros((size,size),np.float32),
                bar=np.zeros((size,size),bool),free=np.zeros((size,size),bool),owner=np.full((size,size),-1,np.int16))

def same_regions_mean(pigment,bar,valid):
    """Equal linear mean in each dyed region while retaining its value drawing."""
    p=pigment.copy()
    for m in [valid&~bar,valid&bar]:
        if m.any(): p[m]+=.5-p[m].mean()
    return np.clip(p,.1,.85)

def remove_directional_component(p,n,bar,valid):
    """Remove only the fitted 3-component diffuse-light signal, never blur value.
    Centre normals independently per dye region so the correction cannot alter
    region means. Fine barb drawing and intrinsic variance remain in the base.
    """
    normal=n.astype(np.float32).copy()
    for region in [valid&~bar,valid&bar]:
        if region.any(): normal[region]-=normal[region].mean(axis=0)
    X=normal[valid][::4].astype(np.float64)
    y=p[valid][::4].astype(np.float64)
    coeff=np.linalg.lstsq(X,y-y.mean(),rcond=None)[0]
    correction=np.sum(normal*coeff,axis=-1)
    out=p.copy();out[valid]-=correction[valid]
    return np.clip(out,.12,.88),dict(coefficients=coeff.tolist(),rms_linear=float(np.std(correction[valid])))

def export_set(name,c,span,tiles,cutout,direction,normalise=True):
    k=dict(down=0,right=1,up=2,left=3)[direction]
    c={key:np.rot90(v,k).copy() for key,v in c.items()}
    a=c['alpha']; valid=(a>=.5) if cutout else np.ones_like(a,bool)
    p=same_regions_mean(c['pigment'],c['bar'],valid) if normalise else c['pigment']
    if cutout:
        # Keep cutout colour valid on both sides of the alpha-test boundary.
        p=bleed(p,a>=.5)
        # Extend six pixels beyond the alpha test edge, then settle
        # smoothly to a constant plane. Never fan nearest heights across gutters.
        distance=distance_transform_edt(~valid)
        fade=np.clip((12-distance)/6,0,1)
        fade=fade*fade*(3-2*fade)
        c['height']=.10+(bleed(c['height'],valid)-.10)*fade
        c['rough']=.92+(bleed(c['rough'],valid)-.92)*fade
    h=gaussian_filter(c['height'],1.6,mode='wrap' if tiles else 'nearest')
    if cutout: h[distance>16]=.10 # Exact common gutter plane, including the quantizer tie.
    h16=save(ROOT/(name+'_height.png'),h,bits=16)
    h=h16.astype(np.float32)/65535
    n=normals(h,span,True)
    save(ROOT/(name+'_normal.png'),n*.5+.5)
    p,delight=remove_directional_component(p,n,c['bar'],valid)
    p=same_regions_mean(p,c['bar'],valid)
    if cutout: p=bleed(p,valid)
    ao=occlusion(h,span,tiles)
    if cutout: ao[~valid]=1
    save(ROOT/(name+'_packed.png'),np.stack((ao,c['rough'],np.zeros_like(h)),axis=-1))
    base=np.repeat(linear_to_srgb(p)[:,:,None],3,axis=2)
    if cutout: base=np.dstack((base,a))
    save(ROOT/(name+'_base.png'),base,srgb=True)
    regions=np.zeros((N,N,3),np.float32); regions[:,:,0]=1; regions[:,:,1]=c['bar']
    if cutout:
        # Nearest ID bleed avoids black colour leaking into the card fringe.
        idx=distance_transform_edt(~valid,return_distances=False,return_indices=True)
        regions=regions[tuple(idx)]
    save(ROOT/(name+'_regions.png'),regions)
    return dict(directional_removal=delight,span_m=span,tiles=tiles,cutout=cutout,height_mm=HEIGHT_MM,regions=[0,5] if c['bar'].any() else [0],
                direction=direction,normal_convention='OpenGL; +green points up; central differences on delivered uint16 height',
                maps={kind:name+'_'+kind+'.png' for kind in ['base','height','normal','packed','regions']})

def build(args):
    start=time.time(); SRC.mkdir(exist_ok=True)
    els=source_elements(); print('Prepared 16 aligned source feathers.',flush=True)
    span=args.span_m; scale=args.feather_scale
    rows=max(4,int(round(span/(.0356*scale)/2))*2); cols=max(4,round(span/(.0427*scale)))
    pad=400; sz=N+2*pad
    c=canvas(sz)
    rng=np.random.default_rng(SEED)
    sources=np.full((rows,cols),-1,int); layout=[]
    # Toroidal neighbour exclusions: no neighbouring placements share a specimen.
    for r in range(rows):
        for col in range(cols):
            banned={sources[(r+dr)%rows,(col+dc)%cols] for dr in [-1,0,1] for dc in [-1,0,1]}
            sources[r,col]=rng.choice([i for i in range(16) if i not in banned])
    params={}
    # Nonuniform stations: vary each row's spacing before normalizing its period.
    # Correlated row drift, independent local splay, and occasional crowded pairs
    # break the brick lattice without losing the root-to-tip growth direction.
    row_drift=rng.uniform(-.42,.42,rows)
    for r in range(rows):
        intervals=rng.uniform(.76,1.23,cols)
        intervals[(r*3)%cols]*=.78
        stations=np.cumsum(intervals)-intervals*.5
        stations*=N/intervals.sum()
        for col in range(cols):
            e=int(sources[r,col]); meta=els[e]['meta']; bx=meta['box_px']
            fullw=meta['width_mm']*.001/((bx[2]-bx[0])/els[e]['alpha'].shape[1])
            fullh=meta['length_mm']*.001/((bx[3]-bx[1])/els[e]['alpha'].shape[0])
            x=stations[col]+(.5*(r%2)+row_drift[r])*N/cols
            wave=19*np.sin(2*np.pi*x/N*2+r*.55)+11*np.sin(2*np.pi*x/N*5+r*.71)
            y=(r+.5)*N/rows+wave+rng.uniform(-18,18)
            p=dict(source=e,cx=float(x),cy=float(y),width=fullw*scale*N/span*rng.uniform(.90,1.09),
                   height=fullh*scale*N/span*rng.uniform(.88,1.13),angle=float(rng.uniform(-11,11)*np.pi/180),
                   flip=bool(rng.integers(2)),bar_mm=float(args.bar_width_mm/scale),
                   ident=r*cols+col,shade=float(rng.uniform(-.018,.018)))
            params[r,col]=p; layout.append(dict(row=r,column=col,**p))
    # A recessed layer of real feather detail fills the natural gaps between
    # contour vanes. It is plain, below the surface, and uses offset specimens.
    for r in range(rows+4,-5,-1):
        for col in range(-4,cols+4):
            p=params[r%rows,col%cols].copy(); e=p.pop('source')
            p['cx']+=pad+(col//cols)*N+N/cols*.48
            p['cy']+=pad+(r//rows)*N+N/rows*.45
            p['bar_mm']=-1
            under={k:v for k,v in els[(e+9)%16].items()}
            under['height']=under['height']*.43
            stamp(c,under,**p)
    # Repeat actual neighbours into a padded working canvas; top row covers roots below.
    for r in range(rows+4,-5,-1):
        for col in range(-4,cols+4):
            p=params[r%rows,col%cols].copy(); e=p.pop('source')
            p['cx']+=pad+(col//cols)*N; p['cy']+=pad+(r//rows)*N
            stamp(c,els[e],**p)
    print('Composited periodic surface and recessed feathers.',flush=True)
    band=48; periodic={}
    for key,z in c.items():
        aa=z.astype(float)
        periodic[key]={'x_max':float(np.max(np.abs(aa[pad:pad+N,pad-band:pad+band]-aa[pad:pad+N,pad+N-band:pad+N+band]))),
                       'y_max':float(np.max(np.abs(aa[pad-band:pad+band,pad:pad+N]-aa[pad+N-band:pad+N+band,pad:pad+N])))}
    assert max(v for pair in periodic.values() for v in pair.values())<1e-5,periodic
    c={key:z[pad:pad+N,pad:pad+N].copy() for key,z in c.items()}
    # Place the file boundary through a representative part of the periodic field.
    # A whole-tile roll only: no edge mixing, mirroring, or seam smoothing.
    ratios=[]
    for ax in [0,1]:
        score=np.zeros(N)
        for key in ['height','pigment','bar']:
            z=c[key].astype(np.float32)
            diff=np.abs(z-np.roll(z,1,axis=ax))
            line=diff.mean(axis=1-ax)
            score=np.maximum(score,line/max(float(line.mean()),1e-8))
        candidates=np.flatnonzero(score<1.08)
        cut=int(candidates[len(candidates)//2]) if len(candidates) else int(score.argmin())
        ratios.append(cut)
    c={key:np.roll(z,(-ratios[0],-ratios[1]),(0,1)) for key,z in c.items()}
    np.savez_compressed(SRC/'tile_ownership.npz',owner=c['owner'],free_edge=c['free'])
    tip_widths=[]
    for placement in layout:
        ident=placement['ident'];ys,xs=np.where((c['owner']==ident)&c['free'])
        if len(xs)<10: continue
        cx=(placement['cx']-ratios[1])%N
        localx=(xs-cx+N/2)%N-N/2
        tip_widths.append(float(np.ptp(localx)*span*1000/N))
    raw_pigment=c['pigment'].copy()
    c['pigment']=same_regions_mean(c['pigment'],c['bar'],np.ones((N,N),bool))
    sets={}
    sets['body_barred']=export_set('body_barred',c,span,True,False,args.direction,False)
    sets['body_plain']=dict(sets['body_barred'])
    sets['body_plain']['regions']=[0]
    sets['body_plain']['maps']={k:'body_plain_'+k+'.png' for k in ['base','height','normal','packed','regions']}
    for key in ['height','normal','packed']:
        shutil.copyfile(ROOT/('body_barred_'+key+'.png'),ROOT/('body_plain_'+key+'.png'))
    k=dict(down=0,right=1,up=2,left=3)[args.direction]
    plain_pigment=np.rot90(raw_pigment+.5-raw_pigment.mean(),k)
    nh=np.asarray(Image.open(ROOT/'body_plain_height.png'),np.float32)/65535
    plain_pigment,delight=remove_directional_component(plain_pigment,normals(nh,span,True),np.zeros((N,N),bool),np.ones((N,N),bool))
    plain_pigment+=.5-plain_pigment.mean()
    sets['body_plain']['directional_removal']=delight
    save(ROOT/'body_plain_base.png',np.repeat(linear_to_srgb(plain_pigment)[:,:,None],3,axis=2),srgb=True)
    plain_region=np.zeros((N,N,3),np.float32);plain_region[:,:,0]=1
    save(ROOT/'body_plain_regions.png',plain_region)
    # Source cells are at physical scale in the card atlas, with generous gutters.
    card=canvas(N); boxes=[]
    for i,el in enumerate(els):
        r,col=divmod(i,4); meta=el['meta']; bx=meta['box_px']; sh,sw=el['alpha'].shape
        w=meta['width_mm']*.001/(bx[2]-bx[0])*sw*N/args.cards_span_m*scale
        h=meta['length_mm']*.001/(bx[3]-bx[1])*sh*N/args.cards_span_m*scale
        cx=col*512+256; cy=r*512+256
        barred=(i%3==1 or i in [9,15])
        stamp(card,el,cx,cy,w,h,0,False,args.bar_width_mm/scale if barred else -1,i)
        def point(p): return [round(cx+(p[0]+.5-sw/2)*w/sw,2),round(cy+(p[1]+.5-sh/2)*h/sh,2)]
        pos=np.argwhere(card['owner']==i)
        mn=pos.min(axis=0); mx=pos.max(axis=0)+1
        boxes.append(dict(id=meta['id'],box=[int(mn[1]),int(mn[0]),int(mx[1]),int(mx[0])],
                          cell_box=[col*512,r*512,(col+1)*512,(r+1)*512],root=point(meta['root_px']),tip=point(meta['tip_px']),
                          width_mm=meta['width_mm']*scale,length_mm=meta['length_mm']*scale,barred=barred,
                          bar_width_mm=args.bar_width_mm if barred else 0,source_layers='source/'+meta['layers']))
    sets['body_tips']=export_set('body_tips',card,args.cards_span_m,False,True,'down')
    sets['body_tips']['elements']=boxes
    sets['body_tips']['alpha_cutoff']=.5
    sets['body_tips']['transparent_rgb']='Nearest opaque-pixel neutral colour extension across all transparent texels; region IDs extended too.'
    for name in ['body_plain','body_barred']:
        sets[name].update(rows=rows,columns=cols,row_pitch_mm=span*1000/rows,bar_width_mm=args.bar_width_mm if name=='body_barred' else 0,
                          feather_length_mm=[min(e['meta']['length_mm'] for e in els)*scale,max(e['meta']['length_mm'] for e in els)*scale],
                          feather_width_mm=[min(e['meta']['width_mm'] for e in els)*scale,max(e['meta']['width_mm'] for e in els)*scale])
    data=dict(schema_version=2,round=2,study='body',resolution=N,seed=SEED,sets=sets,
              source=dict(atlas='source/generated_atlas_round2.png',prompt='source/prompt_round2.txt',elements='source/elements.json',
                          sha256=hashlib.sha256((SRC/'generated_atlas_round2.png').read_bytes()).hexdigest()),
              build=dict(seconds=round(time.time()-start,2),parameters=vars(args),crop_roll_yx=[-x for x in ratios],periodic_neighbourhoods=periodic,
                         coverage_min=float(c['alpha'].min()),coverage_below_half=float((c['alpha']<.5).mean()),
                         neighbour_source_reuse=0,visible_end_width_mm_percentiles=np.percentile(tip_widths,[10,50,90]).tolist()),
              placement_notes=['Top is root, tips down. Use feather-scale < 1 for neck. Direction rotates entire periodic field by quarter turns.',
                               'Barred tile is a reusable all-row source. Paint only five consecutive rows along the bird back direction field; chevron flow and flank fade belong to later bird UV placement.',
                               'Continuous source free-edge distance is Euclidean millimetres to the actual distal alpha=0.5 barb contour, not distance from a horizontal line.',
                               'Sources retain original alpha. Tiles composite overlap; card atlas uses alpha test 0.5.'])
    (ROOT/'study.json').write_text(json.dumps(data,indent=2)+'\n')
    (SRC/'layout.json').write_text(json.dumps(dict(rows=rows,cols=cols,placements=layout,crop_roll_yx=[-x for x in ratios]),indent=2)+'\n')
    print(json.dumps(data['build'],indent=2),flush=True)


def rebuild(root):
    global ROOT,SRC
    ROOT=root/'checks/plain_rebuild';ROOT.mkdir(parents=True,exist_ok=True)
    SRC=ROOT/'source';SRC.mkdir(exist_ok=True)
    shutil.copyfile(root/'source/generated_atlas_round2.png',SRC/'generated_atlas_round2.png')
    args=argparse.Namespace(feather_scale=1.,span_m=.427,cards_span_m=.341,bar_width_mm=4.7,direction='down')
    build(args)
    return ROOT
