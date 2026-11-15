"""Paint generated feathers in the corrected bird space; no Blender or shared writes.

python3 -B tex/paint/body/paint.py
A feather is one aligned set of source fields projected into a local surface
frame. Row stations are world-space distances from the rump; their columns
follow cross-body contours. The UV layout only addresses the output pixels.
"""
from pathlib import Path
import json,hashlib,site,sys,time
site.addsitedir(site.getusersitepackages());sys.dont_write_bytecode=True
import numpy as np
from PIL import Image,PngImagePlugin
from scipy.ndimage import gaussian_filter,distance_transform_edt,map_coordinates
from scipy.spatial import cKDTree
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
ROOT=Path(__file__).resolve().parent;PAINT=ROOT.parent;DODO=ROOT.parents[2]
STUDY=DODO/'tex/studies/body';TROUSERS=DODO/'tex/studies/trousers';BAKES=DODO/'ref/bakes'
OUT=ROOT/'layers';QA=ROOT/'checks';N=2048;HEIGHT_MM=4.;SEED=551237
# Five centres between the neck base and the front of the tail root. The
# scalar's units are not arc length: these intervals give about 43 mm on skin.
BAR_LEVELS=np.linspace(191.,345.,5)
def lin(a):return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)
def srgb(a):return np.where(a<=.0031308,12.92*a,1.055*np.maximum(a,0)**(1/2.4)-.055)
def smooth(a):
 a=np.clip(a,0,1);return a*a*(3-2*a)
def norm(a):return a/np.maximum(np.linalg.norm(a,axis=-1,keepdims=True),1e-9)
def save(name,a,bits=8,colour=False):
 info=PngImagePlugin.PngInfo();info.add(b'gAMA',(45455 if colour else 100000).to_bytes(4,'big'))
 if colour:info.add(b'sRGB',b'\0')
 Image.fromarray(np.rint(np.clip(a,0,1)*(65535 if bits==16 else 255)).astype(np.uint16 if bits==16 else np.uint8)).save(OUT/name,pnginfo=info)
def extend(a,m):
 idx=distance_transform_edt(~m,return_distances=False,return_indices=True);return a[tuple(idx)]
def brush_depth(el,factor=1.,u=.5,field='bar'):
 """Equivalent covered length through the generated brush at a 59 mm vane."""
 b=el['bbox'];v=np.linspace(0,1,1024);start=1-.4*factor
 iv=np.where(v<start,v*.6/start,.6+(v-start)/factor)
 xy=np.stack([b[1]+iv*(b[3]-b[1]),np.full(len(v),b[0]+u*(b[2]-b[0]))])
 q=map_coordinates(el[field],xy,order=1,mode='constant',cval=0)*map_coordinates(el['alpha'],xy,order=1,mode='constant',cval=0)
 return float(q.sum()*59/len(v))
def brush_profile(el,u=.5,field='bar'):
 """Solid core and weak-strand reach; lengths on a nominal 59 mm feather."""
 b=el['bbox'];v=np.linspace(0,1,2048);factor=el.get('terminal_scale',1.)
 start=1-.4*factor;iv=np.where(v<start,v*.6/start,.6+(v-start)/factor)
 xy=np.stack([b[1]+iv*(b[3]-b[1]),np.full(len(v),b[0]+u*(b[2]-b[0]))])
 a=map_coordinates(el['alpha'],xy,order=1,mode='constant',cval=0)
 q=map_coordinates(el[field],xy,order=1,mode='constant',cval=0);q[a<.5]=0
 return dict(core_mm=float(np.sum(q>.95)*59/len(v)),reach_mm=float(np.ptp(v[q>.1])*59) if np.any(q>.1) else 0.)
