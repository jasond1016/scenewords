import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "/static/",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: path.resolve(ROOT_DIR, "../app/static"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
