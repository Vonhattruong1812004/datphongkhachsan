import { z } from "zod";

export const dialogueContextSchema = z.object({
  topic: z.enum(["booking", "destination", "packing", "itinerary", "clarification", "other"]),
  last_room_id: z.number().int().positive().nullable().optional(),
  excluded_room_ids: z.array(z.number().int().positive()).max(50).default([])
});
export type DialogueContext = z.infer<typeof dialogueContextSchema>;

export function alternativeRequest(message: string, context?: DialogueContext): "room" | "destination" | "clarify" | null {
  const text = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d")
    .toLowerCase().replace(/[.!?,]/g, " ").replace(/\s+/g, " ").trim();
  if (/\b(phong|khach san|homestay|resort) khac\b/.test(text)) return "room";
  if (/\b(diem den|dia diem|noi|khu vuc|cho) khac\b/.test(text) || text === "doi diem den") return "destination";
  // Only elliptical turns use the previous topic; explicit new requests keep their meaning.
  if (!/^(khac|khac nua|cai khac|doi cai khac|thu cai khac|lua chon khac|phuong an khac|goi y khac|con gi khac|con cai nao khac)( (di|nhe|nha|nao|khong|ko))?$/.test(text)) return null;
  if (context?.topic === "booking") return "room";
  if (context?.topic === "destination") return "destination";
  return "clarify";
}

export function excludedRoomIds(context?: DialogueContext) {
  return [...new Set([...(context?.excluded_room_ids || []), ...(context?.last_room_id ? [context.last_room_id] : [])])].slice(0, 50);
}
