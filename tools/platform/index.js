// @ts-check

// Headless WebGPU capabilities without renderer or authoring dependencies.

export {
  createHeadlessCanvas,
  ensureNativeWebGpu,
  gpuRuntime,
  hasWebGpu,
  installHeadlessGlobals,
  isHeadlessGpuRuntime,
} from './headless-webgpu.js';

export { installExternalImageUpload } from './external-image-upload.js';
export { installNodeImageBitmap } from './node-image-bitmap.js';

/** @typedef {import('./headless-webgpu.js').GpuRuntime} GpuRuntime */
