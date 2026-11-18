import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Partner logo uploads (Members -> Partner venues) are resized on the
      // server, so allow a phone photo through. Vercel caps requests at 4.5MB.
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
