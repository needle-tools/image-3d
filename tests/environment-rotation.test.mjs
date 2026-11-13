import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeLighting,lightingState,studioUniforms} from '../src/lighting.js';
test('environment rotation is independent lighting state, accepts negative angles and keeps the shared texture',()=>{
 const environment={size:2,levels:2,data:new Uint16Array(288)};
 const base=normalizeLighting({environment,environmentIntensity:.65});
 const turned=normalizeLighting({...base,environmentRotation:-Math.PI/2});
 assert.equal(base.environmentRotation,0);assert.equal(turned.environmentRotation,-Math.PI/2);
 assert.equal(turned.environment,environment);assert.equal(turned.environmentIntensity,.65);
 assert.notDeepEqual(lightingState(turned),lightingState(base));
 assert.ok(Math.abs(studioUniforms(turned)[27]+Math.PI/2)<1e-6);
 assert.equal(normalizeLighting({...base,environmentRotation:NaN}).environmentRotation,0);
});
