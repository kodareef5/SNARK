"""Paint the boxed finish cells in their shared order."""
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

from finishes import FITTINGS
from graphics import artwork


def fittings():
    size, cell = 1024, 256
    rgb = np.zeros((size,size,3),np.uint8)
    packed = np.zeros_like(rgb)
    packed[:] = (255,150,0)
    height = np.full((size,size),128,np.float32)
    y,x = np.mgrid[:cell,:cell].astype(np.float32)
    u,v = (x-127.5)/117.5, (y-127.5)/117.5
    r = np.hypot(u,v)
    theta = np.arctan2(v,u)
    palette = {
        "chrome": ((227,211,188),56,255), "steel": ((202,193,175),85,255),
        "bronze": ((194,155,94),73,255), "slate": ((55,65,70),88,227),
        "rubber": ((32,36,39),183,0), "grip": ((39,42,44),162,0),
        "gauge": ((18,26,31),32,0), "chart": ((18,36,45),37,0),
        "intake": ((34,41,45),117,155), "throttle": ((55,45,40),89,0),
        "red": ((194,32,33),47,0), "green": ((12,149,99),45,0), "lamp": ((218,223,209),45,0),
    }
    for i,tag in enumerate(FITTINGS):
        sy,sx = (i//4)*cell,(i%4)*cell
        where = np.s_[sy:sy+cell,sx:sx+cell]
        colour,rough,metal = palette[tag]
        rng = np.random.default_rng(8101+i)
        noise = rng.normal(0,1,x.shape)
        cloud = gaussian_filter(noise,7)*22
        h = noise*.35
        tone = noise*.009
        occlusion = np.ones(x.shape)
        if tag in ("chrome","steel","bronze","slate"):
            parallel = gaussian_filter(noise,(.45,18))*7
            circular = np.sin(r*228+cloud*.8)
            grain = circular if tag=="bronze" else parallel
            brush = {"chrome":.25,"steel":1.0,"bronze":.8,"slate":.56}[tag]
            rough = rough + brush*(grain*9+cloud*4)
            h = brush*(grain*1.7+noise*.28)
            tone = brush*(grain*.023+cloud*.009)
            if tag in ("chrome","steel"):
                # A broad dark return and a narrow polished shoulder wrap the tube.
                t = v+.285*np.sin(2.9*u+.4)+.058*np.sin(8*u-.6)
                dark = np.exp(-((t-.16)/.28)**4)
                shoulder = np.exp(-((t+.29)/.11)**2)
                foot = np.clip((v-.55)/.46,0,1)**1.5
                grip = .5+.5*np.cos(3.8*u+.7*v)
                sweep = .5+.5*np.cos(5.2*u+2.7*v+.48*np.sin(3*v))
                tone += -.20-.43*dark+.33*shoulder-.13*foot+.25*(sweep-.42)
                rough = rough+26*dark+24*grip+31*foot-17*shoulder
                occlusion = 1-.27*foot-.10*dark
                h += (grain*.8+cloud*.30)*(1+grip)+2.2*shoulder
        elif tag=="rubber":
            tone = noise*.018 + cloud*.012
            h = noise*1.0
        elif tag=="grip":
            inside = np.exp(-((r-.901)/.014)**2)
            pitch = theta*23
            lace = inside*(.5+.5*np.cos(pitch*2))**2
            joint = np.exp(-(np.sin(theta*7)*r/.047)**2)
            tone = noise*.025 - joint*.24 - inside*.36 + lace*1.6
            h = noise*1.7 - joint*6 - inside*9 + lace*15
        elif tag=="intake":
            # Stamped shield over a recessed black honeycomb.
            yy = y/17.5
            xx = x/20 - .5*(np.floor(yy)%2)
            a,b = np.abs(xx-np.round(xx)), np.abs(yy%1-.5)
            wall = np.clip((np.maximum(a, a*.50+b*.76)-.365)*17,0,1)
            slat = np.clip((np.cos(y*np.pi/20)-.79)*6,0,1)
            structure = np.maximum(wall*.64,slat)
            tone = -.69+.97*structure + noise*.014
            h = -20+31*structure
            occlusion = .56+.44*structure
            rough = 150-58*structure
        elif tag in ("red","green","lamp"):
            rib = (.5+.5*np.cos(v*np.pi*11))**1.3
            prism = np.abs(np.sin((x+y)*.25)*np.sin((x-y)*.25))
            rim = np.clip((np.maximum(np.abs(u),np.abs(v))-.79)*7,0,1)
            tone = -.28+.28*rib+.20*prism-.19*rim
            rough = 36+22*rim+7*prism
            h = 6*rib+2.7*prism-6*rim
        elif tag=="throttle":
            grooves = np.exp(-(np.sin(x*.16)/.32)**2)
            cuff = np.clip((np.abs(u)-.64)*8,0,1)
            tone = -.28*grooves*cuff+noise*.013+cloud*.012
            h = -8*grooves*cuff+noise*.65
        else:
            art = artwork()["dial" if tag=="gauge" else "plotter"]
            face = np.asarray(art.resize((236,236),Image.Resampling.LANCZOS))
            rgb[where] = np.pad(face,((10,10),(10,10),(0,0)),mode="edge")
            if tag=="gauge":
                h = 3.8*np.exp(-((r-.89)/.025)**2) + 1.5*np.clip(1-r*r,0,1)
                metal = np.where((r>.874)&(r<.911),255,0)
            else:
                edge = np.maximum(np.abs(u),np.abs(v))
                h = np.clip((edge-.89)*70,0,6)
                rough = 31+106*np.clip((edge-.90)*28,0,1)
        if tag not in ("gauge","chart"):
            rgb[where] = np.rint(np.array(colour)*(1+tone[...,None])).clip(0,255).astype(np.uint8)
        if tag=="grip":
            index = np.clip((.076-np.abs(u))*95,0,1)*np.clip((-v-.73)*30,0,1)
            stitched = np.exp(-((np.abs(u)-.057)/.010)**2)*(.5+.5*np.cos(v*150))**2
            binding = np.array([174,145,98])*(1-.35*stitched[...,None])
            rgb[where] = np.rint(rgb[where]*(1-index[...,None])+binding*index[...,None])
            h += index*(4-5*stitched)
        height[where] += h
        packed[where][...,0] = np.rint(occlusion*255).astype(np.uint8)
        packed[where][...,1] = np.rint(rough).clip(0,255).astype(np.uint8)
        packed[where][...,2] = metal
    # The outside four pixels are beyond the box projection, including its filter margin.
    for a,val in ((rgb,(50,55,58)),(packed,(255,150,0)),(height,128)):
        a[:4] = a[-4:] = val
        a[:,:4] = a[:,-4:] = val
    return rgb, height, packed, np.zeros_like(rgb)
