import { pool, query, withTransaction } from "../config/database";
import { env } from "../config/env";
import { bookingRegions, normalizeRegion } from "../shared/location/booking-regions";

const apply = process.argv.includes("--apply");
const roomTypes = [
  { code: "S01", type: "Standard", area: 18, bed: "Single", guests: 1, price: 380000 },
  { code: "D02", type: "Superior", area: 26, bed: "Double", guests: 2, price: 650000 },
  { code: "F04", type: "Family", area: 38, bed: "Twin", guests: 4, price: 1050000 },
  { code: "F06", type: "Family", area: 52, bed: "Double", guests: 6, price: 1550000 }
];
const photos = [
  "/uploads/phong/sample-pexels-12805883.jpg", "/uploads/phong/sample-pexels-14613201.jpg",
  "/uploads/phong/sample-pexels-17948132.jpg", "/uploads/phong/sample-pexels-18285947.jpg"
];

async function main() {
  if (env.NODE_ENV === "production" || !["127.0.0.1", "localhost", "::1"].includes(env.PGHOST)) {
    throw new Error("Demo seed is restricted to a local, non-production database.");
  }
  const known = (await query<{ tinhthanh: string }>("SELECT DISTINCT tinhthanh FROM khachsan")).rows.map(row => row.tinhthanh);
  const regions = bookingRegions.map(city => known.find(item => normalizeRegion(item) === normalizeRegion(city)) || city);
  const types = (await query<{ maloai: number; ma: string }>("SELECT maloai, ma FROM loaicosoluutru WHERE ma IN ('HOTEL', 'HOMESTAY')")).rows;
  if (types.length !== 2) throw new Error("HOTEL and HOMESTAY accommodation types are required.");
  const counters = { propertiesInserted: 0, roomsInserted: 0, propertiesExisting: 0, roomsExisting: 0 };
  const rows = await withTransaction(async client => {
    // Serialize only this seed. Never update prices, occupancy or existing bookings.
    await client.query("SELECT pg_advisory_xact_lock(916102026)");
    const before = (await client.query("SELECT (SELECT count(*) FROM giaodich)::int bookings, (SELECT count(*) FROM chitietgiaodich)::int booking_rooms")).rows[0];
    for (const [index, city] of regions.entries()) {
      for (const type of types) {
        const suffix = type.ma === "HOTEL" ? "Hotel" : "Homestay";
        const name = `Bento Demo ${city} ${suffix}`;
        const existing = await client.query("SELECT makhachsan FROM khachsan WHERE tenkhachsan=$1", [name]);
        if (existing.rows.length > 1) throw new Error(`Ambiguous demo property: ${name}`);
        let id = existing.rows[0]?.makhachsan;
        if (id) counters.propertiesExisting++;
        else {
          counters.propertiesInserted++;
          if (apply) {
            const inserted = await client.query(`INSERT INTO khachsan
              (tenkhachsan,tinhthanh,diachi,email,trangthai,maloailuutru)
              VALUES ($1,$2,$3,$4,'HoatDong',$5) RETURNING makhachsan`,
            [name, city, `Dữ liệu demo tại ${city}; chưa xác minh địa chỉ thực tế`, `demo-${index}-${type.ma.toLowerCase()}@example.test`, type.maloai]);
            id = inserted.rows[0].makhachsan;
          }
        }
        for (const [roomIndex, room] of roomTypes.entries()) {
          const number = `D${String(index + 1).padStart(2, "0")}${type.ma === "HOTEL" ? "H" : "S"}${room.code}`;
          const found = id ? await client.query("SELECT maphong FROM phong WHERE makhachsan=$1 AND sophong=$2", [id, number]) : { rows: [] };
          if (found.rows.length) { counters.roomsExisting++; continue; }
          counters.roomsInserted++;
          if (!apply) continue;
          await client.query(`INSERT INTO phong
            (makhachsan,sophong,loaiphong,dientich,loaigiuong,viewphong,gia,trangthai,trangthairealtime,sokhachtoida,ghichu,tinhtrangphong,hinhanh,douutienhienthi,vitri)
            VALUES ($1,$2,$3,$4,$5,$6,$7,'Trong','Available',$8,$9,'Tot',$10,0,$11)`,
          [id, number, room.type, room.area, room.bed, type.ma === "HOTEL" ? "Thành phố" : "Vườn",
            room.price + (index % 5) * 30000 + (type.ma === "HOTEL" ? 100000 : 0), room.guests,
            "DEMO_REGIONAL_V1: Phòng, giá và tiện nghi giả lập để kiểm thử. Ảnh minh họa; không phải cơ sở đã xác minh, không giao dịch thực tế.",
            photos[(index + roomIndex) % photos.length], `Khu vực tìm kiếm: ${city} (demo)`]);
        }
      }
    }
    const after = (await client.query("SELECT (SELECT count(*) FROM giaodich)::int bookings, (SELECT count(*) FROM chitietgiaodich)::int booking_rooms")).rows[0];
    return { before, after };
  });
  console.log(JSON.stringify({ mode: apply ? "applied" : "dry-run", searchAreas: regions.length, ...counters, ...rows }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
