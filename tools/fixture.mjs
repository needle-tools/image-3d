import { NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';
import {Document} from '@gltf-transform/core';
import {BoxGeometry} from 'three';
import { NeedleBoxImpostorExtension } from './gltf/box-impostor-extension.js';

/** A deterministic, colorful cube with an exact analytic silhouette. */
/** @param {{opacity?:number,affine?:boolean,dithered?:boolean,coverage?:number,depth?:(u:number,v:number,face:number)=>number}} [options] */
export async function cubeFixture({opacity=255,affine=false,dithered=false,coverage=255,depth=()=>0}={}) {
  const n=256, raw={baseColor:Buffer.alloc(n*n*4),normalDepth:Buffer.alloc(n*n*4),orm:Buffer.alloc(n*n*4),emissive:Buffer.alloc(n*n*4)};
  const views=Array.from({length:6},(_,f)=>[f%3*80,Math.floor(f/3)*80,80,80]);
  /** @type {number[]} */
  const depthBounds=Array.from({length:12},(_,i)=>i%2?0:65535);
  const c=coverage/255;
  for(let f=0;f<6;f++)for(let y=0;y<80;y++)for(let x=0;x<80;x++){
    const i=((views[f][1]+y)*n+views[f][0]+x)*4;
    raw.baseColor.set([40+x*2,60+y*2,60+f*25,opacity].map(value=>Math.round(value*c)),i);
    const z=Math.max(0,Math.min(65535,Math.round(depth(x/79,y/79,f)*65535)));
    depthBounds[f*2]=Math.min(depthBounds[f*2],z);depthBounds[f*2+1]=Math.max(depthBounds[f*2+1],z);
    raw.normalDepth.set([Math.round(128*c),Math.round(128*c),z>>>8,z&255],i);
    raw.orm.set([coverage,Math.round(180*c),0,coverage],i);
    raw.emissive.set([0,0,0,255],i);
  }
  /** @param {Buffer} bytes */
  const encode=bytes=>sharp(bytes,{raw:{width:n,height:n,channels:4}}).png().toBuffer();
  const [baseColor,normalDepth,orm,emissive]=await Promise.all([raw.baseColor,raw.normalDepth,raw.orm,raw.emissive].map(encode));
  /** @type {import('./gltf/box-impostor-metadata.js').BoxImpostorDescriptor} */
  const descriptor={version:1,mode:'fitted',depthMode:'depth',interpolation:'none',transparency:dithered?'dithered':opacity<255?'blended':'cutout',alphaMode:opacity<255?'blend':'opaque',atlasResolution:n,padding:2,raySteps:32,alphaCutoff:.5,boxes:[{center:[0,0,0],axes:[[Math.cos(.3),0,-Math.sin(.3)],[0,1,0],[Math.sin(.3),0,Math.cos(.3)]],halfSize:[.6,.8,.4],views,depthBounds}]};
  const doc=new Document(),buffer=doc.createBuffer(),geometry=new BoxGeometry(1,1,1),primitive=doc.createPrimitive();
  for(const [name,semantic,type]of [['position','POSITION','VEC3'],['normal','NORMAL','VEC3'],['uv','TEXCOORD_0','VEC2']])primitive.setAttribute(semantic,doc.createAccessor().setBuffer(buffer).setType(type).setArray(new Float32Array(geometry.getAttribute(name).array)));
  primitive.setIndices(doc.createAccessor().setBuffer(buffer).setType('SCALAR').setArray(new Uint16Array(geometry.index.array)));
  const extension=doc.createExtension(NeedleBoxImpostorExtension),property=extension.createBoxImpostor().setDescriptor(descriptor);
  for(const[role,image]of Object.entries({baseColor,normalDepth,orm,emissive}))property.setTexture(role,doc.createTexture(role).setImage(image).setMimeType('image/png'));
  primitive.setExtension('NEEDLE_box_impostor',property);doc.createScene().addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(primitive)));geometry.dispose();
  const bytes=await new NodeIO().registerExtensions([NeedleBoxImpostorExtension]).writeBinary(doc);
  if(!affine)return bytes;
  const io=new NodeIO().registerExtensions([NeedleBoxImpostorExtension]),affineDoc=await io.readBinary(bytes),scene=affineDoc.getRoot().listScenes()[0];
  const node=scene.listChildren()[0];
  scene.removeChild(node);
  scene.addChild(affineDoc.createNode().setScale([-1.5,.7,1.1]).addChild(node));
  return io.writeBinary(affineDoc);
}