def fields(surface=True):
 result={}
 for family,file in [('plain','elements.json'),('barred','barred_elements.json')]:
  result[family]=[]
  for rec in json.loads((STUDY/'source'/file).read_text()):
   z=np.load(STUDY/'source'/rec['layers'])
   if surface and family=='barred':
    # The generated cut-out has coarse 5--8 mm forks as well as fine barbs.
    # Compress those forks to a short fringe, resampling every field together.
    # Otherwise a correctly measured cream core colours only separate teeth.
    z={key:z[key] for key in z.files};a=z['alpha'];yy,xx=np.indices(a.shape,dtype=float)
    ys,xs=np.where(a>=.5);tip=np.max(np.where(a>=.5,yy,-1),axis=0);valid=tip>=0
    tip=np.interp(np.arange(len(tip)),np.flatnonzero(valid),tip[valid])
    movement=.82*(gaussian_filter(tip,12)-tip)
    terminal=smooth(((yy-ys.min())/(ys.max()-ys.min())-.55)/.35)
    xy=np.array([yy-movement[None,:]*terminal,xx])
    z={key:map_coordinates(value.astype(float),xy,order=1,mode='nearest',prefilter=False) for key,value in z.items()}
    a=z['alpha'];edge=np.zeros(a.shape,bool)
    for x in np.flatnonzero(np.any(a>=.5,axis=0)):
     edge[np.flatnonzero(a[:,x]>=.5)[-1],x]=True
    z['free_edge_distance_mm']=distance_transform_edt(~edge,sampling=rec['pixel_mm'][::-1])
   a=z['alpha'];ys,xs=np.where(a>=.5)
   el=dict(alpha=a,h=z['height_mm'],p=z['pigment_linear'],r=z['roughness'],
     bar=z['bar_generated'].astype(float) if 'bar_generated' in z else np.zeros_like(a),
     warmth=z['warmth'] if 'warmth' in z else np.zeros_like(a),shaft=z['shaft'],bbox=[xs.min(),ys.min(),xs.max()+1,ys.max()+1],id=rec['id'])
   if surface:
    yy,xx=np.indices(a.shape,dtype=float);v=(yy-ys.min())/(ys.max()-ys.min());u=(xx-xs.min())/(xs.max()-xs.min())
    dist=distance_transform_edt(a>=.5)*rec['pixel_mm'][0]
    if family=='plain':
     # Remove the source's dark perimeter from pigment, preserving the fine
     # generated barb drawing. Only the recessed overlap owns a shadow.
     low=gaussian_filter(el['p'],4)
     # Retain the generated fine barbs, not the broad perimeter value. The
     # intrinsic value rises toward the terminal vane only, never its sides.
     el['p']=.5+.90*(el['p']-low)+.13*(v-.5)+.02*smooth((v-.70)/.25)
     el['p']+=.010*np.exp(-dist/1.5)*smooth((v-.65)/.2)
     el['shaft_drawing']=np.maximum(el['p']-gaussian_filter(el['p'],(0,6)),0)*smooth(z['shaft']/.35)
     # The previous distance-to-outline dome made a rim round the entire vane.
     # Keep a shallow longitudinal lift and the original fine barb relief.
     fine=(el['h']-gaussian_filter(el['h'],2.2))*(1-.9*z['shaft'])
     el['h']=.59+.40*v+.06*np.maximum(1-(2*u-1)**2,0)+.004*z['shaft']+.26*fine
    else:
     # Fill the actual terminal vanes, measured from each column's generated
     # fringe. Only the rootward end of the brush breaks into drawn strands.
     # This is a distance down the feather, not a rim around its side edges.
     lateral=abs(2*u-1);central=1-smooth(lateral/.82)
     tip=np.max(np.where(a>=.5,yy,-1),axis=0)
     tip=gaussian_filter(tip,1.0)
     terminal=(tip[None,:]-yy)*59/(ys.max()-ys.min())
     edge=z['free_edge_distance_mm']*59/rec['length_mm']
     # Between the central shaft and side barbs the free edge is oblique.
     # Measure across that edge as well as down the vane, so the solid part
     # fills the brush instead of becoming thin lines on each long barb.
     distance=np.maximum(np.minimum(edge,terminal),terminal*central)
     # Each pale end is deepest at its shaft and dies away along the side
     # barbs. The grey shoulders separate neighbouring terminal brushes.
     core_mm=2.0+3.8*central
     core=smooth((core_mm-distance)/1.1+.5)
     drawn=smooth((el['warmth']+1.0)/19.0)
     reach=3.0+(6.6+.20*(len(result[family])%4))*central
     strands=drawn*.80*smooth((reach-terminal)/2.6)
     # Retain the generated comb at the inner boundary and the real alpha
     # fringe outside it. Cream does not climb the vertical sides of a vane.
     gate=smooth((v-.61)/.10)*(1-smooth((lateral-.78)/.20))
     el['bar']=np.maximum(core,strands)*gate
     el['terminal_scale']=1.0
     reach_mm=brush_profile(el)['reach_mm']
     el['terminal_scale']=float(np.clip((9.0+.25*(len(result[family])%4))/max(reach_mm,1),.82,1.15))
     # Keep that accepted physical warp and its old mask for the original
     # value normalization. Only the final pigment coverage changes below.
     # The generated vane supplies coherent light/dark barbs, including those
     # inside the ivory end; its high-frequency drawing has no broad light.
     detail=gaussian_filter(el['p'],.65)-gaussian_filter(el['p'],3.2)
     strands_detail=np.tanh(detail/.028)
     # Millimetres along the feather, AFTER its accepted terminal warp.
     # Distance to the nearest edge made a rim/crescent and the former source
     # coverage measure overstated how much survived in the binary atlas.
     depth=terminal*el['terminal_scale']
     # A broad central brush, narrowing only toward the shoulder barbs. A
     # sharp power taper made a deep but needle-thin centre and lost the
     # filled feather-tip mass between the shaft and the narrow side ends.
     point=1-smooth((lateral-.16)/.67)
     solid=1.7+2.8*point
     transition=.55+5.35*point
     t=np.clip((depth-solid)/transition,0,1)
     # The outer colour edge inherits the generated alpha fringe as coverage;
     # thresholding alpha at its opaque core would leave a hard pale cutout.
     fringe=np.clip(gaussian_filter((a>=.5).astype(float),2)/.98,0,1)
     el['tip_bar']=(1-t)*gate*fringe
     el['tip_depth_mm']=depth
     # Follow the actual generated barb flow. Average intrinsic fine drawing
     # along its local tangent, not across it, to make connected strands with
     # different rootward ends. A percentile threshold spends the entire
     # transition on a gradual density change, including its faint inner end.
     gy,gx=np.gradient(gaussian_filter(el['p'],.8))
     angle=.5*np.arctan2(2*gaussian_filter(gx*gy,3),
                        gaussian_filter(gx*gx-gy*gy,3))
     tx=-np.sin(angle);ty=np.cos(angle)
     # Fine transverse variation resolves as individual barb ends at 2048.
     # Its tangent is measured from the source, so the pattern bends with the
     # vanes instead of aligning to atlas rows or becoming isotropic speckle.
     noise=gaussian_filter(np.random.default_rng(SEED+len(result[family])).normal(size=a.shape),.75)
     noise=noise/max(float(noise.std()),1e-8)
     strand_seed=.8*noise+.2*strands_detail
     fibres=np.zeros_like(detail);weight=0.
     for step in range(-16,17,2):
      w=np.exp(-.5*(step/8)**2)
      fibres+=w*map_coordinates(strand_seed,[yy+step*ty,xx+step*tx],order=1,mode='nearest')
      weight+=w
     fibres/=weight
     scale=np.sqrt(gaussian_filter(fibres*fibres,12)+1e-7)
     fibres=np.tanh(fibres/scale)
     sample=np.sort(fibres[(a>.7)&(v>.55)])
     el['tip_threshold']=np.interp(fibres,sample,(np.arange(len(sample))+.5)/len(sample))
     el['tip_detail']=strands_detail
     # Restore only the fine vane relief that the study removed in its pale
     # pigment. Continue it through the colour boundary into adjacent grey;
     # there is no height step at the new region edge.
     el['tip_relief']=.035*strands_detail*smooth((11-distance)/4)*gate
     fine=(el['h']-gaussian_filter(el['h'],2.2))*(1-.9*z['shaft'])
     # Pigment never adds relief: the entire vane uses the same soft rise.
     el['h']=.59+.22*v+.025*np.maximum(1-(2*u-1)**2,0)+.004*z['shaft']+.24*fine
    el['soft_alpha']=gaussian_filter(a,18.0)
    el['pigment_alpha']=a*.55+gaussian_filter(a,4)*.45
   result[family].append(el)
 result['down']=[]
 for i in range(12):
  z=np.load(TROUSERS/f'source/feather_{i+1:02d}_layers.npz');v=np.load(TROUSERS/f'source/tile_volume/feather_{i+1:02d}_volume.npz')
  a=v['alpha'];ys,xs=np.where(a>=.5)
  result['down'].append(dict(alpha=a,h=.5+v['volume_mm']*.5,p=z['base_linear'],r=z['roughness'],
   bar=np.zeros_like(a),warmth=np.zeros_like(a),bbox=[xs.min(),ys.min(),xs.max()+1,ys.max()+1],id=f'down_{i+1:02d}'))
 return result

