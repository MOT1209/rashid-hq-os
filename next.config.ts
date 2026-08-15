import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `pg` is a native-ish driver used by Better Auth; keep it out of the bundle.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
