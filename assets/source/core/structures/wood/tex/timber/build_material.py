"""Build a native 2048 px / 3 m timber trim from frozen generated sources.

All working heights are millimetres. The image rows point down; tangent Y points up.
No source is enlarged. Source crops are quilted at 1:1 pixel scale.
"""
from pathlib import Path
import json
import time
import numpy as np
from PIL import Image, PngImagePlugin
from scipy.ndimage import gaussian_filter, gaussian_filter1d, map_coordinates

ROOT = Path(__file__).resolve().parent
N = 2048
TILE_MM = 3000.0
MM_PX = TILE_MM / N
HEIGHT_MM = 16.0
SEED = 261114
# Pass four: DESIGN.md Material palette, explicitly unlit 8-bit sRGB.
# These affect only the final pigment; construction and data maps stay fixed.
BASE_MEAN_SRGB = (98, 67, 45)  # T, hewn structural timber
ARRIS_SRGB = (118, 82, 55)    # T+, rubbed timber arrises
# Frozen profile avoids LittleCMS embedding a new creation timestamp each build.
SRGB = (ROOT/'source'/'srgb.icc').read_bytes()

# Four hewn, five sawn, three weathered. Deliberately interleaved.
# Keep the pass-two pigment anchors: centring the finished colour below shifts
# every band together, preserving their offsets and all native colour detail.
BANDS = [
    ('a', 0, 'hewn',      (101, 69, 44)),
    ('a', 1, 'sawn',      (113, 78, 50)),
    ('b', 2, 'weathered', (98, 79, 62)),
    ('a', 2, 'hewn',      (108, 75, 49)),
    ('b', 0, 'sawn',      (95, 66, 44)),
    ('c', 0, 'hewn',      (105, 74, 49)),
    ('a', 3, 'sawn',      (113, 79, 51)),
    ('c', 2, 'weathered', (96, 76, 58)),
    ('b', 1, 'hewn',      (98, 67, 44)),
    ('b', 3, 'sawn',      (110, 76, 49)),
    ('c', 3, 'weathered', (98, 77, 57)),
    ('c', 1, 'sawn',      (106, 73, 47)),
]
CHECKS = [
    dict(band=0, x=390, length_mm=940, v=.43, width_mm=7.6, depth_mm=5.8),
    dict(band=7, x=1190, length_mm=780, v=.62, width_mm=6.4, depth_mm=5.3),
    dict(band=10, x=1945, length_mm=1160, v=.37, width_mm=7.2, depth_mm=6.6),
]
PEGS = [dict(band=3, x=1395, v=.38), dict(band=9, x=565, v=.65)]
IRON = [dict(band=1,x=1530,v=.27),dict(band=5,x=910,v=.72),
        dict(band=8,x=185,v=.35),dict(band=11,x=1170,v=.68)]
WANE = [2, 8]


def save_png(path, a, srgb=False, note=''):
    a = np.asarray(a)
    pnginfo = PngImagePlugin.PngInfo()
    pnginfo.add_text('Description', note)
    if srgb:
        pnginfo.add(b'sRGB', b'\x00')
    Image.fromarray(a).save(path, pnginfo=pnginfo,
        **({'icc_profile': SRGB} if srgb else {}))


def smoothstep(a):
    a = np.clip(a, 0, 1)
    return a*a*(3-2*a)


def unit(a):
    return (a-a.mean()) / (a.std()+1e-6)


def noise(rng, shape, sig):
    return unit(gaussian_filter(rng.normal(size=shape).astype(np.float32),
                               sig, mode=('reflect', 'wrap')))


def distance_x(x, center):
    return (x-center+N/2) % N - N/2


