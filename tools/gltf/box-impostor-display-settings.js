// @ts-check
/** @typedef {{depthMode:'auto'|'projection'|'depth',raySteps:8|16|32,alphaCutoff:number,interpolation:'none'|'linear'|'smooth',transparency:'auto'|'cutout'|'dithered'|'blended'}} BoxImpostorDisplay */
export const DEFAULT_BOX_IMPOSTOR_DISPLAY = Object.freeze({
  depthMode: /** @type {'auto'|'projection'|'depth'} */ ('auto'),
  raySteps: /** @type {8|16|32} */ (16),
  alphaCutoff: 0.5,
  interpolation: /** @type {'none'|'linear'|'smooth'} */ ('none'),
  transparency: /** @type {'auto'|'cutout'|'dithered'|'blended'} */ ('auto'),
});
/** @param {Partial<BoxImpostorDisplay>} [input] @returns {BoxImpostorDisplay} */
export function normalizeBoxImpostorDisplay(input = {}) {
  const value = { ...DEFAULT_BOX_IMPOSTOR_DISPLAY, ...input };
  if (
    !['auto', 'projection', 'depth'].includes(value.depthMode) ||
    ![8, 16, 32].includes(value.raySteps) ||
    !Number.isFinite(value.alphaCutoff) ||
    value.alphaCutoff <= 0 ||
    value.alphaCutoff >= 1 ||
    !['none', 'linear', 'smooth'].includes(value.interpolation) ||
    !['auto', 'cutout', 'dithered', 'blended'].includes(value.transparency)
  )
    throw new Error('Invalid box impostor display settings.');
  return {
    depthMode: value.depthMode,
    raySteps: value.raySteps,
    alphaCutoff: value.alphaCutoff,
    interpolation: value.interpolation,
    transparency: value.transparency,
  };
}

/** @param {{alphaMode?:'opaque'|'mask'|'blend'}} descriptor @param {BoxImpostorDisplay} settings */
export function boxTransparency(descriptor, settings) {
  return settings.transparency === 'auto'
    ? descriptor.alphaMode === 'blend'
      ? 'blended'
      : 'cutout'
    : settings.transparency;
}

/** Auto only uses planes when every capture is flat within its stored depth bound.
 * Captures without a flatness bound use depth reconstruction.
 * @param {{boxes:{planes?:number[],planeErrors?:number[]}[]}} descriptor @param {BoxImpostorDisplay} settings */
export function boxDepthMode(descriptor, settings) {
  if (settings.depthMode !== 'auto') return settings.depthMode;
  return descriptor.boxes.every(
    (box) =>
      box.planes?.length === 6 &&
      box.planeErrors?.length === 6 &&
      box.planeErrors.every((error) => error <= 2 / 255),
  )
    ? 'projection'
    : 'depth';
}
