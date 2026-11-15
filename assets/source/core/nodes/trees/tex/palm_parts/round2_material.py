"""Two local revisions; shared coordinates drive colour, height and roughness.

The original generator still runs with its original RNG sequence before these
patches replace crownshaft/root, so no accepted region's pixels can drift.
"""
import numpy as np
from scipy.ndimage import map_coordinates, gaussian_filter1d
from build_material import load, quilt, source_patch, smooth, ease, noise


def luminance(a):
    # Explicit channel arithmetic also supports the strided RGB view in the
    # registered RGB+mask buffer, without platform BLAS floating-point flags.
    return a[...,0]*.2126+a[...,1]*.7152+a[...,2]*.0722


def register_channels(a, width, height):
    """Quilt RGB and its feature masks together with exactly the same warp."""
    a = quilt(a)
    pad = np.pad(a, ((0, 0), (4, 4), (0, 0)), mode='wrap')
    yy, xx = np.meshgrid((np.arange(height)+.5)*a.shape[0]/height-.5,
                         (np.arange(width)+.5)*a.shape[1]/width-.5+4, indexing='ij')
    return np.stack([map_coordinates(pad[..., c], [yy, xx], order=3, mode='nearest')
                     for c in range(a.shape[2])], -1)


def crownshaft(previous):
    rng = np.random.default_rng(284712)
    src = load('crownshaft_round2')
    ht, wd = src.shape[:2]
    yy, xx = np.mgrid[:ht, :wd]
    # Guide coordinates traced on the retained 1254-square source. Snap each
    # guide to its painted boundary, then smooth the trace along the sheath.
    anchors = [
        [145,139,148,166,192,215,237,250,254,253,252,247,246],
        [464,444,429,419,416,422,444,479,514,547,566,580,590],
        [748,742,747,766,808,854,906,952,983,1003,1020,1036,1049],
        [1084,1073,1059,1047,1030,1015,1005,1004,1008,1014,1020,1036,1049],
    ]
    lum = luminance(src)
    residual = lum-smooth(lum, 2, 3, False)
    relief = np.zeros((ht, wd), np.float32)
    line = np.zeros_like(relief)
    rim = np.zeros_like(relief)
    trace_rows = np.arange(ht)
    for i, anchors_x in enumerate(anchors):
        guide = np.interp(trace_rows*1254/ht, np.arange(13)*100, anchors_x)*wd/1254
        candidates = np.clip(np.rint(guide[:,None]+np.arange(-7,8)).astype(int),0,wd-1)
        strength = np.abs(residual[trace_rows[:,None], candidates])
        trace = candidates[trace_rows, strength.argmax(1)]
        trace = gaussian_filter1d(trace.astype(float), 25)
        d = xx-trace[:,None]
        active = 1-ease((yy/ht-.68)/.13) if i==3 else np.ones_like(d)
        # Each smooth lip rises 1.25–1.55 mm, with a 0.16 mm shoulder and a
        # narrow dark pigment line immediately beside the overlap.
        lip = np.exp(-.5*(d/(3.4+.5*i))**2)*active
        shoulder = np.exp(-.5*((d-6)/16)**2)*active
        relief = np.maximum(relief,(.00125+.00010*i)*lip+.00016*shoulder)
        rim = np.maximum(rim, lip)
        line = np.maximum(line, np.exp(-.5*((d+4.5)/1.8)**2)*active)
    dry = ease((src[...,0]-src[...,1]+30)/16)
    dry *= ease((yy-25)/15)*(1-ease((yy-ht+55)/15))
    registered = register_channels(np.dstack((src, relief, line, rim, dry)),1024,1024)
    s = registered[...,:3]
    relief, line, rim, dry = [np.clip(registered[...,i],0,None) for i in range(3,7)]
    dry = np.clip(dry,0,1)
    yy, xx = np.mgrid[:1024,:1024]
    y = yy/1023
    l = luminance(s)
    # Treat broad source streaks as pigment, not baked cylinder illumination.
    streak = smooth(l,28,11)
    streak -= streak.mean(axis=1,keepdims=True)
    streak /= np.maximum(np.percentile(np.abs(streak),90,axis=1,keepdims=True),1)
    streak = np.tanh(streak/1.1)
    top = np.array([136.,165.,73.])
    bottom = np.array([72.,116.,70.])
    grade = ease((y-.06)/.90)[...,None]
    pigment = top*(1-grade)+bottom*grade
    # +/- 7% sRGB luminance around a row's mean: broad streaks survive mips.
    base = pigment*(1+.084*streak[...,None])
    source_detail = s-smooth(s,9,2)
    base += source_detail*.38
    base -= line[...,None]*np.array([12.,15.,7.])
    base += rim[...,None]*np.array([2.,3.,1.])
    base = base*(1-dry[...,None])+np.array([159.,140.,98.])*dry[...,None]
    fine = noise((1024,1024),7,.65,rng)
    base += fine[...,None]*.36
    # Streak undulation spans ~1.2 mm. The narrow sheath lips carry the
    # stronger normal response without turning the whole tissue into bark.
    h = .008+.00066*streak+relief+fine*.000014
    striation = l-smooth(l,2,1)
    h += .000035*np.tanh(striation/4)
    h -= dry*.00012
    rough = np.clip(.299-.010*streak+fine*.002+dry*.030,.25,.35)
    # Keep the exact registered round-one thin tan/grey trunk collar and its
    # dry roughness. It is the sole non-glossy material at the shaft's foot.
    old_b, old_h, old_r, old_masks = previous
    collar = ease((yy-982)/10)
    base = base*(1-collar[...,None])+old_b*collar[...,None]
    h = h*(1-collar)+old_h*collar
    rough = rough*(1-collar)+old_r*collar
    top_lip = ease((11+1.6*np.sin(xx*2*np.pi/1024*3)-yy)/4)
    base = base*(1-top_lip[...,None])+np.array([159,180,85])*top_lip[...,None]
    h += top_lip*.0004
    return base,h,rough,{
        'green_mask':old_masks['green_mask'],
        'crownshaft_round2_edge_relief_m':relief,
        'crownshaft_round2_edge_line':line,
        'crownshaft_round2_streak':streak,
        'crownshaft_round2_dry_mask':dry,
    }


