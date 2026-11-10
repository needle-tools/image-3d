export async function createStudioEnvironment(renderer) {
  const [{ PMREMGenerator }, { RoomEnvironment }] = await Promise.all([
    import('three/webgpu'),
    import('three/addons/environments/RoomEnvironment.js'),
  ]);
  const environmentScene = new RoomEnvironment();
  const generator = new PMREMGenerator(renderer);
  const target = generator.fromScene(environmentScene, 0.04, 0.1, 100, { size: 256 });
  generator.dispose();
  const sh = await measureEnvironmentSh(renderer, environmentScene);
  environmentScene.dispose();
  target.texture.name = 'Preview studio IBL';
  return { target, sh };
}

/**
 * Projects a rendered environment into nine RGB coefficients. Nothing short of
 * rendering the scene can answer what radiance arrives from each direction, so
 * this draws it into a small cube and integrates the result.
 *
 * @param {import('three/webgpu').WebGPURenderer} renderer
 * @param {import('three').Scene} environmentScene
 * @returns {Promise<number[]>} 27 coefficients
 */
export async function measureEnvironmentSh(renderer, environmentScene) {
  const [
    { CubeCamera, HalfFloatType, WebGLCubeRenderTarget },
    { LightProbeGenerator },
  ] = await Promise.all([
    import('three'),
    import('three/addons/lights/LightProbeGenerator.js'),
  ]);
  // Nine coefficients cannot resolve more than the lowest frequencies, so the
  // cube only has to be large enough for the integral to converge.
  const target = new WebGLCubeRenderTarget(64, { type: HalfFloatType });
  try {
    new CubeCamera(0.1, 100, target).update(
      /** @type {import('three').WebGLRenderer} */ (/** @type {unknown} */ (renderer)),
      environmentScene,
    );
    const probe = await LightProbeGenerator.fromCubeRenderTarget(
      /** @type {import('three').WebGLRenderer} */ (/** @type {unknown} */ (renderer)),
      target,
    );
    return probe.sh.coefficients.flatMap((coefficient) => coefficient.toArray());
  } finally {
    target.dispose();
  }
}
