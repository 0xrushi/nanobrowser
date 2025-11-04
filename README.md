Nanobrowser CLI - AI-Powered Browser Automation

Overview
- AI-powered browser automation using the extension's PlannerAgent and NavigatorAgent.
- No REST, no WebSocket — runs directly via CLI.
- Full access to all browser actions with intelligent planning and execution.

Prerequisites
- Node.js 18+ recommended.
- pnpm (recommended) or npm

Install
1) Install dependencies:
   pnpm install

CLI AI Agent (using Planner + Navigator)
- Uses the extension's PlannerAgent and NavigatorAgent with all available actions.
- Displays AI's reasoning, planning, and actions in real-time.
- Waits for user input before closing the browser (press Enter to exit).
- Headful + real Chrome by default, persistent profile to reduce cookie prompts.
- Requires an OpenAI-compatible API (via --apiKey or --header flags).
- Install deps: pnpm install

Basic usage:
  # Using environment variable for API key
  OPENAI_API_KEY=sk-... pnpm run agent -- "Find Puppeteer docs and open the API page"
  
  # Using command-line flags
  pnpm run agent -- --model=gpt-4o-mini --apiKey=sk-... "Research latest Chrome devtools changes"
  
  # Headless mode
  pnpm run agent -- --headless --model=gpt-4o-mini --apiKey=sk-... "go to example.com and extract contact info"
  
  # Custom Chrome path
  pnpm run agent -- --chrome=/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome "research puppeteer docs"
  
  # Custom profile
  pnpm run agent -- --profile=~/.nanobrowser-profile "open youtube and search for AI tutorials"

OpenAI-compatible endpoints:
  - Set base URL via env OPENAI_BASE_URL or flag --baseUrl=https://your-endpoint/v1
  - Provide custom model via --model=your-model and key via --apiKey=your-key
  - Example:
    pnpm run agent -- --baseUrl=https://api.my-compat.com/v1 --model=my-model --apiKey=sk-compat-... "Open example.com and find contact info"

YAML config:
  You can place API and runtime settings inside the YAML along with tasks.
  Example (prompts.yaml):
  ---
  model: gpt-4o-mini
  baseUrl: https://api.my-compat.com/v1
  apiKey: sk-compat-...
  headful: true
  chrome: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  profile: ~/.nanobrowser-profile
  noSandbox: true
  tasks:
    - "Open example.com and find contact info"
    - "Go to wikipedia.org and search for web scraping"
  
  Run: pnpm run agent -- --file=prompts.yaml
  Or shorthand: pnpm run agent -- -f prompts.yaml

Supported task formats:
  - Natural language instructions: "Open youtube.com and search for AI tutorials"
  - Complex multi-step tasks: "Research the latest news about AI, summarize the top 3 articles, and extract contact information"
  - Any browsing task the AI can understand and execute

Notes
- The older server/client files are not required for this CLI-only flow.
- The agent path avoids importing extension browser APIs; it shims logging and reuses action schemas.
- To expand reuse further (prompts/planner/validator), we can add a bundling step and more adapters.
 - Both CLIs (nanobrowser and agent) launch Chrome with:
   - headful default, persistent profile at ~/.nanobrowser-profile (override via --profile)
   - ignore automation flag to reduce bot detection
   - you can set CHROME_PATH env or --chrome to pick your system Chrome
