#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
mkdir -p checks renders textures
blender --factory-startup -b -t 12 --python build_stations.py -- --station all --views all --resolution 1254 --samples 80 > checks/rebuild.log 2>&1
python3 finish_and_check.py > checks/rebuild_checks.log
python3 - <<'PY'
import json
from pathlib import Path
data=json.loads(Path('checks/measurements.json').read_text())
assert data['all_checks_pass'], 'Review checks/measurements.json: a dimensional check failed.'
print('Rebuilt all images. All dimensional and projection checks passed.')
PY
