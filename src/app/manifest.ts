import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Aster — Paper Trading",
    short_name: "Aster",
    description: "An iPhone-first paper trading dashboard prototype.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f7f5",
    theme_color: "#f5f7f5",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
