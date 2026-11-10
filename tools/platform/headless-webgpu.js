// @ts-check

// Headless capabilities and global shims for the native conversion tools.

/** @typedef {'browser' | 'deno' | 'node'} GpuRuntime */

/** @returns {GpuRuntime} */
export function gpuRuntime() {
  // Deno first: its Node compatibility layer defines `process` as well.
  if (Reflect.get(globalThis, 'Deno')) return 'deno';
  const process = /** @type {{versions?: {node?: string}} | undefined} */ (
    Reflect.get(globalThis, 'process')
  );
  return process?.versions?.node ? 'node' : 'browser';
}

/** Whether the renderer has to run without a canvas and without OffscreenCanvas. */
export function isHeadlessGpuRuntime() {
  return gpuRuntime() !== 'browser';
}

/** @returns {boolean} */
export function hasWebGpu() {
  return typeof navigator !== 'undefined'
    && Boolean(/** @type {{gpu?: unknown}} */ (navigator).gpu);
}

const NODE_WEBGPU = 'webgpu';

/** @type {Promise<void> | null} */
let nodeInstallation = null;

/**
 * Makes `navigator.gpu` available in the current runtime. Deno ships WebGPU
 * behind a version requirement; Node has none of its own and gets Dawn from the
 * optional `webgpu` package.
 */
export async function ensureNativeWebGpu() {
  const runtime = gpuRuntime();
  if (runtime === 'deno') {
    assertSupportedDeno();
    return;
  }
  if (runtime === 'node') {
    nodeInstallation ??= installNodeWebGpu();
    await nodeInstallation;
    return;
  }
  throw new Error('Native WebGPU is only available in Node and Deno.');
}

async function installNodeWebGpu() {
  if (hasWebGpu()) return;
  let dawn;
  try {
    // Indirect so bundlers do not follow it. This branch only ever runs in
    // Node, and a browser build that pulled in Dawn would be both broken and
    // enormous.
    dawn = await import(/* @vite-ignore */ NODE_WEBGPU);
  } catch (error) {
    throw new Error(
      'Node WebGPU baking requires the optional `webgpu` package (Dawn). '
      + 'Install it with `npm run gpu:install` before studio rendering.',
      { cause: error },
    );
  }
  // three reads GPUBufferUsage, GPUTextureUsage and GPUShaderStage off the
  // global scope rather than off the device.
  Object.assign(globalThis, dawn.globals);
  const gpu = dawn.create([]);
  // An instance with no adapter is worse than none: three quietly falls back to
  // its WebGL backend, which headless has no context for. Check before
  // installing, so a failed attempt leaves any working navigator.gpu alone.
  if (!await gpu.requestAdapter()) throw new Error('No WebGPU adapter is available.');
  const scope = /** @type {Record<string, any>} */ (globalThis);
  if (!scope.navigator) scope.navigator = {};
  Object.defineProperty(scope.navigator, 'gpu', { value: gpu, configurable: true });
}

function assertSupportedDeno() {
  const version = /** @type {any} */ (Reflect.get(globalThis, 'Deno'))?.version?.deno;
  const [major = 0, minor = 0] = String(version ?? '').split('.').map(Number);
  if (major < 2 || (major === 2 && minor < 9)) {
    throw new Error(`Native WebGPU requires Deno 2.9 or newer; this is ${version ?? 'unknown'}.`);
  }
}

/**
 * Three's animation loop reads `self` and requestAnimationFrame off the global
 * scope. Deno has both, Node has neither.
 * @returns {() => void} Restores whatever this call installed.
 */
export function installHeadlessGlobals() {
  const scope = /** @type {Record<string, any>} */ (globalThis);
  /** @type {Array<() => void>} */
  const restores = [];

  if (scope.self === undefined) {
    scope.self = scope;
    restores.push(() => { delete scope.self; });
  }

  if (typeof scope.requestAnimationFrame !== 'function') {
    /** @type {Set<ReturnType<typeof setTimeout>>} */
    const timers = new Set();
    scope.requestAnimationFrame = (/** @type {(time: number) => void} */ callback) => {
      const id = setTimeout(() => {
        timers.delete(id);
        callback(performance.now());
      }, 0);
      timers.add(id);
      return id;
    };
    scope.cancelAnimationFrame = (/** @type {ReturnType<typeof setTimeout>} */ id) => {
      timers.delete(id);
      clearTimeout(id);
    };
    restores.push(() => {
      for (const id of timers) clearTimeout(id);
      delete scope.requestAnimationFrame;
      delete scope.cancelAnimationFrame;
    });
  }

  return () => {
    for (const restore of restores) restore();
  };
}

/**
 * A canvas stand-in for a renderer that only ever draws into render targets.
 * @param {number=} size
 */
export function createHeadlessCanvas(size = 1) {
  return /** @type {HTMLCanvasElement} */ (/** @type {unknown} */ ({
    width: size,
    height: size,
    style: {},
    addEventListener() {},
    removeEventListener() {},
    getContext() {
      throw new Error('Headless WebGPU must not request a canvas context.');
    },
  }));
}
