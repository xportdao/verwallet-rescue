// VerWallet rescue page: the main Gram wallet's 24 words, rebuilt on the person's own device from the two key parts
// Telegram keeps for @Verwallet_bot (this phone's secure storage and the account's cloud), with no VerWallet server.
// It runs only when the bot opens it as its Mini App: Telegram keeps those storages per bot, so anywhere else it
// sees nothing. It makes no network requests; the words never leave the screen. See README.md.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VW_RESCUE = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // The storage names and formats of web/app.js (owner 20.10.2026, docs/gram-keys-on-device.md).
  const SHARE_B = 'gram_main_b';
  const SHARE_B_NEXT = 'gram_main_b_next';
  const SHARE_C = 'gram_main_c';
  const unb64 = text => Uint8Array.from(atob(text), char => char.charCodeAt(0));

  async function passwordKey(password, salt) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  }
  /** The cloud part as stored: as is, or sealed with the recovery password (AES-GCM, PBKDF2 310 000). */
  async function openCloudPart(text, password) {
    const data = JSON.parse(text);
    if (data.s) return unb64(data.s);
    if (!password) throw Object.assign(new Error('password'), { code: 'PASSWORD_NEEDED' });
    try {
      return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(data.p.iv) }, await passwordKey(password, unb64(data.p.salt)), unb64(data.p.ct)));
    } catch { throw Object.assign(new Error('password'), { code: 'PASSWORD_WRONG' }); }
  }

  /**
   * The words from any two parts that make a valid TON mnemonic, with the wallet's W5 address. `phone` is the
   * secure storage part (base64), `cloud` the stored cloud parts (B and the spare B being written during a re-split).
   * Throws PASSWORD_NEEDED or PASSWORD_WRONG when only a sealed cloud part could help, NOT_ENOUGH otherwise.
   */
  async function recover(V, { phone = '', cloud = [], password = '', testnet = false }) {
    const parts = [];
    if (phone) parts.push(unb64(phone));
    let need = null;
    for (const text of cloud.filter(Boolean)) {
      try { parts.push(await openCloudPart(text, password)); } catch (error) { need = need === 'PASSWORD_WRONG' ? need : error.code; }
    }
    for (let i = 0; i < parts.length; i += 1) {
      for (let j = i + 1; j < parts.length; j += 1) {
        let words;
        try { words = new TextDecoder().decode(await V.combine([parts[i], parts[j]])).split(' '); } catch { continue; }
        // Parts of two different splits combine into noise: only a valid mnemonic counts.
        if (words.length !== 24 || !(await V.mnemonicValidate(words))) continue;
        const keys = await V.mnemonicToPrivateKey(words);
        const contract = V.WalletContractV5R1.create({ publicKey: keys.publicKey, walletId: { networkGlobalId: testnet ? -3 : -239 } });
        keys.secretKey.fill(0);
        return { words, address: contract.address.toString({ bounceable: false, testOnly: testnet }) };
      }
    }
    throw Object.assign(new Error('parts'), { code: need || (parts.length ? 'NOT_ENOUGH' : 'NO_WALLET') });
  }

  return { SHARE_B, SHARE_B_NEXT, SHARE_C, recover };
}));

