"""The registered layers of base/ from a map's downloads, as tools/mapart/prepare.py made Miami's, with the city's own
county, elevation tiles and rules from city.json: clipped vectors in the local projection, 2 m vertex samples of height,
water, roads, footprints and land cover, and the authored succession and drowned streets. Nothing inferred is called
surveyed. python tools/mapdata/prepare.py <map folder>"""
import json
import math
import sys
import time
import zipfile
from pathlib import Path
import numpy as np
import rasterio
import shapefile
from pyproj import Transformer
from rasterio.warp import Resampling, reproject, transform_bounds
from rasterio.windows import Window, transform as win_transform
from scipy import ndimage as nd
from shapely import make_valid
from shapely.geometry import Polygon, box, shape
from shapely.ops import transform as project, unary_union

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import folder_arg, save  # noqa: E402

HIGHWAY = ('S1100', 'S1200')
# An airfield's paving in roads.png: no street, and no street's wrecks.
PAVED = 6
# Census water by its feature class, as the perched layer names it.
TIGER_WATER = {'H2030': 'lake or pond', 'H2040': 'reservoir', 'H2041': 'treatment pond', 'H2051': 'bay', 'H2053': 'ocean',
               'H3010': 'stream', 'H3013': 'braided stream', 'H3020': 'canal'}
GRASS_LIKE = [21, 31, 41, 42, 43, 52, 71, 90, 95]
# An airfield's paving where OpenStreetMap gives no width: ICAO's common runway and taxiway widths.
AEROWAY_WIDTH_M = {'runway': 45, 'taxiway': 23}


def osm_features(m):
    path = m.raw / 'osm/features.json'
    if not path.exists():
        return []
    to_map = Transformer.from_crs(4326, m.crs, always_xy=True).transform
    clip = box(*m.b)
    out = []
    for el in json.loads(path.read_text())['elements']:
        t = el.get('tags', {})
        if el['type'] == 'way' and el.get('geometry'):
            pts = [to_map(p['lon'], p['lat']) for p in el['geometry']]
            closed = len(pts) >= 4 and pts[0] == pts[-1]
            g = make_valid(Polygon(pts)) if closed else None
            if not closed and len(pts) >= 2:
                from shapely.geometry import LineString
                g = LineString(pts)
        elif el['type'] == 'relation' and el.get('members'):
            outers = [Polygon([to_map(p['lon'], p['lat']) for p in mb['geometry']]) for mb in el['members']
                      if mb.get('role') == 'outer' and mb.get('geometry') and len(mb['geometry']) >= 4 and mb['geometry'][0] == mb['geometry'][-1]]
            inners = [Polygon([to_map(p['lon'], p['lat']) for p in mb['geometry']]) for mb in el['members']
                      if mb.get('role') == 'inner' and mb.get('geometry') and len(mb['geometry']) >= 4 and mb['geometry'][0] == mb['geometry'][-1]]
            if not outers:
                continue
            g = unary_union([make_valid(p) for p in outers])
            if inners:
                g = g.difference(unary_union([make_valid(p) for p in inners]))
        else:
            continue
        g = g.intersection(clip)
        if not g.is_empty:
            out.append((g, el['type'], el['id'], t))
    return out


def osm_water(m, features, tiger_water):
    """Water OpenStreetMap maps on the ground that TIGER does not: fountains, pools, ponds, lagoons, basins. A pool on a
    roof or a deck, indoors or on an upper level is left out; one that is dry most of the year is listed and not burnt."""
    from shapely.strtree import STRtree
    wet = STRtree([g for g, _ in tiger_water])
    out = []
    for g, kind_el, oid, t in features:
        if not (t.get('natural') == 'water' or 'water' in t or t.get('leisure') in ('swimming_pool', 'hot_tub') or t.get('amenity') == 'fountain'):
            continue
        if g.geom_type not in ('Polygon', 'MultiPolygon') or g.area < 8:
            continue
        layer = t.get('layer', '0')
        if t.get('location') in ('roof', 'rooftop', 'indoor', 'underground') or t.get('indoor') == 'yes' or t.get('swimming_pool') == 'above' \
                or (t.get('level') or '0').lstrip('-').split(';')[0] not in ('0', '') or (layer.lstrip('-').isdigit() and int(layer) != 0):
            continue
        if any(tiger_water[i][0].intersection(g).area > .5 * g.area for i in wet.query(g)):
            continue
        kind = 'fountain' if t.get('amenity') == 'fountain' or t.get('water') == 'fountain' else \
            'pool' if t.get('leisure') in ('swimming_pool', 'hot_tub') else t.get('water') or 'pond'
        out.append((g, {'id': f'osm:{kind_el}/{oid}', 'source': 'OpenStreetMap', 'name': t.get('name'), 'kind': kind,
                        'intermittent': t.get('intermittent') == 'yes' or t.get('seasonal') == 'yes'}))
    return out


