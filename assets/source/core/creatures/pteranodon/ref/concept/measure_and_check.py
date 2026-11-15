"""Measurements of the final painted pixels, separate from guide targets.
Surface joint centres are manual anatomical estimates, not recovered 3D bones.
Occluded landmarks are not scored. Run after export_images.py.
"""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import numpy as np,json,itertools,math
from scipy import ndimage as ndi
R=Path(__file__).resolve().parent
# Pixel picks on FINAL full-size exported paintings. Paired points are image-left/right.
P={
 'top':{'shoulder':[[1535,866],[1663,866]],'elbow':[[1424,846],[1775,846]],'wrist':[[1196,850],[2004,850]],'knuckle':[[1003,846],[2197,846]],'wingtip':[[204,1158],[2993,1158]],'hip':[[1570,1100],[1630,1100]],'ankle':[[1520,1281],[1680,1281]],'toe_tip':[[1511,1384],[1690,1384]],'neck_base':[[1600,816]],'skull_hinge':[[1600,603]],'eye':[[1572,538],[1628,538]],'beak_tip':[[1600,209]],'crest_tip':[[1600,724]]},
 'underside':{'shoulder':[[1534,866],[1666,866]],'wrist':[[1197,852],[2003,852]],'knuckle':[[1004,846],[2196,846]],'wingtip':[[204,1158],[2995,1158]],'ankle':[[1520,1281],[1680,1281]],'toe_tip':[[1511,1384],[1690,1384]],'beak_tip':[[1600,202]]},
 'front':{'shoulder':[[1538,1080],[1662,1080]],'elbow':[[1424,1038],[1776,1038]],'wrist':[[1197,1022],[2003,1022]],'knuckle':[[998,1009],[2202,1009]],'wingtip':[[197,1133],[3002,1133]],'ankle':[[1516,1227],[1684,1227]],'eye':[[1573,846],[1627,846]],'beak_tip':[[1600,885]],'crest_tip':[[1600,633]]},
 'side':{'shoulder':[[868,1130]],'elbow':[[857,1088]],'wrist':[[877,1065]],'hip':[[1134,1165]],'ankle':[[1326,1264]],'toe_tip':[[1418,1297]],'neck_base':[[854,1104]],'skull_hinge':[[653,933]],'eye':[[570,907]],'beak_tip':[[277,926]],'crest_tip':[[810,692]]},
 'folded_side':{'shoulder':[[872,1082]],'elbow':[[854,1170]],'wrist':[[752,1407]],'knuckle':[[924,1273]],'wingtip':[[1397,928]],'hip':[[1037,1244]],'ankle':[[1067,1410]],'toe_tip':[[978,1450]],'neck_base':[[884,1055]],'skull_hinge':[[869,745]],'eye':[[757,710]],'beak_tip':[[469,730]],'crest_tip':[[1004,491]]},
 'folded_front':{'shoulder':[[746,1083],[854,1083]],'elbow':[[714,1172],[886,1172]],'wrist':[[674,1405],[926,1405]],'knuckle':[[663,1275],[937,1275]],'wingtip':[[644,930],[956,930]],'ankle':[[739,1395],[861,1395]],'toe_tip':[[730,1444],[870,1444]],'eye':[[770,707],[830,707]],'beak_tip':[[800,745]],'crest_tip':[[800,500]]}
}
METHOD={'tip_uncertainty_px':2,'eye_uncertainty_px':4,'joint_centre_uncertainty_px':8,'note':'Manual visible surface picks; joints under fur/membrane are estimates. x magnitude from paired projections, y/z from registered canvases. Occluded side spread wingtip and knuckle are unscored; ventral eyes/crest are hidden. Targets in geometry_plan.json are NOT measurements.'}
CORE=['wingtip','wrist','shoulder','ankle','beak_tip','eye','crest_tip']
def coords(view,uv):
 u,v=uv
 if view in ['top','underside']:return{'x':abs(u-1600)/400,'z':(860-v)/400}
 if view in ['front','folded_front']:return{'x':abs(u-(1600 if view=='front' else 800))/400,'y':((1400 if view=='front' else 1450)-v)/400}
 return{'y':(1450-v)/400,'z':(900-u)/400}
