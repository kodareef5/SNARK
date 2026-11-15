"""Label our own building footprints with what OpenStreetMap and USA Structures know of them: a name, a kind, a
height, storeys, an address and the uses inside. Writes labels.json (by footprint id) and places.json (parks, bridges,
piers, monuments and other named places that are not buildings). Python 3, no packages.
Fetch first: send osm.overpassql to an Overpass server and save the answer as ../raw/osm/all.json."""
import collections, json, math, os, re
HERE = os.path.dirname(os.path.abspath(__file__))
MAIN = os.path.join(HERE, "..")
LON0, LAT0, M_LON, M_LAT = -80.166, 25.78, 100272.0, 110802.0
def local(lat, lon): return (lon - LON0) * M_LON, (lat - LAT0) * M_LAT

# Our footprints, with a grid to find the one a point falls in.
feet, grid = {}, collections.defaultdict(list)
for f in json.load(open(os.path.join(HERE, "..", "base", "buildings.geojson")))["features"]:
    g = f["geometry"]
    polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
    for poly in polys:
        ring = poly[0]; xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
        a = sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(ring, ring[1:])) / 2
        fid = f["properties"]["id"]
        if fid in feet and feet[fid]["area"] >= abs(a): continue
        feet[fid] = {"ring": ring, "box": (min(xs), min(ys), max(xs), max(ys)), "area": abs(a), "e": sum(xs) / len(xs), "n": sum(ys) / len(ys)}
