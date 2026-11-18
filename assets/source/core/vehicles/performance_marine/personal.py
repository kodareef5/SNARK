"""Two-up personal watercraft. The footwells, central seat pedestal and rising nose cowl share one moulding."""
import math
from shipyard import Part, mix, samples, section


def personal(g):
    # At each station: width above the chine, keel height, chine, rubrail, deck edge, footwell, saddle/hood width and top.
    table=[(-1.49,.433,.085,.202,.312,.369,.358,.17,.366),(-1.44,.508,.065,.193,.335,.383,.368,.185,.377),
           (-1.36,.548,.036,.184,.345,.403,.381,.22,.404),(-1.17,.574,.018,.183,.356,.426,.376,.247,.535),
           (-.89,.586,.008,.183,.362,.454,.347,.256,.634),(-.43,.604,0,.187,.374,.472,.337,.214,.634),
           (.04,.609,.012,.193,.388,.513,.352,.192,.645),(.34,.60,.035,.21,.421,.569,.408,.237,.805),
           (.64,.574,.065,.244,.457,.608,.547,.269,.857),(.94,.512,.119,.293,.499,.622,.590,.244,.787),
           (1.22,.421,.217,.365,.541,.628,.615,.193,.716),(1.44,.279,.34,.447,.573,.631,.625,.131,.674),
           (1.60,.106,.505,.557,.611,.634,.638,.062,.65),(1.65,.022,.588,.601,.622,.634,.639,.012,.643)]
    zs=sorted(set([r[0] for r in table]+samples(-1.49,1.65,33)))
    def row(z):
        w,k,c,h,r,foot,central,top=section(table,z)
        def spine(s):
            rack=[(.39*w,mix(k,c,.36)),(.69*w,mix(k,c,.72)),(.74*w,mix(k,c,.70)),(.91*w,c),(.97*w,h-.038),
                  (w,h-.022),(w,h),(w*.975,h+.021),(w*.954,r),(.88*w,r+.014),(.814*w,foot+.012),
                  (central+.055,foot),(central,foot+.073*(top-foot)),(central*.965,mix(foot,top,.68)),
                  (central*.811,mix(foot,top,.91)),(central*.558,top-.005),(central*.39,top),(central*.19,top+.005)]
            return [(s*x,y,z) for x,y in rack]
        return [(0,k,z)]+spine(1)+[(0,top+.009,z)]+list(reversed(spine(-1)))
    rings=[row(z) for z in zs]
    def tag(i,j):
        k=j if j<len(rings[0])//2 else len(rings[0])-1-j
        z=(zs[i]+zs[i+1])/2
        if k<=4:return "graphite"
        if k==5:return "gel"
        if k in (6,7):return "rubber"
        if k<10:return "gel" if z>-.98 else "graphite"
        if k<13:return "tread" if z<.53 else ("pearl" if k==12 else "gel")
        if k==13:return "graphite"
        if k<16:return "pearl" if z>.13 else "graphite"
        if k==16:return "citron" if z>.24 else "rubber"
        return "carbon"
    g.loft("chined hull and moulded rider tub",rings,tag,"graphite")
    platform=[]
    for z,w,b,h in ((-1.65,.365,.315,.363),(-1.60,.449,.308,.375),(-1.50,.502,.313,.380),(-1.39,.513,.331,.388)):
        platform.append([(w*f,y,z) for f,y in ((-.92,b),(-1,b+.020),(-.97,h),(-.82,h+.006),
                                                (.82,h+.006),(.97,h),(1,b+.020),(.92,b))])
    g.loft("cantilevered reboarding deck",platform,lambda i,k:"tread" if k in (2,3,4) else "graphite","graphite")
    for s in (-1,1):
        # Fixed traction ridges follow each foot tray and open onto the stern.
        for j in range(12):
            z=-1.16+j*.113
            w,k,c,h,r,foot,central,top=section(table,z)
            g.rod("footwell tread chevron",(s*(central+.073),foot+.009,z+.014),
                  (s*(w*.785),foot+.020,z-.021),.010,"slate",8)
        for j in range(5):
            g.rod("reboarding platform ridge",(s*.065,.367+j*.004,-1.56+j*.055),(s*.444,.372+j*.006,-1.56+j*.055),.009,"tread",8)
        # The pillion sits higher. Its footrest rises over the main tray, with a shallow fall
        # outboard to accommodate the longer, more widely braced boots.
        support=[]
        for z,height,width in ((-.82,.392,.128),(-.73,.463,.158),(-.60,.505,.185),(-.43,.505,.19),(-.32,.488,.173),(-.25,.374,.144)):
            w,k,c,h,r,foot,central,top=section(table,z)
            inner=central+.023
            support.append([(s*inner,foot+.004,z),(s*inner,height,z),
                            (s*(inner+.038),height+.002,z),(s*(inner+width-.018),height-.033,z),
                            (s*(inner+width),height-.047,z),(s*(inner+width),foot+.004,z)])
        g.loft("raised pillion footboard",support,lambda i,k:"tread" if k in (1,2,3) else "graphite","graphite")
        for z in (-.61,-.55,-.49,-.43,-.37):
            w,k,c,h,r,foot,central,top=section(table,z)
            g.rod("pillion board traction rib",(s*(central+.061),.507,z),(s*(central+.174),.476,z),.008,"slate",8)
        # Hard sponsons step out below the continuous rub rail.
        rows=[]
        for z,w,y in ((-1.36,.522,.242),(-1.23,.560,.226),(-.87,.582,.209),(-.62,.58,.221),(-.52,.545,.253)):
            rows.append([(s*(w-.030),y+.044,z),(s*(w+.020),y+.045,z),(s*(w+.021),y,z),(s*(w-.029),y-.014,z)])
        g.loft("aft sponson",rows,"graphite")
        # Mirrors stalk out of the nose cowl. The inset rear face reads from the actual rider camera.
        g.tube("mirror stalk",[(s*.235,.783,.625),(s*.357,.835,.602),(s*.397,.847,.540)],.023,"carbon")
        rows=[[(s*(.391+dx),.857+dy,zz) for dx,dy in ((-.073,-.025),(-.066,.038),(.018,.059),(.111,.021),(.103,-.022),(.025,-.047))]
              for zz in (.512,.586)]
        g.loft("swept mirror housing",rows,"gel","slate")
        g.box("mirror glass",(s*.414,.863,.509),(.112,.045,.012),"chrome",.005)
        g.tube("rear passenger handle",[(s*.18,.706,-1.09),(s*.265,.747,-1.067),(s*.279,.774,-.94),(s*.256,.786,-.805),
                                      (s*.211,.747,-.762)],.021,"rubber",10)
    # A sculpted rising saddle with a low waist lets two riders straddle it. Distinct cushion skins meet at the step.
    saddle=[(-1.18,.115,.64,.73),(-1.126,.179,.655,.813),(-1.04,.204,.669,.854),(-.80,.211,.682,.87),
            (-.63,.196,.663,.855),(-.54,.188,.659,.826),(-.49,.181,.64,.786),(-.35,.161,.637,.756),
            (-.16,.15,.634,.759),(.013,.140,.652,.792),(.136,.107,.68,.829),(.186,.064,.731,.825)]
    rows=[]
    for z in sorted(set([r[0] for r in saddle]+samples(-1.18,.186,21))):
        w,k,h=section(saddle,z)
        rows.append([(w*f,mix(k,h,y),z) for f,y in ((-.82,0),(-1,.25),(-.96,.61),(-.78,.87),(-.48,.98),(0,1),
                                                       (.48,.98),(.78,.87),(.96,.61),(1,.25),(.82,0))])
    g.loft("stepped two-up saddle",rows,lambda i,k:"citron" if k in (1,8) else ("suede" if k in (4,5) else "rubber"),"rubber")
    # The intake grate lies flush with the V bottom beneath the rear saddle; the jet exhausts well aft of it.
    _,_,intake_z=g.d.jetIntake
    for side in (-1,1):
        rows=[]
        for zz,width in ((intake_z-.31,.061),(intake_z-.246,.114),(intake_z+.215,.104),(intake_z+.31,.055)):
            _,keel,chine,_,_,_,_,_=section(table,zz)
            rows.append([(side*xx,keel+.29*xx+dy,zz) for xx,dy in ((.004,-.013),(width,-.013),(width,.009),(.004,.009))])
        g.loft("intake throat",rows,"intake")
        for dx in (.018,.054,.091):
            z0,z1=intake_z-.225,intake_z+.205
            y0=section(table,z0)[1]+.29*dx-.018
            y1=section(table,z1)[1]+.29*dx-.018
            g.rod("longitudinal intake grate tine",(side*dx,y0,z0),(side*dx,y1,z1),.007,"steel",8)
    g.bone="outboard"
    x,y,z=g.d.outboard
    # Hollow annular jet nozzle. The open bore is visible from the transom and rotates with steering.
    nozzle, p=Part(), []
    for i in range(24):
        a=i*math.tau/24
        p.append([nozzle.v((x+r*math.cos(a),y+r*math.sin(a)+off,zz)) for r,zz,off in ((.105,z+.013,.005),(.114,-1.586,-.018),
                    (.084,-1.588,-.018),(.078,z+.009,.005))])
    for i in range(24):
        for j in range(4):
            nozzle.face((p[i][j],p[(i+1)%24][j],p[(i+1)%24][(j+1)%4],p[i][(j+1)%4]),"steel" if j==1 else "engine")
    g.add(nozzle.obj("vectoring jet nozzle"))
    g.rod("recessed impeller hub",(0,.209,-1.52),(0,.218,-1.41),.032,"steel",12)
    for k in range(5):
        a=k*math.tau/5
        g.rod("impeller stator",(0,.213,-1.49),(.085*math.cos(a),.213+.085*math.sin(a),-1.48),.008,"steel",6)
    g.bone="chassis"
    g.loft("steering pedestal", [[(w*f,h+dy,z) for f,dy in ((-1,-.062),(-.75,.039),(.75,.039),(1,-.062),(.68,-.12),(-.68,-.12))]
                                for z,w,h in ((.19,.122,1.03),(.31,.186,.986),(.52,.216,.885),(.68,.160,.835))],"carbon")
    g.box("instrument hood",(0,1.025,.34),(.309,.098,.158),"graphite",.043,4)
    g.box("digital dash",(0,1.027,.255),(.235,.066,.020),"chart",.009,3)
    x,y,z=g.d.helm
    g.rod("raked column support",(0,.953,.260),(0,1.055,z),.093,"carbon",16,.061)
    g.bone="steering"
    g.rod("steering post",(0,1.046,z),(0,y-.026,z),.048,"engine",16)
    for s in (-1,1):
        g.tube("handlebar",[(0,y-.029,z),(s*.119,y-.028,z+.018),(s*.201,y-.008,z+.024),(s*.256,y,z+.014),
                           (s*g.d.grip,y,z)],.021,"steel",10)
        g.rod("handlebar grip",(s*.248,y,z+.014),(s*.365,y,z-.008),.029,"grip",14)
        g.box("switch pod",(s*.239,y+.010,z+.015),(.054,.072,.075),"graphite",.019)
        g.box("start switch",(s*.237,y+.035,z-.007),(.025,.021,.025),"red" if s>0 else "citron",.006)
        g.tube("trigger",[(s*.241,y-.020,z+.015),(s*.265,y-.046,z+.005),(s*.302,y-.054,z-.021)],.009,"chrome",8)
    g.bone="chassis"
    g.tube("reboarding grab",[(.21,.377,-1.56),(.244,.313,-1.627),(.44,.313,-1.627),(.46,.378,-1.53)],.018,"rubber",10)
