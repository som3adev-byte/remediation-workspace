import { Suspense } from 'react';
import { LoginForm } from '@/components/login-form';

export const metadata = { title: 'Sign in · Remediation Workspace' };

export default function LoginPage() {
  return (
    <main className="login-page">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
