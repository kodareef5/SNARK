"""30 Hz original behaviour. Solve the supporting limbs in animal space."""
import math
import bpy
import numpy as np
from mathutils import Quaternion,Vector
from plan import BONES,HIND_JOINTS,FORE_JOINTS,blender

R=bpy.data.objects['parasaur']
REST={name:R.data.bones[name].matrix_local.to_quaternion() for name,*_ in BONES}
PARENT={n:p for n,p,*_ in BONES}
G={}
SHIFT=Vector()
TAU=math.tau
def vec(p):return Vector(blender(p))
def smooth(x):
    x=max(0,min(1,x));return x*x*(3-2*x)
def pulse(t,a,b,c):return smooth((t-a)/(b-a)) if t<=b else 1-smooth((t-b)/(c-b))
def rot(pitch=0,yaw=0,roll=0):
    def q(axis,angle):return Quaternion(vec(axis),math.radians(angle))
    return q((0,1,0),yaw)@q((1,0,0),pitch)@q((0,0,1),roll)
def absolute(name,target):
    parent=G.get(PARENT[name],Quaternion())
    R.pose.bones[name].rotation_quaternion=REST[name].inverted()@parent.inverted()@target@REST[name]
    G[name]=target
def turn(name,pitch=0,yaw=0,roll=0):
    absolute(name,G.get(PARENT[name],Quaternion())@rot(pitch,yaw,roll))
def reset():
    G.clear()
    for name in REST:
        R.pose.bones[name].rotation_quaternion=Quaternion()
        R.pose.bones[name].location=(0,0,0)
def root(drop=0,pitch=0,roll=0,sway=0,forward=0):
    global SHIFT
    SHIFT=vec((sway,-drop,forward))
    R.pose.bones['pelvis'].location=REST['pelvis'].inverted()@SHIFT
    absolute('pelvis',rot(pitch,0,roll))
def head(pitch=0,yaw=0,jaw=0,chest=0):
    turn('chest',chest,.07*yaw)
    turn('neck_1',.38*pitch,.27*yaw)
    turn('neck_2',.43*pitch,.37*yaw)
    turn('skull',.19*pitch,.29*yaw)
    turn('jaw',jaw)
def tail(t,amp=1,bend=0):
    for i in range(1,6):
        turn(f'tail_{i}',amp*.51*math.sin(TAU*t-i*.37),bend/(.84+i*.07)+amp*(1.1+.27*i)*math.sin(TAU*t-i*.57))
def origin(name):
    if name=='pelvis':
        return R.data.bones[name].head_local+SHIFT
    parent=PARENT[name]
    return origin(parent)+G.get(parent,Quaternion())@(R.data.bones[name].head_local-R.data.bones[parent].head_local)
def support(side,hind,step=0,lift=0,ankle_pitch=0,foot_pitch=0,across=0):
    sg=1 if side=='l' else -1
    pivots=HIND_JOINTS if hind else FORE_JOINTS
    v=[vec((sg*x,h,z)) for x,h,z in pivots]
    names=(['thigh','shank','hock','toes'] if hind else ['upper_arm','forearm','manus'])
    names=[n+'_'+side for n in names]
    start=origin(names[0])
    target=v[-1]+vec((across,lift,step))
    q=rot(ankle_pitch)
    joint=target-q@(v[3]-v[2]) if hind else target
    d=joint-start
    axis=d.normalized(); l1=(v[1]-v[0]).length; l2=(v[2]-v[1]).length
    length=max(abs(l1-l2)+.0001,min(l1+l2-.0001,d.length))
    pole=vec((.08*sg,0,1 if hind else -1))
    pole=(pole-axis*pole.dot(axis)).normalized()
    along=(l1*l1-l2*l2+length*length)/(2*length)
    mid=start+axis*along+pole*math.sqrt(max(0,l1*l1-along*along))
    for j,(a,b) in enumerate([(start,mid),(mid,joint)]):
        absolute(names[j],(v[j+1]-v[j]).normalized().rotation_difference((b-a).normalized()))
    if hind:absolute(names[2],q)
    absolute(names[-1],rot(foot_pitch))
def planted():
    for side in ['l','r']:
        support(side,True);support(side,False)
def swing(phase,stride,stance,clear):
    phase%=1
    if phase<=stance:return (stride*(stance*.5-phase),0,0,0)
    s=(phase-stance)/(1-stance)
    a=math.sin(math.pi*s)
    # Same horizontal velocity through touchdown and push-off.
    z=stride*(-stance*.5+smooth(s)*stance-(1-stance)*s*(1-s)*(1-2*s))
    return (z,clear*a**1.40,14*math.sin(TAU*s)*a,12*math.sin(TAU*s)*a)
def gait(t,run):
    stride=4.16 if run else 2.6
    breath=math.cos(t*TAU*2)
    root((.208 if run else .11)+(.058 if run else .027)*breath,(-8.3 if run else .35),1.3*math.sin(t*TAU),.022*math.sin(t*TAU))
    head((5 if run else -1)+1.05*breath,.8*math.sin(t*TAU),.6)
    tail(t,1.65 if run else 1)
    for side,offset in [('l',0),('r',.5)]:
        phase=t+offset
        support(side,True,*swing(phase,stride,.36 if run else .57,.515 if run else .275))
        if run:
            # Gather the manus under the brisket while the hind toes drive.
            beat=math.sin(phase*TAU)
            turn('upper_arm_'+side,25+9*beat)
            turn('forearm_'+side,-73-12*beat)
            turn('manus_'+side,19+11*beat)
        else:support(side,False,*swing(phase+.67,stride,.53,.18))
