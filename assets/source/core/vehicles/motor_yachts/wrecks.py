"""Paint the two stationary wrecks on the vessel's original surfaces."""
import argparse
from dataclasses import dataclass
import json
import sys

sys.dont_write_bytecode = True
import numpy as np
from PIL import Image
from scipy import ndimage
from glazing import cells, frame_shards, triangle

from paint import Fields, HERE, IDENTITY, OWN, TAU, Vessel, as_byte, band, noise, read_surface, roof_graphics, save_png, smooth, teak_fields, unit
from wear import Fittings, Patch, fracture_lines, shell_spots, strike

FORMS = HERE.parent/"marine/forms.json"


def nearest_shell(triangles, point):
    a, b, c = triangles.transpose(1, 0, 2)
    normals = np.cross(b-a, c-a)
    normals /= np.maximum(1e-9, np.linalg.norm(normals, axis=1, keepdims=True))
    projected = point - ((point-a)*normals).sum(1)[:, None]*normals
    inside = np.linalg.norm(normals, axis=1) > .9
    candidates = []
    for root, end in ((a, b), (b, c), (c, a)):
        edge = end-root
        t = ((point-root)*edge).sum(1) / np.maximum(1e-9, (edge*edge).sum(1))
        candidates.append(root + unit(t)[:, None]*edge)
        inside &= (np.cross(edge, projected-root)*normals).sum(1) >= 0
    candidates.append(np.where(inside[:, None], projected, np.inf))
    distance = np.linalg.norm(np.asarray(candidates)-point, axis=2)
    k, face = np.unravel_index(distance.argmin(), distance.shape)
    return candidates[k][face], normals[face]


@dataclass
class Dent:
    point: np.ndarray
    radius: float
    depth: float
    surface: np.ndarray
    along: np.ndarray
    across: np.ndarray

    @classmethod
    def on_shell(cls, spec, triangles):
        point, radius, depth = spec
        point = np.asarray(point, dtype="f")
        centre, normal = nearest_shell(triangles, point)
        axis = np.eye(3)[2 if abs(normal[2]) < .9 else 0]
        along = axis - normal * (axis @ normal)
        along /= np.linalg.norm(along)
        across = np.cross(along, normal)
        if across[1] < 0:
            across *= -1
        return cls(point, radius, depth, centre, along.astype("f"), across.astype("f"))


class Lie:
    def __init__(self, boat, name, spec, triangles, lowest_vertices):
        self.name = name
        self.sunk = name == "sunk"
        self.burnt = spec.get("burnt", False)
        self.slump = spec.get("slump", (0, 0))
        heel, trim = np.deg2rad((spec["heel"], spec["trim"]))
        self.ch, self.sh = np.cos(heel), np.sin(heel)
        self.ct, self.st = np.cos(trim), np.sin(trim)
        self.dents = [Dent.on_shell(d, triangles) for d in spec["dents"]]
        self.folder = HERE.parent / (boat.key+"_"+name) / "tex"
        main, draft = boat.lines["main"], boat.lines["draft"]
        # A damaged form's water stands where forms.json says, in draughts and shares of freeboard, else 1.25 draughts.
        line = spec.get("waterline", {"draught": 1.25})
        afloat = line["draught"]*draft + line.get("freeboard", 0)*(main+.28-draft)
        if boat.key=="belvedere":
            self.water=self.transform(lowest_vertices)[1].min()+main if self.sunk else afloat
        else:
            self.water=max(1.2,(main+.28)*.9) if self.sunk else afloat

    def transform(self, points):
        x, y, z = points.T
        floor, share = self.slump
        y = y - np.maximum(y-floor, 0)*share
        hx, hy = x*self.ch + y*self.sh, y*self.ch - x*self.sh
        return hx, hy*self.ct-z*self.st, hy*self.st+z*self.ct

    def up(self, normals, y):
        nx, ny, nz = normals.T
        floor, share = self.slump
        ny = ny / np.where(y > floor, 1-share, 1)
        return ((ny*self.ch - nx*self.sh)*self.ct - nz*self.st) / np.maximum(.01, np.sqrt(nx*nx+ny*ny+nz*nz))


