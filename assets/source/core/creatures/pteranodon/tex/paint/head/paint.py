#!/usr/bin/env python3
"""Paint only the head group from accepted studies, in metres on the current bakes.

python3 tex/paint/head/paint.py
No Blender, downloads, external writes, baked illumination, or resized normals.
Source originals remain in the studies; their delivered layers are read every run.
"""
from pathlib import Path
import json
import hashlib
import time
from functools import lru_cache
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, map_coordinates, distance_transform_edt
from scipy.sparse import coo_matrix
from scipy.sparse.linalg import spsolve
from scipy.spatial import cKDTree

HERE = Path(__file__).resolve().parent
PAINT = HERE.parent
ASSET = PAINT.parent.parent
STUDIES = ASSET / 'tex/studies'
BAKES = ASSET / 'ref/bakes'
F = np.float32
COLORS = np.array([(255,0,0),(0,255,0),(0,0,255),(0,255,255),(255,0,255),(255,255,0),(0,0,0)], np.uint8)
OWN = ('head','beak','jaw','crest','eye_l')
RECIPE = json.loads((HERE/'source/placement.json').read_text())


def linear(s):
    return np.where(s <= .04045, s/12.92, ((s+.055)/1.055)**2.4).astype(F)


def srgb(v):
    v = np.clip(v,0,1)
    return np.where(v <= .0031308,12.92*v,1.055*v**(1/2.4)-.055)


def smooth(v):
    v=np.clip(v,0,1)
    return v*v*(3-2*v)


def read(path):
    return np.asarray(Image.open(path))


@lru_cache(maxsize=3)
def horn_layer(layer):
    """Suppress long growth streaks in the accepted tile, retaining its pits.

    Source growth runs horizontally. Subtract the directional 1 x 12 mm field
    while retaining isotropic soft mottling and the original fine stipple.
    Use the same operation on value, relief and satin response.
    """
    cfg=json.loads((STUDIES/'horn/study.json').read_text())['sets']['horn']
    a=read(STUDIES/f'horn/horn_{layer}.png').astype(F)/(65535 if layer=='height' else 255)
    if layer=='base': a=linear(a[...,:3])
    if layer=='height': a*=cfg['height_mm']
    px=2048/(cfg['span_m']*1000)
    tail=(0,) if a.ndim==3 else ()
    directional=gaussian_filter(a,(1.0*px,12*px)+tail,mode='wrap')
    mottling=gaussian_filter(a,(7*px,12*px)+tail,mode='wrap')
    a=a-RECIPE['horn_surface']['long_streak_removal']*(directional-mottling)
    return a


def study(folder, name, u, v, pitch_mm=.50):
    """Same physical coordinates and antialiasing for every aligned study layer.
    u,v metres; non-tiling panels use upper left as origin. One layer at a time.
    """
    path=STUDIES/folder
    cfg=json.loads((path/'study.json').read_text())['sets'][name]
    span=cfg['span_m']; mode='grid-wrap' if cfg['tiles'] else 'nearest'
    coord=np.array([v/span*2048-.5,u/span*2048-.5], F)
    result={}
    for layer in ['base','height','packed','regions']:
        a=read(path/f'{name}_{layer}.png')
        if layer=='regions':
            result[layer]=np.stack([map_coordinates(a[...,k],coord,order=0,mode=mode) for k in range(3)],-1)
            continue
        a=a.astype(F)/(65535 if layer=='height' else 255)
        if layer=='base': a=linear(a[...,:3])
        if layer=='height': a*=cfg['height_mm']
        if folder=='horn' and name=='horn': a=horn_layer(layer)
        sigma=max(0, pitch_mm/(span*1000/2048)*.33)
        if sigma>.3:
            a=gaussian_filter(a,(sigma,sigma,0) if a.ndim==3 else sigma,mode='wrap' if cfg['tiles'] else 'nearest')
        result[layer]=np.stack([map_coordinates(a[...,k],coord,order=1,mode=mode) for k in range(a.shape[-1])],-1) if a.ndim==3 else map_coordinates(a,coord,order=1,mode=mode)
    return result,cfg


