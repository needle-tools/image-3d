/** Registers <img-3d>. Browser-only; static I3D1 captures; experimental format. */
export declare class Img3d extends HTMLElement {
  static observedAttributes: string[];
  /** Shared renderer usage. WebGPU is preferred (one device; `contexts` counts WebGL contexts only). Entry/byte limits apply to inactive assets; visible assets stay resident. */
  static readonly statistics: { backend:'webgpu'|'webgl2'|null; adapter:{vendor:string;architecture:string;description:string;fallback:boolean}|null; devices:number; canvasContexts:number; attachmentBytes:number; validationErrors:number; surfaceCaches:number; surfaceBytes:number; surfaceBuilds:number; surfaceReuses:number; viewRenders:number; contexts:number; assets:number; textureBytes:number; cachedBytes:number; activeAssets:number; inactiveAssets:number; activeTextureBytes:number; inactiveTextureBytes:number; activeCachedBytes:number; inactiveCachedBytes:number; renders:number; decodes:number; pending:number; fetching:number; entries:number; cpuBytes:number; gpuBytes:number };
  /** The single-file capture URL, including data URLs. */
  src: string;
  /** Uploaded texture payload; excludes driver overhead and raster canvases. */
  readonly textureBytes: number;
  readonly textureFormat: string | null;
  readonly transcodeMilliseconds: number;
  /** Live PBR key direction/intensity and hemisphere strength; baked captures ignore these. */
  get lighting(): {direction: number[]; intensity: number; ambient: number};
  set lighting(value: {direction?: [number, number, number]; intensity?: number; ambient?: number} | null);
  readonly canvas: HTMLCanvasElement;
  yaw: number;
  pitch: number;
  distance: number;
  /** Explicitly refresh and allow immediate canvas readback. */
  draw(): Promise<boolean>;
  /** Restore the initial orbit and zoom. */
  reset(): void;
}
declare global {
  interface HTMLElementTagNameMap { 'img-3d': Img3d; }
}

/** Registers a trusted application decoder; capture files never provide executable code. */
export declare function registerImg3dDecoder(decoder: {
  decode(bytes: Uint8Array, target: {width: number; height: number; astc: boolean; bptc: boolean}): Promise<{data: Uint8Array; width: number; height: number; format: string; internalFormat?: number; milliseconds: number}>;
  dispose(): void;
}): void;
