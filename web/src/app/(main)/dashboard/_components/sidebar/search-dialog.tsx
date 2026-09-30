"use client";
import * as React from "react";

import { useRouter } from "next/navigation";

import { FolderKanban, Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useProjects } from "@/modules/ledger/hooks";
import { useLedger } from "@/modules/ledger/provider";
import { sidebarItems } from "@/navigation/sidebar/sidebar-items";

export function SearchDialog() {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const { openEntry } = useLedger();
  const { data } = useProjects();

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "j" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const go = (url: string) => {
    setOpen(false);
    router.push(url);
  };

  return (
    <>
      <Button
        variant="link"
        className="text-muted-foreground !px-0 font-normal hover:no-underline"
        onClick={() => setOpen(true)}
      >
        <Search className="size-4" />
        搜索
        <kbd className="bg-muted inline-flex h-5 items-center gap-1 rounded border px-1.5 text-[10px] font-medium select-none">
          <span className="text-xs">⌘</span>J
        </kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="搜索页面、项目…" />
        <CommandList>
          <CommandEmpty>未找到结果</CommandEmpty>
          <CommandGroup heading="操作">
            <CommandItem
              className="!py-1.5"
              onSelect={() => {
                setOpen(false);
                openEntry();
              }}
            >
              <Plus />
              <span>记一笔</span>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="页面">
            {sidebarItems.flatMap((g) =>
              g.items.map((item) => (
                <CommandItem className="!py-1.5" key={item.url} onSelect={() => go(item.url)}>
                  {item.icon && <item.icon />}
                  <span>{item.title}</span>
                </CommandItem>
              )),
            )}
          </CommandGroup>
          {data?.projects.length ? (
            <>
              <CommandSeparator />
              <CommandGroup heading="项目">
                {data.projects.map((p) => (
                  <CommandItem
                    className="!py-1.5"
                    key={p.id}
                    value={`项目 ${p.name} ${p.id}`}
                    onSelect={() => go(`/dashboard/ledger/projects/${p.id}`)}
                  >
                    <FolderKanban />
                    <span>{p.name}</span>
                    {p.archived ? <span className="text-muted-foreground ml-auto text-xs">已归档</span> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          ) : null}
        </CommandList>
      </CommandDialog>
    </>
  );
}
