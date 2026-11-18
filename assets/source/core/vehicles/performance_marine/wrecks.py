"""Paint the storm-damaged and sunken forms on their vessel's original shell layout."""
import argparse
import json
import sys

sys.dont_write_bytecode = True

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

from paint import HERE, Surface, byte, ramp, surface_strips, teak_fields, thunderbolt_fields
from abrasion import breach, fracture, mix, score
from finishes import FITTINGS
from fitting_wear import hardware_wear
from wear import (QUAY, hash_cell, cabin_decay, deck_decay, displayed, hardware_bedding, heat_fields, hull_hurt, mark_fields,
                  sea_decay, tide_fields)


def posed(values,form,normal=False):
    x,y,z = values.T
    if form.get("burnt"):
        floor,share=form["slump"]
        if not normal:
            y=np.minimum(y,floor)+np.maximum(y-floor,0)*(1-share)
    h,t=np.deg2rad([form["heel"],form["trim"]])
    ch,sh,ct,st=np.cos(h),np.sin(h),np.cos(t),np.sin(t)
    high=y*ch-x*sh
    return np.column_stack((x*ch+y*sh,high*ct-z*st,high*st+z*ct))


def read(folder,material,role,mode):
    with Image.open(folder/f"{material}_{role}.png") as im:
        return np.asarray(im.convert(mode)).copy()


class Finish:
    """Resolve the old dye into its display colour only where deposits cover the coating."""
    def __init__(self,base,packed,mask,display):
        self.rgb=base[:,:3].astype(np.float32)
        self.alpha=base[:,3]
        self.ao,self.rough,self.metal=packed.astype(np.float32).T/255
        self.mask=mask.copy()
        self.display=display

    def coat(self,amount,colour,rough,metal=0):
        a=np.clip(amount,0,1)
        # Trace deposits take away the gloss before they bury the colour.
        self.rough+=(rough-self.rough)*a
        self.metal+=(metal-self.metal)*a
        visible=a>.075
        bury=visible & np.any(self.mask!=0,axis=1)
        self.rgb[bury]=self.display[bury]
        self.mask[bury]=0
        self.rgb=mix(self.rgb,colour,np.where(visible,a,0))

    def marks(self,pixels,amount,rough):
        self.coat(amount*(pixels[:,3]>0),pixels[:,:3],rough)

    def maps(self):
        return (np.column_stack((byte(self.rgb),self.alpha)),
                byte(np.column_stack((self.ao,self.rough,self.metal))*255),self.mask)


def dent_centres(surface,forms):
    # Project an impact inside the mould onto the closest point of its outer skin.
    candidates=surface.covered.ravel() & surface.on("warped V hull") & (surface.N[:,1]<.28)
    skin=surface.P[candidates]
    centres={}
    for name,form in forms.items():
        projected=[]
        for at,radius,depth in form["dents"]:
            local=skin[np.abs(skin[:,2]-at[2])<radius]
            projected.append(local[np.argmin(np.sum((local-at)**2,axis=1))])
        centres[name]=projected
    return centres


def collision(m,s,f,form,centres):
    x,_,_=m.xyz
    envelope=np.zeros(s.n,np.float32)
    for i,((at,radius,depth),on_skin) in enumerate(zip(form["dents"],centres)):
        dist=np.linalg.norm(s.P-at,axis=1)/radius
        envelope=np.maximum(envelope,ramp(1,0,dist))
        side=f["hull"] & (s.N[:,1]<.39) & (np.sign(x)==np.sign(at[0])) & (dist<1)
        b=m.take(side)
        _,y,z=b.xyz
        along,up=z-on_skin[2],y-on_skin[1]
        if depth>=.12:
            breach(b,along,up,radius*.70,radius*.33,572+i*29,.16 if at[0]<0 else -.10)
            # A compression crease connects the lip to the upper shoulder.
            score(b,along+.18,up-.23*radius-.24*along,radius*.73,.019,.032,.46,QUAY)
        else:
            fracture(b,along,up,.54*radius,.29*radius,314,.35)
            score(b,along,up-.10*along,.69*radius,.055,.032,.67,
                  ((57,53,46),(147,133,104),(220,208,171)))
    return envelope


def old_bedding(m,s,f,wood,sky):
    deck_decay(m,s,f,sky)
    cabin_decay(m,s,f,wood)
    hardware_bedding(m,s,f)


