"""Review-only curved card placement; all sampled materials are delivered maps.
No new feather painting. The illustrative surface deformation is not a mesh export.
One screen pixel is one concept pixel (1500 px/m) in the native comparison.
"""
from pathlib import Path
import json
import numpy as np
from PIL import Image,ImageDraw
from scipy.ndimage import map_coordinates,gaussian_filter
from scipy.spatial import cKDTree
import check as qa
ROOT=Path(__file__).resolve().parent
QA=ROOT/'checks'


def bezier(points, length, scale):
    p=np.array(points,float)*scale
    t=np.linspace(0,1,1800)[:,None]
    straight=np.array([p[0],p[0]+(p[3]-p[0])/3,p[0]+2*(p[3]-p[0])/3,p[3]])
    desired=length*scale
    if np.linalg.norm(p[3]-p[0])>desired:
        raise ValueError('Review pose longer than physical feather')
    lo,hi=0.,8.
    for _ in range(32):
        amount=(lo+hi)/2
        q=straight+(p-straight)*amount
        path=(1-t)**3*q[0]+3*(1-t)**2*t*q[1]+3*(1-t)*t*t*q[2]+t**3*q[3]
        arc_length=np.linalg.norm(np.diff(path,axis=0),axis=1).sum()
        if arc_length>desired:hi=amount
        else:lo=amount
    arc=np.r_[0,np.cumsum(np.linalg.norm(np.diff(path,axis=0),axis=1))]
    u=np.linspace(0,arc[-1],1400)
    path=np.stack([np.interp(u,arc,path[:,c]) for c in range(2)],-1)
    tangent=np.gradient(path,axis=0);tangent/=np.linalg.norm(tangent,axis=-1,keepdims=True)
    return path,tangent


def materials():
    return {k:np.asarray(Image.open(ROOT/f'quills_{k}.png')).astype(np.float32)/255 for k in ['base','normal','packed','regions']}


def card(e, points, size, supersample, maps, palette, mirror=False, foreshorten=1., light=(-.45,.5,.75)):
    """Bend an atlas card around a planar curve, preserving width in metres.
    Transform its tangent normal into screen axes before evaluating lighting.
    """
    w,h=size;S=supersample
    W,H=round(w*S),round(h*S)
    path,tangent=bezier(points,e['length_m']*1500*foreshorten,S)
    yy,xx=np.mgrid[:H,:W]
    queries=np.stack([xx.ravel(),yy.ravel()],-1)
    distances,k=cKDTree(path).query(queries)
    offset=queries-path[k]
    axis=tangent[k]
    lateral=np.stack([axis[:,1],-axis[:,0]],-1)
    d=np.sum(offset*lateral,-1)
    along=k/(len(path)-1)
    # Continue past the endpoints, so the cutout itself determines the ends.
    along+=np.where((k==0)|(k==len(path)-1),np.sum(offset*axis,-1)/(e['length_m']*1500*foreshorten*S),0)
    source_y=62+along*900
    shaft=np.array(Image.open(ROOT/e['source']/'shaft.png'))
    track=shaft.argmax(1).astype(float)
    good=shaft.max(1)>0
    track=np.interp(np.arange(1024),np.flatnonzero(good),track[good])
    source_x=np.interp(source_y,np.arange(1024),track)
    source_x+=(-1 if mirror else 1)*d/(e['master_span_m']*1500/1024*S)
    # Master pixel to the delivered, shared atlas transform.
    study=json.loads((ROOT/'study.json').read_text())['sets']['quills']
    sheet_scale=e['length_m']/(study['span_m']/2048)/900
    theta=np.deg2rad(e['direction_deg']);c,s=np.cos(theta),np.sin(theta)
    root=np.array(e['master_root_px'])
    dx=(source_x-root[0])*sheet_scale;dy=(source_y-root[1])*sheet_scale
    sx=e['root_px'][0]+c*dx-s*dy;sy=e['root_px'][1]+s*dx+c*dy
    coords=np.array([sy,sx])
    def sample(a,order=1):
        if a.ndim==3:return np.stack([sample(a[...,i],order) for i in range(a.shape[-1])],-1)
        return map_coordinates(a,coords,order=order,mode='constant',cval=0,prefilter=False)
    base=sample(maps['base']);normal=sample(maps['normal'])*2-1;packed=sample(maps['packed'])
    region=sample(maps['regions'][...,1],0)
    # Mirroring UVs also mirrors tangent X. +Y normal faces image top.
    nx=normal[:,0]*(-1 if mirror else 1);ny=normal[:,1]
    nscreen=np.stack([nx*lateral[:,0]-ny*axis[:,0],-nx*lateral[:,1]+ny*axis[:,1],normal[:,2]],-1)
    nscreen/=np.maximum(np.linalg.norm(nscreen,axis=-1,keepdims=True),1e-9)
    colours=[]
    for p in palette:colours.append(qa.decode(np.array([int(p[i:i+2],16) for i in (1,3,5)])/255))
    dye=colours[0][None,:]*(1-region[:,None])+colours[1][None,:]*region[:,None]
    color=qa.decode(base[:,:3])/.5*dye
    if light is not None:
        ll=np.array(light,float);ll/=np.linalg.norm(ll)
        shade=(.3+.75*np.maximum(np.sum(nscreen*ll,axis=-1),0))*packed[:,0]
        color*=shade[:,None]
    alpha=base[:,3]
    alpha[(source_y<40)|(source_y>983)|(np.abs(d)>42*S)]=0
    rgba=np.dstack([qa.encode(color).reshape(H,W,3),alpha.reshape(H,W)])
    return qa.image(rgba)


