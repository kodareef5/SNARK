"""Staged surface damage and marina weathering in the boat's rest frame."""
import argparse
from functools import lru_cache
from pathlib import Path
from tempfile import NamedTemporaryFile

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from scipy.spatial import cKDTree

from paint import HERE, OWN, Scheme, Surface, byte, fade, noise, teak_fields, wave


class Layer:
    def __init__(self, shape):
        self.rgba = np.zeros((*shape, 4), np.uint8)

    def mark(self, mask, stage, pigment, shade=0, timing=0):
        if not mask.any():
            return
        change = shade[mask] if np.ndim(shade) else shade
        for ch, value in enumerate(pigment):
            value = value[mask] if np.ndim(value) else value
            self.rgba[..., ch][mask] = byte(value + change)
        offset = timing[mask] if np.ndim(timing) else timing
        self.rgba[..., 3][mask] = byte((237, 150, 69)[stage-1] + np.clip(offset,-15,15))


def cells(u, v, seed):
    """A jittered shell or spore in each physical cell."""
    i, j = np.floor(u), np.floor(v)
    key = i.astype(np.int32).astype(np.uint32)*2654435761 + j.astype(np.int32).astype(np.uint32)*1597334677 + seed
    key ^= key >> 16
    key *= np.uint32(2246822519)
    key ^= key >> 13
    rx = (key & 255).astype(np.float32)/255
    ry = ((key >> 8) & 255).astype(np.float32)/255
    size = ((key >> 16) & 255).astype(np.float32)/255
    dx, dy = u-i-.30-.40*rx, v-j-.30-.40*ry
    return dx, dy, np.hypot(dx,dy)/(.095+.195*size), size


