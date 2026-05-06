import { Pool } from "pg";
import { env } from "./env";

interface AppQueryResult<T> {
  rows: T[];
  rowCount: number | null;
}

export const pool = new Pool({
  host: env.PGHOST,
  port: env.PGPORT,
  user: env.PGUSER,
  password: env.PGPASSWORD,
  database: env.PGDATABASE,
  options: `-c search_path=${env.PGSCHEMA},public`
});

export async function query<T = any>(
  text: string,
  params: unknown[] = []
): Promise<AppQueryResult<T>> {
  const result = await pool.query(text, params);
  return result as AppQueryResult<T>;
}

export async function withTransaction<T>(handler: (client: any) => Promise<T>) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL search_path TO ${env.PGSCHEMA},public`);
    const result = await handler(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
