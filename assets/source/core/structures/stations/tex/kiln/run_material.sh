#!/usr/bin/env bash
# Use the normal interpreter when dependencies are installed. This workstation's
# system Python lacks SciPy; its existing read-only 3.13 wheel cache is a fallback.
set -euo pipefail
cd -- "$(dirname -- "$0")"
export PYTHONDONTWRITEBYTECODE=1
if python3 -c 'import numpy, scipy, PIL' 2>/dev/null; then
    exec python3 "$@"
fi
KILN_CACHE=/home/user/.cache/uv/archive-v0
export PYTHONPATH="$KILN_CACHE/7ZZUcka-GOFOHzIv:$KILN_CACHE/1sfcstuJeRVF79K2:$KILN_CACHE/foBAIccdpapW5CvV"
exec /home/user/.local/share/uv/python/cpython-3.13-linux-x86_64-gnu/bin/python3 "$@"
