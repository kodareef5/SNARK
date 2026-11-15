"""Measure exported fold sections in true surface millimetres."""
import site
site.addsitedir(site.getusersitepackages())
import sys
sys.dont_write_bytecode=True
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import paint
import numpy as np
from PIL import Image,ImageDraw
from scipy.spatial import cKDTree
from scipy.ndimage import gaussian_filter1d
from scipy.signal import find_peaks,peak_widths
import json


def main():
    _,piece,p,ids,reg,_=paint.load_geometry()
    m=(piece==ids['shell_face'])&(reg==[0,255,0]).all(-1)
    p=p[m];h=np.asarray(Image.open(paint.ROOT/'layers/dodo_height.png'))[m]/65535*8-4
    q=p-paint.EYE;u=(paint.dot(q,paint.EYE_ACROSS)+.8)/1.16;v=-paint.dot(q,paint.LID_UP)+3.45
    keep=(paint.dot(q,paint.LOOK)>6)&(np.linalg.norm(q,axis=1)<32)
    pp=p[keep];hh=h[keep];uv=np.column_stack([u[keep],v[keep]])
    vv=np.linspace(1.5,20,1500);query=np.column_stack([np.zeros_like(vv),vv])
    d,i=cKDTree(uv).query(query,k=10);w=1/np.maximum(d,.03)**3;w/=w.sum(1)[:,None]
    path=(pp[i]*w[...,None]).sum(1);path=gaussian_filter1d(path,5,axis=0)
    section=(hh[i]*w).sum(1);section=gaussian_filter1d(section,4)
    arc=np.r_[0,np.cumsum(np.linalg.norm(np.diff(path,axis=0),axis=1))]
    peaks,_=find_peaks(section,prominence=.8,distance=130)
    widths=peak_widths(section,peaks,rel_height=.5)
    index=np.arange(len(vv));left=np.interp(widths[2],index,arc);right=np.interp(widths[3],index,arc)
    eye_widths=right-left
    report=dict(eye_half_prominence_width_mm=eye_widths.tolist(),peak_height_mm=section[peaks].tolist(),
                chart_v_at_peaks_mm=vv[peaks].tolist(),physical_pitch_mm=np.diff(arc[peaks]).tolist(),
                note='Median-direction section through the central rolls; distance follows baked surface positions, not atlas texels.')
    # A cross-section normal to the mouth curve, half way round its down-turn.
    _,piece,allp,ids,_,_=paint.load_geometry()
    fm=piece==ids['shell_face']
    n=np.asarray(Image.open(paint.BAKES/'dodo_normal_object.png'),np.float32)/127.5-1
    chart=paint.mouth_chart.build(allp[fm],paint.norm(n[fm]))
    t=.58;c=chart['curve'](t);along=paint.norm(chart['curve'](t,1))
    right=paint.norm(np.cross(along,paint.norm(chart['normal'](t))))
    delta=p-c;near=np.linalg.norm(delta,axis=1)<13
    au=paint.dot(delta[near],along);av=paint.dot(delta[near],right)
    cross=np.linspace(-8,3,1200)
    dist,ix=cKDTree(np.column_stack([au,av])).query(np.column_stack([np.zeros_like(cross),cross]),k=10)
    w=1/np.maximum(dist,.03)**3;w/=w.sum(1)[:,None]
    mp=(p[near][ix]*w[...,None]).sum(1);mp=gaussian_filter1d(mp,5,axis=0)
    mh=gaussian_filter1d((h[near][ix]*w).sum(1),4)
    ma=np.r_[0,np.cumsum(np.linalg.norm(np.diff(mp,axis=0),axis=1))]
    pk,_=find_peaks(mh,prominence=1,distance=100)
    pk=pk[np.argmax(mh[pk]):np.argmax(mh[pk])+1]
    mw=peak_widths(mh,pk,rel_height=.5)
    measured=np.interp(mw[3],np.arange(len(cross)),ma)-np.interp(mw[2],np.arange(len(cross)),ma)
    report['mouth_half_prominence_width_mm']=float(measured[0])
    report['mouth_peak_height_mm']=float(mh[pk[0]])
    assert len(peaks)==3, 'Expected three substantial eye rolls'
    assert np.all((eye_widths>2.9)&(eye_widths<4.3)), 'Eye rolls outside the requested physical width'
    assert np.all(np.diff(section[peaks])<-.15), 'Top eye roll must be heaviest'
    assert 3.5<measured[0]<4.8, 'Mouth roll must remain about four millimetres wide'
    assert mh[pk[0]]>2.5 and section[peaks[-1]]>2.3, 'Folds have lost their raised flesh'
    report['physical_profile_checks_passed']=True
    (paint.ROOT/'checks/profile_audit.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
    im=Image.new('RGB',(1000,400),(250,248,245));draw=ImageDraw.Draw(im)
    for y in range(5):draw.line([(40,350-y*75),(980,350-y*75)],fill=(200,200,200));draw.text((4,345-y*75),str(y),fill='black')
    pts=[(40+float(s)*900/30,350-float(a)*75) for s,a in zip(arc,section)]
    draw.line(pts,fill=(150,65,50),width=3);draw.text((40,10),'Saved eye-fold height (mm) / physical surface distance (mm)',fill='black')
    im.save(paint.ROOT/'checks/eye_profile.png')
if __name__=='__main__':main()
