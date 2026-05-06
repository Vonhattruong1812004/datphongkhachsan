import dayjs from "dayjs";

export function formatMoney(value: number | string | null | undefined) {
  const numeric = Number(value || 0);
  return `${numeric.toLocaleString("vi-VN")} đ`;
}

export function formatDate(value: string | Date | null | undefined, template = "DD/MM/YYYY") {
  if (!value) {
    return "";
  }

  return dayjs(value).format(template);
}

export function nightsBetween(checkin: string, checkout: string) {
  const from = dayjs(checkin);
  const to = dayjs(checkout);
  return Math.max(1, to.startOf("day").diff(from.startOf("day"), "day"));
}
