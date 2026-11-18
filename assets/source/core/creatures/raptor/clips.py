"""Contact-solved raptor movement at 30 Hz. Rotations below use the animal's
axes, so left and right wrists fold toward each other and the toe planes agree.
"""
import math
import bpy
import numpy as np
from mathutils import Quaternion, Vector
from plan import BONES, LEG, mirror, to_blender

TAU=math.tau
R=bpy.data.objects["raptor"]
BODY=bpy.data.objects["raptor_model"]
REST={n:R.data.bones[n].matrix_local.to_quaternion() for n,_,_,_ in BONES}
PARENT={n:p for n,p,_,_ in BONES}
FRAME={}
SHIFT=Vector()
def ease(x):
    x=max(0,min(1,x))
    return x*x*(3-2*x)
def bump(t,begin,peak,end):
    return ease((t-begin)/(peak-begin)) if t<peak else ease((end-t)/(end-peak))
def rotation(p=0,y=0,r=0):
    def axis(v,degrees): return Quaternion(to_blender(v),math.radians(degrees))
    return axis((0,1,0),y) @ axis((1,0,0),p) @ axis((0,0,1),r)
def world(n,q):
    parent=FRAME.get(PARENT[n],Quaternion())
    R.pose.bones[n].rotation_quaternion=REST[n].inverted() @ parent.inverted() @ q @ REST[n]
    FRAME[n]=q
def local(n,p=0,y=0,r=0):
    world(n,FRAME.get(PARENT[n],Quaternion()) @ rotation(p,y,r))
def root(drop=0,pitch=0,roll=0,sway=0,advance=0):
    global SHIFT
    SHIFT=to_blender((sway,-drop,advance))
    R.pose.bones["pelvis"].location=REST["pelvis"].inverted() @ SHIFT
    world("pelvis",rotation(pitch,0,roll))
def neck(p=0,y=0,jaw=0,reach=0):
    local("chest",.12*p,.08*y)
    local("neck_1",.43*p+reach,.28*y)
    local("neck_2",.28*p-reach*.49,.32*y)
    local("skull",.17*p-reach*.51,.32*y)
    local("jaw",jaw)
def tail(t,amp=1,lift=0,curve=0):
    for i in range(1,6):
        local(f"tail_{i}",lift*(.34 if i<3 else .11)+.42*amp*math.sin(TAU*t-i*.46),
              curve*(.22 if i<4 else .17)+amp*(1.30+i*.24)*math.sin(TAU*t-i*.53))
def arms(side,raise_=0,sweep=0,fold=0):
    sg=1 if side=="l" else -1
    local("humerus_"+side,-.68*raise_,sg*.23*sweep,sg*sweep)
    local("forearm_"+side,.47*raise_+fold,-sg*.56*sweep,-sg*.46*sweep)
    local("manus_"+side,-.23*raise_-.37*fold,-sg*.14*sweep)
def foot(side,forward=0,up=0,ankle_angle=0,toe_angle=0,lateral=0):
    sg=1 if side=="l" else -1
    hip,knee,hock,pad=[to_blender(mirror(p,sg)) for p in LEG]
    pivot=R.data.bones["pelvis"].head_local
    origin=pivot+FRAME["pelvis"]@(hip-pivot)+SHIFT
    metatarsal=rotation(ankle_angle)
    ankle=pad+to_blender((lateral,up,forward))-metatarsal@(pad-hock)
    delta=ankle-origin; d=delta.length; axis=delta.normalized()
    l1=(knee-hip).length; l2=(hock-knee).length
    if d>=l1+l2: raise RuntimeError(f"Overextended {side} hindfoot by {d-l1-l2:.4f} m")
    line=to_blender((.07*sg,0,1)); pole=(line-axis*line.dot(axis)).normalized()
    proj=(l1*l1-l2*l2+d*d)/(2*d)
    kneecap=origin+axis*proj+pole*math.sqrt(max(0,l1*l1-proj*proj))
    world("thigh_"+side,(knee-hip).normalized().rotation_difference((kneecap-origin).normalized()))
    world("shank_"+side,(hock-knee).normalized().rotation_difference((ankle-kneecap).normalized()))
    world("metatarsus_"+side,metatarsal)
    world("toes_"+side,rotation(toe_angle))
