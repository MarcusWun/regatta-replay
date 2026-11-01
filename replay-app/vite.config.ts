import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

const resolve = (p: string): string =>
  fileURLToPath(new URL(p, import.meta.url));

// Browser-side shims for Node builtins pulled in by the vendor-copied
// `src/lib/polar-engine/polar-engine.ts`. The engine's class methods that
// touch fs/path/os are never invoked from the Replay UI — only pure
// `interpolateSpeed` and parser methods (via the `pol-parser.ts` facade) —
// but Vite still has to resolve the imports at bundle time.
const nodeShims = {
  fs: resolve("./src/lib/polar-engine/shims/node-fs.ts"),
  path: resolve("./src/lib/polar-engine/shims/node-path.ts"),
  os: resolve("./src/lib/polar-engine/shims/node-os.ts"),
};

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],

  resolve: {
    alias: nodeShims,
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
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
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
