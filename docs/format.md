# Image 3D format and runtime

A browser-only renderer: one JavaScript file and one `.i3d` capture or WebP package. It
renders with WebGPU when the browser provides it and with WebGL 2 otherwise. The
core uses native image decoding and renders only when a view changes.

```html
<script type="module" src="img-3d.js"></script>
<img-3d src="model.i3d" style="width:400px;height:400px"></img-3d>
```

Or import `@needle-tools/image-3d`. The entry
registers itself. Drag or arrow keys orbit;
Alt+wheel or +/- zoom; double-click or Home resets. `src` replaces the capture;
`load` and `error` events report the outcome. Removing the element cancels its
loading. The final disconnect releases caches and the optional decoder worker.

`npm run build` builds both standalone entries. The ordinary package build
and prepare path include them. HTTPS or localhost is required for native
DecompressionStream; generated self-contained HTML also works from disk in the
tested Chrome. The [project README](../README.md) documents conversion, qualification and the comparison page.

## Responsive layout and sources

`srcset` accepts width (`w`) or density (`x`) candidates. Width descriptors are
the converter's `display.effectiveWidth`, measured at distance 4 and a 45° field
of view, rather than capture-atlas dimensions. Selection uses the laid-out image
frame size, device pixel ratio (capped at 2) and camera zoom. The component measures
its actual slot, so it needs no `sizes` string. Upgrades have boundary hysteresis;
shrinking or zooming out retains a loaded higher-resolution candidate in the set.
The current view remains interactive until a replacement is ready. Source changes
are shared through the normal caches. `currentSrc` reports the capture on display.

`width` and `height` attributes provide default dimensions and an aspect ratio;
CSS can override them. `naturalWidth` and `naturalHeight` report display metadata
after loading (300×300 for older captures, zero before loading). The default fit is
`contain`; `fill`, `cover`, `none`, `scale-down` and `object-position` are also
interpreted by both renderers. Normal CSS scrolling, clipping and stacking remain
owned by the element's canvas. For layout before component registration, include
critical sizing CSS or use a native poster; custom elements do not acquire native
image layout merely by having width/height attributes.

An `<img>` or `<picture>` with `data-img-3d` is progressively enhanced when its
selected image is a WebP package. Native `srcset`, `sizes`, `<source media/type>`,
dimensions and alt text remain on the image. The overlay follows the browser's
`currentSrc` exactly; it does not select candidates or switch files on 3D zoom.
The image stays in flow, becomes visually hidden after the
first rendered frame, and returns on error, print or `disconnect()`. All overlays
share the same device and cache owner as ordinary `<img-3d>` elements.

`enhanceImage(connectedImageOrPicture)` returns `{image, element, disconnect}`.
It can be called repeatedly without creating another renderer. `element` exposes
the usual camera, lighting and draw API. Picture markup is recommended for explicit
layout; a standalone image gets an owned wrapper that is removed on disconnect.
Cross-origin packages need fetch CORS permission for the embedded capture, even
when the browser can display the poster without it.

## Runtime boundary

The generated viewer has no runtime dependency on Three.js or the Mesh Effects
package. Its source lives here; the build bundles local helpers into one file.

The runtime consumes versioned captures. It owns its shader and interval
refinement implementation; producers share the file contract rather than a
runtime dependency. The standalone shader writer emits GLSL and WGSL at build
time and is not shipped. Both backends draw compact twelve-triangle boxes and
reconstruct depth in shaders, without surface meshes or geometry LODs. Depth is
local to each rendered image: it resolves captured surfaces within that image,
but does not add objects to a host scene, cast scene shadows or participate in
a host renderer's reflection probes.

## Appearance and optional GPU compression

The format displays static box captures with inherited affine transforms and
separate transparent batches. Freeze animation before conversion. It always
traces captured depth and selects the nearest supported surface, independently
of the original projection/interpolation settings. Dithered opacity uses alpha
blending. There are two appearance modes:

- PBR attributes: a small GGX key light and hemisphere approximation by default,
  without shadows, transmission or Three.js's full PBR pipeline.
  Set `element.lighting = { direction: [1, 1, 0], intensity: 4, ambient: 0.3 }`
  to relight and redraw that element. Set it to `null` to restore the default
  key `[-0.6, 1, 1]`, intensity `2.5` and hemisphere strength `1`.
  Optional `environment` and `lights` fields enable prefiltered studio IBL,
  ACES tone mapping and up to three colored directional lights. Static IBL and
  moving-light shaders are separate variants; the default and baked paths do not
  evaluate those lighting terms.
