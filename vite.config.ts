import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwind from "@tailwindcss/vite"
import path from "node:path"

// The demo app: the library plus a small host around it. `/api/*` goes to the
// room hub (server/hub-server.ts) so multiplayer works in dev; with the hub
// down the room still runs, single-player.
export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: { alias: { "~": path.resolve(__dirname, "src") } },
  server: {
    port: 3000,
    proxy: { "/api": { target: "http://localhost:8787", changeOrigin: true } },
  },
})
