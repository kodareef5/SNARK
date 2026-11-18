"""Coatings on the compressed, heeled forms of the smaller hulls."""
import json

import numpy as np

from abrasion import mix, score
from craft_finish import DRAFT, HEIGHT, HULL, SAMPLE, fields
from craft_wear import deposits, heat, hull_damage, water_deposits, wound
from paint import HERE, Surface, ramp, surface_strips
from wear import ALLOY, QUAY, displayed, hash_cell, mark_fields, tide_fields
from wrecks import Finish, posed, read, save_maps


def dent_points(s,vessel,form):
    candidates=s.covered.ravel()&s.on(HULL[vessel])&(s.N[:,0]*np.sign(s.P[:,0])>.18)
    points=s.P[candidates]
    return [points[np.argmin(np.sum((points-at)**2,axis=1))] for at,_,_ in form["dents"]]


def impact(m,s,f,vessel,form,points):
    envelope=np.zeros(s.n,np.float32)
    for i,((at,r,depth),anchor) in enumerate(zip(form["dents"],points)):
        d=np.linalg.norm(s.P-at,axis=1)/r
        skin=f["exterior"]&(np.sign(s.P[:,0])==np.sign(at[0]))
        envelope=np.maximum(envelope,skin*ramp(1,0,d))
        b=m.take(skin&(d<1))
        _,y,z=b.xyz
        u,v=z-anchor[2],y-anchor[1]
        if i==0 or form.get("burnt"):
            wound(b,u,v,r*.57,r*(.23+.28*depth/r),vessel,610+i)
        score(b,u-.14*r,v-.24*r-.21*u,.71*r,.037*r,.043*r,.36,
              ALLOY if vessel=="jon_boat" else QUAY)
    return envelope


def ash(m,s,f,vessel):
    x,y,z=m.xyz
    core,smoke=heat(s.P,vessel)
    rel=(y-f["sheer"])/(.47 if vessel=="needle" else .23)
    front=z/(5 if vessel=="needle" else 1.65)
    tongue=.15*np.cos(9*front+.9*x)+.16*np.sin(4.7*front-1.7*x)
    edge=ramp(-1.13,-.055,rel+tongue+.15*(m.cloud-.5))
    severity=.39+.27*(1-front**2)+.28*core+.22*smoke+.19*tongue
    streak=.50+.23*np.cos(15*front+1.4*x)+.18*np.sin(23*x+4.1*front)
    mat=mix((83,73,60),(173,161,132),.34+.35*m.grain+.23*streak)
    carbon=mix(mat,(22,23,22),ramp(.37,.91,severity))
    ashcoat=.33*ramp(.38,.70,m.cloud+.13*np.cos(17*front+4*x))*(1-.81*core)
    carbon=mix(carbon,(150,143,123),ashcoat)
    # At the fire margin resin boils into small raised rims.
    u,v=(x+.32*y)/.042,(z+.60*y)/.053
    iu,iv=np.floor(u),np.floor(v)
    radial=np.hypot(u-iu-.23-.5*hash_cell(iu,iv,87),v-iv-.23-.5*hash_cell(iu,iv,231))
    blister=np.exp(-((radial-.21)/.079)**2)-.69*np.exp(-(radial/.16)**2)
    carbon+=((22*blister+8*(m.fine-.5))*(1-ramp(.67,.90,severity)))[:,None]
    carbon=np.where(f["glass"][:,None],mix((18,24,26),(59,68,66),m.flake),carbon)
    return carbon,edge


