# VerWallet rescue page

A static page that gives a VerWallet user the 24 words of their **main Gram wallet** when the VerWallet server is gone.

The main wallet's key is split two of three: one part on the person's phone (Telegram secure storage), one in their Telegram cloud (optionally under a recovery password), one on the VerWallet server. Any two give the key. This page uses the two parts Telegram keeps, rebuilds the 24 words on the device, checks them and shows them with the wallet address. The person then imports the words into Tonkeeper or another TON wallet (W5). The page cannot help with the referral wallet: that key was kept whole on the server.

## Why it is safe to publish

- Telegram keeps those storages per bot. The page can read them only when **@Verwallet_bot** opens it as its Mini App. Opened in a browser or from any other bot, it sees nothing.
- It gives no new way to the keys. Whoever controls the bot can already open any page for its users; the VerWallet server serves the app the same way.
- It makes no network requests: the Content Security Policy allows only its own files and telegram.org's `telegram-web-app.js`, with `connect-src 'none'`. The words stay on the screen and are wiped when the page is hidden or after two minutes.
- The code is open here. `SHA256SUMS` lists the published files; compare them with the VerWallet repository before pointing the bot here.

## Files

- `index.html`, `rescue.css`, `rescue.js`: the page.
- `ton.js`: the same bundle VerWallet's app signs with (`web/vendor/ton.js`: `@ton/core`, `@ton/crypto`, `@ton/ton`, Privy's audited `shamir-secret-sharing`).
- `SHA256SUMS`: hashes of the four files above.

## In an emergency (owner)

See `docs/rescue.md` in the VerWallet repository. In short: verify the hashes, then in @BotFather point the bot's Mini App URL, menu button and the `wallet` app to this page.
