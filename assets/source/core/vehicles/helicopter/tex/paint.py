"""Paint the model's measured UV charts. The master surface and every layer share the same model-space coordinates.

Paint, stripe and upholstery are dye regions 0, 1 and 2. Three authored liveries share trim/cabin maps and all geometry.
No external photographic material is used. The concept is generated; these production maps are model-derived as the compact's are.
"""
import json
import math
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage
from surface import Surface, fbm, mix, reveal, rgb, sites, smoothstep, cracks, HERE


def tagged(s, name, colour, rough=.65, metal=0, height=None):
    m=s.where(name)
    s.base[m]=colour[m] if np.ndim(colour)==2 else colour
    s.rough[m]=rough[m] if np.ndim(rough) else rough
    s.metal[m]=metal
    if height is not None: s.height[m]=height[m]
    return m


def lettering(s, text, z0, z1, y0, y1):
    """Legible original livery labels, projected once in metres so both UV seams share the same lettering."""
    im=Image.new("L",(1024,256),0)
    font=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",160)
    d=ImageDraw.Draw(im)
    box=d.textbbox((0,0),text,font=font,stroke_width=0)
    d.text(((1024-(box[2]-box[0]))/2,-box[1]+(256-(box[3]-box[1]))/2),text,font=font,fill=255)
    pixels=np.asarray(im)/255
    z,y=s.P[:,2],s.P[:,1]
    # Engine +X is the left; keep both sides readable from the outside.
    u=np.where(s.P[:,0]>0,(z1-z)/(z1-z0),(z-z0)/(z1-z0))
    v=(y1-y)/(y1-y0)
    valid=(u>=0)&(u<1)&(v>=0)&(v<1)&(np.abs(s.N[:,0])>.45)
    result=np.zeros(s.n,np.float32)
    result[valid]=pixels[(v[valid]*255).astype(int),(u[valid]*1023).astype(int)]
    return result


def body(variant):
    s=Surface("body")
    P,N=s.P,s.N; x,y,z=P.T
    fine=fbm(P,.0025,2,44)-.5
    broad=fbm(P,.16,3,11)
    paint=s.where("paint","jamb")
    # Neutral paint takes region colour; only subtle value variation is baked into the surface.
    grey=.83+fine*.025+(broad-.5)*.035
    grey*=.90+.10*s.AO
    s.base[:]=grey[:,None]
    s.mask[paint,0]=1
    s.rough[:]=.30+fine*.055
    s.metal[:]=.16
    s.height[:]=fine*.000025

    # One coherent side stripe rises smoothly from the bow to the tail. In the tail, the thin taper follows the boom.
    stripe_centre=np.where(z>-1.8,1.01+.06*np.clip(-z,0,1.8),1.67+.045*np.clip(-z-1.8,0,4))
    stripe_width=np.where(z>-1.8,.16,np.clip(.19-( -z-1.8)*.03,.06,.19))
    stripe=paint&(np.abs(y-stripe_centre)<stripe_width)&(np.abs(N[:,0])>.30)
    if variant=="police":
        stripe=paint&(np.abs(y-stripe_centre-.10)<stripe_width*1.5)&(np.abs(N[:,0])>.30)
    s.mask[stripe]=rgb(0,1,0)
    s.base[stripe]=(.78+fine[stripe]*.02)[:,None]
    edge=paint&(np.abs(np.abs(y-stripe_centre)-stripe_width)<.009)&(np.abs(N[:,0])>.30)
    s.mask[edge]=0; s.base[edge]=rgb(.73,.72,.65); s.rough[edge]=.43

    # Panel fasteners stay restrained: small dark recess and a lit screw head on actual shell service seams.
    horizontal=(np.abs(y-.86)<.008)|(np.abs(y-2.37)<.008)
    row=(np.abs(((z+.13)/.18)%1-.5)<.035)
    rivet=paint&horizontal&row&(np.abs(N[:,0])>.5)
    s.mask[rivet]=0; s.base[rivet]=rgb(.42,.43,.43); s.rough[rivet]=.33; s.metal[rivet]=.8; s.height[rivet]=-.0007
    # Engine cowling seams and aft access panel; seams follow mechanically useful panels, not random scratches.
    seam=paint&(((y>2.43)&(np.abs(np.abs(x)-.38)<.006))|((z< -1.58)&(z>-1.68)&(y<1.6)))
    s.base[seam]*=.56; s.height[seam]=-.001

    label=lettering(s,{"civilian":"UTILITY", "rescue":"RESCUE", "police":"POLICE"}[variant],-.90,.98,.94,1.25)
    label*=paint*(z>-.99)
    # Letter ink is independent of the randomly selected paint, retaining readable contrast.
    ink=rgb(.90,.91,.88) if variant=="police" else rgb(.10,.15,.16)
    s.base=mix(s.base,ink,label)
    s.mask*=1-label[:,None]
    s.rough=np.where(label>.1,.49,s.rough)
    # A small serial mark on the tail. It belongs to the livery, not the individual vehicle's persistent identity.
    tail_label=lettering(s,"U-04",-4.30,-2.50,1.75,1.99)*paint
    s.base=mix(s.base,rgb(.75,.76,.69),tail_label)
    s.mask*=1-tail_label[:,None]

    damage,which=sites([((1.22,1.02,.8),.35),((-1.19,1.3,-1.1),.27),((.3,1.24,2.2),.34),((0,1.95,-3.5),.22),((.4,2.75,-.8),.25)],s,.5,89)
    scar=(damage<1)&paint
    noise=fbm(P,.012,3,91)
    scratched=mix(rgb(.17,.19,.20),rgb(.61,.64,.65),noise)
    rim=smoothstep(.65,.98,damage)
    scratched=mix(scratched,rgb(.38,.25,.15),rim)
    s.hurt[scar,:3]=scratched[scar]
    s.hurt[scar,3]=reveal(np.array([.3,.9,1.4,1.8,2])[which[scar]]+damage[scar]*.7)
    age=fbm(P,.12,3,93)
    soot=smoothstep(1.8,2.75,y)*smoothstep(.4,-1.55,z)
    rust=mix(rgb(.18,.10,.055),rgb(.45,.26,.12),age)
    char=mix(rust,rgb(.045,.04,.035),soot*.92)
    dec=(s.hurt[:,3]==0)&paint
    s.decay[dec,:3]=char[dec]
    s.decay[dec,3]=reveal(np.clip(2.5-age*1.9-soot*.6,0,2.9))[dec]
    return s


