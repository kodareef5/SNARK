"""Paint the accepted face materials onto the latest baked pieces.

python3 -I tex/paint/face/paint.py
All feature coordinates and relief are millimetres. No fixed atlas masks.
"""
from pathlib import Path
import hashlib
import json
import site
import sys
site.addsitedir(site.getusersitepackages())
sys.dont_write_bytecode = True
import numpy as np
from PIL import Image, PngImagePlugin
from scipy.ndimage import map_coordinates, distance_transform_edt, gaussian_filter1d
from scipy.interpolate import CubicSpline
from scipy.spatial import cKDTree

ROOT=Path(__file__).resolve().parent
PAINT=ROOT.parent
DODO=PAINT.parent.parent
STUDY=DODO/'tex/studies/face'
BAKES=DODO/'ref/bakes'
sys.path.insert(0,str(ROOT))
import mouth_chart
import fold_profiles
import margin
NAMES=('shell_face','brow_l','pouch_out','pouch_in')
HEIGHT_MM=8.0
ZERO_MM=4.0
SAMPLES=4
EYE=np.array([43.,583.,177.])
LOOK=np.array([.70,0,.71]);LOOK/=np.linalg.norm(LOOK)
LID_UP=np.array([0.,np.cos(np.pi/6),np.sin(np.pi/6)])
EYE_ACROSS=np.cross(LID_UP,LOOK);EYE_ACROSS/=np.linalg.norm(EYE_ACROSS)
EYE_WIDTH_SCALE=1.16
EYE_LIFT_MM=3.45
EYE_FORWARD_MM=.8
MOUTH=np.array([33.,543.,190.])
# The visible gape is anterior to the internal jowl landmark. Its curve wraps
# back across the jowl using baked positions and normals (mouth_chart.py).
MOUTH_GAPE=np.array([20.5,547.,214.2])
BROW_PATH=np.array([[12,605,216.5],[26,607,212],[41,607.5,199],
                    [50.5,605,181],[51.5,600.5,160],[47.5,595,138]],np.float32)
BROW_HEIGHT=np.array([7,9.5,12.5,13.2,12,8])
BROW_DEPTH=np.array([6,8.5,11.2,12,10.8,6.8])
BROW_STATIONS=np.r_[0,np.cumsum(np.linalg.norm(np.diff(BROW_PATH,axis=0),axis=-1))]
BROW_CURVE=CubicSpline(BROW_STATIONS,BROW_PATH,bc_type='natural')
BROW_SEARCH_S=np.linspace(0,BROW_STATIONS[-1],513)
BROW_SEARCH=cKDTree(BROW_CURVE(BROW_SEARCH_S))


def lin(a):
    return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)


def srgb(a):
    a=np.clip(a,0,1)
    return np.where(a<=.0031308,12.92*a,1.055*a**(1/2.4)-.055)


def smooth(a,b,x):
    t=np.clip((x-a)/(b-a),0,1)
    return t*t*(3-2*t)


def dot(a,b):return np.sum(a*b,axis=-1)


def norm(a):return a/np.maximum(np.linalg.norm(a,axis=-1,keepdims=True),1e-12)


def derivative(a,piece,axis):
    plus,minus=np.roll(a,-1,axis),np.roll(a,1,axis)
    okp,okm=piece==np.roll(piece,-1,axis),piece==np.roll(piece,1,axis)
    extra=(None,)*(a.ndim-2)
    return np.where((okp&okm)[(...,)+extra],(plus-minus)*.5,
        np.where(okp[(...,)+extra],plus-a,np.where(okm[(...,)+extra],a-minus,0)))


def load_geometry():
    meta=json.loads((PAINT/'pieces.json').read_text())
    piece=np.asarray(Image.open(PAINT/'pieces.png'))[...,0]
    lo=np.array(meta['position_box']['min'],np.float32)*1000
    hi=np.array(meta['position_box']['max'],np.float32)*1000
    p=np.stack([np.asarray(Image.open(PAINT/f'position_{axis}.png'),np.float32)/65535*(hi[k]-lo[k])+lo[k]
                for k,axis in enumerate('xyz')],-1)
    # Corrected maps already store the left (+X) side, matching object normals.
    ids={s['name']:s['number'] for s in meta['pieces']}
    regions=np.asarray(Image.open(BAKES/'dodo_regions.png').convert('RGB'))
    mm=np.asarray(Image.open(PAINT/'texel_mm.png'),np.float32)/1000
    return meta,piece,p,ids,regions,mm


