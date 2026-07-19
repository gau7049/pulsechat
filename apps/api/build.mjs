// Production build: bundle the API (plus the TS-only @pulsechat/shared workspace
// package) into a single plain-JS file so production runs on `node` instead of
// `tsx`. Running via tsx transpiles the whole source graph at startup and keeps
// esbuild resident — enough overhead, on top of Prisma/Socket.IO/native argon2,
// to push a cold start past Render's 512 MB free-tier limit. `node dist/index.js`
// has none of that transpile machinery in memory.
import { build } from 'esbuild';

/**
 * Keep everything in node_modules external (Node loads it at runtime); bundle
 * only our own source. The one exception is @pulsechat/shared, which ships raw
 * TypeScript with no compiled output, so Node can't resolve it on its own — it
 * must be inlined here.
 */
const externalizeDeps = {
  name: 'externalize-deps',
  setup(pluginBuild) {
    // Bare specifiers (not starting with '.' or '/') come from node_modules.
    pluginBuild.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path === '@pulsechat/shared' || args.path.startsWith('@pulsechat/shared/')) {
        return; // undefined → let esbuild resolve and bundle the workspace source
      }
      return { path: args.path, external: true };
    });
  },
};

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  logLevel: 'info',
  plugins: [externalizeDeps],
});
