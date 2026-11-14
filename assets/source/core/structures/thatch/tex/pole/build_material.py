#!/usr/bin/env python3
"""Build the pole material from four retained original generated sources.

No network calls. Dependencies: Python >=3.9, NumPy, SciPy, Pillow.
All image operations, seam choices, semantic fields and random seeds are fixed.
The delivered normal is differentiated from the SAVED uint16 height.
"""
from pathlib import Path
import argparse
import hashlib
import json
import time

import numpy as np
from PIL import Image, ImageCms
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent
N = 2048
TILE_METRES = 1.5
HEIGHT_RANGE_MM = 12.0
SEED = 731121
TARGET_MEAN = np.array([132., 112., 88.], dtype=np.float32)
KNOTS = {
    'a': [(154,165),(921,213),(293,398),(769,566),(339,749),
          (1210,731),(578,998),(154,1139)],
    'b': [(169,197),(1028,129),(794,340),(300,455),(920,630),
          (590,723),(104,825),(889,960),(204,1136)],
    'c': [(169,111),(807,435),(143,579),(826,779),(191,1030)],
    'd': [(162,155),(1040,200),(428,390),(1042,538),(168,670),
          (691,774),(284,989),(1079,994),(763,1161)],
}


def gauss(a, sigma):
    return ndi.gaussian_filter(a, sigma, mode='wrap')


def u8(a):
    return np.rint(np.clip(a, 0, 255)).astype(np.uint8)


def save_rgb(path, a, srgb=False):
    kw = {}
    if srgb:
        kw['icc_profile'] = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
    Image.fromarray(u8(a)).save(path, **kw)


def min_path(cost, closed=False):
    """Minimum error overlap cut; optionally a closed curve on the torus."""
    length, width = cost.shape
    # Keep a margin so neither seam consumes an entire source overlap.
    c = cost.astype(np.float64).copy()
    c[:, :12] += 1e5
    c[:, -12:] += 1e5
    back = np.zeros((length, width), dtype=np.int8)
    v = c[0].copy()
    anchor = width // 2
    if closed:
        v[:] = 1e14
        v[anchor] = c[0, anchor]
    for y in range(1, length):
        choices = np.stack([np.r_[1e15, v[:-1]], v, np.r_[v[1:], 1e15]])
        choices[[0, 2]] += 0.5
        ids = choices.argmin(axis=0)
        back[y] = ids.astype(np.int8) - 1
        v = choices[ids, np.arange(width)] + c[y]
    x = anchor if closed else int(v.argmin())
    path = np.empty(length, dtype=np.int32)
    for y in range(length - 1, -1, -1):
        path[y] = x
        x += int(back[y, x])
    return path


def seam_mix(left, right, closed=False):
    error = np.mean((left[..., :3] - right[..., :3]) ** 2, axis=2)
    # Material-boundary agreement matters more than an incidental bright fibre.
    error += 500 * (left[..., 3] - right[..., 3]) ** 2
    error = ndi.gaussian_filter(error, (1.0, 1.0))
    path = min_path(error, closed)
    xx = np.arange(error.shape[1])[None, :]
    alpha = np.clip((xx - path[:, None] + 2) / 4., 0, 1)
    alpha = alpha * alpha * (3 - 2 * alpha)
    return left * (1-alpha[..., None]) + right * alpha[..., None]


def stitch_period(a, b, closed=False):
    """Two 1254px patches -> 2048px period, using separate internal/wrap cuts."""
    step = N // 2
    overlap = a.shape[1] - step
    out = np.empty((a.shape[0], N, a.shape[2]), np.float32)
    out[:, :overlap] = seam_mix(b[:, step:], a[:, :overlap], closed)
    out[:, overlap:step] = a[:, overlap:step]
    out[:, step:step+overlap] = seam_mix(a[:, step:], b[:, :overlap], closed)
    out[:, step+overlap:] = b[:, overlap:step]
    return out


