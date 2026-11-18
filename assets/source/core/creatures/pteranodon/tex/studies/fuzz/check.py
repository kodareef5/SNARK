#!/usr/bin/env python3
"""Validate delivered files and make full-resolution, scale, dye and seam proofs."""
from pathlib import Path
import json, math, struct
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import gaussian_filter, map_coordinates, binary_erosion
from build import linear, srgb, normal_from_height

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'checks'
OUT.mkdir(exist_ok=True)
FONT=ImageFont.truetype(next(p for p in ('/System/Library/Fonts/Supplemental/Arial.ttf','/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf') if Path(p).exists()),17)
SMALL=ImageFont.truetype(next(p for p in ('/System/Library/Fonts/Supplemental/Arial.ttf','/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf') if Path(p).exists()),14)
DYES={
 'design':{5:'E9E4D8',0:'2E3134'},
 'hot_pink':{5:'FF3EA5',0:'9FE01F'},
 'lime':{5:'9FE01F',0:'2030C0'},
 'near_black':{5:'17191B',0:'E9E4D8'},
 'near_white':{5:'F4F1EA',0:'8E8B85'},
}

def im(a):return Image.fromarray(np.uint8(np.clip(srgb(a)*255+.5,0,255)))
def correlation(a,b):
 a=a.astype(np.float64).ravel();b=b.astype(np.float64).ravel()
 a-=a.mean();b-=b.mean()
 return float(np.dot(a,b)/max(np.sqrt(np.dot(a,a)*np.dot(b,b)),1e-12))
def seam(a):
 a=a.astype(np.float32)
 return [float(np.abs(np.take(a,0,k)-np.take(a,-1,k)).mean()/max(np.abs(np.diff(a,axis=k)).mean(),1e-9)) for k in [1,0]]
def rgb(h):return linear(np.array([int(h[i:i+2],16) for i in [0,2,4]],np.float32)/255)
def shrink(a,s):
 # Averages in linear light, unlike an sRGB Pillow thumbnail.
 if a.ndim==2:a=a[...,None]
 channels=[np.asarray(Image.fromarray(a[...,i]).resize((s,s),Image.Resampling.BOX),np.float32) for i in range(a.shape[-1])]
 return np.stack(channels,axis=-1)
