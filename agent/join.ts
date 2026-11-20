// Joining a server as a survivor, as a browser does: the clips' hash from its asset manifest, its map read whole, and
// a session that says hello with the name and the key that owns it. agent/main.ts and agent/gateway.ts both join so.

import { ClientSession } from "../client/core/session.ts";
import { fetchMapFile } from "../client/core/fetched.ts";
import { defaultLook } from "../shared/anim/look.ts";
import type { Registry } from "../shared/content/registry.ts";
import { withContent } from "../shared/content/registry.ts";
import { parseManifest } from "../shared/pack/manifest.ts";
import { CityStatics } from "../shared/world/city.ts";
import { mapHeightfield, mapNodes, parseMap } from "../shared/world/mapfile.ts";
import { fileUrl } from "./main.ts";
import { connect } from "./socket.ts";

export async function joinServer(url: string, name: string, key: Uint8Array, reg: Registry, ticket: Uint8Array | null = null): Promise<ClientSession> {
  const get = async (file: string): Promise<Response> => {
    const res = await fetch(fileUrl(url, file));
    if (!res.ok) throw new Error(`asked for ${file} and got ${res.status}`);
    return res;
  };
  // The server poses bodies with the clips of the pack it serves, and wants the same of whoever joins.
  const clipHash = parseManifest(await (await get("assets/manifest.json")).text()).clipHash;
  // It names its map's head, whose parts hold the ground and where the trees and rocks stand: read whole, as one file.
  const named = (await (await get("map.json")).json()) as { head: string };
  const map = parseMap(await fetchMapFile(get, named.head));
  const hf = mapHeightfield(map);
  return new ClientSession(connect(url), {
    name,
    key,
    // A map's landmarks bring definitions of their own, compiled after the core's as the server's are.
    registry: withContent(reg, map.content?.defs ?? []),
    clipHash,
    look: defaultLook(),
    password: process.env.SNARK_PASSWORD ?? "",
    ...(ticket ? { ticket } : {}),
    resolveMap: (id, hash) => (id === map.id && hash === map.hash ? hf : null),
    nodes: (ground, content) => mapNodes(map, ground, content),
    // The map's own pieces everywhere, as a browser has them for its far city: the skyline a flight keeps over.
    city: (content) => new CityStatics(map.dims, map.statics, content),
    statics: map.statics,
  });
}
