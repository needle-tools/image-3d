const tag=(bytes,at)=>String.fromCharCode(...bytes.subarray(at,at+4));
/** A WebP poster and a raw capture carry the identical versioned payload. */
export function captureBytes(bytes){
 if(tag(bytes,0)==='I3D1')return bytes;
 if(bytes.length<12||tag(bytes,0)!=='RIFF'||tag(bytes,8)!=='WEBP')throw Error('Unsupported img-3d file');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(view.getUint32(4,true)+8!==bytes.length)throw Error('Invalid WebP length');
 let found;
 for(let at=12;at<bytes.length;){
  if(at+8>bytes.length)throw Error('Truncated WebP chunk');
  const size=view.getUint32(at+4,true),end=at+8+size,next=end+(size%2);
  if(next>bytes.length||size%2&&bytes[end]!==0)throw Error('Invalid WebP chunk');
  if(tag(bytes,at)==='I3D1'){if(found)throw Error('Duplicate WebP capture');found=bytes.subarray(at+8,end);}
  at=next;
 }
 if(!found||tag(found,0)!=='I3D1')throw Error('WebP has no 3D capture');
 return found;
}
