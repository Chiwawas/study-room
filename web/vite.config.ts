import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 开发时页面跑在 5173，接口和配图转给 npm start 起的服务
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://127.0.0.1:4173", "/fig": "http://127.0.0.1:4173" } },
});
