#!/usr/bin/env python3
"""Build both horn studies offline. Python 3, Pillow, NumPy, SciPy.

All writes stay in this folder. Distances in surface functions are millimetres.
The generated original is never modified. The head outline is registered to the
owned concept, not inferred from any downloaded reference. No baked form light.
"""
from pathlib import Path
import argparse
import hashlib
import json
import time
import numpy as np
from PIL import Image, ImageDraw, PngImagePlugin
from scipy.ndimage import gaussian_filter, map_coordinates, distance_transform_edt, binary_dilation, binary_fill_holes, label

ROOT = Path(__file__).resolve().parent
N = 2048
SEED = 92023
SPAN = .4
GRAIN_SCALE = 1.0
GRAIN_ANGLE_DEG = 0.0
RELIEF_SCALE = 1.0
HEAD_SPAN = 1.5
HEIGHT_MM = {'horn': .32, 'head_side': 1.2}
REFERENCE = ROOT.parents[2] / 'ref/concept/head_side.png'


def linear(v):
    return np.where(v <= .04045, v/12.92, ((v+.055)/1.055)**2.4)


def srgb(v):
    v = np.maximum(v, 0)
    return np.where(v <= .0031308, v*12.92, 1.055*v**(1/2.4)-.055)


def save(name, a, color=False, sixteen=False):
    info = PngImagePlugin.PngInfo()
    info.add(b'gAMA', (45455 if color else 100000).to_bytes(4, 'big'))
    if color: info.add(b'sRGB', b'\0')
    info.add_text('Description', 'Pteranodon horn study. ' + ('sRGB unlit albedo.' if color else 'Linear data; normal OpenGL +Y; packed R=AO G=roughness B=0.'))
    if a.dtype not in [np.uint8, np.uint16]:
        lim = 65535 if sixteen else 255
        a = np.clip(np.rint(a*lim), 0, lim).astype(np.uint16 if sixteen else np.uint8)
    Image.fromarray(a).save(ROOT/name, pnginfo=info)
    return a


def normal_from_height(h16, span, full_mm, tiles):
    h = h16.astype(np.float32)/65535*full_mm
    # Central differences at the delivered physical pixel pitch, +Y toward top.
    dx = (np.roll(h, -1, 1)-np.roll(h, 1, 1))/(2*span*1000/N)
    dy = (np.roll(h, -1, 0)-np.roll(h, 1, 0))/(2*span*1000/N)
    # All panels have a flat-height border, so wrap and one-sided derivatives agree.
    v = np.stack([-dx, dy, np.ones_like(h)], -1)
    v /= np.sqrt((v*v).sum(-1, keepdims=True))
    return v*.5+.5


def noise(rng, sigma):
    v = gaussian_filter(rng.standard_normal((N,N)).astype(np.float32), sigma, mode='wrap')
    return v/max(float(v.std()), 1e-7)


def blob(a, x, y, sx, sy, strength):
    rad = int(np.ceil(max(sx,sy)*3+2))
    xs = np.arange(int(x)-rad, int(x)+rad+1)
    ys = np.arange(int(y)-rad, int(y)+rad+1)
    q = ((xs[None,:]-x)/sx)**2+((ys[:,None]-y)/sy)**2
    a[np.ix_(ys%N, xs%N)] += strength*np.exp(-q*.5)


def stroke(a, x, y, length, angle, width, strength, bend=0):
    ca, sa = np.cos(angle), np.sin(angle)
    ex,ey = x+ca*length,y+sa*length
    margin = width*4+abs(bend)+3
    xs = np.arange(int(min(x,ex)-margin),int(max(x,ex)+margin)+1)
    ys = np.arange(int(min(y,ey)-margin),int(max(y,ey)+margin)+1)
    u = (xs[None,:]-x)*ca+(ys[:,None]-y)*sa
    v = -(xs[None,:]-x)*sa+(ys[:,None]-y)*ca
    t = np.clip(u/length,0,1)
    v -= bend*np.sin(t*np.pi)
    taper = np.sin(t*np.pi)**.7
    a[np.ix_(ys%N, xs%N)] += strength*np.exp(-.5*(v/width)**2)*taper


