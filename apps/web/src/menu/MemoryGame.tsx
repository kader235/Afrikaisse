import { useEffect, useMemo, useState } from 'react';
import { MEMORY_PAIRS, createMemoryGame, flipCard, hideMismatch, isMismatch, isWon, type MemoryState } from '@afrikaisse/core/memory-game';
import { mdiBellRing, mdiCoffee, mdiFoodDrumstick, mdiFruitWatermelon, mdiIceCream, mdiPizza, mdiRefresh, mdiSilverwareForkKnife, mdiTrophyOutline, mdiCupcake } from '@mdi/js';
import { Icon } from './Icon.tsx';
import { useLang } from './i18n.tsx';
import { Sheet } from './ClientSheets.tsx';

/**
 * « Jeu du mémo » pour patienter pendant la préparation : 12 cartes (6 paires) avec les photos des plats
 * du restaurant, complétées par des dessins aux couleurs du thème. Hors ligne, sans dépendance.
 * La logique (mélange, paires, victoire) est dans @afrikaisse/core/memory-game, testée à part.
 */

export interface MemoryPhoto {
  url: string;
  name: string;
}

interface Face {
  id: string;
  label: string;
  photo: string | null;
  icon: string;
}

const ILLUSTRATIONS = [mdiFoodDrumstick, mdiCoffee, mdiIceCream, mdiPizza, mdiFruitWatermelon, mdiCupcake];
const MISMATCH_MS = 900;

function newSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function MemoryGameSheet({ photos, readyOrder, onReady, onClose }: { photos: MemoryPhoto[]; readyOrder: number | null; onReady: () => void; onClose: () => void }) {
  const { t } = useLang();
  // Photos distinctes d'abord, puis des dessins pour compléter les 6 paires.
  const faces = useMemo<Face[]>(() => {
    const seen = new Set<string>();
    const list: Face[] = [];
    for (const p of photos) {
      if (list.length >= MEMORY_PAIRS || seen.has(p.url)) continue;
      seen.add(p.url);
      list.push({ id: p.url, label: p.name, photo: p.url, icon: mdiSilverwareForkKnife });
    }
    for (let i = 0; list.length < MEMORY_PAIRS; i++) {
      list.push({ id: `illustration-${i}`, label: t('memoIllustration', { n: i + 1 }), photo: null, icon: ILLUSTRATIONS[i % ILLUSTRATIONS.length]! });
    }
    return list;
  }, [photos, t]);
  const byId = useMemo(() => new Map(faces.map((f, i) => [f.id, { face: f, tone: i }] as const)), [faces]);

  const [game, setGame] = useState<MemoryState>(() => createMemoryGame(faces.map((f) => f.id), newSeed()));
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const won = isWon(game);

  // Deux cartes différentes : visibles un instant, puis cachées.
  useEffect(() => {
    if (!isMismatch(game)) return;
    const id = setTimeout(() => setGame((g) => hideMismatch(g)), MISMATCH_MS);
    return () => clearTimeout(id);
  }, [game]);

  // Chronomètre : démarre au premier toucher, s'arrête à la victoire.
  useEffect(() => {
    if (startedAt === null || endedAt !== null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt, endedAt]);

  useEffect(() => {
    if (won && endedAt === null) setEndedAt(Date.now());
  }, [won, endedAt]);

  function flip(index: number) {
    if (won) return;
    if (startedAt === null) {
      setStartedAt(Date.now());
      setNow(Date.now());
    }
    setGame((g) => flipCard(g, index));
  }

  function replay() {
    setGame(createMemoryGame(faces.map((f) => f.id), newSeed()));
    setStartedAt(null);
    setEndedAt(null);
  }

  const elapsed = startedAt === null ? 0 : ((endedAt ?? now) - startedAt) / 1000;
  const found = game.matched.length / 2;

  return (
    <Sheet title={t('memoTitle')} onClose={onClose} className="m-sheet-game">
      <div className="m-sheet-body m-memo">
        <h3>{t('memoTitle')}</h3>
        <p className="m-memo-intro">{t('memoIntro')}</p>

        {readyOrder !== null && (
          <button className="m-memo-ready" onClick={onReady}>
            <Icon path={mdiBellRing} size={20} />
            <span>
              <strong>{t('memoReady')}</strong>
              <small>{t('orderNo', { n: readyOrder })}</small>
            </span>
          </button>
        )}

        <div className="m-memo-stats" aria-live="polite">
          <span>
            <small>{t('memoMoves')}</small>
            <strong className="m-num">{game.moves}</strong>
          </span>
          <span>
            <small>{t('memoPairs')}</small>
            <strong className="m-num">
              {found}/{MEMORY_PAIRS}
            </strong>
          </span>
          <span>
            <small>{t('memoTime')}</small>
            <strong className="m-num">{clock(elapsed)}</strong>
          </span>
        </div>

        {won ? (
          <div className="m-memo-win" role="status">
            <span className="m-memo-trophy">
              <Icon path={mdiTrophyOutline} size={40} />
            </span>
            <strong>{t('memoWin', { n: game.moves })}</strong>
            <p>{t('memoWinTime', { time: clock(elapsed) })}</p>
            <button className="m-button m-memo-replay" onClick={replay}>
              <Icon path={mdiRefresh} size={20} />
              <span>{t('memoReplay')}</span>
            </button>
          </div>
        ) : (
          <div className="m-memo-grid">
            {game.cards.map((card) => {
              const entry = byId.get(card.face)!;
              const matched = game.matched.includes(card.index);
              const visible = matched || game.flipped.includes(card.index);
              const label = visible ? t(matched ? 'memoCardFound' : 'memoCardShown', { n: card.index + 1, name: entry.face.label }) : t('memoCardHidden', { n: card.index + 1 });
              return (
                <button
                  key={card.index}
                  className={`m-memo-card${visible ? ' up' : ''}${matched ? ' found' : ''}`}
                  aria-label={label}
                  aria-disabled={visible}
                  onClick={() => flip(card.index)}
                >
                  <span className="m-memo-inner">
                    <span className="m-memo-face m-memo-back" aria-hidden="true">
                      <Icon path={mdiSilverwareForkKnife} size={26} />
                    </span>
                    <span className={`m-memo-face m-memo-front${entry.face.photo ? '' : ` m-memo-art m-memo-tone-${entry.tone % 3}`}`} aria-hidden="true">
                      {entry.face.photo ? <img src={entry.face.photo} alt="" decoding="async" draggable={false} /> : <Icon path={entry.face.icon} size={38} />}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Sheet>
  );
}
