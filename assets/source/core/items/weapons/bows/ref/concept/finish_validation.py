"""Measure isolated raster masks and draw feature-specific pixel overlays."""
import json
from pathlib import Path
import numpy as np
from PIL import Image,ImageOps,ImageDraw,ImageFont

ROOT=Path(__file__).resolve().parent;C=ROOT/'checks'
report=json.loads((C/'model_measurements.json').read_text())
spec=json.loads((C/'projection_spec.json').read_text())
rows={};bg=(214,212,206)
font='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
ft=lambda n:ImageFont.truetype(font,n)
for name,feature in report['features'].items():
    im=Image.open(C/'feature_masks'/f'{name}.png').convert('RGBA')
    if feature['mirror_x']:im=ImageOps.mirror(im)
    alpha=im.getchannel('A');a=np.asarray(alpha);y,x=np.where(a>=128)
    box=[int(x.min()),int(y.min()),int(x.max())+1,int(y.max())+1]
    expected=feature['projected_evaluated_mesh_bbox_px']
    errors=[abs(u-v) for u,v in zip(box,expected)]
    rows[name]={'view':feature['view'],'pixels_per_metre':feature['ppm'],
        'raster_bbox_px':box,'mesh_projection_bbox_px':expected,
        'raster_size_m':[(box[2]-box[0])/feature['ppm'],(box[3]-box[1])/feature['ppm']],
        'edge_errors_px':errors,'max_edge_error_m':max(errors)/feature['ppm'],
        'within_2_mm':max(errors)/feature['ppm']<=.002}
    alpha.save(C/'feature_masks'/f'{name}_mask.png')
    view=Image.open(ROOT/(feature['view']+'.png')).convert('RGB')
    d=ImageDraw.Draw(view)
    d.rectangle(box,outline='#338A70',width=2)
    for xx in [box[0],box[2]]:d.line((xx,65,xx,1189),fill='#338A70',width=1)
    for yy in [box[1],box[3]]:d.line((65,yy,1189,yy),fill='#338A70',width=1)
    d.rectangle((45,30,1209,145),fill=bg)
    d.text((60,40),name+' / measured rendered coverage',font=ft(25),fill='#293E35')
    d.text((60,83),f'{box[2]-box[0]} x {box[3]-box[1]} px; {feature["ppm"]} px/m; edge error <= {max(errors)/feature["ppm"]*1000:.3f} mm',font=ft(20),fill='#293E35')
    view.save(C/(name+'_measured.png'))

# Pixel readings for requested physical features; dimensions with strong
# occlusion are measured in isolated passes from those exact same views.
dimensions=[]
def read(name,feature,axis,target):
    r=rows[feature];m=r['raster_size_m'][axis];relative=abs(m-target)/target
    dimensions.append({'name':name,'feature':feature,'raster_pixels':m*r['pixels_per_metre'],
        'measured_m':m,'target_m':target,'relative_error':relative,'within_3_percent':relative<=.030001})
read('Bow hide depth','bow_grip_side',0,.040)
read('Bow hide width','bow_grip_back',0,.030)
read('Bow hide height','bow_grip_side',1,.150)
read('Bow string diameter','bow_string',0,.005)
read('Bow string length','bow_string',1,1.320)
read('Bow upper ear height','bow_ear',1,.160)
read('Bow binding height','bow_binding',1,.040)
read('Crossbow tiller length side','crossbow_stock_side',0,.680)
read('Crossbow tiller length top','crossbow_stock_top',0,.680)
read('Crossbow butt height','crossbow_stock_side',1,.090)
read('Crossbow butt width','crossbow_stock_top',1,.046)
read('Crossbow prod span top','crossbow_prod_top',1,.600)
read('Crossbow prod span front','crossbow_prod_front',0,.600)
read('Crossbow prod height','crossbow_prod_front',1,.038)
read('Crossbow stirrup width','crossbow_stirrup',1,.090)
# Absolute feature edges locate the nose, butt and roller without counting cord
# or neighbouring parts. Coordinates are the specified continuous image grid.
side=rows['crossbow_stock_side'];nut=rows['crossbow_nut']
for label,px,origin,target,sign in [
    ('Butt Z',side['raster_bbox_px'][0],380,-.220,1),
    ('Nose Z',side['raster_bbox_px'][2],380,.460,1),
    ('Nut upper Y',nut['raster_bbox_px'][1],627,.030,-1),
    ('Nut centre Z',(nut['raster_bbox_px'][0]+nut['raster_bbox_px'][2])/2,380,.040,1)]:
    actual=sign*(px-origin)/1500;relative=abs(actual-target)/abs(target)
    dimensions.append(dict(name=label,raster_coordinate_px=px,measured_m=actual,target_m=target,relative_error=relative,within_3_percent=relative<=.030001))

