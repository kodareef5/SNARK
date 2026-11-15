#!/usr/bin/env python3
"""Independent PNG/physical checks and reproducible CPU purpose renders.

All writes are under checks/. These are material diagnostics, not game captures.
"""
from pathlib import Path
import json
import hashlib
import struct
import numpy as np
from PIL import Image, ImageDraw
from diagnostic_renderer import Renderer, AssemblyRenderer, font, linear, srgb, resize, normalize

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'checks'
SRC=ROOT/'source'
N=512
RADIUS=240.64
LUMA=np.array([.2126,.7152,.0722])
LABELS=['Sun A','Sun B','Middle A','Middle B','Shade A','Shade B','Underside','Interior']
TARGETS=[(92,116,50)]*2+[(68,92,44)]*2+[(48,70,40)]*2+[(80,94,56),(28,44,30)]
BG=(24,30,30);INK=(235,236,218);MUTED=(176,190,178)
LIGHTS=[('Overhead',(.10,-.16,1)),('Side',(-1,-.4,.25))]


def tile(a,i,size=512):
    row,col=divmod(i,4)
    return a[row*size:(row+1)*size,col*size:(col+1)*size]


def png_info(path):
    data=path.read_bytes();chunks={};p=8
    while p<len(data):
        n=struct.unpack('>I',data[p:p+4])[0];name=data[p+4:p+8].decode()
        chunks[name]=data[p+8:p+8+n];p+=n+12
    return chunks


def canvas(size,title,subtitle):
    im=Image.new('RGB',size,BG);d=ImageDraw.Draw(im)
    d.text((24,18),title,font=font(26),fill=INK)
    d.text((24,52),subtitle,font=font(15),fill=MUTED)
    return im,d


def put(im,image,box):
    image=image.copy();image.thumbnail((box[2],box[3]),Image.Resampling.LANCZOS)
    im.paste(image,(box[0],box[1]))


