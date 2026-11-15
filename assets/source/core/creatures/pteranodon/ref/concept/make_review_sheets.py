from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
import json
R=Path(__file__).resolve().parent
try:F=ImageFont.truetype('/System/Library/Fonts/Menlo.ttc',19)
except:F=ImageFont.load_default()
def sheet(names,out,cols,w,h):
 rows=(len(names)+cols-1)//cols;im=Image.new('RGB',(cols*w,rows*h),(244,242,237));d=ImageDraw.Draw(im)
 for i,n in enumerate(names):
  a=Image.open(R/f'{n}.png');a.thumbnail((w-24,h-40));x=(i%cols)*w+(w-a.width)//2;y=(i//cols)*h+34
  im.paste(a,(x,y));d.text(((i%cols)*w+15,(i//cols)*h+9),n,font=F,fill=(40,40,40))
 im.save(R/'checks'/out)
sheet(['top','underside','front'],'spread_review.png',1,1600,850)
sheet(['side','folded_side','folded_front','saddled_side','saddled_folded_side','saddle_detail'],'standing_saddle_review.png',3,680,710)
sheet(['head_side','head_front','three_quarter','saddled_three_quarter'],'detail_review.png',2,1000,850)
# Full-resolution joint crops with a fine pixel ruler to support manual picks.
for name,box in [('folded_side',(620,950,1160,1460)),('folded_front',(620,1000,1000,1460)),('side',(820,1030,1440,1340)),('top',(1450,400,1760,1380))]:
 a=Image.open(R/f'{name}.png').crop(box);d=ImageDraw.Draw(a)
 for x in range((box[0]//50+1)*50,box[2],50):
  d.line((x-box[0],0,x-box[0],a.height),fill=(60,160,170),width=1);d.text((x-box[0]+2,3),str(x),font=F,fill=(15,65,90))
 for y in range((box[1]//50+1)*50,box[3],50):
  d.line((0,y-box[1],a.width,y-box[1]),fill=(60,160,170),width=1);d.text((3,y-box[1]+2),str(y),font=F,fill=(15,65,90))
 a.save(R/'checks'/f'{name}_joint_review.png')
# Keep the inspection crop construction with the deliverable.
for name,box in [('saddled_side',(720,680,1100,1360)),('saddled_folded_side',(780,650,1160,1360))]:
 a=Image.open(R/f'{name}.png').crop(box);d=ImageDraw.Draw(a)
 for x in range((box[0]//50+1)*50,box[2],50):
  d.line((x-box[0],0,x-box[0],a.height),fill='#4798A0');d.text((x-box[0]+2,3),str(x),fill='black')
 for y in range((box[1]//50+1)*50,box[3],50):
  d.line((0,y-box[1],a.width,y-box[1]),fill='#4798A0');d.text((3,y-box[1]+2),str(y),fill='black')
 a.save(R/'checks'/f'{name}_rider_measure.png')
for name,box in [('folded_front',(730,670,870,790)),('folded_side',(450,680,820,800)),('front',(1540,810,1660,930))]:
 a=Image.open(R/f'{name}.png').crop(box).resize(((box[2]-box[0])*3,(box[3]-box[1])*3));d=ImageDraw.Draw(a)
 for y in range((box[1]//10+1)*10,box[3],10):
  d.line((0,(y-box[1])*3,a.width,(y-box[1])*3),fill='#4798A0');d.text((2,(y-box[1])*3+1),str(y),fill='black')
 a.save(R/'checks'/f'{name}_beak_check.png')
sheet(['top_mask','underside_mask','front_mask','side_mask','folded_side_mask','folded_front_mask'],'masks_review.png',2,850,500)
