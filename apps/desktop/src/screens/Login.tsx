import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { ApiError } from '../lib/api';
import { bridge } from '../lib/bridge';
import { useApp } from '../store/app';
import { AuthShell, Card, Field, INPUT, PRIMARY } from './Connect';

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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // Preenche o e-mail da última vez. A senha não é guardada em lugar nenhum.
  useEffect(() => {
    void bridge.getConfig().then((config) => {
      if (config.lastEmail) setForm((current) => ({ ...current, email: config.lastEmail as string }));
    });
  }, []);

  const login = useApp((s) => s.login);
  const register = useApp((s) => s.register);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    setFieldErrors({});
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
      // "Dados inválidos" sozinho não ajuda ninguém: o servidor diz qual campo
      // recusou e por quê, e é isso que precisa aparecer sob o campo.
      if (err instanceof ApiError && err.issues.length > 0) {
        setFieldErrors(
          Object.fromEntries(err.issues.map((issue) => [issue.path, issue.message])),
        );
        setError('Confira os campos destacados.');
      } else {
        setError(err instanceof Error ? err.message : 'Não foi possível entrar.');
      }
    } finally {
      setBusy(false);
    }
  }

  const field = (
    label: string,
    key: keyof typeof form,
    type = 'text',
    hint?: string,
  ): JSX.Element => {
    const issue = fieldErrors[key];
    return (
      <Field label={label}>
        <input
          type={type}
          value={form[key]}
          onChange={(event) => {
            // O arroba é como as pessoas pensam em nome de usuário, mas não faz
            // parte dele. Tiramos em vez de recusar o cadastro por causa disso.
            const raw = event.target.value;
            const value = key === 'username' ? raw.replace(/^@+/, '').toLowerCase() : raw;
            setForm({ ...form, [key]: value });
            if (issue) setFieldErrors((current) => ({ ...current, [key]: '' }));
          }}
          onKeyDown={(event) => event.key === 'Enter' && void submit()}
          className={`${INPUT} ${issue ? 'border-alert-500' : ''}`}
        />
        {issue ? (
          <span className="text-[11px] text-alert-500">{issue}</span>
        ) : (
          hint && <span className="text-[11px] text-mist-500">{hint}</span>
        )}
      </Field>
    );
  };

  const isLogin = mode === 'login';

  return (
    <AuthShell width={isLogin ? 392 : 420}>
      <Card>
        <div className="flex flex-col items-center gap-1.5">
          <h1 className="text-[19px] font-semibold text-mist-50">
            {isLogin ? 'Bem-vindo de volta' : 'Criar sua conta'}
          </h1>
          {isLogin && (
            <p className="text-[13px] text-mist-400">Que bom te ver de novo por aqui.</p>
          )}
        </div>

        {field('E-mail', 'email', 'email')}
        {!isLogin && field('Nome de usuário', 'username', 'text', 'minúsculas, sem espaços')}
        {!isLogin && field('Nome de exibição', 'displayName')}
        {field('Senha', 'password', 'password', isLogin ? undefined : 'mínimo 10 caracteres')}
        {!isLogin && field('Código de convite', 'inviteCode', 'text', 'se o servidor exigir')}

        {error && <p className="text-[12.5px] text-alert-500">{error}</p>}

        <button disabled={busy} onClick={() => void submit()} className={PRIMARY}>
          {busy ? 'Aguarde…' : isLogin ? 'Entrar' : 'Criar conta'}
        </button>

        <button
          onClick={() => {
            setMode(isLogin ? 'register' : 'login');
            setError(null);
            setFieldErrors({});
          }}
          className="text-center text-[12.5px] text-mist-400 transition-colors hover:text-mist-200"
        >
          {isLogin ? 'Precisa de uma conta? ' : 'Já possui conta? '}
          <span className="text-pulse-300">{isLogin ? 'Criar conta' : 'Entrar'}</span>
        </button>
      </Card>
    </AuthShell>
  );
}
