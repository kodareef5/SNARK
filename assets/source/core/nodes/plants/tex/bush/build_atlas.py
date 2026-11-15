#!/usr/bin/env python3
"""Rebuild the Forkleaf atlas from frozen generated originals and annotations.

Dependencies: Python 3, Pillow, NumPy, SciPy. No network or model calls.
Physical units: millimetres for height; 1300 pixels/metre for cutout cards.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as nd

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'source'
SIZE = 2048
SCALE = 1300
HEIGHT_MM = 16.0
MM_PER_PIXEL = 1000.0 / SCALE


def u8(a):
    return np.clip(np.rint(a), 0, 255).astype(np.uint8)


def write_json(path, obj):
    path.write_text(json.dumps(obj, indent=2) + '\n')


def clean_original(name):
    raw = np.asarray(Image.open(SOURCE / f'{name}_original.png').convert('RGBA')).copy()
    rgb = raw[..., :3].astype(np.float32)
    # Generated alpha includes a faint low-opacity backdrop and occasional red
    # chroma-key residues. Neither is plant material.
    key = (rgb[..., 0] > 190) & (rgb[..., 1] < 65) & (rgb[..., 2] < 65)
    mask = (raw[..., 3] > 170) & ~key
    labels, count = nd.label(mask)
    areas = np.bincount(labels.ravel())
    mask &= areas[labels] >= 30
    holes = nd.binary_fill_holes(mask) & ~mask
    labels, _ = nd.label(holes)
    areas = np.bincount(labels.ravel())
    mask |= holes & (areas[labels] <= 32)
    solid = nd.binary_erosion(mask, iterations=2)
    # Reconstruct only the boundary RGB from uncontaminated interior colours.
    _, nearest = nd.distance_transform_edt(~solid, return_indices=True)
    edge = mask & ~solid
    rgb[edge] = rgb[nearest[0][edge], nearest[1][edge]]
    green = (rgb[..., 1] > rgb[..., 0] * 1.10) & (rgb[..., 1] > rgb[..., 2] * 1.16) & mask
    # Saturated green, with no blue-channel boost. Mildly compress
    # baked illumination; recover contact darkening separately in the AO map.
    if name.startswith(('spray', 'inner')):
        lum = rgb[...,0]*.2126 + rgb[...,1]*.7152 + rgb[...,2]*.0722
        gain = np.clip((68 / np.maximum(lum, 1))**.25, .90, 1.28)
        rgb[green] *= gain[green,None]
        if name.startswith('inner'):
            rgb[green] *= .94
    # Bleed before resampling, avoiding dark RGB in the resampling kernel.
    _, nearest = nd.distance_transform_edt(~mask, return_indices=True)
    rgb[~mask] = rgb[nearest[0][~mask], nearest[1][~mask]]
    ys, xs = np.where(mask)
    box = [int(xs.min()), int(ys.min()), int(xs.max())+1, int(ys.max())+1]
    x0, y0, x1, y1 = box
    anchor_y = int(ys.max()) - 2
    near_bottom = mask[anchor_y:anchor_y+3]
    anchor_x = int(np.median(np.where(near_bottom)[1]))
    tip_y = int(ys.min()) + 1
    tip_x = int(np.median(np.where(mask[tip_y:tip_y+3])[1]))
    return rgb[y0:y1, x0:x1], mask[y0:y1, x0:x1], box, [anchor_x-x0, anchor_y-y0], [tip_x-x0, tip_y-y0]


def make_source_canvas(spec):
    name, metres = spec['name'], spec['metres']
    if name.startswith('bunch'):
        return bunch_source_canvas(spec)
    if name in ('fallen1','stripped1','stripped2'):
        old = np.asarray(Image.open(SOURCE/'preserved'/f'{name}_base.png'))
        oldinfo = json.loads((SOURCE/'preserved/geometry.json').read_text())[name]
        w,h = spec['rect'][2]-spec['rect'][0],spec['rect'][3]-spec['rect'][1]
        ox,oy = (w-old.shape[1])//2,h-33-old.shape[0]
        rgba = np.zeros((h,w,4),np.uint8)
        rgba[oy:oy+old.shape[0],ox:ox+old.shape[1]] = old
        return rgba,dict(offset=[ox,oy],anchor=(np.array(oldinfo['anchor'])+[ox,oy]).tolist(),tip=(np.array(oldinfo['tip'])+[ox,oy]).tolist(),preserved=True)
    rgb, mask, crop, anchor, tip = clean_original(name)
    if name.startswith(('spray','inner')):
        return broad_source_canvas(spec, rgb, mask, crop, anchor, tip)
    factor = metres * SCALE / np.linalg.norm(np.subtract(tip, anchor))
    outsize = [round(rgb.shape[1]*factor), round(rgb.shape[0]*factor)]
    rgb = np.asarray(Image.fromarray(u8(rgb)).resize(outsize, Image.Resampling.LANCZOS)).copy()
    a = np.asarray(Image.fromarray(mask.astype(np.uint8)*255).resize(outsize, Image.Resampling.LANCZOS)).copy()
    a[a < 18] = 0
    a[a > 237] = 255
    x0, y0, x1, y1 = spec['rect']
    w, h = x1-x0, y1-y0
    ox = (w-outsize[0])//2
    if name == 'spray5':
        ox -= 2  # reserve a complete 32px colour bleed beside the fruit
    oy = h-33-outsize[1]
    if ox < 24 or oy < 24:
        raise ValueError(f'{name}: source does not fit {outsize} in {(w,h)}')
    rgba = np.zeros((h,w,4), np.uint8)
    rgba[oy:oy+outsize[1], ox:ox+outsize[0], :3] = rgb
    rgba[oy:oy+outsize[1], ox:ox+outsize[0], 3] = a
    at = [round(anchor[0]*factor+ox), round(anchor[1]*factor+oy)]
    ti = [round(tip[0]*factor+ox), round(tip[1]*factor+oy)]
    # A subpixel petiole can round outside a tiny leaf. Anchor on the nearest
    # actual stem pixel after resampling, never on transparent background.
    ys,xs=np.where(rgba[...,3]>100)
    nearest=np.argmin((xs-at[0])**2+(ys-at[1])**2)
    at=[int(xs[nearest]),int(ys[nearest])]
    meta = dict(crop=crop, scale_from_original=factor, offset=[ox,oy], anchor=at, tip=ti)
    return rgba, meta


def bunch_source_canvas(spec):
    """Project generated pedicels; annotate berries as physical round spheres.

    Coordinates are traced on a 1280px reference view of each frozen original.
    Pedicel spacing and berry radii have separate scales so all fruit stays
    circular and within 0.8–1.2cm, including the longer, looser variant.
    """
    ann=json.loads((SOURCE/'bunch_annotations.json').read_text())[spec['name']]
    raw=np.asarray(Image.open(SOURCE/f"{spec['name']}_original.png").convert('RGBA'))
    rgb=raw[...,:3].astype(float)
    # Only the olive/brown stalks are sampled from generated albedo. Neutral
    # fruit is reconstructed below, removing baked detail from its material.
    stem=(np.minimum(rgb[...,0],rgb[...,1])>rgb[...,2]*1.4)&(raw[...,3]>170)
    labels,_=nd.label(stem);areas=np.bincount(labels.ravel());areas[0]=0
    stem &= areas[labels]>=40
    w,h=spec['rect'][2]-spec['rect'][0],spec['rect'][3]-spec['rect'][1]
    sx,sy=ann['scale_xy'];ax,ay=ann['source_anchor'];anchor=[w//2,6]
    y_projection=np.asarray(ann.get('y_projection',[[ay,anchor[1]],[1280,anchor[1]+(1280-ay)*sy]]),float)
    yy,xx=np.indices((h,w),dtype=float)
    coverage=np.zeros((h,w),float)
    for dy in (-.375,-.125,.125,.375):
        for dx in (-.375,-.125,.125,.375):
            ry=np.interp(yy+dy,y_projection[:,1],y_projection[:,0],left=-100,right=1400)*raw.shape[0]/1280
            rx=((xx+dx-anchor[0])/sx+ax)*raw.shape[1]/1280
            coverage+=nd.map_coordinates(stem.astype(float),[ry,rx],order=0,mode='constant')/16
    a=u8(coverage*255);a[a<24]=0;a[a>231]=255
    a[:anchor[1]]=0
    local=np.zeros((h,w,4),np.uint8);local[...,:3]=[105,110,53];local[...,3]=a
    fruit=[]
    for b in ann['berries']:
        x,y,r=b['circle']
        fruit.append(dict(x=(x-ax)*sx+anchor[0],y=float(np.interp(y,y_projection[:,0],y_projection[:,1])),r=r*ann['radius_scale'],unripe=False,cluster=0,calyx=b.get('calyx',True),depth_mm=b.get('depth_mm',5.2)))
    bottom=max(fruit,key=lambda b:b['y']+b['r'])
    info=dict(source=f"{spec['name']}_original.png",reference_size=[1280,1280],scale_xy=ann['scale_xy'],y_projection=y_projection.tolist(),source_anchor=ann['source_anchor'],anchor=anchor,tip=[round(bottom['x']),round(bottom['y']+bottom['r'])],berries=fruit)
    return local,info


def bunch_materials(local,info):
    mask=local[...,3]>0
    z=np.where(mask,2.6+.65*np.minimum(nd.distance_transform_edt(mask),1.2),0).astype(np.float32)
    mat=np.empty((*mask.shape,3),np.uint8);mat[:]=[255,230,0];mat[mask]=[225,169,0]
    return z,mat,info['berries']


def broad_source_canvas(spec, rgb, mask, crop, anchor, tip):
    """Pack the generated broad branch; gently shear the foot to cell centre.

    Foliage remains an image-generated botanical cutout. This deterministic
    atlas projection changes its aspect by only a few percent, keeping leaf
    shapes and dense overlapping branch structure intact.
    """
    name=spec['name'];w=spec['rect'][2]-spec['rect'][0];h=spec['rect'][3]-spec['rect'][1]
    target_w=spec.get('content_width',416);target_h=spec.get('content_height',440)
    sx=target_w/rgb.shape[1];sy=target_h/rgb.shape[0]
    ox=(w-target_w)/2;oy=h-34-target_h
    shift=w/2-(anchor[0]*sx+ox)
    yy,xx=np.indices((h,w),dtype=float)
    ry=(yy-oy)/sy
    rx=(xx-ox-shift*np.clip(ry/max(anchor[1],1),0,1)**2)/sx
    # RGB is already extended into alpha-zero pixels before interpolation.
    colour=np.stack([nd.map_coordinates(rgb[...,k],[ry,rx],order=1,mode='nearest') for k in range(3)],-1)
    # Supersampled binary coverage confines antialiasing to a one-pixel edge.
    coverage=np.zeros((h,w),float)
    for dy in (-.375,-.125,.125,.375):
        for dx in (-.375,-.125,.125,.375):
            qy=(yy+dy-oy)/sy
            qx=(xx+dx-ox-shift*np.clip(qy/max(anchor[1],1),0,1)**2)/sx
            coverage+=nd.map_coordinates(mask.astype(float),[qy,qx],order=0,mode='constant')/16
    a=u8(coverage*255);a[a<24]=0;a[a>231]=255
    # Subpixel pinholes can otherwise remain translucent well inside a blade.
    # All fractional coverage belongs to the one/two-pixel silhouette edge.
    interior=nd.distance_transform_edt(a>0)>1.5
    a[interior]=255
    labels,_=nd.label(a>0,np.ones((3,3)));areas=np.bincount(labels.ravel());areas[0]=0
    a[(areas[labels]<8)]=0
    rgba=np.dstack([u8(colour),a])
    at=[w//2,round(anchor[1]*sy+oy)]
    ys,xs=np.where(a>100);i=np.argmin((xs-at[0])**2+(ys-at[1])**2);at=[int(xs[i]),int(ys[i])]
    ti=[round(tip[0]*sx+ox+shift*(tip[1]/max(anchor[1],1))**2),round(tip[1]*sy+oy)]
    return rgba,dict(crop=crop,scale_xy=[sx,sy],foot_shear_px=shift,offset=[ox,oy],anchor=at,tip=ti)


def relief(rgba, name, materials, clusters=()):
    rgb = rgba[..., :3].astype(np.float32)
    mask = rgba[..., 3] > 0
    g = (rgb[...,1] > rgb[...,0]*1.08) & (rgb[...,1] > rgb[...,2]*1.09)
    # Senescent broad blades remain leaves, not wood.
    blade = nd.distance_transform_edt(mask) > 3.0
    leaf = mask & (g | nd.binary_dilation(blade, iterations=2))
    wood = mask & ~leaf
    d = nd.distance_transform_edt(leaf)
    # Width-based dome, with source vein detail overlaid as sub-mm relief.
    dome = np.sqrt(np.clip(1-np.exp(-d/8.0), 0, 1))
    luminance = rgb[...,0]*.2126 + rgb[...,1]*.7152 + rgb[...,2]*.0722
    vein = np.maximum(0, luminance-nd.gaussian_filter(luminance, 1.3)) / 35.0
    grain = np.clip((luminance-nd.gaussian_filter(luminance, 2.0))/55, -.3,.3)
    z = np.where(leaf, 1.4+3.4*dome+.40*vein, .65+np.minimum(nd.distance_transform_edt(mask), 3.5)*.62+.20*grain)
    if name.startswith('leaf'):
        z = np.where(leaf, .65+2.35*dome+.30*vein, .5+np.minimum(d,2)*.3)
    if name == 'fallen1':
        z += leaf * (.7 + .45*np.sin(np.indices(mask.shape)[0]/10))
    contact = np.zeros(mask.shape, dtype=float)
    if name.startswith(('spray','inner')):
        # Follow colour boundaries inside the dense crown, rather than doming
        # the entire connected silhouette as one giant blade. Watershed regions
        # are an image-derived leaf approximation, not measured geometry.
        z,contact = layered_leaf_relief(luminance,leaf,mask,z,vein)
        # Transfer local contact darkening out of the base and into AO while
        # retaining natural leaf-to-leaf pigment variation and fine veins.
        gain=1/np.maximum(1-contact*.50,.8)
        rgba[leaf,:3]=u8(rgb[leaf]*gain[leaf,None])
    z[~mask] = 0
    stem_proximity = nd.gaussian_filter(wood.astype(float), 3)
    # Broad exposed blades stay white in AO. A leaf's own filled silhouette is
    # not an occluder; only contact with stems and small junctions is darkened.
    ao = np.clip(1.0-.50*stem_proximity-.70*contact, .60, 1.0)
    rough = np.where(leaf, .60+.045*np.clip(grain,-1,1), .88)
    if name.startswith('inner'):
        rough[leaf] = .64
    elif name == 'fallen1' or name in ('leaf2','leaf3'):
        rough[leaf] = .68
    if name.startswith(('spray', 'inner', 'leaf')):
        settings = materials['roughness']
        face = settings['inner_leaf_face'] if name.startswith('inner') else settings['leaf_face']
        rough[leaf] = face + settings['leaf_grain_strength'] * grain[leaf]
    if name.startswith(('spray', 'inner')):
        ao = canopy_occlusion(mask, contact, stem_proximity, clusters, materials['occlusion'])
    orm = np.stack([u8(ao*255), u8(rough*255), np.zeros(mask.shape,np.uint8)],-1)
    if name.startswith(('spray', 'inner', 'leaf')):
        # Quantized bounds stay wholly inside the leaf-face range .88-.94.
        orm[leaf,1] = np.clip(orm[leaf,1],225,239)
    orm[~mask] = [255,230,0]
    return z.astype(np.float32), orm, leaf


def canopy_occlusion(mask, contact, stem_proximity, clusters, settings):
    """Sky visibility from crown depth, lower forks and local leaf contacts.

    Close small gaps only for the broad crown envelope, never for alpha. The
    exposed perimeter keeps full sky visibility, while gaps between interior
    leaves still belong to the shaded crown. This field is shared by twins;
    bunch attachment pockets remain shaded around their retained stalks.
    """
    yy, xx = np.indices(mask.shape)
    ys, _ = np.where(mask)
    depth = np.clip((yy - ys.min()) / max(ys.max() - ys.min(), 1), 0, 1)
    envelope = nd.binary_fill_holes(nd.binary_closing(mask, iterations=12))
    inward = np.clip((nd.distance_transform_edt(envelope) - 8) / 65, 0, 1)
    inward = inward * inward * (3 - 2 * inward)
    density = np.clip((nd.gaussian_filter(mask.astype(float), 16) - .32) / .48, 0, 1)
    shelter = inward * (.45 + .55 * density)
    # Shade the central stem foot without darkening exposed outer leaf tips.
    foot_axis = np.exp(-.5 * ((xx - np.median(np.where(mask[ys.max()-3:])[1])) / 35)**2)
    foot = depth**1.5 * np.maximum(shelter, foot_axis)
    pockets = np.zeros(mask.shape)
    for cluster in clusters:
        cx, cy = cluster['centre']; ax, ay = cluster['attach']
        sx = cluster.get('spread', 56) * .60
        pocket = np.exp(-.5 * (((xx - (.35*cx + .65*ax)) / sx)**2
                              + ((yy - (.25*cy + .75*ay)) / (sx*.72))**2))
        pockets = np.maximum(pockets, pocket)
    # Existing source contacts identify overlap creases without changing the
    # source colour correction, leaf relief or the derived normal map.
    overlap = nd.gaussian_filter(contact, .8)
    occluded = (settings['crown_depth_strength'] * shelter
                + settings['foot_strength'] * foot
                + settings['overlap_strength'] * overlap
                + settings['junction_strength'] * stem_proximity
                + settings['bunch_attachment_strength'] * pockets)
    return np.clip(1 - occluded, settings['minimum'], 1)


def layered_leaf_relief(luminance, leaf, mask, z, vein):
    gradient=nd.gaussian_gradient_magnitude(luminance,1)
    interior=nd.distance_transform_edt((gradient<2.0)&leaf)
    cc,n=nd.label((interior==nd.maximum_filter(interior,15))&(interior>4))
    candidates=nd.maximum_position(interior,cc,range(1,n+1))
    candidates=sorted(candidates,key=lambda p:interior[p],reverse=True)
    seeds=[]
    for p in candidates:
        if all(np.linalg.norm(np.array(p)-q)>26 for q in seeds):
            seeds.append(p)
    markers=np.zeros(mask.shape,np.int32)
    for i,p in enumerate(seeds):markers[p]=i+1
    markers[~mask]=-1
    cost=u8(gradient*26);cost[~leaf]=255
    segments=nd.watershed_ift(cost,markers);segments[~leaf]=0
    for i,box in enumerate(nd.find_objects(np.maximum(segments,0)),1):
        if box is None:continue
        # Pad each region so its distance really reaches a zero-valued edge.
        region=segments[box]==i
        d=nd.distance_transform_edt(np.pad(region,1))[1:-1,1:-1]
        dome=np.sqrt(np.clip(1-np.exp(-d/6),0,1))
        level=np.clip((np.mean(luminance[box][region])-42)/24,0,2)
        local=1.8+level+1.65*dome+.35*vein[box]
        z[box][region]=local[region]
    smooth=nd.gaussian_filter(luminance,7)
    reference=.7*smooth+.3*nd.maximum_filter(smooth,13)
    contact=np.clip(1-luminance/np.maximum(reference,1),0,.36)*leaf
    z[~mask]=0
    return z,contact


def edge_bleed(rgba, radius=40):
    """Fill each cell with its own mean; extend visible RGB at least 32px."""
    result = rgba.copy()
    mask = rgba[...,3]>0
    distance, ix = nd.distance_transform_edt(~mask, return_indices=True)
    colour = rgba[...,:3]
    mean = np.average(colour[mask],axis=0,weights=rgba[...,3][mask])
    result[~mask,:3] = u8(mean)
    bleed = ~mask & (distance <= radius)
    result[bleed,:3] = colour[ix[0][bleed],ix[1][bleed]]
    return result


def normal_from_height(height16, bark=False):
    z = height16.astype(np.float64) / 65535 * HEIGHT_MM
    if bark:
        # Bark covers 600mm vertically. Horizontal scale stays at 1300px/m:
        # 96px wraps a 73.846mm circumference, a nominal 23.5mm stem diameter.
        spacing = 600/2048
        # End rows are paired at the exact seam; neighbours wrap over them.
        dy = (np.roll(z,-1,axis=0)-np.roll(z,1,axis=0))/(2*spacing)
        dy[0] = dy[-1] = (z[1]-z[-2])/(2*spacing)
        dx = np.gradient(z, MM_PER_PIXEL, axis=1)
    else:
        dy, dx = np.gradient(z, MM_PER_PIXEL)
    # Image y grows down; tangent-space +Y points toward the top of the image.
    n = np.stack([-dx,dy,np.ones_like(z)],-1)
    n /= np.linalg.norm(n,axis=-1,keepdims=True)
    return u8((n*.5+.5)*255)


def darken_ripe_base(rgba, regions, berry_ids, settings):
    """Establish the neutral berry base and its existing colour extension.

    Scaling the existing flat body/calyx colours preserves the scar without
    baking light into the fruit. Work after padding so unrelated transparent
    RGB, including the cell's far-background mean, remains exactly unchanged.
    """
    offsets = np.asarray(settings['berry_offsets'])
    grey = settings['ripe_grey'] + offsets[(berry_ids[regions]-1) % len(offsets)]
    rgba[regions,:3] = u8(rgba[regions,:3] * (grey / settings['reference_grey'])[:,None])
    distance, nearest = nd.distance_transform_edt(rgba[...,3]==0, return_indices=True)
    bleed = (rgba[...,3]==0) & (distance<=40) & regions[nearest[0],nearest[1]]
    rgba[bleed,:3] = rgba[nearest[0][bleed],nearest[1][bleed],:3]


def shade_ripe_berries(rgba, regions, orm, berry_ids, fruit, settings, materials):
    """Paint bloom on visible ripe bodies; keep scars and padding untouched.

    A three-texel glint sits inside the sphere silhouette but outside region 0.
    Owner IDs resolve overlaps before painting, so rear fruit cannot mark a
    foreground berry or a stalk. Geometry and spherical relief are unchanged.
    """
    yy,xx=np.indices(berry_ids.shape)
    bloom=settings['bloom']
    for i,p in enumerate(fruit):
        if p['unripe']:
            continue
        owner=berry_ids==i+1
        u=(xx-p['x'])/p['r'];v=(yy-p['y'])/p['r']
        scar=(np.hypot(xx-(p['x']+p['r']*.21),yy-(p['y']+p['r']*.28))
              <max(.75,p['r']*.17)) & p.get('calyx',True)
        body=owner & ~scar
        grey=bloom['body_grey']+settings['berry_offsets'][i%len(settings['berry_offsets'])]
        upper=np.exp(-.5*(((u+.18)/.58)**2+((v+.46)/.24)**2))
        # A broad cap survives minification. Its soft lower boundary spans the
        # upper 48% of the diameter; retain the existing shoulder/body below it.
        cap_end=-1+2*bloom['cap_height_fraction']
        cap=np.clip((cap_end-v)/(cap_end-bloom['cap_fade_start_v']),0,1)
        cap=cap*cap*(3-2*cap)
        cap*=np.exp(-.5*((u+.18)/bloom['cap_width_radii'])**2)
        upper=np.maximum(bloom['strength']*upper,bloom['cap_strength']*cap)
        lower=np.clip((v-.12)/.78,0,1)
        lower=lower*lower*(3-2*lower)
        shade=grey+upper-bloom['lower_edge_depth']*lower
        rgba[body,:3]=u8(shade[body])[:,None]
        if not p.get('calyx',True):
            continue
        x=round(p['x']-.28*p['r']);y=round(p['y']-.34*p['r'])
        points=[(y,x),(y,x+1),(y+1,x)]
        if not all(body[q] and rgba[q][3]==255 for q in points):
            raise ValueError(f'Berry {i+1}: catchlight is occluded or outside its opaque body')
        for q,value in zip(points,settings['catchlight_greys']):
            rgba[q[0],q[1],:3]=value
            regions[q]=False
            orm[q[0],q[1],1]=round(materials['roughness']['berry_catchlight']*255)


def initial_specs():
    specs=[]
    for i in range(6):
        y=(i//2)*508;x=(i%2)*976
        for j,suffix in enumerate(('','_bare')):
            specs.append(dict(name=f'spray{i+1}{suffix}',rect=[x+j*488,y,x+(j+1)*488,y+508],metres=.34,content_width=[416,410,414,414,412,414][i],content_height=[440,435,436,438,440,440][i]))
    for i in range(2):
        specs.append(dict(name=f'inner{i+1}',rect=[i*488,1524,(i+1)*488,2048],metres=.35,content_width=416,content_height=456))
    for i,m in enumerate([.09,.105,.075]):
        specs.append(dict(name=f'bunch{i+1}',rect=[976,1524+i*174,1170,2048 if i==2 else 1524+(i+1)*174],metres=m))
    x=1170
    for n,w,m in [('fallen1',263,.34),('stripped1',173,.29),('stripped2',194,.32)]:
        specs.append(dict(name=n,rect=[x,1524,x+w,2048],metres=m));x+=w
    for i,m in enumerate([.082,.083,.080]):
        specs.append(dict(name=f'leaf{i+1}',rect=[1800,1524+i*174,1952,1524+(i+1)*174],metres=m))
    return specs


def prepare():
    specs=initial_specs()
    previews=SOURCE/'prepared'
    previews.mkdir(exist_ok=True)
    meta={}
    for spec in specs:
        if spec['name'].endswith('_bare'):
            continue
        rgba, info = make_source_canvas(spec)
        Image.fromarray(rgba).save(previews/f"{spec['name']}.png")
        meta[spec['name']]=info
    write_json(SOURCE/'geometry.json',meta)
    write_json(SOURCE/'packing.json',specs)
    return specs


def cluster_points(config, seed):
    rng = np.random.default_rng(seed)
    cx, cy = config['centre']
    n = config['count']
    radius = config.get('spread', 56)
    points=[]
    for i in range(n):
        # First eight define the rounded outer bunch, then fill its interior.
        for attempt in range(1500):
            angle = (i*2*np.pi/8+rng.uniform(-.09,.09)) if i<8 else rng.uniform(0,2*np.pi)
            radial = radius*rng.uniform(.96,1) if i<8 else radius*np.sqrt(rng.uniform(.02,.82))
            x = cx+np.cos(angle)*radial
            y = cy+np.sin(angle)*radial*.96
            r = rng.uniform(7.3,9.0)
            if all(np.hypot(x-p[0],y-p[1]) > (r+p[2])*.90 for p in points):
                break
        points.append([float(x),float(y),float(r)])
    return sorted(points, key=lambda p:p[1])


def draw_stalks(rgba, height, orm, clusters, seed, stalk_mask=None):
    h,w=rgba.shape[:2]
    layer=Image.new('L',(w*4,h*4))
    draw=ImageDraw.Draw(layer)
    fruit=[]
    for ci,c in enumerate(clusters):
        pts=cluster_points(c,seed+ci*47)
        origin=np.array(c['attach'],float)
        crown=np.array(c['centre'],float)+[0,-20]
        def curve(p0,p1,p2,width=1.2):
            ts=np.linspace(0,1,28)
            path=[tuple((4*((1-t)**2*p0+2*t*(1-t)*p1+t*t*p2)).round().astype(int)) for t in ts]
            draw.line(path,fill=255,width=round(width*4),joint='curve')
        curve(origin,(origin+crown)/2+[-2,-4],crown,1.6)
        for bi,p in enumerate(pts):
            x,y,r=p
            t=.25+.65*bi/max(len(pts)-1,1)
            start=origin*(1-t)+crown*t
            end=np.array([x,y])
            curve(start,(start+end)/2+[0,-8],end,1.05)
            fruit.append(dict(x=x,y=y,r=r,unripe=bi<c.get('unripe',0),cluster=ci))
    a=np.asarray(layer.resize((w,h),Image.Resampling.LANCZOS)).copy()
    a[a<24]=0; a[a>230]=255
    mask=a>0
    if stalk_mask is not None:stalk_mask |= mask
    weight=a.astype(float)/255
    # Thin cylindrical stalks are common to full and harvested sprays.
    alpha0=rgba[...,3]/255
    alpha1=weight+alpha0*(1-weight)
    colour=np.array([105,110,53],float)
    composited=(colour*weight[...,None]+rgba[...,:3]*alpha0[...,None]*(1-weight[...,None]))/np.maximum(alpha1[...,None],1e-6)
    rgba[mask,:3]=u8(composited[mask]);rgba[...,3]=u8(alpha1*255)
    height[mask]=2.6+.65*np.clip(nd.distance_transform_edt(mask)[mask],0,1.2)
    orm[mask,0]=np.minimum(orm[mask,0],225)
    orm[mask,1:]=[169,0]
    # Tiny fibrous, snapped attachment ends survive after every berry is gone.
    yy,xx=np.indices((h,w))
    for p in fruit:
        m=(xx-p['x'])**2+(yy-p['y'])**2<.9**2
        if stalk_mask is not None:stalk_mask |= m
        rgba[m]=[147,119,76,255]
        height[m]=3.5
        orm[m,0]=np.minimum(orm[m,0],231);orm[m,1:]=[205,0]
    return fruit


def apply_damage(rgba, height, orm, polygons, leaf):
    cut=Image.new('L',(rgba.shape[1]*4,rgba.shape[0]*4))
    dr=ImageDraw.Draw(cut)
    for polygon in polygons:
        dr.polygon([(round(x*4),round(y*4)) for x,y in polygon],fill=255)
    removal=np.asarray(cut.resize((rgba.shape[1],rgba.shape[0]),Image.Resampling.LANCZOS))/255
    removal *= leaf
    a=u8(rgba[...,3]*(1-removal))
    a[a<18]=0;a[a>237]=255
    # A leaf severed at its petiole is removed, rather than left floating.
    labels,count=nd.label(a>0,np.ones((3,3)))
    areas=np.bincount(labels.ravel())
    if count:
        main=np.argmax(areas[1:])+1
        a[(labels!=main)&(labels>0)]=0
    damage=(a!=rgba[...,3])
    tornrim=nd.binary_dilation(damage)&~damage&(a>0)
    rgba[tornrim,:3]=u8(rgba[tornrim,:3]*.65+np.array([105,92,42])*.35)
    rgba[...,3]=a
    height[a==0]=0;orm[a==0]=[255,230,0]
    return damage|tornrim


def add_berries(rgba, height, orm, fruit, materials):
    h,w=rgba.shape[:2]
    yy,xx=np.indices((h,w))
    regions=np.zeros((h,w),bool)
    unripe=np.zeros((h,w),bool)
    berry_id=np.zeros((h,w),np.uint16)
    for i,p in enumerate(fruit):
        x,y,r=p['x'],p['y'],p['r']
        dist=np.hypot(xx-x,yy-y)
        coverage=np.clip(r+.48-dist,0,1)
        coverage[coverage<.08]=0;coverage[coverage>.92]=1
        m=coverage>0
        colour=np.full((h,w,3),200.0,dtype=np.float32)
        if p['unripe']:
            colour[:]=[118+(i%3)*8,139+(i%2)*6,57]
        # A tiny neutral calyx scar is albedo, not directional illumination.
        calyx=(np.hypot(xx-(x+r*.21),yy-(y+r*.28))<max(.75,r*.17)) & p.get('calyx',True)
        colour[calyx]*=.85
        a0=rgba[...,3]/255
        a1=coverage+a0*(1-coverage)
        # The hard region mask owns these pixels. Keep neutral berry RGB even
        # on its AA boundary, so no green foliage enters the dye calculation.
        rgba[m,:3]=u8(colour[m]);rgba[m,3]=u8(a1[m]*255)
        z=p.get('depth_mm',5.2+(i%4)*.21)+np.sqrt(np.maximum(r*r-dist*dist,0))*MM_PER_PIXEL
        # AA fringe follows the same sphere; source RGB stays flat grey.
        height[m]=z[m]
        orm[m,0]=255
        roughness = materials['roughness']
        face = roughness['unripe_berry_face'] if p['unripe'] else roughness['berry_face']
        rough = face + roughness['berry_edge_strength'] * np.clip(dist/r, 0, 1)**2
        # Keep the quantized value inside the requested 0.62–0.70 range.
        orm[m,1]=np.clip(u8(rough[m]*255),159,178)
        orm[m,2]=0
        regions[m]=not p['unripe'];unripe[m]=p['unripe'];berry_id[m]=i+1
    # Ambient occlusion from contact concavity, confined to berry bodies.
    smooth=nd.gaussian_filter(height,1.1)
    concavity=np.clip(smooth-height,0,3)/3
    m=berry_id>0
    settings = materials['occlusion']
    neighbours = np.clip((nd.gaussian_filter(m.astype(float), 7)-.30)/.45, 0, 1)
    ao = np.clip(1 - settings['berry_neighbour_strength']*neighbours
                 - settings['berry_contact_strength']*concavity,
                 settings['minimum'], 1)
    orm[m,0]=u8(ao[m]*255)
    return regions,unripe,berry_id


def make_bark():
    original=Image.open(SOURCE/'bark_original.png').convert('RGB')
    # A narrow scan crop preserves lenticel proportions instead of squeezing
    # a square photograph into the 96-pixel material strip.
    crop=original.crop((400,0,496,1536)).resize((96,2048),Image.Resampling.LANCZOS)
    rgb=np.asarray(crop).astype(float)
    # Periodic seam blend only near the two endpoints, then equal endpoint rows.
    span=112
    centre=(rgb[0]+rgb[-1])/2
    for k in range(span):
        t=(k/(span-1))**2*(3-2*k/(span-1))
        rgb[k]=centre*(1-t)+rgb[k]*t
        rgb[-1-k]=centre*(1-t)+rgb[-1-k]*t
    lum=rgb[...,0]*.2126+rgb[...,1]*.7152+rgb[...,2]*.0722
    high=lum-nd.gaussian_filter(lum,(7,2),mode='wrap')
    height=3.0+.018*high+.003*(lum-lum.mean())
    height[0]=height[-1]=(height[0]+height[-1])/2
    orm=np.zeros((2048,96,3),np.uint8)
    orm[...,0]=u8(246+np.clip(high,-30,0)*.40)
    orm[...,1]=u8(226+np.clip(high,-20,20)*.15)
    rgba=np.dstack([u8(rgb),np.full((2048,96),255,np.uint8)])
    return rgba,height,orm


def build():
    specs=prepare()
    annotations=json.loads((SOURCE/'annotations.json').read_text())
    materials=json.loads((SOURCE/'packed_materials.json').read_text())
    berry_base=json.loads((SOURCE/'berry_base.json').read_text())
    geometry=json.loads((SOURCE/'geometry.json').read_text())
    rgba=np.zeros((SIZE,SIZE,4),np.uint8);rgba[...,:3]=[57,78,43]
    height=np.zeros((SIZE,SIZE),np.float32)
    orm=np.zeros((SIZE,SIZE,3),np.uint8);orm[:]=[255,230,0]
    regions=np.zeros((SIZE,SIZE,3),np.uint8)
    manifest=[];elements=[]
    exports=SOURCE/'elements';exports.mkdir(exist_ok=True)
    specs_by_name={s['name']:s for s in specs}
    def place(name,local,z,mat,reg,info,berry_ids=None,fruit=()):
        s=specs_by_name[name]
        x0,y0,x1,y1=s['rect']
        local=edge_bleed(local)
        if berry_ids is not None:
            darken_ripe_base(local,reg,berry_ids,berry_base)
            shade_ripe_berries(local,reg,mat,berry_ids,fruit,berry_base,materials)
        rgba[y0:y1,x0:x1]=local;height[y0:y1,x0:x1]=z;orm[y0:y1,x0:x1]=mat
        regions[y0:y1,x0:x1,0]=reg.astype(np.uint8)*255
        Image.fromarray(local).save(exports/f'{name}.png')
        a=np.array(info['anchor'])
        coords=np.column_stack(np.where(local[...,3]>0))[:,::-1]
        ti=coords[np.argmax(np.linalg.norm(coords-a,axis=1))]
        if name.startswith('bunch'):
            bottom=coords[coords[:,1]==coords[:,1].max()]
            ti=bottom[np.argmin(np.abs(bottom[:,0]-info['tip'][0]))]
        # The same growth tip is used for each matched pair, even where its
        # upper fruit disappears. This keeps card-space registration stable.
        if name.endswith('_bare') and 'growth_tip' in info:
            ti=np.array(info['growth_tip'])
        elif name.startswith('spray'):
            info['growth_tip']=ti.tolist()
        length=np.linalg.norm(ti-a)/SCALE
        e=dict(name=name,rect=s['rect'],anchor=(a+[x0,y0]).tolist(),tip=(ti+[x0,y0]).tolist(),metres=round(float(length),6))
        if name.startswith('spray') and not name.endswith('_bare'):
            e['twin']=name+'_bare'
        elements.append(e)
    for s in specs:
        name=s['name']
        if name.endswith('_bare'):continue
        local=np.asarray(Image.open(SOURCE/'prepared'/f'{name}.png')).copy()
        if name.startswith('bunch'):
            z,mat,fruit=bunch_materials(local,geometry[name])
            stalk_mask=local[...,3]>0
            reg,green,ids=add_berries(local,z,mat,fruit,materials)
            # Overlapping antialiased spheres/stalks form an opaque interior;
            # retain fractional coverage only at the composite silhouette.
            local[nd.distance_transform_edt(local[...,3]>0)>1.5,3]=255
            Image.fromarray(ids).save(exports/f'{name}_berry_ids.png')
            Image.fromarray(stalk_mask.astype(np.uint8)*255).save(exports/f'{name}_stalk_mask.png')
            place(name,local,z,mat,reg,geometry[name],ids,fruit)
            manifest.append(dict(name=name,berries=fruit,clusters=[dict(count=len(fruit),attach=geometry[name]['anchor'])]))
            continue
        z,mat,leaf=relief(local,name,materials,annotations.get(name,{}).get('clusters',()))
        if geometry[name].get('preserved'):
            ox,oy=geometry[name]['offset']
            oldz=np.asarray(Image.open(SOURCE/'preserved'/f'{name}_height.png'))
            oldmat=np.asarray(Image.open(SOURCE/'preserved'/f'{name}_orm.png'))
            z[:]=0;mat[:]=[255,230,0]
            hh,ww=oldz.shape
            z[oy:oy+hh,ox:ox+ww]=oldz.astype(np.float32)/65535*HEIGHT_MM
            mat[oy:oy+hh,ox:ox+ww]=oldmat
            # The retained cutouts also carry leaf faces. Update only their
            # green channel; their frozen AO and every wood pixel stay intact.
            face=materials['roughness']['leaf_face']
            prior=mat[...,1].astype(float)/255
            variation=np.clip(prior-np.median(prior[leaf]),-.02,.02)
            mat[leaf,1]=np.clip(u8((face+variation[leaf])*255),225,239)
        reg=np.zeros(z.shape,bool)
        if name.startswith('spray'):
            ann=annotations[name]
            bare,bz,bmat=local.copy(),z.copy(),mat.copy()
            damage=apply_damage(bare,bz,bmat,ann.get('tears',[]),leaf)
            stalk_mask=np.zeros(z.shape,bool)
            fruit=draw_stalks(local,z,mat,ann['clusters'],1200+int(name[-1])*113,stalk_mask)
            draw_stalks(bare,bz,bmat,ann['clusters'],1200+int(name[-1])*113)
            damage |= np.any(local!=bare,axis=-1)
            reg,green,ids=add_berries(local,z,mat,fruit,materials)
            Image.fromarray(damage.astype(np.uint8)*255).save(exports/f'{name}_damage.png')
            Image.fromarray(green.astype(np.uint8)*255).save(exports/f'{name}_unripe.png')
            Image.fromarray(ids).save(exports/f'{name}_berry_ids.png')
            Image.fromarray(stalk_mask.astype(np.uint8)*255).save(exports/f'{name}_stalk_mask.png')
            Image.fromarray((leaf&~stalk_mask&(ids==0)).astype(np.uint8)*255).save(exports/f'{name}_leaf_mask.png')
            Image.fromarray((leaf&~stalk_mask&~damage).astype(np.uint8)*255).save(exports/f'{name}_bare_leaf_mask.png')
            place(name,local,z,mat,reg,geometry[name],ids,fruit)
            place(name+'_bare',bare,bz,bmat,np.zeros(z.shape,bool),geometry[name])
            manifest.append(dict(name=name,berries=fruit,clusters=ann['clusters']))
        else:
            Image.fromarray(leaf.astype(np.uint8)*255).save(exports/f'{name}_leaf_mask.png')
            place(name,local,z,mat,reg,geometry[name])
    bark,bz,bmat=make_bark()
    rgba[:,1952:]=bark;height[:,1952:]=bz;orm[:,1952:]=bmat
    elements.append(dict(name='bark',role='bark',rect=[1952,0,2048,2048],metres=.6))
    height16=np.clip(np.rint(height/HEIGHT_MM*65535),0,65535).astype(np.uint16)
    normal=normal_from_height(height16)
    normal[:,1952:]=normal_from_height(height16[:,1952:],bark=True)
    Image.fromarray(rgba).save(ROOT/'bush_base.png')
    Image.fromarray(height16).save(ROOT/'bush_height.png')
    Image.fromarray(normal).save(ROOT/'bush_normal.png')
    Image.fromarray(orm).save(ROOT/'bush_orm.png')
    Image.fromarray(regions).save(ROOT/'bush_regions.png')
    write_json(ROOT/'layout.json',dict(scale_px_per_m=SCALE,elements=elements))
    write_json(SOURCE/'berries.json',manifest)
    write_json(SOURCE/'build_metadata.json',dict(height_range_mm=HEIGHT_MM,normal_convention='OpenGL +Y up',bark_mm_per_pixel_xy=[MM_PER_PIXEL,600/2048],edge_bleed_px=40,dependencies=['Pillow','numpy','scipy'],originals={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(SOURCE.glob('*_original.png'))}))
    print(f'Built {len(elements)} elements, five {SIZE}x{SIZE} maps.')


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--prepare',action='store_true')
    args=parser.parse_args()
    prepare() if args.prepare else build()
