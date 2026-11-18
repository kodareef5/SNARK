"""Wear in the projected finish cells. Coordinates repeat across the working tile."""
import numpy as np
from scipy.ndimage import gaussian_filter

from abrasion import Marks, fracture, mix, score
from finishes import FITTINGS


SILVER = ((63,68,65),(152,154,141),(230,225,198))
SCUFF = ((40,44,43),(98,104,97),(169,168,147))


def wrap(v):
    return (v+.5)%1-.5


def tarnish(b,u,v,tag):
    pocket = np.cos(2*np.pi*(v+.07*np.sin(6*u)))**2
    tea = .32*b.cloud+.27*b.flake+.19*b.grain+.22*pocket
    if tag=="bronze":
        wash,pit,crust = ((123,107,65),(54,80,63),(127,159,121))
    elif tag in ("slate","intake"):
        wash,pit,crust = ((99,110,105),(58,64,62),(172,179,156))
    else:
        wash,pit,crust = ((154,140,109),(94,71,48),(177,136,83))
    b.age(tea>.59,.38+.54*b.grain,mix(wash,crust,.42*b.flake+.27*b.fine))
    b.age((tea>.64)&(b.grain>.43),1.12+.55*b.fine,mix(pit,crust,.42*b.grain+.37*b.flake))
    b.age((tea>.66)&(b.fine>.55),2.12+.53*b.cloud,mix((53,56,46),pit,b.grain))
    # Salt and oxidation sit around the edge of a pit.
    ring = (b.grain>.65)&(b.grain<.72)&(tea>.55)&(b.fine>.60)
    b.age(ring,1.33+.51*b.flake,mix(wash,(188,187,146),b.grain))


def metal(b,u,v,tag):
    bronze = tag=="bronze"
    if tag=="steel":
        u,v = wrap(v+.17),wrap(.23-u)
    elif tag=="bronze":
        u,v = wrap(u+.24),wrap(v-.21)
    elif tag=="slate":
        u,v = wrap(-v+.07),wrap(u-.13)
    tracks = ((.14,.12,.35,.009,.31),(-.19,-.29,.26,.006,-.19),
              (.12,.15,.22,.005,.34),(-.24,.28,.17,.005,-.12))
    polish = ((80,72,48),(177,147,89),(239,208,144)) if bronze else SILVER
    for k,(cx,cy,w,h,slope) in enumerate(tracks):
        a,c=wrap(u-cx),wrap(v-cy)
        score(b,a,c-slope*a,w,h,.012,.15+.16*k,polish)
    a,c=wrap(u+.22),wrap(v-.029)
    d=c-.042*np.sin(10*a)-.16*a
    mouth=np.maximum(0,1-(a/.21)**2)
    crease=(np.abs(d)<.034*mouth*(.79+.40*b.flake))&(mouth>0)
    b.hit(crease,1.22+.59*b.grain,mix(polish[0],polish[1],.32*b.grain))
    b.hit(crease&(d>.003),1.53+.52*b.cloud,mix(polish[1],polish[2],b.flake))
    b.hit(crease&(d<-.012)&(b.grain>.48),2.25+.46*b.fine,mix((44,48,47),polish[0],b.grain))
    tarnish(b,u,v,tag)


def rubber(b,u,v,tag):
    if tag=="throttle":
        u,v = wrap(v-.14),wrap(u+.21)
    elif tag=="grip":
        u,v = wrap(u+.089),v
    for cx,cy,span,slope in ((.05,.208,.36,.06),(-.13,.234,.22,.08),(-.25,-.21,.19,-.12)):
        a=wrap(u-cx)
        score(b,a,wrap(v-cy)-slope*a,span,.014,.020,.35,SCUFF)
    a,c=wrap(u-.21),wrap(v+.18)
    split = np.abs(c+.42*a-.025*np.sin(18*a)) < .023*np.maximum(0,1-(a/.19)**2)
    b.hit(split,1.25+.65*b.flake,mix((24,28,26),(89,87,72),.55*b.grain+.31*(c>0)))
    leather = ((95,80,58),(160,140,99)) if tag!="rubber" else ((24,29,28),(74,78,70))
    b.hit(split&(b.grain>.60),2.24+.51*b.fine,mix(*leather,b.fine))
    bloom = .52*b.cloud+.27*b.grain+.21*b.flake
    b.age(bloom>.63,.21+.62*b.grain,mix((75,81,75),(131,131,111),b.flake))
    cracks = np.abs(np.sin(2*np.pi*(8*u+2*v)+.7*np.sin(2*np.pi*3*v)+2*b.flake))
    b.age((cracks<.17)&(bloom>.49),1.25+.55*b.flake,mix((37,41,36),(92,92,72),b.cloud))
    b.age((cracks<.29)&(bloom>.58),2.15+.55*b.grain,mix((26,30,28),(66,68,53),b.grain))
    if tag=="throttle":
        corner = (np.abs(u)>.29)&(np.abs(v-.18)<.07)&(b.cloud+b.grain>1.23)
        b.hit(corner,1.23+.45*b.grain,mix((103,76,56),(156,127,94),b.flake))
    if tag=="grip":
        join=np.abs(np.hypot(b.pos[:,0],v)-.443)<.010
        b.age(join&(b.grain>.51),1.63+.55*b.flake,(139,124,93))


