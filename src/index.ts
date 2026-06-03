import { serve } from "bun";
import path from "node:path";
import index from "./index.html";

const isProduction = process.env.NODE_ENV === "production";
const distDir = path.resolve(import.meta.dir, "..", "dist");

type RouteType = "static" | "spa" | "not_found" | "error";

function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const commaIndex = forwardedFor.indexOf(",");
    return (commaIndex === -1 ? forwardedFor : forwardedFor.slice(0, commaIndex)).trim();
  }

  return request.headers.get("x-real-ip") ?? "";
}

function logAccess(request: Request, pathname: string, status: number, startedAt: number, routeType: RouteType): void {
  console.log(JSON.stringify({
    type: "access",
    timestamp: new Date().toISOString(),
    method: request.method,
    pathname,
    status,
    durationMs: Math.round(performance.now() - startedAt),
    clientIp: getClientIp(request),
    userAgent: request.headers.get("user-agent") ?? "",
    routeType,
  }));
}

const server = isProduction ? serve({
  hostname: "0.0.0.0",

  async fetch(request) {
    const startedAt = performance.now();
    const requestedPathname = new URL(request.url).pathname;

    try {
      const assetPathname = requestedPathname === "/" ? "/index.html" : requestedPathname;
      const send = (response: Response, routeType: RouteType) => {
        logAccess(request, requestedPathname, response.status, startedAt, routeType);
        return response;
      };
      const filePath = path.resolve(distDir, `.${assetPathname}`);
      const relativePath = path.relative(distDir, filePath);
      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        return send(new Response("Not found", { status: 404 }), "not_found");
      }
      const file = Bun.file(filePath);

      if (await file.exists()) {
        return send(new Response(file), "static");
      }

      return send(new Response(Bun.file(path.join(distDir, "index.html"))), "spa");
    } catch (error) {
      const response = new Response("Internal server error", { status: 500 });
      logAccess(request, requestedPathname, response.status, startedAt, "error");
      console.error(error);
      return response;
    }
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
