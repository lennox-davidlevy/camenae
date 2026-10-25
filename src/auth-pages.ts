import type { WelcomeQuote } from "./quotes-contract.js";

// Scriptless forms: no passwords or request values are interpolated into HTML.
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (character) => `&#${character.codePointAt(0)};`);

// Quote text is data from our own files, but it is escaped like any other and the link must be https.
const quoteBlock = (quote: WelcomeQuote | undefined) => quote && quote.href.startsWith("https://")
  ? `<figure class="art-quote"><blockquote><p>${escapeHtml(quote.text)}</p></blockquote><figcaption><a href="${escapeHtml(quote.href)}" target="_blank" rel="noopener noreferrer">— ${escapeHtml(quote.attribution)} ↗</a>${quote.source ? `<small>${escapeHtml(quote.source)}</small>` : ""}</figcaption></figure>`
  : "<p>An assistant with its tools, skills and files in plain view.</p>";

const shell = (title: string, tag: string, description: string, body: string, account = false, quote?: WelcomeQuote) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Camenae · ${account ? "Account" : "Sign in"}</title><link rel="stylesheet" href="/fonts.css"><link rel="stylesheet" href="/auth.css"></head>
<body><a class="skip-link" href="#main">Skip to content</a>
<header class="auth-masthead"><a class="wordmark" href="${account ? "/chat" : "/auth/login"}">Camenae</a><span class="motto">◆ <span>Fons · Consilium</span></span>
<span class="local-label">Your private workspace</span>${account ? '<a class="header-link" href="/chat">Back to Chat ↗</a>' : ""}</header>
<main id="main" class="auth-layout"><section class="auth-art" aria-label="Aegeria illustration">
<div class="art-caption"><span>Aegeria · Nº I</span><span>Ex fonte, consilium</span></div>
<div class="artwork" aria-hidden="true"><div class="coin-arch"><img src="/assets/camenae-coin.png" alt=""><span>Fons · I</span></div>
<div class="red-plinth"><img src="/assets/camenae-coin.png" alt=""><span>Est. MMXXVI</span></div><div class="column"><div></div></div></div>
<div class="art-footer">${quoteBlock(quote)}<span>Fig. I</span></div></section>
<section class="auth-panel" aria-labelledby="auth-title"><div class="auth-content"><div class="eyebrow"><span>${tag}</span><small>${account ? "Local owner" : "Welcome back"}</small></div>
<h1 id="auth-title">${title}</h1><p class="intro">${description}</p>${body}</div></section></main>
<footer class="auth-footer"><span>© MMXXVI Camenae</span><span>Local account · Password sign-in</span></footer></body></html>`;

const notice = (message: string) => message ? `<p class="auth-notice" role="alert">${message}</p>` : "";

const owner = '<input type="hidden" name="username" value="owner" autocomplete="username">';

export const loginPage = (message = "", quote?: WelcomeQuote) => shell("Return to<br>the Spring.", "Sign In",
  "Sign in to pick up your threads where you left them.", `${notice(message)}
<form method="post" action="/auth/login">${owner}
<label for="password">Password</label><input id="password" type="password" name="password" autocomplete="current-password" required maxlength="256" placeholder="Your password" autofocus>
<button class="primary" type="submit"><span>Sign in</span><span aria-hidden="true">↵</span></button></form>
<div class="auth-help"><details><summary>First time signing in?</summary><p>This is your private, single-user workspace. Use the initial password in <code>.cache/local-auth/login.txt</code>, then open <strong>Account</strong> to choose your own password. For a custom installation, use its own login file.</p></details>
<details><summary>Forgot your password?</summary><p>Check your password manager. If you have not changed the initial password, it is in your installation’s login file. There is no email reset or Google sign-in. Do not reinitialize your installation or replace its credentials file.</p></details></div>`, false, quote);

export const passwordPage = (csrf: string, message = "", saved = false) => shell("Make it<br>your own.", "Account",
  "Choose a password for your private workspace. No login file needed for your next visit.", `${saved ? '<p class="auth-success" role="status">Password changed. Your new password is ready to use. <a href="/chat">Continue to Chat ↗</a></p>' : notice(message)}
<form method="post" action="/auth/password">${owner}<input type="hidden" name="csrf" value="${csrf}">
<label for="current-password">Current password</label><input id="current-password" type="password" name="currentPassword" autocomplete="current-password" required maxlength="256" aria-describedby="current-help">
<p id="current-help" class="field-help">Still using the generated password? Enter it here once.</p>
<label for="new-password">New password</label><input id="new-password" type="password" name="password" autocomplete="new-password" required minlength="15" maxlength="256" aria-describedby="password-help">
<p id="password-help" class="field-help">Use 15–256 characters. A long, unique passphrase works well. Save it in your password manager.</p>
<label for="confirm-password">Confirm new password</label><input id="confirm-password" type="password" name="confirmation" autocomplete="new-password" required minlength="15" maxlength="256">
<button class="primary" type="submit"><span>Save password</span><span aria-hidden="true">↵</span></button></form>
<div class="auth-help"><p>Changing your password replaces your sign-in session. Other browsers will need to sign in again. Your chats, files and provider keys stay unchanged.</p>
<form method="post" action="/auth/logout"><input type="hidden" name="csrf" value="${csrf}"><button class="text-button" type="submit">Sign out</button></form></div>`, true);
