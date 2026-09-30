import Link from "next/link";

import { AuthShell } from "../_components/auth-shell";
import { RegisterForm } from "../_components/register-form";

export default function RegisterPage() {
  return (
    <AuthShell title="注册" subtitle="用同一个网址注册的成员自动加入同一个团队">
      <div className="space-y-4">
        <RegisterForm />
        <p className="text-muted-foreground text-center text-xs">
          已有账号？{" "}
          <Link prefetch={false} href="/auth/login" className="text-primary">
            去登录
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
