# Lists what a GLB holds: meshes, materials, images, bones with their parents, other nodes, and clips.
#   python3 -I inspect.py FILE.glb
import json, struct, sys

b = open(sys.argv[1], "rb").read()
n = struct.unpack_from("<I", b, 12)[0]
j = json.loads(b[20:20 + n])
print("extensionsUsed", j.get("extensionsUsed"), "required", j.get("extensionsRequired"))
print("asset", j.get("asset"))
print("scenes", len(j.get("scenes", [])), "nodes", len(j["nodes"]), "meshes", len(j["meshes"]), "skins", len(j.get("skins", [])))
for m in j["meshes"]:
    for p in m["primitives"]:
        acc = j["accessors"][p["attributes"]["POSITION"]]
        idx = j["accessors"][p["indices"]]["count"] if "indices" in p else None
        print(" mesh", m.get("name"), "verts", acc["count"], "tris", idx // 3 if idx else None, "attrs", sorted(p["attributes"]),
              "mat", p.get("material"), "ext", list(p.get("extensions", {})), "min", acc.get("min"), "max", acc.get("max"))
for i, mat in enumerate(j.get("materials", [])):
    print(" material", i, json.dumps(mat)[:500])
for im in j.get("images", []):
    bv = im.get("bufferView")
    print(" image", im.get("name"), im.get("mimeType"), "bytes", j["bufferViews"][bv]["byteLength"] if bv is not None else im.get("uri"))
print(" textures", j.get("textures"), "samplers", j.get("samplers"))
names = {i: nd.get("name") for i, nd in enumerate(j["nodes"])}
parent = {}
for i, nd in enumerate(j["nodes"]):
    for c in nd.get("children", []):
        parent[c] = i
joints = set()
for s in j.get("skins", []):
    joints |= set(s["joints"])
    print("skin joints", len(s["joints"]), "skeleton", names.get(s.get("skeleton")))
    for jt in s["joints"]:
        nd = j["nodes"][jt]
        print("  ", names[jt], "<-", names.get(parent.get(jt)), "t", [round(v, 3) for v in nd.get("translation", [0, 0, 0])],
              "r", [round(v, 3) for v in nd.get("rotation", [0, 0, 0, 1])])
for i, nd in enumerate(j["nodes"]):
    if i not in joints:
        print(" node", i, nd.get("name"), {k: nd[k] for k in nd if k != "children"}, "children", [names[c] for c in nd.get("children", [])][:5])
for a in j.get("animations", []):
    ins = [j["accessors"][s["input"]] for s in a["samplers"]]
    tmax = max(x["max"][0] for x in ins)
    cnt = max(x["count"] for x in ins)
    paths = {}
    for c in a["channels"]:
        paths.setdefault(c["target"]["path"], set()).add(names[c["target"]["node"]])
    print("anim", a.get("name"), "len %.3fs" % tmax, "keys", cnt, {k: len(v) for k, v in paths.items()},
          "translated:", sorted(paths.get("translation", [])))
print("extras", j.get("extras"), j["asset"].get("extras"))