def root():
    rng = np.random.default_rng(284713)
    s = source_patch(load('root_round2'),512,512)
    yy, xx = np.mgrid[:512,:512]
    y = yy/511
    l = luminance(s)
    # Explicit sRGB swatch at mid root, greyer above, dark dirt below.
    pale = 1-ease(y/.37)
    soil = ease((y-.40)/.57)
    target = np.array([120.,103.,74.])+pale[...,None]*np.array([15.,23.,35.])
    target -= soil[...,None]*np.array([49.,40.,23.])
    row_average = smooth(s.mean(axis=1,keepdims=True),12,0)
    low = smooth(s,3,2)
    base = target+.52*(low-row_average)+.36*(s-low)
    fibres = noise((512,512),6,.6,rng)
    base += fibres[...,None]*.48
    medium = smooth(l,1.2,.65)-smooth(l,9,7)
    micro = l-smooth(l,1,1)
    # Keep natural tiny source hairs as raised fibres and breakup in dirt.
    h = .008+.000019*np.tanh(medium/9)+.000006*np.tanh(micro/7)
    h += fibres*.0000022
    grains = np.maximum(noise((512,512),1.0,1.0,rng)-.55,0)
    h += soil*grains*.000024
    base -= (soil*grains)[...,None]*2.3
    # A tiny source-local red abrasion; all unbroken tissue stays grey-brown.
    fresh = ease((s[...,0]-s[...,1]-22)/16)*(1-soil)
    base += fresh[...,None]*np.array([9.,-2.,-2.])
    rough = np.clip(.835+.046*soil+fibres*.004,.80,.90)
    return base,h,rough,{'root_round2_soil_mask':soil,'root_round2_fresh_mask':fresh}
