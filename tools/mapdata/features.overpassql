[out:json][timeout:300][bbox:{bbox}];
(
  way["building:part"];
  relation["building:part"];
  way["natural"="water"];
  relation["natural"="water"];
  way["water"];
  way["leisure"="swimming_pool"];
  way["amenity"="fountain"];
  way["aeroway"~"^(runway|taxiway|apron|helipad)$"];
  way["attraction"="big_wheel"];
);
out tags geom;
