"""Steerable drives, pitched blades and a transom boarding step in the vehicle's measured frame."""
import math


def drive(g, starboard=False, outboard=False):
    d = g.d
    px, py, pz = d.secondPropeller if starboard else d.propeller
    x, y, z = d.secondOutboard if starboard else d.outboard
    sg = -1 if starboard else 1
    name = "_starboard" if starboard else ""
    g.box("transom gimbal",(x,y,z+.10),(.29,.37,.25),"engine",.074,3)
    g.rod("tilt pin",(x-.17,y,z),(x+.17,y,z),.068,"chrome")
    g.bone = "outboard"+name
    g.loft("hydrodynamic leg", [[(x-w*.65,h,a),(x+w*.65,h,a),(x+w,h,b+.022),(x+w*.60,h,b),(x-w*.60,h,b),(x-w,h,b+.022)]
                  for h,w,a,b in [(py+.025,.060,pz+.32,pz+.09),(py+.21,.072,pz+.35,pz+.08),(y+.12,.112,z+.082,pz+.11)]],"engine")
    g.box("anti-ventilation plate",(x,py+.16,pz+.17),(.32,.034,.40),"graphite",.015)
    g.rod("torpedo gearcase",(x,py,pz+.01),(x,py,pz+.37),.070,"engine",18,.012)
    g.loft("skeg", [[(x+w,py-.015,pz+.04),(x+w,py-.19,pz+.055),(x+w,py-.15,pz+.16),(x+w,py-.015,pz+.29)]
                      for w in (-.017,.017)],"engine")
    if outboard:
        rings=[]
        for h,w,a,b in ((y+.035,.110,z+.04,pz+.01),(y+.11,.151,z+.069,pz-.014),
                        (y+.40,.165,z+.067,pz-.022),(y+.49,.128,z+.02,pz+.012),(y+.51,.095,z-.025,pz+.052)):
            rings.append([(x+w*.78,h,a),(x+w,h,a-.055),(x+w,h,b+.055),(x+w*.76,h,b),
                          (x-w*.76,h,b),(x-w,h,b+.055),(x-w,h,a-.055),(x-w*.78,h,a)])
        g.loft("removable motor cowling",rings,lambda i,k: "slate" if i==1 and k in (1,5) else "engine","engine")
        for s in (-1,1):
            for k in range(4):
                g.box("cowling exhaust slot",(x+s*.150,y+.33,pz+.080+k*.037),(.026,.044,.014),"rubber",.005)
    g.bone = "propeller"+name
    radius = .133 if outboard else .193
    g.rod("propeller hub",(px,py,pz-.052),(px,py,pz+.080),radius*.37,"chrome",16)
    for i in range(3 if outboard else 4):
        a = i*math.tau/(3 if outboard else 4)
        sections=[]
        for scale, width, pitch in ((.27,.20,.0),(.55,.36,.011),(.86,.32,.034),(.99,.095,.041)):
            angle=a+sg*scale*.43
            sections.append([(px+scale*radius*math.cos(angle)-v*radius*math.sin(angle),
                              py+scale*radius*math.sin(angle)+v*radius*math.cos(angle),pz+pitch+q)
                             for v,q in ((-width,-.006),(width,.008),(width,.019),(-width,.005))])
        g.loft("pitched propeller blade",sections,"chrome")
    g.bone = "chassis"


def ladder(g,x,z,top,bottom,width):
    for side in (-1,1):
        a=x+side*width/2
        g.tube("folding ladder cheek",[(a,bottom,z),(a,top-.070,z),(a,top,z+.065),(a,top,z+.235)],.021,"chrome")
    for y in (bottom+.023,(bottom+top)/2,top-.085):
        g.rod("swim ladder rung",(x-width/2,y,z),(x+width/2,y,z),.019,"steel",10)
        g.rod("rubber step",(x-width*.39,y,z),(x+width*.39,y,z),.024,"tread",10)
