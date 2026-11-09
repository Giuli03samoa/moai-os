import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MOAI OS",
    short_name: "MOAI OS",
    description: "Il sistema operativo di MOAI Athletics",
    start_url: "/",
    display: "standalone",
    background_color: "#222222",
    theme_color: "#222222",
    lang: "it",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
