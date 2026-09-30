"use client";

import { useState } from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { post } from "@/modules/ledger/api";
import { FormError } from "@/modules/ledger/components/shared";
import { greeting } from "@/modules/ledger/format";
import type { Me } from "@/modules/ledger/types";

const FormSchema = z.object({
  account: z.string().trim().min(1, { message: "请输入用户名或手机号" }),
  password: z.string().min(1, { message: "请输入密码" }),
});

// 登录成功后回到原来想去的页面（只允许站内路径）
export function afterAuth(d: Me) {
  toast(`${greeting()}，${d.user.username}`);
  const next = new URLSearchParams(window.location.search).get("next");
  window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard/ledger";
}

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: { account: "", password: "" },
  });

  const onSubmit = async (data: z.infer<typeof FormSchema>) => {
    setError(null);
    try {
      afterAuth(await post<Me>("/auth/login", data));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="account"
          render={({ field }) => (
            <FormItem>
              <FormLabel>用户名或手机号</FormLabel>
              <FormControl>
                <Input autoComplete="username" autoFocus {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>密码</FormLabel>
              <FormControl>
                <Input type="password" placeholder="••••••••" autoComplete="current-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormError>{error}</FormError>
        <Button className="w-full" type="submit" disabled={form.formState.isSubmitting}>
          登录
        </Button>
      </form>
    </Form>
  );
}
