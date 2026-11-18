"""Paint the longitudinal mantle, folded vanes, keratin and tack atlases at source resolution.
Run with Python 3, NumPy and Pillow. All fields and markings are authored here.
"""
import ast
from pathlib import Path
import numpy as np
from PIL import Image
HERE=Path(__file__).resolve().parent
RNG=np.random.default_rng(4043)
TAU=2*np.pi
def blend(a,b,t): return a*(1-t)+b*t
def s(x):
    x=np.clip(x,0,1)
    return x*x*(3-2*x)
def wave(x): return np.sin(TAU*x)
def noise(n,k):
    small=RNG.uniform(-1,1,(k,k)).astype("float32")
    return np.array(Image.fromarray(small).resize((n,n),Image.Resampling.BICUBIC))
def field(n):
    v,u=np.mgrid[0:n,0:n]/(n-1)
    return u,1-v
def coat(color,other,k): return blend(color,np.array(other),np.asarray(k)[...,None])
def write(name,role,a,size=None):
    pic=Image.fromarray(np.clip(a,0,255).astype("uint8"))
    if size: pic=pic.resize((size,size),Image.Resampling.BOX if role.startswith("mask") else Image.Resampling.LANCZOS)
    if role=="decay":
        pixels=np.array(pic)
        pixels[np.asarray(Image.open(HERE/(name+"_hurt.png")))[...,3]>0,3]=0
        pic=Image.fromarray(pixels)
    pic.save(HERE/(name+"_"+role+".png"),compress_level=7)
