#!/usr/bin/env python3
"""Deterministic native-patch material synthesis. Python + NumPy + SciPy + Pillow.

Run in either delivered material directory. No network, models, or outside assets
are needed: source/generated_*.png are the full-resolution frozen imagegen inputs.
All stochastic work is seeded. No source image is enlarged.
"""
from pathlib import Path
import hashlib
import json
import time
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter as gf, map_coordinates
from scipy.signal import find_peaks

ROOT = Path(__file__).resolve().parent
NAME = ROOT.name
N = 2048
SEED = 734219 if NAME == 'floor' else 875109
TILE_MM = 3000.0 if NAME == 'floor' else 1500.0
HEIGHT_MM = 8.0 if NAME == 'floor' else 10.0
# Frozen standard sRGB profile: creating it on each run writes a new timestamp
# into its metadata and changes the PNG bytes despite identical image pixels.
SRGB = (ROOT/'source/srgb.icc').read_bytes()


def rgb8(a):
    return np.clip(np.rint(a), 0, 255).astype(np.uint8)


def save_rgb(a, path, srgb=False):
    kw = {'icc_profile': SRGB} if srgb else {}
    Image.fromarray(rgb8(a)).save(path, **kw)


def luminance(a):
    return a[...,0]*.2126+a[...,1]*.7152+a[...,2]*.0722


def noise(rng, sigma, shape=(N, N)):
    a = gf(rng.normal(size=shape).astype(np.float32), sigma, mode='wrap')
    return a / max(float(a.std()), 1e-6)


def minpath(error):
    """Top-to-bottom minimum-cost cut; horizontal movement limited to 1 px."""
    h, w = error.shape
    back = np.zeros((h, w), np.int8)
    prev = error[0].copy()
    for y in range(1, h):
        candidates = np.stack((np.r_[np.inf, prev[:-1]], prev, np.r_[prev[1:], np.inf]))
        choice = candidates.argmin(axis=0)
        back[y] = choice - 1
        prev = error[y] + candidates[choice, np.arange(w)]
    cut = np.empty(h, np.int32)
    cut[-1] = prev.argmin()
    for y in range(h - 2, -1, -1):
        cut[y] = cut[y+1] + back[y+1, cut[y+1]]
    return cut


def quilt(sources, rng):
    """384px native crops, 128px overlaps, minimum-error cuts on a torus.

    The final column/row overlap the beginning of the image, so wrapping is
    constructed with intact source pixels, not repaired with mirrored edges.
    """
    size, stride, overlap = 384, 256, 128
    out = np.zeros((N, N, 3), np.float32)
    known = np.zeros((N, N), bool)
    records = []
    for y in range(0, N, stride):
        for x in range(0, N, stride):
            iy = (y + np.arange(size)) % N
            ix = (x + np.arange(size)) % N
            old = out[iy[:, None], ix]
            occupied = known[iy[:, None], ix]
            best = None
            # Match local colour and structure without rescaling the source.
            for k in range(32):
                si = int(rng.integers(len(sources)))
                src = sources[si]
                sy = int(rng.integers(5, src.shape[0] - size - 5))
                sx = int(rng.integers(5, src.shape[1] - size - 5))
                patch = src[sy:sy+size, sx:sx+size].copy()
                flip = int(rng.integers(4))
                if flip & 1:
                    patch = patch[:, ::-1].copy()
                if flip & 2:
                    patch = patch[::-1].copy()
                if NAME == 'earth':
                    rot = int(rng.integers(4))
                    patch = np.rot90(patch, rot).copy()
                else:
                    rot = 0
                delta = patch[::4, ::4] - old[::4, ::4]
                mask = occupied[::4, ::4]
                cost = float(np.mean(delta[mask]**2)) if mask.any() else 0
                if best is None or cost < best[0]:
                    best = cost, patch, [x, y, si, sx, sy, flip, rot]
            _, patch, rec = best
            records.append(rec)
            error = ((patch - old)**2).mean(axis=2)
            keep = np.zeros((size, size), bool)
            if x > 0:
                cut = minpath(error[:, :overlap])
                keep[:, :overlap] |= np.arange(overlap)[None, :] < cut[:, None]
            if x + size > N:
                cut = minpath(error[:, -overlap:])
                keep[:, -overlap:] |= np.arange(overlap)[None, :] >= cut[:, None]
            if y > 0:
                cut = minpath(error[:overlap, :].T)
                keep[:overlap, :] |= np.arange(overlap)[:, None] < cut[None, :]
            if y + size > N:
                cut = minpath(error[-overlap:, :].T)
                keep[-overlap:, :] |= np.arange(overlap)[:, None] >= cut[None, :]
            # Subpixel antialiasing on cut only, not a broad crossfade.
            weight = gf(keep.astype(np.float32), .55) * occupied
            merged = old * weight[..., None] + patch * (1 - weight[..., None])
            out[iy[:, None], ix] = merged
            known[iy[:, None], ix] = True
        print(f'{NAME}: native quilting row {y//stride+1}/8', flush=True)
    return out, records


