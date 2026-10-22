# VerWallet rescue page

A static page that gives a VerWallet user the 24 words of their **main wallet** when the VerWallet server is gone: the main Gram wallet, or one phrase for Gram and Klever (newer wallets).

The main wallet's key is split two of three: one part on the person's phone (Telegram secure storage), one in their Telegram cloud (optionally under a recovery password), one on the VerWallet server. Any two give the key. This page uses the two parts Telegram keeps, rebuilds the 24 words on the device, checks them against the addresses saved in the person's Telegram and shows them with those addresses. The person then imports the words into Tonkeeper or MyTonWallet for Gram (W5) and, for one phrase of both chains, into Klever Wallet for Klever. The page cannot help with the referral Gram wallet or VerWallet's own Klever wallet: their keys were kept whole on the server. A Klever private key the person saved restores that wallet.

## Why it is safe to publish

- Telegram keeps those storages per bot. The page can read them only when **@Verwallet_bot** opens it as its Mini App. Opened in a browser or from any other bot, it sees nothing.
- It gives no new way to the keys. Whoever controls the bot can already open any page for its users; the VerWallet server serves the app the same way.
- It makes no network requests: the Content Security Policy allows only its own files and telegram.org's `telegram-web-app.js`, with `connect-src 'none'`. The words stay on the screen and are wiped when the page is hidden or after two minutes.
- The code is open here. `SHA256SUMS` lists the published files; compare them with the VerWallet repository before pointing the bot here.

## Files

- `index.html`, `rescue.css`, `rescue.js`: the page.
- `ton.js`: the same bundle VerWallet's app signs with (`web/vendor/ton.js`: `@ton/core`, `@ton/crypto`, `@ton/ton`, Privy's audited `shamir-secret-sharing`).
- `klevergate-embedded.js`: the KleverGate embedded module the app pins (`web/vendor/klevergate-embedded.js`): key parts of both formats, share envelopes, the Klever and one-phrase keys. Its licences: `klevergate-embedded.THIRD_PARTY_LICENSES.txt`.
- `SHA256SUMS`: hashes of the five code files above.

## In an emergency (owner)

See `docs/rescue.md` in the VerWallet repository. In short: verify the hashes, then in @BotFather point the bot's Mini App URL, menu button and the `wallet` app to this page.
