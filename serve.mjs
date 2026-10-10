import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 8080);
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".md": "text/plain",
};
http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      let path = resolve(root, "." + decodeURIComponent(url.pathname));
      if (
        path !== root.slice(0, -1) &&
        !path.startsWith(root.endsWith(sep) ? root : root + sep)
      ) {
        res.writeHead(403);
        res.end();
        return;
      }
      if ((await stat(path)).isDirectory()) path = resolve(path, "index.html");
      const data = await readFile(path);
      res.writeHead(200, {
        "Content-Type": types[extname(path)] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  })
  .listen(port, "127.0.0.1", () =>
    console.log(`Deskworlds: http://localhost:${port}`),
  );