def vals(view,key):
 a=[coords(view,p) for p in P[view][key]]
 return{k:float(np.mean([x[k] for x in a])) for k in a[0]}
checks=[]; settled={}
for pose,views,limit in [('spread',['top','underside','front','side'],.02*6.96),('folded',['folded_side','folded_front'],.02*2.3975)]:
 settled[pose]={}
 keys=set(k for v in views for k in P[v])
 for key in sorted(keys):
  seen={v:vals(v,key) for v in views if key in P[v]}
  axes={a:[] for a in 'xyz'}
  for v,c in seen.items():
   for a,t in c.items():axes[a].append(t)
  settled[pose][key]={a:round(float(np.median(x)),4) if x else None for a,x in axes.items()}
  for a,vs in axes.items():
   if len(vs)>1:
    d=max(vs)-min(vs)
    checks.append({'pose':pose,'landmark':key,'axis':a,'values_m':{v:round(c[a],5) for v,c in seen.items() if a in c},'range_m':round(d,5),'tolerance_m':round(limit,5),'pass':d<=limit,'required_landmark':key in CORE})
spans={}
sym={}
for v in ['top','underside','front']:
 m=np.array(Image.open(R/f'{v}_mask.png'))>=128
 yy,xx=np.where(m);spans[v]=(int(xx.max())-int(xx.min()))/400
 mirror=m[:,::-1];sym[v]={'silhouette_mirror_iou':float((m&mirror).sum()/(m|mirror).sum()),'note':'No mirroring applied to final paintings; fine texture and small surface variations remain.'}
# Actual top/underside outlines overlaid, no fitted transform.
a=np.array(Image.open(R/'top_mask.png'))>=128;b=np.array(Image.open(R/'underside_mask.png'))>=128
outline_iou=float((a&b).sum()/(a|b).sum())
req=[c for c in checks if c['required_landmark']]
summary={'measured_spans_m':spans,'span_spread_m':max(spans.values())-min(spans.values()),'span_comparison_pass':max(spans.values())-min(spans.values())<=.1392,'required_comparisons':len(req),'required_comparisons_pass':all(x['pass'] for x in req),'max_spread_required_axis_difference_m':max(x['range_m'] for x in req if x['pose']=='spread'),'max_folded_required_axis_difference_m':max(x['range_m'] for x in req if x['pose']=='folded'),'top_underside_silhouette_iou':outline_iou,'standing_crest_height_side_m':(1450-491)/400,'standing_crest_height_front_m':(1450-500)/400,'folded_side_eye_height_m':(1450-710)/400}
report={'method':METHOD,'pixel_picks':P,'reconstructed_landmarks_m':settled,'cross_view_checks':checks,'summary':summary,'symmetry':sym}
(R/'checks'/'measurements.json').write_text(json.dumps(report,indent=2))
try:F=ImageFont.truetype('/System/Library/Fonts/Menlo.ttc',22)
except:F=ImageFont.load_default()
# Annotate actual observed landmarks on each view, with registration crosshair.
col={'wingtip':'#D1495B','wrist':'#00798C','shoulder':'#30638E','ankle':'#9055A2','beak_tip':'#C26922','eye':'#4B7D3F','crest_tip':'#B45382'}
for v,marks in P.items():
 im=Image.open(R/f'{v}.png').convert('RGB');d=ImageDraw.Draw(im)
 d.text((28,24),v+' | measured surface landmarks | 400 px/m',font=F,fill='#24272B')
 ox=1600 if v in ['top','underside','front'] else(800 if v=='folded_front' else 900)
 oy=860 if v in ['top','underside'] else(1400 if v=='front' else 1450)
 d.line((ox,60,ox,im.height),fill='#9AA8A8',width=1);d.line((0,oy,im.width,oy),fill='#9AA8A8',width=1)
 for key,points in marks.items():
  if key not in CORE:continue
  for i,(x,y) in enumerate(points):
   cc=col[key];d.ellipse((x-5,y-5,x+5,y+5),outline=cc,width=2)
   if i==0:d.text((x+8,y-28),key,font=F,fill=cc)
 im.save(R/'checks'/f'{v}_landmarks.png')
