"""A centreline race launch and a broader offshore dayboat. Each hull section folds into its own cockpit well."""
import math
from shipyard import mix, samples, section
from drive import drive, ladder


def bolster(g, x, y, z, sport):
    shell = "carbon" if sport else "midnight"
    cover = "suede" if sport else "vinyl"
    piping = "vermilion" if sport else "tobacco"
    g.box("seat plinth",(x,y-.30,z),(.33,.47,.36),"engine",.060,3)
    g.box("cushion shell",(x,y-.075,z),(.51,.14,.49),shell,.060,3)
    g.box("cushion insert",(x,y-.035,z+.025),(.42,.084,.43),cover,.040,3)
    # Racing shells wrap forward at the rider's flanks. Their central back reclines and narrows at the head.
    rows=[]
    for h,w,wing,recline in ((-.09,.255,.18,0),(.05,.29,.19,0),(.24,.30,.14,.03),(.42,.27,.10,.06),
                              (.57,.21,.06,.085),(.68,.155,.035,.11)):
        a=z-.18-recline
        rows.append([(x-w,y+h,a+wing),(x-w,y+h,a+.018),(x-w*.75,y+h,a-.047),(x+w*.75,y+h,a-.047),
                     (x+w,y+h,a+.018),(x+w,y+h,a+wing),(x+w*.78,y+h,a+wing-.011),
                     (x+w*.68,y+h,a+.045),(x-w*.68,y+h,a+.045),(x-w*.78,y+h,a+wing-.011)])
    g.loft("wraparound bucket shell",rows,lambda i,k: shell if k in (0,1,2,3,4) else (piping if k in (5,9) else cover),shell)
    for side in (-1,1):
        g.loft("raised thigh roll", [[(x+side*w,y+h,z+zz) for w,h in ((.17,-.058),(.25,-.052),(.25,.046),(.22,.075),(.18,.044))]
                                      for zz in (-.14,.16)],cover)
    # Contrasting seam follows the taper of the back, visible above the occupant's shoulders.
    for s in (-1,1):
        g.tube("back piping",[(x+s*.19,y+.13,z-.144),(x+s*.196,y+.29,z-.165),
                              (x+s*.156,y+.48,z-.20),(x+s*.102,y+.61,z-.229)],.010,piping,6)


