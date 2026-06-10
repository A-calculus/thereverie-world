# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> landing page renders and links to builder/docs
- Location: tests/smoke.spec.ts:34:5

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://lvh.me:3000/
Call log:
  - navigating to "http://lvh.me:3000/", waiting until "load"

```

# Test source

```ts
  1  | import { expect, test, type BrowserContext } from '@playwright/test';
  2  | import { parseBaseUrl } from '../lib/shared/base-url';
  3  | 
  4  | const session = Buffer.from(JSON.stringify({
  5  |   walletAddress: '0x1111111111111111111111111111111111111111',
  6  |   userId: 'playwright-user',
  7  |   iat: Date.now(),
  8  | })).toString('base64');
  9  | 
  10 | async function seedSession(context: BrowserContext, baseURL?: string, extraHosts: string[] = []) {
  11 |   const domain = (baseURL ? new URL(baseURL) : parseBaseUrl()).hostname;
  12 |   const cookieDomain = domain === 'localhost' ? 'localhost' : `.${domain}`;
  13 |   const sectionHosts = domain === 'localhost'
  14 |     ? [
  15 |         'agents.localhost',
  16 |         'apps.localhost',
  17 |         'docs.localhost',
  18 |         'marketplace.localhost',
  19 |         'tools.localhost',
  20 |         'mcp.localhost',
  21 |         ...extraHosts,
  22 |       ]
  23 |     : [];
  24 |   await context.addCookies([cookieDomain, ...sectionHosts].map((host) => ({
  25 |     name: 'reverie-session',
  26 |     value: session,
  27 |     domain: host,
  28 |     path: '/',
  29 |     httpOnly: true,
  30 |     sameSite: 'Lax' as const,
  31 |   })));
  32 | }
  33 | 
  34 | test('landing page renders and links to builder/docs', async ({ page }) => {
> 35 |   await page.goto('/');
     |              ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://lvh.me:3000/
  36 |   await expect(page.getByRole('heading', { name: /Build worlds/i })).toBeVisible();
  37 |   await expect(page.getByRole('link', { name: /Launch Builder/i })).toHaveAttribute('href', /.*\/login\?redirect=%2Fdashboard/);
  38 |   await expect(page.getByRole('link', { name: /Read the Docs/i })).toHaveAttribute('href', /https?:\/\/docs\./);
  39 | });
  40 | 
  41 | test('protected route redirects without a session', async ({ page }) => {
  42 |   await page.goto('/dashboard');
  43 |   await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard/);
  44 | });
  45 | 
  46 | test('docs subdomain keeps explicit docs path without double prefixing', async ({ page, baseURL }) => {
  47 |   const base = baseURL ? new URL(baseURL) : parseBaseUrl();
  48 |   const port = base.port ? `:${base.port}` : '';
  49 |   const docsOrigin = `${base.protocol}//docs.${base.hostname}${port}`;
  50 |   await page.goto(`${docsOrigin}/docs/api-reference`);
  51 |   await expect(page).toHaveURL(`${docsOrigin}/api-reference`);
  52 |   await expect(page.getByRole('heading', { name: /API Reference/i }).first()).toBeVisible();
  53 | });
  54 | 
  55 | test('seeded session can access main protected pages', async ({ page, context, baseURL }) => {
  56 |   await seedSession(context, baseURL);
  57 | 
  58 |   for (const route of ['/dashboard', '/agents', '/apps', '/templates', '/docs']) {
  59 |     await page.goto(route);
  60 |     await expect(page.locator('h1').first()).toBeVisible();
  61 |   }
  62 | });
  63 | 
  64 | test('agent wizard can step through fallback save', async ({ page, context, baseURL }) => {
  65 |   await seedSession(context, baseURL);
  66 |   await page.goto('/agents/create');
  67 |   await page.getByRole('button', { name: /Configure Logic/i }).click();
  68 |   await page.getByPlaceholder(/Faction Morale Calculator/i).fill('Playwright Agent');
  69 |   await page.getByRole('button', { name: /Test Agent/i }).click();
  70 |   await page.getByRole('button', { name: /Review & Save/i }).click();
  71 |   await page.getByRole('button', { name: /Save Agent to Library/i }).click();
  72 |   await expect(page).toHaveURL(/\/\/agents\..*\/$/);
  73 | });
  74 | 
  75 | test('world wizard completes fallback deploy without crashing', async ({ page, context, baseURL }) => {
  76 |   const worldName = `Playwright World ${Date.now()}`;
  77 |   const worldSlug = worldName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  78 |   const domain = (baseURL ? new URL(baseURL) : parseBaseUrl()).hostname;
  79 |   await seedSession(context, baseURL, [`${worldSlug}.app.${domain}`]);
  80 |   await page.goto('/apps/create');
  81 |   await page.getByRole('textbox', { name: /World Name/i }).fill(worldName);
  82 |   await page.getByRole('button', { name: /Configure World/i }).click();
  83 |   await page.getByRole('button', { name: /Review & Create/i }).click();
  84 |   await page.getByRole('button', { name: /Confirm & Create/i }).click();
  85 |   await expect(page).toHaveURL(new RegExp(`//${worldSlug}\\.app\\..*/[0-9a-f-]+$`), { timeout: 30000 });
  86 | });
  87 | 
  88 | test('world detail surfaces render for demo world', async ({ page, context, baseURL }) => {
  89 |   const domain = (baseURL ? new URL(baseURL) : parseBaseUrl()).hostname;
  90 |   await seedSession(context, baseURL, [`glitchwoods.app.${domain}`]);
  91 |   await page.goto('/apps/glitchwoods');
  92 |   await expect(page).toHaveURL(/\/\/glitchwoods\.app\..*\/glitchwoods$/);
  93 |   await expect(page.locator('h1').first()).toBeVisible();
  94 | });
  95 | 
```