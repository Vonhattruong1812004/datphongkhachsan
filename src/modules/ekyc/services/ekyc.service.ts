import fs from "node:fs/promises";
import path from "node:path";
import { query, withTransaction } from "../../../config/database";
import { HttpError } from "../../../shared/http/http-error";
import { realtimeHub } from "../../realtime/services/realtime.service";

type ReviewTone = "emerald" | "rose" | "amber" | "slate";

interface ReviewQueueRow {
  id: number;
  customerId: number;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  customerCccd: string | null;
  customerEkycStatus: string | null;
  soGiayTo: string | null;
  loaiGiayTo: string | null;
  ketQuaXacThuc: string | null;
  doTinCay: number | string | null;
  thoiGianGui: string | Date | null;
  thoiGianXacThuc?: string | Date | null;
  ghiChu: string | null;
  anhMatTruoc?: string | null;
  anhMatSau?: string | null;
  anhSelfie?: string | null;
}

interface ReviewQueueItem {
  id: number;
  customer_id: number;
  customerId: number;
  customer_name: string;
  customerName: string;
  customer_email: string;
  customerEmail: string;
  customer_phone: string;
  customerPhone: string;
  customer_cccd: string;
  customerCccd: string;
  customer_status: string;
  customer_status_label: string;
  document_type: string;
  loaiGiayTo: string;
  document_number: string;
  soGiayTo: string;
  result: string;
  ketQuaXacThuc: string;
  result_label: string;
  confidence: number;
  doTinCay: number;
  confidence_label: string;
  submitted_at: string;
  thoiGianGui: string;
  verified_at: string;
  note: string;
  ghiChu: string;
  tone: ReviewTone;
}

export class EkycService {
  async getStatusForCustomer(maKhachHang: number) {
    const customerResult = await query<{
      id: number;
      tenKh: string;
      email: string | null;
      sdt: string | null;
      cccd: string | null;
      trangThaiEkyc: string;
    }>(
      `
        SELECT
          makhachhang AS id,
          tenkh AS "tenKh",
          email,
          sdt,
          cccd,
          trangthaiekyc AS "trangThaiEkyc"
        FROM khachhang
        WHERE makhachhang = $1
        LIMIT 1
      `,
      [maKhachHang]
    );

    const customer = customerResult.rows[0];
    if (!customer) {
      throw new HttpError(404, "Không tìm thấy khách hàng.");
    }

    const verificationResult = await query<ReviewQueueRow>(
      `
        SELECT
          maekyc AS id,
          makhachhang AS "customerId",
          $2::text AS "customerName",
          $3::text AS "customerEmail",
          $4::text AS "customerPhone",
          $5::text AS "customerCccd",
          $6::text AS "customerEkycStatus",
          sogiayto AS "soGiayTo",
          loaigiayto AS "loaiGiayTo",
          ketquaxacthuc AS "ketQuaXacThuc",
          dotincay AS "doTinCay",
          thoigiangui AS "thoiGianGui",
          thoigianxacthuc AS "thoiGianXacThuc",
          ghichu,
          anhmattruoc AS "anhMatTruoc",
          anhmatsau AS "anhMatSau",
          anhselfie AS "anhSelfie"
        FROM ekyc_verification
        WHERE makhachhang = $1
        ORDER BY maekyc DESC
        LIMIT 1
      `,
      [
        maKhachHang,
        customer.tenKh || "",
        customer.email || "",
        customer.sdt || "",
        customer.cccd || "",
        customer.trangThaiEkyc || "ChuaXacThuc"
      ]
    );

    const historyResult = await query<ReviewQueueRow>(
      `
        SELECT
          maekyc AS id,
          makhachhang AS "customerId",
          $2::text AS "customerName",
          $3::text AS "customerEmail",
          $4::text AS "customerPhone",
          $5::text AS "customerCccd",
          $6::text AS "customerEkycStatus",
          sogiayto AS "soGiayTo",
          loaigiayto AS "loaiGiayTo",
          ketquaxacthuc AS "ketQuaXacThuc",
          dotincay AS "doTinCay",
          thoigiangui AS "thoiGianGui",
          thoigianxacthuc AS "thoiGianXacThuc",
          ghichu,
          anhmattruoc AS "anhMatTruoc",
          anhmatsau AS "anhMatSau",
          anhselfie AS "anhSelfie"
        FROM ekyc_verification
        WHERE makhachhang = $1
        ORDER BY maekyc DESC
        LIMIT 6
      `,
      [
        maKhachHang,
        customer.tenKh || "",
        customer.email || "",
        customer.sdt || "",
        customer.cccd || "",
        customer.trangThaiEkyc || "ChuaXacThuc"
      ]
    );

    const latest = verificationResult.rows[0] ? this.mapVerificationResource(verificationResult.rows[0]) : null;

    return {
      customer: {
        ...customer,
        ekyc_status: customer.trangThaiEkyc || "ChuaXacThuc",
        ekyc_status_label: this.customerStatusLabel(customer.trangThaiEkyc || "ChuaXacThuc")
      },
      verification: latest,
      history: historyResult.rows.map((row) => this.mapHistoryResource(row)),
      capabilities: {
        demo_mode: true,
        ai_ready: true,
        mobile_ready: true,
        upload_required: ["front", "back", "selfie"]
      }
    };
  }

