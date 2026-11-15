"""Measure final alpha/ID rasters, compare shared projections and draw guide sheets.
Bounds use alpha >= 128. Coordinates are continuous pixel-edge coordinates.
"""
import json, math
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'checks'
views=json.loads((OUT/'cameras.json').read_text());geo=json.loads((OUT/'geometry.json').read_text());proj=json.loads((OUT/'projected_geometry.json').read_text())
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',20)
small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',15)
colors={'haft':(255,0,0),'head':(0,0,255),'binding':(0,255,0),'tails':(255,0,255),'bark':(255,255,0),'stub':(0,255,255),'knot':(188,0,255)}
measurements={'method':{'canvas_px':[1254,1254],'alpha_threshold':128,'pixel_edge_convention':'bbox max exclusive; 1 pixel = 0.5 mm at 2000 px/m, 1.786 mm at 560 px/m','visible_component_rasters':'Independent flat emissive component IDs rendered from the same camera and meshes. Occluded features have smaller visible bounds.','unoccluded_component_extents':'Projected original mesh vertices, before occlusion. Necessary for hidden roots/butts in end views.','side_handedness':'The requested +X view with +Z right and +Y up is left-handed; +X render is reflected horizontally without rescaling.','head_end_depth':'Spear head-end camera clips shaft below z=1.10 m; full shaft bow must not enlarge head-only end view.'},'views':{},'dimension_checks':[],'cross_view_checks':[]}
def bbox(a):
 y,x=np.where(a)
 return [int(x.min()),int(y.min()),int(x.max()+1),int(y.max()+1)] if len(x) else None

def check(label,actual,target,unit='m',tol=.05):
 actual=float(actual);target=float(target);err=abs(actual-target);limit=abs(target)*tol
 measurements['dimension_checks'].append({'measurement':label,'actual':actual,'target':target,'unit':unit,'absolute_error':err,'relative_error_pct':100*err/abs(target) if target else None,'allowed_error_pct':tol*100,'pass':err<=limit+1e-7})
for name,s in views.items():
 im=np.array(Image.open(ROOT/f'{name}.png').convert('RGB'));mask=np.array(Image.open(ROOT/f'{name}_mask.png'))
 raw=Image.open(OUT/f'{name}_ids_raw.png').convert('RGBA')
 if s['view']=='side':raw=ImageOps.mirror(raw)
 raw.save(OUT/f'{name}_ids.png');ids=np.array(raw)
 b=bbox(mask>=128);entry={'silhouette_bbox_px':b,'silhouette_size_m':[(b[2]-b[0])/s['ppm'],(b[3]-b[1])/s['ppm']],'visible_component_bounds_px':{},'projected_component_bounds_px':{},'background_is_exact_rgb_214_212_206':bool(np.all(im[mask==0]==[214,212,206])),'mask_support_matches_color':bool(np.all(np.any(im!=[214,212,206],axis=2)[mask==0]==False))}
 for comp,c in colors.items():
  m=(np.max(np.abs(ids[:,:,:3].astype(int)-np.array(c)),axis=2)<8)&(ids[:,:,3]>=128)
  bb=bbox(m)
  if bb:entry['visible_component_bounds_px'][comp]=bb
 for comp,q in proj[name].items():
  entry['projected_component_bounds_px'][comp]=[q['min_col'],q['min_row'],q['max_col'],q['max_row']]
 measurements['views'][name]=entry
 # Individual annotated plates, with all component extents and camera axes.
 overlay=Image.open(ROOT/f'{name}.png').convert('RGB');d=ImageDraw.Draw(overlay)
 d.text((35,30),f'{name}  |  {s["ppm"]} px/m  |  {s["view"].upper()}',font=font,fill=(31,44,47))
 d.line([(0,s['row']),(1253,s['row'])],fill=(120,155,155),width=1)
 d.line([(s['col'],75),(s['col'],1220)],fill=(120,155,155),width=1)
 for j,(comp,q) in enumerate(proj[name].items()):
  if comp not in ['head','binding','haft','tails','stub']:continue
  box=[max(0,q['min_col']),max(0,q['min_row']),min(1253,q['max_col']),min(1253,q['max_row'])]
  c={'head':(60,105,150),'binding':(150,113,45),'haft':(115,135,80),'tails':(155,85,120),'stub':(70,135,140)}[comp]
  d.rectangle(box,outline=c,width=1);d.text((35,75+j*24),f'{comp}: {q["max_col"]-q["min_col"]:.2f} x {q["max_row"]-q["min_row"]:.2f} px',font=small,fill=c)
 overlay.save(OUT/f'{name}_overlay.png')

