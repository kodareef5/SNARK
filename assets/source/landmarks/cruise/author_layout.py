"""Original metre-scale Icon reconstruction; public dimensions and inferred geometry stay separate.

This generator owns both native collision and the source mesh contract. Prototypes are reused by instances;
an instance ID is a placement identity, never a second content definition. Run with Python 3, no dependencies.
"""
import json,math
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
OUT = ROOT / 'content/landmarks/cruise-layout.json'
DECKS = [('2',3.0),('3',6.2),('4',9.8),('5',14.0),('6',18.4),('7',22.6),('8',26.0),
         ('9',29.2),('10',32.4),('11',35.6),('12',38.8),('14',42.0),('15',45.6),
         ('16',49.6),('17',53.2),('18',56.8),('19',60.0),('20',63.2)]
BUILDER = 'https://www.meyerturku.fi/en/news-publications/news/meyer-turku-shipyard-delivered-the-worlds-most-advanced-cruise-ship-icon-of-the-seas/'
PLAN = 'https://www.royalcaribbean.com/content/dam/royal/ships/deckplans-hub/Icon_2250_v2023.pdf'
D = {
 'schema':1, 'id':'cruise', 'subject':'Icon of the Seas', 'phase':'contract-prototype',
 'frame':{'units':'metres','up':'+Y','forward':'+Z','port':'+X','waterline':0,'yawUnits':'degrees'},
 'sources':[{'id':'builder-delivery','url':BUILDER,'kind':'published-dimensions-and-photograph','date':'2023-11-26'},
            {'id':'operator-plan-2250','url':PLAN,'kind':'public-visitor-plan','profile':'2250','pdfCreated':'2022-10-20'}],
 'dimensions':{'lengthOverall':365,'minZ':-182.5,'maxZ':182.5,'waterlineBeam':48.5,'deckhouseBeam':57.8,'bridgeBeam':65.8,
               'provisionalKeelY':-9.3,'provisionalHighestY':75,
               'published':['lengthOverall','waterlineBeam','deckhouseBeam','bridgeBeam'],
               'inferred':['hull stations','deck elevations','provisionalKeelY','provisionalHighestY','room dimensions'],
               'authority':'builder-delivery'},
 'clearances':{'doorWidth':1.6,'doorHeight':2.6,'minimumHeadroom':2.6,'publicStairWidth':1.8,
               'stairLandingClearWidth':4.4,'stairLandingClearDepth':2.2,'floorThickness':.24,'railHeight':1.15},
 'decks':[], 'prototypes':[], 'instances':[], 'rooms':[], 'portals':[], 'stairs':[], 'doors':[],
 'graph':{'nodes':[]}, 'routes':[], 'docking':{}, 'views':[],
 'artBudget':{'levels':6,'nearFlatLevel':1,'materialsPerPrototypeMaximum':3,
              'mediumSubmittedTrianglesTarget':1000000,'mediumDrawsTarget':600,
              'notes':'Targets require native App measurement; no renderer budget increases or portal culling assumed.'},
 'prototypeScope':{'complete':False,'notes':'Early schema and boarding sample. Full silhouette and furnished vertical section follow before the prototype gate.'},
}

def clean(value):
 if isinstance(value,float): return round(value,6)
 if isinstance(value,list): return [clean(v) for v in value]
 if isinstance(value,dict): return {k:clean(v) for k,v in value.items()}
 return value

def box(lo,hi):
 return {'at':[(a+b)/2 for a,b in zip(lo,hi)],'half':[(b-a)/2 for a,b in zip(lo,hi)]}

def prototype(name,category,boxes,*,hulls=None,look=None,art=None,color=232):
 points=[tuple(b['at'][k]+s[k]*b['half'][k] for k in range(3)) for b in boxes
         for s in ((x,y,z) for x in (-1,1) for y in (-1,1) for z in (-1,1))]
 points += [p for h in (hulls or []) for p in h['points']]
 if look:
  points += [tuple(b['at'][k]+s[k]*b['half'][k] for k in range(3)) for b in look.get('boxes',[])
             for s in ((x,y,z) for x in (-1,1) for y in (-1,1) for z in (-1,1))]
  points += [p for h in look.get('hulls',[]) for p in h['points']]
 bounds={'min':[min(p[k] for p in points) for k in range(3)],'max':[max(p[k] for p in points) for k in range(3)]}
 assert len(boxes)+len(hulls or []) <= 16, name
 assert all(abs(v)<=16 for side in bounds.values() for v in side), (name,bounds)
 assert max(math.hypot(q[0],q[2]) for q in points)<=14.5+.000001, (name,'native route radius')
 ident='cruise:'+name
 p={'id':ident,'mesh':ident,'category':category,'color':color,'boxes':boxes,'hulls':hulls or [],
    'visualBounds':bounds,'art':art or {'kind':'solids','finish':'enamel'}}
 if look: p['look']=look
 D['prototypes'].append(p)
 return ident

def instance(name,proto,at,deck,section,yaw=0,placed=True):
 D['instances'].append({'id':name,'prototype':proto,'at':at,'yaw':yaw,'deck':deck,'section':section,'placed':placed})
 return name

def node(ident,at,deck,kind='circulation'):
 D['graph']['nodes'].append({'id':ident,'at':at,'deck':deck,'kind':kind})

for i,(label,y) in enumerate(DECKS):
 D['decks'].append({'id':label,'index':i,'floorY':y,'ceilingY':DECKS[i+1][1]-.24 if i+1<len(DECKS) else None,
                    'evidence':'inferred','outlines':[],'voids':[]})

D['docking']={'shipLanding':[28.9,14,-24],'shoreLanding':[58,14,-24],'shoreApproach':[61,14,-24],
              'arrival':[20,14,-24],'clearWidth':2.8,'side':'port','deck':'5','seaDatum':0,
              'pierConnection':{'xMinimum':58,'zMinimum':-25.6,'zMaximum':-22.4}}
from layout_geometry import populate
populate(D,prototype,instance,box,node)
for p in D['prototypes']:
 if p['category']=='facade':p['art'].setdefault('measurement','deckhouse')
from layout_cells import finish as cells
cells(D)
D=clean(D)
from layout_collision_cells import finish as collision_cells
collision_cells(D)
from layout_json import dumps
OUT.write_text(dumps(D))
print(f'Cruise layout: {len(D["prototypes"])} prototypes, {len(D["instances"])} instances, {len(D["routes"])} routes')
