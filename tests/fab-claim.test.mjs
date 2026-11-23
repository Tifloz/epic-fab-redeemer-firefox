import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const location = new URL('https://www.fab.com/limited-time-free');
const context = {
  location,
  getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
};
const source = readFileSync(new URL('../src/sites/fab/claim.js', import.meta.url), 'utf8');
vm.runInNewContext(source, context);
const { classifyFabPage } = context.__efar.sites.fab.claim;

function pageWithLicenseCopy(acceptLabel) {
  const control = {
    innerText: acceptLabel,
    isConnected: true,
    getAttribute: () => null,
    getClientRects: () => [{}],
  };
  return {
    body: { innerText: "Gratuit pour une durée limitée. Conditions d’utilisation" },
    querySelectorAll: (selector) => acceptLabel && selector.startsWith('button') ? [control] : [],
  };
}

test('ignores the Fab footer terms link but pauses for a visible acceptance control', () => {
  assert.equal(classifyFabPage(pageWithLicenseCopy()), null);
  assert.equal(classifyFabPage(pageWithLicenseCopy('J’accepte les conditions')).state, 'needs-user-action');
});
