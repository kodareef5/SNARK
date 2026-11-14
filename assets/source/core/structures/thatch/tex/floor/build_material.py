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
HEIGHT_MM = 12.0 if NAME == 'floor' else 10.0
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
    reed_side=np.zeros((N,N),np.float32)
    pigment=np.zeros((N,N,3),np.float32)
    nodes=np.zeros((N,N),np.float32)
    reed_records=[]
    x=np.arange(N,dtype=np.float32)
    records=[]
    for mat,(ya,yb) in enumerate(zip([0,683,1365],[683,1365,2048])):
        count=171+int(rng.integers(-2,3))
        widths=rng.uniform(3.4,4.6,count)
        widths*=((yb-ya)/widths.sum())
        centers=ya-.5+np.r_[0,np.cumsum(widths)]
        curves=[]
        shared=.48*np.sin(2*np.pi*x/N*3+mat)+.22*np.sin(2*np.pi*x/N*7+mat*2)
        for i,c in enumerate(centers):
            if i==0 or i==count:
                curves.append(np.full(N,c,np.float32))
            else:
                phase=rng.uniform(0,2*np.pi,3)
                taper=min(i/5,(count-i)/5,1)
                curves.append(c+shared*taper+.09*np.sin(2*np.pi*x/N*2+phase[0])+.06*np.sin(2*np.pi*x/N*5+phase[1]))
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
            sampled=np.stack([map_coordinates(skin[:,:,c],coords,order=1,mode='grid-wrap') for c in range(3)],axis=2)
            # Keep natural skin detail; author individual pigments separately.
            sampled-=sampled.mean(axis=(0,1))-np.array([178.,133.,75.])
            out[ys]=np.where(mask[...,None],sampled,out[ys])
            t=np.clip(fraction,0,1)
            # Circular upper cross-section, with the narrow contact groove intact.
            crown=np.sqrt(np.maximum(0,1-((t-.5)/.47)**2))
            amplitude=rng.uniform(3.25,4.25)
            z=2.25+amplitude*crown+.18*np.sin(2*np.pi*x/N*rng.integers(2,7)+rng.uniform(0,6.28))[None,:]
            geometry[ys]=np.where(mask,z,geometry[ys])
            # Fine skin has a brighter crown and darker outer sheath. Actual
            # lighting remains in the height-derived normal, never baked AO.
            side=(crown-.72)*19+np.sin(2*np.pi*t)*3.5
            reed_side[ys]=np.where(mask,side,reed_side[ys])
            tone=rng.normal(0,10.5)*np.array([1.,.88,.61])+rng.normal(0,2)*np.array([.15,.3,1.])
            drift=3*np.sin(2*np.pi*x/N*int(rng.integers(2,5))+rng.uniform(0,6.28))
            pigment[ys]=np.where(mask[...,None],tone+drift[None,:,None],pigment[ys])
            node_count=int(rng.integers(2,6))
            node_x=rng.uniform(0,N,node_count)
            node_field=np.zeros_like(fraction)
            for nx in node_x:
                distance=(x[None]-nx+(t-.5)*1.5+N/2)%N-N/2
                ring=np.exp(-.5*(distance/.65)**2)*(crown*.8+.2)
                collar=np.exp(-.5*((distance-1.25)/.8)**2)*crown
                node_field=np.maximum(node_field,ring)
                geometry[ys]+=np.where(mask,collar*.5-ring*.2,0)
            nodes[ys]=np.where(mask,node_field,nodes[ys])
            reed_records.append({'mat':mat,'reed':j,'width_px':float(widths[j]),
                                 'actual_width_min_px':float((bottom-top).min()),
                                 'actual_width_max_px':float((bottom-top).max()),
                                 'node_x':node_x.tolist()})
        print(f'floor: composed mat {mat+1}/3 from {count} continuous reeds',flush=True)
    return out,records,geometry,{'reed_side':reed_side,'pigment':pigment,'nodes':nodes},reed_records


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


