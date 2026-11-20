// pm2's processes for a test world on this machine behind a free Cloudflare quick tunnel (deploy/linux/README.md).
// deploy/linux/test.sh drives them. `pm2 start` on this file with no `--only` starts both; test.sh starts each alone.
//
// snark-test-tunnel  the quick tunnel to the front. It is meant to keep running while the world is off, so that its
//                    address (https://….trycloudflare.com, in its log) stays the same until it restarts.
// snark-test         deploy/mac/cluster.sh with the test's maps: a front on 127.0.0.1, a world for each map. test.sh
//                    starts it only to test or show something (`--only`), and pm2 leaves a stopped process stopped.
//                    (pm2 keeps a process with autostart false from starting even when it is started by name.)
const { join } = require("node:path");

const ROOT = join(__dirname, "../..");
const FRONT = process.env.FRONT_PORT || "8780";
const MAPS = (process.env.SNARK_TEST_MAPS || "miami").split(/[\s,]+/).filter(Boolean);
// pm2's daemon has the PATH of the shell that first started it; Bun and cloudflared may live in a user's own bin.
const PATH = [join(process.env.HOME || "", ".bun/bin"), join(process.env.HOME || "", ".local/bin"), process.env.PATH].join(":");

module.exports = {
  apps: [
    {
      name: "snark-test-tunnel",
      script: "cloudflared",
      args: ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${FRONT}`],
      interpreter: "none",
      env: { PATH },
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
    },
    {
      name: "snark-test",
      cwd: ROOT,
      script: "deploy/mac/cluster.sh",
      args: MAPS,
      interpreter: "bash",
      // A real world, not a development one: cheats ask var/admin-password.txt's password, since the tunnel is public.
      env: { PATH, CLUSTER: "test", FRONT_PORT: FRONT, CONFIG: process.env.CONFIG || "config/dev" },
      autorestart: false,
      // cluster.sh lets each world save when it is told to stop; pm2 waits this long before it kills.
      kill_timeout: 60000,
    },
  ],
};
