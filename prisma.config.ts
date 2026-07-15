import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

// dotenv only loads `.env` by default; this project follows Next.js's own
// convention of keeping real local secrets in `.env.local` instead.
config({ path: ".env.local" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Migrate/Studio/db push need a direct (non-pooled) connection.
    url: env("DIRECT_URL"),
  },
});
