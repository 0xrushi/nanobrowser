/*
 * Planner-driven CLI that reuses the extension PlannerAgent and NavigatorAgent with full action set.
 */
import { register as registerTsPaths } from 'tsconfig-paths';
import fsSync from 'node:fs';
import path from 'node:path';
import cryptoNode from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import fs from 'node:fs/promises';
import YAML from 'yaml';
import { ChatOpenAI } from '@langchain/openai';
import CliBrowserContext from './browser/context-cli';

// Register tsconfig paths BEFORE dynamically importing extension modules
try {
  const cfgPath = path.resolve(process.cwd(), 'cli/tsconfig.cli.json');
  const raw = fsSync.readFileSync(cfgPath, 'utf8');
  const cfg = JSON.parse(raw);
  const baseUrl = path.resolve(process.cwd(), cfg.compilerOptions.baseUrl || '.');
  registerTsPaths({ baseUrl, paths: cfg.compilerOptions.paths || {} });
} catch {}

function parseArgs(argv: string[]) {
  const opts: {
    headful: boolean;
    json: boolean;
    chrome?: string;
    profile?: string;
    noSandbox: boolean;
    stealth: boolean;
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    file?: string;
    headers?: Record<string, string>;
    structuredOutput?: boolean;
    plannerOnly?: boolean;
  } = {
    headful: true,
    json: false,
    chrome: process.env.CHROME_PATH,
    profile: process.env.NANOBROWSER_PROFILE,
    noSandbox: true,
    stealth: true, // Default to stealth mode
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE,
    headers: undefined,
    structuredOutput: undefined,
    plannerOnly: undefined,
  };
  const rest: string[] = [];
  for (const a of argv) {
    if (a === '--') continue;
    if (a === '--headful') opts.headful = true;
    else if (a === '--headless') opts.headful = false;
    else if (a === '--json') opts.json = true;
    else if (a === '--stealth') opts.stealth = true;
    else if (a === '--no-stealth') opts.stealth = false;
    else if (a.startsWith('--chrome=')) opts.chrome = a.split('=', 2)[1];
    else if (a.startsWith('--profile=')) opts.profile = a.split('=', 2)[1];
    else if (a === '--no-sandbox') opts.noSandbox = true;
    else if (a === '--sandbox') opts.noSandbox = false;
    else if (a.startsWith('--model=')) opts.model = a.split('=', 2)[1];
    else if (a.startsWith('--apiKey=')) opts.apiKey = a.split('=', 2)[1];
    else if (a.startsWith('--file=')) opts.file = a.split('=', 2)[1];
    else if (a.startsWith('--baseUrl=')) opts.baseUrl = a.split('=', 2)[1];
    else if (a.startsWith('--header=')) {
      const kv = a.substring('--header='.length);
      const idx = kv.indexOf(':');
      if (idx > 0) {
        const key = kv.slice(0, idx).trim();
        const val = kv.slice(idx + 1).trim();
        opts.headers = { ...(opts.headers || {}), [key]: val };
      }
    } else if (a === '--no-structured') {
      opts.structuredOutput = false;
    } else if (a === '--planner-only') {
      opts.plannerOnly = true;
    } else rest.push(a);
  }
  return { opts, args: rest };
}

type YamlConfig = {
  model?: string;
  stealth?: boolean;
  apiKey?: string;
  api_key?: string;
  OPENAI_API_KEY?: string;
  baseUrl?: string;
  OPENAI_BASE_URL?: string;
  headful?: boolean;
  chrome?: string;
  profile?: string;
  noSandbox?: boolean;
  headers?: Record<string, string>;
  structuredOutput?: boolean;
};

