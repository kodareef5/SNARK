"""Bounded vertical floor batches preserve the exact authored polygons and voids."""
import re
from collections import defaultdict

def finish(D,world,place):
 prototypes={p['id']:p for p in D['prototypes']};groups=defaultdict(list);removed=set();old_kinds=set()
 for inst in D['instances']:
  match=re.fullmatch(r'd(\d+)_floor_(-?\d+)_(-?\d+)_(\d+)',inst['id'])
  if not match:continue
  proto=prototypes[inst['prototype']]
  assert not proto['boxes'] and inst['yaw']==0
  key=(int(match[2]),int(match[3]),proto['color'],proto['art']['finish'])
  for hull in proto['hulls']:
   points=[[round(v[k]+inst['at'][k],6) for k in range(3)] for v in hull['points']]
   groups[key].append((inst['deck'],inst['id'],points))
  removed.add(inst['id']);old_kinds.add(inst['prototype'])
 D['instances'][:]=[i for i in D['instances'] if i['id'] not in removed]
 deck_order={d['id']:d['index'] for d in D['decks']}
 for (gx,gz,color,finish),parts in sorted(groups.items()):
  parts.sort(key=lambda part:min(v[1] for v in part[2]));batch=[];low=0;index=0
  def emit(items,index):
   proto,at=world('deck_stack','floor',hs=[part[2] for part in items],art={'kind':'floor','finish':finish},color=color)
   decks=sorted(set(part[0] for part in items),key=deck_order.get)
   place(f'floor_stack_{gx}_{gz}_{finish}_{index}',proto,at,decks[0],'multi-deck-floor')
   D['instances'][-1]['decks']=decks
   D['instances'][-1]['sourceInstances']=sorted(set(part[1] for part in items))
  for part in parts:
   bottom=min(v[1] for v in part[2]);top=max(v[1] for v in part[2])
   if batch and(len(batch)>=16 or top-low>30):emit(batch,index);index+=1;batch=[]
   if not batch:low=bottom
   batch.append(part)
  if batch:emit(batch,index)
 used={i['prototype'] for i in D['instances']}
 D['prototypes'][:]=[p for p in D['prototypes'] if p['id'] not in old_kinds or p['id'] in used]
