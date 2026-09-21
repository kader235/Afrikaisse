import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { businessDate } from '@afrikaisse/core';
import { ENGINES, PASSWORD, as, registerOrg, startApp } from './helpers.ts';

describe.each(ENGINES)('Durcissement (phase 18) — %s', (engine) => {
  // Une centaine de connexions et d'inscriptions, chacune avec un hachage de mot de passe volontairement lent.
  it('limite inscriptions, connexions et commandes QR par adresse IP, avec Retry-After', { timeout: 120_000 }, async () => {
    const t = await startApp(engine, { AFK_RATE_LIMIT: 'true' });
    try {
      const from = (ip: string) => ({ 'x-forwarded-for': ip });
      const login = (i: number, ip: string) =>
        t.app.inject({ method: 'POST', url: '/api/auth/login', headers: from(ip), payload: { email: `inconnu.${i}@test.td`, password: 'mauvais-mot-de-passe' } });
      for (let i = 0; i < 30; i++) expect((await login(i, '41.202.10.1')).statusCode).toBe(401);
      const limited = await login(30, '41.202.10.1');
      expect(limited.statusCode).toBe(429);
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(500);
      expect(limited.json().error.message).toContain('Trop de demandes');
      // Une autre adresse n'est pas touchée ; la fenêtre passée, l'adresse retrouve ses essais.
      expect((await login(31, '41.202.10.2')).statusCode).toBe(401);
      t.clock.offsetMs = 601_000;
      expect((await login(32, '41.202.10.1')).statusCode).toBe(401);
      t.clock.offsetMs = 0;

      // Sans adresse de client transmise par le proxy : aucun compteur commun à tous les clients.
      for (let i = 0; i < 35; i++) {
        const res = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `sans.adresse.${i}@test.td`, password: 'mauvais-mot-de-passe' } });
        expect(res.statusCode).toBe(401);
      }

      const register = (i: number, ip: string) =>
        t.app.inject({
          method: 'POST',
          url: '/api/auth/register',
          headers: from(ip),
          payload: { organizationName: `Resto ${i}`, locationName: `Salle ${i}`, ownerName: 'Patron', email: `limite.${i}.${Date.now()}@test.td`, password: PASSWORD },
        });
      for (let i = 0; i < 10; i++) expect((await register(i, '41.202.20.1')).statusCode).toBe(201);
      expect((await register(10, '41.202.20.1')).statusCode).toBe(429);

      // Commandes QR comptées par table : un Wi-Fi partagé ne bloque pas toute la salle.
      const qr = (token: string) => t.app.inject({ method: 'POST', url: `/api/public/menu/${token}/orders`, headers: from('41.202.30.1'), payload: {} });
      for (let i = 0; i < 30; i++) expect((await qr('table-une')).statusCode).not.toBe(429);
      expect((await qr('table-une')).statusCode).toBe(429);
      expect((await qr('table-deux')).statusCode).not.toBe(429);
    } finally {
      await t.close();
    }
  });

  // Sécurité : le Cloud ne fait confiance qu'au relais local (plages privées). Un client qui préfixe
  // lui-même X-Forwarded-For avec une fausse adresse à chaque essai est quand même compté sur son
  // adresse réelle (celle que le relais ajoute en dernier), donc ne peut pas contourner la limite.
  it("ne se laisse pas berner par un X-Forwarded-For usurpé", { timeout: 60_000 }, async () => {
    const t = await startApp(engine, { AFK_RATE_LIMIT: 'true' });
    try {
      // Adresse réelle constante (dernière entrée) ; fausse adresse en tête, changée à chaque requête.
      const spoofed = (i: number) =>
        t.app.inject({
          method: 'POST',
          url: '/api/auth/login',
          headers: { 'x-forwarded-for': `203.0.113.${i}, 41.203.55.7` },
          payload: { email: `usurpation.${i}@test.td`, password: 'mauvais-mot-de-passe' },
        });
      for (let i = 0; i < 30; i++) expect((await spoofed(i)).statusCode).toBe(401);
      // Malgré une IP de tête différente, la 31e est bloquée : toutes ont compté sur 41.203.55.7.
      expect((await spoofed(99)).statusCode).toBe(429);
    } finally {
      await t.close();
    }
  });

  it("sert l'application avec une politique de sécurité du contenu", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'afk-web-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>AfriKaisse</title>');
    writeFileSync(join(dir, 'menu.html'), '<!doctype html><title>Menu</title>');
    writeFileSync(join(dir, 'assets', 'main-abc.js'), 'console.log(1)');
    const t = await startApp(engine, { AFK_WEB_DIR: dir });
    try {
      for (const url of ['/', '/caisse', '/m/jeton-table']) {
        const page = await t.app.inject({ method: 'GET', url });
        expect(page.statusCode).toBe(200);
        expect(page.headers['content-security-policy']).toContain("script-src 'self'");
        expect(page.headers['content-security-policy']).toContain("frame-ancestors 'none'");
        expect(page.headers['x-content-type-options']).toBe('nosniff');
      }
      const script = await t.app.inject({ method: 'GET', url: '/assets/main-abc.js' });
      expect(script.headers['cache-control']).toContain('immutable');
    } finally {
      await t.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('une journée chargée reste rapide : 200 ventes encaissées, rapport, additions et flux', { timeout: 240_000 }, async () => {
    const t = await startApp(engine);
    try {
      const org = await registerOrg(t, 'Charge');
      const owner = as(t, org.token);
      const locationId = org.me.locations[0].id as string;
      expect((await owner.post(`/api/locations/${locationId}/demo`)).statusCode).toBe(201);
      const menu = (await owner.get(`/api/locations/${locationId}/menu`)).json();
      const simple = menu.products.filter((p: { modifierGroupIds: string[]; variants: unknown[] }) => p.modifierGroupIds.length === 0 && p.variants.length === 0);
      expect(simple.length).toBeGreaterThan(2);
      expect((await owner.post(`/api/locations/${locationId}/cash-sessions`, { openingFloat: 0 })).statusCode).toBeLessThan(300);

      const N = 200;
      let expected = 0;
      const started = performance.now();
      for (let i = 0; i < N; i++) {
        const product = simple[i % simple.length];
        const order = await owner.post(`/api/locations/${locationId}/orders`, { tableId: null, lines: [{ productId: product.id, modifierIds: [], quantity: 1 + (i % 3) }] });
        expect(order.statusCode).toBe(201);
        const total = order.json().total as number;
        expected += total;
        const paid = await owner.post(`/api/locations/${locationId}/payments`, { target: { kind: 'order', id: order.json().id }, method: i % 2 ? 'CASH' : 'CARD', amount: total });
        expect(paid.statusCode).toBeLessThan(300);
      }
      const perSale = (performance.now() - started) / N;

      const timed = async (url: string) => {
        const s = performance.now();
        const res = await owner.get(url);
        expect(res.statusCode).toBe(200);
        return { ms: performance.now() - s, body: res.json() };
      };
      const loc = (await owner.get('/api/locations')).json()[0];
      const today = businessDate(t.ctx.now(), loc.timezone, loc.businessDayCutoffMin);
      const report = await timed(`/api/locations/${locationId}/reports/sales?from=${today}&to=${today}`);
      expect(JSON.stringify(report.body)).toContain(String(expected));
      const checks = await timed(`/api/locations/${locationId}/checks`);
      const activity = await timed(`/api/locations/${locationId}/activity?since=0`);
      console.info(
        `[charge ${engine}] vente + encaissement ${perSale.toFixed(1)} ms ; rapport ${report.ms.toFixed(0)} ms ; additions ${checks.ms.toFixed(0)} ms ; flux ${activity.ms.toFixed(0)} ms`,
      );
      expect(perSale).toBeLessThan(300);
      for (const x of [report, checks, activity]) expect(x.ms).toBeLessThan(1500);
    } finally {
      await t.close();
    }
  });
});
