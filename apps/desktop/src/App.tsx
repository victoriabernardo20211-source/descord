import { useEffect } from 'react';
import type { JSX } from 'react';
import { useApp } from './store/app';
import { Connect } from './screens/Connect';
import { Login } from './screens/Login';
import { Home } from './screens/Home';

export function App(): JSX.Element {
  const status = useApp((s) => s.status);
  const boot = useApp((s) => s.boot);

  useEffect(() => {
    void boot();
  }, [boot]);

  if (status === 'boot') {
    return (
      <div className="flex h-full items-center justify-center bg-ink-900 text-mist-400">
        Carregando…
      </div>
    );
  }
  if (status === 'needs-server' || status === 'server-unreachable') return <Connect />;
  if (status === 'login') return <Login />;
  return <Home />;
}
