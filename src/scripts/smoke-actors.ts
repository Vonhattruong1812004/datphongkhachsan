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
  roleId: number;
  roleName: string;
  username: string;
  cookieJar: string;
};

const PASSWORD_CANDIDATES = ["123456", "Abc@123", "admin123", "Admin@123"];

const allowedRoutes: Record<number, string[]> = {
  [ROLE.ADMIN]: [
    "/dashboard/admin",
    "/admin/users",
    "/admin/diagnostics",
    "/admin/runtime-health",
    "/admin/system-readiness",
    "/admin/mobile-readiness",
    "/admin/backups",
    "/service",
    "/service/room-board-live",
    "/api/admin/diagnostics/system"
  ],
  [ROLE.LE_TAN]: [
    "/dashboard/letan",
    "/frontdesk",
    "/frontdesk/direct-booking",
    "/frontdesk/checkin",
    "/frontdesk/checkout-v2",
    "/frontdesk/edit-booking",
    "/frontdesk/cancel-booking",
    "/ekyc/review",
    "/service"
  ],
  [ROLE.KE_TOAN]: [
    "/dashboard/ketoan",
    "/accounting",
    "/accounting/reports",
    "/accounting/revenue",
    "/accounting/expenses",
    "/accounting/cashflow",
    "/accounting/debts",
    "/api/accounting/dashboard"
  ],
  [ROLE.DICH_VU]: [
    "/dashboard/dichvu",
    "/service",
    "/service/catalog/manage",
    "/service/room-inspection",
    "/service/room-board-live",
    "/api/service/catalog",
    "/api/service/room-feed"
  ],
  [ROLE.CSKH]: [
    "/dashboard/cskh",
    "/feedback/manage",
    "/feedback/advisory/manage",
    "/feedback/broadcast/manage",
    "/manager/promotions",
    "/api/feedback"
  ],
  [ROLE.QUAN_LY]: [
    "/dashboard/quanly",
    "/manager/customers",
    "/manager/rooms",
    "/manager/promotions",
    "/feedback/manage",
    "/ekyc/review",
    "/ai/analytics",
    "/service",
    "/service/room-inspection",
    "/service/room-board-live",
    "/api/service/room-feed"
  ],
  [ROLE.KHACH_HANG]: [
    "/customer/dashboard",
    "/customer/profile",
    "/customer/bookings",
    "/customer/services",
    "/customer/mobile-hub",
    "/ekyc",
    "/feedback/new",
    "/api/customer/mobile-home"
  ]
};

const forbiddenRoutes: Record<number, string[]> = {
  [ROLE.ADMIN]: ["/customer/dashboard", "/frontdesk"],
  [ROLE.LE_TAN]: ["/admin/users", "/accounting", "/manager/customers", "/customer/dashboard"],
  [ROLE.KE_TOAN]: ["/admin/users", "/frontdesk", "/manager/customers", "/customer/dashboard"],
  [ROLE.DICH_VU]: ["/admin/users", "/accounting", "/manager/customers", "/customer/dashboard"],
  [ROLE.CSKH]: ["/admin/users", "/accounting", "/frontdesk", "/customer/dashboard"],
  [ROLE.QUAN_LY]: ["/admin/users", "/accounting", "/frontdesk", "/customer/dashboard"],
  [ROLE.KHACH_HANG]: ["/admin/users", "/accounting", "/frontdesk", "/manager/customers", "/service/catalog/manage"]
};

function readSetCookies(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
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

function extractCsrfToken(html: string) {
  return html.match(/<meta\s+name="csrf-token"\s+content="([^"]*)"/i)?.[1] || "";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
          roleId,
          roleName: account.roleName || ROLE_LABELS[roleId] || String(roleId),
          username: account.username,
          cookieJar
        };
      }
    }
  }

  throw new Error(`Khong dang nhap duoc tai khoan active cho role ${ROLE_LABELS[roleId] || roleId}.`);
}

