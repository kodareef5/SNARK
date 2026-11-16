"""Group exact unlabeled coplanar wall boxes without changing their per-box finishes.

The existing wall model derives its wainscot separately for every box. Preserve
those original boxes; labels, clear window walls and rotated pieces stay separate.
"""
import json,math


def finish(D,p,world,place,box,ys):
 prototypes={q['id']:q for q in D['prototypes']};groups={}
 for instance in D['instances']:
  proto=prototypes[instance['prototype']];art=proto['art']
  if not instance['placed'] or instance['yaw']!=0 or art['kind']!='wall' or art.get('label'):continue
  if proto['hulls'] or proto.get('look') or len(proto['boxes'])!=1:continue
  source=proto['boxes'][0]
  b={'at':[source['at'][k]+instance['at'][k] for k in range(3)],'half':source['half'][:]}
  normal=0 if b['half'][0]<b['half'][2] else 2
  key=(proto['category'],json.dumps(art,sort_keys=True),proto['color'],normal,
       round(b['at'][normal],6),round(b['half'][normal],6))
  groups.setdefault(key,[]).append((instance,b))

 def bounds(boxes):
  lo=[min(b['at'][k]-b['half'][k] for b in boxes) for k in range(3)]
  hi=[max(b['at'][k]+b['half'][k] for b in boxes) for k in range(3)]
  origin=[round((a+b)*256)/512 for a,b in zip(lo,hi)]
  return lo,hi,origin

 def fits(boxes):
  if len(boxes)>16:return False
  lo,hi,o=bounds(boxes)
  return hi[1]-lo[1]<=30 and all(max(abs(lo[k]-o[k]),abs(hi[k]-o[k]))<=16 for k in range(3)) and \
      max(math.hypot(x-o[0],z-o[2]) for x in(lo[0],hi[0]) for z in(lo[2],hi[2]))<=14.5

 removed=set();old_prototypes=set();records=[];deck_order={d['id']:i for i,d in enumerate(D['decks'])}
 for key,members in groups.items():
  along=2-key[3];batches=[]
  for member in sorted(members,key=lambda m:(m[1]['at'][along]-m[1]['half'][along],m[1]['at'][1]-m[1]['half'][1],m[0]['id'])):
   candidates=[(i,batch) for i,batch in enumerate(batches) if fits([b for _,b in batch]+[member[1]])]
   if candidates:
    def cost(candidate):
     lo,hi,_=bounds([b for _,b in candidate[1]]+[member[1]])
     return (hi[along]-lo[along])*(hi[1]-lo[1])
    min(candidates,key=cost)[1].append(member)
   else:batches.append([member])
  for batch in batches:
   if len(batch)==1:continue
   boxes=[b for _,b in batch];_,_,origin=bounds(boxes)
   local=[{'at':[b['at'][k]-origin[k] for k in range(3)],'half':b['half']} for b in boxes]
   ident=p('wall_batch',key[0],local,art=json.loads(key[1]),color=key[2])
   decks=sorted({i['deck'] for i,_ in batch},key=deck_order.get)
   name='wall_batch_'+str(len(records));place(name,ident,origin,decks[0],'public-interior')
   D['instances'][-1]['decks']=decks
   sources=[i['id'] for i,_ in batch]
   removed.update(sources);old_prototypes.update(i['prototype'] for i,_ in batch)
   records.append({'instance':name,'sources':sources,'decks':decks})
 D['instances'][:]=[i for i in D['instances'] if i['id'] not in removed]
 used={i['prototype'] for i in D['instances']}
 D['prototypes'][:]=[q for q in D['prototypes'] if q['id'] not in old_prototypes or q['id'] in used]
 D['wallBatches']={'interpretation':'Exact unlabeled coplanar boxes, preserving each original wall and wainscot.',
                   'batches':records}