def damaged(finish,m,s,f,wood,height,water,exposure,form,centres):
    under,belt,salt,growth,blades=tide_fields(m,height,water)
    old_bedding(m,s,f,wood,exposure)
    # A few weeks leave run-off, drips and damp bedding. Old-age rot needs longer.
    age=m.decay[:,3].astype(np.float32)
    recent=ramp(145,222,age)*(.27+.26*m.cloud)
    finish.marks(m.decay,recent,.62)
    finish.rough+=.105*exposure*(1-finish.rough)
    tide=f["water_surface"]|wood[0]|s.on("stern platform","rubber step")
    submerged=tide*under
    finish.coat(submerged*(.22+.30*growth),(67,80,60),.54)
    finish.coat(tide*belt*(.64+.21*m.flake),mix((73,78,44),(129,131,79),growth),.66)
    finish.coat(tide*salt*(.31+.33*m.grain),(201,199,160),.79)
    # Silt washes out of the sole as the starboard side falls below the new waterline.
    sole=wood[0]&~wood[1]
    join=wood[-1]
    mud=sole*ramp(.15,-.15,height-water)*(.16+.32*join+.24*m.cloud)
    finish.coat(mud,mix((82,70,51),(139,125,94),m.flake),.81)
    cover=f["upholstery"]
    wick=cover*ramp(.46,-.06,height-water)*(.28+.29*m.cloud)
    finish.coat(wick,(127,120,91),.72)
    hull_hurt(m,s,f)
    stress=collision(m,s,f,form,centres)
    m.hurt[stress==0]=0
    compression=stress*(1-.55*stress)*(f["side"]|f["transom"])
    finish.coat(compression*.49,mix((83,79,69),(167,156,132),m.flake),.49)
    finish.marks(m.hurt,1,.69)
    interior=(m.hurt[:,3]>0)&(m.hurt[:,:3].max(1)<49)
    finish.ao*=1-.58*interior
    finish.rough=np.where(interior,.91,finish.rough)


def burnt_skin(m,s,f,wood,height,water,exposure):
    x,y,z=m.xyz
    core,plume=heat_fields(s.P)
    # Raking fire scorched both sheer lines. Ash shields the lee side and the bow tip.
    run=np.exp(-((x+.30-.18*(z+3.05)-.12*np.sin(1.9*z))/.83)**2-((z+1.0)/4.8)**2)
    along=.5+.5*np.sin(.95*z-.84*x+1.88*m.cloud)
    hot=ramp(.55,1.50,y)*(.48+.27*along+.35*core+.26*run)
    hot+=.13*ramp(.59,1.02,height-water+.63)*plume
    hot+=.075*(m.cloud-.5)+.020*(m.flake-.5)
    blister=ramp(.23,.46,hot)*(1-ramp(.61,.81,hot))
    glass_mat=.47+.18*np.sin(295*x+141*y+55*z+4*m.flake)*np.cos(118*z-87*x)+.31*(m.grain-.5)
    mat=mix((97,80,64),(172,158,126),glass_mat)
    caramel=mix((88,80,69),(126,113,94),m.flake)
    ink=mix(caramel,mat,ramp(.27,.48,hot))
    ink=mix(ink,(30,30,28),ramp(.45,.78,hot))
    ink=mix(ink,(14,16,17),ramp(.75,1.0,hot))
    # Grey ash catches in recesses over strips of exposed glass cloth.
    ash=ramp(.48,.73,hot)*ramp(.08,.80,exposure)*(.16+.36*ramp(.30,.73,m.cloud))*(1-.78*core)
    ink=mix(ink,(157,148,127),ash)
    # Char runs over the gunwale where the engine cover and foredeck burned through.
    shoulder=f["sheer"]-y
    streak=.12*np.sin(2.2*z+.6*x)+.045*np.sin(8*z+2*m.cloud)
    burnt_edge=ramp(.49+streak,.04,shoulder)
    outlets=np.exp(-((z+4.18)/2.48)**2)+.83*np.exp(-((z-2.95)/1.68)**2)
    carbon=(f["side"]|f["transom"])*burnt_edge*np.minimum(.94,.31+.64*outlets)
    ink=mix(ink,mix((23,24,23),(54,52,46),m.cloud),carbon)
    # Resin blisters rupture into shallow almond-shaped pits along the fire margin.
    a=(x+.28*y)/.068
    b=(z+.67*y)/.092
    ia,ib=np.floor(a),np.floor(b)
    u,v=a-ia-.23-.53*hash_cell(ia,ib,283),b-ib-.23-.53*hash_cell(ia,ib,857)
    r=np.hypot(u+.23*v,v)/(.115+.19*hash_cell(ia,ib,593))
    rim=np.exp(-((r-.86)/.25)**2)
    pit=np.exp(-(r/.62)**2)
    ink+=((rim*30-pit*33)*blister+(m.grain-.49)*12*blister+(m.fine-.49)*4)[:,None]
    # Patches of pale dry mat interrupt the advancing char across the foredeck.
    wind=x+.31*np.sin(.84*z)-.19*z
    feather=np.exp(-((wind+.39+.07*np.sin(2.4*z))/.37)**2)*np.exp(-((z-2.63)/2.35)**2)
    fibre=ramp(.22,.68,m.cloud+.18*np.sin(17*wind+2.6*z))*feather
    ink=mix(ink,mat,.73*fibre*f["foredeck"])
    boards,_,grain,fleck,_,joints=wood
    charcoal=mix((26,27,25),(98,87,69),.38+.25*grain+.13*fleck+.16*m.flake)
    ink=np.where(boards[:,None],mix(charcoal,(18,21,20),joints*.64),ink)
    ink=np.where(f["glass"][:,None],mix((20,27,30),(67,69,63),.6*m.cloud+.16*m.grain),ink)
    # A few sheltered paint islands near the keel can still take colour.
    adhesion=ramp(.078,.29,hot+.03*np.sin(17*z)+.018*m.flake)
    return ink,adhesion,hot