async function assertRoute(baseUrl: string, session: ActorSession, route: string, expected: "allowed" | "forbidden") {
  let response = await fetch(`${baseUrl}${route}`, {
    headers: {
      Cookie: session.cookieJar
    },
    redirect: "manual"
  });

  if (expected === "allowed" && response.status === 401) {
    await sleep(120);
    response = await fetch(`${baseUrl}${route}`, {
      headers: {
        Cookie: session.cookieJar
      },
      redirect: "manual"
    });
  }

  if (expected === "allowed" && response.status !== 200) {
    throw new Error(`${session.roleName} (${session.username}) should open ${route}, got ${response.status}`);
  }

  if (expected === "forbidden" && response.status !== 403) {
    throw new Error(`${session.roleName} (${session.username}) should be forbidden from ${route}, got ${response.status}`);
  }

  return response.status;
}

async function assertRealtimeScope(baseUrl: string, session: ActorSession, scope: string, expected: "allowed" | "forbidden") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1000);

  try {
    const response = await fetch(`${baseUrl}/api/realtime/stream?scope=${encodeURIComponent(scope)}`, {
      headers: {
        Cookie: session.cookieJar
      },
      redirect: "manual",
      signal: controller.signal
    });

    if (expected === "allowed" && response.status !== 200) {
      throw new Error(`${session.roleName} (${session.username}) should open realtime scope ${scope}, got ${response.status}`);
    }

    if (expected === "forbidden" && response.status !== 403) {
      throw new Error(`${session.roleName} (${session.username}) should be forbidden from realtime scope ${scope}, got ${response.status}`);
    }

    response.body?.cancel().catch(() => undefined);
    return response.status;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function requestJson(baseUrl: string, session: ActorSession, route: string) {
  const response = await fetch(`${baseUrl}${route}`, {
    headers: {
      Cookie: session.cookieJar
    },
    redirect: "manual"
  });
  const text = await response.text();
  let json: any = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch (_error) {
    json = null;
  }

  return { response, json, text };
}

async function expectedDashboardRevenue() {
  const result = await query<{
    recognizedMonthlyRevenue: number | string;
    monthlyRevenue: number | string;
    outstandingMonthlyRevenue: number | string;
    paidTransactions: number | string;
  }>(
    `
      SELECT
        COALESCE(SUM(CASE
          WHEN date_trunc('month', ngaygiaodich) = date_trunc('month', NOW())
            AND trangthai IN ('Booked', 'Stayed', 'Paid')
            THEN COALESCE(tongtien, 0)
          ELSE 0
        END), 0)::numeric AS "recognizedMonthlyRevenue",
        COALESCE(SUM(CASE
          WHEN date_trunc('month', ngaygiaodich) = date_trunc('month', NOW())
            AND trangthai = 'Paid'
            THEN COALESCE(tongtien, 0)
          ELSE 0
        END), 0)::numeric AS "monthlyRevenue",
        COALESCE(SUM(CASE
          WHEN date_trunc('month', ngaygiaodich) = date_trunc('month', NOW())
            AND trangthai IN ('Booked', 'Stayed')
            THEN COALESCE(tongtien, 0)
          ELSE 0
        END), 0)::numeric AS "outstandingMonthlyRevenue",
        COUNT(*) FILTER (WHERE trangthai = 'Paid')::int AS "paidTransactions"
      FROM giaodich
    `
  );

  return result.rows[0] || {
    recognizedMonthlyRevenue: 0,
    monthlyRevenue: 0,
    outstandingMonthlyRevenue: 0,
    paidTransactions: 0
  };
}

async function expectedDashboardRooms() {
  const result = await query<{
    totalRooms: number | string;
    availableRooms: number | string;
    bookedRooms: number | string;
    stayedRooms: number | string;
    maintenanceRooms: number | string;
    cleaningRooms: number | string;
  }>(
    `
      WITH room_base AS (
        SELECT
          CASE
            WHEN p.trangthai = 'BaoTri'
              OR COALESCE(NULLIF(p.tinhtrangphong::text, ''), 'Tot') IN ('HuHaiNhe', 'HuHaiNang', 'DangBaoTri')
              THEN 'Maintenance'
            WHEN COALESCE(NULLIF(p.tinhtrangphong::text, ''), 'Tot') = 'CanVeSinh'
              THEN 'Cleaning'
            WHEN active.detail_status = 'CheckedIn'
              THEN 'Stayed'
            WHEN active.detail_status = 'Booked'
              THEN 'Booked'
            ELSE 'Available'
          END AS effective_realtime
        FROM phong p
        LEFT JOIN LATERAL (
          SELECT ct.trangthai AS detail_status
          FROM chitietgiaodich ct
          INNER JOIN giaodich gd ON gd.magiaodich = ct.magiaodich
          WHERE ct.maphong = p.maphong
            AND ct.trangthai IN ('Booked', 'CheckedIn')
            AND gd.trangthai IN ('Booked', 'Stayed')
          ORDER BY ct.mactgd DESC
          LIMIT 1
        ) active ON TRUE
      )
      SELECT
        COUNT(*)::int AS "totalRooms",
        COUNT(*) FILTER (WHERE effective_realtime = 'Available')::int AS "availableRooms",
        COUNT(*) FILTER (WHERE effective_realtime = 'Booked')::int AS "bookedRooms",
        COUNT(*) FILTER (WHERE effective_realtime = 'Stayed')::int AS "stayedRooms",
        COUNT(*) FILTER (WHERE effective_realtime = 'Maintenance')::int AS "maintenanceRooms",
        COUNT(*) FILTER (WHERE effective_realtime = 'Cleaning')::int AS "cleaningRooms"
      FROM room_base
    `
  );

  return result.rows[0] || {
    totalRooms: 0,
    availableRooms: 0,
    bookedRooms: 0,
    stayedRooms: 0,
    maintenanceRooms: 0,
    cleaningRooms: 0
  };
}

async function assertDashboardRoomBoard(baseUrl: string, session: ActorSession, scope: string) {
  const result = await requestJson(baseUrl, session, `/api/dashboard/room-board?scope=${encodeURIComponent(scope)}`);

  if (result.response.status !== 200 || !result.json?.ok) {
    throw new Error(`${session.roleName} (${session.username}) should load dashboard room board ${scope}, got ${result.response.status}`);
  }

  const items = result.json.data?.items || [];
  const summary = result.json.data?.summary || {};
  const totalBySummary = Number(summary.available || 0)
    + Number(summary.booked || 0)
    + Number(summary.stayed || 0)
    + Number(summary.cleaning || 0)
    + Number(summary.maintenance || 0);

  if (!Array.isArray(items) || totalBySummary !== items.length) {
    throw new Error(`Dashboard room board summary mismatch for ${scope}: summary=${totalBySummary} items=${Array.isArray(items) ? items.length : "invalid"}`);
  }
}

async function assertDashboardStats(baseUrl: string, session: ActorSession, scope: string) {
  const result = await requestJson(baseUrl, session, `/api/dashboard/stats?scope=${encodeURIComponent(scope)}`);

  if (result.response.status !== 200 || !result.json?.ok) {
    throw new Error(`${session.roleName} (${session.username}) should load dashboard stats ${scope}, got ${result.response.status}`);
  }

  const overview = result.json.data?.overview || {};
  const totalRooms = Number(overview.totalRooms || 0);
  const roomSummaryTotal = Number(overview.availableRooms || 0)
    + Number(overview.bookedRooms || 0)
    + Number(overview.stayedRooms || 0)
    + Number(overview.cleaningRooms || 0)
    + Number(overview.maintenanceRooms || 0);

  if (roomSummaryTotal !== totalRooms) {
    throw new Error(`Dashboard stats room summary mismatch for ${scope}: summary=${roomSummaryTotal} total=${totalRooms}`);
  }

  const expectedRooms = await expectedDashboardRooms();
  const roomFields = ["totalRooms", "availableRooms", "bookedRooms", "stayedRooms", "cleaningRooms", "maintenanceRooms"];
  for (const field of roomFields) {
    if (Number(overview[field] || 0) !== Number((expectedRooms as any)[field] || 0)) {
      throw new Error(`Dashboard stats ${field} mismatch for ${scope}: api=${overview[field]} db=${(expectedRooms as any)[field]}`);
    }
  }

  const expectedRevenue = await expectedDashboardRevenue();
  for (const field of ["recognizedMonthlyRevenue", "monthlyRevenue", "outstandingMonthlyRevenue", "paidTransactions"]) {
    if (Number(overview[field] || 0) !== Number((expectedRevenue as any)[field] || 0)) {
      throw new Error(`Dashboard stats ${field} mismatch for ${scope}: api=${overview[field]} db=${(expectedRevenue as any)[field]}`);
    }
  }

  if (scope === "quanly" && !Number.isFinite(Number(overview.totalPromotions))) {
    throw new Error("Manager dashboard stats did not expose totalPromotions.");
  }

  const events = result.json.data?.recentEvents || [];
  if (Array.isArray(events) && events.length) {
    const event = events[0];
    if (!event.category || !event.title || !event.detail || !event.happenedAt) {
      throw new Error(`Dashboard recent event shape is incomplete for ${scope}.`);
    }
  }
}

async function main() {
  const app = createApp();
  const server = await new Promise<import("node:http").Server>((resolve, reject) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    instance.on("error", reject);
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const roles = [ROLE.ADMIN, ROLE.LE_TAN, ROLE.KE_TOAN, ROLE.DICH_VU, ROLE.CSKH, ROLE.QUAN_LY, ROLE.KHACH_HANG];
  const totals = { allowed: 0, forbidden: 0 };

  try {
    const accounts = await findActiveAccounts();

    for (const roleId of roles) {
      const session = await loginRole(baseUrl, roleId, accounts);
      await sleep(30);

      for (const route of allowedRoutes[roleId] || []) {
        await assertRoute(baseUrl, session, route, "allowed");
        totals.allowed += 1;
      }

      for (const route of forbiddenRoutes[roleId] || []) {
        await assertRoute(baseUrl, session, route, "forbidden");
        totals.forbidden += 1;
      }

      const ownScope = ({
        [ROLE.ADMIN]: "admin",
        [ROLE.LE_TAN]: "letan",
        [ROLE.KE_TOAN]: "ketoan",
        [ROLE.DICH_VU]: "dichvu",
        [ROLE.CSKH]: "cskh",
        [ROLE.QUAN_LY]: "quanly",
        [ROLE.KHACH_HANG]: "khachhang"
      } as Record<number, string>)[roleId];
      await assertRealtimeScope(baseUrl, session, ownScope, "allowed");
      totals.allowed += 1;

      if (["admin", "letan", "ketoan", "dichvu", "cskh", "quanly"].includes(ownScope)) {
        await assertDashboardStats(baseUrl, session, ownScope);
        totals.allowed += 1;
      }

      if (["admin", "letan", "dichvu", "quanly"].includes(ownScope)) {
        await assertDashboardRoomBoard(baseUrl, session, ownScope);
        totals.allowed += 1;
      }

      if (roleId !== ROLE.DICH_VU) {
        await assertRealtimeScope(baseUrl, session, "dichvu", "forbidden");
        totals.forbidden += 1;
      }

      console.log(`${session.roleName}=${session.username} allowed=${allowedRoutes[roleId]?.length || 0} forbidden=${forbiddenRoutes[roleId]?.length || 0}`);
    }

    console.log("Actor smoke success");
    console.log(`allowed_checks=${totals.allowed}`);
    console.log(`forbidden_checks=${totals.forbidden}`);
  } finally {
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
  console.error("Actor smoke failed");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
