import { AddressInfo } from "node:net";
import { createApp } from "../app";
import { pool, query } from "../config/database";
import { ROLE, ROLE_LABELS } from "../shared/constants/roles";

type AccountRow = {
  username: string;
  roleId: number;
  roleName: string;
};

type ActorSession = {
  username: string;
  roleId: number;
  roleName: string;
  cookieJar: string;
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

async function findActiveAccounts() {
  const result = await query<AccountRow>(
    `
      SELECT
        tk.username,
        tk.mavaitro AS "roleId",
        vt.tenvaitro AS "roleName"
      FROM taikhoan tk
      INNER JOIN vaitro vt ON vt.mavaitro = tk.mavaitro
      WHERE tk.trangthai = 'HoatDong'
      ORDER BY tk.mavaitro ASC, tk.matk ASC
    `
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

async function loginRole(baseUrl: string, roleId: number, accounts: AccountRow[]): Promise<ActorSession> {
  const roleAccounts = accounts.filter((item) => item.roleId === roleId);

  for (const account of roleAccounts) {
    for (const password of PASSWORD_CANDIDATES) {
      const cookieJar = await login(baseUrl, account.username, password);
      if (cookieJar) {
        return {
          username: account.username,
          roleId,
          roleName: account.roleName || ROLE_LABELS[roleId] || String(roleId),
          cookieJar
        };
      }
    }
  }

  throw new Error(`Không đăng nhập được tài khoản active cho role ${ROLE_LABELS[roleId] || roleId}.`);
}

async function getCsrf(baseUrl: string, route: string, cookieJar: string, label: string) {
  const page = await fetch(`${baseUrl}${route}`, {
    headers: { Cookie: cookieJar },
    redirect: "manual"
  });

  if (page.status !== 200) {
    throw new Error(`${label} page failed: ${page.status}`);
  }

  const token = extractCsrfToken(await page.text());
  if (!token) {
    throw new Error(`${label} page did not expose CSRF token`);
  }

  return token;
}

async function main() {
  const app = createApp();
  const server = await new Promise<import("node:http").Server>((resolve, reject) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    instance.on("error", reject);
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let createdFeedbackId = 0;

  try {
    const accounts = await findActiveAccounts();
    const customer = await loginRole(baseUrl, ROLE.KHACH_HANG, accounts);
    const staff = await loginRole(baseUrl, ROLE.CSKH, accounts);
    const customerCsrf = await getCsrf(baseUrl, "/feedback/new", customer.cookieJar, "Customer feedback");
    const staffCsrf = await getCsrf(baseUrl, "/feedback/manage", staff.cookieJar, "Feedback management");

    const customerCannotList = await fetch(`${baseUrl}/api/feedback`, {
      headers: { Cookie: customer.cookieJar },
      redirect: "manual"
    });
    if (customerCannotList.status !== 403) {
      throw new Error(`Customer should not list staff feedback inbox, got ${customerCannotList.status}`);
    }

    const missingCsrf = await requestJson(`${baseUrl}/api/feedback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: customer.cookieJar
      },
      body: JSON.stringify({
        loai_dich_vu: "SPA",
        muc_do_hai_long: 2,
        noi_dung: "Smoke feedback thiếu CSRF để kiểm tra lớp bảo mật."
      })
    });
    if (missingCsrf.response.status !== 403) {
      throw new Error(`Feedback create without CSRF should be rejected, got ${missingCsrf.response.status}`);
    }

    const createResult = await requestJson(`${baseUrl}/api/feedback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: customer.cookieJar,
        "x-csrf-token": customerCsrf
      },
      body: JSON.stringify({
        loai_dich_vu: "SPA",
        muc_do_hai_long: 2,
        noi_dung: `Smoke feedback ${Date.now()} - trải nghiệm spa hơi chậm nhưng nhân viên hỗ trợ tốt.`
      })
    });
    if (createResult.response.status !== 200 || !createResult.json?.data?.id) {
      throw new Error(`Feedback create failed: ${createResult.response.status} ${createResult.text}`);
    }
    createdFeedbackId = Number(createResult.json.data.id);

    const detailResult = await requestJson(`${baseUrl}/api/feedback/${createdFeedbackId}`, {
      headers: {
        Accept: "application/json",
        Cookie: staff.cookieJar
      }
    });
    if (detailResult.response.status !== 200 || detailResult.json?.data?.detail?.id !== createdFeedbackId) {
      throw new Error(`Staff feedback detail failed: ${detailResult.response.status} ${detailResult.text}`);
    }
    if (detailResult.json.data.detail.trangThai !== "ChuaXuLy") {
      throw new Error(`New feedback should start as ChuaXuLy, got ${detailResult.json.data.detail.trangThai}`);
    }
    if (!["Negative", "Neutral", "Positive"].includes(detailResult.json.data.detail.sentiment)) {
      throw new Error("Feedback sentiment was not computed.");
    }

    const staffCannotCreate = await requestJson(`${baseUrl}/api/feedback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: staff.cookieJar,
        "x-csrf-token": staffCsrf
      },
      body: JSON.stringify({
        loai_dich_vu: "Nhà hàng",
        muc_do_hai_long: 5,
        noi_dung: "CSKH không được tạo phản hồi thay actor khách hàng qua endpoint này."
      })
    });
    if (staffCannotCreate.response.status !== 403) {
      throw new Error(`Staff should not create customer feedback through customer endpoint, got ${staffCannotCreate.response.status}`);
    }

    const replyMissingCsrf = await requestJson(`${baseUrl}/api/feedback/${createdFeedbackId}/reply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: staff.cookieJar
      },
      body: JSON.stringify({
        status: "DangXuLy",
        reply: "Đã tiếp nhận phản hồi smoke."
      })
    });
    if (replyMissingCsrf.response.status !== 403) {
      throw new Error(`Feedback reply without CSRF should be rejected, got ${replyMissingCsrf.response.status}`);
    }

    const replyResult = await requestJson(`${baseUrl}/api/feedback/${createdFeedbackId}/reply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: staff.cookieJar,
        "x-csrf-token": staffCsrf
      },
      body: JSON.stringify({
        status: "DangXuLy",
        reply: "CSKH đã tiếp nhận phản hồi smoke và chuyển sang theo dõi xử lý."
      })
    });
    if (replyResult.response.status !== 200 || replyResult.json?.data?.detail?.trangThai !== "DangXuLy") {
      throw new Error(`Feedback reply failed: ${replyResult.response.status} ${replyResult.text}`);
    }
    if (!Array.isArray(replyResult.json.data.replies) || replyResult.json.data.replies.length < 1) {
      throw new Error("Feedback reply was not persisted.");
    }

    const statusResult = await requestJson(`${baseUrl}/api/feedback/${createdFeedbackId}/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: staff.cookieJar,
        "x-csrf-token": staffCsrf
      },
      body: JSON.stringify({
        status: "DaXuLy"
      })
    });
    if (statusResult.response.status !== 200) {
      throw new Error(`Feedback status update failed: ${statusResult.response.status} ${statusResult.text}`);
    }

    const dbCheck = await query<{ status: string; replies: number }>(
      `
        SELECT
          ph.tinhtrang AS status,
          COUNT(ct.mactphanhoi)::int AS replies
        FROM phanhoi ph
        LEFT JOIN chitietphanhoi ct ON ct.maphanhoi = ph.maph
        WHERE ph.maph = $1
        GROUP BY ph.maph, ph.tinhtrang
      `,
      [createdFeedbackId]
    );
    if (dbCheck.rows[0]?.status !== "DaXuLy" || Number(dbCheck.rows[0]?.replies || 0) < 1) {
      throw new Error("Feedback DB state is not consistent after reply/status flow.");
    }

    console.log("Feedback smoke success");
    console.log(`customer=${customer.username}`);
    console.log(`staff=${staff.username}`);
    console.log(`feedback_created=${createdFeedbackId}`);
    console.log("customer_create=ok");
    console.log("staff_reply=ok");
    console.log("status_update=ok");
    console.log("csrf_missing_rejected=403");
    console.log("role_boundaries=ok");
  } finally {
    if (createdFeedbackId) {
      await query("DELETE FROM chitietphanhoi WHERE maphanhoi = $1", [createdFeedbackId]);
      await query("DELETE FROM phanhoi WHERE maph = $1", [createdFeedbackId]);
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