def geometry():
 meta=json.loads((PAINT/'pieces.json').read_text());pieces=np.asarray(Image.open(PAINT/'pieces.png'))[...,0]
 pos=[]
 for i,c in enumerate('xyz'):
  q=np.asarray(Image.open(PAINT/f'position_{c}.png')).astype(np.float64)/65535
  pos.append((meta['position_box']['min'][i]+q*(meta['position_box']['max'][i]-meta['position_box']['min'][i]))*1000)
 pos=np.stack(pos,-1)
 raw=np.asarray(Image.open(BAKES/'dodo_feather_direction.png'),float)/255
 flow=np.stack([2*raw[...,0]-1,1-2*raw[...,1]],-1)
 return meta,pieces,pos,flow

def piece_geometry(rec,pieces,pos,flow):
 x0,y0,x1,y1=rec['box'];sl=np.s_[y0:y1,x0:x1];own=pieces[sl]==rec['number'];P=pos[sl];coords=np.argwhere(own)
 # Derivatives use only same-piece neighbours, including the newly rebaked edges.
 js=[]
 for axis in [1,0]:
  plus=np.roll(own,-1,axis)&own;minus=np.roll(own,1,axis)&own
  dp=np.roll(P,-1,axis)-P;dm=P-np.roll(P,1,axis)
  j=np.where((plus&minus)[...,None],(dp+dm)*.5,np.where(plus[...,None],dp,dm))
  js.append(gaussian_filter(extend(j,own&(plus|minus)),(1,1,0)))
 jx,jy=js;F=flow[sl];D=norm(jx*F[...,:1]+jy*F[...,1:]);n=norm(np.cross(jx,jy));E=norm(np.cross(D,n))
 # Surface frames are indexed by exact owned texels. Right half is implicit mirror.
 return dict(rec=rec,sl=sl,own=own,coords=coords,P=P[own],D=D[own],E=E[own],n=n[own],tree=cKDTree(P[own]),jx=jx,jy=jy)

