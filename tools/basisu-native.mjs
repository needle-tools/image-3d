// @ts-check

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { encodePngNode } from './images.mjs';

const execFileAsync = promisify(execFile);

/** @typedef {{role:string,width:number,height:number,rgba:Uint8Array,settings:{codec:'etc1s'|'uastc',quality:number,effort:number,colorSpace:'srgb'|'linear',mipmaps:boolean,maxMipLevels:number,rdoLambda?:number}}} Ktx2EncodeInput */

/**
 * @param {{basisuPath: string}} options
 */
export function createNativeBasisuEncoder(options) {
  if (!options.basisuPath) throw new Error('A basisu executable path is required.');
  return async (/** @type {Ktx2EncodeInput} */ input) => {
    const directory = await mkdtemp(join(tmpdir(), 'image-3d-ktx2-'));
    const sourcePath = join(directory, `${input.role}.png`);
    const outputPath = join(directory, `${input.role}.ktx2`);
    try {
      await writeFile(sourcePath, await encodePngNode({
        width: input.width,
        height: input.height,
        data: new Uint8ClampedArray(input.rgba),
        colorSpace: input.settings.colorSpace,
      }));
      const args = [
        input.settings.codec === 'uastc' ? '-uastc' : '-etc1s',
        '-quality', String(input.settings.quality),
        '-effort', String(input.settings.effort),
        input.settings.colorSpace === 'srgb' ? '-srgb' : '-linear',
        '-output_file', outputPath,
        '-no_status_output',
        sourcePath,
      ];
      if (input.settings.mipmaps) {
        const minimumMipDimension = Math.max(
          1,
          Math.ceil(Math.max(input.width, input.height) / 2 ** (input.settings.maxMipLevels - 1)),
        );
        args.splice(-4, 0, '-mipmap', '-mip_clamp', '-mip_smallest', String(minimumMipDimension));
      }
      if (input.settings.codec === 'uastc' && input.settings.rdoLambda) {
        args.splice(-4, 0, '-uastc_rdo_l', String(input.settings.rdoLambda));
      }
      await execFileAsync(options.basisuPath, args, { maxBuffer: 16 * 1024 * 1024 });
      return new Uint8Array(await readFile(outputPath));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };
}