  async submitVerification(
    maKhachHang: number,
    input: {
      document_type: string;
      document_number: string;
    },
    files: {
      front?: Express.Multer.File;
      back?: Express.Multer.File;
      selfie?: Express.Multer.File;
    }
  ) {
    if (!input.document_type || !["CCCD", "CMND", "Passport"].includes(input.document_type)) {
      throw new HttpError(422, "Loại giấy tờ không hợp lệ.");
    }

    const documentNumber = input.document_number.trim();
    if (!/^[A-Za-z0-9]{8,20}$/.test(documentNumber)) {
      throw new HttpError(422, "Số giấy tờ không hợp lệ.");
    }

    if (!files.front || !files.back || !files.selfie) {
      throw new HttpError(422, "Bắt buộc có ảnh mặt trước, mặt sau và ảnh selfie.");
    }

    const front = files.front;
    const selfie = files.selfie;
    const back = files.back;
    const analysis = this.analyzeSubmission({
      document_type: input.document_type,
      document_number: documentNumber
    });

    await this.ensureUploadDir();

    await withTransaction(async (client) => {
      await client.query(
        `
          INSERT INTO ekyc_verification (
            makhachhang,
            sogiayto,
            loaigiayto,
            anhmattruoc,
            anhmatsau,
            anhselfie,
            ketquaxacthuc,
            dotincay,
            thoigiangui,
            thoigianxacthuc,
            ghichu
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10)
        `,
        [
          maKhachHang,
          documentNumber,
          input.document_type,
          front.filename,
          back.filename,
          selfie.filename,
          analysis.result,
          analysis.confidence,
          analysis.verifiedAt,
          analysis.note
        ]
      );

      const customerStatus = analysis.result === "ThanhCong"
        ? "DaXacThuc"
        : analysis.result === "ThatBai"
          ? "ThatBai"
          : "ChuaXacThuc";
      await client.query(
        "UPDATE khachhang SET trangthaiekyc = $2 WHERE makhachhang = $1",
        [maKhachHang, customerStatus]
      );
    });

    const payload = await this.getStatusForCustomer(maKhachHang);

    realtimeHub.publish({
      type: "ekyc_submitted",
      scopes: ["admin", "letan", "quanly"],
      data: {
        customerId: maKhachHang,
        status: payload.customer.trangThaiEkyc
      }
    });

    return payload;
  }

