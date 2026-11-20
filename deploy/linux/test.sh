#!/usr/bin/env bash
# A test world on this machine, behind a free Cloudflare quick tunnel, under pm2 (deploy/linux/README.md).
#
#   deploy/linux/test.sh build      the client and each test map (SNARK_TEST_MAPS, miami by default)
#   deploy/linux/test.sh up         the tunnel if it is not running, then the world; prints the address
#   deploy/linux/test.sh down       the world stops and saves; the tunnel keeps running, so the address stays
#   deploy/linux/test.sh url        the tunnel's address
#   deploy/linux/test.sh status     both processes, and the address
#   deploy/linux/test.sh logs       the end of each world's log and the front's
#   deploy/linux/test.sh tunnel-down   the tunnel too: the next `up` has a new address
set -eu
cd "$(cd "$(dirname "$0")" && pwd)/../.."
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"
config=deploy/linux/test.config.cjs
maps=${SNARK_TEST_MAPS:-miami}

registered() { pm2 describe "$1" >/dev/null 2>&1; }
online() { local pid; pid=$(pm2 pid "$1" 2>/dev/null); [ -n "$pid" ] && [ "$pid" != 0 ]; }
url() { pm2 logs snark-test-tunnel --nostream --lines 400 2>/dev/null | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1; }

case "${1:-status}" in
  build)
    mkdir -p var && touch var/.test-build-start
    if ! bun run build; then
      # The build reports its size budgets after it writes the client; a miss there still leaves a client to test.
      [ client/dist/index.html -nt var/.test-build-start ] || exit 1
      echo "bun run build reported problems (above), but wrote the client: the test uses it"
    fi
    for map in ${maps//,/ }; do
      if [ -f "var/maps/$map.snmap" ]; then echo "var/maps/$map.snmap is built; rm it to build it again"
      else bun tools/maps/city.ts "$map"; fi
    done
    ;;
  up)
    [ -f client/dist/index.html ] || { echo "the client is not built: deploy/linux/test.sh build"; exit 1; }
    [ -f var/admin-password.txt ] || { head -c 18 /dev/urandom | base64 | tr -d '/+=' > var/admin-password.txt; chmod 600 var/admin-password.txt
      echo "made var/admin-password.txt: the password enablecheats asks for"; }
    online snark-test-tunnel || pm2 start "$config" --only snark-test-tunnel >/dev/null
    online snark-test || pm2 start "$config" --only snark-test >/dev/null
    for _ in $(seq 30); do a=$(url); [ -n "$a" ] && break; sleep 1; done
    echo "the world is starting: ${a:-no tunnel address yet (deploy/linux/test.sh url)}/ (a map takes a minute to load)"
    ;;
  down)
    registered snark-test && pm2 stop snark-test >/dev/null && echo "the world is stopped and saved; the tunnel keeps its address"
    ;;
  tunnel-down)
    registered snark-test-tunnel && pm2 stop snark-test-tunnel >/dev/null && echo "the tunnel is stopped: the next up has a new address"
    ;;
  url)
    url
    ;;
  status)
    pm2 ls | grep -E 'name|snark-test' || echo "not registered: deploy/linux/test.sh up"
    echo "address: $(url)"
    ;;
  logs)
    for f in var/logs/test/*.log; do [ -f "$f" ] && { echo "== $f"; tail -n 20 "$f"; }; done
    ;;
  *)
    sed -n '2,12p' "$0"; exit 2
    ;;
esac