def stations(g,rng):
 P=g['P'];name=g['rec']['name'];out=[]
 if name=='shell_body':
  tail=np.array([0.,243.,-260.]);radial=np.linalg.norm(P-tail,axis=-1)
  # One scalar coordinate for every row: disjoint level sets cannot cross or
  # double back into an M. Neck spacing changes continuously in this field.
  levels=np.r_[np.arange(57.,BAR_LEVELS[0]-10,32.),BAR_LEVELS,np.arange(377.,762.,32.)]
  body_order=radial-.35*P[:,0]
  neck_order=530+1.6*(P[:,1]-420)
  neck_blend=smooth((P[:,1]-385+.7*(P[:,2]-100))/100)
  order=body_order*(1-neck_blend)+neck_order*neck_blend
  for row,level in enumerate(levels):
   candidates=np.flatnonzero(abs(order-level)<1.4)
   if len(candidates)<20:continue
   # Geodesic distance along the narrow iso-row strip replaces angular bins.
   # Those bins switched between front/back branches on the neck and produced
   # the stepped join and crowded duplicate placements.
   _,ix=np.unique(np.floor(P[candidates]/1.8).astype(int),axis=0,return_index=True)
   curve=candidates[ix];Q=P[curve];dist,neighbours=cKDTree(Q).query(Q,k=min(12,len(Q)))
   rr=np.repeat(np.arange(len(Q)),dist.shape[1]);cc=neighbours.ravel();dd=dist.ravel();ok=(dd>0)&(dd<5.5)
   graph=coo_matrix((dd[ok],(rr[ok],cc[ok])),shape=(len(Q),len(Q))).tocsr()
   ends=np.flatnonzero(Q[:,0]<3);start=int(ends[np.argmin(Q[ends,2])]) if len(ends) else int(Q[:,0].argmin())
   ds=dijkstra(graph,directed=False,indices=start)
   ix=np.argsort(ds);ix=ix[np.isfinite(ds[ix])];curve=curve[ix];ds=ds[ix]
   if len(ds)<2:continue
   at=0.;col=0
   while at<ds[-1]:
    k=curve[np.argmin(abs(ds-at))];p=P[k];neck=smooth((p[1]-385)/65)
    down=smooth((230-p[1])/60)*smooth((p[0]-35)/45)
    barred=bool(np.min(abs(BAR_LEVELS-level))<.1 and p[1]>260 and p[2]<120)
    family='barred' if barred else ('down' if rng.random()<down*.88 else 'plain')
    width=(52-23*neck) if family!='down' else rng.uniform(31,40)
    length=(59-27*neck) if family!='down' else rng.uniform(66,84)
    angle=0 if col==0 else rng.uniform(-.085,.085)
    # A shallow rearward V is centred at the midline, embedded in row placement.
    shift=rng.uniform(-1.8,1.8)
    centre=p-g['D'][k]*shift
    if col==0:centre=centre.copy();centre[0]=0
    out.append(dict(k=int(k),centre=centre,width=width*rng.uniform(.94,1.05),length=length*rng.uniform(.96,1.05),angle=angle,family=family,
      source=int((row*7+col*5+rng.integers(4))%(12 if family=='down' else 16)),row=row,level=float(level),col=col,mirror=col==0))
    spacing=(27 if barred else 36)-17*neck
    if family=='down':spacing=26
    at+=spacing*rng.uniform(.88,1.12);col+=1
 else:
  # A plane in the wing's own space; centres still sampled from the live bakes.
  d=norm(np.median(g['D'],axis=0));e=norm(np.median(g['E'],axis=0));q=np.sum(P*d,-1);u=np.sum(P*e,-1)
  short=name!='wing_l_out';pitch=14 if short else 22
  for row,v in enumerate(np.arange(q.min()-8,q.max()+pitch,pitch)):
   for col,w in enumerate(np.arange(u.min()-8,u.max()+pitch,18 if short else 27)):
    target=np.array([w+((row%2)*9),v]);err=(u-target[0])**2+(q-target[1])**2;k=int(err.argmin())
    if err[k]>pitch**2*.8:continue
    leading=smooth((q.max()-q[k])/(max(np.ptp(q),1)))
    width=24 if short else 38-10*leading;length=29 if short else 47-12*leading
    out.append(dict(k=k,centre=P[k],width=width*rng.uniform(.88,1.10),length=length*rng.uniform(.93,1.10),angle=rng.uniform(-.12,.12),family='down' if name=='wing_l_in' else 'plain',source=int((row*5+col*3)%(12 if name=='wing_l_in' else 16)),row=row,level=-float(v),col=col,mirror=False))
 return sorted(out,key=lambda s:(s['level'],-s['col']))

def separate_barred_tips(stamps,g):
 """Space whole barred feathers at their exposed width, leaving plain rows fixed.

 The earlier 27 mm pitch overlapped 52 mm vanes so much that their tips became
 one ribbon. Reparameterize only these five contours after the original RNG
 sequence and recessed bed have been consumed. No plain station changes.
 """
 out=[s for s in stamps if s['family']!='barred']
 for row in sorted({s['row'] for s in stamps if s['family']=='barred'}):
  old=sorted([s for s in stamps if s['family']=='barred' and s['row']==row],key=lambda s:s['col'])
  centres=np.array([s['centre'] for s in old]);arc=np.r_[0,np.cumsum(np.linalg.norm(np.diff(centres,axis=0),axis=1))]
  for col,at in enumerate(np.arange(0,arc[-1]+1,37.0)):
   q=np.array([np.interp(at,arc,centres[:,axis]) for axis in range(3)])
   s=dict(old[int(np.argmin(abs(arc-at)))]);k=int(g['tree'].query(q)[1])
   s.update(k=k,centre=g['P'][k].copy(),col=col,mirror=col==0)
   if col==0:s.update(k=old[0]['k'],centre=old[0]['centre'].copy())
   s['tip_width_mm']=float(s['width']*.85)
   out.append(s)
 return sorted(out,key=lambda s:(s['level'],-s['col']))

