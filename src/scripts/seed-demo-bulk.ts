import { pool, withTransaction } from "../config/database";

const MARKER = "DEMO_BULK_20260729";
const CODE_PREFIX = "DEMO-20260729";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

type CustomerRow = {
  makhachhang: number;
  tenkh: string;
  sdt: string;
  email: string;
};

type RoomRow = {
  maphong: number;
  makhachsan: number;
  sophong: string;
  loaiphong: string;
  loaigiuong: string;
  viewphong: string | null;
  gia: string | number;
  sokhachtoida: number;
  tenkhachsan: string;
  tinhthanh: string;
  quanhuyen: string | null;
};

type ServiceRow = {
  madichvu: number;
  tendichvu: string;
  giadichvu: string | number;
};

const names = [
  "Nguyen Minh Anh",
  "Tran Gia Bao",
  "Le Thanh Dat",
  "Pham Quynh Nhu",
  "Vo Hoang Long",
  "Dang Thuy Linh",
  "Bui Duc Huy",
  "Hoang Khanh Vy",
  "Do Minh Quan",
  "Phan Ngoc Han",
  "Huynh Bao Chau",
  "Ngo Tuan Kiet",
  "Truong Phuong Nam",
  "Mai Bao Ngoc",
  "Ly Thanh Son",
  "Lam Nhat Ha",
  "Dinh Gia Han",
  "Cao Minh Tri",
  "Ta Hoai An",
  "Vu Anh Thu"
];

const expenseNames = [
  ["Chi phi van hanh le tan", "VanHanh"],
  ["Hoa don dien nuoc co so luu tru", "DienNuoc"],
  ["Bao tri phong va thiet bi", "BaoTri"],
  ["Hoa hong doi tac OTA", "HoaHong"],
  ["Mua vat tu buong phong", "VatTu"],
  ["Chi phi marketing dia diem", "Marketing"],
  ["Phi dich vu thanh toan", "ThanhToan"],
  ["Thue xe dua don khach", "VanChuyen"]
];

function money(value: number) {
  return Math.round(value / 1000) * 1000;
}

function july(day: number, hour = 9, minute = 0) {
  const safeDay = Math.max(1, Math.min(31, day));
  return `2026-07-${String(safeDay).padStart(2, "0")} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+07`;
}

function august(day: number, hour = 12) {
  return `2026-08-${String(day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:00+07`;
}

function addDays(baseDay: number, offset: number, hour = 14) {
  if (baseDay + offset <= 31) return july(baseDay + offset, hour);
  return august(baseDay + offset - 31, hour);
}

async function cleanup(client: DbClient) {
  const existing = await client.query(
    `
      SELECT magiaodich
      FROM giaodich
      WHERE madatcho LIKE $1 OR ghichu LIKE $2
    `,
    [`${CODE_PREFIX}-%`, `%${MARKER}%`]
  );
  const ids = (existing.rows as Array<{ magiaodich: number }>).map((row) => Number(row.magiaodich)).filter(Boolean);

  if (ids.length) {
    await client.query("DELETE FROM refund_requests WHERE magiaodich = ANY($1::int[]) OR refund_code LIKE $2", [ids, `RF-${CODE_PREFIX}-%`]);
    await client.query("DELETE FROM hoadon WHERE magiaodich = ANY($1::int[])", [ids]);
    await client.query("DELETE FROM congnophaithu WHERE magiaodich = ANY($1::int[]) OR ghichu LIKE $2", [ids, `%${MARKER}%`]);
    await client.query("DELETE FROM chitietdichvu WHERE magiaodich = ANY($1::int[])", [ids]);
    await client.query("DELETE FROM booking_history WHERE magiaodich = ANY($1::int[])", [ids]);
    await client.query("DELETE FROM chitietgiaodich WHERE magiaodich = ANY($1::int[])", [ids]);
    await client.query("DELETE FROM giaodich WHERE magiaodich = ANY($1::int[])", [ids]);
  }

  await client.query("DELETE FROM system_notifications WHERE event_type LIKE 'demo.%' OR title LIKE '[Demo]%'").catch(() => undefined);
  await client.query("DELETE FROM khachhang WHERE email LIKE 'demo.bulk.%@bento.test' OR cccd LIKE '07920260729%'");
  await client.query("DELETE FROM chiphi WHERE noidung LIKE $1 OR sohoadon LIKE $2", [`%${MARKER}%`, `CP-${CODE_PREFIX}-%`]);
}