def flow_chart(mask, pos, flow):
    """Integrate the baked UV flow into a continuous physical study chart.
    Least-squares gradient integration on a four-texel grid avoids patch seams.
    Recomputed from current bakes, never stored as a fixed UV list.
    """
    step=4
    m=mask[::step,::step]; p=pos[::step,::step]
    f=flow[::step,::step,:2].astype(F)/127.5-1; f[...,1]*=-1
    good=np.linalg.norm(f,axis=-1)>.1
    # Extend flow into guide horn faces so the real cap boundary can move.
    _,near=distance_transform_edt(~(m&good),return_indices=True)
    f[~good]=f[tuple(near)][~good]
    f/=np.maximum(np.linalg.norm(f,axis=-1,keepdims=True),1e-8)
    ids=np.full(m.shape,-1,int); ids[m]=np.arange(m.sum())
    aa=[];bb=[];dd=[]
    for axis in [0,1]:
        a=(slice(None,-1),slice(None)) if axis==0 else (slice(None),slice(None,-1))
        b=(slice(1,None),slice(None)) if axis==0 else (slice(None),slice(1,None))
        valid=m[a]&m[b]
        length=np.linalg.norm(p[b]-p[a],axis=-1)[valid]
        ff=(f[b]+f[a])[valid]/2
        # Source rows run along pile, columns across it.
        d=np.stack([(-ff[:,0] if axis==0 else ff[:,1])*length,
                    (ff[:,1] if axis==0 else ff[:,0])*length],-1)
        aa.append(ids[a][valid]);bb.append(ids[b][valid]);dd.append(d)
    a=np.concatenate(aa);b=np.concatenate(bb);d=np.concatenate(dd)
    n=m.sum(); degree=np.bincount(np.r_[a,b],minlength=n).astype(float)
    mat=coo_matrix((np.r_[degree,-np.ones(len(a)*2),1.],
        (np.r_[np.arange(n),a,b,0],np.r_[np.arange(n),b,a,0])),shape=(n,n)).tocsc()
    rhs=np.zeros((n,2))
    for k in range(2):
        rhs[:,k]=np.bincount(b,weights=d[:,k],minlength=n)-np.bincount(a,weights=d[:,k],minlength=n)
    vals=spsolve(mat,rhs).astype(F)
    charts=np.zeros((*m.shape,2),F);charts[m]=vals
    _,near=distance_transform_edt(~m,return_indices=True)
    charts=charts[tuple(near)]
    yy,xx=np.nonzero(mask)
    return [map_coordinates(charts[...,k],[yy/step,xx/step],order=1,mode='nearest') for k in range(2)]


def nape_ids(p, distjoin, feather):
    """A broad rear-head patch tapering into the live body's nape.
    Short face fibres interleave the edge over 2–4 mm. The actual common cut
    takes the body's live categorical tips below, even as that source evolves.
    """
    x,y,z=p.T
    joinpath=PAINT/'body/source/joins.json'
    join=json.loads(joinpath.read_text())['nape'] if joinpath.exists() else {}
    half=join.get('full_width_m',.045)/2
    # Fullness below the eye band removes the thin closed ring on the rear.
    # Taper both toward the neck cut and upward beneath the crest root.
    width=half+(.068-half)*smooth(distjoin/.055)
    upper=np.interp(z,[.39,.43,.50,.694],[1.379,1.389,1.400,1.393])
    distance=np.minimum.reduce([width-x,(y-.84-(z-.08)*1.30)*.72,(.54-z)*.7,
                                upper-y])
    return distance>-1.5*feather


