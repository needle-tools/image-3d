// @ts-check

const DENO_BITMAP_DATA = Symbol.for('Deno_bitmapData');

/** @typedef {{source: unknown, origin?: {x?: number, y?: number}, flipY?: boolean}} ExternalImageSource */
/** @typedef {{texture: unknown, mipLevel?: number, origin?: {x?: number, y?: number, z?: number}, aspect?: string, premultipliedAlpha?: boolean}} ExternalImageDestination */
/** @typedef {number[] | {width?: number, height?: number, depthOrArrayLayers?: number}} TextureExtent */
/** @typedef {{
 * writeTexture: (
 *   destination: {texture: unknown, mipLevel?: number, origin?: {x?: number, y?: number, z?: number}, aspect?: string},
 *   data: Uint8Array,
 *   layout: {bytesPerRow: number, rowsPerImage: number},
 *   size: {width: number, height: number, depthOrArrayLayers: number},
 * ) => void,
 * copyExternalImageToTexture?: (source: ExternalImageSource, destination: ExternalImageDestination, size: TextureExtent) => void,
 * }} DenoGpuQueue */
/** @typedef {{queue: DenoGpuQueue}} DenoGpuDevice */

/**
 * Bridges Three's texture upload to queue.writeTexture for sources that are
 * plain pixels rather than a real ImageBitmap.
 *
 * Both headless runtimes need this, for different reasons. Deno exposes decoded
 * ImageBitmap pixels through a bitmap-data hook but has no
 * copyExternalImageToTexture at all. Dawn has the method, and rejects the
 * {width, height, data} objects a Node image decoder produces — so the native
 * implementation is kept and delegated to for anything with no readable pixels.
 *
 * @param {DenoGpuDevice} device
 */
export function installExternalImageUpload(device) {
  const queue = device.queue;
  const native = typeof queue.copyExternalImageToTexture === 'function'
    ? queue.copyExternalImageToTexture.bind(queue)
    : null;

  Object.defineProperty(queue, 'copyExternalImageToTexture', {
    configurable: true,
    value: /** @type {NonNullable<DenoGpuQueue['copyExternalImageToTexture']>} */ ((source, destination, copySize) => {
      const image = /** @type {Record<PropertyKey, unknown> & {width?: number, height?: number, data?: Uint8Array | Uint8ClampedArray}} */ (source.source);
      const width = extentValue(copySize, 'width', 0);
      const height = extentValue(copySize, 'height', 1);
      const sourceWidth = Number(image.width ?? width);
      const sourceHeight = Number(image.height ?? height);
      const sourceX = Number(source.origin?.x ?? 0);
      const sourceY = Number(source.origin?.y ?? 0);
      const bitmapData = getExternalImagePixels(image);
      if (!bitmapData) {
        if (native) return native(source, destination, copySize);
        throw new TypeError('Headless WebGPU texture upload requires an ImageBitmap or RGBA ImageData source.');
      }
      if (
        width <= 0 || height <= 0
        || sourceX < 0 || sourceY < 0
        || sourceX + width > sourceWidth || sourceY + height > sourceHeight
      ) {
        throw new RangeError('External image upload exceeds the source bitmap bounds.');
      }

      const needsCopy = sourceX !== 0 || sourceY !== 0
        || width !== sourceWidth || height !== sourceHeight
        || source.flipY === true || destination.premultipliedAlpha === true;
      const pixels = needsCopy
        ? preparePixels(
          bitmapData,
          sourceWidth,
          sourceHeight,
          sourceX,
          sourceY,
          width,
          height,
          source.flipY === true,
          destination.premultipliedAlpha === true,
        )
        : bitmapData;
      queue.writeTexture(
        {
          texture: destination.texture,
          mipLevel: destination.mipLevel ?? 0,
          origin: destination.origin,
          aspect: destination.aspect,
        },
        pixels,
        { bytesPerRow: width * 4, rowsPerImage: height },
        { width, height, depthOrArrayLayers: extentValue(copySize, 'depthOrArrayLayers', 1) },
      );
    }),
  });
}

/**
 * @param {TextureExtent} extent
 * @param {'width' | 'height' | 'depthOrArrayLayers'} property
 * @param {number} index
 */
function extentValue(extent, property, index) {
  if (Array.isArray(extent)) return Number(extent[index] ?? 1);
  return Number(/** @type {{width?: number, height?: number, depthOrArrayLayers?: number}} */ (extent)[property] ?? 1);
}

/**
 * @param {Uint8Array} source
 * @param {number} sourceWidth
 * @param {number} sourceHeight
 * @param {number} sourceX
 * @param {number} sourceY
 * @param {number} width
 * @param {number} height
 * @param {boolean} flipY
 * @param {boolean} premultiplyAlpha
 */
function preparePixels(
  source,
  sourceWidth,
  sourceHeight,
  sourceX,
  sourceY,
  width,
  height,
  flipY,
  premultiplyAlpha,
) {
  const output = new Uint8Array(width * height * 4);
  const sourceRowBytes = sourceWidth * 4;
  const outputRowBytes = width * 4;
  for (let row = 0; row < height; row++) {
    const sampledRow = flipY ? sourceY + height - 1 - row : sourceY + row;
    const sourceOffset = sampledRow * sourceRowBytes + sourceX * 4;
    output.set(source.subarray(sourceOffset, sourceOffset + outputRowBytes), row * outputRowBytes);
  }
  if (premultiplyAlpha) {
    for (let index = 0; index < output.length; index += 4) {
      const alpha = output[index + 3] / 255;
      output[index] = Math.round(output[index] * alpha);
      output[index + 1] = Math.round(output[index + 1] * alpha);
      output[index + 2] = Math.round(output[index + 2] * alpha);
    }
  }
  return output;
}

/**
 * Deno's bitmap hook exposes decoded image channels, including RGB JPEGs.
 * Normalize them once for both CPU baking and headless texture uploads.
 * @param {{width?: number, height?: number} & Record<PropertyKey, unknown>} image
 * @returns {Uint8Array | null}
 */
export function getExternalImagePixels(image) {
  const getter = image[DENO_BITMAP_DATA];
  const decoded = typeof getter === 'function' ? Reflect.apply(getter, image, []) : image.data;
  if (!(decoded instanceof Uint8Array) && !(decoded instanceof Uint8ClampedArray)) return null;
  const bytes = new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength);
  // Node decoders already promise RGBA; only native bitmap channels need normalization.
  if (typeof getter !== 'function') return bytes;
  const count = Number(image.width) * Number(image.height);
  const channels = bytes.length / count;
  if (!Number.isInteger(count) || count <= 0 || ![1, 2, 3, 4].includes(channels)) throw new Error('Unexpected Deno bitmap pixel layout.');
  if (channels === 4) return bytes;
  const rgba = new Uint8Array(count * 4);
  for (let pixel = 0; pixel < count; pixel++) {
    const source = pixel * channels, target = pixel * 4;
    rgba[target] = bytes[source];
    rgba[target + 1] = channels < 3 ? bytes[source] : bytes[source + 1];
    rgba[target + 2] = channels < 3 ? bytes[source] : bytes[source + 2];
    rgba[target + 3] = channels === 2 ? bytes[source + 1] : 255;
  }
  return rgba;
}
