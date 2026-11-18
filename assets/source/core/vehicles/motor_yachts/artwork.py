"""Flat originals for the yacht's applied metalwork, enamel and helm faces."""
from functools import lru_cache
from math import cos, radians, sin
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from livery import PAINT, emblem, lettering

HERE = Path(__file__).resolve().parent
FONT = HERE.parents[3] / "raw/fonts/barlow/BarlowSemiCondensed-Medium.ttf"
IDENTITY = {
    "belvedere": ("HALCYON", "FL 7328 HY"),
    "meridian": ("NIGHT HERON", "FL 4186 NH"),
    "solstice": ("SUNDOG", "FL 2907 SD"),
    "sovereign": ("AURELIA", "FL 9164 AU"),
}
INK = (22, 49, 57)
BLUE = (45, 103, 110)
IVORY = (242, 233, 207)
BRASS = (202, 165, 99)
PAPER = (217, 231, 218)


@lru_cache(None)
def font(size):
    return ImageFont.truetype(str(FONT), size)


def word(draw, centre, text, size, tracking, fill, stroke=0):
    face = font(size)
    widths = [face.getlength(c) for c in text]
    x = centre[0] - (sum(widths) + tracking * (len(text) - 1)) / 2
    for c, width in zip(text, widths):
        draw.text((x, centre[1]), c, anchor="ls", font=face, fill=fill,
                  stroke_width=stroke, stroke_fill=fill)
        x += width + tracking


def bird():
    im = Image.new("RGBA", (1200, 400))
    d = ImageDraw.Draw(im)
    # The raised wing, folded wing, belly and long bill meet at the throat.
    d.polygon([(50,36),(605,119),(789,236),(721,258),(457,161)], fill=INK)
    d.polygon([(50,36),(568,96),(672,146),(519,113)], fill=BRASS)
    d.polygon([(134,94),(555,157),(718,253),(581,215)], fill=BLUE)
    d.polygon([(48,177),(510,205),(727,283),(611,283),(442,241)], fill=INK)
    d.polygon([(174,188),(518,216),(650,256),(482,229)], fill=IVORY)
    d.polygon([(341,317),(633,282),(749,235),(807,178),(872,161),
               (926,192),(1170,202),(927,221),(832,246),(742,301),
               (649,326),(485,333),(366,359),(425,326)], fill=INK)
    d.polygon([(717,270),(792,200),(854,178),(902,193),(814,207)], fill=BLUE)
    d.polygon([(691,303),(816,242),(889,218),(804,267),(746,302),(652,320)], fill=BRASS)
    d.polygon([(859,205),(907,202),(888,212)], fill=IVORY)
    return im


def inscription(text, kind):
    if kind in ("board","transom"):
        im = Image.new("RGBA", (1400, 200))
        d = ImageDraw.Draw(im)
        tracking = 67 if len(text)<9 else 32
        if kind == "transom":
            word(d,(700,113),text,140,tracking,INK,9)
            word(d,(700,189),"MIAMI, FL",76,16,INK,7)
        word(d,(700,113),text,140,tracking,IVORY,3)
        word(d,(700,189),"MIAMI, FL",76,16,(238,211,155),2)
        for sign in (-1,1):
            d.line((700+sign*235,165,700+sign*458,165), fill=BRASS, width=6)
    elif kind == "registration":
        im = Image.new("RGBA",(820,116))
        word(ImageDraw.Draw(im),(410,95),text,112,6,INK,2)
    else:
        im = Image.new("RGBA",(1250,177))
        word(ImageDraw.Draw(im),(625,148),text,170,18,IVORY,2)
    return im


def label(d, xy, text, size, colour=IVORY, anchor="lm"):
    d.text(xy, text, font=font(size), anchor=anchor, fill=colour)


