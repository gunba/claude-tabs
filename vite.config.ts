import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],
  assetsInclude: ["**/*.wasm"],
  test: {
    exclude: [...configDefaults.exclude, "**/.claude_tabs/worktrees/**", "**/.claude/worktrees/**"],
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
    minify: "terser",
    rollupOptions: {},
  },
}));
