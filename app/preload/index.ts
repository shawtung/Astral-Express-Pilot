import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

export type LogLine = { at: number; message: string };

const api = {
  loadCodex: () => ipcRenderer.invoke('codex:load'),
  openBrowser: (headless: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('browser:open', headless),
  validate: (config: unknown) => ipcRenderer.invoke('bot:validate', config),
  start: (config: unknown) => ipcRenderer.invoke('bot:start', config),
  stop: () => ipcRenderer.invoke('bot:stop'),
  dataDir: (): Promise<string> => ipcRenderer.invoke('app:data-dir'),
  openDataDir: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('app:open-data-dir'),
  openCapture: (path: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('app:open-capture', path),
  captureUrl: (path: string): Promise<string> => ipcRenderer.invoke('app:capture-url', path),
  /** Returns an unsubscribe so React effects can detach on re-render. */
  onLog: (handler: (line: LogLine) => void) => {
    const listener = (_event: IpcRendererEvent, line: LogLine) => handler(line);
    ipcRenderer.on('bot:log', listener);
    return () => {
      ipcRenderer.off('bot:log', listener);
    };
  },
};

contextBridge.exposeInMainWorld('pilot', api);

export type PilotApi = typeof api;
