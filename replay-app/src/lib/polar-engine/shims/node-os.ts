// Browser shim for Node's `os` module. See node-fs.ts for context.

export const homedir = (): string => '';
export const platform = (): string => 'browser';

export default { homedir, platform };
