# Notices

This repository is private. Package publication is disabled.

The standalone runtime and surface-search code were extracted from Needle's
Mesh Effects project and retain its [MIT notice](mesh-effects-MIT.txt).

Studio shading follows Three.js's IBL and ACES math. The compact RoomEnvironment
asset contains resampled PMREM and BRDF integration data. These retain the
[Three.js MIT notice](three-MIT.txt); Three.js is not a browser runtime dependency.

The optional XUASTC entry incorporates Basis Universal (Apache-2.0) and
Zstandard (BSD). Their source revision, build flags and artifact checksums are
pinned in `src/xuastc/source.json`; licenses and notices are beside that file
and embedded in the distributed decoder entry. The development-only Basis
transcoder under `tools/basis/` retains its upstream notice in the JavaScript.

The glTF format adapter, native conversion helpers, test metrics and demo tools
are Needle-authored code extracted for this standalone project.
