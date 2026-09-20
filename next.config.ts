import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "tweetnacl"],
};

export default nextConfig;
