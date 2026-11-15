"""Rebuild every final image and measurement inside the current concept folder.

Requires Blender (tested 5.3), Python 3, Pillow and NumPy. No network or git.
Usage: python3 rebuild.py
"""
from pathlib import Path
import subprocess,sys,time,json

ROOT=Path(__file__).resolve().parent
LOGS=ROOT/'checks'/'logs';LOGS.mkdir(parents=True,exist_ok=True)
started=time.time()
steps=[
    ('rebuild_render',['blender','--factory-startup','-b','-noaudio','-t','16','--python','build_concepts.py','--','all']),
    ('rebuild_sheets',[sys.executable,'finish_sheets.py']),
    ('rebuild_validation',['blender','--factory-startup','-b','-noaudio','concept_models.blend','-t','16','--python','check_model.py']),
    ('rebuild_validation_sheets',[sys.executable,'finish_validation.py']),
    ('rebuild_audit',[sys.executable,'audit_delivery.py']),
]
for name,command in steps:
    print(name,flush=True)
    with (LOGS/(name+'.log')).open('w') as log:
        subprocess.run(command,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,check=True)
for filename,flag in [('measurements.json','all_checks_pass'),('model_measurements.json','all_within_3_percent'),('raster_measurements.json','all_dimensions_within_3_percent')]:
    report=json.loads((ROOT/'checks'/filename).read_text())
    if not report[flag]:raise RuntimeError('Measurement failed: '+filename)
with (ROOT/'checks'/'rebuild_runs.jsonl').open('a') as f:
    f.write(json.dumps({'started_unix':started,'ended_unix':time.time(),'seconds':time.time()-started})+'\n')
print('All images rebuilt and checked. Original design-session notes remain in REPORT.md.')