def form_strip(s,vessel,f,form,points,kind,water,base,packed,mask,display):
    height=posed(s.P,form)[:,1]
    n=s.N.copy()
    if form.get("slump"):
        floor,share=form["slump"]
        n[:,1]*=np.where(s.P[:,1]>floor,1/(1-share),1)
        n/=np.maximum(np.linalg.norm(n,axis=1,keepdims=True),.001)
    top=np.clip(posed(n,form,normal=True)[:,1],0,1)
    finish=Finish(base,packed,mask,display)
    m=mark_fields(s,display)
    deposits(m,s,f,vessel)
    under,belt,crust,growth,weed=tide_fields(m,height,water)
    submerged=f["water_surface"]|f["deck"]|s.on("console","thwart","bench","clamping board","saddle","footboard","plinth")
    if kind=="damaged":
        early=ramp(155,225,m.decay[:,3].astype(np.float32))
        finish.marks(m.decay,early*(.29+.25*m.cloud),.64)
        finish.coat(f["water_surface"]*under*(.16+.28*growth),(74,86,64),.52)
        finish.coat(f["water_surface"]*belt*(.54+.23*m.flake),mix((76,84,48),(139,139,84),growth),.68)
        finish.coat(submerged*crust*(.39+.24*m.grain),(201,197,165),.76)
        finish.coat(submerged*under*top*(.25+.24*m.flake),mix((89,79,58),(149,135,104),m.cloud),.77)
        finish.rough+=.065*top*(1-finish.rough)
        hull_damage(m,s,f,vessel)
    else:
        finish.rough=.44+.50*finish.rough
        if form.get("burnt"):
            soot,coverage=ash(m,s,f,vessel)
            finish.coat(coverage,soot,.87)
            finish.ao*=1-.13*coverage
        else:
            # Old aluminium blooms pale on open flats and black where stagnant water sits.
            oxide=.25+.38*m.cloud+.25*top
            finish.coat(oxide,mix((105,119,108),(187,190,167),.51*m.flake+.38*m.grain),.78,.39)
            wood=f["timber"]
            finish.coat(wood*.82,mix((87,84,68),(172,167,141),m.flake),.87)
        finish.marks(m.decay,(.19+.41*under)*ramp(60,231,m.decay[:,3].astype(np.float32)),.82)
        finish.coat(under*(.49+.39*growth),mix((48,62,46),(115,115,79),m.cloud),.80)
        finish.coat(belt*(.75+.17*m.flake),mix((73,88,48),(145,141,80),growth),.83)
        finish.coat(weed*under*.69,(62,79,42),.82)
        finish.coat(submerged*crust*(.36+.38*m.grain),(190,191,159),.86)
        mud=under*top*(.51+.43*m.cloud)
        finish.coat(mud,mix((82,72,53),(153,134,96),.47*m.cloud+.36*m.grain),.92)
        m.decay.fill(0)
        water_deposits(m,s,f,height,water)
        cones=(m.decay[:,0]>131)&(m.decay[:,3]<170)
        finish.marks(m.decay,.87*cones,.91)
        if vessel=="riptide":
            # The dry steering head and the high side of the seat well kept their burnt surface.
            x,y,z=m.xyz
            core,smoke=heat(s.P,vessel)
            pedestal=s.on("steering pedestal","instrument hood","steering post","switch pod","raked column","mirror housing")
            shoulder=f["hull"]*ramp(-.027,.14,y-f["sheer"])
            ridge=np.maximum(shoulder,pedestal)*ramp(-.225,.082,height-water)
            soot=mix((20,22,22),(69,66,58),.27*m.cloud+.31*(1-core)+.16*m.flake)
            ashline=ramp(.44,.75,m.cloud+.13*np.sin(15*z+6*x))*(1-.78*core)
            soot=mix(soot,(133,128,109),.44*ashline)
            finish.coat(ridge*(.75+.17*smoke),soot,.88)
    envelope=impact(m,s,f,vessel,form,points)
    active=(envelope>0)&(m.hurt[:,3]>0)
    finish.coat(.23*envelope,mix((65,66,60),(155,146,119),m.flake),.59)
    colour=m.hurt[:,:3]
    if kind=="sunk":
        lip=ramp(42,153,colour.max(1).astype(np.float32))
        colour=mix(colour,(92,94,73),lip*(.35+.26*under))
    finish.coat(active,colour,.81 if kind=="sunk" else .70)
    finish.ao*=1-.61*active*(colour.max(1)<48)
    return finish.maps()


def paint_forms(vessel):
    forms=json.loads((HERE.parent/"marine/forms.json").read_text())[vessel]
    folder=HERE.parent/vessel/"tex"
    surface=Surface(folder/"bakes","shell")
    maps=[read(folder,"shell",r,mode).reshape(surface.n,-1) for r,mode in
          (("base","RGBA"),("packed","RGB"),("mask","RGB"))]
    water={"damaged":1.25*DRAFT[vessel],"sunk":(DRAFT[vessel]+.30+.70*HEIGHT[vessel])/2}
    points={k:dent_points(surface,vessel,form) for k,form in forms.items()}
    output={k:[np.empty_like(a) for a in maps] for k in forms}
    for section,s in surface_strips(surface):
        f=fields(s,vessel)
        base,packed,mask=[a[section] for a in maps]
        display=displayed(base,mask,SAMPLE[vessel])
        for kind,form in forms.items():
            strips=form_strip(s,vessel,f,form,points[kind],kind,water[kind],base,packed,mask,display)
            for dest,strip in zip(output[kind],strips):
                dest[section]=strip
    for kind,images in output.items():
        save_maps(HERE.parent/f"{vessel}_{kind}"/"tex","shell",[a.reshape(surface.size,surface.size,-1) for a in images])
        print(f"{vessel}_{kind}: water at {water[kind]:.4f} m",flush=True)
