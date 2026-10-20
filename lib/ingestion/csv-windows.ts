// Scaffold for the RED commit: constants are final, csvWindows is implemented in the GREEN commit.
export const CSV_SLICE_BYTES = 1024 * 1024;
export const CSV_WINDOW_ROWS = 50_000;

export async function* csvWindows(
  _bytes: Uint8Array,
  _windowRows: number = CSV_WINDOW_ROWS
): AsyncGenerator<Record<string, string>[]> {
  // intentionally yields nothing until GREEN
}
