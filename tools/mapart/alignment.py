"""Robust global geometry alignment; constrain repeated urban corners by position."""
import cv2 as cv
import numpy as np
from scipy import ndimage as nd
from scipy.optimize import minimize
from PIL import Image

def shore_align(paint,truth):
    """Fit island silhouettes using a similarity transform, without urban shear."""
    n=256
    wet=(paint[...,1]-paint[...,0]>3)&(paint[...,2]-paint[...,0]>-18)
    def clean(a):
        a=np.asarray(Image.fromarray(a).resize((n,n),Image.Resampling.NEAREST))
        a=nd.binary_closing(a,iterations=2,border_value=1)
        labels,count=nd.label(a)
        if count:
            sizes=np.bincount(labels.ravel());sizes[0]=0;a=labels==sizes.argmax()
        return a
    sm=clean(wet);tm=clean(truth)
    sd=nd.distance_transform_edt(sm)-nd.distance_transform_edt(~sm)
    td=nd.distance_transform_edt(tm)-nd.distance_transform_edt(~tm)
    yy,xx=np.mgrid[:n,:n].astype(np.float32);xc=xx-n/2;yc=yy-n/2
    weight=.15+np.exp(-(np.abs(td)/18)**2)
    def loss(p):
        scale,angle,dx,dy=p;c=np.cos(angle);s=np.sin(angle)
        v=nd.map_coordinates(sd,[scale*(s*xc+c*yc)+n/2+dy,scale*(c*xc-s*yc)+n/2+dx],order=1,mode='nearest')
        delta=np.clip(v,-32,32)-np.clip(td,-32,32)
        return np.sum(np.sqrt(delta*delta+.25)*weight)/weight.sum()
    starts=[[1,0,0,0],[1/1.082,0,-(1-1/1.082)*128,-(1-1/1.082)*128]]
    fits=[minimize(loss,p,method='Powell',bounds=[(.85,1.15),(-.035,.035),(-24,24),(-24,24)],
                   options={'maxiter':80,'xtol':.0001,'ftol':.00001}) for p in starts]
    fit=min(fits,key=lambda f:f.fun);scale,angle,dx,dy=fit.x;c=np.cos(angle);s=np.sin(angle)
    h,w=truth.shape;yy,xx=np.mgrid[:h,:w].astype(np.float32);xc=xx-w/2;yc=yy-h/2
    sy=scale*(s*xc+c*yc)+h/2+dy*h/256;sx=scale*(c*xc-s*yc)+w/2+dx*w/256
    out=np.stack([nd.map_coordinates(paint[...,i],[sy,sx],order=1,mode='reflect') for i in range(3)],-1)
    return out,{'method':'silhouette_similarity_multistart','parameters':fit.x.tolist(),'loss':float(fit.fun)}

def feature_align(paint,reference):
    cv.setRNGSeed(117)
    gray1=cv.cvtColor(np.uint8(paint),cv.COLOR_RGB2GRAY)
    gray2=cv.cvtColor(np.uint8(reference),cv.COLOR_RGB2GRAY)
    sift=cv.SIFT_create(nfeatures=16000,contrastThreshold=.01)
    k1,d1=sift.detectAndCompute(gray1,None);k2,d2=sift.detectAndCompute(gray2,None)
    if d1 is None or d2 is None:return paint,False,{'method':'no_features'}
    pairs=cv.BFMatcher().knnMatch(d1,d2,k=2)
    good=[m for pair in pairs if len(pair)==2 for m,n in [pair] if m.distance<.85*n.distance]
    if len(good)<6:return paint,False,{'method':'too_few_matches','matches':len(good)}
    a=np.float32([k1[m.queryIdx].pt for m in good]);b=np.float32([k2[m.trainIdx].pt for m in good])
    best=None
    for scale in [1.0,1.082]:
        local=np.linalg.norm(a*scale-b,axis=1)<48
        if local.sum()<6:continue
        mat,inside=cv.estimateAffinePartial2D(a[local],b[local],method=cv.RANSAC,
              ransacReprojThreshold=5,maxIters=10000,confidence=.999)
        if mat is None or inside is None:continue
        inside=inside.ravel().astype(bool);count=int(inside.sum())
        s=np.hypot(mat[0,0],mat[1,0]);angle=np.degrees(np.arctan2(mat[1,0],mat[0,0]))
        span=np.ptp(b[local][inside],axis=0) if count else [0,0]
        if count<8 or not(.9<s<1.16) or abs(angle)>2 or np.any(np.abs(mat[:,2])>70) or min(span)<100:continue
        if best is None or count>best[0]:best=(count,mat,a[local][inside],b[local][inside])
    if best is None:return paint,False,{'method':'rejected_feature_fit','matches':len(good)}
    count,mat,aa,bb=best
    error=np.linalg.norm(aa@mat[:,:2].T+mat[:,2]-bb,axis=1)
    aligned=cv.warpAffine(paint,mat,(paint.shape[1],paint.shape[0]),flags=cv.INTER_LINEAR,borderMode=cv.BORDER_REFLECT_101)
    return aligned,True,{'method':'SIFT_position_constrained_RANSAC','inliers':count,
              'median_residual_px':float(np.median(error)),'matrix':mat.tolist()}
