import { describe, expect, it } from 'vitest';
import { CANDIDATE_PORTS, RESTART_DELAYS_MS, STABLE_UPTIME_MS, isOwnHealth, parsePortFile, parseTasklistImage, paths, restartDelay, serverEnv } from '../lanceur/commun.cjs';
import { LOCAL_SERVICE_SID, TASK_SDDL, buildTaskXml, encodeTaskXml, escapeXml } from '../lanceur/tache.cjs';

/** Vérifie que chaque balise ouverte est fermée dans l'ordre (pas de parseur XML dans Node). */
function assertWellFormed(xml: string) {
  const body = xml.replace(/^<\?xml[^>]*\?>/, '');
  const stack: string[] = [];
  for (const [, closing, name, selfClosing] of body.matchAll(/<(\/?)([A-Za-z][\w:-]*)[^>]*?(\/?)>/g)) {
    if (selfClosing) continue;
    if (closing) expect(stack.pop()).toBe(name);
    else stack.push(name!);
  }
  expect(stack).toEqual([]);
  expect(body).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
}

describe('fichier de port', () => {
  it('lit le port et le nœud écrits par le serveur', () => {
    expect(parsePortFile('{"port":7300,"nodeId":"n-1"}')).toEqual({ port: 7300, nodeId: 'n-1' });
    // Bloc-notes ajoute un BOM : le fichier reste lisible.
    expect(parsePortFile('\uFEFF{"port":52011,"nodeId":"n-1"}')).toEqual({ port: 52011, nodeId: 'n-1' });
  });

  it('refuse un fichier incomplet ou incohérent', () => {
    for (const text of ['', 'abc', '7300', 'null', '{"port":0,"nodeId":"n"}', '{"port":70000,"nodeId":"n"}', '{"port":"7300","nodeId":"n"}', '{"port":7300}', '{"port":7300,"nodeId":""}', '{"port":73.5,"nodeId":"n"}']) {
      expect(parsePortFile(text), text).toBeNull();
    }
  });
});

describe('santé du serveur', () => {
  const health = { status: 'ok', profile: 'local', nodeId: 'n-1', version: '0.1.0' };
  it("n'accepte que CE serveur local", () => {
    expect(isOwnHealth(health, 'n-1')).toBe(true);
    expect(isOwnHealth(health, 'n-2')).toBe(false);
    expect(isOwnHealth({ ...health, profile: 'cloud' }, 'n-1')).toBe(false);
    expect(isOwnHealth(null, 'n-1')).toBe(false);
  });
});

describe('superviseur', () => {
  it('espace les redémarrages successifs puis relance chaque minute', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 50].map(restartDelay)).toEqual([1_000, 2_000, 5_000, 10_000, 30_000, 60_000, 60_000, 60_000]);
    expect(restartDelay(0)).toBe(RESTART_DELAYS_MS[0]);
    expect(STABLE_UPTIME_MS).toBeGreaterThanOrEqual(60_000);
  });

  it('donne au serveur le même environnement que le lanceur', () => {
    const env = serverEnv({ app: 'C:\\Program Files\\AfriKaisse', data: 'C:\\ProgramData\\AfriKaisse', env: { PATH: 'x' } });
    expect(env).toMatchObject({
      PATH: 'x',
      AFK_PROFILE: 'local',
      AFK_DB: 'sqlite:C:\\ProgramData\\AfriKaisse\\afrikaisse.sqlite',
      AFK_PORT: '7300',
      AFK_WEB_DIR: 'C:\\Program Files\\AfriKaisse\\app\\web',
      AFK_PORT_FILE: 'C:\\ProgramData\\AfriKaisse\\port.txt',
      AFK_BACKUP_DIR: 'C:\\ProgramData\\AfriKaisse\\sauvegardes',
      AFK_LOG_DIR: 'C:\\ProgramData\\AfriKaisse\\journaux',
      AFK_LOG_LEVEL: 'warn',
    });
    expect(serverEnv({ app: 'C:\\A', data: 'C:\\D', env: { AFK_PORT: '9100', AFK_LOG_LEVEL: 'info' } })).toMatchObject({ AFK_PORT: '9100', AFK_LOG_LEVEL: 'info' });
    expect(paths('C:\\D').supervisorPid).toBe('C:\\D\\superviseur.pid');
    // Jamais de port « unsafe » des navigateurs : les tablettes ne pourraient pas l'appeler.
    expect(CANDIDATE_PORTS.some((p) => p === 6000 || p === 10080 || (p >= 6665 && p <= 6669))).toBe(false);
  });

  it('reconnaît le nom du programme dans la sortie de tasklist', () => {
    expect(parseTasklistImage('"node.exe","4242","Services","0","48 120 Ko"\r\n')).toBe('node.exe');
    expect(parseTasklistImage('INFO: No tasks are running which match the specified criteria.\r\n')).toBeNull();
    expect(parseTasklistImage('')).toBeNull();
  });
});

