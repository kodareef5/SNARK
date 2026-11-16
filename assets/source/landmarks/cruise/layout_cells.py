"""Map-local rendering ownership, separate from the exact walked prototype instances.

Every cell is a genuine 16 m cube in ship metres. The model clips its members' visual
solids to that cube; an existing, uniquely selected collision instance draws it.
Cloning that instance's kind changes no physical part and never repeats a cell mesh.
"""
import copy,math
from collections import defaultdict

SIDE=16
def snap(v):return math.floor(v*512+.5)/512
def axes(degrees):
 yaw=math.floor(degrees*65536/360+.5)&65535;q=yaw>>14;a=(yaw&16383)*math.tau/65536
 c=math.floor(math.cos(a)*768+.5);s=math.floor(math.sin(a)*768+.5)
 for _ in range(q):c,s=-s,c
 return c/768,s/768

def worldpoint(point,instance):
 c,s=axes(instance['yaw']);x,y,z=point;at=[snap(v) for v in instance['at']]
 return [at[0]+c*x+s*z,at[1]+y,at[2]-s*x+c*z]

def finish(D):
 original={p['id']:p for p in D['prototypes']};byid={i['id']:i for i in D['instances']}
 placed=[i for i in D['instances'] if i['placed'] and original[i['prototype']]['category']!='door']
 ownership=defaultdict(dict)
 for inst in placed:
  proto=original[inst['prototype']];lo=proto['visualBounds']['min'];hi=proto['visualBounds']['max']
  parts=[(lo,hi)]
  if proto['art']['kind']=='dome_dense':
   # The empty corners of a curved dome sector's broad box are not render
   # cells. Individual real ribs/panes give tighter conservative ownership.
   parts=[([min(a[k],b[k])-.105 for k in range(3)],[max(a[k],b[k])+.105 for k in range(3)]) for a,b in proto['art']['beams']]
   parts += [([min(q[k] for q in h) for k in range(3)],[max(q[k] for q in h) for k in range(3)]) for h in proto['art']['roof']]
  elif proto['art']['kind']=='funnel_band':
   parts=[];profile=proto['art']['profile']
   for step in range(32):
    angles=[step*math.tau/32,(step+1)*math.tau/32]
    points=[[rx*math.cos(a),y,shift+rz*math.sin(a)] for y,rx,rz,shift in profile for a in angles]
    points += [[0,y,shift] for y,rx,rz,shift in profile]
    parts.append(([min(q[k] for q in points) for k in range(3)],[max(q[k] for q in points) for k in range(3)]))
  member={'instance':inst['id'],'prototype':proto['id'],'category':proto['category']}
  if 'measurement' in proto['art']:member['measurement']=proto['art']['measurement']
  for lo,hi in parts:
   corners=[worldpoint([x,y,z],inst) for x in(lo[0],hi[0]) for y in(lo[1],hi[1]) for z in(lo[2],hi[2])]
   bounds=[[min(p[k] for p in corners),max(p[k] for p in corners)] for k in range(3)]
   spans=[range(math.floor(lo/SIDE),math.floor((hi-1e-7)/SIDE)+1) for lo,hi in bounds]
   for x in spans[0]:
    for y in spans[1]:
     for z in spans[2]:ownership[x,y,z][inst['id']]=member
 # Ordinary kinds retain their source art and exact geometry for provenance, but
 # are collision/far proxies only. Interactive leaves and unplaced port signs
 # are independent meshes with the normal building-piece budgets.
 used={i['prototype'] for i in D['instances'] if i['placed']}
 for p in D['prototypes']:
  p['mesh']=p['id'] if p['category']=='door' or p['id'] not in used and p['category']=='sign' else 'none'
 candidates=[i for i in placed if i['yaw']==0];claimed=set();D['cells']=[]
 for number,(grid,members) in enumerate(sorted(ownership.items())):
  center=[(k+.5)*SIDE for k in grid]
  anchor=min((i for i in candidates if i['id'] not in claimed),key=lambda i:math.dist(i['at'],center))
  claimed.add(anchor['id']);source=anchor['prototype'];cid=f'cruise:cell_{number:04}'
  clone=copy.deepcopy(original[source]);clone['id']=f'cruise:anchor_{number:04}';clone['mesh']=cid
  clone['sourcePrototype']=source;D['prototypes'].append(clone)
  anchor['sourcePrototype']=source;anchor['prototype']=clone['id'];anchor['at']=[snap(v) for v in anchor['at']]
  D['cells'].append({'id':cid,'grid':list(grid),'bounds':{'min':[k*SIDE for k in grid],'max':[(k+1)*SIDE for k in grid]},
                    'anchor':anchor['id'],'origin':anchor['at'],'yaw':0,'members':list(members.values())})
 D['artBudget'].update({'cellMetres':SIDE,'levels':6,'nearFlatLevel':2,'materialsThroughMetres':80,
                       'materialsPerCellMaximum':2,'nativeRule':'LANDMARK_TRIANGLES',
                       'notes':'Actual 16 m XYZ cells, clipped visual solids; native per-distance limits are unchanged.'})
 D['phase']='map-local-render-cell-migration'
 return D['cells']
