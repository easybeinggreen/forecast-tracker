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
  const p = normalize(join(root, url.pathname === "/" ? "index.html" : url.pathname));
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
