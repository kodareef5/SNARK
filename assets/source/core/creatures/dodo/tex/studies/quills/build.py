"""Rebuild the quill atlas from frozen generated sources. No service calls.

python3 build.py --span-m 0.341 --direction-deg 0
Scale changes via span-m; all layers share the same transform. Roots face up
at 0 degrees. Height is physical, normals are regenerated after resampling.
Only this study directory is written. Requires Pillow, NumPy, SciPy.
"""
from barbs import fibres
from pathlib import Path
import argparse, json, time, hashlib
import numpy as np
from PIL import Image, PngImagePlugin
from scipy.ndimage import (gaussian_filter, gaussian_filter1d, map_coordinates,
                          distance_transform_edt, binary_erosion, label)

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT/'source'
N = 2048
HEIGHT_MM = 1.4
MASTER = 1024
ROOT_Y, TIP_Y = 62., 962.
PATHS = {
 'tail': [
 [(231,13),(233,250),(234,530),(235,760),(237,870)],
 [(669,13),(664,120),(634,300),(621,465),(629,650),(652,800),(659,869)],
 [(1207,24),(1164,125),(1093,265),(1052,410),(1046,530),(1067,690),(1100,800),(1107,868)],
 [(1710,41),(1642,125),(1547,235),(1468,390),(1449,505),(1481,660),(1537,800),(1545,868)]],
 'wing': [
 [(226,16),(224,160),(233,400),(237,650),(241,800),(242,866)],
 [(756,16),(713,128),(645,272),(599,440),(602,588),(630,745),(656,830),(660,864)],
 [(1080,16),(1124,155),(1152,355),(1145,530),(1121,700),(1105,820),(1102,862)],
 [(1610,16),(1605,120),(1564,252),(1500,402),(1477,526),(1494,660),(1540,800),(1547,861)]]}
SPECS = [
 dict(id='tail_center',kind='tail',index=0,length_m=.110,width_m=.0300,symmetric=True),
 dict(id='tail_side_1',kind='tail',index=1,length_m=.110,width_m=.0295,symmetric=False),
 dict(id='tail_side_2',kind='tail',index=2,length_m=.108,width_m=.0300,symmetric=False),
 dict(id='tail_side_3',kind='tail',index=3,length_m=.105,width_m=.0290,symmetric=False),
 dict(id='wing_finger_1',kind='wing',index=0,length_m=.050,width_m=.0180,symmetric=False),
 dict(id='wing_finger_2',kind='wing',index=1,length_m=.051,width_m=.0178,symmetric=False),
 dict(id='wing_finger_3',kind='wing',index=2,length_m=.048,width_m=.0185,symmetric=False),
 dict(id='wing_finger_4',kind='wing',index=3,length_m=.049,width_m=.0180,symmetric=False)]

def srgb_decode(a):
    a=np.asarray(a,dtype=np.float64)
    return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)

def srgb_encode(a):
    a=np.clip(a,0,1)
    return np.where(a<=.0031308,a*12.92,1.055*a**(1/2.4)-.055)

def save(path,a,srgb=False,bits=8):
    info=PngImagePlugin.PngInfo()
    info.add(b'gAMA',(45455 if srgb else 100000).to_bytes(4,'big'))
    if srgb: info.add(b'sRGB',b'\x00')
    info.add_text('Description', 'Dodo quills: sRGB diffuse + linear alpha' if srgb else 'Dodo quills: linear material data')
    a=np.uint16(np.clip(np.rint(a*65535),0,65535)) if bits==16 else np.uint8(np.clip(np.rint(a*255),0,255))
    Image.fromarray(a).save(path,pnginfo=info)
    return a

def normal(h,pixel_m):
    dx=(np.roll(h,-1,1)-np.roll(h,1,1))*.5*HEIGHT_MM*.001/pixel_m
    dy=(np.roll(h,-1,0)-np.roll(h,1,0))*.5*HEIGHT_MM*.001/pixel_m
    a=np.stack([-dx,dy,np.ones_like(h)],axis=-1)
    return a/np.linalg.norm(a,axis=-1,keepdims=True)

