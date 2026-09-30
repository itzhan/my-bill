"use client";

import { PlusCircleIcon } from "lucide-react";

import { Kbd } from "@/components/ui/kbd";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { useLedger } from "@/modules/ledger/provider";

// 左下角「记一笔」（同旧版侧栏底部），快捷键 N
export function NavQuickAdd() {
  const { openEntry } = useLedger();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          tooltip="记一笔（N）"
          onClick={() => openEntry()}
          className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground justify-center font-medium"
        >
          <PlusCircleIcon />
          <span>记一笔</span>
          <Kbd className="ml-auto bg-white/15 text-inherit group-data-[collapsible=icon]:hidden">N</Kbd>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
