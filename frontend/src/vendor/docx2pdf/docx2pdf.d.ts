/* tslint:disable */
/* eslint-disable */

export class Converter {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Returns PDF bytes. Warnings via lastWarnings-style: joined by \n in the error-free path.
     */
    convert(docx: Uint8Array | number[]): Uint8Array;
    constructor();
    /**
     * Register fallback font data for multi-lingual and non-Latin scripts
     */
    registerFallbackFont(data: Uint8Array | number[]): void;
    /**
     * Register font variants: 'regular' (or default), 'bold', 'italic', 'bold-italic'
     */
    registerFont(variant: string, data: Uint8Array | number[]): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_converter_free: (a: number, b: number) => void;
    readonly converter_convert: (a: number, b: number, c: number) => [number, number, number, number];
    readonly converter_new: () => number;
    readonly converter_registerFallbackFont: (a: number, b: number, c: number) => void;
    readonly converter_registerFont: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
