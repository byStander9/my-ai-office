import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { reduceEvents } from "./events-reducer.mjs";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const defaultClientDir = resolve(moduleDir, "../dist/client");
const defaultEventsPath = join(homedir(), ".codex", "ai-office", "events.jsonl");
const HOST = "127.0.0.1";
const DEFAULT_PORT = 4175;
const MAX_EVENTS = 50_000;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

async function appendJsonLines(events, eventsPath) {
  try {
    await access(eventsPath);
  } catch {
    return;
  }

  try {
    const input = createReadStream(eventsPath, { encoding: "utf8" });
    const lines = createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        events.push(parsed);
        if (events.length > MAX_EVENTS) events.shift();
      } catch {
        // Ignore an incomplete final write or an invalid historical line.
      }
    }
  } catch (error) {
    if (error?.code === "ENOENT") throw error;
    throw error;
  }
}

async function readJsonLines(eventsPath) {
  const events = [];
  try {
    await appendJsonLines(events, `${eventsPath}.1`);
    await appendJsonLines(events, eventsPath);
    return events;
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function sendJson(response, statusCode, payload, method = "GET") {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "X-Content-Type-Options": "nosniff",
  });
  response.end(method === "HEAD" ? undefined : body);
}

async function sendFile(response, filePath, method) {
  const fileStats = await stat(filePath);
  if (!fileStats.isFile()) throw Object.assign(new Error("Not a file"), { code: "ENOENT" });
  response.writeHead(200, {
    "Cache-Control": extname(filePath) === ".html" ? "no-cache" : "public, max-age=3600",
    "Content-Type": MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream",
    "Content-Length": fileStats.size,
    "X-Content-Type-Options": "nosniff",
  });
  if (method === "HEAD") return response.end();
  createReadStream(filePath).pipe(response);
}

function staticCandidate(clientRoot, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relativePath = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const candidate = resolve(clientRoot, relativePath);
  return candidate === clientRoot || candidate.startsWith(`${clientRoot}${sep}`) ? candidate : null;
}

export function createOfficeServer({ eventsPath = process.env.AI_OFFICE_EVENTS_PATH || defaultEventsPath, clientDir = defaultClientDir, now = () => new Date() } = {}) {
  const clientRoot = resolve(clientDir);
  return createServer(async (request, response) => {
    const method = request.method || "GET";
    const url = new URL(request.url || "/", `http://${HOST}`);

    try {
      if (url.pathname === "/api/events") {
        if (!["GET", "HEAD"].includes(method)) {
          response.setHeader("Allow", "GET, HEAD");
          return sendJson(response, 405, { error: "method_not_allowed" }, method);
        }
        const rawEvents = await readJsonLines(eventsPath);
        return sendJson(response, 200, reduceEvents(rawEvents, { now: now() }), method);
      }

      if (!["GET", "HEAD"].includes(method)) return sendJson(response, 405, { error: "method_not_allowed" }, method);
      const candidate = staticCandidate(clientRoot, url.pathname);
      if (!candidate) return sendJson(response, 403, { error: "forbidden" }, method);

      try {
        await sendFile(response, candidate, method);
      } catch (error) {
        if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
        const acceptsHtml = request.headers.accept?.includes("text/html");
        if (!acceptsHtml || url.pathname.startsWith("/api/")) return sendJson(response, 404, { error: "not_found" }, method);
        await sendFile(response, join(clientRoot, "index.html"), method);
      }
    } catch {
      if (!response.headersSent) sendJson(response, 500, { error: "internal_error" }, method);
      else response.destroy();
    }
  });
}

export async function startOfficeServer({ port = Number(process.env.AI_OFFICE_PORT) || DEFAULT_PORT } = {}) {
  const server = createOfficeServer();
  await new Promise((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(port, HOST, resolveReady);
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  process.stdout.write(`AI Office: http://${HOST}:${actualPort}\n`);
  return server;
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) startOfficeServer().catch(() => { process.stderr.write("AI Office server failed to start.\n"); process.exitCode = 1; });

export { HOST, defaultEventsPath };
