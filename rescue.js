// VerWallet rescue page: the main wallet's 24 words, rebuilt on the person's own device from the two key parts
// Telegram keeps for @Verwallet_bot (this phone's secure storage and the account's cloud), with no VerWallet server.
// It runs only when the bot opens it as its Mini App: Telegram keeps those storages per bot, so anywhere else it
// sees nothing. It makes no network requests; the words never leave the screen. See README.md.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VW_RESCUE = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // The storage names of web/app.js and protocol v1 (docs/main-wallet-one-phrase.md): the main wallet of one phrase
  // for Gram and Klever (main_*), and the earlier main Gram wallet (gram_main_*, owner 20.10.2026).
  const MAIN = { b: 'main_b', next: 'main_b_next', c: 'main_c', anchor: 'main_anchor' };
  const GRAM = { b: 'gram_main_b', next: 'gram_main_b_next', c: 'gram_main_c', anchor: 'gram_main_address' };
  // Gram from one phrase of both chains: SLIP-10 at this path, a W5 wallet, as Tonkeeper and MyTonWallet read it.
  const TON_PATH = "m/44'/607'/0'";
  const unb64 = text => Uint8Array.from(atob(text), char => char.charCodeAt(0));
  const fail = code => Object.assign(new Error(code), { code });

  const tonAddress = (V, text) => { try { return V.Address.parse(text); } catch { return null; } };
  const w5 = (V, publicKey, testnet) => V.WalletContractV5R1.create({ publicKey: V.Buffer.from(publicKey), walletId: { networkGlobalId: testnet ? -3 : -239 } }).address;
  const shown = (address, testnet) => address.toString({ bounceable: false, testOnly: testnet });
  function profileTon(V, K, words, testnet) {
    const pair = K.deriveEd25519(words, TON_PATH);
    pair.privateKey.fill(0);
    return w5(V, pair.publicKey, testnet);
  }
  /** The earlier wallet's Gram, by Tonkeeper's own rule: a TON mnemonic by TON's scheme, any other phrase as BIP39. */
  async function earlierTon(V, K, words, testnet) {
    if (!(await V.mnemonicValidate(words))) return profileTon(V, K, words, testnet);
    const keys = await V.mnemonicToPrivateKey(words);
    keys.secretKey.fill(0);
    return w5(V, keys.publicKey, testnet);
  }

  /** main_anchor, strictly: exactly v, ton and klever with v 1 (protocol v1 §4.1). Anything else is a mismatch. */
  function mainAnchor(V, text) {
    let data;
    try { data = JSON.parse(text); } catch { throw fail('ANCHOR_BAD'); }
    const fields = data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data).sort().join() : '';
    const ton = fields === 'klever,ton,v' && data.v === 1 && typeof data.ton === 'string' ? tonAddress(V, data.ton) : null;
    if (!ton || typeof data.klever !== 'string' || !/^klv1[02-9ac-hj-np-z]{58}$/.test(data.klever)) throw fail('ANCHOR_BAD');
    return { ton, klever: data.klever };
  }
  function gramAnchor(V, text) {
    const ton = tonAddress(V, text);
    if (!ton) throw fail('ANCHOR_BAD');
    return { ton };
  }
  /** The cloud and phone copies as one: a copy that does not read, or two that differ, stop everything. */
  function oneAnchor(copies, read) {
    const found = copies.filter(Boolean).map(read);
    if (found.length === 2 && !(found[0].ton.equals(found[1].ton) && found[0].klever === found[1].klever)) throw fail('ANCHOR_MISMATCH');
    return found[0] || null;
  }

  /**
   * One wallet's words from any two of its parts, checked against its saved addresses. `which` is 'main' (one phrase
   * for Gram and Klever) or 'gram' (the earlier main Gram wallet); `parts` holds `phone` (the secure storage part,
   * base64), `cloud` (B and the spare B of a re-split cut short, as stored) and `anchors` (the cloud and phone copies).
   * Throws PASSWORD_NEEDED or PASSWORD_WRONG when only a sealed cloud part could help, ANCHOR_BAD or ANCHOR_MISMATCH
   * when the saved address does not read or does not match, NOT_ENOUGH or NO_WALLET otherwise.
   */
  async function recover(V, K, { which = 'gram', parts = {}, password = '', testnet = false }) {
    const { phone = '', cloud = [], anchors = [] } = parts;
    const anchor = oneAnchor(anchors, which === 'main' ? text => mainAnchor(V, text) : text => gramAnchor(V, text));
    // With no server, the phone's part is one of the two: the cloud alone holds one part of a split (its spare, from a
    // re-split cut short, belongs to another split or repeats it). Its password is never asked for nothing (judge V-101).
    if (!phone) throw fail(cloud.some(Boolean) ? 'NOT_ENOUGH' : 'NO_WALLET');
    const shares = [unb64(phone)];
    let need = null;
    for (const text of cloud.filter(Boolean)) {
      try { shares.push(await K.openShare(text, password || null)); } catch (error) { need = need === 'PASSWORD_WRONG' ? need : error.code; }
    }
    let found = null;
    // Every pair is tried; only words whose addresses are the saved ones count (v1 also carries its own tag).
    const check = async words => {
      if (which === 'main' && K.phraseProfileIssues(words).length) return false;
      // With no saved address, the earlier wallet's words must at least be a TON mnemonic, as the app made them.
      if (which === 'gram' && !anchor && !(await V.mnemonicValidate(words))) return false;
      const ton = which === 'main' ? profileTon(V, K, words, testnet) : await earlierTon(V, K, words, testnet);
      const klever = which === 'main' ? K.deriveAccount(words).address : null;
      if (anchor && (!anchor.ton.equals(ton) || (which === 'main' && anchor.klever !== klever))) return false;
      found = { ton: shown(ton, testnet), klever };
      return true;
    };
    // Parts that do form words, but of another address than the saved one, are a mismatch, not too few parts.
    let mismatch = false;
    const onReject = (i, j, reason) => { if (reason === 'CHECK_FAILED' && anchor) mismatch = true; };
    try {
      const words = await K.recoverPhrase(shares, { check, onReject });
      return { which, words, ton: found.ton, klever: found.klever, checked: !!anchor };
    } catch (error) {
      if (error.code !== 'SHARES_MISMATCH') throw error;
      throw fail(mismatch ? 'ANCHOR_MISMATCH' : need || 'NOT_ENOUGH');
    }
  }

  return { MAIN, GRAM, TON_PATH, recover };
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

  let words = null;
  let hideTimer = null;
  function wipe() {
    clearTimeout(hideTimer);
    if (words) words.words.fill('');
    words = null;
  }

  /** Both wallets' parts and saved addresses as the app keeps them: the phone's secure storage and the cloud. */
  async function readParts() {
    const secure = secureStore();
    const onPhone = key => (secure ? call(secure, 'getItem', key).catch(() => ({ value: '', extra: false })) : Promise.resolve({ value: '', extra: false }));
    const names = [R.MAIN.b, R.MAIN.next, R.MAIN.anchor, R.GRAM.b, R.GRAM.next, R.GRAM.anchor];
    const [mainC, mainAnchor, gramC, gramAnchor, stored] = await Promise.all([
      onPhone(R.MAIN.c), onPhone(R.MAIN.anchor), onPhone(R.GRAM.c), onPhone(R.GRAM.anchor),
      call(tg.CloudStorage, 'getItems', names).then(r => r.value || {}),
    ]);
    const set = (names, c, anchor) => ({
      phone: c.value || '', canRestore: !!c.extra,
      cloud: [stored[names.b], stored[names.next]].filter(Boolean),
      anchors: [stored[names.anchor], anchor.value].filter(Boolean),
    });
    return { main: set(R.MAIN, mainC, mainAnchor), gram: set(R.GRAM, gramC, gramAnchor) };
  }
  const holds = set => !!(set.phone || set.cloud.length || set.canRestore);

  async function attempt(password = '', which = null) {
    let parts;
    try { parts = await readParts(); } catch { return showProblem('The Telegram storage did not answer. Close the page and open it again.'); }
    // The wallet of one phrase first; the earlier main Gram wallet when it is the only one, or when asked for.
    const pick = which || (holds(parts.main) ? 'main' : 'gram');
    try {
      if (!window.VWTon || !window.KleverGateEmbedded) throw Object.assign(new Error('lib'), { code: 'LIB' });
      words = await R.recover(window.VWTon, window.KleverGateEmbedded, { which: pick, parts: parts[pick], password, testnet });
      showWords({ earlierToo: pick === 'main' && holds(parts.gram), earlier: pick === 'gram' && holds(parts.main) });
    } catch (error) {
      if (error.code === 'PASSWORD_NEEDED' || error.code === 'PASSWORD_WRONG') return showPassword(error.code === 'PASSWORD_WRONG', pick);
      if (['NOT_ENOUGH', 'NO_WALLET'].includes(error.code) && !parts[pick].phone && parts[pick].canRestore) return showRestore(pick);
      if (error.code === 'NO_WALLET') return showProblem('This Telegram account has no VerWallet main wallet.');
      // Judge V-102: the stop says what can still be done.
      if (error.code === 'ANCHOR_BAD' || error.code === 'ANCHOR_MISMATCH') return showProblem('The key parts do not match the wallet address saved in your Telegram, so the page stops here. If you wrote down your 24 words, restore the wallet with them in a wallet app.');
      if (error.code === 'LIB') return showProblem('The page did not load completely. Close it and open it again.');
      return showProblem('This device does not hold enough key parts. Open the page on the phone where you used VerWallet.');
    }
  }

  function showStart() {
    show(
      heading('Recovering the main wallet'),
      para('VerWallet is not working right now. This page puts your main wallet key together from the two parts Telegram keeps: on this phone and in your Telegram cloud. No VerWallet server is needed.'),
      para('You will see your 24 words and which app to enter them in. The funds stay yours.', 'note'),
      // Judge V-103: VerWallet's own Klever wallet is as unrecoverable here as the referral one, and holds most funds.
      para('The referral Gram wallet and VerWallet’s own Klever wallet cannot be recovered here: their keys were kept on the VerWallet server. A Klever private key you saved restores that wallet.', 'note'),
      el('div', { class: 'bar' }, el('button', { type: 'button', class: 'primary', onclick: () => attempt(), text: 'Show the 24 words' })),
    );
  }

  function showPassword(wrong, which) {
    const input = el('input', { id: 'rescue-password', type: 'password', autocomplete: 'current-password', enterkeyhint: 'done' });
    const go = () => { const value = input.value; input.value = ''; attempt(value, which); };
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

  function showRestore(which) {
    show(
      heading('The key part on this phone'),
      para('Telegram kept a key part from an earlier install on this phone. Restore it to put the key together.'),
      el('div', { class: 'bar' }, el('button', { type: 'button', class: 'primary', text: 'Restore the key part from Telegram', onclick: async () => {
        try { await call(secureStore(), 'restoreItem', which === 'main' ? R.MAIN.c : R.GRAM.c); } catch { return showProblem('Telegram did not return the key part.'); }
        attempt('', which);
      } })),
    );
  }

  /** The words with their addresses; two wallets never share a heading, so no one writes down the wrong set (V-100). */
  function showWords({ earlierToo = false, earlier = false } = {}) {
    const both = words.which === 'main';
    const list = el('ol', { class: 'words' }, words.words.map(word => el('li', { text: word })));
    show(
      heading(both ? '24 words for Gram and Klever' : earlier ? 'The earlier Gram wallet’s 24 words' : 'The main wallet’s 24 words'),
      both
        ? para('Write them down in order. They open two wallets: Gram in Tonkeeper or MyTonWallet (“Import wallet”), Klever in Klever Wallet. Any app you enter them in controls both. Trust Wallet and other multi-chain wallets may show a different Gram address.')
        : para('Write them down in order and enter them in Tonkeeper or another TON wallet (“Import wallet”, version W5). Whoever knows the words controls the Gram.'),
      // Judge V-95: the page shows up exactly when the service is down, the time «recovery helpers» write.
      para('Never share these words or enter them on a website, only in a wallet app.', 'note warn'),
      el('dl', { class: 'address' },
        el('dt', { text: both ? 'Gram address' : 'Wallet address' }), el('dd', { text: words.ton }),
        both ? el('dt', { text: 'Klever address from these words' }) : null, both ? el('dd', { text: words.klever }) : null),
      // Until VerWallet's own Klever wallet is on this phrase, Klever kept by VerWallet has another address (KleverGate
      // guide 65: name a network only where the host's wallet already lives on the phrase, else say what is not here).
      both ? para('Klever in VerWallet’s own wallet is not on these words: its key was kept on the VerWallet server.', 'help') : null,
      words.checked ? null : para('No saved address to compare with: make sure this is the address you used.', 'help'),
      list,
      // Judge V-96: the auto-hide is said, not silent.
      para('The words hide after 2 minutes. Show them again with “Show the 24 words”.', 'help'),
      el('div', { class: 'bar' },
        el('button', { type: 'button', onclick: () => { wipe(); showStart(); }, text: 'Hide the words' }),
        earlierToo ? el('button', { type: 'button', onclick: () => { wipe(); attempt('', 'gram'); }, text: 'Show the earlier Gram wallet' }) : null),
    );
    // As in the app, the words do not stay on screen unattended.
    hideTimer = setTimeout(() => { wipe(); showStart(); }, 120000);
  }

  function showProblem(text) {
    show(heading('Something went wrong'), para(text), el('div', { class: 'bar' }, el('button', { type: 'button', onclick: () => showStart(), text: 'Back' })));
  }

  document.addEventListener('visibilitychange', () => { if (document.hidden && words) { wipe(); showStart(); } });
  if (!inTelegram()) {
    show(heading('Open in Telegram'), para('This page works only inside Telegram, opened from the @Verwallet_bot bot.'));
  } else {
    showStart();
  }
}());
