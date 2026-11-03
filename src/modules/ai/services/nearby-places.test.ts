import test from "node:test";
import assert from "node:assert/strict";
import { NearbyPlacesService, distanceKm, parseNearbyPlaces } from "./nearby-places";

const node = (id: number, lat: number, lon: number, name = `Hotel ${id}`) => ({
  type: "node", id, lat, lon, tags: { tourism: "hotel", name }
});
const origin = { latitude: 21.028511, longitude: 105.854444 };

test("map records require real identifiers, coordinates, names and accommodation types", () => {
  const places = parseNearbyPlaces({ elements: [
    node(1, 21.03, 105.85), node(1, 21.03, 105.85), node(2, 21.03, 105.85, "Hotel 1"),
    { type: "way", id: 3, center: { lat: 21.04, lon: 105.85 }, tags: { tourism: "hostel", name: "Hostel" } },
    node(4, 999, 105), { ...node(5, 21, 105), tags: { tourism: "restaurant", name: "Food" } },
    { ...node(6, 21, 105), tags: { tourism: "hotel", name: "Closed", disused: "yes" } },
    node(7, 21, 105, ""), { ...node(8, 21, 105), id: "javascript:alert(1)" }
  ] });
  assert.equal(places.length, 2);
  assert.equal(places[1].sourceUrl, "https://www.openstreetmap.org/way/3");
  assert.equal("price" in places[0], false);
  assert.throws(() => parseNearbyPlaces({ elements: [], remark: "runtime error: timed out" }));
});

test("nearby discovery rounds outgoing coordinates, caches, sorts and caps results", async () => {
  let calls = 0;
  const service = new NearbyPlacesService(async (_url, options) => {
    calls++;
    const body = new URLSearchParams(String(options?.body)).get("data")!;
    assert.ok(body.includes("21.03,105.85"));
    assert.ok(!body.includes("21.028511"));
    assert.ok(body.includes("out body center"), "Node coordinates must be included, not just tags");
    return Response.json({ elements: [
      node(1, 21.1, 105.85), node(2, 21.04, 105.85), node(3, 21.03, 105.85),
      node(4, 21.05, 105.85), node(5, 22, 105.85)
    ] });
  });
  const first = await service.discover(origin);
  const second = await service.discover(origin);
  assert.equal(calls, 1);
  assert.equal(first.status, "found");
  assert.equal(first.places.length, 3);
  assert.deepEqual(first.places.map(place => place.id), ["node/3", "node/2", "node/4"]);
  assert.deepEqual(second, first);
  assert.ok(first.places.every(place => place.distanceKm <= 25));
  assert.match(first.mapsUrl, /^https:\/\/www.google.com\/maps\/search/);
});

test("same-area concurrent lookups share one request and different areas are rate limited", async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const service = new NearbyPlacesService(async () => {
    calls++; await gate;
    return Response.json({ elements: [] });
  });
  const first = service.discover(origin);
  const second = service.discover(origin);
  assert.equal((await service.discover({ latitude: 16, longitude: 108 })).status, "unavailable");
  release();
  assert.equal((await first).status, "empty");
  assert.equal((await second).status, "empty");
  assert.equal(calls, 1);
});

test("timeouts, provider errors and invalid data return map search without invented places", async () => {
  const failures: Array<typeof fetch> = [
    async () => { throw new Error("timeout"); },
    async () => new Response("limited", { status: 429 }),
    async () => new Response("not JSON"),
    async () => Response.json({ elements: [], remark: "runtime error" }),
    async () => new Response("x".repeat(2000001))
  ];
  for (const fetcher of failures) {
    const result = await new NearbyPlacesService(fetcher).discover(origin);
    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.places, []);
    assert.ok(result.mapsUrl);
  }
});

test("cache expiry reloads and invalid coordinates never reach the provider", async () => {
  let now = 1000000;
  let calls = 0;
  const service = new NearbyPlacesService(async () => {
    calls++; return Response.json({ elements: [] });
  }, () => now);
  await assert.rejects(service.discover({ latitude: NaN, longitude: 105 }));
  assert.equal(calls, 0);
  await service.discover(origin);
  now += 900001;
  await service.discover(origin);
  assert.equal(calls, 2);
  assert.equal(distanceKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 }), 0);
});
