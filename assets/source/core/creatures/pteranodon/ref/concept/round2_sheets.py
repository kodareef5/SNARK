"""Quantize generated region maps, make regional variants and exact-pixel read sheets."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
from scipy import ndimage as ndi
import numpy as np
import json
from round2_finish import R,C,BG,ORTHO,SADDLED,EXTRA,PALETTE
def maps():
    data={}
    lookup=np.array([0,3,2,4,1,5,6,7],np.uint8)
    for n in ORTHO:
        im=Image.open(R/f'{n}.png').convert('RGB');a=np.array(im)
        m=np.array(Image.open(R/f'{n}_mask.png'))>=128
        src=np.array(Image.open(R/'round2_region_originals'/f'{n}.png').convert('RGB').resize(im.size,Image.Resampling.NEAREST))
        bits=(src>127).astype(np.uint8);lab=lookup[bits[:,:,0]*4+bits[:,:,1]*2+bits[:,:,2]]
        yy,xx=np.indices(m.shape)
        # Keep genuine black claw/gape regions; extend color to missed edge
        # pixels so all maps use exactly the exported painted silhouette.
        if n in ['top','underside']:
            black_allowed=(yy>1300)|((abs(xx-990)<35)|(abs(xx-2210)<35))&(yy>780)&(yy<890)
        elif n=='front':black_allowed=(yy>1200)|((abs(xx-990)<40)|(abs(xx-2210)<40))&(yy>1000)&(yy<1080)
        elif n=='side':black_allowed=(xx>1320)|((xx>840)&(xx<900)&(yy>1060)&(yy<1130))|((xx<665)&(yy>924)&(yy<944))
        elif n=='folded_side':black_allowed=(yy>1410)|((xx<730)&(yy>878)&(yy<902))
        else:black_allowed=yy>1415
        donors=(lab>0)&m
        ix=ndi.distance_transform_edt(~donors,return_distances=False,return_indices=True)
        fill=m&(lab==0)&~black_allowed;lab[fill]=lab[tuple(ix[:,fill])]
        if n=='underside':lab[lab==7]=6
        if n in ['side','folded_side']:
            dx,dy=(0,0) if n=='side' else (72,-44)
            head=m&(yy<958+dy)&(xx<825+dx)
            r,gr,b=a.astype(float).transpose(2,0,1)
            orange=(r-gr>26)&(r-b>45)
            dark=(a.mean(axis=2)<150)&(r-gr<32)
            lab[head]=6;lab[head&orange]=3;lab[head&dark]=1
            lab[head&dark&(yy<810+dy)&(xx>680+dx)]=4
            smooth=ndi.median_filter(lab,size=5)
            lab[head]=smooth[head]
            # Warm lower-cheek shadows are fur, not isolated horn flecks.
            # Preserve the separate orange tip above the cyan crest band.
            lab[head&(lab==3)&(yy>906+dy)&(xx>600+dx)]=6
            lab[head&(lab==1)&(yy>915+dy)&(xx<700+dx)]=6
            lab[head&(a.mean(axis=2)<70)&(xx<600+dx)&(yy>922+dy)&(yy<938+dy)]=0
            eye=((xx-(620+dx))/8)**2+((yy-(901+dy))/8)**2<=1
            lab[eye&m]=7
        if n=='top':
            zone=m&(abs(xx-1600)<48)&(yy>520)&(yy<870)
            r,gr,b=a.astype(float).transpose(2,0,1)
            orange=(r-gr>26)&(r-b>45)
            dark=(a.mean(axis=2)<155)&(np.max(a,axis=2)-np.min(a,axis=2)<55)
            lab[zone]=6;lab[zone&dark]=1;lab[zone&orange]=3
            lab[zone&(abs(xx-1600)<8)&(yy>753)&(yy<780)&dark]=4
        # Mark all dark claw pixels actually visible in the painting.
        skin=lab==3;near=ndi.binary_dilation(skin&black_allowed,iterations=6)
        claws=near&black_allowed&(a.mean(axis=2)<92)&((a[:,:,0].astype(int)-a[:,:,1])<28)&m
        lab[claws]=0
        # The end of the long wing finger belongs to charcoal, including edge.
        if n in ['top','underside','front']:
            outer=((xx<490)|(xx>2710))&m;lab[outer&(lab==6)]=1
        lab[~m]=0
        Image.fromarray(PALETTE[lab]).save(R/f'regions_{n}.png');Image.fromarray(lab).save(C/f'{n}_region_ids.png')
        data[n]={'colors':[list(map(int,PALETTE[k])) for k in np.unique(lab)],'painted_mask_used':True,'region_area_pixels':{str(k):int(((lab==k)&m).sum()) for k in range(8)}}
    (C/'region_validation.json').write_text(json.dumps(data,indent=2))
def normalize_membranes():
    results={}
    for n in ORTHO+SADDLED:
        a=np.array(Image.open(R/f'{n}.png').convert('RGB'),float)
        mapped=n.replace('saddled_','')
        lab=np.array(Image.open(C/f'{mapped}_region_ids.png'));alpha=np.array(Image.open(R/f'{n}_mask.png'),float)/255
        sel=(lab==5)&(alpha>.99)
        if n in SADDLED:
            sel &= (a[:,:,0]<a[:,:,1]+8)&(a[:,:,2]>a[:,:,1]-6)
        target=np.array([111,124,136]) if n in ['underside','front'] else np.array([86,103,122])
        old=np.median(a[ndi.binary_erosion(sel,iterations=5)],axis=0)
        # A material color correction, retaining the original luminance detail.
        weight=ndi.gaussian_filter(sel.astype(float),3)*alpha
        adjusted=np.clip(a*target/old,0,255)
        a=a*(1-weight[:,:,None])+adjusted*weight[:,:,None]
        a[alpha==0]=BG
        Image.fromarray(np.uint8(a)).save(R/f'{n}.png')
        med=np.median(a[ndi.binary_erosion(sel,iterations=5)],axis=0)
        results[n]={'before_median_rgb':old.tolist(),'after_median_rgb':med.tolist(),'target_rgb':target.tolist(),'method':'multiplicative correction within generated membrane ID, 3px feather, no shape change'}
    (C/'membrane_colors.json').write_text(json.dumps(results,indent=2))
VARIANTS=[
    {'name':'sand / umber','rgb':[[57,47,39],[74,64,56],[179,153,120],[163,90,53],[98,84,75],[138,108,83],[213,206,184],[134,103,57]]},
    {'name':'buff / sage','rgb':[[40,47,38],[48,63,57],[145,141,107],[181,134,64],[69,81,72],[96,117,101],[227,211,175],[121,91,47]]},
    {'name':'dusky / silver','rgb':[[48,44,44],[83,85,104],[166,154,139],[136,93,71],[114,113,122],[179,187,192],[164,156,149],[169,141,85]]},
    {'name':'charcoal / pale horn','rgb':[[21,25,30],[30,36,43],[94,90,82],[209,188,139],[125,121,92],[53,62,72],[83,86,90],[197,167,96]]},
    {'name':'chalk / mauve slate','rgb':[[52,48,56],[62,67,72],[165,140,128],[153,89,75],[98,80,91],[123,123,131],[228,229,221],[165,122,63]]},
    {'name':'silver / ocean','rgb':[[41,43,50],[52,62,80],[159,146,124],[176,140,74],[74,83,98],[106,118,138],[193,198,190],[119,116,66]]},
]
def recolor(n,pal):
    a=np.array(Image.open(R/f'{n}.png').convert('RGB'),float)
    m=np.array(Image.open(R/f'{n}_mask.png'),float)/255
    lab=np.array(Image.open(C/f'{n}_region_ids.png'))
    lum=a[:,:,0]*.2126+a[:,:,1]*.7152+a[:,:,2]*.0722;out=np.zeros_like(a)
    for k in range(8):
        s=(lab==k)&(m>.5)
        if not s.any():continue
        median=np.median(lum[s]);ratio=np.clip(lum/max(median,10),.55,1.35)
        col=np.array(pal[k])[None,None,:]*ratio[:,:,None]
        out[s]=col[s]
    # Blend neighboring region colors by 0.7px, avoiding hard quantization seams.
    for ch in range(3):out[:,:,ch]=ndi.gaussian_filter(out[:,:,ch],.5)
    out=np.clip(out,0,255)*m[:,:,None]+BG*(1-m[:,:,None]);return Image.fromarray(np.uint8(out))
def sheets():
    sheet=Image.new('RGB',(2600,3600),tuple(BG))
    for row,v in enumerate(VARIANTS):
        for n,x,w in [('underside',50,1450),('side',1580,960)]:
            im=recolor(n,v['rgb']);m=Image.open(R/f'{n}_mask.png');b=m.getbbox();im=im.crop(b)
            h=round(im.height*w/im.width);im=im.resize((w,h),Image.Resampling.LANCZOS)
            sheet.paste(im,(x,row*600+(600-h)//2))
    sheet.save(R/'variants.png');(C/'variant_palettes.json').write_text(json.dumps(VARIANTS,indent=2))
    # Same world scale: all four columns use the labelled projected wingspan.
    sheet=Image.new('RGB',(880,560),tuple(BG));details=[]
    span=Image.open(R/'underside_mask.png').getbbox();span=span[2]-span[0]
    for col,width in enumerate([128,110,45,16]):
        for row,(n,silhouette) in enumerate([('underside',False),('underside',True),('side',False),('side',True)]):
            mask=Image.open(R/f'{n}_mask.png');b=mask.getbbox();im=Image.open(R/f'{n}.png').convert('RGB').crop(b);mask=mask.crop(b)
            scale=width/span;size=(max(1,round(im.width*scale)),max(1,round(im.height*scale)))
            if silhouette:im=Image.new('RGB',im.size,(0,0,0))
            im.putalpha(mask);im=im.resize(size,Image.Resampling.LANCZOS)
            x=col*220+(220-size[0])//2;y=row*140+(140-size[1])//2
            sheet.paste(im,(x,y),im.getchannel('A'));details.append({'view':n,'black_silhouette':silhouette,'span_px':width,'actual_image_size':size,'position':[x,y]})
    sheet.save(R/'read_sizes.png');(C/'read_sizes_layout.json').write_text(json.dumps(details,indent=2))
    try:font=ImageFont.truetype('/System/Library/Fonts/Menlo.ttc',17)
    except:font=ImageFont.load_default()
    annotated=Image.new('RGB',(1120,650),tuple(BG));annotated.paste(sheet,(200,70));d=ImageDraw.Draw(annotated)
    for i,w in enumerate([128,110,45,16]):d.text((225+i*220,24),f'span {w}px',font=font,fill='black')
    for i,s in enumerate(['underside','silhouette','side','silhouette']):d.text((18,128+i*140),s,font=font,fill='black')
    d.text((18,620),'Both views use the same pixels/metre; side projected width is smaller than span.',font=font,fill='black')
    annotated.save(C/'read_sizes_annotated.png')
def contact():
    names=ORTHO+SADDLED+EXTRA
    sheet=Image.new('RGB',(2400,2000),tuple(BG));d=ImageDraw.Draw(sheet)
    try:font=ImageFont.truetype('/System/Library/Fonts/Menlo.ttc',21)
    except:font=ImageFont.load_default()
    for i,n in enumerate(names):
        im=Image.open(R/f'{n}.png').convert('RGB');mask=Image.open(C/f'{n}_matte.png');b=mask.getbbox();im=im.crop(b);im.thumbnail((550,335),Image.Resampling.LANCZOS)
        x=(i%4)*600;y=(i//4)*500;sheet.paste(im,(x+(600-im.width)//2,y+70+(360-im.height)//2));d.text((x+20,y+20),n,font=font,fill='black')
    sheet.save(C/'paintings_review.png')
    sheet=Image.new('RGB',(2400,1500),(0,0,0));d=ImageDraw.Draw(sheet)
    for i,n in enumerate(ORTHO):
        im=Image.open(R/f'regions_{n}.png');m=Image.open(R/f'{n}_mask.png');im=im.crop(m.getbbox());im.thumbnail((740,570),Image.Resampling.NEAREST)
        x=(i%3)*800;y=(i//3)*750;sheet.paste(im,(x+(800-im.width)//2,y+90+(600-im.height)//2));d.text((x+20,y+20),n,font=font,fill='white')
    sheet.save(C/'regions_review.png')
if __name__=='__main__':
    maps();normalize_membranes();sheets();contact()
