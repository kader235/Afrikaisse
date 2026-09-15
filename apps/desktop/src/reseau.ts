import type { NetworkInterfaceInfo } from 'node:os';

/** Une adresse à laquelle une tablette peut joindre le serveur. */
export interface LanAddress {
  /** Contenu du QR : `http://192.168.1.20:7300`, accepté tel quel par l'écran « Connexion au serveur ». */
  url: string;
  host: string;
  /** À saisir sur la tablette : `192.168.1.20:7300`. */
  label: string;
  interfaceName: string | null;
  /** Carte virtuelle (Hyper-V, WSL, VirtualBox, VPN…) : jamais joignable par une tablette du restaurant. */
  virtual: boolean;
}

const VIRTUAL = /vethernet|hyper-v|wsl|virtualbox|vbox|vmware|docker|loopback|bluetooth|tap-|tailscale|zerotier|vpn|npcap|wireguard/i;

/** Réseaux de box et de Wi-Fi d'abord : 192.168.x, puis 10.x, puis 172.16-31.x. */
function privateRank(host: string): number {
  if (host.startsWith('192.168.')) return 0;
  if (host.startsWith('10.')) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return 2;
  return 3;
}

/**
 * Classe les adresses annoncées par `/api/health` (`lanUrls`) pour le QR d'appairage : la première est
 * celle d'une carte réelle sur un réseau privé. Les noms de cartes viennent de `os.networkInterfaces()`
 * du PC (la console tourne sur le même poste que le serveur).
 */
export function rankLanUrls(urls: readonly string[], interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): LanAddress[] {
  const names = new Map<string, string>();
  for (const [name, list] of Object.entries(interfaces)) {
    for (const net of list ?? []) if (net.family === 'IPv4') names.set(net.address, name);
  }
  const seen = new Set<string>();
  const ranked: (LanAddress & { order: number })[] = [];
  urls.forEach((raw, order) => {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return;
    }
    const host = url.hostname;
    if (url.protocol !== 'http:' || !url.port || !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return;
    if (host.startsWith('127.') || host.startsWith('169.254.')) return;
    const origin = `http://${host}:${url.port}`;
    if (seen.has(origin)) return;
    seen.add(origin);
    const interfaceName = names.get(host) ?? null;
    ranked.push({ order, url: origin, host, label: `${host}:${url.port}`, interfaceName, virtual: interfaceName !== null && VIRTUAL.test(interfaceName) });
  });
  return ranked
    .sort((a, b) => Number(a.virtual) - Number(b.virtual) || privateRank(a.host) - privateRank(b.host) || a.order - b.order)
    .map(({ order: _order, ...address }) => address);
}
