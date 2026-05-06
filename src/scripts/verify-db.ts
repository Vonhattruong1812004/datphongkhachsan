import { env } from "../config/env";
import { pool, query } from "../config/database";

async function main() {
  const ping = await query<{ ok: number }>("SELECT 1 AS ok");
  const schema = await query<{ currentSchema: string }>("SELECT current_schema() AS \"currentSchema\"");
  const stats = await query<{
    hotels: number;
    rooms: number;
    customers: number;
    accounts: number;
  }>(
    `
      SELECT
        (SELECT COUNT(*)::int FROM khachsan) AS hotels,
        (SELECT COUNT(*)::int FROM phong) AS rooms,
        (SELECT COUNT(*)::int FROM khachhang) AS customers,
        (SELECT COUNT(*)::int FROM taikhoan) AS accounts
    `
  );

  console.log("DB verify success");
  console.log(`database=${env.PGDATABASE}`);
  console.log(`schema=${schema.rows[0]?.currentSchema ?? "unknown"}`);
  console.log(`ping=${ping.rows[0]?.ok ?? 0}`);
  console.log(`hotels=${stats.rows[0]?.hotels ?? 0}`);
  console.log(`rooms=${stats.rows[0]?.rooms ?? 0}`);
  console.log(`customers=${stats.rows[0]?.customers ?? 0}`);
  console.log(`accounts=${stats.rows[0]?.accounts ?? 0}`);
}

main()
  .catch((error) => {
    console.error("DB verify failed");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
