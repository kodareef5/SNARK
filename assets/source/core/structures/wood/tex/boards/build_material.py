"""Rebuild the 3 m weatherboard material from frozen native-resolution sources.

No network calls. python3 build_material.py && python3 check_material.py
All paths are relative to this script; Pillow, NumPy and SciPy are required.
"""
from pathlib import Path
import json
import time
import hashlib
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, gaussian_filter1d, map_coordinates

ROOT = Path(__file__).resolve().parent
N = 2048
MM_PER_PIXEL = 3000 / N
HEIGHT_RANGE_MM = 12.0
PITCH = N / 12
ROLL_X = 512
ROLL_Y = 85
SEED = 428901
TARGETS = np.array([
    [153,113,69], [146,106,63], [154,113,73], [143,101,64],
    [158,133,105], [149,108,66], [124,86,55], [153,129,100],
    [142,100,61], [122,85,55], [138,113,86], [131,106,80]], dtype=float)
# Pass 4: translate each board's pigment by a constant sRGB-code offset, after
# all wood figure/weathering and before coverage blending and iron. No contrast
# scaling or spatial filtering: within-board RGB differences remain unchanged.
# Retained as the pass 4 baseline beneath the pass 6 unlit-palette offsets.
BOARD_COLOUR_OFFSETS = np.array([
    [-7.424,-1.129,4.930], [-.540,2.478,5.193], [-7.734,-2.159,2.882],
    [-1.944,3.157,7.589], [-6.393,-13.283,-21.888], [-4.313,1.669,7.212],
    [8.532,10.419,12.445], [-3.123,-10.377,-17.551], [2.070,4.602,6.489],
    [8.311,9.840,11.622], [4.173,-4.136,-11.270], [7.754,-1.230,-8.509]])
# Pass 6: DESIGN.md, Material palette (8-bit sRGB, not painted sunlight).
# B=(172,128,82), B-=(160,117,75), B+=(184,141,96). Keep 80% of pass 4's
# centred board-mean RGB differences: one species, quieter course variation.
# Frozen offsets = (B - pass4_global_mean) - .20 * (pass4_board_mean -
# pass4_global_mean), measured on pixel-centre-assigned rows of its saved PNG.
# Translate only: no scaling/filtering of fibres, figure, knots or weathering.
# Apply before fractional edge coverage, rust and iron; no new random draws.
UNLIT_COLOUR_OFFSETS = np.array([
    [31.045412,24.896737,11.645318], [31.227984,25.706628,12.896322],
    [30.932225,25.132581,11.283956], [32.114326,26.571372,12.221568],
    [30.315702,23.735386,10.159606], [31.668123,25.711635,12.116646],
    [34.128860,28.381994,13.280124], [30.520481,23.836616,10.190597],
    [31.729551,26.665167,13.188242], [34.088216,28.285742,13.108340],
    [32.743671,26.161682,11.744250], [33.466781,26.887795,12.147433]])
BASE_MEAN_SRGB = np.array([172.,128.,82.])
# Colour-only controls. Do not consume the physical surface's random stream.
FIGURE_STRENGTH = [1.45,.06,1.65,.10,.22,1.50,.08,.05,.35,1.30,.10,.22]
LATEWOOD_CONTRAST = [29,39,27,38,31,28,40,35,38,30,37,35]
CHARACTER = [
    'flat-sawn / amber / sheltered', 'quarter-sawn / honey / sheltered',
    'flat-sawn cathedral / honey / butt joint', 'small knot cluster / warm brown',
    'sun-bleached / grey honey', 'flat-sawn cathedral / amber / butt joint',
    'sound knot and satellite / dark warm brown', 'quarter-sawn / sun-bleached honey',
    'wandering grain / long shallow split', 'flat-sawn / dark brown / butt joint',
    'dark loose knot / splash weathering', 'straight grain / splash weathering']
PAIRS = [(0,10),(9,1),(7,3),(3,6),(4,11),(8,2),
         (11,0),(5,8),(1,6),(10,5),(2,7),(6,4)]
CUP_DEPTHS = [1.15,1.65,1.30,1.85,1.45,1.10,1.75,1.35,1.95,1.55,1.25,1.65]
RING_SPACING = [5.8,3.7,7.8,6.4,4.2,8.0,6.0,3.3,7.1,5.5,6.7,4.8]
KNOTS = {3:[(465,74,15,7),(523,100,8,5),(558,58,10,5)],
         6:[(1530,83,17,9),(1601,109,9,5)], 10:[(748,104,13,7)]}

