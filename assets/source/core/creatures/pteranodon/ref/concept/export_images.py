"""Package imagegen paintings: matte extraction, uniform raster export, exact masks.
No spatial warps, anatomical edits, or independent X/Y scaling. All painted
content comes from the archived imagegen outputs in originals/.
"""
from pathlib import Path
from PIL import Image
import numpy as np
from scipy import ndimage as ndi
import json,hashlib
ROOT=Path(__file__).resolve().parent
BG=np.array([214,212,206],dtype=np.uint8)
SOURCES={'top':'top_fix','underside':'underside','front':'front','side':'side','folded_side':'folded_side_final','folded_front':'folded_front_final','three_quarter':'three_quarter','head_side':'head_side_fix','head_front':'head_front_final','saddled_side':'saddled_side_final','saddled_folded_side':'saddled_folded_side_final','saddled_three_quarter':'saddled_three_quarter','saddle_detail':'saddle_detail_fix'}
ORTHO=['top','underside','front','side','folded_side','folded_front']
def extract(a):
 r,g,b=[a[:,:,i].astype(float) for i in range(3)]
 candidate=(r-b<18)&(r-g<9)&(g-b<13)&(r-b>-3)&(b>176)&(r<233)
 labels,n=ndi.label(candidate)
 sizes=np.bincount(labels.ravel())
 # Includes background enclosed by limbs or reins, but not tiny low-chroma
 # pores in a painted surface. No invented silhouette or guide is substituted.
 bg=candidate & (sizes[labels]>80)
 fg=~bg
 labels,n=ndi.label(fg)
 sizes=np.bincount(labels.ravel())
 fg &= sizes[labels]>12
 # Retain fine edges; close only sub-pixel-scale raster holes.
 holes=ndi.binary_fill_holes(fg)&~fg
 hl,hn=ndi.label(holes);hs=np.bincount(hl.ravel())
 fg|=holes&(hs[hl]<16)
 return (fg*255).astype(np.uint8)
def export(name,source):
 f=ROOT/'originals'/f'{source}.png'
 im=Image.open(f).convert('RGB');a=np.array(im)
 alpha=Image.fromarray(extract(a))
 w,h=im.size
 if name in ORTHO or name in ['saddled_side','saddled_folded_side']:
  size=(3200,1600) if name in ['top','underside','front'] else(1600,1600)
 elif name=='head_side':size=(1800,1300)
 elif name=='head_front':size=(1025,1301) # uniform .921 scale: 152px eye spacing ->140px
 else:size=im.size
 scale=min(size[0]/w,size[1]/h)
 resized=(round(w*scale),round(h*scale))
 if resized!=size and max(abs(resized[i]-size[i]) for i in range(2))>1:
  raise ValueError(('nonuniform export prohibited',name,im.size,size,resized))
 # Same uniform scale for all channels; max one pixel rounding of raster dimensions.
 rgba=im.copy();rgba.putalpha(alpha);rgba=rgba.resize(size,Image.Resampling.LANCZOS)
 out=Image.new('RGBA',size,tuple(BG.tolist())+(255,));out.alpha_composite(rgba)
 out=out.convert('RGB');out.save(ROOT/f'{name}.png')
 m=rgba.getchannel('A')
 if name in ORTHO:m.save(ROOT/f'{name}_mask.png')
 m.save(ROOT/'checks'/f'{name}_matte.png')
 aa=np.array(out);ma=np.array(m)
 yy,xx=np.where(ma>=128)
 return{'source':str(f.relative_to(ROOT)),'source_size':[w,h],'output_size':list(size),'uniform_export_scale':scale,'bbox_alpha128':[int(xx.min()),int(yy.min()),int(xx.max()),int(yy.max())],'background_rgb':BG.tolist(),'background_exact':bool(np.all(aa[ma==0]==BG)),'mask_matches_export_alpha':True,'sha256':hashlib.sha256((ROOT/f'{name}.png').read_bytes()).hexdigest()}
if __name__=='__main__':
 results={k:export(k,v) for k,v in SOURCES.items()}
 (ROOT/'checks'/'export_manifest.json').write_text(json.dumps(results,indent=2))
 for k,v in results.items():print(k,v['output_size'],v['bbox_alpha128'],'bg',v['background_exact'])
