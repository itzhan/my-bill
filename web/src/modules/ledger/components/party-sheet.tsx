"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, LayoutDashboard, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import { del, get, patch, post, put } from "../api";
import { CUR, CURRENCIES, PL, curf, fmt, fmtCompact, fmtTime, parseAmount, relTime, todayLocal, usdf } from "../format";
import { qk, useLedgerRefresh, useMe, useParty } from "../hooks";
import type {
  Currency,
  CustomerOption,
  Party,
  PartyKind,
  PartyWallet,
  ProjectDetail,
  RelayLive,
  RelayStationUser,
  RelayUserKey,
  RemoteStationKey,
  Station,
  SupplierSite,
} from "../types";

import { PartyWallets, amt } from "./party-wallets";
import { FormError, useConfirm } from "./shared";

export type PartySheetState =
  | { open: false }
  | { open: true; mode: "view"; id: number; projectId?: number }
  | { open: true; mode: "edit"; id: number; projectId?: number }
  | { open: true; mode: "new"; projectId: number; kind: PartyKind };

const SOURCE_TXT: Record<string, string> = { api: "接口同步", ai: "AI", relay: "中转站自动" };

function TrackModeToggle({ mode, onChange }: { mode: "user" | "key"; onChange: (m: "user" | "key") => void }) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      className="w-full"
      value={mode}
      onValueChange={(v) => v && onChange(v as "user" | "key")}
    >
      <ToggleGroupItem value="user" className="flex-1 data-[state=on]:font-semibold">
        中转站邮箱
      </ToggleGroupItem>
      <ToggleGroupItem value="key" className="flex-1 data-[state=on]:font-semibold">
        API Key
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

