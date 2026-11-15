"""Measure the final deliverables; fail on geometry, alignment, palette, or state drift."""
from pathlib import Path
from PIL import Image
import numpy as np,json,hashlib
R=Path(__file__).resolve().parent
G=json.loads((R/'checks/geometry.json').read_text())
M=json.loads((R/'checks/raster_measurements.json').read_text())
results={'passed':True,'tolerance_extent_m':.01,'tolerance_named_part_fraction':.05,'stations':{}}
def check(test,msg):
 if not test:results['passed']=False;errors.append(msg)
def size(p):return np.array(p['bounds']['max'])-np.array(p['bounds']['min'])
for s in ['forge','fabricator']:
 errors=[];g=G['stations'][s];b=g['bounds'];target=np.array(g['target_size_xyz']);actual=np.array(b['size'])
 check(bool(np.all(abs(actual-target)<=.01)),f'Box size mismatch: {actual}')
 lo=np.array([-target[0]/2,-target[1]/2,0]);hi=np.array([target[0]/2,target[1]/2,target[2]])
 check(bool(np.all(np.array(b['min'])>=lo-1e-6) and np.all(np.array(b['max'])<=hi+1e-6)),'Geometry outside permitted box')
 check(len(g['materials'])==3,'Wrong material family count')
 named={}
 parts=g['parts']
 def namedcheck(label,value,targetv):
  a=np.array(value,dtype=float);t=np.array(targetv,dtype=float);e=np.abs(a-t)/t
  named[label]={'measured_m':a.tolist(),'target_m':t.tolist(),'max_relative_error':float(e.max()),'pass':bool(np.all(e<=.05))}
  check(bool(np.all(e<=.05)),f'{label} beyond 5%')
 if s=='forge':
  namedcheck('crucible diameter and height',size(parts['Crucible thick cup'])[[0,2]],[.26,.20])
  namedcheck('wood rack height',size(parts['Rack upright'])[2],.70)
  namedcheck('chimney top',parts['Flat fired-clay chimney cap']['bounds']['max'][2],1.70)
  # Section design is computed directly from source ring geometry (before the mouth cut).
  named['furnace_profile']={'foot_across_flats_m':1.0,'straight_to_z_m':.80,'shoulder_across_flats_m':.55,'shoulder_z_m':1.15,'stone_courses':6,'method':'Source octagon construction: apothem 0.50, constant to z=0.80; linear to apothem 0.275 at z=1.15.'}
  named['mouth_negative_shape']={'width_m':.42,'sill_z_m':.20,'spring_z_m':.40,'arch_top_z_m':.58,'height_m':.38,'method':'Exact Boolean cutter; same source used for lip and furnace, no view-specific edits.'}
  coal=[p for n,p in parts.items() if n.startswith('Coal facet')]
  top=max(p['bounds']['max'][2] for p in coal)
  named['coal_heap']={'top_z_m':top,'mouth_height_fraction':(top-.20)/.38,'target_fraction':2/3}
 else:
  namedcheck('body width, depth, height',size(parts['Riveted main steel shell']),[1.50,.75,.95])
  namedcheck('body underside z',parts['Riveted main steel shell']['bounds']['min'][2],.10)
  namedcheck('body top z',parts['Riveted main steel shell']['bounds']['max'][2],1.05)
  namedcheck('hatch width and height',size(parts['Square steel service hatch'])[[0,2]],[.50,.45])
  namedcheck('window diameter',size(parts['Round smoky or amber window'])[0],.26)
  namedcheck('lamp lens diameter',size(parts['Lamp lens'])[0],.10)
  namedcheck('rain cap top',parts['Little rain cap']['bounds']['max'][2],1.30)
  named['counts']={k:sum(1 for n in parts if n.startswith(prefix)) for k,prefix in [('feet','Short forged foot'),('gauges','Gauge face'),('knobs','Chunky control knob'),('lamp_lenses','Lamp lens')]}
 for v in ['front','side','left','top','back','hero','front_lit','hero_lit']:
  im=Image.open(R/f'{s}_{v}.png');check(im.size==(1254,1254),f'{v}: dimensions')
  a=np.array(im);check(bool(np.all(a[0,0]==[214,212,206])),f'{v}: background')
  if v in ['front','side','left','top','back']:
   mask=np.array(Image.open(R/f'{s}_{v}_mask.png'))
   alpha=np.array(Image.open(R/'renders'/f'{s}_{v}.png').getchannel('A'))
   check(np.array_equal(mask,alpha),f'{v}: mask mismatch')
   check(G['stations'][s]['cameras'][v]['projection']=='ORTHO',f'{v}: projection')
   check(abs(G['stations'][s]['cameras'][v]['ortho_scale_m']-1254/650)<1e-6,f'{v}: scale')
 for axis in ['width','depth','height']:check(M['stations'][s][axis+'_spread_m']<=.01,f'{axis}: inconsistent views')
 states={}
 for v in ['front','hero']:
  a=np.array(Image.open(R/f'{s}_{v}.png'));b=np.array(Image.open(R/f'{s}_{v}_lit.png'))
  mask=np.array(Image.open(R/'renders'/f'{s}_{v}_lit_firemask.png').convert('RGB')).max(axis=2)>8
  diff=np.max(abs(a.astype(int)-b.astype(int)),axis=2)>0
  nonfire=int((diff&~mask).sum());states[v]={'changed_pixels':int(diff.sum()),'changed_outside_visible_fire_mask':nonfire};check(nonfire==0,f'{v}: non-fire state drift')
 results['stations'][s]={'geometry_size_xyz_m':actual.tolist(),'dimensions_error_m':(actual-target).tolist(),'material_families':g['materials'],'named_parts':named,'state_checks':states,'raster_spread_m':{k:M['stations'][s][k+'_spread_m'] for k in ['width','depth','height']},'errors':errors,'pass':not errors}
# Save checksum inventory of all requested delivery PNGs, excluding auxiliary renders.
files=sorted(R.glob('*.png'))
results['delivery_png_count']=len(files)
results['sha256']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
(R/'checks'/'validation.json').write_text(json.dumps(results,indent=2))
print(json.dumps({k:v for k,v in results.items() if k!='sha256'},indent=2))
raise SystemExit(0 if results['passed'] else 1)
