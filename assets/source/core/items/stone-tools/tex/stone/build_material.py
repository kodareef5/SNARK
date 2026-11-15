#!/usr/bin/env python3
"""Native, periodic knapped stone. No photographs, lighting, or generated-image input.

All distances in the construction are millimetres. Run from any working directory;
outputs are confined to the directory containing this script.
"""
from pathlib import Path
import hashlib
import json
import time

import numpy as np
from PIL import Image, PngImagePlugin

ROOT = Path(__file__).resolve().parent
N = 2048
TILE_MM = 200.0
HEIGHT_MM = 2.5
BASE_MM = 1.35
SEED = 481936
DX = TILE_MM / N


def gaussian_filter(a, sigma, mode='wrap'):
    """Periodic Gaussian via FFT: only NumPy and Pillow are required."""
    assert mode == 'wrap'
    fy = np.fft.fftfreq(a.shape[0])[:,None]
    fx = np.fft.rfftfreq(a.shape[1])[None,:]
    kernel = np.exp(-2*np.pi**2*sigma**2*(fx*fx+fy*fy))
    return np.fft.irfft2(np.fft.rfft2(a)*kernel,s=a.shape).astype(np.float32)


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def normal_from_height(h, tile_mm=TILE_MM):
    """h in mm; image rows point down, tangent +Y points up."""
    dx = tile_mm / h.shape[0]
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * dx)
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) / (2 * dx)
    v = np.stack((-gx, gy, np.ones_like(h)), axis=-1)
    v /= np.linalg.norm(v, axis=-1, keepdims=True)
    return np.rint((v * .5 + .5) * 255).clip(0, 255).astype(np.uint8)


def save_rgb(path, a, srgb=False):
    info = PngImagePlugin.PngInfo()
    if srgb:
        info.add(b'sRGB', b'\x00')
    Image.fromarray(np.clip(np.rint(a), 0, 255).astype(np.uint8)).save(path, pnginfo=info)