  async getReviewQueue(rawFilters: unknown) {
    const filters = this.parseReviewFilters(rawFilters);
    const result = await query<ReviewQueueRow>(
      `
        SELECT
          ev.maekyc AS id,
          kh.makhachhang AS "customerId",
          kh.tenkh AS "customerName",
          kh.email AS "customerEmail",
          kh.sdt AS "customerPhone",
          kh.cccd AS "customerCccd",
          kh.trangthaiekyc AS "customerEkycStatus",
          ev.sogiayto AS "soGiayTo",
          ev.loaigiayto AS "loaiGiayTo",
          ev.ketquaxacthuc AS "ketQuaXacThuc",
          ev.dotincay AS "doTinCay",
          ev.thoigiangui AS "thoiGianGui",
          ev.thoigianxacthuc AS "thoiGianXacThuc",
          ev.ghichu
        FROM ekyc_verification ev
        INNER JOIN khachhang kh ON kh.makhachhang = ev.makhachhang
        ORDER BY ev.maekyc DESC
        LIMIT 200
      `,
      []
    );

    const items: ReviewQueueItem[] = [];
    const seenCustomerIds = new Set<number>();
    const search = filters.q.toLowerCase();

    for (const row of result.rows) {
      if (!row.customerId || seenCustomerIds.has(row.customerId)) {
        continue;
      }

      const item = this.mapReviewQueueItem(row);
      if (filters.result && item.result !== filters.result) {
        continue;
      }

      if (search) {
        const haystack = [
          item.customer_name,
          item.customer_email,
          item.customer_phone,
          item.document_number,
          item.document_type,
          item.customer_cccd
        ].join(" ").toLowerCase();

        if (!haystack.includes(search)) {
          continue;
        }
      }

      seenCustomerIds.add(row.customerId);
      items.push(item);
    }

    return {
      filters,
      items,
      overview: this.buildQueueOverview(items)
    };
  }

  async getReviewDetail(maEkyc: number) {
    const result = await query<ReviewQueueRow>(
      `
        SELECT
          ev.maekyc AS id,
          kh.makhachhang AS "customerId",
          kh.tenkh AS "customerName",
          kh.email AS "customerEmail",
          kh.sdt AS "customerPhone",
          kh.cccd AS "customerCccd",
          ev.sogiayto AS "soGiayTo",
          ev.loaigiayto AS "loaiGiayTo",
          ev.ketquaxacthuc AS "ketQuaXacThuc",
          ev.dotincay AS "doTinCay",
          ev.thoigiangui AS "thoiGianGui",
          ev.thoigianxacthuc AS "thoiGianXacThuc",
          ev.ghichu,
          ev.anhmattruoc AS "anhMatTruoc",
          ev.anhmatsau AS "anhMatSau",
          ev.anhselfie AS "anhSelfie",
          kh.trangthaiekyc AS "customerEkycStatus"
        FROM ekyc_verification ev
        INNER JOIN khachhang kh ON kh.makhachhang = ev.makhachhang
        WHERE ev.maekyc = $1
        LIMIT 1
      `,
      [maEkyc]
    );

    const row = result.rows[0];
    if (!row) {
      throw new HttpError(404, "Không tìm thấy hồ sơ eKYC.");
    }

    const historyResult = await query<ReviewQueueRow>(
      `
        SELECT
          maekyc AS id,
          makhachhang AS "customerId",
          '' AS "customerName",
          NULL AS "customerEmail",
          NULL AS "customerPhone",
          NULL AS "customerCccd",
          NULL AS "customerEkycStatus",
          sogiayto AS "soGiayTo",
          loaigiayto AS "loaiGiayTo",
          ketquaxacthuc AS "ketQuaXacThuc",
          dotincay AS "doTinCay",
          thoigiangui AS "thoiGianGui",
          thoigianxacthuc AS "thoiGianXacThuc",
          ghichu
        FROM ekyc_verification
        WHERE makhachhang = $1
        ORDER BY maekyc DESC
        LIMIT 6
      `,
      [row.customerId]
    );

    const review = this.mapReviewQueueItem(row);
    const verification = this.mapVerificationResource(row);
    const customer = {
      id: row.customerId,
      name: row.customerName || "",
      email: row.customerEmail || "",
      phone: row.customerPhone || "",
      cccd: row.customerCccd || "",
      ekyc_status: row.customerEkycStatus || "ChuaXacThuc",
      ekyc_status_label: this.customerStatusLabel(row.customerEkycStatus || "ChuaXacThuc")
    };

    return {
      customer,
      verification,
      review,
      history: historyResult.rows.map((item) => this.mapHistoryResource(item)),
      id: row.id,
      customerId: row.customerId,
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: customer.phone,
      customerCccd: customer.cccd,
      customerEkycStatus: customer.ekyc_status,
      soGiayTo: verification.document_number,
      loaiGiayTo: verification.document_type,
      ketQuaXacThuc: verification.result,
      doTinCay: verification.confidence,
      thoiGianGui: verification.submitted_at,
      thoiGianXacThuc: verification.verified_at,
      ghiChu: verification.note,
      anhMatTruoc: row.anhMatTruoc,
      anhMatSau: row.anhMatSau,
      anhSelfie: row.anhSelfie
    };
  }