- Baked studio radiance: outgoing color from the workbench's studio PMREM with
  fixed ACES tone mapping, captured in six orthographic directions per box.
  Supported nearby surfaces blend with directional weights. Normals, material
  maps and lighting calculations are absent from this compiled shader. Lighting
  cannot change at runtime; six directions approximate glossy reflections.

The smaller shader's rendering approximation is measured separately from codec
error. It is not a replacement for full glTF PBR rendering.

For XUASTC captures, use **one** complete optional entry instead of the core:

```html
<script type="module" src="img-3d-xuastc.js"></script>
<img-3d src="gpu-compressed.i3d"></img-3d>
```

Its npm entry is `@needle-tools/image-3d/xuastc`.
It includes the core and embedded Basis Universal WASM, with no external decoder
request. A shared worker transcodes color to sRGB ASTC when supported, otherwise
BC7, otherwise RGBA. Native numeric geometry stays lossless. If policy blocks
Blob workers, trusted WASM decoding falls back to the main thread. If WASM is
also forbidden, the element reports an error and other native captures continue.
CSP must permit WebAssembly compilation for either path. No neural codec is used.

Loading the optional entry after the core is supported: it registers its decoder
with the existing owner, preserving one renderer and the same exported class.
This lazy-loading strategy downloads the core portion twice; a deployment using
only the optional entry avoids that overhead. Decoder lifetime and textures are
shared across every element, not allocated per element.

The embedded WASM is gzip packed and expanded once with the same native
`DecompressionStream` required by the capture container. Separate cold worker
startup from warm transcoding when measuring it: compilation, instantiation and
lookup-table initialization happen before the first image can be decoded.

The decoder binary is pinned by `xuastc/source.json` (source commit, compiler,
flags and artifact hashes). To reproduce it with Emscripten installed:
`node scripts/build-img-3d-xuastc.mjs /path/to/basis_universal`. Normal consumers
need no compiler. Basis Universal's license and notice and Zstandard's BSD license ship in
`xuastc/` and are embedded in the standalone JavaScript file.

## Many elements

Every element in a document shares **one WebGPU device**, or **one WebGL2
context** in the WebGL renderer. Each element owns an ordinary canvas, so CSS
clipping, transforms, stacking and nested or page scrolling use native browser
compositing.

| Renderer | Per frame |
|---|---|
| WebGPU | All changed views render together into a shared atlas; a GPU texture copy moves each view into its element's WebGPU canvas. |
| WebGL 2 | All changed views render into a shared frame; each element's 2D canvas copies its region. |

Intersection observation delays offscreen loading/rendering. URL requests are
deduplicated with three concurrent fetches, and GPU uploads are shared. A loading
source does not block ready views. Draws coalesce per element within a 12 ms CPU
submission budget. In the WebGL renderer, identical source, camera, size and
light settings reuse one render within a frame. GPU cost still depends on the number and size of
distinct views. Rendering pauses while the document
is hidden. Normal wheel and
vertical touch gestures scroll the page. Only Alt+wheel zooms a view.

Visible models, including the 128-pixel preload margin, retain their shared GPU
textures and encoded data automatically. Multiple elements showing one URL
share that residency; the last visible owner releases it to the inactive cache.
Inactive GPU textures use an eight-asset / 64 MiB LRU cache; inactive encoded
images use an eight-asset / 32 MiB cache. Scrolling, replacing a source and
disconnecting trim that cache. The visible working set is additional to those
limits; it is reported separately by `Img3d.statistics`. Returning to an evicted
model recreates textures. Raster canvases still use
memory proportional to element size and pixel density, like decoded images.
`Img3d.statistics` reports shared counts and payload bytes. Instance getters
`textureBytes`, `textureFormat` and `transcodeMilliseconds` describe the current
resident capture; payload bytes exclude driver and raster-canvas overhead.
Native poster decoding and browser image-cache memory are additional to those
3D texture payloads and are managed by the browser.

For a fixed camera fitted to the reconstructed surface instead of the authored
poster crop, call `element.fitToBounds({aspect: 4 / 3, fov: 30, padding: 1.1})`
after `load`. It returns the fitted camera distance. The orbit center comes from
the surface bounds, including off-center captures. This is a one-time fit; yaw,
pitch and distance changes do not refit the frame. Existing poster framing remains
the default. The capture must contain surface-support metadata.

