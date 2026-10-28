import { defineConfig } from "vitest/config";

// The database tests wipe one shared Postgres: files run one after the other. isolated-vm needs
// Node's startup snapshot off in every process that creates isolates.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: "forks",
    poolOptions: { forks: { execArgv: ["--no-node-snapshot"] } },
  },
});
