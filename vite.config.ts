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
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
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
