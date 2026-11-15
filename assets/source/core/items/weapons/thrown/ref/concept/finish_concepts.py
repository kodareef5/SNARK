"""Compose exact backgrounds/masks, inventory sheet, comparison lineup and QA overlays.
Requires Pillow and NumPy. Run after build_concepts.py. Geometry is never warped.
"""
from pathlib import Path
import json,math,hashlib
from PIL import Image,ImageOps,ImageDraw,ImageFont
import numpy as np
R=Path(__file__).resolve().parent
BG=(214,212,206); S=1254
G=json.loads((R/'checks/geometry.json').read_text()); views={v['name']:v for v in G['views']}
FONT='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
def font(n):
 try:return ImageFont.truetype(FONT,n)
 except:return ImageFont.load_default()
def rect(a):
 yy,xx=np.where(a>=128)
 return [int(xx.min()),int(yy.min()),int(xx.max())+1,int(yy.max())+1] if len(xx) else None
measurements={}
for n,v in views.items():
 raw=Image.open(R/'renders'/f'{n}.png').convert('RGBA')
 # The requested screen basis is a reflection of a conventional camera basis.
 # Reflection changes handedness only; positions, shape and scale are preserved.
 im=ImageOps.mirror(raw);alpha=im.getchannel('A')
 bg=Image.new('RGBA',(S,S),BG+(255,)); bg.alpha_composite(im); bg.convert('RGB').save(R/f'{n}.png')
 # Matching area-coverage alpha is the antialiased white-on-black silhouette.
 alpha.save(R/f'{n}_mask.png')
 a=np.array(alpha);b=rect(a);measurements[n]={'canvas_px':[S,S],'ppm':v['ppm'],'origin_px':v['origin'],'bbox_50percent_px':b,'extent_m':[(b[2]-b[0])/v['ppm'],(b[3]-b[1])/v['ppm']],'solid_background_rgb':BG,'mask_source':'identical render alpha; AA edge coverage retained','clipped_at_frame':bool(a[0].max()>127 or a[-1].max()>127 or a[:,0].max()>127 or a[:,-1].max()>127)}
 # Verify no pixels beyond mask support differ from the background.
 c=np.array(bg.convert('RGB'));measurements[n]['background_exact']=bool(np.all(c[a==0]==np.array(BG)))
 measurements[n]['alpha_mask_exact']=bool(np.array_equal(a,np.array(Image.open(R/f'{n}_mask.png'))))

def crop(n):
 im=Image.open(R/f'{n}.png').convert('RGBA');a=Image.open(R/f'{n}_mask.png');im.putalpha(a)
 return im.crop(a.getbbox())
# Identical world scale, 1100 px/m; side views. The long arrow sets the canvas width.
line=Image.new('RGBA',(1400,1060),BG+(255,))
for n,xy in [('grenade_side',(140,135)),('bola_held_side',(680,135)),('arrow_side',(175,600)),('dart_side',(700,850))]:
 im=crop(n);r=1100/views[n]['ppm'];im=im.resize((round(im.width*r),round(im.height*r)),Image.Resampling.LANCZOS)
 line.alpha_composite(im,xy)
