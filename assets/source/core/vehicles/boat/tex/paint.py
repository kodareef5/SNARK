"""Original model-derived marine surfaces, livery, instruments, damage and decay. No photographic textures.

Neutral base/dye regions, physical height/normal, packed occlusion/roughness/metalness and separate hurt/decay
all share exact model-space texel positions and the model's guarded UV layout.
"""
import json
import math
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage
from surface import Surface, fbm, mix, reveal, rgb, sites, smoothstep, cracks, HERE


def tagged(s,name,colour,rough=.65,metal=0,height=None):
    m=s.where(name);s.base[m]=colour[m] if np.ndim(colour)==2 else colour
    s.rough[m]=rough[m] if np.ndim(rough) else rough;s.metal[m]=metal
    if height is not None:s.height[m]=height[m]
    return m


def label(s,text,z0,z1,y0,y1):
    im=Image.new("L",(1024,256),0);font=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",160)
    d=ImageDraw.Draw(im);box=d.textbbox((0,0),text,font=font)
    d.text(((1024-box[2]+box[0])/2,-box[1]+(256-box[3]+box[1])/2),text,font=font,fill=255)
    pixels=np.asarray(im)/255;x,y,z=s.P.T
    u=np.where(x>0,(z1-z)/(z1-z0),(z-z0)/(z1-z0));v=(y1-y)/(y1-y0)
    valid=(u>=0)&(u<1)&(v>=0)&(v<1)&(np.abs(s.N[:,0])>.60)
    out=np.zeros(s.n,np.float32);out[valid]=pixels[(v[valid]*255).astype(int),(u[valid]*1023).astype(int)]
    return out


def body(variant):
    s=Surface("body");P,N=s.P,s.N;x,y,z=P.T
    fine=fbm(P,.0028,2,615)-.5;broad=fbm(P,.18,3,92)
    paint=s.where("paint","jamb")
    grey=(.84+fine*.025+(broad-.5)*.025)*(.91+.09*s.AO)
    s.base[:]=grey[:,None];s.mask[paint,0]=1;s.rough[:]=.38+fine*.045;s.metal[:]=.16;s.height[:]=fine*.000025
    # The antifouling follows the keel and waterline; the upper stripe remains consistent across chart seams.
    under=paint&(y<.50)&(N[:,1]<.7)
    s.mask[under]=0;s.base[under]=rgb(.095,.115,.115)*(1+fine[under,None]*.12);s.rough[under]=.74
    centre=.91+.045*np.clip(z,0,3)
    stripe=paint&(np.abs(y-centre)<(.115 if variant=="civilian" else .17))&(np.abs(N[:,0])>.35)
    s.mask[stripe]=rgb(0,1,0);s.base[stripe]=(.83+fine[stripe]*.02)[:,None]
    edge=paint&(np.abs(np.abs(y-centre)-(.115 if variant=="civilian" else .17))<.008)&(np.abs(N[:,0])>.35)
    s.mask[edge]=0;s.base[edge]=rgb(.68,.70,.64);s.rough[edge]=.45
    # Fine panel fastening and continuous weld line instead of arbitrary grunge over the entire hull.
    weld=paint&(np.abs(y-(.54+.09*np.clip(z,0,3)))<.006)&(np.abs(N[:,0])>.4)
    s.base[weld]*=.75;s.height[weld]=.0005;s.rough[weld]=.47
    fastener=paint&(np.abs(y-1.23)<.008)&(np.abs((z/.28)%1-.5)<.035)&(np.abs(N[:,0])>.6)
    s.mask[fastener]=0;s.base[fastener]=rgb(.38,.42,.41);s.metal[fastener]=.8;s.height[fastener]=-.0005
    ink=label(s,{"civilian":"UTILITY","rescue":"RESCUE","police":"POLICE"}[variant],-1.75,.35,1.01,1.25)*paint
    s.base=mix(s.base,rgb(.085,.13,.14),ink);s.mask*=1-ink[:,None];s.rough=np.where(ink>.1,.55,s.rough)
    serial=label(s,"U-04",1.42,2.10,1.22,1.36)*paint
    s.base=mix(s.base,rgb(.13,.18,.18),serial);s.mask*=1-serial[:,None]
    damage,which=sites([((1.24,.62,.9),.37),((-1.28,.88,-1.25),.31),((.42,.96,3.05),.33),((.95,1.25,-2.5),.19),((-.68,1.29,2.30),.19)],s,.44,735)
    scar=(damage<1)&paint;grain=fbm(P,.010,3,839)
    bare=mix(rgb(.24,.29,.29),rgb(.62,.66,.65),grain)
    bare=mix(bare,rgb(.30,.23,.15),smoothstep(.72,1,damage)*.5)
    s.hurt[scar,:3]=bare[scar];s.hurt[scar,3]=reveal(np.array([.25,.75,1.25,1.75,2])[which[scar]]+damage[scar]*.7)
    age=fbm(P,.12,3,102);salt=smoothstep(.95,.38,y)*(.6+.4*age)
    corrosion=mix(rgb(.24,.20,.14),rgb(.45,.44,.32),salt)
    char=mix(corrosion,rgb(.045,.050,.047),smoothstep(-1.9,-3.3,z)*.82)
    dec=(s.hurt[:,3]==0)&paint;s.decay[dec,:3]=char[dec];s.decay[dec,3]=reveal(.6+age[dec]*1.7+(1-salt[dec])*.35)
    return s


