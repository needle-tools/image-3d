export const cameraFocal=2.41421356;

/** Match a padded bounding-sphere camera without retaining the authored poster crop. */
export function boundsFrame(points,{aspect,fov=30,padding=1.1}={}){
	if(!Array.isArray(points)||points.length<3||points.length%3||!points.every(Number.isFinite))throw Error('Capture has no surface bounds');
	if(!Number.isFinite(aspect)||aspect<=0||!Number.isFinite(fov)||fov<10||fov>100||!Number.isFinite(padding)||padding<1||padding>3)throw Error('Invalid bounds framing');
	const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
	for(let i=0;i<points.length;i++){
		const axis=i%3;min[axis]=Math.min(min[axis],points[i]);max[axis]=Math.max(max[axis],points[i]);
	}
	const radius=Math.hypot(...max.map((value,axis)=>value-min[axis]))/2;
	if(!radius)throw Error('Capture has empty surface bounds');
	const vertical=fov*Math.PI/360,horizontal=Math.atan(Math.tan(vertical)*aspect);
	const crop=cameraFocal*Math.tan(vertical);
	return {
		aspect,center:min.map((value,axis)=>(value+max[axis])/2),
		distance:radius/Math.sin(Math.min(vertical,horizontal))*padding,
		frame:[(1-crop)/2,(1-crop)/2,crop,crop],
	};
}

/** Orbit pitch in radians stays short of the poles, where the view's up direction is undefined. */
export const orbitPitchLimit=1.5;

export function orbitEye(view,center=[0,0,0]){
	const pitch=Math.max(-orbitPitchLimit,Math.min(orbitPitchLimit,view.pitch));
	return [Math.sin(view.yaw)*Math.cos(pitch)*view.distance,Math.sin(pitch)*view.distance,Math.cos(view.yaw)*Math.cos(pitch)*view.distance].map((value,axis)=>value+center[axis]);
}
