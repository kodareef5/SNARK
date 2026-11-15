#!/usr/bin/env python3
"""Rebuild seagrape from frozen generated originals. No network or model required.

Requires Python 3, Pillow, numpy, scipy. All paths resolve relative to this file.
Height is in physical millimetres; delivered uint16 range is 0..20 mm.
Normals: normalize((-dH/dx, +dH/dy_image, 1)), OpenGL +Y up.
"""
from pathlib import Path
import hashlib
import json
import math
import time

import numpy as np
from PIL import Image, PngImagePlugin
from scipy import ndimage as nd

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'source'
SIZE = 2048
BARK_X = 1920
LANCZOS = Image.Resampling.LANCZOS


def read_json(path):
    return json.loads(path.read_text())


def write_json(path, data):
    path.write_text(json.dumps(data, indent=2) + '\n')


def largest_component(mask):
    labels, _ = nd.label(mask, structure=np.ones((3, 3)))
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    return labels == np.argmax(sizes)


def edge_extend(rgb, mask):
    """Nearest opaque texel extension, not multiplication by alpha."""
    _, indices = nd.distance_transform_edt(~mask, return_indices=True)
    return rgb[indices[0], indices[1]]


def clean_original(path, name, threshold):
    raw = np.array(Image.open(path).convert('RGBA'))
    mask = largest_component(raw[..., 3] >= threshold)
    if name.startswith('leaf') and name != 'leaf9':
        mask = nd.binary_fill_holes(mask)
    else:
        # Retain designed holes and open gaps, fill only isolated pinpricks.
        holes = nd.binary_fill_holes(mask) & ~mask
        labels, _ = nd.label(holes)
        sizes = np.bincount(labels.ravel())
        fill = (sizes < 25)
        fill[0] = False
        mask |= fill[labels]
    ys, xs = np.where(mask)
    box = [int(xs.min()), int(ys.min()), int(xs.max()+1), int(ys.max()+1)]
    x0, y0, x1, y1 = box
    # Fully retain generated surface colour; remove only fringe colour contamination.
    rgb = edge_extend(raw[..., :3], nd.binary_erosion(mask, iterations=2))
    return rgb[y0:y1, x0:x1], mask[y0:y1, x0:x1], box, raw.shape[:2]


def prepare(spec, recipe):
    name = spec['name']
    path = SOURCE / (spec.get('source', name) + '_original.png')
    rgb, mask, box, raw_shape = clean_original(path, name, recipe['alpha_source_threshold'])
    scale = recipe['scale_px_per_m']
    h, w = mask.shape
    if 'width_m' in spec:
        factor = spec['width_m'] * scale / w
    else:
        factor = spec['length_m'] * scale / (h-1)
    tw, th = round(w*factor), round(h*factor)
    fx, fy = tw/w, th/h
    color = np.array(Image.fromarray(rgb).resize((tw, th), LANCZOS))
    alpha = np.array(Image.fromarray(mask.astype(np.uint8)*255).resize((tw, th), LANCZOS))
    # One-pixel antialias, opaque interiors; remove Lanczos ringing outside support.
    alpha = np.clip((alpha.astype(float)-24)*255/207, 0, 255).round().astype(np.uint8)
    support = alpha >= 128
    alpha[nd.binary_erosion(support)] = 255
    alpha[~nd.binary_dilation(support)] = 0
    # Source has already been cut and crop fits all significant alpha.
    if name.startswith('fruit'):
        yy = np.where(support.any(axis=1))[0][0]
        xx = round(float(np.mean(np.where(support[yy:yy+2])[1])))
    else:
        yy = np.where(support.any(axis=1))[0][-1]
        xx = round(float(np.mean(np.where(support[max(0,yy-1):yy+1])[1])))
    margin = recipe['margin_px']
    # Stalk foot exactly centered, even on asymmetric silhouettes.
    halfwidth = int(math.ceil(max(xx, tw-1-xx) + margin + 1))
    cw, ch = halfwidth*2+1, th+margin*2
    dx, dy = halfwidth-xx, margin
    tile = np.zeros((ch, cw, 4), np.uint8)
    tile[dy:dy+th, dx:dx+tw, :3] = color
    tile[dy:dy+th, dx:dx+tw, 3] = alpha
    solid = tile[...,3] >= 128
    tile[...,:3] = edge_extend(tile[...,:3], solid)
    anchor = [halfwidth, int(yy+dy)]
    tipy = int(np.where(solid.any(axis=1))[0][-1 if name.startswith('fruit') else 0])
    tipx = int(round(float(np.mean(np.where(solid[tipy])[0]))))
    tip = [tipx, tipy]
    transform = {'crop':box, 'factor_xy':[fx,fy], 'offset':[dx,dy], 'raw_shape':list(raw_shape)}
    return tile, anchor, tip, transform


