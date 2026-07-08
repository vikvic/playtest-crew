/**
 * Canonical-JSON hashing for game state (the design doc's pinned spec):
 * recursively sorted keys, UTF-8, no whitespace. Hashed values must be
 * integers, strings, booleans, or null — floats are banned because they
 * hash unstably across serializers (round or exclude them upstream via
 * hash_fields). A float anywhere in the state is a hard error, never a
 * silent hash.
 *
 * Runtime-agnostic (node:crypto): runs under Bun everywhere and under
 * Node on Windows, where the CLI hops runtimes to dodge oven-sh/bun#27977.
 */

import { createHash } from "node:crypto";

export class FloatInHashError extends Error {
  constructor(path: string, value: number) {
    super(
      `Non-integer number at "${path}" (${value}) — floats are banned from hashed state. ` +
        `Round to a declared precision or exclude the field via hash_fields.`,
    );
    this.name = "FloatInHashError";
  }
}

export function canonicalJson(value: unknown, path = "$"): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "number":
      if (!Number.isInteger(value)) throw new FloatInHashError(path, value);
      return JSON.stringify(value);
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((v, i) => canonicalJson(v, `${path}[${i}]`)).join(",")}]`;
      }
      const keys = Object.keys(value as Record<string, unknown>).sort();
      const entries = keys.map(
        (k) =>
          `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k], `${path}.${k}`)}`,
      );
      return `{${entries.join(",")}}`;
    }
    default:
      throw new Error(`Unhashable value of type ${typeof value} at "${path}"`);
  }
}

export function hashState(state: unknown): string {
  return createHash("sha256").update(canonicalJson(state), "utf8").digest("hex");
}
