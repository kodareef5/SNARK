// Analytic, unbounded tyre-test plane. Chassis collision courses use StaticVehicleWorld and native geometry instead.
import type { VehicleSurface, VehicleWorld } from '../../shared/sim/vehicle.ts';
export function vehiclePlane(surface: VehicleSurface): VehicleWorld {
  return {
    contact: () => null, penetration: () => null, waterAt: () => -Infinity,
    wheelRay(_x, y, _z, _dx, dy, _dz, reach) {
      if (dy >= 0) return null;
      const distance = -y / dy;
      return distance < 0 || distance > reach ? null : { distance, nx: 0, ny: 1, nz: 0, surface };
    },
  };
}
