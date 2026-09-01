import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { bridge } from '../lib/bridge';
import { useApp } from '../store/app';
import { Logo } from './Connect';

export function Login(): JSX.Element {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({
    email: '',
    password: '',
    username: '',
    displayName: '',
    inviteCode: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Preenche o e-mail da última vez. A senha não é guardada em lugar nenhum.
  useEffect(() => {
    void bridge.getConfig().then((config) => {
      if (config.lastEmail) setForm((current) => ({ ...current, email: config.lastEmail as string }));
    });
  }, []);

  const login = useApp((s) => s.login);
  const register = useApp((s) => s.register);
  const apiUrl = useApp((s) => s.apiUrl);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') {
        await login(form.email, form.password);
      } else {
        await register({
          email: form.email,
          password: form.password,
          username: form.username.toLowerCase(),
          displayName: form.displayName || form.username,
          ...(form.inviteCode ? { inviteCode: form.inviteCode } : {}),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível entrar.');
    } finally {
      setBusy(false);
    }
  }

  const field = (
    label: string,
    key: keyof typeof form,
    type = 'text',
    hint?: string,
  ): JSX.Element => (
    <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-mist-400">
      {label}
      <input
        type={type}
        value={form[key]}
        onChange={(event) => setForm({ ...form, [key]: event.target.value })}
        onKeyDown={(event) => event.key === 'Enter' && void submit()}
        className="mt-1.5 w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm normal-case tracking-normal text-mist-50 focus:border-pulse-400 focus:outline-none"
      />
      {hint && <span className="mt-1 block normal-case tracking-normal text-[11px]">{hint}</span>}
    </label>
  );

  return (
    <div className="flex h-full items-center justify-center bg-ink-900">
      <div className="w-[420px] rounded-2xl border border-ink-700 bg-ink-850 p-8 shadow-2xl">
        <Logo />
        <h1 className="mt-5 text-xl font-semibold">
          {mode === 'login' ? 'Bem-vindo de volta' : 'Criar conta'}
        </h1>
        <p className="mt-1 text-sm text-mist-400">{apiUrl}</p>

        {field('E-mail', 'email', 'email')}
        {mode === 'register' && field('Nome de usuário', 'username', 'text', 'minúsculas, sem espaços')}
        {mode === 'register' && field('Nome de exibição', 'displayName')}
        {field('Senha', 'password', 'password', mode === 'register' ? 'mínimo 10 caracteres' : undefined)}
        {mode === 'register' && field('Código de convite', 'inviteCode', 'text', 'se o servidor exigir')}

        {error && <p className="mt-3 text-sm text-alert-500">{error}</p>}

        <button
          disabled={busy}
          onClick={() => void submit()}
          className="mt-6 w-full rounded-lg bg-pulse-500 py-2.5 font-medium text-white transition-colors hover:bg-pulse-400 disabled:opacity-40"
        >
          {busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}
        </button>

        <button
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError(null);
          }}
          className="mt-4 w-full text-sm text-mist-400 hover:text-mist-50"
        >
          {mode === 'login' ? 'Não tenho conta ainda' : 'Já tenho uma conta'}
        </button>
      </div>
    </div>
  );
}
