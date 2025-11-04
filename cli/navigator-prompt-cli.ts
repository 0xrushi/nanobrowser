import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { BasePrompt } from '../chrome-extension/src/background/agent/prompts/base';

export class CLINavigatorPrompt extends BasePrompt {
  private system: SystemMessage;
  constructor(systemText: string) {
    super();
    this.system = new SystemMessage(systemText);
  }
  getSystemMessage(): SystemMessage {
    return this.system;
  }
  async getUserMessage(context: any): Promise<HumanMessage> {
    const page = await context.browserContext.getCurrentPage();
    const url = page.url ? page.url() : '';
    const title = page.title ? await page.title() : '';
    const text = `Current tab: {url: ${url}, title: ${title}}
Only use available tools. Avoid click/input/DOM-index actions.
Plan and act with small steps.`;
    return new HumanMessage(text);
  }
}
