import { AuthShell } from "../_components/auth-shell";
import { LoginForm } from "../_components/login-form";

export default function LoginPage() {
  return (
    <AuthShell title="登录" subtitle="用用户名或手机号 + 密码登录">
      <div className="space-y-4">
        <LoginForm />
        <p className="text-muted-foreground text-center text-xs">注册已关闭，请使用已有账号登录</p>
      </div>
    </AuthShell>
  );
}