def original_point(p, transform):
    x0,y0,_,_ = transform['crop']
    fx,fy = transform['factor_xy']
    dx,dy = transform['offset']
    return ((p[0]-x0+.5)*fx-.5+dx, (p[1]-y0+.5)*fy-.5+dy)


def micro_relief(rgb, mask):
    """Extract thin visible veins; avoid turning broad pigment patches into hills."""
    c = edge_extend(rgb, mask).astype(np.float32)/255
    # Both pale and red veins have a strong local red-channel ridge.
    red_hi = c[...,0] - nd.gaussian_filter(c[...,0], 2.3)
    green_hi = c[...,1] - nd.gaussian_filter(c[...,1], 2.3)
    veins = np.clip(np.maximum(red_hi*7.0, green_hi*5.0), 0, 1)
    veins = nd.gaussian_filter(veins, .40)
    luma = c @ np.array([.2126,.7152,.0722],np.float32)
    fine = np.clip(luma-nd.gaussian_filter(luma,.8), -.08,.08)
    return veins, fine


def vein_hollows(veins, core, blade, settings, width_scale=1):
    """Soft cavities beside connected visible veins; open lamina stays at AO 1.

    This is an ORM-only field: it must never feed height, normals or colour.
    Reject short pigment speckles before extending the vein-side cavities.
    """
    seeds = (veins > settings['vein_threshold']) & blade
    seeds &= nd.binary_erosion(core, iterations=2)
    labels, _ = nd.label(seeds, structure=np.ones((3, 3)))
    sizes = np.bincount(labels.ravel())
    keep = sizes >= settings['vein_min_pixels']
    keep[0] = False
    seeds = keep[labels]
    if not seeds.any():
        return np.zeros(core.shape, np.float32)
    distance = nd.distance_transform_edt(~seeds)
    # Peak just off the raised vein, then smoothly return to exactly unoccluded.
    falloff = np.exp(-((distance-2)/(settings['vein_hollow_width_px']*width_scale))**2)
    return np.clip((falloff-.02)/.98, 0, 1)


def satin_roughness(base, veins, ageing=0):
    # Strong midrib ridges are a little smoother than the leathery blade face.
    return np.clip(base + .012 - .037*veins + ageing, .62, .74)


def delight_fruit(tile, name, transform, geometry):
    """Remove broad residual scan shading per berry, retaining hue and fine speckle.

    The analytic sphere belongs to height/normal, not to base-colour luminance.
    A normalized local filter avoids pulling transparent background into the fit.
    """
    rgb=tile[...,:3].astype(np.float32)
    Y,X=np.indices(tile.shape[:2],dtype=np.float32)
    for cx,cy,r in geometry[name]['berries']:
        x,y=original_point([cx,cy],transform)
        rx=r*transform['factor_xy'][0];ry=r*transform['factor_xy'][1]
        q=((X-x)/(rx+1))**2+((Y-y)/(ry+1))**2
        selection=(q<1.1)&(tile[...,3]>=128)
        weight=selection.astype(np.float32)
        luma=rgb @ np.array([.2126,.7152,.0722],np.float32)
        sigma=(rx+ry)*.19
        blurred=nd.gaussian_filter(luma*weight,sigma)/np.maximum(nd.gaussian_filter(weight,sigma),1e-5)
        middle=selection&(q<.65)
        target=float(np.median(luma[middle]))
        gain=np.clip(target/np.maximum(blurred,1),.75,1.40)
        rgb[selection]*=gain[selection,None]
    tile[...,:3]=np.rint(rgb).clip(0,255).astype(np.uint8)