def stand():
    foot("l"); foot("r")
def gait(t,run):
    stride=3.33 if run else 1.92
    ground=.31 if run else .54
    osc=math.cos(2*TAU*t)
    root((.050+.034*math.sin(2*TAU*t-.36)) if run else (.040+.018*osc),
         4.7 if run else 1.1,1.8*math.sin(TAU*t),.014*math.sin(TAU*t))
    neck((4.5 if run else .3)+1.65*osc,-1.5*math.sin(TAU*t),2.8 if run else .65,
         (7 if run else 2)+2*osc)
    tail(t,1.6 if run else .95,5 if run else 1)
    for side,offset in (("l",0),("r",.5)):
        a=(t+offset)%1
        if a<=ground:
            foot(side,stride*(ground/2-a),ankle_angle=(-28+52*ease(a/ground)) if run else 0)
        else:
            t1=(a-ground)/(1-ground); wave=math.sin(math.pi*t1)
            span=stride*(ground*(ease(t1)-.5)-(1-ground)*t1*(1-t1)*(1-2*t1))
            foot(side,span,(.224 if run else .135)*wave**1.25,
                 (24-52*ease(t1) if run else 0)+(14 if run else 16)*math.sin(TAU*t1)*wave,(27 if run else 14)*math.sin(TAU*t1)*wave)
        arms(side,9*math.sin(TAU*a+.3),5 if run else 1.5,-4 if run else 1)
def settle(t,amount,breath):
    root(.68*amount,3*amount,76*amount,sway=.046*amount)
    neck(25*amount+breath,-24*amount,1.5*amount,5*amount)
    tail(t,.22,0,23*amount)
    for side,sg in (("l",1),("r",-1)):
        local("thigh_"+side,-(45 if sg>0 else 32)*amount,r=-sg*13*amount)
        local("shank_"+side,61*amount)
        local("metatarsus_"+side,-55*amount)
        local("toes_"+side,15*amount)
        arms(side,10*amount,-6*amount,24*amount)
    # Set the skinned flank on the floor throughout the fold to the side.
    bpy.context.view_layer.update()
    mesh=BODY.evaluated_get(bpy.context.evaluated_depsgraph_get()).data
    points=np.empty(3*len(mesh.vertices),np.float32)
    mesh.vertices.foreach_get("co",points)
    R.pose.bones["pelvis"].location+=REST["pelvis"].inverted()@Vector((0,0,-float(points[2::3].min())))
