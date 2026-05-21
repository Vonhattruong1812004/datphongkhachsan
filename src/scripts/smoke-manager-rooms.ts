import { AddressInfo } from "node:net";
import { createApp } from "../app";
import { pool, query, withTransaction } from "../config/database";
import { BookingService } from "../modules/booking/services/booking.service";
import { FrontdeskService } from "../modules/frontdesk/services/frontdesk.service";
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

async function submitRoomForm(baseUrl: string, cookieJar: string, csrfToken: string, room: Record<string, string>) {
  const form = new FormData();
  form.set("_csrf", csrfToken);
  for (const [key, value] of Object.entries(room)) {
    form.set(key, value);
  }

  const response = await fetch(`${baseUrl}/manager/rooms`, {
    method: "POST",
    headers: {
      Cookie: cookieJar
    },
    redirect: "manual",
    body: form
  });

  const text = await response.text();
  return { response, text };
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
  const page = await fetch(`${baseUrl}/manager/rooms`, {
    headers: { Cookie: cookieJar },
    redirect: "manual"
  });

  if (page.status !== 200) {
    throw new Error(`Manager rooms page failed: ${page.status}`);
  }

  const token = extractCsrfToken(await page.text());
  if (!token) {
    throw new Error("Manager rooms page did not expose CSRF token");
  }

  return token;
}

async function firstHotelId() {
  const hotels = await query<{ id: number }>("SELECT makhachsan AS id FROM khachsan ORDER BY makhachsan ASC LIMIT 1");
  const id = Number(hotels.rows[0]?.id || 0);
  if (!id) {
    throw new Error("Không tìm thấy khách sạn để tạo phòng test.");
  }

  return id;
}

async function roomWithTransaction() {
  const result = await query<{ id: number }>(
    `
      SELECT p.maphong AS id
      FROM phong p
      INNER JOIN chitietgiaodich ct ON ct.maphong = p.maphong
      GROUP BY p.maphong
      ORDER BY p.maphong ASC
      LIMIT 1
    `
  );

  return Number(result.rows[0]?.id || 0);
}

async function activeRoomForManagerUpdate() {
  const result = await query<{
    id: number;
    hotelId: number;
    soPhong: string;
    loaiPhong: string;
    dienTich: number;
    loaiGiuong: string;
    viewPhong: string;
    gia: number;
    soKhachToiDa: number;
    tinhTrangPhong: string;
    ghiChu: string | null;
    hinhAnh: string | null;
  }>(
    `
      SELECT
        p.maphong AS id,
        p.makhachsan AS "hotelId",
        p.sophong AS "soPhong",
        p.loaiphong AS "loaiPhong",
        p.dientich AS "dienTich",
        p.loaigiuong AS "loaiGiuong",
        p.viewphong AS "viewPhong",
        p.gia,
        p.sokhachtoida AS "soKhachToiDa",
        p.tinhtrangphong AS "tinhTrangPhong",
        p.ghichu AS "ghiChu",
        p.hinhanh AS "hinhAnh"
      FROM phong p
      INNER JOIN chitietgiaodich ct ON ct.maphong = p.maphong
      INNER JOIN giaodich gd ON gd.magiaodich = ct.magiaodich
      WHERE ct.trangthai IN ('Booked', 'CheckedIn')
        AND gd.trangthai IN ('Booked', 'Stayed')
      ORDER BY p.maphong ASC
      LIMIT 1
    `
  );

  return result.rows[0] || null;
}

async function insertCancelledHold(roomId: number, checkin: string, checkout: string) {
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
        VALUES ($1, NOW(), 'DatPhong', 'Web', 0, 'DaHuy', 'ChuaThanhToan', 'Smoke cancelled parent with stale booked detail')
        RETURNING magiaodich
      `,
      [`SMK-CANCEL-${Date.now()}`]
    ) as { rows: Array<{ magiaodich: number }> };

    const transactionId = Number(transaction.rows[0]?.magiaodich || 0);
    if (!transactionId) {
      throw new Error("Không tạo được giao dịch hủy để kiểm tra stale booking.");
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
        VALUES ($1, $2, 2, $3::timestamptz, $4::timestamptz, 1000000, 1000000, 'Booked', 'Smoke Cancelled Hold', '900000000001', '0900000001', 'smoke.cancelled.hold@example.com')
      `,
      [transactionId, roomId, checkin, checkout]
    );

    return transactionId;
  });
}

async function cleanupCancelledHold(transactionId: number) {
  if (!transactionId) {
    return;
  }

  await withTransaction(async (client) => {
    await client.query("DELETE FROM chitietgiaodich WHERE magiaodich = $1", [transactionId]).catch(() => undefined);
    await client.query("DELETE FROM giaodich WHERE magiaodich = $1", [transactionId]).catch(() => undefined);
  });
}

