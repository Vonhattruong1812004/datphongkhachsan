export function isNearbyRequest(message: string): boolean {
  const text = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase();
  return /\b(gan day|quanh day|gan toi|gan cho toi|gan vi tri (?:cua )?toi|gan vi tri hien tai|gan minh|quanh toi|near me|nearby)\b/.test(text);
}

export function isFreshLocation(location: { capturedAt: number; accuracy: number } | undefined, now = Date.now()): boolean {
  return Boolean(location && location.capturedAt <= now + 10000 && now - location.capturedAt <= 300000 && location.accuracy <= 5000);
}
