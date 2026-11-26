// The map data stages' own rules (tools/mapdata), in their venv: what a place gets does not hang on the cut round it.

import { expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { python, test } from "../fixtures/needs-python.ts";

test("the groves' field at a place is the same whatever cut is made round it", () => {
  expect(python(`
import numpy as np
from fine import grove_field, threshold
a = grove_field(7, -1000.0, 2000.0, 600, 400)
b = grove_field(7, -877.0, 1923.0, 200, 100)
f = grove_field(7, 5000.0, 9000.0, 1000, 1000)
print(np.array_equal(a[77:177, 123:323], b), abs(float((f > threshold(7, 0.7)).mean()) - 0.3) < 0.03)
`).trim()).toBe("True True");
});

test("a split piece's id comes from what it is a piece of, and two alike take the next free", () => {
  expect(python(`
from split import Ids, SPLIT_BASE, SPLIT_SPAN
a, b = Ids(), Ids()
first = a.take('piece 12 345')
b.take('osm 99'); b.take('rest 1 2 3')
print(first == b.take('piece 12 345'), SPLIT_BASE <= first < SPLIT_BASE + SPLIT_SPAN)
c = Ids(); c.taken.add(first)
print(c.take('piece 12 345') == first + 1)
`).trim()).toBe("True True\nTrue");
});

test("a download is kept for the request it answered, and asked again for another", () => {
  const root = mkdtempSync(join(tmpdir(), "snark-fetch-"));
  try {
    expect(python(`
import json, pathlib, fetch
root = pathlib.Path(${JSON.stringify(root)})
(root / 'raw').mkdir()
class M: raw = root / 'raw'; root = root
asked = []
class R:
    def __init__(self, b): self.content = b
def get(url, params=None, data=None, accept=None):
    asked.append(params or data); return R(json.dumps(params or data).encode())
fetch.get = get
man = fetch.Manifest(M)
fetch.keep(M, man, 'a.tif', 'https://x/y', 's', 'l', params={'coverage': 'one'})
fetch.keep(M, man, 'a.tif', 'https://x/y', 's', 'l', params={'coverage': 'one'})
fetch.keep(M, man, 'a.tif', 'https://x/y', 's', 'l', params={'coverage': 'two'})
fetch.keep(M, man, 'q.json', 'https://one/api', 's', 'l', data={'data': 'Q'})
fetch.keep(M, man, 'q.json', 'https://two/api', 's', 'l', data={'data': 'Q'})
print(len(asked), json.loads((root / 'raw/a.tif').read_text())['coverage'], sorted(json.loads((root / 'downloads.json').read_text())))
`).trim()).toBe("3 two ['a.tif', 'q.json']");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a regional extract is recorded with its size and SHA-256", () => {
  const root = mkdtempSync(join(tmpdir(), "snark-extract-"));
  try {
    expect(python(`
import hashlib, json, pathlib, fetch, osm_local
root = pathlib.Path(${JSON.stringify(root)})
(root / 'raw').mkdir()
pbf = root / 'region-latest.osm.pbf'
pbf.write_bytes(b'x' * 5_000_001)
osm_local.region_file = lambda cache, region: pbf
osm_local.cut = lambda src, bounds, out: None
osm_local.answer = lambda area, names: {n: {'elements': []} for n in names}
class M:
    raw = root / 'raw'; root = root
    city = {'osm': {'extract': 'north-america/us/region', 'source': 's', 'licence': 'l'}}
    def lonlat_bounds(self, margin=0): return (0, 0, 1, 1)
man = fetch.Manifest(M)
fetch.osm_extract(M(), man, ['osm', 'ways'])
r = json.loads((root / 'downloads.json').read_text())['osm/extract']
print(r['bytes'], r['sha256'] == hashlib.sha256(pbf.read_bytes()).hexdigest())
`).trim().split("\n").at(-1)).toBe("5000001 True");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a water relation whose ring is drawn in several ways keeps its lake and its island", () => {
  expect(python(`
from common import relation_polygon
way = lambda pts: {'type': 'way', 'geometry': [{'lon': x, 'lat': y} for x, y in pts]}
outer = [way([(0, 0), (10, 0)]), way([(10, 0), (10, 10)]), way([(10, 10), (0, 10)]), way([(0, 10), (0, 0)])]
inner = [way([(4, 4), (6, 4), (6, 6)]), way([(6, 6), (4, 6), (4, 4)])]
g = relation_polygon([{**w, 'role': 'outer'} for w in outer] + [{**w, 'role': 'inner'} for w in inner], lambda x, y: (x, y))
print(round(g.area, 3), len(g.interiors))
`).trim()).toBe("96.0 1");
});
