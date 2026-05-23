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
  maKhachSan: number;
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

function extractEditNotice(html: string) {
  return html.match(/<div class="edit-alert edit-alert--error">([\s\S]*?)<\/div>/i)?.[1]
    ?.replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "";
}

function extractCancelNotice(html: string) {
  return html.match(/<div class="cancel-alert cancel-alert--error">([\s\S]*?)<\/div>/i)?.[1]
    ?.replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "";
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

async function paySepayDeposit(baseUrl: string, transactionId: number, depositAmount: number) {
  const sepayResult = await requestJson(`${baseUrl}/api/webhook/sepay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Apikey my-secret-key-123"
    },
    body: JSON.stringify({
      content: `SEVQR ROOM${transactionId}`,
      amount: depositAmount
    })
  });

  if (sepayResult.response.status !== 200 || !sepayResult.json?.ok || !sepayResult.json?.transactionId) {
    throw new Error(`Frontdesk SePay deposit smoke failed: ${sepayResult.response.status} ${sepayResult.text}`);
  }

  return Number(sepayResult.json.transactionId);
}

async function paySepayCheckout(baseUrl: string, content: string, amount: number) {
  const sepayResult = await requestJson(`${baseUrl}/api/webhook/sepay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Apikey my-secret-key-123"
    },
    body: JSON.stringify({
      content,
      amount
    })
  });

  if (sepayResult.response.status !== 200 || !sepayResult.json?.ok) {
    throw new Error(`Frontdesk SePay checkout smoke failed: ${sepayResult.response.status} ${sepayResult.text}`);
  }

  return sepayResult.json;
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
        makhachsan AS "maKhachSan",
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

