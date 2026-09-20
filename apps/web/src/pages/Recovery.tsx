import { useState, type FormEvent } from 'react';
import type { Me } from '@afrikaisse/core';
import { api } from '../api.ts';
import { Dialog, ErrorMessage, OkMessage, PasswordInput } from '../ui.tsx';

/** Questions proposées : des souvenirs qui ne changent pas et que les collègues ne connaissent pas. */
export const RECOVERY_QUESTIONS = [
  'Dans quelle ville ou quel village êtes-vous né(e) ?',
  'Quel est le prénom de votre mère ?',
  'Quel est le nom de votre école primaire ?',
  'Quel surnom vous donnait-on quand vous étiez enfant ?',
  'Quel est le nom du quartier où vous avez grandi ?',
  'Quel est le prénom de votre meilleur(e) ami(e) d’enfance ?',
];

const CUSTOM = '__custom';

export interface RecoveryValue {
  question: string;
  answer: string;
}

export const EMPTY_RECOVERY: RecoveryValue = { question: '', answer: '' };

/** Question secrète et réponse, en lignes d'une grille `.form`. */
export function RecoveryFields({ id, value, onChange }: { id: string; value: RecoveryValue; onChange: (v: RecoveryValue) => void }) {
  const [custom, setCustom] = useState(value.question !== '' && !RECOVERY_QUESTIONS.includes(value.question));
  return (
    <>
      <label htmlFor={`${id}-question`}>Question secrète</label>
      <select
        id={`${id}-question`}
        required
        value={custom ? CUSTOM : value.question}
        onChange={(e) => {
          const next = e.target.value;
          setCustom(next === CUSTOM);
          onChange({ ...value, question: next === CUSTOM ? '' : next });
        }}
      >
        <option value="" disabled>
          Choisissez une question…
        </option>
        {RECOVERY_QUESTIONS.map((q) => (
          <option key={q} value={q}>
            {q}
          </option>
        ))}
        <option value={CUSTOM}>Écrire ma propre question…</option>
      </select>
      {custom && (
        <>
          <label htmlFor={`${id}-custom`}>Votre question</label>
          <input
            id={`${id}-custom`}
            required
            autoFocus
            minLength={8}
            maxLength={160}
            autoComplete="off"
            value={value.question}
            onChange={(e) => onChange({ ...value, question: e.target.value })}
          />
        </>
      )}
      <label htmlFor={`${id}-answer`}>Réponse</label>
      <input
        id={`${id}-answer`}
        required
        minLength={2}
        maxLength={120}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        value={value.answer}
        onChange={(e) => onChange({ ...value, answer: e.target.value })}
      />
      <span className="hint">Demandée si vous oubliez votre mot de passe. Majuscules, accents et espaces ne comptent pas.</span>
    </>
  );
}

function useRecoveryForm(onSaved: () => void) {
  const [password, setPassword] = useState('');
  const [value, setValue] = useState<RecoveryValue>(EMPTY_RECOVERY);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('PUT', '/auth/recovery', { currentPassword: password, question: value.question, answer: value.answer });
      setPassword('');
      setValue(EMPTY_RECOVERY);
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return { password, setPassword, value, setValue, error, busy, submit };
}

/** Compte sans question secrète (créé avant, ou par le responsable) : proposée après la connexion. */
export function RecoveryPrompt({ onSaved, onLater }: { onSaved: () => void; onLater: () => void }) {
  const f = useRecoveryForm(onSaved);
  return (
    <form onSubmit={f.submit}>
      <Dialog
        title="Protéger mon compte"
        footer={
          <>
            <button type="button" className="btn" onClick={onLater}>
              Plus tard
            </button>
            <button className="btn btn-primary" disabled={f.busy}>
              {f.busy ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </>
        }
      >
        <div className="dialog-body">
          <p className="recovery-lead">
            Choisissez une question secrète. Si vous oubliez votre mot de passe, elle vous permettra de récupérer votre compte vous-même, depuis l'écran de connexion.
          </p>
          <ErrorMessage error={f.error} />
          <div className="form">
            <label htmlFor="rp-password">Mot de passe actuel</label>
            <PasswordInput id="rp-password" required autoComplete="current-password" value={f.password} onChange={(e) => f.setPassword(e.target.value)} />
            <RecoveryFields id="rp" value={f.value} onChange={f.setValue} />
          </div>
        </div>
      </Dialog>
    </form>
  );
}

/** Rubrique de « Mon compte » : définir ou changer sa question secrète. */
export function RecoverySection({ me, onSaved }: { me: Me; onSaved?: () => void }) {
  const [ok, setOk] = useState(false);
  const f = useRecoveryForm(() => {
    setOk(true);
    onSaved?.();
  });
  return (
    <form onSubmit={f.submit} style={{ marginTop: 16 }}>
      <fieldset className="group">
        <legend>Question secrète</legend>
        <p className="recovery-lead">
          {me.user.hasRecovery
            ? 'Votre question secrète est enregistrée. Vous pouvez la changer à tout moment.'
            : "Aucune question secrète : sans elle, un mot de passe oublié ne peut pas être récupéré depuis l'écran de connexion."}
        </p>
        <ErrorMessage error={f.error} />
        {ok && <OkMessage>Question secrète enregistrée.</OkMessage>}
        <div className="form">
          <label htmlFor="as-password">{'Mot de passe actuel'}</label>
          <PasswordInput id="as-password" required autoComplete="current-password" value={f.password} onChange={(e) => f.setPassword(e.target.value)} />
          <RecoveryFields id="as" value={f.value} onChange={f.setValue} />
          <span />
          <div>
            <button className="btn btn-primary" disabled={f.busy}>
              {me.user.hasRecovery ? 'Changer la question' : 'Enregistrer la question'}
            </button>
          </div>
        </div>
      </fieldset>
    </form>
  );
}
