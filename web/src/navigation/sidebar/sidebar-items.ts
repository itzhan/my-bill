import {
  LayoutDashboard,
  FolderKanban,
  ChartColumn,
  Truck,
  Bot,
  BookOpen,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavSubItem {
  title: string;
  url: string;
  icon?: LucideIcon;
  comingSoon?: boolean;
  newTab?: boolean;
  isNew?: boolean;
}

export interface NavMainItem {
  title: string;
  url: string;
  icon?: LucideIcon;
  subItems?: NavSubItem[];
  comingSoon?: boolean;
  newTab?: boolean;
  isNew?: boolean;
}

export interface NavGroup {
  id: number;
  label?: string;
  items: NavMainItem[];
}

export const sidebarItems: NavGroup[] = [
  {
    id: 1,
    label: "元启账单",
    items: [
      { title: "总览", url: "/dashboard/ledger", icon: LayoutDashboard },
      { title: "项目", url: "/dashboard/ledger/projects", icon: FolderKanban },
      { title: "供应商", url: "/dashboard/ledger/suppliers", icon: Truck },
      { title: "报表与导出", url: "/dashboard/ledger/reports", icon: ChartColumn },
    ],
  },
  {
    id: 2,
    label: "AI",
    items: [
      { title: "AI 助手", url: "/dashboard/ledger/assistant", icon: Bot },
      { title: "知识库", url: "/dashboard/ledger/knowledge", icon: BookOpen },
    ],
  },
  {
    id: 3,
    label: "系统",
    items: [{ title: "设置", url: "/dashboard/ledger/settings", icon: Settings }],
  },
];