def stamp(g,c,s,source,under=False,stamp_id=-1):
 k=s['k'];D=g['D'][k];E=g['E'][k];angle=s['angle'];d=D*np.cos(angle)+E*np.sin(angle);e=E*np.cos(angle)-D*np.sin(angle)
 p=s['centre'];W=s['width'];H=s['length'];ids=np.array(g['tree'].query_ball_point(p,np.hypot(W,H)*.63),int)
 if not len(ids):return
 delta=g['P'][ids]-p;u=np.sum(delta*e,-1)/W+.5;v=np.sum(delta*d,-1)/H+.5
 if s['mirror']:u=.5+abs(u-.5)
 if s['family']=='barred' and not under:
  # Calibrate the drawn terminal brush to 8--10 mm at its shaft. Alpha,
  # pigment, relief and strands receive the same physical resampling.
  factor=source['terminal_scale'];start=1-.4*factor
  v=np.where(v<start,v*(.60/start),.60+(v-start)/factor)
 # Stamp both sides of mirror-crossing feathers consistently in the half atlas.
 bx=source['bbox'];xy=np.stack([bx[1]+v*(bx[3]-bx[1]),bx[0]+u*(bx[2]-bx[0])])
 a=map_coordinates(source['alpha'],xy,order=1,mode='constant',cval=0,prefilter=False)
 a*=((u>=0)&(u<=1)&(v>=0)&(v<=1))*(np.abs(np.sum(delta*g['n'][k],-1))<max(8,W*.32))
 if not np.any(a):return
 is_inner=g['rec']['name']=='wing_l_in'
 for j,key in enumerate(['h','p','r']):
  z=map_coordinates(source[key],xy,order=1,mode='nearest',prefilter=False)
  if key=='h':
   z=.45+(z-.45)*(.45 if is_inner else (.60 if under else .58))
   if s['family']=='plain' or under:
    neck=smooth((g['P'][ids,1]-385)/65)
    z=.6+(z-.6)*(1-.50*neck)
  if key=='p':
   z=.5+(z-.5)*(.62 if is_inner else 1.0)+(0.018 if is_inner else 0)
   if s['family']=='plain' or under:
    neck=smooth((g['P'][ids,1]-385)/65)
    shaft=map_coordinates(source['shaft'],xy,order=1,mode='nearest',prefilter=False)
    z-=.060*shaft*(.35+.65*neck)
    if 'shaft_drawing' in source:
     shaft_draw=map_coordinates(source['shaft_drawing'],xy,order=1,mode='nearest',prefilter=False)
     z-=shaft_draw*(.45+.45*neck)
    z=.5+(z-.5)*(1-.20*neck)
  blend=a
  if key=='h' and 'soft_alpha' in source:
   blend=map_coordinates(source['soft_alpha'],xy,order=1,mode='constant',cval=0,prefilter=False)
   blend*=((u>=0)&(u<=1)&(v>=0)&(v<=1))*(np.abs(np.sum(delta*g['n'][k],-1))<max(8,W*.32))
  if key=='p' and 'pigment_alpha' in source:
   blend=map_coordinates(source['pigment_alpha'],xy,order=1,mode='constant',cval=0,prefilter=False)
   blend*=((u>=0)&(u<=1)&(v>=0)&(v<=1))*(np.abs(np.sum(delta*g['n'][k],-1))<max(8,W*.32))
  c[j,ids]=c[j,ids]*(1-blend)+z*blend
 dest=g['coords'][ids]
 alpha_threshold=((dest[:,0]*131+dest[:,1]*61+(dest[:,0]^dest[:,1])*17)%251+.5)/251
 # Interior vanes are opaque. Retain fractional coverage only through their
 # loose fringe; otherwise dithering would punch grey holes in solid cream.
 take=a>(.5*alpha_threshold)
 prob=map_coordinates(source['bar'],xy,order=1,mode='nearest',prefilter=False)
 new_bar=np.zeros(len(ids),bool);detail=np.zeros(len(ids));relief=np.zeros(len(ids))
 if s['family']=='barred' and not under:
  # Shrink each terminal brush about its own shaft down the flank. This opens
  # increasing grey gaps between tips instead of fading a continuous stripe.
  flank=max(float(smooth((p[0]-88)/43)),float(smooth((342-p[1])/53)))
  tip_span=.90*(1-.72*flank)
  prob*=1-smooth((abs(2*u-1)-(tip_span-.10))/.10)
  prob*=1-smooth((flank-.78)/.22)
  # A deterministic coverage quantizer preserves pure ring colours; game mips
  # integrate these sub-strand samples into the original soft pigment fade.
  threshold=((dest[:,0]*73+dest[:,1]*151+(dest[:,0]^dest[:,1])*37)%251+.5)/251
  bar=prob>threshold
  tip_prob=map_coordinates(source['tip_bar'],xy,order=1,mode='nearest',prefilter=False)
  tip_prob*=1-smooth((abs(2*u-1)-(tip_span-.10))/.10)
  tip_prob*=1-smooth((flank-.78)/.22)
  detail=map_coordinates(source['tip_detail'],xy,order=1,mode='nearest',prefilter=False)
  # The inner ends break along the generated fibres themselves, not a UV
  # noise pattern. Dark barb gaps end early; pale ridges reach farther in.
  fibre_threshold=map_coordinates(source['tip_threshold'],xy,order=1,mode='nearest',prefilter=False)
  # Bilinear resampling otherwise squeezes threshold values toward 0.5,
  # collapsing the soft six-millimetre dissolve into a hard short boundary.
  fibre_threshold=np.clip(.5+1.65*(fibre_threshold-.5),.015,.985)
  new_bar=tip_prob>fibre_threshold
  relief=.58*map_coordinates(source['tip_relief'],xy,order=1,mode='nearest',prefilter=False)
  # A weak strand is less bright than the solid terminal vane even before
  # mip filtering combines its sparse cream coverage with the body dye.
  c[1,ids[take&bar]]-=.065*(1-prob[take&bar])
 else:bar=np.zeros(len(ids),bool)
 c[3,ids[take]]=bar[take];c[4,ids]=1-(1-c[4,ids])*(1-a)
 c[5,ids[take]]=s['row'] if s['family']=='barred' else -1
 c[6,ids[take]]=new_bar[take];c[7,ids[take]]=detail[take]
 c[8,ids]=c[8,ids]*(1-a)+relief*a
 if not under:
  c[9,ids[take]]=stamp_id
  c[10,ids[take]]=u[take]
  c[11,ids[take]]=map_coordinates(source.get('tip_depth_mm',np.zeros_like(source['alpha'])),xy[:,take],order=1,mode='nearest')*H/59
  c[12,ids[take]]=tip_prob[take] if s['family']=='barred' else 0

