import { useEffect, useRef, useState } from 'react';
// Types seulement : le bundle du menu n'embarque pas Zod.
import type { PublicAnnouncement } from '@afrikaisse/core';
import { mdiArrowRight } from '@mdi/js';
import { Icon } from './Icon.tsx';
import { useLang } from './i18n.tsx';

/**
 * Bandeau d'annonces du menu client (design v3) : une annonce à la fois, en photo pleine largeur voilée
 * d'un dégradé bleu nuit côté texte, pastille « À la une », titre et bouton blanc. Suivante après sa
 * durée d'affichage, points de pagination et glissement du doigt. Le bouton (ou le bandeau) mène à la cible.
 */
export function Announcements({ items, onOpen }: { items: PublicAnnouncement[]; onOpen: (a: PublicAnnouncement) => void }) {
  const { t, lang } = useLang();
  const [index, setIndex] = useState(0);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const count = items.length;
  const current = Math.min(index, count - 1);
  const seconds = items[current]?.displaySeconds ?? 6;

  useEffect(() => {
    if (count < 2) return;
    const id = setTimeout(() => setIndex((current + 1) % count), Math.max(3, seconds) * 1000);
    return () => clearTimeout(id);
  }, [current, count, seconds]);

  if (count === 0) return null;
  const rtl = lang === 'ar';
  const go = (next: number) => setIndex(((next % count) + count) % count);

  return (
    <div
      className="m-banners"
      role="region"
      aria-roledescription="carousel"
      aria-label={t('announcements')}
      onTouchStart={(e) => {
        const p = e.touches[0];
        touch.current = p ? { x: p.clientX, y: p.clientY } : null;
        swiped.current = false;
      }}
      onTouchEnd={(e) => {
        const start = touch.current;
        const p = e.changedTouches[0];
        touch.current = null;
        if (!start || !p || count < 2) return;
        const dx = (p.clientX - start.x) * (rtl ? -1 : 1);
        if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(p.clientY - start.y)) return;
        swiped.current = true;
        go(dx < 0 ? current + 1 : current - 1);
      }}
    >
      <div className="m-banner-view">
        <div className="m-banner-track" style={{ transform: `translateX(${(rtl ? 1 : -1) * current * 100}%)` }}>
          {items.map((a, i) => {
            const hidden = i !== current;
            const content = (
              <>
                {a.photoUrl && <img className="m-banner-photo" src={a.photoUrl} alt="" decoding="async" />}
                <span className="m-banner-veil" aria-hidden="true" />
                <span className="m-banner-text">
                  <small className="m-banner-eyebrow">{t('featured')}</small>
                  <strong>{a.title}</strong>
                  {a.body && <span className="m-banner-body">{a.body}</span>}
                  {a.target && a.buttonLabel && (
                    <span className="m-banner-cta">
                      {a.buttonLabel}
                      <Icon path={mdiArrowRight} size={18} className="m-flip" />
                    </span>
                  )}
                </span>
              </>
            );
            const className = a.photoUrl ? 'm-banner has-photo' : 'm-banner';
            return a.target ? (
              <button
                key={a.id}
                type="button"
                className={className}
                aria-hidden={hidden}
                tabIndex={hidden ? -1 : 0}
                onClick={() => {
                  if (swiped.current) {
                    swiped.current = false;
                    return;
                  }
                  onOpen(a);
                }}
              >
                {content}
              </button>
            ) : (
              <div key={a.id} className={className} aria-hidden={hidden}>
                {content}
              </div>
            );
          })}
        </div>
      </div>
      {count > 1 && (
        <div className="m-dots">
          {items.map((a, i) => (
            <button key={a.id} type="button" className={i === current ? 'on' : undefined} aria-label={t('announcementNo', { n: i + 1 })} aria-current={i === current} onClick={() => go(i)}>
              <span />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
