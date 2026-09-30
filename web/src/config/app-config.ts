import packageJson from "../../package.json";

const currentYear = new Date().getFullYear();

export const APP_CONFIG = {
  name: "Liusai Admin",
  version: packageJson.version,
  copyright: `© ${currentYear}, Liusai Admin.`,
  url: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  locale: "zh-CN",
  meta: {
    title: "Liusai Admin",
    description: "统一管理后台：元启智能账单系统等业务模块。",
    keywords: ["管理后台", "账单", "记账"],
  },
};
