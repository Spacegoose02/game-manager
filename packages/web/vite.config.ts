import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { brandPlugin } from "./brand";

// In development the UI runs on :5173 and forwards API calls to the server on :8080.
export default defineConfig({
  plugins: [react(), brandPlugin()],
  server: { proxy: { "/api": process.env.GM_DEV_API || "http://localhost:8080" } },
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 800 },
});
