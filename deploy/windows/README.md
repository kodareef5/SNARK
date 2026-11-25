# Keeping a cluster running on Windows

`cluster.ps1` runs a cluster on one Windows machine with every world at a path of
one address, and keeps it running. It starts again whatever exits. It stops
every world the way that lets it save. With `install`, Windows starts it all at
boot. It needs Windows PowerShell 5.1, which every Windows Server since 2016
has, and Bun; nothing else is installed.

## The address

Each world is named by its map, and the map's name is its path:

| Address | What it is |
| --- | --- |
| `https://<host>/` | The start screen: every world running, how many play on each, and a link to each |
| `https://<host>/miami/` | The world on Miami, and every other world at its own map's name |
| `https://<host>/wiki/` | The wiki |
| `https://<host>/source/` | Where the source code link goes until `RepositoryUrl` names its home |

The map's name also names the world's save (`var/cluster/miami.db`), its map
file (`var/maps/miami.snmap`) and its logs (`var/logs/<cluster>/miami.*.log`).
Every world listens on `127.0.0.1` only, on a port of its own. `server/front.ts`
listens on one port, 8787, and sends each path to its world. So a tunnel or
proxy has one place to reach:

```text
browser -> tunnel or proxy -> front, 127.0.0.1:8787 -> /miami/...              -> Miami, 127.0.0.1:8798
                                                    -> /tampa/...              -> Tampa, 127.0.0.1:8799
                                                    -> /, /wiki/, /source/     -> any world
```

[Every world at one address](../../planning/reference/operators.md#every-world-at-one-address)
in the operator's guide says how the paths are answered.

## Set it up

From the repository's root, in PowerShell:

1. Build the client, each map the cluster runs, and the wiki:

   ```powershell
   bun run build
   bun tools/mapworld/build.ts miami --release      # and each other map in the cluster's file
   bun run wiki
   ```

2. Copy the example and change what differs: the cluster's id, the config
   folder, the worlds and their ports, the tunnel. `var` is not in git.

   ```powershell
   Copy-Item deploy\windows\cluster.example.psd1 var\cluster.psd1
   Set-Content var\admin-password.txt '<the password enablecheats asks for>'
   ```

3. Run it in the foreground, and open `http://127.0.0.1:8787/`. Ctrl+C stops it.

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File deploy\windows\cluster.ps1 run
   ```

4. Keep it running. In PowerShell run as an administrator:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File deploy\windows\cluster.ps1 install
   powershell -NoProfile -ExecutionPolicy Bypass -File deploy\windows\cluster.ps1 start
   ```

## Commands

`powershell -NoProfile -ExecutionPolicy Bypass -File deploy\windows\cluster.ps1 <command> [-Config <file>]`

| Command | Does |
| --- | --- |
| `run` | Starts the worlds, the front and the tunnel, and starts again whatever exits, until it is stopped. Stays in the foreground |
| `start` | Runs it in the background: through the scheduled task when it is installed, otherwise hidden until this user logs off. Waits until every world listens, then shows `status` |
| `stop` | Stops it. Every world saves and exits, then the front stops |
| `status` | Whether it runs and starts with Windows, and for each world its address, port, process, players and restarts. For a quick tunnel, its address |
| `install` | Registers the scheduled task `SNARK cluster <id>`, which runs `run` when Windows starts, as SYSTEM or as `-User <account>` |
| `uninstall` | Stops it and removes the task |

The cluster's file is `var\cluster.psd1`, or `cluster.example.psd1` while there
is none. `-Config` names another, and `install` keeps the name it is given.

## What it does

- **Starting.** The worlds start first, then the front, then the tunnel. A
  world whose map file is missing is left out, and the log says how to build
  it. A port already taken by something that is not this cluster stops it
  from starting, and the log names the process.
- **Starting again.** A program that exits is started again after 5 s. If it
  exits again within 10 minutes, the wait doubles each time, up to 5 minutes.
  A run of 10 minutes or more resets the wait to 5 s.
- **Stopping.** Each world gets Ctrl+C, as at a terminal (`send-ctrl.ps1`),
  and saves and exits. One still running after 60 s gets a console close. One
  still running 30 s after that is ended, and loses what it did since its last
  save. The worlds and the tunnel stop together, then the front.
- **Left over.** If a supervisor was ended without stopping its programs,
  the next `run` stops what it left before starting again. With no supervisor
  running, `stop` stops those programs. Only programs of the same cluster id
  count: another cluster's are left alone.
- **Secrets.** The admin password reaches only the worlds, as
  `SNARK_ADMIN_PASSWORD`, and the cluster's as `SNARK_CLUSTER_PASSWORD`. The tunnel's token reaches only the tunnel, as
  `TUNNEL_TOKEN`. Neither appears on a command line.
- **Logs.** All are in `var\logs\<cluster id>`. `cluster.log` records what
  started, what exited and when, and what was started again. Each program
  writes `<name>.out.log` and `<name>.err.log`, and `old\` keeps the logs of
  its last ten runs.

## Things worth knowing

- **Restarting Windows.** Run `cluster.ps1 stop` first. A shutdown is not a
  stop the worlds are known to save at. After the restart, the task starts
  the cluster again.
- **The task in Task Scheduler.** Do not end it there. Ending it ends every
  world at once, without saving. `cluster.ps1 stop` stops them the way they
  save, and then the task ends by itself.
- **The account.** The task runs as SYSTEM unless `install -User <account>`
  names another. SYSTEM is the whole machine: whoever may change the
  repository or `var\cluster.psd1` runs programs as it, and so would anyone who
  broke into a world. An account of its own is safer. It needs to read the
  repository and `bun.exe`, and to write `var\`. Bun installed for one user
  lives in that user's profile, which other accounts cannot read. Give `Bun`
  its whole path in the cluster's file either way, since a task does not see
  one user's `PATH`.
- **The tunnel.** A named Cloudflare tunnel sends its public hostname to the
  front, `http://127.0.0.1:8787`, with nothing else in front of the worlds. It
  can be the `Tunnel` entry of the cluster's file, or cloudflared's own Windows
  service (`cloudflared service install <token>`). A tunnel or proxy that
  routes by path can reach each world's port itself, and then needs no front.
  A quick tunnel gets a new address every time it starts.
- **The firewall.** Behind a tunnel, nothing needs to be opened. With
  `FrontHost = '0.0.0.0'`, players on the network reach the front directly, and
  the firewall must allow `FrontPort`.
- **Updating.** `cluster.ps1 stop`, then `git pull`, `bun run build`, the maps
  that changed and `bun run wiki`, then `cluster.ps1 start`. Players' pages wait
  the update out and come back by themselves. A change to the
  client alone needs no restart: the worlds read `client/dist` on every request.
