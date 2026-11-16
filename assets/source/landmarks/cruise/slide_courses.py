"""Inferred Category Six courses shared by layout, collision and visual stages.

Operator photographs identify ride types and colours, not surveyed paths. These
original curves retain the launch bank and four outlets; racing outlets are
paired in launch order to avoid a false crossing. Ship-local engine metres.
This module deliberately has no Blender dependency.
"""
import math


def _add(a,b): return [a[k]+b[k] for k in range(3)]
def _sub(a,b): return [a[k]-b[k] for k in range(3)]
def _scale(a,s): return [v*s for v in a]
def _dot(a,b): return sum(a[k]*b[k] for k in range(3))
def _length(a): return math.sqrt(_dot(a,a))
def _unit(a): return _scale(a,1/_length(a))
def _cross(a,b): return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
def _mix(a,b,t): return _add(_scale(a,1-t),_scale(b,t))


def _distance(point,a,b):
    ab=_sub(b,a)
    t=max(0,min(1,_dot(_sub(point,a),ab)/_dot(ab,ab)))
    return _length(_sub(point,_add(a,_scale(ab,t))))


def _rounded(guides,reach=3):
    """Tangent quadratic corners; each sampled point lies on the curve."""
    out=[guides[0]]
    def curve(a,b,c):
        mid=_mix(_mix(a,b,.5),_mix(b,c,.5),.5)
        if _distance(mid,a,c)<=.002:
            out.append(c)
        else:
            ab,bc=_mix(a,b,.5),_mix(b,c,.5)
            curve(a,ab,mid);curve(mid,bc,c)
    for i in range(1,len(guides)-1):
        before=_sub(guides[i-1],guides[i]);after=_sub(guides[i+1],guides[i])
        d=min(reach,_length(before)*.4,_length(after)*.4)
        a=_add(guides[i],_scale(_unit(before),d))
        c=_add(guides[i],_scale(_unit(after),d))
        if _length(_sub(out[-1],a))>1e-8:out.append(a)
        curve(a,guides[i],c)
    out.append(guides[-1])
    # Bounded fine segments keep each source collision group economical before
    # the ordinary 16 m cell partition. Straight inserted points disappear at LOD.
    bounded=[out[0]]
    for a,b in zip(out,out[1:]):
        count=max(1,math.ceil(_length(_sub(b,a))/4))
        bounded.extend(_mix(a,b,i/count) for i in range(1,count+1))
    return [[round(v,9) for v in p] for p in bounded]


def _simplify(points,tolerance):
    """Endpoint-preserving source subsets, not independently resampled curves."""
    def visit(first,last):
        if last<=first+1:return [first,last]
        error,index=max((_distance(points[i],points[first],points[last]),i) for i in range(first+1,last))
        if error<=tolerance:return [first,last]
        return visit(first,index)[:-1]+visit(index,last)
    return [points[i] for i in visit(0,len(points)-1)]


def courses():
    """JSON-ready authoritative source with six authored paths per course."""
    definitions=[
        ('frightening_bolt','Frightening Bolt','coral',.60,False,[
            [12,68.4,-117.3],[12,67.8,-117.6],[12,58,-120],[11,56.6,-129],
            [0,56.4,-151],[0,56,-161],[4,55.8,-167]]),
        ('storm_chasers_teal','Storm Chasers — teal','teal',.60,False,[
            [14.3,68.4,-117.3],[10,66,-124],[-2,63,-134],[-11,60.5,-145],
            [-11.9,57.5,-158],[-10.7,55.8,-169.5]]),
        ('storm_chasers_blue','Storm Chasers — blue','blue',.60,False,[
            [16.6,68.4,-117.3],[12.3,66,-124],[.3,63,-134],[-8.7,60.5,-145],
            [-9.6,57.5,-158],[-8.3,55.8,-169.5]]),
        ('pressure_drop','Pressure Drop','yellow',.65,True,[
            [18.9,68.4,-117.3],[18.9,67.2,-117.8],[18.9,57,-122.3],
            [17,55.8,-128],[4.683708242,55.8,-161.539803799]]),
        ('hurricane_hunter','Hurricane Hunter','purple',.95,False,[
            [21.2,68.4,-117.3],[20,66.5,-125],[16,64.8,-134],[9,63,-140],
            [5,61.5,-147],[8,59.5,-155],[14.735591197,55.8,-163.762656365]]),
        ('storm_surge','Storm Surge','leaf',.95,False,[
            [23.5,68.4,-117.3],[23,67,-126],[22,65,-138],[17,62.8,-149],
            [11,60.7,-158],[12,58.3,-166],[13.229148967,55.8,-171.540814972]]),
    ]
    result=[]
    for number,(ident,name,finish,radius,opened,guides) in enumerate(definitions):
        points=_rounded(guides)
        course=dict(number=number,id=ident,name=name,finish=finish,radius=radius,
                    outerRadius=radius+.08 if opened else radius,open=opened,
                    shape='open_trough' if opened else 'closed_tube',points=points)
        course['lodPoints']=[points]+[_simplify(points,t) for t in (.004,.008,.018,.09,.13)]
        course['visualRadius']=max(_profile_radius(course,level) for level in range(6))
        result.append(course)
    return result


def course_frames(points):
    """Gravity-oriented frames; +v points toward the open trough's mouth."""
    frames=[]
    for i,p in enumerate(points):
        before=_unit(_sub(p,points[i-1])) if i else None
        after=_unit(_sub(points[i+1],p)) if i+1<len(points) else None
        tangent=_unit(_add(before,after)) if before and after else before or after
        side=_unit(_cross([0,1,0],tangent));up=_unit(_cross(tangent,side))
        frames.append((side,up))
    return frames


