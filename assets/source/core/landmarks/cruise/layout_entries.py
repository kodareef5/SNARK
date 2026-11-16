"""Record actual room access crossings; geometric opening centers remain separate portals."""
import math

def finish(D):
 def on_segment(point,a,b):
  v=[b[k]-a[k] for k in range(3)];l=sum(x*x for x in v)
  t=max(0,min(1,sum((point[k]-a[k])*v[k] for k in range(3))/l)) if l else 0
  return math.dist(point,[a[k]+v[k]*t for k in range(3)])<=.002
 def inside(poly,x,z):
  yes=False
  for a,b in zip(poly,poly[1:]+poly[:1]):
   if (a[1]>z)!=(b[1]>z) and x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0]:yes=not yes
  return yes
 for r in D['rooms']:
  routes=[q for q in D['routes'] if q['to']==r['node'] or q['from']==r['node']]
  if any(on_segment(r['entry'],a,b) for q in routes for a,b in zip(q['anchors'],q['anchors'][1:])):continue
  route=next((q for q in routes if q['id']==r['id']+'_access'),routes[0] if routes else None)
  if not route:raise ValueError('Room without access: '+r['id'])
  anchors=route['anchors'] if route['to']==r['node'] else list(reversed(route['anchors']))
  lo=r['bounds']['min'];hi=r['bounds']['max'];fp=r.get('footprint',{'polygons':[[[lo[0],lo[2]],[hi[0],lo[2]],[hi[0],hi[2]],[lo[0],hi[2]]]],'holes':[]})
  def occupied(x,z):return any(inside(p,x,z) for p in fp['polygons']) and not any(inside(p,x,z) for p in fp['holes'])
  chosen=None
  for a,b in zip(anchors,anchors[1:]):
   dx=b[0]-a[0];dz=b[2]-a[2];ts=[0,1]
   for poly in fp['polygons']+fp['holes']:
    for c,e in zip(poly,poly[1:]+poly[:1]):
     ex=e[0]-c[0];ez=e[1]-c[1];den=dx*ez-dz*ex
     if abs(den)<1e-10:continue
     t=((c[0]-a[0])*ez-(c[1]-a[2])*ex)/den
     u=((c[0]-a[0])*dz-(c[1]-a[2])*dx)/den
     if 0<=t<=1 and 0<=u<=1:ts.append(t)
   ts=sorted(set(ts))
   for t0,t1 in zip(ts,ts[1:]):
    t=(t0+t1)/2
    if occupied(a[0]+dx*t,a[2]+dz*t):chosen=[a[k]+(b[k]-a[k])*t0 for k in range(3)];break
   if chosen:break
  r['entry']=chosen or list(r['routeTarget'])