def osm_paved(m, features):
    """An airfield's runways, taxiways, aprons and helipads, as OpenStreetMap draws them: paved like a highway."""
    out = []
    for g, kind_el, oid, t in features:
        a = t.get('aeroway')
        if a not in ('runway', 'taxiway', 'apron', 'helipad'):
            continue
        if g.geom_type in ('LineString', 'MultiLineString'):
            width = None
            try:
                width = float((t.get('width') or '').split()[0])
            except (ValueError, IndexError):
                pass
            g = g.buffer((width or AEROWAY_WIDTH_M.get(a, 15)) / 2, cap_style=2, join_style=2)
        if g.is_empty or g.area < 8:
            continue
        out.append((g, {'id': f'osm:{kind_el}/{oid}', 'aeroway': a, 'name': t.get('name') or t.get('ref')}))
    return out


def tiger(m, name):
    t = m.city['tiger']
    to_map = Transformer.from_crs(4269, m.crs, always_xy=True).transform
    bbox = Transformer.from_crs(m.crs, 4269, always_xy=True).transform_bounds(*m.b)
    clip = box(*m.b)
    widths = m.city['roads']['widths_m']
    features, seen = [], set()
    # A frame may span counties; a line on a county boundary is in both files under one id.
    for county in t.get('counties') or [t['county']]:
        path = m.raw / f"tl_{t['year']}_{county}_{name}.zip"
        out = m.raw / 'tiger'
        with zipfile.ZipFile(path) as z:
            z.extractall(out)
        reader = shapefile.Reader(str(out / path.stem))
        fields = [f[0] for f in reader.fields[1:]]
        for sr in reader.iterShapeRecords(bbox=bbox):
            g = project(to_map, make_valid(shape(sr.shape.__geo_interface__))).intersection(clip)
            if g.is_empty:
                continue
            p = dict(zip(fields, sr.record))
            if name == 'roads':
                # Cartographic corridor widths for the game, not measured road edges.
                code = p['MTFCC']
                p = {'id': str(p['LINEARID']), 'mtfcc': code, 'name': p.get('FULLNAME'),
                     'width_m': widths.get(code, m.city['roads']['other_width_m'])}
            else:
                p = {'id': str(p['HYDROID']), 'mtfcc': p['MTFCC'], 'name': p.get('FULLNAME')}
            if p['id'] in seen:
                continue
            seen.add(p['id'])
            features.append((g, p))
    m.write_features(name, features)
    print(name, len(features), flush=True)
    return features


def buildings(m):
    from_wgs = Transformer.from_crs(4326, m.crs, always_xy=True).transform
    clip = box(*m.b)
    features, ids = [], []
    for path in sorted((m.raw / 'fema').glob('page_*.json')):
        for f in json.loads(path.read_text())['features']:
            oid = f['attributes']['OBJECTID']
            ids.append(oid)
            # Esri rings: clockwise shells, counterclockwise holes.
            shells, holes = [], []
            for ring in f['geometry']['rings']:
                p = Polygon(ring)
                (holes if p.exterior.is_ccw else shells).append(p)
            if not shells:
                shells, holes = holes, []
            g = unary_union([make_valid(p) for p in shells])
            if holes:
                g = g.difference(unary_union([make_valid(p) for p in holes]))
            g = project(from_wgs, g).intersection(clip)
            if not g.is_empty:
                features.append((g, {'id': oid}))
    expected = json.loads((m.raw / 'fema/ids.json').read_text())['objectIds']
    assert set(ids) == set(expected) and len(ids) == len(set(ids)), 'missing or duplicate footprints'
    m.write_features('buildings', features)
    print('buildings', len(features), flush=True)
    return features


