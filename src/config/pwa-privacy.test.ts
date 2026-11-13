import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

test("PWA never intercepts identity images or the customer's account API", () => {
  const listeners = new Map<string, (event: any) => void>();
  vm.runInNewContext(fs.readFileSync(path.resolve(process.cwd(), "public/sw.js"), "utf8"), {
    self: { location: { origin: "https://bento.test" }, addEventListener: (name: string, fn: (event: any) => void) => listeners.set(name, fn) },
    URL, Set, decodeURIComponent
  });
  for (const pathname of ["/uploads/ekyc/doc.jpg", "/uploads/%65kyc/doc.jpg", "/uploads/%xx/file.jpg", "/api/customer/mobile-home"]) {
    let intercepted = false;
    listeners.get("fetch")!({ request: { method: "GET", url: `https://bento.test${pathname}`, headers: new Headers() }, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false, pathname);
  }
});

test("offline navigation falls back to the generic offline page, not a prior user's page", async () => {
  const listeners = new Map<string, (event: any) => void>();
  const matches: unknown[] = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(process.cwd(), "public/sw.js"), "utf8"), {
    self: { location: { origin: "https://bento.test" }, addEventListener: (name: string, fn: (event: any) => void) => listeners.set(name, fn) },
    URL, Set, decodeURIComponent,
    fetch: async () => { throw new Error("offline"); },
    caches: { match: async (key: unknown) => { matches.push(key); return "offline-page"; } }
  });
  let response: Promise<unknown> | undefined;
  listeners.get("fetch")!({ request: { method: "GET", mode: "navigate", url: "https://bento.test/customer/dashboard", headers: new Headers() }, respondWith: (value: Promise<unknown>) => { response = value; } });
  assert.equal(await response, "offline-page");
  assert.deepEqual(matches, ["/offline.html"]);
});
