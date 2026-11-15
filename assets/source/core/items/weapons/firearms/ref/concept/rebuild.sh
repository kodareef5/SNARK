#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p renders checks textures renders/cache
export TMPDIR="$PWD/renders"
export XDG_CACHE_HOME="$PWD/renders/cache"
blender -b -t 8 --python build.py > checks/rebuild_render.log 2>&1
python3 finish.py > checks/rebuild_checks.log
python3 audit_outputs.py > checks/rebuild_file_audit.log
