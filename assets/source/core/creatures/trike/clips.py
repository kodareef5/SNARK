"""Original 30 Hz Trike performances, solved on the final anatomical rig.

Ground contact is explicit. Each stance foot travels backwards by exactly the
declared distance per cycle; two-bone geometry solves its attached leg without
bone translations. Native clips retain only joint rotations and root motion.
"""

import math

import bpy
from mathutils import Matrix, Quaternion, Vector

from plan import BONES, FPS, GROUND, LEGS, STRIDES, hooves, pads, point_blender, to_animal, to_blender
from parts import Part

R=bpy.data.objects['trike']
REST={n:(Vector(a),Vector(b)) for n,_,a,b in BONES}
CLIPS={}
LYING_BASE={}
PAD_POINTS={}


def smooth(t):
    t=max(0,min(1,t));return t*t*(3-2*t)


def pulse(t,start,peak,end):
    return smooth((t-start)/(peak-start)) if t<peak else 1-smooth((t-peak)/(end-peak))


def rotation(pitch=0,yaw=0,roll=0):
    return (Quaternion(to_blender((0,1,0)),math.radians(yaw))
            @ Quaternion(to_blender((1,0,0)),math.radians(pitch))
            @ Quaternion(to_blender((0,0,1)),math.radians(roll)))


def reset():
    for pb in R.pose.bones:
        pb.location=(0,0,0);pb.rotation_quaternion=Quaternion();pb.scale=(1,1,1)


def turn(name,pitch=0,yaw=0,roll=0):
    rest=R.data.bones[name].matrix_local.to_quaternion()
    R.pose.bones[name].rotation_quaternion=rest.inverted()@rotation(pitch,yaw,roll)@rest


def root(drop=.08,pitch=0,roll=0,sway=0,forward=0):
    pivot=point_blender(REST['body'][0])
    transform=Matrix.Translation(pivot+to_blender((sway,-drop,forward)))@rotation(pitch,0,roll).to_matrix().to_4x4()@Matrix.Translation(-pivot)
    R.pose.bones['body'].matrix=transform@R.data.bones['body'].matrix_local


def point_bone(name,head,tail,plane=None,orientation=None):
    bone=R.data.bones[name]
    original=(bone.tail_local-bone.head_local).normalized()
    target=(tail-head).normalized()
    if orientation is not None:
        mat=orientation.to_matrix()@bone.matrix_local.to_3x3()
    elif plane:
        # Upper and lower bones share their anatomical bend plane. Choosing
        # the shortest independent rotation for each aim silently adds axial
        # twist during a side roll, even though the joint positions look right.
        before,after=plane
        a=Matrix((before,original,before.cross(original))).transposed()
        b=Matrix((after,target,after.cross(target))).transposed()
        mat=b@a.transposed()@bone.matrix_local.to_3x3()
    else:mat=original.rotation_difference(target).to_matrix()@bone.matrix_local.to_3x3()
    out=mat.to_4x4();out.translation=head
    R.pose.bones[name].matrix=out
    bpy.context.view_layer.update()


def foot(end,side,target,pitch=0,pole_lift=0,roll=0,orientation=None,toe_orientation=None,pole_point=None):
    """Place a complete bent leg. The toe origin is its planted contact anchor."""
    names=[f'{end}_{part}_{side}' for part in ('upper','lower','foot','toes')]
    upper,lower,ankle,toes=names
    sign=1 if side=='l' else -1
    chain=[Vector((p[0]*sign,p[1],p[2])) for p in LEGS[end]]
    toe=point_blender(target)
    foot_q=orientation if orientation is not None else rotation(pitch=pitch,roll=roll)
    toe_q=toe_orientation if toe_orientation is not None else foot_q
    ankle_target=toe+foot_q@to_blender(chain[2]-chain[3])
    bpy.context.view_layer.update()
    hip=R.pose.bones[upper].head.copy()
    delta=ankle_target-hip;distance=delta.length
    length1=(chain[1]-chain[0]).length;length2=(chain[2]-chain[1]).length
    if distance>=length1+length2-.001:
        raise RuntimeError(f'{CLIPS.get("current")} {bpy.context.scene.frame_current}: {end}_{side} leg overextended by {distance-length1-length2:.4f} m')
    axis=delta.normalized()
    pole=to_blender(chain[1]-(chain[0]+chain[2])*.5)
    # Pole follows the body's facing, but keeps a pronounced anatomical bend.
    root_turn=R.pose.bones['body'].matrix.to_quaternion()@R.data.bones['body'].matrix_local.to_quaternion().inverted()
    pole=root_turn@pole
    pole+=to_blender((0,pole_lift,0))
    if pole_point is not None:pole=pole_point-(hip+ankle_target)*.5
    pole-=axis*pole.dot(axis);pole.normalize()
    a=(length1*length1-length2*length2+distance*distance)/(2*distance)
    knee=hip+axis*a+pole*math.sqrt(max(0,length1*length1-a*a))
    rest_plane=to_blender(chain[1]-chain[0]).cross(to_blender(chain[2]-chain[1])).normalized()
    posed_plane=(knee-hip).cross(ankle_target-knee).normalized()
    point_bone(upper,hip,knee,(rest_plane,posed_plane))
    point_bone(lower,knee,ankle_target,(rest_plane,posed_plane))
    point_bone(ankle,ankle_target,toe,orientation=foot_q)
    toe_end=toe+toe_q@to_blender(REST[toes][1]-REST[toes][0])
    point_bone(toes,toe,toe_end,orientation=toe_q)


