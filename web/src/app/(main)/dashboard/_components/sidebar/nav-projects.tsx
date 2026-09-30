"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { FolderPlus, Plus } from "lucide-react";

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
import { signed } from "@/modules/ledger/format";
import { useProjects } from "@/modules/ledger/hooks";
import { useLedger } from "@/modules/ledger/provider";

const MAX = 10;

// 快速记账：进行中的项目按最近记账排序，点名字进项目，点「+」直接在该项目下记一笔
export function NavProjects() {
  const path = usePathname();
  const { openEntry, openProject } = useLedger();
  const { data } = useProjects();
  const active = (data?.projects ?? [])
    .filter((p) => !p.archived)
    .sort((a, b) => (b.summary.last_at ?? b.created_at).localeCompare(a.summary.last_at ?? a.created_at));
  const shown = active.slice(0, MAX);

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>快速记账</SidebarGroupLabel>
      <SidebarGroupAction title="新建项目" onClick={() => openProject()}>
        <FolderPlus />
        <span className="sr-only">新建项目</span>
      </SidebarGroupAction>
      <SidebarMenu>
        {shown.map((p) => {
          const url = `/dashboard/ledger/projects/${p.id}`;
          return (
            <SidebarMenuItem key={p.id}>
              <SidebarMenuButton asChild isActive={path === url} tooltip={p.name}>
                <Link prefetch={false} href={url}>
                  <span className="truncate">{p.name}</span>
                </Link>
              </SidebarMenuButton>
              <SidebarMenuBadge
                className={cn(
                  "font-normal tabular-nums max-md:hidden md:group-hover/menu-item:opacity-0",
                  p.summary.profit < 0 ? "text-expense" : "text-muted-foreground",
                )}
              >
                {signed(p.summary.profit)}
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
        {data && !active.length ? (
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => openProject()} className="text-muted-foreground">
              <FolderPlus />
              <span>新建第一个项目</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : null}
        {active.length > MAX ? (
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="text-muted-foreground">
              <Link prefetch={false} href="/dashboard/ledger/projects">
                <span>全部项目（{active.length}）</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : null}
      </SidebarMenu>
    </SidebarGroup>
  );
}