def material(tile, spec, transform, geometry, recipe):
    name = spec['name']
    mask = tile[...,3] > 0
    core = tile[...,3] >= 128
    Y, X = np.indices(mask.shape, dtype=np.float32)
    dist = nd.distance_transform_edt(core)
    if name.startswith('fruit'):
        delight_fruit(tile,name,transform,geometry)
    veins, fine = micro_relief(tile[...,:3], core)
    ao = np.ones(mask.shape, np.float32)
    rough = np.full(mask.shape, spec['roughness'],np.float32)
    settings = recipe['packed_material']
    detail = {}
    if name.startswith('leaf'):
        # Fill damage for blade curvature: a hole does not form a crater in the lamina.
        filled = nd.binary_fill_holes(core)
        broad = nd.binary_opening(filled, iterations=5)
        dblade = nd.distance_transform_edt(broad)
        dblade = nd.gaussian_filter(dblade, 2.4)
        dome = np.clip(dblade/max(float(dblade.max()),1), 0,1)
        if spec['shape'] == 'cup':
            z = 1.5 + 1.05*(1-dome) + .7*np.sin(X/45)*dome
        else:
            z = .9 + 3.4*dome**.80 + .22*np.sin(X/33+Y/64)*dome
        z += .85*veins + fine*.8
        # Model the petiole as a rounded cylinder below the broad blade.
        rows = np.where(broad.sum(axis=1)>max(20, core.shape[1]*.13))[0]
        blade_bottom = int(rows[-1])
        petiole = Y > blade_bottom+1
        z[petiole] = (.6 + np.minimum(dist[petiole],4.0)*.40)
        rough[petiole] = .73
        ax = (core.shape[1]-1)/2
        root_contact = np.exp(-((X-ax)/11)**2-((Y-blade_bottom)/15)**2)
        ao -= .22*root_contact
        rough += .025*np.clip(veins,0,1)
        if name in ['leaf6','leaf7','leaf8']:
            rough += .025*(1-dome)
        # Preserve the original stalk channels; revise only the blade material.
        blade = mask & ~petiole
        ageing = .012*(1-dome) if name in ['leaf6','leaf7','leaf8'] else 0
        rough[blade] = satin_roughness(spec['roughness'], veins, ageing)[blade]
        cavities = np.maximum(vein_hollows(veins, core, blade, settings), root_contact)
        ao[blade] = (1-settings['leaf_ao_depth']*cavities)[blade]
        detail['blade_width_m'] = spec['width_m']
    elif name.startswith('fruit'):
        z = .6 + np.minimum(dist, 2.4)*.42
        rough[:] = .77
        berry_id = np.zeros(mask.shape,np.uint8)
        coverage = np.zeros(mask.shape,np.uint8)
        centres=[]
        for idx, (cx,cy,r) in enumerate(geometry[name]['berries'],1):
            x,y = original_point([cx,cy], transform)
            rx = r*transform['factor_xy'][0]
            ry = r*transform['factor_xy'][1]
            # Extend to the slightly irregular scanned silhouette around fitted circle.
            q = ((X-x)/(rx+1.0))**2 + ((Y-y)/(ry+1.0))**2
            inside = q <= 1.08
            radius_mm = (rx+ry)/2 / (recipe['scale_px_per_m']/1000)
            sphere = 1.6 + radius_mm*np.sqrt(np.maximum(0,1-q))
            front = inside & (sphere>z) & mask
            z[front] = sphere[front]
            berry_id[front] = idx
            berry_rough = np.clip(spec['roughness'] + .02*(q-.5), .55, .65)
            rough[inside & mask] = berry_rough[inside & mask]
            coverage[inside] += 1
            centres.append({'center':[round(x,3),round(y,3)],'radius_px':round((rx+ry)/2,3),'diameter_m':round(radius_mm/500,5)})
        # Open berry faces stay unoccluded; attachment side and overlaps get AO.
        for idx,c in enumerate(centres,1):
            x,y=c['center']; r=c['radius_px']
            side=np.sign((core.shape[1]-1)/2-x)
            contact=np.exp(-((X-(x+side*r*.83))/(r*.52+1))**2-((Y-y)/(r*.65+1))**2)
            # Shade the facing rims of neighbouring berries as well as the pedicel side.
            for other_idx, other in enumerate(centres, 1):
                if other_idx == idx:
                    continue
                ox,oy = other['center']; separation = math.hypot(ox-x,oy-y)
                if separation < 1.45*(r+other['radius_px']):
                    cx=x+(ox-x)/separation*r*.87
                    cy=y+(oy-y)/separation*r*.87
                    facing=np.exp(-((X-cx)/(r*.45+1))**2-((Y-cy)/(r*.45+1))**2)
                    contact=np.maximum(contact,facing)
            contact=np.clip((contact-.02)/.98,0,1)
            ao -= .30*contact*(berry_id==idx)
        ao[(berry_id==0)&mask]=.80
        ao[(coverage>1)&mask] = np.minimum(ao[(coverage>1)&mask], .72)
        z += .045*veins
        detail['berries']=centres
        detail['berry_count']=len(centres)
    else:
        # Seven separate annotated blades, their overlap order, and rounded grey wood.
        z = .65 + np.minimum(dist,5)*.50
        rough[:] = .88
        leaf_id = np.zeros(mask.shape,np.uint8)
        coverage=np.zeros(mask.shape,np.uint8)
        for idx,leaf in enumerate(geometry['twig1']['leaves'],1):
            x,y=original_point(leaf['center'],transform)
            rx=leaf['radii'][0]*transform['factor_xy'][0]
            ry=leaf['radii'][1]*transform['factor_xy'][1]
            q=((X-x)/rx)**2+((Y-y)/ry)**2
            inside=(q<1.12)&mask
            blade=leaf['z_mm']+2.15*np.maximum(0,1-q)+.64*veins
            z[inside]=blade[inside]
            leaf_id[inside]=idx
            rough[inside]=satin_roughness(spec['roughness'],veins)[inside]
            coverage[inside]+=1
        ao[(leaf_id==0)&mask]=.91
        overlap=nd.gaussian_filter((coverage>1).astype(float),1.2)
        ao-=.28*overlap
        # Darkening only near blade attachments, never baked into the base layer.
        attachment=nd.gaussian_filter(((leaf_id==0)&core).astype(float),3)
        ao-=.14*attachment*(leaf_id>0)
        blade=leaf_id>0
        # Young twig blades are smaller: keep open lamina between their closer veins.
        cavities=vein_hollows(veins,core,blade,settings,width_scale=.5)
        cavities=np.maximum(cavities,np.clip(attachment*5,0,1))
        ao[blade]=np.minimum(ao[blade],1-settings['leaf_ao_depth']*cavities[blade])
        detail['leaf_count']=len(geometry['twig1']['leaves'])
    # Feather relief only at the silhouette; the outside is exactly lowest height.
    feather=np.clip(dist/1.8,0,1)
    # Extend into antialiased edge from its nearest core sample before tapering.
    _,ix=nd.distance_transform_edt(~core,return_indices=True)
    z=np.where(core,z,z[ix[0],ix[1]])
    feather=np.where(core,feather,tile[...,3]/255*.45)
    z=np.maximum(z,0)*feather
    z[~mask]=0
    ao=np.clip(ao,.5,1)
    rough=np.clip(rough,.25,.95)
    orm=np.stack([ao*255,rough*255,np.zeros_like(ao)],axis=-1).round().astype(np.uint8)
    orm[~mask]=[255,235,0]
    return z,orm,detail