async function insertCustomers(client: DbClient) {
  const customers: CustomerRow[] = [];

  for (let i = 0; i < 40; i += 1) {
    const name = `${names[i % names.length]} ${String(Math.floor(i / names.length) + 1).padStart(2, "0")}`;
    const ekyc = i % 6 === 0 ? "ThatBai" : i % 4 === 0 ? "ChuaXacThuc" : "DaXacThuc";
    const result = await client.query(
      `
        INSERT INTO khachhang (tenkh, sdt, email, cccd, diachi, loaikhach, trangthaiekyc)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING makhachhang, tenkh, sdt, email
      `,
      [
        name,
        `09876${String(10000 + i).slice(-5)}`,
        `demo.bulk.${String(i + 1).padStart(3, "0")}@bento.test`,
        `07920260729${String(i + 1).padStart(4, "0")}`,
        `Quan ${1 + (i % 12)}, TP demo`,
        i % 7 === 0 ? "DoanhNghiep" : "CaNhan",
        ekyc
      ]
    );
    customers.push(result.rows[0] as CustomerRow);
  }

  return customers;
}

async function loadRooms(client: DbClient) {
  const result = await client.query(
    `
      SELECT
        p.maphong,
        p.makhachsan,
        p.sophong,
        p.loaiphong,
        p.loaigiuong,
        p.viewphong,
        p.gia,
        p.sokhachtoida,
        ks.tenkhachsan,
        ks.tinhthanh,
        ks.quanhuyen
      FROM phong p
      JOIN khachsan ks ON ks.makhachsan = p.makhachsan
      WHERE p.trangthai <> 'BaoTri'
      ORDER BY
        CASE WHEN p.gia >= 500000 THEN 0 ELSE 1 END,
        p.gia DESC,
        p.maphong
      LIMIT 80
    `
  );

  if (result.rows.length < 10) {
    throw new Error("Can it nhat 10 phong de seed du lieu demo.");
  }

  return result.rows as RoomRow[];
}

async function loadServices(client: DbClient) {
  const result = await client.query(
    `
      SELECT madichvu, tendichvu, giadichvu
      FROM dichvu
      WHERE trangthai = 'HoatDong'
        AND COALESCE(giadichvu, 0) > 0
        AND COALESCE(giadichvu, 0) < 5000000
      ORDER BY madichvu
    `
  );

  return result.rows as ServiceRow[];
}

function statusFor(index: number) {
  if (index < 42) return "Paid";
  if (index < 64) return "Stayed";
  if (index < 84) return "Booked";
  return "DaHuy";
}

function detailStatusFor(transactionStatus: string) {
  if (transactionStatus === "Paid") return "CheckedOut";
  if (transactionStatus === "Stayed") return "CheckedIn";
  if (transactionStatus === "DaHuy") return "Cancelled";
  return "Booked";
}

function historyStatusFor(transactionStatus: string) {
  if (transactionStatus === "DaHuy") return "Cancelled";
  if (transactionStatus === "Paid" || transactionStatus === "Stayed") return "Stayed";
  return "Booked";
}

