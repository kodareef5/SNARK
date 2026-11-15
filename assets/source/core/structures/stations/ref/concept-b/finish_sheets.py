"""Exact background compositing, alpha silhouettes, scaled sheets and raster checks."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from pathlib import Path
import numpy as np, json, math, sys, time
ROOT=Path(__file__).resolve().parent
BG=(214,212,206);SIZE=1254;PPM=650
VIEWS=['front','side','left','top','back']
FONT='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
def font(s):return ImageFont.truetype(FONT,s)
def source(s,v):
 im=Image.open(ROOT/'renders'/f'{s}_{v}.png').convert('RGBA')
 if v.endswith('_lit') and (ROOT/'renders'/f'{s}_{v}_firemask.png').exists():
  out=np.array(Image.open(ROOT/'renders'/f'{s}_{v[:-4]}.png').convert('RGBA'))
  lit=np.array(im);mask=np.array(Image.open(ROOT/'renders'/f'{s}_{v}_firemask.png').convert('RGB')).max(axis=2)>8
  out[mask]=lit[mask];im=Image.fromarray(out)
 return im
def blend(im):
 bg=Image.new('RGBA',im.size,BG+(255,));bg.alpha_composite(im);return bg.convert('RGB')
def trim(im):return im.crop(im.getchannel('A').getbbox())
def checklabel(d,xy,s,size=20,fill=(50,54,53)):d.text(xy,s,font=font(size),fill=fill)
def main():
 # Material swatches are check-sheet content and can carry labels.
 names=['stone','mortar','clay','wood','paint','steel','iron']
 sw=Image.new('RGB',(1400,240),BG);sd=ImageDraw.Draw(sw)
 for i,n in enumerate(names):
  sw.paste(Image.open(ROOT/'textures'/f'{n}.png').resize((200,200)),(i*200,30));checklabel(sd,(i*200+8,6),n,16)
 sw.save(ROOT/'checks'/'material_swatches.png')
 for s in ['forge','fabricator']:
  for v in VIEWS+['hero','front_lit','hero_lit']:
   path=ROOT/'renders'/f'{s}_{v}.png'
   if not path.exists():continue
   im=source(s,v)
   if 'hero' in v:
    # Soft neutral contact shadow is presentation-only, never part of a mask or icon.
    a=np.asarray(im.getchannel('A'));ys,xs=np.where(a>128); floor=int(ys.max())
    sh=Image.new('L',im.size,0);d=ImageDraw.Draw(sh)
    x0,x1=int(xs.min()),int(xs.max());cx=(x0+x1)/2
    d.ellipse((cx-(x1-x0)*.41,floor-46,cx+(x1-x0)*.45,floor+13),fill=54)
    sh=sh.filter(ImageFilter.GaussianBlur(21))
    bg=Image.new('RGBA',im.size,BG+(255,));shadow=Image.new('RGBA',im.size,(63,58,52,0));shadow.putalpha(sh);bg.alpha_composite(shadow);bg.alpha_composite(im);out=bg.convert('RGB')
   else:out=blend(im)
   out.save(ROOT/f'{s}_{v}.png')
   if v in VIEWS:im.getchannel('A').save(ROOT/f'{s}_{v}_mask.png')
 # Early previews can be made before all orthographic views finish.
 if not all((ROOT/f'{s}_{v}.png').exists() for s in ['forge','fabricator'] for v in VIEWS):
  for s in ['forge','fabricator']:
   ims=[(v,Image.open(ROOT/f'{s}_{v}.png')) for v in ['front','hero','front_lit','hero_lit'] if (ROOT/f'{s}_{v}.png').exists()]
   sheet=Image.new('RGB',(1254,1254),BG)
   for i,(v,im) in enumerate(ims):sheet.paste(im.resize((627,627),Image.Resampling.LANCZOS),((i%2)*627,(i//2)*627))
   sheet.save(ROOT/'checks'/f'{s}_preview.png')
  return
 # Lineup uses original orthographic pixels, 650px/m, foot line at y=1230.
 sheet=Image.new('RGB',(4650,1340),BG);x=90;ground=1230
 for s,v in [('forge','front'),('forge','front_lit'),('fabricator','front'),('fabricator','front_lit')]:
  im=trim(source(s,v));sheet.paste(im,(x,ground-im.height),im);x+=im.width+75
 # Neutral anonymous 1.80m human silhouette, hands at sides, flat shoes.
 person=Image.new('RGBA',(300,1170),(0,0,0,0));d=ImageDraw.Draw(person);c=(135,136,132,255)
 d.ellipse((109,0,191,105),fill=c)
 d.polygon([(127,91),(173,91),(176,126),(216,151),(230,243),(246,430),(229,566),(208,567),(205,433),(190,301),(184,503),(202,707),(207,1117),(224,1147),(221,1170),(157,1170),(148,1123),(151,774),(139,657),(128,785),(118,1122),(111,1170),(48,1170),(45,1148),(66,1119),(78,706),(101,503),(103,301),(91,433),(89,567),(69,567),(54,429),(70,242),(85,153),(124,126)],fill=c)
 sheet.paste(person,(x,ground-1170),person);sheet.save(ROOT/'lineup.png')
 # Inventory proof: no text in the requested sheet; labelled legend in checks.
 read=Image.new('RGB',(900,900),BG)
 order=[('forge','hero'),('forge','hero_lit'),('fabricator','hero'),('fabricator','hero_lit')]
 xs=[55,237,358,505,687,808]
 for row,(s,v) in enumerate(order):
  im=trim(source(s,v))
  for j,w in enumerate([128,64,32]):
   h=round(im.height*w/im.width);thumb=im.resize((w,h),Image.Resampling.LANCZOS)
   read.paste(thumb,(xs[j],row*220+18+(195-h)//2),thumb)
   black=Image.new('RGBA',thumb.size,(0,0,0,0));black.putalpha(thumb.getchannel('A'))
   read.paste(black,(xs[j+3],row*220+18+(195-h)//2),black)
 read.save(ROOT/'read_sizes.png')
 labelled=read.copy();d=ImageDraw.Draw(labelled)
 for row,(s,v) in enumerate(order):checklabel(d,(12,row*220+202),f'{s.upper()} — '+('LIT' if v.endswith('lit') else 'OUT'),14)
 for j,w in enumerate([128,64,32,128,64,32]):checklabel(d,(xs[j],4),f'{w}px',14)
 labelled.save(ROOT/'checks'/'read_sizes_annotated.png')
 # High-resolution contact sheets: each requested colour picture appears once.
 for s in ['forge','fabricator']:
  sheet=Image.new('RGB',(2508,1324),BG);d=ImageDraw.Draw(sheet)
  for i,v in enumerate(VIEWS+['front_lit','hero','hero_lit']):
   x=i%4*627;y=i//4*662
   sheet.paste(Image.open(ROOT/f'{s}_{v}.png').resize((627,627),Image.Resampling.LANCZOS),(x,y+35));checklabel(d,(x+18,y+7),f'{s.upper()} / {v}',18)
  sheet.save(ROOT/'checks'/f'{s}_all_views.png')
 # All delivered mask silhouettes, shown in compact inspection sheets.
 for s in ['forge','fabricator']:
  sh=Image.new('RGB',(2508,662),(20,20,20));d=ImageDraw.Draw(sh)
  for i,v in enumerate(VIEWS):
   im=Image.open(ROOT/f'{s}_{v}_mask.png').convert('RGB').resize((480,480),Image.Resampling.LANCZOS);sh.paste(im,(i*500,60));checklabel(d,(i*500+15,20),v.upper(),22,fill=(240,240,240))
  sh.save(ROOT/'checks'/f'{s}_masks.png')
 # Raster bounds and shared coordinate alignment.
 checks={'canvas':[1254,1254],'scale_px_per_m':650,'centre_px':[627,627],'mask_boundary':'alpha >= 128; fractional alpha retained in delivered masks','stations':{}}
 for s in ['forge','fabricator']:
  dims={};pix={}
  for v in VIEWS:
   a=np.array(Image.open(ROOT/f'{s}_{v}_mask.png'));yy,xx=np.where(a>=128)
   box=[int(xx.min()),int(yy.min()),int(xx.max()+1),int(yy.max()+1)]
   wh=[(box[2]-box[0])/650,(box[3]-box[1])/650];dims[v]=wh;pix[v]=box
  width=[dims[v][0] for v in ['front','back','top']]
  depth=[dims[v][0] for v in ['side','left']]+[dims['top'][1]]
  height=[dims[v][1] for v in ['front','side','left','back']]
  a=np.asarray(Image.open(ROOT/f'{s}_front.png')).astype(int);b=np.asarray(Image.open(ROOT/f'{s}_front_lit.png')).astype(int)
  changed=np.max(abs(a-b),axis=2)>0
  checks['stations'][s]={'raster_bounds_xyxy':pix,'dimensions_m':dims,'width_spread_m':max(width)-min(width),'depth_spread_m':max(depth)-min(depth),'height_spread_m':max(height)-min(height),'front_state_changed_pixels':int(changed.sum()),'non_fire_pixels_changed':int((changed & ~(np.asarray(Image.open(ROOT/'renders'/f'{s}_front_lit_firemask.png').convert('RGB')).max(axis=2)>8)).sum())}
  # Cyan guide rows are projected directly from world Z. All orthos use same scale.
  sh=Image.new('RGB',(2508,1394),BG);d=ImageDraw.Draw(sh)
  h=1.7 if s=='forge' else 1.3
  levels=[0,.2,.58,.8,1.15,1.7] if s=='forge' else [0,.1,.4,.85,1.05,1.3]
  for col,v in enumerate(['front','side','left','back']):
   sh.paste(Image.open(ROOT/f'{s}_{v}.png').resize((627,627),Image.Resampling.LANCZOS),(col*627,56));checklabel(d,(col*627+14,17),f'{v.upper()}  |  325 px/m',20)
  for z in levels:
   y=56+round((627+(h/2-z)*650)/2);d.line((0,y,2507,y),fill=(36,137,149),width=1);checklabel(d,(4,y-18),f'z {z:.2f} m',14,fill=(14,90,100))
  for col,v in enumerate(['top','top','top','top']):
   im=Image.open(ROOT/f'{s}_top.png')
   if col==1:im=im.transpose(Image.Transpose.ROTATE_270)
   if col==2:im=im.transpose(Image.Transpose.ROTATE_90)
   if col==3:im=im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
   sh.paste(im.resize((627,627),Image.Resampling.LANCZOS),(col*627,727))
   checklabel(d,(col*627+14,695),'TOP / corresponding axis',18)
   view=['front','side','left','back'][col]
   for px in [pix[view][0],pix[view][2]]:
    x=col*627+round(px/2);d.line((x,56,x,1354),fill=(189,107,48),width=1)
  checklabel(d,(18,1363),'Cyan: common heights. Ochre: common width / depth. Top images rotated only on this check sheet.',17)
  sh.save(ROOT/'checks'/f'{s}_alignment.png')
  # Difference proof red means changed pixel. Original fire patches are the only permitted change.
  delta=Image.new('RGB',(1254,1254),BG);arr=np.array(delta);arr[changed]=(238,120,30);delta=Image.fromarray(arr)
  ImageDraw.Draw(delta).text((25,25),f'{s.upper()} — FRONT STATE DIFFERENCE',font=font(22),fill=(45,45,45));delta.save(ROOT/'checks'/f'{s}_state_difference.png')
 for s in ['forge','fabricator']:
  sh=Image.new('RGB',(1254,1254),BG)
  for i,v in enumerate(['front','hero','front_lit','hero_lit']):sh.paste(Image.open(ROOT/f'{s}_{v}.png').resize((627,627),Image.Resampling.LANCZOS),((i%2)*627,(i//2)*627))
  sh.save(ROOT/'checks'/f'{s}_preview.png')
 (ROOT/'checks'/'raster_measurements.json').write_text(json.dumps(checks,indent=2))
 print(json.dumps(checks,indent=2))
if __name__=='__main__':main()