The optional studio lighting object uses:

```js
element.lighting = {
  environment: { size: 32, levels: 6, data: prefilteredRgba16f },
  environmentIntensity: 1,
  lights: [
    { direction: [1, 1, 0], color: [1, 0.78, 0.52], intensity: 12 },
    { direction: [-1, 0.2, 1], color: [0.22, 0.55, 1], intensity: 7 },
    { direction: [0, 1, -1], color: [0.65, 0.85, 1], intensity: 18 }
  ]
};
```

Use `lights: []` for environment-only lighting. Environment `data` is an immutable
`Uint16Array` of linear half-float RGBA pixels: `size * levels` columns and
`size + 16` rows. The top `size` rows hold side-by-side octahedral radiance slices
at evenly spaced roughness levels; the bottom-left 16×16 pixels hold the
roughness/N·V BRDF integration table. The same environment object shares one GPU
texture across elements. `statistics.environmentBytes` reports this shared memory.
The demo's `lighting.js` loads its compressed asset with native browser APIs;
`node tools/export-studio.mjs` regenerates it from the shared studio generator.

Studio lighting integrates screen-space normal variance into specular roughness
to reduce shimmering highlights. A shared edge-directed resolve filters color
and silhouette coverage after shading, without additional surface traces.
Samples clamp to each element's atlas region. Silhouette filtering depends on
alpha rather than lighting, so moving a light does not change opacity. Baked
and legacy lighting retain their existing rendering paths.

Automatic updates compare the source, camera pose, physical canvas size,
renderer generation and lighting values with the last rendered state. Equivalent
settings do not redraw, and changes reverted before the next frame are discarded.
Baked appearances ignore lighting changes. Explicit `draw()` still forces a
refresh for immediate pixel readback.

WebGPU rasterizes twelve triangles per box and reconstructs captured depth in
the fragment shader. The nearest supported hit determines visibility; shading
then runs once per visible pixel. A compact min/max depth pyramid skips empty
intervals without adding vertices. Large elements use the same geometry as small
ones. Light-only changes reuse opaque and translucent visibility; camera, source
or size changes retrace it. Offscreen elements release their visibility caches.
A view larger than the shared atlas renders in a frame of its own, up to the
device texture limit; larger views report an error. Read a WebGPU canvas with
`drawImage` or `toDataURL` when `draw()` resolves, before presentation.

In the WebGL renderer, forward tracing batches 16 independent depth samples and visits crossing
intervals through a bit mask. It retains the texel-scaled sample grid, five
refinement iterations and all hit validation; it does not impose a quality cap.
PBR visits camera-facing fields first, retaining all six fields and nearest-hit
ties. Baked accumulation retains its capture order. Forward PBR, cache writes,
cache reuse and baked rendering use separately compiled programs.

WebGL light-only updates reuse opaque surface intersections after a camera has stayed
unchanged for two draws. Changing the camera renders directly until it settles;
baked captures and transparent batches retain their forward rendering paths.
Carrier triangle edges also trace directly to preserve antialiasing. When an
opaque cached owner covers the whole pixel, its depth conservatively bounds
those edge searches while retaining depth ties. This cache requires renderable
float textures and a 24- or 32-bit destination depth buffer; other devices use
the forward path. Cache depth attachments match the destination precision.
Each cached view uses 20 bytes per physical pixel in addition to source textures
and raster canvases. `surfaceBytes` and `surfaceCaches` report this separate
working set; `surfaceBuilds`, `surfaceReuses` and `viewRenders` count cache builds,
reuse and actual rendered views. Offscreen views, source replacement, disconnect
and context loss release these caches. A distinct camera for every card still
requires a distinct rendered view, even when only the light moves.

WebGL context loss retains raster images; restoration rebuilds visible views.
After WebGPU device loss, a new device redraws visible views; when none is
available, elements continue with the WebGL renderer. The last disconnect clears
caches.

`Img3d.statistics` reports the active `backend` and WebGPU `adapter`, `devices`,
`canvasContexts`, transient `attachmentBytes` and `validationErrors`; `contexts`
counts WebGL contexts.

## I3D1 file