def extend(a,mask):
    _,inds=distance_transform_edt(~mask,return_indices=True)
    return a[tuple(inds)]

def occlusion(h,pixel_m):
    occ=np.zeros_like(h)
    for dx,dy in [(1,0),(-1,0),(0,1),(0,-1),(1,1),(-1,1),(1,-1),(-1,-1)]:
        hor=np.zeros_like(h)
        for r in [1,2,4,8,16]:
            diff=np.roll(h,(dy*r,dx*r),(0,1))-h
            hor=np.maximum(hor,np.maximum(diff,0)*HEIGHT_MM*.001/(pixel_m*r*np.hypot(dx,dy)))
        occ+=np.sin(np.arctan(hor))/8
    return np.clip(1-.75*occ,.76,1)

def calibrated_base(detail,alpha,region,normals):
    """Remove directional lighting and equalize pigment in linear light.

    Keep the source's multiscale value drawing and explicit pale rachis /
    darker inner vane / lighter fringe. Remove the residual directional
    covariance against the delivered normal, with separate constant columns
    per colour region and quadrant. Never multiply AO into albedo.
    """
    mask=alpha>=.5
    yy,xx=np.indices(alpha.shape)
    q=(xx>=alpha.shape[1]/2).astype(int)+2*(yy>=alpha.shape[0]/2)
    groups=region.astype(int)*4+q
    keep=np.unique(groups[mask]); x=normals[mask].astype(np.float64)
    columns=[x[:,i]*(region[mask]==rid) for rid in np.unique(region[mask]) for i in range(3)]
    columns += [(groups[mask]==g).astype(float) for g in keep]
    A=np.stack(columns,axis=1)
    values=detail[mask].astype(np.float64)
    coeff=np.linalg.lstsq(A,values,rcond=None)[0]
    residual=values-np.einsum('ij,j->i',A,coeff)
    # Keep the full intrinsic value range. Unlike round 1, broad intrinsic
    # rachis/fringe drawing is retained before this small directional residual.
    residual=np.clip(residual,-.31,.34)
    result=np.full(alpha.shape,.5,np.float32); result[mask]=.5+residual
    result=extend(result,mask)
    return result