def build():
 start=time.time();OUT.mkdir(exist_ok=True);QA.mkdir(exist_ok=True)
 src=fields();meta,pieces,pos,flow=geometry();own=np.zeros((N,N),bool)
 p=np.full((N,N),.5,np.float32);h=np.full((N,N),.6,np.float32);rough=np.full((N,N),.91,np.float32);bar=np.zeros((N,N),bool)
 rows=np.full((N,N),-1,np.int16);coverage=np.zeros((N,N));placement=[];stats={}
 new_bar=np.zeros((N,N),bool);tip_detail=np.zeros((N,N),np.float32);tip_relief=np.zeros((N,N),np.float32)
 owners=np.full((N,N),-1,np.int16);tip_u=np.zeros((N,N),np.float32);tip_depth=np.zeros((N,N),np.float32);tip_density=np.zeros((N,N),np.float32)
 rng=np.random.default_rng(SEED)
 for rec in meta['pieces']:
  if rec['name'] not in ['shell_body','wing_l_out','wing_l_in','shoulder_l']:continue
  g=piece_geometry(rec,pieces,pos,flow);count=len(g['P']);c=np.zeros((13,count),np.float32);c[0]=.6;c[1]=.5;c[2]=.91;c[5]=-1;c[9]=-1
  stamps=stations(g,rng)
  # Offset recessed feather bed covers holes without inventing flat patches.
  for s in stamps:
   z=dict(s);z['centre']=s['centre']+g['E'][s['k']]*s['width']*.3+g['D'][s['k']]*s['length']*.28
   stamp(g,c,z,src['plain'][(s['source']+7)%16],True)
  # Fill the recessed bed at chart ends and tight folds before the final rows.
  for j in range(180):
   gaps=np.flatnonzero(c[4]<.7)
   if not len(gaps):break
   k=int(gaps[(j*7919)%len(gaps)])
   neck=smooth((g['P'][k,1]-385)/65)
   fill=dict(k=k,centre=g['P'][k],width=42-18*neck,length=50-21*neck,angle=0.,family='plain',source=j%16,row=-1,level=0,col=1,mirror=g['P'][k,0]<1)
   stamp(g,c,fill,src['plain'][j%16],True)
  stamps=separate_barred_tips(stamps,g)
  for i,s in enumerate(stamps):stamp(g,c,s,src[s['family']][s['source']],stamp_id=len(placement)+i)
  sl=g['sl'];m=g['own'];own[sl]|=m
  # Calm shared region joins over 1 mm; leave the mirror seam patterned.
  # Height filtering is confined to this piece, never another group.
  full=[]
  for v in c[:3]:
   a=np.zeros(m.shape,np.float32);a[m]=v;full.append(extend(a,m))
  hh=gaussian_filter(full[0],.70);pp=full[1];rr=full[2]
  rim=(distance_transform_edt(m)<1.5)&m
  rim[m] &= g['P'][:,0]>3
  if rim.any():
   Pfull=pos[sl];near=cKDTree(Pfull[rim]).query(g['P'],workers=1)[0];w=smooth(near/2)
   hh[m]=.6+(hh[m]-.6)*w;pp[m]=.5+(pp[m]-.5)*w
  h[sl][m]=hh[m];p[sl][m]=pp[m];rough[sl][m]=rr[m];bar[sl][m]=c[3]>.5;coverage[sl][m]=c[4];rows[sl][m]=c[5]
  new_bar[sl][m]=c[6]>.5;tip_detail[sl][m]=c[7]
  owners[sl][m]=c[9];tip_u[sl][m]=c[10];tip_depth[sl][m]=c[11];tip_density[sl][m]=c[12]
  micro=np.zeros(m.shape,np.float32);micro[m]=c[8]
  tip_relief[sl][m]=gaussian_filter(extend(micro,m),.70)[m]
  if rim.any():tip_relief[sl][m]*=w
  stats[rec['name']]=dict(texels=count,placements=len(stamps),coverage_below_half=float(np.mean(c[4]<.5)),height_mm=[float(c[0].min()),float(c[0].max())])
  placement += [dict(piece=rec['name'],**{k:(v.tolist() if isinstance(v,np.ndarray) else v) for k,v in s.items() if k!='k'}) for s in stamps]
  print(rec['name'],stats[rec['name']],flush=True)
 # Correct only broad placement bias across the height of the bird. Local
 # feather shafts, pigment gradients and barb contrast are retained.
 bins=np.arange(80,641,50);offset=[]
 for y in bins:
  m=own&~bar&(abs(pos[...,1]-y)<40)
  offset.append(.5-p[m].mean() if m.sum()>100 else 0.)
 correction=np.interp(pos[...,1],bins,np.clip(offset,-.035,.035))
 p[own&~bar]+=correction[own&~bar]
 # Remove the fitted tangent-light component introduced by rearranging the
 # source vanes. This is regression, not a blur of the original drawing.
 mm=np.asarray(Image.open(PAINT/'texel_mm.png'),np.float32)/1000
 grad=[]
 for ax in [1,0]:
  a=np.roll(h,-1,ax);b=np.roll(h,1,ax);pa=np.roll(pieces,-1,ax)==pieces;pb=np.roll(pieces,1,ax)==pieces
  grad.append(np.where(pa&pb,(a-b)/2,np.where(pa,a-h,np.where(pb,h-b,0)))/np.maximum(mm,.001))
 n=norm(np.stack([-grad[0],grad[1],np.ones_like(h)],-1));centred=n.copy()
 for m in [own&~bar,own&bar]:
  if m.any():centred[m]-=centred[m].mean(axis=0)
 X=centred[own][::5,:2].astype(float);Y=p[own][::5].astype(float)
 # A fitted Z term manufactures a pale centre and dark sloping perimeter.
 # Remove directional light (X/Y) only; the neutral vane has no such rim.
 coefficients=np.r_[np.linalg.lstsq(X,Y-Y.mean(),rcond=None)[0],0.]
 p[own]-=np.sum(centred[own]*coefficients,-1)
 for rec in meta['pieces']:
  if rec['name'] in stats:
   for region in [False,True]:
    m=(pieces==rec['number'])&(bar==region)
    if m.any():p[m]+=.5-p[m].mean()
 # Preserve intrinsic detail, centre mean separately in each region after placement.
 for m in [own&~bar,own&bar]:
  if m.any():p[m]+=.5-p[m].mean()
 # Retain 90% of value contrast after placement; allow quantization headroom
 # under the two-percent broad-value limit without changing the fine drawing.
 p[own]=.5+(p[own]-.5)*.90
 # Cream dye should remain cream. The generated brush has large value peaks;
 # compress only the pale region, preserving its fine drawing and 0.50 mean.
 # The upper tail is bounded, so ordinary barbs cannot turn nearly white.
 muted=.5+.045*np.tanh((p[bar]-.5)/.13)
 muted+=.5-muted.mean();p[bar]=muted
 # Apply the strand treatment after the accepted normalization, so the
 # plain plumage's delivered values remain exactly as before. The cream
 # keeps the same mean and bounded range, now spent on coherent barb detail.
 old_bar=bar.copy();bar=new_bar
 signal=tip_detail[bar]+.16*np.tanh((p[bar]-.5)/.025)
 order=np.argsort(signal,kind='stable')
 # Redistribute the accepted cream histogram along the generated barb
 # drawing: preserve its values, including its restrained brightest ends.
 reference=np.sort(muted)
 values=np.interp((np.arange(len(signal))+.5)/len(signal),
                  (np.arange(len(reference))+.5)/len(reference),reference)
 cream=np.empty_like(signal);cream[order]=values;p[bar]=cream
 h[own]+=tip_relief[own]
 ao=np.ones((N,N),np.float32)
 for rec in meta['pieces']:
  if rec['name'] not in stats:continue
  m=pieces==rec['number'];hh=extend(h,m);rise=np.maximum(gaussian_filter(hh,4)-hh,0)
  ao[m]=np.clip(1-rise[m]*.04,.98,1)
 base=np.dstack([np.repeat(srgb(p)[...,None],3,-1),own.astype(float)]);base[~own,:3]=0
 regions=np.zeros((N,N,3),np.float32);regions[own,0]=1;regions[bar,1]=1
 save('dodo_base.png',base,colour=True);save('dodo_height.png',h*own/HEIGHT_MM,16);save('dodo_rough.png',rough*own);save('dodo_occlusion.png',ao*own);save('dodo_regions.png',regions)
 cards_stats=cards(src)
 hashes={str(f.relative_to(DODO)):hashlib.sha256(f.read_bytes()).hexdigest() for f in [PAINT/n for n in ['pieces.json','pieces.png','position_x.png','position_y.png','position_z.png','texel_mm.png']]+[BAKES/'dodo_feather_direction.png',STUDY/'source/generated_atlas_round2.png',STUDY/'source/generated_barred_atlas_round5_beards.png',STUDY/'barred_sources.py',STUDY/'plain_sources.py',ROOT/'paint.py']}
 report=dict(height_mm=HEIGHT_MM,cards_height_mm=HEIGHT_MM,seed=SEED,light_removal_coefficients=coefficients.tolist(),position_correction='Left side x positive, no reflection. Expanded corrected position_box read every build.',bar_row_levels_mm=BAR_LEVELS.tolist(),stats=stats,cards=cards_stats,inputs=hashes)
 (OUT/'layers.json').write_text(json.dumps(report,indent=2)+'\n');(QA/'placements.json').write_text(json.dumps(placement,indent=2)+'\n')
 np.savez_compressed(QA/'ownership.npz',rows=rows,coverage=coverage,previous_bar=old_bar,tip_relief=tip_relief,feather=owners,tip_u=tip_u,tip_depth_mm=tip_depth,tip_density=tip_density)
 print('Paint finished',round(time.time()-start,2),'seconds',flush=True)