def relaxed_support(end,side):
    """Retain the authored relaxed wrist/ankle, lifting its actual pad if needed.

    Offline source IK follows the keyed knee direction. It does not hold a
    world-flat sole while twisting the limb beneath a rolling torso.
    """
    if end not in PAD_POINTS:
        points=[]
        for _,centre,radii,sides,rings in pads(end):
            points.extend(Part('support').ellipsoid(centre,radii,(0,0,1,1),sides,rings).points)
        for _,sections in hooves(end):points.extend(p for section in sections for p in section)
        origin=Vector(LEGS[end][-1])
        PAD_POINTS[end]=[Vector((p[0],max(.065,p[1]),p[2]))-origin for p in points]
    bpy.context.view_layer.update()
    ankle=f'{end}_foot_{side}';toes=f'{end}_toes_{side}'
    def orientation(name):
        return R.pose.bones[name].matrix.to_quaternion()@R.data.bones[name].matrix_local.to_quaternion().inverted()
    ankle_q=orientation(ankle);toe_q=orientation(toes)
    toe=R.pose.bones[toes].head.copy();knee=R.pose.bones[f'{end}_lower_{side}'].head.copy()
    sign=1 if side=='l' else -1
    low=min((toe+toe_q@to_blender((p.x*sign,p.y,p.z))).z for p in PAD_POINTS[end])
    toe.z+=max(0,.001-low)
    target=to_animal(toe);target.y+=GROUND
    foot(end,side,target,orientation=ankle_q,toe_orientation=toe_q,pole_point=knee)


def planted():
    for end,points in LEGS.items():
        for side,sign in (('l',1),('r',-1)):
            p=points[-1];foot(end,side,(p[0]*sign,p[1],p[2]))


def lids(amount):
    turn('lid_l',roll=-68*amount);turn('lid_r',roll=68*amount)


def life(t,drop=.08):
    root(drop=drop+.009*math.sin(t*math.tau))
    turn('chest',pitch=.3*math.sin(t*math.tau))
    turn('neck',pitch=.6*math.sin(t*math.tau+.5))
    turn('skull',pitch=-.3*math.sin(t*math.tau+.5))
    turn('tail_1',yaw=1.4*math.sin(t*math.tau))
    turn('tail_2',yaw=2.0*math.sin(t*math.tau-.5))
    turn('tail_3',yaw=2.4*math.sin(t*math.tau-1.0))
    turn('tail_tip',yaw=3*math.sin(t*math.tau-1.3))
    lids(pulse(t,.71,.75,.79))
    planted()


def gait(name,t):
    fast=name!='walk';charge=name=='charge'
    stride=STRIDES[name];stance=.39 if fast else .60
    drop=(.38 if charge else .34 if fast else .14)+(.025 if fast else .012)*math.cos(t*math.tau*2)
    root(drop=drop,pitch=3 if charge else 1.0*math.sin(t*math.tau*2),roll=(.6 if fast else .9)*math.sin(t*math.tau))
    turn('neck',pitch=13 if charge else -1.8*math.sin(t*math.tau*2))
    turn('skull',pitch=-4 if charge else 1.2*math.sin(t*math.tau*2))
    phases={('front','l'):0,('back','r'):(.12 if fast else .25),('front','r'):.5,('back','l'):(.62 if fast else .75)}
    for (end,side),offset in phases.items():
        phase=(t+offset)%1
        sign=1 if side=='l' else -1
        contact=LEGS[end][-1]
        if phase<=stance:
            z=stride*(stance*.5-phase);lift=0;angle=0
        else:
            s=(phase-stance)/(1-stance)
            # Keep the stance's backwards velocity through toe-off and
            # touchdown, while the raised foot accelerates forward between.
            # A zero-velocity ease here creates slide in the low swing ticks.
            h01=3*s*s-2*s*s*s;h10=s*s*s-2*s*s+s;h11=s*s*s-s*s
            z=stride*stance*(h01-.5)-stride*(1-stance)*(h10+h11)
            lift=(.27 if fast else .17)*math.sin(math.pi*s)**1.4
            angle=-12*math.sin(math.pi*s)
        foot(end,side,(contact[0]*sign,contact[1]+lift,contact[2]+z),angle)
    for k,name in enumerate(('tail_1','tail_2','tail_3','tail_tip')):
        turn(name,yaw=(2.2+k*.8)*math.sin(t*math.tau-k*.45),pitch=.8*math.sin(t*math.tau*2-k*.3))


