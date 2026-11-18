"""Four by four swatch atlases, plus a dedicated metre-mapped sheet of laid decking."""
YACHT = ["topsides", "strake", "boot", "keel", "pearl", "graphite", "glass", "clear",
         "stainless", "bronze", "gasket", "cream", "red", "green", "white", "grille"]
CABIN = ["upholstery", "piping", "linen", "walnut", "chart", "instruments", "keyboard", "leather",
         "stitch", "slate", "pool", "tile", "solstice", "meridian", "belvedere", "sovereign"]
TILES = {name: (material, n) for material, names in (("yacht", YACHT), ("cabin", CABIN)) for n, name in enumerate(names)}
TILES["teak"] = ("teak", 0)
