"""Rebuild the beak studies. Python 3 + Pillow, NumPy, SciPy; no network.

All distances in surface synthesis are millimetres. Grain angle, density, relief
and spans are exposed below. The silhouette is a hand trace of our head concept,
reflected so the face is left. Source light is never used for broad form.
"""
from pathlib import Path
import argparse
import hashlib
import json
import time
import numpy as np
from PIL import Image, ImageDraw, PngImagePlugin
from scipy.ndimage import gaussian_filter, map_coordinates, distance_transform_edt

ROOT = Path(__file__).resolve().parent
N = 2048
SEED = 29841
HORN_SPAN_M = .256
SIDE_SPAN_M = .14
GRAIN_ANGLE_DEG = 0.0
GRAIN_SCALE = 1.0
MICRO_RELIEF = 1.0
HEIGHT_RANGES_MM = {'horn': .8, 'beak_side': 4.0}


def linear(a):
    return np.where(a <= .04045, a / 12.92, ((a + .055) / 1.055) ** 2.4)


def srgb(a):
    a = np.maximum(a, 0)
    return np.where(a <= .0031308, 12.92*a, 1.055*a**(1/2.4)-.055)


def save(path, a, color=False, sixteen=False):
    info = PngImagePlugin.PngInfo()
    info.add(b'gAMA', (45455 if color else 100000).to_bytes(4, 'big'))
    if color:
        info.add(b'sRGB', b'\x00')
    info.add_text('Description', 'Dodo beak material study. ' +
                  ('sRGB base colour; neutral in blue dye region.' if color else
                   'Linear data. OpenGL +Y normals; packed R=AO G=roughness B=0.'))
    if a.dtype != np.uint8:
        a = np.clip(np.rint(a*(65535 if sixteen else 255)), 0,
                    65535 if sixteen else 255).astype(np.uint16 if sixteen else np.uint8)
    Image.fromarray(a).save(ROOT / path, pnginfo=info)
    return a


def noise(rng, shape, sigma):
    a = gaussian_filter(rng.standard_normal(shape).astype(np.float32), sigma, mode='wrap')
    return a / max(a.std(), 1e-7)


def source_tile():
    """Overlapped periodic crossfade, not mirroring or a blurred boundary strip.

    At the boundary the source coordinates are consecutive (1023 -> 1024).
    Raised-cosine weights have zero derivatives at the overlap ends.
    """
    im = Image.open(ROOT/'source/horn_r2b_generated.png').convert('RGB')
    a = linear(np.asarray(im, dtype=np.float32).mean(axis=-1)/255)
    m = min(a.shape)
    p = int(m*.80)
    overlap = m-p
    a = a[:m,:m]
    t = np.arange(p, dtype=np.float32)
    w = np.where(t < overlap, .5-.5*np.cos(np.pi*np.minimum(t/overlap,1)), 1)
    b = a[:,:p]*w + a[:,(np.arange(p)+p)%m]*(1-w)
    b = b[:p]*w[:,None] + b[(np.arange(p)+p)%m]*(1-w[:,None])
    yy,xx=np.mgrid[:N,:N].astype(np.float32)
    b=map_coordinates(b,np.stack((yy*p/N,xx*p/N)),order=3,mode='grid-wrap')
    # Remove only the very broad field, retaining intrinsic pores, scratches,
    # and 3–15 mm mottling. Round 1's 25-pixel high pass erased this drawing.
    broad = gaussian_filter(b, 150, mode='wrap')
    return (b-broad).astype(np.float32)


def add_blob(field, x, y, sx, sy, amplitude, ring=0):
    r = int(np.ceil(max(sx,sy)*3.5+2))
    xs = np.arange(int(x)-r,int(x)+r+1)
    ys = np.arange(int(y)-r,int(y)+r+1)
    q = ((xs[None,:]-x)/sx)**2 + ((ys[:,None]-y)/sy)**2
    b = np.exp(-q/2)
    if ring:
        b = b - ring*np.exp(-((np.sqrt(q)-2.2)/.5)**2)
    field[np.ix_(ys % N, xs % N)] += amplitude*b