def swim(t,quiet):
    root(.12+.016*math.sin(t*TAU),-5)
    head(-8+1.8*math.sin(t*TAU),1.9*math.sin(t*TAU),2)
    tail(t,.65 if quiet else 2.45)
    for side,offset in [('l',0),('r',.5)]:
        v=math.sin(TAU*(t+offset));lag=math.sin(TAU*(t+offset)-.85)
        for name,a,b in [('thigh',12,20),('shank',-19,-25),('hock',26,16),('toes',16,12),
                          ('upper_arm',16,-16),('forearm',-33,23),('manus',6,-17)]:
            turn(name+'_'+side,a+b*(v if name in ('thigh','upper_arm') else lag)*(.28 if quiet else 1))
def recumbent(t,amount,breath):
    root(1.15*amount,pitch=2.4*amount,roll=76*amount)
    head(14*amount+breath*1.05,-17*amount,amount*1.8)
    tail(t,0.23,4.4*amount)
    for side,sg in [('l',1),('r',-1)]:
        for name,a in [('thigh',-39 if sg>0 else -29),('shank',69),('hock',-38),('toes',12),
                       ('upper_arm',25),('forearm',-62 if sg>0 else -45),('manus',19)]:
            turn(name+'_'+side,a*amount,0,(-8*sg if name in ('upper_arm','thigh') else 0)*amount)
    bpy.context.view_layer.update()
    mesh=bpy.data.objects['parasaur_model'].evaluated_get(bpy.context.evaluated_depsgraph_get())
    vertices=np.empty(len(mesh.data.vertices)*3,np.float32)
    mesh.data.vertices.foreach_get('co',vertices)
    R.pose.bones['pelvis'].location+=REST['pelvis'].inverted()@Vector((0,0,-float(vertices[2::3].min())))
def animate(name,t):
    if name in ('walk','run'):gait(t,name=='run');return
    if name in ('swim','swim_idle'):swim(t,name=='swim_idle');return
    if name in ('torpor_in','death','torpor_out','torpor_idle'):
        amount=smooth(t/.83) if name in ('torpor_in','death') else 1-smooth(t) if name=='torpor_out' else 1
        recumbent(t,amount,math.sin(TAU*t) if name=='torpor_idle' else 0);return
    if name=='torpor_eat':
        turn('jaw',8.2*math.sin(2*math.pi*t)**2)
        turn('skull',1.8*math.sin(2*math.pi*t));return
    if name=='flinch':
        recoil=pulse(t,0,.22,1);head(-5.5*recoil,-11.4*recoil,6*recoil);return
    root(.012+.009*math.sin(TAU*t))
    head(.64*math.sin(TAU*t),1.0*math.sin(TAU*t+.3),.75+.63*math.sin(TAU*t))
    tail(t,.52)
    if name=='attack':
        open_beak=pulse(t,0,6/27,11/27)
        lunge=pulse(t,3/27,11/27,1)
        root(.11*lunge,2*lunge,forward=.125*lunge)
        head(-10*open_beak+16*lunge,2.4*open_beak,25*open_beak+1.3*lunge)
    if name=='call':
        a=pulse(t,0,.27,1)
        head(-18*a+1.3*a*math.sin(TAU*t*3),4.3*a,24*a+1.4*a*math.sin(TAU*t*4))
    if name=='idle_look':
        a=pulse(t,.05,.45,.94)
        head(-7*a,-29*a,2*a)
    if name=='startled':
        a=pulse(t,0,.21,1)
        head(-15*a,-17*a,8*a)
        root(.065*a,-1.4*a)
    if name=='land':
        a=pulse(t,0,.22,1);root(.29*a,1.9*a);head(7*a,0,4*a);tail(t,.91)
    if name in ('jump','fall'):
        a=math.sin(math.pi*t) if name=='jump' else 1
        root(.12*a,-4.2*a);head(-5*a)
        for side,sg in [('l',1),('r',-1)]:
            v=sg*math.sin(TAU*t)
            for bone,p in [('thigh',-16+3*v),('shank',35),('hock',-18),('toes',13),('upper_arm',19),('forearm',-50),('manus',13)]:
                turn(bone+'_'+side,p*a)
        return
    if name=='turn':
        root(.13,0,1.4*math.sin(TAU*t))
        head(-1,-9*math.sin(math.pi*t))
        for side,o in [('l',0),('r',.5)]:
            for hind,k in [(True,0),(False,.25)]:
                s=math.sin(TAU*(t+o+k));support(side,hind,.16*s,.16*max(0,s),across=.08*s)
        return
    planted()
def build():
    durations={'idle':86,'idle_look':76,'walk':30,'run':20,'swim':35,'swim_idle':79,'turn':44,'attack':27,'call':76,
               'startled':33,'flinch':15,'jump':26,'fall':38,'land':24,'torpor_in':55,'torpor_idle':82,'torpor_eat':34,'torpor_out':69,'death':62}
    R.animation_data_create()
    for name,frames in durations.items():
        R.animation_data.action=bpy.data.actions.new(name)
        for f in range(frames+1):
            bpy.context.scene.frame_set(f);reset()
            animate(name,f/frames)
            for bone in R.pose.bones:
                bone.keyframe_insert(data_path='rotation_quaternion',frame=f,group=bone.name)
                if bone.name=='pelvis':bone.keyframe_insert(data_path='location',frame=f,group=bone.name)
    R.animation_data.action=None
    reset();bpy.context.scene.frame_set(0)
if __name__=='__main__':
    build()