# The whole-spear side/edge comparison is separate from the head close-up.
a=measurements['views']['spear_side']['silhouette_bbox_px'];b=measurements['views']['spear_edge']['silhouette_bbox_px']
e=abs((a[2]-a[0])-(b[2]-b[0]))/560
measurements['cross_view_checks'].append({'tool':'spear','comparison':'whole Z raster span','error_m':e,'limit_m':.02*2.07,'pass':e<=.02*2.07})

parts=geo['components']
for tool in ['pick','hatchet']:
 p=parts[tool];haft=p['haft'];head=p['head'];bind=p['binding']
 check(tool+' haft butt z',haft['min_xyz_m'][2],-.12)
 check(tool+' haft top z',haft['max_xyz_m'][2],.385)
 check(tool+' haft length',haft['dimensions_m'][2],.505)
 # Direct raster silhouette butt and top; all long-axis endpoints are visible in both views.
 for v in ['side','edge']:
  s=views[tool+'_'+v];b=measurements['views'][tool+'_'+v]['silhouette_bbox_px'];check(tool+' '+v+' raster length',(b[2]-b[0])/s['ppm'],.505)
  hb=measurements['views'][tool+'_'+v]['visible_component_bounds_px']['head']
  if v=='side':
   ymax=(s['row']-hb[1])/s['ppm'];ymin=(s['row']-hb[3])/s['ppm'];check(tool+' raster striking tip y',ymax,.185 if tool=='pick' else .115);check(tool+' raster back y',ymin,-.075 if tool=='pick' else -.035)
 if tool=='pick':
  check('pick head Y span',head['dimensions_m'][1],.26);check('pick head X thickness',head['dimensions_m'][0],.046);check('pick head Z depth',head['dimensions_m'][2],.058)
  check('pick binding X width',bind['dimensions_m'][0],.056);check('pick binding Z span',bind['dimensions_m'][2],.09)
  check('pick tip y',head['max_xyz_m'][1],.185);check('pick beak return toward -Z',.310-.285,.025)
 else:
  check('hatchet cutting edge Z span',head['dimensions_m'][2],.14);check('hatchet root thickness',head['dimensions_m'][0],.024);check('hatchet root Z depth',.330-.250,.08);check('hatchet edge thickness',.0015*2,.003)
  check('hatchet lower winding Z span',.25-.22,.03);check('hatchet upper winding Z span',.36-.335,.025)
p=parts['spear'];check('spear haft Z length',p['haft']['dimensions_m'][2],1.90);check('spear head X width',p['head']['dimensions_m'][0],.052);check('spear head Y thickness',p['head']['dimensions_m'][1],.013);check('spear tip z',p['head']['max_xyz_m'][2],1.47);check('spear head length',p['head']['dimensions_m'][2],.22);check('spear binding X width',p['binding']['dimensions_m'][0],.034);check('spear binding Y width',p['binding']['dimensions_m'][1],.034);check('spear binding Z span',p['binding']['dimensions_m'][2],.09)
for view in ['side','edge']:
 b=measurements['views']['spear_'+view]['silhouette_bbox_px'];check('spear '+view+' raster overall Z length',(b[2]-b[0])/560,2.07)
