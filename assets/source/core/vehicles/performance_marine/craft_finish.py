"""Small-craft coatings and transfers, measured on the hull moulds."""
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw

from graphics import lettering
from paint import HERE, byte, noise, periodic, poly, ramp, ridge, rounded_box, transfer


REGISTRATIONS = {"needle":"FL 2207 KX", "jon_boat":"FL 0915 HR", "riptide":"FL 6630 PW"}
DRAFT = {"needle":.43, "jon_boat":.20, "riptide":.22}
HEIGHT = {"needle":1.64, "jon_boat":1.15, "riptide":1.17}
SAMPLE = {"needle":(228,130,70), "jon_boat":(44,59,43), "riptide":(43,218,218)}
# Longitudinal station, half beam, chine and deck edge in metres.
STATIONS = {
    "needle": [
        (-4.46,.84,.36,.88), (-4.16,.97,.38,.92), (-3.28,1.055,.40,.95), (-2.22,1.094,.41,.98),
        (-.02,1.10,.43,1.02), (.54,1.065,.47,1.065), (1.46,.923,.49,1.088), (2.43,.730,.57,1.11),
        (3.39,.504,.68,1.13), (4.26,.275,.82,1.145), (4.78,.092,.99,1.16), (5,.012,1.119,1.159),
    ],
    "jon_boat": [
        (-1.73,.725,.015,.562), (-1.42,.760,.004,.575), (-.88,.796,0,.587), (.62,.81,.008,.601),
        (1.05,.799,.030,.606), (1.43,.766,.103,.617), (1.86,.681,.292,.636), (2.09,.621,.467,.653),
        (2.2,.581,.574,.658),
    ],
    "riptide": [
        (-1.49,.433,.202,.369), (-1.36,.548,.184,.403), (-1.17,.574,.183,.426), (-.89,.586,.183,.454),
        (-.43,.604,.187,.472), (.04,.609,.193,.513), (.34,.60,.21,.569), (.64,.574,.244,.608),
        (.94,.512,.293,.622), (1.22,.421,.365,.628), (1.44,.279,.447,.631), (1.60,.106,.557,.634),
        (1.65,.022,.601,.634),
    ],
}
HULL = {"needle":"warped V hull", "jon_boat":"pressed hull sheet", "riptide":"chined hull"}


@lru_cache(None)
def graphic(key):
    if key == "number":
        im = Image.new("L",(450,280))
        d = ImageDraw.Draw(im)
        d.polygon([(64,12),(222,12),(244,39),(197,236),(165,266),(18,266),(4,236),(46,43)],fill=255)
        d.polygon([(95,64),(177,64),(142,211),(60,211)],fill=0)
        d.polygon([(261,12),(444,12),(433,60),(296,266),(228,266),(371,64),(247,64)],fill=255)
        return im.crop(im.getbbox())
    if key == "stiletto":
        face=lettering("STILETTO",185,14,4)
        return face.transform((face.width+65,face.height),Image.Transform.AFFINE,
                              (1,.37,-face.height*.37,0,1,0),Image.Resampling.BICUBIC)
    text=REGISTRATIONS.get(key,key)
    im=lettering(text,145,8,3)
    if key=="jon_boat":
        d=ImageDraw.Draw(im)
        for i in range(35,im.width,43):
            d.polygon([(i,0),(i+4,0),(i-2,im.height),(i-6,im.height)],fill=0)
    return im


def foundation(s,vessel):
    x,y,z=s.P.T
    table=np.asarray(STATIONS[vessel])
    beam,chine,sheer=[np.interp(z,table[:,0],table[:,i]).astype(np.float32) for i in (1,2,3)]
    hull=s.on(HULL[vessel])
    stern=hull & (z<table[0,0]+.002) & (s.N[:,2]<-.6)
    exterior=hull & ((s.N[:,0]*np.sign(x)>.15)|(s.N[:,1]<-.20)|stern)
    side=exterior & ~stern & (abs(x)>beam*.80) & (s.N[:,0]*np.sign(x)>.26)
    water=exterior|s.on("strake","leg","gearcase","gimbal","skeg","plate","sponson","nozzle","transom board")
    foot=np.clip(s.MPT,.001,.023)
    return dict(hull=hull, exterior=exterior, side=side, transom=stern, beam=beam, chine=chine, sheer=sheer,
                top=np.clip(s.N[:,1],0,1), foot=foot, water_surface=water,
                waterline=water*np.exp(-((y-DRAFT[vessel])/.021)**2),
                upholstery=s.where("suede","vinyl"), glass=s.where("screen"),
                gelcoat=s.where("gel","pearl","midnight","graphite"), timber=s.where("teak"))


