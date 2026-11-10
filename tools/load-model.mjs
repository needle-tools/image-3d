import{readFile}from'node:fs/promises';import{createRequire}from'node:module';import{fileURLToPath}from'node:url';
import{NodeIO}from'@gltf-transform/core';import{ALL_EXTENSIONS}from'@gltf-transform/extensions';import draco from'draco3d';import{MeshoptDecoder}from'meshoptimizer';import{GLTFLoader}from'three/addons/loaders/GLTFLoader.js';
import{readFixture}from'./input.mjs';import{installHeadlessGlobals}from'./platform/index.js';import{installNodeImageBitmap}from'./platform/node-image-bitmap.js';import{decodeImageNode,encodePngNode}from'./images.mjs';
/** @param {string|URL} path @param {string} [sha256] */
export async function loadSourceModel(path, sha256) {
  const restoreGlobals = installHeadlessGlobals();
  const restoreImages = installNodeImageBitmap(decodeImageNode);
  try {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({
        'draco3d.decoder': await draco.createDecoderModule({}),
        'meshopt.decoder': MeshoptDecoder,
      });
    const doc = await io.readBinary(
      await readFixture(
        path, { sha256 },
      ),
    );
    for (const ext of doc.getRoot().listExtensionsUsed()) {
      if (
        ['KHR_draco_mesh_compression', 'EXT_meshopt_compression'].includes(
          ext.extensionName,
        )
      )
        ext.dispose();
    }
    const basisRoot = new URL('./basis/', import.meta.url);
    const factory = new Function(
      'require',
      '__dirname',
      `${await readFile(new URL('basis_transcoder.js', basisRoot), 'utf8')}; return BASIS;`,
    )(createRequire(import.meta.url), fileURLToPath(basisRoot));
    const basis = await factory({
      wasmBinary: await readFile(new URL('basis_transcoder.wasm', basisRoot)),
    });
    basis.initializeBasis();
    for (const texture of doc.getRoot().listTextures()) {
      if (texture.getMimeType() !== 'image/ktx2') continue;
      const file = new basis.KTX2File(texture.getImage());
      try {
        if (!file.startTranscoding())
          throw new Error('Fixture texture could not transcode.');
        const data = new Uint8Array(
          file.getImageTranscodedSizeInBytes(0, 0, 0, 13),
        );
        if (!file.transcodeImage(data, 0, 0, 0, 13, 1, -1, -1))
          throw new Error('Fixture texture transcode failed.');
        texture
          .setImage(
            await encodePngNode({
              width: file.getWidth(),
              height: file.getHeight(),
              data: new Uint8ClampedArray(data),
              colorSpace: 'srgb',
            }),
          )
          .setMimeType('image/png');
      } finally {
        file.close();
        file.delete();
      }
    }
    doc
      .getRoot()
      .listExtensionsUsed()
      .find((e) => e.extensionName === 'KHR_texture_basisu')
      ?.dispose();
    const glb = await io.writeBinary(doc);
    const { scene, animations } = await new GLTFLoader().parseAsync(glb.slice().buffer, '');
    scene.animations = animations;
    scene.updateMatrixWorld(true);
    return scene;
  } finally {
    restoreImages();
    restoreGlobals();
  }
}
