import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ROLES, canManageRole, type Me, type Member, type Role } from '@afrikaisse/core';
import { api } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { ROLE_LABELS, formatDateTime } from '../labels.ts';
import { Dialog, ErrorMessage, Icon, OkMessage, Window } from '../ui.tsx';

type DialogState = null | { kind: 'add' } | { kind: 'edit'; member: Member } | { kind: 'password'; member: Member } | { kind: 'disable'; member: Member };

export function TeamPage({ me }: { me: Me }) {
  const { t, lang, locale } = useI18n();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const myRole = me.role!;
  const canManage = me.permissions.includes('users.manage');
  const grantable = ROLES.filter((r) => canManageRole(myRole, r));
  const selected = members?.find((m) => m.membershipId === selectedId) ?? null;
  const editable = (m: Member | null): m is Member => !!m && canManage && m.userId !== me.user.id && canManageRole(myRole, m.role);
  const locationName = (id: string | null) => (id ? (me.locations.find((l) => l.id === id)?.name ?? '—') : t('common.all'));

  const load = useCallback(async () => {
    setError(null);
    try {
      setMembers(await api<Member[]>('GET', '/team'));
    } catch (err) {
      setError(err);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const replace = (updated: Member) => setMembers((list) => list?.map((m) => (m.membershipId === updated.membershipId ? updated : m)) ?? null);

  async function setStatus(member: Member, status: 'ACTIVE' | 'DISABLED') {
    setError(null);
    try {
      replace(await api<Member>('PATCH', `/team/${member.membershipId}`, { status }));
      setNotice(t('common.saved'));
    } catch (err) {
      setError(err);
    }
    setDialog(null);
  }

  const toolbar = (
    <>
      {canManage && (
        <button className="btn" onClick={() => setDialog({ kind: 'add' })}>
          <Icon name="add" />
          {t('team.add')}
        </button>
      )}
      <button className="btn" disabled={!editable(selected)} onClick={() => editable(selected) && setDialog({ kind: 'edit', member: selected })}>
        <Icon name="edit" />
        {t('common.edit')}
      </button>
      <button
        className="btn"
        disabled={!editable(selected)}
        onClick={() => {
          if (!editable(selected)) return;
          if (selected.status === 'ACTIVE') setDialog({ kind: 'disable', member: selected });
          else void setStatus(selected, 'ACTIVE');
        }}
      >
        <Icon name="power" />
        {selected?.status === 'DISABLED' ? t('team.enable') : t('team.disable')}
      </button>
      <button className="btn" disabled={!editable(selected) || selected.sharedAccount} onClick={() => editable(selected) && setDialog({ kind: 'password', member: selected })}>
        <Icon name="key" />
        {t('team.resetPassword')}
      </button>
      <span className="sep" />
      <button className="btn" onClick={load}>
        <Icon name="refresh" />
        {t('common.refresh')}
      </button>
    </>
  );

  return (
    <>
      <Window className="nuage-bleu" title={t('team.title')} count={members ? `${members.length} ${t('team.count')}` : undefined} toolbar={toolbar} bodyless>
        {(error || notice) && (
          <div className="window-body" style={{ paddingBottom: 0 }}>
            <ErrorMessage error={error} />
            {notice && !error && <OkMessage>{notice}</OkMessage>}
          </div>
        )}
        <div className="grid-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>{t('team.name')}</th>
                <th>{t('auth.email')}</th>
                <th>{t('team.role')}</th>
                <th>{t('team.location')}</th>
                <th>{t('team.status')}</th>
                <th>{t('team.createdAt')}</th>
              </tr>
            </thead>
            <tbody>
              {members === null && (
                <tr>
                  <td className="empty" colSpan={6}>
                    {t('common.loading')}
                  </td>
                </tr>
              )}
              {members?.map((m) => (
                <tr
                  key={m.membershipId}
                  className="selectable"
                  aria-selected={m.membershipId === selectedId}
                  onClick={() => setSelectedId(m.membershipId)}
                  onDoubleClick={() => editable(m) && setDialog({ kind: 'edit', member: m })}
                >
                  <td>
                    {m.displayName}
                    {m.userId === me.user.id && <span className="tag">{t('team.you')}</span>}
                    {m.sharedAccount && (
                      <span className="tag" title={t('team.sharedHint')}>
                        {t('team.shared')}
                      </span>
                    )}
                  </td>
                  <td>{m.email}</td>
                  <td>{ROLE_LABELS[lang][m.role]}</td>
                  <td>{locationName(m.locationId)}</td>
                  <td>
                    <span className={m.status === 'ACTIVE' ? 'state state-ok' : 'state state-off'}>
                      <span className={m.status === 'ACTIVE' ? 'dot dot-ok' : 'dot dot-off'} />
                      {m.status === 'ACTIVE' ? t('team.active') : t('team.disabled')}
                    </span>
                  </td>
                  <td className="num">{formatDateTime(m.createdAt, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Window>

      {dialog?.kind === 'add' && (
        <MemberDialog
          me={me}
          grantable={grantable}
          onClose={() => setDialog(null)}
          onSaved={(m) => {
            setMembers((list) => [...(list ?? []), m]);
            setSelectedId(m.membershipId);
            setNotice(t('common.saved'));
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'edit' && (
        <MemberDialog
          me={me}
          grantable={grantable}
          member={dialog.member}
          onClose={() => setDialog(null)}
          onSaved={(m) => {
            replace(m);
            setNotice(t('common.saved'));
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'password' && (
        <PasswordDialog
          member={dialog.member}
          onClose={() => setDialog(null)}
          onDone={() => {
            setNotice(t('team.passwordSet'));
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'disable' && (
        <Dialog
          title={`${t('team.disable')} — ${dialog.member.displayName}`}
          onClose={() => setDialog(null)}
          footer={
            <>
              <button className="btn btn-primary" onClick={() => setStatus(dialog.member, 'DISABLED')}>
                {t('team.disable')}
              </button>
              <button className="btn" onClick={() => setDialog(null)}>
                {t('common.cancel')}
              </button>
            </>
          }
        >
          <div className="dialog-body">{t('team.disableConfirm')}</div>
        </Dialog>
      )}
    </>
  );
}

function MemberDialog({ me, grantable, member, onSaved, onClose }: { me: Me; grantable: Role[]; member?: Member; onSaved: (m: Member) => void; onClose: () => void }) {
  const { t, lang } = useI18n();
  const [form, setForm] = useState({
    displayName: member?.displayName ?? '',
    email: member?.email ?? '',
    password: '',
    role: member?.role ?? (grantable.includes('WAITER') ? 'WAITER' : grantable[0]!),
    locationId: member?.locationId ?? '',
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!member) {
        onSaved(
          await api<Member>('POST', '/team', {
            displayName: form.displayName,
            email: form.email,
            role: form.role,
            locationId: form.locationId || null,
            ...(form.password && { password: form.password }),
          }),
        );
        return;
      }
      const changes: Record<string, unknown> = {};
      if (form.role !== member.role) changes.role = form.role;
      if ((form.locationId || null) !== member.locationId) changes.locationId = form.locationId || null;
      if (form.displayName !== member.displayName) changes.displayName = form.displayName;
      onSaved(Object.keys(changes).length ? await api<Member>('PATCH', `/team/${member.membershipId}`, changes) : member);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Dialog
        title={member ? `${t('team.editTitle')} — ${member.displayName}` : t('team.add')}
        onClose={onClose}
        footer={
          <>
            <button className="btn btn-primary" disabled={busy}>
              {t('common.save')}
            </button>
            <button type="button" className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
          </>
        }
      >
        <div className="dialog-body">
          <ErrorMessage error={error} />
          <div className="form">
            <label htmlFor="m-name">{t('team.name')}</label>
            <input id="m-name" required minLength={2} autoFocus disabled={member?.sharedAccount} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
            <label htmlFor="m-email">{t('auth.email')}</label>
            <input id="m-email" type="email" required readOnly={!!member} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <label htmlFor="m-role">{t('team.role')}</label>
            <select id="m-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {grantable.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[lang][r]}
                </option>
              ))}
            </select>
            <label htmlFor="m-location">{t('team.location')}</label>
            <select id="m-location" value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })}>
              <option value="">{t('common.all')}</option>
              {me.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            {!member && (
              <>
                <label htmlFor="m-password">{t('team.initialPassword')}</label>
                <input id="m-password" type="password" minLength={10} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </>
            )}
          </div>
        </div>
      </Dialog>
    </form>
  );
}

function PasswordDialog({ member, onDone, onClose }: { member: Member; onDone: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('POST', `/team/${member.membershipId}/password`, { password });
      onDone();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <form onSubmit={submit}>
      <Dialog
        title={`${t('team.passwordTitle')} — ${member.displayName}`}
        onClose={onClose}
        footer={
          <>
            <button className="btn btn-primary">{t('common.save')}</button>
            <button type="button" className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
          </>
        }
      >
        <div className="dialog-body">
          <ErrorMessage error={error} />
          <div className="form">
            <label htmlFor="p-new">{t('account.newPassword')}</label>
            <input id="p-new" type="password" required minLength={10} autoFocus autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <span className="hint">{t('auth.passwordHint')}</span>
          </div>
        </div>
      </Dialog>
    </form>
  );
}
