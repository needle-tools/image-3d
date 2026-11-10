// @ts-check

/**
 * Three's GLTFLoader decodes textures with ImageBitmapLoader when
 * createImageBitmap exists, and falls back to a DOM Image when it does not.
 * Node has neither, so the bitmap is the smaller thing to supply.
 *
 * The returned object is not a real ImageBitmap — nothing in Node can be — but
 * three only reads width/height off it, and the WebGPU upload bridge in
 * external-image-upload.js reads `data`.
 *
 * @param {(bytes: Uint8Array) => Promise<{width: number, height: number, data: Uint8Array}>} decode
 * @returns {() => void} Restores whatever this call installed.
 */
export function installNodeImageBitmap(decode) {
  const scope = /** @type {Record<string, any>} */ (globalThis);
  if (typeof scope.createImageBitmap === 'function') return () => {};

  scope.createImageBitmap = async (/** @type {unknown} */ source) => {
    const bytes = await toBytes(source);
    const { width, height, data } = await decode(bytes);
    return { width, height, data, close() {} };
  };

  return () => { delete scope.createImageBitmap; };
}

/** @param {unknown} source */
async function toBytes(source) {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  const blob = /** @type {{arrayBuffer?: () => Promise<ArrayBuffer>}} */ (source);
  if (typeof blob?.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  throw new TypeError('Node image decoding needs a Blob, ArrayBuffer or Uint8Array source.');
}
