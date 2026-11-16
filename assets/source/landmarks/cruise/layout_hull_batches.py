"""Batch the existing above/below-water shell per bounded longitudinal section.

Every original convex part and finish is retained. The common white far proxy is
appropriate above water; the navy part remains entirely at or below waterline.
"""


def finish(D,p,world,place,box,ys):
 prototypes={q['id']:q for q in D['prototypes']}
 instances={q['id']:q for q in D['instances']}
 removed=set();old_prototypes=set();batches=[]
 for under in list(D['instances']):
  if not under['id'].startswith('hull_under_'):continue
  side=instances.get(under['id'].replace('hull_under_','hull_side_',1))
  if side is None:raise ValueError('Missing paired upper hull: '+under['id'])
  hulls=[];finishes=[]
  for instance in(under,side):
   if instance['yaw']!=0:raise ValueError('Hull batching requires the original canonical frame')
   proto=prototypes[instance['prototype']]
   if proto['boxes'] or proto.get('look'):raise ValueError('Unexpected hull representation')
   for hull in proto['hulls']:
    points=[[v[k]+instance['at'][k] for k in range(3)] for v in hull['points']]
    if instance is under and max(v[1] for v in points)>.000002:raise ValueError('Navy hull extends above waterline')
    hulls.append(points);finishes.append(proto['art']['finish'])
  points=[v for h in hulls for v in h]
  origin=[round((min(v[k] for v in points)+max(v[k] for v in points))*256)/512 for k in range(3)]
  local=[{'points':[[v[k]-origin[k] for k in range(3)] for v in h]} for h in hulls]
  ident=p('hull_shell','hull',[],local,{'kind':'hull_shell','finish':'enamel','finishes':finishes},232)
  name=under['id'].replace('hull_under_','hull_shell_',1)
  place(name,ident,origin,under['deck'],'envelope')
  removed.update((under['id'],side['id']))
  old_prototypes.update((under['prototype'],side['prototype']))
  batches.append({'instance':name,'sources':[under['id'],side['id']]})
 D['instances'][:]=[i for i in D['instances'] if i['id'] not in removed]
 used={i['prototype'] for i in D['instances']}
 # Only retire replaced hull kinds. Definition-only port signs and unplaced
 # door states have other consumers and must not be pruned as collateral work.
 D['prototypes'][:]=[q for q in D['prototypes'] if q['id'] not in old_prototypes or q['id'] in used]
 D['hullBatches']={'interpretation':'Exact original convex shell sections with per-part near finishes.',
                   'far':'White hull envelope; the separately navy near surface stays at or below waterline.',
                   'batches':batches}
