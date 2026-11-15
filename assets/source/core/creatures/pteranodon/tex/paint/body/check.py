#!/usr/bin/env python3
"""Validate the actual body delivery and make source/base/relight review sheets."""
from pathlib import Path
import hashlib,json
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter, binary_erosion
from scipy.spatial import cKDTree

HERE=Path(__file__).resolve().parent
PAINT=HERE.parent
ASSET=PAINT.parent.parent
N=2048
OWN=['torso','neck','leg']+[f'toe_{i}' for i in range(4)]+[f'hand_{i}' for i in range(3)]
COLS=[(255,0,0),(0,0,255),(255,255,0),(0,0,0)]

def linear(a):return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)
def srgb(a):
 a=np.clip(a,0,1)
 return np.where(a<=.0031308,a*12.92,1.055*a**(1/2.4)-.055)
def load(p):return np.array(Image.open(p))

def main():
 out=HERE/'checks';out.mkdir(exist_ok=True)
 folder=HERE/'layers'
 meta=json.loads((PAINT/'pteranodon_pieces.json').read_text())
 piece=load(PAINT/'pteranodon_pieces.png')[...,0]
 numbers={p['name']:p['number'] for p in meta['pieces']}
 own=np.isin(piece,[numbers[k] for k in OWN])
 rgba=load(folder/'pteranodon_base.png');rgb=rgba[...,:3]
 h=load(folder/'pteranodon_height.png')
 rough=load(folder/'pteranodon_rough.png');occ=load(folder/'pteranodon_occlusion.png')
 reg=load(folder/'pteranodon_regions.png')
 assert rgba.shape==(N,N,4)
 assert h.shape==rough.shape==occ.shape==(N,N)
 assert h.dtype==np.uint16
 assert np.all(rgba[...,3][own]==255) and np.all(rgba[~own]==0)
 for a in [h,rough,occ,reg]:assert np.all(a[~own]==0)
 assert np.all(np.any(np.stack([(reg==c).all(2) for c in COLS]),axis=0))
 dyed=own&np.any(reg!=0,axis=2)
 assert np.max(np.ptp(rgb[dyed],axis=-1))==0
 base=linear(rgb.astype(np.float32)/255)
 metrics={'coverage':int(own.sum()),'unpainted_texels':int(np.count_nonzero(own&(rgba[...,3]!=255))),
 'outside_owned_pixels':int(np.count_nonzero(rgba[...,3][~own])), 'means':{},'pieces':{}}
 for r,c in zip([0,2,5,6],COLS):
  mask=own&(reg==c).all(2)
  mean=float(base[mask].mean())
  metrics['means'][str(r)]=mean
  if r!=6:assert abs(mean-.5)<.002
 mm=load(PAINT/'pteranodon_texel_mm.png').astype(np.float32)/1000
 span=json.loads((folder/'layers.json').read_text())['pteranodon_height_mm']
 physical=h.astype(np.float32)/65535*span
 flow=load(ASSET/'ref/bakes/pteranodon_flow.png')[...,:2]/127.5-1
 q=base[...,0]
 # Structure tensor integrated over 4 mm: longitudinal derivative should be quieter.
 gy,gx=np.gradient(gaussian_filter(q,.6))
 along=gx*flow[...,0]-gy*flow[...,1]
 across=gx*flow[...,1]+gy*flow[...,0]
 for name in OWN:
  m=piece==numbers[name]
  fact={'texels':int(m.sum()),'roughness_mean':float(rough[m].mean()/255),
        'occlusion_min':float(occ[m].min()/255),
        'height_range_mm':float(np.ptp(physical[m]))}
  if name in ['torso','neck','leg']:
   interior=binary_erosion(m,iterations=6)&(reg[...,1]==255)
   ratio=float(np.mean(along[interior]**2)/max(np.mean(across[interior]**2),1e-12))
   fact['fibre_along_to_cross_gradient_energy']=ratio
   assert ratio<.9,(name,ratio)
  metrics['pieces'][name]=fact
 # Closest cross-island boundary neighbours in actual space, compared to ordinary
 # nearby material differences; these are diagnostic, not a claim of pixel identity.
 lo,hi=np.array(meta['position_box']['min']),np.array(meta['position_box']['max'])
 pos=np.stack([load(PAINT/f'pteranodon_position_{a}.png')/65535*(hi[i]-lo[i])+lo[i] for i,a in enumerate('xyz')],-1)
 metrics['joins']={}
 for a,b in [('torso','neck'),('torso','leg'),('neck','head')]:
  ma=piece==numbers[a];mb=piece==numbers[b]
  ea=ma&~binary_erosion(ma,iterations=2);eb=mb&~binary_erosion(mb,iterations=2)
  pa=pos[ea];pb=pos[eb]
  dist,ix=cKDTree(pb).query(pa)
  ok=dist<.0025
  fact={'nearby_samples':int(ok.sum()),'max_distance_m':.0025}
  if b in OWN and ok.any():
   va=base[ea][ok];vb=base[eb][ix[ok]]
   fact['mean_linear_difference']=float(np.abs(va-vb).mean())
   fact['mean_height_difference_mm']=float(np.abs(physical[ea][ok]-physical[eb][ix[ok]]).mean())
   fact['region_agreement']=float(np.all(reg[ea][ok]==reg[eb][ix[ok]],axis=1).mean())
  elif ok.any():
   fact['body_side_nape_xyz_min']=pos[ea][ok].min(0).tolist()
   fact['body_side_nape_xyz_max']=pos[ea][ok].max(0).tolist()
  metrics['joins'][a+'_'+b]=fact
 # Source-to-delivery comparison at a real 100 mm physical crop, no enlarged fibres.
 sf=ASSET/'tex/studies/fuzz';info=json.loads((sf/'study.json').read_text())
 source=Image.open(sf/info['source']).convert('RGB')
 sw=round(.100/(info['sets']['fuzz']['span_m']/2048*info.get('source_scale_before_quilting',.78)))
 src=source.crop((source.width//2-sw//2,source.height//2-sw//2,source.width//2+sw//2,source.height//2+sw//2))
 tile=Image.open(sf/'fuzz_base.png').crop((700,700,1110,1110))
 # Choose a pale central flank, 100 mm in the atlas using its actual metric.
 m=(piece==numbers['torso'])&(reg[...,1]==255)
 target=np.array([-.16,.69,-.22]);distance=np.linalg.norm(pos-target,axis=2);distance[~m]=10
 yy,xx=np.unravel_index(np.argmin(distance),distance.shape)
 radius=round(50/mm[yy,xx]);box=(xx-radius,yy-radius,xx+radius,yy+radius)
 unlit=Image.fromarray(np.uint8(srgb(base)*255+.5)).crop(box)
 dx=(np.roll(physical,-1,1)-np.roll(physical,1,1))/np.maximum(2*mm,1e-4)
 dy=(np.roll(physical,-1,0)-np.roll(physical,1,0))/np.maximum(2*mm,1e-4)
 normals=np.stack([-dx,dy,np.ones_like(dx)],-1);normals/=np.linalg.norm(normals,axis=2,keepdims=True)
 src=src.resize(unlit.size,Image.Resampling.LANCZOS)
 tile=tile.resize(unlit.size,Image.Resampling.LANCZOS)
 panels=[src,tile,unlit];labels=['Source at body density (100 mm)','Study at body density (100 mm)','Mapped unlit flank (100 mm)']
 for label,dye,light in [('Ivory light left','E9E4D8',[-.6,.5,.6]),('Ivory light right','E9E4D8',[.6,-.2,.7]),('Lime','9FE01F',[-.6,.5,.6]),('Near black','24282A',[.6,-.2,.7])]:
  colour=linear(np.array([int(dye[k:k+2],16) for k in (0,2,4)])/255)
  light=np.array(light);light/=np.linalg.norm(light)
  illumination=.42+.58*np.maximum((normals*light).sum(-1),0)
  a=base*colour/.5*illumination[...,None]*(occ[...,None]/255)
  panels.append(Image.fromarray(np.uint8(srgb(a)*255+.5)).crop(box));labels.append(label)
 sheet=Image.new('RGB',(4*340,2*375),(45,45,45));draw=ImageDraw.Draw(sheet)
 for i,(im,label) in enumerate(zip(panels,labels)):
  x=(i%4)*340;y=(i//4)*375
  sheet.paste(im.resize((320,320),Image.Resampling.LANCZOS),(x+10,y+35));draw.text((x+10,y+10),label,fill='white')
 sheet.save(out/'source_base_relit.png')
 metrics['output_sha256']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(folder.iterdir()) if p.is_file()}
 (out/'validation.json').write_text(json.dumps(metrics,indent=2)+'\n')
 print(json.dumps(metrics,indent=2))

if __name__=='__main__':main()