def sources():
    meta=json.loads((STUDY/'study.json').read_text())
    out={};files=[STUDY/'study.json']
    for name in ('skin','folds','brow','pouch'):
        spec=meta['sets'][name]
        b=np.asarray(Image.open(STUDY/spec['maps']['base']))
        h=np.asarray(Image.open(STUDY/spec['maps']['height']),np.float32)
        packed=np.asarray(Image.open(STUDY/spec['maps']['packed']))
        out[name]=dict(base=lin(b[...,0].astype(np.float32)/255),height=(h/65535-.5)*spec['height_mm'],
                       rough=packed[...,1].astype(np.float32)/255,span=spec['span_m']*1000)
        if name=='folds':
            out[name]['alpha']=b[...,3].astype(np.float32)/255
            out[name]['boxes']={e['name']:e['box_px'] for e in spec['elements']}
        files.extend(STUDY/spec['maps'][k] for k in ('base','height','packed'))
    files+=fold_profiles.remake(out['folds'],STUDY)
    return out,files


def sample(a,x,y,wrap=True):
    return map_coordinates(a,[y,x],order=1,mode='grid-wrap' if wrap else 'constant',cval=0,prefilter=False)


def tile(src,u,v):
    k=src['base'].shape[0]/src['span']
    return tuple(sample(src[key],u*k,v*k) for key in ('base','height','rough'))


def skin_coords(p):
    # A continuous cylindrical chart round the cheek and beak root, in mm.
    u=52*np.arctan2(p[:,2]-170,np.maximum(p[:,0],.1))
    v=583-p[:,1]
    eye_u=52*np.arctan2(EYE[2]-170,EYE[0])
    a,b=u-eye_u,v
    finer=.30*np.exp(-(a*a+b*b)/(2*18**2))
    uu=u+finer*a
    vv=v+finer*b
    # Integrate a frequency increase towards the anterior root: no stamp edge.
    root=smooth(24,52,u)
    uu+=.30*7*np.logaddexp(0,(u-32)/7)
    vv+=(v-7)*.24*root
    return uu+92,vv+91,finer,root


def overlay(base,h,rough,src,u,v,anchor,scale=1,gate=1,relief=1):
    k=2048/205
    x=anchor[0]+u*k/scale;y=anchor[1]+v*k/scale
    element={(464,280):'under_eye_four_folds',(1468,440):'mouth_corner_downturn',
             (1030,1340):'crease_medium',(1694,1543):'crease_short'}[anchor]
    x0,y0,x1,y1=src['boxes'][element]
    within=(x>=x0)&(x<x1)&(y>=y0)&(y<y1)
    a=sample(src['alpha'],x,y,False)*gate*within
    b=sample(src['base'],x,y,False)
    fh=sample(src['height'],x,y,False)*relief
    fr=sample(src['rough'],x,y,False)
    return base*(1-a)+b*a,h*(1-a)+fh*a,rough*(1-a)+fr*a,a


def face_at(p,src):
    u,v,finer,root=skin_coords(p)
    b,h,r=tile(src['skin'],u,v)
    # Modestly flatter cheek; the fine tissue beside the eye has lower relief.
    h*=.90-.15*finer/.30-.08*root
    q=p-EYE
    # The accepted arc set is centred on the eye and lifted to meet its lower
    # lid. Horizontal expansion spans the aperture and the rear corner.
    across=(dot(q,EYE_ACROSS)+EYE_FORWARD_MM)/EYE_WIDTH_SCALE
    down=-dot(q,LID_UP)+EYE_LIFT_MM
    gate=smooth(-3,6,dot(q,LOOK))
    b,h,r,eye=overlay(b,h,r,src['folds'],across,down,(464,280),gate=gate)
    across,down,gate=mouth_chart.coordinates(p,src['mouth_chart'])
    b,h,r,mouth=overlay(b,h,r,src['folds'],across,down,(1468,440),gate=gate)
    # Two short, soft creases continue towards the hood behind the eye.
    for origin,anchor,scale,angle in [(np.array([54,582,151]),(1030,1340),.40,.70),
                                      (np.array([53,576,151]),(1694,1543),.55,.45)]:
        q=p-origin;a=-q[:,2];d=-q[:,1]
        uu=np.cos(angle)*a+np.sin(angle)*d
        vv=-np.sin(angle)*a+np.cos(angle)*d
        gate=smooth(30,43,p[:,0])
        b,h,r,_=overlay(b,h,r,src['folds'],uu,vv,anchor,scale,gate,.55)
    return b,h,r,eye,mouth