def main():
    start=time.monotonic();out=HERE/'layers';out.mkdir(exist_ok=True)
    checks=HERE/'checks';checks.mkdir(exist_ok=True)
    meta=json.loads((PAINT/'pteranodon_pieces.json').read_text()); N=meta['size']
    numbers={q['name']:q['number'] for q in meta['pieces']}
    piece=read(PAINT/'pteranodon_pieces.png')[...,0]
    own=np.isin(piece,[numbers[k] for k in OWN]); yy,xx=np.nonzero(own)
    pfull=np.stack([read(PAINT/f'pteranodon_position_{k}.png').astype(F)/65535*(meta['position_box']['max'][i]-meta['position_box']['min'][i])+meta['position_box']['min'][i] for i,k in enumerate('xyz')],-1)
    pfull[...,0]=np.abs(pfull[...,0])
    p=pfull[own];x,y,z=p.T; ids=piece[own]
    ishead=ids==numbers['head']; crest=ids==numbers['crest']; jaw=ids==numbers['jaw']; eye=ids==numbers['eye_l']
    pitch=read(PAINT/'pteranodon_texel_mm.png')[own].astype(F)/1000
    guide=read(BAKES/'pteranodon_regions.png')[own,:3]
    normal=read(BAKES/'pteranodon_normal_object.png')[own,:3].astype(F)/127.5-1
    # Position-box x is negative in exported maps; abs(x) provides mirror invariance.
    baseline=RECIPE['height_plane_mm']; full=RECIPE['height_range_mm']
    base=np.full((len(x),3),.5,F);height=np.full(len(x),baseline,F)
    rough=np.full(len(x),.9,F);ao=np.ones(len(x),F);region=np.full(len(x),5,np.uint8)

    # Fuzz study follows the actual baked field, with a single continuous chart.
    u,v=flow_chart(piece==numbers['head'],pfull,read(BAKES/'pteranodon_flow.png'))
    fuzz,cfg=study('fuzz','fuzz_face',u+.073,v+.091,pitch_mm=.48)
    base[ishead]=fuzz['base']; height[ishead]=baseline+fuzz['height']-cfg['height_mm']/2
    rough[ishead]=fuzz['packed'][:,1];ao[ishead]=fuzz['packed'][:,0]
    fibre=np.zeros(len(x),F);fibre[ishead]=np.clip((fuzz['base'].mean(-1)-.5)/.018,-1,1)
    # Interleaved colour edges follow this same source's fibres, as mantle_edge.
    feather=.0017*fibre + .00045*np.sin(z*1300+y*690)
    front_edge=.732+(y-1.38)*.60
    cap_edge=1.418+(.62-z)*.35
    horn_dist=np.maximum(z-front_edge,(y-cap_edge)/1.06)
    horn=ishead&(horn_dist>feather)
    horn|=(ids==numbers['beak'])|jaw|crest
    # The palate is a geometric surface; don't inherit stair-stepped face colours.
    gy=np.interp(z,[.720,1.100,1.420,1.512],[1.2935,1.2960,1.2995,1.3025])
    mouth=(~eye)&(~crest)&((np.all(guide==0,axis=1))|((~jaw)&(z>.719)&(y<gy+.0008)))
    horn &= ~mouth
    neckpoints=pfull[piece==numbers['neck']]
    distjoin,joinindex=cKDTree(neckpoints).query(p[ishead],workers=1)
    streak_y=np.interp(z,[.39,.43,.50,.694,.76],[1.354,1.364,1.375,1.378,1.378])
    depth=RECIPE['streak_depth_mm']/1000+.020*smooth((.694-z)/.174)
    # Upper/lower margins follow separate interlocking fibres, at 2–4 mm.
    streak=(np.abs(y-streak_y)<depth/2+1.5*feather)&(z>.39)
    nape=np.zeros(len(x),bool)
    nape[ishead]=nape_ids(p[ishead],distjoin,feather[ishead])
    region[ishead&(streak|nape)]=0
    region[horn]=2

    # Horn grain is horizontal toward beak/jaw tips, then turns into the blade.
    hz=np.array([.4,.45,.53,.61,.69,.75,.84,.98,1.15,1.3,1.42,1.495,1.512])
    cy=np.interp(z,hz,[1.372,1.374,1.370,1.362,1.354,1.348,1.342,1.333,1.322,1.313,1.306,1.303,1.303])
    radius=np.interp(z,hz,[.025,.063,.085,.095,.085,.070,.060,.048,.034,.022,.011,.0035,.001])
    arc=np.arctan2(np.sqrt(x*x+1e-6)-.001,y-cy)*radius
    # Both jaws share continuous longitudinal phase; round the lower cutting edge.
    jw=np.interp(z,[.56,.62,.70,.76,.88,1.02,1.18,1.32,1.42,1.452],[.05,.062,.064,.060,.050,.040,.027,.015,.005,.0008])
    jd=np.interp(z,[.56,.62,.70,.76,.88,1.02,1.18,1.32,1.42,1.452],[.022,.032,.038,.038,.033,.027,.020,.012,.005,.0008])
    jawarc=np.arctan2(x/np.maximum(jw,.001),(gy-y)/np.maximum(jd,.001))*(jw+jd)/2
    arc=np.where(jaw,.14+jawarc,arc)
    origin=np.array(RECIPE['crest_origin_yz']);tip=np.array(RECIPE['crest_tip_yz']);axis=tip-origin;length=np.linalg.norm(axis);axis/=length
    s=(y-origin[0])*axis[0]+(z-origin[1])*axis[1]
    q=-(y-origin[0])*axis[1]+(z-origin[1])*axis[0]
    turn=smooth((y-1.415)/.065)
    hst,hcfg=study('horn','horn',z[horn],arc[horn],pitch_mm=.56)
    upright,_=study('horn','horn',s[horn]+.575,q[horn]+.12,pitch_mm=.56)
    # Blend aligned material fields rather than interpolating coordinates:
    # interpolated charts can have a singular Jacobian and stretch pores.
    for layer in ['base','height','packed']:
        t=turn[horn,None] if hst[layer].ndim==2 else turn[horn]
        hst[layer]=hst[layer]*(1-t)+upright[layer]*t
    detail=.22+.78*smooth((1.50-z[horn])/.38)
    edge=np.exp(-((y[horn]-gy[horn])/.0018)**2)*(z[horn]>.735)
    detail*=1-.55*edge
    mid=smooth(x[horn]/.0018); detail*=.6+.4*mid
    base[horn]=.5+(hst['base']-.5)*detail[:,None]+(.012*edge)[:,None]
    height[horn]=baseline+(hst['height']-hcfg['height_mm']/2)*detail
    rough[horn]=hst['packed'][:,1]-.07*edge-.065*(1-detail)
    ao[horn]=1-(1-hst['packed'][:,0])*detail
    fromtip=length-s
    region[crest&(fromtip>.099)&(fromtip<.185)]=3
    # Continuous, shallow keel; the large ridge is already mesh geometry.
    keel=np.exp(-(x/.0026)**2)*(y>cy)*smooth((z-.69)/.10)*horn
    height+=.09*keel
    # Contact crease at the cap's fur edge: value belongs to keratin pigment;
    # the softer cavity and overlying fibres belong to height and micro-AO.
    crease=np.exp(-((horn_dist-.0008)/.0011)**2)*ishead*(~mouth)
    base*=1-.08*crease[:,None];height-=.075*crease;ao*=1-.10*crease

    # Long narrow nasal groove, a tapered slit with a raised satin rim.
    ns=RECIPE['nostril']; along=(z-ns['z'])/(ns['length_mm']/2000)
    half=ns['half_width_mm']/1000*np.sqrt(np.maximum(0,1-along*along))
    lateral=y-(ns['y']+ns['slope_dy_dz']*(z-ns['z']))
    dist=np.abs(lateral)-half
    end=smooth((1-np.abs(along))/.10)
    slit=(1-smooth((dist+.00035)/.0008))*end*horn*(x>.025)
    rim=np.exp(-((dist-.0007)/.00075)**2)*end*horn*(x>.025)
    base*=1-.76*slit[:,None]
    height-=ns['depth_mm']*slit;height+=ns['rim_mm']*rim
    ao*=1-.24*slit;rough-=.10*slit
    # Straight gape, naturally ends at the hinge below the front of the eye.
    gape=np.exp(-((y-gy)/.00075)**2)*smooth((z-.714)/.008)*(1-smooth((z-1.47)/.035))*horn
    base*=1-.45*gape[:,None];height-=.055*gape;ao*=1-.15*gape
    # A few physical 3-12 mm wear marks only on the needle/cutting edge.
    rng=np.random.default_rng(RECIPE['seed'])
    for i in range(19):
        cz=rng.uniform(1.10,1.46);ll=rng.uniform(.003,.012)
        cut=rng.uniform(.0009,.004)
        line=(y-gy)-cut-rng.uniform(-.12,.12)*(z-cz)
        stroke=np.exp(-(line/.00065)**2)*smooth((ll/2-np.abs(z-cz))/.001)*horn
        base+=.016*stroke[:,None];height-=.016*stroke

    # Palate and inside lower jaw share physical membrane ridges, unchanged hue.
    ms,mcfg=study('skin','mouth',z[mouth],x[mouth],pitch_mm=.6)
    base[mouth]=ms['base'];height[mouth]=baseline+ms['height']-mcfg['height_mm']/2
    rough[mouth]=ms['packed'][:,1];ao[mouth]=ms['packed'][:,0];region[mouth]=6

    # Register the study in the eye's own outward-looking tangent frame.
    # The mesh includes the surround: it must follow the face's streak outline,
    # rather than dyeing the entire 34 mm globe into an oversized dark lid.
    region[eye]=np.where(streak[eye],0,5)
    centre=np.array(RECIPE['eye_centre'],F);look=np.array(RECIPE['eye_look'],F);look/=np.linalg.norm(look)
    up=np.array([0.,1.,0.]);up-=look*np.dot(up,look);up/=np.linalg.norm(up);side=np.cross(up,look)
    dp=p-centre;eu=(dp*side).sum(-1);ev=(dp*up).sum(-1);ef=(dp*look).sum(-1)
    er=np.hypot(eu,ev)
    patch=(eye|(ishead&(er<.023)&(ef>-.006)))
    ep,ecfg=study('skin','eye',eu[patch]+.025,.025-ev[patch],pitch_mm=.31)
    ewet=np.all(ep['regions']==0,axis=1)
    use=1-smooth((er[patch]-.012)/.007)
    # Study eye is used only on forward-facing globe; no iris on its rear.
    use*=smooth((ef[patch]+.003)/.006)
    wet=ewet&(ef[patch]>.002)&eye[patch]
    use[wet]=1
    # The narrow bare lid is streak skin; surrounding fuzz rejoins fuzz_face.
    target=ep['base'].copy();target[ewet&~wet]=.5
    # Amber pigment must survive the rgba downsample and the game's light.
    # Restrict this correction to warm iris texels; keep its black pupil.
    iris=wet&(target[:,0]>target[:,2]*1.6)&(target[:,0]>.012)
    target[iris]=np.clip(target[iris]*np.array(RECIPE['eye_iris_linear_gain'],F),0,1)
    # A thin pale, undyed inner lid ring follows the source's actual wet edge.
    wetmap=read(STUDIES/'skin/eye_regions.png').sum(-1)==0
    edge_mm=distance_transform_edt(~wetmap)*ecfg['span_m']*1000/2048
    ecoord=[(.025-ev[patch])/.05*2048-.5,(eu[patch]+.025)/.05*2048-.5]
    outside=map_coordinates(edge_mm,ecoord,order=1,mode='nearest')
    lid=(~ewet)&(outside<RECIPE['eye_pale_lid_mm'])&(ef[patch]>.002)&eye[patch]
    target[lid]=linear(np.array([190,177,149],F)/255)
    use[lid]=1
    base[patch]=base[patch]*(1-use[:,None])+target*use[:,None]
    # Study eye baseline is 0.35 mm (fuzz outer plane 0.385 mm).
    eh=baseline+ep['height']-.385
    height[patch]=height[patch]*(1-use)+eh*use
    rough[patch]=rough[patch]*(1-use)+ep['packed'][:,1]*use
    ao[patch]=ao[patch]*(1-use)+ep['packed'][:,0]*use
    rid=region[patch];rid[(er[patch]<.012)&(use>.01)]=0;rid[wet|lid]=6;region[patch]=rid
    # Fully hidden back of globe remains undyed dark wet tissue.
    hidden=eye&(ef<0)
    base[hidden]=linear(np.array([46,33,25],F)/255);region[hidden]=6;rough[hidden]=.20

    # Match the other painter at the geometric head/neck cut, not a UV edge.
    calm=1-smooth((distjoin-.0005)/.004)
    base[ishead]=base[ishead]*(1-calm[:,None])+.5*calm[:,None]
    height[ishead]=height[ishead]*(1-calm)+baseline*calm
    rough[ishead]=rough[ishead]*(1-calm)+.9*calm
    ao[ishead]=ao[ishead]*(1-calm)+calm
    # When the live body delivery exists, meet its exact filtered texels at the
    # shared cut. The JSON contract above remains the standalone fallback.
    body=PAINT/'body/layers'
    if (body/'layers.json').exists():
        near=piece==numbers['neck']
        b=linear(read(body/'pteranodon_base.png')[near,:3].astype(F)/255)[joinindex]
        bh=json.loads((body/'layers.json').read_text())['pteranodon_height_mm']
        h=read(body/'pteranodon_height.png')[near].astype(F)[joinindex]/65535*bh
        r=read(body/'pteranodon_rough.png')[near].astype(F)[joinindex]/255
        o=read(body/'pteranodon_occlusion.png')[near].astype(F)[joinindex]/255
        blend=1-smooth((distjoin-.0005)/.004)
        base[ishead]=base[ishead]*(1-blend[:,None])+b*blend[:,None]
        height[ishead]=height[ishead]*(1-blend)+h*blend
        rough[ishead]=rough[ishead]*(1-blend)+r*blend
        ao[ishead]=ao[ishead]*(1-blend)+o*blend
        br=read(body/'pteranodon_regions.png')[near][joinindex]
        rid=region[ishead]
        # Preserve categorical fibre tips right at the common cut as well.
        # Between 1.5 and 4 mm, let the face's own fibre field interleave them.
        share=(distjoin<.0015)|((distjoin<.004)&
            ((fibre[ishead]+1)/2 < 1-smooth((distjoin-.0015)/.0025)))
        share&=np.isin(rid,[0,5])
        rid[share]=np.where(br[share,1]==0,0,5)
        region[ishead]=rid

    # Correct small sampling bias, leaving the band as pigment only.
    # Bilinear colour sampling at the eye's categorical wet rim must never
    # carry amber into dyed skin, even by a fraction of a source texel.
    dyed=region!=6
    base[dyed]=base[dyed].mean(-1,keepdims=True)
    before={}
    # One shared horn correction preserves continuous values through crest band.
    for regs in [(2,3),(0,),(5,)]:
        m=np.isin(region,regs)
        before[str(regs)]=float(base[m].mean())
        base[m]*=.5/max(float(base[m].mean()),1e-6)
    stats={'owned_texels':int(own.sum()),'pieces':{},'region_means_linear':{},'means_before':before,
        'height_range_mm':full,'height_used_mm':[float(height.min()),float(height.max())],
        'nostril_dark_core_texels':int((slit>.8).sum()),'band_from_tip_mm':[99,185],
        'nape_join_calm_texels':int((calm>.01).sum()),'sources':{}}
    rgb=np.rint(srgb(base)*255).astype(np.uint8)
    for r in [0,2,3,5]:
        m=region==r
        stats['region_means_linear'][str(r)]=float(linear(rgb[m]/255).mean())
        assert abs(stats['region_means_linear'][str(r)]-.5)<.02
        assert np.max(np.ptp(rgb[m].astype(int),axis=-1))<=2
    assert height.min()>=0 and height.max()<=full
    for name in OWN:
        m=ids==numbers[name]
        stats['pieces'][name]={'texels':int(m.sum()),'median_mm_texel':float(np.median(pitch[m])),
            'regions':{str(r):int((region[m]==r).sum()) for r in np.unique(region[m])}}
    for folder,name in [('horn','horn'),('fuzz','fuzz_face'),('skin','eye'),('skin','mouth')]:
        stats['sources'][f'{folder}/{name}']={layer:hashlib.sha256((STUDIES/folder/f'{name}_{layer}.png').read_bytes()).hexdigest() for layer in ['base','height','packed','regions']}
    a=np.zeros((N,N,4),np.uint8);a[own,:3]=rgb;a[own,3]=255
    Image.fromarray(a).save(out/'pteranodon_base.png')
    for name,arr,maxval,dtype in [('height',height/full,65535,np.uint16),('rough',rough,255,np.uint8),('occlusion',ao,255,np.uint8)]:
        a=np.zeros((N,N),dtype);a[own]=np.rint(np.clip(arr,0,1)*maxval).astype(dtype)
        Image.fromarray(a).save(out/f'pteranodon_{name}.png')
    a=np.zeros((N,N,3),np.uint8);a[own]=COLORS[region]
    Image.fromarray(a).save(out/'pteranodon_regions.png')
    (out/'layers.json').write_text(json.dumps({'pteranodon_height_mm':full},indent=2)+'\n')
    (checks/'measurements.json').write_text(json.dumps(stats,indent=2)+'\n')
    # Dye preview is an inspection aid, never a delivered base.
    dye=linear(np.array([[46,49,52],[156,139,120],[200,102,46],[42,44,47],[86,103,122],[233,228,216],[188,188,188]],F)/255)
    col=base.copy();dyed=region!=6;col[dyed]*=dye[region[dyed]]/.5
    a=np.full((N,N,3),210,np.uint8);a[own]=np.rint(srgb(col)*255).astype(np.uint8)
    Image.fromarray(a).save(checks/'atlas_design.png')
    print(json.dumps({k:stats[k] for k in ['owned_texels','region_means_linear','height_used_mm','nostril_dark_core_texels']},indent=2))
    print(f'Painted in {time.monotonic()-start:.1f}s; all writes in {HERE}')

if __name__=='__main__': main()
