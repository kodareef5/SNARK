import { MAX_WORLD_ID } from "../../shared/ids.ts";
import type { AdminAddress, ClusterSiteWorld } from "../core/admin/cluster.ts";

export function worldAdminAddress(world: ClusterSiteWorld, origin: string): AdminAddress | null {
  try {
    const address = new URL(world.address, origin);
    if (!/^https?:$/.test(address.protocol) || address.username || address.password || address.search || address.hash) return null;
    if (!address.pathname.endsWith("/")) address.pathname += "/";
    const api = new URL("admin/", address).href;
    if (address.origin !== origin) return { link: api, api: null, publicBase: null };
    const id = world.id ?? (address.pathname === "/" ? "local" : undefined);
    if (id !== undefined && id !== "local" && (!Number.isInteger(id) || id < 1 || id > MAX_WORLD_ID)) return null;
    const link = id === undefined ? api : new URL(`/admin/worlds/${id}/map/`, origin).href;
    return { link, api, publicBase: address.href };
  } catch {
    return null;
  }
}
