"""Bake original pigments to the Blender UVs. Run from any directory after sculpt.py."""
from pathlib import Path
import sys
import numpy as np
from PIL import Image

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent))
from plan import AXIS, CREST, interpolate

SCULPT=HERE.parent/'skin.npz'
M=np.load(SCULPT)
def smooth(a,b,t):
    v=np.clip((t-a)/(b-a),0,1)
    return v*v*(3-2*v)
def gaussian(t):return np.exp(-np.minimum(80,t*t))
def blend(a,b,v): return a+(b-a)*v[...,None]
def rgb(r,g,b):return np.stack(np.broadcast_arrays(r,g,b),axis=-1)
def pigment(v):return np.array(v,dtype=np.float32)
def rnd(x,y,n=0):return (np.sin(x*127.1+y*311.7+n*13.19)*43758.5453)%1
def clouds(x,y,n):
    i=np.floor(x);j=np.floor(y);u=smooth(0,1,x-i);v=smooth(0,1,y-j)
    return (rnd(i,j,n)*(1-u)+rnd(i+1,j,n)*u)*(1-v)+(rnd(i,j+1,n)*(1-u)+rnd(i+1,j+1,n)*u)*v
def pebbles(a,b):
    i=np.floor(a);j=np.floor(b)
    near=np.full(a.shape,9.);second=near.copy();ident=near.copy()
    for di in [-1,0,1]:
        for dj in [-1,0,1]:
            x=i+di;y=j+dj
            val=rnd(x,y,21)
            d=(a-x-.14-.72*val)**2+(b-y-.14-.72*rnd(x,y,8))**2
            win=d<near
            second=np.where(win,near,np.minimum(second,d))
            near=np.minimum(near,d)
            ident=np.where(win,val,ident)
    ridge=smooth(.006,.20,np.sqrt(second)-np.sqrt(near))
    return ridge*(1-.31*smooth(.02,.55,near)),ident

def raster(index,N):
    pos=np.zeros((N,N,3),dtype=np.float32)
    tags=np.full((N,N),255,np.uint8)
    for tri,uv,slot,tag in zip(M['tri'],M['uv'],M['slots'],M['coat']):
        if slot!=index:continue
        coord=uv.copy()*N
        coord[:,1]=N-coord[:,1]
        x0,y0=np.maximum(0,np.floor(coord.min(0)).astype(int))
        x1,y1=np.minimum(N,np.ceil(coord.max(0)).astype(int)+1)
        if x1<=x0 or y1<=y0:continue
        a,b,c=coord
        det=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
        if abs(det)<1e-5:continue
        iy,ix=np.mgrid[y0:y1,x0:x1]
        ix=ix+.5;iy=iy+.5
        wa=((b[1]-c[1])*(ix-c[0])+(c[0]-b[0])*(iy-c[1]))/det
        wb=((c[1]-a[1])*(ix-c[0])+(a[0]-c[0])*(iy-c[1]))/det
        wc=1-wa-wb
        valid=(wa>=0)&(wb>=0)&(wc>=0)
        pts=M['points'][tri]
        pos[y0:y1,x0:x1][valid]=(wa[...,None]*pts[0]+wb[...,None]*pts[1]+wc[...,None]*pts[2])[valid]
        tags[y0:y1,x0:x1][valid]=tag
    # Extrude pixels outside the islands so game mips keep the same pigment.
    for step in [1,1,2,4,8,16,32,64,128,256,512,1024]:
        if (tags!=255).all():break
        for axis,d in [(0,step),(1,-step),(0,-step),(1,step)]:
            copied=np.roll(tags,d,axis)
            empty=(tags==255)&(copied!=255)
            pos[empty]=np.roll(pos,d,axis)[empty]
            tags[empty]=copied[empty]
    print('UV map',index,N,flush=True)
    return pos,tags

