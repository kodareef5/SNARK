[out:json][timeout:240][bbox:{bbox}];
(
  way["bridge"]["highway"];
  way["bridge"]["railway"];
  way["man_made"="bridge"];
  way["man_made"="pier"];
  way["man_made"="breakwater"];
  way["man_made"="groyne"];
  way["man_made"="tower"]["tower:type"="bridge"];
  way["highway"="steps"];
);
out tags geom;