class Marks:
    def __init__(self, f):
        self.f = f
        self.hurt, self.decay = Layer(f.x.shape), Layer(f.x.shape)
        x,y,z = f.x,f.y,f.z
        self.cloud = noise(x*1.8,y*1.9,z*1.8,0)
        self.mottle = noise(x*8,y*10,z*8,1)
        self.grit = noise(x*56,y*64,z*51,2)
        self.tone = 18*self.mottle+12*self.grit

    def breach(self,side,at,level,length,height,slope,seed):
        f,h = self.f,self.hurt
        z,y = f.z,f.y
        u = (z-at)/length
        v = (y-level-(z-at)*slope)/height
        face = f.on("separate molded demi-hull") & (f.x*side>0) & (f.nx*side>.08) & (abs(u)<2.1) & (abs(v)<2.2)
        if not face.any():
            return
        angle = np.arctan2(v,u)
        r = (np.abs(u)**1.44+np.abs(v)**1.44)**(1/1.44)
        cut = r + .12*np.sin(3*angle+seed) + .078*np.sin(7*angle-.7*seed) + .08*self.mottle+.09*self.grit
        fibre = wave(z*49+y*71+.35*self.mottle) + .45*wave(z*66-y*32)
        rays = abs(np.sin(5*angle+seed+.57*np.sin(3*angle+seed)+.17*np.sin(r*13)+.055*self.mottle))
        h.mark(face & (cut>1.0) & (cut<1.58+.17*self.cloud) & (rays<.075),1,(88,79,71),self.tone*.55)
        h.mark(face & (cut>.89) & (cut<1.17+.055*fibre),2,(167,131,89),self.tone+fibre*24)
        h.mark(face & (cut>.96) & (cut<1.10) & (fibre>.15),2,(223,207,166),self.grit*13)
        fold = (.60*u+.13*np.abs(u+.3)-.13+.045*np.sin(8*u+seed))
        hinge = v-fold
        plate = face & (abs(u)<1.86) & (abs(hinge)<.40*(1-(u/1.87)**2)) & (cut>.90)
        h.mark(plate,2,(173,160,132),self.tone + 39*np.clip(hinge*4,-1,1))
        h.mark(plate & (hinge<-.015) & (hinge>-.12),2,(66,60,48),self.tone*.6)
        h.mark(face & (cut<.985),3,(19,25,26),self.cloud*7+self.grit*3)
        bevel = face & (cut<1.015) & (cut>.73+.075*fibre)
        lip = 40*np.sin(angle-.58)+fibre*19+self.tone
        h.mark(bevel,3,(128,100,71),lip)
        # The inner laminate peels as angular tabs, still tethered on one edge.
        for anchor,reach,base,rise,thick in [(-.88,.99,-.54,.57,.19),(-.38,.61,-.95,.48,.12)]:
            along=(u-anchor)/reach
            width=thick*np.clip(1-along,0,1)
            off=v-base-rise*along+.03*self.mottle+.016*fibre
            tab=face & (cut<1.06)&(along>0)&(along<1)&(abs(off)<width)
            h.mark(tab,3,(150,126,92),self.tone*.8+fibre*16+18*np.clip(off/.14,-1,1))
            h.mark(tab & (off>width*.64),3,(213,192,148),self.tone*.7)

    def hull(self):
        f,h,d = self.f,self.hurt,self.decay
        x,y,z = f.x,f.y,f.z
        scale = 1 if f.scheme.large else .59
        station = z/scale
        side = np.sign(x)
        outer = f.nx*side>.16
        running = f.is_tag("under")
        molded = f.on("separate molded demi-hull")
        skin = molded | f.on("sheer and internal bulwark")
        hullside = outer & skin & (f.gelcoat|f.is_tag("rubber"))
        rub = skin & f.is_tag("rubber")
        for index,(centre,span,port_y,stbd_y,width,rise) in enumerate((
            (-2.05,4.15,1.58,1.72,.112,.036),(.34,3.36,1.83,1.37,.078,-.054),
            (1.2,3.35,2.11,2.04,.066,.022),(-4.23,2.18,2.35,2.27,.10,.045),
            (5.14,2.00,1.51,1.64,.105,.17),(-6.40,1.52,1.29,1.43,.155,-.09))):
            c = centre + np.where(x>0,0,.45*wave(index+.24*index))
            t = (station-c)/span
            contact = np.maximum(0,1-t*t)
            centre_y = np.where(x>0,port_y,stbd_y) + rise*t + .034*wave(.56*station+index)
            v = (y/scale-centre_y)/width
            fibre = wave(v*1.89+.5*self.mottle + .23*wave(station*1.2)) + .55*wave(v*4.1+index)
            edge = abs(v)-contact*(.72+.28*self.cloud) + .23*self.mottle+.12*self.grit
            base = hullside & (abs(t)<1) & (edge<0)
            h.mark(base & (fibre>-.02),1,(97,93,82),self.tone + fibre*17,contact*21-9)
            h.mark(base & ((edge<-.22)&(fibre>.48)),2,(183,154,114),self.tone+fibre*13)
            h.mark(base & (edge<-.33)&(v<.05)&(fibre<.26),2,(96,75,58),self.tone)
        chafe = rub & (self.cloud+.5*self.mottle>.18) & (self.grit+.38*wave((y+z*.009)*77)>.20)
        h.mark(chafe,1,(128,125,112),self.tone)
        # A piling first transfers rubber, then strips a long edge along the port chine.
        t = (station+.52)/3.93
        offset = y/scale-(1.24+.19*t+.046*wave(station*.17)+.018*self.cloud)
        width = .109*np.maximum(0,1-t*t)
        furrows = wave(offset*29+.22*self.mottle+.12*wave(station*.53))
        sweep = hullside & (x>0) & (abs(t)<1)&(abs(offset)<width)
        h.mark(sweep & ((furrows>-.12)|(abs(offset)<.36*width)),1,(74,79,73),self.tone*.7)
        h.mark(sweep & (offset<-.10*width)&(furrows>.13),2,(195,171,124),self.tone+furrows*14)
        h.mark(sweep & (abs(t+.19)<.54)&(offset<-.2*width)&(furrows<-.40),3,(84,67,50),self.tone)
        if f.scheme.large:
            wounds=[(1,6.23,1.29,1.08,.38,.15,1.7),(-1,-6.12,1.34,1.06,.38,-.19,3.2),
                    (-1,6.96,1.33,.48,.25,.21,5.1),(1,-4.30,1.18,.53,.18,.06,2.3)]
        else:
            wounds=[(1,3.57,.91,.70,.215,.21,4.77),(-1,-4.06,.88,.51,.23,-.31,.92)]
        for args in wounds:
            self.breach(*args)

        keel = abs(x)-(2.60 if f.scheme.large else 1.35)
        against = (running|molded) & (f.up<-.26)
        groove = np.zeros_like(y)
        for line,start,length in [(-.32,-.84,4.12),(.18,1.64,4.56),(.47,3.36,3.85),(-.58,-2.81,2.82)]:
            t = (station-start-side*.28)/length
            axis = line+.048*wave(station*.27+line)+.030*t
            width = scale*(.08+.09*np.maximum(0,1-t*t))
            grain = abs(keel-axis*scale)/width + .28*self.mottle+.11*self.grit
            groove = np.maximum(groove,np.where(abs(t)<1,(1-grain)*np.minimum(1,(1-abs(t))*6),0))
        hair = wave(keel/scale*47+.26*self.mottle+z*.24)
        h.mark(against & (groove>.16)&(hair>-.45),1,(107,107,91),self.tone)
        h.mark(against & (groove>.38)&(hair>-.1),2,(159,128,89),self.tone+16*hair)
        h.mark(against & (groove>.61)&(hair<.2),3,(76,64,48),self.tone)
        h.mark(against & (groove>.67)&(hair>.24),3,(201,177,125),self.tone+hair*16)
        # On the forefoot the climbing keel carries the contact right up to the stem.
        t=(station-5.1-side*.31)/3.18
        axis=.42+.42*t+.30*t*t
        scrape=y/scale-axis+.035*self.mottle
        ribbon=(.15+.045*wave(station*.62))*np.maximum(0,1-t*t)
        tracks=wave(scrape*18+.14*self.mottle+station*.16)+.53*wave(scrape*33+.12*station)
        forefoot=molded & (abs(t)<1) & (abs(scrape)<ribbon)
        contact=.53*self.cloud+.36*self.mottle+.17*wave(station*.7+side)
        h.mark(forefoot & (tracks+contact>-.25),1,(118,119,104),self.tone*.65)
        h.mark(forefoot & (abs(scrape)<ribbon*.81)&(tracks+contact>.05)&(contact>-.18),2,(157,140,103),self.tone)
        h.mark(forefoot & (abs(scrape)<ribbon*.39)&(tracks<.22)&(contact>.02),3,(97,79,54),self.tone)

        stair = f.on("molded stern stair")
        impact = np.hypot((x+2.91)/.56,(z+7.46)/1.05)
        split = abs(y-1.68+(z+7.63)*-.62+(x+2.9)*.42+.055*self.mottle)
        h.mark(stair & (impact<1.5)&(split<.022),1,(82,81,73),self.tone)
        h.mark(stair & (impact<1.12)&(split<.07+.025*self.grit),2,(173,140,95),self.tone)
        h.mark(stair & (impact<.91)&(split<.041),3,(49,43,38),self.tone*.6)
        if f.scheme.large:
            # The bottom two starboard risers crush back from their outboard corner.
            stairs = (stair|molded) & (x<0)&(z<-6.88)
            dx=(x+3.19)/.74
            dz=(z+8.15)/1.20
            ridge=y-(1.33+.51*(z+8.14)-.28*(x+3.19))+.040*self.mottle
            ends=np.square(dx)+.54*np.square(dz)
            crush=ends+np.abs(ridge)/.23+.11*self.cloud+.10*self.grit
            splints=wave(y*60+x*39+z*14+.24*self.mottle)
            h.mark(stairs & (crush<1.48)&(crush>1.03)&(splints>-.24),1,(140,133,108),self.tone)
            h.mark(stairs & (crush<1.09),2,(178,148,103),self.tone+14*splints)
            h.mark(stairs & (crush<.70)&(ridge<.045),3,(57,50,40),self.tone*.70)
            h.mark(stairs & (crush<.7)&(ridge<-.061)&(splints>.05),3,(202,176,128),self.tone)

        lift = f.is_tag("stripe") & (self.cloud+.50*self.mottle>.13)
        d.mark(lift,2,(166,155,123),self.tone)
        d.mark(lift & (self.grit>.22),3,(86,81,60),self.tone)
        wet = f.waterline/scale
        blades = wave(station*6.7+.63*self.mottle+wet*.8)
        top = .085+.065*self.cloud+.043*self.mottle+.024*blades
        d.mark((wet>top-.033)&(wet<top+.061)&(self.mottle>-.24),1,(172,169,137),self.tone)
        d.mark((wet<top)&(wet>-.18+.10*self.cloud),1,(95,102,65),self.tone*.76)
        weed = (wet<top+.17*self.cloud) & (wet>-.42+.14*self.cloud-.10*blades)
        fringe = noise(station*3.1+side*7, wet*.88, x*1.2, 2)
        high = .14+.57*np.maximum(0,fringe+.40*self.cloud)+.055*blades
        climbers = skin & (wet>top-.08)&(wet<high)&(fringe>.22)&(self.mottle+.22*blades>-.26)
        d.mark(climbers,2,(95,100,65),self.tone)
        d.mark(climbers & (self.grit>.12)&(fringe>.37),3,(58,68,41),self.tone*.7)
        d.mark(weed & (self.mottle+.23*blades>-.08),2,(65,76,44),self.tone,8*blades+7*self.mottle)
        d.mark(weed & (self.cloud+.5*self.mottle>.22) & (blades>-.38),3,(47,54,35),self.tone*.74)
        barnacle_bed = (wet<.055+.11*self.cloud) | ((f.on("high tunnel and bridge main deck") | f.on("tunnel bridge and cockpit sole")) & (f.up<-.35))
        tang = np.where(abs(f.up)>.56, x, y+.14*x)
        dx,dy,r,rand = cells(z*17.5+tang*3,tang*18.5-z*1.27,453)
        beds = self.cloud+.61*self.mottle+.17*rand
        d.mark(barnacle_bed & (beds>.24)&(r<1),2,(155,147,117),24*dy+self.tone*.45)
        d.mark(barnacle_bed & (beds>.24)&(r<.43),2,(75,75,57),self.grit*13)
        d.mark(barnacle_bed & (beds>-.19)&(beds<=.24)&(r<1.06),3,(148,140,114),self.tone*.67+dy*51)
        d.mark(barnacle_bed & (beds>-.19)&(r<.40),3,(70,69,49),self.tone*.65)
        d.mark(barnacle_bed & (beds>.33)&(r>1)&(self.mottle+.4*self.grit>.11),3,(77,79,53),self.tone)

    def structure(self):
        f,h,d = self.f,self.hurt,self.decay
        x,y,z = f.x,f.y,f.z
        body = f.on("panoramic bridge-deck saloon")
        roof = f.on("floating flybridge hardtop") | f.on("flybridge hardtop liner")
        ledge = f.on("flybridge floor and aft cockpit overhang") | f.on("salon roof shadow line")
        post = f.on("aft reverse sheer pillar") | f.on("forward windshield post")
        corner = ((roof|ledge)&(abs(f.up)<.83)) | post | (body & (abs(y-2.91)<.06))
        chips = self.cloud+.64*self.mottle+.40*self.grit
        h.mark(corner & (chips>.62),1,(159,153,131),self.tone)
        h.mark(corner & (chips>.83),2,(139,109,74),self.tone+12*wave(z*61+y*34))
        # A galley-side seat of fire, with a pooling plume under the hardtop and a ragged burn-through above.
        deckfire = np.hypot((x+1.76)/.92,(z+2.31)/1.28)
        roof_fire = np.hypot((x+1.54+.34*wave(z*.19))/1.40,(z+1.84)/1.93)
        fire = np.where(roof,roof_fire,deckfire) + .27*self.cloud+.16*self.mottle+.065*self.grit
        source = roof | (y>4.32) | (body & (y>3.45) & (x<0))
        under = f.on("flybridge hardtop liner")
        ash = 118 + 38*self.cloud+28*self.mottle + 20*np.clip(fire-.66,0,1)
        h.mark(source & (fire<1.18)&(fire>.89)&(self.grit>.18),1,(ash+21,ash+13,ash+1))
        smoke = 85+69*np.clip((fire-.67)/.53,0,1)+self.tone
        h.mark(source & (fire<1.17)&(fire>.60)&(chips>-.55),2,(smoke+13,smoke+6,smoke-5),timing=40*(.89-fire))
        blister = wave(x*11+z*14+self.mottle)+wave(y*16-z*9+.6*self.mottle)
        coal = 33+20*self.mottle+13*self.grit+15*(blister>.91)+13*np.clip(fire,0,1)
        h.mark(source & (fire<.78+.10*under),3,(coal+9,coal+5,coal))
        _,_,bubble,size=cells(x*14+z*4,z*14-x*3,719)
        peel=roof & (fire<.97)&(fire>.40)&(size>.42)&(self.cloud>.05)
        h.mark(peel & (bubble<.92),3,(113,103,85),self.tone+blister*11)
        h.mark(peel & (bubble<.55),3,(55,46,37),self.tone)
        # A broken flange on the opposite forward brow.
        crack = abs(z-(1.15+.50*(x-1.65)+.055*wave(x*2)+.039*self.mottle))
        flap = (roof|ledge) & (x>.82)&(x<2.65)
        h.mark(flap & (crack<.017),1,(85,80,68),self.tone)
        h.mark(flap & (crack<.048)&(x>1.77),2,(165,136,93),self.tone)
        h.mark(flap & (crack<.022)&(x>1.84),3,(39,45,43),self.tone*.55)
        exposure = f.ao*(.58+.42*np.maximum(0,f.up))
        bloom = self.cloud+.53*self.mottle+.09*self.grit+.39*exposure
        d.mark(f.gelcoat & (bloom>.49),2,(207,209,198),self.tone*.42)
        d.mark(f.gelcoat & (bloom>.76),3,(220,219,201),self.tone*.44)
        # A feathered chalk bloom on the white molding. Its edge still holds the sound colour.
        veil=np.clip((bloom-.42)*1.65,0,1)
        pale=f.is_tag("gel")
        d.mark(pale & (bloom>.49),2,(230-18*veil,231-17*veil,222-25*veil),self.tone*.34)
        d.mark(pale & (bloom>.76),3,(230-10*veil,229-12*veil,215-14*veil),self.tone*.36)
        damp = (1-f.ao)*.61+self.cloud+.45*self.mottle
        d.mark((under|ledge|post) & (damp>.69),3,(108,111,93),self.tone*.75)
        droppings = [(1.53,.18),(-.73,-3.17),(2.32,1.07),(.37,-.42),(-1.73,.49),(2.11,-2.74)]
        if roof.any():
            for xx,zz in droppings:
                a,b=x-xx,z-zz
                spot = np.minimum(np.hypot(a/.068,b/.090),np.hypot((a-.038)/.028,(b-.075)/.062))
                spot += .39*self.mottle+.13*self.grit
                htop = roof & (f.up>.65)
                d.mark(htop & (spot<1),1,(205,204,185),self.tone*.65)
                d.mark(htop & (spot<.46),1,(105,99,79),self.tone)

    def fittings(self):
        f,h,d = self.f,self.hurt,self.decay
        x,y,z = f.x,f.y,f.z
        aft = fade(-3,-6.8,z)*fade(.65,-1.8,x)
        grind = fade(1.45,.17,y)
        bow = fade(4,7,z)
        knock = np.maximum.reduce((aft+grind*.32,grind*.85,bow*.68))
        soft = self.cloud+.39*self.mottle
        crease = abs(wave(.56*x+1.28*y+.68*z+.12*self.mottle))
        scuff = wave(27*y+11*x+z*.68+.25*self.mottle)
        h.mark((knock+soft>.84)&(scuff>.36),1,(190,193,180),self.tone*.7)
        h.mark((knock+soft>.98)&(crease<.53),2,(81,87,85),self.tone)
        h.mark((knock+soft>1.12)&(crease<.21),3,(49,53,52),self.grit*10)
        h.mark((knock+soft>1.12)&(crease>=.21)&(crease<.31),3,(218,216,187),self.tone*.45)
        foot = f.on("stanchion foot") | f.on("cleat foot")
        socket = (1-f.ao)*.5 + np.where(foot,.60,0)
        d.mark((socket+soft>.64)&(self.mottle>-.26),1,(145,130,98),self.tone*.6)
        d.mark((socket+soft>.91)&(self.grit>-.04),2,(131,91,61),self.tone*.68)
        screw = f.is_tag("bronze")
        d.mark(screw & (soft>.04),2,(97,113,86),self.tone)
        d.mark(screw & (soft>.27)&(scuff<.44),3,(67,82,65),self.tone)

    def seating(self):
        f,h,d = self.f,self.hurt,self.decay
        x,y,z = f.x,f.y,f.z
        lo,hi = f.low,f.high
        u = (x-lo[0])/np.maximum(.04,hi[0]-lo[0])
        back = f.on("bolstered backrest")
        v = np.where(back,(y-lo[1])/np.maximum(.035,hi[1]-lo[1]),(z-lo[2])/np.maximum(.05,hi[2]-lo[2]))
        centre = .51+.23*wave(lo[0]*.93+lo[2]*.37)
        slash = v-centre-(u-.5)*(.34+.20*wave(lo[2]))-.035*wave(u*3.1)-.03*self.mottle
        end = np.maximum(0,1-((u-centre)/.39)**2)
        sel = wave(lo[2]*.28+lo[0]*.39)>.01
        daybed=f.on("foredeck recliner cushion")
        if daybed.any():
            # A single dragged tear crosses the joints of the three loose daybed pads.
            run=(z-np.where(x>0,5.99,6.16))/.47
            centreline=np.sign(x)*1.72+.38*run+.041*wave(run*.66)+.018*self.mottle
            slash=np.where(daybed,(x-centreline)/.68,slash)
            end=np.where(daybed,np.maximum(0,1-run**2),end)
            sel=sel|daybed
        fibre = wave(x*68+z*45+y*54)
        h.mark(sel & (abs(slash)<.062*end)&(fibre>-.34),1,(151,137,110),self.tone)
        h.mark(sel & (abs(slash)<.044*end),2,(75,69,58),self.tone)
        h.mark(sel & (abs(slash+.009)<.027*end)&(fibre>-.48),2,(206,177,116),self.tone)
        torn = (u>.30)&(u<.84)&(abs(slash)<.11*end*(.73+.20*fibre))
        h.mark(sel & torn & (abs(z)<3),3,(169,138,90),self.tone+fibre*12)
        h.mark(sel & torn & (abs(z)<3)&(slash<-.026),3,(68,57,47),self.tone)
        fire = np.hypot((x+.43)/1.92,(z+.69)/2.45)+.29*self.cloud+.18*self.mottle
        hot = y>4.46
        h.mark(hot & (fire<1.09)&(fire>.66)&(self.mottle>-.14),2,(119,98,73),self.tone)
        char = hot & (fire<.80+.06*fibre)
        h.mark(char,3,(49,44,40),self.tone*.74+fibre*8)
        _,_,spore,_ = cells(x*40+z*11,y*36+z*29,174)
        hem = fade(.12,.018,np.minimum.reduce((u,1-u,v,1-v)))
        wet = .40*hem+.56*(1-f.ao)+self.cloud+.58*self.mottle
        d.mark((wet>.44)&(spore<.90),1,(127,124,100),self.tone*.7)
        mould=np.clip((wet-.43)*1.3,0,1)
        d.mark((wet>.52)&(spore<1.35),2,(134-mould*55,129-mould*46,105-mould*39),self.tone*.64)
        d.mark((wet>.73)&(self.grit>-.28),3,(131-mould*75,126-mould*65,103-mould*54),self.tone*.65)
        rot = (abs(slash-.22)<end*.052)&(wet>.22)&(~daybed|(self.cloud>.11))
        d.mark(rot,3,(112,96,64),self.tone+fibre*13)

    def windows(self):
        f,h,d = self.f,self.hurt,self.decay
        x,y,z = f.x,f.y,f.z
        u,v,pane = pane_coordinates(f)
        edge = np.minimum.reduce((u,1-u,v,1-v))
        runoff = noise(x*27+z*26,y*.73,z*.76,0)
        tide = v*.24 + .45*self.cloud+.33*runoff
        dx,dy,spots,_ = cells(x*17+z*16,y*21,114)
        surface = f.glass
        d.mark(surface & (tide>.18) & (spots>.80)&(spots<1.04),1,(129,146,144),self.tone*.45)
        frost = tide+.26*self.mottle+fade(.12,.00,edge)*.36
        haze=np.clip((frost-.36)*1.9,0,1)
        d.mark(surface & (frost>.39),1,(59+41*haze,83+37*haze,94+26*haze),self.tone*.44)
        d.mark(surface & (frost>.49)&(runoff>-.06),2,(80+61*haze,98+51*haze,107+35*haze),self.tone*.49)
        d.mark(surface & (frost>.63)&(spots<.91),3,(154,155,141),self.tone*.48)
        hot = f.on("panoramic bridge-deck saloon") & (x<0) & (y>3.32)
        plume = abs(z+2.18-.27*(y-3.52)) / (.26+.80*np.maximum(0,y-3.31)) + .32*self.cloud+.15*self.mottle
        h.mark(hot & (plume<1.06)&(v<.54)&(runoff>-.41),2,(84,77,66),self.tone*.66)
        h.mark(hot & (plume<.72)&(v<.32),3,(44,43,37),self.tone*.55)
        if not f.scheme.large:
            return
        for key in np.unique(pane):
            pick = pane==key
            for aged,layer in [(False,h),(True,d)]:
                sprite = fractures(int(key),aged)
                if sprite is None:
                    continue
                sh,sw = sprite.shape[:2]
                ink = sprite[np.clip((v[pick]*sh).astype(int),0,sh-1),
                             np.clip((u[pick]*sw).astype(int),0,sw-1)]
                indices = np.flatnonzero(pick)[ink[:,3]>0]
                layer.rgba[indices] = ink[ink[:,3]>0]