def offshore(g):
    sport = g.kind == "needle"
    d = g.d
    # z, sheer half-beam, keel, chine rise, gunwale height, half-width of well relative to sheer, deck centre height.
    if sport:
        table = [
            (-4.46,.84,.07,.36,.88,.55,.97),(-4.16,.97,.045,.38,.92,.56,1.02),
            (-3.28,1.055,.015,.40,.95,.56,1.085),(-2.38,1.09,0,.41,.97,.55,1.065),
            (-2.22,1.094,0,.41,.98,.57,.49),(-.02,1.10,.025,.43,1.02,.58,.49),
            (.18,1.092,.04,.45,1.05,.57,1.15),(.54,1.065,.07,.47,1.065,.53,1.18),
            (1.46,.923,.11,.49,1.088,.55,1.202),(2.43,.730,.21,.57,1.11,.55,1.215),
            (3.39,.504,.39,.68,1.13,.55,1.198),(4.26,.275,.65,.82,1.145,.55,1.177),
            (4.78,.092,.88,.99,1.16,.55,1.173),(5,.012,1.084,1.119,1.159,.55,1.165),
        ]
    else:
        table = [
            (-5.87,1.19,.10,.52,1.18,.82,1.27),(-5.44,1.31,.055,.55,1.26,.82,1.37),
            (-4.36,1.405,.017,.57,1.34,.83,1.43),(-3.11,1.438,0,.57,1.37,.84,1.40),
            (-2.82,1.443,0,.57,1.385,.85,.69),(-.18,1.45,.018,.59,1.41,.84,.69),
            (.55,1.439,.04,.60,1.43,.84,.69),(.82,1.422,.055,.62,1.455,.84,1.54),
            (1.60,1.355,.11,.66,1.48,.83,1.6),(2.74,1.17,.22,.74,1.495,.83,1.64),
            (3.86,.93,.38,.84,1.50,.82,1.63),(4.85,.665,.60,.97,1.52,.82,1.61),
            (5.78,.34,.91,1.16,1.54,.82,1.58),(6.38,.062,1.33,1.40,1.55,.82,1.56),(6.5,.014,1.48,1.51,1.55,.82,1.554)
        ]
    def values(z):
        return section(table,z)
    zs=sorted(set([r[0] for r in table]+samples(table[0][0],table[-1][0],49)))
    def hullrow(z):
        w,k,c,h,r,dc = values(z)
        t=(z-table[0][0])/(table[-1][0]-table[0][0])
        line = .36 + (.27 if sport else .11)*math.sin(t*math.pi*1.6-.65)
        band = .20 if sport else .115
        def side(s):
            lower = [(w*.44,mix(k,c,.43)),(w*.80,mix(k,c,.80)),(w*.91,c),(w*.945,c+.02*(h-c)),
                     (w*.968,mix(c,h,line)),(w*.975,mix(c,h,line+band)),(w*.98,mix(c,h,line+band+.035)),
                     (w*.994,h-.07*(h-c)),(w,h-.035*(h-c)),(w*.995,h)]
            edge=w*r
            # Deck shoulders remain broad alongside the cut-out. The underdeck wall and sole are part of this same skin.
            depth = max(0,h-dc)
            upper = [(edge+.10*(w-edge),h+.008),(edge,h+.016),(edge*.98,dc+.028*depth),
                     (edge*.81,mix(dc,h,.014)),(edge*.61,dc+.006),(edge*.49,dc+.009),(edge*.13,dc+.009)]
            return [(s*x,y,z) for x,y in lower+upper]
        return [(0,k,z)]+side(1)+[(0,dc+.012,z)]+list(reversed(side(-1)))
    rings=[hullrow(z) for z in zs]
    def tag(i,j):
        half=(len(rings[0])//2)
        k=j if j<half else len(rings[0])-1-j
        z=(zs[i]+zs[i+1])/2
        in_well=values(z)[-1]<values(z)[3]-.16
        if k<=3: return "pearl" if sport else "midnight"
        if k==4: return "graphite" if sport else "midnight"
        if k==5: return "midnight" if sport else "gel"
        if k==6: return "pearl" if sport else "gold"
        if k==7: return "gel" if sport else "gel"
        if k==8: return "rubber"
        if k in (9,10): return "gel" if sport else "pearl"
        if k==11: return "pearl" if sport else "gold"
        if in_well: return "carbon" if sport else ("teak" if k>=13 else "midnight")
        if sport: return "pearl" if k in (13,15) else ("midnight" if k==14 else "gel")
        return "pearl"
    g.loft("warped V hull and open cockpit",rings,tag,"pearl" if sport else "midnight")
    for s in (-1,1):
        # Two running strakes cast real shadows along each bottom panel.
        for f in (.52,.76):
            rows=[]
            for z in samples(table[0][0]+.045,d.length*.402,28):
                w,k,c,h,_,_=values(z)
                x=w*f
                y=mix(k,c,f/.91)
                rows.append([(s*(x-.047*w),y-.024*w,z),(s*(x+.020*w),y-.042*w,z),
                             (s*(x+.037*w),y+.018*w,z),(s*(x-.042*w),y+.004*w,z)])
            g.loft("lifting strake",rows,"pearl" if sport else "midnight")
        for z in ((-3.81,2.14) if sport else (-5.13,3.12)):
            w,k,c,h,r,dc=values(z)
            g.cleat(s*(w-.060),h+.018,z)
        for z in ((.65,) if sport else (1.11,)):
            w,k,c,h,r,dc=values(z)
            g.box("nav light casing",(s*(w-.055),h+.025,z),(.095,.051,.190),"chrome",.023,3)
            g.box("nav lens",(s*(w-.058),h+.050,z+.019),(.076,.029,.101),"red" if s>0 else "green",.012)
    for seat in (d.seats if sport else d.seats[:2]):
        bolster(g,*seat,sport)
    x,y,z=d.helm
    front=.14 if sport else .63
    dashw=.57 if sport else 1.23
    dashy=1.35 if sport else 1.73
    g.loft("moulded dashboard", [[(-dashw*.90,h,zz),(dashw*.90,h,zz),(dashw,h-.055,zz),(dashw,h-.165,zz),
                               (-dashw,h-.165,zz),(-dashw,h-.055,zz)] for h,zz in ((dashy,front-.16),(dashy+.027,front+.17))],
           "carbon" if sport else "midnight")
    if sport:
        for dx,r in ((-.33,.056),(-.18,.065),(0,.080),(.18,.065),(.33,.056)):
            g.gauge(x+dx,dashy-.065,front-.173,r)
    else:
        g.box("navigation bezel",(x,dashy-.005,front-.18),(.52,.218,.032),"rubber",.015)
        g.box("navigation display",(x,dashy-.001,front-.20),(.472,.17,.011),"chart",.004)
        for dx in (-.41,.41):
            g.gauge(x+dx,dashy-.06,front-.173,.068)
        g.box("port glove box",(-.66,dashy-.087,front-.172),(.73,.14,.031),"vinyl",.014)
        g.box("glove box pull",(-.66,dashy-.09,front-.192),(.125,.025,.027),"chrome",.01)
    g.wheel(front-.115)
    for j in range(1 if sport else 2):
        tx=(.42 if sport else .99)+j*.085
        g.box("throttle binnacle",(tx,y-.095,z+.035),(.081,.10,.21),"carbon",.028)
        g.rod("throttle lever",(tx,y-.054,z+.038),(tx,y+.085,z+.104),.018,"chrome")
        g.rod("throttle knob",(tx-.032,y+.092,z+.108),(tx+.032,y+.092,z+.108),.030,"throttle")
    # Canted, swept wind deflector. Its top edge stays below the pilot's eye line even on the flat tier.
    half=.64 if sport else 1.31
    top=1.50 if sport else 1.87
    low=1.105 if sport else 1.48
    ends=-.73 if sport else -.87
    shape=[(-1,ends,.06),(-.98,ends+.27,.13),(-.89,front+.14,.78),(-.64,front+.29,.96),
           (-.32,front+.34,1), (0,front+.35,1),(.32,front+.34,1),(.64,front+.29,.96),
           (.89,front+.14,.78),(.98,ends+.27,.13),(1,ends,.06)]
    rows=[]
    for f,zz,v in shape:
        h=mix(low,top,v)
        rows.append([(f*half,low,zz),(f*half*.965,h,zz-.17*v),(f*half*.965,h,zz-.17*v-.024),(f*half,low,zz-.024)])
    g.loft("swept acrylic wind deflector",rows,"screen")
    g.tube("windscreen upper blade",[r[1] for r in rows],.016 if sport else .023,"graphite" if sport else "chrome")
    g.tube("windscreen lower seal",[r[0] for r in rows],.022,"rubber")
    if sport:
        # Aft air intake rises from the engine cover behind the second bolster.
        for s in (-1,1):
            rows=[]
            for zz,w,h in ((-4.26,.105,.035),(-4.04,.145,.077),(-3.39,.17,.132),(-2.69,.155,.217),(-2.56,.142,.207)):
                cy=values(zz)[-1]+.017
                rows.append([(s*.405-w,cy,zz),(s*.405-w*.88,cy+h*.72,zz),(s*.405-w*.62,cy+h,zz),
                             (s*.405+w*.72,cy+h,zz),(s*.405+w,cy+h*.78,zz),(s*.405+w,cy,zz)])
            g.loft("ram air scoop",rows,"gel","intake")
            for dx in (-.079,0,.079):
                g.box("scoop intake vane",(s*.405+dx,1.175,-2.552),(.014,.097,.026),"slate",.006)
        g.hatch("foredeck access",0,1.76,1.202,.49,.59,"carbon")
        # Fasteners and separated louvers define the removable engine hatch.
        for s in (-1,1):
            for zz in (-4.02,-3.44,-2.75):
                yy=values(zz)[-1]+.012
                g.rod("quarter-turn hatch fastener",(s*.66,yy-.005,zz),(s*.66,yy+.014,zz),.029,"chrome",12)
                g.box("fastener slot",(s*.66,yy+.016,zz),(.023,.004,.007),"rubber",.001)
            for j in range(4):
                zz=-4.08+j*.12
                yy=values(zz)[-1]+.013
                g.box("engine compartment extractor",(s*.16,yy,zz),(.138,.023,.044),"intake",.01)
        drive(g)
    else:
        # Three individually piped upholstery panels share the full-width wraparound lounge.
        g.box("lounge base",(0,.97,-2.28),(2.39,.48,.69),"midnight",.14,4)
        for j,(x,y,z) in enumerate(d.seats[2:]):
            g.box("aft seat cushion",(x,y-.052,z),(.738,.112,.64),"vinyl",.052,4)
            g.box("aft backrest",(x,y+.21,z-.325),(.744,.50,.16),"vinyl",.073,4)
            g.box("upholstery welt",(x,y+.352,z-.239),(.665,.019,.012),"tobacco",.005)
        for s in (-1,1):
            g.box("side lounge bolster",(s*1.17,1.35,-2.2),(.125,.25,.81),"tobacco",.051,4)
            g.rod("cockpit grab rail",(s*1.19,1.45,-1.78),(s*1.19,1.45,-1.13),.022,"chrome")
        g.box("engine cover gasket",(0,1.43,-4.24),(2.24,.10,2.16),"midnight",.049,3)
        for j in (-1,0,1):
            # The crowned head bolster rises from the bed as one upholstered panel.
            x=j*.70
            rows=[]
            for zz,w,y in ((-5.24,.295,1.514),(-5.15,.337,1.559),(-4.98,.343,1.568),
                           (-3.84,.343,1.573),(-3.63,.344,1.607),(-3.46,.334,1.667),(-3.33,.321,1.681),(-3.23,.287,1.588)):
                rows.append([(x+f*w,h,zz) for f,h in ((-.85,1.462),(-1,1.487),(-.97,y-.031),(-.84,y),
                                                         (-.73,y+.006),(.73,y+.006),(.84,y),(.97,y-.031),(1,1.487),(.85,1.462))])
            g.loft("crowned sun lounge insert",rows,lambda i,k:"vinyl" if k in (3,4,5) else "tobacco","tobacco")
            for s in (-1,1):
                g.tube("sun lounge piping",[(x+s*.278,1.552,-5.13),(x+s*.289,1.570,-4.97),
                                            (x+s*.289,1.576,-3.84),(x+s*.282,1.609,-3.63),(x+s*.278,1.670,-3.46),
                                            (x+s*.261,1.683,-3.33)],.007,"vinyl",6)
        for s in (-1,1):
            path=[]
            for zz in samples(1.65,4.50,15):
                w,k,c,h,r,dc=values(zz)
                path.append((s*(w-.077),h+.115,zz))
            for idx in (0,7,14):
                x,y,z=path[idx]
                g.rod("deck rail stanchion",(x,y-.108,z),(x,y,z),.016,"chrome",8)
            g.tube("low foredeck handrail",path,.018,"chrome")
        # Paired air extractor grilles in the narrow shoulders by the engine bay.
        for s in (-1,1):
            for j in range(5):
                zz=-4.91+j*.16
                w,k,c,h,r,dc=values(zz)
                g.box("hatch extractor",(s*(w-.093),h+.028,zz),(.111,.029,.048),"intake",.014)
        for z in (2.355,3.72):
            h=values(z)[-1]+.023
            g.hatch("foredeck flush skylight",0,z,h,.78 if z<3 else .57,.65,"screen","chrome")
        for s in (-1,1):
            g.box("stern platform",(s*.94,.84,-5.98),(.72,.105,.76),"pearl",.051,3)
            g.box("teak platform insert",(s*.94,.898,-6.01),(.62,.026,.62),"teak",.013)
        drive(g)
        drive(g,True)
    # Flush exhaust and scupper fittings distinguish the transom from the painted topsides.
    transom=table[0][0]
    for s in (-1,1):
        x=s*(.49 if sport else .91)
        y=.67 if sport else .965
        g.rod("wet exhaust flange",(x,y,transom-.017),(x,y,transom+.008),.096,"chrome",20)
        g.rod("wet exhaust aperture",(x,y,transom-.022),(x,y,transom-.014),.068,"rubber",20)
        g.box("scupper rim",(s*.64 if sport else s*1.035,y-.22,transom-.010),(.15,.073,.032),"steel",.013)
        g.box("scupper flap",(s*.64 if sport else s*1.035,y-.22,transom-.028),(.115,.052,.011),"rubber",.005)
    a=d.boarding["ladder"]
    ladder(g,a[0],a[2],a[1],d.draft-.08,.26)
