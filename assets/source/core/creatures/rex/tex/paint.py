"""Paint the original Rex into its actual unwrapped triangles. No photographic input."""
from pathlib import Path
import json
import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt,gaussian_filter
HERE=Path(__file__).resolve().parent
OUT=HERE.parents[5]/'var/rex'
MESH=np.load(OUT/'layout.npz')
MATS=json.loads((OUT/'layout.json').read_text())['materials']
REGIONS=np.array([[255,0,0],[0,255,0],[0,0,255],[0,255,255],[255,0,255],[255,255,0],[0,0,0]],np.uint8)

def smooth(a,b,v):
 t=np.clip((v-a)/(b-a),0,1);return t*t*(3-2*t)
def noise(x,y,seed=0):
 ix,iy=np.floor(x),np.floor(y);fx,fy=smooth(0,1,x-ix),smooth(0,1,y-iy)
 def h(a,b):
  n=np.sin(a*127.1+b*311.7+seed*42.77)*43758.5453
  return (n-np.floor(n))*2-1
 return (h(ix,iy)*(1-fx)+h(ix+1,iy)*fx)*(1-fy)+(h(ix,iy+1)*(1-fx)+h(ix+1,iy+1)*fx)*fy
def scales(x,y):
 ix,iy=np.floor(x),np.floor(y);first=np.full(x.shape,8.);second=first.copy();identity=np.zeros_like(first)
 for i in (-1,0,1):
  for j in (-1,0,1):
   a=ix+i;b=iy+j
   f=np.sin(a*71.97+b*24.18)*8247.626;g=np.sin(a*104.31+b*36.57)*28741.75
   px=a+.22+.56*(f%1);py=b+.22+.56*(g%1)
   d=np.hypot(x-px,y-py);win=d<first
   second=np.where(win,first,np.minimum(d,second));first=np.minimum(first,d);identity=np.where(win,f%1,identity)
 return smooth(.025,.18,second-first)*(1-.25*smooth(.15,.68,first)),identity-.5

def raster(mat,size):
 pts=np.zeros((size,size,3),np.float32);used=np.zeros((size,size),bool)
 for tri,uv,mi in zip(MESH['triangles'],MESH['uvs'],MESH['materials']):
  if mi!=mat:continue
  uv=uv.copy()*size;uv[:,1]=size-uv[:,1]
  x0,y0=np.maximum(0,np.floor(uv.min(0)).astype(int));x1,y1=np.minimum(size,np.ceil(uv.max(0)).astype(int)+1)
  if x0>=x1 or y0>=y1:continue
  a,b,c=uv;det=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
  if abs(det)<1.e-7:continue
  y,x=np.mgrid[y0:y1,x0:x1];x=x+.5;y=y+.5
  wa=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/det
  wb=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/det;wc=1-wa-wb
  inside=(wa>=-.00005)&(wb>=-.00005)&(wc>=-.00005)
  p=MESH['points'][tri];pts[y0:y1,x0:x1][inside]=(p[0]*wa[...,None]+p[1]*wb[...,None]+p[2]*wc[...,None])[inside];used[y0:y1,x0:x1]|=inside
 index=distance_transform_edt(~used,return_distances=False,return_indices=True)
 return pts[index[0],index[1]],index

