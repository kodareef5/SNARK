"""Light, folded aluminium punt with a raked square bow, pressed floor, two thwarts and a small side console."""
from shipyard import samples, section
from drive import drive, ladder


def skiff(g):
    table=[(-1.73,.725,.562,.015),(-1.42,.760,.575,.004),(-.88,.796,.587,0),
           (.62,.81,.601,.008),(1.05,.799,.606,.030),(1.43,.766,.617,.103),
           (1.86,.681,.636,.292),(2.09,.621,.653,.467),(2.20,.581,.658,.574)]
    zs=sorted(set([r[0] for r in table]+samples(-1.73,2.20,22)))
    def row(z):
        w,h,k=section(table,z)
        return [(x,y,z) for x,y in ((0,k),(.78*w,k),(.825*w,k+.014),(.939*w,h-.20*(h-k)),(w,h-.022),(w,h),
                            (.955*w,h),(.905*w,h-.11*(h-k)),(.796*w,k+.047),(.74*w,k+.048),
                            (0,k+.048),(-.74*w,k+.048),(-.796*w,k+.047),(-.905*w,h-.11*(h-k)),
                            (-.955*w,h),(-w,h),(-w,h-.022),(-.939*w,h-.20*(h-k)),(-.825*w,k+.014),(-.78*w,k))]
    tags=("aluminium","aluminium","aluminium","gel","aluminium","aluminium","olive","olive","aluminium","olive")
    g.loft("pressed hull sheet", [row(z) for z in zs],lambda i,j:tags[j if j<10 else 19-j],"olive")
    for s in (-1,1):
        g.tube("rolled gunwale",[(s*section(table,z)[0],section(table,z)[1],z) for z in zs],.023,"aluminium",10)
        g.tube("outside rub bead",[(s*section(table,z)[0]*.944,section(table,z)[1]-.18*(section(table,z)[1]-section(table,z)[2]),z) for z in zs],.012,"aluminium",8)
    # Folded rib frames stiffen the bottom and angled side plates.
    for z in (-1.52,-1.10,-.21,.18,.94,1.40,1.79):
        w,h,k=section(table,z)
        for s in (-1,1):
            g.tube("formed rib",[(s*.012,k+.055,z),(s*w*.75,k+.056,z),(s*w*.81,k+.075,z),
                                 (s*w*.887,h-.135,z),(s*w*.924,h-.050,z)],.022,"aluminium",6)
    for x in (-.42,-.21,0,.21,.42):
        rows=[]
        for z in samples(-1.67,1.93,20):
            w,h,k=section(table,z)
            rows.append([(x+dx,k+dy,z) for dx,dy in ((-.029,.045),(-.016,.067),(.016,.067),(.029,.045))])
        g.loft("longitudinal pressed corrugation",rows,"olive")
    # Flat bow shelf and reinforced full-width transom with timber on the motor clamp face.
    g.loft("bow flotation shelf", [[(-w,.49,z),(-w,.625,z),(w,.625,z),(w,.49,z)]
                                   for z,w in ((1.31,.69),(1.68,.635),(2.08,.555))],"gel")
    g.hatch("storage flap",0,1.67,.627,.70,.44,"olive")
    g.loft("transom board", [[(-.57,.055,z),(.57,.055,z),(.714,.528,z),(-.714,.528,z)] for z in (-1.738,-1.698)],"olive")
    g.box("clamping board",(0,.486,-1.719),(.48,.221,.074),"teak",.019)
    for s in (-1,1):
        g.loft("transom corner gusset", [[(s*.443,h,-1.695),(s*.695,h,-1.695),(s*.723,h,-1.35)] for h in (.52,.55)],"aluminium")
        g.tube("lifting loop",[(s*.49,.605,1.96),(s*.46,.715,1.96),(s*.31,.715,1.96),(s*.28,.605,1.96)],.013,"aluminium")
    for i,(_,y,z) in enumerate(g.d.seats):
        w=section(table,z)[0]
        g.loft("bench flotation box", [[(-w*.746,y-.40,zz),(-w*.872,y-.075,zz),(w*.872,y-.075,zz),(w*.746,y-.40,zz)]
                                       for zz in (z-.18,z+.17)],"olive")
        g.box("rolled metal thwart",(0,y-.037,z),(w*1.84,.072,.421),"gel",.032,3)
        for s in (-1,1):
            g.box("pressed bench cap",(s*w*.89,y-.018,z),(.035,.059,.432),"aluminium",.016)
        for s in (-1,1):
            for dz in (-.16,.16):
                g.rod("bench rivet",(s*w*.81,y-.012,z+dz),(s*w*.81,y+.001,z+dz),.012,"chrome",8)
    # The side console spans only the steering seat. There is a clear passage along starboard.
    g.loft("folded side console", [[(.10,.49,z),(.14,y,z),(.21,y+.028,z),(.61,y+.028,z),(.67,y-.047,z),(.67,.49,z)]
                                   for z,y in ((-.083,.906),(.14,1.025),(.23,.944))],"gel")
    g.box("switch plate",(.38,.881,-.086),(.41,.144,.025),"graphite",.012)
    g.gauge(.40,.882,-.102,.055)
    for x in (.245,.526):
        g.rod("ignition switch",(x,.88,-.109),(x,.88,-.092),.025,"steel")
    g.tube("console handrail",[(.125,.90,.125),(.125,1.091,.122),(.175,1.14,.13),(.59,1.14,.13),
                                (.63,1.091,.134),(.63,.947,.15)],.015,"aluminium")
    g.wheel(-.048)
    g.box("side remote",(.655,.67,-.51),(.101,.19,.235),"engine",.032)
    g.rod("shift arm",(.647,.724,-.52),(.647,.821,-.419),.014,"chrome")
    g.box("shift grip",(.647,.826,-.414),(.049,.04,.081),"grip",.017)
    # Removable red fuel tank and hose below the transom cap.
    g.box("portable fuel can",(-.37,.207,-1.29),(.33,.24,.41),"throttle",.037,3)
    g.box("tank handle",(-.37,.344,-1.24),(.124,.039,.067),"rubber",.015)
    g.tube("fuel line",[(-.30,.302,-1.45),(-.24,.22,-1.60),(-.09,.338,-1.69),(-.06,.58,-1.81)],.009,"rubber",6)
    drive(g,outboard=True)
    a=g.d.boarding["ladder"]
    ladder(g,a[0],a[2],a[1],.085,.23)
