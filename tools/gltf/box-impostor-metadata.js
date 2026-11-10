// @ts-check
import { normalizeBoxImpostorDisplay } from "./box-impostor-display-settings.js";
export const NEEDLE_BOX_IMPOSTOR = "NEEDLE_box_impostor";
export const BOX_OCCUPANCY_RESOLUTION = 8;
export const BOX_OCCUPANCY_WORDS = BOX_OCCUPANCY_RESOLUTION ** 3 / 32;
export { BOX_FACE_AXES } from "./box-impostor-face-axes.js";
/** @typedef {{center:number[],axes:number[][],halfSize:number[],views:number[][],planes?:number[],planeErrors?:number[],depthBounds?:number[],occupancy?:number[]}} ImpostorBox */
/** @typedef {{version:1,depthMode?:'auto'|'projection'|'depth',alphaMode?:'opaque'|'mask'|'blend',interpolation?:'none'|'linear'|'smooth',transparency?:'auto'|'cutout'|'dithered'|'blended',mode:'basic'|'cards'|'fitted',atlasResolution:number,padding:number,raySteps:8|16|32,alphaCutoff:number,boxes:ImpostorBox[]}} BoxImpostorDescriptor */
/** @param {unknown} raw @returns {BoxImpostorDescriptor} */
export function parseBoxImpostorDescriptor(raw) {
  const d = /** @type {BoxImpostorDescriptor} */ (raw);
  const fail = () => {
    throw new Error("Invalid NEEDLE_box_impostor descriptor.");
  };
  const vector = (/** @type {unknown} */ v) =>
    Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  if (
    !d ||
    d.version !== 1 ||
    !["basic", "cards", "fitted"].includes(d.mode) ||
    ![8, 16, 32].includes(d.raySteps) ||
    !Number.isInteger(d.atlasResolution) ||
    d.atlasResolution < 32 ||
    d.atlasResolution > 8192 ||
    !Number.isInteger(d.padding) ||
    d.padding < 1 ||
    d.padding > 16 ||
    !Number.isFinite(d.alphaCutoff) ||
    d.alphaCutoff <= 0 ||
    d.alphaCutoff >= 1 ||
    !Array.isArray(d.boxes) ||
    !d.boxes.length ||
    d.boxes.length > 64
  )
    fail();
  if (
    d.alphaMode !== undefined &&
    !["opaque", "mask", "blend"].includes(d.alphaMode)
  )
    fail();
  if (d.mode === "basic" && d.boxes.length !== 1) fail();
  for (const b of d.boxes) {
    if (
      b.occupancy !== undefined &&
      (!Array.isArray(b.occupancy) ||
        b.occupancy.length !== BOX_OCCUPANCY_WORDS ||
        !b.occupancy.every(
          (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff,
        ))
    )
      fail();
    if (
      b.depthBounds !== undefined &&
      (!Array.isArray(b.depthBounds) ||
        b.depthBounds.length !== 12 ||
        !b.depthBounds.every(
          (v) => Number.isInteger(v) && v >= 0 && v <= 65535,
        ))
    )
      fail();
    if (
      b.planeErrors !== undefined &&
      (!Array.isArray(b.planeErrors) ||
        b.planeErrors.length !== 6 ||
        !b.planeErrors.every((v) => Number.isFinite(v) && v >= 0 && v <= 1))
    )
      fail();
    if (
      b.planes !== undefined &&
      (!Array.isArray(b.planes) ||
        b.planes.length !== 6 ||
        !b.planes.every((v) => Number.isFinite(v) && v >= 0 && v <= 1))
    )
      fail();
    if (
      !vector(b.center) ||
      !vector(b.halfSize) ||
      b.halfSize.some((v) => v <= 0) ||
      !Array.isArray(b.axes) ||
      b.axes.length !== 3 ||
      !b.axes.every(vector) ||
      !Array.isArray(b.views) ||
      b.views.length !== 6
    )
      fail();
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        const dot = b.axes[i].reduce((s, v, k) => s + v * b.axes[j][k], 0);
        if (Math.abs(dot - (i === j ? 1 : 0)) > 1e-4) fail();
      }
    const [x, y, z] = b.axes;
    if (
      (x[1] * y[2] - x[2] * y[1]) * z[0] +
        (x[2] * y[0] - x[0] * y[2]) * z[1] +
        (x[0] * y[1] - x[1] * y[0]) * z[2] <
      0.999
    )
      fail();
    for (const r of b.views)
      if (
        !Array.isArray(r) ||
        r.length !== 4 ||
        !r.every(Number.isInteger) ||
        r[0] < 0 ||
        r[1] < 0 ||
        r[2] <= d.padding * 2 ||
        r[3] <= d.padding * 2 ||
        r[0] + r[2] > d.atlasResolution ||
        r[1] + r[3] > d.atlasResolution
      )
        fail();
  }
  return {
    version: d.version,
    mode: d.mode,
    atlasResolution: d.atlasResolution,
    padding: d.padding,
    boxes: d.boxes,
    ...(d.alphaMode ? { alphaMode: d.alphaMode } : {}),
    ...normalizeBoxImpostorDisplay(d),
  };
}