def create_master(spec):
    kind,i=spec['kind'],spec['index']
    orig=Image.open(SOURCE/f'{kind}_r2_original.png').convert('RGBA')
    arr=np.asarray(orig).astype(np.float32)/255
    # Atlas columns have no overlapping content; preserve full original crop.
    x0,x1=i*orig.width//4,(i+1)*orig.width//4
    raw=arr[:,x0:x1]
    a=raw[...,3].copy()
    components,count=label(a>=.5);counts=np.bincount(components.ravel());counts[0]=0
    core=components==np.argmax(counts)
    a[distance_transform_edt(~core)>3]=0
    ry,rx=np.where(a>=.5)
    by0,by1=int(ry.min()),int(ry.max())
    bx0,bx1=int(rx.min()),int(rx.max())
    outdir=SOURCE/spec['id'];outdir.mkdir(exist_ok=True)
    orig.crop((x0,0,x1,orig.height)).save(outdir/'generated_crop.png')
    lum=np.sum(srgb_decode(raw[...,:3])*np.array([.2126,.7152,.0722]),axis=-1)
    # Track rachis against an anatomically traced prior, not feather centre.
    pts=np.array(PATHS[kind][i],float); row=np.arange(orig.height)
    prior=np.interp(row,pts[:,1],pts[:,0])-x0
    ridge=gaussian_filter(lum,(3,.8))-gaussian_filter(lum,(3,6))
    dx=np.arange(raw.shape[1])[None,:]-prior[:,None]
    score=ridge-.00012*dx*dx
    shaft=gaussian_filter1d(score.argmax(axis=1).astype(float),9)
    shaft=np.where((row<by0+80)|(row>by1-65),prior,shaft)
    yy,xx=np.mgrid[:MASTER,:MASTER].astype(np.float32)
    t=(yy-ROOT_Y)/(TIP_Y-ROOT_Y)
    sy=by0+t*(by1-by0)
    sw=(TIP_Y-ROOT_Y)*spec['width_m']/spec['length_m']
    sx=(xx-512)/sw*(bx1-bx0)+(bx0+bx1)/2
    if spec['symmetric']:
        # Use one original half reflected about its tracked shaft. This makes
        # shape AND layers exactly symmetric, unlike an almost symmetric scan.
        source_shaft=np.interp(sy[:,0],row,shaft)[:,None]
        sidewidth=(bx1-bx0)*.5
        sx=source_shaft-np.abs(xx-511.5)/(sw/2)*sidewidth
    coords=np.array([sy,sx])
    sam=lambda field: map_coordinates(field,coords,order=1,mode='constant',cval=0,prefilter=False)
    alpha=sam(a)
    # Keep the actual generated edge; tighten soft segmentation to a cutout.
    alpha=np.clip((alpha-.22)/.56,0,1)
    lum0=sam(lum)
    shaft_raw=np.interp(sy[:,0],row,shaft)[:,None]
    shaft_x=512+(shaft_raw-(bx0+bx1)/2)/(bx1-bx0)*sw
    if spec['symmetric']:shaft_x=np.full_like(shaft_x,511.5)
    d=xx-shaft_x
    normalized=np.clip(t,0,1)
    pixel_m=spec['length_m']/(TIP_Y-ROOT_Y)
    # Keep the approved envelope; resolve its last submillimetre into barbs.
    interior=distance_transform_edt(alpha>.5)
    rng=np.random.default_rng(831+i+(0 if kind=='tail' else 100))
    if spec['symmetric']:
        alpha=(alpha+alpha[:,::-1])*.5
    approved_alpha=alpha.copy()
    micro=fibres(alpha,shaft_x,pixel_m,9413+i+(100 if kind=='wing' else 0),spec['symmetric'])
    alpha=micro['alpha']
    valid=alpha>.5
    # Remove only very broad source illumination. A normalized 80-pixel field
    # leaves the source's fine and middle-scale barb drawing intact. Restore
    # explicit intrinsic anatomy, which must stay visible in unlit diffuse.
    weights=(sam(a)>.8).astype(float)
    broad=gaussian_filter(lum0*weights,80)/np.maximum(gaussian_filter(weights,80),1e-6)
    fine=(lum0-broad)*np.clip(interior/3,0,1)
    fine=extend(np.clip(fine,-.20,.20),valid)
    width_mm=.23*(1-normalized)+.07
    shaftfield=np.exp(-.5*(d/(width_mm*.001/pixel_m))**2)
    shaftfield*=np.clip((.985-t)/.055,0,1)
    # Soft real relief: 60 microns of vane rounding, 160 microns of rachis,
    # source and explicit filament texture. Fine drawing also lives in diffuse.
    crown=.06*np.exp(-(d/(sw*.38))**2)
    barb=.020*np.tanh((fine-gaussian_filter(fine,3))/.03)
    barb+=.035*gaussian_filter(micro['barbs'],.40)
    h=(.22+crown+.16*shaftfield+barb)/HEIGHT_MM
    h=extend(h,valid).astype(np.float32)
    rough=np.clip(.89+.012*np.tanh(-fine/.04)-.10*shaftfield,.76,.94)
    rough=extend(rough,valid)
    band=np.zeros((MASTER,MASTER),bool)
    band_intervals=[]
    if kind=='tail':
        # Two concentric rounded-tip crescents: 4.5 mm width, 5 mm body gap,
        # 4 mm body-coloured terminal margin measured on the rachis.
        length_mm=spec['length_m']*1000
        lateral=d*pixel_m*1000
        radius=spec['width_m']*1000*.56
        sag=12.0*(1-np.sqrt(np.maximum(0,1-(lateral/radius)**2)))
        # Fine pigment carried along real diagonal barb flow, not a polygon
        # or repeated tooth. At native resolution this is sub-mm irregularity.
        noise=gaussian_filter1d(rng.normal(size=2048),1.3)
        trace=xx-.58*np.sign(d)*(yy-TIP_Y)
        rag=np.interp(trace.ravel(),np.arange(2048),noise).reshape(xx.shape)*.36
        rag*=np.clip(np.abs(d)/8,0,1)
        q=(yy-ROOT_Y)*pixel_m*1000+sag+rag
        for center in [length_mm-15.75,length_mm-6.25]:
            band_intervals.append([center-2.25,center+2.25])
            band|=(q>=center-2.25)&(q<=center+2.25)
        if spec['symmetric']:band=band&band[:,::-1]
    region=np.where(band,5,0).astype(np.uint8) if kind=='tail' else np.full((MASTER,MASTER),5,np.uint8)
    edge_value=.065*np.clip(np.abs(d)/(sw*.46),0,1)-.035*np.exp(-(d/(sw*.14))**2)
    detail=.68*fine+.45*(fine-gaussian_filter(fine,7))+.14*shaftfield+.65*edge_value
    if kind=='wing':
        # Short cream fingers carry fine barbs, without the large downy waves
        # becoming leaf-like chevrons at their 75-texel game size.
        detail=.20*fine+1.4*(fine-gaussian_filter(fine,5))+.16*shaftfield+.65*edge_value
    # The fine parallel barbs are pigment as well as gentle relief. They
    # continue into the fringe, rather than stopping at a smooth mask edge.
    detail+=(.16 if kind=='tail' else .20)*micro['barbs']
    if kind=='tail':
        # Dark crisp rachis pigment; wings retain their approved pale shafts.
        # Replace the bright source strip instead of painting a dark halo.
        broad_strip=gaussian_filter(fine,(0,4))
        remove_white=np.clip(shaftfield*1.8,0,1)
        detail-=.68*(fine-broad_strip)*remove_white
        dark_core=np.exp(-.5*(d/(.00013/pixel_m))**2)*np.clip((.985-t)/.055,0,1)
        detail-=.20*shaftfield+.24*dark_core
    save(outdir/'approved_alpha.png',approved_alpha)
    save(outdir/'barbs.png',np.clip(.5+micro['barbs'],0,1))
    save(outdir/'fringe.png',micro['fringe'])
    save(outdir/'splits.png',micro['splits'])
    # Source and delivered diffuse comparison in exactly the same warp.
    source_lum=extend(lum0,valid)
    save(outdir/'aligned_generated.png',np.dstack([np.repeat(srgb_encode(source_lum)[...,None],3,-1),approved_alpha]),srgb=True)
    h16=save(outdir/'height.png',h,bits=16)
    n=normal(h16.astype(np.float32)/65535,pixel_m)
    base=calibrated_base(detail,alpha,region,np.rint((n*.5+.5)*255)/127.5-1)
    rgb=np.repeat(srgb_encode(base)[...,None],3,axis=-1)
    save(outdir/'cutout.png',np.dstack([rgb,alpha]),srgb=True)
    save(outdir/'alpha.png',alpha)
    save(outdir/'shaft.png',shaftfield)
    save(outdir/'bands.png',band&valid)
    save(outdir/'normal.png',n*.5+.5)
    ao=occlusion(h16.astype(np.float32)/65535,pixel_m)
    save(outdir/'packed.png',np.stack([ao,rough,np.zeros_like(ao)],-1))
    reg_rgb=np.zeros((MASTER,MASTER,3),np.uint8);reg_rgb[valid]=[255,0,0];reg_rgb[valid&(region==5)]=[255,255,0]
    Image.fromarray(reg_rgb).save(outdir/'regions.png')
    tipx=float(shaft_x[min(961,shaft_x.shape[0]-1),0]);rootx=float(shaft_x[62,0])
    info={**spec,'master_size':[MASTER,MASTER],'master_span_m':pixel_m*MASTER,
          'master_root_px':[rootx,ROOT_Y],'master_tip_px':[tipx,TIP_Y],
          'barb_curves':micro['count'],'band_intervals_from_root_mm':band_intervals,'source':f'source/{spec["id"]}'}
    (outdir/'element.json').write_text(json.dumps(info,indent=2)+'\n')
    return dict(alpha=alpha,height=h,detail=detail,roughness=rough,region=region,shaft=shaftfield,bands=band),info

