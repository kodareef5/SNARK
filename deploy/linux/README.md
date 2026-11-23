# A test world on a Linux machine

A world on a real map, kept on a machine for testing and showing work, reached from anywhere through a free
Cloudflare quick tunnel. pm2 keeps the processes; `test.sh` drives them. The world is off unless it is being used,
and the tunnel stays up, so its address does not change between uses.

```sh
deploy/linux/test.sh build     # the client, and var/maps/miami.snmap from its kit
deploy/linux/test.sh up        # prints https://….trycloudflare.com: the start screen; the world is at /miami/
deploy/linux/test.sh down      # the world saves and stops; the tunnel and its address stay
```

`test.sh url`, `status` and `logs` say where it is and what it said; `tunnel-down` stops the tunnel as well, and the
next `up` has a new address.

## What runs

| pm2 process | Is | Runs |
| --- | --- | --- |
| `snark-test-tunnel` | `cloudflared tunnel --url http://127.0.0.1:8780`: no account, an address that lasts until the process restarts | always |
| `snark-test` | `deploy/mac/cluster.sh miami`: the front on 127.0.0.1:8780, the world on 8798, saves in `var/cluster/`, logs in `var/logs/test/` | when testing |

Both are in `test.config.cjs`. `SNARK_TEST_MAPS` names other maps (`miami,tampa`), `FRONT_PORT` another port,
`CONFIG` another settings folder; the default is `config/dev`, whose rates make taming and raising quick. The
world is a real server, not a development one (`--dev`), and the tunnel is public. `config/dev` leaves creative mode
on, as a server does unless told not to, so everyone who joins has cheats; under `CONFIG=config/official`, `enablecheats`
asks the password in `var/admin-password.txt`, which `up` makes the first time.

The world runs the checkout it is in, as built. After pulling or changing branch, `test.sh build` again, then
`down` and `up`. Players' pages wait the restart out and come back by themselves.

## Before the first build

The painted game and the map's kit come from the public releases:

```sh
bun install --frozen-lockfile
bun run media art              # every art archive, about 3.7 GiB
bun run media kit miami        # the city's prepared kit; test.sh build then makes its map with Bun alone
```

## Worth knowing

- A quick tunnel has no uptime promise, and its address changes when `cloudflared` restarts: after a reboot, a crash,
  or `tunnel-down`. pm2 is not set to start at boot here, so after a reboot `up` brings both back, with a new address.
- Anyone with the address can play. A fixed address, or one only some people can open, needs a Cloudflare account
  with a domain (a named tunnel, and Cloudflare Access in front of it).
- The tunnel's connector runs on this machine, so the server takes each survivor's own address from
  `X-Forwarded-For` (`planning/reference/operators.md`).