def glazing(b,u,v,tag,seed):
    dial = tag=="gauge"
    strikes = {"chart":(.235,-.23,.39,.25),"gauge":(-.225,-.20,.22,.28),
               "red":(.26,.265,.25,.34),"green":(-.31,.12,.32,.23),"lamp":(.12,-.29,.36,.22)}
    cx,cy,w,h = strikes[tag]
    a,c = wrap(u-cx),wrap(v-cy)
    glass = (np.hypot(u,v)<.448) if dial else (np.maximum(np.abs(u),np.abs(v))<.46)
    p = b.take(glass)
    fracture(p,a[glass],c[glass],w,h,seed,.16,glass=True,hairline=.0025)
    # A released sliver follows one crack back to the frame.
    tilt = {"chart":.42,"gauge":-.51,"red":.61,"green":-.28,"lamp":-.81}[tag]
    t = a+tilt*c
    normal = c-tilt*a
    half = .054*np.maximum(0,1-np.abs((t+.026)/.12))*(.68+.47*b.flake)
    shard = glass & (np.abs(normal)<half)
    b.hit(shard,1.24+.62*b.grain,mix((61,77,77),(143,150,136),.57*b.flake+.28*b.fine))
    b.hit(shard&(normal<half*.38)&(normal>-half*.84),2.11+.56*b.flake,mix((19,28,31),(59,62,52),b.grain))
    salt=.35*b.cloud+.35*b.flake+.30*b.grain
    hues={"gauge":(87,99,95),"chart":(86,110,111),"red":(166,91,76),
          "green":(90,143,112),"lamp":(181,179,143)}
    wash=mix(hues[tag],(184,184,155),.46*b.fine)
    b.age(glass&(salt>.65),.31+.48*b.grain,wash)
    rim=np.hypot(u,v) if dial else np.maximum(np.abs(u),np.abs(v))
    haze = glass&(rim>.32)&(salt+.44*(rim-.32)>.57)
    b.age(haze,1.10+.66*b.grain,mix(hues[tag],(162,160,132),.51*b.flake+.24*b.fine))
    crack = np.abs(wrap(v-.28)+.26*wrap(u+.15)+.022*np.sin(23*u))<.0035
    b.age(glass&crack&(u<.06),2.16+.43*b.grain,mix((92,109,108),(177,183,163),b.fine))


def hardware_wear():
    layers = [np.zeros((1024,1024,4),np.uint8) for _ in range(2)]
    y,x = np.mgrid[:236,:236].astype(np.float32)
    u,v = ((x.ravel()+.5)/236-.5,(y.ravel()+.5)/236-.5)
    pos = np.stack((u,v,np.zeros_like(u)),1)
    for i,tag in enumerate(FITTINGS):
        rng=np.random.default_rng(8309+i)
        grains=[]
        for sigma in (1.7,7,20,.55):
            field=gaussian_filter(rng.standard_normal(x.shape).astype(np.float32),sigma,mode="wrap")
            grains.append(np.clip(.5+.18*(field-field.mean())/field.std(),0,1).ravel())
        b=Marks(pos,*grains)
        if tag in ("chrome","steel","slate","bronze","intake"):
            metal(b,u,v,tag)
            if tag=="intake":
                rib = np.cos(np.pi*(y.ravel()+10)/20)>.75
                b.hurt[~rib] = 0
                b.age((~rib)&(b.cloud>.61)&(b.flake>.5),2.10+.41*b.grain,mix((48,54,46),(99,108,80),b.grain))
        elif tag in ("rubber","grip","throttle"):
            rubber(b,u,v,tag)
        else:
            glazing(b,u,v,tag,2903+i*47)
        b.decay[b.hurt[:,3]>0]=0
        top,left=i//4*256,i%4*256
        for atlas,mark in zip(layers,(b.hurt,b.decay)):
            tile=mark.reshape(236,236,4)
            atlas[top:top+256,left:left+256] = np.pad(tile,((10,10),(10,10),(0,0)),mode="wrap")
    for atlas in layers:
        atlas[:4]=atlas[-4:]=atlas[:,:4]=atlas[:,-4:]=0
    return layers
