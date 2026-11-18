"""Four original motor yachts. Construction coordinates are metres in the game's +Z bow, +Y up frame."""
from pathlib import Path
from types import SimpleNamespace
import json
import math
import sys

import bmesh
import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "compact"))
sys.path.insert(0, str(HERE.parent / "marine"))
from parts import E2B, Part, cylinder, rbox, tags_of
from layout import check, lay_out, mark, on_first_sheet, sheets_of
from palette import HULL, OWN, SCREENS, own


def mix(a, b, t):
    return a + (b - a) * t


def curve(stations, z):
    for (a, x), (b, y) in zip(stations, stations[1:]):
        if z <= b:
            return mix(x, y, min(1, max(0, (z-a)/(b-a))))
    return stations[-1][1]


def run(a, b, n):
    return [mix(a,b,k/n) for k in range(n+1)]


class Yacht:
    def __init__(self, name):
        self.name = name
        self.d = d = SimpleNamespace(**json.loads((HERE.parents[4]/"content/vehicles/yacht-lines.json").read_text())[name])
        self.h, self.w = d.length/2, d.beam/2
        self.bone = "chassis"
        self.parts = []
        x,y,z = d.seats[0]
        self.joints = {"chassis":(0,0,0), "steering":(x,y+.36,z+.30),
                       "propeller":(d.portShaft,d.propY,d.propZ),
                       "propeller_starboard":(-d.portShaft,d.propY,d.propZ)}
        self.widths = [(-1,.65),(-.98,.76),(-.92,.84),(-.75,.91),(-.54,.966),(-.23,.997),
                       (0,1),(.19,.988),(.38,.938),(.56,.837),(.72,.665),(.85,.445),(.95,.214),(1,.012)]
        if name == "solstice":
            self.widths = [(-1,.68),(-.96,.84),(-.83,.91),(-.51,.976),(-.19,1),(.22,.989),(.47,.914),
                           (.66,.780),(.82,.58),(.94,.278),(1,.016)]
        if name == "sovereign":
            self.widths = [(-1,.73),(-.97,.835),(-.88,.91),(-.68,.966),(-.34,.995),(.17,1),
                           (.38,.966),(.58,.853),(.71,.72),(.83,.54),(.92,.34),(.975,.14),(1,.013)]

    def add(self, o):
        self.parts.append((self.bone,o))
        return o

    def loft(self, name, rings, tag, ends=None):
        p = Part()
        p.loft(rings, tag, caps=ends or (tag,tag))
        return self.add(p.obj(name))

    def rod(self, name, a, b, r, tag="stainless", sides=8, end=None):
        return self.add(cylinder(name,a,b,r,tag,sides,end))

    def rail(self, name, path, r=.026, tag="stainless", n=8):
        # A single bent tube carries the continuous highlight around each change of direction.
        rings = []
        for i,q in enumerate(path):
            tangent = Vector(path[min(i+1,len(path)-1)])-Vector(path[max(0,i-1)])
            tangent.normalize()
            ref = Vector((0,1,0)) if abs(tangent.y)<.94 else Vector((0,0,1))
            across = tangent.cross(ref).normalized()
            normal = tangent.cross(across).normalized()
            rings.append([tuple(Vector(q) + r*(across*math.cos(k*math.tau/n) + normal*math.sin(k*math.tau/n))) for k in range(n)])
        return self.loft(name,rings,tag)

    def box(self,name,x,y,z,width,height,length,tag,r=.025,n=2):
        return self.add(rbox(name,(x-width/2,y-height/2,z-length/2),
                             (x+width/2,y+height/2,z+length/2),r,tag,n))

    def fair(self,name,stations,tag="pearl",top=None):
        """Cambered horizontal coaming, roof or furniture slab, on longitudinal lines."""
        rings = []
        for z,w,b,t in stations:
            thick = t-b
            rings.append([(-w*.93,b,z),(-w,b+thick*.21,z),(-w,b+thick*.62,z),(-w*.985,t-thick*.15,z),
                          (-w*.91,t,z),(0,t+min(.035,thick*.14),z),(w*.91,t,z),(w*.985,t-thick*.15,z),
                          (w,b+thick*.62,z),(w,b+thick*.21,z),(w*.93,b,z)])
        return self.loft(name,rings,lambda i,k: top if top and k in (4,5) else tag,(tag,tag))

    def width(self,z):
        return self.w*curve(self.widths,z/self.h)

    def deck(self,z):
        d = self.d
        if z < d.stepTop:
            return curve([(d.stepTop-.13,d.terrace),(d.stepTop,d.main)],z)
        return d.main + d.sheer*max(0,(z/self.h-.24)/.76)**1.55

    def outer_deck(self,z):
        d=self.d
        if d.stepBottom < z < d.stepTop:
            t=(z-d.stepBottom)/(d.stepTop-d.stepBottom)
            return mix(d.terrace,d.main,t*t*(3-2*t))
        return self.deck(z)

    def coaming(self,z):
        d=self.d
        t=z/self.h
        start=d.stepBottom-.12
        level = d.main if z<d.stepTop else self.deck(z)
        ramp = max(0,min(1,(z-start)/(d.stepTop-start)))
        return max(self.outer_deck(z)+.065,
                   mix(d.terrace+.09,level+.32+self.w*.05,ramp) + (.12*math.cos(t*math.pi) if t>-.5 else 0))

    def section(self,z):
        d = self.d
        t = z/self.h
        w,top = self.width(z),self.outer_deck(z)
        keel = d.draft*curve([(-1,.90),(-.93,.76),(-.79,.50),(-.52,.09),(-.14,0),(.18,.018),(.55,.19),(.82,.64),(1,1.62)],t)
        end = max(0,(t-.42)/.58)
        # The stem rakes back underwater. Its deep V fans into flatter aft bearing surfaces.
        raked = self.h*.105*end**2 if self.name != "solstice" else self.h*.068*end**2
        side = [(0,keel,z-raked),(.43*w,keel+(top-keel)*.105,z-.96*raked),
                (.81*w,keel+(top-keel)*.23,z-.85*raked),(.845*w,keel+(top-keel)*.25,z-.8*raked),
                (.875*w,keel+(top-keel)*.26,z-.77*raked),(.946*w,keel+(top-keel)*.50,z-.50*raked),
                (.953*w,keel+(top-keel)*.54,z-.46*raked),(.958*w,keel+(top-keel)*.559,z-.43*raked),
                (w,top-.092,z-.06*raked),(.998*w,top-.044,z-.018*raked),(.975*w,top,z),(.932*w,self.deck(z)+.009,z)]
        ring = side+[(-x,y,z1) for x,y,z1 in reversed(side[1:])]
        return ring

    def hull(self):
        d = self.d
        zs = sorted(set([self.h*t for t,w in self.widths]+run(-self.h,self.h,50)+
                        [d.stepTop-.13,d.stepTop-.07,d.stepTop]))
        tag = ["keel","keel","boot","keel","keel","strake","boot","topsides","graphite","pearl","pearl"]
        self.loft("chine-built hull and laid deck",[self.section(z) for z in zs],
                  lambda i,k: "teak" if k==11 else tag[k if k<11 else 22-k],("topsides","pearl"))
        # Recessed side windows on the flare, outlined in dark elastomer with metallic mullions.
        windows = {
            "solstice":[(-.31,-.02),(.10,.41)],
            "meridian":[(-.54,-.22),(-.19,.14),(.17,.49)],
            "belvedere":[(-.60,-.31),(-.295,.03),(.045,.33),(.345,.565)],
            "sovereign":[(-.58,-.37),(-.35,-.12),(-.10,.13),(.15,.35),(.37,.55)]}
        for s in (-1,1):
            for j,(a,b) in enumerate(windows[self.name]):
                rings = []
                for i,f in enumerate([0,.036,.12,.32,.55,.76,.90,.97,1]):
                    z = mix(a,b,f)*self.h
                    w,top = self.width(z),self.deck(z)
                    bottom = self.section(z)[0][1]
                    # Keep the window bed just clear of the continuously flaring hull.
                    low = mix(bottom,top,.62) + (.10 if self.name == "solstice" else .04)
                    hi = top - {"solstice":.18,"meridian":.22,"belvedere":.32,"sovereign":.46}[self.name]
                    tip = min(1,.20+f*6,.20+(1-f)*6)
                    if self.name=="sovereign": tip = min(1,.72+f*5,.71+(1-f)*5)
                    if self.name=="meridian": tip = min(1,.62+f*6,.08+(1-f)*4.5)
                    mid = mix(low,hi,.56)
                    y0,y1 = mix(mid,low,tip),mix(mid,hi,tip)
                    outer = lambda y: s*(w*mix(.958,1,max(0,(y-mix(bottom,top,.559))/(top-.092-mix(bottom,top,.559))))+.018)
                    rings.append([(outer(y0)-s*.023,y0,z),(outer(y0),y0,z),(outer(y0+.018),y0+.018,z),
                                  (outer(y1-.019),y1-.019,z),(outer(y1),y1,z),(outer(y1)-s*.023,y1,z)])
                self.loft("flush cabin light",rings,lambda i,k: "glass" if k==2 and i not in (0,7) else "gasket",("gasket","gasket"))
        # The cockpit coamings sweep down into the swim terrace; a teak cap on each provides a handhold.
        for s in (-1,1):
            rings = []
            start = d.stepBottom-.12
            for z in run(start, self.h*.985,40):
                t = z/self.h
                w,base = self.width(z)*.966,self.outer_deck(z)-.035
                crest = self.coaming(z)
                thick = min(.12+self.w*.017,w*.36)
                rings.append([(s*(w-thick),base,z),(s*w,base,z),(s*(w+.009),crest-.045,z),
                              (s*(w-.014),crest,z),(s*(w-thick+.017),crest,z),(s*(w-thick),crest-.034,z)])
            self.loft("folded sheer coaming",rings,lambda i,k: "teak" if k==3 else "pearl",("pearl","pearl"))
        self.fore_rails()
        self.stern()
        self.drives()

    def fore_rails(self):
        d=self.d
        start=d.railStart
        for s in (-1,1):
            def foot(z): return (s*(self.width(z)*.965-.067),self.coaming(z),z)
            zs = run(start,self.h*.966,max(4,round((self.h*.966-start)/1.0)))
            for i,z in enumerate(zs):
                x,y,_=foot(z)
                self.rod("rail socket",(x,y-.07,z),(x,y+.032,z),.043,"stainless",8)
                self.rod("raked pulpit stanchion",(x,y,z),(x-s*.021,y+.48,z+.034),.017)
            railz = run(start-.05,self.h*.982,len(zs)*2)
            for rise,rad in ((.47,.021),(.25,.011)):
                self.rail("pulpit lifeline",[(foot(z)[0]-s*.019,foot(z)[1]+rise,z+.03) for z in railz],rad)
            for f in (-.62,.02,.57,.84):
                z=self.h*f; x=s*(self.width(z)*.94-.085)
                y=self.coaming(z)
                for dz in (-.075,.075):
                    self.rod("cleat post",(x,y-.05,z+dz),(x,y+.055,z+dz),.027,"stainless",8)
                self.rod("horn cleat",(x,y+.055,z-.19),(x,y+.055,z+.19),.029,"stainless",10)
            z=self.h*.42; x=s*self.width(z)*.95
            y=self.deck(z)+.34
            self.box("sidelight",x,y,z,.105,.085,.21,"red" if s>0 else "green",.036,3)

    def stern(self):
        d=self.d
        count=max(2,math.ceil((d.main-d.terrace)/.20))
        tread=(d.stepTop-d.stepBottom)/count
        width=min(.95,d.beam*.205)
        for s in (-1,1):
            x=s*d.stepX
            for k in range(count):
                z=d.stepBottom+tread*(k+.5)
                top=mix(d.terrace,d.main,(k+1)/count)
                self.box("moulded transom riser",x,(d.terrace+top)/2-.014,z,width,top-d.terrace+.036,tread+.025,"pearl",.026)
                self.box("teak step with nosing",x,top+.008,z-.016,width-.045,.029,tread-.027,"teak",.012)
            # Stairs have a centre-side handrail, leaving the outboard landing free.
            x-=s*(width/2+.04)
            for z,y in [(d.stepBottom+.05,d.terrace),(d.stepTop+.02,d.main)]:
                self.rod("transom rail foot",(x,y+.012,z),(x,y+.41,z),.022)
            self.rail("transom handhold",[(x,d.terrace+.40,d.stepBottom+.05),(x,d.main+.41,d.stepTop+.02)],.026)
        x=d.ladderX
        for xx in (x-.205,x+.205):
            self.rail("swim ladder",[(xx,d.draft-.38,-self.h+.028),(xx,d.terrace+.19,-self.h+.028),
                                     (xx,d.terrace+.245,-self.h+.05),(xx,d.terrace+.245,-self.h+.26),(xx,d.terrace+.015,-self.h+.32)],.023)
        for y in run(d.draft-.32,d.terrace-.035,4):
            self.rod("swim ladder rung",(x-.201,y,-self.h+.028),(x+.201,y,-self.h+.028),.021,"stainless",8)
        # Build the central transom forward of the swim platform. Nameplate faces aft.
        z=d.stepTop-.39
        width=max(.70, d.stepX*2-width-.28)
        self.box("transom locker",0,(d.terrace+d.main+.18)/2,z,width,d.main+.18-d.terrace,.86,"pearl",.14,4)
        self.box("recessed transom lettering",0,(d.terrace+d.main+.17)/2,z-.437,min(1.65,width*.84),.21,.022,self.name,.009,1)
        self.box("transom coping",0,d.main+.185,z,width-.14,.045,.68,"teak",.02)
        if self.name in ("belvedere","sovereign"):
            for s in (-1,1):
                self.box("beach club seat base",s*width*.25,d.terrace+.20,d.stepBottom+.28,width*.43,.40,.79,"graphite",.08,3)
                self.cushion(s*width*.25,d.terrace+.43,d.stepBottom+.28,width*.44,.79,.16,"linen")

    def drives(self):
        d=self.d
        r = min(d.propY-.045,d.beam*.073)
        for s in (-1,1):
            x,y,z=s*d.portShaft,d.propY,d.propZ
            self.rod("shaft log",(x,y,z+.07),(x,y+.22,z+1.38),r*.16,"bronze",10)
            self.rod("shaft strut",(x,y+.08,z+.34),(x*1.17,y+.40,z+.57),r*.13,"bronze",8)
            self.bone = "propeller" if s==1 else "propeller_starboard"
            self.rod("propeller boss",(x,y,z-r*.36),(x,y,z+r*.36),r*.21,"bronze",12)
            for k in range(4):
                a=k*math.pi/2
                rings=[]
                for rr,b,twist in ((.16,.13,0),(.46,.29,.08),(.76,.31,.21),(.96,.19,.36),(1,.032,.44)):
                    ang = a+s*twist
                    rings.append([(x+r*(rr*math.cos(ang)-side*b*math.sin(ang)),y+r*(rr*math.sin(ang)+side*b*math.cos(ang)),
                                   z+r*(side*.107+thick)) for side,thick in ((-1,-.036),(1,-.036),(1,.036),(-1,.036))])
                self.loft("cast swept blade",rings,"bronze")
            self.bone="chassis"

    def cushion(self,x,y,z,w,l,h=.17,tag="upholstery"):
        self.box("upholstery welt",x,y-.018,z,w+.008,h*.49,l+.008,"piping",.048,3)
        self.box("crowned cushion",x,y+.014,z,w,h,l,tag,min(.11,h*.45),4)

    def chair(self,x,y,z):
        # Pelvis y is on top of the loaded seat. Leave the boot and shoulder envelope free.
        self.rod("pedestal",(x,y-.54,z-.07),(x,y-.17,z-.07),.083,"stainless",12,.108)
        self.box("seat carriage",x,y-.17,z-.05,.48,.091,.46,"graphite",.035)
        self.cushion(x,y-.079,z-.10,.635,.62,.157)
        self.box("upholstered seatback",x,y+.175,z-.406,.622,.51,.152,"upholstery",.073,4)
        self.box("head roll",x,y+.432,z-.443,.45,.14,.13,"linen",.063,4)
        for s in (-1,1):
            self.box("armrest",x+s*.339,y+.131,z-.121,.073,.074,.38,"leather",.034,3)

    def helm(self):
        x,y,z=self.d.seats[0]
        floor=y-.55
        dx=max(1.45,x*2+.59)
        # Wheel attaches to a forward centre console with its lowest edge beyond the pilot's knees.
        self.box("console plinth",0,floor+.37,z+1.18,dx*.78,.76,.44,"pearl",.10,3)
        rings=[]
        for f,taper in [(-.50,.71),(-.47,.92),(-.38,.99),(0,1),(.38,.99),(.47,.92),(.50,.71)]:
            cx=f*dx
            rings.append([(cx,y+.11,z+.70),(cx,y+.18,z+.66),(cx,y+.53*taper,z+.76),
                          (cx,y+.59*taper,z+.84),(cx,y+.57*taper,z+1.19),(cx,y+.13,z+1.24)])
        self.loft("swept helm fascia",rings,"leather")
        for cx,tag in ((x-.248,"chart"),(x+.135,"instruments")):
            # The two displays face the seated eye and share the rake of the instrument hood.
            def display(w,h,zz,tag):
                c=y+.45
                ring=[(cx-w/2,c-h/2,zz-.027),(cx+w/2,c-h/2,zz-.027),
                      (cx+w/2,c+h/2,zz+.027),(cx-w/2,c+h/2,zz+.027)]
                self.loft("instrument display",[ring,[(xx,yy,z1+.028) for xx,yy,z1 in ring]],"gasket",(tag,"gasket"))
            display(.354,.227,z+.733,"graphite")
            display(.327,.200,z+.719,tag)
        self.box("switch panel",x-.46,y+.236,z+.679,.24,.104,.021,"keyboard",.006,1)
        wx,wy,wz=self.joints["steering"]
        self.rod("helm column",(wx,wy,wz+.037),(wx,wy,wz+.445),.055,"graphite",12,.080)
        self.bone="steering"
        p=Part(); n,m=32,8
        rings=[]
        for k in range(n):
            a=k*math.tau/n
            rings.append([p.v((wx+(.18+.020*math.cos(j*math.tau/m))*math.cos(a),
                               wy+(.18+.020*math.cos(j*math.tau/m))*math.sin(a),wz+.020*math.sin(j*math.tau/m))) for j in range(m)])
        for i in range(n):
            for j in range(m):
                p.face((rings[i][j],rings[(i+1)%n][j],rings[(i+1)%n][(j+1)%m],rings[i][(j+1)%m]),"leather")
        self.add(p.obj("stitched helm rim"))
        for ang in (math.pi*.12,math.pi*.88,-math.pi*.5):
            self.rod("helm spoke",(wx,wy,wz+.012),(wx+.177*math.cos(ang),wy+.177*math.sin(ang),wz),.014,"stainless",8)
        self.rod("wheel boss",(wx,wy,wz-.027),(wx,wy,wz+.042),.055,"bronze",14)
        self.bone="chassis"
        for k in (0,1):
            xx=x+.31+k*.068
            self.rod("twin throttle",(xx,y+.20,z+.57),(xx,y+.32,z+.50),.015,"stainless",8)
            self.rod("throttle grip",(xx-.027,y+.32,z+.50),(xx+.027,y+.32,z+.50),.026,"leather",8)
        for seat in self.d.seats:
            self.chair(*seat)

    def glazing(self, name, a, b, c, e, inset, tag="glass"):
        """Outward side of a sealed pane; its inner UV swatch cuts the face out."""
        ring=[a,b,c,e]
        inner=[tuple(v[i]+inset[i] for i in range(3)) for v in ring]
        self.loft(name,[ring,inner],"gasket",(tag,"clear"))

    def glasshouse(self, aft, fore, base, roof, width, rake, kind):
        length=fore-aft
        def side(s,u,t):
            # Tumblehome, front facet, and convex side walls carried on separate mouldings.
            taper=curve([(0,.90),(.08,.967),(.33,1),(.70,.995),(.86,.957),(1,.828)],u)
            return (s*width*taper*mix(1,.928,t),mix(base,roof,t),mix(aft,fore,u)-rake*t*u**3+length*.041*t*(1-u)**3)
        for s in (-1,1):
            for a,b in zip((0,.08,.32,.55,.77,.91),(.08,.32,.55,.77,.91,1)):
                low,hi = (.235,.945) if kind!="coupe" else (.22,.91)
                for ta,tb,tag in ((0,low,"pearl"),(low,hi,"glass"),(hi,1,"pearl")):
                    surface=[side(s,a,ta),side(s,b,ta),side(s,b,tb),side(s,a,tb)]
                    self.glazing("saloon glazing" if tag=="glass" else "moulded saloon frame",*surface,(-s*.040,0,0),tag)
                if a:
                    self.rail("black glass mullion",[side(s,a,low),side(s,a,hi)],.024,"graphite")
            self.rail("glazing brow",[side(s,u,.937) for u in run(0,1,14)],.023,"gasket")
        # Curved forward windscreen in three bays; the pilot's broad eye aperture stays open even in the flat tier.
        lo,hi=.24,.94
        span=width*.828
        def face(u,t):
            return (u*span*mix(1,.928,t),mix(base,roof,t),
                    fore-rake*t+.21*(1-u*u))
        for a,b in [(-1,-.72),(-.72,-.36),(-.36,0),(0,.36),(.36,.72),(.72,1)]:
            for t0,t1,tag in [(0,lo,"pearl"),(lo,.35,"glass"),(.84,hi,"glass"),(hi,1,"pearl")]:
                self.glazing("windscreen brow and sill",face(a,t0),face(b,t0),face(b,t1),face(a,t1),(0,0,-.032),tag)
            if kind=="saloon" or abs((a+b)/2)>.79:
                self.glazing("curved windscreen",face(a,.35),face(b,.35),face(b,.84),face(a,.84),(0,0,-.032))
        for u in (-1,0,1):
            self.rail("windscreen post",[face(u,lo),face(u,hi)],.030,"graphite")
        # Aft sliding doors stand apart and leave a passage onto the cockpit.
        for s in (-1,1):
            a=(s*width*.85,base+.03,aft+.033); b=(s*width*.24,base+.03,aft+.033)
            c=(s*width*.24,roof-.025,aft+length*.041); e=(s*width*.81,roof-.025,aft+length*.041)
            self.glazing("sliding glass door",a,b,c,e,(0,0,.042))
            self.rail("door stile",[b,c],.025,"stainless")
            self.rod("door pull",(b[0]+s*.085,base+.77,aft+.024),(b[0]+s*.085,base+1.10,aft+.024),.015)

    def roof(self, aft, fore, y, width, thick, crown="pearl", top=None):
        length=fore-aft
        lines=[(0,.71,-.38),(.025,.90,-.19),(.083,.985,-.06),(.24,1,.015),(.48,.994,.08),
               (.71,.969,.055),(.86,.928,-.03),(.95,.845,-.15),(.992,.69,-.32),(1,.60,-.38)]
        stations=[(aft+v*length,width*w,y+cy*thick-thick,y+cy*thick) for v,w,cy in lines]
        self.fair("cambered coachroof",stations,crown,top)
        for s in (-1,1):
            self.rail("shadow gap below eave",[(s*w*.994,t-thick*.53,z) for z,w,b,t in stations],.019,"graphite",8)

    def bridge_coaming(self,aft,fore,y,w):
        for s in (-1,1):
            rings=[]
            for f,taper,lo,hi in [(0,.95,.017,.12),(.08,.994,.01,.29),(.28,1,.01,.37),
                                   (.61,.99,.01,.44),(.84,.947,.02,.49),(1,.84,.038,.61)]:
                z=mix(aft,fore,f)
                x=s*w*taper
                rings.append([(x-s*.095,y+lo,z),(x,y+lo,z),(x+s*.01,y+hi-.045,z),
                              (x-s*.014,y+hi,z),(x-s*.094,y+hi-.012,z)])
            self.loft("upper bridge coaming",rings,lambda i,k:"teak" if k==3 else "pearl",("pearl","pearl"))
        self.box("swept forward bridge brow",0,y+.28,fore-.04,w*1.68,.50,.21,"pearl",.097,4)

    def upper_guard(self,z0,z1,y,w,back=True):
        for s in (-1,1):
            zs=run(z0,z1,max(2,round((z1-z0)/1.5)))
            for z in zs:
                self.rod("deck rail stanchion",(s*w,y-.016,z),(s*(w+.012),y+.63,z+.018),.020)
            for h,r in ((.63,.024),(.36,.013)):
                self.rail("upper deck guard",[(s*w,y+h,z) for z in zs],r)
        if back:
            for u in (-.5,0,.5):
                self.rod("stern rail stanchion",(u*w,y-.024,z0),(u*w,y+.626,z0),.020)
            for h,r in ((.63,.024),(.36,.013)):
                self.rod("stern rail",(-w,y+h,z0),(w,y+h,z0),r)

    def arch(self, z, base, roof, w, swept, style):
        for s in (-1,1):
            rings=[]
            for t,scale in [(0,1),(.08,.97),(.40,.77),(.76,.63),(1,.58)]:
                x=s*w*mix(1,.87,t); y=mix(base,roof,t); zz=z+swept*t
                chord=style*scale
                rings.append([(x-s*.066,y,zz-chord*.56),(x+s*.045,y,zz-chord*.38),
                              (x+s*.053,y,zz+chord*.40),(x-s*.067,y,zz+chord*.52)])
            self.loft("swept hardtop pier",rings,"pearl")
            self.rail("pier polished insert",[(s*(w*mix(1,.87,t)+.057),mix(base,roof,t),z+swept*t+style*.02) for t in (.08,.4,.76,.94)],.017,"stainless")

    def sunbed(self,x,y,z,w,l,tag="linen"):
        self.box("sunbed base",x,y+.060,z,w+.065,.14,l+.095,"pearl",.06,3)
        self.cushion(x,y+.182,z-.02,w,l,.205,tag)
        self.cushion(x,y+.292,z-.31*l,w*.935,l*.25,.15,"upholstery")

    def settee(self,x,y,z,w,l,side):
        # A settee runs along a side deck, with stitched individual squabs and an outboard back.
        self.box("settee plinth",x,y+.22,z,w-.06,.40,l-.025,"pearl",.09,3)
        cushions=max(2,round(l/.72))
        for k in range(cushions):
            pos=z+l*((k+.5)/cushions-.5)
            self.cushion(x,y+.46,pos,w,l/cushions-.022,.17,"linen")
        self.box("settee bolster",x+side*(w*.5-.048),y+.67,z,.17,.42,l-.045,"upholstery",.078,3)
        self.box("rolled throw",x+side*w*.18,y+.58,z+l*.29,.34,.123,.42,"slate",.056,3)

    def table(self,x,y,z,w,l):
        self.rod("table pedestal",(x,y,z),(x,y+.55,z),.064,"stainless",10)
        self.box("cockpit table",x,y+.575,z,w,.065,l,"walnut",.031,4)
        self.box("table inlay",x,y+.611,z,w*.82,.012,l*.79,"teak",.005,1)

    def access_steps(self,x,z,base,roof,w,n):
        # Open-tread flybridge companionway. Its open sides let the transom and main cockpit read through.
        runout=(roof-base)*.87
        for k in range(n):
            t=(k+1)/n
            y=mix(base,roof,t); zz=z+t*runout
            self.box("floating stair tread",x,y-.041,zz,w,.083,runout/n+.045,"teak",.021,2)
        for s in (-1,1):
            xx=x+s*w*.46
            self.rail("companionway stringer",[(xx,base-.015,z),(xx,roof-.077,z+runout+.05)],.037,"stainless")
            for t in (.15,.89):
                zz=z+t*runout; y=mix(base,roof,t)
                self.rod("companionway newel",(xx,y,zz),(xx,y+.64,zz),.018)
            self.rail("companionway handrail",[(xx,base+.64,z),(xx,roof+.64,z+runout+.03)],.023)

    def radome(self,x,b,z,r):
        rings=[]
        for t,fac in ((0,.72),(.05,.90),(.18,.99),(.47,1),(.67,.93),(.83,.74),(.95,.40),(1,.07)):
            rings.append([(x+r*fac*math.cos(a*math.tau/18),b+t*r*1.75,z+r*fac*math.sin(a*math.tau/18)) for a in range(18)])
        self.loft("satellite dome",rings,lambda i,k:"graphite" if i==0 else "pearl",("graphite","pearl"))

    def ground_tackle(self):
        h=self.h
        z=h*.884; y=self.deck(z)
        self.box("forepeak chain well",0,y+.07,z,self.width(z)*1.29,.09,h*.082,"cream",.043,3)
        self.rod("windlass drum",(0,y+.05,z),(0,y+.185,z),.096,"stainless",14)
        self.rod("anchor shank",(0,y+.09,z+.10),(0,self.deck(h*.969)+.09,h*.969),.029,"stainless",8)

    def solstice(self):
        # Day boat with a floating graphite T-top and an open-sided walkaround helm.
        d=self.d; y=d.main
        self.roof(-1.54,1.95,3.61,1.32,.15,"graphite","cream")
        self.arch(-.97,y,3.50,1.05,.48,.37)
        for s in (-1,1):
            self.rail("bent tubular front T-top leg",[(s*1.06,y+.22,1.55),(s*1.02,y+1.02,1.48),(s*.95,3.49,1.0)],.039,"graphite",10)
        # Low clear centre and no full-width windscreen cap across eye height.
        for s in (-1,1):
            a=(s*1.08,y+.64,1.78); b=(s*.79,y+.64,1.90)
            c=(s*.72,y+1.32,1.60); e=(s*1.00,y+1.22,1.47)
            self.glazing("helm side deflector",a,b,c,e,(0,0,-.026))
            self.rail("wind deflector rim",[e,c],.023)
        self.table(0,y,-.59,.72,.55)
        for s in (-1,1):
            self.sunbed(s*.55,self.deck(3.27)+.05,3.23,.98,1.74)
        self.box("aft lounger locker",0,y+.19,-2.53,1.94,.38,.91,"pearl",.12,4)
        self.cushion(0,y+.44,-2.54,1.92,.94,.20)
        self.box("stern backrest",0,y+.61,-2.94,1.83,.31,.15,"linen",.065,4)

    def meridian(self):
        # Knife-edged glass coupe. Swept side wings continue much farther aft than the salon roof.
        d=self.d; y=d.main
        self.glasshouse(-2.60,3.88,y,3.88,1.76,1.21,"coupe")
        self.roof(-3.62,3.25,4.04,1.99,.245)
        # Two flush sheets framed in satin stainless follow the low, swept crown.
        for aft,fore in [(-2.58,-.35),(-.27,1.77)]:
            self.fair("flush panoramic roof light",[(aft,1.18,4.053,4.08),(aft+.09,1.29,4.059,4.10),
                      (fore-.13,1.24,4.052,4.095),(fore,1.09,4.048,4.073)],"gasket","glass")
        for s in (-1,1):
            self.rail("roof grab",[(s*1.54,4.027,-1.74),(s*1.54,4.091,-1.60),(s*1.49,4.115,.79),(s*1.47,4.038,.92)],.019)
        self.rod("low-profile GPS antenna",(-.87,4.07,-2.8),(-.87,4.18,-2.8),.105,"cream",16,.071)
        for s in (-1,1):
            rings=[]
            for z,lo,hi,w in ((-5.44,y+.05,y+.27,1.67),(-4.96,y+.11,y+.51,1.82),(-3.87,y+.25,y+1.02,1.89),
                               (-2.95,y+.43,y+1.92,1.86),(-2.6,y+.75,3.85,1.77)):
                rings.append([(s*(w-.13),lo,z),(s*w,lo+.034,z),(s*(w+.018),hi-.045,z),(s*(w-.018),hi,z),(s*(w-.128),hi-.027,z)])
            self.loft("cockpit buttress",rings,"pearl")
            for k in range(4):
                z=-3.60+k*.145
                self.box("wing cooling slot",s*1.879,y+.77+(k%2)*.017,z,.036,.22,.055,"grille",.016)
        self.table(0,y,-3.48,.88,.70)
        for s in (-1,1):
            self.sunbed(s*.58,self.deck(5.48)+.10,5.48,1.05,1.93)
        self.box("flush forehatch",0,self.deck(6.89)+.063,6.89,.71,.080,.63,"glass",.031,3)
        self.box("saloon settee",-.95,y+.31,-.68,.63,.55,1.60,"linen",.15,4)

    def belvedere(self):
        y=self.d.main; f=5.02
        self.glasshouse(-4.59,4.90,y,4.79,2.18,1.06,"saloon")
        self.roof(-6.94,4.24,f-.028,2.43,.27,"pearl","teak")
        self.arch(-6.35,y,f-.12,2.26,1.30,.38)
        self.settee(-1.49,y,-1.71,.70,2.37,-1)
        self.upper_guard(-6.32,-2.68,f,2.10)
        self.bridge_coaming(-3.97,3.61,f,2.02)
        self.access_steps(1.72,-7.13,y,f,.64,10)
        self.arch(-2.54,f,7.18,1.80,.72,.72)
        self.arch(2.68,f,7.19,1.69,-.46,.24)
        self.roof(-4.11,3.12,7.35,2.16,.21,"pearl","graphite")
        for s in (-1,1):
            self.glazing("flybridge wraparound deflector",(s*1.91,f+.28,2.17),(s*.82,f+.31,3.89),
                         (s*.81,f+1.02,3.59),(s*1.79,f+.86,2.13),(0,0,-.031))
        self.table(0,f,-.55,.88,.74)
        for s in (-1,1):
            self.sunbed(s*.79,self.deck(6.87)+.12,6.87,1.37,2.16)
            self.sunbed(s*.71,f+.045,-4.92,1.02,1.72)
        self.box("radar plinth",0,7.46,-1.69,.96,.23,.38,"pearl",.09,3)
        self.box("open array scanner",0,7.65,-1.69,1.89,.12,.20,"cream",.048,3)
        self.radome(-.91,7.29,-2.53,.32)
        self.rod("VHF whip",(.96,7.34,-2.47),(.96,8.14,-2.48),.017,"stainless",8,.013)
        self.table(0,y,-5.22,1.1,.74)

    def sovereign(self):
        # Beach-club displacement hull, two enclosed decks, open fore lounge, sun deck and raised communications mast.
        y=self.d.main; upper=5.64; sun=8.02
        self.glasshouse(-7.21,6.91,y,5.40,3.03,.78,"saloon")
        self.roof(-10.23,6.71,upper-.03,3.28,.34,"pearl","teak")
        self.arch(-9.25,y,upper-.14,3.03,1.44,.54)
        self.settee(-2.33,y,-3.88,.77,3.02,-1)
        self.settee(2.33,y,-3.88,.77,3.02,1)
        self.glasshouse(-4.60,5.91,upper,7.83,2.61,.99,"bridge")
        self.roof(-7.73,5.31,sun-.02,2.91,.30,"pearl","teak")
        self.upper_guard(-9.48,-4.89,upper,2.85)
        self.settee(1.93,upper,-7.66,.70,1.85,1)
        self.settee(-1.71,upper,-8.32,.70,1.21,-1)
        # Low teak cocktail tables stay inside the upper stern's rails.
        self.table(1.04,upper,-7.72,.65,.75)
        self.upper_guard(-7.17,-2.03,sun,2.42)
        self.bridge_coaming(-2.74,3.94,sun,2.26)
        for s in (-1,1):
            a=(s*2.10,sun+.42,2.54); b=(s*.93,sun+.46,4.16)
            c=(s*.90,sun+1.10,3.91); e=(s*2.04,sun+.98,2.41)
            self.glazing("sun deck windbreak",a,b,c,e,(0,0,-.035))
        self.access_steps(2.43,-10.43,y,upper,.69,12)
        self.access_steps(-2.12,-7.64,upper,sun,.62,11)
        self.arch(-1.37,sun,10.11,2.05,.79,.73)
        self.arch(2.64,sun,10.11,1.87,-.52,.32)
        self.roof(-3.52,3.44,10.33,2.40,.24,"pearl","graphite")
        for s in (-1,1):
            self.radome(s*.89,10.28,-.64,.415)
            self.sunbed(s*.78,sun+.04,-5.14,1.08,2.11)
            self.sunbed(s*1.04,self.deck(9.50)+.15,9.5,1.75,2.33)
        self.box("communications pedestal",0,10.54,.83,.57,.37,.68,"graphite",.09,3)
        self.rod("communications tower",(0,10.67,.82),(0,11.34,.57),.105,"pearl",12,.06)
        self.box("navigation radar",0,11.12,.63,2.32,.152,.21,"cream",.065,3)
        self.rod("masthead light",(0,11.34,.57),(0,11.54,.57),.037,"white",8)
        self.table(0,upper,-4.96,1.11,.75)
        self.table(0,y,-7.59,1.25,.78)
        self.table(0,sun,.01,1.40,1.21)
        # Low plunge basin in the sheltered transom terrace. The coping is four real rails around a recessed water surface.
        z=-14.04; b=self.d.terrace
        self.box("terrace pool plinth",0,b+.155,z,2.88,.32,1.64,"pearl",.14,4)
        self.box("pool mosaic floor",0,b+.321,z,2.72,.039,1.49,"tile",.018)
        self.box("plunge pool water",0,b+.35,z,2.53,.035,1.29,"pool",.015)
        for s in (-1,1):
            self.box("pool side coping",s*1.35,b+.36,z,.16,.10,1.55,"cream",.047,3)
            self.box("pool end coping",0,b+.36,z+s*.719,2.62,.10,.15,"cream",.047,3)
        for s in (-1,1):
            self.box("sundeck bar",s*1.46,sun+.48,1.25,.59,.96,1.92,"walnut",.08,3)
            self.box("sundeck counter",s*1.46,sun+.99,1.25,.67,.087,2.00,"cream",.038,3)
            self.rod("bar foot rail",(s*1.03,sun+.18,.38),(s*1.03,sun+.18,2.10),.022)
            for zz in (.76,1.68):
                self.rod("bar stool stem",(s*.83,sun+.027,zz),(s*.83,sun+.60,zz),.035,"stainless",10)
                self.rod("bar stool cushion",(s*.83,sun+.57,zz),(s*.83,sun+.67,zz),.19,"linen",16)

    def finish(self):
        arm=bpy.data.armatures.new(self.name)
        rig=bpy.data.objects.new(self.name,arm)
        bpy.context.scene.collection.objects.link(rig)
        bpy.context.view_layer.objects.active=rig
        bpy.ops.object.mode_set(mode="EDIT")
        for name,(x,y,z) in self.joints.items():
            node=arm.edit_bones.new(name)
            node.head=(x,-z,y); node.tail=(x,-z,y+.10)
            if name!="chassis": node.parent=arm.edit_bones["chassis"]
        bpy.ops.object.mode_set(mode="OBJECT")
        sizes=OWN[self.name]
        mats={m:bpy.data.materials.new(m) for m in (*sizes,"teak")}
        items,names,parts,reach=[],[],[],1
        for k,(bone,o) in enumerate(self.parts):
            me=o.data
            bm=bmesh.new(); bm.from_mesh(me)
            bmesh.ops.triangulate(bm,faces=list(bm.faces))
            # Deep concave lofts can fool Blender's outward heuristic on a thin stem.
            if bm.calc_volume(signed=True) < 0:
                bmesh.ops.reverse_faces(bm,faces=list(bm.faces))
            bm.to_mesh(me); bm.free()
            tags=tags_of(o)
            me.materials.clear()
            for m in mats.values(): me.materials.append(m)
            uv=me.uv_layers.new(name="shipyard")
            mine=[]
            for face,tag in zip(me.polygons,tags):
                face.use_smooth=True
                picture=own(self.name,tag,face.center.y)
                mine.append(picture)
                face.material_index=list(mats).index(picture or "teak")
                if picture:
                    continue
                # The planks run the length of the vessel, a sheet every 2.4 m.
                axis=max(range(3),key=lambda i:abs(face.normal[i]))
                a,b=[(2,1),(0,2),(0,1)][axis]
                flip=(axis==0 and face.normal.x>0) or (axis==1 and face.normal.y>0) or (axis==2 and face.normal.z<0)
                sheet=[((-me.vertices[me.loops[j].vertex_index].co[a] if flip else me.vertices[me.loops[j].vertex_index].co[a])/2.4,
                        me.vertices[me.loops[j].vertex_index].co[b]/2.4) for j in face.loop_indices]
                sheet=on_first_sheet(sheet)
                reach=max(reach,sheets_of(sheet))
                for j,st in zip(face.loop_indices,sheet):
                    uv.data[j].uv=st
            mark(o,tags,names,k,parts)
            items.append((o,mine,tags))
        # The bottom is seen afloat only through the water, and the undersides of the decks in their own shade.
        # A pane's inner face is cut out of the house's picture, and shown as little of it as any face; the helm's
        # displays are read from a seat, at six times the texels of the rest.
        lay_out(items,sizes,lambda tag,axis: 6.0 if tag in SCREENS else .05 if tag=="clear" else (.35 if tag in HULL else .5) if axis==3 else 1.0,sheets=reach)
        for bone,o in self.parts:
            me=o.data
            me.set_sharp_from_angle(angle=math.radians(37))
            me.transform(E2B)
            o.vertex_groups.new(name=bone).add(list(range(len(me.vertices))),1,"REPLACE")
            o.parent=rig; o.modifiers.new("Armature","ARMATURE").object=rig
        bpy.ops.object.select_all(action="DESELECT")
        for _,o in self.parts: o.select_set(True)
        bpy.context.view_layer.objects.active=self.parts[0][1]
        bpy.ops.object.join()
        bpy.context.object.name=self.name+"_skin"
        check(str(HERE.parent/self.name),[bpy.context.object],names,parts,sizes)


def build(name):
    yacht=Yacht(name)
    yacht.hull()
    getattr(yacht,name)()
    yacht.ground_tackle()
    yacht.helm()
    yacht.finish()
