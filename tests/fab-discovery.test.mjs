import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const location = new URL('https://www.fab.com/limited-time-free');
const context = {
  URL,
  location,
  getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
};
const source = readFileSync(new URL('../src/sites/fab/discovery.js', import.meta.url), 'utf8');
vm.runInNewContext(source, context);
const { exactPriceKind, parseLimitedTimeHeading } = context.__efar.sites.fab.discovery;

test('interprets the French limited-time heading in the displayed time zone', () => {
  const heading = 'Gratuit pour une durée limitée (01/12 à 15h59 CET)';
  assert.equal(parseLimitedTimeHeading(heading, new Date('2026-11-24T12:00Z')), Date.parse('2026-12-01T14:59Z'));
  assert.equal(parseLimitedTimeHeading(heading, new Date('2026-12-01T14:59Z')), null);
  assert.equal(parseLimitedTimeHeading('Gratuit pour une durée limitée (31/02 à 15h59 CET)', new Date('2026-01-24T12:00Z')), null);
});

test('recognizes the French starred free price and distinguishes a starting price', () => {
  const element = (innerText) => ({ innerText, isConnected: true, querySelectorAll: () => [], getClientRects: () => [{}] });
  assert.equal(exactPriceKind(element('Gratuit*')), 'free');
  assert.equal(exactPriceKind(element('À partir de Gratuit')), 'from-free');
  assert.equal(exactPriceKind(element('21,85 €')), null);
});
