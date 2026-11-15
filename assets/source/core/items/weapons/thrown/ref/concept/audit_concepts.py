"""Independent pixel measurements, pairwise projection consistency and QA sheet."""
from pathlib import Path
from PIL import Image,ImageOps,ImageDraw,ImageFont
import numpy as np,json,math
R=Path(__file__).resolve().parent
rows=json.loads((R/'checks/part_tasks.json').read_text()); geometry=json.loads((R/'checks/geometry.json').read_text());final=json.loads((R/'checks/measurements.json').read_text())
def bbox(a):
 yy,xx=np.where(a>=128);return [int(xx.min()),int(yy.min()),int(xx.max())+1,int(yy.max())+1]
for row in rows:
 im=ImageOps.mirror(Image.open(R/'checks/part_renders'/(row['id']+'.png')));a=np.array(im.getchannel('A'));b=bbox(a);extent=[b[2]-b[0],b[3]-b[1]]
 row['bbox_50percent_px']=b
 # Interpolate the 50% coverage crossing between pixel centres. This avoids the
 # unavoidable 3.03% integer rounding of an 11 mm shaft at 1500 px/m (16.5 px).
 sub=[]
 for projection in [a.max(axis=0),a.max(axis=1)]:
  x=np.where(projection>=128)[0];left,right=int(x[0]),int(x[-1]);values=projection.astype(float)/255
  l=left+.5 if left==0 else left-.5+(.5-values[left-1])/(values[left]-values[left-1])
  r=right+.5 if right==len(values)-1 else right+.5+(values[right]-.5)/(values[right]-values[right+1])
  sub.append(float(r-l))
 row['integer_extent_px']=extent;row['raster_extent_px']=sub;row['raster_extent_m']=[e/row['ppm'] for e in sub]
 row['error_percent']=[None if t is None else 100*(m/t-1) for m,t in zip(row['raster_extent_m'],row['target_m'])]
 row['pass_3percent']=[None if t is None else abs(m/t-1)<=.03+1e-8 for m,t in zip(row['raster_extent_m'],row['target_m'])]
rowmap={x['id']:x for x in rows}
pairs=[]
def pair(label,a,axis_a,b,axis_b,tol):
 av=rowmap[a]['raster_extent_m'][axis_a];bv=rowmap[b]['raster_extent_m'][axis_b]
 pairs.append({'dimension':label,'a':a,'b':b,'a_m':av,'b_m':bv,'difference_mm':abs(av-bv)*1000,'tolerance_mm':tol*1000,'pass':abs(av-bv)<=tol})
for base,ln in [('grenade_body',.09),('grenade_band',.03),('grenade_cap',.021),('arrow_head',.055),('arrow_shaft',.72),('arrow_binding',.035),('dart_needle',.014),('dart_collar',.010),('dart_barrel',.08),('dart_fringe',.065)]:
 pair(base+' Z',base+'_side',0,base+'_top',0,.00137 if base.startswith('grenade') else (.0077 if base.startswith('arrow') else .00179))
for label,a,aa,b,bb in [('grenade_body X','grenade_body_top',1,'grenade_body_front',0),('grenade_body Y','grenade_body_side',1,'grenade_body_front',1),('cap X','grenade_cap_top',1,'grenade_cap_front',0),('cap Y','grenade_cap_side',1,'grenade_cap_front',1),('flint X','arrow_head_top',1,'arrow_head_front',0),('flint Y','arrow_head_side',1,'arrow_head_front',1),('fringe X','dart_fringe_top',1,'dart_fringe_front',0),('fringe Y','dart_fringe_side',1,'dart_fringe_front',1)]:pair(label,a,aa,b,bb,.001)
# Positional and construction checks from the source geometry, beyond bbox-only raster checks.
construction=[]
def ccheck(name,actual,target,tol):
 construction.append(dict(name=name,actual=actual,target=target,tolerance=tol,pass_=abs(actual-target)<=tol))
