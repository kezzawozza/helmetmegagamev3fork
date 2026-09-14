// Shrink in the BROWSER before posting — a rejected oversized Server Action body never reaches useActionState.
// NEVER import @lifeweb/db from here — this is pulled into AvatarField, a "use client" component. Same rule as lib/constants.js.
import { MAX_AVATAR_UPLOAD_EDGE, SHRINK_SKIP_BELOW_BYTES } from "./constants";

const WEBP_QUALITY = 0.9;

function bail(bitmap) {
  bitmap?.close?.();
  return null;
}

export async function shrinkImage(file) {
  if (!file || typeof createImageBitmap !== "function") return null;

  let bitmap;
  try {
    // imageOrientation BAKES EXIF ROTATION INTO THE PIXELS — the webp encode below drops the tag.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null;
  }

  const { width, height } = bitmap;
  if (!width || !height) return bail(bitmap);

  const longest = Math.max(width, height);
  if (longest <= MAX_AVATAR_UPLOAD_EDGE && file.size <= SHRINK_SKIP_BELOW_BYTES) {
    return bail(bitmap);
  }

  const scale = Math.min(1, MAX_AVATAR_UPLOAD_EDGE / longest);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));

  try {
    let blob;
    if (typeof OffscreenCanvas === "function") {
      const canvas = new OffscreenCanvas(w, h);
      canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
      blob = await canvas.convertToBlob({ type: "image/webp", quality: WEBP_QUALITY });
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
      blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/webp", WEBP_QUALITY)
      );
    }
    if (!blob || !blob.size) return bail(bitmap);
    if (blob.size >= file.size) return bail(bitmap);

    const ext = blob.type === "image/webp" ? "webp" : "png";
    const stem = file.name.replace(/\.[^.]+$/, "") || "picture";
    return new File([blob], `${stem}.${ext}`, { type: blob.type });
  } catch {
    return bail(bitmap);
  } finally {
    // Do not wait for the GC — a decoded 50MP bitmap is ~200MB of memory.
    bitmap.close?.();
  }
}