def arrangement(kind,elements,maps,palette,S=3, light=(-.45,.5,.75)):
    if kind=='tail':
        size=(208,220)
        # Side-view forward curl: the hidden seventh feather sits behind the
        # high central card. Six exposed rounded ends follow the concept fan.
        jobs=[
          (3,[(26,150),(48,142),(63,101),(50,85)],True,.64),
          (0,[(26,150),(105,133),(92,60),(88,20)],False,1.),
          (1,[(26,150),(113,137),(130,83),(116,44)],False,1.),
          (2,[(26,150),(115,150),(151,104),(139,70)],False,1.),
          (3,[(26,150),(110,169),(157,135),(154,102)],False,1.),
          (2,[(26,150),(104,179),(150,154),(153,137)],True,.87),
          (1,[(26,150),(88,181),(127,188),(136,171)],True,.78)]
    else:
        size=(116,108)
        # Root halves sit under coverts on the actual bird. Here all cards are
        # shown, with the same stagger and four exposed round ends.
        jobs=[
          (7,[(16,49),(33,68),(60,80),(78,87)],False,1.),
          (6,[(18,35),(41,48),(65,65),(80,70)],False,1.),
          (5,[(20,24),(43,32),(65,43),(90,48)],False,1.),
          (4,[(20,14),(40,22),(67,26),(92,29)],False,1.)]
    out=Image.new('RGBA',(round(size[0]*S),round(size[1]*S)),(0,0,0,0))
    for idx,pts,mirror,shorten in jobs:
        layer=card(elements[idx],pts,size,S,maps,palette,mirror,shorten,light)
        # Soft contact at card overlaps, no hard engraved grooves.
        a=np.asarray(layer)[...,3].astype(float)/255
        if out.getbbox() is not None:
            prev=np.asarray(out).astype(float)/255
            contact=np.clip(gaussian_filter(a,1.1*S)-a,0,1)
            prev[...,:3]*=(1-.26*contact[...,None])
            out=qa.image(prev)
        out.alpha_composite(layer)
    return out


def background(im,colour=(214,213,205)):
    bg=Image.new('RGBA',im.size,colour+(255,));bg.alpha_composite(im);return bg.convert('RGB')


def source_comparison(elements):
    rows=[]
    for idx in [0,2,4,6]:
        e=elements[idx];folder=ROOT/e['source']
        alpha=np.array(Image.open(folder/'alpha.png'))
        yy,xx=np.where(alpha>=128);box=(max(0,xx.min()-10),max(0,yy.min()-10),min(1024,xx.max()+11),min(1024,yy.max()+11))
        source=Image.open(folder/'aligned_generated.png').crop(box)
        base=Image.open(folder/'cutout.png').crop(box)
        n=np.array(Image.open(folder/'normal.png'))/127.5-1
        pack=np.array(Image.open(folder/'packed.png'))/255
        b=np.array(Image.open(folder/'cutout.png'))/255
        r=np.array(Image.open(folder/'regions.png'))
        lit=qa.render_rgba(b,n,pack,r,('#BCBCBC','#BCBCBC')).crop(box)
        rows += [(e['id']+' | registered source',background(source)),('Delivered neutral base | unlit',background(base)),('Delivered neutral set | relit',background(lit))]
    qa.contact(rows,3,cell=(270,660)).save(QA/'source_base_relit.png')