def field(p,tag):
    x,h,z=p.T
    x=np.abs(x)
    body=interpolate(AXIS)
    low=np.interp(z,body[:,0],body[:,2]); high=np.interp(z,body[:,0],body[:,3])
    side=(h-low)/np.maximum(.08,high-low)
    uv=z*1.18+x*.45
    elev=h+.52*x
    cloud=clouds(uv*3.1,elev*3.0,0)-.5
    fine=clouds(uv*14,elev*19,2)-.5
    dist=clouds(uv*1.48,elev*1.24,13)-.5
    # The four main pigment fields. Oblique broken bars descend from the nape
    # across the ribs, picking up again as rings around the narrowing tail.
    bars_phase=z*11.9+1.83*np.sin(z*3.28)+2.9*side+4.2*dist+.81*np.sin(h*6.4-z*1.3)
    bars=.5+.5*np.cos(bars_phase)
    back=smooth(.59,.89,side+(.17+.08*dist)*bars+.05*cloud)
    stripe=smooth(.55,.85,bars)*smooth(.29+.08*np.sin(z*4.2),.64,side+.14*cloud)
    stripe*=.80+.20*smooth(.12,.71,clouds(z*5.4,h*4.2,5))
    tail=smooth(-1.3,-2.55,z)
    stripe=np.maximum(stripe,tail*.72*smooth(.70,.93,bars))
    back=np.maximum(back,stripe*.81)
    belly=1-smooth(.085,.35,side+.13*dist+.06*cloud)
    onleg=(1-smooth(1.03,1.46,h))
    belly*=1-.94*onleg
    dorsal=pigment([67,100,91]); base=pigment([147,153,111]); sand=pigment([208,192,147])
    col=blend(blend(base,dorsal,back),sand,belly)
    col*=((.99+.15*dist+.10*cloud+.040*fine)*(1-.20*stripe))[...,None]
    # Light, disconnected longitudinal flecks outline the lower border of
    # each bar. Coarse enough to survive the approach mips.
    freckle=gaussian((side-.50-.105*np.sin(bars_phase)-.09*dist)/.038)*smooth(.30,.67,bars+.25*cloud)
    col=blend(col,pigment([202,190,131]),freckle*.89*(1-onleg))
    # Small uneven chain of ocelli under the broad dorsal bars.
    buckled=side-.45-.056*np.sin(7.2*z)-.075*cloud
    spot=np.hypot(np.sin(15*z+.45*np.sin(7*z))/.70,buckled/.034)
    ocelli=gaussian((spot-.79)/.32)*smooth(.1,.75,clouds(z*3.9,h*4,23))
    col=blend(col,pigment([195,186,126]),ocelli*.83*(1-onleg))
    col=blend(col,pigment([78,93,69]),(1-smooth(.30,.64,spot))*.76*(1-onleg))
    col=blend(col,pigment([92,92,72]),onleg*.62)
    stocking=(1-smooth(.11,.58,h+.055*np.sin(18*z)))
    col=blend(col,pigment([79,73,64]),.68*stocking)
    # Crescent scales on the ankle and ungual sheaths over the blunt toes.
    digit=onleg*gaussian((h-.085)/.065)*smooth(.14,.25,np.maximum(z+.65,0))*((z<-.22)|(z>1.12))
    col=blend(col,pigment([177,157,117]),digit*.75)
    mitten=onleg*smooth(.244,.102,h)*smooth(.929,1.155,z)
    col=blend(col,pigment([133,117,90]),mitten*.87)
    toes=gaussian((h-.077)/.034)*smooth(1.11,1.25,z)
    col=blend(col,pigment([173,151,114]),toes*.76)
    face=smooth(1.87,2.15,z)
    # Receding stripe from the eye to the nape; a lighter supralabial band
    # curves down to the horny bill, leaving the orbital ring readable.
    orbital=np.hypot((z-2.39)/.103,(h-2.808)/.081)
    eyewash=gaussian((h-(2.805+.21*(z-2.39))-.02*np.sin(z*12))/.071)*gaussian((z-2.37)/.354)
    liner=gaussian((orbital-.86)/.17)
    col=blend(col,pigment([36,57,54]),face*np.maximum(.82*eyewash,.80*liner))
    lipline=gaussian((h-(2.475+.035*np.sin((z-2.17)*4.0)))/.038)*gaussian((z-2.56)/.39)
    col=blend(col,pigment([208,184,134]),.82*lipline)
    lip=smooth(2.88,3.083,z)
    beak=blend(pigment([84,76,63]),pigment([176,151,104]),smooth(2.38,2.60,h))
    stria=.5+.5*np.sin(131*z+33*h+2.8*fine)
    col=blend(col,beak*(.90+.10*stria[...,None]),lip)
    naris=np.hypot((z-2.851)/.046,(h-2.638-.04*(z-2.85))/.024)
    col=blend(col,pigment([185,162,113]),gaussian((naris-1.07)/.28)*.75)
    col=blend(col,pigment([39,46,38]),(1-smooth(.53,1.0,naris))*.98)
    # Crest follows the tubular passage from the muzzle: subdued coral base,
    # red-brown midline and butter-yellow arcing bands with a dark rim.
    cs=interpolate(CREST)
    cl=np.interp(z,cs[:,0],cs[:,2]);ch=np.interp(z,cs[:,0],cs[:,3])
    crest_y=(h-cl)/(ch-cl)
    crest=smooth(-.28,.40,crest_y+.14*cloud+.09*np.sin(z*21))*smooth(2.88,2.59,z)
    crest*=smooth(2.755,2.957,h+.34*(z-2.30))
    phase=(z+.1*(crest_y-.55)**2)*11.3+.27*np.sin(z*6.2)+.15*cloud
    scallop=(.5+.5*np.sin(phase))**1.3
    red=blend(pigment([164,79,57]),pigment([212,128,78]),smooth(.03,.80,crest_y+.24*scallop))
    red=blend(red,pigment([242,189,102]),smooth(.70,.93,scallop)*.87)
    red=blend(red,pigment([71,68,54]),gaussian((crest_y-.15-.08*np.cos(phase))/.09)*.86)
    red=blend(red,pigment([238,181,102]),gaussian((crest_y-.29-.08*np.cos(phase))/.045)*.63)
    red=blend(red,pigment([117,77,54]),gaussian((scallop-.57)/.16)*.58)
    red=blend(red,pigment([220,176,107]),smooth(.89,.995,crest_y)*.72)
    col=blend(col,red,crest)
    # Keratin and iris share the face sheet but have their own surface response.
    eye=(tag==2)
    iris=np.hypot((z-2.39)/.056,(h-2.81)/.053)
    eye_col=blend(pigment([226,152,57]),pigment([87,75,41]),smooth(.46,1.12,iris))
    pupil=np.hypot((z-2.389)/.019,(h-2.81)/.030)
    eye_col=blend(eye_col,pigment([19,24,22]),1-smooth(.69,1.04,pupil))
    dark_lid=gaussian((iris-1.23)/.355)
    eye_col=blend(eye_col,pigment([35,42,32]),dark_lid)
    glint=gaussian(np.hypot((z-2.409)/.008,(h-2.823)/.007))
    eye_col=blend(eye_col,pigment([229,223,185]),.64*glint)
    col=np.where(eye[:,None],eye_col,col)
    col=blend(col,pigment([137,139,99]),.41*(tag==1)*(1-lip))
    jaw=(tag==1)
    width=np.interp(z,body[:,0],body[:,1]); inner=jaw*(1-smooth(.44,.83,x/width))*smooth(2.37,2.44,h)
    col=blend(col,pigment([126,76,64])+(7*np.cos(58*z))[:,None],inner)
    # Reticulate tubercles change size from trunk to face, interspersed with
    # larger shield scales along the dorsal tract. Coordinates continue across UV seams.
    size=22+14*face+6*onleg
    sc,rand=pebbles((uv+.016*cloud)*size,(elev+.012*fine)*size*1.28)
    scute,_=pebbles(uv*11+.06*cloud,elev*10.6)
    skin_relief=(.40*sc+.105*scute*(.3+.7*back))
    rip=(.5+.5*np.cos(h*81+z*12+cloud*2.8))**6
    folds=rip*(gaussian((h-.76)/.12)+.55*gaussian((h-1.05)/.11))*onleg
    relief=.20+skin_relief+.055*rand+.045*clouds(uv*74,elev*93,9)-.125*folds
    relief=np.where(eye,.50+.15*gaussian(iris),relief)
    relief=relief*(1-lip*.53)+(.38+.19*stria)*lip*.53
    col*=(.927+.097*sc+.049*rand-.12*folds)[...,None]
    masks=np.stack([(1-belly)*back,(1-belly)*(1-back),belly,crest],axis=-1)
    masks[:,:3]*=(1-crest[:,None])
    masks*=((1-.88*eye)*(1-.88*lip)*(1-.80*digit)*(1-.91*inner)*(.52+.17*(1-onleg)))[:,None]
    # Local healed abrasions follow the long axis of the shoulder and hip.
    wound=np.zeros_like(h)
    for hz,hh,slope,extent in [(.73,1.73,.44,.27),(-.75,1.75,-.46,.35),(-1.52,1.95,.18,.29)]:
        for j in range(3):
            wound=np.maximum(wound,gaussian((h-hh-j*.042-slope*(z-hz))/.019)*gaussian((z-hz-j*.02)/extent))
    wound*=smooth(.20,.52,x)*(1-.34*rand)
    rot=smooth(.42,.73,clouds(z*4.6,elev*5.3,14)+.26*cloud)*(.65+.35*clouds(z*25,h*18,7))
    rough=np.where(eye,.20,.78-.08*sc-.13*lip-.08*crest)
    return col,relief,rough,.88+.10*sc-.08*folds,masks,wound,rot

