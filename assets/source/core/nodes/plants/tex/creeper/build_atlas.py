#!/usr/bin/env python3
"""Build creeper's four aligned layers from frozen generated originals.

Run: python3 build_atlas.py. Requires Python 3, Pillow, numpy and scipy.
No generation, network, external assets, or writes outside this directory.
"""
from pathlib import Path
import hashlib
import json
import numpy as np
from PIL import Image, ImageDraw, PngImagePlugin
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'source'
SPEC = json.loads((SOURCE / 'build_spec.json').read_text())
SIZE = SPEC['size']
SCALE = SPEC['scale_px_per_m']
RANGE_MM = SPEC['height_range_mm']
MAT_Y = SPEC['mat_start_y']
LANCZOS = Image.Resampling.LANCZOS


def save_png(a, path, srgb=False):
    info = PngImagePlugin.PngInfo()
    if srgb:
        info.add(b'sRGB', b'\x00')
    Image.fromarray(a).save(path, pnginfo=info)


def extend(rgb, valid):
    indices = ndi.distance_transform_edt(~valid, return_distances=False,
                                        return_indices=True)
    return rgb[indices[0], indices[1]]


def resize_float(a, size):
    if a.ndim == 3:
        return np.stack([resize_float(a[:, :, k], size) for k in range(a.shape[2])], axis=2)
    return np.asarray(Image.fromarray(a.astype(np.float32)).resize(size, LANCZOS))


def connected(mask):
    labels, _ = ndi.label(mask, np.ones((3, 3)))
    areas = np.bincount(labels.ravel())
    areas[0] = 0
    return labels == areas.argmax()


def clean_source(e):
    name = e.get('source', e['name'] + '_original.png')
    raw = np.asarray(Image.open(SOURCE / name).convert('RGBA'))
    mask = raw[:, :, 3] >= 128
    # Remove detached generative alpha dust; fill only subpixel-sized holes.
    holes = ndi.binary_fill_holes(mask) & ~mask
    lab, _ = ndi.label(holes)
    sizes = np.bincount(lab.ravel())
    small = sizes < 20
    small[0] = False
    mask = connected(mask | small[lab])
    yy, xx = np.where(mask)
    box = [int(xx.min()), int(yy.min()), int(xx.max()+1), int(yy.max()+1)]
    x0, y0, x1, y1 = box
    rgb = raw[y0:y1, x0:x1, :3].astype(float)
    alpha = raw[y0:y1, x0:x1, 3]
    mask = mask[y0:y1, x0:x1]
    # Preserve thin stems while refusing contaminated RGB at translucent edges.
    trust = (alpha >= 253) & mask
    rgb = extend(rgb, trust)
    seeds = [[(x*raw.shape[1]-x0)/(x1-x0), (y*raw.shape[0]-y0)/(y1-y0)]
             for x, y in e['leaves']]
    return rgb, mask, seeds, {'source': name, 'source_size': [raw.shape[1], raw.shape[0]],
                             'crop': box, 'source_mask_pixels': int(mask.sum())}


def leaf_labels(rgb, solid, seeds):
    """Seeded distance watershed: necks separate blades, colour edges refine it."""
    distance = ndi.distance_transform_edt(solid)
    lum = np.sum(rgb * np.array([.2126, .7152, .0722]), axis=2) / 255
    smooth = ndi.gaussian_filter(lum, 1.5)
    gradient = np.hypot(*np.gradient(smooth))
    cost = 145*np.exp(-distance/9) + np.clip(gradient*1400, 0, 90)
    cost[~solid] = 255
    markers = np.zeros(solid.shape, np.int32)
    for i, (x, y) in enumerate(seeds, 1):
        cx = int(np.clip(round(x*(solid.shape[1]-1)), 0, solid.shape[1]-1))
        cy = int(np.clip(round(y*(solid.shape[0]-1)), 0, solid.shape[0]-1))
        # Snap the approximate annotated blade centre to a thick blade texel.
        y0, y1 = max(0,cy-9), min(solid.shape[0],cy+10)
        x0, x1 = max(0,cx-9), min(solid.shape[1],cx+10)
        patch = distance[y0:y1, x0:x1]
        py, px = np.unravel_index(np.argmax(patch), patch.shape)
        markers[y0+py,x0+px] = i
    labels = ndi.watershed_ift(np.rint(cost).astype(np.uint8), markers)
    labels[~solid] = 0
    return labels, distance, lum


