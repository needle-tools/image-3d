# Image 3D

A dependency-free `<img-3d>` custom element for compact, single-file 3D captures.
WebGPU is preferred, with a WebGL fallback. Many elements share one renderer;
scrolling, clipping and stacking remain native browser behavior.

The runtime, converter, format and comparison page live here. This repository
has no dependency on Baker or Mesh Effects. A producer exports a
`NEEDLE_box_impostor` GLB; the converter packs its captures into `.i3d`. Producers
can also write the documented `.i3d` format directly.

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

`demo/public/` has one folder per model, resolution and representation:

```text
owl-512-i3d/
  live.i3d
  live-xuastc.i3d
  baked.i3d
  baked-xuastc.i3d
  baked-lossless.i3d
  reference/
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

The same layout applies to all five models at both resolutions. The lossless
baked capture and reference PNGs support quality comparisons. Folders ending
in `-32views` hold source-rendered WebP turntables; `runtime/` contains generated JavaScript.
Browser-test screenshots stay under `.local/test-results/demo/`.

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

## Convert a capture

The input must already contain fitted captures in `NEEDLE_box_impostor` version
1. This tool does not decompose raw meshes. The current converter accepts the
original, uncompressed PNG capture maps and requires animated inputs to be frozen.

```sh
npm run convert -- capture.glb output
npm run validate -- output --dense
```

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
```

The last two commands derive 120 unique capture variants and measure their real
canvas updates. Generated pools and benchmark results stay under `.local/`.
`grid-performance.mjs` and `render-cost.mjs` are WebGL-only diagnostics.