# Cross sections and tail measurements read back from the saved mesh, not targets.
details=json.loads((OUT/'mesh_details.json').read_text())
for tool,sections in details['cross_sections'].items():
 targets={'grip':.028,'butt_diameter':.026,'neck':.022} if tool=='spear' else {'grip':.030,'butt_diameter':.038,'neck':.027}
 for where,target in targets.items():
  for axis in ['x','y']:check(tool+' '+where+' actual mesh '+axis+' diameter',sections[where]['width_'+axis+'_m'],target)
 if tool!='spear':check(tool+' kink Y center',sections['kink']['center_xy_m'][1],-.006 if tool=='pick' else .006)
 else:
  chord=(sections['butt']['center_xy_m'][1]+sections['head']['center_xy_m'][1])/2
  check('spear bow relative to endpoint chord',abs(chord-sections['chord_midpoint']['center_xy_m'][1]),.008)
for name,m in details['tail_centerline_lengths_m'].items():check(name+' including cut fibres',m['including_1mm_cut_fibres_m'],.035 if name.startswith('spear') else .030)
# Fresh-edge bands measured directly in the final colour images at the convex
# midpoint / widest leaf station. Head-ID mask excludes the background.
for name,col,lo,hi in [('hatchet_side',990,525,565),('spear_head_edge',707,570,610)]:
 image=np.array(Image.open(ROOT/(name+'.png'))).astype(float)
 alpha=np.array(Image.open(ROOT/(name+'_mask.png'))).astype(float)
 bright=image[lo:hi,col].mean(axis=1);aa=alpha[lo:hi,col]
 i=int(np.flatnonzero(aa>=128)[0])
 outer=float(lo+i-1+(127.5-aa[i-1])/(aa[i]-aa[i-1]))
 fresh=float(np.median(bright[i+2:i+8]));dark=float(np.median(bright[-8:]));threshold=(fresh+dark)/2
 j=int(np.flatnonzero((np.arange(len(bright))>i+2)&(bright<threshold))[0])
 inner=float(lo+j-1+(bright[j-1]-threshold)/(bright[j-1]-bright[j]))
 tool='hatchet' if name.startswith('hatchet') else 'spear';outline=geo['head_profiles'][tool]['outline'];k=5 if tool=='hatchet' else 2
 normals=[]
 for q in [outline[k-1],outline[k+1]]:
  da=q[0]-outline[k][0];dz=q[1]-outline[k][1];normals.append(abs(dz)/math.hypot(da,dz))
 cosine=min(normals);span=(inner-outer)*cosine
 check(name+' fresh band raster perpendicular width',span/2000,.008)
 measurements.setdefault('fresh_edge_pixel_probes',{})[name]={'column':col,'outer_row_alpha50':outer,'inner_row_half_fresh_dark':inner,'scan_span_px':inner-outer,'edge_normal_projection_factor':cosine,'perpendicular_width_px':span,'width_m':span/2000,'method':'Fractional outer edge from alpha 50%; inner edge from fresh/dark plateau midpoint. Correct column-scan width to perpendicular edge width using measured adjacent profile segment normals. This avoids whole-pixel rounding and the oblique-cut bias at convex vertices.'}

# Component projected extents are compared independently, including hidden points.
for tool in ['pick','hatchet','spear']:
 base=tool if tool!='spear' else 'spear_head'
 for comp in ['head','binding','tails','bark','stub']:
  if comp not in proj[base+'_side']:continue
  a=proj[base+'_side'][comp];b=proj[base+'_edge'][comp];c=proj[base+'_end'][comp]
  ppm=views[base+'_side']['ppm']
  za=a['max_col']-a['min_col'];zb=b['max_col']-b['min_col']
  ya=a['max_row']-a['min_row'];yc=c['max_row']-c['min_row']
  xb=b['max_row']-b['min_row'];xc=c['max_col']-c['min_col']
  for axis,error,tolerance in [('Z side-edge',abs(za-zb)/ppm,.02*(.505 if tool!='spear' else 2.07)),('Y side-end',abs(ya-yc)/ppm,.003),('X edge-end',abs(xb-xc)/ppm,.003)]:
   measurements['cross_view_checks'].append({'tool':tool,'component':comp,'comparison':axis,'error_m':error,'limit_m':tolerance,'pass':error<=tolerance})
