"""Closed skin lofts, a broad jaw, webbed hands/pes and the armoured carapace."""
import math
from mesh import Surface,tube,oval
from layout import LEGS
import shell
# Independent UV charts: local transverse angle and distance down each anatomical surface.
SKIN=(.008,.018,.48,.30);NECK=(.008,.337,.48,.28);HEAD=(.008,.646,.48,.337)
PAD=(.51,.025,.26,.27);CLAW=(.795,.027,.19,.16);EYE=(.80,.23,.18,.10)
IRIS=(.80,.355,.18,.09);PUPIL=(.80,.47,.18,.080);ORAL=(.51,.33,.26,.23)
BEAK=(.51,.60,.48,.18);SHELL_SKIN=(.51,.80,.48,.18)
def blend(a,b,t):return {a:1-t,b:t}
def rings(s,seq,box,weights,mat=1,sides=24,power=1,space='z'):
    tube(s,seq,weights,mat,box,sides,space,power)
def body(s):
    oval(s,(0,.76,-.04),(1.005,.31,1.46),'shell',1,SHELL_SKIN,44,20)
    # A supple, upward-curving neck with a blunt lower fold under the head.
    sections=[((0,.89,.96),.245,.235),((0,.95,1.12),.29,.25),((0,1.00,1.24),.275,.235),
              ((0,1.055,1.39),.235,.205),((0,1.126,1.54),.203,.176),((0,1.18,1.68),.190,.171),
              ((0,1.19,1.83),.191,.166),((0,1.18,1.94),.198,.166),((0,1.20,2.07),.190,.14)]
    rings(s,sections,NECK,['shell',blend('shell','neck_1',.65),'neck_1',blend('neck_1','neck_2',.46),'neck_2',blend('neck_2','neck_3',.62),'neck_3',blend('neck_3','skull',.6),'skull'],sides=32)
    skull=[((0,1.20,1.925),.12,.115),((0,1.236,2.015),.215,.158),((0,1.257,2.115),.263,.18),
           ((0,1.251,2.205),.274,.182),((0,1.237,2.305),.242,.157),((0,1.218,2.405),.190,.126),
           ((0,1.204,2.495),.125,.098),((0,1.183,2.548),.075,.069)]
    rings(s,skull,HEAD,['skull']*len(skull),sides=36,power=.78)
    keel=[((0,1.190,2.38),.167,.079),((0,1.192,2.455),.170,.085),((0,1.176,2.529),.121,.072),((0,1.148,2.568),.061,.047),((0,1.120,2.566),.020,.021)]
    rings(s,keel,BEAK,['skull']*len(keel),sides=26,power=.79)
    jaw=[((0,1.135,1.99),.10,.075),((0,1.105,2.095),.215,.102),((0,1.082,2.210),.236,.078),
         ((0,1.076,2.338),.201,.060),((0,1.084,2.445),.153,.045),((0,1.091,2.526),.067,.030),((0,1.097,2.545),.020,.014)]
    rings(s,jaw,SKIN,['jaw']*len(jaw),sides=32,power=.81)
    oval(s,(0,1.139,2.316),(.152,.028,.183),'jaw',1,ORAL,28,10)
    oval(s,(0,1.107,2.282),(.15,.020,.181),'skull',1,ORAL,28,10)
    for sign in [1,-1]:
        # A sculpted orbital shelf partly shelters a dark globe and gold iris.
        oval(s,(sign*.245,1.306,2.222),(.035,.060,.088),'skull',1,HEAD,20,10)
        oval(s,(sign*.271,1.305,2.232),(.022,.042,.048),'skull',1,EYE,22,10)
        oval(s,(sign*.287,1.306,2.240),(.010,.031,.032),'skull',1,IRIS,20,10)
        oval(s,(sign*.296,1.307,2.242),(.004,.021,.017),'skull',1,PUPIL,16,8)
        oval(s,(sign*.107,1.243,2.492),(.016,.011,.019),'skull',1,PUPIL,14,7)
    tail=[((0,.72,-1.03),.26,.19),((0,.68,-1.29),.228,.146),((.019,.63,-1.45),.154,.110),
          ((.044,.57,-1.62),.11,.081),((.071,.53,-1.82),.071,.061),((.098,.504,-2.00),.037,.036),((.11,.49,-2.132),.007,.008)]
    rings(s,tail,SKIN,['shell','tail_1','tail_1',blend('tail_1','tail_2',.66),'tail_2','tail_2','tail_2'],sides=22)
def lerp(a,b,t):return tuple(x+(y-x)*t for x,y in zip(a,b))
def legs(s):
    for key,(hip,knee,ankle,toe) in LEGS.items():
        kind,side=key.split('_');sign=1 if side=='l' else -1
        upper=kind+'_upper_'+side;lower=kind+'_lower_'+side;foot=kind+'_foot_'+side
        limb=[(lerp(hip,knee,-.12),.17,.20),(hip,.205,.221),(lerp(hip,knee,.36),.205,.192),
              (lerp(hip,knee,.74),.175,.143),(knee,.177,.155),(lerp(knee,ankle,.32),.165,.144),
              (lerp(knee,ankle,.69),.137,.114),(ankle,.138,.086)]
        rings(s,limb,SKIN,[blend('shell',upper,.4),upper,upper,blend(upper,lower,.20),blend(upper,lower,.52),lower,lower,blend(lower,foot,.66)],sides=24,space='along')
        # A single low web fans across the digits; individual toe walls and
        # recurved dark nails extend just past it, increasing the swimming area.
        x,y,z=ankle
        web=[((x,.115,z-.106),.063,.049),((x+sign*.022,.105,z-.013),.155,.09),
             ((x+sign*.057,.087,z+.102),.187,.077),((x+sign*.089,.055,z+.197),.180,.055),
             ((x+sign*.092,.050,z+.259),.119,.042)]
        rings(s,web,PAD,[foot]*len(web),sides=26,power=.80)
        for d in range(4):
            f=(d-1.5)/1.5;dx=sign*(.082+f*.140);zz=.236+.052*(1-abs(f))
            p=(x+dx,.045,z+zz);end=(p[0]+sign*(.038+.018*f),.025,p[2]+.079-.014*abs(f))
            seq=[((p[0]-sign*.026,.064,p[2]-.075),.048,.041),(p,.040,.032),(lerp(p,end,.54),.024,.020),(end,.004,.005)]
            rings(s,seq[:2],PAD,[foot]*2,sides=12)
            rings(s,seq[1:],CLAW,[foot]*3,sides=12)
def build():
    s=Surface('carbonemys_body',['carapace','turtle_hide']);shell.build(s);body(s);legs(s);s.done()
if __name__=='__main__':build()
