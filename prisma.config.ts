import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Migrate/Studio/db push need a direct (non-pooled) connection.
    url: env("DIRECT_URL"),
  },
});
