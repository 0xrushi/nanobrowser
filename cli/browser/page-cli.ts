import type { Page as PuppeteerPage } from 'puppeteer';
import { getClickableElementsCLI } from '../dom/service-cli';
import type { BrowserContextConfig, PageState } from '../../chrome-extension/src/background/browser/views';
import { DEFAULT_BROWSER_CONTEXT_CONFIG } from '../../chrome-extension/src/background/browser/views';

export default class CliPage {
  private p: PuppeteerPage;
  private config: BrowserContextConfig;
  private state: PageState;

  constructor(p: PuppeteerPage, config: Partial<BrowserContextConfig> = {}) {
    this.p = p;
    this.config = { ...DEFAULT_BROWSER_CONTEXT_CONFIG, ...config };
    this.state = {
      elementTree: undefined as any,
      selectorMap: new Map(),
      tabId: 1,
      url: '',
      title: '',
      screenshot: null,
      pixelsAbove: 0,
      pixelsBelow: 0,
    };
  }

  get puppeteer(): PuppeteerPage {
    return this.p;
  }

  async waitForPageAndFramesLoad(): Promise<void> {
    try {
      await this.p.waitForNetworkIdle({
        idleTime: this.config.waitForNetworkIdlePageLoadTime * 1000,
        timeout: this.config.maximumWaitPageLoadTime * 1000,
      });
    } catch {}
    await new Promise(r => setTimeout(r, this.config.minimumWaitPageLoadTime * 1000));
  }

  async getScrollInfo(): Promise<[number, number]> {
    return await this.p.evaluate(() => {
      const doc = document.documentElement;
      const scrollTop = doc.scrollTop || document.body.scrollTop || 0;
      const scrollHeight = doc.scrollHeight || document.body.scrollHeight || 0;
      const clientHeight = doc.clientHeight || window.innerHeight || 0;
      const above = scrollTop;
      const below = Math.max(0, scrollHeight - (scrollTop + clientHeight));
      return [above, below] as [number, number];
    });
  }

  async takeScreenshot(fullPage = false): Promise<string | null> {
    const buf = (await this.p.screenshot({ type: 'jpeg', quality: 80, fullPage, encoding: 'base64' })) as string;
    return buf || null;
  }

  async getState(useVision = false, focusElement = -1): Promise<PageState> {
    await this.waitForPageAndFramesLoad();
    const url = this.p.url();
    const title = await this.p.title();
    const { elementTree, selectorMap } = await getClickableElementsCLI(
      this.p,
      url,
      this.config.highlightElements,
      focusElement,
      this.config.viewportExpansion,
      false,
    );
    const [pixelsAbove, pixelsBelow] = await this.getScrollInfo();
    const screenshot = useVision ? await this.takeScreenshot(false) : null;
    this.state = { elementTree, selectorMap, tabId: 1, url, title, screenshot, pixelsAbove, pixelsBelow };
    return this.state;
  }

  async clickElementNode(_useVision: boolean, elementNode: any): Promise<void> {
    // Prefer XPath if provided, else try CSS
    if (elementNode?.xpath) {
      const handles = await this.p.$x(elementNode.xpath);
      if (handles[0]) {
        await handles[0].evaluate((el: any) => el.scrollIntoView({ block: 'center', inline: 'center' }));
        await handles[0].click({ delay: 10 });
        return;
      }
    }
    if (elementNode && typeof elementNode.convertSimpleXPathToCssSelector === 'function' && elementNode.xpath) {
      const sel = elementNode.convertSimpleXPathToCssSelector(elementNode.xpath);
      const h = await this.p.$(sel);
      if (h) {
        await h.evaluate((el: any) => el.scrollIntoView({ block: 'center', inline: 'center' }));
        await h.click({ delay: 10 });
        return;
      }
    }
    throw new Error('Element not found to click');
  }