def pane_coordinates(f):
    if not f.scheme.large:
        from sport_wear import pane_uv
        return pane_uv(f)
    x,y,z = f.x,f.y,f.z
    lo,hi=f.low,f.high
    u = (z-lo[2])/np.maximum(.004,hi[2]-lo[2])
    v = (hi[1]-y)/np.maximum(.004,hi[1]-lo[1])
    pane = np.asarray(40 + (x>0)*10 + np.floor((lo[2]+6)*.72).astype(int),np.int16)
    salon = f.on("panoramic bridge-deck saloon")
    if salon.any():
        t = np.clip((y-3.05)/1.06,0,1)
        front = z>3.48-.90*t-.30
        stern = z < -4.57+.14*t+.28
        side = salon & ~(front|stern)
        for j,(zl,zh,sl,sh) in enumerate([(-4.57,-2.6,.14,-.25),(-2.6,-.64,-.25,-.31),
                                           (-.64,.97,-.31,-.37),(.97,3.48,-.37,-.90)]):
            a,b = zl+sl*t,zh+sh*t
            q=side & (z>=a)&(z<=b)
            u[q]=((z-a)/(b-a))[q]
            pane[q]=4+4*(x[q]>0)+j
        for q,centres,first in [(salon&front,[-2.94,-1.32,0,1.32,2.94],0),
                                (salon&stern,[-2.94,-1.53,0,1.53,2.94],12)]:
            for j,(a,b) in enumerate(zip(centres,centres[1:])):
                pick=q & (x>=a)&(x<=b)
                u[pick]=(x[pick]-a)/(b-a)
                pane[pick]=first+j
        v[salon]=1-t[salon]
    fly=f.on("smoked flying bridge windshield")
    u[fly]=((x-lo[0])/np.maximum(.01,hi[0]-lo[0]))[fly]
    pane[fly]=20
    quarter=f.on("flybridge quarter windscreen")
    pane[quarter]=21+(x[quarter]>0)
    screen=f.is_tag("chart","sonar")
    u[screen]=((hi[0]-x)/np.maximum(.01,hi[0]-lo[0]))[screen]
    pane[screen]=70+f.is_tag("sonar")[screen]
    return np.clip(u,0,1),np.clip(v,0,1),pane


