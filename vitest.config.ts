import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"
import viteReact from "@vitejs/plugin-react"

// Vitest must run under Node, not Bun: tinypool is Node machinery and Bun
// either runs zero tests and exits 0 or diverges module state across vi.mock
// boundaries. `bun run test` is fine — it honours vitest's node shebang.
if (process.versions.bun) {
  throw new Error(
    "Vitest must run under Node, not Bun. Use `bun run test` or `npx vitest run` — " +
      "never `bun --bun run test` / `bunx --bun vitest`.",
  )
}

export default defineConfig({
  plugins: [viteReact()] as never,
  resolve: {
    alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) },
    dedupe: ["react", "react-dom"],
  },
  test: {
    // Environment by file extension: booting jsdom costs ~400ms a file and
    // most of this suite is pure logic, so `.test.ts` runs under node and
    // `.test.tsx` — a React test — gets jsdom. A `.test.ts` that needs a DOM
    // opts in with `// @vitest-environment jsdom` on its first line.
    projects: [
      {
        extends: true,
        test: { name: "node", include: ["src/**/*.test.ts", "scripts/**/*.test.ts"], environment: "node" },
      },
      {
        extends: true,
        test: { name: "dom", include: ["src/**/*.test.tsx"], environment: "jsdom" },
      },
    ],
    setupFiles: ["./vitest.setup.ts"],
  },
})
