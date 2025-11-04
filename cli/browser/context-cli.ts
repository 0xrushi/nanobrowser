import puppeteer, { Browser, Page as PuppeteerPage } from 'puppeteer';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import os from 'node:os';
import path from 'node:path';
import CliPage from './page-cli';
import type {
  BrowserContextConfig,
  BrowserState,
  DEFAULT_BROWSER_CONTEXT_CONFIG,
  TabInfo,
} from '../../chrome-extension/src/background/browser/views';
import { DEFAULT_BROWSER_CONTEXT_CONFIG as DEFAULTS } from '../../chrome-extension/src/background/browser/views';

export default class CliBrowserContext {
  private browser: Browser | null = null;
  private pages: PuppeteerPage[] = [];
  private currentIdx = 0;
  private config: BrowserContextConfig;
  private headful: boolean;
  private executablePath?: string;
  private userDataDir?: string;
  private profileDirectory?: string;
  private noSandbox: boolean;
  private useStealth: boolean;

  constructor(
    opts: {
      headful?: boolean;
      executablePath?: string;
      userDataDir?: string;
      noSandbox?: boolean;
      stealth?: boolean;
    } = {},
  ) {
    this.headful = opts.headful ?? true;
    this.executablePath = opts.executablePath || process.env.CHROME_PATH || undefined;

    // Allow explicit undefined or empty string to skip userDataDir (use Chrome's default profile)
    let udd: string | undefined;
    if (opts.userDataDir === undefined && !process.env.NANOBROWSER_PROFILE) {
      // No profile specified anywhere - use a default isolated one
      udd = path.join(os.homedir(), '.nanobrowser-profile');
    } else if (opts.userDataDir === '' || opts.userDataDir === 'none') {
      // Explicitly disabled - use Chrome's default profile
      udd = undefined;
    } else {
      // Use specified profile
      udd = opts.userDataDir || process.env.NANOBROWSER_PROFILE;
      if (udd && udd.startsWith('~')) {
        udd = path.join(os.homedir(), udd.slice(1));
      }
    }

    // If the provided path points directly to a Chrome profile folder (e.g., .../Chrome/Default or .../Chrome/Profile 3)
    // normalize to use parent as userDataDir and pass --profile-directory to target the exact profile
    if (udd && /\/Google\/Chrome\/(Default|Profile\s.+)$/i.test(udd)) {
      this.profileDirectory = path.basename(udd);
      this.userDataDir = path.dirname(udd);
    } else {
      this.userDataDir = udd;
    }
    this.noSandbox = opts.noSandbox ?? true;
    this.useStealth = opts.stealth ?? true; // Default to stealth mode
    this.config = { ...DEFAULTS };
  }