line.convert('RGB').save(R/'lineup.png')
# Read-size sheet: exact longest side at 128, 64, 32; rows weapons, columns sizes.
# No captions: all text is restricted to the companion check sheet.
sizes=Image.new('RGBA',(1050,900),BG+(255,))
layout=[]
for row,n in enumerate(['grenade_side','bola_lying_top','arrow_side','dart_side']):
 im=crop(n)
 for col,size in enumerate([128,64,32]):
  r=size/max(im.size);target=(max(1,round(im.width*r)),max(1,round(im.height*r)))
  small=im.resize(target,Image.Resampling.LANCZOS);x=65+col*330;y=70+row*205
  sizes.alpha_composite(small,(x+(128-small.width)//2,y+(128-small.height)//2))
  black=Image.new('RGBA',small.size,(0,0,0,0));black.putalpha(small.getchannel('A'));sizes.alpha_composite(black,(x+145+(128-black.width)//2,y+(128-black.height)//2))
  layout.append({'weapon':n,'longest_side_px':size,'color_cell':[x,y,128,128],'silhouette_cell':[x+145,y,128,128],'actual_resized_extent':target})
sizes.convert('RGB').save(R/'read_sizes.png')
labeled=sizes.convert('RGB');d=ImageDraw.Draw(labeled)
for i,x in enumerate([65,395,725]):d.text((x,18),str([128,64,32][i])+' px / colour + silhouette',font=font(16),fill=(45,48,44))
for i,n in enumerate(['GRENADE','BOLA LYING','ARROW','DART']):d.text((30,50+i*205),n,font=font(14),fill=(45,48,44))
labeled.save(R/'checks/read_sizes_labeled.png')
# Aligned original canvases; guide lines bridge the projection rows at common Z landmarks.
def overlay(name,names,zs):
 sheet=Image.new('RGB',(1500,110+len(names)*680),BG);d=ImageDraw.Draw(sheet)
 d.text((30,25),name+' | orthographic registration',font=font(26),fill=(33,38,36))
 for i,n in enumerate(names):
  im=Image.open(R/f'{n}.png'); im.thumbnail((627,627));xx=70;yy=95+i*680;sheet.paste(im,(xx,yy))
  v=views[n];ox=xx+v['origin'][0]/2;oy=yy+v['origin'][1]/2
  d.line((ox-10,oy,ox+10,oy),fill=(177,61,46),width=2);d.line((ox,oy-10,ox,oy+10),fill=(177,61,46),width=2)
  d.text((760,yy+15),n,font=font(24),fill=(33,38,36));d.text((760,yy+57),f"{v['ppm']} px/m | origin {v['origin']}",font=font(19),fill=(60,65,61))
  b=measurements[n]['bbox_50percent_px'];d.text((760,yy+92),f"mask bounds: {b}",font=font(18),fill=(60,65,61))
  d.text((760,yy+125),f"raster extent: {measurements[n]['extent_m'][0]*1000:.2f} x {measurements[n]['extent_m'][1]*1000:.2f} mm",font=font(18),fill=(60,65,61))
  if v['axis']!='front':
   for z in zs:
    gx=xx+(v['origin'][0]+(z-v['center'][2])*v['ppm'])/2
    if xx<=gx<xx+627:
     d.line((gx,yy,gx,yy+660),fill=(89,137,140),width=1);d.text((gx+2,yy+630),f'{z*1000:g}',font=font(11),fill=(45,91,94))
  d.rectangle((xx+b[0]/2,yy+b[1]/2,xx+b[2]/2,yy+b[3]/2),outline=(176,105,54),width=1)
  if i<len(names)-1 and v['axis']!='front' and views[names[i+1]]['axis']!='front':
   for z in zs:
    gx=xx+(v['origin'][0]+(z-v['center'][2])*v['ppm'])/2
    if xx<=gx<xx+627:d.line((gx,yy+660,gx,yy+680),fill=(89,137,140),width=1)
 sheet.save(R/'checks'/f'{name}_overlay.png')
overlay('grenade',['grenade_side','grenade_top','grenade_front'],[-.045,-.020,-.015,-.005,0,.015,.045,.066,.092])
overlay('bola_held',['bola_held_side','bola_held_top','bola_held_front'],[-.05,0,.355,.4,.434])
overlay('arrow',['arrow_side','arrow_top'],[-.72,-.7,-.6,-.035,0,.05])
overlay('arrow_details',['arrow_head_side','arrow_head_top','arrow_tail_side','arrow_front'],[-.035,-.005,0,.012,.05])
overlay('dart',['dart_side','dart_top','dart_front'],[-.165,-.1,-.09,-.01,0,.014])
overlay('bola_lying',['bola_lying_top','bola_pouch'],[-.4,0,.4])
# All-color and all-mask contact sheets for completeness/visual inspection.
for mask in [False,True]:
 out=Image.new('RGB',(1800,math.ceil(len(views)/3)*650),BG);d=ImageDraw.Draw(out)
 for i,n in enumerate(views):
  f=R/(n+('_mask' if mask else '')+'.png');im=Image.open(f).convert('RGB').resize((600,600),Image.Resampling.LANCZOS)
  x=i%3*600;y=i//3*650;out.paste(im,(x,y+35));d.text((x+15,y+8),n,font=font(18),fill=(30,35,31))
 out.save(R/'checks'/('all_masks.png' if mask else 'all_views.png'))
# Per-weapon tight inspection pages, with no deformation of any image.
for title,names in [('grenade',['grenade_side','grenade_top','grenade_front']),('bola',['bola_held_side','bola_held_top','bola_held_front','bola_lying_top','bola_pouch']),('arrow',['arrow_side','arrow_top','arrow_head_side','arrow_head_top','arrow_tail_side','arrow_front']),('dart',['dart_side','dart_top','dart_front'])]:
 out=Image.new('RGB',(1500,len(names)*360),BG);d=ImageDraw.Draw(out)
 for i,n in enumerate(names):
  im=crop(n);im.thumbnail((1390,280),Image.Resampling.LANCZOS);out.paste(im,(55+(1390-im.width)//2,55+i*360+(280-im.height)//2),im)
  d.text((30,i*360+12),n,font=font(22),fill=(30,35,31))
 out.save(R/'checks'/f'{title}_inspection.png')
result={'views':measurements,'inventory_layout':layout,'lineup_ppm':1100,'source_geometry_file':'geometry.json','projection_note':'Raw conventional cameras are mirrored horizontally once to realize the exact screen-axis bases in the brief. No resizing or deformation of final orthographic canvases.'}
(R/'checks'/'measurements.json').write_text(json.dumps(result,indent=2))
print('Composed',len(views),'colour views and matching masks, lineup, inventory sheet and inspection overlays.')