def attack(t):
    # Anticipate down and back, drive the horns forwards/up through contact,
    # then restore the heavy head without an elastic overshoot.
    prepare=pulse(t,0,.23,.49);strike=pulse(t,.18,.48,.85)
    root(drop=.08+.045*prepare)
    turn('neck',pitch=24*prepare-14*strike,yaw=5*math.sin(t*math.tau)*strike)
    turn('skull',pitch=11*prepare-6*strike,yaw=-3*strike)
    turn('jaw',pitch=2*strike)
    planted()


def windup(t):
    w=smooth(t)
    root(drop=.08+.30*w,pitch=3*w)
    turn('neck',pitch=13*w)
    turn('skull',pitch=-4*w)
    turn('tail_1',pitch=3*w)
    # Alternating small weight shifts retain every pad on the ground.
    planted()


def stop(t):
    # Begins in the planted charge stance and settles back to ordinary idle.
    w=1-smooth(t)
    root(drop=.08+.30*w,pitch=3*w-3*pulse(t,0,.24,.7))
    turn('neck',pitch=13*w-4*pulse(t,0,.2,.7))
    turn('skull',pitch=-4*w)
    planted()


def swimming(t,idle=False):
    root(drop=.10,pitch=3+.6*math.sin(t*math.tau))
    turn('neck',pitch=-10);turn('skull',pitch=3)
    for end in LEGS:
        for side,phase in (('l',0),('r',.5)):
            w=math.sin((t+phase+(.25 if end=='back' else 0))*math.tau)
            turn(f'{end}_upper_{side}',pitch=(12 if idle else 25)*w)
            turn(f'{end}_lower_{side}',pitch=25-12*w)
            turn(f'{end}_foot_{side}',pitch=-12+5*w)
    for k,name in enumerate(('tail_1','tail_2','tail_3','tail_tip')):turn(name,yaw=(3+k)*math.sin(t*math.tau-k*.4))


def lying(t=0,amount=1,alive=True):
    if not LYING_BASE:
        root(drop=.08);planted()
        for end in LEGS:
            for side in 'lr':
                for joint in ('upper','lower','foot','toes'):
                    name=f'{end}_{joint}_{side}'
                    LYING_BASE[name]=R.pose.bones[name].rotation_quaternion.copy()
    # Settle the flank onto the floor instead of resting the torso above two
    # folded feet. Lower pads remain solved, while the shield tilts into its
    # own support; this is authored motion, not a reviewer-only translation.
    root(drop=.08+.458*amount,roll=72*amount)
    turn('chest',pitch=.25*amount*math.sin(t*math.tau) if alive else 0)
    turn('neck',pitch=-3*amount,yaw=1*amount)
    turn('skull',pitch=-5*amount,roll=6.5*amount)
    for end in LEGS:
        for side in 'lr':
            turn(f'{end}_upper_{side}',pitch=25 if end=='front' else -22,roll=-12 if side=='l' else 26)
            turn(f'{end}_lower_{side}',pitch=-38 if end=='front' else 25)
            turn(f'{end}_foot_{side}',pitch=20 if end=='front' else -8)
            turn(f'{end}_toes_{side}',pitch=12 if end=='front' else -5)
            # Start and finish at the genuinely planted idle leg, not an
            # unposed rest leg after the pelvis has already dropped 8 cm.
            for joint in ('upper','lower','foot','toes'):
                name=f'{end}_{joint}_{side}';pb=R.pose.bones[name]
                pb.rotation_quaternion=LYING_BASE[name].slerp(pb.rotation_quaternion,amount)
        relaxed_support(end,'r')
    turn('tail_1',yaw=6.8*amount);turn('tail_2',yaw=9*amount);turn('tail_3',yaw=6*amount)
    turn('jaw',pitch=(.8+.5*math.sin(t*math.tau))*amount if alive else .8*amount)
    lids(amount)