def prepare_source(letter):
    raw = np.asarray(Image.open(ROOT/'source'/f'generated_pole_{letter}.png').convert('RGB'), dtype=np.float32)
    h, w = raw.shape[:2]
    yy, xx = np.mgrid[:h, :w].astype(np.float32)
    sx, sy = xx.copy(), yy.copy()
    scar = np.zeros((h,w), np.float32)
    # Compress oversized generated knot eyes into modest 1-4cm branch scars.
    # The warp is identity outside each small neighborhood; most pixels stay native.
    for cx, cy in KNOTS[letter]:
        dx, dy = xx-cx, yy-cy
        influence = np.exp(-0.5*((dx/58)**2+(dy/30)**2))
        sx += dx * .95 * influence
        sy += dy * .95 * influence
        r = np.sqrt((dx/20)**2+(dy/12)**2)
        scar += .45*np.exp(-r*r*1.8) - .28*np.exp(-((r-1)/.17)**2)
    raw = np.stack([ndi.map_coordinates(raw[...,i], [sy,sx], order=1, mode='reflect') for i in range(3)],axis=2)
    # Match source contrast and colour before overlap matching.
    lum = raw[...,0]*.2126+raw[...,1]*.7152+raw[...,2]*.0722
    gain = 23.0 / lum.std()
    raw = (raw-raw.mean((0,1),dtype=np.float64).astype(np.float32)) * gain + np.array([160.,132.,108.],np.float32)
    lum = raw[...,0]*.2126+raw[...,1]*.7152+raw[...,2]*.0722
    smooth = ndi.gaussian_filter(lum,(2.2,5.0),mode='reflect')
    background = ndi.gaussian_filter(lum,(25.,65.),mode='reflect')
    score = background - smooth
    # Broad brown remnants, not single-pixel dark fibres or narrow checks.
    threshold = np.percentile(score, 81.5)
    mask = score > threshold
    mask = ndi.binary_opening(mask, structure=np.ones((5,9)))
    mask = ndi.binary_closing(mask, structure=np.ones((3,9)))
    # Fill the relatively pale interior of a bark flake without adding its shadow.
    mask = ndi.binary_fill_holes(mask)
    bark = ndi.gaussian_filter(mask.astype(np.float32), .7)
    bark = np.clip((bark-.12)/.76,0,1)
    local = ndi.gaussian_filter(lum,(2.0,4.0),mode='reflect')
    valley = np.maximum(0, local-lum-17.)/22.
    # A vertical opening discards bark shadows and identifies long thin checks.
    line = ndi.gaussian_filter(valley,(.35,2.0),mode='reflect')
    line *= 1-ndi.maximum_filter(bark,size=(9,13),mode='reflect')
    line = np.clip(line,0,1)
    return np.concatenate([raw,bark[...,None],line[...,None],scar[...,None]],axis=2)


def periodic_noise(rng, sigma):
    a = gauss(rng.standard_normal((N,N),dtype=np.float32),sigma)
    return a / max(float(a.std()),1e-8)


