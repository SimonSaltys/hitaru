import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { mpvBridge } from "./bridge/plugin.ts";

export default defineConfig({
  plugins: [react(), mpvBridge()],
  server: { watch: { ignored: ["**/aligner/**"] } },
});