def seamless_vertical(arr, band=84):
    """Blend paired samples symmetrically at boundary; matching values and slopes."""
    out=arr.astype(np.float32).copy()
    for j in range(band):
        t=j/(band-1)
        weight=(1-t*t*(3-2*t))
        avg=(arr[j].astype(float)+arr[-1-j].astype(float))*.5
        out[j]=arr[j]*(1-weight)+avg*weight
        out[-1-j]=arr[-1-j]*(1-weight)+avg*weight
    out[0]=out[-1]=(out[0]+out[-1])*.5
    # Equal endpoint neighbours ensure identical wrap derivatives after quantization.
    out[1]=out[-2]=out[0]
    return out


def bark_material(recipe):
    raw=Image.open(SOURCE/'bark_original.png').convert('RGB')
    # A narrow isotropic strip, not the entire square squeezed to a thin column.
    scaled=raw.resize((2048,2048),LANCZOS)
    rgb=np.array(scaled)[:,880:1008]
    rgb=seamless_vertical(rgb).round().clip(0,255).astype(np.uint8)
    c=rgb.astype(np.float32)/255
    lum=c @ np.array([.2126,.7152,.0722],np.float32)
    smooth=nd.gaussian_filter(lum,3,mode=('wrap','reflect'))
    medium=nd.gaussian_filter(lum,.65,mode=('wrap','reflect'))
    z=2.0+(smooth-.52)*1.6+(medium-smooth)*2.1
    z=seamless_vertical(z,32)
    cavities=np.maximum(0,smooth-medium)
    ao=np.clip(1-cavities*.7,.87,1)
    rough=np.clip(.87+(smooth-.5)*.08,.82,.93)
    orm=np.stack([ao*255,rough*255,np.zeros_like(ao)],axis=-1)
    orm=seamless_vertical(orm,32).round().astype(np.uint8)
    return rgb,z,orm