def run(study=None,maps=None):
    if study is None:study=json.loads((ROOT/'study.json').read_text())['sets']['quills']
    if maps is None:maps=materials()
    es=study['elements'];palette=('#777A81','#DDDBC1')
    tail=arrangement('tail',es,maps,palette)
    wing=arrangement('wing',es,maps,palette)
    # Original concept crops, never repainted. Native output is 1500 px/m.
    concept=Image.open(ROOT.parents[2]/'ref/concept/side.png')
    ct=concept.crop((816,473,1024,693))
    cw=concept.crop((706,681,822,789))
    tail_native=background(tail.resize((208,220),Image.Resampling.LANCZOS))
    wing_native=background(wing.resize((116,108),Image.Resampling.LANCZOS))
    native=Image.new('RGB',(896,280),(214,213,205));draw=ImageDraw.Draw(native)
    for x,title,im in [(12,'Concept tail',ct),(238,'Relit cards',tail_native),(492,'Concept wing',cw),(642,'Relit cards',wing_native)]:
        draw.text((x,12),title,font=qa.font(14),fill=(45,48,53));native.paste(im,(x,42))
    draw.text((492,220),'1500 px/m | physical card dimensions',font=qa.font(12),fill=(45,48,53))
    native.save(QA/'concept_comparison_native.png')
    # True study density: no thumbnailing or enlargement of the cards. Only
    # the concept is enlarged, explicitly labelled, to match physical scale.
    density=2048/study['span_m'];full_scale=density/1500
    tf=arrangement('tail',es,maps,palette,full_scale)
    wf=arrangement('wing',es,maps,palette,full_scale)
    tf.save(QA/'assembled_tail_full.png');wf.save(QA/'assembled_fingers_full.png')
    full=Image.new('RGB',(2*(tf.width+24),tf.height+wf.height+112),(214,213,205));fd=ImageDraw.Draw(full)
    for x,y,title,im in [(12,0,'Concept tail | enlarged to study scale',ct.resize(tf.size,Image.Resampling.LANCZOS)),
                         (tf.width+36,0,f'Relit cards | {density:.2f} px/m',background(tf)),
                         (12,tf.height+56,'Concept wing | enlarged to study scale',cw.resize(wf.size,Image.Resampling.LANCZOS)),
                         (tf.width+36,tf.height+56,f'Relit fingers | {density:.2f} px/m',background(wf))]:
        fd.text((x,y+12),title,font=qa.font(17),fill=(45,48,53));full.paste(im,(x,y+42))
    full.save(QA/'concept_comparison_full.png')
    # Enlargement kept separate so the native-size evidence is unambiguous.
    native.resize((1792,560),Image.Resampling.NEAREST).save(QA/'concept_comparison_2x.png')
    qa.contact([('Concept tail | 3x',ct.resize((624,660),Image.Resampling.LANCZOS)),('Relit tail cards | 3x',background(tail)),('Concept wing | 3x',cw.resize((348,324),Image.Resampling.LANCZOS)),('Relit four fingers | 3x',background(wing))],2,cell=(624,660)).save(QA/'concept_comparison.png')
    dyes=[]
    for name,pal in [('Slate / cream',palette),('Pink / lime',('#F428A8','#B8F62C')),('Near black / white',('#111319','#F2F3EF')),('Near white / charcoal',('#EDEEE9','#24262A'))]:
        dyes.append((name+' | curled seven-card fan',background(arrangement('tail',es,maps,pal,2),(42,44,47))))
        dyes.append((name+' | four overlapping fingers',background(arrangement('wing',es,maps,pal,3),(42,44,47))))
    qa.contact(dyes,2,cell=(430,440)).save(QA/'curled_card_dyes.png')
    relights=[]
    for name,l in [('Upper left',(-.75,.45,.5)),('Upper right',(.75,.45,.5)),('Below',(0,-.85,.5))]:
        relights.append((name,background(arrangement('tail',es,maps,palette,2,l))))
    qa.contact(relights,3,cell=(416,440)).save(QA/'curled_card_relighting.png')
    source_comparison(es)
    print('Rendered concept-size curved card comparisons and source/base/relit checks.',flush=True)

if __name__=='__main__':run()
