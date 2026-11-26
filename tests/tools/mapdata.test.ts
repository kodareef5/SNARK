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

test("a footprint split adds stands in the 2 m layer as in the 1 m, not only at its edge", () => {
  expect(python(`
import numpy as np
from affine import Affine
from shapely.geometry import box
from common import Map
from fine import coarse_buildings
class M: pass
m = M(); m.shape = (50, 50); m.grid = Affine(2, 0, 0, 0, -2, 100)
m.burn = lambda items, shape, tx=None: Map.burn(m, items, shape, tx)
fine = m.burn([(box(40, 40, 60, 60), 1)], (100, 100), Affine(1, 0, 0, 0, -1, 100))
a = coarse_buildings(m, [(box(40, 40, 60, 60), {})], fine)
print(int(a[25, 25]), int(fine[50, 50]), int(a.sum()) > 90, int(a[0].sum()))
`).trim()).toBe("1 1 True 0");
});
