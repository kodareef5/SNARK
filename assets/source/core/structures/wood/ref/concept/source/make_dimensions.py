"""Draw original orthographic envelope guides from the user's dimensions.
This creates a new technical drawing; it never processes a painted image.
"""
from pathlib import Path
import json
from shutil import copy2
from PIL import Image, ImageDraw, ImageFont

HERE=Path(__file__).resolve().parent
ROOT=HERE.parent
SPEC={
 'units':'mm',
 'foundation':{'width':3000,'depth':3000,'height':375},
 'wall':{'width':3000,'depth':200,'height':3000},
 'doorframe':{'width':3000,'depth':200,'height':3000,
              'opening':{'left':800,'bottom':0,'width':1400,'height':2310}},
 'windowframe':{'width':3000,'depth':200,'height':3000,
                'opening':{'left':900,'bottom':1200,'width':1200,'height':700}},
 'door':{'width':1400,'depth':80,'height':2310,'outside_hinge':'left','swing':'outward'},
 'ceiling':{'width':3000,'depth':3000,'height':250},
 'pillar':{'width':500,'depth':500,'height':3000},
 'stairs':{'width':3000,'depth':3000,'height':3000,'steps':10,'rise':300,'going':300},
}
(HERE/'dimensions.json').write_text(json.dumps(SPEC,indent=2)+'\n')

W,H=2600,2700
BG='#EEEBDD'; FRAME='#62432D'; BOARD='#C6A578'; OUTLINE='#43372C'
im=Image.new('RGB',(W,H),BG);d=ImageDraw.Draw(im)
def font(size,bold=False):
    path=next(p for p in (('/System/Library/Fonts/Supplemental/Arial Bold.ttf','/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf') if bold else ('/System/Library/Fonts/Supplemental/Arial.ttf','/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf')) if Path(p).exists())
    return ImageFont.truetype(path,size)
f=font(27);small=font(24);heading=font(34,True);title=font(46,True)
d.text((60,35),'WOOD TIER / EXACT ENVELOPES',font=title,fill=OUTLINE)
d.text((60,100),'Original orthographic construction guide · millimetres · no perspective · same scale in every view',font=f,fill=OUTLINE)
d.text((60,145),'Paintings define the craft. These outlines and DESIGN.md define the geometry. Fill colour does not indicate a solid wood volume.',font=small,fill=OUTLINE)
S=.12

def line(points,colour=OUTLINE,width=3):d.line(points,fill=colour,width=width)
def rect(x,y,w,h,fill=BOARD):
    d.rectangle((round(x),round(y),round(x+w*S),round(y+h*S)),fill=fill,outline=OUTLINE,width=3)
def dim_h(x,y,w,label):
    end=x+w*S;line([(x,y),(end,y)],width=2)
    for xx in [x,end]:line([(xx,y-8),(xx,y+8)],width=2)
    box=d.textbbox((0,0),label,font=small)
    d.text(((x+end)/2-(box[2]-box[0])/2,y-34),label,font=small,fill=OUTLINE)
def dim_v(x,y,h,label):
    end=y+h*S;line([(x,y),(x,end)],width=2)
    for yy in [y,end]:line([(x-8,yy),(x+8,yy)],width=2)
    d.text((x+12,(y+end)/2-14),label,font=small,fill=OUTLINE)
