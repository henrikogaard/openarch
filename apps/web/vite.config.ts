import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  server: { port: 5173 },
  build: {
    chunkSizeWarningLimit: 750,
    rollupOptions: {
      output: {
        // Split vendor code out; lazy tabs (AI, enrichment/IaC) become their
        // own async chunks automatically via React.lazy.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/(react|react-dom|scheduler|@xyflow)\//.test(id)) return 'vendor-react';
          return 'vendor';
        },
      },
    },
  },
});
