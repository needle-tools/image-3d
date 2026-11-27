// Qualify captured GLBs supplied by any producer; fitting and mesh baking are upstream.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFixture} from './input.mjs';
import {exportImg3d} from './export.mjs';
import {validate} from './validate.mjs';
const args=process.argv.slice(2),option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const config=JSON.parse(await readFile(option('--inputs','tools/assets.json'),'utf8')),directory=resolve(option('--output','.local/matrix'));
const requested=option('--models',config.models.map(m=>m.id).join(',')).split(','),sizes=option('--sizes','').split(',').filter(Boolean).map(Number);
const profiles=option('--profiles','pbr,pbr-xuastc,baked,baked-xuastc').split(','),run=promisify(execFile),results=[];
for(const model of config.models.filter(m=>requested.includes(m.id)))for(const size of sizes.length?sizes:Object.keys(model.captures).map(Number)){
 const capture=model.captures[size];if(!capture)throw Error(`No ${size} capture for ${model.id}`);
 const bytes=await readFixture(capture.file,{sha256:capture.sha256}),native=new Map();
 for(const profile of profiles){
  if(!['pbr','pbr-xuastc','baked','baked-xuastc'].includes(profile))throw Error('Unknown appearance profile');
  const baked=profile.startsWith('baked'),base=baked?'baked':'pbr',output=resolve(directory,model.id,String(size),profile);
  await mkdir(output,{recursive:true});
  if(profile.endsWith('xuastc')){
   if(!native.has(base)){const reference=resolve(directory,model.id,String(size),base);await exportImg3d(bytes,reference,{baked});await validate(reference,{dense:true});native.set(base,reference);}
   await run(process.execPath,['tools/xuastc.mjs',native.get(base),output,resolve(option('--basisu',process.env.BASISU_PATH??'../basis_universal/bin/basisu'))],{maxBuffer:32*1024*1024});
  }else{await exportImg3d(bytes,output,{baked});native.set(base,output);}
  await validate(output,{dense:true});
  results.push({model:model.id,size,profile,output});console.log(`Qualified ${model.label} ${size} ${profile}`);
 }
}
await writeFile(resolve(directory,'matrix.json'),JSON.stringify(results,null,2));
