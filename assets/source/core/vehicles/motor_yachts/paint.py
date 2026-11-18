"""Repaint the shipyard's original surface maps using Python, NumPy and Pillow."""
from pathlib import Path
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from palette import YACHT, CABIN

OUT = Path(__file__).resolve().parent / "tex"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
COLORS = dict(zip(YACHT + CABIN + ["teak"], [
    (220,225,224),(220,222,216),(52,67,72),(43,53,57),(231,231,221),(44,48,52),(39,63,72),(38,64,69),
    (174,189,189),(161,128,83),(40,41,39),(231,225,209),(204,64,47),(49,170,104),(246,227,182),(62,68,68),
    (222,219,207),(203,201,185),(222,216,198),(120,89,60),(31,46,51),(29,38,41),(41,48,47),(48,50,46),
    (176,166,146),(87,94,91),(42,136,143),(152,177,165),(55,62,62),(53,60,61),(50,57,57),(48,55,55),(174,141,101)]))
ROLES = dict(base="RGBA", packed="RGB", height="L", normal="RGB", mask="RGB", hurt="RGBA", decay="RGBA")


def swatch(name, size, seed):
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[:size,:size]
    u, v = xx/size, yy/size
    noise = rng.normal(0, 1, (size, size))
    shade = noise*.65
    height = np.full_like(shade, 128)
    rough, metal = 140, 0
    if name in ["topsides","pearl","strake","boot","cream","graphite"]:
        shade += 2*np.cos(v*math.pi) - 2.5*v**6
        rough = 75 if name != "boot" else 104
        metal = 42 if name == "topsides" else 13
    elif name in ["teak","walnut"]:
        board = np.floor(u * 16)
        grain = np.sin(u*877 + 1.6*np.sin(v*12 + board) + np.sin(v*36+board)*.26)
        shade += 3.1*grain + 5.4*np.sin(u*350+np.sin(v*9)) + noise*1.7 + 8*np.sin(board*2.88)
        if name == "teak":
            joint = np.minimum((u*16)%1, 1-(u*16)%1)
            length = (v + np.round(board*0.391*8)/8)%1
            seams = np.clip(1-joint/.075,0,1) + np.clip(1-np.minimum(length,1-length)*320,0,1)
            shade -= 61*np.minimum(1,seams)
            height -= 35*np.minimum(1,seams)
        rough = 176
    elif name in ["stainless","bronze"]:
        shade += 9*np.cos(v*math.pi*2.3) + noise
        rough, metal = (64,230) if name == "stainless" else (107,191)
    elif name in ["glass","clear"]:
        shade += 16*(1-v)-9*v+12*np.exp(-((u + .77*v-.84)/.22)**2)
        rough, metal = 42, 112
    elif name in ["upholstery","piping","linen","stitch","leather"]:
        grain = 2*np.cos(xx*math.pi*.83)+2.1*np.cos(yy*math.pi*.91)+noise*1.1
        shade += grain
        height += 1.5*grain
        rough = 165 if name == "leather" else 187
    elif name == "grille":
        vent = (yy%12 < 6)*27 + (xx%23 < 3)*4
        shade -= vent
        height -= vent
    elif name in ["pool","tile"]:
        caustic = np.sin(u*19+1.8*np.sin(v*20))**6 * np.sin(v*19-np.sin(u*15))**2
        shade += 15*caustic
        rough = 71
    rgb = np.uint8(np.clip(np.asarray(COLORS[name])+shade[:,:,None],0,255))
    base = Image.fromarray(rgb).convert("RGBA")
    d = ImageDraw.Draw(base)
    def txt(x,y,s,sz,ink,anchor="mm",bold=False):
        d.text((x,y),s,fill=ink,anchor=anchor,font=ImageFont.truetype(BOLD if bold else FONT,sz))
    if name in ["solstice","meridian","belvedere","sovereign"]:
        txt(64,59,name.upper(),16 if name=="solstice" else 14,(225,218,196))
        d.line((35,81,91,81), fill=(155,137,108),width=1)
    if name == "chart":
        d.rounded_rectangle((3,8,124,119),7,fill=(20,35,40),outline=(97,109,104),width=2)
        d.rectangle((11,20,116,96),fill=(71,109,111))
        d.polygon([(12,22),(47,21),(51,34),(38,45),(54,53),(30,61),(26,80),(11,84)],fill=(170,162,125))
        for k in range(4):
            d.line([(47+k*3,22),(55+k*3,33),(42+k*3,45),(58+k*3,54),(34+k*3,63),(30+k*3,83)],fill=(107,144,138))
        d.line((70,80,82,63,76,50,97,33),fill=(250,185,92),width=2)
        d.polygon([(67,81),(71,72),(75,81)], fill=(246,240,212))
        txt(13,106,"COURSE   032",9,(177,214,200),"lm",True)
    if name == "instruments":
        d.rounded_rectangle((4,7,123,119),7,fill=(23,35,40),outline=(94,102,99),width=2)
        for c in (36,91):
            d.arc((c-21,35,c+21,78),151,390,fill=(155,189,174),width=3)
            for a in range(-208,30,22):
                t = math.radians(a)
                d.line((c+18*math.cos(t),56+18*math.sin(t),c+15*math.cos(t),56+15*math.sin(t)),fill=(220,229,211))
            d.line((c,56,c+9,43),fill=(242,166,99),width=2)
        txt(64,94,"TWIN   /   DRIVE",9,(184,210,199),bold=True)
    if name == "keyboard":
        for row in range(3):
            for col in range(5):
                a,b = 8+col*23,14+row*34
                d.rounded_rectangle((a,b,a+15,b+19),3,fill=(77,82,78),outline=(132,140,131))
                d.line((a+5,b+8,a+10,b+8),fill=(217,208,177))
    if name=="clear": base.putalpha(0)
    # Salt freckling and tide deposits accumulate on different texels from impact scars.
    hurt, decay = Image.new("RGBA",(size,size)), Image.new("RGBA",(size,size))
    dh, dd = ImageDraw.Draw(hurt), ImageDraw.Draw(decay)
    for _ in range(size//5):
        x,y = rng.integers(0,size,2)
        dy = int(rng.integers(-4,6))
        if name in ["glass","chart","instruments"]:
            if _%4: continue
            dh.line((x,y,x-3,y-7,x+4,y-12),fill=(181,196,191,int(rng.integers(65,241))),width=1)
        else:
            dh.line((x,y,x+int(rng.integers(2,16)),y+dy),fill=(101,91,79,int(rng.integers(65,245))),width=int(rng.integers(1,3)))
    for _ in range(size*2):
        x,y = rng.integers(0,size,2)
        if rng.random() > (.20 + .75*(y/size)**2): continue
        col = (99,91,70) if name not in ["stainless","bronze"] else (135,96,60)
        dd.ellipse((x,y,x+int(rng.integers(1,6)),y+int(rng.integers(1,4))),fill=(*col,int(rng.integers(48,248))))
    for _ in range(4 if name in ("glass","topsides","upholstery","pearl") else 1):
        x,y = rng.integers(size//5,4*size//5,2)
        if name == "glass":
            for a in rng.uniform(0,math.tau,6):
                dx,dy=math.cos(a)*size*.16,math.sin(a)*size*.16
                dh.line((x,y,x+dx*.4-2,y+dy*.4,x+dx,y+dy),fill=(174,194,195,190),width=1)
        else:
            lip=(90,86,76,200) if name!="upholstery" else (108,96,78,213)
            dh.polygon([(x,y),(x+size*.19,y-size*.035),(x+size*.14,y+size*.008),(x+size*.045,y+size*.021)],fill=lip)
    dec = np.array(decay)
    stain = Image.fromarray(rng.integers(0,256,(12,12),dtype=np.uint8)).resize((size,size),Image.Resampling.BICUBIC)
    deposit=(np.asarray(stain).astype(float)/255 + .14*v + noise*.02)
    dirty=deposit>.73
    tone=(102,106,88) if name=="teak" else (112,112,99)
    if name in ("bronze","stainless","grille"): tone=(119,92,70)
    if name in ("glass","graphite","gasket"): tone=(84,93,90)
    colour=np.uint8(np.clip(np.asarray(tone)+noise[:,:,None]*3+(deposit[:,:,None]-.75)*38,0,255))
    dec[dirty,:3]=colour[dirty]
    dec[dirty,3]=np.uint8(np.clip((deposit[dirty]-.72)*680+10,0,244))
    dec[np.asarray(hurt)[:,:,3]>0,3]=0
    if name=="clear":
        hurt, dec = Image.new("RGBA",(size,size)), np.zeros_like(dec)
    gy,gx = np.gradient(height)
    normal = np.stack((-gx*.08,gy*.08,np.ones_like(height)),axis=2)
    normal /= np.linalg.norm(normal,axis=2)[:,:,None]
    orm = np.uint8(np.clip(np.stack((248+noise,rough+noise*2,metal+noise*.4),axis=2),0,255))
    mask = {"topsides":(255,0,0),"strake":(0,255,0),"upholstery":(0,0,255)}.get(name,(0,0,0))
    return dict(base=base,packed=Image.fromarray(orm),mask=Image.new("RGB",(size,size),mask),height=Image.fromarray(np.uint8(height)),
                normal=Image.fromarray(np.uint8((normal+1)*127.5+.5)),hurt=hurt,decay=Image.fromarray(dec))


for mat,names in [("yacht",YACHT),("cabin",CABIN),("teak",["teak"])]:
    pictures = {role: Image.new(mode,(512,512)) for role,mode in ROLES.items()}
    for i,name in enumerate(names):
        size = 512 if mat == "teak" else 128
        for role,picture in swatch(name,size,1097+31*i+len(mat)).items():
            pictures[role].paste(picture,(i%4*size,i//4*size))
    for role,picture in pictures.items():
        picture.paste(picture.crop((0,0,512,1)),(0,511))
        picture.paste(picture.crop((0,0,1,512)),(511,0))
        picture.save(OUT/f"{mat}-{role}.png",optimize=True)