async function insertTransactions(client: DbClient, customers: CustomerRow[], rooms: RoomRow[], services: ServiceRow[]) {
  const transactions: Array<{
    id: number;
    code: string;
    customer: CustomerRow;
    status: string;
    total: number;
    day: number;
    roomIds: number[];
  }> = [];

  for (let i = 0; i < 92; i += 1) {
    const customer = customers[i % customers.length];
    const status = statusFor(i);
    const source = ["Web", "Mobile", "LeTan", "AdminAPI"][i % 4];
    const paymentMethod = status === "Paid"
      ? ["ChuyenKhoan", "The", "ViDienTu", "TienMat"][i % 4]
      : status === "Stayed"
        ? "ChuyenKhoan"
        : "ChuaThanhToan";
    const day = 1 + (i % 29);
    const roomCount = i % 6 === 0 ? 2 : 1;
    const pickedRooms = Array.from({ length: roomCount }, (_, offset) => rooms[(i * 3 + offset * 11) % rooms.length]);
    const nights = 1 + (i % 4);
    let roomTotal = 0;
    let serviceTotal = 0;

    const transaction = await client.query(
      `
        INSERT INTO giaodich (
          makhachhang,
          madatcho,
          ngaygiaodich,
          loaigiaodich,
          nguondat,
          tongtien,
          trangthai,
          phuongthucthanhtoan,
          ghichu
        )
        VALUES ($1, $2, $3::timestamptz, 'DatPhong', $4, 0, $5, $6, $7)
        RETURNING magiaodich
      `,
      [
        customer.makhachhang,
        `${CODE_PREFIX}-${String(i + 1).padStart(3, "0")}`,
        july(day, 8 + (i % 10), (i * 7) % 60),
        source,
        status,
        paymentMethod,
        `${MARKER} | Du lieu demo hang loat cho dashboard va nghiep vu`
      ]
    );

    const transactionId = Number((transaction.rows[0] as { magiaodich: number }).magiaodich);
    const checkinDay = day + 1;
    const roomIds: number[] = [];

    for (const [detailIndex, room] of pickedRooms.entries()) {
      const basePrice = money(Math.max(Number(room.gia) || 0, 850000 + ((i + detailIndex) % 9) * 175000));
      const surcharge = (i + detailIndex) % 9 === 0 ? 180000 : 0;
      const damage = status === "Paid" && (i + detailIndex) % 13 === 0 ? 220000 : 0;
      const lineTotal = basePrice * nights + surcharge + damage;
      const detailStatus = detailStatusFor(status);
      roomTotal += lineTotal;
      roomIds.push(Number(room.maphong));

      await client.query(
        `
          INSERT INTO chitietgiaodich (
            magiaodich,
            maphong,
            songuoi,
            ngaynhandukien,
            ngaytradukien,
            ngaycheckin,
            ngaycheckout,
            dongia,
            thanhtien,
            tienphuthu,
            tienboithuong,
            trangthai,
            ghichu,
            tenkhach,
            cccd,
            sdt,
            email
          )
          VALUES ($1,$2,$3,$4::timestamptz,$5::timestamptz,$6::timestamptz,$7::timestamptz,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        `,
        [
          transactionId,
          room.maphong,
          Math.min(Number(room.sokhachtoida || 2), 1 + (i % Math.max(1, Number(room.sokhachtoida || 2)))),
          addDays(checkinDay, 0, 14),
          addDays(checkinDay, nights, 12),
          status === "Paid" || status === "Stayed" ? addDays(checkinDay, 0, 14) : null,
          status === "Paid" ? addDays(checkinDay, nights, 11) : null,
          basePrice,
          lineTotal,
          surcharge,
          damage,
          detailStatus,
          `${MARKER} | ${room.tenkhachsan} | ${room.tinhthanh}`,
          customer.tenkh,
          `07920260729${String((i % 40) + 1).padStart(4, "0")}`,
          customer.sdt,
          customer.email
        ]
      );

      await client.query(
        `
          INSERT INTO booking_history (makhachhang, maphong, magiaodich, ngaydat, songuoi, dongia, ketqua)
          VALUES ($1, $2, $3, $4::timestamptz, $5, $6, $7)
        `,
        [
          customer.makhachhang,
          room.maphong,
          transactionId,
          july(day, 9),
          Math.min(Number(room.sokhachtoida || 2), 1 + (i % Math.max(1, Number(room.sokhachtoida || 2)))),
          basePrice,
          historyStatusFor(status)
        ]
      );
    }

    if (services.length && status !== "DaHuy" && i % 2 === 0) {
      const serviceLines = 1 + (i % 3);
      for (let s = 0; s < serviceLines; s += 1) {
        const service = services[(i + s) % services.length];
        const quantity = 1 + ((i + s) % 3);
        const servicePrice = money(Number(service.giadichvu) || 0);
        const amount = servicePrice * quantity;
        serviceTotal += amount;

        await client.query(
          `
            INSERT INTO chitietdichvu (
              magiaodich,
              maphong,
              madichvu,
              soluong,
              giaban,
              thanhtien,
              thoidiemghinhan,
              ghichu,
              ngaydat,
              trangthaidichvu
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8,$9::timestamptz,$10)
          `,
          [
            transactionId,
            pickedRooms[0].maphong,
            service.madichvu,
            quantity,
            servicePrice,
            amount,
            july(day, 15 + (s % 4)),
            `${MARKER} | Dich vu demo: ${service.tendichvu}`,
            july(day, 15 + (s % 4)),
            status === "Booked" ? "ChuaSuDung" : "DaSuDung"
          ]
        );
      }
    }

    const total = roomTotal + serviceTotal;
    await client.query("UPDATE giaodich SET tongtien = $2 WHERE magiaodich = $1", [transactionId, total]);

    transactions.push({
      id: transactionId,
      code: `${CODE_PREFIX}-${String(i + 1).padStart(3, "0")}`,
      customer,
      status,
      total,
      day,
      roomIds
    });

    if (status === "Paid") {
      await client.query(
        `
          INSERT INTO hoadon (magiaodich, makhachhang, ngaylap, tongtien, phuongthucthanhtoan, trangthai, ghichu)
          VALUES ($1, $2, $3::timestamptz, $4, $5, 'DaThanhToan', $6)
        `,
        [transactionId, customer.makhachhang, july(day, 18), total, paymentMethod, `${MARKER} | Hoa don demo da thanh toan`]
      );
    }

    if ((status === "Stayed" || status === "Booked") && i % 2 === 0) {
      const collected = status === "Stayed" ? money(total * 0.55) : money(total * 0.35);
      const dueDay = i % 5 === 0 ? 20 : 31;
      const debtStatus = dueDay < 29 ? "QuaHan" : collected > 0 ? "ThuMotPhan" : "ChuaThu";
      await client.query(
        `
          INSERT INTO congnophaithu (
            makhachhang,
            magiaodich,
            sotiengoc,
            sotiendathu,
            ngayphatsinh,
            ngaydenhan,
            trangthaithanhtoan,
            ghichu
          )
          VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,$8)
        `,
        [
          customer.makhachhang,
          transactionId,
          total,
          collected,
          `2026-07-${String(day).padStart(2, "0")}`,
          `2026-07-${String(dueDay).padStart(2, "0")}`,
          debtStatus,
          `${MARKER} | Cong no demo`
        ]
      );
    }
  }

  return transactions;
}

