export function travelQuestion(message: string): "packing" | "itinerary" | "change_destination" | "attractions" | null {
  const text = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase();
  if (/\b(noi khac|diem den khac|khu vuc khac|cho khac|khong (muon )?di|bo qua (cho|diem)|doi diem den)\b/.test(text)) return "change_destination";
  if (/\b(mang (theo )?gi|chuan bi gi|hanh ly|can tranh|tranh gi|luu y gi)\b/.test(text)) return "packing";
  if (/\b(lich trinh|hanh trinh)\b/.test(text) && !/\b(dat tour|mua tour|gia tour)\b/.test(text)) return "itinerary";
  if (/\b(diem noi bat|diem tham quan|dia diem tham quan|co gi (dep|hay|choi)|choi gi|diem du lich|thang canh)\b/.test(text)
    && !/\b(phong|khach san|hotel|homestay|resort|villa|dat tour|gia tour)\b/.test(text)) return "attractions";
  return null;
}