# Shared x guides span all three spread views, exact common raster scale.
sheet=Image.new('RGB',(3200,4800),(214,212,206))
for i,v in enumerate(['top','underside','front']):sheet.paste(Image.open(R/'checks'/f'{v}_landmarks.png'),(0,i*1600))
d=ImageDraw.Draw(sheet)
for x in [204,1197,1520,1600,1680,2003,2995]:d.line((x,80,x,4799),fill='#6B8D96',width=2)
sheet.resize((1600,2400),Image.Resampling.LANCZOS).save(R/'checks'/'spread_alignment.png')
# Folded front and side share exactly the same ground row and Y scale.
sheet=Image.new('RGB',(3200,1600),(214,212,206))
for i,v in enumerate(['folded_side','folded_front']):sheet.paste(Image.open(R/'checks'/f'{v}_landmarks.png'),(i*1600,0))
d=ImageDraw.Draw(sheet)
for y in [491,710,930,1082,1395,1407,1450]:d.line((0,y,3199,y),fill='#6B8D96',width=2)
sheet.save(R/'checks'/'folded_alignment.png')
# Spread side/front Y alignment compensates only the specified 50px origin offset.
sheet=Image.new('RGB',(4800,1650),(214,212,206));sheet.paste(Image.open(R/'checks'/'side_landmarks.png'),(0,0));sheet.paste(Image.open(R/'checks'/'front_landmarks.png'),(1600,50));d=ImageDraw.Draw(sheet)
for y in [692,907,1065,1130,1264,1450]:d.line((0,y,4799,y),fill='#6B8D96',width=2)
sheet.resize((2400,825),Image.Resampling.LANCZOS).save(R/'checks'/'side_front_alignment.png')
# Two colour contour overlap, original registrations, no geometric fitting.
ov=np.full((*a.shape,3),[236,234,228],dtype=np.uint8)
ea=a&~ndi.binary_erosion(a,iterations=2);eb=b&~ndi.binary_erosion(b,iterations=2)
ov[ea]=[190,47,87];ov[eb]=[20,134,153];ov[ea&eb]=[42,44,47]
im=Image.fromarray(ov);d=ImageDraw.Draw(im);d.text((30,30),'Top magenta / underside teal — unwarped silhouette overlay',font=F,fill='black');im.save(R/'checks'/'top_underside_overlay.png')
for bare,saddled in [('side','saddled_side'),('folded_side','saddled_folded_side')]:
 im=Image.open(R/f'{saddled}.png').convert('RGB');ar=np.array(im);m=np.array(Image.open(R/f'{bare}_mask.png'))>=128;e=m&~ndi.binary_erosion(m,iterations=2);ar[e]=[199,50,108];im=Image.fromarray(ar);d=ImageDraw.Draw(im);d.text((24,24),'Magenta: bare silhouette in unchanged registration',font=F,fill='black');im.save(R/'checks'/f'{saddled}_overlay.png')
# Head comparison translated for shared eye height. Translation is check-sheet only.
sheet=Image.new('RGB',(2825,1300),(214,212,206));sheet.paste(Image.open(R/'head_side.png'),(0,0));sheet.paste(Image.open(R/'head_front.png'),(1800,-160));d=ImageDraw.Draw(sheet)
for y in [155,687,743]:d.line((0,y,2824,y),fill='#6B8D96',width=2)
d.text((25,25),'Head comparison: approximately 1000 px/m; front translated on check sheet only',font=F,fill='black');sheet.save(R/'checks'/'head_alignment.png')
# Small silhouette readability against bright neutral ground.
sheet=Image.new('RGB',(1000,450),(244,242,238));d=ImageDraw.Draw(sheet)
for i,n in enumerate(['top','front','side','folded_side']):
 m=Image.open(R/f'{n}_mask.png');bbox=m.getbbox();m=m.crop(bbox);m.thumbnail((210,290));tile=Image.new('RGB',m.size,(30,32,34));sheet.paste(tile,(i*250+20,70),m);d.text((i*250+20,25),n,font=F,fill='black')
sheet.save(R/'checks'/'silhouette_read.png')
print(json.dumps(summary,indent=2))
print('Failed comparisons:',[x for x in checks if not x['pass']])