def reed_master(sources, rng):
    """Trace generated reeds, then compose continuous, individually fitted stems.

    Source pixels are sampled at native horizontal scale. Each source strip is
    bounded by two dark grooves traced with dynamic programming. Cross-sections
    are fitted to a smaller physical reed width. Blend overlaps *within* the
    same reed, so there are no block cuts through neighbouring parallel stems.
    The generated papery skin, nodes and scuffs remain the image content.
    """
    libraries=[]
    for si,src in enumerate(sources):
        l=gf(luminance(src),(.8,7))
        seeds,_=find_peaks(-l.mean(axis=1),distance=5,prominence=1.4)
        traces=[]
        for seed in seeds:
            if seed<10 or seed>len(src)-11:
                continue
            rows=np.arange(seed-7,seed+8)
            cost=l[rows,:].T+.42*(rows-seed)[None,:]**2
            trace=gf((minpath(cost)+seed-7).astype(np.float32),2)
            traces.append(trace)
        for top,bottom in zip(traces[:-1],traces[1:]):
            width=bottom-top
            if width.min()>2.4 and 6<width.mean()<23:
                libraries.append((si,top,bottom))
    print(f'floor: extracted {len(libraries)} natural reed strips',flush=True)
    out=np.zeros((N,N,3),np.float32)
    geometry=np.zeros((N,N),np.float32)
    x=np.arange(N,dtype=np.float32)
    records=[]
    for mat,(ya,yb) in enumerate(zip([0,683,1365],[683,1365,2048])):
        count=88+rng.integers(-3,4)
        widths=rng.uniform(5.8,10.4,count)
        widths*=((yb-ya)/widths.sum())
        centers=ya+np.r_[0,np.cumsum(widths)]
        curves=[]
        for i,c in enumerate(centers):
            if i==0 or i==count:
                curves.append(np.full(N,c,np.float32))
            else:
                phase=rng.uniform(0,2*np.pi,3)
                curves.append(c+.8*np.sin(2*np.pi*x/N*2+phase[0])+.48*np.sin(2*np.pi*x/N*5+phase[1])+.20*np.sin(2*np.pi*x/N*13+phase[2]))
        for j,(top,bottom) in enumerate(zip(curves[:-1],curves[1:])):
            # Four native-scale pieces assembled into one periodic reed skin.
            skin=np.zeros((16,N,3),np.float32)
            weights=np.zeros(N,np.float32)
            for origin in [0,512,1024,1536]:
                li=int(rng.integers(len(libraries)))
                si,st,sb=libraries[li]
                src=sources[si]
                sx=int(rng.integers(2,src.shape[1]-770))
                sxv=sx+np.arange(768,dtype=np.float32)
                if rng.integers(2):
                    sxv=sxv[::-1]
                a=st[sxv.astype(int)]
                b=sb[sxv.astype(int)]
                sy=a[None,:]+(b-a)[None,:]*np.linspace(.02,.98,16,dtype=np.float32)[:,None]
                coords=np.stack((sy,np.broadcast_to(sxv,sy.shape)))
                patch=np.stack([map_coordinates(src[:,:,c],coords,order=1,mode='nearest') for c in range(3)],axis=2)
                blend=np.sin(np.pi*(np.arange(768)+.5)/768)**2
                ix=(origin+np.arange(768))%N
                skin[:,ix]+=patch*blend[None,:,None]
                weights[ix]+=blend
                records.append([mat,j,origin,li,sx])
            skin/=weights[None,:,None]
            ys=np.arange(max(ya,int(np.floor(top.min()))),min(yb,int(np.ceil(bottom.max()))))
            fraction=(ys[:,None]-top[None,:])/(bottom-top)[None,:]
            mask=(fraction>=0)&(fraction<1)
            coords=np.stack((np.clip(fraction,0,1)*15,np.broadcast_to(x,fraction.shape)))
            sampled=np.stack([map_coordinates(skin[:,:,c],coords,order=1,mode='wrap') for c in range(3)],axis=2)
            # Independent reed pigment variation, quiet enough to avoid stripes.
            sampled+=rng.uniform(-4,4)*np.array([1.,.82,.58])
            out[ys]=np.where(mask[...,None],sampled,out[ys])
            crown=np.sin(np.pi*np.clip(fraction,0,1))**.45
            amplitude=rng.uniform(1.65,2.0)
            z=1.55+amplitude*crown+.12*np.sin(2*np.pi*x/N*rng.integers(2,7)+rng.uniform(0,6.28))[None,:]
            geometry[ys]=np.where(mask,z,geometry[ys])
        print(f'floor: composed mat {mat+1}/3 from {count} continuous reeds',flush=True)
    return out,records,geometry


