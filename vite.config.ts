import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { mpvBridge } from "./bridge/plugin.ts";

export default defineConfig(({ mode }) => {
  // HITARU_ settings from .env, for the server only. Ones set in the terminal win.
  for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), "HITARU_"))) {
    process.env[key] ??= value;
  }
  return {
    plugins: [react(), mpvBridge()],
    server: { watch: { ignored: ["**/aligner/**"] } },
  };
});