def _sides(course,level):
    if course['open']:return (8,8,6,4,3,2)[level]  # Lower semicircle segments.
    return (16,16,12,10,6,5)[level] if course['radius']>.8 else (16,16,10,8,5,4)[level]


def _profile_radius(course,level):
    sides=_sides(course,level)*(2 if course['open'] else 1)
    fit=1 if level<2 else 2/(1+math.cos(math.pi/sides))
    return course['outerRadius']*fit


def profile(course,level):
    """Closed 2D cross-section, including an annular physically open trough."""
    sides=_sides(course,level);outer=_profile_radius(course,level)
    if not course['open']:
        return [(outer*math.cos(i*math.tau/sides),outer*math.sin(i*math.tau/sides)) for i in range(sides)]
    fit=outer/course['outerRadius']
    # Lower outer shell then reversed inner face. Only thin rim faces join them;
    # there is no face or physical collision plane across the open mouth.
    return [(r*math.cos(math.pi+i*math.pi/sides),r*math.sin(math.pi+i*math.pi/sides))
            for r,indices in ((outer,range(sides+1)),(course['radius']*fit,range(sides,-1,-1))) for i in indices]


def course_rings(course,level):
    dense=course['points'];lookup={tuple(p):frame for p,frame in zip(dense,course_frames(dense))}
    shape=profile(course,level)
    return [[_add(p,_add(_scale(lookup[tuple(p)][0],x),_scale(lookup[tuple(p)][1],y)))
             for x,y in shape] for p in course['lodPoints'][level]]


def collision_hulls(course):
    """Fine-profile convex sectors, ≤12 points and a genuinely open yellow mouth."""
    rings=course_rings(course,0);out=[]
    for segment,(a,b) in enumerate(zip(rings,rings[1:])):
        if course['open']:
            n=8
            for i in range(n):
                ids=[i,i+1,2*n-i,2*n+1-i]
                out.append(dict(segment=segment,points=[ring[j] for ring in (a,b) for j in ids]))
        else:
            for part in range(4):
                ids=[(part*4+j)%16 for j in range(5)]
                out.append(dict(segment=segment,points=[p for end,ring in ((segment,a),(segment+1,b))
                                                        for p in [course['points'][end]]+[ring[j] for j in ids]]))
    return out


def look_hulls(course,segment_range):
    """Actual profile sectors at all stages, restricted to a fine source group.

    Two fine segments require at most 62 open-shell parts before deduplication;
    closed tubes need fewer. No broad box or filled trough substitutes for them.
    """
    dense_index={tuple(p):i for i,p in enumerate(course['points'])}
    length=[0]
    for a,b in zip(course['points'],course['points'][1:]):length.append(length[-1]+_length(_sub(b,a)))
    out=[];seen=set()
    for stage in range(6):
        rings=course_rings(course,stage);path=course['lodPoints'][stage]
        for i,(pa,pb) in enumerate(zip(path,path[1:])):
            a,b=dense_index[tuple(pa)],dense_index[tuple(pb)]
            if a>=segment_range[1] or b<=segment_range[0]:continue
            ts=[(length[max(a,segment_range[0])]-length[a])/(length[b]-length[a]),
                (length[min(b,segment_range[1])]-length[a])/(length[b]-length[a])]
            ends=[[_mix(x,y,t) for x,y in zip(rings[i],rings[i+1])] for t in ts]
            centers=[_mix(pa,pb,t) for t in ts]
            sides=_sides(course,stage)
            if course['open']:
                groups=[[j,j+1,2*sides-j,2*sides+1-j] for j in range(sides)]
            elif sides<=6:
                groups=[list(range(sides))]
            else:
                groups=[[(j+k)%sides for k in range(min(4,sides-j)+1)]+[-1]
                        for j in range(0,sides,4)]
            for group in groups:
                points=[centers[e] if j<0 else ends[e][j] for e in range(2) for j in group]
                key=tuple(sorted(tuple(round(v,8) for v in p) for p in points))
                if key not in seen:
                    seen.add(key);out.append({'points':points})
    return out


def course_bounds(course,stage=None,segment_range=None):
    """Actual ring-vertex union; optional range is [first,last) fine segments."""
    if stage is None and segment_range is not None:
        points=[p for hull in look_hulls(course,segment_range) for p in hull['points']]
        return dict(min=[min(p[k] for p in points) for k in range(3)],max=[max(p[k] for p in points) for k in range(3)])
    stages=range(6) if stage is None else (stage,)
    dense_index={tuple(p):i for i,p in enumerate(course['points'])};points=[]
    length=[0]
    for a,b in zip(course['points'],course['points'][1:]):length.append(length[-1]+_length(_sub(b,a)))
    for level in stages:
        rings=course_rings(course,level);ids=[dense_index[tuple(p)] for p in course['lodPoints'][level]]
        for i,(a,b) in enumerate(zip(ids,ids[1:])):
            if segment_range is None:
                points.extend(rings[i]);points.extend(rings[i+1])
            elif a<segment_range[1] and b>segment_range[0]:
                # Restrict the coarse strip to this fine group's longitudinal
                # interval. Include either quad diagonal, so Blender's choice
                # of triangulation cannot leave a vertex outside the bound.
                lo=max(a,segment_range[0]);hi=min(b,segment_range[1])
                for t in ((length[lo]-length[a])/(length[b]-length[a]),
                          (length[hi]-length[a])/(length[b]-length[a])):
                    for j in range(len(rings[i])):
                        for k in (j,(j+1)%len(rings[i]),(j-1)%len(rings[i])):
                            points.append(_mix(rings[i][j],rings[i+1][k],t))
    return dict(min=[min(p[k] for p in points) for k in range(3)],max=[max(p[k] for p in points) for k in range(3)])