async function insertRefundsAndNotifications(client: DbClient, transactions: Awaited<ReturnType<typeof insertTransactions>>) {
  const cancelled = transactions.filter((transaction) => transaction.status === "DaHuy").slice(0, 8);
  const statuses = ["ChoQuanLyDuyet", "ChoXuLy", "ChoXuLy", "DaHoan", "TuChoi", "ChoQuanLyDuyet", "DaHoan", "ChoXuLy"];

  for (const [index, transaction] of cancelled.entries()) {
    const requested = money(transaction.total * (index % 3 === 0 ? 0.5 : 0.8));
    const retained = Math.max(0, money(transaction.total * 0.1));
    const status = statuses[index] || "ChoXuLy";
    const refundCode = `RF-${CODE_PREFIX}-${String(index + 1).padStart(3, "0")}`;

    const refund = await client.query(
      `
        INSERT INTO refund_requests (
          magiaodich,
          refund_code,
          scope,
          room_ids,
          customer_name,
          customer_phone,
          customer_email,
          bank_name,
          bank_account_no,
          bank_account_name,
          reason,
          note,
          deposit_paid,
          retained_deposit,
          already_requested,
          amount_requested,
          amount_paid,
          status,
          created_by_role,
          processed_at,
          accounting_note,
          refundable_base,
          refund_rate,
          hours_before_checkin,
          cancellation_policy_key,
          cancellation_policy_label,
          cancellation_policy_note,
          manager_note,
          manager_reviewed_at,
          manager_by,
          refund_payment_content,
          refund_bank_txn_id,
          refund_paid_at,
          refund_paid_by
        )
        VALUES ($1,$2,'all',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,$14,$15,$16,'LeTan',$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)
        RETURNING id
      `,
      [
        transaction.id,
        refundCode,
        transaction.roomIds.join(","),
        transaction.customer.tenkh,
        transaction.customer.sdt,
        transaction.customer.email,
        ["Vietcombank", "BIDV", "Techcombank", "MB Bank"][index % 4],
        `9704${String(100000000 + index * 137).slice(-9)}`,
        transaction.customer.tenkh.toUpperCase(),
        index % 2 === 0 ? "Khach huy phong do doi lich di chuyen" : "Khach doi sang lich khac",
        `${MARKER} | Yeu cau hoan tien demo`,
        money(transaction.total * 0.5),
        retained,
        requested,
        status === "DaHoan" ? requested : 0,
        status,
        status === "DaHoan" ? july(24 + (index % 4), 16) : null,
        status === "DaHoan" ? "Da chuyen khoan hoan tien demo" : null,
        money(transaction.total * 0.5),
        index % 3 === 0 ? 50 : 80,
        48 + index * 6,
        index % 3 === 0 ? "partial_50" : "flex_80",
        index % 3 === 0 ? "Hoan 50% tien coc" : "Hoan 80% tien coc",
        "Chinh sach demo phu thuoc thoi diem huy truoc ngay nhan phong.",
        status === "TuChoi" ? "Khong du dieu kien hoan tien" : status === "ChoXuLy" || status === "DaHoan" ? "Quan ly da duyet de ke toan xu ly" : null,
        status === "ChoXuLy" || status === "DaHoan" || status === "TuChoi" ? july(23 + (index % 4), 10) : null,
        status === "ChoXuLy" || status === "DaHoan" || status === "TuChoi" ? "QuanLy Demo" : null,
        status === "DaHoan" ? `HOAN ${refundCode}` : null,
        status === "DaHoan" ? `BANK-DEMO-${String(index + 1).padStart(3, "0")}` : null,
        status === "DaHoan" ? july(24 + (index % 4), 16) : null,
        status === "DaHoan" ? "KeToan Demo" : null
      ]
    );

    const refundId = Number((refund.rows[0] as { id: number }).id);
    const managerReadAt = status === "ChoQuanLyDuyet" ? null : july(23 + (index % 4), 11);
    const accountingReadAt = status === "ChoXuLy" ? null : status === "DaHoan" ? july(24 + (index % 4), 17) : null;
    const customerReadAt = status === "DaHoan" ? null : status === "TuChoi" ? null : july(25, 10);

    await client.query(
      `
        INSERT INTO system_notifications (
          recipient_role_id,
          event_type,
          title,
          body,
          href,
          entity_type,
          entity_id,
          read_at,
          created_at
        )
        VALUES (6,'demo.refund.manager','[Demo] Yêu cầu duyệt hoàn tiền',$1,$2,'refund_request',$3,$4,$5::timestamptz)
      `,
      [
        `${transaction.customer.tenkh} huy ${transaction.code}, de nghi hoan ${requested.toLocaleString("vi-VN")} d.`,
        `/manager/refunds?refund_id=${refundId}`,
        refundId,
        managerReadAt,
        july(22 + (index % 5), 9)
      ]
    );

    if (status === "ChoXuLy" || status === "DaHoan") {
      await client.query(
        `
          INSERT INTO system_notifications (
            recipient_role_id,
            event_type,
            title,
            body,
            href,
            entity_type,
            entity_id,
            read_at,
            created_at
          )
          VALUES (3,'demo.refund.accounting','[Demo] Chờ chuyển khoản hoàn tiền',$1,$2,'refund_request',$3,$4,$5::timestamptz)
        `,
        [
          `${refundCode} da duoc duyet, can chi ${requested.toLocaleString("vi-VN")} d cho ${transaction.customer.tenkh}.`,
          `/accounting/refunds?refund_id=${refundId}`,
          refundId,
          accountingReadAt,
          july(23 + (index % 4), 12)
        ]
      );
    }

    if (status === "DaHoan" || status === "TuChoi") {
      await client.query(
        `
          INSERT INTO system_notifications (
            recipient_customer_id,
            event_type,
            title,
            body,
            href,
            entity_type,
            entity_id,
            read_at,
            created_at
          )
          VALUES ($1,'demo.refund.customer',$2,$3,$4,'refund_request',$5,$6,$7::timestamptz)
        `,
        [
          transaction.customer.makhachhang,
          status === "DaHoan" ? "[Demo] Đã hoàn tiền đặt phòng" : "[Demo] Yêu cầu hoàn tiền bị từ chối",
          status === "DaHoan"
            ? `Booking ${transaction.code} da hoan ${requested.toLocaleString("vi-VN")} d.`
            : `Booking ${transaction.code} chua du dieu kien hoan tien.`,
          "/customer/bookings",
          refundId,
          customerReadAt,
          july(25 + (index % 3), 15)
        ]
      );
    }
  }
}