def panel(items,size=384,columns=3):
 rows=math.ceil(len(items)/columns)
 canvas=Image.new('RGB',(columns*(size+16)+16,rows*(size+48)+16),(235,233,229));d=ImageDraw.Draw(canvas)
 for i,(label,pic) in enumerate(items):
  x=16+(i%columns)*(size+16);y=16+(i//columns)*(size+48)
  d.text((x,y),label,font=SMALL,fill=(30,30,30))
  if pic.size!=(size,size):pic=pic.resize((size,size),Image.Resampling.LANCZOS)
  canvas.paste(pic,(x,y+28))
 return canvas

def check(name,f):
 layers={k:np.array(Image.open(ROOT/f'{name}_{k}.png')) for k in ['base','height','normal','packed','regions']}
 faults=[]
 for k,a in layers.items():
  if a.shape[:2]!=(2048,2048):faults.append(f'{k}: wrong dimensions')
 depth=(ROOT/f'{name}_height.png').read_bytes()[24]
 if depth!=16:faults.append('height is not 16 bit')
 b=linear(layers['base'].astype(np.float32)/255)
 grey=b[...,0]; h=layers['height'].astype(np.float32)/65535
 n=layers['normal'].astype(np.float32)/127.5-1
 packed=layers['packed'].astype(np.float32)/255
 ids=np.where(layers['regions'][...,1]==0,0,5)
 valid=((layers['regions'][...,0]==255)&(layers['regions'][...,2]==0)&np.isin(layers['regions'][...,1],[0,255]))
 if not valid.all():faults.append('invalid region colour')
 if set(np.unique(ids).tolist())!=set(f['regions']):faults.append('wrong regions')
 neutral=int(np.max(layers['base'].max(axis=-1).astype(int)-layers['base'].min(axis=-1)))
 if neutral>2:faults.append('not neutral')
 means={str(int(r)):float(grey[ids==r].mean()) for r in np.unique(ids)}
 if any(abs(v-.5)>.02 for v in means.values()):faults.append('region mean')
 q=[float(grey[y:y+1024,x:x+1024].mean()) for y in [0,1024] for x in [0,1024]]
 quarter=(max(q)-min(q))/float(grey.mean())
 if quarter>.02:faults.append('quarter means differ >2%')
 lengths=np.linalg.norm(n,axis=-1)
 dx=np.roll(h,-1,1)-np.roll(h,1,1);dy=np.roll(h,-1,0)-np.roll(h,1,0)
 c=[correlation(-n[...,0]/n[...,2],dx),correlation(n[...,1]/n[...,2],dy)]
 if min(c)<.9:faults.append('height-normal correlation')
 expected=normal_from_height(h,f['span_m'],f['height_mm'])
 err=float(np.max(np.abs(expected-n)))
 if err>1/127.5:faults.append('physical normal mismatch')
 if np.max(np.abs(lengths-1))>.007:faults.append('normal not unit')
 seams={k:seam(v) for k,v in layers.items() if k!='regions'}
 if any(max(v)>1.3 for v in seams.values()):faults.append('wrap seam')
 # Test direct light from all hemispheric azimuths and elevations.
 lightcorr=[]
 for elevation in [15,45,75,90]:
  el=math.radians(elevation)
  for azimuth in range(0,360,45):
   az=math.radians(azimuth)
   light=np.array([math.cos(el)*math.cos(az),math.cos(el)*math.sin(az),math.sin(el)],np.float32)
   lightcorr.append(correlation(grey,np.sum(n*light,axis=-1)))
 if max(abs(v) for v in lightcorr)>.06:faults.append('base has directional light correlation')
 if np.any(layers['packed'][...,2]):faults.append('metalness not zero')
 result={'passed':not faults,'faults':faults,'region_mean_linear':means,'base_std_linear':float(grey.std()),'base_min_max_linear':[float(grey.min()),float(grey.max())],'neutral_channel_delta':neutral,'quarters_mean_linear':q,'quarter_relative_spread':quarter,'height_bit_depth':depth,'height_actual_range_mm':float((h.max()-h.min())*f['height_mm']),'height_encoded_range_mm':f['height_mm'],'normal_height_correlation_xy':c,'normal_length_mean':float(lengths.mean()),'normal_length_max_error':float(np.max(np.abs(lengths-1))),'normal_physical_max_component_error':err,'max_abs_base_light_correlation':max(abs(v) for v in lightcorr),'wrap_ratios_xy':seams,'occlusion_range':[float(packed[...,0].min()),float(packed[...,0].max())],'roughness_range':[float(packed[...,1].min()),float(packed[...,1].max())]}
 result['base_band_std_linear']={}
 for mm in [0.5,2,5]:
  sigma=mm*2048/(f['span_m']*1000)
  band=gaussian_filter(grey,sigma,mode='wrap')-gaussian_filter(grey,sigma*4,mode='wrap')
  result['base_band_std_linear'][str(mm)]=float(band.std())
 # Full-resolution unlit plus two relights for every dye; contact sheets use 1:1 crops.
 details=[];scale=[]
 lights=[np.array([-.55,.32,.77],np.float32),np.array([.62,-.25,.74],np.float32)]
 for dye,palette in DYES.items():
  tint=np.empty_like(b)
  for r in np.unique(ids):tint[ids==r]=rgb(palette[int(r)])
  unlit=np.clip(b/.5*tint,0,1)
  ui=im(unlit);ui.save(OUT/f'{name}_{dye}_unlit.png')
  details.append((f'{dye}: base, 1:1',ui.crop((768,850,1152,1234))))
  for j,L in enumerate(lights):
   L/=np.linalg.norm(L)
   lam=np.maximum(np.sum(n*L,axis=-1),0)
   lit=unlit*(.42+.58*lam[...,None])*packed[...,:1]
   li=im(lit);li.save(OUT/f'{name}_{dye}_light{j+1}.png')
   details.append((f'{dye}: light {j+1}, 1:1',li.crop((768,850,1152,1234))))
  if dye=='design':
   target=round(f['span_m']*(2400 if name=='fuzz_face' else 1400))
   for size,label in [(2048,'study / full tile'),(target,'animal density'),(max(1,round(target/10)),'tenth density')]:
    s=im(shrink(unlit,size));s.save(OUT/f'{name}_design_{size}px.png')
    # Actual-size inset for the tenth density, not a magnified swatch.
    field=Image.new('RGB',(700,700),(225,222,216))
    s.thumbnail((700,700),Image.Resampling.LANCZOS)
    field.paste(s,((700-s.width)//2,(700-s.height)//2))
    scale.append((label+f' ({size} px)',field))
   crop=ui.crop((0,768,2048,1280));crop.save(OUT/f'{name}_edge_strip.png')
 panel(details,384,3).save(OUT/f'{name}_dyes_relit.png')
 panel(scale,700,3).save(OUT/f'{name}_scales.png')
 # Offset full native tile, and 3x3 at 256 px per tile to find repetition.
 Image.fromarray(np.roll(layers['base'],(1024,1024),(0,1))).save(OUT/f'{name}_half_offset.png')
 small=np.asarray(im(shrink(b,512)))
 Image.fromarray(np.tile(small,(3,3,1))).save(OUT/f'{name}_3x3.png')
 # Detect internal copied motifs independently of the obligatory whole-tile
 # periodicity. Exclude neighbouring samples within 16 mm of the origin.
 thumb=shrink(grey,512)[...,0]
 thumb-=thumb.mean()
 spectrum=np.fft.rfft2(thumb)
 ac=np.fft.irfft2(spectrum*np.conj(spectrum),s=thumb.shape).real
 ac/=ac[0,0]
 lag=np.minimum(np.arange(512),512-np.arange(512))
 beyond=(lag[:,None]**2+lag[None,:]**2)>=17**2
 result['repeat_check_exclusion_mm']=17*f['span_m']*1000/512
 result['max_internal_shift_correlation_beyond_17_preview_pixels']=float(ac[beyond].max())
 result['max_horizontal_shift_correlation_beyond_17_preview_pixels']=float(ac[0,17:496].max())
 if result['max_internal_shift_correlation_beyond_17_preview_pixels']>.25:faults.append('strong internal repetition')
 if name=='mantle_edge':
  Image.fromarray(layers['regions']).save(OUT/'mantle_region_full.png')
  mask=(ids==0).astype(np.float32)
  p=mask.mean(axis=1)
  band=np.where((p[800:1250]>.05)&(p[800:1250]<.95))[0]
  result['main_edge_5_95_width_mm']=float((band[-1]-band[0])*(f['span_m']*1000/2048)) if len(band) else 0
  profile=np.array(json.loads((ROOT/'synthesis.json').read_text())['edge_profile']['main_profile_px'],np.float32)
  offsets=np.arange(-180,181,dtype=np.float32)
  ys=profile[None,:]+offsets[:,None]
  xs=np.broadcast_to(np.arange(2048,dtype=np.float32),ys.shape)
  coverage=map_coordinates(mask,[ys,xs],order=0,mode='wrap').mean(axis=1)
  mixed=np.where((coverage>.05)&(coverage<.95))[0]
  result['local_interleave_5_95_width_mm']=float((mixed[-1]-mixed[0])*500/2048)
  result['main_edge_wander_peak_to_peak_mm']=float(np.ptp(profile)*500/2048)
  # An offset dyed proof exposes both the main and the quieter wrap edge.
  dyed=np.array(Image.open(OUT/'mantle_edge_design_unlit.png'))
  Image.fromarray(np.roll(dyed,(1024,1024),(0,1))).save(OUT/'mantle_dyed_half_offset.png')
 result['passed']=not faults
 return result

def comparison():
 study=json.loads((ROOT/'study.json').read_text())
 source=Image.open(ROOT/study['source']).convert('RGB')
 factor=study['source_scale_before_quilting']
 source=source.resize((round(source.width*factor),round(source.height*factor)),Image.Resampling.LANCZOS)
 # Match the build's source-lie correction before comparing physical features.
 n=source.width
 padded=Image.fromarray(np.pad(np.asarray(source),((n,n),(n,n),(0,0)),mode='reflect'))
 source=padded.rotate(study.get('source_lie_correction_deg',12.07),resample=Image.Resampling.BICUBIC).crop((n,n,2*n,2*n))
 base=Image.open(ROOT/'fuzz_base.png')
 relit=Image.open(OUT/'fuzz_design_light1.png')
 items=[('Generated source at final physical scale',source.crop((200,200,712,712))),('Delivered neutral base, 4096 px/m',base.crop((600,600,1112,1112))),('Ivory / Python relight, 4096 px/m',relit.crop((600,600,1112,1112)))]
 panel(items,512,3).save(OUT/'original_base_relit.png')
 refs=ROOT.parents[2]/'ref/concept'
 reference_specs=[
  ('head_side neck', 'head_side.png',(1285,1010,1445,1170),1000,'fuzz'),
  ('saddle_detail neck','saddle_detail.png',(175,270,335,430),2000,'fuzz'),
  ('head_side face','head_side.png',(1120,842,1200,922),1000,'fuzz_face'),
 ]
 overview=Image.new('RGB',(1120,1065),(235,233,229));od=ImageDraw.Draw(overview)
 for ppm in [1000,2000]:
  canvas=Image.new('RGB',(1120,655 if ppm==2000 else 410),(235,233,229));d=ImageDraw.Draw(canvas)
  d.text((15,12),f'Concept and delivered ivory pile at {ppm:,} pixels / metre (reference resampling noted below)',font=FONT,fill=(25,25,25))
  for row,(label,file,box,native,name) in enumerate(reference_specs):
   metres=(box[2]-box[0])/native;size=round(metres*ppm)
   c=Image.open(refs/file).crop(box).resize((size,size),Image.Resampling.LANCZOS)
   g=Image.open(OUT/f'game_scale/{name}_{ppm}ppm.png')
   start=round(.08*ppm) if name=='fuzz' else round(.045*ppm)
   g=g.crop((start,start,start+size,start+size))
   full=Image.open(OUT/f'{name}_design_unlit.png')
   extent=round(metres/study['sets'][name]['span_m']*2048)
   u=full.crop((400,400,400+extent,400+extent)).resize((size,size),Image.Resampling.LANCZOS)
   # Rows need enough room for the 320 px neck at 2000 ppm.
   yy=48 if row==0 else (round(.16*ppm)+110)
   if row==2:continue  # Face has its own full comparison below.
   for x,title,pic in [(15,label,c),(390,'Delivered ivory base',u),(765,'Game shader / noon sky',g)]:
    d.text((x,yy),title,font=FONT,fill=(30,30,30));canvas.paste(pic,(x,yy+25))
   d.text((15,yy+27+size),f'{metres*1000:.0f} mm square; reference native {native:,} px/m'+(' (enlarged 2x)' if ppm>native else ''),font=SMALL,fill=(55,55,55))
  canvas.save(OUT/f'concept_{ppm}ppm.png')
  overview.paste(canvas,(0,0 if ppm==1000 else 410))
 overview.save(OUT/'concept_at_scale.png')
 # Face comparison at two exact scales; same morphology at half the body span.
 face=Image.new('RGB',(960,500),(235,233,229));d=ImageDraw.Draw(face)
 for j,ppm in enumerate([1000,2000]):
  size=round(.08*ppm);yy=20+j*220
  ref=Image.open(refs/'head_side.png').crop((1120,842,1200,922)).resize((size,size),Image.Resampling.LANCZOS)
  game=Image.open(OUT/f'game_scale/fuzz_face_{ppm}ppm.png').crop((round(.045*ppm),round(.045*ppm),round(.045*ppm)+size,round(.045*ppm)+size))
  body=Image.open(OUT/f'game_scale/fuzz_{ppm}ppm.png').crop((round(.08*ppm),round(.08*ppm),round(.08*ppm)+size,round(.08*ppm)+size))
  for x,label,pic in [(20,'Concept face',ref),(340,'fuzz_face, game',game),(660,'fuzz, game',body)]:
   d.text((x,yy),f'{label}: {ppm} px/m',font=FONT,fill=(30,30,30));face.paste(pic,(x,yy+32))
 face.save(OUT/'face_at_scale.png')

def round4_comparison():
 """Native-size game comparisons preserve the actual distance judgement."""
 versions=[('Round 2',OUT/'round2_baseline'),('Round 3',OUT/'round3_baseline'),('Round 4',ROOT)]
 if any(not p.exists() for _,p in versions):return
 facts={'base_band_std_linear':{},'game_interior_band_std':{}}
 for name in ['fuzz','mantle_edge']:
  canvas=Image.new('RGB',(1730,1476),(235,233,229));d=ImageDraw.Draw(canvas)
  native=[]
  for i,(label,parent) in enumerate(versions):
   pic=Image.open(OUT/f'look/{name}.png' if parent==ROOT else parent/f'{name}_game.png').convert('RGB')
   y=i*492
   d.text((10,y+4),f'{label} / {name}: 0.5 m, alternate light, 1.5 m, 5 m (native screen pixels)',font=FONT,fill='black')
   canvas.paste(pic.crop((0,28,1730,466)),(0,y+29))
   native.append((label+' base / native 4096 px/m',Image.open(parent/f'{name}_base.png').crop((600,600,1112,1112))))
   if name!='fuzz':continue
   a=linear(np.asarray(Image.open(parent/'fuzz_base.png'),np.float32)[...,0]/255)
   facts['base_band_std_linear'][label]={}
   for mm in [.5,2,5]:
    sigma=mm*2048/500
    facts['base_band_std_linear'][label][str(mm)+'mm']=float((gaussian_filter(a,sigma,mode='wrap')-gaussian_filter(a,sigma*4,mode='wrap')).std())
   facts['game_interior_band_std'][label]={}
   for distance,box in [('0.5m',(10,46,430,466)),('1.5m',(870,46,1290,466))]:
    a=linear(np.asarray(pic.crop(box),np.float32)/255)
    lum=a.mean(axis=2)
    mask=np.max(np.abs(a-a[0,0]),axis=2)>.02
    mask=binary_erosion(mask,iterations=14)
    residual=gaussian_filter(lum,1 if distance=='0.5m' else 2)-gaussian_filter(lum,10)
    facts['game_interior_band_std'][label][distance]=float(residual[mask].std())
  canvas.save(OUT/f'round2_round3_round4_{name}.png')
  panel(native,512,3).save(OUT/f'round2_round3_round4_{name}_native.png')
 (OUT/'round4_comparison.json').write_text(json.dumps(facts,indent=2)+'\n')

def column_check():
 """Check the reported 170px bands locally, so quilting cannot hide them."""
 facts={'method':'Sixteen native 512px crops; blur sigmas (8,3) minus (50,35); horizontal shift correlation at all 140–200px lags. Supporting measurement, not a visual pass criterion.'}
 for label,parent in [('round2',OUT/'round2_baseline'),('round3',OUT/'round3_baseline'),('round4',ROOT)]:
  if not (parent/'fuzz_base.png').exists():continue
  a=linear(np.asarray(Image.open(parent/'fuzz_base.png'),np.float32)[...,0]/255)
  a=gaussian_filter(a,(8,3),mode='wrap')-gaussian_filter(a,(50,35),mode='wrap')
  results=[]
  for y in range(0,2048,512):
   for x in range(0,2048,512):
    z=a[y:y+512,x:x+512];lags=range(140,201)
    correlations=[float(np.corrcoef(z[:,:-lag].ravel(),z[:,lag:].ravel())[0,1]) for lag in lags]
    results.append({'box':[x,y,x+512,y+512],'peak_correlation':max(correlations),'peak_lag_px':list(lags)[int(np.argmax(correlations))]})
  facts[label]={'max_patch_correlation':max(v['peak_correlation'] for v in results),'mean_patch_peak_correlation':float(np.mean([v['peak_correlation'] for v in results])),'patches':results}
 (OUT/'column_check.json').write_text(json.dumps(facts,indent=2)+'\n')

def check_elements():
 metadata=json.loads((ROOT/'elements/elements.json').read_text())
 for name,f in metadata.items():
  for layer in ['base','height','normal','packed','regions']:
   parent=np.array(Image.open(ROOT/f"{f['source_set']}_{layer}.png").crop(f['box_px']))
   element=np.array(Image.open(ROOT/f'elements/{name}_{layer}.png'))
   if not np.array_equal(parent,element):raise AssertionError(f'{name}/{layer}: patch differs from delivered parent')
 return {'patches':len(metadata),'aligned_layer_crops':len(metadata)*5,'passed':True}

if __name__=='__main__':
 study=json.loads((ROOT/'study.json').read_text())
 results={name:check(name,f) for name,f in study['sets'].items()}
 comparison()
 round4_comparison()
 column_check()
 (ROOT/'elements/validation.json').write_text(json.dumps(check_elements(),indent=2)+'\n')
 (ROOT/'measurements.json').write_text(json.dumps(results,indent=2)+'\n')
 print(json.dumps(results,indent=2))
 if any(not r['passed'] for r in results.values()):raise SystemExit(1)
