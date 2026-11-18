"""Unit 27, Harbor District. A four-door full-frame patrol sedan in engine metres."""
import math
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent / "sports"), str(HERE.parent / "compact")]
from parts import Part, E2B, lathe
from coachwork import Coupe, between, sample, mix
from livery import RECT

PI, TAU = math.pi, math.tau
PIVOTS = {"chassis": (0,0,0)}
for axle, z in [("front",1.49),("rear",-1.49)]:
    for side, s in [("left",1),("right",-1)]:
        PIVOTS[f"wheel_{axle}_{side}"] = (.84*s,.345,z)
PIVOTS.update(door_left=(.941,.80,.965), door_right=(-.941,.80,.965),
              door_rear_left=(.95,.80,-.184), door_rear_right=(-.95,.80,-.184), steering_wheel=(.47,.901,.655))


class Patrol(Coupe):
    # The fleet's solid loft/sheet/tube primitives are shared. The car's sections,
    # openings and running gear below are built on the sedan's own measurements.
    def __init__(self):
        self.parts = {bone: [] for bone in PIVOTS}
        self.bone = "chassis"

    @staticmethod
    def beam_width(z):
        return sample([(-2.59,.872),(-2.42,.932),(-1.75,.982),(-1.1,.983),(-.23,.970),
                       (.78,.976),(1.49,.99),(2.1,.967),(2.46,.908)], z, True)

    @staticmethod
    def waist(z):
        return sample([(-2.59,.893),(-2.38,.945),(-1.48,.992),(-.89,1.004),(.3,.999),
                       (1.05,.976),(1.55,.948),(2.13,.884),(2.46,.826)],z,True)

    @staticmethod
    def sweep(x,z):
        # Sweep the hood and deck edges back at the lamps. The wheel centres stay square.
        return z - .145 * max(0,(z-1.93)/.53)**1.5 * (abs(x)/.96)**2 + .135*max(0,(-z-1.99)/.60)**1.4 * (abs(x)/.96)**2

    @staticmethod
    def arch(z):
        r=.404
        d=min(abs(z-1.49),abs(z+1.49))
        if d < r:
            return .345 + math.sqrt(max(0,r*r-d*d))
        return mix(.345,.255,min(1,(d-r)/.11))

    def deck_y(self,x,z):
        u=min(1,abs(x)/self.beam_width(z))
        return self.waist(z) + .040*(1-u*u) + .021*math.exp(-((u-.68)/.13)**2)

    def wing(self,s,z):
        w=self.beam_width(z); h=self.waist(z); low=self.arch(z)
        # Rolled return, undercut rocker, belt rub rail and a separate shoulder break.
        frac=[(.78,low+.018),(.927,low),(.970,mix(low,h,.16)),(.994,mix(low,h,.42)),
              (1,mix(low,h,.64)),(.997,mix(low,h,.79)),(.983,h-.039),(.947,h),
              (.85,self.deck_y(.85*w,z))]
        return [(s*q*w,y,self.sweep(q*w,z)) for q,y in frac]

    def stations(self,a,b):
        pts=between(a,b,math.ceil((b-a)/.15))
        for axle in [-1.49,1.49]:
            pts += [axle+.404*math.cos(PI*i/20) for i in range(21)]+[axle-.514,axle+.514]
        return sorted({round(min(b,max(a,z)),6) for z in pts})

    def sides(self):
        for s,side in [(1,"left"),(-1,"right")]:
            spans=[(-2.59,-1.321,"chassis","navy"),(-1.307,-.199,"door_rear_"+side,"crest"),
                   (-.184,.962,"door_"+side,"lettering"),(.976,2.46,"chassis","navy")]
            for a,b,bone,color in spans:
                self.bone=bone
                moving=bone!="chassis"
                outer=color if moving else "navy"
                rings=[]
                for z in self.stations(a,b):
                    p=self.wing(s,z)
                    inside=self.beam_width(z)-(.126 if moving else .191)
                    rings.append(p+[(s*inside,self.waist(z)-.032,self.sweep(inside,z)),
                                    (s*inside,self.arch(z)+.035,self.sweep(inside,z))])
                self.loft("door pressing" if moving else "wheel wing",rings,
                          lambda i,k: outer if 1<=k<=6 else ("ivory" if moving and k==7 else "navy" if k==7 else "dash"),
                          ("seal","seal") if moving else ("navy","navy"))
                if moving:
                    z=a+.15 if a>-.5 else a+.34
                    x=self.beam_width(z)*.992
                    self.block("recessed door handle",s*x,.898,z,.033,.058,.155,.015,"seal")
                    self.block("pull lever",s*(x+.015),.909,z,.021,.020,.118,.007,"chrome")
                    self.block("armrest",s*.821,.686,(a+b)/2,.082,.063,.46,.025,"vinyl")
                    self.block("door card",s*.836,.746,(a+b)/2,.042,.287,.60,.035,"vinyl")
                    self.block("inside release",s*.801,.816,(a+b)/2+.13,.020,.024,.095,.008,"chrome")
            self.bone="chassis"
            for zc in [-1.49,1.49]:
                inner=[(s*.663,.246,zc+.43)]
                for a in between(0,PI,24):
                    inner.append((s*.663,.345+.405*math.sin(a),zc+.404*math.cos(a)))
                inner.append((s*.663,.246,zc-.43))
                self.polygon("wheelhouse inner liner",inner,(-s*.019,0,0),"seal")
            self.block("rocker weld",s*.916,.259,0,.085,.086,2.16,.022,"black")
        self.bone="chassis"
        # There is no deck across the door or window apertures.
        for a,b in [(-2.59,-1.48),(.948,2.46)]:
            zs=between(a,b,13)
            rows=[]
            for z in zs:
                row=[]
                for u in between(-.87,.87,16):
                    x=u*self.beam_width(z)
                    row.append((x,self.deck_y(x,z),self.sweep(x,z)))
                rows.append(row)
            self.sheet("deck lid" if a<0 else "hood",rows,(0,-.04,0),"navy","navy","dash")
            for s in [-1,1]:
                points=[]
                for z in zs[1:-1]:
                    x=s*.82*self.beam_width(z)
                    points.append((x,self.deck_y(x,z)+.001,self.sweep(x,z)))
                self.tube("panel shut line",points,.004,"seal",5)
        self.block("floor pan",0,.252,0,1.70,.072,3.63,.035,"carpet")

    def block(self,name,x,y,z,dx,dy,dz,r,tag,segments=1):
        return self.box(name,(x-dx/2,y-dy/2,z-dz/2),(x+dx/2,y+dy/2,z+dz/2),r,tag,min(segments,2))

    @staticmethod
    def roof_y(x,z):
        return 1.492 - .042*(abs(x)/.743)**2 - .036*(abs(z+.25)/.69)**2

    def greenhouse(self):
        rows=[]
        for z in between(-.945,.405,14):
            hw=sample([(-.945,.681),(-.75,.732),(-.26,.751),(.18,.739),(.405,.701)],z,True)
            rows.append([(u*hw,self.roof_y(u*hw,z),z+.022*(1-u*u)*(1 if z>0 else -1)) for u in between(-1,1,12)])
        self.sheet("crowned fleet roof",rows,(0,-.032,0),"roof","ivory","liner")
        # The glasses' ceramic perimeter is modeled as a closed ring. Its centre is open in each LOD.
        for front in [True,False]:
            def wind(t,u):
                bz,tz=(1.094,.421) if front else (-1.632,-.959)
                w=mix(.865,.698,t)
                z=mix(bz,tz,t) + (-1 if front else 1)*(.068*(1-t)+.024*t)*u*u
                y=mix(1.008,1.458,t) - (.014+.03*t)*u*u
                return (w*u,y,z)
            outline=([(0,u) for u in between(-1,1,10)[:-1]]+[(t,1) for t in between(0,1,5)[:-1]]
                     +[(1,u) for u in between(1,-1,10)[:-1]]+[(t,-1) for t in between(1,0,5)[:-1]])
            rings=[]
            for shrink,offset in [(False,0),(True,0),(True,-.009),(False,-.009)]:
                ring=[]
                for t,u in outline:
                    x,y,z=wind(mix(.047,.895+.042*u*u,t) if shrink else t,u*.958 if shrink else u)
                    ring.append((x,y+offset,z))
                rings.append(ring)
            p=Part()
            ids=[[p.v(pt) for pt in r] for r in rings]
            for i,tag in enumerate(["glass","seal","smoke","seal"]):
                for k in range(len(outline)):
                    j=(k+1)%len(outline)
                    p.face([ids[i][k],ids[i][j],ids[(i+1)%4][j],ids[(i+1)%4][k]],tag)
            self.keep(p.obj("windscreen frit" if front else "backlight frit"))
        for s,side in [(1,"left"),(-1,"right")]:
            def plate(name,points,tag):
                self.polygon(name,[(s*x,y,z) for x,y,z in points],(-s*.036,-.005,0),tag,"seal","liner")
            plate("A pillar",[(.70,1.45,.39),(.755,1.39,.33),(.91,.993,.935),(.873,1.006,1.043)],"ivory")
            plate("B pillar",[(.754,1.40,-.149),(.754,1.40,-.212),(.923,1.0,-.247),(.923,1.0,-.145)],"black")
            plate("sail panel",[(.706,1.435,-.90),(.744,1.384,-.803),(.908,.996,-1.28),(.862,.996,-1.59)],"navy")
            self.tube("roof drip rail",[(s*.697,1.432,.376),(s*.733,1.444,.18),(s*.751,1.449,-.26),
                                        (s*.733,1.441,-.72),(s*.692,1.417,-.915)],.017,"hub",8)
            # Thin perimeter frames move with their respective doors. The bulkier A/B/C pillars stay with the roof.
            for front in [True,False]:
                self.bone=("door_" if front else "door_rear_")+side
                outline=([(s*.928,1.005,.929),(s*.746,1.39,.311),(s*.751,1.407,-.136),(s*.927,1.005,-.164)]
                         if front else [(s*.926,1.005,-.236),(s*.754,1.404,-.229),(s*.746,1.389,-.785),(s*.914,1.005,-1.259)])
                self.tube("door window channel",outline,.013,"seal",7)
                self.tube("lower bright belt",[(s*.931,1.005,outline[0][2]),(s*.932,1.009,outline[-1][2])],.012,"chrome",8)
            self.bone="door_"+side
            self.tube("mirror stalk",[(s*.914,1.012,.827),(s*.955,1.068,.817),(s*1.012,1.076,.771)],.021,"black",8)
            zs=[(.715,.978,.082,.046),(.747,1.002,.078,.056),(.823,1.002,.067,.049),(.858,.991,.046,.032)]
            rings=[[(s*(x+hw*math.cos(a)),1.078+hh*math.sin(a),z) for a in [TAU*i/12 for i in range(12)]] for z,x,hw,hh in zs]
            self.loft("rear view mirror",rings,"black",("mirror","black"))
            self.bone="chassis"
        self.block("rear parcel shelf",0,.927,-1.35,1.73,.082,.53,.029,"dash")
        for s in [-1,1]:
            self.tube("wiper arm",[(s*.64,1.011,1.06),(s*.32,1.046,1.019),(s*.08,1.047,1.011)],.009,"seal",6)
            self.tube("wiper blade",[(s*.48,1.058,.998),(s*.10,1.058,.992),(s*-.12,1.031,1.036)],.012,"black",6)

    def ends(self):
        for front in [True,False]:
            s=1 if front else -1
            tip=2.46 if front else -2.59
            def at(x,y,inset):
                return (x,y,self.sweep(x,tip) + s*inset)
            width=.938 if front else .921
            # Moulded bumper with a lower roll and a continuous black rubbing strip.
            profile=[(.287,-.112),(.259,-.034),(.29,-.014),(.362,-.002),(.452,.0),(.476,-.008),
                     (.504,-.005),(.547,-.013),(.578,-.027),(.58,-.16),(.30,-.16)]
            rings=[[at(u*width,y+ .037*abs(u)**4,offset-.015*abs(u)**5) for y,offset in profile] for u in between(-1,1,22)]
            self.loft("formed bumper cover",rings,lambda i,k: "black" if k in (4,5) else "navy",("navy","navy"))
            if front:
                rings=[[at(x,y,off) for y,off in [(.508,-.093),(.533,-.015),(.638,-.022),(.656,-.061),(.657,-.154)]]
                       for x in between(-.925,.925,18)]
                self.loft("front lower panel",rings,"navy")
                self.block("lower cooling inlet",0,.37,2.452,.845,.098,.018,.006,"grille")
                self.block("lower grille spar",0,.374,2.465,.79,.014,.015,.005,"black")
                outer=[(-.55,.833),(-.43,.847),(.43,.847),(.55,.833),(.546,.785),(.472,.641),(.39,.63),(-.39,.63),(-.472,.641),(-.546,.785)]
                rings=[]
                for scale,depth in [(1,-.072),(1,-.004),(.972,.004),(.925,-.005),(.90,-.049)]:
                    rings.append([at(x*scale,.74+(y-.74)*scale,depth) for x,y in outer])
                self.loft("inset radiator grille",rings,lambda i,k:["navy","hub","chrome","black"][i],("black","grille"))
                for i,y in enumerate([.666,.699,.733,.767,.8]):
                    hw=.421+i*.015
                    self.tube("radiator bright blade",[at(x,y,-.029) for x in between(-hw,hw,12)],.006,"steel",6)
                self.block("grille escutcheon",0,.744,2.445,.122,.056,.018,.008,"indigo")
                self.block("grille badge",0,.743,2.455,.065,.018,.014,.004,"hub")
            else:
                profile=[(.525,-.065),(.558,-.026),(.69,-.019),(.856,-.016),(.9,-.031),(.904,-.135),(.541,-.14)]
                self.loft("rear tail panel",[[at(x,y,o) for y,o in profile] for x in between(-.902,.902,16)],"navy")
                self.block("rear plate pocket",0,.715,-2.572,.52,.23,.019,.009,"black")
                self.block("fleet registration",0,.713,-2.584,.377,.152,.012,.004,"plate")
                self.block("trunk garnish",0,.847,-2.567,.89,.06,.022,.009,"deck")
            for sign in [-1,1]:
                def lens(name, xmin,xmax,yl,yh,deep,tag):
                    # Lens ends sweep into the front wings. A longer outside returns around the body corner.
                    rings=[]
                    for x in between(xmin,xmax,8):
                        t=(x-xmin)/(xmax-xmin)
                        ylo=yl+.027*t; yhi=yh-.012*t
                        corners=[(ylo+.014,deep-.061),(ylo,deep-.005),(ylo+.012,deep+.002),
                                 (yhi-.011,deep+.002),(yhi,deep-.008),(yhi-.005,deep-.064)]
                        rings.append([at(sign*x,y,off) for y,off in corners])
                    self.loft(name,rings,tag)
                if front:
                    lens("headlight housing",.545,.92,.643,.837,-.012,"black")
                    lens("outer reflector",.567,.869,.664,.823,-.002,"reflect")
                    lens("sealed beam low",.724,.862,.685,.806,.006,"white")
                    lens("sealed beam high",.579,.708,.677,.812,.006,"white")
                    lens("corner indicator",.868,.917,.674,.801,.002,"amber")
                else:
                    lens("rear lamp perimeter",.394,.912,.628,.866,-.004,"seal")
                    lens("stop and tail lens",.493,.905,.65,.851,.005,"red")
                    lens("reverse lens",.410,.490,.697,.825,.005,"white")
                    lens("tail lamp lower divider",.493,.90,.702,.709,.011,"black")
                    self.rod("tailpipe",(sign*.64,.253,-2.28),(sign*.64,.25,-2.55),.045,"steel",16)
                    self.rod("tailpipe mouth",(sign*.64,.25,-2.545),(sign*.64,.25,-2.552),.035,"seal",16)
        # Pressed upright ends and low cross tube on a two-post push bar.
        for s in [-1,1]:
            yz=[(.32,2.432),(.306,2.491),(.35,2.553),(.691,2.59),(.888,2.56),
                (.923,2.51),(.91,2.454),(.857,2.437),(.696,2.483),(.45,2.458)]
            self.polygon("push bumper upright",[(s*.395,y,z) for y,z in yz],(s*.058,0,0),"black")
            self.tube("upright rubber pad",[(s*.423,.397,2.547),(s*.423,.688,2.574),(s*.423,.848,2.548)],.016,"rubber",9)
            self.block("push bumper mount",s*.421,.417,2.435,.094,.065,.208,.009,"steel")
        self.rod("upper crossbar",(-.416,.784,2.51),(.416,.784,2.51),.026,"black",12)
        self.rod("lower crossbar",(-.416,.48,2.503),(.416,.48,2.503),.034,"black",12)
        self.block("push plate",0,.481,2.517,.4,.094,.019,.008,"black")

    def running_gear(self):
        for bone,(cx,cy,cz) in PIVOTS.items():
            if not bone.startswith("wheel_"):
                continue
            self.bone=bone
            s=1 if cx>0 else -1
            def turn(name,prof,tag,segments=32):
                p=Part()
                lathe(p,(cx,cy,cz),s,prof,segments,tag)
                self.keep(p.obj(name))
            turn("all season radial",[(-.101,.204),(-.1175,.26),(-.115,.30),(-.094,.336),(-.078,.345),
                                       (.078,.345),(.094,.336),(.115,.30),(.1175,.26),(.103,.202)],
                 lambda k: "tread" if 3<=k<=5 else "rubber")
            for r in [.297]:
                turn("sidewall mould line",[(.114,r-.002),(.118,r),(.114,r+.002)],"rubber",24)
            turn("steel rim barrel",[(-.093,.192),(-.096,.204),(-.081,.213),(.097,.213),(.111,.204),
                                    (.110,.194),(.086,.186),(.044,.185),(.039,.177),(-.082,.177)],
                 lambda k:"steel" if k in (4,5) else "darkrim")
            # A dished steel stamping. Ten open ventilation slots surround the chrome dog-dish cap.
            p=Part()
            count=10
            def point(radius,angle,depth):
                return (cx+s*depth,cy+radius*math.cos(angle),cz+radius*math.sin(angle))
            for i in range(count):
                a=i*TAU/count; da=PI/count
                outline=[(.090,a-da),(.148,a-da),(.192,a-da),(.192,a),(.192,a+da),(.148,a+da),(.090,a+da),(.090,a)]
                hole=[(.142,a-.141),(.152,a-.195),(.164,a-.15),(.169,a),(.164,a+.15),(.152,a+.195),(.142,a+.141),(.139,a)]
                def depth(r):
                    return sample([(.09,.103),(.14,.073),(.164,.059),(.192,.085)],r)
                front=[p.v(point(r,t,depth(r))) for r,t in outline]
                lip=[p.v(point(r,t,depth(r)-.002)) for r,t in hole]
                back=[p.v(point(r,t,depth(r)-.013)) for r,t in outline]
                lip_back=[p.v(point(r,t,depth(r)-.013)) for r,t in hole]
                for k in range(8):
                    j=(k+1)%8
                    p.face((front[k],front[j],lip[j],lip[k]),"darkrim")
                    p.face((lip[k],lip[j],lip_back[j],lip_back[k]),"black")
                    p.face((back[k],lip_back[k],lip_back[j],back[j]),"darkrim")
                    # Edges at sector boundaries weld when Part.obj merges coincident vertices.
                    if k in (2,3,6,7):
                        p.face((front[k],back[k],back[j],front[j]),"darkrim")
            self.keep(p.obj("ventilated pressed steel wheel"))
            turn("chrome service cap",[(.082,.017),(.083,.091),(.099,.107),(.112,.104),(.123,.080),(.131,.056),(.133,.017)],"hub",28)
            self.rod("die struck hub medallion",(cx+s*.118,cy,cz),(cx+s*.135,cy,cz),.028,"steel",16)
            for j in range(5):
                a=TAU*j/5
                self.rod("wheel cap boss",point(.083,a,.115),point(.083,a,.124),.009,"chrome",8)
            self.rod("disc behind wheel",(cx+s*.016,cy,cz),(cx+s*.027,cy,cz),.176,"disco",28)
        self.bone="chassis"
        for x in [-.56,.56]:
            self.block("frame rail",x,.224,0,.098,.084,3.78,.02,"black")
        for z in [-1.49,1.49]:
            self.rod("crossmember",(-.78,.281,z),(.78,.281,z),.063,"black",12)

    def equipment(self):
        # Eight ribbed LED modules per face sit in a metal extrusion with a removable top lid.
        for x in [-.44,.44]:
            self.block("lightbar foot",x,1.494,0,.147,.04,.194,.012,"seal")
            self.block("lightbar riser",x,1.525,0,.108,.052,.152,.014,"black")
        def tray(name,levels,tag):
            footprint=[(-.71,-.071),(-.668,-.124),(-.573,-.148),(.573,-.148),(.668,-.124),(.71,-.071),
                       (.71,.071),(.668,.124),(.573,.148),(-.573,.148),(-.668,.124),(-.71,.071)]
            self.loft(name,[[(x*scale,y,z*scale) for x,z in footprint] for scale,y in levels],tag)
        tray("lightbar base",[(.965,1.548),(1,1.556),(1,1.579),(.979,1.584)],"black")
        tray("lightbar core",[(.952,1.578),(.974,1.592),(.974,1.644),(.952,1.651)],"steel")
        tray("lightbar upper weather seal",[(.981,1.644),(1,1.65),(1,1.658),(.985,1.661)],"black")
        tray("anodised lightbar cover",[(.985,1.657),(.985,1.665),(.96,1.67)],"chrome")
        for s,color in [(1,"ruby"),(-1,"blue")]:
            for side in [-1,1]:
                for x in [.155,.294,.43,.562]:
                    self.block("ribbed lightbar optic",s*x,1.615,side*.137,.125,.062,.024,.010,color,3)
                self.block("clear takedown light",s*.051,1.615,side*.138,.064,.05,.024,.008,"white")
                for x in [.224,.362,.496]:
                    self.block("optic separator",s*x,1.616,side*.138,.009,.064,.025,.003,"black")
            # Wraparound end lens has facets aimed towards traffic approaching from the side.
            points=[(.627,-.134),(.66,-.121),(.701,-.067),(.701,.067),(.66,.121),(.627,.134)]
            front=[(s*x,1.589,z) for x,z in points]
            self.polygon("wraparound corner lens",front,(0,.049,0),color)
        self.block("aerial base",-.57,.979,-1.93,.068,.043,.089,.012,"black")
        self.rod("rear whip antenna",(-.57,.989,-1.93),(-.585,1.49,-2.01),.006,"steel",7,.003)
        self.block("mirror mounting",0,1.385,.495,.041,.036,.048,.01,"seal")
        self.block("rearview mirror",0,1.349,.478,.23,.066,.058,.014,"black")
        self.block("rearview silvered face",0,1.349,.449,.205,.047,.006,.002,"mirror")

    def seats_and_dash(self):
        for x in [-.47,.47]:
            for z in [.24,-.74]:
                self.block("seat plinth",x,.365,z,.435,.13,.441,.04,"black")
                self.block("contoured seat cushion",x,.46,z,.518,.14,.462,.05,"vinyl",3)
                self.block("cushion cloth insert",x,.517,z+.008,.391,.026,.355,.009,"linen")
                rings=[]
                for y,w,d,u in [(.486,.217,.059,0),(.55,.252,.077,-.012),(.84,.237,.074,-.071),
                               (.951,.219,.062,-.10),(1.004,.183,.043,-.111)]:
                    rings.append([(x+p*w,y,z-.195+u+q*d) for p,q in [(-.88,1),(.88,1),(1,.60),(.99,-.62),(.83,-1),(-.83,-1),(-1,-.62),(-1,.60)]])
                self.loft("sculpted seat back",rings,lambda i,k:"linen" if k==0 else "vinyl",("vinyl","vinyl"))
                for sign in [-1,1]:
                    self.rod("head restraint post",(x+.077*sign,.99,z-.30),(x+.077*sign,1.078,z-.318),.009,"chrome",8)
                self.block("head restraint",x,1.092,z-.322,.297,.126,.113,.04,"vinyl",3)
        # Flat rear-facing instruments and a sloping cap under the windshield.
        rings=[]
        for x in between(-.882,.882,14):
            lift=.017*(1-(x/.89)**2)
            rings.append([(x,y+lift,z) for y,z in [(.697,.931),(.718,.753),(.795,.720),(.888,.760),
                                                   (.945,.815),(.966,.997),(.926,1.082),(.705,1.06)]])
        self.loft("padded crash pad",rings,"dash")
        self.block("instrument binnacle",.47,.937,.786,.425,.154,.138,.045,"black",3)
        self.block("analog cluster",.47,.934,.716,.373,.105,.014,.005,"gauge")
        for x in [-.72,-.26,.16,.744]:
            self.block("air register",x,.854,.751,.109,.059,.016,.006,"vent")
        self.block("transmission tunnel",0,.365,.28,.265,.209,1.13,.045,"carpet")
        self.block("radio console",0,.522,.389,.278,.216,.477,.035,"black")
        self.block("radio face",0,.562,.15,.222,.095,.018,.007,"radio")
        self.block("microphone",.173,.573,.32,.042,.071,.102,.014,"black")
        self.block("fleet computer pedestal",-.09,.681,.542,.063,.202,.084,.017,"black")
        self.block("computer housing",-.099,.824,.536,.328,.201,.047,.017,"black")
        self.block("dispatch display",-.099,.826,.51,.294,.158,.013,.005,"radio")
        for sign in [-1,1]:
            self.rod("divider bracket",(sign*.739,.416,-.34),(sign*.743,1.338,-.485),.021,"black",10)
        self.rod("divider top rail",(-.744,1.334,-.481),(.744,1.334,-.481),.019,"black",10)
        self.block("divider kick plate",0,.647,-.384,1.483,.419,.037,.016,"black")
        # The partition has free sight lines between the two rows.
        for x in between(-.66,.66,13):
            self.rod("divider upright",(x,.85,-.392),(x,1.323,-.478),.005,"steel",6)
        for t in [.22,.48,.74]:
            self.rod("divider cross wire",(-.727,mix(.85,1.323,t),mix(-.392,-.478,t)),
                     (.727,mix(.85,1.323,t),mix(-.392,-.478,t)),.004,"black",6)
        x,y,z=PIVOTS["steering_wheel"]
        self.rod("steering column",(x,.843,.764),(x,y,z),.032,"dash",12)
        self.bone="steering_wheel"
        # Use a closed torus rather than overlapping tube ends.
        p=Part()
        rings=[]
        for a in [TAU*i/36 for i in range(36)]:
            perp=Vector((math.cos(a),.94*math.sin(a),.34*math.sin(a)))
            axial=Vector((0,-.34,.94))
            center=Vector((x,y,z))+.156*perp
            rings.append([p.v(center+.0145*(perp*math.cos(b)+axial*math.sin(b))) for b in [TAU*j/8 for j in range(8)]])
        for i in range(36):
            for j in range(8):
                p.face((rings[i][j],rings[i][(j+1)%8],rings[(i+1)%36][(j+1)%8],rings[(i+1)%36][j]),"black")
        self.keep(p.obj("steering wheel rim"))
        self.block("airbag pad",x,y,z,.121,.082,.049,.022,"dash")
        for a in [.0, PI, 1.5*PI]:
            self.rod("steering spoke",(x,y,z),(x+.151*math.cos(a),y+.141*math.sin(a),z+.051*math.sin(a)),.016,"black",8)
        self.bone="chassis"

    def bind(self):
        arm=bpy.data.armatures.new("patrol_sedan")
        rig=bpy.data.objects.new("patrol_sedan",arm)
        bpy.context.scene.collection.objects.link(rig)
        bpy.context.view_layer.objects.active=rig
        bpy.ops.object.mode_set(mode="EDIT")
        for name,(x,y,z) in PIVOTS.items():
            b=arm.edit_bones.new(name)
            b.head=(x,-z,y); b.tail=(x,-z,y+.1)
            if name!="chassis":
                b.parent=arm.edit_bones["chassis"]
        bpy.ops.object.mode_set(mode="OBJECT")
        material=bpy.data.materials.new("cruiser")
        for bone,objects in self.parts.items():
            for obj in objects:
                mesh=obj.data
                bm=bmesh.new()
                bm.from_mesh(mesh)
                # Retain finish boundaries across formed sheet metal and the wheel stampings.
                bmesh.ops.dissolve_limit(bm,angle_limit=.005,verts=bm.verts[:],edges=bm.edges[:],delimit={"MATERIAL"})
                bmesh.ops.triangulate(bm,faces=bm.faces[:],quad_method="BEAUTY",ngon_method="BEAUTY")
                bm.normal_update()
                bm.to_mesh(mesh)
                bm.free()
                mesh.update()
                low=[min(v.co[i] for v in mesh.vertices) for i in range(3)]
                span=[max(.0001,max(v.co[i] for v in mesh.vertices)-low[i]) for i in range(3)]
                uv=mesh.uv_layers.new(name="fleet finish").data
                tags=[m.name.removeprefix("t_") for m in mesh.materials]
                for f in mesh.polygons:
                    tag=tags[f.material_index]
                    ox,oy,w,h=RECT[tag]
                    coords=[]
                    normal=f.normal
                    axis=max(range(3),key=lambda i:abs(normal[i]))
                    a,b=[(1,2),(2,0),(0,1)][axis]
                    for k in f.loop_indices:
                        v=mesh.vertices[mesh.loops[k].vertex_index].co
                        u=(v[a]-low[a])/span[a]
                        rise=(v[b]-low[b])/span[b]
                        if normal[axis]<0:
                            u=1-u
                        if tag in ("lettering","crest"):
                            z0,z1=(-.184,.962) if tag=="lettering" else (-1.307,-.199)
                            u=(v.z-z0)/(z1-z0)
                            if v.x>0:
                                u=1-u
                            rise=(v.y-.253)/.752
                        elif tag=="roof" and axis==1:
                            u=.5+v.x/1.55
                            rise=(.42-v.z)/1.37
                        elif tag in ("gauge","radio","deck","plate") and axis==2:
                            u=1-(v.x-low[0])/span[0]
                            rise=(v.y-low[1])/span[1]
                        u=min(1,max(0,u)); rise=min(1,max(0,rise))
                        coords.append(((ox+1.5+u*(w-3))/512,1-(oy+1.5+(1-rise)*(h-3))/512))
                    qa,qb,qc=[(round(i*65535),round(j*65535)) for i,j in coords]
                    det=(qb[0]-qa[0])*(qc[1]-qa[1])-(qb[1]-qa[1])*(qc[0]-qa[0])
                    if abs(det)<10:
                        a0,b0=coords[0]
                        coords=[(a0,b0),(a0+.0004,b0),(a0,b0+.0004)]
                    for k,xy in zip(f.loop_indices,coords):
                        uv[k].uv=xy
                    f.use_smooth=True
                mesh.set_sharp_from_angle(angle=math.radians(31))
                mesh.materials.clear()
                mesh.materials.append(material)
                for f in mesh.polygons:
                    f.material_index=0
                mesh.transform(E2B)
            bpy.ops.object.select_all(action="DESELECT")
            for o in objects:
                o.select_set(True)
            bpy.context.view_layer.objects.active=objects[0]
            bpy.ops.object.join()
            o=bpy.context.view_layer.objects.active
            o.name=bone; o.data.name=bone
            o.vertex_groups.new(name=bone).add(list(range(len(o.data.vertices))),1,"REPLACE")
            o.parent=rig
            o.modifiers.new("Armature","ARMATURE").object=rig

car=Patrol()
car.sides()
car.greenhouse()
car.ends()
car.running_gear()
car.equipment()
car.seats_and_dash()
car.bind()
