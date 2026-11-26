#!/usr/bin/env bash
# A SNARK cluster on one Mac or Linux machine, every world at a path of one address, as deploy/windows/cluster.ps1
# runs one on Windows. Plain bash, down to the 3.2 a Mac ships: it was zsh, which a Linux machine seldom has.
#
#   deploy/mac/cluster.sh miami los-angeles            the worlds, the front on 127.0.0.1:8787
#   TUNNEL=quick deploy/mac/cluster.sh miami tampa     and a quick tunnel, whose address it prints
#   DEV=1 TUNNEL=quick deploy/mac/cluster.sh miami     development worlds: cheats need no password
#   FRONT_PORT=8786 deploy/mac/cluster.sh miami        the front on another port, where 8787 is taken
#   TUNNEL=https://<its address> deploy/mac/cluster.sh miami   a tunnel already running, so a restart keeps the address
#   MAPS=var/maps-game deploy/mac/cluster.sh miami     the maps read from another folder than var/maps
#
#   <host>/               the start screen: every world running, how many play on each
#   <host>/<map>/         a world, at the path named by its map
#   <host>/wiki/          the wiki (bun run wiki)
#
# Each world listens on this machine only, from port 8798 up in the order given, keeps its save in var/cluster/<map>.db
# and reads var/maps/<map>.snmap. Build first: bun run build, bun tools/mapworld/build.ts <map> for each, bun run wiki.
# The one line of var/admin-password.txt is each map's admin password, which enablecheats asks for; a map with a
# var/admin-password.<map>.txt has that one in its place. The one line of var/cluster-password.txt is the cluster's: every
# map takes it, and it stands above a map's own. With no such file cheats are off. That is
# config/official's way: a settings folder that leaves creative mode on, as config/dev does, gives everyone cheats as they join.
# With DEV=1 every world is a development server (--dev): enablecheats asks no password, so anyone who has the address
# can cheat, and a world takes a page only at this machine's own names or at the tunnel's, which it is told.
# CONFIG names the folder of settings every world starts from (config/official). Logs go to var/logs/<cluster>/.
# Ctrl+C stops the tunnel and the front, then every world the way that lets it save.
set -u
cd "$(cd "$(dirname "$0")" && pwd)/../.."
[ $# -ge 1 ] || { echo "usage: deploy/mac/cluster.sh <map> [<map>...]"; exit 2; }
[ -f client/dist/index.html ] || { echo "the client is not built: bun run build"; exit 1; }
[ -f client/dist/wiki/index.html ] || echo "/wiki/ is not found until bun run wiki builds it"
id=${CLUSTER:-main}
front=${FRONT_PORT:-8787}
maps=${MAPS:-var/maps}
logs=var/logs/$id
mkdir -p var/cluster "$logs"
[ -f var/admin-password.txt ] && export SNARK_ADMIN_PASSWORD="$(head -1 var/admin-password.txt)"
[ -f var/cluster-password.txt ] && export SNARK_CLUSTER_PASSWORD="$(head -1 var/cluster-password.txt)"
[ -f var/admin-password.txt ] || [ -f var/cluster-password.txt ] || [ -n "${DEV:-}" ] || echo "no var/admin-password.txt and no var/cluster-password.txt: enablecheats is refused on a world with no password file of its own"
worlds=()
others=()
address=
if [ "${TUNNEL:-}" = quick ]; then
  : > "$logs/tunnel.log"
  cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:$front" > "$logs/tunnel.log" 2>&1 &
  others+=($!)
  for n in {1..60}; do
    address=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$logs/tunnel.log" 2>/dev/null | tail -1)
    [ -n "$address" ] && break
    sleep 1
  done
elif [ -n "${TUNNEL:-}" ]; then
  address=$TUNNEL
fi
dev=()
[ -n "${DEV:-}" ] && dev=(--dev) && unset SNARK_ADMIN_PASSWORD SNARK_CLUSTER_PASSWORD
port=8798
for map in "$@"; do
  [ -f "$maps/$map.snmap" ] || { echo "$map left out: $maps/$map.snmap does not exist (bun tools/mapworld/build.ts $map)"; continue; }
  name=$(printf '%s\n' "$map" | tr - ' ' | awk '{ for (i = 1; i <= NF; i++) $i = toupper(substr($i, 1, 1)) substr($i, 2) } 1')
  own=${SNARK_ADMIN_PASSWORD:-}
  [ -z "${DEV:-}" ] && [ -f "var/admin-password.$map.txt" ] && own=$(head -1 "var/admin-password.$map.txt")
  # A development world is told the tunnel's host, since it takes a page at no other name but this machine's.
  SNARK_ADMIN_PASSWORD=$own bun server/main.ts --map "$maps/$map.snmap" --db "var/cluster/$map.db" --host 127.0.0.1 --port $port --public-url "${DEV:+$address}/$map" "-clusterid=$id" "?SessionName=$name" --config "${CONFIG:-config/official}" ${dev[@]+"${dev[@]}"} >"$logs/$map.log" 2>&1 &
  worlds+=($!)
  echo "$name at /$map/ on port $port, log $logs/$map.log"
  port=$((port + 1))
done
bun server/front.ts --cluster "var/cluster/clusters/$id" --host 127.0.0.1 --port "$front" > "$logs/front.log" 2>&1 &
others+=($!)
echo "the front at http://127.0.0.1:$front/"
[ -n "${TUNNEL:-}" ] && echo "the tunnel at ${address:-no address yet: see $logs/tunnel.log}"
stop() {
  # Every pid of each: an array's bare name in bash is its first element alone.
  kill "${others[@]}" 2>/dev/null
  kill -INT ${worlds[@]+"${worlds[@]}"} 2>/dev/null
  wait
  exit 0
}
trap stop INT TERM
wait