def chart(yacht="belvedere"):
    im = Image.new("RGB", (640, 392), (65, 143, 166))
    d = ImageDraw.Draw(im)
    coast = [(-5,40),(161,40),(178,68),(146,93),(154,114),(109,145),
             (119,157),(84,177),(97,192),(78,204),(92,220),(54,247),
             (42,268),(23,272),(6,295),(-5,300)]
    for offset, colour in [(144,(85,168,183)),(98,(113,188,190)),(55,(158,205,188)),
                           (20,(194,218,173)),(0,(233,218,165))]:
        shoreline = [(x+offset,y) for x,y in coast]
        d.polygon(shoreline+[(-6,302),(-6,38)],fill=colour)
        d.line(shoreline,fill=tuple(v-24 for v in colour),width=2)
    for x in range(56,640,98):
        d.line((x,42,x,304),fill=(120,171,174),width=1)
    for y in range(77,299,62):
        d.line((0,y,639,y),fill=(120,171,174),width=1)
    d.polygon([(210,145),(234,107),(266,80),(258,102),(242,131)],fill=(238,225,174))
    d.line([(0,164),(92,138),(152,127)],fill=(152,145,115),width=5)
    for x,y,v in [(94,236,"3"),(157,213,"5"),(236,185,"8"),(314,91,"12"),
                  (453,251,"17"),(545,146,"21"),(497,197,"18"),(366,279,"14")]:
        label(d,(x,y),v,20,(32,91,103),"mm")
    route=[(176,288),(252,236),(355,204),(379,139),(475,86)]
    nav = {"solstice": ("CUT EAST", "INLET 02", "058°", "4.3 m", "0.2 NM"),
           "meridian": ("NORTH PASS", "PASS 04", "341°", "6.7 m", "0.5 NM"),
           "sovereign": ("OUTER ROAD", "FAIRWAY 06", "087°", "12.6 m", "1.0 NM")}
    title,leg,course,depth,scale=nav.get(yacht,("BISCAYNE","ROUTE 03","032°","8.2 m","0.5 NM"))
    route={"solstice":[(139,271),(223,220),(315,209),(386,166),(463,140)],
           "meridian":[(373,283),(357,206),(310,179),(302,114),(329,81)],
           "sovereign":[(174,247),(240,233),(363,170),(447,164),(534,140)]}.get(yacht,route)
    d.line(route,fill=INK,width=11,joint="curve")
    d.line(route,fill=(255,187,62),width=6,joint="curve")
    for x,y in route[1:]:
        d.ellipse((x-7,y-7,x+7,y+7),fill=INK,outline=IVORY,width=3)
    x,y=route[2]
    d.polygon([(x+2,y-30),(x+11,y+11),(x-5,y+1),(x-22,y+5)],fill=IVORY,outline=INK,width=4)
    waypoint=(483,84) if yacht=="belvedere" else (route[-1][0]+11,route[-1][1]-3)
    label(d,waypoint,leg[-2:],25,(242,239,211))
    d.rectangle((0,0,639,45),fill=INK)
    label(d,(15,22),title,34)
    label(d,(623,22),leg,29,(163,219,211),"rm")
    d.polygon([(595,60),(607,90),(595,86),(583,91)],fill=IVORY,outline=INK,width=3)
    d.rectangle((0,303,639,391),fill=(16,37,47))
    for left,title,reading in [(16,"COURSE",course),(230,"DEPTH",depth),(445,"RANGE",scale)]:
        label(d,(left,321),title,23,(161,202,197))
        label(d,(left,362),reading,47)
        if left>16:
            d.line((left-15,315,left-15,381),fill=(79,107,107),width=2)
    return im.convert("RGBA")


def instruments():
    im = Image.new("RGB",(640,392),(14,29,38))
    d = ImageDraw.Draw(im)
    d.rectangle((0,0,639,45),fill=INK)
    label(d,(17,22),"TWIN DRIVE",32)
    d.ellipse((494,16,507,29),fill=(128,222,176))
    label(d,(623,22),"NORMAL",25,(167,221,189),"rm")
    for cx,reading,temp in [(163,"740","78°"),(477,"750","79°")]:
        label(d,(cx,67),"PORT" if cx<320 else "STBD",28,(178,211,204),"mm")
        cy,r=192,103
        box=(cx-r,cy-r,cx+r,cy+r)
        d.arc(box,151,389,fill=(88,126,131),width=15)
        d.arc(box,151,218,fill=(123,217,191),width=15)
        d.arc(box,355,389,fill=(238,154,95),width=15)
        for k in range(25):
            a=radians(151+k*9.9)
            inner=r-(27 if k%4==0 else 15)
            d.line((cx+inner*cos(a),cy+inner*sin(a),cx+(r-3)*cos(a),cy+(r-3)*sin(a)),
                   fill=PAPER,width=4 if k%4==0 else 2)
        a=radians(215 if cx<320 else 219)
        d.polygon([(cx-5*sin(a),cy+5*cos(a)),(cx+87*cos(a),cy+87*sin(a)),
                   (cx+5*sin(a),cy-5*cos(a))],fill=(255,195,90))
        d.ellipse((cx-8,cy-8,cx+8,cy+8),fill=IVORY)
        label(d,(cx,234),reading,56,IVORY,"mm")
        label(d,(cx,274),"RPM",23,(151,193,194),"mm")
        d.line((cx-127,301,cx+127,301),fill=(71,109,113),width=2)
        label(d,(cx-119,329),"COOLANT",24,(152,195,191))
        label(d,(cx+113,329),temp,32,IVORY,"rm")
        for j in range(12):
            x=cx-117+j*19
            d.rectangle((x,360,x+14,368),fill=(131,210,178) if j<8 else (54,79,83))
    return im.convert("RGBA")


def switches():
    im=Image.new("RGB",(600,260),(39,48,50))
    d=ImageDraw.Draw(im)
    keys=(("1","2","3","4","5","CLR"),("6","7","8","9","0","ENT"))
    for row,line in enumerate(keys):
        for col,legend in enumerate(line):
            x,y=6+col*99,7+row*125
            d.rounded_rectangle((x,y,x+95,y+119),radius=12,fill=(15,23,26),outline=(135,146,139),width=3)
            d.rounded_rectangle((x+5,y+4,x+90,y+106),radius=9,
                                fill=(42,91,84) if legend=="ENT" else (61,74,76))
            label(d,(x+47,y+53),legend,77 if len(legend)==1 else 45,(255,248,219),"mm")
            if legend=="ENT":
                d.line((x+27,y+100,x+70,y+100),fill=(140,237,183),width=5)
    return im.convert("RGBA")


def masters(yacht):
    name, reg = IDENTITY[yacht]
    if yacht in PAINT:
        return {"emblem":emblem(yacht), **{key:lettering(yacht, reg if key=="registration" else name,
                kind, word) for key,kind in (("board","board"),("transom","transom"),
                ("side_name","name"),("registration","registration"))},
                "chart":chart(yacht),"instruments":instruments(),"keyboard":switches()}
    return {"wing":bird(), "board":inscription(name,"board"), "transom":inscription(name,"transom"),
            "side_name":inscription(name,"name"), "registration":inscription(reg,"registration"),
            "chart":chart(), "instruments":instruments(), "keyboard":switches()}
