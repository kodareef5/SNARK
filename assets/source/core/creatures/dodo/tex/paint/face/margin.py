"""Carry the neck's generated feathers onto face/pouch margins in bird space.

Only the face painter's pieces are written. Body source fields are read through
its painter so vane drawing, shaft suppression and neck relief stay identical.
"""
from pathlib import Path
import importlib.util,json
import numpy as np
from PIL import Image
from scipy.ndimage import binary_erosion,gaussian_filter,distance_transform_edt,map_coordinates,label,uniform_filter
from scipy.spatial import cKDTree

ROOT=Path(__file__).resolve().parent
PAINT=ROOT.parent
STUDY=ROOT.parents[2]/'tex/studies/body'
SEED=481076

def smooth(x):
    t=np.clip(x,0,1);return t*t*(3-2*t)

def norm(a):return a/np.maximum(np.linalg.norm(a,axis=-1,keepdims=True),1e-9)

def spaced(points,candidates,spacing,rng):
    """Irregular but reproducible stations along a physical iso-distance band."""
    tree=cKDTree(points[candidates]);available=np.ones(len(candidates),bool);out=[]
    for i in rng.permutation(len(candidates)):
        if not available[i]:continue
        out.append(candidates[i]);available[tree.query_ball_point(points[candidates[i]],spacing)]=False
    return out

def geometry(paint,piece,pos,ids,regions,mm):
    own=np.isin(piece,[ids[k] for k in paint.NAMES]);points=pos[own];which=piece[own]
    raw=np.asarray(Image.open(paint.BAKES/'dodo_feather_direction.png'),float)/255
    dx=paint.derivative(pos,piece,1);dy=paint.derivative(pos,piece,0)
    direction=norm(dx*(2*raw[...,:1]-1)+dy*(1-2*raw[...,1:2]))
    normals=norm(np.asarray(Image.open(paint.BAKES/'dodo_normal_object.png'),float)/127.5-1)
    body=(piece==ids['shell_body'])&(pos[...,1]>430)
    bp=pos[body];body_tree=cKDTree(bp)
    near,bi=body_tree.query(points)
    D=direction[own].copy();N=normals[own]
    pouch=which==ids['pouch_out'];D[pouch]=direction[body][bi[pouch]]
    D=norm(D-N*np.sum(D*N,axis=-1)[:,None]);E=norm(np.cross(D,N))
    region=regions[own];face=(which==ids['shell_face'])&(region==[0,255,0]).all(-1)
    face_piece=piece==ids['shell_face']
    fm=face_piece&(regions==[0,255,0]).all(-1)
    # A green/black mouth-lining boundary is not a face/body join. Only the
    # shell's physical outer edge can seed this continuation from the neck.
    boundary=fm&~binary_erosion(face_piece)
    edge_points=pos[boundary]
    edge_points=edge_points[body_tree.query(edge_points)[0]<1.5]
    face_distance=cKDTree(edge_points).query(points)[0]
    # Pouch is laid over the body: distance to the whole body would select its
    # centre too. Trace only the long outer edge, excluding the mirror seam.
    chart=paint.pouch_chart(points[pouch]);width=np.interp(points[:,1],chart['y'],chart['width'])
    pm=piece==ids['pouch_out'];boundary=pm&~binary_erosion(pm)
    edge_points=pos[boundary]
    w=np.interp(edge_points[:,1],chart['y'],chart['width'])
    edge_points=edge_points[(edge_points[:,0]>w*.80)&(edge_points[:,0]>1.5)]
    pouch_distance=cKDTree(edge_points).query(points)[0]
    distance=np.where(pouch,pouch_distance,face_distance)
    eligible=(face&(face_distance<25))|(pouch&(pouch_distance<8)&(points[:,0]>1.5))
    # The existing eye and gape rolls stay fully exposed.
    protected=(which==ids['shell_face'])&(np.linalg.norm(points-paint.EYE,axis=1)<24)
    mouth_curve=np.asarray(paint.mouth_chart.TARGET_YZ)
    t=np.linspace(0,1,120)[:,None]
    mouth_yz=(1-t)**3*mouth_curve[0]+3*(1-t)**2*t*mouth_curve[1]+3*(1-t)*t*t*mouth_curve[2]+t**3*mouth_curve[3]
    protected|=(which==ids['shell_face'])&(cKDTree(mouth_yz).query(points[:,1:])[0]<5.2)
    protected|=(which==ids['shell_face'])&(((points[:,1]-540)/14)**2+((points[:,2]-211)/18)**2<1)
    eligible&=~protected
    clearance=cKDTree(points[protected]).query(points)[0]
    return dict(own=own,P=points,which=which,D=D,E=E,N=N,distance=distance,eligible=eligible,
        face=face,pouch=pouch,body=body,body_nearest=bi,body_distance=near,clearance=clearance)

