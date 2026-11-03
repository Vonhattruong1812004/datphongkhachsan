import type { SearchBookingInput } from "../../booking/services/booking.service";
import { matchBookingRegion } from "../../../shared/location/booking-regions";

export interface ConversationReply {
  kind: "greeting" | "thanks" | "farewell" | "identity" | "help" | "acknowledgement" | "clarification" | "inspiration" | "pause" | "reset";
  text: string;
  suggestions: string[];
  resetContext?: boolean;
}

function normalize(message: string) {
  return message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d")
    .toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function hasGreetingPrefix(message: string) {
  return /^(hi+|hello+|hey|xin chao|chao ban|chao bento|chao)\b/.test(normalize(message));
}

export function conversationalReply(message: string, filters: Partial<SearchBookingInput> = {}): ConversationReply | null {
  const text = normalize(message);
  const area = filters.dia_diem || filters.hotel_city || "";
  const hasContext = Boolean(area || filters.user_lat || filters.so_khach || filters.ngay_nhan || filters.gia_den);
  const suggestions = ["Tìm khách sạn gần đây", "Gợi ý điểm đến"];
  const nextQuestion = !area && !(filters.user_lat && filters.user_lng)
    ? "Bạn muốn nghỉ ở khu vực nào?"
    : !filters.ngay_nhan || !filters.ngay_tra
      ? "Bạn dự định nhận và trả phòng ngày nào?"
      : !filters.so_khach ? "Chuyến này bạn đi mấy người?"
        : !filters.gia_den && !filters.gia_goi_y ? "Bạn muốn dành khoảng bao nhiêu cho một đêm?"
          : "Bạn muốn xem thêm lựa chọn hay điều chỉnh điều gì?";

  // Match whole conversational turns so greetings never swallow booking instructions.
  if (/^(hi+|hello+|hey|xin chao|chao)( (ban|bento|oi|nhe|nha|a|there))*$/.test(text)
    || /^(alo+|bento oi|ban oi|co ai (o day )?khong|ban co do khong)$/.test(text)) {
    return { kind: "greeting", text: hasContext
      ? "Chào bạn, mình đây! Bạn muốn tiếp tục tìm phòng hay cần mình giúp việc gì khác?"
      : "Chào bạn! Mình là Bento, trợ lý du lịch của bạn. Hôm nay mình có thể giúp gì cho bạn?", suggestions: hasContext ? [] : suggestions };
  }
  if (/^(cam on|thanks|thank you|thank u|thankyou|tks|thank|cam on nhieu)( (ban|bento|nhe|nha|nhieu|rat nhieu|a|lam))*$/.test(text)) {
    return { kind: "thanks", text: "Không có gì đâu! Cần mình giúp thêm điều gì, bạn cứ nhắn nhé.", suggestions: [] };
  }
  if (/^(tam biet|bye+|goodbye|hen gap lai|bai bai)( (ban|bento|nhe|nha|a))*$/.test(text)) {
    return { kind: "farewell", text: "Hẹn gặp lại bạn nhé! Chúc bạn có một chuyến đi thật vui.", suggestions: [] };
  }
  if (/^(ban la ai|ban ten (la )?gi|ten ban la gi|ai day|who are you|ban la (ai|bot|nguoi that) (a|ha|khong)|ban co phai (la )?(ai|bot|nguoi that) khong)$/.test(text)) {
    return { kind: "identity", text: "Mình là Bento, trợ lý AI hỗ trợ du lịch và đặt phòng. Mình có thể giúp bạn tìm phòng, so sánh lựa chọn và giải đáp về đặt phòng. Bạn đang cần gì nè?", suggestions };
  }
  if (/^(ban (co the )?(giup (duoc )?gi|lam (duoc )?(nhung )?gi)|giup (toi|minh)( voi)?|help( me)?|toi can (duoc )?(giup do|ho tro|tu van)|tu van (giup toi|giup minh)|cho (toi|minh) hoi( chut)?|hoi chut)$/.test(text)) {
    return { kind: "help", text: "Mình đây! Bạn cần tìm chỗ nghỉ, chọn điểm đi chơi hay hỏi về đặt phòng?", suggestions };
  }
  if (/^(ban (co )?khoe (khong|ko)|khoe khong|how are you)$/.test(text)) {
    return { kind: "greeting", text: "Cảm ơn bạn đã hỏi thăm! Mình sẵn sàng giúp bạn đây. Hôm nay bạn đang tính đi đâu chơi?", suggestions: [] };
  }
  if (/^((toi|minh) )?(chua biet( di dau| chon gi)?|khong biet di dau|phan van|chua co ke hoach)$/.test(text)) {
    return { kind: "inspiration", text: "Chưa có ý tưởng cũng không sao. Bạn thích nghỉ gần biển hay một nơi yên tĩnh, mát mẻ hơn?", suggestions: ["Mình muốn đi biển", "Gợi ý nơi nghỉ yên tĩnh, mát mẻ"] };
  }
  if (/\b(yen tinh|mat me|nghi mat)\b/.test(text)
    && /\b(goi y|muon|tim|noi nghi|di dau)\b/.test(text)
    && !matchBookingRegion(message)
    && !/\b(o|tai|gan)\b/.test(text)
    && !/\b(phong|khach san|hotel|homestay|resort|villa|view|giuong)\b/.test(text)) {
    return { kind: "inspiration", text: "Bạn có thể cân nhắc Đà Lạt, Sa Pa hoặc Mộc Châu cho chuyến nghỉ mát. Bạn muốn khám phá điểm nào trước? Mình sẽ tìm phòng sau khi bạn chọn khu vực.", suggestions: ["Tìm phòng ở Đà Lạt", "Tìm phòng ở Sa Pa", "Tìm phòng ở Mộc Châu"] };
  }
  if (/^((minh|toi) )?(khong hieu|chua hieu|ban khong hieu|sai roi|khong dung|chua dung( y (toi|minh))?|khong phai( y (toi|minh))?)$/.test(text) || /^\?+$/.test(message.trim())) {
    return { kind: "clarification", text: hasContext
      ? "Có vẻ mình hiểu chưa đúng ý bạn rồi. Bạn muốn đổi điểm nào trong gợi ý vừa rồi?"
      : "Mình hỏi lại cho rõ nhé: bạn muốn tìm phòng hay cần tư vấn cho chuyến đi?", suggestions: hasContext ? ["Tìm phòng rẻ hơn", "Tìm phòng rộng hơn"] : suggestions };
  }
  if (/^(ok(ay)?|oke|oki|duoc|duoc roi|dong y|uh|um|u|ua|vang|da|tot|hay qua|tuyet|tuyet voi)( (nhe|nha|roi|a|ban))*$/.test(text)) {
    return { kind: "acknowledgement", text: `Được nhé! ${hasContext ? nextQuestion : "Bạn muốn mình giúp gì tiếp nè?"}`, suggestions: hasContext ? [] : suggestions };
  }
  if (/^(thoi|thoi nhe|khong can nua|de sau|tam dung|dung lai)$/.test(text)) {
    return { kind: "pause", text: "Được nhé, mình dừng gợi ý ở đây. Khi nào cần, bạn cứ nhắn mình.", suggestions: [] };
  }
  if (/^(bat dau lai|tim chuyen khac|lam lai tu dau|xoa ngu canh|new search)$/.test(text)) {
    return { kind: "reset", text: "Mình cùng lên kế hoạch mới nhé. Bạn muốn đi đâu lần này?", suggestions, resetContext: true };
  }
  return null;
}
