"""Moulded graphics, saddle panels, traction mats and the rider's engine display."""
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

from craft_finish import foundation
from graphics import font
from paint import periodic, poly, ramp, ridge, rounded_box, transfer


RAIL=[(-1.49,.312),(-1.36,.345),(-.89,.362),(-.43,.374),(.04,.388),(.34,.421),
      (.64,.457),(.94,.499),(1.22,.541),(1.44,.573),(1.60,.611),(1.65,.622)]
SADDLE=[(-1.18,.115),(-1.126,.179),(-1.04,.204),(-.80,.211),(-.63,.196),(-.49,.181),
        (-.35,.161),(-.16,.15),(.013,.140),(.136,.107),(.186,.064)]


@lru_cache(None)
def engine_page():
    im=Image.new("RGB",(900,250),(16,34,38))
    d=ImageDraw.Draw(im)
    d.rounded_rectangle((10,10,889,239),radius=23,outline=(80,118,115),width=5)
    d.text((54,18),"1250",font=font(176),fill=(210,236,210),stroke_width=2,anchor="lt")
    d.text((60,188),"RPM",font=font(41),fill=(150,192,169),anchor="lt")
    d.line((414,36,414,209),fill=(89,130,124),width=3)
    d.text((449,33),"JET",font=font(60),fill=(150,196,171),anchor="lt")
    for i in range(12):
        left=454+i*32
        d.polygon([(left,151),(left+19,151),(left+28,100),(left+8,100)],fill=(118,205,166) if i<4 else (56,84,79))
    d.text((451,176),"TEMP",font=font(35),fill=(133,167,155),anchor="lt")
    d.text((686,161),"31°",font=font(61),fill=(209,220,194),anchor="lt")
    return im


def ski_fields(s):
    f=foundation(s,"riptide")
    x,y,z=s.P.T
    foot=f["foot"]
    rail=np.interp(z,*np.array(RAIL).T)
    span=np.maximum(.055,f["sheer"]-f["chine"])
    q=(y-f["chine"])/span
    side=f["side"]
    deck=f["hull"]&(s.N[:,1]>.14)
    cowl=f["hull"]&(z>.105)&(y>rail+.027)&(abs(x)<f["beam"]*.95)
    u=abs(x)/np.maximum(.019,f["beam"])
    # Hooked side flashes open into three wide steps on the raised nose.
    def flank(points):
        return side*poly(z,q,points,foot/span*.53)
    white=flank([(-1.48,.12),(-.86,.17),(-.51,.49),(-.64,.46),(-.11,.78),(.19,.86),(.02,.66),
                 (.46,.82),(.18,.55),(-.25,.43),(-.13,.52),(-.71,.12),(-1.22,.045)])
    shade=flank([(-1.42,.32),(-.94,.36),(-.23,.88),(-.45,.82),(-.98,.45),(-1.43,.43)])
    dyed=flank([(-1.4,.045),(-.69,.075),(-.10,.45),(-.32,.39),(.25,.65),(.71,.70),(.22,.48),
                (-.27,.30),(-.15,.35),(-.64,.018),(-1.26,-.023)])
    badge=side*poly(z,y-rail,[(.42,.014),(1.105,.014),(1.031,.106),(.50,.128)],foot*.52)
    reg=transfer("riptide",np.where(x>0,-1,1)*(z-.756),y-(rail+.064),side,.515,.060,foot)
    whitehood=cowl*poly(z,u,[(.16,.08),(.40,.09),(.63,.25),(.56,.12),(1.12,.27),(1.64,.12),
                              (1.64,.74),(1.25,.78),(.90,.66),(.96,.76),(.54,.55),(.61,.67),(.21,.41)],foot*1.27)
    hood_key=cowl*poly(z,u,[(.23,.37),(.69,.58),(.62,.49),(.99,.66),(.87,.58),(1.44,.69),
                            (1.08,.62),(.70,.40),(.79,.51),(.42,.28)],foot)
    hood_dye=cowl*poly(z,u,[(.295,.31),(.61,.40),(.54,.28),(.93,.43),(1.52,.40),
                            (1.13,.55),(.81,.49),(.91,.61),(.61,.46),(.65,.54),(.35,.396)],foot)
    rubber=s.where("tread")
    seat=f["upholstery"]
    width=np.interp(z,*np.array(SADDLE).T)
    hem=abs(x)-.32*width
    across=np.minimum(abs(z+.535),abs(z+.511))
    join=np.minimum(abs(hem),across)
    screenbox=rounded_box(x,z-.348,.122,.034,.014)
    hood=s.on("instrument hood")&(s.N[:,1]>.47)
    screen=hood*ramp(foot*.62,-foot*.62,screenbox)
    f.update(deck=deck|cowl|rubber,rail=rail,white=white,graphic=dyed,flank_key=shade,
             whitehood=whitehood,hood_key=hood_key,hood_dye=hood_dye,reg_ground=badge,registration=reg,
             mats=rubber,saddle=seat,hem=hem,saddle_join=join,engine_screen=screen,
             glass=(screen>.02),bezel=hood*ridge(screenbox-.004,.0032,foot*.57))
    return f


