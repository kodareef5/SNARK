#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ ! -x sources/round4/imageio ]; then
  swiftc -O -module-cache-path sources/round4/.module-cache round4_imageio.swift -o sources/round4/imageio
fi
node build_round4.mjs all
# The audit compares against round 3's measurements in checks/, which the repo does not keep; it runs where they exist.
if [ -d checks/round3_archive ]; then
  python3 verify_round4.py > checks/audit_log.txt
  node review_round4.mjs
fi
