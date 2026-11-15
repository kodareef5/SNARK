"""L-shaped front/side/top registration sheets with bridging X/Y/Z guides."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json
R=Path(__file__).resolve().parent;g=json.loads((R/'checks/geometry.json').read_text());V={x['name']:x for x in g['views']}
BG=(214,212,206);font=lambda n:ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',n)
for title,side,top,front,zs,ys in [
 ('grenade','grenade_side','grenade_top','grenade_front',[-.045,-.015,0,.015,.045,.066,.092],[-.041,-.038,0,.038,.041,.046]),
 ('bola_held','bola_held_side','bola_held_top','bola_held_front',[-.05,0,.355,.4,.434],[-.06287,-.02887,0,.02374,.05774,.09174]),
 ('arrow_head','arrow_head_side','arrow_head_top','arrow_front',[-.035,-.005,0,.012,.05],[-.0065,-.003,0,.003,.0065,.0225]),
 ('dart','dart_side','dart_top','dart_front',[-.165,-.100,-.09,-.01,0,.014],[-.015,-.0075,0,.0075,.015])]:
 out=Image.new('RGB',(1500,1500),BG);d=ImageDraw.Draw(out)
 d.text((40,20),title.upper()+' | shared model, calibrated orthographic views',font=font(23),fill=(31,41,38))
 origins={side:(45,100),front:(825,100),top:(45,820)}
 for name,(x,y) in origins.items():
  im=Image.open(R/(name+'.png')).resize((627,627),Image.Resampling.LANCZOS);out.paste(im,(x,y));d.text((x,y-30),name,font=font(19),fill=(31,41,38))
  v=V[name];ox=x+v['origin'][0]/2;oy=y+v['origin'][1]/2;d.line((ox-8,oy,ox+8,oy),fill=(177,61,46),width=2);d.line((ox,oy-8,ox,oy+8),fill=(177,61,46),width=2)
 for z in zs:
  x=45+(V[side]['origin'][0]+z*V[side]['ppm'])/2
  if 45<=x<672:
   d.line((x,90,x,1450),fill=(68,119,127),width=1);d.text((x+2,730),f'Z {z*1000:g} mm',font=font(11),fill=(42,81,87))
 for y in ys:
  yy=100+(627-y*V[side]['ppm'])/2
  if 100<=yy<727:
   d.line((35,yy,1455,yy),fill=(132,112,70),width=1);d.text((690,yy+2),f'Y {y*1000:g}',font=font(12),fill=(88,74,47))
 d.text((815,890),'Blue: shared Z stations\nOchre: shared Y heights\nRed: specified origins\n\nAll panels at 50% of native pixels.\nSource images are not stretched.\nSee part_measurements.json for\nisolated-part raster measurements.',font=font(21),fill=(43,51,45),spacing=10)
 out.save(R/'checks'/(title+'_registration.png'))
print('Saved four L-shaped projection registration sheets.')
