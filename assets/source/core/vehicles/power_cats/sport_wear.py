"""The open helm's acrylic, the quarter strike and a console fire."""
from functools import lru_cache

import numpy as np
from PIL import Image,ImageDraw
from scipy import ndimage

from paint import byte,fade,noise,wave


def pane_uv(f):
    x,y,z=f.x,f.y,f.z
    lo,hi=f.low,f.high
    def across(a,k):
        return np.clip((a-lo[k])/np.maximum(.003,hi[k]-lo[k]),0,1)
    u,v=across(z,2),1-across(y,1)
    key=np.where(x>0,84,80)+(lo[2]>-2)
    wing=f.on("smoked windscreen quarter")
    key=np.where(wing,86+(x>0),key)
    front=f.on("smoked screen bottom")
    key=np.where(front,88,key)
    roof=f.on("hardtop vent glass")
    key=np.where(roof,90+(x>0),key)
    display=f.is_tag("chart")
    key=np.where(display,92,key)
    u=np.where(front|roof|display,1-across(x,0),u)
    v=np.where(roof,1-across(z,2),v)
    return u,v,key


@lru_cache(maxsize=24)
def acrylic(key,aged):
    if key not in ((80,85,87,90) if aged else (81,84,86,88,91,92)):
        return None
    w,h=(640,150) if key in (80,81,84,85,88,92) else (400,320)
    rng=np.random.default_rng(9030+key+int(aged)*497)
    cx,cy=w*rng.uniform(.26,.73),h*rng.uniform(.25,.72)
    if key==88: cx=w*.64
    yy,xx=np.indices((h,w),np.float32)
    radii=np.hypot(xx-cx,yy-cy)
    im=Image.new("L",(w,h));pen=ImageDraw.Draw(im)
    angles=np.linspace(0,2*np.pi,15,endpoint=False)+rng.uniform(-.11,.11,15)
    rings=[]
    for rad in (.041,.135,.245,.41,.71):
        r=rad*h*rng.uniform(.76,1.32,len(angles))
        a=angles+rng.uniform(-.1,.1,len(angles))
        rings.append(np.column_stack((cx+np.cos(a)*r,cy+np.sin(a)*r)))
    for i in range(len(angles)):
        path=[(cx,cy)]+[tuple(r[i]) for r in rings[:rng.integers(2,6)]]
        for j,(p,q) in enumerate(zip(path,path[1:])):
            pen.line([p,q],fill=int(rng.integers(160,248)),width=max(1,4-j))
            if j>1 and i%2:
                pen.line([p,(q[0]+rng.uniform(-11,11),q[1]+rng.uniform(-14,14))],fill=125,width=1)
        for j,ring in enumerate(rings[:3]):
            if rng.random()<.8-j*.18:
                pen.line([tuple(ring[i]),tuple(ring[(i+1)%len(angles)])],fill=166-j*23,width=max(1,3-j))
    lines=np.asarray(im,np.float32)/255
    frost=np.exp(-(radii/(h*.088))**1.45)
    frost=np.clip(.87*frost+.48*ndimage.gaussian_filter(lines,2.6)+lines*.77,0,1)
    frost*=rng.uniform(.77,1,frost.shape)
    opening=Image.new('L',(w,h));edge=ImageDraw.Draw(opening)
    if key in (81,86,87,91):
        rim=[]
        for i,a in enumerate(angles):
            length=h*rng.uniform(.16,.37)
            if key==86 and i in (10,11,12): length=h*.67
            rim.append((cx+length*np.cos(a),cy+length*np.sin(a)))
        edge.polygon(rim,fill=255)
        for i in (2,7,11):
            a=np.array(rim[i]);b=np.array(rim[(i+1)%len(rim)])
            tip=.64*((a+b)/2)+.36*np.array([cx,cy])
            edge.polygon([tuple(a),tuple(b),tuple(tip)],fill=104)
    return frost,np.asarray(opening)