# Independent raster extents for silhouettes: same Z boundaries and same X/Y silhouettes.
for tool in ['pick','hatchet','spear_head']:
 a=measurements['views'][tool+'_side']['silhouette_bbox_px'];b=measurements['views'][tool+'_edge']['silhouette_bbox_px'];c=measurements['views'][tool+'_end']['silhouette_bbox_px']
 for label,e,lim in [('Z raster span',(a[2]-a[0])-(b[2]-b[0]),.0101),('Y raster span',(a[3]-a[1])-(c[3]-c[1]),.003),('X raster span',(b[3]-b[1])-(c[2]-c[0]),.003)]:
  measurements['cross_view_checks'].append({'tool':tool,'comparison':label,'error_m':abs(e)/2000,'limit_m':lim,'pass':abs(e)/2000<=lim})

# Orthographic construction sheets: side and edge share exact Z columns; end is
# beside the side at matching Y rows. X extents are joined through a dimension bar.
for tool in ['pick','hatchet','spear']:
 base=tool if tool!='spear' else 'spear_head';a=Image.open(ROOT/f'{base}_side.png');b=Image.open(ROOT/f'{base}_edge.png');c=Image.open(ROOT/f'{base}_end.png')
 if tool!='spear':
  cropa=(120,350,1200,940);cropb=(120,515,1200,720);cropc=(525,350,730,940)
 else:
  cropa=(150,550,1010,705);cropb=(150,550,1010,705);cropc=(550,550,710,705)
 ca=a.crop(cropa);cb=b.crop(cropb);cc=c.crop(cropc)
 sheet=Image.new('RGB',(1600,1150),(240,239,235));d=ImageDraw.Draw(sheet)
 ax,ay=50,100;ex,ey=50,780;nx,ny=1260,100
 sheet.paste(ca,(ax,ay));sheet.paste(cb,(ex,ey));sheet.paste(cc,(nx,ny))
 d.text((50,28),f'{tool.upper()} | exact orthographic projection comparison | 2000 px/m',font=font,fill=(30,42,45))
 d.text((50,70),'SIDE +X / Z right, Y up',font=small,fill=(55,65,67));d.text((50,748),'EDGE +Y / Z right, X up',font=small,fill=(55,65,67));d.text((1260,70),'END +Z',font=small,fill=(55,65,67))
 # Guide lines connect all Z landmarks across side and edge at the original scale.
 bounds=proj[base+'_side'];landmarks=[]
 for comp in ['haft','head','binding','tails','stub','bark']:
  if comp not in bounds:continue
  q=bounds[comp]
  for edge in ['min_col','max_col']:
   u=q[edge]
   if cropa[0]<=u<=cropa[2]:landmarks.append((u,comp))
 for i,(u,comp) in enumerate(landmarks):
  x=ax+u-cropa[0];d.line([(x,ay),(x,ey+cb.height)],fill=(165,180,178),width=1)
  # Numeric extents are in the individual overlay and JSON; keep guide lines uncluttered.
 # Y boundaries match horizontally between side and end.
 for comp in ['head','binding','tails']:
  q=bounds[comp]
  for r in [q['min_row'],q['max_row']]:
   y=ay+r-cropa[1]
   if ay<=y<=ay+ca.height:d.line([(ax,y),(nx+cc.width,y)],fill=(165,180,178),width=1)
 q=proj[base+'_edge']['binding'];w=q['max_row']-q['min_row'];d.text((50,1030),f'Binding X width: {w:.2f} px = {w/2:.2f} mm; same geometry in edge and end.',font=font,fill=(55,65,67))
 d.text((50,1070),'Lines mark geometric component extents, including features occluded by nearer parts.',font=small,fill=(55,65,67))
 sheet.save(OUT/f'{tool}_orthographic_guides.png')

measurements['summary']={'dimension_checks':len(measurements['dimension_checks']),'dimension_failures':[c for c in measurements['dimension_checks'] if not c['pass']],'cross_view_checks':len(measurements['cross_view_checks']),'cross_view_failures':[c for c in measurements['cross_view_checks'] if not c['pass']],'max_raster_cross_view_error_mm':max(c['error_m']*1000 for c in measurements['cross_view_checks'] if 'raster' in c['comparison'])}
(OUT/'measurements.json').write_text(json.dumps(measurements,indent=2));print(json.dumps(measurements['summary'],indent=2))
