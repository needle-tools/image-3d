// Optional reproducible rebuild; normal package builds use the pinned artifact.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const run=promisify(execFile),source=resolve(process.argv[2]??'../basis_universal'),target=resolve(import.meta.dirname,'../src/xuastc');
const revision=(await run('git',['-C',source,'rev-parse','HEAD'])).stdout.trim();
await run('git',['-C',source,'diff','--exit-code','HEAD','--','transcoder','zstd']);
const flags=['-Oz','-flto','-fno-exceptions','-fno-rtti','-DNDEBUG','-DBASISU_SUPPORT_ENCODING=0','-DBASISD_SUPPORT_ATC=0','-DBASISD_SUPPORT_PVRTC1=0','-DBASISD_SUPPORT_PVRTC2=0','-DBASISD_SUPPORT_FXT1=0','-DBASISD_SUPPORT_ETC2_EAC_RG11=0'];
const options=['--no-entry','-s','STANDALONE_WASM=1','-s','ALLOW_MEMORY_GROWTH=1','-s','FILESYSTEM=0','-s','MALLOC=emmalloc','-s','EXPORTED_FUNCTIONS=["_malloc","_free","_i3d_init","_i3d_open","_i3d_info","_i3d_size","_i3d_decode","_i3d_close"]'];
await run('em++',[...flags,'-I',resolve(source,'transcoder'),resolve(target,'bridge.cpp'),resolve(source,'transcoder/basisu_transcoder.cpp'),resolve(source,'zstd/zstddeclib.c'),...options,'-o',resolve(target,'transcoder.wasm')],{maxBuffer:8*1024*1024});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const metadata={source:`https://github.com/BinomialLLC/basis_universal/tree/${revision}`,revision,compiler:(await run('em++',['--version'])).stdout.split('\n')[0],flags,options,wasmSha256:hash(await readFile(resolve(target,'transcoder.wasm'))),bridgeSha256:hash(await readFile(resolve(target,'bridge.cpp')))};
await writeFile(resolve(target,'source.json'),JSON.stringify(metadata,null,2));
await copyFile(resolve(source,'LICENSE'),resolve(target,'LICENSE.txt'));
await copyFile(resolve(source,'NOTICE'),resolve(target,'NOTICE.txt'));
await copyFile(resolve(source,'zstd/LICENSE'),resolve(target,'ZSTD-LICENSE.txt'));
console.log(JSON.stringify(metadata,null,2));
