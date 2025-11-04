import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page as PuppeteerPage } from 'puppeteer';
import type { BuildDomTreeResult, RawDomTreeNode } from '../../chrome-extension/src/background/dom/raw_types';
import {
  DOMElementNode,
  DOMTextNode,
  type DOMBaseNode,
  type DOMState,
} from '../../chrome-extension/src/background/dom/views';
import { _parse_node } from '../../chrome-extension/src/background/dom/service';

async function ensureBuildDomTreeInjected(page: PuppeteerPage): Promise<void> {
  const has = await page.evaluate(() => typeof (window as any).buildDomTree === 'function');
  if (!has) {
    const scriptPath = path.resolve(process.cwd(), 'chrome-extension/public/buildDomTree.js');
    const code = await fs.readFile(scriptPath, 'utf8');
    // Use evaluateOnNewDocument to bypass CSP for sites like YouTube
    await page.evaluateOnNewDocument(code);
    // Also inject immediately for current page
    try {
      await page.evaluate(code);
    } catch (err) {
      // If CSP blocks immediate injection, the evaluateOnNewDocument will handle it on next navigation
      console.warn('[DOM] Could not inject buildDomTree immediately (CSP), will inject on next navigation');
    }
  }
}

function constructDomTree(evalPage: BuildDomTreeResult): [DOMElementNode, Map<number, DOMElementNode>] {
  const jsNodeMap = evalPage.map as Record<string, RawDomTreeNode>;
  const jsRootId = evalPage.rootId as string;

  const selectorMap = new Map<number, DOMElementNode>();
  const nodeMap: Record<string, DOMBaseNode> = {};

  for (const [id, nodeData] of Object.entries(jsNodeMap)) {
    const [node] = _parse_node(nodeData);
    if (node === null) continue;
    nodeMap[id] = node;
    if (node instanceof DOMElementNode && node.highlightIndex !== undefined && node.highlightIndex !== null) {
      selectorMap.set(node.highlightIndex, node);
    }
  }

  for (const [id, node] of Object.entries(nodeMap)) {
    if (node instanceof DOMElementNode) {
      const data = jsNodeMap[id] as any;
      const childrenIds: string[] = 'children' in data ? data.children : [];
      for (const childId of childrenIds) {
        if (!(childId in nodeMap)) continue;
        const childNode = nodeMap[childId];
        (childNode as DOMBaseNode).parent = node;
        node.children.push(childNode);
      }
    }
  }

  const root = nodeMap[jsRootId];
  if (!root || !(root instanceof DOMElementNode)) {
    throw new Error('Failed to parse DOM tree');
  }
  return [root, selectorMap];
}

export async function getClickableElementsCLI(
  page: PuppeteerPage,
  url: string,
  highlightElements = true,
  focusElement = -1,
  viewportExpansion = 0,
  debugMode = false,
): Promise<DOMState> {
  await ensureBuildDomTreeInjected(page);
  const evalPage = await page.evaluate(
    args => {
      // @ts-ignore - buildDomTree injected
      return (window as any).buildDomTree(args);
    },
    {
      doHighlightElements: highlightElements,
      focusHighlightIndex: focusElement,
      viewportExpansion,
      debugMode,
    },
  );
  const [elementTree, selectorMap] = constructDomTree(evalPage as BuildDomTreeResult);
  return { elementTree, selectorMap };
}