def split_field(X, Y, cx, cy, length, width, phase=0, slope=0):
    """A native, tapering seasoning check; x distance is periodic."""
    dx = (X-cx+N/2)%N-N/2
    taper = np.clip(1-(dx/length)**2,0,1)**.7
    path = cy + slope*dx + .48*np.sin(dx/17+phase) + .16*np.sin(dx/3.1+phase)
    return np.exp(-.5*((Y-path)/width)**2)*taper

def softwood_surface(rng, k, X, Y, texture):
    """Coherent native softwood anatomy shared by colour and physical relief.

    The frozen atlases supply selective figure and fine pigment. Growth ridges,
    grain diverted around knots, kerfs and erosion retain their pass 2 mm fields,
    independent of the colour revision and any source illumination.
    """
    shape = texture.shape[:2]
    low = unit_noise(rng,shape,(13,110))
    wear = np.clip(.52+.17*unit_noise(rng,shape,(9,45)),.1,.95)
    phase = rng.uniform(0,2*np.pi)
    amplitude = 1.1 if k in (1,7) else 3.0
    coordinate = Y + amplitude*np.sin(2*np.pi*X/N+phase)
    coordinate = coordinate + .85*unit_noise(rng,shape,(14,130))
    coordinate += .7*np.sin(4*np.pi*X/N+Y/54+phase)
    if k in (2,5,9):
        coordinate += 7*((X-1024)%N/N-.5)
    knot = np.zeros(shape)
    knot_ring = np.zeros(shape)
    for cx,cy,rx,ry in KNOTS.get(k,[]):
        dx = (X-cx+N/2)%N-N/2
        dy = Y-cy
        coordinate -= 1.7*ry*np.tanh(dy/(ry*.7))*np.exp(-.5*(dx/(rx*3.4))**2-.5*(dy/(ry*2.8))**2)
        radius = np.sqrt((dx/rx)**2+(dy/ry)**2)
        radius *= 1+.055*np.sin(np.arctan2(dy/ry,dx/rx)*5+phase)
        km = 1-smooth01((radius-.65)/.45)
        knot = np.maximum(knot,km)
        knot_ring += km*(.5+.5*np.cos(radius*23+phase+.5*np.sin(dx/3)))
    # Random growth-year widths and independently wandering, broken ridges.
    # A regular phase function reads as machined corrugation under raking light.
    latewood = np.zeros(shape)
    ring_y = -45.0
    while ring_y<PITCH+45:
        spacing = RING_SPACING[k]*rng.uniform(.43,1.75)
        wander = unit_noise(rng,(1,N),(0,90))*min(1.0,spacing*.18)
        strength = np.clip(.73+.28*unit_noise(rng,(1,N),(0,65)),.12,1.12)
        strength *= rng.uniform(.55,1.1)
        width = rng.uniform(.48,.93)*(1+.13*unit_noise(rng,(1,N),(0,45)))
        band = np.exp(-.5*((coordinate-ring_y-wander)/width)**2)*strength
        latewood = np.maximum(latewood,band)
        ring_y += spacing
    latewood *= 1-.75*knot
    # Fibres follow the same deflected grain coordinates, including knot clusters.
    fibre_seed = unit_noise(rng,(300,N),(.35,10))
    fine_seed = unit_noise(rng,(300,N),(.28,2.5))
    xx = np.broadcast_to(np.arange(N)[None,:],shape)
    fibre = map_coordinates(fibre_seed,[coordinate+60,xx],order=1,mode='wrap')
    fine = map_coordinates(fine_seed,[coordinate+60,xx],order=1,mode='wrap')
    fibre = np.clip(fibre,-2.5,2.5)
    fine = np.clip(fine,-2.5,2.5)
    torn = np.clip((unit_noise(rng,shape,(.52,6.5))-1.65)/2.0,0,1)
    torn *= .45+.55*wear
    grain_amplitude = .66+.24*wear
    relief = grain_amplitude*(latewood-.32) - .13*wear*(1-latewood)
    relief += .115*fibre+.045*fine-.55*torn
    relief -= .40*knot+.14*knot_ring
    # Retain pass 2 relief exactly. Restore source figure only in the pigment,
    # selectively, and make the existing raised latewood visibly darker.
    source_fine = texture-gaussian_filter(texture,(1.3,5,0),mode=('reflect','wrap','nearest'))
    # Residual source fibres and small knot outlines also participate in relief.
    source_luma = np.sum(source_fine*np.array([.2126,.7152,.0722]),axis=2)
    relief -= .08*np.tanh(source_luma/5)
    colour = TARGETS[k]+FIGURE_STRENGTH[k]*(texture-source_fine)+1.05*source_fine
    colour += low[...,None]*np.array([3.8,3.2,2.7])
    colour -= (latewood-latewood.mean())[...,None]*LATEWOOD_CONTRAST[k]*np.array([1,.88,.68])
    colour += (3.6*fibre+1.2*fine)[...,None]*np.array([1,.91,.74])
    knot_tint = np.array([57,43,26]) if k==10 else np.array([35,29,19])
    colour -= knot[...,None]*knot_tint+knot_ring[...,None]*np.array([16,12,7])
    colour += torn[...,None]*np.array([5.0,4.4,3.5])
    rough = .775+.065*wear+.028*latewood+.018*fibre+.10*torn
    rough += .025*knot
    # Uneven frame/pit-saw strokes in patches. Each cut is 0.2–0.4 mm deep.
    saw = np.zeros(shape)
    patches = [(rng.uniform(0,N),rng.uniform(70,150),rng.uniform(30,145)) for _ in range(2)]
    sx = rng.uniform(0,14)
    while sx<N:
        lean = rng.uniform(-.16,.16)
        distance = (X-sx-lean*(Y-PITCH/2)+N/2)%N-N/2
        envelope = np.zeros(shape)
        for pc,pw,py in patches:
            pd = ((sx-pc+N/2)%N)-N/2
            envelope = np.maximum(envelope,np.exp(-.5*(pd/pw)**2-.5*((Y-py)/43)**2))
        envelope *= np.clip(.78+.15*unit_noise(rng,(shape[0],1),(4,0)),.1,1)
        saw = np.maximum(saw,np.exp(-.5*(distance/rng.uniform(.40,.66))**2)*envelope*rng.uniform(.2,.4))
        sx += rng.uniform(7,22)
    colour -= (saw/.35)[...,None]*np.array([2.3,2.1,1.7])
    rough += .025*saw/.35
    return colour,relief,rough,wear,torn,knot,saw,latewood

