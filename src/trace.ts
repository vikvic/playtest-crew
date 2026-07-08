/**
 * The trace format — the product. JSONL, one action per line, versioned
 * header line (design doc "Trace Format"). A trace that doesn't replay
 * is a flake; a header the replayer can't match is a harness mismatch,
 * never game nondeterminism.
 *
 *   {"v":1,"game":"2048","runId":"...","seedStrategy":"scoped-prng","seed":42,...}
 *   {"i":0,"tMs":1240,"action":{"type":"key","key":"ArrowLeft"},"preStateHash":"a3f..."}
 */

import { openSync, writeSync, closeSync, readFileSync, writeFileSync } from "node:fs";

export const TRACE_VERSION = 1;

export type SeedStrategy = "scoped-prng" | "none";
export type StateSource = "dom" | "adapter";

export interface TraceHeader {
  v: number;
  game: string;
  runId: string;
  seedStrategy: SeedStrategy;
  seed: number;
  viewport: { w: number; h: number };
  stateSource: StateSource;
  adapterVersion: string;
}

export type Action =
  | { type: "key"; key: string }
  | { type: "pointer"; kind: "click" | "move"; x: number; y: number };

export interface TraceLine {
  i: number;
  tMs: number;
  action: Action;
  preStateHash: string;
  screenshotRef?: string;
}

export interface Trace {
  header: TraceHeader;
  lines: TraceLine[];
  /** true when the final line was cut off mid-write (crashed run) and dropped */
  truncated: boolean;
}

export class TraceFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TraceFormatError";
  }
}

/** Header the replayer refuses — harness drift, not a game bug. */
export class HarnessMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarnessMismatchError";
  }
}

const HEADER_FIELDS: (keyof TraceHeader)[] = [
  "v",
  "game",
  "runId",
  "seedStrategy",
  "seed",
  "viewport",
  "stateSource",
  "adapterVersion",
];

export function validateHeader(header: unknown): TraceHeader {
  if (typeof header !== "object" || header === null) {
    throw new TraceFormatError("Trace header is not an object");
  }
  const h = header as Record<string, unknown>;
  for (const field of HEADER_FIELDS) {
    if (!(field in h)) throw new TraceFormatError(`Trace header missing "${field}"`);
  }
  if (h.v !== TRACE_VERSION) {
    throw new TraceFormatError(
      `Trace version ${h.v} unsupported (this harness reads v${TRACE_VERSION})`,
    );
  }
  return h as unknown as TraceHeader;
}

/**
 * The replayer's compatibility gate: refuse a trace whose stateSource or
 * adapterVersion this harness can't match, so serialization drift is
 * reported as a harness mismatch — never as game nondeterminism.
 */
export function assertCompatible(
  header: TraceHeader,
  expected: { game: string; stateSource: StateSource; adapterVersion: string },
): void {
  if (header.game !== expected.game) {
    throw new HarnessMismatchError(
      `Trace is for game "${header.game}" but harness is configured for "${expected.game}"`,
    );
  }
  if (header.stateSource !== expected.stateSource) {
    throw new HarnessMismatchError(
      `Trace stateSource "${header.stateSource}" != harness "${expected.stateSource}" — ` +
        `re-record or run \`playtest rebaseline\``,
    );
  }
  if (header.adapterVersion !== expected.adapterVersion) {
    throw new HarnessMismatchError(
      `Trace adapterVersion "${header.adapterVersion}" != harness "${expected.adapterVersion}" — ` +
        `the adapter changed since this trace was recorded; run \`playtest rebaseline\``,
    );
  }
}

/**
 * Append-only JSONL writer; header first, then one line per action.
 * Each line is written straight to the fd so a crashed run loses at most
 * the line being written (readTrace tolerates a truncated final line).
 */
export class TraceWriter {
  private fd: number;
  private headerWritten = false;

  constructor(path: string) {
    this.fd = openSync(path, "w");
  }

  writeHeader(header: TraceHeader): void {
    if (this.headerWritten) throw new TraceFormatError("Header already written");
    writeSync(this.fd, JSON.stringify(header) + "\n");
    this.headerWritten = true;
  }

  writeLine(line: TraceLine): void {
    if (!this.headerWritten) throw new TraceFormatError("Write the header before lines");
    writeSync(this.fd, JSON.stringify(line) + "\n");
  }

  async close(): Promise<void> {
    closeSync(this.fd);
  }
}

/**
 * Read a trace. A truncated final line (runner crashed mid-write) is
 * dropped and flagged, not fatal — the complete prefix still replays.
 */
export async function readTrace(path: string): Promise<Trace> {
  const text = readFileSync(path, "utf8");
  const rawLines = text.split("\n").filter((l) => l.length > 0);
  if (rawLines.length === 0) throw new TraceFormatError(`Empty trace file: ${path}`);

  let headerRaw: unknown;
  try {
    headerRaw = JSON.parse(rawLines[0]!);
  } catch {
    throw new TraceFormatError(`Trace header is not valid JSON: ${path}`);
  }
  const header = validateHeader(headerRaw);

  const lines: TraceLine[] = [];
  let truncated = false;
  for (let idx = 1; idx < rawLines.length; idx++) {
    let parsed: TraceLine;
    try {
      parsed = JSON.parse(rawLines[idx]!) as TraceLine;
    } catch {
      if (idx === rawLines.length - 1) {
        truncated = true; // crash mid-write; the prefix is still good
        break;
      }
      throw new TraceFormatError(`Corrupt trace line ${idx} (not the final line): ${path}`);
    }
    if (parsed.i !== idx - 1) {
      throw new TraceFormatError(
        `Trace line index mismatch at line ${idx}: expected i=${idx - 1}, got i=${parsed.i}`,
      );
    }
    lines.push(parsed);
  }
  return { header, lines, truncated };
}

/** Cut a trace at the action where an oracle fired (no minimization in v0). */
export function cutTrace(trace: Trace, lastIncludedIndex: number): Trace {
  return {
    header: trace.header,
    lines: trace.lines.slice(0, lastIncludedIndex + 1),
    truncated: false,
  };
}

export async function writeTraceFile(path: string, trace: Trace): Promise<void> {
  const out =
    [JSON.stringify(trace.header), ...trace.lines.map((l) => JSON.stringify(l))].join("\n") + "\n";
  writeFileSync(path, out);
}