def hewing(rng, x, y, shape, weathered=False):
    """Overlapping full-face axe cuts, with curved blade exits and torn lips.

    The blade spans the 250 mm face. Each cut scoops along x for 80–200 mm;
    the overlapping cut surfaces are combined before adding native fibres.
    All support is compact and evaluated periodically, including at x=0.
    """
    depth = np.zeros(shape, np.float32)
    lip = np.zeros(shape, np.float32)
    shear = np.zeros(shape, np.float32)
    tone = np.zeros(shape, np.float32)
    records = []
    count = 27 if not weathered else 19
    intervals = rng.uniform(.55,1.45,count)
    intervals *= N/intervals.sum()
    centers = (rng.uniform(0,N)+np.cumsum(intervals))%N
    v = y/(N/12)
    blade_jitter = noise(rng,shape,(1.2,11))
    for cx in centers:
        length_mm = rng.uniform(90,200) if not weathered else rng.uniform(140,200)
        cut_mm = rng.uniform(2.4,4.8)*(0.43 if weathered else 1)
        cy = rng.uniform(.28,.72)*(N/12)
        across = rng.uniform(.80,1.35)*(N/12)
        lean = rng.uniform(-.25,.25)
        dx = distance_x(x,cx)-lean*(y-cy)-blade_jitter*.65
        # The whole shallow spoon is curved, not a flat ramp ending in a score.
        # Overlapping broad elliptical cuts produce curved meeting edges and
        # irregular facets; no tiled sine waves or repeated crescent decals.
        q=(dx/(length_mm/MM_PX*.5))**2+((y-cy)/across)**2
        bowl=np.maximum(0,1-q)**(.86 if not weathered else 1.1)
        face=cut_mm*bowl
        edge_mask=np.exp(-((q-.86)/.15)**2)*(q<1)*(dx>0)
        winning = face>depth
        tone = np.where(winning,rng.uniform(-4.2,4.2),tone)
        shear = np.where(winning,rng.uniform(-1.6,1.6)*bowl,shear)
        lip = np.where(winning,edge_mask,lip)
        depth = np.maximum(depth,face)
        records.append(dict(x=float(cx),length_mm=float(length_mm),
                            cut_depth_mm=float(cut_mm),across_radius_px=float(across),
                            across_center_px=float(cy),
                            angle_degrees=float(np.degrees(np.arctan(lean)))))
    # No rounding filter: the lip exposes short split fibres at native resolution.
    torn = np.clip(noise(rng,shape,(.30,2.2)),-2,2)*lip
    depth = np.maximum(0,depth+torn*.20)
    return depth,lip,shear,tone,records


def saw_cuts(rng, x, y, shape, weathered=False):
    depth = np.zeros(shape,np.float32)
    records = []
    # A circular sequence closes with a normal spacing, never a special seam.
    count = 304
    gaps = rng.uniform(5.1,14.7,count)
    gaps *= TILE_MM/gaps.sum()
    centers = (rng.uniform(0,N)+np.cumsum(gaps)/MM_PX)%N
    base_lean = rng.uniform(-.12,.12)
    for j,cx in enumerate(centers):
        lean = base_lean + .014*np.sin(j*.21)+rng.uniform(-.003,.003)
        dx = distance_x(x,cx)+(y-N/24)*lean
        cut_mm = rng.uniform(.3,.6)*(0.42 if weathered else 1)
        width = rng.uniform(.52,.78)
        track = np.exp(-(dx/width)**2)*cut_mm
        track *= .94+.06*np.sin(y/17+j)
        depth = np.maximum(depth,track)
        records.append(dict(x=float(cx),spacing_mm=float(gaps[j]),
                            cut_depth_mm=float(cut_mm),
                            angle_degrees=float(np.degrees(np.arctan(lean)))))
    return depth,records