def audit(base,normal,height,orm):
    tests=[];records=[]
    def check(name,ok,value=None):tests.append(dict(name=name,passed=bool(ok),value=value))
    for name,mode,size,depth,ctype in [('base','RGB',(2048,1024),8,2),('normal','RGB',(2048,1024),8,2),
            ('height','I;16',(2048,1024),16,0),('orm','RGB',(1024,512),8,2)]:
        p=ROOT/f'mangrove_heads_{name}.png';im=Image.open(p);ch=png_info(p)
        check(name+' mode/size',im.mode==mode and im.size==size,[im.mode,list(im.size)])
        check(name+' PNG bit depth/type',ch['IHDR'][8:10]==bytes([depth,ctype]),list(ch['IHDR'][8:10]))
        check(name+' colour tagging',('sRGB' in ch)==(name=='base'))
    check('metalness zero',np.count_nonzero(orm[...,2])==0)
    y,x=np.mgrid[:N,:N];r=np.hypot(x-255.5,y-255.5)/RADIUS
    for i in range(8):
        mask=r<=1 if i<7 else np.ones((N,N),bool)
        b=tile(base,i).astype(float);z=tile(height,i).astype(float)*160/65535
        n=tile(normal,i).astype(float)/127.5-1;o=tile(orm,i,256)/255.
        pitch=1100/RADIUS if i<7 else 2400/512
        if i==7:
            dx=(np.roll(z,-1,1)-np.roll(z,1,1))/(2*pitch)
            dy=(np.roll(z,-1,0)-np.roll(z,1,0))/(2*pitch)
        else:dy,dx=np.gradient(z,pitch)
        expected=normalize(np.stack([-dx,dy,np.ones_like(z)],-1))
        angle=np.degrees(np.arccos(np.clip(np.sum(normalize(n)*expected,axis=-1),-1,1)))
        lengths=np.linalg.norm(n,axis=-1)
        mean=b[mask].mean(0);lum=np.sum(b*LUMA,axis=-1)
        check(f'{i} palette mean',np.max(abs(mean-TARGETS[i]))<.1,mean.tolist())
        check(f'{i} normalized normal',np.max(abs(lengths-1))<.007,float(np.max(abs(lengths-1))))
        check(f'{i} normal from saved height',angle.max()<.42,float(angle.max()))
        check(f'{i} relief range',z.min()>0 and z.max()<160,[float(z.min()),float(z.max())])
        check(f'{i} positive hemisphere',np.all(n[...,2]>0))
        geom=json.loads((SRC/f'cell_{i}_geometry.json').read_text())
        dims=np.array([[a['length_mm'],a['width_mm']] for a in geom['leaves']])
        check(f'{i} authored blade dimensions',np.all((dims>=[90,40])&(dims<=[130,60])),
              dict(length_mm=[float(dims[:,0].min()),float(dims[:,0].max())],width_mm=[float(dims[:,1].min()),float(dims[:,1].max())]))
        check(f'{i} opposite pairs',all(a['pairs'] in [3,4] for a in geom['shoots']))
        coverage=np.load(SRC/f'cell_{i}_authored.npz')
        brown=float(coverage['brown_coverage'][mask].mean())
        check(f'{i} brown 1 to 3 percent',.01<=brown<=.03,brown)
        check(f'{i} leaf detail beyond disc',np.count_nonzero(coverage['ids'][r>1])>.90*np.count_nonzero(r>1))
        rough=float(np.median(o[...,1]));ao=[float(o[...,0].min()),float(o[...,0].max())]
        check(f'{i} roughness role',rough<.62 if i<6 else rough>.65,rough)
        check(f'{i} AO range',ao[0]>=.3 and ao[1]<=1,ao)
        check(f'{i} leaf faces over dark gaps',np.percentile(lum[mask],90)-np.percentile(lum[mask],10)>(22 if i==7 else 38))
        reduced={};plane=[0,0];radial={}
        if i<7:
            design=np.stack([np.ones_like(r),(x-255.5)/256,(y-255.5)/256,r*r,r**4],-1)
            fit=np.linalg.lstsq(design[mask],np.log(np.maximum(lum[mask],1)),rcond=None)[0]
            plane=fit[1:3].tolist()
            check(f'{i} no axis light bias',max(abs(fit[1:3]))<.12,plane)
            radial=dict(centre=float(lum[r<.55].mean()),rim=float(lum[(r>.92)&(r<1)].mean()),padding=float(lum[r>1.05].mean()))
            check(f'{i} edge turns under',radial['rim']<radial['centre']*.85,radial)
            for size in [35,20,9]:
                v=np.sum(srgb(resize(linear(b),(size,size))).astype(float)*LUMA,axis=-1)
                yy,xx=np.mgrid[:size,:size];rr=np.hypot(xx-(size-1)/2,yy-(size-1)/2)/(size*.47)
                m=rr<.92;design=np.stack([np.ones_like(rr),rr**2,rr**4],-1)
                fit2=np.linalg.lstsq(design[m],v[m],rcond=None)[0]
                contrast=float(np.std((v-np.sum(design*fit2,axis=-1))[m]));reduced[str(size)]=contrast
                check(f'{i} clumps survive {size}px',contrast>5,contrast)
        records.append(dict(index=i,name=LABELS[i],mean_rgb=mean.tolist(),height_mm=[float(z.min()),float(z.max())],
            normal_max_error_deg=float(angle.max()),normal_max_length_error=float(np.max(abs(lengths-1))),
            roughness_median=rough,ao_range=ao,brown_visible_fraction=brown,axis_fit=plane,radial=radial,
            clump_residual_std=reduced,authored_blades=len(geom['leaves']),
            blade_length_pixels=[float(dims[:,0].min()/pitch),float(dims[:,0].max()/pitch)]))
    seams={}
    for name,atlas,size in [('base',base,512),('normal',normal,512),('height',height,512),('orm',orm,256)]:
        t=tile(atlas,7,size).astype(float)
        ratios=[float(np.abs(t[:,0]-t[:,-1]).mean()/max(np.abs(np.diff(t,axis=1)).mean(),1e-9)),
                float(np.abs(t[0]-t[-1]).mean()/max(np.abs(np.diff(t,axis=0)).mean(),1e-9))]
        seams[name]=ratios;check(name+' periodic seam neighbour ratio',max(ratios)<1.75,ratios)
    corr=[]
    for a,b in [(0,1),(2,3),(4,5)]:
        la=np.sum(tile(base,a).astype(float)*LUMA,axis=-1);lb=np.sum(tile(base,b).astype(float)*LUMA,axis=-1)
        # Subtract common radial profile before testing duplicate composition.
        mask=r<=1;design=np.stack([np.ones_like(r),r*r,r**4],-1)
        residual=[]
        for lum in [la,lb]:
            fit=np.linalg.lstsq(design[mask],lum[mask],rcond=None)[0]
            residual.append((lum-np.sum(design*fit,axis=-1))[mask])
        c=float(np.corrcoef(residual)[0,1]);corr.append(c)
        check(f'{a}/{b} distinct variants',abs(c)<.60,c)
    check('fresh-growth pigment ceiling',np.all(base[:512,:1024]<=[170,176,76]))
    originals=json.loads((SRC/'originals.json').read_text())
    for a in originals:
        check('frozen source '+a['file'],hashlib.sha256((SRC/a['file']).read_bytes()).hexdigest()==a['sha256'])
    result=dict(passed=sum(a['passed'] for a in tests),total=len(tests),checks=tests,cells=records,seams=seams,
        variant_correlations=corr,height_encoding_mm=[0,160],
        render_method='Closed 1.4 x 1.4 x 0.92 m ellipsoid, two polar charts, 4x supersampling, linear-light mips, trilinear sampling, blue ambient, tangent normals; local diagnostic, not game footage.')
    (OUT/'metrics.json').write_text(json.dumps(result,indent=2)+'\n')
    return result


