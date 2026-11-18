"""Pressed sheet, brush repairs and switch markings on the aluminium punt."""
import numpy as np

from craft_finish import foundation
from paint import periodic, poly, ramp, ridge, rounded_box, transfer


RIBS=(-1.52,-1.10,-.21,.18,.94,1.40,1.79)


def skiff_fields(s):
    f=foundation(s,"jon_boat")
    x,y,z=s.P.T
    foot=f["foot"]
    hull=f["hull"]
    interior=hull & ~f["exterior"]
    deck=(interior&(s.N[:,1]>.12))|s.on("thwart","bow flotation","folded side console","storage flap","corrugation")
    board=s.on("transom board")
    stern=f["transom"]|(board&(s.N[:,2]<-.3))
    f["transom"]=stern
    f["exterior"]|=stern
    # Both faces of the chine lap carry a line of domed heads. The upper rivets fasten the beading.
    depth=np.maximum(.065,f["sheer"]-f["chine"])
    q=(y-f["chine"])/depth
    flank=f["side"]
    sheer_dist=y-(f["sheer"]-.19*depth)
    chine_dist=y-(f["chine"]+.11*depth)
    lap=np.minimum(abs(sheer_dist),abs(chine_dist))
    rivet_u=periodic(z+.014,.103)
    uprights=np.minimum.reduce([np.abs(z-c) for c in RIBS])
    seam=flank*ridge(lap,.0037,foot*.62)
    head=np.hypot(rivet_u,lap)
    frame_heads=np.hypot(uprights,periodic(y+.018,.142))
    face=flank|((abs(x)>f["beam"]*.71)&interior)
    r=np.minimum(head,frame_heads)
    rivets=face*ramp(.0094+foot*.42,.0064,r)
    washer=face*ridge(r-.0108,.0018,foot*.46)
    bottom_rows=periodic(abs(x)-.10,.210)
    floor=hull&(s.N[:,1]>.58)&(abs(x)<f["beam"]*.78)
    # The paint ends at the keel's shallow bare skid and along the outer gunwale.
    green=flank*ramp(.045,.125,q)*ramp(1.00,.946,q)
    reg=transfer("jon_boat",np.where(x>0,-1,1)*(z-1.22),y-(f["sheer"]-.18*depth-.077),flank,.599,.075,foot)
    aft_patch=face*poly(z,q,[(-1.40,.31),(-1.26,.33),(-1.18,.29),(-.96,.31),(-.88,.40),(-.93,.46),(-.91,.54),(-1.10,.57),(-1.24,.54),(-1.36,.58),(-1.42,.50)],foot*.75)
    toe_patch=floor*ramp(foot,-foot,rounded_box(x+.25,z+.1,.088,.237,.027))
    f.update(deck=deck,side=flank,registration=reg,seam=seam,rivets=rivets,washer=washer,
             rivet_radius=r,painted=green,floor=floor,repair=np.maximum(aft_patch,toe_patch),
             floor_seam=floor*ridge(bottom_rows,.0042,foot*.6),
             weld=face*ridge(np.minimum(abs(z+1.52),abs(z-1.40)),.0058,foot*.6)*ramp(.91,.81,q)*ramp(.035,.14,q))
    return f


