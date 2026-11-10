// @ts-check

import {
  Extension,
  ExtensionProperty,
  PropertyType,
  TextureChannel,
  TextureInfo,
} from '@gltf-transform/core';
import {
  NEEDLE_BOX_IMPOSTOR,
  parseBoxImpostorDescriptor,
} from './box-impostor-metadata.js';

const TEXTURE_ROLES = /** @type {const} */ ([
  'baseColor',
  'normalDepth',
  'orm',
  'emissive',
]);

/** @typedef {typeof TEXTURE_ROLES[number]} ImpostorTextureRole */
/** @typedef {import('./box-impostor-metadata.js').BoxImpostorDescriptor} BoxImpostorDescriptor */
/**
 * @typedef {import('@gltf-transform/core').IProperty & {
 *   descriptor: BoxImpostorDescriptor,
 *   baseColorTexture: import('@gltf-transform/core').Texture,
 *   baseColorTextureInfo: TextureInfo,
 *   normalDepthTexture: import('@gltf-transform/core').Texture,
 *   normalDepthTextureInfo: TextureInfo,
 *   ormTexture: import('@gltf-transform/core').Texture,
 *   ormTextureInfo: TextureInfo,
 *   emissiveTexture: import('@gltf-transform/core').Texture,
 *   emissiveTextureInfo: TextureInfo,
 * }} IBoxImpostor
 */

/**
 * glTF Transform property attached to a mesh primitive. Texture references are
 * explicit so runtime loading never has to infer atlas roles from PBR slots.
 */
/** @extends {ExtensionProperty<IBoxImpostor>} */
export class BoxImpostor extends ExtensionProperty {
  static EXTENSION_NAME = NEEDLE_BOX_IMPOSTOR;

  extensionName = NEEDLE_BOX_IMPOSTOR;
  propertyType = 'BoxImpostor';
  parentTypes = [PropertyType.PRIMITIVE];

  init() {}

  getDefaults() {
    const defaults = /** @type {Record<string, unknown>} */ ({
      descriptor: null,
    });
    for (const role of TEXTURE_ROLES) {
      defaults[`${role}Texture`] = null;
      defaults[`${role}TextureInfo`] = new TextureInfo(
        this.graph,
        `${role}Texture`,
      );
    }
    return /** @type {any} */ (Object.assign(super.getDefaults(), defaults));
  }

  /** @returns {BoxImpostorDescriptor | null} */
  getDescriptor() {
    return parseBoxImpostorDescriptor(this.get('descriptor'));
  }

  /** @param {BoxImpostorDescriptor} descriptor */
  setDescriptor(descriptor) {
    return this.set('descriptor', descriptor);
  }

  /** @param {ImpostorTextureRole} role */
  getTexture(role) {
    return this.getRef(`${role}Texture`);
  }

  /** @param {ImpostorTextureRole} role */
  getTextureInfo(role) {
    return this.getTexture(role) ? this.getRef(`${role}TextureInfo`) : null;
  }

  /** @param {ImpostorTextureRole} role @param {import('@gltf-transform/core').Texture | null} texture */
  setTexture(role, texture) {
    return this.setRef(`${role}Texture`, texture, {
      channels:
        TextureChannel.R |
        TextureChannel.G |
        TextureChannel.B |
        TextureChannel.A,
      ...(role === 'baseColor' || role === 'emissive' ? { isColor: true } : {}),
    });
  }
}

/** glTF Transform reader/writer for `NEEDLE_box_impostor`. */
export class NeedleBoxImpostorExtension extends Extension {
  static EXTENSION_NAME = NEEDLE_BOX_IMPOSTOR;
  extensionName = NEEDLE_BOX_IMPOSTOR;
  prewriteTypes = [PropertyType.MESH];
  /** @type {Map<BoxImpostor, Record<string, unknown>>} */
  textureInfoDefinitions = new Map();

  createBoxImpostor() {
    return new BoxImpostor(this.document.getGraph());
  }