async function loadCommandsFromFile(filePath: string): Promise<{ commands: string[]; config: YamlConfig }> {
  const abs = path.resolve(process.cwd(), filePath);
  const raw = await fs.readFile(abs, 'utf8');
  const doc = YAML.parse(raw);
  const toStrings = (arr: any[]): string[] =>
    arr
      .map(it => {
        if (typeof it === 'string') return it.trim();
        if (it && typeof it === 'object' && typeof it.command === 'string') return it.command.trim();
        return '';
      })
      .filter(Boolean);
  if (Array.isArray(doc)) return { commands: toStrings(doc), config: {} };
  if (doc && typeof doc === 'object') {
    const commands = Array.isArray(doc.tasks) ? toStrings(doc.tasks) : [];
    const config: YamlConfig = {};
    if (typeof doc.model === 'string') config.model = doc.model;
    // Handle apiKey as both string and number (YAML can parse numbers)
    if (typeof doc.apiKey === 'string') config.apiKey = doc.apiKey;
    else if (typeof doc.apiKey === 'number') config.apiKey = String(doc.apiKey);
    if (typeof doc.api_key === 'string') config.apiKey = doc.api_key;
    else if (typeof doc.api_key === 'number') config.apiKey = String(doc.api_key);
    if (typeof doc.OPENAI_API_KEY === 'string') config.apiKey = doc.OPENAI_API_KEY;
    else if (typeof doc.OPENAI_API_KEY === 'number') config.apiKey = String(doc.OPENAI_API_KEY);
    if (typeof doc.baseUrl === 'string') config.baseUrl = doc.baseUrl;
    if (typeof doc.OPENAI_BASE_URL === 'string') config.baseUrl = doc.OPENAI_BASE_URL;
    if (typeof doc.headful === 'boolean') config.headful = doc.headful;
    if (typeof doc.stealth === 'boolean') config.stealth = doc.stealth;
    if (typeof doc.chrome === 'string') config.chrome = doc.chrome;
    if (typeof doc.profile === 'string') config.profile = doc.profile;
    if (typeof doc.noSandbox === 'boolean') config.noSandbox = doc.noSandbox;
    if (doc.headers && typeof doc.headers === 'object') config.headers = doc.headers as Record<string, string>;
    if (typeof doc.structuredOutput === 'boolean') config.structuredOutput = doc.structuredOutput;
    if (commands.length) return { commands, config };
  }
  throw new Error(
    'YAML must be a list of commands or an object with { tasks: [...], model?, apiKey?, baseUrl?, headful?, chrome?, profile?, noSandbox? }',
  );
}

function emit(json: boolean, type: string, payload: any = {}) {
  if (json) {
    console.log(JSON.stringify({ type, ...payload }));
  } else {
    if (payload.message) console.log(payload.message);
    if (payload.status) console.log(`status: ${payload.status}`);
    if (payload.result) console.log(`result: ${JSON.stringify(payload.result)}`);
    if (payload.error) console.error(`error: ${payload.error}`);
  }
}

// Ensure Web Crypto API for hashing in DOM history utils (avoid overriding if Node provides it)
if (typeof (globalThis as any).crypto === 'undefined') {
  (globalThis as any).crypto = (cryptoNode as any).webcrypto;
}

