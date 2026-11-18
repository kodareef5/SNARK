"""Which roads run hidden below the ground: one rule for future.py and fine.py, which both draw the roads. A module of its
own, not common.py, which every stage's key holds: an edit to this rule makes future and fine again, not every stage."""

# What a road's names say of a tunnel: TIGER abbreviates (the city's roads.tunnel_name, "tunl"), OpenStreetMap does not.
WORDS = ('tunnel',)


def tunnels(roads, water, tunnel_name):
    """By index, the roads drawn as no road at all, their ground standing over them:
    - a tunnel that says so: one OpenStreetMap tags a tunnel, or a line TIGER alone draws, whose name, TIGER's name or
      OpenStreetMap's tunnel:name says tunnel (the Port Miami Tunnel, San Francisco's Broadway and MacArthur tunnels,
      Los Angeles's 2nd Street Tunnel under Bunker Hill);
    - a tunnel OpenStreetMap tags where it passes under water, named or not.
    A road tagged a tunnel that is neither is an underpass or a road under a deck (Miami airport's arrivals road) and
    stays a street; a road beside a tunnel that took its TIGER name (a 21 m alley by Broadway) is not tagged, so stays.
    future.py marked OpenStreetMap's tunnels and fine.py, drawing the roads again by name alone, had put every one of
    them back (Tampa's 6,057 tunnel samples, LA's 17,027)."""
    from shapely.strtree import STRtree
    wet = [g for g, _ in water]
    tree = STRtree(wet) if wet else None
    words = (*WORDS, tunnel_name.lower())
    out = set()
    for i, (g, p) in enumerate(roads):
        osm = 'highway' in p
        if osm and not p.get('tunnel'):
            continue
        names = ' '.join(n for n in (p.get('name'), p.get('tiger_name'), p.get('tunnel_name')) if n).lower()
        named = any(w in names for w in words)
        under_water = osm and tree is not None and any(wet[j].intersects(g) for j in tree.query(g))
        if named or under_water:
            out.add(i)
    return out
