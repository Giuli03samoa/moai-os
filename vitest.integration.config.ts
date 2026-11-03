import { defineConfig } from "vitest/config";
import path from "node:path";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://moai:moai-local-dev-only@localhost:54329/moai_test";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 120000,
    globalSetup: ["tests/integration/global-setup.ts"],
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      APP_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
      STORAGE_LOCAL_DIR: "./.local/test-storage",
    },
  },
});
