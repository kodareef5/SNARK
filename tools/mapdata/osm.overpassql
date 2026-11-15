[out:json][timeout:240][bbox:{bbox}];
(
  way["building"];
  relation["building"];
  nwr["amenity"];
  nwr["leisure"];
  nwr["tourism"];
  nwr["historic"];
  nwr["shop"];
  nwr["office"];
  nwr["man_made"];
  nwr["natural"="beach"];
  nwr["railway"="station"];
  nwr["public_transport"="station"];
  way["bridge"]["name"];
  nwr["place"~"island|islet|neighbourhood|suburb|quarter"];
);
out tags center;