class Finish:
    def __init__(self, base, packed):
        self.rgb = base[:, :3].astype("f")
        self.packed = packed.astype("f")
        self.original = np.ones(len(base), "f")

    def coat(self, amount, colour, roughness, metalness=0, grain=0, at=slice(None)):
        amount = unit(amount)
        ink = np.asarray(colour, dtype="f") + np.asarray(grain, dtype="f")[..., None]
        self.rgb[at] += (ink-self.rgb[at])*amount[..., None]
        self.packed[at, 1] += (roughness-self.packed[at, 1])*amount
        self.packed[at, 2] += (metalness-self.packed[at, 2])*amount
        self.original[at] *= 1-amount

    def maps(self, src, regions, keep):
        # Leave only intact enamel or cloth to take the vessel's palette colour.
        mask = regions.copy()
        mask[~keep] = 0
        dyed = mask.any(axis=1)
        self.rgb[dyed] = self.rgb[dyed].mean(1, keepdims=True)
        return np.column_stack((as_byte(self.rgb), src[:, 3])), as_byte(self.packed), mask


class Grain:
    def __init__(self, f):
        self.grit = noise(f.P, .013, 411)
        self.flake = noise(f.P, .070, 519)
        self.cloud = noise(f.P, .46, 638)
        self.drift = noise(f.P, 1.46, 227)
        self.texture = (self.grit, self.flake, self.cloud)


def impact(f, lie, finish, g, hurt):
    shell = f.on("chine-built hull", "folded sheer coaming")
    for number, dent in enumerate(lie.dents):
        dist = np.linalg.norm(f.P-dent.point, axis=1)
        reach = dist/dent.radius
        side = f.x*dent.point[0] >= 0
        near = (reach < 1.65) & side
        if not near.any():
            continue
        weight = smooth((1.58-reach)/.63) * near * (~f.glass)
        # Take the pre-existing grazes and fans of crazing only at this collision.
        early = smooth((hurt[:, 3].astype("f")-89)/90) * weight
        finish.coat(early*.9, hurt[:, :3], 165)
        choose = near & shell
        if not choose.any() or np.linalg.norm(dent.point-dent.surface) >= dent.radius:
            continue
        marks = np.zeros((len(f.P), 4), "uint8")
        p = Patch(f, choose, (marks, marks), g.texture)
        delta = p.P-dent.surface
        along = (delta*dent.along).sum(1)
        across = (delta*dent.across).sum(1)
        opening = reach[p.i] < 1
        if f.boat.key=="sovereign" and not lie.sunk:
            # A long beam-on squeeze opens the first fold; the second catches the rubbing strip.
            if number==1:
                fade=smooth((1.2-reach[p.i])/.45)
                fold=across-.072*along-.036*np.sin(3*along)-.017*g.flake[p.i]
                run=fade*smooth((1-np.abs(along)/(dent.radius*.88))/.34)
                finish.coat(run*band(fold,.11,f.step[p.i]), (68,71,66), 138, grain=p.grit*14,at=p.i)
                finish.coat(run*band(fold+.087,.025,f.step[p.i]), (194,173,131),164,grain=p.grit*21,at=p.i)
                continue
        rise = across - .17*along - .048*np.sin(3*along)
        strike(p, along, rise, dent.radius*.68, dent.depth*1.85, 37+17*number, opening)
        visible = marks[:, 3] > 0
        splinters = marks[:, 0].astype("f")*.35 + 94
        fade = smooth((1.018-reach)/.16)
        ink = marks[:, :3].astype("f")
        if lie.sunk:
            grainy = unit((ink[:, 0]-50)/80)
            ink *= (1-.19*grainy)[:, None]
            ink[:, 1] += 4*grainy
        finish.coat(visible*fade, ink, splinters)
        dark = visible & (marks[:, 0] < 58)
        finish.packed[dark, 0] *= .57
        # The contact rakes up out of the water and leaves a pale lip above the deep fold.
        z = f.z-dent.surface[2]
        y = f.y-dent.surface[1]
        fingers = np.zeros_like(y)
        for j, slope in enumerate((-.42, -.65, -.77)):
            offset = y + slope*z - dent.radius*(.19+j*.105) - .027*g.flake
            fingers = np.maximum(fingers, band(offset, .046-.009*j, f.step))
        feather = smooth((1.48-reach)/.48)*shell*side*smooth((y-.11)/.28)
        finish.coat(fingers*feather*(.66+.31*g.flake), (174,155,118), 168, grain=g.grit*20)
        if abs(dent.point[0]) > .1:
            run = (z-.08*dent.radius)/(.89*dent.radius)
            shoulder = y-dent.radius*(.54+.24*run+.049*np.sin(3.2*run))-.034*g.flake
            width = .023+.11*unit(1-run*run)
            rip = band(shoulder, width, f.step)
            rake = np.sin(202*shoulder+3.1*g.flake+4.6*run)
            spread = shell*side*smooth((1.46-reach)/.26)*smooth((1-np.abs(run))/.28)
            finish.coat(spread*rip*unit(.62+.58*rake+.32*g.flake), (118,112,94), 161, grain=g.grit*17)
            edge = band(shoulder+.8*width, .014+.012*unit(1-run*run), f.step)
            finish.coat(spread*edge, (196,179,142), 170, grain=g.flake*18)



