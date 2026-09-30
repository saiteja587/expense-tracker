// Downscales a photo (taken via the camera-capture file input) to a small
// JPEG data URL before it ever gets stored — a full-resolution phone photo
// is several MB, which would blow past the API body limit and bloat the
// database fast on a free-tier Postgres. Capping the longest edge at 900px
// and using a modest JPEG quality keeps a typical receipt photo well under
// 150KB while still being legible if you zoom in later.
export function fileToCompressedDataUrl(file, { maxDimension = 900, quality = 0.55 } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that photo"));
    reader.onload = () => {
      img.onerror = () => reject(new Error("Couldn't read that photo"));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDimension) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else if (height > maxDimension) {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