describe('tâche planifiée', () => {
  const options = { nodeExe: 'C:\\Program Files\\AfriKaisse\\runtime\\node\\node.exe', script: 'C:\\Program Files\\AfriKaisse\\lanceur\\service.cjs', workingDir: 'C:\\ProgramData\\AfriKaisse' };

  it('démarre avec Windows, sans session, sous le Service local, et se relance', () => {
    const xml = buildTaskXml(options);
    assertWellFormed(xml);
    expect(xml).toContain('<BootTrigger>');
    expect(xml).toContain('<Interval>PT5M</Interval>');
    expect(xml).toContain(`<UserId>${LOCAL_SERVICE_SID}</UserId>`);
    expect(LOCAL_SERVICE_SID).toBe('S-1-5-19');
    expect(xml).toContain('<RunLevel>LeastPrivilege</RunLevel>');
    expect(xml).not.toContain('<LogonType>InteractiveToken</LogonType>');
    expect(xml).toContain('<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>');
    expect(xml).toContain('<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>');
    expect(xml).toContain('<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>');
    expect(xml).toContain('<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>');
    expect(xml).toMatch(/<RestartOnFailure>\s*<Interval>PT1M<\/Interval>\s*<Count>999<\/Count>/);
    expect(xml).toContain(`<SecurityDescriptor>${TASK_SDDL}</SecurityDescriptor>`);
    expect(xml).toContain(`<Command>${options.nodeExe}</Command>`);
    expect(xml).toContain(`<Arguments>&quot;${options.script}&quot;</Arguments>`);
    expect(xml).toContain(`<WorkingDirectory>${options.workingDir}</WorkingDirectory>`);
  });

  it('échappe les chemins et refuse ceux qui casseraient la ligne de commande', () => {
    const xml = buildTaskXml({ ...options, nodeExe: 'D:\\R&D <AfriKaisse>\\node.exe' });
    assertWellFormed(xml);
    expect(xml).toContain('<Command>D:\\R&amp;D &lt;AfriKaisse&gt;\\node.exe</Command>');
    expect(escapeXml(`a&b<c>"d"'e`)).toBe('a&amp;b&lt;c&gt;&quot;d&quot;&apos;e');
    expect(() => buildTaskXml({ ...options, script: 'lanceur\\service.cjs' })).toThrow(/absolu/);
    expect(() => buildTaskXml({ ...options, script: 'C:\\a"b\\service.cjs' })).toThrow(/interdit/);
    expect(() => buildTaskXml({ ...options, workingDir: '\\\\serveur\\partage' })).toThrow(/absolu/);
  });

  it('peut être enregistrée sans descripteur de sécurité (repli)', () => {
    const xml = buildTaskXml({ ...options, securityDescriptor: null });
    assertWellFormed(xml);
    expect(xml).not.toContain('SecurityDescriptor');
  });

  it("s'écrit en UTF-16 avec BOM pour schtasks", () => {
    const buffer = encodeTaskXml('<Task>é</Task>');
    expect([...buffer.subarray(0, 2)]).toEqual([0xff, 0xfe]);
    expect(buffer.toString('utf16le').slice(1)).toBe('<Task>é</Task>');
  });
});
