"""Rebuild the trousers study using Python/Pillow/NumPy/SciPy.

Generated sheets are immutable. All output stays beside this script.
--scale changes feather lengths, --direction rotates the full field clockwise.
"""
from pathlib import Path
import argparse, hashlib, json, time
import numpy as np
from PIL import Image, PngImagePlugin
from scipy.ndimage import (gaussian_filter, gaussian_filter1d, distance_transform_edt,
                           map_coordinates, label, binary_dilation)

ROOT = Path(__file__).resolve().parent
SRC = ROOT / 'source'
N = 2048
SEED = 14631
HEIGHT_MM = 2.0


def write_png(path, a, srgb=False, height=False):
    info = PngImagePlugin.PngInfo()
    info.add(b'gAMA', (45455 if srgb else 100000).to_bytes(4, 'big'))
    if srgb:
        info.add(b'sRGB', b'\x00')
    info.add_text('Description', 'Dodo trousers; sRGB colour' if srgb else 'Dodo trousers; linear data')
    a = np.rint(np.clip(a, 0, 1) * (65535 if height else 255)).astype(np.uint16 if height else np.uint8)
    Image.fromarray(a).save(path, pnginfo=info)
    return a


def srgb_to_linear(x):
    return np.where(x <= .04045, x / 12.92, ((x + .055) / 1.055) ** 2.4)


def linear_to_srgb(x):
    x = np.maximum(x, 0)
    return np.where(x <= .0031308, x * 12.92, 1.055 * x ** (1 / 2.4) - .055)


def extend(field, valid):
    idx = distance_transform_edt(~valid, return_distances=False, return_indices=True)
    return field[tuple(idx)]


def normals(h, span, wrap, height_mm=HEIGHT_MM):
    mm_per_px = span * 1000 / h.shape[0]
    if wrap:
        dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * height_mm / (2 * mm_per_px)
        dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * height_mm / (2 * mm_per_px)
    else:
        dy, dx = np.gradient(h * height_mm, mm_per_px)
    v = np.stack([-dx, dy, np.ones_like(h)], -1)
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


def shaft_track(lum, alpha):
    H, W = lum.shape
    rows = np.flatnonzero((alpha > .65).any(1))
    start = int(rows[0])
    end = min(H - 1, int(start + (rows[-1] - start) * .67))
    root = float(np.where(alpha[start:min(start+12,H)] > .65)[1].mean())
    ridge = gaussian_filter(lum, (3, .85)) - gaussian_filter(lum, (3, 5))
    xx = np.arange(W)
    score = np.full((end-start+1,W), -1e5, np.float32)
    back = np.zeros_like(score, np.int16)
    score[0] = -((xx-root)/2)**2
    for y in range(start+1,end+1):
        prev = score[y-start-1]
        choices = np.array([np.roll(prev,k)-abs(k)*.004 for k in range(-2,3)])
        arg = choices.argmax(0)
        score[y-start] = choices.max(0) + ridge[y]*7 - ((xx-root)/W)**2 * .01
        score[y-start][alpha[y] < .5] -= 1
        back[y-start] = np.arange(W) - (arg-2)
    path = np.full(H, root, np.float32)
    x = int(score[-1].argmax())
    for y in range(end,start,-1):
        path[y] = x
        x = int(np.clip(back[y-start,x],0,W-1))
    path[end+1:] = path[end]
    return gaussian_filter1d(path, 9), start, end