def act(name,t):
    phase=math.sin(TAU*t)
    if name in ("walk","run"):
        gait(t,name=="run"); return
    if name in ("torpor_in","torpor_idle","torpor_out","death"):
        amount=1-ease(t) if name=="torpor_out" else 1 if name=="torpor_idle" else ease(t/(.73 if name=="death" else 1))
        settle(t,amount,.58*phase if name=="torpor_idle" else 0); return
    if name in ("flinch","torpor_eat"):
        # These are additive layers. The trunk root and both leg chains stay at identity.
        root()
        a=bump(t,0,.22 if name=="flinch" else .34,1)
        neck(-6*a if name=="flinch" else 1.2*a,10*a if name=="flinch" else 0,3*a if name=="flinch" else a*(5+4*math.sin(t*TAU*2)))
        return
    if name=="attack":
        # Open, clear the upper row, then close while the head reaches its target at tick eleven.
        a=bump(t,0,5/27,11/27); hit=bump(t,4/27,11/27,1)
        root(.014+.091*hit,3.5*hit,advance=.094*hit)
        neck(-12*a+16*hit,3*a-4*hit,36*a+.4*hit,17*hit)
        tail(t,.78,-5*hit,-4*hit); stand()
        for side in ("l","r"): arms(side,13*hit,13*hit,-6*hit)
        return
    if name in ("swim","swim_idle"):
        quiet=name=="swim_idle"
        root(.05+.01*phase,-4); neck(-8+1.4*phase,0,1)
        tail(t,.8 if quiet else 2.4)
        for side,s in (("l",1),("r",-1)):
            kick=s*phase*(.28 if quiet else 1)
            local("thigh_"+side,9+21*kick); local("shank_"+side,21-31*kick)
            local("metatarsus_"+side,-25+25*kick); local("toes_"+side,12+13*kick)
            arms(side,5+3*kick,9+3*kick,8)
        return
    if name in ("fall","jump"):
        spring=bump(t,0,.36,1) if name=="jump" else 1
        root(.056*spring,4*spring); neck(-7*spring,0,3*spring)
        tail(t,.68,2*spring)
        for side,sg in (("l",1),("r",-1)):
            local("thigh_"+side,-26*spring+sg*2*phase); local("shank_"+side,42*spring)
            local("metatarsus_"+side,-26*spring); local("toes_"+side,10*spring)
            arms(side,14*spring,21*spring,4*spring)
        return
    if name=="land":
        impact=bump(t,0,.19,1)
        root(.195*impact,5*impact); neck(8*impact,0,3*impact)
        tail(t,.52,-4*impact); stand()
        for side in ("l","r"): arms(side,8*impact,19*impact,8*impact)
        return
    if name=="turn":
        root(.030,roll=2.2*phase); neck(-2,15*bump(t,0,.27,1),1); tail(t,1.1)
        for side,sg in (("l",1),("r",-1)):
            a=(t+(.5 if sg<0 else 0))%1
            foot(side,sg*.090*math.cos(TAU*a),.105*max(0,math.sin(TAU*a)),lateral=-sg*.033*math.sin(TAU*a))
        return
    breathe=math.sin(t*TAU)
    look=bump(t,.08,.41,.97) if name=="idle_look" else 0
    cry=bump(t,.05,.33,.91) if name=="call" else 0
    start=bump(t,0,.21,1) if name=="startled" else 0
    root(.005+.004*breathe+.022*start,-.7*cry)
    neck(1.55*breathe-11*look-23*cry-13*start,1.6*breathe+46*look-9*cry-16*start,
         .6+.36*breathe+cry*(34+2.6*math.sin(3*t*TAU))+17*start)
    tail(t,.58+start*.6,0,4*look)
    for side in ("l","r"): arms(side,1.4*breathe+2*cry,13*start,1*breathe)
    stand()
def build():
    actions={"idle":76,"idle_look":63,"walk":18,"run":12,"turn":24,"swim":24,"swim_idle":57,
             "fall":32,"jump":20,"land":19,"attack":27,"call":53,"startled":27,"flinch":13,
             "torpor_in":44,"torpor_idle":70,"torpor_eat":34,"torpor_out":53,"death":43}
    R.animation_data_create()
    for name,count in actions.items():
        action=bpy.data.actions.new(name); R.animation_data.action=action
        for frame in range(count+1):
            bpy.context.scene.frame_set(frame)
            FRAME.clear()
            for pb in R.pose.bones:
                pb.rotation_quaternion=Quaternion(); pb.location=(0,0,0)
            act(name,frame/count)
            for pb in R.pose.bones:
                pb.keyframe_insert(data_path="rotation_quaternion",frame=frame,group=pb.name)
                if pb.name=="pelvis": pb.keyframe_insert(data_path="location",frame=frame,group=pb.name)
    R.animation_data.action=None
    for pb in R.pose.bones:
        pb.rotation_quaternion=Quaternion();pb.location=(0,0,0)
    bpy.context.scene.frame_set(0)
if __name__=="__main__": build()
