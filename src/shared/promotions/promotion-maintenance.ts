import { query } from "../../config/database";

type QueryRunner = {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
};

export async function expireOutdatedPromotions(runner?: QueryRunner) {
  const db = runner ?? { query };
  await db.query(`
    UPDATE khuyenmai
    SET trangthai = 'HetHan'
    WHERE trangthai = 'DangApDung'
      AND ngayketthuc IS NOT NULL
      AND ngayketthuc < CURRENT_DATE
  `);
}
