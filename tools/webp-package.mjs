import sharp from 'sharp';
import {gunzipSync} from 'node:zlib';
import {captureBytes} from '../src/container.js';
import {encodeContainer} from './export.mjs';
import {measureDensity} from './density.mjs';
export function decodeCapture(input){
 const bytes=captureBytes(input),raw=gunzipSync(bytes.subarray(4)),length=raw.readUInt32LE(),data=JSON.parse(raw.subarray(4,4+length));let at=4+length;
 const images=data.images.map(i=>({mime:i.mime,bytes:raw.subarray(at,at+=i.bytes)}));if(at!==raw.length)throw Error('Invalid capture payload');return{data,images};
}
export async function withDisplay(input){
 const {data,images}=decodeCapture(input);
 if(data.display?.version!==2||data.display.density?.method==='visible-texel-footprint-v1'){const pages=await Promise.all(data.pages.map(async p=>({size:p.size,geometry:await sharp(images[p.images[1]].bytes).removeAlpha().raw().toBuffer()})));data.display=measureDensity(data.batches,pages);}
 return{data,images,bytes:encodeContainer(data,images)};
}
function chunk(name,data){const head=Buffer.alloc(8);head.write(name);head.writeUInt32LE(data.length,4);return Buffer.concat([head,data,...(data.length%2?[Buffer.alloc(1)]:[])]);}
/** Extended WebP permits private chunks after the normal image. */
export async function packWebp(poster,capture){
 const meta=await sharp(poster).metadata();if(meta.format!=='webp'||!meta.width||!meta.height)throw Error('A WebP poster is required');
 const chunks=[];let extended=false;
 for(let at=12;at<poster.length;){const size=poster.readUInt32LE(at+4),end=at+8+size+(size%2),name=poster.toString('ascii',at,at+4);if(end>poster.length)throw Error('Truncated poster');if(name==='I3D1')throw Error('Poster already has a capture');if(name==='VP8X')extended=true;chunks.push(poster.subarray(at,end));at=end;}
 if(!extended){const header=Buffer.alloc(10);header[0]=meta.hasAlpha?16:0;header.writeUIntLE(meta.width-1,4,3);header.writeUIntLE(meta.height-1,7,3);chunks.unshift(chunk('VP8X',header));}
 chunks.push(chunk('I3D1',Buffer.from(captureBytes(capture))));const body=Buffer.concat([Buffer.from('WEBP'),...chunks]),header=Buffer.alloc(8);header.write('RIFF');header.writeUInt32LE(body.length,4);return Buffer.concat([header,body]);
}