def periodic_source():
    original = np.asarray(Image.open(ROOT/'source/horn_generated.png').convert('RGB'), np.float32).mean(-1)/255
    a = linear(original)
    m = min(a.shape); a=a[:m,:m]
    p = int(m*.82); overlap=m-p
    t = np.arange(p,dtype=np.float32)
    w = np.where(t<overlap, .5-.5*np.cos(np.pi*np.minimum(t/overlap,1)), 1)
    b = a[:,:p]*w+a[:,(np.arange(p)+p)%m]*(1-w)
    b = b[:p]*w[:,None]+b[(np.arange(p)+p)%m]*(1-w[:,None])
    y,x=np.mgrid[:N,:N].astype(np.float32)
    b=map_coordinates(b,np.stack((y*p/N,x*p/N)),order=3,mode='grid-wrap')
    # Only broad illumination is removed (32 mm sigma), not pigment microdetail.
    intrinsic = b-gaussian_filter(b, 32*N/(SPAN*1000),mode='wrap')
    return intrinsic.astype(np.float32), b.astype(np.float32)


def surface():
    rng=np.random.default_rng(SEED)
    px=N/(SPAN*1000)
    source, transformed=periodic_source()
    # The new image supplies the drawing. Split its pigment bands from its
    # irregular stipple, keeping both in the base and the pits in real relief.
    broad=gaussian_filter(source,2.4*px,mode='wrap')
    fine=source-broad
    mottling=.047*np.tanh(broad/.031)
    pore_value=-.31*np.tanh(np.maximum(-fine,0)/.22)
    fine_value=.029*np.tanh(np.maximum(fine,0)/.038)
    # Tiny positive values are keratin variation, not baked white pit rims.
    pigment=pore_value+fine_value
    pits=-.083*np.tanh(np.maximum(-fine,0)/.16)*RELIEF_SCALE
    growth=np.zeros((N,N),np.float32)
    scratches=np.zeros_like(growth)
    # Occasional fine ridges are subordinate to the source's soft value bands.
    for _ in range(22):
        x,y=rng.uniform(0,N,2)
        stroke(growth,x,y,rng.uniform(12,48)*px,
               np.deg2rad(rng.normal(0,1.4)),rng.uniform(.16,.32)*px,
               rng.uniform(.003,.009)*RELIEF_SCALE,rng.uniform(-.5,.5)*px)
    relief=pits+growth+fine_value*.10*RELIEF_SCALE+mottling*.035*RELIEF_SCALE
    base=.5+mottling+pigment
    base+=.5-float(base.mean())
    rough=.425+np.clip(-pore_value*.22,0,.045)+mottling*.16+noise(rng,6)*.004
    rough=np.clip(rough,.37,.49)
    # A scalar coordinate scale changes every source component together.
    if GRAIN_SCALE != 1:
        # Integer repeats preserve exact square tiling; noninteger grain scale
        # requires a new overlap, so the tile accepts reciprocal integers only.
        repeats=round(1/GRAIN_SCALE)
        if repeats < 1 or abs(1/GRAIN_SCALE-repeats)>1e-6:
            raise ValueError('grain-scale must be 1/integer to preserve tiling')
        yy,xx=np.mgrid[:N,:N].astype(np.float32)
        coords=np.stack([yy*repeats,xx*repeats])
        source,transformed,pits,growth,scratches,pigment,mottling,pore_value,base,relief,rough=[
            map_coordinates(a,coords,order=1,mode='grid-wrap') for a in
            [source,transformed,pits,growth,scratches,pigment,mottling,pore_value,base,relief,rough]]
    turns=-int(GRAIN_ANGLE_DEG//90)
    source,transformed,pits,growth,scratches,pigment,mottling,pore_value,base,relief,rough=[
        np.rot90(a,turns).copy() if turns else a for a in
        [source,transformed,pits,growth,scratches,pigment,mottling,pore_value,base,relief,rough]]
    np.savez_compressed(ROOT/'source/horn_elements.npz',source_value=source,source_periodic=transformed,
                        pores_height_mm=pits,growth_height_mm=growth,scratches_height_mm=scratches,
                        source_pigment=pigment,mottling_value=mottling,pores_value=pore_value,
                        base_linear=base,height_mm=relief,roughness=rough)
    return base.astype(np.float32),relief.astype(np.float32),rough.astype(np.float32)


def occlusion(h, span, tiles):
    mode='wrap' if tiles else 'nearest'
    # Short horizon proxies in millimetres, deliberately restrained on smooth horn.
    ao=np.ones_like(h)
    for radius,weight in [(.4,.9),(1.2,.65),(3.,.30)]:
        surrounding=gaussian_filter(h,radius*N/(span*1000),mode=mode)
        ao-=np.maximum(surrounding-h,0)*weight
    return np.clip(ao,.78,1)


def deliver(name, base, h, rough, regions, span, alpha=None, crease=None):
    tiles=alpha is None
    if tiles:
        base += .5-float(base.mean())
    else:
        valid=alpha>=.5
        base += .5-float(base[valid].mean())
    rgb=np.repeat(srgb(base)[...,None],3,-1)
    if alpha is not None:
        # Nearest solid colour fills all transparency: generous filtering bleed.
        _,near=distance_transform_edt(~(alpha>=.5),return_indices=True)
        rgb[alpha<.5]=rgb[near[0][alpha<.5],near[1][alpha<.5]]
        rgb=np.concatenate([rgb,alpha[...,None]],-1)
    save(f'{name}_base.png',rgb,color=True)
    h16=save(f'{name}_height.png',.5+h/HEIGHT_MM[name],sixteen=True)
    save(f'{name}_normal.png',normal_from_height(h16,span,HEIGHT_MM[name],tiles))
    quant_h=(h16.astype(np.float32)/65535-.5)*HEIGHT_MM[name]
    ao=occlusion(quant_h,span,tiles)
    if crease is not None: ao*=1-.16*crease
    save(f'{name}_packed.png',np.stack([ao,rough,np.zeros_like(rough)],-1))
    save(f'{name}_regions.png',regions)


def bezier_polygon(commands):
    points=[]; current=None
    for c in commands:
        if c[0]=='M' or c[0]=='L':
            current=np.array(c[1:3],np.float32);points.append(tuple(current))
        elif c[0]=='C':
            a=current;b=np.array(c[1:3]);d=np.array(c[3:5]);e=np.array(c[5:7])
            for t in np.linspace(0,1,64)[1:]:
                points.append(tuple((1-t)**3*a+3*(1-t)**2*t*b+3*(1-t)*t*t*d+t**3*e))
            current=e
    return points


def head_mask(layout):
    ref=Image.open(REFERENCE).convert('RGB')
    a=np.asarray(ref,np.float32)
    canvas=Image.new('L',ref.size,0);d=ImageDraw.Draw(canvas)
    for key in ['upper_outline','lower_outline']:
        d.polygon(bezier_polygon(layout[key]),fill=255)
    domain=binary_dilation(np.asarray(canvas)>0,iterations=12)
    orange=(a[...,0]>a[...,1]*1.17)&(a[...,1]>a[...,2]*1.13)&((a[...,0]-a[...,2])>26)
    yy,xx=np.mgrid[:ref.height,:ref.width]
    t=(1543-xx)*.6+(yy-207)*.8
    # Only the charcoal crest band is recovered from the reference's dark pixels.
    crest_domain=(xx>1360)&(yy<430)&(t>82)&(t<211)
    dark=(a.mean(-1)<145)&(np.max(a,-1)-np.min(a,-1)<45)
    matte=(orange| (crest_domain&dark))&domain
    # Keep the outline's natural fuzz overlap. Fill isolated pigment pores, then
    # cut only the gape. The nostril is solid horn with a shallow groove.
    matte=binary_fill_holes(matte)
    # Warm ivory fibres can pass the orange chroma threshold. They belong to
    # the face, so remove disconnected flecks instead of delivering horn islands.
    components,count=label(matte,np.ones((3,3),bool))
    counts=np.bincount(components.ravel());counts[0]=0
    matte=counts[components]>=300
    im=Image.fromarray((matte*255).astype(np.uint8));draw=ImageDraw.Draw(im)
    draw.polygon(bezier_polygon(layout['gape']),fill=0)
    # Reference coordinates: 1000 px/m, square crop 1500 px wide.
    origin=layout['reference_origin_px']; size=1500
    crop=Image.new('L',(size,size),0)
    crop.paste(im,(-origin[0],-origin[1]))
    alpha=np.asarray(crop.resize((N,N),Image.Resampling.LANCZOS),np.float32)/255
    save('source/head_silhouette.png',alpha)
    return alpha


def head_surface(tile, layout):
    base_tile,h_tile,r_tile=tile
    px=N/(HEAD_SPAN*1000)
    yy,xx=np.mgrid[:N,:N].astype(np.float32)
    x=xx/px+layout['reference_origin_px'][0]
    y=yy/px+layout['reference_origin_px'][1]
    # The cap is a continuous rotation into the upward/backward crest grain.
    mix=np.clip((815-y)/125,0,1)*np.clip((x-960)/145,0,1)
    mix=mix*mix*(3-2*mix)
    u=(1-mix)*x+mix*(.6*(x-1120)-.8*(y-700)+1120)
    v=(1-mix)*y+mix*(.8*(x-1120)+.6*(y-700)+700)
    # Crest keratin is a little coarser than the beak; anchor the coordinate
    # dilation at the crest root so the growth field stays continuous.
    u=1120+(u-1120)/(1+.20*mix)
    v=700+(v-700)/(1+.20*mix)
    scale=N/(SPAN*1000)
    coords=np.stack([v*scale,u*scale])
    # Prefilter at the destination pixel footprint before resampling; no moire.
    sigma=max(0,.45*HEAD_SPAN/SPAN)
    def sample(a):return map_coordinates(gaussian_filter(a,sigma,mode='wrap'),coords,order=1,mode='grid-wrap')
    base=sample(base_tile);h=sample(h_tile);rough=sample(r_tile)
    alpha=head_mask(layout);solid=alpha>=.5
    edge_dist=distance_transform_edt(solid)/px
    # Less and finer stipple toward the needle, denser and coarser over the cap
    # and crest. At edges, wear smooths the same material without erasing it.
    mature=np.clip((x-315)/730,0,1)
    mature=mature*mature*(3-2*mature)
    wear=np.exp(-edge_dist/2.5)*((x<1000)|(y<320))
    detail=(.20+.80*mature)*(1-.66*wear)
    broad=sample(gaussian_filter(base_tile,2.4*scale,mode='wrap'))
    base=broad+(base-broad)*detail
    h*=detail
    rough-=.035*(1-mature)+.035*wear
    base+=.022*(1-mature)+.018*wear
    # Low sharp keel: placement guide, not broad head form baked into height.
    keel_points=bezier_polygon(layout['keel'])
    keel=Image.new('L',(N,N),0);kd=ImageDraw.Draw(keel)
    pts=[((a-layout['reference_origin_px'][0])*px,(b-layout['reference_origin_px'][1])*px) for a,b in keel_points]
    kd.line(pts,fill=255,width=1)
    dist=distance_transform_edt(np.asarray(keel)==0)/px
    ridge=np.exp(-.5*(dist/1.05)**2)*.32
    h+=ridge*solid
    # Opaque nasal slit: path is unchanged, only its construction changes from
    # an alpha hole to a dark floor and a physically depressed, softly rimmed groove.
    nasal=Image.new('L',(N,N),0);nd=ImageDraw.Draw(nasal)
    nd.polygon([((a-layout['reference_origin_px'][0])*px,(818+.72*(b-818)-layout['reference_origin_px'][1])*px)
                for a,b in bezier_polygon(layout['nostril'])],fill=255)
    nasal=np.asarray(nasal,np.float32)/255
    groove=gaussian_filter(nasal,.72*px)
    lip=np.maximum(gaussian_filter(nasal,2.15*px)-groove,0)*2.5
    h=h*(1-.8*groove)+(-.28*groove+.16*lip)*solid
    smooth_base=gaussian_filter(base,2*px)
    base=base*(1-.85*groove)+smooth_base*.85*groove-.33*groove*solid+.008*lip
    rough-=.025*lip
    save('source/head_nostril_groove.png',groove)
    # Wear concentrates on the tip and cutting edges, with independently drawn strokes.
    rng=np.random.default_rng(SEED+15)
    scratches=np.zeros((N,N),np.float32)
    for _ in range(19):
        rx=rng.uniform(272,690);ry=849+rng.uniform(-2,5)
        stroke(scratches,(rx-150)*px,(ry+200)*px,rng.uniform(3,12)*px,
               np.deg2rad(rng.uniform(-24,22)),rng.uniform(.12,.25)*px,-rng.uniform(.02,.055))
    h+=scratches*solid;base+=scratches*.32*solid
    # Face fuzz already cuts tiny fingers into the cap's matte. The narrow root
    # crease belongs to height/AO, never a broad dark stripe in the base.
    face_zone=(x>970)&(y>735)&(y>740+.035*(x-1140))
    crease=np.exp(-edge_dist/1.1)*solid*face_zone
    h-=.075*crease
    # Smoothly extend relief into transparency, then flatten only at canvas border.
    # No silhouette step is added; alpha, not height, owns the cutout.
    _,near=distance_transform_edt(~solid,return_indices=True)
    outside=~solid
    h[outside]=h[near[0][outside],near[1][outside]]
    outside_dist=distance_transform_edt(outside)
    h*=np.exp(-(outside_dist/18)**2)
    rough=np.clip(rough,.32,.48)
    t=(1543-x)*.6+(y-207)*.8
    cross=.8*(x-1450)+.6*(y-320)
    wiggle=.65*np.sin(cross*.17)+.26*np.sin(cross*.53+.7)
    band=(t>99+wiggle)&(t<185+wiggle)&solid
    reg=np.zeros((N,N,3),np.uint8);reg[solid]=(0,0,255);reg[band]=(0,255,255)
    # Match both dye means using a smooth correction, never a step at the band.
    blend=gaussian_filter(band.astype(np.float32),30*px)
    horn=solid&~band
    matrix=np.array([[1,float(blend[horn].mean())],[1,float(blend[band].mean())]])
    offset,slope=np.linalg.solve(matrix,[.5-float(base[horn].mean()),.5-float(base[band].mean())])
    base+=offset+slope*blend
    save('source/head_detail_weight.png',detail)
    save('source/head_face_crease.png',crease)
    save('source/head_growth_direction.png',np.stack([mix,np.zeros_like(mix),np.zeros_like(mix)],-1))
    deliver('head_side',base,h,rough,reg,HEAD_SPAN,alpha,crease)


def main():
    global GRAIN_SCALE,GRAIN_ANGLE_DEG,RELIEF_SCALE
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--grain-scale',type=float,default=GRAIN_SCALE)
    ap.add_argument('--grain-angle',type=int,choices=[0,90,180,270],default=GRAIN_ANGLE_DEG,
                    help='Rotate all aligned source and authored layers; quarter turns keep exact tile wrap.')
    ap.add_argument('--relief-scale',type=float,default=RELIEF_SCALE)
    args=ap.parse_args()
    GRAIN_SCALE=args.grain_scale;GRAIN_ANGLE_DEG=args.grain_angle;RELIEF_SCALE=args.relief_scale
    start=time.time()
    tile=surface()
    reg=np.zeros((N,N,3),np.uint8);reg[:]=(0,0,255)
    deliver('horn',*tile,reg,SPAN)
    layout=json.loads((ROOT/'source/head_layout.json').read_text())
    head_surface(tile,layout)
    meta={
        'version':2,'description':'Stippled living horn: dark source-derived pits, soft pigment growth bands and satin response; pigment-only crest band.',
        'sets':{
            'horn':{'span_m':SPAN,'tiles':True,'cutout':False,'height_mm':HEIGHT_MM['horn'],'regions':[2],
                    'form':'tube','radius':.05,'flat':.35,'taper':.12,'length':.8,
                    'growth_direction':'left to right','density_px_per_m':N/SPAN},
            'head_side':{'span_m':HEAD_SPAN,'tiles':False,'cutout':True,'height_mm':HEIGHT_MM['head_side'],'regions':[2,3],
                    'form':'none','density_px_per_m':N/HEAD_SPAN,'alpha_cutoff':.5,
                    'reference':'ref/concept/head_side.png','reference_px_per_m':1000,
                    'reference_origin_px':layout['reference_origin_px'],'reference_to_study_scale':N/1500,
                    'notes':'Black region / alpha holes are the gape and face. Nostril is an opaque region-2 slit with a dark floor and shallow height groove. Fuzz overlap cuts into the horn edge. The band affects regions only; base, relief and roughness continue through it.'}},
        'height_encoding':'0..65535 is 0..height_mm; neutral plane at half-range. Height contains surface microrelief and shallow keel/rim placement guides, not the skull volume.',
        'normal':'OpenGL, computed from quantized delivered height, central differences at span_m/2048.',
        'packed':'R occlusion from height, G roughness (linear), B metalness=0.',
        'feature_scale_mm':{'pit_diameter_target':[.5,1.0],'pit_depth':[0,.083],'growth_band_width_target':[2,7],
                            'growth_band_length_target':[12,80],'fine_ridge_width':[.32,.64],
                            'mottling_scale_target':[5,30],'scratch_length':[3,12],
                            'scratch_location':'19 sparse strokes on beak tip and cutting edge only',
                            'keel_guide_height':.32,'nostril_groove_depth':.28},
        'source':{'file':'source/horn_generated.png','prompt':'source/horn_prompt.txt','method':'built-in image_gen',
                  'size_px':list(Image.open(ROOT/'source/horn_generated.png').size),
                  'reference':'ref/concept/head_side.png',
                  'sha256':hashlib.sha256((ROOT/'source/horn_generated.png').read_bytes()).hexdigest()},
        'parameters':{'seed':SEED,'grain_scale':GRAIN_SCALE,'grain_angle_deg':GRAIN_ANGLE_DEG,'relief_scale':RELIEF_SCALE},
        'rebuild':'python3 tex/studies/horn/build.py && python3 tex/studies/horn/check.py',
        'build_seconds':round(time.time()-start,2)}
    (ROOT/'study.json').write_text(json.dumps(meta,indent=2)+'\n')
    print(f'Built both sets in {time.time()-start:.1f}s',flush=True)

if __name__=='__main__':main()
