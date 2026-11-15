"""Paint the trousers' 227 x 59 mm card strip from the accepted feather elements.

    python3 -I tex/paint/trousers/paint.py

All coordinates below are millimetres on the card, before conversion into its
atlas rectangle. No image generation, opaque pieces, normal maps or study writes.
"""
from pathlib import Path
import hashlib
import json
import argparse
import site
import time

site.addsitedir(site.getusersitepackages())
import numpy as np
from PIL import Image, PngImagePlugin
from scipy.ndimage import distance_transform_edt, gaussian_filter, map_coordinates

ROOT = Path(__file__).resolve().parent
DODO = ROOT.parents[2]
STUDY = DODO / 'tex/studies/trousers'
SOURCE = STUDY / 'source'
LAYERS = ROOT / 'layers'
N = 2048
# Current group BRIEF.md: two rings per thigh, full width of this rectangle.
WIDTH_MM, DEPTH_MM = 227.0, 59.0
HEIGHT_MM = 2.0
SEED = 282048


def linear(a):
    return np.where(a <= .04045, a / 12.92, ((a + .055) / 1.055) ** 2.4)


def srgb(a):
    a = np.clip(a, 0, 1)
    return np.where(a <= .0031308, a * 12.92, 1.055 * a ** (1 / 2.4) - .055)


def png(path, a, colour=False, sixteen=False):
    info = PngImagePlugin.PngInfo()
    info.add(b'gAMA', (45455 if colour else 100000).to_bytes(4, 'big'))
    if colour:
        info.add(b'sRGB', b'\x00')
    data = np.rint(np.clip(a, 0, 1) * (65535 if sixteen else 255))
    data = data.astype(np.uint16 if sixteen else np.uint8)
    Image.fromarray(data).save(path, pnginfo=info)
    return data


def rectangle():
    bakes = json.loads((DODO / 'ref/bakes/bakes.json').read_text())
    uv = bakes['material dodo_cards']['rectangles']['trousers']
    u0, v0, u1, v1 = uv
    return [round(u0*N), round((1-v1)*N), round(u1*N), round((1-v0)*N)], uv


def read_sources():
    manifest = json.loads((SOURCE / 'elements.json').read_text())
    elements, hashes = [], {}
    for m in manifest:
        paths = [STUDY / m['cutout'], STUDY / m['height'],
                 STUDY / m['shaft'], STUDY / m['original_alpha']]
        for path in paths:
            hashes[str(path.relative_to(DODO))] = hashlib.sha256(path.read_bytes()).hexdigest()
        rgba = np.asarray(Image.open(paths[0]), np.float64) / 255
        alpha, base = rgba[..., 3], linear(rgba[..., 0])
        h = np.asarray(Image.open(paths[1]), np.float64) / 65535 * m['height_mm']
        shaft = np.asarray(Image.open(paths[2]), np.float64) / 255
        original_alpha = np.asarray(Image.open(paths[3]), np.float64) / 255
        rough = .91 - .038*shaft + .012*(1-gaussian_filter(original_alpha, 22))
        # Gentle rounding of loose locks, based on the same source-following
        # cross section as the accepted opaque tile, at card-appropriate depth.
        dist = gaussian_filter(distance_transform_edt(alpha > .36), 2.4)
        rounded = .55 * (1-np.exp(-(dist/25)**1.35))
        soft = gaussian_filter(alpha, 7)
        yy, xx = np.where(alpha > .5)
        elements.append(dict(meta=m, fields=[alpha, base, h+rounded, rough, soft],
                             visible_xy=np.column_stack([xx+.5, yy+.5]),
                             visible_width=float(xx.max()-xx.min())))
    return elements, hashes


