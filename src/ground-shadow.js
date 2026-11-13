// One immutable 64px footprint per capture. No poster pixels or surface meshes.
const cache = new WeakMap();

export function groundShadow(data) {
	if (cache.has(data)) return cache.get(data);
	const points = data.display?.support;
	if (!Array.isArray(points) || points.length < 9 || points.length % 3 || !points.every(Number.isFinite)) {
		cache.set(data, null);
		return null;
	}
	const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
	const projected = [];
	for (let i = 0; i < points.length; i += 3) {
		for (let axis = 0; axis < 3; axis++) {
			min[axis] = Math.min(min[axis], points[i + axis]);
			max[axis] = Math.max(max[axis], points[i + axis]);
		}
		projected.push([points[i], points[i + 2]]);
	}
	const scale = Math.max(max[0] - min[0], max[2] - min[2]);
	if (!scale) { cache.set(data, null); return null; }
	const spread = scale * .06, margin = spread * 4;
	const bounds = [min[0] - margin, min[2] - margin, max[0] - min[0] + margin * 2, max[2] - min[2] + margin * 2];
	const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
	projected.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const half = list => {
		const hull = [];
		for (const point of list) {
			while (hull.length > 1 && cross(hull.at(-2), hull.at(-1), point) <= 0) hull.pop();
			hull.push(point);
		}
		return hull.slice(0, -1);
	};
	const hull = [...half(projected), ...half([...projected].reverse())];
	const size = 64, pixels = new Uint8Array(size * size);
	for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
		const point = [bounds[0] + (x + .5) / size * bounds[2], bounds[1] + (y + .5) / size * bounds[3]];
		let inside = true, distance = Infinity;
		for (let i = 0; i < hull.length; i++) {
			const a = hull[i], b = hull[(i + 1) % hull.length];
			if (cross(a, b, point) < 0) inside = false;
			const dx = b[0] - a[0], dy = b[1] - a[1];
			const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
			distance = Math.min(distance, Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy));
		}
		// Smooth across the hull edge, including the interior, to avoid a hard rim.
		const signed = inside ? -distance : distance;
		pixels[y * size + x] = Math.round(255 * .32 / (1 + Math.exp(signed / (spread * .6))));
	}
	const shadow = {size, pixels, bounds, floor: min[1]};
	cache.set(data, shadow);
	return shadow;
}

/** Composite black behind premultiplied color; camera matrices use WebGPU clip depth. */
export function shadowShader(wgsl) {
	return wgsl ? `
fn ground(color:vec4f, pixel:vec2f)->vec4f {
 if(shadow.params.y==0. || view.eye.y<=shadow.params.x){return color;}
 let q=(pixel-view.area.xy)/view.area.zw*2.-1.;
 let far=view.inverse*vec4f(q.x,-q.y,1,1);
 let ray=far.xyz/far.w-view.eye;
 if(ray.y>=-.00001){return color;}
 let point=view.eye+ray*((shadow.params.x-view.eye.y)/ray.y);
 let uv=(point.xz-shadow.bounds.xy)/shadow.bounds.zw;
 if(any(uv<vec2f(0))||any(uv>vec2f(1))){return color;}
 let alpha=textureSampleLevel(shadowMap,linearSampler,uv,0).r;
 return vec4f(color.rgb,color.a+(1.-color.a)*alpha);
}` : `
uniform sampler2D shadowMap;
uniform mat4 inverseCamera;
uniform vec3 shadowEye;
uniform vec4 shadowBounds;
uniform vec2 shadowParams;
vec4 ground(vec4 color,vec2 pixel){
 if(shadowParams.y==0.||shadowEye.y<=shadowParams.x)return color;
 vec2 q=(pixel-area.xy)/area.zw*2.-1.;
 vec4 far=inverseCamera*vec4(q,1,1);
 vec3 ray=far.xyz/far.w-shadowEye;
 if(ray.y>=-.00001)return color;
 vec3 point=shadowEye+ray*((shadowParams.x-shadowEye.y)/ray.y);
 vec2 uv=(point.xz-shadowBounds.xy)/shadowBounds.zw;
 if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return color;
 float alpha=textureLod(shadowMap,uv,0.).r;
 return vec4(color.rgb,color.a+(1.-color.a)*alpha);
}`;
}
