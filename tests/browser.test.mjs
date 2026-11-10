import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { cubeFixture } from '../tools/fixture.mjs';
import { exportImg3d } from '../tools/export.mjs';
import { validate } from '../tools/validate.mjs';

test('mirrored, nonuniformly scaled translucent capture keeps its opacity and has reversible controls',{timeout:60000},async()=>{
  const directory='.local/img-3d/translucent-cube';
  await mkdir(directory,{recursive:true});
  const source=await cubeFixture({opacity:120,affine:true,dithered:true});
  await writeFile(`${directory}/source.glb`,source);
  const metrics=await exportImg3d(source,directory);
  // A late failure must invalidate a prior qualification, even when its old
  // views file is still present for a resumable matrix run.
  await writeFile(`${directory}/rendered-quality.json`,JSON.stringify({views:Array(36).fill([0,0])}));
  await writeFile(`${directory}/metrics.json`,JSON.stringify({...metrics,selection:'validated',validationSha256:'stale',expectedCenterAlpha:1}));
  await assert.rejects(validate(directory),/Transparent alpha/);
  const failed=JSON.parse(await readFile(`${directory}/metrics.json`,'utf8'));
  assert.match(failed.selection,/provisional/);assert.equal(failed.validationSha256,undefined);
  await writeFile(`${directory}/metrics.json`,JSON.stringify({...failed,expectedCenterAlpha:120}));
  await validate(directory);
  const complete=JSON.parse(await readFile(`${directory}/metrics.json`,'utf8'));
  assert.equal(complete.selection,'validated');
  assert.equal(complete.validationSha256,createHash('sha256').update(await readFile(`${directory}/rendered-quality.json`)).digest('hex'));
});
