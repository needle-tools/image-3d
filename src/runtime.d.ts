/** Registers <img-3d>. Browser-only; static I3D1 captures; experimental format. */
export declare class Img3d extends HTMLElement {
  static observedAttributes: string[];
  /** Shared renderer usage. WebGPU is preferred (one device; `contexts` counts WebGL contexts only). Entry/byte limits apply to inactive assets; visible assets stay resident. */
  static readonly statistics: { backend:'webgpu'|'webgl2'|null; adapter:{vendor:string;architecture:string;description:string;fallback:boolean}|null; devices:number; canvasContexts:number; attachmentBytes:number; environmentBytes:number; validationErrors:number; surfaceCaches:number; surfaceBytes:number; surfaceBuilds:number; surfaceReuses:number; viewRenders:number; contexts:number; assets:number; textureBytes:number; cachedBytes:number; activeAssets:number; inactiveAssets:number; activeTextureBytes:number; inactiveTextureBytes:number; activeCachedBytes:number; inactiveCachedBytes:number; renders:number; decodes:number; pending:number; fetching:number; entries:number; cpuBytes:number; gpuBytes:number };
  /** The single-file capture URL, including data URLs. */
  src: string;
  /** Candidate widths are converter-measured usable frame pixels, not atlas sizes. */
  srcset: string;
  readonly currentSrc: string;
  /** Reflects data-orbit-fit: keep capture framing fixed by default, or opt into auto framing to avoid clipping during orbit. */
  orbitFit: 'auto' | 'fixed';
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  width: number;
  height: number;
  alt: string;
  /** Uploaded texture payload; excludes driver overhead and raster canvases. */
  readonly textureBytes: number;
  readonly textureFormat: string | null;
  readonly transcodeMilliseconds: number;
  /** Live PBR lighting. The optional studio path uses ACES and up to three colored lights; baked captures ignore lighting. Environment data is immutable and shared across elements. */
  get lighting(): {direction: number[]; intensity: number; ambient: number; lights?: Array<{direction:number[];color:number[];intensity:number}>;environment?:Img3dEnvironment;environmentIntensity?:number};
  set lighting(value: {direction?: [number, number, number]; intensity?: number; ambient?: number;lights?:Array<{direction:[number,number,number];color?:[number,number,number];intensity?:number}>;environment?:Img3dEnvironment;environmentIntensity?:number} | null);
  readonly canvas: HTMLCanvasElement;
  yaw: number;
  pitch: number;
  distance: number;
  /** After load, establish fixed padded framing from captured surface bounds. Does not refit during orbit. */
  fitToBounds(options?: {aspect?:number;fov?:number;padding?:number}): number;
  /** Apply the requested pose immediately, finish camera easing, and allow canvas readback. */
  draw(): Promise<boolean>;
  /** Restore the initial orbit and zoom. */
  reset(): void;
}
/** Six octahedral roughness slices followed by a 16×16 BRDF integration table, linear RGBA16F. */
export interface Img3dEnvironment {size:number;levels:number;data:Uint16Array}
declare global {
  interface HTMLElementTagNameMap { 'img-3d': Img3d; }
}

/** Registers a trusted application decoder; capture files never provide executable code. */
export declare function registerImg3dDecoder(decoder: {
  decode(bytes: Uint8Array, target: {width: number; height: number; astc: boolean; bptc: boolean}): Promise<{data: Uint8Array; width: number; height: number; format: string; internalFormat?: number; milliseconds: number}>;
  dispose(): void;
}): void;

/** Enhance a native WebP img/picture using currentSrc and the img's data-orbit-fit attribute; disconnect restores the original image. */
export declare function enhanceImage(target:HTMLImageElement|HTMLPictureElement):{image:HTMLImageElement;element:Img3d;disconnect():void};
