"""Brushes for replacement colour and time of appearance."""
from copy import copy
from functools import lru_cache

import numpy as np

from paint import byte, ramp


def mix(a, b, t):
    lo, hi = np.asarray(a, np.float32), np.asarray(b, np.float32)
    return lo + (hi-lo)*np.clip(t, 0, 1)[..., None]


class Marks:
    def __init__(self, pos, grain, flake, cloud, fine, ground=None):
        self.ground = ground
        self.pos = pos
        self.grain, self.flake, self.cloud, self.fine = grain, flake, cloud, fine
        self.i = np.arange(len(pos))
        self.hurt = np.zeros((len(pos), 4), np.uint8)
        self.decay = np.zeros_like(self.hurt)

    @property
    def xyz(self):
        return self.pos.T

    def take(self, mask):
        small = copy(self)
        for name in ("pos", "grain", "flake", "cloud", "fine", "i"):
            setattr(small, name, getattr(self, name)[mask])
        if self.ground is not None:
            small.ground = self.ground[mask]
        return small

    def put(self, layer, mask, when, color):
        index = self.i[mask]
        t = np.asarray(when)
        c = np.asarray(color)
        layer[index, :3] = byte(c[mask] if c.ndim == 2 else c)
        layer[index, 3] = byte(255 - 85*np.clip(t[mask] if t.ndim else t, 0, 2.96))

    def hit(self, mask, when, color):
        self.put(self.hurt, mask, when, color)

    def age(self, mask, when, color):
        self.put(self.decay, mask, when, color)


def score(b, u, v, span, width, bend, start, swatches):
    """A tapered drag with a transferred rim, a furrow and exposed threads."""
    t = u/span
    reach = np.clip(1-t*t, 0, 1)
    track = v - bend*(.7*t*t + .28*np.sin(3.1*t)) - width*(.25*b.flake+.14*b.fine)
    half = width*reach*(.42+.48*b.grain+.37*b.flake)
    furrow = np.abs(track)/np.maximum(.001, half)
    time = start + .42*t*t + .22*(1-b.grain)
    stripe = (furrow<1) & (np.abs(t)<1)
    brush = .5+.5*np.sin(460*track+4*b.grain+.7*np.sin(u*13))
    b.hit(stripe, time, mix(*swatches[:2], .52*b.flake+.34*brush))
    b.hit(stripe & (track>half*.49), time+.10, mix(swatches[1],swatches[2], .32+.62*b.grain))
    split = stripe & (furrow<.38) & (b.flake+.32*brush>.73)
    b.hit(split, time+.54, mix(swatches[0],swatches[1],b.fine*.42))


@lru_cache(None)
def fracture_paths(seed, n):
    rng = np.random.default_rng(seed)
    angles = (np.arange(n)+rng.uniform(-.28,.28,n))*2*np.pi/n
    bands = [np.zeros((n,2))]
    for radius in (.25,.58,1.):
        a = angles+rng.uniform(-.12,.12,n)
        rr = radius*rng.uniform(.78,1.19,n)
        bands.append(np.stack((rr*np.cos(a),rr*np.sin(a)),1))
    paths = []
    for j in range(n):
        for k in range(1,4):
            end = bands[k][j]
            paths.append((bands[k-1][j],end,k*.12))
            if k<3 and rng.random()<.72:
                paths.append((end,bands[k][(j+1)%n],.66+k*.09))
            if k==3 and j%3==0:
                a = bands[k-1][j]
                mid = a+.49*(end-a)
                paths.append((mid,mid+.49*(end-a)+[.13,-.09],.64))
    return paths