def marine_growth(f, lie, finish, g, height, up):
    silted = lie.sunk
    tide = height - lie.water - .036*g.cloud - .013*g.flake
    submerged = smooth((.11-tide)/.22)
    wet = smooth((.22-tide)/.22)
    below = smooth((.25-tide)/.77)
    flank = 1-np.abs(up)
    open_water = ~f.where("clear")
    wet *= open_water
    finish.packed[:, 1] += wet*(np.minimum(finish.packed[:, 1], 63)-finish.packed[:, 1])*.51
    pattern = unit(.49+.48*g.drift+.41*g.cloud+.20*g.flake)
    wash = smooth((.16-tide)/.24)*smooth((tide+.29)/.20)
    blade = .5+.5*np.cos(86*f.z+35*f.x+4.4*np.sin(9*height+f.z)+2*g.flake)
    if f.boat.key!="belvedere":
        # Each ribbon hangs from a place on the tidemark as the hull lies.
        xh,_,zh=lie.transform(f.P)
        deep=np.maximum(-tide,0)
        flow=zh+.34*xh+.085*deep+.034*np.sin(2.3*deep+.47*zh)
        stream=noise(np.column_stack((flow,xh*.28,deep*.077)),.17,674)
        fine=noise(np.column_stack((flow+.017*g.flake,xh*.20,deep*.14)),.048,829)
        length=.15+.69*smooth(.51+.67*stream)
        blade=smooth(.45+.70*fine)*smooth((length-deep)/.21)
        pattern=unit(.52+.35*stream+.22*fine+.07*g.flake)
    pigment = g.grit*13 + g.flake*10 + 6*blade
    if not silted:
        finish.coat(wash*flank*(.32+.51*pattern), (78,86,62), 107, grain=pigment)
        finish.coat(submerged*pattern*(.13+.22*below), (77,80,60), 117, grain=pigment)
        rim = band(tide-.095, .020+.011*g.cloud, f.step)
        finish.coat(rim*(.35+.43*pattern), (173,169,133), 174, grain=g.grit*15)
        return
    finish.coat(submerged*(.61+.33*pattern), (76,80,59), 139, grain=pigment)
    sediment = below*unit(.16+.81*unit(up)+.44*(1-f.AO)+.32*g.cloud)
    finish.coat(sediment, (128,115,89), 182, grain=g.flake*13+g.grit*14)
    weed = submerged*flank*unit(.27+.67*pattern+.36*g.flake)*(.39+.61*blade)
    finish.coat(weed, (52,71,47), 103, grain=g.flake*17)
    anchor = f.z+.27*f.x
    depth = height+.62*np.abs(f.x)
    for scale, seed in ((.16, 7), (.088, 46)):
        r, group = shell_spots(anchor, depth, scale, seed)
        colony = below*smooth((pattern+.48*group-.61)/.35)*unit(.68+.63*g.cloud+.26*g.flake)
        finish.coat(colony*smooth((1.34-r)/.54), (112,109,81), 169, grain=group*15+g.grit*16)
        finish.coat(colony*band(r-.73, .22, .29), (171,161,123), 179, grain=g.grit*17)
        finish.coat(colony*smooth((.51-r)/.29), (57,61,45), 161)
    rim = band(tide-.075, .052, np.maximum(.019, f.step))
    finish.coat(rim*(.48+.43*pattern), (150,145,107), 161, grain=g.flake*16)


def frost(finish, at, u, v, scale_u, scale_v, grit, flake, seed):
    a, b = u/scale_u, v/scale_v
    radius = np.hypot(a, b)
    keep = radius < 1.39
    if not keep.any():
        return
    at = at[keep]
    a, b, r, grit, flake = (x[keep] for x in (a, b, radius, grit, flake))
    local_u, local_v = u[keep], v[keep]
    cracked, facets = cells(local_u+.008*flake, local_v, .035, seed)
    broad = smooth((.86-r+.10*flake)/.62)
    outer = smooth((1.19-r+.07*flake)/.50)
    milky = broad*(.31+.50*broad)*(.72+.30*facets)
    finish.coat(milky, (195,214,207), 122, grain=grit*15, at=at)
    facets_edge = smooth((.16-cracked)/.12)
    finish.coat(broad*facets_edge*(.39+.47*broad), (232,236,219), 163, grain=grit*11, at=at)
    spread = (.013+.031*smooth((.73-r)/.60))*(.84+.29*facets+.21*flake)
    rays = fracture_lines(a, b, seed, spread)
    bevel = fracture_lines(a+.009, b-.008, seed, spread*.70)
    finish.coat(bevel*outer, (40,62,63), 55, at=at)
    finish.coat(rays*outer*(.44+.38*broad), (185,207,201), 90, grain=grit*16, at=at)
    frit = smooth((.56-r+.07*flake)/.42)*smooth((.52-cracked)/.31)
    finish.coat(frit*(.47+.38*facets), (208,220,211), 144, grain=grit*22, at=at)
    core = smooth((.20-r+.035*flake)/.12)
    finish.coat(core, (223,232,220), 173, grain=(facets-.5)*38+grit*11, at=at)


