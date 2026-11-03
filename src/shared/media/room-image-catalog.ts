export interface RoomSampleImage {
  file: string;
  downloadUrl: string;
  sourceUrl: string;
  licenseUrl: string;
  roomTypes: string[];
}

function pexels(id: number, slug: string, roomTypes: string[]): RoomSampleImage {
  return {
    file: `sample-pexels-${id}.jpg`,
    downloadUrl: `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=1280`,
    sourceUrl: `https://www.pexels.com/photo/${slug}-${id}/`,
    licenseUrl: "https://www.pexels.com/license/",
    roomTypes
  };
}

function unsplash(id: string, photo: string, roomTypes: string[]): RoomSampleImage {
  return {
    file: `sample-unsplash-${id}.jpg`,
    downloadUrl: `https://images.unsplash.com/${photo}?fm=jpg&fit=max&w=1280&q=82`,
    sourceUrl: `https://unsplash.com/photos/${id}`,
    licenseUrl: "https://unsplash.com/license",
    roomTypes
  };
}

// Licensed reference photographs, not verified photographs of Bento properties.
export const roomImageCatalog: RoomSampleImage[] = [
  pexels(12805883, "beds-inside-a-hotel-room", ["Standard", "Superior", "Family"]),
  pexels(18864959, "beds-in-hotel-room", ["Deluxe", "Suite", "Family"]),
  pexels(8089081, "bed-in-hotel-room", ["Standard", "Superior", "Deluxe", "Studio"]),
  pexels(14613201, "double-bedroom-in-a-hotel", ["Standard", "Superior", "Family"]),
  pexels(18470966, "a-hotel-room-with-two-beds", ["Superior", "Deluxe", "Family"]),
  pexels(35430054, "cozy-bedroom-interior-with-wooden-furniture", ["Standard", "Superior", "Homestay"]),
  pexels(6585602, "cozy-bedroom-with-comfortable-bed-and-wooden-furniture", ["Standard", "Superior", "Homestay", "Studio"]),
  pexels(35430059, "cozy-bedroom-with-wooden-furniture-and-natural-light", ["Superior", "Homestay", "Villa"]),
  pexels(37276162, "elegant-bedroom-with-wooden-bed-and-soft-lighting", ["Deluxe", "Suite", "Villa"]),
  pexels(35430062, "cozy-bedroom-with-wooden-furniture-and-ceiling-fan", ["Standard", "Homestay", "Villa"]),
  pexels(34166566, "modern-minimalist-bedroom-with-cozy-bedding", ["Superior", "Deluxe", "Studio"]),
  pexels(5649731, "beautiful-bedroom-in-a-villa", ["Suite", "VIP", "Villa"]),
  pexels(18285947, "elegant-hotel-bedroom", ["Deluxe", "Suite", "VIP", "Penthouse"]),
  pexels(8082564, "interior-of-a-hotel-room", ["Superior", "Deluxe", "Suite"]),
  pexels(17948132, "interior-of-an-elegant-hotel-room", ["Deluxe", "Suite", "VIP", "Penthouse"]),
  pexels(20975731, "bedroom-with-bathtub-and-double-bed-in-the-resort", ["Suite", "VIP", "Villa"]),
  pexels(18801087, "double-bed-reflecting-in-mirror-in-hotel-room", ["Deluxe", "Suite", "Penthouse"]),
  unsplash("AMDFVRlTlAU", "photo-1718942899965-4fc10607d805", ["Deluxe", "Suite", "VIP"]),
  unsplash("uXYHodDhiG4", "photo-1779870458288-95fd59cd2c5b", ["Superior", "Deluxe", "Family"]),
  unsplash("oqXapAIctAg", "photo-1594560913036-d15f23f8a91c", ["Standard", "Superior", "Studio"])
];
