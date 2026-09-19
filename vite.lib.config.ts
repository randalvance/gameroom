import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwind from "@tailwindcss/vite"
import dts from "vite-plugin-dts"
import path from "node:path"

// The library build: src/index.ts in, dist/ out.
//
// React, react-dom and three are EXTERNAL — bundling them would give a host
// app a second copy of React (hooks see a null dispatcher) and a second WebGL
// renderer. They are peer dependencies for the same reason.
export default defineConfig({
  plugins: [
    react(),
    tailwind(),
    dts({ include: ["src"], exclude: ["src/**/*.test.*", "src/app/**", "src/main.tsx"], rollupTypes: false }),
  ],
  resolve: { alias: { "~": path.resolve(__dirname, "src") } },
  // The assets ship as `public/` in the package (see package.json "files"),
  // so the library build must not copy 78MB of them into dist as well.
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      // Two entries: the components, and the hub. The hub is server-side
      // JavaScript with no React in it — a host running its own room server
      // imports "@gameroom/react/hub" and never pulls the browser bundle in.
      entry: {
        gameroom: path.resolve(__dirname, "src/index.ts"),
        "server/hub": path.resolve(__dirname, "src/server/hub.ts"),
      },
      formats: ["es"],
      fileName: (_format, name) => `${name}.js`,
      cssFileName: "gameroom",
    },
    rollupOptions: {
      external: [/^react($|\/)/, /^react-dom($|\/)/, /^three($|\/)/],
    },
  },
})