def stroke_layer(rng, count, floor=False, roots=False):
    """Sparse periodic subpixel curves. Draw supersampled then area-reduce."""
    scale = 2
    canvas = Image.new('L', (N*scale, N*scale))
    d = ImageDraw.Draw(canvas)
    for _ in range(count):
        x, y = rng.uniform(0, N, 2)
        length = rng.uniform(10, 55) if floor else rng.uniform(12, 58)
        theta = rng.normal(0, .18) if floor else rng.uniform(0, 2*np.pi)
        if roots:
            length = rng.uniform(35, 100)
        t = np.linspace(0, 1, 12)
        bend = rng.uniform(-3, 3) * np.sin(np.pi*t)
        px = x + t*length*np.cos(theta) - bend*np.sin(theta)
        py = y + t*length*np.sin(theta) + bend*np.cos(theta)
        width = int(rng.choice([2, 2, 3])) if not roots else 2
        for dy in [-N, 0, N]:
            for dx in [-N, 0, N]:
                pts = [((a+dx)*scale, (b+dy)*scale) for a, b in zip(px, py)]
                d.line(pts, fill=int(rng.integers(145, 240)), width=width)
    return np.asarray(canvas.resize((N, N), Image.Resampling.LANCZOS), np.float32)/255


def floor_material(src, rng, geometry):
    lum = luminance(src)
    local = gf(lum, (8, 30), mode='wrap')
    macro = gf(lum, 75, mode='wrap')
    # Remove field illumination, compress source relief contrast, retain hue.
    base = (src - src.mean(axis=(0, 1))) * .55 + np.array([168., 126., 71.])
    base -= (macro - macro.mean())[..., None] * .42
    h = geometry + (gf(lum,.45,mode='wrap')-gf(lum,2,mode='wrap'))*.012
    fibre = noise(rng, (.42, 7))
    fine = noise(rng, (.25, 1.6))
    base += (fibre*.9 + fine*.24)[..., None]
    h += fibre*.042 + fine*.011
    # Quiet wear spread across the floor. No painted central walkway motif.
    wear = np.clip(.48 + .13*noise(rng, (55, 130)), .08, .85)
    base += (wear-.48)[..., None] * np.array([-11., -7., -1.])
    rough = .83 - wear*.11 + .018*noise(rng, 2)
    # Three butt joints; equal treatment of the seam at the tile boundary.
    yy, xx = np.mgrid[:N, :N].astype(np.float32)
    seam = np.zeros((N, N), np.float32)
    for i, row in enumerate([0, 683, 1365]):
        # Exact centre rows with only a slight uneven edge, no wandering joint.
        width = 1.9 + .18*np.sin(2*np.pi*xx/N*7 + i)
        dy = (yy-row + N/2) % N - N/2
        joint = np.exp(-.5*(dy/width)**2)
        seam = np.maximum(seam, joint)
    base -= seam[..., None] * np.array([27., 23., 16.])
    # Blend into solid compressed backing, never an open hole between mats.
    h = h*(1-seam*.75)+.72*seam*.75
    rough += seam*.045
    # Compressed fibres at mat edges, still a solid floor below the butt.
    cord = np.zeros((N, N), np.float32)
    cord_positions = [35, 221, 409, 592, 780, 969, 1153, 1341, 1529, 1713, 1899]
    mat_bounds = [0, 683, 1365, 2048]
    cord_info = []
    for mat in range(3):
        ya, yb = mat_bounds[mat:mat+2]
        ys = np.arange(ya, yb, dtype=np.float32)
        offsets = rng.integers(-4, 5, len(cord_positions))
        cord_info.append((np.array(cord_positions)+offsets).tolist())
        for j, xc in enumerate(cord_positions):
            x0 = xc + int(offsets[j])
            xs = np.arange(x0-10, x0+11)
            cy = ys[:, None]
            cx = xs[None, :].astype(np.float32)
            phase = 2*np.pi*(cy-ya)/rng.uniform(7.5, 9.3) + rng.uniform(0, 6.28)
            center = x0 + .65*np.sin(2*np.pi*(cy-ya)/(yb-ya)*3 + j)
            idx = (ys.astype(int)[:, None], xs % N)
            existing_h = h[idx].copy()
            # Two actual twisted strands, height ordering alternates at crossings.
            strand_fields = []
            for side in [-1, 1]:
                dist = cx-center-side*.97*np.sin(phase)
                radius = 1.18
                alpha = np.clip((radius+.45-np.abs(dist))/.9, 0, 1)
                section = np.sqrt(np.maximum(0, 1-(dist/radius)**2))
                z = 4.15 + side*.30*np.cos(phase) + .72*section
                strand_fields.append((alpha, z))
            a1,z1 = strand_fields[0]
            a2,z2 = strand_fields[1]
            alpha = np.maximum(a1,a2)
            # Bindings terminate just inside each butt seam instead of making
            # a hard discontinuity as adjacent mats' cord positions differ.
            alpha *= np.clip(np.minimum(cy-ya,yb-1-cy)/3,0,1)
            z = np.maximum(np.where(a1>0,z1,0), np.where(a2>0,z2,0))
            twine_pigment = np.array([179., 139., 82.])[None, None, :]
            texture = 2.2*np.sin(phase*2 + (cx-center)*3.3)
            twine_color = twine_pigment + texture[...,None]
            b = base[idx]
            base[idx] = b*(1-alpha[...,None]) + twine_color*alpha[...,None]
            h[idx] = existing_h*(1-alpha) + np.maximum(existing_h,z)*alpha
            rough[idx] = rough[idx]*(1-alpha)+(.88+.02*np.sin(phase))*alpha
            cord[idx] = np.maximum(cord[idx],alpha)
    straw = stroke_layer(rng, 62, floor=True)
    base = base*(1-straw[...,None]*.65) + np.array([187,145,85])*straw[...,None]*.65
    h += straw*.48
    rough += straw*.035
    return base,h,rough,{'mat_seam_rows':[0,683,1365], 'cord_x_per_mat':cord_info}, {'seam':seam,'cord':cord,'straw':straw}


