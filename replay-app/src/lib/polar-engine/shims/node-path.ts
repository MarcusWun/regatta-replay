// Browser shim for Node's `path` module. See node-fs.ts for context.

export const join = (...parts: string[]): string =>
  parts.filter((p) => p && p.length > 0).join('/');

export const dirname = (p: string): string => {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(0, i) : '';
};

export const extname = (p: string): string => {
  const m = /\.[^./]+$/.exec(p);
  return m ? m[0] : '';
};

export const basename = (p: string): string => {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
};

export default { join, dirname, extname, basename };
