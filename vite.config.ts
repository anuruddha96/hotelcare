import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";


// Emit a no-store-polled release marker with every production build. Old open
// tabs can compare their embedded build ID without contacting Supabase.
const hotelCareBuildId = process.env.VITE_HOTELCARE_BUILD_ID
  || process.env.GITHUB_SHA
  || String(Date.now());
const releaseJson = JSON.stringify({ buildId: hotelCareBuildId });
const hotelCareReleasePlugin = () => ({
  name: 'hotelcare-release-marker',
  generateBundle(this: { emitFile: (file: { type: 'asset'; fileName: string; source: string }) => void }) {
    this.emitFile({ type: 'asset', fileName: 'hotelcare-release.json', source: releaseJson });
  },
  configureServer(server: { middlewares: { use: (path: string, cb: (_req: unknown, res: { setHeader: (name: string, value: string) => void; end: (body: string) => void }) => void) => void } }) {
    server.middlewares.use('/hotelcare-release.json', (_req, res) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(releaseJson);
    });
  },
});

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  define: { __HOTELCARE_BUILD_ID__: JSON.stringify(hotelCareBuildId) },
  plugins: [
    react(),
    hotelCareReleasePlugin(),
    mode === 'development' &&
    componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: [
      // Keep the mature housekeeping components unchanged and layer the new
      // physical-map controls/preload around them. Relative imports inside the
      // wrappers intentionally bypass these exact aliases.
      {
        find: /^@\/components\/dashboard\/HotelFloorMap$/,
        replacement: path.resolve(__dirname, "./src/overrides/HotelFloorMapSpatialOverride.tsx"),
      },
      {
        find: /^@\/components\/dashboard\/MemoriesZoneAutoAssignment$/,
        replacement: path.resolve(__dirname, "./src/overrides/MemoriesZoneAutoAssignmentSpatialOverride.tsx"),
      },
      { find: "@", replacement: path.resolve(__dirname, "./src") },
    ],
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    // `force: true` re-optimized dependencies on every dev-server start, which
    // changed the ?v= hash of every dep chunk. An open tab then mixed old and
    // new chunks — two React copies in one tree ("dispatcher.useEffect" of
    // null) or a failed module import. Let Vite reuse its cache.
    include: ["react", "react-dom", "react/jsx-runtime"],
  },
}));
