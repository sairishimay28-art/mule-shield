/**
 * MULE SHIELD Enterprise Cloud Deployment Configuration
 *
 * Configures the analytical backend API base URL for the browser application.
 *
 * In Local Development:
 *   Leave API_BASE_URL empty (""). The frontend will issue relative API requests
 *   to /api/..., seamlessly proxied by the local Node server to the local Python engine.
 *
 * In Cloud Static Hosting (e.g. Vercel, Netlify, Cloudflare Pages, Render Static):
 *   Set API_BASE_URL to your deployed Python backend URL, for example:
 *   API_BASE_URL: "https://mule-shield-backend.onrender.com"
 *
 * Note: You can also configure this dynamically during CI/CD build via
 * the MULE_SHIELD_API_URL environment variable (npm run build).
 */
window.__MULE_SHIELD_CONFIG__ = Object.assign(
  {
    API_BASE_URL: ""
  },
  window.__MULE_SHIELD_CONFIG__ || {}
);
