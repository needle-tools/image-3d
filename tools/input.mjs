import{readFile}from'node:fs/promises';
import{createHash}from'node:crypto';
/** Read a local file or HTTP(S) resource, optionally pinned by SHA-256. */
export async function readFixture(input,{sha256}={}){
 const url=input instanceof URL?input:/^https?:/.test(input)?new URL(input):null;
 let bytes;
 if(url&&url.protocol!=='file:'){const response=await fetch(url);if(!response.ok)throw Error(`HTTP ${response.status}`);bytes=Buffer.from(await response.arrayBuffer());}
 else bytes=await readFile(url??input);
 if(sha256&&createHash('sha256').update(bytes).digest('hex')!==sha256)throw Error('Input checksum mismatch');
 return bytes;
}
