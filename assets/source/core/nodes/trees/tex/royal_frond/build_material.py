#!/usr/bin/env python3
"""Rebuild the royal frond material from the retained generated leaflet scans.

Python 3, numpy, scipy, Pillow. No network, model calls, or external inputs.
All working files and outputs are confined to this directory.
Image coordinates: +x right, +y down. Normal coordinates: +X right, +Y up.
"""
from pathlib import Path
import json
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from scipy.spatial import cKDTree, ConvexHull

ROOT = Path(__file__).resolve().parent
N = 2048
SS = 2
HEIGHT_MM = 10.0
LAYOUT = json.loads((ROOT / 'guide/LAYOUT.json').read_text())
PX = LAYOUT['pixels_per_metre_across']
PY = LAYOUT['pixels_per_metre_along']
SEEDS = [202611140, 202611141, 202611142]
ROUND1 = ROOT / 'source/round1'
AA_SIGMA_PX = .48


def smooth(a, b, x):
    u = np.clip((x-a)/(b-a), 0, 1)
    return u*u*(3-2*u)


def source_leaflets(filename):
    """Rectify six generated blades into intrinsic (length, cross-blade) space.

    The largest connected alpha component owns the blade. Generated transparent
    spill/speckles are excluded; a smoothed alpha outline supplies width(t).
    Retained pigment samples are from inside that outline, never background RGB.
    """
    a = np.asarray(Image.open(ROOT / 'source' / filename).convert('RGBA'))
    out = []
    for col in range(6):
        cut = a[:, col*a.shape[1]//6:(col+1)*a.shape[1]//6]
        labels, count = ndi.label(cut[..., 3] >= 190)
        hist = np.bincount(labels.ravel()); hist[0] = 0
        mask = labels == hist.argmax()
        mask = ndi.binary_fill_holes(mask)
        ys, xs = np.nonzero(mask)
        low, high = int(ys.min()), int(ys.max())
        center, half = [], []
        for y in range(low, high+1):
            xx = np.flatnonzero(mask[y])
            if len(xx):
                center.append((xx[0]+xx[-1])/2)
                half.append((xx[-1]-xx[0]+1)/2)
            else:
                center.append(center[-1]); half.append(half[-1])
        center = ndi.gaussian_filter1d(np.array(center), 9)
        half = ndi.gaussian_filter1d(np.array(half), 2)
        tt = np.linspace(0, 1, 1024)
        yy = high - tt*(high-low)
        cc = np.interp(yy-low, np.arange(len(center)), center)
        hh = np.interp(yy-low, np.arange(len(half)), half)
        vv = np.linspace(-.93, .93, 96)
        sx = cc[:, None]+hh[:, None]*vv
        sy = np.broadcast_to(yy[:, None], sx.shape)
        tex = np.stack([ndi.map_coordinates(cut[..., k].astype(float),
                         [sy, sx], order=1, mode='nearest') for k in range(3)], -1)
        # Low-frequency light removal, preserving mottling and fibres. Colour
        # targets are authored reflectance swatches, not generated illumination.
        blur = ndi.gaussian_filter(tex, (48, 14, 0))
        fine = np.clip(tex - blur, -32, 32)
        tissue = .42*fine + .10*(blur-blur.mean((0, 1)))
        shape = hh / np.percentile(hh, 99)
        shape = np.clip(shape, .0, 1)
        # Finest tip is defined at the final zero-width end of the source blade.
        shape *= np.minimum(1, (1-tt)*65)
        out.append({'pigment': tissue.astype(np.float32),
                    'shape': shape.astype(np.float32),
                    'origin': filename, 'column': col})
    return out


def bezier(ctrl, t):
    t = np.asarray(t)[:, None]
    return (1-t)**3*ctrl[0]+3*(1-t)**2*t*ctrl[1]+3*(1-t)*t*t*ctrl[2]+t**3*ctrl[3]


def leaf_spec(slot):
    """Metric curves, independent asymmetric phyllotaxy, three angle ranks."""
    rng = np.random.default_rng(SEEDS[slot])
    leaves = []
    n = [100, 98, 100][slot]
    for side in [-1, 1]:
        for i in range(n):
            u = (i+rng.uniform(-.25, .25)+(.28 if side == 1 else 0))/(n-1)
            u = float(np.clip(u, 0, .995))
            root_m = .421 + 3.70*u
            # Deliberate handful of missing leaflets, not a ragged comb.
            missing = (slot == 2 and i in ([23, 48, 63, 79] if side < 0 else [35, 51, 69]))
            if missing:
                continue
            bell = np.sin(np.pi * np.clip((u+.07)/1.07, 0, 1))**.78
            length = (.10*(1-u) + .78*bell) * rng.uniform(.94, 1.045)
            if slot == 1:
                length *= .89
            if u > .74:
                length *= 1-.38*((u-.74)/.26)
            rank = int(rng.choice([0,1,2], p=[.28,.43,.29]))
            group = 2.6*np.sin(i*.59+side*1.1)+2*np.sin(i*.19+slot)
            angle = 60 - 21*u + [-10, 0, 11][rank] + group + rng.normal(0, 2.5)
            if slot == 1:
                angle -= 3
            if slot == 2:
                angle += 8
            angle = np.deg2rad(angle)
            x = LAYOUT['slots'][slot]['midrib_x']
            y = (N-1) - root_m*PY
            dx = side * length*np.sin(angle)*PX
            dy = -length*np.cos(angle)*PY
            droop = length*PY * ([.08, .04, .25][slot]) * rng.uniform(.55, 1.45)
            # Tip direction turns from forward to slightly hanging. The dead
            # blade's last third folds down more; roots still join the midrib.
            ctrl = np.array([[x, y],
                             [x+dx*.31, y+dy*.34],
                             [x+dx*.74, y+dy*.80+droop*.08],
                             [x+dx, y+dy+droop]], dtype=float)
            # Fit physical outline by scaling the entire leaf, never chopping
            # at a slot boundary. Supersampled alpha is further checked below.
            lim = (LAYOUT['slots'][slot]['x0']+20 if side < 0 else
                   LAYOUT['slots'][slot]['x1']-21)
            if (side < 0 and ctrl[-1, 0] < lim) or (side > 0 and ctrl[-1, 0] > lim):
                ctrl[:, 0] = x+(ctrl[:, 0]-x)*(lim-x)/dx
            if ctrl[:, 1].min() < 4:
                ctrl[:, 1] = y+(ctrl[:, 1]-y)*(y-4)/(y-ctrl[:, 1].min())
            width_m = rng.uniform(.033, .040)
            if slot == 1:
                width_m *= .96
            width_m *= (.86+.14*bell)*min(1, length/.34)**.72
            source = int(rng.integers(0, 4) if slot == 0 else rng.integers(2, 6))
            broken = slot == 2 and i in ([18, 44, 58, 73, 85] if side < 0 else [28, 40, 66, 76])
            end = rng.uniform(.52, .80) if broken else 1.
            # Overlapping ranks have distinct heights, but no baked shading.
            lift = [.8, 2.0, 3.3][rank]+rng.uniform(-.25, .25)
            pigment = float(rng.uniform(-.075, .075))
            leaves.append(dict(slot=slot, side=side, index=i, u=u,
                               rank=rank, control=ctrl.tolist(), width_m=width_m,
                               nominal_length_m=length, angle_degrees=float(np.rad2deg(angle)),
                               source=source, end=end, broken=broken,
                               split=(not broken and rng.random()<(.09 if slot<2 else .24)),
                               lift_mm=lift, pigment= pigment,
                               phase=float(rng.uniform(0, 2*np.pi))))
    return leaves


def color_at(slot, u, t, pigment):
    if slot == 0:
        c = np.array([77., 115., 56.])
    elif slot == 1:
        c = np.array([115., 149., 65.])
    else:
        # A foot-to-tip progression, perturbed by whole-leaf age, plus a small
        # distal increase within each blade. Green base, ochre, rust, umber.
        age = np.clip(u + .10*t + pigment*.65, 0, 1)
        keys = [0, .22, .43, .69, 1.]
        cols = np.array([[117,139,62],[161,157,67],[176,143,59],
                         [155,108,53],[115,78,45]], float)
        return np.stack([np.interp(age, keys, cols[:, k]) for k in range(3)], -1)
    return c*(1+pigment) + np.zeros((*t.shape, 1))


def render_slot(slot, live, aged, detail):
    spec = LAYOUT['slots'][slot]
    w = spec['x1']-spec['x0']; h = N
    shape = (h*SS, w*SS)
    z = np.zeros(shape, np.float32)
    rgb = np.zeros((*shape, 3), np.float32)
    rough = np.full(shape, .56, np.float32)
    owner = np.zeros(shape, np.uint16)
    layers = np.zeros(shape, np.uint8)
    leaves = leaf_spec(slot)
    for number, leaf in enumerate(leaves, 1):
        ctrl = np.array(leaf['control']); ctrl[:, 0] -= spec['x0']
        tt = np.linspace(0, leaf['end'], 600)
        line = bezier(ctrl, tt)
        tang = np.gradient(line, axis=0)
        tang /= np.linalg.norm(tang, axis=-1, keepdims=True)
        half = leaf['width_m']*max(PX,PY)/2
        lo = np.floor((line.min(0)-half-3)*SS).astype(int)
        hi = np.ceil((line.max(0)+half+3)*SS).astype(int)
        x0, y0 = np.maximum(lo, [0, 0]); x1, y1 = np.minimum(hi, [w*SS, h*SS])
        # Conservative convex sweep: query/sample near this blade instead of
        # every empty pixel in its diagonal bounding rectangle. A polygon is
        # intentional: Pillow's thick polyline can leave cracks at very short
        # segment joins, which must never punch holes into a leaflet.
        candidate = Image.new('L',(x1-x0,y1-y0))
        perp = np.stack([-tang[:,1],tang[:,0]],axis=-1)
        bounds = np.concatenate([line+perp*(half+2), line-perp*(half+2)])
        hull = bounds[ConvexHull(bounds).vertices]
        path = (hull+.5)*SS-.5-np.array([x0,y0])
        ImageDraw.Draw(candidate).polygon([tuple(p) for p in path], fill=255)
        ly,lx = np.nonzero(np.asarray(candidate))
        gy = ly+y0; gx = lx+x0
        yy = (gy.astype(np.float32)+.5)/SS-.5
        xx = (gx.astype(np.float32)+.5)/SS-.5
        points = np.stack([xx.ravel(), yy.ravel()], -1)
        _, ix = cKDTree(line).query(points, workers=1)
        ix = ix.reshape(xx.shape)
        tangent = tang[ix]
        delta = np.stack([xx, yy], -1)-line[ix]
        signed = delta[..., 0]*(-tangent[..., 1])+delta[..., 1]*tangent[..., 0]
        # Refine the parameter to reduce any nearest-sample striping.
        along = np.sum(delta*tangent, -1)
        speed = np.linalg.norm(np.gradient(line, tt, axis=0), axis=-1)
        t = np.clip(tt[ix]+along/speed[ix], 0, 1)
        out_end = ((ix == len(tt)-1) & (along > .15)) | ((ix == 0) & (along < -.7))
        src = live[leaf['source']]
        if slot == 2:
            src = aged[int(np.clip(leaf['u']*5.8, 0, 5))]
        profile = np.interp(t, np.linspace(0, 1, 1024), src['shape'])
        # The generated scans have hair-thin cut attachments. A royal leaflet
        # instead joins the rachis through a broad, sheathing shoulder. Retain
        # the painted outline distally and rebuild only that first short join;
        # this also prevents detached leaf groups in ordinary alpha mipmaps.
        profile = np.maximum(profile, .90*np.clip(1-t/.24, 0, 1))
        # Physical blade width measured perpendicular in metres, respecting
        # unequal pixel pitches along/across the card.
        metric = np.sqrt((tangent[..., 1]/PX)**2+(tangent[..., 0]/PY)**2)
        hw = leaf['width_m']/(2*metric)*profile
        v = signed/np.maximum(hw, .04)
        inside = (np.abs(v) <= 1) & ~out_end & (t <= leaf['end'])
        if leaf['split']:
            split = (t > .85) & (np.abs(v+.11*np.sin(t*35+leaf['phase'])) < (t-.85)*1.8)
            inside &= ~split
        if leaf['broken']:
            end_t = leaf['end'] + .007*np.sin(v*14+leaf['phase'])
            inside &= t < end_t
        # No secondary leaf below the specified start of the bare petiole.
        inside &= yy <= (N-1)-.42*PY
        if not inside.any():
            continue
        v = np.clip(v, -1, 1)
        coords = [t*1023, (v+1)*.5*95]
        tissue = np.stack([ndi.map_coordinates(src['pigment'][..., c], coords,
                          order=1, mode='nearest') for c in range(3)], -1)
        # The revised generated tissue contributes pigment only: the original
        # sources still own every width profile, placement and damaged tip.
        if slot < 2:
            detail_src = detail[leaf['source']]['pigment']
            new_tissue = np.stack([ndi.map_coordinates(detail_src[..., c], coords,
                            order=1, mode='nearest') for c in range(3)], -1)
            tissue = .35*tissue + .65*new_tissue
        col = color_at(slot, leaf['u'], t, leaf['pigment']) + tissue
        # Small intrinsic asymmetry varies the two flank widths without moving
        # an outline. This is pigment, independent of any scene light direction.
        crease = .07*np.sin(leaf['phase']+t*3.0)*(1-smooth(.82, 1, t))
        cv = np.where(v < crease, (v-crease)/(1+crease), (v-crease)/(1-crease))
        flank = np.tanh(cv*12)
        strength = .78+.22*np.sin(leaf['phase']*1.7)
        col += flank[..., None]*np.array([7.5, 10.0, 4.4])*strength*(.65 if slot == 2 else 1)
        vein = np.exp(-(cv/.085)**2) * (1-t*.35)
        col += vein[..., None]*np.array([16.0, 20.0, 8.5])
        if slot < 2:
            dry = np.sin(leaf['index']*2.17+leaf['phase']) > .56
            tip = smooth(.87 if dry else .91, 1, t)*(.52 if dry else .30)
            tip_color = np.array([133, 107, 54] if dry else [145, 164, 86])
            col = col*(1-tip[..., None])+tip_color*tip[..., None]
        # Longitudinal tissue fibres in blade coordinates, never screen noise.
        fibres = (np.sin(v*35 + np.sin(t*11+leaf['phase'])*.30)
                  + .4*np.sin(v*69+t*2+leaf['phase']))
        col += fibres[..., None]*.75
        edge_age = np.maximum(np.abs(v)-.85, 0)/.15
        if slot == 2:
            col += edge_age[..., None]*np.array([5, 4, 2])
        # Each blade is a raised folded ribbon with rounded outer margins.
        # Cross section is continuous: planar crease flanks, central ridge,
        # gently rounded edges. Not an intensity-to-height conversion.
        fold_mm = (3.65 if slot < 2 else 2.85)*(.94+.10*np.sin(leaf['phase']))
        cross = (1-np.abs(cv))*fold_mm + np.sqrt(np.maximum(0, 1-cv*cv))*.38
        ridge = .38*np.exp(-(cv/.13)**2)
        # Broad planar faces turn to opposite lights; narrow vein relief sits on
        # the same displaced crease as pigment and the waxy roughness stripe.
        cross += .24*np.sin(leaf['phase']+.7)*cv*(1-np.abs(cv))
        size_factor = min(1, leaf['width_m']/.028)
        height = (leaf['lift_mm']*(1-.5*leaf['u'])
                  + (cross+ridge)*size_factor*(.8+.2*np.sin(np.pi*t))
                  + .18*np.sin(t*5+leaf['phase']) + fibres*.025)
        height *= .82+.18*np.minimum(t*16, 1)
        if slot == 2:
            height += .11*np.sin(t*75+v*9+leaf['phase'])*(t*.7+.3)
        layers[gy,gx] += inside.astype(np.uint8)
        visible = inside & (height > z[gy,gx])
        z[gy[visible],gx[visible]] = height[visible]
        rgb[gy[visible],gx[visible]] = col[visible]
        rough_val = ((.55 if slot == 0 else .49) + .035*leaf['pigment']/.075
                     + .014*fibres + .012*np.sin(t*13+leaf['phase']))
        if slot == 2:
            rough_val = .67+.17*leaf['u']+.015*fibres+.025*edge_age
        else:
            sheen = np.exp(-((cv+.035)/.22)**2)*(1-.55*smooth(.85, 1, t))
            rough_val -= .055*sheen
            rough_val += .025*tip
            rough_val = np.clip(rough_val, .45, .60)
        rough[gy[visible],gx[visible]] = rough_val[visible]
        owner[gy[visible],gx[visible]] = number
    # Straight smooth rachis and petiole at the exact guide column. The metric
    # curve of the arch belongs to the mesh, not this top-down texture.
    yy, xx = np.mgrid[:h*SS, :w*SS].astype(np.float32)
    xx = (xx+.5)/SS-.5; yy = (yy+.5)/SS-.5
    u = np.clip((N-1-yy)/(N-1), 0, 1)
    center = spec['midrib_x']-spec['x0']
    width = 12.8*(1-u)**.80 + .62
    # ~20 mm rachis through the main feather, tapered over the last 0.63 m.
    # The dying frond needs this continuity where missing leaves expose it.
    width = np.maximum(width, (9.0 if slot == 2 else 8.3)*np.minimum((1-u)/.15,1))
    v = (xx-center)/(width/2)
    rib = np.abs(v) <= 1
    rv = np.clip(v, -1, 1)
    rz = (2.0+6.0*np.sqrt(np.maximum(0, 1-rv*rv)))*(1-.55*u)
    rib_col = (np.array([133., 147., 78.])[None,None,:] +
               np.zeros((*u.shape, 1), np.float32))
    rib_col += (np.exp(-((rv+.07)/.19)**2)*5)[...,None]*np.array([1, 1, .55])
    rib_col += (np.sin(yy*.17+rv*11)*.75)[...,None]
    rib_col += np.maximum(0, 1-u/.10)[...,None]*np.array([13, 8, 4])
    if slot == 1:
        rib_col += np.array([7, 9, 3])
    if slot == 2:
        c = color_at(2, u, np.zeros_like(u), 0)
        rib_col = c*.82 + np.array([27, 20, 8])
    show = rib & (rz >= z)
    z[show] = rz[show]; rgb[show] = rib_col[show]
    rough[show] = .49 if slot < 2 else .73
    owner[show] = 65000; layers += rib.astype(np.uint8)
    solid = owner > 0
    # Transparent pixels get the nearest material colour all the way to this
    # slot's edge. Extend the height similarly before antialiasing, avoiding a
    # false black-ground cliff at each cutout boundary.
    _, indices = ndi.distance_transform_edt(~solid, return_indices=True)
    rgb = rgb[tuple(indices)]; z = z[tuple(indices)]
    rough = rough[tuple(indices)]
    def reduce(a):
        if a.ndim == 3:
            return a.reshape(h, SS, w, SS, a.shape[-1]).mean((1, 3))
        return a.reshape(h, SS, w, SS).mean((1, 3))
    alpha = reduce(solid.astype(np.float32))
    color = reduce(rgb)
    height = ndi.gaussian_filter(reduce(z), .30)
    roughness = reduce(rough)
    ids = owner.reshape(h, SS, w, SS)[:, 0, :, 0]
    overlaps = reduce(layers.astype(np.float32))
    # AO is restricted to places with a nearby second surface. Open tissue is
    # exactly one. AO is not multiplied into the base colour.
    cover = alpha >= .5
    # Remove any supersampling-isolated subpixel tip fragment, retaining the
    # single connected frond. This never fills a gap or fattens a thin blade.
    components, _ = ndi.label(cover, structure=np.ones((3,3)))
    counts = np.bincount(components.ravel()); counts[0] = 0
    main_component = counts.argmax()
    detached = (components != 0) & (components != main_component)
    alpha[detached] = 0
    cover = alpha >= .5
    alpha[~ndi.binary_dilation(cover, structure=np.ones((3,3)))] = 0
    # Integrate a compact subpixel filter over the existing 2x blade geometry.
    # The ~1.5 px 10-90% transition is never allowed to change the shipped
    # cutout at 0.5. Fractional fringe is sampling support, not a wider card.
    original = np.asarray(Image.open(ROUND1/'royal_frond_base.png'))[:, spec['x0']:spec['x1'], 3]
    locked_cover = original >= 128
    assert np.array_equal(cover, locked_cover), 'Original blade geometry changed'
    alpha = reduce(ndi.gaussian_filter(solid.astype(np.float32),
                                       AA_SIGMA_PX*SS, truncate=2.0))
    alpha = np.where(locked_cover, np.maximum(alpha, 128/255), np.minimum(alpha, 127/255))
    alpha[detached] = 0
    alpha[~ndi.binary_dilation(locked_cover, structure=np.ones((3,3)))] = 0
    # Quantize before deciding which samples need RGB padding.
    alpha = np.rint(alpha*255)/255
    # Remove the very faint convolution tail below the first leaf attachment;
    # preserve the guide's entirely bare 0.42 m petiole, including alpha support.
    stalk_rows = np.arange(h) >= np.ceil(N-1-LAYOUT['bare_stalk_m']*PY)
    away = np.abs(np.arange(w)-center) > 7.5
    alpha[np.ix_(stalk_rows, away)] = 0
    cover = locked_cover
    near_multi = ndi.gaussian_filter((overlaps >= 1.5).astype(float), 2.1)
    cavity = np.maximum(ndi.gaussian_filter(height, 2.0)-height-.08, 0)
    rib_dist = np.abs(np.arange(w)-(spec['midrib_x']-spec['x0']))
    proximal = np.exp(-(rib_dist/11)**2)[None, :]*(np.arange(h)[:, None]<1843)
    # Contact darkness belongs on the receiving/lower surface at a crossing.
    # Height discontinuities gate the owner boundaries, so adjacent fibre
    # shading never becomes AO and isolated blade edges remain unoccluded.
    boundary = ((ndi.maximum_filter(ids, 3) != ndi.minimum_filter(ids, 3)) & cover)
    lower_lip = np.maximum(ndi.maximum_filter(height, 3)-height-.25, 0)
    contact = ndi.gaussian_filter(boundary.astype(float)*np.minimum(lower_lip/2, 1), .55)
    ao = 1-np.clip(cavity*.20*near_multi + .18*contact*near_multi + proximal*.17, 0, .38)
    ao[~cover] = 1
    # Nearest *final opaque* sample supplies transparent colour, exact to the
    # final cutout. This invariant is independently verified by the checker.
    _, ii = ndi.distance_transform_edt(~cover, return_indices=True)
    zero = alpha == 0
    color[zero] = color[tuple(ii)][zero]
    roughness[zero] = roughness[tuple(ii)][zero]
    margin = LAYOUT['margin_px']
    assert np.max(alpha[:, :margin]) == 0 and np.max(alpha[:, -margin:]) == 0
    return color, alpha, height, ao, roughness, ids, overlaps, leaves


def normals(height16):
    mm = height16.astype(np.float64)/65535*HEIGHT_MM
    # Derivatives of delivered quantized height, at millimetres per pixel.
    dy, dx = np.gradient(mm, 1000/PY, 1000/PX)
    normal = np.stack([-dx, dy, np.ones_like(dx)], -1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    return np.rint((normal*.5+.5)*255).clip(0, 255).astype(np.uint8)


def main():
    (ROOT/'source').mkdir(exist_ok=True)
    live = source_leaflets('leaflets_living_generated.png')
    aged = source_leaflets('leaflets_aging_generated.png')
    detail = source_leaflets('leaflets_fold_detail_generated.png')
    swatches = np.concatenate([np.clip(leaf['pigment']+np.array([100,140,65]), 0, 255) for leaf in detail], axis=1)
    Image.fromarray(np.rint(swatches).astype(np.uint8)).save(ROOT/'source/round2_rectified_tissue.png')
    result = []
    for slot in range(3):
        print(f'Composing slot {slot}...', flush=True)
        result.append(render_slot(slot, live, aged, detail))
    fields = [np.concatenate([r[k] for r in result], axis=1) for k in range(7)]
    color, alpha, height, ao, rough, ids, overlap = fields
    h16 = np.rint(np.clip(height/HEIGHT_MM, 0, 1)*65535).astype(np.uint16)
    rgba = np.dstack([np.rint(color).clip(0, 255).astype(np.uint8),
                       np.rint(alpha*255).astype(np.uint8)])
    # Freeze the standard sRGB profile as an input: generated ICC creation
    # timestamps would otherwise make byte-identical rebuilds impossible.
    icc = (ROOT/'source/sRGB.icc').read_bytes()
    Image.fromarray(rgba).save(ROOT/'royal_frond_base.png', icc_profile=icc)
    Image.fromarray(h16).save(ROOT/'royal_frond_height.png')
    # Round trip from disk deliberately guarantees normal/height agreement.
    saved_h = np.asarray(Image.open(ROOT/'royal_frond_height.png'))
    Image.fromarray(normals(saved_h)).save(ROOT/'royal_frond_normal.png')
    orm = np.stack([ao, rough, np.zeros_like(ao)], -1)
    Image.fromarray(np.rint(orm*255).clip(0, 255).astype(np.uint8)).save(ROOT/'royal_frond_orm.png')
    Image.fromarray(ids).save(ROOT/'source/leaflet_ids.png')
    Image.fromarray(np.rint(np.minimum(overlap, 8)*8191).astype(np.uint16)).save(ROOT/'source/overlap_count.png')
    Image.fromarray(rgba).save(ROOT/'source/composed_master_2048.png', icc_profile=icc)
    leaves = [leaf for r in result for leaf in r[7]]
    metadata = dict(height_range_mm=HEIGHT_MM, dimensions=[N,N], supersampling=SS,
                    physical_slot_metres=[1.6,4.2], seeds=SEEDS,
                    normal_convention='OpenGL: +X right, +Y image-up, +Z outward',
                    revision=2, alpha_filter=dict(sigma_native_px=AA_SIGMA_PX,
                    truncate_sigma=2.0, locked_cutout='source/round1/royal_frond_base.png'),
                    tissue_source='source/leaflets_fold_detail_generated.png', leaves=leaves)
    (ROOT/'source/composition.json').write_text(json.dumps(metadata, indent=2)+'\n')
    print('Saved four 2048px maps and reproducible composition metadata.', flush=True)


if __name__ == '__main__':
    main()
