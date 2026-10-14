export const QUOTE_PHOTO_MAX_BYTES = 1024 * 1024;
export const QUOTE_PHOTO_MAX_COUNT = 3;
export const QUOTE_MULTIPART_MAX_BYTES =
  QUOTE_PHOTO_MAX_BYTES * QUOTE_PHOTO_MAX_COUNT + 65536;
export const QUOTE_PHOTO_BUCKET = "property-maintenance-quotes";
export function quotePhotoKind(bytes: Uint8Array) {
  if (
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return "jpeg";
  if (
    bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)
  )
    return "png";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
    return "webp";
  return null;
}
