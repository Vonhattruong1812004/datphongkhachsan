import { AddressInfo } from "node:net";
import { createApp } from "../app";

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

  return {
    response,
    text,
    json
  };
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

  try {
    const health = await requestJson(`${baseUrl}/api/system/health`);
    if (!health.response.ok || !health.json?.ok) {
      throw new Error(`Health endpoint failed: ${health.response.status}`);
    }

    const ready = await requestJson(`${baseUrl}/api/system/ready`);
    if (!ready.response.ok || !ready.json?.ok) {
      throw new Error(`Ready endpoint failed: ${ready.response.status}`);
    }

    const home = await fetch(`${baseUrl}/`);
    if (!home.ok) {
      throw new Error(`Home page failed: ${home.status}`);
    }
    cookieJar = appendCookies(cookieJar, home);
    csrfToken = extractCsrfToken(await home.text());
    if (!csrfToken) {
      throw new Error("Home page did not expose CSRF token");
    }

    const bookingSearch = await requestJson(`${baseUrl}/api/booking/search?hotel_city=&so_khach=2`);
    if (!bookingSearch.response.ok || !bookingSearch.json?.ok) {
      throw new Error(`Booking search failed: ${bookingSearch.response.status}`);
    }

    const ai = await requestJson(`${baseUrl}/api/ai/concierge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookieJar,
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify({
        message: "Can phong deluxe cho 2 nguoi o Da Nang ngan sach 2 trieu"
      })
    });

    if (!ai.response.ok || !ai.json?.ok) {
      throw new Error(`AI concierge failed: ${ai.response.status}`);
    }

    console.log("Smoke test success");
    console.log(`health=${health.response.status}`);
    console.log(`ready=${ready.response.status}`);
    console.log(`home=${home.status}`);
    console.log(`booking_search_items=${Array.isArray(bookingSearch.json?.data?.items) ? bookingSearch.json.data.items.length : 0}`);
    console.log(`ai_top_pick=${ai.json?.data?.recommendations?.top_pick?.id ?? "none"}`);
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
  }
}

main().catch((error) => {
  console.error("Smoke test failed");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