@lru_cache(maxsize=160)
def fractures(key,aged):
    """An impact, its branching cracks, loose shards and fallen centre on one pane."""
    heavy = key in (1,5,10,13,21,43,53)
    if aged:
        if key not in (0,6,9,14,20,22,42,54):
            return None
        heavy = key in (6,14,22,54)
    elif key in (0,6,9,14,22,42,54,71) or (key>=40 and key<70 and key%3==0 and not heavy):
        return None
    rng=np.random.default_rng(911+key*37+aged*8971)
    w,h = (720,162) if key==20 or key>=40 else (430,280)
    im=Image.new("RGBA",(w,h))
    pen=ImageDraw.Draw(im)
    cx,cy = rng.uniform(.19,.80)*w, rng.uniform(.19,.81)*h
    count = rng.integers(10,17)
    angles = np.arange(count)*2*np.pi/count+rng.uniform(-.13,.13,count)
    rings=[]
    strength=.67 if heavy else .43
    if key>=70:
        strength=.34
    for radius in (.075,.19,.34,.60,1.13):
        ring=[]
        for a in angles:
            ang = a+rng.uniform(-.16,.16)
            reach = radius*strength*rng.uniform(.78,1.28)
            width_scale = .30 if key==20 else .70 if key>=40 else 1
            ring.append((int(cx+w*reach*width_scale*np.cos(ang)),int(cy+h*reach*1.38*np.sin(ang))))
        rings.append(ring)
    for i in range(count):
        tip = int(rng.integers(2,5))
        if heavy and i%3==0:
            tip=5
        points=[(int(cx),int(cy))]+[ring[i] for ring in rings[:tip]]
        stage=64 if aged else (226 if i%4!=1 else 151)
        pen.line(points,fill=(69,93,100,stage),width=4)
        pen.line(points,fill=(178,201,199,stage),width=2)
        if tip>=3:
            a,b=points[-2:]
            end=(int(b[0]+rng.uniform(-35,35)),int(b[1]+rng.uniform(-30,30)))
            pen.line((a,end),fill=(129,159,165,stage),width=2)
    for j,ring in enumerate(rings[:3]):
        for k,p in enumerate(ring):
            if rng.random() < (.74-j*.14 if heavy else .53-j*.12):
                q=ring[(k+1)%count]
                pen.line((p,q),fill=(161,189,190,62 if aged else 152),width=2 if j else 3)
    if heavy:
        # Some apertures run into a gasket. Long triangular remnants cling to the other edges.
        tear=[]
        for i,a in enumerate(angles):
            dx,dy=w*np.cos(a),h*1.41*np.sin(a)
            if key in (5,14):
                # One dropped light still has little knives of glass in the gasket.
                rim=min((w-cx)/dx if dx>0 else -cx/dx, (h-cy)/dy if dy>0 else -cy/dy)
                reach=rim*rng.uniform(.92,1.19)
                if i%4==1:
                    reach*=.75
            else:
                reach = rng.uniform(.36,.67) if key in (13,22) else rng.uniform(.15,.38)
            tear.append((cx+reach*dx,cy+reach*dy))
        opening=Image.new("L",(w,h))
        ImageDraw.Draw(opening).polygon(tear,fill=255)
        rows,cols=np.indices((h,w))
        sill=11*np.exp(-((rows/h-.76-cols/w*.08)/.018)**2)
        wall=9*(cols/w>.64+rows/h*.055)+3*np.sin(cols/w*11)
        interior=byte(np.stack((10+wall+sill,16+wall+sill,18+wall+sill,rows*0+77),axis=-1))
        im.paste(Image.fromarray(interior),(0,0),opening)
        for i,p in enumerate(tear):
            q=tear[(i+1)%count]
            if i%3!=0:
                pen.line((p,q),fill=(136,162,165,72),width=3)
            if i%4==1:
                r=(.69*p[0]+.31*q[0],.69*p[1]+.31*q[1])
                tip=(.84*r[0]+.16*cx,.84*r[1]+.16*cy)
                pen.polygon((p,r,tip),fill=(77,109,119,71))
    return np.asarray(im)