def prepare_sources():
    feathers, manifest = [], []
    for letter in 'abc':
        file = SRC / f'generated_{letter}.png'
        image = np.asarray(Image.open(file).convert('RGBA'),np.float32)/255
        H,W = image.shape[:2]
        for q in range(4):
            x0,x1 = (q%2)*W//2,(q%2+1)*W//2
            y0,y1 = (q//2)*H//2,(q//2+1)*H//2
            raw = image[y0:y1,x0:x1].copy()
            a = raw[:,:,3]
            # Keep low-coverage and nearby disconnected barbs. R1's largest-only
            # alpha threshold erased precisely the thin strands we need.
            lab,num = label(a > .16)
            sizes = np.bincount(lab.ravel()); sizes[0] = 0
            main = lab == sizes.argmax()
            nearby = distance_transform_edt(~main) < 12
            keep = nearby & (a > .018)
            a = a * keep
            ys,xs = np.where(a > .01)
            bounds = [max(0,int(xs.min())-5),max(0,int(ys.min())-5),
                      min(raw.shape[1],int(xs.max())+6),min(raw.shape[0],int(ys.max())+6)]
            l,t,r,b = bounds
            raw = raw[t:b,l:r]; a = a[t:b,l:r]
            # Padding repairs an image-boundary root crop without inventing barbs.
            raw = np.pad(raw,((8,8),(8,8),(0,0)))
            a = np.pad(a,8)
            original_alpha = a.copy()
            # Alpha-test coverage compensation, without tracing/smoothing the
            # outline: original open gaps remain open and wisps stay branched.
            a = np.where(a > .018, np.clip(a/.92,0,1)**.38,0).astype(np.float32)
            valid = a > .5
            lum = raw[:,:,:3].mean(2)
            reliable = original_alpha > .08
            lum = extend(lum,reliable).astype(np.float32)
            linear = srgb_to_linear(lum)
            yy,xx = np.mgrid[:a.shape[0],:a.shape[1]].astype(np.float32)
            # Remove only a broad illumination plane, not local lock drawing.
            xn=(xx/a.shape[1]-.5); yn=(yy/a.shape[0]-.5)
            fit=original_alpha>.85
            terms=np.stack([np.ones_like(xn),xn,yn],-1)
            coef=np.linalg.lstsq(terms[fit][::8],linear[fit][::8],rcond=None)[0]
            broad_plane=np.clip(coef[1],-.10,.10)*xn+np.clip(coef[2],-.10,.10)*yn
            drawing=linear-broad_plane
            pigment=.5+(drawing-np.mean(drawing[fit]))*1.30
            pigment=np.clip(pigment,.14,.88)
            pigment+=.5-pigment[valid].mean()
            pigment=extend(pigment,original_alpha>.035).astype(np.float32)
            path,start,end = shaft_track(lum,original_alpha)
            yy,xx = np.mgrid[:a.shape[0],:a.shape[1]]
            occupied = np.flatnonzero(valid.any(1))
            v = np.clip((yy-start)/max(1,occupied[-1]-start),0,1)
            dist = distance_transform_edt(valid)
            shaft = np.exp(-((xx-path[:,None])/1.8)**2)
            shaft *= np.clip((.60-v)/.22,0,1)*valid
            # A veil of fine barbs, not an extruded silhouette. In millimetres:
            # gentle common bed + lock rounding + fine source-following ridges.
            fine=gaussian_filter(drawing,.40)-gaussian_filter(drawing,2.2)
            locks=gaussian_filter(drawing,5)-gaussian_filter(drawing,38)
            density=gaussian_filter(original_alpha,22)
            h = .54 + .055*density + .045*np.sin(v*np.pi)
            h += .48*fine + .38*locks + .018*shaft
            h = extend(h,original_alpha>.035).astype(np.float32)
            rough = (.91 - .038*shaft + .012*(1-density)).astype(np.float32)
            identifier = f'feather_{len(feathers)+1:02d}'
            base = np.dstack([np.repeat(linear_to_srgb(pigment)[:,:,None],3,2),a])
            write_png(SRC/f'{identifier}_cutout.png',base,True)
            write_png(SRC/f'{identifier}_height.png',h/HEIGHT_MM,height=True)
            write_png(SRC/f'{identifier}_shaft.png',shaft)
            write_png(SRC/f'{identifier}_alpha.png',a)
            # Keep an exact original RGBA crop for same-scale review/repainting.
            write_png(SRC/f'{identifier}_original.png',raw,True)
            write_png(SRC/f'{identifier}_original_alpha.png',original_alpha)
            fields = [f.astype(np.float32) for f in [a,pigment,h/HEIGHT_MM,rough,shaft]]
            np.savez_compressed(SRC/f'{identifier}_layers.npz',alpha=a,base_linear=pigment,
                                height=h/HEIGHT_MM,roughness=rough,shaft=shaft,original_alpha=original_alpha)
            tiprow = occupied[-1]
            tipx = float(np.where(valid[tiprow])[0].mean())
            meta = dict(id=identifier,original=file.name,
                        original_box=[x0+l,y0+t,x0+r,y0+b],padding_px=8,
                        size_px=[a.shape[1],a.shape[0]],root=[float(path[start]),float(start)],
                        tip=[tipx,float(tiprow)],height_mm=HEIGHT_MM,
                        cutout=f'source/{identifier}_cutout.png',
                        height=f'source/{identifier}_height.png',shaft=f'source/{identifier}_shaft.png',
                        alpha=f'source/{identifier}_alpha.png',layers=f'source/{identifier}_layers.npz',
                        original_crop=f'source/{identifier}_original.png',
                        original_alpha=f'source/{identifier}_original_alpha.png')
            manifest.append(meta); feathers.append(fields)
    (SRC/'elements.json').write_text(json.dumps(manifest,indent=2)+'\n')
    return feathers,manifest


def sample_element(fields, cx,cy,width,length,rotation,flip,canvas_shape):
    H,W = fields[0].shape
    rad = np.deg2rad(rotation); co,si = np.cos(rad),np.sin(rad)
    bw,bh = abs(co)*width+abs(si)*length,abs(si)*width+abs(co)*length
    l,r = max(0,int(cx-bw/2-2)),min(canvas_shape[1],int(cx+bw/2+3))
    t,b = max(0,int(cy-bh/2-2)),min(canvas_shape[0],int(cy+bh/2+3))
    if r<=l or b<=t: return None
    yy,xx = np.mgrid[t:b,l:r].astype(np.float64)
    dx,dy = xx+.5-cx,yy+.5-cy
    u = (co*dx+si*dy)/width+.5
    v = (-si*dx+co*dy)/length+.5
    if flip: u = 1-u
    coords = np.array([v*H-.5,u*W-.5])
    values = [map_coordinates(f,coords,order=1,mode='constant',cval=0,prefilter=False) for f in fields]
    return np.s_[t:b,l:r],values


def make_underlay(feathers):
    """Reconstruct the continuous, quantized feather bed beneath the visible fall."""
    scale,direction=1,0
    pad = int(600*scale); S = N+pad*2
    base = np.full((S,S),.5,np.float32)
    height = np.full((S,S),.54/HEIGHT_MM,np.float32)
    rough = np.full((S,S),.91,np.float32)
    coverage = np.zeros((S,S),np.float32)
    owner = np.full((S,S),-1,np.int16)
    rng = np.random.default_rng(SEED)
    rows,cols = max(5,round(10/scale)),max(7,round(14/scale))
    params = []
    for row in range(rows):
        line=[]
        for col in range(cols):
            line.append(dict(source=int(rng.integers(12)),jx=float(rng.uniform(-20,20)*scale),
                             jy=float(rng.uniform(-38,38)*scale),length_m=float(rng.uniform(.06,.09)*scale),
                             width_m=float(rng.uniform(.034,.045)*scale),
                             angle=float(rng.uniform(-12,12)),flip=bool(rng.integers(2))))
        params.append(line)
    factors=[]
    for source in feathers:
        visible=np.where(source[0]>.5)
        factors.append((source[0].shape[0]/(visible[0].max()-visible[0].min()),
                        source[0].shape[1]/(visible[1].max()-visible[1].min())))
    # Four staggered beds of actual barbs below the visible fall; no bare holes.
    passes=[(.19,.22),(.73,.11),(.38,.72),(.53,.56),(0,0)]
    for layer,(ox,oy) in enumerate(passes):
      for row in range(rows+4,-5,-1):
        for col in range(-5,cols+5):
            p = params[row%rows][col%cols]
            cx = (col+.5)*N/cols + (.47 if row%rows%2 else 0)*N/cols + p['jx']+pad
            cy = (row+.5)*N/rows+p['jy']+pad
            cx += N/cols*ox
            cy += N/rows*oy
            sid=(p['source']+layer*5)%12 if layer<4 else p['source']
            source=feathers[sid]
            # Requested dimensions cover visible root-to-tip, not source padding.
            length_factor,width_factor=factors[sid]
            result=sample_element(source,cx,cy,p['width_m']/ .427*N*width_factor,
                                  p['length_m']/.427*N*length_factor,p['angle'],p['flip'],base.shape)
            if result is None: continue
            sl,fields=result; a,pig,h,rr,shaft=fields
            # Same soft bed at every depth, only a 20-micron per-layer offset.
            h += (layer-4)*.020/HEIGHT_MM
            base[sl]=base[sl]*(1-a)+pig*a
            # Only soften the blending mask; never blur the barb ridges away.
            ah=gaussian_filter(a,1.3)
            height[sl]=height[sl]*(1-ah)+h*ah
            rough[sl]=rough[sl]*(1-a)+rr*a
            coverage[sl]=coverage[sl]*(1-a)+a
            owner[sl][a>.5]=sid
    crop=np.s_[pad:pad+N,pad:pad+N]
    base,height,rough,coverage,owner=[np.ascontiguousarray(f[crop]) for f in [base,height,rough,coverage,owner]]
    # Remove the tiny remaining contribution of the initial neutral canvas.
    # Every colour sample now comes entirely from actual overlapping feathers.
    if coverage.min() < .9:
        raise ValueError('Feather bed has an uncovered gap; increase the underlayers.')
    base=(base-.5*(1-coverage))/coverage
    # Rotation uses the square torus. Quarter turns preserve the full repeat.
    if direction%90: raise ValueError('Tile direction must be a multiple of 90 degrees to retain square periodicity.')
    turns=-(direction//90)%4
    base,height,rough,coverage,owner=[np.rot90(f,turns).copy() for f in [base,height,rough,coverage,owner]]
    # Preserve the accepted bed's quantization before the upper layers read it.
    folder=SRC/'underlay';folder.mkdir(exist_ok=True)
    base=delight(base,None,np.ones_like(base,dtype=bool))
    write_png(folder/'base.png',linear_to_srgb(base),True)
    write_png(folder/'height.png',height,height=True)
    write_png(folder/'roughness.png',rough)


def tile_volume_sources(feathers):
    folder=SRC/'tile_volume';folder.mkdir(exist_ok=True)
    result=[];manifest=[]
    for i,(alpha,pigment,h,rough,shaft) in enumerate(feathers):
        # A smooth cross-section follows the actual feather and each free lock.
        # Distance is rounded at millimetre scale, never extruded at the alpha edge.
        dist=gaussian_filter(distance_transform_edt(alpha>.36),2.4)
        dome=1-np.exp(-(dist/25)**1.35)
        broad=gaussian_filter(alpha,15)
        yy=np.indices(alpha.shape)[0]
        occupied=np.flatnonzero((alpha>.5).any(1))
        v=np.clip((yy-occupied[0])/(occupied[-1]-occupied[0]),0,1)
        # Bury the bare stem in the underlying plumage. The central shaft inside
        # the coherent upper vane remains unchanged and visible.
        root_blend=np.clip((v-.015)/.075,0,1)
        root_blend=root_blend*root_blend*(3-2*root_blend)
        rooted_alpha=(alpha*root_blend).astype(np.float32)
        end_round=np.sin(np.pi*np.clip(v,0,1))**.65
        # Millimetres: broad vane/lock volume plus the accepted strand relief.
        macro=(1.35*dome+.38*broad)*(.65+.35*end_round)
        micro=(h*HEIGHT_MM-gaussian_filter(h*HEIGHT_MM,7))*1.35
        lock=gaussian_filter(pigment,5)-gaussian_filter(pigment,23)
        volume=macro+micro+1.15*lock
        # Blend feather boundaries over ~1 mm at final scale; base alpha is exact.
        soft=gaussian_filter(rooted_alpha,7)
        result.append([rooted_alpha,pigment,volume.astype(np.float32),rough,shaft,soft.astype(np.float32)])
        write_png(folder/f'feather_{i+1:02d}_height.png',(.6+volume)/4,height=True)
        write_png(folder/f'feather_{i+1:02d}_rooted_alpha.png',rooted_alpha)
        np.savez_compressed(folder/f'feather_{i+1:02d}_volume.npz',volume_mm=volume,blend=soft,alpha=rooted_alpha)
        ident=f'feather_{i+1:02d}'
        manifest.append(dict(id=ident,base_and_shaft=f'source/{ident}_layers.npz',
            height=f'source/tile_volume/{ident}_height.png',height_mm=4,
            alpha=f'source/tile_volume/{ident}_rooted_alpha.png',
            layers=f'source/tile_volume/{ident}_volume.npz',
            placement_height='0.60 + bed_offset_mm + volume_gain * volume_mm; blend uses the soft mask',
            root_fade='Bare stem fades into the bed over first 9 percent; source alpha and accepted fringe unchanged.'))
    (folder/'elements.json').write_text(json.dumps(manifest,indent=2)+'\n')
    return result


def random_bed(rng,count,scale,bed):
    # Elliptical minimum separation on a torus: no rows, columns or repeated offset.
    placements=[];attempts=0
    minx=(.022 if bed<3 else .029)*scale
    miny=(.025 if bed<3 else .034)*scale
    while len(placements)<count and attempts<50000:
        attempts+=1;x,y=rng.uniform(0,.427,2)
        if placements:
            d=np.abs(np.array([[p['x_m'],p['y_m']] for p in placements])-[x,y]);d=np.minimum(d,.427-d)
            if np.min((d[:,0]/minx)**2+(d[:,1]/miny)**2)<1:continue
        sid=int(rng.integers(12))
        if placements:
            neighbour=np.argmin(np.sum(d*d,axis=1))
            if sid==placements[neighbour]['source']:sid=(sid+int(rng.integers(1,12)))%12
        flow=8*np.sin(2*np.pi*x/.427)+5*np.sin(2*np.pi*(y+x*.5)/.427)
        placements.append(dict(source=sid,x_m=float(x),y_m=float(y),
            length_m=float(rng.uniform(.060,.090)*scale),width_m=float(rng.uniform(.033,.049)*scale),
            angle=float(np.clip(flow+rng.normal(0,13),-32,32)),flip=bool(rng.integers(2)),
            volume_gain=float(rng.uniform(.83,1.15))))
    return placements


def make_tile(feathers,scale,direction):
    pad=int(600*scale);S=N+pad*2
    # The approved strand drawing supplies a continuous deepest feather bed.
    # It is almost entirely covered; even an opening never exposes a blank plane.
    deep=SRC/'underlay'
    b=srgb_to_linear(np.asarray(Image.open(deep/'base.png')).astype(np.float32)/255)
    h=np.asarray(Image.open(deep/'height.png')).astype(np.float32)/65535*2
    r=np.asarray(Image.open(deep/'roughness.png')).astype(np.float32)/255
    base=np.pad(b,pad,mode='wrap');height=np.pad(h,pad,mode='wrap');rough=np.pad(r,pad,mode='wrap')
    coverage=np.zeros((S,S),np.float32);owner=np.full((S,S),-1,np.int16)
    volume_sources=tile_volume_sources(feathers)
    factors=[]
    for f in feathers:
        yy,xx=np.where(f[0]>.5)
        factors.append((f[0].shape[0]/(yy.max()-yy.min()),f[0].shape[1]/(xx.max()-xx.min())))
    rng=np.random.default_rng(SEED+300)
    beds=[random_bed(rng,max(30,round(c/scale**2)),scale,j) for j,c in enumerate([125,125,125,92])]
    for j,bed in enumerate(beds):
        instances=[]
        for index,p in enumerate(bed):
            for dy in [-1,0,1]:
                for dx in [-1,0,1]:
                    cx=(p['x_m']/.427+dx)*N+pad;cy=(p['y_m']/.427+dy)*N+pad
                    if -500<cx<S+500 and -500<cy<S+500:instances.append((cy,cx,index,p))
        # Upper feathers lie over the roots below them, across wrap edges too.
        for cy,cx,index,p in sorted(instances,key=lambda k:-k[0]):
            sid=p['source'];lf,wf=factors[sid]
            result=sample_element(volume_sources[sid],cx,cy,p['width_m']/.427*N*wf,
                                   p['length_m']/.427*N*lf,p['angle'],p['flip'],base.shape)
            if result is None:continue
            sl,(a,pig,volume,rr,shaft,soft)=result
            base[sl]=base[sl]*(1-a)+pig*a
            # Deeper beds have lower, broader relief. The visible fall is fuller.
            gain=[.30,.38,.49,1.0][j]*p['volume_gain']
            target=.60+[0,.10,.21,.38][j]+gain*volume
            height[sl]=height[sl]*(1-soft)+target*soft
            rough[sl]=rough[sl]*(1-a)+rr*a
            coverage[sl]=coverage[sl]*(1-a)+a
            owner[sl][a>.5]=j*1000+index
    periodic={}
    for name,arr in [('base',base),('height',height),('roughness',rough),('coverage',coverage)]:
        periodic[name]=dict(x=float(np.max(np.abs(arr[pad:pad+N,pad-32:pad+32]-arr[pad:pad+N,pad+N-32:pad+N+32]))),
                            y=float(np.max(np.abs(arr[pad-32:pad+32,pad:pad+N]-arr[pad+N-32:pad+N+32,pad:pad+N]))))
    crop=np.s_[pad:pad+N,pad:pad+N]
    base,height,rough,coverage,owner=[np.ascontiguousarray(f[crop]) for f in [base,height,rough,coverage,owner]]
    if direction%90:raise ValueError('Tile direction must be a multiple of 90 degrees.')
    turns=-(direction//90)%4
    base,height,rough,coverage,owner=[np.rot90(f,turns).copy() for f in [base,height,rough,coverage,owner]]
    (SRC/'layout.json').write_text(json.dumps(dict(seed=SEED+300,scale=scale,direction_clockwise=direction,
        span_m=.427,distribution='Independent toroidal dart throws; no rows or columns',beds=beds),indent=2)+'\n')
    (SRC/'periodicity.json').write_text(json.dumps(periodic,indent=2)+'\n')
    np.savez_compressed(SRC/'tile_placement.npz',owner=owner,coverage=coverage)
    np.savez_compressed(SRC/'tile_layers.npz',base_linear=base,height_mm=height,roughness=rough)
    return base,height/4,rough,np.ones_like(base)


def make_sheet(feathers,manifest,scale):
    base=np.full((N,N),.5,np.float32); height=np.full((N,N),.54/HEIGHT_MM,np.float32)
    rough=np.full((N,N),.9,np.float32); alpha=np.zeros((N,N),np.float32)
    elements=[]
    lengths=np.array([.079,.072,.084,.069,.087,.076,.081,.073,.088,.067,.083,.075])*scale
    widths=np.array([.036,.035,.042,.033,.029,.038,.037,.034,.031,.043,.038,.034])*scale
    for i,fields in enumerate(feathers):
        cx=(i%4+.5)*N/4; cy=(i//4+.5)*N/3
        visible=np.where(fields[0]>.5)
        length=lengths[i]/.341*N*fields[0].shape[0]/(visible[0].max()-visible[0].min())
        width=widths[i]/.341*N*fields[0].shape[1]/(visible[1].max()-visible[1].min())
        sl,vals=sample_element(fields,cx,cy,width,length,0,False,base.shape)
        a,pig,h,rr,shaft=vals
        base[sl]=np.where(a>0,pig,base[sl]); height[sl]=np.where(a>0,h,height[sl])
        rough[sl]=np.where(a>0,rr,rough[sl]); alpha[sl]=a
        m=manifest[i]; sh,sw=fields[0].shape
        def transform(pt): return [round(cx-width/2+(pt[0]+.5)/sw*width,3),round(cy-length/2+(pt[1]+.5)/sh*length,3)]
        yy,xx=np.where(a>.5)
        tiprow=int(yy.max())
        tip=[round(float(sl[1].start+np.where(a[tiprow]>.5)[0].mean()+.5),3),
             float(sl[0].start+tiprow+.5)]
        elements.append(dict(id=m['id'],box=[int(sl[1].start+xx.min()),int(sl[0].start+yy.min()),
                int(sl[1].start+xx.max()+1),int(sl[0].start+yy.max()+1)],root=transform(m['root']),tip=tip,
                source=m['cutout'],length_m=round(float(lengths[i]),5),width_m=round(float(widths[i]),5)))
    valid=alpha>.5
    # Straight alpha; carry every data channel beyond the cut for stable filtering.
    base=extend(base,valid); height=extend(height,valid); rough=extend(rough,valid)
    # Stable invisible gutter: retain nearby detail, then gently reach a flat
    # constant bed well before each of the four borders. Wrapped checks agree.
    distance=distance_transform_edt(~valid)
    blend=np.clip((distance-10)/30,0,1)
    blend=blend*blend*(3-2*blend)
    height=height*(1-blend)+(.54/HEIGHT_MM)*blend
    edge=np.minimum.reduce([np.indices(height.shape)[0],np.indices(height.shape)[1],
                            N-1-np.indices(height.shape)[0],N-1-np.indices(height.shape)[1]])
    margin=np.clip((edge-24)/24,0,1); margin=margin*margin*(3-2*margin)
    height=height*margin+(.54/HEIGHT_MM)*(1-margin)
    return (base,height,rough,alpha),elements


def delight(base,normal,valid,volume_correction=False):
    # Correct only picture-wide drift. Fine value drawing is never fitted away
    # against the normals: it belongs in the albedo (COMMON, round two).
    out=base.astype(np.float64).copy()
    yy,xx=np.mgrid[:N,:N]
    sx=np.sin(2*np.pi*(xx+.5)/N); sy=np.sin(2*np.pi*(yy+.5)/N)
    basis=[np.ones_like(sx),sx,sy,sx*sy]
    # New rounded volume exposes broad light bias in the source drawing. Correct
    # only fields blurred over 3.75 mm; never fit or filter the fine barb drawing.
    modes=[]
    if volume_correction:
        for k in range(3):
            m=normal[:,:,k].astype(np.float64);m-=m[valid].mean();modes.append(m)
            basis.append(gaussian_filter(m,18,mode='wrap'))
    for _ in range(2):
        matrix=[]; target=[]
        for r in range(2):
            for c in range(2):
                q=np.s_[r*N//2:(r+1)*N//2,c*N//2:(c+1)*N//2]; ok=valid[q]
                matrix.append([f[q][ok].mean() for f in basis]);target.append(out[q][ok].mean()-.5)
        for m in modes:
            matrix.append([np.mean((m*f)[valid]) for f in basis])
            target.append(np.mean((m*out)[valid]))
        for k,f in zip(np.linalg.solve(matrix,target),basis): out-=k*f
    if volume_correction:
        correction=out-base
        before=base-gaussian_filter(base,3,mode='wrap')
        after=out-gaussian_filter(out,3,mode='wrap')
        (SRC/'tile_delight.json').write_text(json.dumps(dict(
            spatial_sigma_px=18,correction_rms_linear=float(correction.std()),
            correction_range_linear=[float(correction.min()),float(correction.max())],
            fine_barb_contrast_ratio=float(after.std()/before.std()),
            fine_barb_correlation=float(np.corrcoef(before.ravel(),after.ravel())[0,1])),indent=2)+'\n')
    return np.clip(out,.12,.90).astype(np.float32)


def save_set(name,fields,span,cutout,height_mm=HEIGHT_MM):
    base,h,rough,alpha=fields
    valid=alpha>.5
    h16=write_png(ROOT/f'{name}_height.png',h,height=True)
    delivered=h16.astype(np.float32)/65535
    normal=normals(delivered,span,True,height_mm)
    base=delight(base,normal,valid,volume_correction=not cutout)
    if cutout: base=extend(base,valid)
    rgb=np.repeat(linear_to_srgb(base)[:,:,None],3,2)
    if cutout: rgb=np.dstack([rgb,alpha])
    base8=write_png(ROOT/f'{name}_base.png',rgb,True)
    write_png(ROOT/f'{name}_normal.png',normal*.5+.5)
    # Eight-direction, three-scale geometric horizon AO, no preferred light.
    occ=np.zeros_like(h)
    slope_scale=height_mm/(span*1000/N)
    for dx,dy in [(1,0),(-1,0),(0,1),(0,-1),(1,1),(-1,1),(1,-1),(-1,-1)]:
        horizon=np.zeros_like(h)
        for radius in ([2,5,12,28] if cutout else [3,7,14,26,44,72]):
            near=np.roll(delivered,(dy*radius,dx*radius),(0,1))
            angle=np.arctan(np.maximum(near-delivered-.003,0)*slope_scale/(radius*np.hypot(dx,dy)))
            horizon=np.maximum(horizon,angle)
        occ+=np.sin(horizon)/8
    ao=np.clip(1-occ*(.7 if cutout else 1.65),.87 if cutout else .66,1)
    if cutout: ao=extend(ao,valid)
    write_png(ROOT/f'{name}_packed.png',np.stack([ao,rough,np.zeros_like(h)],-1))
    # Red continued throughout transparent gutters prevents mask-edge dilution.
    region=np.zeros((N,N,3),np.float32);region[:,:,0]=1
    write_png(ROOT/f'{name}_regions.png',region)
    linear=srgb_to_linear(base8[:,:,0].astype(float)/255)
    return dict(span_m=span,tiles=not cutout,cutout=cutout,height_mm=height_mm,regions=[0],
                resolution=[N,N],mean_grey_linear=float(linear[valid].mean()),
                mean_grey_srgb=float(base8[:,:,0][valid].mean()),
                normal_convention='OpenGL +Y (green points toward picture top)',
                alpha_cutoff=.5 if cutout else None,
                files={k:f'{name}_{k}.png' for k in ['base','height','normal','packed','regions']})


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--scale',type=float,default=1)
    parser.add_argument('--direction',type=int,default=0)
    args=parser.parse_args();start=time.time()
    config=json.loads((SRC/'build_config.json').read_text())
    for name,digest in config['metadata']['source_sha256'].items():
        if hashlib.sha256((SRC/name).read_bytes()).hexdigest()!=digest:
            raise ValueError('Generated original changed: '+name)
    print('Preparing twelve feathers from the three generated originals.',flush=True)
    feathers,manifest=prepare_sources()
    print('Reconstructing the continuous feather underlay.',flush=True)
    make_underlay(feathers)
    print('Building the tile and accepted fringe sheet.',flush=True)
    sets={'trousers':save_set('trousers',make_tile(feathers,args.scale,args.direction),.427,False,4.0)}
    fields,elements=make_sheet(feathers,manifest,1)
    sets['trousers_fringe']=save_set('trousers_fringe',fields,.341,True)
    sets['trousers_fringe']['elements']=elements
    meta={**config['metadata'],'sets':sets,'build_seconds':round(time.time()-start,2)}
    (ROOT/'study.json').write_text(json.dumps(meta,indent=2)+'\n')
    # Default builds must reproduce every accepted byte; variants retain the sheet.
    mismatched=[]
    for name,digest in config['accepted_png_sha256'].items():
        if (args.scale!=1 or args.direction!=0) and not name.startswith('trousers_fringe_'):
            continue
        if hashlib.sha256((ROOT/name).read_bytes()).hexdigest()!=digest:
            mismatched.append(name)
    if mismatched:
        raise ValueError('Accepted PNG hash mismatch: '+', '.join(mismatched))
    if sets['trousers_fringe']!=config['accepted_fringe_metadata']:
        raise ValueError('Accepted fringe metadata changed')
    print(json.dumps(dict(build_seconds=meta['build_seconds'],accepted_hashes_match=True,
                         sets={k:v['mean_grey_linear'] for k,v in sets.items()})),flush=True)


if __name__=='__main__': main()
