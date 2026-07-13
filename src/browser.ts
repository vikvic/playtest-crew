/**
 * Browser plumbing: serve the vendored game over localhost (file:// is
 * flaky with localStorage and CI), launch Chromium via Playwright, inject
 * the scoped PRNG BEFORE any game script runs.
 *
 * Runtime-agnostic (node:http static server): runs under Bun everywhere
 * and under Node on Windows, where the CLI hops runtimes because Bun
 * cannot complete Playwright's launch handshake (oven-sh/bun#27977 —
 * same fallback the gstack browse daemon uses).
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createServer } from "node:http";
import { join, extname, normalize } from "node:path";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { prngInitScript } from "./prng.ts";
import type { GameConfig } from "./games/types.ts";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
};

export interface GameServer {
  url: string;
  stop(): void;
}

export function serveGame(dir: string): Promise<GameServer> {
  const server = createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
      if (path === "/" || path === "") path = "/index.html";
      if (normalize(path).includes("..")) {
        res.writeHead(403).end("forbidden");
        return;
      }
      const body = await readFile(join(dir, path));
      res.writeHead(200, {
        "content-type": CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/`,
        stop: () => server.close(),
      });
    });
  });
}

export interface LaunchOptions {
  game: GameConfig;
  seed: number;
  headed?: boolean;
  /** Directory for Playwright's recordVideo; omit to skip video (replay). */
  videoDir?: string;
}

export interface GameLaunch {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  server: GameServer;
  /** Epoch ms when the page (and its video recording) was created. */
  videoStartedAt: number;
  close(): Promise<void>;
}

export async function launchGame(opts: LaunchOptions): Promise<GameLaunch> {
  const server = await serveGame(opts.game.dir);
  const browser = await chromium.launch({ headless: !opts.headed });
  const context = await browser.newContext({
    viewport: { width: opts.game.viewport.w, height: opts.game.viewport.h },
    ...(opts.videoDir
      ? {
          recordVideo: {
            dir: opts.videoDir,
            size: { width: opts.game.viewport.w, height: opts.game.viewport.h },
          },
        }
      : {}),
  });
  // Scoped PRNG must exist before any game script evaluates (fresh context
  // per launch also guarantees empty localStorage — no stale saved game).
  await context.addInitScript(prngInitScript(opts.seed));
  const videoStartedAt = Date.now(); // video capture begins with the page
  const page = await context.newPage();
  await page.goto(server.url + opts.game.entry);
  await opts.game.waitUntilReady(page);
  return {
    browser,
    context,
    page,
    server,
    videoStartedAt,
    async close() {
      await context.close(); // flushes video
      await browser.close();
      server.stop();
    },
  };
}