function AdminKeyPicker({
  keys,
  setKeys,
  keyId,
  setKeyId,
  panelPass,
  setPanelPass,
  setError,
}: {
  keys: RelayUserKey[] | null;
  setKeys: (k: RelayUserKey[] | null) => void;
  keyId: string;
  setKeyId: (s: string) => void;
  panelPass: string;
  setPanelPass: (s: string) => void;
  setError: (s: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [needPass, setNeedPass] = useState(false);
  const load = async (pass = panelPass) => {
    setBusy(true);
    setError(null);
    try {
      const d = await post<{ keys: RelayUserKey[] }>("/relay/admin-keys", { password: pass });
      setKeys(d.keys);
      setNeedPass(false);
      if (!d.keys.length) setError("站点上没有 API Key");
    } catch (ex) {
      const msg = (ex as Error).message;
      setError(msg);
      if (/密码|无权/.test(msg)) setNeedPass(true);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (keys == null) void load("");
    // 进入 API Key 模式时用财务系统管理密钥直接拉列表
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={() => load()} disabled={busy} className="shrink-0">
          {busy ? "读取中…" : keys?.length ? "刷新 API Key" : "读取 API Key"}
        </Button>
      </div>
      {needPass ? (
        <div className="space-y-2">
          <Label>
            管理员面板密码{" "}
            <span className="text-muted-foreground font-normal">（管理密钥列 Key 失败时才需要，不会保存）</span>
          </Label>
          <Input
            type="password"
            value={panelPass}
            onChange={(e) => setPanelPass(e.target.value)}
            placeholder="站点管理员登录密码"
            autoComplete="off"
          />
        </div>
      ) : null}
      {keys && keys.length > 0 ? (
        <div className="space-y-2">
          <Label>选择要追踪的 API Key（{keys.length}）</Label>
          <Select value={keyId} onValueChange={setKeyId}>
            <SelectTrigger>
              <SelectValue placeholder="选择 API Key" />
            </SelectTrigger>
            <SelectContent>
              {keys.map((k) => (
                <SelectItem key={k.id} value={String(k.id)}>
                  {k.name || k.key_masked || `Key ${k.id}`}
                  {k.group_name ? `（${k.group_name}）` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  );
}

function CurrencySelect({ value, onChange, id }: { value: Currency; onChange: (c: Currency) => void; id?: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Currency)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CURRENCIES.map((c) => (
          <SelectItem key={c} value={c}>
            {c}
            {c === "CNY" ? " 人民币" : c === "USD" ? " 美元" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function PartySheet({
  state,
  setState,
}: {
  state: PartySheetState;
  setState: Dispatch<SetStateAction<PartySheetState>>;
}) {
  const close = () => setState({ open: false });
  let title = "往来单位";
  if (state.open && state.mode === "new") {
    title = state.projectId > 0 ? `关联${PL[state.kind].name}` : `添加${PL[state.kind].name}`;
  }
  return (
    <Sheet open={state.open} onOpenChange={(o) => !o && close()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl">
        {state.open && state.mode === "new" ? (
          <>
            <SheetHeader>
              <SheetTitle>{title}</SheetTitle>
            </SheetHeader>
            <div className="px-4 pb-6">
              {state.kind === "supplier" ? (
                <LinkProjectSupplierForm projectId={state.projectId} onDone={close} />
              ) : (
                <LinkProjectCustomerForm
                  projectId={state.projectId}
                  onDone={(id) => setState({ open: true, mode: "view", id })}
                  onClose={close}
                />
              )}
            </div>
          </>
        ) : null}
        {state.open && state.mode !== "new" ? (
          <PartyDetailView
            id={state.id}
            projectId={state.projectId}
            editing={state.mode === "edit"}
            setMode={(mode) => setState({ open: true, mode, id: state.id, projectId: state.projectId })}
            onDeleted={close}
            onClose={close}
          />
        ) : null}
        {!state.open ? (
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

type PickerOption = {
  value: string;
  label: string;
  sub?: string;
  meta?: string;
  searchText?: string;
};

// 可搜索选择器：用于关联已有甲方 / 供应商，在抽屉内无焦点冲突，支持实时模糊搜索与回车快选
function SearchablePicker({
  options,
  value,
  onChange,
  placeholder,
  emptyText,
}: {
  options: PickerOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  emptyText: string;
}) {
  const [kw, setKw] = useState("");
  const picked = options.find((o) => o.value === value) ?? null;
  const q = kw.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) =>
        `${o.label} ${o.sub ?? ""} ${o.meta ?? ""} ${o.searchText ?? ""}`.toLowerCase().includes(q),
      )
    : options;

  if (picked) {
    return (
      <div className="bg-primary/5 border-primary/30 flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-medium">
            <Check className="text-primary size-4 shrink-0" />
            <span className="truncate">{picked.label}</span>
          </div>
          {picked.sub || picked.meta ? (
            <div className="text-muted-foreground truncate text-xs">
              {[picked.sub, picked.meta].filter(Boolean).join(" · ")}
            </div>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            onChange("");
            setKw("");
          }}
        >
          重选
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          placeholder={placeholder}
          className="pl-8"
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const first = filtered[0];
              if (first) {
                onChange(first.value);
                setKw("");
              }
            }
          }}
        />
      </div>
      {filtered.length ? (
        <div className="max-h-52 divide-y overflow-y-auto rounded-md border">
          {filtered.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                setKw("");
              }}
              className="hover:bg-muted/60 flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{o.label}</div>
                {o.sub ? <div className="text-muted-foreground truncate text-xs">{o.sub}</div> : null}
              </div>
              {o.meta ? <span className="text-muted-foreground shrink-0 text-xs">{o.meta}</span> : null}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground rounded-md border py-4 text-center text-xs">{emptyText}</p>
      )}
    </div>
  );
}

// 项目往来 -> 关联已有客户：只选已有客户；若是中转项目，挂账追踪按「选台子 → 搜索选择客户账户 → 显示该账户可用分组并设折扣」
function LinkProjectCustomerForm({
  projectId,
  onDone,
  onClose,
}: {
  projectId: number;
  onDone: (id: number) => void;
  onClose: () => void;
}) {
  const refresh = useLedgerRefresh();
  const projQ = useQuery({
    queryKey: qk.project(projectId),
    queryFn: () => get<ProjectDetail>(`/projects/${projectId}`),
    enabled: projectId > 0,
    retry: false,
  });
  const custOptsQ = useQuery({
    queryKey: ["ledger", "customer-options"],
    queryFn: () => get<{ customers: CustomerOption[] }>("/customers/options").then((d) => d.customers),
  });
  const stationsQ = useQuery({
    queryKey: ["ledger", "stations"],
    queryFn: () => get<{ stations: Station[] }>("/stations").then((d) => d.stations),
  });

  const isRelayProject = (projQ.data?.project.ptype ?? "relay") === "relay";
  const relayStations = (stationsQ.data ?? []).filter((s) => s.type === "relay");

  const [customerKey, setCustomerKey] = useState("");
  const [stationId, setStationId] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [userResults, setUserResults] = useState<RelayStationUser[] | null>(null);
  const [selectedUser, setSelectedUser] = useState<RelayStationUser | null>(null);
  const [groupPrices, setGroupPrices] = useState<Record<string, { mode: "discount" | "cny"; value: string }>>({});
  const [defaultRatio, setDefaultRatio] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 自动预选项目默认台子或第一个中转站
  useEffect(() => {
    if (stationId || !relayStations.length) return;
    const pid = projQ.data?.project.station_id;
    const hit = (pid ? relayStations.find((s) => s.id === pid) : null) ?? relayStations[0];
    if (hit) setStationId(String(hit.id));
  }, [relayStations, projQ.data?.project.station_id, stationId]);

  const searchStationUsers = async (kw = userQuery, sid = stationId) => {
    if (!sid) return;
    setSearchingUsers(true);
    setError(null);
    try {
      const d = await get<{ users: RelayStationUser[] }>(`/stations/${sid}/users?q=${encodeURIComponent(kw.trim())}`);
      setUserResults(d.users);
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setSearchingUsers(false);
    }
  };

  // 切换台子时重置已选账户与搜索结果
  const onStationChange = (sid: string) => {
    setStationId(sid);
    setSelectedUser(null);
    setUserResults(null);
    setGroupPrices({});
  };

  // 选中账户后自动拉取该账户可用的分组
  const sidNum = Number(stationId);
  const userGroupsQ = useQuery({
    queryKey: ["ledger", "station-user-groups", sidNum, selectedUser?.id ?? 0],
    queryFn: () =>
      get<{ groups: { name: string }[] }>(`/stations/${sidNum}/users/${selectedUser!.id}/groups`).then((d) => d.groups),
    enabled: isRelayProject && sidNum > 0 && !!selectedUser,
  });

  const setGroupPrice = (name: string, patchVal: Partial<{ mode: "discount" | "cny"; value: string }>) =>
    setGroupPrices((prev) => ({
      ...prev,
      [name]: { ...(prev[name] ?? { mode: "discount" as const, value: "" }), ...patchVal },
    }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const picked = (custOptsQ.data ?? []).find((c) => c.key === customerKey);
    if (!picked) return setError("请选择要关联的已有客户");
    const r = Number(defaultRatio) > 0 ? Number(defaultRatio) : 1;
    setBusy(true);
    setError(null);
    try {
      const d = await post<{ party: Party }>(`/projects/${projectId}/parties`, {
        kind: "customer",
        name: picked.name,
        customer_group: picked.group,
        contact: picked.contact,
        currency: "CNY",
        ratio: r,
      });
      if (isRelayProject && selectedUser && sidNum > 0) {
        try {
          await post(`/parties/${d.party.id}/relay-link`, {
            station_id: sidNum,
            user_id: selectedUser.id,
            ref: selectedUser.email || selectedUser.username || String(selectedUser.id),
            ratio: r,
            currency: "CNY",
          });
          const visible = new Set((userGroupsQ.data ?? []).map((g) => g.name));
          const groupsPayload = Object.entries(groupPrices)
            .filter(([name, p]) => p.value.trim() !== "" && Number(p.value) > 0 && visible.has(name))
            .map(([group_name, p]) => ({
              group_name,
              price: Number(p.value),
              mode: p.mode,
            }));
          if (groupsPayload.length) {
            await put(`/parties/${d.party.id}/relay-groups`, {
              station_id: sidNum,
              groups: groupsPayload,
            });
          }
          toast.success(
            `已关联客户「${picked.name}」并开启挂账追踪${groupsPayload.length ? `（${groupsPayload.length} 个分组）` : ""}`,
          );
        } catch (ex) {
          toast.error(`已关联客户，但绑定挂账追踪失败：${(ex as Error).message}`);
        }
      } else {
        toast.success(`已关联客户「${picked.name}」到本项目`);
      }
      refresh();
      onDone(d.party.id);
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const customers = custOptsQ.data ?? [];

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label>选择已有客户 *</Label>
        {custOptsQ.isLoading ? (
          <Skeleton className="h-9" />
        ) : customers.length ? (
          <SearchablePicker
            value={customerKey}
            onChange={setCustomerKey}
            placeholder="搜索客户名称 / 联系方式…"
            emptyText="没有找到匹配的已有客户"
            options={customers.map((c) => ({
              value: c.key,
              label: c.name,
              sub: c.contact || undefined,
              searchText: c.group,
            }))}
          />
        ) : (
          <p className="text-muted-foreground rounded-md border p-3 text-sm">
            还没有已建档的客户，请先前往{" "}
            <Link href="/dashboard/ledger/customers" onClick={onClose} className="text-primary underline">
              客户管理
            </Link>{" "}
            添加客户。
          </p>
        )}
        <p className="text-muted-foreground text-xs">
          项目里只关联已有客户；如需新建客户请前往{" "}
          <Link href="/dashboard/ledger/customers" onClick={onClose} className="text-primary hover:underline">
            客户页
          </Link>
        </p>
      </div>

      {isRelayProject ? (
        <div className="space-y-4 rounded-lg border p-3.5">
          <div>
            <div className="text-sm font-medium">挂账追踪</div>
            <p className="text-muted-foreground text-xs">
              先选择我们的中转台子，搜索选择客户的账户，再为该账户可用分组设置各自折扣
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>1. 选择台子</Label>
            {relayStations.length ? (
              <Select value={stationId} onValueChange={onStationChange}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择中转站台子" />
                </SelectTrigger>
                <SelectContent>
                  {relayStations.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}
                      {s.base_url ? `（${s.base_url.replace(/^https?:\/\//, "")}）` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-muted-foreground text-xs">
                还没有中转站台子，请先到侧边栏「台子管理」里添加
              </p>
            )}
          </div>

          {stationId ? (
            <div className="space-y-2">
              <Label>2. 搜索并选择客户账户</Label>
              {selectedUser ? (
                <div className="bg-primary/5 border-primary/30 flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-medium">
                      <Check className="text-primary size-4 shrink-0" />
                      <span className="truncate">{selectedUser.email || selectedUser.username}</span>
                    </div>
                    <div className="text-muted-foreground text-xs">
                      ID {selectedUser.id}
                      {selectedUser.username && selectedUser.email ? ` · ${selectedUser.username}` : ""} · 余额{" "}
                      {usdf(selectedUser.balance_usd)}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedUser(null);
                      setGroupPrices({});
                    }}
                  >
                    重选
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                      <Input
                        placeholder="输入邮箱 / 用户名关键词"
                        className="pl-8"
                        value={userQuery}
                        onChange={(e) => setUserQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void searchStationUsers();
                          }
                        }}
                      />
                    </div>
                    <Button type="button" variant="outline" onClick={() => searchStationUsers()} disabled={searchingUsers}>
                      {searchingUsers ? "搜索中…" : "搜索"}
                    </Button>
                  </div>
                  {userResults ? (
                    userResults.length ? (
                      <div className="max-h-48 divide-y overflow-y-auto rounded-md border">
                        {userResults.map((u) => (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => setSelectedUser(u)}
                            className="hover:bg-muted/60 flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors"
                          >
                            <div className="min-w-0">
                              <div className="truncate font-medium">{u.email || u.username || `用户 #${u.id}`}</div>
                              <div className="text-muted-foreground truncate text-xs">
                                ID {u.id}
                                {u.username && u.email ? ` · ${u.username}` : ""}
                              </div>
                            </div>
                            <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                              {usdf(u.balance_usd)}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-xs">没有找到匹配的客户账户</p>
                    )
                  ) : null}
                </div>
              )}
            </div>
          ) : null}

          {selectedUser ? (
            <div className="space-y-2.5 border-t pt-3">
              <div>
                <Label>3. 设置各分组折扣</Label>
                <p className="text-muted-foreground text-xs">
                  以下为该账户在台子上可用的分组；填折扣（如 68 = 68 折）或元/刀
                </p>
              </div>
              {userGroupsQ.isLoading ? (
                <Skeleton className="h-16" />
              ) : userGroupsQ.data?.length ? (
                <div className="space-y-2">
                  {userGroupsQ.data.map((g) => {
                    const row = groupPrices[g.name] ?? { mode: "discount" as const, value: "" };
                    return (
                      <div key={g.name} className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{g.name}</span>
                        <Select
                          value={row.mode}
                          onValueChange={(m) => setGroupPrice(g.name, { mode: m === "cny" ? "cny" : "discount" })}
                        >
                          <SelectTrigger className="w-24">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="discount">折扣</SelectItem>
                            <SelectItem value="cny">元/刀</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          inputMode="decimal"
                          className="w-24"
                          placeholder={row.mode === "discount" ? "如 68" : "如 4.5"}
                          value={row.value}
                          onChange={(e) => setGroupPrice(g.name, { value: e.target.value })}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-muted-foreground text-xs">该账户暂未查到可用分组，可填写下方默认折扣兜底</p>
              )}
              <div className="flex items-center gap-2 pt-1">
                <Label htmlFor="cust-def-ratio" className="text-muted-foreground shrink-0 text-xs font-normal">
                  未设分组价时默认折扣
                </Label>
                <Input
                  id="cust-def-ratio"
                  inputMode="decimal"
                  className="h-8 w-24"
                  value={defaultRatio}
                  onChange={(e) => setDefaultRatio(e.target.value)}
                />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <FormError>{error}</FormError>
      <Button type="submit" className="w-full" disabled={busy || !customers.length}>
        {busy ? "关联中…" : "关联客户"}
      </Button>
    </form>
  );
}

// 项目往来 -> 关联已有供应商：只选已有供应商；若是中转项目，再选该供应商的站点与站点里的 Key（多选），自动继承站点自定义倍率
function LinkProjectSupplierForm({ projectId, onDone }: { projectId: number; onDone: () => void }) {
  const refresh = useLedgerRefresh();
  const projQ = useQuery({
    queryKey: qk.project(projectId),
    queryFn: () => get<ProjectDetail>(`/projects/${projectId}`),
    enabled: projectId > 0,
    retry: false,
  });
  const suppliersQ = useQuery({
    queryKey: ["ledger", "suppliers"],
    queryFn: () =>
      get<{ suppliers: (Party & { sites?: SupplierSite[] })[] }>("/suppliers").then((d) =>
        d.suppliers.filter((s) => !s.archived),
      ),
  });

  const isRelayProject = (projQ.data?.project.ptype ?? "relay") === "relay";
  const [supplierId, setSupplierId] = useState("");
  const [siteWalletId, setSiteWalletId] = useState("");
  const [remoteKeys, setRemoteKeys] = useState<RemoteStationKey[] | null>(null);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [selectedKeyIds, setSelectedKeyIds] = useState<Set<string>>(new Set());
  const [keyError, setKeyError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const suppliers = suppliersQ.data ?? [];
  const selectedSupplier = suppliers.find((s) => String(s.id) === supplierId) ?? null;
  const sites = selectedSupplier?.sites ?? [];
  const selectedSite = sites.find((s) => String(s.template_wallet_id) === siteWalletId) ?? null;

  const loadSiteKeys = async (wid: string) => {
    if (!wid) return;
    setLoadingKeys(true);
    setKeyError(null);
    setRemoteKeys(null);
    setSelectedKeyIds(new Set());
    try {
      const d = await get<{ keys: RemoteStationKey[] }>(`/party-wallets/${wid}/remote-keys`);
      setRemoteKeys(d.keys);
    } catch (ex) {
      setKeyError((ex as Error).message);
    } finally {
      setLoadingKeys(false);
    }
  };

  const onSelectSupplier = (id: string) => {
    setSupplierId(id);
    setSiteWalletId("");
    setRemoteKeys(null);
    setSelectedKeyIds(new Set());
    setKeyError(null);
    const sup = suppliers.find((s) => String(s.id) === id);
    const onlySite = sup?.sites?.length === 1 ? sup.sites[0] : undefined;
    if (isRelayProject && onlySite) {
      const wid = String(onlySite.template_wallet_id);
      setSiteWalletId(wid);
      void loadSiteKeys(wid);
    }
  };

  const onSelectSite = (wid: string) => {
    setSiteWalletId(wid);
    void loadSiteKeys(wid);
  };

  const toggleKey = (id: string) => {
    setSelectedKeyIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplier) return setError("请选择要关联的已有供应商");
    if (isRelayProject && selectedSite && remoteKeys?.length && selectedKeyIds.size === 0) {
      return setError("请勾选要关联到本项目的站点 Key（可多选）");
    }
    setBusy(true);
    setError(null);
    try {
      const res = await post<{ ok: boolean; bound?: { created: number; skipped: number } | null }>(
        `/projects/${projectId}/suppliers`,
        {
          party_id: selectedSupplier.id,
          ...(isRelayProject && selectedSite
            ? {
                template_wallet_id: selectedSite.template_wallet_id,
                key_ids: [...selectedKeyIds],
                link_whole_site: selectedKeyIds.size === 0,
              }
            : {}),
        },
      );
      if (res.bound) {
        toast.success(
          `已关联供应商「${selectedSupplier.name}」及 ${res.bound.created} 把 Key${res.bound.skipped ? `（跳过已存在 ${res.bound.skipped} 把）` : ""}`,
        );
      } else {
        toast.success(`已关联供应商「${selectedSupplier.name}」`);
      }
      refresh();
      onDone();
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label>选择已有供应商 *</Label>
        {suppliersQ.isLoading ? (
          <Skeleton className="h-9" />
        ) : suppliers.length ? (
          <SearchablePicker
            value={supplierId}
            onChange={onSelectSupplier}
            placeholder="搜索供应商名称 / 站点 / 备注…"
            emptyText="没有找到匹配的已有供应商"
            options={suppliers.map((s) => ({
              value: String(s.id),
              label: s.name,
              sub:
                (s.sites ?? [])
                  .map((st) => st.note || st.name || st.host)
                  .filter(Boolean)
                  .slice(0, 2)
                  .join(" · ") || undefined,
              meta: s.sites?.length ? `${s.sites.length} 个站点` : undefined,
              searchText: (s.sites ?? []).map((st) => `${st.name} ${st.note ?? ""} ${st.host}`).join(" "),
            }))}
          />
        ) : (
          <p className="text-muted-foreground rounded-md border p-3 text-sm">
            还没有供应商，请先前往{" "}
            <Link href="/dashboard/ledger/suppliers" onClick={onDone} className="text-primary underline">
              供应商页
            </Link>{" "}
            添加供应商。
          </p>
        )}
        <p className="text-muted-foreground text-xs">
          新增供应商请统一在侧边栏「
          <Link href="/dashboard/ledger/suppliers" onClick={onDone} className="text-primary hover:underline">
            供应商
          </Link>
          」页添加，项目里只做关联
        </p>
      </div>

      {isRelayProject && selectedSupplier ? (
        <div className="space-y-3 rounded-lg border p-3.5">
          <div>
            <div className="text-sm font-medium">关联供应商站点与 Key</div>
            <p className="text-muted-foreground text-xs">
              选择该供应商的站点并勾选要用于本项目的 Key（可多选）；如站点已配自定义倍率将自动继承计算
            </p>
          </div>
          {sites.length ? (
            <div className="space-y-1.5">
              <Label>1. 选择站点</Label>
              <Select value={siteWalletId} onValueChange={onSelectSite}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择供应商站点" />
                </SelectTrigger>
                <SelectContent>
                  {sites.map((s) => (
                    <SelectItem key={s.template_wallet_id} value={String(s.template_wallet_id)}>
                      {s.name}
                      {s.note ? `（${s.note}）` : ""} · {s.host}（{s.platform === "sub2api" ? "sub2api" : "new-api"}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">
              该供应商尚未配置站点。可直接关联供应商，或先前往{" "}
              <Link
                href={`/dashboard/ledger/suppliers/${selectedSupplier.id}`}
                onClick={onDone}
                className="text-primary underline"
              >
                供应商详情
              </Link>{" "}
              添加站点。
            </p>
          )}

          {selectedSite?.custom ? (
            <div className="bg-muted/50 rounded-md px-3 py-2 text-xs">
              该站点已设置自定义倍率（充值 ×{selectedSite.custom_ratio ?? "-"} / 消耗 ×
              {selectedSite.consume_ratio ?? selectedSite.custom_ratio ?? 1}），关联的 Key 将自动按此倍率计算，无需重复设置。
            </div>
          ) : null}

          {selectedSite ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>2. 选择站点里的 Key（可多选）</Label>
                <div className="flex items-center gap-2">
                  {remoteKeys?.length ? (
                    <label className="flex items-center gap-1.5 text-xs">
                      <Checkbox
                        checked={selectedKeyIds.size === remoteKeys.length}
                        onCheckedChange={(x) =>
                          setSelectedKeyIds(x ? new Set(remoteKeys.map((k) => k.id)) : new Set())
                        }
                      />
                      <span className="text-muted-foreground">全选</span>
                    </label>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => loadSiteKeys(siteWalletId)}
                    disabled={loadingKeys}
                  >
                    <RefreshCw className={cn("size-3.5", loadingKeys && "animate-spin")} />
                    刷新
                  </Button>
                </div>
              </div>
              {loadingKeys ? <Skeleton className="h-24" /> : null}
              {keyError ? <FormError>{keyError}</FormError> : null}
              {remoteKeys && !remoteKeys.length ? (
                <p className="text-muted-foreground text-xs">该站点上暂未读到 Key</p>
              ) : null}
              {remoteKeys?.length ? (
                <div className="max-h-60 divide-y overflow-y-auto rounded-md border">
                  {remoteKeys.map((k) => (
                    <label
                      key={k.id}
                      className="hover:bg-muted/40 flex cursor-pointer items-center gap-2.5 p-2.5 text-sm"
                    >
                      <Checkbox checked={selectedKeyIds.has(k.id)} onCheckedChange={() => toggleKey(k.id)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium">{k.name}</span>
                          <Badge variant="outline" className="text-[11px] font-normal">
                            {k.status}
                          </Badge>
                        </div>
                        <div className="text-muted-foreground truncate font-mono text-xs">{k.key_masked}</div>
                      </div>
                      <div className="shrink-0 text-right text-xs tabular-nums">
                        <div className="text-muted-foreground">累计</div>
                        <div className="font-medium">{amt(k.used)}</div>
                      </div>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <FormError>{error}</FormError>
      <Button type="submit" className="w-full" disabled={busy || !suppliers.length}>
        {busy
          ? "关联中…"
          : selectedKeyIds.size
            ? `关联供应商并绑定 ${selectedKeyIds.size} 把 Key`
            : "关联供应商"}
      </Button>
    </form>
  );
}

function Kv({ label, value, className }: { label: React.ReactNode; value: React.ReactNode; className?: string }) {
  return (
    <div className="bg-muted/50 rounded-lg p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className={cn("mt-1 font-semibold tabular-nums", className)}>{value}</div>
    </div>
  );
}

function PartyDetailView({
  id,
  projectId,
  editing,
  setMode,
  onDeleted,
  onClose,
}: {
  id: number;
  projectId?: number;
  editing: boolean;
  setMode: (m: "view" | "edit") => void;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const refresh = useLedgerRefresh();
  const [archBusy, setArchBusy] = useState(false);
  const { data, isLoading, error } = useParty(id, projectId);
  const hasRelay = !!data?.party.relay;
  const live = useQuery({
    queryKey: qk.partyRelay(id),
    queryFn: () => get<{ live: RelayLive }>(`/parties/${id}/relay`).then((d) => d.live),
    enabled: hasRelay && !editing,
    refetchInterval: 30_000,
  });
  // 供应商的各站点地址（去重），放在名字下面方便点击（去拿访问令牌）。与「余额」区块共用这份缓存
  const isSupplier = data?.party.kind === "supplier";
  const walletsQ = useQuery({
    queryKey: ["ledger", "party-wallets", id] as const,
    queryFn: () => get<{ wallets: PartyWallet[] }>(`/parties/${id}/wallets`).then((d) => d.wallets),
    enabled: !editing && isSupplier,
  });
  const siteUrls = [...new Set((walletsQ.data ?? []).map((w) => w.base_url).filter(Boolean))];

  if (isLoading || !data) {
    return (
      <div className="space-y-3 p-4">
        <SheetHeader className="p-0">
          <SheetTitle>往来单位</SheetTitle>
        </SheetHeader>
        {error ? <FormError>{error.message}</FormError> : null}
        <Skeleton className="h-10" />
        <Skeleton className="h-32" />
      </div>
    );
  }
  const v = data.party;
  const L = PL[v.kind];
  if (editing) {
    return <EditPartyForm party={v} projectId={projectId} onBack={() => setMode("view")} onDeleted={onDeleted} />;
  }

  const isProjectSupplier = v.kind === "supplier" && !!projectId;
  const projArchived = !!v.project_archived;
  const toggleProjectArchive = async () => {
    if (!projectId) return;
    setArchBusy(true);
    try {
      await patch(`/projects/${projectId}/suppliers/${v.id}`, { archived: !projArchived });
      toast.success(projArchived ? "已在本项目恢复" : "已在本项目归档（不影响供应商总列表）");
      qc.invalidateQueries({ queryKey: ["ledger", "party", v.id] });
      refresh();
    } catch (ex) {
      toast.error((ex as Error).message);
    } finally {
      setArchBusy(false);
    }
  };

  const liveData = live.data ?? (live.error ? ({ error: live.error.message } as RelayLive) : undefined);
  const st0 = liveData?.settlement ?? v.settle;
  const openLabel = st0.credit > 0 ? (v.kind === "customer" ? "预收余额" : "待消耗额度") : L.open;

  return (
    <>
      <SheetHeader className="border-b">
        <div className="flex items-start justify-between gap-2 pr-8">
          <div className="min-w-0">
            <SheetTitle className="flex items-center gap-2">
              {v.name} <Badge variant="secondary">{L.name}</Badge>
              <Badge variant="outline">
                {v.settle_type === "credit" ? (v.kind === "supplier" ? "授信" : "后付") : "预付"}
              </Badge>
              {isProjectSupplier && projArchived ? (
                <Badge variant="outline">本项目已归档</Badge>
              ) : v.archived ? (
                <Badge variant="outline">归档</Badge>
              ) : null}
            </SheetTitle>
            <SheetDescription>{[v.project_name, v.contact, v.note].filter(Boolean).join(" · ")}</SheetDescription>
            {siteUrls.length ? (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {siteUrls.map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="打开站点（去拿访问令牌）"
                    className="text-primary bg-primary/5 hover:bg-primary/10 inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-0.5 text-xs"
                  >
                    <ExternalLink className="size-3 shrink-0" />
                    <span className="truncate">{url.replace(/^https?:\/\//, "")}</span>
                  </a>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {isProjectSupplier ? (
              <Button
                variant="outline"
                size="sm"
                disabled={archBusy}
                onClick={toggleProjectArchive}
                title="仅在本项目标记为已归档，不影响全局供应商列表与其他项目"
              >
                {projArchived ? "恢复合作" : "本项目归档"}
              </Button>
            ) : null}
            {v.kind === "supplier" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onClose();
                  router.push(`/dashboard/ledger/suppliers/${id}`);
                }}
              >
                <LayoutDashboard />
                查看详情
              </Button>
            ) : null}
            <Button variant="ghost" size="icon-sm" onClick={() => setMode("edit")} aria-label="编辑">
              <Pencil />
            </Button>
          </div>
        </div>
      </SheetHeader>
      <div className="space-y-5 p-4">
        {v.kind !== "supplier" ? (
          <div className="grid grid-cols-3 gap-2">
            <Kv
              label={
                <>
                  {L.due}（{st0.currency}）
                  {v.relay ? (
                    <span className="block">
                      自动 {fmt(st0.relay_due)}
                      {st0.manual_due ? ` + 手工 ${fmt(st0.manual_due)}` : ""}
                    </span>
                  ) : null}
                </>
              }
              value={curf(st0.due, st0.currency)}
            />
            <Kv label={`${L.paid}（${st0.currency}）`} value={curf(st0.paid, st0.currency)} />
            <Kv
              label={
                <>
                  {openLabel}（{st0.currency}）
                  {st0.currency !== "CNY" && (st0.open > 0 || st0.credit > 0) ? (
                    <span className="block">≈¥{fmt(Math.abs(st0.open_cny))}</span>
                  ) : null}
                </>
              }
              value={curf(st0.open > 0 ? st0.open : st0.credit, st0.currency)}
              className={st0.open > 0 ? "text-warning" : st0.credit > 0 ? "text-income" : ""}
            />
          </div>
        ) : null}

        {v.kind === "supplier" ? <PartyWallets party={v} projectId={projectId} /> : null}

        {data.relay_configured && v.kind === "customer" ? (
          <RelayBlock party={v} live={liveData} loading={live.isFetching} onRefresh={() => live.refetch()} />
        ) : null}

        {v.kind === "customer" && v.relay && v.relay.track_mode !== "key" ? <RelayGroups party={v} /> : null}

        {/* 项目往来内去掉记应付 / 记实付 */}
        {isProjectSupplier && projArchived ? (
          <p className="text-muted-foreground text-sm">
            该供应商在本项目已归档（不再发力，本项目应付按实际转出计算），仍保留在全局供应商列表中
          </p>
        ) : v.archived ? (
          <p className="text-muted-foreground text-sm">已归档，只能查看</p>
        ) : projectId && v.kind === "supplier" ? null : (
          <RecordForm party={v} />
        )}

        {v.kind !== "supplier" ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">
                往来明细 <span className="text-muted-foreground text-sm">{data.records.length}</span>
              </h3>
              <span className="text-muted-foreground text-xs">按日期倒序</span>
            </div>
            {data.records.length ? (
              <RecordList party={v} records={data.records} />
            ) : (
              <p className="text-muted-foreground text-sm">还没有往来记录</p>
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}

function RelayBlock({
  party: v,
  live,
  loading,
  onRefresh,
}: {
  party: Party;
  live?: RelayLive;
  loading: boolean;
  onRefresh: () => void;
}) {
  const refresh = useLedgerRefresh();
  const qc = useQueryClient();
  const [confirm, confirmEl] = useConfirm();
  const L = PL[v.kind];
  const rl = v.kind === "customer" ? "折扣" : "倍率";
  const { data: stations } = useQuery({
    queryKey: ["ledger", "stations"],
    queryFn: () => get<{ stations: Station[] }>("/stations").then((d) => d.stations),
    enabled: !v.relay && v.kind === "customer",
  });
  const relayStations = (stations ?? []).filter((s) => s.type === "relay");
  const [stationId, setStationId] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [userResults, setUserResults] = useState<RelayStationUser[] | null>(null);
  const [selectedUser, setSelectedUser] = useState<RelayStationUser | null>(null);
  const [ratio, setRatio] = useState(String(v.ratio));
  const [cur, setCur] = useState<Currency>(v.currency);
  const [mode, setMode] = useState<"user" | "key">("user");
  const [keys, setKeys] = useState<RelayUserKey[] | null>(null);
  const [keyId, setKeyId] = useState("");
  const [panelPass, setPanelPass] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const first = relayStations[0];
    if (!stationId && first) setStationId(String(first.id));
  }, [relayStations, stationId]);

  const searchUsers = async () => {
    if (!stationId) return;
    setSearchingUsers(true);
    setError(null);
    try {
      const d = await get<{ users: RelayStationUser[] }>(
        `/stations/${stationId}/users?q=${encodeURIComponent(userQuery.trim())}`,
      );
      setUserResults(d.users);
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setSearchingUsers(false);
    }
  };

  const reload = () => {
    qc.invalidateQueries({ queryKey: ["ledger", "party", v.id] });
    qc.invalidateQueries({ queryKey: qk.partyRelay(v.id) });
    refresh();
  };

  const link = async () => {
    if (v.kind === "customer" && mode === "key") {
      if (!keyId) return setError("请先读取并选择要追踪的 API Key");
    } else if (!selectedUser) {
      return setError("请先搜索并选择客户账户");
    }
    const r = Number(ratio);
    if (!(r > 0)) return setError(`${rl}必须大于 0`);
    setBusy(true);
    setError(null);
    try {
      const picked = keys?.find((k) => String(k.id) === keyId);
      await post(`/parties/${v.id}/relay-link`, {
        station_id: Number(stationId) || undefined,
        ...(mode === "key"
          ? { mode: "key", key_id: Number(keyId), key_name: picked?.name || picked?.key_masked || "", group_id: picked?.group_id, panel_pass: panelPass }
          : {
              user_id: selectedUser!.id,
              ref: selectedUser!.email || selectedUser!.username || String(selectedUser!.id),
            }),
        ratio: r,
        currency: cur,
      });
      toast.success("已绑定并开始自动挂账");
      reload();
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const unlink = async () => {
    if (
      !(await confirm({
        title: "解除与中转站的绑定？",
        description: "停止自动挂账，已自动挂账的记录保留（可手动删除）。",
        confirmText: "解除绑定",
      }))
    )
      return;
    try {
      await del(`/parties/${v.id}/relay-link`);
      reload();
    } catch (ex) {
      toast.error((ex as Error).message);
    }
  };

  const box = "space-y-3 rounded-lg border p-4";
  if (!v.relay) {
    return (
      <div className={box}>
        <div>
          <b className="text-sm">中转站</b>
          <p className="text-muted-foreground text-xs">
            {v.kind === "customer"
              ? mode === "key"
                ? "选一把站点上的 API Key；应收 = 这把 Key 的消耗 × 折扣"
                : "填客户在中转站的邮箱；没设分组价时应收 = 消耗 × 折扣，设了分组价按分组收费"
              : "填中转站「账号管理」里的账号名；应付 = 消耗 × 倍率，按结算币种自动逐日挂账"}
          </p>
        </div>
        {v.kind === "customer" ? (
          <TrackModeToggle
            mode={mode}
            onChange={(m) => {
              setMode(m);
              setKeys(null);
              setKeyId("");
              setError(null);
            }}
          />
        ) : null}
        {v.kind === "customer" && mode === "key" ? (
          <AdminKeyPicker
            keys={keys}
            setKeys={setKeys}
            keyId={keyId}
            setKeyId={setKeyId}
            panelPass={panelPass}
            setPanelPass={setPanelPass}
            setError={setError}
          />
        ) : (
          <div className="space-y-2.5">
            {relayStations.length ? (
              <Select
                value={stationId}
                onValueChange={(sid) => {
                  setStationId(sid);
                  setSelectedUser(null);
                  setUserResults(null);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择台子" />
                </SelectTrigger>
                <SelectContent>
                  {relayStations.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {selectedUser ? (
              <div className="bg-primary/5 border-primary/30 flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <span className="truncate font-medium">
                  {selectedUser.email || selectedUser.username}（ID {selectedUser.id}）
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedUser(null)}>
                  重选
                </Button>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <Input
                    placeholder="搜索客户账户（邮箱 / 用户名）"
                    value={userQuery}
                    onChange={(e) => setUserQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void searchUsers();
                      }
                    }}
                  />
                  <Button type="button" variant="outline" onClick={searchUsers} disabled={searchingUsers || !stationId}>
                    {searchingUsers ? "搜索中…" : "搜索"}
                  </Button>
                </div>
                {userResults ? (
                  userResults.length ? (
                    <div className="max-h-40 divide-y overflow-y-auto rounded-md border">
                      {userResults.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => setSelectedUser(u)}
                          className="hover:bg-muted/60 flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm"
                        >
                          <span className="truncate">{u.email || u.username || `用户 #${u.id}`}</span>
                          <span className="text-muted-foreground shrink-0 text-xs">{usdf(u.balance_usd)}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-xs">没有匹配的账户</p>
                  )
                ) : null}
              </>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>
              {rl}（{L.due} = {mode === "key" && v.kind === "customer" ? "Key 消耗" : "消耗"} × {rl}）
            </Label>
            <Input inputMode="decimal" value={ratio} onChange={(e) => setRatio(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>结算币种</Label>
            <CurrencySelect value={cur} onChange={setCur} />
          </div>
        </div>
        <FormError>{error}</FormError>
        <Button className="w-full" onClick={link} disabled={busy}>
          一键获取并开始挂账
        </Button>
        {confirmEl}
      </div>
    );
  }

  const head = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <b className="text-sm">
        中转站{v.kind === "supplier" ? "账号" : ""} · {v.relay.ref}
        {v.kind === "customer" && v.relay.track_mode === "key" && (
          <Badge variant="outline" className="ml-2 font-normal">
            API Key：{v.relay.key_name || `Key ${v.relay.key_id ?? ""}`}
          </Badge>
        )}
      </b>
      <div className="text-muted-foreground flex items-center gap-1 text-xs">
        {live?.fetched_at ? `${relTime(live.fetched_at)}更新 · 30 秒自动刷新` : "获取中…"}
        <Button variant="ghost" size="icon-sm" onClick={onRefresh} disabled={loading} aria-label="刷新">
          <RefreshCw className={cn(loading && "animate-spin")} />
        </Button>
        <Button variant="link" size="sm" className="h-auto px-1" onClick={unlink}>
          解绑
        </Button>
      </div>
    </div>
  );
  if (!live) {
    return (
      <div className={box}>
        {head}
        <Skeleton className="h-12" />
        {confirmEl}
      </div>
    );
  }
  if (live.error) {
    return (
      <div className={box}>
        {head}
        <FormError>{live.error}</FormError>
        {confirmEl}
      </div>
    );
  }
  const lv = live.live;
  const st = live.settlement;
  const C = st.currency;
  const hourly = (live.hourly || []).slice(-12);
  const costOf = (h: { cost_usd: number; std_cost_usd: number }) =>
    v.kind === "customer" ? h.cost_usd : h.std_cost_usd;
  const maxH = Math.max(0.01, ...hourly.map(costOf));
  const u = live.user || {};
  const a = live.account || {};
  return (
    <div className={box}>
      {head}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kv label="中转站累计消耗" value={usdf(st.consumption_usd)} />
        <Kv
          label={st.grouped ? `分组收费 = ${L.due}` : `× ${rl} ${st.ratio} = ${L.due}`}
          value={curf(st.consumption_x_ratio, C)}
        />
        <Kv label={`今日${L.due}`} value={st.today === null ? "—" : curf(st.today, C)} />
        <Kv label="本小时" value={st.this_hour === null ? "—" : curf(st.this_hour, C)} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kv label="当前 RPM" value={lv ? `${lv.rpm_now} / 5分钟均 ${lv.rpm_5m_avg}` : "—"} />
        {v.kind === "customer" ? (
          <>
            <Kv label="当前 TPM" value={lv ? fmtCompact(lv.tpm_now) : "—"} />
            <Kv label="今日请求" value={(live.today?.requests || 0).toLocaleString()} />
            <Kv
              label="中转站余额"
              value={u.balance_usd !== undefined ? usdf(u.balance_usd) : "—"}
              className={(u.balance_usd ?? 0) < 0 ? "text-expense" : ""}
            />
          </>
        ) : (
          <>
            <Kv label="今日请求" value={(live.today?.requests ?? 0).toLocaleString()} />
            <Kv label="并发" value={`${a.current_concurrency ?? 0}/${a.concurrency_limit ?? "—"}`} />
            <Kv label="账号状态" value={a.status || "—"} className={a.status === "active" ? "" : "text-expense"} />
          </>
        )}
      </div>
      {hourly.length ? (
        <div>
          <div className="flex h-16 items-end gap-1">
            {hourly.map((h) => (
              <div
                key={h.hour}
                title={`${h.hour} · ${usdf(costOf(h))} · ${h.requests} 次`}
                className="bg-primary/70 flex-1 rounded-t-sm"
                style={{ height: `${Math.max(2, (costOf(h) / maxH) * 100).toFixed(0)}%` }}
              />
            ))}
          </div>
          <p className="text-muted-foreground mt-1 text-xs">近 {hourly.length} 小时消耗（$）</p>
        </div>
      ) : null}
      <p className="text-muted-foreground text-xs">
        {v.kind === "customer"
          ? `状态 ${u.status || "—"} · 限 ${u.rpm_limit ?? "—"} RPM · 最近请求 ${lv?.last_request_at || "—"}${
              lv && Object.keys(lv.models_5m || {}).length
                ? ` · 近 5 分钟模型：${Object.entries(lv.models_5m)
                    .map(([m, n]) => `${m}×${n}`)
                    .join("、")}`
                : ""
            }`
          : `平台 ${a.platform || "—"} · 最近使用 ${a.last_used_at || "—"}${a.error ? ` · ${a.error.slice(0, 40)}` : ""}${
              a.temp_unschedulable ? ` · 暂不可调度：${a.temp_unschedulable.slice(0, 60)}` : ""
            }`}
        {` · 汇率 1 USD = ${st.usd_rate} CNY${C === "USDT" ? `，1 USDT = ${st.cur_rate} CNY` : ""} · ${L.due}按 ${C} 自动逐日挂账`}
      </p>
      {confirmEl}
    </div>
  );
}

function RecordForm({ party: v }: { party: Party }) {
  const { data: me } = useMe();
  const refresh = useLedgerRefresh();
  const qc = useQueryClient();
  const L = PL[v.kind];
  // 供应商默认记实付（付款），客户默认记应收
  const [kind, setKind] = useState<"due" | "paid">(v.kind === "supplier" ? "paid" : "due");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<Currency>(v.currency);
  const [rate, setRate] = useState(v.currency === "CNY" ? "" : String(me?.rates[v.currency] ?? ""));
  const [date, setDate] = useState(todayLocal());
  const [note, setNote] = useState("");
  const [handler, setHandler] = useState(String(me?.user.id ?? ""));
  const [linkEntry, setLinkEntry] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const changeCurrency = (c: Currency) => {
    setCurrency(c);
    setRate(c === "CNY" ? "" : String(me?.rates[c] ?? ""));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const a = parseAmount(amount);
    if (!(a > 0)) return setError("请输入正确的金额");
    const r = currency === "CNY" ? undefined : Number(rate);
    if (currency !== "CNY" && !(Number(r) > 0)) return setError("请填写汇率");
    setBusy(true);
    setError(null);
    try {
      await post(`/parties/${v.id}/records`, {
        kind,
        amount: a,
        currency,
        rate: r,
        date,
        note: note.trim(),
        link_entry: kind === "paid" ? linkEntry : false,
        handler_id: kind === "paid" ? Number(handler) : undefined,
      });
      toast.success(`已记${L[kind]} ${CUR[currency].sym}${fmt(a)}`);
      setAmount("");
      setNote("");
      qc.invalidateQueries({ queryKey: qk.party(v.id) });
      refresh();
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="bg-muted/30 space-y-3 rounded-lg border p-4">
      <ToggleGroup
        type="single"
        variant="outline"
        className="w-full"
        value={kind}
        onValueChange={(k) => k && setKind(k as "due" | "paid")}
      >
        <ToggleGroupItem value="due" className="flex-1">
          记{L.due}
        </ToggleGroupItem>
        <ToggleGroupItem value="paid" className="flex-1">
          记{L.paid}
        </ToggleGroupItem>
      </ToggleGroup>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="rec-amount">金额</Label>
          <Input
            id="rec-amount"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>币种</Label>
          <CurrencySelect value={currency} onChange={changeCurrency} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {currency !== "CNY" ? (
          <div className="space-y-2">
            <Label htmlFor="rec-rate">汇率（1 外币 = ? CNY）</Label>
            <Input id="rec-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="rec-date">日期</Label>
          <Input id="rec-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="rec-note">备注</Label>
        <Input
          id="rec-note"
          maxLength={200}
          placeholder={v.kind === "supplier" ? "例如：9 月服务费" : "例如：第二期款"}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {kind === "paid" ? (
        <>
          <div className="space-y-2">
            <Label>经手人（谁{v.kind === "supplier" ? "付" : "收"}的钱，计入他的资金沉淀）</Label>
            <Select value={handler} onValueChange={setHandler}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {me?.members.map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>
                    {m.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={linkEntry} onCheckedChange={setLinkEntry} />
            同时记入项目流水（{L.entry}）
          </label>
        </>
      ) : null}
      <FormError>{error}</FormError>
      <Button type="submit" className="w-full" disabled={busy}>
        记{L[kind]}
      </Button>
    </form>
  );
}

function RecordList({ party: v, records }: { party: Party; records: import("../types").PartyRecord[] }) {
  const refresh = useLedgerRefresh();
  const qc = useQueryClient();
  const [confirm, confirmEl] = useConfirm();
  const L = PL[v.kind];
  const remove = async (id: number) => {
    if (
      !(await confirm({
        title: "删除这条往来记录？",
        description: "关联的流水也会一并删除。",
        destructive: true,
        confirmText: "删除",
      }))
    )
      return;
    try {
      await del(`/party-records/${id}`);
      toast.success("已删除");
      qc.invalidateQueries({ queryKey: qk.party(v.id) });
      refresh();
    } catch (ex) {
      toast.error((ex as Error).message);
    }
  };
  return (
    <div className="divide-y rounded-lg border">
      {records.map((r) => {
        const locked = r.source === "relay" && !!v.relay;
        return (
          <div key={r.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
            <span className="text-muted-foreground w-20 shrink-0 tabular-nums">{r.date}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate">
                <b>{L[r.kind]}</b>
                {r.source === "relay" ? (
                  <Badge variant="secondary" className="ml-1">
                    自动
                  </Badge>
                ) : null}
                {r.note ? ` · ${r.note}` : ""}
              </div>
              <div className="text-muted-foreground truncate text-xs">
                {r.source === "relay"
                  ? "中转站自动挂账"
                  : `${r.creator_name ? `${r.creator_name} ` : ""}${fmtTime(r.created_at)} 登记${SOURCE_TXT[r.source] ? ` · ${SOURCE_TXT[r.source]}` : ""}`}
                {r.entry_id ? " · 已入流水" : ""}
              </div>
            </div>
            <div
              className={cn(
                "shrink-0 text-right tabular-nums",
                r.kind === "paid" && (v.kind === "supplier" ? "text-expense" : "text-income"),
              )}
            >
              {CUR[r.currency].sym}
              {fmt(r.amount)}
              {r.currency !== "CNY" ? <div className="text-muted-foreground text-xs">≈¥{fmt(r.cny)}</div> : null}
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={locked}
              title={locked ? "自动挂账记录，绑定期间不能删除" : "删除"}
              onClick={() => remove(r.id)}
            >
              <Trash2 />
            </Button>
          </div>
        );
      })}
      {confirmEl}
    </div>
  );
}

function EditPartyForm({
  party: v,
  projectId,
  onBack,
  onDeleted,
}: {
  party: Party;
  projectId?: number;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const refresh = useLedgerRefresh();
  const qc = useQueryClient();
  const [confirm, confirmEl] = useConfirm();
  const L = PL[v.kind];
  const isProjectSupplier = v.kind === "supplier" && !!projectId;
  const [name, setName] = useState(v.name);
  const [contact, setContact] = useState(v.contact);
  const [currency, setCurrency] = useState<Currency>(v.currency);
  const [note, setNote] = useState(v.note);
  const [ratio, setRatio] = useState(String(v.ratio));
  const [settledBase, setSettledBase] = useState(v.kind === "supplier" ? String(v.settled_base ?? 0) : "");
  const [settleType, setSettleType] = useState<"prepaid" | "credit">(v.settle_type === "credit" ? "credit" : "prepaid");
  const [balThreshold, setBalThreshold] = useState(v.balance_threshold == null ? "" : String(v.balance_threshold));
  const [termDays, setTermDays] = useState(v.term_days == null ? "" : String(v.term_days));
  const [startDate, setStartDate] = useState(v.start_date ?? "");
  const [profile, setProfile] = useState(v.profile ?? "");
  const [customerGroup, setCustomerGroup] = useState(v.customer_group ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setError(null), [v.id]);

  const reload = () => {
    qc.invalidateQueries({ queryKey: ["ledger", "party", v.id] });
    qc.invalidateQueries({ queryKey: qk.partyRelay(v.id) });
    refresh();
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = Number(ratio);
    if (!(r > 0)) return setError("倍率必须大于 0");
    try {
      await patch(`/parties/${v.id}`, {
        name,
        contact,
        note,
        currency,
        ratio: r,
        settle_type: settleType,
        profile,
        ...(v.kind === "supplier" ? { settled_base: Number(settledBase) || 0 } : {}),
        ...(v.kind === "customer"
          ? {
              customer_group: customerGroup.trim(),
              balance_threshold: settleType === "prepaid" ? balThreshold : "",
              term_days: settleType === "credit" ? termDays : "",
              start_date: settleType === "credit" ? startDate : "",
            }
          : {}),
      });
      toast.success("已保存");
      reload();
      onBack();
    } catch (ex) {
      setError((ex as Error).message);
    }
  };
  const archive = async () => {
    try {
      if (isProjectSupplier && projectId) {
        const next = !v.project_archived;
        await patch(`/projects/${projectId}/suppliers/${v.id}`, { archived: next });
        toast.success(next ? "已在本项目归档（不影响供应商总列表）" : "已在本项目恢复");
      } else {
        await patch(`/parties/${v.id}`, { archived: !v.archived });
        toast.success(v.archived ? "已恢复" : "已归档");
      }
      reload();
      onBack();
    } catch (ex) {
      setError((ex as Error).message);
    }
  };
  const remove = async () => {
    if (
      !(await confirm({
        title: `删除${L.name}「${v.name}」？`,
        description: "连同全部往来记录一起删除，不可恢复（已入流水的记录不会删除）。",
        destructive: true,
        confirmText: "删除",
      }))
    )
      return;
    try {
      await del(`/parties/${v.id}`);
      toast.success("已删除");
      refresh();
      onDeleted();
    } catch (ex) {
      setError((ex as Error).message);
    }
  };

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>编辑{L.name}</SheetTitle>
      </SheetHeader>
      <form onSubmit={save} className="space-y-4 p-4">
        <div className="space-y-2">
          <Label htmlFor="pe-name">名称</Label>
          <Input id="pe-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pe-contact">联系方式</Label>
            <Input id="pe-contact" maxLength={100} value={contact} onChange={(e) => setContact(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>默认结算币种</Label>
            <CurrencySelect value={currency} onChange={setCurrency} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="pe-note">备注</Label>
          <Input id="pe-note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pe-profile">画像 / 介绍</Label>
          <Textarea
            id="pe-profile"
            maxLength={1000}
            rows={3}
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
          />
        </div>
        {v.kind === "customer" ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="pe-group">客户分组（可选）</Label>
              <Input
                id="pe-group"
                maxLength={60}
                placeholder="同一客户的多个项目填相同分组名，会在客户页合并为一个客户"
                value={customerGroup}
                onChange={(e) => setCustomerGroup(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pe-ratio">默认折扣（没填分组价时用）</Label>
              <Input id="pe-ratio" inputMode="decimal" value={ratio} onChange={(e) => setRatio(e.target.value)} />
            </div>
          </>
        ) : null}
        {v.kind === "customer" ? (
          <>
            <div className="space-y-2">
              <Label>结算方式</Label>
              <Select value={settleType} onValueChange={(x) => setSettleType(x as "prepaid" | "credit")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="prepaid">预付（余额不足发邮件提醒）</SelectItem>
                  <SelectItem value="credit">后付（按账期跟踪欠费）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {settleType === "prepaid" ? (
              <div className="space-y-2">
                <Label htmlFor="pe-threshold">余额提醒阈值（美元，可选）</Label>
                <Input
                  id="pe-threshold"
                  inputMode="decimal"
                  placeholder="如 50，余额低于此值发邮件提醒团队"
                  value={balThreshold}
                  onChange={(e) => setBalThreshold(e.target.value)}
                />
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="pe-term">账期（天）</Label>
                  <Input
                    id="pe-term"
                    inputMode="numeric"
                    placeholder="如 30"
                    value={termDays}
                    onChange={(e) => setTermDays(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pe-start">起始使用时间</Label>
                  <Input id="pe-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
              </div>
            )}
          </>
        ) : null}
        {v.kind === "supplier" ? (
          <>
            <div className="space-y-2">
              <Label>结算方式</Label>
              <Select value={settleType} onValueChange={(x) => setSettleType(x as "prepaid" | "credit")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="prepaid">预付（先充后用，看余额）</SelectItem>
                  <SelectItem value="credit">授信（先用后付，余额按 0）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pe-settled">期初已结算（{currency}）</Label>
              <Input
                id="pe-settled"
                inputMode="decimal"
                placeholder="0"
                value={settledBase}
                onChange={(e) => setSettledBase(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                用这套系统之前已经充值 / 结算过的金额，按结算币种填；之后记账选这个供应商的支出会自动累加
              </p>
            </div>
          </>
        ) : null}
        <FormError>{error}</FormError>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" onClick={onBack}>
            返回
          </Button>
          <Button type="submit">保存</Button>
        </div>
        <Button type="button" variant="outline" className="w-full" onClick={archive}>
          {isProjectSupplier
            ? v.project_archived
              ? "在本项目恢复合作"
              : "在本项目归档"
            : v.archived
              ? "恢复"
              : "归档"}
        </Button>
        {v.kind === "supplier" ? (
          <p className="text-muted-foreground text-xs">
            {isProjectSupplier
              ? "仅在本项目标记为已归档（该供应商在此项目不再发力，本项目应付按实际转出计算），不会从全局供应商列表归档，也不影响其他项目"
              : "不再合作的供应商全局归档后，将从活跃供应商列表隐藏，消费按我们实际转出的钱计算"}
          </p>
        ) : null}
        <Button type="button" variant="outline" className="text-destructive w-full" onClick={remove}>
          删除{L.name}及全部往来记录
        </Button>
      </form>
      {confirmEl}
    </>
  );
}

// 中转制客户的分组收费：只列这个客户能访问的分组，按分组折扣或元/刀计价；可按日期调价（某天及以后按新价）
type GroupRateRow = { id: string; from_date: string; value: string };
type GroupPriceState = { mode: "discount" | "cny"; value: string; rates: GroupRateRow[] };
let groupRateSeq = 0;
const groupRateRow = (r?: { from_date: string; price: number }): GroupRateRow => ({
  id: String(++groupRateSeq),
  from_date: r?.from_date ?? "",
  value: r ? String(r.price) : "",
});

function RelayGroups({ party: v }: { party: Party }) {
  const qc = useQueryClient();
  const refresh = useLedgerRefresh();
  const { data: stations } = useQuery({
    queryKey: ["ledger", "stations"],
    queryFn: () => get<{ stations: Station[] }>("/stations").then((d) => d.stations),
  });
  const relays = (stations ?? []).filter((x) => x.type === "relay");
  const saved = useQuery({
    queryKey: ["ledger", "relay-groups", v.id],
    queryFn: () =>
      get<{ groups: { station_id: number; group_name: string; price: number; price_mode?: string; rates?: { from_date: string; price: number; price_mode?: string }[] }[] }>(
        `/parties/${v.id}/relay-groups`,
      ).then((d) => d.groups),
  });
  const [stationId, setStationId] = useState("");
  const [prices, setPrices] = useState<Record<string, GroupPriceState>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!saved.data) return;
    setStationId(saved.data[0] ? String(saved.data[0].station_id) : relays[0] ? String(relays[0].id) : "");
    setPrices(
      Object.fromEntries(
        saved.data.map((g) => [
          g.group_name,
          {
            mode: g.price_mode === "discount" ? "discount" : "cny",
            value: g.price_mode === "discount" ? String(Math.round(g.price * 10000) / 100) : String(g.price),
            rates: (g.rates ?? []).map(groupRateRow),
          },
        ]),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.data]);

  const sid = Number(stationId);
  const groups = useQuery({
    queryKey: ["ledger", "station-groups", sid, v.id],
    queryFn: () => get<{ groups: { name: string }[] }>(`/stations/${sid}/groups?party=${v.id}`).then((d) => d.groups),
    enabled: sid > 0,
  });

  const setGroup = (name: string, patch: Partial<GroupPriceState>) =>
    setPrices((x) => ({ ...x, [name]: { ...(x[name] ?? { mode: "discount" as const, value: "", rates: [] }), ...patch } }));

  const save = async () => {
    if (!(sid > 0)) return toast.error("请选择中转站");
    const RE = /^\d{4}-\d{2}-\d{2}$/;
    for (const [name, p] of Object.entries(prices)) {
      for (const r of p.rates) {
        const filled = r.from_date.trim() || r.value.trim();
        if (!filled) continue;
        if (!RE.test(r.from_date.trim()) || !(Number(r.value) > 0))
          return toast.error(`「${name}」的调价要填日期（YYYY-MM-DD）和大于 0 的价格`);
      }
    }
    setBusy(true);
    try {
      const visible = new Set((groups.data ?? []).map((g) => g.name));
      await put(`/parties/${v.id}/relay-groups`, {
        station_id: sid,
        groups: Object.entries(prices)
          .filter(([name, p]) => p.value.trim() !== "" && visible.has(name))
          .map(([group_name, p]) => ({
            group_name,
            price: Number(p.value) || 0,
            mode: p.mode,
            rates: p.rates
              .filter((r) => r.from_date.trim() && r.value.trim())
              .map((r) => ({ from_date: r.from_date.trim(), price: Number(r.value) || 0, mode: p.mode })),
          })),
      });
      toast.success("分组收费已保存，应收和预估利润已按分组重算");
      qc.invalidateQueries({ queryKey: ["ledger", "relay-groups", v.id] });
      qc.invalidateQueries({ queryKey: ["ledger", "station-groups", sid, v.id] });
      qc.invalidateQueries({ queryKey: ["ledger", "customers"] });
      qc.invalidateQueries({ queryKey: ["ledger", "customer-detail"] });
      qc.invalidateQueries({ queryKey: ["ledger", "profit-daily"] });
      refresh();
    } catch (ex) {
      toast.error((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const chosen = Object.values(prices).filter((p) => p.value.trim() !== "").length;
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div>
        <b className="text-sm">分组收费</b>
        <p className="text-muted-foreground text-xs">
          只显示这个客户在中转站可访问的分组。填折扣（68 = 68 折，按汇率折人民币）或每刀多少元；可加按日期调价，某天及以后的消耗按新价
        </p>
      </div>
      {relays.length ? (
        <Select value={stationId} onValueChange={setStationId}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="选择中转站" />
          </SelectTrigger>
          <SelectContent>
            {relays.map((x) => (
              <SelectItem key={x.id} value={String(x.id)}>
                {x.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <p className="text-muted-foreground text-xs">还没有中转站，先到侧边栏「台子管理」里添加</p>
      )}
      {groups.isLoading ? <Skeleton className="h-16" /> : null}
      {groups.data && !groups.data.length ? (
        <p className="text-muted-foreground text-xs">这个客户在中转站没有可访问的分组</p>
      ) : null}
      {groups.data ? (
        <div className="space-y-2">
          {groups.data.map((g) => {
            const row = prices[g.name] ?? { mode: "discount" as const, value: "", rates: [] };
            return (
              <div key={g.name} className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{g.name}</span>
                  <Select
                    value={row.mode}
                    onValueChange={(mode) =>
                      setGroup(g.name, { mode: mode === "cny" ? "cny" : "discount" })
                    }
                  >
                    <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="discount">折扣</SelectItem>
                      <SelectItem value="cny">元/刀</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    inputMode="decimal"
                    className="w-24"
                    placeholder={row.mode === "discount" ? "68" : "4.5"}
                    value={row.value}
                    onChange={(e) => setGroup(g.name, { value: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    title="某天起改用新价"
                    onClick={() => setGroup(g.name, { rates: [...row.rates, groupRateRow()] })}
                  >
                    <Plus className="size-3.5" />
                  </Button>
                </div>
                {row.rates.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 pl-4">
                    <span className="text-muted-foreground shrink-0 text-xs">
                      <Input
                        type="date"
                        className="h-7 w-36"
                        value={r.from_date}
                        onChange={(e) =>
                          setGroup(g.name, { rates: row.rates.map((x) => (x.id === r.id ? { ...x, from_date: e.target.value } : x)) })
                        }
                      />
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs">起按</span>
                    <Input
                      inputMode="decimal"
                      className="h-7 w-24"
                      placeholder={row.mode === "discount" ? "新折扣" : "新单价"}
                      value={r.value}
                      onChange={(e) =>
                        setGroup(g.name, { rates: row.rates.map((x) => (x.id === r.id ? { ...x, value: e.target.value } : x)) })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      title="删除这一档"
                      onClick={() => setGroup(g.name, { rates: row.rates.filter((x) => x.id !== r.id) })}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ) : null}
      <Button className="w-full" onClick={save} disabled={busy || !groups.data}>
        保存分组收费{chosen ? `（${chosen} 个分组）` : ""}
      </Button>
    </div>
  );
}
