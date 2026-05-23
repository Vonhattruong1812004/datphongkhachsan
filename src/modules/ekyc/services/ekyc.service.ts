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
  image_count: number;
  imageCount: number;
  is_document_match: boolean;
  isDocumentMatch: boolean;
  needs_attention: boolean;
  needsAttention: boolean;
  review_priority: "high" | "normal" | "done";
  reviewPriority: "high" | "normal" | "done";
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

    const latest = await this.attachImageAvailability(
      verificationResult.rows[0] ? this.mapVerificationResource(verificationResult.rows[0]) : null
    );
    const persistedCustomerStatus = customer.trangThaiEkyc || "ChuaXacThuc";
    const effectiveCustomerStatus = latest
      ? this.customerStatusFromVerificationResult(latest.result)
      : persistedCustomerStatus;

    return {
      customer: {
        ...customer,
        trangThaiEkyc: effectiveCustomerStatus,
        persisted_ekyc_status: persistedCustomerStatus,
        ekyc_status: effectiveCustomerStatus,
        ekyc_status_label: this.customerStatusLabel(effectiveCustomerStatus)
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
    if (!this.isValidDocumentNumber(input.document_type, documentNumber)) {
      throw new HttpError(422, "Số giấy tờ không hợp lệ.");
    }

    if (!files.front || !files.back || !files.selfie) {
      throw new HttpError(422, "Bắt buộc có ảnh mặt trước, mặt sau và ảnh selfie.");
    }

    const current = await this.getStatusForCustomer(maKhachHang);
    const currentResult = current.verification?.result || "";
    const currentCustomerStatus = current.customer?.ekyc_status || current.customer?.trangThaiEkyc || "";
    if (currentResult === "DangXuLy" || currentCustomerStatus === "DangXuLy") {
      throw new HttpError(409, "Hồ sơ eKYC đang chờ duyệt. Vui lòng chờ Quản lý xử lý trước khi gửi lại.");
    }
    if (currentResult === "ThanhCong" || currentCustomerStatus === "DaXacThuc") {
      throw new HttpError(409, "Hồ sơ eKYC đã được xác thực. Không cần gửi lại hồ sơ.");
    }

    const front = files.front;
    const selfie = files.selfie;
    const back = files.back;
    await this.validateImageFiles([front, back, selfie]);
    const analysis = this.analyzeSubmission({
      document_type: input.document_type,
      document_number: documentNumber
    });
    const initialResult = "DangXuLy";
    const initialNote = [
      "Hồ sơ đã nhận và đang chờ Quản lý duyệt thủ công.",
      analysis.note
    ].join(" ");

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
          initialResult,
          analysis.confidence,
          null,
          initialNote
        ]
      );

      await client.query(
        "UPDATE khachhang SET trangthaiekyc = $2 WHERE makhachhang = $1",
        [maKhachHang, "ChuaXacThuc"]
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
    const params: unknown[] = [];
    const where: string[] = [];

    if (filters.result) {
      params.push(filters.result);
      where.push(`latest.ketquaxacthuc::text = $${params.length}`);
    }

    if (filters.q) {
      params.push(`%${filters.q.toLowerCase()}%`);
      where.push(`
        (
          LOWER(COALESCE(kh.tenkh, '')) LIKE $${params.length}
          OR LOWER(COALESCE(kh.email, '')) LIKE $${params.length}
          OR LOWER(COALESCE(kh.sdt, '')) LIKE $${params.length}
          OR LOWER(COALESCE(kh.cccd, '')) LIKE $${params.length}
          OR LOWER(COALESCE(latest.sogiayto, '')) LIKE $${params.length}
          OR LOWER(COALESCE(latest.loaigiayto::text, '')) LIKE $${params.length}
        )
      `);
    }

    const result = await query<ReviewQueueRow>(
      `
        WITH latest AS (
          SELECT DISTINCT ON (ev.makhachhang)
            ev.*
          FROM ekyc_verification ev
          ORDER BY ev.makhachhang, ev.maekyc DESC
        )
        SELECT
          latest.maekyc AS id,
          kh.makhachhang AS "customerId",
          kh.tenkh AS "customerName",
          kh.email AS "customerEmail",
          kh.sdt AS "customerPhone",
          kh.cccd AS "customerCccd",
          kh.trangthaiekyc AS "customerEkycStatus",
          latest.sogiayto AS "soGiayTo",
          latest.loaigiayto AS "loaiGiayTo",
          latest.ketquaxacthuc AS "ketQuaXacThuc",
          latest.dotincay AS "doTinCay",
          latest.thoigiangui AS "thoiGianGui",
          latest.thoigianxacthuc AS "thoiGianXacThuc",
          latest.ghichu,
          latest.anhmattruoc AS "anhMatTruoc",
          latest.anhmatsau AS "anhMatSau",
          latest.anhselfie AS "anhSelfie"
        FROM latest
        INNER JOIN khachhang kh ON kh.makhachhang = latest.makhachhang
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY
          CASE latest.ketquaxacthuc
            WHEN 'DangXuLy' THEN 1
            WHEN 'ThatBai' THEN 2
            WHEN 'ChuaXacThuc' THEN 3
            ELSE 4
          END,
          latest.maekyc DESC
        LIMIT 500
      `,
      params
    );

    const items = result.rows.map((row) => this.mapReviewQueueItem(row));

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
    const latestId = Number(historyResult.rows[0]?.id || row.id || 0);
    const isLatestForCustomer = latestId === Number(row.id || 0);

    const review = this.mapReviewQueueItem(row);
    const verification = await this.attachImageAvailability(this.mapVerificationResource(row));
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
      latestEkycId: latestId,
      isLatestForCustomer,
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
    if (!detail.isLatestForCustomer) {
      throw new HttpError(409, "Hồ sơ này không phải bản gửi mới nhất của khách. Vui lòng mở hồ sơ mới nhất để duyệt.");
    }

    const cleanReviewNote = String(reviewNote || "").trim();
    if (normalizedDecision === "reject" && cleanReviewNote.length < 10) {
      throw new HttpError(422, "Từ chối hồ sơ cần ghi rõ lý do tối thiểu 10 ký tự.");
    }

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

    const combinedNote = [systemNote, cleanReviewNote].filter(Boolean).join(" ");
    const existingNote = String(detail.verification?.note || "").trim();
    const storedNote = (existingNote ? `${existingNote} | ${combinedNote}` : combinedNote).slice(0, 1000);
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
        `
          UPDATE khachhang
          SET trangthaiekyc = $2,
              cccd = CASE
                WHEN $2::khachhang_trangthaiekyc = 'DaXacThuc' THEN $3
                ELSE cccd
              END
          WHERE makhachhang = $1
        `,
        [detail.customerId, customerStatus, detail.verification?.document_number || detail.customerCccd || null]
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

  private isValidDocumentNumber(documentType: string, documentNumber: string) {
    if (documentType === "CCCD") return /^\d{12}$/.test(documentNumber);
    if (documentType === "CMND") return /^\d{9}$|^\d{12}$/.test(documentNumber);
    if (documentType === "Passport") return /^[A-Za-z0-9]{6,20}$/.test(documentNumber);
    return false;
  }

  private async validateImageFiles(files: Express.Multer.File[]) {
    await Promise.all(files.map(async (file) => {
      const extension = path.extname(file.filename || file.originalname || "").toLowerCase();
      const mime = String(file.mimetype || "");
      const allowed = new Set([".jpg", ".jpeg", ".png", ".webp"]);
      if (!allowed.has(extension) || !["image/jpeg", "image/png", "image/webp"].includes(mime)) {
        throw new HttpError(422, "Ảnh eKYC phải là JPG, PNG hoặc WEBP.");
      }

      const buffer = await fs.readFile(file.path);
      const isJpeg = mime === "image/jpeg" && buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
      const isPng = mime === "image/png"
        && buffer.length > 8
        && buffer[0] === 0x89
        && buffer[1] === 0x50
        && buffer[2] === 0x4e
        && buffer[3] === 0x47;
      const isWebp = mime === "image/webp"
        && buffer.length > 12
        && buffer.toString("ascii", 0, 4) === "RIFF"
        && buffer.toString("ascii", 8, 12) === "WEBP";

      if (!isJpeg && !isPng && !isWebp) {
        throw new HttpError(422, "Ảnh eKYC không đúng định dạng thực tế hoặc có dấu hiệu không hợp lệ.");
      }
    }));
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
        if (item.needs_attention) overview.needsAttention += 1;
        if (item.result === "ThanhCong") overview.approved += 1;
        else if (item.result === "ThatBai") overview.rejected += 1;
        else if (item.result === "DangXuLy") overview.pending += 1;
        else overview.unverified += 1;
        return overview;
      },
      { total: 0, pending: 0, approved: 0, rejected: 0, unverified: 0, needsAttention: 0 }
    );
  }

  private mapReviewQueueItem(row: ReviewQueueRow): ReviewQueueItem {
    const result = row.ketQuaXacThuc || "ChuaXacThuc";
    const customerStatus = row.customerEkycStatus || "ChuaXacThuc";
    const confidence = Number(row.doTinCay || 0);
    const imageCount = [row.anhMatTruoc, row.anhMatSau, row.anhSelfie].filter(Boolean).length;
    const customerCccd = String(row.customerCccd || "").trim();
    const documentNumber = String(row.soGiayTo || "").trim();
    const isDocumentMatch = !customerCccd || !documentNumber || customerCccd === documentNumber;
    const needsAttention = result === "DangXuLy" || result === "ChuaXacThuc" || imageCount < 3 || !isDocumentMatch;
    const reviewPriority = result === "ThanhCong"
      ? "done"
      : needsAttention || result === "ThatBai"
        ? "high"
        : "normal";

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
      tone: this.resultTone(result),
      image_count: imageCount,
      imageCount,
      is_document_match: isDocumentMatch,
      isDocumentMatch,
      needs_attention: needsAttention,
      needsAttention,
      review_priority: reviewPriority,
      reviewPriority
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
        front_file: row.anhMatTruoc || "",
        back_file: row.anhMatSau || "",
        selfie_file: row.anhSelfie || "",
        front_url: this.buildUploadUrl(row.anhMatTruoc || ""),
        back_url: this.buildUploadUrl(row.anhMatSau || ""),
        selfie_url: this.buildUploadUrl(row.anhSelfie || ""),
        front_exists: Boolean(row.anhMatTruoc),
        back_exists: Boolean(row.anhMatSau),
        selfie_exists: Boolean(row.anhSelfie)
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
    if (status === "DangXuLy") return "Khách đang chờ duyệt";
    if (status === "ThatBai") return "Khách xác thực thất bại";
    return "Khách chưa xác thực";
  }

  private customerStatusFromVerificationResult(result: string) {
    if (result === "ThanhCong") return "DaXacThuc";
    if (result === "DangXuLy") return "DangXuLy";
    if (result === "ThatBai") return "ThatBai";
    return "ChuaXacThuc";
  }

  private async attachImageAvailability<T extends {
    images?: {
      front_file?: string;
      back_file?: string;
      selfie_file?: string;
      front_exists?: boolean;
      back_exists?: boolean;
      selfie_exists?: boolean;
    };
  } | null>(verification: T): Promise<T> {
    if (!verification?.images) {
      return verification;
    }

    const checks = [
      ["front_file", "front_exists"],
      ["back_file", "back_exists"],
      ["selfie_file", "selfie_exists"]
    ] as const;

    await Promise.all(checks.map(async ([fileKey, existsKey]) => {
      const fileName = String(verification.images?.[fileKey] || "").trim();
      verification.images![existsKey] = fileName
        ? await this.uploadFileExists(fileName)
        : false;
    }));

    return verification;
  }

  private async uploadFileExists(fileName: string) {
    try {
      await fs.access(path.resolve(process.cwd(), "uploads/ekyc", fileName));
      return true;
    } catch (_error) {
      return false;
    }
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
