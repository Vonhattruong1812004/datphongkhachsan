import { AddressInfo } from "node:net";
import { createApp } from "../app";
import { pool, query, withTransaction } from "../config/database";

type RoomOriginalState = {
  roomId: number;
  trangThai: string;
  tinhTrangPhong: string | null;
  trangThaiRealtime: string | null;
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
    const [key, value] = raw.split("=");
    if (key && value !== undefined) merged.set(key, value);
  }
  for (const raw of cookies) {
    const [key, value] = raw.split("=");
    if (key && value !== undefined) merged.set(key, value);
  }

  return [...merged.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function extractCsrfToken(html: string) {
  return html.match(/<meta\s+name="csrf-token"\s+content="([^"]*)"/i)?.[1] || "";
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

async function cleanupSmokeData(user: { username: string; email: string; cccd: string }, roomState: RoomOriginalState | null) {
  const customers = await query<{ id: number }>(
    `
      SELECT kh.makhachhang AS id
      FROM khachhang kh
      LEFT JOIN taikhoan tk ON tk.makhachhang = kh.makhachhang
      WHERE kh.cccd = $1
         OR kh.email = $2
         OR tk.username = $3
    `,
    [user.cccd, user.email, user.username]
  ).catch(() => ({ rows: [] as Array<{ id: number }> }));

  const customerIds = [...new Set(customers.rows.map((item) => Number(item.id || 0)).filter(Boolean))];

  await withTransaction(async (client) => {
    for (const customerId of customerIds) {
      const transactions = await client.query(
        "SELECT magiaodich AS id FROM giaodich WHERE makhachhang = $1",
        [customerId]
      ) as { rows: Array<{ id: number }> };

      for (const transaction of transactions.rows) {
        await client.query("DELETE FROM chitietdichvu WHERE magiaodich = $1", [transaction.id]).catch(() => undefined);
        await client.query("DELETE FROM booking_history WHERE magiaodich = $1", [transaction.id]).catch(() => undefined);
        await client.query("DELETE FROM room_status_log WHERE magiaodich = $1", [transaction.id]).catch(() => undefined);
        await client.query("DELETE FROM chitietgiaodich WHERE magiaodich = $1", [transaction.id]).catch(() => undefined);
        await client.query("DELETE FROM giaodich WHERE magiaodich = $1", [transaction.id]).catch(() => undefined);
      }

      await client.query("DELETE FROM taikhoan WHERE makhachhang = $1 OR username = $2", [customerId, user.username]).catch(() => undefined);
      await client.query("DELETE FROM khachhang WHERE makhachhang = $1", [customerId]).catch(() => undefined);
    }

    await client.query("DELETE FROM taikhoan WHERE username = $1", [user.username]).catch(() => undefined);

    if (roomState) {
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
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let cookieJar = "";
  let csrfToken = "";
  let roomState: RoomOriginalState | null = null;

  const stamp = Date.now();
  const checkinDate = new Date();
  checkinDate.setDate(checkinDate.getDate() + 3);
  const checkoutDate = new Date(checkinDate);
  checkoutDate.setDate(checkoutDate.getDate() + 2);

  const user = {
    fullname: "Smoke User",
    username: `smoke_${stamp}`,
    password: "Smoke@123",
    email: `smoke_${stamp}@example.com`,
    sdt: `090${String(stamp).slice(-7)}`,
    cccd: `9${String(stamp).slice(-11).padStart(11, "0")}`
  };

  try {
    const registerPage = await fetch(`${baseUrl}/auth/register`, { redirect: "manual" });
    cookieJar = appendCookies(cookieJar, registerPage);
    csrfToken = extractCsrfToken(await registerPage.text());
    if (!csrfToken) {
      throw new Error("Register page did not expose CSRF token");
    }

    const registerForm = new URLSearchParams({
      _csrf: csrfToken,
      fullname: user.fullname,
      username: user.username,
      password: user.password,
      repass: user.password,
      email: user.email,
      sdt: user.sdt,
      cccd: user.cccd
    });

    const registerResponse = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieJar
      },
      redirect: "manual",
      body: registerForm.toString()
    });

    if (![302, 303].includes(registerResponse.status)) {
      throw new Error(`Register failed: ${registerResponse.status}`);
    }

    const loginForm = new URLSearchParams({
      _csrf: csrfToken,
      username: user.username,
      password: user.password
    });

    const loginResponse = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieJar
      },
      redirect: "manual",
      body: loginForm.toString()
    });

    if (![302, 303].includes(loginResponse.status)) {
      throw new Error(`Login failed: ${loginResponse.status}`);
    }

    cookieJar = appendCookies(cookieJar, loginResponse);

    const dashboard = await fetch(`${baseUrl}/customer/dashboard`, {
      headers: {
        Cookie: cookieJar
      },
      redirect: "manual"
    });
    if (dashboard.status !== 200) {
      throw new Error(`Customer dashboard failed: ${dashboard.status}`);
    }

    const profilePage = await fetch(`${baseUrl}/customer/profile`, {
      headers: {
        Cookie: cookieJar
      },
      redirect: "manual"
    });
    if (profilePage.status !== 200) {
      throw new Error(`Customer profile failed: ${profilePage.status}`);
    }

    const profileUpdate = new URLSearchParams({
      email: user.email,
      sdt: user.sdt,
      dia_chi: "Smoke Address"
    });

    const profileUpdateResponse = await fetch(`${baseUrl}/customer/profile`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieJar,
        "x-csrf-token": csrfToken
      },
      redirect: "manual",
      body: profileUpdate.toString()
    });

    if (![302, 303].includes(profileUpdateResponse.status)) {
      throw new Error(`Customer profile update failed: ${profileUpdateResponse.status}`);
    }

    const mobileHub = await fetch(`${baseUrl}/customer/mobile-hub`, {
      headers: {
        Cookie: cookieJar
      },
      redirect: "manual"
    });
    if (mobileHub.status !== 200) {
      throw new Error(`Customer mobile hub failed: ${mobileHub.status}`);
    }

    const mobileApi = await fetch(`${baseUrl}/api/customer/mobile-home`, {
      headers: {
        Cookie: cookieJar
      }
    });
    const mobileJson = await mobileApi.json();
    if (!mobileApi.ok || !mobileJson?.ok) {
      throw new Error(`Customer mobile API failed: ${mobileApi.status}`);
    }

    const roomSearch = await fetch(
      `${baseUrl}/api/booking/search?so_khach=1&ngay_nhan=${encodeURIComponent(formatDateInput(checkinDate))}&ngay_tra=${encodeURIComponent(formatDateInput(checkoutDate))}`,
      {
        headers: {
          Cookie: cookieJar
        }
      }
    );
    const roomSearchJson = await roomSearch.json();
    if (!roomSearch.ok || !roomSearchJson?.ok || !Array.isArray(roomSearchJson?.data?.items) || !roomSearchJson.data.items.length) {
      throw new Error(`Booking search for auth smoke failed: ${roomSearch.status}`);
    }

    const room = roomSearchJson.data.items[0];
    roomState = await getRoomState(Number(room.id));
    const createBookingResponse = await fetch(`${baseUrl}/api/booking/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieJar,
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify({
        room_id: room.id,
        ten_khach: user.fullname,
        cccd: user.cccd,
        sdt: user.sdt,
        email: user.email,
        so_nguoi: 1,
        ngay_nhan: formatDateInput(checkinDate),
        ngay_tra: formatDateInput(checkoutDate)
      })
    });
    const bookingJson = await createBookingResponse.json();
    if (createBookingResponse.status !== 201 || !bookingJson?.ok) {
      throw new Error(`Create booking failed: ${createBookingResponse.status}`);
    }

    const servicesPage = await fetch(`${baseUrl}/customer/services`, {
      headers: {
        Cookie: cookieJar
      },
      redirect: "manual"
    });
    if (servicesPage.status !== 200) {
      throw new Error(`Customer services page failed: ${servicesPage.status}`);
    }

    const servicesApi = await fetch(`${baseUrl}/api/customer/services`, {
      headers: {
        Cookie: cookieJar
      }
    });
    const servicesJson = await servicesApi.json();
    if (!servicesApi.ok || !servicesJson?.ok) {
      throw new Error(`Customer services API failed: ${servicesApi.status}`);
    }

    const firstOption = servicesJson?.data?.bookingOptions?.[0];
    const firstCatalog = servicesJson?.data?.catalog?.[0];
    let serviceOrderId = 0;

    if (firstOption && firstCatalog) {
      const createServiceOrderResponse = await fetch(`${baseUrl}/api/customer/services`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieJar,
          "x-csrf-token": csrfToken
        },
        body: JSON.stringify({
          transaction_id: firstOption.transactionId,
          room_id: firstOption.roomId,
          service_id: firstCatalog.id,
          quantity: 1,
          note: "Smoke service order"
        })
      });
      const serviceOrderJson = await createServiceOrderResponse.json();
      if (!createServiceOrderResponse.ok || !serviceOrderJson?.ok) {
        throw new Error(`Create service order failed: ${createServiceOrderResponse.status}`);
      }

      const refreshedServicesApi = await fetch(`${baseUrl}/api/customer/services`, {
        headers: {
          Cookie: cookieJar
        }
      });
      const refreshedServicesJson = await refreshedServicesApi.json();
      serviceOrderId = Number(refreshedServicesJson?.data?.serviceOrders?.[0]?.id || 0);

      if (serviceOrderId > 0) {
        const cancelServiceOrderResponse = await fetch(`${baseUrl}/api/customer/service-orders/${serviceOrderId}/cancel`, {
          method: "POST",
          headers: {
            Cookie: cookieJar,
            "x-csrf-token": csrfToken
          }
        });
        const cancelServiceJson = await cancelServiceOrderResponse.json();
        if (!cancelServiceOrderResponse.ok || !cancelServiceJson?.ok) {
          throw new Error(`Cancel service order failed: ${cancelServiceOrderResponse.status}`);
        }
      }
    }

    const logoutResponse = await fetch(`${baseUrl}/auth/logout`, {
      method: "POST",
      headers: {
        Cookie: cookieJar,
        "x-csrf-token": csrfToken
      },
      redirect: "manual"
    });

    console.log("Auth smoke success");
    console.log(`registered_user=${user.username}`);
    console.log(`dashboard=${dashboard.status}`);
    console.log(`profile=${profilePage.status}`);
    console.log(`mobile_hub=${mobileHub.status}`);
    console.log(`mobile_api_bookings=${Array.isArray(mobileJson?.data?.bookings) ? mobileJson.data.bookings.length : 0}`);
    console.log(`booking_created=${bookingJson?.data?.id || 0}`);
    console.log(`services_page=${servicesPage.status}`);
    console.log(`service_order_cancelled=${serviceOrderId > 0 ? 1 : 0}`);
    console.log(`logout=${logoutResponse.status}`);
  } finally {
    await cleanupSmokeData(user, roomState).catch((error) => {
      console.error("Auth smoke cleanup failed", error);
    });
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
  console.error("Auth smoke failed");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
