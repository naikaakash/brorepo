import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: process.env.VITE_PUBLIC_PREVIEW === "true" ? "/brorepo/" : "/",
  build: { outDir: process.env.VITE_PUBLIC_PREVIEW === "true" ? "dist-public" : "dist" },
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5174, strictPort: true, proxy: { "/api": "http://127.0.0.1:7072" } },
  preview: {
    host: "127.0.0.1", port: 4174, strictPort: true,
    proxy: { "/api": process.env.APPLYMATE_API_URL || "http://127.0.0.1:7072" }
  },
  test: { environment: "jsdom", setupFiles: "./src/test/setup.ts", css: true, fileParallelism: false, maxWorkers: 1, testTimeout: 15000 }
});
