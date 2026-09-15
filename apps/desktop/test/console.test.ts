import type { NetworkInterfaceInfo } from 'node:os';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveInstall } from '../src/chemins.ts';
import { appUrl, isAppUrl, isExternalLink, isLocalWindowUrl } from '../src/navigation.ts';
import { rankLanUrls } from '../src/reseau.ts';
import { errorSummary, formatSize, parseBackupOutput } from '../src/sauvegarde.ts';

const nic = (address: string): NetworkInterfaceInfo => ({ address, family: 'IPv4', internal: false, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: `${address}/24` });

describe('emplacements', () => {
  it('trouve le serveur à côté de la console installée', () => {
    expect(resolveInstall('C:\\Program Files\\AfriKaisse\\console\\AfriKaisse.exe', {}, true)).toEqual({
      app: 'C:\\Program Files\\AfriKaisse',
      nodeExe: 'C:\\Program Files\\AfriKaisse\\runtime\\node\\node.exe',
      launcher: 'C:\\Program Files\\AfriKaisse\\lanceur\\demarrer.cjs',
      cli: 'C:\\Program Files\\AfriKaisse\\app\\cli.cjs',
    });
  });

  it('suit AFK_APP_DIR pour les essais, et ne devine rien hors installation', () => {
    expect(resolveInstall('C:\\x\\electron.exe', { AFK_APP_DIR: 'D:\\charge' }, false).nodeExe).toBe('D:\\charge\\runtime\\node\\node.exe');
    expect(resolveInstall('C:\\x\\electron.exe', {}, false)).toEqual({ app: null, nodeExe: null, launcher: null, cli: null });
  });
});

describe('navigation', () => {
  it('ouvre la caisse et la supervision sur localhost', () => {
    expect(appUrl(7300)).toBe('http://localhost:7300/');
    expect(appUrl(52011, 'supervision')).toBe('http://localhost:52011/#supervision');
  });

  it("n'autorise que le serveur local de ce PC, sur son port", () => {
    expect(isAppUrl('http://localhost:7300/', 7300)).toBe(true);
    expect(isAppUrl('http://127.0.0.1:7300/m/abc?x=1#y', 7300)).toBe(true);
    expect(isAppUrl('http://localhost:7300/', 8300)).toBe(false);
    expect(isAppUrl('http://localhost:7300/', null)).toBe(false);
    expect(isAppUrl('https://localhost:7300/', 7300)).toBe(false);
    expect(isAppUrl('http://192.168.1.20:7300/', 7300)).toBe(false);
    expect(isAppUrl('http://localhost.evil.com:7300/', 7300)).toBe(false);
    expect(isAppUrl('http://user:pass@localhost:7300/', 7300)).toBe(false);
    expect(isAppUrl('file:///C:/Windows/win.ini', 7300)).toBe(false);
    expect(isAppUrl('javascript:alert(1)', 7300)).toBe(false);
    expect(isAppUrl('pas une adresse', 7300)).toBe(false);
  });

  it('limite les fichiers locaux au dossier des fenêtres de la console', () => {
    const dir = 'C:\\Program Files\\AfriKaisse\\console\\resources\\app\\fenetres';
    expect(isLocalWindowUrl(pathToFileURL(`${dir}\\appairage.html`, { windows: true }).href, dir)).toBe(true);
    expect(isLocalWindowUrl(pathToFileURL(`${dir}\\attente.html`, { windows: true }).href + '#x', `${dir}\\`)).toBe(true);
    expect(isLocalWindowUrl(pathToFileURL(`${dir}\\..\\main.cjs`, { windows: true }).href, dir)).toBe(false);
    expect(isLocalWindowUrl(pathToFileURL(`${dir}-copie\\appairage.html`, { windows: true }).href, dir)).toBe(false);
    expect(isLocalWindowUrl('file:///C:/Windows/win.ini', dir)).toBe(false);
    expect(isLocalWindowUrl('http://localhost:7300/', dir)).toBe(false);
  });

  it("n'envoie au navigateur de Windows que des liens sûrs", () => {
    expect(isExternalLink('https://afrikaisse.dametta.com/telechargements/AfriKaisse-Setup-0.2.0.exe')).toBe(true);
    expect(isExternalLink('http://192.168.1.20:7300/m/abc')).toBe(true);
    expect(isExternalLink('http://example.com/')).toBe(false);
    expect(isExternalLink('file:///C:/Windows/System32/cmd.exe')).toBe(false);
    expect(isExternalLink('ms-settings:network')).toBe(false);
    expect(isExternalLink('https://user:pass@example.com/')).toBe(false);
  });
});

describe("QR d'appairage", () => {
  it('met en premier la carte réelle du réseau du restaurant', () => {
    const interfaces = { 'vEthernet (WSL)': [nic('172.22.48.1')], 'Wi-Fi': [nic('192.168.1.20')], Ethernet: [nic('10.0.0.5')] };
    const ranked = rankLanUrls(['http://172.22.48.1:7300', 'http://10.0.0.5:7300', 'http://192.168.1.20:7300'], interfaces);
    expect(ranked.map((a) => a.label)).toEqual(['192.168.1.20:7300', '10.0.0.5:7300', '172.22.48.1:7300']);
    expect(ranked[0]).toEqual({ url: 'http://192.168.1.20:7300', host: '192.168.1.20', label: '192.168.1.20:7300', interfaceName: 'Wi-Fi', virtual: false });
    expect(ranked[2]!.virtual).toBe(true);
  });

  it('écarte les adresses inutilisables et les doublons', () => {
    const ranked = rankLanUrls(['http://127.0.0.1:7300', 'http://169.254.3.4:7300', 'http://[fe80::1]:7300', 'https://192.168.1.20:7300', 'x', 'http://192.168.1.20:7300/', 'http://192.168.1.20:7300'], {});
    expect(ranked.map((a) => a.url)).toEqual(['http://192.168.1.20:7300']);
    expect(ranked[0]!.interfaceName).toBeNull();
    expect(rankLanUrls([], {})).toEqual([]);
  });

  it("garde l'ordre du serveur à rang égal", () => {
    const ranked = rankLanUrls(['http://192.168.8.2:9300', 'http://192.168.1.3:9300'], { A: [nic('192.168.8.2')], B: [nic('192.168.1.3')] });
    expect(ranked.map((a) => a.host)).toEqual(['192.168.8.2', '192.168.1.3']);
  });
});

describe('sauvegarde depuis la console', () => {
  it('lit le fichier produit par cli backup', () => {
    expect(parseBackupOutput('{"name":"afrikaisse-20260915-101500-manuelle.sqlite","size":2345678,"createdAt":1}\n')).toEqual({ name: 'afrikaisse-20260915-101500-manuelle.sqlite', size: 2345678 });
    expect(parseBackupOutput('Avertissement\n{"name":"a.sqlite","size":10}\r\n')).toEqual({ name: 'a.sqlite', size: 10 });
    expect(parseBackupOutput('Aucune base sur ce PC : créez d’abord le restaurant.')).toBeNull();
    expect(parseBackupOutput('{"name":""}')).toBeNull();
  });

  it('affiche tailles et erreurs lisiblement', () => {
    expect(formatSize(500)).toBe('1 Ko');
    expect(formatSize(20_480)).toBe('20 Ko');
    expect(formatSize(2_345_678)).toBe('2,2 Mo');
    expect(errorSummary('Error: disque plein\n    at backupNow (cli.cjs:1:1)\n', false)).toBe('Error: disque plein');
    expect(errorSummary('', true)).toMatch(/5 minutes/);
    expect(errorSummary('', false)).toBe('Erreur inconnue.');
  });
});