def apply(paint,piece,pos,ids,regions,mm,base,height,rough):
    g=geometry(paint,piece,pos,ids,regions,mm);P=g['P'];own=g['own'];eligible=g['eligible'];dist=g['distance']
    spec=importlib.util.spec_from_file_location('body_material_source',PAINT/'body/paint.py')
    body=importlib.util.module_from_spec(spec);spec.loader.exec_module(body)
    sources=body.fields()['plain'];rng=np.random.default_rng(SEED)
    tree=cKDTree(P);count=len(P)
    # An unbroken buried bed joins the actual body. Above it only whole feather
    # silhouettes own red; their density and dimensions decrease into the skin.
    bed_depth=2.7+.8*np.sin(P[:,2]*.38+P[:,1]*.21)+.5*np.sin(P[:,2]*.81)
    bed_depth=np.where(g['pouch'],1.5,bed_depth)
    coverage=(eligible&(dist<bed_depth)).astype(float)
    pointed_coverage=coverage.copy()
    pigment=np.full(count,.5);relief=np.zeros(count);ro=np.full(count,.91)
    placements=[]
    for part,rows in [('face',[(4.0,6.5,13,23),(10.0,7.5,7,13),(16.0,11,3.6,7.5),(21,28,2.6,5.5)]),
                      ('pouch',[(1.5,5.0,4.5,13),(4.0,12,2.5,7)])]:
        mask=g[part]&eligible
        for row,(depth,spacing,width,length) in enumerate(rows):
            # Leave a complete vane beside the protected flesh. Clipping a
            # feather against a fold guard produces a triangular paint shard.
            candidates=np.flatnonzero(mask&(abs(dist-depth)<.6)&(g['clearance']>length*.60))
            if not len(candidates):continue
            for k in spaced(P,candidates,spacing,rng):
                placements.append(dict(k=int(k),part=part,row=row,depth_mm=float(dist[k]),
                    width=float(width*rng.uniform(.85,1.15)),length=float(length*rng.uniform(.9,1.08)),
                    angle=float(rng.uniform(-.16,.16)),source=int(rng.integers(len(sources)))))
    # Smaller upper feathers overlap the roots of the neck feathers below.
    for s in placements:
        k=s['k'];el=sources[s['source']];W=s['width'];H=s['length'];angle=s['angle']
        D=g['D'][k]*np.cos(angle)+g['E'][k]*np.sin(angle);E=g['E'][k]*np.cos(angle)-g['D'][k]*np.sin(angle)
        ix=np.asarray(tree.query_ball_point(P[k],np.hypot(W,H)*.68),int)
        ix=ix[eligible[ix]&((g['which'][ix])==g['which'][k])]
        delta=P[ix]-P[k];u=np.sum(delta*E,axis=-1)/W+.5;v=np.sum(delta*D,axis=-1)/H+.5
        b=el['bbox'];xy=[b[1]+v*(b[3]-b[1]),b[0]+u*(b[2]-b[0])]
        def sample(key):return map_coordinates(el[key],xy,order=1,mode='constant',cval=0,prefilter=False)
        alpha=sample('alpha')*((u>=0)&(u<=1)&(v>=0)&(v<=1))
        tip_gate=np.ones_like(alpha)
        if s['part']=='face' and s['row']>=2:
            # The last vanes are narrow, pointed tips. Their long axis and
            # terminal point follow the same physical direction as the neck.
            half_width=.48*np.sin(np.pi*np.clip(v,0,1))**.72*(1-.38*v)
            tip_gate=smooth((half_width-abs(u-.5))/.065)
        alpha*=np.abs(np.sum(delta*g['N'][k],axis=-1))<max(3,W*.32)
        z=sample('p')-.060*sample('shaft')-.90*sample('shaft_drawing')
        z=.5+(z-.5)*.8*.90
        hh=.45+(sample('h')-.45)*.58;hh=.6+(hh-.6)*.5
        pigment[ix]=pigment[ix]*(1-alpha)+z*alpha
        relief[ix]=relief[ix]*(1-alpha)+(hh-.6)*alpha
        ro[ix]=ro[ix]*(1-alpha)+sample('r')*alpha
        coverage[ix]=1-(1-coverage[ix])*(1-alpha)
        pointed_coverage[ix]=1-(1-pointed_coverage[ix])*(1-alpha*tip_gate)
        s.update(centre_mm=P[k].tolist(),direction=D.tolist());del s['k']
    # Match the delivered body's calm border exactly through 1.5 mm, then
    # relinquish that match over 2 mm to the same generated feather fields.
    # This preserves both value and the flat height derivative at the cut.
    files=[PAINT/'body/paint.py',STUDY/'source/elements.json',paint.BAKES/'dodo_feather_direction.png']
    files += [STUDY/'source'/e['layers'] for e in json.loads((STUDY/'source/elements.json').read_text())]
    body_layers=PAINT/'body/layers';bmeta=json.loads((body_layers/'layers.json').read_text())
    reference_base=None
    for key in ['base','height','rough']:
        path=body_layers/f'dodo_{key}.png';files.append(path)
        values=np.asarray(Image.open(path))
        if key=='base':values=paint.lin(values[...,0]/255)
        elif key=='height':values=values/65535*bmeta['height_mm'];values-=np.median(values[g['body']])
        else:values=values/255
        v=values[g['body']][g['body_nearest']]
        if key=='base':reference_base=v.copy()
        w=(1-smooth((dist-1.5)/2))*eligible
        target={'base':pigment,'height':relief,'rough':ro}[key]
        target[:]=target*(1-w)+v*w
    files.append(body_layers/'layers.json')
    core=np.zeros(piece.shape,bool);core[own]=(coverage>.45)&eligible
    # Remove single-texel fringe islands before allocating the mandatory dark
    # separation. Real generated barbs remain in the continuous base drawing.
    from scipy.ndimage import binary_opening
    core=binary_opening(core,iterations=1)
    seam=np.zeros(piece.shape,bool);seam[own]=eligible&(dist<1.0)
    core|=seam
    pointed=np.zeros(piece.shape,bool);pointed[own]=(pointed_coverage>.45)&eligible
    pointed=binary_opening(pointed,iterations=1)
    # Measure isolated tips from the continuous feather margin, in bird space.
    # A cheek dot must not survive merely because its UVs are near the edge.
    components,n=label(core&(piece==ids['shell_face']))
    attached=np.zeros(piece.shape,bool)
    for k in range(1,n+1):
        m=components==k
        if np.min(dist[m[own]])<1.1:attached|=m
    main_tree=cKDTree(P[attached[own]])
    isolated=[]
    for k in range(1,n+1):
        m=components==k
        if np.any(m&attached):continue
        distance=main_tree.query(P[m[own]])[0]
        remove=bool(distance.max()>10)
        isolated.append(dict(texels=int(m.sum()),distance_to_continuous_margin_mm=[float(distance.min()),float(distance.max())],removed=remove))
        if remove:core[m]=False
        else:core[m]&=pointed[m]
    gap=distance_transform_edt(~core)
    band=(gap>0)&(gap<=4.5)
    allowed=np.zeros(piece.shape,bool);allowed[own]=eligible
    # The buffer is allowed up to four texels beyond the feather placement band.
    allowed|=own&((piece==ids['shell_face'])|(piece==ids['pouch_out']))&((regions[...,1]==255))
    band&=allowed&~core
    c=core[own];b=band[own]
    # Match the adjacent neck, including the reduction used for small game
    # views. Narrow undyed creases otherwise lower the feather value as the
    # map reduces. This is a constant material-value correction, not lighting.
    value_match=[]
    for part in ['face','pouch']:
        m=c&g[part]
        if not m.any():continue
        target=float(reference_base[m].mean())
        pigment[m]+=target-pigment[m].mean()
    field=np.zeros(piece.shape);field[own]=base.mean(-1);field[core]=pigment[c]
    field[band]=np.mean([.125,.140,.150])
    # The composer pads the material past its UV shell. Include that padding
    # here; zero outside the shell would invent a dark edge, especially on
    # the narrow pouch, and over-brighten its feathers in compensation.
    padding=distance_transform_edt(~own,return_distances=False,return_indices=True)
    reduced=uniform_filter(field[tuple(padding)],8)
    for part in ['face','pouch']:
        m=c&g[part]
        if not m.any():continue
        mask=np.zeros(piece.shape);mask[own]=m
        target=float(reference_base[m].mean())
        gain=float(uniform_filter(mask[tuple(padding)],8)[own][m].mean())
        offset=(target-float(reduced[own][m].mean()))/max(gain,.1)
        pigment[m]+=offset
        value_match.append(dict(part=part,adjoining_neck_linear=target,native_margin_linear=float(pigment[m].mean()),reduction_value_offset=offset))
    base[c]=np.clip(pigment[c,None],0,1);height[c]=relief[c];rough[c]=ro[c]
    # Black is undyed: a natural dark overlap crease, never a mixed ring colour.
    base[b]=np.array([.125,.140,.150]);rough[b]=.85
    height[b]=-.020
    # Settle the skin/pleats into the feather bed without a normal-map cliff.
    fade=np.zeros(piece.shape);fade[own]=height
    for name in ['shell_face','pouch_out']:
        m=piece==ids[name]
        if not (core&m).any():continue
        idx=distance_transform_edt(~m,return_distances=False,return_indices=True)
        softened=gaussian_filter(fade[tuple(idx)],.8)
        touch=m&(distance_transform_edt(~(core|band))<2)
        fade[touch]=softened[touch]
    height[:]=fade[own]
    rg=regions.copy();rg[core]=[255,0,0];rg[band]=0
    qa=ROOT/'checks';qa.mkdir(exist_ok=True)
    np.savez_compressed(qa/'margin_fields.npz',core=core,band=band,eligible=np.where(own,allowed,False))
    Image.fromarray((core*255).astype(np.uint8)).save(qa/'margin_feathers.png')
    Image.fromarray((band*255).astype(np.uint8)).save(qa/'margin_black_buffer.png')
    report=dict(seed=SEED,face_band_mm=25,pouch_band_mm=8,black_buffer_texels=4,
        feather_texels=int(c.sum()),black_texels=int(b.sum()),placements=placements,
        isolated_tips=isolated,value_match=value_match)
    (qa/'margin_placements.json').write_text(json.dumps(report,indent=2)+'\n')
    return rg,files,{k:v for k,v in report.items() if k!='placements'}