  private async ensure(): Promise<void> {
    if (!this.browser) {
      // Launch new Chrome instance
      const args = [
        '--no-first-run',
        '--no-default-browser-check',
        // Do not set --disable-blink-features=AutomationControlled to avoid warning banner
        '--start-maximized',
      ];
      // Only add Linux-specific sandbox flags on Linux
      if (this.noSandbox && process.platform === 'linux') args.push('--no-sandbox', '--disable-setuid-sandbox');
      // If a specific Chrome profile directory is set (Default, Profile 1, ...), target it explicitly
      if (this.profileDirectory) args.push(`--profile-directory=${this.profileDirectory}`);

      const launchOpts = {
        headless: this.headful ? false : true,
        defaultViewport: null,
        executablePath: this.executablePath,
        userDataDir: this.userDataDir,
        ignoreDefaultArgs: ['--enable-automation'],
        args,
      };

      console.log(`[Browser] Launching Chrome...`);
      if (this.executablePath) console.log(`[Browser] Executable: ${this.executablePath}`);
      if (this.userDataDir) console.log(`[Browser] Profile base dir: ${this.userDataDir}`);
      if (this.profileDirectory) console.log(`[Browser] Profile directory: ${this.profileDirectory}`);
      console.log(`[Browser] Stealth: ${this.useStealth ? 'enabled' : 'disabled'}`);

      try {
        if (this.useStealth) {
          // Use puppeteer-extra with stealth plugin
          puppeteerExtra.use(StealthPlugin());
          this.browser = (await puppeteerExtra.launch(launchOpts)) as Browser;
        } else {
          // Use regular puppeteer
          this.browser = await puppeteer.launch(launchOpts);
        }
        console.log(`[Browser] Chrome launched successfully`);
      } catch (err: any) {
        const errorMsg = err?.message || String(err);
        console.error(`[Browser] Failed to launch Chrome: ${errorMsg}`);

        // Provide helpful error messages
        if (errorMsg.includes('Could not find') || errorMsg.includes('Failed to launch')) {
          if (this.userDataDir && this.userDataDir.includes('Google/Chrome')) {
            console.error(`\n⚠️  Chrome profile directory may be locked!`);
            console.error(`   Make sure ALL Chrome instances are completely closed.`);
            console.error(`   Try running: killall "Google Chrome" && killall "Google Chrome Helper"`);
          }
          if (this.executablePath) {
            console.error(`\n⚠️  Chrome executable path may be incorrect: ${this.executablePath}`);
          }
        }
        throw err;
      }

      this.pages = await this.browser.pages();
      if (this.pages.length === 0) {
        const newPage = await this.browser.newPage();
        this.pages = [newPage];

        // Apply stealth enhancements to new pages
        if (this.useStealth) {
          await this.applyStealthEnhancements(newPage);
        }
      } else if (this.useStealth) {
        // Apply stealth enhancements to existing pages
        for (const page of this.pages) {
          await this.applyStealthEnhancements(page);
        }
      }

      this.currentIdx = 0;
    }
  }

  private async applyStealthEnhancements(page: PuppeteerPage): Promise<void> {
    // Set realistic user agent for macOS
    const macUA =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
    await page.setUserAgent(macUA);

    // Set extra HTTP headers
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

    // Make platform hints match macOS
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
      Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });
    });
  }

  getConfig(): BrowserContextConfig {
    return this.config;
  }

  async cleanup(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {}
    }
    this.browser = null;
    this.pages = [];
  }

  async getCurrentPage(): Promise<CliPage> {
    await this.ensure();
    const p = this.pages[this.currentIdx];
    return new CliPage(p, this.config);
  }

  async navigateTo(url: string): Promise<void> {
    const page = await this.getCurrentPage();
    await page.navigateTo(url);
  }

  async openTab(url: string): Promise<CliPage> {
    await this.ensure();
    const p = await this.browser!.newPage();

    // Apply stealth enhancements to new tab
    if (this.useStealth) {
      await this.applyStealthEnhancements(p);
    }

    await p.goto(url, { waitUntil: 'load' });
    this.pages.push(p);
    this.currentIdx = this.pages.length - 1;
    return new CliPage(p, this.config);
  }

  async switchTab(tabId: number): Promise<CliPage> {
    await this.ensure();
    // tabId is 1-based index in this CLI
    const idx = tabId - 1;
    if (idx < 0 || idx >= this.pages.length) throw new Error('Invalid tab id');
    this.currentIdx = idx;
    return new CliPage(this.pages[this.currentIdx], this.config);
  }

  async getAllTabIds(): Promise<Set<number>> {
    await this.ensure();
    return new Set(this.pages.map((_p, i) => i + 1));
  }

  async closeTab(tabId: number): Promise<void> {
    await this.ensure();
    const idx = tabId - 1;
    const p = this.pages[idx];
    if (p) await p.close();
    this.pages.splice(idx, 1);
    if (this.currentIdx >= this.pages.length) this.currentIdx = Math.max(0, this.pages.length - 1);
  }

  async getTabInfos(): Promise<TabInfo[]> {
    await this.ensure();
    const infos: TabInfo[] = [];
    for (let i = 0; i < this.pages.length; i++) {
      const p = this.pages[i];
      infos.push({ id: i + 1, url: p.url(), title: await p.title() });
    }
    return infos;
  }

  async getState(): Promise<BrowserState> {
    const page = await this.getCurrentPage();
    const state = await page.getState(false);
    const tabs = await this.getTabInfos();
    return { ...state, tabs, browser_errors: [] } as BrowserState;
  }

  async removeHighlight(): Promise<void> {
    /* no-op in CLI */
  }
}
