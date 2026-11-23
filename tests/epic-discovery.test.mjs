import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/sites/epic/discovery.js', import.meta.url), 'utf8');
const origin = 'https://store.epicgames.com';
const location = {
  href: `${origin}/free-games`,
  hostname: 'store.epicgames.com',
  pathname: '/free-games',
  protocol: 'https:',
};

class FixtureElement {
  constructor(tagName, { text = '', attrs = {}, children = [] } = {}) {
    this.tagName = tagName.toLowerCase();
    this.text = text;
    this.attrs = attrs;
    this.children = children;
    this.isConnected = true;
    this.parentElement = null;
    for (const child of children) child.parentElement = this;
  }

  get innerText() {
    return this.text || this.children.map((child) => child.innerText).filter(Boolean).join(' ');
  }

  get textContent() { return this.innerText; }

  get href() { return new URL(this.attrs.href, origin).href; }

  get dateTime() { return this.attrs.datetime; }

  getClientRects() { return [{}]; }

  getAttribute(name) { return this.attrs[name] ?? null; }

  matches(selector) {
    if (selector.includes("[data-testid*='card' i]")) {
      return /card|offer/i.test(this.attrs['data-testid'] || '');
    }
    return this.tagName === 'article' || this.attrs.role === 'listitem';
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

  querySelectorAll(selector) {
    const descendants = [];
    const visit = (element) => {
      for (const child of element.children) {
        descendants.push(child);
        visit(child);
      }
    };
    visit(this);
    return descendants.filter((element) => matchesSelector(element, selector));
  }
}

function matchesSelector(element, selector) {
  return selector.split(',').some((part) => {
    const value = part.trim();
    if (value === 'a[href]') return element.tagName === 'a' && Boolean(element.attrs.href);
    if (value === 'button') return element.tagName === 'button';
    if (value === 'article') return element.tagName === 'article';
    if (value === 'li') return element.tagName === 'li';
    if (value === '[role="button"]') return element.attrs.role === 'button';
    if (value === '[role="listitem"]') return element.attrs.role === 'listitem';
    if (value === '[role="heading"]') return element.attrs.role === 'heading';
    if (value === '[aria-label]') return Boolean(element.attrs['aria-label']);
    if (value === '[title]') return Boolean(element.attrs.title);
    if (value === '[data-testid*="card" i]' || value === "[data-testid*='card' i]") {
      return /card|offer/i.test(element.attrs['data-testid'] || '');
    }
    if (value === 'time[datetime]') return element.tagName === 'time' && Boolean(element.attrs.datetime);
    if (value === 'img[alt]') return element.tagName === 'img' && Boolean(element.attrs.alt);
    return /^h[1-6]$/.test(value) && element.tagName === value;
  });
}

function productCard({ title, slug, text, badge }) {
  const deadline = text.match(/jusqu'au\s+(\d{1,2}\s+[a-z.]+)\s+à\s+(\d{1,2}:\d{2})/i);
  const claimText = deadline
    ? `Gratuit jusqu'au ${deadline[1]} à ${deadline[2]}`
    : text;
  const datetime = deadline ? '2999-12-31T16:00:00.000Z' : undefined;
  return new FixtureElement('div', {
    attrs: { 'data-component': 'FreeOfferCard' },
    children: [new FixtureElement('a', {
      attrs: {
        href: `/p/${slug}`,
        'aria-label': `Jeux gratuits, ${title}, ${text}`,
      },
      children: [
        ...(badge ? [new FixtureElement('span', { text: badge })] : []),
        new FixtureElement('h6', { text: title }),
        new FixtureElement('p', { children: [new FixtureElement('span', {
          children: [
            new FixtureElement('span', { text: claimText }),
            ...(datetime ? [new FixtureElement('time', { text: '26 nov.', attrs: { datetime } })] : []),
          ],
        })] }),
      ],
    })],
  });
}

function discover(cards) {
  const context = {
    URL,
    location,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
  };
  vm.runInNewContext(source, context);
  const document = new FixtureElement('main', { children: cards });
  return Array.from(context.__efar.sites.epic.discovery.scan(document, location));
}

test('discovers Epic FreeOfferCard markup with an active free-until date', () => {
  const results = discover([
    productCard({
      title: 'Mark of the Deep',
      slug: 'mark-of-the-deep',
      text: "Mark of the Deep GRATUIT Gratuit jusqu'au 31 décembre 2999 à 17:00",
    }),
  ]);

  assert.deepEqual(results.map((item) => item.title), ['Mark of the Deep']);
  assert.equal(results[0].eligible, true);
});

test('ignores upcoming PC giveaways, free-to-play games, and mobile-only gifts', () => {
  const results = discover([
    productCard({ title: 'Bread and Fred', slug: 'bread-and-fred', text: 'Bread and Fred BIENTÔT DISPONIBLE Gratuit 26 nov. - 03 déc.' }),
    productCard({ title: 'Firestone', slug: 'firestone', text: 'Firestone BIENTÔT DISPONIBLE Gratuit 26 nov. - 03 déc.' }),
    productCard({ title: 'Once Human', slug: 'once-human', text: 'Once Human Jouer gratuitement' }),
    productCard({ title: 'Lonesome Village', slug: 'lonesome-village', text: "Lonesome Village Disponible sur mobile Cadeau Recevez un nouveau jeu gratuitement. Installer l'appli mobile." }),
  ]);

  assert.deepEqual(results, []);
});
