import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sin esto Turbopack sube hasta el home buscando el lockfile y lo ignora.
  turbopack: { root: __dirname },
  /* config options here */
};

export default nextConfig;