  async reviewVerification(maEkyc: number, decision: string, reviewerName: string, reviewNote: string) {
    if (!Number.isFinite(maEkyc) || maEkyc <= 0) {
      throw new HttpError(422, "Thiếu mã hồ sơ eKYC cần review.");
    }

    const normalizedDecision = String(decision || "").trim().toLowerCase();
    if (!["approve", "reject", "pending"].includes(normalizedDecision)) {
      throw new HttpError(422, "Quyết định review eKYC không hợp lệ.");
    }

    const detail = await this.getReviewDetail(maEkyc);
    const currentConfidence = Number(detail.verification?.confidence || 0);
    const now = new Date();
    const reviewer = String(reviewerName || "").trim() || "staff";

    const result = normalizedDecision === "approve"
      ? "ThanhCong"
      : normalizedDecision === "reject"
        ? "ThatBai"
        : "DangXuLy";

    const customerStatus = result === "ThanhCong"
      ? "DaXacThuc"
      : result === "ThatBai"
        ? "ThatBai"
        : "ChuaXacThuc";

    const confidence = normalizedDecision === "approve"
      ? Math.max(currentConfidence, 0.9)
      : normalizedDecision === "reject"
        ? Math.min(currentConfidence > 0 ? currentConfidence : 0.55, 0.49)
        : Math.max(Math.min(currentConfidence, 0.81), 0.65);

    const systemNote = normalizedDecision === "approve"
      ? `Manual review APPROVED by ${reviewer} at ${this.formatStorageDate(now)}.`
      : normalizedDecision === "reject"
        ? `Manual review REJECTED by ${reviewer} at ${this.formatStorageDate(now)}.`
        : `Manual review moved back to PENDING by ${reviewer} at ${this.formatStorageDate(now)}.`;

    const combinedNote = [systemNote, String(reviewNote || "").trim()].filter(Boolean).join(" ");
    const existingNote = String(detail.verification?.note || "").trim();
    const storedNote = (existingNote ? `${existingNote} | ${combinedNote}` : combinedNote).slice(0, 255);
    const verifiedAt = normalizedDecision === "pending" ? null : now;

    await withTransaction(async (client) => {
      await client.query(
        `
          UPDATE ekyc_verification
          SET ketquaxacthuc = $2,
              dotincay = $3,
              thoigianxacthuc = $4,
              ghichu = $5
          WHERE maekyc = $1
        `,
        [maEkyc, result, confidence, verifiedAt, storedNote]
      );

      await client.query(
        "UPDATE khachhang SET trangthaiekyc = $2 WHERE makhachhang = $1",
        [detail.customerId, customerStatus]
      );
    });

    const updated = await this.getReviewDetail(maEkyc);

    realtimeHub.publish({
      type: "ekyc_reviewed",
      scopes: ["admin", "letan", "quanly"],
      data: {
        ekycId: maEkyc,
        customerId: detail.customerId,
        result
      }
    });

    return updated;
  }

