"""Flat transfers and instrument faces for the small craft."""
from functools import lru_cache
from pathlib import Path
import math

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
FONT = HERE.parents[3] / "raw/fonts/barlow/BarlowSemiCondensed-Medium.ttf"


@lru_cache(None)
def font(size):
    return ImageFont.truetype(str(FONT), size)


def lettering(words, size, tracking, stroke=0):
    face = font(size)
    box = face.getbbox(words, stroke_width=stroke)
    x = stroke + 2
    width = sum(face.getlength(c) + tracking for c in words)
    im = Image.new("L", (math.ceil(width + 2*x), box[3] - box[1] + 4))
    pen = ImageDraw.Draw(im)
    for c in words:
        pen.text((x, 2-box[1]), c, font=face, fill=255, stroke_width=stroke, stroke_fill=255)
        x += face.getlength(c) + tracking
    return im.crop(im.getbbox())


def wordmark():
    shapes = {
        "H": [[(0,0),(15,0),(15,35),(59,35),(59,0),(74,0),(74,82),(59,82),(59,50),(15,50),(15,82),(0,82)]],
        "I": [[(0,0),(16,0),(16,82),(0,82)]],
        "G": [[(14,0),(73,0),(73,14),(19,14),(15,19),(15,64),(20,69),(59,69),(59,50),
               (38,50),(43,36),(74,36),(74,82),(12,82),(0,70),(0,15)]],
        "V": [[(0,0),(17,0),(37,64),(62,0),(80,0),(46,82),(26,82)]],
        "O": [[(14,0),(63,0),(76,13),(76,67),(61,82),(13,82),(0,69),(0,15)],
              [(21,14),(56,14),(61,19),(61,62),(54,68),(21,68),(15,62),(15,20)]],
        "L": [[(0,0),(16,0),(16,68),(67,68),(63,82),(0,82)]],
        "T": [[(0,0),(77,0),(73,15),(46,15),(46,82),(30,82),(30,15),(0,15)]],
        "A": [[(32,0),(55,0),(82,82),(65,82),(59,62),(24,62),(16,82),(0,82)],
              [(30,48),(54,48),(44,15)]],
        "E": [[(0,0),(71,0),(68,14),(16,14),(16,34),(62,34),(59,48),(16,48),(16,68),(73,68),(69,82),(0,82)]],
    }
    im = Image.new("L", (2200, 176))
    pen = ImageDraw.Draw(im)
    x = 0
    for c in "HIGH VOLTAGE":
        if c == " ":
            x += 24
            continue
        paths = shapes[c]
        for i, path in enumerate(paths):
            pen.polygon([(2*(x+u+.23*(82-v))+2, 2*v+3) for u,v in path], fill=255 if i==0 else 0)
        x += max(u for u,v in paths[0]) + 9
    return im.crop(im.getbbox())


def dial():
    im = Image.new("RGB", (768,768), (31,38,42))
    pen = ImageDraw.Draw(im)
    def ring(r, colour):
        pen.ellipse((384-r,384-r,384+r,384+r), fill=colour)
    def tip(angle, r):
        a = math.radians(angle)
        return (384+r*math.cos(a),384+r*math.sin(a))
    def label(at, words, size, colour):
        pen.text(at, words, font=font(size), fill=colour, anchor="mm")
    ring(348, (132,143,143))
    ring(338, (53,64,68))
    ring(322, (20,30,37))
    bone, amber, orange = (238,234,212), (223,175,97), (242,98,57)
    pen.arc((73,73,695,695),135,374, fill=amber,width=4)
    pen.arc((73,73,695,695),15,45,fill=orange,width=13)
    for i in range(41):
        a = 135+i*6.75
        major = i%5==0
        pen.line((tip(a,298),tip(a,254 if major else 278)),fill=bone if i<35 else orange,width=8 if major else 4)
        if major:
            label(tip(a,218),str(i//5),60,bone)
    label((384,284),"RPM",40,bone)
    label((384,331),"×1000",26,(150,170,171))
    pen.rounded_rectangle((296,535,472,588),9, fill=(9,17,20),outline=(87,101,102),width=4)
    label((384,559),"0148.6",35,amber)
    pen.polygon([tip(156,263),tip(246,13),tip(336,58),tip(66,12)],fill=orange)
    ring(30,(176,168,142))
    ring(21,(49,57,60))
    return im


def plotter():
    im = Image.new("RGB", (1152,432), (15,27,33))
    pen = ImageDraw.Draw(im)
    pen.rounded_rectangle((22,21,1130,411),10,fill=(20,40,48),outline=(92,107,110),width=4)
    chart_box=(51,51,858,382)
    # Soundings, depth contours and a dogleg channel in a tidal inlet.
    chart=Image.new("RGB",(808,332),(28,77,92))
    p=ImageDraw.Draw(chart)
    for x in range(24,808,74):
        p.line((x,0,x,332),fill=(47,93,105),width=1)
    for y in range(16,332,70):
        p.line((0,y,807,y),fill=(47,93,105),width=1)
    shore=[(-24,218),(60,225),(115,194),(152,187),(200,133),(268,124),(295,94),(360,75),(383,40),(444,8),(453,-15)]
    for ofs,col in [(106,(44,99,111)),(65,(61,124,131)),(30,(103,148,144)),(0,(196,183,141))]:
        pts=[(x+ofs,y+ofs*.6) for x,y in shore]
        p.polygon([(-100,-120),(-100,pts[0][1]),*pts,(pts[-1][0],-120)],fill=col)
        p.line(pts,fill=(133,164,150),width=2)
    p.polygon([(676,330),(681,291),(698,270),(719,262),(758,210),(775,202),(756,253),(720,295),(708,332)],fill=(172,177,144))
    route=[(260,356),(349,266),(475,224),(634,67),(749,26)]
    p.line(route,fill=(242,181,86),width=5)
    for x,y in route[1:-1]:
        p.ellipse((x-7,y-7,x+7,y+7),fill=(40,69,76),outline=(255,212,133),width=3)
    for x,y,v in [(63,282,'4.2'),(229,201,'3.1'),(266,301,'7.2'),(408,185,'6.8'),(570,243,'9.4'),(584,66,'5.3'),(716,154,'8.1')]:
        p.text((x,y),v,font=font(17),fill=(159,190,184))
    p.polygon([(426,228),(402,265),(398,250),(383,245)],fill=(250,246,221),outline=(11,25,31),width=3)
    p.text((17,12),"INLET",font=font(22),fill=(51,73,72))
    p.line((26,297,26,304,108,304,108,297),fill=(227,232,214),width=3)
    im.paste(chart,chart_box[:2])
    for y,title,value in [(55,"COURSE","042°"),(166,"DEPTH  m","6.8"),(274,"SOG  kn","0.0")]:
        pen.text((889,y),title,font=font(20),fill=(151,184,180))
        pen.text((886,y+20),value,font=font(59),fill=(242,231,196))
        if y<274:
            pen.line((889,y+96,1090,y+96),fill=(65,88,93),width=2)
    return im


@lru_cache(None)
def artwork():
    return {"name":wordmark(), "registration":lettering("FL 4821 TB",168,6,3),
            "port":lettering("MIAMI",100,24,1), "dial":dial(), "plotter":plotter()}


def save_originals():
    for name, im in artwork().items():
        im.save(HERE / "ref" / (name + ".png"))