def brow_coordinates(p):
    # Smooth curve coordinates avoid grain discontinuities at station boundaries.
    _,nearest=BROW_SEARCH.query(p,workers=1)
    s=BROW_SEARCH_S[nearest]
    for _ in range(2):
        c=BROW_CURVE(s);d=BROW_CURVE(s,1)
        s=np.clip(s+dot(p-c,d)/dot(d,d),0,BROW_STATIONS[-1])
    tangent=norm(BROW_CURVE(s,1));delta=p-BROW_CURVE(s)
    hh=np.interp(s,BROW_STATIONS,BROW_HEIGHT);dd=np.interp(s,BROW_STATIONS,BROW_DEPTH)
    out=norm(np.cross([0,1,0],tangent));up=norm(np.cross(tangent,out))
    angle=np.arctan2(dot(delta,up)/hh,-dot(delta,out)/dd)
    around=angle*np.sqrt((hh*hh+dd*dd)/2)
    return s,around,angle,float(BROW_STATIONS[-1])


def brow_at(p,src):
    s,v,angle,length=brow_coordinates(p)
    b,h,r=tile(src['brow'],s+53,v+64)
    # The shelf's lower overhang is particularly smooth; the attachment is calm.
    polish=np.exp(-((angle+np.pi/2)/.42)**2)
    attachment=1-smooth(2.45,np.pi,np.abs(angle))
    ends=smooth(0,5,s)*smooth(0,5,length-s)
    weight=(1-.65*polish)*attachment*(.35+.65*ends)
    return .5+(b-.5)*weight,h*weight,r-.020*polish


def pouch_chart(p):
    """Measure the neck centreline and widths anew from the supplied position maps."""
    rows=np.linspace(float(p[:,1].min()),float(p[:,1].max()),193)
    centres=[];widths=[]
    for y in rows:
        near=p[np.abs(p[:,1]-y)<1.2]
        if not len(near):near=p[np.argsort(np.abs(p[:,1]-y))[:24]]
        width=float(np.quantile(near[:,0],.99));widths.append(width)
        central=near[near[:,0]<max(width*.15,.5)]
        if not len(central):central=near[np.argsort(near[:,0])[:8]]
        centres.append(float(np.median(central[:,2])))
    z=gaussian_filter1d(np.array(centres),2)
    arc=np.r_[0,np.cumsum(np.hypot(np.diff(rows),np.diff(z)))]
    return dict(y=rows,z=z,width=gaussian_filter1d(widths,1.5),arc=arc)


def pouch_at(p,src,chart,inside=False):
    y=p[:,1];x=p[:,0]
    length=chart['arc'][-1]
    down=length-np.interp(y,chart['y'],chart['arc'])
    width=np.interp(y,chart['y'],chart['width'])
    # An even coordinate at x=0 has a zero derivative on the mirror line.
    across=np.sqrt(x*x+.65**2)-.65
    b,h,r=tile(src['pouch'],89+across,-12+down)
    edge=smooth(0,2.4,np.maximum(width-x,0))
    edge*=smooth(0,2.0,down)*smooth(0,3.5,length-down)
    if inside:return np.full(len(p),.5),np.zeros(len(p)),np.full(len(p),.48),np.zeros(len(p))
    return .5+(b-.5)*edge,h*edge,.48+(r-.48)*edge,edge