def elevation(m):
    n = m.n
    out = np.full((n, n), -9999, dtype=np.float32)
    tiles = json.loads((m.root / 'dem_selection.json').read_text())
    for i, t in enumerate(tiles):
        scale = t.get('z_to_m', m.city['dem']['z_to_m'])
        with rasterio.open(m.raw / 'dem' / t['name']) as src:
            b = transform_bounds(src.crs, m.crs, *src.bounds, densify_pts=21)
            c0 = max(0, math.floor((b[0] - m.grid.c) / 2) - 2)
            c1 = min(n, math.ceil((b[2] - m.grid.c) / 2) + 2)
            r0 = max(0, math.floor((m.grid.f - b[3]) / 2) - 2)
            r1 = min(n, math.ceil((m.grid.f - b[1]) / 2) + 2)
            if c0 >= c1 or r0 >= r1:
                continue
            dst = np.full((r1 - r0, c1 - c0), -9999, dtype=np.float32)
            reproject(rasterio.band(src, 1), dst, src_transform=src.transform, src_crs=src.crs, src_nodata=src.nodata,
                      dst_transform=win_transform(Window(c0, r0, c1 - c0, r1 - r0), m.grid), dst_crs=m.crs,
                      dst_nodata=-9999, resampling=Resampling.bilinear)
            good = dst != -9999
            if t.get('fill'):
                good &= out[r0:r1, c0:c1] == -9999
            out[r0:r1, c0:c1][good] = dst[good] * scale
        if i % 20 == 0:
            print('height', i, '/', len(tiles), flush=True)
    return out