def sunk(finish,m,s,f,wood,height,water,exposure,form,centres):
    finish.rough=.52+.41*finish.rough
    ink,burn,hot=burnt_skin(m,s,f,wood,height,water,exposure)
    finish.coat(burn,ink,.84)
    finish.ao*=1-.15*burn*ramp(.43,.93,hot)
    old_bedding(m,s,f,wood,exposure)
    # Deposits accumulate after the burn, along the incline of the sunken boat.
    wet=height-water
    retain=ramp(.53,-.24,wet)
    finish.marks(m.decay,(.12+.57*retain)*ramp(64,228,m.decay[:,3].astype(np.float32)),.80)
    under,belt,crust,growth,blades=tide_fields(m,height,water)
    bottom=(s.N[:,1]<.05)|f["water_surface"]|wood[0]
    finish.coat(under*(.63+.26*growth),mix((41,53,42),(108,106,73),.60*m.cloud+.31*m.grain),.83)
    finish.coat(belt*(.66+.24*m.flake),mix((64,78,41),(138,133,75),growth),.89)
    finish.coat(crust*(.45+.42*m.grain),(193,191,153),.88)
    finish.coat(blades*under*.70,mix((39,59,37),(111,117,66),m.flake),.78)
    mud=under*exposure*(.49+.40*m.cloud)
    finish.coat(mud,mix((80,68,53),(144,127,92),.56*m.flake+.22*m.grain),.91)
    m.decay.fill(0)
    sea_decay(m,s,f,height,water,bottom)
    # The calcareous cones stand proud of the mud; continuous growth already coats the V.
    cones=(m.decay[:,0]>130)&(m.decay[:,3]<170)
    finish.marks(m.decay,cones*.85,.90)
    collision(m,s,f,form,centres)
    hurt=m.hurt[:,3]>0
    raw=m.hurt[:,:3]
    lip=ramp(44,129,raw.max(1).astype(np.float32))
    weathered=mix(raw,(83,79,64),lip*(.29+.41*burn))
    soaked=mix(weathered,(74,82,53),under*(.27+.28*lip))
    finish.coat(hurt,soaked,.90)
    inside=hurt&(m.hurt[:,:3].max(1)<49)
    finish.ao*=1-.61*inside


