import sharp from 'sharp';
export async function decodeImageNode(bytes){const{data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});return{width:info.width,height:info.height,data:new Uint8Array(data)};}
export async function encodePngNode(map){return new Uint8Array(await sharp(map.data,{raw:{width:map.width,height:map.height,channels:4}}).png({compressionLevel:7,adaptiveFiltering:true}).toBuffer());}