for fid, ft in feet.items():
    x0, y0, x1, y1 = ft["box"]
    for cx in range(int(x0 // 50), int(x1 // 50) + 1):
        for cy in range(int(y0 // 50), int(y1 // 50) + 1): grid[(cx, cy)].append(fid)

def inside(ring, x, y):
    hit = False
    for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0): hit = not hit
    return hit

def footprint_at(e, n, reach=0.0):
    best, far = None, reach
    for fid in grid.get((int(e // 50), int(n // 50)), ()):
        ft = feet[fid]
        if ft["box"][0] <= e <= ft["box"][2] and ft["box"][1] <= n <= ft["box"][3] and inside(ft["ring"], e, n): return fid
    if reach:
        for cx in (-1, 0, 1):
            for cy in (-1, 0, 1):
                for fid in grid.get((int(e // 50) + cx, int(n // 50) + cy), ()):
                    d = math.hypot(feet[fid]["e"] - e, feet[fid]["n"] - n)
                    if d < far: best, far = fid, d
    return best

def metres(v):
    m = re.match(r"\s*([0-9.]+)\s*(m|ft|')?", v or "")
    return round(float(m.group(1)) * (0.3048 if m.group(2) in ("ft", "'") else 1), 1) if m else None

AMENITY = {"fire_station": "fire_station", "police": "police_station", "hospital": "hospital", "clinic": "hospital", "school": "school", "kindergarten": "school",
           "university": "university", "college": "university", "library": "library", "townhall": "city_hall", "courthouse": "courthouse", "post_office": "post_office",
           "place_of_worship": "place_of_worship", "theatre": "theatre", "cinema": "theatre", "arts_centre": "theatre", "bank": "bank", "nightclub": "nightlife",
           "marketplace": "market", "prison": "prison", "ferry_terminal": "port", "community_centre": "government", "conference_centre": "convention_center",
           "events_venue": "convention_center", "casino": "nightlife", "bus_station": "transit_station", "fuel": "other"}
BUILDING = {"hotel": "hotel", "apartments": "apartment_block", "residential": "apartment_block", "house": "house", "detached": "house", "semidetached_house": "house",
            "terrace": "house", "commercial": "office", "office": "office", "retail": "shopping_street", "industrial": "warehouse", "warehouse": "warehouse",
            "parking": "parking_garage", "garage": "parking_garage", "garages": "parking_garage", "train_station": "transit_station", "cruise_terminal": "port",
            "church": "place_of_worship", "synagogue": "place_of_worship", "mosque": "place_of_worship", "school": "school", "university": "university",
            "hospital": "hospital", "museum": "museum", "stadium": "stadium", "government": "government", "civic": "government", "public": "government",
            "fire_station": "fire_station", "supermarket": "market", "hangar": "warehouse", "service": "utility", "lifeguard_tower": "other"}
USE = {"Residential": "apartment_block", "Commercial": "office", "Government": "government", "Education": "school", "Industrial": "warehouse", "Assembly": "theatre", "Agriculture": "other", "Utility and Misc": "utility"}

def kind_of(t):
    if t.get("amenity") in AMENITY: return AMENITY[t["amenity"]]
    if t.get("tourism") in ("hotel", "hostel", "motel", "guest_house"): return "hotel"
    if t.get("tourism") in ("museum", "gallery"): return "museum"
    if t.get("tourism") in ("attraction", "theme_park", "zoo", "aquarium"): return "attraction"
    if t.get("shop") in ("mall", "department_store"): return "shopping_mall"
    if t.get("leisure") == "stadium": return "stadium"
    if t.get("office") in ("government", "diplomatic"): return "government"
    if t.get("man_made") in ("wastewater_plant", "water_works", "storage_tank"): return "utility"
    return BUILDING.get(t.get("building"))

attrs = {}
ap = os.path.join(HERE, "..", "base", "buildings_attributes.json")
if os.path.exists(ap):
    raw = json.load(open(ap)); F = raw["fields"]
    attrs = {str(row[0]): dict(zip(F, row)) for row in raw["rows"]}

labels = {fid: {"names": [], "kinds": collections.Counter(), "heights": [], "levels": [], "address": None, "uses": collections.Counter(), "osm": 0, "tenant": None} for fid in feet}
places, loose = [], 0
for el in json.load(open(os.path.join(MAIN, "raw", "osm", "all.json")))["elements"]:
    t = el.get("tags", {}); lat = el.get("lat") or el.get("center", {}).get("lat"); lon = el.get("lon") or el.get("center", {}).get("lon")
    if lat is None: continue
    e, n = local(lat, lon)
    if "building" in t:
        fid = footprint_at(e, n, 25.0)
        if fid is None: loose += 1; continue
        L = labels[fid]; L["osm"] += 1
        if t.get("name"): L["names"].append(t["name"])
        k = kind_of(t)
        if k: L["kinds"][k] += 3
        if metres(t.get("height")): L["heights"].append(metres(t["height"]))
        if re.match(r"^\d+$", t.get("building:levels", "")): L["levels"].append(int(t["building:levels"]))
        if t.get("addr:housenumber") and t.get("addr:street") and not L["address"]: L["address"] = t["addr:housenumber"] + " " + t["addr:street"]
        continue
    fid = footprint_at(e, n) if el["type"] == "node" else None
    k = kind_of(t)
    if fid is not None and (k or t.get("shop") or t.get("amenity") in ("restaurant", "cafe", "bar", "fast_food", "pub")):
        L = labels[fid]
        L["uses"][t.get("shop") and "shop" or t.get("amenity") or k] += 1
        if k in ("fire_station", "police_station", "city_hall", "courthouse", "library", "hospital", "school", "university", "museum", "place_of_worship", "theatre", "hotel", "stadium", "convention_center") and feet[fid]["area"] < 4000:
            L["tenant"] = (k, t.get("name"))
        continue
    what = (t.get("leisure") in ("park", "garden", "marina", "golf_course", "stadium", "beach_resort", "dog_park") and t["leisure"]) or (t.get("natural") == "beach" and "beach") or \
           (t.get("man_made") in ("bridge", "pier", "tower", "crane", "breakwater", "storage_tank", "wastewater_plant") and t["man_made"]) or ("bridge" in t and "bridge") or \
           (t.get("historic") and "monument") or (t.get("tourism") in ("artwork", "attraction", "viewpoint", "museum") and t["tourism"]) or (t.get("amenity") == "fountain" and "fountain") or \
           (t.get("place") and t["place"]) or (t.get("railway") == "station" and "station") or (t.get("public_transport") == "station" and "station") or (k and k)
    if what and (t.get("name") or what in ("pier", "crane", "bridge", "storage_tank")):
        places.append({"name": t.get("name"), "kind": what, "e": round(e, 1), "n": round(n, 1), "lat": lat, "lon": lon, "in_footprint": fid})

out = {}
for fid, L in labels.items():
    a = attrs.get(str(fid), {})
    survey_h = a.get("HEIGHT")
    h = max(L["heights"]) if L["heights"] else (round(float(survey_h), 1) if survey_h else None)
    use = a.get("OCC_CLS")
    kind = L["kinds"].most_common(1)[0][0] if L["kinds"] else None
    names = [n for n, _ in collections.Counter(L["names"]).most_common(3)]
    if L["tenant"] and not kind and not names: kind, names = L["tenant"][0], [L["tenant"][1]] if L["tenant"][1] else []
    if not kind: kind = USE.get(use)
    if h and h >= 60 and kind in (None, "apartment_block", "office", "house"):
        kind = "tower_office" if kind == "office" or use == "Commercial" else "tower_residential" if kind in ("apartment_block", "house") or use == "Residential" else "tower"
    out[str(fid)] = {"name": names[0] if names else None, "also": names[1:], "kind": kind, "height_m": h, "height_from": "osm" if L["heights"] else ("usa_structures" if survey_h else None), "use": use, "primary_use": a.get("PRIM_OCC"),
                     "levels": max(L["levels"]) if L["levels"] else None, "address": L["address"], "uses": dict(L["uses"].most_common(6)), "area_m2": round(feet[fid]["area"]),
                     "e": round(feet[fid]["e"], 1), "n": round(feet[fid]["n"], 1)}
# Reviewed corrections survive a fresh geographic join; evidence and previous values stay beside the labels.
corrections_path = os.path.join(HERE, "height-corrections.json")
if os.path.exists(corrections_path):
    for fid, correction in json.load(open(corrections_path)).items():
        if fid not in out: raise ValueError("Correction has no footprint: " + fid)
        out[fid].update(correction["set"])
json.dump(out, open(os.path.join(HERE, "labels.json"), "w"), indent=0, ensure_ascii=False)
json.dump(places, open(os.path.join(HERE, "places.json"), "w"), indent=0, ensure_ascii=False)

N = len(out); c = lambda f: sum(1 for v in out.values() if f(v))
print(N, "footprints;", sum(1 for L in labels.values() if L["osm"]), "matched to an OpenStreetMap building;", loose, "OSM buildings fell on none of ours")
print("with a kind:", c(lambda v: v["kind"]), "| a height:", c(lambda v: v["height_m"]), "(osm %d, survey %d)" % (c(lambda v: v["height_from"] == "osm"), c(lambda v: v["height_from"] == "usa_structures")),
      "| a name:", c(lambda v: v["name"]), "| an address:", c(lambda v: v["address"]), "| storeys:", c(lambda v: v["levels"]))
print("no kind and no height:", c(lambda v: not v["kind"] and not v["height_m"]))
print("kinds:", collections.Counter(v["kind"] for v in out.values()).most_common(30))
print("places that are not buildings:", len(places), collections.Counter(p["kind"] for p in places).most_common(20))
tall = sorted((v for v in out.values() if v["height_m"]), key=lambda v: -v["height_m"])[:14]
print("tallest:"); [print("  %6.1f m  %-44s %-18s %s" % (v["height_m"], (v["name"] or "-")[:44], v["kind"], v["address"] or "")) for v in tall]
for k in ("fire_station", "police_station", "city_hall", "courthouse", "stadium", "arena", "shopping_mall", "hospital", "museum", "library", "convention_center", "post_office", "university"):
    print(k + ":", "; ".join(sorted({v["name"] for v in out.values() if v["kind"] == k and v["name"]}))[:330] or "-")
