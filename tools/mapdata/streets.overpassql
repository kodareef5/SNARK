[out:json][timeout:600][maxsize:1073741824][bbox:{bbox}];
(
  way["highway"];
  node["highway"~"^(crossing|traffic_signals|stop|give_way)$"];
  node["entrance"];
  way["amenity"="parking"];
  relation["amenity"="parking"];
  way["landuse"];
  relation["landuse"];
  way["leisure"~"^(park|garden|playground|pitch|dog_park|common|recreation_ground)$"];
  relation["leisure"~"^(park|garden|recreation_ground)$"];
  way["place"="square"];
  way["natural"="beach"];
  relation["natural"="beach"];
  way["area:highway"];
);
out body geom;
