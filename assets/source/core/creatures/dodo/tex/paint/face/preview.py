"""Python previews of exported face paint on the supplied baked surface.
No model edits, Blender or fabricated review geometry. Writes only checks/.
"""
from pathlib import Path
import importlib.util
import json
import site
import sys
site.addsitedir(site.getusersitepackages())
sys.dont_write_bytecode=True
import numpy as np
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('face_paint',ROOT/'paint.py')
paint=importlib.util.module_from_spec(spec);spec.loader.exec_module(paint)
QA=ROOT/'checks'
COMPOSED=Path('/private/tmp/dodo-look/tree/core/creatures/dodo/tex')
PALETTE=['6B737A','D1A292','8B9166','C29533','312D2A','E6E2D6']
REGIONS=[(255,0,0),(0,255,0),(0,0,255),(0,255,255),(255,0,255),(255,255,0)]


def norm(a):
    return a / np.maximum(np.linalg.norm(a, axis=-1, keepdims=True), 1e-12)


def colour(code):
    return paint.lin(np.array([int(code[i:i + 2], 16) for i in (0, 2, 4)]) / 255)


def font(size):
    for path in ['/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc']:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def image(a):
    return Image.fromarray(np.rint(np.clip(a, 0, 1) * 255).astype(np.uint8))


