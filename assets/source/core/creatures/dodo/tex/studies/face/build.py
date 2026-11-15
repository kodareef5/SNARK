"""Rebuild all accepted face-study maps from the two saved source originals.

python3 build.py [--detail-scale 1] [--fold-scale 1] [--pouch-angle 0]
Default arguments must reproduce source/accepted_sha256.json exactly.
Intermediate fold substrate and grain caches are regenerated, never inputs.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
import time

import numpy as np
from PIL import Image, PngImagePlugin
from scipy.ndimage import gaussian_filter, map_coordinates
from scipy.spatial import cKDTree
from scipy.fft import rfft2, irfft2, rfftfreq, fftfreq

ROOT = Path(__file__).resolve().parent
N = 2048
SEED = 186225


def smooth(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def noise(size, sigma, rng):
    a = rng.standard_normal((size, size)).astype(np.float32)
    if sigma > 4:
        fy=fftfreq(size)[:,None];fx=rfftfreq(size)[None,:]
        kernel=np.exp(-2*np.pi**2*sigma**2*(fx*fx+fy*fy)).astype(np.float32)
        a=irfft2(rfft2(a)*kernel,s=(size,size))
    else:
        a=gaussian_filter(a,sigma,mode='wrap')
    a -= a.mean()
    return a / max(float(a.std()), 1e-8)


def cell_field(grain, span_mm, spacing_mm, seed, fine=False, return_fields=False):
    """Periodic rounded polygon cells, with explicit narrow crease pigment.

    Geometric creases and pigment share cell boundaries, never a light vector.
    The supplied generated original provides fine, irregular tissue detail.
    """
    size=grain.shape[0]; mm_px=span_mm/size
    rng=np.random.default_rng(seed)
    count=round(span_mm/spacing_mm)
    points=rng.uniform(0,size,(count*count,2))
    sample_step=2
    sy,sx=np.mgrid[0:size:sample_step,0:size:sample_step].astype(float)
    samples=np.stack((sx.ravel()+sample_step/2,sy.ravel()+sample_step/2),-1)
    for _ in range(3):
        _,owner=cKDTree(points,boxsize=size).query(samples,k=1)
        off=samples-points[owner]; off-=np.rint(off/size)*size
        weights=np.maximum(np.bincount(owner,minlength=len(points)),1)
        shift=np.stack([np.bincount(owner,weights=off[:,k],minlength=len(points))/weights for k in (0,1)],-1)
        points=(points+.83*shift)%size
    yy,xx=np.mgrid[:size,:size].astype(np.float32)
    for dest in (xx,yy):
        dest+=noise(size,spacing_mm*.22/mm_px,rng)*(spacing_mm*(.12 if fine else .032)/mm_px)
        dest+=noise(size,spacing_mm*1.5/mm_px,rng)*(spacing_mm*(.09 if fine else .050)/mm_px)
    query=np.stack((xx.ravel()%size,yy.ravel()%size),-1)
    ds,ix=cKDTree(points,boxsize=size).query(query,k=4,workers=1)
    nearest=points[ix[:,0]];edge=np.full(len(query),np.inf)
    for k in (1,2,3):
        between=points[ix[:,k]]-nearest;between-=np.rint(between/size)*size
        sep=np.linalg.norm(between,axis=-1)
        edge=np.minimum(edge,(ds[:,k]**2-ds[:,0]**2)/(2*sep))
    edge=(edge*mm_px).reshape(size,size).astype(np.float32)
    variation=rng.uniform(-1,1,len(points))[ix[:,0]].reshape(size,size).astype(np.float32)
    scale=spacing_mm/(2.05 if fine else 1.18)
    e=edge/scale
    if fine:
        # Sparse, hairline reticulation on an almost level satin surface.
        # Cell size is independent of line width and relief.
        crease=np.exp(-(e/.042)**2)
        crown=1-np.exp(-(e/.21)**2)
        h=.018*crown*(1+.18*variation)-.015*crease+grain*.0010
        drawing=.005*crown-.048*crease+.0025*variation+.0018*grain
    else:
        # Overlapping round tissue domes meet at narrow valleys. Taking their
        # envelope preserves circular crown curvature; a normalized polygon
        # distance instead makes little facets, even when its outline is soft.
        radii=np.sqrt(weights*sample_step**2/np.pi)*mm_px
        radii=np.clip(radii,.40*scale,.90*scale)
        scores=np.exp(-(ds*mm_px/(radii[ix]*.87))**2).astype(np.float32)
        territory_owner=ix[np.arange(len(ix)),np.argmax(scores,axis=1)]
        ordered=np.sort(scores,axis=1)
        crown=ordered[:,-1].reshape(size,size)
        gap=(ordered[:,-1]-ordered[:,-2]).reshape(size,size)
        crease=np.exp(-(gap/.055)**2)
        h=.245*crown-.005*crease+grain*.0018*(.4+.6*crown)
        drawing=.145*crown-.025*crease+.004*variation+.003*grain
    h=gaussian_filter(h,.48 if fine else .48,mode='wrap').astype(np.float32);h-=h.mean()
    drawing=gaussian_filter(drawing,.40,mode='wrap').astype(np.float32)
    if fine:
        territory_owner=ix[:,0]
    territory_area=np.bincount(territory_owner,minlength=len(points))
    equivalent_diameters=2*np.sqrt(territory_area/np.pi)*mm_px
    layout=dict(nominal_centre_spacing_mm=spacing_mm,
        cell_count=len(points),equivalent_cell_diameter_p10_p50_p90_mm=np.percentile(equivalent_diameters,[10,50,90]).tolist(),
        crease_width_mm=.084*scale if fine else .086*scale,
        diameter_measurement='Equivalent-circle diameter of the delivered warped dome/cell territory; crease width is nominal before pixel filtering')
    if return_fields:
        return h,drawing,layout,dict(crown=crown,edge=edge,variation=variation,polygon_owner=ix[:,0])
    return h,drawing,layout


def save_png(path, a, srgb=False):
    info = PngImagePlugin.PngInfo()
    if srgb:
        info.add(b'sRGB', b'\x00')
        info.add(b'gAMA', (45455).to_bytes(4, 'big'))
    else:
        info.add(b'gAMA', (100000).to_bytes(4, 'big'))
    info.add_text('Description', 'Dodo face study. ' + ('Unlit sRGB pigment; alpha is linear blend coverage.' if srgb else 'Linear material data. See study.json.'))
    Image.fromarray(a).save(ROOT / path, pnginfo=info)


def q8(a):
    return np.clip(np.rint(a * 255), 0, 255).astype(np.uint8)


def linear_to_srgb(a):
    return np.where(a <= .0031308, 12.92*a, 1.055*np.maximum(a, 0)**(1/2.4)-.055)


def srgb_to_linear(a):
    return np.where(a <= .04045, a/12.92, ((a+.055)/1.055)**2.4)


def shortest_seam(cost):
    """A vertical minimum-cost path through an overlap, one column per row."""
    h, w = cost.shape
    acc = cost[0].copy()
    parent = np.empty((h, w), np.int8)
    for y in range(1, h):
        padded = np.pad(acc, (1, 1), constant_values=np.inf)
        choices = np.stack((padded[:w], padded[1:w+1], padded[2:]))
        choice = choices.argmin(axis=0)
        parent[y] = choice-1
        acc = cost[y] + choices[choice, np.arange(w)]
    path = np.empty(h, np.int32)
    path[-1] = acc.argmin()
    for y in range(h-1, 0, -1):
        path[y-1] = path[y] + parent[y, path[y]]
    return path


def source_grain(name, source_span_mm, span_mm, detail_scale):
    """Remove broad source tone, then reconstruct a restrained relief field.

    The generated scan supplies neutral fine tissue variation to height and base; normals are always derived from delivered height.
    High-frequency microtopography is preserved, not a tiled colour photo.
    """
    src = np.asarray(Image.open(ROOT/'source'/name).convert('L'), np.float32)/255
    px_mm = src.shape[0] / source_span_mm
    src = gaussian_filter(src, .65)
    src -= gaussian_filter(src, px_mm*3, mode='reflect')
    src /= max(float(src.std()), 1e-8)
    src = np.tanh(src/2.4)*2.4
    target = max(180, round(source_span_mm * N/span_mm * detail_scale))
    src = np.asarray(Image.fromarray(src).resize((target, target), Image.Resampling.LANCZOS), np.float32)
    return src


def quilt(src, seed, cells=8, overlap=64):
    """Minimum-error quilting on a torus, including both closing overlaps.

    Last-column/right and last-row/bottom seams join existing first patches.
    No opposite-edge copying, blurred wrap strip, or mirrored border is used.
    """
    rng = np.random.default_rng(seed)
    stride = N//cells
    width = stride+overlap
    if src.shape[0] < width+4:
        src = np.asarray(Image.fromarray(src).resize((width+48, width+48), Image.Resampling.LANCZOS))
    variants = [np.ascontiguousarray(np.rot90(src, k)) for k in range(4)]
    variants += [np.fliplr(a).copy() for a in variants]
    out = np.zeros((N, N), np.float32)
    known = np.zeros((N, N), bool)
    for row in range(cells):
        for col in range(cells):
            yy = (row*stride+np.arange(width)) % N
            xx = (col*stride+np.arange(width)) % N
            old = out[np.ix_(yy, xx)]
            mask = known[np.ix_(yy, xx)]
            best, best_score = None, np.inf
            for _ in range(28):
                variant = variants[int(rng.integers(8))]
                sy, sx = rng.integers(0, variant.shape[0]-width+1, 2)
                candidate = variant[sy:sy+width, sx:sx+width]
                # Subsample matching only; seams use every source pixel.
                d = (candidate[::2, ::2]-old[::2, ::2])[mask[::2, ::2]]
                score = float(np.mean(d*d)) if d.size else 0
                if score < best_score:
                    best_score, best = score, candidate.copy()
            error = gaussian_filter((best-old)**2, .7)
            take = np.ones_like(old)
            if col > 0:
                p = shortest_seam(error[:, :overlap])
                take[:, :overlap] *= np.arange(overlap)[None, :] > p[:, None]
            if col == cells-1:
                p = shortest_seam(error[:, -overlap:])
                take[:, -overlap:] *= np.arange(overlap)[None, :] < p[:, None]
            if row > 0:
                p = shortest_seam(error[:overlap, :].T)
                take[:overlap, :] *= np.arange(overlap)[:, None] > p[None, :]
            if row == cells-1:
                p = shortest_seam(error[-overlap:, :].T)
                take[-overlap:, :] *= np.arange(overlap)[:, None] < p[None, :]
            take[~mask] = 1
            take = gaussian_filter(take, .65, mode='nearest')
            out[np.ix_(yy, xx)] = old*(1-take)+best*take
            known[np.ix_(yy, xx)] = True
    assert known.all()
    # Soft continuous domain warp breaks up the patch grid and varies grain.
    yy, xx = np.mgrid[:N, :N].astype(np.float32)
    warp_x = noise(N, 50, rng)*3.5
    warp_y = noise(N, 61, rng)*3.5
    out = map_coordinates(out, [yy+warp_y, xx+warp_x], order=3, mode='grid-wrap')
    out -= gaussian_filter(out, 45, mode='wrap')
    out /= out.std()
    return gaussian_filter(out, .4, mode='wrap')


def normal_from_mm(h_mm, span_mm):
    step = span_mm / h_mm.shape[0]
    dx = (np.roll(h_mm, -1, 1)-np.roll(h_mm, 1, 1))/(2*step)
    dy = (np.roll(h_mm, -1, 0)-np.roll(h_mm, 1, 0))/(2*step)
    vec = np.stack((-dx, dy, np.ones_like(dx)), axis=-1)
    return vec/np.linalg.norm(vec, axis=-1, keepdims=True)


def ambient_occlusion(h, span_mm):
    """Eight equal azimuth horizons: nondirectional local height-field AO."""
    step = span_mm/N
    occ = np.zeros_like(h)
    for dx, dy in [(1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)]:
        horizon = np.zeros_like(h)
        for r in (1, 2, 4, 8, 16, 32):
            nearby = np.roll(h, (dy*r, dx*r), (0,1))
            slope = np.maximum(nearby-h-.004, 0)/(r*step*math.hypot(dx, dy))
            horizon = np.maximum(horizon, np.arctan(slope))
        occ += np.sin(horizon)/8
    return np.clip(1-.48*occ, .70, 1)


def pigment(drawing, h, span_mm):
    """Preserve crease-floor/crown value; remove residual directional bias.

    Unlike round one, input is anatomical pigment rather than featureless noise.
    The small normal-component fit only removes chance directional correlations.
    """
    p=drawing.astype(np.float32).copy();p-=p.mean()
    norm=normal_from_mm(h,span_mm)
    f=norm.reshape(-1,3).astype(np.float64);f-=f.mean(axis=0)
    coef=np.linalg.lstsq(f[::4],p.reshape(-1)[::4],rcond=None)[0]
    p-=np.sum(f*coef,axis=-1).reshape(N,N).astype(np.float32)
    p-=p.mean()
    return q8(linear_to_srgb(.5+p))


def overlay_pigment(value, h, span_mm, support):
    """Remove small orientation bias inside the overlay only.

    Centred, coverage-weighted normal components leave mean pigment and every
    zero-alpha texel intact. No lighting direction is selected or baked in.
    """
    n=normal_from_mm(h,span_mm).reshape(-1,3).astype(np.float64)
    a=support.reshape(-1).astype(np.float64)
    weighted_mean=(n*a[:,None]).sum(axis=0)/a.sum()
    f=(n-weighted_mean)*a[:,None]
    c=n-n.mean(axis=0)
    p=value.reshape(-1).astype(np.float64)
    # Explicit reductions avoid a large strided BLAS product and its spurious
    # floating-point status warnings on some Apple Accelerate builds.
    matrix=np.array([[np.sum(c[:,i]*f[:,j]) for j in range(3)] for i in range(3)])
    rhs=np.array([np.sum(c[:,i]*(p-p.mean())) for i in range(3)])
    coef=np.linalg.solve(matrix,rhs)
    result=p-np.sum(f*coef,axis=1)
    assert np.isfinite(result).all()
    return result.reshape(N,N).astype(np.float32)


def write_set(name, h, span_m, height_mm, region, rough, alpha=None, base=None):
    assert h.min()>-height_mm/2 and h.max()<height_mm/2, (name,"height encoding would clip")
    encoded = np.clip(np.rint((.5+h/height_mm)*65535), 0, 65535).astype(np.uint16)
    save_png(name+'_height.png', encoded)
    # Decode the actual delivered height. All normals and AO use this value.
    h = (encoded.astype(np.float32)/65535-.5)*height_mm
    norm = normal_from_mm(h, span_m*1000)
    save_png(name+'_normal.png', q8(norm*.5+.5))
    if base is None:
        raise ValueError('Every set requires its own structural base drawing')
    rgb = np.repeat(base[..., None], 3, axis=2)
    if alpha is not None:
        rgb = np.dstack((rgb, alpha))
    save_png(name+'_base.png', rgb, srgb=True)
    ao = ambient_occlusion(h, span_m*1000)
    packed = np.dstack((q8(ao), q8(rough), np.zeros((N,N), np.uint8)))
    save_png(name+'_packed.png', packed)
    regions = np.zeros((N,N,3), np.uint8)
    regions[:] = (0,255,0) if region == 1 else (0,255,255)
    save_png(name+'_regions.png', regions)
    mean = float(srgb_to_linear(base.astype(np.float64)/255).mean())
    return dict(span_m=span_m, tiles=True, cutout=False, height_mm=height_mm,
                height_zero=.5, actual_relief_mm=[float(h.min()),float(h.max())],
                regions=[region], mean_linear_grey={str(region):mean},
                mean_srgb_grey=float(base.mean()),
                roughness_min_mean_max=[float(rough.min()),float(rough.mean()),float(rough.max())],
                maps={k:f'{name}_{k}.png' for k in ['base','height','normal','packed','regions']}), h, base


def curve_field(shape, points, amplitude, crease_depth, mm_px, width_mm=1.0, side=1):
    """An elliptic fleshy roll beside a narrow deep crease, in millimetres."""
    yy, xx = np.mgrid[:shape[0], :shape[1]]
    query = np.stack((xx.ravel(), yy.ravel()), axis=-1)
    dist, index = cKDTree(points).query(query, workers=1)
    tangent = np.gradient(points, axis=0)
    tangent /= np.linalg.norm(tangent, axis=-1, keepdims=True)
    right = np.stack((-tangent[:,1], tangent[:,0]), axis=-1)
    diff = query-points[index]
    sign = np.sign(np.sum(diff*right[index], axis=-1))
    d = (side*dist*sign*mm_px).reshape(shape)
    u = (index/(len(points)-1)).reshape(shape)
    taper=.10 if side<0 else .20
    ends = smooth(u/taper)*smooth((1-u)/taper)
    radius=width_mm*.5
    cap=np.sqrt(np.maximum(1-((d-radius)/radius)**2,0))
    cap=gaussian_filter(cap,.13/mm_px)
    crease=np.exp(-(d/max(.18,width_mm*.085))**2)
    relief=(amplitude*cap-crease_depth*crease)*ends
    # Broad, smooth support taper leaves the underlying skin exactly intact.
    coverage=smooth((width_mm*1.9-np.abs(d-radius))/(width_mm*.70))*smooth(u/.07)*smooth((1-u)/.10)
    drawing=(-.19*crease+.024*cap)*ends
    return relief.astype(np.float32), coverage.astype(np.float32), drawing.astype(np.float32)


def bezier(points, n=500):
    p = np.asarray(points)
    t = np.linspace(0,1,n)[:,None]
    return (1-t)**3*p[0]+3*(1-t)**2*t*p[1]+3*(1-t)*t*t*p[2]+t**3*p[3]


def make_folds(skin, scale=1):
    delta = np.zeros((N,N), np.float32)
    alpha = np.zeros_like(delta)
    drawing = np.zeros_like(delta)
    mm_px = 205/N
    elements = []

    def add(name, box, curves, root, tip, kind):
        x0,y0,x1,y1=box
        shape=(y1-y0,x1-x0)
        field=np.zeros(shape,np.float32)
        negative=np.zeros(shape,np.float32)
        coverage=np.zeros(shape,np.float32)
        ink=np.zeros(shape,np.float32)
        for points, amp, dep, width, side in curves:
            # Scaling acts about the centre of this element, not the whole atlas.
            centre=np.array([shape[1]/2,shape[0]/2])
            points=(points-centre)*scale+centre
            h,a,p=curve_field(shape,points,amp,dep,mm_px,width*scale,side)
            # Where arcs converge near the corners, flesh joins as one mass;
            # it must not add four overlapping rolls into a tall spike.
            field=np.maximum(field,np.maximum(h,0))
            negative=np.minimum(negative,np.minimum(h,0))
            ink+=p
            coverage=np.maximum(coverage,a)
        yy,xx=np.mgrid[:shape[0],:shape[1]]
        border=np.minimum.reduce([xx,yy,shape[1]-1-xx,shape[0]-1-yy])
        envelope=smooth((border-12)/28)
        coverage=gaussian_filter(coverage,4.0)*envelope
        # Soften the tissue junctions after joining intersecting arcs. This
        # removes knife-like lips while retaining the deep crease and volume.
        field=gaussian_filter(field+negative,.20/mm_px)*envelope
        # Support ends inside the box; every map is plain skin on its perimeter.
        field[coverage < 1/255] = 0
        ink*=envelope
        ink[coverage < 1/255] = 0
        drawing[y0:y1,x0:x1]=ink
        delta[y0:y1,x0:x1]=field
        alpha[y0:y1,x0:x1]=coverage
        global_centre=np.array([x0+shape[1]/2,y0+shape[0]/2])
        root=np.rint((np.array(root)-global_centre)*scale+global_centre).astype(int).tolist()
        tip=np.rint((np.array(tip)-global_centre)*scale+global_centre).astype(int).tolist()
        elements.append(dict(name=name,box_px=box,root_px=root,tip_px=tip,kind=kind,
                             opacity='folds_alpha.png',box_convention='[left, top, right, bottom), origin top-left'))

    t=np.linspace(np.pi-.18,.18,650)
    curves=[]
    for i in range(4):
        a,b=107+i*8,42+i*38
        points=np.stack([384+a*np.cos(t),200+b*np.sin(t)],axis=-1)
        curves.append((points, [3.20,2.85,2.55,2.20][i], [.80,.74,.68,.60][i], [3.50,3.25,3.05,2.85][i], 1))
    add('under_eye_four_folds',[80,80,848,848],curves,[359,288],[569,288],
        'Four concentric lower-eye rolls, top heaviest: 3.50/3.25/3.05/2.85 mm elliptic profiles, 3.20/2.85/2.55/2.20 mm peak elevation, deep upper creases, 3.80 mm centre-path spacing. Eye centre [464,280]. Mirror/rotate along the face.')
    elements[-1].update(roll_width_mm=[3.50,3.25,3.05,2.85],roll_amplitude_mm=[3.20,2.85,2.55,2.20],crease_depth_mm=[.80,.74,.68,.60],centre_path_pitch_mm=38*mm_px)
    mouth=bezier([[275,270],[424,250],[422,405],[342,414]])
    add('mouth_corner_downturn',[1120,80,1888,848],[(mouth,3.10,.90,4.0,-1)],
        [1395,350],[1462,494], 'Downturned 4 mm rounded crescent standing 3.1 mm proud, with a 0.9 mm deep crease on its inner side; no black mouth interior.')
    elements[-1].update(roll_width_mm=4.0,roll_amplitude_mm=3.10,crease_depth_mm=.90,crease_side='inner / left of the descending roll')
    specs=[('crease_long',[80,1120,656,1696],[[75,236],[200,299],[372,204],[501,261]],.38,.16,.85),
           ('crease_medium',[736,1072,1312,1648],[[136,255],[242,218],[342,335],[437,287]],.30,.14,.73),
           ('crease_short',[1408,1280,1984,1856],[[197,250],[253,304],[316,230],[383,280]],.22,.115,.64)]
    for name,box,pts,amp,depth,width in specs:
        add(name,box,[(bezier(pts),amp,depth,width,1)],
            [box[0]+pts[0][0],box[1]+pts[0][1]],
            [box[0]+pts[-1][0],box[1]+pts[-1][1]], 'Single soft crease; start=root and end=tip, not feather semantics.')
    return skin+delta, delta, q8(alpha), elements, drawing


def make_pouch(grain, angle):
    rng=np.random.default_rng(SEED+3)
    yy,xx=np.mgrid[:N,:N].astype(np.float32)/N
    theta=math.radians(angle)
    count=128
    kx=int(round(count*math.sin(theta)));ky=int(round(count*math.cos(theta)))
    period=math.gcd(abs(kx),abs(ky))
    # Independent widths/depths per roll, repeated periodically, no identical rows.
    widths=rng.uniform(.96,1.04,period);widths*=period/widths.sum()
    bounds=np.r_[0,np.cumsum(widths)]
    s=kx*xx+ky*yy+.13
    s+=.020*np.sin(2*np.pi*(2*xx+3*yy))+.012*np.sin(2*np.pi*(5*xx-2*yy))
    s+=.009*noise(N,30,rng)
    phase=np.interp(s%period,bounds,np.arange(period+1)).astype(np.float32)
    amps=rng.uniform(.92,1.08,period)
    depth=np.interp((phase+.5)%period,np.arange(period+1),np.r_[amps,amps[0]])
    depth*=1+.012*np.sin(2*np.pi*(3*xx+7*yy))
    valley=(phase%1)-.5
    crease=np.exp(-(valley/.055)**2)
    position=((phase+.5)%1)-.5
    cap=np.sqrt(np.maximum(1-(2*position)**2,0))
    profile=.48*cap-.09*crease
    h=profile*depth
    h=gaussian_filter(h,.45,mode='wrap')
    drawing=.030*cap-.100*crease
    branches=[]
    if kx==0 and ky==count:
        # Over a short interval, replace a single trough with two troughs.
        # They join at both ends; the intervening ridge grows and dies as flesh.
        for x0,p0,length in [(143,16.5,260),(1070,9.5,235),(650,39.5,190),
                             (1590,57.5,220),(285,74.5,245),(1050,88.5,175),(1540,102.5,270)]:
            u=np.clip((xx*N-x0)/length,0,1)
            fade=np.sin(np.pi*u)**2
            d=(phase-p0)*(256/count)
            spread=.38*fade
            original=np.exp(-(d/.16)**2)
            pair=np.maximum(np.exp(-((d-spread)/.12)**2),np.exp(-((d+spread)/.12)**2))
            h+=.27*fade*original-.21*fade*pair
            drawing+=.095*fade*original-.095*fade*pair
            branches.append(dict(x_start_px=x0,length_px=length,phase_start=p0,max_fork_width_mm=.76))
    # Fine isotropic tissue, not directional strings/corduroy.
    tissue=noise(N,.7,rng)
    h+=.0060*tissue+.0020*grain
    drawing+=.0060*tissue+.0020*grain
    h=h.astype(np.float32);h-=h.mean()
    return h,drawing.astype(np.float32),dict(pleat_count=math.hypot(kx,ky),
        wave_vector=[kx,ky],nominal_pitch_mm=256/math.hypot(kx,ky),
        row_variation_period_cycles=period,
        prescribed_row_pitch_min_max_mm=[float(widths.min()*256/math.hypot(kx,ky)),float(widths.max()*256/math.hypot(kx,ky))],
        prescribed_row_depth_factor_min_max=[float(amps.min()),float(amps.max())],
        requested_angle_deg=angle,actual_angle_deg=math.degrees(math.atan2(kx,ky)),branches=branches)


def packed_skin(grain, detail_scale=1):
    """Keep round 3's dome crowns; extend only their flanks to shared edges."""
    _,_,layout,fields=cell_field(grain,205,1.18*detail_scale,SEED+61,return_fields=True)
    crown=fields['crown']
    edge=fields['edge']
    # A narrow shared Voronoi boundary partitions the entire surface. It is
    # never a band of flat skin between isolated radial bumps.
    crease=np.exp(-(edge/(.060*detail_scale))**2)
    shoulder=1-np.exp(-(edge/(.105*detail_scale))**2)
    flank=smooth((.80-crown)/.30)*(1-crown)*shoulder
    h=.245*crown+.090*flank-.012*crease
    h+=grain*.0018*(.4+.6*crown)
    h=gaussian_filter(h,.48,mode='wrap').astype(np.float32);h-=h.mean()
    drawing=.145*crown+.045*flank-.065*crease+.004*fields['variation']+.003*grain
    drawing=gaussian_filter(drawing,.35,mode='wrap').astype(np.float32)
    territory_area=np.bincount(fields['polygon_owner'],minlength=layout['cell_count'])
    diameters=2*np.sqrt(territory_area/np.pi)*(205/N)
    layout.update(equivalent_cell_diameter_p10_p50_p90_mm=np.percentile(diameters,[10,50,90]).tolist(),
        crease_width_mm=2*np.sqrt(np.log(2))*.060*detail_scale,
        diameter_measurement='Equivalent-circle diameter of shared polygon territory; same seeds and domed crown profile as round 3',
        crease_width_measurement='Authored full width at half maximum before subpixel antialias filtering',
        contact='All pixels belong to a pebble cell or its shared narrow crease; lower flanks extend to every cell boundary')
    return h,drawing,layout


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--detail-scale',type=float,default=1)
    ap.add_argument('--fold-scale',type=float,default=1)
    ap.add_argument('--pouch-angle',type=float,default=0)
    ap.add_argument('--reuse-grain',action='store_true',help='Reuse disposable exact grain arrays from a prior build with this detail scale')
    args=ap.parse_args()
    if not .7 <= args.detail_scale <= 1.4 or not .7 <= args.fold_scale <= 1.2:
        ap.error('detail-scale must be .7–1.4; fold-scale .7–1.2 to stay inside sheet boxes')
    start=time.time()
    rng=np.random.default_rng(SEED)
    print('Quilting face source on a torus...',flush=True)
    cache=ROOT/'checks';cache.mkdir(exist_ok=True)
    def get_grain(name,source_mm,span_mm,seed):
        key=hashlib.sha256((name+str(args.detail_scale)+str(seed)).encode()+(ROOT/'source'/name).read_bytes()).hexdigest()[:12]
        path=cache/('grain_'+key+'.npy')
        if args.reuse_grain and path.exists():
            return np.load(path)
        g=quilt(source_grain(name,source_mm,span_mm,args.detail_scale),seed)
        np.save(path,g)
        return g
    grain=get_grain('skin_relief_original.png',60,205,SEED)
    skin_h,skin_drawing,skin_layout=cell_field(grain,205,1.18*args.detail_scale,SEED+61)
    rough=np.clip(.49+.018*noise(N,10,rng)+.010*np.tanh(-grain),.43,.56)
    skin,skin_saved,skin_base=write_set('skin',skin_h,.205,8.0,1,rough,base=pigment(skin_drawing,skin_h,205))
    skin.update(skin_layout)
    skin['feature_scale_mm']='Rounded, close-packed domes; nominal 1.18 mm packing, approximately 1.3 mm median cell diameter. Narrow, light crease floors; pale rounded crowns. Sample at 0.75–0.85 lateral scale toward eye/beak.'
    # Reconstruct the accepted fold substrate before replacing standalone skin.
    reference=ROOT/'fields/fold_reference_skin'
    reference.mkdir(parents=True,exist_ok=True)
    for key in ('base','height','normal','packed','regions'):
        (reference/('skin_'+key+'.png')).write_bytes((ROOT/('skin_'+key+'.png')).read_bytes())
    print('Building five fold elements...',flush=True)
    folds_h,delta,alpha,elements,fold_drawing=make_folds(skin_saved,args.fold_scale)
    # Centre the additional drawing only within the overlay; alpha-zero RGB
    # remains byte-for-byte equal to plain skin, including all box boundaries.
    support=alpha.astype(np.float32)/255
    yy,xx=np.mgrid[:N,:N].astype(np.float32)
    coords=[yy*1.15,xx*1.15]
    crease_weight=smooth(np.maximum(-delta,0)/.50)
    fine_skin=map_coordinates(skin_saved,coords,order=1,mode='grid-wrap')
    finest_skin=map_coordinates(skin_saved,[yy*1.90,xx*1.90],order=1,mode='grid-wrap')
    fine_skin=fine_skin*(1-crease_weight)+finest_skin*.40*crease_weight
    delta+=support*(fine_skin*.68-skin_saved)
    folds_h=skin_saved+delta
    skin_lin=srgb_to_linear(skin_base.astype(np.float32)/255)
    fine_base=map_coordinates(skin_lin,coords,order=1,mode='grid-wrap')
    finest_base=map_coordinates(skin_lin,[yy*1.90,xx*1.90],order=1,mode='grid-wrap')
    fine_base=fine_base*(1-crease_weight)+(.5+(finest_base-.5)*.5)*crease_weight
    fold_drawing+=support*(.5+(fine_base-.5)*.75-skin_lin)
    fold_drawing-=support*(fold_drawing.sum()/support.sum())
    folds_linear=overlay_pigment(skin_lin+fold_drawing,folds_h,205,support)
    folds_base=q8(linear_to_srgb(folds_linear))
    folds_base[alpha==0]=skin_base[alpha==0]
    folds,folds_saved,_=write_set('folds',folds_h,.205,8.0,1,rough,alpha=alpha,base=folds_base)
    save_png('folds_alpha.png',alpha)
    # Exact zero in unsigned16 uses 32768; mm = (sample-32768)/65535*8.
    delta16=np.clip(np.rint(delta/8*65535)+32768,0,65535).astype(np.uint16)
    save_png('folds_delta_height.png',delta16)
    # Convenience extracts preserve every aligned layer at the exact atlas scale.
    for element in elements:
        folder=ROOT/'elements'/element['name']
        folder.mkdir(parents=True,exist_ok=True)
        element['files']={}
        for key in ['base','height','normal','packed','regions','alpha','delta_height']:
            a=np.asarray(Image.open(ROOT/f'folds_{key}.png'))
            x0,y0,x1,y1=element['box_px']
            filename=f'elements/{element["name"]}/{key}.png'
            save_png(filename,a[y0:y1,x0:x1],srgb=key=='base')
            element['files'][key]=filename
        element['span_m']=(element['box_px'][2]-element['box_px'][0])/N*.205
        element['height_mm']=8.0
        element['local_root_px']=[element['root_px'][0]-x0,element['root_px'][1]-y0]
        element['local_tip_px']=[element['tip_px'][0]-x0,element['tip_px'][1]-y0]
    folds.update(tiles=False,cutout=False,alpha_mode='continuous layer opacity; never alpha-test',
                 alpha='folds_alpha.png',delta_height='folds_delta_height.png',
                 delta_decode='millimetres = (uint16 - 32768) * 8 / 65535',elements=elements,
                 composition='At matching UVs, mix skin and folds maps with folds_alpha; normalize normals. Delta height includes the roll and local finer-skin transition relative to this exact skin tile. For arbitrary placement, alpha-blend the complete height/base patch into destination skin at matching density, then derive normals and AO. RGB and height equal plain skin at alpha=0; all maps equal skin on box borders.')
    print('Quilting fine brow grain...',flush=True)
    browgrain=get_grain('brow_relief_original.png',48,256,SEED+1)
    brow_h,brow_drawing,brow_layout=cell_field(browgrain,256,2.05*args.detail_scale,SEED+92,fine=True)
    roughb=np.clip(.345+.012*noise(N,7,rng)+.008*np.tanh(-browgrain),.30,.40)
    brow,_,_=write_set('brow',brow_h,.256,.3,3,roughb,base=pigment(brow_drawing,brow_h,256))
    brow.update(brow_layout)
    brow['feature_scale_mm']='Sparse, faint hairline reticulation enclosing approximately 1.5–3 mm irregular cells. Barely raised satin grain; large brow shelf belongs to the mesh.'
    print('Building transverse pouch pleats...',flush=True)
    pouch_h,pouch_drawing,pouch_layout=make_pouch(np.roll(browgrain,(517,217),(0,1)),args.pouch_angle)
    roughp=np.clip(.47+.015*noise(N,8,rng)+.009*np.tanh(-browgrain),.41,.54)
    # Circular translation changes only the torus origin; it does not blend,
    # flatten, duplicate or repair any border samples.
    pouch_h=np.roll(pouch_h,-300,axis=0)
    pouch_drawing=np.roll(pouch_drawing,-300,axis=0)
    roughp=np.roll(roughp,-300,axis=0)
    pouch_layout['tile_origin_translation_px']=[0,-300]
    pouch,_,_=write_set('pouch',pouch_h,.256,1.6,3,roughp,base=pigment(pouch_drawing,pouch_h,256))
    pouch.update(pouch_layout)
    print('Building accepted touching-cell skin...',flush=True)
    h,drawing,layout=packed_skin(grain,args.detail_scale)
    skin,_,_=write_set('skin',h,.205,8.0,1,rough,base=pigment(drawing,h,205))
    skin.update(layout)
    skin['feature_scale_mm']='Round 3 crown size and curvature, with full touching polygonal flanks and a continuous approximately 0.10 mm crease network. Finer sampling toward the eye/beak remains a placement choice.'
    meta=dict(study='face',round=4,schema_version=1,seed=SEED,resolution=N,
              normal_convention='OpenGL +Y; pixel y increases downward. N=normalize(-dh/dx,+dh/dy,1), derivatives in mm/mm using wrapped central differences of the delivered 16-bit height.',
              height_encoding='All regular height maps: millimetres=(uint16/65535 - 0.5)*height_mm. White is high; zero is the nominal plane. height_mm is the full 0–65535 range, not the used range.',
              packed_channels={'R':'linear ambient occlusion (1=unoccluded)','G':'linear perceptual roughness','B':'metalness (zero)'},
              colour_space={'base':'sRGB, RGB channels equal, continuous alpha linear','height_normal_packed_regions_alpha':'linear data'},
              dye='Decode base to linear, multiply by linear dye / 0.50; then light. Default skin/folds #DDA089, brow/pouch #C49C58.',
              region_ring='Each standalone sheet has one pure region. Final atlas joins must add >=4 px black undyed creases at 2048 between non-neighbour regions, as COMMON.md specifies.',
              build_arguments=vars(args),sets={'skin':skin,'folds':folds,'brow':brow,'pouch':pouch},
              provenance={'image_tool':'built-in image_gen; originals copied unchanged from automatic tool cache',
                          'sources':{p.name:dict(sha256=hashlib.sha256(p.read_bytes()).hexdigest(),size_px=list(Image.open(p).size)) for p in (ROOT/'source').glob('*.png')},
                          'prompts':['source/skin_prompt.txt','source/brow_prompt.txt'],
                          'source_roles':{'skin_relief_original.png':'Micrograin only; rounded pebble geometry is reconstructed procedurally.',
                                          'brow_relief_original.png':'Low-amplitude tissue detail only; brow polygon grain and pouch pleats reconstructed at physical scale.'}},
              build_seconds=round(time.time()-start,2))
    meta.update(accepted_asset_hashes='source/accepted_sha256.json',
        folds_reference_skin={k:'fields/fold_reference_skin/skin_'+k+'.png' for k in ['base','height','normal','packed','regions']},
        folds_placement_note='Accepted folds retain their original substrate, regenerated under fields/fold_reference_skin. Blend their complete height/base patch with continuous alpha onto the revised skin, then derive normals/AO; do not treat their delta as relative to the standalone skin.')
    if args.detail_scale==1 and args.fold_scale==1 and args.pouch_angle==0:
        accepted=json.loads((ROOT/'source/accepted_sha256.json').read_text())
        mismatches=[p for p,digest in accepted.items() if hashlib.sha256((ROOT/p).read_bytes()).hexdigest()!=digest]
        if mismatches:
            raise RuntimeError('Accepted rebuild differs: '+', '.join(mismatches))
        meta['accepted_rebuild']=dict(png_count=len(accepted),sha256_exact=True)
        print('All '+str(len(accepted))+' delivered PNGs match accepted SHA-256 hashes.',flush=True)
    (ROOT/'study.json').write_text(json.dumps(meta,indent=2)+'\n')
    print(json.dumps(dict(seconds=meta['build_seconds'],sets={k:dict(mean=v['mean_linear_grey'],relief=v['actual_relief_mm']) for k,v in meta['sets'].items()}),indent=2))


if __name__=='__main__':
    main()