def needle_fields(s):
    f=foundation(s,"needle")
    x,y,z=s.P.T
    side,foot,depth=f["side"],f["foot"],np.maximum(.04,f["sheer"]-f["chine"])
    q=(y-f["chine"])/depth
    deck=f["hull"]&(s.N[:,1]>.30)&((z>.16)|(z<-2.32))
    fore=deck&(z>.30)
    signed=np.where(x>0,-1,1)
    def flank(points):
        return side*poly(z,q,points,foot/depth*.70)
    spine=flank([(-4.5,.06),(-1.98,.08),(.95,.50),(2.69,.66),(.96,.39),(-1.47,.015),(-4.5,-.06)])
    vermilion=flank([(-4.5,.10),(-1.95,.12),(.81,.50),(-1.99,.175),(-4.5,.17)])
    aft=side*poly(z,y-f["sheer"],[(-4.49,-.057),(-2.33,-.057),(-2.54,-.244),(-4.49,-.231)],foot*.70)
    # One race plate on each topside and a longitudinal one on the foredeck.
    u=signed*(z-.39)
    v=y-(f["chine"]+.59*depth)
    panel=rounded_box(u+.11*v,v,.365,.149,.068)
    race=transfer("number",u,v,side,.392,.219,foot)
    du=-x
    dv=z-2.62
    deckplate=rounded_box(du+.10*dv,dv,.305,.326,.094)
    deckrace=transfer("number",du,dv,fore,.473,.388,foot)
    spar=abs(x)-f["beam"]*(.76-.063*np.cos(.7*z))
    rail=deck*ridge(spar,.027,foot*.65)
    trim=deck*ridge(spar+.048,.0065,foot*.55)
    # Underfoot the pressed opposing ridges stop short of the hatch and coaming.
    margin=np.minimum(f["beam"]*.93-abs(x),abs(x)-f["beam"]*.65)
    walk=deck*ramp(.012,.042,margin)*ramp(.27,.48,abs(z+1.06)-1.12)
    reg=transfer("needle",signed*(z-2.97),y-(f["sheer"]-.095),side,.63,.079,foot)
    name=transfer("stiletto",signed*(z+3.42),y-(f["sheer"]-.147),side,1.57,.113,foot)
    name_t=transfer("stiletto",-x,y-.811,f["transom"],.72,.083,foot)
    reg_ground=side*poly(z,y-f["sheer"],[(2.53,-.042),(3.48,-.042),(3.39,-.148),(2.58,-.148)],foot*.60)
    pearl=fore*ramp(.38,.48,abs(x)/np.maximum(.015,f["beam"]))*ramp(.90,.78,abs(x)/np.maximum(.015,f["beam"]))
    f.update(deck=deck,pearl=pearl,reg_ground=reg_ground,name=np.maximum(name,name_t),registration=reg,graphic=spine,tracer=vermilion,
             aft_panel=aft,deck_rail=rail,deck_trim=trim,walk=walk,number=np.maximum(race,deckrace),
             plate=np.maximum(side*ramp(foot,-foot,panel),fore*ramp(foot,-foot,deckplate)),
             plate_key=np.maximum(side*ridge(panel+.016,.005,foot*.52),fore*ridge(deckplate+.015,.006,foot*.55)))
    return f


class Coating:
    def __init__(self,s):
        self.s=s
        self.rgb=np.full((s.n,3),85,np.float32)
        self.rough=np.full(s.n,.33,np.float32)
        self.metal=np.zeros(s.n,np.float32)
        self.dye=np.zeros((s.n,3),np.float32)
        self.height=np.full(s.n,125,np.float32)
        self.fine=noise(s.P,.009,617)
        self.flake=noise(s.P,.047,322)
        self.cloud=noise(s.P,.34,639)

    def lay(self,a,colour,rough,metal=0,dye=None):
        a=np.asarray(a,dtype=np.float32)
        self.rgb+=(np.asarray(colour,np.float32)-self.rgb)*a[:,None]
        self.rough+=(rough-self.rough)*a
        self.metal+=(metal-self.metal)*a
        self.dye*=1-a[:,None]
        if dye is not None:
            self.dye[:,dye]+=a

    def finish(self):
        ao=self.s.AO
        shade=(.945+.055*ao)*(1+.013*self.flake+.012*self.fine)
        self.rgb*=shade[:,None]
        dyed=self.dye.max(1)>.5/255
        r,g,b=self.rgb[dyed].T
        self.rgb[dyed]=(.2126*r+.7152*g+.0722*b)[:,None]
        packed=np.column_stack((ao,self.rough,self.metal))
        return byte(self.rgb),self.height,byte(packed*255),byte(self.dye*255)


