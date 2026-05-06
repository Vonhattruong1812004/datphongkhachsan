import bcrypt from "bcryptjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { env } from "../../../config/env";
import { pool, query, withTransaction } from "../../../config/database";
import { HttpError } from "../../../shared/http/http-error";

const adminUserSchema = z.object({
  user_id: z.coerce.number().int().optional(),
  ho_ten: z.string().min(2),
  username: z.string().min(5).max(30).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().optional().default("Abc@123"),
  email: z.string().email(),
  sdt: z.string().regex(/^(0|\+84)\d{8,10}$/),
  vai_tro: z.coerce.number().int().min(1).max(7),
  trang_thai: z.enum(["HoatDong", "Khoa", "Ngung"]).default("HoatDong"),
  cccd: z.string().optional().default("")
});

const autoBackupConfigSchema = z.object({
  mode: z.enum(["auto", "manual"]).default("manual")
});

const backupCreateSchema = z.object({
  ten_file: z.string().min(1).regex(/^[A-Za-z0-9_-]+$/),
  hinh_thuc: z.enum(["toan_bo", "hom_nay", "chon_ngay"]).default("toan_bo"),
  thu_muc: z.string().optional().default(""),
  ngay_chon: z.string().optional().default("")
});

const backupRestoreSchema = z.object({
  backup_file: z.string().min(1)
});

type BackupType = "toan_bo" | "hom_nay" | "chon_ngay";
type AutoBackupMode = "auto" | "manual";

interface BackupConfig {
  enabled: boolean;
  mode: AutoBackupMode;
  updated_at?: string;
  updated_by?: string;
  last_backup?: string | null;
}

interface BackupFileSummary {
  name: string;
  size: number;
  modified: number;
  createdAt: string | null;
  fullPath: string;
  backupType: string;
  backupMode: string;
  backupScope: string;
  hotelCount: number;
}

const TABLE_ORDER = [
  "vaitro",
  "khachsan",
  "loaiphong",
  "loaidichvu",
  "dichvu",
  "khachhang",
  "nhanvien",
  "taikhoan",
  "khuyenmai",
  "phong",
  "doan",
  "giaodich",
  "chitietgiaodich",
  "chitietdichvu",
  "phanhoi",
  "chitietphanhoi",
  "ekyc_verification",
  "booking_history",
  "room_status_log",
  "chiphi",
  "hoadon",
  "congnophaithu",
  "kiem_toan_dem",
  "api_request_log",
  "thietbi",
  "audit_log_khachhang"
] as const;

const TABLE_PRIORITY = new Map<string, number>(TABLE_ORDER.map((table, index) => [table, index]));

const REFERENCE_TABLES = new Set([
  "vaitro",
  "khachsan",
  "phong",
  "loaiphong",
  "dichvu",
  "loaidichvu",
  "taikhoan",
  "khachhang",
  "nhanvien",
  "khuyenmai"
]);

const DATE_COLUMN_PRIORITY = [
  "ngaytao",
  "thoigian",
  "ngay",
  "ngaygio",
  "ngaychi",
  "ngaydat",
  "ngaytaohoadon",
  "ngaylap",
  "ngayden",
  "ngaydi"
];

export class AdminService {
  async listUsers() {
    const result = await query<{
      id: number;
      username: string;
      trangThai: string;
      ngayTao: string;
      maVaiTro: number;
      tenVaiTro: string | null;
      maKhachHang: number | null;
      maNhanVien: number | null;
      tenKh: string | null;
      tenNv: string | null;
      emailKh: string | null;
      emailNv: string | null;
      sdtKh: string | null;
      sdtNv: string | null;
    }>(
      `
        SELECT
          tk.matk AS id,
          tk.username,
          tk.trangthai AS "trangThai",
          tk.ngaytao AS "ngayTao",
          tk.mavaitro AS "maVaiTro",
          vr.tenvaitro AS "tenVaiTro",
          tk.makhachhang AS "maKhachHang",
          tk.manhanvien AS "maNhanVien",
          kh.tenkh AS "tenKh",
          nv.tennv AS "tenNv",
          kh.email AS "emailKh",
          nv.email AS "emailNv",
          kh.sdt AS "sdtKh",
          nv.sdt AS "sdtNv"
        FROM taikhoan tk
        LEFT JOIN vaitro vr ON vr.mavaitro = tk.mavaitro
        LEFT JOIN khachhang kh ON kh.makhachhang = tk.makhachhang
        LEFT JOIN nhanvien nv ON nv.manhanvien = tk.manhanvien
        ORDER BY tk.matk DESC
      `
    );

    const roles = await query<{ id: number; tenVaiTro: string }>(
      "SELECT mavaitro AS id, tenvaitro AS \"tenVaiTro\" FROM vaitro ORDER BY mavaitro ASC"
    );

    return {
      users: result.rows,
      roles: roles.rows
    };
  }