Four magic bytes `I3D1`, then gzip: little-endian uint32 JSON length, UTF-8 JSON,
and consecutive image bytes. The envelope remains I3D1; metadata versions are
explicit: **1** for PBR attributes, **2** with `appearance:"baked"` for baked
radiance. Older readers reject metadata version 2 clearly.

Pages explicitly name image indices, MIME types, byte lengths and oriented-box
batches. Centers and affine bases normalize to a two-unit scene. Half sizes,
six pixel rectangles excluding gutters and twelve uint16 depth bounds rebuild
the volume. Nothing is inferred from fallback material slots or sidecar names.

PBR pages contain three opaque RGB images:

1. sRGB color, optionally with an adjacent emissive pane.
2. Lossless geometry: depth high/low bytes and coverage at left, opacity at right.
3. Grayscale shading planes in a 3×2 grid: octahedral normal X/Y, roughness,
   occlusion and metalness. They upload as R8.

Baked pages contain only radiance and the identical lossless geometry image.
Color is native PNG/JPEG/WebP/AVIF, or XUASTC KTX2 through the optional entry.
Native color uploads to RGBA; GPU compression reduces color texture storage.
Numeric depth, coverage and opacity are never sent through a lossy color codec.
All image bytes are embedded in the single capture; assets supply no executable
code or decoder URLs.

### Metadata fields

The JSON object has `version`, `pages`, `batches` and `images`. Version 2 also
requires `appearance: "baked"`; version 1 omits `appearance`.

- Optional `display`: versions 1 and 2 have positive integer `width`, `height` and
  `effectiveWidth` (at most 16384). Version 1 retains its original camera frame.
  Version 2 adds `frame: [x, y, width, height]`, a crop in normalized coordinates
  of the canonical square camera image, with a matching pixel aspect ratio.
  Its `support` is a flat array of up to 98 XYZ surface support points, selected
  along uniformly distributed directions. These let orbit fitting widen the
  frame with a small safety margin when another view would clip the surface.
  The converter frames the reference camera with a 3% margin per side;
  it measures the captured supported surface, rather than empty box corners.
  `density.method` is `visible-reconstruction-footprint-v2`: captured supported texels are
  projected into a 96×96 depth buffer for twelve orbit views. Near-depth samples
  combine the best available capture density, so overlapping hidden surfaces or
  duplicate boxes do not count as additional useful pixels. The recommendation
  preserves the finest view's 99th-percentile visible detail, with two raster
  samples per capture texel to retain reconstructed contours and filtering.
  Widths are scaled to the content frame and rounded down to four pixels.
  The older `visible-texel-footprint-v1` used a coarse-region lower bound; WebP
  packaging remeasures those captures rather than using that bound as a poster size.
  `density` also records sample count and per-view measurements. This measures
  spatial sampling, not perceptual error; codec and rendered-quality gates remain
  separate. `camera` records the reference orbit and field of view.

- `images`: ordered `{bytes, mime}` records. `bytes` is the exact encoded payload
  length. Payloads follow the JSON in this same order, without separators.
  MIME types are `image/png`, `image/jpeg`, `image/webp`, `image/avif` or
  `image/ktx2`. KTX2 color requires the optional decoder entry.
- `pages`: `{size, emission, images}`. `size` is the square capture-atlas side
  `N`. `images` contains three indices for PBR, or two for baked radiance, in the
  role order above. Indices partition the image list; pages do not share image
  indices. `emission` is a boolean and is false for baked pages.
- `batches`: `{page, blend, cutoff, boxes}`. `page` selects a capture page;
  `blend` selects alpha blending rather than cutout rendering; `cutoff` is
  strictly between zero and one. Each batch contains at least one box.
- Each box is `{c, a, h, v, d}`. `c` is its three-component center. `a` is three
  affine axis vectors, and `h` is three positive half sizes. A point `q` inside
  the unit box maps to `c + Σ a[k] * h[k] * q[k]`. The basis must be invertible;
  inherited nonuniform scale and mirroring are supported. `v` contains six
  `[x, y, width, height]` atlas rectangles in pixels, with gutters excluded.
  `d` contains six `[near, far]` pairs, flattened to twelve uint16 values. A pair
  with `near > far` declares an empty capture. Full bounds are `[0, 65535]`.

Centers and axes share one scene coordinate system. The converter centers the
whole object at zero and scales its largest extent to two units. The default
camera looks at the origin from distance four with a 45° vertical field of view.

### WebP image package