def segment(field, x, y, length, angle, width, depth):
    ca, sa = np.cos(angle), np.sin(angle)
    ex, ey = x+length*ca, y+length*sa
    xs = np.arange(int(min(x,ex)-width*4-3),int(max(x,ex)+width*4+4))
    ys = np.arange(int(min(y,ey)-width*4-3),int(max(y,ey)+width*4+4))
    xx, yy = xs[None,:]-x, ys[:,None]-y
    u, v = xx*ca+yy*sa, -xx*sa+yy*ca
    taper = np.sin(np.pi*np.clip(u/length,0,1))**.45
    field[np.ix_(ys%N,xs%N)] += depth*np.exp(-.5*(v/width)**2)*taper


def curved_scratch(field, lips, points, width, depth):
    """A slightly bowed incision, tapered in width and depth at both ends."""
    p=np.asarray(points,np.float32)
    xs=np.arange(int(p[:,0].min()-5*width-3),int(p[:,0].max()+5*width+4))
    ys=np.arange(int(p[:,1].min()-5*width-3),int(p[:,1].max()+5*width+4))
    xx,yy=xs[None,:],ys[:,None]
    t=np.linspace(0,1,97,dtype=np.float32)[:,None]
    curve=(1-t)**2*p[0]+2*(1-t)*t*p[1]+t*t*p[2]
    distance=np.full((len(ys),len(xs)),np.inf,np.float32)
    along=np.zeros_like(distance)
    for i,(a,b) in enumerate(zip(curve[:-1],curve[1:])):
        v=b-a
        u=np.clip(((xx-a[0])*v[0]+(yy-a[1])*v[1])/np.dot(v,v),0,1)
        d2=(xx-a[0]-u*v[0])**2+(yy-a[1]-u*v[1])**2
        closer=d2<distance
        along=np.where(closer,(i+u)/96,along)
        distance=np.minimum(distance,d2)
    taper=np.sin(np.pi*along)**.7
    local_width=width*(.35+.65*taper)
    q=np.sqrt(distance)/local_width
    index=np.ix_(ys%N,xs%N)
    field[index]+=depth*np.exp(-.5*q*q)*taper
    lips[index]+=.008*np.exp(-.5*((q-2.0)/.60)**2)*taper


def crater(depth_field, pigment_field, x, y, diameter, depth, tone, angle, rim, softness=0):
    """Subpixel-integrated irregular crater: crisp wall, dark flat floor.

    Diameter is in pixels, depth in mm, tone in linear reflectance. Unlike a
    Gaussian spot, the floor and wall remain distinct at 0.3–2 mm size.
    Softness broadens a minority of worn walls without blurring every crater.
    """
    radius=diameter*.5
    reach=int(np.ceil(radius*1.55+2))
    xs=np.arange(int(x)-reach,int(x)+reach+1)
    ys=np.arange(int(y)-reach,int(y)+reach+1)
    h=np.zeros((len(ys),len(xs)),np.float32)
    pigment=np.zeros_like(h)
    ca,sa=np.cos(angle),np.sin(angle)
    for oy in [-.25,.25]:
        for ox in [-.25,.25]:
            dx,dy=xs[None,:]+ox-x,ys[:,None]+oy-y
            u,v=(dx*ca+dy*sa)/(radius*1.08),(-dx*sa+dy*ca)/(radius*.92)
            theta=np.arctan2(v,u)
            q=np.sqrt(u*u+v*v)/(1+.10*np.sin(3*theta+angle)+.045*np.cos(5*theta-angle))
            t=np.clip((q-(.80-.24*softness))/(.25+.32*softness),0,1)
            bowl=1-t*t*(3-2*t)
            lip=np.exp(-((q-1.09)/(.15+.12*softness))**2)
            floor=np.exp(-(q/(.43-.06*softness))**(6-3*softness))
            h+=(depth*bowl-depth*rim*lip)*.25
            pigment+=(-tone*floor+.012*rim/.1*lip)*.25
    index=np.ix_(ys%N,xs%N)
    depth_field[index]+=h
    pigment_field[index]+=pigment


def varied_pore(rng, diameter, depth, tone, rim):
    """Thin the fixed candidate catalogue, keeping the approved background RNG.

    Mostly 0.3–0.8 mm pores, some medium, and occasional 1–2 mm craters.
    Profile variation has its own stream so mottling, polish and chips do not move.
    """
    size_class=rng.random()
    if size_class<.76:
        diameter=.30+(diameter-.30)*.70
    elif size_class<.91:
        diameter=.65+(diameter-.30)*.68
    else:
        diameter=1.0+(diameter-.30)/.70
    softness=float(rng.uniform(.55,1)) if rng.random()<.25 else float(rng.uniform(0,.18))
    if softness>.5:
        depth*=.35
        tone*=.45
        rim*=.35
    else:
        depth*=.85 if diameter<1 else 1.10
        tone*=.85
    return diameter,depth,tone,rim,softness


