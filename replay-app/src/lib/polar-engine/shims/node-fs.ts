// Browser shim for Node's `fs` module. Vite aliases `fs` → this file in the
// Tauri static build so that `electron/polar-engine.ts` (vendor-copied from
// Aeolus) can be bundled without pulling in a real Node runtime.
//
// Replay UI code never calls `new PolarEngine()` — it uses `interpolateSpeed`
// and the parser facade in `pol-parser.ts` — so the stubs below are only ever
// reached if someone misuses the engine from the browser bundle, in which case
// a loud throw is the right behaviour.

const unavailable = (fn: string): never => {
  throw new Error(
    `fs.${fn} is not available in the Replay app browser bundle. ` +
      `Use the Tauri plugin-fs APIs for file access.`,
  );
};

export const existsSync = (): boolean => false;
export const mkdirSync = (): void => undefined;
export const readFileSync = (): string => unavailable('readFileSync');
export const writeFileSync = (): void => unavailable('writeFileSync');
export const copyFileSync = (): void => unavailable('copyFileSync');
export const renameSync = (): void => unavailable('renameSync');

export default {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  renameSync,
};
