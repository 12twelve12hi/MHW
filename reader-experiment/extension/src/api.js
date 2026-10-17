// The extension API: Safari (and Firefox) expose promise-based `browser`, Chrome exposes `chrome` (promise-based in MV3).
export const api = globalThis.browser ?? globalThis.chrome;