def windows(m,base):
    f=m.f
    u,v,keys=pane_uv(f)
    for key in np.unique(keys):
        ix=np.flatnonzero(keys==key)
        for aged,layer in [(False,m.hurt),(True,m.decay)]:
            pic=acrylic(int(key),aged)
            if pic is None: continue
            frost,holes=pic
            h,w=frost.shape
            coords=(np.clip((v[ix]*h).astype(int),0,h-1),np.clip((u[ix]*w).astype(int),0,w-1))
            fog=frost[coords]
            ink=base[ix,:3]+(np.array([215,227,216])-base[ix,:3])*fog[:,None]
            show=fog>.065
            layer.rgba[ix[show],:3]=byte(ink[show])
            layer.rgba[ix[show],3]=np.where(fog[show]>.26,68 if aged else 219,78 if aged else 146)
            hole=holes[coords]
            air=ix[hole==255];shard=ix[hole==104]
            room=8*(u[air]>.64)+7*(v[air]>.79)
            for ch,c in enumerate((13,20,22)): layer.rgba[air,ch]=byte(c+room+m.cloud[air]*4)
            layer.rgba[air,3]=65
            layer.rgba[shard,:3]=byte(np.array([63,85,89])+m.tone[shard,None]*.45)
            layer.rgba[shard,3]=74


def collision(m):
    f,h=m.f,m.hurt
    x,y,z=f.x,f.y,f.z
    body=f.on("separate molded demi-hull")|f.on("sheer and internal bulwark")
    motor=f.on("outboard cowling")|f.on("intake grille")|f.on("gear leg")
    # The starboard transom and its engine take the same oblique blow.
    target=(body|motor)&(x<-.75)&(z<-3.60)
    curve=1.40+.30*(z+5.1)+.62*(x+1.61)
    ridge=y-curve+.024*m.mottle+.015*wave(z*1.41)
    lens=fade(1.27,.48,np.hypot((z+4.70)/.94,(x+1.68)/.52))
    splinters=wave((y+z*.09)*51+.24*m.mottle)
    mark=target & ~motor & (lens>.04)
    h.mark(mark&(abs(ridge)<.15*lens)&(splinters>-.36),1,(146,144,127),m.tone*.70)
    h.mark(mark&(abs(ridge)<.09*lens),2,(150,126,93),m.tone+splinters*18)
    h.mark(mark&(abs(ridge-.031*lens)<.032*lens),3,(42,43,37),m.tone*.55)
    h.mark(mark&(abs(ridge+.064*lens)<.014*lens),3,(207,183,138),m.tone*.63)
    cowl=motor & (x<0)
    a=x+1.55
    b=z+5.14
    fold=y-1.41+.49*a-.29*b+.063*np.sin(12*(a+.25*b))+.019*m.mottle
    radius=np.hypot(a/.31,b/.43)+.17*m.mottle
    tear=fade(1.14,.52,radius)
    shards=noise(a*9+b*7,fold*83,z*1.3,1)
    h.mark(cowl&(abs(fold)<.128*tear)&(shards>-.32),1,(134,134,118),m.tone*.58)
    h.mark(cowl&(abs(fold)<.083*tear),2,(136,123,98),m.tone*.7+20*shards)
    h.mark(cowl&(fold<.043*tear)&(fold>-.032*tear),3,(36,41,41),m.tone*.47)
    h.mark(cowl&(abs(fold+.046*tear)<.012*tear)&(shards>-.22),3,(189,178,146),m.tone*.71)
    port=body&(x>0)&(f.nx>.30)
    t=(z+.64)/2.99
    line=y-(.978+.082*t+.054*t*t+.019*wave(z*.35)+.010*m.mottle)
    width=.083*np.maximum(0,1-t*t)*(.94+.16*m.cloud)
    grain=noise(z*.91,line*94,x*2.6,1)+.45*noise(z*3,line*131,x*1.1,2)
    smear=port&(abs(t)<1)&(abs(line)<width)
    h.mark(smear,1,(64,69,64),m.tone*.50+7*grain)
    h.mark(smear&(line<.019)&(grain>-.04),2,(164,144,105),m.tone*.65+14*grain)
    h.mark(smear&(line<.003)&(grain>.39)&(abs(t)<.67),3,(219,192,143),m.tone*.74)
    keel=f.on("separate molded demi-hull")&(f.up<-.30)&f.is_tag("under")
    t=(z-1.22)/3.29
    cut=abs(abs(x)-1.35-.068*t-.033*wave(z*.32))+.012*m.mottle
    lap=np.maximum(0,1-t*t)
    h.mark(keel&(cut<.143*lap),1,(120,125,111),m.tone*.62)
    h.mark(keel&(cut<.092*lap)&(grain>-.32),2,(162,141,105),m.tone)
    h.mark(keel&(cut<.024*lap),3,(81,73,58),m.tone*.69)
    tube=f.on("gear leg")|f.on("skeg")|f.on("cavitation plate")
    track=abs(x+1.36+.031*wave(z*.71))+.010*m.grit
    h.mark(tube&(x<0)&(track<.064)&(m.mottle>-.25),2,(150,154,146),m.tone*.69)
    h.mark(tube&(x<0)&(track<.016),3,(76,78,72),m.tone*.62)


