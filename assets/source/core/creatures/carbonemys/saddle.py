"""A fitted single saddle over the forward slope of the carapace."""
import math
from mesh import Surface,tube,oval,uvbox
from shell import roof
LEATHER=(.02,.52,.46,.46);PAD=(.51,.52,.47,.46);WOOD=(.02,.035,.46,.42);BRASS=(.54,.04,.42,.38)
def band(s,path,wide,deep,box=LEATHER):
    tube(s,[(p,wide,deep) for p in path],['shell']*len(path),0,box,12,'along',.71)
def pad(s):
    nx,nz=14,18;rings=[[],[]]
    for layer in range(2):
        for iz in range(nz+1):
            v=iz/nz;z=.10+.86*v
            w=.155+.245*math.sin(math.pi*(.05+.91*v))**.62
            line=[]
            for ix in range(nx+1):
                u=ix/nx;x=(u*2-1)*w;y=roof(x,z)+.014+layer*(.024+.018*(1-abs(x)/w))
                line.append(s.v((x,y,z),'shell'))
            rings[layer].append(line)
    def quad(ids,coords):s.f(ids,[uvbox(PAD,*q) for q in coords],0)
    for layer in range(2):
        for z in range(nz):
            for x in range(nx):
                corners=[(x,z),(x+1,z),(x+1,z+1),(x,z+1)]
                quad([rings[layer][b][a] for a,b in corners],[(a/nx,b/nz)for a,b in corners])
    border=[(x,0)for x in range(nx)]+[(nx,z)for z in range(nz)]+[(x,nz)for x in range(nx,0,-1)]+[(0,z)for z in range(nz,0,-1)]
    for i,(x,z) in enumerate(border):
        a,b=border[(i+1)%len(border)];quad([rings[0][z][x],rings[0][b][a],rings[1][b][a],rings[1][z][x]],[(0,0),(1,0),(1,1),(0,1)])
def girth(s,z):
    nz=(z+.075)/1.70;w=1.245*(1-.083*nz-.04*nz*nz)*math.sqrt(1-nz*nz)
    front=[]
    for sign in [1,-1]:
        side=[(sign*w*t,roof(sign*w*t,z)+.026,z)for t in [.04,.18,.32,.46,.58,.70,.81,.89,.95,.985]]
        side += [(sign*w*1.025,.82,z),(sign*w*1.023,.75,z),(sign*w*.912,.66,z),(sign*w*.74,.57,z),(sign*w*.49,.49,z),(sign*w*.15,.456,z)]
        if sign==1:front=side
        else:front+=list(reversed(side))
    band(s,front,.039,.011)
def build():
    s=Surface('saddle',['turtle_saddle']);pad(s);girth(s,.39);girth(s,.81)
    saddle=[((0,1.981,.19),.12,.075),((0,2.005,.27),.216,.123),((0,1.993,.40),.198,.079),
            ((0,1.986,.55),.167,.050),((0,1.986,.68),.139,.050),((0,2.012,.76),.134,.074),((0,2.028,.82),.067,.056)]
    tube(s,saddle,['shell']*len(saddle),0,LEATHER,28,'z',.75)
    band(s,[(-.205,2.010,.28),(-.190,2.113,.249),(-.100,2.157,.238),(0,2.163,.231),(.100,2.157,.238),(.190,2.113,.249),(.205,2.010,.28)],.030,.027,WOOD)
    for sign in [1,-1]:
        # The tree bars rise from the fitted blanket into both ends of the
        # seat; the forward grip has two anchored feet on this structure.
        points=[]
        for z,top in [(.21,1.985),(.32,1.974),(.51,1.966),(.68,1.969),(.81,1.997)]:
            x=sign*.102;bottom=roof(x,z)+.042
            points.append(((x,(top+bottom)*.5,z),.068,(top-bottom)*.50))
        tube(s,points,['shell']*len(points),0,WOOD,16,'z',.72)
        band(s,[(sign*.10,1.99,.75),(sign*.142,2.14,.803),(sign*.198,2.185,.846),(sign*.225,2.17,.898),(sign*.226,1.952,.859),(sign*.209,roof(sign*.209,.837)+.029,.837)],.016,.018,WOOD)
        for dz in [-.073,.073]:
            band(s,[(sign*.18,1.99,.65),(sign*.255,1.80,.780),(sign*.324,1.67,.89),(sign*.361,1.537,1.052+dz)],.018,.010)
        band(s,[(sign*.361,1.536,.971),(sign*.361,1.536,1.133)],.027,.023,BRASS)
        # A leather keeper joins the pad's rolled edge and the forward girth.
        path=[(sign*x,roof(sign*x,z)+.031,z) for x,z in [(.25,.44),(.36,.48),(.48,.51),(.65,.49),(.85,.43),(.98,.39)]]
        band(s,path,.027,.010)
    s.done()
if __name__=='__main__':build()
