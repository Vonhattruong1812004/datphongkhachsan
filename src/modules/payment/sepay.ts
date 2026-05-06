import { formatMoney } from "../../shared/utils/format";

export const SEPAY_API_KEY = process.env.SEPAY_API_KEY || "my-secret-key-123";
export const SEPAY_AUTH_HEADER = `Apikey ${SEPAY_API_KEY}`;
export const SEPAY_HOLD_MINUTES = 10;
export const SEPAY_BANK_CODE = "ICB";
export const SEPAY_BANK_NAME = "VietinBank";
export const SEPAY_ACCOUNT_NO = "108875396650";
export const SEPAY_ACCOUNT_NAME = "VO NHAT TRUONG";
export const SEPAY_VIETINBANK_PREFIX = "SEVQR";

export interface SepayMetadata {
  content: string;
  expiresAt: string;
  depositAmount: number;
  paidAmount: number;
  status: "PENDING" | "PAID" | "EXPIRED";
}

export function buildSepayContent(orderId: number) {
  return `${SEPAY_VIETINBANK_PREFIX} ROOM${Math.max(0, Number(orderId || 0))}`;
}

export function buildSepayMetadata(orderId: number, depositAmount: number, expiresAt: Date) {
  return `[SEPAY content="${buildSepayContent(orderId)}" expires=${expiresAt.toISOString()} deposit=${Math.max(0, Math.round(depositAmount))} paid=0 status=PENDING]`;
}

export function parseSepayMetadata(note: string | null | undefined): SepayMetadata | null {
  const raw = String(note || "");
  const match = raw.match(/\[SEPAY\s+([^\]]+)\]/i);
  if (!match) return null;

  const readField = (name: string) => {
    const fieldMatch = match[1].match(new RegExp(`${name}=("([^"]*)"|'([^']*)'|([^\\s]+))`, "i"));
    return fieldMatch?.[2] || fieldMatch?.[3] || fieldMatch?.[4] || "";
  };

  const content = readField("content");
  const expiresAt = readField("expires");
  const status = String(readField("status") || "PENDING").toUpperCase();

  if (!parseSepayOrderId(content) || !expiresAt) return null;

  return {
    content,
    expiresAt,
    depositAmount: Math.max(0, Number(readField("deposit") || 0)),
    paidAmount: Math.max(0, Number(readField("paid") || 0)),
    status: status === "PAID" ? "PAID" : status === "EXPIRED" ? "EXPIRED" : "PENDING"
  };
}

export function replaceSepayMetadata(note: string | null | undefined, next: SepayMetadata) {
  const raw = String(note || "");
  const marker = `[SEPAY content="${next.content}" expires=${next.expiresAt} deposit=${Math.max(0, Math.round(next.depositAmount))} paid=${Math.max(0, Math.round(next.paidAmount))} status=${next.status}]`;

  if (/\[SEPAY\s+[^\]]+\]/i.test(raw)) {
    return raw.replace(/\[SEPAY\s+[^\]]+\]/i, marker);
  }

  return raw.trim() ? `${raw} | ${marker}` : marker;
}

export function buildSepayPaidNote(amount: number, at = new Date()) {
  return `[SEPAY_PAID amount=${Math.max(0, Math.round(amount))} at=${at.toISOString()}]`;
}

export function buildSepayExpiredNote(at = new Date()) {
  return `[SEPAY_EXPIRED at=${at.toISOString()}]`;
}

export function buildSepayDepositAppliedNote(roomId: number, amount: number, at = new Date()) {
  return `[SEPAY_APPLIED room=${Math.max(0, Number(roomId || 0))} amount=${Math.max(0, Math.round(amount))} at=${at.toISOString()}]`;
}

export function getSepayAppliedAmount(note: string | null | undefined) {
  const raw = String(note || "");
  let total = 0;
  const regex = /\[SEPAY_APPLIED\s+[^\]]*amount=(\d+)[^\]]*\]/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw))) {
    total += Number(match[1] || 0);
  }
  return total;
}

export function appendNote(note: string | null | undefined, addition: string) {
  const raw = String(note || "").trim();
  const clean = String(addition || "").trim();
  if (!clean) return raw;
  return raw ? `${raw} | ${clean}` : clean;
}

export function buildSepayTransferPayload(orderId: number, amount: number) {
  const roundedAmount = Math.max(0, Math.round(Number(amount || 0)));
  const content = buildSepayContent(orderId);
  const queryString = new URLSearchParams({
    amount: String(roundedAmount),
    addInfo: content,
    accountName: SEPAY_ACCOUNT_NAME
  }).toString();

  return {
    provider: "SePay",
    bankCode: SEPAY_BANK_CODE,
    bankName: SEPAY_BANK_NAME,
    accountNo: SEPAY_ACCOUNT_NO,
    accountName: SEPAY_ACCOUNT_NAME,
    amount: roundedAmount,
    amountFormatted: formatMoney(roundedAmount),
    content,
    expiresInMinutes: SEPAY_HOLD_MINUTES,
    qrImageUrl: `https://img.vietqr.io/image/${SEPAY_BANK_CODE}-${SEPAY_ACCOUNT_NO}-compact2.png?${queryString}`,
    instructions: `Chuyen khoan dung noi dung ${content}. VietinBank qua SePay yeu cau noi dung bat dau bang ${SEPAY_VIETINBANK_PREFIX}.`
  };
}

export function parseSepayOrderId(content: string) {
  const match = String(content || "").match(/\bROOM_?(\d+)\b/i);
  return match ? Number(match[1]) : 0;
}