def horn_fields():
    rng = np.random.default_rng(SEED)
    shape = (N,N)
    pixels_mm = N/(HORN_SPAN_M*1000)
    source = source_tile()
    # Keep the generated fine keratin drawing; replace its round low-frequency
    # clouds with quiet tonal drift elongated along growth.
    fine_source=source-gaussian_filter(source,12,mode='wrap')
    patch = np.clip(noise(rng,shape,23)-.25,0,1)
    fibers = noise(rng, shape, (.9, 9))*patch
    bundles = noise(rng, shape, (2.2, 25))*patch
    pores = np.zeros(shape, np.float32)
    pore_pigment = np.zeros(shape,np.float32)
    scratches = np.zeros(shape, np.float32)
    cluster = noise(rng,shape,(24,95))
    pore_rng=np.random.default_rng(SEED+400)
    catalogue=[]
    for _ in range(16500):
        x, y = rng.uniform(0,N,2)
        if rng.random() > np.clip(.49+.27*cluster[int(y),int(x)], .06,.92):
            continue
        diameter=rng.triangular(.30,.48,1.0)
        depth,tone,angle,rim=rng.uniform(.055,.16),rng.uniform(.09,.24),rng.uniform(0,np.pi),rng.choice([0,.07,.12])
        # Keep 27% of the old candidates, with the existing loose clusters.
        # Draw every candidate's attributes before thinning: the accepted fine
        # drawing, longitudinal drift and incidental scratches stay identical.
        if pore_rng.random()>.27: continue
        diameter,depth,tone,rim,softness=varied_pore(pore_rng,diameter,depth,tone,rim)
        crater(pores,pore_pigment,x,y,diameter*pixels_mm,depth,tone,angle,rim,softness)
        catalogue.append(list(map(float,[x,y,diameter,depth,tone,angle,rim,softness])))
    for _ in range(170):
        segment(scratches,*rng.uniform(0,N,2),rng.uniform(.8,7)*pixels_mm,
                rng.choice([-1,1])*rng.uniform(.35,1.15),rng.uniform(.035,.065)*pixels_mm,
                rng.uniform(.025,.075))
    yy,xx = np.mgrid[:N,:N].astype(np.float32)
    # Faint growth lamellae: periodic, wavy, broken; not regular wood rings.
    phase = 2*np.pi*(32*xx/N + .16*np.sin(yy/N*2*np.pi*3)+
                     .08*np.sin(xx/N*2*np.pi*5+yy/N*2*np.pi*2))
    growth = np.exp(-((np.sin(phase)+1)/.055)**2)*np.clip(.5+.35*noise(rng,shape,17),0,1)
    # The source's dark local pits imply shallow concavities, not its broad tone.
    dark = np.maximum(gaussian_filter(fine_source,2.5,mode='wrap')-fine_source-.006,0)
    source_pits = .060*np.tanh(dark/.035)
    mottle = noise(rng,shape,(18,135))
    micro = (.004*fibers+.003*bundles-source_pits-pores-scratches-.015*growth)*MICRO_RELIEF
    pigment = 1.10*fine_source+.014*mottle+pore_pigment-.70*scratches-.009*growth+.003*fibers
    rough = np.clip(.455+.009*mottle-.07*fine_source+.24*pores+.14*source_pits, .39,.55)
    (ROOT/'source/horn_pores.json').write_text(json.dumps(dict(
        columns=['x_px','y_px','diameter_mm','depth_mm','floor_tone_linear','angle_rad','rim_ratio','softness'],
        span_m=HORN_SPAN_M,pores=catalogue),separators=(',',':'))+'\n')
    return dict(micro=micro,pigment=pigment,roughness=rough,grain=fibers,
                pores=pores,scratches=scratches,growth=growth,source_detail=source,
                source_pits=source_pits,mottle=mottle,pore_pigment=pore_pigment,
                source_fine=fine_source)


def bezier(points, steps=80):
    p = np.array(points,np.float32)
    t = np.linspace(0,1,steps)[:,None]
    return (1-t)**3*p[0]+3*(1-t)**2*t*p[1]+3*(1-t)*t*t*p[2]+t**3*p[3]


