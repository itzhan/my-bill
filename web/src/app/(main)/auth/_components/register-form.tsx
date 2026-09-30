"use client";

import { useState } from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { post } from "@/modules/ledger/api";
import { FormError } from "@/modules/ledger/components/shared";
import type { Me } from "@/modules/ledger/types";

import { afterAuth } from "./login-form";

// 校验规则与旧版一致
const FormSchema = z.object({
  username: z
    .string()
    .trim()
    .regex(/^[\w一-龥]{2,20}$/, { message: "用户名为 2–20 位中文、字母、数字或下划线" }),
  phone: z
    .string()
    .trim()
    .refine((v) => /^\+?\d{6,20}$/.test(v.replace(/[\s-]/g, "")), { message: "手机号格式不正确" }),
  password: z.string().min(6, { message: "密码至少 6 位" }),
});

export function RegisterForm() {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: { username: "", phone: "", password: "" },
  });

  const onSubmit = async (data: z.infer<typeof FormSchema>) => {
    setError(null);
    try {
      afterAuth(await post<Me>("/auth/register", data));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="username"
          render={({ field }) => (
            <FormItem>
              <FormLabel>用户名</FormLabel>
              <FormControl>
                <Input autoComplete="username" autoFocus {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>手机号</FormLabel>
              <FormControl>
                <Input inputMode="tel" autoComplete="tel" {...field} />
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
                <Input type="password" placeholder="至少 6 位" autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormError>{error}</FormError>
        <Button className="w-full" type="submit" disabled={form.formState.isSubmitting}>
          注册并登录
        </Button>
      </form>
    </Form>
  );
}