def placements(elements):
    """Three overlapping beds with unequal intervals and independently varied tips."""
    rng = np.random.default_rng(SEED)
    result = []
    # Whole feathers retain their 60--90 mm length; the upper vane is buried
    # above the card root. Tip depths scale with the card's physical depth.
    for bed, count, tips, widths in [(0, 16, (24, 34), (32, 43)),
                                     (1, 15, (29, 42), (30, 42)),
                                     (2, 13, (34, 46), (29, 41))]:
        count=max(4,round(count*WIDTH_MM/288))
        tips=tuple(t*DEPTH_MM/48 for t in tips)
        gaps = rng.uniform(.62, 1.38, count)
        gaps *= WIDTH_MM / gaps.sum()
        xs = (np.cumsum(gaps) + rng.uniform(0, WIDTH_MM)) % WIDTH_MM
        ids = np.concatenate([rng.permutation(12), rng.permutation(12)])[:count]
        for i, (x, sid) in enumerate(zip(xs, ids)):
            angle = float(rng.uniform(-13, 13))
            length = float(rng.uniform(60, 90))
            width = float(rng.uniform(*widths))
            tip = float(rng.uniform(*tips))
            result.append(dict(bed=bed, index=i, source=int(sid), x_mm=float(x),
                               tip_depth_mm=tip, length_mm=length, width_mm=width,
                               angle_deg=angle, mirror=bool(rng.integers(2))))
    return result


def place(element, p, shape, shift=0):
    rows, cols = shape
    m = element['meta']
    root = np.asarray(m['root']) + .5
    sx = p['width_mm'] / element['visible_width']
    sy = p['length_mm'] / (m['tip'][1] - m['root'][1])
    if p['mirror']:
        sx *= -1
    a = np.deg2rad(p['angle_deg']); co, si = np.cos(a), np.sin(a)
    transform = np.array([[co*sx, -si*sy], [si*sx, co*sy]])
    relative = element['visible_xy'] - root
    occupied = np.column_stack([relative[:,0]*transform[0,0]+relative[:,1]*transform[0,1],
                                relative[:,0]*transform[1,0]+relative[:,1]*transform[1,1]])
    origin = np.array([p['x_mm']+shift, p['tip_depth_mm']-occupied[:, 1].max()])
    p['root_depth_mm'] = float(origin[1])
    ih, iw = element['fields'][0].shape
    corners = np.array([[0, 0], [iw, 0], [0, ih], [iw, ih]]) - root
    corners = np.column_stack([corners[:,0]*transform[0,0]+corners[:,1]*transform[0,1],
                               corners[:,0]*transform[1,0]+corners[:,1]*transform[1,1]]) + origin
    pixel_size = np.array([WIDTH_MM/cols, DEPTH_MM/rows])
    lo = np.maximum(np.floor(corners.min(0)/pixel_size-2).astype(int), 0)
    hi = np.minimum(np.ceil(corners.max(0)/pixel_size+2).astype(int), [cols, rows])
    l, t = lo; r, b = hi
    if r <= l or b <= t:
        return None
    yy, xx = np.mgrid[t:b, l:r]
    world = np.stack([(xx+.5)*pixel_size[0], (yy+.5)*pixel_size[1]], -1)
    delta = world-origin
    coords = np.stack([(co*delta[...,0]+si*delta[...,1])/sx,
                       (-si*delta[...,0]+co*delta[...,1])/sy], -1) + root - .5
    sample = [map_coordinates(f, [coords[..., 1], coords[..., 0]], order=1,
                              mode='constant', cval=0, prefilter=False) for f in element['fields']]
    return np.s_[t:b, l:r], sample


def extend_strip(a, valid):
    """Continue channels through the cut, including across the strip's repeat."""
    w = valid.shape[1]
    support = np.tile(valid, (1, 3))
    indices = distance_transform_edt(~support, return_distances=False, return_indices=True)
    return np.tile(a, (1, 3))[tuple(indices)][:, w:2*w]


