"""Final artifact checks, calibrated coordinates, and nock/shaft raster details."""
from pathlib import Path
from PIL import Image,ImageOps
import numpy as np,json,hashlib,datetime
R=Path(__file__).resolve().parent
G=json.loads((R/'checks/geometry.json').read_text());P=json.loads((R/'checks/part_measurements.json').read_text())
checks=[]
for v in G['views']:
 n=v['name'];im=Image.open(R/(n+'.png'));ma=Image.open(R/(n+'_mask.png'));a=np.array(ma);c=np.array(im)
 checks.append({'file':n+'.png','size':list(im.size),'canvas_pass':im.size==(1254,1254),'mask_size_pass':im.size==ma.size,'background_pass':bool(np.all(c[a==0]==[214,212,206])),'alpha_exact_pass':bool(np.array_equal(a,np.array(ImageOps.mirror(Image.open(R/'renders'/(n+'.png'))).getchannel('A')))),'sha256':hashlib.sha256((R/(n+'.png')).read_bytes()).hexdigest()})
# The carved slot is open at z=-720 mm and closes at -714 mm.
a=np.array(Image.open(R/'arrow_tail_side_mask.png'));row=a[627];occupied=np.where(row>=128)[0];first=int(occupied[0]);zslot=(first-627)/6000-.660
# Across a section half way through the slot.
col=round(627+(-.717+.660)*6000);inside=a[:,col]<128;lo=627;hi=627
while inside[lo-1]:lo-=1
while inside[hi+1]:hi+=1
nock={'section_column':col,'slot_pixel_rows':[lo,hi+1],'width_px':hi-lo+1,'width_m':(hi-lo+1)/6000,'depth_px':first-(627+(-.720+.660)*6000),'depth_m':zslot-(-.720)}
nock['pass']=abs(nock['width_m']/.003-1)<=.03 and abs(nock['depth_m']/.006-1)<=.03
# Ordinary shaft diameter in the head detail beyond binding, where 9 mm = 54 px.
a=np.array(Image.open(R/'arrow_head_side_mask.png'));column=round(627-.08*6000);yy=np.where(a[:,column]>=128)[0];shaft={'width_px':int(yy.max()-yy.min()+1),'width_m':float((yy.max()-yy.min()+1)/6000)};shaft['pass']=abs(shaft['width_m']/.009-1)<=.03
extra={n:dict(size=list(Image.open(R/n).size),present=(R/n).exists()) for n in ['lineup.png','hero.png','read_sizes.png']}
summary={'timestamp_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'orthographic_count':len(checks),'mask_count':len(checks),'views':checks,'supplementary':extra,'nock':nock,'shaft_diameter':shaft,'dimensional_pass':not P['failures'],'pairwise_agreement_pass':P['all_pairwise_pass'],'construction_pass':P['all_construction_pass'],'all_artifacts_pass':all(all(r[k] for k in ['canvas_pass','mask_size_pass','background_pass','alpha_exact_pass']) for r in checks)}
fittings=json.loads((R/'checks/fitting_measurements.json').read_text())
summary['fittings']=fittings
summary['all_checks_pass']=fittings['pass'] and fittings['all_orthographic_meshes_cast_no_shadows'] and summary['all_artifacts_pass'] and summary['dimensional_pass'] and summary['pairwise_agreement_pass'] and summary['construction_pass'] and nock['pass'] and shaft['pass']
(R/'checks/final_validation.json').write_text(json.dumps(summary,indent=2));print(json.dumps({k:v for k,v in summary.items() if k not in ['views']},indent=2))
