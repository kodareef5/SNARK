"""Key native joint motion; place planted feet by analytic two-link IK."""
import math
import bpy
from mathutils import Vector,Quaternion
from rig import B
from layout import BONES,LEGS
arm=bpy.data.objects['carbonemys'];tau=2*math.pi
rest={n:(par,B(a),B(b))for n,par,a,b in BONES}
ori={b.name:b.matrix_local.to_quaternion()for b in arm.data.bones}

def smooth(t):t=max(0,min(1,t));return t*t*(3-2*t)
def pulse(t,center,width):return math.exp(-((t-center)/width)**2)
def turn(name,pitch=0,yaw=0,roll=0):
    delta=Quaternion((0,0,1),math.radians(yaw)) @ Quaternion((1,0,0),math.radians(-pitch)) @ Quaternion((0,-1,0),math.radians(roll))
    arm.pose.bones[name].rotation_quaternion=ori[name].inverted()@delta@ori[name]
def root(y=0):
    arm.pose.bones['shell'].location=ori['shell'].inverted()@B((0,y,0))
def set_world(name,world,parent):
    arm.pose.bones[name].rotation_quaternion=ori[name].inverted()@parent.inverted()@world@ori[name]
def leg(key,dz,lift,spread=0,blade=0):
    h,k,a,t=[B(p) for p in LEGS[key]];kind,side=key.split('_');sign=1 if side=='l' else -1
    target=a+B((sign*spread,lift,dz));delta=target-h;d=delta.length;line=delta.normalized();la=(k-h).length;lb=(a-k).length
    d=min(la+lb-.0001,max(abs(la-lb)+.0001,d));target=h+line*d
    pole=k-h;p=pole-line*pole.dot(line);p.normalize()
    c=(la*la-lb*lb+d*d)/(2*d);joint=h+line*c+p*math.sqrt(max(0,la*la-c*c))
    q1=(k-h).rotation_difference(joint-h);q2=(a-k).rotation_difference(target-joint)
    set_world(kind+'_upper_'+side,q1,Quaternion());set_world(kind+'_lower_'+side,q2,q1)
    q3=Quaternion((0,0,1),math.radians(sign*blade));set_world(kind+'_foot_'+side,q3,q2)
def gait(t,run):
    stride=1.26;duty=.56 if run else .58
    for key in LEGS:
        front=key.startswith('fore');left=key.endswith('l')
        phase=(t+(0 if left else .5)+(0 if front else (.52 if run else .55)))%1
        if phase<=duty:
            dz=stride*(duty/2-phase);lift=0
        else:
            u=(phase-duty)/(1-duty);dz=-stride*duty/2+stride*duty*smooth(u)
            lift=(.161 if run else .116)*math.sin(math.pi*u)**1.45
        leg(key,dz,lift)
    turn('neck_1',pitch=2.2*math.cos(t*tau*2),yaw=2.4*math.sin(t*tau));turn('neck_3',pitch=-1.3*math.cos(t*tau*2))
    turn('tail_1',yaw=8*math.sin(t*tau-.6));turn('tail_2',yaw=7*math.sin(t*tau-1.2))
def paddle(t,idle):
    for key in LEGS:
        phase=t*tau+(0 if key.endswith('l') else math.pi)+(math.pi*.70 if key.startswith('hind') else 0)
        gain=.26 if idle else 1;leg(key,.28*math.cos(phase)*gain,.12+.07*math.sin(phase)*gain,.041+.085*(1-math.sin(phase))*gain,22*math.sin(phase)*gain)
    turn('neck_1',pitch=5+1.8*math.sin(t*tau));turn('neck_2',pitch=4);turn('tail_1',yaw=8*math.sin(t*tau))
    turn('tail_2',yaw=9*math.sin(t*tau-.7))
def tuck(amount):
    turn('neck_1',yaw=58*amount,pitch=-13*amount);turn('neck_2',yaw=-112*amount,pitch=7*amount)
    turn('neck_3',yaw=-12*amount);turn('skull',yaw=23*amount,pitch=-9*amount)
def pose(name,t):
    a=math.sin(t*tau)
    if name in ['walk','run']:gait(t,name=='run');return
    if name in ['swim','swim_idle']:paddle(t,name=='swim_idle');return
    if name=='attack':
        c=pulse(t,.50,.185);ready=pulse(t,.27,.12)
        turn('neck_1',pitch=-14*c+13*ready,yaw=9*ready);turn('neck_2',pitch=-14*c+9*ready,yaw=-8*ready);turn('neck_3',pitch=7*c)
        turn('skull',pitch=6*c-3*ready);turn('jaw',pitch=-33*pulse(t,.36,.15)-3*pulse(t,.52,.06));return
    if name in ['torpor_in','torpor_out','death','torpor_idle','torpor_eat']:
        amount=smooth(t/.76) if name in ['torpor_in','death'] else (1-smooth(t/.85) if name=='torpor_out' else 1)
        root(-.18*amount);tuck(.85*amount)
        for key in LEGS:leg(key,-.04*amount if key.startswith('fore') else .07*amount,.17*amount,.09*amount,8*amount)
        turn('tail_1',yaw=18*amount)
        if name in ['torpor_idle','torpor_eat']:turn('neck_3',yaw=-9*amount,pitch=1.3*a)
        turn('jaw',pitch=(-7*math.sin(math.pi*t)**2 if name=='torpor_eat' else -4*amount));return
    if name in ['flinch','startled','retract']:
        tuck(math.sin(math.pi*t)**.85*(.49 if name=='flinch' else .90));return
    if name=='call':
        turn('neck_2',pitch=11*math.sin(math.pi*t));turn('jaw',pitch=-20*math.sin(math.pi*t)**1.7);return
    if name in ['fall','land']:
        amt=(.55+.15*a if name=='fall' else 1-smooth(t))
        tuck(.56*amt)
        for key in LEGS:leg(key,.065*amt,.13*amt,.07*amt)
        return
    if name=='turn':turn('neck_1',yaw=21*math.sin(math.pi*t));turn('tail_1',yaw=-16*math.sin(math.pi*t));return
    turn('neck_1',pitch=1.8*a,yaw=2*math.sin(t*tau+.5));turn('neck_2',pitch=1.3*math.sin(t*tau+.4))
    turn('skull',yaw=(16 if name=='idle_look' else 2)*a);turn('tail_2',yaw=3*math.sin(t*tau))
def make(name,frames):
    arm.animation_data_create()
    act=bpy.data.actions.new(name);arm.animation_data.action=act
    for f in range(frames+1):
        for b in arm.pose.bones:b.rotation_mode='QUATERNION';b.rotation_quaternion=(1,0,0,0);b.location=(0,0,0)
        pose(name,f/frames)
        for b in arm.pose.bones:b.keyframe_insert(data_path='rotation_quaternion',frame=f)
        arm.pose.bones['shell'].keyframe_insert(data_path='location',frame=f)
    arm.animation_data.action=None
for n,k in [('idle',90),('idle_look',70),('walk',36),('run',18),('turn',30),('swim',30),('swim_idle',84),('attack',24),('retract',36),('call',45),('startled',27),('flinch',15),('fall',24),('land',32),('torpor_in',54),('torpor_idle',84),('torpor_eat',32),('torpor_out',62),('death',56)]:make(n,k)