def fitting_rows(boat):
    feet = {}
    families = ("stanchion foot","cleat foot","aft cockpit roof pillar","stair handrail",
                "foredeck daybed handrail","flybridge table post","aft cockpit table post",
                "foredeck table pedestal","boarding ladder rail","gooseneck tap","rudder stock")
    for material in OWN[boat]:
        with np.load(HERE.parent/boat/"tex/bakes"/(material+".npz")) as b:
            names,which,points=b["parts"],b["part"],b["pos"]
            for i in np.unique(which):
                name = str(names[i])
                if name.split(".")[0] not in families:
                    continue
                p=points[which==i].reshape(-1,3)
                feet.setdefault(name,[]).append(p)
    anchors=[]
    for sections in feet.values():
        p=np.concatenate(sections)
        base=p[p[:,1]<p[:,1].min()+.012]
        anchors.append((base.max(0)+base.min(0))*.5)
    anchors=np.array(anchors).reshape(-1,3)
    rows=[]
    for row in (anchors[anchors[:,1]<3.3],anchors[anchors[:,1]>=3.3]):
        if len(row):
            rows.append((row,cKDTree(row[:,[0,2]])))
    return rows


def tea_stains(m,rows):
    f,d=m.f,m.decay
    x,y,z=f.x,f.y,f.z
    for points,tree in rows:
        near=(y>points[:,1].min()-1.35)&(y<points[:,1].max()+.045)&(f.waterline>-.03)
        if not near.any():
            continue
        ix=np.flatnonzero(near)
        _,at=tree.query(np.stack((x[ix],z[ix]),axis=1),k=1)
        foot=points[at].T
        drop=foot[1]-y[ix]
        dx,dz=x[ix]-foot[0],z[ix]-foot[2]
        dist=np.hypot(dx,dz)
        offset=np.where(abs(f.nx[ix])>abs(f.nz[ix]),dz,dx)
        flow=offset-.023*wave(drop*1.3+foot[2])-.021*drop
        root=np.maximum(0,1-abs(flow)/(.061+.033*np.cos(foot[2]*4)))
        wash=root*(1-np.clip(drop/1.21,0,1)) + .18*m.mottle[ix]+.08*m.grit[ix]
        tea=(drop>=-.025)&(drop<1.24)&(dist<.32)&(abs(f.up[ix])<.88)
        rings=(dist<.105)&(drop>=-.025)&(drop<.055)
        for level,local,c in [(1,rings|(tea&(wash>.26)),(184,161,117)),
                              (2,tea&(wash>.48)&(abs(flow)<.037),(152,107,66)),
                              (3,tea&(wash>.74)&(abs(flow)<.026),(113,76,51))]:
            pick=np.zeros_like(near)
            pick[ix]=local
            d.mark(pick,level,c,m.tone*.70)