  async inputTextElementNode(_useVision: boolean, elementNode: any, text: string): Promise<void> {
    if (elementNode?.xpath) {
      const handles = await this.p.$x(elementNode.xpath);
      if (handles[0]) {
        await handles[0].evaluate((el: any) => el.scrollIntoView({ block: 'center', inline: 'center' }));
        await handles[0].click({ clickCount: 1 });
        await this.p.keyboard.type(text, { delay: 20 });
        return;
      }
    }
    throw new Error('Element not found to input text');
  }

  isFileUploader(elementNode: any): boolean {
    const tag = (elementNode?.tagName || '').toLowerCase();
    const type = (elementNode?.attributes?.type || '').toLowerCase();
    return tag === 'input' && type === 'file';
  }

  async scrollToText(text: string): Promise<boolean> {
    const found = await this.p.evaluate(t => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const target = t.toLowerCase();
      let n: any;
      while ((n = walker.nextNode())) {
        const s = (n.textContent || '').trim().toLowerCase();
        if (s && s.includes(target)) {
          (n.parentElement || n).scrollIntoView({ block: 'center', inline: 'center' });
          return true;
        }
      }
      return false;
    }, text);
    return !!found;
  }

  async goBack(): Promise<void> {
    await this.p.goBack({ waitUntil: 'load' });
  }
  async goForward(): Promise<void> {
    await this.p.goForward({ waitUntil: 'networkidle2', timeout: 30000 });
  }
  async navigateTo(url: string): Promise<void> {
    await this.p.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    // Wait a bit for dynamic content to settle
    await new Promise(r => setTimeout(r, 1000));
  }
  async refreshPage(): Promise<void> {
    await this.p.reload({ waitUntil: 'networkidle2', timeout: 30000 });
  }

  async scrollDown(amount?: number): Promise<void> {
    if (amount) await this.p.evaluate(amt => window.scrollBy(0, amt as number), amount);
    else await this.p.evaluate(() => window.scrollBy(0, window.innerHeight));
  }
  async scrollUp(amount?: number): Promise<void> {
    if (amount) await this.p.evaluate(amt => window.scrollBy(0, -(amt as number)), amount);
    else await this.p.evaluate(() => window.scrollBy(0, -window.innerHeight));
  }

  async sendKeys(keys: string): Promise<void> {
    // Simplified: only handle Enter and Backspace, or literal typing
    const lower = keys.toLowerCase();
    if (lower === 'enter') await this.p.keyboard.press('Enter');
    else if (lower === 'backspace') await this.p.keyboard.press('Backspace');
    else await this.p.keyboard.type(keys);
  }

  async getDropdownOptions(index: number): Promise<{ index: number; text: string }[]> {
    const elementNode = this.state.selectorMap.get(index) as any;
    if (!elementNode?.xpath) throw new Error('Dropdown element not found');
    const handles = await this.p.$x(elementNode.xpath);
    const handle = handles[0];
    if (!handle) throw new Error('Dropdown element handle not found');
    const options = await handle.$$eval('option', els =>
      els.map((o, i) => ({ index: i, text: (o as HTMLOptionElement).text })),
    );
    if (!options.length) throw new Error('No options found in dropdown');
    return options;
  }

  async selectDropdownOption(index: number, text: string): Promise<void> {
    const elementNode = this.state.selectorMap.get(index) as any;
    if (!elementNode?.xpath) throw new Error('Dropdown element not found');
    const handles = await this.p.$x(elementNode.xpath);
    const handle = handles[0];
    if (!handle) throw new Error('Dropdown element handle not found');
    // Try use select if it's a <select>
    const tagName = await handle.evaluate(el => el.tagName.toLowerCase());
    if (tagName === 'select') {
      await handle.select(text);
    } else {
      // Try click to open and select by visible text
      await handle.click();
      await this.p.waitForSelector(`text/${text}`, { timeout: 2000 }).catch(() => {});
      // Best-effort: press Enter to accept
      await this.p.keyboard.press('Enter');
    }
  }
}
