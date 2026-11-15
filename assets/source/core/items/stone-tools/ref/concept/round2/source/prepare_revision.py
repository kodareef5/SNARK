"""Create an additive second-round workspace; preserve the original delivery."""
from pathlib import Path
import json, hashlib, shutil, datetime
R=Path(__file__).resolve().parents[1]; OLD=R.parent
if (R/'checks/original_files.json').exists():
    raise SystemExit('One-time snapshot already exists; use round2/rebuild.sh to rebuild the final revision.')
manifest={str(p.relative_to(OLD)):hashlib.sha256(p.read_bytes()).hexdigest() for p in OLD.rglob('*') if p.is_file() and R not in p.parents and 'cache' not in p.parts and not any(s.startswith('.git') for s in p.parts)}
(R/'checks/original_files.json').write_text(json.dumps(manifest,indent=2))
(R/'checks/original_REPORT.md').write_bytes((OLD/'REPORT.md').read_bytes())
(R/'checks/started.json').write_text(json.dumps({'started':'2026-11-15T15:37:30+00:00'}))
for p in (OLD/'source').glob('*.py'):
    if p.name!='write_report.py':shutil.copy2(p,R/'source'/p.name)
for p in (OLD/'textures').iterdir():
    if p.is_file():shutil.copy2(p,R/'textures'/p.name)
shutil.copy2(OLD/'rebuild.sh',R/'rebuild.sh')
