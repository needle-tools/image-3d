These stable source pointers and checksum manifests record the original models
used for the captured fixtures and source references. They are provenance data,
not build dependencies. The checked-in `../captures/` GLBs are the converter's
actual inputs. The runtime and tests do not fetch a producer or these originals.