def drying_checks(rng):
    depth = np.zeros((N,N),np.float32)
    pigment = np.zeros_like(depth)
    records = []
    # Local, tapered fractures, all authored directly at the final texel density.
    for i in range(110):
        length = int(rng.uniform(40,545) if i<28 else rng.uniform(28,220))
        cx, cy = rng.uniform(0,N,2)
        width = rng.uniform(.45,1.45)
        d = rng.uniform(.45,2.7) if i<28 else rng.uniform(.18,1.0)
        xs = np.arange(-length//2-4,length//2+5,dtype=np.float32)
        t = (xs+length/2)/length
        taper = np.maximum(0,np.sin(np.clip(t,0,1)*np.pi))**.55
        curve = rng.uniform(-3,3)*np.sin(t*np.pi) + rng.uniform(-1.5,1.5)*np.sin(t*3*np.pi)
        curve += ndi.gaussian_filter1d(rng.normal(0,.45,len(xs)),1.3)
        rows = np.arange(-10,11,dtype=np.float32)[:,None]
        field = np.exp(-.5*((rows-curve)/(width*taper+.16))**2)*taper
        iy = (int(cy)+rows.astype(np.int32))%N
        ix = (int(cx)+xs.astype(np.int32)[None,:])%N
        depth[iy,ix] = np.maximum(depth[iy,ix],field*d)
        pigment[iy,ix] = np.maximum(pigment[iy,ix],field*rng.uniform(.4,1.))
        records.append({'x':round(cx,2),'y':round(cy,2),'length_mm':round(length*TILE_METRES*1000/N,2),'depth_mm':round(d,3)})
    return depth,pigment,records


def main():
    began=time.monotonic()
    (ROOT/'checks').mkdir(exist_ok=True)
    print('Preparing native-resolution sources and shared masks...',flush=True)
    a,b,c,d=[prepare_source(k) for k in 'abcd']
    top=stitch_period(a,b)
    bottom=stitch_period(c,d)
    # Final cuts are closed in X, preserving the first pair of periodic joins.
    master=stitch_period(top.transpose(1,0,2),bottom.transpose(1,0,2),closed=True).transpose(1,0,2)
    # Move quilt junctions away from tile center and use the same shift on all fields.
    master=np.roll(master,(317,541),(0,1))
    raw,bark,source_checks,scar=master[...,:3],master[...,3],master[...,4],master[...,5]
    # Modest expansion captures feathered inner-bark fringes. Threshold is solved
    # globally for 15% semantic coverage; source colour still supplies the detail.
    field=gauss(bark,(1.0,1.2))
    threshold=float(np.quantile(field,.85))
    bark=np.clip((field-threshold)/.20+.5,0,1)
    bark=gauss(bark,.55)
    raw_lum=raw[...,0]*.2126+raw[...,1]*.7152+raw[...,2]*.0722
    rng=np.random.default_rng(SEED)
    print('Separating pigment, bark, incisions, and fine relief...',flush=True)
    fine=periodic_noise(rng,(.48,6.0))
    pores=periodic_noise(rng,(.42,1.3))
    weather=periodic_noise(rng,(9.,120.))
    # Colour separation: bark and wood have their own reflectance baselines.
    # Fine generated light/dark ridge pairs are compressed, and edge shading is
    # not copied as albedo. Large-scale illumination is removed independently.
    local=gauss(raw_lum,.8)
    residual=raw_lum-local
    mid=local-gauss(raw_lum,(35.,90.))
    edge=ndi.maximum_filter(bark,size=5,mode='wrap')-ndi.minimum_filter(bark,size=5,mode='wrap')
    pigment=mid*.78+np.clip(residual,-30,30)*(.55-.25*edge)
    chroma=raw-raw_lum[...,None]
    chroma=gauss(chroma,(1.,2.,0))
    chroma-=chroma.mean((0,1),dtype=np.float64).astype(np.float32)
    chroma=np.clip(chroma,-7,7)*.65
    base=TARGET_MEAN[None,None,:]+pigment[...,None]+chroma
    base-=bark[...,None]*np.array([11.,10.,8.],np.float32)
    # Suppress generated bright/dark rims and dark crevice shading. Interior
    # bark pigment remains detailed; its actual edge occlusion lives in ORM.
    rim_correction=np.clip(gauss(raw_lum,(3.,7.))-raw_lum,-25,25)*.5*edge
    base+=(rim_correction+10*source_checks)[...,None]
    base+=(weather*1.7+fine*1.25+pores*.45)[...,None]*(1-.65*bark[...,None])
    # Build height in millimetres, not arbitrary normal intensity.
    grain=gauss(raw_lum,.65)-gauss(raw_lum,(3.,11.))
    grain=np.clip(grain/25,-1.6,1.6)*(.18+.27*bark)
    grain+=fine*.028+pores*.012
    macro=periodic_noise(rng,(18.,100.))*.09
    bark_variation=np.tanh((gauss(raw_lum,(2,4))-gauss(raw_lum,(10,25)))/14)
    bark_height=gauss(bark,.65)*(2.45+.55*bark_variation)
    crack_depth,crack_pigment,crack_records=drying_checks(rng)
    crack_depth*=1-.75*bark
    crack_pigment*=1-bark
    # Existing photographic checks and authored cracks share every layer.
    incisions=source_checks*.85+crack_depth
    height_mm=4.7+grain+macro+scar*(1-bark)+bark_height-incisions
    base-=crack_pigment[...,None]*np.array([10.,10.,9.],np.float32)
    # Rough peeled knife facets: sparse elongated almost-flat bevels, sub-mm only.
    facet=np.zeros((N,N),np.float32)
    yy,xx=np.mgrid[:N,:N].astype(np.float32)
    facet_records=[]
    for _ in range(27):
        cx,cy=rng.uniform(0,N,2); rx,ry=rng.uniform(22,75),rng.uniform(4,12)
        dx=(xx-cx+N/2)%N-N/2; dy=(yy-cy+N/2)%N-N/2
        r=np.maximum(abs(dx/rx),abs(dy/ry))
        shape=np.clip((1-r)*4,0,1)
        bevel=shape*(.15+.09*dy/ry)*(1-bark)
        facet-=bevel
        facet_records.append([float(cx),float(cy),float(rx),float(ry)])
    height_mm+=facet
    base+=facet[...,None]*3.5
    # Precise target mean in the encoded sRGB domain after all layering.
    base+=TARGET_MEAN-base.mean((0,1),dtype=np.float64).astype(np.float32)
    save_rgb(ROOT/'pole_base.png',base,srgb=True)
    height_q=np.rint(np.clip(height_mm/HEIGHT_RANGE_MM,0,1)*65535).astype(np.uint16)
    Image.fromarray(height_q).save(ROOT/'pole_height.png')
    # Deliberately reload the quantized deliverable for the derivative contract.
    h=np.asarray(Image.open(ROOT/'pole_height.png'),dtype=np.float32)*(HEIGHT_RANGE_MM/1000/65535)
    texel=TILE_METRES/N
    dx=(np.roll(h,-1,1)-np.roll(h,1,1))/(2*texel)
    dy=(np.roll(h,-1,0)-np.roll(h,1,0))/(2*texel)
    normal=np.stack([-dx,dy,np.ones_like(h)],axis=2)
    normal/=np.linalg.norm(normal,axis=2,keepdims=True)
    save_rgb(ROOT/'pole_normal.png',(normal*.5+.5)*255)
    # Multiscale cavity approximation in millimetres. Only concave relief darkens.
    concavity=np.maximum(gauss(height_mm,2.0)-height_mm,0)
    broad_cavity=np.maximum(gauss(height_mm,6.0)-height_mm-.08,0)
    outside_bark=np.maximum(gauss(bark,2.4)-bark,0)
    ao=np.exp(-.40*concavity-.18*broad_cavity-.60*incisions-.42*outside_bark)
    ao=np.clip(ao,.20,1)
    rough=np.clip(.775+.023*np.tanh(weather)+.018*np.tanh(grain*5),.70,.85)
    rough=rough*(1-bark)+(.90+.018*np.tanh(grain*3))*bark
    orm=np.stack([ao,rough,np.zeros_like(ao)],axis=2)
    save_rgb(ROOT/'pole_orm.png',orm*255)
    # Inspectable derivations, all in final coordinates and at final resolution.
    Image.fromarray(u8(bark*255)).save(ROOT/'checks'/'bark_mask.png')
    Image.fromarray(u8(np.clip(incisions/3,0,1)*255)).save(ROOT/'checks'/'check_depth_mask.png')
    np.savez_compressed(ROOT/'checks'/'derivation.npz',bark=bark.astype(np.float16),
                        incisions=incisions.astype(np.float16),grain_mm=grain.astype(np.float16),
                        bark_height_mm=bark_height.astype(np.float16),scar_mm=scar.astype(np.float16))
    save_rgb(ROOT/'source'/'quilted_master.png',raw,srgb=True)
    info={'seed':SEED,'tile_metres':[TILE_METRES,TILE_METRES],'resolution':[N,N],
          'height_range_mm':HEIGHT_RANGE_MM,'height_used_mm':[float(height_mm.min()),float(height_mm.max())],
          'normal_convention':'+X right, +Y image-up, +Z outward (OpenGL)',
          'source_files':{f'generated_pole_{k}.png':{'size':list(Image.open(ROOT/'source'/f'generated_pole_{k}.png').size),
                           'sha256':hashlib.sha256((ROOT/'source'/f'generated_pole_{k}.png').read_bytes()).hexdigest()} for k in 'abcd'},
          'quilt':'Four native 1254px patches, 230px overlaps, minimum-error internal and wrapped cuts, 4px seam feather',
          'bark_coverage':float((bark>.5).mean()),'bark_soft_coverage':float(bark.mean()),
          'bark_threshold':threshold,'drying_checks':crack_records,'facet_positions':facet_records,
          'build_seconds':round(time.monotonic()-began,2)}
    (ROOT/'checks'/'construction.json').write_text(json.dumps(info,indent=2)+'\n')
    print(json.dumps({k:info[k] for k in ['height_used_mm','bark_coverage','build_seconds']},indent=2),flush=True)


def export_band(cm, start_row):
    """Close any selected 20-55cm band without modifying the four main maps.

    Native texel density is retained: width 2048, height 273-751. The seam is
    selected from extra source rows and applied identically to colour, height,
    and ORM; normals are rebuilt from the resulting saved height.
    """
    if not 20 <= cm <= 55:
        raise ValueError('--band-cm must be between 20 and 55')
    rows=int(round(cm/100/TILE_METRES*N))
    overlap=min(96,rows//3)
    dest=ROOT/'checks'/f'band_{cm:g}cm_row{start_row%N}'
    dest.mkdir(parents=True,exist_ok=True)
    base=np.asarray(Image.open(ROOT/'pole_base.png'),dtype=np.float32)
    height=np.asarray(Image.open(ROOT/'pole_height.png'),dtype=np.float32)/65535
    orm=np.asarray(Image.open(ROOT/'pole_orm.png'),dtype=np.float32)/255
    fields=np.concatenate([base,height[...,None],orm],axis=2)
    strip=fields[(np.arange(rows+overlap)+start_row)%N]
    band=strip[:rows].copy()
    band[:overlap]=seam_mix(strip[rows:].transpose(1,0,2),strip[:overlap].transpose(1,0,2),closed=True).transpose(1,0,2)
    save_rgb(dest/'pole_base.png',band[...,:3],srgb=True)
    q=np.rint(band[...,3]*65535).astype(np.uint16)
    Image.fromarray(q).save(dest/'pole_height.png')
    h=np.asarray(Image.open(dest/'pole_height.png'),dtype=np.float64)/65535*(HEIGHT_RANGE_MM/1000)
    step=TILE_METRES/N
    dx=(np.roll(h,-1,1)-np.roll(h,1,1))/(2*step)
    dy=(np.roll(h,-1,0)-np.roll(h,1,0))/(2*step)
    normal=np.stack([-dx,dy,np.ones_like(h)],axis=2)
    normal/=np.linalg.norm(normal,axis=2,keepdims=True)
    save_rgb(dest/'pole_normal.png',(normal*.5+.5)*255)
    save_rgb(dest/'pole_orm.png',band[...,4:]*255)
    info={'requested_girth_cm':cm,'actual_girth_cm':rows*step*100,
          'tile_metres':[TILE_METRES,rows*step],'height_range_mm':HEIGHT_RANGE_MM,
          'dimensions':[N,rows],'start_row':start_row%N,'overlap_rows':overlap,
          'method':'Native-density crop with a closed minimum-error overlap cut shared by colour, height and ORM. Normal recomputed from saved band height.',
          'note':'Optional derived band; the four primary 2048-square material maps remain unchanged.'}
    (dest/'band.json').write_text(json.dumps(info,indent=2)+'\n')
    print(f'Exported closed band: {dest.relative_to(ROOT)} ({N} x {rows})',flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--band-cm',type=float,help='Optional: export a closed 20-55cm band from existing primary maps')
    parser.add_argument('--start-row',type=int,default=0,help='Source row for optional band export')
    args=parser.parse_args()
    if args.band_cm is None:
        main()
    else:
        export_band(args.band_cm,args.start_row)