def broken_panes(f, finish, selected, distance, g):
    at = np.flatnonzero(selected)
    if not at.size:
        return
    shade = 12+14*smooth(distance/.15)+6*g.cloud[at]+3*g.flake[at]
    shade += 5*smooth((f.local[at,1]+.18)/.34)
    dark = np.column_stack((shade*.78, shade*.89, shade*.94))
    finish.coat(np.ones_like(shade), dark, 215, at=at)
    for part in np.unique(f.part[at]):
        sub = at[f.part[at]==part]
        centre, basis, pieces = frame_shards(f.boat, int(part))
        uv = f.P[sub]-centre
        u, v = ((uv*axis).sum(1) for axis in basis)
        step = np.maximum(.003, f.step[sub])
        for left, mid, right, tip, tone in pieces:
            shard = np.maximum(triangle(u,v,left,mid,tip,step), triangle(u,v,mid,right,tip,step))
            if not shard.any():
                continue
            finish.coat(shard, (47+24*tone, 66+27*tone, 68+25*tone), 53+39*tone,
                        grain=g.flake[sub]*8+g.cloud[sub]*6, at=sub)
            # Only the snapped edges catch a glint; the root stays in the seal.
            for a,b in ((left,tip), (tip,right)):
                dx,dy = b-a
                t = unit(((u-a[0])*dx+(v-a[1])*dy)/max(.0001, dx*dx+dy*dy))
                line = np.hypot(u-a[0]-dx*t, v-a[1]-dy*t)
                lip = band(line, .004+.005*tone, step)*shard
                finish.coat(lip*.84, (159,180,165), 62, grain=g.grit[sub]*7, at=sub)


def windows(f, lie, finish, g, height):
    glass = f.where("glass")
    if not glass.any():
        return
    idx = np.flatnonzero(glass)
    k = f.part[idx]
    front = np.abs(f.N[idx,2]) > np.abs(f.N[idx,0])
    wind = f.on("windscreen brow and sill", "curved windscreen")[idx]
    u = np.where(front, f.local[idx,0], f.local[idx,2])
    v = f.local[idx,1]
    hu = np.maximum(.13, np.where(front, f.half[idx,0], f.half[idx,2]))
    hv = np.maximum(.095, f.half[idx,1])
    grit, flake, cloud = g.grit[idx], g.flake[idx], g.cloud[idx]
    distance = f.glass_edge()[idx]
    lines = f.boat.lines
    # Rain and sea spray dry at the seals. The broad field stays transparent in appearance.
    r, cell = shell_spots(u+.32*f.x[idx], f.y[idx], .091, 72)
    haze = unit((.11-distance)*3.3+.28*cloud+.15*flake)
    salt = band(r-.78, .15, .32)*(.18+.36*cell)
    if not lie.sunk:
        finish.coat(.10*haze+.34*haze*haze+.26*salt, (162,178,169), 107, grain=grit*14, at=idx)
        hit = lie.dents[0].point
        same_side = hit[0]*f.x[idx] > 0
        direction = 1 if hit[2]>=0 else -1
        forward = direction*f.mid[idx,2]/(lines["length"]*.5)
        cabin = f.on("flush cabin light")[idx] & same_side & (forward > .37)
        saloon = f.on("saloon glazing")[idx] & same_side & (forward > .29)
        if f.boat.key=="sovereign":
            # The quay pressed on the port beam. Glazing directly over that fold crazes at its sill.
            cabin=f.on("flush cabin light")[idx] & same_side & (np.abs(f.z[idx]-hit[2])<1.65)
            side=f.on("saloon glazing")[idx] & same_side & (f.mid[idx,1]<lines["main"]+2.1)
            side &= (np.abs(f.z[idx]-hit[2])<1.56)
            if side.any():
                frost(finish, idx[side], (f.z[idx]-hit[2])[side],
                      (f.y[idx]-lines["main"]-.69)[side],1.09,.51,grit[side],flake[side],494)
            saloon &= False
            wind &= False
        for target, su, sv, seed in ((cabin, .73, .36, 231), (saloon, .83, .68, 411)):
            if target.any():
                frost(finish, idx[target], (u-.24*hu)[target], (v+.17*hv)[target],
                      su, sv, grit[target], flake[target], seed)
        shield=f.on("helm side deflector")[idx] & same_side
        if shield.any():
            frost(finish,idx[shield],u[shield],(v+.08*hv)[shield],.29,.24,grit[shield],flake[shield],187)
        if wind.any() and hit[2]>0:
            frost(finish, idx[wind], (f.x[idx]-np.sign(hit[0])*lines["beam"]*.195)[wind],
                  (f.y[idx]-lines["main"]-1.01)[wind], 1.07, .82, grit[wind], flake[wind], 377)
        return
    if not lie.burnt:
        # Swamped safety glass holds in the seal. Shell abrasion and salt cloud the lower lights.
        damp=smooth((lie.water+.18-height[idx])/.45)
        finish.coat(.18+.47*damp+.24*haze,(121,143,129),105,grain=13*flake+8*cloud,at=idx)
        catch=f.on("helm side deflector","flush cabin light")[idx] & (f.x[idx]>0) & (f.mid[idx,2]>0)
        if catch.any():
            frost(finish,idx[catch],(u-.07*hu)[catch],(v+.08*hv)[catch],.40,.27,
                  grit[catch],flake[catch],137)
        return
    inside = ~f.on("flush cabin light")[idx]
    lost = inside | (k%3!=1)
    lost_mask = np.zeros(len(f.P), bool)
    lost_mask[idx[lost]] = True
    broken_panes(f, finish, lost_mask, distance[lost], g)
    remaining = ~lost
    if remaining.any():
        frost(finish, idx[remaining], (u+.26*hu)[remaining], (v-.04*hv)[remaining],
              .94, .48, grit[remaining], flake[remaining], 291)
    # Water veils the submerged part of the glazing without lifting the dark centre above it.
    under = smooth((lie.water+.10-height[idx])/.25)
    finish.coat(under*(.39+.36*haze), (78,91,72), 113, grain=flake*12, at=idx)