def panel(i,name,subtitle):
    x=60+(i%2)*1280;y=230+(i//2)*590
    d.rounded_rectangle((x,y,x+1220,y+575),radius=12,fill='#F8F5EA',outline='#C4B9A6',width=2)
    d.text((x+25,y+20),name,font=heading,fill=OUTLINE)
    d.text((x+25,y+65),subtitle,font=small,fill=OUTLINE)
    return x+65,y+140
def note(x,y,lines):
    for k,t in enumerate(lines):d.text((x,y+k*38),t,font=f,fill=OUTLINE)

for i,key in [(0,'foundation'),(5,'ceiling')]:
    e=SPEC[key]
    x,y=panel(i,key.upper(),'PLAN + EDGE ELEVATION')
    rect(x,y,e['width'],e['depth']);dim_h(x,y-12,e['width'],'3000')
    dim_v(x+e['width']*S+20,y,e['depth'],'3000')
    for u in range(1,12):line([(x+u*30,y),(x+u*30,y+360)],'#B49369',1)
    xx=x+610;yy=y+120
    rect(xx,yy,3000,e['height'],FRAME);dim_h(xx,yy-12,3000,'3000')
    dim_v(xx+380,yy,e['height'],str(e['height']))
    note(xx,yy+120,['Deck / roof is level.','No overhang or raised border.'])

for i,key in [(1,'wall'),(2,'doorframe'),(3,'windowframe')]:
    e=SPEC[key];x,y=panel(i,key.upper(),'FRONT ELEVATION + END ELEVATION')
    rect(x,y,3000,3000);dim_h(x,y-12,3000,'3000')
    dim_v(x+380,y,3000,'3000')
    if 'opening' in e:
        o=e['opening'];xx=x+o['left']*S;yy=y+(3000-o['bottom']-o['height'])*S
        rect(xx,yy,o['width'],o['height'],fill='#F8F5EA')
        d.text((x+590,y+20),'CLEAR OPENING',font=heading,fill=OUTLINE)
        note(x+590,y+75,[f"{o['width']} wide × {o['height']} high",f"Left edge: {o['left']}",f"Sill / bottom: {o['bottom']}",f"Head: {o['bottom']+o['height']}"])
    else:
        for a,A in [(0,90),(1430,1570),(2910,3000)]:rect(x+a*S,y,A-a,3000,FRAME)
        rect(x,y,3000,190,FRAME);rect(x,y+(3000-180)*S,3000,180,FRAME)
        note(x+590,y+20,['Both faces finished alike.','Frame: 180 deep.','All relief stays within 200.'])
    rect(x+1080,y,200,3000,FRAME)
    d.text((x+1020,y+375),'200 deep',font=small,fill=OUTLINE)

x,y=panel(4,'DOOR','OUTSIDE FACE + DEPTH ENVELOPE')
e=SPEC['door'];rect(x,y,1400,2310);dim_h(x,y-12,1400,'1400');dim_v(x+190,y,2310,'2310')
for z in [320,1990]:
    yy=y+(2310-z)*S;d.rectangle((x,yy-4,x+800*S,yy+4),fill='#302D29')
for xx in [240,470,700,940,1180]:line([(x+xx*S,y),(x+xx*S,y+2310*S)],'#A0754B',1)
rect(x+470,y,80,2310,FRAME)
note(x+570,y+10,['80 total depth','Includes ledges and hardware.','Hinge LEFT from outside.','Opens OUTWARD.','Rear brace: lower hinge','to upper latch corner.'])

x,y=panel(6,'PILLAR','FRONT ELEVATION + PLAN ENVELOPE')
e=SPEC['pillar'];rect(x,y,500,3000,'#E1D2B9');dim_h(x,y-12,500,'500');dim_v(x+100,y,3000,'3000')
shaft0=x+(500-380)*S/2
rect(shaft0,y,380,3000,FRAME);rect(x,y,500,380,FRAME);rect(x,y+2700*S,500,300,FRAME)
rect(x+380,y+120,500,500,FRAME)
note(x+610,y+20,['500 × 500 maximum head / foot','380 × 380 shaft','Ceiling shoulder at Z=2750','Top of pillar at Z=3000','No wider base or capital.'])

x,y=panel(7,'STAIRS','SIDE PROFILE + FRONT ELEVATION')
pts=[(x,y+360),(x,y+324)]
for k in range(10):
    X=x+(k+1)*36;Y=y+360-(k+1)*36
    pts.append((X,Y))
    if k<9:pts.append((X,Y-36))
pts.extend([(x+360,y+360),(x,y+360)])
d.polygon(pts,fill=BOARD,outline=OUTLINE,width=3)
dim_h(x,y+392,3000,'3000 run');dim_v(x+380,y,3000,'3000 rise')
xx=x+650;rect(xx,y,3000,3000,BOARD)
for k in range(1,10):line([(xx,y+k*36),(xx+360,y+k*36)])
dim_h(xx,y-12,3000,'3000 width')
d.text((x,y+400),'10 rises × 300 = 3000. Each going = 300. Top tread is the highest point.',font=small,fill=OUTLINE)

d.text((60,2635),'Wall origins sit on floor edge lines. A ceiling occupies the upper 250 mm of wall height; its top is flush at Z=3000.',font=f,fill=OUTLINE)
im.save(HERE/'dimensions.png')
copy2(HERE/'dimensions.png',ROOT/'dimensions.png')
print(f'Created {W} × {H} exact dimension guide and dimensions.json')
