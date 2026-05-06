import { AddressInfo } from "node:net";
import { createApp } from "../app";
import { pool, query } from "../config/database";
import { ROLE, ROLE_LABELS } from "../shared/constants/roles";

type AccountRow = {
  username: string;
  roleId: number;
  roleName: string;
};

const PASSWORD_CANDIDATES = ["123456", "Abc@123", "admin123", "Admin@123"];

function readSetCookies(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

function parseCookiePair(raw: string) {
  const separatorIndex = raw.indexOf("=");
  if (separatorIndex <= 0) {
    return null;
  }

  return {
    key: raw.slice(0, separatorIndex),
    value: raw.slice(separatorIndex + 1)
  };
}

function appendCookies(existing: string, response: Response) {
  const cookies = readSetCookies(response)
    .map((item) => item.split(";")[0]?.trim())
    .filter(Boolean) as string[];

  const merged = new Map<string, string>();
  for (const raw of existing.split(";").map((item) => item.trim()).filter(Boolean)) {
    const parsed = parseCookiePair(raw);
    if (parsed) merged.set(parsed.key, parsed.value);
  }
  for (const raw of cookies) {
    const parsed = parseCookiePair(raw);
    if (parsed) merged.set(parsed.key, parsed.value);
  }

  return [...merged.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

function extractCsrfToken(html: string) {
  return html.match(/<meta\s+name="csrf-token"\s+content="([^"]*)"/i)?.[1] || "";
}

function dateInput(daysFromNow: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
}

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const text = await response.text();
  let json: any = null;

  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return { response, json, text };
}

async function findManagerAccounts() {
  const result = await query<AccountRow>(
    `
      SELECT
        tk.username,
        tk.mavaitro AS "roleId",
        vt.tenvaitro AS "roleName"
      FROM taikhoan tk
      INNER JOIN vaitro vt ON vt.mavaitro = tk.mavaitro
      WHERE tk.trangthai = 'HoatDong' AND tk.mavaitro = $1
      ORDER BY tk.matk ASC
    `,
    [ROLE.QUAN_LY]
  );

  return result.rows;
}

async function login(baseUrl: string, username: string, password: string) {
  let cookieJar = "";
  const loginPage = await fetch(`${baseUrl}/auth/login`, { redirect: "manual" });
  cookieJar = appendCookies(cookieJar, loginPage);

  const csrfToken = extractCsrfToken(await loginPage.text());
  if (!csrfToken) {
    throw new Error("Login page did not expose CSRF token");
  }

  const body = new URLSearchParams({
    _csrf: csrfToken,
    username,
    password
  });

  const response = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieJar
    },
    redirect: "manual",
    body: body.toString()
  });

  if (![302, 303].includes(response.status)) {
    return "";
  }

  return appendCookies(cookieJar, response);
}

async function loginManager(baseUrl: string) {
  const accounts = await findManagerAccounts();

  for (const account of accounts) {
    for (const password of PASSWORD_CANDIDATES) {
      const cookieJar = await login(baseUrl, account.username, password);
      if (cookieJar) {
        return {
          username: account.username,
          roleName: account.roleName || ROLE_LABELS[ROLE.QUAN_LY],
          cookieJar
        };
      }
    }
  }

  throw new Error("Không đăng nhập được tài khoản quản lý active bằng mật khẩu demo.");
}

async function getManagerCsrf(baseUrl: string, cookieJar: string) {
  const page = await fetch(`${baseUrl}/manager/promotions`, {
    headers: { Cookie: cookieJar },
    redirect: "manual"
  });

  if (page.status !== 200) {
    throw new Error(`Manager promotions page failed: ${page.status}`);
  }

  const token = extractCsrfToken(await page.text());
  if (!token) {
    throw new Error("Manager promotions page did not expose CSRF token");
  }

  return token;
}

async function usedPromotionId() {
  const result = await query<{ id: number }>(
    `
      SELECT km.makhuyenmai AS id
      FROM khuyenmai km
      WHERE EXISTS (SELECT 1 FROM giaodich gd WHERE gd.makhuyenmai = km.makhuyenmai)
         OR EXISTS (SELECT 1 FROM chitietgiaodich ct WHERE ct.makhuyenmai = km.makhuyenmai)
      ORDER BY km.makhuyenmai ASC
      LIMIT 1
    `
  );

  return Number(result.rows[0]?.id || 0);
}