def wall_pigment(k, X, Y, colour):
    """Albedo-only weathering tied to wall height; bottom is positive image y.

    Independent random stream keeps every pass 2 physical feature unchanged.
    Periodic x distance preserves the horizontal wrap, including splash marks.
    """
    rng = np.random.default_rng(SEED+3000+k)
    shape = colour.shape[:2]
    splash = np.zeros(shape)
    specks = np.zeros(shape)
    joint_run = np.zeros(shape)
    if k in (10,11):
        patch = unit_noise(rng,shape,(6,25))
        exposure = .37 if k==10 else .64
        splash = np.clip(exposure+.17*patch+.10*Y/PITCH,0,.95)
        grey = np.sum(colour*np.array([.2126,.7152,.0722]),axis=2)
        colour += .13*splash[...,None]*(grey[...,None]-colour)
        colour -= splash[...,None]*np.array([4.5,4.2,3.5])
        # Sparse, small rain-splash deposits: 1–5 mm, not an overall dirt film.
        for _ in range(56 if k==10 else 90):
            cx,cy = rng.uniform(0,N),rng.uniform(5,PITCH-5)
            dx = (X-cx+N/2)%N-N/2
            rx,ry = rng.uniform(.45,1.45),rng.uniform(.40,1.0)
            dot = np.exp(-.5*((dx/rx)**2+((Y-cy)/ry)**2))*rng.uniform(.35,.9)
            specks = np.maximum(specks,dot)
        colour -= specks[...,None]*np.array([25,23,18])
    if k in (3,6,10):
        # Runoff from the butt joint in the course immediately above this one.
        dx = (X-1024+.35*np.sin(Y/11)+N/2)%N-N/2
        length = {3:40,6:32,10:48}[k]
        tail = np.exp(-np.maximum(Y,0)/length)*(1-smooth01((Y-length)/22))
        joint_run = np.exp(-.5*(dx/(1.5+.035*np.maximum(Y,0)))**2)*tail
        joint_run *= .76+.24*np.sin(Y*1.3)**2
        colour -= joint_run[...,None]*np.array([9,8,6])
    return colour,splash,specks,joint_run

def unit_noise(rng, shape, sigma):
    a = gaussian_filter(rng.standard_normal(shape).astype(np.float32), sigma,
                        mode=('reflect','wrap'))
    return a / max(float(a.std()), 1e-6)

def smooth01(t):
    t = np.clip(t, 0, 1)
    return t*t*(3-2*t)

def save_rgb(name, array, srgb=False):
    opts = {}
    if srgb:
        # Reuse the frozen profile so an ICC creation timestamp cannot change
        # the output hash on an otherwise identical deterministic rebuild.
        with Image.open(ROOT/'checks'/'pass2'/'boards_base.png') as previous:
            opts['icc_profile'] = previous.info['icc_profile']
    Image.fromarray(np.rint(np.clip(array, 0, 255)).astype(np.uint8)).save(ROOT/name, **opts)