def earth_material(src, rng):
    lum = luminance(src)
    macro = gf(lum, 60, mode='wrap')
    local = gf(lum, 9, mode='wrap')
    base = (src-src.mean(axis=(0,1)))*.72 + np.array([129., 94., 63.])
    base -= (macro-macro.mean())[...,None]*.45
    grain = noise(rng, .42)
    grit = noise(rng, 1.3)
    clod = noise(rng, 10)
    # Light and dark pigment cannot determine absolute height: use local relief.
    h = 4.45 + np.tanh((gf(lum,.75,mode='wrap')-local)/12)*.72
    h += (gf(lum,3,mode='wrap')-gf(lum,24,mode='wrap'))*.035
    h += grain*.055 + grit*.115 + clod*.14
    base += (grain*.58+grit*.65)[...,None]
    rough = .937+.014*grit+.009*grain
    # Sparse irregular embedded grit/pebbles; no repeated circles or large stones.
    stones = np.zeros((N,N), np.float32)
    for _ in range(155):
        x,y = rng.uniform(0,N,2)
        rx = rng.uniform(2.2,8.5)
        ry = rx*rng.uniform(.5,.9)
        angle = rng.uniform(0,2*np.pi)
        radius = int(np.ceil(rx*1.4))+2
        xs = np.arange(int(x)-radius,int(x)+radius+1)
        ys = np.arange(int(y)-radius,int(y)+radius+1)
        dx,dy = np.meshgrid(xs-x,ys-y)
        u = (dx*np.cos(angle)+dy*np.sin(angle))/rx
        v = (-dx*np.sin(angle)+dy*np.cos(angle))/ry
        theta=np.arctan2(v,u)
        q=np.sqrt(u*u+v*v)*(1+.12*np.sin(theta*3+angle)+.08*np.cos(theta*5))
        a=np.clip((1.04-q)*3.5,0,1)
        idx=(ys[:,None]%N,xs%N)
        color=np.array([126.,112.,90.])+rng.uniform(-12,12)
        texture=grit[idx]*1.5+grain[idx]*1.0
        base[idx]=base[idx]*(1-a[...,None])+(color+texture[...,None])*a[...,None]
        crown=np.clip(1-q*q,0,1)*rng.uniform(.65,1.5)
        h[idx]+=crown*a
        rough[idx]=rough[idx]*(1-a)+a*rng.uniform(.79,.87)
        stones[idx]=np.maximum(stones[idx],a)
    roots=stroke_layer(rng, 35, roots=True)
    straw=stroke_layer(rng, 70)
    base=base*(1-roots[...,None]*.50)+np.array([105.,80.,54.])*roots[...,None]*.50
    h+=roots*.35
    base=base*(1-straw[...,None]*.70)+np.array([165.,133.,86.])*straw[...,None]*.70
    h+=straw*.45
    rough+=straw*.015
    return base,h,rough,{'side_band_height_mm':[100,200]}, {'stones':stones,'roots':roots,'straw':straw}