def substrates(p,s,f):
    x,y,z=s.P.T
    for tag,colour,rough in (("pearl",(230,227,213),.186),("gel",(179,179,179),.175),
          ("graphite",(47,48,50),.228),("midnight",(46,46,49),.212),("engine",(52,56,55),.265),
          ("tread",(48,50,48),.79),("vermilion",(212,61,39),.44),("suede",(167,167,167),.81),
          ("screen",(64,88,96),.105),("citron",(207,221,75),.35),("carbon",(43,46,47),.31)):
        p.lay(s.where(tag),colour,rough,dye=0 if tag=="gel" else 1 if tag=="suede" else None)
    face=s.N
    u=np.where(abs(face[:,0])>.68,y,x)
    v=np.where(abs(face[:,2])>.66,y,z)
    # Alternating pairs of tow ribbons cross over and under in a two-by-two twill.
    a,b=(u+v*.54)/.015,(v-u*.54)/.015
    warp=(np.floor(a)+np.floor(b))%4<2
    weave=np.where(warp,np.cos(2*np.pi*a),np.cos(2*np.pi*b))
    carbon=s.where("carbon")
    p.rgb+=((8*weave+5*np.where(warp,1,-1))*carbon)[:,None]
    p.height+=3.4*weave*carbon+2*p.fine
    p.rough+=carbon*(.029*weave+.015*p.flake)
    p.rgb*= (1-.12*f["waterline"]-.026*f["water_surface"]*ramp(.45,.05,y))[:,None]
    p.rough+=.075*f["waterline"]
    return p


def needle_paint(p,s,f):
    x,y,z=s.P.T
    p.lay(f["graphic"],(34,37,41),.218)
    p.lay(f["tracer"],(210,57,41),.24)
    p.lay(f["aft_panel"],(43,44,47),.22)
    p.lay(f["pearl"],(229,225,211),.185)
    p.lay(f["reg_ground"],(224,221,204),.234)
    p.lay(f["deck_rail"],(46,48,50),.205)
    p.lay(f["deck_trim"],(204,55,37),.22)
    p.lay(f["plate"],(234,229,210),.27)
    p.lay(f["plate_key"],(115,103,91),.31)
    p.lay(f["number"],(34,35,36),.23)
    p.lay(f["name"],np.where(f["transom"][:,None],(32,35,37),(237,231,210)),.205)
    p.lay(f["registration"],(27,29,31),.26)
    grit=np.cos(196*(x+z))*np.cos(196*(x-z))
    p.height+=f["walk"]*(11+13*grit)
    p.rough+=f["walk"]*(.24+.06*grit)
    # Twin harness ports and bound shoulder panels in each individual shell.
    back=s.on("wraparound bucket")
    v=np.where(back,y,z)
    edge=abs(x)-(.111+.038*np.cos((v-.98)*7))
    seam=f["upholstery"]*ridge(edge,.0053,f["foot"]*.58)
    thread=seam*ramp(.013,.006,periodic(v,.027))
    p.lay(thread,(193,148,105),.79)
    p.height+=f["upholstery"]*(4.6*p.fine-8*ridge(edge,.012,f["foot"]*.7))+9*thread
    slot=rounded_box(abs(x)-.098-.18*(y-1.39),y-1.389,.056,.023,.011)
    port=back&(abs(s.N[:,2])>.54)
    p.lay(port*ramp(.005,-.005,slot),(17,20,21),.65)
    p.lay(port*ridge(slot-.004,.005,f["foot"]*.50),(104,98,88),.46)
    p.height-=22*port*ramp(.004,-.004,slot)
    # The shift lights lie on the aft edge of the dash above the five gauge bezels.
    dash=s.on("moulded dashboard")&(s.N[:,1]>.30)
    strip=rounded_box(x,z-.022,.136,.018,.008)
    p.lay(dash*ramp(f["foot"],-f["foot"],strip),(24,27,27),.44)
    bulbs=dash*(abs(x)<.124)*ridge(periodic(x,.031),.009,f["foot"]*.55)*ridge(z-.022,.008,f["foot"]*.55)
    p.lay(bulbs,np.where((abs(x)>.071)[:,None],(197,66,38),(187,173,83)),.2)
    foot=f["glass"]*ramp(.044,.009,y-1.105)
    p.lay(foot,(25,35,37),.22)


def fields(s,vessel):
    if vessel=="jon_boat":
        from skiff_finish import skiff_fields
        return skiff_fields(s)
    if vessel=="riptide":
        from ski_finish import ski_fields
        return ski_fields(s)
    if vessel=="needle":
        return needle_fields(s)
    raise ValueError(f"Unknown small-craft finish: {vessel}")


def paint_strip(s,vessel):
    f=fields(s,vessel)
    p=substrates(Coating(s),s,f)
    if vessel=="jon_boat":
        from skiff_finish import skiff_paint
        skiff_paint(p,s,f)
    elif vessel=="riptide":
        from ski_finish import ski_paint
        ski_paint(p,s,f)
    else:
        needle_paint(p,s,f)
    return p.finish()
