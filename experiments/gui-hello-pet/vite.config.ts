import { defineConfig } from "vite"
import { gui } from "@opencode/plugin/gui/vite"
import path from "node:path"

// The GUI SDK supplies the Vite plugin. It compiles Solid JSX and writes one
// CommonJS file, keeping the modules the desktop app provides external.
//
// The project root is lifted to the repository root so the shared/ modules are
// inside the build's module graph and get inlined instead of being left as
// runtime requires that OpenCode's loader rejects.
export default defineConfig({
  root: path.resolve(__dirname, "../.."),
  plugins: [gui({ entry: "experiments/gui-hello-pet/src/gui.tsx", outFile: "experiments/gui-hello-pet/dist/gui-experimental.cjs" })],
  build: {
    minify: false,
    sourcemap: true,
  },
})
