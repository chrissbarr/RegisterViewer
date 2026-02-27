/** Raw RGB triples — single source of truth for the field color palette. */
const FIELD_RGB = [
  '59,130,246',   // blue
  '34,197,94',    // green
  '245,158,11',   // amber
  '244,63,94',    // rose
  '168,85,247',   // purple
  '6,182,212',    // cyan
  '249,115,22',   // orange
  '20,184,166',   // teal
  '236,72,153',   // pink
  '99,102,241',   // indigo
];

export function fieldColor(index: number, alpha: number): string {
  return `rgba(${FIELD_RGB[index % FIELD_RGB.length]},${alpha})`;
}

export function fieldBorderColor(index: number): string {
  return `rgb(${FIELD_RGB[index % FIELD_RGB.length]})`;
}