def fracture(b, u, v, width, height, seed, start, glass=False, decay=False, hairline=None):
    """Broken facets share vertices with their radial cracks."""
    reach = (np.abs(u)<width*1.29)&(np.abs(v)<height*1.29)
    p = b.take(reach)
    if not len(p.i):
        return
    u, v = u[reach], v[reach]
    distance = np.full(u.shape,10,np.float32)
    delay = np.zeros_like(distance)
    scale = np.array([width,height])
    acrylic = glass and hairline is None and p.ground is not None
    radial = np.hypot(u/width,v/height)
    if acrylic:
        u = u+.006*np.sin(v*48+seed)+.004*(p.flake-.5)
        v = v+.004*np.sin(u*36-seed)
    for a,c,late in fracture_paths(seed,11 if glass else 8):
        x,y = a*scale
        dx,dy = (c-a)*scale
        t = np.clip(((u-x)*dx+(v-y)*dy)/(dx*dx+dy*dy),0,1)
        dist = np.hypot(u-x-t*dx,v-y-t*dy)
        if acrylic:
            dist /= np.maximum(.17,(1-.53*np.minimum(radial,1))*(.32+.95*p.flake+.25*p.fine))
        delay = np.where(dist<distance,late,delay)
        distance = np.minimum(distance,dist)
    line = (.0075 if glass else .0065) if hairline is None else hairline
    thickness = line*(.88+.45*p.grain)
    when = start+delay+.15*p.flake
    deposit = p.age if decay else p.hit
    if acrylic:
        crack = np.exp(-1.35*(distance/(line*1.12))**2)
        theta=np.arctan2(v/height,u/width)
        splinters=.5+.5*np.cos(13*theta+7*p.flake)
        radius=(.10+.12*splinters+.085*np.cos(3*theta+seed)**2)*(.72+.52*p.grain)
        frost=np.exp(-2.4*(radial/radius)**2)
        tone=np.clip((.41+.48*p.flake)*crack+frost*(.43+.48*p.fine),0,.96)
        deposit(tone>.045,when,mix(p.ground,(201,213,204),tone))
    elif glass:
        deposit(distance<thickness*1.65,when+.2,mix((45,72,76),(101,130,128),p.flake))
        deposit(distance<thickness*.87,when,mix((123,158,156),(207,217,202),p.grain))
    else:
        deposit(distance<thickness,when,mix((74,65,53),(167,148,113),.22+.66*p.flake))


def breach(b,u,v,width,height,seed,angle=0,delay=0):
    """A crushed, jagged laminate edge steps down past fibre and broken backing."""
    u,v = u+angle*v,v-angle*u
    du,dv = u/width,v/height
    a = np.arctan2(dv,du)
    # A few large angular breaks hold their shape at a distance.
    phase = seed*.713
    corner = .12*np.cos(3*a+phase)+.087*np.sin(5*a-phase)+.058*np.cos(9*a+1.3)
    shape = np.hypot(du,dv)/(1+corner)+.064*(b.flake-.5)+.046*(b.grain-.5)
    fracture(b,u,v,width*1.77,height*1.96,seed,.18)
    tooth = .5+.5*np.sin(27*a+phase+2.6*b.flake)
    mat = .5+.5*np.cos(320*v+73*u+3*b.flake)
    # The topcoat buckles in broad plates. Only the outer millimetres are loose fibre.
    drag = ramp(1.32,1.01,shape)*(.33+.23*np.sin(3*a+phase)+.37*b.flake)
    scuff = (drag>.045)&(shape>.96)
    substrate = b.ground if b.ground is not None else (82,86,80)
    b.hit(scuff,.31+.34*b.flake,mix(substrate,(140,138,122),drag))
    flake = (shape<1.09+.075*tooth+.035*np.sin(4*a))&(shape>.89)&(.43*tooth+.44*b.flake+.24*np.sin(3*a+phase)>.28)
    b.hit(flake,.73+.62*b.flake,mix((145,132,104),(242,234,204),.49+.27*mat+.20*b.fine))
    b.hit(shape<1.035,1.13+.33*b.flake,mix((116,86,58),(217,186,131),.25+.37*mat+.25*b.grain))
    rim = .88+.062*np.sin(a+phase)+.022*tooth
    inside = shape<rim
    ledge = ramp(.48,.99,shape)*(.28+.70*ramp(-.65,.35,-dv))
    b.hit(inside,2.02+.10*ramp(-.25,.8,dv)-delay,mix((5,7,8),(53,34,24),ledge))
    tongue = inside&(shape>rim-.105)&(tooth>.61)
    b.hit(tongue,1.59+.26*b.grain,mix((88,60,39),(173,139,89),.49*mat+.34*b.flake))