def fire(f, lie, finish, g, height, up):
    lines = f.boat.lines
    longitudinal = f.z/(lines["length"]*.5)
    beamwise = f.x/(lines["beam"]*.5)
    above_deck = smooth((f.y-lines["main"]+.44)/1.03)
    seat = np.exp(-((longitudinal+.33)/.48)**2-((beamwise+.56)/1.23)**2)
    plume = .5+.5*np.sin(6.8*longitudinal+1.7*beamwise+1.5*g.drift)
    if f.boat.key!="belvedere":
        # Grey smoke rises in narrowing filaments from the aft fire. Its height is measured after slump.
        px,_,pz=lie.transform(f.P)
        rise=np.maximum(height-lie.water,0)
        shift=pz+.19*rise+.055*np.sin(1.3*rise+.5*px)
        stalk=noise(np.column_stack((shift,.38*px,.082*rise)),.30,751)
        vein=noise(np.column_stack((shift,.23*px,.09*rise)),.11,752)
        aft=-.46 if f.boat.key=="sovereign" else -.53
        seat=np.exp(-((longitudinal-aft+.028*rise)/.37)**2-((beamwise+.46)/1.19)**2)
        plume=unit(.18+.54*seat+.34*stalk+.16*vein+.10*unit(rise))
    surface = (~f.glass) & (~f.where("stainless", "bronze")) & (~f.on("windscreen post"))
    flood = smooth((height-lie.water+.43)/.96)
    heat = unit(.12+.22*flood+.52*above_deck+.34*seat+.12*g.drift+.07*g.cloud)
    # Fire climbed out of the aft quarter and washed the soffits before crossing the roof.
    sweep = (.25+.48*above_deck+.28*seat+.18*plume+.15*g.cloud+.10*g.flake)
    exposed = surface * flood
    finish.coat(exposed*smooth((heat-.12)/.44), (105,92,75), 184,
                grain=15*g.drift+13*g.cloud+10*g.flake+7*g.grit)
    mat = smooth((sweep+.12*up-.54)/.48)
    warp = np.sin(92*(f.x+.48*f.z)+38*f.y+3.2*g.flake)
    weft = np.sin(128*f.y+95*f.x-61*f.z+1.7*g.cloud)
    strands = (warp+weft)*4 / (1+24*f.step)
    finish.coat(exposed*mat, (143,131,108), 201, grain=16*g.cloud+10*g.flake+g.grit*13+strands)
    soot = smooth((.54*heat+.39*seat+.43*plume+.16*(1-up)+.32*g.drift+.16*g.cloud-.54)/.43)
    if f.boat.key!="belvedere":
        soot=smooth((.46*heat+.48*seat+.58*plume+.12*(1-up)+.05*g.cloud-.48)/.58)
    finish.coat(exposed*soot, (46,44,40), 214, grain=8*g.cloud+6*g.flake+5*g.grit)
    ridges = f.on("shadow gap", "glazing brow", "windscreen brow", "swept hardtop pier", "moulded saloon frame")
    traps = (.55*(1-f.AO)+.17*(1-up)+.23*seat+.15*ridges)*heat
    finish.coat(exposed*unit(traps), (41,41,38), 197, grain=g.flake*8)
    wash = smooth((.48*g.drift+.27*g.cloud+.28*plume+.18*unit(up)+.21*(1-seat)-.36)/.42)
    if f.boat.key!="belvedere":
        wash=smooth((.32-.41*plume+.32*unit(up)+.25*stalk+.07*g.flake)/.64)
    spent = exposed*above_deck*(f.gelcoat|f.on("cambered coachroof"))*wash*(.67-.28*soot)
    finish.coat(spent, (153,144,126), 199, grain=15*g.cloud+16*g.flake+strands+8*g.grit)
    # Blisters have a raised, bleached edge. Where the film has gone the mat shows crossed strands.
    skin = exposed*(heat>.42)
    take = np.flatnonzero(skin>.12)
    if take.size:
        horizontal = np.abs(up[take])>.62
        a = np.where(horizontal, f.x[take], f.z[take]+.42*f.x[take])
        b = np.where(horizontal, f.z[take], f.y[take])
        cellular, facet = cells(a+.013*g.flake[take], b, .14, 451)
        glaze = skin[take]*unit(.29+.54*g.cloud[take]+.47*facet)
        seams = smooth((.083-cellular)/.073)
        finish.coat(glaze*seams*.77, (47,43,37), 206, at=take)
        chalk = band(cellular-.12, .025, .035)*glaze
        finish.coat(chalk*.47, (161,145,117), 205, grain=g.grit[take]*14, at=take)
        crater, seed = shell_spots(a+.14, b-.11, .105, 23)
        bubbles = glaze*unit(.24+.72*seed)
        finish.coat(bubbles*smooth((.83-crater)/.38), (55,49,40), 193, at=take)
        finish.coat(bubbles*band(crater-.90, .16, .27), (155,136,104), 197, at=take)
    # The recessed roof insert burns through to its graphite well and the narrow tracks.
    roof = f.on("cambered coachroof") & f.where("graphite")
    if roof.any():
        for graphic in roof_graphics(f):
            if graphic.name == "roof canvas":
                i = graphic.indices
                finish.coat(graphic.coverage*.89, (52,51,46), 205,
                            grain=15*g.drift[i]+10*g.cloud[i]+8*g.flake[i], at=i)
            elif graphic.name in ("roof track", "roof cover bows"):
                i = graphic.indices
                remnant = unit(.24+.62*g.drift[i]+.43*g.cloud[i])
                finish.coat(graphic.coverage*remnant, (91,88,78), 146, 98, grain=g.grit[i]*11, at=i)
    metal = f.where("stainless", "bronze") | f.on("windscreen post")
    hot = metal*flood*heat
    temper = .5+.5*np.sin(1.1*f.z+3.7*f.y+3*g.cloud)
    finish.coat(hot*(.73+.18*soot), (68,74,87), 122, 209, grain=14*g.cloud+8*g.grit)
    finish.coat(hot*temper*.60, (115,91,64), 133, 186, grain=7*g.flake)
    finish.coat(hot*(.13+.72*soot)*(.57+.43*(1-f.AO)), (46,46,41), 185, 54, grain=8*g.grit)
    screens = f.where("chart", "instruments", "keyboard", "red", "green")
    finish.coat(screens.astype("f"), (32,37,36), 157, grain=9*g.flake+8*g.cloud)
    # A little baked lettering and the protected flank of the cove survive the fire.
    guarded = smooth((.33-heat)/.32)*smooth((.5*g.cloud+.5*g.drift+.10)/.51)
    return guarded