async function runPlannerAndNavigator(
  task: string,
  ctx: CliBrowserContext,
  modelName: string,
  apiKey?: string,
  baseUrl?: string,
  headers?: Record<string, string>,
  structuredOutput?: boolean,
  plannerOnly?: boolean,
) {
  if (!apiKey && !(headers && Object.keys(headers).length)) {
    throw new Error('No API credentials provided. Supply --apiKey or headers (e.g., --header="x-api-key: KEY").');
  }

  // LLM
  const defaultHeaders = headers
    ? Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, String(v)]))
    : ({} as Record<string, string>);
  const hasProvidedAuthHeader = Object.keys(defaultHeaders).some(k => k.toLowerCase() === 'authorization');

  // If user provided apiKey and did not explicitly set Authorization, mimic extension: set Bearer header
  if (apiKey && !hasProvidedAuthHeader) {
    defaultHeaders['Authorization'] = `Bearer ${apiKey}`;
  }

  // Normalize baseUrl to include /v1 (without duplicating it)
  let effectiveBaseUrl = baseUrl;
  if (effectiveBaseUrl) {
    const hasV1 = /\/v1\/?$/i.test(effectiveBaseUrl);
    if (!hasV1) effectiveBaseUrl = effectiveBaseUrl.replace(/\/?$/, '') + '/v1';
  }

  const chat = new ChatOpenAI({
    // We pass apiKey only if user also set Authorization to avoid double auth; otherwise rely on header we set above
    apiKey: hasProvidedAuthHeader ? undefined : apiKey,
    model: modelName,
    temperature: 0.2,
    // For compatibility with @langchain/openai, pass headers via configuration
    configuration: {
      ...(effectiveBaseUrl ? { baseURL: effectiveBaseUrl } : {}),
      ...(defaultHeaders && Object.keys(defaultHeaders).length ? { defaultHeaders } : {}),
    },
  });

  // Minimal context
  const taskId = uuidv4();
  // dynamic imports for extension modules after ts-paths registration
  const [
    { AgentContext, ActionResult },
    { default: MessageManager },
    { EventManager },
    { PlannerAgent },
    { NavigatorAgent, NavigatorActionRegistry },
    { ValidatorAgent },
    { NavigatorPrompt },
    { PlannerPrompt },
    { ValidatorPrompt },
    { ActionBuilder },
    { memoryService },
    { sessionMemoryService },
    { BaseAgent },
  ] = await Promise.all([
    import('../chrome-extension/src/background/agent/types'),
    import('../chrome-extension/src/background/agent/messages/service'),
    import('../chrome-extension/src/background/agent/event/manager'),
    import('../chrome-extension/src/background/agent/agents/planner'),
    import('../chrome-extension/src/background/agent/agents/navigator'),
    import('../chrome-extension/src/background/agent/agents/validator'),
    import('../chrome-extension/src/background/agent/prompts/navigator'),
    import('../chrome-extension/src/background/agent/prompts/planner'),
    import('../chrome-extension/src/background/agent/prompts/validator'),
    import('../chrome-extension/src/background/agent/actions/builder'),
    import('../chrome-extension/src/background/memory/service'),
    import('../chrome-extension/src/background/memory/session-service'),
    import('../chrome-extension/src/background/agent/agents/base'),
  ]);

  // Initialize memory services like the extension does
  memoryService.initialize(taskId);
  sessionMemoryService.setTaskContext(taskId);

  const messageManager = new MessageManager({
    maxInputTokens: 128000,
    estimatedCharactersPerToken: 3,
    imageTokens: 800,
    includeAttributes: [],
  });
  const eventManager = new EventManager();
  const browserContext: any = ctx;
  const agentContext = new AgentContext(taskId, browserContext, messageManager, eventManager, {
    maxSteps: 10,
    maxActionsPerStep: 4,
    validateOutput: false,
    maxFailures: 3,
    useVision: false,
    useVisionForPlanner: false,
    planningInterval: 1,
  });

  // Prompts
  const navigatorPrompt = new NavigatorPrompt(agentContext.options.maxActionsPerStep);
  const plannerPrompt = new PlannerPrompt();
  const validatorPrompt = new ValidatorPrompt(task);

  // Initialize history with the navigator system message and the human task
  messageManager.initTaskMessages(navigatorPrompt.getSystemMessage(), task);

  // 1) Planner: get a plan
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🧠 Planning phase...`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  const planner = new PlannerAgent({ chatLLM: chat as any, context: agentContext, prompt: plannerPrompt });
  let planOutput;
  try {
    planOutput = await planner.execute();
  } catch (err: any) {
    // Enhance error with response details when DEBUG is enabled
    if (process.env.DEBUG) {
      const resp = err?.response?.data || err?.cause?.response?.data || err?.cause?.data;
      if (resp) {
        throw new Error(`${err.message}\nEndpoint response: ${typeof resp === 'string' ? resp : JSON.stringify(resp)}`);
      }
    }
    throw err;
  }
  if (planOutput.error) throw new Error(planOutput.error);
  if (planOutput.result) {
    console.log(`\n[Planner] Plan created:`);
    if (planOutput.result.observation) console.log(`  • Observation: ${planOutput.result.observation}`);
    if (planOutput.result.reasoning) console.log(`  • Reasoning: ${planOutput.result.reasoning}`);
    if (planOutput.result.next_steps) console.log(`  • Next steps: ${planOutput.result.next_steps}`);
    if (planOutput.result.web_task !== undefined) console.log(`  • Is web task: ${planOutput.result.web_task}`);
    messageManager.addPlan(JSON.stringify(planOutput.result));
  }

  // If planner-only mode, skip navigator entirely
  if (plannerOnly) {
    return { plan: planOutput.result, done: false };
  }

  // 2) Navigator with full action set
  const actionBuilder = new ActionBuilder(agentContext, chat as any);
  const actions = actionBuilder.buildDefaultActions();
  const registry = new NavigatorActionRegistry(actions as any);

  // 3) Validator
  const validator = new ValidatorAgent({ chatLLM: chat as any, context: agentContext, prompt: validatorPrompt });

  // Patch NavigatorAgent to avoid DOM state dependency in doMultiAction AND log AI reasoning
  const PatchedNavigatorAgent = NavigatorAgent as any;
  if (!PatchedNavigatorAgent.__cliPatched) {
    const orig = PatchedNavigatorAgent.prototype.doMultiAction;
    PatchedNavigatorAgent.prototype.doMultiAction = async function (response: any) {
      // Log AI reasoning before executing actions
      if (response.current_state) {
        console.log(`[Navigator] Next goal: ${response.current_state.next_goal}`);
        if (response.current_state.evaluation_previous_goal) {
          console.log(`[Navigator] Previous goal evaluation: ${response.current_state.evaluation_previous_goal}`);
        }
      }

      const results: any[] = [];
      let errCount = 0;
      let actions: Record<string, unknown>[] = [];
      if (Array.isArray(response.action)) {
        actions = response.action.filter((it: unknown) => it !== null);
      } else if (typeof response.action === 'string') {
        try {
          actions = JSON.parse(response.action);
        } catch {
          throw new Error('Invalid action output format');
        }
      } else if (response.action) {
        actions = [response.action];
      }

      // Log actions
      for (const action of actions) {
        const name = Object.keys(action)[0];
        const args = (action as any)[name];
        console.log(
          `[Navigator] Action: ${name}`,
          args.intent ? `(${args.intent})` : '',
          JSON.stringify(args).substring(0, 100),
        );
      }

      for (const action of actions) {
        const name = Object.keys(action)[0];
        const args = (action as any)[name];
        try {
          if (this.context.paused || this.context.stopped) return results;
          const inst = this.actionRegistry.getAction(name);
          if (!inst) throw new Error(`Action ${name} not exists`);
          const res = await inst.call(args);
          if (res === undefined) throw new Error(`Action ${name} returned undefined`);
          results.push(res);
          if (this.context.paused || this.context.stopped) return results;
          await new Promise(r => setTimeout(r, 800));
        } catch (error) {
          errCount++;
          results.push(
            new ActionResult({ error: error instanceof Error ? error.message : String(error), includeInMemory: true }),
          );
          if (errCount > 3) throw new Error('Too many errors in actions');
        }
      }
      return results;
    };
    PatchedNavigatorAgent.__cliPatched = true;
  }

  // CLI-only: patch NavigatorAgent.invoke to fallback when structured output unavailable
  const NavAgentAny: any = NavigatorAgent as any;
  if (!NavAgentAny.__cliInvokePatched) {
    const originalInvoke = NavAgentAny.prototype.invoke;
    NavAgentAny.prototype.invoke = async function (inputMessages: any) {
      if (this.withStructuredOutput) {
        try {
          return await originalInvoke.call(this, inputMessages);
        } catch (err: any) {
          const msg = String(err?.message || err);
          const schemaFailure = msg.includes('JSON schema conversion failed') || msg.includes('structured output');
          if (schemaFailure) {
            // Fallback: disable structured output and retry via BaseAgent extraction
            this.withStructuredOutput = false;
            return await (BaseAgent as any).prototype.invoke.call(this, inputMessages);
          }
          throw err;
        }
      }
      // Use BaseAgent extraction when structured output already disabled
      return await (BaseAgent as any).prototype.invoke.call(this, inputMessages);
    };
    NavAgentAny.__cliInvokePatched = true;
  }

  // Use standard navigator prompt (relies on getState from CLI context)
  const navigator = new NavigatorAgent(registry, {
    chatLLM: chat as any,
    context: agentContext,
    prompt: navigatorPrompt,
  });
  if (structuredOutput === false) {
    // @ts-ignore
    planner.withStructuredOutput = false;
    // @ts-ignore
    navigator.withStructuredOutput = false;
  }

  // Run navigation steps with retry logic (like the extension does)
  const maxSteps = agentContext.options.maxSteps;
  const maxFailures = agentContext.options.maxFailures;
  let done = false;
  let consecutiveFailures = 0;
  let stepCount = 0;

  try {
    while (stepCount < maxSteps && !done && consecutiveFailures < maxFailures) {
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`🤖 Step ${stepCount + 1}/${maxSteps}`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

      try {
        const out = await navigator.execute();

        if (out.error) {
          consecutiveFailures++;
          console.log(`⚠️  Navigation error (failure ${consecutiveFailures}/${maxFailures}): ${out.error}`);

          if (consecutiveFailures >= maxFailures) {
            throw new Error(`Max failures (${maxFailures}) reached. Last error: ${out.error}`);
          }
          // Continue to next iteration to retry
        } else {
          // Success - reset failure counter
          consecutiveFailures = 0;

          if (out.result?.done) {
            done = true;
            console.log(`✅ Task completed!`);
            break;
          }
        }

        stepCount++;
      } catch (err: any) {
        const msg = String(err?.message || err);
        const schemaFailure =
          msg.includes('JSON schema conversion failed') || msg.toLowerCase().includes('tool calling');

        if (structuredOutput !== false && schemaFailure && consecutiveFailures === 0) {
          // One-time fallback: disable structured output and retry
          console.log(`⚠️  Schema failure detected, falling back to non-structured output mode...`);
          // @ts-ignore
          planner.withStructuredOutput = false;
          // @ts-ignore
          navigator.withStructuredOutput = false;
          consecutiveFailures = 0; // Reset since we're trying a different mode
          continue;
        }

        consecutiveFailures++;
        console.log(`⚠️  Step error (failure ${consecutiveFailures}/${maxFailures}): ${msg}`);

        if (consecutiveFailures >= maxFailures) {
          throw new Error(`Max failures (${maxFailures}) reached. Last error: ${msg}`);
        }

        stepCount++;
      }
    }

    if (stepCount >= maxSteps && !done) {
      console.log(`⚠️  Reached maximum steps (${maxSteps}) without completing the task`);
    }
  } catch (err: any) {
    throw err;
  }

  return { plan: planOutput.result, done };
}

async function waitForUserInput(prompt: string): Promise<void> {
  const readline = await import('node:readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  const { opts, args } = parseArgs(process.argv.slice(2));
  const inline = args.join(' ').trim();
  let commands: string[] = [];
  if (opts.file) {
    const { commands: cmds, config } = await loadCommandsFromFile(opts.file);
    // YAML config overrides defaults (and flags if you provided both)
    if (config.model) opts.model = config.model;
    if (config.apiKey) opts.apiKey = config.apiKey;
    if (config.baseUrl) opts.baseUrl = config.baseUrl;
    if (config.headful !== undefined) opts.headful = config.headful;
    if (config.stealth !== undefined) opts.stealth = config.stealth;
    if (config.chrome) opts.chrome = config.chrome;
    if (config.profile) opts.profile = config.profile;
    if (config.noSandbox !== undefined) opts.noSandbox = config.noSandbox;
    if (config.headers) opts.headers = { ...(opts.headers || {}), ...config.headers };
    if (config.structuredOutput !== undefined) opts.structuredOutput = config.structuredOutput;
    commands = cmds;
  } else if (inline) commands = [inline];
  else {
    // Default to prompts.yaml if it exists
    const defaultYamlPath = path.resolve(process.cwd(), 'prompts.yaml');
    try {
      await fs.access(defaultYamlPath);
      console.log(`Using default prompts.yaml`);
      const { commands: cmds, config } = await loadCommandsFromFile('prompts.yaml');
      if (config.model) opts.model = config.model;
      if (config.apiKey) opts.apiKey = config.apiKey;
      if (config.baseUrl) opts.baseUrl = config.baseUrl;
      if (config.headful !== undefined) opts.headful = config.headful;
      if (config.stealth !== undefined) opts.stealth = config.stealth;
      if (config.chrome) opts.chrome = config.chrome;
      if (config.profile) opts.profile = config.profile;
      if (config.noSandbox !== undefined) opts.noSandbox = config.noSandbox;
      if (config.headers) opts.headers = { ...(opts.headers || {}), ...config.headers };
      if (config.structuredOutput !== undefined) opts.structuredOutput = config.structuredOutput;
      commands = cmds;
    } catch {
      console.error('Usage: pnpm run agent -- "<your goal>" | --file=prompts.yaml');
      console.error('Or create a prompts.yaml file in the current directory.');
      process.exit(2);
    }
  }

  // Expand ~ in profile path if present
  let profilePath = opts.profile;
  if (profilePath && profilePath.startsWith('~')) {
    const os = await import('node:os');
    profilePath = path.join(os.homedir(), profilePath.slice(1));
  }

  const ctx = new CliBrowserContext({
    headful: opts.headful,
    executablePath: opts.chrome,
    userDataDir: profilePath,
    noSandbox: opts.noSandbox,
    stealth: opts.stealth,
  });
  try {
    // Log non-sensitive config for debugging
    if (!opts.json) {
      console.log(`\n[Config] Model: ${opts.model || 'default'}`);
      console.log(`[Config] Base URL: ${opts.baseUrl || 'default'}`);
      console.log(`[Config] Chrome: ${opts.chrome || 'default (auto-detect)'}`);
      console.log(`[Config] Profile: ${profilePath || 'default'}`);
      console.log(`[Config] Headful: ${opts.headful}`);
      console.log(`[Config] Stealth mode: ${opts.stealth ? 'enabled' : 'disabled'}`);
    }
    emit(opts.json, 'config', {
      model: opts.model,
      baseUrl: opts.baseUrl,
      apiKeyProvided: Boolean(opts.apiKey),
      headers: opts.headers ? Object.keys(opts.headers) : [],
      structured: opts.structuredOutput !== false,
      chromePath: opts.chrome || 'default',
      profilePath: profilePath || 'default',
    });
    for (const cmd of commands) {
      emit(opts.json, 'start', { status: 'in_progress', message: `Task: ${cmd}` });
      const res = await runPlannerAndNavigator(
        cmd,
        ctx,
        opts.model!,
        opts.apiKey,
        opts.baseUrl,
        opts.headers,
        opts.structuredOutput,
        opts.plannerOnly,
      );
      emit(opts.json, 'done', { status: 'done', result: { plan: res.plan, done: res.done } });
    }
    console.log('\n✅ All tasks completed!');
    await waitForUserInput('\nPress Enter to close the browser and exit...');
    await ctx.cleanup();
    process.exit(0);
  } catch (e: any) {
    emit(opts.json, 'failed', {
      status: 'failed',
      error: e?.message || String(e),
      details: process.env.DEBUG ? e?.stack || '' : undefined,
    });
    console.log('\n❌ Task failed!');
    await waitForUserInput('\nPress Enter to close the browser and exit...');
    await ctx.cleanup();
    process.exit(1);
  }
}

main();
