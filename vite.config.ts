import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === 'development' &&
    componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: [
      // Keep the shared assignment algorithm untouched for other runtimes, but
      // let the dashboard use the Hotel Memories operational-section adapter.
      // The adapter delegates straight back to the base algorithm for every
      // hotel that is not Hotel Memories Budapest.
      {
        find: "@/lib/roomAssignmentAlgorithm",
        replacement: path.resolve(__dirname, "./src/lib/roomAssignmentAlgorithmMapped.ts"),
      },
      {
        find: "@",
        replacement: path.resolve(__dirname, "./src"),
      },
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
