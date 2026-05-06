import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3010),
  APP_NAME: z.string().default("Bento Resort"),
  SESSION_SECRET: z.string().min(8),
  PGHOST: z.string(),
  PGPORT: z.coerce.number().default(5432),
  PGUSER: z.string(),
  PGPASSWORD: z.string(),
  PGDATABASE: z.string(),
  PGSCHEMA: z.string().default("abc_resort1")
});

export const env = envSchema.parse(process.env);
