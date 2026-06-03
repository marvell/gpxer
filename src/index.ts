import { serve } from "bun";
import index from "./index.html";

const isProduction = process.env.NODE_ENV === "production";

const server = serve({
  hostname: isProduction ? "0.0.0.0" : undefined,

  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,
  },

  development: !isProduction && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
