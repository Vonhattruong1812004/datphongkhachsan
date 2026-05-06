import { AddressInfo } from "node:net";
import { createApp } from "../app";
import { pool, query, withTransaction } from "../config/database";
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

type RoomOriginalState = {
  roomId: number;
  trangThai: string;
  tinhTrangPhong: string | null;
  trangThaiRealtime: string | null;
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
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
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

async function getRoomState(roomId: number): Promise<RoomOriginalState | null> {
  const result = await query<RoomOriginalState>(
    `
      SELECT
        maphong AS "roomId",
        trangthai AS "trangThai",
        tinhtrangphong AS "tinhTrangPhong",
        trangthairealtime AS "trangThaiRealtime"
      FROM phong
      WHERE maphong = $1
      LIMIT 1
    `,
    [roomId]
  );

  return result.rows[0] ?? null;
}

async function cleanup(transactionId: number, roomStates: RoomOriginalState[], leaderCccd: string, catalogIds: number[] = []) {
  const transaction = transactionId
    ? await query<{ customerId: number | null; groupId: number | null }>(
        `
          SELECT makhachhang AS "customerId", madoan AS "groupId"
          FROM giaodich
          WHERE magiaodich = $1
          LIMIT 1
        `,
        [transactionId]
      ).catch(() => ({ rows: [] as Array<{ customerId: number | null; groupId: number | null }> }))
    : { rows: [] as Array<{ customerId: number | null; groupId: number | null }> };

  const customerId = Number(transaction.rows[0]?.customerId || 0);
  const groupId = Number(transaction.rows[0]?.groupId || 0);
  const customerIds = new Set<number>();
  if (customerId) customerIds.add(customerId);

  const byCccd = await query<{ id: number }>(
    "SELECT makhachhang AS id FROM khachhang WHERE cccd = $1",
    [leaderCccd]
  ).catch(() => ({ rows: [] as Array<{ id: number }> }));
  for (const row of byCccd.rows) {
    if (row.id) customerIds.add(Number(row.id));
  }

  await withTransaction(async (client) => {
    for (const serviceId of catalogIds) {
      await client.query("DELETE FROM dichvu WHERE madichvu = $1", [serviceId]).catch(() => undefined);
    }

    if (transactionId) {
      await client.query("DELETE FROM chitietdichvu WHERE magiaodich = $1", [transactionId]).catch(() => undefined);
      await client.query("DELETE FROM booking_history WHERE magiaodich = $1", [transactionId]).catch(() => undefined);
      await client.query("DELETE FROM room_status_log WHERE magiaodich = $1", [transactionId]).catch(() => undefined);
      await client.query("DELETE FROM chitietgiaodich WHERE magiaodich = $1", [transactionId]).catch(() => undefined);
      await client.query("DELETE FROM giaodich WHERE magiaodich = $1", [transactionId]).catch(() => undefined);
    }

    if (groupId) {
      await client.query("DELETE FROM doan WHERE madoan = $1", [groupId]).catch(() => undefined);
    }

    for (const id of customerIds) {
      await client.query("DELETE FROM taikhoan WHERE makhachhang = $1", [id]).catch(() => undefined);
      await client.query("DELETE FROM khachhang WHERE makhachhang = $1", [id]).catch(() => undefined);
    }

    const uniqueRoomStates = new Map<number, RoomOriginalState>();
    for (const state of roomStates) {
      if (state?.roomId && !uniqueRoomStates.has(state.roomId)) {
        uniqueRoomStates.set(state.roomId, state);
      }
    }

    const roomIds = [...uniqueRoomStates.keys()];
    if (roomIds.length) {
      await client.query(
        "DELETE FROM room_status_log WHERE maphong = ANY($1::int[]) AND ghichu LIKE 'Smoke inspection%'",
        [roomIds]
      ).catch(() => undefined);
    }

    for (const roomState of uniqueRoomStates.values()) {
      await client.query(
        `
          UPDATE phong
          SET trangthai = $2,
              tinhtrangphong = $3,
              trangthairealtime = $4
          WHERE maphong = $1
        `,
        [roomState.roomId, roomState.trangThai, roomState.tinhTrangPhong, roomState.trangThaiRealtime]
      );
    }
  });
}

async function insertCancelledStaleHold(roomId: number, code: string) {
  return withTransaction(async (client) => {
    const transaction = await client.query(
      `
        INSERT INTO giaodich (
          madatcho,
          ngaygiaodich,
          loaigiaodich,
          nguondat,
          tongtien,
          trangthai,
          phuongthucthanhtoan,
          ghichu
        )
        VALUES ($1, NOW(), 'DatPhong', 'Web', 0, 'DaHuy', 'ChuaThanhToan', 'Smoke service stale room feed hold')
        RETURNING magiaodich AS id
      `,
      [code]
    );
    const transactionId = Number(transaction.rows[0]?.id || 0);
    if (!transactionId) {
      throw new Error("Không tạo được giao dịch hủy để kiểm tra room feed stale.");
    }

    await client.query(
      `
        INSERT INTO chitietgiaodich (
          magiaodich,
          maphong,
          songuoi,
          ngaynhandukien,
          ngaytradukien,
          dongia,
          thanhtien,
          trangthai,
          tenkhach,
          cccd,
          sdt,
          email
        )
        VALUES ($1, $2, 1, $3::timestamptz, $4::timestamptz, 0, 0, 'Booked', 'Smoke Stale Feed', '900000000101', '0900000101', 'smoke.stale.feed@example.com')
      `,
      [transactionId, roomId, dateInput(0), dateInput(1)]
    );

    await client.query(
      `
        UPDATE phong
        SET trangthai = 'Booked',
            tinhtrangphong = 'Tot',
            trangthairealtime = 'Booked'
        WHERE maphong = $1
      `,
      [roomId]
    );

    return transactionId;
  });
}

async function pickRoomWithoutActiveHold(items: any[], excludedRoomId: number) {
  for (const item of items) {
    const roomId = Number(item?.id || 0);
    if (!roomId || roomId === excludedRoomId) continue;

    const active = await query<{ total: number }>(
      `
        SELECT COUNT(*)::int AS total
        FROM chitietgiaodich ct
        INNER JOIN giaodich gd ON gd.magiaodich = ct.magiaodich
        WHERE ct.maphong = $1
          AND ct.trangthai IN ('Booked', 'CheckedIn')
          AND gd.trangthai IN ('Booked', 'Stayed')
      `,
      [roomId]
    );

    if (Number(active.rows[0]?.total || 0) === 0) {
      return item;
    }
  }

  return null;
}

async function cleanupCancelledStaleHold(transactionId: number, roomState: RoomOriginalState | null) {
  await withTransaction(async (client) => {
    if (transactionId) {
      await client.query("DELETE FROM chitietgiaodich WHERE magiaodich = $1", [transactionId]).catch(() => undefined);
      await client.query("DELETE FROM giaodich WHERE magiaodich = $1", [transactionId]).catch(() => undefined);
    }

    if (roomState?.roomId) {
      await client.query(
        `
          UPDATE phong
          SET trangthai = $2,
              tinhtrangphong = $3,
              trangthairealtime = $4
          WHERE maphong = $1
        `,
        [roomState.roomId, roomState.trangThai, roomState.tinhTrangPhong, roomState.trangThaiRealtime]
      );
    }
  });
}

async function main() {
  const app = createApp();
  const server = await new Promise<import("node:http").Server>((resolve, reject) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    instance.on("error", reject);
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const ngayDen = dateInput(0);
  const ngayDi = dateInput(1);
  const stamp = String(Date.now());
  const leaderCccd = `7${stamp.slice(-11)}`;
  const leaderPhone = `08${stamp.slice(-8)}`;
  let transactionId = 0;
  let roomId = 0;
  let inspectionRoomId = 0;
  let serviceId = 0;
  let orderId = 0;
  let staleHoldTransactionId = 0;
  let staleHoldFeedChecked = false;
  let roomStates: RoomOriginalState[] = [];
  const createdCatalogIds: number[] = [];

  try {
    const accounts = await findActiveAccounts();
    const frontdesk = await loginRole(baseUrl, ROLE.LE_TAN, accounts);
    const service = await loginRole(baseUrl, ROLE.DICH_VU, accounts);
    const customer = await loginRole(baseUrl, ROLE.KHACH_HANG, accounts);
    const frontdeskCsrf = await getCsrf(baseUrl, "/frontdesk/direct-booking", frontdesk.cookieJar, "Frontdesk direct booking");
    const serviceCsrf = await getCsrf(baseUrl, "/service", service.cookieJar, "Service workspace");
    const inspectionPage = await fetch(`${baseUrl}/service/room-inspection`, {
      headers: { Cookie: service.cookieJar },
      redirect: "manual"
    });
    if (inspectionPage.status !== 200) {
      throw new Error(`Service room inspection page failed: ${inspectionPage.status}`);
    }
    const roomBoardPage = await fetch(`${baseUrl}/service/room-board-live`, {
      headers: { Cookie: service.cookieJar },
      redirect: "manual"
    });
    if (roomBoardPage.status !== 200) {
      throw new Error(`Service room board page failed: ${roomBoardPage.status}`);
    }
    const initialRoomFeed = await requestJson(`${baseUrl}/api/service/room-feed`, {
      headers: {
        Accept: "application/json",
        Cookie: service.cookieJar
      }
    });
    if (initialRoomFeed.response.status !== 200 || !Array.isArray(initialRoomFeed.json?.data?.items)) {
      throw new Error(`Service room feed failed: ${initialRoomFeed.response.status} ${initialRoomFeed.text}`);
    }
    const initialSummary = initialRoomFeed.json.data.summary || {};
    const initialItems = initialRoomFeed.json.data.items || [];
    const summarizedRooms = Number(initialSummary.available || 0)
      + Number(initialSummary.booked || 0)
      + Number(initialSummary.stayed || 0)
      + Number(initialSummary.cleaning || 0)
      + Number(initialSummary.maintenance || 0);
    if (summarizedRooms !== initialItems.length) {
      throw new Error(`Room feed summary does not match item count: summary=${summarizedRooms}, items=${initialItems.length}`);
    }

    const customerCannotOpenService = await fetch(`${baseUrl}/service`, {
      headers: { Cookie: customer.cookieJar },
      redirect: "manual"
    });
    if (customerCannotOpenService.status !== 403) {
      throw new Error(`Customer should not open service workspace, got ${customerCannotOpenService.status}`);
    }

    const serviceHotelScope = await query<{ hasScope: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'dichvu'
            AND column_name = 'makhachsan'
        ) AS "hasScope"
      `
    );
    const hasServiceHotelScope = Boolean(serviceHotelScope.rows[0]?.hasScope);
    const hotelId = hasServiceHotelScope
      ? Number((await query<{ id: number }>("SELECT makhachsan AS id FROM khachsan ORDER BY makhachsan ASC LIMIT 1")).rows[0]?.id || 0)
      : 0;

    const missingCsrfCatalog = await requestJson(`${baseUrl}/api/service/catalog`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: service.cookieJar
      },
      body: JSON.stringify({
        hotel_id: hotelId,
        ten_dich_vu: `Smoke Catalog ${stamp}`,
        gia_dich_vu: 123000,
        trang_thai: "HoatDong",
        mo_ta: "Thiếu CSRF"
      })
    });
    if (missingCsrfCatalog.response.status !== 403) {
      throw new Error(`Catalog create without CSRF should be rejected, got ${missingCsrfCatalog.response.status}`);
    }

    const catalogName = `Smoke Catalog ${stamp}`;
    const createCatalog = await requestJson(`${baseUrl}/api/service/catalog`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: service.cookieJar,
        "x-csrf-token": serviceCsrf
      },
      body: JSON.stringify({
        hotel_id: hotelId,
        ten_dich_vu: catalogName,
        gia_dich_vu: 123000,
        trang_thai: "HoatDong",
        mo_ta: "Smoke catalog CRUD"
      })
    });
    if (createCatalog.response.status !== 200 || !createCatalog.json?.data?.id) {
      throw new Error(`Catalog create failed: ${createCatalog.response.status} ${createCatalog.text}`);
    }
    const catalogId = Number(createCatalog.json.data.id);
    createdCatalogIds.push(catalogId);

    const duplicateCatalog = await requestJson(`${baseUrl}/api/service/catalog`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: service.cookieJar,
        "x-csrf-token": serviceCsrf
      },
      body: JSON.stringify({
        hotel_id: hotelId,
        ten_dich_vu: catalogName,
        gia_dich_vu: 123000,
        trang_thai: "HoatDong",
        mo_ta: "Duplicate smoke catalog"
      })
    });
    if (duplicateCatalog.response.status !== 409) {
      throw new Error(`Duplicate catalog should be rejected, got ${duplicateCatalog.response.status}`);
    }

    const updateCatalog = await requestJson(`${baseUrl}/api/service/catalog`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: service.cookieJar,
        "x-csrf-token": serviceCsrf
      },
      body: JSON.stringify({
        service_id: catalogId,
        hotel_id: hotelId,
        ten_dich_vu: catalogName,
        gia_dich_vu: 135000,
        trang_thai: "NgungBan",
        mo_ta: "Smoke catalog updated",
        hinh_anh: createCatalog.json.data.hinhAnh || ""
      })
    });
    if (updateCatalog.response.status !== 200 || updateCatalog.json?.data?.trangThai !== "NgungBan") {
      throw new Error(`Catalog update failed: ${updateCatalog.response.status} ${updateCatalog.text}`);
    }

    const deleteCatalog = await requestJson(`${baseUrl}/api/service/catalog/${catalogId}/delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: service.cookieJar,
        "x-csrf-token": serviceCsrf
      },
      body: JSON.stringify({ service_id: catalogId })
    });
    if (deleteCatalog.response.status !== 200 || !deleteCatalog.json?.ok) {
      throw new Error(`Catalog delete failed: ${deleteCatalog.response.status} ${deleteCatalog.text}`);
    }
    createdCatalogIds.splice(createdCatalogIds.indexOf(catalogId), 1);

    const catalog = await requestJson(`${baseUrl}/api/service/catalog`, {
      headers: {
        Accept: "application/json",
        Cookie: service.cookieJar
      }
    });
    if (catalog.response.status !== 200) {
      throw new Error(`Service catalog failed: ${catalog.response.status} ${catalog.text}`);
    }
    const activeService = (catalog.json?.data || []).find((item: any) => item.trangThai === "HoatDong" && Number(item.giaDichVu || 0) > 0);
    if (!activeService) {
      throw new Error("Không có dịch vụ HoatDong có giá để chạy smoke.");
    }
    serviceId = Number(activeService.id);

    const search = await requestJson(`${baseUrl}/api/frontdesk/direct-search?ngay_den=${ngayDen}&ngay_di=${ngayDi}&so_nguoi=1`, {
      headers: {
        Accept: "application/json",
        Cookie: frontdesk.cookieJar
      }
    });
    if (search.response.status !== 200 || !search.json?.data?.items?.length) {
      throw new Error(`No room available for service smoke: ${search.response.status} ${search.text}`);
    }
    roomId = Number(search.json.data.items[0].id);
    const bookedRoomState = await getRoomState(roomId);
    if (bookedRoomState) roomStates.push(bookedRoomState);
    const inspectionCandidate = await pickRoomWithoutActiveHold(search.json.data.items || [], roomId);
    if (!inspectionCandidate) {
      throw new Error("Service smoke needs one additional room without active hold to test stale feed and inspection success.");
    }
    inspectionRoomId = Number(inspectionCandidate.id);
    const inspectionRoomState = await getRoomState(inspectionRoomId);
    if (inspectionRoomState) roomStates.push(inspectionRoomState);

    staleHoldTransactionId = await insertCancelledStaleHold(inspectionRoomId, `SMK-SVC-STALE-${stamp}`);
    const staleRoomFeed = await requestJson(`${baseUrl}/api/service/room-feed`, {
      headers: {
        Accept: "application/json",
        Cookie: service.cookieJar
      }
    });
    const staleFeedRoom = (staleRoomFeed.json?.data?.items || [])
      .find((item: any) => Number(item.id) === inspectionRoomId);
    if (staleRoomFeed.response.status !== 200 || staleFeedRoom?.trangThaiRealtime !== "Available" || staleFeedRoom?.bookingCode) {
      throw new Error(`Cancelled stale booking should not mark room as busy in service feed: ${staleRoomFeed.response.status} ${JSON.stringify(staleFeedRoom || null)}`);
    }
    const staleDashboardBoard = await requestJson(`${baseUrl}/api/dashboard/room-board?scope=dichvu`, {
      headers: {
        Accept: "application/json",
        Cookie: service.cookieJar
      }
    });
    const staleDashboardRoom = (staleDashboardBoard.json?.data?.items || [])
      .find((item: any) => Number(item.id) === inspectionRoomId);
    if (staleDashboardBoard.response.status !== 200 || staleDashboardRoom?.trangThaiRealtime !== "Available") {
      throw new Error(`Cancelled stale booking should not mark room as busy in dashboard board: ${staleDashboardBoard.response.status} ${JSON.stringify(staleDashboardRoom || null)}`);
    }
    staleHoldFeedChecked = true;
    await cleanupCancelledStaleHold(staleHoldTransactionId, inspectionRoomState || null);
    staleHoldTransactionId = 0;

    const createBooking = await requestJson(`${baseUrl}/api/frontdesk/direct-booking`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: frontdesk.cookieJar,
        "x-csrf-token": frontdeskCsrf
      },
      body: JSON.stringify({
        ngay_den: ngayDen,
        ngay_di: ngayDi,
        so_nguoi: 1,
        leader_ten_kh: `Smoke Dich Vu ${stamp.slice(-6)}`,
        leader_cccd: leaderCccd,
        leader_sdt: leaderPhone,
        leader_email: `smoke.service.${stamp}@example.com`,
        leader_diachi: "Smoke service address",
        group_name: `Smoke Service ${stamp.slice(-6)}`,
        ghi_chu: "Smoke service lifecycle",
        room_ids: [roomId],
        members: [],
        services: []
      })
    });
    if (createBooking.response.status !== 200 || !createBooking.json?.data?.transactionId) {
      throw new Error(`Frontdesk setup booking failed: ${createBooking.response.status} ${createBooking.text}`);
    }
    transactionId = Number(createBooking.json.data.transactionId);

    const beforeCheckinOrder = await requestJson(`${baseUrl}/api/service/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: service.cookieJar,
        "x-csrf-token": serviceCsrf
      },
      body: JSON.stringify({
        transaction_id: transactionId,
        room_id: roomId,
        service_id: serviceId,
        quantity: 1,
        note: "Không được tạo khi chưa check-in"
      })
    });
    if (![409, 422].includes(beforeCheckinOrder.response.status)) {
      throw new Error(`Service order before check-in should be rejected, got ${beforeCheckinOrder.response.status}`);
    }

    const checkin = await requestJson(`${baseUrl}/api/frontdesk/checkin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: frontdesk.cookieJar,
        "x-csrf-token": frontdeskCsrf
      },
      body: JSON.stringify({
        transaction_id: transactionId,
        room_id: roomId
      })
    });
    if (checkin.response.status !== 200) {
      throw new Error(`Frontdesk setup check-in failed: ${checkin.response.status} ${checkin.text}`);
    }

    const missingCsrfOrder = await requestJson(`${baseUrl}/api/service/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: service.cookieJar
      },
      body: JSON.stringify({
        transaction_id: transactionId,
        room_id: roomId,
        service_id: serviceId,
        quantity: 1,
        note: "Thiếu CSRF"
      })
    });
    if (missingCsrfOrder.response.status !== 403) {
      throw new Error(`Service order without CSRF should be rejected, got ${missingCsrfOrder.response.status}`);
    }

    const beforeTotal = await query<{ total: number }>(
      "SELECT tongtien AS total FROM giaodich WHERE magiaodich = $1",
      [transactionId]
    );

    const createOrder = await requestJson(`${baseUrl}/api/service/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: service.cookieJar,
        "x-csrf-token": serviceCsrf
      },
      body: JSON.stringify({
        transaction_id: transactionId,
        room_id: roomId,
        service_id: serviceId,
        quantity: 2,
        note: "Smoke service order"
      })
    });
    if (createOrder.response.status !== 200 || !createOrder.json?.data?.id) {
      throw new Error(`Service order failed: ${createOrder.response.status} ${createOrder.text}`);
    }
    orderId = Number(createOrder.json.data.id);
    const addedAmount = Number(createOrder.json.data.amount || 0);

    const afterOrder = await query<{ total: number; orderStatus: string; lineTotal: number }>(
      `
        SELECT
          gd.tongtien AS total,
          ctdv.trangthaidichvu AS "orderStatus",
          ctdv.thanhtien AS "lineTotal"
        FROM giaodich gd
        INNER JOIN chitietdichvu ctdv ON ctdv.magiaodich = gd.magiaodich
        WHERE gd.magiaodich = $1 AND ctdv.mactdv = $2
        LIMIT 1
      `,
      [transactionId, orderId]
    );
    const expectedTotal = Number(beforeTotal.rows[0]?.total || 0) + addedAmount;
    if (Number(afterOrder.rows[0]?.total || 0) !== expectedTotal || afterOrder.rows[0]?.orderStatus !== "ChuaSuDung") {
      throw new Error("Service order did not synchronize transaction total or initial status.");
    }

    const statusUpdate = await requestJson(`${baseUrl}/api/service/orders/${orderId}/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: service.cookieJar,
        "x-csrf-token": serviceCsrf
      },
      body: JSON.stringify({ status: "DaSuDung" })
    });
    if (statusUpdate.response.status !== 200 || statusUpdate.json?.data?.status !== "DaSuDung") {
      throw new Error(`Service order status update failed: ${statusUpdate.response.status} ${statusUpdate.text}`);
    }

    const inspectionBlocked = await requestJson(`${baseUrl}/api/service/inspection`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: service.cookieJar,
        "x-csrf-token": serviceCsrf
      },
      body: JSON.stringify({
        room_id: roomId,
        room_condition: "Tot",
        note: "Không được inspection phòng đang có khách"
      })
    });
    if (inspectionBlocked.response.status !== 409) {
      throw new Error(`Inspection for occupied room should be rejected, got ${inspectionBlocked.response.status} ${inspectionBlocked.text}`);
    }

    const roomStillStayed = await query<{ roomStatus: string; realtime: string | null }>(
      "SELECT trangthai AS \"roomStatus\", trangthairealtime AS realtime FROM phong WHERE maphong = $1",
      [roomId]
    );
    if (roomStillStayed.rows[0]?.roomStatus !== "Stayed") {
      throw new Error("Rejected inspection changed occupied room status.");
    }

    const statusDowngrade = await requestJson(`${baseUrl}/api/service/orders/${orderId}/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: service.cookieJar,
        "x-csrf-token": serviceCsrf
      },
      body: JSON.stringify({ status: "DangSuDung" })
    });
    if (statusDowngrade.response.status !== 409) {
      throw new Error(`Service order status downgrade should be rejected, got ${statusDowngrade.response.status} ${statusDowngrade.text}`);
    }

    await withTransaction(async (client) => {
      await client.query("UPDATE chitietgiaodich SET trangthai = 'CheckedOut' WHERE magiaodich = $1 AND maphong = $2", [transactionId, roomId]);
      await client.query("UPDATE giaodich SET trangthai = 'Paid' WHERE magiaodich = $1", [transactionId]);
      await client.query(
        `
          UPDATE phong
          SET trangthai = 'Trong',
              tinhtrangphong = 'Tot',
              trangthairealtime = 'Available'
          WHERE maphong = $1
        `,
        [roomId]
      );
    });

    const settledStatusUpdate = await requestJson(`${baseUrl}/api/service/orders/${orderId}/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: service.cookieJar,
        "x-csrf-token": serviceCsrf
      },
      body: JSON.stringify({ status: "DaSuDung" })
    });
    if (settledStatusUpdate.response.status !== 409) {
      throw new Error(`Service order update after checkout should be rejected, got ${settledStatusUpdate.response.status} ${settledStatusUpdate.text}`);
    }

    const inspectionCleaning = await requestJson(`${baseUrl}/api/service/inspection`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: service.cookieJar,
        "x-csrf-token": serviceCsrf
      },
      body: JSON.stringify({
        room_id: inspectionRoomId,
        room_condition: "CanVeSinh",
        note: "Smoke inspection cleaning"
      })
    });
    if (inspectionCleaning.response.status !== 200 || inspectionCleaning.json?.data?.roomCondition !== "CanVeSinh") {
      throw new Error(`Inspection cleaning update failed: ${inspectionCleaning.response.status} ${inspectionCleaning.text}`);
    }

    const cleaningState = await query<{ roomStatus: string; condition: string | null; realtime: string | null }>(
      "SELECT trangthai AS \"roomStatus\", tinhtrangphong AS condition, trangthairealtime AS realtime FROM phong WHERE maphong = $1",
      [inspectionRoomId]
    );
    if (cleaningState.rows[0]?.roomStatus !== "Trong" || cleaningState.rows[0]?.condition !== "CanVeSinh" || cleaningState.rows[0]?.realtime !== "Cleaning") {
      throw new Error(`Inspection did not set room to Trong/CanVeSinh/Cleaning: ${JSON.stringify(cleaningState.rows[0] || null)}`);
    }

    const roomFeedAfterCleaning = await requestJson(`${baseUrl}/api/service/room-feed`, {
      headers: {
        Accept: "application/json",
        Cookie: service.cookieJar
      }
    });
    const cleaningFeedRoom = (roomFeedAfterCleaning.json?.data?.items || [])
      .find((item: any) => Number(item.id) === inspectionRoomId);
    if (roomFeedAfterCleaning.response.status !== 200 || cleaningFeedRoom?.trangThaiRealtime !== "Cleaning") {
      throw new Error(`Room board feed did not show inspected room as Cleaning: ${roomFeedAfterCleaning.response.status} ${JSON.stringify(cleaningFeedRoom || null)}`);
    }

    const frontdeskSearchAfterInspection = await requestJson(`${baseUrl}/api/frontdesk/direct-search?ngay_den=${ngayDen}&ngay_di=${ngayDi}&so_nguoi=1`, {
      headers: {
        Accept: "application/json",
        Cookie: frontdesk.cookieJar
      }
    });
    if (frontdeskSearchAfterInspection.response.status !== 200) {
      throw new Error(`Frontdesk search after inspection failed: ${frontdeskSearchAfterInspection.response.status} ${frontdeskSearchAfterInspection.text}`);
    }
    const frontdeskOffersCleaningRoom = (frontdeskSearchAfterInspection.json?.data?.items || [])
      .some((item: any) => Number(item.id) === inspectionRoomId);
    if (frontdeskOffersCleaningRoom) {
      throw new Error("Frontdesk search still offers a room marked Cleaning by service inspection.");
    }

    const customerSearchAfterInspection = await requestJson(`${baseUrl}/api/booking/search?so_khach=1&ngay_nhan=${encodeURIComponent(ngayDen)}&ngay_tra=${encodeURIComponent(ngayDi)}`, {
      headers: {
        Accept: "application/json",
        Cookie: customer.cookieJar
      }
    });
    if (customerSearchAfterInspection.response.status !== 200) {
      throw new Error(`Customer search after inspection failed: ${customerSearchAfterInspection.response.status} ${customerSearchAfterInspection.text}`);
    }
    const customerOffersCleaningRoom = (customerSearchAfterInspection.json?.data?.items || [])
      .some((item: any) => Number(item.id) === inspectionRoomId);
    if (customerOffersCleaningRoom) {
      throw new Error("Customer search still offers a room marked Cleaning by service inspection.");
    }

    const inspectionReady = await requestJson(`${baseUrl}/api/service/inspection`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: service.cookieJar,
        "x-csrf-token": serviceCsrf
      },
      body: JSON.stringify({
        room_id: inspectionRoomId,
        room_condition: "Tot",
        note: "Smoke inspection ready"
      })
    });
    if (inspectionReady.response.status !== 200 || inspectionReady.json?.data?.roomCondition !== "Tot") {
      throw new Error(`Inspection ready update failed: ${inspectionReady.response.status} ${inspectionReady.text}`);
    }

    const readyState = await query<{ roomStatus: string; condition: string | null; realtime: string | null }>(
      "SELECT trangthai AS \"roomStatus\", tinhtrangphong AS condition, trangthairealtime AS realtime FROM phong WHERE maphong = $1",
      [inspectionRoomId]
    );
    if (readyState.rows[0]?.roomStatus !== "Trong" || readyState.rows[0]?.condition !== "Tot" || readyState.rows[0]?.realtime !== "Available") {
      throw new Error(`Inspection did not return room to ready state: ${JSON.stringify(readyState.rows[0] || null)}`);
    }

    const roomFeedAfterReady = await requestJson(`${baseUrl}/api/service/room-feed`, {
      headers: {
        Accept: "application/json",
        Cookie: service.cookieJar
      }
    });
    const readyFeedRoom = (roomFeedAfterReady.json?.data?.items || [])
      .find((item: any) => Number(item.id) === inspectionRoomId);
    if (roomFeedAfterReady.response.status !== 200 || readyFeedRoom?.trangThaiRealtime !== "Available") {
      throw new Error(`Room board feed did not show inspected room as Available: ${roomFeedAfterReady.response.status} ${JSON.stringify(readyFeedRoom || null)}`);
    }

    console.log("Service smoke success");
    console.log(`service=${service.username}`);
    console.log(`frontdesk=${frontdesk.username}`);
    console.log(`transaction_created=${transactionId}`);
    console.log(`room=${roomId}`);
    console.log(`service_order=${orderId}`);
    console.log("pre_checkin_rejected=ok");
    console.log("order_create=ok");
    console.log("order_status=ok");
    console.log("order_status_lock_after_checkout=ok");
    console.log("occupied_inspection_rejected=ok");
    console.log("inspection_cleaning_ready=ok");
    console.log("inspection_page=ok");
    console.log("room_board_feed=ok");
    console.log(`cancelled_stale_room_feed=${staleHoldFeedChecked ? "ok" : "failed"}`);
    console.log("csrf_missing_rejected=403");
    console.log("catalog_crud=ok");
    console.log("role_boundaries=ok");
  } finally {
    await cleanupCancelledStaleHold(staleHoldTransactionId, roomStates.find((item) => item.roomId === inspectionRoomId) || null).catch(() => undefined);
    await cleanup(transactionId, roomStates, leaderCccd, createdCatalogIds).catch((error) => {
      console.error("Service smoke cleanup failed", error);
    });
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