  /** @param {import('@gltf-transform/core').ReaderContext} context */
  read(context) {
    const textureDefs = context.jsonDoc.json.textures ?? [];
    for (const [meshIndex, meshDef] of (
      context.jsonDoc.json.meshes ?? []
    ).entries()) {
      for (const [
        primitiveIndex,
        primitiveDef,
      ] of meshDef.primitives.entries()) {
        const definition = primitiveDef.extensions?.[NEEDLE_BOX_IMPOSTOR];
        if (definition === undefined) continue;
        const raw = /** @type {Record<string, unknown>} */ (definition);
        const descriptor = parseBoxImpostorDescriptor(raw);
        if (!descriptor)
          throw new Error('Invalid NEEDLE_box_impostor descriptor.');
        const property = this.createBoxImpostor().setDescriptor(descriptor);
        const textures = raw.textures;
        if (!textures || typeof textures !== 'object') {
          throw new Error('NEEDLE_box_impostor has no texture bindings.');
        }
        for (const role of TEXTURE_ROLES) {
          const info = /** @type {Record<string, unknown>} */ (textures)[role];
          if (
            !info ||
            typeof info !== 'object' ||
            !Number.isInteger(Reflect.get(info, 'index'))
          ) {
            throw new Error(
              `NEEDLE_box_impostor texture '${role}' has no valid index.`,
            );
          }
          const textureDefinition =
            textureDefs[Number(Reflect.get(info, 'index'))];
          const source = textureDefinition?.source;
          if (source === undefined || !context.textures[source]) {
            throw new Error(
              `NEEDLE_box_impostor texture '${role}' is unavailable.`,
            );
          }
          property.setTexture(role, context.textures[source]);
          const textureInfo = property.getTextureInfo(role);
          if (textureInfo)
            context.setTextureInfo(textureInfo, /** @type {any} */ (info));
        }
        context.meshes[meshIndex]
          .listPrimitives()
          [primitiveIndex].setExtension(NEEDLE_BOX_IMPOSTOR, property);
      }
    }
    return this;
  }

  /** @param {import('@gltf-transform/core').WriterContext} context */
  prewrite(context) {
    this.textureInfoDefinitions.clear();
    for (const mesh of this.document.getRoot().listMeshes()) {
      for (const primitive of mesh.listPrimitives()) {
        const property = primitive.getExtension(NEEDLE_BOX_IMPOSTOR);
        if (!(property instanceof BoxImpostor)) continue;
        const textures = /** @type {Record<string, unknown>} */ ({});
        for (const role of TEXTURE_ROLES) {
          const texture = property.getTexture(role);
          const info = property.getTextureInfo(role);
          if (texture && info)
            textures[role] = context.createTextureInfoDef(texture, info);
        }
        this.textureInfoDefinitions.set(property, textures);
      }
    }
    return this;
  }

  /** @param {import('@gltf-transform/core').WriterContext} context */
  write(context) {
    const meshDefs = context.jsonDoc.json.meshes;
    if (!meshDefs) return this;
    for (const mesh of this.document.getRoot().listMeshes()) {
      const meshDefinition =
        meshDefs[/** @type {number} */ (context.meshIndexMap.get(mesh))];
      mesh.listPrimitives().forEach((primitive, primitiveIndex) => {
        const property = primitive.getExtension(NEEDLE_BOX_IMPOSTOR);
        if (!(property instanceof BoxImpostor)) return;
        const descriptor = property.getDescriptor();
        if (!descriptor)
          throw new Error(
            'Cannot write an invalid NEEDLE_box_impostor descriptor.',
          );
        const definition = {
          ...descriptor,
          textures:
            this.textureInfoDefinitions.get(property) ??
            /** @type {Record<string, unknown>} */ ({}),
        };
        const primitiveDefinition = meshDefinition.primitives[primitiveIndex];
        primitiveDefinition.extensions ??= {};
        primitiveDefinition.extensions[NEEDLE_BOX_IMPOSTOR] = definition;
      });
    }
    return this;
  }
}

/** @param {import('@gltf-transform/core').PlatformIO} io */
export function registerNeedleBoxImpostorExtension(io) {
  io.registerExtensions([NeedleBoxImpostorExtension]);
  return io;
}
