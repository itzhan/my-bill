import Link from "next/link";

import { AuthShell } from "../_components/auth-shell";
import { LoginForm } from "../_components/login-form";

export default function LoginPage() {
  return (
    <AuthShell title="登录" subtitle="用用户名或手机号 + 密码登录">
      <div className="space-y-4">
        <LoginForm />
        <p className="text-muted-foreground text-center text-xs">
          还没有账号？{" "}
          <Link prefetch={false} href="/auth/register" className="text-primary">
            立即注册
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
