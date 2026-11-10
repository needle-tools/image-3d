import { describe, test, expect } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { cubeFixture } from '../tools/fixture.mjs';
import { readBoxSource, packPage, encodeContainer } from '../tools/export.mjs';
import { Document, NodeIO } from '@gltf-transform/core';

describe('standalone img-3d experiment',()=>{
  test('reads explicit box roles, removes gutters and normalizes the affine basis',async()=>{
    const source=await readBoxSource(await cubeFixture());
    expect(source.pages).toHaveLength(1);
    expect(source.batches[0].boxes[0].v[0]).toEqual([2,2,76,76]);
    const box=source.batches[0].boxes[0];
    expect(box.c).toEqual([0,0,0]);
    expect(box.h).toEqual([.6,.8,.4]);
    expect(box.a[0][0]).toBeCloseTo(Math.cos(.3)*1.25);
    const packed=packPage(source.pages[0]);
    const i=(10*256+10)*4,g=(10*512+10)*3;
    expect([...packed.geometry.subarray(g,g+3)]).toEqual([0,0,255]);
    expect(packed.geometry[g+256*3]).toBe(source.pages[0].maps[0][i+3]);
    expect([...packed.shading.subarray((10*768+10)*3,(10*768+10)*3+3)]).toEqual([128,128,128]);
    expect(packed.emission).toBe(false);
  });
  test('single file carries versioned metadata and the exact embedded image bytes',()=>{
    const metadata={version:1,images:[{bytes:3,mime:'image/png'}]};
    const file=encodeContainer(metadata,[{bytes:Buffer.from([1,2,3])}]);
    expect(file.subarray(0,4).toString()).toBe('I3D1');
    const raw=gunzipSync(file.subarray(4)),length=raw.readUInt32LE();
    expect(JSON.parse(raw.subarray(4,4+length).toString())).toEqual(metadata);
    expect([...raw.subarray(4+length)]).toEqual([1,2,3]);
  });
  test('preserves inherited affine transforms and represents dithered opacity with blending',async()=>{
    const source=await readBoxSource(await cubeFixture({affine:true,opacity:120,dithered:true}));
    const batch=source.batches[0],box=batch.boxes[0];
    expect(batch.blend).toBe(true);
    expect(source.conversions).toContain('Dithered transparency uses alpha blending.');
    const scale=source.normalization.scale;
    expect(box.a[0][0]).toBeCloseTo(Math.cos(.3)*-1.5*scale);
    expect(box.a[1][1]).toBeCloseTo(.7*scale);
    expect(box.a[0][2]).toBeCloseTo(-Math.sin(.3)*1.1*scale);
  });
  test('does not silently freeze animation or infer captures from fallback material slots',async()=>{
    const d=new Document(),scene=d.createScene();
    d.createAnimation();
    await expect(readBoxSource(await new NodeIO().writeBinary(d))).rejects.toThrow('frozen pose');
    d.getRoot().listAnimations()[0].dispose();
    scene.addChild(d.createNode().setMesh(d.createMesh().addPrimitive(d.createPrimitive())));
    await expect(readBoxSource(await new NodeIO().writeBinary(d))).rejects.toThrow('box-impostor');
  });
});
