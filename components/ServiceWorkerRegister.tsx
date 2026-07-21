"use client";

import { useEffect } from "react";

// Registered in production only — the service worker's caching interferes
// with `next dev`'s hot reload, so test PWA/offline behavior against a
// production build (`npm run build && npm start`), not the dev server.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("Service worker registration failed:", err);
    });
  }, []);

  return null;
}
