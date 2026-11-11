# Image 3D

A dependency-free `<img-3d>` custom element for compact, single-file 3D captures.
WebGPU is preferred, with a WebGL fallback. Many elements share one renderer;
scrolling, clipping and stacking remain native browser behavior.

The runtime, converter, format and comparison page live here. This repository
has no dependency on Baker or Mesh Effects. A producer exports a
`NEEDLE_box_impostor` GLB; the converter packs its captures into `.i3d` or a WebP
with a native poster and embedded capture. Producers can also write the documented format directly.

## Run the comparison

Node 22+, npm and Chrome are needed for development and browser checks.

```sh
npm ci
npm run dev
```

Open the printed URL, normally `http://localhost:4200/`. The repository includes
the five-model demo at 512 and 1024, live/baked lighting, native/XUASTC variants,
32-view WebP comparisons and source references. No producer checkout or source
asset download is needed to run it. Generated runtime bundles are copied into
the demo when starting it.

**Reference** compares the 3D capture with the existing **32 WebP views** at the
selected resolution. Drag either pane horizontally, or use its arrow keys, to
rotate both views at matching cameras and a fixed elevation. Selecting **32 WebP
views** under Appearance shows that same turntable on its own.

**Auto** resolution selects between the 512 and 1024 captures using measured
usable resolution, element size, pixel density and zoom. **Native image** uses
the WebP poster and native image enhancement for the single view. Both paths use
the same renderer. Measurements includes the converter's **Usable width**.

The address follows the demo settings and camera, so copying it reproduces the
view. For example, `?model=watch&resolution=1024&appearance=pbr&light=1` opens
the watch with moving lights. `native`, `grid`, `reference`, `follow` and `measurements`
accept `1` or `0`; `size` sets the grid item width, and `yaw`, `pitch` and
`distance` set the camera. Default values are omitted. Browser Back and Forward
restore control changes. Grid cursor-following and temporary drag gestures
remain local to the page.
Use `resolution=auto&native=1` to share an automatically selected native image.

**Live light** uses a compact capture of the same RoomEnvironment PMREM and ACES
tone mapping as **Baked studio**. **Move light** adds three fast, saturated red,
blue and magenta lights orbiting the product; turning it off restores the studio environment.
The environment is shared across elements (about 35 KB compressed, 72 KB on the
GPU). Six-view baked reflections remain an approximation of live reflections.

`demo/public/` has one folder per model, resolution and representation:

```text
owl-512-i3d/
  live.i3d
  live-xuastc.i3d
  baked.i3d
  baked-xuastc.i3d
  live.webp
  live-xuastc.webp
  baked.webp
  baked-xuastc.webp
owl-512-32views/
  model.json
  view-0.webp
  …
owl-1024-i3d/
owl-1024-32views/
watch-512-i3d/
watch-512-32views/
…
runtime/
```

The same layout applies to all five models at both resolutions. Folders ending
in `-32views` hold source-rendered WebP turntables; `runtime/` contains generated JavaScript.
Full-quality PNGs and lossless captures live in `tests/fixtures/quality/` for
automated quality checks and are excluded from the deployed demo.
Browser-test screenshots stay under `.local/test-results/demo/`.

