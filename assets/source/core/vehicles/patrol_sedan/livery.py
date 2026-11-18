"""Enamel markings, instrument faces, optics, steel and wear for unit 27. UV rectangles in atlas pixels."""
from pathlib import Path
import math
import random

RECT = {"lettering": (0, 0, 256, 128), "crest": (256, 0, 256, 128), "navy": (0, 128, 256, 128),
        "roof": (256, 128, 128, 128), "deck": (384, 128, 128, 64), "plate": (384, 192, 128, 64)}
SWATCHES = [
    ("ivory", (220,222,214), 63, 63), ("rubber", (33,36,39), 172, 0), ("tread", (37,39,40), 179, 0),
    ("steel", (102,115,124), 84, 180), ("hub", (186,199,198), 56, 206), ("glass", (60,80,90), 48, 109),
    ("smoke", (50,65,74), 66, 64), ("black", (30,37,43), 94, 48),
    ("darkrim", (53,63,70), 73, 138), ("grille", (27,33,37), 148, 11), ("white", (211,232,235), 43, 46),
    ("amber", (227,145,46), 56, 55), ("red", (172,35,42), 55, 46), ("ruby", (220,40,59), 43, 28),
    ("blue", (36,94,222), 43, 34), ("seal", (24,27,28), 144, 0),
    ("linen", (86,96,98), 166, 0), ("vinyl", (63,73,77), 141, 0), ("carpet", (43,48,51), 204, 0),
    ("dash", (48,56,60), 148, 0), ("gauge", (18,29,35), 85, 12), ("radio", (27,36,36), 105, 16),
    ("gold", (190,155,89), 86, 111), ("liner", (206,208,197), 164, 0),
    ("mirror", (139,158,171), 38, 216), ("reflect", (185,204,212), 57, 186), ("vent", (42,48,48), 163, 0),
    ("disco", (111,110,104), 123, 129), ("indigo", (39,51,70), 67, 86), ("chrome", (151,161,162), 95, 155),
]
for i, (name, *_) in enumerate(SWATCHES):
    RECT[name] = ((i % 8) * 64, 256 + (i // 8) * 64, 64, 64)


def paint():
    from PIL import Image, ImageDraw, ImageFont
    maps = {}
    for name, mode, color in [("base","RGB",(0,0,0)),("height","L",128),("normal","RGB",(128,128,255)),
                              ("packed","RGB",(255,94,30)),("mask","RGB",(0,0,0)),
                              ("hurt","RGBA",(0,0,0,0)),("decay","RGBA",(0,0,0,0))]:
        maps[name] = Image.new(mode, (512,512), color)
    rng = random.Random(4927)
    def font(size, bold=True):
        # DejaVu ships with Pillow on many platforms and is available as a system face elsewhere.
        return ImageFont.truetype("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf", size)
    def centered(draw, x, y, text, size, ink, bold=True, stroke_width=0, stroke_fill=None):
        draw.text((x, y), text, font=font(size, bold), fill=ink, anchor="mm", stroke_width=stroke_width, stroke_fill=stroke_fill)

    navy, ink, brass, cream = (35,50,66), (33,50,65), (182,146,78), (227,226,216)
    recipes = {k:(c,r,m) for k,c,r,m in SWATCHES}
    recipes.update(lettering=(cream,65,71),crest=(cream,65,71),navy=(navy,60,96),roof=(cream,68,61),
                   deck=(navy,63,68),plate=((231,223,190),117,13))
    for name,(x0,y0,w,h) in RECT.items():
        base,rough,metal = recipes[name]
        patch = {role:im.crop((x0,y0,x0+w,y0+h)) for role,im in maps.items()}
        color, height, packed = patch["base"].load(), patch["height"].load(), patch["packed"].load()
        for y in range(h):
            for x in range(w):
                n = rng.random()-.5
                grain, tone = 0, n*3
                if name in ("navy","ivory","roof","lettering","crest","deck"):
                    tone += 3 * (1-y/h)
                if name in ("white","amber","red","ruby","blue"):
                    grain = (5 if x%6 < 2 else -2) + (3 if y%11 < 3 else 0)
                    tone += grain * 1.6 + 9*math.sin((y/h)*math.pi)
                if name in ("linen","vinyl","carpet"):
                    grain = (7*n if name=="carpet" else 2*n+2*(x%3==y%3))
                    tone += grain
                if name=="linen":
                    tone -= 4*(x%9==0)
                if name=="tread":
                    grain = -11*(int(x + .52*abs(y-h*.5))%13<3)
                    tone += grain
                if name in ("mirror","hub","reflect"):
                    tone += 18*(1-y/h)-17*(y/h>.56+.12*x/w)
                if name in ("grille","vent"):
                    dark = ((x + (y//6%2)*3)%7>1 and y%6>1) if name=="grille" else y%7>2
                    grain = -8 if dark else 5
                    tone += grain
                if name in ("navy","steel","hub","disco"):
                    tone += 2*math.sin(x*.22+y*.08)
                color[x,y] = tuple(max(0,min(255,round(c+tone))) for c in base)
                height[x,y] = max(0,min(255,round(128+grain)))
                packed[x,y] = (255,max(0,min(255,round(rough+n*6))),metal)
        d=ImageDraw.Draw(patch["base"])
        if name in ("lettering","crest"):
            # Widely spaced belt and rocker stripes continue across both moving doors.
            for y,col,width in [(26,brass,2),(29,ink,2),(103,ink,5),(107,brass,2)]:
                d.line((0,y,w,y),fill=col,width=width)
            if name=="lettering":
                centered(d,128,58,"POLICE",49,ink)
                centered(d,128,87,"H A R B O R   D I S T R I C T",11,ink)
            else:
                # Department shoulder patch, with lighthouse, lens room and waves.
                d.polygon([(101,39),(126,33),(152,39),(150,63),(143,77),(127,89),(109,79),(102,64)],fill=brass)
                d.polygon([(104,41),(126,36),(149,41),(147,62),(141,74),(127,85),(112,76),(105,63)],fill=ink)
                d.ellipse((114,44,140,70),outline=brass,width=1)
                d.polygon([(123,65),(125,54),(130,54),(132,65)],fill=cream)
                d.rectangle((124,50,131,53),fill=brass)
                d.polygon([(122,50),(127,46),(133,50)],fill=cream)
                for y in [68,73]:
                    d.line([(112,y),(117,y-2),(121,y),(126,y-2),(130,y),(135,y-2),(142,y)], fill=cream,width=1)
        if name=="roof":
            centered(d,64,40,"27",54,ink)
        if name=="deck":
            centered(d,64,33,"P O L I C E",19,cream)
        if name=="plate":
            d.rounded_rectangle((6,5,w-7,h-6),radius=5,outline=ink,width=2)
            centered(d,64,16,"H A R B O R",10,ink)
            centered(d,64,38,"HD  027",25,ink)
        if name=="gauge":
            for x in (18,45):
                d.arc((x-13,17,x+13,43),140,402,fill=cream,width=2)
                for a in range(145,405,29):
                    ang=math.radians(a)
                    d.line([(x+14*math.cos(ang),30+14*math.sin(ang)),(x+11*math.cos(ang),30+11*math.sin(ang))],fill=cream)
                d.line((x,30,x+(4 if x==18 else -5),21),fill=(233,120,62),width=2)
                d.rectangle((x-7,47,x+6,49),fill=(112,187,168))
        if name=="radio":
            d.rounded_rectangle((7,9,56,31),2,fill=(57,86,81))
            centered(d,32,20,"CH  12",11,(194,218,166))
            for y in (40,48):
                for x in range(10,51,8):
                    d.rectangle((x,y,x+5,y+3),fill=(150,157,149))
        if name in ("ivory","linen","hub"):
            # Most of the cruiser has fixed fleet colours; these parts have a light selectable tint.
            shade = {"ivory":(40,0,0),"linen":(0,92,0),"hub":(0,0,60)}[name]
            ImageDraw.Draw(patch["mask"]).rectangle((0,0,w,h),fill=shade)
        painted = name in ("lettering","crest","navy","roof","deck","ivory","steel","black","darkrim","hub")
        optical = name in ("glass","ruby","blue","red","amber","white","mirror")
        soft = name in ("linen","vinyl","dash","tread","rubber")
        if painted or optical or soft:
            for role in ("hurt","decay"):
                wear=ImageDraw.Draw(patch[role])
                for k in range(max(5, w*h//(510 if role=="hurt" else 270))):
                    y=int(rng.uniform(.15,.95)*h) if role=="hurt" else int((1-rng.random()**2*.89)*h)
                    x=rng.randrange(w); run=rng.randint(3,max(5,w//8)); end=y+rng.randint(-4,5)
                    if role=="hurt":
                        # A scratch exposes primer along one edge; a lens reflects from the fractured edge.
                        dark, light = ((46,57,64),(197,216,215)) if optical else ((46,47,44),(137,132,119)) if soft else ((48,43,39),(184,172,147))
                        wear.line([(x,y),(x+run//2,y+1),(x+run,end)],fill=(*dark,rng.randint(100,225)),width=2)
                        wear.line((x,y+1,x+run//2,y+2),fill=(*light,175),width=1)
                        if optical:
                            wear.line((x+run//2,y+1,x+run//3,end-4),fill=(*light,135))
                    else:
                        for _ in range(9):
                            xx=x+rng.randint(-5,9); yy=y+rng.randint(-4,4); r=rng.randint(1,3)
                            # Paint oxidizes in a warm ring. Transparent optics fog grey; vinyl and rubber chalk.
                            tint=(rng.randrange(86,133),rng.randrange(92,113),112) if optical else ((109,104,92) if soft else (rng.randrange(81,136),rng.randrange(54,74),41))
                            wear.ellipse((xx-r,yy-r,xx+r,yy+r),fill=(*tint,rng.randrange(70,180)))
            if name in ("lettering","crest"):
                # A broad scrape breaks into parallel lines where the door's shoulder changes curvature.
                marks=ImageDraw.Draw(patch["hurt"])
                origin=(.01 if name=="lettering" else .61)*w
                for _ in range(42):
                    x=origin+rng.uniform(0,.10)*w; y=rng.uniform(.62,.73)*h
                    run=rng.uniform(.12,.28)*w
                    marks.line([(x,y),(x+run*.25,y-.02*h),(x+run*.63,y-.012*h),(x+run,y-.047*h)],
                               fill=(rng.randrange(74,109),87,80,rng.randrange(95,235)),width=1)
        for y in range(h):
            for x in range(w):
                nx=.036*(height[max(0,x-1),y]-height[min(w-1,x+1),y])
                ny=.036*(height[x,min(h-1,y+1)]-height[x,max(0,y-1)])
                length=math.sqrt(1+nx*nx+ny*ny)
                patch["normal"].putpixel((x,y),tuple(round(127.5*(1+n/length)) for n in (nx,ny,1)))
        for role,im in maps.items():
            im.paste(patch[role],(x0,y0))
    # The runtime stores one wear layer per texel. Give fresh scratches ownership of their marks.
    maps["decay"].paste((0,0,0,0), (0,0,512,512), maps["hurt"].getchannel("A").point(lambda a: 255 if a else 0))
    folder=Path(__file__).with_name("tex")
    folder.mkdir(exist_ok=True)
    for name,im in maps.items():
        im.save(folder/(name+".png"),optimize=True)

if __name__=="__main__":
    paint()
