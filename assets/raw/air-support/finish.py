"""Finish samples, optical coatings and service plates for the freight rig's shared atlas."""
from pathlib import Path
from random import Random
from math import sin, cos, hypot, atan2, pi
from PIL import Image, ImageDraw

HERE = Path(__file__).parent
CELL = 128
SWATCHES = [
    ((44, 53, 59), 125, 160), ((68, 80, 84), 126, 130), ((140, 149, 147), 86, 209),
    ((204, 207, 189), 133, 54), ((236, 231, 211), 121, 55), ((29, 73, 83), 50, 108),
    ((212, 95, 38), 121, 51), ((239, 167, 64), 112, 63), ((111, 213, 219), 55, 127),
    ((33, 35, 39), 218, 8), ((197, 50, 41), 111, 69), ((24, 45, 74), 37, 130),
    ((105, 144, 132), 116, 67), ((47, 115, 147), 62, 142),
]
base, normal, orm = [Image.new("RGB", (CELL * 4, CELL * 4), c) for c in [(51, 61, 62),(128,128,255),(255,138,63)]]
rng = Random(902)
for index, (color, rough, metal) in enumerate(SWATCHES):
    ox, oy = index % 4 * CELL, index // 4 * CELL
    scratches = {rng.randrange(5, CELL-5): (rng.randrange(4,CELL//2),rng.randrange(CELL//2,CELL-4)) for _ in range(6)}
    glass = index in (5, 8, 11, 13)
    for y in range(CELL):
        brushed = (rng.random()-.5)*(7 if metal>150 else 1.5)
        for x in range(CELL):
            p = (ox+x,oy+y)
            wear = int(not glass and y in scratches and scratches[y][0] < x < scratches[y][1] and rng.random() > .15)
            grain = rng.gauss(0,.37 if glass else 1.6)+brushed+1.3*sin(x/23+y/17)
            edge = max(0,1-min(x,CELL-1-x,y,CELL-1-y)/9)
            tone = grain + (8 if metal<150 else 17)*wear - (0 if glass else 6)*edge
            highlight = 0
            if glass:
                sweep = (x-y*.51)/CELL
                highlight = max(0,1-abs(sweep-.21)/.28)**2*(23 if index in (5,8) else 31)
            if index == 11:
                radial = hypot((x-CELL*.43)/CELL,(y-CELL*.54)/CELL)
                tone += sin(radial*118)*2.5+6*cos(radial*10)
            base.putpixel(p, tuple(round(max(0,min(255,c+tone+highlight*(.43 if j==0 else .85 if j==1 else 1)))) for j,c in enumerate(color)))
            normal.putpixel(p, (int(128+rng.gauss(0,.3 if glass else 1.8)),int(128+brushed*.6+wear*8),255))
            orm.putpixel(p,(int(251-edge*11),int(max(0,min(255,rough+grain*1.3+wear*14))),int(min(255,metal+wear*16))))

# Each letter is a five-stroke industrial stencil drawn for the painted service plates.
letters = {
 'A':["010","101","111","101","101"], 'C':["111","100","100","100","111"],
 'D':["110","101","101","101","110"], 'E':["111","100","110","100","111"],
 'F':["111","100","110","100","100"], 'I':["111","010","010","010","111"],
 'K':["101","101","110","101","101"], 'L':["100","100","100","100","111"],
 'O':["111","101","101","101","111"], 'P':["110","101","110","100","100"],
 'R':["110","101","110","101","101"], 'S':["111","100","111","001","111"],
 'T':["111","010","010","010","010"], 'U':["101","101","101","101","111"],
 'V':["101","101","101","101","010"], '0':["111","101","101","101","111"],
 '4':["101","101","111","001","001"], '6':["111","100","111","101","111"],
}
draw = ImageDraw.Draw(base)
ox, oy = 2*CELL,3*CELL
for i, text in enumerate(["LIFT 04","OPTIC 6","LOCK","SERVICE"]):
    y=oy+i*32
    draw.rectangle((ox,y,ox+127,y+31),fill=(40,57,57))
    draw.rectangle((ox+2,y+2,ox+125,y+29),outline=(153,158,136))
    draw.rectangle((ox+5,y+5,ox+9,y+26),fill=(231,127,52))
    scale=3
    for j,char in enumerate(text):
        for row,bits in enumerate(letters.get(char,[])):
            for col,bit in enumerate(bits):
                if bit=='1':
                    left=ox+16+j*4*scale+col*scale
                    top=y+8+row*scale
                    draw.rectangle((left,top,left+scale-1,top+scale-1), fill=(232,225,202))
    for e in range(5):
        draw.rectangle((ox+113+2*e,y+21-e,ox+113+2*e,y+25),fill=(209,151,81))
# The glass looks into a dark pupil with overlapping iris leaves and two reflected softboxes.
for y in range(CELL):
    for x in range(CELL):
        px, py = (x-CELL*.50)/(CELL*.437),(y-CELL*.50)/(CELL*.437)
        radius=hypot(px,py)
        angle=atan2(py,px)
        iris=radius*(.94+.065*cos(6*angle))
        leaf=(1+cos(6*(angle+.60*radius)))*.5
        ring=max(0,1-abs(radius-.81)/.036)+.50*max(0,1-abs(radius-.64)/.021)
        pupil=min(1,max(0,(iris-.262)/.043))
        soft=max(0,1-((px+.36)/.43)**2-((py+.38)/.17)**2)**2
        glint=max(0,1-((px-.26)/.11)**2-((py+.28)/.08)**2)**2
        lower=max(0,1-((px-.38)/.36)**2-((py-.42)/.20)**2)**2
        tint=(6+12*pupil+15*ring+15*leaf*pupil,11+24*pupil+37*ring+15*leaf*pupil,17+42*pupil+46*ring+10*leaf*pupil)
        rgb=tuple(int(min(255,max(0,tint[k]+soft*[43,110,140][k]+glint*110+lower*[31,38,58][k]))) for k in range(3))
        at=(3*CELL+x,3*CELL+y)
        base.putpixel(at,rgb)
        normal.putpixel(at,(int(128+px*10),int(128-py*10),255))
        orm.putpixel(at,(255,int(74+6*radius),int(20+radius*18)))
for name, picture in [('base',base),('normal',normal),('finish',orm)]:
    picture.save(HERE / (name+'.png'),optimize=True)