The demo uses the [Needle Brand System](https://brand.needle.tools/) dark palette
and a local Nunito Sans Latin variable font from
[Google Fonts](https://fonts.google.com/specimen/Nunito+Sans), licensed under
[SIL OFL 1.1](demo/fonts/OFL.txt).

## Use the runtime

After building, load one JavaScript file:

```html
<script type="module" src="./dist/img-3d.js"></script>
<img-3d src="model.i3d" style="width:300px;height:300px"></img-3d>
```

The optional `dist/img-3d-xuastc.js` entry includes the decoder and WASM in the
same file. The package exports are `@needle-tools/image-3d` and
`@needle-tools/image-3d/xuastc`. The package and repository are private for now;
no npm publication is required to use the built files.

Both backends keep twelve triangles per box. Surface reconstruction stays in
the shader. There are no generated surface meshes or geometry LODs. Automatic
updates compare source, camera, size and lighting state; unchanged views stay
idle. Explicit `draw()` refreshes the canvas for immediate pixel readback.
Drag rotation eases briefly into place. On first load, the displayed camera starts
at the poster pose and reaches a preconfigured orbit in about 0.3 seconds.
Reduced-motion preferences skip these transitions; `draw()` immediately applies
the requested pose. Settled and offscreen elements do not keep animating.

Responsive sources use converter-measured frame widths, not atlas sides:

```html
<style>img-3d{display:inline-block;width:100%;max-width:400px;aspect-ratio:116/218}</style>
<img-3d src="owl-512.i3d"
  srcset="owl-512.i3d 464w, owl-1024.i3d 956w"
  width="464" height="872" alt="Owl" style="height:auto"></img-3d>
```

The critical style reserves space before JavaScript runs. The component supports
`orbit-fit="fixed"` (or `element.orbitFit = 'fixed'`) to keep a constant scale
while rotating. The default is `auto`, which widens the frame to avoid clipping.
Fixed framing can clip wider views unless the capture has sufficient margin.

The component supports
`object-fit` and `object-position`, preserves its current view while loading a
responsive upgrade, and keeps camera interaction live during that download.
Shrinking or zooming out retains a loaded higher-resolution candidate.
The dimensions above describe newly framed owl captures; use conversion metadata
for other captures and older files. Conversion prints each capture's display
metadata. New captures use a measured
content frame with a small orbit margin, so portrait and landscape objects have
appropriate intrinsic dimensions. The same frame drives the poster and 3D view;
extreme orbit angles can widen it to preserve the whole object. Older captures
retain their recorded framing; packaging them as WebP measures the new frame.

For native browser image loading, sizing and fallback, use a WebP package:

```html
<style>
picture[data-img-3d]{display:block;position:relative;max-width:400px}
picture[data-img-3d] img{display:block;width:100%;height:auto}
</style>
<picture data-img-3d>
  <img src="owl-512.webp" width="464" height="872" alt="Owl"
    srcset="owl-512.webp 464w, owl-1024.webp 956w"
    sizes="(max-width:400px) 100vw, 400px">
</picture>
```

The same runtime automatically enhances opted-in pictures and images. The native
poster remains the layout anchor and works without JavaScript; printing uses
the poster too. `enhanceImage(imageOrPicture)` provides the same behavior
programmatically and returns `{image, element, disconnect}`. Its `element` is
the ordinary `Img3d` API; `disconnect()` restores the native image. Direct image
enhancement adds a wrapper; an authored picture keeps the layout structure explicit.
The browser owns source selection: the 3D overlay follows the image's `currentSrc`,
including its decision to retain a cached higher-resolution candidate. Camera zoom
does not select another file in this mode.
The poster comes first in the WebP and can paint before the embedded 3D payload
arrives; this is verified in Chrome. The overlay waits for the complete package.
Its fetch reads that same URL through the HTTP cache; cache headers determine
whether this requires revalidation or another transfer.

Studio lighting filters subpixel normal detail into the specular roughness and
resolves silhouette and color edges in a small postprocess. Lighting updates
reuse captured intersections; anti-aliasing does not retrace the surface.

## Convert a capture

The input must already contain fitted captures in `NEEDLE_box_impostor` version
1. This tool does not decompose raw meshes. The current converter accepts the
original, uncompressed PNG capture maps and requires animated inputs to be frozen.

```sh
npm run convert -- capture.glb output
npm run validate -- output --dense
```

Conversion measures the finer visible reconstruction detail across the orbit,
including raster sampling for contours, and writes `display` metadata into
each capture and its metrics. Add `--webp` to also create `model.webp`, or package
an existing capture without rebaking or fitting:

```sh
node tools/package-image.mjs capture.i3d capture.webp
```

This renders the poster through the shipped WebGPU viewer and prints the measured
dimensions and `srcset` descriptor. Use `--xuastc` for a GPU-compressed capture,
or `--poster image.webp` to supply a poster. Image services must pass the complete
WebP through: re-encoding can strip the embedded 3D data, leaving a normal poster.
When the input GLB declares the standard glTF `asset.thumbnail` image, conversion
preserves it as `source-thumbnail.webp` and uses it for `--webp` packaging when
it has enough pixels for the measured frame. Smaller thumbnails remain available
as source data; the poster is rendered from the capture instead of enlarged.
The full source image is retained in that file. The packaged poster trims
transparent margins and is resized to the measured 3D frame dimensions, so its
actual pixel width and the capture's effective detail agree for native `srcset`.
Generated posters use one render at the calculated dimensions and one quality-85
WebP encode with lossless alpha. The validation suite checks the fitted raster
against an equally compressed live view at 2× display density and reports codec
error separately. Conversion reads compatible glTF 2.1 assets declaring
`minVersion: "2.0"` as well as ordinary 2.0 input.

The packaged WebP's actual width is its native `srcset` descriptor and equals
`display.effectiveWidth`. Authored thumbnails can use a different pose or lighting; the standard does not guarantee
a pixel-identical handoff to the 3D view.

Supplied posters should match the reference camera, content frame and dimensions
in the capture's `display` metadata.

For studio-baked radiance, install Node's optional native WebGPU host first:

```sh
npm run gpu:install
npm run convert -- capture.glb output --baked
```

Native codecs use Sharp. Optional XUASTC encoding uses a separately installed
Basis Universal encoder; the browser runtime needs neither tool:

```sh
node tools/xuastc.mjs output compressed-output /path/to/basisu
node tools/validate.mjs compressed-output --dense
```

`npm run matrix` qualifies the checksum-pinned capture fixtures into
`.local/matrix/`. It takes `--inputs`, `--models`, `--sizes`, `--profiles` and
`--basisu`. It consumes captured GLBs and never calls a producer. The committed
comparison data is independent of this qualification output.

## Format and checks

See [the capture format and runtime API](docs/format.md),
[measured results](docs/measurements.md) and [third-party notices](LICENSES/README.md).

```sh
npm test
npm run test:native  # after npm run gpu:install
```

Browser/GPU tests run sequentially. They retain the existing source-quality
baselines, scalar shader oracle, transparency, device-loss, scrolling, 120-element
and independent-lighting regressions. Test fixtures and demo captures are checked
in; temporary captures, logs and research data stay under ignored `.local/`.

`src/` owns the runtime; `tools/` owns conversion and qualification; `demo/` owns
the one comparison page. The npm artifact contains only the built runtimes,
types and notices. Development renderers and authoring libraries are not runtime
dependencies.

The optional source-WebP tool accepts ordinary GLBs; the source and capture must
share world coordinates. The committed demo needs no regeneration.

```sh
node tools/turntable.mjs source.glb capture.glb output-directory 512
node tools/unique-pool.mjs
node tools/one-scene.mjs --modes elements --pose rotate
node tools/one-scene.mjs --modes elements --pose stationary --lighting presentation
```

The last two commands derive 120 unique capture variants and measure their real
canvas updates. Generated pools and benchmark results stay under `.local/`.
`grid-performance.mjs` and `render-cost.mjs` are WebGL-only diagnostics.
