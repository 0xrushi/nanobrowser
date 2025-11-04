import { useEffect, useState } from 'react';

interface TaskBridgeSettingsProps {
  isDarkMode?: boolean;
}

export function TaskBridgeSettings({ isDarkMode = false }: TaskBridgeSettingsProps) {
  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState('ws://localhost:8081');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<null | { ok: boolean; msg: string }>(null);
  const [bgStatus, setBgStatus] = useState<null | { enabled: boolean; connected: boolean; url: string }>(null);

  // REST test state
  const [httpUrl, setHttpUrl] = useState('http://localhost:3000');
  const [apiKey, setApiKey] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<null | { ok: boolean; taskId?: string; msg: string }>(null);
  const [polling, setPolling] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [testCommand, setTestCommand] = useState('go to example.com');

  useEffect(() => {
    let mounted = true;
    chrome.storage.local
      .get({
        taskBridgeEnabled: false,
        taskBridgeUrl: 'ws://localhost:8081',
        taskBridgeHttpUrl: 'http://localhost:3000',
        taskBridgeApiKey: '',
      })
      .then(v => {
        if (!mounted) return;
        setEnabled(Boolean(v.taskBridgeEnabled));
        if (typeof v.taskBridgeUrl === 'string' && v.taskBridgeUrl) setUrl(v.taskBridgeUrl);
        if (typeof v.taskBridgeHttpUrl === 'string' && v.taskBridgeHttpUrl) setHttpUrl(v.taskBridgeHttpUrl);
        if (typeof v.taskBridgeApiKey === 'string') setApiKey(v.taskBridgeApiKey);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await chrome.storage.local.set({
        taskBridgeEnabled: enabled,
        taskBridgeUrl: url.trim(),
        taskBridgeHttpUrl: httpUrl.trim(),
        taskBridgeApiKey: apiKey,
      });
    } finally {
      setSaving(false);
    }
  };

  const checkBackground = async () => {
    try {
      const status = await chrome.runtime.sendMessage({ type: 'bridge_status' });
      setBgStatus(status);
    } catch (e) {
      setBgStatus(null);
    }
  };

  const startBackgroundBridge = async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'bridge_connect_now' });
      // brief wait then re-check
      setTimeout(checkBackground, 500);
    } catch {}
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    const target = url.trim();
    const started = Date.now();
    let ws: WebSocket | null = null;
    let finished = false;

    const finish = (ok: boolean, msg: string) => {
      if (finished) return;
      finished = true;
      setTesting(false);
      setTestResult({ ok, msg });
      try {
        ws?.close();
      } catch {}
      ws = null;
    };

    try {
      if (!/^wss?:\/\//i.test(target)) {
        finish(false, 'URL must start with ws:// or wss://');
        return;
      }
      ws = new WebSocket(target);

      const timeout = setTimeout(() => finish(false, 'Timed out connecting (3s)'), 3000);

      ws.onopen = () => {
        const rtt = Date.now() - started;
        clearTimeout(timeout);
        finish(true, `Connected in ${rtt} ms`);
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        finish(false, 'Connection error');
      };
      ws.onclose = () => {
        // if it closes before open, treat as failure (unless already finished)
        if (!finished) finish(false, 'Connection closed');
      };
    } catch (e) {
      finish(false, e instanceof Error ? e.message : 'Unknown error');
    }
  };

  const sendTestTask = async () => {
    setSending(true);
    setSendResult(null);
    setStatusMsg('');
    try {
      const base = httpUrl.trim();
      if (!/^https?:\/\//i.test(base)) {
        setSendResult({ ok: false, msg: 'HTTP URL must start with http:// or https://' });
        return;
      }
      const res = await fetch(`${base.replace(/\/$/, '')}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'X-API-Key': apiKey } : {}),
        },
        body: JSON.stringify({ command: testCommand }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        setSendResult({ ok: false, msg: `HTTP ${res.status}: ${text || res.statusText}` });
        return;
      }
      const data = (await res.json()) as { taskId?: string };
      if (!data.taskId) {
        setSendResult({ ok: false, msg: 'No taskId in response' });
        return;
      }
      setSendResult({ ok: true, taskId: data.taskId, msg: 'Task created' });
    } catch (e) {
      setSendResult({ ok: false, msg: e instanceof Error ? e.message : 'Unknown error' });
    } finally {
      setSending(false);
    }
  };

  const pollStatus = async () => {
    if (!sendResult?.taskId) return;
    setPolling(true);
    setStatusMsg('');
    try {
      const base = httpUrl.trim();
      const res = await fetch(`${base.replace(/\/$/, '')}/task/status/${sendResult.taskId}`);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        setStatusMsg(`HTTP ${res.status}: ${text || res.statusText}`);
        return;
      }
      const data = await res.json();
      const status = data?.status ?? 'unknown';
      const result = data?.result ? JSON.stringify(data.result) : '';
      setStatusMsg(`Status: ${status}${result ? ` | Result: ${result}` : ''}`);
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setPolling(false);
    }
  };

  return (
    <section className="space-y-6">
      <div
        className={`rounded-lg border ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-white'} p-6 text-left shadow-sm`}>
        <h2 className={`mb-4 text-left text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          Backend Bridge
        </h2>

        <p className={`mb-4 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          Connect the extension to a local or remote backend over WebSocket to receive tasks.
        </p>

        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-lg font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Enable Bridge</h3>
              <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                Allow the extension to connect and execute incoming tasks.
              </p>
            </div>
            <div className="relative inline-flex cursor-pointer items-center">
              <input
                id="taskBridgeEnabled"
                type="checkbox"
                checked={enabled}
                onChange={e => setEnabled(e.target.checked)}
                className="peer sr-only"
              />
              <label
                htmlFor="taskBridgeEnabled"
                className={`peer h-6 w-11 rounded-full ${isDarkMode ? 'bg-slate-600' : 'bg-gray-200'} after:absolute after:left-[2px] after:top-[2px] after:size-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300`}>
                <span className="sr-only">Enable Bridge</span>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2">
            <label htmlFor="taskBridgeUrl" className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              WebSocket URL
            </label>
            <input
              id="taskBridgeUrl"
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="ws://localhost:8081"
              className={`w-full rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
            />
            <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              Must start with ws:// or wss://
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={save}
              disabled={saving}
              className={`${
                isDarkMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-500 hover:bg-blue-600 text-white'
              } rounded-md px-4 py-2 disabled:opacity-50`}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={testConnection}
              disabled={testing}
              className={`${
                isDarkMode
                  ? 'bg-slate-700 hover:bg-slate-600 text-gray-100'
                  : 'bg-gray-200 hover:bg-gray-300 text-gray-800'
              } rounded-md px-4 py-2 disabled:opacity-50`}>
              {testing ? 'Testing…' : 'Test Connection'}
            </button>
            <button
              onClick={checkBackground}
              className={`${
                isDarkMode
                  ? 'bg-slate-700 hover:bg-slate-600 text-gray-100'
                  : 'bg-gray-200 hover:bg-gray-300 text-gray-800'
              } rounded-md px-4 py-2`}>
              Check Background
            </button>
            <button
              onClick={startBackgroundBridge}
              className={`${isDarkMode ? 'bg-slate-700 hover:bg-slate-600 text-gray-100' : 'bg-gray-200 hover:bg-gray-300 text-gray-800'} rounded-md px-4 py-2`}>
              Start Bridge
            </button>
            {testResult && (
              <span className={`self-center text-sm ${testResult.ok ? 'text-green-600' : 'text-red-600'}`}>
                {testResult.ok ? '✅' : '❌'} {testResult.msg}
              </span>
            )}
            {bgStatus && (
              <span className={`self-center text-sm ${bgStatus.connected ? 'text-green-600' : 'text-yellow-600'}`}>
                BG {bgStatus.enabled ? 'enabled' : 'disabled'} · {bgStatus.connected ? 'connected' : 'disconnected'}
              </span>
            )}
          </div>

          <p className={`pt-2 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
            Changes take effect immediately. If enabled, the background reconnects to the new URL.
          </p>

          <hr className={`${isDarkMode ? 'border-slate-700' : 'border-blue-100'} my-4`} />

          <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
            End-to-End Test (REST)
          </h3>
          <p className={`mb-2 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Send a sample task via REST to verify the backend accepts tasks and the bridge receives them.
          </p>

          <div className="grid grid-cols-1 gap-2">
            <label
              htmlFor="taskBridgeTestCommand"
              className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              Test Command
            </label>
            <input
              id="taskBridgeTestCommand"
              type="text"
              value={testCommand}
              onChange={e => setTestCommand(e.target.value)}
              placeholder="e.g. search for cat photos"
              className={`w-full rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
            />
            <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              Free-form instruction. The agent will interpret and act.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2">
            <label htmlFor="taskBridgeHttpUrl" className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              HTTP Base URL
            </label>
            <input
              id="taskBridgeHttpUrl"
              type="text"
              value={httpUrl}
              onChange={e => setHttpUrl(e.target.value)}
              placeholder="http://localhost:3000"
              className={`w-full rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
            />
            <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              Should point to your REST server.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2">
            <label htmlFor="taskBridgeApiKey" className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              API Key (optional)
            </label>
            <input
              id="taskBridgeApiKey"
              type="text"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="e.g. my-secret"
              className={`w-full rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
            />
            <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              Used as X-API-Key header for POST /send.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={sendTestTask}
              disabled={sending}
              className={`${
                isDarkMode
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  : 'bg-emerald-500 hover:bg-emerald-600 text-white'
              } rounded-md px-4 py-2 disabled:opacity-50`}>
              {sending ? 'Sending…' : 'Send Test Task'}
            </button>
            <button
              onClick={pollStatus}
              disabled={!sendResult?.taskId || polling}
              className={`${
                isDarkMode
                  ? 'bg-slate-700 hover:bg-slate-600 text-gray-100'
                  : 'bg-gray-200 hover:bg-gray-300 text-gray-800'
              } rounded-md px-4 py-2 disabled:opacity-50`}>
              {polling ? 'Polling…' : 'Poll Status'}
            </button>
          </div>

          {sendResult && (
            <p className={`text-sm ${sendResult.ok ? 'text-green-600' : 'text-red-600'}`}>
              {sendResult.ok ? '✅' : '❌'} {sendResult.msg}
              {sendResult.taskId ? ` | taskId: ${sendResult.taskId}` : ''}
            </p>
          )}

          {statusMsg && <p className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{statusMsg}</p>}
        </div>
      </div>
    </section>
  );
}
