import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkPackage} from '../scripts/check-package.mjs';
const files=['package.json','README.md','LICENSE','LICENSES/three-MIT.txt','LICENSES/mesh-effects-MIT.txt','dist/img-3d.js','dist/img-3d-xuastc.js','dist/studio.json.gz','src/runtime.d.ts'];
const manifest={name:'@needle-tools/image-3d',version:'0.1.0',publishConfig:{access:'public'},exports:{'.':{types:'./src/runtime.d.ts',import:'./dist/img-3d.js'},'./xuastc':{types:'./src/runtime.d.ts',import:'./dist/img-3d-xuastc.js'},'./studio.json.gz':'./dist/studio.json.gz'}};
test('package verification accepts both browser entrypoints with declarations and licenses',()=>{assert.doesNotThrow(()=>checkPackage(manifest,files));});
test('package verification rejects private/dependent packages and missing or unrelated files',()=>{
 assert.throws(()=>checkPackage(manifest,files.filter(file=>file!=='LICENSE')),/Missing package file: LICENSE/);
 assert.throws(()=>checkPackage({...manifest,private:true},files),/private/);
 assert.throws(()=>checkPackage({...manifest,dependencies:{three:'1.0.0'}},files),/dependencies/);
 assert.throws(()=>checkPackage(manifest,files.filter(file=>file!=='dist/img-3d-xuastc.js')),/missing/i);
 assert.throws(()=>checkPackage(manifest,files.filter(file=>file!=='dist/studio.json.gz')),/Missing package file: dist\/studio\.json\.gz/);
 for(const file of ['.env','demo/private.webp','tests/fixture.glb','src/runtime.js'])assert.throws(()=>checkPackage(manifest,[...files,file]),/Unexpected/);
});

test('package verification requires a stable base version for either release branch',()=>{
 for(const version of ['0.1.0-canary.1','v0.1.0','01.0.0',''])assert.throws(()=>checkPackage({...manifest,version},files),/stable/);
});
