import { expect, test, type BrowserContext } from '@playwright/test';
import { parseBaseUrl } from '../lib/shared/base-url';

const session = Buffer.from(JSON.stringify({
  walletAddress: '0x1111111111111111111111111111111111111111',
  userId: 'playwright-user',
  iat: Date.now(),
})).toString('base64');

async function seedSession(context: BrowserContext, baseURL?: string, extraHosts: string[] = []) {
  const domain = (baseURL ? new URL(baseURL) : parseBaseUrl()).hostname;
  const cookieDomain = domain === 'localhost' ? 'localhost' : `.${domain}`;
  const sectionHosts = domain === 'localhost'
    ? [
        'agents.localhost',
        'apps.localhost',
        'docs.localhost',
        'marketplace.localhost',
        'tools.localhost',
        'mcp.localhost',
        ...extraHosts,
      ]
    : [];
  await context.addCookies([cookieDomain, ...sectionHosts].map((host) => ({
    name: 'reverie-session',
    value: session,
    domain: host,
    path: '/',
    httpOnly: true,
    sameSite: 'Lax' as const,
  })));
}

test('landing page renders and links to builder/docs', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Build worlds/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Launch Builder/i })).toHaveAttribute('href', /.*\/login\?redirect=%2Fdashboard/);
  await expect(page.getByRole('link', { name: /Read the Docs/i })).toHaveAttribute('href', /https?:\/\/docs\./);
});

test('protected route redirects without a session', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard/);
});

test('docs subdomain keeps explicit docs path without double prefixing', async ({ page, baseURL }) => {
  const base = baseURL ? new URL(baseURL) : parseBaseUrl();
  const port = base.port ? `:${base.port}` : '';
  const docsOrigin = `${base.protocol}//docs.${base.hostname}${port}`;
  await page.goto(`${docsOrigin}/docs/api-reference`);
  await expect(page).toHaveURL(`${docsOrigin}/api-reference`);
  await expect(page.getByRole('heading', { name: /API Reference/i }).first()).toBeVisible();
});

test('seeded session can access main protected pages', async ({ page, context, baseURL }) => {
  await seedSession(context, baseURL);

  for (const route of ['/dashboard', '/agents', '/apps', '/templates', '/docs']) {
    await page.goto(route);
    await expect(page.locator('h1').first()).toBeVisible();
  }
});

test('agent wizard can step through fallback save', async ({ page, context, baseURL }) => {
  await seedSession(context, baseURL);
  await page.goto('/agents/create');
  await page.getByRole('button', { name: /Configure Logic/i }).click();
  await page.getByPlaceholder(/Faction Morale Calculator/i).fill('Playwright Agent');
  await page.getByRole('button', { name: /Test Agent/i }).click();
  await page.getByRole('button', { name: /Review & Save/i }).click();
  await page.getByRole('button', { name: /Save Agent to Library/i }).click();
  await expect(page).toHaveURL(/\/\/agents\..*\/$/);
});

test('world wizard completes fallback deploy without crashing', async ({ page, context, baseURL }) => {
  const worldName = `Playwright World ${Date.now()}`;
  const worldSlug = worldName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const domain = (baseURL ? new URL(baseURL) : parseBaseUrl()).hostname;
  await seedSession(context, baseURL, [`${worldSlug}.app.${domain}`]);
  await page.goto('/apps/create');
  await page.getByRole('textbox', { name: /World Name/i }).fill(worldName);
  await page.getByRole('button', { name: /Configure World/i }).click();
  await page.getByRole('button', { name: /Review & Create/i }).click();
  await page.getByRole('button', { name: /Confirm & Create/i }).click();
  await expect(page).toHaveURL(new RegExp(`//${worldSlug}\\.app\\..*/[0-9a-f-]+$`), { timeout: 30000 });
});

test('world detail surfaces render for demo world', async ({ page, context, baseURL }) => {
  const domain = (baseURL ? new URL(baseURL) : parseBaseUrl()).hostname;
  await seedSession(context, baseURL, [`glitchwoods.app.${domain}`]);
  await page.goto('/apps/glitchwoods');
  await expect(page).toHaveURL(/\/\/glitchwoods\.app\..*\/glitchwoods$/);
  await expect(page.locator('h1').first()).toBeVisible();
});
