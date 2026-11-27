import { expect, test } from "bun:test";
import { storedZip } from "../../client/core/debug/zip.ts";
import { fakePort } from "../fixtures/debug-port.ts";

test("a ZIP reader recovers the client records and the numbered pictures intact", async () => {
  const picture = await fakePort().shot(32, 0.8).picture;
  const text = JSON.stringify({ note: "Miami at dusk ☾" });
  const utf8 = new TextEncoder(), jpeg = new Uint8Array(await (picture.blob as Blob).arrayBuffer());
  const zip = new Blob(storedZip([["report.json", utf8.encode(text)], ["events.json", utf8.encode("[]")], ["shot-01.jpg", jpeg]]));
  const read = Bun.spawnSync(["python3", "-c", [
    "import base64, io, json, sys, zipfile",
    "with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:",
    " assert z.testzip() is None",
    " print(json.dumps([z.namelist(), z.read('report.json').decode(), base64.b64encode(z.read('shot-01.jpg')).decode()]))",
  ].join("\n")], { stdin: new Uint8Array(await zip.arrayBuffer()) });
  expect(read.exitCode, read.stderr.toString()).toBe(0);
  expect(JSON.parse(read.stdout.toString())).toEqual([
    ["report.json", "events.json", "shot-01.jpg"], text, Buffer.from(jpeg).toString("base64"),
  ]);
});
