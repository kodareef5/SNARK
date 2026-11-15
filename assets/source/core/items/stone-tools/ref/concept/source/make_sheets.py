"""Build scale lineup, native-pixel inventory read sheet and labelled audit copy."""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];BG=(214,212,206)
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',19)
small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',15)
def cutout(tool,view='side'):
 im=Image.open(ROOT/f'{tool}_{view}.png').convert('RGBA');m=Image.open(ROOT/f'{tool}_{view}_mask.png').convert('L');b=m.point(lambda a:255 if a>=128 else 0).getbbox();im.putalpha(m);return im.crop(b)
# Whole tools share the same scale: 560 px/m; place horizontally to avoid
# resampling the very thin spear and align the physical butt along a common line.
line=Image.new('RGB',(1254,1254),BG)
for tool,y in [('pick',290),('hatchet',610),('spear',940)]:
 im=cutout(tool)
 if tool!='spear':im=im.resize((round(im.width*.28),round(im.height*.28)),Image.Resampling.LANCZOS)
 line.paste(im,(48,y-im.height//2),im)
line.save(ROOT/'lineup.png')
# Side-view requirements are literal: spear side is its thin profile. Include
# an extra labelled broad-face check only in checks/, not on the clean sheet.
sheet=Image.new('RGB',(1254,1254),BG);meta=[]
for row,tool in enumerate(['pick','hatchet','spear']):
 im=cutout(tool);cy=250+row*370
 for col,size in enumerate([128,64,32]):
  w=size;h=max(1,round(im.height/im.width*w));small_im=im.resize((w,h),Image.Resampling.LANCZOS);x=260+col*350-w//2
  sheet.paste(small_im,(x,cy-55-h//2),small_im)
  black=Image.new('RGBA',small_im.size,(0,0,0,255));black.putalpha(small_im.getchannel('A'));sheet.paste(black,(x,cy+45-h//2),black)
  meta.append((tool,size,x,cy,w,h))
sheet.save(ROOT/'read_sizes.png')
check=sheet.copy();d=ImageDraw.Draw(check)
d.text((42,35),'INVENTORY READ CHECK  |  native pixel sizes',font=font,fill=(35,43,45))
for c,sz in enumerate([128,64,32]):d.text((230+c*350,94),f'{sz} px',font=font,fill=(35,43,45))
for r,tool in enumerate(['pick','hatchet','spear']):
 y=250+r*370;d.text((42,y-65),tool.upper(),font=font,fill=(35,43,45));d.text((42,y+35),'silhouette',font=small,fill=(65,68,64))
d.text((42,1180),'Spear side = +X (thin profile). Broad leaf face = +Y; see orthographic edge view.',font=small,fill=(65,68,64))
check.save(ROOT/'checks/read_sizes_labelled.png')