async function insertExpenses(client: DbClient, rooms: RoomRow[]) {
  for (let i = 0; i < 36; i += 1) {
    const [name, category] = expenseNames[i % expenseNames.length];
    const hotel = rooms[(i * 5) % rooms.length];
    const amount = money(450000 + (i % 9) * 620000 + Math.floor(i / 9) * 350000);
    const status = i % 11 === 0 ? "ChoDuyet" : i % 17 === 0 ? "Huy" : "DaDuyet";

    await client.query(
      `
        INSERT INTO chiphi (
          tenchiphi,
          ngaychi,
          sotien,
          noidung,
          trangthai,
          makhachsan,
          loaichiphi,
          nhacungcap,
          sohoadon,
          phuongthucchi
        )
        VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10)
      `,
      [
        `${name} ${String(i + 1).padStart(2, "0")}`,
        `2026-07-${String(1 + (i % 29)).padStart(2, "0")}`,
        amount,
        `${MARKER} | ${name} tai ${hotel.tenkhachsan}`,
        status,
        hotel.makhachsan,
        category,
        ["Bento Ops", "Sai Gon Supply", "Travel Partner", "Payment Gateway"][i % 4],
        `CP-${CODE_PREFIX}-${String(i + 1).padStart(3, "0")}`,
        ["ChuyenKhoan", "TienMat", "The"][i % 3]
      ]
    );
  }
}

async function main() {
  const result = await withTransaction(async (client: DbClient) => {
    await cleanup(client);

    const customers = await insertCustomers(client);
    const rooms = await loadRooms(client);
    const services = await loadServices(client);

    const transactions = await insertTransactions(client, customers, rooms, services);
    await insertRefundsAndNotifications(client, transactions);
    await insertExpenses(client, rooms);

    return {
      customers: customers.length,
      roomsUsed: new Set(transactions.flatMap((transaction) => transaction.roomIds)).size,
      servicesUsed: services.length,
      transactions: transactions.length,
      paidTransactions: transactions.filter((transaction) => transaction.status === "Paid").length,
      refundRequests: transactions.filter((transaction) => transaction.status === "DaHuy").slice(0, 8).length
    };
  });

  console.log("Seed demo bulk completed:", result);
}

main()
  .catch((error) => {
    console.error("Seed demo bulk failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
