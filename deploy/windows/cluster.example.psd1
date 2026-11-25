# A SNARK cluster on one Windows machine, every world at a path of one address:
#
#   https://<host>/                the start screen: every world running, how many play on each
#   https://<host>/miami/          a world, at the path named by its map
#   https://<host>/tampa/          ...and every other world the same way
#   https://<host>/wiki/           the wiki (bun run wiki)
#   https://<host>/source/         where the source code link goes until RepositoryUrl names its home
#
# Each world listens on this machine only, on a port of its own. server/front.ts listens on FrontPort and sends each path
# to its world, so a tunnel or proxy needs to reach that one port. Copy this file to var\cluster.psd1 (var is ignored by
# git) and change it there; deploy\windows\cluster.ps1 reads var\cluster.psd1 when it is there, and this file when not.
# Paths are from the repository's root.
@{
  # Every world gives it as -clusterid; together they share the folder <SaveDir>\clusters\<ClusterId>.
  ClusterId = 'main'

  # bun.exe: a name on PATH, or the whole path to it. A scheduled task running as SYSTEM sees only the machine's PATH,
  # so give the whole path when bun was installed for one user.
  Bun = 'bun'

  # A folder of config\ (ARK's GameUserSettings.ini and Game.ini) every world starts from. Empty: the defaults, under which
  # everyone who joins has cheats. config/official gives nobody cheats without the password below.
  ServerConfig = 'config/official'

  # ARK's ?Key=Value and -Flag settings given to every world, such as '?MaxPlayers=70'.
  Settings = @()

  # Where each world keeps its save, <SaveDir>\<Map>.db, and where it reads its map, <MapDir>\<Map>.snmap
  # (bun tools/mapworld/build.ts <map> writes it there).
  SaveDir = 'var/cluster'
  MapDir  = 'var/maps'

  # The file whose one line is the password for enablecheats on every world. None: cheats are off.
  AdminPasswordFile = 'var/admin-password.txt'

  # The file whose one line is the cluster's password: every world takes it, and it stands above the admin password.
  # None: only the admin password is asked.
  ClusterPasswordFile = 'var/cluster-password.txt'

  # The front, which the tunnel or proxy points at. 127.0.0.1 keeps it to this machine; 0.0.0.0 opens it to the network.
  FrontHost = '127.0.0.1'
  FrontPort = 8787

  # The worlds. Each is reached at /<Map> unless it names a Path; Name is what the start screen and travel call it.
  Worlds = @(
    @{ Map = 'miami';         Name = 'Miami';         Port = 8798 }
    @{ Map = 'tampa';         Name = 'Tampa';         Port = 8799 }
    @{ Map = 'san-francisco'; Name = 'San Francisco'; Port = 8800 }
    @{ Map = 'las-vegas';     Name = 'Las Vegas';     Port = 8801 }
  )

  # A tunnel kept running with the rest, pointed at the front. Leave it out to run the tunnel some other way, such as
  # cloudflared's own Windows service (cloudflared service install <token>).
  #
  # A named Cloudflare tunnel whose public hostname sends everything to http://127.0.0.1:8787. Its token stays in a
  # file, and reaches cloudflared alone, as TUNNEL_TOKEN:
  #   Tunnel = @{ Command = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'; Arguments = 'tunnel --no-autoupdate run'; TokenFile = 'var/tunnel-token.txt' }
  #
  # A quick tunnel, for trying it out: a new random trycloudflare.com address every time it starts (cluster.ps1 status
  # shows it):
  #   Tunnel = @{ Command = 'cloudflared'; Arguments = 'tunnel --no-autoupdate --url http://127.0.0.1:8787' }
}
