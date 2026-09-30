"use client";

import { useCallback } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { get } from "./api";
import type {
  Channel,
  ExportItem,
  AutoExport,
  Knowledge,
  Me,
  PartyDetail,
  Proposal,
  ProjectDetail,
  ProjectRelay,
  ProjectsResponse,
  Report,
} from "./types";

export const qk = {
  me: ["ledger", "me"] as const,
  projects: ["ledger", "projects"] as const,
  project: (id: number) => ["ledger", "project", id] as const,
  projectRelay: (id: number) => ["ledger", "project-relay", id] as const,
  party: (id: number) => ["ledger", "party", id] as const,
  partyRelay: (id: number) => ["ledger", "party-relay", id] as const,
  report: (qs: string) => ["ledger", "report", qs] as const,
  exports: ["ledger", "exports"] as const,
  channels: ["ledger", "channels"] as const,
  chat: (tab: string) => ["ledger", "chat", tab] as const,
  knowledge: ["ledger", "knowledge"] as const,
  proposals: ["ledger", "proposals"] as const,
};

export const useMe = () => useQuery({ queryKey: qk.me, queryFn: () => get<Me>("/me"), retry: false });

export const useProjects = () => useQuery({ queryKey: qk.projects, queryFn: () => get<ProjectsResponse>("/projects") });

export const useProject = (id: number) =>
  useQuery({ queryKey: qk.project(id), queryFn: () => get<ProjectDetail>(`/projects/${id}`), retry: false });

export const useProjectRelay = (id: number, enabled: boolean) =>
  useQuery({
    queryKey: qk.projectRelay(id),
    queryFn: () => get<ProjectRelay>(`/projects/${id}/relay`),
    enabled,
    refetchInterval: 30_000,
  });

export const useParty = (id: number | null) =>
  useQuery({ queryKey: qk.party(id ?? 0), queryFn: () => get<PartyDetail>(`/parties/${id}`), enabled: !!id });

export const useReport = (qs: string, enabled = true) =>
  useQuery({
    queryKey: qk.report(qs),
    queryFn: () => get<Report>(`/report?${qs}`),
    enabled,
    placeholderData: (p) => p,
  });

export const useExports = () =>
  useQuery({
    queryKey: qk.exports,
    queryFn: () => get<{ exports: ExportItem[]; auto_export: AutoExport }>("/exports"),
  });

export const useChannels = () =>
  useQuery({ queryKey: qk.channels, queryFn: () => get<{ channels: Channel[] }>("/channels").then((d) => d.channels) });

export const usePendingProposals = () =>
  useQuery({
    queryKey: qk.proposals,
    queryFn: () =>
      get<{ proposals: Proposal[] }>("/proposals").then((d) => d.proposals.filter((p) => p.status === "pending")),
  });

export const useKnowledge = () => useQuery({ queryKey: qk.knowledge, queryFn: () => get<Knowledge>("/knowledge") });

// 写操作之后立即刷新账目相关数据（SSE 也会推送 changed，这里不等它）
export function useLedgerRefresh() {
  const qc = useQueryClient();
  return useCallback(() => {
    for (const key of ["projects", "project", "party", "report", "project-relay"]) {
      qc.invalidateQueries({ queryKey: ["ledger", key] });
    }
  }, [qc]);
}
