"""Continuous pleurodire skin, with four limb sockets cut into the torso topology."""
import math
from mathutils import Vector
from mesh import Surface, tube, oval, uvbox
from layout import LEGS, smooth
import shell

SKIN=(.008,.018,.48,.30); NECK=(.008,.337,.48,.28); HEAD=(.008,.646,.48,.337)
PAD=(.51,.025,.26,.27); CLAW=(.795,.027,.19,.16); EYE=(.80,.23,.18,.10)
IRIS=(.80,.355,.18,.09); PUPIL=(.80,.47,.18,.080); ORAL=(.51,.33,.26,.23)
BEAK=(.51,.60,.48,.18); SHELL_SKIN=(.51,.80,.48,.18)
TAU=2*math.pi
N=48

def blend(a,b,t): return {a:1-t,b:t}
def peak(t,center,width): return math.exp(-((t-center)/width)**2)
def signed_power(t,p): return math.copysign(abs(t)**p,t)
def mix(a,b,u): return tuple(v*(1-u)+w*u for v,w in zip(a,b))

def stitch(s,first,second,box,v0,v1,skip=None,choose=None):
    n=len(first)
    for j in range(n):
        if skip and j in skip: continue
        k=(j+1)%n
        chart=choose(j) if choose else box
        s.f([first[j],first[k],second[k],second[j]],
            [uvbox(chart,j/n,v0),uvbox(chart,(j+1)/n,v0),uvbox(chart,(j+1)/n,v1),uvbox(chart,j/n,v1)],1)

def close(s,ring,p,weight,box):
    c=s.v(p,weight); n=len(ring)
    for j in range(n):
        s.f([ring[j],ring[(j+1)%n],c],[uvbox(box,j/n,.90),uvbox(box,(j+1)/n,.90),uvbox(box,(j+.5)/n,.99)],1)

def alignment(s,ring,target):
    n=len(ring)
    variants=[[ring[(i+step*j)%n] for j in range(n)] for step in (-1,1) for i in range(n)]
    return min(variants,key=lambda ids:sum((s.points[a]-s.points[b]).length_squared for a,b in zip(ids,target)))

def limb(s,key,opening):
    hip,knee,ankle,toe=LEGS[key];kind,side=key.split('_');sign=1 if side=='l' else -1; fore=kind=='fore'
    upper=kind+'_upper_'+side;lower=kind+'_lower_'+side; foot=kind+'_foot_'+side
    def l(p,q,t): return mix(p,q,t)
    def distal(dx,y,dz): return (ankle[0]+sign*dx,y,ankle[2]+dz)
    # The front elbow turns rearward into the radial extensors; the hind knee
    # leads and the calf narrows sharply into the long, low swimming heel.
    rings=[
        (l(hip,knee,.04),.278 if fore else .306,.232,blend('shell',upper,.57)),
        (l(hip,knee,.26),.269 if fore else .284,.241,upper),
        (l(hip,knee,.48),.250 if fore else .272,.195,upper),
        (l(hip,knee,.72),.213,.174,blend(upper,lower,.18)),
        (l(hip,knee,.91),.189,.166,blend(upper,lower,.38)),
        (knee,.195,.157,blend(upper,lower,.53)),
        (l(knee,ankle,.15),.211 if fore else .177,.156,blend(upper,lower,.78)),
        (l(knee,ankle,.37),.219 if fore else .180,.132,lower),
        (l(knee,ankle,.58),.172,.112,lower),
        (l(knee,ankle,.79),.133,.101,blend(lower,foot,.14)),
        (ankle,.124,.085,blend(lower,foot,.63)),
        (distal(.029,.103,.075),.155,.075,foot),
        (distal(.058,.078,.142),.193 if fore else .211,.060,foot),
        (distal(.084,.057,.198),.202 if fore else .221,.043,foot),
        (distal(.105,.044,.228),.189 if fore else .203,.035,foot),
        (distal(.119,.041,.254),.172 if fore else .186,.020,foot),
        (distal(.121,.038,.266),.169 if fore else .182,.009,foot)]
    frames=[None]*len(rings);axis=Vector((1,0,0))
    for i in reversed(range(len(rings))):
        direction=(Vector(rings[min(i+1,len(rings)-1)][0])-Vector(rings[max(0,i-1)][0])).normalized()
        axis=(axis-direction*axis.dot(direction)).normalized()
        normal=direction.cross(axis).normalized()
        frames[i]=(axis.copy(),normal)
    prev=None; n=len(opening)
    for i,(p,w,h,weight) in enumerate(rings):
        axis,up=frames[i];ids=[]
        for j in range(n):
            a=TAU*j/n;cx=math.cos(a);cy=math.sin(a)
            muscle=1+.17*math.cos(2*a+.5)*peak(i,2.4,2)+.11*math.cos(3*a-.8)*peak(i,7,1.9)
            joint=.032*peak(i,5,.74)*max(0,cy)**3
            fold=.015*(peak(i,1.2,.43)-.72*peak(i,2,.47))*(.40+.6*math.cos(a+.74)**2)
            toes=sum(peak(cx,q,.115 if fore else .13) for q in [-.79,-.26,.27,.79])
            tip=smooth(11,16,i)
            point=Vector(p)+axis*(w*signed_power(cx,.94)*muscle)+up*(h*signed_power(cy,.83)+joint+fold)
            # The web advances between the digits but falls back from each free
            # ray. One mesh runs from the shoulder to each terminal nail.
            point.z+=tip*(.121*toes-.053*(1-toes)) + .018*cx*sign*tip
            point.y+=smooth(10,14,i)*(.024*toes*max(cy,0)-.007*(1-toes))
            ids.append(s.v(point,weight))
        if prev is None:
            stitch(s,alignment(s,opening,ids),ids,SKIN,0,.06)
        else:
            chart=PAD if i>=11 else SKIN
            def end_chart(j):
                x=math.cos(TAU*(j+.5)/n)
                return CLAW if i>=15 and min(abs(x-q) for q in [-.79,-.26,.27,.79])<.18 else chart
            stitch(s,prev,ids,chart,(i-1)/(len(rings)-1),i/(len(rings)-1),choose=end_chart)
        prev=ids
    close(s,prev,distal(.121,.040,.241),foot,PAD)

