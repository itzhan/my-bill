"use client";

import { useMemo, useState } from "react";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ChevronDown, ChevronRight, FolderPlus, Plus } from "lucide-react";

import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { money, signed } from "@/modules/ledger/format";
import { useProjects } from "@/modules/ledger/hooks";
import { useLedger } from "@/modules/ledger/provider";
import type { ProjectWithSummary } from "@/modules/ledger/types";

type SectionKey = "relay" | "key" | "short" | "company";

const SECTIONS: { key: SectionKey; label: string; dot: string; alwaysShow?: boolean }[] = [
  { key: "relay", label: "中转", dot: "bg-sky-500", alwaysShow: true },
  { key: "key", label: "上key", dot: "bg-violet-500", alwaysShow: true },
  { key: "short", label: "项目制", dot: "bg-amber-500", alwaysShow: true },
  { key: "company", label: "公司日常", dot: "bg-slate-400" },
];

// 流水金额 = 已记账收入 + 已记账支出（折合人民币）
const projectFlow = (p: ProjectWithSummary) => (p.summary.income.base || 0) + (p.summary.expense.base || 0);

// 次级参考规模：尚无现金流水时按应收 + 应付往来规模排序
const projectVolume = (p: ProjectWithSummary) => Math.abs(p.receivable ?? 0) + Math.abs(p.payable ?? 0);

function sectionOf(p: ProjectWithSummary): SectionKey {
  if (p.category === "company") return "company";
  if (p.ptype === "key") return "key";
  if (p.ptype === "short") return "short";
  return "relay";
}

function compareByFlow(a: ProjectWithSummary, b: ProjectWithSummary) {
  const diff = projectFlow(b) - projectFlow(a);
  if (Math.abs(diff) > 0.005) return diff;
  const volDiff = projectVolume(b) - projectVolume(a);
  if (Math.abs(volDiff) > 0.005) return volDiff;
  return (b.summary.last_at ?? b.created_at).localeCompare(a.summary.last_at ?? a.created_at);
}

// 快速记账：按 中转 / 上key / 项目制（及公司日常）分区，区内按流水金额从高到低排序
export function NavProjects() {
  const path = usePathname();
  const { openEntry, openProject } = useLedger();
  const { data } = useProjects();
  const [collapsed, setCollapsed] = useState<Partial<Record<SectionKey, boolean>>>({});

  const { activeCount, grouped } = useMemo(() => {
    const active = (data?.projects ?? []).filter((p) => !p.archived);
    const buckets: Record<SectionKey, ProjectWithSummary[]> = {
      relay: [],
      key: [],
      short: [],
      company: [],
    };
    for (const p of active) {
      buckets[sectionOf(p)].push(p);
    }
    for (const list of Object.values(buckets)) {
      list.sort(compareByFlow);
    }
    return { activeCount: active.length, grouped: buckets };
  }, [data]);

  const toggleSection = (key: SectionKey) =>
    setCollapsed((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));

  const visibleSections = SECTIONS.filter((s) => s.alwaysShow || grouped[s.key].length > 0);

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>快速记账</SidebarGroupLabel>
      <SidebarGroupAction title="新建项目" onClick={() => openProject()}>
        <FolderPlus />
        <span className="sr-only">新建项目</span>
      </SidebarGroupAction>

      {data && activeCount === 0 ? (
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => openProject()} className="text-muted-foreground">
              <FolderPlus />
              <span>新建第一个项目</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      ) : (
        <div className="space-y-2">
          {visibleSections.map((sec) => {
            const items = grouped[sec.key];
            const isCollapsed = !!collapsed[sec.key];
            const hasItems = items.length > 0;
            return (
              <div key={sec.key} className="space-y-0.5">
                <button
                  type="button"
                  onClick={() => hasItems && toggleSection(sec.key)}
                  className={cn(
                    "text-muted-foreground flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                    hasItems ? "hover:bg-sidebar-accent/50 hover:text-sidebar-foreground cursor-pointer" : "opacity-60",
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", sec.dot)} />
                  <span className="truncate">{sec.label}</span>
                  <span className="text-muted-foreground/70 tabular-nums">{items.length}</span>
                  {hasItems ? (
                    isCollapsed ? (
                      <ChevronRight className="ml-auto h-3 w-3 opacity-60" />
                    ) : (
                      <ChevronDown className="ml-auto h-3 w-3 opacity-60" />
                    )
                  ) : null}
                </button>
                {hasItems && !isCollapsed ? (
                  <SidebarMenu>
                    {items.map((p) => {
                      const url = `/dashboard/ledger/projects/${p.id}`;
                      const flow = projectFlow(p);
                      const title = `${p.name} · 流水 ${money(flow)}（收 ${money(p.summary.income.base)} / 支 ${money(p.summary.expense.base)} · 利润 ${signed(p.summary.profit)}）`;
                      return (
                        <SidebarMenuItem key={p.id}>
                          <SidebarMenuButton asChild isActive={path === url} tooltip={p.name}>
                            <Link prefetch={false} href={url} title={title}>
                              <span className="truncate">{p.name}</span>
                            </Link>
                          </SidebarMenuButton>
                          <SidebarMenuBadge
                            className={cn(
                              "font-normal tabular-nums max-md:hidden md:group-hover/menu-item:opacity-0",
                              flow > 0 ? "text-muted-foreground" : "text-muted-foreground/50",
                            )}
                          >
                            {money(flow)}
                          </SidebarMenuBadge>
                          <SidebarMenuAction
                            showOnHover
                            title={`在「${p.name}」记一笔`}
                            onClick={() => openEntry({ projectId: p.id })}
                          >
                            <Plus />
                            <span className="sr-only">记一笔</span>
                          </SidebarMenuAction>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </SidebarGroup>
  );
}
