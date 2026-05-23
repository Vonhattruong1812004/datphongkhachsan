import fs from "node:fs/promises";
import path from "node:path";
import { AddressInfo } from "node:net";
import { createApp } from "../app";
import { pool, query } from "../config/database";
import { ROLE, ROLE_LABELS } from "../shared/constants/roles";

type AccountRow = {
  username: string;
  roleId: number;
  roleName: string;
  customerId: number | null;
  customerStatus: string | null;
  latestEkycResult: string | null;
};

type ActorSession = {
  username: string;
  roleId: number;
  roleName: string;
  cookieJar: string;
};

const PASSWORD_CANDIDATES = ["123456", "Abc@123", "admin123", "Admin@123"];
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axp3xkAAAAASUVORK5CYII=",
  "base64"
);

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
        vt.tenvaitro AS "roleName",
        tk.makhachhang AS "customerId",
        kh.trangthaiekyc AS "customerStatus",
        latest.ketquaxacthuc AS "latestEkycResult"
      FROM taikhoan tk
      INNER JOIN vaitro vt ON vt.mavaitro = tk.mavaitro
      LEFT JOIN khachhang kh ON kh.makhachhang = tk.makhachhang
      LEFT JOIN LATERAL (
        SELECT ev.ketquaxacthuc
        FROM ekyc_verification ev
        WHERE ev.makhachhang = tk.makhachhang
        ORDER BY ev.maekyc DESC
        LIMIT 1
      ) latest ON true
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

function buildEkycForm(documentNumber: string) {
  const form = new FormData();
  form.set("document_type", "CCCD");
  form.set("document_number", documentNumber);
  form.set("front", new Blob([PNG_1X1], { type: "image/png" }), "front.png");
  form.set("back", new Blob([PNG_1X1], { type: "image/png" }), "back.png");
  form.set("selfie", new Blob([PNG_1X1], { type: "image/png" }), "selfie.png");
  return form;
}

