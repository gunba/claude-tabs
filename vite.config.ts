import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],
  resolve: {
    alias: {
      // beta package has wrong module field: addon-canvas.mjs vs actual xterm-addon-canvas.mjs
      "@xterm/addon-canvas": path.resolve(
        __dirname,
        "node_modules/@xterm/addon-canvas/lib/xterm-addon-canvas.mjs",
      ),
    },
  },
  test: {
    exclude: [...configDefaults.exclude, "**/.claude/worktrees/**"],
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          xterm: [
            "@xterm/xterm",
            "@xterm/addon-fit",
            "@xterm/addon-webgl",
            "@xterm/addon-web-links",
          ],
        },
      },
    },
  },
}));