def floor_material(src, rng, geometry, fields):
    """Round 2: round stems, worn handfuls, twisted bindings and shallow butts.

    Every field is periodic before maps are derived. The mat boundary is between
    texel centres (row -.5), with solid compressed fibres across its centre.
    """
    lum = luminance(src)
    macro = gf(lum, (40, 90), mode='wrap')
    base = (src - src.mean(axis=(0, 1))) * .83 + np.array([175.,135.,80.])
    base -= (macro-macro.mean())[...,None]*.45
    base += fields['pigment']
    base += fields['reed_side'][...,None]*np.array([1.,.91,.66])
    base -= fields['nodes'][...,None]*np.array([31.,26.,17.])
    fine = noise(rng, (.38, 5.5))
    base += fine[...,None]*1.15
    h = geometry + (gf(lum,.4,mode='wrap')-gf(lum,2,mode='wrap'))*.008+fine*.045

    # Colour groups survive mip reduction; these are bundles of neighboring
    # reeds rather than a uniform noise layer or a central painted walkway.
    handful = noise(rng, (13, 84))
    base += handful[...,None]*np.array([7.4,6.4,4.8])
    h += np.clip(handful,-2,2)*.24
    weather = noise(rng, (60,105))
    worn = np.clip((weather-.65)/1.65,0,1)
    pale = np.clip((-weather-.85)/1.5,0,1)
    base -= worn[...,None]*np.array([26.,22.,13.])
    base += pale[...,None]*np.array([19.,18.,14.])
    h -= worn*.52
    rough = .85-worn*.12+pale*.015+.012*noise(rng,1.5)

    cord_positions = [35,221,409,592,780,969,1153,1341,1529,1713,1899]
    bounds=[0,683,1365,2048]
    cord_info=[]
    # Low mattress bellies lie between the binding rows, compressed at ties.
    for mat,(ya,yb) in enumerate(zip(bounds[:-1],bounds[1:])):
        row=np.array(cord_positions)+rng.integers(-4,5,len(cord_positions))
        cord_info.append(row.tolist())
        for i,start in enumerate(row):
            length=int((row[(i+1)%len(row)]-start)%N)
            xs=(int(start)+np.arange(length))%N
            belly=(1.8*np.sin(np.pi*np.arange(length)/length)**1.2).astype(np.float32)
            h[ya:yb,xs]+=belly[None,:]

    yy,xx=np.mgrid[:N,:N].astype(np.float32)
    seam=np.zeros((N,N),np.float32)
    butt=np.zeros_like(seam)
    seam_records=[]
    # Each physical join has the same profile, including the two half-joins
    # at the top and bottom. A broad flat core gives continuous derivatives
    # without copying border pixels or touching the derived normal map.
    for i,row in enumerate([0,683,1365]):
        center=row-.5
        d=(yy-center+N/2)%N-N/2
        jitter=.22*np.sin(2*np.pi*xx/N*17+i)+.12*np.sin(2*np.pi*xx/N*39+i)
        distance=np.abs(d-jitter)
        # Unequal short fibre shoulders, not a perfectly straight dark rail.
        ragged=gf(rng.normal(size=N).astype(np.float32),1.1,mode='wrap')
        shoulder=np.clip(1.55+ragged*.65,1.0,2.2)[None,:]
        core=np.exp(-(np.maximum(distance-.85,0)/shoulder)**3)
        seam=np.maximum(seam,core)
        backing_tone=3*np.sin(2*np.pi*xx/N*19+i)+2*np.cos(2*np.pi*xx/N*51-i)
        backing=np.array([138.,102.,56.])+backing_tone[...,None]
        base=base*(1-core[...,None])+backing*core[...,None]
        backing_height=1.0+.08*np.sin(2*np.pi*xx/N*13+i)
        h=h*(1-core)+backing_height*core
        rough=rough*(1-core)+.91*core
        # Ragged short cut faces at the edge of each compressed mat, paired
        # across the closed butt. They do not open holes in the floor.
        x=0.0
        count=0
        while x<N:
            width=float(rng.uniform(3.1,5.0))
            xc=x+width/2
            for side in [-1,1]:
                yc=center+side*float(rng.uniform(2.8,4.8))
                xs=np.arange(int(xc)-4,int(xc)+5)
                ys=np.arange(int(yc)-3,int(yc)+4)
                u=(xs[None]-xc)/(width*.46)
                v=(ys[:,None]-yc)/float(rng.uniform(.85,1.25))
                rad=np.sqrt(u*u+v*v)
                alpha=np.clip((1.1-rad)*2.2,0,1)*.8
                idx=(ys[:,None]%N,xs%N)
                # Smooth suppression towards joint centre preserves the shared
                # compressed core and the height derivative across the wrap.
                alpha*=1-seam[idx]
                pith=np.exp(-((u/.45)**2+(v/.50)**2))
                color=np.array([205.,168.,107.])+rng.normal(0,9)-pith[...,None]*np.array([27.,24.,16.])
                base[idx]=base[idx]*(1-alpha[...,None])+color*alpha[...,None]
                h[idx]+=alpha*(.65-.3*pith)
                butt[idx]=np.maximum(butt[idx],alpha)
                count+=1
            x+=width
        seam_records.append({'row':row,'center_texel':center,'cut_faces':count})

    cord=np.zeros((N,N),np.float32)
    compression=np.zeros_like(cord)
    cord_records=[]
    support=gf(h,(1.3,3.5),mode='wrap')
    for mat,(ya,yb) in enumerate(zip(bounds[:-1],bounds[1:])):
        ys=np.arange(ya,yb,dtype=np.float32)
        cy=ys[:,None]
        for j,x0 in enumerate(cord_info[mat]):
            xs=np.arange(x0-10,x0+11)
            cx=xs[None,:].astype(np.float32)
            idx=(ys.astype(int)[:,None],xs%N)
            center=x0+.65*np.sin(2*np.pi*(cy-ya)/(yb-ya)*3+j)
            pitch=float(rng.uniform(6.4,8.2))
            phase=2*np.pi*(cy-ya)/pitch+rng.uniform(0,2*np.pi)
            end=np.clip((np.minimum(cy-ya,yb-1-cy)-4)/4,0,1)
            press=np.exp(-((cx-center)/4.4)**2)*end
            h[idx]-=press*.80
            compression[idx]=np.maximum(compression[idx],press)
            # Two physically separate strands alternate their front/back order.
            # Combined diameter ~4.5 px / 6.6 mm, with shorter winding fibres.
            strands=[]
            for side in [-1,1]:
                dist=cx-center-side*.90*np.sin(phase)
                radius=1.12
                alpha=np.clip((radius+.42-np.abs(dist))/.84,0,1)*end
                section=np.sqrt(np.maximum(0,1-(dist/radius)**2))
                depth=side*np.cos(phase)
                z=support[idx]+1.65+.62*depth+1.05*section
                texture=2.8*np.sin(phase*2+(cx-center)*5)
                color=np.array([204.,180.,128.])+((section-.5)*20+depth*9+texture)[...,None]
                strands.append((alpha,z,color,depth))
            # Paint back first and front last on each winding half-turn.
            front=strands[0][3]>strands[1][3]
            for which in [0,1]:
                pick=front if which==0 else ~front
                a=np.where(pick,strands[1][0],strands[0][0])
                z=np.where(pick,strands[1][1],strands[0][1])
                color=np.where(pick[...,None],strands[1][2],strands[0][2])
                base[idx]=base[idx]*(1-a[...,None])+color*a[...,None]
                h[idx]=h[idx]*(1-a)+np.maximum(h[idx],z)*a
                rough[idx]=rough[idx]*(1-a)+(.91+.015*np.sin(phase))*a
                cord[idx]=np.maximum(cord[idx],a)
            cord_records.append({'mat':mat,'x':x0,'twist_pitch_px':pitch,'diameter_mm':4.5*TILE_MM/N})

    straw=stroke_layer(rng,85,floor=True)*(1-seam)
    base=base*(1-straw[...,None]*.65)+np.array([212,178,117])*straw[...,None]*.65
    h+=straw*.55
    rough+=straw*.025
    # Fixed physical relief multiplier, never fitted to this image's extrema.
    h*=1.22
    # Channel translation preserves every local contrast and meets the brief's
    # unlit palette independently of the source pictures' average exposure.
    translation=np.array([175.,135.,80.])-base.mean(axis=(0,1))
    base+=translation
    layout={'mat_seam_rows':[0,683,1365],'mat_bounds':bounds,
            'cord_x_per_mat':cord_info,'cord_geometry':cord_records,
            'butt_seams':seam_records,'palette_translation':translation.tolist(),
            'edge_construction':'Shared compressed joint core centred at -.5; periodic fields, no copied edge pixels'}
    masks={'seam':seam,'butt':butt,'cord':cord,'compression':compression,
           'straw':straw,'nodes':fields['nodes'],'worn':worn,'pale':pale,'handful':handful}
    return base,h,rough,layout,masks


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
        src,placements,geometry,fields,reed_records=reed_master(sources,rng)
    else:
        src,placements=quilt(sources,rng)
    save_rgb(src,ROOT/'source/composed_master.png',True)
    if NAME=='floor':
        base,h,rough,layout,masks=floor_material(src,rng,geometry,fields)
        layout['reeds']=reed_records
    else:
        base,h,rough,layout,masks=earth_material(src,rng)
    assert all(np.isfinite(a).all() for a in [base,h,rough]),'Non-finite material values'
    assert 0<=float(h.min()) and float(h.max())<=HEIGHT_MM,('Height would clip',float(h.min()),float(h.max()))
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
              'round':2,'height_unclipped_mm':[float(h.min()),float(h.max())],
              'height_clipped_pixels':int(np.count_nonzero((h<0)|(h>HEIGHT_MM))),
              'seed':SEED,'normal_convention':'OpenGL: +X right, +Y image up, +Z outward',
              'normal_method':'Wrapped central differences of reloaded delivered uint16 height; physical pixel pitch',
              'source_images':source_info,'preserved_round1':'source/round1/',
              'composition':
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
