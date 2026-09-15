import { useCallback, useEffect, useState } from 'react';
import { WEEKDAY_LABELS, scheduleLabel, type AdminMenu, type Announcement, type AnnouncementInput, type Media, type PricingConfig } from '@afrikaisse/core';
import { api } from '../api.ts';
import { compressImage } from '../images.ts';
import { mediaSrc } from '../platform.ts';
import { Dialog, ErrorMessage, Icon, OkMessage } from '../ui.tsx';
import '../styles/announcements.css';

/**
 * Annonces du menu client (onglet du Menu) : le bandeau qui défile en haut du menu des clients.
 * Photo, titre, texte, bouton vers une catégorie ou un plat ; publiée ou non ; diffusée sur une
 * période (dates, jours, heures) ou pendant une promotion, dont la remise s'applique alors aux commandes.
 */

const minuteToTime = (m: number | null) => (m === null ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
const timeToMinute = (v: string) => {
  const match = /^(\d{2}):(\d{2})$/.exec(v);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

function stateLabel(a: Announcement): string {
  if (!a.isPublished) return 'Non publiée';
  if (a.schedule === null) return 'Promotion suspendue';
  return a.live ? 'Diffusée en ce moment' : 'Programmée';
}

export function AnnouncementsTab({ locationId, menu, canManage }: { locationId: string; menu: AdminMenu; canManage: boolean }) {
  const [list, setList] = useState<Announcement[] | null>(null);
  const [pricing, setPricing] = useState<PricingConfig | null>(null);
  const [editing, setEditing] = useState<Announcement | 'new' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [announcements, config] = await Promise.all([
        api<Announcement[]>('GET', `/locations/${locationId}/announcements`),
        api<PricingConfig>('GET', `/locations/${locationId}/pricing`).catch(() => null),
      ]);
      setList(announcements);
      setPricing(config);
    } catch (err) {
      setError(err);
    }
  }, [locationId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(path: string, body: unknown, message: string) {
    setError(null);
    setNotice(null);
    try {
      setList(await api<Announcement[]>('POST', path, body));
      setNotice(message);
    } catch (err) {
      setError(err);
    }
  }

  const promotionName = (id: string | null) => pricing?.promotions.find((p) => p.id === id)?.name ?? 'Promotion';

  return (
    <div className="ann">
      <div className="ann-head">
        <p>Les annonces défilent en haut du menu que vos clients ouvrent avec le QR de leur table.</p>
        {canManage && (
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <Icon name="add" />
            Nouvelle annonce
          </button>
        )}
      </div>
      <ErrorMessage error={error} />
      {notice && !error && <OkMessage>{notice}</OkMessage>}

      {list && list.length === 0 && <p className="ann-empty">Aucune annonce. Créez-en une pour mettre en avant un plat, une soirée ou une promotion.</p>}

      <div className="ann-grid">
        {list?.map((a) => (
          <article key={a.id} className="ann-card">
            <AnnouncementPreview title={a.title} body={a.body} buttonLabel={a.buttonLabel} photoUrl={a.photoUrl} />
            <div className="ann-info">
              <strong className={a.live ? 'ann-state ann-live' : 'ann-state'}>{stateLabel(a)}</strong>
              <span>{a.promotionId ? `Pendant « ${promotionName(a.promotionId)} »` : a.schedule ? scheduleLabel(a.schedule) : ''}</span>
              <span>{a.displaySeconds} s à l'écran</span>
            </div>
            {canManage && (
              <div className="ann-actions">
                <button className="btn" onClick={() => setEditing(a)}>
                  <Icon name="edit" />
                  Modifier
                </button>
                <button className="btn" onClick={() => act(`/announcements/${a.id}/published`, { isPublished: !a.isPublished }, a.isPublished ? 'Annonce retirée du menu.' : 'Annonce publiée.')}>
                  <Icon name={a.isPublished ? 'eye' : 'ok'} />
                  {a.isPublished ? 'Retirer' : 'Publier'}
                </button>
                <button className="btn" onClick={() => act(`/announcements/${a.id}/archive`, undefined, 'Annonce archivée.')}>
                  <Icon name="archive" />
                  Archiver
                </button>
              </div>
            )}
          </article>
        ))}
      </div>

      {editing && (
        <AnnouncementDialog
          locationId={locationId}
          menu={menu}
          pricing={pricing}
          announcement={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(next, message) => {
            setList(next);
            setNotice(message);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/** Aperçu du bandeau tel que le client le voit. */
function AnnouncementPreview({ title, body, buttonLabel, photoUrl }: { title: string; body: string | null; buttonLabel: string | null; photoUrl: string | null }) {
  return (
    <div className={photoUrl ? 'ann-banner' : 'ann-banner ann-banner-text'}>
      <div className="ann-banner-text-block">
        <strong>{title || 'Titre de l’annonce'}</strong>
        {body && <span>{body}</span>}
        {buttonLabel && (
          <em>
            {buttonLabel}
            <Icon name="right" />
          </em>
        )}
      </div>
      {photoUrl && <img src={mediaSrc(photoUrl)} alt="" />}
    </div>
  );
}

function AnnouncementDialog({
  locationId,
  menu,
  pricing,
  announcement,
  onClose,
  onSaved,
}: {
  locationId: string;
  menu: AdminMenu;
  pricing: PricingConfig | null;
  announcement: Announcement | null;
  onClose: () => void;
  onSaved: (list: Announcement[], message: string) => void;
}) {
  const a = announcement;
  const [form, setForm] = useState({
    title: a?.title ?? '',
    body: a?.body ?? '',
    buttonLabel: a?.buttonLabel ?? '',
    target: a?.targetKind && a.targetId ? `${a.targetKind}:${a.targetId}` : '',
    promotionId: a?.promotionId ?? '',
    mediaId: a?.mediaId ?? null,
    photoUrl: a?.photoUrl ?? null,
    isPublished: a?.isPublished ?? true,
    startDate: a?.startDate ?? '',
    endDate: a?.endDate ?? '',
    days: a?.days ?? [],
    startTime: minuteToTime(a?.startMinute ?? null),
    endTime: minuteToTime(a?.endMinute ?? null),
    displaySeconds: a?.displaySeconds ?? 6,
  });
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));
  const promotions = pricing?.promotions.filter((p) => p.isActive || p.id === form.promotionId) ?? [];
  const categories = [...menu.categories].sort((x, y) => x.sort - y.sort);

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoBusy(true);
    setError(null);
    try {
      const image = await compressImage(file);
      const media = await api<Media>('POST', `/locations/${locationId}/media`, { contentType: image.contentType, dataBase64: image.dataBase64 });
      setForm((f) => ({ ...f, mediaId: media.id, photoUrl: media.url }));
    } catch (err) {
      setError(err);
    } finally {
      setPhotoBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const [targetKind, targetId] = form.target ? (form.target.split(':') as ['CATEGORY' | 'PRODUCT', string]) : [null, null];
    const input: AnnouncementInput = {
      title: form.title,
      body: form.body.trim() || null,
      buttonLabel: form.buttonLabel.trim() || null,
      targetKind,
      targetId,
      promotionId: form.promotionId || null,
      mediaId: form.mediaId,
      isPublished: form.isPublished,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
      days: [...form.days].sort((x, y) => x - y),
      startMinute: form.startTime ? timeToMinute(form.startTime) : null,
      endMinute: form.endTime ? timeToMinute(form.endTime) : null,
      displaySeconds: form.displaySeconds,
    };
    try {
      const list = a ? await api<Announcement[]>('PUT', `/announcements/${a.id}`, input) : await api<Announcement[]>('POST', `/locations/${locationId}/announcements`, input);
      onSaved(list, a ? 'Annonce enregistrée.' : 'Annonce créée.');
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Dialog
        wide
        title={a ? 'Modifier l’annonce' : 'Nouvelle annonce'}
        onClose={onClose}
        footer={
          <>
            <button type="button" className="btn" onClick={onClose}>
              Annuler
            </button>
            <button className="btn btn-primary" disabled={busy || photoBusy}>
              {busy ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </>
        }
      >
        <div className="dialog-body ann-dialog">
          <ErrorMessage error={error} />
          <AnnouncementPreview title={form.title} body={form.body.trim() || null} buttonLabel={form.buttonLabel.trim() || null} photoUrl={form.photoUrl} />

          <fieldset className="group">
            <legend>Contenu</legend>
            <div className="form">
              <label htmlFor="ann-title">Titre</label>
              <input id="ann-title" required minLength={2} maxLength={60} placeholder="Grillades −10 % dès 20 h" value={form.title} onChange={(e) => set('title', e.target.value)} />
              <label htmlFor="ann-body">Texte</label>
              <input id="ann-body" maxLength={140} placeholder="Braisées au feu de bois, tous les soirs" value={form.body} onChange={(e) => set('body', e.target.value)} />
              <label htmlFor="ann-photo">Photo</label>
              <div className="ann-photo">
                <label className="btn">
                  <Icon name="image" />
                  {photoBusy ? 'Envoi…' : form.photoUrl ? 'Changer la photo' : 'Choisir une photo'}
                  <input id="ann-photo" type="file" accept="image/*" hidden disabled={photoBusy} onChange={(e) => pickPhoto(e.target.files?.[0])} />
                </label>
                {form.mediaId && (
                  <button type="button" className="btn" onClick={() => setForm((f) => ({ ...f, mediaId: null, photoUrl: null }))}>
                    Retirer
                  </button>
                )}
              </div>
              <label htmlFor="ann-button">Bouton</label>
              <input id="ann-button" maxLength={30} placeholder="Voir les grillades" value={form.buttonLabel} onChange={(e) => set('buttonLabel', e.target.value)} />
              <label htmlFor="ann-target">Mène vers</label>
              <select id="ann-target" value={form.target} onChange={(e) => set('target', e.target.value)}>
                <option value="">Rien (annonce seule)</option>
                <optgroup label="Catégories">
                  {categories.map((c) => (
                    <option key={c.id} value={`CATEGORY:${c.id}`}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Plats">
                  {menu.products.map((p) => (
                    <option key={p.id} value={`PRODUCT:${p.id}`}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
          </fieldset>

          <fieldset className="group">
            <legend>Diffusion</legend>
            <div className="form">
              <label htmlFor="ann-published">Publiée</label>
              <label className="check">
                <input id="ann-published" type="checkbox" checked={form.isPublished} onChange={(e) => set('isPublished', e.target.checked)} />
                Visible sur le menu des clients
              </label>
              <label htmlFor="ann-promo">Promotion liée</label>
              <select id="ann-promo" value={form.promotionId} onChange={(e) => set('promotionId', e.target.value)}>
                <option value="">Aucune : choisir la période ci-dessous</option>
                {promotions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {scheduleLabel(p)}
                  </option>
                ))}
              </select>
              {form.promotionId ? (
                <span className="hint">L’annonce s’affiche pendant la promotion, et sa remise s’applique aux commandes au même moment.</span>
              ) : (
                <>
                  <label htmlFor="ann-start">Du</label>
                  <div className="ann-inline">
                    <input id="ann-start" type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
                    <span>au</span>
                    <input aria-label="Date de fin" type="date" min={form.startDate || undefined} value={form.endDate} onChange={(e) => set('endDate', e.target.value)} />
                  </div>
                  <label>Jours</label>
                  <div className="ann-days">
                    {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                      <button key={d} type="button" className="chip" aria-pressed={form.days.includes(d)} onClick={() => set('days', form.days.includes(d) ? form.days.filter((x) => x !== d) : [...form.days, d])}>
                        {WEEKDAY_LABELS[d]}
                      </button>
                    ))}
                  </div>
                  <span className="hint">Aucun jour choisi : tous les jours.</span>
                  <label htmlFor="ann-from">De</label>
                  <div className="ann-inline">
                    <input id="ann-from" type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} />
                    <span>à</span>
                    <input aria-label="Heure de fin" type="time" value={form.endTime} onChange={(e) => set('endTime', e.target.value)} />
                  </div>
                  <span className="hint">Sans heures : toute la journée. Une plage 20:00 – 02:00 passe minuit.</span>
                </>
              )}
              <label htmlFor="ann-seconds">Temps à l'écran</label>
              <select id="ann-seconds" value={form.displaySeconds} onChange={(e) => set('displaySeconds', Number(e.target.value))}>
                {[4, 6, 8, 10, 15, 20].map((s) => (
                  <option key={s} value={s}>
                    {s} secondes
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
