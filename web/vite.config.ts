/// <reference types="vitest/config" />
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// ABIs and addresses are read from ../api/src/abi and ../deployments at build time: one source of truth for the API and the app.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: "../api/public", emptyOutDir: true, sourcemap: false },
  server: { port: 5173, strictPort: true, fs: { allow: [".."] } },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
})
