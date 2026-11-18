#!/usr/bin/env python3
"""Registered panorama assembly from eight retained image-tool paintings.

Source geometry is never resampled. Sky painting is graded with broad continuous
fields; cloud detail is isolated and kept outside angular exclusion regions.
The sun/moon/star coordinates and perspective views use the supplied sphere.
Run python3 -I scripts/build_keys.py, then read_points.py and measure.py.
"""
import site
site.addsitedir(site.getusersitepackages())
from pathlib import Path
import json, math, hashlib
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageCms
from scipy.ndimage import gaussian_filter, median_filter, map_coordinates, label, distance_transform_edt
from scipy.interpolate import PchipInterpolator
ROOT=Path(__file__).resolve().parents[1]
W,H=2048,1024
LUMA=np.array([.2126,.7152,.0722])
ICC=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
META=json.loads((ROOT/'base/points.json').read_text())
PHYS=json.loads((ROOT/'underlay/points.json').read_text())['keys']
PAL=json.loads((ROOT/'reports/palette-decisions.json').read_text())
YY,XX=np.mgrid[:H,:W].astype(float)
AZ=np.radians(345+(XX+.5-W/2)*360/W)
EL=np.radians(90-(YY+.5)*180/H)
DIR=np.stack([-np.sin(AZ)*np.cos(EL),np.sin(EL),np.cos(AZ)*np.cos(EL)],axis=-1)
DISCS={
'dawn':[(1606,494,34)],'morning':[(1584,469,65)],'noon':[(1118,138,65)],
'afternoon':[(685,325,70)],'golden':[(592,480,48)],
'sunset':[(583,508,27),(1621,498,25)],'dusk':[(1627,438,35),(365,508,25)],
'night':[(1118,142,65)]}
SUN_RGB={'dawn':[255,242,210],'morning':[255,250,224],'noon':[255,255,245],
'afternoon':[255,251,225],'golden':[255,241,171],'sunset':[255,203,109]}
# Grey surface hue controls. Brightness targets come from physical open card,
# and artist-directed wall/shade exposure informed by physical irradiance.
HUES={
'dawn':([145,111,88],[37,51,73],[52,59,73]),
'morning':([155,140,115],[53,70,93],[96,91,82]),
'noon':([108,104,93],[54,71,95],[127,123,114]),
'afternoon':([149,132,109],[52,70,95],[119,110,97]),
'golden':([160,114,66],[40,55,81],[76,62,46]),
'sunset':([96,57,43],[25,34,54],[59,46,46]),
'dusk':([60,57,73],[21,28,47],[31,35,49]),
'night':([32,39,50],[15,23,38],[30,36,47])}
FACE_LEVELS={'dawn':(112,43),'morning':(144,70),'noon':(104,70),'afternoon':(134,70),
'golden':(121,55),'sunset':(70,32),'dusk':(52,26),'night':(32,21)}


def dec(c):
 c=np.asarray(c,float)/255
 return np.where(c<=.04045,c/12.92,((c+.055)/1.055)**2.4)
def enc(c):
 c=np.clip(c,0,1)
 return np.where(c<=.0031308,c*12.92,1.055*c**(1/2.4)-.055)*255
def lum(c):return np.sum(c*LUMA,axis=-1)
def equiv(c):return float(enc(lum(dec(c))))
def tone_hue(c,value):
 v=dec(c);return enc(v*dec(value)/lum(v))
def smooth(a,b,x):
 t=np.clip((x-a)/(b-a),0,1);return t*t*(3-2*t)
def read(a,p):
 xs=(np.arange(p['x']-6,p['x']+7)%W)
 return a[max(0,p['y']-6):min(H,p['y']+7)][:,xs].mean((0,1))
def vec(heading,elev):
 h,e=np.radians([heading,elev]);return np.array([-np.sin(h)*np.cos(e),np.sin(e),np.cos(h)*np.cos(e)])
def angle(p):return np.degrees(np.arccos(np.clip(np.sum(DIR*vec(p['heading'],p['elevation']),axis=-1),-1,1)))
def save(a,path):
 path.parent.mkdir(parents=True,exist_ok=True)
 im=Image.fromarray(np.rint(a).clip(0,255).astype('uint8')) if isinstance(a,np.ndarray) else a.convert('RGB')
 im.save(path,icc_profile=ICC)