def trim():
    s=Surface("trim");P=s.P;x,y,z=P.T;grain=fbm(P,.003,2,194)-.5;shade=.83+.17*s.AO
    palettes={"plastic":(rgb(.065,.079,.081),.75,0),"rubber":(rgb(.040,.047,.048),.86,0),
              "chrome":(rgb(.61,.66,.67),.28,1),"engine":(rgb(.115,.14,.15),.35,.22),
              "tread":(rgb(.13,.145,.14),.92,0),"mesh":(rgb(.10,.125,.13),.56,.5),
              "headlamp":(rgb(.12,.55,.33),.23,.1),"taillamp":(rgb(.65,.035,.02),.25,.1),
              "amber":(rgb(.93,.48,.08),.40,.1)}
    for name,(c,rough,metal) in palettes.items():tagged(s,name,c*(shade+grain*.06)[:,None],rough+grain*.04,metal,height=grain*.000035)
    vent=s.where("mesh")&(np.abs((y/.025)%1-.5)<.23)
    s.base[vent]*=.25;s.height[vent]=-.0011
    ribs=s.where("tread")&(np.abs((z/.045)%1-.5)<.17)
    s.base[ribs]*=.65;s.height[ribs]=.0016
    engine=s.where("engine");seam=engine&(np.abs(y-1.12)<.007)
    s.base[seam]*=.35;s.height[seam]=-.0009
    # Restrained rear cowling identifier, abstract stripes and smooth enamel distinguish the power unit.
    band=engine&(y>1.28)&(y<1.34)&(np.abs(s.N[:,0])>.55)
    s.base[band]=rgb(.47,.55,.54);s.rough[band]=.46
    edge=np.clip(s.convex*.009,0,.7);s.base=mix(s.base,rgb(.39,.43,.42),edge*s.where("rubber","engine","plastic")*.17)
    scrape=(fbm(P,.025,2,921)>.62)&(edge>.035)
    s.hurt[scrape,:3]=rgb(.51,.57,.56);s.hurt[scrape,3]=reveal(1.1+fbm(P,.10,3,82)[scrape])
    dec=s.hurt[:,3]==0;soot=mix(rgb(.04,.045,.043),rgb(.25,.23,.17),fbm(P,.06,3,83))
    s.decay[dec,:3]=soot[dec];s.decay[dec,3]=reveal(.55+fbm(P,.09,3,84)[dec]*1.8)
    return s


def displays():
    images=[];font=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",26)
    small=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",22)
    for side in range(2):
        im=Image.new("RGB",(640,250),(8,22,27));d=ImageDraw.Draw(im)
        if side==0:
            d.text((20,8),"NAVIGATION REF",font=font,fill=(205,224,210))
            for xx in range(45,620,50):d.line((xx,48,xx,235),fill=(27,64,67),width=2)
            for yy in range(65,240,42):d.line((20,yy,620,yy),fill=(27,64,67),width=2)
            d.polygon(((20,80),(140,72),(191,118),(170,170),(242,198),(235,249),(20,249)),fill=(108,126,97))
            d.line(((300,224),(320,176),(363,155),(402,104),(472,63)),fill=(238,199,90),width=5)
            d.polygon(((354,143),(346,164),(370,160)),fill=(232,239,218))
            d.text((497,205),"REF",font=small,fill=(114,160,161))
        else:
            d.text((20,8),"SERVICE REF",font=font,fill=(205,224,210))
            for cx,text,angle in ((116,"RPM",-70),(320,"TEMP",-125),(524,"FUEL",-45)):
                d.arc((cx-68,67,cx+68,203),190,350,fill=(105,185,157),width=10)
                for a in range(190,351,32):
                    aa=math.radians(a);d.line((cx+52*math.cos(aa),135+52*math.sin(aa),cx+65*math.cos(aa),135+65*math.sin(aa)),fill=(224,233,208),width=3)
                a=math.radians(angle);d.line((cx,135,cx+52*math.cos(a),135+52*math.sin(a)),fill=(235,207,93),width=5)
                d.ellipse((cx-5,130,cx+5,140),fill=(232,239,218));d.text((cx-30,202),text,font=small,fill=(189,213,204))
        images.append(np.asarray(im)/255)
    return images


