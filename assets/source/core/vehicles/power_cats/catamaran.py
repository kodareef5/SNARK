"""Original hard-chine power catamarans. All construction coordinates are engine metres (+Y up, +Z bow)."""

import json
import math
from pathlib import Path
import subprocess
import sys
import bmesh
import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "compact"))
from parts import E2B, Part, rbox, cylinder
from finish import SWATCH, CHARTS

TAU = math.tau


def lerp(a, b, t):
    return a + t * (b - a)


class Yard:
    def __init__(self, name):
        self.name = name
        self.model = json.loads(subprocess.check_output(["bun", str(HERE / "design.ts"), name]))
        self.large = name == "lagoon"
        self.bone = "chassis"
        self.pivots = {"chassis": ((0, 0, 0), None)}
        for suffix, prop, mount in (("", "propeller", "outboard"), ("_starboard", "secondPropeller", "secondOutboard")):
            parent = "chassis"
            if mount in self.model:
                parent = "outboard" + suffix
                self.pivots[parent] = self.model[mount], "chassis"
            self.pivots["propeller" + suffix] = self.model[prop], parent
        self.pivots["steering"] = self.model["helm"], "chassis"
        # Preserve the support frame's thin silhouette at distant palette-only levels.
        self.pivots["canopy"] = (0, 4.51 if self.large else 1.34, 0), "chassis"
        self.groups = {key: [] for key in self.pivots}

    def put(self, obj):
        self.groups[self.bone].append(obj)

    def loft(self, name, sections, finish, ends=None):
        p = Part()
        p.loft(sections, finish, ends or (finish, finish))
        self.put(p.obj(name))

    def box(self, name, lo, hi, finish, bevel=.025, segments=2):
        self.put(rbox(name, lo, hi, bevel, finish, segments))

    def rod(self, name, a, b, r, finish, n=9, r2=None):
        self.put(cylinder(name, a, b, r, finish, n, r2))

    def tube(self, name, points, r, finish, n=8):
        rings, across = [], None
        for i, pos in enumerate(points):
            direction = (Vector(points[min(len(points)-1,i+1)]) - Vector(points[max(0,i-1)])).normalized()
            across = direction.cross(Vector((0,1,0))) if across is None else across - direction * across.dot(direction)
            if across.length < .001:
                across = direction.cross(Vector((0,0,1)))
            across.normalize()
            other = direction.cross(across)
            rings.append([Vector(pos) + r*(across*math.cos(TAU*k/n) + other*math.sin(TAU*k/n)) for k in range(n)])
        self.loft(name, rings, finish)

    def panel(self, name, outline, delta, finish, face=None):
        self.loft(name, [outline, [tuple(p[i]+delta[i] for i in range(3)) for p in outline]], finish, (face or finish, face or finish))

    def slab(self, name, sections, finish, top=None, underside=None):
        """Sections run stern to bow. A varying beam, small chine and rolled edge shape the horizontal rim."""
        rings = []
        for z, width, y, depth in sections:
            edge = min(depth*.24, width*.07)
            rings.append([(-width+edge,y,z),(width-edge,y,z),(width,y-edge,z),
                          (width-edge*.5,y-depth+edge*.5,z),(width-edge*2,y-depth,z),
                          (-width+edge*2,y-depth,z),(-width+edge*.5,y-depth+edge*.5,z),(-width,y-edge,z)])
        def tag(i,k):
            return (top or finish) if k==0 else (underside or finish) if k==4 else finish
        self.loft(name, rings, tag, (finish, finish))

    def oval(self, name, x, y, z, rx, rz, thickness, finish, n=28):
        self.loft(name, [[(x+scale*rx*math.cos(TAU*i/n), yy, z+scale*rz*math.sin(TAU*i/n)) for i in range(n)]
                         for yy,scale in ((y-thickness,.95),(y-thickness*.76,1),(y-thickness*.28,1),(y,.96))], finish)

    def seat(self, x, hip, z, width=.63, cockpit=False):
        """Pelvis datum is just above the finished seat crown. Each occupied socket has a physical forward-facing seat."""
        y = hip-.04
        self.box("seat pedestal", (x-width*.37,y-.46,z-.22),(x+width*.37,y-.14,z+.20), "gel",.065)
        self.box("seat edge welt", (x-width*.51,y-.16,z-.31),(x+width*.51,y-.032,z+.32), "piping",.06,3)
        self.box("seat cushion", (x-width*.50,y-.11,z-.30),(x+width*.50,y,z+.31), "seat",.075,4)
        rings = []
        for yy, half, zz, depth in ((y-.06,width*.49,z-.25,.14),(y+.14,width*.50,z-.32,.14),
                                   (y+.24,width*.48,z-.35,.133),(y+.27,width*.476,z-.356,.127),
                                   (y+(.48 if cockpit else .37),width*.44,z-.39,.105),(y+(.53 if cockpit else .42),width*.34,z-.40,.085)):
            rings.append([(x-half,yy,zz-depth/2),(x+half,yy,zz-depth/2),(x+half,yy,zz+depth/2),(x-half,yy,zz+depth/2)])
        self.loft("bolstered backrest", rings, lambda i,k: "piping" if k in (1,3) or i==2 else "seat", ("piping","piping"))
        if cockpit:
            for s in (-1,1):
                xx=x+s*width*.49
                self.rod("seat arm post",(xx,y-.03,z-.22),(xx,y+.16,z-.17),.022,"metal")
                self.box("arm pad",(xx-.041,y+.145,z-.22),(xx+.041,y+.21,z+.12),"carbon",.028,3)

    def helm(self):
        x,y,z = self.model["helm"]
        w = 1.16 if self.large else 1.25
        floor = 4.51 if self.large else 1.34
        # Forward rake on the binnacle leaves a knee and shoe pocket directly below the wheel.
        for name, rows, finish in (
            ("helm console",[(floor,.70,z+.46,z+.90),(floor+.16,.72,z+.36,z+.92),
                 (y-.29,w*.87,z+.23,z+.89),(y-.04,w,z+.14,z+.78),(y+.10,w*.93,z+.31,z+.76)],"gel"),
            ("instrument fascia",[(y-.055,w*.94,z+.12,z+.63),(y+.12,w*.88,z+.26,z+.69),
                  (y+.145,w*.81,z+.29,z+.64)],"carbon")):
            center = -.03 if not self.large else -.69
            rings = [[(center-h,yy,a),(center+h,yy,a),(center+h,yy,b),(center-h,yy,b)] for yy,h,a,b in rows]
            self.loft(name,rings,finish)
        # The chartplotter has a separate glass face, pointed toward the seated pilot. Its atlas has a drawn chart.
        displays = ((-.13,.21),(.37,.21)) if self.large else ((.025,.239),)
        for j,(dx,half) in enumerate(displays):
            self.panel("chartplotter bezel",[(x+dx-half-.015,y-.008,z+.143),(x+dx+half+.015,y-.008,z+.143),
                       (x+dx+half+.015,y+.115,z+.237),(x+dx-half-.015,y+.115,z+.237)],(0,0,.018),"rubber")
            self.panel("navigation display",[(x+dx-half,y+.002,z+.142),(x+dx+half,y+.002,z+.142),
                       (x+dx+half,y+.106,z+.222),(x+dx-half,y+.106,z+.222)],(0,0,.008),"sonar" if j else "chart")
        if not self.large:
            for dx in (.40,.55):
                xx,yy,zz=x+dx,y+.043,z+.164
                self.rod("analogue instrument bezel",(xx,yy,zz+.021),(xx,yy,zz-.013),.065,"metal",24)
                self.rod("analogue instrument face",(xx,yy,zz-.012),(xx,yy,zz-.018),.052,"carbon",24)
                for i in range(9):
                    a=math.radians(30+15*i)
                    self.rod("gauge graduation",(xx+.040*math.cos(a),yy+.040*math.sin(a),zz-.020),(xx+.049*math.cos(a),yy+.049*math.sin(a),zz-.020),.0028,"piping",6)
                self.rod("gauge pointer",(xx-.03,yy+.023,zz-.023),(xx+.004,yy-.003,zz-.023),.004,"red",7)
        self.rod("steering column",(x,y,z+.24),(x,y,z+.015),.047,"rubber",14)
        self.bone="steering"
        r=self.model["grip"]
        self.rod("boss",(x,y,z-.035),(x,y,z+.035),.057,"metal",18)
        # A single capped torus avoids seams at the wheel rim.
        p=Part()
        rings=[]
        for i in range(32):
            a=TAU*i/32
            rings.append([p.v((x+(r+.019*math.cos(TAU*j/8))*math.cos(a),
                               y+(r+.019*math.cos(TAU*j/8))*math.sin(a),z+.019*math.sin(TAU*j/8))) for j in range(8)])
        for i in range(32):
            for j in range(8):
                p.face([rings[i][j],rings[i][(j+1)%8],rings[(i+1)%32][(j+1)%8],rings[(i+1)%32][j]],"carbon")
        self.put(p.obj("steering rim"))
        for a in (math.radians(16), math.radians(164), math.radians(270)):
            self.rod("polished steering spoke",(x+math.cos(a)*.045,y+math.sin(a)*.045,z),(x+math.cos(a)*r,y+math.sin(a)*r,z),.014,"metal")
        self.bone="chassis"
        for dx in (-.42,-.34):
            self.rod("throttle lever",(x+dx,y-.035,z+.17),(x+dx,y+.11,z+.12),.016,"metal")
            self.rod("throttle grip",(x+dx-.026,y+.11,z+.12),(x+dx+.026,y+.11,z+.12),.026,"rubber")
        for dx in (.30,.38,.46,.54):
            self.rod("switch",(x+dx,y-.032,z+.115),(x+dx,y-.032,z+.134),.017,"metal")

    def cleat(self,x,y,z):
        for dz in (-.075,.075):
            self.rod("cleat foot",(x,y,z+dz),(x,y+.07,z+dz*.85),.020,"metal")
        self.tube("cleat horns",[(x,y+.092,z-.15),(x,y+.067,z-.06),(x,y+.067,z+.06),(x,y+.092,z+.15)],.023,"metal")

    def hulls(self):
        # Each row is Z, half-breadth of one hull, rocker at keel, top of the hull. The stem keeps its own narrow footprint.
        if self.large:
            stations=[(-8.49,.76,.87,1.18),(-7.78,1.00,.86,1.24),(-7.16,1.07,.81,1.90),(-6.64,1.10,.70,2.25),
                      (-6.20,1.12,.49,2.25),(-5.81,1.13,.24,2.25),(-5.4,1.14,.07,2.25),(-2.2,1.14,0,2.25),(.2,1.13,.02,2.25),(2.8,1.07,.03,2.28),
                      (4.6,.91,.09,2.38),(5.9,.69,.18,2.48),(7.0,.46,.29,2.58),(7.82,.25,.46,2.75),
                      (8.34,.081,.64,2.87),(8.5,.019,1.20,2.93)]
        else:
            stations=[(-4.45,.60,.09,1.31),(-3.9,.67,.03,1.34),(-2.4,.705,0,1.34),
                      (-.7,.710,.0,1.34),(.8,.70,.016,1.34),(2.12,.64,.052,1.38),(3.30,.52,.13,1.48),
                      (4.06,.37,.25,1.61),(4.67,.22,.44,1.75),(5.10,.09,.64,1.89),(5.30,.018,1.02,1.97)]
        sk=self.model["sponsonX"]
        self.stations=stations
        for side in (-1,1):
            rings=[]
            for z,w,k,y in stations:
                d=y-k
                # An inboard chine lifts clear of the tunnel. The hard outside chine throws spray down at the running surface.
                profile=[(-.96,.98),(-.99,.87),(-.94,.62),(-.81,.39),(-.58,.20),(-.16,.025),(0,0),
                         (.22,.045),(.74,.21),(.91,.30),(.94,.35),(.89,.37),(.96,.56),(.984,.62),
                         (.987,.657),(.996,.82),(1,.904),(.98,.965),(.92,.995),(-.88,.91)]
                rake=(.88 if self.large else .54)*max(0,(z-(4.0 if self.large else 2.0))/(4.5 if self.large else 3.3))**2
                rings.append([(side*(sk+a*w),k+b*d,z-rake*(1-b)) for a,b in profile])
            tags=["gel","shell","shell","under","under","under","under","under","under","gel","gel","shell",
                  "shell","stripe","shell","shell","rubber","gel","gel","gel"]
            self.loft("separate molded demi-hull",rings,lambda i,j:tags[j],("gel","shell"))
            # This longitudinal wall sits outboard of the open deck, leaving usable circulation inside.
            rows=[]
            for z,w,k,y in stations:
                rise=(.35 if self.large else .38) * min(1,max(0,(z+(7.1 if self.large else 4.16))/.73)) * min(1,max(.03,((8.50 if self.large else 5.30)-z)/.8))
                a,b=sk+w*.81,sk+w*.981
                yy=y+rise
                rows.append([(side*a,y-.02,z),(side*b,y-.028,z),(side*(b+.004),yy-.035,z),
                             (side*(b-.031*w),yy,z),(side*(a+.021*w),yy,z),(side*a,yy-.034,z)])
            self.loft("sheer and internal bulwark",rows,lambda i,j:"rubber" if j==2 else "gel",("gel","gel"))

    def screw(self, side):
        suffix="" if side>0 else "_starboard"
        x,y,z=self.pivots["propeller"+suffix][0]
        big=self.large
        r=.32 if big else .24
        if big:
            self.rod("shaft",(x,y+.19,z+1.15),(x,y,z-.035),.061,"metal",14)
            self.rod("shaft bracket",(x+.17,y+.57,z+.44),(x,y+.05,z+.31),.060,"under")
            self.rod("rudder stock",(x,y+.74,z-.47),(x,y+.04,z-.47),.064,"metal",10)
            self.panel("spade rudder",[(x-.032,y+.52,z-.41),(x-.032,y+.45,z-.69),(x-.032,y-.19,z-.79),
                                      (x-.032,y-.19,z-.52)],(.064,0,0),"under")
        else:
            self.box("motor bracket",(x-.19,.71,-4.55),(x+.19,1.13,-4.39),"metal",.052)
            self.bone="outboard"+suffix
            self.rod("motor steering yoke",(x,.66,-4.53),(x,1.24,-4.53),.085,"carbon",16)
            for rows,finish in (([(.78,.19,-5.12,-4.55),(.98,.25,-5.22,-4.56),(1.21,.30,-5.30,-4.58),
                                 (1.67,.31,-5.24,-4.56),(1.80,.24,-5.08,-4.59)],"carbon"),
                               ([(.96,.236,-5.196,-4.58),(1.016,.265,-5.242,-4.57)],"stripe")):
                rings=[]
                for yy,w,lo,hi in rows:
                    bevel=.08
                    rings.append([(x-w+bevel,yy,lo),(x+w-bevel,yy,lo),(x+w,yy,lo+bevel),
                                  (x+w,yy,hi-bevel),(x+w-bevel,yy,hi),(x-w+bevel,yy,hi),(x-w,yy,hi-bevel),(x-w,yy,lo+bevel)])
                self.loft("outboard cowling",rings,finish)
            self.box("intake grille",(x-.17,1.33,-5.265),(x+.17,1.55,-5.246),"vent",.018)
            self.box("gear leg",(x-.076,.14,-5.02),(x+.076,.86,-4.74),"carbon",.065)
            self.box("cavitation plate",(x-.23,.427,-5.25),(x+.23,.465,-4.71),"carbon",.018)
            self.rod("gearcase",(x,y,-4.70),(x,y,-5.19),.084,"carbon",12)
            self.panel("skeg",[(x-.021,y,-4.81),(x-.021,y,-5.02),(x-.021,-.15,-5.15),(x-.021,-.08,-4.96)],(.042,0,0),"carbon")
        self.bone="propeller"+suffix
        self.rod("propeller boss",(x,y,z-.093),(x,y,z+.09),r*.26,"bronze" if big else "metal",14)
        for blade in range(4 if big else 3):
            theta=TAU*blade/(4 if big else 3)
            rings=[]
            for radius,chord,skew in ((.13,.13,0),(.50,.48,.09),(.83,.40,.27),(1,.11,.40)):
                a=theta+skew*side
                rings.append([(x+r*(radius*math.cos(a)-t*chord*math.sin(a)),
                               y+r*(radius*math.sin(a)+t*chord*math.cos(a)),z+r*(t*.23+skin))
                               for t,skin in ((-.5,-.035),(.5,-.035),(.5,.035),(-.5,.035))])
            self.loft("pitched screw blade",rings,"bronze" if big else "metal")
        self.bone="chassis"

    def ladder(self):
        x,top,z=self.model["boarding"]["ladder"]
        low=self.model["draft"]-.44
        for xx in (x-.208,x+.208):
            self.tube("boarding ladder rail",[(xx,low,z),(xx,top+.12,z),(xx,top+.20,z+.09),(xx,top+.20,z+.27),(xx,top+.07,z+.31)],.026,"metal",10)
        for i in range(4):
            yy=lerp(low+.03,top-.10,i/3)
            self.rod("ladder tread",(x-.22,yy,z),(x+.22,yy,z),.029,"metal",10)
            self.rod("ladder nonslip",(x-.175,yy,z),(x+.175,yy,z),.036,"rubber",10)

    def railing(self, line, rise, gauges=(.035,.019), posts=None):
        """The control line follows the deck edge. Uprights finish at their rail without running into the deckhouse."""
        for h,r in zip((1,.51),gauges):
            self.tube("continuous guardrail",[(x,y+rise*h,z) for x,y,z in line],r,"metal")
        for x,y,z in line if posts is None else posts:
            self.rod("stanchion",(x,y-.04,z),(x,y+rise-.02,z),gauges[0]*.84,"metal")
            self.rod("stanchion foot",(x,y-.005,z),(x,y+.024,z),gauges[0]*1.62,"metal")

    def sport(self):
        self.slab("tunnel bridge and cockpit sole",[
            (-4.47,.84,1.17,.13),(-4.23,1.49,1.32,.28),(-3.86,1.62,1.34,.30),
            (1.61,1.58,1.34,.30),(2.71,1.54,1.44,.32),(3.62,1.48,1.55,.30),(4.02,1.37,1.60,.26)],
            "gel","teak")
        self.box("aft boarding step",(-.24,1.015,-4.63),(.52,1.083,-4.24),"teak",.026)
        self.box("boarding intermediate step",(-.24,1.14,-4.43),(.52,1.21,-4.12),"gel",.03)
        for side in (-1,1):
            for z in (-3.98,.84,4.45):
                if z>4: x,y=1.52,2.05
                elif z>0:x,y=1.96,1.72
                else:x,y=1.92,1.40
                self.cleat(side*x,y,z)
            # Aft grab handles and tapered bow rails suit an open sport boat.
            self.railing([(side*1.96,1.68,-3.63),(side*1.99,1.72,-2.84),(side*1.99,1.72,-1.91)],.23,(.026,.014))
            self.railing([(side*1.99,1.72,1.13),(side*1.95,1.75,2.09),(side*1.79,1.84,3.56),
                           (side*1.52,2.00,4.53),(side*1.39,2.00,4.90)],.27,(.027,.014))
            self.box("navigation housing",(side*1.947-.046,1.712,1.21),(side*1.947+.046,1.797,1.43),"carbon",.022)
            self.box("navigation lens",(side*1.958-.036,1.744,1.32),(side*1.958+.036,1.793,1.47),"red" if side>0 else "green",.019)
            # Individual reclined bow lounges have sculpted, tapered topper panels and separate head cushions.
            x=side*1.11
            for i in range(3):
                ay=1.68 + .032*i
                self.box("bow lounge quilting",(x-.34,ay-.12,2.05+i*.49),(x+.34,ay,2.51+i*.49),"seat",.066,4)
            self.box("bow lounge bolster",(x-.34,1.67,2.01),(x+.34,1.93,2.22),"piping",.075,4)
            self.tube("bow lounge handhold",[(x+side*.42,1.62,2.05),(x+side*.42,1.74,2.18),
                      (x+side*.42,1.77,3.20),(x+side*.42,1.69,3.34)],.023,"metal")
            # Two short dark cabin lights occupy the outboard shoulder beneath the sport cockpit.
            for az,bz,width in ((-2.53,-1.47,.705),(-1.35,-.72,.710)):
                near = side*(1.35+width*.993+.012)
                self.panel("tapered hull light",[(near,1.018,az+.12),(near,.988,bz-.17),
                           (near,1.117,bz),(near,1.131,az)],(side*.010,0,0),"rubber","glass")
            # Four inclined T-top legs grow outboard of the pilot's field of view.
            self.bone="canopy"
            self.panel("tapered tower cheek",[(side*1.20,1.61,-1.62),(side*1.20,1.57,-1.38),
                       (side*1.02,3.49,-.82),(side*1.02,3.49,-1.09)],(side*.085,0,0),"carbon")
            self.tube("aft swept T-top leg",[(side*1.24,1.34,-1.67),(side*1.20,1.99,-1.53),(side*1.01,3.46,-.96)],.056,"carbon",12)
            self.tube("forward swept T-top leg",[(side*1.27,1.34,1.20),(side*1.24,2.18,1.08),(side*1.04,3.47,.62)],.056,"carbon",12)
            self.bone="chassis"
            self.tube("side brace",[(side*1.2,1.98,-1.53),(side*1.02,3.34,-.06),(side*1.04,3.45,.62)],.031,"metal")
            self.tube("windscreen quarter frame",[(side*1.22,2.20,.83),(side*1.21,2.44,.75),(side*1.19,2.54,.57)],.024,"metal")
            self.panel("smoked windscreen quarter",[(side*1.18,2.21,.61),(side*1.18,2.21,1.10),
                       (side*1.18,2.56,.85),(side*1.18,2.49,.48)],(side*.015,0,0),"glass")
        self.slab("hardtop carbon underside",[(-1.84,1.06,3.55,.10),(-1.60,1.30,3.59,.13),
                  (-.85,1.34,3.61,.14),(.75,1.31,3.62,.11),(1.47,1.20,3.58,.085),(1.58,1.00,3.56,.065)],"carbon")
        self.slab("formed sport hardtop",[(-1.76,1.06,3.57,.062),(-1.51,1.275,3.63,.078),
                  (-.69,1.31,3.68,.077),(.73,1.27,3.67,.068),(1.46,1.15,3.60,.062),(1.53,1.0,3.573,.05)],"gel")
        for x in (-.54,.54):
            self.box("hardtop vent glass",(x-.29,3.639,-.87),(x+.29,3.681,-.17),"glass",.020,3)
        # The main windshield has a clear opening for the helm at every LOD. Smoked lower and upper frit follow the frame.
        self.panel("smoked screen bottom",[(-1.18,2.22,1.13),(1.18,2.22,1.13),(1.16,2.35,1.01),(-1.16,2.35,1.01)],(0,0,.014),"glass")
        self.tube("screen brow",[(-1.20,2.43,.78),(-1.17,2.46,.91),(-.93,2.47,.96),(.93,2.47,.96),
                  (1.17,2.46,.91),(1.20,2.43,.78)],.021,"metal")
        for x in (-1.18,1.18):
            self.rod("screen upright",(x,2.22,1.13),(x*.99,2.46,.91),.022,"metal")
        self.rod("central screen seam",(0,2.26,1.095),(0,2.47,.96),.010,"rubber")
        for j,(x,y,z) in enumerate(self.model["seats"]):
            self.seat(x,y,z,.69 if j<2 else .91,j<2)
        self.box("aft bench storage",(-1.5,1.335,-3.16),(1.5,1.70,-2.57),"gel",.095,3)
        self.box("aft bench centre bolster",(-.25,1.67,-3.17),(.25,2.13,-2.97),"piping",.070,3)
        for x in (-1.21,1.21):
            self.box("aft bench side return",(x-.12,1.68,-3.1),(x+.12,1.94,-2.48),"seat",.081,3)
        self.rod("cockpit table column",(0,1.34,-1.77),(0,1.96,-1.77),.061,"metal",12)
        self.oval("cockpit table",0,2.02,-1.77,.73,.36,.073,"teak")
        self.box("foredeck anchor hatch",(-.37,1.52,3.22),(.37,1.57,3.64),"gel",.019)
        self.rod("anchor hatch handle",(-.06,1.577,3.41),(.06,1.577,3.41),.013,"metal")

    def cabin(self):
        # A rising, raked front and tumblehome at the roof give the deckhouse a different silhouette from its broad base.
        # All eight cut corners carry glass, with the frames fitted to the same station lines.
        sections=[(2.25,2.87,-4.69,3.70,.46),(2.79,2.92,-4.63,3.60,.53),
                  (2.91,2.95,-4.60,3.56,.55),(3.05,2.95,-4.57,3.48,.56),
                  (4.11,2.71,-4.43,2.58,.64),(4.24,2.69,-4.40,2.52,.62),
                  (4.33,2.69,-4.42,2.54,.64)]
        def ring(row):
            y,w,a,b,c=row
            return [(-w+c,y,a),(w-c,y,a),(w,y,a+c),(w,y,b-c),(w-c,y,b),(-w+c,y,b),(-w,y,b-c),(-w,y,a+c)]
        rings=[ring(row) for row in sections]
        self.loft("panoramic bridge-deck saloon",rings,lambda i,k:("gel","gel","carbon","glass","carbon","gel")[i],("gel","gel"))
        for i in range(8):
            self.rod("glazing corner frame",rings[2][i],rings[5][i],.046,"carbon")
        for side in (-1,1):
            for lowZ,highZ in ((-2.6,-2.85),(-.64,-.95),(.97,.60)):
                self.rod("salon window mullion",(side*2.957,2.92,lowZ),(side*2.718,4.10,highZ),.037,"carbon",10)
            # Substantial back-swept coachroof cheek and lower reveal, visible from the dock.
            self.panel("aft reverse sheer pillar",[(side*2.934,2.86,-4.01),(side*2.94,2.87,-3.56),
                       (side*2.70,4.27,-4.03),(side*2.70,4.27,-4.42)],(side*.058,0,0),"gel")
            self.panel("forward windshield post",[(side*2.94,2.90,2.80),(side*2.93,2.90,3.00),
                       (side*2.705,4.15,1.95),(side*2.71,4.15,1.81)],(side*.055,0,0),"gel")
        for x in (-1.32,0,1.32):
            self.rod("raked front post",(x,2.92,3.576),(x,4.13,2.57),.034,"carbon")
        for x in (-1.53,0,1.53):
            self.rod("salon aft slider frame",(x,2.78,-4.647),(x,4.20,-4.419),.031,"metal")
        for x in (-.09,.09):
            self.rod("aft salon door pull",(x,3.00,-4.648),(x,3.43,-4.584),.021,"metal")
        self.slab("salon roof shadow line",[(-6.01,2.44,4.34,.105),(-5.75,3.05,4.35,.12),(-4.64,3.18,4.39,.13),
                      (1.51,3.18,4.40,.13),(2.94,2.97,4.41,.12),(3.59,2.44,4.38,.09)],"carbon")
        self.slab("flybridge floor and aft cockpit overhang",[(-6.02,2.46,4.43,.14),(-5.74,3.06,4.49,.15),
                      (-4.65,3.19,4.51,.15),(1.51,3.19,4.51,.15),(2.93,2.96,4.51,.14),(3.59,2.44,4.47,.12)],"gel","teak")
        for side in (-1,1):
            self.tube("aft cockpit roof pillar",[(side*2.74,2.24,-5.76),(side*2.72,2.93,-5.71),(side*2.52,4.36,-5.44)],.071,"metal",12)

    def yacht(self):
        self.slab("high tunnel and bridge main deck",[(-6.96,2.47,2.22,.43),(-6.70,3.33,2.25,.50),
                  (-4.38,3.42,2.25,.50),(2.61,3.42,2.25,.50),(4.61,3.26,2.35,.51),(5.94,2.97,2.47,.51),
                  (6.69,2.64,2.53,.48)],"gel","teak")
        self.cabin()
        for s in (-1,1):
            # Each hull has its own aft steps down to its own low swimming platform.
            for j in range(5):
                z=-8.49+j*.36
                y=1.18+j*.2675
                x=s*2.64
                self.box("molded stern stair",(x-.72,y-.18,z),(x+.72,y,z+.62),"gel",.053,3)
                self.box("teak stair tread",(x-.66,y-.006,z+.038),(x+.66,y+.021,z+.38),"teak",.013)
            # Long, narrow smoked hull lights taper toward their forward ends.
            for z1,z2,w,y,slant in ((-5.74,-3.54,1.14,1.73,.18),(-3.39,.92,1.14,1.75,.24),(1.07,3.72,1.035,1.8,.33)):
                def side_x(zz,yy):
                    for a,b in zip(self.stations,self.stations[1:]):
                        if a[0]<=zz<=b[0]:
                            q=(zz-a[0])/(b[0]-a[0])
                            ww=lerp(a[1],b[1],q)
                            h=lerp(a[3],b[3],q)
                            k=lerp(a[2],b[2],q)
                            f=(yy-k)/(h-k)
                            profile=[(.56,.96),(.62,.984),(.657,.987),(.82,.996),(.904,1)]
                            for (a0,a1),(b0,b1) in zip(profile,profile[1:]):
                                if f<=b0:
                                    return s*(2.60+ww*lerp(a1,b1,max(0,(f-a0)/(b0-a0)))+.010)
                            return s*(2.6+ww+.010)
                # Advance the glazing in short sidewall sections so the forward pane follows the narrowing bow.
                def row(zz,lower,upper):
                    return [(side_x(zz,lower),lower,zz),(side_x(zz,upper),upper,zz)]
                for j in range(3):
                    a=lerp(z1,z2,j/3)
                    b=lerp(z1,z2,(j+1)/3)-.01
                    l0,h0=row(a,y-.16+(slant if j==0 else 0)*.65,y+.13)
                    l1,h1=row(b,y-.16+(slant if j==2 else 0)*.70,y+.13)
                    self.panel("long hull portlight",[l0,l1,h1,h0],(s*.022,0,0),"carbon","glass")
            line=[(s*3.55,2.43,-6.64),(s*3.63,2.58,-5.47),(s*3.65,2.60,-3.45),(s*3.63,2.60,-1.40),
                  (s*3.60,2.60,.74),(s*3.55,2.61,2.72),(s*3.41,2.73,4.59),(s*3.15,2.86,6.15),
                  (s*2.87,2.95,7.48),(s*2.67,2.96,8.19)]
            self.railing(line,.58,(.038,.022))
            for x,y,z in (line[0],line[4],line[-2]):
                self.cleat(x-s*.10,y,z)
            for n in range(3):
                x=s*1.72
                self.box("foredeck recliner cushion",(x-.49,2.47,5.44+n*.42),(x+.49,2.63+n*.015,5.83+n*.42),"piping",.074,3)
            self.box("foredeck sunbed plinth",(s*1.72-.53,2.32,5.36),(s*1.72+.53,2.49,6.64),"gel",.088,3)
            for xx in (s*.77,s*2.49):
                self.tube("foredeck daybed handrail",[(xx,2.38,4.77),(xx,2.75,4.90),(xx,2.78,5.44),
                          (xx,2.53,5.58)],.029,"metal")
            self.bone="canopy"
            for z in (-4.76,1.43):
                self.tube("flybridge canopy strut",[(s*2.50,4.48,z),(s*2.46,5.27,z+.10),(s*2.19,6.58,z+.51)],.070,"carbon",12)
            self.panel("aft flybridge canopy cheek",[(s*2.50,4.50,-4.88),(s*2.50,4.50,-4.53),
                       (s*2.18,6.62,-3.92),(s*2.18,6.62,-4.20)],(s*.09,0,0),"gel")
            self.bone="chassis"
            self.railing([(s*2.86,4.46,-4.99),(s*2.99,4.48,-4.01),(s*2.99,4.48,-2.02),
                          (s*2.99,4.48,-.22),(s*2.90,4.48,1.41)],.70,(.035,.018))
            self.panel("flybridge quarter windscreen",[(s*2.86,4.48,.74),(s*2.79,4.48,2.45),
                       (s*2.66,5.39,2.02),(s*2.73,5.31,1.00)],(s*.02,0,0),"glass")
        # A low forward spray screen leaves the elevated sightline clear, including at palette-only LODs.
        self.panel("smoked flying bridge windshield",[(-2.78,4.50,2.49),(2.78,4.50,2.49),
                   (2.59,5.31,2.14),(-2.59,5.31,2.14)],(0,0,.034),"glass")
        self.tube("windscreen bright cap",[(-2.68,5.36,1.98),(-2.54,5.34,2.16),(-2.17,5.34,2.19),
                  (2.17,5.34,2.19),(2.54,5.34,2.16),(2.68,5.36,1.98)],.030,"metal")
        self.slab("flybridge hardtop liner",[(-4.25,2.19,6.60,.12),(-3.88,2.63,6.63,.14),
                  (1.28,2.62,6.65,.13),(2.04,2.48,6.63,.1),(2.27,2.18,6.59,.07)],"carbon")
        self.slab("floating flybridge hardtop",[(-4.27,2.17,6.67,.11),(-3.85,2.64,6.73,.13),
                  (-1.23,2.67,6.79,.16),(1.26,2.63,6.75,.13),(2.05,2.49,6.69,.10),(2.29,2.17,6.63,.08)],"gel")
        self.oval("radar foot",0,6.83,-2.81,.20,.20,.06,"carbon",18)
        self.oval("low profile radome",0,7.02,-2.81,.42,.39,.22,"gel",32)
        self.oval("radome belt",0,6.90,-2.81,.418,.389,.038,"carbon",32)
        for i,(x,y,z) in enumerate(self.model["seats"]):
            self.seat(x,y,z,.7 if i<2 else .80 if i<4 else 1.03,i<2)
        self.box("aft cockpit settee",(-2.04,2.24,-6.49),(2.04,2.59,-5.91),"gel",.13,3)
        for x in (-1.61,1.61):
            self.seat(x,2.77,-6.07,.89)
        self.rod("aft cockpit table post",(0,2.26,-5.23),(0,2.98,-5.23),.089,"metal",14)
        self.oval("aft cockpit table",0,3.05,-5.23,1.21,.48,.083,"teak")
        # Upper deck dining to port, wet bar to starboard. Leave space for both the steps and the helm seat.
        self.rod("flybridge table post",(1.39,4.50,-1.07),(1.39,5.19,-1.07),.072,"metal",14)
        self.oval("flybridge table",1.39,5.25,-1.07,.77,.45,.083,"teak")
        self.box("flybridge bar",(-2.39,4.50,-3.11),(-1.39,5.36,-1.44),"gel",.09,3)
        self.box("bar counter",(-2.43,5.33,-3.17),(-1.35,5.42,-1.40),"carbon",.044,3)
        self.oval("sink rim",-1.88,5.423,-2.58,.27,.33,.022,"metal")
        self.oval("sink bowl",-1.88,5.426,-2.58,.237,.298,.015,"carbon")
        self.tube("gooseneck tap",[(-2.19,5.415,-2.6),(-2.19,5.71,-2.6),(-2.14,5.76,-2.6),(-2.05,5.76,-2.6),(-2.01,5.69,-2.6)],.021,"metal")
        for z in (-2.8,-1.89):
            self.box("bar locker seam",(-1.392,4.63,z-.31),(-1.374,5.23,z+.31),"teak",.009)
            self.rod("locker handle",(-1.35,5.14,z-.08),(-1.35,5.14,z+.08),.016,"metal")
        # A straight exterior stair from the cockpit to the stern opening in the flybridge guardrails.
        for j in range(9):
            y=2.47+j*.241
            z=-6.82+j*.153
            self.box("teak flybridge stair",(-2.54,y-.087,z),(-1.83,y,z+.22),"teak",.022)
        for x in (-2.57,-1.80):
            self.rod("stair stringer",(x,2.29,-6.83),(x,4.43,-5.47),.055,"gel")
            self.tube("stair handrail",[(x,2.33,-6.81),(x,3.17,-6.79),(x,5.15,-5.53),(x,5.15,-5.19),(x,4.47,-5.12)],.039,"metal",9)
        self.railing([(-1.64,4.42,-5.79),(.10,4.42,-5.83),(1.90,4.42,-5.83),(2.72,4.44,-5.57)],.69,(.035,.021))
        self.oval("foredeck cocktail table",0,2.88,5.44,.50,.40,.065,"teak")
        self.rod("foredeck table pedestal",(0,2.41,5.44),(0,2.85,5.44),.065,"metal")

    def assemble(self):
        arm = bpy.data.armatures.new(self.name)
        rig = bpy.data.objects.new(self.name,arm)
        bpy.context.scene.collection.objects.link(rig)
        bpy.context.view_layer.objects.active=rig
        bpy.ops.object.mode_set(mode="EDIT")
        for name,((x,y,z),parent) in self.pivots.items():
            b=arm.edit_bones.new(name)
            b.head=(x,-z,y)
            b.tail=(x,-z,y+.10)
            if parent:
                b.parent=arm.edit_bones[parent]
        bpy.ops.object.mode_set(mode="OBJECT")
        material=bpy.data.materials.new("yacht")
        for bone,objects in self.groups.items():
            for obj in objects:
                mesh=obj.data
                bm=bmesh.new()
                bm.from_mesh(mesh)
                bmesh.ops.dissolve_limit(bm,angle_limit=.001,verts=bm.verts[:],edges=bm.edges[:],delimit={"MATERIAL"},use_dissolve_boundaries=False)
                bmesh.ops.triangulate(bm,faces=bm.faces[:],quad_method="BEAUTY",ngon_method="BEAUTY")
                bm.to_mesh(mesh)
                bm.free()
                mesh.update()
                tags=[m.name.removeprefix("t_") for m in mesh.materials]
                uv=mesh.uv_layers.new(name="marine finish").data
                coords=[[v.co[k] for v in mesh.vertices] for k in range(3)]
                low=[min(c) for c in coords]
                span=[max(c)-min(c) for c in coords]
                for f in mesh.polygons:
                    tag=tags[f.material_index]
                    col,row=SWATCH["screen" if tag in CHARTS else tag]
                    x0,y0,xsize,ysize=CHARTS.get(tag,(.045,.045,.91,.91))
                    d=max(range(3),key=lambda i:abs(f.normal[i]))
                    # A chart on a side panel runs fore-and-aft and upright. On deck the teak runs the length of the vessel.
                    a,b=[(2,1),(0,2),(0,1)][d]
                    uvs=[]
                    for i in f.loop_indices:
                        co=mesh.vertices[mesh.loops[i].vertex_index].co
                        u=(co[a]-low[a])/max(.0001,span[a])
                        v=(co[b]-low[b])/max(.0001,span[b])
                        if f.normal[d] < 0:
                            u=1-u
                        uvs.append(((col+x0+xsize*u)/4,1-(row+y0+ysize*(1-v))/4))
                    (u0,v0),(u1,v1),(u2,v2)=[(round(u*65535),round(v*65535)) for u,v in uvs]
                    if abs((u1-u0)*(v2-v0)-(v1-v0)*(u2-u0)) < 12:
                        u,v=uvs[0]
                        uvs=[(u,v),(u+.00045,v),(u,v+.00045)]
                    for i,st in zip(f.loop_indices,uvs):
                        uv[i].uv=st
                    f.use_smooth=True
                mesh.set_sharp_from_angle(angle=math.radians(36))
                mesh.materials.clear()
                mesh.materials.append(material)
                for f in mesh.polygons:
                    f.material_index=0
                mesh.transform(E2B)
            bpy.ops.object.select_all(action="DESELECT")
            for obj in objects:
                obj.select_set(True)
            bpy.context.view_layer.objects.active=objects[0]
            bpy.ops.object.join()
            obj=bpy.context.view_layer.objects.active
            obj.name=bone
            obj.vertex_groups.new(name=bone).add(list(range(len(obj.data.vertices))),1,"REPLACE")
            obj.parent=rig
            obj.modifiers.new("Rigid joint","ARMATURE").object=rig


def build(name):
    yard=Yard(name)
    yard.hulls()
    if yard.large:
        yard.yacht()
    else:
        yard.sport()
    yard.helm()
    yard.ladder()
    for side in (-1,1):
        yard.screw(side)
    yard.assemble()