def save(name,base,height,rough,ao,masks=None,wound=None,decay=None):
    def put(role,pic,side=0):
        im=Image.fromarray(pic)
        if side:im=im.resize((side,side),Image.Resampling.LANCZOS)
        im.save(HERE/(name+'_'+role+'.png'),compress_level=6)
    def u(a):return np.clip(a,0,255).astype(np.uint8)
    put('base',u(base))
    dy,dx=np.gradient(height)
    normal=np.stack([-dx*2.7,dy*2.7,np.ones_like(dx)],-1)
    normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
    put('normal',u((normal*.5+.5)*255))
    put('height',(np.clip(height,0,1)*65535).astype(np.uint16))
    put('packed',u(rgb(255*ao,255*rough,0*ao)))
    if masks is not None:
        put('mask',u(masks[...,:3]*255));put('mask2',u(rgb(masks[...,3]*255,0*ao,0*ao)))
        w=u(wound*255)
        injury=np.dstack([u(91+48*wound),u(44-17*wound),u(35-8*wound),w])
        put('hurt',injury,256)
        dirt=np.dstack([u(69+33*decay),u(66+18*decay),u(52+3*decay),u(decay*223)])
        dirt=np.asarray(Image.fromarray(dirt).resize((256,256),Image.Resampling.LANCZOS)).copy()
        hurt=np.asarray(Image.open(HERE/(name+'_hurt.png')))
        dirt[hurt[...,3]>0,3]=0
        put('decay',dirt)

for index,name,N in [(0,'parasaur_hide',2048),(1,'parasaur_face',1024)]:
    pos,tags=raster(index,N);chunks=[]
    for y in range(0,N,32):
        chunks.append(field(pos[y:y+32].reshape(-1,3),tags[y:y+32].ravel()))
    maps=[np.concatenate(parts).reshape((N,N)+parts[0].shape[1:]) for parts in zip(*chunks)]
    save(name,*maps)
    print(name,'complete',flush=True)
N=512
v,u=np.mgrid[:N,:N]/N
tag=np.minimum(3,(u*4).astype(int))
grain=clouds(u*210,v*190,3)-.5
weave=np.sin(u*820)*np.sin(v*779)
colors=np.array([[107,87,63],[140,93,57],[89,61,43],[154,133,87]])[tag]
base=colors*(1+.14*grain[...,None]+np.where(tag==0,.10*weave,0)[...,None])
edge=(np.cos(v*110)>.68)&((u*4%1)<.21)
base=blend(base,pigment([207,173,109]),edge*.64)
h=.45+.23*grain+.10*weave*(tag==0)+.12*edge
save('parasaur_tack',base,h,np.where(tag==3,.34,.76),.86+.12*(.5+grain))
