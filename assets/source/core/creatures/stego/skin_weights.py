"""Blend the original loft weights across the four joints of the fused skin."""
import heapq

import numpy as np


def junction_band(adjacency, region, seeds, radius):
    """Grow on triangle edges to stay on the correct side of each skin fold."""
    distances = np.full(len(region), np.inf)
    distances[seeds] = 0
    queue = [(0.0, vertex) for vertex in seeds]
    heapq.heapify(queue)
    while queue:
        distance, vertex = heapq.heappop(queue)
        if distance != distances[vertex]:
            continue
        for other, length in adjacency[vertex]:
            new_distance = distance + length
            if region[other] and new_distance < min(radius, distances[other]):
                distances[other] = new_distance
                heapq.heappush(queue, (new_distance, other))
    return np.flatnonzero(np.isfinite(distances))


def harmonic_weights(adjacency, original, free):
    """Interpolate between the authored weights just outside this band."""
    local = np.full(len(original), -1, dtype=np.int32)
    local[free] = np.arange(len(free))
    diagonal = np.zeros(len(free))
    boundary = np.zeros_like(original[free])
    source, destination, conductance = [], [], []
    for row, vertex in enumerate(free):
        for other, length in adjacency[vertex]:
            weight = 1 / max(1e-5, length)
            diagonal[row] += weight
            if local[other] < 0:
                boundary[row] += weight * original[other]
            else:
                source.append(row)
                destination.append(local[other])
                conductance.append(weight)
    source = np.asarray(source, dtype=np.int32)
    destination = np.asarray(destination, dtype=np.int32)
    conductance = np.asarray(conductance)[:, None]

    def laplacian(values):
        result = diagonal[:, None] * values
        np.add.at(result, source, -conductance * values[destination])
        return result

    # Jacobi-preconditioned conjugate gradients, one RHS for each joint.
    values = original[free].copy()
    residual = boundary - laplacian(values)
    preconditioned = residual / diagonal[:, None]
    direction = preconditioned.copy()
    residual_product = np.sum(residual * preconditioned, axis=0)
    for _ in range(1200):
        applied = laplacian(direction)
        denominator = np.sum(direction * applied, axis=0)
        step = np.divide(residual_product, denominator, out=np.zeros_like(denominator),
                         where=np.abs(denominator) > 1e-24)
        values += direction * step
        residual -= applied * step
        preconditioned = residual / diagonal[:, None]
        if np.max(np.abs(preconditioned)) < 1e-9:
            return np.maximum(0, values)
        next_product = np.sum(residual * preconditioned, axis=0)
        beta = np.divide(next_product, residual_product, out=np.zeros_like(next_product),
                         where=np.abs(residual_product) > 1e-24)
        direction = preconditioned + direction * beta
        residual_product = next_product
    raise RuntimeError("Stego limb junction weight solve did not converge")


def pack_chain(values, bones):
    # Preserve chain mass and its mean joint index. Two adjacent influences
    # replace the diffused field and exchange support only through zero.
    chain = values[:, bones]
    total = chain.sum(axis=1)
    moment = np.divide(chain @ np.arange(len(bones)), total, out=np.zeros_like(total),
                       where=total > 1e-12)
    left = np.minimum(len(bones) - 2, np.floor(moment).astype(np.int32))
    fraction = moment - left
    rows = np.arange(len(values))
    values[:, bones] = 0
    values[rows, bones[left]] = total * (1 - fraction)
    values[rows, bones[left + 1]] = total * fraction


def junction_weights(mesh, weights, engine_point):
    names = sorted({name for row in weights for name in row})
    ids = {name: index for index, name in enumerate(names)}
    original = np.zeros((len(weights), len(names)))
    for i, row in enumerate(weights):
        for name, value in row.items():
            original[i, ids[name]] = value

    points = np.array([tuple(engine_point(v.co)) for v in mesh.vertices])
    x, y, z = points.T
    edges = np.asarray([tuple(edge.vertices) for edge in mesh.edges], dtype=np.int32)
    first, second = edges.T
    lengths = np.linalg.norm(points[first] - points[second], axis=1)
    adjacency = [[] for _ in points]
    for (a, b), length in zip(edges, lengths):
        adjacency[a].append((b, length))
        adjacency[b].append((a, length))

    axial_names = ([f"tail_{i}" for i in range(7, 0, -1)]
                   + ["pelvis", "spine", "chest", "neck_1", "neck_2", "neck_3", "skull"])
    axial = np.array([ids[name] for name in axial_names if name in ids])
    result = original.copy()
    for kind in ["fore", "hind"]:
        for side, sign in [("l", 1), ("r", -1)]:
            leg = np.array([ids[f"{kind}_{part}_{side}"] for part in ["upper", "lower", "foot"]])
            upper, lower, foot = leg
            influence = original[:, upper] + original[:, lower]
            region = (sign*x > .18) & (sign*x < 1.40)
            if kind == "fore":
                region &= (y > .56) & (y < 2.15) & (z > .10) & (z < 1.52)
                radius, flex_start, flex_end = .40, .72, .92
            else:
                region &= (y > .72) & (y < 2.65) & (z > -1.66) & (z < .16)
                radius, flex_start, flex_end = .46, 1.03, 1.28

            crossing = region[first] & region[second] & (np.abs(influence[first] - influence[second]) > .20)
            free = junction_band(adjacency, region, np.unique(edges[crossing]), radius)
            if not len(free):
                raise RuntimeError(f"No trunk/limb boundary for Stego {kind} {side}")
            solved = harmonic_weights(adjacency, original, free)

            # Skin above the elbow or knee moves with the upper limb.
            t = np.clip((y[free] - flex_start) / (flex_end - flex_start), 0, 1)
            fade = t*t*(3-2*t)
            solved[:, upper] += (solved[:, lower] + solved[:, foot]) * fade
            solved[:, lower] *= 1 - fade
            solved[:, foot] *= 1 - fade
            pack_chain(solved, axial)
            pack_chain(solved, leg)
            result[free] = solved
            print(f"Stego {kind} {side} junction: {len(free)} vertices", flush=True)

    rows = []
    for row in result:
        keep = np.argsort(row)[-4:]
        total = row[keep].sum()
        rows.append({names[k]: float(row[k] / total) for k in keep if row[k] > 1e-8})
    return rows