def hardware_forms():
    tex=HERE/"tex"
    base,packed,mask=[read(tex,"hardware",role,mode) for role,mode in
                      (("base","RGBA"),("packed","RGB"),("mask","RGB"))]
    hurt,decay=hardware_wear()
    y,x=np.mgrid[:236,:236].astype(np.float32)
    u,v=(x+.5)/236,(y+.5)/236
    for variant in ("worn","wrecked"):
        maps=[a.copy() for a in (base,packed,mask)]
        for i,tag in enumerate(FITTINGS):
            top,left=i//4*256,i%4*256
            tile=np.s_[top+10:top+246,left+10:left+246]
            rgb=base[tile][...,:3].astype(np.float32)
            orm=packed[tile].astype(np.float32)/255
            scar,patina=hurt[tile],decay[tile]
            rng=np.random.default_rng(4906+i)
            field=gaussian_filter(rng.normal(size=u.shape),12,mode="wrap")
            field=np.clip(.5+.18*field/field.std(),0,1)
            salt=.5+.5*np.cos(2*np.pi*(v+.19*np.sin(2*np.pi*u)))
            metal=tag in ("chrome","steel","bronze","slate","intake")
            lens=tag in ("red","green","lamp","gauge","chart")
            if variant=="worn":
                film=.08+.15*field+.16*salt**4
                rgb=mix(rgb,(137,132,108),film*(.67 if lens else 1.))
                orm[...,1]+=film*.68*(1-orm[...,1])
                a=ramp(115,218,patina[...,3].astype(np.float32))*(.38+.29*salt)
                g=(scar[...,3]>91)*(.83 if metal else .61)
            else:
                pat=.50+.30*np.cos(2*np.pi*(u+v)+field*2.2)+.14*np.sin(6*np.pi*v)
                if metal:
                    oxide=mix((49,48,55),(91,86,69),ramp(.26,.68,pat))
                    oxide=mix(oxide,(56,71,86),ramp(.50,.89,field))
                    if tag=="bronze":
                        oxide=mix((70,63,39),(93,121,88),field)
                    rgb=mix(rgb,oxide,.65+.27*salt)
                elif lens:
                    # Carbon and milky salt obscure the instrument under its fractured cover.
                    rgb=mix(rgb,(26,32,34),.78+.19*field)
                else:
                    rgb=mix(rgb,(37,39,35),.72+.24*field)
                rgb=mix(rgb,(109,104,84),.45*ramp(.42,.79,field)*salt)
                orm[...,1]=.55+.33*field
                orm[...,2]*=(.29+.39*pat) if metal else .45
                orm[...,0]*=.75+.19*field
                a=(patina[...,3]>0)*(.58+.33*field)
                g=(scar[...,3]>0)*(.50+.23*field)
            rgb=mix(rgb,patina[...,:3],a)
            rgb=mix(rgb,scar[...,:3],g)
            orm[...,1]+=(.83-orm[...,1])*a
            orm[...,2]*=1-a*.87
            rgba=np.dstack((byte(rgb),base[tile][...,3]))
            for output,painted in zip(maps,(rgba,byte(orm*255),mask[tile])):
                output[top:top+256,left:left+256]=np.pad(painted,((10,10),(10,10),(0,0)),mode="wrap")
        for output,original in zip(maps,(base,packed,mask)):
            output[:4]=original[:4]
            output[-4:]=original[-4:]
            output[:,:4]=original[:,:4]
            output[:,-4:]=original[:,-4:]
        save_maps(tex,"hardware_"+variant,maps)


def save_maps(folder,material,maps):
    for role,data in zip(("base","packed","mask"),maps):
        Image.fromarray(data).save(folder/f"{material}_{role}.png",compress_level=6)


def thunderbolt():
    vessel="thunderbolt"
    forms=json.loads((HERE.parent/"marine/forms.json").read_text())[vessel]
    folder=HERE.parent/vessel/"tex"
    surface=Surface(folder/"bakes","shell")
    originals=[read(folder,"shell",role,mode) for role,mode in
               (("base","RGBA"),("packed","RGB"),("mask","RGB"))]
    base,packed,mask=[a.reshape(-1,a.shape[-1]) for a in originals]
    centres=dent_centres(surface,forms)
    draft,beltline=.58,1.40
    with np.load(folder/"bakes/shell.npz") as bake:
        bottom=posed(bake["pos"].reshape(-1,3),forms["sunk"])[:,1].min()
    water={"damaged":draft+.30*(beltline-draft),"sunk":bottom+beltline}
    outputs={key:[np.empty_like(a) for a in (base,packed,mask)] for key in forms}
    for section,s in surface_strips(surface):
        f,wood=thunderbolt_fields(s),teak_fields(s)
        display=displayed(base[section],mask[section])
        for key,recipe in (("damaged",damaged),("sunk",sunk)):
            form=forms[key]
            height=posed(s.P,form)[:,1]
            normal=s.N
            if form.get("burnt"):
                normal=s.N.copy()
                normal[:,1]*=np.where(s.P[:,1]>form["slump"][0],1/(1-form["slump"][1]),1)
                normal/=np.maximum(np.linalg.norm(normal,axis=1,keepdims=True),.001)
            up=np.clip(posed(normal,form,normal=True)[:,1],0,1)
            finish=Finish(base[section],packed[section],mask[section],display)
            m=mark_fields(s,display)
            recipe(finish,m,s,f,wood,height,water[key],up,form,centres[key])
            for image,strip in zip(outputs[key],finish.maps()):
                image[section]=strip
    for key,result in outputs.items():
        images=[a.reshape(surface.size,surface.size,-1) for a in result]
        save_maps(HERE.parent/f"{vessel}_{key}"/"tex","shell",images)
        print(f"{vessel}_{key}: water at {water[key]:.3f} m",flush=True)
    hardware_forms()


if __name__=="__main__":
    from craft_finish import REGISTRATIONS
    from craft_wreck import paint_forms
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("boat",choices=("thunderbolt",*REGISTRATIONS))
    boat=parser.parse_args().boat
    if boat=="thunderbolt":
        thunderbolt()
    else:
        paint_forms(boat)
        hardware_forms()
