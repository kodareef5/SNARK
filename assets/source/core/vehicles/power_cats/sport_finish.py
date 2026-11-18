"""Graphics projected onto the sport hull, engines and cockpit."""
import numpy as np

from artwork import project


def graphics(f):
    from paint import fade, stripe
    x,y,z=f.x,f.y,f.z
    side=np.sign(x)
    outer=side*f.nx>.58
    wall=f.on("sheer and internal bulwark") & outer & f.is_tag("gel")
    shell=f.on("separate molded demi-hull") & outer & f.is_tag("shell")
    boat=f.scheme.boat
    bow=np.interp(z,[-4.45,-3.9,.8,2.12,3.30,4.06,4.67,5.10,5.30],
                    [1.31,1.34,1.34,1.38,1.48,1.61,1.75,1.89,1.97])
    u=.5-side*(z+2.58)/1.76
    yield "quarter_name",project(boat,"name",u,(1.61-y)/.163,190,20,wall),(26,48,54),.22,0,.1
    u=.5-side*(z-3.45)/1.15
    yield "registration",project(boat,"registration",u,(bow+.266-y)/.115,135,15,wall),(27,49,54),.24,0,.08
    u=(z+.80)/5.46
    ridge=bow-.35+.040*u
    v=(ridge+.194-y)/.218
    under=project(boat,"wing",u,v-.075,510,28,shell)
    feather=project(boat,"wing",u,v,510,28,shell)
    yield "wing_shadow",under,(29,47,53),.26,0,.08
    yield "wing_inlay",feather,(232,227,204),.23,.10,.12
    yield "wing_tip",feather*fade(.67,.72,u),(210,103,58),.24,.12,.14
    cowl=f.on("outboard cowling") & f.is_tag("carbon")
    cheek=cowl & (abs(f.nx)>.7)
    t=(z+5.24)/.65
    rake=(y-1.32)-.24*(t-.5)
    clear=fade(-.01,.10,t)*fade(1.02,.90,t)
    yield "motor_cheek",cheek*clear*fade(.088,.073,abs(rake)),(100,116,115),.22,.64,.11
    yield "motor_pin",cheek*clear*stripe(rake+.071,.010,f.pixel),(226,153,87),.24,.25,.1
    face=cowl & (f.nz<-.62)
    du=(abs(x)-1.35)
    wings=abs(du)-.17
    arrow=.035+(abs(du)*.32)
    yield "drive_badge",face*fade(.012,-.001,wings)*stripe(y-1.69+arrow,.013,f.pixel),(208,205,184),.25,.75,.19
    grille=f.on("intake grille") & (f.nz<-.55)
    rib=stripe((y%.038)-.019,.006,f.pixel)
    yield "intake_louvres",grille,np.stack((31+38*rib,38+39*rib,40+38*rib),axis=-1),.40,.20,-.53
    face=f.on("analogue instrument face") & (f.nz<-.50)
    dx=x-(f.low[0]+f.high[0])*.5
    dy=y-(f.low[1]+f.high[1])*.5
    ring=np.hypot(dx,dy)
    for key,ink,c in [("dial_surround",stripe(ring-.044,.003,f.pixel),(139,153,141)),
                      ("dial_warning",stripe(ring-.040,.004,f.pixel)*(dx<-.006)*(dy>.017),(226,128,65)),
                      ("dial_counter",fade(.017,.010,abs(dx))*fade(.006,.002,abs(dy+.022)),(170,185,155))]:
        yield key,face*ink,c,.27,0,.09
    keys=f.on("switch") & (f.nz<-.55)
    key=(x-(f.low[0]+f.high[0])*.5)
    yield "key_caps",keys*fade(.016,.010,np.hypot(key,y-2.178)),(41,55,57),.43,0,.21
    yield "key_lamps",keys*fade(.009,.002,np.hypot(key,y-2.185)),(153,207,159),.29,0,.26
    wheel=f.on("steering rim")
    yield "wheel_index",wheel*(y>2.358)*stripe(x+.63,.012,f.pixel),(196,142,80),.48,0,.22
    door=f.on("helm console") & (f.nz>.61)
    ax,ay=abs(x-.05)-.64,abs(y-1.80)-.19
    surround=np.hypot(np.maximum(0,ax),np.maximum(0,ay))+np.minimum(np.maximum(ax,ay),0)-.049
    yield "service_door",door*stripe(surround,.009,f.pixel),(103,115,110),.47,0,-.48
    latch=np.hypot(abs(x-.05)-.54,y-1.90)
    yield "turn_latches",door*fade(.040,.029,latch),(124,133,128),.28,.91,-.18
    yield "latch_slots",door*fade(.024,.016,latch)*stripe(y-1.90,.005,f.pixel),(54,59,57),.41,.44,-.44
    slots=door*fade(.37,.29,abs(x-.05))*fade(.068,.042,abs(y-1.73))
    yield "locker_vents",slots*stripe(((y-1.73+.018)%.037)-.018,.006,f.pixel),(87,100,98),.53,0,-.58
    hatch=f.on("foredeck anchor hatch") & (f.up>.7)
    edge=np.maximum(abs(x)-.30,abs(z-3.43)-.147)
    yield "hatch_reveal",hatch*stripe(edge,.006,f.pixel),(124,132,120),.42,0,-.35
    lid=f.on("formed sport hardtop") & (f.up>.62)
    for xx in (-.54,.54):
        edge=np.maximum(abs(x-xx)-.31,abs(z+.52)-.37)
        yield "vent_seal",lid*stripe(edge,.014,f.pixel),(67,77,73),.53,0,-.39
    cabin=f.on("hardtop carbon underside") & (f.up<-.61)
    lamp=np.hypot(abs(x)-.87,np.minimum(abs(z-.61),abs(z+1.17)))
    yield "liner_downlight",cabin*fade(.057,.044,lamp),(207,206,174),.27,.15,.20
