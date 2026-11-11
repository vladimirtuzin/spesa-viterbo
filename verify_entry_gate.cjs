// Run: node verify_entry_gate.cjs. No browser or dependencies required.
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {runInNewContext} = require('node:vm');
const source = readFileSync('app.js', 'utf8');
const gate = source.slice(source.indexOf('async function checkEntry(){'), source.indexOf('\nconst euro ='));

async function visit({saved = null, cookie = '', storageBlocked = false} = {}) {
  const elements = Object.fromEntries(['entryGate','siteContent','entryTitle','entryForm','entryQuestion','entryDenied','categoryTitle'].map(id => [id, {
    hidden: ['siteContent', 'entryDenied'].includes(id),
    focus() {}, setAttribute() {}, classList: {add() {}},
    addEventListener(type, listener) { this[type] = listener; },
  }]));
  const storage = new Map(saved ? [['shopping-by-tuzin-entry-v1', saved]] : []);
  const document = {cookie};
  if (storageBlocked) Object.defineProperty(document, 'cookie', {get() {throw Error('Blocked');}, set() {throw Error('Blocked');}});
  const localStorage = {
    getItem(key) {if (storageBlocked) throw Error('Blocked'); return storage.get(key);},
    setItem(key, value) {if (storageBlocked) throw Error('Blocked'); storage.set(key, value);},
  };
  const window = {addEventListener(type, listener) {this[type] = listener;}};
  const location = {protocol:'https:', reload() {this.reloaded = true;}};
  const result = runInNewContext(`${gate}\ncheckEntry()`, {$: id => elements[id], document, localStorage, window, location});
  const answer = value => elements.entryForm.submit({preventDefault() {}, submitter: {value}});
  return {elements, storage, document, window, location, result, answer};
}

(async () => {
  let page = await visit();
  assert.equal(page.elements.siteContent.hidden, true);
  page.answer('yes');
  assert.equal(await page.result, false);
  assert.equal(page.elements.entryDenied.hidden, false);
  assert.equal(page.elements.siteContent.hidden, true);
  assert.equal(page.storage.size, 0);
  assert.equal(page.document.cookie, '');
  page.window.pageshow({persisted:false});
  assert.equal(page.location.reloaded, undefined);
  page.window.pageshow({persisted:true});
  assert.equal(page.location.reloaded, true); // Back/Forward cache must not restore a denial.
  page = await visit(); // A fresh visit after Yes asks again.
  assert.equal(page.elements.entryQuestion.hidden, false);
  page.answer('no');
  assert.equal(await page.result, true);
  assert.equal(page.elements.siteContent.hidden, false);
  assert.equal(page.storage.get('shopping-by-tuzin-entry-v1'), 'no');
  assert.match(page.document.cookie, /tuzin_entry=no; Max-Age=31536000; Path=\/; SameSite=Lax; Secure/);
  for (const options of [{saved:'no'}, {cookie:'other=value; tuzin_entry=no'}]) {
    page = await visit(options);
    assert.equal(await page.result, true);
    assert.equal(page.elements.entryGate.hidden, true);
  }
  for (const options of [{saved:'yes'}, {cookie:'tuzin_entry=yes'}, {saved:'invalid'}, {storageBlocked:true}]) {
    page = await visit(options);
    assert.equal(page.elements.siteContent.hidden, true);
    page.answer('no');
    assert.equal(await page.result, true);
    assert.equal(page.elements.siteContent.hidden, false);
  }
  console.log('Entry gate: Yes is temporary, No persists, cookie fallback and blocked storage pass.');
})().catch(error => {console.error(error); process.exitCode = 1;});