def cabin():
    s=Surface("cabin");P,N=s.P,s.N;x,y,z=P.T;grain=fbm(P,.0025,2,541)-.5;shade=.83+.17*s.AO
    for name,c,r,metal in (("panel",rgb(.48,.52,.49),.76,.12),("carpet",rgb(.16,.19,.18),.94,0),
                           ("dash",rgb(.075,.105,.11),.84,0),("grip",rgb(.055,.07,.072),.78,0),
                           ("metal",rgb(.46,.52,.52),.38,.90)):
        tagged(s,name,c*(shade+grain*.045)[:,None],r,metal,height=grain*.00007)
    deck=s.where("carpet");gripgrain=fbm(P,.006,2,35)-.5
    s.height[deck]=gripgrain[deck]*.00035;s.rough[deck]=.93
    # Individual upholstery seams/stitches on the four authored seat cushions and backs.
    leather=s.where("leather");seam=np.abs(np.abs(np.abs(x)-.48)-.20)<.003
    stitch=(np.abs(np.abs(np.abs(x)-.48)-.235)<.004)&(((y+z)/.014)%1<.55)
    weave=np.sin((y+z)*1700)*np.sin(x*1700);cloth=(.64+grain*.04+weave*.012)*shade
    s.base[leather]=cloth[leather,None];s.mask[leather,2]=1;s.rough[leather]=.79;s.height[leather]=weave[leather]*.000035-seam[leather]*.00035
    s.base[leather&stitch]=rgb(.70,.72,.63);s.mask[leather&stitch]=0;s.base[leather&seam]*=.65
    gl=s.where("glass");gi=s.where("glass_in")
    edge=ndimage.distance_transform_edt(gl.reshape(s.size,s.size)).reshape(-1)*s.mpt.reshape(-1)
    border=edge<.017;reflection=(edge<.045)&(np.sin(x*35+y*18)>.85)
    s.base[gl]=rgb(.12,.22,.23);s.rough[gl]=.15;s.alpha[gl]=np.where(border[gl],1,np.where(reflection[gl],.60,0))
    s.base[gl&border]=rgb(.035,.055,.057);s.alpha[gi]=0
    images=displays();display=np.tile(rgb(.025,.06,.065),(s.n,1))
    for side,centre in enumerate((.48,-.48)):
        u=(centre+.23-x)/.46;v=(1.845-y)/.11
        valid=(u>=0)&(u<1)&(v>=0)&(v<1)&(N[:,2]<-.5)&s.where("gauge")
        display[valid]=images[side][(v[valid]*249).astype(int),(u[valid]*639).astype(int)]
    tagged(s,"gauge",display,.82)
    line,r=cracks(P,(.65,2.13,1.38),(0,0,1),.32,311)
    crack=gl&(line>.25)&(r<.32);s.hurt[crack,:3]=rgb(.69,.80,.78);s.hurt[crack,3]=reveal(.45+r[crack]*4)
    tear=leather&(fbm(P,.07,3,142)>.63);s.hurt[tear,:3]=rgb(.28,.27,.17);s.hurt[tear,3]=reveal(1.0+fbm(P,.025,2,143)[tear])
    scrape=deck&(fbm(P,.08,2,912)>.63);s.hurt[scrape,:3]=rgb(.38,.43,.40);s.hurt[scrape,3]=reveal(1.35+fbm(P,.03,2,35)[scrape])
    dec=(s.hurt[:,3]==0)&~(gl|gi)
    s.decay[dec,:3]=mix(rgb(.055,.063,.052),rgb(.26,.29,.20),fbm(P,.06,3,442))[dec]
    s.decay[dec,3]=reveal(.65+fbm(P,.12,3,445)[dec]*1.7)
    return s


def save(s,folder,cutout=False,wreck=False):
    import surface
    previous=surface.HERE;os.makedirs(folder,exist_ok=True);surface.HERE=folder;s.save(cutout=cutout);surface.HERE=previous
    if wreck:os.makedirs(surface.WRECK,exist_ok=True);s.save_wreck(cutout=cutout)


if __name__=="__main__":
    report={}
    for variant in ("civilian","rescue","police"):
        s=body(variant);save(s,HERE if variant=="civilian" else os.path.join(HERE,variant),wreck=variant=="civilian")
        report[variant+"_height_mm"]=float(np.ptp(s.height)*1000);print("painted body",variant,flush=True);del s
    for name,fn in (("trim",trim),("cabin",cabin)):
        s=fn();save(s,HERE,cutout=name=="cabin",wreck=True);report[name+"_height_mm"]=float(np.ptp(s.height)*1000);print("painted",name,flush=True);del s
    with open(os.path.join(HERE,"maps.json"),"w") as f:json.dump(report,f,indent=2);f.write("\n")