def trim():
    s=Surface("trim"); P=s.P; x,y,z=P.T
    grain=fbm(P,.002,2,23)-.5
    shade=.82+.18*s.AO
    palettes={"plastic":(rgb(.08,.085,.09),.70,0),"rubber":(rgb(.055,.058,.06),.83,0),"metal":(rgb(.50,.52,.53),.36,.9),"chrome":(rgb(.66,.69,.72),.24,1),"exhaust":(rgb(.33,.30,.25),.52,.85),"tread":(rgb(.09,.095,.10),.89,0),"mesh":(rgb(.19,.20,.21),.65,.7),"headlamp":(rgb(.58,.76,.77),.18,.2),"taillamp":(rgb(.58,.055,.025),.24,0),"amber":(rgb(.95,.62,.10),.38,.1)}
    for name,(colour,rough,metal) in palettes.items():
        tagged(s,name,colour*(shade+grain*.08)[:,None],rough+grain*.05,metal,height=grain*.00005)
    mesh=s.where("mesh")
    holes=(np.sin(z*470)*np.sin(y*470)>.0)
    s.base[mesh&holes]*=.12; s.height[mesh&holes]=-.0012
    tread=s.where("tread")
    ribs=(np.abs((z/.06)%1-.5)<.13)
    s.base[tread&ribs]*=.54;s.height[tread&ribs]=.0017
    edge=np.clip(s.convex*.008,0,.8)
    s.base=mix(s.base,rgb(.35,.36,.36),edge*s.where("rubber","metal","plastic")*.25)
    # The outer third of each blade has light fastener-free wear; blade tips stay yellow and legible.
    rotor=(s.PART==s.parts.index("rotor_main"))|(s.PART==s.parts.index("rotor_tail"))
    s.base[rotor&s.where("plastic")]=rgb(.065,.075,.085)*(1+grain[rotor&s.where("plastic"),None]*.15)
    scrape=fbm(P,.035,2,71)>.61
    hurt=scrape&(edge>.03)
    s.hurt[hurt,:3]=rgb(.56,.54,.48);s.hurt[hurt,3]=reveal(1.4+fbm(P,.12,2,81)[hurt])
    dec=s.hurt[:,3]==0
    s.decay[dec,:3]=mix(rgb(.045,.04,.035),rgb(.23,.14,.08),fbm(P,.07,3,82))[dec]
    s.decay[dec,3]=reveal(.9+fbm(P,.05,3,83)[dec]*1.7)
    return s