# Coordinates in ref/concept/head_side.png. These are outlines, not its lighting.
UPPER = [
    [(710,322),(671,329),(652,320),(603,325)],
    [(603,325),(432,315),(331,338),(248,393)],
    [(248,393),(164,447),(121,515),(118,620)],
    [(118,620),(116,694),(150,777),(191,803)],
    [(191,803),(202,810),(208,806),(209,791)],
    [(209,791),(212,740),(226,704),(257,678)],
    [(257,678),(318,645),(520,622),(650,614)],
    [(650,614),(696,612),(725,610),(748,606)],
    [(748,606),(761,591),(770,574),(765,548)],
    [(765,548),(744,481),(731,390),(710,322)]
]
LOWER = [
    [(748,615),(772,619),(798,636),(790,665)],
    [(790,665),(789,689),(776,703),(747,705)],
    [(747,705),(615,706),(382,724),(282,700)],
    [(282,700),(263,696),(248,690),(253,682)],
    [(253,682),(318,651),(523,632),(650,622)],
    [(650,622),(693,619),(724,616),(748,615)]
]


def transform(p):
    p = np.asarray(p,dtype=np.float32)
    return np.stack((120+(790-p[...,0])*2.65,365+(p[...,1]-322)*2.65),axis=-1)


def outline_mask(curves):
    points = transform(np.concatenate([bezier(p) for p in curves]))
    im = Image.new('L',(N*2,N*2))
    ImageDraw.Draw(im).polygon([tuple(p*2) for p in points],fill=255)
    alpha = np.asarray(im.resize((N,N),Image.Resampling.LANCZOS),np.float32)/255
    return alpha, points


def normal(h, span_m, wrap):
    pitch = span_m*1000/h.shape[0]
    if wrap:
        dx = (np.roll(h,-1,axis=1)-np.roll(h,1,axis=1))/(2*pitch)
        dy = (np.roll(h,-1,axis=0)-np.roll(h,1,axis=0))/(2*pitch)
    else:
        dy,dx = np.gradient(h,pitch)
    n = np.stack((-dx,dy,np.ones_like(h)),axis=-1)
    return n/np.linalg.norm(n,axis=-1,keepdims=True)


def occlusion(h, span_m, wrap):
    pitch = span_m*1000/N
    occ = np.zeros_like(h)
    for dx,dy in [(1,0),(-1,0),(0,1),(0,-1),(1,1),(-1,1),(1,-1),(-1,-1)]:
        horizon = np.zeros_like(h)
        for r in [1,2,4,8,16,32]:
            if wrap:
                other = np.roll(h,(r*dy,r*dx),axis=(0,1))
            else:
                other = np.take(np.take(h,np.clip(np.arange(N)+r*dy,0,N-1),axis=0),
                                np.clip(np.arange(N)+r*dx,0,N-1),axis=1)
            slope = np.maximum(other-h-.004,0)/(r*pitch*np.hypot(dx,dy))
            horizon = np.maximum(horizon,slope/np.sqrt(1+slope*slope))
        occ += horizon/8
    return np.clip(1-.58*occ,.48,1)


def normalize_pigment(pigment, mask, protect=None, periodic=False):
    """Neutral regional mean in linear light, retaining local material wear.

    A tile has no authored value gradient. Its small residual quadrant drift is
    balanced periodically. The side uses ONE global offset: quadrant compensation
    around the pale wear caused the false inner-hook/gape shadow in round 2.
    """
    a = .5+pigment.astype(np.float64)
    if not periodic:
        for _ in range(4):
            a += .5-a[mask].mean()
            a = np.clip(a,.035,.98)
        return a.astype(np.float32)
    if protect is None:
        protect = np.zeros_like(a)
    yy,xx = np.mgrid[:N,:N]
    wx = .5-.5*np.sin(xx/N*2*np.pi) if periodic else .5+.5*np.tanh((xx-N/2)/(N*.1))
    wy = .5-.5*np.sin(yy/N*2*np.pi) if periodic else .5+.5*np.tanh((yy-N/2)/(N*.1))
    fields = [(1-wx)*(1-wy),wx*(1-wy),(1-wx)*wy,wx*wy]
    fields = [f*(1-.98*protect) for f in fields]
    quadrants = [mask&(xx<N/2)&(yy<N/2),mask&(xx>=N/2)&(yy<N/2),
                 mask&(xx<N/2)&(yy>=N/2),mask&(xx>=N/2)&(yy>=N/2)]
    matrix = np.array([[f[q].mean() for f in fields] for q in quadrants])
    for _ in range(3):
        residual = np.array([a[q].mean()-.5 for q in quadrants])
        correction = np.linalg.solve(matrix,residual)
        a -= sum(c*f for c,f in zip(correction,fields))
        a = np.clip(a,.065,.97)
    a += .5-a[mask].mean()
    return a.astype(np.float32)


