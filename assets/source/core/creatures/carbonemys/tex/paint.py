"""Paint the original scute growth, granular hide and saddle on their authored UVs."""
from pathlib import Path
import sys
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT.parent))
from shell import CELLS
from layout import DYES
N=1024
row,col=np.indices((N,N),dtype=np.float32)
U=(col+.5)/N;V=1-(row+.5)/N
colors=np.array([[int(s[k:k+2],16)/255 for k in (0,2,4)]for s in DYES])
def lin(x):return np.where(x<=.04045,x/12.92,((x+.055)/1.055)**2.4)
def srgb(x):return np.where(x<=.0031308,12.92*x,1.055*np.clip(x,0,1)**(1/2.4)-.055)
def ease(a,b,x):
    t=np.clip((x-a)/(b-a),0,1);return t*t*(3-2*t)
def hash2(x,y,s=0):return np.mod(np.sin(x*127.1+y*311.7+s*71.13)*43758.5453,1)
def noise(u,v,f):
    x=u*f;y=v*f;a=np.floor(x);b=np.floor(y);x=ease(0,1,x-a);y=ease(0,1,y-b)
    return (1-y)*((1-x)*hash2(a,b)+x*hash2(a+1,b))+y*((1-x)*hash2(a,b+1)+x*hash2(a+1,b+1))
def cells(u,v):
    ix=np.floor(u);iy=np.floor(v);d1=np.full_like(u,99.);d2=d1.copy();mark=np.zeros_like(u)
    for dx in [-1,0,1]:
        for dy in [-1,0,1]:
            x=ix+dx;y=iy+dy;h=hash2(x,y,7);k=hash2(x,y,11)
            dist=(u-x-.16-.68*h)**2+(v-y-.16-.68*k)**2
            closer=dist<d1;d2=np.where(closer,d1,np.minimum(d2,dist));d1=np.minimum(d1,dist);mark=np.where(closer,hash2(x,y,19),mark)
    return np.sqrt(d2)-np.sqrt(d1),1-np.sqrt(d1),mark
def put(name,values):
    Image.fromarray(np.clip(np.rint(values*255),0,255).astype('uint8')).save(ROOT/name)
def save(name,base,h,rough,occ,metal,w,meters):
    if base.ndim==2:base=np.repeat(base[...,None],3,-1)
    # The flat-mesh baker samples the base under mixed dyes. Give those texels
    # an earthen value as well, while the runtime normalizes the dyes by their
    # measured mean reflectance. Undyed eyes, horn and leather keep their own paint.
    if w is not None:
        earth = np.array([.224,.169,.132] if name=='carapace' else [.205,.188,.151])
        dyed = np.clip(w.sum(axis=2),0,1)[...,None]
        base = base * (1 - dyed + dyed * earth)

    put(name+'_base.png',srgb(base));put(name+'_packed.png',np.stack([occ,rough,metal],-1))
    dy,dx=np.gradient(h,meters/N);normal=np.stack([-dx,dy,np.ones_like(h)],-1);normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
    put(name+'_normal.png',normal*.5+.5);put(name+'_height.png',(h-h.min())/max(.0001,h.max()-h.min()))
    if w is not None:put(name+'_mask.png',w[...,:3]);put(name+'_mask2.png',w[...,3:])
def layers(name,cuts,carapace=False):
    u=U[::4,::4];v=V[::4,::4];grain=noise(u,v,93);hurt=np.zeros((*u.shape,4))
    for x,y,span,slope,width in cuts:
        along=(u-x)/span;reach=np.maximum(0,1-along*along);centre=y+slope*(u-x)+.008*np.sin(3*along)
        for shift in [0,.010]:
            d=np.abs(v-centre-shift-.003*(grain-.5));stroke=(1-ease(width*.35,width+1e-5,d))*reach
            rise=stroke*(.40+.6*grain);pick=rise>hurt[...,3]
            color=np.stack([.35+.16*grain,.085+.11*grain,.035+.07*grain],-1) if not carapace else np.stack([.48+.20*grain,.25+.18*grain,.12+.09*grain],-1)
            hurt[pick,:3]=color[pick];hurt[...,3]=np.maximum(hurt[...,3],rise)
    put(name+'_hurt.png',hurt)
    mott=noise(u,v,13)*.55+noise(u,v,39)*.45;decay=np.stack([.22+.12*grain,.22+.11*grain,.15+.07*grain,ease(.52,.72,mott)*(.32+.39*grain)],-1)
    decay[...,3][hurt[...,3]>0]=0
    put(name+'_decay.png',decay)