  async saveUser(rawInput: unknown) {
    const input = adminUserSchema.parse(rawInput);

    return withTransaction(async (client) => {
      const duplicateUsername = await client.query(
        `
          SELECT matk
          FROM taikhoan
          WHERE lower(username) = lower($1)
            AND ($2::int IS NULL OR matk <> $2)
          LIMIT 1
        `,
        [input.username, input.user_id ?? null]
      ) as { rows: Array<{ matk: number }> };

      if (duplicateUsername.rows[0]) {
        throw new HttpError(409, "Username da ton tai.");
      }

      const isCustomer = input.vai_tro === 7;

      if (input.user_id) {
        const current = await client.query(
          "SELECT * FROM taikhoan WHERE matk = $1 LIMIT 1",
          [input.user_id]
        ) as { rows: Array<{ matk: number; makhachhang: number | null; manhanvien: number | null }> };

        if (!current.rows[0]) {
          throw new HttpError(404, "Khong tim thay tai khoan.");
        }

        await client.query(
          `
            UPDATE taikhoan
            SET username = $2,
                mavaitro = $3,
                trangthai = $4
            WHERE matk = $1
          `,
          [input.user_id, input.username, input.vai_tro, input.trang_thai]
        );

        if (input.password) {
          const passwordHash = await bcrypt.hash(input.password, 10);
          await client.query("UPDATE taikhoan SET password = $2 WHERE matk = $1", [input.user_id, passwordHash]);
        }

        if (current.rows[0].makhachhang) {
          await client.query(
            "UPDATE khachhang SET tenkh = $2, sdt = $3, email = $4, cccd = $5 WHERE makhachhang = $1",
            [current.rows[0].makhachhang, input.ho_ten, input.sdt, input.email, input.cccd || null]
          );
        } else if (current.rows[0].manhanvien) {
          await client.query(
            "UPDATE nhanvien SET tennv = $2, sdt = $3, email = $4, mavaitro = $5 WHERE manhanvien = $1",
            [current.rows[0].manhanvien, input.ho_ten, input.sdt, input.email, input.vai_tro]
          );
        }

        return { id: input.user_id };
      }

      let maKhachHang: number | null = null;
      let maNhanVien: number | null = null;

      if (isCustomer) {
        const customer = await client.query(
          `
            INSERT INTO khachhang (tenkh, sdt, email, cccd, loaikhach, trangthaiekyc)
            VALUES ($1, $2, $3, $4, 'CaNhan', 'ChuaXacThuc')
            RETURNING makhachhang
          `,
          [input.ho_ten, input.sdt, input.email, input.cccd || null]
        ) as { rows: Array<{ makhachhang: number }> };

        maKhachHang = customer.rows[0].makhachhang;
      } else {
        const employee = await client.query(
          `
            INSERT INTO nhanvien (tennv, sdt, email, chucvu, mavaitro)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING manhanvien
          `,
          [input.ho_ten, input.sdt, input.email, "Nhan vien he thong", input.vai_tro]
        ) as { rows: Array<{ manhanvien: number }> };

        maNhanVien = employee.rows[0].manhanvien;
      }

      const passwordHash = await bcrypt.hash(input.password, 10);
      const account = await client.query(
        `
          INSERT INTO taikhoan (username, password, ngaytao, trangthai, mavaitro, makhachhang, manhanvien, motaquyen)
          VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7)
          RETURNING matk
        `,
        [input.username, passwordHash, input.trang_thai, input.vai_tro, maKhachHang, maNhanVien, "Admin tao tai khoan tu Node"]
      ) as { rows: Array<{ matk: number }> };

      if (maKhachHang) {
        await client.query("UPDATE khachhang SET matk = $2 WHERE makhachhang = $1", [maKhachHang, account.rows[0].matk]);
      }

      return { id: account.rows[0].matk };
    });
  }

  async updateUserRole(userId: number, roleId: number) {
    const result = await query<{ id: number }>(
      "UPDATE taikhoan SET mavaitro = $2 WHERE matk = $1 RETURNING matk AS id",
      [userId, roleId]
    );
    if (!result.rows[0]) throw new HttpError(404, "Khong tim thay tai khoan.");
    return result.rows[0];
  }

  async updateUserStatus(userId: number, status: "HoatDong" | "Khoa" | "Ngung") {
    const result = await query<{ id: number }>(
      "UPDATE taikhoan SET trangthai = $2 WHERE matk = $1 RETURNING matk AS id",
      [userId, status]
    );
    if (!result.rows[0]) throw new HttpError(404, "Khong tim thay tai khoan.");
    return result.rows[0];
  }

  async getBackupDashboard(selectedFile?: string) {
    const [backups, hotelSummary] = await Promise.all([
      this.listBackupFiles(),
      this.getHotelBackupSummary()
    ]);

    const selectedBackupInfo = selectedFile
      ? backups.find((item) => item.name === selectedFile) ?? null
      : backups[0] ?? null;

    return {
      backups,
      autoBackupConfig: this.getAutoBackupConfig(),
      hotelSummary,
      selectedBackupInfo
    };
  }

  async createBackup(rawInput: unknown, actor: string) {
    const input = backupCreateSchema.parse(rawInput);

    if (input.hinh_thuc === "chon_ngay") {
      if (!input.ngay_chon || !/^\d{4}-\d{2}-\d{2}$/.test(input.ngay_chon)) {
        throw new HttpError(422, "Ngay backup khong hop le.");
      }
      if (new Date(input.ngay_chon).getTime() > new Date(this.todayDateString()).getTime()) {
        throw new HttpError(422, "Khong the backup du lieu cua ngay tuong lai.");
      }
    }

    const backupDir = this.ensureBackupDir(input.thu_muc);
    this.ensureWritableDirectory(backupDir);

    const timestamp = this.buildTimestamp(new Date());
    const fileName = `${input.ten_file}_${timestamp}.sql`;
    const filePath = path.resolve(backupDir, fileName);
    const relativeName = path.relative(this.ensureBackupDir(), filePath);

    const [sqlDump, hotelSummary, postgresVersion] = await Promise.all([
      this.exportDatabase(input.hinh_thuc, input.ngay_chon || null),
      this.getHotelBackupSummary(),
      this.getPostgresVersion()
    ]);

    const metadata: Record<string, unknown> = {
      version: "2.0",
      type: input.hinh_thuc,
      database: env.PGDATABASE,
      scope: "multi_hotel_system_wide",
      hotel_count: Number(hotelSummary.count ?? 0),
      hotels: hotelSummary.items,
      created_by: actor,
      created_at: this.formatDateTime(new Date()),
      node_version: process.version,
      postgres_version: postgresVersion,
      host: os.hostname()
    };

    if (input.hinh_thuc === "chon_ngay" && input.ngay_chon) {
      metadata.backup_date = input.ngay_chon;
    }

    const header = this.buildBackupHeader(metadata);
    fs.writeFileSync(filePath, `${header}${sqlDump}`, "utf8");

    return {
      fileName,
      relativeName,
      size: fs.statSync(filePath).size,
      createdAt: metadata.created_at,
      backupType: input.hinh_thuc
    };
  }