async function markRoomAsStaleBooked(roomId: number) {
  await query(
    `
      UPDATE phong
      SET trangthai = 'Booked',
          tinhtrangphong = 'Tot',
          trangthairealtime = 'Booked'
      WHERE maphong = $1
    `,
    [roomId]
  );
}

async function main() {
  const app = createApp();
  const server = await new Promise<import("node:http").Server>((resolve, reject) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    instance.on("error", reject);
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let createdRoomId = 0;
  let cancelledHoldTransactionId = 0;
  let cancelledHoldVisible = false;

  try {
    const manager = await loginManager(baseUrl);
    const csrfToken = await getManagerCsrf(baseUrl, manager.cookieJar);
    const hotelId = await firstHotelId();
    const lockedRoomId = await roomWithTransaction();
    const activeRoom = await activeRoomForManagerUpdate();
    const stamp = Date.now();
    const room = {
      hotel_id: String(hotelId),
      so_phong: `SMK-${String(stamp).slice(-6)}`,
      loai_phong: "Deluxe",
      dien_tich: "36",
      loai_giuong: "King",
      view_phong: "Biển",
      gia: "1234000",
      so_khach_toi_da: "3",
      tinh_trang_phong: "Tot",
      ghi_chu: "Smoke manager room",
      hinh_anh: "4.png"
    };

    const missingCsrf = await requestJson(`${baseUrl}/api/manager/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: manager.cookieJar
      },
      body: JSON.stringify(room)
    });

    if (missingCsrf.response.status !== 403) {
      throw new Error(`Manager room API without CSRF should be rejected, got ${missingCsrf.response.status}`);
    }

    const createResult = await requestJson(`${baseUrl}/api/manager/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: manager.cookieJar,
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify(room)
    });

    if (!createResult.response.ok || !createResult.json?.ok || !createResult.json?.data?.id) {
      throw new Error(`Create manager room failed: ${createResult.response.status} ${createResult.json?.message || createResult.text}`);
    }

    createdRoomId = Number(createResult.json.data.id);

    const savedRoom = await query<{ soPhong: string; hinhAnh: string | null; gia: number }>(
      `
        SELECT sophong AS "soPhong", hinhanh AS "hinhAnh", gia
        FROM phong
        WHERE maphong = $1
        LIMIT 1
      `,
      [createdRoomId]
    );

    if (savedRoom.rows[0]?.hinhAnh !== "4.png") {
      throw new Error(`Created room image should stay normalized as 4.png, got ${savedRoom.rows[0]?.hinhAnh || "empty"}`);
    }

    const imageResponse = await fetch(`${baseUrl}/uploads/phong/4.png`, { redirect: "manual" });
    if (imageResponse.status !== 200) {
      throw new Error(`Local room image /uploads/phong/4.png should render, got ${imageResponse.status}`);
    }

    const updateResult = await requestJson(`${baseUrl}/api/manager/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: manager.cookieJar,
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify({
        ...room,
        room_id: String(createdRoomId),
        gia: "1350000",
        ghi_chu: "Smoke manager room updated"
      })
    });

    if (!updateResult.response.ok || !updateResult.json?.ok) {
      throw new Error(`Update same room number should not trigger duplicate error: ${updateResult.response.status} ${updateResult.json?.message || updateResult.text}`);
    }

    const capacityUpdateResult = await requestJson(`${baseUrl}/api/manager/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: manager.cookieJar,
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify({
        ...room,
        room_id: String(createdRoomId),
        gia: "1350000",
        so_khach_toi_da: "5",
        ghi_chu: "Smoke manager room capacity updated"
      })
    });

    if (!capacityUpdateResult.response.ok || !capacityUpdateResult.json?.ok) {
      throw new Error(`Update room capacity failed: ${capacityUpdateResult.response.status} ${capacityUpdateResult.json?.message || capacityUpdateResult.text}`);
    }

    const capacityState = await query<{ capacity: number }>(
      "SELECT sokhachtoida AS capacity FROM phong WHERE maphong = $1",
      [createdRoomId]
    );

    if (Number(capacityState.rows[0]?.capacity || 0) !== 5) {
      throw new Error(`Room capacity update should persist as 5, got ${capacityState.rows[0]?.capacity || "empty"}`);
    }

    const formCapacityUpdate = await submitRoomForm(baseUrl, manager.cookieJar, csrfToken, {
      ...room,
      room_id: String(createdRoomId),
      gia: "1350000",
      so_khach_toi_da: "4",
      ghi_chu: "Smoke manager room form capacity updated",
      hinh_anh: "4.png"
    });

    if (![302, 303].includes(formCapacityUpdate.response.status)) {
      throw new Error(`Room form capacity update should redirect after success, got ${formCapacityUpdate.response.status} ${formCapacityUpdate.text}`);
    }

    const formCapacityState = await query<{ capacity: number }>(
      "SELECT sokhachtoida AS capacity FROM phong WHERE maphong = $1",
      [createdRoomId]
    );

    if (Number(formCapacityState.rows[0]?.capacity || 0) !== 4) {
      throw new Error(`Room form capacity update should persist as 4, got ${formCapacityState.rows[0]?.capacity || "empty"}`);
    }

    const holdCheckin = dateInput(45);
    const holdCheckout = dateInput(47);
    cancelledHoldTransactionId = await insertCancelledHold(createdRoomId, holdCheckin, holdCheckout);

    const bookingSearch = await new BookingService().searchRooms({
      loai_phong: "",
      loai_giuong: "",
      view_phong: "",
      hotel_city: "",
      hotel_name: "",
      so_khach: 2,
      gia_goi_y: 0,
      ngay_nhan: holdCheckin,
      ngay_tra: holdCheckout,
      sort_by: "ai"
    });
    const frontdeskSearch = await new FrontdeskService().searchDirectBookingRooms({
      ngay_den: holdCheckin,
      ngay_di: holdCheckout,
      so_nguoi: 2
    });

    const bookingSeesRoom = bookingSearch.items.some((item) => item.id === createdRoomId);
    const frontdeskSeesRoom = frontdeskSearch.items.some((item) => item.id === createdRoomId);
    if (!bookingSeesRoom || !frontdeskSeesRoom) {
      throw new Error(`Cancelled parent transaction must not block available room. booking=${bookingSeesRoom} frontdesk=${frontdeskSeesRoom}`);
    }

    cancelledHoldVisible = true;
    await cleanupCancelledHold(cancelledHoldTransactionId);
    cancelledHoldTransactionId = 0;

    cancelledHoldTransactionId = await insertCancelledHold(createdRoomId, holdCheckin, holdCheckout);
    await markRoomAsStaleBooked(createdRoomId);
    const staleBookingSearch = await new BookingService().searchRooms({
      loai_phong: "",
      loai_giuong: "",
      view_phong: "",
      hotel_city: "",
      hotel_name: "",
      so_khach: 2,
      gia_goi_y: 0,
      ngay_nhan: holdCheckin,
      ngay_tra: holdCheckout,
      sort_by: "ai"
    });
    const staleFrontdeskSearch = await new FrontdeskService().searchDirectBookingRooms({
      ngay_den: holdCheckin,
      ngay_di: holdCheckout,
      so_nguoi: 2
    });
    const staleBookingSeesRoom = staleBookingSearch.items.some((item) => item.id === createdRoomId);
    const staleFrontdeskSeesRoom = staleFrontdeskSearch.items.some((item) => item.id === createdRoomId);
    if (!staleBookingSeesRoom || !staleFrontdeskSeesRoom) {
      throw new Error(`Stale room flags from cancelled hold must not block search. booking=${staleBookingSeesRoom} frontdesk=${staleFrontdeskSeesRoom}`);
    }

    const managerRoomsAfterStale = await requestJson(`${baseUrl}/api/manager/rooms`, {
      headers: {
        Accept: "application/json",
        Cookie: manager.cookieJar
      }
    });
    const staleManagerRoom = (managerRoomsAfterStale.json?.data || [])
      .find((item: any) => Number(item.id) === createdRoomId);
    if (managerRoomsAfterStale.response.status !== 200 || staleManagerRoom?.trangThaiRealtime !== "Available" || Number(staleManagerRoom?.activeBookingCount || 0) !== 0) {
      throw new Error(`Manager rooms should treat cancelled stale hold as Available: ${managerRoomsAfterStale.response.status} ${JSON.stringify(staleManagerRoom || null)}`);
    }
    await cleanupCancelledHold(cancelledHoldTransactionId);
    cancelledHoldTransactionId = 0;

    const conditionUpdateResult = await requestJson(`${baseUrl}/api/manager/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: manager.cookieJar,
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify({
        ...room,
        room_id: String(createdRoomId),
        gia: "1350000",
        tinh_trang_phong: "CanVeSinh",
        ghi_chu: "Smoke manager room needs cleaning"
      })
    });

    if (!conditionUpdateResult.response.ok || !conditionUpdateResult.json?.ok) {
      throw new Error(`Update room condition should synchronize realtime: ${conditionUpdateResult.response.status} ${conditionUpdateResult.json?.message || conditionUpdateResult.text}`);
    }

    const conditionState = await query<{ roomStatus: string; condition: string | null; realtime: string | null; logCount: number }>(
      `
        SELECT
          p.trangthai AS "roomStatus",
          p.tinhtrangphong AS condition,
          p.trangthairealtime AS realtime,
          (SELECT COUNT(*)::int FROM room_status_log rsl WHERE rsl.maphong = p.maphong AND rsl.ghichu LIKE 'Quan ly cap nhat tinh trang phong%') AS "logCount"
        FROM phong p
        WHERE p.maphong = $1
      `,
      [createdRoomId]
    );

    if (conditionState.rows[0]?.roomStatus !== "Trong" || conditionState.rows[0]?.condition !== "CanVeSinh" || conditionState.rows[0]?.realtime !== "Cleaning" || Number(conditionState.rows[0]?.logCount || 0) < 1) {
      throw new Error(`Manager room condition did not sync status/realtime/log: ${JSON.stringify(conditionState.rows[0] || null)}`);
    }

    if (activeRoom) {
      const activeRoomUpdate = await requestJson(`${baseUrl}/api/manager/rooms`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Cookie: manager.cookieJar,
          "x-csrf-token": csrfToken
        },
        body: JSON.stringify({
          room_id: String(activeRoom.id),
          hotel_id: String(activeRoom.hotelId),
          so_phong: activeRoom.soPhong,
          loai_phong: activeRoom.loaiPhong,
          dien_tich: String(activeRoom.dienTich),
          loai_giuong: activeRoom.loaiGiuong,
          view_phong: activeRoom.viewPhong || "Biển",
          gia: String(Number(activeRoom.gia || 0) + 1000),
          so_khach_toi_da: String(activeRoom.soKhachToiDa),
          tinh_trang_phong: activeRoom.tinhTrangPhong || "Tot",
          ghi_chu: activeRoom.ghiChu || "",
          hinh_anh: activeRoom.hinhAnh || ""
        })
      });

      if (activeRoomUpdate.response.status !== 409) {
        throw new Error(`Structural update for active room should be rejected, got ${activeRoomUpdate.response.status}`);
      }
    }

    const duplicateResult = await requestJson(`${baseUrl}/api/manager/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: manager.cookieJar,
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify({
        ...room,
        gia: "1450000"
      })
    });

    if (duplicateResult.response.status !== 409) {
      throw new Error(`Duplicate room number in same hotel should be rejected, got ${duplicateResult.response.status}`);
    }

    if (lockedRoomId > 0) {
      const lockedDelete = await requestJson(`${baseUrl}/api/manager/rooms/${lockedRoomId}/delete`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Cookie: manager.cookieJar,
          "x-csrf-token": csrfToken
        }
      });

      if (lockedDelete.response.status !== 409) {
        throw new Error(`Delete room with transaction history should be rejected, got ${lockedDelete.response.status}`);
      }
    }

    const deleteResult = await requestJson(`${baseUrl}/api/manager/rooms/${createdRoomId}/delete`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Cookie: manager.cookieJar,
        "x-csrf-token": csrfToken
      }
    });

    if (!deleteResult.response.ok || !deleteResult.json?.ok) {
      throw new Error(`Delete new manager room failed: ${deleteResult.response.status} ${deleteResult.json?.message || deleteResult.text}`);
    }

    const afterDelete = await query<{ total: number }>(
      "SELECT COUNT(*)::int AS total FROM phong WHERE maphong = $1",
      [createdRoomId]
    );

    if (Number(afterDelete.rows[0]?.total || 0) !== 0) {
      throw new Error("Deleted test room still exists in database.");
    }

    console.log("Manager room smoke success");
    console.log(`manager=${manager.username}`);
    console.log(`room_created=${createdRoomId}`);
    console.log("update_same_room_number=ok");
    console.log("capacity_update_persisted=ok");
    console.log("form_capacity_update_persisted=ok");
    console.log("condition_realtime_sync=ok");
    console.log(`cancelled_hold_does_not_block_availability=${cancelledHoldVisible ? "ok" : "failed"}`);
    console.log("cancelled_stale_manager_room=ok");
    console.log("cancelled_stale_search=ok");
    console.log(`active_room_structural_update_rejected=${activeRoom ? 409 : "skipped"}`);
    console.log("duplicate_room_rejected=409");
    console.log(`delete_locked_room_rejected=${lockedRoomId > 0 ? 409 : "skipped"}`);
    console.log("delete_without_transactions=ok");
    console.log("room_image_local=ok");
  } finally {
    await cleanupCancelledHold(cancelledHoldTransactionId).catch(() => undefined);

    if (createdRoomId > 0) {
      await query("DELETE FROM phong WHERE maphong = $1", [createdRoomId]).catch(() => undefined);
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
  console.error("Manager room smoke failed");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