def turn_in_place(t):
    root(drop=.14)
    angle=smooth(t)*math.pi*.5
    for end,points in LEGS.items():
        for side,sign in (('l',1),('r',-1)):
            p=points[-1];phase=(t*2+(0 if side=='l' else .5))%1
            # Small alternating steps follow a quarter turn; runtime rotates
            # the body, so the stationary world contacts rotate back locally.
            ahead=.13*math.sin(phase*math.tau)
            lift=.16*max(0,math.sin(phase*math.tau))
            foot(end,side,(p[0]*sign+ahead*.4,p[1]+lift,p[2]+ahead))
    turn('neck',yaw=5*math.sin(math.pi*t));turn('tail_1',yaw=-5*math.sin(math.pi*t))


def flinch(t):
    # Additive reactions start/end at the exact rest pose and never turn legs.
    w=pulse(t,0,.18,1)
    turn('neck',pitch=5*w,yaw=-6*w);turn('skull',pitch=-4*w)
    turn('jaw',pitch=3*w)


def build_clip(name,frames,fn,loop=False):
    R.animation_data_create();R.animation_data.action=None
    action=bpy.data.actions.new(name)
    R.animation_data.action=action
    CLIPS['current']=name
    for frame in range(frames+1):
        bpy.context.scene.frame_set(frame)
        reset();fn(frame/frames)
        bpy.context.view_layer.update()
        for pb in R.pose.bones:
            if pb.name!='body' and pb.location.length>.0001:
                raise RuntimeError(f'{name} frame {frame}: non-root translation {pb.name} {pb.location.length:.6f}')
            pb.keyframe_insert(data_path='rotation_quaternion',frame=frame,group=pb.name)
            if pb.name=='body':pb.keyframe_insert(data_path='location',frame=frame,group=pb.name)
    # Sampling, not spline interpolation, defines each 30 Hz tick.
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for fc in bag.fcurves:
                    for key in fc.keyframe_points:key.interpolation='LINEAR'
    CLIPS[name]={'frames':frames,'loop':loop}
    print(f'trike clip: {name}, {frames} ticks, loop={loop}')


def build():
    build_clip('idle',120,life,True)
    build_clip('walk',34,lambda t:gait('walk',t),True)
    build_clip('run',24,lambda t:gait('run',t),True)
    build_clip('charge',24,lambda t:gait('charge',t),True)
    build_clip('attack',20,attack)
    build_clip('charge_windup',60,windup)
    build_clip('charge_stop',24,stop)
    build_clip('turn',42,turn_in_place)
    build_clip('swim',48,lambda t:swimming(t),True)
    build_clip('swim_idle',90,lambda t:swimming(t,True),True)
    def look(t):
        life(t);turn('neck',yaw=18*pulse(t,0,.45,1),pitch=3*pulse(t,0,.3,1));turn('skull',yaw=5*pulse(t,0,.48,1))
    build_clip('idle_look',110,look)
    def graze(t):
        life(t);w=pulse(t,0,.38,1);turn('neck',pitch=26*w);turn('skull',pitch=22*w);turn('jaw',pitch=4*w*abs(math.sin(t*math.tau*4)))
    build_clip('idle_graze',150,graze)
    def call(t):
        life(t);w=pulse(t,0,.35,1);turn('neck',pitch=-8*w);turn('skull',pitch=-4*w);turn('jaw',pitch=11*w)
    build_clip('call',70,call)
    def startled(t):
        life(t);w=pulse(t,0,.18,1);turn('neck',pitch=-6*w,yaw=-7*w);turn('skull',pitch=-4*w)
    build_clip('startled',40,startled)
    build_clip('flinch',18,flinch)
    def fall(t):
        pulse=math.sin(t*math.tau)
        root(drop=.08,pitch=3);turn('neck',pitch=-7+.6*pulse)
        for end in LEGS:
            for side in 'lr':
                flex=1.5*math.sin(t*math.tau+(0 if side=='l' else math.pi))
                turn(f'{end}_upper_{side}',pitch=12+flex);turn(f'{end}_lower_{side}',pitch=-22-flex)
    build_clip('fall',45,fall,True)
    def land(t):
        root(drop=.08+.22*pulse(t,0,.23,1));turn('neck',pitch=5*pulse(t,0,.23,1));planted()
    build_clip('land',24,land)
    build_clip('torpor_in',65,lambda t:lying(t,smooth(t)))
    build_clip('torpor_idle',120,lambda t:lying(t),True)
    def eat(t):
        w=math.sin(t*math.pi)**2;turn('jaw',pitch=4*w*abs(math.sin(t*math.tau*3)));turn('skull',pitch=.5*w)
    build_clip('torpor_eat',36,eat)
    build_clip('torpor_out',85,lambda t:lying(1-t,1-smooth(t)))
    build_clip('death',75,lambda t:lying(t,smooth(t/.70),False))
    R.animation_data.action=None
    reset();bpy.context.scene.frame_set(0);bpy.context.view_layer.update()


if __name__=='__main__':build()