  async restoreBackup(rawInput: unknown, actor: string) {
    const input = backupRestoreSchema.parse(rawInput);
    const filePath = this.resolveBackupFile(input.backup_file);

    if (path.extname(filePath).toLowerCase() !== ".sql") {
      throw new HttpError(422, "File khong phai backup SQL hop le.");
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).size <= 0) {
      throw new HttpError(404, "File backup khong ton tai hoac dang rong.");
    }

    const content = fs.readFileSync(filePath, "utf8");
    const sqlContent = this.extractSQLFromBackup(content);

    if (!sqlContent.trim()) {
      throw new HttpError(422, "File backup khong chua SQL hop le.");
    }

    const result = await this.importDatabase(sqlContent);
    return {
      ...result,
      restoredBy: actor,
      fileName: input.backup_file
    };
  }

  saveAutoBackupMode(rawInput: unknown, actor: string) {
    const modeValue =
      typeof rawInput === "string"
        ? rawInput
        : (rawInput as Record<string, unknown>).mode ?? (rawInput as Record<string, unknown>).AutoBackup;

    const input = autoBackupConfigSchema.parse({ mode: modeValue });
    const current = this.getAutoBackupConfig();

    const nextConfig: BackupConfig = {
      ...current,
      enabled: input.mode === "auto",
      mode: input.mode,
      updated_at: this.formatDateTime(new Date()),
      updated_by: actor
    };

    this.writeAutoBackupConfig(nextConfig);
    return nextConfig;
  }

  async autoBackup(actor = "system") {
    const config = this.getAutoBackupConfig();
    if (!config.enabled) {
      return { skipped: true, reason: "Auto backup dang tat." };
    }

    const payload = await this.createBackup(
      {
        ten_file: "auto_backup",
        hinh_thuc: "toan_bo"
      },
      actor
    );

    this.writeAutoBackupConfig({
      ...config,
      last_backup: this.formatDateTime(new Date()),
      updated_at: this.formatDateTime(new Date()),
      updated_by: actor
    });

    return {
      skipped: false,
      payload
    };
  }

  async runtimeDiagnostics() {
    const backupDir = this.ensureBackupDir();
    const checks = [
      this.buildPathCheck("public_build", "Build assets", path.resolve(process.cwd(), "public/build"), true),
      this.buildPathCheck("manifest", "PWA manifest", path.resolve(process.cwd(), "public/manifest.webmanifest"), false),
      this.buildPathCheck("service_worker", "Service worker", path.resolve(process.cwd(), "public/sw.js"), false),
      this.buildPathCheck("offline_page", "Offline page", path.resolve(process.cwd(), "public/offline.html"), false),
      this.buildPathCheck("uploads_root", "Uploads root", path.resolve(process.cwd(), "uploads"), true),
      this.buildPathCheck("uploads_ekyc", "eKYC uploads", path.resolve(process.cwd(), "uploads/ekyc"), true),
      this.buildPathCheck("uploads_rooms", "Room uploads", path.resolve(process.cwd(), "uploads/rooms"), true),
      this.buildPathCheck("storage_root", "Storage root", this.ensureStorageRoot(), true),
      this.buildPathCheck("backup_dir", "Backup storage", backupDir, true),
      this.buildPathCheck("backup_config", "Backup config", this.getBackupConfigPath(), false)
    ];

    let dbReady = false;
    try {
      await query("SELECT 1");
      dbReady = true;
    } catch {
      dbReady = false;
    }

    checks.unshift({
      key: "database",
      label: "Database connectivity",
      status: dbReady ? "ready" : "blocked",
      detail: dbReady ? "PostgreSQL dang ket noi tot." : "Khong the ping PostgreSQL."
    });

    const summary = this.summarizeChecks(checks);
    return {
      generatedAt: new Date().toISOString(),
      summary,
      checks,
      next_actions: checks
        .filter((item) => item.status !== "ready")
        .map((item) => `Xu ly ${item.label.toLowerCase()} de runtime on dinh hon.`)
    };
  }

  async systemReadiness() {
    const modules = [
      { key: "auth", name: "Auth", ready: true, detail: "Dang nhap / register / session da san sang." },
      { key: "booking", name: "Booking", ready: true, detail: "Search / preview / create / lookup / invoice da co." },
      { key: "frontdesk", name: "Frontdesk", ready: true, detail: "Da tach rieng direct booking, group registration, check-in, checkout, sua va huy dat phong." },
      { key: "service", name: "Service", ready: true, detail: "Catalog / room feed / inspection da co." },
      { key: "manager", name: "Manager", ready: true, detail: "Customers / promotions / rooms / audit da co." },
      { key: "accounting", name: "Accounting", ready: true, detail: "Dashboard / revenue / expense / debt / report da co." },
      { key: "admin", name: "Admin", ready: true, detail: "Users / role / status / diagnostics / backup / restore da co." },
      { key: "ekyc", name: "eKYC", ready: true, detail: "Customer submit + staff review queue da co." },
      { key: "feedback", name: "Feedback", ready: true, detail: "Create / filter / reply / status da co." },
      { key: "ai", name: "AI layer", ready: true, detail: "Da co concierge / recommendation / analytics / local provider diagnostics." },
      { key: "pwa_mobile", name: "PWA / Mobile", ready: true, detail: "Da co mobile hub, manifest, service worker va offline snapshot." }
    ];

    const summary = {
      ready: modules.filter((item) => item.ready).length,
      partial: modules.filter((item) => !item.ready).length,
      overall_score: Math.round((modules.filter((item) => item.ready).length / modules.length) * 100)
    };

    return {
      generatedAt: new Date().toISOString(),
      summary,
      modules,
      next_actions: modules
        .filter((item) => !item.ready)
        .map((item) => `Hoan thien ${item.name} de tang do phu he thong.`)
    };
  }

  async aiDiagnostics() {
    const [requestStats, dailyTrend, topServices] = await Promise.all([
      query<{
        endpoint: string;
        total: number;
      }>(
        `
          SELECT endpoint, COUNT(*)::int AS total
          FROM api_request_log
          WHERE endpoint IN ('/api/ai/concierge', '/api/booking/recommendations')
          GROUP BY endpoint
          ORDER BY endpoint ASC
        `
      ),
      query<{
        day: string;
        total: number;
      }>(
        `
          SELECT TO_CHAR(requestat AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') AS day,
                 COUNT(*)::int AS total
          FROM api_request_log
          WHERE endpoint IN ('/api/ai/concierge', '/api/booking/recommendations')
            AND requestat >= NOW() - INTERVAL '14 days'
          GROUP BY 1
          ORDER BY 1 ASC
        `
      ),
      query<{
        serviceName: string;
        total: number;
        revenue: number;
      }>(
        `
          SELECT dv.tendichvu AS "serviceName",
                 COUNT(*)::int AS total,
                 COALESCE(SUM(ctdv.thanhtien), 0)::numeric AS revenue
          FROM chitietdichvu ctdv
          INNER JOIN dichvu dv ON dv.madichvu = ctdv.madichvu
          GROUP BY dv.tendichvu
          ORDER BY revenue DESC, total DESC
          LIMIT 5
        `
      )
    ]);

    const conciergeCount = requestStats.rows.find((item) => item.endpoint === "/api/ai/concierge")?.total ?? 0;
    const recommendationCount = requestStats.rows.find((item) => item.endpoint === "/api/booking/recommendations")?.total ?? 0;
    const providerReady = this.pathExists(path.resolve(process.cwd(), "src/modules/ai/services/ai.service.ts"));
    const analyticsReady = this.pathExists(path.resolve(process.cwd(), "src/views/ai/analytics.ejs"));

    return {
      generatedAt: new Date().toISOString(),
      provider: {
        mode: "local",
        provider: "local-heuristic",
        adapter_ready: true,
        summary: "He thong dang chay local heuristic, san sang noi them provider ngoai sau nay."
      },
      summary: {
        ready: providerReady && analyticsReady,
        totalAiRequests: conciergeCount + recommendationCount,
        conciergeCount,
        recommendationCount,
        overall_score: providerReady && analyticsReady ? 100 : 82
      },
      signals: [
        { label: "AI concierge", value: conciergeCount, detail: "So lan goi tro ly tieng Viet." },
        { label: "Recommendations", value: recommendationCount, detail: "So lan goi recommendation booking." },
        { label: "Top service conversions", value: topServices.rows.reduce((sum, item) => sum + Number(item.total || 0), 0), detail: "Tong luot dich vu tu booking/stay." }
      ],
      dailyTrend: dailyTrend.rows,
      topServices: topServices.rows.map((item) => ({
        ...item,
        revenue: Number(item.revenue || 0)
      })),
      next_actions: providerReady && analyticsReady
        ? ["AI local stack da san sang. Neu can, co the noi them provider ngoai va policy guardrails nang cao."]
        : ["Hoan thien them provider adapter va analytics view de bo AI diagnostics tron ven hon."]
    };
  }

  async multiHotelDiagnostics() {
    const checks = await Promise.all([
      this.tableExists("khachsan"),
      this.columnExists("phong", "makhachsan"),
      this.columnExists("nhanvien", "makhachsan"),
      this.columnExists("dichvu", "makhachsan"),
      this.columnExists("chiphi", "makhachsan")
    ]);

    const schema = {
      khachsan_table: checks[0],
      phong_hotel: checks[1],
      nhanvien_hotel: checks[2],
      dichvu_hotel: checks[3],
      chiphi_hotel: checks[4]
    };

    const hotels = await query<{
      id: number;
      tenKhachSan: string;
      tinhThanh: string | null;
      roomCount: number;
    }>(
      `
        SELECT
          ks.makhachsan AS id,
          ks.tenkhachsan AS "tenKhachSan",
          ks.tinhthanh AS "tinhThanh",
          COUNT(p.maphong)::int AS "roomCount"
        FROM khachsan ks
        LEFT JOIN phong p ON p.makhachsan = ks.makhachsan
        GROUP BY ks.makhachsan, ks.tenkhachsan, ks.tinhthanh
        ORDER BY ks.makhachsan ASC
      `
    );

    const modules = [
      {
        name: "Booking / Room inventory",
        status: schema.khachsan_table && schema.phong_hotel ? "ready" : "blocked",
        detail: schema.khachsan_table && schema.phong_hotel
          ? "Danh sach phong, booking online, frontdesk va dashboard live da bam dung co so."
          : "Can bang khachsan va cot phong.makhachsan de multi-hotel inventory day du hon."
      },
      {
        name: "Nhan vien / actor scope",
        status: schema.nhanvien_hotel ? "ready" : "partial",
        detail: schema.nhanvien_hotel
          ? "Co the gan nhan vien vao co so mac dinh de khoa scope."
          : "He thong van chay, nhung chua khoa mac dinh co so cho nhan vien."
      },
      {
        name: "Dich vu theo co so",
        status: schema.dichvu_hotel ? "ready" : "partial",
        detail: schema.dichvu_hotel
          ? "Catalog dich vu co the loc theo tung co so."
          : "Catalog dich vu hien co the dang dung chung toan he thong."
      },
      {
        name: "Ke toan / chi phi theo co so",
        status: schema.chiphi_hotel ? "ready" : "partial",
        detail: schema.chiphi_hotel
          ? "Chi phi va thu chi da san sang de loc theo co so."
          : "Phan chi phi co the van la du lieu dung chung neu bang chiphi chua co makhachsan."
      },
      {
        name: "Admin backup / restore",
        status: "ready",
        detail: "Backup va restore da ghi ro metadata scope toan he thong."
      }
    ];

    const summary = {
      ready: modules.filter((item) => item.status === "ready").length,
      partial: modules.filter((item) => item.status === "partial").length,
      blocked: modules.filter((item) => item.status === "blocked").length
    };

    return {
      generatedAt: new Date().toISOString(),
      schema,
      hotels: hotels.rows,
      modules,
      summary,
      next_actions: [
        !schema.nhanvien_hotel ? "Bo sung nhanvien.makhachsan neu muon khoa scope van hanh theo tung co so." : "",
        !schema.dichvu_hotel ? "Bo sung dichvu.makhachsan neu muon loc catalog dich vu theo co so." : "",
        !schema.chiphi_hotel ? "Bo sung chiphi.makhachsan de bao cao chi phi/lai lo chuan theo co so." : ""
      ].filter(Boolean)
    };
  }

  async mobileReadiness() {
    const tech = {
      manifest: this.pathExists(path.resolve(process.cwd(), "public/manifest.webmanifest")),
      service_worker: this.pathExists(path.resolve(process.cwd(), "public/sw.js")),
      offline_page: this.pathExists(path.resolve(process.cwd(), "public/offline.html")),
      mobile_hub_view: this.pathExists(path.resolve(process.cwd(), "src/views/customer/mobile-hub.ejs")),
      mobile_api_snapshot: this.pathExists(path.resolve(process.cwd(), "src/modules/customer/services/customer.service.ts")),
      ai_concierge_view: this.pathExists(path.resolve(process.cwd(), "src/views/ai/concierge.ejs"))
    };

    const modules = [
      {
        key: "customer_pwa_shell",
        name: "Customer PWA shell",
        status: tech.manifest && tech.service_worker && tech.mobile_hub_view ? "ready" : "partial",
        score: tech.manifest && tech.service_worker && tech.mobile_hub_view ? 100 : 72,
        detail: tech.manifest && tech.service_worker && tech.mobile_hub_view
          ? "Manifest, service worker va mobile hub da san sang nhu mot app shell."
          : "Can du manifest, service worker va mobile hub de PWA shell tron ven hon."
      },
      {
        key: "offline_readiness",
        name: "Offline-friendly experience",
        status: tech.offline_page && tech.mobile_api_snapshot ? "ready" : "partial",
        score: tech.offline_page && tech.mobile_api_snapshot ? 96 : 70,
        detail: tech.offline_page && tech.mobile_api_snapshot
          ? "Da co offline shell va snapshot dong bo cho mobile hub."
          : "Can mo rong offline fallback/snapshot de tranh trang trang khi mat mang."
      },
      {
        key: "ai_mobile_extension",
        name: "AI on mobile",
        status: tech.ai_concierge_view ? "ready" : "partial",
        score: tech.ai_concierge_view ? 92 : 65,
        detail: tech.ai_concierge_view
          ? "AI concierge da san sang de khach tim phong bang tieng Viet tren mobile."
          : "Can noi AI concierge vao hanh trinh mobile ro hon."
      }
    ];

    const totalScore = modules.reduce((sum, item) => sum + item.score, 0);

    return {
      generatedAt: new Date().toISOString(),
      tech,
      modules,
      summary: {
        ready: modules.filter((item) => item.status === "ready").length,
        partial: modules.filter((item) => item.status === "partial").length,
        blocked: modules.filter((item) => item.status === "blocked").length,
        overall_score: modules.length ? Math.round(totalScore / modules.length) : 0
      },
      next_actions: modules
        .filter((item) => item.status !== "ready")
        .map((item) => `Hoan thien ${item.name} de trai nghiem mobile/PWA dong deu hon.`)
    };
  }

  private ensureStorageRoot() {
    const storageRoot = path.resolve(process.cwd(), "storage");
    if (!fs.existsSync(storageRoot)) {
      fs.mkdirSync(storageRoot, { recursive: true });
    }
    return storageRoot;
  }

  private ensureBackupDir(subDir = "") {
    const sanitized = this.sanitizePathSegment(subDir);
    const backupRoot = path.resolve(this.ensureStorageRoot(), "backups");
    const finalDir = sanitized ? path.resolve(backupRoot, sanitized) : backupRoot;

    if (!finalDir.startsWith(backupRoot)) {
      throw new HttpError(422, "Thu muc backup khong hop le.");
    }

    if (!fs.existsSync(finalDir)) {
      fs.mkdirSync(finalDir, { recursive: true });
    }

    return finalDir;
  }

  private getBackupConfigPath() {
    return path.resolve(this.ensureStorageRoot(), "backup_config.json");
  }

  private getAutoBackupConfig(): BackupConfig {
    const configPath = this.getBackupConfigPath();
    if (!fs.existsSync(configPath)) {
      return {
        enabled: false,
        mode: "manual",
        last_backup: null
      };
    }

    try {
      const raw = fs.readFileSync(configPath, "utf8");
      const parsed = JSON.parse(raw) as BackupConfig;
      return {
        enabled: Boolean(parsed.enabled),
        mode: parsed.mode === "auto" ? "auto" : "manual",
        updated_at: parsed.updated_at,
        updated_by: parsed.updated_by,
        last_backup: parsed.last_backup ?? null
      };
    } catch {
      return {
        enabled: false,
        mode: "manual",
        last_backup: null
      };
    }
  }

  private writeAutoBackupConfig(config: BackupConfig) {
    fs.writeFileSync(this.getBackupConfigPath(), JSON.stringify(config, null, 2), "utf8");
  }

  private ensureWritableDirectory(targetPath: string) {
    try {
      fs.accessSync(targetPath, fs.constants.W_OK);
    } catch {
      throw new HttpError(500, `Khong the ghi vao thu muc ${targetPath}.`);
    }
  }

  private async getHotelBackupSummary() {
    try {
      const result = await query<{
        id: number;
        tenKhachSan: string | null;
        thanhPho: string | null;
      }>(
        `
          SELECT
            makhachsan AS id,
            tenkhachsan AS "tenKhachSan",
            thanhpho AS "thanhPho"
          FROM khachsan
          ORDER BY makhachsan ASC
        `
      );

      return {
        count: result.rows.length,
        items: result.rows.map((item) => ({
          id: item.id,
          tenKhachSan: item.tenKhachSan,
          thanhPho: item.thanhPho
        }))
      };
    } catch {
      return { count: 0, items: [] };
    }
  }

  private async getPostgresVersion() {
    try {
      const result = await query<{ version: string }>("SELECT version() AS version");
      return result.rows[0]?.version ?? "Unknown";
    } catch {
      return "Unknown";
    }
  }

  private buildBackupHeader(metadata: Record<string, unknown>) {
    const lines = [
      "-- ABC Resort Node Backup File",
      `-- Created: ${String(metadata.created_at ?? "")}`,
      `-- Database: ${String(metadata.database ?? env.PGDATABASE)}`,
      `-- Type: ${String(metadata.type ?? "toan_bo")}`,
      `-- Scope: ${String(metadata.scope ?? "multi_hotel_system_wide")}`,
      `-- Hotel Count: ${String(metadata.hotel_count ?? 0)}`,
      `-- Created by: ${String(metadata.created_by ?? "system")}`
    ];

    if (metadata.backup_date) {
      lines.push(`-- Backup Date: ${String(metadata.backup_date)}`);
    }

    lines.push("-- ");
    lines.push("-- Metadata:");

    const metadataJson = JSON.stringify(metadata, null, 2) ?? "{}";
    for (const line of metadataJson.split("\n")) {
      lines.push(`-- ${line}`);
    }

    lines.push("-- ", "");
    return `${lines.join("\n")}\n`;
  }

  private async listBackupFiles(): Promise<BackupFileSummary[]> {
    const backupRoot = this.ensureBackupDir();
    const output: BackupFileSummary[] = [];

    const scan = (targetDir: string, relativePrefix = "") => {
      const items = fs.readdirSync(targetDir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.resolve(targetDir, item.name);
        const relativeName = relativePrefix ? path.join(relativePrefix, item.name) : item.name;

        if (item.isDirectory()) {
          scan(fullPath, relativeName);
          continue;
        }

        if (!item.isFile() || path.extname(item.name).toLowerCase() !== ".sql") {
          continue;
        }

        const stat = fs.statSync(fullPath);
        const metadata = this.readBackupMetadata(fullPath);

        output.push({
          name: relativeName,
          size: stat.size,
          modified: metadata.createdAt ? new Date(metadata.createdAt).getTime() : stat.mtimeMs,
          createdAt: metadata.createdAt,
          fullPath,
          backupType: metadata.backupType,
          backupMode: metadata.backupMode,
          backupScope: metadata.backupScope,
          hotelCount: metadata.hotelCount
        });
      }
    };

    scan(backupRoot);

    output.sort((a, b) => b.modified - a.modified);
    return output;
  }

  private readBackupMetadata(filePath: string) {
    const content = fs.readFileSync(filePath, "utf8");
    const head = content.split("\n").slice(0, 80);
    const metadata = {
      createdAt: null as string | null,
      backupType: "",
      backupMode: "",
      backupScope: "",
      hotelCount: 0
    };

    for (const line of head) {
      const trimmed = line.trim();
      const createdMatch = trimmed.match(/^--\s+Created:\s+(.+)$/);
      if (createdMatch) {
        metadata.createdAt = createdMatch[1].trim();
      }

      const typeMatch = trimmed.match(/^--\s+Type:\s+(.+)$/);
      if (typeMatch) {
        metadata.backupType = typeMatch[1].trim();
      }

      const scopeMatch = trimmed.match(/^--\s+Scope:\s+(.+)$/);
      if (scopeMatch) {
        metadata.backupScope = scopeMatch[1].trim();
      }

      const hotelCountMatch = trimmed.match(/^--\s+Hotel Count:\s+(\d+)$/);
      if (hotelCountMatch) {
        metadata.hotelCount = Number(hotelCountMatch[1]);
      }

      const jsonTypeMatch = line.match(/"type"\s*:\s*"([^"]+)"/);
      if (jsonTypeMatch) {
        metadata.backupType = jsonTypeMatch[1];
      }

      const jsonModeMatch = line.match(/"mode"\s*:\s*"([^"]+)"/);
      if (jsonModeMatch) {
        metadata.backupMode = jsonModeMatch[1];
      }

      const jsonCreatedMatch = line.match(/"created_at"\s*:\s*"([^"]+)"/);
      if (jsonCreatedMatch) {
        metadata.createdAt = jsonCreatedMatch[1];
      }

      const jsonScopeMatch = line.match(/"scope"\s*:\s*"([^"]+)"/);
      if (jsonScopeMatch) {
        metadata.backupScope = jsonScopeMatch[1];
      }

      const jsonHotelCountMatch = line.match(/"hotel_count"\s*:\s*(\d+)/);
      if (jsonHotelCountMatch) {
        metadata.hotelCount = Number(jsonHotelCountMatch[1]);
      }
    }

    return metadata;
  }

  private resolveBackupFile(relativeName: string) {
    const backupRoot = this.ensureBackupDir();
    const candidate = path.resolve(backupRoot, relativeName);

    if (!candidate.startsWith(backupRoot)) {
      throw new HttpError(422, "File backup khong hop le.");
    }

    return candidate;
  }

  private extractSQLFromBackup(content: string) {
    const lines = content.split("\n");
    let start = 0;

    for (let index = 0; index < lines.length; index += 1) {
      const trimmed = lines[index].trim();
      if (!trimmed || trimmed.startsWith("--")) {
        continue;
      }
      start = index;
      break;
    }

    return lines.slice(start).join("\n");
  }

  private async importDatabase(sql: string) {
    const client = await pool.connect();
    let executed = 0;

    try {
      const statements = this.splitSqlStatements(sql);
      for (const statement of statements) {
        const trimmed = statement.trim();
        if (!trimmed) {
          continue;
        }

        await client.query(trimmed);
        executed += 1;
      }

      return {
        success: true,
        message: `Da thuc thi ${executed} cau lenh SQL thanh cong.`
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback follow-up errors
      }

      const message = error instanceof Error ? error.message : "Khong the import backup.";
      throw new HttpError(422, `Restore that bai: ${message}`);
    } finally {
      client.release();
    }
  }

  private splitSqlStatements(sql: string) {
    const statements: string[] = [];
    let current = "";
    let inSingleQuote = false;
    let inDoubleQuote = false;

    for (let i = 0; i < sql.length; i += 1) {
      const char = sql[i];
      const previous = i > 0 ? sql[i - 1] : "";
      const next = i + 1 < sql.length ? sql[i + 1] : "";
      current += char;

      if (char === "'" && !inDoubleQuote && previous !== "\\" && inSingleQuote && next === "'") {
        current += next;
        i += 1;
        continue;
      }

      if (char === "\"" && !inSingleQuote && previous !== "\\" && inDoubleQuote && next === "\"") {
        current += next;
        i += 1;
        continue;
      }

      if (char === "'" && !inDoubleQuote && previous !== "\\") {
        inSingleQuote = !inSingleQuote;
      } else if (char === "\"" && !inSingleQuote && previous !== "\\") {
        inDoubleQuote = !inDoubleQuote;
      }

      if (!inSingleQuote && !inDoubleQuote && char === ";") {
        statements.push(current);
        current = "";
      }
    }

    if (current.trim()) {
      statements.push(current);
    }

    return statements;
  }

  private async exportDatabase(type: BackupType, selectedDate: string | null) {
    const tables = await this.listSchemaTables();
    if (!tables.length) {
      throw new HttpError(500, "Khong tim thay bang nao trong schema backup.");
    }

    const targetDate = type === "chon_ngay" ? selectedDate : type === "hom_nay" ? this.todayDateString() : null;
    const tableRefs = tables.map((table) => this.schemaTableRef(table)).join(", ");

    let output = "";
    output += `SET search_path TO ${this.quoteIdent(env.PGSCHEMA)}, public;\n`;
    output += "BEGIN;\n";
    output += `TRUNCATE TABLE ${tableRefs} RESTART IDENTITY CASCADE;\n\n`;

    for (const table of tables) {
      const columns = await this.getTableColumns(table);
      if (!columns.length) {
        continue;
      }

      const filter = await this.buildBackupFilter(table, type, targetDate);
      const sql = `
        SELECT *
        FROM ${this.schemaTableRef(table)}
        ${filter.where}
      `;

      const result = await query<Record<string, unknown>>(sql, filter.params);

      output += `-- Dumping data for table "${table}"\n`;
      if (!result.rows.length) {
        output += `-- No data found for table "${table}"\n\n`;
        continue;
      }

      const columnRefs = columns.map((column) => this.quoteIdent(column)).join(", ");
      const valueLines = result.rows.map((row) => {
        const values = columns.map((column) => this.sqlLiteral(row[column]));
        return `(${values.join(", ")})`;
      });

      output += `INSERT INTO ${this.schemaTableRef(table)} (${columnRefs}) VALUES\n`;
      output += `${valueLines.join(",\n")};\n`;

      const serialColumns = await this.getSerialColumns(table);
      for (const serialColumn of serialColumns) {
        output += `SELECT setval(pg_get_serial_sequence('${this.schemaTableRef(table)}', '${serialColumn}'), COALESCE((SELECT MAX(${this.quoteIdent(serialColumn)}) FROM ${this.schemaTableRef(table)}), 1), COALESCE((SELECT MAX(${this.quoteIdent(serialColumn)}) FROM ${this.schemaTableRef(table)}), 0) > 0);\n`;
      }

      output += "\n";
    }

    output += "COMMIT;\n";
    return output;
  }

  private async listSchemaTables() {
    const result = await query<{ tableName: string }>(
      `
        SELECT table_name AS "tableName"
        FROM information_schema.tables
        WHERE table_schema = $1
          AND table_type = 'BASE TABLE'
        ORDER BY table_name ASC
      `,
      [env.PGSCHEMA]
    );

    return result.rows
      .map((item) => item.tableName)
      .sort((left, right) => {
        const leftRank = TABLE_PRIORITY.get(left) ?? 999;
        const rightRank = TABLE_PRIORITY.get(right) ?? 999;
        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }
        return left.localeCompare(right);
      });
  }

  private async getTableColumns(table: string) {
    const result = await query<{ columnName: string }>(
      `
        SELECT column_name AS "columnName"
        FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = $2
        ORDER BY ordinal_position ASC
      `,
      [env.PGSCHEMA, table]
    );

    return result.rows.map((item) => item.columnName);
  }

  private async getSerialColumns(table: string) {
    const result = await query<{ columnName: string }>(
      `
        SELECT column_name AS "columnName"
        FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = $2
          AND column_default LIKE 'nextval(%'
        ORDER BY ordinal_position ASC
      `,
      [env.PGSCHEMA, table]
    );

    return result.rows.map((item) => item.columnName);
  }

  private async buildBackupFilter(table: string, type: BackupType, targetDate: string | null) {
    if (type === "toan_bo" || !targetDate || REFERENCE_TABLES.has(table.toLowerCase())) {
      return { where: "", params: [] as unknown[] };
    }

    const dateColumnsResult = await query<{ columnName: string }>(
      `
        SELECT column_name AS "columnName"
        FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = $2
          AND data_type IN ('date', 'timestamp without time zone', 'timestamp with time zone')
        ORDER BY ordinal_position ASC
      `,
      [env.PGSCHEMA, table]
    );

    const dateColumns = dateColumnsResult.rows.map((item) => item.columnName);
    if (!dateColumns.length) {
      return { where: "", params: [] as unknown[] };
    }

    const chosenColumn =
      DATE_COLUMN_PRIORITY.find((candidate) => dateColumns.includes(candidate)) ??
      dateColumns[0];

    return {
      where: `WHERE DATE(${this.quoteIdent(chosenColumn)}) = $1`,
      params: [targetDate]
    };
  }

  private schemaTableRef(table: string) {
    return `${this.quoteIdent(env.PGSCHEMA)}.${this.quoteIdent(table)}`;
  }

  private quoteIdent(identifier: string) {
    return `"${identifier.replace(/"/g, "\"\"")}"`;
  }

  private sqlLiteral(value: unknown): string {
    if (value === null || value === undefined) {
      return "NULL";
    }

    if (typeof value === "number") {
      return Number.isFinite(value) ? String(value) : "NULL";
    }

    if (typeof value === "bigint") {
      return value.toString();
    }

    if (typeof value === "boolean") {
      return value ? "TRUE" : "FALSE";
    }

    if (value instanceof Date) {
      return `'${value.toISOString().replace(/'/g, "''")}'`;
    }

    if (Buffer.isBuffer(value)) {
      return `decode('${value.toString("hex")}', 'hex')`;
    }

    if (typeof value === "object") {
      return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
    }

    return `'${String(value).replace(/'/g, "''")}'`;
  }

  private sanitizePathSegment(input: string) {
    return input
      .split(/[\\/]+/)
      .map((segment) => segment.replace(/[^A-Za-z0-9_-]/g, ""))
      .filter(Boolean)
      .join(path.sep);
  }

  private buildPathCheck(key: string, label: string, targetPath: string, directory: boolean) {
    const exists = fs.existsSync(targetPath);
    const writable = exists ? this.isWritable(targetPath) : false;

    return {
      key,
      label,
      status: exists ? "ready" : "blocked",
      detail: exists
        ? `${directory ? "Thu muc" : "File"} ton tai${directory ? (writable ? " va co the ghi." : ".") : "."}`
        : `${directory ? "Thu muc" : "File"} chua ton tai: ${targetPath}`
    };
  }

  private isWritable(targetPath: string) {
    try {
      fs.accessSync(targetPath, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  private summarizeChecks(checks: Array<{ status: string }>) {
    const ready = checks.filter((item) => item.status === "ready").length;
    const blocked = checks.filter((item) => item.status === "blocked").length;
    return {
      ready,
      blocked,
      overall_score: Math.round((ready / Math.max(1, checks.length)) * 100)
    };
  }

  private pathExists(targetPath: string) {
    return fs.existsSync(targetPath);
  }

  private async tableExists(tableName: string) {
    const result = await query<{ count: number }>(
      `
        SELECT COUNT(*)::int AS count
        FROM information_schema.tables
        WHERE table_schema = $1
          AND table_name = $2
      `,
      [env.PGSCHEMA, tableName]
    );

    return Number(result.rows[0]?.count || 0) > 0;
  }

  private async columnExists(tableName: string, columnName: string) {
    const result = await query<{ count: number }>(
      `
        SELECT COUNT(*)::int AS count
        FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = $2
          AND column_name = $3
      `,
      [env.PGSCHEMA, tableName, columnName]
    );

    return Number(result.rows[0]?.count || 0) > 0;
  }

  private todayDateString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = `${now.getMonth() + 1}`.padStart(2, "0");
    const date = `${now.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${date}`;
  }

  private buildTimestamp(date: Date) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    const hours = `${date.getHours()}`.padStart(2, "0");
    const minutes = `${date.getMinutes()}`.padStart(2, "0");
    const seconds = `${date.getSeconds()}`.padStart(2, "0");
    return `${year}${month}${day}_${hours}${minutes}${seconds}`;
  }

  private formatDateTime(date: Date) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    const hours = `${date.getHours()}`.padStart(2, "0");
    const minutes = `${date.getMinutes()}`.padStart(2, "0");
    const seconds = `${date.getSeconds()}`.padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }
}
