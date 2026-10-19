import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: false,
  // المرحلة 8: كروميوم خادمي لتوليد PDF — نُبقي الحزم خارج حزمة الباندل
  // ويُضمَّن مجلد @sparticuz/chromium كاملًا (الثنائية المضغوطة chromium.br)
  // في تتبع ملفات الـserverless وإلا فشل executablePath() على Vercel.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: {
    "/api/statement/contract/[id]/pdf": ["./node_modules/@sparticuz/chromium/**/*"],
    "/api/statement/customer/[id]/pdf": ["./node_modules/@sparticuz/chromium/**/*"],
  },
};

export default nextConfig;
