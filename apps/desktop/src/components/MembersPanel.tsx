import { useMemo } from 'react';
import type { JSX } from 'react';
import { Avatar } from './Avatar';
import { useApp } from '../store/app';

/** Lista de membros do servidor, agrupada por presença. */
export function MembersPanel(): JSX.Element {
  const detail = useApp((s) => s.serverDetail);
  const presences = useApp((s) => s.presences);

  const groups = useMemo(() => {
    const members = detail?.members ?? [];
    const online = members.filter((m) => (presences[m.userId]?.status ?? 'OFFLINE') !== 'OFFLINE');
    const offline = members.filter((m) => (presences[m.userId]?.status ?? 'OFFLINE') === 'OFFLINE');
    return [
      { label: `ONLINE — ${online.length}`, items: online, dim: false },
      { label: `OFFLINE — ${offline.length}`, items: offline, dim: true },
    ].filter((g) => g.items.length > 0);
  }, [detail, presences]);

  return (
    <aside className="w-members shrink-0 overflow-y-auto border-l border-ink-950 bg-ink-900 px-2 py-3">
      {groups.map((group) => (
        <div key={group.label} className="mb-3.5">
          <p className="px-2 pb-1.5 text-[10.5px] font-bold tracking-[0.07em] text-mist-500">
            {group.label}
          </p>
          {group.items.map((member) => (
            <div
              key={member.userId}
              className={`flex h-10 items-center gap-2.5 rounded-md px-2 transition-colors hover:bg-ink-850 ${
                group.dim ? 'opacity-45' : ''
              }`}
            >
              <Avatar
                name={member.nickname ?? member.user.displayName}
                url={member.user.avatarUrl}
                size={30}
                status={presences[member.userId]?.status ?? 'OFFLINE'}
                ringColor="#101114"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] text-mist-200">
                  {member.nickname ?? member.user.displayName}
                </span>
                <span className="block truncate text-[11px] text-mist-500">
                  @{member.user.username}
                </span>
              </span>
            </div>
          ))}
        </div>
      ))}
    </aside>
  );
}