async function main() {
  const app = createApp();
  const server = await new Promise<import("node:http").Server>((resolve, reject) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    instance.on("error", reject);
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let createdPromotionId = 0;

  try {
    const manager = await loginManager(baseUrl);
    const csrfToken = await getManagerCsrf(baseUrl, manager.cookieJar);
    const lockedPromotionId = await usedPromotionId();
    const stamp = Date.now();
    const promotion = {
      ten_chuong_trinh: `Smoke Promo ${stamp}`,
      ngay_bat_dau: dateInput(1),
      ngay_ket_thuc: dateInput(20),
      muc_uu_dai: "12",
      doi_tuong: "TatCa",
      trang_thai: "DangApDung",
      loai_uu_dai: "PERCENT"
    };

    const missingCsrf = await requestJson(`${baseUrl}/api/manager/promotions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: manager.cookieJar
      },
      body: JSON.stringify(promotion)
    });

    if (missingCsrf.response.status !== 403) {
      throw new Error(`Manager promotion API without CSRF should be rejected, got ${missingCsrf.response.status}`);
    }

    const invalidPercent = await requestJson(`${baseUrl}/api/manager/promotions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: manager.cookieJar,
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify({
        ...promotion,
        ten_chuong_trinh: `${promotion.ten_chuong_trinh} Invalid Percent`,
        muc_uu_dai: "150"
      })
    });

    if (invalidPercent.response.status !== 422) {
      throw new Error(`Percent promotion above 100 should be rejected, got ${invalidPercent.response.status}`);
    }

    const invalidDate = await requestJson(`${baseUrl}/api/manager/promotions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: manager.cookieJar,
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify({
        ...promotion,
        ten_chuong_trinh: `${promotion.ten_chuong_trinh} Invalid Date`,
        ngay_bat_dau: dateInput(20),
        ngay_ket_thuc: dateInput(1)
      })
    });

    if (invalidDate.response.status !== 422) {
      throw new Error(`Promotion end date before start date should be rejected, got ${invalidDate.response.status}`);
    }

    const createResult = await requestJson(`${baseUrl}/api/manager/promotions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: manager.cookieJar,
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify(promotion)
    });

    if (!createResult.response.ok || !createResult.json?.ok || !createResult.json?.data?.id) {
      throw new Error(`Create manager promotion failed: ${createResult.response.status} ${createResult.json?.message || createResult.text}`);
    }

    createdPromotionId = Number(createResult.json.data.id);
    if (Number(createResult.json.data.announcementRecipientCount || 0) <= 0) {
      throw new Error("Creating promotion should queue announcement recipients for CSKH.");
    }

    const campaign = await query<{ total: number }>(
      `
        SELECT COUNT(*)::int AS total
        FROM cskh_broadcast_campaign
        WHERE metadata->>'promotionId' = $1
      `,
      [String(createdPromotionId)]
    );

    if (Number(campaign.rows[0]?.total || 0) <= 0) {
      throw new Error("Promotion creation did not create broadcast campaign metadata.");
    }

    const updateResult = await requestJson(`${baseUrl}/api/manager/promotions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: manager.cookieJar,
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify({
        ...promotion,
        promotion_id: String(createdPromotionId),
        muc_uu_dai: "15",
        trang_thai: "TamNgung"
      })
    });

    if (!updateResult.response.ok || !updateResult.json?.ok) {
      throw new Error(`Update same promotion name should not trigger duplicate error: ${updateResult.response.status} ${updateResult.json?.message || updateResult.text}`);
    }

    const duplicateResult = await requestJson(`${baseUrl}/api/manager/promotions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: manager.cookieJar,
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify({
        ...promotion,
        muc_uu_dai: "10"
      })
    });

    if (duplicateResult.response.status !== 409) {
      throw new Error(`Duplicate promotion name should be rejected, got ${duplicateResult.response.status}`);
    }

    if (lockedPromotionId > 0) {
      const lockedDelete = await requestJson(`${baseUrl}/api/manager/promotions/${lockedPromotionId}/delete`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Cookie: manager.cookieJar,
          "x-csrf-token": csrfToken
        }
      });

      if (lockedDelete.response.status !== 409) {
        throw new Error(`Delete promotion with transaction usage should be rejected, got ${lockedDelete.response.status}`);
      }
    }

    const deleteResult = await requestJson(`${baseUrl}/api/manager/promotions/${createdPromotionId}/delete`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Cookie: manager.cookieJar,
        "x-csrf-token": csrfToken
      }
    });

    if (!deleteResult.response.ok || !deleteResult.json?.ok) {
      throw new Error(`Delete new manager promotion failed: ${deleteResult.response.status} ${deleteResult.json?.message || deleteResult.text}`);
    }

    const afterDelete = await query<{ total: number }>(
      "SELECT COUNT(*)::int AS total FROM khuyenmai WHERE makhuyenmai = $1",
      [createdPromotionId]
    );

    if (Number(afterDelete.rows[0]?.total || 0) !== 0) {
      throw new Error("Deleted test promotion still exists in database.");
    }

    console.log("Manager promotion smoke success");
    console.log(`manager=${manager.username}`);
    console.log(`promotion_created=${createdPromotionId}`);
    console.log("invalid_percent_rejected=422");
    console.log("invalid_date_rejected=422");
    console.log("update_same_name=ok");
    console.log("duplicate_promotion_rejected=409");
    console.log(`delete_used_promotion_rejected=${lockedPromotionId > 0 ? 409 : "skipped"}`);
    console.log("delete_without_usage=ok");
    console.log("broadcast_queue=ok");
  } finally {
    if (createdPromotionId > 0) {
      await query("DELETE FROM khuyenmai WHERE makhuyenmai = $1", [createdPromotionId]).catch(() => undefined);
    }

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Manager promotion smoke failed");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
