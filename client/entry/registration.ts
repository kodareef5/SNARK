import { button, esc, field } from "./forms.ts";
export interface Listing {
  address: string;
  name: string;
  map: string;
  mapId: string;
  players: number;
  max: number;
  password: boolean;
  online: boolean;
}
export async function directoryRows(url: string): Promise<Listing[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw Error("Directory unavailable");
  const rows = await res.json();
  return Array.isArray(rows)
    ? rows.filter((w) => {
        try {
          return ["http:", "https:"].includes(new URL(w.address).protocol) && typeof w.name === "string" && typeof w.map === "string";
        } catch {
          return false;
        }
      })
    : [];
}
let address = "",
  ticket = "",
  txt = "",
  record = "",
  token = "",
  message = "";
let settings = { name: "", map: "", listed: true, password: false },
  removePending = false;
function clean() {
  ticket = token = message = address = "";
  removePending = false;
  settings = { name: "", map: "", listed: true, password: false };
}

export function directoryView() {
  if (ticket)
    return (
      "<p>Publish this DNS TXT record to verify ownership of your server.</p><p>" +
      esc(record) +
      '</p><output class="code">' +
      esc(txt) +
      "</output>" +
      button("registry-verify", "Check DNS record", "primary")
    );
  if (token)
    return (
      "<p>" +
      esc(address) +
      '</p><p>Save your management token before leaving.</p><output class="code">' +
      esc(token) +
      "</output>" +
      field("listing-name", "Server name", settings.name) +
      field("listing-map", "Map", settings.map) +
      '<label><input type="checkbox" id="public-list" ' +
      (settings.listed ? "checked" : "") +
      '> Show in search</label><label><input type="checkbox" id="locked-list" ' +
      (settings.password ? "checked" : "") +
      "> Password required</label>" +
      button("registry-save", "Save listing", "primary") +
      button("registry-remove", removePending ? "Confirm removal" : "Remove listing", "quiet") +
      button("registry-done", "Done", "quiet") +
      '<p role="status">' +
      esc(message) +
      "</p>"
    );
  return (
    field("listing-address", "Public server address", address, 'placeholder="https://play.example.org/miami/"') +
    button("registry-claim", "Verify ownership", "primary") +
    field("listing-token", "Existing management token", "", 'type="password"') +
    button("registry-manage", "Manage existing listing")
  );
}
export async function directoryAction(action: string, url: string, input: (id: string) => string) {
  if (action === "registry-done") {
    clean();
    return;
  }
  if (action === "registry-remove" && !removePending) {
    removePending = true;
    message = "Confirm to remove this directory listing.";
    return;
  }
  if (action === "registry-claim" || action === "registry-manage") address = input("listing-address").trim();
  if (action === "registry-manage") {
    token = input("listing-token").trim();
    if (!token) throw Error("Enter your saved token.");
  }
  const op: Record<string, string> = {
    "registry-manage": "manage",
    "registry-claim": "claim",
    "registry-verify": "verify",
    "registry-save": "update",
    "registry-remove": "remove",
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: op[action],
      address,
      token,
      ticket,
      name: input("listing-name"),
      map: input("listing-map"),
      listed: document.querySelector<HTMLInputElement>("#public-list")?.checked,
      password: document.querySelector<HTMLInputElement>("#locked-list")?.checked,
    }),
    signal: AbortSignal.timeout(12000),
  });
  const r = await res.json();
  if (!res.ok) {
    if (action === "registry-manage") token = "";
    throw Error(r.error || "Directory unavailable");
  }
  if (action === "registry-manage") settings = r;
  if (r.ticket) {
    ticket = r.ticket;
    txt = r.txt;
    record = r.record;
  }
  if (r.token) {
    token = r.token;
    ticket = "";
  }
  if (action === "registry-save") {
    settings = {
      name: input("listing-name"),
      map: input("listing-map"),
      listed: !!document.querySelector<HTMLInputElement>("#public-list")?.checked,
      password: !!document.querySelector<HTMLInputElement>("#locked-list")?.checked,
    };
    message = "Saved. Invite players with " + new URL("?screen=roster", address.replace(/\/?$/, "/")).href;
  }
  if (action === "registry-remove") clean();
}
