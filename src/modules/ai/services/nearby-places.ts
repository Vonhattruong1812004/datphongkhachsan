import { z } from "zod";

const pointSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180)
});
const labels: Record<string, string> = {
  hotel: "Khách sạn", motel: "Nhà nghỉ", hostel: "Hostel",
  guest_house: "Nhà khách", apartment: "Căn hộ", chalet: "Nhà nghỉ dưỡng", resort: "Resort"
};
const elementSchema = z.object({
  type: z.enum(["node", "way", "relation"]), id: z.number().int().positive(),
  lat: z.number().min(-90).max(90).optional(), lon: z.number().min(-180).max(180).optional(),
  center: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).optional(),
  tags: z.record(z.string())
});
type Place = { id: string; name: string; type: string; latitude: number; longitude: number; sourceUrl: string };
type Point = z.infer<typeof pointSchema>;
type Snapshot = { status: "ok" | "unavailable"; places: Place[]; checkedAt: number };

export function distanceKm(from: Point, to: Point) {
  const rad = Math.PI / 180;
  const a = Math.sin((to.latitude - from.latitude) * rad / 2) ** 2
    + Math.cos(from.latitude * rad) * Math.cos(to.latitude * rad)
    * Math.sin((to.longitude - from.longitude) * rad / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
}

export function parseNearbyPlaces(raw: unknown): Place[] {
  const payload = z.object({ elements: z.array(z.unknown()), remark: z.string().optional() }).parse(raw);
  // Overpass can return HTTP 200 with a runtime error and incomplete results.
  if (payload.remark) throw new Error("Incomplete map response");
  const seen = new Set<string>();
  const places: Place[] = [];
  for (const element of payload.elements.slice(0, 500)) {
    const parsed = elementSchema.safeParse(element);
    if (!parsed.success) continue;
    const item = parsed.data;
    const name = (item.tags["name:vi"] || item.tags.name || "").trim().slice(0, 180);
    const type = labels[item.tags.tourism];
    const latitude = item.lat ?? item.center?.lat;
    const longitude = item.lon ?? item.center?.lon;
    if (!name || !type || latitude == null || longitude == null
      || item.tags.disused === "yes" || item.tags.abandoned === "yes" || item.tags.access === "private") continue;
    const id = `${item.type}/${item.id}`;
    const duplicateKey = `${name.toLowerCase()}:${latitude.toFixed(3)}:${longitude.toFixed(3)}`;
    if (seen.has(id) || seen.has(duplicateKey)) continue;
    seen.add(id); seen.add(duplicateKey);
    places.push({ id, name, type, latitude, longitude, sourceUrl: `https://www.openstreetmap.org/${id}` });
  }
  return places;
}

export class NearbyPlacesService {
  private cache = new Map<string, { expires: number; snapshot: Snapshot }>();
  private pending = new Map<string, Promise<Snapshot>>();
  private nextRequestAt = 0;
  private usage = { day: "", requests: 0, bytes: 0 };

  constructor(private readonly fetcher: typeof fetch = fetch, private readonly now = Date.now) {}

  async discover(rawPoint: Point) {
    const point = pointSchema.parse(rawPoint);
    // Only approximate coordinates leave Bento; exact distances are computed locally.
    const latitude = Number(point.latitude.toFixed(2));
    const longitude = Number(point.longitude.toFixed(2));
    const key = `${latitude},${longitude}`;
    const cached = this.cache.get(key);
    let snapshot: Snapshot;
    if (cached && cached.expires > this.now()) snapshot = cached.snapshot;
    else if (this.pending.has(key)) snapshot = await this.pending.get(key)!;
    else if (this.pending.size || this.now() < this.nextRequestAt) {
      snapshot = { status: "unavailable", places: [], checkedAt: this.now() };
    } else {
      this.nextRequestAt = this.now() + 10000;
      const task = this.load(latitude, longitude);
      this.pending.set(key, task);
      try {
        snapshot = await task;
        if (this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, { snapshot, expires: this.now() + (snapshot.status === "ok" ? 900000 : 60000) });
      } finally { this.pending.delete(key); }
    }
    const places = snapshot.places.map(place => ({ ...place, distanceKm: distanceKm(point, place) }))
      .filter(place => place.distanceKm <= 25)
      .sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 3);
    return {
      status: snapshot.status === "unavailable" ? "unavailable" : places.length ? "found" : "empty",
      places, checkedAt: snapshot.checkedAt, radiusKm: 25,
      source: "OpenStreetMap", sourceUrl: "https://www.openstreetmap.org/copyright",
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`hotels near ${latitude},${longitude}`)}`
    };
  }

  private async load(latitude: number, longitude: number): Promise<Snapshot> {
    try {
      const endpoint = process.env.AI_NEARBY_OVERPASS_URL || "https://overpass-api.de/api/interpreter";
      // Public instances are suitable for local evaluation, not a production dependency.
      if (process.env.AI_NEARBY_DISCOVERY === "false"
        || (process.env.NODE_ENV === "production" && !process.env.AI_NEARBY_OVERPASS_URL)) {
        throw new Error("External discovery disabled");
      }
      if (new URL(endpoint).protocol !== "https:") throw new Error("HTTPS map endpoint required");
      const publicServer = new URL(endpoint).hostname === "overpass-api.de";
      const day = new Date(this.now()).toISOString().slice(0, 10);
      if (this.usage.day !== day) this.usage = { day, requests: 0, bytes: 0 };
      if (publicServer && (this.usage.requests >= 50 || this.usage.bytes >= 8000000)) {
        throw new Error("Local public map budget exhausted");
      }
      this.usage.requests++;
      const query = `[out:json][timeout:6][maxsize:33554432];nwr(around:26000,${latitude},${longitude})["tourism"~"^(hotel|motel|hostel|guest_house|apartment|chalet|resort)$"]["name"];out body center 500;`;
      const response = await this.fetcher(endpoint, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json",
          "User-Agent": "BentoResort-LocalResearch/1.0"
        },
        body: new URLSearchParams({ data: query }).toString()
      });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new Error("Map provider unavailable");
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          this.usage.bytes += value.byteLength;
          if (size > 2000000) throw new Error("Map response too large");
          chunks.push(value);
        }
      } finally { await reader.cancel(); }
      return { status: "ok", places: parseNearbyPlaces(JSON.parse(Buffer.concat(chunks).toString("utf8"))), checkedAt: this.now() };
    } catch {
      this.nextRequestAt = this.now() + 60000;
      return { status: "unavailable", places: [], checkedAt: this.now() };
    }
  }
}

export const nearbyPlacesService = new NearbyPlacesService();
