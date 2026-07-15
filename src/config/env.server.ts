import "server-only";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.url(),
  DIRECT_URL: z.url(),
});

export const serverEnv = schema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  DIRECT_URL: process.env.DIRECT_URL,
});