def normal_from_height(height16, scale, range_mm, bark_metres):
    mm=height16.astype(np.float64)/65535*range_mm
    n=np.empty((*mm.shape,3),np.float64)
    # Treat separate bark UV island with its own isotropic physical texel size.
    for a,b,px_per_m in [(0,BARK_X,scale),(BARK_X,SIZE,SIZE/bark_metres)]:
        h=mm[:,a:b]
        gy,gx=np.gradient(h)
        if a==BARK_X:
            gy=(np.roll(h,-1,axis=0)-np.roll(h,1,axis=0))*.5
        gx*=px_per_m/1000
        gy*=px_per_m/1000
        nn=np.stack([-gx,gy,np.ones_like(h)],axis=-1)
        nn/=np.linalg.norm(nn,axis=-1,keepdims=True)
        n[:,a:b]=nn
    return np.clip(np.rint((n*.5+.5)*255),0,255).astype(np.uint8)


def png_save(array,path,mode=None,srgb=False):
    info=PngImagePlugin.PngInfo()
    if srgb: info.add(b'sRGB',b'\x00')
    info.add_text('Description','Sea grape atlas; see REPORT.md and source/recipe.json')
    im=Image.fromarray(array) if mode is None else Image.fromarray(array,mode)
    im.save(path,pnginfo=info,compress_level=9)