async function main() {
  const app = createApp();
  const server = await new Promise<import("node:http").Server>((resolve, reject) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    instance.on("error", reject);
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let createdEkycId = 0;
  let customerId = 0;
  let originalCustomerStatus = "ChuaXacThuc";
  let uploadedFiles: string[] = [];

  try {
    const accounts = await findActiveAccounts();
    const customerCandidates = accounts.filter((account) => (
      account.roleId === ROLE.KHACH_HANG
      && account.customerId
      && account.customerStatus !== "DaXacThuc"
      && account.latestEkycResult !== "ThanhCong"
      && account.latestEkycResult !== "DangXuLy"
    ));
    const customer = await loginRole(baseUrl, ROLE.KHACH_HANG, customerCandidates.length ? customerCandidates : accounts);
    const reviewer = await loginRole(baseUrl, ROLE.QUAN_LY, accounts);
    const customerCsrf = await getCsrf(baseUrl, "/ekyc", customer.cookieJar, "Customer eKYC");
    const reviewerCsrf = await getCsrf(baseUrl, "/ekyc/review", reviewer.cookieJar, "eKYC review");

    const statusBefore = await requestJson(`${baseUrl}/api/ekyc/status`, {
      headers: {
        Accept: "application/json",
        Cookie: customer.cookieJar
      }
    });
    if (statusBefore.response.status !== 200 || !statusBefore.json?.data?.customer?.id) {
      throw new Error(`Customer eKYC status failed: ${statusBefore.response.status} ${statusBefore.text}`);
    }
    customerId = Number(statusBefore.json.data.customer.id);
    originalCustomerStatus = statusBefore.json.data.customer.trangThaiEkyc || "ChuaXacThuc";

    const customerCannotReview = await fetch(`${baseUrl}/api/ekyc/review-queue`, {
      headers: { Cookie: customer.cookieJar },
      redirect: "manual"
    });
    if (customerCannotReview.status !== 403) {
      throw new Error(`Customer should not access eKYC review queue, got ${customerCannotReview.status}`);
    }

    const missingCsrf = await requestJson(`${baseUrl}/api/ekyc/submit`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Cookie: customer.cookieJar
      },
      body: buildEkycForm("123456789012")
    });
    if (missingCsrf.response.status !== 403) {
      throw new Error(`eKYC submit without CSRF should be rejected, got ${missingCsrf.response.status}`);
    }

    const invalidDocument = await requestJson(`${baseUrl}/api/ekyc/submit`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Cookie: customer.cookieJar,
        "x-csrf-token": customerCsrf
      },
      body: buildEkycForm("123")
    });
    if (invalidDocument.response.status !== 422) {
      throw new Error(`Invalid eKYC document number should be rejected, got ${invalidDocument.response.status}`);
    }

    const submitResult = await requestJson(`${baseUrl}/api/ekyc/submit`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Cookie: customer.cookieJar,
        "x-csrf-token": customerCsrf
      },
      body: buildEkycForm("123456789012")
    });
    if (submitResult.response.status !== 201 || !submitResult.json?.data?.verification?.id) {
      throw new Error(`eKYC submit failed: ${submitResult.response.status} ${submitResult.text}`);
    }
    createdEkycId = Number(submitResult.json.data.verification.id);

    const detailResult = await requestJson(`${baseUrl}/api/ekyc/review/${createdEkycId}`, {
      headers: {
        Accept: "application/json",
        Cookie: reviewer.cookieJar
      }
    });
    if (detailResult.response.status !== 200 || detailResult.json?.data?.id !== createdEkycId) {
      throw new Error(`eKYC review detail failed: ${detailResult.response.status} ${detailResult.text}`);
    }
    if (detailResult.json.data.ketQuaXacThuc !== "DangXuLy") {
      throw new Error(`eKYC should wait for manager review after submit, got ${detailResult.json.data.ketQuaXacThuc}`);
    }

    const missingReviewCsrf = await requestJson(`${baseUrl}/api/ekyc/review/${createdEkycId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: reviewer.cookieJar
      },
      body: JSON.stringify({
        decision: "reject",
        review_note: "Thiếu CSRF"
      })
    });
    if (missingReviewCsrf.response.status !== 403) {
      throw new Error(`eKYC review without CSRF should be rejected, got ${missingReviewCsrf.response.status}`);
    }

    const rejectResult = await requestJson(`${baseUrl}/api/ekyc/review/${createdEkycId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: reviewer.cookieJar,
        "x-csrf-token": reviewerCsrf
      },
      body: JSON.stringify({
        decision: "reject",
        review_note: "Smoke test: hồ sơ bị từ chối thủ công để kiểm tra đồng bộ trạng thái khách."
      })
    });
    if (rejectResult.response.status !== 200 || rejectResult.json?.data?.ketQuaXacThuc !== "ThatBai") {
      throw new Error(`eKYC reject review failed: ${rejectResult.response.status} ${rejectResult.text}`);
    }

    const dbCheck = await query<{
      customerStatus: string;
      result: string;
      front: string | null;
      back: string | null;
      selfie: string | null;
    }>(
      `
        SELECT
          kh.trangthaiekyc AS "customerStatus",
          ev.ketquaxacthuc AS result,
          ev.anhmattruoc AS front,
          ev.anhmatsau AS back,
          ev.anhselfie AS selfie
        FROM ekyc_verification ev
        INNER JOIN khachhang kh ON kh.makhachhang = ev.makhachhang
        WHERE ev.maekyc = $1
        LIMIT 1
      `,
      [createdEkycId]
    );
    if (dbCheck.rows[0]?.customerStatus !== "ThatBai" || dbCheck.rows[0]?.result !== "ThatBai") {
      throw new Error("eKYC DB state is not consistent after manual reject.");
    }
    uploadedFiles = [dbCheck.rows[0].front, dbCheck.rows[0].back, dbCheck.rows[0].selfie]
      .filter(Boolean) as string[];

    console.log("eKYC smoke success");
    console.log(`customer=${customer.username}`);
    console.log(`reviewer=${reviewer.username}`);
    console.log(`ekyc_created=${createdEkycId}`);
    console.log("submit_valid=ok");
    console.log("manual_review_reject=ok");
    console.log("csrf_missing_rejected=403");
    console.log("role_boundaries=ok");
  } finally {
    if (createdEkycId) {
      if (!uploadedFiles.length) {
        const files = await query<{ front: string | null; back: string | null; selfie: string | null }>(
          "SELECT anhmattruoc AS front, anhmatsau AS back, anhselfie AS selfie FROM ekyc_verification WHERE maekyc = $1",
          [createdEkycId]
        );
        uploadedFiles = [files.rows[0]?.front, files.rows[0]?.back, files.rows[0]?.selfie]
          .filter(Boolean) as string[];
      }

      await query("DELETE FROM ekyc_verification WHERE maekyc = $1", [createdEkycId]);
    }
    if (customerId) {
      await query("UPDATE khachhang SET trangthaiekyc = $2 WHERE makhachhang = $1", [customerId, originalCustomerStatus]);
    }
    for (const fileName of uploadedFiles) {
      await fs.unlink(path.resolve(process.cwd(), "uploads/ekyc", fileName)).catch(() => undefined);
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