async function cleanup(transactionIds: number[], roomStates: RoomOriginalState[], leaderCccds: string[]) {
  const cleanTransactionIds = transactionIds.filter((id, index, list) => id > 0 && list.indexOf(id) === index);
  const transactions = cleanTransactionIds.length
    ? await query<{ transactionId: number; customerId: number | null; groupId: number | null }>(
        `
          SELECT magiaodich AS "transactionId", makhachhang AS "customerId", madoan AS "groupId"
          FROM giaodich
          WHERE magiaodich = ANY($1::int[])
        `,
        [cleanTransactionIds]
      ).catch(() => ({ rows: [] as Array<{ transactionId: number; customerId: number | null; groupId: number | null }> }))
    : { rows: [] as Array<{ transactionId: number; customerId: number | null; groupId: number | null }> };

  const groupIds = new Set<number>();
  const customerIds = new Set<number>();
  for (const row of transactions.rows) {
    if (row.customerId) customerIds.add(Number(row.customerId));
    if (row.groupId) groupIds.add(Number(row.groupId));
  }

  const byCccd = await query<{ id: number }>(
    "SELECT makhachhang AS id FROM khachhang WHERE cccd = ANY($1::varchar[])",
    [leaderCccds.filter(Boolean)]
  ).catch(() => ({ rows: [] as Array<{ id: number }> }));
  for (const row of byCccd.rows) {
    if (row.id) customerIds.add(Number(row.id));
  }

  await withTransaction(async (client) => {
    if (cleanTransactionIds.length) {
      await client.query("DELETE FROM chitietdichvu WHERE magiaodich = ANY($1::int[])", [cleanTransactionIds]).catch(() => undefined);
      await client.query("DELETE FROM booking_history WHERE magiaodich = ANY($1::int[])", [cleanTransactionIds]).catch(() => undefined);
      await client.query("DELETE FROM room_status_log WHERE magiaodich = ANY($1::int[])", [cleanTransactionIds]).catch(() => undefined);
      await client.query("DELETE FROM chitietgiaodich WHERE magiaodich = ANY($1::int[])", [cleanTransactionIds]).catch(() => undefined);
      await client.query("DELETE FROM giaodich WHERE magiaodich = ANY($1::int[])", [cleanTransactionIds]).catch(() => undefined);
    }

    for (const id of groupIds) {
      await client.query("DELETE FROM doan WHERE madoan = $1", [id]).catch(() => undefined);
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
  const leaderCccd = `8${stamp.slice(-11)}`;
  const leaderPhone = `09${stamp.slice(-8)}`;
  const cancelLeaderCccd = `6${stamp.slice(-11)}`;
  const cancelLeaderPhone = `07${stamp.slice(-8)}`;
  const multiCheckoutLeaderCccd = `5${stamp.slice(-11)}`;
  const multiCheckoutLeaderPhone = `05${stamp.slice(-8)}`;
  let transactionId = 0;
  let cancelTransactionId = 0;
  let multiCheckoutTransactionId = 0;
  let roomId = 0;
  let roomStates: RoomOriginalState[] = [];

  try {
    const accounts = await findActiveAccounts();
    const frontdesk = await loginRole(baseUrl, ROLE.LE_TAN, accounts);
    const customer = await loginRole(baseUrl, ROLE.KHACH_HANG, accounts);
    const csrfToken = await getCsrf(baseUrl, "/frontdesk/direct-booking", frontdesk.cookieJar, "Frontdesk direct booking");

    const customerCannotLookup = await fetch(`${baseUrl}/api/frontdesk/lookup?keyword=1`, {
      headers: { Cookie: customer.cookieJar },
      redirect: "manual"
    });
    if (customerCannotLookup.status !== 403) {
      throw new Error(`Customer should not access frontdesk lookup, got ${customerCannotLookup.status}`);
    }

    const search = await requestJson(`${baseUrl}/api/frontdesk/direct-search?ngay_den=${ngayDen}&ngay_di=${ngayDi}&so_nguoi=1`, {
      headers: {
        Accept: "application/json",
        Cookie: frontdesk.cookieJar
      }
    });
    if (search.response.status !== 200 || !search.json?.data?.items?.length) {
      throw new Error(`No room available for frontdesk smoke: ${search.response.status} ${search.text}`);
    }
    roomId = Number(search.json.data.items[0].id);
    const roomState = await getRoomState(roomId);
    if (roomState) roomStates.push(roomState);
    const candidateIds = (search.json.data.items || [])
      .map((item: any) => Number(item.id || 0))
      .filter((id: number, index: number, list: number[]) => id > 0 && id !== roomId && list.indexOf(id) === index);
    const sameHotelCandidate = await query<{ id: number }>(
      `
        SELECT maphong AS id
        FROM phong
        WHERE maphong = ANY($1::int[])
          AND makhachsan = $2::int
        ORDER BY maphong ASC
        LIMIT 1
      `,
      [candidateIds, roomState?.maKhachSan || 0]
    );
    if (!sameHotelCandidate.rows[0]) {
      throw new Error("Frontdesk smoke needs at least two available rooms in the same hotel to test edit/change-room flow.");
    }
    const changedRoomId = Number(sameHotelCandidate.rows[0].id);
    const changedRoomState = await getRoomState(changedRoomId);
    if (changedRoomState) roomStates.push(changedRoomState);
    const cancelRoomIds = (search.json.data.items || [])
      .map((item: any) => Number(item.id || 0))
      .filter((id: number, index: number, list: number[]) => id > 0 && id !== roomId && id !== changedRoomId && list.indexOf(id) === index)
      .slice(0, 2);
    if (cancelRoomIds.length < 2) {
      throw new Error("Frontdesk smoke needs two additional available rooms to test partial cancel flow.");
    }
    for (const cancelRoomId of cancelRoomIds) {
      const cancelRoomState = await getRoomState(cancelRoomId);
      if (cancelRoomState) roomStates.push(cancelRoomState);
    }
    const multiCheckoutRoomIds = (search.json.data.items || [])
      .map((item: any) => Number(item.id || 0))
      .filter((id: number, index: number, list: number[]) => id > 0 && id !== roomId && id !== changedRoomId && !cancelRoomIds.includes(id) && list.indexOf(id) === index)
      .slice(0, 2);
    if (multiCheckoutRoomIds.length < 2) {
      throw new Error("Frontdesk smoke needs two more available rooms to test multi-room partial checkout.");
    }
    for (const checkoutRoomId of multiCheckoutRoomIds) {
      const checkoutRoomState = await getRoomState(checkoutRoomId);
      if (checkoutRoomState) roomStates.push(checkoutRoomState);
    }

    const bookingPayload = {
      ngay_den: ngayDen,
      ngay_di: ngayDi,
      so_nguoi: 1,
      leader_ten_kh: `Smoke Le Tan ${stamp.slice(-6)}`,
      leader_cccd: leaderCccd,
      leader_sdt: leaderPhone,
      leader_email: `smoke.frontdesk.${stamp}@example.com`,
      leader_diachi: "Smoke test address",
      group_name: `Smoke Frontdesk ${stamp.slice(-6)}`,
      ghi_chu: "Smoke frontdesk lifecycle",
      room_ids: [roomId],
      members: [],
      services: []
    };

    const missingCsrf = await requestJson(`${baseUrl}/api/frontdesk/direct-booking`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: frontdesk.cookieJar
      },
      body: JSON.stringify(bookingPayload)
    });
    if (missingCsrf.response.status !== 403) {
      throw new Error(`Frontdesk direct booking without CSRF should be rejected, got ${missingCsrf.response.status}`);
    }

    const createResult = await requestJson(`${baseUrl}/api/frontdesk/direct-booking`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: frontdesk.cookieJar,
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify(bookingPayload)
    });
    if (createResult.response.status !== 200 || !createResult.json?.data?.holdId) {
      throw new Error(`Frontdesk direct booking failed: ${createResult.response.status} ${createResult.text}`);
    }
    const holdId = Number(createResult.json.data.holdId);
    const depositAmount = Number(createResult.json.data.depositAmount || 0);
    transactionId = await paySepayDeposit(baseUrl, holdId, depositAmount);
    const holdStatusResult = await requestJson(`${baseUrl}/api/frontdesk/direct-booking/holds/${holdId}`, {
      headers: {
        Accept: "application/json",
        Cookie: frontdesk.cookieJar
      }
    });
    if (
      holdStatusResult.response.status !== 200
      || holdStatusResult.json?.data?.status !== "PAID"
      || Number(holdStatusResult.json?.data?.transactionId || 0) !== transactionId
    ) {
      throw new Error(`Direct booking hold did not switch to PAID after webhook: ${holdStatusResult.response.status} ${holdStatusResult.text}`);
    }

    const bookedCheck = await query<{ transactionStatus: string; detailStatus: string; roomStatus: string }>(
      `
        SELECT
          gd.trangthai AS "transactionStatus",
          ct.trangthai AS "detailStatus",
          p.trangthai AS "roomStatus"
        FROM giaodich gd
        INNER JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
        INNER JOIN phong p ON p.maphong = ct.maphong
        WHERE gd.magiaodich = $1 AND ct.maphong = $2
        LIMIT 1
      `,
      [transactionId, roomId]
    );
    if (bookedCheck.rows[0]?.transactionStatus !== "Booked" || bookedCheck.rows[0]?.detailStatus !== "Booked" || bookedCheck.rows[0]?.roomStatus !== "Booked") {
      throw new Error("Direct booking did not synchronize transaction/detail/room Booked state.");
    }

    const editableService = await query<{ id: number }>(
      `
        SELECT madichvu AS id
        FROM dichvu
        WHERE trangthai = 'HoatDong'
          AND COALESCE(giadichvu, 0) > 0
        ORDER BY madichvu ASC
        LIMIT 1
      `
    );
    const editableServiceId = Number(editableService.rows[0]?.id || 0);

    const editCsrfToken = await getCsrf(baseUrl, `/frontdesk/edit-booking?keyword=${transactionId}`, frontdesk.cookieJar, "Frontdesk edit booking");
    const editBody = new URLSearchParams({
      btn_action: "save",
      search_keyword: String(transactionId),
      ma_giao_dich: String(transactionId),
      ma_phong_cu: String(roomId),
      ma_phong: String(changedRoomId),
      ten_kh: "Smoke Le Tan Test",
      cccd: leaderCccd,
      sdt: leaderPhone,
      email: `smoke.frontdesk.${stamp}@example.com`,
      ngay_den: ngayDen,
      ngay_di: ngayDi,
      so_nguoi: "1"
    });
    if (editableServiceId > 0) {
      editBody.set(`services[svc_${editableServiceId}]`, "1");
      editBody.set(`service_rooms[svc_${editableServiceId}]`, String(changedRoomId));
    }
    const editResult = await fetch(`${baseUrl}/frontdesk/edit-booking`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "text/html",
        Cookie: frontdesk.cookieJar,
        "x-csrf-token": editCsrfToken
      },
      body: editBody.toString()
    });
    const editHtml = await editResult.text();
    if (editResult.status !== 200) {
      throw new Error(`Frontdesk edit booking failed: ${editResult.status}`);
    }
    const editNotice = extractEditNotice(editHtml);
    if (editNotice) {
      throw new Error(`Frontdesk edit booking returned form error: ${editNotice}`);
    }

    if (editableServiceId > 0) {
      const servicePersistCheck = await query<{ qty: number; roomId: number; total: number }>(
        `
          SELECT
            soluong AS qty,
            maphong AS "roomId",
            thanhtien AS total
          FROM chitietdichvu
          WHERE magiaodich = $1
            AND madichvu = $2
          LIMIT 1
        `,
        [transactionId, editableServiceId]
      );
      const savedService = servicePersistCheck.rows[0];
      if (!savedService || Number(savedService.qty || 0) !== 1 || Number(savedService.roomId || 0) !== changedRoomId || Number(savedService.total || 0) <= 0) {
        const alertText = editHtml.match(/<div class="edit-alert[\s\S]*?<\/div>/i)?.[0]
          ?.replace(/<[^>]*>/g, " ")
          .replace(/\s+/g, " ")
          .trim() || "no edit alert";
        console.error("edit service debug", {
          transactionId,
          editableServiceId,
          changedRoomId,
          savedService: savedService || null,
          alertText
        });
        throw new Error("Edit booking did not persist added service quantity/target room.");
      }
    }

    const editedCheck = await query<{
      detailRoomId: number;
      oldRoomStatus: string;
      oldRealtime: string | null;
      newRoomStatus: string;
      newRealtime: string | null;
    }>(
      `
        SELECT
          ct.maphong AS "detailRoomId",
          old_room.trangthai AS "oldRoomStatus",
          old_room.trangthairealtime AS "oldRealtime",
          new_room.trangthai AS "newRoomStatus",
          new_room.trangthairealtime AS "newRealtime"
        FROM chitietgiaodich ct
        INNER JOIN phong old_room ON old_room.maphong = $2
        INNER JOIN phong new_room ON new_room.maphong = $3
        WHERE ct.magiaodich = $1
          AND ct.trangthai = 'Booked'
        LIMIT 1
      `,
      [transactionId, roomId, changedRoomId]
    );
    if (
      Number(editedCheck.rows[0]?.detailRoomId || 0) !== changedRoomId ||
      editedCheck.rows[0]?.oldRoomStatus !== "Trong" ||
      editedCheck.rows[0]?.oldRealtime !== "Available" ||
      editedCheck.rows[0]?.newRoomStatus !== "Booked" ||
      editedCheck.rows[0]?.newRealtime !== "Booked"
    ) {
      throw new Error(`Edit booking did not synchronize changed room/detail states: ${JSON.stringify(editedCheck.rows[0] || null)}`);
    }
    roomId = changedRoomId;

    const lookup = await requestJson(`${baseUrl}/api/frontdesk/lookup?keyword=${transactionId}`, {
      headers: {
        Accept: "application/json",
        Cookie: frontdesk.cookieJar
      }
    });
    if (lookup.response.status !== 200 || lookup.json?.data?.transaction?.maGiaoDich !== transactionId) {
      throw new Error(`Frontdesk lookup failed: ${lookup.response.status} ${lookup.text}`);
    }

    const checkinMissingCsrf = await requestJson(`${baseUrl}/api/frontdesk/checkin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: frontdesk.cookieJar
      },
      body: JSON.stringify({
        transaction_id: transactionId,
        room_id: roomId
      })
    });
    if (checkinMissingCsrf.response.status !== 403) {
      throw new Error(`Frontdesk check-in without CSRF should be rejected, got ${checkinMissingCsrf.response.status}`);
    }

    const checkin = await requestJson(`${baseUrl}/api/frontdesk/checkin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: frontdesk.cookieJar,
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify({
        transaction_id: transactionId,
        room_id: roomId
      })
    });
    if (checkin.response.status !== 200) {
      throw new Error(`Frontdesk check-in failed: ${checkin.response.status} ${checkin.text}`);
    }

    const checkedInState = await query<{ transactionStatus: string; detailStatus: string; roomStatus: string }>(
      `
        SELECT
          gd.trangthai AS "transactionStatus",
          ct.trangthai AS "detailStatus",
          p.trangthai AS "roomStatus"
        FROM giaodich gd
        INNER JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
        INNER JOIN phong p ON p.maphong = ct.maphong
        WHERE gd.magiaodich = $1 AND ct.maphong = $2
        LIMIT 1
      `,
      [transactionId, roomId]
    );
    if (checkedInState.rows[0]?.transactionStatus !== "Stayed" || checkedInState.rows[0]?.detailStatus !== "CheckedIn" || checkedInState.rows[0]?.roomStatus !== "Stayed") {
      throw new Error("Check-in did not synchronize transaction/detail/room Stayed state.");
    }

    const preview = await requestJson(`${baseUrl}/api/frontdesk/checkout-preview?transaction_id=${transactionId}&room_id=${roomId}&room_condition=Tot`, {
      headers: {
        Accept: "application/json",
        Cookie: frontdesk.cookieJar
      }
    });
    if (preview.response.status !== 200 || Number(preview.json?.data?.summary?.total || 0) <= 0) {
      throw new Error(`Checkout preview failed: ${preview.response.status} ${preview.text}`);
    }

    const checkoutMissingCsrf = await requestJson(`${baseUrl}/api/frontdesk/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: frontdesk.cookieJar
      },
      body: JSON.stringify({
        transaction_id: transactionId,
        room_id: roomId,
        payment_method: "TienMat",
        payment_status: "paid",
        room_condition: "Tot"
      })
    });
    if (checkoutMissingCsrf.response.status !== 403) {
      throw new Error(`Frontdesk checkout without CSRF should be rejected, got ${checkoutMissingCsrf.response.status}`);
    }

    const checkout = await requestJson(`${baseUrl}/api/frontdesk/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: frontdesk.cookieJar,
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify({
        transaction_id: transactionId,
        room_id: roomId,
        payment_method: "TienMat",
        payment_status: "paid",
        room_condition: "CanVeSinh",
        note: "Smoke checkout frontdesk"
      })
    });
    if (checkout.response.status !== 200) {
      throw new Error(`Frontdesk checkout failed: ${checkout.response.status} ${checkout.text}`);
    }

    const paidState = await query<{ transactionStatus: string; paymentMethod: string; detailStatus: string; roomStatus: string; roomCondition: string | null; realtime: string | null }>(
      `
        SELECT
          gd.trangthai AS "transactionStatus",
          gd.phuongthucthanhtoan AS "paymentMethod",
          ct.trangthai AS "detailStatus",
          p.trangthai AS "roomStatus",
          p.tinhtrangphong AS "roomCondition",
          p.trangthairealtime AS realtime
        FROM giaodich gd
        INNER JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
        INNER JOIN phong p ON p.maphong = ct.maphong
        WHERE gd.magiaodich = $1 AND ct.maphong = $2
        LIMIT 1
      `,
      [transactionId, roomId]
    );
    if (paidState.rows[0]?.transactionStatus !== "Paid" || paidState.rows[0]?.detailStatus !== "CheckedOut" || paidState.rows[0]?.roomStatus !== "Trong") {
      throw new Error("Checkout did not synchronize Paid/CheckedOut/Trong state.");
    }
    if (paidState.rows[0]?.roomCondition !== "CanVeSinh" || paidState.rows[0]?.realtime !== "Cleaning") {
      throw new Error("Checkout did not persist selected room condition/realtime status.");
    }

    const frontdeskSearchAfterCheckout = await requestJson(`${baseUrl}/api/frontdesk/direct-search?ngay_den=${ngayDen}&ngay_di=${ngayDi}&so_nguoi=1`, {
      headers: {
        Accept: "application/json",
        Cookie: frontdesk.cookieJar
      }
    });
    if (frontdeskSearchAfterCheckout.response.status !== 200) {
      throw new Error(`Frontdesk post-checkout search failed: ${frontdeskSearchAfterCheckout.response.status} ${frontdeskSearchAfterCheckout.text}`);
    }
    const frontdeskStillOffersCleaningRoom = (frontdeskSearchAfterCheckout.json?.data?.items || [])
      .some((item: any) => Number(item.id) === roomId);
    if (frontdeskStillOffersCleaningRoom) {
      throw new Error("Frontdesk search still offers a room marked CanVeSinh/Cleaning after checkout.");
    }

    const bookingSearchAfterCheckout = await requestJson(`${baseUrl}/api/booking/search?so_khach=1&ngay_nhan=${encodeURIComponent(ngayDen)}&ngay_tra=${encodeURIComponent(ngayDi)}`, {
      headers: {
        Accept: "application/json",
        Cookie: customer.cookieJar
      }
    });
    if (bookingSearchAfterCheckout.response.status !== 200) {
      throw new Error(`Customer booking post-checkout search failed: ${bookingSearchAfterCheckout.response.status} ${bookingSearchAfterCheckout.text}`);
    }
    const customerStillOffersCleaningRoom = (bookingSearchAfterCheckout.json?.data?.items || [])
      .some((item: any) => Number(item.id) === roomId);
    if (customerStillOffersCleaningRoom) {
      throw new Error("Customer booking search still offers a room marked CanVeSinh/Cleaning after checkout.");
    }

    const bookingCsrfToken = await getCsrf(baseUrl, `/booking/rooms/${roomId}`, customer.cookieJar, "Customer booking form");
    const previewCleaningRoom = await requestJson(`${baseUrl}/api/booking/preview`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: customer.cookieJar,
        "x-csrf-token": bookingCsrfToken
      },
      body: JSON.stringify({
        room_id: roomId,
        ten_khach: "Smoke Customer Test",
        cccd: `7${stamp.slice(-11)}`,
        sdt: `08${stamp.slice(-8)}`,
        email: `smoke.customer.${stamp}@example.com`,
        so_nguoi: 1,
        ngay_nhan: ngayDen,
        ngay_tra: ngayDi
      })
    });
    if (previewCleaningRoom.response.status !== 409) {
      throw new Error(`Customer should not preview a Cleaning room, got ${previewCleaningRoom.response.status}: ${previewCleaningRoom.text}`);
    }

    const multiCheckoutPayload = {
      ngay_den: ngayDen,
      ngay_di: ngayDi,
      so_nguoi: 1,
      leader_ten_kh: "Smoke Multi Checkout",
      leader_cccd: multiCheckoutLeaderCccd,
      leader_sdt: multiCheckoutLeaderPhone,
      leader_email: `smoke.checkout.${stamp}@example.com`,
      leader_diachi: "Smoke multi checkout address",
      group_name: `Smoke Checkout ${stamp.slice(-6)}`,
      ghi_chu: "Smoke frontdesk multi-room checkout flow",
      room_ids: multiCheckoutRoomIds,
      members: [],
      services: []
    };

    const multiCheckoutCreate = await requestJson(`${baseUrl}/api/frontdesk/direct-booking`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: frontdesk.cookieJar,
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify(multiCheckoutPayload)
    });
    if (multiCheckoutCreate.response.status !== 200 || !multiCheckoutCreate.json?.data?.holdId) {
      throw new Error(`Multi-room checkout booking failed: ${multiCheckoutCreate.response.status} ${multiCheckoutCreate.text}`);
    }
    multiCheckoutTransactionId = await paySepayDeposit(
      baseUrl,
      Number(multiCheckoutCreate.json.data.holdId),
      Number(multiCheckoutCreate.json?.data?.depositAmount || 0)
    );

    for (const checkoutRoomId of multiCheckoutRoomIds) {
      const multiCheckin = await requestJson(`${baseUrl}/api/frontdesk/checkin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Cookie: frontdesk.cookieJar,
          "x-csrf-token": csrfToken
        },
        body: JSON.stringify({
          transaction_id: multiCheckoutTransactionId,
          room_id: checkoutRoomId
        })
      });
      if (multiCheckin.response.status !== 200) {
        throw new Error(`Multi-room check-in failed: ${multiCheckin.response.status} ${multiCheckin.text}`);
      }
    }

    const partialMultiPreview = await requestJson(`${baseUrl}/api/frontdesk/checkout-preview?transaction_id=${multiCheckoutTransactionId}&room_id=${multiCheckoutRoomIds[0]}&room_condition=Tot`, {
      headers: {
        Accept: "application/json",
        Cookie: frontdesk.cookieJar
      }
    });
    if (
      partialMultiPreview.response.status !== 200 ||
      !partialMultiPreview.json?.data?.paymentTransfer?.content ||
      Number(partialMultiPreview.json?.data?.summary?.total || 0) <= 0
    ) {
      throw new Error(`Partial multi-room checkout preview failed: ${partialMultiPreview.response.status} ${partialMultiPreview.text}`);
    }
    await paySepayCheckout(
      baseUrl,
      partialMultiPreview.json.data.paymentTransfer.content,
      Number(partialMultiPreview.json.data.summary.total)
    );

    const partialMultiCheckoutCheck = await query<{
      transactionStatus: string;
      paymentMethod: string;
      total: number;
      checkedOutRooms: number;
      checkedInRooms: number;
      firstRoomStatus: string;
      secondRoomStatus: string;
    }>(
      `
        SELECT
          gd.trangthai AS "transactionStatus",
          gd.phuongthucthanhtoan AS "paymentMethod",
          gd.tongtien AS total,
          COUNT(*) FILTER (WHERE ct.trangthai = 'CheckedOut')::int AS "checkedOutRooms",
          COUNT(*) FILTER (WHERE ct.trangthai = 'CheckedIn')::int AS "checkedInRooms",
          MAX(CASE WHEN ct.maphong = $2 THEN ct.trangthai END) AS "firstRoomStatus",
          MAX(CASE WHEN ct.maphong = $3 THEN ct.trangthai END) AS "secondRoomStatus"
        FROM giaodich gd
        INNER JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
        WHERE gd.magiaodich = $1
        GROUP BY gd.magiaodich, gd.trangthai, gd.phuongthucthanhtoan, gd.tongtien
      `,
      [multiCheckoutTransactionId, multiCheckoutRoomIds[0], multiCheckoutRoomIds[1]]
    );
    const partialCheckoutRow = partialMultiCheckoutCheck.rows[0];
    if (
      partialCheckoutRow?.transactionStatus !== "Stayed" ||
      partialCheckoutRow?.paymentMethod !== "ChuyenKhoan" ||
      Number(partialCheckoutRow?.checkedOutRooms || 0) !== 1 ||
      Number(partialCheckoutRow?.checkedInRooms || 0) !== 1 ||
      partialCheckoutRow?.firstRoomStatus !== "CheckedOut" ||
      partialCheckoutRow?.secondRoomStatus !== "CheckedIn"
    ) {
      throw new Error(`Partial multi-room checkout closed transaction too early or lost total: ${JSON.stringify(partialCheckoutRow || null)}`);
    }

    const finalMultiCheckout = await requestJson(`${baseUrl}/api/frontdesk/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: frontdesk.cookieJar,
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify({
        transaction_id: multiCheckoutTransactionId,
        room_id: multiCheckoutRoomIds[1],
        payment_method: "ChuyenKhoan",
        payment_status: "paid",
        room_condition: "Tot",
        note: "Smoke final checkout"
      })
    });
    if (finalMultiCheckout.response.status !== 200) {
      throw new Error(`Final multi-room checkout failed: ${finalMultiCheckout.response.status} ${finalMultiCheckout.text}`);
    }

    const finalMultiCheckoutCheck = await query<{
      transactionStatus: string;
      paymentMethod: string;
      total: number;
      checkedOutRooms: number;
      activeRooms: number;
    }>(
      `
        SELECT
          gd.trangthai AS "transactionStatus",
          gd.phuongthucthanhtoan AS "paymentMethod",
          gd.tongtien AS total,
          COUNT(*) FILTER (WHERE ct.trangthai = 'CheckedOut')::int AS "checkedOutRooms",
          COUNT(*) FILTER (WHERE ct.trangthai IN ('Booked', 'CheckedIn'))::int AS "activeRooms"
        FROM giaodich gd
        INNER JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
        WHERE gd.magiaodich = $1
        GROUP BY gd.magiaodich, gd.trangthai, gd.phuongthucthanhtoan, gd.tongtien
      `,
      [multiCheckoutTransactionId]
    );
    const finalCheckoutRow = finalMultiCheckoutCheck.rows[0];
    if (
      finalCheckoutRow?.transactionStatus !== "Paid" ||
      finalCheckoutRow?.paymentMethod !== "ChuyenKhoan" ||
      Number(finalCheckoutRow?.checkedOutRooms || 0) !== multiCheckoutRoomIds.length ||
      Number(finalCheckoutRow?.activeRooms || 0) !== 0
    ) {
      throw new Error(`Final multi-room checkout did not close transaction cleanly: ${JSON.stringify(finalCheckoutRow || null)}`);
    }

    const cancelBookingPayload = {
      ngay_den: dateInput(8),
      ngay_di: dateInput(9),
      so_nguoi: 1,
      leader_ten_kh: "Smoke Cancel Test",
      leader_cccd: cancelLeaderCccd,
      leader_sdt: cancelLeaderPhone,
      leader_email: `smoke.cancel.${stamp}@example.com`,
      leader_diachi: "Smoke cancel address",
      group_name: `Smoke Cancel ${stamp.slice(-6)}`,
      ghi_chu: "Smoke frontdesk cancel flow",
      room_ids: cancelRoomIds,
      members: [],
      services: []
    };

    const cancelBookingCreate = await requestJson(`${baseUrl}/api/frontdesk/direct-booking`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: frontdesk.cookieJar,
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify(cancelBookingPayload)
    });
    if (cancelBookingCreate.response.status !== 200 || !cancelBookingCreate.json?.data?.holdId) {
      throw new Error(`Cancel-flow direct booking failed: ${cancelBookingCreate.response.status} ${cancelBookingCreate.text}`);
    }
    cancelTransactionId = await paySepayDeposit(
      baseUrl,
      Number(cancelBookingCreate.json.data.holdId),
      Number(cancelBookingCreate.json?.data?.depositAmount || 0)
    );
    const cancelOriginalTotal = Number(cancelBookingCreate.json?.data?.total || 0);

    const cancelCsrfToken = await getCsrf(baseUrl, `/frontdesk/cancel-booking?keyword=${cancelTransactionId}`, frontdesk.cookieJar, "Frontdesk cancel booking");
    const partialCancelBody = new URLSearchParams({
      btn_action: "cancel",
      search_keyword: String(cancelTransactionId),
      ma_giao_dich: String(cancelTransactionId),
      cancel_scope: "partial",
      phong_cancel: String(cancelRoomIds[0]),
      ly_do_huy: "Smoke huy tung phong",
      refund_bank_name: "VietinBank",
      refund_account_no: "108875396650",
      refund_account_name: "VO NHAT TRUONG",
      refund_note: "Smoke refund partial"
    });
    const partialCancelResult = await fetch(`${baseUrl}/frontdesk/cancel-booking`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "text/html",
        Cookie: frontdesk.cookieJar,
        "x-csrf-token": cancelCsrfToken
      },
      body: partialCancelBody.toString()
    });
    const partialCancelHtml = await partialCancelResult.text();
    if (partialCancelResult.status !== 200) {
      throw new Error(`Partial cancel failed: ${partialCancelResult.status}`);
    }
    const partialCancelNotice = extractCancelNotice(partialCancelHtml);
    if (partialCancelNotice) {
      throw new Error(`Partial cancel returned form error: ${partialCancelNotice}`);
    }

    const partialCancelCheck = await query<{
      transactionStatus: string;
      total: number;
      cancelledStatus: string;
      remainingStatus: string;
      cancelledRoomStatus: string;
      cancelledRealtime: string | null;
      remainingRoomStatus: string;
    }>(
      `
        SELECT
          gd.trangthai AS "transactionStatus",
          gd.tongtien AS total,
          cancelled_ct.trangthai AS "cancelledStatus",
          remaining_ct.trangthai AS "remainingStatus",
          cancelled_room.trangthai AS "cancelledRoomStatus",
          cancelled_room.trangthairealtime AS "cancelledRealtime",
          remaining_room.trangthai AS "remainingRoomStatus"
        FROM giaodich gd
        INNER JOIN chitietgiaodich cancelled_ct ON cancelled_ct.magiaodich = gd.magiaodich AND cancelled_ct.maphong = $2
        INNER JOIN chitietgiaodich remaining_ct ON remaining_ct.magiaodich = gd.magiaodich AND remaining_ct.maphong = $3
        INNER JOIN phong cancelled_room ON cancelled_room.maphong = $2
        INNER JOIN phong remaining_room ON remaining_room.maphong = $3
        WHERE gd.magiaodich = $1
        LIMIT 1
      `,
      [cancelTransactionId, cancelRoomIds[0], cancelRoomIds[1]]
    );
    const partialRow = partialCancelCheck.rows[0];
    if (
      partialRow?.transactionStatus !== "Booked" ||
      partialRow?.cancelledStatus !== "Cancelled" ||
      partialRow?.remainingStatus !== "Booked" ||
      partialRow?.cancelledRoomStatus !== "Trong" ||
      partialRow?.cancelledRealtime !== "Available" ||
      partialRow?.remainingRoomStatus !== "Booked" ||
      Number(partialRow?.total || 0) <= 0 ||
      Number(partialRow?.total || 0) >= cancelOriginalTotal
    ) {
      throw new Error(`Partial cancel did not synchronize states/totals: ${JSON.stringify(partialRow || null)}`);
    }

    const finalCancelBody = new URLSearchParams({
      btn_action: "cancel",
      search_keyword: String(cancelTransactionId),
      ma_giao_dich: String(cancelTransactionId),
      cancel_scope: "all",
      ly_do_huy: "Smoke huy phan con lai",
      refund_bank_name: "VietinBank",
      refund_account_no: "108875396650",
      refund_account_name: "VO NHAT TRUONG",
      refund_note: "Smoke refund final"
    });
    const finalCancelResult = await fetch(`${baseUrl}/frontdesk/cancel-booking`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "text/html",
        Cookie: frontdesk.cookieJar,
        "x-csrf-token": cancelCsrfToken
      },
      body: finalCancelBody.toString()
    });
    const finalCancelHtml = await finalCancelResult.text();
    if (finalCancelResult.status !== 200) {
      throw new Error(`Final cancel failed: ${finalCancelResult.status}`);
    }
    const finalCancelNotice = extractCancelNotice(finalCancelHtml);
    if (finalCancelNotice) {
      throw new Error(`Final cancel returned form error: ${finalCancelNotice}`);
    }

    const finalCancelCheck = await query<{
      transactionStatus: string;
      total: number;
      activeDetails: number;
      cancelledRoomsReleased: number;
    }>(
      `
        SELECT
          gd.trangthai AS "transactionStatus",
          gd.tongtien AS total,
          COUNT(*) FILTER (WHERE ct.trangthai <> 'Cancelled')::int AS "activeDetails",
          COUNT(*) FILTER (
            WHERE ct.trangthai = 'Cancelled'
              AND p.trangthai = 'Trong'
              AND p.trangthairealtime = 'Available'
          )::int AS "cancelledRoomsReleased"
        FROM giaodich gd
        INNER JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
        INNER JOIN phong p ON p.maphong = ct.maphong
        WHERE gd.magiaodich = $1
        GROUP BY gd.magiaodich, gd.trangthai, gd.tongtien
      `,
      [cancelTransactionId]
    );
    const finalRow = finalCancelCheck.rows[0];
    if (
      finalRow?.transactionStatus !== "DaHuy" ||
      Number(finalRow?.total || 0) !== 0 ||
      Number(finalRow?.activeDetails || 0) !== 0 ||
      Number(finalRow?.cancelledRoomsReleased || 0) !== cancelRoomIds.length
    ) {
      throw new Error(`Final cancel did not close transaction cleanly: ${JSON.stringify(finalRow || null)}`);
    }

    const refundCheck = await query<{ count: number; total: number }>(
      `
        SELECT
          COUNT(*)::int AS count,
          COALESCE(SUM(amount_requested), 0)::numeric AS total
        FROM refund_requests
        WHERE magiaodich = $1
          AND status = 'ChoQuanLyDuyet'
      `,
      [cancelTransactionId]
    );
    if (Number(refundCheck.rows[0]?.count || 0) < 1 || Number(refundCheck.rows[0]?.total || 0) <= 0) {
      throw new Error(`Cancel refund request was not created: ${JSON.stringify(refundCheck.rows[0] || null)}`);
    }

    console.log("Frontdesk smoke success");
    console.log(`frontdesk=${frontdesk.username}`);
    console.log(`transaction_created=${transactionId}`);
    console.log(`room=${roomId}`);
    console.log("direct_booking=ok");
    console.log("edit_booking_change_room=ok");
    console.log("checkin=ok");
    console.log("checkout=ok");
    console.log("multi_room_checkout=ok");
    console.log("cleaning_room_not_bookable=ok");
    console.log("cancel_booking=ok");
    console.log("csrf_missing_rejected=403");
    console.log("role_boundaries=ok");
  } finally {
    await cleanup([transactionId, multiCheckoutTransactionId, cancelTransactionId], roomStates, [leaderCccd, multiCheckoutLeaderCccd, cancelLeaderCccd]).catch((error) => {
      console.error("Frontdesk smoke cleanup failed", error);
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
