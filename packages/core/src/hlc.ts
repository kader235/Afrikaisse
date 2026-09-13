/**
 * Horloge logique hybride (HLC).
 *
 * Les horloges des PC de restaurant sont souvent fausses (pile BIOS morte,
 * réglage manuel). On ne peut donc pas départager deux modifications avec
 * `Date.now()` seul. Une HLC avance toujours, même si l'horloge murale recule,
 * et intègre les horodatages reçus des autres nœuds.
 *
 * Format texte triable lexicographiquement :
 *   <millisecondes sur 15 chiffres>-<compteur sur 5 chiffres>-<nodeId>
 */
export interface HlcTimestamp {
  wallMs: number;
  counter: number;
  nodeId: string;
}

const MAX_COUNTER = 99_999;

export function formatHlc(ts: HlcTimestamp): string {
  return `${String(ts.wallMs).padStart(15, '0')}-${String(ts.counter).padStart(5, '0')}-${ts.nodeId}`;
}

export function parseHlc(value: string): HlcTimestamp {
  const match = /^(\d{15})-(\d{5})-(.+)$/.exec(value);
  if (!match) throw new Error(`HLC invalide : ${value}`);
  return { wallMs: Number(match[1]), counter: Number(match[2]), nodeId: match[3]! };
}

export class HybridClock {
  private last: HlcTimestamp;

  constructor(
    private readonly nodeId: string,
    private readonly wallClock: () => number = Date.now,
  ) {
    this.last = { wallMs: 0, counter: 0, nodeId };
  }

  /** Horodatage d'un événement produit localement. */
  now(): string {
    const wall = this.wallClock();
    if (wall > this.last.wallMs) {
      this.last = { wallMs: wall, counter: 0, nodeId: this.nodeId };
    } else {
      this.bump(this.last.wallMs, this.last.counter + 1);
    }
    return formatHlc(this.last);
  }

  /** Intègre un horodatage reçu d'un autre nœud (synchronisation). */
  receive(remote: string): string {
    const r = parseHlc(remote);
    const wall = this.wallClock();
    const maxWall = Math.max(wall, this.last.wallMs, r.wallMs);
    let counter: number;
    if (maxWall === this.last.wallMs && maxWall === r.wallMs) {
      counter = Math.max(this.last.counter, r.counter) + 1;
    } else if (maxWall === this.last.wallMs) {
      counter = this.last.counter + 1;
    } else if (maxWall === r.wallMs) {
      counter = r.counter + 1;
    } else {
      counter = 0;
    }
    this.bump(maxWall, counter);
    return formatHlc(this.last);
  }

  private bump(wallMs: number, counter: number): void {
    if (counter > MAX_COUNTER) {
      this.last = { wallMs: wallMs + 1, counter: 0, nodeId: this.nodeId };
    } else {
      this.last = { wallMs, counter, nodeId: this.nodeId };
    }
  }
}