def fine_occlusion(h,piece,mm,own):
    ys,xs=np.nonzero(own);centre=h[ys,xs];occ=np.zeros(len(xs),np.float32)
    for dx,dy in ((1,0),(-1,0),(0,1),(0,-1),(1,1),(-1,-1),(1,-1),(-1,1)):
        horizon=np.zeros(len(xs),np.float32)
        for radius in (1,2,4,8,16):
            xx=np.clip(xs+dx*radius,0,h.shape[1]-1);yy=np.clip(ys+dy*radius,0,h.shape[0]-1)
            same=piece[yy,xx]==piece[ys,xs]
            span=np.maximum(.5*(mm[ys,xs]+mm[yy,xx])*radius*np.hypot(dx,dy),.01)
            slope=np.where(same,np.maximum(h[yy,xx]-centre-.004,0)/span,0)
            horizon=np.maximum(horizon,slope/np.sqrt(1+slope*slope))
        occ+=horizon/8
    a=np.zeros_like(h);a[ys,xs]=np.clip(1-.48*occ,.70,1)
    return a


def save(path,a,colour=False,height=False):
    info=PngImagePlugin.PngInfo();info.add(b'gAMA',(45455 if colour else 100000).to_bytes(4,'big'))
    if colour:info.add(b'sRGB',b'\x00')
    if a.dtype!=np.uint8:a=np.rint(np.clip(a,0,1)*(65535 if height else 255)).astype(np.uint16 if height else np.uint8)
    Image.fromarray(a).save(path,pnginfo=info)