def box2(a):
    """Exact 2x area average, pixel-centre aligned, in the map's encoding."""
    return a.astype(np.float64).reshape(a.shape[0]//2, 2, a.shape[1]//2, 2, *a.shape[2:]).mean((1, 3))


def stronger_face(x, y, warp, meso):
    """Round two face only: overlapping fracture domains, origins outside scars.

    A separate generator leaves every round-one random draw and band intact.
    Each fan has one coherent origin and a broad footprint; normalized overlapping
    weights preserve coverage without summing arbitrary heights at intersections.
    """
    rng = np.random.default_rng(962417)
    shape = x.shape
    numerator = np.zeros(shape,np.float32)
    denominator = np.zeros(shape,np.float32)
    crest_sum = np.zeros(shape,np.float32)
    dominant = np.zeros(shape,np.float32)
    scoop = np.zeros(shape,np.float32)
    hinge = np.zeros(shape,np.float32)
    records = {'fans':[], 'secondary_scars':[], 'hinges':[]}
    gate = smooth(55,60,y)*(1-smooth(191,197,y))

    def local(cx,cy,radius):
        ix=np.arange(int(np.floor((cx-radius)/DX)),int(np.ceil((cx+radius)/DX))+1)
        iy=np.arange(int(np.floor((cy-radius)/DX)),int(np.ceil((cy+radius)/DX))+1)
        return np.ix_(iy%N,ix%N), ((ix[None,:]+.5)*DX-cx).astype(np.float32), ((iy[:,None]+.5)*DX-cy).astype(np.float32)

    # Twenty scar domains, roughly 40 x 38 mm apart. Their elliptical overlap
    # lets a 20-80 mm mesh facet encounter portions of several broad fracture arcs.
    for row in range(4):
        for col in range(5):
            i=row*5+col
            cx=(col+.5)*40+rng.uniform(-7,7)
            cy=50+(row+.5)*37.5+rng.uniform(-5,5)
            angle=rng.uniform(-np.pi,np.pi)
            a=rng.uniform(25,31)
            b=rng.uniform(22,28)
            origin=a+rng.uniform(2,6)
            spacing=rng.uniform(2.8,5.6)
            amplitude=rng.uniform(.50,.70)
            phase_offset=rng.uniform(0,2*np.pi)
            idx,lx,ly=local(cx,cy,max(a,b)*2.1)
            u=np.cos(angle)*lx+np.sin(angle)*ly
            v=-np.sin(angle)*lx+np.cos(angle)*ly
            d2=(u/a)**2+(v/b)**2
            weight=np.exp(-1.7*d2*d2)*(1-smooth(1.65,2.0,np.sqrt(d2)))
            rr=np.sqrt((u+origin)**2+(v*rng.uniform(.9,1.08))**2+.01)
            warped=rr+.19*warp[idx]+.08*np.sin(v*.24+i)
            pulse_rng=np.random.default_rng(123100+i)
            intervals=np.clip(spacing*pulse_rng.uniform(.75,1.25,60),2.2,6.0)
            radii=np.r_[0,np.cumsum(intervals)]
            # Different radial distances between individual pressure pulses.
            # Cosine extrema at interpolation knots keep the wave slope smooth.
            phase=2*np.pi*np.interp(warped,radii,np.arange(len(radii))).astype(np.float32)
            wave=.82*np.cos(phase)+.18*np.cos(2*phase)
            pulse_strength=.80+.14*np.cos(rr*.31+phase_offset)+.06*np.cos(rr*.85+i)
            attenuation=(.20+.80*np.exp(-np.maximum(rr-origin*.25,0)/40))*pulse_strength
            h=amplitude*wave*attenuation
            numerator[idx]+=weight*h
            denominator[idx]+=weight
            crest_sum[idx]+=weight*np.maximum(np.cos(phase),0)**2
            dominant[idx]=np.maximum(dominant[idx],weight)
            records['fans'].append(dict(x=float(cx),y=float(cy),angle=float(angle),half_width=float(a),half_height=float(b),
                percussion_x=float((cx-np.cos(angle)*origin)%200),percussion_y=float((cy-np.sin(angle)*origin)%200),
                origin_offset=float(origin),spacing=float(spacing),amplitude=float(amplitude),pulse_intervals_mm=intervals.tolist()))
    ripple=numerator/np.maximum(denominator,1e-7)
    crests=crest_sum/np.maximum(denominator,1e-7)
    dominant/=np.maximum(denominator,1e-7)

    # Larger soft secondary scars: broad shallow hollows, feathered percussion
    # end and a soft crescent ridge at their termination, with occasional hinges.
    for i in range(94):
        cx=rng.uniform(0,200)
        cy=rng.uniform(56,195)
        length=rng.uniform(10,40)
        width=length*rng.uniform(.55,.90)
        angle=rng.uniform(-np.pi,np.pi)
        depth=rng.uniform(.20,.40)
        ridge=rng.uniform(.13,.22)
        idx,lx,ly=local(cx,cy,length*.73+2)
        u=(np.cos(angle)*lx+np.sin(angle)*ly)/(length*.5)
        v=(-np.sin(angle)*lx+np.cos(angle)*ly)/(width*.5)
        v/=1+.13*np.clip(u,-1,1)
        front=u+.58*v*v+.025*warp[idx]
        sides=1-smooth(.40,1.03,np.abs(v))
        back=smooth(-1.12,-.38,u)
        support=sides*back*(1-smooth(.64,1.02,front))
        depression=-depth*(.23+.77*smooth(-.85,.75,u))*support
        # Physical ridge width 1.0-1.6 mm (sigma), not a crisp boundary line.
        ridge_sigma=rng.uniform(1.0,1.6)
        rim=ridge*np.exp(-.5*(((front-.80)*length*.5)/ridge_sigma)**2)*sides*back
        scar=depression+rim
        scoop[idx]=scoop[idx]*(1-.65*support)+scar
        # Fresh secondary scar partly replaces the preceding pressure ripples.
        ripple[idx]*=1-.40*support
        crests[idx]*=1-.40*support
        is_hinge=i%7==3
        if is_hinge:
            z=(front-.75)*length*.5
            step=-rng.uniform(.09,.19)*smooth(-.22,.18,z)*(1-smooth(.65,1.7,z))*sides*back
            hinge[idx]+=step
            records['hinges'].append(dict(x=float(cx),y=float(cy),length=float(length)))
        records['secondary_scars'].append(dict(x=float(cx),y=float(cy),length=float(length),width=float(width),angle=float(angle),
                                              depth=float(depth),ridge_height=float(ridge),ridge_sigma_mm=float(ridge_sigma),hinge=is_hinge))
    return dict(gate=gate,ripple=ripple,scoop=scoop,hinge=hinge,crests=crests,dominance=dominant,records=records)


def build():
    start = time.monotonic()
    source = ROOT / 'source'
    source.mkdir(exist_ok=True)
    rng = np.random.default_rng(SEED)
    yy, xx = np.mgrid[:N, :N].astype(np.float32)
    x, y = (xx + .5) * DX, (yy + .5) * DX

    def noise(sigma):
        a = gaussian_filter(rng.standard_normal((N, N), dtype=np.float32), sigma, mode='wrap')
        a -= a.mean()
        return a / max(a.std(), 1e-9)

    # Every random field is sampled at delivery resolution and filtered periodically.
    grain = noise(.68)
    fine = noise(1.8)
    meso = noise(7.0)
    cloud = noise(53.0)
    broad = noise(132.0)
    warp = noise(23.0)
    # 4 mm fades are centred on the specified row boundaries. No hard seam at y=0.
    yd = (y + 100) % 200 - 100
    edge = smooth(-2, 2, yd) * (1 - smooth(23, 27, yd))
    # The palest third is 8.333..16.667 mm, with smooth shoulders.
    crown = smooth(3.5, 8.333333, yd) * (1-smooth(16.666667, 21.5, yd))
    ragged = .66 * noise(14) + .40 * noise(44)
    cortex = smooth(23, 27, y + ragged) * (1 - smooth(48, 52, y + ragged))
    edge *= 1 - cortex
    face = (1 - edge) * (1 - cortex)

    ripples = np.zeros((N, N), np.float32)
    coverage = np.zeros_like(ripples)
    secondary = np.zeros_like(ripples)
    steps = np.zeros_like(ripples)
    pits = np.zeros_like(ripples)
    retouch = np.zeros_like(ripples)
    inclusions = np.zeros_like(ripples)
    records = {'fans': [], 'secondary_scars': [], 'steps': [], 'pits': [], 'retouch': [], 'inclusions': []}

    def local(cx, cy, radius):
        # Unwrapped local coordinates, then periodic gather/scatter. Support < half tile.
        ix = np.arange(int(np.floor((cx-radius)/DX)), int(np.ceil((cx+radius)/DX))+1)
        iy = np.arange(int(np.floor((cy-radius)/DX)), int(np.ceil((cy+radius)/DX))+1)
        lx = (ix[None, :] + .5) * DX - cx
        ly = (iy[:, None] + .5) * DX - cy
        return np.ix_(iy % N, ix % N), lx.astype(np.float32), ly.astype(np.float32)

    # Directed ripple fans, without large fake facet bowls. Amplitudes fade away
    # from each percussion origin. Overlapping fans replace rather than sum strongly.
    for i in range(92):
        cx, cy = rng.uniform(0, 200, 2)
        angle = rng.uniform(-np.pi, np.pi)
        reach = rng.uniform(19, 39)
        span = rng.uniform(.65, 1.20)
        spacing = rng.uniform(1.7, 3.3)
        amp = rng.uniform(.035, .072)
        idx, lx, ly = local(cx, cy, reach+2)
        u = np.cos(angle)*lx + np.sin(angle)*ly
        v = -np.sin(angle)*lx + np.cos(angle)*ly
        radial = np.sqrt(u*u + (v * rng.uniform(.80, 1.15))**2 + .01)
        theta = np.abs(np.arctan2(v, u))
        env = smooth(3.8, 8.0, radial) * (1-smooth(reach*.60, reach, radial))
        env *= 1-smooth(span*.68, span, theta)
        env *= np.exp(-radial/(reach*1.35))
        rr = radial + .26 * warp[idx] + .14*np.sin(theta*5+radial*.26)
        phase = 2*np.pi*(rr/spacing + .10*np.sin(rr*.62+i) + .035*np.sin(rr*1.57+i*.7))
        # Radially varying wavelength and strength: pressure pulses are neither
        # identical concentric engraving nor complete circles.
        wave = (.82*np.sin(phase) + .18*np.sin(2*phase+.65))
        pulse = .58+.28*np.sin(rr*.71+i*.37)+.14*np.sin(rr*1.71+i)
        broken = .7+.3*smooth(-.5,1.3,warp[idx]+.45*meso[idx])
        wave *= pulse*broken
        # This is relief only: no shaded/embossed counterpart in albedo.
        old = ripples[idx]
        alpha = env*.82
        ripples[idx] = old*(1-alpha) + amp*wave*env
        coverage[idx] = np.maximum(coverage[idx], env)
        records['fans'].append(dict(x=float(cx), y=float(cy), angle=float(angle), reach=float(reach), half_angle=float(span), spacing=float(spacing), amplitude=float(amp)))

    # Small asymmetric feathered flakes. A short sharp crescent at the termination
    # meets a broad, shallow scoop, never a raised ring around a circular crater.
    for i in range(315):
        cx, cy = rng.uniform(0, 200, 2)
        length = rng.uniform(3, 15)
        width = length * rng.uniform(.48, .86)
        angle = rng.uniform(-np.pi, np.pi)
        depth = rng.uniform(.038, .145)
        idx, lx, ly = local(cx, cy, length*.72+1)
        u = (np.cos(angle)*lx+np.sin(angle)*ly)/(length*.5)
        v = (-np.sin(angle)*lx+np.cos(angle)*ly)/(width*.5)
        v /= (1+.19*np.clip(u, -1, 1))
        # Open feathered scoop with one curved termination, not a closed crater.
        front = u+.58*v*v+.035*meso[idx]
        sides = 1-smooth(.44,1.02,np.abs(v))
        back = smooth(-1.12,-.34,u)
        support = sides*back*(1-smooth(.69,.97,front))
        bowl = (.30+.70*smooth(-.8,.78,u))*support
        cut = -depth*bowl
        # Fine secondary arcs within the flake; only the short terminal crescent
        # has a crisp lip, the sides and percussion end feather into the surface.
        origin_dist = np.sqrt((u+1.4)**2+(v*.75)**2)*length*.5
        cut += .009*np.sin(origin_dist*2*np.pi/rng.uniform(1.1, 1.8))*support
        lip = depth*.18*np.exp(-((front-.84)/.065)**2)*sides*back
        new = cut+lip
        # Softer overlap blending retains continuous slopes and intersecting rims.
        secondary[idx] = secondary[idx]*(1-.72*support)+new
        records['secondary_scars'].append(dict(x=float(cx),y=float(cy),length=float(length),width=float(width),depth=float(depth),angle=float(angle)))

    for i in range(19):
        cx, cy = rng.uniform(0,200,2)
        length = rng.uniform(2.3,6.7)
        angle = rng.uniform(-np.pi,np.pi)
        depth = rng.uniform(.045,.12)
        idx,lx,ly = local(cx,cy,length+1)
        u = np.cos(angle)*lx+np.sin(angle)*ly
        v = -np.sin(angle)*lx+np.cos(angle)*ly
        curve = v+.085*u*u+.06*meso[idx]
        taper = 1-smooth(length*.3,length*.52,np.abs(u))
        step = smooth(-.11,.11,curve)*(1-smooth(.55,1.8,curve))*taper
        steps[idx] -= depth*step
        records['steps'].append(dict(x=float(cx),y=float(cy),length=float(length),depth=float(depth)))

    # Irregularly spaced alternating retouch cuts, centred in the edge band.
    cx = -1.5
    i = 0
    while cx < 199:
        cx += rng.uniform(1.65,3.1)
        cy = 12.5 + rng.uniform(-.46,.46)
        width = rng.uniform(.75,1.5)
        length = rng.uniform(1.2,2.7)
        direction = 1 if i%2 else -1
        idx,lx,ly = local(cx,cy,4.3)
        u = direction*ly/length
        v = (lx+.16*ly)/(width*.5)
        shape = np.exp(-v*v*2.2) * np.exp(-((u-.25)/.62)**2)
        tip = smooth(-.65,-.36,u)*(1-smooth(.55,1.2,u))
        retouch[idx] -= rng.uniform(.055,.12)*shape*tip
        records['retouch'].append(dict(x=float(cx%200),y=float(cy),width=float(width),length=float(length)))
        i += 1

    # Cortex pores, plus sparse sub-millimetre flaws in the exposed face.
    for i in range(1170):
        cx = rng.uniform(0,200)
        cy = rng.uniform(24,51) if i<980 else rng.uniform(0,200)
        radius = rng.uniform(.14,.7) if i<980 else rng.uniform(.12,.3)
        depth = rng.uniform(.025,.145) if i<980 else rng.uniform(.016,.05)
        idx,lx,ly = local(cx,cy,radius*2.2)
        r2 = (lx/(radius*rng.uniform(.7,1.25)))**2+(ly/radius)**2
        pit = depth*np.exp(-r2*2.5)*(1-smooth(1,3,r2))
        mask = cortex[idx] if i<980 else (1-cortex[idx])
        pits[idx] -= pit*mask
        records['pits'].append(dict(x=float(cx),y=float(cy),radius=float(radius),depth=float(depth),cortex=i<980))

    for i in range(24):
        cx,cy = rng.uniform(0,200,2)
        length = rng.uniform(2.0,9.0)
        angle = rng.uniform(-np.pi,np.pi)
        idx,lx,ly = local(cx,cy,length*.65+1)
        u = np.cos(angle)*lx+np.sin(angle)*ly
        v = -np.sin(angle)*lx+np.cos(angle)*ly
        path = v+.025*u*u+.09*np.sin(1.6*u)
        line = np.exp(-.5*(path/rng.uniform(.055,.09))**2)*(1-smooth(length*.3,length*.5,np.abs(u)))
        inclusions[idx] = np.maximum(inclusions[idx],line)
        records['inclusions'].append(dict(x=float(cx),y=float(cy),length=float(length)))

    # Smooth edge finish: the shared retouch is retained in both materials, while
    # stone's roughness makes it read as worn rather than fresh glass.
    relief_gain = face + .20*edge
    ripple_mm = ripples*relief_gain
    secondary_mm = secondary*relief_gain
    step_mm = steps*face
    retouch_mm = retouch*edge
    inclusion_mm = -.022*inclusions*face
    cortex_mm = cortex*(.045*meso+.052*noise(25)+.014*fine)
    grain_mm = (.0030*grain+.0020*fine)*(1-.7*edge)*(1-cortex)
    # Preserve the original band construction and all random draws above. Only
    # face interiors are replaced; 55-60 and 191-197 mm provide C1 blend margins.
    revision=stronger_face(x,y,warp,meso)
    edit=revision['gate']
    ripple_mm=ripple_mm*(1-edit)+revision['ripple']*edit
    secondary_mm=secondary_mm*(1-edit)+revision['scoop']*edit
    step_mm=step_mm+revision['hinge']*edit
    height = BASE_MM+ripple_mm+secondary_mm+step_mm+retouch_mm+pits+inclusion_mm+cortex_mm+grain_mm
    assert height.min()>0 and height.max()<HEIGHT_MM
    height_u16 = np.rint(height/HEIGHT_MM*65535).astype(np.uint16)
    Image.fromarray(height_u16).save(ROOT/'stone_height.png')
    # Normal is derived from the actual reopened 16-bit height, including quantization.
    saved_height = np.asarray(Image.open(ROOT/'stone_height.png'),dtype=np.float64)/65535*HEIGHT_MM
    normal = normal_from_height(saved_height)
    save_rgb(ROOT/'stone_normal.png',normal)

    # Pigment fields have no dependence on a light, surface derivative, AO, or cavity
    # shading. A few hairline mineral inclusions are dark material, not shadows.
    minerals = .60*grain+.30*fine+.22*meso
    banding = np.sin(2*np.pi*(x/200*3+y/200*5)+.85*cloud+.32*meso)
    cloudy = np.maximum(cloud+.15,0)**1.15
    speckles = np.sign(grain)*np.maximum(abs(grain)-1.25,0)**1.25
    stone_tone = 3.7*minerals+1.3*cloud+.45*broad+2.0*speckles
    flint_tone = 1.10*fine+.45*grain+2.25*cloudy+1.65*banding+.65*meso
    cortex_tone = 2.7*meso+1.8*fine+1.9*cloud+1.0*grain
    palettes = {'stone': ([128,126,120],[168,164,156],[196,190,177]),
                'flint': ([74,72,76],[156,152,144],[200,188,164])}
    # AO is shallow and localized to real cavities; broad ripple valleys are open.
    ao_loss = np.minimum(.15,(-pits)/.145*.16)
    ao_loss += np.minimum(.10,(-step_mm)/.12*.10)
    ao_loss += np.minimum(.09,(-retouch_mm)/.12*.09)
    ao = np.clip(1-ao_loss,.76,1)
    for name,(base_palette,edge_palette,cortex_palette) in palettes.items():
        tone = stone_tone if name=='stone' else flint_tone
        raw = np.asarray(base_palette,np.float32)[None,None,:]+tone[:,:,None]
        if name=='flint':
            # restrained blue/brown mineral drift, not a broad value gradient
            raw += np.stack((.65*cloud,-.12*cloud,-.70*cloud),-1)
        raw -= (2.8 if name=='stone' else 3.5)*inclusions[:,:,None]
        interior = (y[:,0]>55)&(y[:,0]<196)
        raw += np.asarray(base_palette)-raw[interior].mean((0,1),dtype=np.float64)
        # Center-third swatches match the supplied rim values. Its shoulders fade
        # through the same hue before the ~4 mm boundary into the face/cortex.
        edge_mix = edge*(.68+.32*crown)
        # Use an independent shoulder palette; do not shade the height profile.
        base = raw*(1-edge_mix[:,:,None]) + (np.asarray(edge_palette)+(.8*fine+.5*meso)[:,:,None])*edge_mix[:,:,None]
        cortex_col = np.asarray(cortex_palette)[None,None,:]+cortex_tone[:,:,None]
        base = base*(1-cortex[:,:,None])+cortex_col*cortex[:,:,None]
        # New pigment exists only inside the editable face. A small pale mineral
        # fraction follows some flint crests; it has no light or slope dependence.
        if name=='stone':
            living_tone=6.4*minerals+3.2*cloud+1.1*broad+3.8*speckles
            living=np.asarray(base_palette)+living_tone[:,:,None]
            living-=2.8*inclusions[:,:,None]
        else:
            pale_mineral=smooth(-.15,1.25,cloud+.25*meso)
            living_tone=1.2*fine+.65*grain+5.3*cloudy+2.5*banding+1.0*meso
            living_tone+=2.5*revision['crests']*pale_mineral
            living=np.asarray(base_palette)+living_tone[:,:,None]
            living+=np.stack((1.8*cloud,-.1*cloud,-1.6*cloud),-1)
            living-=3.5*inclusions[:,:,None]
        base=base*(1-edit[:,:,None])+living*edit[:,:,None]
        # Recenter through the edit mask so even the transition margins, as well
        # as all protected rows, keep their original pigment exactly.
        face_slice=np.s_[564:2007,:]
        correction=(np.asarray(base_palette)-base[face_slice].mean((0,1),dtype=np.float64))/edit[face_slice].mean(dtype=np.float64)
        base+=edit[:,:,None]*correction
        save_rgb(ROOT/f'{name}_base.png',base,srgb=True)
        if name=='stone':
            rough = np.clip(.775+.018*meso+.014*fine+.008*grain,.70,.85)
            edge_r = np.clip(.50+.018*fine+.012*meso,.43,.58)
        else:
            rough = np.clip(.395+.025*cloud+.018*meso+.012*fine,.30,.50)
            edge_r = np.clip(.32+.016*fine+.013*meso,.27,.39)
        rough = rough*(1-edge)+edge_r*edge
        cortex_r = np.clip(.91+.010*meso+.012*fine,.87,.96)
        rough = rough*(1-cortex)+cortex_r*cortex
        rough += np.minimum(-pits*.13,.018)
        if name=='flint':
            lively_rough=np.clip(.420+.023*cloud+.015*meso+.009*fine-.065*revision['crests'],.30,.50)
            rough=rough*(1-edit)+lively_rough*edit
        orm = np.stack((ao,rough,np.zeros_like(ao)),axis=-1)*255
        save_rgb(ROOT/f'{name}_orm.png',orm)

    # The smaller normal is regenerated physically from the reduced height. Its
    # difference from filtered 2048 normal is independently checked (>30 dB).
    height_1024 = np.rint(box2(height_u16)).astype(np.uint16)
    Image.fromarray(height_1024).save(ROOT/'stone_height_1024.png')
    save_rgb(ROOT/'stone_normal_1024.png',normal_from_height(height_1024.astype(np.float64)/65535*HEIGHT_MM))
    for name in ['stone_base','flint_base','stone_orm','flint_orm']:
        a = np.asarray(Image.open(ROOT/f'{name}.png'))
        save_rgb(ROOT/f'{name}_1024.png',box2(a),srgb=name.endswith('base'))

    # Full-resolution source fields make the physical construction reviewable.
    fields = dict(ripple_mm=ripple_mm,secondary_mm=secondary_mm,step_mm=step_mm,
                  retouch_mm=retouch_mm,pits_mm=pits,inclusion_mm=inclusion_mm,
                  cortex_mm=cortex_mm,grain_mm=grain_mm,height_mm=height,
                  edge_mask=edge,cortex_mask=cortex,crown_mask=crown,face_mask=face,
                  grain=grain,mineral_cloud=cloud,banding=banding,inclusions=inclusions,
                  ripple_coverage=coverage,face_edit_mask=edit,ripple_crests=revision['crests'],fan_dominance=revision['dominance'])
    np.savez_compressed(source/'construction_fields.npz',**fields)
    save_rgb(source/'region_masks.png',np.stack((edge,cortex,face),-1)*255)
    save_rgb(source/'pigment_fields.png',np.stack((grain/7+.5,cloud/7+.5,banding/2+.5),-1)*255)
    records['round2_face']=revision['records']
    records.update(seed=SEED,size=N,tile_mm=TILE_MM,height_full_range_mm=HEIGHT_MM,base_height_mm=BASE_MM,
                   revision=2,face_seed=962417,face_edit_fade_mm=[[55,60],[191,197]],
                   edge_rows=[0,256],cortex_rows=[256,512],face_rows=[512,2048],
                   boundary_transition_mm=4,method='Analytic native-resolution periodic construction; no image inputs.')
    (source/'construction.json').write_text(json.dumps(records,indent=2)+'\n')
    files = sorted(ROOT.glob('*.png'))
    manifest = dict(seed=SEED,tile_metres=.2,height_range_mm=[0,HEIGHT_MM],base_height_mm=BASE_MM,revision=2,
                    build_seconds=round(time.monotonic()-start,3),
                    sha256={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in files})
    (ROOT/'build_manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({'build_seconds':manifest['build_seconds'],'height_mm':[float(height.min()),float(height.max())],'files':len(files)},indent=2))


if __name__=='__main__':
    build()