def purpose(renderer,phone=False):
    im,d=canvas((1350,1370),'Mangrove heads / '+('half-size phone atlas' if phone else 'full atlas'),
        '35, 20 and 9 pixel core diameters. Native samples above labelled nearest-neighbour enlargements. Fixed exposure; blue sky fill.')
    concept=Image.open(SRC/'mangrove_lineup.png');put(im,concept.crop((920,60,1510,665)),(24,100,370,390))
    d.text((24,495),'Project concept / third mangrove',font=font(16),fill=INK)
    put(im,Image.open(SRC/'leaves_concept.png').crop((610,0,1075,335)),(24,530,370,290))
    d.text((24,816),'Mangrove twig / concept',font=font(16),fill=INK)
    texts=['Core is 1.4 m wide, 0.92 m tall.','Upper view: 35 degrees.','Underside view: -60 degrees.','Local CPU material diagnostic.','No game capture or wind.','Geometry supplies the silhouette;','leaf cards shown separately.']
    for k,t in enumerate(texts):d.text((24,890+k*26),t,font=font(16),fill=MUTED)
    d.text((24,1110),'Concept leaf clump / approximate scale',font=font(16),fill=INK)
    concept_patch=concept.crop((1140,115,1257,232))
    for col,size in enumerate([35,20,9]):
        x=24+col*124;sample=concept_patch.resize((size,size),Image.Resampling.LANCZOS)
        im.paste(sample,(x,1140));scale=3 if size==35 else 4 if size==20 else 6
        im.paste(sample.resize((size*scale,size*scale),Image.Resampling.NEAREST),(x,1188))
        d.text((x,1305),str(size)+'px / '+str(scale)+'x',font=font(14),fill=MUTED)
    d.text((24,1333),'117px crop ~1.4m, inferred from M03 crown.',font=font(13),fill=MUTED)
    rows=[(0,35,0),(0,35,1),(4,35,0),(4,35,1),(6,-60,0),(6,-60,1)]
    for j,(idx,el,li) in enumerate(rows):
        y=95+j*207;name,light=LIGHTS[li]
        d.text((435,y),f'{LABELS[idx]} / {name}',font=font(16),fill=INK)
        for col,size in enumerate([35,20,9]):
            x=435+col*300;shot=renderer.render(idx,size,light,elevation=el)
            suffix='phone' if phone else 'full';shot.save(OUT/f'core_{suffix}_{idx}_{li}_{size}px.png')
            im.paste(shot,(x,y+28));scale={35:3,20:4,9:6}[size]
            enlarged=shot.resize((shot.width*scale,shot.height*scale),Image.Resampling.NEAREST)
            im.paste(enlarged,(x+70,y+28));d.text((x,y+174),f'{size}px / {scale}x',font=font(14),fill=MUTED)
    im.save(OUT/('purpose_phone.png' if phone else 'purpose_distance.png'))


