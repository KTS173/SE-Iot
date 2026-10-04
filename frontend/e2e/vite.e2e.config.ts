// Dev server for the E2E suite: the app's own vite.config.ts plus a same-origin
// /api proxy, the way nginx serves it in production. App source is untouched.
import { defineConfig, mergeConfig } from "vite";
import base from "../vite.config";

// frontend/.env points VITE_API_URL at a local backend on :5000; an existing
// variable beats .env files, so force same-origin requests through the proxy.
process.env.VITE_API_URL = "";

const apiPort = process.env.E2E_API_PORT ?? "5011";
const webPort = Number(process.env.E2E_WEB_PORT ?? "5199");

export default mergeConfig(
  base,
  defineConfig({
    server: {
      host: "localhost",
      port: webPort,
      strictPort: true,
      proxy: { "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } },
    },
  }),
);