def carapace():
    x=(U-.02)/.48-1;z=(V-.52)/.232-1;best=np.full_like(U,3.);identity=np.zeros_like(U)
    for i,((cx,cz),poly,kind,j) in enumerate(CELLS):
        share=np.zeros_like(U)
        for a,b in zip(poly,poly[1:]+poly[:1]):
            ex=b[0]-a[0];ez=b[1]-a[1];den=ex*(a[1]-cz)-ez*(a[0]-cx)
            if abs(den)>.000001:share=np.maximum(share,(ex*(z-cz)-ez*(x-cx))/den)
        choose=share<best;identity=np.where(choose,i,identity);best=np.minimum(best,share)
    grain=noise(U,V,130);broad=noise(U,V,19)
    centers=np.array([cell[0] for cell in CELLS]);idx=identity.astype(int)
    angle=np.arctan2(z-centers[idx,1],x-centers[idx,0]);slip=noise(U,V,42)
    r=best+.012*(broad-.5);seam=ease(.89,.997,r)
    # Individual growth episodes split, abrade and disappear toward the high
    # exposed face; they never form a uniform stack of contour lines.
    phase=r*(32+8*np.sin(identity*2.37))+.96*np.sin(2*angle+r*6+identity)+.83*np.sin(r*12+identity*.85)+2.6*(broad-.5)
    growth=.5+.5*np.sin(phase)
    abrasion=ease(.44,.72,slip+.12*np.cos(angle+identity))*ease(.12,.48,r)
    ridge=ease(.65,.95,growth)*(.91-.62*abrasion);age=ease(.09,.62,r);outer=ease(.65,.94,r)
    shade=.49+.19*(broad-.5)+.105*(grain-.5)+.075*(ridge-.30)*age+.052*abrasion-.14*seam+.049*np.sin(identity*2.399)
    h=.0028*(ridge-.4)*age+.0036*(1-seam)+.0007*(grain-.5)
    w=np.zeros((*U.shape,6),np.float32);rim=ease(.46,.70,broad+.13*np.sin(r*17+identity))*.37*age
    accent=.060+.17*ridge*age+.09*outer+.10*np.sin(identity*.9)**2+.078*abrasion;dark=.08+.70*seam+.17*rim
    accent=np.minimum(accent,1-dark);w[...,2]=1-accent-dark;w[...,3]=accent;w[...,4]=dark
    belly=V<.411;px=(U-.02)/.48-1;pz=(V-.015)/.19-1
    mid=np.abs(px+.018*np.sin(4*pz));cross=np.ones_like(U)
    for a,slope in [(-.73,.28),(-.40,-.13),(-.08,.11),(.28,-.19),(.57,.29),(.80,-.10)]:cross=np.minimum(cross,np.abs(pz-a-slope*np.abs(px)-.055*px*px))
    cut=(1-ease(.008,.026,np.minimum(mid,cross)))*belly
    shade[belly]=(.50+.16*(broad-.5)+.09*(grain-.5)-.13*cut)[belly];h[belly]=(.0015*(broad-.5)-.0036*cut)[belly]
    w[belly]=0;w[...,5][belly]=1-.45*cut[belly];w[...,4][belly]=.45*cut[belly]
    edge=(V>=.411)&(V<.51);seg=(1-ease(.012,.084,np.abs(np.sin(U*24*np.pi))))*edge
    shade[edge]=(.46+.10*grain-.13*seg)[edge];h[edge]=(.0018*grain-.004*seg)[edge];w[edge]=0;w[...,3][edge]=.71;w[...,4][edge]=.29
    save('carapace',shade,h,.60+.12*grain-.07*ridge,.97-.11*seam,np.zeros_like(U),w,4.)
    layers('carapace',[(.66,.72,.111,-.22,.009),(.25,.83,.073,.31,.008),(.81,.62,.052,-.34,.008),(.45,.21,.07,.13,.007)],True)