def axial(s):
    # Stations run from the tail through both girdles, then along the pleated
    # neck into the skull roof and the hooked rhamphotheca in one surface.
    stations=[
        (-2.13,.49,.012,.012,'tail_2'),(-2.01,.51,.055,.044,'tail_2'),(-1.80,.55,.097,.067,'tail_2'),
        (-1.56,.61,.145,.096,blend('tail_1','tail_2',.45)),(-1.36,.70,.285,.147,'tail_1'),
        (-1.23,.77,.529,.200,blend('shell','tail_1',.22)),(-1.15,.80,.768,.232,'shell'),
        (-.985,.82,.923,.250,'shell'),(-.82,.83,.982,.256,'shell'),(-.66,.83,1.012,.254,'shell'),
        (-.49,.83,1.01,.251,'shell'),(-.10,.84,1.015,.254,'shell'),(.27,.84,1.004,.252,'shell'),
        (.51,.83,.977,.255,'shell'),(.66,.84,.957,.266,'shell'),(.82,.85,.913,.271,'shell'),
        (.98,.87,.806,.276,'shell'),(1.12,.9,.667,.264,blend('shell','neck_1',.12)),
        (1.21,.921,.477,.258,blend('shell','neck_1',.40)),(1.285,.953,.371,.246,'neck_1'),
        (1.35,.987,.329,.235,'neck_1'),(1.415,1.024,.302,.214,blend('neck_1','neck_2',.39)),
        (1.485,1.072,.276,.196,'neck_2'),(1.56,1.115,.244,.183,'neck_2'),
        (1.645,1.15,.225,.164,blend('neck_2','neck_3',.40)),(1.73,1.17,.212,.152,'neck_3'),
        (1.82,1.181,.220,.146,'neck_3'),(1.90,1.183,.242,.141,blend('neck_3','skull',.38)),
        (1.963,1.19,.286,.139,blend('neck_3','skull',.78)),(2.006,1.195,.328,.143,'skull'),
        (2.070,1.203,.364,.140,'skull'),(2.131,1.213,.370,.132,'skull'),
        (2.195,1.224,.352,.125,'skull'),(2.251,1.231,.313,.121,'skull'),
        (2.305,1.228,.251,.115,'skull'),(2.362,1.22,.220,.102,'skull'),
        (2.413,1.215,.199,.094,'skull'),(2.460,1.203,.176,.081,'skull'),
        (2.506,1.187,.143,.067,'skull'),(2.543,1.163,.097,.053,'skull'),
        (2.566,1.142,.053,.041,'skull'),(2.575,1.116,.028,.025,'skull'),
        (2.570,1.097,.013,.010,'skull')]
    ports={'hind':(6,10),'fore':(13,17)}
    # The free shoulder port has a broad dorsal scapular edge and an undercut
    # behind the forelimb. Its boundary is sewn to the actual limb ring below.
    bounds={'l':(-9,5),'r':(N//2-5,N//2+9)}
    rows=[]
    for i,(z,y,w,h,weight) in enumerate(stations):
        ids=[]
        for j in range(N):
            a=TAU*j/N;cx=math.cos(a);cy=math.sin(a)
            neck=smooth(1.10,1.45,z)*(1-smooth(1.83,2.06,z))
            skull=smooth(1.84,2.08,z)
            face=peak(z,2.17,.23)
            # Flat parietal roof, caudolateral jaw adductor and a shallow trough
            # immediately below the orbital shelf, carried into the neck fascia.
            x=w*signed_power(cx,1-.35*skull)
            yy=y+h*signed_power(cy,1-.42*skull)
            lane=abs(cx)**1.6
            x+=math.copysign(.024*face*peak(cy,-.40,.30)-.037*peak(z,2.256,.062)*peak(cy,.29,.29),cx)
            yy+=.026*peak(z,2.24,.088)*peak(cy,.64,.24)*lane
            yy-=.045*peak(z,2.045,.108)*peak(cy,-.53,.43)
            zz=z-(.079*peak(z,2.021,.099)*peak(cy,-.28,.56)*lane)
            # Offset right and left slip folds, with the longest shallow crease
            # sweeping obliquely from jaw angle into the neck.
            tend=neck*(.032*peak(cy,-.23+.21*math.sin((z-1.18)*4+.50*cx),.16)+.016*peak(cy,.48,.18))
            drape=neck*(.012*math.sin((z-1.16)*49+2.2*cy+.62*cx))*peak(z,1.39,.207)
            x+=math.copysign((tend+drape)*lane,cx)
            yy-=neck*.036*max(0,-cy)**2*peak(z,1.49,.22)
            yy+=.010*math.sin(z*5+.43)*cx*face
            ids.append(s.v((x,yy,zz),weight))
        if i:
            holes=set()
            for kind,(start,end) in ports.items():
                if start<i<=end:
                    for lo,hi in bounds.values():holes.update(j%N for j in range(lo,hi))
            if z<1.17: chart=SHELL_SKIN; u0=(i-1)/18;u1=i/18
            elif z<1.94: chart=NECK; u0=(i-18)/10;u1=(i-17)/10
            else: chart=HEAD;u0=(i-28)/15;u1=(i-27)/15
            if z>2.411: chart=BEAK;u0=(i-36)/8;u1=(i-35)/8
            stitch(s,rows[-1],ids,chart,max(.008,u0),min(.992,u1),holes)
        rows.append(ids)
    close(s,rows[0],(0,.49,-2.14),'tail_2',SKIN)
    close(s,rows[-1],(0,1.092,2.566),'skull',BEAK)
    for kind,(start,end) in ports.items():
        for side,(lo,hi) in bounds.items():
            opening=[rows[start][j%N] for j in range(lo,hi)]
            opening+=[rows[i][hi%N] for i in range(start,end)]
            opening+=[rows[end][j%N] for j in range(hi,lo,-1)]
            opening+=[rows[i][lo%N] for i in range(end,start,-1)]
            limb(s,kind+'_'+side,opening)

def jaw_and_orbit(s):
    # A narrow chin widens abruptly into the quadrate/articular angle, with a
    # concave cutting edge around the separate lower oral surface.
    stations=[(1.938,1.124,.108,.053),(1.991,1.107,.247,.077),(2.040,1.091,.309,.083),
              (2.100,1.069,.324,.068),(2.175,1.068,.302,.056),(2.242,1.078,.255,.051),
              (2.32,1.092,.205,.046),(2.399,1.096,.173,.042),(2.465,1.100,.131,.035),
              (2.517,1.108,.083,.026),(2.543,1.123,.041,.014)]
    prev=None
    for i,(z,y,w,h) in enumerate(stations):
        ids=[]
        for j in range(N):
            a=TAU*j/N;cx=math.cos(a);cy=math.sin(a)
            pinch=.041*peak(z,2.078,.089)*max(0,-cy)*abs(cx)**2
            ids.append(s.v((w*signed_power(cx,.73),y+h*signed_power(cy,.66)-pinch+.012*cy*cx,
                            z-.051*abs(cx)**2*peak(z,2.036,.07)),'jaw'))
        if prev is None:close(s,ids,(0,y,z-.002),'jaw',SKIN)
        else:stitch(s,prev,ids,HEAD if z<2.36 else BEAK,(i-1)/len(stations),i/len(stations))
        prev=ids
    close(s,prev,(0,1.131,2.548),'jaw',BEAK)
    oval(s,(0,1.128,2.302),(.171,.022,.202),'jaw',1,ORAL,28,9)
    oval(s,(0,1.130,2.292),(.163,.016,.191),'skull',1,ORAL,28,9)
    for sign in (1,-1):
        z=2.236+.006*sign
        # Raised anterior brow and tapering postorbital arch surround the eye.
        # Their ends dive below the surrounding already continuous cheek.
        rim=[((sign*.288,1.257,z+.088),.014,.014),((sign*.309,1.286,z+.065),.023,.020),
             ((sign*.329,1.306,z+.026),.027,.023),((sign*.345,1.305,z-.037),.023,.019),
             ((sign*.355,1.282,z-.099),.019,.017),((sign*.359,1.249,z-.130),.009,.013)]
        tube(s,rim,['skull']*len(rim),1,HEAD,14)
        oval(s,(sign*.320,1.269,z),(.027,.032,.061),'skull',1,EYE,24,10)
        oval(s,(sign*.343,1.270,z+.004),(.008,.022,.024),'skull',1,IRIS,16,8)
        oval(s,(sign*.349,1.269,z+.006),(.003,.016,.012),'skull',1,PUPIL,12,8)
        oval(s,(sign*.117,1.230,2.489),(.022,.009,.019),'skull',1,PUPIL,12,7)

def build():
    s=Surface('carbonemys_body',['carapace','turtle_hide'])
    shell.build(s);axial(s);jaw_and_orbit(s);s.done()
if __name__=='__main__':build()