def make_element(e):
    colour, mask, seeds, rec = clean_source(e)
    # Uniform scaling: preserve each original's aspect ratio and leaf shapes.
    h = round(e['length_m'] * SCALE) + 1
    w = round(mask.shape[1] * h / mask.shape[0])
    rgb = np.clip(resize_float(colour, (w,h)), 0,255)
    a = np.clip(resize_float(mask.astype(float), (w,h)), 0,1)
    a[a < .07] = 0
    a[a > .93] = 1
    solid = a >= .5
    a[solid & (ndi.distance_transform_edt(solid)>1.4)] = 1
    a[~solid & (ndi.distance_transform_edt(~solid)>1.4)] = 0
    # Keep all attached fine stems at the actual atlas resolution.
    a *= connected(a>0)
    solid = a >= .5
    support = a > 0
    rgb = extend(rgb, a==1)
    labels, dist, lum = leaf_labels(rgb, solid, seeds)
    heights = np.zeros((h,w), float)
    leaf_edge = np.zeros((h,w), float)
    # Each blade gets independent doming and a shallow overlap elevation.
    for ident in range(1, len(seeds)+1):
        blade = labels==ident
        if not blade.any():
            continue
        d = ndi.distance_transform_edt(blade)
        dome = 1-np.exp(-d/12)
        elevation = .70 + .22*(ident%4)
        hh = elevation + (2.2+.22*(ident%3))*dome
        heights[blade] = hh[blade]
        leaf_edge[blade] = np.exp(-d[blade]/3.5)
    # The source's fine, bright palmate veins add relief, not broad brightness.
    detail = ndi.gaussian_filter(lum,.45)-ndi.gaussian_filter(lum,2.2)
    vein = np.clip(detail*9, -.16, .35)
    heights += vein
    # A narrow silhouette is a round shoot/petiole, never a flat coloured line.
    thin = ndi.gaussian_filter(dist,2)<3.7
    stem_round = .15+1.65*(1-np.exp(-dist/1.9))
    heights[thin & solid] = stem_round[thin & solid]+vein[thin & solid]*.3
    flower = (rgb[:,:,2] > rgb[:,:,1]*1.03) & (rgb[:,:,2]>95) & solid
    if flower.any():
        fd = ndi.distance_transform_edt(flower)
        # Trumpet rim above a cupped throat, with fine radial petal folds.
        fy,fx = np.where(flower)
        cx,cy = float(fx.mean()),float(fy.mean())
        yy,xx = np.indices((h,w))
        rr = np.hypot(xx-cx,yy-cy)
        radius = np.percentile(rr[flower],90)
        angle = np.arctan2(yy-cy,xx-cx)
        cup = 2.1+4.6*np.clip(rr/radius,0,1)**.8+.20*np.cos(angle*10)
        heights[flower] = cup[flower]
    heights = ndi.gaussian_filter(heights, .45)
    heights = np.maximum(.03,heights)*a
    heights[~support]=0
    # Colour remains albedo. Occlusion lives in ORM and follows intersections.
    concavity = np.clip(ndi.gaussian_filter(heights,3)-heights,0,2)
    crowd = ndi.gaussian_filter(solid.astype(float),7)
    interior_edge = leaf_edge*(dist>3)
    ao = np.clip(1-.19*concavity-.16*interior_edge-.07*crowd,.52,1)
    yellow = np.clip((rgb[:,:,0]-rgb[:,:,1]+13)/40,0,1)
    rough = np.clip(e['roughness']+yellow*.16-detail*.35,.42,.86)
    rough[flower] = .49
    orm = np.stack([ao,rough,np.zeros_like(ao)],axis=2)
    orm[~support]=[1,1,0]
    rgba=np.dstack([np.rint(rgb).astype(np.uint8),np.rint(a*255).astype(np.uint8)])
    y,x=np.where(rgba[:,:,3]>=128)
    def endpoint(row):
        candidates=x[y==row]
        return [int(candidates[len(candidates)//2]),int(row)]
    upper,lower=endpoint(y.min()),endpoint(y.max())
    anchor,tip=(upper,lower) if e.get('hanging') else (lower,upper)
    if 'tip_source' in e:
        # A curled shoot ends inside its spiral, not at its uppermost pixel.
        x0,y0,x1,y1=rec['crop']
        sx,sy=e['tip_source']
        tx=(sx-x0)*w/(x1-x0);ty=(sy-y0)*h/(y1-y0)
        nearest=int(np.argmin((x-tx)**2+(y-ty)**2))
        tip=[int(x[nearest]),int(y[nearest])]
    rec.update({'fitted_size':[w,h],'anchor_local':anchor,'tip_local':tip,
                'annotated_leaf_seeds':len(seeds),'flower_surface_pixels':int(flower.sum())})
    return rgba, heights, np.rint(orm*255).astype(np.uint8), labels, rec


def horizontal_quilt(rgb, width=2048, overlap=160):
    """Minimum-cost seam joins the source's tail to its start, without ghosting."""
    left=rgb[:,:overlap]
    right=rgb[:,width:width+overlap]
    cost=np.mean((left-right)**2,axis=2)
    cost=ndi.gaussian_filter(cost,1.2)
    # Keep the seam away from the wrap edge and the overlap's far end.
    cost[:,:12]+=1e6
    cost[:,-12:]+=1e6
    accum=cost[0].copy()
    parent=np.zeros(cost.shape,np.int16)
    for y in range(1,len(cost)):
        candidates=np.stack([np.r_[np.inf,accum[:-1]],accum,np.r_[accum[1:],np.inf]])
        steps=np.argmin(candidates,axis=0)
        parent[y]=np.arange(overlap)+steps-1
        accum=cost[y]+candidates[steps,np.arange(overlap)]
    seam=np.zeros(len(cost),np.int32)
    seam[-1]=int(np.argmin(accum))
    for y in range(len(cost)-1,0,-1):
        seam[y-1]=parent[y,seam[y]]
    out=rgb[:,:width].copy()
    for y,s in enumerate(seam):
        out[y,:s]=right[y,:s]
        # Only a two-pixel antialias at the selected low-cost leaf boundary.
        out[y,s]=.5*(left[y,s]+right[y,s])
    return out,seam


def exact_wrap(a):
    out=a.copy()
    edge=(a[:,0]+a[:,1]+a[:,-2]+a[:,-1])*.25
    out[:,0]=out[:,1]=out[:,-2]=out[:,-1]=edge
    return out


def make_mat():
    settings=SPEC['mat']
    raw=Image.open(SOURCE/settings['source']).convert('RGB')
    target_w=SIZE+160
    target_h=round(raw.height*target_w/raw.width)
    im=raw.resize((target_w,target_h),LANCZOS)
    y=(target_h-512)//2
    rgb=np.asarray(im.crop((0,y,target_w,y+512))).astype(float)
    rgb,seam=horizontal_quilt(rgb, width=SIZE)
    lum=np.sum(rgb*np.array([.2126,.7152,.0722]),axis=2)/255
    # Calibrate the frozen shade painting to the specified sRGB palette.
    # A single monotone transform keeps its dark gaps and subdued leaf detail.
    floor=np.array(settings['gap_rgb'],float)
    target=np.array(settings['mean_rgb'],float)
    rgb=floor+rgb*(target-floor)/rgb.mean(axis=(0,1))
    # Roll off the few bright stems/veins; nothing inside the vine is sunlit.
    value=np.sum(rgb*np.array([.2126,.7152,.0722]),axis=2)
    ceiling=58+12*(1-np.exp(-np.maximum(value-58,0)/12))
    rgb*=np.minimum(1,ceiling/np.maximum(value,1))[:,:,None]
    # The inner mass has shallow relief; faces and gaps share one depth field
    # across height, AO and roughness, with very restrained fine veins.
    smooth=ndi.gaussian_filter(lum,3,mode='wrap')
    lo,hi=np.percentile(smooth,[3,97])
    relief=np.clip((smooth-lo)/(hi-lo),0,1)
    detail=ndi.gaussian_filter(lum,.6,mode='wrap')-smooth
    height=ndi.gaussian_filter(.25+.9*relief+np.clip(detail,-.025,.025),1,mode='wrap')
    ao=.35+.25*relief
    rough=.82-.03*relief
    orm=np.stack([ao,rough,np.zeros_like(ao)],axis=2)
    rgb=exact_wrap(rgb)
    height=exact_wrap(height)
    orm=exact_wrap(orm)
    rgba=np.dstack([np.rint(rgb).astype(np.uint8),np.full((512,SIZE),255,np.uint8)])
    packed=np.rint(orm*255).astype(np.uint8)
    packed[:,:,0]=np.clip(packed[:,:,0],90,153)  # inward quantization of .35–.60
    return rgba,height,packed,seam


def make_sprites(layout, base):
    """Frozen local card outlines, with UVs and means from the final atlas."""
    geometry=json.loads((SOURCE/'card_geometry.json').read_text())
    sprites={'size':SIZE,'elements':{}}
    rgba=base.astype(np.float32)/255
    for e in layout['elements']:
        name=e['name'];x0,y0,x1,y1=e['rect']
        tile=rgba[y0:y1,x0:x1]
        role=e.get('role','spray')
        out={'name':name,'role':role}
        if role=='spray':
            out.update(geometry[name])
            origin=np.array(e['anchor'],dtype=np.float64)
            along=np.array(e['tip'],dtype=np.float64)-origin
            along/=np.linalg.norm(along)
            right=np.array([-along[1],along[0]])
            length=out['length_px']
            weight=tile[:,:,3:4]
            out['mean']=((tile[:,:,:3]*weight).sum((0,1))/max(float(weight.sum()),1e-6)).tolist()
            out['uv']={'origin':[float(origin[0]/SIZE),float(1-origin[1]/SIZE)],
                       'along':[float(along[0]*length/SIZE),float(-along[1]*length/SIZE)],
                       'right':[float(right[0]*length/SIZE),float(-right[1]*length/SIZE)]}
        elif role=='band':
            out['v']=[1-y1/SIZE,1-y0/SIZE]
            out['mean']=tile[:,:,:3].mean((0,1)).tolist()
        else:
            inset=6
            out['uv']=[(x0+inset)/SIZE,1-(y1-inset)/SIZE,(x1-inset)/SIZE,1-(y0+inset)/SIZE]
            out['mean']=tile[:,:,:3].mean((0,1)).tolist()
        out['metres']=e['metres']
        sprites['elements'][name]=out
    return sprites


def make_rubble():
    """Stone-scale relief from traced geometry, independent of albedo pigment."""
    e = SPEC['rubble']
    x0,y0,x1,y1 = e['rect']
    w,h = x1-x0,y1-y0
    raw = Image.open(SOURCE/e['source']).convert('RGB')
    rgb = np.asarray(raw.resize((w,h),LANCZOS)).astype(float)
    annotations = json.loads((SOURCE/'rubble_relief.json').read_text())
    factor = w/annotations['annotation_size']
    lum = np.sum(rgb*np.array([.2126,.7152,.0722]),axis=2)/255
    smooth = ndi.gaussian_filter(lum,1.6)
    detail = ndi.gaussian_filter(lum,.45)-smooth
    # The sand/mortar bed has shallow granular relief, not tall pigment bumps.
    bed = 1.8+8*np.clip((smooth-.22)/.55,0,1)+np.clip(detail*12,-1.1,1.1)
    height = bed.copy()
    labels = np.zeros((h,w),np.uint16)
    exposure = np.zeros((h,w),float)
    yy,xx = np.indices((h,w))
    for ident,stone in enumerate(annotations['stones'],1):
        mask_image = Image.new('L',(w,h))
        vertices = [(round(x*factor),round(y*factor)) for x,y in stone['polygon']]
        ImageDraw.Draw(mask_image).polygon(vertices,fill=255)
        mask = np.asarray(mask_image)>0
        distance = ndi.distance_transform_edt(np.pad(mask,1,mode='edge'))[1:-1,1:-1]
        bevel = 1-np.exp(-(distance/4.5)**1.4)
        sx,sy = np.array(vertices).T
        tilt = (stone['tilt'][0]*(xx-sx.mean())/max(1,np.ptp(sx))+
                stone['tilt'][1]*(yy-sy.mean())/max(1,np.ptp(sy)))
        face = stone['height_mm']+tilt+np.clip(detail*15,-1.6,1.3)
        relief = bed+(face-bed)*bevel
        higher = mask & (relief>height)
        height[higher] = relief[higher]
        labels[higher] = ident
        exposure = np.maximum(exposure,bevel*mask)
    # Brown runners retain the substrate height and add a rounded raised stem.
    stem_relief = np.zeros((h,w),float)
    for stem in annotations['stems']:
        mask_image = Image.new('L',(w,h))
        points = [(round(x*factor),round(y*factor)) for x,y in stem['points']]
        diameter = max(1,round(stem['width_mm']/1000*w/e['metres']))
        ImageDraw.Draw(mask_image).line(points,fill=255,width=diameter,joint='curve')
        mask = np.asarray(mask_image)>0
        distance = ndi.distance_transform_edt(mask)
        rounded = np.sqrt(np.clip(1-((distance-.5)/max(1,diameter/2)-1)**2,0,1))
        stem_relief = np.maximum(stem_relief,rounded*stem['width_mm']*.65)
    height += ndi.gaussian_filter(stem_relief,.55)
    height = np.clip(ndi.gaussian_filter(height,.55),0,e['height_range_mm'])
    concavity = np.clip((ndi.gaussian_filter(height,5)-height)/18,0,1)
    gap = np.clip((.54-smooth)/.30,0,1)*(1-exposure*.85)
    ao = np.clip(.98-.39*gap-.36*concavity-.08*(1-exposure),.22,1)
    # Raise baked crevice darkness modestly; most gap darkening lives in AO.
    rgb = np.clip(rgb*(1+.22*gap[:,:,None]),0,255)
    lo,hi = e['roughness_range']
    rough = np.clip(.88+.055*(1-exposure)-detail*.12,lo,hi)
    orm = np.rint(np.stack([ao,rough,np.zeros_like(ao)],axis=2)*255).astype(np.uint8)
    rgba = np.dstack([np.rint(rgb).astype(np.uint8),np.full((h,w),255,np.uint8)])
    return rgba,height,orm,labels,{
        'source':e['source'],'source_size':list(raw.size),'fitted_size':[w,h],
        'placement':[x0,y0],'scale_px_per_m':w/e['metres'],
        'height_range_mm':e['height_range_mm'],
        'height_used_mm':[float(height.min()),float(height.max())],
        'annotated_stones':len(annotations['stones']),
        'annotated_stems':len(annotations['stems']),
        'roughness_range_encoded':(np.array([orm[:,:,1].min(),orm[:,:,1].max()])/255).tolist()}


def normals_from_height(height_u16):
    """OpenGL +Y; positive image-y height slope yields positive green."""
    metres=height_u16.astype(np.float64)/65535*(RANGE_MM/1000)
    e=SPEC['rubble'];x0,y0,x1,y1=e['rect']
    # Isolate the patch before derivatives: its relief must never bend a card
    # or the transparent texels immediately outside the patch's boundary.
    patch=height_u16[y0:y1,x0:x1].astype(np.float64)/65535*(e['height_range_mm']/1000)
    metres[y0:y1,x0:x1]=0
    gy,gx=np.gradient(metres[:MAT_Y],1/SCALE,1/SCALE)
    top=np.stack([-gx,gy,np.ones_like(gx)],axis=2)
    band=metres[MAT_Y:]
    spacing=SPEC['mat_metres']/SIZE
    bx=(np.roll(band,-1,axis=1)-np.roll(band,1,axis=1))/(2*spacing)
    by=np.gradient(band,spacing,axis=0)
    bottom=np.stack([-bx,by,np.ones_like(bx)],axis=2)
    vectors=np.concatenate([top,bottom],axis=0)
    py,px=np.gradient(patch,e['metres']/(y1-y0),e['metres']/(x1-x0))
    vectors[y0:y1,x0:x1]=np.stack([-px,py,np.ones_like(px)],axis=2)
    vectors/=np.linalg.norm(vectors,axis=2,keepdims=True)
    return np.rint((vectors+1)*127.5).astype(np.uint8)


def build():
    (SOURCE/'prepared').mkdir(exist_ok=True)
    base=np.zeros((SIZE,SIZE,4),np.uint8)
    base[:,:,:3]=[93,111,43]
    height=np.zeros((SIZE,SIZE),float)
    orm=np.empty((SIZE,SIZE,3),np.uint8);orm[:]=[255,255,0]
    layout={'scale_px_per_m':SCALE,'height_range_mm':RANGE_MM,'elements':[]}
    records={}
    for e in SPEC['elements']:
        rgba,hh,material,labels,rec=make_element(e)
        x0,y0,x1,y1=e['rect']
        h,w=rgba.shape[:2]
        px=x0+(x1-x0-w)//2;py=y0+(y1-y0-h)//2
        margin=min(px-x0,py-y0,x1-px-w,y1-py-h)
        if margin<24:raise ValueError(f"{e['name']} margin {margin} < 24")
        base[py:py+h,px:px+w]=rgba
        height[py:py+h,px:px+w]=hh
        orm[py:py+h,px:px+w]=material
        anchor=[px+rec['anchor_local'][0],py+rec['anchor_local'][1]]
        tip=[px+rec['tip_local'][0],py+rec['tip_local'][1]]
        metres=float(np.linalg.norm(np.array(tip)-anchor)/SCALE)
        layout['elements'].append({'name':e['name'],'rect':e['rect'],
                                  'anchor':anchor,'tip':tip,'metres':round(metres,6)})
        tile=base[y0:y1,x0:x1]
        support=tile[:,:,3]>0
        dist,indices=ndi.distance_transform_edt(~support,return_indices=True)
        rgb=tile[:,:,:3].astype(float)
        edge=rgb[indices[0],indices[1]]
        mean=rgb[tile[:,:,3]>=128].mean(axis=0)
        fade=np.clip((dist-SPEC['edge_bleed_px'])/8,0,1)[:,:,None]
        tile[:,:,:3]=np.rint(edge*(1-fade)+mean*fade).astype(np.uint8)
        rec.update({'placement':[px,py],'margin_min_px':margin,'mean_rgb':mean.tolist(),
                    'physical_width_m':w/SCALE,'physical_length_m':metres})
        records[e['name']]=rec
        save_png(rgba,SOURCE/'prepared'/f"{e['name']}.png",srgb=True)
        save_png(labels.astype(np.uint16),SOURCE/'prepared'/f"{e['name']}_leaf_ids.png")
    rgba,hh,material,seam=make_mat()
    base[MAT_Y:]=rgba;height[MAT_Y:]=hh;orm[MAT_Y:]=material
    layout['elements'].append({'name':'mat','role':'band','rect':[0,MAT_Y,SIZE,SIZE],
                              'metres':SPEC['mat_metres']})
    quantized=np.rint(np.clip(height/RANGE_MM,0,1)*65535).astype(np.uint16)
    e=SPEC['rubble'];x0,y0,x1,y1=e['rect']
    rgba,hh,material,labels,rec=make_rubble()
    base[y0:y1,x0:x1]=rgba;orm[y0:y1,x0:x1]=material
    patch_height=np.rint(hh/e['height_range_mm']*65535).astype(np.uint16)
    quantized[y0:y1,x0:x1]=patch_height
    layout['elements'].append({'name':'rubble','role':'patch','rect':e['rect'],
                              'metres':e['metres'],'height_range_mm':e['height_range_mm']})
    records['rubble']=rec
    save_png(rgba,SOURCE/'prepared/rubble.png',srgb=True)
    save_png(patch_height,SOURCE/'prepared/rubble_height.png')
    save_png(material,SOURCE/'prepared/rubble_orm.png')
    save_png(labels,SOURCE/'prepared/rubble_stone_ids.png')
    save_png(base,ROOT/'creeper_base.png',srgb=True)
    save_png(quantized,ROOT/'creeper_height.png')
    delivered=np.asarray(Image.open(ROOT/'creeper_height.png'))
    save_png(normals_from_height(delivered),ROOT/'creeper_normal.png')
    save_png(orm,ROOT/'creeper_orm.png')
    (ROOT/'layout.json').write_text(json.dumps(layout,indent=2)+'\n')
    sprites=make_sprites(layout,base)
    (ROOT/'sprites.json').write_text(json.dumps(sprites,indent=1)+'\n')
    metadata={'height_range_mm':RANGE_MM,'normal_convention':'OpenGL +Y',
              'height_range_overrides_mm':{'rubble':e['height_range_mm']},
              'rubble_px_per_m':(x1-x0)/e['metres'],
              'mat_px_per_m':SIZE/SPEC['mat_metres'],'mat_quilt_seam_x':seam.tolist(),
              'elements':records,'sources_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest()
                         for p in sorted(SOURCE.glob('*_original.png'))}}
    (SOURCE/'build_metadata.json').write_text(json.dumps(metadata,indent=2)+'\n')
    print('Built creeper: 12 cutouts + shaded inner mat + rubble patch; four aligned 2048x2048 layers.')


if __name__=='__main__':
    build()