def hide():
    s=U;t=V;skin=(U<.5);eye=(U>.786)&(V>.205)&(V<.568);beak=(U>.5)&(V>.577)&(V<.792)
    fore=(V<.325)&skin;neck=(V>.32)&(V<.63)&skin;head=(V>.625)&skin
    cell,dome,mark=cells(s*94+2.8*np.sin(9*t),t*121+1.1*np.cos(13*s))
    fine,dome2,mark2=cells(s*181+1.7*np.sin(10*t),t*201+.6*np.sin(15*s))
    scale=ease(.018,.24,cell);small=ease(.012,.19,fine);grain=noise(s,t,198);broad=noise(s,t,15)
    shields=head*ease(.06,.19,np.abs(np.sin(s*28)))*.76+fore*.35
    pebble=small*(1-shields)+scale*shields
    h=(.0026*pebble+.0017*dome*shields+.00045*grain)
    wrinkle=neck*(1-ease(.045,.45,np.abs(np.sin(t*187+.8*np.sin(19*s)+1.5*np.sin(6*t+17*s)))))
    h-=.0029*wrinkle
    grey=.48+.15*(mark2-.5)*(1-shields)+.15*(mark-.5)*shields+.19*(broad-.5)+.09*pebble-.11*wrinkle
    w=np.zeros((*s.shape,6),dtype=np.float32)
    dorsal=.17+.37*ease(.30,.69,broad+.15*np.cos(s*31))
    pale=.08+.26*ease(.45,.78,np.sin(s*13.4+1.1*t)*.32+.50) +.13*(mark>.82)*shields
    w[...,0]=1-dorsal-pale;w[...,1]=dorsal;w[...,5]=pale
    pigment=np.repeat(grey[...,None],3,-1);rough=.68+.13*(1-pebble);occ=.97-.08*(1-pebble)
    for mask,color,r in [(beak,[.33,.29,.17],.51),((U>.786)&(V<.204),[.26,.237,.17],.52),((U>.50)&(U<.785)&(V>.309)&(V<.576),[.29,.105,.092],.39), (eye,[.076,.060,.039],.28),((U>.786)&(V>.337)&(V<.456),[.65,.42,.12],.28),((U>.786)&(V>.456)&(V<.568),[.024,.019,.016],.20)]:
        w[mask]=0;pigment[mask]=lin(np.array(color))*(.88+.22*grain[mask,None]);rough[mask]=r;h[mask]*=.13;occ[mask]=.98
    save('turtle_hide',pigment,h,rough,occ,np.zeros_like(U),w,2.5)
    layers('turtle_hide',[(.24,.14,.108,.34,.008),(.32,.78,.064,-.34,.006),(.18,.49,.055,-.2,.008),(.63,.22,.048,.3,.009)])
def saddle():
    g=noise(U,V,190);b=noise(U,V,34);p=np.zeros((*U.shape,3));wood=(U<.5)&(V<.48);metal=(U>=.5)&(V<.49)
    for mask,col in [(np.ones_like(U,bool),[.35,.207,.128]),((U>.5)&(V>.5),[.272,.31,.25]),(wood,[.39,.255,.142]),(metal,[.55,.41,.23])]:p[mask]=lin(np.array(col))*(.83+.24*b[mask,None]+.12*g[mask,None])
    weave=np.sin(U*700)*np.sin(V*620);h=.00054*g+.00038*b+.00032*weave*((V>.5)&(U>.5))
    seam=(np.abs(np.sin(U*27))>.994)&(np.sin(V*213)>.15)&(V>.5);p[seam]*=1.38;h[seam]+=.0008
    save('turtle_saddle',p,h,np.where(metal,.37,.71+.11*g),.98-.035*b,metal*.78,None,2.)
if __name__=='__main__':carapace();hide();saddle()