def export_set(name, h, pigment, rough, alpha, span, tiles, protect=None):
    mask = alpha >= .5
    albedo = normalize_pigment(pigment,mask,protect,periodic=tiles)
    # Dilation across the cutout carries actual edge values through transparency.
    if not tiles:
        indices = distance_transform_edt(~mask,return_distances=False,return_indices=True)
        albedo[~mask] = albedo[tuple(indices[:,~mask])]
        h[~mask] = h[tuple(indices[:,~mask])]
        rough[~mask] = rough[tuple(indices[:,~mask])]
    gray = np.uint8(np.clip(np.rint(srgb(albedo)*255),0,255))
    rgb = np.repeat(gray[:,:,None],3,axis=-1)
    if not tiles:
        rgb = np.dstack((rgb,np.uint8(np.rint(alpha*255))))
    base = save(name+'_base.png',rgb,color=True)
    height16 = save(name+'_height.png',h/HEIGHT_RANGES_MM[name],sixteen=True)
    # Derive from delivered 16-bit values, in millimetres, at physical pitch.
    delivered_h = height16.astype(np.float32)/65535*HEIGHT_RANGES_MM[name]
    normals = normal(delivered_h,span,tiles)
    save(name+'_normal.png',normals*.5+.5)
    ao = occlusion(delivered_h,span,tiles)
    save(name+'_packed.png',np.stack((ao,rough,np.zeros_like(rough)),axis=-1))
    regions = np.zeros((N,N,3),np.uint8)
    regions[mask] = (0,0,255)
    save(name+'_regions.png',regions)
    return dict(span_m=span,tiles=tiles,cutout=not tiles,height_mm=HEIGHT_RANGES_MM[name],
                regions=[2],region_mean_linear=float(linear(base[:,:,:3]/255)[mask].mean()),
                region_mean_srgb=float(base[:,:,:3][mask].mean()),
                used_height_mm=[float(delivered_h[mask].min()),float(delivered_h[mask].max())],
                roughness_range=[float(rough[mask].min()),float(rough[mask].max())])