def salt_and_fabric(f, lie, finish, g, fittings, height, up, decay):
    vertical = 1-np.abs(up)
    underside = 1-f.AO
    dry = smooth((height-lie.water+.03)/.37)
    # A rain-washed middle and a dirty fringe give the long white panels some quiet space.
    deposit = unit(.12+.43*underside+.31*g.drift+.18*g.cloud)*dry
    sun = unit(up)*f.AO
    if not lie.sunk:
        finish.coat(f.gelcoat*deposit*(.12+.19*sun), (189,184,158), 149, grain=g.grit*9)
        finish.coat(f.gelcoat*sun*.07, (220,218,205), 116)
        cloth = f.cloth|f.where("leather")
        damp = unit(.31+.74*underside+.40*g.cloud+.24*g.flake-.13*up)
        finish.coat(cloth*damp*.55, (147,139,108), 178, grain=g.flake*15+g.grit*11)
        old = (decay[:,3]>170) & cloth
        finish.coat(old*(.26+.35*damp), decay[:,:3], 185)
        metal = f.where("stainless","bronze")|f.on("windscreen post")
        finish.coat(metal*unit(.14+.52*underside+.28*g.cloud)*.38,
                    (151,141,113), 102, 187, grain=g.grit*10)
        finish.coat((f.name_board|f.where("walnut"))*deposit*.45, (147,129,95), 130)
    if f.gelcoat.any():
        p = Patch(f, f.gelcoat, (None, None), g.texture)
        trails = fittings.trails(p)
        strength = (.68 if lie.sunk else .39)*trails*(.64+.36*vertical[p.i])
        finish.coat(strength, (137,94,58) if lie.sunk else (172,133,88), 162,
                    grain=p.flake*18+p.grit*9, at=p.i)
    if lie.sunk and not lie.burnt:
        pool=smooth((lie.water+.27-height)/.40)*unit(up)
        settled=pool*(.52+.38*(1-f.AO)+.15*g.flake)
        finish.coat(settled,(126,111,82),173,grain=13*g.flake+9*g.grit)
        finish.coat(f.where("chart","instruments","keyboard")*.94,(43,55,49),131,grain=g.flake*8)
        finish.coat(f.gelcoat*(.27+.48*sun+.19*deposit), (179,178,151), 182, grain=g.cloud*13)
        finish.coat(f.cloth*unit(.44+.38*g.cloud+.44*underside), (98,99,75), 195, grain=g.grit*18)


