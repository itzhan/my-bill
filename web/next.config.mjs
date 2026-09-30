/** @type {import('next').NextConfig} */
// 各业务后端独立运行，前端同源代理过去（Cookie、下载链接、SSE 都能原样透传）
const LEDGER_API_URL = (process.env.LEDGER_API_URL || "http://127.0.0.1:3300").replace(/\/+$/, "");

const nextConfig = {
  output: "standalone",
  reactCompiler: true,
  // 关闭压缩，避免 SSE（/ledger/api/events）被缓冲
  compress: false,
  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
  },
  experimental: {
    // Next 16 默认把开发编译结果持久化到 .next/dev/cache；在本机上每次写盘要 70 秒以上并拖垮整机，关掉
    turbopackFileSystemCacheForDev: false,
    // 构建时最多 2 个 worker，避免吃满内存
    cpus: 2,
    optimizePackageImports: ["lucide-react", "date-fns", "radix-ui", "recharts"],
  },
  async redirects() {
    return [
      {
        source: "/dashboard",
        destination: "/dashboard/ledger",
        permanent: false,
      },
      {
        // 导出记录已并入报表页
        source: "/dashboard/ledger/exports",
        destination: "/dashboard/ledger/reports?tab=exports",
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/ledger/api/:path*",
        destination: `${LEDGER_API_URL}/api/:path*`,
      },
      {
        // 旧地址兼容：外部系统仍按 /api/integrations/* 调对外接口
        source: "/api/:path*",
        destination: `${LEDGER_API_URL}/api/:path*`,
      },
    ];
  },
}

export default nextConfig