def source_sky(k,index,edited=False,source_path=None):
 name=k['name'];path=ROOT/f'originals/{index:02d}-{name}-panorama.png'
 if edited:path=ROOT/'originals/12-afternoon-round-3.png'
 if source_path is not None:path=source_path
 a=np.array(Image.open(path).convert('RGB').resize((W,H),Image.Resampling.LANCZOS),float)
 # Discard generated land and horizon edge; extrapolate the last clean sky row.
 a[505:]=a[504]
 # Remove every generated disc and misplaced compact halo before exact placement.
 for cx,cy,r in DISCS[name]:
  y0=max(0,cy-r);y1=min(505,cy+r+1)
  for y in range(y0,y1):
   dx=int(math.sqrt(max(0,r*r-(y-cy)**2)))
   x0=max(0,cx-dx);x1=min(W-1,cx+dx)
   if x1>x0:
    w=np.linspace(0,1,x1-x0+1)[:,None]
    a[y,x0:x1+1]=a[y,max(0,x0-1)]*(1-w)+a[y,min(W-1,x1+1)]*w
 # Estimate clear air from the source with robust, anisotropic smoothing.
 small=np.array(Image.fromarray(a[:512].astype('uint8')).resize((512,128),Image.Resampling.BOX),float)
 bgsmall=median_filter(small,size=(9,37,1),mode='nearest')
 bgsmall=gaussian_filter(bgsmall,sigma=(2,2,0),mode='nearest')
 bg=np.array(Image.fromarray(bgsmall.clip(0,255).astype('uint8')).resize((W,512),Image.Resampling.BICUBIC),float)
 bg=np.concatenate([bg,np.repeat(bg[-1:],H-512,axis=0)])
 # Use only thin positive filament detail, not source land/stars or disc remnants.
 detail=np.maximum(a-bg-1,0)
 cloud_strength=np.max(detail,axis=-1)
 cf=smooth(1,7,cloud_strength)*smooth(10,16,np.degrees(EL))*(1-smooth(43,52,np.degrees(EL)))
 cf*=smooth(0,70,np.minimum(XX,W-1-XX))
 for pn in ['zenith','high','toward','away']:
  cf*=smooth(4.4,6.3,angle(k['points'][pn]))
 for cx,cy,r in DISCS[name]:cf*=smooth(r,r+20,np.hypot(XX-cx,YY-cy))
 detail*=cf[...,None]
 # Smooth cylindrical join across a broad strip; identical edge colours.
 edge=(bg[:,0]+bg[:,-1])/2
 for x in range(128):
  w=1-smooth(0,128,x)
  bg[:,x]=bg[:,x]*(1-w)+edge*w
  bg[:,-1-x]=bg[:,-1-x]*(1-w)+edge*w
 # The pole is one point. Fade directional variations above 65 degrees.
 pole=smooth(65,89,np.degrees(EL))
 bg=bg*(1-pole[...,None])+bg.mean(axis=1)[:,None,:]*pole[...,None]
 return bg,detail,cf,path