def cabin():
    s=Surface("cabin"); P,N=s.P,s.N;x,y,z=P.T
    grain=fbm(P,.002,2,21)-.5
    shade=.82+.18*s.AO
    for name,c,r in (("panel",rgb(.53,.52,.47),.78),("headliner",rgb(.60,.59,.54),.88),("carpet",rgb(.15,.16,.16),.95),("dash",rgb(.10,.12,.13),.72),("grip",rgb(.07,.08,.08),.75),("metal",rgb(.50,.52,.54),.35)):
        tagged(s,name,c*(shade+grain*.045)[:,None],r,height=grain*.00007)
    leather=s.where("leather")
    stitch=(np.abs(np.abs(np.abs(x)-.48)-.23)<.004)&(((y+z)/.013)%1<.55)
    seam=np.abs(np.abs(np.abs(x)-.48)-.20)<.003
    weave=np.sin((y+z)*1800)*np.sin(x*1800)
    cloth=(.62+grain*.05+weave*.018)*shade
    s.base[leather]=cloth[leather,None];s.mask[leather,2]=1;s.rough[leather]=.78
    s.height[leather]=weave[leather]*.00005-seam[leather]*.0005
    s.base[leather&stitch]=rgb(.74,.73,.67);s.mask[leather&stitch]=0
    s.base[leather&seam]*=.62

    # Clear window centres use the native cutout material. The perimeter and a faint edge reflection describe the pane.
    gl=s.where("glass"); gi=s.where("glass_in")
    edge=ndimage.distance_transform_edt(gl.reshape(s.size,s.size)).reshape(-1)*s.mpt.reshape(-1)
    border=edge<.020
    reflection=(edge<.065)&(np.sin((x+z)*31+y*17)>.82)
    s.base[gl]=rgb(.13,.19,.20);s.rough[gl]=.13
    s.alpha[gl]=np.where(border[gl],1,np.where(reflection[gl],.65,0))
    s.base[gl&border]=rgb(.035,.045,.05)
    s.alpha[gi]=0

    gauge=s.where("gauge")
    # Static printed reference displays. The live instruments remain the HUD's telemetry.
    display=np.tile(rgb(.018,.035,.038),(s.n,1))
    horizon=y>1.385
    display[horizon]=rgb(.075,.20,.26)
    display[~horizon]=rgb(.19,.16,.10)
    grid=(np.abs((y/.035)%1-.5)<.035)&(np.abs(np.abs(x)-.43)<.13)
    display[grid]=rgb(.63,.71,.63)
    cross=(np.abs(y-1.39)<.0016)&(np.abs(np.abs(x)-.43)<.08)
    display[cross]=rgb(.86,.72,.20)
    tagged(s,"gauge",display,.20)
    for centre in ((.38,1.84,1.87),(-1.2,1.80,-.8)):
        line,r=cracks(P,centre,(0,0,1) if centre[2]>0 else(-1,0,0),.28,39)
        m=gl&(line>.25)&(r<.28)
        s.hurt[m,:3]=rgb(.72,.79,.79);s.hurt[m,3]=reveal(.4+r[m]*4)
    tear=leather&(fbm(P,.08,3,88)>.62)
    s.hurt[tear,:3]=rgb(.28,.23,.13);s.hurt[tear,3]=reveal(1.3+fbm(P,.03,2,22)[tear])
    dec=(s.hurt[:,3]==0)&~(gl|gi)
    s.decay[dec,:3]=mix(rgb(.04,.037,.035),rgb(.21,.19,.16),fbm(P,.04,3,44))[dec]
    s.decay[dec,3]=reveal(.6+fbm(P,.10,3,45)[dec]*2)
    return s


def save(s,folder,cutout=False,wreck=False):
    import surface
    previous=surface.HERE
    os.makedirs(folder,exist_ok=True)
    surface.HERE=folder
    s.save(cutout=cutout)
    surface.HERE=previous
    if wreck:
        os.makedirs(surface.WRECK,exist_ok=True)
        s.save_wreck(cutout=cutout)


if __name__=="__main__":
    report={}
    for variant in ("civilian","rescue","police"):
        s=body(variant)
        folder=HERE if variant=="civilian" else os.path.join(HERE,variant)
        save(s,folder,wreck=variant=="civilian")
        report[variant+"_height_mm"]=float(np.ptp(s.height)*1000)
        print("painted body",variant,flush=True)
        del s
    for name,fn in (("trim",trim),("cabin",cabin)):
        s=fn();save(s,HERE,cutout=name=="cabin",wreck=True)
        report[name+"_height_mm"]=float(np.ptp(s.height)*1000)
        print("painted",name,flush=True)
        del s
    with open(os.path.join(HERE,"maps.json"),"w") as f: json.dump(report,f,indent=2);f.write("\n")
