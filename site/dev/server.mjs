// Local stand-in for Vercel: serves the static site and routes /api/* to the same handlers.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
const port = Number(process.env.PORT || 3000);

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/api/")) {
    const name = url.pathname.slice(5).replace(/[^a-z]/g, "");
    try {
      const mod = await import(join(root, "api", name + ".js"));
      return mod.default(req, res);
    } catch (e) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: "No such endpoint" }));
    }
  }
  // Same routing as Vercel: redirects first (vercel.json), then clean URLs and folder index pages.
  const cfg = JSON.parse(await readFile(join(root, "vercel.json"), "utf8"));
  const hit = (cfg.redirects || []).find((r) => r.source === url.pathname || (r.source.endsWith("/:path*") && url.pathname.startsWith(r.source.slice(0, -7))));
  if (hit) { res.statusCode = 307; res.setHeader("location", hit.destination); return res.end(); }
  let path = url.pathname;
  if (path.endsWith("/")) path += "index.html";
  else if (!extname(path)) path += ".html";
  const p = normalize(join(root, path));
  if (!p.startsWith(root)) { res.statusCode = 403; return res.end(); }
  try {
    const body = await readFile(p);
    res.setHeader("content-type", types[extname(p)] || "application/octet-stream");
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