def paint_sky(k,index,include_bodies=True):
 name=k['name'];bg,detail,cf,path=source_sky(k,index)
 # Round three uses the new afternoon painting for broad air colour only.
 # Thin cloud filaments retain round two's exact registration and exclusions.
 if name=='afternoon':
  edited_bg,_,_,path=source_sky(k,index,edited=True)
  bg=edited_bg*.65+bg*.35
 tar=np.array(PAL[name]['target']);names=['zenith','high','toward','away']
 src=np.array([read(bg,k['points'][n]) for n in names]);delta=tar-src
 # Whole-dome grade. Vertical cubic controls span the full elevation range;
 # the sunward adjustment is a broad periodic lobe, never a patch at a sample.
 ys=np.array([0,17,341,494,525,1023])
 dd=np.array([delta[0],delta[0],delta[1],delta[3],delta[3],delta[3]])
 correction=PchipInterpolator(ys,dd)(np.arange(H))[:,None,:]
 light=k[k['lightBy']]
 azweight=((1+np.cos(AZ-np.radians(light['heading'])))/2)**2
 elevweight=(1-np.sin(np.maximum(EL,0)))**2
 ptweight=((1+math.cos(math.radians(15)))/2)**2*(1-math.sin(math.radians(3)))**2
 correction=correction+(delta[2]-delta[3])*azweight[...,None]*elevweight[...,None]/ptweight
 sky=np.clip(bg+correction,0,255)
 # Correct residual caused by finite patch averaging; still the same broad fields.
 for _ in range(2):
  got=np.array([read(sky,k['points'][n]) for n in names]);d=tar-got
  dd=np.array([d[0],d[0],d[1],d[3],d[3],d[3]])
  sky+=PchipInterpolator(ys,dd)(np.arange(H))[:,None,:]
  sky+=(d[2]-d[3])*azweight[...,None]*elevweight[...,None]/ptweight
 # Broad honey/apricot veil over the golden sunward quarter, without an orange pole.
 if name=='golden':
  ang=angle({'heading':light['heading'],'elevation':13})
  warm=np.exp(-(ang/38)**2)*smooth(3,9,np.degrees(EL))*(1-smooth(35,60,np.degrees(EL)))
  sky=sky*(1-.25*warm[...,None])+np.array([243,187,135])*(.25*warm[...,None])
 if name=='afternoon':
  # A soft gold-white aerosol veil, contained around the 35-degree sun.
  # Mix in linear light so the bridge from blue into warm air stays luminous.
  warm=np.exp(-.5*(angle(light)/15)**2)*.28
  sky=enc(dec(sky)*(1-warm[...,None])+dec([255,244,214])*warm[...,None])
 # Preserve organic filaments from the actual image tool, recoloured by the grade.
 cloudgain=.62 if name in ('dusk','night') else .8
 sky=np.clip(sky+detail*cloudgain,0,255)
 # Night/dusk sparse spherical stars, equal-area distributed, same catalogue.
 stars=[]
 if name in ('dusk','night'):
  rng=np.random.default_rng(47103)
  for i in range(95 if name=='night' else 20):
   heading=float(rng.uniform(0,360));elev=float(np.degrees(np.arcsin(rng.uniform(.17,.97))))
   p={'heading':heading,'elevation':elev}
   if any(np.degrees(np.arccos(np.clip(np.dot(vec(heading,elev),vec(k['points'][n]['heading'],k['points'][n]['elevation'])),-1,1)))<5 for n in names):continue
   dist=angle(p);r=.065 if i%14 else .12
   alpha=np.exp(-.5*(dist/r)**2)*(0.6 if name=='night' else .27)
   sky=sky*(1-alpha[...,None])+np.array([208,220,234])*alpha[...,None]
   stars.append(p)
 # Disc radii are angular, so spherical projection provides the horizontal stretch.
 bodies=[]
 for body,diam in ([('sun',1.2),('moon',1.5)] if include_bodies else []):
  p=k[body]
  if p['elevation'] < -diam/2:continue
  if body=='moon' and name not in ('sunset','dusk','night'):continue
  d=angle(p);radius=diam/2
  # Glow is a spherical field and remains smooth at the seam/pole.
  halo=np.exp(-.5*(d/(2.8 if body=='sun' else (5.8 if name=='night' else 2.2)))**2)
  strength=.20 if body=='sun' else (.23 if name=='night' else .08)
  if body=='moon' and name=='night':halo=(halo*.20+np.exp(-.5*(d/12)**2)*.025)/strength
  rgb=np.array(SUN_RGB.get(name,[247,233,213]) if body=='sun' else ([202,218,235] if name=='night' else [238,215,176]))
  sky=sky*(1-(halo*strength)[...,None])+rgb*(halo*strength)[...,None]
  alpha=np.clip((radius+.08-d)/.16,0,1)
  # Opaque earth masks the lower hemisphere even though the base sea has a depressed raster horizon.
  # Disc occlusion follows the unshifted base silhouette, including its sea edge.
  # The supplied angular zero and raster sea line differ by about seven rows.
  disc=np.broadcast_to(rgb,sky.shape).astype(float).copy()
  if body=='moon':
   # Delicate lunar mottling only inside the disc; generated texture is retained in source.
   dh=(AZ-np.radians(p['heading']))*math.cos(math.radians(p['elevation']))
   de=EL-math.radians(p['elevation'])
   mottle=1-.13*np.exp(-((dh/.005)**2+(de/.007)**2))-.055*np.cos(dh*1100)*np.sin(de*900)
   disc*=np.clip(mottle,.78,1)[...,None]
  sky=sky*(1-alpha[...,None])+disc*alpha[...,None]
  bodies.append({'body':body,'heading':p['heading'],'elevation':p['elevation'],'diameterDegrees':diam,'centreFromAngles':[float(((p['heading']-345+180)%360)/360*W-.5),float((90-p['elevation'])/180*H-.5)],'alphaPixels':int((alpha>.5).sum())})
 # Earth shadow under the rose return: a broad antisolar atmospheric layer,
 # strongest below the sampled rose band. No cloud or sample-sized edits.
 if name in ('sunset','dusk'):
  away_h=(k['sun']['heading']+180)%360
  aw=((1+np.cos(AZ-np.radians(away_h)))/2)**3
  width=1.35 if name=='sunset' else 1.8
  shadow=np.exp(-.5*(np.maximum(np.degrees(EL),0)/width)**2)*aw*.60
  shadow_rgb=np.array([77,98,135] if name=='sunset' else [53,75,121])
  sky=sky*(1-shadow[...,None])+shadow_rgb*shadow[...,None]
 # Force a single zenith row after everything, no directional pole seam.
 sky[0]=sky[0].mean(axis=0)
 np.savez_compressed(ROOT/'reports'/f'{name}-cloud-mask.npz',mask=(cf>0.001))
 return sky,{'source':str(path.relative_to(ROOT)),'nativeSize':list(Image.open(path).size),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bodies':bodies,'stars':stars}

def relight_land(k,base,sky):
 name=k['name'];hues=HUES[name];lv=FACE_LEVELS[name]
 targets={n:tone_hue(h,v) for n,h,v in zip(['lit','shaded','up'],hues,[lv[0],lv[1],PHYS[name]['lowPolyUp']])}
 raw=dec(base);br=lum(raw)
 # Lighting changes operate on source pixels with no geometric warping.
 # Broad blue ambient gain in shade, warm sun gain in illuminated materials.
 shade=dec(targets['shaded'])/max(dec(read(base,k['points']['shaded']))[0],1e-6)
 lit=dec(targets['lit'])/max(dec(read(base,k['points']['lit']))[0],1e-6)
 lo=float(dec(read(base,k['points']['shaded']))[0]);hi=float(dec(read(base,k['points']['lit']))[0])
 f=np.clip((br-lo)/max(hi-lo,.002),0,1)[...,None]
 if name=='dawn':f=f**3*.16  # grazing dawn warms only the catching planes; terrain stays in blue ambient
 gain=np.exp(np.log(np.maximum(shade,1e-4))*(1-f)+np.log(np.maximum(lit,1e-4))*f)
 land=enc(raw*gain)
 # Grey material neutral faces are uniform raster regions, so colour their whole
 # connected surface, not a sample patch. Preserve all edge coordinates.
 evidence={}
 for n in ['lit','shaded','up']:
  p=k['points'][n];c=base[p['y'],p['x']]
  labs,num=label(np.all(base==c,axis=-1));region=labs==labs[p['y'],p['x']]
  land[region]=targets[n]
  if n=='up' and name in ('sunset','dusk'):
   # At low sun the source top and side share one grey. Relight the lower
   # side of the entire card slab separately, with its silhouette unchanged.
   bottom=np.max(np.where(region,YY,-1),axis=0)
   side=region&(YY>bottom[None,:]-27)
   land[side]=targets['shaded']
  evidence[n]={'sourceRGB':c.tolist(),'targetRGB':targets[n].round(2).tolist(),'wholeFacePixels':int(region.sum())}
 # Transfer flat top hue to the matching other cube tops as the same material.
 # Where an up face shares the shade's original value (sunset/dusk), position is
 # used only to distinguish entire connected faces, not to alter geometry.
 p=k['points']['up'];c=base[p['y'],p['x']]
 if not np.array_equal(c,base[k['points']['shaded']['y'],k['points']['shaded']['x']]):
  neutral=np.all(base==c,axis=-1)
  labs,count=label(neutral);sizes=np.bincount(labs.ravel())
  large=neutral&(sizes[labs]>500)
  land[large]=targets['up']
 # Water's original exact material colour produces a registered mask for sea/lakes.
 watercolour=base[560,500]
 wm=np.all(base==watercolour,axis=-1)&(YY>=518)
 # reflected ray samples upper hemisphere at the same azimuth, with roughness.
 reflect_y=np.clip(H-1-YY,0,511)
 refl=np.stack([map_coordinates(sky[...,ch],[reflect_y,XX],order=1,mode='nearest') for ch in range(3)],axis=-1)
 deep=np.array([13,43,59]) if name in ['morning','noon','afternoon'] else np.array([8,15,25])
 fresnel=.045+.065*np.exp(-np.maximum(-np.degrees(EL),0)/4)
 refl=gaussian_filter(refl,sigma=(2,8,0),mode='wrap')
 water=enc(dec(refl)*fresnel[...,None]+dec(watercolour)*.65+dec(deep)*.15)
 # The lower water is a quiet sky reflection. Existing boundary pixels stay put.
 land[wm]=water[wm]
 # Recolour source anti-alias mixtures at shore/cube-water boundaries. Solve
 # their existing blend weight; do not dilate, erode, blur or move a silhouette.
 distance=distance_transform_edt(~wm)
 solid=(distance>3)&(YY>520)
 _,nearest=distance_transform_edt(~solid,return_indices=True)
 foreground=base[nearest[0],nearest[1]]
 diff=watercolour-foreground
 alpha=np.clip(np.sum((base-foreground)*diff,axis=-1)/np.maximum(np.sum(diff*diff,axis=-1),1e-6),0,1)
 error=np.max(np.abs(base-(foreground+alpha[...,None]*diff)),axis=-1)
 partial=(distance>0)&(distance<=2.5)&(YY>520)&(error<1.5)&(alpha>.015)&(alpha<.985)
 replacement=water*alpha[...,None]+land[nearest[0],nearest[1]]*(1-alpha[...,None])
 land[partial]=replacement[partial]
 evidence['waterEdgePixels']=int(partial.sum())
 return land,evidence,wm

def assemble(k,index):
 import sys
 sys.path.insert(0,str(ROOT/'scripts'))
 from round5 import assemble_round5
 return assemble_round5(k,index)

def perspective(im,heading,elevation=10,width=1280,height=720,hfov=100):
 # Camera basis in the game's north=+Z, east=-X coordinate system.
 f=vec(heading,elevation);r=vec(heading+90,0);u=np.cross(r,f)
 j,i=np.mgrid[:height,:width].astype(float)
 px=(2*(i+.5)/width-1)*math.tan(math.radians(hfov/2))
 py=(1-2*(j+.5)/height)*math.tan(math.radians(hfov/2))*height/width
 d=f+px[...,None]*r+py[...,None]*u;d/=np.linalg.norm(d,axis=-1,keepdims=True)
 h=np.degrees(np.arctan2(-d[...,0],d[...,2]));e=np.degrees(np.arcsin(d[...,1]))
 sx=((h-345+180)%360)/360*W-.5;sy=(90-e)/180*H-.5
 return np.stack([map_coordinates(im[...,c],[sy,sx],order=1,mode='grid-wrap') for c in range(3)],-1)
def font(size):return ImageFont.truetype(next(p for p in ('/System/Library/Fonts/Supplemental/Arial.ttf','/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf') if Path(p).exists()),size)
def contact(paths,output,tw=640,th=320,cols=2,subtitle='REGISTERED 360° PANORAMAS'):
 pad=24;cap=34;head=76;rows=math.ceil(len(paths)/cols)
 sheet=Image.new('RGB',(cols*(tw+pad)+pad,head+rows*(th+cap+pad)+pad),(12,22,33));d=ImageDraw.Draw(sheet)
 d.text((pad,15),'LIMESTONE / LAGOON / EMBER',font=font(26),fill=(230,226,215))
 d.text((pad,48),subtitle,font=font(14),fill=(140,166,187))
 for i,(name,path) in enumerate(paths):
  x=pad+(i%cols)*(tw+pad);y=head+(i//cols)*(th+cap+pad)
  sheet.paste(Image.open(path).convert('RGB').resize((tw,th),Image.Resampling.LANCZOS),(x,y))
  d.text((x,y+th+9),name.upper(),font=font(17),fill=(224,222,212))
 save(sheet,output)
def make_views():
 paths=[];vmeta={}
 for k in META['keys']:
  a=np.array(Image.open(ROOT/k['file']),float);active=k[k['lightBy']]['heading']
  vmeta[k['name']]={}
  for direction,heading in [('toward',active),('away',(active+180)%360)]:
   path=ROOT/'views'/f"{k['name']}-{direction}.jpg"
   view=Image.fromarray(np.rint(perspective(a,heading)).clip(0,255).astype('uint8'))
   view.save(path,quality=95,subsampling=0,icc_profile=ICC)
   paths.append((k['name']+' / '+direction,path));vmeta[k['name']][direction]={'heading':heading,'elevation':10,'horizontalFOV':100,'width':1280,'height':720}
 contact(paths,ROOT/'views'/'sheet.png',640,360,2,'PLAYER VIEWS / 100° HORIZONTAL / LOOKING 10° UP / TOWARD · AWAY')
 (ROOT/'views'/'cameras.json').write_text(json.dumps(vmeta,indent=2))
 contact([(k['name'],ROOT/k['file']) for k in META['keys']],ROOT/'keys-sheet.png')

def main():
 ev={}
 for i,k in enumerate(META['keys'],4):
  ev[k['name']]=assemble(k,i);print(k['name'],'assembled',flush=True)
 (ROOT/'reports'/'key-build.json').write_text(json.dumps(ev,indent=2))
 make_views()
if __name__=='__main__':main()
