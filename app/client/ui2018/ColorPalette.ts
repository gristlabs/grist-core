/*
 * The palettes were inspired by comparisons of a handful of popular services.
 */
export const swatches = [
  // white-black
  "#FFFFFF",
  "#DCDCDC",
  "#888888",
  "#000000",

  // red
  "#FECBCC",
  "#FD8182",
  "#E00A17",
  "#740206",

  // brown
  "#F3E1D2",
  "#D6A77F",
  "#AA632B",
  "#653008",

  // orange
  "#FEE7C3",
  "#FECC81",
  "#FD9D28",
  "#B36F19",

  // yellow
  "#FFFACD",
  "#FEF47A",
  "#E8D62F",
  "#928619",

  // green
  "#E1FEDE",
  "#98FD90",
  "#2AE028",
  "#126E0E",

  // light blue
  "#CCFEFE",
  "#8AFCFE",
  "#24D6DB",
  "#0C686A",

  // dark blue
  "#D3E7FE",
  "#75B5FC",
  "#157AFB",
  "#084794",

  // violet
  "#E8D0FE",
  "#BC77FC",
  "#8725FB",
  "#460D81",

  // pink
  "#FED6FB",
  "#FD79F4",
  "#E621D7",
  "#760C6E"
];

/**
 * Tells if swatch is a light color or dark (2 first are light 2 last are dark)
 */
export function isLight(index: number) {
  return index % 4 <= 1;
}
