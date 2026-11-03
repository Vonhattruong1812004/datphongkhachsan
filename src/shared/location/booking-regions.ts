// Search areas retain familiar/historical names; this is not an administrative registry.
export const bookingRegions = [
  "An Giang", "Ba Ria - Vung Tau", "Bac Giang", "Bac Kan", "Bac Lieu", "Bac Ninh",
  "Ben Tre", "Binh Dinh", "Binh Duong", "Binh Phuoc", "Binh Thuan", "Ca Mau", "Can Tho",
  "Cao Bang", "Da Nang", "Dak Lak", "Dak Nong", "Dien Bien", "Dong Nai", "Dong Thap",
  "Gia Lai", "Ha Giang", "Ha Nam", "Ha Noi", "Ha Tinh", "Hai Duong", "Hai Phong",
  "Hau Giang", "Hoa Binh", "Ho Chi Minh", "Hung Yen", "Khanh Hoa", "Kien Giang",
  "Kon Tum", "Lai Chau", "Lam Dong", "Lang Son", "Lao Cai", "Long An", "Nam Dinh",
  "Nghe An", "Ninh Binh", "Ninh Thuan", "Phu Tho", "Phu Yen", "Quang Binh",
  "Quang Nam", "Quang Ngai", "Quang Ninh", "Quang Tri", "Soc Trang", "Son La",
  "Tay Ninh", "Thai Binh", "Thai Nguyen", "Thanh Hoa", "Hue", "Tien Giang",
  "Tra Vinh", "Tuyen Quang", "Vinh Long", "Vinh Phuc", "Yen Bai"
] as const;

export function normalizeRegion(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function matchBookingRegion(message: string, inventoryCities: string[] = []): string | null {
  const text = ` ${normalizeRegion(message)} `;
  const aliases: Record<string, string[]> = {
    "Ho Chi Minh": ["tp hcm", "tphcm", "hcm", "sai gon"],
    "Ba Ria - Vung Tau": ["vung tau", "ba ria"],
    Hue: ["thua thien hue"]
  };
  const candidates = [...new Set([...bookingRegions, ...inventoryCities])]
    .flatMap(city => [city, ...(aliases[city] || [])].map(alias => ({ city, alias: normalizeRegion(alias) })))
    .sort((a, b) => b.alias.length - a.alias.length);
  const match = candidates.find(item => text.includes(` ${item.alias} `));
  if (!match) return null;
  return inventoryCities.find(city => normalizeRegion(city) === normalizeRegion(match.city)) || match.city;
}