for k,x in geometry['bola'].items():ccheck(k+' length',x['centerline_length_m'],.42,.42*.03)
held=[x['pouch_center_m'] for k,x in geometry['bola'].items() if k.startswith('held')]
for i in range(3):
 ccheck('held center Z '+str(i),held[i][2],.4,.012)
 ccheck('held triangular spacing '+str(i),math.dist(held[i],held[(i+1)%3]),.1,.003)
for k,x in geometry['bola'].items():
 if k.startswith('lying'):
  p=x['pouch_center_m'];ccheck(k+' radial location',math.hypot(p[0],p[2]),.4,.012);ccheck(k+' rest height',p[1],.034,.00102)
# Feature endpoints in world coordinates, measured from the actual source vertices.
for group,part,axis,end,target,tol in [('grenade','hide_grip_band',2,'min_m',-.015,.00045),('grenade','hide_grip_band',2,'max_m',.015,.00045),('grenade','steel_pull_ring',2,'max_m',.092,.00276),('grenade','steel_spoon_lever',2,'min_m',-.020,.0006),('arrow','wood_shaft',2,'min_m',-.720,.0216),('arrow','flint_leaf',2,'max_m',.05,.0015),('arrow','leather_vane_1',2,'min_m',-.700,.021),('arrow','leather_vane_1',2,'max_m',-.600,.018),('dart','bevelled_steel_needle',2,'max_m',.014,.00042)]:
 ccheck(group+' '+part+' '+end,geometry['groups'][group]['parts'][part][end][axis],target,tol)
ccheck('leather vanes count',sum(n.startswith('leather_vane_') for n in geometry['groups']['arrow']['parts']),3,0)
ccheck('hide fringe strips count',sum(n.startswith('hide_fringe_strip_') for n in geometry['groups']['dart']['parts']),8,0)
failures=[(r['id'],r['error_percent']) for r in rows if False in r['pass_3percent']]
result={'method':'Isolated shared model parts rendered into original calibrated orthographic cameras; 50% alpha contour crossings interpolated between pixel centres; integer bbox upper bounds exclusive. No manual adjustments.','pixel_quantization_m_at_6000':1/6000,'parts':rows,'view_agreement':pairs,'construction_checks':construction,'failures':failures,'all_pairwise_pass':all(x['pass'] for x in pairs),'all_construction_pass':all(x['pass_'] for x in construction)}
(R/'checks/part_measurements.json').write_text(json.dumps(result,indent=2))
FONT='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';font=lambda sz:ImageFont.truetype(FONT,sz)
out=Image.new('RGB',(1600,110+len(rows)*49),(239,237,231));d=ImageDraw.Draw(out);d.text((25,20),'ISOLATED PART MEASUREMENTS | metres -> calibrated raster',font=font(24),fill=(30,35,33));d.text((25,65),'Part / view                          Actual pixels       Measured mm (H, V)       Target mm (H, V)         Error %',font=font(17),fill=(70,74,70))
for i,r in enumerate(rows):
 y=105+i*49;bad=False in r['pass_3percent'];color=(160,44,35) if bad else (38,75,64)
 d.text((25,y),r['id'],font=font(17),fill=color);d.text((410,y),' / '.join(f'{v:.2f}' for v in r['raster_extent_px']),font=font(17),fill=color)
 d.text((620,y),' / '.join(f'{n*1000:.3f}' for n in r['raster_extent_m']),font=font(17),fill=color);d.text((950,y),' / '.join('n/a' if n is None else f'{n*1000:.3f}' for n in r['target_m']),font=font(17),fill=color);d.text((1250,y),' / '.join('n/a' if n is None else f'{n:+.2f}' for n in r['error_percent']),font=font(17),fill=color)
out.save(R/'checks/measurements_sheet.png')
print('Dimensional failures:',failures);print('Pairwise agreement:',all(x['pass'] for x in pairs),'maximum difference mm',max(x['difference_mm'] for x in pairs));print('Construction checks:',len(construction),all(x['pass_'] for x in construction))
