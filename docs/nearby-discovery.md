# Nearby accommodation discovery

When current browser location is fresh (at most five minutes old) and Bento has
no matching room within 25 km, the concierge queries OpenStreetMap via Overpass.
It returns at most three named accommodation places, ordered by straight-line
distance. A maximum of 500 source records is examined, so this is not an exhaustive
list or a guarantee of the three closest hotels.

## Inventory boundary

- Map places are reference listings, not Bento rooms. No database inserts occur.
- Do not invent prices, capacity, availability, photos, promotions or deposits.
- Reference listings link to their OSM record, never a Bento booking/payment route.
- Adding bookable inventory still requires verified property, room, rate and
  availability data from the owner or a contracted booking provider.
- Empty coverage or provider failure offers a map search, not synthetic hotels.

## Privacy and operations

- Browser location permission is required. The query sent to Overpass contains
  coordinates rounded to two decimal places, not the user's name or booking data.
  Approximate location is still location data; disclose this in deployment privacy notices.
- Exact position is used locally to calculate distance, not stored in this cache.
- Cache: 15 minutes, at most 64 areas; failed requests: one minute.
- One network request at a time, at least 10 seconds between uncached requests;
  requests for the same area share one pending response.
- Ten-second timeout, two-megabyte response cap, no automatic retry loop.
- Provider failures pause all new remote requests for one minute. The default
  public instance is limited per process to 50 requests/day and starts no new
  query after eight megabytes/day (a running response may add at most two more).
- For local thesis testing no API key is required. Set `AI_NEARBY_DISCOVERY=false`
  to disable remote lookups. Production requires a dedicated HTTPS endpoint in
  `AI_NEARBY_OVERPASS_URL`; the public server is not used by default in production.
- No Redis is required. Cache and limits are per process; multi-instance production
  needs a shared rate limiter/cache and a contracted or self-hosted data source.

Source attribution is displayed next to results. Respect the
[OSM license](https://www.openstreetmap.org/copyright) and
[Overpass public service guidance](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html).
