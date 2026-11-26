import {cameraFocal,orbitEye,orbitPitchLimit} from './bounds-fit.js';

const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const unit = vector => {
	const length = Math.hypot(...vector);
	return vector.map(value => value/length);
};

export const identityRotation = [1,0,0, 0,1,0, 0,0,1];

export function modelRotation(yaw, pitch = 0) {
	const c = Math.cos(yaw), s = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
	// Columns are right, up, and forward. Right stays horizontal as the model nods.
	return [c,0,-s, -s*sp,cp,-c*sp, s*cp,sp,c*cp];
}

/** Aim +Z at the cursor projected halfway from the camera to the model. */
export function pointerLookAngles(view, layout, frameRatio, ndcX, ndcY) {
	const pitch = Math.max(-orbitPitchLimit, Math.min(orbitPitchLimit, view.pitch));
	const x = (ndcX-layout.cx)*frameRatio/(cameraFocal*layout.sx);
	const y = (ndcY-layout.cy)/(cameraFocal*layout.sy);
	const sin = Math.sin(pitch), cos = Math.cos(pitch);
	const depth = cos-y*sin, height = sin+y*cos;
	return [view.yaw+Math.atan2(x,depth), Math.atan2(height,Math.hypot(x,depth))];
}

function localDirection(rotation, [x,y,z]) {
	return [rotation[0]*x + rotation[1]*y + rotation[2]*z,
		rotation[3]*x + rotation[4]*y + rotation[5]*z,
		rotation[6]*x + rotation[7]*y + rotation[8]*z];
}

export function localLighting(light, rotation) {
	if (!rotation) return light;
	return {
		...light,
		direction:localDirection(rotation, light.direction),
		...(light.lights && {lights:light.lights.map(entry => ({...entry,direction:localDirection(rotation, entry.direction)}))}),
	};
}

/** Transform the fixed camera into the rotated model's space around its framing center. */
export function orbitFrame(view, center = [0,0,0], look) {
	const eye = orbitEye(view, center);
	const forward = unit(eye.map((value,i) => center[i]-value));
	const right = unit(cross(forward,[0,1,0]));
	const up = cross(right,forward);
	if (!look) return {eye,forward,right,up};

	const rotation = modelRotation(look[0],look[1]);
	const localEye = localDirection(rotation, eye.map((value,i) => value-center[i]));
	return {
		eye:localEye.map((value,i) => value+center[i]),
		forward:localDirection(rotation, forward),
		right:localDirection(rotation, right),
		up:localDirection(rotation, up),
		rotation,
	};
}