def main():
    started=time.perf_counter()
    rng=np.random.default_rng(SEED)
    paths=sorted((ROOT/'source').glob('generated_*.png'))
    if len(paths)!=2:
        raise RuntimeError('Expected the two frozen generated PNG source images')
    sources=[]
    source_info=[]
    target=np.array([178,133,75] if NAME=='floor' else [145,108,72],np.float32)
    for p in paths:
        a=np.asarray(Image.open(p).convert('RGB'),np.float32)
        source_info.append({'file':str(p.relative_to(ROOT)), 'size':[a.shape[1],a.shape[0]], 'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
        # Equalize source colour statistics before quilting to prevent patch grids.
        a=a-a.mean(axis=(0,1))+target
        sources.append(a)
    if NAME=='floor':
        src,placements,geometry=reed_master(sources,rng)
    else:
        src,placements=quilt(sources,rng)
    save_rgb(src,ROOT/'source/composed_master.png',True)
    if NAME=='floor':
        base,h,rough,layout,masks=floor_material(src,rng,geometry)
    else:
        base,h,rough,layout,masks=earth_material(src,rng)
    assert all(np.isfinite(a).all() for a in [base,h,rough]),'Non-finite material values'
    # Never auto-normalize height to image min/max: physical scale is fixed.
    q=np.rint(np.clip(h/HEIGHT_MM,0,1)*65535).astype(np.uint16)
    hp=ROOT/f'{NAME}_height.png'
    Image.fromarray(q).save(hp)
    # Re-open delivered quantized PNG; it is the sole input to normals and AO.
    hh=np.asarray(Image.open(hp),np.float32)*(HEIGHT_MM/65535)
    pitch=TILE_MM/N
    dx=(np.roll(hh,-1,axis=1)-np.roll(hh,1,axis=1))/(2*pitch)
    dy=(np.roll(hh,-1,axis=0)-np.roll(hh,1,axis=0))/(2*pitch)
    # Texture +Y is image UP. Since array y is down, normal green is +dH/drow.
    normal=np.stack((-dx,dy,np.ones_like(hh)),axis=2)
    normal/=np.linalg.norm(normal,axis=2,keepdims=True)
    cavity=np.maximum(0,gf(hh,2.0,mode='wrap')-hh)*.075
    cavity+=np.maximum(0,gf(hh,7.0,mode='wrap')-hh)*.055
    ao=np.clip(1-cavity,.65,1)
    orm=np.stack((ao,np.clip(rough,.65,.99),np.zeros_like(hh)),axis=2)
    save_rgb(base,ROOT/f'{NAME}_base.png',True)
    save_rgb((normal*.5+.5)*255,ROOT/f'{NAME}_normal.png')
    save_rgb(orm*255,ROOT/f'{NAME}_orm.png')
    np.savez_compressed(ROOT/'source/feature_masks.npz',**masks)
    manifest={'material':NAME,'size':N,'tile_mm':TILE_MM,'height_range_mm':HEIGHT_MM,
              'seed':SEED,'normal_convention':'OpenGL: +X right, +Y image up, +Z outward',
              'normal_method':'Wrapped central differences of reloaded delivered uint16 height; physical pixel pitch',
              'source_images':source_info,'composition':
              ({'method':'Individually traced generated reed strips, fitted across periodic physical reed geometry',
                'native_horizontal_scale':1.0,'strip_length_px':768,'strip_step_px':512,
                'placements_mat_reed_origin_library_source_x':placements} if NAME=='floor' else
               {'method':'Minimum-error toroidal native patch quilting','patch_px':384,'overlap_px':128,'native_scale':1.0,'candidate_count':32,
                'placements_xy_source_sx_sy_flip_rot':placements}),'layout':layout,
              'dependencies':{'python':'3.10+','numpy':'2.0.2','scipy':'1.13.1','pillow':'11.3.0'},
              'build_seconds':round(time.perf_counter()-started,2)}
    (ROOT/'source/build_manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({'material':NAME,'build_seconds':manifest['build_seconds'],'height_used_mm':[float(hh.min()),float(hh.max())]}),flush=True)


if __name__=='__main__':
    main()