def delight_strip(base, height, valid):
    """Remove only broad placement drift; preserve the source's fine barb drawing."""
    rows,cols=base.shape;dx,dy=WIDTH_MM/cols,DEPTH_MM/rows
    gx=(np.roll(height,-1,1)-np.roll(height,1,1))/(2*dx)
    gy=np.gradient(height,dy,axis=0)
    normal=np.stack([-gx,gy,np.ones_like(height)],-1)
    normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
    yy,xx=np.mgrid[:rows,:cols]
    sx=np.sin(2*np.pi*(xx+.5)/cols);y=(yy+.5)/rows-.5
    basis=[np.ones_like(base),sx,y,sx*y]
    modes=[normal[...,k]-normal[...,k][valid].mean() for k in range(3)]
    basis.extend(gaussian_filter(m,(3/dy,3/dx),mode=('nearest','wrap')) for m in modes)
    out=base.copy()
    for _ in range(2):
        matrix=[];target=[]
        for row in range(2):
            for col in range(2):
                sl=np.s_[row*rows//2:(row+1)*rows//2,col*cols//2:(col+1)*cols//2]
                mask=valid[sl]
                matrix.append([f[sl][mask].mean() for f in basis]);target.append(out[sl][mask].mean()-.5)
        for m in modes:
            matrix.append([np.mean((m*f)[valid]) for f in basis]);target.append(np.mean((m*out)[valid]))
        for coefficient,field in zip(np.linalg.solve(matrix,target),basis):out-=coefficient*field
    out=np.clip(out,.12,.90)
    # Log how much of the fine drawing remains after the broad correction.
    before=base-gaussian_filter(base,(.5/dy,.5/dx),mode=('nearest','wrap'))
    after=out-gaussian_filter(out,(.5/dy,.5/dx),mode=('nearest','wrap'))
    facts=dict(correction_sigma_mm=3.0,correction_rms_linear=float((out-base)[valid].std()),
               fine_barb_contrast_ratio=float(after[valid].std()/before[valid].std()),
               fine_barb_correlation=float(np.corrcoef(before[valid],after[valid])[0,1]))
    return extend_strip(out,valid),facts


def make_strip(elements, positions, shape):
    premult = np.zeros(shape); alpha = np.zeros(shape)
    height_sum = np.zeros(shape); soft_alpha = np.zeros(shape)
    rough_sum = np.zeros(shape)
    for p in positions:
        for shift in [-WIDTH_MM, 0, WIDTH_MM]:
            result = place(elements[p['source']], p, shape, shift)
            if result is None:
                continue
            sl, (a, b, h, r, soft) = result
            premult[sl] = b*a + premult[sl]*(1-a)
            rough_sum[sl] = r*a + rough_sum[sl]*(1-a)
            alpha[sl] = a + alpha[sl]*(1-a)
            height_sum[sl] = (h + .12*p['bed'])*soft + height_sum[sl]*(1-soft)
            soft_alpha[sl] = soft + soft_alpha[sl]*(1-soft)
    valid = alpha >= .5
    base = premult / np.maximum(alpha, 1e-12)
    rough = rough_sum / np.maximum(alpha, 1e-12)
    height = height_sum / np.maximum(soft_alpha, 1e-12)
    # No extrusion to a zero-height background at the feather's cut edge.
    base, rough, height = [extend_strip(f, valid) for f in [base, rough, height]]
    # This is already a continuous circular field. Put its atlas boundary in a
    # quiet part of that field rather than through a dense group of free wisps.
    # A common integer translation changes neither a feather nor its overlaps.
    scores=[]
    for field in [base,height,alpha]:
        steps=np.abs(field-np.roll(field,1,axis=1)).mean(axis=0)
        scores.append(steps/max(steps.mean(),1e-12))
    score=np.maximum.reduce(scores)
    phase=int(np.argmin(score[::4])*4)
    base,rough,height,alpha,valid=[np.roll(f,-phase,axis=1) for f in [base,rough,height,alpha,valid]]
    for p in positions:p['x_mm']=(p['x_mm']-phase*WIDTH_MM/shape[1])%WIDTH_MM
    base,delight=delight_strip(base,height,valid)
    rows, cols = shape
    dx, dy = WIDTH_MM/cols, DEPTH_MM/rows
    occ = np.zeros(shape)
    pad = 64
    padded = np.pad(height, ((pad, pad), (0, 0)), mode='edge')
    for ox, oy in [(1,0),(-1,0),(0,1),(0,-1),(1,1),(-1,1),(1,-1),(-1,-1)]:
        horizon = np.zeros(shape)
        for radius in [2, 5, 12, 25, 48]:
            neighbour = np.roll(padded, ox*radius, 1)[pad+oy*radius:pad+oy*radius+rows]
            rise = np.maximum(neighbour-height-.006, 0)
            horizon = np.maximum(horizon, np.arctan2(rise, radius*np.hypot(ox*dx, oy*dy)))
        occ += np.sin(horizon)/8
    occlusion = np.clip(1-occ*1.4, .78, 1)
    return dict(base=base, alpha=alpha, height=height, rough=rough, occlusion=occlusion,
                delight=delight,repeat_phase_px=phase)


def main():
    global WIDTH_MM,DEPTH_MM
    parser=argparse.ArgumentParser()
    parser.add_argument('--width-mm',type=float,default=WIDTH_MM)
    parser.add_argument('--depth-mm',type=float,default=DEPTH_MM)
    args=parser.parse_args()
    WIDTH_MM,DEPTH_MM=args.width_mm,args.depth_mm
    if not (100<=WIDTH_MM<=400 and 16<=DEPTH_MM<=70):
        parser.error('Card span must be 100--400 mm along and 16--70 mm down.')
    started = time.monotonic()
    LAYERS.mkdir(exist_ok=True)
    box, uv = rectangle()
    l,t,r,b = box
    elements, source_hashes = read_sources()
    positions = placements(elements)
    strip = make_strip(elements, positions, (b-t, r-l))
    own = np.s_[t:b, l:r]
    base = np.zeros((N,N,4), np.float64)
    base[own] = np.dstack([np.repeat(srgb(strip['base'])[...,None], 3, -1), strip['alpha']])
    png(LAYERS/'cards_base.png', base, colour=True)
    for key in ['height', 'rough', 'occlusion']:
        full = np.zeros((N,N), np.float64)
        full[own] = strip[key] / (HEIGHT_MM if key == 'height' else 1)
        png(LAYERS/f'cards_{key}.png', full, sixteen=(key=='height'))
    regions = np.zeros((N,N,3), np.float64); regions[t:b,l:r,0] = 1
    png(LAYERS/'cards_regions.png', regions)
    # This group owns no opaque pieces. Explicit empty layers keep the contract
    # complete and cannot paint over another group's texels.
    png(LAYERS/'dodo_base.png', np.zeros((N,N,4)), colour=True)
    png(LAYERS/'dodo_height.png', np.zeros((N,N)), sixteen=True)
    for key in ['rough', 'occlusion']:
        png(LAYERS/f'dodo_{key}.png', np.zeros((N,N)))
    png(LAYERS/'dodo_regions.png', np.zeros((N,N,3)))
    info = dict(group='trousers', height_mm=HEIGHT_MM, cards_height_mm=HEIGHT_MM,
                opaque_pieces=[], cards=['trousers'], card_rectangle_uv=uv,
                card_box_px=box, card_size_mm=[WIDTH_MM, DEPTH_MM], alpha_cutoff=.5,
                region=0, seed=SEED, feather_count=len(positions),
                drawing_preservation=strip['delight'],
                repeat_phase_px=strip['repeat_phase_px'],
                sources='Accepted trousers study; twelve separate fringe specimens.',
                source_sha256=source_hashes)
    (LAYERS/'layers.json').write_text(json.dumps(info, indent=2)+'\n')
    (LAYERS/'placements.json').write_text(json.dumps(positions, indent=2)+'\n')
    print(json.dumps(dict(seconds=round(time.monotonic()-started, 2),
                         box=box, feathers=len(positions),
                         grey_linear=float(strip['base'][strip['alpha']>=.5].mean()),
                         top_alpha_min=float(strip['alpha'][0].min())), indent=2))


if __name__ == '__main__':
    main()