def own_layers(boat,material,rows):
    folder=HERE.parent/boat/"tex"
    s=Surface(folder/"bakes",material)
    scheme=Scheme(boat,s)
    if boat=="manta":
        from sport_wear import collision, console_fire, windows
        with Image.open(folder/f"{material}_base.png") as image:
            base=np.asarray(image).reshape(-1,4)
    hurt,decay=[np.zeros((s.n,4),np.uint8) for _ in range(2)]
    for start in range(0,s.n,192*1024):
        stop=min(start+192*1024,s.n)
        block=scheme.fields(slice(start,stop))
        glass=block.glass | block.is_tag("chart","sonar")
        trim=block.is_tag("metal","bronze")
        cloth=block.upholstery
        for group,mask in [("windows",glass),("metal",trim),("cloth",cloth),("body",~(glass|trim|cloth))]:
            indices=np.flatnonzero(mask)+start
            if not len(indices):
                continue
            f=scheme.fields(indices)
            m=Marks(f)
            if group=="windows":
                m.windows()
                if boat=="manta":
                    windows(m,base[indices])
            elif group=="metal":
                m.fittings()
            elif group=="cloth":
                m.seating()
            else:
                m.structure()
                skin=np.flatnonzero(f.on("separate molded demi-hull") | f.on("sheer and internal bulwark") |
                                    f.on("high tunnel and bridge main deck") | f.on("tunnel bridge and cockpit sole") | f.on("molded stern stair") |
                                    f.is_tag("under","stripe"))
                if len(skin):
                    lower=Marks(scheme.fields(indices[skin]))
                    lower.hull()
                    for target,source in [(m.hurt,lower.hurt),(m.decay,lower.decay)]:
                        ink=source.rgba[:,3]>0
                        target.rgba[skin[ink]]=source.rgba[ink]
                tea_stains(m,rows)
            if boat=="manta":
                if group=="body":
                    collision(m)
                console_fire(m,base[indices])
            m.decay.rgba[m.hurt.rgba[:,3]>0]=0
            hurt[indices]=m.hurt.rgba
            decay[indices]=m.decay.rgba
    for role,img in [("hurt",hurt),("decay",decay)]:
        store(folder,material,role,img.reshape(s.size,s.size,4))