def wreck_slice(f, lie, src, g, fittings):
    base, packed, mask, hurt, decay = src
    finish = Finish(base, packed)
    _, height, _ = lie.transform(f.P)
    up = lie.up(f.N, f.y)
    if lie.burnt:
        guarded = fire(f, lie, finish, g, height, up)
        # A thin skin of pale, spent paint remains between the scorched shoulder and the tidal growth.
        pigment = mask.any(axis=1)
        relic = (1-guarded)*pigment
        finish.coat(relic*((.66+.16*g.cloud) if f.boat.key=="belvedere" else .31+.09*g.flake), (111,110,94), 171, grain=12*g.flake+8*g.grit)
    marine_growth(f, lie, finish, g, height, up)
    salt_and_fabric(f, lie, finish, g, fittings, height, up, decay)
    impact(f, lie, finish, g, hurt)
    windows(f, lie, finish, g, height)
    limit = np.where(f.cloth, .46, .76)+.075*g.flake
    keep = finish.original > limit
    if lie.burnt:
        z, y = f.z/(f.boat.lines["length"]*.5), f.y-f.boat.lines["main"]
        dry_flank = (f.x>0)*smooth((.065-np.abs(y+.21+.055*np.sin(7*z)))/.045)
        lee = smooth((.49-np.abs(z+.04))/.23)*unit(.52+.64*g.drift+.62*g.cloud+.49*g.flake)
        pin = f.where("strake")*smooth((.17-np.abs(z-.36))/.16)*unit(.30+.9*g.cloud+.63*g.flake)
        island = smooth((dry_flank*lee+pin-.32)/.40)*mask.any(axis=1)
        for dent in lie.dents:
            island *= smooth((np.linalg.norm(f.P-dent.point, axis=1)/dent.radius-1.08)/.4)
        finish.coat(island, base[:, :3]*.76, 155, grain=g.grit*9+g.flake*8)
        keep = (keep & (guarded>.55)) | (island>.70)
    return finish.maps(base, mask, keep)


def read_maps(folder, material, roles):
    maps = []
    for role in roles:
        with Image.open(folder / f"{material}_{role}.png") as image:
            pixels = np.asarray(image)
        maps.append(pixels.reshape(-1, pixels.shape[-1]))
    return maps


def save_maps(folder, material, maps, size):
    folder.mkdir(parents=True, exist_ok=True)
    for role, data in zip(("base", "packed", "mask"), maps):
        path = folder / f"{material}_{role}.png"
        save_png(Image.fromarray(data.reshape(size, size, -1)),path)