def paint():
    meta,piece,pos,ids,regions,mm=load_geometry()
    own=np.isin(piece,[ids[n] for n in NAMES]);ys,xs=np.nonzero(own)
    index=piece[own];p=pos[own]
    dx=derivative(pos,piece,1)[own];dy=derivative(pos,piece,0)[own]
    src,inputs=sources()
    face=piece==ids['shell_face']
    baked_normal=np.asarray(Image.open(BAKES/'dodo_normal_object.png'),np.float32)/127.5-1
    src['mouth_chart']=mouth_chart.build(pos[face],norm(baked_normal[face]))
    inputs.append(BAKES/'dodo_normal_object.png')
    chart=pouch_chart(pos[piece==ids['pouch_out']])
    green=(regions[own]==[0,255,0]).all(-1)
    mouth=(index==ids['shell_face'])&~green
    base=np.zeros((len(p),3),np.float32);h=np.zeros(len(p),np.float32);rough=np.zeros_like(h)
    coverage_eye=np.zeros_like(h);coverage_mouth=np.zeros_like(h)
    # Physical fade only at the exposed face's boundary with other materials.
    face_mask=(piece==ids['shell_face'])&(regions[...,1]==255)&(regions[...,2]==0)
    edge_mm=distance_transform_edt(face_mask)*mm
    edge=smooth(.15,1.35,edge_mm[own])
    offsets=(np.arange(SAMPLES)+.5)/SAMPLES-.5
    for oy in offsets:
        for ox in offsets:
            q=p+ox*dx+oy*dy
            m=(index==ids['shell_face'])&green
            b,hh,r,ae,am=face_at(q[m],src)
            w=edge[m]
            base[m]+=(.5+(b-.5)*w)[:,None]/SAMPLES**2
            h[m]+=hh*w/SAMPLES**2;rough[m]+=r/SAMPLES**2
            coverage_eye[m]+=ae*w/SAMPLES**2;coverage_mouth[m]+=am*w/SAMPLES**2
            m=index==ids['brow_l'];b,hh,r=brow_at(q[m],src)
            base[m]+=b[:,None]/SAMPLES**2;h[m]+=hh/SAMPLES**2;rough[m]+=r/SAMPLES**2
            for name in ('pouch_out','pouch_in'):
                m=index==ids[name];b,hh,r,_=pouch_at(q[m],src,chart,name=='pouch_in')
                base[m]+=b[:,None]/SAMPLES**2;h[m]+=hh/SAMPLES**2;rough[m]+=r/SAMPLES**2
    # Dull pink-grey mouth lining, matching the neighbouring palate's family.
    q=p[mouth]
    subtle=np.sin(q[:,1]*.72+q[:,2]*.39)*np.sin(q[:,0]*.91-q[:,2]*.43)
    base[mouth]=lin(np.array([137,111,114],np.float32)/255)+subtle[:,None]*np.array([.003,.002,.002])
    h[mouth]=.004*subtle;rough[mouth]=.29+.008*subtle
    # One correction per dye region, including the smooth hidden pouch side.
    means={}
    for label,rgb in [(1,[0,255,0]),(3,[0,255,255])]:
        m=np.all(regions[own]==rgb,axis=-1)
        mean=float(base[m].mean());base[m]+=.5-mean;means[str(label)]=mean
    painted_regions,margin_inputs,margin_info=margin.apply(self_module(),piece,pos,ids,regions,mm,base,h,rough)
    inputs+=margin_inputs
    assert base.min()>=0 and base.max()<=1
    h+=ZERO_MM;assert h.min()>0 and h.max()<HEIGHT_MM,(h.min(),h.max())
    n=meta['size'];rgba=np.zeros((n,n,4),np.float32);height=np.zeros((n,n),np.float32);ro=np.zeros_like(height)
    rgba[ys,xs,:3]=srgb(base);rgba[ys,xs,3]=1
    height[ys,xs]=h;ro[ys,xs]=rough
    ao=fine_occlusion(height,piece,mm,own)
    rg=np.zeros_like(regions);rg[own]=painted_regions[own]
    out=ROOT/'layers';out.mkdir(exist_ok=True)
    save(out/'dodo_base.png',rgba,colour=True);save(out/'dodo_height.png',height/HEIGHT_MM,height=True)
    save(out/'dodo_rough.png',ro);save(out/'dodo_occlusion.png',ao);save(out/'dodo_regions.png',rg)
    inputs+=[PAINT/'pieces.json',PAINT/'pieces.png',PAINT/'texel_mm.png',BAKES/'dodo_regions.png']
    inputs+=[PAINT/f'position_{axis}.png' for axis in 'xyz']
    information=dict(height_mm=HEIGHT_MM,zero_mm=ZERO_MM,pieces=list(NAMES),samples_per_texel=SAMPLES**2,
        eye_centre_mm=EYE.tolist(),lower_lid_angle_deg=-30,mouth_corner_mm=MOUTH.tolist(),mouth_gape_mm=MOUTH_GAPE.tolist(),
        position_convention='Corrected left-side maps; no reflection',
        eye_across_scale=EYE_WIDTH_SCALE,eye_lift_mm=EYE_LIFT_MM,eye_forward_mm=EYE_FORWARD_MM,
        eye_crease_span_mm=[2*(107+i*10)*(205/2048)*EYE_WIDTH_SCALE for i in range(3)],
        eye_roll_count=3,eye_profile_pitch_mm=fold_profiles.EYE_PITCH,fold_crown_profile="rounded inner lip, broad Gaussian outer shoulder, 0.25 mm smoothing",
        mouth_curve_yz_mm=mouth_chart.TARGET_YZ.tolist(),mouth_curve_length_mm=src['mouth_chart']['length_mm'],
        skin_nominal_diameter_mm=1.31,skin_sampling='Continuous physical cheek chart, finer near eye and beak',
        eye_fold_width_mm=fold_profiles.EYE_WIDTHS,mouth_fold_width_mm=fold_profiles.MOUTH_WIDTH,pouch_nominal_pitch_mm=2.0,
        pouch_centreline_length_mm=float(chart['arc'][-1]),pouch_source_offset_mm=[89,-12],
        region_means_before_correction=means,neck_margin=margin_info,
        inputs_sha256={str(f.relative_to(DODO)):hashlib.sha256(f.read_bytes()).hexdigest() for f in inputs})
    (out/'layers.json').write_text(json.dumps(information,indent=2)+'\n')
    qa=ROOT/'checks';qa.mkdir(exist_ok=True)
    fields={}
    for name,values in [('under_eye',coverage_eye),('mouth_corner',coverage_mouth)]:
        a=np.zeros((n,n),np.float32);a[own]=values;fields[name]=a
        save(qa/(name+'_placement.png'),a)
    (qa/'pouch_chart.json').write_text(json.dumps({k:v.tolist() for k,v in chart.items()},indent=2)+'\n')
    print(json.dumps(dict(painted_texels=len(p),region_means_before=means,
        used_height_mm=[float(h.min()),float(h.max())],pouch_length_mm=float(chart['arc'][-1])),indent=2))


def self_module():
    # Also works when check.py loads this painter through importlib.
    from types import SimpleNamespace
    return SimpleNamespace(**globals())

if __name__=='__main__':paint()