def board(items, columns=3, w=420, h=350):
    out = Image.new('RGB', (columns * w, ((len(items) + columns - 1) // columns) * (h + 38)), (29, 31, 32))
    d = ImageDraw.Draw(out)
    for i, (title, im) in enumerate(items):
        x, y = i % columns * w, i // columns * (h + 38)
        im = im.copy(); im.thumbnail((w - 12, h - 6), Image.Resampling.LANCZOS)
        out.paste(im, (x + (w - im.width) // 2, y + 36 + (h - im.height) // 2))
        d.text((x + 8, y + 9), title, fill=(235, 232, 222), font=font(16))
    return out


def lighting(base, n, view, rough, ao, light):
    light = norm(np.array(light, float)); half = norm(light + view)
    nl, nv = np.maximum(paint.dot(n, light), 0), np.maximum(paint.dot(n, view), .04)
    nh, vh = np.maximum(paint.dot(n, half), 0), paint.dot(view, half)
    alpha2 = np.maximum(rough ** 4, .0015)
    D = alpha2 / (np.pi * (nh * nh * (alpha2 - 1) + 1) ** 2)
    k = (rough + 1) ** 2 / 8
    G = nl / (nl * (1 - k) + k) * nv / (nv * (1 - k) + k)
    F = .035 + .965 * (1 - vh) ** 5
    spec = D * G * F / (4 * np.maximum(nl * nv, .001))
    return base * (.35 + .65 * nl[:, None]) * ao[:, None] + (spec * nl * .8)[:, None]


def render(data, camera, centre, width_m, height_m, ppm=5000, light=(.7, .8, .4), dye=None, unlit=False, only=None, mirror=False):
    view = norm(np.array(camera, float)); right = norm(np.cross([0, 1, 0], view)); up = np.cross(view, right)
    selected = np.ones(len(data['p']), bool) if only is None else np.isin(data['piece'], only)
    p = data['p'][selected]; n = data['n'][selected]; gn = data['geo_n'][selected]
    pdx, pdy = data['dx'][selected], data['dy'][selected]
    base = data['base'][selected].copy(); ao = data['ao'][selected]; rough = data['rough'][selected]
    if dye:
        choices=dye if isinstance(dye,dict) else {1:dye}
        for index,code in choices.items():
            m=(data['region'][selected]==REGIONS[index]).all(-1)
            base[m]=data['neutral'][selected][m]*colour(code)/.5
    if mirror:
        p = np.concatenate([p, p * [-1, 1, 1]])
        n = np.concatenate([n, n * [-1, 1, 1]])
        gn = np.concatenate([gn, gn * [-1, 1, 1]])
        pdx, pdy = [np.concatenate([a, a * [-1, 1, 1]]) for a in (pdx, pdy)]
        base, ao, rough = [np.concatenate([a, a]) for a in (base, ao, rough)]
    q = p - centre
    w, h = round(width_m * ppm), round(height_m * ppm)
    x, y = np.rint(paint.dot(q, right) * ppm + w / 2).astype(int), np.rint(h / 2 - paint.dot(q, up) * ppm).astype(int)
    z = paint.dot(q, view)
    visible = (paint.dot(gn, view) > -.05) & (x > -2) & (x < w + 2) & (y > -2) & (y < h + 2)
    rx = np.clip(np.ceil((np.abs(paint.dot(pdx, right)) + np.abs(paint.dot(pdy, right))) * ppm * .5), 1, 5).astype(int)[visible]
    ry = np.clip(np.ceil((np.abs(paint.dot(pdx, up)) + np.abs(paint.dot(pdy, up))) * ppm * .5), 1, 5).astype(int)[visible]
    x, y, z = x[visible], y[visible], z[visible]
    rgb = base[visible] if unlit else lighting(base[visible], n[visible], view, rough[visible], ao[visible], light)
    rgb = paint.srgb(rgb)
    # Project each atlas texel's footprint, with a depth buffer. The slightly
    # conservative rectangular splats avoid holes in oblique sparse regions.
    depth = np.full((h, w), -np.inf); out = np.full((h, w, 3), [.145, .155, .16])
    offsets = [(dy, dx) for dy in range(-int(ry.max()), int(ry.max()) + 1) for dx in range(-int(rx.max()), int(rx.max()) + 1)]
    for dy, dx in offsets:
        xx, yy = x + dx, y + dy
        k = (xx >= 0) & (xx < w) & (yy >= 0) & (yy < h) & (abs(dx) <= rx) & (abs(dy) <= ry)
        np.maximum.at(depth, (yy[k], xx[k]), z[k])
    for dy, dx in offsets:
        xx, yy = x + dx, y + dy
        k = (xx >= 0) & (xx < w) & (yy >= 0) & (yy < h) & (abs(dx) <= rx) & (abs(dy) <= ry)
        good = np.flatnonzero(k)
        good = good[z[good] >= depth[yy[good], xx[good]] - 1e-9]
        out[yy[good], xx[good]] = rgb[good]
    return image(out)


def prepare(piece,pos,ids,regions):
    folder=COMPOSED
    yy,xx=np.indices(piece.shape)
    own=np.isin(piece,[ids[n] for n in paint.NAMES])
    dense=own|(piece==ids['eye_l'])|(piece==ids['lid_l_out'])
    valid=(piece>0)&(pos[...,1]>.435)&(dense|((yy%2==0)&(xx%2==0)))
    pts=pos[valid]
    n=norm(np.asarray(Image.open(paint.BAKES/'dodo_normal_object.png'),np.float32)[valid]/127.5-1)
    dx=paint.derivative(pos,piece,1)[valid];dy=paint.derivative(pos,piece,0)[valid]
    t=norm(dx-n*paint.dot(dx,n)[:,None]);bt=norm(np.cross(n,t))
    bt*=np.where(paint.dot(bt,-dy)<0,-1,1)[:,None]
    ts=np.asarray(Image.open(folder/'dodo_normal.png'),np.float32)[valid]/127.5-1
    nn=norm(t*ts[:,:1]+bt*ts[:,1:2]+n*ts[:,2:])
    base=paint.lin(np.asarray(Image.open(folder/'dodo_base.png'),np.float32)[valid]/255)
    packed=np.asarray(Image.open(folder/'dodo_packed.png'),np.float32)[valid]/255
    reg=np.asarray(Image.open(folder/'dodo_regions.png').convert('RGB'))[valid]
    default=base.copy()
    for c,code in zip(REGIONS,PALETTE):
        m=(reg==c).all(-1);default[m]*=colour(code)/.5
    footprints=np.where(dense[valid],1,2)
    return dict(p=pts,n=nn,geo_n=n,base=default,neutral=base,region=reg,ao=packed[:,0],
        rough=packed[:,1],piece=piece[valid],dx=dx*footprints[:,None],dy=dy*footprints[:,None])


def layout_preview(piece,regions,ids):
    base=np.asarray(Image.open(ROOT/'layers/dodo_base.png'))
    b=paint.lin(base[...,:3]/255);dyed=b.copy()
    for c,code in zip(REGIONS,PALETTE):
        m=(regions==c).all(-1);dyed[m]*=colour(code)/.5
    im=paint.srgb(dyed);im[base[...,3]==0]=[.10,.115,.12]
    img=image(im)
    n=np.asarray(Image.open(COMPOSED/'dodo_normal.png'),np.float32)/127.5-1
    n=norm(n);light=norm(np.array([-.5,.55,.7]));brightness=.34+.66*np.maximum(paint.dot(n,light),0)
    lit=paint.srgb(dyed*brightness[...,None]);lit[base[...,3]==0]=[.10,.115,.12]
    items=[]
    meta=json.loads((paint.PAINT/'pieces.json').read_text())
    for p in meta['pieces']:
        if p['name'] not in paint.NAMES:continue
        x0,y0,x1,y1=p['box'];box=(max(0,x0-6),max(0,y0-6),min(2048,x1+6),min(2048,y1+6))
        items.extend([(p['name']+' / default dye / unlit',img.crop(box)),
                      (p['name']+' / UV relief',image(lit).crop(box))])
    board(items,2,600,570).save(QA/'layout_detail.png')
    img.save(QA/'layout_dyed.png')
    wire=Image.open(paint.BAKES/'dodo_layout.png').convert('RGB')
    wire=wire.resize(img.size,Image.Resampling.LANCZOS)
    combined=Image.blend(img,wire,.24);combined.save(QA/'layout_overlay.png')


def previews():
    meta,piece,p,ids,regions,mm=paint.load_geometry();pos=p/1000
    own=np.isin(piece,[ids[n] for n in paint.NAMES])
    regions=regions.copy();regions[own]=np.asarray(Image.open(ROOT/'layers/dodo_regions.png'))[own]
    layout_preview(piece,regions,ids)
    data=prepare(piece,pos,ids,regions)
    views=[]
    for title,camera in [('Side',[1,0,0]),('Front',[0,0,1]),('Back',[0,0,-1])]:
        print('Rendering '+title,flush=True)
        im=render(data,camera,np.array([0,.548,.216]),.30 if title=='Side' else .18,.23,
                  ppm=3400,mirror=title!='Side')
        im.save(QA/(title.lower()+'_head.png'));views.append((title+' / composed baked surface',im))
    board(views,3,620,700).save(QA/'head_views.png')
    # An oblique view shows the front-facing eye and its surrounding rolls.
    near=dict(centre=np.array([.045,.569,.181]),width_m=.088,height_m=.091,ppm=7000)
    items=[]
    for title,light in [('upper front',[.7,.8,.5]),('upper back',[.7,.6,-.6]),('lower front',[.7,-.65,.5])]:
        print('Rendering cheek '+title,flush=True)
        im=render(data,[.85,0,.53],light=light,**near)
        im.save(QA/('cheek_'+title.replace(' ','_')+'.png'));items.append((title,im))
    board(items,3,500,540).save(QA/'face_relighting.png')
    dyes=[]
    for title,dye in [('ivory / slate',{1:'E6E2D6',3:'6B737A'}),('taupe / orange',{1:'A09A90',3:'CE7E43'}),('pink / lime',{1:'F22B92',3:'A9D91C'}),('near black',{1:'161719',3:'161719'}),('near white',{1:'EEECE6',3:'EEECE6'})]:
        print('Rendering dye '+title,flush=True)
        dyes.append((title,render(data,[.85,0,.53],dye=dye,**near)))
    board(dyes,5,330,370).save(QA/'face_dyes.png')
    pouch=[]
    for title,dye in [('ochre',None),('slate',{3:'6B737A'}),('dull orange',{3:'CE7E43'})]:
        im=render(data,[0,0,1],np.array([0,.490,.213]),.075,.094,ppm=6500,mirror=True,dye=dye)
        pouch.append((title+' / 2 mm pleats',im))
    board(pouch,3,420,560).save(QA/'pouch_detail.png')
    original=Image.open(paint.DODO/'ref/concept/head_side.png').convert('RGB')
    front=Image.open(paint.DODO/'ref/concept/head_front.png').convert('RGB')
    board([('Concept / side',original),('Painted baked surface / side',views[0][1]),
           ('Concept / front',front),('Painted baked surface / front',views[1][1])],2,730,710).save(QA/'baked_surface_comparison.png')
    # Native small reads, without enlarging the chips.
    out=Image.new('RGB',(1000,330),(29,31,32));d=ImageDraw.Draw(out)
    for i,(label,im) in enumerate(views[:2]):
        d.text((20+i*500,15),label,font=font(17),fill=(235,232,222))
        for j,bird_h in enumerate([200,50,20]):
            px=round(.23/.65*bird_h);small=im.resize((round(im.width/im.height*px),px),Image.Resampling.LANCZOS)
            x=20+i*500+j*155;out.paste(small,(x,85));d.text((x,55),str(bird_h)+' px bird',font=font(15),fill=(235,232,222))
    out.save(QA/'read_sizes.png')


if __name__=='__main__':previews()