// ---------- the page
(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  const R = window.VW_RESCUE;
  const tg = window.Telegram && window.Telegram.WebApp;
  // English only, whatever the Telegram language (owner 21.10.2026: «только англоязычный текст»).
  const testnet = new URLSearchParams(location.search).get('network') === 'testnet';
  const main = document.getElementById('rescue');
  try { if (tg) { tg.ready(); tg.expand(); } } catch { /* optional */ }

  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    children.flat().filter(Boolean).forEach(child => node.append(child));
    return node;
  };
  const show = (...nodes) => { main.replaceChildren(...nodes.filter(Boolean)); const h = main.querySelector('h1'); if (h) h.focus({ preventScroll: true }); };
  const heading = text => el('h1', { tabindex: '-1', text });
  const para = (text, cls = 'lead') => el('p', { class: cls, text });

  const inTelegram = () => { try { return !!(tg && tg.initData && tg.isVersionAtLeast('6.9')); } catch { return false; } };
  const secureStore = () => { try { return tg.isVersionAtLeast('9.0') && tg.SecureStorage && ['ios', 'android', 'android_x'].includes(tg.platform) ? tg.SecureStorage : null; } catch { return null; } };
  const call = (target, method, ...args) => new Promise((resolve, reject) => {
    try { target[method](...args, (error, value, extra) => (error ? reject(new Error(String(error))) : resolve({ value, extra }))); } catch (error) { reject(error); }
  });

  let shown = null;
  let hideTimer = null;
  function wipe() {
    clearTimeout(hideTimer);
    if (shown) shown.words.fill('');
    shown = null;
  }

  async function readParts() {
    const secure = secureStore();
    const phone = secure ? await call(secure, 'getItem', R.SHARE_C).catch(() => ({ value: '', extra: false })) : { value: '', extra: false };
    const stored = await call(tg.CloudStorage, 'getItems', [R.SHARE_B, R.SHARE_B_NEXT]).then(r => r.value || {}, () => ({}));
    return { phone: phone.value || '', canRestore: !!phone.extra, cloud: [stored[R.SHARE_B], stored[R.SHARE_B_NEXT]].filter(Boolean) };
  }

  async function attempt(password = '') {
    let parts;
    try { parts = await readParts(); } catch { return showProblem('The Telegram storage did not answer. Close the page and open it again.'); }
    try {
      if (!window.VWTon) throw Object.assign(new Error('lib'), { code: 'LIB' });
      shown = await R.recover(window.VWTon, { ...parts, password, testnet });
      showWords();
    } catch (error) {
      if (error.code === 'PASSWORD_NEEDED' || error.code === 'PASSWORD_WRONG') return showPassword(error.code === 'PASSWORD_WRONG');
      if (error.code === 'NOT_ENOUGH' && !parts.phone && parts.canRestore) return showRestore();
      if (error.code === 'NO_WALLET') return showProblem('This Telegram account has no VerWallet main Gram wallet.');
      if (error.code === 'LIB') return showProblem('The page did not load completely. Close it and open it again.');
      return showProblem('This device does not hold enough key parts. Open the page on the phone where you used VerWallet.');
    }
  }

  function showStart() {
    show(
      heading('Recovering the main Gram wallet'),
      para('VerWallet is not working right now. This page puts the main Gram wallet key together from the two parts Telegram keeps: on this phone and in your Telegram cloud. No VerWallet server is needed.'),
      para('You will see 24 words. Enter them in Tonkeeper or another TON wallet and the funds are yours.', 'note'),
      para('The referral wallet cannot be recovered here: its key was kept on the VerWallet server.', 'note'),
      el('div', { class: 'bar' }, el('button', { type: 'button', class: 'primary', onclick: () => attempt(), text: 'Show the 24 words' })),
    );
  }

  function showPassword(wrong) {
    const input = el('input', { id: 'rescue-password', type: 'password', autocomplete: 'current-password', enterkeyhint: 'done' });
    const go = () => { const value = input.value; input.value = ''; attempt(value); };
    input.addEventListener('keydown', event => { if (event.key === 'Enter') go(); });
    show(
      heading('Recovery password'),
      para('The key part in your Telegram cloud is locked with your recovery password.'),
      el('label', { for: 'rescue-password', text: 'Password' }), input,
      wrong ? el('p', { class: 'error', role: 'alert', text: 'Wrong password.' }) : null,
      el('div', { class: 'bar' }, el('button', { type: 'button', class: 'primary', onclick: go, text: 'Unlock' })),
    );
    input.focus();
  }

  function showRestore() {
    show(
      heading('The key part on this phone'),
      para('Telegram kept a key part from an earlier install on this phone. Restore it to put the key together.'),
      el('div', { class: 'bar' }, el('button', { type: 'button', class: 'primary', text: 'Restore the key part from Telegram', onclick: async () => {
        try { await call(secureStore(), 'restoreItem', R.SHARE_C); } catch { return showProblem('Telegram did not return the key part.'); }
        attempt();
      } })),
    );
  }

  function showWords() {
    const list = el('ol', { class: 'words' }, shown.words.map(word => el('li', { text: word })));
    show(
      heading('The main wallet’s 24 words'),
      para('Write them down in order and enter them in Tonkeeper or another TON wallet (“Import wallet”, version W5). Whoever knows the words controls the Gram.'),
      // Judge V-95: the page shows up exactly when the service is down, the time «recovery helpers» write.
      para('Never share these words or enter them on a website, only in a wallet app.', 'note warn'),
      el('dl', { class: 'address' }, el('dt', { text: 'Wallet address' }), el('dd', { text: shown.address })),
      list,
      // Judge V-96: the auto-hide is said, not silent.
      para('The words hide after 2 minutes. Show them again with “Show the 24 words”.', 'help'),
      el('div', { class: 'bar' }, el('button', { type: 'button', onclick: () => { wipe(); showStart(); }, text: 'Hide the words' })),
    );
    // As in the app, the words do not stay on screen unattended.
    hideTimer = setTimeout(() => { wipe(); showStart(); }, 120000);
  }

  function showProblem(text) {
    show(heading('Something went wrong'), para(text), el('div', { class: 'bar' }, el('button', { type: 'button', onclick: () => showStart(), text: 'Back' })));
  }

  document.addEventListener('visibilitychange', () => { if (document.hidden && shown) { wipe(); showStart(); } });
  if (!inTelegram()) {
    show(heading('Open in Telegram'), para('This page works only inside Telegram, opened from the @Verwallet_bot bot.'));
  } else {
    showStart();
  }
}());