agreement={
    'tiller_Z_side_vs_top_mm':1000*abs(rows['crossbow_stock_side']['raster_size_m'][0]-rows['crossbow_stock_top']['raster_size_m'][0]),
    'prod_X_top_vs_front_mm':1000*abs(rows['crossbow_prod_top']['raster_size_m'][1]-rows['crossbow_prod_front']['raster_size_m'][0]),
    'grip_Y_side_vs_back_mm':1000*abs(rows['bow_grip_side']['raster_size_m'][1]-rows['bow_grip_back']['raster_size_m'][1])}
result={'method':'Alpha>=128 raster edge measurements on isolated feature renders; metre conversion uses the delivery camera scale. Geometry projections only serve as an independent comparator.',
        'features':rows,'dimensions':dimensions,'cross_view_raster_agreement':agreement,
        'all_dimensions_within_3_percent':all(d['within_3_percent'] for d in dimensions),
        'all_edges_within_2_mm':all(r['within_2_mm'] for r in rows.values())}
(C/'raster_measurements.json').write_text(json.dumps(result,indent=2))
sheet=Image.new('RGB',(2000,1400),bg);d=ImageDraw.Draw(sheet)
d.text((65,35),'MEASURED / isolated raster and evaluated geometry',fill='#293E35',font=ft(32))
d.text((65,90),'Physical geometry checks: '+str(len(report['checks']))+' / pass: '+str(report['all_within_3_percent']),fill='#293E35',font=ft(24))
d.text((65,130),'Rendered feature edge agreement <= 2 mm: '+str(result['all_edges_within_2_mm']),fill='#293E35',font=ft(24))
for i,r in enumerate(dimensions):
    y=205+i*45
    d.text((65,y),r['name'],fill='#293E35',font=ft(22))
    d.text((730,y),f'{r["measured_m"]*1000:9.3f} mm',fill='#293E35',font=ft(22))
    d.text((1100,y),f'target {r["target_m"]*1000:8.3f} mm',fill='#293E35',font=ft(22))
    d.text((1550,y),f'{r["relative_error"]*100:5.2f}%   '+('PASS' if r['within_3_percent'] else 'FAIL'),fill='#293E35' if r['within_3_percent'] else '#A13C22',font=ft(22))
d.text((65,1140),'Matching view dimensions: '+', '.join(f'{k}: {v:.3f}' for k,v in agreement.items()),fill='#293E35',font=ft(18))
d.text((65,1210),'Masks retain antialiased coverage. No silhouette dilation, stretching or independent repainting.',fill='#293E35',font=ft(23))
d.text((65,1260),'Nut height is measured above the +0.018 m deck. Prod tip sections are 1 mm inboard of edge chamfers.',fill='#293E35',font=ft(21))
sheet.save(C/'measurement_summary.png')
contact=Image.new('RGB',(1600,1600),bg);d=ImageDraw.Draw(contact)
for i,name in enumerate(rows):
    x=(i%4)*400;y=(i//4)*400
    im=Image.open(C/(name+'_measured.png')).resize((390,390),Image.Resampling.LANCZOS)
    contact.paste(im,(x+5,y+5))
contact.save(C/'feature_measurement_contact.png')
print(json.dumps({k:v for k,v in result.items() if k not in ['features','dimensions']},indent=2))
for r in dimensions:
    if not r['within_3_percent']:print('RASTER FAIL',r)