@lru_cache(None)
def pixels():
    return np.asarray(engine_page(),np.float32)


def ski_paint(p,s,f):
    x,y,z=s.P.T
    foot=f["foot"]
    p.lay(f["flank_key"],(34,38,40),.22)
    p.lay(f["white"],(236,233,216),.19)
    p.lay(f["graphic"],(183,183,183),.165,dye=0)
    p.lay(f["whitehood"],(237,234,220),.188)
    p.lay(f["hood_key"],(35,38,40),.22)
    p.lay(f["hood_dye"],(164,164,164),.178,dye=0)
    p.lay(f["reg_ground"],(230,228,210),.25)
    p.lay(f["registration"],(26,33,35),.27)
    # Sloped diamonds in each pad stop at a flat bound edge.
    mat=f["mats"]
    groove=np.minimum(periodic(z+.59*abs(x),.041),periodic(z-.72*abs(x),.041))
    tread=ramp(.002,.012,groove)
    roll=s.on("reboarding platform ridge")
    tread=np.where(roll,.62+.36*np.cos(352*x),tread)
    binding=mat*ridge(periodic(abs(x)-.034,.168),.0075,foot*.58)
    p.lay(mat,(51,57,55),.76)
    p.rgb+=(mat*(16*(tread-.5)+4*p.fine))[:,None]
    p.height+=mat*(25*tread-12)
    p.rough+=mat*(.095*tread-.038)
    p.lay(binding*.70,(45,49,47),.64)
    p.height+=7*binding
    seat=f["saddle"]
    seam=seat*ridge(f["saddle_join"],.0045,foot*.68)
    thread=seat*ridge(f["hem"],.0028,foot*.51)*ramp(.0088,.003,periodic(z,.020))
    dimples=np.exp(-((periodic(x+.31*z,.016)/.0034)**2+(periodic(z,.016)/.0031)**2))
    p.height+=seat*(3.5*p.fine-6*dimples-16*seam)+10*thread
    p.rgb*=(1-seat*(.13*dimples+.14*seam))[:,None]
    p.lay(thread,(177,174,141),.68)
    p.lay(s.where("citron")*s.on("saddle"),(208,211,133),.59)
    p.lay(f["bezel"],(93,105,102),.37,.64)
    screen=f["engine_screen"]
    face=screen>.001
    if np.any(face):
        img=pixels()
        u=(-x[face]/.244+.5)*(img.shape[1]-1)
        v=(.5-(z[face]-.348)/.068)*(img.shape[0]-1)
        panel=p.rgb.copy()
        panel[face]=np.column_stack([ndimage.map_coordinates(img[:,:,i],[v,u],order=1,mode="nearest") for i in range(3)])
        p.lay(screen,panel,.125)
    p.height-=screen*13