An extended WebP contains a regular poster followed by one private `I3D1` RIFF
chunk. Its payload is a complete ordinary `.i3d` container, including its magic
and compressed metadata and maps. The RIFF size includes the chunk and its even
padding. The poster dimensions equal `display.width`/`height`, so native `w`
descriptors describe actual image dimensions as required by HTML. Existing
texture codecs and capture versions remain unchanged. If a producer's standard
glTF `asset.thumbnail` is available during conversion and has enough pixels, it
supplies the poster. A smaller thumbnail is retained as source data while the
poster is rendered from the capture.
The full source thumbnail is retained separately by the converter. The poster is
trimmed, fitted and resized to the measured capture frame, with its actual width
equal to `display.effectiveWidth`. Native width descriptors therefore reflect both
the image dimensions and the capture's measured reconstruction sampling. Posters
use a single quality-85 WebP encoding with lossless alpha. The validation suite
compares the native poster with an equally compressed live view at 2× display
density, keeping raster fitting error separate from reported codec error.
Thumbnail pose and lighting are authored by the producer; arbitrary glTF thumbnails
do not promise a matching 3D reference view.

Ordinary WebP readers ignore the private chunk. Supporting renderers extract it
and use their normal loading path. Malformed lengths, duplicate capture chunks
or missing payloads fail clearly; native enhancement restores the poster. The
runtime waits for native image loading before fetching the capture, allowing a
cacheable response to be reused without transferring the complete file twice.
This is a second fetch call to the same URL, not a shared response buffer;
cache headers determine whether it causes revalidation or another transfer.
The image chunks precede the capture, allowing native poster paint while the
capture is still downloading. A Chrome screenshot regression verifies this with
the trailing capture withheld. Other browsers have not been qualified for early
paint. Measure poster LCP and first interactive 3D frame separately.

### Face and depth conventions

The six rectangles and depth-bound pairs use this order, in box-local coordinates:

| Index | Normal | Image right | Image up |
| --- | --- | --- | --- |
| 0 | +X | −Z | +Y |
| 1 | −X | +Z | +Y |
| 2 | +Y | +X | −Z |
| 3 | −Y | +X | +Z |
| 4 | +Z | +X | +Y |
| 5 | −Z | −X | +Y |

For a local point `q`, image coordinates are
`(dot(q, right) * .5 + .5, dot(q, up) * .5 + .5)` within the face rectangle.
Depth is `(1 - dot(q, normal)) * .5`: zero at the front plane and one at the
opposite plane. Its uint16 value is stored as high byte R and low byte G.
Atlas rows and rectangles use the image's top-to-bottom byte order; do not add
an implicit texture flip when writing a capture.

For PBR, color is `N×N`, or `2N×N` when `emission` is true (base color at left,
emission at right). Geometry is always `2N×N`: the left half holds depth R/G and
coverage B, and the right half holds opacity R with unused G/B set to zero.
Shading is `3N×2N`. Its six scalar tiles are octahedral normal X, normal Y,
roughness, occlusion, metalness and an unused zero tile, in row-major order.
Each scalar is repeated in R/G/B so luminance codecs preserve it. Baked color
is `N×N` radiance and has no shading image or separate emission pane.

Material attributes are coverage-premultiplied. Color/radiance is premultiplied
in linear space before sRGB encoding; scalar material and encoded-normal values
are multiplied by coverage. Depth bytes are not premultiplied. Coverage and
opacity are unorm8; depth/support/opacity must retain their exact bytes.
Octahedral normals use the standard L1 projection onto the octahedron, fold its
negative-Z hemisphere, then map XY from `[-1,1]` to `[0,1]` before premultiplying.

The format supplies data only. Decoders come from the application, never from
an asset-provided script, module URL or sidecar.


### Optional ground shadow

`element.groundShadow = true` enables a soft black footprint behind the capture.
The runtime caches one 64 x 64 mask from `display.support` per immutable capture
and projects it onto the lowest captured Y plane using the current camera.
It adds 4096 texture bytes per GPU asset; repeated views and camera changes reuse
that mask. Asset eviction/context recovery follow normal renderer ownership.
The default remains off. Captures without valid support have no footprint.

This is an approximate soft ground shadow: the convex projected footprint fills
holes and cannot reproduce separate contact points or self-shadowing. It does
not change lighting, build surface geometry, or run a shadow render each frame.
