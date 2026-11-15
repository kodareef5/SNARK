"""Read-only neck subset of the neighbouring body painter's round-4 recipe.

Copied to keep this build reproducible while the other painting is revised.
Only accepted plain body sources are loaded; no outputs or cached checks.
Source paint.py SHA-256: d73dcde869545228d976dda395c1427f7d73f7f76bfa5b8c139a33ae958046db
"""
from pathlib import Path
import json
import numpy as np
from scipy.ndimage import gaussian_filter,distance_transform_edt,map_coordinates
from scipy.spatial import cKDTree
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
ROOT=Path(__file__).resolve().parent;DODO=ROOT.parents[2]
STUDY=DODO/'tex/studies/body';SEED=551237
BAR_LEVELS=np.linspace(191.,345.,5)
def smooth(a):
 a=np.clip(a,0,1);return a*a*(3-2*a)

def norm(a):return a/np.maximum(np.linalg.norm(a,axis=-1,keepdims=True),1e-9)

def brush_depth(el,factor=1.,u=.5):
 """Equivalent covered length through the generated brush at a 59 mm vane."""
 b=el['bbox'];v=np.linspace(0,1,1024);start=1-.4*factor
 iv=np.where(v<start,v*.6/start,.6+(v-start)/factor)
 xy=np.stack([b[1]+iv*(b[3]-b[1]),np.full(len(v),b[0]+u*(b[2]-b[0]))])
 q=map_coordinates(el['bar'],xy,order=1,mode='constant',cval=0)*map_coordinates(el['alpha'],xy,order=1,mode='constant',cval=0)
 return float(q.sum()*59/len(v))

def fields(surface=True):
 result={}
 for family,file in [('plain','elements.json')]:
  result[family]=[]
  for rec in json.loads((STUDY/'source'/file).read_text()):
   z=np.load(STUDY/'source'/rec['layers']);a=z['alpha'];ys,xs=np.where(a>=.5)
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
     el['p']=.5+.90*(el['p']-low)+.055*(v-.5)
     el['p']+=.010*np.exp(-dist/1.5)*smooth((v-.65)/.2)
     el['shaft_drawing']=np.maximum(el['p']-gaussian_filter(el['p'],(0,6)),0)*smooth(z['shaft']/.35)
     # The previous distance-to-outline dome made a rim round the entire vane.
     # Keep a shallow longitudinal lift and the original fine barb relief.
     fine=(el['h']-gaussian_filter(el['h'],2.2))*(1-.9*z['shaft'])
     el['h']=.59+.19*v+.025*np.maximum(1-(2*u-1)**2,0)+.004*z['shaft']+.26*fine
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
     core_mm=5.4+.4*central
     core=smooth((core_mm-distance)/1.1+.5)
     drawn=smooth((el['warmth']+1.0)/19.0)
     reach=7.0+(2.6+.20*(len(result[family])%4))*central
     strands=drawn*.80*smooth((reach-terminal)/2.6)
     # Retain the generated comb at the inner boundary and the real alpha
     # fringe outside it. Cream does not climb the vertical sides of a vane.
     gate=smooth((v-.61)/.10)*(1-smooth((lateral-.78)/.20))
     el['bar']=np.maximum(core,strands)*gate
     el['terminal_scale']=1.0
     reach_mm=brush_profile(el)['reach_mm']
     el['terminal_scale']=float(np.clip((9.0+.25*(len(result[family])%4))/max(reach_mm,1),.82,1.15))
     fine=(el['h']-gaussian_filter(el['h'],2.2))*(1-.9*z['shaft'])
     # Pigment never adds relief: the entire vane uses the same soft rise.
     el['h']=.59+.22*v+.025*np.maximum(1-(2*u-1)**2,0)+.004*z['shaft']+.24*fine
    el['soft_alpha']=gaussian_filter(a,18.0)
    el['pigment_alpha']=a*.55+gaussian_filter(a,4)*.45
   result[family].append(el)
 return result


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

def stamp(g,c,s,source,under=False):
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
  if key=='h':z=.45+(z-.45)*(.45 if is_inner else (.60 if under else .58))
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
 take=a>alpha_threshold
 prob=map_coordinates(source['bar'],xy,order=1,mode='nearest',prefilter=False)
 if s['family']=='barred' and not under:
  # Fade strand coverage down the flank, without a cut through a whole feather.
  P=g['P'][ids];fade=(1-smooth((P[:,0]-100)/45))*(1-smooth((330-P[:,1])/60))*(1-smooth((P[:,2]-60)/50))
  prob*=fade
  # A deterministic coverage quantizer preserves pure ring colours; game mips
  # integrate these sub-strand samples into the original soft pigment fade.
  threshold=((dest[:,0]*73+dest[:,1]*151+(dest[:,0]^dest[:,1])*37)%251+.5)/251
  bar=prob>threshold
  # A weak strand is less bright than the solid terminal vane even before
  # mip filtering combines its sparse cream coverage with the body dye.
  c[1,ids[take&bar]]-=.065*(1-prob[take&bar])
 else:bar=np.zeros(len(ids),bool)
 c[3,ids[take]]=bar[take];c[4,ids]=1-(1-c[4,ids])*(1-a)
 c[5,ids[take]]=s['row'] if s['family']=='barred' else -1
