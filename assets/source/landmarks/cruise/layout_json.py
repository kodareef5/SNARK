"""Deterministic, reviewable layout JSON without millions of derived-data lines."""
import json

# Keep hand-reviewed room/deck/route records expanded. Geometry records are
# individually readable lines: dense curved profiles otherwise add hundreds of
# thousands of indentation-only lines without making their coordinates clearer.
RECORDS={'prototypes','instances','cells','collisionPrototypes','collisionInstances','collisionCells'}

def dumps(layout):
 lines=['{']
 entries=list(layout.items())
 for index,(name,value) in enumerate(entries):
  prefix='  '+json.dumps(name)+': '
  if name in RECORDS:
   lines.append(prefix+'[')
   lines.extend('    '+json.dumps(record,separators=(',',':'))+(',' if i+1<len(value) else '')
                for i,record in enumerate(value))
   lines.append('  ]'+(',' if index+1<len(entries) else ''))
  else:
   encoded=json.dumps(value,indent=2).splitlines()
   lines.append(prefix+encoded[0])
   lines.extend('  '+line for line in encoded[1:])
   if index+1<len(entries):lines[-1]+=','
 lines.append('}')
 return '\n'.join(lines)+'\n'