def make_side(fields):
    upper_alpha,up_points = outline_mask(UPPER)
    lower_alpha,lo_points = outline_mask(LOWER)
    alpha = np.maximum(upper_alpha,lower_alpha)
    upper,lower = upper_alpha>=.5,lower_alpha>=.5
    yy,xx = np.mgrid[:N,:N].astype(np.float32)
    # Same texels/mm as the tile; curve the fibres down into the hook.
    ratio = SIDE_SPAN_M/HORN_SPAN_M
    bend = np.maximum((xx-1250)/650,0)**2*115
    coords = np.stack(((yy-bend)*ratio+340,xx*ratio+190))
    sampled = {k:map_coordinates(v,coords,order=1,mode='grid-wrap',prefilter=False)
               for k,v in fields.items() if k in ['micro','pigment','roughness']}
    ud = distance_transform_edt(upper).astype(np.float32)
    ld = distance_transform_edt(lower).astype(np.float32)
    # Worn leading hook, fading organically into the face of the upper bill.
    rng = np.random.default_rng(SEED+1)
    mottle = noise(rng,(N,N),16)
    right_edge = (N-1-np.argmax(upper[:,::-1],axis=1)).astype(np.float32)[:,None]
    leading_distance = np.maximum(right_edge-xx+9*mottle,0)
    distal_gate = np.clip((xx-1360)/220,0,1)*np.clip((yy-510)/190,0,1)
    arc = np.exp(-(leading_distance/210)**2)*distal_gate
    tip = np.clip((yy-1270)/245,0,1)*np.clip((xx-1450)/155,0,1)
    tip = tip*tip*(3-2*tip)
    edge = np.exp(-ud/17)*upper*(yy>1090)*(xx>500)
    lower_edge = np.exp(-ld/15)*lower
    wear = np.clip(np.maximum(.98*arc,.96*tip)*upper+.43*edge+.44*lower_edge,0,1)
    micro = sampled['micro']*(1-.55*wear)
    h = 1.7+micro
    # Small surface bevel; large beak curvature belongs to the modeller.
    h += .24*(1-np.exp(-ud/16))*upper+.20*(1-np.exp(-ld/13))*lower
    pigment = sampled['pigment']*(1-.12*wear)+.43*wear+.012*(xx/N-.5)
    rough = sampled['roughness']-.205*wear
    # Material staining and peppering remain in polished horn. Cluster the
    # additional marks towards the root and leading hook, using the same field
    # for pigment, shallow indentation, and roughness.
    pepper = np.zeros((N,N),np.float32)
    side_pore_depth=np.zeros((N,N),np.float32)
    side_pore_pigment=np.zeros((N,N),np.float32)
    clusters = noise(rng,(N,N),(20,90))
    pore_rng=np.random.default_rng(SEED+401)
    catalogue=[]
    for _ in range(2800):
        x,y = rng.uniform(100,1930),rng.uniform(370,1660)
        iy,ix = int(y),int(x)
        if alpha[iy,ix]<.5: continue
        density = .18+.28*(x<660)+.34*(x>1440)+.16*clusters[iy,ix]
        if rng.random()>density: continue
        diameter=rng.triangular(.30,.48,1.0)
        depth,tone,angle,rim=rng.uniform(.055,.16),rng.uniform(.09,.24),rng.uniform(0,np.pi),rng.choice([0,.07,.12])
        if pore_rng.random()>.38: continue
        diameter,depth,tone,rim,softness=varied_pore(pore_rng,diameter,depth,tone,rim)
        depth*=1-.35*wear[iy,ix]
        crater(side_pore_depth,side_pore_pigment,x,y,diameter*N/(SIDE_SPAN_M*1000),
               depth,tone,angle,rim,softness)
        catalogue.append(list(map(float,[x,y,diameter,depth,tone,angle,rim,softness])))
    # Larger irregular stains survive polishing without becoming big craters.
    # Two overlapping lobes prevent a regular circular-dot appearance.
    for _ in range(140):
        x,y=rng.uniform(1450,1910),rng.uniform(650,1660)
        if alpha[int(y),int(x)]<.5 or wear[int(y),int(x)]<.25: continue
        radius=rng.uniform(1.6,3.0)
        strength=rng.uniform(.02,.05)
        add_blob(pepper,x,y,radius*.8,radius*1.6,strength)
        add_blob(pepper,x+radius,y-radius*.6,radius,radius*.7,strength*.55)
    stain = .004*noise(rng,(N,N),(7,70))*wear
    pigment += side_pore_pigment-pepper-stain
    h -= side_pore_depth+pepper*.18
    rough += side_pore_depth*.16
    # Track the dorsal ridge from the traced upper boundary.
    top = np.argmax(upper,axis=0).astype(np.float32)[None,:]
    dorsal = np.exp(-((yy-top-22)/35)**2)*upper
    h += .23*dorsal
    # Three complete growth rolls. Each fills the interval between channel
    # paths with a rounded crest; dark pigment occupies only the narrow floor.
    cy = (yy-365)/2.65+322
    grooves = np.zeros((N,N),np.float32)
    bands = np.zeros((N,N),np.float32)
    groove_layout = []
    for root_x in (610,642,674):
        path_x = root_x+39*np.sin(np.clip((cy-322)/295,0,1)*1.75)
        target_x = 120+(790-path_x)*2.65
        d = xx-target_x
        gate = upper.astype(np.float32)
        width=32*2.65
        t=np.clip(d/width,0,1)
        roll=np.maximum(np.sin(np.pi*t),0)
        band=roll**1.8*gate
        crest=roll**6*gate
        wall=np.clip((np.abs(d)-2.4)/4.2,0,1)
        floor=(1-wall*wall*(3-2*wall))*gate
        dirt=np.exp(-.5*(d/1.4)**2)*gate
        h += .65*band-.15*floor
        pigment += .060*band+.030*crest-.060*dirt
        rough += .030*floor-.022*crest
        grooves = np.maximum(grooves,floor)
        bands = np.maximum(bands,band)
        groove_layout.append(dict(root_concept_x=root_x,depth_mm=.15,band_height_mm=.65,
                                 band_width_mm=width*SIDE_SPAN_M*1000/N,
                                 band_profile='sin(pi * interval_fraction)^1.8; three rounded rolls',
                                 channel_floor_width_mm=4.8*SIDE_SPAN_M*1000/N,
                                 channel_wall_width_mm=4.2*SIDE_SPAN_M*1000/N,
                                 pigment_sigma_mm=1.4*SIDE_SPAN_M*1000/N))
    # Three clear tapered incisions, crossing growth at distinct angles. Their
    # positions are authored on our concept; each has a narrow pale keratin lip.
    clear_scratches=np.zeros((N,N),np.float32)
    scratch_lips=np.zeros_like(clear_scratches)
    scratch_layout=[]
    for start,control,end,depth,width_mm in [([584,442],[546,483],[510,510],.070,.100),
                                            ([458,465],[474,500],[503,531],.055,.085),
                                            ([370,490],[340,532],[328,570],.050,.080)]:
        p0,pc,p1=transform(start),transform(control),transform(end)
        width=width_mm*N/(SIDE_SPAN_M*1000)
        curved_scratch(clear_scratches,scratch_lips,[p0,pc,p1],width,depth)
        scratch_layout.append(dict(start_px=p0.tolist(),control_px=pc.tolist(),end_px=p1.tolist(),
                                   depth_mm=depth,width_sigma_mm=width_mm))
    clear_scratches*=upper
    scratch_lips*=upper
    h+=-clear_scratches+scratch_lips
    pigment+=-.42*clear_scratches+2.0*scratch_lips
    rough+=.14*clear_scratches
    # Long, low, softly rimmed nostril. q=1 is the soft rim, q<1 the opening.
    cx,cy2 = transform([572,582])
    dx = xx-cx
    ny = yy-cy2-.145*dx
    q = np.sqrt((dx/168)**2+(ny/22)**2)
    cavity = .5-.5*np.tanh((q-.80)/.18)
    rim = np.exp(-((q-1.10)/.24)**2)
    h += -1.20*cavity+.085*rim
    # Mild intrinsic grime only: the visibly dark cavity comes from relief/AO.
    pigment -= .18*cavity
    rough += .12*cavity-.018*rim
    # Sparse chips and scuffs are aligned across colour, relief, roughness.
    chips = np.zeros((N,N),np.float32)
    for _ in range(160):
        x,y = rng.uniform(110,N-80),rng.uniform(650,1700)
        iy,ix=int(y),int(x)
        if alpha[iy,ix]<.5 or wear[iy,ix]<.22:
            continue
        if min(ud[iy,ix] if upper[iy,ix] else 1e6,ld[iy,ix] if lower[iy,ix] else 1e6)>35:
            continue
        segment(chips,x,y,rng.uniform(5,35),rng.uniform(-1,1),rng.uniform(.7,2.2),rng.uniform(.025,.11))
    h -= chips
    pigment += chips*.35
    rough += chips*.18
    rough = np.clip(rough,.235,.62)
    # Keep reusable semantic masks independent from the diffuse image.
    save('source/beak_upper_mask.png',upper_alpha)
    save('source/beak_lower_mask.png',lower_alpha)
    save('source/beak_wear.png',wear)
    save('source/beak_grooves.png',grooves)
    save('source/beak_bands.png',bands)
    save('source/beak_nostril.png',cavity)
    save('source/beak_chips.png',np.clip(chips/.12,0,1))
    save('source/beak_pepper.png',np.clip((pepper-side_pore_pigment)/.30,0,1))
    save('source/beak_pores_depth.png',np.clip(side_pore_depth/.35,0,1),sixteen=True)
    save('source/beak_stain.png',np.clip(.5+stain*7,0,1))
    save('source/beak_scratches.png',np.clip(clear_scratches/.15,0,1),sixteen=True)
    save('source/beak_scratch_lips.png',np.clip(scratch_lips/.03,0,1),sixteen=True)
    (ROOT/'source/beak_pores.json').write_text(json.dumps(dict(
        columns=['x_px','y_px','diameter_mm','depth_mm','floor_tone_linear','angle_rad','rim_ratio','softness'],
        span_m=SIDE_SPAN_M,pores=catalogue),separators=(',',':'))+'\n')
    layout = dict(upper_outline_px=up_points[::8].tolist(),lower_outline_px=lo_points[::8].tolist(),
                  concept_transform='x=120+(790-source_x)*2.65; y=365+(source_y-322)*2.65',
                  grooves=groove_layout,nostril_center_px=[float(cx),float(cy2)],
                  nostril_half_axes_px=[168,22],nostril_depth_mm=1.2,
                  hook_tip_px=transform([200,803]).tolist(),scratches=scratch_layout)
    return h,pigment,rough,alpha,wear,layout


