import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/vybd_agent_test",
      APP_URL: "http://localhost:3000",
    },
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
  },
});