def reviews(base,normal,height,orm,renderer):
    # Labelled full-resolution atlas: useful for checking leaf scale and padding.
    im,d=canvas((2088,1144),'Mangrove crown / upper half only','0-1 sun | 2-3 middle | 4-5 shade | 6 underside | 7 periodic interior. All disc radii 240.64px.')
    im.paste(Image.fromarray(base),(20,100))
    for i,label in enumerate(LABELS):
        row,col=divmod(i,4);d.rectangle((20+col*512,100+row*512,190+col*512,126+row*512),fill=BG)
        d.text((26+col*512,104+row*512),str(i)+' / '+label,font=font(17),fill=INK)
    im.save(OUT/'atlas_preview.png')
    im,d=canvas((1600,740),'Shared relief and material channels','Height display: 0-160 mm. Tangent normals come from the saved 16-bit height. ORM blue is identically zero.')
    maps=[base,normal,np.repeat((height/257).astype(np.uint8)[...,None],3,2),orm]
    for k,(a,name) in enumerate(zip(maps,['sRGB base','Linear tangent normal','16-bit height / display only','Occlusion / roughness / metal'])):
        x=20+(k%2)*790;y=90+(k//2)*320
        d.text((x,y),name,font=font(17),fill=INK);put(im,Image.fromarray(a),(x,y+30,760,280))
    im.save(OUT/'layers.png')
    im,d=canvas((1470,710),'Same physical scale / existing sprays and new heads','Every patch spans 0.8 m. Display 2x at head texel density. Cards retain their original alpha and original 13-17cm blade scale.')
    sprites=Image.open(SRC/'sprays_base.png');crop=int(round(.8*RADIUS/1.1));disp=crop*2
    for col,k in enumerate([0,1,2,3]):
        x=20+col*362;card=sprites.crop(((k%2)*512,(k//2)*512,(k%2+1)*512,(k//2+1)*512)).resize((crop,crop),Image.Resampling.LANCZOS)
        bg=Image.new('RGBA',card.size,(34,47,34,255));bg.alpha_composite(card)
        im.paste(bg.convert('RGB').resize((disp,disp),Image.Resampling.NEAREST),(x,115))
        d.text((x,85),f'Spray {k} / 0.8 m',font=font(16),fill=INK)
        a=tile(base,k if k<2 else k+2);patch=Image.fromarray(a).crop((170,170,170+crop,170+crop))
        # Half-height panel avoids an unnecessarily huge sheet; crop is unchanged.
        put(im,patch,(x,510,disp,170));d.text((x,480),f'{LABELS[k if k<2 else k+2]} / same 0.8 m',font=font(16),fill=INK)
    # Replace reduced lower patches with equal-size patches on a taller canvas.
    tall=Image.new('RGB',(1470,925),BG);tall.paste(im,(0,0));d=ImageDraw.Draw(tall)
    for col,k in enumerate([0,1,2,3]):
        x=20+col*362;a=tile(base,k if k<2 else k+2)
        patch=Image.fromarray(a).crop((170,170,170+crop,170+crop)).resize((disp,disp),Image.Resampling.NEAREST)
        tall.paste(patch,(x,510));d.line((x,880,x+disp,880),fill=INK,width=2);d.text((x,890),'0.8 m / 9-13 cm head blades',font=font(15),fill=MUTED)
    tall.save(OUT/'leaf_scale_and_cards.png')
    im,d=canvas((1230,830),'Sharp detail from centre through padding','128px crops, 2x nearest-neighbour. No colour blur at the disc edge. Brown leaves are sparse, whole blades.')
    for row,idx in enumerate([0,6]):
        for col,(label,box) in enumerate([('centre',(192,192,320,320)),('turning-under rim',(358,192,486,320)),('outside disc',(0,0,128,128))]):
            x=20+col*405;y=95+row*355
            d.text((x,y),LABELS[idx]+' / '+label,font=font(17),fill=INK)
            patch=Image.fromarray(tile(base,idx)).crop(box).resize((256,256),Image.Resampling.NEAREST)
            im.paste(patch,(x,y+32))
    im.save(OUT/'edge_detail.png')
    interior=tile(base,7);Image.fromarray(np.tile(interior,(2,2,1))).save(OUT/'interior_tiled_2x2.png')
    Image.fromarray(np.roll(interior,(256,256),(0,1))).save(OUT/'interior_offset.png')
    im,d=canvas((1250,900),'Every chart / rotations under fixed side light','90px cores at native size. Rotations change material orientation; the world light stays fixed. Underside row viewed from below.')
    for idx in range(7):
        y=93+idx*112;d.text((20,y+12),LABELS[idx],font=font(17),fill=INK)
        for col,rot in enumerate([0,90,180,270]):
            shot=renderer.render(idx,90,LIGHTS[1][1],elevation=-60 if idx==6 else 35,rotation=rot,ss=2)
            im.paste(shot,(180+col*265,y));d.text((290+col*265,y+10),str(rot)+' deg',font=font(15),fill=MUTED)
    im.save(OUT/'all_heads.png')


def assembly(renderer,phone=False):
    r=AssemblyRenderer(renderer,phone)
    im,d=canvas((1250,665),'Core plus twelve existing mangrove sprays / '+('phone' if phone else 'full'),
        '1.4m core, 0.8m cards, approximately 2m span. Alpha cut 0.5; no coverage boost. Local diagnostic, not engine footage.')
    for row,(label,light) in enumerate(LIGHTS):
        y=100+row*265;d.text((20,y),label,font=font(18),fill=INK)
        for col,size in enumerate([35,20,9]):
            x=195+col*330;shot=r.render(0,size,light,elevation=25)
            im.paste(shot,(x,y+28));scale={35:4,20:5,9:7}[size]
            im.paste(shot.resize((shot.width*scale,shot.height*scale),Image.Resampling.NEAREST),(x+70,y+28))
            d.text((x,y+230),f'{size}px assembly span / {scale}x',font=font(15),fill=MUTED)
    im.save(OUT/('assembly_phone.png' if phone else 'assembly_distance.png'))


def rendered_audit(renderer,phone):
    """Purpose measurements from lit, filtered results, separate from atlas stats."""
    records=[];tests=[]
    for tier,r in [('full',renderer),('phone',phone)]:
        for index in range(6):
            for size in [35,20,9]:
                image=r.render(index,size,LIGHTS[0][1],elevation=35)
                rgb=np.asarray(image).astype(float);s=rgb.shape[0]
                yy,xx=np.mgrid[:s,:s];x=(xx-(s-1)/2)/(size/2);y=(yy-(s-1)/2)/(size/2)
                # Interior sample strips avoid silhouette/background mixtures.
                top=(abs(x)<.55)&(y>-.49)&(y<-.10)
                bottom=(abs(x)<.55)&(y>.27)&(y<.55)
                lum=np.sum(rgb*LUMA,axis=-1)
                upper=float(lum[top].mean());lower=float(lum[bottom].mean());ratio=upper/lower
                tests.append(dict(name=f'{tier} cell {index} {size}px lit top above underside',passed=ratio>1.15,value=ratio))
                records.append(dict(tier=tier,index=index,diameter_px=size,upper_luma=upper,lower_luma=lower,ratio=ratio))
    (OUT/'render_metrics.json').write_text(json.dumps(dict(checks=tests,renders=records),indent=2)+'\n')
    return tests


def main():
    OUT.mkdir(exist_ok=True)
    base=np.asarray(Image.open(ROOT/'mangrove_heads_base.png'))
    normal=np.asarray(Image.open(ROOT/'mangrove_heads_normal.png'))
    height=np.asarray(Image.open(ROOT/'mangrove_heads_height.png'))
    orm=np.asarray(Image.open(ROOT/'mangrove_heads_orm.png'))
    result=audit(base,normal,height,orm)
    renderer=Renderer(base,normal,orm);purpose(renderer);reviews(base,normal,height,orm,renderer);assembly(renderer)
    phone=Renderer(base,normal,orm,phone=True);purpose(phone,True);assembly(phone,True)
    tests=rendered_audit(renderer,phone)
    result['checks'].extend(tests);result['total']=len(result['checks'])
    result['passed']=sum(a['passed'] for a in result['checks'])
    (OUT/'metrics.json').write_text(json.dumps(result,indent=2)+'\n')
    print(f'{result["passed"]}/{result["total"]} checks pass.')
    for t in result['checks']:
        if not t['passed']:print('FAIL:',t['name'],t['value'])
    if result['passed']!=result['total']:raise SystemExit(1)


if __name__=='__main__':main()