def main():
    m = folder_arg()
    t = time.time()
    n = m.n
    water = tiger(m, 'areawater')
    roads = tiger(m, 'roads')
    bld = buildings(m)
    elev = elevation(m)
    valid = elev != -9999
    elev[~valid] = -1  # an engine convention for missing ground, not measured bathymetry
    # The engine's water is one sea. A lake whose hydro-flattened lidar surface stands more than perched_above_sea_m over
    # the city's sea is left out of it, as a flat marsh at its surface, until water can stand above the sea.
    sea = m.city.get('world', {}).get('seaNavd88', .3)
    above = m.city['succession'].get('perched_above_sea_m', 2)
    perched, sea_water = [], []
    features = osm_features(m)
    for g, p in water:
        mask = m.burn([(g, 1)], n, m.grid) > 0
        surveyed = mask & valid
        if surveyed.sum() >= .5 * max(1, mask.sum()) and float(np.median(elev[surveyed])) > sea + above:
            perched.append((g, {**p, 'kind': TIGER_WATER.get(p['mtfcc'], 'water')} if features else p, float(np.median(elev[surveyed]))))
        else:
            sea_water.append((g, p))
    for g, p in osm_water(m, features, water):
        # A pool's lidar surface may be interpolated across it; the median of what the survey has there stands for it.
        mask = m.burn([(g, 1)], n, m.grid) > 0
        surveyed = mask & valid
        if not surveyed.any():
            mask = m.burn([(g.buffer(4), 1)], n, m.grid) > 0
            surveyed = mask & valid
        if surveyed.any() and float(np.median(elev[surveyed])) > sea + above:
            perched.append((g, {**p, 'area_m2': round(g.area, 1)}, float(np.median(elev[surveyed]))))
    m.write_features('perched_water', [(g, {**p, 'surface_navd88_m': round(h, 2), 'above_sea_m': round(h - sea, 2)}) for g, p, h in perched])
    # Water that is dry most of the year, a detention basin or a wash, is listed and left as the ground it is.
    lake = m.burn([(g, 1) for g, p, h in perched if not p.get('intermittent')], n, m.grid)
    save(lake, m.base / 'perched_water.png')
    water = sea_water
    m.write_features('areawater', water)
    w = m.burn([(g, 1) for g, p in water], n, m.grid)
    b = m.burn([(g, 1) for g, p in bld], n, m.grid)
    paved = osm_paved(m, features)
    if paved:
        m.write_features('paved', paved)
    rd = m.burn([(g, PAVED) for g, p in paved] + [(g.buffer(p['width_m'] / 2, cap_style=2, join_style=2), 2 if p['mtfcc'] in HIGHWAY else 1)
                 for g, p in sorted(roads, key=lambda gp: gp[1]['width_m'])], n, m.grid)
    rd[(rd > 0) & (w > 0)] = 3  # a bridge over the water, which stays beneath it
    zero = m.cfg.get('height_zero_m', -100)
    if elev[valid].max() > zero + 655.35 or elev[valid].min() < zero:
        raise SystemExit(f'ground from {elev[valid].min():.1f} to {elev[valid].max():.1f} m does not fit height.png over {zero} m: set height_zero_m')
    save(np.rint(np.clip((elev - zero) * 100, 0, 65535)).astype('uint16'), m.base / 'height.png')
    save(valid.astype('uint8') * 255, m.base / 'height_valid.png')
    save(w, m.base / 'water.png')
    save(b, m.base / 'buildings.png')
    save(rd, m.base / 'roads.png')
    lc = np.zeros((n, n), np.uint8)
    with rasterio.open(m.raw / m.city['nlcd']['file']) as src:
        reproject(rasterio.band(src, 1), lc, src_transform=src.transform, src_crs=src.crs,
                  dst_transform=m.grid, dst_crs=m.crs, resampling=Resampling.nearest)
    save(lc, m.base / 'landcover.png')
    # Fictional succession, the rule Miami's was made by; distinct from NLCD.
    coast = nd.distance_transform_edt(w == 0) * 2 if w.any() else np.full((n, n), np.inf, np.float32)
    # A desert city names the land cover that stays dry (barren, shrub and scrub): it is desert, not grown green.
    dry = m.city['succession'].get('dry_classes') or []
    grown = np.isin(lc, [c for c in GRASS_LIKE if c not in dry]) | ((lc == 22) & (coast < 180))
    grown = nd.gaussian_filter(grown.astype('float32'), 4) > .48
    yy, xx = np.mgrid[:n, :n].astype(np.float32)
    field = np.sin(xx / 47 + .7 * np.sin(yy / 83)) + np.cos(yy / 61 - xx / 103)
    near_ruin = nd.distance_transform_edt(b == 0) * 2 < 18
    away_road = nd.distance_transform_edt(rd == 0) * 2 > 6
    # Miami's heights, 6 m and 0.75 m NAVD88 over its sea of 0.3 m, are taken over each city's own sea.
    rise = elev - sea
    grown |= near_ruin & away_road & (b == 0) & (w == 0) & (rise < 5.7) & (field > -.25)
    biome = np.full((n, n), 2, np.uint8)
    biome[grown] = 3
    biome[grown & (coast < 70)] = 4
    biome[grown & (rise < .45) & (coast < 140)] = 5
    biome[lake > 0] = 5
    if dry:
        biome[(biome == 2) & (nd.gaussian_filter(np.isin(lc, dry).astype('float32'), 4) > .48)] = 10
    # Barren land is beach by the water; inland it is bare ground (a ridge, a quarry, a lot being built on).
    beach = (lc == 31) & (coast < 500)
    ribbon = m.city['succession'].get('sand_ribbon')
    if ribbon:
        # An authored strip of bare sand east of a given easting, as Miami Beach's.
        xs = np.arange(n) * 2 + m.b[0]
        beach |= (xs[None, :] > ribbon['east_of_m']) & (coast < ribbon['coast_m']) & (elev < ribbon['below_m'])
    biome[beach] = 6
    biome[b > 0] = 7
    biome[rd > 0] = 8
    biome[w > 0] = 1
    biome[rd == 3] = 9
    save(biome, m.base / 'biome.png')
    s = m.city['succession']
    flood = s.get('flood_below_navd88_m')
    flooded = (w == 0) & (rd > 0) & (rd < 3) & valid & (elev < (flood if flood is not None else -np.inf)) & (coast < s['flood_within_m']) & (b == 0)
    flooded = nd.binary_opening(flooded, iterations=1)
    save(flooded.astype('uint8'), m.base / 'flooded_streets.png')
    stats = {'seconds': time.time() - t, 'roads': len(roads), 'water_polygons': len(water), 'buildings': len(bld),
             'dem_valid_fraction': float(valid.mean()), 'dem_missing_on_source_land_samples': int(((w == 0) & ~valid).sum()),
             'height_m_valid_min_max': [float(elev[valid].min()), float(elev[valid].max())],
             'water_fraction': float(w.mean()), 'nlcd_values': list(map(int, np.unique(lc))),
             'flooded_street_samples': int(flooded.sum()), 'perched_lakes': len(perched), 'perched_lake_samples': int(lake.sum())}
    (m.base / 'stats.json').write_text(json.dumps(stats, indent=2) + '\n')
    print(stats, flush=True)


if __name__ == '__main__':
    main()
