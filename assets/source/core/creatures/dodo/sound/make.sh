#!/bin/sh
# Remake every accepted dodo take from recipes.json with tools/sound and compare it with the kept file.
# Needs tools/sound/setup.sh once. The candidates themselves come from:
#   tools/sound/.venv/bin/python tools/sound/generate.py assets/source/core/creatures/dodo/sound/brief.json
set -e
cd "$(dirname "$0")/../../../../../.."
exec tools/sound/.venv/bin/python tools/sound/remake.py assets/source/core/creatures/dodo/sound "$@"
