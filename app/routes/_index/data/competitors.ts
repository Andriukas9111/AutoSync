export const COMPETITORS = [
  { name: "AutoSync", price: "Free\u2013$299", highlight: true, ymme: true, extract: true, collections: true, widgets: "7", plate: true, vin: true, wheel: true },
  { name: "Convermax", price: "$250\u2013$850", highlight: false, ymme: false, extract: false, collections: false, widgets: "1", plate: false, vin: true, wheel: true },
  { name: "EasySearch", price: "$19\u2013$75", highlight: false, ymme: true, extract: false, collections: false, widgets: "2", plate: false, vin: false, wheel: false },
  { name: "PCFitment", price: "$15\u2013$150", highlight: false, ymme: true, extract: false, collections: false, widgets: "1", plate: false, vin: true, wheel: false },
];

export const COMPARE_FEATURES = [
  { label: "YMME Database", key: "ymme" },
  { label: "Auto Extraction", key: "extract" },
  { label: "Smart Collections", key: "collections" },
  { label: "UK Plate Lookup", key: "plate" },
  { label: "VIN Decode", key: "vin" },
  { label: "Wheel Finder", key: "wheel" },
] as const;
