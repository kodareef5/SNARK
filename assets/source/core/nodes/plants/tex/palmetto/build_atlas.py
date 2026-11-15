#!/usr/bin/env python3
"""Rebuild the palmetto PBR atlas, offline, from frozen imagegen originals.

Dependencies: Python 3, Pillow, NumPy, SciPy. Run: python3 build_atlas.py
No network access, generated-image cache, or files outside this directory needed.
Height is metric relief, not an albedo-to-normal filter. Source radial ribs,
segment cross sections, veins, spear curvature, and trunk fibres inform relief.
"""
from pathlib import Path
import hashlib
import json
import math
import platform
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'source'
RESAMPLE = Image.Resampling.LANCZOS


def save_json(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def luminance(rgb):
    return np.einsum('...c,c->...', rgb, [0.2126, 0.7152, 0.0722])


def nearest_fill(rgb, mask):
    """Extend high confidence surface colour through the transparent surround."""
    _, ix = ndi.distance_transform_edt(~mask, return_indices=True)
    return rgb[tuple(ix)]


def clean_source(filename):
    rgba = np.asarray(Image.open(SOURCE / filename).convert('RGBA'))
    # Generated RGB in near-zero alpha pixels can be vivid matte residue.
    # Retain the actual silhouette, eliminate this residue, and make leaves solid.
    mask = rgba[..., 3] >= 128
    labels, count = ndi.label(mask)
    sizes = np.bincount(labels.ravel()); sizes[0] = 0
    mask = labels == np.argmax(sizes)
    holes = ndi.binary_fill_holes(mask) & ~mask
    hl, _ = ndi.label(holes)
    hs = np.bincount(hl.ravel())
    mask |= holes & (hs[hl] <= 20)
    # Only replace colour on the one-source-pixel perimeter. Interior detail stays.
    core = ndi.binary_erosion(mask) & (rgba[..., 3] >= 230)
    rgb = nearest_fill(rgba[..., :3].astype(np.float32), core)
    rgb[core] = rgba[..., :3][core]
    yy, xx = np.where(mask)
    box = [int(xx.min()), int(yy.min()), int(xx.max()+1), int(yy.max()+1)]
    x0, y0, x1, y1 = box
    return rgb[y0:y1, x0:x1], mask[y0:y1, x0:x1], box


def resize_rgb(rgb, size):
    return np.asarray(Image.fromarray(np.clip(np.rint(rgb), 0, 255).astype('uint8')).resize(size, RESAMPLE)).astype(np.float32)


def resize_mask(mask, size):
    alpha = np.asarray(Image.fromarray(mask.astype('uint8') * 255).resize(size, RESAMPLE)).copy()
    return sanitize_alpha(alpha)


def sanitize_alpha(alpha):
    # One-pixel coverage edge; no ringing/haze or fractional leaf interiors.
    alpha = np.rint(alpha).astype('uint8').copy()
    alpha[alpha < 48] = 0
    alpha[alpha > 207] = 255
    alpha[ndi.distance_transform_edt(alpha > 0) > 1.5] = 255
    return alpha


def periodic_overlap(a, overlap):
    """Preserve texture detail with an overlapping, raised-cosine crossfade.

    Unlike blending to a single scanline, this never stretches fibres along Y.
    Output period is input height minus overlap. At wrap it follows adjacent
    source scanlines; only the subpixel seam correction below is then needed.
    """
    period = len(a)-overlap
    result = a[:period].copy()
    t = np.linspace(0,1,overlap)
    t = (.5-.5*np.cos(np.pi*t)).reshape((overlap,)+(1,)*(a.ndim-1))
    result[:overlap] = a[period:]*(1-t)+a[:overlap]*t
    return result


def periodic_edges(a, band=96):
    """Make endpoint samples and their central derivatives agree exactly.

    Only two rows at either end change; texture detail is not smeared. `band`
    is retained for callers but no broad flattening band is applied.
    """
    a = a.copy()
    seam = (a[0].astype(np.float64) + a[-1]) * .5
    # Repeating the seam for two rows gives an exact zero derivative there,
    # including after quantization. The transition is just 0.4-0.5 mm long.
    a[0]=seam; a[-1]=seam; a[1]=seam; a[-2]=seam
    return a


def card(spec):
    rgb, mask, box = clean_source(spec['source'])
    hh, ww = mask.shape
    x0, y0, x1, y1 = spec['rect']; rw, rh = x1-x0, y1-y0
    if spec['name'] == 'spear1':
        scale = spec['max_height'] / hh
    else:
        scale = min(spec['max_width']/ww, (rw-48)/ww, (rh-48)/hh)
    w, h = int(round(ww*scale)), int(round(hh*scale))
    rgb = resize_rgb(rgb, (w, h)); alpha = resize_mask(mask, (w, h))
    # Find the hastula in the centre window, not a low hanging peripheral tip.
    lo, hi = int(w*.43), int(w*.57)
    sy, sx = np.where(alpha[:, lo:hi] >= 128)
    ay = int(sy.max()); band = sy >= ay-1
    ax = int(round(np.median(sx[band]+lo)))
    dx = int(np.clip(rw//2-ax, 24, rw-24-w))
    dy = rh-24-h
    out_rgb = np.zeros((rh, rw, 3), np.float32)
    out_a = np.zeros((rh, rw), np.uint8)
    out_rgb[dy:dy+h, dx:dx+w] = rgb
    out_a[dy:dy+h, dx:dx+w] = alpha
    yy, xx = np.where(alpha >= 128)
    # Anatomical tip = highest distal point; metres is anchor-to-tip distance.
    ty = int(yy.min()); choices=xx[yy == ty]
    tx = int(choices[np.argmin(np.abs(choices-np.median(choices)))])
    anchor = [x0+dx+ax, y0+dy+ay]
    tip = [x0+dx+tx, y0+dy+ty]
    meta = {'source_bbox': box, 'placed_bbox': [x0+dx, y0+dy, x0+dx+w, y0+dy+h],
            'width_m': round(w/1100, 6), 'height_m': round(h/1100, 6),
            'source_anchor': [round(box[0]+ax/scale, 3), round(box[1]+ay/scale, 3)]}
    return out_rgb, out_a, anchor, tip, meta


def fan_relief(rgb, alpha, anchor, dead=False):
    """Metric segment dome + measured radial pleats + fine parallel veins."""
    solid = alpha >= 128; active = alpha > 0
    filled = nearest_fill(rgb, solid)
    lum = luminance(filled) / 255.
    h, w = alpha.shape
    yy, xx = np.mgrid[:h, :w]
    ax, ay = anchor
    rad = np.hypot(xx-ax, yy-ay)
    theta = np.arctan2(xx-ax, ay-yy)
    # Reconstruct the real ribs from the source. Average their contrast across
    # several radii, rather than imposing evenly spaced synthetic stripes.
    angles = np.linspace(-1.6, 1.6, 1600)
    maxr = max(1, ay-np.where(solid)[0].min())
    radii = np.linspace(.14*maxr, .67*maxr, 110)
    px = ax + np.sin(angles)[None, :] * radii[:, None]
    py = ay - np.cos(angles)[None, :] * radii[:, None]
    field = ndi.gaussian_filter(lum, .7) - ndi.gaussian_filter(lum, 8)
    samples = ndi.map_coordinates(field, [py, px], order=1, mode='nearest')
    valid = ndi.map_coordinates(solid.astype(float), [py, px], order=0, mode='constant')
    profile = (samples*valid).sum(axis=0) / np.maximum(valid.sum(axis=0), 1)
    profile = ndi.gaussian_filter1d(profile, 1.3)
    amplitude = max(np.percentile(np.abs(profile), 95), .012)
    profile = np.clip(profile/amplitude, -1, 1)
    pleat = np.interp(theta, angles, profile)
    d = ndi.distance_transform_edt(solid)
    dome = 1-np.exp(-d/4.5)
    broad = .35 + 1.25*dome + .45*np.clip(rad/maxr, 0, 1)
    crease = (.7 if dead else .9) * pleat * np.clip(rad/35, 0, 1)
    local = np.clip(field, -.10, .10) * (10 if dead else 7)
    veins = np.clip(lum-ndi.gaussian_filter(lum, 1.1), -.06, .06) * 3
    relief = np.maximum(.2, broad+crease+local+veins)
    if dead:
        relief += .7*np.maximum(0, ndi.gaussian_filter(lum, 3)-ndi.gaussian_filter(lum, 15))*10
    edge = np.clip((ndi.distance_transform_edt(active)-.15)/1.5, 0, 1)
    relief *= edge
    relief[~active] = 0
    # Move narrow crease darkening to AO; keep pigment and fine colour detail.
    smooth = ndi.gaussian_filter(lum, 6)
    darkness = np.clip((smooth-lum)/np.maximum(smooth, .15), 0, .6)
    base = filled * (1 + .42*darkness[..., None])
    ao = 1 - .30*darkness - .10*np.exp(-rad/65) - .06*np.maximum(-pleat, 0)
    ao[~active] = 1
    return np.clip(base, 0, 255), relief, np.clip(ao, .55, 1), field


def spear_relief(rgb, alpha):
    mask = alpha >= 128
    filled = nearest_fill(rgb, mask); lum = luminance(filled)/255
    dist = ndi.distance_transform_edt(mask)
    rowmax = np.maximum(dist.max(axis=1, keepdims=True), 1)
    dome = np.sqrt(np.clip(1-(1-dist/rowmax)**2, 0, 1))
    veins = ndi.gaussian_filter(lum, .65)-ndi.gaussian_filter(lum, 3)
    height = .3 + 4.3*dome + np.clip(veins*7, -.6, .6)
    height[alpha == 0] = 0
    ao = np.clip(1-np.maximum(-veins, 0)*1.4, .75, 1)
    return filled, height, ao, veins


def stalk(spec):
    """Opaque unrolled skin for the modelled 15 mm diameter tube.

    The source's lighter centre is pigment only. Height contains fine fibres
    and shallow painted tooth relief; neither height nor AO adds a cylinder.
    """
    original = Image.open(SOURCE/spec['source']).convert('RGB')
    rgb = np.asarray(original.resize((64,2176),RESAMPLE)).astype(float)
    rgb = periodic_edges(periodic_overlap(rgb,128))
    # The left/right edges meet round the back of the tube, too. Match their
    # endpoint samples and derivatives without moving the inset tooth rows.
    def wrap_surface(a):
        return periodic_edges(periodic_edges(a).swapaxes(0,1)).swapaxes(0,1)
    rgb = wrap_surface(rgb)
    alpha = np.full((2048,64),255,np.uint8)
    lum = luminance(rgb)/255
    # Remove the broad pigment profile before deriving microrelief. A
    # lengthwise filter favours fibres rather than the occasional brown scuff.
    grain = (ndi.gaussian_filter(lum,(2,.5),mode='wrap')
             - ndi.gaussian_filter(lum,(2,2.5),mode='wrap'))
    grain = wrap_surface(grain)
    local_dark = ndi.gaussian_filter(lum,(20,1),mode='wrap')-lum
    side_band = np.zeros((1,64));side_band[:,3:10]=1;side_band[:,54:61]=1
    teeth = np.clip((local_dark-.025)/.10,0,1)*side_band
    teeth = ndi.gaussian_filter(teeth,.45,mode='wrap')
    relief = wrap_surface(.30+np.clip(grain*5,-.12,.12)+.30*teeth)
    ao = wrap_surface(np.clip(1-np.maximum(-grain,0)*.6-.06*teeth,.92,1))
    return rgb,alpha,relief,ao,grain,{
        'source_bbox':[0,0,original.width,original.height],
        'surface_width_px':64,'tube_diameter_m':.015,
        'surface_circumference_m':math.pi*.015,
        'height_model':'0.30 mm datum + fine fibres + shallow tooth marks; no tube roundness',
        'tooth_bands_px':[[3,10],[54,61]]}


def bark(spec):
    original = Image.open(SOURCE/spec['source']).convert('RGB')
    # Narrow longitudinal crop preserves leaf-base aspect, avoiding squeezing a
    # wide photograph into the 128 px column. Source image height covers 0.8 m.
    crop_width = round(original.height * (128/1100) / (.8*2304/2048))
    left = (original.width-crop_width)//2
    box = [left, 0, left+crop_width, original.height]
    rgb = np.asarray(original.crop(box).resize((128,2304), RESAMPLE)).astype(float)
    rgb = periodic_edges(periodic_overlap(rgb,256))
    lum = luminance(rgb)/255
    macro = ndi.gaussian_filter(lum, (5, 2), mode=('wrap','nearest'))
    p5, p95 = np.percentile(macro, [5,95])
    plates = np.clip((macro-p5)/(p95-p5), 0, 1)
    fibres = lum-ndi.gaussian_filter(lum, (1.7, .7), mode=('wrap','nearest'))
    relief = 1.4 + 10.2*plates + np.clip(fibres*20, -1.1, 1.1)
    relief = periodic_edges(relief, 40)
    cavity = np.clip((ndi.gaussian_filter(lum, (12, 5), mode=('wrap','nearest'))-lum)*4, 0, .55)
    ao = periodic_edges(np.clip(.98-.55*cavity-.18*(1-plates), .55, 1), 40)
    # Remove most photographed cavity darkening from albedo, retain brown fibres.
    rgb = periodic_edges(np.clip(rgb*(1+.65*cavity[..., None]), 0, 255), 40)
    return rgb, np.full((2048,128),255,np.uint8), relief, ao, fibres, {'source_bbox':box}


def normal_map(height_u16, alpha, elements, full_mm, px_per_m):
    """OpenGL: +X right, +Y up. Image y runs down, so G uses +dh/dy."""
    normal = np.full((*height_u16.shape, 3), [128,128,255], dtype=np.uint8)
    for e in elements:
        x0,y0,x1,y1 = e['rect']
        z = height_u16[y0:y1,x0:x1].astype(np.float64) * (full_mm/1000/65535)
        dx = math.pi*.015/(x1-x0) if e['name']=='stalk' else 1/px_per_m
        dy = e['metres']/(y1-y0) if e.get('role') == 'bark' else dx
        gx = ((np.roll(z,-1,axis=1)-np.roll(z,1,axis=1))/(2*dx)
              if e['name']=='stalk' else np.gradient(z,dx,axis=1))
        gy = ((np.roll(z,-1,axis=0)-np.roll(z,1,axis=0))/(2*dy)
              if e.get('role') == 'bark' else np.gradient(z,dy,axis=0))
        v = np.stack([-gx,gy,np.ones_like(z)], axis=-1)
        v /= np.linalg.norm(v,axis=-1,keepdims=True)
        enc = np.clip(np.rint((v+1)*127.5),0,255).astype(np.uint8)
        enc[alpha[y0:y1,x0:x1] == 0] = [128,128,255]
        normal[y0:y1,x0:x1] = enc
    return normal


def bleed_colours(rgb, alpha, ids, count, bleed_px):
    """32 px nearest-edge gutter, then each nearest element's mean pigment.

    Foliage and the two strip domains are isolated so bark never enters a fan
    gutter. Edge dilation crosses card rectangles through empty space.
    """
    out = rgb.copy()
    for x0,x1 in [(0,1856),(1856,1920),(1920,2048)]:
        a = alpha[:,x0:x1]; c = rgb[:,x0:x1]; labels = ids[:,x0:x1]
        solid = a >= 250
        dist, ix = ndi.distance_transform_edt(~solid, return_indices=True)
        near = c[tuple(ix)]; nearest_id = labels[tuple(ix)]
        means = np.zeros((count+1,3),float)
        for k in np.unique(labels[solid]):
            means[k] = c[solid & (labels == k)].mean(axis=0)
        fill = means[nearest_id]
        # Full edge colour through 32 px, 8 px smooth fade, then mean.
        t = np.clip((dist-bleed_px)/8,0,1)[...,None]
        fill = near*(1-t)+fill*t
        out[:,x0:x1] = np.where((a==0)[...,None],fill,c)
    return np.rint(np.clip(out,0,255)).astype('uint8')


def main():
    recipe = json.loads((SOURCE/'recipe.json').read_text())
    size = recipe['size']; ppm = recipe['scale_px_per_m']; full_mm = recipe['height_range_mm']
    rgb = np.zeros((size,size,3),np.float32); alpha = np.zeros((size,size),np.uint8)
    height = np.zeros((size,size),np.float32)
    orm = np.full((size,size,3),[255,255,0],np.uint8)
    ids = np.zeros((size,size),np.int16)
    elements=[]; measurements={}
    for k,spec in enumerate(recipe['elements'],1):
        name=spec['name'];x0,y0,x1,y1=spec['rect']
        e = {'name':name,'rect':spec['rect']}
        if name == 'stalk':
            colour,a,z,ao,grain,meta=stalk(spec)
        elif name == 'bark':
            colour,a,z,ao,grain,meta=bark(spec)
        else:
            colour,a,anchor,tip,meta=card(spec)
            e.update(anchor=anchor,tip=tip,metres=round(math.dist(anchor,tip)/ppm,6))
            if name == 'spear1':
                colour,z,ao,grain=spear_relief(colour,a)
            else:
                colour,z,ao,grain=fan_relief(colour,a,[anchor[0]-x0,anchor[1]-y0],name.startswith('dead'))
        if spec.get('role'):
            e.update(role='bark',metres=spec['metres'])
        rough = np.clip(spec['roughness'] + .18*np.clip(-grain,-.12,.12),0,1)
        if name == 'bark': rough=np.clip(rough,.8,.95)
        if name.startswith('dead'): rough=np.clip(rough,.8,.95)
        rgba_domain=(slice(y0,y1),slice(x0,x1))
        rgb[rgba_domain]=colour;alpha[rgba_domain]=a;height[rgba_domain]=z
        ids[rgba_domain]=k
        o=np.stack([np.rint(ao*255),np.rint(rough*255),np.zeros_like(ao)],axis=-1).astype('uint8')
        if spec.get('role') == 'bark':
            o=np.rint(periodic_edges(o.astype(float))).astype('uint8')
        o[a==0]=[255,255,0]
        orm[rgba_domain]=o
        elements.append(e);measurements[name]=meta
        print(f'{name}: {spec["rect"]}, source {spec["source"]}',flush=True)
    rgb=bleed_colours(rgb,alpha,ids,len(elements),recipe['edge_bleed_px'])
    base=np.dstack([rgb,alpha])
    height[alpha==0]=0
    hu16=np.clip(np.rint(height/full_mm*65535),0,65535).astype(np.uint16)
    Image.fromarray(base).save(ROOT/'palmetto_base.png')
    Image.fromarray(hu16).save(ROOT/'palmetto_height.png')
    # Read the actual delivered quantized PNG; no hidden unquantized height.
    delivered_height=np.asarray(Image.open(ROOT/'palmetto_height.png'))
    normals=normal_map(delivered_height,alpha,elements,full_mm,ppm)
    Image.fromarray(normals).save(ROOT/'palmetto_normal.png')
    Image.fromarray(orm).save(ROOT/'palmetto_orm.png')
    layout={'scale_px_per_m':ppm,'elements':elements}
    save_json(ROOT/'layout.json',layout)
    hashes={f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(SOURCE.glob('*_original.png'))}
    save_json(SOURCE/'build_info.json',{'python':platform.python_version(),'height_range_mm':full_mm,
        'normal_convention':'OpenGL +X right +Y up, central finite differences from delivered u16 height',
        'column_texel_height_m':{'stalk':1/2048,'bark':.8/2048},
        'column_texel_width_m':{'stalk':math.pi*.015/64,'bark':1/ppm},
        'texel_width_m':1/ppm,'normal_transparent_rgb':[128,128,255],
        'elements':measurements,'source_sha256':hashes,
        'selected_fresh_source':'fan1_v2_original.png',
        'rejected_source':'fan1_original.png: edge clearance and fresh fan framing improved by v2'})
    print('Built four 2048 x 2048 layers and layout.json.')


if __name__ == '__main__':
    main()