def minimum_cut(cost):
    """A vertical dynamic-programming cut, continuous to within 2 px per row."""
    h,w = cost.shape
    accum = cost[0].copy()
    steps = np.empty((h,w), np.int16)
    columns = np.arange(w)
    for y in range(1,h):
        candidates = np.stack([np.where((columns+d>=0)&(columns+d<w),
                            accum[np.clip(columns+d,0,w-1)] + abs(d)*.12, 1e8)
                               for d in range(-2,3)])
        choice = candidates.argmin(axis=0)
        steps[y] = choice-2
        accum = cost[y] + candidates[choice,columns]
    path = np.empty(h, float)
    x = int(accum.argmin())
    for y in range(h-1,-1,-1):
        path[y] = x
        if y: x += int(steps[y,x])
    return gaussian_filter1d(path, 2)

def source_strips():
    result = []
    for label in ('a','b'):
        im = np.asarray(Image.open(ROOT/'source'/f'generated_atlas_{label}.png').convert('RGB'),float)
        h,w,_ = im.shape
        for k in range(6):
            center = int((k+.5)*h/6)
            strip = im[center-90:center+90].copy()
            assert strip.shape[0] == 180 and w >= 1100
            # Remove broad exposure variation, preserving local pigment and growth rings.
            lum = np.sum(strip * np.array([.2126,.7152,.0722]), axis=2)
            broad = gaussian_filter(lum, (32,160), mode='reflect')
            lum = lum - .65*(broad-broad.mean())
            lum -= lum.mean()
            lum *= 9.2/max(float(lum.std()), 1)
            # Restrained source chroma variation, with final board-specific colour below.
            chroma = strip - np.sum(strip * np.array([.2126,.7152,.0722]), axis=2)[...,None]
            chroma -= chroma.mean(axis=(0,1))
            result.append(lum[...,None]*np.array([1,.89,.72]) + .20*chroma)
    return result

def quilt(a, b, k):
    """Two native-scale samples, with two periodic minimum-error overlap cuts.

    The output is NOT a resized image. Source texels retain their 1:1 scale.
    A cut crossing the wrap guarantees that x=0 is an ordinary sampled surface.
    """
    h,w,_ = a.shape
    if k % 3 == 1: a = a[:,::-1]
    if k % 4 == 2: b = b[::-1,::-1]
    X = np.arange(N)
    if k in (2,5,9):
        # An actual grain termination at the butt joint. In this unwrapped strip
        # the two ends become the two sides of x=1024; its middle crosses x=0.
        A = a[:,np.clip(X,0,w-1)] + np.array([-1.7,-1.4,-1.0])
        B = b[:,np.clip(X-(N-w),0,w-1)] + np.array([1.7,1.4,1.0])
        cols = np.arange(N-w+8,w-8)
        cost = gaussian_filter(np.mean((A[:,cols]-B[:,cols])**2,axis=2),(1,1))
        cut = minimum_cut(cost)+cols[0]
        weight = 1-smooth01((X[None,:]-cut[:,None]+12)/24)
        result = A*weight[...,None]+B*(1-weight[...,None])
        return np.roll(result,1024,axis=1), [{'butt_at':1024,'quilt_center':0}]
    da = (X-512+N/2)%N-N/2
    db = (X-1536+N/2)%N-N/2
    A = a[:,np.clip((da+w/2).astype(int),0,w-1)]
    B = b[:,np.clip((db+w/2).astype(int),0,w-1)]
    weight = np.tile((np.abs(da) < np.abs(db)).astype(float),(h,1))
    overlap = int((w-1024)/2)-12
    cuts = []
    for center in (0,1024):
        xx = np.arange(-overlap,overlap+1)
        cols = (center+xx)%N
        diff = A[:,cols]-B[:,cols]
        cost = gaussian_filter((diff*diff).mean(axis=2),(1,1))
        # Keep cuts away from the patch endpoints.
        cost += 10*(np.abs(xx)/overlap)**6
        cut = minimum_cut(cost)-overlap
        t = smooth01((xx[None,:]-cut[:,None]+12)/24)
        weight[:,cols] = t if center == 0 else 1-t
        cuts.append({'center':center,'min':float(cut.min()),'max':float(cut.max())})
    result = A*weight[...,None]+B*(1-weight[...,None])
    # Shift the quilt cuts away from the physical butt joints where possible.
    shift = (173*k+237)%N
    return np.roll(result,shift,axis=1), cuts