def main():
    started=time.monotonic()
    recipe=read_json(SOURCE/'recipe.json')
    geometry=read_json(SOURCE/'geometry.json')
    (SOURCE/'prepared').mkdir(exist_ok=True)
    base=np.zeros((SIZE,SIZE,4),np.uint8)
    height=np.zeros((SIZE,SIZE),np.float32)
    orm=np.empty((SIZE,SIZE,3),np.uint8);orm[:]=[255,235,0]
    owner=np.zeros((SIZE,BARK_X),np.int16)
    details={}; elements=[]; means={}
    for idx,spec in enumerate(recipe['elements'],1):
        name=spec['name']
        tile,anchor,tip,transform=prepare(spec,recipe)
        z,material_orm,detail=material(tile,spec,transform,geometry,recipe)
        h,w=tile.shape[:2];x,y=spec['xy']
        rect=[x,y,x+w,y+h]
        assert x>=0 and y>=0 and x+w<=BARK_X and y+h<=SIZE,(name,rect)
        assert not owner[y:y+h,x:x+w].any(),('overlap',name)
        owner[y:y+h,x:x+w]=idx
        base[y:y+h,x:x+w]=tile
        height[y:y+h,x:x+w]=z
        orm[y:y+h,x:x+w]=material_orm
        anchor=[anchor[0]+x,anchor[1]+y];tip=[tip[0]+x,tip[1]+y]
        length=math.dist(anchor,tip)/recipe['scale_px_per_m']
        elements.append({'name':name,'rect':rect,'anchor':anchor,'tip':tip,'metres':round(length,6)})
        means[idx]=tile[...,:3][tile[...,3]>=128].mean(axis=0)
        details[name]={'description':spec['description'],'transform':transform,**detail}
        png_save(tile,SOURCE/'prepared'/f'{name}.png',srgb=True)
    # Assign all unused space to nearest rectangular island, fill with that mean.
    _,nearest=nd.distance_transform_edt(owner==0,return_indices=True)
    owners=owner[nearest[0],nearest[1]]
    for idx,mean in means.items():
        empty=(owner==0)&(owners==idx)
        base[:,:BARK_X,:3][empty]=np.rint(mean).astype(np.uint8)
    # At least 32 pixels of actual nearest-edge colour around every silhouette.
    solid=base[:,:BARK_X,3]>=128
    distances,indices=nd.distance_transform_edt(~solid,return_indices=True)
    edge_rgb=base[:,:BARK_X,:3][indices[0],indices[1]]
    bleed=(distances<=36)&~solid
    base[:,:BARK_X,:3][bleed]=edge_rgb[bleed]
    # Outside the bleed band, rectangle interiors also use each island mean.
    for idx,mean in means.items():
        m=(owner==idx)&(distances>36)&~solid
        base[:,:BARK_X,:3][m]=np.rint(mean).astype(np.uint8)
    brgb,bz,borm=bark_material(recipe)
    base[:,BARK_X:,:3]=brgb;base[:,BARK_X:,3]=255
    height[:,BARK_X:]=bz;orm[:,BARK_X:]=borm
    elements.append({'name':'bark','role':'bark','rect':[BARK_X,0,SIZE,SIZE],'metres':recipe['bark_metres']})
    layout={'scale_px_per_m':recipe['scale_px_per_m'],'elements':elements}
    write_json(ROOT/'layout.json',layout)
    h16=np.rint(np.clip(height/recipe['height_range_mm'],0,1)*65535).astype(np.uint16)
    png_save(base,ROOT/'seagrape_base.png',srgb=True)
    png_save(h16,ROOT/'seagrape_height.png')
    # Reopen the delivered height. Normal derivation cannot diverge from quantization.
    delivered=np.array(Image.open(ROOT/'seagrape_height.png'))
    normal=normal_from_height(delivered,recipe['scale_px_per_m'],recipe['height_range_mm'],recipe['bark_metres'])
    png_save(normal,ROOT/'seagrape_normal.png')
    png_save(orm,ROOT/'seagrape_orm.png')
    write_json(SOURCE/'build_metadata.json',{
        'height_range_mm':recipe['height_range_mm'],
        'normal_convention':'OpenGL, +Y toward image top',
        'normal_formula':'normalize(-dH/dx, +dH/dy_image, 1); central differences; one-sided at UV island x borders; periodic bark y',
        'bark_px_per_m':SIZE/recipe['bark_metres'],
        'elements':details,
        'files_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(ROOT.glob('seagrape_*.png'))},
        'build_seconds':round(time.monotonic()-started,3)
    })
    print(f'Built {len(elements)} elements in {time.monotonic()-started:.1f}s')


if __name__=='__main__':
    main()
