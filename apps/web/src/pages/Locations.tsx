import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CURRENCY_CODES, LOCATION_TYPES, OPERATING_MODES, type LocalServerDevice, type LocationDetails, type Me, type PairingCode } from '@afrikaisse/core';
import { api } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { COUNTRIES, CUTOFF_OPTIONS, LOCATION_TYPE_LABELS, OPERATING_MODE_LABELS, TIMEZONES, formatMinutes } from '../labels.ts';
import { Dialog, ErrorMessage, Icon, OkMessage, Window } from '../ui.tsx';

type DialogState = null | { kind: 'form'; location?: LocationDetails } | { kind: 'archive'; location: LocationDetails };

export function LocationsPage({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const { t } = useI18n();
  const canManage = me.permissions.includes('location.manage') && !me.locationId;
  const [list, setList] = useState<LocationDetails[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selected = list?.find((l) => l.id === selectedId) ?? null;
  const [isCloud, setIsCloud] = useState(false);
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [devicesFor, setDevicesFor] = useState<LocationDetails | null>(null);
  useEffect(() => {
    api<{ profile: string }>('GET', '/health').then((h) => setIsCloud(h.profile === 'cloud'), () => undefined);
  }, []);

  async function createPairingCode(location: LocationDetails) {
    setError(null);
    setNotice(null);
    try {
      setPairing(await api<PairingCode>('POST', `/locations/${location.id}/pairing-code`));
    } catch (err) {
      setError(err);
    }
  }

  const load = useCallback(async () => {
    setError(null);
    try {
      setList(await api<LocationDetails[]>('GET', `/locations?includeArchived=${showArchived}`));
    } catch (err) {
      setError(err);
    }
  }, [showArchived]);
  useEffect(() => {
    void load();
  }, [load]);

  function applySaved(location: LocationDetails) {
    setList((current) => {
      const others = (current ?? []).filter((l) => l.id !== location.id);
      const visible = showArchived || location.status === 'ACTIVE';
      return (visible ? [...others, location] : others).sort((a, b) => a.name.localeCompare(b.name));
    });
    setSelectedId(showArchived || location.status === 'ACTIVE' ? location.id : null);
    setNotice(t('common.saved'));
    setDialog(null);
    onChanged();
  }

  async function changeStatus(location: LocationDetails, action: 'archive' | 'restore') {
    setError(null);
    setNotice(null);
    try {
      applySaved(await api<LocationDetails>('POST', `/locations/${location.id}/${action}`));
    } catch (err) {
      setError(err);
      setDialog(null);
    }
  }

  const toolbar = (
    <>
      {canManage && (
        <>
          <button className="btn" onClick={() => setDialog({ kind: 'form' })}>
            <Icon name="add" />
            {t('loc.add')}
          </button>
          <button className="btn" disabled={!selected} onClick={() => selected && setDialog({ kind: 'form', location: selected })}>
            <Icon name="edit" />
            {t('common.edit')}
          </button>
          {selected?.status === 'ARCHIVED' ? (
            <button className="btn" onClick={() => changeStatus(selected, 'restore')}>
              <Icon name="power" />
              {t('loc.restore')}
            </button>
          ) : (
            <button className="btn" disabled={!selected} onClick={() => selected && setDialog({ kind: 'archive', location: selected })}>
              <Icon name="archive" />
              {t('loc.archive')}
            </button>
          )}
          {isCloud && (
            <>
              <button className="btn" disabled={!selected || selected.status !== 'ACTIVE'} onClick={() => selected && void createPairingCode(selected)}>
                <Icon name="server" />
                Relier un serveur local
              </button>
              <button className="btn" disabled={!selected} onClick={() => setDevicesFor(selected)}>
                <Icon name="key" />
                Serveurs reliés
              </button>
            </>
          )}
          <span className="sep" />
        </>
      )}
      <label className="check">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        {t('loc.showArchived')}
      </label>
      <span className="sep" />
      <button className="btn" onClick={load}>
        <Icon name="refresh" />
        {t('common.refresh')}
      </button>
    </>
  );

  return (
    <>
      <Window title={t('loc.title')} count={list ? `${list.length} ${t('loc.count')}` : undefined} toolbar={toolbar} bodyless>
        {(!!error || notice) && (
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
                <th>{t('auth.locationType')}</th>
                <th>{t('loc.mode')}</th>
                <th>{t('auth.country')}</th>
                <th>{t('auth.currency')}</th>
                <th>{t('loc.cutoff')}</th>
                <th>{t('team.status')}</th>
              </tr>
            </thead>
            <tbody>
              {list === null && (
                <tr>
                  <td className="empty" colSpan={7}>
                    {t('common.loading')}
                  </td>
                </tr>
              )}
              {list?.map((l) => (
                <tr
                  key={l.id}
                  className="selectable"
                  aria-selected={l.id === selectedId}
                  onClick={() => setSelectedId(l.id)}
                  onDoubleClick={() => canManage && setDialog({ kind: 'form', location: l })}
                >
                  <td>{l.name}</td>
                  <td>{LOCATION_TYPE_LABELS[l.type]}</td>
                  <td>{l.operatingMode === 'HYBRID' ? 'Serveur local' : 'Cloud'}</td>
                  <td>{l.country}</td>
                  <td>{l.currency}</td>
                  <td className="num">{formatMinutes(l.businessDayCutoffMin)}</td>
                  <td>
                    <span className={l.status === 'ACTIVE' ? 'state state-ok' : 'state state-off'}>
                      <span className={l.status === 'ACTIVE' ? 'dot dot-ok' : 'dot dot-off'} />
                      {l.status === 'ACTIVE' ? t('team.active') : t('loc.archived')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Window>

      {devicesFor && (
        <DevicesDialog
          location={devicesFor}
          onClose={() => {
            setDevicesFor(null);
            void load();
          }}
        />
      )}
      {pairing && (
        <Dialog
          title={`Relier un serveur local — ${pairing.locationName}`}
          onClose={() => {
            setPairing(null);
            void load();
          }}
          footer={
            <button
              className="btn btn-primary"
              onClick={() => {
                setPairing(null);
                void load();
              }}
            >
              Fermer
            </button>
          }
        >
          <div className="dialog-body">
            <p>Sur le PC du restaurant, installez AfriKaisse, puis à l'écran de connexion choisissez « Relier à AfriKaisse Cloud » et saisissez :</p>
            <p className="pairing-code">{pairing.code}</p>
          </div>
        </Dialog>
      )}
      {dialog?.kind === 'form' && <LocationDialog location={dialog.location} onSaved={applySaved} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'archive' && (
        <Dialog
          title={`${t('loc.archive')} — ${dialog.location.name}`}
          onClose={() => setDialog(null)}
          footer={
            <>
              <button className="btn btn-primary" onClick={() => changeStatus(dialog.location, 'archive')}>
                {t('loc.archive')}
              </button>
              <button className="btn" onClick={() => setDialog(null)}>
                {t('common.cancel')}
              </button>
            </>
          }
        >
          <div className="dialog-body">{t('loc.archiveConfirm')}</div>
        </Dialog>
      )}
    </>
  );
}

function LocationDialog({ location, onSaved, onClose }: { location?: LocationDetails; onSaved: (l: LocationDetails) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    name: location?.name ?? '',
    type: location?.type ?? 'RESTAURANT',
    country: location?.country ?? 'TD',
    timezone: location?.timezone ?? 'Africa/Ndjamena',
    currency: location?.currency ?? 'XAF',
    address: location?.address ?? '',
    phone: location?.phone ?? '',
    businessDayCutoffMin: location?.businessDayCutoffMin ?? 300,
    operatingMode: location?.operatingMode ?? 'CLOUD',
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const timezones = TIMEZONES.includes(form.timezone) ? TIMEZONES : [form.timezone, ...TIMEZONES];

  function selectCountry(code: string) {
    const c = COUNTRIES.find((x) => x.code === code);
    setForm((f) => (c ? { ...f, country: c.code, timezone: c.timezone, currency: c.currency } : { ...f, country: code }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = { ...form, address: form.address.trim() || null, phone: form.phone.trim() || null };
    try {
      if (!location) {
        onSaved(await api<LocationDetails>('POST', '/locations', body));
        return;
      }
      const changes = Object.fromEntries(Object.entries(body).filter(([k, v]) => v !== location[k as keyof LocationDetails]));
      onSaved(Object.keys(changes).length ? await api<LocationDetails>('PATCH', `/locations/${location.id}`, changes) : location);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Dialog
        wide
        title={location ? `${t('loc.editTitle')} — ${location.name}` : t('loc.add')}
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
          <fieldset className="group">
            <legend>{t('loc.groupIdentity')}</legend>
            <div className="form">
              <label htmlFor="l-name">{t('team.name')}</label>
              <input id="l-name" required minLength={2} autoFocus value={form.name} onChange={set('name')} />
              <label htmlFor="l-type">{t('auth.locationType')}</label>
              <select id="l-type" value={form.type} onChange={set('type')}>
                {LOCATION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {LOCATION_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>
          </fieldset>
          <fieldset className="group">
            <legend>{t('loc.groupPlace')}</legend>
            <div className="form">
              <label htmlFor="l-country">{t('auth.country')}</label>
              <select id="l-country" value={form.country} onChange={(e) => selectCountry(e.target.value)}>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
              <label htmlFor="l-tz">{t('org.timezone')}</label>
              <select id="l-tz" value={form.timezone} onChange={set('timezone')}>
                {timezones.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
              <label htmlFor="l-currency">{t('auth.currency')}</label>
              <select id="l-currency" value={form.currency} onChange={set('currency')}>
                {CURRENCY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
              <label htmlFor="l-address">{t('loc.address')}</label>
              <input id="l-address" maxLength={300} value={form.address} onChange={set('address')} />
              <label htmlFor="l-phone">{t('loc.phone')}</label>
              <input id="l-phone" type="tel" inputMode="tel" maxLength={40} value={form.phone} onChange={set('phone')} />
            </div>
          </fieldset>
          <fieldset className="group">
            <legend>{t('loc.groupOperation')}</legend>
            <div className="form">
              <label htmlFor="l-cutoff">{t('loc.cutoff')}</label>
              <select id="l-cutoff" value={form.businessDayCutoffMin} onChange={(e) => setForm((f) => ({ ...f, businessDayCutoffMin: Number(e.target.value) }))}>
                {CUTOFF_OPTIONS.map((min) => (
                  <option key={min} value={min}>
                    {formatMinutes(min)}
                  </option>
                ))}
              </select>
              <label htmlFor="l-mode">{t('loc.mode')}</label>
              <select id="l-mode" value={form.operatingMode} onChange={set('operatingMode')}>
                {OPERATING_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {OPERATING_MODE_LABELS[mode]}
                  </option>
                ))}
              </select>
            </div>
          </fieldset>
        </div>
      </Dialog>
    </form>
  );
}

const when = (ts: number) => new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

/** PC volé, perdu ou remplacé : on coupe sa liaison au Cloud. */
function DevicesDialog({ location, onClose }: { location: LocationDetails; onClose: () => void }) {
  const [devices, setDevices] = useState<LocalServerDevice[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => api<LocalServerDevice[]>('GET', `/locations/${location.id}/devices`).then(setDevices, setError), [location.id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(id: string) {
    setError(null);
    try {
      await api('POST', `/devices/${id}/revoke`);
      setConfirming(null);
      await load();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Dialog
      wide
      title={`Serveurs reliés — ${location.name}`}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          Fermer
        </button>
      }
    >
      <div className="dialog-body">
        <ErrorMessage error={error} />
        {devices?.length === 0 && <p className="muted">Aucun serveur local n'a été relié à cet établissement.</p>}
        {!!devices?.length && (
          <div className="grid-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>État</th>
                  <th className="num">Relié le</th>
                  <th className="num">Dernier contact</th>
                  <th aria-label="Action" />
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => (
                  <tr key={d.id}>
                    <td>{d.name}</td>
                    <td>
                      <span className={d.status === 'ACTIVE' ? 'state state-ok' : 'state state-off'}>
                        <span className={d.status === 'ACTIVE' ? 'dot dot-ok' : 'dot dot-off'} />
                        {d.status === 'ACTIVE' ? 'Actif' : 'Révoqué'}
                      </span>
                    </td>
                    <td className="num">{when(d.createdAt)}</td>
                    <td className="num">{d.lastSeenAt ? when(d.lastSeenAt) : '—'}</td>
                    <td className="num">
                      {d.status === 'ACTIVE' &&
                        (confirming === d.id ? (
                          <>
                            <button className="btn btn-primary" onClick={() => revoke(d.id)}>
                              Confirmer la révocation
                            </button>{' '}
                            <button className="btn" onClick={() => setConfirming(null)}>
                              Annuler
                            </button>
                          </>
                        ) : (
                          <button className="btn" onClick={() => setConfirming(d.id)}>
                            Révoquer
                          </button>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Dialog>
  );
}