def cut_alpha(left, right):
    """Minimum-error vertical quilting seam, with a narrow smooth feather."""
    error = np.mean((left-right)**2, axis=2)
    error = gaussian_filter(error, (1.4, 2.0))
    h, w = error.shape
    error[:, :12] += 10000
    error[:, -12:] += 10000
    cost = error[0].copy()
    back = np.zeros((h, w), np.int8)
    for y in range(1, h):
        opts = np.stack((np.r_[np.inf, cost[:-1]], cost, np.r_[cost[1:], np.inf]))
        arg = np.argmin(opts, axis=0)
        cost = error[y] + np.min(opts, axis=0)
        back[y] = arg.astype(np.int8)-1
    path = np.zeros(h, np.int32)
    path[-1] = np.argmin(cost)
    for y in range(h-2, -1, -1):
        path[y] = path[y+1] + back[y+1, path[y+1]]
    path = gaussian_filter1d(path.astype(float), 3)
    return smoothstep((np.arange(w)[None, :]-path[:, None]+9)/18)[..., None]


def source_band(src, part, h, idx):
    """Two different, unscaled source cuts with two cyclic min-cut joins."""
    sh, sw = src.shape[:2]
    start = int(part*sh/4)
    # Quarter strips are 313/314px tall. Avoid every generated strip boundary.
    ys = (start+30, start+sh//4-h-25)
    width = 1144
    patch = []
    for j, sy in enumerate(ys):
        sx = (13+idx*7+j*43) % (sw-width-10)
        a = src[sy:sy+h, sx:sx+width].astype(np.float32)
        # Keep each generated knot only once, despite overlapping source cuts.
        knot = {3:(957,785), 2:(134,785), 5:(948,199)}.get(idx)
        if j==1 and knot is not None:
            kx,ky = knot
            yy,xx=np.mgrid[sy:sy+h,sx:sx+width]
            q=((xx-kx)/100)**2+((yy-ky)/65)**2
            mask=smoothstep(1-q)[...,None]
            donor_x=(xx+(210 if kx<500 else -230))%sw
            donor=src[yy,donor_x].astype(np.float32)
            a=a*(1-mask)+donor*mask
        # Remove source exposure drift. Keep only small amounts of broad pigment.
        low = gaussian_filter(a, (23, 65, 0), mode='reflect')
        a = a-low*.82
        a -= a.mean(axis=(0, 1), keepdims=True)
        a = a / max(a[..., 0].std(), 1) * (8.8 if BANDS[idx][2]=='weathered' else 8.2)
        patch.append(a)
    a, b = patch
    out = np.empty((h, N, 3), np.float32)
    out[:, :1024] = a[:, :1024]
    out[:, 1024:] = b[:, :1024]
    w = width-1024
    alpha = cut_alpha(a[:, 1024:], b[:, :w])
    out[:, 1024:1024+w] = a[:, 1024:]*(1-alpha)+b[:, :w]*alpha
    alpha = cut_alpha(b[:, 1024:], a[:, :w])
    out[:, :w] = b[:, 1024:]*(1-alpha)+a[:, :w]*alpha
    # Rotate joins away from tile edges. The wrap lies inside a native crop.
    return np.roll(out, 337+idx*79, axis=1)


def normals_from_height(h16):
    h = h16.astype(np.float64)*(HEIGHT_MM/65535.0)
    dx = (np.roll(h, -1, 1)-np.roll(h, 1, 1))/(2*MM_PX)
    dy_down = (np.roll(h, -1, 0)-np.roll(h, 1, 0))/(2*MM_PX)
    vec = np.stack((-dx, dy_down, np.ones_like(dx)), axis=2)
    vec /= np.linalg.norm(vec, axis=2, keepdims=True)
    return np.rint((vec*.5+.5)*255).astype(np.uint8)


def horizon_ao(h, edge, cavities):
    # Discrete 8-direction height-field horizon, at true metric sample spacing.
    occ = np.zeros_like(h)
    for dy, dx in ((0,1),(1,1),(1,0),(1,-1),(0,-1),(-1,-1),(-1,0),(-1,1)):
        slope = np.zeros_like(h)
        for r in (1,2,4,8,16,32):
            other = np.roll(np.roll(h, dy*r, 0), dx*r, 1)
            slope = np.maximum(slope, (other-h)/(MM_PX*r*np.hypot(dx,dy)))
        occ += slope*slope/(1+slope*slope)/8
    # Material contact creases remain softly occluded even below pixel resolution.
    # Every added term is gated by explicitly cut geometry, never pigment.
    return np.clip(1-occ*.95-edge*.065-cavities*.24, .13, 1)


def build():
    t = time.time()
    (ROOT/'checks').mkdir(exist_ok=True)
    src = {k: np.asarray(Image.open(ROOT/'source'/f'generated_{k}.png').convert('RGB'))
           for k in 'abc'}
    base = np.zeros((N,N,3), np.float32)
    height = np.zeros((N,N), np.float32)
    rough = np.zeros((N,N), np.float32)
    cavity = np.zeros((N,N), np.float32)
    edges = np.zeros((N,N), np.float32)
    tool_field = np.zeros((N,N), np.float32)
    kerf_field = np.zeros((N,N), np.float32)
    check_field = np.zeros((N,N), np.float32)
    fibre_field = np.zeros((N,N), np.float32)
    wane_field = np.zeros((N,N), np.float32)
    iron_field = np.zeros((N,N), np.float32)
    ids = np.floor((np.arange(N)+.5)*12/N).astype(int)
    metadata = []
    for k, (key, part, kind, rgb) in enumerate(BANDS):
        rng = np.random.default_rng(SEED+k*717)
        rows = np.flatnonzero(ids==k)
        h = len(rows)
        y = ((rows+.5)-k*N/12)[:, None]
        x = (np.arange(N)+.5)[None, :]
        shape = (h,N)
        d = np.minimum(y, N/12-y)*MM_PX
        edge = 1-smoothstep(d/10)
        envelope = smoothstep(d/9)
        scallop = np.zeros(shape,np.float32)
        lip = np.zeros(shape,np.float32)
        shear = np.zeros(shape,np.float32)
        facet_tone = np.zeros(shape,np.float32)
        kerfs = np.zeros(shape,np.float32)
        axe_records, saw_records = [], []
        if kind in ('hewn','weathered'):
            scallop,lip,shear,facet_tone,axe_records = hewing(rng,x,y,shape,kind=='weathered')
        if kind in ('sawn','weathered'):
            kerfs,saw_records = saw_cuts(rng,x,y,shape,kind=='weathered')
        grain = source_band(src[key], part, h, k)
        # Grain shears at actual blade exits, not at arbitrary painted boundaries.
        warp = noise(rng, shape, (36, 95))*(1.25 if kind=='hewn' else .28)
        coords = np.mgrid[:h,:N].astype(np.float32)
        coords[0] += warp + shear + scallop*.33
        grain = np.stack([map_coordinates(grain[...,c], coords, order=1,
                              mode='reflect') for c in range(3)], axis=2)
        # Native millimetre fibres: elongated along grain, crisp across it.
        fibres = noise(rng, shape, (.30, 8.5))
        fibres = map_coordinates(fibres,coords,order=1,mode='reflect')
        splinters = np.maximum(0,noise(rng,shape,(.35,18))-1.05)
        pores = np.maximum(0, -noise(rng, shape, (.35, 3.8))-.85)
        broad = noise(rng, shape, (22, 155))
        if kind=='weathered':
            kerfs *= np.clip(.42+noise(rng,shape,(9,65))*.30,0,1)
        # Neutralise source orange variation while retaining dense oak anatomy.
        grey = grain.mean(axis=2,keepdims=True)
        grain = grey*.34+grain*.66
        pigment = grain + fibres[...,None]*np.array([1.7,1.5,1.2])
        pigment += broad[...,None]*np.array([1.3,1.0,.75])
        pigment -= pigment.mean(axis=(0,1), keepdims=True)
        color = pigment + np.array(rgb)
        lum = grain[...,0]*.24+grain[...,1]*.58+grain[...,2]*.18
        tool_surface = gaussian_filter(lum,(6,20),mode=('reflect','wrap'))
        tool_surface -= gaussian_filter(lum,(25,75),mode=('reflect','wrap'))
        if kind=='hewn':
            # Move broad source tool-value cues into relief instead of baking them
            # into the diffuse pigment. Fine wood colour remains in the albedo.
            color -= tool_surface[...,None]*np.array([.72,.64,.53])
        # Separate high/mid grain from broad albedo values; dark fibres recess.
        fine = lum-gaussian_filter(lum, (1.8, 7), mode=('reflect','wrap'))
        med = gaussian_filter(lum, (.8, 3), mode=('reflect','wrap'))
        med -= gaussian_filter(lum, (9, 45), mode=('reflect','wrap'))
        weather = kind=='weathered'
        fibre_relief = (fine*(.040 if weather else .021)
                       +med*(.050 if weather else .030)
                       +fibres*(.18 if weather else .085)
                       +splinters*(.28 if weather else .07)
                       -pores*(.16 if weather else .075))
        # Sheared lips expose short, slightly torn fibres, not a blurred bowl.
        fibre_relief += lip*np.clip(fibres,-2,2)*.18
        relief = fibre_relief-scallop-kerfs+broad*.07
        color += facet_tone[...,None]*np.array([1,.92,.78])
        color -= lip[...,None]*(3.0+pores[...,None]*2.8)*np.array([1,.90,.72])
        color -= (kerfs/.6)[...,None]*np.array([2.8,2.5,2.0])
        if weather:
            # Grey exposed fibres mixed with the underlying aged brown.
            dry = np.clip(.35+splinters*.20+broad*.09,0,.8)
            color += dry[...,None]*np.array([-3.5,.7,4.5])
            color += fibres[...,None]*np.array([1.3,1.3,1.2])
        r = {'hewn':.78,'sawn':.72,'weathered':.87}[kind]
        roughness = r + noise(rng,shape,(6,38))*.028 - fine*.0017
        # Small worn/oiled handling zones: smooth, patchy, never a global stripe.
        for j in range(2 if kind!='weathered' else 1):
            cx = rng.uniform(0,N)
            cy = rng.uniform(.25,.75)*h
            wear = np.exp(-(distance_x(x,cx)/rng.uniform(100,190))**2-((y-cy)/rng.uniform(24,47))**2)
            wear *= np.clip(1+noise(rng,shape,(5,25))*.20,.4,1.4)
            roughness -= wear*(.20 if kind!='weathered' else .10)
            # Hand contact wears the fine fibres, preserving the axe geometry.
            relief -= fibre_relief*wear*.15
        cav = np.zeros(shape, np.float32)
        cut_field = np.zeros(shape,np.float32)
        for check in [a for a in CHECKS if a['band']==k]:
            length = check['length_mm']/MM_PX
            dx = distance_x(x,check['x'])
            along = dx/(length/2)
            taper = np.maximum(0,1-along**2)**.65
            wiggle = (2.3*np.sin(dx/91+.2)+1.0*np.sin(dx/29)+.28*np.sin(dx/6.8))
            center = check['v']*N/12+wiggle
            width = check['width_mm']/MM_PX*(.78+.22*np.cos(dx/53)**2)*taper
            # A steep mouth, irregular split walls, and a recessed bottom.
            wall_jitter = np.clip(noise(rng,shape,(.25,4)),-2,2)*.10
            q = np.abs(y-center+wall_jitter)/(width*.5+.04)
            mouth = smoothstep((1-q)/.25)*smoothstep(taper/.12)
            g = mouth*(.72+.28*np.maximum(0,1-q*q))*taper**.28
            wall = mouth*(1-mouth)+mouth*np.clip(q,0,1)*.35
            wall_fibre = np.clip(fibres,-2,2)*wall*.55
            incision = np.maximum(0,check['depth_mm']*g+wall_fibre)
            relief -= incision
            cut_field = np.maximum(cut_field,incision)
            cav = np.maximum(cav, g)
            # Dark oxidised split wood is pigment; directional shadow stays in preview/AO.
            dark_wood = np.array([27,20,15])+fibres[...,None]*np.array([2.0,1.6,1.2])
            color = color*(1-mouth[...,None]*.88)+dark_wood*mouth[...,None]*.88
            roughness += g*.09
            # One short branching fibre split that rejoins the principal check.
            branch_y = center+5*np.sin(np.clip((along+.25)*4,0,np.pi))
            branch = np.exp(-((y-branch_y)/.55)**2)*np.exp(-((along-.15)/.30)**6)
            relief -= branch*1.4
            cut_field = np.maximum(cut_field,branch*1.4)
            color -= branch[...,None]*np.array([9,7,5])
            cav = np.maximum(cav,branch*.35)
        for peg in [a for a in PEGS if a['band']==k]:
            dx = distance_x(x,peg['x'])
            dy = y-peg['v']*N/12
            radius = np.sqrt(dx*dx+dy*dy)
            angle = np.arctan2(dy,dx)
            rim = 12.5/MM_PX+.20*np.sin(angle*7)+.14*np.sin(angle*11+.2)
            hole = smoothstep((rim-radius)/1.6)
            # Absolute bore floor avoids clipping a hole through a deep axe cut.
            relief = relief*(1-hole)-11.0*hole
            cav = np.maximum(cav,hole)
            color *= (1-hole[...,None]*.22)
            roughness = roughness*(1-hole)+.87*hole
        # Sparse impact bruises: real crushed grain and modest pigment bruising.
        for j in range(1 if k in (3,6,10) else 0):
            dx = distance_x(x,rng.uniform(100,N-100))
            q=(dx/rng.uniform(12,25))**2+((y-rng.uniform(.2,.8)*h)/rng.uniform(5,11))**2
            bruise = np.maximum(0,1-q)**1.5
            relief -= bruise*1.15
            color -= bruise[...,None]*np.array([7,6,4])
            roughness += bruise*.035
        iron = np.zeros(shape,np.float32)
        for stain in [a for a in IRON if a['band']==k]:
            dx=distance_x(x,stain['x'])
            dy=y-stain['v']*N/12
            soak=np.exp(-((dx/25)**2+(dy/9)**2)*.7)
            soak*=np.clip(.8+noise(rng,shape,(2,8))*.23,.2,1.3)
            nail=np.exp(-((dx/2.2)**2+(dy/1.8)**2))
            iron=np.maximum(iron,np.clip(soak*.55+nail*.35,0,.8))
            relief-=nail*1.4
            cav=np.maximum(cav,nail*.4)
        color=color*(1-iron[...,None])+np.array([31,28,26])*iron[...,None]
        wane=np.zeros(shape,np.float32)
        if k in WANE:
            # Wider, variable bark-side rounding, fully inside the exact band.
            side=y*MM_PX if k==2 else (N/12-y)*MM_PX
            wwidth=22+7*np.sin(2*np.pi*x/N+.4)+4*np.cos(6*np.pi*x/N)
            wane=(1-smoothstep(side/wwidth))*(.65+.35*np.sin(2*np.pi*x/N+.6)**2)
            relief-=wane*3.0
            color-=wane[...,None]*np.array([12,9,5])
            roughness+=wane*.04
        height[rows] = 13.4-1.45*edge+relief*envelope
        base[rows] = color
        rough[rows] = np.clip(roughness+edge*.035,.40,.96)
        edges[rows] = np.broadcast_to(edge,shape)
        cavity[rows] = cav
        tool_field[rows] = scallop
        kerf_field[rows] = kerfs
        check_field[rows] = cut_field
        fibre_field[rows] = fibre_relief
        wane_field[rows] = wane
        iron_field[rows] = iron
        metadata.append(dict(band=k, source=f'generated_{key}.png', source_strip=part,
            treatment=kind, rows=[int(rows[0]),int(rows[-1])], pixel_count=h,
            continuous_edges=[k*N/12,(k+1)*N/12], nominal_rgb=rgb,
            axe_cuts=axe_records,saw_cuts=saw_records))
        print(f'band {k+1:02d}/12: {kind}, rows {rows[0]}..{rows[-1]}', flush=True)
    # Rubbed pigment follows the existing softened 10 mm arris envelope.
    # Add a colour offset rather than blending toward a flat swatch: retain all
    # grain, weathering and wane detail. This adds no lighting or AO to colour.
    base += edges[...,None]*(np.array(ARRIS_SRGB)-np.array(BASE_MEAN_SRGB))
    # Centre after rubbing so the small bright edge area does not lift the mean.
    # Preserve band offsets and all interior hewing, kerf and check contrast.
    base += np.array(BASE_MEAN_SRGB)-base.mean(axis=(0,1),dtype=np.float64)
    base8 = np.rint(np.clip(base,0,255)).astype(np.uint8)
    assert height.min()>0 and height.max()<HEIGHT_MM, (height.min(),height.max())
    h16 = np.rint(height/HEIGHT_MM*65535).astype(np.uint16)
    save_png(ROOT/'timber_base.png',base8,True,'Unlit sRGB base colour; 3 x 3 m, 12 quarter-metre timbers.')
    save_png(ROOT/'timber_height.png',h16,note='Linear uint16: 0..65535 = 0..16 mm, white high. 3 x 3 m.')
    # Reload the delivered PNG: no hidden floating-point height differs from normal input.
    h16 = np.asarray(Image.open(ROOT/'timber_height.png'))
    normal = normals_from_height(h16)
    save_png(ROOT/'timber_normal.png',normal,note='Linear OpenGL tangent normals; X right, Y up, Z out; height-derived at 16 mm / 3 m.')
    ao = horizon_ao(h16.astype(np.float32)*(HEIGHT_MM/65535),edges,cavity)
    orm = np.stack((ao,rough,np.zeros_like(ao)),axis=2)
    save_png(ROOT/'timber_orm.png',np.rint(orm*255).astype(np.uint8),note='Linear data: R ambient occlusion, G roughness, B metalness=0.')
    np.savez_compressed(ROOT/'source'/'construction_fields.npz',band_ids=ids.astype(np.uint8),
        cavities=cavity,arris=edges,tool_depth_mm=tool_field,kerf_depth_mm=kerf_field,
        check_depth_mm=check_field,fibre_relief_mm=fibre_field,wane=wane_field,iron_stain=iron_field)
    config = dict(seed=SEED,size=N,tile_metres=3,height_range_mm=HEIGHT_MM,
        height_min_max_mm=[float(height.min()),float(height.max())],
        revision=4,base_mean_srgb=BASE_MEAN_SRGB,arris_srgb=ARRIS_SRGB,
        palette_method='Existing arris envelope adds T+ minus T in sRGB; centre on T; retain native pigment variation',
        bands=metadata,drying_checks=CHECKS,
        peg_holes=[dict(a,diameter_mm=25,floor_height_mm=2.4) for a in PEGS],
        iron_stains=IRON,waney_bands=WANE,
        source_scale='1 source pixel = 1 output pixel; two crops per band; no enlargement',
        build_seconds=round(time.time()-t,2))
    (ROOT/'source'/'construction.json').write_text(json.dumps(config,indent=2)+'\n')
    print(json.dumps({k:config[k] for k in ('height_min_max_mm','build_seconds')}))


if __name__=='__main__':
    build()