def store(folder,material,role,data):
    path=folder/f"{material}_{role}.png"
    with NamedTemporaryFile(dir=folder,suffix=".png",delete=False) as file:
        temporary=Path(file.name)
    try:
        Image.fromarray(data).save(temporary,compress_level=4)
        temporary.chmod(0o644)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    a=data[...,3]
    counts=[round(100*float(np.mean((a>i)&(a<=i+85))),2) for i in (170,85,0)]
    print(f"{material} {role}   stage additions {counts} %",flush=True)


def teak_layers():
    board,caulk,lip,bung,tone,grain=teak_fields()
    shape=caulk.shape
    h,d=Layer(shape),Layer(shape)
    rng=np.random.default_rng(96841)
    def field(sy,sx):
        n=ndimage.gaussian_filter(rng.standard_normal(shape).astype(np.float32),(sy,sx),mode="wrap")
        return n/n.std()
    cloud=field(37,27)
    damp=field(17,5)
    fine=field(2,.72)
    y,x=(np.indices(shape,np.float32)+.5)/1024
    def wrap(q):
        return (q+.5)%1-.5
    for cx,cy,breadth,length in [(.233,.315,.008,.13),(.486,.827,.012,.21),
                                  (.710,.495,.008,.104),(.089,.674,.007,.087)]:
        dy=wrap(y-cy)/length
        dx=wrap(x-cx)-.009*dy-.0018*wave(dy*.56)
        width=breadth*np.maximum(0,1-dy*dy)
        edge=(width-abs(dx))/breadth+.10*fine
        inside=(abs(dy)<1)&(abs(dx)<breadth*1.3)
        fibres=wave(x*390+.13*damp)
        h.mark(inside & (edge>.04)&(fibres>-.68),1,(162,131,92),grain+12*fibres)
        h.mark(inside & (edge>.23)&(dx>0),2,(211,181,123),grain+11*fibres)
        h.mark(inside & (edge>.41)&(dx<=0),2,(87,64,39),grain+12*fibres)
        h.mark(inside & (edge>.67)&(abs(dy)<.62),3,(54,43,30),grain)
    tip=.122+.038*wave(board*.283)
    fire=np.abs(wrap(x-.78))/.037 + np.abs(wrap(y-.78-.027*wave(board*.21)))/tip
    fire+=.13*damp+.075*fine+.12*wave(board*.36)+.055*grain/8
    h.mark((fire<1.20)&(fire>.65)&(grain<2),2,(118,81,47),grain*1.3)
    h.mark(fire<.88,3,(59+39*fire,46+28*fire,34+17*fire),grain*1.5+5*fine)
    h.mark((fire<.65)&(caulk>.32),3,(35,32,27),grain)
    seam=caulk+lip*.7
    pepper=fine+.44*damp
    d.mark((seam>.28)&(cloud+.38*damp>.30),1,(98,103,73),grain+8*fine)
    d.mark((grain<-3.2)&(cloud>.68),1,(157,149,121),grain*.43+tone*.3)
    bleach=cloud*.76+damp*.30+tone*.040+.075*grain
    d.mark((bleach>.39)&(seam<.4),2,(169,159,133),grain*.74+tone*.30)
    d.mark((seam>.24)&(damp>.2)&(pepper>.14),2,(65,69,50),grain+fine*5)
    d.mark((bleach>.81)&(seam<.5),3,(176,174,157),grain*.95+tone*.28)
    d.mark((seam>.32)&(cloud>.39)&(damp>-.47),3,(47,46,37),fine*5)
    missing=(caulk>.61)&(cloud>.92)&(damp>.25)
    d.mark(missing,3,(29,30,25),3*fine)
    d.mark((lip>.28)&(cloud>.92)&(damp>.25),3,(130,124,99),grain+5*fine)
    d.mark((grain<-.9)&(bleach>.36)&(pepper>1.45),3,(84,87,67),grain)
    d.rgba[h.rgba[...,3]>0]=0
    for role,layer in [("hurt",h),("decay",d)]:
        store(HERE/"tex","teak",role,layer.rgba)


def has_teak_wear(folder):
    for role in ("hurt", "decay"):
        path = folder / f"teak_{role}.png"
        if not path.exists():
            return False
        with Image.open(path) as image:
            if "A" not in image.getbands() or image.getchannel("A").getbbox() is None:
                return False
    return True


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("boat",choices=tuple(OWN))
    boat=parser.parse_args().boat
    anchors=fitting_rows(boat)
    for material in OWN[boat]:
        own_layers(boat,material,anchors)
    if boat=="lagoon" or not has_teak_wear(HERE/"tex"):
        teak_layers()
