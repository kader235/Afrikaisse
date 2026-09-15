import { useEffect, useRef, useState } from 'react';
import type { Me } from '@afrikaisse/core';
import type { ChimeName } from '../alertRules.ts';
import { useAlertSettings } from '../alertSettings.ts';
import type { AlertVolume } from '../chime.ts';
import { isNativeApp } from '../platform.ts';
import { onSoundState, playChime, soundState, type SoundState } from '../sound.ts';
import { requestSystemPermission, systemPermission, type SystemPermission } from '../systemNotify.ts';
import { wakeLockSupported } from '../wakeLock.ts';
import { Icon } from '../ui.tsx';
import '../styles/alerts.css';

const VOLUMES: [AlertVolume, string][] = [
  ['low', 'Faible'],
  ['medium', 'Moyen'],
  ['high', 'Fort'],
];

/** « Tester le son » fait entendre les trois motifs l'un après l'autre. */
const TEST_ORDER: [ChimeName, string][] = [
  ['order', 'nouvelle commande'],
  ['ready', 'commande prête'],
  ['call', 'appel ou addition'],
];

/** Section « Son et notifications » du panneau de compte : réglages propres à cet appareil. */
export function SoundSettings({ me }: { me: Me }) {
  const [settings, update] = useAlertSettings();
  const [state, setState] = useState<SoundState>(soundState);
  const [permission, setPermission] = useState<SystemPermission | null>(null);
  const [heard, setHeard] = useState<string | null>(null);
  const next = useRef(0);

  useEffect(() => onSoundState(setState), []);
  useEffect(() => {
    let alive = true;
    void systemPermission().then((p) => alive && setPermission(p));
    return () => {
      alive = false;
    };
  }, []);

  const concerned = (['orders.create', 'payments.collect', 'kitchen.use', 'bar.use'] as const).some((p) => me.permissions.includes(p));
  if (!concerned) return null;
  const native = isNativeApp();

  const test = async () => {
    const [name, label] = TEST_ORDER[next.current % TEST_ORDER.length]!;
    next.current += 1;
    const ok = await playChime(name, settings.volume);
    setState(ok ? 'ready' : soundState());
    setHeard(ok ? `Son joué : ${label}` : 'Le son a été bloqué par l’appareil');
  };

  const toggleSystem = async (on: boolean) => {
    update({ system: on });
    if (on && permission === 'prompt') setPermission(await requestSystemPermission());
  };

  return (
    <div className="panel-section alert-settings">
      <h2>Son et notifications</h2>
      <p className={state === 'ready' ? 'alert-status alert-status-ok' : 'alert-status alert-status-warn'}>
        <span className="alert-status-dot" aria-hidden="true" />
        {state === 'ready' ? 'Son activé' : state === 'locked' ? "Touchez l'écran une fois pour activer le son" : 'Son indisponible sur cet appareil'}
      </p>
      <div className="alert-volume" role="group" aria-label="Volume des alertes">
        {VOLUMES.map(([volume, label]) => (
          <button
            key={volume}
            type="button"
            className="btn"
            aria-pressed={settings.volume === volume}
            onClick={() => {
              update({ volume });
              void playChime('order', volume);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <button type="button" className="btn alert-test" onClick={() => void test()}>
        <Icon name="bell" />
        Tester le son
      </button>
      {heard && <p className="alert-heard">{heard}</p>}
      {permission !== null && permission !== 'unsupported' && (
        <label className="alert-toggle">
          <input type="checkbox" checked={settings.system && permission !== 'denied'} disabled={permission === 'denied'} onChange={(e) => void toggleSystem(e.target.checked)} />
          <span>
            {native ? 'Notifications Android' : 'Notifications du système'}
            <small>
              {permission === 'denied'
                ? native
                  ? "Refusées : autorisez les notifications d'AfriKaisse dans les réglages Android."
                  : 'Refusées dans ce navigateur.'
                : native
                  ? "Avec son, quand l'application est en arrière-plan ou l'écran éteint."
                  : "Quand l'onglet AfriKaisse n'est pas affiché."}
            </small>
          </span>
        </label>
      )}
      {wakeLockSupported() && (
        <label className="alert-toggle">
          <input type="checkbox" checked={settings.keepAwake} onChange={(e) => update({ keepAwake: e.target.checked })} />
          <span>
            Garder l'écran allumé
            <small>Tant que l'application est ouverte.</small>
          </span>
        </label>
      )}
    </div>
  );
}