def console_fire(m,base):
    f=m.f
    x,y,z=f.x,f.y,f.z
    lid=f.on("formed sport hardtop")|f.on("hardtop carbon underside")|f.on("hardtop vent glass")
    frame=f.on("forward swept T-top leg")|f.on("tapered tower cheek")
    place=lid|frame|f.on("helm console")|f.on("instrument fascia")|f.upholstery|f.glass|f.is_tag("chart")
    if not place.any(): return
    lift=np.clip((y-1.36)/2.28,0,1)
    xx=x+.90-.31*lift
    zz=z-.62+.77*lift
    along=zz-.46*xx
    across=xx+.18*zz
    plume=noise(across*8,along*1.6,y*.71,1)
    r=np.hypot(across/(.54+.20*lift),along/(.78+.41*lift))
    draught=noise(across*13+along*.3,along*1.21,y*.74,0)
    r+=.19*m.cloud+.10*m.mottle+.11*plume+.036*m.grit
    tail=np.clip((-along+.28)/1.62,0,1)
    for start,width,bend in [(-.24,.14,.20),(.30,.11,-.13)]:
        tongue=np.exp(-((across-start-bend*tail-.08*np.sin(along*3.0))/width)**2)
        r-=lid*tail*tongue*(.45+.18*plume)

    trail=fade(-1.98,-.55,along)*fade(.74,.22,abs(across+.16*np.sin(along*3)))*fade(.30,.76,lift)
    r-=.32*trail
    intensity=fade(1.52,.22,r)
    coal=fade(.86,.47,r)
    soot=fade(1.55,1.11,r)
    amber=fade(1.27,.91,r)
    ground=base[:,:3].astype(np.float32)
    def blend(col,p,a):
        return col+(np.asarray(p)-col)*a[:,None]
    colour=blend(ground,(116,113,104),soot*.81)
    colour=blend(colour,(147,94,52),amber)
    colour=blend(colour,(83,62,43),fade(1.06,.72,r))
    colour=blend(colour,(26,26,24),coal)
    colour=blend(colour,(12,15,15),fade(.56,.23,r)*(.72+.16*draught))

    pits=wave(x*17+y*11+z*25+.43*m.mottle)*wave(z*19-x*6+.56*m.mottle)
    edge=fade(.54,.75,r)*fade(1.18,.93,r)*fade(-.11,.50,m.cloud+.44*plume)
    colour+=((m.tone*.36+3*plume)*intensity+edge*(21*pits+18*np.maximum(0,pits)))[:,None]
    from wear import cells
    _,dy,bubble,size=cells(x*22+z*5,z*24+y*13,801)
    blister=edge*fade(.40,.88,size)*fade(1.16,.76,bubble)
    colour+=((27+60*dy)*blister-33*blister*fade(.63,.20,bubble))[:,None]
    # Worn-through gel exposes small hooked fibres in the amber transition.
    fringe=edge*fade(-.22,.48,plume+.47*m.mottle)*fade(.38,.78,pits)
    colour=blend(colour,(172,149,117),fringe*.62)

    fibre=f.upholstery*coal*fade(.06,.014,abs(wave((x-z*.42)*2.9+.14*m.mottle)))
    colour=blend(colour,(136,109,69),fibre*.75)
    show=place&(r<1.52)
    # Fire spreads from the loom toward the aft lip. Each stage fills one connected patch.
    travel=.60-.42*along+.36*across+.12*m.cloud+.07*plume
    travel+=np.where(lid,.34,-.14)+.12*lift
    onset=np.where(travel<.28,211,np.where(travel<.96,144,63))
    m.hurt.rgba[show,:3]=byte(colour[show])
    m.hurt.rgba[show,3]=onset[show]