  private async ensureUploadDir() {
    const dir = path.resolve(process.cwd(), "uploads/ekyc");
    await fs.mkdir(dir, { recursive: true });
  }

  private parseReviewFilters(rawFilters: unknown) {
    const filters = rawFilters as Record<string, unknown> | undefined;
    return {
      result: this.normalizeVerificationResult(filters?.result),
      q: String(filters?.q || "").trim()
    };
  }

  private normalizeVerificationResult(value: unknown) {
    const result = String(value || "").trim();
    return ["ChuaXacThuc", "DangXuLy", "ThanhCong", "ThatBai"].includes(result) ? result : "";
  }

  private buildQueueOverview(items: ReviewQueueItem[]) {
    return items.reduce(
      (overview, item) => {
        overview.total += 1;
        if (item.result === "ThanhCong") overview.approved += 1;
        else if (item.result === "ThatBai") overview.rejected += 1;
        else if (item.result === "DangXuLy") overview.pending += 1;
        else overview.unverified += 1;
        return overview;
      },
      { total: 0, pending: 0, approved: 0, rejected: 0, unverified: 0 }
    );
  }

  private mapReviewQueueItem(row: ReviewQueueRow): ReviewQueueItem {
    const result = row.ketQuaXacThuc || "ChuaXacThuc";
    const customerStatus = row.customerEkycStatus || "ChuaXacThuc";
    const confidence = Number(row.doTinCay || 0);

    return {
      id: Number(row.id || 0),
      customer_id: Number(row.customerId || 0),
      customerId: Number(row.customerId || 0),
      customer_name: row.customerName || "",
      customerName: row.customerName || "",
      customer_email: row.customerEmail || "",
      customerEmail: row.customerEmail || "",
      customer_phone: row.customerPhone || "",
      customerPhone: row.customerPhone || "",
      customer_cccd: row.customerCccd || "",
      customerCccd: row.customerCccd || "",
      customer_status: customerStatus,
      customer_status_label: this.customerStatusLabel(customerStatus),
      document_type: row.loaiGiayTo || "",
      loaiGiayTo: row.loaiGiayTo || "",
      document_number: row.soGiayTo || "",
      soGiayTo: row.soGiayTo || "",
      result,
      ketQuaXacThuc: result,
      result_label: this.resultLabel(result),
      confidence,
      doTinCay: confidence,
      confidence_label: this.percentLabel(confidence),
      submitted_at: this.formatDateTime(row.thoiGianGui),
      thoiGianGui: this.formatDateTime(row.thoiGianGui),
      verified_at: this.formatDateTime(row.thoiGianXacThuc || null),
      note: row.ghiChu || "",
      ghiChu: row.ghiChu || "",
      tone: this.resultTone(result)
    };
  }

  private mapHistoryResource(row: ReviewQueueRow) {
    const result = row.ketQuaXacThuc || "ChuaXacThuc";
    const confidence = Number(row.doTinCay || 0);

    return {
      id: Number(row.id || 0),
      document_type: row.loaiGiayTo || "",
      document_number: row.soGiayTo || "",
      result,
      result_label: this.resultLabel(result),
      tone: this.resultTone(result),
      confidence,
      confidence_label: this.percentLabel(confidence),
      submitted_at: this.formatDateTime(row.thoiGianGui),
      verified_at: this.formatDateTime(row.thoiGianXacThuc || null),
      note: row.ghiChu || ""
    };
  }