def main():
    start=time.time()
    fields=horn_fields()
    if GRAIN_ANGLE_DEG or GRAIN_SCALE!=1:
        yy,xx=np.mgrid[:N,:N].astype(np.float32)
        theta=np.deg2rad(GRAIN_ANGLE_DEG)
        coords=np.stack(((yy*np.cos(theta)-xx*np.sin(theta))/GRAIN_SCALE,
                         (xx*np.cos(theta)+yy*np.sin(theta))/GRAIN_SCALE))
        fields={k:map_coordinates(v,coords,order=1,mode='grid-wrap',prefilter=False) for k,v in fields.items()}
    np.savez_compressed(ROOT/'source/horn_fields.npz',**fields)
    horn=export_set('horn',.45+fields['micro'],fields['pigment'],fields['roughness'],
                    np.ones((N,N),np.float32),HORN_SPAN_M,True)
    print('Built horn',flush=True)
    h,p,r,a,w,layout=make_side(fields)
    side=export_set('beak_side',h,p,r,a,SIDE_SPAN_M,False,protect=w)
    side['layout']=layout
    side['orientation']='Face left; hooked tip right; dorsal edge up.'
    side['silhouette_width_m']=float((np.where(a>=.5)[1].max()-np.where(a>=.5)[1].min()+1)/N*SIDE_SPAN_M)
    horn['orientation']=f'Longitudinal grain at {GRAIN_ANGLE_DEG:g} degrees from image +X (left to right at 0).'
    manifest=dict(schema_version=1,study='beak',revision=4,size_px=N,seed=SEED,
                  normal_convention='OpenGL +Y (up image); normalize(-dH/dx, +dH/dy_image, 1)',
                  height_units='Linear 16-bit, white high; height_mm is the FULL 0..65535 range.',
                  packed_channels={'R':'height-derived ambient occlusion','G':'roughness','B':'metalness = 0'},
                  dye='Decode sRGB, multiply by linear dye / 0.5, then encode for display.',
                  cutout_note='Opaque beak on transparent backing for placement only; modeller supplies geometry. RGB dilated through transparent pixels. Threshold alpha at 0.5.',
                  normalization_note='Horn uses periodic mean balancing. Side uses global regional mean only: round 3 explicitly removes local quadrant compensation that created false hook/gape shading. Raw quadrant differences are reported, not hidden.',
                  sources=[dict(file='source/horn_r2b_generated.png',method='built-in image_gen edit with own concept reference; untouched original',
                               sha256=hashlib.sha256((ROOT/'source/horn_r2b_generated.png').read_bytes()).hexdigest(),
                               prompt='source/horn_r2b_prompt.txt')],
                  parameters=dict(grain_angle_deg=GRAIN_ANGLE_DEG,grain_scale=GRAIN_SCALE,micro_relief=MICRO_RELIEF,
                                  pore_diameter_mm=[.3,2.0],pore_depth_mm=[.01925,.176],
                                  pore_candidate_retention={'horn':.27,'beak_side_additional':.38},
                                  pore_size_probabilities={'small':.76,'medium':.15,'large_1_to_2_mm':.09},
                                  soft_pore_fraction=.25,
                                  mottle_sigma_mm=[18*HORN_SPAN_M*1000/N,135*HORN_SPAN_M*1000/N],
                                  mottle_linear_sigma=.014),
                  sets={'horn':horn,'beak_side':side},build_seconds=round(time.time()-start,2))
    (ROOT/'study.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({k:{'mean_linear':v['region_mean_linear'],'height_mm':v['used_height_mm']}
                      for k,v in manifest['sets'].items()},indent=2),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--grain-angle',type=float,choices=[0,90,180,270],default=GRAIN_ANGLE_DEG,
                        help='Quarter turns preserve the square tile lattice; use the model UV direction for other angles.')
    parser.add_argument('--grain-scale',type=float,default=GRAIN_SCALE,
                        help='1 for original grain, 0.5 for twice as fine, 1/3 for three times as fine; reciprocal must be integral.')
    parser.add_argument('--micro-relief',type=float,default=MICRO_RELIEF)
    args=parser.parse_args()
    if args.grain_scale<=0 or abs(1/args.grain_scale-round(1/args.grain_scale))>1e-5:
        parser.error('--grain-scale must be the reciprocal of a positive integer to preserve tiling.')
    GRAIN_ANGLE_DEG=args.grain_angle
    GRAIN_SCALE=args.grain_scale
    MICRO_RELIEF=args.micro_relief
    main()
