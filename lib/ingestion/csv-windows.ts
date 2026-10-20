import { Readable } from "node:stream";
import Papa from "papaparse";

/**
 * Windowed CSV reading (14-02, D-06/D-03): a large billing file is processed
 * a bounded number of rows at a time, so the background function's memory no
 * longer scales with the row count (whole-file processing measured 1,535 MB
 * RSS at 100 MB against a 1024 MB function).
 *
 * This module is reachable from the Netlify background function through
 * `index.ts`, so it uses package and node built-in imports ONLY: no `@/`
 * alias and nothing from Next.js.
 */

/**
 * Size of the slices fed to the parser. Must stay at 1 MiB: Papa guesses the
 * line ending (and delimiter) from the FIRST chunk it sees, and tiny first
 * slices mis-handle CRLF files (measured: 30 mismatches against whole-file
 * parsing at 1-64 byte slices, 0 at 1 MiB).
 */
export const CSV_SLICE_BYTES = 1024 * 1024;

/** Rows per window. Each window is validated, normalised and upserted, then released. */
export const CSV_WINDOW_ROWS = 50_000;

/** Same as PapaParse's own stripBom (a header cell may carry a leading UTF-8 BOM). */
function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/**
 * The header row, exactly as `Papa.parse(text, { header: true })` derives its
 * field names: BOM stripped, then duplicate names renamed `name_1`, `name_2`.
 */
function headerFields(cells: string[]): string[] {
  const used = new Set(cells);
  const count: Record<string, number> = Object.create(null);
  const fields: string[] = [];
  for (const raw of cells) {
    const name = stripBom(raw);
    if (!count[name]) {
      count[name] = 1;
      fields.push(name);
    } else {
      let suffix = count[name];
      let renamed: string;
      do {
        renamed = `${name}_${suffix}`;
        suffix++;
      } while (used.has(renamed));
      used.add(renamed);
      fields.push(renamed);
      count[name]++;
    }
    used.add(name);
  }
  return fields;
}

/**
 * One data row as header mode shapes it: cells beyond the header go to a
 * `__parsed_extra` array, and a short row simply lacks the trailing keys.
 */
function toRecord(fields: string[], cells: string[]): Record<string, string> {
  const row: Record<string, unknown> = {};
  for (let j = 0; j < cells.length; j++) {
    if (j >= fields.length) {
      const extra = (row["__parsed_extra"] as string[] | undefined) ?? [];
      extra.push(cells[j]);
      row["__parsed_extra"] = extra;
    } else {
      row[fields[j]] = cells[j];
    }
  }
  return row as Record<string, string>;
}

/**
 * Yield the data rows of a CSV, in order, as arrays of at most `windowRows`
 * rows. The rows are identical to `Papa.parse(whole decoded text, { header:
 * true, skipEmptyLines: true }).data` (BOM, CRLF, quoted commas and newlines,
 * multibyte characters spanning a slice edge, duplicate-valued and ragged
 * rows all round-trip; proven in csv-windows.test.ts).
 *
 * The Node-stream form of Papa is used deliberately. Papa's `chunk` callback
 * on a string input retained memory (measured: it OOMed at a 500 MB heap on a
 * 100 MB file even though it reported 26 windows), whereas the stream form
 * completes 100 MB at a 200 MB heap. `setEncoding("utf8")` makes the
 * Readable's StringDecoder hold back a partial multibyte sequence at a slice
 * boundary instead of emitting a replacement character.
 *
 * Two deliberate departures from the research prototype, both measured:
 *
 * 1. The header is NOT parsed by Papa. In stream mode Papa pauses when its
 *    output buffer fills (every 16 rows) and resumes by re-entering its parser
 *    with the first chunk's base index of 0, which makes it treat the next data
 *    row as a header and rewrite that row's repeated values (`"x","x"` becomes
 *    `"x","x_1"`). That silently corrupts any row with two equal cells, an
 *    empty pair included. So Papa streams plain row arrays (`header: false`,
 *    which has no such path) and the header handling above is applied here.
 * 2. Backpressure is applied to the SLICES, never to Papa. Pausing Papa, or
 *    reading it through `for await`, puts it in a pause/resume cycle every 16
 *    rows (300,000 rows took 24 s). Instead the parser flows freely and the
 *    slice generator simply does not hand over the next slice while a
 *    finished window is still waiting for the consumer. Memory is therefore
 *    one window being processed, plus the rows of the slice being parsed.
 */
export async function* csvWindows(
  bytes: Uint8Array,
  windowRows: number = CSV_WINDOW_ROWS
): AsyncGenerator<Record<string, string>[]> {
  const parser = Papa.parse(Papa.NODE_STREAM_INPUT as unknown as typeof Papa.NODE_STREAM_INPUT, {
    header: false,
    skipEmptyLines: true,
  }) as unknown as NodeJS.ReadWriteStream;

  const queue: Record<string, string>[][] = []; // finished windows the consumer has not taken yet
  let fields: string[] | null = null;
  let window: Record<string, string>[] = [];
  let ended = false;
  let failure: unknown = null;
  // Both are assigned inside closures, so declare the wide type explicitly
  // (TS would otherwise narrow the initial null to `never` at the call sites).
  let notify = null as (() => void) | null; // wakes the consumer
  let openGate = null as (() => void) | null; // wakes the slice generator
  const wake = () => {
    const n = notify;
    notify = null;
    n?.();
  };

  // Zero-copy views over the caller's bytes, one slice at a time, handed over
  // only while no finished window is waiting.
  async function* slices(): AsyncGenerator<Buffer> {
    for (let i = 0; i < bytes.length; i += CSV_SLICE_BYTES) {
      while (queue.length > 0) {
        await new Promise<void>((resolve) => {
          openGate = resolve;
        });
      }
      yield Buffer.from(bytes.buffer, bytes.byteOffset + i, Math.min(CSV_SLICE_BYTES, bytes.length - i));
    }
  }

  const source = Readable.from(slices(), { objectMode: false });
  source.setEncoding("utf8");

  parser.on("data", (cells: string[]) => {
    if (fields === null) {
      fields = headerFields(cells);
      return;
    }
    window.push(toRecord(fields, cells));
    if (window.length >= windowRows) {
      queue.push(window);
      window = [];
      wake();
    }
  });
  parser.on("end", () => {
    ended = true;
    wake();
  });
  parser.on("error", (err: unknown) => {
    failure = err;
    wake();
  });
  source.on("error", (err: unknown) => {
    failure = err;
    wake();
  });
  source.pipe(parser);

  try {
    for (;;) {
      if (failure !== null) throw failure;
      const ready = queue.shift();
      if (ready !== undefined) {
        yield ready;
        // The consumer is done with that window: let the next slice through
        // once nothing else is waiting.
        if (queue.length === 0) {
          const g = openGate;
          openGate = null;
          g?.();
        }
        continue;
      }
      if (ended) break;
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
    }
    if (window.length > 0) yield window;
  } finally {
    source.destroy();
    (parser as unknown as Readable).destroy();
  }
}