  private mapVerificationResource(row: ReviewQueueRow) {
    const result = row.ketQuaXacThuc || "ChuaXacThuc";
    const confidence = Number(row.doTinCay || 0);

    return {
      id: Number(row.id || 0),
      maEkyc: Number(row.id || 0),
      document_type: row.loaiGiayTo || "",
      loaiGiayTo: row.loaiGiayTo || "",
      document_number: row.soGiayTo || "",
      soGiayTo: row.soGiayTo || "",
      result,
      ketQuaXacThuc: result,
      result_label: this.resultLabel(result),
      confidence,
      doTinCay: confidence,
      confidence_label: this.percentLabel(confidence),
      submitted_at: this.formatDateTime(row.thoiGianGui),
      thoiGianGui: this.formatDateTime(row.thoiGianGui),
      submitted_at_raw: row.thoiGianGui ? String(row.thoiGianGui) : "",
      verified_at: this.formatDateTime(row.thoiGianXacThuc || null),
      thoiGianXacThuc: this.formatDateTime(row.thoiGianXacThuc || null),
      verified_at_raw: row.thoiGianXacThuc ? String(row.thoiGianXacThuc) : "",
      note: row.ghiChu || "",
      ghiChu: row.ghiChu || "",
      images: {
        front_url: this.buildUploadUrl(row.anhMatTruoc || ""),
        back_url: this.buildUploadUrl(row.anhMatSau || ""),
        selfie_url: this.buildUploadUrl(row.anhSelfie || "")
      },
      anhMatTruoc: row.anhMatTruoc || "",
      anhMatSau: row.anhMatSau || "",
      anhSelfie: row.anhSelfie || ""
    };
  }

  private analyzeSubmission(payload: { document_type: string; document_number: string }) {
    let score = 0.35;

    if (payload.document_number) {
      score += 0.2;
    }

    if (payload.document_type === "CCCD" && /^\d{12}$/.test(payload.document_number)) {
      score += 0.12;
    }

    if (payload.document_type === "CMND" && /^\d{9,12}$/.test(payload.document_number)) {
      score += 0.1;
    }

    if (payload.document_type === "Passport") {
      score += 0.08;
    }

    score += 0.45;
    const confidence = Math.min(0.98, Number(score.toFixed(2)));

    if (confidence >= 0.82) {
      return {
        confidence,
        result: "ThanhCong",
        note: "Bản demo eKYC rule-based xác nhận hồ sơ đạt ngưỡng tin cậy.",
        verifiedAt: new Date()
      };
    }

    if (confidence >= 0.65) {
      return {
        confidence,
        result: "DangXuLy",
        note: "Hồ sơ đã đủ dữ liệu cơ bản và đang chờ lớp xác minh nâng cao.",
        verifiedAt: null
      };
    }

    return {
      confidence,
      result: "ThatBai",
      note: "Hồ sơ chưa đạt ngưỡng tin cậy tối thiểu trong bản demo hiện tại.",
      verifiedAt: new Date()
    };
  }

  private resultLabel(result: string) {
    if (result === "ThanhCong") return "Đã xác thực";
    if (result === "ThatBai") return "Thất bại";
    if (result === "DangXuLy") return "Đang xử lý";
    return "Chưa xác thực";
  }

  private resultTone(result: string): ReviewTone {
    if (result === "ThanhCong") return "emerald";
    if (result === "ThatBai") return "rose";
    if (result === "DangXuLy") return "amber";
    return "slate";
  }

  private customerStatusLabel(status: string) {
    if (status === "DaXacThuc") return "Khách đã xác thực";
    if (status === "ThatBai") return "Khách xác thực thất bại";
    return "Khách chưa xác thực";
  }

  private percentLabel(value: number) {
    return `${Math.round(Number(value || 0) * 100).toLocaleString("vi-VN")}%`;
  }

  private buildUploadUrl(fileName: string) {
    const clean = String(fileName || "").trim();
    return clean ? `/uploads/ekyc/${encodeURIComponent(clean)}` : "";
  }

  private formatDateTime(value: string | Date | null | undefined) {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);

    return new Intl.DateTimeFormat("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  private formatStorageDate(value: Date) {
    const pad = (input: number) => String(input).padStart(2, "0");
    return [
      value.getFullYear(),
      pad(value.getMonth() + 1),
      pad(value.getDate())
    ].join("-") + ` ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
  }
}