def cards(src):
 spec=json.loads((PAINT/'pieces.json').read_text())['cards']['body']
 u0,v0,u1,v1=spec['rect'];span_w,span_h=spec['card_mm'];quarter_mm=span_w/4
 x0,x1=round(u0*N),round(u1*N);y0,y1=round((1-v1)*N),round((1-v0)*N);H=y1-y0;W=x1-x0
 # The modeller's live dimensions supersede the earlier nominal 100 mm strip.
 # Keep feathers in millimetres; quarter centres follow the measured width.
 a=np.zeros((H,W));h=np.full((H,W),.5);p=np.full((H,W),.5);r=np.full((H,W),.91)
 yy,xx=np.indices((H,W),dtype=float);rng=np.random.default_rng(SEED+31)
 for quarter in range(4):
  for j in range(2):
   el=src['plain'][(quarter*4+j*3)%16];b=el['bbox'];width=[14,14][j]*rng.uniform(.94,1.02);length=rng.uniform(37,43)
   cx=(quarter+[7.3/25,17.7/25][j])*quarter_mm;tip=[28.5,31][j]+rng.uniform(-1,1)
   u=(xx/W*span_w-cx)/width+.5;v=(yy/H*span_h-(tip-length))/length
   coords=np.stack([b[1]+v*(b[3]-b[1]),b[0]+u*(b[2]-b[0])])
   alpha=map_coordinates(el['alpha'],coords,order=1,mode='constant',cval=0,prefilter=False)
   alpha*=((xx>=quarter*W/4+5)&(xx<(quarter+1)*W/4-5)&(u>=0)&(u<=1)&(v>=0)&(v<=1))
   for dest,key in [(h,'h'),(p,'p'),(r,'r')]:
    val=map_coordinates(el[key],coords,order=1,mode='nearest',prefilter=False);dest[:]=dest*(1-alpha)+val*alpha
   a=1-(1-a)*(1-alpha)
 # Buried roots blend into the surface. Only loose terminal vanes remain
 # opaque, so plain cards cannot mask a cream row with rectangular grey roots.
 a*=smooth((yy/H-.69)/.20)
 valid=a>=.5;p[valid]+=.5-p[valid].mean();p=extend(p,valid)
 dist=distance_transform_edt(~valid);fade=smooth((10-dist)/6);h=.5+(extend(h,valid)-.5)*fade*.09;h=gaussian_filter(h,.7)
 # Flat quiet borders and per-quarter gutters. Colour alone is extended.
 h[dist>12]=.5
 base=np.zeros((N,N,4));base[y0:y1,x0:x1,:3]=srgb(p)[...,None];base[y0:y1,x0:x1,3]=a
 full=np.zeros((N,N));full[y0:y1,x0:x1]=h/HEIGHT_MM;save('cards_height.png',full,16)
 full[:]=0;full[y0:y1,x0:x1]=r;save('cards_rough.png',full)
 full[:]=0;full[y0:y1,x0:x1]=1;save('cards_occlusion.png',full)
 rg=np.zeros((N,N,3));rg[y0:y1,x0:x1,0]=1;save('cards_regions.png',rg);save('cards_base.png',base,colour=True)
 return dict(box=[x0,y0,x1,y1],physical_strip_mm=spec['card_mm'],mm_per_texel=spec['mm_per_texel'],quarter_mm=quarter_mm,feathers_per_quarter=2,plain=True,alpha_coverage=float(valid.mean()))
if __name__=='__main__':build()