def main():
    started = time.time()
    rng = np.random.default_rng(SEED)
    sources = source_strips()
    base = np.zeros((N,N,3),np.float32)
    height = np.zeros((N,N),np.float32)
    ao = np.zeros((N,N),np.float32)
    rough = np.zeros((N,N),np.float32)
    checks = np.zeros((N,N),np.float32)
    lap_mask = np.zeros((N,N),np.float32)
    joint_mask = np.zeros((N,N),np.float32)
    grain_relief = np.zeros((N,N),np.float32)
    saw_depth = np.zeros((N,N),np.float32)
    cup_depth = np.zeros((N,N),np.float32)
    pocket_mask = np.zeros((N,N),np.float32)
    bruise_mask = np.zeros((N,N),np.float32)
    weather_mask = np.zeros((N,N),np.float32)
    latewood_mask = np.zeros((N,N),np.float32)
    splash_mask = np.zeros((N,N),np.float32)
    speck_mask = np.zeros((N,N),np.float32)
    joint_run_mask = np.zeros((N,N),np.float32)
    frozen_nails = json.loads((ROOT/'source'/'nail_layout.json').read_text())
    board_ids = np.floor((np.arange(N)+.5)/PITCH).astype(int)
    metadata = {'size':N,'metres_per_tile':[3,3], 'mm_per_pixel':MM_PER_PIXEL,
                'height_range_mm':HEIGHT_RANGE_MM, 'seed':SEED,
                'board_edges_px':[k*PITCH for k in range(13)],
                'butt_joint_boards':[2,5,9], 'revision':7, 'boards':[], 'nails':[],
                'base_mean_target_srgb':BASE_MEAN_SRGB.tolist(),
                'board_mean_bounds_srgb':[[160,117,75],[184,141,96]],
                'board_mean_spread_fraction_of_pass4':.8,
                'preserved_from_pass2':['height','normal','orm']}
    X = np.arange(N,dtype=float)[None,:]+.5
    for k,(ia,ib) in enumerate(PAIRS):
        tex,cuts = quilt(sources[ia],sources[ib],k)
        rows = np.arange(int(np.floor(k*PITCH)),int(np.ceil((k+1)*PITCH)))
        v = rows+.5-k*PITCH
        coverage = np.maximum(0,np.minimum(rows+1,(k+1)*PITCH)-np.maximum(rows,k*PITCH))
        YY,XX = np.meshgrid(np.clip(v+4,0,179),np.arange(N),indexing='ij')
        texture = np.stack([map_coordinates(tex[...,c],[YY,XX],order=1,mode='nearest') for c in range(3)],axis=2)
        shape = (len(rows),N)
        Y = v[:,None]
        colour,grain,r,weather,torn,knot,saw,latewood = softwood_surface(rng,k,X,Y,texture)
        cup = CUP_DEPTHS[k]*np.sin(np.pi*np.clip(Y/PITCH,0,1))**2
        cup = np.broadcast_to(cup,shape)
        h = 6.0+grain-cup-saw
        occ = np.ones(shape,float)
        fissures = .24*knot
        for j in range(3+(k%3==0)):
            cx = rng.uniform(100,N-100)
            cy = rng.uniform(24,PITCH-24)
            length = rng.uniform(28,100)
            fissures = np.maximum(fissures,split_field(X,Y,cx,cy,length,rng.uniform(.38,.68),j,.01))
        # Nail-driven splits and end checks occur at their physical fasteners/ends.
        for i,nail in enumerate(n for n in frozen_nails if n['board']==k):
            if (i+k)%3==0:
                cx,cy = nail['center_px']
                fissures = np.maximum(fissures,.8*split_field(X,Y,cx+10,cy-k*PITCH,
                                                           rng.uniform(19,43),.46,k,.008))
        if k in (2,5,9):
            for j,cy in enumerate([28,117]):
                fissures = np.maximum(fissures,split_field(X,Y,1024,cy,62+j*13,.58,j,.023))
        if k==8:
            fissures = np.maximum(fissures,.70*split_field(X,Y,1290,94,290,.67,2,.012))
            fissures = np.maximum(fissures,.45*split_field(X,Y,1420,98,110,.43,2,.040))
        h -= 1.15*fissures
        occ *= 1-.37*fissures
        colour -= fissures[...,None]*np.array([36,30,21])
        r += .065*fissures
        pocket = np.zeros(shape)
        if k in (1,3,6,9,11):
            cx = [620,1750,340,1450,785][(1,3,6,9,11).index(k)]
            cy = rng.uniform(40,130)
            dx = (X-cx+N/2)%N-N/2
            length = rng.uniform(17,32)
            taper = np.clip(1-(dx/length)**2,0,1)
            dy = Y-cy-.018*dx
            pocket = np.exp(-.5*(dy/(.45+1.0*taper))**2)*taper**.65
            h -= .95*pocket
            colour = colour*(1-.65*pocket[...,None])+np.array([99,60,28])*.65*pocket[...,None]
            r = r*(1-.32*pocket)+.60*.32*pocket
            occ *= 1-.27*pocket
        # Rain alters pigment at the lower 20 mm, not a painted lap shadow.
        lower = smooth01((Y-(PITCH-22/MM_PER_PIXEL))/(22/MM_PER_PIXEL))
        lower = lower*(.64+.36*weather)
        drips = np.zeros(shape)
        for j in range(5):
            cx = rng.uniform(0,N)
            dx = (X-cx+N/2)%N-N/2
            tail = smooth01((Y-(PITCH-rng.uniform(20,40)))/22)
            drips = np.maximum(drips,np.exp(-.5*(dx/rng.uniform(1.3,3.5))**2)*tail*rng.uniform(.2,.65))
        ageing = np.maximum(lower,drips)
        grey = np.sum(colour*np.array([.2126,.7152,.0722]),axis=2)
        colour += .10*ageing[...,None]*(grey[...,None]-colour)
        colour -= ageing[...,None]*np.array([4.3,3.2,2.0])
        fresh = 1-smooth01(Y/(12/MM_PER_PIXEL))
        colour += fresh[...,None]*np.array([1.4,.7,-.2])
        r += .04*ageing
        # The model already supplies the board tilt. Only the rounded arris belongs
        # here: 3 mm drop over the last 10 mm. Area-integrate each row (24 samples).
        drop = np.zeros(len(rows))
        lap = np.zeros(len(rows))
        for sy in (np.arange(24)+.5)/24:
            vv = rows+sy-k*PITCH
            vv = np.clip(vv,0,PITCH)
            drop += 3*smooth01((vv-(PITCH-10/MM_PER_PIXEL))/(10/MM_PER_PIXEL))/24
            lap += (.48*(1-smooth01(vv/(10/MM_PER_PIXEL))))/24
        h -= drop[:,None]
        occ *= 1-lap[:,None]
        jm = np.zeros(shape,float)
        if k in (2,5,9):
            center = 1024 + .28*np.sin(v[:,None]/9+2*k)+.16*np.sin(v[:,None]/2.6)
            dist = np.abs(X-center)
            jm = np.exp(-.5*(dist/.56)**2)
            end_fibre = np.exp(-dist/3.8)*(1+.13*unit_noise(rng,shape,(.6,5)))
            h -= 2.1*jm
            occ *= 1-.66*jm
            # Pigment at exposed end fibres, never a painted black gap/shadow.
            colour -= end_fibre[...,None]*np.array([9,7,4.5])
            r += .12*end_fibre
        colour,splash,specks,joint_run = wall_pigment(k,X,Y,colour)
        colour += BOARD_COLOUR_OFFSETS[k]
        colour += UNLIT_COLOUR_OFFSETS[k]
        for target,src in [(base,colour),(height,h),(ao,occ),(rough,r),
                           (checks,fissures),(joint_mask,jm),
                           (grain_relief,grain),(saw_depth,saw),(cup_depth,cup),
                           (pocket_mask,pocket),(weather_mask,ageing),
                           (latewood_mask,latewood),(splash_mask,splash),
                           (speck_mask,specks),(joint_run_mask,joint_run),
                           (lap_mask,np.broadcast_to(lap[:,None],shape))]:
            mult = coverage[:,None,None] if target.ndim==3 else coverage[:,None]
            target[rows] += (src*mult).astype(np.float32)
        metadata['boards'].append({'index':k,'target_srgb':TARGETS[k].tolist(),
            'pass4_additive_srgb_offset':BOARD_COLOUR_OFFSETS[k].tolist(),
            'pass6_additive_srgb_offset':UNLIT_COLOUR_OFFSETS[k].tolist(),
            'character':CHARACTER[k], 'source_figure_strength':FIGURE_STRENGTH[k],
            'latewood_colour_contrast':LATEWOOD_CONTRAST[k],
            'source_strip_indices':[ia,ib],'quilt_cuts':cuts,'arris_drop_mm':3,
            'arris_width_mm':10,'cup_depth_mm':CUP_DEPTHS[k],
            'grain_spacing_px':RING_SPACING[k], 'grain_relief_p05_p95_mm':np.percentile(grain,[5,95]).tolist(),
            'saw_max_depth_mm':float(saw.max()), 'knot_centres_local_px':KNOTS.get(k,[]),
            'long_split':k==8})
        print(f'Board {k:02d} assembled',flush=True)

    metal = np.zeros((N,N),np.uint8)
    nail_coverage = np.zeros((N,N),np.float32)
    # Retain the exact first-pass head silhouettes, centres and fractional y rows.
    nail_rng = np.random.default_rng(SEED+92)
    for ni,nail in enumerate(frozen_nails):
        k = nail['board']
        cx,cy = nail['center_px']
        angle = nail['angle_radians']
        width = nail['width_px']
        radius = width/2
        px = np.arange(int(cx)-34,int(cx)+35)
        # Rain travels down image y; the stain stops before the next board.
        end = min(int(cy)+44,int(np.floor((k+1)*PITCH)))
        py = np.arange(int(cy)-16,end)
        dy,dx = np.meshgrid(py+.5-cy,px+.5-cx,indexing='ij')
        u = dx*np.cos(angle)+dy*np.sin(angle)
        v = -dx*np.sin(angle)+dy*np.cos(angle)
        signed = np.maximum.reduce([np.abs(u)/radius,np.abs(v)/(radius*.94),
                                     (np.abs(u)+np.abs(v))/(radius*1.68)])
        cov = smooth01((1-signed)*radius+.5)
        inside = signed<=1
        I = np.ix_(py%N,px%N)
        stain_strength = nail_rng.uniform(.22,.55) if ni%3!=1 else .08
        stain = np.exp(-.5*((dx/11)**2+(dy/4.5)**2))*stain_strength
        stain *= 1+.18*np.sin(dy*2.4+dx*.12)
        rain = np.zeros_like(dx)
        if ni%7==0:
            tail = np.clip((dy-3)/7,0,1)*np.exp(-np.maximum(dy-4,0)/13)
            rain = np.exp(-.5*((dx-.5*np.sin(dy/8))/(.65+.018*np.maximum(dy,0)))**2)*tail
            rain *= .80+.20*np.cos(dy*2.5+dx*.2)
        b = base[I].copy()
        b -= stain[...,None]*np.array([12,11,8])+rain[...,None]*np.array([32,29,23])
        halo = np.exp(-.5*((signed-1.2)*radius/1.5)**2)*(1-cov)
        halo *= .73+.22*np.sin(np.arctan2(dy,dx)*3+ni)
        b = b*(1-.62*halo[...,None])+np.array([117,70,32])*.62*halo[...,None]
        patina = unit_noise(nail_rng,dx.shape,(.5,.5))
        iron = np.array([78,77,73])+np.clip(patina,-2,2)[...,None]*2
        # Keep the pass 2 roughness term; worn silver-grey rim is albedo only.
        iron_rim = np.clip((signed-.65)/.4,0,1)*.40
        worn = smooth01((signed-.43)/.45)
        worn *= .84+.14*np.sin(np.arctan2(dy,dx)*5+ni)
        iron = iron*(1-worn[...,None])+np.array([119,115,104])*worn[...,None]
        b = b*(1-cov[...,None])+iron*cov[...,None]
        base[I] = b
        h = height[I].copy()
        bruise = np.zeros_like(dx)
        if ni%3==0:
            bruise = np.exp(-.5*(((dx-1.1)/7.2)**2+((dy+.7)/6.0)**2))*(1-cov)
            h -= nail_rng.uniform(.30,.55)*bruise
        # A seated iron head does not inherit the wood's fine ridges beneath it.
        seat = float(np.sum(h*cov)/max(cov.sum(),1))
        radial = (u/radius)**2+(v/(radius*.94))**2
        dome = .62+1.05*np.clip(1-radial/1.6,0,1)
        facets = .12*np.abs(u/radius+.30*v/radius)-.10*np.abs(v/radius-.24*u/radius)
        crown = dome+facets+.035*np.clip(patina,-2,2)
        height[I] = h*(1-cov)+(seat+crown)*cov
        ring = np.exp(-.5*((signed-1.13)*radius/.70)**2)*(1-cov)
        ao[I] *= (1-.27*ring)*(1-.085*bruise)
        ao[I] = ao[I]*(1-cov)+cov
        rough[I] = rough[I]*(1-cov)+(.53+.025*patina+.12*iron_rim)*cov
        metal[I] = np.maximum(metal[I],inside.astype(np.uint8)*255)
        nail_coverage[I] = np.maximum(nail_coverage[I],cov)
        bruise_mask[I] = np.maximum(bruise_mask[I],bruise)
        record = dict(nail)
        record.update({'hammer_bruise':ni%3==0,'rain_streak':ni%7==0,
                       'crown_height_mm':[float(crown[inside].min()),float(crown[inside].max())]})
        metadata['nails'].append(record)

    # Global pigment calibration leaves the iron reflectance unchanged.
    wood_weight = 1-nail_coverage
    correction = (BASE_MEAN_SRGB-base.mean(axis=(0,1),dtype=np.float64))/wood_weight.mean(dtype=np.float64)
    base += wood_weight[...,None]*correction
    metadata['final_wood_calibration_srgb'] = correction.tolist()
    assert np.min(height)>0 and np.max(height)<HEIGHT_RANGE_MM
    encoded = np.rint(height/HEIGHT_RANGE_MM*65535).astype(np.uint16)
    Image.fromarray(encoded).save(ROOT/'boards_height.png')
    # Always derive normals from the saved quantized height, not an unsaved field.
    saved = np.asarray(Image.open(ROOT/'boards_height.png'),dtype=np.float64)*HEIGHT_RANGE_MM/65535
    dx = (np.roll(saved,-1,axis=1)-np.roll(saved,1,axis=1))/(2*MM_PER_PIXEL)
    dy = (np.roll(saved,-1,axis=0)-np.roll(saved,1,axis=0))/(2*MM_PER_PIXEL)
    normal = np.stack([-dx,dy,np.ones_like(dx)],axis=2)
    normal /= np.linalg.norm(normal,axis=2,keepdims=True)
    save_rgb('boards_base.png',base,True)
    save_rgb('boards_normal.png',(normal*.5+.5)*255)
    save_rgb('boards_orm.png',np.stack([np.clip(ao,0,1)*255,
                                     np.clip(rough,0,1)*255,metal],axis=2))
    # Fail the rebuild if any non-colour deliverable changes, even by one byte.
    metadata['pass2_preservation_sha256'] = {}
    for name in ('height','normal','orm'):
        path = ROOT/f'boards_{name}.png'
        old = ROOT/'checks'/'pass2'/path.name
        assert path.read_bytes()==old.read_bytes(), f'Pass 2 {name} changed'
        assert path.read_bytes()==(ROOT/'checks'/'pass4'/path.name).read_bytes(), f'Pass 4 {name} changed'
        assert path.read_bytes()==(ROOT/'checks'/'pass5'/path.name).read_bytes(), f'Pass 5 {name} changed'
        metadata['pass2_preservation_sha256'][name] = hashlib.sha256(path.read_bytes()).hexdigest()
    # Pass 7: the final map operation is an integer, periodic translation of the
    # already encoded pixels. Preserve bit depth, channels and the base ICC;
    # never regenerate normals or filter/recolour any map after this roll.
    for name in ('base','height','normal','orm'):
        path = ROOT/f'boards_{name}.png'
        with Image.open(path) as im:
            pixels = np.asarray(im)
            opts = {'icc_profile':im.info['icc_profile']} if name=='base' else {}
            rolled = np.roll(pixels,(ROLL_Y,ROLL_X),axis=(0,1))
            Image.fromarray(rolled).save(path,**opts)
    masks = dict(lap=lap_mask,joints=joint_mask,checks=checks,
                 nail_coverage=nail_coverage,metal=metal,board_ids=board_ids,
                 grain_relief=grain_relief,saw_depth=saw_depth,cup_depth=cup_depth,
                 pockets=pocket_mask,bruises=bruise_mask,weather=weather_mask,
                 latewood=latewood_mask,splash=splash_mask,dirt_specks=speck_mask,
                 joint_runoff=joint_run_mask)
    np.savez_compressed(ROOT/'checks'/'construction_masks.npz',**{
        key:np.roll(value,ROLL_Y,axis=0) if value.ndim==1 else
            np.roll(value,(ROLL_Y,ROLL_X),axis=(0,1))
        for key,value in masks.items()})
    metadata['final_roll_px'] = {'right':ROLL_X,'down':ROLL_Y,'wrap_around':True}
    metadata['board_edges_px'] = [k*PITCH+ROLL_Y for k in range(13)]
    metadata['board_edges_coordinate_note'] = 'Unwrapped course boundaries; reduce modulo size for tile rows.'
    metadata['nail_columns_px'] = [ROLL_X,(1024+ROLL_X)%N]
    metadata['butt_joint_x_px'] = (1024+ROLL_X)%N
    metadata['board_detail_coordinate_note'] = 'quilt_cuts and knot_centres_local_px retain pre-roll synthesis coordinates; knot_centres_tile_px gives delivered centres.'
    for board in metadata['boards']:
        board['knot_centres_tile_px'] = [
            [(x+ROLL_X)%N,(board['index']*PITCH+y+ROLL_Y)%N,rx,ry]
            for x,y,rx,ry in board['knot_centres_local_px']]
    for nail in metadata['nails']:
        x,y = nail['center_px']
        nail['center_px'] = [(x+ROLL_X)%N,(y+ROLL_Y)%N]
        nail['wrap_x'] = False  # Both stud columns are now inside the tile.
    metadata['preservation_note'] = 'Pass 2 hashes above describe pre-roll PNG bytes; all four delivered maps preserve pass 6 pixels under the final roll.'
    metadata['height_used_mm']=[float(saved.min()),float(saved.max())]
    metadata['build_seconds']=round(time.time()-started,3)
    (ROOT/'checks'/'construction.json').write_text(json.dumps(metadata,indent=2)+'\n')
    print(f'Wrote all four maps in {time.time()-started:.1f}s. Height range used: {saved.min():.3f}..{saved.max():.3f} mm')

if __name__=='__main__':
    main()
