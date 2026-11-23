import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const location = new URL('https://store.epicgames.com/p/mark-of-the-deep-f7dc08');
const source = readFileSync(new URL('../src/sites/epic/claim.js', import.meta.url), 'utf8');

function element(text, children = {}) {
  return {
    innerText: text,
    isConnected: true,
    getAttribute: () => null,
    getClientRects: () => [{}],
    querySelectorAll: (selector) => children[selector] || [],
  };
}

function productFixture(price, expiry) {
  const title = element('Mark of the Deep');
  const description = element('Mark of the Deep est une aventure de pirates');
  const get = element('Obtenir');
  const body = element('Mark of the Deep');
  const buttons = "button, [role='button']";
  const sidebar = element(`Jeu de base\n${price}\nLa promotion se termine le ${expiry}\nObtenir`, {
    [buttons]: [get],
  });
  const main = element('Mark of the Deep et contenus additionnels', { 'h1, h2': [title, description], [buttons]: [get] });
  get.parentElement = sidebar;
  sidebar.parentElement = main;
  title.parentElement = main;
  const document = {
    body,
    querySelector: (selector) => selector === 'main' ? main : null,
    querySelectorAll: (selector) => selector === 'main h1, main h2, h1, h2' ? [title, description] : [],
  };
  const context = {
    URL, location, document,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
  };
  vm.runInNewContext(source, context);
  const epic = context.__efar.sites.epic;
  epic.discovery = { scan: () => [] };
  return { claim: epic.claim.claimEpic, get, item: { title: title.innerText, url: location.href, eligible: true } };
}

test('finds the French base game offer in a separate product sidebar', async () => {
  const { claim, get, item } = productFixture('-100 %19,99 $US*Gratuit', '26/11/2999 à 16:00 UTC');
  let clicked = 0;
  get.click = () => { clicked += 1; throw new Error('Stop at the storefront click'); };

  await assert.rejects(claim(item, {}), /Stop at the storefront click/);
  assert.equal(clicked, 1);
});

test('leaves expired and paid Epic promotions untouched', async () => {
  for (const [price, expiry] of [['-100 % Gratuit', '26/11/2000 à 16:00 UTC'], ['-50 % 9,99 €', '26/11/2999 à 16:00 UTC']]) {
    const { claim, get, item } = productFixture(price, expiry);
    get.click = () => assert.fail('The offer is not eligible');
    assert.equal((await claim(item, {})).state, 'needs-user-action');
  }
});
