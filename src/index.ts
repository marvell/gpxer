import { serve } from "bun";
import path from "node:path";
import index from "./index.html";

const isProduction = process.env.NODE_ENV === "production";
const distDir = path.resolve(import.meta.dir, "..", "dist");

const server = isProduction ? serve({
  hostname: "0.0.0.0",

  async fetch(request) {
    const url = new URL(request.url);
    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = path.resolve(distDir, `.${pathname}`);
    const relativePath = path.relative(distDir, filePath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      return new Response("Not found", { status: 404 });
    }
    const file = Bun.file(filePath);

    if (await file.exists()) {
      return new Response(file);
    }

    return new Response(Bun.file(path.join(distDir, "index.html")));
  },
}) : serve({
  hostname: isProduction ? "0.0.0.0" : undefined,

  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,
  },

  development: {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