def skiff_paint(p,s,f):
    x,y,z=s.P.T
    foot=f["foot"]
    bare=s.where("aluminium")
    olive=s.where("olive")
    wood=s.where("teak")
    enamel=s.where("gel")
    p.rough[enamel]=.51+.042*p.flake[enamel]
    p.lay(olive,(101,108,76),.61)
    p.lay(bare,(160,165,158),.385,.93)
    p.lay(f["painted"],(181,181,181),.475,dye=0)
    # A thin clear strip under the gunwale and creased flats carry the coil's mill finish.
    rolled=s.on("rolled gunwale","lifting loop","console handrail","formed rib","rub bead","bench cap")
    turn=.5+.5*np.cos(5.4*s.N[:,1]+1.8*s.N[:,0]+.37*np.sin(2.1*z))
    silver=83+129*turn+11*p.flake+4*np.sin(801*(y+.06*z))
    p.lay(rolled,np.column_stack((silver+2,silver+3,silver)),.31+.19*turn,.91)
    mill=bare*(1-f["painted"])*(.52*p.flake+.25*p.cloud+.23*np.sin((z+.17*x)*311))
    p.rgb+=(13*mill)[:,None]
    p.rough+=bare*(.037*p.flake+.018*p.fine)
    p.lay(f["repair"]*(.88+.07*p.flake),(96,107,76),.604)
    floor=f["floor"]
    # Repeated shoe and cooler traffic is concentrated in the clear starboard passage.
    passage=np.exp(-((x+.315)/.22)**2-((z+.02)/1.15)**2)*floor
    toe=np.exp(-((x-.29)/.21)**2-((z+.36)/.34)**2)*floor
    p.lay(passage*(.19+.11*p.cloud)+toe*.18,(161,153,110),.59,.12)
    scuff=.52+.23*np.sin(186*x+4*np.sin(4*z)+7*p.flake)+.26*p.flake
    p.lay(np.maximum(passage,toe)*ramp(.65,.93,scuff)*.76,(165,167,151),.48,.71)
    p.lay(f["floor_seam"],(72,76,62),.70)
    p.lay(f["seam"],(73,78,68),.61,.38)
    p.lay(f["washer"],(106,111,97),.52,.61)
    cap=131+45*ramp(.011,.0003,f["rivet_radius"])+9*p.fine
    p.lay(f["rivets"],np.column_stack((cap+4,cap+4,cap-3)),.32,.90)
    weld=f["weld"]
    ripple=.5+.5*np.cos(y*847+1.15*np.sin(z*431))
    v=134+34*ripple+8*p.flake
    p.lay(weld,np.column_stack((v+5,v+4,v-5)),.42,.89)
    p.height+=f["rivets"]*(19+10*ramp(.008,0,f["rivet_radius"]))-6*f["seam"]+weld*(9+7*ripple)-4*f["floor_seam"]
    # The rolled bench edge and rib crowns go bright before the broad flats lose paint.
    edge=np.minimum(abs(abs(z+.65)-.200),abs(abs(z-.52)-.200))
    thwart=s.on("rolled metal thwart")
    # Rolled cross seats were left bare across the top; the enamel ends at their fastenings.
    open_metal=thwart*ramp(.82,.72,abs(x)/f["beam"])*ramp(.16,.73,f["top"])
    stock=156+14*p.cloud+7*p.flake+3*np.cos(333*z+4*p.flake)
    p.lay(open_metal,np.column_stack((stock+4,stock+4,stock-4)),.53+.035*p.flake,.78)
    bridge=np.clip(.57+.64*p.flake+.29*p.fine,0,1)
    chips=thwart*ridge(edge,.013+.008*p.cloud,foot*.66)*bridge
    p.lay(chips,(175,179,165),.41,.88)
    # Cargo drags across the bench top and breaks the enamel into islands at the high spots.
    bench_z=np.where(z<0,-.65,.52)
    zone=np.exp(-((x+.27)/.28)**2-((z-bench_z-.042)/.155)**2)
    scatter=.49+.27*p.flake+.19*p.fine+.12*np.cos(160*(z-.16*x)+4*p.flake)
    patch=thwart*f["top"]*zone*ramp(.53,.78,scatter)
    p.lay(patch,(161,166,144),.51,.68)
    for cx,cz,long,angle in ((-.19,.021,.35,.16),(.26,-.041,.19,-.12),(-.35,-.090,.19,.23)):
        along=(x-cx)/long
        cross=z-bench_z-cz-angle*(x-cx)-.003*np.sin(13*along)
        half=.0045*np.maximum(0,1-along*along)
        mark=thwart*f["top"]*(abs(along)<1)*ridge(cross,half,foot*.47)
        p.lay(mark,(172,175,154),.45,.79)
        p.height-=mark*6
    drain=f["floor"]*np.exp(-((x+.35)/.36)**2-((z+1.33)/.29)**2)
    stain=drain*(.40+.31*p.cloud+.19*p.flake)
    p.lay(stain,(62,63,47),.51)
    crest=s.on("corrugation")*ridge(periodic(x,.21),.012,foot*.65)*ramp(.14,.74,.53+.49*p.flake+.22*p.fine)
    p.lay(crest*.78,(151,155,137),.47,.67)
    # Shallow knocks spot the same plate in colour, roughness and height.
    dents=np.zeros_like(x)
    for cx,cy,width,h in ((-.91,.29,.16,.049),(.30,.37,.11,.032),(1.48,.47,.062,.021),(-1.42,.22,.082,.041)):
        u=(z-cx)/width; v=(y-cy-.075*(z-cx))/h
        dist=u*u+v*v
        dents+=f["side"]*np.exp(-2.1*dist)*(1+.24*p.flake)
    p.height-=dents*33
    p.rgb*= (1-.16*dents)[:,None]
    # Older strokes leave a little bare metal at the rail and near the bow shelf.
    nick=(.45+.31*p.flake+.17*p.fine+.13*np.sin(97*z))
    edgewear=f["side"]*ridge(y-f["sheer"]+.024,.012,foot*.6)*ramp(.53,.80,nick)
    p.lay(edgewear,(158,164,149),.45,.83)
    console=s.on("folded side console")
    p.lay(console*(.24+.38*f["top"]),(152,151,111),.62)
    p.lay(f["registration"],(225,223,195),.61)
    grain=.52+.29*np.sin(357*y+.83*np.sin(13*x)+4*p.flake)+.19*p.cloud
    p.lay(wood,np.column_stack((119+38*grain,87+33*grain,51+26*grain)),.60)
    p.height+=wood*(7*grain+4*p.fine)
    remote=s.on("removable motor cowling")
    line=y-.808-.072*(z+1.93)
    p.lay(remote*ridge(line,.027,foot*.64),(92,99,93),.36,.19)
    p.lay(remote*ridge(line-.042,.0058,foot*.60),(160,147,111),.43,.23)
    # Engraved ignition markings above the switch nuts.
    plate=s.on("switch plate")&(s.N[:,2]<-.32)
    for cx,word in ((.245,"RUN"),(.526,"AUX")):
        a=transfer(word,cx-x,y-.928,plate,.062,.0175,foot)
        p.lay(a,(219,217,184),.54)
    tread=s.where("tread")*np.cos(442*x)
    p.height+=8*tread
    p.rgb*=(1+.085*tread)[:,None]
