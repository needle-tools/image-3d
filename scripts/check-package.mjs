import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
/** Check the actual npm pack file list, not repository source or a workflow snapshot. */
export function checkPackage(manifest,files){
 if(manifest.private)throw Error('Package is private and cannot be published.');
 if(manifest.name!=='@needle-tools/image-3d'||manifest.publishConfig?.access!=='public')throw Error('Unexpected package identity or publish access.');
 if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(manifest.version))throw Error('Set a stable major.minor.patch base version in package.json.');
 for(const key of ['dependencies','optionalDependencies','peerDependencies'])if(Object.keys(manifest[key]??{}).length)throw Error('Runtime package must have no dependencies.');
 const required=['package.json','README.md','LICENSE','dist/img-3d.js','dist/img-3d-xuastc.js','dist/studio.json.gz','src/runtime.d.ts','LICENSES/three-MIT.txt','LICENSES/mesh-effects-MIT.txt'];
 for(const file of required)if(!files.includes(file))throw Error('Missing package file: '+file);
 if(manifest.exports?.['./studio.json.gz']!=='./dist/studio.json.gz')throw Error('Missing studio environment export.');
 for(const entry of ['.','./xuastc']){
  const exported=manifest.exports?.[entry];
  if(!exported?.import||!exported?.types)throw Error('Missing browser import or types export: '+entry);
  for(const target of [exported.import,exported.types])if(!files.includes(target.replace(/^\.\//,'')))throw Error('Missing exported file: '+target);
 }
 for(const file of files)if(!required.includes(file)&&!file.startsWith('LICENSES/'))throw Error('Unexpected package file: '+file);
}
async function main(){
 if(!process.env.npm_execpath)throw Error('Run npm run check:package.');
 const root=fileURLToPath(new URL('../',import.meta.url));
 const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 const packed=JSON.parse(execFileSync(process.execPath,[process.env.npm_execpath,'pack','--dry-run','--json','--ignore-scripts'],{cwd:root,encoding:'utf8'}));
 if(packed.length!==1)throw Error('Expected one runtime package.');
 checkPackage(manifest,packed[0].files.map(file=>file.path));
 console.log(`Verified ${manifest.name}@${manifest.version}: ${packed[0].files.length} files, ${packed[0].size} bytes packed, no runtime dependencies.`);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await main();
