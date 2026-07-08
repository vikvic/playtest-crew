import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  TraceWriter,
  readTrace,
  validateHeader,
  assertCompatible,
  cutTrace,
  writeTraceFile,
  TraceFormatError,
  HarnessMismatchError,
  type TraceHeader,
  type TraceLine,
} from "../src/trace";

const header: TraceHeader = {
  v: 1,
  game: "2048",
  runId: "test-run",
  seedStrategy: "scoped-prng",
  seed: 42,
  viewport: { w: 1280, h: 800 },
  stateSource: "adapter",
  adapterVersion: "2048-fork@1",
};

function line(i: number): TraceLine {
  return { i, tMs: 100 + i * 120, action: { type: "key", key: "ArrowLeft" }, preStateHash: `h${i}` };
}

function tmpPath(name: string): string {
  return join(mkdtempSync(join(tmpdir(), "ptc-trace-")), name);
}

describe("trace round-trip", () => {
  test("write → read → identical", async () => {
    const path = tmpPath("t.jsonl");
    const w = new TraceWriter(path);
    w.writeHeader(header);
    const lines = [line(0), line(1), line(2)];
    for (const l of lines) w.writeLine(l);
    await w.close();

    const trace = await readTrace(path);
    expect(trace.header).toEqual(header);
    expect(trace.lines).toEqual(lines);
    expect(trace.truncated).toBe(false);
  });

  test("truncated final line (crash mid-write) is dropped and flagged", async () => {
    const path = tmpPath("t.jsonl");
    const good = [JSON.stringify(header), JSON.stringify(line(0)), JSON.stringify(line(1))];
    await Bun.write(path, good.join("\n") + "\n" + '{"i":2,"tMs":340,"act');
    const trace = await readTrace(path);
    expect(trace.truncated).toBe(true);
    expect(trace.lines).toHaveLength(2);
  });

  test("corrupt NON-final line is fatal (not silently skipped)", async () => {
    const path = tmpPath("t.jsonl");
    await Bun.write(
      path,
      [JSON.stringify(header), "{broken", JSON.stringify(line(1))].join("\n") + "\n",
    );
    await expect(readTrace(path)).rejects.toThrow(TraceFormatError);
  });

  test("line index gap is fatal", async () => {
    const path = tmpPath("t.jsonl");
    await Bun.write(path, [JSON.stringify(header), JSON.stringify(line(1))].join("\n") + "\n");
    await expect(readTrace(path)).rejects.toThrow("index mismatch");
  });

  test("empty file is fatal", async () => {
    const path = tmpPath("t.jsonl");
    await Bun.write(path, "");
    await expect(readTrace(path)).rejects.toThrow(TraceFormatError);
  });
});

describe("header validation", () => {
  test("missing field refused", () => {
    const { adapterVersion: _dropped, ...partial } = header;
    expect(() => validateHeader(partial)).toThrow('missing "adapterVersion"');
  });

  test("wrong version refused", () => {
    expect(() => validateHeader({ ...header, v: 2 })).toThrow("unsupported");
  });
});

describe("compatibility gate (harness mismatch, never game nondeterminism)", () => {
  const expected = { game: "2048", stateSource: "adapter" as const, adapterVersion: "2048-fork@1" };

  test("matching header passes", () => {
    expect(() => assertCompatible(header, expected)).not.toThrow();
  });

  test("stateSource mismatch refused", () => {
    expect(() => assertCompatible({ ...header, stateSource: "dom" }, expected)).toThrow(
      HarnessMismatchError,
    );
  });

  test("adapterVersion mismatch refused with rebaseline hint", () => {
    expect(() => assertCompatible({ ...header, adapterVersion: "2048-fork@0" }, expected)).toThrow(
      "rebaseline",
    );
  });

  test("wrong game refused", () => {
    expect(() => assertCompatible({ ...header, game: "hextris" }, expected)).toThrow(
      HarnessMismatchError,
    );
  });
});

describe("cutTrace", () => {
  test("truncates at the oracle-fire action, inclusive", async () => {
    const trace = { header, lines: [line(0), line(1), line(2), line(3)], truncated: false };
    const cut = cutTrace(trace, 1);
    expect(cut.lines).toHaveLength(2);
    expect(cut.lines[1]!.i).toBe(1);

    const path = tmpPath("cut.jsonl");
    await writeTraceFile(path, cut);
    const back = await readTrace(path);
    expect(back.lines).toEqual(cut.lines);
  });
});