def finish(name,col,h,weights,rough,metal,ao,grain,wound=None,rot=None):
    h=np.clip(h,2,252)
    h=h.astype("uint8")
    dy,dx=np.gradient(h.astype(float)/255)
    tangent=np.stack((-7*dx,7*dy,np.ones_like(dx)),axis=2)
    tangent/=np.sqrt((tangent*tangent).sum(axis=2))[...,None]
    write(name,"base",col)
    write(name,"height",h)
    write(name,"normal",127.5+127.5*tangent)
    write(name,"packed",np.stack(np.broadcast_arrays(ao,rough,metal),axis=2),len(h)//2)
    if weights is not None:
        weights=np.clip(weights,0,1)
        weights/=np.maximum(1.001,weights.sum(axis=2))[...,None]
        for k,role in ((0,"mask"),(3,"mask2")): write(name,role,weights[...,k:k+3]*254,len(h)//2)
    if wound is not None:
        cols=np.stack([90+grain*12,42+grain*8,37+grain*5,255*wound],axis=2)
        write(name,"hurt",cols,128)
        cols=np.stack([75+grain*11,75+grain*9,57+grain*8,rot*210],axis=2)
        write(name,"decay",cols,128)
def hide():
    n=1024
    u,v=field(n); z=u*3.92-2.30; y=v*1.82-.09
    tree=ast.parse((HERE.parent/"plan.py").read_text())
    axis=np.array(next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and n.targets[0].id=="AXIS"))
    lo=np.interp(z,axis[:,0],axis[:,2]); hi=np.interp(z,axis[:,0],axis[:,3])
    d=(y-lo)/np.maximum(.045,hi-lo)
    a,b,c=noise(n,16),noise(n,60),noise(n,190)
    salt=RNG.uniform(-1,1,(n,n))
    w=np.zeros((n,n,6))
    ventral=s((.50-d+.040*a+.015*b)/.32)
    face=s((z-.935+.02*a)/.12)
    exposed=s((.64-y+.08*wave(z*3))/.17)*s((z+.53)/.14)*s((.40-z)/.15)
    undertone=np.zeros((n,n,3))+[128,112,91]
    col=coat(undertone,[195,173,139],ventral)
    # Irregular wide dark nuchal and pelvic bars turn down the flank and
    # dissolve into small cellular markings at the edge of the pale belly.
    phase=z*3.42+.56*(1-np.clip(d,-.1,1))**1.55+.09*a+.027*b
    bands=s((wave(phase)-.24-.14*wave(z*1.7))/.5)*s((d-.30+.08*a)/.26)*(1-face)
    bands*=.84+.115*wave(z*1.82)+.045*b
    bands*=1-.68*s((z-.17)/.2)*s((.77-z)/.28)
    col=coat(col,[60,62,61],bands*.85)
    mantle=s((d-.74-.05*a)/.29)*(1-face)
    col=coat(col,[92,84,72],mantle*.31)
    # Broken ivory stripe below the shoulder, continued into the neck.
    stripe_path=.53+.09*wave((z-.1)*1.24)
    stripe=np.exp(-((d-stripe_path)/(.055+.014*a))**2)*s((z+.32)/.17)*s((.95-z)/.12)
    col=coat(col,[210,191,151],stripe*.82)
    col=coat(col,[161,111,79],face*.65)
    # A continuous ocular band with a buff supercilium turns back to the ear.
    ocular=1.480+.050*np.tanh((z-1.06)*5)-.070*s((z-1.17)/.17)
    mask=np.exp(-((y-ocular)/(.026+.012*np.exp(-((z-1.06)/.13)**2)))**2)*s((z-.822)/.17)*s((1.355-z)/.19)
    blush=np.exp(-((z-.975)/.108)**2-((y-1.435)/.069)**2)
    col=coat(col,[156,86,56],.72*blush)
    col=coat(col,[49,52,49],mask*.91)
    cheek=np.exp(-((z-1.096)/.085)**2-((y-1.399-.17*(z-1.07))/.013)**2)
    col=coat(col,[184,139,98],cheek*.62)
    nasal=np.exp(-((z-1.293)/.150)**2-((y-1.428+.083*(z-1.28))/.011)**2)
    col=coat(col,[119,78,62],nasal*.48)
    # Pebbling is finer on the snout than the short fibres behind the orbit.
    face_grain=(wave(z*156+.23*wave(y*136))*wave(y*122+z*37)+.7*c)
    col+=(5*face_grain*face)[...,None]
    brow=np.exp(-((y-ocular-.043)/.011)**2)*s((z-.906)/.12)*s((1.202-z)/.11)
    col=coat(col,[225,201,147],brow*.92)
    col=coat(col,[111,91,67],exposed)
    # Contour feathers have interleaving teardrop tips and a directional grain.
    fy=y*45+z*10+1.4*a
    fx=z*22-y*4+.34*np.floor(fy)+.55*a
    line=wave(fy+.25*np.cos(TAU*fx)+.07*b)
    tips=s((line-.65)/.35)
    bodygrain=(1-face)*(1-exposed)
    scutes=wave(y*67+2.1*np.sin(25*z)+.18*b)
    grain=2.8*a+2.8*b+2.5*c+1.6*salt
    col+=((6*tips+3.6*wave(fx*3+fy)-4)*bodygrain+grain+(scutes*5+c*3)*exposed)[...,None]
    # Sparse dark labial pits follow the jawline and fade into the muzzle.
    pits=0
    for i in range(11):
        cz=1.108+i*.036
        cy=np.interp(cz,axis[:,0],axis[:,2])+.026+.004*np.sin(i*2)
        pits=pits+np.exp(-((z-cz)/.004)**2-((y-cy)/.0035)**2)
    col=coat(col,[59,53,44],s(pits)*.83)
    w[...,0]=(1-ventral)*(1-face)*(1-exposed)*(1-bands)*.68
    w[...,1]=(1-face)*ventral*(1-exposed)*.62
    w[...,3]=bands*.66
    w[...,4]=face*(1-mask)*.54
    w[...,5]=stripe*.46
    h=125+bodygrain*(8*line+4*wave(fx*3+fy))+exposed*15*scutes+grain*.86-22*s(pits)+10*face*face_grain
    wound=np.zeros((n,n))
    for zz,yy,dx,dy in ((-.14,.94,.13,.065),(.39,1.01,.093,.052),(1.02,1.405,.037,.02),(-1.20,1.05,.09,.03)):
        patch=np.exp(-((z-zz)/dx)**2-((y-yy-.11*(z-zz))/dy)**2)
        wound=np.maximum(wound,s((patch+.21*b+.07*c-.42)*2)*(.45+.5*s(patch)))
    rot=s((a+.34*b+.25)/1.35)*(.55+.25*s(1-d))*(1-s(wound*20))
    finish("raptor_hide",col,h,w,207+10*b,0,248-7*abs(b),a,wound,rot)
def feather():
    n=512
    u,v=field(n); strip=np.minimum(3,(u*4).astype(int)); x=(u*4)%1; a=noise(n,36); b=noise(n,168)
    radius=abs(x-.5)*2
    rachis=np.exp(-((x-.5)/(.014+.015*(1-v)))**2)
    chevron=v+.085*radius**1.35+.013*a
    bars=s((np.cos(TAU*(chevron*2.56+.065*strip))-.18)/.57)
    bars*=s((v-.18)/.20)
    tip=s((chevron-.90-.018*wave(strip*.31))/.042)
    col=np.zeros((n,n,3))+[131,104,79]
    col=coat(col,[164,111,73],s((v-.32)/.2)*s((.77-v)/.2)*.60)
    col=coat(col,[63,70,70],bars*.82)
    col=coat(col,[208,189,152],tip*.93)
    # Lighter exterior edge and translucent, short diagonal runs of barbs.
    barb=wave(chevron*104+radius*8+strip*.19+.11*a)
    col+=(barb*(3.5+2*radius)+6*a+2*b+radius*4)[...,None]
    col=coat(col,[166,149,118],rachis*(1-.64*v)*.74)
    w=np.zeros((n,n,6))
    w[...,0]=.49*(1-bars)*(1-tip); w[...,3]=.69*bars*(1-tip); w[...,5]=.74*tip
    h=119+5*barb+31*rachis*(1-.62*v)+a*2
    wound=s((a+.22*b-.67)/.43)*s((v-.4)/.4)*.45
    finish("raptor_feather",col,h,w,204+4*b,0,250+a*4,a,wound,s(a+.34)*(1-s(wound*20)))
def detail():
    n=512; u,v=field(n); strip=np.minimum(7,(u*8).astype(int)); x=(u*8)%1
    a,b=noise(n,40),noise(n,169); salt=RNG.uniform(-1,1,(n,n))
    colors=np.array([[62,56,48],[224,207,168],[118,58,56],[208,149,53],[46,40,34],[138,111,76],[149,101,69],[73,56,44]])
    col=colors[strip].astype(float)
    col+=(a*4+b*2+2*salt+4*wave(x*13+v*2))[:,:,None]
    col=coat(col,[144,129,100],(strip==0)*s((v-.6)/.4)*.52)
    col=coat(col,[170,102,98],(strip==2)*s((v-.27)/.44)*(.5+.14*a))
    xx=(x-.50)*1.79; yy=(v-.50)*8*1.48
    r=np.sqrt(xx*xx+yy*yy)
    theta=np.arctan2(yy,xx)
    eye=(strip==3)
    col=coat(col,[39,36,30],eye*s((r-.54)/.13))
    col+=((wave(theta*11+.3*a)*10+a*7)*eye*(1-s((r-.57)/.1)))[:,:,None]
    col=coat(col,[21,23,22],eye*(1-s((r-.28)/.052)))
    col=coat(col,[239,223,187],eye*np.exp(-((xx+.095)/.043)**2-((yy-.106)/.045)**2)*.89)
    col=coat(col,[23,26,24],(strip==4)*(1-s((r-.37)/.24)))
    w=np.zeros((n,n,6)); w[...,2]=.70*(strip==0); w[...,4]=.51*(strip==6)
    h=128+a*3+b*2+(strip==5)*8*wave(v*27+.45*np.cos(x*TAU))
    wound=s((a-.65)*4)*((strip==2)|(strip==6))*.6
    finish("raptor_detail",col,h,w,np.where(eye,84,183)+4*a,0,248+4*a,a,wound,s(a+.21)*(~eye)*(1-s(wound*20)))
def saddle():
    n=512; u,v=field(n); band=np.minimum(3,(u*4).astype(int))
    a,b=noise(n,25),noise(n,129); salt=RNG.uniform(-1,1,(n,n))
    colors=np.array([[91,58,41],[138,83,49],[171,145,90],[70,85,87]])
    col=colors[band].astype(float)
    grain=4*a+2*b+2*salt
    stitch=(band==3)*s((np.cos(TAU*(u*62+v*34))-.72)/.27)
    col+=(grain+stitch*12+(band==1)*8*wave(u*23+v*4+a*.6))[...,None]
    h=124+grain*1.4+stitch*15
    finish("raptor_saddle",col,h,None,np.where(band==2,94,186)+grain,(band==2)*175,248+2*a,a)
if __name__=="__main__":
    hide(); feather(); detail(); saddle()