def build(span_m=.341,direction_deg=0):
    started=time.time(); pixel_m=span_m/N
    height=np.full((N,N),.25,np.float32);detail=np.zeros((N,N),np.float32)
    alpha=np.zeros((N,N),np.float32);rough=np.full((N,N),.89,np.float32)
    region=np.zeros((N,N),np.uint8);shaft=np.zeros((N,N),np.float32);bands=np.zeros((N,N),np.uint8)
    owner=np.zeros((N,N),np.uint8);entries=[]
    for no,spec in enumerate(SPECS):
        fields,info=create_master(spec)
        print('Prepared '+spec['id'],flush=True)
        # Native physical scale independent of positioning and atlas rotation.
        scale=spec['length_m']/pixel_m/(TIP_Y-ROOT_Y)
        theta=np.deg2rad(direction_deg);c,s=np.cos(theta),np.sin(theta)
        center=np.array([280+480*spec['index'],550 if spec['kind']=='tail' else 1440])
        bboxsize=int(np.ceil(MASTER*scale*(abs(c)+abs(s))))+6
        x0,y0=np.floor(center-bboxsize/2).astype(int);x1,y1=x0+bboxsize,y0+bboxsize
        x0,y0=max(x0,0),max(y0,0)
        x1,y1=min(x1,N),min(y1,N)
        yy,xx=np.mgrid[y0:y1,x0:x1]
        dx,dy=xx-center[0],yy-center[1]
        src_x=(c*dx+s*dy)/scale+MASTER/2
        src_y=(-s*dx+c*dy)/scale+MASTER/2
        coords=np.array([src_y,src_x])
        def sample(f,order=1,coverage=False):
            f=f.astype(np.float32)
            # Band labels stay categorical. Continuous fibre fields need an
            # area prefilter when the 1024 masters shrink onto the atlas;
            # point-sampling subpixel barb ridges otherwise makes stippling.
            if order and scale<1:
                f=gaussian_filter(f,(.18 if coverage else .30)*np.sqrt(1/scale**2-1))
            return map_coordinates(f,coords,order=order,mode='nearest',prefilter=False)
        aa=sample(fields['alpha'],coverage=True);sl=np.s_[y0:y1,x0:x1]
        # Very thin tips can become isolated single texels after reduction.
        # Keep the connected feather at the engine's actual alpha cutoff.
        components,_=label(aa>=.5)
        counts=np.bincount(components.ravel());counts[0]=0
        aa[(aa>=.5)&(components!=counts.argmax())]=0
        if np.any((alpha[sl]>.01)&(aa>.01)):raise ValueError('Feather overlap')
        alpha[sl]=aa
        for target,key in [(height,'height'),(detail,'detail'),(rough,'roughness'),(shaft,'shaft')]:target[sl]=sample(fields[key])
        region[sl]=sample(fields['region'],0).astype(np.uint8)
        bands[sl]=sample(fields['bands'],0).astype(np.uint8)
        owner[sl][aa>=.5]=no+1
        support=np.argwhere(aa>=.5);lo=support.min(0);hi=support.max(0)+1
        def point(p):
            px,py=(np.array(p)-MASTER/2)*scale
            return [round(float(center[0]+c*px-s*py),3),round(float(center[1]+s*px+c*py),3)]
        entries.append({**info,'box_px':[int(x0+lo[1]),int(y0+lo[0]),int(x0+hi[1]),int(y0+hi[0])],
                        'root_px':point(info['master_root_px']),'tip_px':point(info['master_tip_px']),
                        'direction_deg':direction_deg,'mirror_on_bird':spec['kind']=='tail' and not spec['symmetric']})
    valid=alpha>=.5
    # Nearest visible texel extension across transparent pixels prevents dark
    # filtering fringes in all maps, including categorical colour padding.
    distance,nearest=distance_transform_edt(~valid,return_indices=True)
    height=height[tuple(nearest)];rough=rough[tuple(nearest)]
    # Finite material gutters avoid the old giant straight-cut Voronoi facets.
    height=height*np.clip((48-distance)/16,0,1)+.22/HEIGHT_MM*(1-np.clip((48-distance)/16,0,1))
    rough=np.where(distance<=32,rough,.89)
    h16=save(ROOT/'quills_height.png',height,bits=16)
    n=normal(h16.astype(np.float32)/65535,pixel_m)
    base=calibrated_base(detail,alpha,region,np.rint((n*.5+.5)*255)/127.5-1)
    rgb=np.repeat(srgb_encode(base)[...,None],3,axis=-1)
    save(ROOT/'quills_base.png',np.dstack([rgb,alpha]),srgb=True)
    save(ROOT/'quills_normal.png',n*.5+.5)
    ao=occlusion(h16.astype(np.float32)/65535,pixel_m)
    save(ROOT/'quills_packed.png',np.stack([ao,rough,np.zeros_like(ao)],-1))
    reg=extend(region,valid)
    rrgb=np.zeros((N,N,3),np.uint8);rrgb[distance<=24]=[255,0,0];rrgb[(distance<=24)&(reg==5)]=[255,255,0]
    Image.fromarray(rrgb).save(ROOT/'quills_regions.png')
    np.savez_compressed(SOURCE/'atlas_semantics.npz',owner=owner,shaft=shaft,bands=bands,visible_region=region)
    study={'version':3,'sets':{'quills':{
        'size_px':[N,N],'span_m':span_m,'tiles':False,'cutout':True,'two_sided':True,
        'alpha_cutoff':.5,'height_mm':HEIGHT_MM,'regions':[0,5],'root_direction':'top',
        'normal_convention':'OpenGL +Y; image y increases down',
        'normal_derivative':'central differences of saved 16-bit height, physical scale, wrapped',
        'base_mean_linear':.50,'elements':entries,
        'revision':'round 3: approved envelopes and bands; explicit barb filaments, fringed alpha and dark tail rachis',
        'band_design':{'shape':'two tip-concentric elliptical crescents with barb-carried irregularity',
                       'width_mm':4.5,'shaft_gap_mm':5.0,'shaft_tip_margin_mm':4.0},
        'relief_components_mm':{'vane_crown':.06,'shaft':.16,'source_barbs_amplitude':.020,'filament_relief_scale':.035,'constant_datum':.22},
        'box_convention':'[left,top,right,bottom], right/bottom exclusive, alpha >= 0.5',
        'transparent_padding':'nearest covered RGB throughout; categorical region 24 px gutter; height/roughness 32 px then flat neutral field',
        'backface_note':'two-sided material; renderer must flip the tangent frame on backfaces; mirror normal tangent X when mirroring UVs',
        'usage':'one central plus mirrored pairs of tail_side_1..3; four wing fingers per wing; card mesh supplies forward curl',
        'source_sha256':{f'{k}_r2_original.png':hashlib.sha256((SOURCE/f'{k}_r2_original.png').read_bytes()).hexdigest() for k in ['tail','wing']}
    }}}
    (ROOT/'study.json').write_text(json.dumps(study,indent=2)+'\n')
    print(json.dumps({'build_seconds':round(time.time()-started,2),'elements':len(entries),'coverage':float(valid.mean())}))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--span-m',type=float,default=.341)
    parser.add_argument('--direction-deg',type=float,default=0)
    args=parser.parse_args();build(args.span_m,args.direction_deg)
