import Link from "next/link";

import { AuthShell } from "../_components/auth-shell";

export default function RegisterPage() {
  return (
    <AuthShell title="注册已关闭" subtitle="不再开放自助注册，请使用已有账号登录">
      <p className="text-muted-foreground text-center text-xs">
        <Link prefetch={false} href="/auth/login" className="text-primary">
          去登录
        </Link>
      </p>
    </AuthShell>
  );
}
