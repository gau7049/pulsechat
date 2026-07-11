import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // The API's CORS allowlist is pinned to this origin — fail loudly rather
    // than silently drifting to 5174+ when the port is taken.
    strictPort: true,
  },
});