def maps(p,head):
 x,y,z=np.moveaxis(p,-1,0);y=y+.036;ax=abs(x)
 centre=np.interp(z,[-7.15,-6,-4,-2,-.8,.4,1.5,2.32,3.05,3.6,4.98],[1.51,1.63,2.25,2.98,3.09,3.03,3.08,3.33,3.64,3.72,3.68])
 radius=np.interp(z,[-7.15,-6,-4,-2,-.75,.4,1.5,2.45,3.35,4.98],[.02,.14,.34,.56,.85,.84,.59,.45,.49,.19])
 theta=np.arctan2(y-centre,ax);arc=theta*radius
 macro=noise(z*1.65,arc*2.1,12)*.6+noise(z*5.1,y*4.6,19)*.4
 # Small gathered groups of granular scales on the flank. Scales widen around
 # the brow and turn into transverse plates over the metatarsals.
 pitch=.018 if head else .029
 if head:
  u=(z+.008*noise(z*9,y*8,3))/pitch;v=(y+.20*ax+.004*macro)/(pitch*.70)
 else:
  u=(z+.22*ax+.009*macro)/pitch;v=(arc+.37*y+.006*macro)/(pitch*.81)
 dome,tone=scales(u,v)
 fold=np.zeros_like(x);lip=np.zeros_like(x)
 if head:
  for anchor,rise,reach in [(3.23,.40,1.0),(3.29,.24,.76),(3.34,.11,.72)]:
   cy=3.38+rise*np.exp(-((z-anchor)/.42)**2)+.025*(z-3.5)
   fold+=np.exp(-((y-cy)/.017)**2-((z-3.43)/reach)**4)
  lip=np.exp(-((y-(3.465+.025*np.sin((z-3.85)*4)))/.033)**2)*smooth(3.15,3.56,z)
 else:
  throat=np.exp(-((z-2.28)/.77)**2-((y-2.99)/.33)**2)
  fold+=throat*np.maximum(0,np.sin(z*33+y*15+.8*macro))**5
  fold+=np.exp(-((y-.94)/.30)**2)*np.maximum(0,np.cos(y*39+z*5+.5*macro))**3
 nape=smooth(.05,.78,theta)
 band=smooth(.00,.68,np.cos(z*3.85+y*2.5+1.65*macro+.20*np.sin(z*7)))*smooth(-.38,.48,theta)
 band*=.42+.56*smooth(-.44,.40,noise(z*2.8,arc*3.8,60))
 belly=(1-smooth(-1.18,-.17,theta))*.85
 limb=(1-smooth(1.36,2.66,y))*smooth(-1.73,-.9,z)*(1-smooth(.42,.95,z))
 if head:
  eye=np.exp(-((z-3.493)/.140)**2-((y-4.015)/.084)**2)
  naris=np.exp(-((z-4.49)/.082)**2-((y-3.858)/.044)**2)*(1-smooth(.29,.365,ax))
  brow=np.exp(-((y-4.105)/.093)**2-((z-3.49)/.43)**2)
  ginger=.46+.40*smooth(-.09,.78,theta)+.09*macro
 else:eye=naris=brow=np.zeros_like(x);ginger=smooth(1.85,3.18,z)*.52
 ww=np.stack([np.ones_like(x),belly,nape*.37+band,ginger,limb+.26*band*(1-smooth(-3,-1.5,z)),brow*.40],axis=-1)
 ww[...,0]=np.maximum(.03,1-np.maximum.reduce([belly,band,limb,ginger*np.ones_like(x)]))
 ww/=ww.sum(-1)[...,None]
 hazy=smooth(.02,.62,noise(z*13,y*12,91))*smooth(.05,.66,noise(z*4,arc*5,72))
 lum=165+23*dome+12*tone+15*macro-16*hazy-20*fold-19*band-24*lip-38*eye
 lum=np.maximum(24,lum*(1-.79*naris))
 color=np.repeat(np.clip(lum,0,255)[...,None],3,axis=-1)
 height=np.clip(.39+.12*dome+.036*tone+.025*macro-.07*fold-.05*lip,.14,.79)
 rough=np.clip(.78-.11*dome+.043*macro-.1*lip-.07*brow,.52,.94)
 ao=np.clip(185+58*dome-27*fold-25*eye-100*naris,65,249)
 wound=np.zeros_like(x)
 for cz,cy,length,slope in [(.56,3.38,.49,-.35),(.72,3.23,.39,-.42),(-1.11,3.02,.31,.64),(3.66,3.90,.17,-.40)]:
  feather=np.clip(1-((z-cz)/length)**2,0,1);d=abs(y-cy-(z-cz)*slope-.008*macro)
  wound=np.maximum(wound,feather*(1-smooth(.010,.027,d))*smooth(.28,.47,ax))
 return color,height,rough,ao,ww,wound,macro