def decks():
    n = 1024
    t = teak_fields(n)
    src = HERE/"tex"
    base, packed, mask, hurt, decay = read_maps(src, "teak", ("base","packed","mask","hurt","decay"))
    u, v, seam, grain, strand, end, across, board = (a.ravel() for a in
        (t.u, t.v, t.seam, t.grain, t.strand, t.from_butt, t.across, t.board))
    rng = np.random.default_rng(4831)
    def field(cols, rows):
        grid = rng.uniform(-1, 1, (rows, cols)).astype("f")
        return ndimage.map_coordinates(grid, (v*rows, u*cols), order=1, mode="grid-wrap")
    broad, puddle, dust = field(5,4), field(32,9), field(79,53)
    pore = grain*.75 + strand*2 + t.dust.ravel()*1.3
    butt = np.minimum(end, 1-end)
    wet_seam = np.exp(-t.distance.ravel()/.0071)
    drywood = .44+.17*np.cos(TAU*end+board*2.73)+.13*broad+.17*puddle
    worn = Finish(base, packed)
    worn.coat((1-seam)*drywood, (173,161,131), 157, grain=pore)
    worn.coat(.22*wet_seam*(.70+.30*puddle), (85,78,52), 108, grain=pore*.5)
    worn.coat((decay[:,3]>170)*.33, decay[:,:3], 150)
    damage = (hurt[:,3]>170) | ((hurt[:,3]>85) & (hurt[:,0]>187))
    worn.coat(damage*(.77+.15*broad), hurt[:,:3], 175)
    salt = smooth((.135-butt)/.115)*unit(.48+.75*puddle+.23*strand)
    worn.coat(salt*.39, (167,155,119), 157, grain=pore)
    save_maps(src, "teak_worn", worn.maps(base, mask, np.ones(len(u), bool)), n)

    wreck = Finish(base, packed)
    tongue = .25*np.sin(TAU*(2*u+v)+.82*np.sin(TAU*v))+.18*np.cos(TAU*(u-v))
    carbon = smooth((.62*broad+.24*puddle+.065*np.cos(3.49*board)+tongue+.10*grain/8+.29)/.69)
    slick = unit(.43+.53*puddle+.27*broad+.47*wet_seam)
    wreck.coat(np.ones_like(u), (122,117,97), 182, grain=pore+8*puddle)
    wreck.coat(carbon*.94, (53,53,46), 209, grain=pore*.82+6*dust)
    # Across-grain checks split charred boards into short blocks, their silver lips lifting at the ends.
    split = np.abs((v*13+.23*across+board*.39+.095*puddle+.5)%1-.5)
    checks = smooth((.048-split)/.038)*carbon*(1-seam)*unit(.55+.69*puddle+.41*dust)
    wreck.coat(checks, (28,31,27), 227)
    bubbles = smooth((dust+.36*puddle-.32)/.42)*carbon*unit(.45+.23*strand)
    wreck.coat(bubbles, (107,99,79), 218, grain=pore)
    wreck.coat(slick*(1-.71*carbon)*(.37+.33*wet_seam), (91,99,72), 117, grain=pore*.52)
    wreck.coat(seam*(.68+.32*carbon), (47,49,40), 174, grain=strand*2)
    wreck.coat(wet_seam*unit(.27+.82*puddle+.20*strand)*.69, (59,72,48), 116, grain=pore*.34)
    save_maps(src, "teak_wrecked", wreck.maps(base, mask, np.ones(len(u), bool)), n)


def paint_wrecks(yacht):
    boat = Vessel(yacht)
    with np.load(boat.folder/"bakes/hull.npz") as bake:
        triangles = bake["pos"][bake["part"] == list(bake["parts"]).index("chine-built hull and laid deck")]
        lowest_vertices = bake["pos"].reshape(-1, 3)
    specs = json.loads(FORMS.read_text())[yacht]
    lies = [Lie(boat, name, specs[name], triangles, lowest_vertices) for name in ("damaged", "sunk")]
    fittings = Fittings(boat)
    decks()
    for material in OWN[yacht]:
        surface = read_surface(boat, material)
        src = read_maps(boat.folder, material, ("base", "packed", "mask", "hurt", "decay"))
        targets = [[np.empty_like(a) for a in src[:3]] for _ in lies]
        for start in range(0, surface.n, 131072):
            rows = slice(start, start+131072)
            f = Fields(boat, surface, rows)
            g = Grain(f)
            for lie, dst in zip(lies, targets):
                maps = wreck_slice(f, lie, [a[rows] for a in src], g, fittings)
                for picture, strip in zip(dst, maps):
                    picture[rows] = strip
        for lie, target in zip(lies, targets):
            save_maps(lie.folder, material, target, surface.size)
            print(f"{yacht}_{lie.name} {material} {surface.size}px, water {lie.water:.3f} m", flush=True)
        del surface, f, src, targets, dst, picture


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("yacht", choices=IDENTITY)
    paint_wrecks(parser.parse_args().yacht)
