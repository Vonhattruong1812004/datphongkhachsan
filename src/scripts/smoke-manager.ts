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
  const page = await fetch(`${baseUrl}/manager/customers`, {
    headers: { Cookie: cookieJar },
    redirect: "manual"
  });

  if (page.status !== 200) {
    throw new Error(`Manager customers page failed: ${page.status}`);
  }

  const token = extractCsrfToken(await page.text());
  if (!token) {
    throw new Error("Manager customers page did not expose CSRF token");
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
  let createdCustomerId = 0;

  try {
    const manager = await loginManager(baseUrl);
    const csrfToken = await getManagerCsrf(baseUrl, manager.cookieJar);
    const stamp = Date.now();
    const customer = {
      username: `manager_smoke_${stamp}`,
      ten_kh: `Smoke Manager ${stamp}`,
      sdt: `091${String(stamp).slice(-7)}`,
      email: `manager_smoke_${stamp}@example.com`,
      cccd: `8${String(stamp).slice(-11).padStart(11, "0")}`,
      dia_chi: "Smoke manager address",
      loai_khach: "CaNhan",
      password: "Smoke@123",
      force_create: "1"
    };

    const missingCsrf = await requestJson(`${baseUrl}/api/manager/customers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: manager.cookieJar
      },
      body: JSON.stringify(customer)
    });

    if (missingCsrf.response.status !== 403) {
      throw new Error(`Manager API without CSRF should be rejected, got ${missingCsrf.response.status}`);
    }

    const createResult = await requestJson(`${baseUrl}/api/manager/customers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: manager.cookieJar,
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify(customer)
    });

    if (!createResult.response.ok || !createResult.json?.ok || !createResult.json?.data?.id) {
      throw new Error(`Create manager customer failed: ${createResult.response.status} ${createResult.json?.message || createResult.text}`);
    }

    createdCustomerId = Number(createResult.json.data.id);

    const detail = await requestJson(`${baseUrl}/api/manager/customers/${createdCustomerId}`, {
      headers: {
        Accept: "application/json",
        Cookie: manager.cookieJar
      }
    });

    if (!detail.response.ok || !detail.json?.ok || Number(detail.json?.data?.customer?.id || 0) !== createdCustomerId) {
      throw new Error(`Manager customer detail failed: ${detail.response.status}`);
    }

    const updateResult = await requestJson(`${baseUrl}/api/manager/customers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: manager.cookieJar,
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify({
        ...customer,
        customer_id: String(createdCustomerId),
        ten_kh: `${customer.ten_kh} Updated`,
        password: ""
      })
    });

    if (!updateResult.response.ok || !updateResult.json?.ok) {
      throw new Error(`Update only customer name should not trigger duplicate error: ${updateResult.response.status} ${updateResult.json?.message || updateResult.text}`);
    }

    const deleteResult = await requestJson(`${baseUrl}/api/manager/customers/${createdCustomerId}/delete`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Cookie: manager.cookieJar,
        "x-csrf-token": csrfToken
      }
    });

    if (!deleteResult.response.ok || !deleteResult.json?.ok) {
      throw new Error(`Delete new manager customer failed: ${deleteResult.response.status} ${deleteResult.json?.message || deleteResult.text}`);
    }

    const accountStatus = await query<{ trangThai: string }>(
      "SELECT trangthai AS \"trangThai\" FROM taikhoan WHERE lower(username) = lower($1) LIMIT 1",
      [customer.username]
    );

    if (accountStatus.rows[0]?.trangThai !== "Ngung") {
      throw new Error("Deleted manager-created customer account was not disabled.");
    }

    console.log("Manager smoke success");
    console.log(`manager=${manager.username}`);
    console.log(`customer_created=${createdCustomerId}`);
    console.log("update_same_identity=ok");
    console.log("delete_without_transactions=ok");
    console.log("csrf_missing_rejected=403");
  } finally {
    if (createdCustomerId > 0) {
      await query("UPDATE taikhoan SET trangthai = 'Ngung' WHERE makhachhang = $1", [createdCustomerId]).catch(() => undefined);
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
  console.error("Manager smoke failed");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
