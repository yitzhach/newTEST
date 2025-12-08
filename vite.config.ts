import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Assuming deployment to a root domain or standard GitHub Pages.
  // If deploying to https://<USERNAME>.github.io/<REPO>/, uncomment the line below and replace <REPO>:
  // base: '/<REPO>/', 
});