def save(name,base,height,rough,ao,weights,wound,macro):
 def put(role,p,side=0):
  im=Image.fromarray(p)
  if side:im=im.resize((side,side),Image.Resampling.LANCZOS)
  if role=='decay':
   # Filters resample alpha on both sides of a wound boundary. Reserve the
   # final mip's injured texels exclusively for the wound the renderer shows.
   a=np.array(im);hurt=np.asarray(Image.open(HERE/(name+'_hurt.png')))
   a[hurt[...,3]>0,3]=0;im=Image.fromarray(a)
  im.save(HERE/(name+'_'+role+'.png'),compress_level=7)
 n=height.shape[0]
 height=gaussian_filter(height,.43)
 dy,dx=np.gradient(height);normal=np.stack([-dx*7.4,dy*7.4,np.ones_like(dx)],-1);normal/=np.linalg.norm(normal,axis=-1)[...,None]
 put('height',(height.clip(0,1)*65535).astype(np.uint16));put('normal',((.5+.5*normal)*255).astype(np.uint8));put('base',base.clip(0,255).astype(np.uint8))
 put('packed',np.stack([ao,255*rough,np.zeros_like(ao)],-1).clip(0,255).astype(np.uint8),n//2)
 for i,(role,span) in enumerate([('mask',slice(0,3)),('mask2',slice(3,6))]):
  a=weights[...,span]*255;put(role,(.25*(a[::2,::2]+a[1::2,::2]+a[::2,1::2]+a[1::2,1::2])).clip(0,255).astype(np.uint8))
 if name!='rex_saddle':
  hurt=np.zeros((*wound.shape,4),np.uint8);hurt[...,0]=85+12*macro;hurt[...,1]=29+6*macro;hurt[...,2]=26+5*macro
  hurt[...,3]=np.where(wound>.08,85+155*wound,0);put('hurt',hurt,256)
  decay=np.zeros_like(hurt);decay[...,0]=70+11*macro;decay[...,1]=64+12*macro;decay[...,2]=49+8*macro
  decay[...,3]=np.where(wound>.08,0,45+65*(.5+.5*macro));put('decay',decay,256)

def material(name,size):
 pts,ix=raster(MATS.index(name),size)
 # Read the same physical fields at all seams. Only the comparison masks and
 # interpolation buffers are per strip; memory use stays bounded at 2K.
 images=[]
 for start in range(0,size,96):
  fields=maps(pts[start:start+96],name=='rex_head')
  if not images:images=[[] for _ in fields]
  for a,b in zip(images,fields):a.append(b.astype(np.float32))
 save(name,*[np.concatenate(a,0) for a in images])
 print('painted',name,flush=True)

def atlas(name,n):
 y,x=np.mgrid[:n,:n];u,v=(x+.5)/n,1-(y+.5)/n;grain=noise(u*199,v*264,81);macro=noise(u*12,v*19,72)
 ww=np.zeros((n,n,6));rough=np.full((n,n),.69);ao=np.full((n,n),235.);h=.46+.04*grain
 def rgb(r,g,b):return np.stack(np.broadcast_arrays(r,g,b),-1)
 if name=='rex_saddle':
  wood=(u>.50)&(u<.73);metal=u>=.75;stitch=(abs(np.sin(v*235))>.55)*np.exp(-((u-.043)/.005)**2)
  color=rgb(105+14*macro+9*grain+45*stitch,61+8*macro+6*grain+41*stitch,38+8*macro+4*grain+30*stitch)
  lines=np.sin(268*u+5*macro);color[wood]=rgb(140+18*lines,100+12*lines,61+8*lines)[wood]
  color[metal]=rgb(126+15*grain,119+12*grain,93+10*grain)[metal];rough[metal]=.36;rough[wood]=.59
 else:
  color=rgb(145+12*grain,127+9*grain,98+7*grain);claw=(u<.26)&(v<.50);ww[...,5]=claw
  tooth=(u>.26)&(u<.50)&(v<.5);t=np.clip((v-.02)/.45,0,1);stri=np.sin(u*320+macro)
  color[tooth]=rgb(177+49*t+4*stri,152+61*t+3*stri,110+76*t+3*stri)[tooth];rough[tooth]=.44
  tongue=(u>.5)&(v<.5);gum=(u>.39)&(u<.70)&(v>.50);folds=np.sin(v*141+u*8)
  color[tongue]=rgb(118+13*macro+6*grain,61+7*macro+4*grain,58+7*macro+4*grain)[tongue]
  color[gum]=rgb(78+8*folds+11*macro,43+5*folds+5*macro,39+3*folds+5*macro)[gum];rough[tongue|gum]=.50
  eye=(u<.39)&(v>.50);a=(u-.02)/.35*math_tau;ev=(v-.52)/.46
  radial=np.hypot(np.sin(a)*.9,(ev-.5)*2.1);iris=1-smooth(.63,.77,radial);pupil=1-smooth(.205,.275,radial);lines=np.sin(np.arctan2(ev-.5,np.sin(a))*34)
  ec=rgb(42+iris*(129+19*lines),36+iris*(78+12*lines),30+iris*(20+5*lines))
  ec=ec*(1-pupil[...,None])+np.array([18,16,13])*pupil[...,None]
  color[eye]=ec[eye];rough[eye]=.16;h[eye]=.49
  lids=(u>.70)&(v>.50);color[lids]=rgb(122+7*grain,130+9*grain,110+7*grain)[lids];ww[...,0]=lids
 save(name,color,h,rough,ao,ww,np.zeros_like(v),macro)
 if name=='rex_saddle':
  packed=np.asarray(Image.open(HERE/'rex_saddle_packed.png')).copy();packed[:,:,2]=np.where(packed[:,:,1]<120,155,0)
  Image.fromarray(packed).save(HERE/'rex_saddle_packed.png')
math_tau=2*np.pi
if __name__=='__main__':
 material('rex_hide',2048);material('rex_head',2048);atlas('rex_detail',512);atlas('rex_saddle',1024)
