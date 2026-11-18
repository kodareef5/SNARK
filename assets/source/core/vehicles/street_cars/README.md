# Street test lot

The three archived GLBs in `assets/raw/grab3d` came from Grab3D’s CC0 vehicle collection. [Monster Truck](https://grab3d.com/models/vehicles/monster-truck/) · [Muscle Car](https://grab3d.com/models/vehicles/muscle-car/) · [Taxi](https://grab3d.com/models/vehicles/taxi/)

Each cab has a cut footwell, hinged door stampings, a steering shaft and seat sockets. The truck retains the donor's tread blocks, axles, shocks and lamp bar. The coupe keeps its scoop and deck stripes. The taxi has separate front and rear entry points on both sides. The source coupe's rear tires are wider than its front tires. Its SNARK fit retains the staggered widths and uses the average rolling radius for the two-axle solver.

The six levels include two textured meshes, three progressively simplified palette meshes, and a low-poly shell with its own wheel openings, hubs, pillars and lamps. The [review sheet](review.jpg) shows both ends of each vehicle and its final level.

The checked-in packs run directly. To rebuild the prepared geometry, use Python 3.10 or newer with NumPy, SciPy, Pillow, manifold3d and fast-simplification. The native pack build uses Blender.

```sh
python3 assets/source/core/vehicles/street_cars/prepare.py monster_truck muscle_car taxi
bun tools/art.ts core:monster_truck core:muscle_car core:taxi --no-sheet
bun tools/urban/dev.ts --cars --dist var/street-yard/client --port 8817
```
